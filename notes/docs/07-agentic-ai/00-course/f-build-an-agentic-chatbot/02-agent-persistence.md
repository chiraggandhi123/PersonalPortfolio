---
title: "Agent Persistence"
---

## TL;DR

A **checkpointer** saves the graph's state after every step, keyed by a **`thread_id`**. Pass the same `thread_id` and the chatbot picks up where it left off; pass a new one and it starts fresh. Use **`InMemorySaver`** for experiments and **`SqliteSaver`** (or Postgres) so conversations **survive restarts**. Persistence is also what makes streaming threads, human-in-the-loop and time travel possible later in this module.

## How it works

```
invoke(input, config={"configurable": {"thread_id": "abc"}})
   │
   ├─ load latest checkpoint for "abc"  ──► state = previous messages
   ├─ merge input with reducers         ──► + new HumanMessage
   ├─ run chat_node                     ──► + AIMessage
   └─ save new checkpoint for "abc"     (one per super-step)
```

| Term | Meaning |
|---|---|
| Thread | One conversation, identified by `thread_id` |
| Checkpoint | A snapshot of state at one step of a thread |
| Checkpointer | The storage backend for checkpoints |

## Checkpointer options

| Checkpointer | Package | Survives restart | Use for |
|---|---|---|---|
| `InMemorySaver` | `langgraph` | No | Notebooks, tests |
| `SqliteSaver` | `langgraph-checkpoint-sqlite` | Yes | Local apps, a single server |
| `PostgresSaver` | `langgraph-checkpoint-postgres` | Yes | Production, several servers (note 08) |

## Step 1: in memory

```python
from langgraph.checkpoint.memory import InMemorySaver

chatbot = builder.compile(checkpointer=InMemorySaver())

config = {"configurable": {"thread_id": "asha-1"}}
chatbot.invoke({"messages": [HumanMessage("Hi, I'm Asha.")]}, config)
r = chatbot.invoke({"messages": [HumanMessage("What's my name?")]}, config)
print(r["messages"][-1].content)       # "Your name is Asha."

other = {"configurable": {"thread_id": "someone-else"}}
r = chatbot.invoke({"messages": [HumanMessage("What's my name?")]}, other)
print(r["messages"][-1].content)       # doesn't know: separate thread
```

You now pass **only the new message**. The checkpointer supplies the history.

## Step 2: SQLite — updated `backend.py`

```bash
pip install langgraph-checkpoint-sqlite
```

```python
import os
import sqlite3
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

load_dotenv()

llm = ChatOpenAI(model="gpt-4o-mini")
SYSTEM = SystemMessage("You are a helpful assistant. Keep answers concise.")


class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def chat_node(state: ChatState) -> dict:
    return {"messages": [llm.invoke([SYSTEM, *state["messages"]])]}


# check_same_thread=False: web UIs (Streamlit, FastAPI) call from several threads
conn = sqlite3.connect(os.getenv("CHATBOT_DB", "chatbot.db"), check_same_thread=False)
checkpointer = SqliteSaver(conn)

builder = StateGraph(ChatState)
builder.add_node("chat_node", chat_node)
builder.add_edge(START, "chat_node")
builder.add_edge("chat_node", END)
chatbot = builder.compile(checkpointer=checkpointer)


if __name__ == "__main__":
    config = {"configurable": {"thread_id": input("thread id: ") or "default"}}
    while (text := input("you: ")) not in {"exit", "quit"}:
        result = chatbot.invoke({"messages": [HumanMessage(text)]}, config)
        print("bot:", result["messages"][-1].content)
```

Run it, tell it your name, quit, run it again with the same thread id, and ask your name. The answer comes from `chatbot.db`. The DB path comes from `CHATBOT_DB` so Docker can point it at a mounted volume later.

## Inspecting state

```python
config = {"configurable": {"thread_id": "asha-1"}}

snapshot = chatbot.get_state(config)
print(len(snapshot.values["messages"]))        # current messages
print(snapshot.next)                           # () when the run finished

for cp in chatbot.get_state_history(config):   # newest first
    print(cp.config["configurable"]["checkpoint_id"], len(cp.values.get("messages", [])))
```

- **`get_state`** — latest snapshot: `values`, `next` (nodes still to run), `tasks`, `config`.
- **`get_state_history`** — every checkpoint, which enables **time travel**: invoke with an older `checkpoint_id` to branch from that point.
- **`update_state`** — edit state by hand (fix a message, inject a note), recorded as a new checkpoint.

## Gotchas

- **No `thread_id`, no memory.** With a checkpointer, `invoke` without `configurable.thread_id` raises an error.
- **History grows forever.** Every turn resends the whole thread to the model. Trim or summarize long threads (`trim_messages` in `langchain_core.messages`).
- **SQLite is single-machine.** Two containers can't share a local SQLite file safely. Use Postgres when you scale out.
- **`InMemorySaver` in production** loses every conversation on redeploy.
- **Use async savers in async apps.** `AsyncSqliteSaver` / `AsyncPostgresSaver` with `ainvoke` and `astream`.
- **Thread ids are not auth.** Anyone who guesses one can read the thread. Map threads to authenticated users in your app.

## Key terms

- **Checkpointer** — saves graph state after each step so runs can resume.
- **Thread** — a sequence of checkpoints for one conversation, keyed by `thread_id`.
- **Checkpoint** — a snapshot of state plus metadata at one step.
- **StateSnapshot** — what `get_state` returns: values, next nodes, pending tasks, config.
- **Time travel** — replaying or forking a thread from an earlier checkpoint.

## Interview quick-fire

- **"How does a LangGraph chatbot remember conversations?"** → A checkpointer saves state per `thread_id`; each call loads the latest checkpoint, adds the new input and saves again.
- **"InMemorySaver vs. SqliteSaver vs. PostgresSaver?"** → Memory for tests, SQLite for a single local server, Postgres for durable, multi-instance production.
- **"What is a thread?"** → One conversation's history of checkpoints, selected by `thread_id` in the config.
- **"What else does persistence enable?"** → Human-in-the-loop pauses, resuming after failures, and time travel through past states.
