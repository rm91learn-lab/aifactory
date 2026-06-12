# factory-console v2 — change request (queued)

This is the verbatim change request to send to factory-console once it's cut over and the floor is quiet. It is one founder request; the factory runs it through the normal update → independent-QA → staged-deploy pipeline.

---

Add two things to factory-console, on top of what exists. Do not break the data contract, the push/inbox auth, or the existing dashboard grid.

## 0. DECOMMISSION the kanban board

Remove the column/card kanban from the product page entirely. It reads as a generic task tracker and does not convey a live autonomous factory. Replace it with the live build view (section 1). Keep the audit data (phases, tasks) available, but the PRIMARY product view is the living pipeline, not columns.

## 1. Live build view — the primary product page (mind-blowing, near-real-time)

The hero of the console. When a product card is clicked, the page must feel like watching a machine build software in real time — motion, streaming, live numbers — distinctive enough to win a customer demo. It is a rendering of data the factory already emits (activity feed, counters, stage, agents) — no new backend plumbing required.

Required elements:
- **Living pipeline rail** of the 8 AI-driven stages (1 Capture · 2 Plan · 3 Design · 4 Build · 5 QA · 6 Release · 7 Operate · 8 Evolve): completed nodes filled/checked, the active node pulsing, a progress line that fills toward the active stage, a moving indicator. Derive the current stage from the snapshot: building+phases→Build; QA verdict present + building→QA; DEPLOY-STAGED awaiting promote→Release; deployed+healthy, not building→Operate; has shipped changes→Evolve; pre-build→Capture/Plan/Design from .planning.
- **Live counters** that animate (count up) when values change: tests passing, files written, tasks done/total, agents active. Round all numbers.
- **Agents at work** row: a chip per active agent with what it's doing right now (from the activity stream's latest per-agent action), with a subtle "working" pulse.
- **Streaming activity log**: newest-first, auto-appends as new activity arrives, timestamps, agent name accented, capped to a readable window with a gentle fade-in. This is the mesmerizing centrepiece — it must visibly move while a build runs.
- **Footer**: staged-preview-under-QA note, open-demo button, and the "ask for a change" entry to the chat panel (section 2).
- Motion is required but tasteful: pulse, flow, count-up, stream — NO neon/glow gimmicks. The product has its own dark theme; make it premium, not noisy. Mobile-first: the pipeline scrolls horizontally; the stream stacks.
- When NOT building (idle/operate), the same view settles: pipeline rests on the current stage, counters static, the stream shows recent history, health is prominent. It must look intentional at rest, not "dead".

### Per-stage detail (below the live view)
Tailor a detail section to the ACTIVE stage (fall back gracefully when a field is absent):
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

## 3. Editable scope (roadmap as control surface) — founder-confirmed addition

The roadmap's requirements are editable from the console; edits re-plan the build.

- In the Plan-stage drill-down, each requirement is editable: remove (x) or add a new feature per phase. Show a pending-changes count and an "Apply to build" action. Founder-only (behind viewer auth).
- Apply submits a SCOPE edit via the inbox (`POST /inbox` with `kind:"scope"`, body carrying the added/removed items per phase). The Apply click is the founder confirmation.
- Daemon side (extend the inbox poller): a `kind:"scope"` item dispatches a scope-edit job that (a) rewrites `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` to reflect the edits, (b) re-plans remaining work, (c) builds ADDED items as new tasks and drops REMOVED-not-yet-built items from upcoming stages. Roadmap counts/% recompute from the updated files.
- Guardrails: added features still go through the full build → independent QA → staged → promote pipeline (no editing around QA). Removing a not-yet-built feature just drops it; removing an already-shipped feature stops future work and hides it from scope but does NOT rip out shipped code — that requires a separate explicit "remove the X feature" request. Edits are founder-only.

## Drill-down + dual view (refinement to section 1)

- Each task in the roadmap is itself expandable to show the real artifact behind it: requirements → REQUIREMENTS.md content; decisions → ASSUMPTIONS.md; build tasks → files + a demo link; QA → QA-REPORT.md; release → DEPLOY.json/canary; evolve → ROADMAP change history. Three levels: stage → task → evidence.
- Offer both views from one screen: the zig-zag drill-down roadmap as the default ("where are we + proof"), and a "watch live" button into the immersive production-line animation ("watch it work"). Both responsive (container-query reflow to a single column on mobile).

## 3a. Scope edits ripple through the WHOLE product (clarified)

A roadmap edit is a change to the product's source-of-truth scope (`REQUIREMENTS.md`), allowed at ANY time — mid-build or long after launch. It must be absorbed coherently, never as an isolated add/remove. The daemon routes `kind:"scope"` inbox items to a scope-edit agent (see daemon/scope-prompt.md) that: updates REQUIREMENTS.md/ROADMAP.md as source of truth → does impact analysis across data model, APIs, UI/nav, permissions, related features, tests and docs (writes .planning/IMPACT.md) → implements coherently (added features wired into everything they touch; removed features cleanly excised with no orphans) → keeps the full suite green and lets independent QA regression-test the ENTIRE product, not just the change → stages, and the factory promotes only on PASS. Removing shipped features that would strand user data or break live users must be flagged, not done destructively.
