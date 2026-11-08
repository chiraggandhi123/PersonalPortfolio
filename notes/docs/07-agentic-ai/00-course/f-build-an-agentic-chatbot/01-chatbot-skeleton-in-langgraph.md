---
title: "Chatbot Skeleton in LangGraph"
---

## TL;DR

This module builds **one chatbot, one feature at a time**. The skeleton is the smallest useful LangGraph app: a **`ChatState`** with a `messages` list using the **`add_messages`** reducer, one **`chat_node`** that calls the model, and edges **START → chat_node → END**. It works, but it has **no memory between calls** unless you pass the whole history yourself. Fixing that is the next note.

## Where this module is going

```
01 skeleton      START ─► chat_node ─► END
02 persistence   + checkpointer (SQLite), thread_id
03 streaming     + token streaming, Streamlit UI, multiple threads
04 tracing       + LangSmith traces per thread
05 tools         + search, calculator, datetime (ToolNode, tools_condition)
06 HITL          + interrupt() before sending email
07 CI/CD (AWS)   + Docker image, GitHub Actions, ECR, EC2
08 Render        + free Docker deploy, Postgres checkpointer
09 full build    everything together
```

Keep one repo and commit after each note. The project layout grows to:

```
agentic-chatbot/
├── backend.py        # graph, tools, checkpointer   (from this note)
├── app.py            # Streamlit UI                 (from note 03)
├── requirements.txt
├── Dockerfile        # (note 07)
└── .env
```

## Setup

```bash
pip install langgraph langchain-openai python-dotenv
```

```
OPENAI_API_KEY=sk-...
```

## The skeleton — `backend.py`

```python
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

load_dotenv()

llm = ChatOpenAI(model="gpt-4o-mini")
SYSTEM = SystemMessage("You are a helpful assistant. Keep answers concise.")


class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]   # append, don't overwrite


def chat_node(state: ChatState) -> dict:
    response = llm.invoke([SYSTEM, *state["messages"]])
    return {"messages": [response]}                        # reducer appends it


builder = StateGraph(ChatState)
builder.add_node("chat_node", chat_node)
builder.add_edge(START, "chat_node")
builder.add_edge("chat_node", END)
chatbot = builder.compile()


if __name__ == "__main__":
    result = chatbot.invoke({"messages": [HumanMessage("Hi, I'm Asha.")]})
    print(result["messages"][-1].content)
```

The system prompt is added inside the node rather than stored in state. That keeps it out of the saved history and lets you change it without touching old conversations.

## What happens on `invoke`

```
input  {"messages": [Human("Hi, I'm Asha.")]}
   │
   ▼  chat_node returns {"messages": [AI("Hi Asha! ...")]}
   │  add_messages: [Human, AI]
   ▼
output {"messages": [Human("Hi, I'm Asha."), AI("Hi Asha! ...")]}
```

## The memory problem

```python
chatbot.invoke({"messages": [HumanMessage("Hi, I'm Asha.")]})
r = chatbot.invoke({"messages": [HumanMessage("What's my name?")]})
print(r["messages"][-1].content)      # "I don't know your name..."
```

Each `invoke` starts with empty state. The graph has no memory of its own. The manual fix is to carry the history in your own loop:

```python
history: list[BaseMessage] = []
while (text := input("you: ")) not in {"exit", "quit"}:
    result = chatbot.invoke({"messages": history + [HumanMessage(text)]})
    history = result["messages"]
    print("bot:", history[-1].content)
```

This works for a script but not for a real app: history lives in one process, is lost on restart, and you must manage one list per user yourself. A **checkpointer** solves all three ([agent persistence](02-agent-persistence.md)).

## Why a graph for a single node?

A plain `llm.invoke` loop would do the same today. The graph earns its place as features land:

- **Persistence** plugs into `compile()` with one argument.
- **Streaming** of tokens and node updates comes built in.
- **Tools** become one more node plus a conditional edge.
- **Interrupts** for human approval need a graph runtime to pause and resume.

## Gotchas

- **Forgetting the reducer.** Without `add_messages`, the node's return value replaces the list and the user's message disappears.
- **Returning the whole list.** Return only new messages: `{"messages": [response]}`.
- **System prompt in state.** If you put it in the input every turn, it gets saved repeatedly once you add persistence.
- **Message tuples.** `("user", "hi")` and dicts also work as input; `add_messages` converts them to message objects.

## Key terms

- **ChatState** — the graph's state schema; here just a list of messages.
- **`add_messages`** — reducer that appends new messages and replaces ones with the same id.
- **Node** — a function that receives state and returns a partial update.
- **START / END** — virtual nodes marking where the graph begins and finishes.
- **Compile** — turns the `StateGraph` builder into a runnable graph.

## Interview quick-fire

- **"What's the minimal LangGraph chatbot?"** → A state with an `add_messages` list, one node that calls the model on the messages, and START → node → END edges.
- **"Why does the bot forget between invokes?"** → Graph state only lives for one run; without a checkpointer nothing is saved between calls.
- **"Why use `Annotated[list, add_messages]`?"** → So node updates are appended to the history instead of overwriting it.
