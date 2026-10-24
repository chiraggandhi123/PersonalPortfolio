---
title: "Provider-Agnostic Clients (LiteLLM, LangChain)"
---

## TL;DR

Provider-agnostic clients give you **one interface for many model providers**, so switching from OpenAI to Claude, Gemini or a local Ollama model is a **string change** instead of a rewrite. **LiteLLM** is a thin layer that speaks the OpenAI format to 100+ providers and adds fallbacks and cost tracking. **LangChain** is a full framework whose chat models are one piece of a bigger toolkit. Use them when you genuinely need multiple providers; a single provider's SDK is simpler otherwise.

## Why bother

- **Compare models** on your own task without rewriting code.
- **Fallbacks** when a provider is down or rate-limiting you.
- **Cost routing**: cheap model first, expensive one when needed.
- **Avoid lock-in** to one vendor's SDK.

The cost: another dependency, an abstraction that can lag behind new provider features, and errors that are harder to trace.

## LiteLLM

```bash
pip install litellm
```

```python
from litellm import completion

messages = [{"role": "user", "content": "Explain vector databases in one sentence."}]

r1 = completion(model="openai/gpt-4o-mini", messages=messages)
r2 = completion(model="anthropic/claude-sonnet-5-5", messages=messages)
r3 = completion(model="gemini/gemini-2.5-flash", messages=messages)
r4 = completion(model="ollama/llama3.2", messages=messages, api_base="http://localhost:11434")

print(r1.choices[0].message.content)   # always the OpenAI response shape
```

- Model string is `provider/model`. API keys come from the usual env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).
- Input and output are always **OpenAI-shaped**, whichever provider runs it. LiteLLM translates (e.g. moves the system message into Claude's `system=` parameter).
- `stream=True`, `tools=`, `response_format=` work the same way where the provider supports them.

### Cost and fallbacks

```python
from litellm import completion, completion_cost

resp = completion(model="openai/gpt-4o-mini", messages=messages)
print(completion_cost(completion_response=resp))      # USD, from LiteLLM's price list

resp = completion(
    model="openai/gpt-4o-mini",
    messages=messages,
    fallbacks=["anthropic/claude-haiku-5-5"],          # tried if the first model fails
    num_retries=2,
)
```

### LiteLLM proxy

LiteLLM also runs as a **server** (`litellm --config config.yaml`): one OpenAI-compatible endpoint for your whole team, with virtual API keys, per-team budgets, rate limits and logging. Any app using the OpenAI SDK points its `base_url` at the proxy.

## LangChain

```bash
pip install langchain langchain-openai langchain-anthropic
```

```python
from langchain.chat_models import init_chat_model

llm = init_chat_model("openai:gpt-4o-mini", temperature=0)
# llm = init_chat_model("anthropic:claude-sonnet-5-5")       # same code, different model

reply = llm.invoke("Explain vector databases in one sentence.")
print(reply.content)
```

Messages, streaming, structured output and tools are unified too:

```python
from pydantic import BaseModel

class Summary(BaseModel):
    title: str
    bullets: list[str]

structured = llm.with_structured_output(Summary)
result: Summary = structured.invoke("Summarize: " + article)

for chunk in llm.stream("Write a haiku about tokens"):
    print(chunk.content, end="")
```

LangChain's value is the **ecosystem** around the chat model: document loaders, text splitters, vector stores, retrievers, and **LangGraph** for agents. You'll use those heavily in the RAG and Agents stages.

## Which one?

| | Provider SDK | LiteLLM | LangChain |
|---|---|---|---|
| What it is | One provider's official client | Thin translation layer + proxy | Full LLM app framework |
| API style | Provider-specific | OpenAI format everywhere | LangChain objects (`invoke`, `stream`) |
| Switching provider | Rewrite calls | Change a string | Change a string |
| Extras | Newest features first | Fallbacks, cost, budgets, proxy | RAG building blocks, agents (LangGraph) |
| Choose when | One provider, want full control | Multi-provider apps, gateways | Building RAG/agent pipelines from parts |

A sensible default: **official SDK** while learning and for single-provider apps, **LiteLLM** when you need several providers, **LangChain/LangGraph** when you want its RAG and agent tooling.

## The low-tech option

Many providers expose an **OpenAI-compatible endpoint**, so the plain OpenAI SDK plus a different `base_url` already gets you Ollama, Groq, Together, vLLM and Gemini. That's often enough without any extra library.

## Key terms

- **Provider-agnostic client** — one API that can call models from many providers.
- **LiteLLM** — library and proxy that translates the OpenAI format to 100+ providers.
- **LLM gateway / proxy** — a central server that all apps call, adding keys, budgets, logging and routing.
- **Fallback** — automatically trying another model when the first one fails.
- **init_chat_model** — LangChain helper that creates a chat model from a `provider:model` string.

## Interview quick-fire

- **"How would you avoid vendor lock-in with LLM providers?"** → Put calls behind one interface (LiteLLM, LangChain, or an OpenAI-compatible gateway), keep model names in config, and keep an eval set to compare providers.
- **"LiteLLM vs. LangChain?"** → LiteLLM is a thin OpenAI-format translation layer with routing and cost tracking; LangChain is a broader framework for chains, RAG and agents.
- **"How do you handle a provider outage in production?"** → Retries with backoff, then fallback to another model/provider through a router or gateway, with alerts on the error rate.
