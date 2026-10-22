---
title: "Hallucinations & Limitations"
---

## TL;DR

A **hallucination** is when a model states something false or made-up with full confidence. It's not a bug you can patch out — it falls naturally out of how LLMs work (predict *plausible* text). Your job as a builder is to **reduce, detect, and design around** it.

## Why models hallucinate

1. **Trained for plausibility, not truth.** Next-token prediction rewards text that *looks* right. A fake citation in the correct format looks very right.
2. **No lookup.** Knowledge is compressed into weights. Rare facts (a small company's founder, an obscure paper) are stored fuzzily or not at all — the model fills the gap with something likely.
3. **Pressure to answer.** Training data rarely contains "I don't know"; models learned that a confident answer is the expected shape of a response.
4. **Knowledge cutoff.** The model doesn't know about events after its training data ends — and may not realize it.
5. **Snowballing.** Once a wrong token is emitted, later tokens stay consistent with it. One early mistake becomes a confident wrong paragraph.

## Common types

| Type | Example |
|---|---|
| **Fabricated facts** | Invents a statistic, date, or quote |
| **Fake citations** | Real-looking paper titles, URLs, or case law that don't exist |
| **Fake APIs** | Calls a library function or parameter that doesn't exist |
| **Unfaithful summaries** | Summary includes claims not in the source document |
| **Wrong reasoning** | Plausible step-by-step logic with an error in the middle |
| **Overconfident tool use** | Claims an action succeeded without checking |

## Other core limitations

| Limitation | What it means | Workaround |
|---|---|---|
| **Knowledge cutoff** | Doesn't know recent events | Web search, RAG, pass in current data |
| **No memory** | Stateless between requests | Resend history; store memory externally |
| **Context limits** | Can only see so many tokens; quality drops in very long contexts | Retrieval, summarization, put key info at start/end |
| **Arithmetic & counting** | Tokens, not digits/characters ("how many r's in strawberry") | Give it a calculator / code tool |
| **Non-determinism** | Same prompt, different answers | Low temperature, structured outputs, evals |
| **Sycophancy** | Agrees with the user even when the user is wrong | Ask neutrally; instruct it to push back |
| **Prompt injection** | Instructions hidden in input data hijack the model | Treat external content as untrusted; limit tool permissions |
| **Bias** | Reflects biases in training data | Evaluate across groups; guardrails |
| **No real-world access** | Can't check facts or run code by itself | Give it tools |

## Reducing hallucinations

**1. Ground it in context (the big one).** Give the model the facts instead of relying on its memory. This is what **RAG** is.

```
Answer using ONLY the documents below. If the answer isn't in them,
say "I don't know based on the provided documents."

<documents>
...
</documents>
```

**2. Give it permission to not know.** Explicitly: *"If you're not sure, say so."* This measurably reduces made-up answers.

**3. Ask for citations/quotes from the source.** *"Quote the sentence that supports each claim."* Then you can verify the quote actually exists in the document — in code.

**4. Use tools for things LLMs are bad at.** Math → calculator/code execution. Current info → search. Database facts → SQL tool.

**5. Lower temperature** for factual tasks.

**6. Let it reason first.** Reasoning modes or "think step by step" reduce errors on multi-step problems.

**7. Verify outputs.**
- Validate structure (JSON schema, Pydantic).
- Check generated code by running tests.
- Use a second LLM call as a checker ("Is every claim in this answer supported by the source?").
- Human review for high-stakes outputs.

**8. Use a stronger model.** Bigger, newer models hallucinate less — though never zero.

## Designing around it

- **Match risk to autonomy.** Drafting a tweet: fine to trust. Medical, legal, or financial advice: keep a human in the loop.
- **Show sources in the UI** so users can check.
- **Make uncertainty visible** rather than presenting everything as fact.
- **Build evals** — a test set of questions with known answers — and track the hallucination rate over time. Covered in later stages.

:::tip Mental model
Treat an LLM like a brilliant, fast, well-read intern who **never says "I don't know" unless you tell them it's allowed** — and who has no internet access unless you give it some. Give them the documents, ask them to cite, and check the important work.
:::

## Interview quick-fire

- **"Why do LLMs hallucinate?"** → They optimize for plausible next tokens, have no built-in fact lookup, and are rarely trained to abstain.
- **"How do you reduce hallucinations in a production app?"** → Ground answers with RAG, allow "I don't know", require citations and verify them, use tools for math/live data, low temperature, and measure with evals.
- **"What's prompt injection?"** → Malicious instructions inside data the model reads (a webpage, email, doc) that override your instructions; mitigate by isolating untrusted content and limiting what tools can do.
