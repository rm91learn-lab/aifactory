---
name: fix-ci
description: Debug and fix failing CI checks on the current branch or a PR. Use when GitHub Actions (or other CI) checks fail and the cause must be found, reproduced locally, fixed, and pushed until the run is green.
---

# Fix CI

Get a red CI run back to green by finding the actual cause — never by retrying blindly or weakening the check.

## Workflow

**1. Identify the failure**
- `gh run list --branch <branch> --limit 5` to find the failing run; `gh pr checks <number>` when working from a PR.
- `gh run view <run-id> --log-failed` to pull only the failing job logs.
- Classify the failure: test, lint/format, type check, build, dependency resolution, infrastructure/runner, or flake.

**2. Reproduce locally**
- Find the exact command CI ran (read the workflow file under `.github/workflows/`) and run it locally with the same flags.
- If it passes locally, compare environments: Node/Python/tool versions, lockfile state, env vars, OS. Pin the difference before touching code.
- If it cannot be reproduced after two honest attempts and the history shows intermittent passes, treat it as a flake: fix the flake (timing, ordering, shared state) — do not add retries to mask it.

**3. Root-cause and fix**
- For non-trivial test or runtime failures, invoke the `systematic-debugging` skill — no fixes without a root cause.
- Never delete or skip a failing test, loosen an assertion, or disable a lint rule to get to green unless the check itself is verifiably wrong — and say so explicitly in the commit message.

**4. Verify and push**
- Re-run the exact CI command locally and confirm it passes (apply `verification-before-completion`).
- Commit with a message that names the root cause, push, then watch the run: `gh run watch <run-id>` or poll `gh pr checks`.
- Done only when the full check suite is green, not when the previously failing job passes.

## Output

Report: root cause, the fix, evidence the run is green (run URL), and any follow-up debt noticed along the way.
