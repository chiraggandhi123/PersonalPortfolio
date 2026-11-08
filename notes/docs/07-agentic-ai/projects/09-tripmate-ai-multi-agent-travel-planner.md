---
title: "TripMate AI — Multi-Agent Travel Planner"
---

## Goal

Turn a free-text request like "5 days in Lisbon in May for two, mid budget, we love food and history" into a **day-by-day itinerary with flights, a hotel, activities and a cost estimate**. A parser agent extracts the trip details, then **flight, hotel, activity and weather agents run in parallel**, and an aggregator agent combines their results into one plan and checks it fits the budget. The course capstone [TripMate AI: a Sequential Multi-Agent Pipeline](../00-course/h-capstone-builds/02-tripmate-ai-a-sequential-multi-agent-pipeline.md) chains agents one after another. This version uses **fan-out / fan-in** to cut latency.

**Skills practiced:** LangGraph parallel branches, fan-in joins, structured outputs, specialist agents with tools, state reducers, budget validation.

## Architecture

```
"5 days in Lisbon in May..."
            │
            ▼
     ┌─────────────┐
     │   parser    │ → TripRequest (city, dates, travellers, budget, interests)
     └──────┬──────┘
   ┌────────┼─────────┬──────────┐        fan-out: all four run in the same step
   ▼        ▼         ▼          ▼
┌───────┐┌───────┐┌──────────┐┌─────────┐
│flights││hotels ││activities││ weather │
└───┬───┘└───┬───┘└────┬─────┘└────┬────┘
    └────────┴────┬────┴───────────┘     fan-in: waits for all four
                  ▼
           ┌─────────────┐
           │ aggregator  │ → itinerary + total cost; over budget? flag it
           └──────┬──────┘
                  ▼
           itinerary.md
```

The key idea: the four specialists **don't depend on each other**, so running them in parallel makes the total wait roughly the slowest agent, not the sum of all four.

## Setup

```bash
pip install langgraph langchain-openai python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

The search tools below return mock data. Swap in real APIs later (Amadeus or Skyscanner for flights, Booking or Google Places for hotels and sights, Open-Meteo for weather).

## Code — `tripmate.py`

```python
import operator
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)


class TripRequest(BaseModel):
    origin: str = Field(description="Departure city; 'unknown' if not given")
    city: str
    days: int
    month: str
    travellers: int
    budget_usd: int | None = Field(description="Total budget in USD, null if not given")
    interests: list[str]


class TripState(TypedDict, total=False):
    query: str
    request: TripRequest
    findings: Annotated[list[str], operator.add]   # each specialist appends here
    itinerary: str


# --- mock tools: replace with real APIs ---
def search_flights(r: TripRequest) -> str:
    return f"Round trip {r.origin}->{r.city}: TAP $420/person, easyJet $310/person (1 stop)."

def search_hotels(r: TripRequest) -> str:
    return f"{r.city}: Hotel Baixa $140/night (central), Alfama Guesthouse $95/night (old town)."

def search_activities(r: TripRequest) -> str:
    return f"{r.city}: food tour $70, castle $15, tram 28 $4, day trip to Sintra $60, fado night $40."

def get_weather(r: TripRequest) -> str:
    return f"{r.city} in {r.month}: 18-24°C, mostly sunny, rare rain."


def specialist(role: str, tool):
    """Build a node: call the tool, then let the LLM pick the best options for this trip."""
    def node(state: TripState):
        r = state["request"]
        raw = tool(r)
        pick = llm.invoke(
            f"You are a {role} expert. Trip: {r.model_dump_json()}.\n"
            f"Options:\n{raw}\nRecommend the best fit in 2-3 lines with prices."
        ).content
        return {"findings": [f"## {role}\n{pick}"]}
    return node


def parser(state: TripState):
    return {"request": llm.with_structured_output(TripRequest).invoke(state["query"])}


def aggregator(state: TripState):
    r = state["request"]
    prompt = (
        f"Create a day-by-day Markdown itinerary for this trip: {r.model_dump_json()}.\n"
        "Use ONLY these specialist findings:\n\n" + "\n\n".join(state["findings"]) +
        "\n\nEnd with a cost table (flights, hotel, activities, food estimate, total). "
        "If the total exceeds the budget, say so and suggest cheaper swaps."
    )
    return {"itinerary": llm.invoke(prompt).content}


g = StateGraph(TripState)
g.add_node("parser", parser)
g.add_node("aggregator", aggregator)
specialists = {"flights": search_flights, "hotels": search_hotels,
               "activities": search_activities, "weather": get_weather}
for name, tool in specialists.items():
    g.add_node(name, specialist(name, tool))
    g.add_edge("parser", name)           # fan-out
g.add_edge(START, "parser")
g.add_edge(list(specialists), "aggregator")   # fan-in: wait for all of them
g.add_edge("aggregator", END)
app = g.compile()

if __name__ == "__main__":
    out = app.invoke({"query": "5 days in Lisbon in May for two from London, "
                               "about $2500 total, we love food and history"})
    print(out["itinerary"])
    open("itinerary.md", "w").write(out["itinerary"])
```

## How it works

1. **parser** turns free text into a `TripRequest` with structured output. Every later agent works from clean fields, not the raw sentence.
2. **Fan-out** — four edges leave `parser`. LangGraph runs all four specialist nodes in the same step, concurrently.
3. **Reducer** — the `findings` key is `Annotated[list[str], operator.add]`. Without a reducer, four nodes writing the same key in one step raise an error. With `operator.add`, their outputs are concatenated.
4. **Fan-in** — `add_edge([...], "aggregator")` makes the aggregator wait until **all** listed nodes finish, then run once.
5. **aggregator** is told to use only the findings, so prices come from the tools, not the model's memory. It also does the budget check.

## Sequential vs. parallel

| | Sequential (course capstone) | Parallel (this project) |
|---|---|---|
| Latency | Sum of all agents | About the slowest agent |
| Dependencies | Later agents can use earlier results (e.g. hotel near the airport) | Specialists are independent |
| Debugging | Simple, linear trace | Needs reducers and a join |
| Best when | Steps genuinely depend on each other | Steps are independent lookups |

A hybrid works well too: run flights and weather first, then hotels and activities in parallel using the flight dates.

## Gotchas

- **Rate limits** — parallel calls hit provider limits faster. Add retries with backoff.
- **One branch failing** fails the step. Catch tool errors inside each node and return a "not available" finding instead.
- **Mock data hides real problems** — real APIs need IATA codes, exact dates and currency conversion. Add those fields to `TripRequest`.
- **Budget math by LLM is unreliable.** Compute totals in Python from structured specialist outputs for anything the user will rely on.

## Stretch goals

- [ ] **Real APIs** — Amadeus test environment for flights, Open-Meteo for weather.
- [ ] **Structured specialist outputs** with prices as numbers, and a Python budget calculator.
- [ ] **Replan loop** — if over budget, send the plan back to hotels and activities with a lower cap (max 2 loops).
- [ ] **Human review** — `interrupt()` before the aggregator so the user can swap a hotel.
- [ ] **Streamlit UI** with a progress bar per specialist.
- [ ] **Time it** — measure the speed-up against a sequential version of the same graph.
- [ ] **Export** to PDF or Google Calendar events.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
