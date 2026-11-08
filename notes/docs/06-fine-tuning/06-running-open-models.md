---
title: "Running Open Models (Llama via Ollama/Groq)"
---

## TL;DR

Open-weight models (Llama, Qwen, Mistral, Gemma, DeepSeek) can run in three places: **on your machine** (Ollama, llama.cpp, LM Studio, MLX), on a **hosted open-model API** (Groq, Together, Fireworks, Hugging Face Inference Providers), or on **your own GPU server** (vLLM, TGI). Almost all of them speak the **OpenAI-compatible API**, so switching is a `base_url` and model name change. For your own fine-tune, you export it to a format the runtime understands (e.g. **GGUF** for Ollama).

Ollama setup and basics are in [Running Models Locally](../02-calling-models/08-running-models-locally.md). This note is about choosing where to run, and getting *your* model there.

## Where to run an open model

| Option | Examples | Best for | Trade-off |
|---|---|---|---|
| Local app | Ollama, LM Studio, llama.cpp, MLX | Dev, privacy, offline | Limited by laptop RAM |
| Hosted open-model API | Groq, Together, Fireworks, HF Inference Providers | Fast, cheap, no infra | Data goes to a third party; custom models vary by provider |
| Self-hosted GPU server | vLLM, TGI, SGLang | Production, your fine-tunes, full control | You run and pay for GPUs |

```
           your app (OpenAI SDK)
                   │  base_url = ?
     ┌─────────────┼───────────────────┐
     ▼             ▼                   ▼
localhost:11434  api.groq.com/...   your-gpu-box:8000
  (Ollama)        (Groq)             (vLLM)
```

## One client, many backends

```python
import os
from openai import OpenAI

BACKENDS = {
    "ollama": dict(base_url="http://localhost:11434/v1", api_key="ollama", model="llama3.2"),
    "groq":   dict(base_url="https://api.groq.com/openai/v1",
                   api_key=os.environ.get("GROQ_API_KEY", ""), model="llama-3.1-8b-instant"),
    "vllm":   dict(base_url="http://localhost:8000/v1", api_key="none",
                   model="Qwen/Qwen2.5-1.5B-Instruct"),
}

def ask(backend: str, question: str) -> str:
    cfg = BACKENDS[backend]
    client = OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"])
    resp = client.chat.completions.create(
        model=cfg["model"],
        messages=[{"role": "user", "content": question}],
    )
    return resp.choices[0].message.content

print(ask("groq", "Explain QLoRA in two sentences."))
```

Model IDs differ per provider and change over time. Check each provider's model list.

## Why Groq (and similar)

Groq runs open models on custom inference hardware, so token output is very fast. Together and Fireworks offer many open models and can host fine-tuned LoRA adapters. Use them when you want open models without managing GPUs. They're also a quick way to compare Llama vs Qwen vs Mistral on your eval set before committing.

## Getting your fine-tuned model into Ollama

Ollama runs **GGUF** files (the llama.cpp format, usually quantized). After training:

```
LoRA adapter ──merge──► 16-bit HF model ──convert──► GGUF ──quantize──► q4_K_M.gguf ──► Ollama
```

```bash
# 1. merge the adapter (see the LoRA note), giving ./merged
# 2. convert with llama.cpp
git clone https://github.com/ggml-org/llama.cpp
pip install -r llama.cpp/requirements.txt
python llama.cpp/convert_hf_to_gguf.py ./merged --outfile model-f16.gguf --outtype f16
# 3. quantize (build llama.cpp first; binary name may differ by version)
./llama.cpp/build/bin/llama-quantize model-f16.gguf model-q4_K_M.gguf Q4_K_M
```

```text
# Modelfile
FROM ./model-q4_K_M.gguf
PARAMETER temperature 0.2
SYSTEM "Classify the support ticket. Reply with one label."
```

```bash
ollama create ticket-tagger -f Modelfile
ollama run ticket-tagger "I was charged twice"
```

Tools like **Unsloth** can export straight to GGUF. If your Ollama build supports it, a Modelfile can also use `ADAPTER` to load a LoRA adapter on top of a matching base model. Make sure the chat template in the Modelfile matches the one you trained with.

## Picking a model size

| Size | Use |
|---|---|
| 0.5–3B | Classification, extraction, routing, on-device |
| 7–9B | General chat, RAG answers, most fine-tunes |
| 14–32B | Harder reasoning, coding, better instruction following |
| 70B+ | Near-frontier quality; needs serious GPUs or a hosted API |

Fine-tuned small models often beat much larger general models on one narrow task.

## Gotchas

- **Licences differ.** Llama, Gemma and Qwen each have their own terms. Read them before shipping.
- **Quantization hurts small models more.** A 1B model at 4-bit degrades more than an 8B at 4-bit.
- **Template mismatches** after GGUF conversion cause gibberish or endless output.
- **Tool calling** quality varies a lot across open models and runtimes. Test it.
- **Rate limits** on free tiers of hosted APIs are low; plan for retries.

## Key terms

- **Open-weight model** — a model whose trained weights are downloadable.
- **GGUF** — the llama.cpp file format for (usually quantized) models, used by Ollama and LM Studio.
- **Groq** — a hosted inference provider known for very fast open-model serving.
- **OpenAI-compatible API** — an endpoint that accepts the same requests as OpenAI's Chat Completions.
- **Inference provider** — a company that hosts models behind an API.

## Interview quick-fire

- **"How would you try Llama without a GPU?"** → Ollama locally for small sizes, or a hosted provider like Groq or Together via the OpenAI SDK.
- **"How do you get a fine-tuned HF model into Ollama?"** → Merge the LoRA adapter, convert to GGUF with llama.cpp, quantize, and reference it in a Modelfile.
- **"Why do so many runtimes copy the OpenAI API?"** → So apps can switch providers by changing the base URL and model name, with no code rewrite.
- **"Local vs hosted open models?"** → Local: private and free per call but hardware-limited. Hosted: fast and scalable but data leaves your infra.
