# Trap Chat

Trap Chat is a real-time social and competitive video-chat app built for web, iOS, and Android with Expo. It combines browsable social rooms with ranked 1v1 games, live WebRTC video, Socket.IO messaging, and camera-counted fitness challenges.

- **Live app:** https://zealous-bay-02a100210.3.azurestaticapps.net
- **API health:** https://trap-chat-api.bluerock-306ed9db.centralus.azurecontainerapps.io/api/health

## Current product direction

Trap Chat has two connected experiences:

- **Social:** 1:1 chat, named group rooms, room discovery, live video, and messaging.
- **Competitive:** ranked 1v1 matchmaking for Push-Ups, Squats, Rap Battle, and Looks Battle.

The current development direction is to make complete matches trustworthy and resilient:

- Count push-ups and squats from MediaPipe pose landmarks in the browser.
- Validate submitted scores server-side and accept each result only once.
- Keep matchmaking, room presence, reconnects, and abandoned-room cleanup reliable.
- Verify each release with two independent browser clients—not two tabs sharing one identity.
- Build durable player profiles, ratings, recent-match history, and complete voting flows.
- Move persistent and shared state to managed PostgreSQL before scaling beyond one backend replica.

## Architecture

- **Client:** Expo + React Native Web + TypeScript
- **API:** Flask + SQLAlchemy + JWT/bearer auth
- **Realtime:** Flask-SocketIO + WebRTC signalling
- **Pose tracking:** MediaPipe loaded at runtime on web
- **Frontend hosting:** Azure Static Web Apps
- **Backend hosting:** Azure Container Apps (Consumption)
- **Current persistence:** SQLite on an Azure Files volume, constrained to one replica/worker
- **Infrastructure:** Terraform
- **Delivery:** GitHub Actions with separate frontend, backend, and infrastructure pipelines

All production resources currently run in **Central US**. Generated Azure hostnames are resolved by the deployment pipelines and must not be hardcoded in application source.

## Game catalog

### Competitive

- Push-Ups — camera-counted repetitions
- Squats — camera-counted repetitions
- Rap Battle — peer voting
- Looks Battle — peer voting

### Social

- 1:1 Chat
- Group Chat — named rooms with up to 20 participants

## Local verification

```bash
# Backend
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
PYTHONPATH=backend .venv/bin/python -m py_compile backend/app.py

# Frontend
cd frontend/expo
npm ci
npx tsc --noEmit
npm run build:web

# Terraform
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

Browser smoke suites also cover all navigation transitions, synthetic rep counting, and two-client ranked matchmaking.

## Delivery and operating rules

Read [AGENTS.md](AGENTS.md) before changing the repository. It records the authoritative deployment model, frontend/backend contracts, concurrency constraints, scoring rules, verification requirements, and lessons from production incidents.

Key rules:

- Fetch before editing and again before pushing; multiple agents contribute concurrently.
- Never force-push or overwrite another contributor's work.
- Push through GitHub Actions; do not deploy or apply infrastructure manually.
- Never trust browser-submitted scores without server validation.
- Do not call a release complete until the public frontend, API, authentication, two-client realtime path, one full game result, and durable leaderboard are verified.

See [DEPLOY_FINAL_URLS.md](DEPLOY_FINAL_URLS.md) for the latest verified Azure endpoints and release evidence.
