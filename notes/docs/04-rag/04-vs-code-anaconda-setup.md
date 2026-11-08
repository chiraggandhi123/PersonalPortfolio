---
title: "VS Code & Anaconda Setup"
---

## TL;DR

Give every project its **own isolated Python environment** so library versions don't clash. This note uses **VS Code** as the editor and **conda** (Anaconda or the lighter Miniconda) for environments. **uv** and plain **venv** are good alternatives. The checklist: create the env, install packages from `requirements.txt`, keep API keys in `.env`, and point VS Code and Jupyter at the **right interpreter**.

## What you need

| Tool | Why |
|---|---|
| VS Code | Editor, terminal, debugger and notebooks in one place |
| Python extension (+ Pylance) | Interpreter selection, autocomplete, linting |
| Jupyter extension | Run `.ipynb` notebooks inside VS Code |
| Miniconda or Anaconda | Creates isolated Python environments |
| Git | Version control (keep `.env` out of it) |

**Anaconda vs. Miniconda:** Anaconda ships hundreds of preinstalled packages and a GUI. Miniconda is just `conda` + Python. For AI projects, Miniconda is usually enough, since you install what each project needs.

## Create the environment with conda

```bash
# create and activate a project env
conda create -n rag python=3.11 -y
conda activate rag

# check you are using the env's Python
which python          # macOS/Linux → .../envs/rag/bin/python
python --version
```

Pick a Python version your libraries support. A version one or two releases behind the newest is safest for AI packages.

## Install packages

Keep dependencies in a `requirements.txt` at the project root:

```
langchain
langchain-core
langchain-community
langchain-openai
langchain-chroma
langchain-text-splitters
faiss-cpu
pypdf
python-dotenv
ipykernel
```

```bash
pip install -r requirements.txt
```

Inside a conda env, using `pip` for these packages is normal: most LangChain integrations are published on PyPI first. Install the few things you want from conda (e.g. Python itself) first, then use pip.

## API keys in `.env`

```
OPENAI_API_KEY=sk-...
LANGSMITH_API_KEY=lsv2-...
LANGSMITH_TRACING=true
```

```python
from dotenv import load_dotenv
load_dotenv()            # reads .env into environment variables; OpenAI/LangChain pick them up
```

Add `.env` to `.gitignore` before your first commit.

## Connect VS Code to the env

1. Open the project folder: **File → Open Folder**.
2. **Cmd/Ctrl + Shift + P → "Python: Select Interpreter"** → choose the `rag` env.
3. Open a new terminal (**Terminal → New Terminal**). It should show `(rag)` in the prompt.
4. In a notebook, click **Select Kernel** (top right) → pick the same env.

If the env doesn't show in the kernel list, register it:

```bash
python -m ipykernel install --user --name rag --display-name "Python (rag)"
```

## Suggested project layout

```
rag-project/
├── .env                 # secrets, git-ignored
├── .gitignore
├── requirements.txt
├── data/                # raw PDFs, docs
├── notebooks/           # experiments
├── src/
│   ├── ingest.py        # load → chunk → embed → store
│   └── query.py         # retrieve → generate
└── chroma_db/           # persisted vector store, git-ignored
```

## Alternatives: uv and venv

| Tool | Create env | Install | When to use |
|---|---|---|---|
| conda | `conda create -n rag python=3.11` | `pip install -r requirements.txt` | Need non-Python deps (CUDA, system libs), data-science habits |
| venv | `python -m venv .venv` | `pip install -r requirements.txt` | Zero extra tools; Python already installed |
| uv | `uv venv` or `uv init` | `uv pip install -r requirements.txt` / `uv add langchain` | Fast installs, lockfiles, can install Python versions itself |

```bash
# venv
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate

# uv (project with pyproject.toml + lockfile)
uv init rag-project && cd rag-project
uv add langchain-openai langchain-chroma python-dotenv
uv run python src/query.py
```

VS Code detects a `.venv` folder in the project root automatically.

## Gotchas

- **Wrong interpreter** is the top cause of `ModuleNotFoundError`. Check the interpreter shown in the VS Code status bar and the notebook kernel.
- **Installing into base.** Always `conda activate` first. Keep `base` clean.
- **Notebook kernel differs from terminal.** Installing in the terminal does not help if the notebook uses another kernel. In a notebook, `%pip install pkg` installs into the running kernel.
- **faiss on Apple Silicon / Windows.** Use `faiss-cpu` from pip; if it fails, `conda install -c conda-forge faiss-cpu`.
- **Pin versions** once something works (`pip freeze > requirements.txt` or a uv lockfile). LangChain packages change often.

## Key terms

- **Virtual environment** — an isolated Python install with its own packages.
- **conda** — package and environment manager from Anaconda; handles Python and non-Python dependencies.
- **Interpreter** — the specific Python executable VS Code uses to run your code.
- **Kernel** — the process that executes notebook cells; must point to your env.
- **uv** — a fast Rust-based Python package and project manager.
- **requirements.txt** — file listing the packages a project needs.

## Interview quick-fire

- **"Why use a virtual environment per project?"** → Different projects need different library versions; isolation prevents conflicts and makes setups reproducible.
- **"conda vs. venv?"** → venv only isolates Python packages; conda also manages the Python version and non-Python libraries like CUDA.
- **"How do you keep API keys out of code?"** → Store them in a git-ignored `.env`, load with `python-dotenv`, and use a secret manager in production.
