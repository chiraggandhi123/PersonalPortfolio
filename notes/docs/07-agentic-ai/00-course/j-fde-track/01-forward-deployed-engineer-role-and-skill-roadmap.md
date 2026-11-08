---
title: "Forward Deployed Engineer: Role and Skill Roadmap"
---

## TL;DR

A **Forward Deployed Engineer (FDE)** is a software engineer who works **embedded with a customer** to make a product actually deliver value in their environment. Palantir made the title famous, and AI companies (OpenAI, Anthropic and many startups) now hire FDEs to turn models and agent platforms into working systems for specific businesses. The job is **half engineering, half consulting**: scope a fuzzy problem, build a working solution fast against messy real data, get it into production, and feed what you learn back to the product team.

## Where the role sits

```
              Product engineering            Forward deployed engineering          Customer
              (builds the platform)  ◄────── feedback, reusable patterns ─────── (has the problem)
                       │                                 │                            │
                       └──── platform, APIs, models ────►│◄──── data, systems, SMEs ───┘
                                                         ▼
                                             working solution in production
```

| Role | Main question | Output |
|---|---|---|
| Software engineer | How do we build the product well? | Features for many customers |
| Solutions engineer / SE | Can the product solve this? (pre-sale) | Demos, POCs, technical answers |
| **FDE** | How do we make it work here, in production? | Deployed systems, integrations, field feedback |
| Consultant | What should the customer do? | Recommendations, often no code |
| ML / AI engineer | How do we build and improve models and pipelines? | Models, evals, RAG and agent systems |

FDEs write production code like a software engineer, but choose problems like a consultant.

## What an AI FDE actually does

1. **Discovery:** sit with users, map the workflow, find the step where an LLM or agent saves real time.
2. **Scoping:** turn "we want AI" into a measurable problem ("cut ticket triage time from 6 min to 1 min with 95% routing accuracy").
3. **Data and integration:** connect to the customer's CRM, docs, databases and auth, often with poor documentation.
4. **Build fast:** prototype in days, test against real examples, iterate with users weekly.
5. **Evaluate:** build an eval set from the customer's real cases; show accuracy, cost and latency numbers.
6. **Ship and harden:** security review, observability, guardrails, handoff docs, on-call plan.
7. **Feed back:** report product gaps and package repeated work into reusable tools.

## Skill roadmap

| Stage | Skills | How this site covers it |
|---|---|---|
| 1. Engineering base | Python, async, APIs, SQL, Git, Docker, cloud basics | Python and deployment notes |
| 2. LLM fundamentals | Prompting, structured outputs, tool calling, tokens and cost | Calling models, prompting |
| 3. Retrieval | Chunking, embeddings, vector DBs, hybrid search, RAG evaluation | RAG stages |
| 4. Agents | LangGraph, multi-agent patterns, MCP, HITL, memory | This course, sections D–H |
| 5. Production | Tracing, evals, guardrails, CI/CD, security | Section I and AgentOps |
| 6. Customer skills | Discovery interviews, scoping, writing, demos, managing expectations | Practice on real projects |
| 7. Domain depth | Pick one or two: finance, healthcare, legal, support, logistics | Learn the jargon and regulations |

The engineering stages are necessary but not enough. FDE interviews often weigh **communication and judgment** as heavily as coding.

## Customer-facing skills that matter

- **Asking "why" until you hit the real problem.** The stated request ("build a chatbot") is often not the need ("agents can't find the right policy fast").
- **Saying no and offering a smaller yes.** Push back on scope that won't ship; propose a narrow first version.
- **Translating.** Explain hallucination risk to a VP in one sentence; explain the VP's constraint to the platform team.
- **Writing.** Short design docs, weekly status updates, clear handoff runbooks.
- **Demoing on their data.** A demo on the customer's own documents is worth ten slides.

## How to prepare and build a portfolio

- Build 2–3 **end-to-end projects that look like customer work**: a real problem statement, messy data, an eval set, a deployed URL and a short write-up of tradeoffs. The [FDE project build](./02-fde-project-build-problem-statement-to-production.md) walks through one.
- Practice **case-style interviews**: "A bank wants to use LLMs for KYC review. Walk me through how you'd approach it."
- Be ready to **debug live**: read an unfamiliar codebase or a broken API integration under time pressure.
- Show **metrics**, not just features: "92% answer accuracy on 120 real questions, ₹X per 1,000 queries, p95 latency 3s".

## Gotchas of the job

- **Travel and context switching.** Many FDE roles involve customer sites and several accounts at once.
- **One-off snowflakes.** Building something nobody else can reuse is a trap. Look for patterns to push into the product.
- **Demo-ware.** A prototype that impresses but never reaches production is a failure in this role.
- **Ambiguity is the job.** If you need fully specified tickets, it will feel uncomfortable.

## Key terms

- **Forward Deployed Engineer (FDE)** — engineer embedded with customers to build and deploy solutions on a platform.
- **Discovery** — interviewing users and mapping workflows to find the real problem.
- **POC (proof of concept)** — a quick build showing an approach can work, usually not production-ready.
- **Field feedback** — product gaps and patterns FDEs report back to product engineering.
- **Success criteria** — measurable targets agreed with the customer before building.

## Interview quick-fire

- **"How is an FDE different from a solutions engineer?"** → SEs mostly work pre-sale on demos and POCs; FDEs build and ship production systems after the deal, embedded with the customer.
- **"A customer says 'we want an AI agent'. First steps?"** → Discovery: find the workflow, the pain, the data, and agree a measurable success metric before writing code.
- **"How do you show an LLM solution is ready for production?"** → An eval set from the customer's real cases with accuracy, cost and latency numbers, plus guardrails, monitoring and a rollback plan.
- **"How do you avoid building one-off solutions?"** → Notice repeated patterns across customers and push them back into the platform as reusable features.
