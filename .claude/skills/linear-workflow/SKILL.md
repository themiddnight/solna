---
name: linear-workflow
description: Workflow for working with Linear issues — decide whether a finding needs an issue at all, create one only for deferred/backlog/multi-stage work, implement one or more issue cards on a branch with planned ordering and per-issue commits, or run a full single-issue fix-and-review cycle.
---

# Linear Issue Workflow — IDE Agent Guide

> Read this skill when working with the Linear Issue Tracker from the IDE.

**TL;DR:** Fix what you can finish now — no issue needed. Create an issue only when the work must be deferred (backlog) or is too large/multi-stage for the current session → fill Status / Priority / Labels / Description → fix according to priority using the workflow below.

## Should this even become an issue?

**Linear here is a working backlog, not a history/archive.** Free tier caps at 250 tasks, so every issue that reaches `Done` gets **deleted**, not kept as a permanent record. That changes the default:

- **Not every finding gets an issue.** A bug found mid-session that you can fix and verify before the session ends → just fix it. No issue, no ceremony. Creating one anyway just adds churn to a tracker that's already near a hard cap.
- **Create an issue when:**
  - The work is being **deferred** — out of scope for the current task, needs the user's product/scope call, or isn't worth interrupting the current thread for.
  - The work is **multi-stage / too large for one session** — spans multiple cards, needs planning, or is the kind of thing Scenario 2/3 below exists for.
- **Don't create an issue when:** you can fix it, verify it, and it's done before you finish responding. Do the fix; mention it in your summary; move on.
- If genuinely unsure which side a finding falls on, default to fixing it now if it's small and self-contained — only reach for Linear when deferring is the actual plan.

---

## Linear Issue Tracker

| | |
|---|---|
| **Technical Team ID** | `011781ef-bb08-444a-9e56-70b9d2ffbca9` (current name: `Developer`, key: `DEV`) |
| **Project ID** | `a32df946-46c7-4f14-a945-6e70da5f8481` (current name: `COLLAB`) |
| **URL** | https://linear.app |
| **MCP** | Access via Linear MCP tools (`list_issues`, `get_issue`, `save_issue`, etc.) |

### Issue Fields & Labels

| Field / Label group | Values Used |
|---------------------|------------|
| **Status** | `Backlog` / `Todo` / `In Progress` / `In Review` / `Testing` / `Done` / `Cancelled` |
| **Priority** | `Urgent` (= CRITICAL) / `High` / `Medium` / `Low` / `No priority` |
| **Category label** | `SYNC` \| `AUDIO` \| `PERM` \| `UI` \| `INFRA` \| `OTHER` |
| **Type label** | `Bug` \| `Feature` \| `Improvement` (capitalized, Linear-default labels — these are the actual de-facto Type dimension in use) \| `ux` \| `refactor` \| `perf` \| `security` (lowercase custom labels, used only for types with no capitalized-default equivalent) |
| **Area label** | `frontend` \| `backend` \| `fullstack` \| `design` \| `infra` \| `docs` |
| **Theme label** (optional, orthogonal to the three above) | Free-form, created as needed for a real cross-cutting cluster of active issues (e.g. `auth-identity`, `tier-billing`, `companion`, `audio-engine-dsp`, `collaborative-lock-permission`, `presence-status-badges`) — don't create one for a single issue |

> ⚠️ **Linear label names are case-insensitive-unique** — you cannot create `bug` alongside existing `Bug` (the API rejects it as a duplicate), and there is no rename/delete tool available via MCP. This is why Type uses the capitalized `Bug`/`Feature`/`Improvement` as canonical rather than a fully-lowercase scheme — confirmed 2026-07-03 during a full label-consistency audit/cleanup of the tracker.

**Priority ↔ Severity mapping:**

| Severity (Original) | Priority (Linear) |
|---------------------|-------------------|
| CRITICAL | Urgent |
| HIGH | High |
| MEDIUM | Medium |
| LOW | Low |

---

## Scenario 1 — Creating an Issue (bug found, or planned work to log)

Create the issue directly in Linear. **Do not create a .md file.** Use team ID `011781ef-bb08-444a-9e56-70b9d2ffbca9` and project ID `a32df946-46c7-4f14-a945-6e70da5f8481`, Status `Backlog`, Priority by severity, Labels = Category + Type + Area. Then inform the user, providing the Issue ID (e.g., DEV-42).

Anyone can file bugs/UX issues/feature requests this way — from the Linear website/app, or from the IDE via Linear MCP (`save_issue`).

Pick a mode first — they differ only in how much structure the description carries.

- **Quick capture** — a bug/observation hit mid-flow that just needs tracking. Keep it light: title + a short *what / where / impact*. No forced Goal/AC/DoD. Don't interrogate the user for structure a throwaway bug doesn't need.
- **Planned work** — a card that will be picked up and implemented later (feature, improvement, non-trivial bug). Use the description template below.

### Description template (planned work)

**Draft, don't interrogate.** Fill every field from the conversation/repo context first, then show the drafted issue to the user for a one-shot confirm/edit. Ask a direct question ONLY when a field is genuinely underivable — a real product/scope decision or an unknown acceptance threshold. Never ask for what you can infer.

```md
## Goal
<one sentence — the outcome, not the task>

## Context / Problem
<what's wrong or missing, where (file path / line number if known), why it matters; rule violated if any>

## Acceptance Criteria
- [ ] <observable, testable condition>

## Definition of Done
- [ ] Tests / checks that must pass
- [ ] Docs/contract updated if applicable (TR-22 / TR-14)

## Implementation guidance (optional)
<files, approach, constraints>
```

**Downgrade rule:** if you can't draft at least a Goal + one real acceptance criterion from context, it's a quick-capture, not planned work — don't pad it with boilerplate. These fields feed Scenario 2 / 3 directly (AC/DoD are read at implement-time and checked at self-review), so weak AC here means a weak signal there.

> **TR-32 — No placeholder keys:** never write `TODO(DEV-XX)` in code. Create the issue first (it is one tool call), then reference the real key: `TODO(DEV-42)`. Placeholder TODOs are untracked debt — six files carried `TODO(DEV-XX)` disables for months before DEV-159 cleaned them up.

---

## Scenario 2 — User-Selected Issue Branch Flow

Use this flow when the user gives one or more related Linear issue cards and asks the agent to implement them locally on a branch.

### Step 1 — Resolve and Read Every Issue

Retrieve every specified issue from Linear **before touching git or code**.

For each issue, read:
- Title and description
- Priority
- Labels and area
- Acceptance criteria or fix guidance
- Comments and reviewer notes
- Linked or related issues, if Linear exposes them

If the user gives a vague reference instead of exact keys, search Linear narrowly and confirm only when there is real ambiguity.

### Step 2 — Clarify Before Implementation

After reading the issue details, ask the user before implementing if:
- Requirements conflict across selected cards, comments, docs, or code.
- Acceptance criteria are missing, ambiguous, or too broad.
- The issue implies a product decision, UI behavior decision, data migration, or scope tradeoff.
- Required external information is unavailable from Linear or the repo.

If the implementation is clear, continue without asking.

### Step 3 — Plan the Execution Order

Create a short implementation plan before editing when any of these are true:
- More than one issue is provided.
- The issue touches both frontend and backend.
- The description is broad, ambiguous, or affects shared contracts.
- The likely work requires migrations, socket contracts, E2E coverage, or doc updates.

**Ordering rules (apply in priority order):**

1. **Hard dependency first** — if issue B touches code that issue A adds or refactors, do A first.
2. **Shared / backend-first** — when a fullstack issue and a frontend-only issue share a domain, implement BE/shared changes before the FE that depends on them.
3. **Risky or large issue first** — front-load the biggest card so later issues don't accumulate on an unstable base.
4. **Group by area when no dependency** — batch FE issues together and BE issues together to minimize context switching.
5. **Docs-only or minor issues last** — purely additive changes go at the end.

Present the planned order as a numbered list with a one-line reason per item before implementing. If the order is genuinely arbitrary, note that and pick a sensible default.

### Step 4 — Update Status → In Progress

Move every selected issue to `In Progress` before starting implementation.

Do not move these issues to `In Review`, `Testing`, or `Done` in this flow unless the user explicitly asks for that later.

### Step 5 — Create One Branch from `develop`

Start from the repository root unless the user specifies a nested repo. This is a Bun workspace monorepo.

```bash
git checkout develop
git pull origin develop
git checkout -b <type>/<ISSUE-KEYS>-<short-slug>
```

Branch naming:
- Use the type prefix from the dominant work: `fix/`, `feat/`, `refactor/`, `perf/`, or `docs/`.
- After the prefix, start with all selected issue keys in the same order you planned, separated by `-`.
- Use a short slug that describes the batch.

```bash
# Examples
fix/DEV-91-bpm-anchor-drift
refactor/DEV-101-DEV-104-arrange-input-contract
feat/DEV-120-DEV-121-companion-controls
```

Do not use Linear's auto-generated branch name.

### Step 6 — Read Required Project Context

Before modifying code, read:
1. `CLAUDE.md`
2. `docs/RULES_AND_CONSTRAINTS.md`
3. Domain-specific skills from `.claude/skills/` selected by the issue area
4. Architecture or contract docs relevant to the issue
5. Files, paths, or methods mentioned in the Linear card

Use the issue labels and touched code to choose additional skills. For example, Arrange Room issues usually require `arrange-room`; socket event changes require `socket-events` (archived); E2E work requires `e2e-test`.

### Step 7 — Implement and Commit One Issue at a Time

Work card-by-card in the planned order.

For each issue:
1. Implement only the scope needed for that card, unless a dependency forces a shared preparatory change.
2. Run focused tests or checks that are justified by the change.
3. Self-review the diff against the issue description and project rules.
4. Commit before moving to the next card.

Commit message format:
```bash
git commit -m "DEV-{id}: {clear description}"
```

Rules:
- The first line must start with the issue key.
- One commit should map to one issue card whenever feasible.
- If a shared enabling commit is unavoidable, start the message with the first relevant issue key and explain the shared scope in the description.
- Do not bundle unrelated cleanup into issue commits.

### Step 8 — Iterate Until All Selected Cards Are Implemented

Continue through the selected issues in planned order. If later cards reveal a problem in an earlier commit, fix it in a follow-up commit that starts with the relevant issue key unless the user explicitly asks for history rewriting.

Run broader validation when the batch touches shared behavior, cross-package contracts, or user-facing flows.

### Step 9 — Stop Local-Only

When all selected cards are implemented:
- Stay on the local branch.
- Do not push.
- Do not create a PR.
- Do not merge into `develop` or `main`.
- Do not move Linear status beyond `In Progress` unless the user explicitly asked.

Final response must include:
```
Branch: <branch-name>

Issues completed:
  - DEV-XX: <title> — <one-line summary of what changed>
  - DEV-YY: <title> — <one-line summary of what changed>

Commits: <count>
Checks run: <what was run and result>

Residual risks / manual checks needed:
  - <anything the user should verify before merging>
```

---

## Scenario 3 — High-Autonomy Single-Issue Fix Flow

When the user instructs to fix a single issue, e.g., "fix DEV-7" or "resolve DEV-12".

### Step 1 — Read Issue from Linear

Retrieve the issue using the provided ID and read all information:
- Title, Description
- Priority, Labels (category/type/area)
- Rule Violated (if specified in description)
- Comments (if any — there might be reviewer notes from previous rounds)

### Step 2 — Clarify Before Implementation

After reading the issue details, ask the user before implementing if requirements are ambiguous, conflicting, or require a product/scope decision. If the implementation is clear, continue without asking.

### Step 3 — Update Status → In Progress

Assign yourself as the Assignee (if not already) and move the issue forward:

```
Linear issue: Status → In Progress
```

### Step 4 — Create Git Branch

**Always `cd` to the monorepo root before running git commands.**

Format: `<type>/<issue-number>-<slug>`

```
fix/DEV-{id}-{slug}        For bug fixes
feat/DEV-{id}-{slug}       For features
refactor/DEV-{id}-{slug}   For refactoring
perf/DEV-{id}-{slug}       For performance improvements
docs/DEV-{id}-{slug}       For documentation
```

Examples:
```
fix/DEV-91-bpm-rapid-change-time-anchor-drift
feat/DEV-15-midi-overlap-detection
refactor/DEV-23-sync-constants-tr14
```

> ⚠️ Do NOT use Linear's auto-generated branch name (`username/dev-id-slug`).

```bash
git checkout develop
git pull origin develop
git checkout -b fix/DEV-{id}-{short-slug}
```

### Step 5 — Read Context Before Fixing

Always read before modifying code:
1. `docs/RULES_AND_CONSTRAINTS.md` — relevant rules
2. Architecture docs related to the issue's area
3. Files specified in the issue description

### Step 6 — Fix the Code

Fix according to the fix guidance in the issue and comply with:
- Every rule in `RULES_AND_CONSTRAINTS.md`
- Coding patterns in `CLAUDE.md`
- Reviewer notes from previous comments (if any)

### Step 7 — Self-Review Before Commit

Check your own work before committing:
- [ ] Are all fix guidance points in the issue addressed?
- [ ] Does it comply with all rules in `RULES_AND_CONSTRAINTS.md`?
- [ ] If shared constants were modified, are FE and BE synced? (TR-14)
- [ ] Are there no remaining `console.log` or debug code?
- [ ] Are all edge cases specified in the issue covered?

### Step 8 — Commit

```bash
git add [specific files]
git commit -m "fix(DEV-{id}): {short description}

- {bullet point of changes}
- {bullet point of changes}

Closes DEV-{id}"
```

### Step 9 — Code Review (Self-Review Round)

Review the modified code as a reviewer, checking:
- Issue requirements in Linear
- Diff of changed code
- `RULES_AND_CONSTRAINTS.md`

**If pass:** Proceed to Step 10
**If fail:** Add a comment to the Linear issue and return to Step 6.
```
Linear issue comment:
  "Review round {n}: {what needs to be fixed}"
```

### Step 10 — Update Status → In Review

```
Linear issue: Status → In Review
```

### Step 11 — Notify User to Merge

**Stop here — Do not merge the branch yourself.**

Notify the user:
```
✅ DEV-{id}: {title} is ready to merge.

Branch: fix/DEV-{id}-{slug}
Changes:
  - {summary of fixes}

Waiting for merge into develop.
```

### Step 12 — After Merge into develop → Update Status → Testing

When the branch is merged into `develop`, update the status:
```
Linear issue: Status → Testing
```

> **Note:** `Testing` means the code is in develop waiting for testing.
> `Done` can only be updated after merging into `main`.

---

## Loop: Fix → Review → Fix (Auto-iterate)

If self-review fails, automatically loop:

```
WHILE review fails:
  1. Read reviewer notes from Linear comments
  2. Fix code according to notes
  3. Self-review again
  4. If still fails:
     - Add comment in Linear issue
     - loop
  5. If passes → update Status: In Review → notify user

MAX iterations = 5
If it reaches 5 rounds and still fails → stop and ask the user for manual review.
```

---

## Status Transition Reference

```
Backlog → In Progress   (Starting fix)
In Progress → In Review  (Fix finished, waiting for merge into develop)
In Review → In Progress  (Review failed, return to fix)
In Review → Testing      (Merged into develop — waiting for QA)
Testing → Done           (Merged into main — user update)
```

**IDE agent can update:** `Backlog` → `In Progress` → `In Review` → `Testing`
**User updates:** `Testing` → `Done` (Only after merge into main)

---

## What the IDE Agent Must NOT Do

- ❌ Do not merge branches into develop yourself.
- ❌ Do not push to remote unless the user explicitly asks.
- ❌ Do not update Status to `Done` yourself (`Done` = merge into `main` only — let the user do it).
- ❌ Do not commit `.env` or secrets.
- ❌ Do not modify files outside the issue scope without informing the user.
