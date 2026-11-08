---
title: "AI Agents & Agentic AI (intro)"
---

## TL;DR

An **AI agent** is an LLM that runs in a **loop**: it decides on an action (usually a **tool call**), observes the result, and decides again until the task is done. A plain RAG chain always retrieves once, then answers; an **agent decides whether, what and how often** to retrieve, and can use other tools too. **Agentic AI** is the broader idea of systems that plan and act with some autonomy. Agents are more flexible but slower, costlier and harder to test, so use a **fixed workflow when the steps are known** and an agent when they aren't.

## Chain vs. workflow vs. agent

```
Chain (fixed):      question ──► retrieve ──► generate ──► answer

Workflow (branches, code decides):
                    question ──► classify ──┬─► HR index ──► generate
                                            └─► SQL      ──► generate

Agent (LLM decides, loops):
                    question ──► LLM ──► tool? ──yes──► run tool ──► observe ──┐
                                  ▲                                            │
                                  └────────────────────────────────────────────┘
                                         └─no──► final answer
```

| | Chain | Workflow | Agent |
|---|---|---|---|
| Who decides the steps | You (code) | You, with LLM-made branch choices | The LLM |
| Number of steps | Fixed | Bounded | Open-ended |
| Predictability | High | High | Lower |
| Cost / latency | Low | Medium | Higher, variable |
| Good for | Simple Q&A | Known multi-step processes | Open-ended tasks, research, tool use |

## The building blocks

| Block | What it is |
|---|---|
| **Model** | The LLM that reasons and picks actions |
| **Tools** | Functions the model can call: retriever, web search, SQL, APIs, calculator |
| **Loop** | Run model → execute tool calls → feed results back → repeat |
| **Memory** | Conversation history (short-term) and stored facts (long-term) |
| **Instructions** | System prompt describing role, tools and stopping rules |
| **Guardrails** | Iteration limits, permission checks, human approval for risky actions |

The loop is the [tool calling loop](../02-calling-models/05-tool-function-calling.md) run until the model stops asking for tools. The popular **ReAct** pattern (Reason + Act) is this loop with the model thinking before each action.

## A retrieval agent in a few lines (LangChain v1)

```python
from langchain.agents import create_agent
from langchain.tools import tool

# `vectorstore` is the Chroma store from earlier notes
retriever = vectorstore.as_retriever(search_kwargs={"k": 4})

@tool
def search_handbook(query: str) -> str:
    """Search the employee handbook. Use for questions about leave, benefits, travel or IT policy."""
    docs = retriever.invoke(query)
    return "\n\n".join(f"[{d.metadata.get('source')} p{d.metadata.get('page')}] {d.page_content}" for d in docs)

@tool
def days_between(start: str, end: str) -> int:
    """Number of days between two ISO dates (YYYY-MM-DD)."""
    from datetime import date
    return (date.fromisoformat(end) - date.fromisoformat(start)).days

agent = create_agent(
    model="openai:gpt-4o-mini",
    tools=[search_handbook, days_between],
    system_prompt="You are an HR assistant. Use search_handbook for policy facts and cite sources. "
                  "If the handbook doesn't cover it, say so.",
)

result = agent.invoke({"messages": [{"role": "user",
    "content": "I joined on 2025-01-15. Am I past probation on 2025-06-01?"}]})
print(result["messages"][-1].content)
```

The agent may search for the probation length, call `days_between`, then answer. A fixed chain couldn't do the date arithmetic or choose to skip retrieval for small talk.

## Agentic RAG in one sentence each

Later notes cover these in depth:

- **Agentic RAG** — retrieval is a tool the agent calls as needed, possibly several times with rewritten queries.
- **Corrective RAG** — grade retrieved docs; if they're poor, rewrite the query or fall back to web search.
- **Self / adaptive RAG** — the system decides whether to retrieve at all and checks its own answer for grounding.
- **Multi-agent RAG** — specialized agents (researcher, writer, reviewer) cooperate.

## When to use an agent

Use an agent when:

- The steps depend on intermediate results ("search, then maybe search again").
- There are several tools or sources and the right one isn't obvious from the query.
- The task is open-ended (research, debugging, multi-hop questions).

Stay with a chain or workflow when:

- The steps are always the same.
- Latency or cost budgets are tight.
- You need fully predictable, auditable behavior.

## Gotchas

- **Loops can run away.** Set a max number of steps (LangGraph's `recursion_limit`) and a timeout.
- **Tool descriptions are prompts.** Vague descriptions mean wrong or missing tool calls.
- **Errors should go back to the model** as tool results, so it can retry instead of crashing.
- **Irreversible actions need approval.** Sending emails, payments or deletes should require a human check in code.
- **Evaluate trajectories, not just answers.** Check which tools were called and how many times (LangSmith traces help).

## Key terms

- **Agent** — an LLM in a loop that chooses actions (tool calls) and observes their results.
- **Agentic AI** — systems that plan and act toward goals with some autonomy.
- **Tool** — a function the agent can call, described by a name, description and schema.
- **ReAct** — prompting pattern that interleaves reasoning steps with actions and observations.
- **Workflow** — a predefined sequence of steps, possibly with LLM-chosen branches.
- **Agentic RAG** — RAG where the agent decides when and how to retrieve.

## Interview quick-fire

- **"What makes something an agent rather than a chain?"** → The LLM decides the control flow: which tool to call next and when to stop, in a loop.
- **"When would you not use an agent?"** → When the steps are fixed and known; a chain or workflow is cheaper, faster and more predictable.
- **"How is agentic RAG different from basic RAG?"** → Retrieval becomes a tool the model can call zero, one or many times with its own queries, instead of a fixed single retrieval step.
- **"How do you stop an agent looping forever?"** → Max iterations or recursion limit, timeouts, and clear stopping instructions.
