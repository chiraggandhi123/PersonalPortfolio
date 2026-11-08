---
title: "Introduction to RAG"
---

## TL;DR

**RAG = retrieve, then generate.** Before calling the LLM, you search your own documents for passages relevant to the question and paste them into the prompt with an instruction like "answer only from this context". The model's job changes from **remembering facts** to **reading and summarizing** supplied text, which it does much more reliably. RAG gives you fresh data, private data and **citations** without retraining the model.

## The idea in one picture

```
Without RAG:   question ─────────────────────────────► LLM ──► answer from memory (may be stale or invented)

With RAG:      question ──► search your docs ──► top chunks
                    │                               │
                    └──────────► prompt = instructions + chunks + question ──► LLM ──► grounded answer + sources
```

It is an **open-book exam**. The model is the student; retrieval hands it the right pages.

## Why not just ask the model?

| Problem | Example | RAG's fix |
|---|---|---|
| Knowledge cutoff | "What changed in our refund policy last week?" | Index the new policy doc |
| Private data | "What did the Q3 board deck say about hiring?" | The deck is in your index, not in the training data |
| Hallucination | Invents a plausible API parameter | Answer must come from retrieved docs; say "I don't know" otherwise |
| No traceability | User can't verify the answer | Return the source file and page with each answer |
| Context window cost | Can't paste 10,000 pages into every prompt | Send only the 3–8 most relevant chunks |

## A minimal RAG in plain Python

No framework, just to show there is no magic. LangChain versions follow in later notes.

```python
import numpy as np
from openai import OpenAI

client = OpenAI()

docs = [
    "Refunds are available within 30 days of purchase with a receipt.",
    "Our support team is available Monday to Friday, 9am to 6pm IST.",
    "Premium members get free shipping on all orders above Rs 500.",
]

def embed(texts: list[str]) -> np.ndarray:
    resp = client.embeddings.create(model="text-embedding-3-small", input=texts)
    return np.array([d.embedding for d in resp.data])

doc_vecs = embed(docs)                                   # 1. index (once)

def answer(question: str, k: int = 2) -> str:
    q_vec = embed([question])[0]
    scores = doc_vecs @ q_vec                            # 2. retrieve (OpenAI vectors are normalized → dot = cosine)
    top = [docs[i] for i in np.argsort(scores)[::-1][:k]]
    context = "\n".join(f"- {t}" for t in top)

    resp = client.chat.completions.create(               # 3. generate
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {"role": "system", "content": "Answer only from the context. If the answer is not there, say you don't know."},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
    )
    return resp.choices[0].message.content

print(answer("Can I return something I bought 3 weeks ago?"))
```

Real systems add chunking, a vector database, metadata and evaluation, but the shape stays the same.

## RAG vs. fine-tuning vs. long context

| Approach | Good for | Weak at |
|---|---|---|
| **RAG** | Facts that change, private docs, citations | Needs good retrieval; adds latency |
| **Fine-tuning** | Style, tone, output format, narrow skills | Adding or updating facts; no citations; costly to redo |
| **Long context** (stuff everything in) | Small corpora, one-off analysis of a few files | Cost and latency per call; models miss facts in the middle of huge prompts |

They combine well: a fine-tuned model can still use RAG, and long-context models let you send more retrieved chunks.

## Where RAG fails

Most failures are **retrieval failures**, not generation failures:

- **Wrong chunks retrieved** — vocabulary mismatch, bad chunking, query too vague.
- **Right info split across chunks** — the answer needs two pieces that never get retrieved together.
- **Model ignores context** — uses its own memory instead. Fix with a stricter prompt and `temperature=0`.
- **Stale index** — docs updated but not re-indexed.
- **Questions RAG can't answer** — "how many tickets were filed last month?" needs SQL, not similarity search.

The rest of this stage is a toolkit for these failures: better chunking, hybrid search, query rewriting, reranking, and agents that retry.

## Common use cases

- Chat with documentation, policies or manuals.
- Customer support bots grounded in a help center.
- Internal enterprise search across Confluence, Drive and Slack.
- Code assistants that retrieve from a repository.
- Legal, medical or financial Q&A where citations are required.

## Key terms

- **Retrieval-Augmented Generation (RAG)** — adding retrieved documents to the prompt before generation.
- **Chunk** — a small piece of a document that is embedded and retrieved as one unit.
- **Top-k** — the number of most similar chunks returned by a search.
- **Context** — the retrieved text placed in the prompt.
- **Grounded answer** — an answer supported by the provided context.
- **Knowledge cutoff** — the date after which a model has no training data.

## Interview quick-fire

- **"Explain RAG in one sentence."** → Search a knowledge base for passages relevant to the question and give them to the LLM in the prompt so it answers from them.
- **"Why does RAG reduce hallucinations?"** → The model summarizes supplied text instead of recalling facts, and the prompt allows it to say "I don't know" when the context lacks the answer.
- **"When would you not use RAG?"** → When the task is about style or format (fine-tune), when the whole corpus fits cheaply in context, or when the question needs aggregation over structured data (use SQL).
- **"What is the most common cause of bad RAG answers?"** → Poor retrieval: the right chunk never reaches the prompt.
