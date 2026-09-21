# ADR-0023: Validation replaced migration chains (with precondition)

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). The chains were
deleted in DEV-388; the unit change referenced below is DEV-386; the lead-melody shapes are
pre-DEV-369.

## Context

Solna persists state in two independent places: the live session in `localStorage` through zustand
`persist`, and a project body (`.solna`, also the IndexedDB slot — see
[ADR-0024](0024-storage-zones-project-slot-autosave.md)). Each used to have a read-time upgrade
chain: the persist `migrate` in `store.ts`, and the `.solna` chain in `projectFormatMigrate.ts`.
Those chains rotted into guards against versions nothing produced any more — dead code with no test
forcing it to stay honest.

The persist wiring: the app store uses `persist` (key `musibox_project_state_v1`, `partialize` +
`migrate` in `store.ts`, legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`.

## Decision

**There are no migration chains — validation replaced them, and that is a decision with a
precondition, not an accident.**

- DEV-388 deleted both read-time upgrade chains (the persist `migrate` in `store.ts` and the
  `.solna` chain in `projectFormatMigrate.ts`, which a follow-up then deleted outright — the file,
  not just its chain — once its sole export had settled to a literal identity function with no
  production caller).
- `migrate` in `store.ts` is identity except for the legacy localStorage-key adoption it still
  calls, kept only because zustand's `persist` throws on a version mismatch with no `migrate`
  function at all.
- `PERSIST_VERSION` and `PROJECT_FORMAT_VERSION` still exist and are still stamped on every write —
  the latter is still the murva-facing interop marker and still what `parseProjectFile` refuses a
  *newer* body against — but neither drives a read-time transform any more. There is no
  per-version migration step to add: a persisted shape change is handled by validating the new key
  in `merge`'s `sanitizePersistedState`, not by bumping the version.
- In place of a chain, `sanitizePersistedState` (`store.ts`) and `sanitizeContent`
  (`projectFile.ts`, which is the only non-test caller of `sanitizeLoops` — loops live in the
  IndexedDB slot, not in `localStorage`, so the persist path never reads one) validate every key on
  every read regardless of which version wrote it: out of range, wrong type, missing, or not a
  member of an allowed set gets the default; a value that is in range passes through untouched,
  whatever unit or shape convention was current when it was written.

### The precondition

**Solna has no real users yet.** A fader value is a plain number, and a number in range is
indistinguishable between, say, linear gain and dB, so nothing here guesses which one wrote it. The
case worth naming, not just the benign one: a pre-DEV-386 bus a user had faded all the way down was
stored as linear `0`, and `0` is also a perfectly legal dB value — *unity* — so that bus now reads
back at full level, not silent. A developer who hits a stale-looking value fixes it by hand.

If solna gains users with sessions worth preserving across a unit or shape change validation truly
cannot express, that precondition is gone and a chain — sequenced the way the old ones were, one
`if (version < N) …` guard per shape change, never reused once shipped, output frozen the moment its
guard ships — is the thing to bring back, in `migrate`/`merge` and in a re-created project-body
equivalent of `projectFormatMigrate.ts`, kept as two separate chains (a persist payload is private
`localStorage` shape and a project body is an external contract). Until then, do not add a
version-gated branch "just in case": a guard against a version nothing produces any more is dead
code with no test forcing it to stay honest, which is exactly the shape the old chains rotted into.

### The lead-melody trap (don't "fix" this)

The lead melody's two read-time upgrade chains are gone (DEV-388), and the shape they used to fix up
is now just validated.

- `asLeadNoteMatrix` (`sanitize.ts`) — the guard both read paths go through — still returns
  `undefined` for the pre-DEV-369 `string[][]` shape, so a payload in that shape still comes back
  blank with no throw and no warning; that part is unchanged and is the trap.
- What is gone is the pair of chains that used to widen a *valid but stale* shape (the
  pre-tick-resolution `LeadNote[][]`) before sanitize ever saw it — a stale-but-valid shape is now
  accepted as-is and passed through unchanged, at whatever tick density it was written, because it
  is not invalid, just old.
- When the two chains existed they were never merged even though they shared their pure transforms,
  because a persist payload is private `localStorage` shape and a project body is an external
  contract — if a genuinely un-validatable shape change ever forces a chain back, that split is
  still the right call and should not be "fixed" into one shared chain.

## Consequences

- A shape change is a sanitizer edit, not a version bump.
- Old data that is in range is read as-is, even if its unit convention changed (the faded-bus
  example above); this is accepted while the precondition holds.
- Other areas inherit the rule: an unknown synth `engine` gets the track default
  ([ADR-0020](0020-synth-patch-model.md)), a pre-source slot record reads as `untitled` and library
  arrays are capped at write time ([ADR-0024](0024-storage-zones-project-slot-autosave.md)), and old
  Beat fields are read only by `readBeatState` ([ADR-0010](0010-beat-instrument-three-fields.md)).
- The persist and project-body versions stay separate markers (see
  [ADR-0024](0024-storage-zones-project-slot-autosave.md)).

## Rules this implies

- **R034** — `persist` key `musibox_project_state_v1`; `partialize` + `migrate` in `store.ts`;
  legacy-key adoption in `migrate.ts`; `subscribeWithSelector`.
- **R035** — No per-version migration step; `PERSIST_VERSION` is stamped but drives no transform; a
  persisted shape change = validate the key in `merge`'s `sanitizePersistedState`, never bump the
  version.
- **R214** — No migration chains: `sanitizePersistedState` (`store.ts`) and `sanitizeContent`
  (`projectFile.ts`) validate every key on every read — invalid/missing/not-a-member → default;
  in-range passes untouched.
- **R215** — `migrate` in `store.ts` stays identity + legacy-key adoption (zustand throws without
  it).
- **R216** — `PERSIST_VERSION`/`PROJECT_FORMAT_VERSION` still stamped on every write;
  `parseProjectFile` refuses a newer `formatVersion`.
- **R217** — `sanitizeContent` is the only non-test caller of `sanitizeLoops` (loops live in
  IndexedDB).
- **R218** — Precondition: no real users. If it lapses, reintroduce chains one `if (version < N)`
  guard per change, frozen once shipped, persist and project-body chains kept separate.
- **R219** — Never add a version-gated branch "just in case".
- **R259** — `asLeadNoteMatrix` (`sanitize.ts`) returns `undefined` for the pre-DEV-369
  `string[][]` shape → blank payload, no throw/warning; do not "fix".
- **R260** — A stale-but-valid `LeadNote[][]` (pre-tick-resolution) passes through unchanged at its
  written tick density.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 98-107, 717-745 and 913-924 (lines 100-107
duplicated 717-723; merged here into one statement).
