---
title: "Harness Engineering"
---

## TL;DR

An agent is **model + harness**. The **harness** is everything you build around the model: the tools it can call, the context it sees, the system prompt, the sandbox it runs in, the guardrails, and the evals that tell you whether it works. Two teams using the same model can get very different results because of the harness. **Harness engineering** is the work of designing that scaffolding deliberately, and it's usually where most of the quality comes from.

## What's in a harness

```
                ┌───────────────── harness ─────────────────┐
user ─► guard ─►│ system prompt + context builder            │
                │        │                                   │
                │        ▼                                   │
                │      MODEL  ◄──── tool results (truncated) │
                │        │                                   │
                │        ▼ tool call                         │
                │   permission check ─► sandbox ─► tool      │
                │                                            │
                │   traces ─► evals ─► prompt/tool changes   │
                └────────────────────────────────────────────┘
```

| Layer | Question it answers | Examples |
|---|---|---|
| **Tools** | What can the agent do? | Function schemas, MCP servers |
| **Context** | What does it know right now? | System prompt, retrieved docs, memory, history trimming |
| **Sandbox** | Where do actions run? | Docker, no-network containers, read-only FS |
| **Permissions / guardrails** | What is it allowed to do? | Allowlists, approval for writes, input/output filters |
| **Observability** | What did it actually do? | Traces, token and cost logs |
| **Evals** | Is it getting better or worse? | Test sets, LLM judges, regression checks |

The agent loop itself (when to stop, how to retry) is the subject of the next note, [loop engineering](./02-loop-engineering.md).

## Tool design

Tools are the agent's interface to the world. Design them like an API for a junior colleague who only reads the docstring.

| Do | Don't |
|---|---|
| Few, well-named tools with clear descriptions | 40 overlapping tools |
| Task-level tools (`refund_order(order_id)`) | Raw primitives (`run_sql(query)`) when you can avoid it |
| Typed, constrained args (enums, IDs) | Free-text args that need parsing |
| Return short, structured, relevant output | Dump a 50 KB API response |
| Return helpful errors ("order 12 not found; did you mean 120?") | Raise a stack trace into the context |

```python
from typing import Literal
from langchain_core.tools import tool

@tool
def search_orders(customer_id: str, status: Literal["open", "shipped", "refunded"] = "open") -> str:
    """Find a customer's orders by status. Use before any refund or shipping question."""
    rows = db.find_orders(customer_id, status)[:10]         # cap results
    if not rows:
        return f"No {status} orders for customer {customer_id}."
    return "\n".join(f"{r.id} | {r.date} | ₹{r.total}" for r in rows)
```

## Context engineering

The model only knows what's in its context window. Fill it on purpose.

- **System prompt:** role, goals, constraints, tool-use policy, output format. Keep it stable so prompt caching works.
- **Just-in-time retrieval:** let the agent fetch files or docs with tools instead of pre-loading everything.
- **Truncate tool output:** keep the head and tail, or summarize, before it goes back into history.
- **Compaction:** in long runs, summarize old turns into a short note and drop the raw messages.
- **Scratchpad / notes file:** let long-running agents write progress to a file and re-read it, instead of relying on a huge history.

```python
def clip(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + f"\n...[{len(text) - limit} chars truncated]...\n" + text[-half:]
```

## Sandboxing and permissions

Assume the model will eventually do the wrong thing, either by mistake or because a document told it to (prompt injection).

- **Least privilege:** read-only DB user, scoped API tokens, one directory of the filesystem.
- **Sandbox code execution:** container with no network, CPU and memory limits, a timeout, and a throwaway filesystem.
- **Tiered permissions:** reads run freely, writes need approval, destructive actions are not available at all.
- **Egress control:** block network access except to allowlisted domains, so injected instructions can't exfiltrate data.

```python
SAFE = {"search_orders", "get_order"}
NEEDS_APPROVAL = {"refund_order", "send_email"}

def check_permission(tool_name: str) -> str:
    if tool_name in SAFE:
        return "allow"
    if tool_name in NEEDS_APPROVAL:
        return "ask_human"
    return "deny"
```

## Evals close the loop

A harness change (new tool, reworded prompt) can fix one case and break five others. Treat it like code.

1. Collect 30–100 **real tasks** with expected outcomes.
2. Run the agent on all of them after every harness change.
3. Score with code checks where possible (correct tool called? right order ID?), and an LLM judge for open-ended quality.
4. Read the **traces of failures**, not just the score. Most fixes come from noticing a confusing tool description or missing context.

## Gotchas

- **Blaming the model first.** Before switching models, check whether the model actually had the information and tools it needed.
- **Tool descriptions drift.** Someone renames a param and the docstring is now wrong. The model trusts the docstring.
- **Hidden context bloat.** Tool schemas, history and retrieved chunks add up. Log tokens per step.
- **Guardrails only on input.** Indirect injection arrives via tool results (web pages, emails). Check what comes back, too.

## Key terms

- **Harness** — all the non-model code and config around an agent: tools, context, prompts, sandbox, guardrails, evals.
- **Context engineering** — choosing what goes into the context window at each step.
- **Least privilege** — giving the agent only the permissions the task needs.
- **Sandbox** — an isolated environment where agent actions can't harm the host.
- **Indirect prompt injection** — malicious instructions arriving through data the agent reads, not the user.

## Interview quick-fire

- **"What is an agent harness?"** → The scaffolding around the model: tools, context management, prompts, sandbox, permissions, observability and evals.
- **"Your agent picks the wrong tool. What do you check?"** → Tool names and descriptions, overlap between tools, how many tools are loaded, and whether the context had the info needed to choose.
- **"How do you safely let an agent run code?"** → Isolated container with no network, resource limits, timeout, throwaway FS, and approval for anything that leaves the sandbox.
- **"How do you know a prompt change helped?"** → Re-run a fixed eval set and compare scores and failure traces before shipping.
