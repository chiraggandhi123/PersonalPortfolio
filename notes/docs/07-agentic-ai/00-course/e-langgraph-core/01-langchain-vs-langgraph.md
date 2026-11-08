---
title: "LangChain vs LangGraph"
---

## TL;DR

**LangChain** is a toolkit: model wrappers, prompts, tools, retrievers and a ready-made agent (`create_agent`). **LangGraph** is a runtime for **stateful graphs**: you define the **state**, the **nodes** that update it and the **edges** that decide what runs next. They are not rivals. LangChain's agent runs on LangGraph, and LangGraph nodes usually call LangChain models. Use LangChain for standard agents and LangGraph when you need **custom control flow, loops, persistence or human approval**.

## The difference in one picture

```
LangChain chain (LCEL): a straight pipe
  prompt ──► model ──► parser

LangChain agent: a fixed loop you configure
  model ⇄ tools

LangGraph: any graph you design
             ┌──► research ──┐
  START ──► plan             ├──► review ──fail──► plan
             └──► code ──────┘       │
                                    pass
                                     ▼
                                    END
```

## Side by side

| | LangChain | LangGraph |
|---|---|---|
| Core idea | Components and chains | State machine / graph |
| Control flow | Linear chains, or a prebuilt agent loop | Branches, loops, parallel paths, any shape |
| State | Message list, implicit | Explicit typed state with reducers |
| Persistence | Through the agent's checkpointer | Built in: checkpointers, threads, time travel |
| Human-in-the-loop | Middleware on `create_agent` | `interrupt()` anywhere in any node |
| Learning curve | Low | Medium |
| Best for | Standard RAG, simple tool agents, integrations | Custom agents, multi-agent, long-running workflows |

## Same task, both ways

A two-step job: draft an answer, then polish it.

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

llm = ChatOpenAI(model="gpt-4o-mini")

# LangChain (LCEL): a pipe
draft = ChatPromptTemplate.from_template("Answer briefly: {q}") | llm | StrOutputParser()
polish = ChatPromptTemplate.from_template("Make this clearer:\n{text}") | llm | StrOutputParser()
chain = {"text": draft} | polish
print(chain.invoke({"q": "What is a vector database?"}))
```

```python
# LangGraph: explicit state, nodes and edges
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    q: str
    draft: str
    final: str

def write_draft(state: State) -> dict:
    return {"draft": llm.invoke(f"Answer briefly: {state['q']}").content}

def polish_draft(state: State) -> dict:
    return {"final": llm.invoke(f"Make this clearer:\n{state['draft']}").content}

builder = StateGraph(State)
builder.add_node("write_draft", write_draft)
builder.add_node("polish_draft", polish_draft)
builder.add_edge(START, "write_draft")
builder.add_edge("write_draft", "polish_draft")
builder.add_edge("polish_draft", END)
graph = builder.compile()

print(graph.invoke({"q": "What is a vector database?"})["final"])
```

For a straight line, LangGraph is more code. It pays off the moment you add "if the draft is too long, rewrite it" (a loop), "ask a human before publishing" (an interrupt), or "resume tomorrow" (a checkpointer).

## When to pick which

- **Pick LangChain** when the task is a pipe (prompt → model → parser), standard RAG, or a tool agent where `create_agent` is enough.
- **Pick LangGraph** when you need:
  - loops with exit conditions (retry, reflect, self-correct),
  - branching on model output or data,
  - several agents sharing state,
  - pause/resume, human approval, or durable long-running runs,
  - fine control over what goes into each model call.

## How they fit together

```
langchain-core   ── messages, Runnables, tools, prompts
langchain-openai ── model integrations (also -anthropic, -google-genai, -ollama ...)
langchain        ── create_agent, middleware, higher-level helpers   (built on LangGraph)
langgraph        ── StateGraph, checkpointers, interrupt, streaming
langsmith        ── tracing and evaluation for both
```

You will use all of these together in module F.

## Gotchas

- **Don't over-graph.** A three-node straight line doesn't need LangGraph unless you also need persistence or streaming of intermediate steps.
- **LangGraph doesn't require LangChain models.** Nodes are plain functions; you can call the OpenAI SDK directly. You lose some automatic tracing and streaming integration.
- **Old comparisons are outdated.** Older articles compare LangGraph with `AgentExecutor`; in LangChain 1.x the agent itself is a LangGraph graph.

## Key terms

- **LCEL** — LangChain Expression Language; composing Runnables with the `|` operator.
- **Runnable** — LangChain's common interface: `invoke`, `stream`, `batch` and async versions.
- **StateGraph** — LangGraph's builder for graphs whose nodes read and update a shared state.
- **Node** — a function that takes the state and returns updates.
- **Edge** — a connection that says which node runs next, fixed or conditional.
- **Checkpointer** — saves state after each step so a run can resume.

## Interview quick-fire

- **"LangChain vs. LangGraph in one line?"** → LangChain gives you components and a prebuilt agent; LangGraph lets you build any stateful, looping control flow as a graph.
- **"Why would you move an agent from LangChain to LangGraph?"** → To add custom branching or loops, shared state across agents, human approval at specific points, or durable execution.
- **"Can you use them together?"** → Yes, normally: LangGraph nodes call LangChain models and tools, and `create_agent` itself returns a LangGraph graph.
