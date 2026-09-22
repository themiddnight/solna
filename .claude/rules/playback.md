---
paths:
  - "src/audio/clock.ts"
  - "src/audio/engine.ts"
  - "src/audio/playback/**"
  - "src/audio/export/**"
  - "src/store/engineSync.ts"
  - "src/store/playbackPlanSnapshots.ts"
  - "src/store/mixdownSnapshot.ts"
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

- `createRenderEngine(ctx)` is the one open door: a throwaway engine on a caller context; `renderMixdown.ts` never touches `audioEngine`; its snapshot is assembled by `store/mixdownSnapshot.ts`. <!-- R031 -->
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
- Direct `audioEngine` calls from `src/store/` are only for cuts, previews and lifecycle, each with a docblock reason. The set (`loadLoop`, `vibes`, `projectSlice`, `synthPatchPreview`, `effectsPreview`, `beatPreview`, `synthPresetInstall`, `audioRecovery`, `incidentReporter`, `sourceBuses`, `trackSendsPreview`) is a snapshot — re-derive with `grep -ln audioEngine src/store/*.ts`. <!-- R225 -->
- A persistent value (a MIDI CC patch edit included) reaches the engine only through its `engineSync` subscription. <!-- R226 -->

([ADR-0026](../../docs/decisions/0026-clock-and-engine-bridge.md))

## Planned, then performed

- Planners in `src/audio/playback/plan/` (`padPlan.ts`, `chordPlan.ts`, `melodyPlan.ts`, `chordEvents.ts`, `beatPlan.ts`, `songSnapshot.ts`, `songTimeline.ts`) are pure: no store, no engine setter, no `AudioContext`, no wall clock, no timer (ESLint block on the folder, which bans the engine MODULE — `@/audio/engine` and `playbackEngine`, in both aliased and relative form; the transitive edge to the engine singleton is gated by R289, not by this block). <!-- R227 -->
- `src/architecture/playbackPlannerPurity.test.ts` asserts the block's severity. <!-- R228 -->
- A planner never imports `chordPlayback.ts` at all — the chord/bass event math it used to share with that file's engine-touching emitters now lives in `chordEvents.ts`; the import itself is gated by R289. <!-- R229 -->
- Clock subscription and arming state belong to the live controllers (`useChordPlayback.ts`, `useLeadPlayback.ts`); offline, full-hold strikes and note-ons are performed by `renderMixdown.ts` from walk items, never planned by it. <!-- R230 -->
- Per-lane snapshot types (arm-time, immutable) for Chord/bass, Pad, Melody and Beat (`BeatPlanSnapshot`) plus a per-step context (emit-time, live); never unify them into one `PlaybackSnapshot`. <!-- R231 -->
- Chord/bass fix cycle, notes and the arp ACTIVE flag at arm and read synth patches and Arp settings live per step; `chordFeel`/`bassFeel` are read at both (arm → `cycleHoldScale`, emit → `feelToHoldScale`); pad is arm-only, melody emit-only. <!-- R232 -->
- `src/store/playbackPlanSnapshots.ts` takes `AppStore` as an argument and never calls `useAppStore.getState()`. <!-- R233 -->
- A new lane field goes in both snapshot builders — the store builder `src/store/playbackPlanSnapshots.ts` and the offline builder `plan/songSnapshot.ts` — or in neither. <!-- R234 -->
- Every `plan<Lane>*` function's second parameter is a single context object, never positional scalars. <!-- R235 -->
- Planner output is an inline anonymous type if read only where returned, named and exported if it crosses a call boundary; export a type only when a second file needs its name. <!-- R236 -->
- `planChordStep`'s arp branch uses `feelToHoldScale`, not `cycleHoldScale`. <!-- R237 -->

([ADR-0027](../../docs/decisions/0027-planned-then-performed-playback.md))

- `buildSongTimeline`/`walkSongTimeline` in `plan/songTimeline.ts` is the one place an arrangement becomes timed events; `renderMidi.ts` likewise consumes `walkSongTimeline` and calls no lane planner (ADR-0036); `renderMixdown.ts` only applies pass automation and performs walk items, and calls no lane planner (`planArrangement` only sizes the context). <!-- R287 -->
- The renderer consumes `walkSongTimeline` incrementally, performing each item before resuming the walk; never collect the timeline before performing it. The walk's per-step emit order (drums, chord hold, bass hold, chord, bass, pad, lead, FX) is part of the contract. <!-- R288 -->
- No runtime import path from `src/audio/playback/plan/` reaches `audio/engine` or `playbackEngine`; `src/architecture/playbackPlannerImportGraph.test.ts` walks the graph. <!-- R289 -->
- Drums are planned by `planBeatStep` (`plan/beatPlan.ts`) for both the live stepper and the timeline; no caller decides drum voices or velocity itself. <!-- R290 -->

([ADR-0034](../../docs/decisions/0034-pure-song-event-timeline.md))

- Sends reach the engine only through `engineSync`'s per-bus `trackSends` subscription (plus its settle pushes), the drag preview `store/trackSendsPreview.ts`, and `renderMixdown`'s per-pass `setSourceSends` beside `setSourceState`. Sends never read solo or audibility. <!-- R306 -->

([ADR-0037](../../docs/decisions/0037-per-track-sends.md))

## Prohibited

- The playback step or playhead beat in a slice <!-- R017 -->
- A controller importing `audio/engine` <!-- R039 -->
- `renderMixdown.ts` touching `audioEngine` <!-- R031 -->
- A realtime-only concern in the offline path <!-- R208 -->
- A render-only copy of shared audio code <!-- R209 -->
- A custom pattern using the full-hold fast path <!-- R130 -->
- A producer folding the published Chord step <!-- R131 -->
- Starting or holding the clock without a player subscription <!-- R220 -->
- A metronome that starts the clock or blocks idle suspend <!-- R221 -->
- A direct `audioEngine` call from `src/store/` without a cut/preview/lifecycle docblock reason <!-- R225 -->
- A persistent value reaching the engine other than through `engineSync` <!-- R226 -->
- A store read, engine call, `AudioContext`, wall clock or timer in a planner <!-- R227 -->
- A planner importing `chordPlayback.ts` <!-- R229 -->
- One unified `PlaybackSnapshot` <!-- R231 -->
- `useAppStore.getState()` inside `playbackPlanSnapshots.ts` <!-- R233 -->
- A lane field in only one snapshot builder <!-- R234 -->
- Positional scalars after a planner's snapshot <!-- R235 -->
- Exporting a planner type no second file names <!-- R236 -->
- A lane planner call or engine-independent event decision inside `renderMixdown.ts` or `renderMidi.ts` <!-- R287 -->
- Collecting the song walk into an array before performing it, or reordering its per-step emit order <!-- R288 -->
- A runtime import from `plan/` that reaches `audio/engine` or `playbackEngine` <!-- R289 -->
- Deciding drum voices or velocity outside `planBeatStep` <!-- R290 -->
- Sends routed through `setSourceState`; a component calling the send preview for anything but a drag <!-- R306 -->
