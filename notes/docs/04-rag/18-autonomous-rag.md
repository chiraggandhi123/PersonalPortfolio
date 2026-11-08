---
title: "Autonomous RAG"
---

## TL;DR

Autonomous RAG goes one step past [agentic RAG](./17-agentic-rag.md): the system **plans its own research**. It breaks a question into **sub-questions**, retrieves for each, **reflects** on whether the evidence is complete, adds new sub-questions if gaps remain, and only then writes the answer. The loop is **plan → retrieve → reflect → (replan) → synthesize**. It suits complex, multi-hop questions; it is overkill for simple lookups.

## Where it sits

| Level | Who decides the steps | Example question |
|---|---|---|
| Classic RAG | You (fixed pipeline) | "What is the refund window?" |
| Agentic RAG | LLM decides retrieve / retry | "What's our policy on refunds for gifts?" |
| Autonomous RAG | LLM plans multi-step research | "Compare our 2023 and 2024 refund policies and summarize what changed." |

## The loop

```
question
   │
   ▼
 plan ──► [sub-q1, sub-q2, sub-q3]
   │
   ▼
 retrieve for each open sub-question ──► notes
   │
   ▼
 reflect: "Is this enough to answer?" ──── gaps ──► add sub-questions ──┐
   │ complete (or step budget hit)                                     │
   ▼                                                                   │
 synthesize answer with citations          ◄─────── loop back ─────────┘
```

## Autonomous RAG in LangGraph

```python
import operator
from typing import Annotated, TypedDict
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
MAX_ROUNDS = 3

class State(TypedDict):
    question: str
    todo: list[str]                                  # sub-questions still to research
    notes: Annotated[list[str], operator.add]        # evidence accumulates
    rounds: int
    answer: str

class Plan(BaseModel):
    sub_questions: list[str]

class Reflection(BaseModel):
    complete: bool
    missing: list[str]       # new sub-questions if not complete

def search(q: str) -> str:
    """Stand-in for your retriever (vector store, BM25, web...)."""
    return f"[doc snippet relevant to: {q}]"

def plan(state: State):
    p = llm.with_structured_output(Plan).invoke(
        f"Break this into 2-4 focused search questions:\n{state['question']}")
    return {"todo": p.sub_questions, "rounds": 0}

def retrieve(state: State):
    notes = [f"Q: {q}\nEvidence: {search(q)}" for q in state["todo"]]
    return {"notes": notes, "todo": [], "rounds": state["rounds"] + 1}

def reflect(state: State):
    r = llm.with_structured_output(Reflection).invoke(
        f"Question: {state['question']}\nNotes:\n" + "\n".join(state["notes"]) +
        "\nCan the question be fully answered? If not, list missing search questions.")
    return {"todo": [] if r.complete else r.missing}

def should_continue(state: State) -> str:
    if state["todo"] and state["rounds"] < MAX_ROUNDS:
        return "retrieve"
    return "synthesize"

def synthesize(state: State):
    msg = llm.invoke(
        "Answer using only the notes. Say what is unknown.\n\n"
        + "\n".join(state["notes"]) + f"\n\nQuestion: {state['question']}")
    return {"answer": msg.content}

g = StateGraph(State)
for name, fn in [("plan", plan), ("retrieve", retrieve),
                 ("reflect", reflect), ("synthesize", synthesize)]:
    g.add_node(name, fn)
g.add_edge(START, "plan")
g.add_edge("plan", "retrieve")
g.add_edge("retrieve", "reflect")
g.add_conditional_edges("reflect", should_continue)
g.add_edge("synthesize", END)
app = g.compile()

print(app.invoke({"question": "How did our refund policy change between 2023 and 2024?"})["answer"])
```

Key details: `notes` uses an `operator.add` reducer so evidence accumulates across rounds, and `rounds` enforces a hard budget.

## Design choices

| Choice | Options |
|---|---|
| Planner | One-shot plan vs. replan every round |
| Retrieval | Parallel sub-queries (`Send` API) vs. sequential |
| Stop rule | Reflection says "complete", max rounds, or token budget |
| Memory of evidence | Raw chunks vs. compressed notes per sub-question |

Compressing each round into short notes keeps the context small as rounds pile up.

## Gotchas and best practices

- **Budget everything.** Max rounds, max sub-questions per round, max tokens.
- **Deduplicate sub-questions.** Reflection often re-asks what was already searched.
- **Reflection is optimistic or pessimistic depending on the prompt.** Test it on questions you know are unanswerable.
- **Keep citations.** Store the source id with each note so the final answer can cite.
- **Log the plan.** The plan is the easiest place to see why an answer went wrong.

## Key terms

- **Autonomous RAG** — RAG that plans, executes and evaluates its own multi-step retrieval.
- **Query decomposition** — splitting a complex question into simpler sub-questions.
- **Multi-hop question** — needs facts from several documents combined.
- **Reflection step** — the model judges whether gathered evidence is sufficient.
- **Reducer** — a LangGraph function that merges a node's update into state (e.g. list append).

## Interview quick-fire

- **"Agentic vs. autonomous RAG?"** → Agentic decides whether and where to retrieve; autonomous also plans sub-questions and iterates until it judges the evidence complete.
- **"How do you keep it from running forever?"** → Round and token budgets checked in the routing function, plus deduplication of sub-questions.
- **"When is it worth the cost?"** → Multi-hop, comparative or research-style questions where one retrieval can't cover the answer.
