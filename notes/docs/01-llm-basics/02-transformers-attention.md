---
title: "Transformers & Attention (the intuition)"
---

## TL;DR

Almost every modern LLM is a **Transformer** (from the 2017 paper *"Attention Is All You Need"*). Its key idea is **attention**: when processing each token, the model looks at *every other token* in the context and decides how much each one matters.

You don't need the math to build AI apps — but the intuition explains context limits, cost, and why long prompts behave the way they do.

## The problem attention solves

Take: *"The animal didn't cross the street because **it** was too tired."*

What does **it** refer to? The animal. Change "tired" to "wide" and **it** now means the street. To understand a word you need to look at the *right* other words, which may be far away.

Older models (RNNs/LSTMs) read text left-to-right, squeezing everything into one running memory — long-range connections faded, and training couldn't be parallelized. Transformers let **every token look directly at every other token**, in parallel.

## Attention in one picture

For each token, the model builds three vectors:

| Vector | Intuition |
|---|---|
| **Query (Q)** | "What am I looking for?" |
| **Key (K)** | "What do I contain?" |
| **Value (V)** | "What information do I pass on if you pick me?" |

```
For token "it":
  compare its Query with every token's Key  →  relevance scores
  softmax the scores                        →  attention weights (sum to 1)
  weighted sum of every token's Value       →  new, context-aware "it"

  The    animal  didn't  cross  the   street  because  it   was  tired
  0.02   0.61    0.01    0.03   0.01  0.18    0.02     0.05 0.02 0.05
         ^^^^ "it" attends mostly to "animal"
```

The formula, for reference: `Attention(Q, K, V) = softmax(Q·Kᵀ / √d) · V`

## Multi-head attention

One attention pass captures one kind of relationship. Transformers run many in parallel (**heads**) — e.g. one head might track grammar (subject↔verb), another coreference (it↔animal), another nearby words. Their outputs are combined.

## The full block

A Transformer is a stack of identical **layers** (dozens to 100+). Each layer:

```
tokens → embeddings (+ position info)
   ↓
┌─────────────────────────────┐
│  Multi-head self-attention  │   ← tokens exchange information
│  + residual + layer norm    │
│  Feed-forward network (MLP) │   ← each token "thinks" on its own
│  + residual + layer norm    │
└─────────────────────────────┘   × N layers
   ↓
final vector for last token → probabilities over vocabulary → next token
```

- **Embeddings** turn token IDs into vectors (see [Embeddings](./04-embeddings.md)).
- **Positional encoding** tells the model token order — attention itself has no notion of order. Modern models use schemes like RoPE.
- **Feed-forward layers** hold much of the model's "knowledge"; attention routes information between tokens.

## Decoder-only, causal attention

GPT, Claude, Gemini, Llama are **decoder-only** Transformers. They use **causal (masked) attention**: a token can only attend to tokens *before* it, never after. That's what makes next-token prediction a fair training task.

| Architecture | Examples | Used for |
|---|---|---|
| Encoder-only | BERT | Classification, embeddings |
| Encoder-decoder | T5, original Transformer | Translation, summarization |
| **Decoder-only** | GPT, Claude, Llama | **Text generation — today's LLMs** |

## Why this matters for you as a builder

**1. Cost grows with context length.**
Every token attends to every previous token, so naive attention is **O(n²)** in sequence length. Doubling a prompt more than doubles the compute. This is why context windows have limits and long prompts are slower.

**2. KV cache → why output is slower than input.**
During generation, the Keys/Values of previous tokens are cached so they aren't recomputed. Input tokens are processed in one parallel pass; output tokens come one at a time. This is also the basis of **prompt caching**, which providers discount heavily — reuse the same prefix and it's cheaper and faster.

**3. "Lost in the middle."**
Attention isn't perfectly uniform; models are often better at using information at the **start and end** of long contexts. Put key instructions at the top, and the question near the end.

**4. Parallel training is why LLMs got big.**
Transformers process all tokens of a training example at once, which maps well to GPUs. That's what made scaling to trillions of tokens practical.

## Key terms

- **Self-attention** — tokens in a sequence attending to each other.
- **Head** — one independent attention computation; models have many per layer.
- **Layer** — one attention + feed-forward block; stacked many times.
- **Causal mask** — blocks attention to future tokens.
- **KV cache** — stored keys/values to speed up generation.

## Interview quick-fire

- **"Explain attention simply."** → Each token scores every other token for relevance (query vs. key), then takes a weighted mix of their information (values).
- **"Why did Transformers replace RNNs?"** → Direct long-range connections and fully parallel training.
- **"Why are long contexts expensive?"** → Attention compares every token pair — quadratic in length — and the KV cache grows with context.
