---
name: deploy
description: Deploy the current project to its target environment. Detects the platform (Vercel, Cloudflare, Fly.io, Render, Docker, Kubernetes, npm, static hosting), runs pre-deploy gates, deploys, and verifies the deployment is live. Use when a change is merged and ready to go out.
---

# Deploy

Ship the current state of the project to its target environment with gates before and verification after.

## Workflow

**1. Detect the platform**

Look for, in order: explicit instructions in the product's CLAUDE.md or docs; then config files:

| Signal | Platform | Deploy command |
|---|---|---|
| `vercel.json` / `.vercel/` | Vercel | `vercel deploy --prod` |
| `wrangler.toml` / `wrangler.jsonc` | Cloudflare | `wrangler deploy` |
| `fly.toml` | Fly.io | `fly deploy` |
| `render.yaml` | Render | git push to deploy branch |
| `Dockerfile` + compose file | Docker host | `docker compose up -d --build` |
| `k8s/`, `helm/`, `kustomization.yaml` | Kubernetes | `kubectl apply -k` / `helm upgrade --install` |
| publishable `package.json` | npm registry | `npm publish` (prefer via /release) |
| static site output | Pages/S3/etc. | per project docs |

If nothing matches, ask the user where this deploys rather than guessing.

**2. Pre-deploy gates (all must pass)**
- Working tree clean and on the expected branch (usually main, or the branch the platform deploys from).
- Full test suite passes locally.
- Production build succeeds locally (`npm run build` or equivalent).
- CI on the deploying commit is green (`gh run list` / `gh pr checks`). If red, stop and run `/fix-ci` first.

**3. Deploy**
- Deploy to a staging/preview target first when the platform supports it; promote to production only after the staging check passes.
- Capture the deployment URL and identifier from the command output.

**4. Verify**
- Hit the health endpoint or root URL; require HTTP 200 and sane latency.
- Load one critical user path (the smoke-test skill or `curl` for APIs).
- Tail platform logs briefly for new errors (`vercel logs`, `wrangler tail`, `fly logs`, `kubectl logs`, etc.).

**5. Hand off**
- On success: write `DEPLOY.json` at the repo root and commit+push it — this enrolls the product in the factory's continuous monitoring watchdog:
  ```json
  { "url": "https://the-deployed-url", "healthPath": "/", "platform": "vercel|cloudflare|fly|render|docker|k8s", "deployedAt": "<ISO timestamp>" }
  ```
- Report URL, version/commit deployed, and start `/post-deploy-monitor` for the immediate canary window.
- On failure: roll back using the platform's mechanism (previous deployment alias/release) BEFORE investigating, then run `/investigate` on the captured logs.

Never deploy uncommitted work, and never deploy with failing gates "just this once."
