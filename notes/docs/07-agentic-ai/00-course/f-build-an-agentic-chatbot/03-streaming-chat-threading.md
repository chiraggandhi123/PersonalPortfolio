---
title: "Streaming & Chat Threading"
---

## TL;DR

Two features make the chatbot feel like a real app. **Streaming**: call `chatbot.stream(..., stream_mode="messages")` and show tokens as they arrive instead of waiting for the full reply. **Threading**: give every conversation its own **`thread_id`** (a UUID), list past threads from the checkpointer, and reload any of them from `get_state`. This note adds a **Streamlit** front end, `app.py`, on top of the SQLite-backed `backend.py` from the previous note.

## Stream modes recap

| `stream_mode` | Yields | Use for |
|---|---|---|
| `"values"` | Full state after each step | Debugging |
| `"updates"` | `{node: update}` after each node | Progress ("searching...") |
| `"messages"` | `(message_chunk, metadata)` per token | Typing effect in a chat UI |

```python
from langchain_core.messages import HumanMessage
from backend import chatbot

config = {"configurable": {"thread_id": "demo"}}
for chunk, meta in chatbot.stream(
    {"messages": [HumanMessage("Explain checkpointers in 3 lines")]},
    config,
    stream_mode="messages",
):
    if chunk.content:
        print(chunk.content, end="", flush=True)
```

`meta["langgraph_node"]` tells you which node produced the chunk. Once tools arrive (note 05) you will filter on it. The streamed reply is still saved to the checkpointer as one complete `AIMessage`.

## Threading design

```
            Streamlit session                     SQLite (checkpointer)
 ┌───────────────────────────────┐         ┌──────────────────────────┐
 │ session_state.thread_id = uuid │──read──►│ thread a1f3... messages  │
 │ sidebar: [New chat]            │         │ thread 9c2e... messages  │
 │          a1f3...  9c2e...      │◄─list───│ thread 47bd... messages  │
 └───────────────────────────────┘         └──────────────────────────┘
```

The checkpointer is the **single source of truth**. The UI keeps only the current `thread_id` and redraws the conversation from saved state on every rerun.

## Add helpers to `backend.py`

Append these below `chatbot = builder.compile(...)`:

```python
def retrieve_all_threads() -> list[str]:
    """Thread ids in the checkpointer, most recent first."""
    seen: list[str] = []
    for cp in checkpointer.list(None):
        tid = cp.config["configurable"]["thread_id"]
        if tid not in seen:
            seen.append(tid)
    return seen


def load_messages(thread_id: str) -> list[BaseMessage]:
    state = chatbot.get_state({"configurable": {"thread_id": thread_id}})
    return state.values.get("messages", [])
```

## The UI — `app.py`

```bash
pip install streamlit
```

```python
import uuid

import streamlit as st
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage

from backend import chatbot, load_messages, retrieve_all_threads

st.set_page_config(page_title="Agentic Chatbot")

if "thread_id" not in st.session_state:
    st.session_state.thread_id = str(uuid.uuid4())
thread_id = st.session_state.thread_id
config = {"configurable": {"thread_id": thread_id}}

# --- sidebar: threads ---
st.sidebar.title("Conversations")
if st.sidebar.button("New chat"):
    st.session_state.thread_id = str(uuid.uuid4())
    st.rerun()
for tid in retrieve_all_threads():
    if st.sidebar.button(tid[:8], key=tid, disabled=tid == thread_id):
        st.session_state.thread_id = tid
        st.rerun()

# --- conversation so far, from the checkpointer ---
for msg in load_messages(thread_id):
    if isinstance(msg, HumanMessage):
        st.chat_message("user").write(msg.content)
    elif isinstance(msg, AIMessage) and msg.content:
        st.chat_message("assistant").write(msg.content)

# --- new turn, streamed ---
if prompt := st.chat_input("Ask anything"):
    st.chat_message("user").write(prompt)

    def tokens():
        for chunk, meta in chatbot.stream(
            {"messages": [HumanMessage(prompt)]}, config, stream_mode="messages"
        ):
            if isinstance(chunk, AIMessageChunk) and chunk.content:
                yield chunk.content

    with st.chat_message("assistant"):
        st.write_stream(tokens())
    st.rerun()        # refresh sidebar so a new thread appears
```

Run with `streamlit run app.py`. Start two chats, switch between them, restart the server: both threads are still there.

## How a turn flows

1. Streamlit reruns the whole script on every interaction.
2. The script reads `thread_id` from `session_state` and redraws history with `load_messages`.
3. On input, `chatbot.stream` loads the thread's checkpoint, appends the message, runs `chat_node` and yields tokens.
4. `st.write_stream` renders them live. The checkpointer saves the final state.
5. `st.rerun()` redraws from saved state, so the UI and DB never disagree.

## Nicer thread titles

UUID prefixes are ugly. Common fixes:

- Use the **first user message**, truncated to 30 characters, as the label (read it from `load_messages(tid)[0]`).
- Ask the model for a 4-word title after the first turn and save it with `chatbot.update_state` in a `title` state field, or in a small `threads` table.

## Gotchas

- **Streamlit reruns everything.** Anything expensive (graph compile, DB connection) belongs in `backend.py`, imported once, or behind `@st.cache_resource`.
- **Empty chunks.** Tool-call chunks have empty `content`; skip them or the UI shows blank lines.
- **Async apps** use `astream` with an async checkpointer (`AsyncSqliteSaver`). Don't mix sync and async savers.
- **`checkpointer.list(None)` scans every checkpoint.** Fine for a demo; in production keep a separate threads table indexed by user.
- **Don't keep a second copy of history** in `session_state`. Two sources drift apart.

## Key terms

- **Token streaming** — sending model output to the client as it's generated.
- **`stream_mode="messages"`** — LangGraph mode that yields LLM message chunks with node metadata.
- **AIMessageChunk** — a partial AI message emitted while streaming.
- **Thread id** — the key for one conversation in the checkpointer; here a UUID per chat.
- **`st.write_stream`** — Streamlit helper that renders a generator of strings live.

## Interview quick-fire

- **"How do you stream tokens from a LangGraph graph?"** → `graph.stream(input, config, stream_mode="messages")` yields `(chunk, metadata)`; render `chunk.content` and filter by `metadata["langgraph_node"]`.
- **"How do you support multiple conversations?"** → One `thread_id` per conversation passed in the config; the checkpointer stores each separately, and you list threads to build a sidebar.
- **"Where should chat history live in a web app?"** → In the checkpointer or database, not in UI state, so it survives reloads and has a single source of truth.
