#!/usr/bin/env bash
# rebuild-dev.sh — kill any existing dev server on port 3003, typecheck, and restart.
#
# Use this whenever you need a clean dev server restart (after pulling changes,
# switching branches, or if the dev server got into a bad state).
#
# DO NOT use this for production (port 3002). Production uses deploy-standalone.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3003}"
LOG_PATH="${LOG_PATH:-/tmp/mc-dev.log}"

cd "$PROJECT_ROOT"

# ── Safety: warn if on main ─────────────────────────────────────────────
branch="$(git branch --show-current 2>/dev/null || echo unknown)"
if [[ "$branch" == "main" ]]; then
  echo "WARNING: you are on the 'main' branch. Dev work should be on a feature branch." >&2
  echo "         Continue anyway? (Ctrl-C to abort, Enter to proceed)" >&2
  read -r _
fi

# ── Kill existing process on port 3003 ──────────────────────────────────
stop_port() {
  local pids
  pids="$(ss -ltnp 2>/dev/null | awk -v port=":$PORT" '
    index($4, port) || index($5, port) {
      if (match($0, /pid=[0-9]+/)) print substr($0, RSTART+4, RLENGTH-4)
    }
  ' | sort -u)"

  if [[ -n "$pids" ]]; then
    echo "==> stopping existing process(es) on port $PORT: $pids"
    echo "$pids" | xargs -r kill 2>/dev/null || true
    sleep 2
  fi
}
stop_port

# ── Typecheck gate ──────────────────────────────────────────────────────
echo "==> typecheck"
pnpm typecheck

# ── Start dev server ────────────────────────────────────────────────────
echo "==> starting dev server on port $PORT (log: $LOG_PATH)"
PORT="$PORT" nohup pnpm dev >"$LOG_PATH" 2>&1 &
dev_pid=$!
echo "$dev_pid" > "$PROJECT_ROOT/.mc-dev.pid"

# ── Wait for server to respond ──────────────────────────────────────────
echo "==> waiting for dev server..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/login" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

status=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/login")
if [[ "$status" != "200" && "$status" != "307" ]]; then
  echo "error: dev server returned HTTP $status — check $LOG_PATH" >&2
  exit 1
fi

echo "==> dev server ready"
echo "    branch=$branch pid=$dev_pid port=$PORT"
echo "    log: $LOG_PATH"
echo "    stop: kill \$(cat $PROJECT_ROOT/.mc-dev.pid)"
