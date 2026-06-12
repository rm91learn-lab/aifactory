# The AI-Factory Build Process

How a product travels from one sentence to a monitored production system. Companion to [RULEBOOK.md](RULEBOOK.md) (the rules) — this is the **approach**: stages, actors, artifacts, and exit gates. Every stage produces named files in the product's repository, so the process is auditable after the fact.

| Stage | Actor | Exit gate |
|---|---|---|
| 1. Intake | Founder (3 taps) | Explicit ✅ confirmation |
| 2. Foundation | Factory | Repo exists, brief recorded |
| 3. Planning | Build agent | Plan files written before code |
| 4. Build | Build agent | Tests green, staged deploy |
| 5. Verification | Independent QA agent | PASS verdict |
| 6. Release | Factory daemon | Healthy promotion + clean canary |
| 7. Operation | Watchdog + agents | Continuous |
| 8. Handoff | Founder-gated skill | Payment confirmed, transfer accepted |

## 1 · Intake — founder, under a minute

The idea arrives in plain language on Telegram. Nothing is created from a bare message: the bot confirms **what** it is (new product / change / ignore), **what it's called** (suggested or custom — the name becomes the repo, demo URL, and dashboard card), and shows the **full consequence** (private repo, autonomous build, live demo) before the final ✅. `/cancel` works at any point thereafter.

## 2 · Foundation — automatic

Workspace scaffolded with the complete 87-skill toolkit; private GitHub repo created and pushed; the founder's idea saved **verbatim** as `IDEA.md` — it is the product's brief and the contract every later stage answers to.

## 3 · Planning — before any code

The build agent converts the brief into the planning record (Rule 10: undocumented work is invisible work):

- `.planning/REQUIREMENTS.md` — scope: every feature in, every feature explicitly out
- `.planning/ROADMAP.md` — phases with task checkboxes (drives the founder's kanban)
- `.planning/ASSUMPTIONS.md` — every decision made without asking, with reasons ("decisions made for you" panel)

The founder can read all three on the dashboard mid-build and inject corrections by message at any time.

## 4 · Build — autonomous, disciplined, visible

Phased execution under standing orders: failing test before code, root-cause-only fixes, full suite green before any commit, push after every phase. Every action streams to the dashboard (live feed + kanban) and milestones ping Telegram. Deployment during build is **staging-only** (`DEPLOY-STAGED.json`: preview URL + promote command) — production is unreachable from this stage. Exception: a first-ever deployment (zero users), which stage 5 still gates. Provider outages self-retry once.

## 5 · Verification — the independent QA gate

A separate agent with no knowledge of the implementation attacks the staged version: the product's own test suite, real-browser journeys (Playwright), a realistic sample file for **every input format the UI claims to accept**, automated accessibility scan (axe/WCAG), mandatory code review, and an OWASP security pass. Artifacts: `QA-REPORT.md` (findings, severities, reproduction steps — including required "Code Review", "Security", and "Accessibility" sections) and `QA-VERDICT.txt` (PASS/FAIL + plain-language note). FAIL triggers exactly one fix-and-retest round, then an honest stop. A missing verdict counts as untested.

## 6 · Release — factory-only promotion

On PASS, the **daemon** (never an agent) executes the recorded promote command, verifies production health, then watches a 10-minute canary. Two failed checks roll production back to the previous QA-approved version within ~1 minute and queue the corrected fix through the full pipeline again. Only after promotion does the founder get the "done" message: plain-language summary (`BUILD-SUMMARY.txt`), demo link, repo link. `FINAL-REPORT.md` opens with a "For the founder" section, then full technical detail.

## 7 · Operation — for as long as the factory hosts it

Health checks every 5 minutes; failures dispatch an incident agent that **stabilizes only** (rollback to last QA-approved version, `INCIDENT-*.md` + verdict) — root-cause fixes re-enter the pipeline at stage 3/4. Change requests from the founder follow the same stages 1→6 as updates (staged, QA'd, promoted, logged as `## Change:` entries on the roadmap/board). The toolkit itself self-upgrades under verification with auto-revert.

## 8 · Handoff — when the customer pays

`handoff-product`: payment confirmation → full-history secrets scan → factory kit stripped (the `.planning/` audit trail ships; it documents what was bought) → local mirror archived → release tagged → GitHub transfer. Re-engagement later via `adopt-product`: customer adds the founder as collaborator; factory tooling overlays locally only and can never be pushed to their repo; work is delivered by pull request.

## Artifact index

| File (in each product repo) | What it tells you |
|---|---|
| `IDEA.md` | The founder's brief, verbatim |
| `.planning/REQUIREMENTS.md` | Scope in and out |
| `.planning/ROADMAP.md` | Phases, tasks, and every later change |
| `.planning/ASSUMPTIONS.md` | Decisions made autonomously, with reasons |
| `DEPLOY-STAGED.json` / `DEPLOY.json` | Staged candidate / live deployment record |
| `QA-REPORT.md` + `QA-VERDICT.txt` | Independent verification evidence |
| `BUILD-SUMMARY.txt` / `UPDATE-SUMMARY.txt` | Plain-language outcome for the founder |
| `FINAL-REPORT.md` | Founder section + full technical record |
| `INCIDENT-*.md` | Anything that went wrong live, and what was done |

## Document map

- **This document** — the build approach
- [RULEBOOK.md](RULEBOOK.md) — the 26 operating rules and their enforcement level
- [SOURCES.md](SOURCES.md) — where every imported skill came from, and what was rejected
- `daemon/*.md` — the literal contracts each agent runs under (build, update, QA, incident, upgrade)
- Repo root `README.md` — setup, operations, monitoring, handoff
