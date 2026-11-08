---
title: "Corrective RAG (CRAG)"
---

## TL;DR

Corrective RAG adds a **check after retrieval**: an evaluator **grades each retrieved chunk** for relevance. If the chunks are good, generate as usual. If they are bad or missing, **correct course** — rewrite the query and fall back to **web search** (or another source) before answering. The core idea is simple: **don't trust the retriever blindly**. This note builds a working CRAG graph; [Corrective RAG in Advanced RAG](../05-advanced-rag/02-corrective-rag.md) goes deeper.

## The idea

The original CRAG paper (Yan et al., 2024) uses a lightweight retrieval evaluator that puts results into three buckets:

| Verdict | Meaning | Action |
|---|---|---|
| **Correct** | At least one chunk clearly relevant | Refine the chunks (keep relevant parts), generate |
| **Incorrect** | Nothing relevant | Discard chunks, web search, generate |
| **Ambiguous** | Unsure | Combine refined chunks + web results |

Most practical implementations simplify this to a per-chunk yes/no grade with an LLM.

```
question ─► retrieve ─► grade each chunk
                             │
              all relevant ──┼── some/none relevant
                   │                   │
                   │            rewrite query ─► web search ─► add results
                   ▼                   │
                generate ◄─────────────┘
```

## CRAG with LangGraph

```python
from typing import Literal, TypedDict
from pydantic import BaseModel
from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
store = InMemoryVectorStore.from_documents(
    [Document(page_content="Our API rate limit is set per organisation in the dashboard.")],
    OpenAIEmbeddings(model="text-embedding-3-small"))
retriever = store.as_retriever(search_kwargs={"k": 4})

class State(TypedDict):
    question: str
    docs: list[str]
    needs_web: bool
    answer: str

class Grade(BaseModel):
    relevant: Literal["yes", "no"]

grader = llm.with_structured_output(Grade)

def web_search(query: str) -> list[str]:
    """Plug in Tavily, Bing, SerpAPI etc. (e.g. the langchain-tavily package)."""
    return [f"[web result for: {query}]"]

def retrieve(state: State):
    return {"docs": [d.page_content for d in retriever.invoke(state["question"])]}

def grade_documents(state: State):
    kept = [d for d in state["docs"]
            if grader.invoke(f"Question: {state['question']}\nDocument: {d}\n"
                             "Is this document relevant to the question?").relevant == "yes"]
    return {"docs": kept, "needs_web": len(kept) == 0}

def transform_query(state: State):
    q = llm.invoke(f"Rewrite as a concise web search query: {state['question']}").content
    return {"question": q}

def search_web(state: State):
    return {"docs": state["docs"] + web_search(state["question"])}

def generate(state: State):
    ctx = "\n\n".join(state["docs"])
    msg = llm.invoke(f"Answer from the context. If it is not there, say so.\n\n{ctx}\n\n"
                     f"Question: {state['question']}")
    return {"answer": msg.content}

g = StateGraph(State)
for n, f in [("retrieve", retrieve), ("grade", grade_documents),
             ("transform_query", transform_query), ("web_search", search_web),
             ("generate", generate)]:
    g.add_node(n, f)
g.add_edge(START, "retrieve")
g.add_edge("retrieve", "grade")
g.add_conditional_edges("grade", lambda s: "transform_query" if s["needs_web"] else "generate")
g.add_edge("transform_query", "web_search")
g.add_edge("web_search", "generate")
g.add_edge("generate", END)
app = g.compile()

print(app.invoke({"question": "How do I raise my API rate limit?"})["answer"])
```

A common variant sets `needs_web` when **any** chunk is dropped (not only when all are), which is closer to the "ambiguous" bucket.

## Practical tips

- **Grade in parallel.** Use `grader.batch([...])` instead of a loop to cut latency.
- **Use a cheap grader.** A small model or a cross-encoder reranker score with a threshold works well.
- **Web search is not always allowed.** For private data, fall back to another index, a SQL lookup, or an honest "not found".
- **Keep the original question** for generation if the rewrite is tuned for search engines.
- **Log verdicts.** The share of "no" grades is a direct signal of retriever quality.

## CRAG vs. related patterns

| Pattern | Checks | Fixes by |
|---|---|---|
| CRAG | Retrieved documents | Rewrite + other source |
| [Self-RAG](./21-adaptive-rag-self-rag.md) | Docs **and** the generated answer | Regenerate / re-retrieve |
| Reranking | Ordering of documents | Reorder only, no fallback |

## Key terms

- **Corrective RAG (CRAG)** — RAG with a retrieval evaluator that triggers corrective actions on poor results.
- **Retrieval evaluator / grader** — model that scores chunk relevance to the question.
- **Knowledge refinement** — keeping only the relevant strips of retrieved text.
- **Fallback source** — web search or another index used when local retrieval fails.

## Interview quick-fire

- **"What problem does CRAG solve?"** → Plain RAG generates from whatever is retrieved, even if irrelevant; CRAG detects bad retrieval and corrects it before generation.
- **"What are CRAG's three outcomes?"** → Correct (refine and use), incorrect (discard and search elsewhere), ambiguous (combine both).
- **"How do you keep grading cheap?"** → Small model or reranker, batch calls, and only a handful of chunks.
