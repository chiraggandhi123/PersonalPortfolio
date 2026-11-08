---
title: "Azure Multi-Modal Compliance Engine"
---

## Goal

Build a service that checks **marketing content (text, images, video) against a compliance rulebook** and returns a structured verdict: which rules were broken, where, how severe, and a suggested fix. Everything runs on **Azure**: **Azure OpenAI** for vision and reasoning, an Azure speech-to-text option for video audio, and **Azure Container Apps** for hosting. Azure service names and model availability change by region and over time, so treat the specific services here as one reasonable choice and check current docs.

**Skills practiced:** Azure OpenAI, multimodal prompts (images and video frames), audio transcription, rules-as-data, structured outputs, evidence-based verdicts, FastAPI file uploads, Azure deployment.

## Architecture

```
POST /check  (text + files)
      │
      ▼
FastAPI on Azure Container Apps
      │
      ├─ text ──────────────────────────────────────────┐
      ├─ image ─► base64 ───────────────────────────────┤
      ├─ video ─► OpenCV: 1 frame / N sec ──────────────┤
      │        └► audio ─► speech-to-text (Azure) ─► transcript
      │                                                 ▼
      │                  Azure OpenAI chat deployment (vision-capable)
      │                  system: rules.yaml   output: ComplianceReport
      ▼
JSON report: verdict, violations[rule_id, evidence, location, severity, fix]
      │
      └─► (optional) store in Blob Storage / Cosmos DB for audit
```

## Setup

1. In the Azure portal, create an **Azure OpenAI** resource (or an Azure AI Foundry project) and deploy a **vision-capable chat model** (e.g. a `gpt-4o-mini` deployment). If you want video audio, also deploy a speech-to-text model (Whisper is offered in some regions) or use Azure AI Speech.
2. Install:

```bash
pip install openai fastapi uvicorn python-multipart opencv-python-headless pyyaml python-dotenv
```

3. `.env`:

```
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_API_VERSION=2024-10-21
CHAT_DEPLOYMENT=gpt-4o-mini
STT_DEPLOYMENT=whisper
```

Use an API version your resource supports; the portal and docs list them.

## Code — `rules.yaml`

```yaml
- id: FIN-01
  text: Must not promise guaranteed returns or "risk-free" investments.
  severity: high
- id: HLT-01
  text: Must not claim to cure, prevent or treat a disease.
  severity: high
- id: DSC-01
  text: Any discount must state an end date or "terms apply".
  severity: medium
- id: ACC-01
  text: Text in images must be legible; important claims must not be in tiny print.
  severity: low
```

Rules live in data, so compliance teams can edit them without touching code.

## Code — `engine.py`

```python
import base64, os
from typing import Literal
import cv2, yaml
from dotenv import load_dotenv
from openai import AzureOpenAI
from pydantic import BaseModel

load_dotenv()
client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version=os.environ["AZURE_OPENAI_API_VERSION"],
)
RULES = yaml.safe_load(open("rules.yaml"))

class Violation(BaseModel):
    rule_id: str
    location: str            # "text", "image 1", "video frame at 12s", "transcript"
    evidence: str            # exact quote or description of what was seen
    severity: Literal["low", "medium", "high"]
    suggested_fix: str

class ComplianceReport(BaseModel):
    verdict: Literal["pass", "needs_review", "fail"]
    violations: list[Violation]
    summary: str

def b64_image_part(data: bytes, mime: str = "image/jpeg") -> dict:
    url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    return {"type": "image_url", "image_url": {"url": url, "detail": "low"}}

def video_to_frames(path: str, every_sec: int = 3, max_frames: int = 10) -> list[tuple[int, bytes]]:
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    frames, i = [], 0
    while len(frames) < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if i % int(fps * every_sec) == 0:
            frames.append((i // int(fps), cv2.imencode(".jpg", frame)[1].tobytes()))
        i += 1
    cap.release()
    return frames

def transcribe(path: str) -> str:
    with open(path, "rb") as f:   # the STT deployment accepts common audio/video containers
        return client.audio.transcriptions.create(
            model=os.environ["STT_DEPLOYMENT"], file=f).text

def check(text: str = "", images: list[bytes] = (), video_path: str | None = None) -> ComplianceReport:
    rules = "\n".join(f"- {r['id']} ({r['severity']}): {r['text']}" for r in RULES)
    content: list[dict] = [{"type": "text", "text": f"Ad copy:\n{text or '(none)'}"}]
    for n, img in enumerate(images, 1):
        content += [{"type": "text", "text": f"image {n}:"}, b64_image_part(img)]
    if video_path:
        for sec, frame in video_to_frames(video_path):
            content += [{"type": "text", "text": f"video frame at {sec}s:"}, b64_image_part(frame)]
        content.append({"type": "text", "text": f"Transcript:\n{transcribe(video_path)}"})

    resp = client.chat.completions.parse(
        model=os.environ["CHAT_DEPLOYMENT"],       # Azure deployment name
        temperature=0,
        messages=[
            {"role": "system", "content":
             "You are a marketing compliance reviewer. Check ALL content against these rules:\n"
             f"{rules}\n\nOnly report a violation if you can quote or describe concrete evidence. "
             "Use 'needs_review' when unsure. Never invent rules."},
            {"role": "user", "content": content},
        ],
        response_format=ComplianceReport,
    )
    report = resp.choices[0].message.parsed
    valid_ids = {r["id"] for r in RULES}
    report.violations = [v for v in report.violations if v.rule_id in valid_ids]
    return report
```

## Code — `app.py`

```python
import tempfile
from fastapi import FastAPI, File, Form, UploadFile
from engine import check, ComplianceReport

app = FastAPI(title="Compliance Engine")

@app.post("/check", response_model=ComplianceReport)
async def check_endpoint(text: str = Form(""),
                         images: list[UploadFile] = File(default=[]),
                         video: UploadFile | None = File(default=None)):
    imgs = [await f.read() for f in images]
    video_path = None
    if video:
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp.write(await video.read()); tmp.close()
        video_path = tmp.name
    return check(text, imgs, video_path)
```

```bash
uvicorn app:app --reload
curl -F "text=Guaranteed 20% returns, risk-free!" -F "images=@banner.jpg" localhost:8000/check
```

Deploy with the Container Apps steps from the cloud deployment note (`az containerapp up --source .`), with keys in Key Vault or, better, a managed identity with access to the Azure OpenAI resource.

## How it works

1. **Rules as data** — the YAML rulebook is injected into the system prompt, with IDs the model must cite.
2. **Multimodal input** — images and sampled video frames go in as `image_url` parts with labels, so violations can point to "frame at 12s". `detail: low` keeps token cost down.
3. **Audio** — the video's speech is transcribed and added as text, so spoken claims are checked too.
4. **Evidence-first output** — each violation must carry a quote or description. A rule ID not in the rulebook is dropped.
5. **Three verdicts** — `needs_review` routes uncertain cases to a human instead of forcing pass/fail.

## Stretch goals

- [ ] **OCR for small print** — run Azure AI Document Intelligence (or a Vision OCR service) on images and pass extracted text alongside the image.
- [ ] **Content safety** — add Azure AI Content Safety as a pre-check for harmful imagery or text.
- [ ] **RAG over regulations** — index long policy PDFs in Azure AI Search and retrieve relevant clauses per ad.
- [ ] **Audit trail** — store each report with input hashes in Cosmos DB or Blob Storage.
- [ ] **Async jobs** — long videos go on a queue (Service Bus) and a worker processes them.
- [ ] **Eval set** — 50 labeled ads; measure precision and recall per rule.
- [ ] **Entra ID auth** — swap API keys for `DefaultAzureCredential` and managed identity.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
