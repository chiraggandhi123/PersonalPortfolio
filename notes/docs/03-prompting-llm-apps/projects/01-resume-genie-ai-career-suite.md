---
title: "Resume Genie — AI Career Suite"
---

## Goal

Build a Streamlit app where a user uploads a **résumé PDF** and pastes a **job description**, and gets back: a **match analysis** (score, matched and missing skills), **rewritten bullet points** tailored to the job, a **cover letter**, and **likely interview questions**. Each feature is a separate, focused prompt with a typed output.

**Skills practiced:** prompt design, few-shot examples, structured outputs with Pydantic, prompt templates, PDF text extraction, Streamlit UI and session state, grounding outputs in source text.

## Architecture

```
            ┌──────────── Streamlit UI ────────────┐
résumé.pdf ─┤  pypdf → résumé text                  │
job text  ──┤                                       │
            └──────┬───────────┬──────────┬─────────┘
                   ▼           ▼          ▼          ▼
             [match]     [rewrite]   [cover]   [questions]     ← one prompt each
           MatchReport  list[Bullet]  str      list[Question]  ← typed outputs
                   │           │          │          │
                   └───────────┴────┬─────┴──────────┘
                                    ▼
                         tabs in the UI + download
```

The résumé and job text are parsed once and cached in `st.session_state`. Each tab calls its own function, so a bad cover letter doesn't affect the match score.

## Setup

```bash
pip install streamlit openai pydantic pypdf python-dotenv
```

`.env` (add it to `.gitignore`):

```
OPENAI_API_KEY=sk-...
```

## Code — `genie.py` (LLM logic)

```python
from openai import OpenAI
from pydantic import BaseModel, Field

client = OpenAI()
MODEL = "gpt-4o-mini"

GROUNDING = (
    "Use only facts from the résumé. Never invent employers, dates, degrees, "
    "numbers or skills. If something is missing, leave it out."
)

class MatchReport(BaseModel):
    reasoning: str = Field(description="Brief comparison of résumé vs. job, written first")
    score: int = Field(ge=0, le=100, description="Overall fit, 0-100")
    matched_skills: list[str]
    missing_skills: list[str] = Field(description="Required by the job, absent from the résumé")
    top_suggestions: list[str] = Field(max_length=5)

class Bullet(BaseModel):
    original: str
    rewritten: str = Field(description="Action verb + what + measurable result, under 30 words")

class Bullets(BaseModel):
    bullets: list[Bullet]

class Question(BaseModel):
    question: str
    why_they_ask: str
    answer_hint: str = Field(description="How to answer using the candidate's own experience")

class Questions(BaseModel):
    questions: list[Question]


def _parse(system: str, user: str, schema):
    completion = client.chat.completions.parse(
        model=MODEL,
        temperature=0.3,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format=schema,
    )
    msg = completion.choices[0].message
    if msg.refusal:
        raise ValueError(msg.refusal)
    return msg.parsed


def _docs(resume: str, job: str) -> str:
    return f"<resume>\n{resume}\n</resume>\n\n<job>\n{job}\n</job>"


def match(resume: str, job: str) -> MatchReport:
    system = f"You are an experienced technical recruiter. Compare the résumé to the job. {GROUNDING}"
    return _parse(system, _docs(resume, job), MatchReport)


REWRITE_EXAMPLE = (
    "Example:\n"
    "original: Worked on the backend team\n"
    "rewritten: Built 6 REST endpoints in FastAPI serving 20k daily users, cutting p95 latency by 30%\n"
    "(Only add numbers that appear in the résumé.)"
)

def rewrite_bullets(resume: str, job: str) -> Bullets:
    system = (
        "Rewrite the 5 résumé bullets most relevant to the job, using the job's keywords "
        f"where truthful. {GROUNDING}\n\n{REWRITE_EXAMPLE}"
    )
    return _parse(system, _docs(resume, job), Bullets)


def cover_letter(resume: str, job: str, tone: str = "professional") -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        temperature=0.7,
        messages=[
            {"role": "system", "content": (
                f"Write a {tone} cover letter, max 250 words, 3 short paragraphs: "
                f"why this role, 2 concrete matching achievements, a closing line. {GROUNDING}")},
            {"role": "user", "content": _docs(resume, job)},
        ],
    )
    return resp.choices[0].message.content


def interview_questions(resume: str, job: str) -> Questions:
    system = (
        "List 6 likely interview questions for this candidate and role: 2 technical, "
        f"2 behavioural, 2 probing gaps between résumé and job. {GROUNDING}"
    )
    return _parse(system, _docs(resume, job), Questions)
```

## Code — `app.py` (UI)

```python
import streamlit as st
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv()
import genie  # noqa: E402  (load env before the client is created)

st.set_page_config(page_title="Resume Genie", layout="wide")
st.title("Resume Genie")

pdf = st.file_uploader("Résumé (PDF)", type="pdf")
job = st.text_area("Job description", height=200)

if pdf and job:
    if st.session_state.get("pdf_name") != pdf.name:          # parse once per upload
        st.session_state.resume = "\n".join(p.extract_text() or "" for p in PdfReader(pdf).pages)
        st.session_state.pdf_name = pdf.name
    resume = st.session_state.resume[:15000]                  # keep the prompt bounded

    t1, t2, t3, t4 = st.tabs(["Match", "Bullets", "Cover letter", "Interview prep"])

    with t1:
        if st.button("Analyse match"):
            r = genie.match(resume, job)
            st.metric("Fit score", f"{r.score}/100")
            c1, c2 = st.columns(2)
            c1.success("Matched: " + ", ".join(r.matched_skills))
            c2.warning("Missing: " + ", ".join(r.missing_skills))
            for s in r.top_suggestions:
                st.write("- " + s)

    with t2:
        if st.button("Rewrite bullets"):
            for b in genie.rewrite_bullets(resume, job).bullets:
                st.markdown(f"~~{b.original}~~  \n**{b.rewritten}**")

    with t3:
        tone = st.selectbox("Tone", ["professional", "enthusiastic", "concise"])
        if st.button("Write cover letter"):
            letter = genie.cover_letter(resume, job, tone)
            st.text_area("Draft", letter, height=300)
            st.download_button("Download .txt", letter, file_name="cover_letter.txt")

    with t4:
        if st.button("Generate questions"):
            for q in genie.interview_questions(resume, job).questions:
                with st.expander(q.question):
                    st.write(f"**Why they ask:** {q.why_they_ask}")
                    st.write(f"**Hint:** {q.answer_hint}")
```

Run with `streamlit run app.py`.

## How it works

1. **PDF → text.** `pypdf` extracts text page by page. Scanned PDFs return nothing; those need OCR.
2. **One prompt per feature.** Each function has a narrow job, its own temperature (low for analysis, higher for the letter) and its own schema.
3. **Grounding rule.** The shared `GROUNDING` sentence is in every prompt. Invented achievements are the biggest risk in a résumé tool, so it's stated explicitly.
4. **Reasoning first.** `MatchReport.reasoning` comes before `score`, so the score is based on a written comparison rather than a guess.
5. **Delimiters.** Résumé and job sit inside `resume` and `job` tags, which keeps them apart and makes instructions inside an uploaded file less likely to be followed.
6. **Few-shot for style.** The bullet rewriter gets one example of the target format, with a reminder not to copy its numbers.

## Things to watch

- **Score consistency.** Run the same résumé three times; if scores swing a lot, give a rubric (e.g. 40 points for required skills, 30 for experience level, …).
- **Hallucinated metrics.** Spot-check rewritten bullets against the original.
- **Privacy.** Résumés contain personal data. Don't log them, and tell users the text is sent to an LLM provider.

## Stretch goals

- [ ] **Scoring rubric** in the prompt, and show the per-criterion breakdown.
- [ ] **Hallucination check** — a second call verifying each rewritten bullet is supported by the résumé.
- [ ] **Prompt files** — move prompts to versioned Jinja2 templates ([templates & versioning](../04-prompt-templates-versioning.md)).
- [ ] **Export** the tailored résumé as a DOCX or PDF.
- [ ] **Mock interview** — a chat mode that asks the generated questions one by one and gives feedback.
- [ ] **Streaming** the cover letter with `st.write_stream`.
- [ ] **Deploy** to Streamlit Community Cloud with the key in app secrets.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
