---
title: "Tracing & Observability (LangSmith)"
---

## TL;DR

A **trace** is the full record of one agent run, split into nested **spans**: each LLM call, tool call and retrieval step with its inputs, outputs, tokens, latency and errors. Tracing is how you answer "why did the agent do that?". The model comes from **OpenTelemetry** (traces → spans → attributes). **LangSmith** is LangChain's hosted tracing and eval platform: set two environment variables and LangChain/LangGraph runs are traced automatically, and `@traceable` covers any other code.

## Logs vs metrics vs traces

| Signal | Answers | Example |
|---|---|---|
| **Logs** | What happened at a point in time? | `tool search failed: timeout` |
| **Metrics** | How much / how often, in aggregate? | p95 latency 4.2 s, 3% error rate |
| **Traces** | What path did this one request take? | LLM → `search` → LLM → `send_email` → LLM |

For agents, traces matter most, because the interesting bugs are in the **sequence** of steps.

## Anatomy of a trace

```
trace: "answer_ticket"  run_id=7f3c  4.1s  $0.003
├── span: llm  gpt-4o-mini        1.2s  in=850  out=40   → tool_call search_kb
├── span: tool search_kb          0.6s  query="refund policy"
│     └── span: retriever         0.5s  4 docs
├── span: llm  gpt-4o-mini        1.9s  in=2100 out=180  → final answer
└── span: guardrail check         0.4s  passed
```

Each span has a **name**, **start/end time**, **parent**, **attributes** (model, tokens, prompt), **inputs/outputs** and **status**.

## LangSmith: automatic tracing

```bash
pip install langsmith langchain-openai
```

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=support-agent       # optional, groups runs
OPENAI_API_KEY=sk-...
```

With those set, any LangChain or LangGraph call is traced with no code changes.

## LangSmith without LangChain

```python
from langsmith import traceable
from langsmith.wrappers import wrap_openai
from openai import OpenAI

client = wrap_openai(OpenAI())             # every completion becomes an LLM span

@traceable(run_type="tool")
def search_kb(query: str) -> list[str]:
    return ["Refunds are allowed within 30 days."]

@traceable(name="answer_ticket")           # parent span for the whole run
def answer(question: str) -> str:
    docs = search_kb(question)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": f"Answer using: {docs}"},
                  {"role": "user", "content": question}],
    )
    return resp.choices[0].message.content

answer("Can I get a refund after 2 weeks?")
```

Nested `@traceable` functions become nested spans automatically. You can attach `metadata={"user_id": ...}` and `tags=[...]` to filter runs later.

## OpenTelemetry: the vendor-neutral way

OpenTelemetry (OTel) is the open standard for traces, metrics and logs. Many LLM tools (Langfuse, Opik, Arize Phoenix, Datadog, Grafana Tempo) accept OTel data, and there are **GenAI semantic conventions** for attribute names like `gen_ai.request.model` and `gen_ai.usage.input_tokens`.

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))  # swap for OTLP exporter
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("support-agent")

with tracer.start_as_current_span("answer_ticket") as span:
    span.set_attribute("user.id", "u_42")
    with tracer.start_as_current_span("llm.call") as llm_span:
        llm_span.set_attribute("gen_ai.request.model", "gpt-4o-mini")
        llm_span.set_attribute("gen_ai.usage.input_tokens", 850)
```

In real code, use an auto-instrumentation package (e.g. OpenInference or OpenLLMetry instrumentors for OpenAI and LangChain) instead of writing spans by hand.

## What to do with traces

- **Debug** — open the failing run, find the step where it went wrong (bad retrieval? wrong tool? hallucinated argument?).
- **Build datasets** — save interesting production traces as eval examples.
- **Annotate** — mark runs good/bad, attach feedback scores from users (thumbs up/down).
- **Compare** — run the same dataset on two prompt versions and diff the traces.
- **Find cost hot spots** — which step burns most tokens?

## Gotchas

- **PII lands in traces.** Prompts and outputs are stored by your tracing vendor. Mask or redact sensitive fields, or self-host.
- **Sample in high volume.** Tracing every request at scale costs money; trace a percentage plus all errors.
- **Flush before exit.** Short scripts and serverless functions can exit before traces are sent. Call the SDK's flush method.
- **Propagate context across async/threads**, or spans end up as separate disconnected traces.

## Key terms

- **Trace** — the tree of spans for one request or agent run.
- **Span** — one timed operation inside a trace (LLM call, tool call, retrieval).
- **Attributes** — key/value metadata on a span (model, tokens, user ID).
- **OpenTelemetry** — the vendor-neutral standard and SDKs for traces, metrics and logs.
- **LangSmith** — LangChain's hosted platform for tracing, datasets and evals.
- **`@traceable`** — LangSmith decorator that records a function call as a span.

## Interview quick-fire

- **"Logs vs traces?"** → Logs are isolated events; a trace links all steps of one request into a tree with timing, so you can see the path an agent took.
- **"How do you trace a non-LangChain app in LangSmith?"** → Wrap the OpenAI client with `wrap_openai` and decorate functions with `@traceable`.
- **"Why care about OpenTelemetry?"** → It's vendor-neutral, so you can switch or combine backends without re-instrumenting your code.
- **"What's in a good agent span?"** → Inputs, outputs, model, token counts, latency, status/error, and parent link.
