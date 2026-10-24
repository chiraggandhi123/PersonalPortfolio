---
title: "Chat APIs (OpenAI, Anthropic, Gemini)"
---

## TL;DR

Every major LLM provider exposes the same basic thing: an HTTP endpoint that takes **a list of messages** and returns **the model's next message** plus **token usage**. The SDKs differ in names and shapes, not in ideas. Learn one well (OpenAI here), and the others are a 10-minute translation.

## The shape of every chat call

```
request                                   response
─────────────────────────────             ─────────────────────────────
model        "gpt-4o-mini"                text         "Paris."
messages     [system, user, ...]   ──►    stop reason  "stop" / "length" / "tool_calls"
max tokens   1024                         usage        input 25 · output 3
options      temperature, tools, ...
```

Four things you always care about:

1. **Which model** — capability vs. speed vs. price.
2. **What you send** — the messages (history, instructions, data).
3. **What comes back** — text (or tool calls / JSON).
4. **Why it stopped and what it cost** — stop reason and usage.

## OpenAI

```bash
pip install openai python-dotenv
# .env  →  OPENAI_API_KEY=sk-...
```

```python
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()   # reads OPENAI_API_KEY from env

response = client.chat.completions.create(
    model="gpt-4o-mini",
    max_completion_tokens=500,
    temperature=0.3,
    messages=[
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user", "content": "What is the capital of France?"},
    ],
)

print(response.choices[0].message.content)   # "Paris."
print(response.choices[0].finish_reason)     # "stop"
print(response.usage)                        # prompt_tokens, completion_tokens, total_tokens
```

Why `choices[0]`? You can ask for several candidate answers with `n=3`. Almost everyone uses one.

### Chat Completions vs. the Responses API

OpenAI has two endpoints that do this job:

| | Chat Completions | Responses |
|---|---|---|
| Call | `client.chat.completions.create` | `client.responses.create` |
| Input | `messages=[...]` | `input="..."` or a list of messages |
| System prompt | `{"role": "system"}` message | `instructions="..."` |
| Text out | `response.choices[0].message.content` | `response.output_text` |
| History | you resend it | you resend it, **or** pass `previous_response_id` |
| Built-in tools | no | web search, file search, code interpreter |

```python
response = client.responses.create(
    model="gpt-4o-mini",
    instructions="You are a concise assistant.",
    input="What is the capital of France?",
)
print(response.output_text)
```

Chat Completions is the **industry-standard format**: Ollama, Groq, Together, vLLM, LiteLLM and many others accept it. That's why these notes use it by default. Reach for Responses when you want OpenAI's built-in tools or server-side conversation state.

## Anthropic (Claude)

```python
import anthropic
client = anthropic.Anthropic()   # ANTHROPIC_API_KEY

response = client.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=500,                                  # required
    system="You are a concise assistant.",           # separate parameter
    messages=[{"role": "user", "content": "What is the capital of France?"}],
)
print(response.content[0].text)
print(response.stop_reason)      # "end_turn" / "max_tokens" / "tool_use"
print(response.usage)            # input_tokens, output_tokens
```

## Google (Gemini)

```python
from google import genai
from google.genai import types

client = genai.Client()   # GEMINI_API_KEY

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="What is the capital of France?",
    config=types.GenerateContentConfig(
        system_instruction="You are a concise assistant.",
        max_output_tokens=500,
    ),
)
print(response.text)
print(response.usage_metadata)
```

Gemini calls the assistant role `"model"` and the message list `contents`.

## Side-by-side

| | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| Package | `openai` | `anthropic` | `google-genai` |
| Call | `chat.completions.create` | `messages.create` | `models.generate_content` |
| System prompt | message with `role: system` | `system=` param | `system_instruction=` in config |
| Assistant role name | `assistant` | `assistant` | `model` |
| Output cap | `max_completion_tokens` (optional) | `max_tokens` (**required**) | `max_output_tokens` |
| Text | `choices[0].message.content` | `content[0].text` | `.text` |
| Stop reason | `finish_reason` | `stop_reason` | `candidates[0].finish_reason` |
| Usage | `usage.prompt_tokens` / `completion_tokens` | `usage.input_tokens` / `output_tokens` | `usage_metadata` |

:::tip The OpenAI format as a lingua franca
Gemini and many open-model hosts also offer an **OpenAI-compatible endpoint**. Point the OpenAI SDK at a different `base_url` and the same code talks to another provider:

```python
client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")   # local Ollama
```
:::

## Stateless by design

Every call is independent. The API does **not** remember the previous request. "Conversation" means **you** keep the message list and resend it (see [Messages & Roles](./02-messages-roles.md)). The only exception is opt-in server-side state like `previous_response_id`.

## Choosing a model

- Start with the **small/fast tier** (`gpt-4o-mini`, Haiku, Flash). It's 5–20× cheaper and usually good enough.
- Move up to a **flagship** only for tasks the small model visibly fails on (hard reasoning, long-form writing, tricky code).
- Keep the model name in **one constant or env var**, so switching is a one-line change.

## Key terms

- **Chat Completions** — OpenAI's message-list endpoint; the de-facto standard format.
- **Responses API** — OpenAI's newer endpoint with built-in tools and optional server-side state.
- **finish_reason / stop_reason** — why the model stopped: natural end, token limit, or a tool call.
- **Usage** — input and output token counts returned with every response.
- **OpenAI-compatible endpoint** — a non-OpenAI server that accepts the Chat Completions format.

## Interview quick-fire

- **"Do LLM APIs remember previous requests?"** → No, they're stateless; the client resends the conversation each time (unless you opt into server-side state like OpenAI's `previous_response_id`).
- **"How would you switch from OpenAI to Claude?"** → Map the call shape: system prompt becomes a parameter, `max_tokens` is required, text is in `content[0].text`; or use a provider-agnostic client like LiteLLM.
- **"What does finish_reason = length mean?"** → The output hit the token cap and was cut off; raise the limit or ask for shorter output.
