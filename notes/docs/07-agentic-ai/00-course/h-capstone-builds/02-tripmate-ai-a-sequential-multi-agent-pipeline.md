---
title: "TripMate AI: a Sequential Multi-Agent Pipeline"
---

## Goal

Build **TripMate AI**, which turns "4 days in Goa in December, ₹40k, I like food and beaches" into a day-by-day itinerary with a budget. Four specialist agents run **one after another** in a LangGraph pipeline, and each one reads the previous agent's structured output. This is the simplest multi-agent pattern and the right starting point before supervisors or parallel workers.

**Skills practiced:** sequential multi-agent design, typed shared state, structured outputs with Pydantic, per-agent prompts, a validation loop, Streamlit UI.

## Architecture

```
user request
    │
    ▼
┌──────────┐   TripRequest   ┌────────────┐   Research   ┌───────────┐  Itinerary  ┌──────────┐
│  intake  │ ──────────────► │ researcher │ ───────────► │  planner  │ ──────────► │  budget  │
└──────────┘                 └────────────┘              └───────────┘             └────┬─────┘
                                                              ▲   over budget           │
                                                              └─────────────────────────┤
                                                                                        ▼
                                                                                   ┌──────────┐
                                                                                   │  writer  │ ─► markdown plan
                                                                                   └──────────┘
```

Each arrow is a typed field in the shared state. The only loop is budget → planner, capped at two retries.

## Setup

```bash
pip install langgraph langchain-openai langchain-tavily streamlit python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
```

## Code

### `graph.py`

```python
from typing import TypedDict
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_tavily import TavilySearch
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)
search = TavilySearch(max_results=5)

class TripRequest(BaseModel):
    destination: str
    days: int
    budget_inr: int
    interests: list[str]

class Research(BaseModel):
    highlights: list[str] = Field(description="Specific places, foods, activities")
    tips: list[str] = Field(description="Weather, transport, safety tips")

class Day(BaseModel):
    day: int
    morning: str
    afternoon: str
    evening: str
    est_cost_inr: int

class Itinerary(BaseModel):
    days: list[Day]
    stay: str
    stay_cost_per_night_inr: int

class State(TypedDict, total=False):
    query: str
    request: TripRequest
    research: Research
    itinerary: Itinerary
    total_cost: int
    feedback: str
    retries: int
    final: str

def intake(s: State):
    req = llm.with_structured_output(TripRequest).invoke(
        f"Extract trip details. Default days=3, budget_inr=30000 if missing.\n\n{s['query']}")
    return {"request": req, "retries": 0}

def researcher(s: State):
    r = s["request"]
    results = search.invoke(f"best things to do {r.destination} {' '.join(r.interests)}")
    research = llm.with_structured_output(Research).invoke(
        f"From these search results, list highlights and practical tips for {r.destination}.\n\n{results}")
    return {"research": research}

def planner(s: State):
    r, res = s["request"], s["research"]
    prompt = (f"Plan {r.days} days in {r.destination} for interests {r.interests}. "
              f"Total budget ₹{r.budget_inr}. Use these highlights: {res.highlights}. "
              f"{s.get('feedback', '')}")
    return {"itinerary": llm.with_structured_output(Itinerary).invoke(prompt)}

def budget(s: State):
    it = s["itinerary"]
    total = sum(d.est_cost_inr for d in it.days) + it.stay_cost_per_night_inr * len(it.days)
    over = total - s["request"].budget_inr
    feedback = f"Previous plan cost ₹{total}, ₹{over} over budget. Cut costs." if over > 0 else ""
    return {"total_cost": total, "feedback": feedback, "retries": s["retries"] + 1}

def route_budget(s: State):
    return "planner" if s["feedback"] and s["retries"] < 3 else "writer"

def writer(s: State):
    text = llm.invoke(
        f"Write a friendly markdown travel plan.\nItinerary: {s['itinerary'].model_dump_json()}\n"
        f"Tips: {s['research'].tips}\nTotal estimated cost: ₹{s['total_cost']}").content
    return {"final": text}

g = StateGraph(State)
for name, fn in [("intake", intake), ("researcher", researcher), ("planner", planner),
                 ("budget", budget), ("writer", writer)]:
    g.add_node(name, fn)
g.add_edge(START, "intake")
g.add_edge("intake", "researcher")
g.add_edge("researcher", "planner")
g.add_edge("planner", "budget")
g.add_conditional_edges("budget", route_budget, ["planner", "writer"])
g.add_edge("writer", END)
app = g.compile()
```

### `ui.py`

```python
import streamlit as st
from dotenv import load_dotenv
load_dotenv()
from graph import app

st.title("TripMate AI")
query = st.text_area("Describe your trip", "4 days in Goa in December, ₹40k, food and beaches")
if st.button("Plan it"):
    with st.status("Planning...") as status:
        for step in app.stream({"query": query}, stream_mode="updates"):
            node = next(iter(step))
            status.write(f"✓ {node}")
            if node == "writer":
                final = step[node]["final"]
    st.markdown(final)
```

Run with `streamlit run ui.py`.

## How it works

1. **Intake** turns free text into a `TripRequest`. Every later agent works from clean fields, not the raw query.
2. **Researcher** is the only agent with a tool (web search). It compresses noisy search results into a short `Research` object, so later prompts stay small.
3. **Planner** builds the `Itinerary` with structured output, which makes the costs machine-checkable.
4. **Budget** is plain Python, not an LLM. Arithmetic belongs in code. If the plan is over budget, it writes feedback and routes back to the planner.
5. **Writer** turns structured data into readable markdown.
6. `stream_mode="updates"` emits one event per finished node, which drives the progress list in the UI.

**Why sequential?** Each step depends on the one before it, so there's nothing to parallelize. Sequential pipelines are cheap, predictable and easy to debug. Move to a supervisor only when the order of steps must change at runtime.

## Stretch goals

- [ ] Add a weather agent that checks the travel dates and adjusts outdoor plans.
- [ ] Run research for flights, hotels and activities in parallel (see the [parallel TripMate project](../../projects/09-tripmate-ai-multi-agent-travel-planner.md)).
- [ ] Human approval of the itinerary before the writer runs (`interrupt()`).
- [ ] Export the plan to PDF or Google Calendar events.
- [ ] Add a checkpointer so users can say "swap day 2 and 3" and only the planner re-runs.
- [ ] Eval set of 20 trip requests; check budget compliance and day count.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
