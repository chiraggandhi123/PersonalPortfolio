---
title: "A2A — Agent-to-Agent Communication"
---

## TL;DR

**A2A (Agent2Agent)** is an open protocol, started by Google and now under the Linux Foundation, for letting **independent agents talk to each other** across frameworks and companies. Each agent publishes an **Agent Card** (a JSON file describing what it can do and how to reach it); other agents send it **messages** and track the work as **tasks** over HTTP with JSON-RPC. **MCP connects an agent to tools; A2A connects an agent to other agents.** The spec is still evolving, so check the current docs for exact field and method names.

## MCP vs A2A

```
             ┌──────── A2A ────────┐
  Travel agent ◄─────────────────► Flight agent ── MCP ──► airline API tool
  (LangGraph)                      (Google ADK)
       │
       └── MCP ──► calendar tool
```

| | MCP | A2A |
|---|---|---|
| Connects | Agent ↔ tool/data | Agent ↔ agent |
| Other side is | A function with a schema | An opaque agent with its own reasoning, tools and memory |
| Typical call | Short, synchronous | Can be long-running, multi-turn, streaming |
| Discovery | `list_tools` on a server you configured | Agent Card at a well-known URL |

They are complementary. A remote agent can expose itself over A2A and use MCP internally.

## Core concepts

| Concept | What it is |
|---|---|
| **Agent Card** | JSON metadata: name, description, endpoint URL, skills, supported input/output types, auth requirements. Served at a well-known path (e.g. `/.well-known/agent.json`; newer versions use `agent-card.json`) |
| **Skill** | One capability listed on the card, with a description and examples |
| **Message** | One turn from a client or the remote agent, made of **parts** (text, file, structured data) |
| **Task** | A unit of work with an ID and a lifecycle state; lets long jobs be tracked |
| **Artifact** | An output produced by a task (a report, a file, JSON) |

Task states look roughly like this:

```
submitted ──► working ──► completed
                 │  ▲
                 ▼  │
          input-required        (remote agent asks the caller a question)
                 │
                 └──► failed / canceled
```

## An Agent Card (illustrative)

```json
{
  "name": "Flight Search Agent",
  "description": "Finds and compares flights between cities.",
  "url": "https://flights.example.com/a2a",
  "version": "1.0.0",
  "capabilities": { "streaming": true },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text", "application/json"],
  "skills": [
    {
      "id": "search_flights",
      "name": "Search flights",
      "description": "Search flights by origin, destination and date.",
      "examples": ["Flights from Pune to Delhi on 12 Dec"]
    }
  ]
}
```

## Calling a remote agent

Under the hood, a client fetches the card, then POSTs a JSON-RPC request. This raw sketch shows the shape (method names have changed between spec versions, so treat them as an example):

```python
import uuid, httpx

base = "https://flights.example.com"
card = httpx.get(f"{base}/.well-known/agent.json").json()

request = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
        "message": {
            "role": "user",
            "messageId": str(uuid.uuid4()),
            "parts": [{"kind": "text", "text": "Cheapest flight Pune → Delhi on 12 Dec"}],
        }
    },
}
resp = httpx.post(card["url"], json=request, timeout=60).json()
print(resp["result"])     # a Task (with id + status) or a direct Message
```

In practice use an SDK rather than raw JSON: the official `a2a-sdk` Python package provides a client and a server helper, and Google ADK can expose an agent over A2A or consume a remote A2A agent with little code.

## When to use A2A

- **Use it** when agents are owned by different teams or vendors, run as separate services, or are built with different frameworks.
- **Skip it** when all your agents live in one process. A LangGraph supervisor or a CrewAI crew is simpler than a network protocol.
- **Treat remote agents as untrusted.** Their output is input to your agent and can carry prompt injection. Authenticate both sides.

## Gotchas

- **The spec moves.** Field names, method names and the card path have changed across versions. Pin an SDK version and read its docs.
- **Long tasks need polling or streaming.** Don't block an HTTP request for minutes; use task IDs, streaming or push notifications.
- **Agent Cards are self-descriptions.** A card claiming a skill doesn't prove the agent is good at it. Evaluate before trusting.

## Key terms

- **A2A** — open protocol for communication between independent agents.
- **Agent Card** — public JSON describing an agent's skills, endpoint and auth.
- **Task** — a stateful unit of work with an ID and lifecycle (working, input-required, completed, ...).
- **Part** — a piece of a message: text, file or structured data.
- **Artifact** — an output a task produces.

## Interview quick-fire

- **"MCP vs A2A in one line?"** → MCP gives an agent tools; A2A lets an agent delegate to another agent.
- **"How does one agent discover another in A2A?"** → It fetches the Agent Card from a well-known URL, which lists skills, endpoint and auth.
- **"Why have tasks instead of plain request/response?"** → Agent work can be long and multi-turn; a task ID lets the caller track progress, answer follow-up questions and get artifacts later.
- **"When would you not use A2A?"** → When all agents run in the same codebase; an in-process orchestrator is simpler.
