---
title: "Object-Oriented Python (enough to read frameworks)"
---

## TL;DR

You don't need to design class hierarchies to build LLM apps, but you **must be able to read them**. Every SDK hands you objects: `client = OpenAI()` is an **instance**, `client.chat.completions.create(...)` is a **method** call, `response.choices[0].message` is **attribute** access. Learn `class`, `__init__`, `self`, methods, **inheritance** (frameworks make you subclass `BaseModel`, `BaseTool`, etc.) and **dataclasses**. That's enough to read LangChain, LangGraph or Pydantic code.

## Classes and instances

```python
from openai import OpenAI

class ChatBot:
    """A chatbot that keeps its own conversation history."""

    def __init__(self, system: str, model: str = "gpt-4o-mini"):
        self.client = OpenAI()
        self.model = model
        self.history = [{"role": "system", "content": system}]

    def ask(self, text: str) -> str:
        self.history.append({"role": "user", "content": text})
        response = self.client.chat.completions.create(model=self.model, messages=self.history)
        reply = response.choices[0].message.content
        self.history.append({"role": "assistant", "content": reply})
        return reply

    def reset(self) -> None:
        self.history = self.history[:1]       # keep only the system message


tutor = ChatBot("You are a patient Python tutor.")
pirate = ChatBot("You talk like a pirate.")
tutor.ask("What is a list?")                 # each instance has its own history
```

```
ChatBot (class = blueprint)
   ├── tutor   (instance)  history: [...tutor messages]
   └── pirate  (instance)  history: [...pirate messages]
```

| Piece | Meaning |
|---|---|
| `class ChatBot:` | Defines a new type |
| `__init__` | Runs when you create an instance; sets up attributes |
| `self` | The instance the method was called on (passed automatically) |
| `self.history` | Instance attribute: separate per object |
| `tutor.ask(...)` | Method call; Python passes `tutor` as `self` |

## Reading SDK objects

API responses are objects, not dicts. Use dot access:

```python
response = client.chat.completions.create(...)
response.choices[0].message.content      # attributes, not ["choices"]
response.usage.total_tokens
response.model_dump()                    # Pydantic object -> plain dict (for logging/JSON)
```

The chain `client.chat.completions.create` is just attributes holding objects that have methods. Hover in VS Code or use `dir(obj)` / `type(obj)` to explore.

## Inheritance: what frameworks ask of you

A subclass gets everything from its parent and can add or override behaviour.

```python
class StrictBot(ChatBot):
    def ask(self, text: str) -> str:
        if len(text) > 2000:
            return "Message too long."
        return super().ask(text)              # call the parent's version
```

Frameworks use this all the time:

```python
from pydantic import BaseModel

class Answer(BaseModel):          # inherit validation, .model_dump(), JSON schema...
    answer: str
    confidence: float
```

Other examples you'll meet: `class MyTool(BaseTool)` in LangChain/CrewAI, `class State(TypedDict)` in LangGraph, `class Handler(BaseCallbackHandler)` for tracing.

## Dataclasses: classes for plain data

```python
from dataclasses import dataclass, field

@dataclass
class Chunk:
    text: str
    source: str
    score: float = 0.0
    tags: list[str] = field(default_factory=list)    # safe mutable default

c = Chunk("Paris is in France.", "geo.md", 0.91)
print(c)              # Chunk(text='Paris is in France.', source='geo.md', score=0.91, tags=[])
```

`@dataclass` writes `__init__`, `__repr__` and `__eq__` for you. Use it for internal data; use **Pydantic** when data comes from outside (APIs, LLM output, user input) and needs validation.

## Dunder methods you'll see

| Method | Triggered by |
|---|---|
| `__init__` | `ChatBot(...)` |
| `__repr__` / `__str__` | `print(obj)`, debugger display |
| `__len__` | `len(obj)` |
| `__call__` | `obj(...)`: why LangChain runnables and PyTorch models look like functions |
| `__enter__` / `__exit__` | `with obj:` (files, clients, sessions) |
| `__aenter__` / `__aexit__` | `async with obj:` |

## Class vs instance attributes, and other decorators

```python
class Agent:
    default_model = "gpt-4o-mini"         # class attribute: shared by all instances

    def __init__(self, name: str):
        self.name = name                  # instance attribute

    @property
    def label(self) -> str:               # accessed like an attribute: agent.label
        return f"{self.name} ({self.default_model})"

    @classmethod
    def from_config(cls, cfg: dict) -> "Agent":   # alternative constructor
        return cls(cfg["name"])

    @staticmethod
    def count_words(text: str) -> int:    # plain function namespaced in the class
        return len(text.split())
```

## Gotchas

- **Forgetting `self`** as the first method parameter gives "takes 1 positional argument but 2 were given".
- **Mutable class attributes** (`history = []` at class level) are shared by every instance: one user's chat leaks into another's. Set them in `__init__`.
- **Don't reach for classes too early** — a few functions plus a dict is often clearer. Add a class when state and behaviour belong together (a bot with history, a client wrapper).
- **Composition over inheritance** — give your bot a `retriever` attribute rather than subclassing a retriever.

## Key terms

- **Class** — a blueprint defining attributes and methods.
- **Instance / object** — one concrete thing made from a class.
- **Method** — a function defined in a class; receives the instance as `self`.
- **Inheritance** — a subclass reusing and extending a parent class; `super()` calls the parent.
- **Dataclass** — a class with auto-generated `__init__`/`__repr__` for holding data.
- **Dunder method** — "double underscore" hooks like `__init__` that Python calls for built-in operations.

## Interview quick-fire

- **"What is `self`?"** → The instance the method is called on; Python passes it automatically as the first argument.
- **"Dataclass vs Pydantic model?"** → Dataclasses just structure data; Pydantic validates and coerces it, which you want for untrusted input like LLM output.
- **"Why do LangChain objects work like functions?"** → They implement `__call__` / `invoke`, so an instance can be called.
- **"Class attribute vs instance attribute?"** → Class attributes are shared by all instances; instance attributes (set on `self`) are per object.
