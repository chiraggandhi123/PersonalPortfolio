---
title: "Vector Stores & Vector Databases"
---

## TL;DR

In LangChain a **vector store** is a common interface (`add_documents`, `similarity_search`, `as_retriever`, `delete`) over many backends. **FAISS** is an in-memory library, great for experiments. **Chroma** is a lightweight database that persists to disk, great for local apps. For production use a server or managed database: **Qdrant, Pinecone, Weaviate, Milvus** or **pgvector** inside Postgres. Pick based on scale, filtering, hybrid search support and whether you want to run infrastructure.

## Library vs. database

| | Vector library | Vector database |
|---|---|---|
| Examples | FAISS, Annoy, hnswlib | Chroma, Qdrant, Pinecone, Weaviate, Milvus, pgvector |
| Storage | In memory, save to file manually | Persistent, managed |
| Metadata filtering | Minimal | Rich |
| Updates/deletes | Limited | Full CRUD |
| Serving | Inside your process | Client/server, scaling, replication |

## Chroma (local, persistent)

```python
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_core.documents import Document

emb = OpenAIEmbeddings(model="text-embedding-3-small")

store = Chroma(
    collection_name="handbook",
    embedding_function=emb,
    persist_directory="./chroma_db",
)

docs = [
    Document(page_content="New employees get 18 days of paid leave.", metadata={"dept": "HR", "year": 2025}),
    Document(page_content="VPN is required for remote access.", metadata={"dept": "IT", "year": 2024}),
]
store.add_documents(docs, ids=["hr-leave-1", "it-vpn-1"])     # stable ids → upserts, no duplicates

results = store.similarity_search_with_score("How much vacation do I get?", k=2)
for doc, score in results:
    print(round(score, 3), doc.page_content)                   # Chroma returns a distance: lower = closer

hr_only = store.similarity_search("leave policy", k=3, filter={"dept": "HR"})
store.delete(ids=["it-vpn-1"])
```

Reopen the same `persist_directory` later and the data is still there; no re-embedding needed.

## FAISS (in-memory, fast)

```python
from langchain_community.vectorstores import FAISS

faiss_store = FAISS.from_documents(docs, emb)
faiss_store.save_local("faiss_index")

loaded = FAISS.load_local(
    "faiss_index", emb,
    allow_dangerous_deserialization=True,   # loads a pickle; only for files you created
)
print(loaded.similarity_search("remote access", k=1)[0].page_content)
```

## From store to retriever

```python
retriever = store.as_retriever(
    search_type="mmr",                                 # or "similarity", "similarity_score_threshold"
    search_kwargs={"k": 4, "fetch_k": 20, "filter": {"dept": "HR"}},
)
retriever.invoke("parental leave rules")
```

| `search_type` | Behavior |
|---|---|
| `similarity` | Plain top-k nearest neighbors |
| `mmr` | Maximal Marginal Relevance: fetch `fetch_k`, pick k that are relevant **and** diverse |
| `similarity_score_threshold` | Return only results above `score_threshold` |

MMR helps when top results are near-duplicates (e.g. the same paragraph from several versions of a doc).

## Production options

| Store | Type | Highlights |
|---|---|---|
| **Qdrant** | Open source, self-host or cloud | Fast HNSW, strong payload filtering, built-in hybrid (sparse + dense) |
| **Pinecone** | Fully managed, serverless | No ops, namespaces for multi-tenancy, hybrid support |
| **Weaviate** | Open source / cloud | Built-in hybrid (BM25 + vector), modules for vectorizing |
| **Milvus / Zilliz** | Open source / cloud | Billions of vectors, many index types, GPU support |
| **pgvector** | Postgres extension | Vectors next to relational data, SQL filters, transactions |
| **Elasticsearch / OpenSearch** | Search engines | Mature keyword search plus kNN vectors |
| **MongoDB Atlas, Redis** | General DBs with vector search | Use what you already run |

All have LangChain integrations with the same interface, e.g. `langchain-qdrant`, `langchain-pinecone`, `langchain-postgres`:

```python
from langchain_qdrant import QdrantVectorStore

qdrant = QdrantVectorStore.from_documents(
    docs, emb, url="http://localhost:6333", collection_name="handbook",
)
```

## How to choose

```
Prototype / notebook ............ FAISS or Chroma
Small app, single server ........ Chroma or pgvector (if you already have Postgres)
Production, self-hosted ......... Qdrant, Weaviate, Milvus
Production, no ops wanted ....... Pinecone, Qdrant Cloud, Weaviate Cloud
Need joins with business data ... pgvector
```

Questions to ask: How many vectors? How complex are the filters? Do you need hybrid search? Multi-tenancy? Who runs it?

## Gotchas

- **Score direction differs by store.** Chroma and FAISS default to distance (lower is better); others return similarity. Check before thresholding.
- **Duplicates on re-run.** Calling `from_documents` repeatedly adds the same chunks again. Use stable IDs or the indexing API.
- **Filter syntax is store-specific.** Chroma uses `{"$and": [...]}`-style operators; Qdrant uses its own filter models.
- **Multi-tenancy.** Separate customers with collections, namespaces or a mandatory `tenant_id` filter. Never rely on the prompt for isolation.
- **Pickle security.** Only `load_local` FAISS indexes you created yourself.

## Key terms

- **Vector store** — LangChain's interface for storing and searching embeddings.
- **Collection / index / namespace** — a named group of vectors inside a database.
- **Upsert** — insert or update by ID.
- **Metadata filter** — restricting search to documents whose metadata matches a condition.
- **MMR** — re-selection that balances relevance with diversity.
- **pgvector** — Postgres extension that adds a vector type and ANN indexes.

## Interview quick-fire

- **"FAISS vs. Chroma?"** → FAISS is an in-memory similarity search library; Chroma is a lightweight database with persistence, metadata filtering and CRUD.
- **"When would you pick pgvector?"** → When you already run Postgres and want vectors alongside relational data with SQL filters and transactions, at moderate scale.
- **"What is MMR and when do you use it?"** → It picks results that are relevant but not redundant; use it when top-k results are near-duplicates.
- **"How do you isolate tenants in a vector DB?"** → Separate collections/namespaces or an enforced tenant filter applied server-side on every query.
