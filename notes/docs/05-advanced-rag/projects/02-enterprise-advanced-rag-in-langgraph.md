---
title: "Enterprise Advanced RAG in LangGraph"
---

## Goal

Build an internal knowledge assistant over company documents (HR policies, IT runbooks, finance FAQs) as a **LangGraph state machine**. It routes each question, runs **hybrid retrieval with per-user access control**, **grades** the chunks, **rewrites and retries** when retrieval is weak, **checks the answer is grounded**, and returns citations. Every loop has a hard limit, and conversations persist per thread.

**Skills practiced:** LangGraph `StateGraph` with cycles, query routing, hybrid search with reciprocal rank fusion, ACL metadata filters, CRAG-style grading, Self-RAG grounding checks, retry counters, checkpointers, FastAPI streaming.

## Architecture

```
FastAPI /ask (user_id, groups, thread_id)
   │
   ▼
route ──"chitchat"──► respond_direct ───────────────────────────────────────────► END
   │"docs"
   ▼
retrieve (BM25 + vectors, filtered by user's groups, fused with RRF)
   ▼
grade ──none relevant & rewrites < 2──► rewrite ──► retrieve
   │ some relevant (or out of retries)
   ▼
generate (cite [n]) ──► check_grounded ──no & tries < 2──► generate (with feedback)
                              │ yes / out of tries
                              ▼
                             END  (answer + sources + trace)
checkpointer: SQLite, keyed by thread_id
```

## Setup

```bash
pip install openai langgraph langgraph-checkpoint-sqlite langchain-openai langchain-chroma langchain-community rank_bm25 fastapi uvicorn python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

Index your documents with metadata `{"source": ..., "group": "hr" | "it" | "finance" | "all"}`. The `group` field drives access control.

## Code — `retrieval.py`

```python
from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from langchain_openai import OpenAIEmbeddings

store = Chroma(collection_name="kb", persist_directory="kb_db",
               embedding_function=OpenAIEmbeddings(model="text-embedding-3-small"))
all_docs = store.get(include=["documents", "metadatas"])
bm25 = BM25Retriever.from_texts(all_docs["documents"], metadatas=all_docs["metadatas"], k=20)

def hybrid_search(query: str, groups: list[str], k: int = 6):
    allowed = groups + ["all"]
    vec = store.similarity_search(query, k=20, filter={"group": {"$in": allowed}})
    kw = [d for d in bm25.invoke(query) if d.metadata["group"] in allowed]   # ACL before the LLM
    scores, by_text = {}, {}
    for results in (vec, kw):                       # reciprocal rank fusion
        for rank, d in enumerate(results):
            scores[d.page_content] = scores.get(d.page_content, 0) + 1 / (60 + rank)
            by_text[d.page_content] = d
    top = sorted(scores, key=scores.get, reverse=True)[:k]
    return [by_text[t] for t in top]
```

## Code — `graph.py`

```python
from typing import Annotated, Literal, TypedDict
import operator, sqlite3
from pydantic import BaseModel
from openai import OpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver
from retrieval import hybrid_search

client = OpenAI()
MAX_REWRITES, MAX_GENERATIONS = 2, 2

class State(TypedDict):
    question: str
    groups: list[str]
    route: str
    query: str
    docs: list[dict]                 # {"text", "source"}
    answer: str
    feedback: str
    rewrites: int
    generations: int
    trace: Annotated[list[str], operator.add]

class Route(BaseModel):
    route: Literal["docs", "chitchat"]

class YesNo(BaseModel):
    reason: str
    verdict: Literal["yes", "no"]

def ask(model_cls, system, user):
    r = client.chat.completions.parse(model="gpt-4o-mini", temperature=0, response_format=model_cls,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return r.choices[0].message.parsed

def chat(system, user):
    r = client.chat.completions.create(model="gpt-4o-mini", temperature=0,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return r.choices[0].message.content

def route(s):
    r = ask(Route, "Route to 'docs' for any question about company policy, IT or finance.", s["question"])
    return {"query": s["question"], "rewrites": 0, "generations": 0, "feedback": "",
            "route": r.route, "trace": [f"route:{r.route}"]}

def respond_direct(s):
    return {"answer": chat("You are a friendly workplace assistant. Be brief.", s["question"])}

def retrieve(s):
    docs = hybrid_search(s["query"], s["groups"])
    return {"docs": [{"text": d.page_content, "source": d.metadata["source"]} for d in docs],
            "trace": [f"retrieve:{len(docs)}"]}

def grade(s):
    keep = [d for d in s["docs"] if ask(YesNo, "Does this chunk help answer the question?",
            f"Q: {s['question']}\n\nChunk: {d['text']}").verdict == "yes"]
    return {"docs": keep, "trace": [f"grade:{len(keep)}"]}

def rewrite(s):
    q = chat("Rewrite as a keyword-rich search query. Return only the query.", s["question"])
    return {"query": q, "rewrites": s["rewrites"] + 1, "trace": [f"rewrite:{q}"]}

def generate(s):
    if not s["docs"]:
        return {"answer": "I couldn't find this in the documents you have access to.",
                "generations": MAX_GENERATIONS, "trace": ["generate:empty"]}
    ctx = "\n\n".join(f"[{i}] ({d['source']}) {d['text']}" for i, d in enumerate(s["docs"]))
    sys = "Answer only from the context and cite like [0]. If unsure, say so."
    if s["feedback"]:
        sys += f" Your previous answer was rejected: {s['feedback']}"
    return {"answer": chat(sys, f"Context:\n{ctx}\n\nQuestion: {s['question']}"),
            "generations": s["generations"] + 1, "trace": ["generate"]}

def check(s):
    ctx = "\n".join(d["text"] for d in s["docs"])
    v = ask(YesNo, "Is every claim in the answer supported by the context?",
            f"Context:\n{ctx}\n\nAnswer:\n{s['answer']}")
    return {"feedback": "" if v.verdict == "yes" else v.reason, "trace": [f"grounded:{v.verdict}"]}

def after_route(s):
    return "retrieve" if s["route"] == "docs" else "respond_direct"

def after_grade(s):
    return "rewrite" if not s["docs"] and s["rewrites"] < MAX_REWRITES else "generate"

def after_check(s):
    return "generate" if s["feedback"] and s["generations"] < MAX_GENERATIONS else END

g = StateGraph(State)
for name, fn in [("route", route), ("respond_direct", respond_direct), ("retrieve", retrieve),
                 ("grade", grade), ("rewrite", rewrite), ("generate", generate), ("check", check)]:
    g.add_node(name, fn)
g.add_edge(START, "route")
g.add_conditional_edges("route", after_route, ["retrieve", "respond_direct"])
g.add_edge("retrieve", "grade")
g.add_conditional_edges("grade", after_grade, ["rewrite", "generate"])
g.add_edge("rewrite", "retrieve")
g.add_edge("generate", "check")
g.add_conditional_edges("check", after_check, ["generate", END])
g.add_edge("respond_direct", END)

graph = g.compile(checkpointer=SqliteSaver(sqlite3.connect("threads.db", check_same_thread=False)))
```

## Code — `api.py`

```python
import json
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from langgraph.errors import GraphRecursionError
from pydantic import BaseModel
from graph import graph

app = FastAPI()

class Ask(BaseModel):
    question: str
    groups: list[str]          # in production, take these from the auth token, never the request body
    thread_id: str

@app.post("/ask")
def ask_endpoint(req: Ask):
    config = {"configurable": {"thread_id": req.thread_id}, "recursion_limit": 25}
    init = {"question": req.question, "groups": req.groups, "trace": []}

    def events():
        try:
            for update in graph.stream(init, config, stream_mode="updates"):
                node, data = next(iter(update.items()))
                yield json.dumps({"node": node, "trace": data.get("trace", [])}) + "\n"
            final = graph.get_state(config).values
            yield json.dumps({"answer": final["answer"], "sources": [d["source"] for d in final.get("docs", [])]}) + "\n"
        except GraphRecursionError:
            yield json.dumps({"answer": "Sorry, I couldn't complete that request."}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")
```

Run `uvicorn api:app --reload` and POST a question. You'll see each node stream past, then the final answer.

## How it works

- **Routing** skips retrieval for small talk. The `route` node also resets the loop counters for each new question, which matters because the checkpointer keeps state across turns in a thread.
- **Access control** is applied inside retrieval, to both the vector filter and the BM25 results, so restricted chunks never reach the model.
- **RRF** merges keyword and vector rankings without tuning score scales.
- **Two loops, two counters.** `rewrites` bounds the retrieval loop; `generations` bounds the grounding loop. `recursion_limit` is the backstop, and `GraphRecursionError` is caught.
- **Feedback on retry.** The grounding judge's reason is added to the system prompt, so regeneration actually changes.
- **Persistence.** The SQLite checkpointer stores state per `thread_id`, so you can inspect any past run with `graph.get_state_history(config)`.

## Stretch goals

- [ ] Add a `sql` route with the read-only [Text2SQL](../04-text2sql.md) node.
- [ ] Grade chunks in parallel with `Send` or a thread pool, and measure the latency saved.
- [ ] Add a cross-encoder reranker after RRF.
- [ ] Use conversation history from the checkpoint to rewrite follow-up questions.
- [ ] Trace with LangSmith or Langfuse and compare paths for failing questions.
- [ ] Build a 50-question eval set that includes access-control cases (a finance question asked by an HR user must fail).
- [ ] Swap `SqliteSaver` for Postgres and run several API workers.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
