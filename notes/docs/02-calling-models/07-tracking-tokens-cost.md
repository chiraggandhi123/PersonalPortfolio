---
title: "Tracking Tokens & Cost"
---

## TL;DR

Every API response tells you exactly how many tokens it used. **Log that `usage` on every call**, tag it with the feature and user, and multiply by the model's price. Without this you can't answer "what does this feature cost?" or notice the one user or prompt that's burning your budget. Count tokens **before** a call (tiktoken) when you need to fit a context window or estimate cost up front.

## What the API gives you

```python
resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages)
u = resp.usage

u.prompt_tokens                              # input
u.completion_tokens                          # output (includes reasoning tokens)
u.total_tokens
u.prompt_tokens_details.cached_tokens        # input served from prompt cache (cheaper)
u.completion_tokens_details.reasoning_tokens # hidden "thinking" tokens on reasoning models
```

- **Cached tokens** are billed at a discount, so track them separately.
- **Reasoning tokens** are billed as output but never shown in the reply. A short answer from a reasoning model can still cost a lot.
- When streaming, pass `stream_options={"include_usage": True}` to get usage at the end.

## Turning tokens into money

```python
# USD per 1M tokens. Illustrative, check the provider's pricing page and keep this in config.
PRICES = {
    "gpt-4o-mini": {"input": 0.15, "cached": 0.075, "output": 0.60},
}

def cost_usd(model: str, usage) -> float:
    p = PRICES[model]
    cached = usage.prompt_tokens_details.cached_tokens if usage.prompt_tokens_details else 0
    fresh = usage.prompt_tokens - cached
    return (fresh * p["input"] + cached * p["cached"] + usage.completion_tokens * p["output"]) / 1_000_000
```

Prices change often. Keep them in one table, not scattered through code. LiteLLM ships a maintained price list (`litellm.completion_cost(response)`) if you don't want to keep your own.

## Logging every call

Wrap the client once so nothing slips through:

```python
import json, logging, time

log = logging.getLogger("llm")

def tracked_chat(messages, *, feature: str, user_id: str, model="gpt-4o-mini", **kw):
    start = time.perf_counter()
    resp = client.chat.completions.create(model=model, messages=messages, **kw)
    log.info(json.dumps({
        "feature": feature,
        "user_id": user_id,
        "model": model,
        "input_tokens": resp.usage.prompt_tokens,
        "output_tokens": resp.usage.completion_tokens,
        "cost_usd": round(cost_usd(model, resp.usage), 6),
        "latency_s": round(time.perf_counter() - start, 2),
        "finish_reason": resp.choices[0].finish_reason,
    }))
    return resp
```

Structured (JSON) logs can be loaded into a spreadsheet, a database or a dashboard and grouped by **feature**, **user** and **model**.

## Counting tokens before you call

The OpenAI tokenizer runs locally via **tiktoken**:

```python
import tiktoken

enc = tiktoken.encoding_for_model("gpt-4o-mini")     # o200k_base
n = len(enc.encode(document))

if n > 100_000:
    chunks = split(document)          # too big: chunk it instead of sending
```

Uses: fit input into the context window, trim chat history by tokens instead of message count, show a cost estimate before a big job. Counts for a full chat request are slightly higher than the raw text (each message adds a few formatting tokens), so leave headroom.

## Where the money actually goes

Typical surprises when you first look at the logs:

- **The system prompt** — 2,000 tokens × every call adds up fast.
- **Chat history** — turn 20 resends turns 1–19; cost grows roughly quadratically with conversation length.
- **RAG context** — 10 retrieved chunks of 500 tokens = 5,000 input tokens per question.
- **Tool definitions** — sent with every request, whether used or not.
- **Retries and agent loops** — one user question can become 15 calls.

## Controlling cost

1. **Route by difficulty** — a small model for most traffic, a large one only when needed.
2. **Cap output** with `max_completion_tokens` and instructions like "max 3 bullets".
3. **Prompt caching** — put stable content (system prompt, tools, documents) **first** so the prefix is reused and billed at the cached rate.
4. **Trim or summarize history**; retrieve fewer, better chunks.
5. **Batch API** for non-urgent work (~50% off).
6. **Budgets and alerts** — per-user daily limits in your app, and spend alerts in the provider dashboard.

## Observability tools

Past a prototype, use a tracing tool instead of hand-rolled logs: **Langfuse**, **LangSmith**, **Helicone** or **OpenTelemetry**-based setups. They record every call with tokens, cost, latency and the full prompt, and group calls into traces per request or agent run.

## Key terms

- **Usage** — token counts returned with every response.
- **Cached tokens** — input tokens served from the prompt cache at a reduced price.
- **Reasoning tokens** — hidden output tokens a reasoning model uses to think, billed as output.
- **tiktoken** — OpenAI's local tokenizer library for counting tokens.
- **Model routing** — sending each request to the cheapest model that can handle it.

## Interview quick-fire

- **"How do you track the cost of an LLM feature?"** → Log usage per call with feature/user tags, multiply by the model's per-token price, and aggregate in a dashboard or tracing tool.
- **"Why can a short answer be expensive?"** → Large input (system prompt, history, RAG context) and hidden reasoning tokens are billed even though the reply is short.
- **"How does prompt caching cut cost?"** → A repeated prompt prefix is billed at a discounted rate, so put stable content first and variable content last.
