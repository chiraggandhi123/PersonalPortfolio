---
title: "Prompt Templates & Versioning"
---

## TL;DR

Once a prompt is in production, it's **code**: it needs placeholders, a home outside your business logic, a **version number**, and **tests** that run before you change it. Use templates (f-strings, Jinja2 or LangChain `ChatPromptTemplate`) to fill in variables safely, store prompts as **files in git** (or a prompt registry), and log which version produced each output so you can compare and roll back.

## From hard-coded string to template

```
Stage 1: prompt string inside the function        → hard to find, hard to change
Stage 2: template with variables                  → reusable
Stage 3: template in its own file, versioned       → reviewable, testable, swappable
Stage 4: registry + eval on every change           → safe to iterate in production
```

## Templating options

| Tool | Good for | Watch out |
|---|---|---|
| f-strings / `str.format` | Small scripts | No loops or conditionals; braces in JSON examples clash |
| Jinja2 | Loops over examples, conditionals, files | One more dependency |
| LangChain `ChatPromptTemplate` | Multi-message prompts inside LangChain chains | Ties prompts to LangChain |
| Provider prompt features / registries | Editing prompts without redeploying | Vendor lock-in, needs access control |

## Jinja2 template in a file

`prompts/summarize/v2.j2`:

```text
You summarize documents for {{ audience }}.
Write {{ n_bullets }} bullets, each under 20 words.
{% if examples %}
Examples of good bullets:
{% for ex in examples %}- {{ ex }}
{% endfor %}
{% endif %}
<document>
{{ document }}
</document>
```

```python
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from openai import OpenAI

env = Environment(loader=FileSystemLoader("prompts"), undefined=StrictUndefined)  # fail on missing vars
client = OpenAI()

PROMPT_VERSION = "summarize/v2"

def summarize(document: str, audience: str = "executives", version: str = PROMPT_VERSION) -> str:
    prompt = env.get_template(f"{version}.j2").render(
        audience=audience, n_bullets=3, examples=[], document=document
    )
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
    )
    # log the version with every call so outputs are traceable
    print({"prompt_version": version, "usage": resp.usage.total_tokens})
    return resp.choices[0].message.content
```

`StrictUndefined` makes a missing variable raise an error instead of silently rendering an empty string.

## LangChain `ChatPromptTemplate`

```python
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a {role}. Answer in {language}."),
    ("human", "{question}"),
])

messages = prompt.invoke({"role": "travel agent", "language": "Hindi", "question": "Best time to visit Goa?"})
```

It plugs directly into chains (`prompt | llm`), covered in [LangChain](./07-building-llm-apps-with-langchain.md).

## Versioning

A simple, solid setup:

```
prompts/
  summarize/
    v1.j2
    v2.j2          ← current
    CHANGELOG.md   ← what changed and why, with eval scores
  classify/
    v1.j2
evals/
  summarize_cases.jsonl
```

- **Never edit a live version in place.** Copy to `v3`, change it, compare, then switch the pointer.
- **Pin the model too.** A prompt version only means something together with a model version and settings (temperature, max tokens).
- **Log `prompt_version`, `model`, and inputs/outputs** for each call. Tracing tools such as LangSmith or Langfuse do this for you.

## Testing a prompt change

```python
import json

def run_eval(version: str) -> float:
    cases = [json.loads(line) for line in open("evals/summarize_cases.jsonl")]
    passed = 0
    for case in cases:
        out = summarize(case["document"], version=version)
        bullets = [l for l in out.splitlines() if l.strip().startswith(("-", "•"))]
        ok = len(bullets) == 3 and all(kw.lower() in out.lower() for kw in case["must_mention"])
        passed += ok
    return passed / len(cases)

print("v1:", run_eval("summarize/v1"), "v2:", run_eval("summarize/v2"))
```

Start with cheap **deterministic checks** (format, length, required keywords). Add an **LLM-as-judge** score for quality later. Ship the new version only if it doesn't regress.

## Gotchas

- **Braces.** In f-strings and LangChain templates, literal `{` and `}` (e.g. JSON examples) must be doubled. Jinja2 avoids this.
- **Template injection.** Never let users supply the template itself. Only fill variables, and treat their values as data.
- **Whitespace and order matter.** A "harmless" reformat can change outputs. Run the eval anyway.
- **Too many variants.** Per-customer prompt forks are hard to maintain. Prefer one template with variables.

## Key terms

- **Prompt template** — a prompt with named placeholders filled at runtime.
- **Prompt registry** — a central store of prompt versions that apps fetch by name and version.
- **Prompt version** — an immutable snapshot of a prompt, tied to a model and settings.
- **Regression eval** — a fixed test set re-run on every prompt change.
- **LLM-as-judge** — using a model to grade another model's output against criteria.

## Interview quick-fire

- **"How do you manage prompts in production?"** → Store them as versioned files or in a registry, log the version with each call, and run an eval set before switching versions.
- **"Why version prompts separately from code?"** → They change more often, non-engineers may edit them, and you need to roll back or A/B test without redeploying.
- **"How do you test a prompt change?"** → Run old and new versions on the same cases, compare deterministic checks and judge scores, and ship only on no regression.
- **"f-strings vs. Jinja2?"** → f-strings for tiny prompts; Jinja2 when you need loops, conditionals, files and strict missing-variable errors.
