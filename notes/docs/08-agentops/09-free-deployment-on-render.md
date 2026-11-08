---
title: "Free Deployment on Render"
---

## TL;DR

**Render** is a platform-as-a-service: connect a GitHub repo, tell it how to build and start your app, and it gives you an **HTTPS URL** and **redeploys on every push**. It has a **free tier** for web services that is good enough for demos and portfolios. The catch: free services **spin down when idle** (the first request after a sleep is slow), have limited RAM/CPU and no persistent disk. Describe your service in a **`render.yaml` blueprint** so the setup lives in git.

## How Render deploys

```
git push ──► GitHub ──webhook──► Render
                                  ├─ build:  pip install -r requirements.txt   (or docker build)
                                  ├─ start:  uvicorn app:app --host 0.0.0.0 --port $PORT
                                  └─ https://your-agent.onrender.com
```

Render injects a `PORT` environment variable. Your app **must listen on `0.0.0.0` and that port**.

## Option 1: native Python service

Project layout:

```
my-agent/
├── app.py              # FastAPI app (same as the Docker note)
├── requirements.txt
└── render.yaml
```

```yaml
# render.yaml
services:
  - type: web
    name: my-agent
    runtime: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: OPENAI_API_KEY
        sync: false          # you type the value in the dashboard; it is not stored in git
      - key: PYTHON_VERSION
        value: "3.12.4"
```

In the dashboard: **New → Blueprint**, pick the repo, fill in `OPENAI_API_KEY`. Done.

## Option 2: Docker

If you already have a Dockerfile, set `runtime: docker` and Render builds and runs your image. Make the start command respect `$PORT`:

```dockerfile
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

## Streamlit or Gradio front ends

```
startCommand: streamlit run ui.py --server.port $PORT --server.address 0.0.0.0
```

For Gradio, pass `server_name="0.0.0.0", server_port=int(os.environ["PORT"])` to `launch()`.

## Free tier realities

| Limitation | What it means for an agent | Workaround |
|---|---|---|
| Spins down after idle time | First request takes tens of seconds (cold start) | Fine for demos; upgrade or ping it for always-on |
| Small RAM | No local models, no big embedding models | Call hosted APIs; use a hosted vector DB |
| Ephemeral filesystem | Files and local SQLite/Chroma vanish on redeploy/restart | Use Render Postgres, Supabase, Pinecone, Qdrant Cloud |
| Request timeouts and limited CPU | Long agent runs can be cut off | Stream responses; move long jobs to a background worker |

Free-tier limits change, so check Render's current pricing page before relying on them.

## Other services on Render

- **Background worker** (`type: worker`) — runs a long-lived process without HTTP, e.g. a Telegram bot using polling or a queue consumer.
- **Cron job** (`type: cron`) — runs on a schedule, e.g. nightly evals or a daily digest agent.
- **Postgres / Key Value (Redis-compatible)** — managed data stores; free instances are limited and may expire.

## Deploy checklist

- `requirements.txt` with pinned versions.
- App binds `0.0.0.0:$PORT`.
- A `/health` endpoint.
- Secrets set in the dashboard (`sync: false`), `.env` in `.gitignore`.
- Auto-deploy on push to `main`; use PR previews if you want test URLs.
- Add basic auth or an API key check, so strangers can't spend your OpenAI credits.

```python
from fastapi import Header, HTTPException
import os

def require_key(x_api_key: str = Header(...)):
    if x_api_key != os.environ["APP_API_KEY"]:
        raise HTTPException(status_code=401)
```

## Alternatives

Railway, Fly.io, Hugging Face Spaces (great for Gradio/Streamlit demos), Google Cloud Run (generous free usage, scales to zero), Vercel (better for JS front ends than long Python agent calls).

## Key terms

- **PaaS** — platform-as-a-service: you push code, the platform builds, runs and scales it.
- **Blueprint (`render.yaml`)** — infrastructure-as-code file describing your Render services.
- **Cold start** — the delay when a sleeping service has to boot to serve a request.
- **Ephemeral filesystem** — local disk that is wiped on restart or redeploy.
- **Background worker** — a service type that runs continuously without receiving HTTP traffic.

## Interview quick-fire

- **"Why does my Render app fail with 'no open ports detected'?"** → It's listening on localhost or a hard-coded port; bind to `0.0.0.0` and `$PORT`.
- **"Why is the first request slow on the free tier?"** → The service spun down while idle and has to cold start.
- **"Why did my Chroma index disappear?"** → The filesystem is ephemeral; use a managed database or persistent disk on a paid plan.
- **"How do you stop strangers burning your API credits?"** → Require an API key or login, and add rate limiting.
