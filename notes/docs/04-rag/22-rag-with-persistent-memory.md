---
title: "RAG with Persistent Memory"
---

## TL;DR

A plain RAG chatbot forgets everything between requests. Persistent memory adds two layers: **short-term memory** (the conversation thread, saved by a LangGraph **checkpointer** under a `thread_id`) and **long-term memory** (facts about the user saved in a **store** and searched across threads). Each turn then retrieves from **two sources**: the document index and the user's memories. Persist to **SQLite or Postgres**, not RAM, so memory survives restarts.

## Kinds of memory

| Memory | Scope | Example | LangGraph tool |
|---|---|---|---|
| Short-term | One conversation (thread) | "it" refers to the plan named two turns ago | Checkpointer (`thread_id`) |
| Long-term | All conversations of a user | "User prefers answers in Hindi" | Store (`namespace`, key) |
| Knowledge | Everyone | Product docs | Vector store (your RAG index) |

```
user msg ─► load thread history (checkpointer)
            │
            ├─► search docs (vector store)
            ├─► search user memories (store)
            ▼
          generate answer ─► save new facts to store ─► save thread state
```

## Short-term memory: checkpointers

```python
import sqlite3
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.checkpoint.sqlite import SqliteSaver   # pip install langgraph-checkpoint-sqlite

llm = ChatOpenAI(model="gpt-4o-mini")

def chat(state: MessagesState):
    return {"messages": [llm.invoke(state["messages"])]}

g = StateGraph(MessagesState)
g.add_node("chat", chat)
g.add_edge(START, "chat")

conn = sqlite3.connect("memory.db", check_same_thread=False)
app = g.compile(checkpointer=SqliteSaver(conn))

cfg = {"configurable": {"thread_id": "user-42-session-1"}}
app.invoke({"messages": [("user", "I'm on the Pro plan.")]}, cfg)
app.invoke({"messages": [("user", "What's included in my plan?")]}, cfg)   # remembers "Pro"
```

The checkpointer saves the full state after every step. Same `thread_id` = same conversation, even after a restart. Use `InMemorySaver` for tests and a Postgres saver in production.

## Long-term memory: the store

```python
import uuid
from langchain_core.runnables import RunnableConfig
from langchain_openai import OpenAIEmbeddings
from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore
from langgraph.checkpoint.memory import InMemorySaver

store = InMemoryStore(index={"embed": OpenAIEmbeddings(model="text-embedding-3-small"),
                             "dims": 1536})

def search_docs(q: str) -> str:
    return "[relevant product doc chunks]"          # your RAG retriever

def rag_with_memory(state: MessagesState, config: RunnableConfig, *, store: BaseStore):
    user_id = config["configurable"]["user_id"]
    question = state["messages"][-1].content

    memories = store.search(("memories", user_id), query=question, limit=3)
    facts = "\n".join(m.value["fact"] for m in memories)

    system = (f"Known facts about the user:\n{facts}\n\n"
              f"Relevant docs:\n{search_docs(question)}\n\nAnswer using the docs.")
    reply = llm.invoke([("system", system), *state["messages"]])

    # naive memory writer: ask the model whether there is a durable fact worth saving
    fact = llm.invoke(f"Extract one durable fact about the user from: '{question}'. "
                      "Reply NONE if there isn't one.").content
    if fact.strip() != "NONE":
        store.put(("memories", user_id), str(uuid.uuid4()), {"fact": fact})
    return {"messages": [reply]}

g = StateGraph(MessagesState)
g.add_node("rag", rag_with_memory)
g.add_edge(START, "rag")
app = g.compile(checkpointer=InMemorySaver(), store=store)

app.invoke({"messages": [("user", "I'm a vegetarian, suggest a meal plan.")]},
           {"configurable": {"thread_id": "t1", "user_id": "u42"}})
# A new thread still knows the user is vegetarian:
app.invoke({"messages": [("user", "Any dinner ideas?")]},
           {"configurable": {"thread_id": "t2", "user_id": "u42"}})
```

Namespaces like `("memories", user_id)` keep users' memories separate. Swap `InMemoryStore` for a Postgres-backed store to persist.

## Keeping the thread small

Long threads blow up the context window. Options:

| Strategy | How |
|---|---|
| Trim | Keep the last N messages (`trim_messages`) |
| Summarize | Replace old turns with a running summary in state |
| Retrieve | Embed past turns and fetch only relevant ones |

## Gotchas and best practices

- **Never mix users.** Scope `thread_id` and store namespaces by user id; enforce it server-side, not from client input.
- **Be selective about what you save.** Saving every message creates noise; save durable facts and preferences.
- **Let users see and delete memories.** It's a privacy requirement in many regions.
- **Memories can go stale or conflict.** Store timestamps; prefer newer facts; update instead of append when keys match.
- **Write memories in the background** if latency matters, rather than in the hot path.

## Key terms

- **Short-term memory** — conversation history within one thread.
- **Long-term memory** — information kept across threads and sessions.
- **Checkpointer** — LangGraph component that saves graph state after each step, keyed by `thread_id`.
- **Store** — LangGraph key-value (optionally semantic) storage for cross-thread memory, organised by namespace.
- **Namespace** — a tuple like `("memories", user_id)` that groups stored items.

## Interview quick-fire

- **"Short-term vs. long-term memory in LangGraph?"** → Short-term is thread state saved by a checkpointer; long-term is a store shared across threads, usually per user.
- **"How do you persist memory across restarts?"** → Use a database-backed checkpointer and store (SQLite/Postgres), not in-memory ones.
- **"How do you stop the context window filling up?"** → Trim, summarize old turns, or retrieve only relevant past messages.
- **"What goes into long-term memory?"** → Durable user facts and preferences, extracted selectively, with timestamps.
