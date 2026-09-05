# Trap Chat

Project working agreements, deployment model, Azure architecture decisions,
and known gotchas are documented in [AGENTS.md](AGENTS.md). Read that file
before making changes.

Key points, in short:

- **Push to deploy.** No manual deployments, no manual applies, no portal
  clicking. The only human step is approving the infrastructure plan.
- **Three pipelines, one per component:** `frontend CICD`, `backend CICD`,
  `infra CICD`. Each does test, build, and deploy for its own component.
- **Backend runs on Azure Container Apps, not App Service.** The
  subscription has zero App Service Plan quota on both B1 and F1.
- **Never publish a guessed backend hostname** into the frontend; it is
  resolved from Azure at build time.
- **Everything is in Central US** and inherits the resource group's region.
- **Auth cannot rely on cookies**; they are third-party on this deployment.
  Bearer token for users, `X-Guest-Session` for guests.
- Multiple agents work here concurrently. Never force-push or overwrite work
  you did not write.
