---
name: doc-sync
description: Periodic audit of documentation vs codebase — verify global contracts (API, WS, DB, constants, rules) and every feature codebase-reference still match the code. Use before releases or after a heavy sprint.
---

# Doc Sync

Periodic cross-check between documentation and codebase. Use before releases,
after a heavy sprint, or when docs feel stale.

Day-to-day prevention is handled by per-task doc-update steps (TR-22 + CLAUDE.md
§3). This skill is for periodic audits only.

This skill has **two halves**:

1. **Global contracts** — a fixed list of cross-cutting docs (API/WS/DB/etc.).
   These rarely change; checked explicitly.
2. **Feature references** — *discovered*, not hardcoded. Any feature that follows
   [`docs/DOCUMENTATION_STRUCTURE.md`](../../../docs/DOCUMENTATION_STRUCTURE.md)
   is found automatically, so **adding a feature never requires editing this skill.**

> Read [`docs/DOCUMENTATION_STRUCTURE.md`](../../../docs/DOCUMENTATION_STRUCTURE.md)
> first — it defines the doc tiers, the codebase-reference shape, and the
> discovery marker this skill relies on.

---

## Part A — Global contracts (fixed list)

These are inherently cross-feature. The list grows only when a genuinely new
contract surface appears — not per feature.

| Doc | Code source | What to check |
|-----|-------------|---------------|
| `docs/API_CONTRACT.md` | `app/backend/src/routes/` + controllers | Endpoints, method/path, request/response shapes, auth requirements |
| `docs/WS_CONTRACT.md` | `shared/src/constants/EventNames.ts` + handlers in `app/backend/src/domains/*/infrastructure/handlers/` | Event names match constants, payload fields, ephemeral/commit classification |
| `app/backend/docs/DATABASE.md` | `app/backend/prisma/schema.prisma` | All models, fields, enums, relations |
| `docs/CONSTANTS.md` | `shared/src/constants/` (EventNames, NamespacePaths, SyncConfig, ProjectLimits) | All exported constants, values, FE/BE availability flags |
| `docs/RULES_AND_CONSTRAINTS.md` | Codebase behavior (handlers, services, middleware) | Rules describe actual enforced behavior |
| `docs/METRONOME_SYSTEM.md` | `shared/src/music/timeSignature.ts`, `MetronomeService`, `useMetronome`, sequencer/companion timing code | Quarter-note timing, time-signature conversion, anchor scheduling, helper usage |

### A1. API_CONTRACT.md

```bash
# route definitions
grep -r "router\.\(get\|post\|put\|patch\|delete\)" app/backend/src/routes/ --include="*.ts" | grep -v "node_modules"
# mount points live in TWO files — verify every route file is actually mounted
grep -rnE "\.use\(['\"]/[a-z-]+|Routes\)" app/backend/src/routes/index.ts app/backend/src/bootstrap/httpLayer.ts
```

For each route: exists in doc? method/path correct? request/response shapes match? auth requirement correct? Also confirm each route *file* is mounted (mounts are split across `routes/index.ts` and `bootstrap/httpLayer.ts` — e.g. `performance.ts` mounts in the latter).

### A2. WS_CONTRACT.md

```bash
cat shared/src/constants/EventNames.ts
# events register TWO ways: raw socket.on(...) AND the secureSocketEvent(...) wrapper.
# Grepping only socket.on( misses ~45 wrapped handlers — match both.
grep -rE "socket\.on\(|secureSocketEvent\(" app/backend/src --include="*.ts" | grep -v "node_modules\|__tests__"
```

For each event: doc entry exists? payload matches TypeScript type? ephemeral/commit classification correct? Event names are most reliably enumerated from `EventNames.ts` (the single source) — the greps confirm a handler is actually wired.

### A3. DATABASE.md

```bash
cat app/backend/prisma/schema.prisma
```

Compare against `app/backend/docs/DATABASE.md`: every `model`, field, `enum`, and `@relation` present and accurate.

### A4. CONSTANTS.md

```bash
cat shared/src/constants/EventNames.ts
cat shared/src/constants/NamespacePaths.ts
cat shared/src/constants/SyncConfig.ts
```

Every exported constant documented? Values correct? FE/BE availability flags (✅/❌) accurate?

### A5. RULES_AND_CONSTRAINTS.md (spot-check)

| Rule | Where to verify |
|------|----------------|
| BR-1: 1 project = 1 active Arrange Room | `app/backend/src/domains/room-management/` |
| BR-2: Project owner auto-becomes room_owner | `app/backend/src/domains/arrange-room/` join handler |
| BR-5: Project limits by user type | `shared/src/constants/ProjectLimits.ts` |
| TR-1: Ephemeral/Commit pattern | High-freq handlers — no Redis write before broadcast |
| TR-3: socket.to() vs namespace.to() | Handlers — broadcast method matches rule |
| TR-14: Shared constants sync FE ↔ BE | `shared/src/constants/EventNames.ts` — single source |
| TR-23: Shared time signature helpers | No local beat/time-signature formulas outside `shared/src/music/timeSignature.ts`; tap-tempo inverse BPM allowed |

### A6. METRONOME_SYSTEM.md

```bash
cat shared/src/music/timeSignature.ts
grep -R "60000 /\|60 / bpm\|numerator \* 4 / denominator\|4 / denominator" app shared --include="*.ts" --include="*.tsx"
```

Confirm docs describe the current helper contract:
- `quarterNoteMs(bpm)` is the source for BPM → quarter-note duration.
- `quarterNotesPerBar(timeSignature)` is the source for bar length in quarter-note beat space.
- Sequencer length snapping uses sequencer-safe helpers to avoid fractional step lengths.
- Direct numerator/denominator reads are limited to UI, serialization/export, validation, Tone.js time-signature assignment, or native beat counts.

---

## Part B — Feature codebase references (discovered)

Do **not** maintain a list of feature docs here. Discover them by the marker
defined in the convention:

```bash
grep -rl "doc-sync: codebase-reference" docs app --include="*.md"
```

Each hit is a feature codebase reference. For every one:

### B1. Code map paths resolve

Every file referenced in the doc's `## Code map` table must still exist. Code maps
are often written with **section-relative short paths** (a `shared/src/` or
`app/backend/...` heading above the table, then bare filenames in rows), so
resolve by **basename** rather than assuming a full path:

```bash
# example for one reference — repeat per discovered file
grep -oE '`[a-zA-Z0-9_./@-]+\.(ts|tsx)`' docs/<feature>/README.md | tr -d '`' | sort -u | while read -r p; do
  base=$(basename "$p")
  [ -e "$p" ] || git ls-files --error-unmatch "*/$base" >/dev/null 2>&1 || \
    { git ls-files | grep -q "/$base$" || echo "MISSING: $p"; }
done
```

A `MISSING` basename (no file by that name anywhere in the repo) = **Stale**
(file deleted/renamed) → fix the Code map. If the basename exists but only under
a different folder than the section implies, that's a softer **CC** (the section
prefix drifted) — verify and correct the heading/path.

### B2. Invariants still hold

Read the doc's `## Invariants & gotchas`. For each invariant:
- **Marked codified** (has a test / single-source const / exhaustive switch) →
  confirm that guard still exists (the test file is present, the const is still
  the single source). If the guard is gone but the doc claims it, that's a
  conflict.
- **Prose-only** → spot-check the code still honors it. If it now *could* be
  codified, note it as a follow-up (file a test, see Part C).

### B3. Vocabulary / current state sanity

If the reference lists a "current vocabulary" (styles, options, enums), spot-check
a few entries still appear in the code it points to, and that nothing obvious is
missing. This is a sanity pass, not exhaustive — the goal is catching whole
sections that drifted, not every token.

---

## Part C — Prefer codifying over re-checking

When you find a drift in Part B that *could* be a build/test guard, the durable
fix is to codify it, not just to correct the prose (see
`docs/DOCUMENTATION_STRUCTURE.md` §3):

- two lists that must match → add a parity test
- variants that need a case → exhaustive `switch` with `const _x: never`
- a value that must appear in a derived structure → assert it in a test

Codifying removes the item from future audits entirely. Note such opportunities
in the output and, if cheap, do them in the same pass.

---

## Part D — Refresh the generated doc index

`docs/INDEX.md` is the generated map of every maintained doc (built from the tier
directories + the `doc-sync: codebase-reference` marker by `scripts/docs-index.ts`).
Regenerate it as part of any audit and commit the result:

```bash
bun run docs:index
```

`bun run docs:index:check` regenerates then fails on a non-empty `docs/INDEX.md` diff —
treat a stale index (a doc added/moved/renamed without regenerating) as a drift finding.
Never hand-edit `docs/INDEX.md`.

---

## Conflict Classification

| Type | Description | Action |
|------|-------------|--------|
| **CC** | Doc says X, code does Y — code is correct | Fix the doc |
| **CD** | Doc says X in one place, Y in another | Pick correct version, fix the other |
| **CR** | Code violates a documented rule | File a Linear bug, fix the code |
| **Missing** | Code has something the doc doesn't mention | Add to doc |
| **Stale** | Doc describes something removed from code | Remove from doc |

---

## Output Format

```
## Global contracts

### API_CONTRACT.md
CC-1: POST /api/projects — doc shows `name` as required, Zod marks it optional

### WS_CONTRACT.md
CC-2: perform:note_played — doc missing `sampleNotes` field added in handler

### DATABASE.md / CONSTANTS.md / RULES_AND_CONSTRAINTS.md / METRONOME_SYSTEM.md
(none)

## Feature references (discovered)

### docs/companion/README.md
Stale-1: Code map lists `utils/instrument-role.ts` at old path — moved
Codify-1: invariant "two-place validation" is prose-only but is testable → file parity test

### app/frontend/src/features/<feature>/README.md
(none)
```

Fix all CC/CD/Missing/Stale. CR conflicts → Linear bug. Codify opportunities →
do inline if cheap, else file a follow-up.
