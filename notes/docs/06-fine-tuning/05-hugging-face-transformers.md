---
title: "Hugging Face Transformers (load, tokenize, infer)"
---

## TL;DR

**Hugging Face** is the GitHub of open models: the **Hub** hosts models and datasets, and the **`transformers`** library loads them with the same few classes. Three levels: **`pipeline()`** for one-liners, **`AutoTokenizer` + `AutoModel...`** for control, and **`generate()`** for text generation. Learn this before fine-tuning: training is the same objects plus a trainer.

## The ecosystem

| Library | Job |
|---|---|
| `transformers` | Load models and tokenizers, run inference, train |
| `datasets` | Load, map, split and stream datasets |
| `huggingface_hub` | Download/upload to the Hub, auth |
| `peft` | LoRA and other adapters |
| `trl` | Fine-tuning recipes: `SFTTrainer`, `DPOTrainer` |
| `accelerate` | Multi-GPU and device placement |
| `bitsandbytes` | 8-bit / 4-bit quantization |

```bash
pip install transformers datasets accelerate torch
huggingface-cli login        # needed for gated models like Llama
```

## Level 1: `pipeline()`

```python
from transformers import pipeline

summarize = pipeline("summarization", model="facebook/bart-large-cnn")
print(summarize(long_article, max_length=80, min_length=30)[0]["summary_text"])

classify = pipeline("sentiment-analysis")      # picks a default model
print(classify("This course is great"))         # [{'label': 'POSITIVE', 'score': 0.99}]

chat = pipeline("text-generation", model="Qwen/Qwen2.5-0.5B-Instruct")
out = chat([{"role": "user", "content": "Name three vector databases."}], max_new_tokens=60)
print(out[0]["generated_text"][-1]["content"])
```

Good for prototypes and classic NLP tasks. Hides the details you'll need for fine-tuning.

## Level 2: tokenizer + model

```
"Hello world" ──tokenizer──► input_ids [9707, 1879] ──model──► logits ──decode──► text
```

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype="auto", device_map="auto")

messages = [
    {"role": "system", "content": "You are concise."},
    {"role": "user", "content": "What is LoRA?"},
]
inputs = tok.apply_chat_template(
    messages, add_generation_prompt=True, return_tensors="pt", return_dict=True
).to(model.device)

with torch.no_grad():
    out = model.generate(**inputs, max_new_tokens=120, do_sample=True, temperature=0.7)

new_tokens = out[0][inputs["input_ids"].shape[1]:]      # drop the prompt
print(tok.decode(new_tokens, skip_special_tokens=True))
```

- `add_generation_prompt=True` appends the "assistant, your turn" marker.
- `device_map="auto"` puts layers on GPU / Apple MPS / CPU automatically.
- `torch_dtype="auto"` uses the dtype the model was saved in (usually bf16).

## The Auto classes

| Class | For |
|---|---|
| `AutoTokenizer` | Any model's tokenizer |
| `AutoModelForCausalLM` | Decoder-only chat/generation (Llama, Qwen, Mistral) |
| `AutoModelForSeq2SeqLM` | Encoder–decoder (T5, BART), e.g. summarization |
| `AutoModelForSequenceClassification` | Classification heads (BERT-style) |
| `AutoModel` | Raw hidden states, e.g. for embeddings |

The model card on the Hub tells you which class and chat template a model uses.

## Generation settings

| Arg | Meaning |
|---|---|
| `max_new_tokens` | Cap on generated tokens (not counting the prompt) |
| `do_sample` | `False` = greedy (deterministic), `True` = sample |
| `temperature`, `top_p` | Sampling randomness, same as in APIs |
| `repetition_penalty` | Discourage loops in small models |
| `num_beams` | Beam search, mainly for seq2seq tasks |

## Loading big models in less memory

```python
from transformers import BitsAndBytesConfig
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B-Instruct",
    quantization_config=BitsAndBytesConfig(load_in_4bit=True),
    device_map="auto",
)
```

Rule of thumb: about 2 bytes per parameter in 16-bit, about 0.5–0.7 in 4-bit. An 8B model needs about 16 GB in bf16, 5–6 GB in 4-bit.

## Gotchas

- **Raw `transformers` is slow for serving.** Fine for experiments; use vLLM or TGI in production ([serving note](08-serving-a-fine-tuned-model-behind-an-api.md)).
- **Gated models** (Llama, Gemma) need you to accept the licence on the Hub and log in.
- **Cache size** — models download to `~/.cache/huggingface`. Set `HF_HOME` to move it.
- **Forgetting the chat template** gives rambling output from instruct models.
- **Decoding the whole output** repeats the prompt; slice off the input tokens.

## Key terms

- **Hugging Face Hub** — hosting site for models, datasets and demo apps (Spaces).
- **Tokenizer** — converts text to token IDs and back.
- **Model card** — the README for a model: intended use, licence, prompt format.
- **`pipeline`** — high-level helper that bundles tokenizer, model and post-processing.
- **`generate()`** — the method that runs autoregressive decoding.
- **Causal LM** — a model that predicts the next token from the previous ones.

## Interview quick-fire

- **"How do you run an open model with Hugging Face?"** → `AutoTokenizer` and `AutoModelForCausalLM.from_pretrained`, apply the chat template, call `generate`, decode only the new tokens.
- **"pipeline vs manual loading?"** → `pipeline` is a quick one-liner; manual loading gives control over dtype, quantization, templates and batching.
- **"How much memory does a 7B model need?"** → About 14 GB in 16-bit, roughly 4–5 GB in 4-bit, plus room for the KV cache.
- **"Why not serve with raw transformers?"** → No continuous batching or paged KV cache, so throughput is far lower than vLLM or TGI.
