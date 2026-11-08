---
title: "Multi-Agent RAGs"
---

## TL;DR

Multi-agent RAG splits the work across **specialist agents**, each with its own **prompt, tools and knowledge source**, coordinated by a **supervisor** (or arranged as a pipeline). One agent might search policy docs, another query a SQL database, another check the web, and a writer combines their findings. It helps when one agent's context and tool list get too crowded. It costs more tokens and is harder to debug, so use it **only when a single agent struggles**.

## Why split into agents

| Problem with one agent | Multi-agent fix |
|---|---|
| 15 tools, model picks the wrong one | Each agent has 2–3 tools |
| One giant prompt for every domain | Focused prompt per specialist |
| Context fills with irrelevant chunks | Each agent returns a short summary |
| Hard to swap a component | Replace one agent independently |

## Common topologies

```
Supervisor                         Pipeline (sequential)
           ┌─► docs_agent ─┐         researcher ─► fact_checker ─► writer
 user ─► supervisor ◄──────┤
           ├─► sql_agent ──┤        Hierarchical
           └─► web_agent ──┘          top supervisor ─┬─► research team supervisor ─► agents
           │                                          └─► writing team supervisor ─► agents
           ▼ FINISH
         writer ─► answer
```

- **Supervisor** — one LLM routes to workers and decides when to finish. Most common.
- **Pipeline** — fixed order; really a workflow with agent steps.
- **Hierarchical** — supervisors of supervisors, for large systems.
- **Network / swarm** — agents hand off to each other directly. Flexible but harder to control.

## A supervisor RAG in LangGraph

```python
import operator
from typing import Annotated, Literal, TypedDict
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

class State(TypedDict):
    question: str
    findings: Annotated[list[str], operator.add]
    next: str
    answer: str

class Route(BaseModel):
    next: Literal["docs_agent", "sql_agent", "writer"]

def supervisor(state: State):
    r = llm.with_structured_output(Route).invoke(
        "You coordinate specialists: docs_agent (company documents), "
        "sql_agent (sales numbers). Choose the next worker, or 'writer' "
        f"when findings are enough.\nQuestion: {state['question']}\n"
        f"Findings so far: {state['findings']}")
    return {"next": r.next}

def docs_agent(state: State):
    context = "Policy: enterprise plans include priority support."   # your retriever here
    summary = llm.invoke(f"Summarize what this says about: {state['question']}\n{context}")
    return {"findings": [f"[docs] {summary.content}"]}

def sql_agent(state: State):
    rows = "region=EU, q3_revenue=1.2M"                               # your SQL tool here
    return {"findings": [f"[sql] {rows}"]}

def writer(state: State):
    msg = llm.invoke("Write the final answer from these findings, citing [docs]/[sql].\n"
                     + "\n".join(state["findings"]) + f"\nQuestion: {state['question']}")
    return {"answer": msg.content}

g = StateGraph(State)
g.add_node("supervisor", supervisor)
g.add_node("docs_agent", docs_agent)
g.add_node("sql_agent", sql_agent)
g.add_node("writer", writer)
g.add_edge(START, "supervisor")
g.add_conditional_edges("supervisor", lambda s: s["next"])
g.add_edge("docs_agent", "supervisor")
g.add_edge("sql_agent", "supervisor")
g.add_edge("writer", END)
app = g.compile()

out = app.invoke({"question": "What support do enterprise customers get, and how did EU revenue do in Q3?",
                  "findings": []}, config={"recursion_limit": 15})
print(out["answer"])
```

Each worker could itself be a full ReAct agent (a compiled subgraph) with its own tools. The supervisor only sees their short findings, which keeps its context small.

Ready-made helpers exist (e.g. the `langgraph-supervisor` package), but the hand-written graph above is easy to read and change.

## Passing information between agents

| Approach | Pros | Cons |
|---|---|---|
| Shared message list | Simple; full visibility | Context bloats fast |
| Shared state fields (`findings`) | Compact, structured | You design the schema |
| Handoff with summary | Clean boundaries | Details can be lost |

## Gotchas and best practices

- **Start single-agent.** Add agents only when evals show one agent failing.
- **Workers return summaries, not raw chunks**, to keep the supervisor's context lean.
- **Make the supervisor's options explicit** with a `Literal` route, never free text.
- **Guard against ping-pong.** Count visits per worker; force `writer` after N rounds.
- **Trace per agent.** Name nodes clearly so LangSmith traces show who did what.

## Key terms

- **Multi-agent system** — several LLM agents with separate roles that cooperate on a task.
- **Supervisor** — an agent that routes work to other agents and decides when to stop.
- **Worker / specialist** — an agent with a narrow role, prompt and tool set.
- **Handoff** — passing control (and context) from one agent to another.
- **Subgraph** — a compiled LangGraph graph used as a node inside another graph.

## Interview quick-fire

- **"Why multi-agent instead of one agent with many tools?"** → Smaller prompts and tool sets per agent improve tool choice and keep context focused; parts can be developed and tested separately.
- **"Main drawbacks?"** → More LLM calls and tokens, more latency, information lost in handoffs, harder debugging.
- **"How do agents share information?"** → Through shared graph state, a shared message list, or summarized handoffs.
- **"How do you prevent endless delegation?"** → Structured routing, visit counters, recursion limits and a forced finish path.
