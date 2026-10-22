---
title: "AI-Powered Content Summarization"
---

## Goal

Build a tool that takes **an article URL, pasted text, or a PDF** and returns a clean summary — and that still works when the content is **longer than the context window**.

**Skills practiced:** token counting, context limits, chunking, map-reduce prompting, temperature choice, faithfulness (avoiding hallucinated summaries), a simple UI.

## Architecture

```
input (URL / text / PDF)
   │
   ▼
extract text ──► count tokens ──┬── fits? ──► single summarize call ──┐
                                │                                     │
                                └── too long? ──► chunk ──► summarize │
                                                  each chunk (map)    │
                                                       │              │
                                                       ▼              │
                                               combine summaries ─────┤
                                                  (reduce)            ▼
                                                                  summary
```

## Setup

```bash
pip install anthropic python-dotenv trafilatura pypdf streamlit
```

- `trafilatura` — pulls the main article text out of a webpage (drops nav, ads).
- `pypdf` — extracts text from PDFs.

## Code — `summarize.py`

```python
import anthropic
import trafilatura
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv()
client = anthropic.Anthropic()
MODEL = "claude-haiku-5-5"
CHUNK_TOKENS = 20_000          # well under the context window
CHARS_PER_TOKEN = 4            # rough estimate for chunking


# ---------- extraction ----------
def from_url(url: str) -> str:
    html = trafilatura.fetch_url(url)
    return trafilatura.extract(html) or ""

def from_pdf(file) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(file).pages)


# ---------- LLM ----------
def llm(prompt: str, max_tokens: int = 1024) -> str:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        temperature=0.2,       # faithful, not creative
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text

def summarize_once(text: str, style: str) -> str:
    return llm(f"""Summarize the document below as {style}.
Only include information stated in the document. Do not add outside facts.

<document>
{text}
</document>""")


# ---------- chunking + map-reduce ----------
def chunk(text: str, size_tokens: int = CHUNK_TOKENS, overlap_tokens: int = 500):
    size, overlap = size_tokens * CHARS_PER_TOKEN, overlap_tokens * CHARS_PER_TOKEN
    start = 0
    while start < len(text):
        yield text[start:start + size]
        start += size - overlap

def summarize(text: str, style: str = "5 concise bullet points") -> str:
    tokens = client.messages.count_tokens(
        model=MODEL, messages=[{"role": "user", "content": text}]
    ).input_tokens

    if tokens <= CHUNK_TOKENS:
        return summarize_once(text, style)

    # map: summarize each chunk
    partials = [summarize_once(c, "a detailed paragraph") for c in chunk(text)]
    # reduce: summarize the summaries
    return summarize_once("\n\n".join(partials), style)
```

## UI — `app.py` (Streamlit)

```python
import streamlit as st
from summarize import from_pdf, from_url, summarize

st.title("Summarizer")
style = st.selectbox("Style", ["5 concise bullet points", "a one-paragraph TL;DR",
                               "an executive summary with key takeaways"])
tab_url, tab_text, tab_pdf = st.tabs(["URL", "Text", "PDF"])

text = ""
with tab_url:
    url = st.text_input("Article URL")
    if url: text = from_url(url)
with tab_text:
    pasted = st.text_area("Paste text", height=250)
    if pasted: text = pasted
with tab_pdf:
    pdf = st.file_uploader("Upload PDF", type="pdf")
    if pdf: text = from_pdf(pdf)

if st.button("Summarize", disabled=not text):
    with st.spinner("Summarizing..."):
        st.markdown(summarize(text, style))
```

Run: `streamlit run app.py`

## Things to watch

- **Hallucinated details** — the prompt restricts the model to the document; low temperature helps. Spot-check summaries against the source.
- **Chunk boundaries** — splitting mid-thought loses context; overlap helps, splitting on paragraphs is better.
- **Cost** — map-reduce on a 300-page PDF is many calls. Log `usage` and show an estimate before running.
- **Empty extraction** — paywalls, JS-heavy pages, and scanned PDFs return little or no text. Handle it gracefully.

## Stretch goals

- [ ] Split chunks on paragraphs/headings instead of raw characters.
- [ ] Run map calls **in parallel** with `AsyncAnthropic` + `asyncio.gather`.
- [ ] **Stream** the final summary into the UI.
- [ ] **Structured output** — return `{title, tl_dr, key_points[], action_items[]}` as JSON (validate with Pydantic).
- [ ] **YouTube** — summarize from a video transcript.
- [ ] **Faithfulness check** — a second LLM call verifying every bullet is supported by the source.
- [ ] Show token count and estimated cost before summarizing.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
