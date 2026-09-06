# Trap Chat — Azure Deployment

Verified 2026-09-06 UTC.

- Public frontend: https://zealous-bay-02a100210.3.azurestaticapps.net
- Public backend: https://trap-chat-api.bluerock-306ed9db.centralus.azurecontainerapps.io
- Health: https://trap-chat-api.bluerock-306ed9db.centralus.azurecontainerapps.io/api/health
- Games API: https://trap-chat-api.bluerock-306ed9db.centralus.azurecontainerapps.io/api/games
- Azure resource group: rg-trap-chat-prod
- Azure Container App: trap-chat-api
- Azure Static Web App: stapp-trap-chat-prod

## Verification evidence

- Frontend returned HTTP 200 and text/html.
- Backend health returned HTTP 200 with ok true and productionReadyStorage true.
- Games API returned HTTP 200 with the six-game catalog (4 competitive + 2 social).
- The deployed Expo bundle contains the Container Apps endpoint and contains neither the retired azurewebsites.net hostname nor localhost:5000.
- Two distinct guest clients joined match 1; retrying the first guest was idempotent; status transitioned from waiting to active with two players.
- Both clients established direct Socket.IO WebSocket transports, joined the match room, relayed an offer signal, and exchanged a chat message.
- Terraform plan/apply: https://github.com/ItMeansBigMountain/trap-chat/actions/runs/33987645112
- Backend build/deploy: https://github.com/ItMeansBigMountain/trap-chat/actions/runs/33987716882
- Frontend build/deploy: https://github.com/ItMeansBigMountain/trap-chat/actions/runs/33987716908

## Operations

The generated Container Apps FQDN must not be hardcoded in source. Frontend CD resolves it from Azure before each build. GitHub variables TRAP_CHAT_API_URL and TRAP_CHAT_SOCKET_URL are synchronized to the verified endpoint for tooling compatibility. Roll back the backend by updating the Container App through the backend GitHub Actions workflow to a previously published immutable commit image. Do not remove the legacy deployment until an authorized release review approves cleanup.
