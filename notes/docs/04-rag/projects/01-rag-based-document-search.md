---
title: "RAG-Based Document Search"
---

## Goal

Build a document search app: drop PDFs into a folder, index them, then ask questions in a Streamlit UI and get **answers with page-level citations**. Retrieval is **hybrid** (vector + BM25, merged with reciprocal rank fusion), so it handles both meaning and exact terms like product codes. This is the hands-on version of the [end-to-end RAG design note](../30-end-to-end-rag-document-search-project.md).

**Skills practiced:** PDF parsing, chunking with metadata, embeddings, Chroma, BM25, reciprocal rank fusion, citation prompting, Streamlit.

## Architecture

```
data/*.pdf ─► ingest.py ─► PyPDFLoader ─► split (800 / 100) ─► Chroma (persisted on disk)
                                                  └──────────► chunks.pkl (for BM25)

user ─► app.py (Streamlit)
          │ question
          ▼
      search.py:  vector top 10 ─┐
                  BM25   top 10 ─┴─► RRF merge ─► top 5
          │
          ▼
      LLM: "answer only from sources, cite [n]" ─► answer + source list (file, page)
```

## Setup

```bash
pip install langchain-openai langchain-chroma langchain-community langchain-text-splitters \
            pypdf rank-bm25 streamlit python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

Put a few PDFs in `data/`.

## Code

### `ingest.py`

```python
import pickle
from pathlib import Path

from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv()

def main():
    pages = []
    for pdf in Path("data").glob("*.pdf"):
        for page in PyPDFLoader(str(pdf)).load():          # one Document per page
            page.metadata["source"] = pdf.name
            pages.append(page)

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = splitter.split_documents(pages)
    ids = [f"{c.metadata['source']}:{c.metadata['page']}:{i}" for i, c in enumerate(chunks)]

    Chroma.from_documents(chunks, OpenAIEmbeddings(model="text-embedding-3-small"),
                          ids=ids, persist_directory="chroma_db", collection_name="docs")
    with open("chunks.pkl", "wb") as f:
        pickle.dump(chunks, f)
    print(f"Indexed {len(chunks)} chunks from {len(pages)} pages")

if __name__ == "__main__":
    main()
```

### `search.py`

```python
import pickle

from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from openai import OpenAI
from rank_bm25 import BM25Okapi

load_dotenv()
client = OpenAI()
store = Chroma(persist_directory="chroma_db", collection_name="docs",
               embedding_function=OpenAIEmbeddings(model="text-embedding-3-small"))
chunks = pickle.load(open("chunks.pkl", "rb"))
bm25 = BM25Okapi([c.page_content.lower().split() for c in chunks])

def key(doc):
    return (doc.metadata["source"], doc.metadata["page"], doc.page_content[:50])

def hybrid_search(query: str, k: int = 5, pool: int = 10):
    vec_hits = store.similarity_search(query, k=pool)
    scores = bm25.get_scores(query.lower().split())
    bm_hits = [chunks[i] for i in scores.argsort()[::-1][:pool]]

    fused, docs = {}, {}
    for ranked in (vec_hits, bm_hits):                 # reciprocal rank fusion
        for rank, d in enumerate(ranked):
            fused[key(d)] = fused.get(key(d), 0) + 1 / (60 + rank)
            docs[key(d)] = d
    best = sorted(fused, key=fused.get, reverse=True)[:k]
    return [docs[b] for b in best]

def answer(query: str):
    docs = hybrid_search(query)
    sources = "\n\n".join(
        f"[{i}] ({d.metadata['source']}, p.{d.metadata['page'] + 1})\n{d.page_content}"
        for i, d in enumerate(docs, 1))
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {"role": "system", "content": "Answer only from the sources. Cite them like [1]. "
             "If the sources don't contain the answer, say you don't know."},
            {"role": "user", "content": f"Sources:\n{sources}\n\nQuestion: {query}"},
        ],
    )
    return resp.choices[0].message.content, docs
```

### `app.py`

```python
import streamlit as st
from search import answer

st.title("Document Search")
query = st.text_input("Ask a question about your documents")

if query:
    with st.spinner("Searching..."):
        text, docs = answer(query)
    st.markdown(text)
    st.subheader("Sources")
    for i, d in enumerate(docs, 1):
        with st.expander(f"[{i}] {d.metadata['source']} — page {d.metadata['page'] + 1}"):
            st.write(d.page_content)
```

Run:

```bash
python ingest.py
streamlit run app.py
```

## How it works

1. **Ingestion** loads each PDF page as a Document (`page` metadata is zero-based), splits it into ~800-character chunks and stores them in Chroma with deterministic ids. The same chunks are pickled for BM25.
2. **Vector search** finds chunks with similar meaning; **BM25** finds chunks sharing exact words. Each returns 10 candidates.
3. **Reciprocal rank fusion** scores each chunk `1 / (60 + rank)` per list and sums them. Chunks ranked well by both rise to the top. No score normalisation needed.
4. The **prompt** numbers the sources and asks for `[n]` citations plus an explicit "I don't know" path.
5. The **UI** shows the answer and expandable sources so users can verify.

## Stretch goals

- [ ] **Upload in the UI** — `st.file_uploader` that indexes new PDFs on the fly.
- [ ] **Reranker** — re-score the fused top 20 with a cross-encoder before taking 5.
- [ ] **Incremental indexing** — hash files and skip unchanged ones.
- [ ] **Metadata filters** — restrict search to one file or date range.
- [ ] **Streaming answers** with `st.write_stream`.
- [ ] **Eval set** — 30 questions with expected pages; track hit rate after each change.
- [ ] **FastAPI backend** so other clients can use the search.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
