---
name: squash-by-logical-change
description: Use when a feature branch has many tiny auto-generated commits (e.g. from Superpowers/agent per-file commits) and you want to consolidate them into a few clean logical-change commits before review or before merging into develop. Covers safe history rewrite via reset --soft, backup refs, and tree-equality verification.
---

# Squash by Logical Change

> Consolidate a noisy feature branch into a handful of clean, review-friendly commits — **without changing the resulting code one byte**.

## Overview

Agent-driven workflows (Superpowers, etc.) commit on almost every file edit, so a finished branch can carry dozens of micro-commits. Before review or merge into `develop`, rewrite that history into a few commits grouped by **logical change** (a unit a reviewer reads as one thing), not by file type.

**Core principle:** Squashing rewrites history, but it must **never** change the final tree. The branch's `HEAD` tree after squashing must be byte-identical to before. We prove this with a backup ref + `git diff`, not by trusting the process.

**Violating the letter of the safety steps is violating the spirit.** A "quick" squash that skips the backup or the verify is the one that loses work. Do every gate, every time.

## When to Use / When NOT

**Use when:**
- Feature branch is finished and tests pass, about to open a PR or merge to `develop`
- History is full of `wip`, `fix`, per-file, or agent-generated commits
- The branch is **yours** — no one else has based work on it

**Do NOT use when:**
- On `main` / `develop` / any shared integration branch
- The commits you'd rewrite are already merged into `develop` (only ever touch commits *after* the merge-base)
- Someone else has pulled this branch and may have local work on top
- Working tree is dirty (commit or stash first)

If any "do NOT" applies → stop and tell the user; do not improvise.

## The Flow

### 1. Preflight — safety gate (MANDATORY, in order)

```bash
# a. Confirm current branch is a feature branch, not shared
git rev-parse --abbrev-ref HEAD          # must NOT be main/develop

# b. Working tree must be clean
git status --porcelain                   # must print nothing

# c. Determine the base branch you'll merge into (this project: develop)
BASE=develop
git rev-parse --verify "$BASE" >/dev/null || BASE=main   # fallback

# d. Compute the merge-base — the boundary we must never cross
MERGE_BASE=$(git merge-base "$BASE" HEAD)

# e. Create a backup ref BEFORE touching anything
BACKUP="backup/$(git rev-parse --abbrev-ref HEAD)-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP"
```

State the backup branch name to the user. It is the undo button (`git reset --hard "$BACKUP"`).

### 2. Analyze

Read everything between the merge-base and HEAD:

```bash
git log --oneline "$MERGE_BASE"..HEAD
git diff "$MERGE_BASE"..HEAD --stat
```

Group the changes into logical units a reviewer would read as one thing (e.g. *"backend: schedule + validate broken playing style"*, *"UI: Block/Broken chord settings"*, *"docs: playing-style"*). Type-based buckets (docs/feat/test) are a fallback only when changes are genuinely independent.

**Pick a grouping axis where files partition cleanly.** Whole-file `git add` can only put each file in ONE commit. Before committing to a grouping, check overlap between candidate groups:

```bash
git diff <base>..<midpoint> --name-only | sort > /tmp/a
git diff <midpoint>..HEAD --name-only | sort > /tmp/b
comm -12 /tmp/a /tmp/b          # files in BOTH → can't split this way
```

If two sub-features touch the same files (common when work was iterative), you **cannot** separate them by sub-feature with whole-file `add`. Either group by an axis that does partition — often **layer** (backend / frontend / shared / docs) — or split a shared file across commits with `git add -p`. Prefer the axis that needs no `-p`.

### 3. Propose — confirm BEFORE rewriting

Show the user a table: **proposed groups → which old commits each absorbs → new commit message**. Wait for approval or edits. **Never rewrite history without explicit confirmation.**

Follow the repo's commit message convention (this project uses Conventional Commits, e.g. `feat(companion): ...`). Append the trailer the repo requires on agent commits.

### 4. Execute — `reset --soft`, then recommit

Prefer `reset --soft` over `rebase -i`: the working tree never changes, so there are no conflicts and nothing to lose mid-operation.

```bash
git reset --soft "$MERGE_BASE"     # all changes now staged, tree untouched
# Then, per logical group:
git restore --staged .             # unstage all
git add <paths for group 1>
git commit --no-verify -m "<group 1 message>"
# repeat for each group; last commit naturally takes the remainder
```

If a single file's changes must split across two logical commits, use `git add -p`.

**Use `--no-verify` on these recommits.** The squash does not change code (step 5 proves it), so re-running pre-commit hooks is redundant — and harmful here: a `husky`/`lint-staged` hook can **fail on lint/type errors that already exist in the merged history** (the original commits may have used `--no-verify` or predate a rule), silently aborting every commit and leaving you with **zero commits**. Rapid back-to-back hook runs also collide on `.git/index.lock`. Skip the hooks; the original commits already passed (or bypassed) them. If a commit seems to do nothing, check `git log --oneline "$MERGE_BASE"..HEAD` immediately — empty means the hook ate it.

### 5. Verify — prove the tree is unchanged (MANDATORY)

```bash
git diff "$BACKUP" HEAD            # MUST print nothing
```

Empty output = squash preserved the code exactly. **Non-empty output = you changed the code; stop and `git reset --hard "$BACKUP"`.** Do not claim success until this diff is empty — report the actual output.

**Do not re-run the test suite after a verified squash.** An empty `git diff` against the backup *is* the proof the tree — and therefore test behavior — is unchanged; whatever gate passed before squashing still holds. Re-running `test:full` (or any tier) here checks nothing new and just burns time/tokens.

### 6. Finish

- Show `git log --oneline "$MERGE_BASE"..HEAD` (the clean result) to the user.
- If the branch was already pushed: it now needs `git push --force-with-lease` (never plain `--force`). Tell the user; let them push.
- Delete the backup only after the user confirms they're happy: `git branch -D "$BACKUP"`. Leave it otherwise — it's cheap insurance.

## Quick Reference

| Step | Command | Gate |
|------|---------|------|
| Branch check | `git rev-parse --abbrev-ref HEAD` | not main/develop |
| Clean tree | `git status --porcelain` | empty |
| Merge-base | `git merge-base develop HEAD` | boundary |
| Backup | `git branch backup/<name>-<ts>` | before any rewrite |
| Reset | `git reset --soft <merge-base>` | tree untouched |
| Recommit | `git add <paths> && git commit --no-verify` | skip hooks (code unchanged) |
| Verify | `git diff <backup> HEAD` | **empty** |
| Push | `git push --force-with-lease` | never plain `--force` |

## Common Mistakes & Rationalizations

| Excuse | Reality |
|--------|---------|
| "Branch is simple, skip the backup" | The backup is 1 second and is the only undo. Always make it. |
| "I'll verify by eyeballing the log" | The log shows messages, not the tree. Only `git diff backup HEAD` proves code is unchanged. |
| "Just squash everything into one commit" | One commit per *logical change* aids review. Don't collapse unrelated work. |
| "rebase -i is the proper way" | `reset --soft` is safer here: no conflicts, working tree never moves. Use it unless you specifically need to reorder/keep some commits. |
| "I'll force-push, it's my branch" | Use `--force-with-lease` so you don't clobber commits someone (or another machine) pushed. |
| "Group by docs/feat/test is cleaner" | Only when changes are independent. Default to logical units; a reviewer reads behavior, not file extensions. |
| "Verify diff is non-empty but it's just whitespace" | Then your recommit changed the tree. Reset to backup and redo — the squash must be byte-identical. |
| "Let the pre-commit hook run, it's good hygiene" | The hook can fail on issues already in the merged code and abort all commits → you end up with zero. Use `--no-verify`; the tree is identical, step 5 is the real gate. |
| "Group by sub-feature like the branch evolved" | Iterative work touches the same files repeatedly — sub-features won't partition by file. Group by an axis that does (layer), or `git add -p`. |

## Red Flags — STOP

- About to run `reset`/`rebase` without a backup ref → make the backup first
- About to recommit without having shown the user the grouping plan → get confirmation first
- `git diff "$BACKUP" HEAD` printed anything → **`git reset --hard "$BACKUP"`** and restart
- Current branch is `develop`/`main` → wrong branch, abort
- The commits include ones already on `develop` (before merge-base) → never touch them
- A recommit printed hook/lint output or `index.lock` errors → you forgot `--no-verify`; check the log isn't empty before continuing
