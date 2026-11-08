---
title: "Loop Engineering"
---

## TL;DR

Every agent is a loop: **think → act → observe → decide whether to continue**. **Loop engineering** is designing that loop on purpose: **when it stops**, how many iterations and how much money it may spend, when it **reflects** on its own work, and how it **recovers from errors**. A good harness with a bad loop still fails: it spins forever, stops too early, or burns the budget repeating a broken tool call.

## The loop and its control points

```
          ┌──────────────────────────────────────────────┐
          ▼                                              │
start ─► think ─► act (tool) ─► observe ─► check ────────┤ continue
                     │                       │           │
                     │ error                 ├─ done? ───┼─► return answer
                     ▼                       ├─ budget? ─┼─► return best effort
                 recover / retry             ├─ stuck? ──┼─► escalate to human
                                             └─ reflect? ┘
```

| Control | Question | Typical setting |
|---|---|---|
| **Stop condition** | How do we know we're done? | Model returns no tool calls; or a `finish` tool; or a check passes |
| **Max iterations** | Hard cap on steps | 10–25 for tool agents |
| **Budget** | Cap on tokens, cost or wall time | Per-run token or cost ceiling |
| **Reflection** | When does it critique itself? | After a draft, or after a failure |
| **Error recovery** | What happens when a tool fails? | Feed the error back; retry with backoff; fall back |
| **Stuck detection** | Is it repeating itself? | Same tool + same args twice in a row |

## Stop conditions

The weakest stop condition is "the model decided to stop". Stronger ones are checked by code.

| Stop condition | Strength |
|---|---|
| No more tool calls | Weak: the model may stop early or never stop |
| Explicit `finish(answer)` tool with a schema | Better: structured, easy to detect |
| External check passes (tests green, schema valid, all fields filled) | Strongest: grounded in reality |

## A hand-written loop with every control

```python
import json, time
from openai import OpenAI

client = OpenAI()
MAX_STEPS, MAX_TOKENS, MAX_SECONDS = 15, 50_000, 120

def run_agent(task: str, tools: list, functions: dict) -> str:
    messages = [{"role": "user", "content": task}]
    used_tokens, start, seen_calls = 0, time.time(), set()

    for step in range(MAX_STEPS):
        if used_tokens > MAX_TOKENS or time.time() - start > MAX_SECONDS:
            return "Stopped: budget exhausted. Partial progress:\n" + summarize(messages)

        resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages, tools=tools)
        used_tokens += resp.usage.total_tokens
        msg = resp.choices[0].message
        messages.append(msg)

        if not msg.tool_calls:                         # stop condition
            return msg.content

        for call in msg.tool_calls:
            key = (call.function.name, call.function.arguments)
            if key in seen_calls:                       # stuck detection
                result = "You already made this exact call. Try a different approach or finish."
            else:
                seen_calls.add(key)
                result = safe_call(functions, call)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})

    return "Stopped: max steps reached. Partial progress:\n" + summarize(messages)

def safe_call(functions: dict, call) -> str:
    try:
        args = json.loads(call.function.arguments)
        return str(functions[call.function.name](**args))[:4000]
    except KeyError:
        return f"Error: unknown tool {call.function.name}."
    except Exception as e:                              # error recovery: let the model see it
        return f"Error: {type(e).__name__}: {e}. Fix the arguments or try another tool."
```

`summarize` can be a cheap LLM call that turns the history into a short status report. Returning partial progress is better than a silent failure.

## In LangGraph

- **`recursion_limit`** caps supersteps: `app.invoke(inputs, {"recursion_limit": 25})`. It raises `GraphRecursionError`, so catch it and return something useful.
- **Counters in state** (`attempts: int`) let conditional edges stop loops earlier, with a nicer exit path.
- **Tool errors:** `ToolNode` catches exceptions and returns them as tool messages by default (`handle_tool_errors`), so the model can self-correct.
- **Retries for flaky nodes:** `add_node("call_api", fn, retry_policy=RetryPolicy(max_attempts=3))` retries transient failures without involving the model.

## Reflection

Reflection means the agent (or a second agent) critiques output and revises it.

| Type | How | When it helps |
|---|---|---|
| Self-critique | Same model reviews its draft | Writing, plans; modest gains |
| Separate critic | Different prompt or model reviews | Clearer, less self-agreeing feedback |
| **Grounded reflection** | Feedback from tests, linters, validators | Code, data extraction; biggest gains |

Reflection costs a full extra call each round. Cap rounds (2–3 is typical) and stop as soon as the critic approves. Ungrounded self-critique can also make answers worse by "fixing" correct things.

## Error recovery ladder

1. **Retry transient errors** (rate limits, timeouts) with exponential backoff, in code, without the model.
2. **Return the error to the model** for argument mistakes, with a hint about what to change.
3. **Fallback:** a different tool, a different model, or a cached answer.
4. **Escalate:** pause and ask a human (`interrupt()`), or end with a clear partial result.

## Gotchas

- **Iteration cap alone isn't a budget.** Ten steps with huge contexts can still be expensive. Track tokens too.
- **Silent cap hits.** Hitting `max_steps` should be logged and visible, not look like a normal answer.
- **Retry storms.** Retrying a non-idempotent tool (send email, charge card) can duplicate the action. Use idempotency keys.
- **Planning once, never re-planning.** For long tasks, re-check the plan every few steps against what's been learned.

## Key terms

- **Agent loop** — the repeated cycle of model call, tool execution and result feedback.
- **Stop condition** — the rule that ends the loop successfully.
- **Budget** — a cap on tokens, cost or time for one run.
- **Reflection** — critiquing and revising output inside the loop.
- **Stuck detection** — noticing repeated identical actions and breaking the cycle.
- **Idempotent** — safe to run more than once with the same effect.

## Interview quick-fire

- **"How do you stop an agent from looping forever?"** → Hard max-iterations, a token/time budget, stuck detection on repeated calls, and a graceful partial-result exit.
- **"Does reflection always help?"** → No. It helps most when feedback is grounded (tests, validators). Pure self-critique gives modest gains and adds cost.
- **"A tool throws an exception mid-run. What should happen?"** → Retry transient errors in code; otherwise return a clear error message to the model so it can adjust; escalate if it keeps failing.
- **"Harness vs loop engineering?"** → Harness is the environment (tools, context, sandbox, evals); the loop is the control flow (stopping, budgets, reflection, recovery).
