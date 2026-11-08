---
title: "Serving a Fine-Tuned Model Behind an API"
---

## TL;DR

How you serve depends on where you trained. **Hosted fine-tunes** (OpenAI etc.) are already an API: call them by model ID. **Open-weight fine-tunes** need an **inference server**: **vLLM** or **TGI** on a GPU for production, **Ollama** for small or local use. All of these expose an **OpenAI-compatible endpoint**. Put a thin **FastAPI** layer in front for auth, validation, logging and your prompt, and keep the model server internal.

## Options

| Option | When | Notes |
|---|---|---|
| Hosted fine-tune (OpenAI) | You trained via the provider | Nothing to deploy; call `model="ft:..."` |
| vLLM | Production GPU serving | High throughput (continuous batching, PagedAttention), serves LoRA adapters |
| TGI (Text Generation Inference) | Production, Hugging Face stack | Docker-first, OpenAI-compatible Messages API |
| Ollama / llama.cpp | Small models, CPU or Mac, internal tools | GGUF, simple, lower throughput |
| Managed endpoints | HF Inference Endpoints, Together, Fireworks, cloud ML platforms | Upload weights or adapters, they run the GPUs |

## Architecture

```
client ──HTTPS──► FastAPI gateway ──HTTP (internal)──► vLLM :8000 ──► GPU
                   │  auth, rate limit                    base model
                   │  input validation                    + LoRA adapter(s)
                   │  system prompt / template
                   │  logging, metrics
                   ▼
                 response
```

Why a gateway instead of exposing vLLM directly: the model server has no real auth, and your app logic (prompt, schema, fallbacks) belongs in your code.

## vLLM

```bash
pip install vllm

# serve a merged model
vllm serve ./qwen-tickets-merged --served-model-name tickets --port 8000

# or serve the base model + LoRA adapter (no merge needed)
vllm serve Qwen/Qwen2.5-1.5B-Instruct \
  --enable-lora \
  --lora-modules tickets=./qwen-tickets-lora \
  --max-model-len 4096
```

Call it with the OpenAI SDK and `model="tickets"`. With `--enable-lora` you can serve several adapters on one base model and pick by name per request.

## TGI (Docker)

```bash
docker run --gpus all --shm-size 1g -p 8080:80 \
  -v $PWD/models:/data \
  ghcr.io/huggingface/text-generation-inference:latest \
  --model-id /data/qwen-tickets-merged
```

It exposes `/v1/chat/completions`, so the same client code works with `base_url="http://localhost:8080/v1"`. Pin an image tag in real deployments instead of `latest`.

## The FastAPI gateway

```python
import os
from fastapi import Depends, FastAPI, Header, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

LLM = AsyncOpenAI(base_url=os.getenv("LLM_BASE_URL", "http://localhost:8000/v1"), api_key="none")
MODEL = os.getenv("LLM_MODEL", "tickets")
SYSTEM = "Classify the support ticket. Reply with one label."
LABELS = {"billing", "bug", "feature_request", "account", "other"}

app = FastAPI()

def check_key(x_api_key: str = Header()):
    if x_api_key != os.environ["GATEWAY_API_KEY"]:
        raise HTTPException(401, "bad key")

class TicketIn(BaseModel):
    text: str = Field(min_length=3, max_length=4000)

class TicketOut(BaseModel):
    label: str

@app.post("/classify", response_model=TicketOut, dependencies=[Depends(check_key)])
async def classify(t: TicketIn):
    resp = await LLM.chat.completions.create(
        model=MODEL, temperature=0, max_tokens=5,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": t.text}],
    )
    label = resp.choices[0].message.content.strip().lower()
    return TicketOut(label=label if label in LABELS else "other")   # never trust raw output

@app.get("/health")
async def health():
    return {"ok": True}
```

```bash
uvicorn app:app --host 0.0.0.0 --port 9000
```

Swap `LLM_BASE_URL` / `LLM_MODEL` to point at OpenAI, vLLM, TGI or Ollama without code changes.

## Production concerns

| Concern | What to do |
|---|---|
| GPU sizing | Weights + KV cache must fit. Long contexts and high concurrency need more memory |
| Cold starts | Loading weights takes time; keep a warm replica or use a managed endpoint |
| Throughput | Let vLLM/TGI batch; don't serialize requests in your gateway |
| Versioning | Name models `tickets-v3`; keep the previous version ready for rollback |
| Observability | Log prompt, output, latency, tokens and model version per request |
| Cost | GPUs bill per hour, busy or idle. Low traffic may be cheaper on a hosted fine-tune or provider |
| Fallback | On errors or timeouts, fall back to a hosted model |

## Gotchas

- **Chat template mismatch** between training and serving is the top cause of "it was good in the notebook".
- **`max-model-len`** — vLLM reserves KV cache memory for it; lower it if the server won't start.
- **Shared memory** — TGI in Docker needs `--shm-size`.
- **Don't expose the model server publicly.** Put it behind the gateway or a private network.
- **Validate outputs** — even a fine-tuned model occasionally returns an unexpected label.

## Key terms

- **Inference server** — software that loads a model and serves requests efficiently (vLLM, TGI).
- **Continuous batching** — adding new requests to a running batch instead of waiting, which raises GPU use.
- **PagedAttention** — vLLM's memory management for the KV cache, reducing waste.
- **KV cache** — stored attention keys/values for tokens already processed, reused while generating.
- **Multi-LoRA serving** — serving many adapters on one shared base model.
- **Gateway** — your API layer in front of the model for auth, validation and logging.

## Interview quick-fire

- **"How would you serve a fine-tuned Llama in production?"** → vLLM (or TGI) on a GPU with an OpenAI-compatible endpoint, behind a FastAPI gateway for auth, validation and logging, with versioned models and a fallback.
- **"Why vLLM over plain transformers?"** → Continuous batching and PagedAttention give much higher throughput and better memory use.
- **"Merge the LoRA adapter or serve it separately?"** → Merge for one model and simplest ops; serve separately with multi-LoRA when you have many tasks or tenants on one base.
- **"When is self-hosting not worth it?"** → Low or spiky traffic, where idle GPU hours cost more than a hosted fine-tune or per-token provider.
