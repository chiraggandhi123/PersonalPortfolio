---
title: "What Is an LLM (tokens & next-token prediction)"
---

## TL;DR

A **Large Language Model (LLM)** is a neural network trained to do one thing: **given some text, predict the next token**. Everything else — answering questions, writing code, calling tools — is built on repeating that one step over and over.

```
"The capital of France is"  →  model  →  " Paris"   (most likely next token)
```

## The core loop: autoregressive generation

An LLM doesn't write a whole answer at once. It generates **one token at a time**, appends it to the input, and runs again.

```
input:  "The sky is"
step 1: "The sky is"            → " blue"
step 2: "The sky is blue"       → " today"
step 3: "The sky is blue today" → "."
step 4: ...                     → <end of sequence>
```

This is called **autoregressive** generation — each output becomes part of the next input. Consequences you'll feel in practice:

- **Latency grows with output length** — 1,000 output tokens = ~1,000 forward passes.
- **Streaming is natural** — you can show each token as soon as it's produced.
- **The model can't "go back"** — once a token is emitted, it's committed. (This is one reason "think step by step" helps: it lets the model write out reasoning *before* committing to an answer.)

## What is a token?

A **token** is a chunk of text — usually a word, part of a word, or punctuation. Models don't see characters or words; they see integer token IDs.

```
"Unbelievable results!"  →  ["Un", "believ", "able", " results", "!"]
                         →  [1844, 31141, 481, 3135, 0]
```

Rules of thumb (English):

| Approx. | Equals |
|---|---|
| 1 token | ~4 characters |
| 1 token | ~0.75 words |
| 100 tokens | ~75 words |

Tokens matter because **context limits and pricing are measured in tokens**, not words. More in [Tokens, Context Windows & Cost](./03-tokens-context-windows-cost.md).

## What the model actually outputs

At each step the model outputs a **probability distribution over its whole vocabulary** (often 50k–200k tokens):

```
"The capital of France is" →
   " Paris"   0.92
   " the"     0.03
   " a"       0.01
   " located" 0.01
   ...
```

A **sampling** strategy then picks one token from this distribution. Always picking the top one = deterministic but bland; sampling with some randomness = more varied. See [Sampling: Temperature & Top-p](./06-sampling-temperature-top-p.md).

## How LLMs are trained (the 3 stages)

| Stage | What happens | Result |
|---|---|---|
| **1. Pre-training** | Predict the next token on trillions of tokens of internet text, books, code | A **base model** — great at continuing text, not at following instructions |
| **2. Supervised fine-tuning (SFT)** | Train on curated (instruction → good response) examples | An **instruct/chat model** that answers instead of just continuing |
| **3. Preference tuning (RLHF / RLAIF / DPO)** | Humans or AI rank responses; model is tuned toward preferred ones | More helpful, honest, and safe behavior |

Modern "reasoning" models add a further stage: reinforcement learning on tasks with checkable answers (math, code), which teaches them to produce long internal chains of thought before answering.

:::tip Base vs. chat model
Ask a **base** model "What is the capital of France?" and it might continue with "What is the capital of Germany? What is the capital of..." — because that's what lists of quiz questions look like on the internet. A **chat** model answers "Paris." Almost every API you'll use serves chat models.
:::

## Why "large"?

"Large" refers to **parameters** — the learned weights of the network. Modern models have billions to trillions of them. More parameters + more data + more compute has (so far) reliably meant better models — the **scaling laws**.

The weights are, loosely, a compressed statistical model of the training data. The model has never "looked up" a fact; it has learned patterns so well that producing the right fact is the most likely continuation.

## Mental model to keep

> An LLM is a **very good autocomplete** trained on a huge chunk of human writing, then tuned to behave like a helpful assistant.

That framing explains a lot:

- It's **fluent** — it learned what good text looks like.
- It **hallucinates** — plausible-sounding is what it optimizes for, not true. See [Hallucinations & Limitations](./07-hallucinations-limitations.md).
- It's **stateless** — it only knows what's in the current input (the context). "Memory" in a chatbot is you resending the history. See [Your First Chatbot](./08-your-first-chatbot.md).
- **Prompting works** — you're shaping the text it's continuing.

## Key terms

- **Token** — the unit of text the model reads and writes.
- **Vocabulary** — the fixed set of all tokens the model knows.
- **Context / context window** — the input the model sees at once (prompt + history + its own output so far).
- **Inference** — running the model to generate output (vs. training).
- **Parameters / weights** — the learned numbers inside the model.
- **Base model vs. instruct/chat model** — raw next-token predictor vs. assistant-tuned.

## Interview quick-fire

- **"How does ChatGPT/Claude generate text?"** → Autoregressively: predicts a probability distribution over next tokens, samples one, appends it, repeats until a stop token.
- **"Why do LLMs hallucinate?"** → They're trained to produce likely text, not verified truth, and have no built-in lookup.
- **"What's the difference between pre-training and fine-tuning?"** → Pre-training learns general language from huge unlabeled data via next-token prediction; fine-tuning adapts behavior with smaller curated/labeled data.
