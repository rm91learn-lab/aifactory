---
name: post-deploy-monitor
description: Verify a deployment stays healthy after it ships — health checks over time, log scanning for new errors, smoke of the critical path, and a clear rollback call if degraded. Use immediately after deploying to production or staging.
---

# Post-Deploy Monitor

A deployment isn't done when the command exits — it's done when production is provably healthy. This is the canary window.

## Workflow

**1. Establish the baseline**
- Record: deployed commit/version, deployment URL, timestamp, and what changed (one line).
- Note the platform's log/metrics commands (`vercel logs`, `wrangler tail`, `fly logs`, `kubectl logs`, hosting dashboard).

**2. Health-check loop (~10 minutes, three passes)**
- Immediately, at ~3 minutes, and at ~10 minutes:
  - `curl -s -o /dev/null -w "%{http_code} %{time_total}s"` against the health endpoint or root URL — require 200s and latency in line with the first pass.
  - Pull logs since deploy time and grep for new error signatures (5xx, stack traces, `ERROR`, `FATAL`, OOM, unhandled rejections).
- Between passes, continue other work or wait — don't skip the later passes; slow failures (memory, connection pools, cold caches) appear after the first minutes.

**3. Smoke the critical path once**
- Exercise the single most important user flow end to end (the smoke-test skill for UIs, `curl` sequences for APIs). Compare against expected output, not just status codes.

**4. Verdict**
- **Healthy**: all passes clean → report version, evidence (status codes, log summary), and close out.
- **Degraded** (new errors, elevated latency, failed smoke): **roll back first, investigate second.** Use the platform's rollback (previous deployment promote/alias, `fly releases rollback`, `kubectl rollout undo`, redeploy previous tag). Confirm the rollback is healthy with one more pass, then run `/investigate` on the captured evidence.
- Never leave a degraded deploy live while debugging, and never call a deploy healthy without the later passes.

## Output

A short report: version, window covered, checks run, verdict, and (if rolled back) the rollback evidence plus the investigation handoff.
