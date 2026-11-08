---
title: "Flipkart Product Recommender (RAG + GCP)"
---

## Goal

Build a product assistant that answers questions like "a phone under 20k with good battery reviews?" by **retrieving real customer reviews** and recommending products from them, with the product names it relied on. Then containerise it and **deploy to Google Cloud Run**, with caching, metadata filters and a small eval set, so it behaves like a service rather than a notebook.

**Skills practiced:** ingesting a CSV into a vector store, metadata filtering, conversational query rewriting, grounded recommendations with sources, Redis caching, FastAPI, Docker, Cloud Run deployment, basic RAG evals.

## Architecture

```
reviews.csv ──► ingest.py ──► chunks + metadata (product, price, rating) ──► embeddings ──► Chroma
                                                                                   │
user ──► FastAPI /recommend ──► cache lookup (Redis) ──hit──► answer               │
                 │ miss                                                            │
                 ├─ rewrite follow-up into standalone query (uses chat history)    │
                 ├─ extract filters (max_price, category) with structured output   │
                 ├─ filtered vector search ◄─────────────────────────────────────┘
                 ├─ LLM: recommend only from retrieved reviews, cite products
                 └─ store in cache ──► JSON response
deploy: Docker image ──► Artifact Registry ──► Cloud Run (secrets from Secret Manager)
```

## Setup

```bash
pip install openai langchain-openai langchain-chroma langchain-core pandas fastapi uvicorn redis python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
REDIS_URL=redis://localhost:6379/0
```

Data: any Flipkart product-review dataset (Kaggle has several) with columns like `product_title`, `category`, `price`, `rating`, `review`. Rename the columns in `ingest.py` to match.

## Code — `ingest.py`

```python
import pandas as pd
from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma

load_dotenv()
df = pd.read_csv("reviews.csv").dropna(subset=["review", "product_title"])

docs = [
    Document(
        page_content=f"Product: {r.product_title}\nRating: {r.rating}/5\nReview: {r.review}",
        metadata={"product": r.product_title, "category": str(r.category).lower(),
                  "price": float(r.price), "rating": float(r.rating)},
    )
    for r in df.itertuples()
]

Chroma.from_documents(
    docs, OpenAIEmbeddings(model="text-embedding-3-small"),
    collection_name="reviews", persist_directory="chroma_db",
)
print(f"Indexed {len(docs)} reviews")
```

Reviews are short, so one review = one chunk. No splitter needed.

## Code — `app.py`

```python
import hashlib, json, os
import redis
from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel
from openai import OpenAI
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma

load_dotenv()
client = OpenAI()
cache = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
store = Chroma(collection_name="reviews", persist_directory="chroma_db",
               embedding_function=OpenAIEmbeddings(model="text-embedding-3-small"))
app = FastAPI()

class Filters(BaseModel):
    search_query: str                 # standalone query, history resolved
    max_price: float | None
    category: str | None

class Req(BaseModel):
    message: str
    history: list[dict] = []

SYSTEM = ("You are a shopping assistant. Recommend up to 3 products using ONLY the reviews given. "
          "For each, give the product name and one line on why, based on the reviews. "
          "If the reviews don't support a recommendation, say so.")

def plan(message: str, history: list[dict]) -> Filters:
    r = client.chat.completions.parse(
        model="gpt-4o-mini", temperature=0, response_format=Filters,
        messages=[{"role": "system", "content": "Turn the latest message into a standalone product "
                   "search query and extract filters. Prices are in INR. Use null if not stated."},
                  *history[-6:], {"role": "user", "content": message}],
    )
    return r.choices[0].message.parsed

def search(f: Filters, k: int = 8):
    conds = [{"rating": {"$gte": 3.0}}]
    if f.max_price:
        conds.append({"price": {"$lte": f.max_price}})
    if f.category:
        conds.append({"category": f.category.lower()})
    where = conds[0] if len(conds) == 1 else {"$and": conds}
    return store.similarity_search(f.search_query, k=k, filter=where)

@app.post("/recommend")
def recommend(req: Req):
    f = plan(req.message, req.history)
    key = "rec:" + hashlib.sha256(f.model_dump_json().encode()).hexdigest()
    if hit := cache.get(key):
        return json.loads(hit) | {"cached": True}

    docs = search(f)
    if not docs:
        return {"answer": "I couldn't find matching products.", "products": [], "filters": f.model_dump()}
    context = "\n\n".join(d.page_content for d in docs)
    resp = client.chat.completions.create(
        model="gpt-4o-mini", temperature=0.2,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"Reviews:\n{context}\n\nRequest: {f.search_query}"}],
    )
    result = {"answer": resp.choices[0].message.content,
              "products": sorted({d.metadata["product"] for d in docs}),
              "filters": f.model_dump()}
    cache.set(key, json.dumps(result), ex=6 * 3600)
    return result | {"cached": False}

@app.get("/healthz")
def health():
    return {"ok": True}
```

The cache key is the **extracted plan**, not the raw message. "phones under 20k with good battery" and "good battery phone below 20000" often produce the same plan, which gives a cheap kind of semantic caching without an embedding threshold.

## Deploy to Cloud Run

`Dockerfile`:

```
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]
```

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
echo -n "$OPENAI_API_KEY" | gcloud secrets create openai-key --data-file=-
gcloud run deploy product-recommender --source . --region asia-south1 \
  --set-secrets OPENAI_API_KEY=openai-key:latest \
  --set-env-vars REDIS_URL=redis://10.0.0.3:6379/0 --allow-unauthenticated
```

The Chroma folder is baked into the image here, which is fine for a read-only demo. For real updates, move the index to a managed store (AstraDB, Vertex AI Vector Search, or pgvector on Cloud SQL). Memorystore for Redis needs a VPC connector to reach it from Cloud Run.

## How it works

1. **Plan** — one structured-output call resolves follow-ups ("cheaper ones?") into a standalone query and pulls out price and category filters.
2. **Filtered retrieval** — Chroma applies the metadata filter first, so a 20k budget never returns a 60k phone. Pure semantic search gets this wrong often.
3. **Grounded recommendation** — the model only sees retrieved reviews and must say when they don't support a pick.
4. **Cache** — repeated plans skip retrieval and generation.
5. **Deploy** — the same container runs locally and on Cloud Run; secrets come from Secret Manager, not the image.

## Quick eval

Write 20 test requests with the constraints you expect (`max_price`, category, products that should appear). Check that the extracted filters match and that every recommended product name appears in `products`. A recommended product missing from the retrieved set is a hallucination.

## Stretch goals

- [ ] Aggregate reviews per product (average rating, top pros and cons) at ingest, and index those summaries too.
- [ ] Hybrid search so exact model names ("Redmi Note 13") match reliably.
- [ ] Add a reranker and compare hit rate on your eval set.
- [ ] Semantic cache with an embedding threshold; measure wrong-hit rate.
- [ ] Put the LLM calls behind a LiteLLM proxy with a fallback model.
- [ ] Simple Streamlit front end with chat history.
- [ ] Prometheus metrics (latency, cache hit rate) and a Grafana dashboard.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
