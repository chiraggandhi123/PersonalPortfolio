---
title: "LoRA & QLoRA (parameter-efficient tuning)"
---

## TL;DR

Full fine-tuning updates every weight and needs huge GPU memory. **LoRA** freezes the model and trains tiny **low-rank adapter matrices** next to selected layers, usually under 1% of the parameters. **QLoRA** also loads the frozen base model in **4-bit**, so a 7–8B model fits on a single consumer or free-tier GPU. Quality is close to full fine-tuning for most app tasks. The result is a small **adapter file** you load on top of the base model or merge into it.

## The idea

A weight matrix `W` (say 4096 × 4096) is frozen. LoRA learns an update `ΔW = B · A`, where `A` is `r × 4096` and `B` is `4096 × r`, with a small rank `r` like 8 or 16.

```
           input x
              │
      ┌───────┴────────┐
      ▼                ▼
  W (frozen)      A (r×d) ─► B (d×r)     ← trainable, tiny
      │                │   × (alpha / r)
      └──────► + ◄─────┘
              │
           output
```

Parameters trained per matrix: `2 · d · r` instead of `d²`. For `d = 4096, r = 16` that's about 131k instead of 16.7M, roughly 0.8%.

## Memory comparison (rough, 7–8B model)

| Method | Base weights | Trainable | Fits on |
|---|---|---|---|
| Full fine-tune (16-bit + Adam) | 16-bit, trained | 100% | Multiple large GPUs |
| LoRA | 16-bit, frozen | ~0.1–1% | One 24–40 GB GPU |
| QLoRA | 4-bit, frozen | ~0.1–1% | One 16 GB GPU (e.g. a free Colab T4) |

## Key hyperparameters

| Knob | Typical | Effect |
|---|---|---|
| `r` (rank) | 8–64 | Capacity of the adapter. Higher = more expressive, more memory |
| `lora_alpha` | 16–2·r | Scales the update (`alpha / r`) |
| `lora_dropout` | 0.0–0.1 | Regularisation |
| `target_modules` | attention projections, or `"all-linear"` | Which layers get adapters. All-linear usually works best |
| learning rate | 1e-4 – 2e-4 | Higher than full fine-tuning |
| epochs | 1–3 | More often overfits |

## QLoRA with TRL in one script

```python
import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

BASE = "Qwen/Qwen2.5-1.5B-Instruct"     # small enough to try on a free GPU

bnb = BitsAndBytesConfig(                # the "Q" in QLoRA
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,   # use torch.float16 on older GPUs (T4)
    bnb_4bit_use_double_quant=True,
)
model = AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, device_map="auto")
tokenizer = AutoTokenizer.from_pretrained(BASE)

peft_config = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05,
    target_modules="all-linear", task_type="CAUSAL_LM",
)

data = load_dataset("json", data_files={"train": "train.jsonl", "test": "eval.jsonl"})

args = SFTConfig(
    output_dir="qwen-tickets-lora",
    num_train_epochs=2,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,       # effective batch 16
    learning_rate=2e-4,
    max_length=1024,
    gradient_checkpointing=True,         # trade compute for memory
    logging_steps=10,
    eval_strategy="epoch",
    bf16=True,                            # fp16=True on GPUs without bf16
)

trainer = SFTTrainer(
    model=model,
    args=args,
    train_dataset=data["train"],          # "messages" column → chat template applied
    eval_dataset=data["test"],
    processing_class=tokenizer,
    peft_config=peft_config,
)
trainer.train()
trainer.save_model()                      # saves only the adapter (a few MB to ~100 MB)
```

## Using the adapter

```python
from peft import AutoPeftModelForCausalLM

model = AutoPeftModelForCausalLM.from_pretrained("qwen-tickets-lora", device_map="auto")

# Option 1: keep it separate (swap adapters per customer/task)
# Option 2: merge for simpler, faster serving
merged = model.merge_and_unload()
merged.save_pretrained("qwen-tickets-merged")
```

Merge into a **16-bit** copy of the base model, not the 4-bit one, for the cleanest result. Servers like vLLM can also load LoRA adapters directly and serve many on one base model.

## Gotchas

- **Loss going down isn't success.** Check the eval set and real outputs.
- **Overfitting** shows up as eval loss rising while train loss falls. Fewer epochs, more data.
- **Tokenizer padding** — many models ship without a pad token; TRL handles it, raw scripts may not.
- **bf16 vs fp16** — older GPUs (T4, V100) lack bf16; use fp16.
- **bitsandbytes** needs a CUDA GPU. On Apple Silicon use MLX-LM for LoRA instead.
- **Libraries move fast.** `peft`, `trl` and `transformers` rename arguments between versions; pin versions in `requirements.txt`.

## Key terms

- **LoRA** — low-rank adaptation; trains small matrices added to frozen weights.
- **QLoRA** — LoRA on a base model quantized to 4-bit.
- **Rank (r)** — inner dimension of the adapter matrices; controls capacity.
- **Adapter** — the saved LoRA weights, loaded on top of a base model.
- **NF4** — a 4-bit data type designed for normally distributed weights, used by QLoRA.
- **Merging** — folding the adapter into the base weights to get a normal standalone model.

## Interview quick-fire

- **"Explain LoRA in one breath."** → Freeze the model, learn a low-rank update `B·A` for selected weight matrices, so you train well under 1% of parameters with similar quality.
- **"What does QLoRA add?"** → It quantizes the frozen base to 4-bit (NF4), cutting memory enough to fine-tune 7B+ models on one modest GPU.
- **"How do you choose rank?"** → Start at 8–16 on all linear layers; raise it only if the eval shows underfitting.
- **"Merge or keep adapters separate?"** → Merge for simplest serving; keep separate to hot-swap many task adapters on one base model.
