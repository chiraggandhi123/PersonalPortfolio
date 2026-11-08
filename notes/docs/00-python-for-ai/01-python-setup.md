---
title: "Python Setup (VS Code, first script)"
---

## TL;DR

You need three things: a **recent Python 3** (3.11+ is a safe floor for AI libraries), an **editor** (VS Code with the Python extension), and a **virtual environment per project**. Install Python from python.org or a version manager, not the system Python your OS uses for itself. Then write a first script that calls an LLM, so you know the whole toolchain works end to end.

## What you're installing

| Piece | Why | Check it |
|---|---|---|
| Python 3.11+ | Most AI SDKs drop old versions quickly | `python3 --version` |
| pip | Installs packages from PyPI | `python3 -m pip --version` |
| VS Code + Python extension | Editing, debugging, picks up your venv | Bottom-right shows the interpreter |
| A terminal | You'll run everything from here | macOS Terminal, Windows Terminal, etc. |

### Installing Python

- **macOS** — `brew install python@3.12`, or the python.org installer. Don't use the Apple-provided Python for projects.
- **Windows** — the python.org installer; tick **"Add python.exe to PATH"**. The `py` launcher (`py -3.12`) picks versions.
- **Linux** — your package manager, or `pyenv` if you need several versions.
- **uv** — a fast all-in-one tool that can install Python *and* manage venvs (`uv python install 3.12`). Worth trying once you know the basics.

## Project layout

```
my-first-ai-app/
├── .venv/            # virtual environment (never commit)
├── .env              # API keys (never commit)
├── .gitignore
├── requirements.txt
└── main.py
```

```bash
mkdir my-first-ai-app && cd my-first-ai-app
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install openai python-dotenv
```

When the venv is active, your prompt shows `(.venv)` and `python` points inside it. More in [Environments & Packages](./09-environments-packages.md).

## VS Code setup

1. Install the **Python** extension (Microsoft). It brings Pylance for autocomplete and type hints.
2. `Cmd/Ctrl+Shift+P` → **Python: Select Interpreter** → choose `.venv`.
3. New terminals in VS Code now auto-activate the venv.
4. Optional: **Ruff** extension for linting and formatting, **Jupyter** for notebooks.

Press `F5` to run the current file under the debugger. Breakpoints are the fastest way to inspect a messy LLM response.

## First script: hello, LLM

`.env`:

```
OPENAI_API_KEY=sk-...
```

`main.py`:

```python
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()                      # reads .env into environment variables
client = OpenAI()                  # picks up OPENAI_API_KEY automatically

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Say hello to a new Python learner in one line."}],
)
print(response.choices[0].message.content)
```

```bash
python main.py
```

If this prints a greeting, your Python, venv, packages and API key all work.

## Scripts vs. notebooks vs. REPL

| Tool | Good for | Weak at |
|---|---|---|
| REPL (`python`) | Trying one line, checking a value | Anything longer than a few lines |
| Jupyter notebook | Exploring data, prompt experiments, showing outputs | Hidden state, running cells out of order |
| `.py` script | Real apps, things you rerun, things you deploy | Quick visual exploration |

A common flow: prototype a prompt in a notebook, then move the working code into a `.py` file.

## Gotchas

- **`python` vs `python3`** — on macOS/Linux `python` may not exist outside a venv. Inside an active venv both work.
- **"ModuleNotFoundError: openai"** — you installed into a different Python. Check `which python` (or `where python`) and make sure the venv is active.
- **Wrong interpreter in VS Code** — red squiggles on imports that do run in the terminal mean VS Code picked another interpreter.
- **Don't name your file `openai.py`** — it shadows the real package and imports break.
- **Never `sudo pip install`** — it pollutes the system Python. Use a venv.

## Key terms

- **Interpreter** — the program (`python`) that runs your code.
- **Virtual environment (venv)** — an isolated folder of packages for one project.
- **pip** — Python's package installer, pulling from PyPI.
- **PyPI** — the public package index where `openai`, `pydantic`, etc. live.
- **REPL** — Read-Eval-Print Loop, the interactive `>>>` prompt.

## Interview quick-fire

- **"Why use a virtual environment?"** → Each project gets its own package versions, so upgrading one project's `openai` doesn't break another.
- **"How do you check which Python is running?"** → `which python` / `python --version`, or `import sys; print(sys.executable)`.
- **"Script or notebook for an LLM app?"** → Notebook to explore prompts; script (or package) for anything you rerun, test or deploy.
