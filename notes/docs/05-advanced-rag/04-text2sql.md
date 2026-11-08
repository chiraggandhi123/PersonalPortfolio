---
title: "Text2SQL (query a database safely)"
---

## TL;DR

Some questions ("how many orders shipped late last month?") need **a database query, not a vector search**. Text2SQL has the LLM write SQL from the question plus the **schema**, you run it, and the LLM explains the result. The hard part is safety: treat generated SQL as **untrusted input**. Run it under a **read-only database role**, **validate the query** with a parser before running it, enforce **row limits and timeouts**, and never rely on the prompt alone to stop a `DROP TABLE`.

## The flow

```
question ──► pick relevant tables ──► LLM writes SQL ──► validate (parse, allowlist)
                                                              │ fail → feed error back, retry (max 2)
                                                              ▼
                                          execute as read-only role (timeout, LIMIT)
                                                              │ DB error → feed back, retry
                                                              ▼
                                              LLM summarises rows ──► answer + SQL shown
```

## Defence in depth

| Layer | What it stops | How |
|---|---|---|
| Read-only DB role | Writes, DDL, even if everything else fails | `GRANT SELECT` only, on specific tables or views |
| Views / column limits | Reading sensitive columns (salaries, PII) | Expose curated views, not raw tables |
| Row-level security | Seeing other tenants' rows | Postgres RLS policies, or a forced `tenant_id` filter |
| SQL parser validation | Non-SELECT statements, multiple statements, unknown tables | `sqlglot` parse + allowlist |
| Statement timeout + LIMIT | Runaway queries, huge result sets | `statement_timeout`, wrap with `LIMIT` |
| Prompt instructions | Most mistakes, cheaply | "Only SELECT. Use only these tables." |

The prompt is the **weakest** layer. Prompt injection, either in the question or in data the model reads, can override it. The database role is the **strongest**.

## Setting up the read-only role (Postgres)

```sql
CREATE ROLE llm_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE shop TO llm_reader;
GRANT USAGE ON SCHEMA analytics TO llm_reader;
GRANT SELECT ON analytics.orders_v, analytics.products_v TO llm_reader;   -- views only
ALTER ROLE llm_reader SET statement_timeout = '5s';
ALTER ROLE llm_reader SET default_transaction_read_only = on;
```

## Generate, validate, execute

```python
import sqlglot
from sqlglot import exp
from pydantic import BaseModel
from openai import OpenAI
import psycopg

client = OpenAI()
ALLOWED_TABLES = {"orders_v", "products_v"}
SCHEMA = """
orders_v(order_id int, customer_id int, product_id int, status text, ordered_at date, shipped_at date, amount numeric)
products_v(product_id int, name text, category text, price numeric)
"""

class SQLQuery(BaseModel):
    reasoning: str
    sql: str

def generate_sql(question: str, error: str | None = None) -> str:
    msgs = [{"role": "system", "content":
             f"Write one PostgreSQL SELECT query. Use only these tables:\n{SCHEMA}\n"
             "Never modify data. Prefer explicit column names."},
            {"role": "user", "content": question}]
    if error:
        msgs.append({"role": "user", "content": f"Your previous query failed: {error}. Fix it."})
    r = client.chat.completions.parse(model="gpt-4o-mini", temperature=0,
                                      messages=msgs, response_format=SQLQuery)
    return r.choices[0].message.parsed.sql

def validate(sql: str, max_rows: int = 200) -> str:
    statements = sqlglot.parse(sql, read="postgres")
    if len(statements) != 1:
        raise ValueError("Exactly one statement allowed")
    tree = statements[0]
    if not isinstance(tree, exp.Select):            # rejects INSERT/UPDATE/DROP/etc.
        raise ValueError("Only SELECT allowed")
    tables = {t.name for t in tree.find_all(exp.Table)}
    if not tables <= ALLOWED_TABLES:
        raise ValueError(f"Unknown tables: {tables - ALLOWED_TABLES}")
    if not tree.args.get("limit"):
        tree = tree.limit(max_rows)
    return tree.sql(dialect="postgres")

def run(question: str, max_tries: int = 3):
    error = None
    for _ in range(max_tries):
        try:
            sql = validate(generate_sql(question, error))
            with psycopg.connect(READONLY_DSN) as conn:     # llm_reader credentials
                rows = conn.execute(sql).fetchall()
            return sql, rows
        except Exception as e:                               # validation or DB error
            error = str(e)
    raise RuntimeError(f"Could not answer after {max_tries} tries: {error}")
```

Then pass `question`, `sql` and the rows to the LLM to write a short answer. Show the SQL to the user so they can check it.

`exp.Select` alone misses `UNION` queries (`exp.Union`) and CTEs that wrap a select. Allow those explicitly if you need them, and keep the read-only role as the backstop.

## Making the SQL correct, not just safe

- **Schema linking** — with 200 tables, don't send them all. Embed table and column descriptions and retrieve the relevant 5–10, which is RAG over the schema.
- **Column descriptions and sample values** — `status` is useless without "one of: pending, shipped, cancelled".
- **Few-shot examples** — retrieve similar question-to-SQL pairs from a curated set.
- **Business definitions** — "active customer" means something specific. Put it in the prompt or a semantic layer.
- **Evaluate by result, not text** — two different SQL strings can be equally correct. Compare executed results against a gold query on a test set.

## Key terms

- **Text2SQL / NL2SQL** — translating a natural-language question into SQL.
- **Schema linking** — selecting the tables and columns relevant to a question.
- **Read-only role** — a database user with only SELECT privileges.
- **Row-level security (RLS)** — database policies that filter rows per user or tenant.
- **sqlglot** — a Python SQL parser and transpiler used to inspect and rewrite queries.
- **Execution accuracy** — the share of generated queries whose results match the gold query's results.

## Interview quick-fire

- **"How do you stop the LLM running DROP TABLE?"** → A read-only DB role is the real guarantee; add parser validation (single SELECT, allowlisted tables) and timeouts. Prompts alone aren't enough.
- **"How do you handle a large schema?"** → Retrieve only relevant tables via embeddings over table and column descriptions, and add descriptions and example values.
- **"What happens when the query errors?"** → Feed the DB error back to the model and retry, with a hard limit.
- **"When Text2SQL vs. vector RAG?"** → Aggregates, filters and exact numbers come from structured data via SQL; explanations and policies come from documents via vector RAG. Many systems route between both.
