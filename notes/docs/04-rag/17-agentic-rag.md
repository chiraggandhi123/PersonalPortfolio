---
title: "Agentic RAG"
---

## TL;DR

Classic RAG **always** retrieves once, then answers. Agentic RAG puts an **agent in charge of retrieval**: it decides **whether** to retrieve, **which** source to search, whether the results are **good enough**, and whether to **rewrite the query and try again**. Retrieval becomes a **tool**, not a fixed step. You get better answers on hard questions at the cost of more LLM calls and less predictability.

## Classic vs. agentic

```
Classic RAG:   question ─► retrieve ─► stuff context ─► answer

Agentic RAG:   question ─► agent ──(no retrieval needed)──► answer
                             │
                             ├─► retrieve(tool) ─► grade docs ─┬─ relevant ─► answer
                             │                                 └─ not relevant
                             └──────────── rewrite query ◄──────┘
```

| | Classic RAG | Agentic RAG |
|---|---|---|
| Retrieval | Always, once | Optional, can repeat |
| Sources | One index | Many tools (vector DB, SQL, web) |
| Bad results | Answers anyway | Detects and retries |
| Cost / latency | Low, fixed | Higher, variable |
| Debuggability | Easy | Needs tracing |

## What the agent decides

1. **Retrieve or not** — "hi" or "what is 2+2" needs no search.
2. **Route** — policy docs vs. product catalogue vs. web search.
3. **Grade** — are the retrieved chunks actually relevant?
4. **Rewrite** — reformulate a vague or misspelled query.
5. **Stop** — enough evidence, so answer (or say "I don't know").

## Agentic RAG with LangGraph

```python
from typing import Literal
from pydantic import BaseModel
from langchain_core.documents import Document
from langchain_core.tools import tool
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode, tools_condition

docs = [Document(page_content="LangGraph models agents as graphs of nodes and edges."),
        Document(page_content="Checkpointers let LangGraph persist state between runs.")]
store = InMemoryVectorStore.from_documents(docs, OpenAIEmbeddings(model="text-embedding-3-small"))

@tool
def retrieve(query: str) -> str:
    """Search the LangGraph documentation."""
    hits = store.similarity_search(query, k=3)
    return "\n\n".join(d.page_content for d in hits)

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

def agent(state: MessagesState):
    return {"messages": [llm.bind_tools([retrieve]).invoke(state["messages"])]}

class Grade(BaseModel):
    relevant: Literal["yes", "no"]

def grade(state: MessagesState) -> Literal["generate", "rewrite"]:
    question, context = state["messages"][0].content, state["messages"][-1].content
    g = llm.with_structured_output(Grade).invoke(
        f"Question: {question}\nContext: {context}\nIs the context relevant?")
    return "generate" if g.relevant == "yes" else "rewrite"

def rewrite(state: MessagesState):
    q = state["messages"][0].content
    better = llm.invoke(f"Rewrite this as a clearer search query: {q}").content
    return {"messages": [("user", better)]}

def generate(state: MessagesState):
    question, context = state["messages"][0].content, state["messages"][-1].content
    ans = llm.invoke(f"Answer using only this context.\n{context}\n\nQuestion: {question}")
    return {"messages": [ans]}

g = StateGraph(MessagesState)
g.add_node("agent", agent)
g.add_node("retrieve", ToolNode([retrieve]))
g.add_node("rewrite", rewrite)
g.add_node("generate", generate)
g.add_edge(START, "agent")
g.add_conditional_edges("agent", tools_condition, {"tools": "retrieve", END: END})
g.add_conditional_edges("retrieve", grade)
g.add_edge("rewrite", "agent")
g.add_edge("generate", END)
app = g.compile()

result = app.invoke({"messages": [("user", "How does LangGraph save state?")]},
                    config={"recursion_limit": 12})
print(result["messages"][-1].content)
```

Notice the three decision points: `tools_condition` (retrieve or answer directly), `grade` (good docs or not) and the loop back from `rewrite`.

## Multiple retrieval tools

Give the agent one tool per source and good descriptions; the model routes by reading them.

```python
@tool
def search_policies(query: str) -> str:
    """Company HR and travel policies."""

@tool
def search_products(query: str) -> str:
    """Product specs, pricing tiers and feature lists."""
```

## Gotchas and best practices

- **Limit retries.** Track a `rewrite_count` in state and answer (or say "not found") after 2–3 loops.
- **Grading costs a call per turn.** Use a small, fast model for grading.
- **Tool descriptions drive routing.** Vague descriptions cause wrong-source retrieval.
- **Keep the original question.** Rewrites can drift; always answer the user's real question.
- **Measure.** Compare against plain RAG on the same eval set; agentic is not automatically better.

## Key terms

- **Agentic RAG** — RAG where an agent controls when and how retrieval happens.
- **Retriever tool** — a vector search exposed to the LLM as a callable tool.
- **Document grading** — an LLM check that retrieved chunks are relevant.
- **Query rewriting** — reformulating a query to improve retrieval.
- **Routing** — choosing which source or tool to query.

## Interview quick-fire

- **"What makes RAG agentic?"** → The LLM decides whether to retrieve, from where, judges the results and can retry, instead of a fixed retrieve-then-generate pipeline.
- **"Downsides of agentic RAG?"** → More latency and cost, non-deterministic paths, harder evaluation and debugging.
- **"How do you stop infinite rewrite loops?"** → A retry counter in state, a recursion limit, and a fallback "I couldn't find this" answer.
- **"When is plain RAG enough?"** → Single source, well-formed questions, and a good retriever already scoring well on evals.
