---
title: "Agentic AI Learning Roadmap"
---

## TL;DR

Learn agents in layers: **understand the loop**, then **use a framework**, then **take control of the graph**, then **make it production-grade** (memory, streaming, tracing, approval, deployment), then **scale to multiple agents**. Each layer depends on the one below. Skipping to multi-agent systems before you can debug a single agent is the most common way to get stuck.

## The layers

```
 Level 5  Multi-agent systems      supervisors, pipelines, MCP, subgraphs
 Level 4  Production               persistence, streaming, tracing, HITL, CI/CD
 Level 3  Explicit control         LangGraph: state, nodes, edges, routing
 Level 2  Framework agents         LangChain create_agent + tools
 Level 1  The agent loop           LLM + tool calling + a while loop
 Level 0  LLM basics               prompts, messages, structured output
```

| Level | You can... | Proof you're ready to move on |
|---|---|---|
| 0 | Call a model, get JSON back | Extract a Pydantic object from messy text |
| 1 | Write a tool loop by hand | Agent that answers with a calculator and a search tool, no framework |
| 2 | Build an agent in a few lines | Explain what `create_agent` does under the hood |
| 3 | Design a graph | Draw your state, nodes and edges before writing code |
| 4 | Ship it | A deployed chatbot that remembers threads and asks before risky actions |
| 5 | Coordinate agents | Explain why your system needs more than one agent |

## Suggested timeline

At around 8–10 hours a week:

| Weeks | Modules | Focus |
|---|---|---|
| 1 | A, B | Concepts, environment, a hand-written agent loop |
| 2 | C | `asyncio` and Pydantic until they feel routine |
| 3 | D | LangChain agents, then a small multi-agent research assistant |
| 4–5 | E | LangGraph state, reducers, conditional edges, workflow patterns |
| 6–8 | F | The chatbot: one feature per sitting, deploy at the end |
| 9 | G | MCP servers and subgraphs |
| 10–13 | H | Capstones, one per week or so |
| 14 | I, J | Safety, evaluation, ops, and the FDE track |

Stretch it if needed. Finishing module F properly matters more than rushing the capstones.

## Workflow vs. agent: the main idea to keep

Most real systems are a mix of fixed steps and model-driven choices.

```
Workflow:  input ──► step A ──► step B ──► step C ──► output     (you choose the path)

Agent:     input ──► LLM ──► tool? ──yes──► run tool ──┐
                      ▲                                │         (the model chooses the path)
                      └────────────────────────────────┘
                      └──no──► output
```

Start with the simplest thing that works: a single call, then a workflow, then an agent. Add autonomy only when fixed steps can't handle the variety of inputs.

## Skills checklist

- **Prompting** — system prompts, few-shot examples, clear tool descriptions.
- **Structured data** — Pydantic models for tool arguments, outputs and state.
- **Async Python** — concurrent tool calls and streaming without blocking.
- **Graph design** — state schema, reducers, routing functions.
- **Observability** — read a LangSmith trace and find the bad step.
- **Evaluation** — a small test set and a way to score runs.
- **Deployment** — Docker, environment variables, a CI pipeline.
- **Safety** — approval gates, input/output guardrails, iteration limits.

## Common traps

- **Framework-first learning.** If you can't write the tool loop by hand, framework errors will be opaque.
- **Too many tools.** Ten overlapping tools confuse the model. Start with two or three.
- **Multi-agent by default.** One agent with good tools often beats three agents passing messages.
- **No tracing.** Without traces you are guessing why the agent did something.
- **Testing once.** Agents are non-deterministic; run each test several times.

## A hand-written loop to start (level 1)

```python
import json
from openai import OpenAI

client = OpenAI()
tools = [{"type": "function", "function": {
    "name": "add", "description": "Add two numbers.",
    "parameters": {"type": "object",
                   "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                   "required": ["a", "b"]}}}]

messages = [{"role": "user", "content": "What is 1234.5 + 98.7?"}]
for _ in range(5):                                   # iteration cap
    msg = client.chat.completions.create(
        model="gpt-4o-mini", messages=messages, tools=tools
    ).choices[0].message
    if not msg.tool_calls:
        print(msg.content)
        break
    messages.append(msg)
    for call in msg.tool_calls:
        args = json.loads(call.function.arguments)
        messages.append({"role": "tool", "tool_call_id": call.id,
                         "content": str(args["a"] + args["b"])})
```

Every framework in this course is a more structured version of these fifteen lines.

## Key terms

- **Workflow** — a system where code defines the sequence of LLM calls and tools.
- **Agent** — a system where the LLM decides the next step at run time.
- **Autonomy** — how much of the control flow the model decides instead of your code.
- **Orchestration** — the code or framework that runs the loop, routes between steps and holds state.
- **Multi-agent system** — several specialized agents coordinated by a supervisor or a fixed pipeline.

## Interview quick-fire

- **"Workflow or agent: how do you choose?"** → Use a workflow when the steps are known and stable; use an agent when the path depends on the input and can't be enumerated. Prefer the simpler option.
- **"What's the first thing you'd build to learn agents?"** → A tool-calling loop by hand with a cap on iterations, then the same thing in a framework.
- **"When is multi-agent worth it?"** → When tasks need clearly separate roles, tools or contexts, and a single agent's prompt and toolset has become too large to work reliably.
