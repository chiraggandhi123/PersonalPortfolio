---
title: "System Prompts & Personas"
---

## TL;DR

The system prompt is your app's **standing instructions**: who the model is, what it does, what it must never do, and how to format answers. A **persona** is the voice part of that (tone, expertise, audience). Good system prompts are **structured, specific and short enough to read**, and they're tested like code. They shape behaviour strongly but are **not a security boundary**.

How the `system` role fits into the message list is covered in [messages & roles](../02-calling-models/02-messages-roles.md). This note is about what to write in it.

## A system prompt template

```text
# Role
You are Maya, a friendly support assistant for Acme Bank's mobile app.
Your users are retail customers, many of them not technical.

# Task
Answer questions about using the app: login, transfers, cards, statements.

# Rules
- Never ask for full card numbers, PINs, OTPs or passwords.
- For disputes, fraud or account closure, hand off: "I'll connect you to an agent."
- If you aren't sure, say so. Don't guess at fees or policies.
- Only discuss Acme Bank topics. Politely decline anything else.

# Style
- Plain English, short sentences, max 4 sentences unless the user asks for steps.
- Use numbered steps for instructions.

# Context
Today's date: 2026-01-15. App version: 5.2.
```

Markdown headers or XML tags make long prompts easier for both the model and you to scan.

## Personas: what they change and what they don't

| A persona changes | A persona doesn't change |
|---|---|
| Tone, vocabulary, formality | What the model actually knows |
| Level of detail for the audience | Accuracy ("You are a world-class doctor" won't add knowledge) |
| What it focuses on ("as a security reviewer…") | Safety training of the underlying model |
| Consistency of voice across turns | Its ability to keep secrets |

"You are an expert" gives a small boost at best. Describing the **audience** and the **task** usually helps more than flattering the model.

## Switchable personas in code

```python
from openai import OpenAI

client = OpenAI()

BASE_RULES = "Be accurate. If you don't know, say so. Keep answers under 120 words."

PERSONAS = {
    "teacher": "You explain concepts to a 12-year-old using everyday analogies.",
    "reviewer": "You are a blunt senior engineer. Point out flaws first, then fixes.",
    "coach": "You are an encouraging career coach. Ask one follow-up question at the end.",
}

def ask(persona: str, question: str) -> str:
    system = f"{PERSONAS[persona]}\n\n{BASE_RULES}"     # persona + shared rules
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": question},
        ],
    )
    return resp.choices[0].message.content

print(ask("teacher", "What is an API?"))
```

Keep the **rules shared** and only swap the persona part. Otherwise every persona drifts on safety and format.

## Dynamic context

System prompts are often built per request:

```python
from datetime import date

def build_system(user) -> str:
    return (
        f"{PERSONAS['coach']}\n\n"
        f"User name: {user.name}. Plan: {user.plan}. Language: {user.lang}.\n"
        f"Today's date: {date.today().isoformat()}."
    )
```

Inject facts the model can't know: the date, the user's plan, feature flags. Keep **untrusted text** (user bios, documents) out of the system prompt, or fence it clearly as data. See [prompt injection](./10-prompt-injection-basics.md).

## Best practices

- **Order: role → task → rules → format → context.** Put the most important rules where they can't be missed.
- **Say what to do in the edge cases**: off-topic questions, missing info, angry users, requests to hand off.
- **Prefer reasons over shouting.** "Never give fee amounts; they change often and we link to the fee page instead" beats "NEVER GIVE FEES!!!".
- **Keep it stable** and put changing data at the end. Some providers cache an identical prompt prefix, which cuts cost and latency.
- **Version it** and test it against a fixed set of conversations ([templates & versioning](./04-prompt-templates-versioning.md)).

## Gotchas

- **System prompts leak.** Users can often get the model to repeat it. Never put API keys, internal URLs or secrets in it.
- **Long chats dilute instructions.** After many turns the model can drift from the persona. Trim history ([conversation memory](./06-conversation-memory.md)) or restate key rules.
- **Persona vs. truth.** A confident persona can make wrong answers sound more convincing. Keep "say when unsure" in the rules.
- **Provider differences.** Anthropic takes `system` as a separate parameter, not a message. Gemini uses `system_instruction`.

## Key terms

- **System prompt** — developer instructions that set behaviour for the whole conversation.
- **Persona** — the role, voice and audience framing within a system prompt.
- **Guardrail rule** — an instruction that restricts topics or actions (e.g. "never ask for OTPs").
- **Handoff** — routing to a human or another system when the bot shouldn't answer.
- **Prompt caching** — provider-side reuse of an unchanged prompt prefix to save cost and latency.

## Interview quick-fire

- **"What goes in a system prompt?"** → Role, task, rules and edge-case handling, output style, and dynamic context such as the date.
- **"Does 'You are an expert' improve accuracy?"** → Slightly at most. Clear task, audience and examples matter more.
- **"Is the system prompt secure?"** → No. It can be extracted and overridden by clever input. Enforce real limits in code.
- **"How do you support multiple personas safely?"** → Share one set of rules and format instructions, and swap only the persona section.
