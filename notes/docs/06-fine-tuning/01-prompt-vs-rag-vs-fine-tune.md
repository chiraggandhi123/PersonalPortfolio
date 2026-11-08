---
title: "Prompt vs RAG vs Fine-Tune (the decision)"
---

## TL;DR

There are three ways to make a model do what you want: **change the prompt**, **give it the right context at query time (RAG)**, or **change its weights (fine-tune)**. They solve different problems. **RAG adds knowledge, fine-tuning changes behaviour.** Start with prompting, add RAG when the model lacks facts, and fine-tune only when you need consistent style, format or skill that prompting can't reliably get. They combine well.

## What each one changes

```
                 ┌──────────────── what the model sees ────────────────┐
Prompting  ──►   system prompt + few-shot examples + user message
RAG        ──►   system prompt + RETRIEVED DOCUMENTS + user message
                 └─────────────────────────────────────────────────────┘

Fine-tuning ──►  the model itself (weights) learns from many examples
```

| | Prompting | RAG | Fine-tuning |
|---|---|---|---|
| Changes | Instructions | Context per query | Model weights |
| Good at | Task framing, format, tone | Fresh, private, citable facts | Style, format, narrow skills, shorter prompts |
| Bad at | Long-tail knowledge, very strict formats | Teaching new behaviour | Teaching facts that change |
| Data needed | None to a few examples | A document corpus | Hundreds to thousands of labelled examples |
| Time to iterate | Minutes | Hours to days | Days |
| Update knowledge | Edit prompt | Re-index docs | Re-train |
| Cost profile | Long prompts cost per call | Retrieval infra + longer prompts | Training cost, then cheaper calls |

## The decision flow

```
Does a good prompt (with a few examples) already work?
   ├─ yes → ship it. Done.
   └─ no → why not?
        ├─ model doesn't KNOW something (your docs, recent data)
        │      → RAG
        ├─ model knows enough but won't BEHAVE consistently
        │  (format, tone, labels, domain jargon, refusing too much)
        │      → fine-tune
        └─ prompt works but is HUGE / slow / expensive at scale
               → fine-tune a smaller model to absorb the instructions
```

## A common misconception

"Fine-tune on our docs so the model knows our product." This usually disappoints:

- The model **blends** facts it saw once with what it already believed. It still hallucinates, now in your house style.
- It **can't cite** where an answer came from.
- Every docs change means **retraining**.

RAG handles knowledge better: the facts sit in the prompt, can be cited, and update as soon as you re-index. Fine-tuning is for *how* the model answers, not *what* it knows.

## Combining them

The approaches stack:

| Combo | Example |
|---|---|
| Prompt + RAG | Support bot that answers from the help centre |
| Fine-tune + prompt | Classifier fine-tuned on labels, with a short instruction |
| Fine-tune + RAG | Model fine-tuned to answer *in your format and cite sources*, fed retrieved docs at query time |

The last one is common in production: RAG supplies the facts, fine-tuning teaches the model to use retrieved context well and answer in the right shape.

## Quick cost intuition

Prompting with a 3,000-token system prompt costs those tokens **on every call**. A fine-tuned model that has absorbed those instructions might need 200. At high volume the saving can pay for training. At low volume it never will. See [tokens and cost](../01-llm-basics/03-tokens-context-windows-cost.md).

## Gotchas

- **Fine-tuning first is the classic mistake.** You lose days and still need a good prompt and an eval set.
- **Build the eval set before choosing.** You can't compare approaches without one.
- **Try a stronger model first.** Sometimes "needs fine-tuning" really means "needs a better model".
- **Structured output problems** usually need [structured outputs](../02-calling-models/04-structured-outputs.md), not fine-tuning.

## Key terms

- **Prompt engineering** — shaping behaviour through instructions and examples in the input.
- **RAG (retrieval-augmented generation)** — fetching relevant documents and adding them to the prompt at query time.
- **Fine-tuning** — continuing training on your own examples so the model's weights change.
- **Parametric knowledge** — what a model "knows" from its weights.
- **Non-parametric knowledge** — information supplied at inference time, e.g. retrieved documents.

## Interview quick-fire

- **"RAG or fine-tuning for a chatbot over company docs?"** → RAG. Docs change, answers need citations, and fine-tuning doesn't reliably inject facts.
- **"When would you fine-tune instead?"** → When you need consistent behaviour (format, tone, labels) that prompting can't hold, or to replace a long prompt with a cheaper, smaller model.
- **"Can you use both?"** → Yes. Fine-tune for behaviour (e.g. grounded, cited answers in a fixed format) and use RAG for the facts.
- **"What do you do before any of this?"** → Write a strong prompt and an eval set. Only move on when the eval shows the prompt isn't enough.
