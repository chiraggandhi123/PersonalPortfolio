---
title: "Data Structures (list, dict, set, tuple)"
---

## TL;DR

Four built-in containers cover almost everything. **Lists** are ordered and changeable: chat history is a list. **Dicts** map keys to values: every message, API request and JSON response is a dict. **Sets** hold unique items: deduplicating document IDs. **Tuples** are fixed records: `(text, score)` pairs from a vector search. An LLM chat is literally **a list of dicts**.

## At a glance

| Type | Literal | Ordered | Mutable | Duplicates | Typical AI use |
|---|---|---|---|---|---|
| `list` | `[1, 2]` | yes | yes | yes | Chat history, chunks, batch of prompts |
| `dict` | `{"k": "v"}` | yes (insertion) | yes | keys unique | Messages, JSON, config, caches |
| `set` | `{1, 2}` | no | yes | no | Seen IDs, unique tags, stopwords |
| `tuple` | `(1, 2)` | yes | no | yes | `(doc, score)` results, dict keys |

## Lists: chat history

```python
messages = [{"role": "system", "content": "You are concise."}]

messages.append({"role": "user", "content": "What is an embedding?"})
messages.append({"role": "assistant", "content": "A vector that represents meaning."})

len(messages)          # 3
messages[0]            # first item (system message)
messages[-1]           # last item
messages[-10:]         # last 10: simple history trimming
messages[1:]           # everything except the system message
```

Other useful methods: `extend`, `insert`, `pop`, `sort(key=...)`, `reversed(...)`.

## Dicts: messages and JSON

```python
msg = {"role": "user", "content": "Hi"}

msg["content"]                 # "Hi"
msg.get("name")                # None instead of KeyError
msg.get("name", "anonymous")   # default value
msg["name"] = "asha"           # add / update
"role" in msg                  # True: checks keys

for key, value in msg.items():
    print(key, value)
```

A parsed API response is nested dicts and lists. Walk it step by step:

```python
data = {
    "choices": [{"message": {"role": "assistant", "content": "Hello!"}}],
    "usage": {"prompt_tokens": 9, "completion_tokens": 3},
}

text = data["choices"][0]["message"]["content"]
total = sum(data["usage"].values())       # 12
```

Use `.get()` for keys that might be missing; use `[]` for keys that must exist (you want a loud error if they don't).

### Handy dict tools

```python
from collections import defaultdict, Counter

histories = defaultdict(list)          # per-user chat history, no KeyError
histories["user_42"].append({"role": "user", "content": "hey"})

labels = ["bug", "billing", "bug", "other"]
Counter(labels).most_common(1)         # [('bug', 2)]

defaults = {"model": "gpt-4o-mini", "temperature": 0.7}
config = {**defaults, "temperature": 0.2}   # merge, right side wins
```

## Sets: uniqueness

```python
retrieved = ["doc3", "doc1", "doc3", "doc7"]
unique_ids = set(retrieved)                    # {'doc1', 'doc3', 'doc7'}

seen = set()
for doc_id in retrieved:
    if doc_id in seen:                         # O(1) membership check
        continue
    seen.add(doc_id)

{"a", "b"} & {"b", "c"}    # intersection {'b'}
{"a", "b"} | {"b", "c"}    # union
```

Sets lose order. To dedupe while keeping order: `list(dict.fromkeys(retrieved))`.

## Tuples: fixed records

```python
results = [("Paris is the capital of France.", 0.91), ("Lyon is in France.", 0.74)]

for text, score in results:        # unpacking
    print(f"{score:.2f}  {text}")

best_text, best_score = max(results, key=lambda r: r[1])
```

Tuples are immutable and hashable, so they can be dict keys or set members (lists can't).

## Copying and mutation

```
history ──► [msg1, msg2]  ◄── same_history      (same_history = history)
copy    ──► [msg1, msg2]                         (copy = history.copy(), new list)
```

```python
base = [{"role": "system", "content": "Be brief."}]
convo = base               # NOT a copy: appending to convo changes base too
convo = base.copy()        # shallow copy: new list, same dicts inside
import copy
convo = copy.deepcopy(base)   # fully independent
```

This bites people who share one "template" history across users.

## Gotchas

- **Mutable default arguments** — `def chat(history=[])` reuses the same list across calls. Use `None` and create a new list inside.
- **`KeyError`** on API responses — fields like `tool_calls` can be absent; use `.get()`.
- **Modifying a list while looping over it** skips items. Loop over a copy or build a new list.
- **`{}` is an empty dict**, not a set. Empty set is `set()`.

## Key terms

- **List** — ordered, mutable sequence.
- **Dict** — mapping of unique, hashable keys to values; JSON objects become dicts.
- **Set** — unordered collection of unique, hashable items.
- **Tuple** — ordered, immutable sequence; good for fixed-size records.
- **Hashable** — has a stable hash, so it can be a dict key or set member.
- **Shallow vs deep copy** — copying the container only, vs. copying everything inside it too.

## Interview quick-fire

- **"How is a chat conversation represented for the OpenAI API?"** → A list of dicts, each with `role` and `content`.
- **"List vs tuple?"** → Lists are mutable; tuples are immutable and hashable, used for fixed records or dict keys.
- **"Fastest way to check if an ID was already processed?"** → Keep a set; membership is O(1) on average.
- **"`d['k']` vs `d.get('k')`?"** → `[]` raises `KeyError` if missing; `.get()` returns `None` or a default.
