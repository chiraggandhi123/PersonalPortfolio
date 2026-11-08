---
title: "Conversation Memory"
---

## TL;DR

LLM APIs are **stateless**: the model remembers nothing between calls, so "memory" means **you resend the relevant history every time**. The main strategies are **full history**, a **sliding window** of recent turns, a **running summary** of older turns, and **long-term memory** (facts or past messages stored and retrieved). Pick based on conversation length, cost and how much the old context matters.

## Why memory is your job

```
Call 1:  [system, user: "I'm Riya"]                       → "Hi Riya!"
Call 2:  [system, user: "What's my name?"]                → "I don't know."   ✗ no history
Call 2:  [system, user: "I'm Riya", assistant: "Hi Riya!",
          user: "What's my name?"]                         → "Riya."           ✓
```

Every token of history costs money and latency on every call, and the context window is finite.

## Strategies

| Strategy | How | Good for | Trade-off |
|---|---|---|---|
| Full history | Send every message | Short chats | Cost grows each turn; eventually overflows |
| Sliding window | Last N messages or last N tokens | Most chatbots | Forgets early details |
| Summary | Summarise old turns into one message | Long sessions | Summary loses detail; extra LLM call |
| Summary + window | Summary of old + recent turns verbatim | Long, detail-heavy chats | A bit more code |
| Long-term memory | Store facts/messages, retrieve relevant ones | Multi-session assistants | Needs storage and retrieval |

## Sliding window by tokens

Counting messages is easy; counting tokens is safer.

```python
import tiktoken
from openai import OpenAI

client = OpenAI()
enc = tiktoken.get_encoding("o200k_base")     # tokenizer used by gpt-4o models

def n_tokens(msg: dict) -> int:
    return len(enc.encode(msg["content"])) + 4    # rough per-message overhead

def window(history: list[dict], budget: int = 3000) -> list[dict]:
    kept, total = [], 0
    for msg in reversed(history):                 # newest first
        total += n_tokens(msg)
        if total > budget:
            break
        kept.append(msg)
    kept.reverse()
    while kept and kept[0]["role"] != "user":     # don't start on an orphan reply
        kept.pop(0)
    return kept
```

## Summary + window

```python
SYSTEM = "You are a helpful assistant."
KEEP_RECENT = 8

class Memory:
    def __init__(self):
        self.summary = ""
        self.messages: list[dict] = []

    def add(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})
        if len(self.messages) > KEEP_RECENT * 2:
            self._compress()

    def _compress(self):
        old, self.messages = self.messages[:-KEEP_RECENT], self.messages[-KEEP_RECENT:]
        transcript = "\n".join(f"{m['role']}: {m['content']}" for m in old)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content":
                f"Update this summary with the new conversation. Keep names, decisions, "
                f"preferences and open questions. Max 150 words.\n\n"
                f"Summary so far:\n{self.summary}\n\nNew conversation:\n{transcript}"}],
        )
        self.summary = resp.choices[0].message.content

    def build(self) -> list[dict]:
        system = SYSTEM + (f"\n\nSummary of earlier conversation:\n{self.summary}" if self.summary else "")
        return [{"role": "system", "content": system}, *self.messages]
```

Use `memory.build()` as the `messages` argument on each call.

## Long-term memory

For assistants that should remember across sessions:

```
user msg ─► extract facts ("prefers vegetarian", "lives in Pune") ─► store (DB / vector store)
next session ─► retrieve facts relevant to the new message ─► add to system prompt
```

- **Profile facts** in a simple key-value table work well and are easy to inspect and delete.
- **Episodic memory** (past messages) needs embeddings and similarity search, the same machinery as RAG.
- Tools such as Mem0, LangGraph stores and Letta package this up. Agents take it further in [agent memory](../07-agentic-ai/02-agent-memory.md).

## Memory in LangGraph

LangChain's older `ConversationBufferMemory` classes are deprecated. The current approach is a **checkpointer** that saves graph state per `thread_id`:

```python
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, MessagesState, START
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini")

def chat(state: MessagesState):
    return {"messages": [llm.invoke(state["messages"])]}

graph = StateGraph(MessagesState)
graph.add_node("chat", chat)
graph.add_edge(START, "chat")
app = graph.compile(checkpointer=InMemorySaver())

cfg = {"configurable": {"thread_id": "user-42"}}
app.invoke({"messages": [("user", "I'm Riya")]}, cfg)
out = app.invoke({"messages": [("user", "What's my name?")]}, cfg)
print(out["messages"][-1].content)   # Riya
```

Swap `InMemorySaver` for a SQLite or Postgres checkpointer to survive restarts.

## Gotchas

- **One history per user/session.** A shared global list leaks conversations between users.
- **Trim without breaking pairs.** Never keep a `tool` result without its `assistant` tool call; the API rejects it.
- **Summaries drift.** Repeated summarising loses or distorts facts. Keep critical facts (names, IDs, decisions) in structured fields.
- **Privacy.** Stored memory is personal data. Let users view and clear it, and set retention limits.

## Key terms

- **Stateless API** — each request is independent; the server keeps no conversation state.
- **Sliding window** — keeping only the most recent messages or tokens.
- **Summary memory** — compressing older turns into a short summary message.
- **Long-term memory** — facts or messages persisted across sessions and retrieved when relevant.
- **Checkpointer** — LangGraph component that saves state per thread so conversations can resume.

## Interview quick-fire

- **"How does a chatbot remember previous messages?"** → It doesn't; the app resends the relevant history with each request.
- **"How do you handle conversations longer than the context window?"** → Sliding window plus a running summary, and retrieve older details from storage when needed.
- **"Window vs. summary memory?"** → Window keeps exact recent text but forgets older turns; summary keeps the gist of everything but loses detail and costs an extra call.
- **"How do you keep users' memories separate?"** → Key the history by user or session ID (a `thread_id`), never a shared global.
