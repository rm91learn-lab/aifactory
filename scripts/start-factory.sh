#!/usr/bin/env bash
# Start the AI-Factory daemon. Reads the Telegram token from daemon/.env
# (a local file that is never committed to git).
set -euo pipefail
FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "$FACTORY_DIR/daemon/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$FACTORY_DIR/daemon/.env"
  set +a
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "No bot token yet. Put it in $FACTORY_DIR/daemon/.env as:" >&2
  echo '  TELEGRAM_BOT_TOKEN=123456789:ABC...' >&2
  exit 1
fi

exec node "$FACTORY_DIR/daemon/factory-daemon.mjs"
