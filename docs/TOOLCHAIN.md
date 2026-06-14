# The AI-Factory Testing & Dev Toolchain

The sanctioned tools the factory's **Build** and **QA** stages reach for. These are *libraries / CLIs / apps*, **not** Claude Code skills — they are **never vendored into the kit**. Each product installs only what its stack needs (`npm`/`pnpm`, `pip`/`uv`, `go get`, etc.), so the kit stays lean and products carry their own, handoff-clean dependencies.

Pick by the product's stack and need — don't install all of them. All are the current, actively-maintained leader for their job.

## Browser / end-to-end
| Tool | Role | License | When |
|---|---|---|---|
| **Playwright** | Cross-browser e2e + real-user journeys; `toHaveScreenshot()` for **visual regression** | Apache-2.0 | **Default** for web e2e (already the factory's QA browser). Use for the showroom/journey checks + visual baselines. |
| **Cypress** | Component + e2e testing, great DX | MIT | Alternative when a product/team already standardizes on it. |
| **Puppeteer** | Low-level Chrome automation/scraping | Apache-2.0 | When you need raw Chrome control, PDF/render, or scraping — not full e2e. |

## Unit / integration runners (choose by language)
| Tool | Stack | License |
|---|---|---|
| **Vitest** | JS/TS on Vite/modern bundlers — fast, ESM-native | MIT |
| **Jest** | JS/TS (React/Node) classic | MIT |
| **pytest** | Python | MIT |
| **testify** | Go (assertions + mocks) | MIT |
| **Catch2** | C++ | BSL-1.0 |

> Rule: write tests in the product's **native** runner — Vitest/Jest for JS/TS, pytest for Python, testify for Go, Catch2 for C++. TDD discipline (failing test first) applies regardless of runner.

## API testing
| Tool | Role | License | When |
|---|---|---|---|
| **Bruno** | Git-friendly API client — collections are plain files committed to the repo | MIT | **Default for committed API tests** (handoff-clean, no cloud account). |
| **Hoppscotch** | Fast web API client (Postman alternative) | MIT | Quick manual/exploratory API checks. |
| **keploy** | Auto-generate API tests + mocks from real traffic | Apache-2.0 | Bootstrap regression tests for an existing/!documented API. |

## Load / performance  *(fills the load-testing gap)*
| Tool | Role | License | When |
|---|---|---|---|
| **k6** | Scriptable load testing (JS), Grafana ecosystem | AGPL-3.0¹ | Default load test when a product has real throughput/latency requirements. |
| **Locust** | Python load testing, code-defined user behavior | MIT | When the product/test team is Python-first. |

¹ k6 is AGPL — but it's used **as an external CLI tool** to load-test; it is not linked into or shipped with the product, so it imposes **no license obligation on the product**. (Do not vendor its source.)

## Test data
| Tool | Role | License |
|---|---|---|
| **Faker** | Realistic fake data for tests + seed/demo datasets (`joke2k/faker` Python; `@faker-js/faker` for JS) | MIT |

> Use Faker for QA's "realistic example for every input the UI accepts" and for demo/seed data — never ship lorem-ipsum or empty states the founder will see.

## AI / LLM product testing  *(fills the AI-eval gap)*
| Tool | Role | License | When |
|---|---|---|---|
| **promptfoo** | Eval + red-team LLM prompts, RAG, and agents; prompt-injection checks; CI-friendly | MIT | **When the built product itself uses an LLM** — QA runs a promptfoo eval/red-team pass on its prompts. Skipped for non-AI products. |

## Component / UI workbench + visual  *(fills the visual-regression gap)*
| Tool | Role | License | When |
|---|---|---|---|
| **Storybook** | Component workbench + interaction/visual testing; pairs with Playwright/Chromatic for visual regression | MIT | Component-driven UI builds; QA visual baselines per component. Pairs with the taste-skills' premium components. |

## How the factory uses this
- **Build (stage 4):** write tests in the stack-native runner; generate realistic data with Faker; build UI component-first with Storybook where it helps; cover journeys with Playwright.
- **QA (stage 6):** Playwright e2e + visual regression for the showroom/experience checks; k6/Locust load test when performance is a stated requirement; Bruno/keploy for API products; promptfoo eval for AI-powered products.
- **Hand-off clean:** because nothing here is vendored into the kit, a transferred product carries only its own, standard, MIT/Apache (k6 tool-only) test dependencies — no factory lock-in.
