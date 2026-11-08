---
title: "Streamlit & FastAPI Front-Ends"
---

## TL;DR

Two Python tools cover most LLM app interfaces. **Streamlit** turns a script into a web UI in minutes: perfect for **demos, prototypes and internal tools**. **FastAPI** builds an **HTTP API** that any front-end (React, mobile, Slack bot) can call: the choice for **production backends**. A common setup is both: FastAPI serves the LLM logic, and Streamlit or a JS app is the UI. **Gradio** is a similar quick-UI option, popular for ML demos.

## Which one?

| | Streamlit | FastAPI | Gradio |
|---|---|---|---|
| Output | Web UI | JSON / streaming HTTP API | Web UI |
| Build time | Minutes | An hour or two | Minutes |
| Customisation | Limited layouts | Full control (you build the UI) | Limited |
| Multi-user scale | OK for small teams | Built for it (async) | OK for demos |
| Best for | Prototypes, dashboards, internal tools | Production backends, mobile/web clients | Model demos, Hugging Face Spaces |

```
Prototype:    browser ──► Streamlit app ──► LLM API

Production:   React / mobile / Streamlit ──HTTP──► FastAPI ──► LLM API
                                                     ├─► database
                                                     └─► auth, rate limits, logging
```

## Streamlit chat app

```bash
pip install streamlit openai python-dotenv
```

```python
# app.py
import streamlit as st
from openai import OpenAI

client = OpenAI()                     # reads OPENAI_API_KEY
st.title("Study Buddy")

if "messages" not in st.session_state:          # survives reruns, one per browser tab
    st.session_state.messages = [{"role": "system", "content": "You are a patient tutor."}]

for m in st.session_state.messages[1:]:          # redraw history (skip system)
    st.chat_message(m["role"]).write(m["content"])

if prompt := st.chat_input("Ask anything"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    st.chat_message("user").write(prompt)

    stream = client.chat.completions.create(
        model="gpt-4o-mini", messages=st.session_state.messages, stream=True
    )
    with st.chat_message("assistant"):
        reply = st.write_stream(                 # renders tokens as they arrive
            chunk.choices[0].delta.content or "" for chunk in stream if chunk.choices
        )
    st.session_state.messages.append({"role": "assistant", "content": reply})
```

Run with `streamlit run app.py`.

How Streamlit works: **the whole script reruns** on every interaction. Anything you want to keep must go in `st.session_state`. Use `@st.cache_resource` for expensive objects (clients, models, vector stores) so they aren't rebuilt each rerun.

## FastAPI backend

```bash
pip install fastapi uvicorn openai pydantic
```

```python
# api.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI, APIError
from pydantic import BaseModel, Field

app = FastAPI()
client = AsyncOpenAI()

class ChatRequest(BaseModel):
    messages: list[dict]
    temperature: float = Field(0.7, ge=0, le=2)

class ChatResponse(BaseModel):
    reply: str
    tokens: int

@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini", messages=req.messages, temperature=req.temperature
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")
    return ChatResponse(reply=resp.choices[0].message.content, tokens=resp.usage.total_tokens)

@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    async def gen():
        stream = await client.chat.completions.create(
            model="gpt-4o-mini", messages=req.messages, stream=True
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    return StreamingResponse(gen(), media_type="text/plain")

@app.get("/health")
async def health():
    return {"ok": True}
```

Run with `uvicorn api:app --reload` and open `http://localhost:8000/docs` for auto-generated interactive docs. Server-sent events and browser consumption are covered in [streaming responses](../02-calling-models/03-streaming-responses.md).

Key FastAPI habits for LLM apps:

- **`async def` + `AsyncOpenAI`** so one slow LLM call doesn't block other users.
- **Pydantic request/response models** validate input and document the API.
- **Keep keys on the server.** The browser never sees `OPENAI_API_KEY`.

## Connecting Streamlit to FastAPI

```python
import requests, streamlit as st

if prompt := st.chat_input("Ask"):
    r = requests.post("http://localhost:8000/chat",
                      json={"messages": [{"role": "user", "content": prompt}]}, timeout=60)
    st.write(r.json()["reply"])
```

## Gotchas

- **Streamlit reruns** reset local variables. Forgetting `session_state` is the most common bug.
- **Blocking calls in FastAPI.** Calling the sync `OpenAI` client inside `async def` blocks the event loop. Use the async client, or a plain `def` endpoint.
- **Trust nothing from the client.** Validate message roles and lengths; don't let users send their own `system` message.
- **CORS.** A browser front-end on another origin needs `CORSMiddleware` configured on FastAPI.
- **Timeouts.** LLM calls can take tens of seconds. Set client and proxy timeouts accordingly, and stream where possible.

## Key terms

- **Streamlit** — Python library that turns scripts into interactive web apps.
- **`st.session_state`** — per-session storage that survives Streamlit reruns.
- **FastAPI** — async Python web framework with Pydantic validation and auto-generated docs.
- **ASGI / Uvicorn** — the async server interface and the server that runs FastAPI apps.
- **StreamingResponse** — FastAPI response that sends data in chunks as it's generated.

## Interview quick-fire

- **"Streamlit or FastAPI for an LLM product?"** → Streamlit for prototypes and internal tools; FastAPI as the backend for production, with any UI on top.
- **"Why does my Streamlit chat forget messages?"** → The script reruns on every interaction; store history in `st.session_state`.
- **"How do you stream LLM output from FastAPI?"** → Return a `StreamingResponse` wrapping an async generator over the model's stream.
- **"Why async in FastAPI for LLM calls?"** → LLM calls are slow I/O. Async lets one worker serve many requests while waiting.
