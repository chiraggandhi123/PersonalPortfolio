---
title: "Agent Memory (short-term vs Mem0/LangMem)"
---

## TL;DR

An LLM is stateless, so an agent's memory is **whatever you put back into the prompt**. **Short-term memory** is the current conversation (thread state, trimmed or summarized). **Long-term memory** is facts, preferences and past experiences stored outside the prompt and **retrieved when relevant**. Tools like **Mem0** and **LangMem** automate the hard part: deciding what to remember, updating it, and fetching it back.

## Types of memory

| Type | What it holds | Lifetime | Typical store |
|---|---|---|---|
| Short-term (working) | Messages and tool results of this thread | One conversation | In-process list, LangGraph checkpointer |
| Semantic | Facts: "user is vegetarian", "lives in Pune" | Across sessions | Vector DB / key-value store |
| Episodic | Past interactions or successful runs | Across sessions | Vector DB, used as few-shot examples |
| Procedural | How to behave: rules, refined system prompt | Across sessions | Prompt file, updated by reflection |

```
              ┌──────────── prompt sent to the LLM ────────────┐
user msg ──►  │ system prompt  (+ procedural rules)            │
              │ retrieved long-term memories  ◄── search store │
              │ recent messages (short-term, trimmed)          │
              └────────────────────────────────────────────────┘
                               │ after the reply
                               ▼
                 extract new facts ──► write to store
```

## Short-term memory in LangGraph

A **checkpointer** saves graph state after every step, keyed by `thread_id`. Same thread id, same conversation.

```python
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini"), tools=[], checkpointer=InMemorySaver())
cfg = {"configurable": {"thread_id": "user-42"}}

agent.invoke({"messages": [("user", "Hi, I'm Asha.")]}, cfg)
out = agent.invoke({"messages": [("user", "What's my name?")]}, cfg)
print(out["messages"][-1].content)      # "Your name is Asha."
```

Swap `InMemorySaver` for `SqliteSaver` or `PostgresSaver` in production. Long threads still overflow the context window, so **trim** (keep the last N messages, via `trim_messages`) or **summarize** older turns.

## Long-term memory with a store

LangGraph has a separate **store** for cross-thread memory, namespaced per user:

```python
from langgraph.store.memory import InMemoryStore

store = InMemoryStore(index={"embed": "openai:text-embedding-3-small", "dims": 1536})
ns = ("memories", "user-42")

store.put(ns, "diet", {"text": "User is vegetarian"})
store.put(ns, "city", {"text": "User lives in Pune"})

hits = store.search(ns, query="what food should I suggest?", limit=2)
print([h.value["text"] for h in hits])
```

You still need logic that decides *what* to save. That is what memory libraries add.

## Mem0

Mem0 extracts facts from a conversation with an LLM, de-duplicates and updates them, and stores them (vector DB, optionally a graph).

```python
from mem0 import Memory

m = Memory()   # defaults to OpenAI + a local vector store; configurable

m.add([{"role": "user", "content": "I'm vegetarian and allergic to nuts."}], user_id="asha")
results = m.search("dinner ideas", user_id="asha")
facts = "\n".join(r["memory"] for r in results["results"])
# put `facts` into the system prompt before calling the model
```

There is also a hosted version (`MemoryClient`). Return shapes have changed between versions, so check the docs for yours.

## LangMem

LangMem (from the LangChain team) works on top of a LangGraph store. It gives agents **tools to manage their own memory** (`create_manage_memory_tool`, `create_search_memory_tool`) and background "memory managers" that extract memories after a conversation. It also supports **procedural memory** via prompt optimization.

| | Mem0 | LangMem |
|---|---|---|
| Fits best with | Any framework or plain SDK calls | LangGraph agents |
| Extraction | Automatic on `add()` | Agent-driven tools or background manager |
| Hosting | Open source + managed service | Library over your own store |

## Gotchas and best practices

- **Retrieve, don't dump.** Inject only the few memories relevant to this turn.
- **Handle updates and conflicts.** "Moved to Bangalore" must replace "lives in Pune", not sit beside it.
- **Scope by user.** Namespaces or `user_id` on every read and write, or users leak into each other.
- **Privacy.** Memory is stored personal data: give users a way to view and delete it.
- **Don't save everything.** Raw transcripts are noisy. Save distilled facts.

## Key terms

- **Short-term memory** — the conversation state for a single thread.
- **Long-term memory** — information persisted across threads and retrieved on demand.
- **Checkpointer** — LangGraph component that saves graph state per `thread_id`.
- **Store** — LangGraph key-value/vector store for cross-thread memory.
- **Semantic / episodic / procedural memory** — facts / past experiences / behavioural rules.

## Interview quick-fire

- **"How do agents remember things?"** → Short-term by replaying thread history; long-term by storing extracted facts and retrieving relevant ones into the prompt.
- **"What do you do when the conversation exceeds the context window?"** → Trim old messages, summarize them into one message, and move durable facts into long-term memory.
- **"Why use Mem0 instead of a vector DB?"** → It handles extraction, de-duplication and updating facts, not just storage and search.
- **"How do you keep users' memories separate?"** → Key every memory by user id or namespace and filter on it at retrieval time.
