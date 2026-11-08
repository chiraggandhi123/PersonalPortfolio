---
title: "Agentic Chatbot (LangGraph + LangSmith + RAG + HITL)"
---

## Goal

Build a chatbot that does more than talk. It **answers questions from your own documents** (RAG as a tool), **remembers conversations across restarts** (SQLite checkpointer), **pauses for human approval** before risky actions (human-in-the-loop with `interrupt`), and is **fully traced in LangSmith**. The course builds a similar bot step by step in [End-to-End Agentic Chatbot](../00-course/f-build-an-agentic-chatbot/09-end-to-end-agentic-chatbot-the-full-build.md). This note is the compact, standalone version.

**Skills practiced:** LangGraph `StateGraph`, retrieval as a tool, persistent threads, `interrupt` and `Command(resume=...)`, LangSmith tracing, document chunking and embeddings.

## Architecture

```
user ──► CLI / Streamlit ──► graph.invoke(msg, thread_id)
                                  │
                       ┌──────────▼──────────┐
                       │      chatbot        │ ◄──────────┐
                       │  (LLM + tools)      │            │
                       └──────────┬──────────┘            │
                     tool_calls?  │ no ──► END            │
                                  ▼                       │
                       ┌─────────────────────┐            │
                       │       tools         │────────────┘
                       │ search_docs (RAG)   │
                       │ send_email ── interrupt() ──► waits for human "yes/no"
                       └─────────────────────┘

SqliteSaver: every step checkpointed per thread_id (memory + resumable pauses)
LangSmith:   every LLM call, tool call and node traced automatically via env vars
```

## Setup

```bash
pip install langgraph langgraph-checkpoint-sqlite langchain-openai langchain-text-splitters python-dotenv
```

`.env` (LangSmith has a free tier; tracing switches on from these variables alone):

```
OPENAI_API_KEY=sk-...
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=agentic-chatbot
```

Put a few `.md` or `.txt` files (company FAQ, product docs) in `docs/`.

## Code — `chatbot.py`

```python
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_core.tools import tool
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command, interrupt

load_dotenv()

# --- RAG index (rebuilt at startup; use Chroma/pgvector to persist) ---
docs = [Document(p.read_text(), metadata={"source": p.name}) for p in Path("docs").glob("*.*")]
chunks = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100).split_documents(docs)
store = InMemoryVectorStore.from_documents(chunks, OpenAIEmbeddings(model="text-embedding-3-small"))


@tool
def search_docs(query: str) -> str:
    """Search the company knowledge base. Use for any question about our products or policies."""
    hits = store.similarity_search(query, k=4)
    return "\n\n".join(f"[{d.metadata['source']}] {d.page_content}" for d in hits)


@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email on the user's behalf. Requires human approval."""
    decision = interrupt({"action": "send_email", "to": to, "subject": subject, "body": body})
    if decision != "yes":
        return "The user rejected sending this email."
    return f"Email sent to {to}."          # call a real email API here


TOOLS = [search_docs, send_email]
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(TOOLS)
SYSTEM = ("You are a helpful assistant. Answer product questions only from search_docs results "
          "and cite the [source]. If the docs don't cover it, say so.")


def chatbot(state: MessagesState):
    return {"messages": [llm.invoke([("system", SYSTEM), *state["messages"]])]}


builder = StateGraph(MessagesState)
builder.add_node("chatbot", chatbot)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_edge(START, "chatbot")
builder.add_conditional_edges("chatbot", tools_condition)   # → "tools" or END
builder.add_edge("tools", "chatbot")

conn = sqlite3.connect("chat.db", check_same_thread=False)
graph = builder.compile(checkpointer=SqliteSaver(conn))


def run(payload, config):
    result = graph.invoke(payload, config)
    while "__interrupt__" in result:                       # graph paused for approval
        request = result["__interrupt__"][0].value
        print(f"\nAPPROVAL NEEDED: {request}")
        answer = input("Approve? (yes/no) ").strip().lower()
        result = graph.invoke(Command(resume=answer), config)
    return result["messages"][-1].content


if __name__ == "__main__":
    config = {"configurable": {"thread_id": input("thread id: ") or "default"}}
    while (text := input("\nyou> ").strip()) not in {"", "quit"}:
        print("bot>", run({"messages": [("user", text)]}, config))
```

Try: "What is the refund window?", then "Email that policy to sam@example.com". Restart the script with the same thread id and ask "What did we talk about?".

## How it works

1. **RAG as a tool** — instead of retrieving on every turn, the model decides when to call `search_docs`. Small talk skips retrieval, and multi-part questions can search twice. This is **agentic RAG**.
2. **The tool loop** — `tools_condition` routes to `ToolNode` when the model asks for a tool, then back to the chatbot to read the result.
3. **Persistence** — `SqliteSaver` checkpoints state after every step, keyed by `thread_id`. Memory survives restarts, and a paused graph can resume later, even from a different process.
4. **Human-in-the-loop** — `interrupt()` inside `send_email` stops the graph and saves its state. `invoke` returns with an `__interrupt__` entry. Resuming with `Command(resume="yes")` re-runs the tool node from the start, and this time `interrupt()` returns `"yes"`. Because the node re-runs, keep side effects **after** the interrupt call.
5. **Tracing** — with the LangSmith env vars set, every run appears as a tree: chatbot → tool calls → retriever → LLM, with inputs, outputs, latency and tokens. Use it to see why the bot gave a wrong answer: bad retrieval, or bad generation?

## Gotchas

- **The in-memory vector store re-embeds on every start.** Fine for a demo; persist it for real use.
- **Long threads grow forever.** Trim or summarise old messages before calling the LLM.
- **Interrupt resume needs the same `thread_id`.** A different id starts a fresh conversation.
- **Don't trace secrets or PII** in production without masking.

## Stretch goals

- [ ] **Streamlit UI** with a thread sidebar and Approve/Reject buttons for interrupts.
- [ ] **Stream tokens** with `graph.stream(..., stream_mode="messages")`.
- [ ] **Persistent vector store** — Chroma or pgvector, plus an ingest script.
- [ ] **Web search tool** for questions outside the docs.
- [ ] **LangSmith eval dataset** — 20 question/answer pairs scored for correctness and groundedness.
- [ ] **Postgres checkpointer** and a Docker deploy (Render or AWS).
- [ ] **Message trimming** with `trim_messages` to cap context size.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
