# Claude Code and Hermes collaboration

This repository is the shared source of truth for Affan, Claude Code, and Hermes. It is intentionally asynchronous: Git commits, tests, pull requests, and this document carry decisions between agents. No agent should imply that another agent received a live message unless a real messaging integration returned a delivery receipt.

## Roles

- **Affan / Claude Code:** deepest day-to-day Trap Chat product context, feature implementation, and design iteration.
- **Hermes (software-developer):** independent codebase review, integration safety, tests/builds, Azure/Terraform and CI/CD, release verification, rollback evidence, and canonical Kanban updates.
- Neither agent overwrites the other's work. GitHub `main` is authoritative and may change concurrently.

## Shared operating rules

1. Fetch before editing and immediately before pushing.
2. Preserve dirty or diverged work. Never force-push, reset away, or broadly reformat another contributor's changes.
3. Treat the current stable app and its visual system as the baseline.
4. Put settled architecture and deployment decisions in `AGENTS.md`.
5. Put product/audience findings in `ICP.md`, native blockers in `MOBILE.md`, and capacity limits in `SCALING.md`.
6. Keep implementation claims evidence-based: cite code/tests, exact commands, commit SHA, and public URLs where relevant.
7. Azure changes remain Terraform-only and deploy through approval-gated GitHub Actions. Never deploy this project through Vercel or direct portal/CLI mutation.

## Handoff format

Use this compact block in a PR, commit body, or durable document when work crosses agents:

```text
Objective:
Changed:
Behavior/contracts:
Verified:
Public URLs:
Blockers/risks:
Rollback:
Next owner:
```

A handoff is complete only when the receiving agent can reproduce the result without private chat history.

## Current reviewed baseline

Hermes reviewed the fast-forward range `4598ef9..fc8772a` after Affan's September 6–7 work. The range added or hardened:

- Phone-first black-and-lime mode branding and navigation during matches.
- Competitive push-ups, squats, camera-scored Mog Off, and punch-counted Shadow Boxing.
- Room population, matchmaking queue visibility, cancel/rejoin behavior, ghost/lonely queue cleanup, and catch-up ladder notices.
- Report-and-block safety, profanity handling, persistent match clocks, operational metrics, and broader browser journeys.
- Azure deployment diagnostics and commit-aware verification.
- Explicit product, native migration, and scaling documents.

The baseline remains intentionally single-replica and web-first. TURN, managed Postgres/Redis migration, native camera/WebRTC/frame processing, account deletion, and store submission are separate future slices—not implied support.

## Claude Code setup

The project agent is `.claude/agents/trap-chat-steward.md`. In VS Code, open this repository at its root, start a new Claude Code session, and ask:

```text
Use the trap-chat-steward agent to review the current task and preserve the stable baseline.
```

Confirm configuration with `/context` (root `CLAUDE.md`) and by asking Claude to use `trap-chat-steward`. The agent uses local project memory so machine-specific learnings do not create noisy commits. Durable shared decisions still belong in the repository documents above.

## Sources for the setup

- Claude Code VS Code: https://code.claude.com/docs/en/vs-code
- Project memory and `CLAUDE.md`: https://code.claude.com/docs/en/memory
- Custom project subagents and memory: https://code.claude.com/docs/en/sub-agents
- Settings scopes: https://code.claude.com/docs/en/settings
- Cross-session messaging (Claude-to-Claude sessions only): https://code.claude.com/docs/en/cross-session-messaging
