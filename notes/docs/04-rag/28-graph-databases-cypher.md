---
title: "Graph Databases & Cypher (LangChain)"
---

## TL;DR

A graph database stores **nodes** (entities), **relationships** (typed, directed edges) and **properties** on both. It's built for questions about **connections**: "which suppliers do our top customers share?", "who reports to whom?". **Cypher** is the query language of **Neo4j** (and others via openCypher): you draw the pattern you want with ASCII-art like `(a:Person)-[:WORKS_AT]->(c:Company)`. In RAG, an LLM can **translate a question into Cypher** (LangChain's `GraphCypherQAChain`), run it, and answer from the results. This handles **multi-hop and aggregate** questions that vector search struggles with.

## Why a graph for RAG

| Question type | Vector RAG | Graph RAG |
|---|---|---|
| "What does the leave policy say?" | Good | Overkill |
| "Which projects did Asha's team ship in 2024?" | Weak (multi-hop) | Good |
| "How many customers use product X and Y?" | Bad (aggregation) | Good |
| "How are A and B connected?" | Bad | Good (path queries) |

## The property graph model

```
(:Person {name:"Asha"}) ─[:WORKS_AT {since:2021}]─► (:Company {name:"Acme"})
        │                                                    ▲
   [:MANAGES]                                          [:WORKS_AT]
        ▼                                                    │
(:Person {name:"Ravi"}) ─[:CONTRIBUTED_TO]─► (:Project {name:"Search"})
```

- **Label** — type of node (`Person`, `Company`).
- **Relationship type** — `WORKS_AT`, `MANAGES`, always directed.
- **Properties** — key-value pairs (`name`, `since`).

## Cypher in five minutes

```
// Create nodes and a relationship
CREATE (a:Person {name: "Asha"})-[:WORKS_AT {since: 2021}]->(c:Company {name: "Acme"})

// MERGE = create only if it doesn't already exist (use it for ingestion)
MERGE (p:Person {name: "Ravi"})
MERGE (c:Company {name: "Acme"})
MERGE (p)-[:WORKS_AT]->(c)

// Find a pattern
MATCH (p:Person)-[:WORKS_AT]->(c:Company {name: "Acme"})
RETURN p.name

// Filter, aggregate, sort
MATCH (p:Person)-[:CONTRIBUTED_TO]->(pr:Project)
WHERE pr.year = 2024
RETURN p.name, count(pr) AS projects
ORDER BY projects DESC LIMIT 5

// Multi-hop: projects of people Asha manages
MATCH (:Person {name: "Asha"})-[:MANAGES]->(e:Person)-[:CONTRIBUTED_TO]->(pr:Project)
RETURN e.name, pr.name

// Variable-length path
MATCH path = shortestPath((a:Person {name:"Asha"})-[*..4]-(b:Person {name:"Meera"}))
RETURN path
```

| Clause | Role (SQL analogy) |
|---|---|
| `MATCH` | `FROM` + `JOIN`, as a pattern |
| `WHERE` | `WHERE` |
| `RETURN` | `SELECT` |
| `CREATE` / `MERGE` | `INSERT` / upsert |
| `SET` / `DELETE` | `UPDATE` / `DELETE` |

## Question → Cypher with LangChain

Run Neo4j locally (Docker or Neo4j Desktop) or use a free Neo4j Aura instance.

```bash
pip install langchain-neo4j langchain-openai
```

```python
from langchain_neo4j import Neo4jGraph, GraphCypherQAChain
from langchain_openai import ChatOpenAI

graph = Neo4jGraph(url="bolt://localhost:7687", username="neo4j", password="password")

graph.query("""
MERGE (a:Person {name:'Asha'}) MERGE (r:Person {name:'Ravi'})
MERGE (c:Company {name:'Acme'}) MERGE (p:Project {name:'Search', year:2024})
MERGE (a)-[:WORKS_AT]->(c) MERGE (r)-[:WORKS_AT]->(c)
MERGE (a)-[:MANAGES]->(r) MERGE (r)-[:CONTRIBUTED_TO]->(p)
""")
graph.refresh_schema()
print(graph.schema)        # node labels, properties and relationship types for the prompt

chain = GraphCypherQAChain.from_llm(
    llm=ChatOpenAI(model="gpt-4o-mini", temperature=0),
    graph=graph,
    verbose=True,                    # prints the generated Cypher
    validate_cypher=True,            # fixes relationship directions
    allow_dangerous_requests=True,   # required opt-in: the LLM writes queries
)
print(chain.invoke({"query": "Which projects did people managed by Asha work on?"})["result"])
```

Under the hood: schema + question → LLM writes Cypher → Neo4j runs it → LLM turns rows into an answer.

## Gotchas and best practices

- **Use a read-only database user** for LLM-generated queries. A model can write `DELETE`.
- **Schema in the prompt matters.** Clear labels and relationship names produce better Cypher.
- **Add few-shot examples** of question → Cypher pairs for your domain.
- **Entity names must match exactly.** "Acme Corp" vs "Acme" returns nothing; normalise names or use full-text indexes for fuzzy matching.
- **Limit result size** (`LIMIT`) so large result sets don't flood the context.

## Key terms

- **Graph database** — a database that stores data as nodes, relationships and properties.
- **Property graph** — the model where both nodes and relationships carry properties.
- **Cypher** — declarative, pattern-based query language for graphs (Neo4j, openCypher).
- **MERGE** — Cypher clause that matches a pattern or creates it if missing.
- **Text-to-Cypher** — using an LLM to translate natural language into Cypher.
- **Multi-hop query** — traversing several relationships to reach an answer.

## Interview quick-fire

- **"When is a graph DB better than a vector DB for RAG?"** → For relationship-heavy, multi-hop and aggregate questions; vectors are better for fuzzy semantic text lookup.
- **"CREATE vs. MERGE?"** → CREATE always adds; MERGE matches first and creates only if missing, so it's safe for repeated ingestion.
- **"Risks of text-to-Cypher?"** → Wrong or destructive queries; mitigate with read-only credentials, schema-grounded prompts, validation and few-shot examples.
