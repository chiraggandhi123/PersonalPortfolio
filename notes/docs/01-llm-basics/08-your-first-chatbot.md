---
title: "Your First Chatbot (chat history + an LLM API)"
---

## TL;DR

The model has **no memory**. A chatbot "remembers" because **you resend the entire conversation on every request**. A chatbot is just:

```
messages = []
loop:
    user types → append {"role": "user", ...}
    send ALL messages to the API
    append {"role": "assistant", ...} with the reply
```

## The messages format

Chat APIs take a list of messages with **roles**:

| Role | Who | Purpose |
|---|---|---|
| `system` | You (the developer) | Persona, rules, format — sets behavior for the whole chat |
| `user` | The human | Questions/inputs |
| `assistant` | The model | Its previous replies |

```python
messages = [
    {"role": "user", "content": "Hi, I'm Yash."},
    {"role": "assistant", "content": "Hi Yash! How can I help?"},
    {"role": "user", "content": "What's my name?"},   # model can answer — it's in the history
]
```

Remove the first two messages and the model has no idea what your name is. That's the whole trick.

## Step 1 — a single call

```bash
pip install anthropic python-dotenv
# .env  →  ANTHROPIC_API_KEY=sk-ant-...
```

```python
import anthropic
from dotenv import load_dotenv

load_dotenv()
client = anthropic.Anthropic()   # reads ANTHROPIC_API_KEY from env

response = client.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=1024,
    system="You are a friendly, concise assistant.",
    messages=[{"role": "user", "content": "Explain an LLM in one sentence."}],
)
print(response.content[0].text)
print(response.usage)   # input_tokens / output_tokens — always worth logging
```

Note: Anthropic takes `system` as a separate parameter; OpenAI puts it in the messages list as `{"role": "system", ...}`.

## Step 2 — the chat loop with memory

```python
import anthropic
from dotenv import load_dotenv

load_dotenv()
client = anthropic.Anthropic()

SYSTEM = "You are a friendly, concise assistant."
MODEL = "claude-sonnet-5-5"
messages = []

while True:
    user_input = input("You: ").strip()
    if user_input.lower() in {"quit", "exit"}:
        break
    if not user_input:
        continue

    messages.append({"role": "user", "content": user_input})

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM,
        messages=messages,          # the WHOLE history, every time
    )
    reply = response.content[0].text
    messages.append({"role": "assistant", "content": reply})

    print(f"Bot: {reply}\n")
```

## Step 3 — streaming (feels much faster)

Without streaming, the user stares at nothing until the full answer is done. With streaming, text appears token by token.

```python
with client.messages.stream(
    model=MODEL, max_tokens=1024, system=SYSTEM, messages=messages
) as stream:
    print("Bot: ", end="", flush=True)
    for text in stream.text_stream:
        print(text, end="", flush=True)
    reply = stream.get_final_message().content[0].text
print()
messages.append({"role": "assistant", "content": reply})
```

## Step 4 — keep the history from growing forever

Every turn resends everything, so cost and latency climb, and eventually you hit the context window. Simplest fix — keep only the last N messages:

```python
MAX_MESSAGES = 20

def trimmed(messages):
    recent = messages[-MAX_MESSAGES:]
    # Anthropic requires the first message to be from the user
    while recent and recent[0]["role"] != "user":
        recent = recent[1:]
    return recent

response = client.messages.create(..., messages=trimmed(messages))
```

Better options as you grow:

- **Summarize** older turns into a short "conversation so far" note.
- **Token-based trimming** — count tokens instead of messages.
- **Long-term memory** — store facts ("user's name is Yash") in a database and inject them into the system prompt.

## Step 5 — handle errors

APIs fail: rate limits, timeouts, overloaded servers. Minimum viable handling:

```python
try:
    response = client.messages.create(...)
except anthropic.RateLimitError:
    print("Rate limited — wait and retry.")
except anthropic.APIError as e:
    print(f"API error: {e}")
    messages.pop()   # remove the user message that never got a reply
```

The SDK already retries some errors automatically (`max_retries` on the client). Deeper retry/backoff patterns are in the *Calling Models* stage.

## Same thing with OpenAI (for comparison)

```python
from openai import OpenAI
client = OpenAI()

messages = [{"role": "system", "content": "You are a friendly, concise assistant."}]
messages.append({"role": "user", "content": "Hi!"})

resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages)
messages.append({"role": "assistant", "content": resp.choices[0].message.content})
```

Same idea everywhere: a list of role-tagged messages that **you** maintain.

## Checklist

- [ ] API key in `.env`, `.env` in `.gitignore`
- [ ] System prompt defines persona and rules
- [ ] Full history sent each turn
- [ ] Assistant replies appended back to history
- [ ] Streaming for a responsive feel
- [ ] History trimming / summarization
- [ ] Error handling (and don't leave an orphan user message on failure)
- [ ] Log token usage

## Next steps

- Put it behind a UI (Streamlit / Gradio — see *Python for AI → Build a UI Fast*).
- Turn it into the [Telegram Chatbot project](./projects/01-telegram-chatbot.md).
- Add tools, structured outputs, and streaming properly in *Calling Models*.

## Interview quick-fire

- **"How does a chatbot remember previous messages?"** → It doesn't — the app resends the conversation history in each request.
- **"What happens when a conversation gets too long?"** → Cost and latency grow, and you eventually exceed the context window; trim, summarize, or move facts into external memory.
- **"What's the system prompt for?"** → Developer-level instructions that set persona, rules, and output format for the whole conversation.
