---
title: "The Model Landscape (GPT, Claude, Gemini, Llama)"
---

## TL;DR

There are a handful of major model families. They're broadly comparable at the top end, and the "best" one changes every few months. Learn the **trade-offs** (capability, speed, cost, open vs. closed, context, modalities) instead of memorizing a leaderboard — and write code so you can swap models easily.

:::note
Specific model names and versions go stale fast. These notes focus on the families and how to choose. Always check the provider's docs for current model IDs and prices.
:::

## The main players

| Family | Company | Access | Known for |
|---|---|---|---|
| **GPT / o-series** | OpenAI | Closed, API + ChatGPT | First mover, huge ecosystem, strong reasoning models, broad multimodal (image, audio) |
| **Claude** | Anthropic | Closed, API + Claude apps, AWS Bedrock, Google Vertex | Coding and agentic work, long context, careful instruction following, safety focus |
| **Gemini** | Google | Closed, API + Gemini app, Vertex AI | Very long context, native multimodal (video, audio), Google ecosystem |
| **Llama** | Meta | **Open weights** | Run anywhere, fine-tune freely, huge community |
| **Mistral** | Mistral AI | Mix of open and closed | Efficient models, European provider |
| **Qwen / DeepSeek** | Alibaba / DeepSeek | **Open weights** | Strong open models at low cost, good at code and math |
| **Grok** | xAI | Closed | Integrated with X |

Most families ship in **tiers**:

| Tier | Example names | Use for |
|---|---|---|
| **Flagship** | Claude Opus, GPT top tier, Gemini Pro | Hardest reasoning, complex agents, highest quality |
| **Mid** | Claude Sonnet, GPT standard | The default for most apps — good balance |
| **Small / fast** | Claude Haiku, GPT mini, Gemini Flash | Classification, extraction, routing, high volume, low latency |

## Closed vs. open-weight models

| | Closed (API) | Open-weight |
|---|---|---|
| Examples | GPT, Claude, Gemini | Llama, Qwen, DeepSeek, Mistral |
| How you use it | Call an API | Download weights, run yourself (or via a host like Together, Groq, Fireworks) |
| Quality | Usually the frontier | Close behind, gap keeps shrinking |
| Setup | Minutes | Needs GPUs or a hosting provider |
| Data privacy | Data goes to provider (with enterprise terms) | Can stay fully on your infra |
| Customization | Prompting, some fine-tuning | Full fine-tuning, quantization, anything |
| Cost model | Pay per token | Pay for compute; cheap at scale |

"Open weights" ≠ fully open source — you usually get the weights, not the training data or code.

## Reasoning ("thinking") models

A newer category: models trained to **think before answering**, producing an internal chain of thought (often thousands of tokens) before the final response. Many current models do this as an optional mode ("extended thinking", "reasoning effort").

- **Better at:** math, multi-step logic, hard coding problems, planning.
- **Costs:** more latency and more (billed) tokens.
- **Rule of thumb:** turn it on for hard problems; leave it off for simple lookups, chat, and extraction.

## How to choose a model

Ask these questions in order:

1. **What's the task?** Simple classification/extraction → small model. Complex reasoning, coding, agents → mid or flagship.
2. **Latency budget?** Real-time chat or autocomplete → small/fast.
3. **Volume and budget?** Millions of calls → cost per token dominates.
4. **Data constraints?** Regulated or sensitive data → enterprise API terms, cloud-hosted (Bedrock/Vertex/Azure), or self-hosted open weights.
5. **Context needs?** Huge documents → check context window size and long-context quality.
6. **Modalities?** Images, audio, video, PDFs.
7. **Then: evaluate on *your* data.** Public benchmarks are a starting point, not an answer.

:::tip Start big, then go small
Prototype with a strong model to prove the task is possible. Then try cheaper models against an eval set and downgrade wherever quality holds. Many production systems **route**: a small model for easy requests, a big one for hard ones.
:::

## Reading benchmarks (skeptically)

Common ones you'll see: **MMLU** (general knowledge), **GPQA** (hard science), **SWE-bench** (real GitHub issues), **HumanEval** (code), **LMArena** (human preference votes), **MTEB** (embeddings).

Caveats:
- Scores saturate — top models cluster near the ceiling on older benchmarks.
- **Contamination** — test questions may have leaked into training data.
- Benchmarks measure narrow skills; your app is a specific task. **Your own evals beat leaderboards.**

## Where models are served

- **Direct provider APIs** — OpenAI, Anthropic, Google AI Studio.
- **Cloud platforms** — AWS Bedrock, Google Vertex AI, Azure OpenAI/Foundry (enterprise billing, compliance, VPCs).
- **Open-model hosts** — Together, Fireworks, Groq, Hugging Face.
- **Locally** — Ollama, LM Studio, llama.cpp, vLLM. Covered in the *Calling Models* stage.
- **Routers** — OpenRouter, LiteLLM: one API for many models.

## Key terms

- **Frontier model** — the most capable models available at a given time.
- **Open weights** — model parameters published for download.
- **Model tier** — flagship / mid / small versions within a family.
- **Reasoning model** — trained to produce chain-of-thought before answering.
- **Quantization** — compressing weights (e.g. 16-bit → 4-bit) to run on smaller hardware.

## Interview quick-fire

- **"How would you choose a model for a new feature?"** → Define the task and constraints (latency, cost, privacy), prototype with a strong model, build an eval set, then test cheaper models and pick the smallest that passes.
- **"When would you use an open-weight model?"** → Strict data residency, heavy customization/fine-tuning, very high volume where self-hosting is cheaper, or offline/edge use.
- **"Are benchmarks reliable?"** → Useful signals but limited: contamination, saturation, and mismatch with your task. Always run task-specific evals.
