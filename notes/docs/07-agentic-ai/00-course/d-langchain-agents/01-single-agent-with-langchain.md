---
title: "Single Agent with LangChain"
---

## TL;DR

LangChain's **`create_agent`** builds a complete tool-calling agent from three things: a **model**, a list of **tools**, and a **system prompt**. Under the hood it's the same loop you'd write by hand (model → tool calls → results → model), running on a small LangGraph graph. Define tools with **`@tool`**, add a **checkpointer** for memory, **stream** to see each step, and cap runs with **`recursion_limit`**.

## What `create_agent` builds

```
          ┌────────────────────────────────┐
          ▼                                │
START ──► model ──── tool calls? ──yes──► tools
            │
            no
            ▼
           END
```

It replaces the older `AgentExecutor`, `initialize_agent` and `create_react_agent` patterns from LangChain 0.x. The result is a compiled graph, so it supports `invoke`, `stream`, async, checkpointers and interrupts.

## Setup

```bash
pip install langchain langchain-openai langchain-tavily python-dotenv
```

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
```

## A research-and-calculate agent

```python
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_tavily import TavilySearch

load_dotenv()

@tool
def calculator(expression: str) -> str:
    """Evaluate an arithmetic expression like '(120 * 1.18) / 3'. Use for any math."""
    allowed = set("0123456789+-*/(). ")
    if not set(expression) <= allowed:
        return "Error: only numbers and + - * / ( ) are allowed"
    return str(eval(expression))

search = TavilySearch(max_results=3)      # web search tool, ready-made

agent = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini", temperature=0),
    tools=[search, calculator],
    system_prompt=(
        "You are a precise research assistant. Search for facts you don't know, "
        "use the calculator for arithmetic, and cite the source URL."
    ),
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "What is the population of Japan divided by 47?"}]},
    {"recursion_limit": 10},
)
print(result["messages"][-1].content)
```

You can also pass the model as a string: `model="openai:gpt-4o-mini"`.

## Seeing the steps

```python
for step in agent.stream(
    {"messages": [{"role": "user", "content": "Population of Japan / 47?"}]},
    stream_mode="updates",
):
    for node, update in step.items():
        msg = update["messages"][-1]
        print(f"[{node}]", msg.tool_calls or msg.content)
```

Typical output: `[model]` with a search tool call, `[tools]` with results, `[model]` with a calculator call, `[tools]`, `[model]` with the final answer. Use `stream_mode="messages"` to stream tokens instead.

## Memory across turns

```python
from langgraph.checkpoint.memory import InMemorySaver

agent = create_agent(model="openai:gpt-4o-mini", tools=[calculator],
                     checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "alice"}}

agent.invoke({"messages": [{"role": "user", "content": "I have 3 boxes of 12 eggs."}]}, config)
r = agent.invoke({"messages": [{"role": "user", "content": "How many eggs total?"}]}, config)
print(r["messages"][-1].content)    # uses the first turn
```

Each `thread_id` is a separate conversation. Module F covers persistent checkpointers.

## Structured final answers

```python
from pydantic import BaseModel

class Answer(BaseModel):
    answer: str
    sources: list[str]

agent = create_agent(model="openai:gpt-4o-mini", tools=[search], response_format=Answer)
r = agent.invoke({"messages": [{"role": "user", "content": "Who founded LangChain?"}]})
print(r["structured_response"])     # an Answer instance
```

## Writing good tools

- **Docstring = description.** The model chooses tools from it. Say when to use the tool and what input looks like.
- **Type hints = schema.** `def f(city: str, days: int)` becomes a JSON schema.
- **Return strings or small JSON.** Truncate long results.
- **Return errors, don't raise.** "Error: city not found" lets the agent retry.
- **Two to five tools** for one agent. Past that, consider splitting into several agents.

## Gotchas

- **`GraphRecursionError`** means the loop hit `recursion_limit`. Usually a vague tool description or a tool that keeps failing.
- **Old tutorials** use `AgentExecutor` and `hub.pull("hwchase17/react")`. That API is legacy.
- **`eval` is dangerous.** The whitelist above is a minimum; use a proper math parser in production.
- **Temperature 0** makes tool choice more repeatable, not deterministic.

## Key terms

- **`create_agent`** — LangChain function that returns a compiled tool-calling agent graph.
- **`@tool`** — decorator that turns a Python function into a tool, using its docstring and type hints.
- **System prompt** — instructions that set the agent's role and rules.
- **`recursion_limit`** — maximum number of graph steps before the run is stopped.
- **`response_format`** — schema for a structured final answer from the agent.
- **Thread** — one conversation, identified by `thread_id` in the config.

## Interview quick-fire

- **"What does `create_agent` do?"** → It wires a chat model and tools into a loop graph: call the model, run any requested tools, feed results back, stop when the model answers without tool calls.
- **"How does the agent decide which tool to call?"** → From tool names, docstrings and argument schemas, plus the system prompt.
- **"How do you stop an agent looping forever?"** → Set `recursion_limit`, write clear tool descriptions, and return helpful errors from tools.
- **"How do you give a LangChain agent memory?"** → Pass a checkpointer and a `thread_id` in the config; the message history is saved per thread.
