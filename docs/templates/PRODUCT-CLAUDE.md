# <PRODUCT NAME> — built with AI-Factory

This workspace carries the AI-Factory toolkit (see the factory repo's CLAUDE.md for the full manual).

## Pipeline

1. **Setup:** `/gsd:new-project` — creates `.planning/` (PROJECT, REQUIREMENTS, ROADMAP, STATE). For product strategy first, run `office-hours`.
2. **Plan:** `/gsd:discuss-phase` → `/gsd:plan-phase` (per phase), then `autoplan` for CEO/design/eng/DX plan review
3. **Design (UI products):** `design-consultation` → `design-html`; later `design-review` for visual QA
4. **Build:** `/gsd:execute-phase` — or `/gsd:autonomous` to run all remaining phases hands-off
5. **Verify:** `/gsd:verify-work`, `audit`, `review-code`, `smoke-test`, `cso` (security), `health`
6. **Ship:** `finalize` → `ship` → `review-pr` → `resolve-pr-comments` → `document-release`
7. **Deploy & operate:** `fix-ci` → `deploy` → `release` → `post-deploy-monitor`

## Discipline (always on, including inside GSD executors)

- No production code without a failing test first (`test-driven-development`).
- No fixes without root-cause investigation (`systematic-debugging`).
- No completion claims without fresh verification evidence (`verification-before-completion`).
- Code review after each task (`requesting-code-review`); respond to review with technical rigor, not agreement theater (`receiving-code-review`).

## Skill loading rules

- Always invoke skills via the Skill tool — never substitute by executing steps from memory.
- Never skip a skill step or parallel branch to save context/time/tokens; never merge parallel branches.
- Turbo skills offering a "plan path" route to `/gsd:plan-phase` (turboplan is not installed).
- `peer-review`/`codex-*` need the Codex CLI; fall back to internal review agents if absent.

## Product specifics

<!-- Fill in: deploy target & command, health endpoint, test command, conventions -->
- Deploy target:
- Test command:
- Health check URL:
