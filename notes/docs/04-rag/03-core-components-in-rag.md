---
title: "Core Components in RAG"
---

## TL;DR

A RAG system has two pipelines. **Indexing** turns documents into searchable vectors: **loader → text splitter → embedding model → vector store**. **Querying** answers questions: **retriever → prompt → LLM → output parser**. LangChain gives each component a standard interface (`Document`, `Embeddings`, `VectorStore`, `Retriever`, `ChatModel`), so you can swap Chroma for Pinecone, or OpenAI for a local model, without rewriting the app.

## The components at a glance

```
                ┌──────────── INDEXING ────────────┐
 PDFs, web, DB ─► Loader ─► Splitter ─► Embeddings ─► Vector store
                                                          │
                ┌──────────── QUERYING ──────────────────┤
 question ─────► Retriever (embeds query, searches) ◄────┘
                    │ top-k Documents
                    ▼
                 Prompt template ─► Chat model ─► Output parser ─► answer
```

| Component | Job | LangChain class (examples) |
|---|---|---|
| Document loader | Read a source into `Document` objects | `PyPDFLoader`, `WebBaseLoader`, `DirectoryLoader` |
| Text splitter | Cut documents into chunks | `RecursiveCharacterTextSplitter` |
| Embedding model | Text → vector | `OpenAIEmbeddings`, `HuggingFaceEmbeddings` |
| Vector store | Store vectors + metadata, run similarity search | `Chroma`, `FAISS`, `PineconeVectorStore` |
| Retriever | Query → relevant `Document`s | `vectorstore.as_retriever()` |
| Prompt template | Combine instructions, context and question | `ChatPromptTemplate` |
| LLM | Generate the answer | `ChatOpenAI`, `ChatAnthropic`, `ChatOllama` |
| Output parser | Turn the model message into a string or object | `StrOutputParser`, `with_structured_output` |

## The `Document` object

Everything flows as `Document`s: text plus metadata.

```python
from langchain_core.documents import Document

doc = Document(
    page_content="Refunds are available within 30 days of purchase.",
    metadata={"source": "policies/refunds.pdf", "page": 2},
)
```

Metadata survives splitting and storage. It is how you show citations and filter searches later (e.g. only `department == "HR"`).

## End-to-end with LangChain

```bash
pip install langchain langchain-openai langchain-community langchain-chroma langchain-text-splitters pypdf
```

```python
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_chroma import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

# ---- Indexing ----
docs = PyPDFLoader("handbook.pdf").load()                       # one Document per page
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
chunks = splitter.split_documents(docs)

vectorstore = Chroma.from_documents(
    chunks,
    embedding=OpenAIEmbeddings(model="text-embedding-3-small"),
    persist_directory="./chroma_db",                            # saved to disk
)

# ---- Querying ----
retriever = vectorstore.as_retriever(search_kwargs={"k": 4})

prompt = ChatPromptTemplate.from_messages([
    ("system", "Answer using only the context below. If it is not there, say you don't know. "
               "Cite the page numbers you used.\n\nContext:\n{context}"),
    ("human", "{question}"),
])

def format_docs(docs):
    return "\n\n".join(f"[page {d.metadata.get('page')}] {d.page_content}" for d in docs)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | ChatOpenAI(model="gpt-4o-mini", temperature=0)
    | StrOutputParser()
)

print(rag_chain.invoke("How many days of paid leave do new employees get?"))
```

The `|` syntax is LCEL (LangChain Expression Language). Each step is a Runnable, so the chain supports `.invoke`, `.batch` and `.stream`.

## Choosing each component

| Component | Main decision | Sensible default |
|---|---|---|
| Loader | How well it handles tables, layout, scanned pages | `PyPDFLoader` for text PDFs; Unstructured or Docling for messy ones |
| Splitter | Chunk size and overlap | 500–1000 characters, 10–20% overlap |
| Embeddings | Quality vs. cost vs. self-hosting | `text-embedding-3-small`, or BGE / E5 locally |
| Vector store | Local vs. managed, scale, filtering | Chroma for dev; Qdrant / Pinecone / pgvector for production |
| Retriever | k, similarity vs. MMR, filters | k = 4–6, add hybrid search if keywords matter |
| LLM | Quality, latency, cost | A small fast model is usually enough when retrieval is good |

## Gotchas

- **Same embedding model for indexing and querying.** Vectors from different models live in different spaces and can't be compared.
- **Re-index when you change the splitter or embedding model.** Old vectors no longer match.
- **Don't re-embed on every run.** Load the persisted store (`Chroma(persist_directory=..., embedding_function=...)`) instead of calling `from_documents` again.
- **Keep the source in metadata** from the very first step. Adding citations later means re-indexing.
- **Debug retrieval separately.** Call `retriever.invoke(question)` and read the chunks before blaming the LLM.

## Key terms

- **Document loader** — component that reads a source into `Document` objects.
- **Text splitter** — component that breaks documents into chunks.
- **Vector store** — database that stores embeddings and supports similarity search.
- **Retriever** — interface that takes a query string and returns relevant documents.
- **LCEL** — LangChain Expression Language; composing Runnables with `|`.
- **Metadata** — key-value data attached to each document (source, page, date) used for citations and filtering.

## Interview quick-fire

- **"Walk me through the components of a RAG pipeline."** → Loader, splitter, embedding model and vector store for indexing; retriever, prompt, LLM and parser for querying.
- **"Vector store vs. retriever?"** → A vector store stores and searches vectors; a retriever is a more general "query in, documents out" interface that can wrap a vector store, BM25, a web search or several combined.
- **"What happens if you switch embedding models?"** → You must re-embed the whole corpus, because query vectors from the new model aren't comparable to stored vectors from the old one.
