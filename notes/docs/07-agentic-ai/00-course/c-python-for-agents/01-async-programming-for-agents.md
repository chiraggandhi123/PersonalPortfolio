---
title: "Async Programming for Agents"
---

## TL;DR

Agents spend most of their time **waiting on I/O**: model calls, web searches, databases. `asyncio` lets one process **wait on many of these at once** instead of one after another. Use `async def` + `await`, run independent calls together with **`asyncio.gather`**, cap concurrency with a **`Semaphore`**, and bound every call with a **timeout**. LangChain and LangGraph expose async versions of everything: `ainvoke`, `astream`, `abatch`.

## Why it matters for agents

```
Sync (sequential):    search A ████████ search B ████████ search C ████████      ~3 s
Async (concurrent):   search A ████████
                      search B ████████
                      search C ████████                                          ~1 s
```

| Situation | Async helps? |
|---|---|
| Several independent tool calls in one turn | Yes, run them together |
| Serving many users from one web server | Yes, one slow user doesn't block others |
| Streaming tokens to a UI while doing other work | Yes |
| CPU-heavy work (parsing big PDFs, local inference) | No, use processes or threads |

## The basics

```python
import asyncio

async def fetch(name: str, delay: float) -> str:
    await asyncio.sleep(delay)        # stands in for a network call
    return f"{name} done"

async def main():
    # sequential: ~3 s
    a = await fetch("a", 1); b = await fetch("b", 1); c = await fetch("c", 1)

    # concurrent: ~1 s
    results = await asyncio.gather(fetch("a", 1), fetch("b", 1), fetch("c", 1))
    print(results)

asyncio.run(main())
```

- `async def` defines a **coroutine**. Calling it returns a coroutine object; nothing runs until it's awaited.
- `await` pauses this coroutine and lets the **event loop** run others.
- `asyncio.run()` starts the loop. Call it once, at the top level.

## Concurrent LLM calls

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()
sem = asyncio.Semaphore(5)                     # at most 5 requests in flight

async def summarize(text: str) -> str:
    async with sem:
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": f"Summarize in one line:\n{text}"}],
            ),
            timeout=30,
        )
        return resp.choices[0].message.content

async def main(docs: list[str]):
    results = await asyncio.gather(*(summarize(d) for d in docs), return_exceptions=True)
    for doc, r in zip(docs, results):
        print("FAILED" if isinstance(r, Exception) else r)

asyncio.run(main(["doc one ...", "doc two ...", "doc three ..."]))
```

- **Semaphore** stops you from hitting rate limits with 500 parallel requests.
- **`return_exceptions=True`** keeps one failure from cancelling the whole batch.
- **`wait_for`** stops a hung request from hanging the agent.

## Async in LangChain and LangGraph

```python
import asyncio
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

llm = ChatOpenAI(model="gpt-4o-mini")

@tool
async def search_docs(query: str) -> str:
    """Search internal docs for a query."""
    await asyncio.sleep(0.5)                  # call an async HTTP client here
    return f"results for {query}"

async def main():
    print((await llm.ainvoke("Hi")).content)                     # one call
    replies = await llm.abatch(["Define RAG", "Define agent"])   # many, concurrently
    async for chunk in llm.astream("Write a haiku about graphs"):
        print(chunk.content, end="", flush=True)                 # token streaming
    print(await search_docs.ainvoke({"query": "refund policy"}))

asyncio.run(main())
```

Every Runnable (models, tools, agents, compiled graphs) has `ainvoke`, `astream`, `abatch`. LangGraph's `ToolNode` runs the tool calls from one AI message concurrently.

## Tasks for background work

```python
async def main():
    task = asyncio.create_task(fetch("slow report", 5))   # starts now, runs in background
    print("doing other work...")
    result = await task                                   # collect later
```

Use `asyncio.TaskGroup` (Python 3.11+) when you want all tasks cancelled if one fails.

## Gotchas

- **Blocking calls freeze everything.** `time.sleep`, `requests.get` or a sync SDK inside `async def` blocks the event loop. Use `asyncio.sleep`, `httpx.AsyncClient`, `AsyncOpenAI`, or wrap sync code in `await asyncio.to_thread(fn, ...)`.
- **Forgetting `await`** gives you a coroutine object instead of a result, plus a "never awaited" warning.
- **`asyncio.run` inside Jupyter fails** because a loop is already running. Just use top-level `await`.
- **Mixing sync and async tools.** An agent run with `ainvoke` can call sync tools, but they run in a thread pool; prefer async tools for I/O.
- **Unbounded `gather`** over thousands of items will hit rate limits. Always add a semaphore.

## Key terms

- **Coroutine** — a function defined with `async def`; it runs when awaited.
- **Event loop** — the scheduler that switches between coroutines while they wait on I/O.
- **`await`** — yields control until the awaited operation finishes.
- **`asyncio.gather`** — runs several awaitables concurrently and returns their results in order.
- **Semaphore** — a counter that limits how many coroutines enter a block at once.
- **I/O-bound** — work dominated by waiting on the network or disk, which async speeds up.

## Interview quick-fire

- **"Why use async in an agent?"** → Agents mostly wait on model and tool calls; async runs independent calls concurrently and lets one server handle many users.
- **"Async vs. threads vs. processes?"** → Async for many I/O waits in one thread; threads for blocking libraries; processes for CPU-bound work.
- **"How do you avoid rate-limit errors with concurrent calls?"** → Cap concurrency with a semaphore, add timeouts, and retry with exponential backoff.
- **"What happens if you call `requests.get` inside an async function?"** → It blocks the event loop, so every other coroutine stalls until it returns.
