---
title: "AgentWriter AI: Planner, Fan-Out Workers and a Subgraph"
---

## Goal

Build **AgentWriter AI**, which writes a long-form article from a topic. A **planner** splits the article into sections, **worker agents write all sections in parallel** using LangGraph's `Send` API, a reducer collects them, and a **review subgraph** edits the assembled draft. This is the orchestrator-worker pattern: the number of workers is decided at runtime by the plan.

**Skills practiced:** orchestrator-worker pattern, dynamic fan-out with `Send`, reducers (`operator.add`), subgraphs, structured planning, parallel LLM calls.

## Architecture

```
               ┌──────────┐
 topic ──────► │ planner  │  Plan(sections=[s1, s2, s3, ...])
               └────┬─────┘
          Send  ┌───┼───────┬────────┐       (one Send per section, run in parallel)
                ▼   ▼       ▼        ▼
            ┌──────┐┌──────┐┌──────┐┌──────┐
            │writer││writer││writer││writer│   each returns {"sections": [text]}
            └──┬───┘└──┬───┘└──┬───┘└──┬───┘
               └───────┴───┬───┴───────┘      operator.add reducer merges lists
                           ▼
                     ┌───────────┐
                     │ assemble  │
                     └─────┬─────┘
                           ▼
          ┌──────── review subgraph ─────────┐
          │ critique ─► revise ─► (loop ≤2)  │
          └────────────────┬─────────────────┘
                           ▼
                          END
```

## Setup

```bash
pip install langgraph langchain-openai python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code — `agentwriter.py`

```python
import operator
from typing import Annotated, TypedDict
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini")

# ---------- planning ----------
class Section(BaseModel):
    title: str
    brief: str = Field(description="What this section must cover, 1-2 sentences")

class Plan(BaseModel):
    sections: list[Section] = Field(description="4-6 sections in reading order")

# ---------- review subgraph ----------
class Critique(BaseModel):
    approved: bool
    issues: list[str]

class ReviewState(TypedDict):
    draft: str
    issues: list[str]
    rounds: int

def critique(s: ReviewState):
    c = llm.with_structured_output(Critique).invoke(
        "Review this article for factual gaps, repetition and flow. "
        f"Approve if it is publishable.\n\n{s['draft']}")
    return {"issues": [] if c.approved else c.issues, "rounds": s["rounds"] + 1}

def revise(s: ReviewState):
    text = llm.invoke(f"Revise the article to fix these issues: {s['issues']}\n\n{s['draft']}").content
    return {"draft": text}

def needs_revision(s: ReviewState):
    return "revise" if s["issues"] and s["rounds"] < 3 else END

rg = StateGraph(ReviewState)
rg.add_node("critique", critique)
rg.add_node("revise", revise)
rg.add_edge(START, "critique")
rg.add_conditional_edges("critique", needs_revision, ["revise", END])
rg.add_edge("revise", "critique")
review_graph = rg.compile()

# ---------- parent graph ----------
class State(TypedDict, total=False):
    topic: str
    plan: Plan
    sections: Annotated[list[tuple[int, str]], operator.add]   # merged from all workers
    draft: str

class WorkerInput(TypedDict):
    idx: int
    section: Section
    topic: str

def planner(s: State):
    plan = llm.with_structured_output(Plan).invoke(f"Outline a blog article on: {s['topic']}")
    return {"plan": plan}

def fan_out(s: State):
    return [Send("writer", {"idx": i, "section": sec, "topic": s["topic"]})
            for i, sec in enumerate(s["plan"].sections)]

def writer(w: WorkerInput):
    text = llm.invoke(
        f"You are writing one section of an article on '{w['topic']}'.\n"
        f"Section: {w['section'].title}\nCover: {w['section'].brief}\n"
        "Write 150-250 words in markdown, starting with a ## heading.").content
    return {"sections": [(w["idx"], text)]}

def assemble(s: State):
    ordered = [text for _, text in sorted(s["sections"])]   # workers finish in any order
    return {"draft": f"# {s['topic']}\n\n" + "\n\n".join(ordered)}

def review(s: State):
    out = review_graph.invoke({"draft": s["draft"], "issues": [], "rounds": 0})
    return {"draft": out["draft"]}

g = StateGraph(State)
g.add_node("planner", planner)
g.add_node("writer", writer)
g.add_node("assemble", assemble)
g.add_node("review", review)
g.add_edge(START, "planner")
g.add_conditional_edges("planner", fan_out, ["writer"])
g.add_edge("writer", "assemble")          # waits for every writer to finish
g.add_edge("assemble", "review")
g.add_edge("review", END)
app = g.compile()

if __name__ == "__main__":
    result = app.invoke({"topic": "How the Model Context Protocol works"})
    print(result["draft"])
```

## How it works

1. **Planner** returns a typed `Plan`. The number of sections isn't fixed, which is exactly why you need dynamic fan-out.
2. **`fan_out`** is a conditional-edge function that returns a list of `Send` objects. Each `Send("writer", payload)` starts one writer run with its **own input**, not the whole parent state.
3. **Writers run in parallel** in the same superstep. Each returns a one-item list for `sections`.
4. **The `operator.add` reducer** concatenates those lists. Without a reducer, parallel writes to the same key raise an error.
5. **`assemble`** runs once, after all writers finish. It sorts by `idx` because completion order is random.
6. **Review subgraph** has a different schema (`ReviewState`), so it's invoked inside a node and only the final `draft` is mapped back. Its critique → revise loop is capped at two revisions.

| Pattern | Used here for |
|---|---|
| Orchestrator-worker | Planner decides the work, workers do it |
| Map-reduce | `Send` maps, reducer + assemble reduce |
| Evaluator-optimizer | Critique / revise loop in the subgraph |

## Gotchas

- **Rate limits.** Six parallel calls can hit RPM limits on low tiers. Set `max_concurrency` in the run config: `app.invoke(inputs, {"max_concurrency": 3})`.
- **Consistency.** Parallel writers can't see each other, so they repeat intros. Give each one the full outline in its prompt, or add a "smooth transitions" pass.
- **Cost.** The review loop re-sends the whole article each round. Cap rounds.

## Stretch goals

- [ ] Give each writer a search tool so sections cite real sources.
- [ ] Human approval of the outline (`interrupt()` after planner) before writers start.
- [ ] Make the reviewer a different, stronger model than the writers.
- [ ] Stream progress with `app.stream(..., subgraphs=True)` into a Streamlit UI.
- [ ] Add an SEO subgraph that generates title, meta description and tags.
- [ ] Evaluate with an LLM judge on a fixed set of 10 topics and track scores per prompt version.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
