---
title: "Tools in the Agentic Chatbot"
---

## TL;DR

Tools turn the chatbot into an agent. Three changes in `backend.py`: **bind tools** to the model (`llm.bind_tools(tools)`), add a prebuilt **`ToolNode`** that runs whatever the model asks for, and route with **`tools_condition`**: if the last AI message has tool calls go to `tools`, else END, with an edge from `tools` **back to `chat_node`**. The graph becomes a loop. The UI filters the stream so only the assistant's text is typed out, and shows which tools ran.

## The graph change

```
Before:  START ─► chat_node ─► END

After:   START ─► chat_node ──tools_condition──► END
                     ▲              │
                     │         tool calls?
                     │              ▼
                     └────────── tools (ToolNode)
```

A single user turn can now loop several times: search, then calculate, then answer.

## Setup

```bash
pip install langchain-tavily
```

```
TAVILY_API_KEY=tvly-...
```

## The tools

Add to `backend.py`:

```python
from datetime import datetime

from langchain_core.tools import tool
from langchain_tavily import TavilySearch

search = TavilySearch(max_results=3)        # web search, returns titles, URLs, snippets


@tool
def calculator(expression: str) -> str:
    """Evaluate an arithmetic expression like '(120 * 1.18) / 3'. Use for any math."""
    if not set(expression) <= set("0123456789+-*/(). "):
        return "Error: only numbers and + - * / ( ) are allowed"
    try:
        return str(eval(expression))
    except Exception as e:
        return f"Error: {e}"


@tool
def get_current_datetime() -> str:
    """Return the current date and time. Use for questions about today, now or dates."""
    return datetime.now().strftime("%A %d %B %Y, %H:%M")


tools = [search, calculator, get_current_datetime]
```

Errors come back as strings, so the model can see the problem and retry instead of crashing the graph.

## The graph — updated part of `backend.py`

```python
from langgraph.prebuilt import ToolNode, tools_condition

llm = ChatOpenAI(model="gpt-4o-mini")
llm_with_tools = llm.bind_tools(tools)
SYSTEM = SystemMessage(
    "You are a helpful assistant. Keep answers concise. "
    "Use tools for current facts, math and the date. Cite URLs from search results."
)


def chat_node(state: ChatState) -> dict:
    return {"messages": [llm_with_tools.invoke([SYSTEM, *state["messages"]])]}


builder = StateGraph(ChatState)
builder.add_node("chat_node", chat_node)
builder.add_node("tools", ToolNode(tools))
builder.add_edge(START, "chat_node")
builder.add_conditional_edges("chat_node", tools_condition)   # → "tools" or END
builder.add_edge("tools", "chat_node")
chatbot = builder.compile(checkpointer=checkpointer)
```

`ChatState`, the SQLite `checkpointer` and the thread helpers stay the same.

## What ends up in the thread

```
Human  "What's 15% of Tesla's last reported quarterly revenue?"
AI     tool_calls=[tavily_search(query="Tesla latest quarterly revenue")]
Tool   "[{title: ..., url: ..., content: '... revenue of $X billion ...'}]"
AI     tool_calls=[calculator(expression="0.15 * X")]
Tool   "..."
AI     "Tesla reported $X billion ... 15% of that is ... (source: url)"
```

All of these are saved by the checkpointer. The model sees the whole chain on later turns too.

## `ToolNode` and `tools_condition`, by hand

They're small. Knowing what they do helps when you need custom behavior:

```python
from langchain_core.messages import ToolMessage

TOOLS = {t.name: t for t in tools}

def my_tool_node(state: ChatState) -> dict:
    results = []
    for call in state["messages"][-1].tool_calls:
        output = TOOLS[call["name"]].invoke(call["args"])
        results.append(ToolMessage(content=str(output), tool_call_id=call["id"]))
    return {"messages": results}

def my_router(state: ChatState) -> str:
    return "tools" if state["messages"][-1].tool_calls else END
```

The prebuilt `ToolNode` also runs calls in parallel, catches exceptions into error messages, and supports interrupts (next note).

## Showing tools in `app.py`

Replace the `tokens()` generator:

```python
from langchain_core.messages import ToolMessage

def tokens():
    for chunk, meta in chatbot.stream(
        {"messages": [HumanMessage(prompt)]}, config, stream_mode="messages"
    ):
        if isinstance(chunk, ToolMessage):
            yield f"\n\n*Used tool: `{chunk.name}`*\n\n"
        elif (isinstance(chunk, AIMessageChunk) and chunk.content
              and meta["langgraph_node"] == "chat_node"):
            yield chunk.content
```

The history loop already skips AI messages with empty content, so tool-call messages and raw tool output stay hidden after the rerun.

## Tool design tips

- **Name and docstring decide everything.** "Use for any math" makes the model reach for the calculator instead of guessing.
- **Few tools.** Three to five clear tools beat ten overlapping ones.
- **Small outputs.** `max_results=3` keeps search results from flooding the context.
- **Read-only first.** Tools that change things (send, pay, delete) need approval: next note.

## Gotchas

- **`tools_condition` expects a node named `"tools"`.** Name it differently and you must write your own router.
- **Model doesn't call tools** → description too vague, or the system prompt doesn't say when to use them.
- **Loops** → a tool that keeps erroring. The default `recursion_limit` of 25 stops it; return clearer errors.
- **`eval` is still dangerous.** The whitelist is the bare minimum; use a math parser such as `numexpr` in production.
- **Server time ≠ user time.** `datetime.now()` in a container is usually UTC. Pass the user's timezone if it matters.

## Key terms

- **`bind_tools`** — attaches tool schemas to a chat model so it can emit tool calls.
- **ToolNode** — prebuilt node that executes the tool calls in the last AI message and returns `ToolMessage`s.
- **`tools_condition`** — prebuilt router: to `"tools"` if there are tool calls, otherwise END.
- **ToolMessage** — a message holding a tool's result, linked by `tool_call_id`.
- **Agent loop** — the cycle chat_node → tools → chat_node until the model answers directly.

## Interview quick-fire

- **"How do you add tools to a LangGraph chatbot?"** → Bind tools to the model, add a `ToolNode`, route from the model node with `tools_condition`, and add an edge from tools back to the model.
- **"What does `ToolNode` do?"** → Reads tool calls from the last AI message, runs them (in parallel), and returns `ToolMessage`s with matching `tool_call_id`s.
- **"How does the loop end?"** → When the model replies without tool calls, `tools_condition` routes to END.
- **"How do you handle tool errors?"** → Return the error as the tool result so the model can retry or explain, and cap iterations.
