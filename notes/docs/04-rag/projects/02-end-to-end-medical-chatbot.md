---
title: "End-to-End Medical Chatbot"
---

## Goal

Build a chatbot that answers health questions **from a trusted medical reference** (a medical encyclopedia PDF or public health guidance you're allowed to use) instead of the model's memory. It uses **Pinecone** as a managed vector database, a **LangChain** retrieval chain with chat history, **safety guardrails** (emergency detection, "not medical advice" disclaimer) and a **Flask** web app. It's a learning project, not a diagnostic tool.

**Skills practiced:** managed vector DB (Pinecone), history-aware retrieval, LCEL chains, domain guardrails, Flask API, deployment-ready structure.

## Architecture

```
medical_book.pdf ─► store_index.py ─► chunks (500 / 50) ─► embeddings ─► Pinecone index
                                                                             ▲
browser ─► Flask /chat ─► emergency check ──(red flag)──► "call emergency services"
                              │ ok                                           │
                              ▼                                              │
                  condense question with history ─► retrieve top 4 ─────────┘
                              │
                              ▼
                  gpt-4o-mini: answer from context + disclaimer ─► reply + sources
```

## Setup

```bash
pip install langchain-openai langchain-pinecone pinecone langchain-community \
            langchain-text-splitters pypdf flask python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
```

Put your reference PDF at `data/medical_book.pdf`. Check its licence before deploying publicly.

## Code

### `store_index.py` (run once)

```python
import os
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore

load_dotenv()
INDEX = "medical-chatbot"

pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
if not pc.has_index(INDEX):
    pc.create_index(name=INDEX, dimension=1536, metric="cosine",     # 1536 = text-embedding-3-small
                    spec=ServerlessSpec(cloud="aws", region="us-east-1"))

pages = PyPDFLoader("data/medical_book.pdf").load()
chunks = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50).split_documents(pages)

PineconeVectorStore.from_documents(
    chunks, OpenAIEmbeddings(model="text-embedding-3-small"), index_name=INDEX)
print(f"Uploaded {len(chunks)} chunks")
```

### `rag.py`

```python
import re
from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore

load_dotenv()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
retriever = PineconeVectorStore(
    index_name="medical-chatbot",
    embedding=OpenAIEmbeddings(model="text-embedding-3-small"),
).as_retriever(search_kwargs={"k": 4})

RED_FLAGS = re.compile(r"chest pain|can't breathe|cannot breathe|suicid|overdose|"
                       r"unconscious|severe bleeding|stroke", re.I)
EMERGENCY = ("This sounds like it could be an emergency. Please contact your local "
             "emergency number or go to the nearest hospital now.")
DISCLAIMER = "\n\n_This is general information, not medical advice. Please consult a doctor._"

condense = ChatPromptTemplate.from_messages([
    MessagesPlaceholder("history"),
    ("user", "Rewrite my last question as a standalone search query: {question}"),
]) | llm | StrOutputParser()

answer_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a careful medical information assistant. Answer ONLY from the "
               "context. If the context doesn't cover it, say so. Never diagnose or give "
               "dosages for a specific person; suggest seeing a doctor.\n\nContext:\n{context}"),
    MessagesPlaceholder("history"),
    ("user", "{question}"),
])
answer_chain = answer_prompt | llm | StrOutputParser()

def chat(question: str, history: list) -> tuple[str, list[str]]:
    if RED_FLAGS.search(question):
        return EMERGENCY, []
    query = condense.invoke({"history": history, "question": question}) if history else question
    docs = retriever.invoke(query)
    context = "\n\n".join(d.page_content for d in docs)
    reply = answer_chain.invoke({"context": context, "history": history, "question": question})
    sources = sorted({f"page {d.metadata.get('page', 0) + 1}" for d in docs})
    return reply + DISCLAIMER, sources
```

### `app.py`

```python
from flask import Flask, jsonify, request, session
from rag import chat

app = Flask(__name__)
app.secret_key = "change-me"           # load from env in production

@app.post("/chat")
def chat_endpoint():
    question = request.json["message"]
    history = session.get("history", [])[-6:]          # last 3 exchanges
    reply, sources = chat(question, [tuple(m) for m in history])
    session["history"] = history + [("user", question), ("assistant", reply)]
    return jsonify({"reply": reply, "sources": sources})

@app.post("/reset")
def reset():
    session.pop("history", None)
    return jsonify({"ok": True})

if __name__ == "__main__":
    app.run(debug=True, port=8080)
```

Test it:

```bash
python store_index.py
python app.py
curl -X POST localhost:8080/chat -H "Content-Type: application/json" \
     -d '{"message": "What are common symptoms of anaemia?"}'
```

A small HTML/JS page that posts to `/chat` is enough for a UI.

## How it works

1. **Indexing** splits the reference into small chunks (medical text is dense, so 500 characters keeps chunks focused) and uploads embeddings to a serverless Pinecone index.
2. **Emergency check** runs first with a cheap regex. Red-flag phrases short-circuit to a fixed safety message; no LLM call.
3. **Question condensing** turns follow-ups like "and how is it treated?" into standalone queries using the chat history, so retrieval works on multi-turn chats.
4. **Grounded answer**: the system prompt restricts the model to the retrieved context and forbids personal diagnoses or dosages.
5. **Disclaimer and sources** are appended in code, so they can't be "forgotten" by the model.
6. **Session history** is stored in Flask's signed cookie and trimmed to the last few turns.

## Stretch goals

- [ ] **LLM-based safety classifier** in place of the regex, tested on a labelled set of red-flag messages.
- [ ] **Groundedness check** on the answer before returning it (see [guardrails](../25-guardrails.md)).
- [ ] **Streaming** responses to the browser.
- [ ] **Multiple sources** with metadata (source name, year) and source filtering.
- [ ] **Evaluation** — 40 questions with reference answers; score faithfulness.
- [ ] **Dockerize** and deploy (Render, AWS); move secrets to environment variables.
- [ ] **Server-side session store** (Redis) instead of cookies for longer histories.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
