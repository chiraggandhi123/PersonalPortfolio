---
title: "Errors, Retries & Rate Limits"
---

## TL;DR

LLM APIs fail regularly: **rate limits (429)**, **overloaded servers (5xx)**, **timeouts** and **connection drops**. Retry those with **exponential backoff and jitter**; never retry **bad requests (400)** or **auth errors (401/403)**, since they fail the same way every time. The OpenAI SDK already retries twice by default; tune it, add timeouts, and design for the failures that remain.

## Which errors to retry

| Status | OpenAI exception | Meaning | Retry? |
|---|---|---|---|
| 400 | `BadRequestError` | Malformed request, context too long, invalid params | **No**: fix the request |
| 401 / 403 | `AuthenticationError` / `PermissionDeniedError` | Bad key, no access to the model | **No** |
| 404 | `NotFoundError` | Wrong model name | **No** |
| 429 | `RateLimitError` | Too many requests/tokens, **or quota exhausted** | **Yes**, with backoff (but not if it's a billing quota) |
| 500 / 503 | `InternalServerError` | Provider-side problem or overload | **Yes** |
| — | `APITimeoutError` / `APIConnectionError` | Network trouble | **Yes** |

All of these inherit from `openai.APIError`.

## Built-in retries

```python
from openai import OpenAI

client = OpenAI(
    max_retries=5,      # default is 2; retries 408/409/429/5xx and connection errors with backoff
    timeout=30.0,       # default is 600s, far too long for a user-facing app
)

# or per request
client.with_options(max_retries=0, timeout=10).chat.completions.create(...)
```

For many apps, this is enough. Catch what still escapes:

```python
import openai

try:
    resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages)
except openai.RateLimitError:
    return "We're busy right now, please try again in a minute."
except openai.APITimeoutError:
    return "That took too long. Try a shorter question."
except openai.BadRequestError as e:
    log.error("Bad request: %s", e)          # a bug in your code; alert on it
    raise
except openai.APIError as e:
    log.error("LLM API error: %s", e)
    return "Something went wrong."
```

## Exponential backoff with jitter

When you need your own retry logic (custom conditions, other libraries), use **tenacity**:

```python
import openai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_random_exponential

@retry(
    retry=retry_if_exception_type((openai.RateLimitError, openai.APITimeoutError,
                                   openai.APIConnectionError, openai.InternalServerError)),
    wait=wait_random_exponential(min=1, max=60),     # 1s, 2s, 4s, 8s... capped, randomized
    stop=stop_after_attempt(6),
)
def chat(messages):
    return OpenAI(max_retries=0).chat.completions.create(model="gpt-4o-mini", messages=messages)
```

- **Exponential**: wait longer after each failure, giving the server room to recover.
- **Jitter** (randomness): stops 1,000 clients that failed together from retrying at the same instant.
- Turn off SDK retries (`max_retries=0`) when you add your own, or the attempts multiply.
- Respect the **`Retry-After`** header when the API sends one; the SDK does this for you.

## Rate limits

Providers limit you per minute on two axes:

- **RPM** — requests per minute.
- **TPM** — tokens per minute (input + max output). Large prompts hit this first.

Your current limits come back in response headers like `x-ratelimit-remaining-tokens`. Ways to stay under them:

1. **Cap concurrency** with a semaphore instead of firing everything at once:

```python
import asyncio
sem = asyncio.Semaphore(5)                    # at most 5 calls in flight

async def limited_chat(messages):
    async with sem:
        return await aclient.chat.completions.create(model="gpt-4o-mini", messages=messages)

results = await asyncio.gather(*(limited_chat(m) for m in batch))
```

2. **Send fewer tokens** — shorter prompts, lower `max_completion_tokens`.
3. **Use the Batch API** for offline jobs: separate, higher limits and ~50% cheaper, results within 24 hours.
4. **Queue** work instead of dropping it when you hit the limit.

## Other failures to plan for

- **Context too long** (400) — trim history or chunk the input before sending.
- **Truncated output** — `finish_reason == "length"`; not an exception, so check for it.
- **Bad output** — invalid JSON or a wrong answer is a "soft" failure; validate and retry with the error message included.
- **Provider outage** — for critical paths, fall back to another model or provider (LiteLLM routers do this).
- **Retrying non-idempotent tool actions** — retrying a call that already "sent the email" sends it twice. Make actions idempotent.

## Key terms

- **429** — HTTP "Too Many Requests"; rate limit or quota exceeded.
- **Exponential backoff** — doubling the wait between successive retries.
- **Jitter** — random variation added to retry delays to avoid synchronized retries.
- **RPM / TPM** — requests per minute / tokens per minute rate limits.
- **Idempotent** — safe to repeat; doing it twice has the same effect as once.

## Interview quick-fire

- **"Which LLM API errors should you retry?"** → Rate limits, timeouts, connection errors and 5xx; not 400/401/403/404, which fail the same way every time.
- **"Why add jitter to backoff?"** → So many clients that failed together don't retry in lockstep and overload the server again.
- **"How would you process 100k documents through an LLM without hitting limits?"** → Batch API if latency doesn't matter; otherwise bounded concurrency, backoff on 429, a queue, and token budgeting.
