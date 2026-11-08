---
title: "What is MCP and Why Agents Need It"
---

## TL;DR

The **Model Context Protocol (MCP)** is an open standard for connecting LLM apps to tools and data. A **server** exposes tools, resources and prompts once, and any **MCP client** (Claude Desktop, Cursor, your LangGraph agent) can use them. It turns the "N apps × M integrations" problem into **N + M**. For an agent, an MCP server is just a source of tools that someone else wrote and maintains.

## The problem MCP solves

Without MCP, every agent framework writes its own GitHub, Slack and Postgres wrappers, each with a different schema. With MCP:

```
Before:  agent A ─┬─ github wrapper (A's format)      After:  agent A ─┐            ┌─ github server
                  ├─ slack wrapper  (A's format)              agent B ─┼─ MCP ──────┼─ slack server
         agent B ─┬─ github wrapper (B's format)              IDE     ─┘            └─ postgres server
                  └─ slack wrapper  (B's format)
```

It plays the same role for agents that USB-C plays for devices, or LSP plays for editors and languages.

## Architecture

```
┌──────────── Host (your app / IDE / Claude Desktop) ────────────┐
│   LLM  ◄──►  MCP client ──┐     MCP client ──┐                  │
└───────────────────────────┼──────────────────┼──────────────────┘
                            │ stdio             │ Streamable HTTP
                     ┌──────▼──────┐     ┌──────▼──────┐
                     │ MCP server  │     │ MCP server  │
                     │ (local FS)  │     │ (remote API)│
                     └─────────────┘     └─────────────┘
```

| Piece | Role |
|---|---|
| **Host** | The app the user talks to. Owns the LLM and decides which servers to trust |
| **Client** | One connection to one server, inside the host |
| **Server** | A program that exposes capabilities over JSON-RPC |
| **Transport** | `stdio` (local subprocess) or Streamable HTTP (remote; older servers use SSE) |

## What a server exposes

| Primitive | Controlled by | Example |
|---|---|---|
| **Tools** | The model (it decides to call them) | `create_issue(title, body)` |
| **Resources** | The app (attached as context) | `file:///repo/README.md` |
| **Prompts** | The user (picked from a menu) | "Summarize this PR" template |

Most agent work uses tools. Resources and prompts matter more in IDE-style hosts.

## Writing a server (official Python SDK)

```python
# server.py   —  pip install "mcp[cli]"
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather")

@mcp.tool()
def get_forecast(city: str) -> str:
    """Get today's forecast for a city."""
    return f"{city}: 31°C, sunny"        # call a real API here

@mcp.resource("config://units")
def units() -> str:
    return "celsius"

if __name__ == "__main__":
    mcp.run()          # stdio by default; mcp.run(transport="streamable-http") for remote
```

The type hints and docstring become the tool's JSON schema and description, exactly like a normal tool definition.

## Using MCP tools in a LangGraph agent

`langchain-mcp-adapters` converts MCP tools into LangChain tools, so any agent can use them.

```python
# pip install langchain-mcp-adapters langgraph langchain-openai
import asyncio
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

async def main():
    client = MultiServerMCPClient({
        "weather": {"command": "python", "args": ["server.py"], "transport": "stdio"},
        "docs":    {"url": "http://localhost:8000/mcp", "transport": "streamable_http"},
    })
    tools = await client.get_tools()
    agent = create_react_agent("openai:gpt-4o-mini", tools)
    result = await agent.ainvoke({"messages": [{"role": "user", "content": "Weather in Pune?"}]})
    print(result["messages"][-1].content)

asyncio.run(main())
```

The adapter API has changed between versions, so check its README if this snippet fails. OpenAI's Agents SDK, Google ADK and AutoGen all ship their own MCP client wrappers too.

## MCP vs plain function calling

| | Function calling | MCP |
|---|---|---|
| What it is | An API feature of one model provider | A protocol between apps and tool servers |
| Where tools live | In your process | In a separate server (local or remote) |
| Reuse | Copy code between projects | Any MCP host can connect |
| Underneath | — | Still uses function calling to let the model pick tools |

MCP doesn't replace function calling. It standardizes how tools are discovered and invoked, then hands them to the model as normal tool definitions.

## Gotchas and best practices

- **Tool overload.** Connecting five servers can add 80 tools. Accuracy drops and token cost rises. Filter tools per agent.
- **Trust.** A server runs code and its tool descriptions go straight into your prompt. A malicious server can inject instructions ("tool poisoning"). Only install servers you trust, and pin versions.
- **Auth.** Remote servers should use OAuth. Never put long-lived secrets in tool arguments.
- **Destructive tools.** Gate writes and deletes behind human approval (see [human-in-the-loop](../f-build-an-agentic-chatbot/06-human-in-the-loop-with-interrupt.md)).
- **Async.** Most MCP clients are async. Keep the session open for the agent's lifetime, not one per call.
- **Debugging.** `mcp dev server.py` opens the MCP Inspector to call tools by hand.

## Key terms

- **MCP** — open protocol (JSON-RPC based) for connecting LLM hosts to tool and data servers.
- **Host** — the user-facing app that runs the model and owns MCP clients.
- **MCP server** — a process exposing tools, resources and prompts.
- **Transport** — how messages travel: stdio for local, Streamable HTTP for remote.
- **Tool poisoning** — hiding malicious instructions inside a tool's description or output.

## Interview quick-fire

- **"What problem does MCP solve?"** → It standardizes tool integrations, so one server works with every MCP-capable host, turning N×M custom integrations into N+M.
- **"Is MCP a replacement for function calling?"** → No. It's a discovery and transport layer. The model still selects tools via function calling.
- **"Tools vs resources vs prompts?"** → Tools are model-invoked actions, resources are app-attached context, prompts are user-selected templates.
- **"Main security risk?"** → Untrusted servers: tool descriptions and outputs are prompt input, so they can inject instructions. Vet servers, limit scopes, require approval for writes.
