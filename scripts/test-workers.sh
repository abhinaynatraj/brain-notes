#!/usr/bin/env bash
# Runs the Worker-bound vitest suite (D1 bindings via @cloudflare/vitest-pool-workers).
#
# Why this exists: the pool-workers runtime (workerd) cannot resolve module
# paths that contain a space, and this project lives under ".../Brain Notes/".
# A symlink doesn't help — vitest resolves it back to the real spaced path.
# So we mirror the source into a space-free dir that has its OWN node_modules
# and run the suite there. Source is re-synced every run so tests reflect the
# current code; node_modules is installed once and reused.
#
# Passes through any extra args (e.g. -t "test name").
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="${TMPDIR:-/tmp}/brain-notes-worktests"

mkdir -p "$MIRROR"

# Sync source (not .git, not node_modules) into the space-free mirror.
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  "$PROJECT_ROOT/" "$MIRROR/"

# Install deps in the mirror only if missing (first run or after a wipe).
if [ ! -d "$MIRROR/node_modules" ]; then
  echo "[test:workers] installing deps in space-free mirror (first run)..."
  (cd "$MIRROR" && npm install --no-audit --no-fund >/dev/null 2>&1)
fi

cd "$MIRROR"
# vitest exits 1 when no test files match. Until Worker-bound suites exist
# (Task 3+), treat "no test files found" as success so `npm test` stays green.
if ! ls test/workers/*.test.js >/dev/null 2>&1; then
  echo "[test:workers] no Worker-bound tests yet — skipping."
  exit 0
fi
npx vitest run --config ./vitest.config.js "$@"
