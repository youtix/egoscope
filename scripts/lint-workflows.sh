#!/bin/sh
# Lints the GitHub Actions workflows with actionlint when it is installed.
# CI always runs it, with a pinned and checksum-verified release.
set -eu

if command -v actionlint >/dev/null 2>&1; then
  exec actionlint
fi
echo "lint:workflows: actionlint is not installed here; CI runs it on every pull request." >&2
