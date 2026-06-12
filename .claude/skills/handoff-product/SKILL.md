---
name: handoff-product
description: Transfer a finished product repo to the customer after payment — full-history secrets scan, strip the factory kit, archive a local mirror, tag, and execute the GitHub repo transfer. Use when a product is paid for and ready to hand over to the client.
---

# Handoff Product

Deliver a sold product: the customer gets a clean repo they fully own; the factory keeps an archive. The transfer itself is irreversible from our side — every gate before it must actually pass.

## Inputs (collect before doing anything)

- Product name (must exist under `products/<name>` with an `origin` remote we own).
- Customer's GitHub username or org to transfer to.
- Explicit confirmation from the operator that **payment has cleared**. Never transfer without it.

## Workflow

**1. Pre-flight gates (all must pass)**
- Working tree clean, branch pushed, CI green on HEAD.
- `FINAL-REPORT.md` exists and reflects the delivered state.
- The product runs: at minimum the test suite passes fresh; for deployed products the live URL is healthy.

**2. Secrets scan — full history, not just HEAD**
- Prefer `gitleaks git .` if installed. Fallback: `git log -p --all | grep -nE '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|xox[bp]-|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|password\s*[:=]\s*['\"][^'\"]{6,})'`
- Any hit: STOP. Rotate the credential first, then scrub history (`git filter-repo`) only if the customer relationship requires it, and re-scan. Never transfer a repo with a live secret in history.

**3. Archive a mirror for the factory (we lose the repo on transfer)**
- `mkdir -p archives && git clone --mirror products/<name> archives/<name>-$(date +%Y%m%d).git`
- `archives/` is gitignored — it stays on this machine. This preserves the FULL history including the factory kit and `.planning/`, for support work and portfolio.

**4. Strip the factory kit from HEAD**
- `git rm -r .claude CLAUDE.md` and `.turbo/` if tracked. **Keep `.planning/`** — the requirements → roadmap → assumptions trail documents what was agreed and built; it's part of the deliverable.
- Note: stripping removes the kit from the working tree, not from history. That's intentional — everything in the kit is MIT-licensed open source; the value is curation, not secrecy. Do not rewrite history for this.
- Commit: `handoff: remove development tooling`.

**5. Client-facing polish**
- README must cover: what this is, how to run locally, how to deploy, where the docs live. If thin, run `document-generate` first.
- Confirm LICENSE/ownership matches the contract. Add a line to FINAL-REPORT.md: "IP and repository transferred to <customer> on <date> per agreement."

**6. Tag and push**
- `git tag -a v1.0-handoff -m "Handoff to <customer>"` (or the next version if releases exist) and `git push --follow-tags`.

**7. Transfer**
- Final confirmation with the operator (show customer name, repo, tag), then:
  `gh api repos/<owner>/<name>/transfer -f new_owner=<customer>`
- Personal-account recipients must accept the transfer (GitHub emails them); org targets may need admin rights. Report the pending state honestly — done means *accepted*, not requested.

**8. Close out in the factory**
- Append a line to `docs/HANDOFFS.md`: date, product, customer, tag, archive path.
- Optionally remove `products/<name>` (the archive is the record); regenerate the dashboard (`node scripts/build-dashboard.mjs`).

## Output

Report: customer, transferred repo URL, tag, archive path, secrets-scan result, and whether the transfer is accepted or pending acceptance.
