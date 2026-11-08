---
title: "Corrective RAG (CRAG)"
---

## TL;DR

Corrective RAG adds a **retrieval evaluator** between retrieval and generation. Each retrieved chunk is **graded for relevance**; if enough are good, answer; if they're weak, **rewrite the query and retry**, or **fall back to another source** such as web search. The production details matter: use a **cheap structured grader**, cap retries with a **hard limit**, and **log every grade** so you can tune thresholds from data.

## The flow

```
question ──► retrieve ──► grade each chunk (relevant? yes/no)
                               │
            ┌──────────────────┼────────────────────┐
     all/most relevant    some relevant        none relevant
            │                  │                    │
            ▼                  ▼                    ▼
        generate      keep good + supplement   rewrite query ──► retry (max N)
                       with web search              │
                                                    └─ still none → web search or "I don't know"
```

The original CRAG paper classifies retrieval as **Correct / Ambiguous / Incorrect** and acts differently for each. Most implementations simplify this to a per-chunk yes/no grade plus a fallback.

## The grader

Use structured outputs so the grade is machine-readable, and keep it binary. Scores from 1 to 10 are noisy.

```python
from typing import Literal
from pydantic import BaseModel, Field
from openai import OpenAI

client = OpenAI()

class Grade(BaseModel):
    reason: str = Field(description="One short sentence")
    relevant: Literal["yes", "no"]

GRADER = ("You grade whether a document chunk helps answer a question. "
          "Say 'yes' only if it contains facts needed for the answer. Keyword overlap alone is 'no'.")

def grade(question: str, chunk: str) -> Grade:
    resp = client.chat.completions.parse(
        model="gpt-4o-mini",
        temperature=0,
        messages=[{"role": "system", "content": GRADER},
                  {"role": "user", "content": f"Question: {question}\n\nChunk:\n{chunk}"}],
        response_format=Grade,
    )
    return resp.choices[0].message.parsed
```

Grade chunks **in parallel** (async or a thread pool). Grading 5 chunks one by one adds 5 round trips to every request.

## Wiring it in LangGraph with a retry limit

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

MAX_REWRITES = 2

class State(TypedDict):
    question: str
    query: str
    docs: list[str]
    rewrites: int
    answer: str

def retrieve(s: State):
    return {"docs": [d.page_content for d in retriever.invoke(s["query"])]}

def grade_docs(s: State):
    good = [d for d in s["docs"] if grade(s["question"], d).relevant == "yes"]
    return {"docs": good}

def rewrite(s: State):
    q = llm(f"Rewrite this as a better search query, keep key terms:\n{s['question']}")
    return {"query": q, "rewrites": s["rewrites"] + 1}

def web_search(s: State):
    return {"docs": s["docs"] + tavily_search(s["question"])}

def generate(s: State):
    return {"answer": answer_from(s["question"], s["docs"])}

def route(s: State) -> str:
    if len(s["docs"]) >= 2:
        return "generate"
    if s["rewrites"] < MAX_REWRITES:
        return "rewrite"
    return "web_search"                     # retries exhausted → fallback

g = StateGraph(State)
for name, fn in [("retrieve", retrieve), ("grade", grade_docs), ("rewrite", rewrite),
                 ("web_search", web_search), ("generate", generate)]:
    g.add_node(name, fn)
g.add_edge(START, "retrieve")
g.add_edge("retrieve", "grade")
g.add_conditional_edges("grade", route, ["generate", "rewrite", "web_search"])
g.add_edge("rewrite", "retrieve")           # the cycle
g.add_edge("web_search", "generate")
g.add_edge("generate", END)
app = g.compile()

app.invoke({"question": q, "query": q, "docs": [], "rewrites": 0, "answer": ""})
```

`retriever`, `llm`, `tavily_search` and `answer_from` are your own helpers. The counter in state is what stops the loop. Also pass `config={"recursion_limit": 15}` as a second safety net.

## Production concerns

| Concern | What to do |
|---|---|
| Latency | Grade in parallel; use a small model; skip grading when the reranker score is very high |
| Cost | Grading k chunks = k extra calls. Grade the top 4–5 after reranking, not the top 20 |
| Web fallback | Not always allowed. Internal or regulated data may require "I don't know" instead |
| Grader drift | Log `(question, chunk, grade)`; hand-label 100 samples and measure grader accuracy |
| Over-filtering | A strict grader drops partially useful chunks. Track how often all chunks are rejected |
| Loops | Hard cap on rewrites plus `recursion_limit` |

## When CRAG is worth it

- Your corpus has **gaps**, so many questions have no good answer in the index.
- Wrong answers are **costly**, and "I don't know" is acceptable.
- You have **budget** for 2–6 extra small-model calls per query.

If retrieval is already precise (good reranker, narrow corpus), measure first. CRAG may add latency for little gain.

## Key terms

- **Retrieval evaluator / grader** — a model that judges whether retrieved chunks are relevant.
- **Query rewriting** — reformulating the question to improve retrieval.
- **Fallback source** — an alternative source (web, another index, SQL) used when retrieval fails.
- **Retry limit** — a counter in state that bounds the rewrite-retrieve loop.
- **Knowledge refinement** — CRAG's step of stripping irrelevant sentences from kept chunks.

## Interview quick-fire

- **"What does CRAG add to RAG?"** → A relevance check on retrieved docs, plus corrective actions: rewrite and retry, or fall back to another source.
- **"How do you stop an infinite rewrite loop?"** → A rewrite counter in graph state checked by the router, plus the framework's recursion limit.
- **"Binary grades or scores?"** → Binary with a short reason. LLM numeric scores are poorly calibrated.
- **"How do you know the grader works?"** → Label a sample of chunk-question pairs and measure its precision and recall like any classifier.
