---
title: "End-to-End NLP: Text Summarization (HF)"
---

## Goal

Fine-tune a small **encoder–decoder model (FLAN-T5)** to summarize chat dialogues, measure it with **ROUGE** against the untuned model, and serve it behind a **FastAPI** endpoint. It's the full loop in miniature: data → train → evaluate → serve, all on a free GPU.

**Skills practiced:** Hugging Face `datasets` and `transformers`, tokenization for seq2seq, `Seq2SeqTrainer`, ROUGE evaluation, saving and loading models, a simple inference API.

## Architecture

```
HF Hub: SAMSum dialogues ──► preprocess (tokenize dialogue + summary)
                                   │
                                   ▼
                        Seq2SeqTrainer (flan-t5-base)
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
           evaluate.py: ROUGE            ./summarizer (saved model)
       base model vs fine-tuned                   │
                                                  ▼
                                    FastAPI /summarize ◄── client
```

## Setup

Use a GPU (Colab or Kaggle free tier is enough for `flan-t5-base`; `flan-t5-small` runs on CPU, slowly).

```bash
pip install "transformers[torch]" datasets evaluate rouge_score accelerate fastapi uvicorn
```

No API keys are needed. Optional `.env` if you push to the Hub:

```
HF_TOKEN=hf_...
```

## Code — `train.py`

```python
from datasets import load_dataset
from transformers import (AutoModelForSeq2SeqLM, AutoTokenizer, DataCollatorForSeq2Seq,
                          Seq2SeqTrainer, Seq2SeqTrainingArguments)

BASE = "google/flan-t5-base"
PREFIX = "Summarize this dialogue: "

ds = load_dataset("knkarthick/samsum")          # columns: dialogue, summary
ds = ds.filter(lambda r: r["dialogue"] and r["summary"])
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForSeq2SeqLM.from_pretrained(BASE)

def preprocess(batch):
    enc = tok([PREFIX + d for d in batch["dialogue"]], max_length=512, truncation=True)
    enc["labels"] = tok(text_target=batch["summary"], max_length=128, truncation=True)["input_ids"]
    return enc

tokenized = ds.map(preprocess, batched=True, remove_columns=ds["train"].column_names)

args = Seq2SeqTrainingArguments(
    output_dir="runs/flan-t5-samsum",
    num_train_epochs=3,
    learning_rate=3e-4,
    per_device_train_batch_size=8,
    per_device_eval_batch_size=8,
    eval_strategy="epoch",
    save_strategy="epoch",
    load_best_model_at_end=True,
    save_total_limit=2,
    logging_steps=50,
    report_to="none",
)

trainer = Seq2SeqTrainer(
    model=model,
    args=args,
    train_dataset=tokenized["train"],
    eval_dataset=tokenized["validation"],
    data_collator=DataCollatorForSeq2Seq(tok, model=model),   # pads inputs and labels
    processing_class=tok,
)
trainer.train()
trainer.save_model("summarizer")
tok.save_pretrained("summarizer")
```

## Code — `evaluate_model.py`

```python
import evaluate
from datasets import load_dataset
from transformers import pipeline

PREFIX = "Summarize this dialogue: "
test = load_dataset("knkarthick/samsum", split="test").select(range(200))
rouge = evaluate.load("rouge")

def score(model_path: str) -> dict:
    summarize = pipeline("summarization", model=model_path, device_map="auto")
    outs = summarize([PREFIX + d for d in test["dialogue"]],
                     max_new_tokens=80, num_beams=4, batch_size=16)
    preds = [o["summary_text"] for o in outs]
    return rouge.compute(predictions=preds, references=test["summary"])

for name in ["google/flan-t5-base", "summarizer"]:
    r = score(name)
    print(f"{name:25} rouge1={r['rouge1']:.3f} rouge2={r['rouge2']:.3f} rougeL={r['rougeL']:.3f}")
```

## Code — `app.py`

```python
from fastapi import FastAPI
from pydantic import BaseModel, Field
from transformers import pipeline

summarize = pipeline("summarization", model="summarizer", device_map="auto")
app = FastAPI(title="Dialogue summarizer")

class In(BaseModel):
    dialogue: str = Field(min_length=10, max_length=8000)

@app.post("/summarize")
def run(body: In):
    out = summarize("Summarize this dialogue: " + body.dialogue,
                    max_new_tokens=80, num_beams=4)
    return {"summary": out[0]["summary_text"]}
```

```bash
python train.py && python evaluate_model.py
uvicorn app:app --port 8000
curl -X POST localhost:8000/summarize -H "Content-Type: application/json" \
  -d '{"dialogue": "Amy: lunch at 1?\nTom: can we do 1:30?\nAmy: sure, usual place"}'
```

## How it works

1. **Data** — SAMSum has about 16k chat dialogues, each with a human-written summary, already split into train/validation/test.
2. **Preprocess** — the dialogue becomes `input_ids`; the summary becomes `labels`. `text_target=` tokenizes the target side. The task prefix matches how FLAN-T5 was instruction-tuned.
3. **Collator** — `DataCollatorForSeq2Seq` pads each batch and sets padded label positions to `-100` so they're ignored in the loss.
4. **Training** — standard cross-entropy on the summary tokens. `load_best_model_at_end` keeps the checkpoint with the lowest eval loss.
5. **Evaluation** — the same 200 test dialogues go through the base and fine-tuned models. Expect a clear jump in ROUGE after fine-tuning, because the model learns SAMSum's short, third-person style.
6. **Serving** — the saved folder loads straight into `pipeline("summarization")`. FastAPI adds validation and a JSON contract.

Why an encoder–decoder model here: summarization maps one text to a shorter one, which is what T5/BART were built for. They're small, fast and easy to fine-tune fully, with no LoRA needed.

## Stretch goals

- [ ] Compare `flan-t5-small`, `flan-t5-base` and `facebook/bart-base` on ROUGE, speed and size.
- [ ] Add an LLM-as-judge faithfulness check (does the summary state anything not in the dialogue?).
- [ ] Compare against `gpt-4o-mini` with a few-shot prompt on the same test set, including cost per 1,000 summaries.
- [ ] Fine-tune a small decoder model (e.g. Qwen 0.5B) with LoRA via `SFTTrainer` and compare.
- [ ] Push the model to the Hugging Face Hub and add a Gradio demo on Spaces.
- [ ] Containerize `app.py` with Docker and add a `/health` endpoint.
- [ ] Batch requests and export to ONNX for faster CPU inference.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
