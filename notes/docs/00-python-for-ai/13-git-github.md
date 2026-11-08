---
title: "Git & GitHub (commit, push, README)"
---

## TL;DR

**Git** tracks changes to your code locally; **GitHub** hosts your repos online so you can back them up, share them and show them to employers. The daily loop is **edit → `git add` → `git commit` → `git push`**. Use **branches** for experiments (a new prompt strategy, a framework swap), write a **README** that lets someone run your project in five minutes, and keep **secrets and venvs out** with `.gitignore`. For AI engineers, a GitHub profile of small, working LLM projects is often the portfolio.

## Mental model

```
working dir ──git add──► staging area ──git commit──► local repo ──git push──► GitHub
     ▲                                                      │
     └──────────────────────── git pull ◄───────────────────┘
```

| Term | Meaning |
|---|---|
| Repository (repo) | A project folder tracked by Git (`.git/` inside) |
| Commit | A saved snapshot with a message |
| Staging area | Changes selected for the next commit |
| Branch | A movable line of commits; `main` is the default |
| Remote | A copy of the repo elsewhere, usually `origin` on GitHub |

## First-time setup

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

Authenticate with GitHub using the **GitHub CLI** (`gh auth login`) or an SSH key.

## Starting a project

```bash
cd support-bot
git init
```

`.gitignore` first, before the first commit:

```
.venv/
__pycache__/
.env
.streamlit/secrets.toml
*.ipynb_checkpoints
data/raw/
chroma_db/
*.log
```

```bash
git add .
git status                      # check: no .env, no .venv in the list!
git commit -m "Initial commit: CLI chatbot with OpenAI"
gh repo create support-bot --public --source=. --push     # or create on github.com and:
# git remote add origin git@github.com:you/support-bot.git && git push -u origin main
```

## The daily loop

```bash
git status                      # what changed?
git diff                        # see the exact changes
git add app.py prompts/         # stage specific files
git commit -m "Add retry on rate limit errors"
git push
```

Write commit messages that say **what and why**: "Switch to structured outputs for ticket triage", not "fix" or "update".

## Branches for experiments

```bash
git switch -c try-langgraph     # new branch
# ...edit, commit...
git switch main                 # back to stable
git merge try-langgraph         # keep it
git branch -d try-langgraph     # or delete it if the experiment failed
```

On GitHub, push the branch and open a **pull request** to review the diff before merging, even on solo projects. It's a good habit and shows up well on your profile.

## Undoing things

| Situation | Command |
|---|---|
| Discard unstaged edits to a file | `git restore app.py` |
| Unstage a file | `git restore --staged app.py` |
| Fix the last commit message / add a forgotten file | `git commit --amend` (before pushing) |
| Undo a pushed commit safely | `git revert <sha>` |
| Stop tracking a file you committed by mistake | `git rm --cached .env` |
| See history | `git log --oneline --graph` |

If you committed an API key: **revoke the key first**. Removing it from Git doesn't make it safe again. See [API keys & .env](./10-api-keys-env.md).

## A README that gets read

```markdown
# Support Ticket Triage Bot

Classifies support emails into category + priority using gpt-4o-mini and structured outputs.

## Demo
![screenshot](docs/screenshot.png)

## Quickstart
    git clone https://github.com/you/support-bot && cd support-bot
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # add your OPENAI_API_KEY
    streamlit run app.py

## How it works
Email → prompt + Pydantic schema → OpenAI → validated Ticket → UI

## Limitations / next steps
- No eval set yet
- English only
```

For AI projects, also state: which model(s), rough cost per run, what data it needs, and known failure modes.

## What not to commit

| Don't commit | Instead |
|---|---|
| `.env`, keys, tokens | `.env.example` with blank values |
| `.venv/`, `node_modules/` | `requirements.txt` / `pyproject.toml` |
| Large models, datasets, vector DBs | Download scripts, Hugging Face Hub, Git LFS if you must |
| Notebook outputs with secrets or huge plots | Clear outputs first |

GitHub rejects files over 100 MB; large binaries bloat history forever.

## Gotchas

- **`git add .` before `.gitignore`** — everything gets staged, including `.env`. Always check `git status`.
- **Commit early, commit often** — small commits make it easy to find which prompt change broke things.
- **Merge conflicts** — Git marks both versions in the file; edit to keep the right one, then `add` and `commit`.
- **Pull before you push** when working from two machines, or you'll get a rejected push.
- **Don't force-push** to shared branches.

## Key terms

- **Git** — distributed version control system tracking changes to files.
- **GitHub** — hosting service for Git repos with pull requests, issues and Actions.
- **Commit** — a snapshot of staged changes with a message and an ID (SHA).
- **Branch** — an independent line of development.
- **Pull request (PR)** — a request to merge one branch into another, with review.
- **`.gitignore`** — file listing paths Git should not track.

## Interview quick-fire

- **"`git pull` vs `git fetch`?"** → `fetch` downloads remote changes without touching your files; `pull` fetches and merges them into your branch.
- **"How do you undo a commit that's already pushed?"** → `git revert` it, which adds a new commit reversing the changes without rewriting history.
- **"What goes in `.gitignore` for an LLM project?"** → `.env`, the venv, caches, local vector DBs, large data and model files.
- **"What makes a good project README?"** → One-line purpose, demo, copy-paste quickstart, how it works, and limitations.
