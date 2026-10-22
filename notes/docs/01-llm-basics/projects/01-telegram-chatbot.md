---
title: "Telegram Chatbot (LLM + memory)"
---

## Goal

Build a Telegram bot that chats using an LLM and **remembers each user's conversation separately**. It's the [first chatbot](../08-your-first-chatbot.md) with a real interface and multiple users.

**Skills practiced:** chat history, per-user state, system prompts, history trimming, async Python, secrets handling.

## Architecture

```
Telegram user ──► Telegram servers ──► your bot (python-telegram-bot)
                                             │
                                             ├─ look up history for chat_id
                                             ├─ append user message
                                             ├─ call LLM with full (trimmed) history
                                             ├─ append reply, save history
                                             ▼
Telegram user ◄── Telegram servers ◄── reply text
```

The key idea: one history **per `chat_id`**, so users don't see each other's conversations.

## Setup

1. In Telegram, message **@BotFather** → `/newbot` → copy the bot token.
2. Install:

```bash
pip install python-telegram-bot anthropic python-dotenv
```

3. `.env` (and add `.env` to `.gitignore`):

```
TELEGRAM_BOT_TOKEN=123456:ABC...
ANTHROPIC_API_KEY=sk-ant-...
```

## Code — `bot.py`

```python
import os
from collections import defaultdict

import anthropic
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

load_dotenv()
client = anthropic.AsyncAnthropic()

MODEL = "claude-haiku-5-5"        # fast + cheap is fine for chat
SYSTEM = "You are a helpful, friendly assistant on Telegram. Keep replies short."
MAX_MESSAGES = 20

histories: dict[int, list[dict]] = defaultdict(list)   # chat_id -> messages


def trimmed(messages):
    recent = messages[-MAX_MESSAGES:]
    while recent and recent[0]["role"] != "user":
        recent = recent[1:]
    return recent


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Hi! Ask me anything. /reset clears our chat.")


async def reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    histories.pop(update.effective_chat.id, None)
    await update.message.reply_text("Memory cleared.")


async def chat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    history = histories[chat_id]
    history.append({"role": "user", "content": update.message.text})

    await context.bot.send_chat_action(chat_id, "typing")
    try:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM,
            messages=trimmed(history),
        )
    except anthropic.APIError:
        history.pop()
        await update.message.reply_text("Sorry, something went wrong. Try again.")
        return

    reply = response.content[0].text
    history.append({"role": "assistant", "content": reply})
    await update.message.reply_text(reply)


def main():
    app = Application.builder().token(os.environ["TELEGRAM_BOT_TOKEN"]).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("reset", reset))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, chat))
    app.run_polling()


if __name__ == "__main__":
    main()
```

Run with `python bot.py` and message your bot.

## Making memory survive restarts

The dict above is wiped when the process stops. Persist it with SQLite:

```python
import json, sqlite3

db = sqlite3.connect("history.db")
db.execute("CREATE TABLE IF NOT EXISTS history (chat_id INTEGER PRIMARY KEY, messages TEXT)")

def load(chat_id):
    row = db.execute("SELECT messages FROM history WHERE chat_id = ?", (chat_id,)).fetchone()
    return json.loads(row[0]) if row else []

def save(chat_id, messages):
    db.execute("REPLACE INTO history VALUES (?, ?)", (chat_id, json.dumps(messages)))
    db.commit()
```

## Stretch goals

- [ ] **Summary memory** — when history exceeds N messages, summarize old turns into one message.
- [ ] **Long-term facts** — extract facts ("user is learning Python") and add them to the system prompt.
- [ ] **Personas** — `/persona pirate` swaps the system prompt.
- [ ] **Token/cost logging** per user from `response.usage`.
- [ ] **Rate limiting** per user so one person can't burn your budget.
- [ ] **Voice notes** — transcribe with a speech-to-text API, then reply.
- [ ] **Deploy** — Railway / Render / a small VPS; switch from polling to webhooks.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
