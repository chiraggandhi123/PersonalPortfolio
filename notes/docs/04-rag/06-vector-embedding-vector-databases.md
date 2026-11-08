---
title: "Vector Embedding & Vector Databases"
---

## TL;DR

Retrieval in RAG works by **embedding** each chunk into a vector and finding the chunks whose vectors are **closest** to the query's vector. Comparing a query to millions of vectors one by one is too slow, so **vector databases** use **approximate nearest neighbor (ANN)** indexes like **HNSW** and **IVF** that trade a little accuracy for a lot of speed. Pick an embedding model for quality, dimension and cost; pick a similarity metric that matches how the model was trained (usually **cosine**).

## From text to vectors

```
chunk: "Refunds within 30 days"  ──► embedding model ──► [0.021, -0.113, ..., 0.087]   (e.g. 1536 floats)
query: "Can I return my order?"  ──► same model      ──► [0.019, -0.098, ..., 0.091]
                                                          └─ close in vector space → relevant
```

See [Embeddings](../01-llm-basics/04-embeddings.md) for the intuition. For RAG the key facts are:

- Index and query with the **same model**.
- Embeddings capture **meaning**, so "return my order" matches "refunds" with no shared words.
- They are weaker at **exact tokens**: product codes, names, error IDs. That's why hybrid search exists.

## Embeddings in LangChain

```python
from langchain_openai import OpenAIEmbeddings

emb = OpenAIEmbeddings(model="text-embedding-3-small")
doc_vectors = emb.embed_documents(["Refunds within 30 days", "Support hours are 9 to 6"])
query_vector = emb.embed_query("Can I return my order?")
print(len(query_vector))          # dimension, e.g. 1536
```

Open-source, runs locally:

```python
from langchain_huggingface import HuggingFaceEmbeddings

emb = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-en-v1.5",
    encode_kwargs={"normalize_embeddings": True},
)
```

## Choosing an embedding model

| Factor | Why it matters |
|---|---|
| Retrieval quality | Check the MTEB leaderboard's retrieval tasks, then test on your own data |
| Dimension | More dimensions → more storage and slower search. Some models let you truncate (e.g. OpenAI `dimensions=`) |
| Max input tokens | Chunks longer than the limit get truncated silently |
| Language / domain | Multilingual or code-specific models beat general ones on those tasks |
| Hosting | API (OpenAI, Cohere, Voyage, Gemini) vs. self-hosted (BGE, E5, GTE, Nomic) |
| Query/document prefixes | Some models (E5, BGE, Nomic) expect prefixes like `query:` / `passage:` |

## Similarity metrics

| Metric | Formula idea | Notes |
|---|---|---|
| Cosine similarity | Angle between vectors | Default for text; ignores length |
| Dot product | Sum of element-wise products | Equals cosine when vectors are normalized; fastest |
| Euclidean (L2) | Straight-line distance | Lower = closer; same ranking as cosine on normalized vectors |

Normalize vectors and the three give the same ranking. Mismatch is a classic bug: some stores return a **distance** (lower is better) and others a **similarity** (higher is better).

## Why a vector database?

Brute force (`query @ all_vectors`) is fine up to roughly a hundred thousand vectors. Beyond that you need an index, plus things a numpy array doesn't give you:

- **ANN search** in milliseconds over millions of vectors.
- **Metadata storage and filtering** (`department = "HR" AND year >= 2024`).
- **CRUD**: add, update and delete vectors without rebuilding everything.
- **Persistence, replication, access control, backups.**

## ANN indexes

```
Flat (exact)  : compare with every vector               → 100% recall, slow at scale
IVF           : cluster vectors; search only the nearest clusters (nprobe)
HNSW          : multi-layer graph; greedy walk from coarse to fine layers
PQ            : compress vectors into short codes        → less memory, some accuracy loss
```

| Index | Strengths | Trade-offs | Tunables |
|---|---|---|---|
| Flat | Exact, simple | Linear time | none |
| HNSW | Fast, high recall, supports inserts | Memory-heavy | `M`, `ef_construction`, `ef_search` |
| IVF | Lower memory, fast | Needs training; recall depends on `nprobe` | `nlist`, `nprobe` |
| IVF-PQ | Very large scale, low memory | Lower recall | code size |

HNSW is the default in most vector databases (Chroma, Qdrant, Weaviate, pgvector's `hnsw` index).

## Gotchas

- **Recall is not 100% with ANN.** If a known-relevant chunk is missing, try raising `ef_search` / `nprobe`.
- **Embedding cost is one-off, but re-embedding is not.** Changing models means re-indexing everything.
- **Long chunks dilute meaning.** One vector for a 3-page chunk averages many topics.
- **Similarity scores aren't calibrated.** A score of 0.8 means different things for different models; don't hard-code thresholds without testing.

## Key terms

- **Embedding** — a dense vector representing the meaning of text.
- **Dimension** — the number of floats in an embedding vector.
- **Cosine similarity** — similarity based on the angle between two vectors.
- **ANN (approximate nearest neighbor)** — fast search that returns close-to-best matches.
- **HNSW** — graph-based ANN index; the most common default.
- **IVF** — cluster-based ANN index that searches only nearby clusters.
- **Recall@k** — share of truly relevant items found in the top k results.

## Interview quick-fire

- **"Why not just store embeddings in a numpy array?"** → Fine for small data, but you lose ANN speed at scale, metadata filtering, updates, persistence and concurrency.
- **"How does HNSW work?"** → It builds a layered graph of vectors; search starts at a sparse top layer and greedily moves closer to the query through denser layers.
- **"Cosine vs. dot product?"** → Cosine ignores vector length; on normalized vectors they're identical, and dot product is cheaper.
- **"Why might semantic search miss an exact product code?"** → Embeddings capture meaning, not exact tokens; add keyword (BM25) search for identifiers.
