---
title: "Self-Correcting Multi-Agent App on DigitalOcean"
---

## Goal

Build a **self-correcting code assistant**: a coder agent writes a Python function, an executor **runs it against generated tests**, and a critic reads the failures and tells the coder what to fix. The loop repeats until the tests pass or a retry cap is hit. Wrap it in FastAPI, containerize it, and **deploy it to DigitalOcean App Platform**. The point is the feedback loop: the agent checks its work against reality (test results), not against its own opinion.

**Skills practiced:** reflection / self-correction loops, grounding feedback in execution, retry caps, sandboxing generated code, FastAPI, Docker, DigitalOcean App Platform deployment.

## Architecture

```
POST /solve {"task": "..."}
        │
        ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ test_writer  │ ──► │    coder     │ ──► │   executor   │  (subprocess, timeout)
└──────────────┘     └──────▲───────┘     └──────┬───────┘
                            │                    │ pass ──────────────► END (code + report)
                            │                    │ fail
                     ┌──────┴───────┐            │
                     │    critic    │ ◄──────────┘
                     └──────────────┘   attempts ≥ 3 ──────────────────► END (best effort)

Docker image ─► DigitalOcean Container Registry ─► App Platform (HTTPS, env secrets)
```

## Setup

```bash
pip install langgraph langchain-openai fastapi "uvicorn[standard]" python-dotenv
```

`.env` (never commit; on DigitalOcean set it as an encrypted env var):

```
OPENAI_API_KEY=sk-...
```

## Code

### `graph.py`

```python
import subprocess, sys, tempfile
from typing import TypedDict
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
MAX_ATTEMPTS = 3

class Code(BaseModel):
    code: str = Field(description="Only Python source, no markdown fences")

class State(TypedDict, total=False):
    task: str
    tests: str
    code: str
    result: str
    passed: bool
    feedback: str
    attempts: int

def test_writer(s: State):
    t = llm.with_structured_output(Code).invoke(
        f"Write 4-6 plain `assert` statements testing a function for this task. "
        f"Include edge cases. Do not define the function.\n\nTask: {s['task']}")
    return {"tests": t.code, "attempts": 0}

def coder(s: State):
    prompt = f"Write a Python function for this task.\nTask: {s['task']}\n"
    if s.get("feedback"):
        prompt += f"\nYour previous code:\n{s['code']}\nFix it. Critic says:\n{s['feedback']}"
    return {"code": llm.with_structured_output(Code).invoke(prompt).code,
            "attempts": s["attempts"] + 1}

def executor(s: State):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(s["code"] + "\n\n" + s["tests"] + "\nprint('ALL TESTS PASSED')\n")
    try:
        proc = subprocess.run([sys.executable, "-I", f.name], capture_output=True,
                              text=True, timeout=10)
        out = (proc.stdout + proc.stderr)[-2000:]
        return {"result": out, "passed": proc.returncode == 0}
    except subprocess.TimeoutExpired:
        return {"result": "Timed out after 10s (infinite loop?)", "passed": False}

def critic(s: State):
    fb = llm.invoke(
        f"The code failed its tests.\nCode:\n{s['code']}\nTests:\n{s['tests']}\n"
        f"Output:\n{s['result']}\n\nExplain the root cause in 2-3 bullet points. "
        "If a test itself looks wrong, say so.").content
    return {"feedback": fb}

def route(s: State):
    if s["passed"] or s["attempts"] >= MAX_ATTEMPTS:
        return END
    return "critic"

g = StateGraph(State)
g.add_node("test_writer", test_writer)
g.add_node("coder", coder)
g.add_node("executor", executor)
g.add_node("critic", critic)
g.add_edge(START, "test_writer")
g.add_edge("test_writer", "coder")
g.add_edge("coder", "executor")
g.add_conditional_edges("executor", route, ["critic", END])
g.add_edge("critic", "coder")
app = g.compile()
```

### `main.py`

```python
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI
from pydantic import BaseModel
from graph import app as graph

api = FastAPI()

class Task(BaseModel):
    task: str

@api.get("/health")
def health():
    return {"ok": True}

@api.post("/solve")
def solve(body: Task):
    s = graph.invoke({"task": body.task})
    return {"passed": s["passed"], "attempts": s["attempts"], "code": s["code"],
            "tests": s["tests"], "last_output": s["result"]}
```

### `Dockerfile`

```
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m runner && chown -R runner /app
USER runner
EXPOSE 8080
CMD ["uvicorn", "main:api", "--host", "0.0.0.0", "--port", "8080"]
```

### Deploy to DigitalOcean App Platform

```bash
docker build -t self-correcting-agent .
docker run -p 8080:8080 --env-file .env self-correcting-agent   # test locally first

doctl registry login
docker tag self-correcting-agent registry.digitalocean.com/<your-registry>/self-correcting-agent:v1
docker push registry.digitalocean.com/<your-registry>/self-correcting-agent:v1
```

Then in the App Platform dashboard: **Create App → Container image → DigitalOcean Container Registry**, choose the image, set HTTP port `8080`, health check `/health`, and add `OPENAI_API_KEY` as an encrypted environment variable. Alternatively, connect the GitHub repo and let App Platform build the Dockerfile on every push. A basic Droplet with Docker and a reverse proxy (Caddy) also works if you want full control.

## How it works

1. **Tests first.** The test writer creates asserts from the task alone, before any code exists, so the coder can't write tests that fit its own bugs.
2. **Coder** writes the function. On retries, it gets its old code plus the critic's diagnosis.
3. **Executor** is plain Python, not an LLM. It runs the code in a separate process with `-I` (isolated mode) and a timeout. This is the **grounding signal**: real pass or fail.
4. **Critic** turns a raw traceback into a short root-cause explanation. Separating "diagnose" from "fix" gives the coder clearer instructions than a raw stack trace.
5. **Route** stops on success or after three attempts. Without a cap, a self-correcting loop can spin forever on an impossible task.

The critic may decide a test is wrong. A stretch goal is to let it send work back to the test writer.

## Safety note

Running LLM-written code is risky. A subprocess with a timeout is **not a sandbox**: the code can still read files and use the network. In production, run it in a locked-down container (no network, read-only filesystem, CPU and memory limits) or a hosted sandbox such as E2B or Modal.

## Stretch goals

- [ ] Run generated code in a separate no-network container instead of a subprocess.
- [ ] Let the critic route back to `test_writer` when it judges a test to be wrong.
- [ ] Return a streaming log of each attempt (SSE) so users see the loop working.
- [ ] Add LangSmith tracing and chart attempts-per-task over time.
- [ ] GitHub Actions: build, push to DOCR and trigger an App Platform deploy on merge.
- [ ] Benchmark: pass rate on 20 small coding tasks, with and without the critic.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
