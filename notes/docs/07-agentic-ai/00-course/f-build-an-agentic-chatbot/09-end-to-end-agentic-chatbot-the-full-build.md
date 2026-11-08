---
title: "End-to-End Agentic Chatbot: The Full Build"
---

## Goal

Put every piece from this module into one deployable app: a LangGraph chatbot with **persistent threads**, **token streaming**, **web search and utility tools**, **human approval before sending email**, **LangSmith tracing**, and a **Docker image** that runs locally, on AWS, or on Render. This note is the complete reference version of `backend.py` and `app.py`.

**Skills practiced:** LangGraph state and reducers, checkpointers (SQLite and Postgres), streaming, tool calling with `ToolNode`, `interrupt()` and `Command(resume=...)`, LangSmith metadata, Streamlit, Docker, CI/CD.

## Architecture

```
 Browser ──► Streamlit app.py ──────────────────────────────┐
   ▲          │ sidebar: threads (from checkpointer)         │
   │          │ history: load_messages(thread_id)            │
   │          │ Approve / Reject  ─► Command(resume=...)     │
   │          ▼                                              │
   │   chatbot.stream(input, config, stream_mode="messages") │
   │          │                                              │
   │   ┌──────▼──────── LangGraph (backend.py) ────────┐     │
   │   │ START ─► chat_node ──tools_condition──► END    │     │
   │   │             ▲              │                   │     │
   │   │             └──── tools ◄──┘                   │     │
   │   │   search · calculator · datetime · send_email  │     │
   │   │                         (interrupt for approval)│    │
   │   └──────────┬─────────────────────────────────────┘     │
   │              ▼                                           │
   │   checkpointer: SQLite file  or  Postgres (DATABASE_URL) │
   │                                                          │
   └── tokens ◄────────── LangSmith traces every run ◄────────┘
```

## Setup

```bash
pip install langgraph langgraph-checkpoint-sqlite langgraph-checkpoint-postgres "psycopg[binary]" \
            langchain-openai langchain-tavily langsmith streamlit python-dotenv pytest
```

`.env` (in `.gitignore` and `.dockerignore`):

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=agentic-chatbot
# DATABASE_URL=postgresql://...   # set on Render; omit locally to use SQLite
```

## Code — `backend.py`

```python
import os
import sqlite3
from datetime import datetime
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_tavily import TavilySearch
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import interrupt

load_dotenv()

SYSTEM = SystemMessage(
    "You are a helpful assistant. Keep answers concise. Use tools for current facts, "
    "math and the date, and cite URLs from search. Draft emails clearly before sending."
)

# ---------- tools ----------
search = TavilySearch(max_results=3)

@tool
def calculator(expression: str) -> str:
    """Evaluate an arithmetic expression like '(120 * 1.18) / 3'. Use for any math."""
    if not set(expression) <= set("0123456789+-*/(). "):
        return "Error: only numbers and + - * / ( ) are allowed"
    try:
        return str(eval(expression))
    except Exception as e:
        return f"Error: {e}"

@tool
def get_current_datetime() -> str:
    """Return the current date and time. Use for questions about today, now or dates."""
    return datetime.now().strftime("%A %d %B %Y, %H:%M")

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email. A human must approve it before it is sent."""
    decision = interrupt({"action": "send_email", "to": to, "subject": subject, "body": body})
    if decision != "approve":
        return "The user rejected this email. Ask what they want to change."
    return f"Email sent to {to}."            # call your email provider here

tools = [search, calculator, get_current_datetime, send_email]
llm_with_tools = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools, parallel_tool_calls=False)

# ---------- persistence ----------
def make_checkpointer():
    if db_url := os.getenv("DATABASE_URL"):
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg import Connection
        from psycopg.rows import dict_row
        conn = Connection.connect(db_url, autocommit=True, prepare_threshold=0, row_factory=dict_row)
        saver = PostgresSaver(conn)
        saver.setup()
        return saver
    conn = sqlite3.connect(os.getenv("CHATBOT_DB", "chatbot.db"), check_same_thread=False)
    return SqliteSaver(conn)

checkpointer = make_checkpointer()

# ---------- graph ----------
class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

def chat_node(state: ChatState) -> dict:
    return {"messages": [llm_with_tools.invoke([SYSTEM, *state["messages"]])]}

builder = StateGraph(ChatState)
builder.add_node("chat_node", chat_node)
builder.add_node("tools", ToolNode(tools))
builder.add_edge(START, "chat_node")
builder.add_conditional_edges("chat_node", tools_condition)
builder.add_edge("tools", "chat_node")
chatbot = builder.compile(checkpointer=checkpointer)

# ---------- helpers for the UI ----------
def _cfg(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}

def retrieve_all_threads() -> list[str]:
    seen: list[str] = []
    for cp in checkpointer.list(None):
        tid = cp.config["configurable"]["thread_id"]
        if tid not in seen:
            seen.append(tid)
    return seen

def load_messages(thread_id: str) -> list[BaseMessage]:
    return chatbot.get_state(_cfg(thread_id)).values.get("messages", [])

def pending_interrupt(thread_id: str) -> dict | None:
    for task in chatbot.get_state(_cfg(thread_id)).tasks:
        if task.interrupts:
            return task.interrupts[0].value
    return None
```

## Code — `app.py`

```python
import uuid

import streamlit as st
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langgraph.types import Command

from backend import chatbot, load_messages, pending_interrupt, retrieve_all_threads

st.set_page_config(page_title="Agentic Chatbot")

if "thread_id" not in st.session_state:
    st.session_state.thread_id = str(uuid.uuid4())
thread_id = st.session_state.thread_id
config = {
    "configurable": {"thread_id": thread_id},
    "metadata": {"thread_id": thread_id},       # LangSmith groups traces by thread
    "run_name": "chat_turn",
}

# --- sidebar: threads, titled by their first message ---
st.sidebar.title("Conversations")
if st.sidebar.button("New chat"):
    st.session_state.thread_id = str(uuid.uuid4())
    st.rerun()
for tid in retrieve_all_threads():
    msgs = load_messages(tid)
    label = msgs[0].content[:30] if msgs else tid[:8]
    if st.sidebar.button(label, key=tid, disabled=tid == thread_id):
        st.session_state.thread_id = tid
        st.rerun()

# --- history from the checkpointer ---
for msg in load_messages(thread_id):
    if isinstance(msg, HumanMessage):
        st.chat_message("user").write(msg.content)
    elif isinstance(msg, AIMessage) and msg.content:
        st.chat_message("assistant").write(msg.content)

def run_turn(graph_input):
    def tokens():
        for chunk, meta in chatbot.stream(graph_input, config, stream_mode="messages"):
            if isinstance(chunk, ToolMessage):
                yield f"\n\n*Used tool: `{chunk.name}`*\n\n"
            elif (isinstance(chunk, AIMessageChunk) and chunk.content
                  and meta["langgraph_node"] == "chat_node"):
                yield chunk.content
    with st.chat_message("assistant"):
        st.write_stream(tokens())
    st.rerun()

# --- human-in-the-loop approval ---
pending = pending_interrupt(thread_id)
decision = None
if pending:
    with st.chat_message("assistant"):
        st.warning(f"Approve sending this email to **{pending['to']}**?")
        st.markdown(f"**Subject:** {pending['subject']}\n\n{pending['body']}")
        approve_col, reject_col = st.columns(2)
        if approve_col.button("Approve"):
            decision = "approve"
        if reject_col.button("Reject"):
            decision = "reject"
if decision:
    run_turn(Command(resume=decision))

# --- new message ---
if prompt := st.chat_input("Ask anything", disabled=bool(pending)):
    st.chat_message("user").write(prompt)
    run_turn({"messages": [HumanMessage(prompt)]})
```

## Code — `Dockerfile`

```dockerfile
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend.py app.py ./
EXPOSE 8501
CMD streamlit run app.py --server.port=${PORT:-8501} --server.address=0.0.0.0 --server.headless=true
```

The test file, GitHub Actions workflow and EC2 deploy are in [CI/CD to AWS](07-ci-cd-to-aws-with-docker-and-github-actions.md); `render.yaml` is in [deploy on Render](08-deploy-on-render-for-free-with-docker.md).

## How it works

1. **A turn starts** when the user types. `app.py` streams `{"messages": [HumanMessage]}` into the graph with the current `thread_id`.
2. **The checkpointer loads the thread**, `add_messages` appends the new message, and `chat_node` calls the model with the system prompt plus history.
3. **If the model requests tools**, `tools_condition` routes to `ToolNode`, results come back as `ToolMessage`s, and control returns to `chat_node`. This repeats until the model answers in plain text.
4. **If the model calls `send_email`**, the tool hits `interrupt()`. The graph stops and the checkpoint records the pending task. After the rerun, `pending_interrupt` finds it and the UI shows the draft with Approve/Reject.
5. **On a decision**, `Command(resume=...)` restarts the paused tool; `interrupt()` returns the decision, the tool sends or refuses, and the model writes a final reply.
6. **Every rerun redraws from the checkpointer**, so refreshes, restarts and thread switches all show the same truth.
7. **LangSmith** traces each turn as `chat_turn`, grouped by `thread_id`.

Run locally with `streamlit run app.py`, or `docker run -p 8501:8501 --env-file .env agentic-chatbot`.

## Stretch goals

- [ ] **Real email** — send through an email API; keep the approval gate.
- [ ] **Edit before send** — let the user change the draft and resume with the edited body.
- [ ] **Model-written thread titles** — generate a 4-word title after the first turn and store it.
- [ ] **Long-thread handling** — trim or summarize old messages before calling the model.
- [ ] **RAG tool** — search your own documents alongside the web.
- [ ] **Auth** — log users in and map each user to their own threads.
- [ ] **Async backend** — `AsyncPostgresSaver` and `astream` behind a FastAPI API, with Streamlit or React as the client.
- [ ] **Evaluation** — a LangSmith dataset of tricky questions, run on every prompt or model change.
- [ ] **Delete thread** — remove a conversation from the checkpointer from the sidebar.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
