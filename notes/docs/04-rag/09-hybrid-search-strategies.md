---
title: "Hybrid Search Strategies"
---

## TL;DR

**Dense (vector) search** understands meaning but fumbles exact terms; **sparse (keyword/BM25) search** nails exact terms but misses synonyms. **Hybrid search** runs both and merges the results, usually with **Reciprocal Rank Fusion (RRF)**. Add a **cross-encoder reranker** on top to reorder the merged candidates by true relevance. "Retrieve wide, rerank narrow" is the standard production pattern.

## Dense vs. sparse

| | Dense (embeddings) | Sparse (BM25 / TF-IDF) |
|---|---|---|
| Matches | Meaning, paraphrases | Exact words |
| "return my order" → "refund policy" | Yes | No (no shared words) |
| "error E-4021" → doc with "E-4021" | Often no | Yes |
| Names, SKUs, acronyms, code | Weak | Strong |
| Needs | Embedding model | Just text |

Real queries mix both, so combining them is almost always better than either alone.

## The pipeline

```
                ┌──► BM25 top 20 ──┐
query ──────────┤                  ├──► fuse (RRF) ──► top 20 ──► cross-encoder rerank ──► top 4 ──► LLM
                └──► vector top 20 ┘
```

## Reciprocal Rank Fusion

BM25 scores and cosine similarities are on different scales, so don't add them. RRF uses only **ranks**:

```
RRF_score(doc) = Σ over result lists  1 / (k + rank_of_doc_in_list)        k ≈ 60
```

A document ranked high in both lists wins; a document in only one list still gets credit.

## Hybrid search in LangChain

```python
from langchain_community.retrievers import BM25Retriever      # pip install rank_bm25
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

bm25 = BM25Retriever.from_documents(chunks, k=20)
dense = Chroma.from_documents(chunks, OpenAIEmbeddings()).as_retriever(search_kwargs={"k": 20})

def rrf(result_lists, k=60, top_n=8):
    scores, by_key = {}, {}
    for results in result_lists:
        for rank, doc in enumerate(results):
            key = doc.page_content
            by_key[key] = doc
            scores[key] = scores.get(key, 0) + 1 / (k + rank + 1)
    best = sorted(scores, key=scores.get, reverse=True)[:top_n]
    return [by_key[key] for key in best]

def hybrid_search(query: str):
    return rrf([bm25.invoke(query), dense.invoke(query)])

docs = hybrid_search("How do I fix error E-4021 on checkout?")
```

LangChain also has an `EnsembleRetriever` (weighted RRF over several retrievers); in v1 it lives in `langchain-classic`. Writing RRF yourself is ~10 lines and keeps you independent of package moves.

## Native hybrid in vector databases

You don't always need two systems. Many stores do hybrid search server-side:

| Store | Hybrid support |
|---|---|
| Qdrant | Dense + sparse vectors (e.g. BM25, SPLADE) with fusion in one query |
| Weaviate | `hybrid` query with an `alpha` weight between BM25 and vector |
| Pinecone | Sparse-dense vectors in one index |
| Elasticsearch / OpenSearch | BM25 + kNN with RRF |
| pgvector | Combine with Postgres full-text search (`tsvector`) in SQL |

**Learned sparse** models like SPLADE expand terms ("car" also activates "vehicle"), sitting between BM25 and dense.

## Reranking

Bi-encoders (embeddings) encode the query and document separately, which is fast but coarse. A **cross-encoder** reads the query and document **together** and outputs one relevance score: slower, much more accurate. Use it on the top 20–50 candidates only.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

def rerank(query: str, docs, top_n: int = 4):
    scores = reranker.predict([(query, d.page_content) for d in docs])
    ranked = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
    return [d for d, _ in ranked[:top_n]]

final_docs = rerank(query, hybrid_search(query))
```

Hosted rerankers: Cohere Rerank, Voyage, Jina. Open: BGE-reranker. An LLM can also rerank (score each chunk), at higher cost.

## Other retrieval levers

- **Metadata filtering** — narrow the search space first (date, department, product). Often the cheapest big win.
- **MMR** — diversify results so the top k aren't near-duplicates.
- **Score thresholds** — drop weak matches so the model can say "I don't know".
- **Tuning k** — retrieve more candidates (20–50) for reranking, send fewer (3–6) to the LLM.

## Gotchas

- **BM25 needs the full corpus in memory** in the simple LangChain version; at scale, use a search engine or native sparse vectors.
- **Tokenization matters for BM25.** Lowercasing, stemming and handling of codes like `E-4021` change results.
- **Dedupe before fusion** using a stable chunk ID rather than raw text if chunks can repeat.
- **Rerankers add latency** (tens to hundreds of ms). Measure it against the quality gain.
- **Evaluate each layer.** Check hit rate with dense only, hybrid, then hybrid + rerank, so you know what each adds.

## Key terms

- **Dense retrieval** — search by embedding similarity.
- **Sparse retrieval** — search by term matches (BM25, TF-IDF, SPLADE).
- **BM25** — classic keyword ranking function based on term frequency and document length.
- **Reciprocal Rank Fusion (RRF)** — merges ranked lists using 1 / (k + rank).
- **Cross-encoder** — model that scores a query–document pair jointly; used for reranking.
- **Bi-encoder** — model that embeds query and document separately; used for first-stage retrieval.

## Interview quick-fire

- **"Why hybrid search?"** → Dense search handles paraphrases, BM25 handles exact terms like IDs and names; combining them covers both failure modes.
- **"Why RRF instead of adding scores?"** → BM25 and cosine scores are on different, uncalibrated scales; RRF only uses ranks, so no normalization is needed.
- **"Bi-encoder vs. cross-encoder?"** → Bi-encoders embed separately and scale to millions of docs; cross-encoders read query and doc together, are more accurate, and are used to rerank a small candidate set.
- **"Retrieve 4 or retrieve 50?"** → Retrieve wide (20–50) for recall, rerank, then send a few (3–6) to the LLM for precision.
