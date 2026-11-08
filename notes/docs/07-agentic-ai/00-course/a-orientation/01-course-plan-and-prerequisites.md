---
title: "Course Plan and Prerequisites"
---

## TL;DR

This course takes you from "I can call an LLM" to **shipping multi-agent systems in production**. It moves in a fixed order: **foundations → Python tooling → LangChain agents → LangGraph → one chatbot built end to end → MCP and subgraphs → capstones → safety and ops**. You need **solid Python**, comfort with **calling a chat API**, and basic **git, terminal and Docker**. Everything else is taught on the way.

## What the course covers

| Module | Focus | What you leave with |
|---|---|---|
| A · Orientation | Plan, prerequisites, roadmap | A study schedule and a working dev environment |
| B · Foundations | LLM vs. agent, agent components | A mental model of the agent loop |
| C · Python for agents | `asyncio`, Pydantic | Concurrent LLM calls, validated tool inputs and outputs |
| D · LangChain agents | Single agent, multi-agent research assistant | Working tool-calling agents in a few lines |
| E · LangGraph core | State, nodes, edges, workflow patterns | Explicit, controllable agent graphs |
| F · Build an agentic chatbot | Persistence, streaming, tracing, tools, HITL, deploy | One production-style chatbot, deployed |
| G · MCP and subgraphs | Model Context Protocol, nested graphs | Reusable tools and modular graphs |
| H · Capstone builds | Multi-agent pipelines, supervisors, guardrails | Five portfolio projects |
| I · Safety, quality, ops | Harness and loop engineering | Agents that fail safely and can be measured |
| J · FDE track | Forward-deployed engineer role | A path from problem statement to production |

Module F is the spine. Each note adds one feature to the **same chatbot**, so do them in order.

## Prerequisites

**Must have:**

- **Python** — functions, classes, type hints, virtual environments, `pip`. Decorators and context managers should not surprise you.
- **LLM API basics** — messages and roles, a chat completion call, reading `response.choices[0].message`. See [chat APIs](../../../02-calling-models/01-chat-apis.md).
- **Tool calling** — the request → tool call → result loop. Agents are this loop repeated. See [tool / function calling](../../../02-calling-models/05-tool-function-calling.md).
- **Git and a terminal** — clone, commit, push, environment variables.

**Nice to have (taught when needed):**

- `async`/`await` (module C covers it).
- Docker and GitHub Actions (module F covers enough to deploy).
- Basic SQL, for checkpointers and logs.
- RAG concepts, for agents that search documents.

## Environment setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install openai langchain langchain-openai langgraph langsmith pydantic python-dotenv
```

`.env` (add it to `.gitignore`):

```
OPENAI_API_KEY=sk-...
LANGSMITH_API_KEY=lsv2_...        # optional until module F
TAVILY_API_KEY=tvly-...           # web search tool, used from module D
```

A quick smoke test before you start:

```python
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini")
print(llm.invoke("Say 'ready' and nothing else.").content)
```

If that prints `ready`, you are set. The course defaults to OpenAI's `gpt-4o-mini` because it is cheap and supports tool calling well. Any tool-calling model works: swap in `langchain-anthropic`, `langchain-google-genai`, or a local model via `langchain-ollama`.

## Cost and accounts

- **API spend** stays small if you use a mini-class model and short prompts. Set a **monthly budget limit** in your provider dashboard on day one.
- **LangSmith** has a free developer tier, enough for tracing all the course projects.
- **Tavily** (web search) has a free tier.
- **Deployment** uses AWS (pay as you go, stop instances when done) and Render (free tier).

## Study tips

- **Type the code, don't paste it.** You learn the APIs through your fingers and your errors.
- **Trace everything.** Turn on LangSmith early; reading a trace teaches you more than reading the code.
- **Change one thing, predict, run.** Swap a prompt, remove a tool, break a reducer, and guess the result first.
- **Keep one repo** for the module F chatbot and commit after each note. The git history becomes your notes.
- **Expect non-determinism.** The same input can take a different path. Test with several runs, not one.

## Gotchas

- Library APIs move fast. LangChain 1.x replaced older agent classes (`AgentExecutor`, `initialize_agent`); old tutorials will not run as written.
- Pin versions in `requirements.txt` once something works.
- Never commit `.env`. Rotate any key that ends up in git history.

## Key terms

- **Agent** — an LLM in a loop that decides which tools to call until a goal is met.
- **LangChain** — a library of model wrappers, tools and a high-level agent constructor.
- **LangGraph** — a library for building agents as explicit graphs of state, nodes and edges.
- **LangSmith** — a tracing and evaluation platform for LLM apps.
- **Checkpointer** — LangGraph component that saves graph state so conversations survive restarts.
- **HITL** — human-in-the-loop: pausing an agent for a person to approve or edit an action.

## Interview quick-fire

- **"What do you need to know before building agents?"** → Python, how chat APIs and tool calling work, and basic deployment. Agent frameworks sit on top of those.
- **"Why learn LangChain and LangGraph both?"** → LangChain gives quick agents and integrations; LangGraph gives explicit control over state, branching, persistence and human approval when the quick agent is not enough.
- **"How do you keep agent experiments cheap?"** → Small models, short prompts, provider budget limits, and tracing to spot loops that burn tokens.
