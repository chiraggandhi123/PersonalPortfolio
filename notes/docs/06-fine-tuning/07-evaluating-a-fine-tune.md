---
title: "Evaluating a Fine-Tune"
---

## TL;DR

A fine-tune is only "better" if it **beats a baseline on a held-out eval set** that reflects real use. Compare at least three things: the **base model with a good prompt**, a **stronger model with a good prompt**, and **your fine-tune**. Use **task metrics** (accuracy, F1, ROUGE, schema validity) where answers are checkable, **LLM-as-judge** for open-ended outputs, and a **regression check** so you don't lose general ability. Training loss is a debugging signal, not an eval.

## What to compare

```
                    same held-out eval set
          ┌──────────────┬──────────────┬──────────────┐
          ▼              ▼              ▼              ▼
   base + prompt   big model + prompt   fine-tune   previous fine-tune
          │              │              │              │
          └──────── metrics, cost, latency per call ───┘
```

If the fine-tune doesn't beat "base + prompt" clearly, it isn't worth the maintenance.

## Pick metrics that fit the task

| Task | Metric | Notes |
|---|---|---|
| Classification / labels | Accuracy, macro F1, confusion matrix | Macro F1 if labels are imbalanced |
| Extraction / JSON | Schema-valid rate, field-level exact match | Score each field separately |
| Summarization | ROUGE, plus LLM-judge for faithfulness | ROUGE rewards word overlap, not truth |
| Style / tone | LLM-judge or human preference (A vs B) | Pairwise beats 1–10 scores |
| Open QA | LLM-judge against a reference answer | Spot-check the judge |
| General ability | A small benchmark (e.g. via lm-evaluation-harness) | Catches catastrophic forgetting |

Also track **cost per call** and **latency**. A fine-tuned small model that matches accuracy at a tenth of the cost is a win.

## Training curves (the debugging view)

```
loss
 │\
 │ \   train
 │  \___________
 │   \     ____/  eval   ← eval rising while train falls = overfitting
 │    \___/
 └─────────────── steps
```

Pick the checkpoint with the best **eval** score, not the last one.

## A simple eval harness (classification)

Works for anything behind an OpenAI-compatible endpoint: OpenAI fine-tunes, vLLM, Ollama.

```python
import json
from openai import OpenAI
from sklearn.metrics import classification_report

SYSTEM = "Classify the support ticket. Reply with one label."

def predict(client: OpenAI, model: str, text: str) -> str:
    resp = client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
    )
    return resp.choices[0].message.content.strip().lower()

rows = [json.loads(l) for l in open("eval.jsonl")]
gold = [r["messages"][-1]["content"] for r in rows]
inputs = [r["messages"][1]["content"] for r in rows]

candidates = {
    "base": (OpenAI(), "gpt-4o-mini"),
    "fine-tune": (OpenAI(), "ft:gpt-4o-mini-2024-07-18:acme:ticket-tagger:abc123"),
    "local-qlora": (OpenAI(base_url="http://localhost:8000/v1", api_key="x"), "tickets"),
}

for name, (client, model) in candidates.items():
    preds = [predict(client, model, t) for t in inputs]
    print(f"=== {name} ===")
    print(classification_report(gold, preds, zero_division=0))
```

## LLM-as-judge for open-ended output

Pairwise comparison is more reliable than absolute scores.

```python
from typing import Literal
from pydantic import BaseModel

class Verdict(BaseModel):
    reasoning: str
    winner: Literal["A", "B", "tie"]

def judge(question: str, a: str, b: str) -> Verdict:
    resp = OpenAI().chat.completions.parse(
        model="gpt-4o",                 # use a stronger model than the ones being judged
        response_format=Verdict,
        messages=[
            {"role": "system", "content": "Compare two answers for correctness, faithfulness "
                                          "and following the required format. Ignore length."},
            {"role": "user", "content": f"Question:\n{question}\n\nAnswer A:\n{a}\n\nAnswer B:\n{b}"},
        ],
    )
    return resp.choices[0].message.parsed
```

Run each pair **twice with A and B swapped** to cancel position bias, and count a win only if both runs agree. Hand-label 30–50 pairs to check the judge agrees with you.

## Don't skip

- **Read outputs.** Look at 20–50 side by side. Metrics miss weird failures.
- **Error analysis.** Group failures (wrong label, bad format, hallucination) to decide what data to add.
- **Edge cases.** Empty input, very long input, other languages, prompt injection attempts.
- **Regression.** Ask a few general questions; check it still follows other instructions and refuses what it should.

## Gotchas

- **Leakage** inflates scores. Dedupe eval against train.
- **Eval set too small** — 50 examples can't separate 90% from 93%. Aim for a few hundred where you can.
- **Sampling noise** — evaluate at `temperature=0`, or average several runs.
- **Judge bias** — LLM judges prefer longer answers and their own model family's style.
- **Template drift** — evaluate with the exact production prompt and chat template.

## Key terms

- **Held-out set** — examples never used in training, kept only for measurement.
- **Baseline** — the simplest reasonable approach you compare against.
- **Macro F1** — F1 averaged equally across classes, robust to imbalance.
- **ROUGE** — word-overlap metric for summaries against a reference.
- **LLM-as-judge** — using a strong model to grade or compare outputs.
- **Position bias** — a judge's tendency to favour the first (or second) answer shown.

## Interview quick-fire

- **"How do you know your fine-tune worked?"** → It beats a well-prompted base model on a held-out set with task metrics, without regressions, at acceptable cost and latency.
- **"Is low training loss enough?"** → No. It can mean memorisation. Watch eval loss and real task metrics.
- **"How do you evaluate open-ended outputs?"** → Pairwise LLM-as-judge with swapped order, validated against a sample of human labels.
- **"What's catastrophic forgetting and how do you catch it?"** → Losing general skills after narrow training; catch it with a small general benchmark and spot checks.
