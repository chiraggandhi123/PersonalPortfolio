---
title: "Multi-Modal RAG"
---

## TL;DR

Real documents contain **images, charts, tables and scanned pages**, and plain text RAG throws that information away. **Multi-modal RAG** makes it retrievable. Three main approaches: **(1) caption everything** with a vision LLM and embed the text summaries; **(2) multimodal embeddings** (e.g. CLIP) that put images and text in one vector space; **(3) page-image retrieval** (e.g. ColPali-style) that embeds whole page screenshots. At answer time, pass the retrieved **original image** to a vision-capable model.

## What text-only RAG misses

```
Annual report PDF
 ├─ paragraphs ............ handled by text RAG
 ├─ revenue bar chart ..... lost (it's pixels)
 ├─ pricing table ......... mangled into word soup
 └─ architecture diagram .. lost
```

Questions like "Which region grew fastest in Q3?" may only be answerable from the chart.

## Three approaches

| Approach | Index | Retrieve with | Pros | Cons |
|---|---|---|---|---|
| Summarize to text | Vision-LLM captions / table summaries | Text embeddings | Works with any text vector store; simple | Captioning cost; details lost in summary |
| Multimodal embeddings | Image and text vectors in one space (CLIP, SigLIP, Cohere/Voyage multimodal) | Text query vs. image vectors | No captioning; true image search | Weaker on dense text, charts and tables |
| Page-image retrieval | Embeddings of whole page screenshots (ColPali / ColQwen) | Late interaction over page patches | No parsing; layout preserved | Larger indexes, newer tooling |

The **summarize-to-text + store originals** pattern is the most common starting point.

## Pattern: summarize, retrieve, answer with the original

```
INDEX:   image/table ──► vision LLM ──► text summary ──► embed summary (metadata: path to original)
QUERY:   question ──► search summaries ──► fetch original image/table ──► vision LLM answers
```

### 1. Extract images and tables

```python
from langchain_unstructured import UnstructuredLoader

elements = UnstructuredLoader(
    "data/annual_report.pdf",
    strategy="hi_res",                       # layout model; finds tables and images
    extract_image_block_types=["Image", "Table"],
    extract_image_block_output_dir="data/images",
).load()

texts  = [e for e in elements if e.metadata.get("category") not in ("Image", "Table")]
tables = [e for e in elements if e.metadata.get("category") == "Table"]
images = [e for e in elements if e.metadata.get("category") == "Image"]
```

Alternatives: PyMuPDF to pull embedded images, Docling, or rendering each page to PNG.

### 2. Caption images with a vision model

```python
import base64
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

vision = ChatOpenAI(model="gpt-4o-mini", temperature=0)

def describe_image(path: str) -> str:
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    msg = HumanMessage(content=[
        {"type": "text", "text": "Describe this figure for search. Include every number, label, axis and trend."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ])
    return vision.invoke([msg]).content
```

### 3. Index summaries, keep a pointer to the original

```python
from langchain_core.documents import Document

image_docs = [
    Document(
        page_content=describe_image(img.metadata["image_path"]),
        metadata={"type": "image", "image_path": img.metadata["image_path"], "page": img.metadata.get("page_number")},
    )
    for img in images
]
vectorstore.add_documents(texts + tables + image_docs)
```

### 4. Answer with images in the prompt

```python
def answer(question: str) -> str:
    hits = vectorstore.similarity_search(question, k=5)
    content = [{"type": "text", "text": f"Answer from the context and images.\n\nQuestion: {question}\n\nContext:\n"}]
    for h in hits:
        if h.metadata.get("type") == "image":
            b64 = base64.b64encode(open(h.metadata["image_path"], "rb").read()).decode()
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        else:
            content.append({"type": "text", "text": h.page_content})
    return vision.invoke([HumanMessage(content=content)]).content
```

Sending the original image lets the model read exact values the caption may have skipped.

## Multimodal embeddings (CLIP)

```python
from PIL import Image
from sentence_transformers import SentenceTransformer

clip = SentenceTransformer("clip-ViT-B-32")
img_vecs = clip.encode([Image.open(p) for p in image_paths])
query_vec = clip.encode("a bar chart of revenue by region")
# store img_vecs in any vector DB; search with query_vec
```

Good for photo-like content (product images, diagrams). CLIP-style models read text inside images poorly, so for charts and slides prefer captions or page-image retrieval.

## Tables

- Keep each table **whole** in one chunk, as Markdown or HTML.
- Embed an **LLM summary** of the table ("quarterly revenue by region, 2023–2024") and return the full table to the LLM.
- For large numeric tables, load them into a database and use text-to-SQL instead of RAG.

## Gotchas

- **Captioning is the main cost.** Cache captions by image hash; skip logos and decorative images (filter by size).
- **Vision tokens are expensive.** Downscale images and send only the top 1–3.
- **Charts need precise numbers.** Prompt the captioner to list every value, or values get approximated.
- **Keep page numbers** so users can verify against the original document.

## Key terms

- **Multi-modal RAG** — RAG over text plus images, tables, audio or video.
- **Vision-language model (VLM)** — an LLM that accepts images as input.
- **CLIP** — model that embeds images and text into a shared vector space.
- **ColPali** — retrieval that embeds page images directly and matches query tokens to page patches.
- **Multi-vector retrieval** — search over summaries but return the linked original content.

## Interview quick-fire

- **"How would you do RAG over PDFs with charts?"** → Extract images, caption them with a vision model, embed the captions with a pointer to the image, and pass the original image to a VLM at answer time.
- **"Captioning vs. multimodal embeddings?"** → Captions work with any text store and capture chart details well; multimodal embeddings skip captioning but are weaker on text-heavy images.
- **"How do you handle tables?"** → Keep tables whole, index a summary, return the full table; move large numeric tables to SQL.
