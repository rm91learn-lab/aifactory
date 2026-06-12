#!/usr/bin/env bash
# Scaffold a new product workspace carrying the AI-Factory toolkit.
# Usage: scripts/new-product.sh <product-name> [--github] [--owner <github-owner>]
#   --github  also create the GitHub repo and push (visibility: $FACTORY_REPO_VISIBILITY, default private)
set -euo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:?usage: scripts/new-product.sh <product-name> [--github] [--owner <owner>]}"
shift

GITHUB=false
OWNER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --github) GITHUB=true; shift ;;
    --owner) OWNER="${2:?--owner needs a value}"; shift 2 ;;
    *) echo "error: unknown option $1" >&2; exit 1 ;;
  esac
done

DEST="$FACTORY_DIR/products/$NAME"
if [ -e "$DEST" ]; then
  echo "error: $DEST already exists" >&2
  exit 1
fi

mkdir -p "$DEST"
cp -R "$FACTORY_DIR/.claude" "$DEST/.claude"
sed "s/<PRODUCT NAME>/$NAME/" "$FACTORY_DIR/docs/templates/PRODUCT-CLAUDE.md" > "$DEST/CLAUDE.md"
printf '.turbo/\nnode_modules/\n.DS_Store\n.factory-activity.json\n' > "$DEST/.gitignore"
git -C "$DEST" init -q
git -C "$DEST" add -A
git -C "$DEST" commit -qm "factory: scaffold product workspace"

if [ "$GITHUB" = true ]; then
  [ -n "$OWNER" ] || OWNER="$(gh api user --jq .login)"
  VISIBILITY="${FACTORY_REPO_VISIBILITY:-private}"
  gh repo create "$OWNER/$NAME" "--$VISIBILITY" --source "$DEST" --remote origin --push
  echo "GitHub repo: https://github.com/$OWNER/$NAME"
fi

echo "Product workspace ready: $DEST"
echo "Next: cd products/$NAME && claude"
echo "Then: /gsd:new-project   (or /gsd:autonomous after the roadmap exists)"
