---
title: "VectorLess RAG with PageIndex"
---

## TL;DR

Vector RAG chunks a document, embeds the chunks and retrieves by **similarity**. Vectorless RAG skips embeddings: it builds a **tree index of the document's structure** (like a detailed table of contents with a summary per section), and the LLM **reasons over that tree** to pick the sections that answer the question, the way a human expert flips to the right chapter. **PageIndex** (an open-source project by Vectify AI) is a well-known implementation. It shines on **long, well-structured documents** (financial filings, contracts, manuals) where "similar" text is not the same as "relevant" text.

## Why "similar" isn't always "relevant"

| Problem with vector RAG | How a tree index helps |
|---|---|
| Chunking cuts tables and sections in half | Retrieves whole sections by their natural boundaries |
| Query wording differs from document wording | LLM reasons about where an answer would live |
| Cross-references ("see Note 12") are lost | The model can follow them through the tree |
| Top-k returns many near-duplicates | Picks a few specific sections |
| Retrieval is opaque | You can see the path taken: Part II → Item 7 → Liquidity |

## How it works

```
Indexing (once per document)               Retrieval (per question)
  PDF ─► detect structure                    question + tree (titles, summaries, page ranges)
       (headings, ToC, pages)                         │
       ─► tree of nodes:                              ▼
          { title, summary,                  LLM: "which nodes likely contain the answer?"
            page range, children }                    │  (may drill down level by level)
                                                      ▼
                                             fetch full text of chosen nodes
                                                      │
                                                      ▼
                                             LLM answers, citing sections / pages
```

Each node holds a title, a short LLM-written summary, its page range and child nodes. The tree is small enough to fit in a prompt, so retrieval is one or a few LLM calls instead of a similarity search.

## A minimal DIY version

The PageIndex project provides tooling to generate the tree from a PDF and has a hosted API too; check its README for current function names, since the interface may change. The core idea is easy to reproduce with plain OpenAI calls:

```python
import json
from pydantic import BaseModel
from openai import OpenAI

client = OpenAI()

# A tree you built from headings (by hand, a PDF parser, or PageIndex's generator)
tree = {
    "id": "0", "title": "Annual Report 2024", "children": [
        {"id": "1", "title": "Business Overview", "summary": "Products, markets, strategy", "pages": [3, 12]},
        {"id": "2", "title": "Risk Factors", "summary": "Regulatory, supply-chain, FX risks", "pages": [13, 30]},
        {"id": "3", "title": "Financial Statements", "summary": "Income statement, balance sheet, notes", "pages": [31, 80],
         "children": [
             {"id": "3.1", "title": "Note 7: Debt", "summary": "Loans, maturities, covenants", "pages": [55, 58]},
         ]},
    ],
}
page_text = {p: f"[text of page {p}]" for p in range(1, 81)}    # from your PDF parser

class Selection(BaseModel):
    reasoning: str
    node_ids: list[str]

def select_nodes(question: str) -> Selection:
    resp = client.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You navigate a document tree. Pick the smallest set "
             "of nodes whose sections most likely contain the answer. Prefer specific child nodes."},
            {"role": "user", "content": f"Tree:\n{json.dumps(tree, indent=1)}\n\nQuestion: {question}"},
        ],
        response_format=Selection,
    )
    return resp.choices[0].message.parsed

def find(node, nid):
    if node["id"] == nid:
        return node
    for c in node.get("children", []):
        if (hit := find(c, nid)):
            return hit

def answer(question: str) -> str:
    sel = select_nodes(question)
    sections = []
    for nid in sel.node_ids:
        n = find(tree, nid)
        start, end = n["pages"]
        sections.append(f"## {n['title']} (pp. {start}-{end})\n" +
                        "\n".join(page_text[p] for p in range(start, end + 1)))
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Answer from these sections and cite page numbers.\n\n"
                   + "\n\n".join(sections) + f"\n\nQuestion: {question}"}],
    )
    return resp.choices[0].message.content

print(answer("When does the company's main loan mature?"))
```

For big trees, show only the top level first, let the model pick a branch, then show that branch's children (a step-by-step tree search).

## Vector vs. vectorless

| | Vector RAG | Tree-index (vectorless) RAG |
|---|---|---|
| Index | Embeddings in a vector DB | JSON tree of sections |
| Retrieval | Similarity search, milliseconds | LLM reasoning, seconds |
| Best for | Many short docs, FAQs, broad corpora | Few long, structured docs |
| Infra | Embedding model + vector DB | Just an LLM (and a PDF parser) |
| Explainability | Similarity scores | Readable reasoning path |
| Weakness | Chunk boundaries, semantic mismatch | Cost per query; needs good structure |

## Gotchas and best practices

- **Structure quality is everything.** Scanned or flat documents without headings give a poor tree; you may need an LLM to infer sections.
- **Doesn't scale to millions of chunks.** Use it per document, or combine with a first-stage search to pick the document.
- **Latency and cost per query are higher** than a vector lookup; cache trees and selections.
- **Large sections overflow the context.** Cap the pages per answer or drill down further.
- **Hybrid works well:** vector search to find candidate documents, tree reasoning inside each.

## Key terms

- **Vectorless RAG** — retrieval that relies on LLM reasoning over document structure instead of embedding similarity.
- **Tree index** — a hierarchical representation of a document (sections, summaries, page ranges).
- **PageIndex** — an open-source framework that builds such tree indexes from long PDFs and retrieves by reasoning.
- **Tree search** — navigating from root to leaves, choosing branches at each level.
- **Semantic mismatch** — when the text most similar to a query isn't the text that answers it.

## Interview quick-fire

- **"What is vectorless RAG?"** → Retrieval without embeddings: the LLM reads a structured index of a document (like a table of contents with summaries) and reasons about which sections to read.
- **"When would you choose it over vector RAG?"** → Long, structured professional documents where answers need specific sections, cross-references and explainable retrieval.
- **"Main drawbacks?"** → Slower and pricier per query, depends on good document structure, and doesn't scale to huge corpora alone.
