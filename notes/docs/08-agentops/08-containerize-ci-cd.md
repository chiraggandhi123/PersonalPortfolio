---
title: "Containerize & CI/CD (Docker + GitHub Actions on AWS)"
---

## TL;DR

Package the agent as a **Docker image** so it runs the same on your laptop, in CI and in the cloud. Then let **GitHub Actions** do the rest on every push: **lint, run tests and evals, build the image, push it to a registry (Amazon ECR), and deploy** (App Runner or ECS). Keep secrets in **GitHub secrets and AWS Secrets Manager**, and authenticate GitHub to AWS with **OIDC** instead of long-lived keys.

## The pipeline

```
git push ──► GitHub Actions
              ├─ 1. install + lint + unit tests
              ├─ 2. eval set (fail if pass rate drops)
              ├─ 3. docker build
              ├─ 4. push image to ECR  (tag = git SHA)
              └─ 5. deploy: App Runner / ECS pulls the new image
                                         │
                                         ▼
                              agent API running in AWS
```

## A FastAPI agent service

```python
# app.py
from fastapi import FastAPI
from pydantic import BaseModel
from openai import OpenAI

app = FastAPI()
client = OpenAI()          # reads OPENAI_API_KEY from env

class Ask(BaseModel):
    question: str

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/ask")
def ask(body: Ask):
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": body.question}],
    )
    return {"answer": resp.choices[0].message.content}
```

## Dockerfile

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Dependencies first, so this layer is cached when only code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Don't run as root
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

`.dockerignore` keeps junk and secrets out of the image:

```
.env
.git
__pycache__/
.venv/
*.ipynb
```

```bash
docker build -t agent .
docker run --rm -p 8000:8000 --env-file .env agent
curl -X POST localhost:8000/ask -H "Content-Type: application/json" -d '{"question":"hi"}'
```

## GitHub Actions workflow

```yaml
# .github/workflows/deploy.yml
name: ci-cd
on:
  push:
    branches: [main]
  pull_request:

permissions:
  id-token: write        # for OIDC to AWS
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt pytest ruff
      - run: ruff check .
      - run: pytest -q
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}   # evals call the model

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ap-south-1
      - id: ecr
        uses: aws-actions/amazon-ecr-login@v2
      - name: Build and push
        run: |
          IMAGE=${{ steps.ecr.outputs.registry }}/agent:${{ github.sha }}
          docker build -t $IMAGE .
          docker push $IMAGE
      # Deploy step: e.g. update an App Runner service or an ECS service to the new tag
```

## Deploy targets on AWS

| Service | What it is | Good for |
|---|---|---|
| **App Runner** | Give it an image, get an HTTPS URL; autoscaling built in | Simplest container hosting |
| **ECS on Fargate** | Containers without managing servers; more control (VPC, sidecars) | Production services |
| **Lambda (container image)** | Functions, pay per request | Short, bursty requests; watch the timeout for long agent runs |
| **EC2** | A VM you manage | Full control, GPUs, self-hosted models |

Pass `OPENAI_API_KEY` to the running service from **Secrets Manager** (or SSM Parameter Store), not baked into the image.

## Best practices

- **Tag images with the git SHA**, not just `latest`, so you can roll back to an exact build.
- **Health check endpoint** so the platform restarts unhealthy containers.
- **Run evals in CI**, but keep a small, fast set for PRs and a bigger set nightly; evals cost tokens.
- **Use OIDC** (`role-to-assume`) instead of storing AWS access keys in GitHub.
- **Pin dependency versions** in `requirements.txt` so builds are reproducible.
- **Multi-stage builds** help when you compile dependencies; keep the final image slim.

## Key terms

- **Image** — a packaged, immutable filesystem plus start command; a **container** is a running instance of it.
- **Dockerfile** — the recipe for building an image.
- **Registry** — storage for images (ECR, Docker Hub, GHCR, Artifact Registry).
- **CI/CD** — continuous integration (test every change) and continuous delivery/deployment (ship it automatically).
- **OIDC** — lets GitHub Actions get short-lived cloud credentials without stored keys.
- **ECR / App Runner / ECS** — AWS's container registry, simple container host, and container orchestrator.

## Interview quick-fire

- **"Why containerize an LLM app?"** → Same environment everywhere, reproducible builds, and every cloud can run a container.
- **"Why copy requirements.txt before the code?"** → Layer caching: dependencies are reinstalled only when requirements change.
- **"How do you handle secrets in CI/CD?"** → GitHub secrets for CI, a cloud secret manager at runtime, OIDC for cloud auth; never in the image or repo.
- **"What belongs in an agent's CI?"** → Lint, unit tests, a fast eval set with a pass threshold, then build, push and deploy.
