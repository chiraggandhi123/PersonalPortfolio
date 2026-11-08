---
title: "Self-RAG (model decides when to retrieve)"
---

## TL;DR

Self-RAG makes the pipeline **reflect on itself** at three points: **should I retrieve at all?**, **is this passage relevant?**, and **is my answer supported by the passages and does it answer the question?** The original paper trained a model to emit special reflection tokens. In practice you build the same idea with **LLM-as-judge checks in a graph**: a hallucination check, an answer-quality check, and loops back to regenerate or re-retrieve, **with retry caps**.

## The three decisions

| Decision | Question asked | If "no" |
|---|---|---|
| Retrieve? | Does this question need external knowledge? | Answer directly (greetings, math, rewording) |
| Relevant? | Does this passage help? | Drop it (same as CRAG grading) |
| Supported? | Is every claim in the answer backed by the passages? | Regenerate (hallucination) |
| Useful? | Does the answer address the question? | Rewrite query and re-retrieve |

The paper's reflection tokens were `Retrieve`, `ISREL`, `ISSUP` and `ISUSE`. You don't need a special model. A small judge model with structured outputs works.

## The flow

```
question ──► need retrieval? ──no──► answer directly ──► END
                 │yes
                 ▼
             retrieve ──► grade docs ──► generate
                                            │
                                  grounded in docs? ──no──► regenerate (max 2)
                                            │yes
                                  answers question? ──no──► rewrite query ──► retrieve (max 2)
                                            │yes
                                            ▼
                                           END
```

## The judges

```python
from typing import Literal
from pydantic import BaseModel
from openai import OpenAI

client = OpenAI()

class Verdict(BaseModel):
    reason: str
    verdict: Literal["yes", "no"]

def judge(system: str, user: str) -> Verdict:
    r = client.chat.completions.parse(
        model="gpt-4o-mini", temperature=0, response_format=Verdict,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return r.choices[0].message.parsed

def needs_retrieval(q: str) -> bool:
    return judge("Does answering this need facts from company documents? yes/no.", q).verdict == "yes"

def is_grounded(answer: str, docs: list[str]) -> bool:
    joined = "\n---\n".join(docs)
    return judge("Is EVERY factual claim in the answer supported by the documents? "
                 "Any unsupported claim means 'no'.",
                 f"Documents:\n{joined}\n\nAnswer:\n{answer}").verdict == "yes"

def answers_question(q: str, answer: str) -> bool:
    return judge("Does the answer resolve the question? yes/no.",
                 f"Question: {q}\n\nAnswer: {answer}").verdict == "yes"
```

## The routing after generation

```python
MAX_GEN, MAX_RETRIEVE = 2, 2

def after_generate(s: dict) -> str:
    if not is_grounded(s["answer"], s["docs"]):
        return "generate" if s["gen_tries"] < MAX_GEN else "fallback"
    if not answers_question(s["question"], s["answer"]):
        return "rewrite" if s["retrieve_tries"] < MAX_RETRIEVE else "fallback"
    return "end"
```

`fallback` returns a safe message ("I couldn't find a reliable answer") with the sources it did find. Increment `gen_tries` in the generate node and `retrieve_tries` in the rewrite node. The graph wiring is the same as in [Corrective RAG](./02-corrective-rag.md), with `add_conditional_edges("generate", after_generate, ...)`.

## CRAG vs. Self-RAG vs. Adaptive RAG

| Pattern | Checks | Main fallback |
|---|---|---|
| Corrective RAG | Retrieved docs before generation | Rewrite or web search |
| Self-RAG | Whether to retrieve, plus the answer after generation | Regenerate or re-retrieve |
| Adaptive RAG | Routes by question type up front (no retrieval / single / multi-step) | Different pipeline per route |

Production graphs usually **combine** them: route first, grade docs, then check the answer.

## Production concerns

- **Cost multiplies.** The happy path adds about 3 judge calls; each retry adds more. Track the average calls per request.
- **Judge false negatives** cause needless regeneration. A strict "every claim" judge rejects good paraphrases. Calibrate it on labelled samples.
- **Regenerating with the same prompt** often gives the same answer. On retry, add the judge's `reason` as feedback ("Your last answer claimed X, which is not in the documents").
- **Skip-retrieval errors** are dangerous: a model that thinks it knows your refund policy will answer from memory. Bias the router toward retrieving.
- **Streaming conflicts with checking.** You can't verify an answer you've already streamed. Either check before sending, or stream and attach a "low confidence" flag after.

## Key terms

- **Reflection** — the model or a judge critiquing retrieval or its own output.
- **Reflection tokens** — special tokens in the original Self-RAG model (Retrieve, ISREL, ISSUP, ISUSE).
- **Groundedness / hallucination check** — verifying the answer's claims appear in the context.
- **Answer relevance check** — verifying the answer addresses the question.
- **LLM-as-judge** — using an LLM to evaluate another LLM's output.

## Interview quick-fire

- **"What's the core idea of Self-RAG?"** → The system decides when to retrieve and critiques its own answer for support and usefulness, looping when checks fail.
- **"Do you need the special Self-RAG model?"** → No. LLM-as-judge nodes in a LangGraph graph give the same behaviour with any model.
- **"How do you make regeneration actually change the answer?"** → Feed the judge's reason back into the prompt and lower freedom (temperature 0, stricter grounding instructions).
- **"Difference from CRAG?"** → CRAG checks the docs before generation; Self-RAG also checks the answer after generation.
