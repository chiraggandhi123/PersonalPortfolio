---
title: "Environments & Packages (venv, pip, requirements)"
---

## TL;DR

Every project gets its **own virtual environment** so its packages don't clash with other projects. Create one with **`python -m venv .venv`**, activate it, install with **`pip`**, and record what you installed in **`requirements.txt`** (or `pyproject.toml`). AI libraries move fast and break things between versions, so **pin versions** for anything you deploy. Newer tools like **uv** and **Poetry** do the same job faster or with lockfiles.

## Why environments

```
system Python
   │
   ├── project-a/.venv   openai 1.x, langchain 0.3
   ├── project-b/.venv   openai 1.y, langchain 1.x, torch
   └── project-c/.venv   transformers, peft
```

Without venvs, upgrading LangChain for one project silently breaks another. Venvs also make your project reproducible: someone else can recreate the exact setup.

## The venv workflow

```bash
python3 -m venv .venv                 # create (once per project)
source .venv/bin/activate             # activate (macOS/Linux)
.venv\Scripts\activate                # activate (Windows)

pip install openai pydantic python-dotenv
pip list                              # what's installed
pip show openai                       # version + dependencies
pip install -U openai                 # upgrade
pip uninstall some-package
deactivate                            # leave the venv
```

Use `python -m pip` if you're ever unsure which pip is running; it always matches the active `python`.

## requirements.txt

```
openai>=1.40,<2
pydantic>=2,<3
python-dotenv
streamlit
```

```bash
pip install -r requirements.txt       # recreate the environment
pip freeze > requirements.txt         # dump exact versions of everything installed
```

| Style | Example | Use for |
|---|---|---|
| Unpinned | `openai` | Quick experiments |
| Range | `openai>=1.40,<2` | Libraries, flexible apps |
| Exact | `openai==1.51.0` | Deploys, reproducible demos |

`pip freeze` pins *everything*, including sub-dependencies. Good for reproducibility, noisy to read. Many people keep a short hand-written `requirements.in` and generate a locked file from it (`pip-tools`, `uv pip compile`).

## pyproject.toml (the modern format)

```toml
[project]
name = "support-bot"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "openai>=1.40",
    "pydantic>=2",
    "python-dotenv",
]

[project.optional-dependencies]
dev = ["pytest", "ruff"]
```

`pip install -e .` installs your project in editable mode; `pip install -e ".[dev]"` adds dev tools.

## Tool landscape

| Tool | What it is | When |
|---|---|---|
| `venv` + `pip` | Built into Python | Learning, simple projects |
| **uv** | Very fast pip/venv/Python-version manager with lockfiles | Day-to-day, if you want speed |
| Poetry | Dependency management + lockfile + packaging | Teams that already use it |
| conda / mamba | Envs that also manage non-Python libs (CUDA, compilers) | Data science, GPU setups |
| Docker | Whole OS-level environment | Deploying |

uv in practice:

```bash
uv init support-bot && cd support-bot
uv add openai pydantic python-dotenv      # updates pyproject.toml + uv.lock
uv run main.py                            # runs inside the project venv
```

## AI-specific packaging notes

- **Heavy packages** — `torch`, `transformers` and CUDA wheels are large and platform-specific. Install PyTorch using the command from its website for your OS/GPU.
- **Optional extras** — many libraries split features: `pip install "langchain-openai"`, `"chromadb"`, `"unstructured[pdf]"`. Quote extras in zsh.
- **Breaking changes** — LangChain, LlamaIndex and provider SDKs rename imports between major versions. When a tutorial's import fails, check which version it targets.
- **Jupyter kernels** — notebooks need to use your venv: `pip install ipykernel` in the venv, then select it as the kernel.

## .gitignore essentials

```
.venv/
__pycache__/
*.pyc
.env
.ipynb_checkpoints/
```

Commit `requirements.txt` / `pyproject.toml` (and lockfiles). Never commit the venv folder.

## Gotchas

- **Venv not activated** → packages install globally or into the wrong Python. Check `which python`.
- **Moving or renaming a venv folder breaks it** — delete and recreate instead.
- **"Works on my machine"** — usually unpinned versions. Pin before deploying.
- **Dependency conflicts** — two packages need incompatible versions of a third. Read pip's error, loosen pins, or split into separate services.
- **Python version matters** — some AI packages lag behind the newest Python release. If installs fail on a brand-new Python, try one version older.

## Key terms

- **Virtual environment** — isolated Python + packages for one project.
- **pip** — the standard package installer.
- **requirements.txt** — list of dependencies for `pip install -r`.
- **pyproject.toml** — standard config file describing a Python project and its dependencies.
- **Lockfile** — exact resolved versions of all dependencies (`uv.lock`, `poetry.lock`).
- **Pinning** — fixing a dependency to a specific version or range.

## Interview quick-fire

- **"How do you make a Python project reproducible?"** → Venv per project, pinned dependencies in a lockfile or `requirements.txt`, a stated Python version, and ideally a Dockerfile.
- **"`pip freeze` vs a hand-written requirements file?"** → `freeze` lists every installed package with exact versions; hand-written lists only direct dependencies, often with ranges.
- **"venv vs conda?"** → venv isolates Python packages; conda also manages non-Python binaries like CUDA, which helps for GPU work.
