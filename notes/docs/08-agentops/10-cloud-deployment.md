---
title: "Cloud Deployment (GCP / Azure)"
---

## TL;DR

Once the agent is a container, every big cloud can run it. The easiest path on each is a **serverless container service**: **Cloud Run** on GCP, **Azure Container Apps** on Azure, **App Runner / ECS Fargate** on AWS. They give you HTTPS, autoscaling (often **to zero**), and pay-per-use. Add the cloud's **secret manager**, **managed identity / service accounts** instead of keys, and its **logging**. Consider the cloud's own model endpoints (**Vertex AI / Gemini**, **Azure OpenAI**, **Bedrock**) when data residency or enterprise contracts matter.

## Picking a service

| Need | GCP | Azure | AWS |
|---|---|---|---|
| Run a container behind HTTPS, scale to zero | **Cloud Run** | **Container Apps** | App Runner |
| Full Kubernetes | GKE | AKS | EKS |
| Functions | Cloud Run functions | Azure Functions | Lambda |
| Managed agent hosting | Vertex AI Agent Engine | Azure AI Foundry Agent Service | Bedrock AgentCore |
| Hosted models | Vertex AI (Gemini, partner models) | Azure OpenAI / Foundry models | Bedrock |
| Secrets | Secret Manager | Key Vault | Secrets Manager |
| Logs / traces | Cloud Logging / Trace | Azure Monitor / App Insights | CloudWatch / X-Ray |

Managed agent services and their names change often; check current docs. For most projects, a container on Cloud Run or Container Apps is the simplest, most portable choice.

```
            Docker image (same everywhere)
          ┌───────────┼─────────────┐
          ▼           ▼             ▼
      Cloud Run   Container Apps   App Runner
          │           │             │
     Secret Manager  Key Vault   Secrets Manager
```

## GCP: Cloud Run

```bash
gcloud auth login
gcloud config set project MY_PROJECT

# store the key once
printf "sk-..." | gcloud secrets create openai-key --data-file=-

# build from source (uses your Dockerfile) and deploy
gcloud run deploy my-agent \
  --source . \
  --region asia-south1 \
  --set-secrets OPENAI_API_KEY=openai-key:latest \
  --allow-unauthenticated \
  --timeout 300 \
  --memory 1Gi
```

- Cloud Run sets `PORT` (default 8080); listen on it.
- `--allow-unauthenticated` makes it public; drop it and use IAM for internal services.
- The service's **service account** needs the Secret Manager accessor role.
- Scales to zero by default; set `--min-instances 1` to avoid cold starts (costs money).
- Google ADK has `adk deploy cloud_run` to package and deploy an ADK agent in one command.

## Azure: Container Apps

```bash
az login
az group create --name agent-rg --location centralindia

# builds the image (via ACR) and creates the app + environment
az containerapp up \
  --name my-agent \
  --resource-group agent-rg \
  --location centralindia \
  --source . \
  --ingress external \
  --target-port 8000

# add a secret and expose it as an env var
az containerapp secret set -n my-agent -g agent-rg --secrets openai-key=sk-...
az containerapp update -n my-agent -g agent-rg \
  --set-env-vars OPENAI_API_KEY=secretref:openai-key
```

For production, reference secrets from **Key Vault** with a **managed identity** instead of pasting values.

## Using the cloud's own models

Switching to Azure OpenAI is mostly a client change:

```python
import os
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],   # https://NAME.openai.azure.com
    api_key=os.environ["AZURE_OPENAI_API_KEY"],           # or Entra ID token provider
    api_version=os.environ["AZURE_OPENAI_API_VERSION"],
)
resp = client.chat.completions.create(
    model="gpt-4o-mini",          # on Azure this is your *deployment name*
    messages=[{"role": "user", "content": "Hello from Azure"}],
)
```

On GCP, use the `google-genai` SDK with `vertexai=True` to call Gemini through Vertex AI. On AWS, use Bedrock's `converse` API via `boto3`. A provider-agnostic client like LiteLLM can hide these differences.

## Production concerns

- **Identity over keys** — service accounts (GCP) and managed identities (Azure) let your app call other cloud services without stored credentials.
- **Timeouts** — agent runs can take a minute or more; raise request timeouts, stream, or move long work to a queue + worker (Pub/Sub, Service Bus, SQS).
- **Concurrency** — each instance handles several requests; agents are I/O-bound, so async code and higher concurrency per instance save money.
- **Region** — deploy near your users and your model endpoint; some models are only available in some regions.
- **Cost control** — set max instances and budget alerts; a runaway loop scales up as happily as real traffic.
- **Infrastructure as code** — once it works, capture it in Terraform, Bicep or Pulumi.

## Key terms

- **Serverless containers** — run an image without managing servers; platform handles scaling and HTTPS.
- **Scale to zero** — no instances (and no compute cost) when there's no traffic.
- **Service account / managed identity** — an identity for your app, used to access cloud resources without keys.
- **Deployment name (Azure OpenAI)** — the name you give a model deployment; used as `model` in API calls.
- **IaC** — infrastructure as code: Terraform, Bicep, Pulumi, CloudFormation.

## Interview quick-fire

- **"Simplest way to host a containerized agent on GCP / Azure?"** → Cloud Run on GCP, Azure Container Apps on Azure.
- **"How should a Cloud Run service get its API key?"** → From Secret Manager, mounted as an env var, with the service account granted access.
- **"Why use Azure OpenAI or Vertex instead of the public APIs?"** → Enterprise contracts, data residency, private networking and unified billing/IAM with the rest of the cloud.
- **"What breaks when moving a long agent run to serverless?"** → Request timeouts and cold starts; stream or offload long work to a queue.
