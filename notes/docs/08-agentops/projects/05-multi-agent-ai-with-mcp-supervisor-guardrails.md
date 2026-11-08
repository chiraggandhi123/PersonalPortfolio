---
title: "Multi-Agent AI with MCP + Supervisor + Guardrails"
---

## Goal

Build a **supervisor-led team of agents in LangGraph** where each worker gets its tools from an **MCP server**, and the whole graph is wrapped in **input and output guardrails**. A user asks something like "What's 18% GST on 2,450 and save a note about it"; the supervisor routes to a **math agent** and a **notes agent**, then a final check blocks unsafe or leaky answers.

**Skills practiced:** LangGraph StateGraph, supervisor routing with structured output, MCP servers with FastMCP, `langchain-mcp-adapters`, ReAct workers, guardrails (moderation, injection checks, PII redaction), step limits.

## Architecture

```
user ──► input_guard ──(blocked)──────────────────────────────► END
              │ ok
              ▼
         supervisor ◄──────────────┐        route = math | notes | finish
          │       │                │
          ▼       ▼                │
     math_agent  notes_agent ──────┘
     (MCP: math)  (MCP: notes)
          │
   supervisor says finish
              ▼
         output_guard ─► redact PII / block ─► END
```

## Setup

```bash
pip install langgraph langchain-openai langchain-mcp-adapters "mcp[cli]" python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code — MCP servers

```python
# math_server.py
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("math")

@mcp.tool()
def calculate(expression: str) -> str:
    """Evaluate a basic arithmetic expression like '2450 * 0.18'."""
    allowed = set("0123456789+-*/(). ")
    if not set(expression) <= allowed:
        return "error: only arithmetic is allowed"
    return str(eval(expression, {"__builtins__": {}}))   # input restricted above

if __name__ == "__main__":
    mcp.run()
```

```python
# notes_server.py
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("notes")
NOTES: list[str] = []

@mcp.tool()
def save_note(text: str) -> str:
    """Save a short note."""
    NOTES.append(text)
    return f"saved ({len(NOTES)} notes)"

@mcp.tool()
def list_notes() -> list[str]:
    """List saved notes."""
    return NOTES

if __name__ == "__main__":
    mcp.run()
```

## Code — `graph.py`

```python
import asyncio, re
from typing import Literal
from dotenv import load_dotenv
from pydantic import BaseModel
from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import create_react_agent   # newer: langchain.agents.create_agent
from langchain_core.messages import AIMessage, HumanMessage

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
oai = OpenAI()
MAX_HOPS = 6

class State(MessagesState):
    next: str
    hops: int
    blocked: bool

class Route(BaseModel):
    next: Literal["math", "notes", "finish"]
    reason: str

# ---------- guardrails ----------
INJECTION = re.compile(r"ignore (all|previous|your) (instructions|rules)|system prompt", re.I)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")

def input_guard(state: State):
    text = state["messages"][-1].content
    flagged = oai.moderations.create(model="omni-moderation-latest", input=text).results[0].flagged
    if flagged or INJECTION.search(text):
        return {"blocked": True, "messages": [AIMessage("Sorry, I can't help with that request.")]}
    return {"blocked": False, "hops": 0}

def output_guard(state: State):
    final = state["messages"][-1].content
    return {"messages": [AIMessage(EMAIL.sub("[redacted email]", final))]}

# ---------- supervisor ----------
def supervisor(state: State):
    if state["hops"] >= MAX_HOPS:
        return {"next": "finish"}
    route = llm.with_structured_output(Route).invoke([
        ("system", "You coordinate workers. math: arithmetic. notes: save/list notes. "
                   "Choose 'finish' when the user's request is fully handled."),
        *state["messages"],
    ])
    return {"next": route.next, "hops": state["hops"] + 1}

def finish(state: State):
    answer = llm.invoke([("system", "Write the final answer to the user from this conversation. Be brief."),
                         *state["messages"]])
    return {"messages": [answer]}

async def build():
    client = MultiServerMCPClient({
        "math":  {"command": "python", "args": ["math_server.py"],  "transport": "stdio"},
        "notes": {"command": "python", "args": ["notes_server.py"], "transport": "stdio"},
    })
    math_agent = create_react_agent(llm, await client.get_tools(server_name="math"),
                                    prompt="You do arithmetic with the calculate tool only.")
    notes_agent = create_react_agent(llm, await client.get_tools(server_name="notes"),
                                     prompt="You save and list notes.")

    async def run_worker(agent, state: State):
        out = await agent.ainvoke({"messages": state["messages"]})
        return {"messages": [AIMessage(out["messages"][-1].content)]}   # only the final reply

    async def math_node(state: State):
        return await run_worker(math_agent, state)

    async def notes_node(state: State):
        return await run_worker(notes_agent, state)

    g = StateGraph(State)
    g.add_node("input_guard", input_guard)
    g.add_node("supervisor", supervisor)
    g.add_node("math", math_node)
    g.add_node("notes", notes_node)
    g.add_node("finish", finish)
    g.add_node("output_guard", output_guard)

    g.add_edge(START, "input_guard")
    g.add_conditional_edges("input_guard", lambda s: END if s["blocked"] else "supervisor")
    g.add_conditional_edges("supervisor", lambda s: s["next"],
                            {"math": "math", "notes": "notes", "finish": "finish"})
    g.add_edge("math", "supervisor")
    g.add_edge("notes", "supervisor")
    g.add_edge("finish", "output_guard")
    g.add_edge("output_guard", END)
    return g.compile()

async def main():
    graph = await build()
    result = await graph.ainvoke({"messages": [HumanMessage(
        "What's 18% GST on 2450? Save a note with the result.")]})
    print(result["messages"][-1].content)

asyncio.run(main())
```

## How it works

1. **Input guard** — the moderation API and a cheap regex catch obvious abuse and injection attempts before any agent runs. Blocked requests end immediately.
2. **Supervisor** — uses structured output (`Route`) so routing is always one of three valid values. A hop counter caps the loop.
3. **Workers over MCP** — `MultiServerMCPClient` launches both servers and turns their tools into LangChain tools. Each worker is a ReAct agent that sees only its own server's tools (least privilege).
4. **Clean handoff** — workers return only their final message to the shared state, so the supervisor isn't flooded with tool chatter.
5. **Finish + output guard** — a final answer is written, then emails (stand-in for PII) are redacted before the user sees it.

## Gotchas

- The regex injection check is a demo. Real systems add a classifier (e.g. Llama Guard or a prompt-injection model) and rely mostly on tool permissions.
- Some adapter versions open a new MCP session per tool call; for stateful servers, use `client.session(...)` to keep one session open.
- Worker nodes must be real `async def` functions. A lambda that returns a coroutine is treated as a sync node and breaks.
- `create_react_agent` still works but newer LangChain versions point to `create_agent`; the idea is the same.

## Stretch goals

- [ ] **Human approval** — `interrupt()` before `save_note` and resume with LangGraph's `Command`.
- [ ] **Remote MCP** — run the notes server with streamable HTTP and connect via `"transport": "streamable_http"`.
- [ ] **Guardrails library** — swap the hand-rolled checks for NeMo Guardrails or Guardrails AI.
- [ ] **Tracing** — send the graph to LangSmith or Langfuse and inspect supervisor decisions.
- [ ] **Trajectory evals** — assert the supervisor picks math then notes for 20 test prompts.
- [ ] **Persistence** — add a checkpointer so conversations resume across requests.
- [ ] **Deploy** — wrap in FastAPI, containerize, and ship to Render or Cloud Run.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
