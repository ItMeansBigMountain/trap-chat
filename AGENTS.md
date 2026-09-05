# Trap Chat — working agreements for agents

Read this before changing anything. It records decisions that are already
settled, so they do not get re-litigated or accidentally reverted.

Multiple agents work on this repo concurrently. **Never force-push, revert,
or broadly reformat work you did not write.** Always `git fetch origin` and
re-check for divergence immediately before pushing.

## Delivery model: push to deploy

There are **no manual deployments and no manual applies**. Nothing is
created by hand in the Azure Portal, and no one is expected to click "Run
workflow" as part of normal operation. You ship a change by pushing it.

The single exception is the infrastructure **approval gate** described
below, which is a review step, not a manual deployment step.

## Three pipelines, one per component

Pipelines are organised by component, not by stage. Builds are not
artifacted between pipelines, so each pipeline does the whole job for its
component: test, build, and deploy in one workflow.

| Pipeline | File | Triggered by | Does |
|---|---|---|---|
| `frontend CICD` | `.github/workflows/frontend-cicd.yml` | push/PR touching `frontend/expo/**`, or a successful `infra CICD` | typecheck, web export, deploy to Static Web Apps, verify |
| `backend CICD` | `.github/workflows/backend-cicd.yml` | push/PR touching `backend/**`, or a successful `infra CICD` | pytest, build image, push to GHCR, roll out to Container Apps, verify health |
| `infra CICD` | `.github/workflows/infra-cicd.yml` | push/PR touching `infra/terraform/**` | fmt, validate, plan, **approval gate**, apply |

Rules that follow from this shape:

- **Pull requests never deploy.** Deploy steps are guarded with
  `if: github.event_name != 'pull_request'`. PRs run tests and builds only.
- **A successful `infra CICD` run re-triggers both app pipelines** via
  `workflow_run`, so newly created infrastructure immediately receives the
  current image and a frontend built against the real backend URL. If you
  rename a workflow, fix the `workflow_run.workflows` reference too.
- **Each pipeline keeps its own `concurrency` group.** Do not give them a
  shared group to serialise them. GitHub allows only one running plus one
  pending run per group and **cancels** the rest, so a push that starts all
  three pipelines loses two of them outright. This was tried and reverted.
- **Both `infra CICD` and `backend CICD` modify the same Container App**,
  and Azure rejects a second concurrent modification with
  `409 ContainerAppOperationInProgress`. Each therefore polls
  `provisioningState` and waits for the in-flight operation to drain before
  touching `trap-chat-api`. Keep those waits.

## The infra approval gate

`infra CICD` is split into two jobs: `plan` runs automatically on every
infra change and renders the full plan into the run summary; `apply` then
waits for a human to approve it, and applies the exact reviewed plan file
rather than re-planning.

The gate is enforced by the GitHub Environment **`infra-prod-apply`**, which
must have at least one Required Reviewer configured under
Settings → Environments. GitHub auto-creates an environment on first use
with **no** protection rules, so if that setup is missing the apply runs
unattended. If you ever see apply run without a prompt, the environment
protection is not configured.

Always read the plan for destroys before approving.

## Azure architecture and why

- **Backend runs on Azure Container Apps (Consumption), not App Service.**
  This is not a preference, it is forced. This subscription has a hard
  quota of zero for App Service Plans, on both `B1` and `F1`:
  `Current Limit (F1 VMs): 0 / Amount required: 1`. Do not "fix" a
  deployment failure by switching App Service SKUs. That path is closed
  until the subscription owner obtains a quota increase.
- **Durable storage is an Azure Files share mounted into the container**
  at `/data`, holding the SQLite database. This is what makes scores and
  accounts survive restarts and redeploys. The container filesystem alone
  is ephemeral.
- **The Container App runs a single replica.** SQLite over a network file
  share is only safe with one writer, and Socket.IO keeps room and match
  state in process memory. Do not raise `max_replicas` without first
  moving that state out of process and off SQLite.
- **The Azure Files volume is mounted `nobrl`.** SQLite coordinates writers
  with POSIX byte-range locks, which Azure Files over SMB does not implement
  reliably; without `nobrl` every write fails with `database is locked` and
  the Gunicorn worker dies before binding a port. This is only safe because
  there is exactly one replica running one worker. Raising either without
  first moving off SQLite risks database corruption, not just contention.
- **Terraform seeds the initial container image; `backend CICD` owns
  rollouts.** The image is under `lifecycle.ignore_changes`, so an infra
  apply will not reset the running container to `var.backend_image` and
  silently undo the most recent application deploy.
- **The backend image is a public GHCR image**
  (`ghcr.io/itmeansbigmountain/trap-chat-backend`), pulled anonymously, so
  no registry credential is stored in Terraform state.
- **Frontend stays on the existing Azure Static Web App.** Do not delete or
  replace it. Private DNS is out of scope.

## Deployment semantics you must not break

- **Azure never re-pulls a mutable tag.** Pushing a new
  `:latest` to the registry does not change what a running Container App
  serves. Every deploy must roll out an **immutable per-commit SHA tag**
  via `az containerapp update --image ...:${{ github.sha }}`. Without that
  step, code changes silently never reach production.
- **Never publish a guessed backend hostname into the frontend.** The
  Container Apps FQDN is dynamic (`*.azurecontainerapps.io`) and is not
  knowable before apply. The frontend pipeline reads it from Azure at build
  time with `az containerapp show`. Do not replace this with a hardcoded
  URL or a hand-set repo variable.

## Secrets

- Never commit secrets, and never print secret values into logs or terminal
  output. That includes `SECRET_KEY`, storage keys, Azure credentials, and
  GitHub tokens.
- `SECRET_KEY` is generated by Terraform (`random_password`) and delivered
  to the container as a Container App secret. It is never in the repo.
- Do not extract credentials out of the local git credential helper.

## Definition of done

A green pipeline is not a finished feature. Do not claim completion because
the frontend returns HTTP 200. Completion requires:

- Backend `/api/health` returns 200 publicly and reports durable storage.
- Frontend bundle points at the verified backend URL.
- Register, login, session restore, logout, and guest mode work in a browser.
- Two browser clients match together, both establish authorised Socket.IO
  connections, and chat plus WebRTC signalling relay between them.
- Unauthorised clients cannot join or inject match events.
- At least one full game reaches a result screen, and scores still appear in
  the leaderboard after a redeploy.

Remove or disable non-functional controls. Do not present placeholders as
finished features.

## Local verification

```bash
# backend
python -m venv .venv && source .venv/Scripts/activate   # or bin/activate
pip install -r backend/requirements.txt pytest
PYTHONPATH=backend python -m pytest backend/tests -q
PYTHONPATH=backend python -m py_compile backend/app.py backend/api/index.py

# frontend
cd frontend/expo && npm ci && npx tsc --noEmit && npm run build:web

# terraform
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

## Known gotchas

- **`Microsoft.App` must be registered** on the subscription or the
  Container Apps environment fails to create. Already registered, but check
  with `az provider show --namespace Microsoft.App --query registrationState`
  if environment creation fails.
- **Azure tag keys are case-insensitive and must be unique.** A tags map
  containing both `environment` and `Environment` is rejected with
  `Duplicate tag key 'environment' found (case-insensitive)`.
- Storage account and registry names are globally unique across Azure.
- The Terraform state backend is a separate storage account
  (`cwbtfstate4f070006f5`). A normal user login has no data-plane access to
  it, so Terraform can only run from the pipeline, not from a laptop.
