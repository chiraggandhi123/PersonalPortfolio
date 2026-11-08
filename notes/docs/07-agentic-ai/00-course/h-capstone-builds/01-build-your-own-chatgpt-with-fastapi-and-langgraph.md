---
title: "Build Your Own ChatGPT with FastAPI and LangGraph"
---

## Goal

Build a small ChatGPT clone: a **LangGraph agent with memory and tools**, served by a **FastAPI backend that streams tokens**, and a minimal web page that lists conversations. Each conversation is a LangGraph `thread_id`, so history survives restarts. This pulls together everything from section F behind a real API.

**Skills practiced:** LangGraph `StateGraph`, checkpointers, tool calling, FastAPI, server-sent events (SSE), async streaming, thread management.

## Architecture

```
Browser (index.html)
   │  POST /chat {thread_id, message}           GET /threads
   ▼                                                 │
FastAPI ──────────────────────────────────────────────┤
   │ astream(..., stream_mode="messages")             │
   ▼                                                  ▼
LangGraph agent                               SQLite (threads table)
   START ─► chatbot ─┬─► tools ─┐
                     │          │
                     └─► END ◄──┘ (loops back to chatbot)
   │
   └── AsyncSqliteSaver  (checkpoints per thread_id)
```

## Setup

```bash
pip install fastapi "uvicorn[standard]" langgraph langgraph-checkpoint-sqlite \
            langchain-openai langchain-community aiosqlite python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code

### `agent.py`

```python
from typing import Annotated, TypedDict
from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition

@tool
def calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression like '12 * (3 + 4)'."""
    allowed = set("0123456789+-*/(). ")
    if not set(expression) <= allowed:
        return "Only arithmetic is allowed."
    return str(eval(expression))          # safe: input restricted above

TOOLS = [calculator]
llm = ChatOpenAI(model="gpt-4o-mini", streaming=True).bind_tools(TOOLS)
SYSTEM = SystemMessage("You are a helpful assistant. Use tools for maths.")

class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]

async def chatbot(state: State):
    return {"messages": [await llm.ainvoke([SYSTEM, *state["messages"]])]}

def build_graph(checkpointer):
    g = StateGraph(State)
    g.add_node("chatbot", chatbot)
    g.add_node("tools", ToolNode(TOOLS))
    g.add_edge(START, "chatbot")
    g.add_conditional_edges("chatbot", tools_condition)   # -> "tools" or END
    g.add_edge("tools", "chatbot")
    return g.compile(checkpointer=checkpointer)
```

### `main.py`

```python
import json, uuid
from contextlib import asynccontextmanager

import aiosqlite
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel

from agent import build_graph

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSqliteSaver.from_conn_string("chat.db") as saver:
        app.state.db = await aiosqlite.connect("threads.db")
        await app.state.db.execute(
            "CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT)")
        app.state.graph = build_graph(saver)
        yield
        await app.state.db.close()

app = FastAPI(lifespan=lifespan)

class ChatIn(BaseModel):
    message: str
    thread_id: str | None = None

@app.get("/")
async def home():
    return FileResponse("index.html")

@app.get("/threads")
async def threads():
    rows = await (await app.state.db.execute("SELECT id, title FROM threads")).fetchall()
    return [{"id": r[0], "title": r[1]} for r in rows]

@app.post("/chat")
async def chat(body: ChatIn):
    thread_id = body.thread_id or str(uuid.uuid4())
    await app.state.db.execute("INSERT OR IGNORE INTO threads VALUES (?, ?)",
                               (thread_id, body.message[:40]))
    await app.state.db.commit()
    config = {"configurable": {"thread_id": thread_id}}

    async def events():
        yield f"data: {json.dumps({'thread_id': thread_id})}\n\n"
        async for chunk, meta in app.state.graph.astream(
            {"messages": [HumanMessage(body.message)]}, config, stream_mode="messages"
        ):
            if isinstance(chunk, AIMessageChunk) and chunk.content and meta["langgraph_node"] == "chatbot":
                yield f"data: {json.dumps({'token': chunk.content})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")

@app.get("/threads/{thread_id}")
async def history(thread_id: str):
    state = await app.state.graph.aget_state({"configurable": {"thread_id": thread_id}})
    return [{"role": m.type, "content": m.content}
            for m in state.values.get("messages", []) if m.content]
```

### `index.html` (core of the client)

```html
<div id="log"></div><input id="msg"><button onclick="send()">Send</button>
<script>
let threadId = null;
async function send() {
  const text = msg.value; msg.value = "";
  log.innerHTML += `<p><b>You:</b> ${text}</p><p><b>AI:</b> <span id="cur"></span></p>`;
  const res = await fetch("/chat", {method: "POST", headers: {"Content-Type": "application/json"},
                                    body: JSON.stringify({message: text, thread_id: threadId})});
  const reader = res.body.getReader(); const dec = new TextDecoder();
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    for (const line of dec.decode(value).split("\n\n")) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      const d = JSON.parse(line.slice(6));
      if (d.thread_id) threadId = d.thread_id;
      if (d.token) document.getElementById("cur").textContent += d.token;
    }
  }
  document.getElementById("cur").removeAttribute("id");
}
</script>
```

Run with `uvicorn main:app --reload` and open `http://localhost:8000`.

## How it works

1. **First message** has no `thread_id`, so the server creates one and sends it back as the first SSE event. The browser keeps it for later turns.
2. **The graph is invoked with only the new message.** The checkpointer loads the earlier messages for that thread and `add_messages` appends the new one.
3. **`stream_mode="messages"`** yields LLM tokens as they're generated. Filtering on `langgraph_node == "chatbot"` skips tool output.
4. **Tool calls** route through `tools_condition` to `ToolNode` and back, so the model can do maths mid-conversation.
5. **`/threads/{id}`** reads the saved state, which is how a sidebar would reload old chats.

Note: `fetch` streaming can split one SSE event across two reads. For production, buffer partial lines or use a library such as `@microsoft/fetch-event-source`.

## Stretch goals

- [ ] Sidebar that lists `/threads` and loads history on click.
- [ ] Auto-title each thread with a cheap LLM call after the first reply.
- [ ] Add web search (Tavily) and a RAG tool over your own PDFs.
- [ ] Swap SQLite for `AsyncPostgresSaver` and deploy with Docker.
- [ ] Per-user auth (JWT) so threads are scoped to a user.
- [ ] Trace every request in LangSmith and show token cost per thread.
- [ ] Stop button: cancel the stream when the client disconnects.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
