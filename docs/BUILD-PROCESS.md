# The AI-Factory Build Process

How a product travels from one sentence to a monitored production system — in the exact order the factory runs it today. Companion to [RULEBOOK.md](RULEBOOK.md) (the rules); this is the **flow**: stages, who runs them, what they produce, and where they stop.

Three points **stop for your approval** (the gates 🚦). One point **stops for independent QA** before anything reaches your customers (the iron rule 🔒). Everything else is autonomous. Every stage writes named files into the product's repo, so the whole run is auditable, and the product's status is mirrored to the Tolaria vault and the dashboard the whole way.

## The flow at a glance

```
  Idea
   │  scaffold repo + record IDEA.md
   ▼
🚦 1. STRATEGY   ── research + frameworks → STRATEGY.md ───────► you approve
   ▼
🚦 2. PRD        ── requirements + roadmap → PRD.md ───────────► you approve
   ▼
🚦 3. DESIGN     ── wireframes (UI products) → design/ ────────► you approve
   ▼                                            (non-UI: auto-skip)
   4. BUILD       ── plan → review → execute → verify (staged)   [auto]
   ▼
   5. DOCS        ── document-release → DOCS.txt                 [auto]
   ▼
🔒 6. INDEPENDENT QA  ── must PASS or it does not ship           [auto, gating]
   ▼
   7. RELEASE     ── factory promotes → 10-min canary           [auto]
   ▼
   8. OPERATE     ── watchdog + self-healing incidents          [continuous]
   ▼
  (9. HANDOFF — when the customer pays)
```

**You touch it three times** (approve Strategy, PRD, Design). The factory's QA decides whether it's good enough to ship. Nothing else needs you — though you can watch, message changes, or kill a product from the dashboard chat at any moment.

| # | Stage | Who | Runs | Output | Stops for |
|---|---|---|---|---|---|
| 0 | Intake | Founder | Telegram or dashboard chat → confirm name | `IDEA.md`, repo | tap ✅ |
| 1 | **Strategy** | Strategy agent | `office-hours` + `last30days` research + pm-skills frameworks + `strategy-red-team` | `STRATEGY.md` (+summary) | **🚦 you** |
| 2 | **PRD** | PRD agent | `/gsd:new-project` + `prioritization-frameworks` + `pre-mortem` | `PRD.md`, `.planning/` (+summary) | **🚦 you** |
| 3 | **Design** | Design agent | `design-consultation` + `design-html` + experience UX loop | `design/` wireframes (+summary) | **🚦 you** (UI only) |
| 4 | Build | Build agent | per phase: `/gsd:plan-phase` → `autoplan` → `/gsd:execute-phase` → `/gsd:verify-work` + `review-code` + `cso` + `design-review` | code, tests, `DEPLOY-STAGED.json` | auto |
| 5 | Docs | Build agent | `document-release` | `DOCS.txt` + docs | auto |
| 6 | **Independent QA** | QA agent (separate) | showroom · domain-coherence · customer-experience · intended-vs-implemented · code-hygiene · security | `QA-REPORT.md`, `QA-VERDICT.txt` | **🔒 PASS** |
| 7 | Release | Factory daemon | promote → verify health → canary | `DEPLOY.json` | auto + rollback |
| 8 | Operate | Watchdog + agents | health checks, incident stabilize, change requests | `INCIDENT-*.md` | continuous |
| 9 | Handoff | Founder-gated skill | `handoff-product` | repo transferred | payment |

---

## 0 · Intake — under a minute
The idea arrives in plain language — on Telegram **or** the dashboard's Factory chat. Nothing is created from a bare message: the factory confirms it's a new product, confirms the name (which becomes the repo, demo URL, and dashboard card), then scaffolds a private GitHub repo and saves the idea **verbatim** as `IDEA.md`. `/cancel` works anytime.

## 1 · 🚦 Strategy — the anti-mediocrity gate
Before any code, the strategy agent does real homework, not assumptions:
- **Industry-analyst research** — the `last30days` skill pulls recency-weighted, engagement-ranked signal (Reddit/X/YouTube/HN/…): what users actually complain about and want, how competitors are received, what's trending.
- **PM frameworks** — applies the relevant pm-skills (`value-proposition`, `business-model`, `swot-analysis`, `porters-five-forces`, `market-sizing`, `competitor-analysis`, `ideal-customer-profile`, `pricing-strategy`, `north-star-metric`, `opportunity-solution-tree`), then stress-tests with `strategy-red-team`.
- **Output** — `STRATEGY.md`: problem & who has it, thesis, **domain model (entities + how they relate + hierarchy/org)**, MVP scope, what "good" looks like, risks. Plus a plain-language `STRATEGY-SUMMARY.txt`.

→ The factory sends you the summary. **Build does not proceed until you Approve.** Edits re-run this stage.

## 2 · 🚦 PRD — requirements on the real backbone
`/gsd:new-project` turns the approved strategy into `PRD.md` + a phased roadmap in `.planning/`, built **on the domain model** (real related entities, never flat siloed modules). `prioritization-frameworks` decides what's in/out of the MVP; `pre-mortem` surfaces what would make it fail. Plus `PRD-SUMMARY.txt`.

→ **You Approve the PRD before design and build.**

## 3 · 🚦 Design — the experience gate (UI products)
`design-consultation` sets a design system; `design-html` produces real wireframes of the key screens. For every primary journey the agent runs the experience loop — *deliberate → research → evaluate → deliberate → finalize* — to commit to the **fewest possible clicks with modern patterns and zero legacy clunk** (recorded in `design/UX-RATIONALE.md`). The factory serves the screens at `/preview/<product>/`.

→ You view the wireframes on your phone and **Approve before building.** A product with no UI writes `DESIGN-SKIP.txt` and this gate auto-skips.

## 4 · Build — autonomous, disciplined, staged
The build agent builds strictly to the three approved artifacts. Per phase: `/gsd:plan-phase` (research → plan → machine-verified) → `autoplan` review (CEO → design → eng → DX) → `/gsd:execute-phase` (parallel waves, **failing-test-first**, root-cause-only fixes) → `/gsd:verify-work` + `review-code` + `cso` (security) + `design-review`. Every action streams to the dashboard. **Deployment here is staging-only** (`DEPLOY-STAGED.json`: preview URL + promote command) — production is unreachable from this stage. (Exception: a product's first-ever deploy, which QA still gates before announcement.)

## 5 · Docs
`document-release` writes user/reference docs that match what was built and records the entry-doc link in `DOCS.txt` (sent to you when the product goes live).

## 6 · 🔒 Independent QA — the iron rule
A **separate** agent with no knowledge of the build tries to prove it wrong on the staged version. Gating checks:
- **Showroom** — every promised module is reachable and works in a real browser (a backend route is not a shipped feature).
- **Domain-coherence** — entities are really related and navigable; hierarchy/org modeled (no faked TEXT-column stand-ins).
- **Customer-experience** — counts the clicks/steps per primary journey; fails needless length or legacy clunk.
- **Intended-vs-implemented** — the build matches its own STRATEGY/PRD/wireframe contract.
- **Code-hygiene** — no dead/orphaned code; removals didn't break anything.
- Plus code review, security (OWASP), accessibility.

Output: `QA-REPORT.md` + `QA-VERDICT.txt`. **FAIL** → one autonomous fix-and-retest round, then an honest stop. **PASS** → the factory promotes. A missing verdict counts as untested.

## 7 · Release — factory-only promotion
On PASS, the **daemon** (never an agent) runs the recorded promote command, verifies production health, then watches a **10-minute canary**. Two failed checks roll production back to the last QA-approved version within ~1 minute and re-queue the fix. Only after promotion do you get the "done" message: plain-language summary, demo link, docs link, repo link.

## 8 · Operate — for as long as the factory hosts it
Health checks every 5 minutes; a failure dispatches an incident agent that **stabilizes only** (rollback to the last QA-approved version) — root-cause fixes re-enter the pipeline. Founder change requests follow the same path (staged → QA → promoted, logged as `## Change:` on the roadmap). The toolkit self-upgrades under verification with auto-revert.

## 9 · Handoff — when the customer pays
`handoff-product`: payment → full-history secrets scan → factory kit stripped (the `.planning/` audit trail ships) → local mirror archived → release tagged → GitHub repo transferred. **Full teardown** instead (dashboard 🗑): archive → Cloudflare offline → repo deleted → local removed — for discarding, never for a product destined for handoff.

---

## Always-on, across every stage
- **Recorded** — each product is mirrored to the Tolaria vault (`~/AI-Factory-Vault`, one note per product: status, stage, lifecycle, links) and to the live dashboard.
- **Controllable** — from the dashboard Factory chat you can start a build, approve a gate, request a change, or kill a product; from Telegram too.
- **Honest** — every gate produces an artifact; nothing is claimed done without fresh evidence; QA gates production without exception.

## Document map
- **This document** — the build flow (the order the factory runs).
- [RULEBOOK.md](RULEBOOK.md) — the operating rules and their enforcement level.
- [SOURCES.md](SOURCES.md) — provenance of every imported skill, and what was rejected.
- `daemon/*-prompt.md` — the literal contracts each agent runs under (strategy, prd, design, build, qa, update, incident).
- Repo `README.md` — setup, operations, monitoring, handoff.
