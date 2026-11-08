---
title: "Orchestrating RAG with LangGraph"
---

## TL;DR

Advanced RAG is a **graph, not a chain**: route the question, retrieve, grade, maybe rewrite and loop, generate, check, maybe loop again. **LangGraph** models this as a `StateGraph`: **typed state**, **nodes** that return partial updates, and **conditional edges** that pick the next node. Cycles are allowed, so production graphs need **explicit retry counters** in state plus a **recursion limit**, and they benefit from **checkpointers** (memory, resume), **streaming** and **tracing**.

## One graph combining the patterns

```
START ──► route_question ──┬── "sql"    ──► text2sql ─────────────────────────┐
                           ├── "direct" ──► answer_direct ────────────────────┤
                           └── "docs"   ──► retrieve ──► grade_docs            │
                                              ▲              │                 │
                                              │   enough? ───┼── no, retries left ──► rewrite ─┐
                                              └──────────────┼─────────────────────────────────┘
                                                             │ yes / retries exhausted
                                                             ▼
                                                         generate ──► check_answer
                                                             ▲             │
                                                             └── not grounded, tries left
                                                                           │ ok / give up
                                                                           ▼
                                                                          END ◄────────────────┘
```

## State design

```python
from typing import Annotated, Literal, TypedDict
import operator

class RAGState(TypedDict):
    question: str
    query: str                                   # current (possibly rewritten) search query
    route: Literal["docs", "sql", "direct"]
    docs: list[str]
    answer: str
    rewrites: int                                # loop counters live in state
    generations: int
    trace: Annotated[list[str], operator.add]    # reducer: appends instead of overwrites
```

- Nodes return **only the keys they change**.
- A **reducer** (`operator.add`) merges updates instead of replacing them. That's useful for logs and messages, and needed when parallel branches write the same key.
- Keep state **small and serialisable**: chunk text and ids, not live client objects.

## Nodes and routers

```python
MAX_REWRITES, MAX_GENERATIONS = 2, 2

def route_question(s: RAGState):
    route = classify(s["question"])              # structured-output LLM call → docs/sql/direct
    return {"route": route, "query": s["question"], "trace": [f"route={route}"]}

def retrieve(s: RAGState):
    return {"docs": [d.page_content for d in retriever.invoke(s["query"])], "trace": ["retrieve"]}

def grade_docs(s: RAGState):
    good = [d for d in s["docs"] if is_relevant(s["question"], d)]
    return {"docs": good, "trace": [f"graded {len(good)} relevant"]}

def rewrite(s: RAGState):
    return {"query": rewrite_query(s["question"]), "rewrites": s["rewrites"] + 1, "trace": ["rewrite"]}

def generate(s: RAGState):
    return {"answer": answer_from(s["question"], s["docs"]),
            "generations": s["generations"] + 1, "trace": ["generate"]}

def after_grade(s: RAGState) -> str:
    if s["docs"] or s["rewrites"] >= MAX_REWRITES:
        return "generate"                        # generate handles empty docs with "I don't know"
    return "rewrite"

def after_generate(s: RAGState) -> str:
    if is_grounded(s["answer"], s["docs"]) or s["generations"] >= MAX_GENERATIONS:
        return END
    return "generate"
```

## Building and running

```python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver

g = StateGraph(RAGState)
g.add_node("route_question", route_question)
g.add_node("retrieve", retrieve)
g.add_node("grade_docs", grade_docs)
g.add_node("rewrite", rewrite)
g.add_node("generate", generate)
g.add_node("text2sql", text2sql)
g.add_node("answer_direct", answer_direct)

g.add_edge(START, "route_question")
g.add_conditional_edges("route_question", lambda s: s["route"],
                        {"docs": "retrieve", "sql": "text2sql", "direct": "answer_direct"})
g.add_edge("retrieve", "grade_docs")
g.add_conditional_edges("grade_docs", after_grade, ["generate", "rewrite"])
g.add_edge("rewrite", "retrieve")
g.add_conditional_edges("generate", after_generate, ["generate", END])
g.add_edge("text2sql", END)
g.add_edge("answer_direct", END)

app = g.compile(checkpointer=InMemorySaver())     # use a SQLite/Postgres saver in prod

config = {"configurable": {"thread_id": "user-42"}, "recursion_limit": 20}
init = {"question": "What is our leave carry-over rule?", "rewrites": 0, "generations": 0, "trace": []}
for step in app.stream(init, config, stream_mode="updates"):
    print(step)                                   # one dict per node as it finishes
```

`recursion_limit` counts **super-steps**. Hitting it raises `GraphRecursionError`. Catch it and return a safe fallback instead of a 500 error.

## Production features

| Feature | How in LangGraph | Use for |
|---|---|---|
| Retry limits | Counters in state + router checks | Bounded loops |
| Recursion limit | `config["recursion_limit"]` | Safety net if a router has a bug |
| Node retries | `add_node(..., retry_policy=RetryPolicy(max_attempts=3))` | Transient API errors |
| Persistence | Checkpointer + `thread_id` | Conversation memory, resume after crash |
| Human in the loop | `interrupt()` inside a node, resume with `Command(resume=...)` | Approving SQL, sensitive answers |
| Streaming | `stream_mode="updates"` or `"messages"` | Progress UI, token streaming |
| Parallelism | Fan out with multiple edges or `Send` | Grading chunks, querying multiple indexes |
| Tracing | LangSmith or OpenTelemetry | Debugging which path ran and why |
| Visualisation | `app.get_graph().draw_mermaid()` | Docs and reviews |

## Gotchas

- **Forgetting to initialise counters** gives a `KeyError` in the router. Always pass them in the initial state, or give them defaults.
- **Overwriting lists** by accident: without a reducer, a node returning `docs` replaces the old list.
- **Routers should be pure** (read state, return a name). Put LLM calls in nodes so they're traced and retried.
- **Every loop needs an exit** that still produces an answer, even "I couldn't find this".
- **Unit-test nodes** as plain functions; test the graph with mocked LLM calls to cover each path.

For the basics, see [LangGraph basics](../04-rag/14-langgraph-basics.md).

## Key terms

- **StateGraph** — LangGraph's graph builder over a typed state.
- **Conditional edge** — an edge whose target is chosen by a router function at runtime.
- **Reducer** — a function that merges a node's update into existing state (e.g. append).
- **Super-step** — one round of node executions; the unit counted by the recursion limit.
- **Checkpointer** — persists state after each step, keyed by `thread_id`.
- **Interrupt** — pauses a graph for human input, then resumes.

## Interview quick-fire

- **"Why LangGraph over a LangChain chain for RAG?"** → It supports cycles, branching and persistent state, which corrective and self-reflective RAG need.
- **"How do you prevent infinite loops?"** → Counters in state checked by routers, plus `recursion_limit` as a backstop, and catching `GraphRecursionError`.
- **"What's a reducer?"** → It defines how updates merge into a state key, e.g. appending to a list instead of overwriting.
- **"How do you add human approval before running generated SQL?"** → An `interrupt()` in the node with a checkpointer, then resume with the user's decision.
