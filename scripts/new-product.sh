#!/usr/bin/env bash
# Scaffold a new product workspace carrying the AI-Factory toolkit.
set -euo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:?usage: scripts/new-product.sh <product-name>}"
DEST="$FACTORY_DIR/products/$NAME"

if [ -e "$DEST" ]; then
  echo "error: $DEST already exists" >&2
  exit 1
fi

mkdir -p "$DEST"
cp -R "$FACTORY_DIR/.claude" "$DEST/.claude"
sed "s/<PRODUCT NAME>/$NAME/" "$FACTORY_DIR/docs/templates/PRODUCT-CLAUDE.md" > "$DEST/CLAUDE.md"
printf '.turbo/\nnode_modules/\n.DS_Store\n' > "$DEST/.gitignore"
git -C "$DEST" init -q

echo "Product workspace ready: $DEST"
echo "Next: cd products/$NAME && claude"
echo "Then: /gsd:new-project   (or /gsd:autonomous after the roadmap exists)"
