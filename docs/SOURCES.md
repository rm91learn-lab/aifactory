# Import Provenance

Evaluated 2026-06-12. Each source was cloned, studied, and either imported, kept as reference, or rejected. Source clones were removed after import; pinned commits below.

## Imported

### open-gsd/gsd-core — orchestration spine
- **Commit:** `3e836fe` (2026-06-12) · MIT · https://github.com/open-gsd/gsd-core
- **Why:** The most actively maintained spec-driven SDLC orchestrator for Claude Code (successor to get-shit-done). Phase loop (discuss → plan → execute → verify), wave-based parallel subagent execution, autonomous mode, file-based state in `.planning/`.
- **Imported:** `commands/gsd/` → `.claude/commands/gsd/` (69 commands); `agents/` → `.claude/agents/` (33 agents); `gsd-core/{workflows,references,templates,contexts}` → `.claude/gsd-core/`.
- **Modified:** all `@~/.claude/gsd-core/...` and `$HOME/.claude/gsd-core/...` references rewritten to project-local `.claude/gsd-core/...` (what the official installer does for `--local` installs).
- **Excluded:** runtime hooks (update checker, context monitor, prompt guards, statusline) — convenience features requiring installer execution; installable later via `npx @opengsd/gsd-core@latest --claude --local`. Also excluded: src/tests/build tooling (not needed at runtime).

### obra/superpowers — engineering discipline
- **Commit:** `6fd4507` (2026-05-29, v5.1.0) · MIT · https://github.com/obra/superpowers
- **Why:** Battle-tested process-discipline skills: TDD (red-green-refactor enforced), systematic debugging (root cause before fixes), verification gates, two-stage code review, git worktree hygiene.
- **Imported (9 of 14):** test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, using-git-worktrees, finishing-a-development-branch, dispatching-parallel-agents, writing-skills → `.claude/skills/`.
- **Modified:** `superpowers:` plugin-namespace prefixes stripped so cross-references resolve as project skills.
- **Excluded (5):** brainstorming, writing-plans, executing-plans, subagent-driven-development (GSD owns planning/execution — two planning systems would conflict), using-superpowers (plugin bootstrap, meaningless outside the plugin).

### tobihagemann/turbo — ship tail & QA
- **Commit:** `e5e55de` (2026-06-07) · https://github.com/tobihagemann/turbo
- **Why:** The strongest PR/ship workflow collection studied: full PR lifecycle (create, review, resolve comments, reply threads), iterative polish loop, audit, dependency maintenance — the stages GSD and superpowers don't cover.
- **Imported (50 of 74):** finalize, audit, review-code, polish-code, find-dead-code, simplify-code/docs, investigate, create-threat-model, 4 testing skills, 4 dependency/tooling skills, 4 findings skills, all 15 git/GitHub skills, 5 external-tool skills (Codex peer review — degrade gracefully), 5 rules skills, self-improve, note-improvement, create-handoff, recall-reasoning.
- **Modified:** `~/.claude/skills/` self-references rewritten to project-local `.claude/skills/`.
- **Excluded (24):** all 11 planning skills + turboplan + implement + implement-improvements (GSD owns planning; `resolve-findings` plan-path routes to `/gsd:plan-phase`), onboard, map-codebase (GSD has `/gsd:map-codebase`), explain-this, understand-change (tutoring, not factory).

### garrytan/gstack — product, plan review & design layer
- **Commit:** `a5833c4` (2026-06-10, v1.57.10.0) · MIT · https://github.com/garrytan/gstack
- **Why:** Fills the dimensions the other imports lack entirely: multi-persona plan review (CEO/eng/design/DX with an auto-pipeline), design-system creation and visual QA, OWASP/STRIDE security mode, documentation generation, product strategy interrogation.
- **Imported (13):** plan-ceo-review, plan-eng-review, plan-design-review, plan-devex-review, autoplan (orchestrates all four), design-consultation, design-review, design-html, cso, document-generate, document-release, health, office-hours → `.claude/skills/`. Plus shared data: `scripts/jargon-list.json` → `.claude/skills/gstack-shared/`.
- **Modified:** cross-skill references (`~/.claude/skills/gstack/<skill>/...`) rewritten to project-local `.claude/skills/<skill>/...`; `SKILL.md.tmpl` template sources removed. Preamble calls to `~/.claude/skills/gstack/bin/*` left intact ON PURPOSE — every call carries `|| true`/default fallbacks, so skills get full telemetry/config/learnings features on machines with a global gstack install and degrade silently elsewhere. Same for the optional browse daemon (`design-review`).
- **Excluded (~45):** ship, land-and-deploy, setup-deploy, canary, benchmark (overlap with turbo ship + custom deploy/release/post-deploy-monitor; heavily coupled to the browse daemon), qa/qa-only/devex-review/design-shotgun/scrape/browse/skillify (browse-daemon-centric; turbo smoke-test/exploratory-test cover the portable cases), investigate/spec/learn (covered by superpowers systematic-debugging + turbo investigate, /gsd:spec-phase, turbo self-improve), codex (hard Codex CLI dependency; turbo's codex skills already imported), freeze/unfreeze/careful/guard/context-save/context-restore/plan-tune (session utilities, not factory pipeline), ios-* (platform-specific), gbrain/supabase/extension/pair-agent/connect-chrome infra (runtime, not skills), retro/office admin variants, make-pdf, landing-report, gstack-upgrade.

### fugazi/test-automation-skills-agents — QA playbook layer
- **Imported 2026-06-12** · https://github.com/fugazi/test-automation-skills-agents
- **Why:** consistent expert-grade, fully self-contained QA playbooks that arm the factory's independent QA gate: Playwright E2E patterns (locators, auto-waiting, flakiness), webapp testing, regression testing, Playwright CLI, axe/WCAG accessibility, API testing, ISTQB test planning.
- **Imported (7):** playwright-e2e-testing, webapp-playwright-testing, playwright-cli, playwright-regression-testing, a11y-playwright-testing, api-testing, qa-test-planner → `.claude/skills/` (with their `references/` bundles).
- **Excluded:** webapp-selenium-testing, accessibility-selenium-testing (Selenium/Java — not our toolchain), qa-manual-istqb (manual-QA persona; factory QA is automated).

### PramodDutta/qaskills — cherry-picked deep references
- **Imported 2026-06-12** · https://github.com/PramodDutta/qaskills (the qaskills.sh monorepo)
- **Why/what:** 380-skill encyclopedia of very mixed quality (many SEO-template stubs; some 1000+ line expert references). Quality-gated to three genuinely deep skills: **api-contract-validator** (OpenAPI/JSON-Schema/GraphQL contract + backward-compat testing), **api-test-suite-generator** (CRUD/auth/pagination/error suites), **state-machine-test-generator** (FSM-driven test cases).
- **Modified:** frontmatter names normalized to slugs.
- **Excluded (~377):** template stubs (e.g. integration-testing-patterns, cron-job-testing, lighthouse-performance contain literal "Adapt this pattern" placeholders), framework-specific packs outside our stack, and everything coupled to the qaskills CLI/site.
- **qaskills.sh blog (top-10 QA skills):** editorial + distribution funnel for their CLI — reference only.

### Custom DevOps skills (authored here)
`fix-ci`, `deploy`, `release`, `post-deploy-monitor` — close the CI/CD → deploy → release → operate gap that none of the imports cover (superpowers stops at git, turbo at the PR, GSD at verification).

## Rejected

### gsd-build/get-shit-done
- **Commit:** `bdcaab2` (2026-05-31) — **archived.** README redirects to open-gsd/gsd-core; identical command/agent set at archive time, no development since. gsd-core supersedes it (MVP mode, milestone-prefixed phases, better model routing).

### pulumi/agent-skills — reference only
- **Commit:** `43626f2` (2026-06-03) · https://github.com/pulumi/agent-skills
- 13 of 14 skills hard-require Pulumi (ESC, Pulumi Cloud, Neo). Well-built, actively maintained — import (`/plugin marketplace add pulumi/agent-skills`) only if Pulumi becomes the factory's IaC tool. For generic IaC, antonbabenko/terraform-skill is the catalog's alternative.

### github.com/resources/articles/ai-in-software-development — framing only
- Editorial, no code. Its six SDLC stages (plan, design, develop, test, deploy, maintain) informed the pipeline structure in CLAUDE.md.

## Reference catalog

### VoltAgent/awesome-agent-skills
- **Commit:** `0e6e589` (2026-06-05) — curated index of 1,400+ skills; snapshot at `docs/reference/skill-catalog.md`.
- **Shortlist for future import** (gaps this factory still has):
  - **getsentry/** (30+ skills) — production observability, error-context code review
  - **trailofbits/** (21 skills) — security: static analysis (Semgrep/CodeQL), property-based testing, insecure defaults
  - **datadog-labs/** (8 skills) — APM, log search, LLM trace root-cause
  - **NeoLabHQ/context-engineering-kit** — spec/domain/subagent-driven dev patterns
  - **muratcankoylan/Agent-Skills-for-Context-Engineering** — multi-agent orchestration patterns

### karanb192/awesome-claude-skills — rejected (stale catalog, no unique content)
- **Evaluated 2026-06-12** · last commit 2025-10-21 (8 months stale) · README-only list of 54 links.
- Verified entries all point to sources already imported (obra/superpowers, anthropics/skills, webapp-testing). Every gap-relevant entry (visual regression, performance profiling, load testing, security review, dependency audit) is marked "Community-needed" — i.e. the skill does not exist. VoltAgent/awesome-agent-skills (actively maintained) remains our reference catalog.
