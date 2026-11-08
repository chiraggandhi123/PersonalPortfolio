---
title: "Notion ReAct Planner Agent"
---

## Goal

Build a planning assistant that works inside your **Notion task database**. You say "plan my week around the launch on Friday" and the agent **reads existing tasks, reasons about priorities and deadlines, then creates or updates tasks** in Notion. It is a [ReAct loop](../01-the-react-loop.md) where the tools are real side effects, so it also needs guardrails.

**Skills practiced:** ReAct agents, designing tools over a real API (notion-client), date handling, tool error handling, confirming destructive actions, LangGraph prebuilt agents.

## Architecture

```
user: "Plan my week; launch is Friday"
   │
   ▼
┌───────────────────────────── ReAct agent (gpt-4o-mini) ──────────────────────────┐
│ Thought: I need the current tasks first                                          │
│ Act: list_tasks(status="Not started")  ──► Notion API ──► 12 tasks               │
│ Thought: 3 launch tasks have no dates; schedule them before Friday               │
│ Act: update_task(id, due="2025-..", priority="High")  ──► Notion API             │
│ Act: create_task("Write release notes", due=..)       ──► Notion API             │
│ Thought: done → summarise the plan                                               │
└──────────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
"Here's your week: Mon ..., Tue ..., ..."
```

## Setup

1. In Notion: **Settings → Connections → Develop or manage integrations** → create an internal integration and copy the token.
2. Create a database with properties: `Name` (title), `Status` (status or select: Not started / In progress / Done), `Due` (date), `Priority` (select: High / Medium / Low).
3. Open the database → **⋯ → Connections** → add your integration. Copy the database id from its URL.
4. Install:

```bash
pip install notion-client langgraph langchain-openai python-dotenv
```

5. `.env`:

```
OPENAI_API_KEY=sk-...
NOTION_TOKEN=ntn_...
NOTION_DATABASE_ID=...
```

Notion's API has been moving from "databases" to "data sources" in newer versions. If `databases.query` is missing in your `notion-client` version, use the data-source equivalent from the docs. Property names must match your database exactly.

## Code — `planner.py`

```python
import os
from datetime import date

from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from notion_client import Client

load_dotenv()
notion = Client(auth=os.environ["NOTION_TOKEN"])
DB = os.environ["NOTION_DATABASE_ID"]


def _row(page: dict) -> str:
    p = page["properties"]
    name = "".join(t["plain_text"] for t in p["Name"]["title"])
    status = (p["Status"].get("status") or p["Status"].get("select") or {}).get("name", "?")
    due = (p["Due"]["date"] or {}).get("start", "none")
    prio = (p["Priority"]["select"] or {}).get("name", "none")
    return f"{page['id']} | {name} | {status} | due {due} | {prio}"


@tool
def list_tasks(status: str | None = None) -> str:
    """List tasks from Notion. Optionally filter by status: 'Not started', 'In progress' or 'Done'."""
    kwargs = {"database_id": DB, "page_size": 50}
    if status:
        kwargs["filter"] = {"property": "Status", "status": {"equals": status}}
    try:
        pages = notion.databases.query(**kwargs)["results"]
    except Exception as e:
        return f"Error querying Notion: {e}"
    return "\n".join(_row(pg) for pg in pages) or "No tasks found."


@tool
def create_task(name: str, due: str | None = None, priority: str = "Medium") -> str:
    """Create a task. due is YYYY-MM-DD. priority is High, Medium or Low."""
    props = {
        "Name": {"title": [{"text": {"content": name}}]},
        "Priority": {"select": {"name": priority}},
        "Status": {"status": {"name": "Not started"}},
    }
    if due:
        props["Due"] = {"date": {"start": due}}
    try:
        page = notion.pages.create(parent={"database_id": DB}, properties=props)
    except Exception as e:
        return f"Error creating task: {e}"
    return f"Created {page['id']}: {name}"


@tool
def update_task(page_id: str, due: str | None = None, priority: str | None = None,
                status: str | None = None) -> str:
    """Update a task's due date (YYYY-MM-DD), priority or status. Use ids from list_tasks."""
    props = {}
    if due:
        props["Due"] = {"date": {"start": due}}
    if priority:
        props["Priority"] = {"select": {"name": priority}}
    if status:
        props["Status"] = {"status": {"name": status}}
    if not props:
        return "Nothing to update."
    try:
        notion.pages.update(page_id=page_id, properties=props)
    except Exception as e:
        return f"Error updating task: {e}"
    return f"Updated {page_id}"


SYSTEM = f"""You are a planning assistant working in the user's Notion task list.
Today is {date.today().isoformat()} ({date.today():%A}).
Always call list_tasks before planning. Never invent task ids.
Spread work across days, put deadline-critical tasks first, and keep at most 4 High tasks per day.
Finish with a short day-by-day plan and a list of the changes you made."""

agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini", temperature=0),
                           tools=[list_tasks, create_task, update_task], prompt=SYSTEM)

if __name__ == "__main__":
    request = input("What should I plan? ")
    for step in agent.stream({"messages": [("user", request)]},
                             config={"recursion_limit": 25}, stream_mode="values"):
        step["messages"][-1].pretty_print()        # watch Thought → Act → Observe live
```

## How it works

1. **The system prompt injects today's date.** Without it, the model guesses dates and schedules tasks in the past.
2. **`list_tasks` first.** The agent observes the real board before acting; the prompt forbids inventing ids.
3. **Tools are thin wrappers** that return short text, one line per task, so observations stay small.
4. **Errors become observations.** A wrong property name or bad id comes back as text, and the model can retry.
5. **`stream_mode="values"`** prints each new message, so you see every tool call and result as it happens.
6. **`recursion_limit=25`** caps the loop if the model keeps re-listing or re-updating.

## Safety

This agent writes to a real workspace. Before trusting it:

- Test on a **copy** of your database.
- Add a **dry-run mode** where write tools return "would create ..." instead of calling Notion.
- Don't give it a delete tool. Archiving is reversible; deleting may not be.
- For bigger plans, pause before writes with LangGraph `interrupt()` and ask for approval.

## Stretch goals

- [ ] **Dry-run flag** that previews all changes, then applies them on "yes".
- [ ] **Calendar awareness** — read busy slots from Google Calendar before scheduling.
- [ ] **Weekly review** — mark stale tasks and suggest what to drop.
- [ ] **Subtasks** — break a large task into child pages with a relation property.
- [ ] **Notion MCP server** — swap the hand-written tools for an MCP server and compare.
- [ ] **Telegram or Slack front end** so you can plan from your phone.
- [ ] **Memory** of preferences ("no meetings before 10") across sessions.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
