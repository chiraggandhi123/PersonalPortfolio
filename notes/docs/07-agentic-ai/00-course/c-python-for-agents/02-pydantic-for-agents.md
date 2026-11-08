---
title: "Pydantic for Agents"
---

## TL;DR

LLMs produce text; agents need **typed, validated data**. **Pydantic** lets you declare that data as Python classes and **validates it at the boundary**: tool arguments coming from the model, structured output going to your code, config from the environment, and sometimes the agent's own state. Learn `BaseModel`, `Field`, `Literal`, validators and `model_validate_json`, and you can stop hand-parsing model output.

## Where Pydantic shows up in an agent

| Boundary | What Pydantic does |
|---|---|
| Model → tool | Defines and validates tool arguments (the schema the model sees) |
| Model → your code | Structured output: the answer as an object, not prose |
| Agent state | Typed state for a LangGraph graph (optional; `TypedDict` is more common) |
| Environment → app | Settings and API keys via `pydantic-settings` |
| App → API | Request/response models in FastAPI |

## The basics

```python
from typing import Literal
from pydantic import BaseModel, Field, ValidationError, field_validator

class Task(BaseModel):
    title: str = Field(min_length=3, description="Short task title")
    priority: Literal["low", "medium", "high"] = "medium"
    estimate_hours: float = Field(gt=0, le=40)
    tags: list[str] = []

    @field_validator("title")
    @classmethod
    def strip_title(cls, v: str) -> str:
        return v.strip()

t = Task(title="  Write docs ", estimate_hours=2)
print(t.title, t.model_dump())               # "Write docs", dict form

try:
    Task.model_validate_json('{"title": "x", "estimate_hours": -1}')
except ValidationError as e:
    print(e.errors()[0]["msg"])               # clear, field-level errors
```

- **`model_validate`** / **`model_validate_json`** — build from a dict / JSON string.
- **`model_dump`** / **`model_dump_json`** — back to dict / JSON.
- **`model_json_schema()`** — the JSON schema that gets sent to the model.

## Structured output

```python
from langchain_openai import ChatOpenAI

class ResearchPlan(BaseModel):
    """A plan for researching a question."""
    sub_questions: list[str] = Field(description="3-5 focused sub-questions")
    needs_web_search: bool

llm = ChatOpenAI(model="gpt-4o-mini")
planner = llm.with_structured_output(ResearchPlan)

plan = planner.invoke("How do heat pumps compare to gas boilers on running cost?")
for q in plan.sub_questions:                  # a real object, already validated
    print("-", q)
```

With the raw OpenAI SDK, the same model goes to `client.chat.completions.parse(response_format=ResearchPlan)`. See [structured outputs](../../../02-calling-models/04-structured-outputs.md).

## Tool arguments

```python
from langchain_core.tools import tool

class SendEmailArgs(BaseModel):
    to: str = Field(description="Recipient email address")
    subject: str = Field(max_length=120)
    body: str

@tool(args_schema=SendEmailArgs)
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email. Only use after the user has confirmed the content."""
    return f"sent to {to}"
```

The model sees the field descriptions. If it sends a 300-character subject, validation fails before your function runs, and the agent gets the error back as a tool message it can fix.

## Typed settings

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    openai_api_key: str
    model_name: str = "gpt-4o-mini"
    max_iterations: int = 10

settings = Settings()       # reads OPENAI_API_KEY etc.; fails fast if missing
```

## Pydantic as LangGraph state

```python
from langgraph.graph import StateGraph

class ReviewState(BaseModel):
    draft: str = ""
    score: int = 0
    attempts: int = 0

graph = StateGraph(ReviewState)      # node inputs are validated ReviewState objects
```

`TypedDict` is lighter and the usual choice; use Pydantic state when you want runtime validation and defaults. Nodes still return a **dict of updates**.

## Design tips

- **Descriptions are prompts.** Write `Field(description=...)` for every field the model fills.
- **Use `Literal` for categories** so the model can't invent new ones.
- **Make "not found" valid** with `str | None = None`, or the model will make something up.
- **Keep schemas shallow.** Deep nesting and huge enums hurt reliability.
- **Validation ≠ truth.** A well-typed answer can still be wrong.

## Key terms

- **BaseModel** — the Pydantic base class for typed, validated data models.
- **Field** — attaches defaults, constraints and descriptions to a model attribute.
- **Validator** — a method that checks or transforms a field's value (`field_validator`, `model_validator`).
- **ValidationError** — the exception listing every field that failed and why.
- **`with_structured_output`** — LangChain method that makes a chat model return instances of a schema.
- **args_schema** — the Pydantic model that defines a tool's arguments.

## Interview quick-fire

- **"Why use Pydantic in agent code?"** → It turns untrusted model output into typed objects at the boundary, with clear errors when the model gets it wrong.
- **"How does the model know the shape of a tool's arguments?"** → The Pydantic model is converted to a JSON schema, including field descriptions, and sent with the request.
- **"What happens when tool arguments fail validation?"** → The function doesn't run; the error is returned as a tool result so the model can correct its call.
- **"TypedDict or Pydantic for LangGraph state?"** → TypedDict for simple, fast state; Pydantic when you want runtime validation and defaults.
