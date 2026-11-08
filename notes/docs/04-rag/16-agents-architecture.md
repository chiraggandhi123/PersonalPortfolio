---
title: "Agents Architecture"
---

## TL;DR

An agent is an **LLM in a loop** that decides which **tools** to call, looks at the results, and keeps going until it can answer. Every agent has the same four parts: a **model** (the brain), **tools** (the hands), **memory/state** (what it has seen so far) and a **control loop** (when to stop). The common architectures — **ReAct, router, plan-and-execute, reflection, supervisor** — are just different shapes of that loop. Pick the simplest shape that solves the task.

## The building blocks

| Part | What it does | Example |
|---|---|---|
| Model | Reasons and chooses the next action | `gpt-4o-mini` with tool calling |
| Tools | Functions the model can ask you to run | `search_docs`, `get_weather`, SQL query |
| State / memory | Messages and intermediate results | LangGraph state dict, chat history |
| Control loop | Runs model → tool → model until done | `while tool_calls:` or a graph |
| Guardrails | Limits on steps, cost, allowed actions | `recursion_limit`, allow-lists |

The tool loop itself is covered in [tool / function calling](../02-calling-models/05-tool-function-calling.md). Architecture is about how you arrange it.

## Common architectures

```
ReAct (single agent)            Router
  ┌──────────┐                    query ─► classify ─┬─► RAG chain
  │   LLM    │◄──┐                                   ├─► SQL chain
  └────┬─────┘   │                                   └─► plain LLM
       │ tool?   │ result
       ▼         │               Plan-and-execute
  ┌──────────┐   │                 planner ─► [step1, step2, step3]
  │  tools   │───┘                     executor runs each step ─► replan?
  └──────────┘
       │ no tool → answer          Supervisor (multi-agent)
                                     supervisor ─┬─► researcher agent
Reflection                                       ├─► writer agent
  generate ─► critique ─► revise                 └─► reviewer agent
```

| Pattern | When to use | Cost / risk |
|---|---|---|
| **Router** | A few known query types | Cheap, predictable, one LLM call to route |
| **ReAct** | Open-ended tasks with a few tools | Flexible; can loop or wander |
| **Plan-and-execute** | Long multi-step tasks | More calls; plan can go stale |
| **Reflection** | Quality matters more than latency | Doubles or triples calls |
| **Supervisor / multi-agent** | Distinct skills or tool sets | Hardest to debug; most tokens |

## A ReAct agent in LangGraph

```python
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.prebuilt import ToolNode, tools_condition

@tool
def search_docs(query: str) -> str:
    """Search the internal knowledge base."""
    return "Refunds are processed within the period stated in the refund policy."

@tool
def calculator(expression: str) -> str:
    """Evaluate a simple arithmetic expression like '12 * 7'."""
    return str(eval(expression, {"__builtins__": {}}))   # demo only

tools = [search_docs, calculator]
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

def agent(state: MessagesState):
    return {"messages": [llm.invoke(state["messages"])]}

graph = StateGraph(MessagesState)
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", tools_condition)   # tool call → "tools", else END
graph.add_edge("tools", "agent")
app = graph.compile()

out = app.invoke(
    {"messages": [("user", "How long do refunds take?")]},
    config={"recursion_limit": 10},                     # hard stop on runaway loops
)
print(out["messages"][-1].content)
```

LangGraph also ships a prebuilt version (`create_react_agent`, and `create_agent` in newer LangChain). Writing it by hand once shows you there is no magic: two nodes and a conditional edge.

## A router (often all you need)

```python
from typing import Literal
from pydantic import BaseModel

class Route(BaseModel):
    target: Literal["docs", "sql", "chitchat"]

router = ChatOpenAI(model="gpt-4o-mini").with_structured_output(Route)
route = router.invoke("What was revenue last quarter?").target   # → "sql"
```

A router is a deterministic workflow with one LLM decision. It is cheaper, faster and easier to test than a free-running agent.

## Workflow vs. agent

- **Workflow** — you fix the steps in code; the LLM fills in each step. Predictable.
- **Agent** — the LLM picks the steps at runtime. Flexible, but less predictable.

Start with a workflow. Move to an agent only when the steps genuinely can't be known in advance.

## Gotchas and best practices

- **Cap the loop.** Set a step or recursion limit and a token budget.
- **Few, well-described tools.** Tool descriptions are prompts. Ten overlapping tools confuse the model.
- **Return useful errors from tools** ("no rows found for 2019") so the model can recover instead of retrying blindly.
- **Trace everything.** Use LangSmith or similar; agent bugs are invisible without traces.
- **Human-in-the-loop for side effects.** Pause before sending emails, writing to databases or spending money.

## Key terms

- **Agent** — an LLM that chooses actions (tool calls) in a loop until a goal is met.
- **ReAct** — "reason + act": alternate thinking, tool calls and observations.
- **Router** — one LLM call that sends the input down one of several fixed paths.
- **Plan-and-execute** — a planner writes the steps, an executor carries them out.
- **Reflection** — the model critiques and revises its own output.
- **Supervisor** — an agent that delegates subtasks to other agents.

## Interview quick-fire

- **"What are the core components of an agent?"** → A model, tools, state/memory and a control loop, plus guardrails such as step limits.
- **"Workflow or agent?"** → Workflow when the steps are known; agent when the model must decide the path at runtime. Prefer the workflow.
- **"How do you stop an agent looping forever?"** → Recursion/step limits, token budgets, clear tool errors and a final "give up and answer" path.
- **"When would you use multi-agent?"** → When subtasks need different tools or prompts and one agent's context gets overloaded; not by default.
