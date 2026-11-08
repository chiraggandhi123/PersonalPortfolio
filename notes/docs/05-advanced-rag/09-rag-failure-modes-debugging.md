---
title: "RAG Failure Modes & Debugging"
---

## TL;DR

When a RAG answer is wrong, **find the stage that failed** before changing anything. Trace every request (query, rewritten query, retrieved chunk ids and scores, prompt, answer), then walk the pipeline: **was the info indexed? was it retrieved? did it reach the prompt? did the model use it?** Most failures are **retrieval and data problems**, not model problems. Turn each bug into an **eval case** so it stays fixed.

## The debugging ladder

```
1. Is the answer in the corpus at all?            no  → content gap (add docs or refuse)
2. Was it parsed and chunked correctly?           no  → ingestion bug (PDF tables, OCR, splits)
3. Is it retrievable for this query?              no  → retrieval (embedding, BM25, filters, k)
4. Did it survive reranking/filtering/grading?    no  → threshold or grader too strict
5. Did it fit in the prompt (not truncated)?      no  → context budget, ordering
6. Did the model use it correctly?                no  → prompt, model, conflicting chunks
7. Did a post-step change it (guardrail, cache)?  yes → stale cache, over-blocking
```

Work top-down. Each step has a quick test.

## Failure catalogue

| Failure mode | Symptom | How to confirm | Fix |
|---|---|---|---|
| Missing content | "I don't know" or a hallucination | grep the raw docs | Add the source; make refusal the expected answer |
| Bad parsing | Garbled tables, missing pages | Print the chunks for that doc | Better parser (layout-aware, OCR), manual check of samples |
| Bad chunk boundaries | Answer split across chunks | Find the chunk; read its neighbours | Overlap, structure-aware splits, parent-document retrieval |
| Vocabulary mismatch | Exact terms (codes, names) not found | BM25 finds it, vectors don't | Hybrid search, query expansion |
| Wrong filter | Zero or few results | Run without metadata filters | Fix metadata at ingestion, log filters |
| Ranking | Right chunk at rank 15 with k=5 | Retrieve k=50, find its rank | Reranker, retrieve wide and keep few |
| Stale index | Old policy quoted | Check chunk `updated_at` | Incremental re-indexing, dedupe old versions |
| Conflicting chunks | Mixed or hedged answer | Two versions both retrieved | Version metadata, prefer latest, dedupe |
| Lost in the middle | Chunk present but ignored | Move it to the top; answer improves | Fewer chunks, best first and last |
| Model ignores context | Answer from general knowledge | Faithfulness low, recall high | Stricter grounding prompt, citations, stronger model |
| Over-refusal | "I don't know" with good context | Context contains the answer | Soften the refusal instruction, check grader |
| Bad query rewrite | Rewrite drops key terms | Compare original vs. rewritten | Keep the original query too; retrieve with both |
| Stale semantic cache | Old or other-user answer | Cache hit logged | Scope keys, version by index, lower TTL |
| Multi-hop | Only half the answer | Needs two docs, got one | Query decomposition, iterative retrieval |

## Trace everything

```python
import json, time, uuid, logging

log = logging.getLogger("rag")

def traced_rag(question: str):
    t0, rid = time.perf_counter(), str(uuid.uuid4())
    query = rewrite_query(question)
    hits = vectorstore.similarity_search_with_relevance_scores(query, k=20)
    reranked = rerank(query, [d for d, _ in hits])[:5]
    answer = generate(question, reranked)
    log.info(json.dumps({
        "request_id": rid,
        "question": question,
        "rewritten": query,
        "retrieved": [(d.metadata.get("chunk_id"), round(s, 3)) for d, s in hits],
        "kept": [d.metadata.get("chunk_id") for d in reranked],
        "answer": answer,
        "latency_ms": round((time.perf_counter() - t0) * 1000),
    }))
    return answer
```

LangSmith, Langfuse and Arize Phoenix do this automatically for LangChain and LangGraph, with a UI per step. Whatever you use, you must be able to answer "which chunks did request X see?".

## Quick diagnostic checks

```python
def where_is_my_answer(question: str, must_contain: str, k: int = 50):
    """Find where a known-good chunk sits in the pipeline for a question."""
    raw = [c for c in all_chunks if must_contain.lower() in c.page_content.lower()]
    print(f"in corpus: {len(raw)} chunk(s)")
    vec = vectorstore.similarity_search(question, k=k)
    ranks = [i for i, d in enumerate(vec, 1) if must_contain.lower() in d.page_content.lower()]
    print(f"vector rank: {ranks or 'not in top ' + str(k)}")
    kw = bm25.invoke(question)
    print(f"bm25 hit: {any(must_contain.lower() in d.page_content.lower() for d in kw)}")
```

Run this on a failing question with a phrase you know is in the right answer. It tells you in seconds whether you have a content, retrieval or ranking problem.

## Reading the metrics together

| Context recall | Context precision | Faithfulness | Likely problem |
|---|---|---|---|
| Low | Any | Any | Retrieval misses: chunking, hybrid search, query rewriting |
| High | Low | Lower | Too much noise: rerank, lower k, compress |
| High | High | Low | Generator ignores context: prompt or model |
| High | High | High, but correctness low | Wrong or outdated source docs, or a bad reference answer |

See [RAG evaluation](./07-rag-evaluation.md) for how these are computed.

## Habits that prevent regressions

- **Every bug becomes an eval case** with the expected answer and gold chunk.
- **Change one thing at a time** and re-run the eval set.
- **Sample production traces weekly**, especially low-faithfulness and thumbs-down ones.
- **Monitor drift**: refusal rate, average retrieval score, cache hit rate, latency p95.
- **Re-run evals after re-indexing** or changing the embedding model. Old vectors and new query embeddings don't mix; re-embed everything.

## Key terms

- **Trace** — a record of every step of one request, with inputs, outputs and timing.
- **Content gap** — the answer simply isn't in the corpus.
- **Parent-document retrieval** — retrieve small chunks, but pass their larger parent section to the model.
- **Query decomposition** — splitting a multi-part question into sub-queries.
- **Regression eval** — an eval case added after a bug so it can't silently return.

## Interview quick-fire

- **"A user says the bot gave a wrong answer. Walk me through debugging."** → Pull the trace; check if the answer is in the corpus, then whether it was chunked well, retrieved, kept after reranking, and used by the model. Fix that stage and add an eval case.
- **"Most common RAG failure in practice?"** → Retrieval and data quality: bad parsing, chunking, or missing exact-term matches. Usually not the LLM.
- **"High recall, low faithfulness?"** → The right context was there but the model didn't stick to it. Tighten the grounding prompt, require citations, or use a stronger model.
- **"What do you log per request?"** → Original and rewritten query, retrieved chunk ids with scores, kept chunks, the prompt version, answer, latency and token usage.
