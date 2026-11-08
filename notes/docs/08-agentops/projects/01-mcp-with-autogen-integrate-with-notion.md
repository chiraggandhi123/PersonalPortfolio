---
title: "MCP with AutoGen — Integrate with Notion"
---

## Goal

Build an [AutoGen](../../07-agentic-ai/04-microsoft-autogen.md) agent that can **search, read and write your Notion workspace through MCP**, without writing any Notion API code yourself. The agent gets its tools from Notion's MCP server, and you add one small custom MCP server of your own to see both sides of the protocol.

**Skills practiced:** MCP clients and servers, stdio transport, AutoGen AgentChat, tool discovery, scoped API tokens, agent termination.

## Architecture

```
you ──► AutoGen AssistantAgent (gpt-4o-mini)
              │  tools discovered at startup
              ├── MCP stdio ──► Notion MCP server (npx)  ──► Notion API
              │                 search, get page, create page, ...
              └── MCP stdio ──► my_tools.py (FastMCP)
                                today(), word_count()
```

AutoGen's `mcp_server_tools` launches each server, calls `list_tools`, and wraps every MCP tool as an AutoGen tool.

## Setup

1. In Notion: **Settings → Connections → Develop or manage integrations → New integration**. Copy the internal integration token. Give it read and insert content capabilities only.
2. Open the pages the agent may use, click **... → Connections**, and add your integration. It sees nothing else.
3. Install (Node.js is needed for `npx`):

```bash
pip install "autogen-agentchat" "autogen-ext[openai,mcp]" "mcp[cli]" python-dotenv
```

4. `.env`:

```
OPENAI_API_KEY=sk-...
NOTION_TOKEN=ntn_...
```

Notion also offers a hosted remote MCP server with OAuth. This project uses the local open-source server (`@notionhq/notion-mcp-server`) because it works with a plain token. Check its README for the current env variable name; older versions expected the token inside an `OPENAPI_MCP_HEADERS` JSON value.

## Code — `my_tools.py` (your own MCP server)

```python
from datetime import date
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-tools")

@mcp.tool()
def today() -> str:
    """Return today's date in ISO format. Use when a page needs a date."""
    return date.today().isoformat()

@mcp.tool()
def word_count(text: str) -> int:
    """Count words in a piece of text."""
    return len(text.split())

if __name__ == "__main__":
    mcp.run()          # stdio
```

## Code — `agent.py`

```python
import asyncio, os
from dotenv import load_dotenv
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import TextMentionTermination, MaxMessageTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.ui import Console
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_ext.tools.mcp import StdioServerParams, mcp_server_tools

load_dotenv()

notion_server = StdioServerParams(
    command="npx",
    args=["-y", "@notionhq/notion-mcp-server"],
    env={"NOTION_TOKEN": os.environ["NOTION_TOKEN"], "PATH": os.environ["PATH"]},
    read_timeout_seconds=60,
)
my_server = StdioServerParams(command="python", args=["my_tools.py"])

SYSTEM = """You manage the user's Notion workspace.
- Search before creating, to avoid duplicates.
- Never delete or archive anything.
- When the task is done, summarize what you changed and end with TERMINATE."""

async def main(task: str):
    tools = await mcp_server_tools(notion_server) + await mcp_server_tools(my_server)
    print("Tools:", [t.name for t in tools])

    agent = AssistantAgent(
        name="notion_agent",
        model_client=OpenAIChatCompletionClient(model="gpt-4o-mini"),
        tools=tools,
        system_message=SYSTEM,
        reflect_on_tool_use=True,       # summarize tool results in natural language
        max_tool_iterations=8,          # recent AutoGen versions; drop if unsupported
    )
    team = RoundRobinGroupChat(
        [agent],
        termination_condition=TextMentionTermination("TERMINATE") | MaxMessageTermination(20),
    )
    await Console(team.run_stream(task=task))

if __name__ == "__main__":
    asyncio.run(main(
        "Find my 'Reading list' page and add today's date plus 3 book ideas about AI agents."
    ))
```

Run `python agent.py` and watch each tool call stream to the console.

## How it works

1. **Startup** — `mcp_server_tools` spawns each server as a subprocess, does the MCP handshake and lists tools. Each tool's JSON schema becomes an OpenAI tool definition.
2. **Planning** — the model reads the task and the tool descriptions, then calls Notion's search tool.
3. **Execution** — AutoGen forwards each call over stdio to the right server and appends the JSON result to the conversation.
4. **Loop** — the agent keeps calling tools (get page, `today`, append blocks) until it writes `TERMINATE` or hits the message limit.
5. **Safety** — the integration token only sees pages you shared, and the prompt forbids deletes. The real control is the token's scope, not the prompt.

## Debugging tips

- Run `mcp dev my_tools.py` to open the MCP Inspector and call tools by hand.
- If the Notion server hangs, run the `npx` command in a terminal to see its errors (wrong token, Node version).
- Notion's tool list is large. If the model picks wrong tools, filter `tools` down to the few you need by name.
- Notion API responses are big JSON blobs; they eat context fast. Ask for specific pages, not whole databases.

## Stretch goals

- [ ] **Filter tools** to search, read and append only, and measure whether accuracy improves.
- [ ] **Two-agent team** — a planner that writes a checklist and an executor that calls Notion.
- [ ] **Human approval** — add a `UserProxyAgent` that must approve any create or update call.
- [ ] **Streamable HTTP** — run `my_tools.py` with `transport="streamable-http"` and connect with AutoGen's HTTP server params.
- [ ] **Trace it** — send runs to Langfuse or Opik and inspect token use per tool call.
- [ ] **Daily digest** — a cron job that summarizes yesterday's edited pages into a new page.
- [ ] **Remote Notion MCP** — switch to Notion's hosted server with OAuth.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
