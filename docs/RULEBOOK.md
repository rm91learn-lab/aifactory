# The AI-Factory Rulebook

The operating rules of this factory. **[M]** = machine-enforced by the daemon (agents cannot skip it). **[S]** = standing order in every agent's instructions.

## 1 · Production — the iron rule

1. **Nothing reaches production without passing independent QA. Period.** [M] Agents deploy to a hidden staging copy; only the factory promotes to production, and only on a QA PASS.
2. **Builder and tester are different agents.** [M] Every build and change is attacked by a fresh QA agent with no knowledge of the implementation: real-browser journeys (Playwright), realistic sample files for every promised input format, accessibility scan (axe/WCAG), mandatory code review and OWASP security pass. No verdict file = treated as untested.
3. **QA failure triggers one fix-and-retest round, then an honest stop.** [M] No infinite loops, no quiet shipping of "probably fine."
4. **Every promotion is canaried.** [M] Ten minutes of live checks; two failures roll production back to the previous version within about a minute, and the corrected fix re-enters the full pipeline.
5. **Sole exception:** a product's first-ever deployment (zero users exist). QA still gates whether it is announced as done. [M]

## 2 · Engineering discipline

6. **No promised path may silently not work.** [S] Every input type, format, and option the interface offers must be proven end-to-end with a realistic example. A graceful fallback is required engineering but never counts as the feature working. Never ship copy that promises what the code skips.
7. **Failing test first.** [S] Bugs are reproduced with a test before being fixed; features get their test before their code. The full suite must be green before any commit.
8. **Root cause only.** [S] No patching symptoms; systematic investigation before any fix.
9. **No completion claims without fresh verification evidence.** [S]
10. **Undocumented work is invisible work.** [S] Requirements and roadmap files are mandatory — the founder's board is generated from them; every change is logged permanently as a board entry.

## 3 · Money & safety — hard limits

11. **Never create accounts, never spend money, never enable paid features or add payment methods.** [S] Hosting is Cloudflare free tier; if a product outgrows it, the founder gets a plain-language note — never a bill.
12. **Never delete data or infrastructure; never force-push; never publish packages.** [S]
13. **Never silence a test, health check, or alert to make a problem disappear.** [S]
14. **If only a human can act** (credentials, billing, account issues): stabilize, then send ONE concrete plain-language instruction. [S]

## 4 · The founder interface

15. **Nothing is created from a bare message.** [M] Every idea goes through: what is this (new / which product / ignore) → what's it called → final ✅ confirmation. `/cancel` stops everything at any time.
16. **Only the allowlisted chat commands the factory.** [M] Unknown senders get a polite refusal.
17. **The notification contract:** silence on no-ops, one plain-language line on material events, a question only when a human is genuinely required. [M]
18. **Every report ends in founder language.** [S] What a customer would notice — no jargon. Technical detail lives in the repos for engineers and buyers.

## 5 · Operations & resilience

19. **Every product lives in its own private repo**, pushed after every phase — requirements, decisions, QA reports, and incident reports form a permanent, client-showable audit trail. [S/M]
20. **Every live product is watched 24/7.** [M] Health checks every 5 minutes; failures dispatch an incident agent.
21. **Incidents are stabilize-only.** [S/M] Restore the last QA-approved version; never fix-forward to production. The root-cause fix re-enters the full pipeline automatically.
22. **Transient provider failures retry themselves once** before being reported. [M]
23. **The factory survives reboots and crashes** (system service, self-resurrecting) and its restarts cannot kill running builds. [M]
24. **The toolkit keeps itself current.** [M] Daily upstream checks; a judgment agent applies only material changes; an integrity check auto-reverts any upgrade that damages the kit. Upgrades may never touch the factory's own machinery or custom skills.

## 6 · Commerce

25. **Handoff is payment-gated.** [S] Before any repo transfers to a customer: full-history secrets scan, factory kit stripped, local mirror archived, version tagged. The `.planning/` audit trail ships with the product — it's part of what they bought.
26. **Re-engagement never pollutes the customer's repo.** [S/M] Adopted repos get the factory kit locally only (git-excluded); work is delivered via branches and pull requests.

---

*Every rule here was forged by a real failure or a founder decision, in one day of operation: the misnamed product became Rule 15; the invisible build became Rule 10 and the live activity feed; the self-graded tests became Rule 2; the PDF that "worked" became Rule 6; the passport extraction became the realistic-samples clause; the API outage became Rule 22; the founder's final decree — "nothing goes to production without thorough QA, period" — became Rule 1.*
