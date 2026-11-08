---
title: "Parsing & Validating Output (Pydantic)"
---

## TL;DR

Getting JSON back is half the job; the other half is **checking it's actually usable**. Use **Pydantic models** as the contract between the LLM and your code: types, enums, ranges and custom **validators** catch bad values. When validation fails, **feed the error back to the model and retry** a couple of times, then fail loudly. Schema-constrained generation is covered in [structured outputs](../02-calling-models/04-structured-outputs.md); this note covers what to do around it.

## Where things go wrong

```
LLM text ─► extract JSON ─► parse ─► validate types ─► validate business rules ─► use it
              │               │            │                     │
         prose / fences   bad syntax   wrong type/enum     "end_date before start_date"
```

Structured outputs remove the first three failure points on supported models. Business rules are always your job.

## Pydantic as the contract

```python
from datetime import date
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator

class Expense(BaseModel):
    merchant: str = Field(min_length=1)
    amount: float = Field(gt=0, description="Total in the receipt currency")
    currency: Literal["INR", "USD", "EUR"]
    category: Literal["travel", "food", "office", "other"]
    spent_on: date
    tags: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("merchant")
    @classmethod
    def clean_merchant(cls, v: str) -> str:
        return v.strip().title()

    @model_validator(mode="after")
    def not_in_future(self):
        if self.spent_on > date.today():
            raise ValueError("spent_on cannot be in the future")
        return self
```

| Feature | Catches |
|---|---|
| Type hints (`float`, `date`) | `"amount": "about 500"` |
| `Literal` | Invented categories |
| `Field(gt=0, max_length=5)` | Negative totals, runaway lists |
| `field_validator` | Normalising or rejecting one field |
| `model_validator` | Rules across fields |

## Validate-and-retry loop

Works with any model, including ones without schema support. The error message tells the model exactly what to fix.

```python
import json
from openai import OpenAI
from pydantic import ValidationError

client = OpenAI()

def extract_expense(receipt: str, max_retries: int = 2) -> Expense:
    messages = [
        {"role": "system", "content": "Extract the expense as JSON matching this schema:\n"
                                      + json.dumps(Expense.model_json_schema())},
        {"role": "user", "content": receipt},
    ]
    for attempt in range(max_retries + 1):
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=messages,
        )
        raw = resp.choices[0].message.content
        try:
            return Expense.model_validate_json(raw)
        except ValidationError as e:
            messages += [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": f"That failed validation:\n{e}\nReturn corrected JSON only."},
            ]
    raise ValueError(f"Could not get a valid Expense after {max_retries + 1} attempts")
```

Keep retries low (1–2). If the model fails twice, the prompt or schema usually needs fixing, not more attempts.

## Libraries that do this for you

**Instructor** wraps the client, adds `response_model=` and handles retries:

```python
import instructor
from openai import OpenAI

client = instructor.from_openai(OpenAI())
expense = client.chat.completions.create(
    model="gpt-4o-mini",
    response_model=Expense,
    max_retries=2,
    messages=[{"role": "user", "content": receipt_text}],
)
```

**LangChain** has `with_structured_output`:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini").with_structured_output(Expense)
expense = llm.invoke(receipt_text)       # returns an Expense instance
```

**Pydantic AI** builds agents around typed outputs (used in the [clothing store project](./projects/04-gen-ai-clothing-store.md)).

## Parsing free text when you must

Sometimes you get prose with JSON inside (older models, some local models):

```python
import re

def extract_json_block(text: str) -> str:
    match = re.search(r"\{.*\}", text, re.DOTALL)     # first { to last }
    if not match:
        raise ValueError("No JSON found")
    return match.group(0)
```

It's a fallback, not a strategy. Prefer schema support or a library.

## Best practices

- **Validate values, not just shape.** Ranges, dates, IDs that must exist in your database.
- **Make "unknown" a valid answer** with `| None` so the model doesn't invent values to pass validation.
- **Keep schemas small and flat.** Deeply nested optional structures confuse models and validators.
- **Log failures** with the raw output. Patterns in failures tell you what to change in the prompt.
- **Decide the fallback**: default value, ask the user, route to a human, or error out.

## Gotchas

- **Validators run after generation.** They can't stop the model writing nonsense; they only catch it.
- **Strict-mode schema limits.** Some providers don't support every JSON Schema feature (e.g. certain `min`/`max` keywords). Enforce those in Pydantic instead.
- **Silent coercion.** Pydantic converts `"5"` to `5` by default. Use `strict=True` on a field or model if that hides real problems.
- **Retry cost.** Each retry resends the full conversation. Watch tokens on long inputs.

## Key terms

- **Validation** — checking parsed data against types and rules before using it.
- **Field validator** — a Pydantic method that checks or transforms one field.
- **Model validator** — a Pydantic method that checks rules across several fields.
- **Re-ask / repair loop** — sending the validation error back to the model to get a corrected answer.
- **Instructor** — a library that adds Pydantic response models and retries to LLM clients.

## Interview quick-fire

- **"Structured outputs guarantee the schema. Why still validate?"** → The schema guarantees shape, not correctness. Business rules, cross-field logic and real-world truth still need checks.
- **"What do you do when the model returns invalid output?"** → Send the validation error back and ask for a fix, retry once or twice, then fall back or fail loudly.
- **"How do you stop the model inventing values to satisfy required fields?"** → Make fields nullable and say "null if not present".
- **"field_validator vs. model_validator?"** → One field vs. rules that need several fields together.
