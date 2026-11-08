---
title: "Error Handling & Files (JSON)"
---

## TL;DR

LLM apps fail constantly: networks drop, APIs rate-limit you, models return **broken JSON**. Use **`try/except`** to catch specific errors and recover (retry, fall back, show a friendly message), never a bare `except:` that hides bugs. For files, always use **`with open(...)`** and **`encoding="utf-8"`**. The **`json`** module converts between Python dicts and JSON text, and **`pathlib.Path`** handles paths. Together these let you save chat history, cache responses and load prompt files.

## try / except basics

```python
import json

raw = '{"sentiment": "positive", "score": 0.9'      # model cut off mid-JSON

try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    print(f"Bad JSON from model: {e}")
    data = None
else:
    print("Parsed OK")        # runs only if no exception
finally:
    print("Always runs")      # cleanup: close things, log, etc.
```

```
try ──ok──► else ──► finally
  │
  └─error─► matching except ──► finally
```

## Catching OpenAI SDK errors

```python
import openai
from openai import OpenAI

client = OpenAI()

def ask(prompt: str) -> str | None:
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            timeout=30,
        )
    except openai.RateLimitError:
        print("Rate limited: back off and retry later.")
    except openai.APIConnectionError:
        print("Network problem.")
    except openai.APIStatusError as e:
        print(f"API error {e.status_code}: {e.message}")
    else:
        return response.choices[0].message.content
    return None
```

| Exception | Usually means | Do |
|---|---|---|
| `AuthenticationError` (401) | Bad or missing API key | Fix config; don't retry |
| `RateLimitError` (429) | Too many requests or out of quota | Retry with backoff |
| `APIConnectionError` / `APITimeoutError` | Network | Retry |
| `BadRequestError` (400) | Bad params, context too long | Fix the request; don't retry |
| `InternalServerError` (5xx) | Provider issue | Retry |

Order matters: put specific exceptions before general ones. The SDK already retries some errors (`max_retries`, default 2). Full patterns in [errors, retries & rate limits](../02-calling-models/06-errors-retries-rate-limits.md).

## Raising your own errors

```python
class LLMOutputError(Exception):
    """The model returned something we can't use."""

def parse_label(reply: str) -> str:
    label = reply.strip().lower()
    if label not in {"positive", "negative", "neutral"}:
        raise LLMOutputError(f"Unexpected label: {reply!r}")
    return label
```

Raise early with a clear message; catch at the level that can do something about it (retry the call, return a fallback to the user).

## Files with pathlib and `with`

```python
from pathlib import Path

PROMPTS = Path("prompts")
system_prompt = (PROMPTS / "system.txt").read_text(encoding="utf-8")

out = Path("outputs")
out.mkdir(exist_ok=True)
(out / "summary.md").write_text("# Summary\n...", encoding="utf-8")

for path in Path("docs").glob("*.md"):        # all markdown files
    print(path.name, path.stat().st_size)
```

`with` closes the file even if an error happens:

```python
with open("transcript.txt", "a", encoding="utf-8") as f:     # "a" = append
    f.write(f"user: {question}\nassistant: {reply}\n")
```

Modes: `"r"` read, `"w"` overwrite, `"a"` append, `"rb"/"wb"` binary (audio, images).

## JSON: dicts in and out

| Function | Direction |
|---|---|
| `json.loads(text)` | JSON string → Python |
| `json.dumps(obj)` | Python → JSON string |
| `json.load(f)` | file → Python |
| `json.dump(obj, f)` | Python → file |

Save and load chat history:

```python
import json
from pathlib import Path

HISTORY = Path("history.json")

def load_history() -> list[dict]:
    if not HISTORY.exists():
        return []
    try:
        return json.loads(HISTORY.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []                          # corrupted file: start fresh

def save_history(messages: list[dict]) -> None:
    HISTORY.write_text(json.dumps(messages, indent=2, ensure_ascii=False), encoding="utf-8")
```

`ensure_ascii=False` keeps non-English text readable instead of `ह...` escapes.

### JSONL for datasets and logs

One JSON object per line. Common for fine-tuning data, eval sets and request logs.

```python
with open("log.jsonl", "a", encoding="utf-8") as f:
    f.write(json.dumps({"prompt": prompt, "reply": reply}) + "\n")

with open("log.jsonl", encoding="utf-8") as f:
    rows = [json.loads(line) for line in f if line.strip()]
```

### Cleaning model JSON

Models asked for JSON in plain prompts often wrap it in markdown fences:

```python
def extract_json(text: str) -> dict:
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    return json.loads(text)
```

Better: use [structured outputs](../02-calling-models/04-structured-outputs.md) so you don't have to.

## Gotchas

- **Bare `except:` or `except Exception: pass`** swallows bugs (even typos). Catch specific errors, and log what you catch.
- **Missing `encoding="utf-8"`** causes crashes on Windows with emoji or non-English text.
- **Relative paths** resolve from where you *run* the script, not where the file lives. Use `Path(__file__).parent / "prompts"` for files next to your code.
- **`json.dumps` fails on SDK objects** — convert first with `.model_dump()`.
- **Writing the whole history file on every message** is fine for prototypes; use SQLite once you have many users.

## Key terms

- **Exception** — an error object raised when something goes wrong.
- **`try/except/else/finally`** — catch errors, run code on success, always clean up.
- **Context manager** — an object used with `with` that sets up and tears down (e.g. closes a file).
- **`pathlib.Path`** — object-oriented file paths; `/` joins parts.
- **JSON** — text format for nested objects/arrays; maps to dicts/lists.
- **JSONL** — one JSON object per line.

## Interview quick-fire

- **"Which LLM API errors should you retry?"** → Rate limits, timeouts, connection errors and 5xx. Not auth or bad-request errors.
- **"Why use `with open(...)`?"** → It guarantees the file is closed, even if an exception is raised.
- **"`json.load` vs `json.loads`?"** → `load` reads from a file object; `loads` parses a string.
- **"What's wrong with `except: pass`?"** → It hides every error, including bugs, making failures silent and hard to debug.
