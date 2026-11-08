---
title: "Query Enhancement"
---

## TL;DR

Users write short, vague or multi-part questions that don't look like the documents that answer them. **Query enhancement** uses an LLM to transform the query **before retrieval**: **rewrite** it into a clear search query, generate **multiple variants** (multi-query), write a **hypothetical answer** and search with that (HyDE), **decompose** complex questions into sub-questions, or **route** the query to the right source. Each costs an extra LLM call, so add them when evaluation shows retrieval misses.

## Why queries need help

```
User asks:      "and what about for contractors?"          (depends on chat history)
User asks:      "leave"                                    (too short)
User asks:      "compare 2023 and 2024 travel policy"      (two retrievals needed)
Doc says:       "Non-permanent staff accrue 1 day of PTO per month."
```

The question and the answer use different words, lack context, or need several lookups.

## Techniques

| Technique | What it does | Best for |
|---|---|---|
| Query rewriting | Turn the input into a clean, specific search query | Vague or conversational queries |
| Conversational condensing | Rewrite a follow-up into a standalone question using chat history | Chatbots |
| Multi-query | Generate 3–5 paraphrases, retrieve for each, merge | Vocabulary mismatch, better recall |
| HyDE | Generate a fake answer, embed it, search with it | Short queries vs. long documents |
| Step-back prompting | Ask a more general question first ("what is the leave policy?") | Questions needing background |
| Decomposition | Split into sub-questions, retrieve for each | Comparisons, multi-hop questions |
| Routing | Pick the data source or index (docs vs. SQL vs. web) | Multiple knowledge sources |
| Self-query | LLM extracts metadata filters from the query ("2024 HR policies") | Filterable metadata |

## Setup

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from pydantic import BaseModel

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
# `retriever` is any retriever from earlier notes, e.g. vectorstore.as_retriever(search_kwargs={"k": 5})
```

## Conversational rewrite

```python
condense = ChatPromptTemplate.from_template(
    "Given the chat history and a follow-up question, rewrite the follow-up as a "
    "standalone search query. Return only the query.\n\nHistory:\n{history}\n\nFollow-up: {question}"
)
rewrite_chain = condense | llm | StrOutputParser()

standalone = rewrite_chain.invoke({
    "history": "User: How many leave days do employees get?\nAI: 18 days per year.",
    "question": "and for contractors?",
})
# → "How many leave days do contractors get per year?"
docs = retriever.invoke(standalone)
```

Without this step, follow-up questions retrieve almost nothing useful.

## Multi-query with fusion

```python
class Queries(BaseModel):
    queries: list[str]

multi_prompt = ChatPromptTemplate.from_template(
    "Write 4 different search queries that could find documents answering this question. "
    "Vary the wording and use likely synonyms.\n\nQuestion: {question}"
)
multi_chain = multi_prompt | llm.with_structured_output(Queries)

def multi_query_retrieve(question: str, top_n: int = 6):
    queries = [question] + multi_chain.invoke({"question": question}).queries
    scores, by_text = {}, {}
    for q in queries:
        for rank, d in enumerate(retriever.invoke(q)):          # RRF across the variants
            by_text[d.page_content] = d
            scores[d.page_content] = scores.get(d.page_content, 0) + 1 / (60 + rank + 1)
    return [by_text[t] for t in sorted(scores, key=scores.get, reverse=True)[:top_n]]
```

This is the "RAG-Fusion" pattern. LangChain's `MultiQueryRetriever` does the same (in `langchain-classic` in v1).

## HyDE (Hypothetical Document Embeddings)

```python
hyde_prompt = ChatPromptTemplate.from_template(
    "Write a short passage from a company policy document that answers: {question}"
)
hyde_chain = hyde_prompt | llm | StrOutputParser()

def hyde_retrieve(question: str):
    fake_doc = hyde_chain.invoke({"question": question})
    return retriever.invoke(fake_doc)            # search with the fake answer, not the question
```

The fake answer may contain wrong facts, but it **looks like** the real documents, so its embedding lands near them. It never reaches the user, only the retriever.

## Decomposition

```python
class SubQuestions(BaseModel):
    sub_questions: list[str]

decompose = ChatPromptTemplate.from_template(
    "Break this question into the minimal set of simple sub-questions needed to answer it.\n\n{question}"
) | llm.with_structured_output(SubQuestions)

subs = decompose.invoke({"question": "Compare the 2023 and 2024 travel policies on hotel limits."}).sub_questions
# ["What was the hotel limit in the 2023 travel policy?", "What is the hotel limit in the 2024 travel policy?"]
context = [d for q in subs for d in retriever.invoke(q)]
```

## Routing

```python
from typing import Literal

class Route(BaseModel):
    source: Literal["hr_docs", "it_docs", "sql_database", "web_search"]

router = ChatPromptTemplate.from_template(
    "Choose the best source for this question.\n"
    "hr_docs: leave, payroll, benefits. it_docs: laptops, VPN, access. "
    "sql_database: counts and numbers about orders. web_search: public, recent events.\n\nQuestion: {question}"
) | llm.with_structured_output(Route)

router.invoke({"question": "How many orders were refunded last week?"}).source   # → "sql_database"
```

Routing is the first step toward agentic RAG, where the model decides how to retrieve.

## Gotchas

- **Latency and cost add up.** Each technique adds at least one LLM call before retrieval. Use a small fast model and cache rewrites.
- **Rewrites can drift.** The LLM may "fix" a query into a different question. Keep the original query in the retrieval set.
- **HyDE hurts on niche topics** where the model can't even guess what an answer looks like.
- **Don't stack everything.** Pick the technique that matches the failure you measured.

## Key terms

- **Query rewriting** — transforming the user's input into a better search query.
- **Multi-query / RAG-Fusion** — retrieving with several query variants and fusing results.
- **HyDE** — embedding an LLM-generated hypothetical answer instead of the question.
- **Query decomposition** — splitting a complex question into simpler sub-questions.
- **Query routing** — choosing which index, tool or source to send a query to.
- **Self-query** — extracting structured metadata filters from natural language.

## Interview quick-fire

- **"How do you handle follow-up questions in a RAG chatbot?"** → Condense the follow-up and chat history into a standalone question before retrieval.
- **"What is HyDE and why does it work?"** → Generate a hypothetical answer and search with its embedding; answers resemble documents more than questions do.
- **"Multi-query vs. decomposition?"** → Multi-query paraphrases the same question to improve recall; decomposition splits a complex question into different sub-questions.
- **"What's the downside of query enhancement?"** → Extra LLM calls add latency and cost, and rewrites can change the meaning of the question.
