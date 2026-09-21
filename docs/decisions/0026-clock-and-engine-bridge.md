# ADR-0026: Clock runs iff a player subscribes; store→engine bridge

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Two runtime seams need a single owner each: the shared 16th-note clock every player schedules
against, and the path by which persisted audio state reaches the `audioEngine` singleton.

The metronome once started the clock and blocked the idle suspend, which made the toggle a second,
invisible transport — the grid's playhead ran and the lead recorder quantised against it with no
music playing.

## Decision

### The shared 16th clock runs if and only if a player holds a subscription

- `subscribeClock` starts the timer for the first listener and `stopClockTimer` ends it with the
  last, and nothing else may start or hold it.
- The metronome is a **click, not a transport**: `setMetronomeEnabled` only arms the click that
  `clockTick` emits, so it sounds while something plays and does nothing at all otherwise.
- Anything that needs a clock must start a player; to record in time to a click alone, press play on
  the lead.

### The store→engine bridge

- The bridge is `src/store/engineSync.ts`: one `subscribeWithSelector` subscription per
  engine-settable value with `fireImmediately`, started once by `useEngineSync()` in `App.tsx`.
- The `AudioContext` is created on the first user click, after which `applyEngineSnapshot()`
  re-applies the whole persisted audio state.
- **Never call engine setters from a component** — add the state to a slice and wire it in
  `engineSync.ts`.
- `engineSync` is the path for *persistent* audio state, not the only store module that touches the
  engine: a small set call `audioEngine` directly for **cuts, previews and lifecycle**, and each
  says why in its docblock — the loop switch (`loadLoop`), the vibe swap (`vibes`), the project
  install (`projectSlice`), the previews (`synthPatchPreview`, `effectsPreview`, `beatPreview`,
  `synthPresetInstall`) and runtime/incident plumbing (`audioRecovery`, `incidentReporter`,
  `sourceBuses`).
- A persistent value — a MIDI CC patch edit included — never joins that list; it reaches the engine
  through its `engineSync` subscription only.
- That list is a snapshot; the code binds, so re-derive it
  (`grep -ln audioEngine src/store/*.ts`, discarding tests and comment-only hits) before relying on
  it.

## Consequences

- Two mounted melody grids hold two clock subscriptions; both are players and neither starts a timer
  (see [ADR-0013](0013-melody-tracks-table-and-record-arm.md)).
- The metronome alone never moves the playhead or feeds the recorder.
- Engine state after the first click equals persisted state, because every persistent value is
  re-applied through `engineSync`.
- Effective track audibility (solo/mute) is also computed only in `engineSync.ts` (see
  [ADR-0015](0015-session-only-track-solo.md)).

## Rules this implies

- **R220** — The shared 16th clock runs iff a player holds a subscription (`subscribeClock` starts,
  `stopClockTimer` ends); nothing else starts or holds it.
- **R221** — The metronome is a click only: `setMetronomeEnabled` arms the click `clockTick` emits;
  it never starts the clock or blocks idle suspend; recording to a click = press play on the lead.
- **R222** — `src/store/engineSync.ts`: one `subscribeWithSelector` subscription per engine-settable
  value with `fireImmediately`, started once by `useEngineSync()` in `App.tsx`.
- **R223** — `AudioContext` is created on the first user click; `applyEngineSnapshot()` then
  re-applies persisted audio state.
- **R224** — Never call engine setters from a component; add state to a slice and wire it in
  `engineSync.ts`.
- **R225** — Direct `audioEngine` calls from `src/store/` are only for cuts, previews and lifecycle,
  each with a docblock reason; the list (`loadLoop`, `vibes`, `projectSlice`, `synthPatchPreview`,
  `effectsPreview`, `beatPreview`, `synthPresetInstall`, `audioRecovery`, `incidentReporter`,
  `sourceBuses`) is a snapshot — re-derive with `grep -ln audioEngine src/store/*.ts`.
- **R226** — A persistent value (incl. a MIDI CC patch edit) reaches the engine only via its
  `engineSync` subscription.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 747-769.
