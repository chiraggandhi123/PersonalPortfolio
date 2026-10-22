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
The model reuses the keys and values it already computed for earlier tokens (the **KV cache**). The prompt is processed in one parallel pass, but output comes out one token at a time. Prompt caching builds on the same idea. See [The KV cache, in depth](#the-kv-cache-in-depth) below.

**3. "Lost in the middle."**
Attention isn't perfectly uniform; models are often better at using information at the **start and end** of long contexts. Put key instructions at the top, and the question near the end.

**4. Parallel training is why LLMs got big.**
Transformers process all tokens of a training example at once, which maps well to GPUs. That's what made scaling to trillions of tokens practical.

## The KV cache, in depth

### Two phases of every request

Every LLM call runs in two very different phases:

| | **Prefill** (reading your prompt) | **Decode** (writing the answer) |
|---|---|---|
| What happens | All prompt tokens go through the model **at once, in parallel** | **One token per step**: each new token needs a full pass through the model |
| Bottleneck | Raw compute (GPU math), so GPUs are used well | **Memory bandwidth**: reading the weights and cache for each single token |
| You feel it as | **Time to first token (TTFT)** | **Tokens per second** while streaming |
| Scales with | Prompt length | Output length |

A 10,000-token prompt might prefill in under a second. Generating 1,000 tokens means 1,000 sequential steps. That's why **output tokens are slower and cost several times more** than input tokens.

### The problem the cache solves

To generate token #101, the new token's **query** must be compared with the **keys** of tokens 1–100, and then their **values** are mixed together. Without a cache, every step would recompute K and V for the entire sequence:

```
WITHOUT cache
step 1: compute K,V for tokens 1..100   → emit token 101
step 2: compute K,V for tokens 1..101   → emit token 102   ← 100 of these were already computed!
step 3: compute K,V for tokens 1..102   → emit token 103
...     total work grows quadratically

WITH cache
prefill: compute K,V for tokens 1..100, store them        [K1..K100] [V1..V100]
step 1: compute Q,K,V for token 101 only, append to cache [K1..K101] [V1..V101]
        Q101 attends over all cached keys → emit token 102
step 2: compute Q,K,V for token 102 only, append ...
...     each step only does work for ONE new token
```

**Why cache K and V but not Q?** A token's key and value stay the same once computed, because causal attention means later tokens never change earlier ones. Queries are only needed by the token currently being generated. Past queries are never used again.

The cache exists **per layer and per attention head**, since every layer has its own K and V.

### The cache is big, and it's why long context costs money

```
KV cache size = 2 (K and V) × layers × KV heads × head_dim × tokens × bytes per number
```

A worked example, with numbers roughly like an 8B open model in 16-bit precision:

```
2 × 32 layers × 8 KV heads × 128 dims × 2 bytes = 131,072 bytes ≈ 128 KB per token

  4,000-token chat   ≈ 0.5 GB
128,000-token prompt ≈ 16 GB   ← for ONE conversation, on top of the model weights
```

GPU memory is limited, so a bigger KV cache means **fewer users can be served on the same GPU at once**. That's the real reason long contexts are slow and expensive to serve, and why providers sometimes charge more above a context threshold.

Tricks used to shrink it:

| Technique | Idea |
|---|---|
| **GQA / MQA** (grouped / multi-query attention) | Many query heads share fewer K/V heads, so the cache is several times smaller. Used by most modern models |
| **KV cache quantization** | Store K/V in 8-bit or 4-bit instead of 16-bit |
| **PagedAttention** (vLLM) | Manage cache memory in pages, like an OS, so little memory is wasted. Big throughput win |
| **Sliding-window attention** | Only keep the last N tokens' K/V for some layers |

### Prompt caching: the KV cache across requests

Normally the KV cache is thrown away when a request finishes. **Prompt caching** keeps it on the provider's side. If your next request starts with the **exact same prefix**, the model skips the prefill for that part.

```
Request 1:  [system prompt + 50-page doc]  [question A]
             └──── prefill, then CACHE ────┘

Request 2:  [system prompt + 50-page doc]  [question B]
             └─── cache hit: skip prefill ─┘ └ only this part is processed
```

What you get: **much cheaper input** on cache reads (often around 10% of the normal input price) and a **faster time to first token**.

How it works at the main providers (check current docs for exact prices and limits):

- **Anthropic** — you mark cache points with `cache_control`. Writing to the cache costs a bit more than normal input, and reading from it is much cheaper. The cache expires after a few minutes without use (a longer TTL is available).
- **OpenAI** — caching is automatic for long prompts. Nothing to configure; you just see cached tokens in the usage stats.
- **Gemini** — offers both implicit (automatic) caching and explicit cache objects.

```python
import anthropic
client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=1024,
    system=[
        {"type": "text", "text": "You answer questions about the attached handbook."},
        {
            "type": "text",
            "text": HANDBOOK_TEXT,                     # big, unchanging content
            "cache_control": {"type": "ephemeral"},    # cache everything up to here
        },
    ],
    messages=[{"role": "user", "content": "What is the leave policy?"}],
)

u = response.usage
print(u.cache_creation_input_tokens)  # 1st call: tokens written to cache
print(u.cache_read_input_tokens)      # later calls: tokens served from cache
print(u.input_tokens)                 # uncached input tokens
```

### Rules for getting cache hits

1. **Static first, dynamic last.** Order your prompt: tools → system prompt → documents → chat history → the new user message.
2. **Prefix means exact.** Changing one character invalidates the cache for everything after it. A timestamp or user name at the top of the system prompt breaks caching on every call.
3. **Keep serialization stable.** Tool definitions and JSON should be in the same order with the same formatting every time.
4. **Chatbots benefit automatically.** Each turn resends the previous turns unchanged, so the history is a growing cached prefix.
5. **Check it's working.** Log the cached-token fields from `usage`. If they're always 0, something in your prefix is changing.

## Key terms

- **Self-attention** — tokens in a sequence attending to each other.
- **Head** — one independent attention computation; models have many per layer.
- **Layer** — one attention + feed-forward block; stacked many times.
- **Causal mask** — blocks attention to future tokens.
- **KV cache** — stored keys/values to speed up generation.
- **Prefill / decode** — the parallel prompt-processing phase / the one-token-at-a-time generation phase.
- **TTFT** — time to first token; mostly determined by prefill.
- **Prompt caching** — provider keeps the KV cache of a repeated prompt prefix between requests.
- **GQA** — grouped-query attention; shares K/V heads to shrink the KV cache.

## Interview quick-fire

- **"Explain attention simply."** → Each token scores every other token for relevance (query vs. key), then takes a weighted mix of their information (values).
- **"Why did Transformers replace RNNs?"** → Direct long-range connections and fully parallel training.
- **"Why are long contexts expensive?"** → Attention compares every token pair — quadratic in length — and the KV cache grows with context.
- **"What is the KV cache?"** → Stored keys and values of already-processed tokens, so each new token only computes its own Q/K/V instead of recomputing the whole sequence.
- **"Why is decoding slower than prefill?"** → Prefill processes all prompt tokens in parallel (compute-bound); decode is sequential and memory-bandwidth-bound, one forward pass per token.
- **"How does prompt caching work and how do you maximize hits?"** → The provider reuses the KV cache for an identical prompt prefix; put static content first, dynamic content last, and keep the prefix byte-for-byte stable.
