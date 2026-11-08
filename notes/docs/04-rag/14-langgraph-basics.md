---
title: "LangGraph Basics"
---

## TL;DR

**LangGraph** models an LLM application as a **graph**: a shared **state** object, **nodes** (Python functions that read state and return updates) and **edges** (what runs next, including **conditional edges** that branch on state). Unlike a linear chain, a graph can **loop**, branch, pause for a human and resume. A **checkpointer** saves state after every step, giving you memory, fault tolerance and time travel. It is the runtime under LangChain's `create_agent`, and the tool of choice for **corrective, adaptive and agentic RAG**.

## Core concepts

```
              ┌──────────────┐
  START ────► │   retrieve   │
              └──────┬───────┘
                     ▼
              ┌──────────────┐   docs relevant?   ┌──────────────┐
              │  grade_docs  │ ───── no ────────► │ rewrite_query│ ──┐
              └──────┬───────┘                    └──────────────┘   │
                     │ yes                         (loops back to retrieve)
                     ▼
              ┌──────────────┐
              │   generate   │ ────► END
              └──────────────┘
```

| Concept | What it is |
|---|---|
| **State** | A `TypedDict` (or Pydantic model) shared by all nodes |
| **Node** | A function `state → partial update dict` |
| **Edge** | Fixed transition from one node to another |
| **Conditional edge** | A function that looks at state and returns the name of the next node |
| **Reducer** | How an update merges into state (overwrite by default; `add_messages` appends) |
| **START / END** | Special entry and exit nodes |
| **Checkpointer** | Saves state per `thread_id` after each step |

## Hello graph

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    text: str
    word_count: int

def count(state: State) -> dict:
    return {"word_count": len(state["text"].split())}     # return only the keys you change

builder = StateGraph(State)
builder.add_node("count", count)
builder.add_edge(START, "count")
builder.add_edge("count", END)
graph = builder.compile()

print(graph.invoke({"text": "LangGraph runs graphs of nodes"}))
# {'text': 'LangGraph runs graphs of nodes', 'word_count': 5}
```

## A RAG graph with a self-correcting loop

```python
from typing import Literal, TypedDict
from pydantic import BaseModel
from langchain_core.documents import Document
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
# `retriever` comes from earlier notes

class RAGState(TypedDict):
    question: str
    query: str
    docs: list[Document]
    answer: str
    attempts: int

class Grade(BaseModel):
    relevant: bool

def retrieve(state: RAGState) -> dict:
    query = state.get("query") or state["question"]
    return {"docs": retriever.invoke(query), "attempts": state.get("attempts", 0) + 1}

def grade_route(state: RAGState) -> Literal["generate", "rewrite"]:
    context = "\n".join(d.page_content for d in state["docs"])
    grade = llm.with_structured_output(Grade).invoke(
        f"Do these documents help answer '{state['question']}'?\n\n{context}"
    )
    if grade.relevant or state["attempts"] >= 3:          # cap retries
        return "generate"
    return "rewrite"

def rewrite(state: RAGState) -> dict:
    new_q = llm.invoke(f"Rewrite this as a better search query, return only the query: {state['question']}").content
    return {"query": new_q}

def generate(state: RAGState) -> dict:
    context = "\n\n".join(d.page_content for d in state["docs"])
    msg = llm.invoke(f"Answer from the context only. Say 'I don't know' if it's missing.\n\n"
                     f"Context:\n{context}\n\nQuestion: {state['question']}")
    return {"answer": msg.content}

builder = StateGraph(RAGState)
builder.add_node("retrieve", retrieve)
builder.add_node("rewrite", rewrite)
builder.add_node("generate", generate)
builder.add_edge(START, "retrieve")
builder.add_conditional_edges("retrieve", grade_route)     # returns "generate" or "rewrite"
builder.add_edge("rewrite", "retrieve")                    # the loop
builder.add_edge("generate", END)
rag_graph = builder.compile()

print(rag_graph.invoke({"question": "What is the hotel limit for business travel?"})["answer"])
```

This is the skeleton of **corrective RAG**, covered in a later note.

## Messages state and tool-calling agents

For chat agents, use the built-in `MessagesState` (a `messages` list with the `add_messages` reducer) and the prebuilt tool node:

```python
from langgraph.graph import MessagesState
from langgraph.prebuilt import ToolNode, tools_condition

model_with_tools = llm.bind_tools(tools)                     # tools defined with @tool

def call_model(state: MessagesState) -> dict:
    return {"messages": [model_with_tools.invoke(state["messages"])]}

builder = StateGraph(MessagesState)
builder.add_node("agent", call_model)
builder.add_node("tools", ToolNode(tools))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)      # tool calls → "tools", else END
builder.add_edge("tools", "agent")
```

This hand-built loop is what `create_agent` gives you in one call. Build it yourself when you need custom steps around the loop.

## Memory with checkpointers

```python
from langgraph.checkpoint.memory import InMemorySaver

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "user-42"}}

graph.invoke({"messages": [{"role": "user", "content": "My name is Asha."}]}, config)
out = graph.invoke({"messages": [{"role": "user", "content": "What's my name?"}]}, config)
print(out["messages"][-1].content)       # remembers: same thread_id
```

Use `SqliteSaver` or `PostgresSaver` (separate `langgraph-checkpoint-*` packages) to persist across restarts. Checkpoints also enable **human-in-the-loop** (`interrupt()` pauses a node until you resume with `Command(resume=...)`) and replaying earlier states.

## Running and debugging

- `graph.stream(inputs, stream_mode="updates")` yields each node's output as it runs.
- `graph.get_graph().draw_mermaid()` prints a diagram of the graph.
- `config={"recursion_limit": 15}` caps the number of steps.
- LangSmith shows every node, input and output; LangGraph Studio gives a visual debugger.

## Gotchas

- **Return partial updates, not the whole state.** Returning a key overwrites it unless it has a reducer.
- **Lists overwrite by default.** Use `Annotated[list, add_messages]` or `operator.add` to append.
- **Always cap loops** with a counter in state or `recursion_limit`.
- **Conditional edge functions return node names** (or `END`). Typos fail only at runtime.
- **Keep state small.** Large documents in state get saved at every checkpoint.

## Key terms

- **StateGraph** — LangGraph's builder for graphs over a typed state.
- **Node** — a function that receives state and returns updates.
- **Conditional edge** — an edge whose target is chosen at runtime from state.
- **Reducer** — rule for merging a node's update into a state key.
- **Checkpointer** — saves state per thread for memory, resumption and human-in-the-loop.
- **Thread ID** — identifier that groups checkpoints for one conversation.

## Interview quick-fire

- **"Why LangGraph instead of a LangChain chain?"** → Chains are linear (DAGs); LangGraph supports loops, branching, persistence and human-in-the-loop, which agents and self-correcting RAG need.
- **"What is a reducer?"** → A function that defines how a node's update merges into existing state, e.g. `add_messages` appends instead of overwriting.
- **"How does LangGraph give an agent memory?"** → A checkpointer saves state after each step keyed by `thread_id`; later calls with the same thread continue from it.
- **"How would you implement corrective RAG?"** → Nodes for retrieve, grade, rewrite (or web search) and generate, with a conditional edge looping back to retrieval when documents are irrelevant, plus a retry cap.
