---
title: "Data Ingestion & Parsing"
---

## TL;DR

Ingestion turns raw sources (PDFs, web pages, Word files, CSVs, databases) into clean **`Document` objects: text plus metadata**. It is the least glamorous and most important RAG step: **garbage in, garbage retrieved**. Use LangChain loaders for common formats, a layout-aware parser (Unstructured, Docling, LlamaParse) for tables and scanned pages, clean the text, and attach **source metadata** to every document from the start.

## Where ingestion sits

```
sources ──► loader / parser ──► clean ──► enrich metadata ──► Documents ──► chunking (next notes)
 PDF, HTML, DOCX,     text + layout     strip headers,     source, page,
 CSV, Notion, SQL                       fix whitespace     title, date, ACL
```

## Common LangChain loaders

| Source | Loader | Package |
|---|---|---|
| Plain text / Markdown | `TextLoader` | `langchain-community` |
| PDF (text layer) | `PyPDFLoader`, `PyMuPDFLoader` | `pypdf`, `pymupdf` |
| Folder of files | `DirectoryLoader` | `langchain-community` |
| Web page | `WebBaseLoader` | `beautifulsoup4` |
| Word | `Docx2txtLoader` | `docx2txt` |
| CSV | `CSVLoader` (one Document per row) | `langchain-community` |
| JSON | `JSONLoader` (with a `jq_schema`) | `jq` |
| Many formats, layout-aware | `UnstructuredLoader` | `langchain-unstructured` |
| SaaS (Notion, Confluence, Drive, GitHub) | Dedicated loaders | Various |

## Loading in practice

```python
from langchain_community.document_loaders import (
    PyPDFLoader, WebBaseLoader, CSVLoader, DirectoryLoader, TextLoader,
)

pdf_docs = PyPDFLoader("data/handbook.pdf").load()          # one Document per page
print(pdf_docs[0].metadata)                                  # {'source': 'data/handbook.pdf', 'page': 0, ...}

web_docs = WebBaseLoader("https://example.com/faq").load()

csv_docs = CSVLoader("data/products.csv").load()             # each row → "col: value" text

md_docs = DirectoryLoader(
    "data/wiki", glob="**/*.md", loader_cls=TextLoader, show_progress=True
).load()
```

For large corpora use `lazy_load()`, which yields documents one at a time instead of holding everything in memory.

## Hard formats

| Problem | Symptom | What to do |
|---|---|---|
| Scanned PDF | Loader returns empty text | OCR (Tesseract, cloud OCR), or a parser with OCR built in |
| Tables | Cells flattened into word soup | Layout-aware parser that outputs tables as Markdown/HTML |
| Multi-column layout | Sentences interleaved across columns | PyMuPDF or a layout model (Unstructured `hi_res`, Docling) |
| Headers / footers / page numbers | Repeated noise in every chunk | Strip with regex or by position |
| Images and charts | Information lost | Caption with a vision model (see multi-modal RAG) |
| HTML | Navigation, ads, scripts | Extract main content only (`bs4` selectors, trafilatura) |

```python
# Layout-aware parsing with Unstructured: titles, tables and text become separate elements
from langchain_unstructured import UnstructuredLoader

docs = UnstructuredLoader("data/report.pdf", strategy="hi_res").load()
tables = [d for d in docs if d.metadata.get("category") == "Table"]
```

## Cleaning

```python
import re

def clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"-\n(\w)", r"\1", text)        # re-join hyphenated line breaks
    text = re.sub(r"\n{3,}", "\n\n", text)        # collapse blank lines
    text = re.sub(r"[ \t]+", " ", text)           # collapse spaces
    return text.strip()

for d in pdf_docs:
    d.page_content = clean(d.page_content)
pdf_docs = [d for d in pdf_docs if len(d.page_content) > 50]   # drop near-empty pages
```

Clean conservatively. Don't strip structure (headings, list markers, line breaks between sections) that chunkers use later.

## Metadata: add it now

Metadata powers **citations, filtering, access control and freshness**. Add it during ingestion:

```python
from datetime import date

for d in pdf_docs:
    d.metadata.update({
        "doc_type": "policy",
        "department": "HR",
        "ingested_at": date.today().isoformat(),
    })
```

Useful fields: `source`, `page`, `title`, `section`, `author`, `last_modified`, `language`, and an access-control field (`allowed_groups`) if users shouldn't see every document.

## Keeping the index fresh

- Store a **content hash** per document; re-embed only when it changes.
- Use stable document IDs so updates replace old chunks instead of duplicating them.
- LangChain's indexing API (`index()` with a `SQLRecordManager`) handles hash-based dedup and cleanup for you.
- Schedule re-ingestion (cron, Airflow) or trigger it from webhooks when sources change.

## Gotchas

- **Always look at the parsed text** of a few documents before chunking. Many "bad RAG" problems are parser problems.
- **Empty pages from scanned PDFs** fail silently. Log documents with very little text.
- **Encoding errors** (`UnicodeDecodeError`) — pass `encoding="utf-8"` or `autodetect_encoding=True` to `TextLoader`.
- **One CSV row per document** can be too small or too large; consider grouping rows or using SQL instead.
- **Respect robots.txt and terms** when scraping websites.

## Key terms

- **Document loader** — reads a source into LangChain `Document`s.
- **Parsing** — extracting text and structure (headings, tables) from a file format.
- **OCR** — optical character recognition; turns images of text into text.
- **Layout-aware parsing** — parsing that understands columns, tables and headings, not just raw text.
- **Lazy loading** — yielding documents one at a time to save memory.
- **Record manager** — tracks content hashes so only changed documents are re-indexed.

## Interview quick-fire

- **"How do you handle tables in PDFs for RAG?"** → Use a layout-aware parser that outputs tables as Markdown or HTML, keep each table in one chunk, and optionally add an LLM-written summary for retrieval.
- **"A PDF loads but returns no text. Why?"** → It's scanned (image-only); you need OCR.
- **"Why is metadata important in ingestion?"** → It enables citations, metadata filtering, access control and incremental updates; adding it later requires re-indexing.
- **"How do you avoid re-embedding unchanged documents?"** → Hash content and track it with stable IDs (e.g. LangChain's record manager); only embed new or changed docs and delete removed ones.
