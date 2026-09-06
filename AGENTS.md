# Trap Chat — working agreements for agents

Read this before changing anything. It records decisions that are already
settled, so they do not get re-litigated or accidentally reverted.

Multiple agents work on this repo concurrently. **Never force-push, revert,
or broadly reformat work you did not write.** Always `git fetch origin` and
re-check for divergence immediately before pushing.

## Current deployment

| What | Value |
|---|---|
| Frontend | https://zealous-bay-02a100210.3.azurestaticapps.net |
| Backend | https://trap-chat-api.bluerock-306ed9db.centralus.azurecontainerapps.io |
| Health | `/api/health` |
| Subscription | `4f070006-f5e7-471d-a859-b15a2a8ee406` (oyamaProductions) |
| Resource group | `rg-trap-chat-prod` (Central US) |
| Container App | `trap-chat-api` in env `cae-trap-chat-prod` |
| Static Web App | `stapp-trap-chat-prod` |
| Durable storage | Azure Files share `trapchat-data` on `trpchat4f070006f5`, mounted at `/data` |

Both hostnames contain generated segments and change whenever the
resource is recreated, as the Central US move proved. Never hardcode
either one: the frontend build reads the backend FQDN from Azure, and
Terraform reads the frontend hostname off the Static Web App resource.

## Delivery model: push to deploy

There are **no manual deployments and no manual applies**. Nothing is
created by hand in the Azure Portal, and no one is expected to click "Run
workflow" as part of normal operation. You ship a change by pushing it.

The single exception is the infrastructure **approval gate** described
below, which is a review step, not a manual deployment step.

## Three pipelines, one per component, two stages each

Pipelines are organised by component, not by stage. Each has exactly two
jobs so a run shows two bubbles, and the second waits on a manual approval.

| Pipeline | File | Stage 1 | Stage 2 (gated) |
|---|---|---|---|
| `frontend CICD` | `.github/workflows/frontend-cicd.yml` | Build: typecheck, web export, upload bundle | Deploy: publish that bundle to Static Web Apps, verify |
| `backend CICD` | `.github/workflows/backend-cicd.yml` | Build: pytest, build image, push to GHCR | Deploy: roll out to Container Apps, verify health |
| `infra CICD` | `.github/workflows/infra-cicd.yml` | Plan: fmt, validate, plan into the run summary | Apply: apply the reviewed plan |

The frontend deploy publishes the **artifact the build produced**, so
approving ships exactly what was reviewed rather than rebuilding.

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

## The approval gates

Every pipeline's second stage waits on a GitHub Environment. Each of these
must have at least one **Required Reviewer** under Settings → Environments:

| Environment | Gates |
|---|---|
| `infra-prod-apply` | `infra CICD` → Apply |
| `backend-prod` | `backend CICD` → Deploy |
| `frontend-prod` | `frontend CICD` → Deploy |

GitHub auto-creates an environment on first use with **no** protection
rules, so if that one-time setup is missing the stage runs unattended. If a
deploy ever runs without prompting you, the environment protection is not
configured. Do not add reviewers to `infra-prod`: that is the plan stage,
and gating it would mean approving a plan before you can read it.

Always read the plan for destroys before approving an apply.

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
- **Vercel is not used for this project at all.** The Vercel configs and the
  `backend/api/index.py` serverless entrypoint were removed. Do not
  reintroduce them or add `VERCEL` environment branches to the backend.

## Everything lives in Central US

All resources sit in `centralus`, and every resource inherits the resource
group's location. Do not reintroduce a separate `location` variable: the
Static Web App used to read one independently, which is how the frontend
ended up in East US 2 while the backend sat in East US.

Region is a force-new property, so changing it destroys and recreates
everything, which wipes the Azure Files share and issues brand new
hostnames. If you ever have to do it again: back up
`trapchat.db` off the share first, and expect two transient failures that
clear on a re-run, a provider inconsistency recreating the Static Web App
and a 404 reading storage keys under a just-released account name.

## Frontend and backend contracts

These break silently: nothing fails to compile, the UI just renders
undefined or a handler never fires. `backend/tests/test_api_contracts.py`
guards them.

- **CORS must always negotiate credentials.** The frontend sends every
  request with `credentials: 'include'`, and a browser discards the response
  unless `Access-Control-Allow-Credentials` is true. The backend enables
  `supports_credentials` whether or not `FRONTEND_ORIGIN` is pinned;
  without it the whole UI fails against a local backend.
- **Socket event names must match exactly.** The backend relays game moves
  back out on `game_action`, not `game_state`. A listener on the wrong name
  is silent, not an error.
- **Match players are objects, not strings.** `/api/matches/quick` returns
  `players: [{display_name}]` to match the `MatchmakingResponse` interface
  and the `player_joined` event.
- **Auth cannot depend on cookies.** The frontend and backend are on
  different sites, so every cookie the backend sets is a third-party cookie:
  Chrome incognito drops it outright, which made guests fail with
  `401 guest session required`. Login and register return the JWT in the
  body, the client stores it and sends `Authorization: Bearer`, guests send
  `X-Guest-Session`, and the socket passes both in its handshake `auth`
  payload. Cookies remain only as a same-site convenience.
- **The socket's identity is fixed at handshake time.** It is captured on
  connect and kept in `SOCKET_IDENTITIES`, so the client must reconnect
  after every auth transition or the socket stays anonymous and every
  `join_match` is rejected.
- **Two tabs of one browser are one player.** They share a cookie jar and
  localStorage, so signing in as a guest twice gives you the same guest.
  Test with two separate browsers, or one normal window and one incognito.

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

## Matchmaking, and why it kept breaking

Two players stuck on Searching has been the most persistent bug in this
project. Every cause was different, so check these before assuming a new one:

- **Every path that adds a player must end at `start_if_ready`.** The path
  that hands back a match you are already in once skipped it, so a complete
  pair sat on `waiting` and nobody was ever told to start.
- **Only count players who are present.** Counting people who had left made
  a room holding one live player and one ghost look full.
- **A dropped socket is not a decision to leave.** Socket.IO reconnects on
  any blip and a backgrounded tab is cut off, so treating a disconnect as
  leaving pulled players out of their own queue. A disconnect only settles a
  match that is already **active**; an abandoned queue is handled by
  `QUEUE_TIMEOUT_MINUTES`.
- **A reconnect must re-join the room.** Room membership is per socket
  session and a reconnect gets a new one, so `match_start` was broadcast to a
  room the client had silently dropped out of. The client remembers the match
  it belongs in and re-joins on every connect.
- **Reading the queue and writing to it is serialised** by
  `MATCHMAKING_LOCK`, or two callers arriving together both find it empty and
  both open a match nobody else can see.

Asking to queue again is also the recovery path: it returns an
already-started match, so missing the `match_start` broadcast is survivable.

## Gameplay and scoring

- **Reps are counted in the player's browser** from MediaPipe pose landmarks.
  The counting rules live in `frontend/expo/src/services/repCounter.ts` with
  no camera or MediaPipe dependency, so they can be driven with synthetic
  joints. A rep is the full travel down and back up, counted on the way up.
  Separate down and up thresholds give hysteresis; a single threshold turns
  pose noise into dozens of reps. The descent must also take time, which is
  what stops jitter counting.
- **MediaPipe is loaded from a CDN at runtime, never bundled.** Its package
  ships a dynamic import Metro cannot parse, which fails the whole web build.
- **The server does not trust a submitted score.** Counting happens in a
  browser, so anything there can be edited. `validate_result` rejects
  negatives, non-numbers, and rep counts beyond two a second for the round.
  A result can be submitted once: both results are broadcast when a match
  ends, so a second submission would let someone see the opponent's number
  and then beat it.
- **Login and registration are rate limited** per caller, in memory. That
  holds while the backend is one replica; more than one needs shared storage
  for it to be a real limit.

## Testing

Unit tests and both smoke suites run before anything ships, and the suites
run again against the live deployment.

| Suite | What it covers |
|---|---|
| `backend/tests/` | Backend logic, 49 tests |
| `frontend/expo/e2e/rep_counter.py` | Counting rules, driven in a browser with synthetic joints |
| `frontend/expo/e2e/smoke.py` | Every navigation path, all 20 ordered page transitions |
| `frontend/expo/e2e/ranked_match.py` | Two browsers queueing into one ranked match |
| `backend/e2e/api_smoke.py` | The deployed HTTP surface end to end |

`api_smoke.py` takes `--include-scoring`, which is used only in the build
stage. Submitting a score writes a permanent leaderboard row, so running it
against production would add a test account to the ladder on every deploy.

Tests share one imported app module and therefore one database, so
`backend/tests/conftest.py` resets the rate limiter and clears the queue
between tests. Without that, matchmaking assertions fail only when the whole
suite runs.

**A deploy is proven, not assumed.** The image is stamped with the commit it
was built from, `/api/health` reports it as `version`, and the pipeline waits
until the version being served matches the one it just pushed. Without that
the tests ran against the revision that was already serving, and a run of the
previous build reported the new one as broken.

**HTTP 200 is not a working app.** The post-deployment suites exist because
the site once returned 200 while pointing at a test backend.

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
PYTHONPATH=backend python -m py_compile backend/app.py

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
