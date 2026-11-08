---
title: "Google ADK: Build & Deploy Agents to Cloud"
---

## Goal

Build a small multi-agent **trip helper** with **Google's Agent Development Kit (ADK)**, test it locally in ADK's dev UI, then **deploy it to Google Cloud Run** as an HTTPS API. The point is the full path from `adk web` on your laptop to a public, autoscaling service with secrets handled properly. See the [Agents SDK and ADK note](../../07-agentic-ai/05-openai-agents-sdk-google-adk.md) for the basics.

**Skills practiced:** ADK agents and tools, sub-agent delegation, model swapping via LiteLLM, ADK dev UI, FastAPI serving, Docker, Cloud Run, Secret Manager.

## Architecture

```
            local:  adk web  (dev UI at localhost:8000)
            cloud:  Cloud Run ─ FastAPI (get_fast_api_app) ─┐
                                                            ▼
                     root_agent "trip_helper"  (coordinator)
                       ├── weather_agent   tool: get_weather(city)
                       └── packing_agent   tool: packing_list(temp_c, days)
                                   │
                         model: gpt-4o-mini via LiteLLM  (or Gemini)
                                   │
                         OPENAI_API_KEY from Secret Manager
```

## Setup

```bash
pip install google-adk litellm python-dotenv
```

ADK expects one folder per agent:

```
project/
└── trip_helper/
    ├── __init__.py       # from . import agent
    ├── agent.py          # defines root_agent
    └── .env
```

`trip_helper/.env`:

```
OPENAI_API_KEY=sk-...
# For Gemini instead: GOOGLE_API_KEY=... (AI Studio) or GOOGLE_GENAI_USE_VERTEXAI=TRUE + project/location
```

`trip_helper/__init__.py`:

```python
from . import agent
```

## Code — `trip_helper/agent.py`

```python
from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

MODEL = LiteLlm(model="openai/gpt-4o-mini")   # or simply MODEL = "gemini-2.0-flash"

FAKE_WEATHER = {"pune": 31, "manali": 8, "goa": 29}

def get_weather(city: str) -> dict:
    """Get the current temperature in Celsius for a city."""
    temp = FAKE_WEATHER.get(city.lower())
    if temp is None:
        return {"status": "error", "message": f"No data for {city}"}
    return {"status": "ok", "city": city, "temp_c": temp}

def packing_list(temp_c: int, days: int) -> dict:
    """Suggest a packing list for a trip given temperature and number of days."""
    items = ["toothbrush", "phone charger", f"{days} sets of clothes"]
    items += ["jacket", "thermals"] if temp_c < 15 else ["sunscreen", "cap"]
    return {"status": "ok", "items": items}

weather_agent = Agent(
    name="weather_agent",
    model=MODEL,
    description="Answers questions about current weather in a city.",
    instruction="Use get_weather. Report the temperature plainly.",
    tools=[get_weather],
)

packing_agent = Agent(
    name="packing_agent",
    model=MODEL,
    description="Builds packing lists for trips.",
    instruction="Ask for city weather from context if needed, then call packing_list.",
    tools=[packing_list],
)

root_agent = Agent(
    name="trip_helper",
    model=MODEL,
    description="Coordinates trip planning questions.",
    instruction=(
        "You help users prepare for trips. Delegate weather questions to weather_agent "
        "and packing questions to packing_agent. Keep answers short."
    ),
    sub_agents=[weather_agent, packing_agent],
)
```

Run locally from `project/`:

```bash
adk web          # browser dev UI: chat, see events, tool calls, state
adk run trip_helper   # terminal chat
```

## Code — serving it as an API (`project/main.py`)

```python
import os
import uvicorn
from google.adk.cli.fast_api import get_fast_api_app

app = get_fast_api_app(
    agents_dir=os.path.dirname(os.path.abspath(__file__)),
    web=False,                     # True also serves the dev UI
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
```

`project/requirements.txt`:

```
google-adk
litellm
```

`project/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m app && chown -R app /app
USER app
CMD ["python", "main.py"]
```

## Deploy to Cloud Run

```bash
gcloud config set project MY_PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
printf "sk-..." | gcloud secrets create openai-key --data-file=-

gcloud run deploy trip-helper \
  --source . \
  --region asia-south1 \
  --set-secrets OPENAI_API_KEY=openai-key:latest \
  --allow-unauthenticated
```

Grant the Cloud Run service account the **Secret Manager Secret Accessor** role if the deploy complains. Don't copy the `.env` into the image: add it to `.dockerignore`.

ADK also has a one-liner, `adk deploy cloud_run`, that generates the container for you (check `adk deploy cloud_run --help` for current flags), and a path to Vertex AI Agent Engine for managed hosting.

## How it works

1. **Agent tree** — `root_agent` sees each sub-agent's `description` and transfers control to the best one. Sub-agents can transfer back.
2. **Tools** — ADK builds tool schemas from function signatures and docstrings, just like FastMCP. Returning a dict with a `status` key helps the model handle errors.
3. **Sessions** — the API server keeps conversation state per session (in memory by default). Create a session, then send messages to the run endpoint; the `/docs` page lists the exact routes.
4. **Cloud Run** — builds the Dockerfile with Cloud Build, stores the image, runs it with `PORT` set, and injects the secret as an env var.

## Stretch goals

- [ ] **Real weather** — swap the fake dict for a weather API tool.
- [ ] **Persistent sessions** — pass a database session service URI (Cloud SQL) so chats survive restarts and scale-out.
- [ ] **Lock it down** — remove `--allow-unauthenticated` and call it with an identity token.
- [ ] **Add an MCP tool** with ADK's MCP toolset support.
- [ ] **Expose over A2A** so another agent can call `trip_helper`.
- [ ] **Evals** — write an ADK eval set (`adk eval`) and run it in CI before deploy.
- [ ] **CI/CD** — GitHub Actions with Workload Identity Federation to deploy on push.
- [ ] **Switch to Gemini on Vertex AI** and compare latency and cost.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
