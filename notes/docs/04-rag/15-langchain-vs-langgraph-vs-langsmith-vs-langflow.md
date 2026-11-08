---
title: "LangChain vs LangGraph vs LangSmith vs Langflow"
---

## TL;DR

They solve different problems and are often used together. **LangChain** is the **component library**: model wrappers, prompts, loaders, vector stores, tools and `create_agent`. **LangGraph** is the **orchestration runtime** for stateful, looping, multi-step agents. **LangSmith** is the **observability and evaluation platform**: traces, datasets, evals, prompt management; it works with or without LangChain. **Langflow** is a separate **visual, drag-and-drop builder** for prototyping LLM flows. Rough rule: build with LangChain, orchestrate with LangGraph, debug and evaluate with LangSmith, sketch visually with Langflow.

## One-line comparison

| Tool | What it is | You use it to… | Code or UI | Open source |
|---|---|---|---|---|
| **LangChain** | Python/JS framework of LLM building blocks | Call models, load docs, build RAG chains and simple agents | Code | Yes |
| **LangGraph** | Graph runtime for stateful agents | Build loops, branches, multi-agent systems, human-in-the-loop | Code (+ Studio for visual debugging) | Yes (platform for deployment is paid) |
| **LangSmith** | Hosted tracing, eval and monitoring platform | See every LLM call, build test sets, run evals, monitor production | Web UI + SDK | No (free tier, self-host on enterprise) |
| **Langflow** | Visual flow builder (separate project, not by LangChain Inc.) | Drag components onto a canvas, prototype, expose flows as APIs | UI (exports/edits as code) | Yes |

## How they fit together

```
            ┌──────────────── your app ────────────────┐
            │  LangGraph  (control flow: state, loops)  │
            │     └── nodes use LangChain components    │
            │          (ChatOpenAI, Chroma, @tool, ...) │
            └──────────────────┬───────────────────────┘
                               │ traces, metrics
                               ▼
                         LangSmith (debug, evaluate, monitor)

  Langflow: a visual canvas to prototype similar flows without writing the code first
```

## LangChain

- Standard interfaces over many providers: swap OpenAI ↔ Anthropic ↔ Ollama, Chroma ↔ Pinecone.
- Hundreds of integrations: loaders, splitters, embeddings, vector stores, retrievers.
- LCEL for simple fixed pipelines; `create_agent` for a standard tool-calling agent (runs on LangGraph).
- Choose it when you want building blocks and fast prototyping.

## LangGraph

- Low-level: you define state, nodes and edges explicitly.
- Loops, conditional branches, parallel nodes, subgraphs, multi-agent patterns.
- Persistence via checkpointers: memory, resume after failure, human approval steps.
- Streaming of tokens and intermediate steps.
- Doesn't require LangChain; nodes can call the OpenAI SDK directly.
- Choose it when control flow is non-trivial: corrective RAG, adaptive RAG, multi-agent systems.

## LangSmith

```bash
# just environment variables: LangChain / LangGraph code is traced automatically
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=lsv2-...
export LANGSMITH_PROJECT=rag-handbook
```

```python
# tracing non-LangChain code
from langsmith import traceable
from openai import OpenAI

client = OpenAI()

@traceable(name="answer_question")
def answer(q: str) -> str:
    return client.chat.completions.create(
        model="gpt-4o-mini", messages=[{"role": "user", "content": q}]
    ).choices[0].message.content
```

- **Tracing** — every run as a tree: retriever input/output, prompt, tokens, latency, cost.
- **Datasets and evaluation** — store question/answer pairs, run your app over them, score with LLM-as-judge or custom evaluators, compare experiments.
- **Prompt hub** — version and share prompts.
- **Monitoring** — dashboards, feedback, alerts on production traffic.
- Alternatives: Langfuse (open source), Arize Phoenix, Weights & Biases Weave, Helicone.

## Langflow

- Browser-based canvas; each node is a component (LLM, prompt, loader, vector store, agent).
- Good for demos, quick experiments, and non-developers exploring ideas.
- Flows can be run through an API or exported, but large production apps usually move to code for testing, version control and review.
- Similar tools: Flowise, n8n (with AI nodes), Dify.

## Which should I use?

| Situation | Pick |
|---|---|
| Basic RAG chatbot over documents | LangChain (LCEL or `create_agent`) |
| Agent that retries, grades, branches or loops | LangGraph |
| Several cooperating agents | LangGraph |
| "Why did my RAG answer that?" | LangSmith (or Langfuse) traces |
| Measuring whether a change improved quality | LangSmith datasets + evals |
| Showing a stakeholder a prototype in an hour | Langflow |
| Production with tight control and few dependencies | Plain SDK + LangGraph, LangChain only where it saves effort |

## Gotchas

- **Langflow is not part of LangChain Inc.'s product line**, despite the name. It builds on LangChain components.
- **LangSmith sends data to a hosted service.** Check data policies before tracing sensitive production data; mask PII or self-host.
- **Don't over-abstract.** For a single LLM call, the provider SDK is simpler than any framework.
- **LangGraph Platform/Server** (deployment, Studio) is separate from the open-source library.

## Key terms

- **LangChain** — framework of composable LLM components and integrations.
- **LangGraph** — library for building stateful, cyclic agent workflows as graphs.
- **LangSmith** — platform for tracing, evaluating and monitoring LLM apps.
- **Langflow** — open-source visual builder for LLM flows.
- **Trace** — a recorded tree of all steps in one run of an LLM app.
- **Observability** — ability to inspect what your LLM system did and why.

## Interview quick-fire

- **"LangChain vs. LangGraph?"** → LangChain provides components and simple chains; LangGraph orchestrates them with explicit state, loops and persistence for complex agents.
- **"Do you need LangChain to use LangSmith?"** → No; LangSmith traces any code via the `traceable` decorator or SDK wrappers, though LangChain apps are traced automatically.
- **"When would you use Langflow?"** → For rapid visual prototyping or demos; for production, most teams move to code.
- **"How would you debug a bad RAG answer in this stack?"** → Open the LangSmith trace, check the retriever's output and the final prompt, then fix retrieval or prompting and rerun the eval dataset.
