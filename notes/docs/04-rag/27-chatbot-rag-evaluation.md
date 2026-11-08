---
title: "Chatbot & RAG Evaluation"
---

## TL;DR

You can't tell whether a RAG change helped by trying three questions. Build a **golden dataset** (questions, reference answers, ideally the source chunks), run the pipeline over it, and score **retrieval** and **generation** separately. Retrieval metrics: **hit rate / recall@k** and **MRR**. Generation metrics: **faithfulness** (grounded in context?), **answer relevance** and **correctness** vs. the reference, usually scored by an **LLM judge**. Chatbots add **multi-turn** checks: memory, follow-ups, tone. Tools like **RAGAS, DeepEval and LangSmith** automate this. [RAG evaluation in Advanced RAG](../05-advanced-rag/07-rag-evaluation.md) goes deeper on metrics.

## What to measure

```
question ─► retriever ─► chunks ─► generator ─► answer
               │                        │
      retrieval metrics           generation metrics
      - hit rate / recall@k       - faithfulness (answer vs. chunks)
      - MRR / precision@k         - answer relevance (answer vs. question)
                                  - correctness (answer vs. reference)
```

| Metric | Question it answers | Needs |
|---|---|---|
| Hit rate (recall@k) | Did the right chunk appear in the top k? | Gold chunk ids |
| MRR | How high was the first right chunk? | Gold chunk ids |
| Context precision | Are the retrieved chunks mostly relevant? | LLM judge or labels |
| Faithfulness | Is every claim supported by the chunks? | Answer + chunks |
| Answer relevance | Does it address the question? | Question + answer |
| Correctness | Does it match the reference answer? | Reference answer |
| Latency / cost | Is it fast and cheap enough? | Traces |

## Building the eval set

1. **Collect real questions** from logs, support tickets or users (best).
2. **Generate synthetic questions** from your chunks with an LLM, then review them by hand.
3. **Label** the reference answer and the chunk id(s) that contain it.
4. **Include hard cases:** unanswerable questions, multi-hop, ambiguous, out-of-scope.

Start with 30–100 examples. A small, clean set beats a big noisy one.

## A minimal eval harness

```python
from pydantic import BaseModel, Field
from openai import OpenAI

client = OpenAI()

dataset = [
    {"question": "How long is the free trial?", "reference": "14 days", "gold_ids": ["pricing-2"]},
    {"question": "Do you support SSO?", "reference": "Yes, on the Enterprise plan", "gold_ids": ["security-1"]},
]

class Judgement(BaseModel):
    faithfulness: int = Field(description="1-5: claims supported by the context")
    correctness: int = Field(description="1-5: matches the reference answer")
    reason: str

def judge(question, context, answer, reference) -> Judgement:
    return client.chat.completions.parse(
        model="gpt-4o-mini",
        temperature=0,
        messages=[{"role": "system", "content": "You are a strict evaluator of RAG answers."},
                  {"role": "user", "content": f"Question: {question}\nContext: {context}\n"
                   f"Answer: {answer}\nReference: {reference}"}],
        response_format=Judgement,
    ).choices[0].message.parsed

def evaluate(rag_pipeline, k=4):
    hits, rr, faith, correct = 0, 0.0, [], []
    for ex in dataset:
        chunks, answer = rag_pipeline(ex["question"], k=k)   # returns [(id, text)], str
        ids = [cid for cid, _ in chunks]
        ranks = [i for i, cid in enumerate(ids, 1) if cid in ex["gold_ids"]]
        hits += bool(ranks)
        rr += 1 / ranks[0] if ranks else 0
        j = judge(ex["question"], "\n".join(t for _, t in chunks), answer, ex["reference"])
        faith.append(j.faithfulness)
        correct.append(j.correctness)
    n = len(dataset)
    return {"hit_rate": hits / n, "mrr": rr / n,
            "faithfulness": sum(faith) / n, "correctness": sum(correct) / n}
```

Run it before and after every change (chunk size, embedding model, prompt, reranker) and compare.

## Frameworks

| Tool | Strength |
|---|---|
| RAGAS | Ready-made RAG metrics (faithfulness, context precision/recall, answer relevancy) and test-set generation |
| DeepEval | Pytest-style LLM tests with many metrics |
| LangSmith | Datasets, experiments, LLM-as-judge evaluators, side-by-side comparison, tied to traces |
| TruLens, Phoenix, Langfuse | Tracing plus feedback/eval functions |

Their APIs change between versions; follow the current docs rather than old blog snippets.

## Evaluating a chatbot (multi-turn)

Single-turn metrics miss conversation problems. Also test:

- **Context carry-over** — "What about the Pro plan?" after a pricing question.
- **Memory** — does it remember facts the user gave earlier?
- **Refusals and scope** — does it decline off-topic or unsafe requests politely?
- **Tone and format** — length, language, brand voice.

Write scripted conversations, replay them, and judge the final turns. Add **online signals** in production: thumbs up/down, escalation to a human, conversation abandonment.

## Gotchas and best practices

- **Evaluate retrieval separately.** If the right chunk isn't retrieved, no prompt fix will help.
- **LLM judges are biased** (towards longer answers, their own style). Calibrate them against a few human labels.
- **Use integer scales or pass/fail** rather than fine-grained floats; judges are more consistent.
- **Keep the eval set fixed** and versioned so scores are comparable over time.
- **Watch for regressions in CI**: fail the build if a key metric drops below a threshold.

## Key terms

- **Golden dataset** — curated questions with reference answers (and source chunks) used for evaluation.
- **Hit rate / recall@k** — share of questions whose relevant chunk is in the top k results.
- **MRR (mean reciprocal rank)** — average of 1/rank of the first relevant result.
- **Faithfulness** — whether the answer's claims are supported by the retrieved context.
- **LLM-as-judge** — using an LLM with a rubric to score outputs.
- **Online evaluation** — measuring quality on live traffic via feedback and monitoring.

## Interview quick-fire

- **"How do you evaluate a RAG system?"** → A golden dataset, retrieval metrics (hit rate, MRR) and generation metrics (faithfulness, relevance, correctness) via LLM judges, run on every change.
- **"Faithfulness vs. correctness?"** → Faithfulness checks the answer against the retrieved context; correctness checks it against the true reference answer.
- **"How do you trust an LLM judge?"** → Compare its scores with human labels on a sample, use clear rubrics, low temperature and simple scales.
- **"What's different about evaluating a chatbot?"** → Multi-turn behaviour: context carry-over, memory, refusals and tone, plus online user feedback.
