---
title: "Zero-Shot, Few-Shot & Chain-of-Thought"
---

## TL;DR

**Zero-shot** means just asking. **Few-shot** means showing a handful of input→output examples so the model copies the pattern. **Chain-of-thought (CoT)** means letting the model reason step by step before answering. Start zero-shot, add examples when the *format or style* is off, and add reasoning when the *logic* is off. Reasoning models already think internally, so explicit CoT matters less for them.

## The three techniques

| Technique | What you add | Fixes | Cost |
|---|---|---|---|
| Zero-shot | Nothing, just the instruction | — | Cheapest |
| Few-shot | 2–5 worked examples | Format, tone, label choice, edge cases | More input tokens |
| Chain-of-thought | "Think step by step" or a reasoning field | Multi-step logic, maths, planning | More output tokens, slower |

## Zero-shot

```python
from openai import OpenAI

client = OpenAI()

resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "Classify the review as positive, negative or mixed. Reply with one word."},
        {"role": "user", "content": "Battery is great but the screen scratches easily."},
    ],
)
print(resp.choices[0].message.content)   # mixed
```

Modern models handle most common tasks zero-shot. Try it first.

## Few-shot

Put examples in as fake past turns. The model treats them as precedent.

```python
EXAMPLES = [
    ("Refund still not here after 3 weeks!!", "billing | urgent"),
    ("Would be nice to have dark mode.", "feature_request | low"),
    ("App crashes when I upload a PDF.", "bug | high"),
]

messages = [{"role": "system", "content": "Tag support tickets as `category | priority`."}]
for text, label in EXAMPLES:
    messages += [
        {"role": "user", "content": text},
        {"role": "assistant", "content": label},
    ]
messages.append({"role": "user", "content": "I was charged twice this month."})

resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages)
print(resp.choices[0].message.content)   # billing | urgent
```

Tips for examples:

- **Diverse.** Cover different categories and at least one tricky case. Five near-identical examples teach the wrong lesson.
- **Balanced.** If 4 of 5 examples are "positive", the model leans positive.
- **Representative.** Use real inputs, with their real length and messiness.
- **Consistent format.** Every example output should look exactly like what you want back.
- **Watch the order.** The last example has the most pull. Shuffle and test.

## Chain-of-thought

Ask the model to reason before it commits to an answer. Answers come out token by token, so reasoning written *first* can inform the answer; reasoning written *after* is just justification.

```
Without CoT:  Q ─► answer                 (one jump, easy to get wrong)
With CoT:     Q ─► step 1 ─► step 2 ─► step 3 ─► answer
```

Keep the reasoning out of what users see by putting it in a separate field:

```python
from pydantic import BaseModel

class Answer(BaseModel):
    reasoning: str        # written first, so the answer can use it
    final_answer: str

completion = client.chat.completions.parse(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "Solve the problem. Think step by step in `reasoning`, then give only the result in `final_answer`."},
        {"role": "user", "content": "A shirt costs 800 after a 20% discount. What was the original price?"},
    ],
    response_format=Answer,
)
ans = completion.choices[0].message.parsed
print(ans.final_answer)   # 1000
```

See [structured outputs](../02-calling-models/04-structured-outputs.md) for why field order matters.

### Variants worth knowing

| Variant | Idea |
|---|---|
| Zero-shot CoT | Just add "Let's think step by step." |
| Few-shot CoT | Examples that include the worked reasoning, not only the answer |
| Self-consistency | Sample several CoT answers (temperature > 0) and take the majority vote |
| Plan-then-execute | First ask for a plan, then run each step in its own call |

## Reasoning models

Models built to reason (OpenAI's o-series, Claude with extended thinking, Gemini thinking models, DeepSeek-R1) produce hidden reasoning before answering. With these:

- Skip "think step by step"; it's redundant and can hurt.
- Give the goal and constraints clearly, then let the model plan.
- Few-shot still helps for **format**, but heavy examples can over-constrain reasoning.
- They cost more and are slower. Use them where the logic is hard, not for simple classification.

## Gotchas

- **CoT can be wrong but convincing.** The reasoning reads well even when a step is false. Check final answers, not just the logic.
- **CoT on simple tasks** wastes tokens and can make answers worse ("overthinking").
- **Examples leak.** The model may copy specific names or numbers from examples into real answers. Use clearly fake data.
- **Few-shot vs. fine-tuning.** If you need 50+ examples to get it right, consider fine-tuning or retrieval of examples instead.

## Key terms

- **Zero-shot** — task instruction with no examples.
- **Few-shot / in-context learning** — examples in the prompt that the model generalises from, without weight updates.
- **Chain-of-thought** — intermediate reasoning written before the final answer.
- **Self-consistency** — majority vote over several sampled reasoning paths.
- **Reasoning model** — a model trained to produce internal reasoning tokens before answering.

## Interview quick-fire

- **"When do you use few-shot over zero-shot?"** → When the format, style or label boundaries are off. Examples show what instructions struggle to describe.
- **"Why does chain-of-thought help?"** → The model generates left to right, so writing intermediate steps gives it more computation and context before committing to the answer.
- **"How do you use CoT without showing it to users?"** → Put a `reasoning` field before `answer` in a structured output and only display the answer.
- **"Should you prompt reasoning models with 'think step by step'?"** → No. They already reason internally; give clear goals and constraints instead.
