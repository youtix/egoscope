#!/bin/sh
# The verdict of the ci-ok job, the one job of the CI workflow that `main` requires.
# It passes only when every job that ci-ok needs succeeded. The one exception is
# pr-title, which runs on pull requests only and so is skipped on a push to main.
# A job that failed, was canceled or skipped, or has no result fails the gate, so a
# job that someone gives an `if:` cannot pass silently.
#
#   NEEDS='<the needs context as JSON>' EVENT=<github.event_name> sh scripts/ci-ok.sh
set -eu

printf '%s\n' "$NEEDS" | jq --raw-output 'to_entries[] | "\(.key): \(.value.result // "no result")"'
not_ok="$(printf '%s\n' "$NEEDS" | jq --raw-output --arg event "$EVENT" '
  def allowed: .key == "pr-title" and .value.result == "skipped" and $event == "push";
  if type != "object" or length == 0 then "no job at all"
  else
    [to_entries[]
      | select(.value.result != "success" and (allowed | not))
      | "\(.key) (\(.value.result // "no result"))"]
    | join(", ")
  end')"
if [ -n "$not_ok" ]; then
  echo "::error::Every job must succeed. These did not: $not_ok"
  exit 1
fi
echo "Every job succeeded."
