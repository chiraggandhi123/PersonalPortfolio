---
title: "Messages & Roles (system, user, assistant)"
---

## TL;DR

A chat request is a **list of messages**, each tagged with a **role**: `system` sets the rules, `user` is the human, `assistant` is the model's past replies, and `tool` carries results from your functions. The model reads the whole list top to bottom and writes the next `assistant` message. Controlling that list is most of prompt engineering.

## The roles

| Role | Written by | Use it for |
|---|---|---|
| `system` (or `developer`) | You, the developer | Persona, rules, output format, guardrails |
| `user` | The end user (or your app) | Questions, inputs, documents to process |
| `assistant` | The model | Its earlier replies; also **examples** you write |
| `tool` | Your code | The result of a function the model asked to call |

```python
messages = [
    {"role": "system", "content": "You are a support bot for Acme. Answer in 2 sentences max."},
    {"role": "user", "content": "How do I reset my password?"},
    {"role": "assistant", "content": "Go to Settings → Security → Reset password. You'll get an email link."},
    {"role": "user", "content": "I didn't get the email."},
]
```

The model sees the earlier exchange, so "the email" makes sense.

:::note `system` vs. `developer`
Newer OpenAI models also accept `{"role": "developer"}`. It means the same thing as `system`: instructions from the app builder that outrank the user. `system` still works everywhere.
:::

## The system prompt

The system message is the highest-priority instruction. A good one covers:

```text
You are <role> for <audience>.            ← who
Your job: <task>.                         ← what
Rules:                                    ← constraints
- Only answer questions about <domain>.
- If you don't know, say so.
Format: <bullets / JSON / under 100 words>.   ← shape
```

Tips:

- Put **stable** rules here, not per-request data.
- Be specific. "Be concise" is vague; "answer in at most 3 bullet points" is testable.
- It's **paid for on every call**, so keep it tight (and use prompt caching for long ones).

## Conversation memory = the message list

The model has no memory. Each call, you send the whole history:

```python
from openai import OpenAI
client = OpenAI()

messages = [{"role": "system", "content": "You are a friendly tutor."}]

def ask(text: str) -> str:
    messages.append({"role": "user", "content": text})
    resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages)
    reply = resp.choices[0].message.content
    messages.append({"role": "assistant", "content": reply})   # don't forget this
    return reply

ask("My name is Chirag.")
ask("What's my name?")    # works only because turn 1 is still in `messages`
```

Forget to append the assistant reply and the model loses track of what it said.

## Few-shot: fake assistant turns

You can write `assistant` messages yourself to **show** the model the exact behavior you want. This is often more reliable than describing it:

```python
messages = [
    {"role": "system", "content": "Classify the sentiment as positive, negative or neutral. Reply with one word."},
    {"role": "user", "content": "The delivery was fast and the box was perfect."},
    {"role": "assistant", "content": "positive"},
    {"role": "user", "content": "It arrived. It works."},
    {"role": "assistant", "content": "neutral"},
    {"role": "user", "content": "Broke after two days, support never replied."},   # the real input
]
```

## Message content isn't only text

`content` can be a list of parts, mixing text and images:

```python
{"role": "user", "content": [
    {"type": "text", "text": "What's in this picture?"},
    {"type": "image_url", "image_url": {"url": "https://example.com/cat.jpg"}},
]}
```

Images become tokens too, often hundreds per image.

## Rules that trip people up

- **Order matters.** Instructions at the end of a long context tend to get more attention than ones buried in the middle.
- **Anthropic** takes the system prompt as a separate `system=` parameter, and the first message must be `user`.
- **Gemini** calls the assistant role `model`.
- **Tool results** must follow the assistant message that requested them, with the matching `tool_call_id` (see [Tool / Function Calling](./05-tool-function-calling.md)).
- **User text is untrusted.** Someone can type "ignore your instructions". Never put secrets in the system prompt and don't rely on it alone for security (prompt injection).

## Key terms

- **Role** — who a message is from: system/developer, user, assistant, tool.
- **System prompt** — developer instructions that set behavior for the whole conversation.
- **Few-shot prompting** — giving example user/assistant pairs to demonstrate the task.
- **Multimodal content** — message content made of text plus images or audio parts.
- **Prompt injection** — user input that tries to override the developer's instructions.

## Interview quick-fire

- **"What's the difference between the system and user role?"** → System is developer-level instruction that applies to the whole conversation and outranks the user; user is the end user's input.
- **"How does a chatbot keep context?"** → The app stores the message list and resends it, including the assistant's previous replies, on every call.
- **"Why add assistant messages you wrote yourself?"** → Few-shot examples: showing input/output pairs steers format and behavior more reliably than describing it.
