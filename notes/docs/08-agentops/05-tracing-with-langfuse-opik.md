---
title: "Tracing with Langfuse & Opik"
---

## TL;DR

**Langfuse** and **Opik** (by Comet) are **open-source** LLM observability platforms: tracing, prompt management, datasets and evals. They do roughly what LangSmith does, but you can **self-host** them (Docker), which matters when traces contain customer data. Both work with any framework: **drop-in OpenAI wrappers**, a **decorator** for your own functions, and **OpenTelemetry** ingestion. Pick one, instrument early, and attach user feedback and scores to traces.

## How they compare

| | Langfuse | Opik | LangSmith |
|---|---|---|---|
| License | Open source (MIT core) | Open source (Apache 2.0) | Proprietary |
| Self-host | Yes (Docker / Kubernetes) | Yes (Docker / Kubernetes) | Enterprise plans only |
| Hosted cloud | Yes, free tier | Yes (Comet), free tier | Yes, free tier |
| Decorator | `@observe` | `@track` | `@traceable` |
| OpenAI wrapper | `from langfuse.openai import openai` | `track_openai(client)` | `wrap_openai(client)` |
| Extras | Prompt management, datasets, LLM-as-judge evals, cost tracking | Datasets, experiments, built-in eval metrics, guardrails | Datasets, evals, prompt hub |

The concepts are the same everywhere: **trace → spans/observations → scores**.

## Langfuse

```bash
pip install langfuse openai
```

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com     # or your self-hosted URL
OPENAI_API_KEY=sk-...
```

```python
from langfuse import observe, get_client
from langfuse.openai import openai            # drop-in: same API, now traced

langfuse = get_client()

@observe()                                    # child span
def retrieve(query: str) -> list[str]:
    return ["Refunds are allowed within 30 days."]

@observe()                                    # root span = the trace
def answer(question: str, user_id: str) -> str:
    langfuse.update_current_trace(user_id=user_id, tags=["support"])
    docs = retrieve(question)
    resp = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": f"Use these docs: {docs}"},
                  {"role": "user", "content": question}],
    )
    return resp.choices[0].message.content

print(answer("Can I return shoes after 3 weeks?", user_id="u_42"))
langfuse.flush()                              # send before the script exits
```

The Langfuse SDK is OpenTelemetry-based in recent versions, so spans from other OTel instrumentations show up in the same trace. For LangChain/LangGraph, pass Langfuse's `CallbackHandler` in `config={"callbacks": [handler]}`. Older tutorials use a v2 API (`langfuse.decorators`); the import paths differ, so match the docs to your installed version.

### Scores and feedback

```python
# inside an @observe function: trace_id = langfuse.get_current_trace_id()
langfuse.create_score(
    trace_id=trace_id, name="user_feedback", value=1, comment="thumbs up",
)
```

Scores can come from users, from humans reviewing in the UI, or from an LLM-as-judge evaluator configured in Langfuse.

## Opik

```bash
pip install opik openai
opik configure            # pick cloud (API key) or local self-hosted
```

```python
from openai import OpenAI
from opik import track
from opik.integrations.openai import track_openai

client = track_openai(OpenAI())

@track
def retrieve(query: str) -> list[str]:
    return ["Refunds are allowed within 30 days."]

@track(name="answer_ticket")
def answer(question: str) -> str:
    docs = retrieve(question)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": f"Use these docs: {docs}"},
                  {"role": "user", "content": question}],
    )
    return resp.choices[0].message.content

answer("Can I return shoes after 3 weeks?")
```

Opik also ships eval metrics (hallucination, answer relevance, moderation and more) that you can run over a dataset with `opik.evaluation.evaluate`, and integrations for LangChain, LlamaIndex, CrewAI and others.

## Self-hosting in one line (dev)

Both projects publish a Docker Compose setup in their repos. The pattern is the same:

```bash
git clone https://github.com/langfuse/langfuse.git && cd langfuse
docker compose up -d          # UI on http://localhost:3000
```

For production self-hosting you need persistent databases, backups and auth; read each project's deployment guide.

## What to trace in an agent

```
trace (user_id, session_id, prompt_version, tags)
├── generation: planner LLM          (model, tokens, cost)
├── span: tool search_web            (args, result size, latency)
├── generation: answer LLM
└── score: faithfulness=0.9, user_feedback=1
```

- **Session IDs** group multi-turn chats into one conversation view.
- **Prompt versions** (Langfuse prompt management can serve them) let you compare quality and cost per version.
- **Cost** is computed from token counts and a model price table; check it handles your model names.

## Gotchas

- **Flush in scripts and serverless.** Events are batched in the background; exit too early and they are lost.
- **Version-specific APIs.** Both SDKs have had breaking changes. Copy examples from docs that match your version.
- **Redact PII** before it leaves your process, or self-host.
- **Don't trace only happy paths.** Make sure exceptions mark the span as errored.

## Key terms

- **Observation** — Langfuse's general name for a span, generation or event inside a trace.
- **Generation** — a span that represents an LLM call, with model, tokens and cost.
- **Score** — a numeric or categorical evaluation attached to a trace or span.
- **Session** — a group of traces from one multi-turn conversation.
- **Self-hosting** — running the observability backend on your own infrastructure.

## Interview quick-fire

- **"Why choose Langfuse or Opik over LangSmith?"** → Open source and self-hostable, so sensitive traces stay in your infrastructure, and they're framework-agnostic.
- **"How do you add tracing to an existing OpenAI app quickly?"** → Swap in the tool's OpenAI wrapper and add a decorator on the top-level function.
- **"How do traces feed evaluation?"** → Attach scores (user feedback, LLM judge) to traces, then turn good and bad traces into a dataset for regression tests.
- **"Why do traces go missing from short scripts?"** → The SDK batches events asynchronously; call flush before exit.
