---
title: "OpenAI Agents SDK & Google ADK"
---

## TL;DR

Both are **lightweight, code-first agent frameworks from model vendors**. The **OpenAI Agents SDK** has a small set of primitives: **Agent**, **Runner**, **tools**, **handoffs**, **guardrails** and built-in **tracing**. **Google's Agent Development Kit (ADK)** has **LlmAgent** plus workflow agents (**Sequential, Parallel, Loop**), sessions, and a dev UI, with a smooth path to deploy on Google Cloud. Both work with other providers' models, though each is tuned for its own.

> Both SDKs are young and change quickly. Treat the snippets as the shape of the API and check current docs for exact names.

## Side by side

| | OpenAI Agents SDK | Google ADK |
|---|---|---|
| Install | `pip install openai-agents` | `pip install google-adk` |
| Agent | `Agent(name, instructions, tools, handoffs)` | `Agent` / `LlmAgent(name, model, instruction, tools)` |
| Run | `Runner.run(agent, input)` (async) / `run_sync` | `Runner` + `SessionService`, or `adk web` / `adk run` |
| Multi-agent | Handoffs, or agents-as-tools | `sub_agents`, `AgentTool`, workflow agents |
| Deterministic flow | Plain Python around `Runner` | `SequentialAgent`, `ParallelAgent`, `LoopAgent` |
| Safety | Input/output guardrails | Callbacks (`before_model_callback`, `before_tool_callback`) |
| Observability | Built-in tracing dashboard | Dev UI event view, Cloud Trace |
| Other models | Any OpenAI-compatible endpoint, LiteLLM | Gemini default; LiteLLM for others |

## OpenAI Agents SDK

```python
from agents import Agent, Runner, function_tool

@function_tool
def get_order_status(order_id: str) -> str:
    """Look up the status of an order."""
    return f"Order {order_id}: shipped, arriving Friday"

billing = Agent(name="Billing", instructions="Handle refunds and invoices.")
support = Agent(
    name="Support",
    instructions="Answer order questions. Hand off billing issues to Billing.",
    model="gpt-4o-mini",
    tools=[get_order_status],
    handoffs=[billing],
)

result = Runner.run_sync(support, "Where is order 1234?")
print(result.final_output)
print(result.last_agent.name)     # which agent finished the conversation
```

The `Runner` runs the agent loop: call the model, run tools, follow handoffs, stop at a final output (or `max_turns`).

### Structured output and guardrails

```python
from pydantic import BaseModel
from agents import Agent, GuardrailFunctionOutput, input_guardrail, Runner

class Triage(BaseModel):
    category: str
    urgent: bool

triager = Agent(name="Triage", instructions="Classify the ticket.", output_type=Triage)

@input_guardrail
async def no_homework(ctx, agent, user_input):
    flagged = "homework" in str(user_input).lower()       # use a cheap classifier agent in real code
    return GuardrailFunctionOutput(output_info=None, tripwire_triggered=flagged)

guarded = Agent(name="Support", instructions="...", input_guardrails=[no_homework])
# a tripped guardrail raises InputGuardrailTripwireTriggered
```

**Handoff vs. agent-as-tool:** a handoff transfers the conversation to another agent; `agent.as_tool()` calls a sub-agent and returns its result to the caller, which stays in control.

## Google ADK

```python
# my_agent/agent.py
from google.adk.agents import Agent

def get_weather(city: str) -> dict:
    """Return the current weather for a city."""
    return {"status": "success", "report": f"31°C and sunny in {city}"}

root_agent = Agent(
    name="weather_agent",
    model="gemini-2.0-flash",          # any Gemini model; LiteLlm(...) for others
    instruction="Answer weather questions using the tool.",
    tools=[get_weather],
)
```

Run `adk web` from the parent folder for a chat dev UI with an event inspector, or `adk run my_agent` in the terminal. ADK finds `root_agent` by convention.

### Workflow agents

```python
from google.adk.agents import LlmAgent, SequentialAgent, LoopAgent

drafter = LlmAgent(name="drafter", model="gemini-2.0-flash",
                   instruction="Write a draft about the topic.", output_key="draft")
reviewer = LlmAgent(name="reviewer", model="gemini-2.0-flash",
                    instruction="Review {draft} and list fixes.", output_key="review")

pipeline = SequentialAgent(name="write_and_review", sub_agents=[drafter, reviewer])
refine = LoopAgent(name="refine", sub_agents=[drafter, reviewer], max_iterations=3)
```

`output_key` writes an agent's reply into **session state**; `{draft}` in a later instruction reads it back. Workflow agents add no LLM calls of their own, so their flow is deterministic.

```
SequentialAgent         ParallelAgent            LoopAgent
 A ─► B ─► C             ┌► A ┐                   ┌─► A ─► B ─┐
                         ├► B ┼─► merge          └──(repeat until max or escalate)
                         └► C ┘
```

## Choosing

- **Already on OpenAI, want minimal abstractions and tracing out of the box** → Agents SDK.
- **On Google Cloud / Gemini, want workflow agents and a deploy path (Cloud Run, Vertex AI Agent Engine)** → ADK.
- **Need complex graphs, checkpoints, human-in-the-loop resume** → LangGraph is still the most flexible.

## Gotchas

- **Tracing sends data to the vendor** by default in the Agents SDK. Disable or redirect it for sensitive workloads.
- **Handoff loops.** Two agents can hand off back and forth. Keep `max_turns` low and instructions explicit.
- **ADK tool return values.** Return dicts with a clear status; the model reads them literally.
- **Async vs. sync.** `Runner.run` is async; `run_sync` is for scripts and notebooks without a running loop.

## Key terms

- **Runner** — executes the agent loop until a final output.
- **Handoff** — transferring control of the conversation to another agent.
- **Guardrail** — check on input or output that can halt a run (tripwire).
- **Workflow agent** — ADK agent (Sequential, Parallel, Loop) that orchestrates sub-agents without an LLM.
- **Session state** — ADK's shared key-value state for a conversation.

## Interview quick-fire

- **"What are the OpenAI Agents SDK primitives?"** → Agents, tools, handoffs, guardrails, run by a Runner, with tracing built in.
- **"Handoff vs. agent-as-tool?"** → Handoff gives the conversation to another agent; agent-as-tool calls it like a function and the caller keeps control.
- **"What are ADK workflow agents?"** → Sequential, Parallel and Loop agents that run sub-agents in a fixed pattern, without an LLM deciding the flow.
- **"How do agents share data in ADK?"** → Through session state, written by `output_key` and read via `{key}` in instructions.
