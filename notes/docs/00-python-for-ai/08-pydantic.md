---
title: "Pydantic (data validation & structured outputs)"
---

## TL;DR

**Pydantic** turns type hints into **runtime validation**. You declare a class with typed fields; Pydantic checks incoming data, converts what it safely can (`"3"` → `3`) and raises a clear `ValidationError` for the rest. In AI apps it's everywhere: **defining LLM output schemas**, validating tool arguments, parsing API responses, and loading settings. The OpenAI SDK, LangChain, FastAPI and most agent frameworks are built on it. This note covers **Pydantic v2**.

## A first model

```python
from pydantic import BaseModel, ValidationError

class Movie(BaseModel):
    title: str
    year: int
    genres: list[str] = []
    rating: float | None = None

m = Movie(title="Arrival", year="2016", genres=["sci-fi"])
print(m.year, type(m.year))      # 2016 <class 'int'>  (string coerced)

try:
    Movie(title="Arrival", year="twenty sixteen")
except ValidationError as e:
    print(e)                     # year: Input should be a valid integer...
```

```
untrusted data (LLM JSON, API, user)  ──►  Movie(**data)  ──►  typed object  ✓
                                                 │
                                                 └──►  ValidationError  ✗ (retry / reject)
```

## Core methods (v2)

| Method | Does |
|---|---|
| `Model.model_validate(dict)` | Validate a dict |
| `Model.model_validate_json(str)` | Parse + validate a JSON string in one step |
| `obj.model_dump()` | Object → dict |
| `obj.model_dump_json()` | Object → JSON string |
| `Model.model_json_schema()` | JSON schema (what LLM APIs consume) |
| `obj.model_copy(update={...})` | Copy with changes |

v1 names (`parse_obj`, `.dict()`, `.json()`) still appear in old tutorials. Prefer the `model_` versions.

## Fields, constraints and descriptions

```python
from typing import Literal
from pydantic import BaseModel, Field

class Ticket(BaseModel):
    category: Literal["billing", "bug", "feature_request", "other"]
    priority: int = Field(ge=1, le=3, description="1 = urgent, 3 = low")
    summary: str = Field(max_length=200, description="One sentence summary")
    customer_email: str | None = Field(default=None, description="null if not mentioned")
    tags: list[str] = Field(default_factory=list)
```

- **`Literal`** restricts to fixed values: perfect for classification.
- **`ge`/`le`/`max_length`** add numeric and length rules.
- **`description`** ends up in the JSON schema, so the model reads it as an instruction.
- **`default_factory=list`** gives each instance its own list.

Nested models work naturally:

```python
class LineItem(BaseModel):
    name: str
    qty: int
    price: float

class Invoice(BaseModel):
    vendor: str
    items: list[LineItem]
```

## Pydantic for LLM outputs

### With the OpenAI SDK

```python
from openai import OpenAI

client = OpenAI()

completion = client.chat.completions.parse(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "Classify the support message."},
        {"role": "user", "content": "I was charged twice this month!! fix asap"},
    ],
    response_format=Ticket,
)
ticket = completion.choices[0].message.parsed      # a Ticket instance (or None on refusal)
print(ticket.category, ticket.priority)
```

More detail in [structured outputs](../02-calling-models/04-structured-outputs.md).

### Validating raw JSON yourself

When a provider only gives you a JSON string, validate it:

```python
raw = '{"category": "billing", "priority": 1, "summary": "Double charge"}'
ticket = Ticket.model_validate_json(raw)
```

On `ValidationError`, a common pattern is to send the error text back to the model and ask it to fix its output (libraries like Instructor automate this).

## Custom validators

```python
from pydantic import BaseModel, field_validator, model_validator

class Answer(BaseModel):
    answer: str
    sources: list[str]

    @field_validator("answer")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("answer is empty")
        return v.strip()

    @model_validator(mode="after")
    def needs_sources(self):
        if "I don't know" not in self.answer and not self.sources:
            raise ValueError("answers must cite at least one source")
        return self
```

Use these for business rules the schema can't express: "line items must sum to the total", "dates must be in the past".

## Settings from the environment

`pydantic-settings` loads and validates config from env vars and `.env`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")
    openai_api_key: str
    model: str = "gpt-4o-mini"
    max_tokens: int = 500

settings = Settings()        # fails fast at startup if OPENAI_API_KEY is missing
```

## Gotchas

- **Coercion surprises** — `"1"` becomes `1` by default. Use `model_config = ConfigDict(strict=True)` or strict types if you don't want that.
- **Extra keys are ignored** by default. Set `extra="forbid"` to reject them.
- **OpenAI strict mode limits** — all fields must be required (use `| None` for optional), and some constraints (like `max_length`) may not be enforced by the API. Pydantic still validates them on parse.
- **Valid ≠ true** — a schema-valid answer can still be wrong. Pydantic checks shape and rules, not facts.
- **v1 vs v2** — mixing tutorials leads to `AttributeError`. Check `pydantic.VERSION`.

## Key terms

- **`BaseModel`** — the base class for Pydantic models.
- **Validation** — checking data against types and rules, raising `ValidationError` on failure.
- **Coercion** — converting compatible input (`"3"` → `3`) during validation.
- **`Field`** — adds defaults, constraints and descriptions to a field.
- **JSON schema** — a standard description of a JSON shape; generated by `model_json_schema()`.
- **Validator** — a custom method (`@field_validator`, `@model_validator`) adding rules.

## Interview quick-fire

- **"Why Pydantic in LLM apps?"** → LLM output is untrusted text; Pydantic defines the expected shape, generates the schema for the API, and validates the result into a typed object.
- **"How do you make a field optional for OpenAI strict mode?"** → Keep it required but allow `None` (`str | None`), and tell the model to use null when unknown.
- **"`model_validate` vs `model_validate_json`?"** → The first takes a dict, the second parses and validates a JSON string directly.
- **"What happens with extra keys?"** → Ignored by default; configure `extra="forbid"` to reject them.
