# ADR-0021: One synth implementation for speakers and mixdown

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

The app has one `audioEngine` singleton for live playback (see
[ADR-0002](0002-four-layer-import-architecture.md)). An offline mixdown needs the same sound
rendered into an `OfflineAudioContext`. The tempting shortcut is a second, render-only copy of the
voice or scheduling code — which then drifts from what the speakers play. The offline render also
cannot read the store, because `src/audio/` may not import `src/store/`.

## Decision

### The one open door on the singleton

`createRenderEngine(ctx)` returns a throwaway engine bound to a caller-supplied context, which is
how the offline mixdown render (`src/audio/export/renderMixdown.ts`) works — it never touches
`audioEngine`, and the snapshot it renders is assembled by `store/mixdownSlice.ts`, because
`src/audio/` may not read the store.

### The context is the only difference

`createSubtractiveVoice` builds on whatever `BaseAudioContext` it is handed and `SynthVoiceManager`
holds no module-level state, so `createRenderEngine(ctx)` renders with the same voices the live
engine plays. What keeps that true is that **every scheduled time is an argument**: the voice
module never reads `ctx.currentTime`, and the manager's single read sits behind the realtime
teardown timer, whose offline branch forgets the group immediately instead. A realtime-only concern
narrows through `realtimeCtx()` — idle suspend, `resume()`, a `setTimeout` — and a subsystem that
cannot narrow has no business in the offline path.

Treat "the render needs its own copy of this" as a defect report about the shared code, not as a
second implementation to write.

## Consequences

- Live/offline equivalence is structural rather than tested-for-drift; the planner side of the same
  idea is [ADR-0027](0027-planned-then-performed-playback.md) (two snapshot builders, one planner).
- Shared audio code may not read the audio clock or arm wall-clock timers except behind
  `realtimeCtx()`.
- A feature that seems to need a render-only fork must instead be refactored in the shared code.

## Rules this implies

- **R031** — `createRenderEngine(ctx)` is the one open door: throwaway engine on a caller context;
  `renderMixdown.ts` never touches `audioEngine`; its snapshot is assembled by
  `store/mixdownSlice.ts`.
- **R206** — One synth implementation serves live and offline: `createSubtractiveVoice` takes any
  `BaseAudioContext`; `SynthVoiceManager` holds no module state.
- **R207** — Every scheduled time is an argument; the voice module never reads `ctx.currentTime`;
  the manager's single read sits behind the realtime teardown timer.
- **R208** — Realtime-only concerns narrow through `realtimeCtx()` and stay out of the offline path.
- **R209** — Never write a render-only copy of shared audio code.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 90-93 and 695-703.
