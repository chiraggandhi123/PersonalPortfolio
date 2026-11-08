---
title: "Caching & LLM Gateways (Redis, cost/latency)"
---

## TL;DR

LLM calls are slow and paid per token, and many questions repeat. **Caching** reuses earlier work: an **exact cache** keyed on the normalised prompt, a **semantic cache** that matches similar questions by embedding, and the provider's **prompt caching** for shared prefixes. An **LLM gateway** (LiteLLM, Portkey and similar) sits between your app and providers and gives you **one API, fallbacks, retries, rate limits, budgets, caching and logging** in one place. Both need care: a cache that returns the wrong answer, or leaks one user's answer to another, is worse than no cache.

## Cache layers

| Layer | Key | Hit when | Risk |
|---|---|---|---|
| Exact cache | Hash of model + messages + params | Identical request | Low, but low hit rate |
| Semantic cache | Embedding of the question | Cosine similarity ≥ threshold | Wrong answer for a similar but different question |
| Retrieval cache | Query → retrieved chunk ids | Same query | Stale after re-indexing |
| Embedding cache | Text hash → vector | Same text embedded again | None really; big savings at ingest |
| Provider prompt caching | Shared prompt prefix | Same long system prompt or docs at the start | None; it's automatic or opt-in per provider |

## Exact cache with Redis

```python
import hashlib, json
import redis
from openai import OpenAI

r = redis.Redis(decode_responses=True)
client = OpenAI()

def cached_chat(messages: list[dict], model="gpt-4o-mini", ttl=3600) -> str:
    key = "llm:" + hashlib.sha256(json.dumps([model, messages], sort_keys=True).encode()).hexdigest()
    if (hit := r.get(key)) is not None:
        return hit
    resp = client.chat.completions.create(model=model, messages=messages, temperature=0)
    text = resp.choices[0].message.content
    r.set(key, text, ex=ttl)            # TTL bounds staleness
    return text
```

Only cache **deterministic-ish** calls (temperature 0, no tools with side effects).

## Semantic cache

```python
import numpy as np

THRESHOLD = 0.92
entries: list[tuple[np.ndarray, str, str]] = []     # (vector, question, answer); use a vector DB in prod

def embed(text: str) -> np.ndarray:
    v = client.embeddings.create(model="text-embedding-3-small", input=text).data[0].embedding
    return np.array(v) / np.linalg.norm(v)

def semantic_lookup(question: str) -> str | None:
    q = embed(question)
    best = max(entries, key=lambda e: float(e[0] @ q), default=None)
    if best is not None and float(best[0] @ q) >= THRESHOLD:
        return best[2]
    return None

def semantic_store(question: str, answer: str):
    entries.append((embed(question), question, answer))
```

In production, store the vectors in Redis (RediSearch vector index), pgvector or your existing vector DB. Libraries such as RedisVL and GPTCache package this up.

### Semantic cache gotchas

- **Near-duplicates aren't equal.** "Refund policy for India" and "refund policy for the US" can score 0.95. Tune the threshold on real pairs and include key entities in the cache key.
- **Scope the cache.** Partition by tenant, user role and language. A cached answer built from documents user A can see must not be served to user B.
- **Invalidate on re-index.** Store the index version with each entry, or flush when the docs change.
- **Don't cache conversational follow-ups** ("and the second one?"). Cache the rewritten standalone question instead.
- **Measure.** Log hit rate and sample hits for correctness. A 40% hit rate with 5% wrong hits may be unacceptable.

## LLM gateways

```
          ┌──────────────── gateway (LiteLLM / Portkey / cloud AI gateway) ───────────────┐
app ────► │ auth + virtual keys → rate limit → cache → route → retry/fallback → log/cost │ ──► OpenAI
          └──────────────────────────────────────────────────────────────────────────────┘ ──► Anthropic
                                                                                            ──► self-hosted (vLLM)
```

| Feature | Why it matters |
|---|---|
| Unified API | Switch models with config, not code changes |
| Fallbacks | Provider outage or 429 → try another model automatically |
| Retries with backoff | Absorb transient errors |
| Load balancing | Spread traffic across keys, regions or deployments |
| Budgets and rate limits | Per team, key or user; stop runaway spend |
| Caching | Exact or semantic, shared across services |
| Observability | Cost, latency and tokens per request, in one place |
| Guardrail hooks | PII masking or moderation before and after calls |

### LiteLLM as a library (Router with fallbacks)

```python
from litellm import Router

router = Router(
    model_list=[
        {"model_name": "chat", "litellm_params": {"model": "openai/gpt-4o-mini"}},
        {"model_name": "chat-backup", "litellm_params": {"model": "anthropic/claude-3-5-haiku-latest"}},
    ],
    fallbacks=[{"chat": ["chat-backup"]}],
    num_retries=2,
    timeout=30,
)

resp = router.completion(model="chat", messages=[{"role": "user", "content": "Hi"}])
print(resp.choices[0].message.content)
```

Run LiteLLM as a **proxy server** instead and every service just points the OpenAI SDK at it with `base_url`. That's where budgets, virtual keys and central logging live. Portkey and the cloud providers' AI gateways offer the same pattern as managed services.

## Cost and latency levers, ranked roughly by effort

1. Use a **smaller model** for routing, grading and rewriting; keep the bigger one for the final answer.
2. **Trim context**: fewer, reranked chunks.
3. **Provider prompt caching**: put the stable system prompt and instructions first, variable content last.
4. **Exact and semantic caching** for repeated questions.
5. **Stream** the final answer to cut perceived latency.
6. **Batch APIs** for offline jobs (evals, ingestion).

## Key terms

- **Semantic cache** — returns a stored answer when a new query's embedding is close enough to a cached one.
- **TTL** — time-to-live; when a cache entry expires.
- **Prompt caching** — provider-side reuse of computation for a repeated prompt prefix, billed at a discount.
- **LLM gateway** — a proxy layer that unifies providers and adds routing, fallbacks, limits and logging.
- **Fallback** — an alternative model used when the primary call fails.
- **Virtual key** — a gateway-issued key mapped to real provider keys, with its own budget and limits.

## Interview quick-fire

- **"Exact vs. semantic cache?"** → Exact matches identical requests (safe, low hit rate); semantic matches similar meaning (higher hit rate, risk of wrong answers, needs a tuned threshold).
- **"Biggest semantic-cache risk in RAG?"** → Serving answers across permission boundaries or after docs changed. Scope keys by tenant and role, and version by index.
- **"Why use a gateway?"** → Central fallbacks, retries, budgets, caching and cost tracking across providers, without changing app code.
- **"How do you cut RAG latency?"** → Small models for intermediate steps, fewer chunks, parallel grading, caching, streaming.
