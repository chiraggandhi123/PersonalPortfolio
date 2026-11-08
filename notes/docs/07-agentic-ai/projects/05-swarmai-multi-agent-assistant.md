---
title: "SwarmAI — Multi-Agent Assistant"
---

## Goal

Build a personal assistant made of **specialist agents that hand the conversation to each other**. A triage agent reads the request and hands off to a research, writing or calendar specialist. The specialist can hand back to triage when the user changes topic. This is the "swarm" pattern, built with the OpenAI Agents SDK (the production successor to OpenAI's experimental Swarm library). See [OpenAI Agents SDK & Google ADK](../05-openai-agents-sdk-google-adk.md) for the concepts.

**Skills practiced:** handoffs, function tools, agent instructions, multi-turn sessions, guardrails, tracing.

## Architecture

```
                  user message
                       │
                       ▼
                ┌─────────────┐
                │   triage    │  (no tools, only handoffs)
                └─────┬───────┘
         handoff ┌────┼──────────────┐
                 ▼    ▼              ▼
          ┌──────────┐ ┌──────────┐ ┌──────────┐
          │ research │ │  writer  │ │ calendar │
          │ web tool │ │ no tools │ │ add/list │
          └────┬─────┘ └────┬─────┘ └────┬─────┘
               └──── handoff back to triage ┘
                       │
                       ▼
                 final answer (from whichever agent is active)
```

The key idea: a **handoff transfers control**. The new agent sees the conversation history and replies directly to the user. That is different from an "agent as tool", where a manager calls a sub-agent and keeps control.

## Setup

The SDK is young and its API moves quickly. The names below (`Agent`, `Runner`, `function_tool`, `SQLiteSession`) are stable so far, but check the docs if an import fails.

```bash
pip install openai-agents python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code — `swarm.py`

```python
from datetime import date

from dotenv import load_dotenv
from agents import Agent, Runner, SQLiteSession, function_tool
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX

load_dotenv()
MODEL = "gpt-4o-mini"
EVENTS: list[dict] = []          # replace with Google Calendar later


@function_tool
def web_search(query: str) -> str:
    """Search the web and return short snippets for the query."""
    return f"(stub) Top results for '{query}'"      # plug in Tavily, Serper, etc.


@function_tool
def add_event(title: str, day: str, time: str) -> str:
    """Add a calendar event. day is YYYY-MM-DD, time is HH:MM (24h)."""
    EVENTS.append({"title": title, "day": day, "time": time})
    return f"Added '{title}' on {day} at {time}."


@function_tool
def list_events() -> str:
    """List all upcoming calendar events."""
    return "\n".join(f"{e['day']} {e['time']} {e['title']}" for e in EVENTS) or "No events."


def specialist(name: str, job: str, tools=()) -> Agent:
    return Agent(
        name=name,
        model=MODEL,
        instructions=f"{RECOMMENDED_PROMPT_PREFIX}\nYou are the {name} agent. {job} "
                     "If the user asks for something outside your job, hand off to the triage agent.",
        tools=list(tools),
    )


research = specialist("research", "Answer factual questions using web_search. Cite sources.", [web_search])
writer = specialist("writer", "Draft emails, posts and summaries in a clear, friendly tone.")
calendar = specialist("calendar", f"Manage the user's calendar. Today is {date.today()}.",
                      [add_event, list_events])

triage = Agent(
    name="triage",
    model=MODEL,
    instructions=f"{RECOMMENDED_PROMPT_PREFIX}\nRoute the user to the right specialist. "
                 "Do not answer the request yourself.",
    handoffs=[research, writer, calendar],
)

for agent in (research, writer, calendar):     # let specialists route back
    agent.handoffs = [triage]


def main():
    session = SQLiteSession("me", "swarm.db")    # remembers turns across runs
    current = triage
    while (text := input("you> ").strip()) not in {"", "quit"}:
        result = Runner.run_sync(current, text, session=session, max_turns=10)
        print(f"[{result.last_agent.name}] {result.final_output}")
        current = result.last_agent              # keep talking to whoever answered


if __name__ == "__main__":
    main()
```

Try: "Book a dentist appointment next Tuesday at 4pm", then "Now write a reminder email about it".

## How it works

1. **`Runner.run_sync`** runs the agent loop: call the model, run any tools, follow any handoff, repeat until an agent produces a final text answer or `max_turns` is hit.
2. **Handoffs are exposed to the model as tools** named like `transfer_to_calendar`. When the model calls one, the runner swaps the active agent and continues.
3. **`RECOMMENDED_PROMPT_PREFIX`** explains the handoff system to each agent, so they route instead of guessing.
4. **`result.last_agent`** tells you who answered. Starting the next turn with that agent keeps follow-ups ("make it shorter") with the right specialist.
5. **`SQLiteSession`** stores the conversation, so you don't manage the message list yourself.
6. **Tracing is on by default** and runs appear in the OpenAI dashboard's Traces view. Each handoff and tool call is a span.

## Gotchas

- **Routing loops** — two agents can bounce the user back and forth. Make each agent's job crisp and keep `max_turns` low.
- **Tool docstrings matter** — `function_tool` builds the schema from type hints and the docstring.
- **Handoff vs. agent-as-tool** — use `agent.as_tool(...)` when a manager should combine several specialists' outputs into one answer.
- **Other providers** — the SDK can use non-OpenAI models through LiteLLM or any OpenAI-compatible endpoint, though some features (hosted tools, tracing) are OpenAI-specific.

## Stretch goals

- [ ] **Input guardrail** — a cheap agent that blocks off-topic or unsafe requests before triage runs.
- [ ] **Real calendar** — Google Calendar API with OAuth instead of the in-memory list.
- [ ] **Real search** — Tavily or the SDK's hosted `WebSearchTool`.
- [ ] **Structured output** — give the calendar agent an `output_type` Pydantic model.
- [ ] **Streaming** — use `Runner.run_streamed` and print tokens as they arrive.
- [ ] **Compare** — rebuild the same router in LangGraph and note what you gain or lose.
- [ ] **Telegram or Slack front end** with one session per user.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
