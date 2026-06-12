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
# 1. Scaffold a product workspace (gets its own git repo + a copy of the kit)
scripts/new-product.sh my-product

# 2. Start building
cd products/my-product && claude
> /gsd:new-project        # interactive: questions → requirements → roadmap
> /gsd:autonomous         # ...or phase by phase: /gsd:plan-phase → /gsd:execute-phase
```

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
