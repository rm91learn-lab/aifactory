#!/usr/bin/env bash
# Re-engage on a customer-owned repo: clone it and overlay the factory kit LOCALLY.
# The kit is registered in .git/info/exclude, so it can never be committed or pushed
# to the customer's repository.
# Usage: scripts/adopt-product.sh <git-url> [name]
set -euo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:?usage: scripts/adopt-product.sh <git-url> [name]}"
NAME="${2:-$(basename "$URL" .git)}"
DEST="$FACTORY_DIR/products/$NAME"

if [ -e "$DEST" ]; then
  echo "error: $DEST already exists" >&2
  exit 1
fi

git clone "$URL" "$DEST"
cp -R "$FACTORY_DIR/.claude" "$DEST/.claude"
if [ ! -e "$DEST/CLAUDE.md" ]; then
  sed "s/<PRODUCT NAME>/$NAME/" "$FACTORY_DIR/docs/templates/PRODUCT-CLAUDE.md" > "$DEST/CLAUDE.md"
fi

# Local-only ignores: factory tooling and planning state stay on this machine.
{
  echo '.claude/'
  echo 'CLAUDE.md'
  echo '.planning/'
  echo '.turbo/'
} >> "$DEST/.git/info/exclude"

echo "Adopted: $DEST (customer repo, factory kit overlaid locally — never committed)"
echo "Next: cd products/$NAME && claude"
echo "Then: /gsd:import        # map the existing codebase and rebuild planning state"
echo "      work on branches and deliver via PRs — the customer owns the repo"
