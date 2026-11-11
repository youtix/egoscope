#!/bin/sh
# Runs the whole quality gate (`bun run gate:ci`, the same steps as CI, in CI's
# order) while holding a lock shared by every worktree of this clone: several
# agents share one small machine, so only one heavy run may use it at a time.
set -eu

lock_file="$(git rev-parse --path-format=absolute --git-common-dir)/egoscope-gate.lock"

if ! command -v flock >/dev/null 2>&1; then
  echo "gate: flock is not installed; running without the cross-worktree lock." >&2
  exec bun run gate:ci
fi

if ! flock --nonblock "$lock_file" true; then
  echo "gate: another worktree is running the gate; waiting for it to finish..." >&2
fi
exec flock "$lock_file" bun run gate:ci
