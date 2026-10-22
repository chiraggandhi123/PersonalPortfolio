---
title: "Sampling: Temperature & Top-p"
---

## TL;DR

At each step the model gives a probability for every possible next token. **Sampling** decides which one to actually pick.

- **Temperature** — how much randomness. Low = focused and predictable, high = varied and creative.
- **Top-p** — only sample from the smallest set of tokens whose probabilities add up to *p*.
- **Top-k** — only sample from the *k* most likely tokens.

Usually: **tune temperature, leave the rest at defaults.**

## Starting point: the distribution

```
Prompt: "My favorite fruit is"

 " mango"    0.40
 " apple"    0.25
 " banana"   0.15
 " the"      0.08
 " kiwi"     0.07
 " durian"   0.04
 " purple"   0.01
```

- **Greedy decoding** — always pick the top token (" mango"). Deterministic, but tends to be repetitive and bland in long text.
- **Sampling** — pick randomly *according to the probabilities*. " mango" 40% of the time, " durian" 4%.

## Temperature

Temperature reshapes the distribution before sampling. Technically, the model's raw scores (logits) are divided by `T` before softmax.

```
            T = 0.2 (sharp)    T = 1.0 (original)    T = 1.8 (flat)
 mango        0.93               0.40                  0.26
 apple        0.06               0.25                  0.20
 banana       0.01               0.15                  0.16
 the          ~0                 0.08                  0.12
 kiwi         ~0                 0.07                  0.11
 durian       ~0                 0.04                  0.09
 purple       ~0                 0.01                  0.05
```

- **T → 0**: almost always the top token. Near-deterministic.
- **T = 1**: the model's natural distribution.
- **T > 1**: flatter — unlikely tokens get picked more. Creative, then chaotic, then gibberish.

| Temperature | Good for |
|---|---|
| **0 – 0.3** | Extraction, classification, structured output (JSON), code, factual Q&A |
| **0.5 – 0.8** | General chat, explanations, summaries |
| **0.8 – 1.2** | Brainstorming, creative writing, generating varied options |

Ranges differ by provider: OpenAI allows `0–2`, Anthropic `0–1`. Defaults are usually `1`.

:::caution Temperature 0 is not perfectly deterministic
Even at `temperature=0`, you can get slightly different outputs across calls due to GPU floating-point effects and batching on the provider side. Don't rely on it for exact reproducibility — and some reasoning models ignore or fix temperature entirely.
:::

## Top-p (nucleus sampling)

Sort tokens by probability, keep adding them until the total reaches `p`, then sample only from that set (renormalized).

```
top_p = 0.8
 mango   0.40   cumulative 0.40  ✓
 apple   0.25   cumulative 0.65  ✓
 banana  0.15   cumulative 0.80  ✓  ← stop here
 the, kiwi, durian, purple       ✗  cut off
```

The nice property: it **adapts**. When the model is confident, the "nucleus" is just one or two tokens; when it's unsure, more options are allowed. It chops off the long tail of weird tokens.

## Top-k

Keep only the `k` most likely tokens. `top_k = 3` → mango, apple, banana. Simpler but doesn't adapt to confidence. Not all APIs expose it (OpenAI doesn't; Anthropic and Gemini do).

## How they combine

Typical pipeline: `logits → ÷ temperature → top-k filter → top-p filter → sample`.

**Best practice:** change **one** of temperature or top-p, not both. Many providers (including Anthropic) recommend adjusting only one, and some newer models reject setting both.

## Other generation parameters you'll see

| Parameter | What it does |
|---|---|
| `max_tokens` | Hard cap on output length |
| `stop` / `stop_sequences` | Stop generating when this string appears |
| `seed` | Best-effort reproducibility (OpenAI) |
| `frequency_penalty` / `presence_penalty` | Discourage repeating tokens / topics (OpenAI-style APIs) |
| `n` | Generate several completions in one call |

## In code

```python
import anthropic
client = anthropic.Anthropic()

def ask(prompt, temperature):
    resp = client.messages.create(
        model="claude-haiku-5-5",
        max_tokens=50,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text

for t in [0.0, 0.5, 1.0]:
    print(t, [ask("Give me one name for a coffee shop. Name only.", t) for _ in range(3)])
# t=0.0 → same name 3×; t=1.0 → three different names
```

## Practical rules

- **Need correctness or consistency?** Low temperature.
- **Need variety?** Higher temperature — or better, ask for *"10 different options"* in one call at moderate temperature.
- **Output going into code (JSON, SQL)?** Low temperature *plus* structured outputs / validation.
- **Weird or rambling output?** Lower the temperature before rewriting the prompt.
- Sampling doesn't make a model smarter. If low-temperature answers are wrong, the fix is the prompt, context, or model — not the dial.

## Interview quick-fire

- **"What does temperature do?"** → Scales logits before softmax; lower sharpens the distribution (more deterministic), higher flattens it (more random).
- **"Top-p vs. top-k?"** → Top-k keeps a fixed number of tokens; top-p keeps however many are needed to cover probability mass *p*, so it adapts to model confidence.
- **"What temperature for a JSON extraction pipeline?"** → 0 or close to it, plus schema validation.
