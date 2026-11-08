---
title: "Gen AI Clothing Store (Pydantic AI)"
---

## Goal

Build an **AI shopping assistant** for a small clothing store using **Pydantic AI**. Customers chat in plain language ("a linen shirt for a beach wedding, under 2000, size M"), and the assistant **searches the catalogue with tools**, recommends real products, checks sizes and stock, and manages a **cart**. Every reply is a **typed object** (message + product IDs), so the UI can render product cards and the assistant can't recommend items that don't exist.

**Skills practiced:** Pydantic AI agents, typed outputs, tools with dependency injection, conversation history, grounding answers in data, output validation with retries, Streamlit UI.

## Architecture

```
customer ──► Streamlit chat ──► Pydantic AI Agent ('openai:gpt-4o-mini')
                                     │   instructions (store persona + rules)
                                     │   deps: StoreDeps(catalogue, cart)
                                     │
                       ┌─────────────┼────────────────┐
                       ▼             ▼                ▼
               search_products  get_product     add_to_cart      ← tools (plain Python)
                       │             │                │
                       └──── catalogue (list of Product) / cart ──┘
                                     │
                                     ▼
                     ShopReply(message, product_ids, cart_total)
                                     │  output validator: IDs must exist
                                     ▼
                     chat bubble + product cards + cart sidebar
```

The agent loop (call tool → read result → maybe call another → answer) is the same as in [tool calling](../../02-calling-models/05-tool-function-calling.md); Pydantic AI runs it for you.

## Setup

```bash
pip install pydantic-ai streamlit python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

Pydantic AI also supports Anthropic, Gemini, Groq and Ollama models; switching is a change to the model string.

## Code — `store.py` (data + agent)

```python
from dataclasses import dataclass, field
from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry, RunContext

class Product(BaseModel):
    id: str
    name: str
    category: str
    price: int                       # INR
    colors: list[str]
    sizes: dict[str, int]            # size -> stock
    tags: list[str]

CATALOGUE = [
    Product(id="SH01", name="Linen Shirt", category="shirt", price=1799,
            colors=["white", "sky blue"], sizes={"S": 3, "M": 0, "L": 5}, tags=["summer", "beach", "formal"]),
    Product(id="SH02", name="Cotton Oxford Shirt", category="shirt", price=1499,
            colors=["white", "pink"], sizes={"S": 2, "M": 6, "L": 1}, tags=["office", "formal"]),
    Product(id="CH01", name="Slim Chinos", category="trousers", price=2199,
            colors=["beige", "navy"], sizes={"30": 4, "32": 7, "34": 2}, tags=["office", "smart casual"]),
    Product(id="DR01", name="Floral Midi Dress", category="dress", price=2499,
            colors=["yellow"], sizes={"S": 1, "M": 3}, tags=["summer", "wedding", "beach"]),
]

@dataclass
class StoreDeps:
    catalogue: list[Product]
    cart: list[tuple[str, str]] = field(default_factory=list)    # (product_id, size)

class ShopReply(BaseModel):
    message: str = Field(description="Friendly reply to the customer, under 80 words")
    product_ids: list[str] = Field(default_factory=list, description="IDs of products recommended in this reply")
    cart_total: int = Field(description="Current cart total in INR")

agent = Agent(
    "openai:gpt-4o-mini",
    deps_type=StoreDeps,
    output_type=ShopReply,
    instructions=(
        "You are Tara, a stylish but honest shop assistant for Threadline, a clothing store. "
        "Only recommend products returned by your tools; never invent items, prices or stock. "
        "Check stock for the customer's size before recommending. If nothing fits, say so and "
        "suggest the closest option. Prices are in INR. Ask one clarifying question if the request is vague."
    ),
)

@agent.tool
def search_products(ctx: RunContext[StoreDeps], query: str, max_price: int | None = None,
                    category: str | None = None) -> list[dict]:
    """Search the catalogue by keywords (occasion, colour, style), optional max price and category."""
    words = query.lower().split()
    hits = []
    for p in ctx.deps.catalogue:
        text = " ".join([p.name, p.category, *p.colors, *p.tags]).lower()
        if max_price and p.price > max_price:
            continue
        if category and p.category != category:
            continue
        if any(w in text for w in words):
            hits.append(p.model_dump(include={"id", "name", "price", "colors", "tags"}))
    return hits

@agent.tool
def get_product(ctx: RunContext[StoreDeps], product_id: str) -> dict:
    """Get full details, including stock per size, for one product ID."""
    for p in ctx.deps.catalogue:
        if p.id == product_id:
            return p.model_dump()
    raise ModelRetry(f"No product with id {product_id}. Use search_products first.")

@agent.tool
def add_to_cart(ctx: RunContext[StoreDeps], product_id: str, size: str) -> str:
    """Add a product in a given size to the customer's cart."""
    product = next((p for p in ctx.deps.catalogue if p.id == product_id), None)
    if product is None:
        raise ModelRetry(f"Unknown product id {product_id}.")
    if product.sizes.get(size, 0) == 0:
        return f"{product.name} is out of stock in size {size}."
    ctx.deps.cart.append((product_id, size))
    return f"Added {product.name} ({size}) to cart."

@agent.output_validator
def ids_must_exist(ctx: RunContext[StoreDeps], out: ShopReply) -> ShopReply:
    known = {p.id for p in ctx.deps.catalogue}
    bad = [i for i in out.product_ids if i not in known]
    if bad:
        raise ModelRetry(f"Unknown product IDs {bad}. Only use IDs returned by tools.")
    prices = {p.id: p.price for p in ctx.deps.catalogue}
    out.cart_total = sum(prices[pid] for pid, _ in ctx.deps.cart)   # trust code, not the model
    return out
```

## Code — `app.py` (UI)

```python
import streamlit as st
from dotenv import load_dotenv

load_dotenv()
from store import CATALOGUE, StoreDeps, agent  # noqa: E402

st.title("Threadline — AI Stylist")
ss = st.session_state
ss.setdefault("deps", StoreDeps(catalogue=CATALOGUE))
ss.setdefault("history", [])          # Pydantic AI message objects
ss.setdefault("chat", [])             # (role, text, product_ids) for display

by_id = {p.id: p for p in CATALOGUE}

def render(text, ids):
    st.write(text)
    for col, pid in zip(st.columns(max(len(ids), 1)), ids):
        p = by_id[pid]
        col.markdown(f"**{p.name}**  \n₹{p.price}  \n{', '.join(p.colors)}")

for role, text, ids in ss.chat:
    with st.chat_message(role):
        render(text, ids)

if prompt := st.chat_input("What are you shopping for?"):
    ss.chat.append(("user", prompt, []))
    st.chat_message("user").write(prompt)
    result = agent.run_sync(prompt, deps=ss.deps, message_history=ss.history)
    ss.history = result.all_messages()               # carry memory to the next turn
    reply = result.output
    ss.chat.append(("assistant", reply.message, reply.product_ids))
    with st.chat_message("assistant"):
        render(reply.message, reply.product_ids)

with st.sidebar:
    st.header("Cart")
    for pid, size in ss.deps.cart:
        st.write(f"{by_id[pid].name} ({size}) — ₹{by_id[pid].price}")
    st.write(f"**Total: ₹{sum(by_id[pid].price for pid, _ in ss.deps.cart)}**")
```

Run with `streamlit run app.py`, then try: "Something for a beach wedding under 2000, size M."

## How it works

1. **Typed output.** `output_type=ShopReply` makes the agent return a validated Pydantic object, not free text. The UI uses `product_ids` to draw cards.
2. **Tools from type hints.** Pydantic AI builds each tool's JSON schema from the function signature and docstring, so the docstring is the tool's prompt.
3. **Dependency injection.** `StoreDeps` carries the catalogue and cart. Tools get it through `ctx.deps`, so there are no globals and testing with a fake catalogue is easy.
4. **Self-correction.** `ModelRetry` in a tool or output validator sends the error back to the model, which tries again ([parsing & validating output](../05-parsing-validating-output.md)).
5. **Code owns the facts.** The validator rejects unknown IDs and recomputes `cart_total`, so a model slip can't show a wrong price.
6. **Memory.** `result.all_messages()` is passed back as `message_history`, including tool calls, so "add the first one in L" works.

## Stretch goals

- [ ] **Real catalogue** in SQLite or Postgres, with the search tool running SQL.
- [ ] **Semantic search** with embeddings so "something breezy" finds linen (RAG stage).
- [ ] **Remove from cart** and **checkout** tools, with a confirmation step before "placing" an order.
- [ ] **Outfit builder** — a second agent that combines items across categories within a budget.
- [ ] **Image generation** of a suggested outfit, or image upload for "find me something like this".
- [ ] **Streaming** replies with `agent.run_stream`.
- [ ] **Evals** — fixed shopping requests checking that only in-stock, in-budget items are recommended.
- [ ] **Tracing** with Logfire or Langfuse to inspect tool calls.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
