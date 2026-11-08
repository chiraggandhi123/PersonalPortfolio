---
title: "AI Customer-Support Agent (Memory + Tools)"
---

## Goal

Build a support agent for a fictional online store. It **looks up orders, checks refund policy and opens tickets** through tools, **remembers the current conversation** (short-term memory), and **remembers facts about each customer across conversations** (long-term memory), such as "prefers email" or "had a damaged delivery last month". See [Agent Memory](../02-agent-memory.md) for the theory.

**Skills practiced:** LangGraph `StateGraph`, tool calling, checkpointers (thread memory), the LangGraph store (cross-thread memory), memory extraction, Mem0 as an alternative.

## Architecture

```
customer message  (user_id, thread_id)
        │
        ▼
┌──────────────┐   load memories for user_id   ┌──────────────────┐
│    agent     │ ◄──────────────────────────── │ store (long-term)│
│ (LLM + tools)│                               └────────▲─────────┘
└──────┬───────┘                                        │
       │ tool_calls?                                    │ save new facts
   yes │            no                                  │
       ▼             └──────────► ┌──────────────┐ ─────┘
┌──────────────┐                  │   remember   │
│    tools     │                  └──────┬───────┘
│ get_order    │                         ▼
│ refund_policy│                        END
│ open_ticket  │
└──────┬───────┘
       └──► back to agent

checkpointer: saves the full message history per thread_id (short-term)
```

## Setup

```bash
pip install langgraph langchain-openai python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code — `support_agent.py`

```python
import uuid

from dotenv import load_dotenv
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore
from pydantic import BaseModel

load_dotenv()

ORDERS = {"A100": {"status": "delivered", "item": "headphones", "days_ago": 5},
          "A101": {"status": "in transit", "item": "keyboard", "days_ago": 2}}


@tool
def get_order(order_id: str) -> str:
    """Look up an order's status by its ID, e.g. 'A100'."""
    return str(ORDERS.get(order_id.upper(), "Order not found."))


@tool
def refund_policy() -> str:
    """Return the store's refund policy."""
    return "Refunds within 30 days of delivery for unused or damaged items. Damaged items need a photo."


@tool
def open_ticket(summary: str, priority: str = "normal") -> str:
    """Open a support ticket for a human agent. priority: low, normal or urgent."""
    return f"Ticket T-{uuid.uuid4().hex[:6]} opened ({priority}): {summary}"


TOOLS = [get_order, refund_policy, open_ticket]
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
llm_with_tools = llm.bind_tools(TOOLS)


class Facts(BaseModel):
    facts: list[str]   # durable facts about the customer; empty if none


def agent(state: MessagesState, config: RunnableConfig, *, store: BaseStore):
    user_id = config["configurable"]["user_id"]
    memories = [m.value["fact"] for m in store.search(("customers", user_id))]
    system = SystemMessage(
        "You are a polite support agent for ShopCo. Use tools; never invent order details. "
        "Open a ticket if you cannot solve the problem.\n"
        f"Known facts about this customer: {memories or 'none'}"
    )
    return {"messages": [llm_with_tools.invoke([system, *state["messages"]])]}


def remember(state: MessagesState, config: RunnableConfig, *, store: BaseStore):
    """Extract durable customer facts from the latest exchange and save them."""
    user_id = config["configurable"]["user_id"]
    recent = state["messages"][-4:]
    prompt = ("List lasting facts about the customer (preferences, issues, contact details) "
              "from this conversation. Skip one-off chit-chat.")
    found = llm.with_structured_output(Facts).invoke([SystemMessage(prompt), *recent])
    for fact in found.facts:
        store.put(("customers", user_id), str(uuid.uuid4()), {"fact": fact})
    return {}


def route(state: MessagesState):
    return "tools" if tools_condition(state) == "tools" else "remember"


builder = StateGraph(MessagesState)
builder.add_node("agent", agent)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_node("remember", remember)
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", route, ["tools", "remember"])
builder.add_edge("tools", "agent")
builder.add_edge("remember", END)

graph = builder.compile(checkpointer=InMemorySaver(), store=InMemoryStore())


def chat(user_id: str, thread_id: str, text: str) -> str:
    config = {"configurable": {"user_id": user_id, "thread_id": thread_id}}
    out = graph.invoke({"messages": [("user", text)]}, config)
    return out["messages"][-1].content


if __name__ == "__main__":
    print(chat("u1", "t1", "Hi, my headphones from order A100 arrived broken. I prefer email updates."))
    print(chat("u1", "t1", "What do I need to send you?"))          # same thread: short-term memory
    print(chat("u1", "t2", "Hello again, any news on my issue?"))   # new thread: long-term memory
```

## How it works

1. **Short-term memory** — the checkpointer stores every message per `thread_id`. Calling again with the same thread continues the conversation without you passing history.
2. **Tool loop** — `tools_condition` checks for tool calls. If present, `ToolNode` runs them and the agent sees the results. This is the [ReAct loop](../01-the-react-loop.md) as a graph.
3. **Long-term memory** — the store is a key-value store namespaced by `("customers", user_id)`. It survives across threads, so thread `t2` still knows about the broken headphones and the email preference.
4. **The `remember` node** runs after each final answer. It uses structured output to pull out durable facts and saves them.
5. LangGraph injects `store` into any node that declares a `store` keyword argument.

## Swapping in Mem0

[Mem0](https://github.com/mem0ai/mem0) handles extraction, deduplication and search for you. Its return shapes have changed between versions, so check the docs.

```python
from mem0 import Memory   # pip install mem0ai

memory = Memory()   # uses OpenAI and a local vector store by default
memory.add([{"role": "user", "content": text}], user_id="u1")
hits = memory.search("customer preferences", user_id="u1")
facts = [h["memory"] for h in hits["results"]]
```

## Production notes

- Use **`PostgresSaver`** and **`PostgresStore`** (or a Redis equivalent) instead of the in-memory versions, which are wiped when the process stops.
- Use **semantic search** in the store (configure an embedding index) once a customer has many memories.
- **Deduplicate and expire** facts. Without this, memory fills with stale or duplicate entries.
- **PII** — memories are personal data. Support deletion requests and don't store payment details.

## Stretch goals

- [ ] **Human handoff** — pause with `interrupt()` before `open_ticket` with `urgent` priority.
- [ ] **RAG over the help centre** — add a `search_docs` tool backed by a vector store.
- [ ] **Sentiment routing** — escalate angry customers automatically.
- [ ] **Memory deduplication** — ask the LLM to merge a new fact with similar existing ones before saving.
- [ ] **Eval set** — 20 scripted conversations, scoring correct tool use and policy compliance.
- [ ] **Streamlit chat UI** with a login so each user gets their own `user_id`.
- [ ] **Mem0 version** — compare its recall quality with your hand-written `remember` node.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
