# Import Provenance

Evaluated 2026-06-12. Each source was cloned, studied, and either imported, kept as reference, or rejected. Source clones were removed after import; pinned commits below.

## Imported

### open-gsd/gsd-core — orchestration spine
- **Commit:** `a375c4b` (2026-06-14) · MIT · https://github.com/open-gsd/gsd-core
- **Why:** The most actively maintained spec-driven SDLC orchestrator for Claude Code (successor to get-shit-done). Phase loop (discuss → plan → execute → verify), wave-based parallel subagent execution, autonomous mode, file-based state in `.planning/`.
- **Imported:** `commands/gsd/` → `.claude/commands/gsd/` (69 commands); `agents/` → `.claude/agents/` (33 agents); `gsd-core/{workflows,references,templates,contexts}` → `.claude/gsd-core/`.
- **Modified:** all `@~/.claude/gsd-core/...` and `$HOME/.claude/gsd-core/...` references rewritten to project-local `.claude/gsd-core/...` (what the official installer does for `--local` installs).
- **Excluded:** runtime hooks (update checker, context monitor, prompt guards, statusline) — convenience features requiring installer execution; installable later via `npx @opengsd/gsd-core@latest --claude --local`. Also excluded: src/tests/build tooling (not needed at runtime).

### leonxlnx/taste-skill — anti-slop frontend design taste
- **Commit:** `01d8504` (2026-06-12, v1.0.0) · MIT · https://github.com/leonxlnx/taste-skill
- **Why:** The "anti-slop frontend framework" — taste/aesthetic judgment so AI-built UIs look intentional and premium, not templated. Directly serves the Design gate and the experience rule.
- **Imported (7, prompt-only, key-free):** `taste-skill` (name: `design-taste-frontend`), `soft-skill` (`high-end-visual-design`), `minimalist-skill` (`minimalist-ui`), `brutalist-skill` (`industrial-brutalist-ui`), `redesign-skill` (`redesign-existing-projects`), `output-skill` (`full-output-enforcement` — anti-truncation/no-placeholders), `image-to-code-skill` (`image-to-code`) → `.claude/skills/`. No name/folder collisions.
- **Wired in:** design-prompt.md (apply `design-taste-frontend` + the matching aesthetic so wireframes are premium); build-prompt.md (`image-to-code` to translate wireframes faithfully + `full-output-enforcement` so UI code ships complete).
- **Excluded:** the image-generation skills that need external API keys (`brandkit`, `imagegen-frontend-web`, `imagegen-frontend-mobile`, `gpt-tasteskill` — OpenAI/Gemini/Stability), `stitch-skill` (Google-Stitch-specific), and `taste-skill-v1` (superseded). The `research/laziness/` docs (LLM-laziness root-causes + remediation) are a useful reference but not a skill — left upstream. All available from the repo if needed later.
- **Complements, not replaces:** the existing design pipeline (gstack `design-consultation`/`design-html`/`design-review`, `frontend-design`) — these add the taste/aesthetic judgment layer on top.

### phuryn/pm-skills — product-management frameworks
- **Commit:** `d384f0c` (2026-06-06) · MIT · https://github.com/phuryn/pm-skills
- **Why:** 68 PM skills encoding real frameworks (Torres/Cagan/Savoia). Directly strengthens the Strategy and PRD gates — the factory's known weak spot (the hrms-app mediocrity lesson).
- **Imported (25, curated, conflict-free):** `product-strategy, product-vision, value-proposition, business-model, lean-canvas, startup-canvas, swot-analysis, porters-five-forces, pestle-analysis, ansoff-matrix, market-sizing, market-segments, competitor-analysis, ideal-customer-profile, user-personas, pricing-strategy, monetization-strategy, north-star-metric, opportunity-solution-tree, customer-journey-map, prioritization-frameworks, prioritize-features, pre-mortem, strategy-red-team, intended-vs-implemented` → `.claude/skills/` (each a SKILL.md folder).
- **Wired in:** strategy-prompt.md (apply the relevant framework skills + `strategy-red-team`); prd-prompt.md (`prioritization-frameworks` for MVP scope, `pre-mortem` for risks); qa-prompt.md (`intended-vs-implemented` as a gating check).
- **Excluded — planning overlap (route to GSD, per "don't mix planning systems"):** `create-prd`, `outcome-roadmap`, `sprint-plan`, `brainstorm-okrs`, `user-stories` — GSD owns requirements/roadmap/execution.
- **Excluded — out of scope / covered elsewhere:** GTM + analytics + growth skills (gtm-*, ab-test-analysis, cohort-analysis, metrics-dashboard, sql-queries — kit has `data:*`/`marketing:*` plugins), legal (`draft-nda`, `privacy-policy`), and clearly-irrelevant (`review-resume`, `grammar-check`). All remain available from the upstream marketplace if a gap appears.

### mvanhorn/last30days-skill — recency research
- **Commit:** `1221584` (2026-06-06, v3.3.2) · MIT · https://github.com/mvanhorn/last30days-skill
- **Why:** Recency-weighted, engagement-ranked research across Reddit, X, YouTube, TikTok, Instagram, Hacker News, GitHub, Polymarket, Bluesky and the web — "what are people actually saying about X in the last 30 days." Complements the strategy/research gates (real-world domain signal beyond static web search) and the experience rule (how the best products in a space are discussed and solved right now).
- **Imported:** `skills/last30days/{SKILL.md,scripts,references,agents}` → `.claude/skills/last30days/` (88 files, ~1.3 MB). Zero Python dependencies (stdlib + `node`/`python3`); `user-invocable: true`, so it surfaces in the skills list automatically.
- **Excluded:** `assets/` (14 MB demo media — mp3/images, unreferenced by skill logic), plus `tests/`, `docs/`, `fixtures/`, `media/`, CI workflows, and `pyproject.toml`/`uv.lock` (dev-only) — not needed at runtime.
- **Caveats:** all API keys are OPTIONAL (`SCRAPECREATORS_API_KEY` is primary; OPENAI/XAI/BRAVE/APIFY/etc.) — without them it falls back to keyless/public sources (Reddit RSS, HN, …). It can read local browser cookies (Chrome/Safari) for authenticated X scraping — cookies are decrypted locally and used only against their own sites. Safety-scanned before import: no pipe-to-shell, no `eval`, no cookie exfiltration; every network endpoint is a known public API. Needs `python3` and `node` on PATH.

### obra/superpowers — engineering discipline
- **Commit:** `6fd4507` (2026-05-29, v5.1.0) · MIT · https://github.com/obra/superpowers
- **Why:** Battle-tested process-discipline skills: TDD (red-green-refactor enforced), systematic debugging (root cause before fixes), verification gates, two-stage code review, git worktree hygiene.
- **Imported (9 of 14):** test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, using-git-worktrees, finishing-a-development-branch, dispatching-parallel-agents, writing-skills → `.claude/skills/`.
- **Modified:** `superpowers:` plugin-namespace prefixes stripped so cross-references resolve as project skills.
- **Excluded (5):** brainstorming, writing-plans, executing-plans, subagent-driven-development (GSD owns planning/execution — two planning systems would conflict), using-superpowers (plugin bootstrap, meaningless outside the plugin).

### tobihagemann/turbo — ship tail & QA
- **Commit:** `f78e854` (2026-06-14) · https://github.com/tobihagemann/turbo
- **Why:** The strongest PR/ship workflow collection studied: full PR lifecycle (create, review, resolve comments, reply threads), iterative polish loop, audit, dependency maintenance — the stages GSD and superpowers don't cover.
- **Imported (50 of 74):** finalize, audit, review-code, polish-code, find-dead-code, simplify-code/docs, investigate, create-threat-model, 4 testing skills, 4 dependency/tooling skills, 4 findings skills, all 15 git/GitHub skills, 5 external-tool skills (Codex peer review — degrade gracefully), 5 rules skills, self-improve, note-improvement, create-handoff, recall-reasoning.
- **Modified:** `~/.claude/skills/` self-references rewritten to project-local `.claude/skills/`.
- **Excluded (24):** all 11 planning skills + turboplan + implement + implement-improvements (GSD owns planning; `resolve-findings` plan-path routes to `/gsd:plan-phase`), onboard, map-codebase (GSD has `/gsd:map-codebase`), explain-this, understand-change (tutoring, not factory).

### garrytan/gstack — product, plan review & design layer
- **Commit:** `14fc086` (2026-06-13, v1.58.0.0) · MIT · https://github.com/garrytan/gstack
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

### refactoringhq/tolaria — end-user app, AGPL (not importable)
- **Commit:** `0937e23` (2026-06-14) · **AGPL-3.0** · https://github.com/refactoringhq/tolaria
- **What it is:** a Tauri desktop app (macOS/Win/Linux, 1,870 files, Rust + Vite/React) for managing markdown knowledge bases — a files-first/git-first "second brain" / AI-context vault by Luca Ronin (Refactoring.fm). Ships an MCP server so agents can read/write the vault.
- **Why rejected (two independent reasons):** (1) **Not a skill/agent/command toolkit** — it's a finished end-user product, not capabilities the factory imports (unlike last30days). Its `.claude/commands` (`laputa-*`) are tied to the author's personal Todoist/Laputa dev workflow, not generalizable. (2) **AGPL-3.0 is incompatible with the factory's model** — the factory builds products that are handed to paying customers; AGPL's network-copyleft would impose source-disclosure obligations on derivatives. The factory already has files-first git repos + `.planning/` markdown, so there's no capability gap it fills.
- **Note:** still a solid *personal* tool if the founder wants an Obsidian-style vault for their own notes — but that's separate from the factory toolkit, and nothing from it was imported.

### gsd-build/get-shit-done
- **Commit:** `bdcaab2` (2026-05-31) — **archived.** README redirects to open-gsd/gsd-core; identical command/agent set at archive time, no development since. gsd-core supersedes it (MVP mode, milestone-prefixed phases, better model routing).

### pulumi/agent-skills — reference only
- **Commit:** `43626f2` (2026-06-03) · https://github.com/pulumi/agent-skills
- 13 of 14 skills hard-require Pulumi (ESC, Pulumi Cloud, Neo). Well-built, actively maintained — import (`/plugin marketplace add pulumi/agent-skills`) only if Pulumi becomes the factory's IaC tool. For generic IaC, antonbabenko/terraform-skill is the catalog's alternative.

### github.com/resources/articles/ai-in-software-development — framing only
- Editorial, no code. Its six SDLC stages (plan, design, develop, test, deploy, maintain) informed the pipeline structure in CLAUDE.md.

## Evaluated — not adopted

### chopratejas/headroom — context-compression proxy (cost lever) — TRIAL COMPLETE: do not adopt
**Verdict (2026-06-14, Phase-2 complete): not worth adopting for this factory.** The integration is clean and safe — the proxy ran real `claude -p` agents on Claude Code **subscription auth** with no auth wall, output quality intact, stable. But on real agent traffic it delivered **0% savings**: 9 requests / 67K tokens, **0 compressed** (`prefix_frozen: 3`, `too_small: 2`, `no_compressible_content: 4`). The cost breakdown is the reason — `cache_savings_usd: 1.50` (Anthropic **prompt caching** already captured the savings) vs `compression_savings_usd: 0.00`, net **savings_pct: 0.0**. Headroom correctly *defers* to the cache (won't compress a cached prefix — doing so would break the cache and cost more). Its compression is for clients that DON'T prompt-cache; Claude Code already does. So it would only add an extra proxy in every agent's critical path for ~0 benefit here. Kept as a reference; revisit only if the factory ever runs large-context agents on a non-caching client.

### chopratejas/headroom — context-compression proxy (cost lever)
- **Commit:** `01fdedc` (2026-06-13, v0.25.0) · Apache-2.0 · https://github.com/chopratejas/headroom · PyPI `headroom-ai`, npm `headroom-ai`
- **What:** "Context compression layer for AI agents" — a local-first proxy/library/MCP that compresses what agents read (tool outputs, logs, RAG, history) before it reaches the LLM. Claims 60–95% fewer tokens via 6 algorithms, reversible. Not a skill — it's infrastructure (a 3,200-file Rust+Python app); NOT vendored into the kit.
- **Why it matters here:** the factory runs many large-context Opus agents (strategy/PRD/design/build/QA); compression could materially cut token cost. Counter-risk: it's a lossy layer between every agent and the model, which directly threatens the factory's quality-first promise — so adoption is gated on validation (per the iron rule).
- **Phase-1 trial (2026-06-14, library in a throwaway venv):** installs cleanly; light deps (litellm, tiktoken, tokenizers, ast-grep — no torch/transformers); safe. On a dense 62K-token QA report it did **0% reduction with 100% fidelity** — it is **lossless-by-default and PROTECTS user/authored content** (`transforms_applied: router:protected:user_message`). Verdict: **low quality-risk, but savings UNPROVEN** in standalone use — the 60–95% only applies to redundant tool-result traffic seen through the proxy.
- **Phase-2 (decisive, pending an idle factory):** run a real product build through `headroom proxy` (point spawned `claude -p` agents at it via base-URL) and A/B vs baseline — compare token savings AND QA pass/quality. Adopt factory-wide only if quality holds and savings are real. Adoption path if it passes: `headroom` Claude Code plugin (`headroom-agent-hooks` / openclaw) or run the proxy as a service; never vendor the repo.

## Reference catalog

### TheJambo/awesome-testing — testing knowledge index (reference, not importable)
- **Commit:** `4c75061` (2026-06-12) · CC0 · https://github.com/TheJambo/awesome-testing
- **What:** a curated link list of testing resources/tools (API, security, AI&LLM, visual, e2e, performance, a11y, test-data, books, blogs). Links, not skills/code — nothing to vendor.
- **Already covered by the factory:** API testing, security (`cso`), accessibility (`a11y-playwright-testing`), e2e (`playwright-*`), exploratory/smoke, contract testing — the QA stack is strong here.
- **Gaps it surfaces worth considering (not yet adopted):**
  1. **Visual regression** — the factory has `design-review` (subjective AI visual QA) but no automated baseline screenshot/DOM regression. Playwright's native `toHaveScreenshot()` would catch UI regressions on every change with zero new deps — a real change-safety + experience-rule win.
  2. **AI/LLM-product testing** — `promptfoo` (test/red-team prompts + RAG), `AgentSkeptic` (verify agent workflows via DB state). Relevant only when the factory *builds an AI-powered product*; the QA gate could add an LLM-eval/red-team pass for those.
- **Status:** reference only; the two gaps above are candidate QA additions pending founder go-ahead.
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
