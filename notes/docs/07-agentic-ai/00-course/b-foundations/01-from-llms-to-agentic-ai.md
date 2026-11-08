---
title: "From LLMs to Agentic AI"
---

## TL;DR

A plain LLM **maps text to text** in one shot: it can't look things up, act, or check its own work. Agentic AI wraps the LLM in a **loop with tools, memory and a goal**, so it can plan, act, observe the result and try again. The progression is **LLM → LLM app → RAG → tool use → agent → multi-agent**, and each step hands more of the control flow to the model.

## What a plain LLM can't do

| Limitation | Example | What fixes it |
|---|---|---|
| Frozen knowledge | Doesn't know today's news | Retrieval / search tools |
| No actions | Can't send the email it drafted | Tool calling |
| One shot | Can't notice its first answer was wrong | A loop that feeds results back |
| No memory | Forgets the previous session | Persisted state / memory store |
| Weak at exact work | Miscounts, bad at big arithmetic | Code / calculator tools |

## The progression

```
1. LLM               prompt ──► model ──► text
2. LLM app           template + prompt ──► model ──► parsed output
3. RAG               question ──► retrieve docs ──► model ──► grounded answer
4. Tool use          model ──► tool call ──► your code ──► model ──► answer   (one round)
5. Agent             loop: model ──► tool ──► observe ──► model ...  until done
6. Multi-agent       supervisor ──► researcher / writer / reviewer agents
```

Levels 1–4 are mostly **workflows**: your code fixes the steps. From level 5, the **model decides the steps**.

## Generative AI vs. agentic AI

| | Generative AI | Agentic AI |
|---|---|---|
| Unit of work | One response | A task with several steps |
| Who controls flow | Your code | The model, within limits you set |
| Interaction | Reactive: answers a prompt | Proactive: pursues a goal |
| Uses tools | Optional, usually one round | Central, many rounds |
| State | Usually none | Working memory across steps |
| Failure mode | A wrong answer | A wrong action, a loop, runaway cost |

Agentic AI still uses a generative model. The difference is the **system around it**.

## The agent loop (ReAct)

Most agents follow **Reason → Act → Observe**:

```
goal ──► think: "I need the current price" ──► act: search("BTC price")
              ▲                                         │
              └──────── observe: "$..." ◄───────────────┘
         ... repeat until the model answers without a tool call
```

## The same question, three ways

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain.agents import create_agent

llm = ChatOpenAI(model="gpt-4o-mini")
question = "What is 17.5% of 2,348,113?"

# 1. Plain LLM: guesses the arithmetic, may be wrong
print(llm.invoke(question).content)

# 2. Agent: decides to call a tool, observes, then answers
@tool
def calculator(expression: str) -> str:
    """Evaluate a Python arithmetic expression, e.g. '0.175 * 2348113'."""
    return str(eval(expression, {"__builtins__": {}}))    # demo only: sandbox in real code

agent = create_agent(model=llm, tools=[calculator])
result = agent.invoke({"messages": [{"role": "user", "content": question}]})
print(result["messages"][-1].content)
```

The agent's message list shows the loop: a user message, an AI message with a tool call, a tool message with the result, and a final AI answer.

## The autonomy spectrum

```
less autonomy ◄──────────────────────────────────────────► more autonomy
single call   chain   router   tool-calling agent   multi-agent   long-running autonomous agent
```

More autonomy handles more varied tasks, but costs more, is harder to test and can fail in new ways. Move right only when you need to.

## Gotchas

- **Agents amplify errors.** One bad tool result early on poisons every later step.
- **Cost grows with steps.** Each loop resends the whole history. Cap iterations.
- **"Agent" is overused.** A fixed chain with an LLM in it is a workflow; that's often the right choice.
- **Tools are the attack surface.** A prompt injection in a web page can steer an agent that browses. Limit what tools can do.

## Key terms

- **LLM** — a model that predicts the next token; on its own, a stateless text-in, text-out function.
- **Agentic AI** — systems where an LLM pursues a goal over several steps using tools, memory and feedback.
- **ReAct** — a pattern that interleaves reasoning, tool actions and observations in a loop.
- **Tool calling** — the model emitting a structured request for your code to run a function.
- **Autonomy** — the share of decisions about control flow made by the model.

## Interview quick-fire

- **"What makes an LLM application 'agentic'?"** → The model chooses its next action in a loop, using tools and observations, instead of following a fixed sequence written in code.
- **"Generative vs. agentic AI?"** → Generative produces one response to a prompt; agentic pursues a goal over multiple steps, acting through tools and adapting to results.
- **"Why not make everything an agent?"** → Agents are slower, costlier and less predictable. If the steps are known, a workflow is easier to test and cheaper to run.
- **"What is ReAct?"** → Reason, act, observe, repeat: the model thinks, calls a tool, reads the result and decides the next step.
