---
paths:
  - "src/audio/engine.ts"
  - "src/audio/synth/**"
  - "src/audio/drumSynth.ts"
  - "src/audio/masterRack.ts"
  - "src/audio/voiceOwner.ts"
  - "src/audio/playback/**"
  - "src/audio/export/**"
  - "src/components/useInputDeck.ts"
---

# Synth voices

Voice identity and ownership, the engine's frequency boundary, polyphony gain, voice lifetime and the shared live/offline implementation.

## Identity and ownership

- `triggerSynthNoteOn` returns a `VoiceId` (`src/audio/synth/voiceId.ts`) and `triggerSynthNoteOff` takes it; a source + note name is never an identity. <!-- R169 -->
- Every voice carries `owner: VoiceOwner` (`live`, `arp`, `sequencer`, `preview`; `src/audio/voiceOwner.ts`), required with no default. <!-- R170 -->
- `releaseSoundingVoices(source, releaseTime, owner)` releases one player's sounding voices and skips releasing ones; `stopOwnedVoices(source, owner, …)` also reaches booked tails. Two methods, never one with a flag. <!-- R171 -->
- `stopSource` means the whole bus: project install, loop load, vibe swap. <!-- R172 -->
- Whole-bus reach requires a method whose name says so, never an omitted argument (likewise `applySynthVelocityScale`'s required `source`). <!-- R173 -->
- The owner is chosen by the bridges in `src/audio/playback/`; no file in `src/components/` names one. <!-- R174 -->
- Mono-bus decisions are taken on the held-note stack, never on `group.owner` (it records only the builder). <!-- R175 -->

([ADR-0017](../../docs/decisions/0017-voice-identity-and-ownership.md))

## Frequency boundary

- The engine takes Hz, never a note name: `triggerSynthNoteOn(frequency, synth, velocity, time, source, scaleFactor, owner)`; `SynthVoiceNoteOn`, `ManagedVoice`, `SubtractiveVoiceEvent` carry `frequency` and no name. <!-- R176 -->
- `noteFrequency` is called by the controller; `src/architecture/frequencyBoundary.test.ts` holds the literal allowlist of files (in `src/` and `scripts/`) that may name it. <!-- R177 -->
- The engine never regains a note name, not even for logging; names belong on the note-input bus (`emitNoteInput`). <!-- R178 -->
- The engine may import only the timing half of `utils/musicTheory.ts` (`STEPS_PER_BAR`, `stepDurationSec`): `ENGINE_MUSIC_DOMAIN_BAN` is an `allowImportNames` allowlist. <!-- R179 -->
- The gate covers `src/audio/engine.ts`, `src/audio/synth/**`, `drumSynth.ts`, `masterRack.ts` — not `clock.ts` or `src/audio/playback/**`. <!-- R180 -->
- Guarded files may not import `src/audio/playback/**`, not even type-only (planner types name pitches). <!-- R181 -->
- `src/architecture/engineDomainPurity.test.ts` proves the block armed at `error`, in aliased and relative form. <!-- R182 -->

([ADR-0018](../../docs/decisions/0018-engine-frequency-boundary.md))

## Polyphony gain and voice lifetime

- Polyphony scale is `applySynthVelocityScale(scale, source)` → `SynthVoiceManager.setPolyphonyScale`, ramping a dedicated `polyGain` between the tremolo gain and the panner; never the amp envelope or `tremoloGain`. <!-- R183 -->
- The count is the caller's (`useInputDeck` counts held notes per bus; arp and sequencer excluded); the manager skips releasing groups. <!-- R184 -->
- Notes play at plain velocity; the rebalance runs after, one call covering every sounding voice. <!-- R185 -->
- No wall-clock timer guards a voice's lifetime in `SynthVoiceManager`. <!-- R201 -->
- Live keyboard backstop: `useInputDeck.ts` releases every held note on `window` blur and `visibilitychange`. <!-- R202 -->
- Known narrowed gap: the held chord preview (`playChordLegato`). Surfaces bind `onMouseLeave`/`onTouchEnd` beside `onMouseUp` and `playChordLegato` first stops its bus; the proper fix is a blur/`visibilitychange` backstop, never a manager timer. <!-- R203 -->
- A new caller holding a `VoiceId` across an await, a render or a user event adds its own backstop. <!-- R204 -->
- `maxVoicesPerSource` bounds the count, not leaks; a droning voice means a bridge dropped its id — trace the bridge. <!-- R205 -->

([ADR-0019](../../docs/decisions/0019-polyphony-gain-and-voice-lifetime.md))

## Live and offline share one implementation

- `createRenderEngine(ctx)` is the one open door on the singleton: a throwaway engine on a caller context; `renderMixdown.ts` never touches `audioEngine`, and its snapshot is assembled by `store/mixdownSlice.ts`. <!-- R031 -->
- `createSubtractiveVoice` builds on any `BaseAudioContext`; `SynthVoiceManager` holds no module state. <!-- R206 -->
- Every scheduled time is an argument: the voice module never reads `ctx.currentTime`; the manager's single read sits behind the realtime teardown timer. <!-- R207 -->
- Realtime-only concerns narrow through `realtimeCtx()` and stay out of the offline path. <!-- R208 -->
- Never write a render-only copy of shared audio code; fix the shared code. <!-- R209 -->

([ADR-0021](../../docs/decisions/0021-shared-live-and-offline-render.md))

## Deferred

- The FX synth voice has no pitch riser (the filter envelope ramps `filter.frequency` only) and its LFO restarts per note — deferred, not bugs. <!-- R142 --> ([ADR-0013](../../docs/decisions/0013-melody-tracks-table-and-record-arm.md))
