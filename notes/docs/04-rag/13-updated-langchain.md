---
title: "Updated LangChain (v1) Hands-On"
---

## TL;DR

LangChain v1 is a **slimmer, agent-first** release. The core pieces are **`init_chat_model`** (one way to load any provider), **messages with standard content blocks**, **`@tool`**, and **`create_agent`**, which builds a production agent loop on top of **LangGraph**, extended with **middleware**. LCEL (`prompt | model | parser`) still works for simple chains. Old chains and retrievers (`RetrievalQA`, `ConversationalRetrievalChain`, `EnsembleRetriever`, …) moved to **`langchain-classic`**. Integrations live in their own packages: `langchain-openai`, `langchain-chroma`, `langchain-community`.

## Package map

| Package | Contains |
|---|---|
| `langchain-core` | Base abstractions: messages, prompts, Runnables, `Document`, tools, output parsers |
| `langchain` | `create_agent`, `init_chat_model`, middleware, `@tool` re-export |
| `langchain-openai`, `langchain-anthropic`, … | Provider integrations (chat models, embeddings) |
| `langchain-chroma`, `langchain-qdrant`, `langchain-postgres`, … | Vector store integrations |
| `langchain-community` | Community loaders, retrievers, vector stores (FAISS, BM25, many loaders) |
| `langchain-text-splitters` | Text splitters |
| `langchain-classic` | Legacy chains, retrievers and memory from 0.x |
| `langgraph` | Graph runtime that `create_agent` runs on |

```bash
pip install -U langchain langchain-openai langchain-chroma langchain-community langchain-text-splitters
```

## Chat models

```python
from langchain.chat_models import init_chat_model

model = init_chat_model("openai:gpt-4o-mini", temperature=0)
# swap providers by string: "anthropic:...", "google_genai:...", "ollama:llama3.1"

reply = model.invoke("Explain RAG in one sentence.")
print(reply.content)
print(reply.usage_metadata)          # input/output token counts

for chunk in model.stream("Write a haiku about vectors."):
    print(chunk.content, end="", flush=True)
```

`ChatOpenAI(model="gpt-4o-mini")` from `langchain_openai` still works when you want provider-specific options.

## Messages

```python
from langchain_core.messages import SystemMessage, HumanMessage

msgs = [
    SystemMessage("You are a concise assistant."),
    HumanMessage("What is a vector store?"),
]
reply = model.invoke(msgs)          # plain dicts {"role": "user", "content": ...} also work
reply.content_blocks                # standard blocks (text, reasoning, tool calls) across providers
```

## LCEL chains (still the simplest for fixed pipelines)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

prompt = ChatPromptTemplate.from_messages([
    ("system", "Answer from the context only.\n\nContext:\n{context}"),
    ("human", "{question}"),
])
chain = prompt | model | StrOutputParser()
chain.invoke({"context": "Leave: 18 days/year.", "question": "How many leave days?"})
```

## Structured output

```python
from pydantic import BaseModel, Field

class Answer(BaseModel):
    answer: str
    sources: list[str] = Field(description="Source file names used")
    confident: bool

structured = model.with_structured_output(Answer)
result: Answer = structured.invoke("Using 'policy.pdf: leave is 18 days', how many leave days?")
```

## Tools

```python
from langchain.tools import tool

@tool
def search_docs(query: str) -> str:
    """Search the company knowledge base for policies and procedures."""
    docs = retriever.invoke(query)               # retriever from earlier notes
    return "\n\n".join(d.page_content for d in docs)

model_with_tools = model.bind_tools([search_docs])
msg = model_with_tools.invoke("What's the travel policy for hotels?")
msg.tool_calls                                   # [{'name': 'search_docs', 'args': {...}, 'id': ...}]
```

The docstring becomes the tool description, and type hints become the schema.

## `create_agent`

```python
from langchain.agents import create_agent

agent = create_agent(
    model="openai:gpt-4o-mini",
    tools=[search_docs],
    system_prompt="Answer company policy questions. Always search first and cite sources.",
)

out = agent.invoke({"messages": [{"role": "user", "content": "Can I expense a hotel over Rs 8000?"}]})
print(out["messages"][-1].content)
```

Useful options:

- `response_format=Answer` → the final result also includes `out["structured_response"]`.
- `checkpointer=InMemorySaver()` + `config={"configurable": {"thread_id": "u1"}}` → conversation memory across calls.
- `middleware=[...]` → hooks around model and tool calls.

## Middleware

Middleware wraps the agent loop to add cross-cutting behavior without writing a custom graph:

| Built-in middleware (examples) | Purpose |
|---|---|
| Summarization | Summarize old messages when history gets long |
| Human-in-the-loop | Pause for approval before certain tool calls |
| PII redaction | Mask emails, phone numbers, etc. |
| Model fallback / retry | Switch models or retry on errors |
| Call limits | Cap model or tool calls per run |

You can write your own with decorators such as `@before_model` / `@after_model`, or by subclassing `AgentMiddleware`.

## Migrating from 0.x

| Old (0.x) | v1 approach |
|---|---|
| `RetrievalQA`, `create_retrieval_chain` | LCEL chain, or an agent with a retriever tool |
| `ConversationalRetrievalChain` | Agent + checkpointer, or a LangGraph graph |
| `initialize_agent`, `AgentExecutor` | `create_agent` |
| `langgraph.prebuilt.create_react_agent` | `create_agent` |
| `ConversationBufferMemory` | Checkpointers (thread-based memory) |
| Legacy imports you still need | `langchain_classic.*` |

## Gotchas

- **Old tutorials break.** Many blog posts use 0.x imports (`from langchain.chains import ...`). Check the package map above.
- **Install integration packages explicitly.** `langchain` alone doesn't include OpenAI or Chroma.
- **Prefer `langchain-chroma` over the community Chroma class**; dedicated packages get fixes first.
- **Pin versions** in production; the ecosystem moves fast.
- **Turn on LangSmith tracing** (`LANGSMITH_TRACING=true`) while learning; seeing each step is the fastest way to debug.

## Key terms

- **`init_chat_model`** — loads a chat model from any supported provider by a string ID.
- **Runnable / LCEL** — composable units joined with `|`, supporting invoke, batch and stream.
- **Content blocks** — provider-independent representation of message parts (text, reasoning, tool calls, images).
- **`create_agent`** — v1 function that builds a tool-calling agent loop on LangGraph.
- **Middleware** — hooks that modify agent behavior before/after model and tool calls.
- **langchain-classic** — package holding legacy 0.x chains and retrievers.

## Interview quick-fire

- **"What changed in LangChain v1?"** → A smaller core focused on agents: `create_agent` built on LangGraph, middleware, standard content blocks, and legacy chains moved to `langchain-classic`.
- **"LCEL chain or `create_agent`?"** → LCEL for fixed pipelines like basic RAG; `create_agent` when the model should decide which tools to call.
- **"How do you add memory to a v1 agent?"** → Pass a checkpointer and a `thread_id` in the config; the conversation state is saved per thread.
