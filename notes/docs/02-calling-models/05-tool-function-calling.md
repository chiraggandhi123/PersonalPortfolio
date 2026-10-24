---
title: "Tool / Function Calling"
---

## TL;DR

Tool calling lets a model **ask your code to run a function**. You describe tools (name, description, JSON-schema parameters); the model replies with "call `get_weather` with `{"city": "Pune"}`" instead of text; **your code runs it** and sends back the result; the model then answers using that result. The model never executes anything itself. This loop is the foundation of every agent.

## The loop

```
1. you  → model : messages + tool definitions
2. model → you  : tool_call get_weather({"city": "Pune"})        finish_reason = "tool_calls"
3. you          : run get_weather("Pune") → "31°C, sunny"
4. you  → model : messages + the tool call + {"role": "tool", "content": "31°C, sunny"}
5. model → you  : "It's 31°C and sunny in Pune right now."        finish_reason = "stop"
```

Steps 2–4 can repeat: the model may call several tools, or call one, look at the result, then call another.

## Defining a tool

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city. Use for any question about current weather.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name, e.g. 'Pune'"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
            },
            "required": ["city"],
        },
    },
}]
```

The **description is the prompt**. The model decides when to call a tool, and with what arguments, almost entirely from the name and descriptions.

## Full working loop (OpenAI)

```python
import json
from openai import OpenAI

client = OpenAI()

def get_weather(city: str, unit: str = "celsius") -> str:
    return f"31°C and sunny in {city}"          # call a real weather API here

FUNCTIONS = {"get_weather": get_weather}

messages = [{"role": "user", "content": "Should I carry an umbrella in Pune today?"}]

while True:
    response = client.chat.completions.create(model="gpt-4o-mini", messages=messages, tools=tools)
    msg = response.choices[0].message

    if not msg.tool_calls:                      # model is done → final answer
        print(msg.content)
        break

    messages.append(msg)                        # keep the assistant's tool request in history
    for call in msg.tool_calls:
        args = json.loads(call.function.arguments)
        try:
            result = FUNCTIONS[call.function.name](**args)
        except Exception as e:
            result = f"Error: {e}"              # let the model see the failure and recover
        messages.append({
            "role": "tool",
            "tool_call_id": call.id,            # links the result to the request
            "content": str(result),
        })
```

Key details:

- Append the **assistant message with `tool_calls`** before the tool results, or the API rejects the request.
- Every tool result needs the matching **`tool_call_id`**.
- The model can return **several tool calls in one turn** (parallel calls). Run them all before calling the model again.
- Put a **max-iterations** cap on the loop in real code so a confused model can't spin forever.

## Controlling when tools are used

```python
tool_choice="auto"                                                    # default: model decides
tool_choice="none"                                                    # never call tools
tool_choice="required"                                                # must call some tool
tool_choice={"type": "function", "function": {"name": "get_weather"}}  # must call this one
```

Forcing a specific tool is a classic trick for **structured extraction**: the "arguments" are your JSON.

## Schemas from Pydantic

Writing JSON schema by hand gets old. Generate it:

```python
import openai
from pydantic import BaseModel, Field

class GetWeather(BaseModel):
    """Get the current weather for a city."""
    city: str = Field(description="City name")

tools = [openai.pydantic_function_tool(GetWeather)]
```

## Designing good tools

- **Few, clear tools** beat many overlapping ones. Similar names confuse the model.
- **Return useful errors** as the tool result ("city not found, did you mean Pune?") so the model can retry.
- **Keep results small.** A tool that returns 50 KB of JSON fills the context window; summarize or paginate.
- **Validate arguments** before acting. The model can produce wrong types or out-of-range values.
- **Gate dangerous actions.** For anything irreversible (send email, pay, delete), require human confirmation in your code.

## Key terms

- **Tool / function** — an operation your code exposes to the model, described with a JSON schema.
- **Tool call** — the model's structured request to run a tool with specific arguments.
- **tool_call_id** — the ID that ties a tool result to the call that requested it.
- **tool_choice** — setting that controls whether and which tool the model must call.
- **Parallel tool calls** — several tool calls returned in a single model turn.

## Interview quick-fire

- **"Does the model execute the function?"** → No; it outputs the function name and JSON arguments, your code runs it and sends the result back.
- **"How does the model decide which tool to use?"** → From the tool names, descriptions and parameter schemas in context, so writing clear descriptions is the main lever.
- **"How is tool calling related to agents?"** → An agent is essentially this loop run repeatedly: the model picks a tool, observes the result, and decides the next step until the goal is met.
