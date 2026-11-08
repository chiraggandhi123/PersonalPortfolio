---
title: "LangGraph Subgraphs"
---

## TL;DR

A **subgraph** is a compiled LangGraph graph used as a node inside another graph. It lets you **build big agent systems from small, testable pieces**: a research team, a writer and a reviewer can each be their own graph. There are two ways to wire one in: **add it directly as a node** when parent and child share state keys, or **call it inside a node function** when the schemas differ and you need to translate.

## Why subgraphs

| Benefit | What it means |
|---|---|
| Encapsulation | Child state (scratch notes, retries) stays out of the parent |
| Reuse | One "research" subgraph used by several parent graphs |
| Team ownership | Different people build and test different graphs |
| Multi-agent | Each agent is a subgraph; a supervisor routes between them |

```
Parent graph
START ─► plan ─► ┌─────── research subgraph ───────┐ ─► write ─► END
                 │ search ─► read ─► summarize      │
                 └──────────────────────────────────┘
```

## Option 1: shared state keys, add as a node

If the child uses some of the same keys as the parent, add the compiled child directly. LangGraph passes matching keys in and merges matching keys out.

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class ParentState(TypedDict):
    topic: str
    notes: str
    draft: str

class ResearchState(TypedDict):
    topic: str        # shared with parent
    notes: str        # shared with parent
    queries: list[str]   # private to the subgraph

def make_queries(s: ResearchState):
    return {"queries": [f"{s['topic']} overview", f"{s['topic']} pitfalls"]}

def gather(s: ResearchState):
    return {"notes": " | ".join(f"results for {q}" for q in s["queries"])}

sub = StateGraph(ResearchState)
sub.add_node("make_queries", make_queries)
sub.add_node("gather", gather)
sub.add_edge(START, "make_queries")
sub.add_edge("make_queries", "gather")
sub.add_edge("gather", END)
research = sub.compile()

def write(s: ParentState):
    return {"draft": f"Article on {s['topic']} using: {s['notes']}"}

parent = StateGraph(ParentState)
parent.add_node("research", research)      # compiled graph as a node
parent.add_node("write", write)
parent.add_edge(START, "research")
parent.add_edge("research", "write")
parent.add_edge("write", END)
app = parent.compile()

print(app.invoke({"topic": "MCP"})["draft"])
```

`queries` never appears in the parent state.

## Option 2: different schemas, call from a node

When the child's state looks nothing like the parent's, wrap it. You translate in and out yourself.

```python
class ReviewState(TypedDict):
    text: str
    issues: list[str]

review_graph = build_review_graph()     # compiled StateGraph(ReviewState)

def review(s: ParentState):
    out = review_graph.invoke({"text": s["draft"], "issues": []})
    return {"draft": s["draft"] + f"\n\n[{len(out['issues'])} issues found]"}

parent.add_node("review", review)
```

| | Add as node | Call inside node |
|---|---|---|
| Schemas | Share at least one key | Can be completely different |
| Mapping | Automatic | You write it |
| Streaming / checkpoints | Fully integrated | Integrated if invoked within the node (same config) |

## Persistence, streaming and interrupts

- **Checkpointer:** pass it only to the parent's `compile()`. Subgraphs inherit it. Use `sub.compile(checkpointer=True)` only if the subgraph needs its own separate memory across calls.
- **Streaming:** `app.stream(inputs, subgraphs=True)` yields `(namespace, chunk)` tuples, so you can see which subgraph emitted each update.
- **Inspecting state:** `app.get_state(config, subgraphs=True)` includes the child's state when it's paused.
- **Interrupts:** an `interrupt()` inside a subgraph pauses the whole parent. When resumed, the subgraph node **restarts from its beginning**, so keep code before the interrupt idempotent.

## Navigating out of a subgraph

A node inside a subgraph can jump to a node in the parent with `Command`:

```python
from langgraph.types import Command

def done(s):
    return Command(goto="write", graph=Command.PARENT, update={"notes": s["notes"]})
```

This is how handoff-style multi-agent systems move control between agents. Any key you update in the parent should have a reducer if multiple children can write it.

## Gotchas

- **Key name collisions.** With option 1, any shared key the child returns overwrites the parent's value (unless a reducer is defined). Rename private keys clearly.
- **Message lists.** If both use `messages` with `add_messages`, the child's whole conversation gets appended to the parent. Often you want only the final answer: use option 2 and return one message.
- **Over-nesting.** Two levels is usually plenty. Deeper nesting makes traces hard to read.
- **Test the child alone.** The main payoff of subgraphs is that you can `invoke` and evaluate each one in isolation.

## Key terms

- **Subgraph** — a compiled graph used as a node inside a parent graph.
- **Shared keys** — state keys that exist in both schemas and flow between parent and child automatically.
- **Namespace** — the path identifying which (sub)graph produced a streamed event.
- **`Command.PARENT`** — target that lets a subgraph node route to a node in its parent.

## Interview quick-fire

- **"When would you use a subgraph?"** → To encapsulate a multi-step unit (a research team, a reviewer) with private state, reuse it, and test it on its own.
- **"Parent and child have different state schemas. How do you connect them?"** → Invoke the child inside a parent node function and map fields in and out.
- **"Where do you put the checkpointer?"** → On the parent only; subgraphs inherit it.
- **"What happens on resume after an interrupt in a subgraph?"** → The parent resumes and the subgraph node re-runs from its start, so pre-interrupt code must be safe to repeat.
