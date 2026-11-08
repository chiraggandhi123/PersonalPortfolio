---
title: "When to Fine-Tune (and when not to)"
---

## TL;DR

Fine-tune when you have a **narrow, repeated task**, a **clear quality bar you can measure**, and **enough good examples** (hundreds at least), and prompting has already hit its ceiling. Good reasons: **consistent format or tone, classification/extraction at scale, and distilling a big model into a small cheap one.** Bad reasons: teaching facts, fixing a vague task, or "it feels more custom". You can fine-tune **hosted** (e.g. OpenAI's fine-tuning API) or **open-weight** models (Hugging Face + LoRA).

## Good reasons to fine-tune

| Reason | Example |
|---|---|
| Consistent style or voice | Replies that always sound like your brand |
| Strict output format | Always the same JSON or report layout, even on odd inputs |
| Classification / extraction at volume | Tag millions of tickets with your 40 internal labels |
| Shorter prompts | Bake a 3k-token instruction block into the weights |
| Distillation | Use a large model to label data, fine-tune a small model to copy it |
| Domain jargon | Medical, legal or internal shorthand the base model misreads |
| Latency / privacy | A small fine-tuned open model on your own hardware |

## Bad reasons (do something else)

| Reason | Better option |
|---|---|
| "The model doesn't know our product" | RAG |
| "The answers are wrong sometimes" and you can't say how | Write an eval set and improve the prompt first |
| "We want JSON" | Structured outputs |
| "We need the latest data" | RAG or tools |
| You have 30 examples | Few-shot prompting |
| The task changes every week | Prompting (cheap to change) |

## The readiness checklist

```
[ ] A prompt-only baseline exists and its weaknesses are measured
[ ] The task is narrow and stable
[ ] 200+ high-quality examples (often 500–5,000 for real gains)
[ ] A held-out eval set the model never trains on
[ ] A metric that tells you "better" vs "worse"
[ ] Someone owns retraining when the base model or task changes
```

If you can't tick most of these, you're not ready. The eval set matters most.

## Hosted vs open-weight fine-tuning

| | Hosted (OpenAI, Gemini, etc.) | Open-weight (Llama, Qwen, Mistral via HF) |
|---|---|---|
| Effort | Upload JSONL, start a job | Write a training script, rent a GPU |
| Control | Few knobs (epochs, LR multiplier) | Everything: method, rank, data mix |
| Where it runs | Provider's API only | Anywhere, including your own servers |
| Data leaves your infra | Yes | No |
| Best for | Fast results with little ML work | Privacy, cost at scale, full control |

### Hosted: OpenAI fine-tuning API in a few lines

```python
from openai import OpenAI

client = OpenAI()

# train.jsonl: one {"messages": [...]} chat example per line
file = client.files.create(file=open("train.jsonl", "rb"), purpose="fine-tune")

job = client.fine_tuning.jobs.create(
    training_file=file.id,
    model="gpt-4o-mini-2024-07-18",     # must be a snapshot that supports fine-tuning
    suffix="ticket-tagger",
)

# later
job = client.fine_tuning.jobs.retrieve(job.id)
print(job.status, job.fine_tuned_model)   # e.g. ft:gpt-4o-mini-...:ticket-tagger:...
```

Then call it like any model: `model=job.fine_tuned_model`. Check the docs for which models currently support fine-tuning; it changes.

### Open-weight

Covered in the next notes: [datasets](03-datasets-for-fine-tuning.md), [LoRA and QLoRA](04-lora-qlora.md), and [Hugging Face Transformers](05-hugging-face-transformers.md).

## Types of fine-tuning

- **Supervised fine-tuning (SFT)** — train on input → ideal output pairs. What most people mean.
- **Preference tuning (DPO, RLHF)** — train on "A is better than B" pairs to shift tone or safety.
- **Continued pre-training** — train on raw domain text. Expensive, rarely needed for app work.
- **Full vs parameter-efficient** — update every weight, or only small adapters (LoRA). PEFT is the default now.

## Gotchas

- **Catastrophic forgetting** — narrow training can make the model worse at general tasks. Keep evals broad.
- **Garbage in, garbage out** — the model copies your examples' mistakes faithfully.
- **Base model upgrades** — a new base model may beat your fine-tune with just a prompt. Re-check.
- **Maintenance is the hidden cost** — data pipelines, retraining, versioning, serving.

## Key terms

- **SFT (supervised fine-tuning)** — training on labelled input/output examples.
- **DPO (direct preference optimisation)** — training on preferred vs rejected responses, without a reward model.
- **Distillation** — training a small model on a larger model's outputs.
- **Catastrophic forgetting** — losing general ability after training on a narrow task.
- **PEFT** — parameter-efficient fine-tuning; only a small number of new weights are trained.

## Interview quick-fire

- **"Give me a strong case for fine-tuning."** → A high-volume narrow task (e.g. ticket classification) where a fine-tuned small model matches a big model's accuracy at a fraction of the cost and latency.
- **"How many examples do you need?"** → Hundreds to start seeing gains, low thousands for solid results. Quality and coverage beat raw count.
- **"What would make you not fine-tune?"** → No eval set, a changing task, a knowledge problem (use RAG), or a prompt that already works.
- **"What is distillation?"** → Generating outputs with a strong model, then fine-tuning a smaller model on them so it imitates the larger one cheaply.
