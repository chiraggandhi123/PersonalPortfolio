---
title: "Autonomous Blog-Generation Agent"
---

## Goal

Give the agent a topic and get back a **researched, edited blog post in Markdown**, with sources. The pipeline researches the web, plans an outline, writes the draft, and then runs an **editor loop**: a critic scores the draft and the writer revises until the score passes or a revision limit is hit.

**Skills practiced:** LangGraph `StateGraph`, conditional edges, reflection loops with a hard stop, structured outputs with Pydantic, web search tools, prompt design for different roles.

## Architecture

```
topic
  │
  ▼
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ research │──►│ outline  │──►│  write   │──►│  critic  │
│ (Tavily) │   │ (schema) │   │ (draft)  │   │ (score)  │
└──────────┘   └──────────┘   └────▲─────┘   └────┬─────┘
                                   │              │
                    score < 8 and  │              │ score >= 8
                    revisions < 3  │              │ or revisions == 3
                                   └──── revise ──┤
                                                  ▼
                                            ┌──────────┐
                                            │  publish │ → posts/slug.md
                                            └──────────┘
```

The key idea: **reflection only helps with a stop condition.** Without the revision cap, a picky critic can loop forever and burn your budget.

## Setup

```bash
pip install langgraph langchain-openai tavily-python python-dotenv
```

`.env` (Tavily has a free tier for search):

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
```

## Code — `blog_agent.py`

```python
import os
import re
from pathlib import Path
from typing import TypedDict

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field
from tavily import TavilyClient

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
critic_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
tavily = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
MAX_REVISIONS = 3


class Outline(BaseModel):
    title: str
    sections: list[str] = Field(description="4-6 section headings in reading order")


class Review(BaseModel):
    score: int = Field(description="1-10 overall quality")
    feedback: str = Field(description="Concrete, numbered fixes for the writer")


class BlogState(TypedDict, total=False):
    topic: str
    notes: str
    sources: list[str]
    outline: Outline
    draft: str
    review: Review
    revisions: int


def research(state: BlogState):
    results = tavily.search(state["topic"], max_results=5)["results"]
    notes = "\n\n".join(f"[{i+1}] {r['title']}: {r['content']}" for i, r in enumerate(results))
    return {"notes": notes, "sources": [r["url"] for r in results], "revisions": 0}


def outline(state: BlogState):
    plan = llm.with_structured_output(Outline).invoke(
        f"Plan a blog post on '{state['topic']}' for developers.\nResearch notes:\n{state['notes']}"
    )
    return {"outline": plan}


def write(state: BlogState):
    o = state["outline"]
    feedback = state.get("review")
    prompt = (
        f"Write a ~900-word blog post in Markdown titled '{o.title}' with sections {o.sections}.\n"
        f"Use only facts from these notes and cite them as [n]:\n{state['notes']}\n"
    )
    if feedback:   # revision pass
        prompt += f"\nRevise this draft:\n{state['draft']}\n\nEditor feedback:\n{feedback.feedback}"
    return {"draft": llm.invoke(prompt).content,
            "revisions": state["revisions"] + (1 if feedback else 0)}


def critic(state: BlogState):
    review = critic_llm.with_structured_output(Review).invoke(
        "You are a strict tech editor. Score this draft for accuracy against the notes, "
        f"clarity, structure and a strong intro.\nNotes:\n{state['notes']}\n\nDraft:\n{state['draft']}"
    )
    print(f"critic: {review.score}/10 (revision {state['revisions']})")
    return {"review": review}


def should_revise(state: BlogState) -> str:
    if state["review"].score >= 8 or state["revisions"] >= MAX_REVISIONS:
        return "publish"
    return "write"


def publish(state: BlogState):
    slug = re.sub(r"[^a-z0-9]+", "-", state["outline"].title.lower()).strip("-")
    refs = "\n".join(f"{i+1}. {url}" for i, url in enumerate(state["sources"]))
    path = Path("posts") / f"{slug}.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text(f"{state['draft']}\n\n## Sources\n\n{refs}\n")
    print("saved", path)
    return {}


g = StateGraph(BlogState)
for name, fn in [("research", research), ("outline", outline), ("write", write),
                 ("critic", critic), ("publish", publish)]:
    g.add_node(name, fn)
g.add_edge(START, "research")
g.add_edge("research", "outline")
g.add_edge("outline", "write")
g.add_edge("write", "critic")
g.add_conditional_edges("critic", should_revise, ["write", "publish"])
g.add_edge("publish", END)
app = g.compile()

if __name__ == "__main__":
    app.invoke({"topic": "How vector databases speed up semantic search"})
```

## How it works

1. **research** calls Tavily once and keeps numbered snippets and URLs. Grounding the writer in these notes cuts down on invented facts.
2. **outline** uses `with_structured_output` so later nodes get a real `Outline` object, not text to parse.
3. **write** has two modes. With no review it drafts; with a review it revises using the critic's feedback.
4. **critic** uses a separate, deterministic (`temperature=0`) model call with a strict persona. A different role, and ideally a different model, gives more honest scores than self-review in the same prompt.
5. **should_revise** is the stop condition: pass on quality **or** on budget, whichever comes first.
6. **publish** writes the Markdown and appends the source list so every `[n]` citation resolves.

## Gotchas

- **LLM critics are lenient and inconsistent.** Give a rubric and ask for specific fixes, not just a score.
- **Citations can still drift** — the writer may cite `[3]` for a fact from `[1]`. A citation-check node helps.
- **Token growth** — each revision sends notes plus the draft. Trim notes once the outline is done.
- **Plagiarism** — paraphrase sources. Tell the writer not to copy sentences verbatim.

## Stretch goals

- [ ] **Parallel section writers** — fan out one writer per section with LangGraph's `Send`, then join.
- [ ] **Human approval** — `interrupt()` after the outline so you can edit it before writing.
- [ ] **SEO node** — meta description, tags and a slug check.
- [ ] **Cover image** — generate one with an image model from the title.
- [ ] **Publish to dev.to, Hashnode or Ghost** through their APIs.
- [ ] **Trace in LangSmith** and compare cost per post across models.
- [ ] **Eval** — score 10 generated posts with a fixed rubric and track it over prompt changes.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
