---
title: "Async Basics You'll See in Agents"
---

## TL;DR

LLM calls spend most of their time **waiting on the network**. **`async`/`await`** lets one Python thread start many calls and handle each as it finishes, instead of waiting for them one by one. An **`async def`** function is a **coroutine**; you run it with **`await`** inside other async code, or **`asyncio.run()`** at the top. **`asyncio.gather`** runs calls concurrently, and a **`Semaphore`** caps how many run at once. Agent frameworks, FastAPI, Telegram/Discord bots and streaming all use async, so you need to read it fluently.

## Sync vs async

```
sync:    [call 1 ████████]              [call 2 ████████]              [call 3 ████████]
async:   [call 1 ████████]
         [call 2 ████████]          ← all waiting on the network at the same time
         [call 3 ████████]
```

Three 2-second calls: ~6 s sync, ~2 s async. Async helps with **I/O-bound** work (HTTP, DB, files). It does **not** speed up CPU-heavy work like running a local model.

## The syntax

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()                      # async version of the client

async def ask(prompt: str) -> str:          # coroutine function
    response = await client.chat.completions.create(   # pause here until reply arrives
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content

async def main():
    answer = await ask("What is an agent?")
    print(answer)

asyncio.run(main())                         # start the event loop (once, at the top)
```

| Keyword | Meaning |
|---|---|
| `async def` | Defines a coroutine function |
| `await x` | Pause this coroutine until `x` finishes; let others run meanwhile |
| `asyncio.run(main())` | Entry point: creates the event loop and runs `main` |
| `async with` | Async context manager (clients, sessions) |
| `async for` | Iterate an async stream (e.g. streamed tokens) |

Calling `ask("hi")` without `await` does **nothing** except create a coroutine object (and a "never awaited" warning).

## Running calls concurrently

```python
async def main():
    questions = ["Define RAG.", "Define LoRA.", "Define MCP."]
    answers = await asyncio.gather(*(ask(q) for q in questions))   # results in input order
    for q, a in zip(questions, answers):
        print(q, "->", a[:80])
```

Handle failures without losing the others:

```python
results = await asyncio.gather(*tasks, return_exceptions=True)
for r in results:
    if isinstance(r, Exception):
        print("failed:", r)
```

## Limiting concurrency

Firing 500 calls at once hits rate limits. Cap it:

```python
sem = asyncio.Semaphore(5)                  # at most 5 in flight

async def ask_limited(prompt: str) -> str:
    async with sem:
        return await ask(prompt)

answers = await asyncio.gather(*(ask_limited(p) for p in prompts))
```

## Timeouts

```python
try:
    answer = await asyncio.wait_for(ask("Long question..."), timeout=20)
except asyncio.TimeoutError:
    answer = "Took too long."
```

## Async streaming

```python
async def stream(prompt: str):
    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            print(delta, end="", flush=True)
```

More in [streaming responses](../02-calling-models/03-streaming-responses.md).

## Where you'll see async

| Place | What it looks like |
|---|---|
| FastAPI | `async def chat(req: ChatRequest): ...` route handlers |
| Telegram / Discord bots | `async def handler(update, context): await ...` |
| LangChain / LangGraph | `await chain.ainvoke(...)`, `async for ev in graph.astream(...)` |
| OpenAI Agents SDK | `await Runner.run(agent, "...")` |
| MCP servers/clients | async tools and sessions |

The `a` prefix (`ainvoke`, `astream`, `abatch`) is the convention for async versions of methods.

## Gotchas

- **Blocking calls inside async code** — `time.sleep`, `requests.get` or the sync `OpenAI()` client freeze the whole event loop. Use `await asyncio.sleep`, `httpx.AsyncClient`, `AsyncOpenAI`. For unavoidable sync code: `await asyncio.to_thread(fn, ...)`.
- **"asyncio.run() cannot be called from a running event loop"** — Jupyter already runs a loop. In notebooks, just `await main()` directly in a cell.
- **Forgetting `await`** — you get a coroutine object instead of a result. Read "coroutine was never awaited" warnings.
- **Async isn't parallel CPU** — it's one thread switching at `await` points. Use processes for CPU work.
- **Mixing styles** — keep a codebase mostly sync or mostly async; bridging back and forth gets messy.

## Key terms

- **Coroutine** — the object an `async def` function returns; runs when awaited.
- **Event loop** — the scheduler that runs coroutines and switches between them at `await` points.
- **`await`** — suspend until an awaitable finishes, letting other tasks run.
- **`asyncio.gather`** — run several awaitables concurrently and collect results in order.
- **Semaphore** — a counter that limits how many tasks enter a block at once.
- **I/O-bound** — limited by waiting on network/disk, not CPU; where async helps.

## Interview quick-fire

- **"Why use async for LLM apps?"** → Calls are I/O-bound; async lets you run many concurrently on one thread, cutting latency for batches and handling many users.
- **"What happens if you call `requests.get` inside an async function?"** → It blocks the event loop, stalling every other task until it returns.
- **"How do you avoid rate limits when running 1,000 async calls?"** → Limit concurrency with a semaphore, and add retries with backoff.
- **"Async vs multithreading vs multiprocessing?"** → Async: one thread, cooperative, for I/O. Threads: also good for I/O with blocking libraries. Processes: true parallelism for CPU-bound work.
