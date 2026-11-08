---
title: "Air India RAG Chatbot"
---

## Goal

Build a customer-help chatbot that answers travellers' questions about an airline's **publicly available policy documents**, using Air India's published pages as the example corpus: baggage allowance, cancellations and refunds, check-in, special assistance and so on. Every answer must come **from the documents, with a citation and the date the page was saved**. If the documents don't say, the bot says so and points to the official site. This is an unofficial learning project. It is not affiliated with the airline and must not be presented as an official channel.

**Skills practiced:** collecting and versioning a document corpus, metadata-filtered retrieval, intent routing with structured outputs, LangGraph state and memory, grounded answers with citations, Streamlit chat UI.

## Architecture

```
public policy pages (saved as PDF / HTML)
  data/baggage/*.pdf  data/refunds/*.pdf  data/checkin/*.pdf  data/assistance/*.pdf
                │
          ingest.py ─► chunks + metadata {topic, source, saved_on} ─► Chroma

user ─► Streamlit chat ─► LangGraph (checkpointer: thread_id)
                              │
                         classify topic ──► "other" / small talk ─► polite redirect
                              │ baggage | refunds | checkin | assistance
                              ▼
                         retrieve (filter: topic) ─► top 5 chunks
                              │
                         answer: only from chunks, cite [source, saved_on],
                                 "check the official website for the latest rules"
```

## Setup

```bash
pip install langgraph langchain-openai langchain-chroma langchain-community \
            langchain-text-splitters pypdf streamlit python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

**Collect the corpus.** Open the airline's public policy pages, save each as a PDF (browser "Print → Save as PDF") into `data/<topic>/`, and record the date. Policies change often, so the saved date matters. Respect the site's terms of use; don't scrape aggressively.

## Code

### `ingest.py`

```python
import json
from pathlib import Path
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv()
TOPICS = ["baggage", "refunds", "checkin", "assistance"]
# data/sources.json maps file name → {"url": ..., "saved_on": "YYYY-MM-DD"}
sources = json.loads(Path("data/sources.json").read_text())

docs = []
for topic in TOPICS:
    for pdf in Path("data", topic).glob("*.pdf"):
        meta = sources.get(pdf.name, {})
        for page in PyPDFLoader(str(pdf)).load():
            page.metadata.update(topic=topic, source=meta.get("url", pdf.name),
                                 saved_on=meta.get("saved_on", "unknown"))
            docs.append(page)

chunks = RecursiveCharacterTextSplitter(chunk_size=900, chunk_overlap=150).split_documents(docs)
Chroma.from_documents(chunks, OpenAIEmbeddings(model="text-embedding-3-small"),
                      collection_name="airline_policies", persist_directory="policy_db")
print(f"Indexed {len(chunks)} chunks")
```

Policy pages are full of tables (weight per cabin class, fees by route). The larger chunk size and overlap help keep a table row with its heading.

### `graph.py`

```python
from typing import Literal
from pydantic import BaseModel
from langchain_chroma import Chroma
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, MessagesState, START, END

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
store = Chroma(collection_name="airline_policies", persist_directory="policy_db",
               embedding_function=OpenAIEmbeddings(model="text-embedding-3-small"))

class State(MessagesState):
    topic: str
    query: str
    context: str

class Topic(BaseModel):
    topic: Literal["baggage", "refunds", "checkin", "assistance", "other"]
    search_query: str          # standalone query, resolves "what about infants?" etc.

def classify(state: State):
    t = llm.with_structured_output(Topic).invoke(
        [("system", "Classify the traveller's latest question by policy topic and write a "
                    "standalone search query using the conversation for context.")]
        + state["messages"])
    return {"topic": t.topic, "query": t.search_query}

def redirect(state: State):
    return {"messages": [("assistant", "I can help with baggage, cancellations and refunds, "
                          "check-in and special assistance policies. What would you like to know?")]}

def retrieve(state: State):
    docs = store.similarity_search(state["query"], k=5, filter={"topic": state["topic"]})
    ctx = "\n\n".join(f"[{i}] (source: {d.metadata['source']}, saved {d.metadata['saved_on']})\n"
                      f"{d.page_content}" for i, d in enumerate(docs, 1))
    return {"context": ctx}

SYSTEM = """You are an unofficial assistant answering questions about an airline's published policies.
Rules:
- Use ONLY the numbered policy excerpts. Never use outside knowledge for limits, fees or deadlines.
- Quote numbers exactly as written and cite them like [1].
- If the excerpts don't answer the question, say so and suggest the official website or customer care.
- Policies change: end with "Please confirm on the official website before travel."

Policy excerpts:
{context}"""

def answer(state: State):
    reply = llm.invoke([("system", SYSTEM.format(context=state["context"]))] + state["messages"])
    return {"messages": [reply]}

g = StateGraph(State)
g.add_node("classify", classify)
g.add_node("redirect", redirect)
g.add_node("retrieve", retrieve)
g.add_node("answer", answer)
g.add_edge(START, "classify")
g.add_conditional_edges("classify", lambda s: "redirect" if s["topic"] == "other" else "retrieve")
g.add_edge("retrieve", "answer")
g.add_edge("redirect", END)
g.add_edge("answer", END)
app = g.compile(checkpointer=InMemorySaver())
```

### `app.py`

```python
import uuid
import streamlit as st
from dotenv import load_dotenv
load_dotenv()
from graph import app

st.title("Airline Policy Assistant (unofficial)")
st.caption("Answers come from saved public policy pages and may be out of date.")

if "thread" not in st.session_state:
    st.session_state.thread, st.session_state.chat = str(uuid.uuid4()), []

for role, text in st.session_state.chat:
    st.chat_message(role).write(text)

if q := st.chat_input("e.g. How much checked baggage can I carry on a domestic flight?"):
    st.chat_message("user").write(q)
    out = app.invoke({"messages": [("user", q)]},
                     {"configurable": {"thread_id": st.session_state.thread}})
    reply = out["messages"][-1].content
    st.chat_message("assistant").write(reply)
    st.session_state.chat += [("user", q), ("assistant", reply)]
```

Run `python ingest.py`, then `streamlit run app.py`.

## How it works

1. **Topic folders become metadata.** Each chunk carries `topic`, `source` and `saved_on`, which power filtering and citations.
2. **Classify first.** One structured-output call picks the topic and rewrites follow-ups ("and for infants?") into a standalone query. Off-topic messages skip retrieval entirely.
3. **Filtered retrieval.** Searching only the matching topic stops refund text from leaking into baggage answers.
4. **Strict grounding.** The prompt forbids outside knowledge for numbers. Airline limits and fees are exactly where a model will confidently invent plausible figures, so every number must come from a cited excerpt.
5. **Freshness disclaimer.** Each answer cites the saved date and tells users to confirm on the official site.
6. **Memory.** The checkpointer keeps each browser session's thread, so follow-up questions work.

## Testing it honestly

Write 20–30 test questions **from the documents you saved**, with the expected answer copied from the page. Include questions the documents don't cover; the right answer there is "I don't know, check the official site". Check that numbers in answers match the source exactly.

## Stretch goals

- [ ] **Groundedness check** — verify each number in the answer appears in the cited chunk.
- [ ] **Table-aware parsing** for fee and allowance tables (e.g. a layout-aware PDF parser).
- [ ] **Corpus refresh job** — re-download pages monthly, diff them and re-index changed ones.
- [ ] **Multilingual** — answer in Hindi or other languages while citing English sources.
- [ ] **Persistent memory** with a SQLite checkpointer.
- [ ] **Handoff** — offer customer-care contact details when the bot can't answer.
- [ ] **Eval dashboard** tracking accuracy on the test set after each change.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
