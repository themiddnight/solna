# ADR-0027: Pure planners, four snapshots, context objects

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). Covers the
DEV-397 planner split; its context-object contract is what DEV-399 builds on (see
[ADR-0018](0018-engine-frequency-boundary.md)).

## Context

Before the split, live playback and the offline mixdown each carried their own scheduling logic;
the melody lane had a hand-transcribed offline copy of its live scheduler, and live/offline
equivalence could only be checked by comparing two schedulers. Each lane also has its own mix of
values that are fixed when a chord is armed and values that must be read live on every step.

## Decision

### Playback is PLANNED, then PERFORMED, and the planner half is pure

- `src/audio/playback/plan/` holds one planner per lane — `padPlan.ts`, `chordPlan.ts` (chord and
  bass, armed together) and `melodyPlan.ts` (Lead and FX, one implementation through
  `MELODY_TRACKS`).
- A planner takes an immutable snapshot plus an explicit per-step context and returns RESOLVED
  PLAYABLE EVENTS — note identity, timing, hold, velocity — and it reads no store, calls no engine
  setter, opens no `AudioContext`, reads no wall clock and arms no timer.
- That is an ESLint block scoped to the folder, not a convention:
  `src/architecture/playbackPlannerPurity.test.ts` is the committed proof that the block is armed,
  and it asserts SEVERITY, because `verify` tolerates warnings.
- The gate blocks the engine MODULE (`@/audio/engine` and `playbackEngine`, both aliased and
  relative forms), not every impure function reachable from `plan/`: `../chordPlayback`, which the
  chord/bass planner legitimately imports for its pure event builders, also exports engine-touching
  functions (`playFullHoldChord`, `emitStepEvents`, `scheduleWholeChord`) that a planner must not
  call but that nothing stops it from calling — the pure/impure split INSIDE that file stays a
  convention, not something the gate enforces.
- Everything else — the clock subscription, the arming state, the full-hold strikes, the note-ons —
  is the CONTROLLER's (`useChordPlayback.ts`, `useLeadPlayback.ts`, and `renderMixdown.ts`
  offline).

### There are FOUR snapshots, not one, and that is forced rather than chosen

Every lane has its own arm-time/emit-time split:

- Chord and bass fix their cycle, their notes and the arp's ACTIVE flag when a chord is armed, and
  read both synth patches and both Arp SETTINGS objects live on every step — which is exactly what
  makes a knob tweak audible on the next hit instead of the next chord.
- `chordFeel`/`bassFeel` are the one value each lane reads at BOTH points: captured at arm-time (for
  `cycleHoldScale`, scaling a pattern note's hold duration) AND read live at emit-time (for
  `feelToHoldScale`, scaling an arp hit's hold duration) — so moving the feel knob mid-chord changes
  arp hold lengths on the very next hit but not pattern-note hold lengths until the next chord is
  armed, the same split the pre-DEV-397 code had.
- Pad is arm-time only; melody is emit-time only.

One unified `PlaybackSnapshot` would freeze the emit-time half of three lanes to kill one type. So
the SNAPSHOT is arm-time immutable and the CONTEXT is the live read, passed in per step.

### The snapshot is built in two places and the planner is called from both

- `src/store/playbackPlanSnapshots.ts` builds the live ones — taking `AppStore` as an ARGUMENT, never
  calling `useAppStore.getState()` itself, so the singleton never leaves the controller — and
  `src/audio/export/renderMixdown.ts` builds the offline twins from a `MixdownLoop`.
- Live/offline equivalence is therefore a deep-equality assertion on two snapshots plus one on the
  planner's output, not a comparison of two schedulers; the melody lane's hand-transcribed offline
  copy is gone, which is what that duplication used to cost.
- A new lane field belongs in BOTH builders or in neither. (The shared voice code underneath is
  [ADR-0021](0021-shared-live-and-offline-render.md).)

### A planner's second parameter is always a single context object

- Every `plan<Lane>*` function follows this — `planPadArm(snapshot, { chordIndex })`,
  `planChordArm`/`planChordLane`/`planBassLane`/`planChordStep`, `planMelodyStep(snapshot, {
  stepInLoop, stepsPerBar, tickDurSec })` — so a later per-call addition is a shape change to
  `context`, never a signature change every call site must follow in argument order. This held
  clean through every lane this plan migrated, and it is the contract DEV-399 (narrowing the
  engine's own input to resolved playable events) builds directly on.
- Output shape follows the same restraint rather than a blanket rule: a result read only where it is
  returned stays an inline anonymous type (`planPadArm`'s `{ notes, holdSec } | null`,
  `planChordStep`'s `{ chord, bass }`), and a result that already crosses a call boundary is named
  and exported — `ArmedChordPlan` is what `planChordArm` hands to `planChordStep` a step later,
  `PadPlanSnapshot`/`ChordPlanSnapshot`/`MelodyPlanSnapshot` are what both snapshot builders and both
  planners share. `PlannedMelodyNote` is the middle case: named for readability inside
  `melodyPlan.ts`, but not exported, because nothing outside the file currently needs to spell it —
  a type is exported when a second file needs its name, not in advance of one.

### A nuance recorded rather than re-discovered

`planChordStep`'s arp branch uses `feelToHoldScale`, not `cycleHoldScale` — "feel may only tighten"
is a rule about a span the user drew, and an arp has none — but `arpEventsForStep` itself clamps its
`hold` output with `Math.min(1, holdScale)`, so the two are behaviorally indistinguishable at every
feel value today. Live and offline arp holds were therefore never actually divergent; what this plan
originally expected to find and converge as a live/offline difference turned out, on inspection, to
be a difference that never existed.

## Consequences

- Planners are unit-testable without an `AudioContext`, a store or a clock.
- A knob tweak is audible on the next hit for emit-time values and on the next chord for arm-time
  values, by design.
- Adding a lane field means editing both snapshot builders and extending equivalence tests.
- The chordPlayback pure/impure split is a review responsibility, not a gate.

## Rules this implies

- **R227** — Planners in `src/audio/playback/plan/` (`padPlan.ts`, `chordPlan.ts`, `melodyPlan.ts`)
  are pure: no store, no engine setter, no `AudioContext`, no wall clock, no timer (ESLint block on
  the folder).
- **R228** — `src/architecture/playbackPlannerPurity.test.ts` asserts the block's severity.
- **R229** — A planner must not call `chordPlayback`'s engine-touching exports (`playFullHoldChord`,
  `emitStepEvents`, `scheduleWholeChord`) — convention, not gated.
- **R230** — Clock subscription, arming state, full-hold strikes, note-ons belong to controllers
  (`useChordPlayback.ts`, `useLeadPlayback.ts`, `renderMixdown.ts`).
- **R231** — Four per-lane snapshot types (arm-time immutable) + per-step context (emit-time live);
  never unify into one `PlaybackSnapshot`.
- **R232** — Chord/bass fix cycle, notes and arp ACTIVE flag at arm; read synth patches and Arp
  settings live per step; `chordFeel`/`bassFeel` read at both (arm → `cycleHoldScale`, emit →
  `feelToHoldScale`); pad arm-only; melody emit-only.
- **R233** — `src/store/playbackPlanSnapshots.ts` takes `AppStore` as an argument; never calls
  `useAppStore.getState()`.
- **R234** — A new lane field goes in both snapshot builders (`playbackPlanSnapshots.ts`,
  `renderMixdown.ts`) or neither.
- **R235** — Every `plan<Lane>*` function's 2nd parameter is a single context object, never
  positional scalars.
- **R236** — Planner output: inline anonymous type if read only where returned; named + exported if
  it crosses a call boundary; export a type only when a second file needs its name.
- **R237** — `planChordStep`'s arp branch uses `feelToHoldScale`, not `cycleHoldScale`.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 771-829.
