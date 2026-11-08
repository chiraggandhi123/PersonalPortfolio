---
title: "LangGraph Workflows"
---

## TL;DR

Most useful LLM systems are built from a handful of **workflow patterns**: **prompt chaining** (steps in sequence), **routing** (classify, then branch), **parallelization** (fan out, then merge), **orchestrator–workers** (plan, then dispatch sub-tasks), and **evaluator–optimizer** (generate, grade, loop). The **agent** loop is the open-ended one, where the model picks tools until done. In LangGraph, each pattern is just a particular shape of nodes and edges. Use the simplest one that fits.

## The patterns at a glance

```
Chaining:        START ─► A ─► B ─► C ─► END
Routing:         START ─► classify ─┬─► billing ─┐
                                    └─► tech ────┴─► END
Parallel:        START ─┬─► A ─┐
                        ├─► B ─┼─► merge ─► END
                        └─► C ─┘
Orch–workers:    START ─► plan ─Send×N─► worker ─► synthesize ─► END
Eval–optimizer:  START ─► generate ─► evaluate ─pass─► END
                             ▲            │
                             └────fail────┘
Agent:           START ─► model ⇄ tools ─► END
```

| Pattern | Use when | Cost |
|---|---|---|
| Chaining | Task splits into fixed steps | Low |
| Routing | Inputs fall into distinct categories | Low |
| Parallelization | Independent sub-tasks, or several views of one input | Medium |
| Orchestrator–workers | Sub-tasks aren't known until run time | Medium–high |
| Evaluator–optimizer | Quality can be judged and improved by iterating | Medium–high |
| Agent | Path can't be predicted at all | Highest, least predictable |

All examples share this setup:

```python
from typing import Annotated, Literal, TypedDict
from operator import add
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

llm = ChatOpenAI(model="gpt-4o-mini")
```

## Routing

```python
class Route(BaseModel):
    category: Literal["billing", "technical", "general"]

class S(TypedDict):
    question: str
    category: str
    answer: str

router_llm = llm.with_structured_output(Route)

def classify(s: S): return {"category": router_llm.invoke(s["question"]).category}
def billing(s: S):  return {"answer": llm.invoke(f"As billing support: {s['question']}").content}
def technical(s: S):return {"answer": llm.invoke(f"As a support engineer: {s['question']}").content}
def general(s: S):  return {"answer": llm.invoke(s["question"]).content}

b = StateGraph(S)
for name, fn in [("classify", classify), ("billing", billing),
                 ("technical", technical), ("general", general)]:
    b.add_node(name, fn)
b.add_edge(START, "classify")
b.add_conditional_edges("classify", lambda s: s["category"])   # returns a node name
for n in ["billing", "technical", "general"]:
    b.add_edge(n, END)
router = b.compile()
```

Structured output makes the routing decision reliable: the model can only return one of three labels.

## Parallelization

```python
class P(TypedDict):
    text: str
    reviews: Annotated[list[str], add]     # reducer merges parallel writes
    summary: str

def tone(s: P):     return {"reviews": ["Tone: " + llm.invoke(f"Critique tone:\n{s['text']}").content]}
def facts(s: P):    return {"reviews": ["Facts: " + llm.invoke(f"Check claims:\n{s['text']}").content]}
def merge(s: P):    return {"summary": llm.invoke("Combine:\n" + "\n".join(s["reviews"])).content}

b = StateGraph(P)
b.add_node("tone", tone); b.add_node("facts", facts); b.add_node("merge", merge)
b.add_edge(START, "tone"); b.add_edge(START, "facts")       # fan out
b.add_edge(["tone", "facts"], "merge")                      # wait for both
b.add_edge("merge", END)
parallel = b.compile()
```

## Orchestrator–workers

```python
class Plan(BaseModel):
    sections: list[str]

class O(TypedDict):
    topic: str
    sections: list[str]
    drafts: Annotated[list[str], add]
    report: str

def plan(s: O):
    return {"sections": llm.with_structured_output(Plan).invoke(
        f"List 3-5 section titles for a report on {s['topic']}").sections}

def assign(s: O):
    return [Send("worker", {"section": sec, "topic": s["topic"]}) for sec in s["sections"]]

def worker(w: dict):
    return {"drafts": [llm.invoke(f"Write the '{w['section']}' section about {w['topic']}.").content]}

def synthesize(s: O):
    return {"report": "\n\n".join(s["drafts"])}

b = StateGraph(O)
b.add_node("plan", plan); b.add_node("worker", worker); b.add_node("synthesize", synthesize)
b.add_edge(START, "plan")
b.add_conditional_edges("plan", assign, ["worker"])
b.add_edge("worker", "synthesize"); b.add_edge("synthesize", END)
orchestrator = b.compile()
```

`Send` creates one worker run per section, at run time. The number of workers depends on the plan.

## Evaluator–optimizer

```python
class Grade(BaseModel):
    passed: bool
    feedback: str

class E(TypedDict):
    task: str
    draft: str
    feedback: str
    passed: bool
    attempts: int

def generate(s: E):
    prompt = s["task"] + (f"\nFix this feedback: {s['feedback']}" if s.get("feedback") else "")
    return {"draft": llm.invoke(prompt).content, "attempts": s.get("attempts", 0) + 1}

def evaluate(s: E):
    g = llm.with_structured_output(Grade).invoke(
        f"Task: {s['task']}\nDraft: {s['draft']}\nIs it correct, clear and under 100 words?")
    return {"passed": g.passed, "feedback": g.feedback}

b = StateGraph(E)
b.add_node("generate", generate); b.add_node("evaluate", evaluate)
b.add_edge(START, "generate"); b.add_edge("generate", "evaluate")
b.add_conditional_edges("evaluate",
    lambda s: END if s["passed"] or s["attempts"] >= 3 else "generate")
optimizer = b.compile()
```

Always cap the loop (`attempts >= 3`). A grader that never passes will otherwise burn tokens until the recursion limit.

## Choosing a pattern

- Can you **write the steps down** in advance? Chaining or routing.
- Are sub-tasks **independent**? Parallelize.
- Do sub-tasks depend on the input? Orchestrator–workers.
- Is there a **clear quality bar**? Evaluator–optimizer.
- None of the above? An agent, with tools and a step limit.

Patterns compose: a router can send one branch to an agent and another to a chain.

## Key terms

- **Prompt chaining** — a fixed sequence of LLM calls, each using the previous output.
- **Routing** — classifying an input and sending it down a specialized branch.
- **Parallelization** — running independent nodes at the same time and merging results.
- **Orchestrator–workers** — a planner splits work into sub-tasks at run time and dispatches workers.
- **Evaluator–optimizer** — a loop where one step generates and another grades and gives feedback.
- **Fan-in** — a node that waits for several parallel branches before running.

## Interview quick-fire

- **"Workflow vs. agent in LangGraph?"** → A workflow has paths defined by your edges; an agent lets the model choose the next step, usually a model–tools loop.
- **"How do you implement map-reduce in LangGraph?"** → A conditional edge returns a list of `Send` objects to fan out, and a reducer like `operator.add` collects results for a fan-in node.
- **"How do you stop an evaluator loop from running forever?"** → Keep an attempt counter in state and route to END after N tries, with `recursion_limit` as a backstop.
- **"Why use structured output for routing?"** → It restricts the decision to valid branch names, so the router can't return something your edges don't handle.
