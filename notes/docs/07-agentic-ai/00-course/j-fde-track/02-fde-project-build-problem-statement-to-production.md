---
title: "FDE Project Build: Problem Statement to Production"
---

## Goal

Work through one project the way a Forward Deployed Engineer would: start from a **customer problem statement**, agree **success metrics**, build an **eval set before the agent**, ship a small LangGraph agent, measure it, and deploy it behind an API with logging. The example customer is a SaaS company whose support team spends too long **triaging tickets**. The code is deliberately small. The process around it is the point.

**Skills practiced:** discovery and scoping, success criteria, eval-first development, structured outputs, a small RAG lookup, LangGraph, FastAPI, logging for production, writing a handoff.

## Architecture

```
Phase:   discover ─► scope ─► eval set ─► baseline ─► agent ─► measure ─► deploy ─► handoff
                                  │                      │         │
                                  └──── same 50 tickets ─┴─────────┘

Runtime:
ticket ─► POST /triage ─► LangGraph
                             classify (structured)  ─► category, priority, confidence
                                     │
                             retrieve KB articles   ─► top-3 help docs
                                     │
                             draft reply            ─► suggested response
                                     │
                         confidence < 0.7 ? ─► flag "needs_human"
                                     ▼
                          JSON response + log line (jsonl)
```

## Step 1: problem statement and scope

Write this down and get the customer to agree before coding:

```
Problem:   Agents spend ~6 min per ticket deciding category, priority and the right help article.
Users:     12 tier-1 support agents, ~800 tickets/day, English only.
In scope:  Suggest category (billing | bug | how_to | account | other), priority (P1-P3),
           top-3 KB articles and a draft reply. Human always sends the reply.
Out:       Auto-sending replies, non-English tickets, refunds.
Success:   ≥90% category accuracy, ≥80% priority accuracy, p95 latency < 5 s
           on 50 labelled historical tickets. Triage time measured in a 2-week pilot.
Data:      Ticket export (CSV), 140 KB articles (markdown). PII must not leave approved vendors.
```

## Setup

```bash
pip install langgraph langchain-openai langchain-core fastapi "uvicorn[standard]" pandas python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

Files: `kb/*.md` (help articles), `eval/tickets.csv` with columns `text,category,priority`.

## Code

### `agent.py`

```python
from pathlib import Path
from typing import Literal, TypedDict
from pydantic import BaseModel, Field
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

docs = [(p.stem, p.read_text()) for p in Path("kb").glob("*.md")]
kb = InMemoryVectorStore(OpenAIEmbeddings(model="text-embedding-3-small"))
kb.add_texts([text for _, text in docs], metadatas=[{"slug": slug} for slug, _ in docs])

class Triage(BaseModel):
    category: Literal["billing", "bug", "how_to", "account", "other"]
    priority: Literal["P1", "P2", "P3"] = Field(description="P1 = outage or data loss, P3 = question")
    confidence: float = Field(ge=0, le=1)

class State(TypedDict, total=False):
    ticket: str
    triage: Triage
    articles: list[str]
    reply: str
    needs_human: bool

def classify(s: State):
    t = llm.with_structured_output(Triage).invoke(
        f"Triage this support ticket for a SaaS product.\n\n{s['ticket']}")
    return {"triage": t, "needs_human": t.confidence < 0.7}

def retrieve(s: State):
    hits = kb.similarity_search(s["ticket"], k=3)
    return {"articles": [h.metadata["slug"] for h in hits]}

def draft(s: State):
    reply = llm.invoke(
        f"Draft a short, polite support reply. Link these help articles by slug: "
        f"{s['articles']}. Don't promise refunds or dates.\n\nTicket:\n{s['ticket']}").content
    return {"reply": reply}

g = StateGraph(State)
g.add_node("classify", classify)
g.add_node("retrieve", retrieve)
g.add_node("draft", draft)
g.add_edge(START, "classify")
g.add_edge("classify", "retrieve")
g.add_edge("retrieve", "draft")
g.add_edge("draft", END)
app = g.compile()
```

### `evaluate.py` — run before and after every change

```python
import time
import pandas as pd
from dotenv import load_dotenv
load_dotenv()
from agent import app

df = pd.read_csv("eval/tickets.csv")
rows = []
for r in df.itertuples():
    t0 = time.time()
    out = app.invoke({"ticket": r.text})
    rows.append({"cat_ok": out["triage"].category == r.category,
                 "pri_ok": out["triage"].priority == r.priority,
                 "latency": time.time() - t0})
res = pd.DataFrame(rows)
print(f"category acc {res.cat_ok.mean():.0%} | priority acc {res.pri_ok.mean():.0%} "
      f"| p95 latency {res.latency.quantile(0.95):.1f}s")
```

### `main.py`

```python
import json, logging, time, uuid
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI
from pydantic import BaseModel
from agent import app as graph

logging.basicConfig(filename="triage.jsonl", level=logging.INFO, format="%(message)s")
api = FastAPI()

class Ticket(BaseModel):
    text: str

@api.post("/triage")
def triage(t: Ticket):
    rid, t0 = str(uuid.uuid4()), time.time()
    out = graph.invoke({"ticket": t.text})
    result = {"id": rid, **out["triage"].model_dump(), "articles": out["articles"],
              "reply": out["reply"], "needs_human": out["needs_human"]}
    logging.info(json.dumps({**result, "latency": round(time.time() - t0, 2)}))
    return result
```

Deploy with the Docker and cloud steps from section F; for a real customer, deploy inside their cloud account or VPC if data rules require it.

## How it works (and why in this order)

1. **Scope first.** The written problem statement stops the project growing into "an AI support platform". It also defines the human-in-the-loop boundary: the agent suggests, a person sends.
2. **Eval set before the agent.** 50 labelled historical tickets turn "does it work?" into numbers the customer agreed to.
3. **Baseline.** Run `evaluate.py` with a one-line prompt first. Every later change must beat it.
4. **Agent.** A fixed pipeline, not an autonomous agent. The workflow is known, so a simple graph is cheaper and more predictable. Add autonomy only when the task needs it.
5. **Confidence flag.** Low-confidence tickets go to a human queue. In practice, self-reported LLM confidence is rough; calibrate the threshold against the eval set.
6. **Logging.** Every request is a JSON line, so you can compute accuracy on corrected labels during the pilot and catch drift.

## Handoff checklist

- [ ] Eval results table (baseline vs final) shared with the customer.
- [ ] Runbook: how to restart, rotate keys, update KB articles, re-run evals.
- [ ] Known limitations written down (non-English, sarcasm, multi-issue tickets).
- [ ] Owner on the customer side named.
- [ ] Field notes for the product team: what was hard, what should be a product feature.

## Stretch goals

- [ ] Replace the in-memory store with pgvector and re-index KB articles nightly.
- [ ] Add a feedback endpoint: agents mark the suggestion right or wrong; feed it into the eval set.
- [ ] PII redaction before the LLM call.
- [ ] Trace with LangSmith or Langfuse and build a weekly accuracy dashboard.
- [ ] Compare a cheaper open model on the same eval set and report the cost/accuracy tradeoff.
- [ ] Write a one-page "results memo" for a non-technical stakeholder.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
