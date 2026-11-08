---
title: "MCP — Model Context Protocol"
---

## TL;DR

**MCP** is an open protocol for plugging tools and data into LLM apps. You write a tool **once** as an **MCP server**, and any **MCP client** (Claude Desktop, Cursor, VS Code, your own agent) can discover and call it. A server exposes three things: **tools** (functions), **resources** (readable data) and **prompts** (templates). It talks JSON-RPC over **stdio** (local subprocess) or **streamable HTTP** (remote service). In Python, use the official `mcp` SDK and its **FastMCP** API.

## The problem MCP solves

Without MCP, every app wires every tool by hand: N apps × M tools integrations. With MCP, each tool is one server, and each app is one client.

```
  Before                          With MCP
  app A ── custom ── Notion       app A ─┐            ┌─ Notion server
  app A ── custom ── GitHub       app B ─┼─ MCP ──────┼─ GitHub server
  app B ── custom ── Notion       app C ─┘            └─ Postgres server
  app B ── custom ── GitHub
```

It builds on [tool calling](../02-calling-models/05-tool-function-calling.md): the client still turns MCP tools into normal tool definitions for the model. MCP just standardizes **how tools are found and invoked**.

## Roles and primitives

```
 Host (Claude Desktop, your agent app)
   └─ Client  ──JSON-RPC──►  Server (your Python process)
      one client per server     exposes: tools, resources, prompts
```

| Primitive | Who decides to use it | Example |
|---|---|---|
| **Tool** | The model | `create_page(title, body)` |
| **Resource** | The app/user | `file://notes/today.md`, `db://schema` |
| **Prompt** | The user | A "summarize this PR" template |

## A server with FastMCP

```bash
pip install "mcp[cli]"
```

```python
# server.py
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("notes")
NOTES: dict[str, str] = {}

@mcp.tool()
def add_note(title: str, body: str) -> str:
    """Save a note under a title."""        # docstring becomes the tool description
    NOTES[title] = body
    return f"Saved '{title}'"

@mcp.tool()
def search_notes(query: str) -> list[str]:
    """Return titles of notes containing the query."""
    return [t for t, b in NOTES.items() if query.lower() in (t + b).lower()]

@mcp.resource("notes://{title}")
def read_note(title: str) -> str:
    """Read one note."""
    return NOTES.get(title, "not found")

@mcp.prompt()
def summarize(title: str) -> str:
    return f"Summarize the note '{title}' in three bullets."

if __name__ == "__main__":
    mcp.run()                                 # stdio by default
```

Type hints become the JSON schema; the docstring becomes the description. Try it with the inspector: `mcp dev server.py`.

## A client that calls it

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(command="python", args=["server.py"])

async def main():
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()                     # handshake
            tools = await session.list_tools()
            print([t.name for t in tools.tools])
            result = await session.call_tool("add_note", {"title": "mcp", "body": "learn it"})
            print(result.content[0].text)

asyncio.run(main())
```

To let an LLM use these, convert each `tool.name`, `tool.description` and `tool.inputSchema` into an OpenAI tool definition, then forward the model's tool calls to `session.call_tool`. Frameworks do this for you: `langchain-mcp-adapters`, AutoGen's `autogen_ext.tools.mcp`, the OpenAI Agents SDK and Google ADK all accept MCP servers.

## Transports: stdio vs streamable HTTP

| | stdio | Streamable HTTP |
|---|---|---|
| How | Client launches server as a subprocess, talks over stdin/stdout | Server runs as a web service; client POSTs JSON-RPC to one endpoint |
| Use for | Local tools, desktop apps, dev | Shared/remote servers, multi-user, cloud deploy |
| Auth | Inherits the user's machine | You need real auth (OAuth or tokens) |
| Run it | `mcp.run()` | `mcp.run(transport="streamable-http")` (serves `/mcp`) |

Older docs mention an **SSE** transport. It has been superseded by streamable HTTP; prefer the latter for new servers.

```python
# remote client
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client("http://localhost:8000/mcp") as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
```

## Gotchas

- **Never print to stdout in a stdio server.** stdout is the protocol channel; log to stderr.
- **Tool descriptions are prompts.** Vague descriptions mean wrong tool choices.
- **Too many tools hurt.** Dozens of tools from several servers bloat context and confuse the model. Expose only what the agent needs.
- **Third-party servers are untrusted code.** A malicious server can return injected instructions in tool results or descriptions. Review them and pin versions.
- **Return small, structured results.** Don't dump a whole database into the context.

## Key terms

- **MCP server** — a process that exposes tools, resources and prompts over MCP.
- **MCP client** — the connector inside a host app that talks to one server.
- **Host** — the app the user interacts with (IDE, chat app, your agent).
- **FastMCP** — the decorator-based server API in the official Python SDK.
- **stdio transport** — JSON-RPC over a subprocess's stdin/stdout.
- **Streamable HTTP** — JSON-RPC over HTTP POST to a single endpoint, with optional streaming responses.

## Interview quick-fire

- **"MCP vs. plain function calling?"** → Function calling is how a model asks to run a tool; MCP is a standard for packaging and discovering tools so any app can use them without custom glue.
- **"Tools vs. resources?"** → Tools are actions the model chooses to call; resources are data the app chooses to load into context.
- **"When stdio, when HTTP?"** → stdio for local single-user tools; streamable HTTP for remote, shared or deployed servers that need auth.
- **"Main MCP security risk?"** → Untrusted servers or tool outputs injecting instructions, and over-permissioned tools. Use least privilege and review servers.
