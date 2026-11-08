---
title: "Human-in-the-Loop with interrupt()"
---

## TL;DR

Some actions shouldn't happen without a person saying yes. LangGraph's **`interrupt(value)`** pauses the graph mid-node, **saves state with the checkpointer**, and hands `value` to your app. Later you resume the same thread with **`Command(resume=answer)`**, and `interrupt()` returns that answer inside the node. This note adds a `send_email` tool that asks for approval, and Approve/Reject buttons in the Streamlit UI.

## The flow

```
user: "Email bob@x.com that the demo moved to 3pm"
   │
chat_node ─► AI tool_call send_email(to, subject, body)
   │
tools ─► send_email() ─► interrupt({...draft...})     ── graph pauses, checkpoint saved
                                    │
                         app shows draft + [Approve] [Reject]
                                    │
              chatbot.stream(Command(resume="approve"), same thread_id)
                                    │
tools ─► send_email() runs again from the top; interrupt() now returns "approve"
   │
chat_node ─► "Done, the email to Bob was sent."
```

Requirements: a **checkpointer** and a **`thread_id`**. Both are already in `backend.py`.

## Common HITL patterns

| Pattern | Interrupt value | Resume value |
|---|---|---|
| Approve / reject | The proposed action | `"approve"` or `"reject"` |
| Edit before running | The draft arguments | Edited arguments |
| Ask for missing info | A question | The user's answer |
| Review output | The generated text | Approved or corrected text |

## The approval tool — add to `backend.py`

```python
from langgraph.types import interrupt


@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email. A human must approve it before it is sent."""
    decision = interrupt({"action": "send_email", "to": to, "subject": subject, "body": body})
    if decision != "approve":
        return "The user rejected this email. Ask what they want to change."
    return f"Email sent to {to}."            # call your email provider here


tools = [search, calculator, get_current_datetime, send_email]
```

Nothing else in the graph changes. `ToolNode` runs the tool, the tool hits `interrupt`, and the whole graph pauses.

## A helper to detect a pause — add to `backend.py`

```python
def pending_interrupt(thread_id: str) -> dict | None:
    """The value passed to interrupt() if this thread is paused, else None."""
    snapshot = chatbot.get_state({"configurable": {"thread_id": thread_id}})
    for task in snapshot.tasks:
        if task.interrupts:
            return task.interrupts[0].value
    return None
```

A paused thread has `snapshot.next == ("tools",)` and the interrupt payload on its pending task.

## Try it in the terminal

```python
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from backend import chatbot, pending_interrupt

thread_id = "hitl-demo"
config = {"configurable": {"thread_id": thread_id}}

result = chatbot.invoke(
    {"messages": [HumanMessage("Email bob@example.com that the demo moved to 3pm.")]}, config
)
if draft := pending_interrupt(thread_id):
    print(f"To: {draft['to']}\nSubject: {draft['subject']}\n\n{draft['body']}")
    answer = input("approve / reject: ").strip()
    result = chatbot.invoke(Command(resume=answer), config)

print(result["messages"][-1].content)
```

## Approval in `app.py`

Put this after the history loop, and disable the chat box while a decision is pending:

```python
from langgraph.types import Command
from backend import pending_interrupt

def run_turn(graph_input):
    def tokens():
        for chunk, meta in chatbot.stream(graph_input, config, stream_mode="messages"):
            if isinstance(chunk, ToolMessage):
                yield f"\n\n*Used tool: `{chunk.name}`*\n\n"
            elif (isinstance(chunk, AIMessageChunk) and chunk.content
                  and meta["langgraph_node"] == "chat_node"):
                yield chunk.content
    with st.chat_message("assistant"):
        st.write_stream(tokens())
    st.rerun()

pending = pending_interrupt(thread_id)
decision = None
if pending:
    with st.chat_message("assistant"):
        st.warning(f"Approve sending this email to **{pending['to']}**?")
        st.markdown(f"**Subject:** {pending['subject']}\n\n{pending['body']}")
        approve_col, reject_col = st.columns(2)
        if approve_col.button("Approve"):
            decision = "approve"
        if reject_col.button("Reject"):
            decision = "reject"

if decision:
    run_turn(Command(resume=decision))

if prompt := st.chat_input("Ask anything", disabled=bool(pending)):
    st.chat_message("user").write(prompt)
    run_turn({"messages": [HumanMessage(prompt)]})
```

Because the pause lives in the checkpointer, it survives a page refresh or server restart. Open the thread tomorrow and the Approve button is still there.

## Interrupt rules to remember

- **The node re-runs from the start on resume.** Code before `interrupt()` executes twice. Keep side effects **after** the interrupt, or make them idempotent.
- **Several interrupts in one node** are matched by order. Don't put them in conditionals that change between runs.
- **Parallel tool calls** can each interrupt. Handle a list of pending interrupts, or disable parallel calls for risky tools with `llm.bind_tools(tools, parallel_tool_calls=False)`.
- **Don't catch it.** `interrupt` works by raising a special exception. A bare `try/except Exception` around it breaks the pause.
- **Interrupt values must be JSON-serializable**, since they're stored in the checkpoint.

## Alternatives

- **Static breakpoints**: `builder.compile(checkpointer=..., interrupt_before=["tools"])` pauses before every tool call. Good for debugging, too blunt for production.
- **LangChain middleware**: `create_agent(..., middleware=[HumanInTheLoopMiddleware(...)])` configures approval per tool without writing the interrupt yourself.

## Key terms

- **Human-in-the-loop (HITL)** — a person reviews, approves or edits an agent's action before it continues.
- **`interrupt(value)`** — pauses the graph inside a node and surfaces `value` to the caller.
- **`Command(resume=...)`** — input that resumes a paused thread; the value becomes `interrupt()`'s return.
- **Breakpoint** — a static pause before or after named nodes (`interrupt_before` / `interrupt_after`).
- **Idempotent** — safe to run more than once with the same effect.

## Interview quick-fire

- **"How do you add human approval to a LangGraph agent?"** → Call `interrupt()` in the node or tool before the risky action, use a checkpointer, then resume the same thread with `Command(resume=decision)`.
- **"Why does `interrupt` need a checkpointer?"** → The paused state must be saved so a later, separate call can load it and continue.
- **"What happens to code before `interrupt()` when you resume?"** → It runs again, because the node restarts from the beginning; side effects belong after the interrupt.
- **"Which actions should require approval?"** → Irreversible or external ones: sending messages, payments, deletes, writes to production systems.
