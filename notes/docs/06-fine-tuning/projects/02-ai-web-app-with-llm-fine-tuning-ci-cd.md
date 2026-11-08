---
title: "AI Web App with LLM Fine-Tuning + CI/CD"
---

## Goal

Build a small web app (a support-ticket classifier) backed by a **fine-tuned model**, where **training, evaluation and deployment are automated with GitHub Actions**. Pushing new training data triggers a fine-tuning job; the new model only goes live if it **beats the current one on an eval gate**. Treat the model like code: versioned, tested, reviewed and deployed by a pipeline.

**Skills practiced:** OpenAI fine-tuning API, dataset validation, eval gates, FastAPI, Docker, GitHub Actions, secrets management, model versioning and rollback.

## Architecture

```
 push data/*.jsonl ─► GitHub Actions: finetune.yml
                        1. validate data
                        2. start fine-tune job (OpenAI) and wait
                        3. eval gate: new model vs current model on eval.jsonl
                        4. if better → open PR updating model.json
                                         │ (human reviews + merges)
                                         ▼
 push to main ──────► GitHub Actions: ci.yml
                        1. unit tests (LLM mocked)
                        2. build Docker image
                        3. trigger deploy (Render deploy hook)
                                         │
                                         ▼
                user ─► FastAPI app ─► model from model.json ─► label
```

Hosted fine-tuning keeps CI on normal CPU runners. The same pipeline shape works for a QLoRA job on a GPU runner or a cloud training service.

## Setup

```bash
pip install openai fastapi uvicorn pydantic pytest httpx python-dotenv
```

`.env` locally, and the same values as **GitHub repository secrets**:

```
OPENAI_API_KEY=sk-...
RENDER_DEPLOY_HOOK=https://api.render.com/deploy/srv-...
```

Repo layout:

```
data/train.jsonl  data/eval.jsonl   model.json
scripts/validate_data.py  scripts/finetune.py  scripts/eval_gate.py
app/main.py  tests/test_app.py  Dockerfile
.github/workflows/finetune.yml  .github/workflows/ci.yml
```

`model.json` starts as `{"model": "gpt-4o-mini"}`, the prompt-only baseline.

## Code — `scripts/validate_data.py`

```python
import json, sys
LABELS = {"billing", "bug", "feature_request", "account", "other"}

def check(path: str) -> int:
    seen = set()
    for i, line in enumerate(open(path), 1):
        msgs = json.loads(line)["messages"]
        assert [m["role"] for m in msgs] == ["system", "user", "assistant"], f"{path}:{i} roles"
        assert msgs[2]["content"] in LABELS, f"{path}:{i} bad label {msgs[2]['content']!r}"
        assert msgs[1]["content"] not in seen, f"{path}:{i} duplicate"
        seen.add(msgs[1]["content"])
    return len(seen)

train, ev = check("data/train.jsonl"), check("data/eval.jsonl")
overlap = {json.loads(l)["messages"][1]["content"] for l in open("data/train.jsonl")} & \
          {json.loads(l)["messages"][1]["content"] for l in open("data/eval.jsonl")}
assert not overlap, f"{len(overlap)} eval examples leak into train"
print(f"ok: {train} train, {ev} eval")
```

## Code — `scripts/finetune.py`

```python
import time
from openai import OpenAI

client = OpenAI()
f = client.files.create(file=open("data/train.jsonl", "rb"), purpose="fine-tune")
job = client.fine_tuning.jobs.create(training_file=f.id, model="gpt-4o-mini-2024-07-18",
                                     suffix="tickets")
while job.status not in ("succeeded", "failed", "cancelled"):
    time.sleep(60)
    job = client.fine_tuning.jobs.retrieve(job.id)
    print(job.status)

if job.status != "succeeded":
    raise SystemExit(f"fine-tune {job.status}: {job.error}")
open("new_model.txt", "w").write(job.fine_tuned_model)
```

## Code — `scripts/eval_gate.py`

```python
import json, sys
from openai import OpenAI

client = OpenAI()
rows = [json.loads(l)["messages"] for l in open("data/eval.jsonl")]

def accuracy(model: str) -> float:
    hits = 0
    for m in rows:
        r = client.chat.completions.create(model=model, temperature=0, messages=m[:2])
        hits += r.choices[0].message.content.strip().lower() == m[2]["content"]
    return hits / len(rows)

current = json.load(open("model.json"))["model"]
new = open("new_model.txt").read().strip()
cur_acc, new_acc = accuracy(current), accuracy(new)
print(f"current {current}: {cur_acc:.3f}\nnew {new}: {new_acc:.3f}")

if new_acc < cur_acc + 0.01:                      # must win by at least 1 point
    sys.exit("eval gate failed: keeping current model")
json.dump({"model": new, "eval_accuracy": new_acc}, open("model.json", "w"), indent=2)
```

## Code — `app/main.py`

```python
import json
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from openai import OpenAI
from pydantic import BaseModel, Field

SYSTEM = "Classify the support ticket. Reply with one label."
LABELS = {"billing", "bug", "feature_request", "account", "other"}
MODEL = json.load(open("model.json"))["model"]
client = OpenAI()
app = FastAPI()

class Ticket(BaseModel):
    text: str = Field(min_length=3, max_length=4000)

@app.post("/classify")
def classify(t: Ticket):
    r = client.chat.completions.create(
        model=MODEL, temperature=0, max_tokens=5,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": t.text}],
    )
    label = r.choices[0].message.content.strip().lower()
    return {"label": label if label in LABELS else "other", "model": MODEL}

@app.get("/", response_class=HTMLResponse)
def home():
    return """<form onsubmit="event.preventDefault();fetch('/classify',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t.value})})
      .then(r=>r.json()).then(d=>out.textContent=d.label)">
      <textarea id="t" rows="5" cols="60"></textarea><br><button>Classify</button>
      <p id="out"></p></form>"""
```

## Code — `tests/test_app.py`

```python
from types import SimpleNamespace
from fastapi.testclient import TestClient
import app.main as main

def fake_create(**kwargs):
    msg = SimpleNamespace(content="Billing")
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

def test_classify(monkeypatch):
    monkeypatch.setattr(main.client.chat.completions, "create", fake_create)
    r = TestClient(main.app).post("/classify", json={"text": "charged twice"})
    assert r.status_code == 200 and r.json()["label"] == "billing"

def test_rejects_empty():
    assert TestClient(main.app).post("/classify", json={"text": ""}).status_code == 422
```

## Code — `Dockerfile`

```
FROM python:3.12-slim
WORKDIR /srv
RUN pip install --no-cache-dir openai fastapi uvicorn pydantic
COPY app/ app/
COPY model.json .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Code — `.github/workflows/finetune.yml`

```yaml
name: finetune
on:
  push:
    branches: [main]
    paths: ["data/**"]
  workflow_dispatch:
permissions: { contents: write, pull-requests: write }
jobs:
  train:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    env: { OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install openai
      - run: python scripts/validate_data.py
      - run: python scripts/finetune.py
      - run: python scripts/eval_gate.py
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: model-update
          title: "Promote new fine-tuned model"
          body: "Passed the eval gate. See the workflow log for scores."
          add-paths: model.json
```

## Code — `.github/workflows/ci.yml`

```yaml
name: ci
on: [push, pull_request]
jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    env: { OPENAI_API_KEY: "test-key" }       # tests mock the client
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install openai fastapi uvicorn pydantic pytest httpx
      - run: python scripts/validate_data.py
      - run: python -m pytest -q      # -m puts the repo root on sys.path
      - run: docker build -t ticket-app .
      - if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: curl -fsS -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}"
```

## How it works

1. **Data is code.** Training and eval sets live in the repo, so every model traces back to a commit.
2. **Validation first.** Roles, labels, duplicates and train/eval leakage are checked before money is spent on training.
3. **Fine-tune job.** The script uploads data, starts the job and polls until it finishes.
4. **Eval gate.** The new model must beat the current production model on the held-out set by a margin. Otherwise the workflow fails and nothing changes.
5. **Promotion by PR.** A passing model becomes a one-line change to `model.json`. A human reviews it, and rollback is a `git revert`.
6. **CI/CD.** Every push runs tests with the LLM mocked (fast, free, deterministic), builds the image, and on `main` triggers the deploy.

## Stretch goals

- [ ] Swap hosted fine-tuning for a QLoRA job (TRL) on a GPU runner, served with vLLM.
- [ ] Add per-label F1 and latency to the eval gate, not just accuracy.
- [ ] Push the Docker image to GHCR and deploy by image tag.
- [ ] Log predictions and collect user corrections as new training data.
- [ ] Canary: route 10% of traffic to the new model before full promotion.
- [ ] Add a nightly scheduled eval to catch drift.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
