---
title: "Practical GraphDB with LangChain"
---

## TL;DR

The [previous note](./28-graph-databases-cypher.md) wrote the graph by hand. In practice you **extract the graph from documents with an LLM**: LangChain's **`LLMGraphTransformer`** turns text into nodes and relationships, which you load into Neo4j. Then you answer questions with a **hybrid retriever**: **vector search** over chunks for fuzzy text and **Cypher** over the graph for entities and relationships, combined in one LangGraph flow. This is the practical core of **GraphRAG**.

## The pipeline

```
Ingestion
  docs ─► split ─► LLMGraphTransformer ─► GraphDocuments (nodes + relationships)
                         │                         │
                         │                 graph.add_graph_documents()  ──► Neo4j
                         └─► chunks ─► embeddings ─► Neo4j vector index ─┘

Query
  question ─► router ─┬─► Cypher QA (entities, counts, paths)
                      └─► vector search (descriptive text)
                               └──► combine ─► LLM answer
```

## Setup

```bash
pip install langchain-neo4j langchain-openai langchain-experimental langchain-text-splitters langgraph
```

`.env`:

```
OPENAI_API_KEY=sk-...
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
```

The vector index needs a Neo4j version with vector search (5.x).

## 1. Extract a knowledge graph from text

```python
from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_experimental.graph_transformers import LLMGraphTransformer
from langchain_neo4j import Neo4jGraph
from langchain_openai import ChatOpenAI

load_dotenv()
graph = Neo4jGraph()                                   # reads NEO4J_* env vars
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

text = """Marie Curie was a physicist who worked at the University of Paris.
She was married to Pierre Curie. Both won the Nobel Prize in Physics."""

transformer = LLMGraphTransformer(
    llm=llm,
    allowed_nodes=["Person", "Organization", "Award"],             # constrain the schema
    allowed_relationships=["WORKS_AT", "SPOUSE", "WON"],
)
graph_docs = transformer.convert_to_graph_documents([Document(page_content=text)])
print(graph_docs[0].nodes, graph_docs[0].relationships)

graph.add_graph_documents(graph_docs, include_source=True, baseEntityLabel=True)
```

- **`allowed_nodes` / `allowed_relationships`** keep the graph consistent; without them the LLM invents many near-duplicate types.
- **`include_source=True`** links each entity to the chunk it came from, so you can cite text later.
- **`baseEntityLabel=True`** adds a shared `__Entity__` label, handy for indexing all entities.

## 2. Add a vector index over the chunks

```python
from langchain_neo4j import Neo4jVector
from langchain_openai import OpenAIEmbeddings

vector = Neo4jVector.from_existing_graph(
    OpenAIEmbeddings(model="text-embedding-3-small"),
    node_label="Document",                 # source chunks created by include_source
    text_node_properties=["text"],
    embedding_node_property="embedding",
)
```

Now the same database holds both the graph and the embeddings.

## 3. Hybrid retrieval in LangGraph

```python
from typing import Literal, TypedDict
from pydantic import BaseModel
from langchain_neo4j import GraphCypherQAChain
from langgraph.graph import StateGraph, START, END

cypher_chain = GraphCypherQAChain.from_llm(
    llm=llm, graph=graph, validate_cypher=True,
    allow_dangerous_requests=True, return_direct=True,   # return rows, we write the answer
)

class State(TypedDict):
    question: str
    graph_rows: str
    chunks: str
    answer: str

def graph_search(state: State):
    try:
        rows = cypher_chain.invoke({"query": state["question"]})["result"]
    except Exception as e:                                # bad Cypher shouldn't kill the request
        rows = f"(graph query failed: {e})"
    return {"graph_rows": str(rows)}

def vector_search(state: State):
    docs = vector.similarity_search(state["question"], k=3)
    return {"chunks": "\n".join(d.page_content for d in docs)}

def answer(state: State):
    msg = llm.invoke(f"Graph facts: {state['graph_rows']}\nText: {state['chunks']}\n"
                     f"Answer the question using both. Question: {state['question']}")
    return {"answer": msg.content}

g = StateGraph(State)
g.add_node("graph_search", graph_search)
g.add_node("vector_search", vector_search)
g.add_node("answer", answer)
g.add_edge(START, "graph_search")          # both run in parallel (fan-out)
g.add_edge(START, "vector_search")
g.add_edge(["graph_search", "vector_search"], "answer")   # wait for both
g.add_edge("answer", END)
app = g.compile()

print(app.invoke({"question": "Who was Marie Curie married to, and what did they win?"})["answer"])
```

Running both retrievers in parallel is simple and robust. A router (as in [adaptive RAG](./21-adaptive-rag-self-rag.md)) saves cost if most questions only need one.

## Graph quality tips

| Problem | Fix |
|---|---|
| Duplicate entities ("Marie Curie", "Curie", "M. Curie") | Entity resolution: normalise names, merge similar nodes |
| Too many relationship types | Restrict with `allowed_relationships` |
| Wrong Cypher generated | Few-shot examples, clearer schema names, `validate_cypher` |
| Extraction is slow / costly | Batch documents; use a small model; extract once, offline |

## Gotchas and best practices

- **Extraction is lossy and can hallucinate.** Spot-check the graph in Neo4j Browser before trusting answers.
- **Keep the schema small and domain-specific.** Ten clear relationship types beat a hundred vague ones.
- **Use a read-only user for the QA chain.** Ingestion uses a separate writer.
- **Re-ingestion:** `MERGE`-based loading avoids duplicates, but changed facts need explicit updates or deletes.
- **Evaluate it like any RAG.** Compare graph, vector and hybrid on the same question set.

## Key terms

- **Knowledge graph (KG)** — entities and their relationships stored as a graph.
- **LLMGraphTransformer** — LangChain component that extracts nodes and relationships from text using an LLM.
- **GraphDocument** — LangChain object holding extracted nodes, relationships and the source document.
- **Entity resolution** — merging different mentions of the same real-world entity.
- **GraphRAG** — RAG that retrieves from a knowledge graph, often combined with vector search.
- **Hybrid retrieval** — combining several retrieval methods (here: graph + vector).

## Interview quick-fire

- **"How do you build a knowledge graph from unstructured text?"** → LLM extraction (e.g. `LLMGraphTransformer`) with a constrained schema, entity resolution, then load with MERGE into a graph DB.
- **"Why combine graph and vector retrieval?"** → Graphs answer relationship and aggregate questions; vectors cover descriptive text the graph doesn't capture.
- **"Biggest practical problem with LLM-built graphs?"** → Duplicate or inconsistent entities and relationship types; fix with schema constraints and entity resolution.
