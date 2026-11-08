---
title: "The ReAct Loop (reason → act → observe)"
---

## TL;DR

ReAct (**Reason + Act**) is the core loop behind most agents: the model **thinks** about what to do, **calls a tool**, **observes** the result, and repeats until it can answer. It turns a one-shot LLM call into a small program that gathers its own information. Modern APIs implement it with **native tool calling** instead of parsing "Thought/Action" text, but the loop is the same. Always cap it with a **max-iterations** limit.

## The loop

```
          ┌────────────────────────────────────────────┐
          ▼                                            │
user ─► REASON  "I need today's weather in Pune"       │
          │                                            │
          ▼                                            │
        ACT     get_weather(city="Pune")               │
          │                                            │
          ▼                                            │
        OBSERVE "31°C, sunny"  ── append to messages ──┘
          │
          ▼ (model decides it has enough)
        ANSWER  "No umbrella needed today."
```

Each pass through the loop is one LLM call. The **message history is the agent's scratchpad**: every tool call and result is appended, so the next reasoning step sees everything so far.

## Classic text ReAct vs. native tool calling

The original paper (Yao et al., 2022) prompted the model to write a text trace:

```
Thought: I should look up the population of Pune.
Action: search["Pune population"]
Observation: About 7 million (metro).
Thought: I now know the answer.
Final Answer: Roughly 7 million people.
```

| | Text ReAct | Native tool calling |
|---|---|---|
| How actions are expressed | Free text you parse with regex | Structured `tool_calls` from the API |
| Failure mode | Malformed "Action:" lines | Rare; args are JSON-schema checked |
| Visible reasoning | Yes, in the "Thought" lines | Optional (ask for it, or use a reasoning model) |
| Use today | Teaching, very small local models | Default for production |

## A minimal ReAct agent (OpenAI)

```python
import json
from openai import OpenAI

client = OpenAI()

def search(query: str) -> str:
    return "Pune metro population: about 7 million"     # call a real search API here

def calculator(expression: str) -> str:
    return str(eval(expression, {"__builtins__": {}}))   # demo only, never eval untrusted input

FUNCS = {"search": search, "calculator": calculator}
tools = [
    {"type": "function", "function": {"name": "search", "description": "Web search for facts.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "calculator", "description": "Evaluate arithmetic.",
        "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}}},
]

def run_agent(question: str, max_steps: int = 6) -> str:
    messages = [
        {"role": "system", "content": "Think step by step. Use tools when you need facts or math."},
        {"role": "user", "content": question},
    ]
    for _ in range(max_steps):
        msg = client.chat.completions.create(model="gpt-4o-mini", messages=messages, tools=tools).choices[0].message
        messages.append(msg)
        if not msg.tool_calls:                       # no action → final answer
            return msg.content
        for call in msg.tool_calls:                  # act + observe
            args = json.loads(call.function.arguments)
            try:
                result = FUNCS[call.function.name](**args)
            except Exception as e:
                result = f"Error: {e}"               # let the model see and recover
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    return "Stopped: hit the step limit."

print(run_agent("What is Pune's population divided by 1000?"))
```

This is the [tool-calling loop](../02-calling-models/05-tool-function-calling.md) with a step limit and error handling. That is all a basic agent is.

## The same thing with LangGraph

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

@tool
def search(query: str) -> str:
    """Web search for facts."""
    return "Pune metro population: about 7 million"

agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini"), tools=[search])
result = agent.invoke({"messages": [("user", "How many people live in Pune?")]},
                      config={"recursion_limit": 10})
print(result["messages"][-1].content)
```

LangChain v1 also offers `create_agent` in `langchain.agents`, which wraps the same loop. The names move between releases; the loop does not.

## Gotchas and best practices

- **Always cap iterations.** Models can loop forever, calling the same tool with the same args. Use `max_steps` or `recursion_limit`.
- **Return errors as observations.** A tool error string lets the model retry with different args instead of crashing the run.
- **Keep observations short.** Dumping a 50 KB web page into the history burns tokens and buries the signal. Truncate or summarize tool output.
- **Few, well-described tools.** Five clear tools beat twenty overlapping ones. The description decides when a tool gets called.
- **Log every step.** Trace thoughts, tool calls and results (LangSmith, Langfuse, or plain logs). Debugging an agent without a trace is guesswork.
- **Know when not to use it.** If the steps are fixed and known, a plain pipeline is cheaper and more predictable than a loop.

## Key terms

- **ReAct** — prompting pattern that interleaves reasoning steps with tool actions and their observations.
- **Observation** — the tool result fed back into the conversation.
- **Scratchpad** — the growing message history that holds the agent's intermediate steps.
- **Max iterations / recursion limit** — hard cap on loop passes to stop runaway agents.
- **Plan-and-execute** — alternative pattern: write a full plan first, then execute steps, re-planning if needed.

## Interview quick-fire

- **"What is ReAct?"** → A loop where the LLM alternates reasoning, tool calls and observing results until it can answer; it grounds answers in real data instead of memory.
- **"How do you stop an agent looping forever?"** → Max iterations, detecting repeated identical tool calls, a token/cost budget, and a clear stop condition in the prompt.
- **"ReAct vs. plan-and-execute?"** → ReAct decides one step at a time (adaptive, more calls); plan-and-execute plans up front (cheaper, more predictable, worse when surprises appear).
- **"Why feed tool errors back to the model?"** → So it can self-correct (fix args, try another tool) rather than the run failing.
