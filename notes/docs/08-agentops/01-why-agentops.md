---
title: "Why AgentOps (agents are non-deterministic)"
---

## TL;DR

An agent that works on your laptop is a demo. A production agent needs **AgentOps**: the practices that let you see what it did, measure whether it is good, keep it safe, and ship changes without breaking it. Agents need this more than normal software because they are **non-deterministic**, take **multi-step paths**, and call **real tools** with real side effects. The core loop is **trace → evaluate → fix → deploy → monitor**.

## Why agents are harder to run than normal code

| Normal web service | LLM agent |
|---|---|
| Same input → same output | Same input → different paths and wording |
| Bugs show up as exceptions | Bugs show up as a wrong-but-fluent answer |
| Cost per request is roughly fixed | Cost depends on how many steps and tokens the agent uses |
| Unit tests cover behavior | Behavior depends on prompts, model version and tool results |
| Inputs come from your UI | Inputs include web pages, emails and tool outputs anyone can write |

A plain stack trace tells you almost nothing about an agent. You need to know **which prompt it saw, which tools it called, with what arguments, what came back, and why it stopped**.

## The AgentOps loop

```
      ┌──────────── build / change prompt, tools, model ◄───────────┐
      ▼                                                             │
  trace every run ──► evaluate on a fixed eval set ──► deploy ──► monitor in prod
  (what happened?)    (is it better or worse?)        (CI/CD)    (latency, cost,
                                                                  errors, drift)
                                                                      │
                                     bad traces become new eval cases ┘
```

Each later note in this stage covers one box:

| Concern | Question it answers | Notes |
|---|---|---|
| Protocols | How do agents get tools and talk to each other? | MCP, A2A |
| Tracing | What exactly happened in this run? | LangSmith, Langfuse, Opik, OpenTelemetry |
| Evaluation | Is this version better than the last one? | Eval sets, LLM-as-judge, DeepEval |
| Security | Can someone make it do something harmful? | Prompt injection, least privilege, sandboxing |
| Deployment | How do I ship it repeatably? | Docker, GitHub Actions, Render, AWS/GCP/Azure |
| Monitoring | Is it healthy right now? | Prometheus, Grafana, logs, alerts |

## What non-determinism means in practice

- **Temperature isn't the whole story.** Even at `temperature=0`, providers don't promise identical outputs, and a model update can change behavior overnight.
- **Small changes ripple.** Rewording one tool description can change which tool the agent picks for many queries.
- **Errors compound.** If each step is right 95% of the time, a 10-step run is fully right only about 60% of the time.
- **"It worked when I tried it" means little.** You need a set of test cases and a pass rate, not one manual check.

## A minimal "ops-ready" agent call

Even before adopting a tool, log the things you will need later:

```python
import time, uuid, json, logging
from openai import OpenAI

client = OpenAI()
log = logging.getLogger("agent")
logging.basicConfig(level=logging.INFO)

PROMPT_VERSION = "support-v3"           # version prompts like code

def answer(question: str) -> str:
    run_id = str(uuid.uuid4())
    start = time.perf_counter()
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": "You are a support agent."},
                  {"role": "user", "content": question}],
    )
    log.info(json.dumps({
        "run_id": run_id,
        "prompt_version": PROMPT_VERSION,
        "model": resp.model,
        "latency_ms": round((time.perf_counter() - start) * 1000),
        "input_tokens": resp.usage.prompt_tokens,
        "output_tokens": resp.usage.completion_tokens,
        "finish_reason": resp.choices[0].finish_reason,
    }))
    return resp.choices[0].message.content
```

Structured JSON logs with a `run_id`, model, prompt version, tokens and latency already give you most of the debugging and cost picture. Tracing tools do this per step, automatically.

## Best practices from day one

- **Version everything**: prompts, tool schemas, model names, eval sets.
- **Pin the model** to a dated snapshot where your provider offers one, so behavior doesn't drift silently.
- **Cap the loop**: max steps, max tokens, and a timeout per run.
- **Keep a human in the loop** for irreversible actions (payments, emails, deletes).
- **Turn every production failure into an eval case** so it can't come back unnoticed.

## Key terms

- **AgentOps** — the practices and tooling for running agents in production: tracing, evals, security, deployment, monitoring.
- **Non-determinism** — the same input can produce different outputs or tool paths.
- **Trace** — a record of one run, broken into steps (spans) such as LLM calls and tool calls.
- **Eval set** — a fixed list of inputs, with expected outcomes, used to score each version.
- **Drift** — behavior or input distribution changing over time, without a code change.

## Interview quick-fire

- **"Why can't you just unit test an agent?"** → Outputs vary between runs and depend on the model and tool results, so you score a pass rate over an eval set, often with an LLM judge, instead of asserting exact outputs.
- **"What would you log for every agent run?"** → Run ID, model and prompt version, each LLM and tool call with inputs/outputs, tokens, latency, cost and the final outcome.
- **"Why do multi-step agents fail more often than single calls?"** → Errors compound: a small per-step error rate multiplies over many steps.
- **"What's the AgentOps loop?"** → Trace, evaluate, deploy, monitor, and feed production failures back into the eval set.
