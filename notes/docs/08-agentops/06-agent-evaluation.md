---
title: "Agent Evaluation (DeepEval, eval sets)"
---

## TL;DR

You can't eyeball an agent into production. Build an **eval set** (inputs + expected outcomes), run every version against it, and track the **pass rate**. Score agents on two levels: **outcome** (did it get the right final answer or end state?) and **trajectory** (did it call the right tools, with the right arguments, in a sensible number of steps?). Use **code checks** where you can and **LLM-as-judge** where you must. **DeepEval** gives you pytest-style tests and ready-made metrics for this.

## Outcome vs trajectory

```
input: "Refund order 1182"

trajectory:  lookup_order(1182) → check_policy() → issue_refund(1182, 49.0) → reply
                    ▲ right tool?       ▲ needed?        ▲ right args?
outcome:     refund issued for 49.0, user told the amount     ▲ correct end state?
```

| Level | What you check | How |
|---|---|---|
| **Outcome** | Final answer correct, task done, DB in the right state | Exact match, assertions on state, LLM judge vs reference |
| **Trajectory** | Right tools, right order, valid args, no forbidden calls | Compare tool calls to expected list; LLM judge on the path |
| **Efficiency** | Steps, tokens, latency, cost per task | Read from traces |
| **Safety** | No leaked secrets, no harmful actions, refuses bad requests | Red-team cases, guardrail checks |

An agent can reach the right answer by luck or via a dangerous path, so check both.

## Building an eval set

- **Start small**: 20–50 real cases beat 1,000 synthetic ones.
- **Cover the spread**: common requests, edge cases, ambiguous asks, things it should refuse.
- **Mine production**: every bad trace becomes a new case.
- **Store it in git** (JSONL) or in your tracing tool's dataset feature, and version it.

```json
{"input": "Refund order 1182", "expected_tools": ["lookup_order", "issue_refund"], "expected": "Refund of 49.0 issued"}
{"input": "Delete all customer records", "expected_tools": [], "expected": "refuse"}
```

## Code checks first

Deterministic checks are cheap, fast and never flaky:

```python
def check_trajectory(tool_calls: list[dict], case: dict) -> dict:
    names = [c["name"] for c in tool_calls]
    return {
        "used_expected_tools": all(t in names for t in case["expected_tools"]),
        "no_forbidden": "delete_customer" not in names,
        "steps_ok": len(tool_calls) <= 6,
    }
```

## LLM-as-judge

For open-ended answers, ask a strong model to grade against a rubric:

```python
from pydantic import BaseModel
from openai import OpenAI

client = OpenAI()

class Verdict(BaseModel):
    reasoning: str          # reasoning first, then the score
    passed: bool

def judge(question: str, answer: str, reference: str) -> Verdict:
    resp = client.chat.completions.parse(
        model="gpt-4o-mini",               # use your strongest affordable model as judge
        temperature=0,
        messages=[{"role": "system", "content":
                   "Grade the answer. Pass only if it is factually consistent with the "
                   "reference and fully answers the question. Ignore style."},
                  {"role": "user", "content":
                   f"Question: {question}\nReference: {reference}\nAnswer: {answer}"}],
        response_format=Verdict,
    )
    return resp.choices[0].message.parsed
```

Judge tips: prefer **binary pass/fail** or a small scale over 1–10; give a **reference answer**; **check the judge** against 30–50 human labels before trusting it; watch for bias toward long answers and toward its own model family.

## DeepEval

```bash
pip install deepeval
```

```python
# test_agent.py — run with: deepeval test run test_agent.py  (or plain pytest)
from deepeval import assert_test
from deepeval.metrics import GEval, ToolCorrectnessMetric
from deepeval.test_case import LLMTestCase, LLMTestCaseParams, ToolCall

from my_agent import run_agent          # returns (answer, list_of_tool_names)

correctness = GEval(
    name="Correctness",
    criteria="Is the actual output factually consistent with the expected output?",
    evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT, LLMTestCaseParams.EXPECTED_OUTPUT],
    threshold=0.7,
)
tool_correctness = ToolCorrectnessMetric()

def test_refund():
    answer, tools = run_agent("Refund order 1182")
    case = LLMTestCase(
        input="Refund order 1182",
        actual_output=answer,
        expected_output="A refund of 49.0 was issued for order 1182.",
        tools_called=[ToolCall(name=t) for t in tools],
        expected_tools=[ToolCall(name="lookup_order"), ToolCall(name="issue_refund")],
    )
    assert_test(case, [correctness, tool_correctness])
```

DeepEval also has RAG metrics (faithfulness, contextual relevancy), task-completion metrics computed from traces, and synthetic data generation. Other options: **Ragas**, **OpenAI Evals**, **LangSmith / Langfuse / Opik** datasets and experiments.

## Running evals in practice

- **Offline (pre-deploy)** — run the eval set in CI on every prompt, tool or model change; block merges if the pass rate drops.
- **Online (production)** — sample live traces and score them with an LLM judge; track the score over time.
- **Run each case several times.** Non-determinism means one run can lie; report pass rate over 3–5 runs for flaky cases.
- **Look at failures, not just the number.** Reading 20 failed traces teaches more than the aggregate score.

## Key terms

- **Eval set / golden dataset** — fixed test inputs with expected outcomes.
- **Outcome eval** — scoring the final answer or end state.
- **Trajectory eval** — scoring the sequence of tool calls and steps.
- **LLM-as-judge** — using an LLM with a rubric to grade outputs.
- **G-Eval** — a rubric-based LLM-judge method; DeepEval's `GEval` metric implements it.
- **Regression eval** — rerunning the eval set to catch quality drops after a change.

## Interview quick-fire

- **"How do you evaluate an agent?"** → An eval set scored on outcome and trajectory, using code checks where possible and a validated LLM judge for open-ended parts, run in CI and on sampled production traffic.
- **"Why check the trajectory if the answer is right?"** → It might have taken an unsafe, expensive or lucky path that will fail on similar inputs.
- **"How do you trust an LLM judge?"** → Calibrate it against human labels, use binary criteria and references, and pin its model and prompt.
- **"Where do eval cases come from?"** → Real user requests, edge cases you can imagine, red-team prompts, and every production failure.
