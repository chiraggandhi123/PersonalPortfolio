---
title: "CrewAI (role-based agent crews)"
---

## TL;DR

CrewAI models a multi-agent system as a **crew of role-playing agents**. Each **Agent** has a role, goal and backstory; each **Task** has a description and expected output and is assigned to an agent; a **Crew** runs the tasks with a **process** (sequential or hierarchical). It is quick to get a readable multi-agent pipeline running. For tight, deterministic control flow, add **Flows** or use LangGraph.

> CrewAI's API moves fast. The shapes below match recent releases; check the docs for your installed version.

## Core building blocks

| Concept | What it is | Key fields |
|---|---|---|
| Agent | An LLM persona with tools | `role`, `goal`, `backstory`, `tools`, `llm` |
| Task | A unit of work | `description`, `expected_output`, `agent`, `context`, `output_pydantic` |
| Crew | The team plus how it runs | `agents`, `tasks`, `process`, `memory` |
| Process | Execution strategy | `Process.sequential`, `Process.hierarchical` |
| Flow | Event-driven orchestration across crews and code | `@start`, `@listen`, `@router` |

```
Process.sequential                 Process.hierarchical

research ─► write ─► edit          manager agent
 (task 1)   (task 2)  (task 3)       ├─► researcher
 output of each task flows           ├─► writer
 into the next as context            └─► editor   (manager delegates and reviews)
```

## A two-agent crew

```bash
pip install crewai crewai-tools
```

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import SerperDevTool    # needs SERPER_API_KEY

researcher = Agent(
    role="Tech Researcher",
    goal="Find accurate, recent facts about {topic}",
    backstory="You verify claims and always note sources.",
    tools=[SerperDevTool()],
    llm="gpt-4o-mini",
)
writer = Agent(
    role="Blog Writer",
    goal="Turn research into a clear 300-word post",
    backstory="You write plainly for working engineers.",
    llm="gpt-4o-mini",
)

research = Task(
    description="Research {topic}. List 5 key facts with sources.",
    expected_output="Bullet list of 5 facts, each with a URL.",
    agent=researcher,
)
write = Task(
    description="Write a blog post about {topic} using the research.",
    expected_output="A 300-word markdown post.",
    agent=writer,
    context=[research],          # explicit dependency on the research output
)

crew = Crew(agents=[researcher, writer], tasks=[research, write], process=Process.sequential)
result = crew.kickoff(inputs={"topic": "small language models"})
print(result.raw)
```

`{topic}` placeholders are filled from `kickoff(inputs=...)`. `llm` accepts a model string (routed through LiteLLM, so `"ollama/llama3"` or Anthropic models also work) or an `LLM(...)` object.

## Custom tools and structured output

```python
from crewai.tools import tool
from pydantic import BaseModel

@tool("Word counter")
def word_count(text: str) -> int:
    """Count words in a piece of text."""
    return len(text.split())

class Post(BaseModel):
    title: str
    body: str

write = Task(description="...", expected_output="Title and body.", agent=writer,
             tools=[word_count], output_pydantic=Post)
# result.pydantic → Post instance
```

## Project layout (CLI)

`crewai create crew my_crew` scaffolds a project where agents and tasks live in `config/agents.yaml` and `config/tasks.yaml`, and a `@CrewBase` class wires them together. That keeps prompts out of Python code and is the usual layout for real projects.

## Flows

Crews are autonomous; Flows add **deterministic control**: steps run in code, state is typed, and you call crews (or single LLM calls) from inside steps.

```python
from crewai.flow.flow import Flow, start, listen

class BlogFlow(Flow):
    @start()
    def pick_topic(self):
        return "vector databases"

    @listen(pick_topic)
    def write(self, topic):
        return crew.kickoff(inputs={"topic": topic}).raw

BlogFlow().kickoff()
```

## When to pick CrewAI

| Good fit | Weaker fit |
|---|---|
| Content pipelines (research → write → edit) | Fine-grained branching and loops |
| Fast prototypes and demos | Precise state control, replay, time travel |
| Teams who think in roles | Very cost-sensitive runs (verbose agent prompts) |

## Gotchas

- **`expected_output` matters.** It is the main lever on output format and length.
- **Hierarchical mode costs more.** The manager adds LLM calls and can drift; start sequential.
- **Agents can over-delegate or loop.** Set `allow_delegation=False` unless you need it, and use `max_iter` on agents.
- **Verbose prompts.** Role, goal and backstory are added to every call. Keep them short.

## Key terms

- **Agent** — a role-defined LLM worker with tools.
- **Task** — a described unit of work with an expected output, assigned to an agent.
- **Crew** — a set of agents and tasks run under a process.
- **Sequential / hierarchical process** — tasks in order / a manager agent delegating.
- **Flow** — CrewAI's event-driven, stateful orchestration layer.

## Interview quick-fire

- **"What are CrewAI's core abstractions?"** → Agent (role, goal, backstory, tools), Task (description, expected output), Crew (agents plus tasks plus process), and Flows for orchestration.
- **"Sequential vs. hierarchical process?"** → Sequential runs tasks in order passing outputs as context; hierarchical adds a manager LLM that delegates and validates.
- **"CrewAI vs. LangGraph?"** → CrewAI is higher-level and role-based, fast to build; LangGraph is a lower-level graph with explicit state and control flow, better for complex production logic.
- **"How do you get structured output from a crew?"** → Set `output_pydantic` (or `output_json`) on the task.
