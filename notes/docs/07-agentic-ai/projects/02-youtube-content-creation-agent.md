---
title: "YouTube Content Creation Agent"
---

## Goal

Build a small agent crew that takes a **topic** (and optionally a reference video URL) and produces a ready-to-film package: **title options, a hook, a script outline, a description with chapters, tags and a thumbnail idea**. It uses [CrewAI](../03-crewai.md) with three role agents in sequence and returns structured output you can save as JSON.

**Skills practiced:** CrewAI agents/tasks/crews, custom tools, task context passing, Pydantic structured output, prompt design for creative tasks.

## Architecture

```
inputs: topic, audience, reference_url (optional)
        │
        ▼
┌──────────────┐  transcript tool   ┌──────────────┐          ┌──────────────┐
│  Researcher  │ ─────────────────► │  Scriptwriter │ ───────► │  SEO / Packager│
│ key points,  │   research notes   │ hook + outline│  script  │ titles, desc,  │
│ angles, gaps │                    │ (timed beats) │          │ tags, thumbnail│
└──────────────┘                    └──────────────┘          └──────┬───────┘
                                                                     ▼
                                                     VideoPackage (Pydantic) → package.json
```

## Setup

```bash
pip install crewai youtube-transcript-api python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

CrewAI and `youtube-transcript-api` both change their APIs between versions; if a call below fails, check the current docs.

## Code — `crew.py`

```python
import json
import re

from crewai import Agent, Crew, Process, Task
from crewai.tools import tool
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from youtube_transcript_api import YouTubeTranscriptApi

load_dotenv()
LLM = "gpt-4o-mini"


@tool("YouTube transcript")
def youtube_transcript(url: str) -> str:
    """Fetch the transcript text of a YouTube video from its URL."""
    match = re.search(r"(?:v=|youtu\.be/)([\w-]{11})", url)
    if not match:
        return "Error: could not find a video id in that URL."
    try:
        fetched = YouTubeTranscriptApi().fetch(match.group(1))
        text = " ".join(s.text for s in fetched)
    except Exception as e:
        return f"Error: transcript unavailable ({e})"
    return text[:12000]                     # keep the context small


class Chapter(BaseModel):
    timestamp: str = Field(description="mm:ss")
    title: str


class VideoPackage(BaseModel):
    titles: list[str] = Field(description="5 title options, under 60 characters each")
    hook: str = Field(description="First 15 seconds, spoken")
    outline: list[str] = Field(description="Script beats in order")
    description: str
    chapters: list[Chapter]
    tags: list[str] = Field(description="10-15 search tags")
    thumbnail_idea: str = Field(description="Visual + max 4 words of text")


researcher = Agent(
    role="Content Researcher",
    goal="Find the most useful points and fresh angles on {topic} for {audience}",
    backstory="You study what viewers already know and what they still get wrong.",
    tools=[youtube_transcript], llm=LLM, allow_delegation=False,
)
writer = Agent(
    role="YouTube Scriptwriter",
    goal="Write a tight, engaging script outline about {topic}",
    backstory="You write for retention: strong hook, one idea per beat, no filler.",
    llm=LLM, allow_delegation=False,
)
packager = Agent(
    role="YouTube SEO Specialist",
    goal="Package the video so the right viewers click",
    backstory="You write honest, specific titles. No clickbait that the video can't back up.",
    llm=LLM, allow_delegation=False,
)

research = Task(
    description=("Research {topic} for {audience}. If a reference video is given ({reference_url}), "
                 "read its transcript and note what it covers and what it misses."),
    expected_output="8-12 bullet key points, 3 unique angles, and common misconceptions.",
    agent=researcher,
)
script = Task(
    description="Using the research, write a hook and a 6-10 beat outline for an 8-minute video.",
    expected_output="A hook paragraph and a numbered outline with approximate timestamps.",
    agent=writer, context=[research],
)
package = Task(
    description="Create the full publishing package from the script.",
    expected_output="All fields of the VideoPackage schema.",
    agent=packager, context=[research, script], output_pydantic=VideoPackage,
)

crew = Crew(agents=[researcher, writer, packager], tasks=[research, script, package],
            process=Process.sequential, verbose=True)

if __name__ == "__main__":
    result = crew.kickoff(inputs={
        "topic": "How vector databases work",
        "audience": "junior backend developers",
        "reference_url": "none",
    })
    pkg: VideoPackage = result.pydantic
    with open("package.json", "w") as f:
        json.dump(pkg.model_dump(), f, indent=2)
    print("\n".join(pkg.titles))
```

Run `python crew.py`. Set `reference_url` to a real video URL to have the researcher analyse it.

## How it works

1. **Inputs** fill the `{topic}`, `{audience}` and `{reference_url}` placeholders in agent goals and task descriptions.
2. **Researcher** decides whether to call the transcript tool. The tool returns errors as text so the agent can carry on without it.
3. **Scriptwriter** gets the research output through `context=[research]`.
4. **Packager** sees both earlier outputs and must return a `VideoPackage`; CrewAI validates it with Pydantic, so `result.pydantic` is a typed object.
5. `Process.sequential` keeps the run predictable: three tasks, three agents, in order.

## Prompt notes

- `expected_output` controls length and format more than anything in the backstory.
- The "no clickbait the video can't back up" line noticeably improves titles.
- Each agent sees only what it needs; passing the whole transcript to the packager wastes tokens.

## Stretch goals

- [ ] **Web research** — add a search tool (`SerperDevTool` or Tavily) to the researcher.
- [ ] **Full script** — a fourth task that expands the outline into narration.
- [ ] **Thumbnail image** — send `thumbnail_idea` to an image model.
- [ ] **Competitor scan** — YouTube Data API search for top videos on the topic, then summarize their titles.
- [ ] **Streamlit UI** with editable fields and a "regenerate titles" button.
- [ ] **Evaluate** — an LLM judge that scores titles for specificity and honesty.
- [ ] **Cost tracking** via `crew.usage_metrics` after each run.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
