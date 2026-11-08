---
title: "Advanced Chunking & Preprocessing"
---

## TL;DR

**Chunking** decides what a single retrievable unit is. Too big and the vector blurs many topics; too small and chunks lose context. Start with **recursive character splitting** (≈500–1000 chars, 10–20% overlap), then move to **structure-aware** splitting (Markdown/HTML headers, code), **semantic** chunking, or **parent-document** retrieval (search small chunks, return their bigger parent) when evaluation says you need it. Always **carry metadata** and consider **contextual headers** so each chunk makes sense on its own.

## Why chunk at all?

- Embedding models have input limits and one vector can't represent a whole book.
- Retrieval should return **just the relevant part**, to save context and reduce noise.
- A chunk is the unit you cite, so it should be readable alone.

```
chunk too big   → vector = average of many topics → matches weakly for everything
chunk too small → "It was increased to 18 days."  → what was? (context lost)
```

## Strategies

| Strategy | How | Good for |
|---|---|---|
| Fixed size | Every N characters/tokens | Baseline only; cuts mid-sentence |
| Recursive character | Split on `\n\n`, then `\n`, then `. `, then spaces until under size | General default |
| Token-based | Measure size in tokens, not characters | Respecting model limits exactly |
| Structure-aware | Split by Markdown/HTML headers, code functions, PDF sections | Docs, wikis, code |
| Semantic | Split where embedding similarity between sentences drops | Long unstructured prose |
| Parent-document | Index small chunks, return the larger parent | Precise matching + full context |
| Agentic / LLM-based | LLM decides boundaries or extracts propositions | High-value, small corpora (expensive) |

## Recursive splitting (the default)

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=120,
    separators=["\n\n", "\n", ". ", " ", ""],   # try paragraph, line, sentence, word
    add_start_index=True,                        # stores char offset in metadata
)
chunks = splitter.split_documents(docs)
```

Token-based version, so sizes match what the model sees:

```python
splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
    encoding_name="cl100k_base", chunk_size=300, chunk_overlap=50,
)
```

## Structure-aware splitting

```python
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter, Language

md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")]
)
sections = md_splitter.split_text(markdown_text)     # header text goes into metadata
# sections[0].metadata → {'h1': 'Leave Policy', 'h2': 'Paid Leave'}

# then cap section size
chunks = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100).split_documents(sections)

# code: split on functions/classes
py_splitter = RecursiveCharacterTextSplitter.from_language(Language.PYTHON, chunk_size=1000, chunk_overlap=0)
```

`HTMLHeaderTextSplitter` does the same for web pages.

## Semantic chunking

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

semantic = SemanticChunker(OpenAIEmbeddings(), breakpoint_threshold_type="percentile")
chunks = semantic.create_documents([long_text])
```

It embeds every sentence, so it costs more to index. It helps on long prose without headings; on well-structured docs, header splitting is usually as good and cheaper.

## Parent-document retrieval

```
index:   parent section (2000 chars) ──► child chunks (300 chars) ──► embed children
search:  query matches a child ──► return its parent to the LLM
```

```python
# store parent id on each child, look parents up after retrieval
import uuid

parents = RecursiveCharacterTextSplitter(chunk_size=2000).split_documents(docs)
child_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=30)
parent_by_id, children = {}, []
for p in parents:
    pid = str(uuid.uuid4())
    parent_by_id[pid] = p
    for c in child_splitter.split_documents([p]):
        c.metadata["parent_id"] = pid
        children.append(c)

store.add_documents(children)
hits = store.similarity_search(query, k=6)
context_docs = list({h.metadata["parent_id"]: parent_by_id[h.metadata["parent_id"]] for h in hits}.values())
```

LangChain also ships a `ParentDocumentRetriever` (in `langchain-classic` in v1) that does this with a docstore.

## Contextual chunk headers

A chunk like "This limit was raised to 18 days" is ambiguous. Prepend context before embedding:

```python
for c in chunks:
    header = f"Document: {c.metadata.get('source')} | Section: {c.metadata.get('h2', '')}\n"
    c.page_content = header + c.page_content
```

A stronger variant ("contextual retrieval") asks an LLM to write a one-sentence summary of where each chunk sits in the full document and prepends that. It improves retrieval noticeably but costs one LLM call per chunk (prompt caching helps).

## Preprocessing checklist

- Remove boilerplate: headers, footers, cookie banners, navigation.
- Keep tables whole; convert to Markdown.
- Normalize whitespace and unicode; fix hyphenated line breaks.
- Deduplicate near-identical chunks (hash or embedding similarity).
- Drop tiny chunks (a lone heading or page number).
- Keep metadata: source, page, section, date.

## Choosing size

There is no universal best. Typical starting points:

| Content | Chunk size | Overlap |
|---|---|---|
| FAQs, short answers | 200–400 chars, or one Q&A per chunk | 0 |
| Docs, policies | 500–1000 chars | 10–20% |
| Legal, research papers | 1000–1500 chars, or parent-document | 15% |
| Code | One function or class | 0 |

Then measure retrieval quality (hit rate, MRR) on your test questions with two or three settings.

## Key terms

- **Chunk size / overlap** — length of each chunk and how much consecutive chunks share.
- **Recursive splitting** — splitting on progressively smaller separators until chunks fit.
- **Semantic chunking** — splitting where meaning shifts, detected via embedding similarity.
- **Parent-document retrieval** — search small chunks, return their larger parent.
- **Contextual chunk header** — document/section info prepended to a chunk before embedding.

## Interview quick-fire

- **"How do you pick chunk size?"** → Start around 500–1000 characters with some overlap, respect document structure, then tune by measuring retrieval on a test set.
- **"Why use overlap?"** → So a sentence or idea cut at a boundary still appears whole in at least one chunk.
- **"What problem does parent-document retrieval solve?"** → Small chunks match precisely but lack context; returning the parent gives the LLM enough surrounding text.
- **"Semantic vs. recursive chunking?"** → Semantic splits on meaning shifts using embeddings (costlier, good for unstructured prose); recursive splits on separators (cheap, good default).
