---
title: "Embeddings (meaning as vectors)"
---

## TL;DR

An **embedding** is a list of numbers (a vector) that represents the *meaning* of a piece of text. Texts with similar meaning get vectors that are close together. This is the foundation of **semantic search** and **RAG**.

```
"How do I reset my password?"     → [0.12, -0.48, 0.33, ..., 0.07]   (e.g. 1536 numbers)
"I forgot my login credentials"   → [0.10, -0.45, 0.31, ..., 0.09]   ← very close
"Best pizza in Naples"            → [-0.62, 0.21, -0.14, ..., 0.55]  ← far away
```

## The intuition: a map of meaning

Imagine every sentence placed as a point on a map, where distance = difference in meaning. Real embeddings use hundreds or thousands of dimensions instead of 2, but the idea is the same.

```
            ^
   "puppy" •  • "dog"
                • "canine"
                                    • "stock market"
                                  • "shares"
     • "kitten"  • "cat"
            ─────────────────────────>
```

The classic demo from word embeddings (word2vec):

```
vector("king") - vector("man") + vector("woman") ≈ vector("queen")
```

Directions in the space capture concepts like gender, tense, or topic.

## Embeddings vs. LLM generation

| | Embedding model | Generative LLM |
|---|---|---|
| Input | Text | Text |
| Output | **One vector** | **Text** (tokens) |
| Use | Search, similarity, clustering, classification | Answering, writing, reasoning |
| Cost | Very cheap | Much more expensive |

Inside an LLM, tokens are also turned into embeddings as the first step (see [Transformers](./02-transformers-attention.md)) — but embedding *models* are trained specifically so that the whole-text vector is good for comparison.

## Measuring similarity

The standard metric is **cosine similarity** — the angle between two vectors, ignoring length.

- `1.0` → same direction (same meaning)
- `0` → unrelated
- `-1` → opposite (rare in practice)

```python
import numpy as np

def cosine_similarity(a, b):
    a, b = np.array(a), np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```

Many embedding models return **normalized** vectors (length 1), in which case cosine similarity = plain dot product.

## Getting embeddings in code

```python
from openai import OpenAI
client = OpenAI()

texts = ["How do I reset my password?", "I forgot my login", "Best pizza in Naples"]
resp = client.embeddings.create(model="text-embedding-3-small", input=texts)
vectors = [d.embedding for d in resp.data]

print(len(vectors[0]))                              # 1536
print(cosine_similarity(vectors[0], vectors[1]))    # high, e.g. ~0.7
print(cosine_similarity(vectors[0], vectors[2]))    # low,  e.g. ~0.1
```

Free/local option:

```python
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("all-MiniLM-L6-v2")    # 384 dimensions, runs on CPU
vectors = model.encode(texts, normalize_embeddings=True)
```

Other providers: Voyage AI (recommended by Anthropic — Claude has no first-party embedding model), Cohere, Google, and many open-source models on the MTEB leaderboard.

## Semantic search in 4 steps

```
1. Embed all your documents (once)       → store vectors
2. Embed the user's query                → query vector
3. Find the nearest document vectors     → top-k by cosine similarity
4. Return those docs (or feed them to an LLM = RAG)
```

```python
query_vec = model.encode(["I can't log in"], normalize_embeddings=True)[0]
scores = vectors @ query_vec           # dot product = cosine (normalized)
best = np.argsort(scores)[::-1][:3]   # top 3 indices
```

At scale, you store vectors in a **vector database** (pgvector, Chroma, Pinecone, Qdrant, FAISS) that does fast approximate nearest-neighbor search. Covered in the RAG stage.

## What embeddings are good for

- **Semantic search** — match by meaning, not keywords ("car" finds "automobile").
- **RAG** — retrieve relevant context for an LLM.
- **Deduplication** — find near-duplicate tickets, questions, products.
- **Clustering** — group feedback or documents by topic.
- **Classification** — embed + a simple classifier; cheap and effective.
- **Recommendations** — "items similar to this one".

## Gotchas

- **Never mix models.** Vectors from different embedding models (or versions) live in different spaces — not comparable. Changing models = re-embed everything.
- **Input length limits.** Embedding models have their own token limits; long docs must be **chunked**.
- **Keyword blind spots.** Embeddings can miss exact matches like product codes, names, or error IDs. Combine with keyword search (**hybrid search**).
- **Dimensions trade-off.** More dimensions = more nuance but more storage and slower search. Some models let you truncate dimensions.
- **Similar ≠ answers.** The closest chunk to a question isn't always the one containing the answer.

## Key terms

- **Embedding / vector** — numeric representation of meaning.
- **Dimension** — length of the vector (384, 768, 1536, 3072…).
- **Cosine similarity** — angle-based closeness score.
- **Vector database** — storage + fast nearest-neighbor search over vectors.
- **Chunking** — splitting long text before embedding.

## Interview quick-fire

- **"What is an embedding?"** → A dense vector representing meaning; similar texts map to nearby vectors.
- **"Why cosine similarity instead of Euclidean distance?"** → It measures direction (meaning) and ignores magnitude; for normalized vectors they rank identically anyway.
- **"Semantic vs. keyword search?"** → Semantic matches meaning and synonyms; keyword matches exact terms. Production systems often use both (hybrid).
