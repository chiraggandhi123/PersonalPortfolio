---
title: "Deploying an LLM App"
---

## TL;DR

Deploying an LLM app is mostly normal web deployment: **package it** (requirements or a Docker image), **keep secrets in environment variables**, and **host it** somewhere (Streamlit Community Cloud, Hugging Face Spaces, Render, Railway, a cloud VM or container service). The LLM-specific parts are **cost and abuse controls**, **timeouts and streaming**, and **logging prompts and outputs** so you can debug. Start on a free tier; move to containers when you need control.

## Hosting options

| Option | Good for | Notes |
|---|---|---|
| Streamlit Community Cloud | Streamlit demos | Connect a GitHub repo; secrets in the dashboard; apps sleep when idle |
| Hugging Face Spaces | Gradio/Streamlit demos, Docker apps | Free CPU tier; easy to share |
| Render / Railway / Fly.io | FastAPI backends, small production apps | Git push or Docker; free tiers sleep or are limited |
| Cloud containers (Cloud Run, App Runner, Azure Container Apps) | Production with autoscaling | Pay per use; more setup |
| VM (EC2, a VPS) | Full control, self-hosted models | You manage everything |

Free tiers and their limits change often. Check the provider's current docs.

## Deployment checklist

```
code ─► requirements.txt pinned ─► secrets in env vars ─► Dockerfile (optional)
     ─► health endpoint ─► deploy ─► smoke test ─► logs + usage alerts
```

## Pin dependencies and read config from env

```bash
pip freeze > requirements.txt     # or hand-pick: openai==1.x.y, fastapi==..., etc.
```

```python
# config.py
import os
from dotenv import load_dotenv

load_dotenv()                      # local dev only; hosts inject real env vars

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]          # crash early if missing
MODEL = os.getenv("MODEL", "gpt-4o-mini")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "800"))
```

Never commit `.env`. Add it to `.gitignore` before the first commit. If a key leaks, **revoke it** immediately; deleting the commit isn't enough.

## Dockerfile for a FastAPI app

```
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8000
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT}"]
```

For Streamlit, change the command to `streamlit run app.py --server.port $PORT --server.address 0.0.0.0`.

```bash
docker build -t my-llm-app .
docker run -p 8000:8000 --env-file .env my-llm-app
```

Most hosts set `PORT` for you; binding to `0.0.0.0` (not `localhost`) is required inside containers. A full CI/CD walkthrough is in [containerize & CI/CD](../08-agentops/08-containerize-ci-cd.md).

## LLM-specific production concerns

| Concern | What to do |
|---|---|
| Runaway cost | Set a spending limit in the provider dashboard; cap `max_tokens`; rate-limit per user |
| Abuse of your endpoint | Require auth or an API key; rate-limit by IP/user; reject huge inputs |
| Slow responses | Stream; set timeouts; show progress in the UI |
| Provider outages | Retries with backoff, a fallback model ([errors & retries](../02-calling-models/06-errors-retries-rate-limits.md)) |
| Debugging bad answers | Log prompt version, inputs, outputs, tokens and latency (LangSmith, Langfuse, or your own logs) |
| Prompt injection / misuse | Input and output checks ([prompt injection](./10-prompt-injection-basics.md)) |
| Privacy | Don't log sensitive data in plain text; know your provider's data retention terms |

## Simple per-user rate limit

```python
import time
from collections import defaultdict, deque
from fastapi import HTTPException, Request

WINDOW, LIMIT = 60, 10                       # 10 requests per minute
hits: dict[str, deque] = defaultdict(deque)

def rate_limit(request: Request):
    key = request.headers.get("x-api-key") or request.client.host
    now, q = time.time(), hits[key]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(429, "Too many requests, slow down.")
    q.append(now)

# use it: @app.post("/chat", dependencies=[Depends(rate_limit)])
```

In-memory limits reset on restart and don't work across several instances. Use Redis or your gateway's limiter for that.

## After deploying

- **Smoke test** the live URL with a real request, not just `/health`.
- **Watch usage** in the provider dashboard for the first few days.
- **Track cost per request** ([tracking tokens & cost](../02-calling-models/07-tracking-tokens-cost.md)).
- **Cold starts.** Free tiers sleep when idle; the first request can take many seconds.

## Key terms

- **Environment variable** — configuration (like API keys) supplied by the host, not stored in code.
- **Container image** — a packaged app with its dependencies, runnable anywhere Docker runs.
- **Health check** — a cheap endpoint the host calls to see if the app is alive.
- **Cold start** — delay when a sleeping or scaled-to-zero service receives its first request.
- **Spending limit** — a provider-side cap that stops API usage beyond a budget.

## Interview quick-fire

- **"How do you handle API keys in a deployed app?"** → Environment variables or a secrets manager, never in code or the client; rotate on leaks.
- **"What's different about deploying an LLM app vs. a normal web app?"** → Per-request cost, slow and variable latency, non-deterministic output, and new attack surfaces like prompt injection.
- **"How do you stop someone draining your API budget?"** → Auth, per-user rate limits, input size limits, `max_tokens` caps and a provider spending limit.
- **"Why bind to 0.0.0.0 in Docker?"** → `localhost` inside a container isn't reachable from outside it.
