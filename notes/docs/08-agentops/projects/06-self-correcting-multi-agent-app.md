---
title: "Self-Correcting Multi-Agent App (DigitalOcean)"
---

## Goal

Build an app where agents **check and fix their own work**: a **coder** agent writes a Python function, an **executor** runs it against tests in a sandboxed subprocess, and a **critic** agent reads the failures and tells the coder what to fix. The loop repeats until the tests pass or a retry budget runs out. Then ship it as a FastAPI service on **DigitalOcean App Platform** from a Dockerfile.

**Skills practiced:** LangGraph cycles, generator/critic pattern, grounding feedback in real execution results, sandboxing generated code, retry budgets, Docker, DigitalOcean App Platform.

## Architecture

```
POST /solve {task, tests}
      │
      ▼
  coder ──► executor ──(all tests pass)──► END: code + attempts
    ▲          │
    │          │ failures / traceback
    │          ▼
    └──── critic  (diagnoses, writes fix instructions)
          stop when attempts == MAX_ATTEMPTS → END: best effort + errors

Deployed:  GitHub ──push──► DigitalOcean App Platform ──► https://APP.ondigitalocean.app
```

The key idea: **feedback comes from running the code**, not from the model judging itself. Self-critique without an external signal often just agrees with itself.

## Setup

```bash
pip install langgraph langchain-openai fastapi uvicorn python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code — `agents.py`

```python
import os, subprocess, sys, tempfile
from typing import TypedDict
from dotenv import load_dotenv
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)
MAX_ATTEMPTS = 4

class State(TypedDict):
    task: str
    tests: str
    code: str
    feedback: str
    errors: str
    passed: bool
    attempts: int

class Code(BaseModel):
    code: str          # full Python source, no markdown fences

def coder(state: State):
    prompt = (f"Write Python code for this task:\n{state['task']}\n\n"
              f"It must pass these pytest tests:\n{state['tests']}\n")
    if state.get("feedback"):
        prompt += (f"\nYour previous code:\n{state['code']}\n"
                   f"\nReviewer feedback:\n{state['feedback']}\nFix it.")
    out = llm.with_structured_output(Code).invoke(prompt)
    return {"code": out.code, "attempts": state.get("attempts", 0) + 1}

def executor(state: State):
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, "solution.py"), "w").write(state["code"])
        open(os.path.join(d, "test_solution.py"), "w").write(
            "from solution import *\n" + state["tests"])
        try:
            r = subprocess.run(
                [sys.executable, "-m", "pytest", "-q", "-x", "--no-header", d],
                capture_output=True, text=True, timeout=20, cwd=d,
                env={"PATH": os.environ["PATH"]},     # no API keys passed to generated code
            )
            return {"passed": r.returncode == 0, "errors": r.stdout[-3000:]}
        except subprocess.TimeoutExpired:
            return {"passed": False, "errors": "Timed out after 20s (infinite loop?)"}

def critic(state: State):
    msg = llm.invoke(
        "You are reviewing code that failed its tests. Explain the root cause in 2-3 "
        "sentences and give specific fix instructions. Do not write the full code.\n\n"
        f"Task: {state['task']}\n\nCode:\n{state['code']}\n\nTest output:\n{state['errors']}"
    )
    return {"feedback": msg.content}

def after_exec(state: State) -> str:
    if state["passed"] or state["attempts"] >= MAX_ATTEMPTS:
        return END
    return "critic"

g = StateGraph(State)
g.add_node("coder", coder)
g.add_node("executor", executor)
g.add_node("critic", critic)
g.add_edge(START, "coder")
g.add_edge("coder", "executor")
g.add_conditional_edges("executor", after_exec, ["critic", END])
g.add_edge("critic", "coder")
graph = g.compile()
```

## Code — `app.py`

```python
from fastapi import FastAPI
from pydantic import BaseModel
from agents import graph

app = FastAPI()

class SolveRequest(BaseModel):
    task: str
    tests: str

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/solve")
def solve(req: SolveRequest):
    s = graph.invoke({"task": req.task, "tests": req.tests})
    return {"passed": s["passed"], "attempts": s["attempts"],
            "code": s["code"], "last_errors": None if s["passed"] else s["errors"]}
```

```bash
uvicorn app:app --reload
curl -X POST localhost:8000/solve -H "Content-Type: application/json" -d '{
  "task": "Write is_palindrome(s) that ignores case, spaces and punctuation.",
  "tests": "def test_a():\n    assert is_palindrome(\"A man, a plan, a canal: Panama\")\ndef test_b():\n    assert not is_palindrome(\"hello\")"
}'
```

## Deploy on DigitalOcean App Platform

`Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt pytest
COPY . .
RUN useradd -m app && chown -R app /app
USER app
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

`.do/app.yaml` (app spec; check DigitalOcean's docs for current field names and instance sizes):

```yaml
name: self-correcting-agents
services:
  - name: api
    github:
      repo: YOUR_USER/self-correcting-agents
      branch: main
      deploy_on_push: true
    dockerfile_path: Dockerfile
    http_port: 8080
    health_check:
      http_path: /health
    envs:
      - key: OPENAI_API_KEY
        scope: RUN_TIME
        type: SECRET
```

Create it with `doctl apps create --spec .do/app.yaml` or in the dashboard (**Create → App → GitHub repo**). Set the secret value in the dashboard. A **Droplet** running `docker run` is the cheaper, more hands-on alternative.

## How it works

1. **Coder** returns code through structured output, so there are no markdown fences to strip.
2. **Executor** writes the code and tests to a temp dir and runs pytest in a subprocess with a timeout and a stripped environment, so generated code can't read your API key.
3. **Router** ends on success or when the attempt budget is spent; otherwise it goes to the critic.
4. **Critic** turns raw pytest output into a diagnosis. Keeping critic and coder separate stops the coder from defending its own mistakes.
5. **Loop** — the coder sees its previous code plus feedback, and tries again.

A subprocess is **not a real sandbox**. For a public deployment, run generated code in a separate locked-down container or a sandbox service (E2B, Modal), with no network.

## Stretch goals

- [ ] **Real isolation** — run the executor in a throwaway container with `--network none`.
- [ ] **Test generator agent** — when the user gives no tests, an agent writes them first (and a human approves).
- [ ] **Keep the best attempt** — track the attempt with the most passing tests, return it if none fully pass.
- [ ] **Streaming progress** — stream each node's output to the client with Server-Sent Events.
- [ ] **Metrics** — log attempts-to-success and tokens per task; plot how often the loop actually helps.
- [ ] **Eval set** — 30 small coding tasks; compare one-shot vs self-correcting pass rate.
- [ ] **Use DigitalOcean's GenAI platform** models instead of OpenAI and compare.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
