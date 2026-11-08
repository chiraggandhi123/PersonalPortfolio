---
title: "Production-Grade Cyclic RAG (Guardrails + Evals)"
---

## Goal

Take the cyclic RAG graph from the [enterprise RAG project](./02-enterprise-advanced-rag-in-langgraph.md) and make it production-ready. Add **input and output guardrail nodes**, a **semantic cache**, an **LLM gateway** with fallbacks, and an **eval harness** that runs RAGAS on a fixed eval set and **fails CI** when faithfulness or context recall regress. The aim is a system you can change with confidence, not just one that works today.

**Skills practiced:** guardrail nodes in LangGraph, PII redaction, faithfulness gating, semantic caching with scoped keys, LiteLLM Router fallbacks, RAGAS evaluation, CI quality gates, structured logging.

## Architecture

```
request (user, groups, question)
   │
   ▼
input_guard ──blocked──► refuse ─────────────────────────────────────────────► END
   │ ok (PII redacted)
   ▼
cache_lookup ──hit──────────────────────────────────────────────────────────► END
   │ miss
   ▼
[ cyclic RAG subgraph: retrieve → grade → rewrite loop → generate → grounded? loop ]
   │
   ▼
output_guard ──fail & retries left──► regenerate (inside subgraph)
   │ pass                │ out of retries
   ▼                     ▼
cache_store          safe_fallback ──────────────────────────────────────────► END
   ▼
  END
all LLM calls ──► LiteLLM Router (primary model → fallback model, retries, timeouts)
offline: eval_set.jsonl ──► run_evals.py (RAGAS) ──► compare to baseline.json ──► CI pass/fail
```

## Setup

```bash
pip install openai litellm langgraph langchain-openai langchain-chroma ragas redis numpy python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...      # fallback provider (optional)
REDIS_URL=redis://localhost:6379/0
```

Reuse `retrieval.py` and the RAG graph from the previous project. Put the graph-building code in `rag.py` and compile it **without** a checkpointer as `rag_graph`, so it can run inside another graph.

## Code — `llm.py` (gateway)

```python
from litellm import Router

router = Router(
    model_list=[
        {"model_name": "main", "litellm_params": {"model": "openai/gpt-4o-mini", "timeout": 30}},
        {"model_name": "backup", "litellm_params": {"model": "anthropic/claude-3-5-haiku-latest", "timeout": 30}},
    ],
    fallbacks=[{"main": ["backup"]}],
    num_retries=2,
)

def chat(system: str, user: str) -> str:
    r = router.completion(model="main", temperature=0,
                          messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return r.choices[0].message.content
```

Point every node at `chat()` (or run LiteLLM as a proxy and set the OpenAI SDK's `base_url`). One place now controls retries, fallbacks and cost logging.

## Code — `guards.py`

```python
import re
from openai import OpenAI

client = OpenAI()
INJECTION = re.compile(r"ignore (all|previous|above) instructions|reveal .*system prompt", re.I)
PII = {"EMAIL": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
       "PHONE": re.compile(r"\b(?:\+91[ -]?)?[6-9]\d{9}\b"),
       "CARD": re.compile(r"\b(?:\d[ -]?){13,16}\b")}

def redact(text: str) -> str:
    for label, rx in PII.items():
        text = rx.sub(f"[{label}]", text)
    return text

def input_guard(text: str) -> str | None:
    """Return a refusal message, or None if the input is allowed."""
    if len(text) > 2000 or INJECTION.search(text):
        return "I can't help with that request."
    if client.moderations.create(model="omni-moderation-latest", input=text).results[0].flagged:
        return "I can't help with that request."
    return None

def output_guard(answer: str, n_docs: int) -> str | None:
    """Return a failure reason, or None if the answer passes."""
    cited = {int(c) for c in re.findall(r"\[(\d+)\]", answer)}
    if n_docs and not cited:
        return "no citations"
    if any(c >= n_docs for c in cited):
        return "cites a chunk that doesn't exist"
    if any(rx.search(answer) for rx in PII.values()):
        return "contains PII"
    return None
```

## Code — `cache.py` (scoped semantic cache)

```python
import json, numpy as np, redis, os
from openai import OpenAI

client, r = OpenAI(), redis.Redis.from_url(os.environ["REDIS_URL"])
THRESHOLD, INDEX_VERSION = 0.93, "v3"          # bump INDEX_VERSION on every re-index

def _vec(text):
    v = np.array(client.embeddings.create(model="text-embedding-3-small", input=text).data[0].embedding)
    return v / np.linalg.norm(v)

def _scope(groups):                            # never share answers across permission sets
    return f"sc:{INDEX_VERSION}:{','.join(sorted(groups))}"

def lookup(question, groups):
    q = _vec(question)
    for raw in r.lrange(_scope(groups), 0, 500):
        e = json.loads(raw)
        if float(np.dot(q, e["v"])) >= THRESHOLD:
            return e["answer"]
    return None

def store(question, groups, answer):
    r.lpush(_scope(groups), json.dumps({"v": _vec(question).tolist(), "answer": answer}))
    r.ltrim(_scope(groups), 0, 500)
```

A linear scan is fine for a few hundred entries. At scale, use a Redis vector index (RedisVL) with the scope as a filter field.

## Code — `app_graph.py`

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
import cache, guards
from rag import rag_graph                      # compiled cyclic RAG graph from project 2

class S(TypedDict, total=False):
    question: str
    groups: list[str]
    answer: str
    docs: list[dict]
    blocked: bool
    cached: bool

def input_guard(s):
    refusal = guards.input_guard(s["question"])
    if refusal:
        return {"answer": refusal, "blocked": True}
    return {"question": guards.redact(s["question"]), "blocked": False}

def cache_lookup(s):
    hit = cache.lookup(s["question"], s["groups"])
    return {"answer": hit, "cached": True} if hit else {"cached": False}

def run_rag(s):
    out = rag_graph.invoke({"question": s["question"], "groups": s["groups"], "trace": []},
                           {"recursion_limit": 25})
    return {"answer": out["answer"], "docs": out.get("docs", [])}

def output_guard(s):
    problem = guards.output_guard(s["answer"], len(s.get("docs", [])))
    if problem:
        return {"answer": "I couldn't produce a reliable answer. Please contact the helpdesk."}
    cache.store(s["question"], s["groups"], s["answer"])     # only cache answers that passed
    return {}

g = StateGraph(S)
for n, f in [("input_guard", input_guard), ("cache_lookup", cache_lookup),
             ("run_rag", run_rag), ("output_guard", output_guard)]:
    g.add_node(n, f)
g.add_edge(START, "input_guard")
g.add_conditional_edges("input_guard", lambda s: END if s["blocked"] else "cache_lookup", ["cache_lookup", END])
g.add_conditional_edges("cache_lookup", lambda s: END if s["cached"] else "run_rag", ["run_rag", END])
g.add_edge("run_rag", "output_guard")
g.add_edge("output_guard", END)
app = g.compile()
```

The grounding loop inside `rag_graph` already retries generation. The output guard here is the last line: it falls back rather than looping again, which keeps worst-case latency bounded.

## Code — `run_evals.py` (CI gate)

```python
import json, sys
from ragas import evaluate, EvaluationDataset
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import Faithfulness, LLMContextRecall, LLMContextPrecisionWithReference
from langchain_openai import ChatOpenAI
from rag import rag_graph

TOLERANCE = 0.03
rows = []
for line in open("eval_set.jsonl"):
    ex = json.loads(line)
    out = rag_graph.invoke({"question": ex["question"], "groups": ex["groups"], "trace": []})
    rows.append({"user_input": ex["question"], "response": out["answer"],
                 "retrieved_contexts": [d["text"] for d in out.get("docs", [])] or [""],
                 "reference": ex["reference"]})

scores = evaluate(EvaluationDataset.from_list(rows),
                  metrics=[Faithfulness(), LLMContextRecall(), LLMContextPrecisionWithReference()],
                  llm=LangchainLLMWrapper(ChatOpenAI(model="gpt-4o-mini", temperature=0))).to_pandas()
current = {m: float(scores[m].mean()) for m in ["faithfulness", "context_recall", "llm_context_precision_with_reference"]}
baseline = json.load(open("baseline.json"))

print(json.dumps(current, indent=2))
failed = [m for m, v in current.items() if v < baseline.get(m, 0) - TOLERANCE]
if failed:
    print("Regression in:", failed)
    sys.exit(1)
```

Run it in CI on every pull request that touches prompts, retrieval or the graph. Update `baseline.json` deliberately, in its own commit, when a change genuinely improves scores. Check the metric column names against your RAGAS version.

## How it works

1. **Input guard** blocks injection attempts and flagged content cheaply, and redacts PII before anything is logged or cached.
2. **Scoped cache** keys on index version plus permission groups, so a cached HR answer never reaches someone without HR access, and re-indexing invalidates everything.
3. **Cyclic RAG** (grade, rewrite, ground-check) runs only on cache misses, with its own counters and a recursion limit.
4. **Output guard** validates citations and scans for PII; failures get a safe fallback, and only passing answers are cached.
5. **Gateway** retries and falls back to a second provider, so one outage doesn't take the service down.
6. **Evals** turn "seems fine" into numbers, and CI blocks regressions.

## Stretch goals

- [ ] Add Llama Guard or a prompt-injection classifier and compare against the regex on an attack set.
- [ ] Scan chunks for indirect injection at ingest time.
- [ ] Online evals: sample 5% of traffic and score faithfulness asynchronously.
- [ ] Dashboard: cache hit rate, block rate, fallback rate, p95 latency, cost per request.
- [ ] Measure the semantic cache's wrong-hit rate on 100 labelled pairs and tune `THRESHOLD`.
- [ ] Add an `interrupt()` for human review when the output guard fails on high-risk topics.
- [ ] Load test with Locust and find where latency breaks down.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
