# AI-Factory — Operating Manual

This repository is an autonomous AI software factory: a curated, self-contained Claude Code toolkit that takes a product from idea to deployed software. Products are built in `products/<name>/` workspaces (scaffolded by `scripts/new-product.sh`), each carrying a copy of this kit.

## Pipeline flow (the order the factory runs)

This is the canonical sequence every new product follows. Full detail in [docs/BUILD-PROCESS.md](docs/BUILD-PROCESS.md). Three stages stop for human approval (🚦); independent QA gates production (🔒); everything else is autonomous. **Do not mix planning systems** — GSD owns requirements/roadmap/execution; the pm-skills are analysis lenses, not competing planners.

| # | Stage | Owner | Runs | Stops for |
|---|---|---|---|---|
| 0 | Intake | daemon | Telegram or dashboard chat → confirm → scaffold repo + `IDEA.md` | tap ✅ |
| 1 | **Strategy** | gstack `office-hours` | `last30days` industry-analyst research + pm-skills frameworks (value-proposition, business-model, swot, porters, market-sizing, competitor-analysis, ICP, pricing, north-star, opportunity-solution-tree) + `strategy-red-team` → `STRATEGY.md` (domain model) | **🚦 human** |
| 2 | **PRD** | GSD `/gsd:new-project` | requirements + roadmap on the domain model + `prioritization-frameworks` + `pre-mortem` → `PRD.md` + `.planning/` | **🚦 human** |
| 3 | **Design** | gstack `design-consultation` + `design-html` | experience UX loop (fewest clicks, no legacy) → `design/` wireframes, served at `/preview/<slug>/` | **🚦 human** (UI only; non-UI auto-skips) |
| 4 | Build | GSD + superpowers | per phase: `/gsd:plan-phase` → `autoplan` (CEO/design/eng/DX) → `/gsd:execute-phase` → `/gsd:verify-work` + `review-code` + `cso` + `design-review`; **staging only** | auto |
| 5 | Docs | gstack `document-release` | docs matching what shipped → `DOCS.txt` link | auto |
| 6 | **Independent QA** | turbo/gstack QA agent | showroom · domain-coherence · customer-experience · `intended-vs-implemented` · code-hygiene · `cso` · accessibility → `QA-VERDICT.txt` | **🔒 PASS** |
| 7 | Release | daemon (never an agent) | promote staged→prod → verify health → 10-min canary → rollback on failure | auto |
| 8 | Operate | custom + turbo | `post-deploy-monitor` → watchdog → incident agent (stabilize/rollback only); `investigate`, `self-improve` | continuous |
| 9 | Handoff / re-engage | custom | `handoff-product` (after payment); `scripts/adopt-product.sh` → `/gsd:import` → deliver via PRs | payment |

- **GSD** (`/gsd:*` commands, `gsd-*` agents) owns macro-level orchestration: roadmap, phases, wave-based parallel execution, file-based state in `.planning/`. For full autonomy use `/gsd:autonomous`.
- **Superpowers skills** (`test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, `dispatching-parallel-agents`, `writing-skills`) are engineering discipline. They apply during ALL implementation work, including inside GSD executors: no production code without a failing test first, no fixes without root cause, no completion claims without fresh verification evidence.
- **Turbo skills** own the ship tail and QA. They write working files under `.turbo/` (gitignored).
- **gstack skills** (13: plan reviews, design, security, docs, health, office-hours) add the product/design/review dimension. Their preambles call `~/.claude/skills/gstack/bin/*` helper scripts with `|| true` fallbacks — full features when a global gstack install exists, silent defaults otherwise. `design-review` uses the gstack browse daemon when available; falls back to static analysis.
- **pm-skills (25)** are product-management *analysis lenses* — strategy frameworks (value-proposition, business-model, swot, porters, pestle, ansoff, market-sizing, competitor-analysis, ICP, pricing/monetization, north-star, opportunity-solution-tree, customer-journey-map, startup/lean-canvas), prioritization, `pre-mortem`, `strategy-red-team`, and `intended-vs-implemented`. Used in the Strategy/PRD/QA stages. They do NOT plan — GSD owns requirements/roadmap/execution.
- **last30days** is the industry-analyst research engine (recency-weighted, engagement-ranked social/web signal) the Strategy gate runs to ground decisions in current reality. Keyless-capable; needs `python3.12`+`node` (present); sharper with X cookies + `yt-dlp` (installed).

## The human-approval gates (mandatory, before any code ships)

**No product code is written until the human approves, at three gates, in order.** A new build proceeds gate-by-gate; each gate runs a headless agent that produces an artifact and stops, the daemon sends the founder a plain-language summary on Telegram, and nothing advances until they Approve / revise / Cancel. Founder edits re-run that stage. The approved artifacts are the build's contract.

1. **Strategy (step 1, `office-hours`)** — `daemon/strategy-prompt.md` → `STRATEGY.md`: problem, thesis, **domain model (entities + how they relate + hierarchy/org where the domain has one)**, MVP scope, what "good" looks like, risks. Plus `STRATEGY-SUMMARY.txt`. Grounded by the **`last30days`** skill — a Gartner-style industry-analyst pass that pulls recency-weighted, engagement-ranked market signal (Reddit/X/YouTube/HN/…) on the domain; works keyless, sharper with X cookies + `yt-dlp` (installed).
2. **PRD (step 2, `/gsd:new-project`)** — `daemon/prd-prompt.md` → `PRD.md` + `.planning/` roadmap/requirements built ON the approved domain model. Plus `PRD-SUMMARY.txt`.
3. **Design / wireframes (step 5, `design-consultation` + `design-html`)** — `daemon/design-prompt.md` → a static `design/` folder the daemon serves at `/preview/<slug>/` so the founder views the screens on their phone before approving. Plus `DESIGN-SUMMARY.txt`. Non-UI products write `DESIGN-SKIP.txt` and this gate auto-skips.

Only after design approval does the build agent (`daemon/build-prompt.md`) run the rest of the pipeline — plan-phase → autoplan review → execute-phase → verify-work → finalize/ship (staged) → `document-release` (writes `DOCS.txt`, a link the daemon sends the founder) — building strictly to the three approved artifacts. The data model, APIs, and UI hang off the domain backbone, never a flat pile of siloed modules. These gates exist because skipping strategy/research/design produced shallow, mediocre products (the hrms-app lesson); the build agent must run the FULL documented pipeline, never a new-project + autonomous shortcut.

## The experience rule

**Every product MUST deliver an amazing customer experience. Period.** Functional is not the bar. For every primary journey, the factory runs *deliberate → research → evaluate → deliberate → finalize* (in the design gate, `daemon/design-prompt.md`, recorded in `design/UX-RATIONALE.md`): research how the best modern products solve the flow, evaluate approaches by click/step count, and finalize the lowest-friction one. The mandate: **fewest possible clicks/steps, modern patterns only, never a legacy workflow** — no full-page reloads for routine actions, no multi-page wizards for one-screen tasks, no edit-page round-trips where inline/optimistic editing belongs, no re-asking for data the system already has; use smart defaults, autosave, bulk actions, search-first navigation, and undo instead of confirmation dialogs. The design commits to a step count per journey; the build must hit it; independent QA's gating CUSTOMER-EXPERIENCE check counts the steps and fails any journey that is needlessly long or carries legacy clunk. A product that merely works but is tedious does not ship.

## The iron rule

**Nothing reaches production without passing independent QA. Period.** Builder and update agents deploy to staging only (`DEPLOY-STAGED.json` records the preview URL and promote command); the daemon promotes to production exclusively after a QA PASS, then a 10-minute canary watches the live site and rolls back deterministically on failure. Incident agents stabilize by rolling back to the last QA-approved version — never by deploying new code. Toolkit self-upgrades are verified by `scripts/verify-kit.mjs` and auto-reverted if damaged. The only exception: a product's first-ever deployment (no users exist yet), which QA still gates before it is announced.

## Code hygiene & safe decommission

- **Supersede means delete.** When a change replaces existing code, remove the old code — functions, files, endpoints, config, dead branches — in the SAME change. No orphans left behind. Independent QA treats any unreferenced/dead code introduced by a change as a finding (FAIL-worthy if it's confusing or risks being mistaken for live).
- **Removal is a change, not a `rm`.** Deleting or decommissioning anything follows the full pipeline, never delete-and-deploy: (1) prove nothing depended on it — tests + showroom QA confirm no feature, module, link, or flow regressed; (2) stage it; (3) the factory promotes the removal to production only after QA PASS, then the canary watches. A removal that breaks the canary rolls back like any other.
- **Decommissioning a deployed service** (a retired product/worker): archive a restorable mirror first (`git clone --mirror` / keep the repo), confirm nothing else points at it, then tear it down — and record it in `docs/HANDOFFS.md` or `docs/SOURCES.md` as appropriate. Never destroy the only copy.
- **The dashboard "remove" button does a FULL TEARDOWN** (`killProduct` in `daemon/factory-daemon.mjs`): archive a `git bundle --all` to `archives/` FIRST (aborts the whole operation if the backup fails), then take the Cloudflare deployment offline (delete the worker/pages + D1 from `DEPLOY.json`), delete the GitHub repo (`gh repo delete` — needs the `delete_repo` scope; reported honestly if missing), remove the local workspace, and record it in `docs/DECOMMISSIONS.md`. The UI requires typing the product name to confirm. This is for *discarding* a product — distinct from `handoff-product`, which transfers a repo to a paying customer; don't teardown a product that's destined for handoff.

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
.claude/skills/         skills: superpowers (9) + turbo (50) + gstack (13) + QA pack (10) + custom + last30days + pm-skills (25 PM frameworks)
products/               product workspaces (gitignored; each its own git repo on GitHub)
docs/SOURCES.md         provenance of every import, and what was rejected and why
scripts/new-product.sh  scaffold a product workspace; --github creates + pushes the repo
scripts/build-dashboard.mjs  regenerate dashboard/index.html from products/*/.planning state
scripts/build-vault.mjs      sync the Tolaria product registry (one note per product) — see below
daemon/factory-daemon.mjs    Telegram ingress: ideas in → autonomous builds out (see README)
~/AI-Factory-Vault/     Tolaria vault (own git repo, path in config.json `vaultPath`): a markdown
                        note per product (status/stage/lifecycle/links), auto-synced by the daemon
                        on every refresh and marked decommissioned on kill. Browse it in Tolaria.app.
```

When a build runs headless via the daemon, follow `daemon/build-prompt.md`: never wait for input, log every assumption to `.planning/ASSUMPTIONS.md`, push after each phase, no paid deployments, finish with FINAL-REPORT.md.
