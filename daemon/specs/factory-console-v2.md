# factory-console v2 — change request (queued)

This is the verbatim change request to send to factory-console once it's cut over and the floor is quiet. It is one founder request; the factory runs it through the normal update → independent-QA → staged-deploy pipeline.

---

Add two things to factory-console, on top of what exists. Do not break the data contract, the push/inbox auth, or the existing dashboard grid.

## 1. Per-stage product page (8 stages)

When a product card is clicked, the product page shows the product's position across the 8 AI-driven development stages and tailors the detail to the ACTIVE stage. Stages: 1 Capture · 2 Plan · 3 Design · 4 Build · 5 QA · 6 Release · 7 Operate · 8 Evolve.

- A stage rail at the top: each stage a pill — completed = check, current = accented, future = muted. Derive the current stage from the snapshot: building+phases→Build; a QA-* verdict present and building→QA; DEPLOY-STAGED present awaiting promote→Release; deployed+healthy, not building→Operate; has shipped changes→Evolve; pre-build states map to Capture/Plan/Design from .planning artifacts.
- Beneath the rail, render the view for the active stage (fall back gracefully when a field is absent):
  - Capture: the original brief, chosen name, confirmation.
  - Plan: the requirements checklist (what's planned), the assumptions list (decisions made for you), the roadmap phases.
  - Design: design-system / preview info if present, else "design folded into build".
  - Build: live agent activity feed + the phase/task board + counters (tasks done, tests passing).
  - QA: the QA findings by area (functionality, inputs, accessibility, security) with pass/fail and the plain-language verdict; if failing, what's being fixed.
  - Release: promotion status, canary health over the window, the live URL; show rollback if it happened.
  - Operate: health (up/down, latency, last-checked), incidents auto-fixed with plain-language notes.
  - Evolve: dated history of shipped changes, learnings, the audit trail.
- All snapshot fields are optional; never blank-screen or crash on missing data. Keep it mobile-first and demo-friendly.

## 2. In-console chat panel (second doorway, alongside Telegram)

A chat panel on the product page so the founder can request a change or report a bug while a build is ongoing, without leaving the console.

- UI: a compact chat panel beside (desktop) or below (mobile) the product detail. A short message box, a kind toggle (Change / Bug), and a Send button. Show a running list of this product's submitted requests with their state (sent → picked up → in progress → done), driven by the snapshot.
- Confirm before sending: on Send, show the typed request back with a "Send to factory" / "Cancel" confirm step IN the panel. Only on confirm does it POST. (This is the web equivalent of Telegram's confirmation — nothing reaches the factory un-confirmed.)
- Submit endpoint (NEW): `POST /inbox`, protected by the SAME viewer Basic auth as the page. Body `{ "product": "<name>", "kind": "change"|"bug", "text": "<request>" }`. Append `{ id, product, kind, text, ts }` to KV (key `inbox:pending`, JSON array, cap 100, generate a short unique id without Math.random by using crypto.randomUUID). Return `{ ok:true, id }`.
- Daemon pull endpoints (NEW), protected by bearer PUSH_TOKEN (the same token used by `/update`):
  - `GET /inbox` → `{ items: [ {id, product, kind, text, ts}, ... ] }`
  - `POST /inbox/ack` with body `{ ids: [...] }` → remove those, return `{ ok:true, remaining:<n> }`
- The factory daemon already polls `GET /inbox` every 20s, enqueues each as a normal change/bug job, and acks them. So once these endpoints exist, the loop is live: type in the console → factory builds it → result shows on the board and via Telegram.
- Responses for v2 surface through the existing live activity feed + request-state list (true conversational replies in the panel are a later enhancement). Tell the founder, on send, "queued — watch this product's activity; you'll also get a Telegram update."

## Acceptance (independent QA must verify)

- Clicking a product opens the 8-stage page; the correct stage is active for a building product and for a healthy idle product.
- `POST /inbox` rejects without viewer auth; accepts with it; the item appears in `GET /inbox` (bearer) and is removed by `/inbox/ack`.
- The chat panel's confirm step is mandatory — no request is POSTed without it.
- Nothing crashes on a snapshot with missing fields / a product with no activity.
