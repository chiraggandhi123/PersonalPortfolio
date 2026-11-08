---
title: "Deploy on Render for Free with Docker"
---

## TL;DR

**Render** can build and run the same **Dockerfile** from the last note straight from your GitHub repo, with **auto-deploy on every push** and HTTPS included, on a free tier. The catch: free instances **sleep when idle** (slow first request) and have an **ephemeral disk**, so the SQLite `chatbot.db` is wiped on every restart or deploy. Fix that by switching the checkpointer to **Postgres** via a `DATABASE_URL`, using a free hosted Postgres.

## AWS vs. Render

| | AWS (EC2 + ECR + Actions) | Render |
|---|---|---|
| Setup | IAM, OIDC, ECR, EC2, workflow file | Connect repo, click deploy |
| HTTPS | You add a load balancer or proxy | Included |
| Deploys | Your GitHub Actions pipeline | Auto on push (or deploy hook) |
| Free option | Limited trial credits | Free web service tier |
| Idle behavior | Always on | Free tier sleeps after inactivity |
| Disk | Persistent EBS volume | Ephemeral on free tier |
| Control | Full | Less, but far less to manage |

Render is ideal for demos and portfolios. AWS gives you control for production.

## The flow

```
git push main ──► Render detects commit ──► docker build (your Dockerfile)
                                               │
                                               ▼
                           container starts with PORT=10000 (injected)
                                               │
          https://agentic-chatbot.onrender.com ┘
                                               │
                         checkpointer ──► Postgres (DATABASE_URL)
```

## Step 1: the Dockerfile already fits

The `CMD` from the previous note reads `${PORT:-8501}`. Render sets `PORT`, so Streamlit binds to the port Render expects without any change. `--server.address=0.0.0.0` is required; binding to localhost makes the service unreachable.

## Step 2: make persistence survive — `backend.py`

```bash
pip install "langgraph-checkpoint-postgres" "psycopg[binary]"
```

Add both to `requirements.txt`. Then replace the SQLite lines in `backend.py`:

```python
import os
import sqlite3

from langgraph.checkpoint.sqlite import SqliteSaver


def make_checkpointer():
    """Postgres when DATABASE_URL is set (Render), SQLite otherwise (local, EC2)."""
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg import Connection
        from psycopg.rows import dict_row

        conn = Connection.connect(db_url, autocommit=True, prepare_threshold=0, row_factory=dict_row)
        saver = PostgresSaver(conn)
        saver.setup()                     # creates checkpoint tables on first run
        return saver
    conn = sqlite3.connect(os.getenv("CHATBOT_DB", "chatbot.db"), check_same_thread=False)
    return SqliteSaver(conn)


checkpointer = make_checkpointer()
```

Nothing else changes. `retrieve_all_threads`, `load_messages` and `pending_interrupt` use the checkpointer interface, which both savers implement. Even HITL pauses now survive a Render restart.

Free Postgres options: Neon, Supabase, or Render's own Postgres (its free database expires after a limited period). Copy the connection string, with `?sslmode=require` if the provider needs it.

## Step 3: create the service

**Dashboard route:**

1. Push the repo to GitHub.
2. Render → **New** → **Web Service** → connect the repo.
3. Runtime: **Docker**. Instance type: **Free**.
4. **Environment**: add `OPENAI_API_KEY`, `TAVILY_API_KEY`, `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `DATABASE_URL`.
5. **Health check path**: `/_stcore/health`.
6. Deploy and watch the build logs.

**Blueprint route** — commit `render.yaml` so the setup lives in git:

```yaml
services:
  - type: web
    name: agentic-chatbot
    runtime: docker
    plan: free
    healthCheckPath: /_stcore/health
    autoDeploy: true
    envVars:
      - key: OPENAI_API_KEY
        sync: false            # set the value in the dashboard, not in git
      - key: TAVILY_API_KEY
        sync: false
      - key: DATABASE_URL
        sync: false
      - key: LANGSMITH_TRACING
        value: "true"
      - key: LANGSMITH_API_KEY
        sync: false
      - key: LANGSMITH_PROJECT
        value: agentic-chatbot-render
```

Then **New** → **Blueprint** and pick the repo.

## Step 4: keep CI in front of it

Auto-deploy ships every push, even broken ones. Two options:

- Turn on Render's option to wait for CI checks to pass before deploying.
- Or set `autoDeploy: false`, create a **Deploy Hook** URL, and call it from the GitHub Actions `test` job after `pytest` passes:

```yaml
      - name: Trigger Render deploy
        if: github.ref == 'refs/heads/main'
        run: curl -fsS -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}"
```

## Living with the free tier

- **Cold starts**: after a stretch of no traffic the instance sleeps; the next visit waits while it wakes. Fine for a portfolio, not for an SLA.
- **Limited RAM**: keep dependencies lean. Streamlit plus LangGraph fits; loading local embedding models may not.
- **Ephemeral disk**: anything written to the container filesystem is lost on restart. That's why the checkpointer goes to Postgres.
- **Public URL**: anyone can use your API budget. Add a password gate (`st.secrets` or a simple env-based check) and set a spending limit with your model provider.

## Gotchas

- **"No open ports detected"**: the app is listening on the wrong port or on localhost. Check the `CMD` uses `$PORT` and `0.0.0.0`.
- **Postgres errors on startup**: `PostgresSaver` needs `autocommit=True` and `row_factory=dict_row` on the connection; and `setup()` must run once.
- **SSL errors** connecting to hosted Postgres: add `sslmode=require` to the URL.
- **Keys in `render.yaml`**: use `sync: false` and set values in the dashboard.
- **Idle connection drops**: a single long-lived Postgres connection can be closed by the provider. For production, use a `psycopg_pool.ConnectionPool`.

## Key terms

- **Render** — a managed platform that builds and runs web services from a repo.
- **Web service** — a Render service type that exposes an HTTP port to the internet.
- **Blueprint** — Render's infrastructure-as-code file, `render.yaml`.
- **Ephemeral filesystem** — container storage that is reset on restart or redeploy.
- **Cold start** — the delay when a sleeping instance is woken by a request.
- **Deploy hook** — a secret URL that triggers a deploy when called.

## Interview quick-fire

- **"Why would SQLite persistence break on Render's free tier?"** → The filesystem is ephemeral, so the DB file is wiped on every restart or deploy; use an external database like Postgres.
- **"How do you make one Dockerfile work on several platforms?"** → Read the port and config from environment variables (`${PORT:-8501}`, `DATABASE_URL`) and keep secrets out of the image.
- **"PaaS like Render vs. raw AWS?"** → PaaS is faster to set up with HTTPS and deploys built in; AWS gives more control, always-on instances and private networking at the cost of more setup.
- **"How do you stop broken commits auto-deploying?"** → Gate deploys on CI: wait for checks, or trigger a deploy hook only after tests pass.
