---
title: "Limits of Basic RAG (where naive fails)"
---

## TL;DR

Naive RAG is **embed the question → top-k chunks → stuff into the prompt → answer**. It works in demos and breaks in production because every stage can fail silently: the **retriever misses**, the **context is noisy or too long**, the **model ignores or over-trusts the context**, and nobody **measures** any of it. Advanced RAG is mostly about adding checks and loops around those weak points, and measuring each stage on its own.

## The naive pipeline and its failure points

```
question ──► embed ──► vector search (top-k) ──► stuff prompt ──► LLM ──► answer
   │            │              │                      │             │
   ▼            ▼              ▼                      ▼             ▼
vague /     vocabulary     wrong chunks,          lost in the    hallucinates,
multi-part  mismatch       stale docs,            middle, too    ignores context,
question    (acronyms)     chunk cut mid-table    many tokens    no citation
```

There is no feedback anywhere. If retrieval returns junk, the model still answers, confidently.

## Where it fails, by stage

| Stage | Failure | Symptom | Typical fix |
|---|---|---|---|
| Query | Vague, multi-hop or conversational ("what about the second one?") | Irrelevant chunks | Query rewriting, decomposition, history-aware rephrasing |
| Indexing | Bad chunking (tables split, headers lost), no metadata | Right doc, wrong piece | Structure-aware chunking, parent-child chunks |
| Retrieval | Embedding misses exact terms (SKUs, error codes, names) | "I don't know" when the answer exists | Hybrid search (BM25 + vectors), reranking |
| Retrieval | No relevant doc exists | Confident made-up answer | Relevance grading, fallback (web search or refuse) |
| Context | Too many chunks, duplicates, contradictions | Lost in the middle, mixed answers | Rerank, dedupe, compress, smaller k |
| Generation | Model answers from its own memory | Unfaithful answer | Grounding prompt, citation requirement, faithfulness check |
| Freshness | Index is stale | Outdated answers | Incremental re-indexing, date metadata filters |
| Access | User sees chunks they shouldn't | Data leak | Metadata filters on ACLs at query time |
| Ops | No metrics, no traces | "It feels worse" with no data | Eval set + tracing per stage |

## A naive baseline (for comparison)

```python
from openai import OpenAI

client = OpenAI()

def naive_rag(question: str, vectorstore, k: int = 4) -> str:
    docs = vectorstore.similarity_search(question, k=k)        # no relevance check
    context = "\n\n".join(d.page_content for d in docs)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Answer using the context."},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
    )
    return resp.choices[0].message.content
```

Four things are missing: no check that `docs` are relevant, no instruction to refuse, no citations, and no logging of what was retrieved.

## The hardened version of the same step

```python
GROUNDED = (
    "Answer ONLY from the context. Cite chunk ids like [2]. "
    "If the context does not contain the answer, reply exactly: I don't know."
)

def better_rag(question, vectorstore, reranker, k=20, keep=4):
    docs = vectorstore.similarity_search_with_relevance_scores(question, k=k)
    docs = [d for d, score in docs if score >= 0.3]            # drop obvious junk
    docs = reranker(question, docs)[:keep]                      # cross-encoder rerank
    if not docs:
        return "I don't know.", []
    context = "\n\n".join(f"[{i}] {d.page_content}" for i, d in enumerate(docs))
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[{"role": "system", "content": GROUNDED},
                  {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}],
    )
    return resp.choices[0].message.content, docs                # return sources for logging
```

Score thresholds depend on the embedding model. Pick them by looking at real score distributions, not by guessing.

## Retrieval failure vs. generation failure

Always ask first: **was the right chunk in the context?**

```
right chunk retrieved?
   ├─ no  → retrieval problem (query, chunking, embeddings, k, filters)
   └─ yes → answer still wrong?
              ├─ yes → generation problem (prompt, model, context order/length)
              └─ no  → fine
```

This one split saves hours. Tuning the prompt does nothing when the chunk was never retrieved.

## What the rest of this stage adds

- **Corrective RAG** — grade retrieved docs, fall back when they're bad.
- **Self-RAG** — decide whether to retrieve, and check the answer is supported.
- **Text2SQL** — some questions need a database query, not a vector search.
- **Caching and gateways** — cost, latency and provider failover.
- **Guardrails** — filter input, retrieved content and output.
- **Evaluation** — faithfulness, context precision and recall on a fixed eval set.
- **LangGraph** — wire all of this as a graph with loops and retry limits.

## Key terms

- **Naive RAG** — single-pass retrieve-then-generate with no checks or feedback.
- **Lost in the middle** — models attend less to information in the middle of long contexts.
- **Vocabulary mismatch** — the query and the document use different words for the same thing.
- **Reranker** — a model (often a cross-encoder) that rescores query-chunk pairs more accurately than vector similarity.
- **Grounding** — constraining the answer to the supplied context.
- **Multi-hop question** — needs facts from several documents combined.

## Interview quick-fire

- **"Why does naive RAG hallucinate even with a good index?"** → Retrieval can return irrelevant chunks and nothing checks them; the model fills gaps from memory unless told to refuse and verified.
- **"First step when a RAG answer is wrong?"** → Check whether the correct chunk was retrieved. That tells you if it's a retrieval or a generation problem.
- **"Why not just raise k?"** → More chunks add noise, cost and lost-in-the-middle effects. Retrieve wide, then rerank and keep few.
- **"Why do exact IDs and codes fail in vector search?"** → Embeddings capture meaning, not exact tokens. Add keyword (BM25) search in a hybrid setup.
