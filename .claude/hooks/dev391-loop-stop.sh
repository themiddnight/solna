#!/usr/bin/env bash
# Stop hook: auto-advances the DEV-391 epic issue queue.
#
# Safety design: only fires when NO issue is currently "in_progress". Every
# real mid-issue stop (AskUserQuestion pause, blocked on an error, waiting on
# review) leaves the current issue's status at "in_progress", so this hook
# stays silent and the genuine stop is respected. It only advances the queue
# when the previous issue was explicitly flipped to "done" as the last action
# of that turn.
set -euo pipefail

QUEUE_FILE="$(git rev-parse --show-toplevel 2>/dev/null || echo .)/.claude/dev391-queue.json"

[ -f "$QUEUE_FILE" ] || exit 0

STARTED=$(jq -r '.loopStarted // false' "$QUEUE_FILE")
[ "$STARTED" = "true" ] || exit 0

IN_PROGRESS=$(jq -r '.issues[] | select(.status == "in_progress") | .id' "$QUEUE_FILE")
if [ -n "$IN_PROGRESS" ]; then
  exit 0
fi

NEXT=$(jq -r '[.issues[] | select(.status == "pending")][0].id // empty' "$QUEUE_FILE")

if [ -z "$NEXT" ]; then
  echo '{"systemMessage": "DEV-391 epic queue complete — all issues done."}'
  exit 0
fi

TMP=$(mktemp)
jq --arg id "$NEXT" '(.issues[] | select(.id == $id) | .status) = "in_progress"' "$QUEUE_FILE" > "$TMP"
mv "$TMP" "$QUEUE_FILE"

REASON="Previous issue marked done. Start the next queued issue: $NEXT. Follow the recipe: git checkout -b from the tip of the current branch (not main), write a bite-sized TDD plan for $NEXT only (superpowers:writing-plans), dispatch implementation to a fresh code-implementer subagent with that plan's path, optionally review with code-reviewer, run squash-by-logical-change, mark $NEXT In Review in Linear, then flip $NEXT to \"done\" in .claude/dev391-queue.json as your final action."

jq -n --arg reason "$REASON" '{decision: "block", reason: $reason}'
