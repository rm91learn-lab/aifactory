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
.claude/skills/         87 skills: superpowers (9) + turbo (50) + gstack (13) + QA pack (10) + custom (5)
products/               product workspaces (gitignored; each its own git repo on GitHub)
docs/SOURCES.md         provenance of every import, and what was rejected and why
scripts/new-product.sh  scaffold a product workspace; --github creates + pushes the repo
scripts/build-dashboard.mjs  regenerate dashboard/index.html from products/*/.planning state
daemon/factory-daemon.mjs    Telegram ingress: ideas in → autonomous builds out (see README)
```

When a build runs headless via the daemon, follow `daemon/build-prompt.md`: never wait for input, log every assumption to `.planning/ASSUMPTIONS.md`, push after each phase, no paid deployments, finish with FINAL-REPORT.md.
