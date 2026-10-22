---
title: "Tokens, Context Windows & Cost"
---

## TL;DR

- **Tokens** are the unit of everything: input, output, limits, billing.
- The **context window** is the max number of tokens (input + output) the model can handle in one request.
- **Cost = input tokens × input price + output tokens × output price.** Output tokens are usually several times more expensive than input.

## Tokenization

Models use **subword tokenization** (BPE, SentencePiece, etc.): common words become one token, rare words get split into pieces.

```
"hello"            → ["hello"]                     1 token
"tokenization"     → ["token", "ization"]          2 tokens
"Pneumonoultra..." → ["P", "ne", "um", "ono", ...] many tokens
"   "              → whitespace is tokens too
```

Things that use **more tokens than you'd expect**:

- **Non-English languages** — Hindi, Japanese, etc. can take 2–4× the tokens of equivalent English.
- **Code** — indentation, symbols, long identifiers.
- **Numbers** — `3.14159265` may be several tokens (also why LLMs are shaky at arithmetic).
- **JSON** — braces, quotes, and repeated keys add up.
- **Images/PDFs** — multimodal inputs are converted to tokens too, often hundreds to thousands each.

Each model family has its **own tokenizer**, so the same text produces different counts on GPT vs. Claude vs. Llama.

### Counting tokens

```python
# OpenAI models — local tokenizer
import tiktoken
enc = tiktoken.get_encoding("o200k_base")
print(len(enc.encode("How many tokens is this sentence?")))

# Anthropic — ask the API
import anthropic
client = anthropic.Anthropic()
count = client.messages.count_tokens(
    model="claude-sonnet-5-5",
    messages=[{"role": "user", "content": "How many tokens is this sentence?"}],
)
print(count.input_tokens)
```

Every API response also returns usage — always log it:

```python
response.usage.input_tokens, response.usage.output_tokens
```

## The context window

The context window is the model's **working memory for one request**. Everything has to fit:

```
┌──────────────────── context window (e.g. 200k tokens) ────────────────────┐
│ system prompt │ tool definitions │ chat history │ retrieved docs │ user msg │ ← output │
└───────────────────────────────────────────────────────────────────────────┘
```

Key facts:

- The model knows **nothing** outside this window. No memory between requests unless you resend it.
- **Max output tokens** is a separate, smaller limit (`max_tokens` param). Hitting it cuts the answer off mid-sentence — check the stop reason.
- Modern windows range from ~128k to 1M+ tokens. 200k tokens ≈ a 500-page book.
- **Bigger isn't free**: more tokens = more cost, more latency, and quality can degrade ("lost in the middle"). Send what's relevant, not everything.

### What to do when it doesn't fit

| Strategy | Idea |
|---|---|
| **Truncate** | Drop oldest chat messages (keep the system prompt!) |
| **Summarize** | Replace old history with a running summary |
| **Retrieve (RAG)** | Store docs externally; insert only the relevant chunks |
| **Chunk + map-reduce** | Process a long doc in pieces, then combine results |

## Cost

APIs price per **million tokens (MTok)**, with separate input and output rates.

```
cost = (input_tokens / 1_000_000) × input_price
     + (output_tokens / 1_000_000) × output_price
```

**Worked example** (illustrative prices — always check the provider's pricing page):

```
Model price:   $3 / MTok input,  $15 / MTok output
One request:   2,000 input tokens, 500 output tokens

input  = 2,000 / 1M × $3  = $0.006
output =   500 / 1M × $15 = $0.0075
total  ≈ $0.0135 per request

× 10,000 requests/day ≈ $135/day
```

### Cost levers

1. **Pick the smallest model that works.** Small/fast tiers are often 5–20× cheaper than flagships.
2. **Trim the prompt.** Long system prompts and full chat histories are paid for on *every* call.
3. **Cap output** with `max_tokens` and instructions like "answer in 3 bullets".
4. **Prompt caching.** Reused prefixes (system prompt, docs) are billed at a fraction of the normal input rate.
5. **Batch APIs.** Non-urgent jobs often run at ~50% discount.
6. **Watch hidden tokens** — tool definitions, images, and reasoning/"thinking" tokens all count.

:::tip Chat history grows quadratically in cost
In a chatbot, turn 10 resends turns 1–9. Total tokens over a conversation grow roughly with the *square* of its length. Truncate or summarize long conversations.
:::

## Key terms

- **Tokenizer** — converts text ↔ token IDs; model-specific.
- **Context window** — max total tokens per request.
- **max_tokens** — cap on output tokens for a response.
- **MTok** — million tokens, the pricing unit.
- **Prompt caching** — discounted reuse of an identical prompt prefix.

## Interview quick-fire

- **"Why are output tokens pricier than input?"** → Input is processed in one parallel pass; output is generated sequentially, one forward pass per token.
- **"How do you handle a document bigger than the context window?"** → Chunk it and use RAG or map-reduce summarization.
- **"How would you reduce LLM costs in production?"** → Smaller model / routing, shorter prompts, caching, batching, output limits, and monitoring token usage per feature.
