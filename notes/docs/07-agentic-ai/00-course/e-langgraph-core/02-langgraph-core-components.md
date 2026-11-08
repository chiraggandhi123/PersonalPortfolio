---
title: "LangGraph Core Components"
---

## TL;DR

A LangGraph app has four parts: a **state** schema (the shared data), **nodes** (functions that read state and **return updates**), **edges** (fixed or **conditional** transitions), and **compile** (which turns the builder into a runnable graph, optionally with a **checkpointer**). **Reducers** decide how updates merge into state; `add_messages` appends chat messages instead of overwriting them. Learn these and every LangGraph agent becomes readable.

## The mental model

```
            state (shared dict)
     ┌──────────────┬──────────────┐
     ▼              ▼              ▼
START ──► node A ──► node B ──router──► node C ──► END
          returns    returns   │
          updates    updates   └──► node B   (loop)
```

Each step: run the node, merge its returned dict into state using reducers, follow edges to the next node(s).

## 1. State

```python
from typing import Annotated, TypedDict
from operator import add
from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]   # append, update by message id
    steps: Annotated[list[str], add]                      # concatenate lists
    topic: str                                            # no reducer: overwrite
```

| Reducer | Behavior | Use for |
|---|---|---|
| none (default) | New value replaces old | Single values: status, counters you set |
| `operator.add` | Concatenates lists / adds numbers | Logs, results from parallel branches |
| `add_messages` | Appends messages; replaces one with the same `id` | Chat history |

Shortcut for chat apps: `from langgraph.graph import MessagesState` gives you the `messages` field with `add_messages` already set; subclass it to add fields.

## 2. Nodes

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini")

def chat(state: State) -> dict:
    reply = llm.invoke(state["messages"])
    return {"messages": [reply], "steps": ["chat"]}     # only the keys you change
```

- A node is any function (sync or async) taking the state.
- Return a **partial update**, not the whole state.
- Never mutate `state` in place; return new values.

## 3. Edges

```python
from typing import Literal
from langgraph.graph import StateGraph, START, END

def route(state: State) -> Literal["tools", "__end__"]:
    last = state["messages"][-1]
    return "tools" if getattr(last, "tool_calls", None) else END

builder = StateGraph(State)
builder.add_node("chat", chat)
builder.add_node("tools", lambda s: {"steps": ["tools"]})   # placeholder
builder.add_edge(START, "chat")                  # normal edge
builder.add_conditional_edges("chat", route)     # router picks next node
builder.add_edge("tools", "chat")                # loop back
```

| Edge type | API | When |
|---|---|---|
| Normal | `add_edge("a", "b")` | Always go a → b |
| Conditional | `add_conditional_edges("a", fn)` | `fn(state)` returns the next node name(s) |
| Entry / exit | `START`, `END` | Where the graph begins and stops |
| Fan-out | Several edges from one node, or a router returning a list | Run nodes in parallel |

## 4. Compile and run

```python
from langgraph.checkpoint.memory import InMemorySaver

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "t1"}}

out = graph.invoke({"messages": [("user", "Hi, I'm Asha")], "steps": [], "topic": "intro"}, config)
print(out["messages"][-1].content, out["steps"])

print(graph.get_graph().draw_mermaid())          # diagram of the graph
```

`compile()` validates the graph (no dangling nodes) and returns a Runnable: `invoke`, `stream`, `ainvoke`, `astream`.

## Command and Send

Two tools for dynamic control flow:

```python
from langgraph.types import Command, Send

# Command: update state AND choose the next node from inside a node
def check(state: State) -> Command[Literal["chat", "__end__"]]:
    done = len(state["steps"]) > 5
    return Command(update={"steps": ["check"]}, goto=END if done else "chat")

# Send: fan out to the same node with different inputs (map step)
def fan_out(state: dict):
    return [Send("summarize", {"doc": d}) for d in state["docs"]]
# builder.add_conditional_edges("split", fan_out)
```

## Streaming modes

| `stream_mode` | Yields |
|---|---|
| `"values"` | Full state after each step |
| `"updates"` | Only what each node returned |
| `"messages"` | LLM tokens as they're generated, with node metadata |
| `"custom"` | Anything a node writes with `get_stream_writer()` |

## Gotchas

- **Missing reducer on a list** means a node's update overwrites the list. Parallel branches writing the same key without a reducer raise an error.
- **Returning the whole state** with `add_messages` duplicates nothing (same ids), but with `operator.add` it doubles the list.
- **Infinite loops** stop at `recursion_limit` (default 25) with `GraphRecursionError`.
- **Router return values** must match node names exactly, or use a mapping dict as the third argument.

## Key terms

- **State** — the shared, typed data every node reads and updates.
- **Reducer** — a function that merges a node's update into the existing state value.
- **`add_messages`** — reducer that appends chat messages and replaces ones with matching ids.
- **Conditional edge** — an edge whose target is chosen at run time by a routing function.
- **Command** — a node return type that combines a state update with a `goto`.
- **Send** — schedules a node with custom input, used for map-style fan-out.
- **Super-step** — one round of executing all nodes that are ready, in parallel.

## Interview quick-fire

- **"What are the building blocks of a LangGraph app?"** → State, nodes, edges (including conditional ones) and compilation, optionally with a checkpointer.
- **"What is a reducer and why does it matter?"** → It defines how node outputs merge into state. Without `add_messages`, each reply would overwrite the chat history.
- **"Conditional edge vs. Command?"** → A conditional edge routes from outside the node with a separate function; `Command` lets the node itself update state and choose where to go.
- **"How do you run nodes in parallel?"** → Add edges from one node to several, or return a list of `Send` objects; results merge with reducers.
