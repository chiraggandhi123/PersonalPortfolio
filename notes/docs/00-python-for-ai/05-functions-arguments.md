---
title: "Functions & Arguments"
---

## TL;DR

Functions wrap a piece of logic behind a name: `def ask(prompt) -> str`. Wrap every LLM call in a function so you can reuse it, test it and swap models in one place. Know the argument kinds: **positional**, **keyword**, **defaults**, and **`*args` / `**kwargs`**. SDKs use keyword arguments heavily (`model=`, `messages=`). **Type hints and docstrings** matter more than usual, because tool-calling frameworks read them to describe your function to the model.

## Defining and calling

```python
from openai import OpenAI

client = OpenAI()

def ask(prompt: str, model: str = "gpt-4o-mini", temperature: float = 0.2) -> str:
    """Send one prompt to the model and return the text reply."""
    response = client.chat.completions.create(
        model=model,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content

ask("Define RAG in one sentence.")                  # positional
ask("Write a haiku.", temperature=0.9)              # keyword overrides default
ask(prompt="Hi", model="gpt-4o")                    # all keywords
```

A function without `return` returns `None`.

## Argument kinds

| Kind | Syntax | Example |
|---|---|---|
| Positional | `def f(a, b)` | `f(1, 2)` |
| Keyword | — | `f(b=2, a=1)` |
| Default | `def f(a, b=10)` | `f(1)` |
| Variable positional | `def f(*args)` | `f(1, 2, 3)` → `args = (1, 2, 3)` |
| Variable keyword | `def f(**kwargs)` | `f(x=1)` → `kwargs = {"x": 1}` |
| Keyword-only | `def f(a, *, b)` | `f(1, b=2)` (b must be named) |

### `**kwargs`: passing options through

```python
def chat(messages: list[dict], **options) -> str:
    response = client.chat.completions.create(
        model=options.pop("model", "gpt-4o-mini"),
        messages=messages,
        **options,                       # forward max_tokens, temperature, etc.
    )
    return response.choices[0].message.content

chat(history, temperature=0, max_completion_tokens=200)
```

`**` also unpacks a dict into keyword arguments: `client.chat.completions.create(**request)`.

### Keyword-only for clarity

```python
def summarize(text: str, *, max_words: int = 100, style: str = "bullets") -> str:
    ...

summarize(doc, max_words=50)     # summarize(doc, 50) would be an error: good
```

## The mutable default trap

```python
def add_turn(msg, history=[]):          # BAD: one list shared by every call
    history.append(msg)
    return history

def add_turn(msg, history: list | None = None):   # GOOD
    history = [] if history is None else history
    history.append(msg)
    return history
```

Defaults are evaluated once, when the function is defined.

## Functions as values

Functions are objects. You can store them in dicts and pass them around, which is exactly how tool dispatch works.

```python
def get_weather(city: str) -> str:
    """Get current weather for a city."""
    return f"31°C in {city}"

def search_docs(query: str) -> str:
    """Search the internal knowledge base."""
    return "..."

TOOLS = {"get_weather": get_weather, "search_docs": search_docs}

name, args = "get_weather", {"city": "Pune"}     # from the model's tool call
result = TOOLS[name](**args)
```

### lambda

Small anonymous functions, mostly for `key=`:

```python
results.sort(key=lambda r: r["score"], reverse=True)
```

## Docstrings and hints feed the model

Frameworks like LangChain's `@tool`, the OpenAI Agents SDK's `@function_tool`, and Pydantic-based helpers generate the tool schema from your signature:

```python
def convert_currency(amount: float, from_ccy: str, to_ccy: str) -> float:
    """Convert an amount between currencies, e.g. USD to INR."""
```

```
name        ← convert_currency
description ← docstring
parameters  ← amount: number, from_ccy: string, to_ccy: string (all required)
```

Bad names and missing docstrings lead to the model calling the wrong tool. See [tool calling](../02-calling-models/05-tool-function-calling.md).

## Decorators (you'll see these everywhere)

A decorator wraps a function to add behaviour: `@retry`, `@tool`, `@app.get("/")`, `@st.cache_data`.

```python
import time, functools

def timed(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = fn(*args, **kwargs)
        print(f"{fn.__name__} took {time.perf_counter() - start:.2f}s")
        return result
    return wrapper

@timed
def ask(prompt: str) -> str: ...
```

You rarely need to write one early on; you need to recognise them.

## Gotchas

- **Return early on bad input** instead of nesting `if`s deeply.
- **Don't hide the client inside every call** — create the `OpenAI()` client once at module level and reuse it.
- **One job per function** — `build_prompt`, `call_model`, `parse_reply` are easier to test than one giant function.
- **Global variables** modified inside functions need `global`; usually a sign to pass the value in instead.

## Key terms

- **Parameter / argument** — the name in the definition / the value passed at call time.
- **Default argument** — a fallback value, evaluated once at definition time.
- **`*args` / `**kwargs`** — collect extra positional / keyword arguments.
- **Keyword-only argument** — must be passed by name (after `*`).
- **Docstring** — the string literal at the top of a function, used for docs and tool descriptions.
- **Decorator** — a function that wraps another function, applied with `@name`.

## Interview quick-fire

- **"What's wrong with `def f(x=[])`?"** → The list is created once and shared across calls; use `None` and create it inside.
- **"What do `*args` and `**kwargs` do?"** → Collect extra positional args into a tuple and extra keyword args into a dict; `*`/`**` also unpack at call sites.
- **"How does a framework turn a Python function into a tool?"** → It inspects the name, type hints and docstring to build a JSON schema the model sees.
- **"What is a decorator?"** → A function that takes a function and returns a wrapped version, e.g. adding retries, timing or registration.
