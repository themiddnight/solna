#!/usr/bin/env sh
# Claude Code "Stop" hook — lint only the TS/TSX files changed in the working
# tree (vs HEAD), grouped by workspace so each gets its own eslint config.
#
# Mirrors the repo's pre-commit philosophy (lint on changed files; full
# type-check + repo-wide lint stay at pre-push). Surfaces lint errors back to
# the model the moment a turn ends, instead of at commit time.
#
# Exit codes (Stop-hook contract):
#   0  -> clean (or nothing to lint); stop proceeds
#   2  -> lint errors; stop is blocked and stderr is fed back to the model

# Loop guard: if we're already inside a stop-hook-triggered continuation,
# don't block again — prevents an unfixable lint error from looping forever.
input=$(cat 2>/dev/null)
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$PROJECT_DIR" ] || exit 0
cd "$PROJECT_DIR" || exit 0

# TS/TSX files to lint, relative to repo root:
#   - tracked changes vs HEAD (modified/added/staged, excluding deletions)
#   - newly created files still untracked (Write tool output before `git add`)
tracked=$(git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx' 2>/dev/null)
untracked=$(git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null)
files=$(printf '%s\n%s\n' "$tracked" "$untracked" | sort -u | grep -v '^$')
[ -z "$files" ] && exit 0

status=0
report=""
for ws in shared app/backend app/frontend; do
  ws_files=$(printf '%s\n' "$files" | grep "^$ws/" || true)
  [ -z "$ws_files" ] && continue
  rel=$(printf '%s\n' "$ws_files" | sed "s#^$ws/##")
  result=$(cd "$ws" && printf '%s\n' "$rel" | xargs bunx eslint 2>&1)
  if [ $? -ne 0 ]; then
    status=2
    report="$report

[eslint: $ws]
$result"
  fi
done

if [ "$status" -ne 0 ]; then
  printf 'ESLint found issues in changed files — fix before finishing:%s\n' "$report" 1>&2
  exit 2
fi
exit 0
