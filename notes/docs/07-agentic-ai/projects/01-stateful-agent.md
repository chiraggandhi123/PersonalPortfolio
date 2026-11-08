---
title: "Stateful Agent (LangGraph + Llama 3)"
---

## Goal

Build a tool-using agent with LangGraph that runs **fully locally on Llama 3 via Ollama** and **remembers each conversation** through a checkpointer. You write the graph by hand (no prebuilt agent) so you see every piece: state, nodes, conditional edges and persistence.

**Skills practiced:** LangGraph `StateGraph`, message reducers, tool nodes, conditional routing, SQLite checkpointing, thread ids, running open models locally.

## Architecture

```
          ┌──────────┐
START ──► │  agent   │  Llama 3 (ChatOllama) with tools bound
          └────┬─────┘
               │ tools_condition
       tool calls?  ──yes──► ┌──────────┐
               │             │  tools   │  run calculator / notes tools
               no            └────┬─────┘
               ▼                  │
              END  ◄──────────────┘ (back to agent)

state = {"messages": [...]}  saved after every step by SqliteSaver, keyed by thread_id
```

## Setup

1. Install [Ollama](https://ollama.com) and pull a tool-capable model:

```bash
ollama pull llama3.1        # Llama 3.1+ supports tool calling; plain llama3 does not
```

2. Install:

```bash
pip install langgraph langchain-ollama langgraph-checkpoint-sqlite
```

No API keys needed. Optional `.env` if you want LangSmith tracing:

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
```

## Code — `agent.py`

```python
import sqlite3
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition

NOTES: list[str] = []


@tool
def calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression like '12 * (3 + 4)'."""
    allowed = set("0123456789+-*/(). ")
    if not set(expression) <= allowed:
        return "Error: only numbers and + - * / ( ) are allowed"
    return str(eval(expression))


@tool
def save_note(text: str) -> str:
    """Save a short note for the user."""
    NOTES.append(text)
    return f"Saved. You have {len(NOTES)} notes."


@tool
def list_notes() -> str:
    """List all saved notes."""
    return "\n".join(NOTES) or "No notes yet."


TOOLS = [calculator, save_note, list_notes]
llm = ChatOllama(model="llama3.1", temperature=0).bind_tools(TOOLS)
SYSTEM = SystemMessage("You are a concise assistant. Use tools for math and notes.")


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]   # reducer appends, never overwrites


def agent(state: State) -> dict:
    reply = llm.invoke([SYSTEM, *state["messages"][-20:]])   # trim to recent turns
    return {"messages": [reply]}


builder = StateGraph(State)
builder.add_node("agent", agent)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)   # → "tools" or END
builder.add_edge("tools", "agent")

conn = sqlite3.connect("memory.db", check_same_thread=False)
graph = builder.compile(checkpointer=SqliteSaver(conn))


def chat(thread_id: str):
    cfg = {"configurable": {"thread_id": thread_id}, "recursion_limit": 15}
    print(f"Thread '{thread_id}'. Type 'quit' to exit.")
    while (text := input("you> ")) != "quit":
        out = graph.invoke({"messages": [("user", text)]}, cfg)
        print("bot>", out["messages"][-1].content)


if __name__ == "__main__":
    chat(input("thread id: ") or "default")
```

Run `python agent.py`, chat, quit, and start again with the same thread id. The conversation is still there.

## How it works

1. **State** is a dict with one key, `messages`. The `add_messages` reducer means each node returns only *new* messages and LangGraph appends them.
2. **`agent` node** calls Llama 3 with the tools bound. If the model wants a tool, its reply contains `tool_calls`.
3. **`tools_condition`** checks the last message: tool calls go to the `tools` node, otherwise the graph ends.
4. **`ToolNode`** runs each requested tool and appends `ToolMessage` results, then the edge returns to `agent`.
5. **`SqliteSaver`** checkpoints the state after every node under the `thread_id`. Calling `invoke` with the same id resumes from the last checkpoint.
6. **`recursion_limit`** stops a model that keeps calling tools.

Inspect saved state with `graph.get_state(cfg).values["messages"]`, or walk history with `graph.get_state_history(cfg)`.

## Local-model tips

- Small models call tools less reliably than hosted ones. Keep tool names and docstrings very explicit and `temperature=0`.
- If the model answers math in its head instead of calling `calculator`, say "always use the calculator for arithmetic" in the system prompt.
- Try `qwen2.5` or `llama3.2` via Ollama for comparison; change one string.

## Stretch goals

- [ ] **Persist notes** in SQLite too, per thread, instead of a global list.
- [ ] **Summarize** old messages into a single system message when history passes 30 messages.
- [ ] **Streaming** with `graph.stream(..., stream_mode="messages")` for token-by-token output.
- [ ] **Human approval** before `save_note` using `interrupt()`.
- [ ] **Swap models** to `ChatOpenAI(model="gpt-4o-mini")` and compare tool-call accuracy.
- [ ] **Time travel** — replay from an earlier checkpoint with `get_state_history`.
- [ ] **Web UI** in Streamlit with a thread picker.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
