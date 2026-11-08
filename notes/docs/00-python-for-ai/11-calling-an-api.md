---
title: "Calling an API (requests + JSON)"
---

## TL;DR

An LLM SDK is a thin wrapper around an **HTTP API**: you **POST** JSON to a URL with an **auth header** and get JSON back. Knowing how to do this by hand with **`requests`** (or **`httpx`**) means you can call any provider, any tool API (weather, search, your own backend) and debug SDK problems. The pattern is always: **build the request → send with a timeout → check the status code → parse the JSON → pull out the field you need**.

## HTTP in one table

| Piece | Example | Notes |
|---|---|---|
| Method | `GET`, `POST` | GET reads; POST sends a body (LLM calls are POST) |
| URL | `https://api.openai.com/v1/chat/completions` | Base URL + endpoint path |
| Headers | `Authorization: Bearer sk-...` | Auth, content type |
| Query params | `?city=Pune&units=metric` | Usually for GET |
| Body | `{"model": "...", "messages": [...]}` | JSON for POST |
| Status code | `200`, `401`, `429`, `500` | 2xx ok, 4xx your fault, 5xx theirs |

```
your code ──POST /v1/chat/completions──► API
          headers: Authorization, Content-Type
          body:    {"model": ..., "messages": [...]}
          ◄── 200 OK  {"choices": [{"message": {"content": "..."}}], "usage": {...}}
```

## GET: a simple tool API

```bash
pip install requests
```

```python
import requests

resp = requests.get(
    "https://api.open-meteo.com/v1/forecast",
    params={"latitude": 18.52, "longitude": 73.86, "current": "temperature_2m"},
    timeout=10,
)
resp.raise_for_status()                 # raises HTTPError on 4xx/5xx
data = resp.json()                      # JSON body -> dict
print(data["current"]["temperature_2m"])
```

This is exactly what a `get_weather` tool for an agent would do inside.

## POST: calling an LLM without the SDK

```python
import os
import requests
from dotenv import load_dotenv

load_dotenv()

resp = requests.post(
    "https://api.openai.com/v1/chat/completions",
    headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
    json={                                       # json= serialises + sets Content-Type
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Name three uses of embeddings."}],
        "temperature": 0.3,
    },
    timeout=60,
)

if resp.status_code != 200:
    print(resp.status_code, resp.text)           # error body explains what went wrong
else:
    body = resp.json()
    print(body["choices"][0]["message"]["content"])
    print("tokens:", body["usage"]["total_tokens"])
```

Same call with the SDK:

```python
from openai import OpenAI
reply = OpenAI().chat.completions.create(model="gpt-4o-mini", messages=[...])
```

The SDK adds retries, typed responses, streaming helpers and error classes. Use it for real apps; use raw HTTP to understand and debug.

## Other providers are the same shape

```python
# Anthropic Messages API: different URL, headers and body/response shape
resp = requests.post(
    "https://api.anthropic.com/v1/messages",
    headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"],
        "anthropic-version": "2023-06-01",
    },
    json={
        "model": "claude-...",                  # pick a current model id from their docs
        "max_tokens": 300,
        "messages": [{"role": "user", "content": "Hi"}],
    },
    timeout=60,
)
text = resp.json()["content"][0]["text"]
```

Many providers and local servers (Ollama, vLLM, Groq, OpenRouter) expose an **OpenAI-compatible** endpoint, so you just change the base URL. See [provider-agnostic clients](../02-calling-models/09-provider-agnostic-clients.md).

## Reading responses safely

```python
body = resp.json()
choice = body.get("choices", [{}])[0]
content = choice.get("message", {}).get("content")
finish = choice.get("finish_reason")

if finish == "length":
    print("Truncated: raise max tokens")
```

Print the whole body once (`import json; print(json.dumps(body, indent=2))`) to learn the shape before writing access code.

## Status codes and what to do

| Code | Meaning | Action |
|---|---|---|
| 200 | OK | Parse |
| 400 | Bad request (bad params, too many tokens) | Fix the request |
| 401 / 403 | Auth problem | Check the key |
| 404 | Wrong URL or model name | Check endpoint/model |
| 429 | Rate limited / quota | Wait and retry with backoff; respect `Retry-After` |
| 5xx | Server error | Retry with backoff |

A minimal retry:

```python
import time

def post_with_retry(url, **kwargs):
    for attempt in range(4):
        resp = requests.post(url, **kwargs)
        if resp.status_code not in (429, 500, 502, 503, 504):
            return resp
        time.sleep(2 ** attempt)                # 1, 2, 4, 8 seconds
    return resp
```

## httpx: requests with async

```python
import httpx

async with httpx.AsyncClient(timeout=30) as client:
    resp = await client.get("https://api.example.com/items", params={"q": "rag"})
```

The OpenAI SDK uses httpx under the hood. Use it when you need async (see [async basics](./12-async-basics-youll-see-in-agents.md)).

## Gotchas

- **Always set `timeout=`** — `requests` waits forever by default; one hung call freezes your app.
- **`json=` vs `data=`** — `json=` sends JSON; `data=` sends form-encoded data. LLM APIs want JSON.
- **Reuse connections** — for many calls, use `requests.Session()` (or one `httpx.Client`) instead of a new connection each time.
- **Don't print headers** — they contain your key.
- **Check content before `.json()`** — error pages may be HTML; `.json()` will raise.

## Key terms

- **HTTP method** — the action: GET retrieves, POST sends data.
- **Endpoint** — a specific URL path on an API.
- **Header** — request metadata such as `Authorization` and `Content-Type`.
- **Bearer token** — auth scheme sending the key as `Authorization: Bearer KEY`.
- **Status code** — numeric result of a request (2xx success, 4xx client error, 5xx server error).
- **OpenAI-compatible API** — any server accepting the same request/response format as OpenAI's chat completions.

## Interview quick-fire

- **"What does an LLM SDK actually do?"** → Builds an HTTP POST with your key and JSON body, sends it, handles retries/errors, and parses the JSON into typed objects.
- **"429 vs 500?"** → 429 means you're rate-limited (slow down, retry with backoff); 500 is a server-side error (retry).
- **"Why set a timeout?"** → Without one, a stuck connection blocks forever; with LLMs, set it generously but finite.
- **"How do you call a local model with OpenAI code?"** → Point the client's `base_url` at the local OpenAI-compatible server, e.g. Ollama.
