---
title: "Automated Content Automation"
---

## Goal

Build a pipeline that **reads a few RSS feeds, picks the most relevant new articles, and drafts social posts about them** (a LinkedIn post and an X thread per article) as Markdown files ready for review. It runs on a schedule with no manual steps, and a human still approves every post. It's a realistic "AI does the first draft" workflow and uses almost every topic in this stage.

**Skills practiced:** HTTP and RSS parsing, Pydantic structured outputs, async LLM calls with a concurrency limit, JSON files for state, error handling, `.env` config, scheduling with cron or GitHub Actions.

## Architecture

```
feeds.txt ──► fetch RSS (feedparser) ──► new items only (seen.json)
                                               │
                                               ▼
                         score relevance (LLM, structured, async x N)
                                               │  keep score >= 7, top 3
                                               ▼
                       draft posts (LLM → Pydantic: linkedin, x_thread, hashtags)
                                               │
                                               ▼
                    drafts/2026-11-08-article-slug.md   +  update seen.json
                                               │
                                               ▼
                                  you review, edit and post
```

Two LLM steps: a cheap **filter** for every item, then a more careful **writer** for the few that pass.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install openai pydantic python-dotenv feedparser
```

`.env` (gitignored):

```
OPENAI_API_KEY=sk-...
```

`feeds.txt`: one RSS/Atom URL per line, for blogs or news sites you follow.

`profile.txt`: who you are and what your audience cares about, e.g. "AI engineer writing for developers learning to build LLM apps. Practical, no hype."

## Code

### `models.py`: schemas for LLM outputs

```python
from pydantic import BaseModel, Field


class Relevance(BaseModel):
    reason: str = Field(description="One sentence on why it does or doesn't fit the audience")
    score: int = Field(description="0-10, how relevant and useful for the audience")


class Drafts(BaseModel):
    linkedin: str = Field(description="LinkedIn post, 80-150 words, hook in first line, no hashtags inline")
    x_thread: list[str] = Field(description="2-4 tweets, each under 270 characters")
    hashtags: list[str] = Field(description="3-5 relevant hashtags without the # sign")
```

### `pipeline.py`

```python
import asyncio
import json
import re
from datetime import date
from pathlib import Path

import feedparser
import openai
from dotenv import load_dotenv
from openai import AsyncOpenAI

from models import Drafts, Relevance

load_dotenv()
client = AsyncOpenAI()

MODEL = "gpt-4o-mini"
ROOT = Path(__file__).parent
SEEN_FILE = ROOT / "seen.json"
DRAFTS = ROOT / "drafts"
PROFILE = (ROOT / "profile.txt").read_text(encoding="utf-8")
MIN_SCORE, MAX_POSTS = 7, 3
sem = asyncio.Semaphore(5)                       # max concurrent API calls


def load_seen() -> set[str]:
    return set(json.loads(SEEN_FILE.read_text())) if SEEN_FILE.exists() else set()


def fetch_new_items(seen: set[str]) -> list[dict]:
    items = []
    for url in (ROOT / "feeds.txt").read_text().split():
        feed = feedparser.parse(url)
        for e in feed.entries[:10]:
            link = e.get("link")
            if link and link not in seen:
                summary = re.sub(r"<[^>]+>", "", e.get("summary", ""))[:1500]   # strip HTML
                items.append({"title": e.get("title", ""), "link": link, "summary": summary})
    return items


async def structured(model_cls, system: str, user: str):
    async with sem:
        completion = await client.chat.completions.parse(
            model=MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format=model_cls,
        )
    return completion.choices[0].message.parsed      # None on refusal


async def score(item: dict) -> tuple[dict, int]:
    system = f"You curate content for this audience:\n{PROFILE}\nRate the article."
    try:
        r = await structured(Relevance, system, f"{item['title']}\n\n{item['summary']}")
    except openai.APIError as e:
        print(f"score failed for {item['link']}: {e}")
        return item, 0
    return item, r.score if r else 0


async def draft(item: dict) -> Drafts | None:
    system = (
        f"You write social posts for this author:\n{PROFILE}\n"
        "Be specific, plain and useful. No hype words, no emoji spam. "
        "Only use facts from the article text provided."
    )
    user = f"Title: {item['title']}\nLink: {item['link']}\n\n{item['summary']}"
    return await structured(Drafts, system, user)


def save_draft(item: dict, d: Drafts) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", item["title"].lower()).strip("-")[:60]
    path = DRAFTS / f"{date.today()}-{slug}.md"
    thread = "\n\n".join(f"{i}/ {t}" for i, t in enumerate(d.x_thread, 1))
    tags = " ".join(f"#{h}" for h in d.hashtags)
    path.write_text(
        f"# {item['title']}\n\nSource: {item['link']}\n\n"
        f"## LinkedIn\n\n{d.linkedin}\n\n{tags}\n\n## X thread\n\n{thread}\n",
        encoding="utf-8",
    )
    return path


async def main():
    DRAFTS.mkdir(exist_ok=True)
    seen = load_seen()
    items = fetch_new_items(seen)
    print(f"{len(items)} new items")

    scored = await asyncio.gather(*(score(i) for i in items))
    picked = sorted((s for s in scored if s[1] >= MIN_SCORE), key=lambda s: -s[1])[:MAX_POSTS]

    drafts = await asyncio.gather(*(draft(item) for item, _ in picked))
    for (item, s), d in zip(picked, drafts):
        if d:
            print(f"[{s}] {save_draft(item, d).name}")

    seen |= {i["link"] for i in items}               # don't re-score these next run
    SEEN_FILE.write_text(json.dumps(sorted(seen), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
```

Run with `python pipeline.py`, then open the `drafts/` folder.

### Scheduling: GitHub Actions

`.github/workflows/content.yml`:

```yaml
name: content-drafts
on:
  schedule:
    - cron: "30 3 * * *"          # daily, 03:30 UTC
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install openai pydantic python-dotenv feedparser
      - run: python pipeline.py
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - run: |
          git config user.name "content-bot"
          git config user.email "bot@users.noreply.github.com"
          git add drafts seen.json && git commit -m "New drafts" || echo "nothing new"
          git push
```

Locally, a cron line does the same: `30 9 * * * cd ~/content-bot && .venv/bin/python pipeline.py`.

## How it works

1. **Fetch** — `feedparser` handles RSS and Atom. Each entry's link is its ID; anything in `seen.json` is skipped, so each article is processed once.
2. **Filter cheaply** — every new item gets a short `Relevance` call. `reason` comes before `score` in the schema so the model explains itself before committing to a number.
3. **Concurrency** — `asyncio.gather` runs all scoring calls together; the semaphore keeps at most 5 in flight to stay under rate limits.
4. **Draft carefully** — only the top few items get the more expensive writing call. Pydantic guarantees we get exactly a LinkedIn post, a list of tweets and hashtags, so `save_draft` never has to parse free text.
5. **Human in the loop** — output is Markdown for review, never auto-posted. The prompt says "only use facts from the article", but the model only sees a summary, so check claims before posting.
6. **State** — `seen.json` is the pipeline's memory. In GitHub Actions it's committed back to the repo after each run.

## Stretch goals

- [ ] **Full article text** — fetch the page and extract the main content (e.g. `trafilatura`) instead of the RSS summary.
- [ ] **Your voice** — add 3-5 of your past posts as few-shot examples in the writer prompt.
- [ ] **Validation rules** — a Pydantic validator that rejects tweets over 280 characters, then retry.
- [ ] **Review UI** — a Streamlit page listing drafts with Approve / Edit / Reject buttons.
- [ ] **Notify** — send new drafts to Telegram, Slack or email each morning.
- [ ] **Auto-post approved drafts** through the platform APIs (respect their terms).
- [ ] **Cost log** — sum `usage` tokens per run and write them to a JSONL file.
- [ ] **Dedup similar stories** — embed titles and skip near-duplicates from different feeds.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
