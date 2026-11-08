---
title: "Cache RAG with LangGraph"
---

## TL;DR

Many RAG questions repeat ("how do I reset my password?"). Caching lets you **skip retrieval and generation** for questions you've already answered. An **exact cache** matches identical text; a **semantic cache** embeds the question and returns a stored answer when a past question is **similar enough** (cosine above a threshold). In LangGraph this is a **cache-check node** at the start with a conditional edge: hit → return, miss → full RAG → write to cache. Choose the threshold carefully and **expire entries** when documents change.

## What you can cache

| Layer | Key | Saves | Risk |
|---|---|---|---|
| Exact answer cache | Normalized question text | Retrieval + LLM call | Low hit rate |
| Semantic answer cache | Question embedding | Retrieval + LLM call | Wrong answer for a near-but-different question |
| Retrieval cache | Query → chunk ids | Vector search | Stale after re-indexing |
| Embedding cache | Text hash → vector | Embedding calls | Almost none |
| Provider prompt caching | Repeated prompt prefix | Input-token cost and latency | None; handled by the provider |

"Cache-augmented generation" (CAG) is sometimes also used for a different idea: preloading a small, static knowledge base into a long context (and its KV cache) instead of retrieving. This note focuses on response caching.

## Semantic cache flow

```
question ─► embed ─► nearest cached question
                          │
             sim ≥ 0.92 ──┼── sim < 0.92
                 │                 │
          return cached      retrieve ─► generate ─► store (embedding, answer)
             answer                                          │
                 └──────────────────► END ◄──────────────────┘
```

## Semantic cache in LangGraph

```python
import time
import numpy as np
from typing import TypedDict
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
emb = OpenAIEmbeddings(model="text-embedding-3-small")

THRESHOLD = 0.92
TTL_SECONDS = 24 * 3600

class SemanticCache:
    def __init__(self):
        self.vectors, self.entries = [], []      # swap for Redis / a vector DB in production

    def lookup(self, vec: np.ndarray):
        if not self.vectors:
            return None
        sims = np.array(self.vectors) @ vec       # embeddings are unit-length → dot = cosine
        i = int(sims.argmax())
        entry = self.entries[i]
        if sims[i] >= THRESHOLD and time.time() - entry["ts"] < TTL_SECONDS:
            return entry["answer"]
        return None

    def add(self, vec: np.ndarray, answer: str):
        self.vectors.append(vec)
        self.entries.append({"answer": answer, "ts": time.time()})

cache = SemanticCache()

class State(TypedDict):
    question: str
    vec: list[float]
    context: str
    answer: str
    cache_hit: bool

def check_cache(state: State):
    vec = np.array(emb.embed_query(state["question"]))
    hit = cache.lookup(vec)
    return {"vec": vec.tolist(), "answer": hit or "", "cache_hit": hit is not None}

def retrieve(state: State):
    return {"context": "[chunks from your vector store]"}

def generate(state: State):
    msg = llm.invoke(f"Context:\n{state['context']}\n\nQuestion: {state['question']}")
    return {"answer": msg.content}

def write_cache(state: State):
    cache.add(np.array(state["vec"]), state["answer"])
    return {}

g = StateGraph(State)
for n, f in [("check_cache", check_cache), ("retrieve", retrieve),
             ("generate", generate), ("write_cache", write_cache)]:
    g.add_node(n, f)
g.add_edge(START, "check_cache")
g.add_conditional_edges("check_cache", lambda s: END if s["cache_hit"] else "retrieve")
g.add_edge("retrieve", "generate")
g.add_edge("generate", "write_cache")
g.add_edge("write_cache", END)
app = g.compile()

app.invoke({"question": "How do I reset my password?"})           # miss → full RAG
print(app.invoke({"question": "How can I reset my password?"}))   # likely a hit
```

Recent LangGraph versions also have built-in **node caching** (a `cache_policy` on `add_node` plus a cache passed to `compile`). That caches a node's output for identical inputs, i.e. an exact cache. Check the docs for your version.

## Choosing the threshold

- Too low (e.g. 0.80): "cancel my order" may return the answer for "track my order".
- Too high (e.g. 0.99): almost never hits.
- Tune it on real query pairs labelled "same intent / different intent". Start around 0.9 and adjust per embedding model; scores aren't comparable across models.

## Gotchas and best practices

- **Don't cache personalized answers globally.** Include user or tenant id in the cache key, or only cache generic questions.
- **Invalidate on re-index.** Store a document-version tag with each entry and drop entries when it changes.
- **Cache only good answers.** Skip caching errors, refusals and "I don't know" responses.
- **Watch for time-sensitive questions** ("today's", "latest"); bypass the cache for them.
- **Measure hit rate and wrong-hit rate.** Cost savings mean nothing if hits are incorrect.

## Key terms

- **Exact cache** — returns a stored response only for identical (normalized) input.
- **Semantic cache** — returns a stored response for inputs whose embeddings are similar enough.
- **Similarity threshold** — the minimum cosine similarity counted as a hit.
- **TTL (time to live)** — how long a cache entry stays valid.
- **Cache invalidation** — removing entries that are stale because the source changed.
- **Prompt caching** — provider-side reuse of a repeated prompt prefix to reduce cost and latency.

## Interview quick-fire

- **"Exact vs. semantic caching?"** → Exact matches identical text, safe but low hit rate; semantic matches by embedding similarity, higher hit rate but risks returning answers to different questions.
- **"How do you pick the similarity threshold?"** → Empirically, on labelled pairs of same-intent and different-intent queries, per embedding model.
- **"What breaks a RAG cache?"** → Document updates (staleness), personalized or time-sensitive answers, and too-loose thresholds.
- **"Where does the cache sit in the graph?"** → A first node with a conditional edge: hit goes to END, miss runs retrieval and generation and then writes the cache.
