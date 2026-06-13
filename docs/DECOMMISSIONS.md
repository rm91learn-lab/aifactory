# Decommissions

Record of retired production resources (per the safe-decommission rule in CLAUDE.md).

## 2026-06-13 — cloud dashboard workers (KV-push architecture retired)
- **aifactory-dashboard** (Cloudflare Worker + DASH KV) — the snapshot-push remote dashboard. Root cause for retirement: pushing ~3 KV writes every 20s exhausted Cloudflare's free KV write quota (1000/day), so `/update` failed (500) while reads served stale data. Architecturally unsuitable. **Archive:** worker source in `cloud/dashboard-worker.js`. **Replaced by:** live localhost:7717 dashboard + a Cloudflare tunnel for remote access.
- **factory-console** (Cloudflare Worker + FACTORY_CONSOLE_KV) — abandoned "dashboard as a separate cloud product" approach; superseded by building the dashboard into the daemon's generator (`scripts/build-dashboard.mjs`). **Archive:** GitHub repo `rm91learn-lab/factory-console`. Nothing in the daemon referenced it.
- Daemon cloud-push code (`pushDashboardOnline`) and `cloudDashboard` config removed in the same change. Verified: nothing else referenced these; daemon serves the dashboard locally and (soon) via tunnel.
