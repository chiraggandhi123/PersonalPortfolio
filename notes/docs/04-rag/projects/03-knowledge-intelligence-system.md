---
title: "Knowledge Intelligence System"
---

## Goal

Build an internal "ask anything" assistant over **several knowledge sources at once**: PDFs (reports, policies), Markdown notes (a wiki or Notion export) and web pages, with **web search as a fallback**. A LangGraph **agent** chooses which source to search, can search several, **grades** what it found and answers with **citations**. Conversations persist per thread. It combines [agentic RAG](../17-agentic-rag.md), [corrective RAG](../20-corrective-rag.md) and [persistent memory](../22-rag-with-persistent-memory.md) in one app.

**Skills practiced:** multi-source ingestion, one collection per source, retriever tools, tool routing by description, LangGraph agents, checkpointers, web search fallback, citations.

## Architecture

```
data/pdfs/*.pdf  ─┐
data/notes/*.md  ─┼─► ingest.py ─► Chroma collections: "reports", "wiki", "web"
urls.txt         ─┘

user ─► LangGraph ReAct agent (gpt-4o-mini, checkpointer: thread_id)
             │ chooses tools by description
             ├─► search_reports(query)   → chunks + [source, page]
             ├─► search_wiki(query)      → chunks + [file]
             ├─► search_saved_web(query) → chunks + [url]
             └─► web_search(query)       → only if internal sources come up empty
             ▼
        answer with citations ─► user
```

## Setup

```bash
pip install langgraph langchain-openai langchain-chroma langchain-community \
            langchain-text-splitters langchain-tavily pypdf beautifulsoup4 python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...       # optional, for web fallback
USER_AGENT=knowledge-bot
```

## Code

### `ingest.py`

```python
from pathlib import Path
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader, TextLoader, WebBaseLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv()
emb = OpenAIEmbeddings(model="text-embedding-3-small")
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)

def index(name: str, docs):
    chunks = splitter.split_documents(docs)
    Chroma.from_documents(chunks, emb, collection_name=name, persist_directory="kb")
    print(f"{name}: {len(chunks)} chunks")

index("reports", [p for f in Path("data/pdfs").glob("*.pdf") for p in PyPDFLoader(str(f)).load()])
index("wiki", [d for f in Path("data/notes").glob("*.md") for d in TextLoader(str(f)).load()])
urls = Path("urls.txt").read_text().split()
index("web", WebBaseLoader(urls).load())
```

### `agent.py`

```python
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.prebuilt import create_react_agent

load_dotenv()
emb = OpenAIEmbeddings(model="text-embedding-3-small")
stores = {n: Chroma(collection_name=n, embedding_function=emb, persist_directory="kb")
          for n in ["reports", "wiki", "web"]}

def search(name: str, query: str, min_score: float = 0.3) -> str:
    hits = stores[name].similarity_search_with_relevance_scores(query, k=4)
    hits = [(d, s) for d, s in hits if s >= min_score]          # crude relevance filter
    if not hits:
        return "NO_RELEVANT_RESULTS"
    return "\n\n".join(f"[{d.metadata.get('source')} p.{d.metadata.get('page', '-')}] "
                       f"{d.page_content}" for d, _ in hits)

@tool
def search_reports(query: str) -> str:
    """Search company reports and policy PDFs: finances, HR policy, strategy documents."""
    return search("reports", query)

@tool
def search_wiki(query: str) -> str:
    """Search the internal engineering wiki: how-tos, runbooks, architecture notes."""
    return search("wiki", query)

@tool
def search_saved_web(query: str) -> str:
    """Search saved external web pages: vendor docs and articles the team bookmarked."""
    return search("web", query)

tools = [search_reports, search_wiki, search_saved_web]
try:
    from langchain_tavily import TavilySearch
    tools.append(TavilySearch(max_results=3))                    # live web, last resort
except Exception:
    pass

SYSTEM = """You answer questions for employees using the search tools.
- Pick the tool(s) whose description fits; you may call several.
- If a tool returns NO_RELEVANT_RESULTS, try another source or rephrase once.
- Use live web search only if internal sources have nothing.
- Cite every fact with the [source] tag from the tool output.
- If nothing relevant is found, say so plainly."""

agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini", temperature=0), tools,
                           prompt=SYSTEM, checkpointer=InMemorySaver())

if __name__ == "__main__":
    cfg = {"configurable": {"thread_id": "demo"}, "recursion_limit": 12}
    while True:
        q = input("you> ")
        out = agent.invoke({"messages": [("user", q)]}, cfg)
        for m in out["messages"]:
            if getattr(m, "tool_calls", None):
                print("  tools:", [t["name"] for t in m.tool_calls])
        print("bot>", out["messages"][-1].content)
```

Run `python ingest.py`, then `python agent.py`. The tool-call printout shows which sources the agent chose (it prints the whole thread, so earlier turns repeat).

## How it works

1. **One collection per source.** Separate indexes let the agent route by source and keep citations clean (page for PDFs, file for notes, URL for web).
2. **Tool descriptions are the router.** The model reads them to decide where to look, so they describe *content*, not implementation.
3. **Relevance filter.** Results under a similarity threshold are dropped and the tool returns `NO_RELEVANT_RESULTS`, a simple corrective-RAG signal that tells the agent to try elsewhere.
4. **Web fallback** is a separate tool the prompt marks as last resort.
5. **Memory.** The checkpointer keeps each `thread_id`'s conversation, so follow-ups work. Swap `InMemorySaver` for SQLite or Postgres to survive restarts.
6. **Recursion limit** stops runaway tool loops.

`create_react_agent` is LangGraph's prebuilt agent; newer LangChain versions also offer `create_agent`. Both build the same model ↔ tools loop.

## Stretch goals

- [ ] **Explicit LangGraph graph** with a grading node instead of the score threshold.
- [ ] **Hybrid search** (BM25 + vector) inside each tool.
- [ ] **Access control** — filter collections by the user's team.
- [ ] **Scheduled re-ingestion** with file hashing for changed documents.
- [ ] **Streamlit chat UI** showing tool calls and citations.
- [ ] **Eval set** spanning all three sources; measure routing accuracy.
- [ ] **Tracing** with LangSmith to inspect routing decisions.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
