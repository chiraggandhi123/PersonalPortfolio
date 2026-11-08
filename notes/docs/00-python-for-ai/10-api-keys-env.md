---
title: "API Keys & .env (never hard-code secrets)"
---

## TL;DR

An **API key** is a password that spends your money. **Never put it in code** or commit it to Git; bots scan GitHub for leaked keys within minutes. Store keys in **environment variables**, use a **`.env` file** locally (loaded with `python-dotenv`) that is listed in **`.gitignore`**, and use your platform's **secrets manager** in production. SDKs like `openai` read `OPENAI_API_KEY` from the environment automatically.

## Where keys live

```
local dev:     .env file ──load_dotenv()──► os.environ ──► OpenAI()
production:    platform secrets (Render, Railway, AWS, GitHub Actions) ──► os.environ ──► OpenAI()
```

Your code reads `os.environ` the same way in both places. Only the source changes.

## The .env pattern

`.env` (project root):

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
MODEL=gpt-4o-mini
```

`.gitignore`:

```
.env
.env.*
!.env.example
```

`.env.example` (committed, no real values, documents what's needed):

```
OPENAI_API_KEY=
MODEL=gpt-4o-mini
```

```bash
pip install python-dotenv
```

```python
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()                                   # loads .env into os.environ (won't overwrite existing vars)

client = OpenAI()                               # reads OPENAI_API_KEY automatically
model = os.getenv("MODEL", "gpt-4o-mini")       # optional value with default
tavily_key = os.environ["TAVILY_API_KEY"]       # required: KeyError if missing
```

| Access | Missing key behaviour | Use for |
|---|---|---|
| `os.environ["X"]` | Raises `KeyError` | Required secrets: fail fast |
| `os.getenv("X")` | Returns `None` | Optional settings |
| `os.getenv("X", "default")` | Returns default | Settings with sensible defaults |

## Fail fast with validation

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")
    openai_api_key: SecretStr                  # hidden in logs and repr
    model: str = "gpt-4o-mini"

settings = Settings()
print(settings)                                # openai_api_key=SecretStr('**********')
key = settings.openai_api_key.get_secret_value()
```

A missing key crashes at startup with a clear message instead of on the first user request.

## Setting env vars without .env

```bash
export OPENAI_API_KEY="sk-..."      # macOS/Linux, current shell only
setx OPENAI_API_KEY "sk-..."        # Windows, persists for new shells
OPENAI_API_KEY=sk-... python main.py   # one command only
```

In Streamlit, local secrets go in `.streamlit/secrets.toml` (also gitignored) and are read with `st.secrets["OPENAI_API_KEY"]`. In GitHub Actions, add them under repo **Settings → Secrets** and reference `${{ secrets.OPENAI_API_KEY }}` in the workflow.

## If you leak a key

1. **Revoke it immediately** in the provider dashboard. Deleting the commit is not enough; Git history and forks keep it.
2. Create a new key and update your `.env` / secrets.
3. Check usage for unexpected spend.
4. Optionally scrub history (`git filter-repo`) and enable GitHub secret scanning / push protection.

## Good habits

- **One key per project/environment** — easy to revoke one without breaking everything.
- **Set spend limits** and usage alerts in the provider dashboard.
- **Never send keys to the browser** — frontend code is public. Call the LLM from your backend.
- **Don't log full requests** that include auth headers; mask keys if you must print them (`key[:6] + "..."`).
- **Never paste keys into prompts**, notebooks you share, screenshots or issue trackers.
- **Run a pre-commit secret scanner** (`gitleaks`, `detect-secrets`) on bigger projects.

## Gotchas

- **`load_dotenv()` doesn't find the file** — it searches from the current working directory upward. Run from the project root or pass a path: `load_dotenv(Path(__file__).parent / ".env")`.
- **Stale value** — `load_dotenv()` doesn't override variables already set in your shell. Use `override=True` if needed, or open a fresh terminal.
- **Quotes and spaces** — `KEY = value` with spaces can confuse some loaders. Write `KEY=value`.
- **Committed `.env` before adding to `.gitignore`** — gitignore doesn't untrack files. Run `git rm --cached .env` and rotate the key.
- **Notebook outputs** can contain printed keys. Clear outputs before committing.

## Key terms

- **API key** — secret token that authenticates you to a service and bills your account.
- **Environment variable** — key-value setting provided to a process by its environment.
- **`.env` file** — local file of `KEY=value` lines loaded into the environment during development.
- **`python-dotenv`** — library that loads `.env` files.
- **Secrets manager** — a platform service that stores secrets and injects them at runtime.
- **Key rotation** — replacing a key with a new one and revoking the old.

## Interview quick-fire

- **"How do you manage API keys in a Python app?"** → Environment variables; `.env` + `python-dotenv` locally (gitignored), a secrets manager in production, validated at startup.
- **"You pushed a key to GitHub. What now?"** → Revoke it immediately, issue a new one, check usage, then clean history. Removing the commit alone doesn't help.
- **"Can a frontend call the OpenAI API directly?"** → Not with your key; anything in the browser is public. Proxy through a backend.
