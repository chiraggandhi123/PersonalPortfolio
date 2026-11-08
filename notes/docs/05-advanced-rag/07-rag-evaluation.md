---
title: "RAG Evaluation (faithfulness, relevance, eval sets)"
---

## TL;DR

You can't improve RAG by eyeballing a few answers. Build a fixed **eval set** of questions with reference answers, run your pipeline over it, and score **retrieval** and **generation** separately. The core metrics: **context precision** (are retrieved chunks relevant and ranked well?), **context recall** (did we retrieve everything needed?), **faithfulness** (is the answer supported by the context?) and **answer relevancy** (does it address the question?). Frameworks like **RAGAS** compute these with LLM judges. Run evals **on every change** and compare against a baseline.

## The metric map

```
question ──► retriever ──► contexts ──► generator ──► answer
               │                           │
     context precision              faithfulness (answer vs. contexts)
     context recall (vs. reference) answer relevancy (answer vs. question)
     hit rate / MRR (vs. gold ids)  answer correctness (answer vs. reference)
```

| Metric | Measures | Needs reference? | Low score means |
|---|---|---|---|
| Context precision | Share of retrieved chunks that are relevant, rewarding relevant ones ranked high | Optional (judge or reference) | Noisy retrieval; add reranking, lower k |
| Context recall | Share of reference-answer claims found in the contexts | Yes | Missing info; fix chunking, hybrid search, query rewriting |
| Faithfulness | Share of answer claims supported by the contexts | No | Hallucination; tighten the prompt, add a grounding check |
| Answer relevancy | How well the answer addresses the question | No | Rambling or evasive answers |
| Answer correctness | Agreement with the reference answer | Yes | End-to-end wrong |
| Hit rate @k / MRR | Gold chunk in the top k / rank of the first gold chunk | Gold chunk ids | Retriever quality, no LLM needed |

Faithfulness and correctness are different. An answer can be faithful to wrong context, or correct but drawn from the model's memory.

## Building the eval set

- **Start with 30–100 real questions** from logs or users, not just ones you invented.
- Cover the categories: simple lookup, multi-hop, comparison, "not in the docs" (expected answer: I don't know), adversarial.
- Write a **reference answer** and, ideally, the **gold source** for each.
- **Synthetic generation** (an LLM writes Q&A from your chunks) scales coverage, but review it. Synthetic questions are often too easy because they copy the chunk's wording.
- Version the set in git and grow it with every production bug you fix.

`eval_set.jsonl`, one example per line:

```
{"question": "How many days of parental leave do new fathers get?", "reference": "Fathers get 15 working days of paid leave.", "category": "lookup"}
{"question": "What is the parking policy on Mars?", "reference": "I don't know.", "category": "unanswerable"}
```

## Running RAGAS

```python
import json
from ragas import evaluate, EvaluationDataset
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import Faithfulness, ResponseRelevancy, LLMContextPrecisionWithReference, LLMContextRecall
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from ragas.embeddings import LangchainEmbeddingsWrapper

rows = []
for line in open("eval_set.jsonl"):
    ex = json.loads(line)
    answer, docs = my_rag(ex["question"])                 # your pipeline returns answer + chunks
    rows.append({"user_input": ex["question"], "response": answer,
                 "retrieved_contexts": [d.page_content for d in docs], "reference": ex["reference"]})

result = evaluate(
    EvaluationDataset.from_list(rows),
    metrics=[Faithfulness(), ResponseRelevancy(), LLMContextPrecisionWithReference(), LLMContextRecall()],
    llm=LangchainLLMWrapper(ChatOpenAI(model="gpt-4o-mini", temperature=0)),
    embeddings=LangchainEmbeddingsWrapper(OpenAIEmbeddings(model="text-embedding-3-small")),
)
print(result)                         # mean score per metric
df = result.to_pandas()               # per-question scores, sort to find the worst
```

The RAGAS API has changed across versions (metric and field names in particular). Check the version you install. DeepEval, TruLens, LangSmith and Phoenix offer similar metrics.

## Retrieval metrics without an LLM

```python
def hit_rate_and_mrr(results: list[tuple[list[str], set[str]]], k: int = 5):
    hits, rr = 0, 0.0
    for retrieved_ids, gold_ids in results:
        for rank, cid in enumerate(retrieved_ids[:k], start=1):
            if cid in gold_ids:
                hits += 1
                rr += 1 / rank
                break
    n = len(results)
    return hits / n, rr / n
```

Cheap, fast and deterministic. Use it to tune chunk size, k, hybrid weights and rerankers before running LLM-judged metrics.

## Using evals in practice

- **Baseline first.** Record scores for the current pipeline, then change one thing at a time.
- **Gate in CI.** Fail the build if faithfulness drops more than a few points against the baseline.
- **Read the worst 10.** Averages hide failures. Sort per-question scores and inspect them.
- **Track cost and latency** next to quality. A 2-point gain that doubles latency may not be worth it.
- **Online evals.** Sample production traffic, run faithfulness and relevancy asynchronously, and collect thumbs up/down.

## Judge pitfalls

- LLM judges are **noisy**. Small differences (0.81 vs. 0.83) on 50 questions are often not real. Run multiple times or use more questions.
- Judges have **biases**: they favour longer answers and their own model family. Use temperature 0 and a strong judge model.
- **Validate the judge** against human labels on a sample before trusting it.
- Keep the **judge model fixed** across runs, or scores aren't comparable.

## Key terms

- **Eval set / golden dataset** — fixed questions with reference answers used to score a pipeline.
- **Context precision** — how relevant and well-ranked the retrieved chunks are.
- **Context recall** — how much of the needed information was retrieved.
- **Faithfulness** — share of answer claims supported by the retrieved context.
- **Answer relevancy** — how directly the answer addresses the question.
- **MRR** — mean reciprocal rank of the first relevant result.
- **RAGAS** — an open-source framework of LLM-judged RAG metrics.

## Interview quick-fire

- **"How do you evaluate a RAG system?"** → A versioned eval set; retrieval metrics (context precision/recall, hit rate) and generation metrics (faithfulness, relevancy, correctness) scored separately; run on every change against a baseline.
- **"Faithfulness vs. answer correctness?"** → Faithfulness checks the answer against the retrieved context; correctness checks it against the reference answer.
- **"Low context recall, high faithfulness — what's wrong?"** → The generator behaves, but retrieval misses information. Fix chunking, hybrid search or query rewriting.
- **"Can you trust LLM-as-judge scores?"** → Only after checking them against human labels, with a fixed judge model and enough questions to beat the noise.
