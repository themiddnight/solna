---
paths:
  - "src/audio/clock.ts"
  - "src/audio/engine.ts"
  - "src/audio/playback/**"
  - "src/audio/export/**"
  - "src/store/engineSync.ts"
  - "src/store/playbackPlanSnapshots.ts"
  - "src/store/mixdownSlice.ts"
  - "src/store/loadLoop.ts"
  - "src/store/songMode.ts"
  - "src/components/**/use*Playback.ts"
  - "src/components/usePlayheadSync.ts"
  - "src/components/playbackStep.ts"
  - "src/components/playheadBeat.ts"
  - "src/App.tsx"
---

# Playback

The engine singleton, controllers, the shared clock, the store → engine bridge, and pure playback planners.

## Engine and controllers

- The playback step and playhead beat travel through the module pub/subs `src/components/playbackStep.ts` and `playheadBeat.ts`, never a slice. <!-- R017 --> ([ADR-0001](../../docs/decisions/0001-always-mounted-views.md))
- One `audioEngine` singleton; every engine setter no-ops until `init()` creates the `AudioContext`. <!-- R030 -->
- `useChordPlayback`, `useLeadPlayback`, `useSequencerPlayback`, `useInputDeck`, `usePlayheadSync` and the pub/subs live in `components/` and reach audio via `audio/playback/playbackEngine`, never `audio/engine`. <!-- R039 -->

([ADR-0002](../../docs/decisions/0002-four-layer-import-architecture.md))

- `createRenderEngine(ctx)` is the one open door: a throwaway engine on a caller context; `renderMixdown.ts` never touches `audioEngine`; its snapshot is assembled by `store/mixdownSlice.ts`. <!-- R031 -->
- Realtime-only concerns narrow through `realtimeCtx()` and stay out of the offline path. <!-- R208 -->
- Never write a render-only copy of shared audio code; fix the shared code. <!-- R209 -->

([ADR-0021](../../docs/decisions/0021-shared-live-and-offline-render.md))

- A full-cycle custom span releases and retriggers at the seam; the full-hold fast path is preset-only (`isFullHoldRhythmCycle`/`isFullHoldBassCycle`). <!-- R130 -->
- The Chord publisher emits a progression-relative absolute step; each reader folds it by its own cycle; a producer never folds. <!-- R131 -->

([ADR-0012](../../docs/decisions/0012-pattern-storage-and-step-layouts.md))

## Clock and engine bridge

- The shared 16th clock runs iff a player holds a subscription: `subscribeClock` starts it, `stopClockTimer` ends it with the last listener; nothing else starts or holds it. <!-- R220 -->
- The metronome is a click only: `setMetronomeEnabled` arms the click `clockTick` emits; it never starts the clock or blocks idle suspend. To record to a click, press play on the lead. <!-- R221 -->
- `src/store/engineSync.ts`: one `subscribeWithSelector` subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()` in `App.tsx`. <!-- R222 -->
- The `AudioContext` is created on the first user click; `applyEngineSnapshot()` then re-applies persisted audio state. <!-- R223 -->
- Direct `audioEngine` calls from `src/store/` are only for cuts, previews and lifecycle, each with a docblock reason. The set (`loadLoop`, `vibes`, `projectSlice`, `synthPatchPreview`, `effectsPreview`, `beatPreview`, `synthPresetInstall`, `audioRecovery`, `incidentReporter`, `sourceBuses`) is a snapshot — re-derive with `grep -ln audioEngine src/store/*.ts`. <!-- R225 -->
- A persistent value (a MIDI CC patch edit included) reaches the engine only through its `engineSync` subscription. <!-- R226 -->

([ADR-0026](../../docs/decisions/0026-clock-and-engine-bridge.md))

## Planned, then performed

- Planners in `src/audio/playback/plan/` (`padPlan.ts`, `chordPlan.ts`, `melodyPlan.ts`) are pure: no store, no engine setter, no `AudioContext`, no wall clock, no timer (ESLint block on the folder, which bans the engine MODULE — `@/audio/engine` and `playbackEngine`, in both aliased and relative form; the engine-touching exports of `../chordPlayback` are banned only by convention). <!-- R227 -->
- `src/architecture/playbackPlannerPurity.test.ts` asserts the block's severity. <!-- R228 -->
- A planner never calls `chordPlayback`'s engine-touching exports (`playFullHoldChord`, `emitStepEvents`, `scheduleWholeChord`) — convention, not gated. <!-- R229 -->
- The clock subscription, arming state, full-hold strikes and note-ons belong to the controllers (`useChordPlayback.ts`, `useLeadPlayback.ts`, `renderMixdown.ts` offline). <!-- R230 -->
- Four per-lane snapshot types (arm-time, immutable) plus a per-step context (emit-time, live); never unify them into one `PlaybackSnapshot`. <!-- R231 -->
- Chord/bass fix cycle, notes and the arp ACTIVE flag at arm and read synth patches and Arp settings live per step; `chordFeel`/`bassFeel` are read at both (arm → `cycleHoldScale`, emit → `feelToHoldScale`); pad is arm-only, melody emit-only. <!-- R232 -->
- `src/store/playbackPlanSnapshots.ts` takes `AppStore` as an argument and never calls `useAppStore.getState()`. <!-- R233 -->
- A new lane field goes in both snapshot builders (`playbackPlanSnapshots.ts`, `renderMixdown.ts`) or in neither. <!-- R234 -->
- Every `plan<Lane>*` function's second parameter is a single context object, never positional scalars. <!-- R235 -->
- Planner output is an inline anonymous type if read only where returned, named and exported if it crosses a call boundary; export a type only when a second file needs its name. <!-- R236 -->
- `planChordStep`'s arp branch uses `feelToHoldScale`, not `cycleHoldScale`. <!-- R237 -->

([ADR-0027](../../docs/decisions/0027-planned-then-performed-playback.md))
