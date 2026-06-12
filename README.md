# AI-Factory

A self-contained, autonomous AI software factory for Claude Code: idea → roadmap → parallel implementation → verification → PR → deploy → monitored release. Assembled 2026-06-12 from the best actively-maintained agent toolkits (full provenance and rejection rationale in [docs/SOURCES.md](docs/SOURCES.md)).

## What's inside

| Layer | Source | What it does |
|---|---|---|
| **Orchestration** — 69 `/gsd:*` commands, 33 agents | [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) `3e836fe` | Roadmap → discuss → plan → execute (parallel waves) → verify, with autonomous mode and file-based state in `.planning/` |
| **Discipline** — 9 skills | [obra/superpowers](https://github.com/obra/superpowers) `6fd4507` (v5.1.0) | Enforced TDD, root-cause debugging, verification gates, two-stage code review, worktree hygiene |
| **Ship & QA** — 50 skills | [tobihagemann/turbo](https://github.com/tobihagemann/turbo) `e5e55de` | Polish loop, audit, threat model, smoke/exploratory testing, dependency upkeep, full PR lifecycle (create/review/resolve/reply), changelog |
| **Product, plan review & design** — 13 skills | [garrytan/gstack](https://github.com/garrytan/gstack) `a5833c4` (v1.57.10) | `autoplan` multi-persona plan review (CEO/eng/design/DX), design system consultation + visual QA + HTML generation, `cso` security mode, doc generation, `health` dashboard, `office-hours` product interrogation |
| **DevOps** — 4 custom skills | authored here | `fix-ci`, `deploy`, `release`, `post-deploy-monitor` |

Rejected: get-shit-done (archived — gsd-core is its successor), pulumi/agent-skills (Pulumi-locked; reference only), awesome-agent-skills (catalog, snapshot in [docs/reference/skill-catalog.md](docs/reference/skill-catalog.md)).

## The pipeline

```
 idea ─► office-hours              product strategy interrogation (optional)
      ─► /gsd:new-project          roadmap, requirements, phased plan (.planning/)
      ─► /gsd:plan-phase           research → plan → machine-verified plan
      ─► autoplan                  CEO → design → eng → DX plan review, auto-decided
      ─► design-consultation       design system (UI products) → design-html
      ─► /gsd:execute-phase        parallel agent waves · TDD + debugging discipline
      ─► /gsd:verify-work          + audit / review-code / smoke-test / cso / design-review
      ─► finalize → ship           polish loop → commit → push → PR → review → resolve
      ─► document-release          docs updated to match what shipped
      ─► fix-ci → deploy → release CI green → platform deploy → semver + GitHub release
      ─► post-deploy-monitor       canary window → healthy, or rollback + investigate
```

Fully hands-off: `/gsd:autonomous` runs every remaining phase end to end.

## Quickstart

```bash
# 1. Scaffold a product workspace (own git repo + a copy of the kit; --github also creates the remote)
scripts/new-product.sh my-product --github

# 2. Start building
cd products/my-product && claude
> /gsd:new-project        # interactive: questions → requirements → roadmap
> /gsd:autonomous         # ...or phase by phase: /gsd:plan-phase → /gsd:execute-phase
```

## Remote control via Telegram

Send product ideas from your phone; the factory scaffolds the workspace, creates the GitHub repo, and runs the autonomous build — pinging you at each phase.

```bash
# one-time setup
# 1. Telegram: talk to @BotFather → /newbot → copy the token
export TELEGRAM_BOT_TOKEN=123456:ABC...
# 2. preflight
node daemon/factory-daemon.mjs --check
# 3. run it
node daemon/factory-daemon.mjs
# 4. message your bot /start, copy your chat id into daemon/config.json → allowedChatIds, restart
```

Then any plain message to the bot is treated as a product idea: workspace → repo under `githubOwner` (daemon/config.json) → headless `claude` build using [daemon/build-prompt.md](daemon/build-prompt.md) (assumptions logged to `.planning/ASSUMPTIONS.md`, no paid deploys, FINAL-REPORT.md at the end). `/status` returns the progress of every product. Builds queue at `concurrency` (default 1). Logs land in `daemon/logs/<product>.log`.

> Heads-up: headless builds run with `--permission-mode bypassPermissions` inside the product workspace (configurable in daemon/config.json) — that's what makes them autonomous. Keep the bot token private and the allowlist tight.
>
> WhatsApp: possible via Meta's Cloud API or Twilio, but needs business verification and a public webhook; the daemon's transport is isolated enough to add it as a second adapter later.

## Dashboard

`node scripts/build-dashboard.mjs` scans every product's `.planning/` state and writes [dashboard/index.html](dashboard/index.html) — per-product progress bars, phase checklists, current activity, version, and repo links (plus `dashboard/data.json` for tooling). Open it locally (`open dashboard/index.html`), or set `pushDashboard: true` in daemon/config.json to auto-commit it and serve via GitHub Pages (repo Settings → Pages → main branch). The daemon regenerates it on every phase change; it self-refreshes every 60 s.

## Continuous monitoring

Two layers, deliberately: **cheap sensors, smart responder**. No always-on AI agent per product — that would burn tokens doing what an HTTP check does for free.

1. **Watchdog (free, continuous):** the daemon checks every product that has a `DEPLOY.json` (written automatically by the `deploy` skill) every 5 minutes — status, latency. After 3 consecutive failures you get one 🔴 Telegram alert (and one 🟢 on recovery); health badges appear on the dashboard. `/health` in chat shows live status. Standalone pass without the daemon: `node scripts/monitor.mjs` (cron-able).
2. **Incident agent (on-demand, only when something breaks):** with `monitor.autoIncident: true` in daemon/config.json, a down transition dispatches a headless `claude` agent into that product with [daemon/incident-prompt.md](daemon/incident-prompt.md): diagnose with evidence, roll back only if the failure is deploy-correlated and the platform supports it, write `INCIDENT-*.md` to the repo — never code fixes (those go through the normal pipeline). One dispatch per `incidentCooldownMinutes` to prevent spawn loops. Default off: alerts-only until you've watched it work.

The `post-deploy-monitor` skill remains the third piece: the intensive ~10-minute canary window right after each deploy, inside the build session.

## Customer handoff & re-engagement

Each product lives in its own repo precisely so it can be sold as a unit. When payment clears, run the `handoff-product` skill in the product workspace: full-history secrets scan → factory kit stripped from HEAD (`.claude/`, CLAUDE.md — the `.planning/` audit trail stays, it's part of the deliverable) → local mirror archived under `archives/` (you lose the repo on transfer) → `v1.0-handoff` tag → GitHub repo transfer to the customer, who must accept it. Handoffs are logged in `docs/HANDOFFS.md`.

If the customer later wants more work done on the repo they now own: they add you as a collaborator, then `scripts/adopt-product.sh <their-git-url>` clones it into `products/` and overlays the factory kit **locally only** — registered in `.git/info/exclude`, so the tooling can never be committed to their repo. Run `/gsd:import` to map the codebase and rebuild planning state, work on branches, deliver via PRs. The product reappears on the dashboard automatically.

## Requirements

- **Required:** Claude Code, `git`, [GitHub CLI](https://cli.github.com) (`gh`) — PR and CI skills depend on it
- **Optional:** OpenAI Codex CLI (enables `peer-review` second-model review; skills fall back without it), a browser tool for `smoke-test`/`exploratory-test` (APIs fall back to `curl`), a global [gstack](https://github.com/garrytan/gstack) install (enables config/telemetry/learnings and the browse daemon in the gstack-layer skills; they degrade to defaults without it)
- GSD's optional runtime hooks (update checker, context monitor) are not installed; add with `npx @opengsd/gsd-core@latest --claude --local` if wanted (Node ≥ 22)

## Updating imports

Sources are pinned by commit in [docs/SOURCES.md](docs/SOURCES.md). To refresh: re-clone a source, re-apply the path rewrites documented there (global → project-local), and re-run the verification in that doc. Skills added later should follow `writing-skills` (test the skill against an agent before trusting it).

## Layout

```
.claude/commands/gsd/    GSD command surface          CLAUDE.md   factory operating manual
.claude/agents/          GSD subagent definitions     docs/       provenance, templates, catalog
.claude/gsd-core/        GSD workflows/references     scripts/    new-product.sh
.claude/skills/          76 skills (all layers)       products/   product workspaces (gitignored)
```
