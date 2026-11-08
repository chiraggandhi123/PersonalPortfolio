---
title: "Multi-Agent Research Assistant with LangChain"
---

## TL;DR

A multi-agent system splits one big job into **specialist agents** with their own prompts and tools, plus something that **coordinates** them. The simplest LangChain version is **agents as tools**: wrap a researcher agent and a writer agent as tools, and give them to a **supervisor** agent that decides who works next. Each specialist sees only what it needs, which keeps prompts short and tool choice reliable.

## Why split into agents

| Single agent | Multi-agent |
|---|---|
| One long prompt covering every role | Short, focused prompt per role |
| All tools visible at once | Each agent gets only its tools |
| One context that fills up fast | Each specialist starts with a clean context |
| Easy to build and debug | More calls, more cost, harder to trace |

Split only when a single agent with good tools is clearly struggling.

## Two coordination patterns

```
Supervisor (agents as tools)              Sequential pipeline

        user                              user ──► researcher ──► writer ──► critic ──► answer
          │
      supervisor ◄─────┐
       │      │        │
       ▼      ▼        │
  researcher  writer ──┘
```

- **Supervisor** — flexible. The supervisor can call the researcher twice, skip the writer, or ask for revisions.
- **Pipeline** — predictable. Fixed order, easy to test. Good when every request needs the same steps.

## The specialists

```python
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_tavily import TavilySearch

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

researcher = create_agent(
    model=llm,
    tools=[TavilySearch(max_results=5)],
    system_prompt=(
        "You are a researcher. Search the web and return concise bullet-point findings "
        "with a source URL for each. Do not write prose."
    ),
)

writer = create_agent(
    model=llm,
    tools=[],
    system_prompt=(
        "You are a technical writer. Turn research notes into a clear report: "
        "a summary, 3-5 sections with headings, and a sources list. Use only the notes given."
    ),
)
```

## Wrapping agents as tools

```python
def last_text(result) -> str:
    return result["messages"][-1].content

@tool
def research(topic: str) -> str:
    """Research a topic on the web. Returns bullet-point findings with sources."""
    return last_text(researcher.invoke({"messages": [{"role": "user", "content": topic}]}))

@tool
def write_report(notes: str) -> str:
    """Write a structured report from research notes. Pass the full notes."""
    return last_text(writer.invoke({"messages": [{"role": "user", "content": notes}]}))
```

The tool's input is the **only** thing the sub-agent sees. That isolation is the point: the writer never sees search noise.

## The supervisor

```python
supervisor = create_agent(
    model=llm,
    tools=[research, write_report],
    system_prompt=(
        "You coordinate a research team. For a user question: call `research` for each "
        "distinct sub-topic, then call `write_report` with all findings combined. "
        "Return the report as your final answer."
    ),
)

question = "Compare solid-state and lithium-ion batteries for EVs."
for step in supervisor.stream({"messages": [{"role": "user", "content": question}]},
                              {"recursion_limit": 15}, stream_mode="updates"):
    for node, update in step.items():
        msg = update["messages"][-1]
        print(f"[{node}]", [c["name"] for c in msg.tool_calls] if msg.tool_calls else msg.content[:200])
```

## The pipeline version

```python
def run_pipeline(question: str) -> str:
    notes = research.invoke({"topic": question})
    draft = write_report.invoke({"notes": f"Question: {question}\n\nNotes:\n{notes}"})
    return draft
```

No supervisor LLM, fewer calls, same output for most questions. Start here; move to a supervisor when requests vary enough to need different paths.

## Making it work well

- **Clear handoff contracts.** Tell each agent exactly what to return (bullets with URLs, a report with headings).
- **Pass full context explicitly.** Sub-agents don't share memory; whatever they need goes in the tool input.
- **Limit fan-out.** Tell the supervisor how many research calls are reasonable.
- **Trace it.** With LangSmith on, each sub-agent run shows up nested inside the supervisor's tool call.
- **Add a critic** when quality matters: a reviewer agent that returns "approve" or a list of fixes.

## Gotchas

- **Cost multiplies.** Each sub-agent call is its own loop of model calls.
- **Telephone game.** Details get lost between agents. Ask the researcher for sources and quotes, not summaries of summaries.
- **Supervisor answers itself.** If it skips the tools, tighten the prompt ("never answer from your own knowledge").
- **Shared state** is awkward with agents-as-tools. When agents need a common scratchpad, build the system in LangGraph (module E, and subgraphs in module G).

## Key terms

- **Multi-agent system** — several agents with separate roles, prompts and tools, working on one task.
- **Supervisor** — an agent that routes work to other agents and combines their results.
- **Agents as tools** — wrapping a sub-agent in a tool so another agent can call it.
- **Handoff** — passing control and context from one agent to another.
- **Context isolation** — each sub-agent sees only the input it is given, not the full history.

## Interview quick-fire

- **"When would you use multiple agents instead of one?"** → When roles need different tools or instructions and a single agent's prompt and toolset has grown too big to behave reliably.
- **"Supervisor vs. sequential pipeline?"** → Supervisor adapts the path per request; a pipeline is fixed, cheaper and easier to test.
- **"How do agents share information in the agents-as-tools pattern?"** → Only through tool inputs and outputs; the supervisor carries the full context and passes what each specialist needs.
- **"Biggest risks of multi-agent systems?"** → Higher cost and latency, information lost between agents, and harder debugging without tracing.
