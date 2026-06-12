---
name: release
description: Cut a versioned release — choose the semver bump from actual changes, update version files and changelog, tag, push, and create a GitHub release. Use when merged work is ready to be versioned and published.
---

# Release

Turn merged work into a versioned, documented, tagged release.

## Workflow

**1. Preconditions**
- On the default branch, working tree clean, up to date with remote (`git pull --ff-only`).
- CI green on HEAD. If red, run `/fix-ci` first.

**2. Determine the version bump**
- Find the last release: `git describe --tags --abbrev=0` (if no tags exist, this is `v0.1.0` — say so and confirm with the user).
- Read the actual changes since then: `git log <last-tag>..HEAD --oneline` plus the diff for anything ambiguous.
- Semver from the changes themselves, not commit-message prefixes alone: breaking API/behavior change → major; new functionality → minor; fixes/internal only → patch.

**3. Update release artifacts**
- Bump the version everywhere it lives (`package.json`, `pyproject.toml`, `VERSION`, `Cargo.toml` — search, don't assume one).
- Update `CHANGELOG.md` following the `changelog-rules` skill: user-facing language, grouped by Added/Changed/Fixed, dated.
- Commit: `release: vX.Y.Z`.

**4. Tag and publish**
- `git tag -a vX.Y.Z -m "vX.Y.Z"` and `git push --follow-tags`.
- `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(extract this version's changelog section)` — release notes mirror the changelog, no invented content.
- If the project publishes a package (npm, PyPI, crates.io), publish now — but confirm with the user before the first-ever publish of a package name.

**5. Hand off**
- If a release triggers deployment via CI, watch the pipeline (`gh run watch`). If deployment is manual, run `/deploy`.
- Report: version, tag URL, release URL, what shipped in one sentence.
