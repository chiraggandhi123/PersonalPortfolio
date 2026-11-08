---
title: "Production Monitoring (Prometheus, Grafana, ELK)"
---

## TL;DR

Tracing tells you what one run did; **monitoring** tells you whether the system is healthy **right now** and alerts you when it isn't. For an agent, watch the classic signals (**latency, traffic, errors, saturation**) plus the LLM-specific ones: **tokens and cost**, **tool failures**, **steps per run**, **quality scores** and **drift**. The common open-source stack: **Prometheus** scrapes metrics, **Grafana** draws dashboards and alerts, and **ELK** (Elasticsearch, Logstash/Beats, Kibana) or Loki stores searchable logs.

## What to monitor

| Category | Metric | Why |
|---|---|---|
| Latency | p50 / p95 / p99 run time, **time to first token** | Users feel tail latency and streaming delay |
| Traffic | Requests per minute, active sessions | Capacity and cost forecasting |
| Errors | HTTP 5xx, LLM API errors (429, timeouts), tool errors | Outages and rate limits |
| Cost | Input/output tokens and estimated spend per model, per user | Budget, abuse, runaway loops |
| Agent behavior | Steps per run, tool call counts, max-steps hits | Loops, regressions after a prompt change |
| Quality | Online LLM-judge score, thumbs-down rate, refusal rate | Silent quality drops |
| Drift | Input topic mix, query length, embedding distribution, score trends | The world changed, your eval set didn't |

## The stack

```
 agent service ──/metrics──► Prometheus ──► Grafana dashboards + alerts ──► Slack / PagerDuty
       │
       ├── JSON logs ──► Filebeat/Logstash ──► Elasticsearch ──► Kibana   (or Loki)
       │
       └── traces ─────► Langfuse / LangSmith / OTel backend
```

## Exposing metrics with prometheus_client

```python
import time
from fastapi import FastAPI
from openai import OpenAI
from prometheus_client import Counter, Histogram, make_asgi_app

app = FastAPI()
app.mount("/metrics", make_asgi_app())         # Prometheus scrapes this
client = OpenAI()

REQUESTS = Counter("agent_requests_total", "Agent requests", ["status"])
LATENCY = Histogram("agent_latency_seconds", "End-to-end latency",
                    buckets=[0.5, 1, 2, 5, 10, 30, 60])
TOKENS = Counter("llm_tokens_total", "LLM tokens", ["model", "kind"])
TOOL_ERRORS = Counter("agent_tool_errors_total", "Tool failures", ["tool"])

@app.post("/ask")
def ask(question: str):
    start = time.perf_counter()
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini", messages=[{"role": "user", "content": question}])
        TOKENS.labels(resp.model, "input").inc(resp.usage.prompt_tokens)
        TOKENS.labels(resp.model, "output").inc(resp.usage.completion_tokens)
        REQUESTS.labels("ok").inc()
        return {"answer": resp.choices[0].message.content}
    except Exception:
        REQUESTS.labels("error").inc()
        raise
    finally:
        LATENCY.observe(time.perf_counter() - start)
```

Keep label values low-cardinality: model, status, tool name. **Never use user IDs or prompts as labels**; that explodes Prometheus storage. Per-user cost belongs in logs or traces.

## Prometheus config and useful queries

```yaml
# prometheus.yml
scrape_configs:
  - job_name: agent
    scrape_interval: 15s
    static_configs:
      - targets: ["agent:8000"]
```

```
# p95 latency over 5 minutes
histogram_quantile(0.95, sum(rate(agent_latency_seconds_bucket[5m])) by (le))

# error rate
sum(rate(agent_requests_total{status="error"}[5m])) / sum(rate(agent_requests_total[5m]))

# output tokens per minute by model
sum(rate(llm_tokens_total{kind="output"}[1m])) by (model) * 60
```

Build Grafana panels from these and add alerts, e.g. error rate above 5% for 10 minutes, or token rate double the weekly average.

## Logs with ELK

Write **structured JSON logs**, one line per event, with a `run_id` that matches your trace ID:

```python
import json, logging
log = logging.getLogger("agent")
log.info(json.dumps({"event": "tool_call", "run_id": run_id, "tool": "search",
                     "latency_ms": 420, "ok": True}))
```

Filebeat or Logstash ships them to Elasticsearch; Kibana lets you search "all failed `send_email` calls today". **Grafana Loki** is a lighter alternative that pairs naturally with Grafana. On managed clouds, CloudWatch, Cloud Logging or Azure Monitor do the same job.

## Detecting drift and quality drops

- **Online evals** — score a sample of live traces with an LLM judge daily; alert if the average drops.
- **User signals** — thumbs-down rate, retries, "talk to a human" escalations.
- **Input drift** — cluster query embeddings weekly; new clusters mean new topics your prompts and eval set don't cover.
- **Model drift** — provider model updates change behavior; pin versions and re-run evals before switching.

## Alerting tips

- **Alert on symptoms users feel** (latency, errors, quality), not every internal blip.
- **Budget alerts** at the provider and cloud level catch runaway loops fast.
- Every alert should link to a **runbook**: what to check, how to roll back.

## Key terms

- **Golden signals** — latency, traffic, errors, saturation.
- **Prometheus** — time-series database that scrapes metrics from `/metrics` endpoints; queried with PromQL.
- **Grafana** — dashboards and alerting over Prometheus, Loki and other sources.
- **ELK** — Elasticsearch (store/search), Logstash (ingest), Kibana (UI) for logs.
- **Cardinality** — number of unique label combinations; high cardinality kills metric stores.
- **Drift** — change over time in inputs, model behavior or quality.
- **TTFT** — time to first token, the latency users notice in streaming apps.

## Interview quick-fire

- **"What would you monitor for an LLM agent beyond normal API metrics?"** → Tokens and cost, steps and tool calls per run, tool error rate, online quality scores, refusal rate and drift.
- **"Why not put user_id as a Prometheus label?"** → Unbounded cardinality; store per-user data in logs or traces.
- **"How do you catch a silent quality regression?"** → Online LLM-judge scoring on sampled traffic plus user feedback, with alerts on drops.
- **"Metrics vs logs vs traces?"** → Metrics for aggregate health and alerts, logs for searchable events, traces for one request's full path.
