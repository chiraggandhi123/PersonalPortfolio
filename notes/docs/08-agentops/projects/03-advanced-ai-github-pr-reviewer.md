---
title: "Advanced AI GitHub PR Reviewer"
---

## Goal

Build a bot that **reviews every pull request automatically**: it reads the diff, asks an LLM for concrete issues, and posts **inline review comments on the exact changed lines** plus a summary. It runs as a **GitHub Action**, so there's no server to host. The "advanced" parts are structured output, validating that each comment points to a real changed line, chunking big diffs, and skipping noise.

**Skills practiced:** GitHub Actions, GitHub REST API, diff parsing, structured outputs, chunking, prompt design for code review, cost control, CI permissions.

## Architecture

```
PR opened / updated
      │
      ▼
GitHub Action (pull_request event)
      │  GITHUB_TOKEN, OPENAI_API_KEY
      ▼
review.py
  ├─ GET /pulls/:n/files          → changed files + patch hunks
  ├─ filter (lock files, generated, huge files)
  ├─ parse hunks → set of commentable (path, line)
  ├─ per file: LLM → ReviewComment[] (structured output)
  ├─ drop comments on lines not in the diff, dedupe, cap count
  └─ POST /pulls/:n/reviews       → summary + inline comments
```

## Setup

```bash
pip install openai requests pydantic
```

Repo secrets: **Settings → Secrets and variables → Actions → New secret** `OPENAI_API_KEY`. `GITHUB_TOKEN` is provided by Actions automatically. For local testing, a `.env` with `GITHUB_TOKEN` (a fine-grained token with pull request write access), `OPENAI_API_KEY`, `REPO=owner/name` and `PR_NUMBER=12`.

## Code — `.github/workflows/ai-review.yml`

```yaml
name: ai-review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install openai requests pydantic
      - run: python .github/scripts/review.py
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          REPO: ${{ github.repository }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
```

Note: secrets aren't passed to workflows triggered by PRs from forks, which is good; don't work around it with `pull_request_target` unless you understand the risk.

## Code — `.github/scripts/review.py`

```python
import os, re, requests
from typing import Literal
from pydantic import BaseModel, Field
from openai import OpenAI

REPO, PR = os.environ["REPO"], os.environ["PR_NUMBER"]
API = f"https://api.github.com/repos/{REPO}"
HEADERS = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
           "Accept": "application/vnd.github+json"}
SKIP = re.compile(r"(\.lock$|package-lock\.json$|\.min\.js$|^dist/|\.svg$)")
MAX_PATCH_CHARS, MAX_COMMENTS = 12_000, 15
client = OpenAI()

class ReviewComment(BaseModel):
    line: int = Field(description="Line number in the NEW file, must be an added line")
    severity: Literal["bug", "security", "performance", "maintainability"]
    comment: str = Field(description="Specific problem and a concrete fix, under 60 words")

class FileReview(BaseModel):
    comments: list[ReviewComment]

SYSTEM = """You are a senior engineer reviewing a pull request diff.
Report only real problems: bugs, security issues, performance traps, unclear logic.
Do NOT comment on style, formatting or naming unless it causes bugs.
Do not praise. If the change looks fine, return an empty list.
Lines in the diff are prefixed with their new-file line number."""

def added_lines(patch: str) -> dict[int, str]:
    """Map new-file line number -> text for every '+' line in a unified diff patch."""
    lines, new_no = {}, 0
    for raw in patch.splitlines():
        if m := re.match(r"@@ -\d+(?:,\d+)? \+(\d+)", raw):
            new_no = int(m.group(1))
        elif raw.startswith("+"):
            lines[new_no] = raw[1:]
            new_no += 1
        elif not raw.startswith("-"):
            new_no += 1
    return lines

def review_file(path: str, patch: str) -> list[dict]:
    added = added_lines(patch)
    numbered = "\n".join(f"{n}: {t}" for n, t in added.items())
    resp = client.chat.completions.parse(
        model="gpt-4o-mini",
        temperature=0,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"File: {path}\n\nAdded lines:\n{numbered}"}],
        response_format=FileReview,
    )
    parsed = resp.choices[0].message.parsed
    return [
        {"path": path, "line": c.line, "side": "RIGHT",
         "body": f"**{c.severity}**: {c.comment}"}
        for c in (parsed.comments if parsed else [])
        if c.line in added                      # drop hallucinated line numbers
    ]

def main():
    files = requests.get(f"{API}/pulls/{PR}/files?per_page=100", headers=HEADERS).json()
    comments = []
    for f in files:
        patch = f.get("patch")
        if not patch or SKIP.search(f["filename"]) or len(patch) > MAX_PATCH_CHARS:
            continue
        comments += review_file(f["filename"], patch)

    comments = comments[:MAX_COMMENTS]
    body = (f"AI review: {len(comments)} comment(s) on {len(files)} file(s). "
            "Automated suggestions; use your judgment.")
    r = requests.post(f"{API}/pulls/{PR}/reviews", headers=HEADERS, json={
        "commit_id": os.environ.get("HEAD_SHA"),
        "event": "COMMENT",                     # never APPROVE or REQUEST_CHANGES automatically
        "body": body,
        "comments": comments,
    })
    r.raise_for_status()

if __name__ == "__main__":
    main()
```

## How it works

1. **Trigger** — the workflow runs on PR open and every new push (`synchronize`), skipping drafts.
2. **Fetch** — the files endpoint returns each changed file with its unified-diff `patch`.
3. **Filter** — lock files, minified and generated files, and huge patches are skipped to save tokens and avoid noise.
4. **Number lines** — `added_lines` walks the hunk headers (`@@ -a,b +c,d @@`) to map each added line to its new-file line number. The model sees only those lines, numbered.
5. **Structured review** — Pydantic forces a list of `{line, severity, comment}`; an empty list is a valid "looks fine".
6. **Validate** — comments on lines that aren't added lines are dropped. GitHub rejects the whole review if any comment points outside the diff, so this check matters.
7. **Post** — one review with `event: COMMENT`, so the bot never blocks or approves merges.

## Stretch goals

- [ ] **More context** — include the full file (or surrounding functions) so the model understands the change, not just the added lines.
- [ ] **Repo conventions** — load a `REVIEW_GUIDELINES.md` from the repo into the system prompt.
- [ ] **Two-pass review** — a cheap model drafts comments, a stronger model filters false positives.
- [ ] **Don't repeat itself** — on new pushes, fetch existing bot comments and skip duplicates.
- [ ] **Chat back** — respond when someone replies "@bot explain" to a comment.
- [ ] **Tools** — let an agent run tests or grep the repo before commenting (sandboxed).
- [ ] **Measure it** — track the share of comments that get resolved vs dismissed as a precision metric.
- [ ] **GitHub App** — package it as an app with its own identity and webhook server.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
