---
title: "Streaming Responses"
---

## TL;DR

Without streaming, your app waits for the **whole** answer before showing anything. With `stream=True` the API sends the answer **in small chunks as it's generated**, so users see text within a few hundred milliseconds. Total time is the same; perceived speed is much better. Use it for anything a human watches.

## Why it matters

```
no streaming   [········ waiting 8s ········] full answer appears
streaming      T|he| ans|wer| ap|pears| as| it's| writ|ten|...   first words at ~0.3s
```

Two numbers to know:

- **Time to first token (TTFT)** — how long until the first chunk arrives. This is what users feel.
- **Tokens per second** — how fast the rest streams in.

## Basic streaming (OpenAI)

```python
from openai import OpenAI
client = OpenAI()

stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Explain RAG in 3 sentences."}],
    stream=True,
)

reply = ""
for chunk in stream:
    if not chunk.choices:          # the final usage-only chunk has no choices
        continue
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)
        reply += delta
print()
```

Each chunk carries a **delta**, the new piece of text only. You glue them together yourself if you need the full reply (e.g. to append to chat history).

### Getting token usage while streaming

Streams don't include usage by default. Ask for it:

```python
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=messages,
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in stream:
    if chunk.usage:                # arrives in the last chunk
        print(chunk.usage)
```

## Async streaming

In a web server or bot you'll use the async client:

```python
from openai import AsyncOpenAI
client = AsyncOpenAI()

async def answer(messages):
    stream = await client.chat.completions.create(
        model="gpt-4o-mini", messages=messages, stream=True
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

## Streaming to a web page

The browser can't read a Python generator, so servers forward chunks over **Server-Sent Events (SSE)** or a streaming HTTP response. With FastAPI:

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.get("/chat")
async def chat(q: str):
    messages = [{"role": "user", "content": q}]
    return StreamingResponse(answer(messages), media_type="text/plain")
```

In Streamlit it's one line: `st.write_stream(generator)`.

## Other providers

```python
# Anthropic: a context manager with a text-only iterator
with anthropic_client.messages.stream(model="claude-sonnet-5-5", max_tokens=1024, messages=msgs) as s:
    for text in s.text_stream:
        print(text, end="", flush=True)

# Gemini
for chunk in genai_client.models.generate_content_stream(model="gemini-2.5-flash", contents="Hi"):
    print(chunk.text, end="")
```

## Gotchas

- **Tool calls and JSON stream in pieces too.** A tool call's arguments arrive as partial JSON across many chunks; accumulate them before parsing. Parsing structured output mid-stream needs a partial-JSON parser.
- **Errors can happen mid-stream.** The connection can drop after half the answer. Decide what the UI shows (keep the partial text, add "…connection lost").
- **Moderation and validation** are harder when text is already on screen. If you must check the full answer first, don't stream it.
- **Don't stream between machines** that just need the final result (batch jobs, pipelines). It adds complexity for no benefit.

## Key terms

- **Streaming** — receiving the response incrementally as it's generated.
- **Delta** — the new piece of content in one stream chunk.
- **TTFT** — time to first token; the main perceived-latency metric.
- **SSE (Server-Sent Events)** — a simple HTTP protocol for pushing a stream of events to a browser.

## Interview quick-fire

- **"Does streaming make the model faster?"** → No, total generation time is about the same; it lowers time to first token, so the app feels faster.
- **"How do you get token usage when streaming with OpenAI?"** → Pass `stream_options={"include_usage": True}`; usage arrives in the final chunk.
- **"When would you not stream?"** → Background jobs, when you need to validate or moderate the full output before showing it, or when another program consumes the result.
