---
title: "Running Models Locally (Ollama)"
---

## TL;DR

**Ollama** runs open-weight models (Llama, Qwen, Gemma, Mistral, DeepSeek…) on your own machine with one command, and serves them on an **OpenAI-compatible API** at `localhost:11434`. That means your existing OpenAI code works locally by changing the `base_url`. Local models are free per call and private, but smaller and weaker than frontier APIs, and limited by your RAM/GPU.

## Why run locally

| Good for | Not great for |
|---|---|
| Privacy: data never leaves your machine | Hard reasoning, long complex tasks |
| Zero per-token cost for dev and experiments | Big context windows on a laptop |
| Offline work | High-traffic production on one machine |
| Learning how models, quantization and sampling behave | Tool calling as reliable as frontier models |

## Setup

```bash
brew install ollama            # macOS; Linux/Windows installers on ollama.com
ollama serve                   # starts the server (the desktop app does this for you)

ollama pull llama3.2           # ~2 GB, 3B parameters, runs on most laptops
ollama run llama3.2            # chat in the terminal
```

Useful commands:

```bash
ollama list                    # downloaded models
ollama ps                      # models currently loaded in memory
ollama rm llama3.2             # free disk space
```

## Calling it from Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama",               # required by the SDK, ignored by Ollama
)

resp = client.chat.completions.create(
    model="llama3.2",
    messages=[{"role": "user", "content": "Explain embeddings in one sentence."}],
)
print(resp.choices[0].message.content)
```

Streaming, JSON mode and (for models that support it) tool calling work through the same interface. Same code, local model.

There's also a native client (`pip install ollama`) with a few Ollama-specific options:

```python
import ollama
resp = ollama.chat(model="llama3.2", messages=[{"role": "user", "content": "Hi"}])
print(resp.message.content)
```

## Which model will my machine run?

The rule of thumb is about **memory**. With 4-bit quantization (Ollama's default):

| Model size | Approx. RAM / VRAM needed | Example hardware |
|---|---|---|
| 1–4B | 2–4 GB | Any recent laptop |
| 7–9B | 5–8 GB | 16 GB laptop, Apple Silicon |
| 13–14B | 9–12 GB | 32 GB Mac / 12 GB GPU |
| 30–34B | 20–24 GB | 64 GB Mac / 24 GB GPU |
| 70B | 40+ GB | Workstation / multi-GPU |

Apple Silicon Macs are good at this because the GPU shares system memory.

## Quantization in one paragraph

Model weights are normally 16-bit numbers. **Quantization** stores them in fewer bits (8, 5, 4…), shrinking memory use about 4× at 4-bit with a small quality loss. Tags like `q4_K_M` or `q8_0` on Ollama model pages are the quantization level: lower bits = smaller and faster, slightly dumber.

## Customizing with a Modelfile

```text
# Modelfile
FROM llama3.2
PARAMETER temperature 0.2
PARAMETER num_ctx 8192
SYSTEM "You are a terse senior Python reviewer."
```

```bash
ollama create py-reviewer -f Modelfile
ollama run py-reviewer
```

`num_ctx` matters: Ollama's default context window is small, and silently truncates long prompts. Raise it for RAG or long chats (it costs more memory).

## Local embeddings too

```bash
ollama pull nomic-embed-text
```

```python
emb = client.embeddings.create(model="nomic-embed-text", input="hello world")
print(len(emb.data[0].embedding))
```

That gives a fully local RAG stack: local embeddings + local vector DB + local chat model.

## Alternatives

- **LM Studio** — desktop app with a model browser and an OpenAI-compatible server.
- **llama.cpp** — the C++ engine underneath many of these tools; most control.
- **vLLM / TGI** — high-throughput servers for production GPU deployments.
- **MLX** — Apple's framework, fast on Apple Silicon.

## Key terms

- **Open-weight model** — a model whose weights you can download and run yourself.
- **Ollama** — a tool that downloads, runs and serves local models behind an OpenAI-compatible API.
- **Quantization** — storing weights in fewer bits to cut memory and speed up inference.
- **num_ctx** — the context window size Ollama allocates for a model.
- **Modelfile** — Ollama's recipe for a custom model: base model, parameters, system prompt.

## Interview quick-fire

- **"Why would you run an LLM locally instead of using an API?"** → Data privacy, no per-token cost, offline use, and full control; at the cost of smaller models and your own hardware limits.
- **"What is quantization and what's the trade-off?"** → Storing weights at lower precision (e.g. 4-bit) to cut memory and speed up inference, with a small loss in quality.
- **"How do you swap a cloud model for a local one with minimal code change?"** → Serve it behind an OpenAI-compatible endpoint (Ollama, vLLM) and change the client's `base_url` and model name.
