#!/bin/bash
# Ledger Terminal daily pipeline wrapper — invoked by launchd (5:05 AM daily).
# Pull fresh market data, publish to GitHub Pages, notify on failure.
set -uo pipefail

REPO="$HOME/Projects/ledger-terminal"
LOCK_SCRIPT="$HOME/.claude/scripts/automation-lock.sh"
NOTIFY="$HOME/.claude/scripts/discord-notify.sh"
LOG_TAG="ledger-terminal"

cd "$REPO" || exit 1

# --- concurrency guard (ecosystem convention) ---
if [[ -f "$LOCK_SCRIPT" ]]; then
  # shellcheck source=/dev/null
  source "$LOCK_SCRIPT"
  if ! acquire_automation_lock "$LOG_TAG" 1800; then
    echo "[$LOG_TAG] could not acquire automation lock — exiting"
    exit 0
  fi
fi

fail() {
  local msg="$1"
  echo "[$LOG_TAG] FAIL: $msg"
  if [[ -x "$NOTIFY" ]]; then
    "$NOTIFY" "Ledger Terminal pipeline failed" "$msg" --severity info --automation-name ledger-terminal || true
  fi
  exit 1
}

# --- 1. pull fresh data ---
if ! /usr/bin/python3 pipeline/update.py > >(tee /tmp/ledger-terminal-run.log) 2>&1; then
  fail "update.py exited non-zero — tail: $(tail -c 400 /tmp/ledger-terminal-run.log)"
fi

# --- 2. publish (commit only if data actually changed) ---
git add docs/data
if git diff --cached --quiet; then
  echo "[$LOG_TAG] no data changes — nothing to publish"
else
  git commit -m "market data $(date +%F)" --quiet || fail "git commit failed"
  if ! git push --quiet 2>/tmp/ledger-terminal-push.log; then
    fail "git push failed (auth rot?): $(tail -c 300 /tmp/ledger-terminal-push.log)"
  fi
  echo "[$LOG_TAG] published market data $(date +%F)"
fi

# --- 3. housekeeping ---
git gc --auto --quiet || true
echo "[$LOG_TAG] done"
