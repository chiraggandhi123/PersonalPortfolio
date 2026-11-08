---
title: "Building LLM Apps with LangChain"
---

## TL;DR

LangChain gives you **composable building blocks**: chat models, prompt templates, output parsers, retrievers and tools, all sharing one interface (**`invoke`, `stream`, `batch`**). You join them with the pipe operator into chains (**LCEL**: `prompt | llm | parser`). Use it for simple pipelines and its integrations; use **LangGraph** when you need loops, branching, memory or agents. Swapping providers with `init_chat_model` is covered in [provider-agnostic clients](../02-calling-models/09-provider-agnostic-clients.md).

## The core pieces

| Piece | Package | What it does |
|---|---|---|
| Chat model | `langchain-openai`, `langchain-anthropic`, … | Wraps a provider's chat API |
| Prompt template | `langchain-core` | Fills variables into a list of messages |
| Output parser | `langchain-core` | Turns a message into a string, JSON or object |
| Runnable | `langchain-core` | Anything with `invoke`/`stream`/`batch`; chains are runnables too |
| Retriever / vector store | integrations | Fetches documents for RAG |
| Tools | `langchain-core` | Python functions the model can call |

```bash
pip install langchain langchain-openai python-dotenv
```

## Your first chain (LCEL)

```python
from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

load_dotenv()

prompt = ChatPromptTemplate.from_messages([
    ("system", "You write catchy product taglines. Max 10 words."),
    ("human", "Product: {product}\nAudience: {audience}"),
])
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.8)

chain = prompt | llm | StrOutputParser()

print(chain.invoke({"product": "solar phone charger", "audience": "trekkers"}))
```

```
{"product": ..., "audience": ...}
        │
        ▼
 ChatPromptTemplate ──► [SystemMessage, HumanMessage]
        │
        ▼
    ChatOpenAI ───────► AIMessage(content="...")
        │
        ▼
  StrOutputParser ────► "Power your summit, one sunbeam at a time."
```

## One interface, three ways to run

```python
chain.invoke({"product": "smart bottle", "audience": "gym-goers"})          # one result

for chunk in chain.stream({"product": "smart bottle", "audience": "gym-goers"}):
    print(chunk, end="", flush=True)                                       # token stream

chain.batch([                                                              # parallel calls
    {"product": "e-bike", "audience": "commuters"},
    {"product": "noise-cancelling earbuds", "audience": "students"},
])
```

Every runnable also has async versions: `ainvoke`, `astream`, `abatch`.

## Structured output

```python
from pydantic import BaseModel

class Tagline(BaseModel):
    tagline: str
    tone: str

structured = prompt | llm.with_structured_output(Tagline)
result = structured.invoke({"product": "e-bike", "audience": "commuters"})
print(result.tagline)
```

More on validation in [parsing & validating output](./05-parsing-validating-output.md).

## Composing chains

Chains are runnables, so they combine. A dict runs branches in parallel; `RunnablePassthrough` forwards inputs.

```python
from langchain_core.runnables import RunnablePassthrough

summarize = ChatPromptTemplate.from_template("Summarize in 2 lines:\n{text}") | llm | StrOutputParser()
translate = ChatPromptTemplate.from_template("Translate to {lang}:\n{summary}") | llm | StrOutputParser()

pipeline = (
    {"summary": summarize, "lang": lambda x: x["lang"]}     # step 1 output feeds step 2
    | translate
)
print(pipeline.invoke({"text": long_article, "lang": "Hindi"}))
```

Plain Python functions are converted to runnables automatically when piped.

## Tools

```python
from langchain_core.tools import tool

@tool
def get_order_status(order_id: str) -> str:
    """Look up the delivery status of an order by its ID."""
    return "Shipped, arriving Friday"

llm_with_tools = llm.bind_tools([get_order_status])
msg = llm_with_tools.invoke("Where is order A123?")
print(msg.tool_calls)   # [{'name': 'get_order_status', 'args': {'order_id': 'A123'}, ...}]
```

The model only *requests* the call; running the loop is the same idea as in [tool calling](../02-calling-models/05-tool-function-calling.md). For a ready-made loop, use `create_agent` (LangChain 1.x) or LangGraph's prebuilt agent.

## LangChain vs. LangGraph

| Use LangChain (LCEL) when | Use LangGraph when |
|---|---|
| The flow is a straight line or simple fan-out | You need loops, retries, branching on results |
| Stateless: input in, output out | You need memory per user ([conversation memory](./06-conversation-memory.md)) |
| Prompt → model → parser, RAG pipelines | Agents, human-in-the-loop, multi-step workflows |

## Observability

Set these and every chain run is traced in LangSmith, with prompts, outputs, latency and tokens:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
```

## Gotchas

- **Import paths move.** Use `langchain_core`, `langchain_openai`, etc. Old `from langchain.llms import ...` examples are outdated, and the legacy `LLMChain`/`ConversationChain` classes are deprecated in favour of LCEL and LangGraph.
- **Abstraction cost.** For a single API call, the raw SDK is shorter and easier to debug.
- **Hidden prompts.** Some helpers add their own prompts. Check traces to see what's actually sent.
- **Version pinning.** The ecosystem moves fast. Pin versions in `requirements.txt`.

## Key terms

- **LCEL** — LangChain Expression Language; composing runnables with `|`.
- **Runnable** — any component with `invoke`, `stream`, `batch` and async variants.
- **Output parser** — converts model output into a string, JSON or Python object.
- **`bind_tools`** — attaches tool schemas to a chat model so it can request calls.
- **LangSmith** — LangChain's tracing and evaluation platform.

## Interview quick-fire

- **"What is LCEL?"** → A way to compose LangChain components with the pipe operator into runnables that support invoke, stream and batch.
- **"When would you skip LangChain?"** → For simple, single-provider apps where the raw SDK is clearer and has fewer moving parts.
- **"LangChain vs. LangGraph?"** → LangChain for linear chains and integrations; LangGraph for stateful graphs with loops, branching, memory and agents.
- **"How do you get structured output in LangChain?"** → `llm.with_structured_output(MyPydanticModel)`.
