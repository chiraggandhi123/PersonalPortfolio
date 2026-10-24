---
title: "Structured Outputs (JSON mode & schemas)"
---

## TL;DR

When code (not a human) consumes the model's answer, you want **JSON that matches a schema**, not prose. There are three levels: **asking nicely** in the prompt (unreliable), **JSON mode** (always valid JSON, but any shape), and **structured outputs with a schema** (valid JSON that matches your exact fields). Use schemas, define them with **Pydantic**, and still handle refusals and edge cases.

## The three levels

| Level | How | Guarantees |
|---|---|---|
| Prompt only | "Reply in JSON with keys name, age" | Nothing. Expect stray prose, markdown fences, missing keys |
| JSON mode | `response_format={"type": "json_object"}` | Parses as JSON. Keys and types can still be wrong |
| Structured outputs | `response_format=<schema>` with `strict` | Matches your schema: required keys, types, enums |

## Structured outputs with Pydantic (recommended)

```python
from pydantic import BaseModel
from openai import OpenAI

client = OpenAI()

class Invoice(BaseModel):
    vendor: str
    invoice_number: str
    total: float
    currency: str
    line_items: list[str]

completion = client.chat.completions.parse(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "Extract the invoice details."},
        {"role": "user", "content": invoice_text},
    ],
    response_format=Invoice,
)

message = completion.choices[0].message
if message.refusal:
    print("Model refused:", message.refusal)
else:
    invoice: Invoice = message.parsed       # a real Pydantic object
    print(invoice.total, invoice.currency)
```

`parse()` turns your Pydantic class into a JSON schema, sends it with strict mode on, and parses the reply back into the class.

### Designing the schema

```python
from typing import Literal
from pydantic import BaseModel, Field

class Ticket(BaseModel):
    category: Literal["billing", "bug", "feature_request", "other"]    # enum
    priority: int = Field(description="1 = urgent, 3 = low")
    summary: str = Field(description="One sentence, under 20 words")
    customer_email: str | None                                         # allow "not found"
```

- **Enums (`Literal`)** stop the model inventing categories.
- **`description`** fields are read by the model, so they work as mini-instructions.
- **Make missing data explicit** with `| None`, otherwise the model will invent a value to fill a required field.
- **Put reasoning fields first** if you want them: the model writes keys in order, so a `reasoning` field before `answer` acts like chain-of-thought.

## JSON mode (when you can't use a schema)

```python
resp = client.chat.completions.create(
    model="gpt-4o-mini",
    response_format={"type": "json_object"},
    messages=[
        {"role": "system", "content": 'Return JSON: {"sentiment": "positive|negative|neutral", "score": 0-1}'},
        {"role": "user", "content": review},
    ],
)
data = json.loads(resp.choices[0].message.content)
```

The word "JSON" must appear somewhere in the messages, or the API rejects the request. Validate the result yourself (`Ticket.model_validate(data)`).

## Other providers

- **Anthropic** — define a tool with your schema and force it with `tool_choice`, or use its structured-output support; the SDK has a `messages.parse` helper.
- **Gemini** — `config={"response_mime_type": "application/json", "response_schema": MyModel}`.
- **Local models** — Ollama accepts a JSON schema in `format=`; libraries like **Instructor** add Pydantic parsing and retries on top of any provider.

## Still validate

Even with schemas:

- **Refusals** — safety refusals come back in `message.refusal`, not in `parsed`.
- **Truncation** — if `finish_reason == "length"`, the JSON is cut off. Raise the token limit.
- **Valid ≠ correct** — the schema guarantees shape, not truth. An extracted `total` can still be wrong. Spot-check, and cross-validate where you can (e.g. line items sum to total).

## Key terms

- **JSON mode** — the API guarantees syntactically valid JSON, with no schema.
- **Structured outputs** — the API constrains generation to a supplied JSON schema.
- **Pydantic** — Python library for defining data models and validating data against them.
- **Strict mode** — schema enforcement where all fields are required and no extra keys are allowed.
- **Refusal** — the model declining to answer, reported separately from parsed output.

## Interview quick-fire

- **"How do you get reliable JSON from an LLM?"** → Use structured outputs with a schema (e.g. Pydantic via `parse`), handle refusals and truncation, and validate the values.
- **"JSON mode vs. structured outputs?"** → JSON mode guarantees valid JSON only; structured outputs guarantee it matches your schema's keys, types and enums.
- **"How do you stop the model hallucinating a field that isn't in the source?"** → Make it nullable and say "null if not present", so leaving it empty is a valid answer.
