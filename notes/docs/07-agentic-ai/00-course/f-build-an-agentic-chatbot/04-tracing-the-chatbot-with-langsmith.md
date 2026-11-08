---
title: "Tracing the Chatbot with LangSmith"
---

## TL;DR

**LangSmith** records every run of the chatbot as a **trace**: the graph run, each node, every model call with its exact prompt, output, tokens and latency. For LangChain and LangGraph code, tracing needs **no code changes**, only **environment variables**. Add **metadata** (like `thread_id`) and **tags** in the run config so traces group into conversations, and use **`@traceable`** for plain Python functions you want in the tree.

## Why trace

| Question | Where the trace answers it |
|---|---|
| "Why did it say that?" | The exact messages sent to the model, including the system prompt |
| "Why is it slow?" | Latency per node and per model call |
| "What does a chat cost?" | Token counts per call, summed per trace |
| "Did it call the right tool?" | Tool call arguments and results (from note 05) |
| "What happened in that user's bad chat?" | Filter by `thread_id` metadata |

## Setup

```bash
pip install langsmith
```

Create an API key at smith.langchain.com, then add to `.env`:

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=agentic-chatbot
```

`backend.py` already calls `load_dotenv()`, so restart the app and every turn shows up in the `agentic-chatbot` project. Older tutorials use `LANGCHAIN_TRACING_V2` and `LANGCHAIN_API_KEY`; those still work.

## What a trace looks like

```
chat_turn                       1.9 s   412 tokens   thread_id=a1f3...
└── LangGraph
    └── chat_node               1.8 s
        └── ChatOpenAI          1.8 s   gpt-4o-mini
              input:  [System, Human("Hi"), AI("Hello!"), Human("Explain RAG")]
              output: AI("RAG retrieves documents ...")
```

## Name, tag and group the runs — `app.py`

Change the `config` line in `app.py`:

```python
config = {
    "configurable": {"thread_id": thread_id},
    "metadata": {"thread_id": thread_id},      # groups traces into a conversation
    "tags": ["streamlit", "v1"],
    "run_name": "chat_turn",
}
```

- **`metadata.thread_id`** — LangSmith's **Threads** view groups traces that share a `thread_id` (or `session_id`) key, so you can read a whole conversation.
- **`tags`** — filter by app version, environment or experiment.
- **`run_name`** — replaces the generic "LangGraph" root name.

## Tracing your own functions

```python
from langsmith import traceable

@traceable(name="title_thread")
def make_title(first_message: str) -> str:
    return llm.invoke(f"Give a 4-word title for: {first_message}").content
```

Anything decorated with `@traceable` appears as a span, with nested LangChain calls under it. For the raw OpenAI SDK, wrap the client: `from langsmith.wrappers import wrap_openai; client = wrap_openai(OpenAI())`.

## Using traces day to day

- **Debug a bad answer**: open the trace, click the model call, read the full input. Usually the cause is visible there: missing context, a confusing system prompt, a wrong tool result.
- **Find slow steps**: sort runs by latency.
- **Watch cost**: the project dashboard charts tokens and errors over time.
- **Collect feedback**: log thumbs up/down against a run id.

```python
from langchain_core.tracers.context import collect_runs
from langsmith import Client

with collect_runs() as cb:
    chatbot.invoke({"messages": [HumanMessage("Hi")]}, config)
    run_id = cb.traced_runs[0].id

Client().create_feedback(run_id, key="user_rating", score=1)
```

- **Build a dataset**: add good and bad traces to a dataset, then run evaluations against it when you change the prompt or model.

## Turning it off or down

| Need | Do |
|---|---|
| Disable locally | `LANGSMITH_TRACING=false` |
| Trace only a fraction in production | Sample in your own code with `tracing_context(enabled=...)` around a random share of requests |
| Hide sensitive data | `LANGSMITH_HIDE_INPUTS=true` / `LANGSMITH_HIDE_OUTPUTS=true`, or mask in code |

## Alternatives

Langfuse (open source, self-hostable), Arize Phoenix, and OpenTelemetry-based tools trace LangChain apps too. LangSmith is the zero-config option for LangGraph.

## Gotchas

- **Traces are sent in the background.** In short scripts, the process can exit before they're flushed. Call `langsmith.Client().flush()` or wait a moment; long-running apps are fine.
- **Wrong project name** creates a new project silently. Check `LANGSMITH_PROJECT`.
- **Privacy.** Traces contain user messages. Treat the project like a production database: access control, retention, masking.
- **Metadata must be in the config you pass to `stream`/`invoke`**, not set after the call.

## Key terms

- **Trace** — the full tree of runs for one top-level call.
- **Run / span** — one step in a trace: a graph, node, model or tool call.
- **Project** — a LangSmith container for traces, set by `LANGSMITH_PROJECT`.
- **Metadata** — key-value pairs attached to a run for filtering and grouping.
- **`@traceable`** — decorator that traces any Python function.
- **Feedback** — a score attached to a run, from users or evaluators.

## Interview quick-fire

- **"How do you enable LangSmith tracing for a LangGraph app?"** → Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY` and optionally `LANGSMITH_PROJECT`; LangChain and LangGraph runs are traced automatically.
- **"How do you group traces by conversation?"** → Put `thread_id` (or `session_id`) in the run's metadata; LangSmith groups them into threads.
- **"How do you trace code that isn't LangChain?"** → Decorate functions with `@traceable` or wrap the SDK client with `wrap_openai`.
- **"What's the first thing you check when an agent gives a bad answer?"** → The trace: the exact prompt and context the model received at that step.
