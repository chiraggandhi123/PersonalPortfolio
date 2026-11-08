---
title: "CI/CD to AWS with Docker and GitHub Actions"
---

## TL;DR

Ship the chatbot so that **every push to `main` tests, builds and deploys it**. **Docker** packages `backend.py`, `app.py` and their dependencies into one image. **GitHub Actions** runs the tests, logs in to AWS with **OIDC** (no long-lived keys), pushes the image to **ECR**, then SSHes into an **EC2** instance to pull and restart the container. Secrets live in GitHub and on the server, never in the image.

## The pipeline

```
git push main
     │
     ▼
GitHub Actions ── job: test ──► pip install, pytest
     │
     └─ job: deploy (needs test)
          ├─ assume AWS role via OIDC
          ├─ docker build ─► push to ECR  (tag = commit SHA)
          └─ ssh EC2 ─► docker pull ─► docker run -p 80:8501
                                          │
                     users ──► http://EC2_PUBLIC_IP ──► Streamlit
```

## Files you add

```
agentic-chatbot/
├── backend.py, app.py
├── requirements.txt
├── Dockerfile
├── .dockerignore
├── tests/test_backend.py
└── .github/workflows/deploy.yml
```

## `requirements.txt`

```
langgraph
langgraph-checkpoint-sqlite
langchain-openai
langchain-tavily
langsmith
streamlit
python-dotenv
pytest
```

Pin exact versions (`pip freeze`) once everything works, so a library release can't break a deploy.

## `Dockerfile`

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend.py app.py ./

EXPOSE 8501
# ${PORT:-8501}: Render (next note) injects PORT; elsewhere default to 8501
CMD streamlit run app.py --server.port=${PORT:-8501} --server.address=0.0.0.0 --server.headless=true
```

Copying `requirements.txt` first means the slow `pip install` layer is cached until dependencies change.

`.dockerignore`:

```
.env
.venv
*.db
__pycache__
.git
```

Test locally:

```bash
docker build -t agentic-chatbot .
docker run --rm -p 8501:8501 --env-file .env \
  -v "$PWD/data:/data" -e CHATBOT_DB=/data/chatbot.db agentic-chatbot
```

The volume keeps `chatbot.db` outside the container, so threads survive container restarts. `CHATBOT_DB` is the env var `backend.py` has read since the persistence note.

## A smoke test — `tests/test_backend.py`

```python
import os

os.environ.setdefault("OPENAI_API_KEY", "test")       # clients need a key to construct
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ.setdefault("CHATBOT_DB", ":memory:")

import backend


def test_graph_has_expected_nodes():
    nodes = set(backend.chatbot.get_graph().nodes)
    assert {"chat_node", "tools"} <= nodes


def test_calculator():
    assert backend.calculator.invoke({"expression": "2 * (3 + 4)"}) == "14"
    assert backend.calculator.invoke({"expression": "__import__('os')"}).startswith("Error")
```

No real API calls, so CI is fast and free. Add evaluation runs against real models as a separate, manual workflow.

## One-time AWS setup

1. **ECR**: create a repository named `agentic-chatbot`.
2. **OIDC role for GitHub**: in IAM add the identity provider `token.actions.githubusercontent.com`, then a role whose trust policy allows your repo (`repo:YOUR_USER/agentic-chatbot:ref:refs/heads/main`) and whose permissions allow pushing to that ECR repo.
3. **EC2**: launch a small Amazon Linux instance, install Docker, attach an **instance role** with ECR read access, open ports 22 (your IP only) and 80 in the security group.
4. **App secrets on the server**: create `/home/ec2-user/.env` with `OPENAI_API_KEY`, `TAVILY_API_KEY`, `LANGSMITH_*`.
5. **GitHub secrets**: `AWS_ROLE_ARN`, `EC2_HOST`, `EC2_SSH_KEY` (the instance's private key).

## `.github/workflows/deploy.yml`

```yaml
name: test-build-deploy
on:
  push:
    branches: [main]

env:
  AWS_REGION: ap-south-1
  ECR_REPOSITORY: agentic-chatbot

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt
      - run: pytest -q

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write          # required for OIDC
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push
        env:
          IMAGE: ${{ steps.ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}
        run: |
          docker build -t $IMAGE:${{ github.sha }} -t $IMAGE:latest .
          docker push --all-tags $IMAGE

      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ec2-user
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            REGISTRY=${{ steps.ecr.outputs.registry }}
            IMAGE=$REGISTRY/${{ env.ECR_REPOSITORY }}:${{ github.sha }}
            aws ecr get-login-password --region ${{ env.AWS_REGION }} | docker login --username AWS --password-stdin $REGISTRY
            docker pull $IMAGE
            docker rm -f chatbot || true
            docker run -d --name chatbot --restart unless-stopped -p 80:8501 \
              --env-file /home/ec2-user/.env \
              -v /home/ec2-user/data:/data -e CHATBOT_DB=/data/chatbot.db \
              $IMAGE
            docker image prune -f
```

Tagging with the commit SHA makes rollback simple: rerun `docker run` with an older tag.

## Hardening for real use

- **HTTPS**: put the instance behind an Application Load Balancer with an ACM certificate, or run Caddy/Nginx as a reverse proxy.
- **No SSH deploys**: use AWS SSM Run Command, or move to **ECS Fargate** / **App Runner** and let the service pull new images.
- **Secrets**: AWS Secrets Manager or SSM Parameter Store instead of a `.env` file on disk.
- **Postgres** (RDS) instead of SQLite once you run more than one container.
- **Health check**: Streamlit serves `/_stcore/health`; point the load balancer at it.

## Gotchas

- **Missing `id-token: write`** makes the OIDC step fail with a credentials error.
- **Image runs locally but not on EC2**: building on an ARM Mac produces an ARM image. CI builds on x86, so match the EC2 architecture or use `docker buildx --platform`.
- **Port confusion**: Streamlit listens on 8501 inside the container; `-p 80:8501` maps it to port 80 on the host.
- **Secrets in the image**: if `.env` is copied in, anyone with the image has your keys. `.dockerignore` it.
- **Streamlit needs WebSockets**: proxies and load balancers must allow them, or the page loads but never updates.

## Key terms

- **Docker image** — a packaged filesystem with your app and its dependencies.
- **ECR** — Elastic Container Registry, AWS's private Docker image registry.
- **EC2** — a virtual machine on AWS.
- **GitHub Actions** — CI/CD workflows defined in YAML and triggered by repo events.
- **OIDC** — lets GitHub Actions assume an AWS role with short-lived credentials instead of stored keys.
- **CI/CD** — automatically testing (CI) and releasing (CD) every change.

## Interview quick-fire

- **"Walk me through deploying an LLM app with CI/CD."** → Push triggers tests; on success, build a Docker image, push it to a registry tagged with the commit SHA, then have the server or service pull and restart with secrets from the environment.
- **"Why OIDC instead of AWS access keys in GitHub secrets?"** → Short-lived credentials scoped to one repo and branch; nothing long-lived to leak or rotate.
- **"How do you keep API keys out of the image?"** → `.dockerignore` the `.env`, and inject keys at run time via env files, a secrets manager, or the platform's settings.
- **"How do you roll back a bad deploy?"** → Redeploy the previous image tag; tagging by commit SHA makes every version addressable.
