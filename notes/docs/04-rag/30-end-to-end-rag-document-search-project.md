---
title: "End-to-End RAG Document Search Project"
---

## TL;DR

This note ties the stage together: how to structure a **complete RAG document search system**, not just a notebook. It has two pipelines: an **offline ingestion pipeline** (load → parse → chunk → embed → index, with **incremental updates**) and an **online query pipeline** (rewrite → hybrid retrieve → rerank → generate with **citations**), wrapped in an **API**, a simple **UI**, an **eval set** and **tracing**. Keep each stage a small, swappable module. The hands-on build is in [the RAG-Based Document Search project](./projects/01-rag-based-document-search.md).

## System overview

```
                OFFLINE (ingestion)                                ONLINE (query)
 docs folder / S3 / Drive                                 user ─► UI (Streamlit / web)
        │                                                              │
   load + parse (PDF, DOCX, HTML)                                FastAPI /search, /ask
        │                                                              │
   clean + chunk (with metadata)                         query rewrite (optional)
        │                                                              │
   hash check ─ unchanged? skip                         hybrid retrieve (vector + BM25)
        │                                                              │
   embed ─► vector DB  ◄──────────────────────────────────── rerank top 20 → top 5
                                                                       │
                                                         LLM answer with [1][2] citations
                                                                       │
                                                       trace + log (LangSmith / Langfuse)
```

## Project layout

```
rag-search/
├── app/
│   ├── config.py        # settings from .env (models, chunk size, k)
│   ├── ingest.py        # load, chunk, embed, upsert (CLI)
│   ├── retriever.py     # hybrid search + rerank
│   ├── generator.py     # prompt + LLM call + citations
│   ├── api.py           # FastAPI endpoints
│   └── ui.py            # Streamlit front end calling the API
├── data/                # source documents
├── evals/
│   ├── golden.jsonl     # question, reference, source
│   └── run_evals.py
├── tests/
├── .env
└── Dockerfile
```

## Design decisions

| Decision | Sensible default | Revisit when |
|---|---|---|
| Parser | `pypdf` / `unstructured` | Scanned PDFs (OCR), complex tables |
| Chunking | Recursive, ~800 chars, ~100 overlap | Evals show split answers |
| Metadata | source, page, section, doc hash | Need filtering (dept, date, access) |
| Embeddings | `text-embedding-3-small` or an open model | Domain language, multilingual |
| Vector DB | Chroma locally, managed DB in prod | Scale, multi-tenancy, filters |
| Retrieval | Hybrid (vector + BM25), k=20 | Latency budget |
| Reranker | Cross-encoder to top 5 | Cost or latency concerns |
| Generation | `gpt-4o-mini`, cite chunk ids | Quality gaps on evals |

## Incremental ingestion

Re-embedding everything on each run is slow and costly. Hash each file and skip unchanged ones:

```python
import hashlib, json, pathlib

STATE = pathlib.Path("index_state.json")

def file_hash(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def changed_files(folder: str) -> list[pathlib.Path]:
    seen = json.loads(STATE.read_text()) if STATE.exists() else {}
    changed = [p for p in pathlib.Path(folder).rglob("*.pdf")
               if seen.get(str(p)) != file_hash(p)]
    return changed

def mark_indexed(paths):
    seen = json.loads(STATE.read_text()) if STATE.exists() else {}
    seen.update({str(p): file_hash(p) for p in paths})
    STATE.write_text(json.dumps(seen, indent=2))
```

For a changed file: delete its old chunks (filter by `source` metadata) then insert the new ones. Use deterministic chunk ids like `f"{source}:{page}:{i}"` so upserts replace rather than duplicate.

## The API layer

```python
from fastapi import FastAPI
from pydantic import BaseModel

from app.retriever import hybrid_search      # returns list of Documents
from app.generator import answer_with_citations

api = FastAPI(title="RAG Document Search")

class AskRequest(BaseModel):
    question: str
    k: int = 5

class Source(BaseModel):
    source: str
    page: int | None
    snippet: str

class AskResponse(BaseModel):
    answer: str
    sources: list[Source]

@api.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
    docs = hybrid_search(req.question, k=req.k)
    answer = answer_with_citations(req.question, docs)
    return AskResponse(answer=answer, sources=[
        Source(source=d.metadata["source"], page=d.metadata.get("page"),
               snippet=d.page_content[:200]) for d in docs])

@api.get("/health")
def health():
    return {"status": "ok"}
```

Run with `uvicorn app.api:api --reload`. Returning sources as structured data lets the UI show clickable citations.

## Quality loop

1. Build `evals/golden.jsonl` with 30–100 real questions.
2. Measure hit rate and faithfulness (see [evaluation](./27-chatbot-rag-evaluation.md)).
3. Change **one thing** (chunk size, reranker, prompt) and rerun.
4. Keep the change only if metrics improve without hurting latency too much.

## Gotchas and best practices

- **Say "I don't know".** Instruct the model to refuse when the context lacks the answer, and test it with unanswerable questions.
- **Access control at retrieval time.** Filter chunks by the user's permissions before they reach the LLM.
- **Log every request** with retrieved chunk ids, so bad answers can be traced to retrieval or generation.
- **Separate ingestion from serving.** Run ingestion as a job; the API only reads.
- **Pin versions and config** (embedding model, chunk size); changing them requires a full re-index.

## Key terms

- **Ingestion pipeline** — offline process that turns documents into an indexed, searchable store.
- **Incremental indexing** — re-processing only new or changed documents.
- **Hybrid search** — combining keyword (BM25) and vector retrieval.
- **Reranker** — model that re-scores retrieved chunks for relevance, usually a cross-encoder.
- **Citation** — a reference from an answer back to the source chunk or page.

## Interview quick-fire

- **"Walk me through a production RAG system."** → Offline ingestion (parse, chunk, embed, index with metadata and incremental updates); online query (rewrite, hybrid retrieve, rerank, generate with citations); API + UI; evals and tracing.
- **"How do you handle document updates?"** → Hash files, delete old chunks by source metadata, upsert new chunks with deterministic ids.
- **"How do you enforce document permissions in RAG?"** → Store access metadata on chunks and filter at retrieval time, never rely on the prompt.
- **"Changing the embedding model — what happens?"** → Every vector must be regenerated; old and new embeddings aren't comparable.
