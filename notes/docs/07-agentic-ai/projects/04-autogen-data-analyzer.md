---
title: "AutoGen Data Analyzer"
---

## Goal

Build a small team of AutoGen agents that **answers questions about a CSV by writing and running Python**. An analyst agent writes pandas/matplotlib code, a code-executor agent runs it in a sandbox and returns the output, and the analyst reads the result and either fixes the code or writes the final answer. See [Microsoft AutoGen](../04-microsoft-autogen.md) for the concepts.

**Skills practiced:** multi-agent conversation, code execution in a sandbox, termination conditions, self-correction from errors, model clients, async Python.

## Architecture

```
user question + data.csv
        │
        ▼
┌──────────────────── RoundRobinGroupChat ────────────────────┐
│                                                             │
│  analyst (AssistantAgent) ── writes ```python``` block ──►  │
│                                                             │
│  executor (CodeExecutorAgent) ── runs it in ./work ──────►  │
│        stdout / traceback / saved chart.png                 │
│                                                             │
│  analyst reads output → fixes code, or answers + "TERMINATE"│
└─────────────────────────────────────────────────────────────┘
        │  stop on "TERMINATE" or after 12 messages
        ▼
final answer + files in ./work (charts, cleaned CSVs)
```

The key idea: the LLM never "imagines" numbers. **Every number in the answer comes from code that actually ran.**

## Setup

AutoGen was rewritten in v0.4 (packages `autogen-agentchat` and `autogen-ext`). The old `pyautogen` / `autogen` 0.2 API (`UserProxyAgent`, `initiate_chat`) is different. Microsoft is also folding AutoGen into its newer Agent Framework, so check the docs for import paths before you build.

```bash
pip install "autogen-agentchat" "autogen-ext[openai,docker]" pandas matplotlib python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

Put your dataset at `work/data.csv`. Docker is optional but recommended for running untrusted code.

## Code — `analyzer.py`

```python
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from autogen_agentchat.agents import AssistantAgent, CodeExecutorAgent
from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.ui import Console
from autogen_ext.code_executors.local import LocalCommandLineCodeExecutor
from autogen_ext.models.openai import OpenAIChatCompletionClient

load_dotenv()
WORK_DIR = Path("work")

ANALYST_PROMPT = """You are a data analyst. The dataset is at data.csv in the working directory.
Answer the user's question by writing ONE Python code block at a time (pandas, matplotlib).
- First inspect the data (df.head(), df.dtypes) before analysing it.
- Always print() the values you need. Save charts with plt.savefig('chart.png'), never plt.show().
- If the code fails, read the traceback and send a fixed version.
- When you have the answer from real output, explain it in plain words and end with TERMINATE."""


async def main(question: str):
    model = OpenAIChatCompletionClient(model="gpt-4o-mini")

    # For untrusted code, swap in DockerCommandLineCodeExecutor(work_dir=WORK_DIR)
    executor = LocalCommandLineCodeExecutor(work_dir=WORK_DIR, timeout=60)

    analyst = AssistantAgent("analyst", model_client=model, system_message=ANALYST_PROMPT)
    runner = CodeExecutorAgent("executor", code_executor=executor)

    stop = TextMentionTermination("TERMINATE") | MaxMessageTermination(12)
    team = RoundRobinGroupChat([analyst, runner], termination_condition=stop)

    await Console(team.run_stream(task=question))   # prints each message as it streams
    await model.close()


if __name__ == "__main__":
    asyncio.run(main("Which product category has the highest average revenue per order? Plot the top 5."))
```

Run with `python analyzer.py`. Watch the analyst inspect the data, hit an error or two, fix them, and finish.

### Using Docker instead of local execution

```python
from autogen_ext.code_executors.docker import DockerCommandLineCodeExecutor

async with DockerCommandLineCodeExecutor(work_dir=WORK_DIR, image="python:3.12-slim") as executor:
    runner = CodeExecutorAgent("executor", code_executor=executor)
    ...  # build and run the team inside this block
```

The slim image lacks pandas. Either build a custom image with your libraries or let the agent `pip install` inside the container.

## How it works

1. **`RoundRobinGroupChat`** alternates speakers: analyst, executor, analyst, executor...
2. The analyst's reply contains a fenced Python block. **`CodeExecutorAgent`** extracts it, runs it in `work/`, and posts stdout or the traceback back as a message.
3. Because the whole conversation is shared, the analyst sees the error and corrects itself. This is the same reason-act-observe loop as [ReAct](../01-the-react-loop.md), with "run code" as the only tool.
4. **Termination conditions** combine with `|` (or) and `&` (and). `MaxMessageTermination` is your safety net against endless fix-and-retry loops.
5. Files the code writes (`chart.png`) stay in `work/`, so you can show them in a UI later.

## Gotchas

- **Never run model-written code on your laptop unsandboxed in production.** It can delete files or read secrets. Use Docker, a VM, or a hosted sandbox.
- **Big CSVs** — tell the model to sample or aggregate. Printing 100k rows floods the context window.
- **Hallucinated columns** — forcing a `df.head()` / `df.columns` step first removes most of these errors.
- **Cost** — each retry resends the whole conversation. Cap messages and keep printed output short.

## Stretch goals

- [ ] **Streamlit UI** — upload a CSV, ask questions, display `chart.png` inline.
- [ ] **Add a critic agent** that reviews the final answer against the printed output before `TERMINATE`.
- [ ] **SelectorGroupChat** — let the model pick the next speaker among analyst, executor and critic.
- [ ] **Docker image** with pandas, matplotlib and seaborn preinstalled.
- [ ] **Report mode** — produce a Markdown report with three insights and their charts.
- [ ] **Swap models** — try a local model via an OpenAI-compatible endpoint and compare how often code fails.
- [ ] **Token logging** — record usage per run to see what retries cost.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
