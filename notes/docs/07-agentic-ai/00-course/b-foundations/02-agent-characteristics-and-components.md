---
title: "Agent Characteristics and Components"
---

## TL;DR

An agent is defined by **what it does** (characteristics: autonomous, goal-driven, plans, adapts, uses tools) and **what it's made of** (components: an **LLM brain**, **tools**, **memory**, a **planner/loop**, and **guardrails**). Frameworks like LangChain and LangGraph are just different ways of wiring these components. If you can name each part in your system, you can debug it.

## Characteristics

| Characteristic | Meaning | In practice |
|---|---|---|
| Autonomy | Acts without a human driving each step | Picks tools and order itself |
| Goal-oriented | Works toward an outcome, not one reply | "Book a table", not "write a sentence" |
| Planning | Breaks a goal into steps | Writes a to-do list, or decides step by step |
| Reasoning | Chooses actions from context | "Search failed, try a different query" |
| Tool use | Acts on the world through functions | Search, code, APIs, databases |
| Memory | Keeps context across steps and sessions | Message history, saved facts |
| Adaptability | Changes course on new information | Retries, replans after an error |
| Context awareness | Uses the user, history and environment | Knows the user's timezone, prior orders |

## Components

```
                      ┌──────────── Guardrails ────────────┐
                      │                                    │
 user goal ──► Orchestrator / loop ──► LLM (brain) ──► decision
                      ▲                 │    ▲              │
                      │           reads │    │ writes       ▼
                      │            Memory ───┘         Tools (search, code, APIs)
                      │                                     │
                      └──────────── observation ◄───────────┘
```

| Component | Job | Examples |
|---|---|---|
| **LLM (brain)** | Reason, choose the next action, write the answer | `gpt-4o-mini`, Claude, Gemini, Llama |
| **Tools** | Get information or take action | Web search, SQL, calculator, email |
| **Memory** | Hold context | Short-term: messages in state. Long-term: a vector store or DB |
| **Planner** | Decide the sequence of steps | Implicit (ReAct) or an explicit plan step |
| **Orchestrator** | Run the loop, route, keep state, stop | A `while` loop, `create_agent`, a LangGraph graph |
| **Guardrails** | Keep it safe and bounded | Iteration caps, input/output checks, human approval |

## Short-term vs. long-term memory

| | Short-term | Long-term |
|---|---|---|
| Scope | One conversation / thread | Across sessions and users |
| Storage | Message list in state, saved by a checkpointer | Database, vector store, key-value store |
| Contents | Turns, tool calls, intermediate results | User preferences, facts, past outcomes |
| Problem | Grows until it overflows the context | Retrieving the right item at the right time |

## All components in one small agent

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver

@tool
def get_order_status(order_id: str) -> str:
    """Look up the shipping status of an order by its ID."""
    return {"A100": "shipped", "A101": "processing"}.get(order_id, "not found")

agent = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),         # brain
    tools=[get_order_status],                       # tools
    system_prompt="You are a support agent. Only discuss orders.",   # goal + soft guardrail
    checkpointer=InMemorySaver(),                   # short-term memory
)

config = {"configurable": {"thread_id": "user-42"}, "recursion_limit": 10}  # hard guardrail
agent.invoke({"messages": [{"role": "user", "content": "Where is order A100?"}]}, config)
reply = agent.invoke({"messages": [{"role": "user", "content": "And A101?"}]}, config)
print(reply["messages"][-1].content)      # remembers the context from the first turn
```

The orchestrator here is the graph that `create_agent` builds for you. In module E you build it yourself.

## Planning styles

- **Implicit (ReAct)** — decide one step at a time. Simple, adapts well, can wander on long tasks.
- **Plan-and-execute** — write a full plan first, then run each step. Better for long tasks; needs replanning when a step fails.
- **Reflection** — generate, critique, revise. Improves quality at the cost of extra calls.

## Design tips

- **Write tool descriptions for the model**, not for humans. They decide when tools get called.
- **Put rules in code, not only in prompts.** A prompt saying "never refund over $100" is a hint; a check in the tool is a rule.
- **Bound everything** — iterations, tokens, tool timeouts, wall-clock time.
- **Keep memory lean.** Trim or summarize old turns; store facts, not transcripts.

## Key terms

- **Brain** — the LLM that reasons and picks actions.
- **Tool** — a function the agent can call, described by a name, description and argument schema.
- **Short-term memory** — the working context of one thread, usually the message list.
- **Long-term memory** — information persisted across threads and sessions.
- **Orchestrator** — the control loop that calls the model, runs tools, updates state and stops.
- **Guardrail** — a check or limit that constrains what the agent may do.

## Interview quick-fire

- **"What are the core components of an AI agent?"** → An LLM to reason, tools to act, memory for context, a loop or planner to sequence steps, and guardrails to bound behavior.
- **"Short-term vs. long-term memory?"** → Short-term is the current thread's messages and state; long-term persists facts or preferences across sessions, usually in a database or vector store.
- **"Where should business rules live: prompt or code?"** → Code. Prompts guide; code enforces. Validate inside tools and gate risky actions.
- **"ReAct vs. plan-and-execute?"** → ReAct decides step by step and adapts easily; plan-and-execute plans up front, which is more efficient and predictable for long multi-step tasks.
