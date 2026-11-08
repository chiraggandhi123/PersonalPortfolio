---
title: The AI Engineer Roadmap
sidebar_label: 🗺️ The Roadmap
sidebar_position: 2
slug: /roadmap
---

This track takes you from writing your first Python script to shipping **production AI agents**. It's for software engineers who want to build on top of LLMs: calling them, grounding them in data, wiring them into tools, and running them reliably. Model training from scratch is out of scope.

At a steady 8–10 hours a week, expect roughly **5–7 months** end to end. Stages 0–2 go fast if you already code.

## How to use this roadmap

For every note:

1. **Read the TL;DR**, then the full note.
2. **Run the code.** Change one thing and predict what will happen before you run it.
3. **Answer the interview quick-fire out loud** without looking.
4. **Build the stage project.** That's where the real learning happens. Fill in its "What I learned" section.

**Move on when** you can build the stage project without copying code, and explain each key term in one sentence.

## The path at a glance

| Stage | Focus | Notes |
| :---: | --- | --- |
| 0 | Python for AI | [Open →](/python-for-ai) |
| 1 | LLM Basics | [Open →](/llm-basics) |
| 2 | Calling Models | [Open →](/calling-models) |
| 3 | Prompting & LLM Apps | [Open →](/prompting-llm-apps) |
| 4 | Retrieval (RAG) | [Open →](/rag) |
| 5 | Advanced & Production RAG | [Open →](/advanced-rag) |
| 6 | Fine-Tuning & Open Models | [Open →](/fine-tuning) |
| 7 | Agentic AI | [Open →](/agentic-ai) |
| 8 | AgentOps, MCP & Production | [Open →](/agentops) |

## Stage 0 · Python for AI

Every AI framework, SDK and notebook is Python. You need data structures, functions, classes, **Pydantic**, virtual environments, environment variables for API keys, HTTP calls and a little `async`.

**By the end:** a script that calls an LLM API, validates the response with Pydantic, and puts it behind a Streamlit or Gradio UI.

## Stage 1 · LLM Basics

Know what's actually happening when you call a model: tokens, context windows, attention, embeddings, sampling and why models hallucinate. This is the mental model behind every design decision later.

**By the end:** a terminal chatbot with memory, and the vocabulary to explain how it works.

## Stage 2 · Calling Models

The API surface every LLM app is built on: messages and roles, streaming, **structured outputs**, **tool calling**, retries, rate limits, cost tracking, local models and provider-agnostic clients.

**By the end:** robust, typed, streamed LLM calls that survive errors and can switch providers.

## Stage 3 · Prompting & LLM Apps

Turn raw calls into an app: prompt patterns, system prompts, templates and versioning, output validation, conversation memory, LangChain, a front end, deployment, and a first look at prompt injection.

**By the end:** a deployed, multi-feature LLM app such as a resume assistant or an interview evaluator.

## Stage 4 · Retrieval (RAG)

Models don't know your data. RAG fixes that: ingest and chunk documents, embed them, store them in a vector database, retrieve with hybrid search, and generate grounded answers. Then make it agentic with LangGraph.

**By the end:** a document Q&A chatbot that cites its sources.

## Stage 5 · Advanced & Production RAG

Basic RAG fails in predictable ways. Learn corrective and self-RAG, Text2SQL, caching and gateways, guardrails, **evaluation (RAGAS)**, and how to debug retrieval failures.

**By the end:** a measured, self-correcting RAG pipeline with an evaluation suite.

## Stage 6 · Fine-Tuning & Open Models

Know when fine-tuning beats prompting or RAG (rarely, but sometimes). Build datasets, train with **LoRA/QLoRA**, evaluate against a baseline, and serve open models behind an API.

**By the end:** a fine-tuned small model that beats its base model on one narrow task.

## Stage 7 · Agentic AI

Agents decide what to do next. Learn the ReAct loop, memory, **LangGraph** (state, nodes, edges, checkpointers, interrupts), multi-agent patterns, MCP, and frameworks like CrewAI, AutoGen, OpenAI Agents SDK and Google ADK.

**By the end:** a deployed agentic chatbot with tools, persistence and human-in-the-loop.

## Stage 8 · AgentOps, MCP & Production

Shipping agents is an ops problem: **MCP and A2A** for interoperability, tracing (Langfuse/Opik/LangSmith), agent evaluation, security, containers and CI/CD, cloud deployment and production monitoring.

**By the end:** a traced, evaluated, containerised multi-agent system running in the cloud.

## Free resources

- **Python** — the official Python tutorial (docs.python.org), and the Pydantic docs.
- **LLM fundamentals** — Andrej Karpathy's "Neural Networks: Zero to Hero" and "Intro to Large Language Models" videos; Jay Alammar's "The Illustrated Transformer".
- **APIs** — the OpenAI, Anthropic and Google Gemini API docs and cookbooks.
- **Prompting** — the prompt engineering guides from OpenAI and Anthropic.
- **RAG & agents** — LangChain and LangGraph docs, plus the LangChain Academy courses; DeepLearning.AI short courses.
- **Fine-tuning** — the Hugging Face LLM course, and the PEFT/TRL docs.
- **Production** — the Model Context Protocol docs; the Langfuse and LangSmith docs.

## Suggested pace

| Stage | Time (8–10 h/week) |
| :---: | --- |
| 0 · Python for AI | 2–3 weeks (skip if you already code in Python) |
| 1 · LLM Basics | 1–2 weeks |
| 2 · Calling Models | 2 weeks |
| 3 · Prompting & LLM Apps | 3 weeks |
| 4 · Retrieval (RAG) | 4–5 weeks |
| 5 · Advanced & Production RAG | 3 weeks |
| 6 · Fine-Tuning & Open Models | 2–3 weeks |
| 7 · Agentic AI | 5–6 weeks |
| 8 · AgentOps, MCP & Production | 4 weeks |

Don't rush stages 4 and 7. They're where most real-world AI engineering work lives.
