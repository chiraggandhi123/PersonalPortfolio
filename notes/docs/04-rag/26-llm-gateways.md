---
title: "LLM Gateways"
---

## TL;DR

An LLM gateway is a **proxy between your app and model providers**. Your code talks to **one OpenAI-compatible endpoint**; the gateway handles **routing, fallbacks, retries, rate limits, budgets, caching, API-key management and logging**. Swapping providers becomes a config change, not a code change. Popular options: **LiteLLM** (open source, self-hosted), **Portkey**, **OpenRouter** (hosted multi-model API) and cloud gateways such as Cloudflare AI Gateway. For a RAG app with several LangGraph nodes calling models, a gateway gives you one place to control cost and reliability. See also [provider-agnostic clients](../02-calling-models/09-provider-agnostic-clients.md) and [caching & gateways](../05-advanced-rag/05-caching-llm-gateways.md).

## Without vs. with a gateway

```
Without                                  With
  app ─► OpenAI SDK ─► OpenAI              app ─► OpenAI SDK ─► gateway ─┬─► OpenAI
  app ─► Anthropic SDK ─► Anthropic                     (one URL,       ├─► Anthropic
  app ─► retries, keys, logs (x3)                        one key)        ├─► Azure / Bedrock
                                                                         └─► local (Ollama / vLLM)
```

## What a gateway gives you

| Feature | Why it matters |
|---|---|
| Unified API | One request format for every provider |
| Fallbacks | Provider down or rate-limited → try the next model |
| Load balancing | Spread traffic across keys, regions or deployments |
| Retries and timeouts | Consistent, central error handling |
| Budgets and rate limits | Per team, per user or per virtual key |
| Caching | Exact or semantic response cache in one place |
| Observability | Every call logged with tokens, cost and latency |
| Key management | Apps get virtual keys; real provider keys stay in the gateway |

## LiteLLM as a Python library

```python
from litellm import Router

router = Router(
    model_list=[
        {"model_name": "chat", "litellm_params": {"model": "openai/gpt-4o-mini"}},
        {"model_name": "chat-backup", "litellm_params": {"model": "anthropic/your-claude-model-id"}},
    ],
    fallbacks=[{"chat": ["chat-backup"]}],   # if "chat" fails, try the backup
    num_retries=2,
)

resp = router.completion(model="chat", messages=[{"role": "user", "content": "Hi"}])
print(resp.choices[0].message.content)
```

Model names change over time; check your provider's model list.

## LiteLLM as a proxy server (gateway)

`config.yaml`:

```
model_list:
  - model_name: chat
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
  - model_name: chat
    litellm_params:
      model: azure/my-gpt4o-mini-deployment     # second deployment → load balanced
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
```

```bash
pip install "litellm[proxy]"
litellm --config config.yaml        # serves an OpenAI-compatible API, by default on port 4000
```

Any OpenAI client, including LangChain inside a LangGraph node, just points at the gateway:

```python
from openai import OpenAI
from langchain_openai import ChatOpenAI

client = OpenAI(base_url="http://localhost:4000", api_key="sk-my-virtual-key")
client.chat.completions.create(model="chat", messages=[{"role": "user", "content": "Hi"}])

llm = ChatOpenAI(model="chat", base_url="http://localhost:4000", api_key="sk-my-virtual-key")
```

## Using a gateway in a RAG graph

Different nodes need different models. Name them by role in the gateway, not by vendor:

| Node | Gateway alias | Typical backing model |
|---|---|---|
| Router / graders | `fast` | Small, cheap model |
| Generator | `chat` | Mid-size model with fallback |
| Embeddings | `embed` | Embedding model |

Changing the model behind `fast` then needs no code deploy.

## Choosing a gateway

| Option | Hosting | Notes |
|---|---|---|
| LiteLLM | Self-hosted (or managed) | Open source, very wide provider support |
| Portkey | Hosted or self-hosted | Gateway plus observability and guardrails |
| OpenRouter | Hosted | One key for many models; billing through them |
| Cloud gateways | Cloudflare, Kong, cloud vendors | Fits if you already use that platform |

## Gotchas and best practices

- **The gateway is now critical infrastructure.** Run it with redundancy and health checks.
- **Fallback models behave differently.** Test prompts and structured outputs on every model in a fallback chain.
- **Feature gaps.** Provider-specific features (some tool-calling details, prompt caching flags) may not map perfectly through a unified API.
- **Extra hop latency** is small but real; keep the gateway near your app.
- **Data residency.** Hosted gateways see your prompts; check where data is processed and logged.

## Key terms

- **LLM gateway** — a proxy that gives one API over many model providers with routing and controls.
- **Fallback** — automatically retrying a request on a different model or provider.
- **Load balancing** — distributing requests across multiple deployments or keys.
- **Virtual key** — a gateway-issued key mapped to budgets and permissions, hiding real provider keys.
- **OpenAI-compatible API** — an endpoint that accepts the OpenAI request/response format.

## Interview quick-fire

- **"Why use an LLM gateway?"** → One API across providers, plus central fallbacks, retries, rate limits, budgets, caching, key management and logging.
- **"How do you add provider failover?"** → Configure fallbacks in the gateway (e.g. LiteLLM Router) and test that prompts work on each fallback model.
- **"Gateway vs. SDK wrapper like LiteLLM-as-library?"** → A library lives in each app; a gateway is shared infrastructure with central keys, budgets and logs across apps and teams.
