---
title: "Adaptive RAG & Self-RAG"
---

## TL;DR

Two ideas that make RAG **check and adjust itself**. **Adaptive RAG** looks at the question first and **picks a strategy by complexity**: no retrieval, single retrieval, or multi-step retrieval (or web search). **Self-RAG** checks the output: after generating, it asks **"is this answer grounded in the documents?"** and **"does it answer the question?"**, and regenerates or re-retrieves if not. In practice they are often combined in one LangGraph. [Self-RAG in Advanced RAG](../05-advanced-rag/03-self-rag.md) covers the paper in more depth.

## Adaptive RAG: route by complexity

From Jeong et al. (2024): a small classifier predicts how hard a question is, so easy questions stay cheap and hard ones get more effort.

| Query type | Example | Strategy |
|---|---|---|
| Simple / general | "What does RAG stand for?" | Answer directly, no retrieval |
| Single-hop | "What is our refund window?" | One retrieval + generate |
| Multi-hop / fresh | "Compare plan A and B pricing changes this year" | Iterative retrieval or web search |

```
question ─► classify ─┬─ direct ──────────────► LLM answer
                      ├─ vectorstore ─► retrieve ─► generate
                      └─ web / multi-step ─► search loop ─► generate
```

## Self-RAG: grade your own answer

The Self-RAG paper (Asai et al., 2023) trains a model to emit **reflection tokens**: should I retrieve? is this passage relevant? is my output supported? is it useful? Practical implementations replace the trained tokens with **LLM graders**:

| Check | Question asked | On failure |
|---|---|---|
| Relevance | Are these docs relevant? | Rewrite query, re-retrieve |
| Groundedness | Is the answer supported by the docs? | Regenerate |
| Usefulness | Does it answer the question? | Rewrite query, re-retrieve |

```
retrieve ─► grade docs ─► generate ─► grounded? ──no──► generate again
                                         │yes
                                    answers question? ──no──► rewrite ─► retrieve
                                         │yes
                                        END
```

## Combined graph in LangGraph

```python
from typing import Literal, TypedDict
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

class State(TypedDict):
    question: str
    docs: list[str]
    answer: str
    attempts: int

class RouteQuery(BaseModel):
    source: Literal["direct", "vectorstore", "web"]

class YesNo(BaseModel):
    ok: Literal["yes", "no"]

def retrieve_docs(q: str) -> list[str]: return [f"[chunk about {q}]"]   # your retriever
def web_docs(q: str) -> list[str]: return [f"[web page about {q}]"]     # your web search

def route(state: State) -> str:
    r = llm.with_structured_output(RouteQuery).invoke(
        "Route the question: 'direct' for general knowledge, 'vectorstore' for questions "
        f"about our product docs, 'web' for recent events.\nQuestion: {state['question']}")
    return r.source

def direct(state: State):
    return {"answer": llm.invoke(state["question"]).content}

def retrieve(state: State):
    return {"docs": retrieve_docs(state["question"]), "attempts": state.get("attempts", 0)}

def web(state: State):
    return {"docs": web_docs(state["question"]), "attempts": state.get("attempts", 0)}

def generate(state: State):
    ctx = "\n".join(state["docs"])
    ans = llm.invoke(f"Use only this context:\n{ctx}\n\nQuestion: {state['question']}").content
    return {"answer": ans, "attempts": state["attempts"] + 1}

def check_answer(state: State) -> str:
    if state["attempts"] >= 3:
        return "done"                                      # give up gracefully
    grader = llm.with_structured_output(YesNo)
    grounded = grader.invoke(f"Docs: {state['docs']}\nAnswer: {state['answer']}\n"
                             "Is every claim in the answer supported by the docs?").ok
    if grounded == "no":
        return "regenerate"
    useful = grader.invoke(f"Question: {state['question']}\nAnswer: {state['answer']}\n"
                           "Does the answer resolve the question?").ok
    return "done" if useful == "yes" else "rewrite"

def rewrite(state: State):
    return {"question": llm.invoke(f"Improve this search query: {state['question']}").content}

g = StateGraph(State)
for n, f in [("direct", direct), ("retrieve", retrieve), ("web", web),
             ("generate", generate), ("rewrite", rewrite)]:
    g.add_node(n, f)
g.add_conditional_edges(START, route, {"direct": "direct", "vectorstore": "retrieve", "web": "web"})
g.add_edge("direct", END)
g.add_edge("retrieve", "generate")
g.add_edge("web", "generate")
g.add_conditional_edges("generate", check_answer,
                        {"regenerate": "generate", "rewrite": "rewrite", "done": END})
g.add_edge("rewrite", "retrieve")
app = g.compile()

print(app.invoke({"question": "How do I reset my API key?"})["answer"])
```

Note that `retrieve` resets nothing: `attempts` carries over so the total number of generations stays capped across rewrites.

## Gotchas and best practices

- **Graders hallucinate too.** Test them on labelled examples before trusting the loop.
- **Cap attempts** and return the best answer with a caveat rather than looping.
- **Routing errors are silent.** Log the route; a question sent to "direct" never sees your docs.
- **Latency adds up.** Two graders per generation can triple response time. Use a smaller model for grading.
- **Prefer a classifier for routing at scale.** A fine-tuned small model is cheaper than an LLM call per query.

## Key terms

- **Adaptive RAG** — choosing a retrieval strategy per query based on predicted complexity.
- **Self-RAG** — a model that decides when to retrieve and critiques its own output with reflection tokens.
- **Reflection tokens** — special tokens in Self-RAG signalling retrieval need, relevance, support and usefulness.
- **Groundedness / faithfulness** — whether claims in the answer are supported by the context.
- **Answer relevance** — whether the answer addresses the question.

## Interview quick-fire

- **"Adaptive RAG in one line?"** → Classify query complexity first, then use no retrieval, single-step or multi-step retrieval accordingly.
- **"What does Self-RAG check?"** → Whether retrieval is needed, whether docs are relevant, whether the answer is supported, and whether it is useful.
- **"CRAG vs. Self-RAG?"** → CRAG corrects bad retrieval before generation; Self-RAG also critiques the generated answer and loops.
- **"How do you avoid infinite self-correction?"** → An attempt counter in state checked in the routing function.
