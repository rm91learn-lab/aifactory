# AI-Factory — Operating Manual

This repository is an autonomous AI software factory: a curated, self-contained Claude Code toolkit that takes a product from idea to deployed software. Products are built in `products/<name>/` workspaces (scaffolded by `scripts/new-product.sh`), each carrying a copy of this kit.

## Pipeline and stage ownership

Three imported systems plus custom DevOps skills, each owning a distinct stage. Do not mix planning systems.

| Stage | Owner | Entry points |
|---|---|---|
| Product strategy | gstack | `office-hours` (YC-style product interrogation) |
| Project setup & roadmap | GSD | `/gsd:new-project`, `/gsd:new-milestone` |
| Phase planning | GSD | `/gsd:discuss-phase` → `/gsd:plan-phase` |
| Plan review | gstack | `autoplan` (auto-runs CEO → design → eng → DX reviews), or individually `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `plan-devex-review` |
| Design | gstack | `design-consultation` (design system), `design-html`, `design-review` (visual QA) |
| Implementation | GSD orchestration + superpowers discipline | `/gsd:execute-phase` (or `/gsd:autonomous`) |
| Verification | GSD + turbo QA + gstack | `/gsd:verify-work`, `audit`, `review-code`, `smoke-test`, `exploratory-test`, `cso` (security), `health` |
| Ship | turbo | `finalize` → `ship` / `split-and-ship` → `review-pr` → `resolve-pr-comments` |
| Docs | gstack | `document-generate`, `document-release` (post-ship) |
| CI / deploy / release | custom skills | `fix-ci`, `deploy`, `release` |
| Operate | custom + turbo | `post-deploy-monitor` (canary window) → daemon watchdog (continuous, via DEPLOY.json) → incident agent on failure; `investigate`, `self-improve` |
| Handoff (after payment) | custom | `handoff-product` — secrets scan, strip kit, archive mirror, transfer repo to customer |
| Re-engage (customer-owned repo) | custom | `scripts/adopt-product.sh <git-url>` → `/gsd:import` → deliver via PRs |

- **GSD** (`/gsd:*` commands, `gsd-*` agents) owns macro-level orchestration: roadmap, phases, wave-based parallel execution, file-based state in `.planning/`. For full autonomy use `/gsd:autonomous`.
- **Superpowers skills** (`test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, `dispatching-parallel-agents`, `writing-skills`) are engineering discipline. They apply during ALL implementation work, including inside GSD executors: no production code without a failing test first, no fixes without root cause, no completion claims without fresh verification evidence.
- **Turbo skills** own the ship tail and QA. They write working files under `.turbo/` (gitignored).
- **gstack skills** (13: plan reviews, design, security, docs, health, office-hours) add the product/design/review dimension. Their preambles call `~/.claude/skills/gstack/bin/*` helper scripts with `|| true` fallbacks — full features when a global gstack install exists, silent defaults otherwise. `design-review` uses the gstack browse daemon when available; falls back to static analysis.

## Known seams (intentional substitutions)

- Turbo's planning skills (`turboplan`, `draft-plan`, `draft-spec`, shells) were deliberately NOT imported — GSD owns planning. Where a turbo skill offers a "plan path" (e.g. `resolve-findings`), route it to `/gsd:plan-phase` instead of `/turboplan`.
- `peer-review` / `codex-*` / `consult-oracle` need the OpenAI Codex CLI (and ChatGPT Pro for oracle). If unavailable, fall back to internal review agents — skills degrade gracefully; do not block on them.
- `smoke-test` / `exploratory-test` prefer a browser tool; fall back to `curl` for APIs.
- GSD's convenience hooks (update checker, context monitor, prompt guards, statusline) are not installed. GSD commands work without them; install via `npx @opengsd/gsd-core@latest --claude --local` if wanted later.

## Skill loading rules

- Always use the Skill tool to invoke skills — never substitute by executing steps from memory, even if the skill was loaded earlier in the conversation, including skills invoked by other skills.
- Never skip a skill invocation, step, or parallel branch to save context, time, or tokens. Shortcutting a skill removes the value it provides.
- Never merge parallel branches a skill specifies — the branch count is a floor, not a ceiling.
- Arguments to a child skill are legitimate only when they match its documented interface; ad-hoc "skip the loop" overrides are skipping through a different channel.
- After following a skill to completion, check the task list for remaining tasks before responding.

## Layout

```
.claude/commands/gsd/   69 GSD commands        .claude/agents/        33 GSD agents
.claude/gsd-core/       GSD workflows/refs/templates (rewritten to project-local paths)
.claude/skills/         87 skills: superpowers (9) + turbo (50) + gstack (13) + QA pack (10) + custom (5)
products/               product workspaces (gitignored; each its own git repo on GitHub)
docs/SOURCES.md         provenance of every import, and what was rejected and why
scripts/new-product.sh  scaffold a product workspace; --github creates + pushes the repo
scripts/build-dashboard.mjs  regenerate dashboard/index.html from products/*/.planning state
daemon/factory-daemon.mjs    Telegram ingress: ideas in → autonomous builds out (see README)
```

When a build runs headless via the daemon, follow `daemon/build-prompt.md`: never wait for input, log every assumption to `.planning/ASSUMPTIONS.md`, push after each phase, no paid deployments, finish with FINAL-REPORT.md.
