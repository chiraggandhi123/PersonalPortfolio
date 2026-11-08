---
title: "Variables, Data Types & f-strings"
---

## TL;DR

A **variable** is a name pointing at a value; Python figures out the type at runtime. The core types you'll handle in every LLM app are **`str`** (prompts and replies), **`int`/`float`** (token counts, temperature, cost), **`bool`** (flags) and **`None`** (missing values). **f-strings** (`f"Hello {name}"`) are how you build prompts. Add **type hints** so your editor and Pydantic can help you.

## Variables

```python
model = "gpt-4o-mini"          # str
temperature = 0.2              # float
max_tokens = 500               # int
stream = False                 # bool
system_prompt = None           # NoneType: "no value yet"

model = "gpt-4o"               # rebinding is fine: names aren't locked to a type
```

Naming: `snake_case` for variables and functions, `UPPER_CASE` for constants like `MODEL = "gpt-4o-mini"`.

## Core types

| Type | Example | In an LLM app |
|---|---|---|
| `str` | `"Summarize this"` | Prompts, model replies, IDs |
| `int` | `1024` | Token counts, max tokens, retries |
| `float` | `0.7` | Temperature, top_p, cost in dollars |
| `bool` | `True` | `stream=True`, feature flags |
| `None` | `None` | Optional fields, "not found" |

```python
type(0.7)            # <class 'float'>
isinstance(42, int)  # True
```

### Conversions

Data from files, env vars and APIs often arrives as strings.

```python
import os

max_tokens = int(os.getenv("MAX_TOKENS", "500"))       # env vars are always str
temperature = float("0.3")
str(1234)                                              # "1234"
bool("")                                               # False: empty is falsy
bool("false")                                          # True! any non-empty string is truthy
```

## Strings

```python
reply = "  The answer is 42.  "
reply.strip()                    # "The answer is 42."
reply.lower(), reply.upper()
"42" in reply                    # True
reply.replace("42", "forty-two")
"a,b,c".split(",")               # ["a", "b", "c"]
", ".join(["a", "b"])            # "a, b"
reply.strip().startswith("The")  # True
```

Strings are **immutable**: methods return a new string; they don't change the original.

### Multi-line strings for prompts

```python
SYSTEM = """You are a support assistant for Acme.
- Answer in under 80 words.
- If unsure, say you don't know."""
```

Use `textwrap.dedent` if indentation inside a function leaks into the prompt.

## f-strings: building prompts

```python
user_name = "Asha"
question = "What is RAG?"
tokens_used = 1234
cost = 0.000412

prompt = f"User {user_name} asks: {question}"
print(f"Used {tokens_used:,} tokens")       # Used 1,234 tokens
print(f"Cost: ${cost:.4f}")                 # Cost: $0.0004
print(f"{temperature=}")                    # temperature=0.3  (handy for debugging)
```

A prompt template with a document:

```python
def build_prompt(doc: str, n: int) -> str:
    return f"""Summarize the document below in {n} bullet points.

Document:
\"\"\"
{doc}
\"\"\"
"""
```

To include a literal brace (e.g. a JSON example in a prompt), double it: `f'Return {{"label": "{label}"}}'`.

## Type hints

```python
model: str = "gpt-4o-mini"
temperature: float = 0.2
system_prompt: str | None = None       # "a string, or None"
```

Python doesn't enforce hints at runtime. Editors and type checkers do, and **Pydantic uses them to validate data**, which matters a lot for LLM outputs. See [Pydantic](./08-pydantic.md).

## Gotchas

- **`"5" + 5`** raises `TypeError`. Convert first: `int("5") + 5`.
- **Float rounding** — `0.1 + 0.2 != 0.3`. Fine for cost estimates; round when displaying.
- **`is` vs `==`** — use `==` for values; use `is` only for `None` (`if x is None`).
- **Model replies have whitespace** — call `.strip()` before comparing (`reply.strip().lower() == "yes"`).
- **f-strings with user input** go straight into the prompt. That's the root of prompt injection; keep instructions and user data clearly separated.

## Key terms

- **Variable** — a name bound to a value.
- **Dynamic typing** — types belong to values, checked at runtime, not to names.
- **Immutable** — can't be changed in place (`str`, `int`, `tuple`).
- **f-string** — a string literal prefixed with `f` that evaluates `{expressions}` inside it.
- **Type hint** — an annotation like `x: int` that documents and enables tooling, not enforced by Python.
- **Truthy / falsy** — how values behave in `if`: `""`, `0`, `None`, `[]` are falsy.

## Interview quick-fire

- **"Is Python statically typed?"** → No, it's dynamically typed. Type hints are optional and checked by tools, not the interpreter.
- **"How do you put a literal `{` in an f-string?"** → Double it: `{{`.
- **"Why does `bool('False')` return True?"** → Any non-empty string is truthy. Parse it explicitly, e.g. `value.lower() == "true"`.
- **"Mutable vs immutable?"** → Immutable objects (str, int, tuple) can't be changed in place; mutable ones (list, dict, set) can.
