#!/usr/bin/env bash
# MC rebuild: build + copy static + restart service
# Usage: bash scripts/rebuild.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> Building MC..."
pnpm build

echo "==> Copying static assets to standalone..."
STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
rm -rf "$STANDALONE_DIR/.next/static"
cp -R "$PROJECT_ROOT/.next/static" "$STANDALONE_DIR/.next/static"
rm -rf "$STANDALONE_DIR/public"
cp -R "$PROJECT_ROOT/public" "$STANDALONE_DIR/public"

echo "==> Restarting mission-control service..."
systemctl --user restart mission-control

# Wait for service to be healthy
for i in 1 2 3 4 5; do
  sleep 2
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/ 2>/dev/null || echo "000")
  if [[ "$STATUS" == "307" || "$STATUS" == "200" ]]; then
    echo "==> MC is up (HTTP $STATUS)"
    exit 0
  fi
  echo "    waiting... ($i/5)"
done

echo "==> ERROR: MC did not come up. Check: journalctl --user -u mission-control"
exit 1
