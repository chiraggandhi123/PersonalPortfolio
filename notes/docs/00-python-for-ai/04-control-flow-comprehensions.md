---
title: "Control Flow & Comprehensions"
---

## TL;DR

**`if/elif/else`** decides, **`for`** walks over collections, **`while`** repeats until a condition changes. Agent code is mostly a `while` loop ("keep calling the model until it stops asking for tools") with `if` checks inside. **Comprehensions** (`[x for x in items if cond]`) build lists and dicts in one readable line, perfect for filtering chunks or reshaping API results. **`match`** handles branching on structured data like tool calls.

## if / elif / else

```python
finish_reason = response.choices[0].finish_reason

if finish_reason == "stop":
    print("Done")
elif finish_reason == "length":
    print("Cut off: raise max tokens")
elif finish_reason == "tool_calls":
    print("Model wants to run a tool")
else:
    print(f"Unexpected: {finish_reason}")
```

Truthiness shortcuts:

```python
if not reply.strip():          # empty or whitespace-only reply
    reply = "Sorry, I have no answer."

model = user_model or "gpt-4o-mini"      # fallback if user_model is None/""
label = "long" if len(text) > 2000 else "short"   # conditional expression
```

## for loops

```python
documents = ["intro.txt", "pricing.txt", "faq.txt"]

for doc in documents:
    print(doc)

for i, doc in enumerate(documents, start=1):       # index + item
    print(f"{i}. {doc}")

for question, answer in zip(questions, answers):   # walk two lists together
    print(question, "->", answer)

for role, content in ((m["role"], m["content"]) for m in messages):
    print(f"[{role}] {content[:60]}")
```

`break` exits the loop, `continue` skips to the next item. A loop's `else` runs only if it never hit `break` (rarely needed, but you'll see it).

## while loops: the agent shape

```
        ┌────────────────────────────┐
        ▼                            │
  call model ──► tool calls? ── yes ─┴► run tools, append results
        │
        no
        ▼
   return answer
```

```python
MAX_STEPS = 5
step = 0

while step < MAX_STEPS:
    step += 1
    msg = call_model(messages)            # your function
    if not msg.tool_calls:
        print(msg.content)
        break
    for call in msg.tool_calls:
        messages.append(run_tool(call))   # your function
else:
    print("Gave up after max steps")
```

Always cap agent loops. A model that keeps calling tools will otherwise loop (and bill you) forever.

## match: branching on structure

```python
def handle(tool_name: str, args: dict) -> str:
    match tool_name:
        case "get_weather":
            return get_weather(args["city"])
        case "search_docs":
            return search_docs(args["query"])
        case _:
            return f"Unknown tool: {tool_name}"
```

A dict of functions (`TOOLS = {"get_weather": get_weather}`) does the same job and is easier to extend; you'll see both.

## Comprehensions

Same logic as a loop, written as an expression.

```python
chunks = ["Intro...", "", "Pricing is...", "   ", "FAQ..."]

# list: filter + transform
clean = [c.strip() for c in chunks if c.strip()]

# dict: id -> text
by_id = {f"chunk-{i}": text for i, text in enumerate(clean)}

# set: unique roles in a conversation
roles = {m["role"] for m in messages}

# generator: lazy, no list built (good inside sum/any/max)
total_chars = sum(len(c) for c in clean)
has_tools = any(m["role"] == "tool" for m in messages)
```

Typical AI reshaping:

```python
# keep only results above a similarity threshold
hits = [(doc, score) for doc, score in results if score >= 0.75]

# convert Q&A pairs into chat messages
messages = [
    msg
    for q, a in examples
    for msg in ({"role": "user", "content": q}, {"role": "assistant", "content": a})
]
```

| Use a comprehension when | Use a loop when |
|---|---|
| Building a new list/dict/set | You need side effects (API calls, printing) |
| Logic fits on one or two lines | Multiple steps, try/except, or logging |
| Simple filter + transform | Nested logic would hurt readability |

## Gotchas

- **Don't call APIs inside comprehensions** — errors are harder to handle and you can't add retries cleanly. Use a loop (or async gather).
- **Nested comprehensions** read left to right like nested loops. Past two levels, write a loop.
- **`while True` without a cap** in agent code is a cost bug waiting to happen.
- **Indentation is syntax** — mixing tabs and spaces breaks code. Let the editor use 4 spaces.

## Key terms

- **Conditional expression** — `a if cond else b` in one line.
- **`enumerate` / `zip`** — loop helpers for index+item and parallel iteration.
- **Comprehension** — expression that builds a list, dict or set from an iterable.
- **Generator expression** — lazy comprehension in `()`, yields items one at a time.
- **Structural pattern matching** — `match/case` for branching on values and shapes.

## Interview quick-fire

- **"How would you stop an agent looping forever?"** → Cap iterations in the `while` loop (max steps), plus a timeout or token budget.
- **"List comprehension vs generator expression?"** → A list comprehension builds the whole list in memory; a generator yields lazily, better for `sum`/`any` or large data.
- **"When not to use a comprehension?"** → When you need side effects, error handling, or the logic stops fitting on a line or two.
