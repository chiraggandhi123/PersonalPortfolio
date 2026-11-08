---
title: "Microsoft AutoGen (conversational multi-agent)"
---

## TL;DR

AutoGen builds multi-agent systems as **agents talking to each other**. In the current architecture (v0.4+), **AgentChat** gives you high-level agents like `AssistantAgent`, and **teams** like `RoundRobinGroupChat` and `SelectorGroupChat` that run a shared conversation until a **termination condition** fires. Everything is **async**. It is strong for code-writing and code-executing agents and for conversational collaboration patterns.

> AutoGen changed a lot between v0.2 and v0.4, and Microsoft is folding its ideas into the newer Microsoft Agent Framework. Check which package and version you are on; old `autogen` / `pyautogen` tutorials will not run against v0.4.

## Package layers (v0.4+)

| Package | Role |
|---|---|
| `autogen-core` | Low-level, event-driven actor runtime |
| `autogen-agentchat` | High-level agents and teams (what most people use) |
| `autogen-ext` | Model clients, code executors, tools (OpenAI, Azure, Docker, MCP) |
| AutoGen Studio | No-code UI for prototyping teams |

```bash
pip install -U "autogen-agentchat" "autogen-ext[openai]"
```

## A single agent with a tool

```python
import asyncio
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient

async def get_weather(city: str) -> str:
    """Get the weather for a city."""
    return f"31°C and sunny in {city}"

async def main():
    model = OpenAIChatCompletionClient(model="gpt-4o-mini")
    agent = AssistantAgent("assistant", model_client=model, tools=[get_weather],
                           system_message="You are a helpful assistant.")
    result = await agent.run(task="Weather in Pune?")
    print(result.messages[-1].content)
    await model.close()

asyncio.run(main())
```

Plain Python functions with type hints and docstrings become tools automatically.

## Teams: a writer and a critic

```
RoundRobinGroupChat
  writer ─► critic ─► writer ─► critic ...  until critic says "APPROVE"
          (shared conversation; every agent sees every message)
```

```python
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.conditions import TextMentionTermination, MaxMessageTermination
from autogen_agentchat.ui import Console

async def main():
    model = OpenAIChatCompletionClient(model="gpt-4o-mini")
    writer = AssistantAgent("writer", model_client=model,
                            system_message="Write a short product tagline. Revise on feedback.")
    critic = AssistantAgent("critic", model_client=model,
                            system_message="Critique the tagline. Reply APPROVE when it is good.")

    stop = TextMentionTermination("APPROVE") | MaxMessageTermination(8)
    team = RoundRobinGroupChat([writer, critic], termination_condition=stop)
    await Console(team.run_stream(task="Tagline for a solar-powered phone charger."))
    await model.close()
```

Termination conditions combine with `|` (or) and `&` (and). **Always include a max-message cap.**

## Team types

| Team | Who speaks next | Use for |
|---|---|---|
| `RoundRobinGroupChat` | Fixed rotation | Writer/critic, simple pipelines |
| `SelectorGroupChat` | An LLM picks based on the conversation | Dynamic specialist routing |
| `Swarm` | Agents hand off explicitly via `HandoffMessage` | Customer-support style transfers |
| `MagenticOneGroupChat` | Orchestrator plans and tracks progress | Open-ended web/file/code tasks |

## Code execution

AutoGen's signature pattern: one agent writes code, another runs it.

```python
from autogen_agentchat.agents import CodeExecutorAgent
from autogen_ext.code_executors.docker import DockerCommandLineCodeExecutor

executor = DockerCommandLineCodeExecutor(work_dir="coding")   # sandboxed in Docker
runner = CodeExecutorAgent("runner", code_executor=executor)
# put `runner` in a team with a coding AssistantAgent; call await executor.start() first
```

Use Docker (or another sandbox) for executed code. `LocalCommandLineCodeExecutor` runs on your machine and should only be used for trusted experiments.

## Gotchas

- **Async everywhere.** Use `await`, `asyncio.run`, and `run_stream` for live output.
- **Shared context grows fast.** Every agent sees the whole chat; long teams get expensive. Cap messages.
- **Vague termination = runaway cost.** Make the stop phrase explicit in the system prompt.
- **State.** Teams keep state between `run` calls; use `team.reset()` for a fresh task, or `save_state()` / `load_state()` to persist.

## Key terms

- **AgentChat** — AutoGen's high-level API for agents and teams.
- **AssistantAgent** — LLM-backed agent that can call tools.
- **Team / group chat** — several agents sharing one conversation under a speaker-selection rule.
- **Termination condition** — rule that ends a team run (text mention, max messages, handoff, timeout).
- **Code executor** — component that runs model-written code, ideally in a sandbox.

## Interview quick-fire

- **"How does AutoGen model multi-agent work?"** → As a conversation: agents in a team take turns posting to a shared thread until a termination condition is met.
- **"RoundRobin vs. Selector group chat?"** → RoundRobin rotates speakers in a fixed order; Selector uses an LLM to choose the next speaker from context.
- **"How do you stop an AutoGen team from running forever?"** → Combine a semantic stop (e.g. `TextMentionTermination("APPROVE")`) with `MaxMessageTermination`.
- **"How do you safely run model-generated code?"** → In a sandbox such as the Docker code executor, with no secrets and limited network.
