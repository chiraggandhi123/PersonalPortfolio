---
title: "Introduction"
---

## TL;DR

This stage is about **Retrieval-Augmented Generation (RAG)**: giving an LLM the right documents at question time so it answers from **your data** instead of its memory. It starts with a basic pipeline (load → chunk → embed → store → retrieve → generate), improves each step, then moves to **agents and LangGraph** so retrieval can become a decision the model makes. It ends with evaluation, guardrails, graph databases and an end-to-end project.

## Why this stage matters

An LLM on its own has three hard limits for real products:

| Limit | What it looks like | How RAG helps |
|---|---|---|
| Knowledge cutoff | "I don't have information after my training date" | Retrieve fresh documents at query time |
| No private data | It has never seen your wiki, contracts or tickets | Index your own documents |
| Hallucination | Confident, wrong answers with no source | Ground the answer in retrieved text and cite it |

Most LLM features in companies ("chat with our docs", support bots, internal search, code assistants) are some form of RAG. It is usually the first thing to try before fine-tuning.

## The basic pipeline you will build

```
INDEXING (offline, once per document change)
  files / web / DB ──► load ──► chunk ──► embed ──► vector store

QUERYING (online, every question)
  question ──► embed ──► retrieve top-k chunks ──► prompt = question + chunks ──► LLM ──► answer + sources
```

Every note in the first half of the stage zooms into one box of this diagram.

## Roadmap of the stage

| Part | Notes | What you learn |
|---|---|---|
| Foundations | 02–04 | What RAG is, its components, environment setup |
| Indexing | 05–08 | Loading and parsing files, embeddings, vector stores, chunking |
| Retrieval | 09–11 | Hybrid search, reranking, query rewriting, images and tables |
| Agents & tooling | 12–16 | Agents, LangChain v1, LangGraph, the Lang* ecosystem, agent architectures |
| Smarter RAG | 17–24 | Agentic, autonomous, multi-agent, corrective, adaptive/self, memory, caching, vectorless RAG |
| Production | 25–27 | Guardrails, LLM gateways, evaluation |
| Graphs & capstone | 28–30 | Graph databases, Cypher, GraphRAG with LangChain, an end-to-end project |

Start with [Introduction to RAG](./02-introduction-to-rag.md) and [Core Components in RAG](./03-core-components-in-rag.md). After note 08 you can build a working document Q&A app.

## Default stack used in these notes

| Layer | Default | Alternatives |
|---|---|---|
| LLM | OpenAI `gpt-4o-mini` | Claude, Gemini, Llama/Mistral via Ollama or Groq |
| Embeddings | `text-embedding-3-small` | Cohere, Voyage, BGE / E5 via sentence-transformers |
| Framework | LangChain (`langchain-core`, `langchain-openai`, `langchain-community`) | LlamaIndex, Haystack, plain Python |
| Orchestration | LangGraph | Plain loops, OpenAI Agents SDK |
| Vector store | Chroma (local, persistent), FAISS (in-memory) | Pinecone, Qdrant, Weaviate, Milvus, pgvector |
| Observability | LangSmith | Langfuse, Phoenix |

LangChain is used because it gives one interface over many loaders, vector stores and models. You should still understand what each piece does underneath, so several notes show the plain-Python version first.

## Prerequisites

- Python basics, virtual environments, `.env` files.
- Calling a chat model and reading the response.
- [Embeddings](../01-llm-basics/04-embeddings.md): what a vector is and what cosine similarity measures.
- [Tool calling](../02-calling-models/05-tool-function-calling.md): needed from the agents notes onward.

## Projects in this stage

- [RAG-based document search](./projects/01-rag-based-document-search.md)
- [End-to-end medical chatbot](./projects/02-end-to-end-medical-chatbot.md)
- [Knowledge intelligence system](./projects/03-knowledge-intelligence-system.md)
- [Real-time source code analyzer](./projects/04-realtime-source-code-analyzer.md)
- [Air India RAG chatbot](./projects/05-air-india-rag-chatbot.md)

## How to study this stage

- **Build the naive pipeline first.** You need a baseline before "advanced" techniques mean anything.
- **Keep a small test set.** Write 15–20 questions with known answers from your documents. Rerun them after every change.
- **Look at the retrieved chunks, not only the answer.** Most bad answers come from bad retrieval.
- **Add complexity only when a test fails.** Hybrid search, reranking and agents all cost latency and money.

## Key terms

- **RAG** — retrieving relevant documents and adding them to the prompt so the model answers from them.
- **Indexing** — the offline step that turns documents into searchable chunks and vectors.
- **Retrieval** — finding the chunks most relevant to a query.
- **Grounding** — making the answer depend on supplied sources rather than model memory.
- **Agentic RAG** — RAG where an agent decides when, what and how to retrieve.

## Interview quick-fire

- **"What problem does RAG solve?"** → It gives the model up-to-date and private knowledge at query time, which reduces hallucination and allows citations, without retraining.
- **"What are the two phases of a RAG system?"** → Indexing (load, chunk, embed, store) offline, and querying (retrieve, augment the prompt, generate) online.
- **"RAG or fine-tuning first?"** → Usually RAG: it is cheaper, updates instantly when documents change, and can cite sources. Fine-tune for style or format, not for facts.
