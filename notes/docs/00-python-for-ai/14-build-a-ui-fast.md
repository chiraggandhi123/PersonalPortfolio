---
title: "Build a UI Fast (Streamlit + a little FastAPI)"
---

## TL;DR

You can put a chat UI on an LLM in about 30 lines of Python. **Streamlit** turns a script into a web app: it **reruns the whole script** on every interaction, and you keep state in **`st.session_state`**. It has built-in **chat widgets** (`st.chat_input`, `st.chat_message`) and streaming (`st.write_stream`). **Gradio** is a similar alternative, popular on Hugging Face. When other programs (a React frontend, a mobile app, another service) need your LLM logic, wrap it in a **FastAPI** endpoint.

## Options at a glance

| Tool | Best for | Model |
|---|---|---|
| **Streamlit** | Internal tools, demos, dashboards, chat apps | Script reruns top to bottom on each interaction |
| **Gradio** | ML demos, Hugging Face Spaces, quick chat UIs | Functions wired to input/output components |
| **FastAPI** | An HTTP API for your LLM logic | Python functions as JSON endpoints |
| React/Next.js + API | Production consumer apps | Separate frontend calling your backend |

```bash
pip install streamlit openai python-dotenv
```

## A Streamlit chatbot

`app.py`:

```python
import streamlit as st
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
st.title("💬 Study Buddy")

@st.cache_resource                       # create the client once, not on every rerun
def get_client():
    return OpenAI()

client = get_client()

if "messages" not in st.session_state:   # survives reruns
    st.session_state.messages = [
        {"role": "system", "content": "You are a friendly tutor. Keep answers short."}
    ]

for m in st.session_state.messages[1:]:  # redraw history (skip system)
    with st.chat_message(m["role"]):
        st.markdown(m["content"])

if prompt := st.chat_input("Ask anything..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=st.session_state.messages,
            stream=True,
        )
        reply = st.write_stream(stream)  # renders tokens live, returns the full text

    st.session_state.messages.append({"role": "assistant", "content": reply})
```

```bash
streamlit run app.py
```

### The rerun model

```
user types ──► whole script reruns top to bottom
                 ├─ normal variables reset
                 ├─ st.session_state keeps values
                 └─ @st.cache_resource / @st.cache_data skip repeated work
```

This is the one idea that trips people up. If something "forgets" its value, it belongs in `session_state`.

### Useful widgets

```python
with st.sidebar:
    model = st.selectbox("Model", ["gpt-4o-mini", "gpt-4o"])
    temperature = st.slider("Temperature", 0.0, 1.0, 0.3)
    if st.button("Clear chat"):
        st.session_state.messages = st.session_state.messages[:1]
        st.rerun()

uploaded = st.file_uploader("Upload a PDF", type="pdf")   # for RAG demos
with st.spinner("Thinking..."):
    ...
st.error("API key missing")                               # also st.warning / st.success
```

## Gradio in a few lines

```python
import gradio as gr
from openai import OpenAI

client = OpenAI()

def respond(message, history):
    # history arrives as a list of {"role", "content"} dicts
    messages = [*history, {"role": "user", "content": message}]
    stream = client.chat.completions.create(model="gpt-4o-mini", messages=messages, stream=True)
    partial = ""
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            partial += chunk.choices[0].delta.content
            yield partial                       # yielding streams to the UI

gr.ChatInterface(respond, type="messages").launch()
```

`ChatInterface` handles the history and layout for you. Gradio's API changes between major versions, so check its docs if the `history` format differs.

## A little FastAPI

When you need an API instead of a page:

```bash
pip install fastapi uvicorn
```

```python
from fastapi import FastAPI
from openai import AsyncOpenAI
from pydantic import BaseModel

app = FastAPI()
client = AsyncOpenAI()

class ChatRequest(BaseModel):
    messages: list[dict]

class ChatResponse(BaseModel):
    reply: str

@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    resp = await client.chat.completions.create(model="gpt-4o-mini", messages=req.messages)
    return ChatResponse(reply=resp.choices[0].message.content)
```

```bash
uvicorn main:app --reload
# open http://127.0.0.1:8000/docs for interactive Swagger docs
```

FastAPI uses **Pydantic** to validate request bodies and **async** handlers, which is why those notes come before this one. A Streamlit app can call this API with `requests.post(...)`, giving you a frontend/backend split.

## Deploying quickly

- **Streamlit Community Cloud** — connect a GitHub repo; add keys under app **Secrets**.
- **Hugging Face Spaces** — free hosting for Gradio and Streamlit apps.
- **Render / Railway** — good for FastAPI backends.

## Gotchas

- **Creating the client or loading a model on every rerun** — wrap in `@st.cache_resource`.
- **History lost on refresh** — `session_state` is per browser session, in memory. Persist to a DB for real memory.
- **Shared public demo = shared bill** — add a password, rate limiting or ask users for their own key.
- **Sync OpenAI client inside `async def` FastAPI routes** blocks the server. Use `AsyncOpenAI`, or define the route with plain `def`.
- **Don't put your API key in frontend code.** The LLM call stays in Python on the server.

## Key terms

- **Streamlit** — Python library that turns scripts into web apps, rerunning on each interaction.
- **`st.session_state`** — per-user dict that persists across Streamlit reruns.
- **`st.cache_resource`** — caches expensive objects (clients, models) across reruns.
- **Gradio** — Python library for ML demo UIs; `ChatInterface` builds a chatbot UI.
- **FastAPI** — async Python web framework with Pydantic validation and auto-generated docs.
- **Uvicorn** — ASGI server that runs FastAPI apps.

## Interview quick-fire

- **"Why does my Streamlit variable reset?"** → The script reruns on every interaction; store it in `st.session_state`.
- **"Streamlit vs FastAPI?"** → Streamlit is a UI for humans; FastAPI is an HTTP API for other programs. Often you use both.
- **"How do you stream tokens in Streamlit?"** → Pass the streaming response to `st.write_stream`, which renders chunks and returns the full text.
- **"How would you keep a public LLM demo from draining your budget?"** → Auth or passwords, per-user rate limits, max tokens, spend caps on the provider account.
