---
name: audio-engine
description: Tone.js instruments, synthesis, sampler, oscillator, arpeggiator, and instrument loading patterns. For effect chain and signal routing use dsp-audio skill instead.
---

# Working with the Audio Engine

This skill covers **instruments and synthesis** — Tone.js synths, samplers, oscillators, arpeggiator, and instrument loading patterns.

> **Scope:** If the task relates to **effect chains, signal routing, stereo balance, or AudioContext lifecycle** → Read the `dsp-audio` skill instead.
> If it relates to **WebRTC voice** → Read the `webrtc-voice` skill.

## Architecture Overview

```
Instrument (Tone.js Synth/Sampler)
  → Per-instrument Effect Chain (Tone.js effects)
    → Master Bus (GainNode)
      → AudioContext.destination (speakers)

Voice (WebRTC MediaStream)
  → Voice Effect Chain (optional)
    → Direct output (bypasses master bus for lowest latency)
```

- **Tone.js** handles synthesizers, samplers, and scheduling
- **Web Audio API** handles raw audio routing, master bus, and WebRTC integration
- Audio config: `app/frontend/src/engine/audio/audioConfig.ts`

## Key Files & Directories

- **Audio feature**: `app/frontend/src/features/audio/`
  - audio config lives in the engine: `engine/audio/audioConfig.ts` + `engine/audio/audioContextManager.ts` (the pre-relayer `features/audio/constants/` path is gone)
  - `services/` — Audio engine services
  - `hooks/` — React hooks for audio (useRoomSocket, etc.)
  - `stores/` — Audio-related Zustand stores
- **Effects — split across two layers (TR-38 room/engine re-layering):**
  - **Engine (DSP core)** `app/frontend/src/engine/effects/`
    - `model/effectType.ts` — canonical `EFFECT_TYPE` / `EffectType` enum (single source)
    - `runtime/effects/<Name>Effect.ts` — the Tone.js effect classes (`ReverbEffect`, `DelayEffect`, …)
    - `runtime/EffectsFactory.ts` — `switch (EFFECT_TYPE)` that instantiates each effect class
    - `runtime/MixerEngine.ts` · `runtime/effectParameterMapping.ts` · `runtime/audioEffectTypes.ts`
  - **Feature (UI/config)** `app/frontend/src/features/effects/`
    - `<effect-name>/config.ts` — per-effect UI config (`reverb/`, `delay/`, …)
    - `constants/effectConfigs.ts` — effect config registry · `constants/defaultPresets.ts`
    - `services/effectMappings.ts` · `services/effectsIntegration.ts` — UI-side mapping + chain integration
    - `stores/effectsStore.ts` — effect chain state · `components/` — chain/module UI
- **Instruments feature**: `app/frontend/src/features/instruments/` (UI, hooks) — engine core (providers, catalog, sub-engines) lives in `app/frontend/src/engine/instruments/` (TR-38)
  - Keyboard, Guitar, Bass, Drum Pad, Acoustic Drumset, Synthesizer implementations
  - Shared instrument constants: `app/frontend/src/engine/instruments/shared/constants.ts` (a compat shim re-exports the old `features/instruments/shared/constants.ts` path)
- **Synth/Sequencer**: `app/frontend/src/features/sequencer/`

## Adding a New Audio Effect

> **`dsp-audio` is the authoritative source for the full step-by-step.** Adding an
> effect now spans **both** layers (TR-38) — do not stop at `features/effects/`:

**Engine (DSP core) — `src/engine/effects/`:**
1. Add the type to `model/effectType.ts` (`EFFECT_TYPE` enum — the single source).
2. Create the Tone.js class `runtime/effects/<Name>Effect.ts` (wrap `Tone.SomeEffect`, expose params).
3. Register it in `runtime/EffectsFactory.ts` — add a `case EFFECT_TYPE.<NAME>: return new <Name>Effect(...)`.
4. If it needs param mapping, extend `runtime/effectParameterMapping.ts` / `runtime/audioEffectTypes.ts`.

**Feature (UI/config) — `src/features/effects/`:**
5. Add `<effect-name>/config.ts` and register it in `constants/effectConfigs.ts` (+ a preset in `constants/defaultPresets.ts`).
6. Wire UI-side mapping in `services/effectMappings.ts`; the chain UI in `components/` renders knobs from the config.

**Sync (if real-time):** effects use the **ephemeral/commit pattern** — knob changes → ephemeral broadcast, on pointerup → commit to Redis. Throttle differs by room (all from shared SyncConfig): arrange uses `ARRANGE_EPHEMERAL_THROTTLE_MS` (33ms, `collaborationThrottles.ts`); perform uses `PERFORM_SYNTH_THROTTLE_MS` (10ms synth params) / `PERFORM_EFFECTS_THROTTLE_MS` (33ms effects chain — receivers rebuild the effect graph per message) in `useRoomEmitPipeline.ts`. See [`WS_CONTRACT.md`](../../../docs/WS_CONTRACT.md).

## Available Effects

For the full list of supported effect types (Tone.js class, key params, add-new-effect steps) → see the `dsp-audio` skill, which is the authoritative source.

## Working with Instruments

### Instrument Categories

Defined in `app/frontend/src/engine/instruments/shared/constants.ts` (old `features/instruments/shared/constants.ts` path is a compat re-export shim):
- `synth` — Synthesizer (Tone.js PolySynth)
- `keyboard` — Keyboard (3 modes: Basic, Melody, Chord)
- `guitar` — Guitar (fretboard visualization)
- `bass` — Bass guitar
- `drumpad` — Drum pad (General MIDI percussion mapping) for drum machine/abuse providers
- `acoustic_drumset` — Acoustic drumset category that reuses Drumpad/GM input and routes through `AcousticDrumEngine`

All sample-based playback uses a unified **Provider-Backed Architecture**:

```
Drumpad / MIDI / Arrange playback
  -> MelodicEngine / DrumEngine / AcousticDrumEngine (Sub-Engines)
       -> InstrumentProvider (Interface in engine/instruments/providers/types.ts)
            ├── SmplrSoundfontProvider (backed by smplr)
            ├── SmplrDrumProvider (backed by smplr)
            └── VersilianAcousticDrumsetProvider (backed by VersilianAcousticDrumProvider)
```

Keep UI, MIDI, sequencer, and Arrange code dependent on the core sub-engines or `IInstrumentEngine`, never on provider/library-specific internals (like `smplr` or Versilian internals). Custom providers (like custom Tone.js Samplers) can be swapped seamlessly by registering them under `engine/instruments/providers/providerFactory.ts` and updating `engine/instruments/shared/instrumentCatalog.ts`.

When mapping acoustic drums, preserve the actual GM note through `DrumHit.gmNote`. Do not collapse repeated GM labels to one representative piece note: side-stick, acoustic snare, electric snare, pedal hi-hat, open hi-hat, toms, crash variants, and ride bell can target different VCSL instruments or SFZ region notes.

### Synthesizer Parameters

Synth params are synced in real-time using ephemeral/commit pattern:
- Oscillator type (sine, square, sawtooth, triangle, custom)
- Envelope (attack, decay, sustain, release)
- Filter (frequency, resonance, type)
- LFO, modulation, etc.

Backend state: `PerformRoomStateService.updateUserState()` stores `synthParams` per user.

## Audio Context Management

```typescript
import * as Tone from 'tone';
import { AudioContextManager } from '@/engine/audio';

// Get the shared audio context
const audioContext = Tone.getContext().rawContext as AudioContext;

// Get master bus
const masterBus = AudioContextManager.getMasterBus();
const masterGain = masterBus.getMasterGain();
```

### Adaptive Audio Config

The system adapts audio settings based on mesh size (number of WebRTC connections):
- **Small mesh (1-3 users)**: Ultra-low latency, higher polyphony
- **Medium mesh (4-6 users)**: Balanced settings
- **Large mesh (7+ users)**: Reduced polyphony, higher buffer sizes

Config: `ADAPTIVE_AUDIO_CONFIG` in `audioConfig.ts`

## Common Pitfalls

1. **Audio context not started**: Tone.js requires user gesture to start — call `Tone.start()` on first user interaction
2. **Node cleanup**: Always disconnect and dispose Tone.js nodes when components unmount
3. **Sample rate mismatch**: Use 48000Hz to match WebRTC (avoid conversion overhead)
4. **Effect chain order**: Effects are applied in chain order — reverb after distortion sounds different than before
5. **WebRTC priority**: Voice bypasses master bus for lowest latency — don't route voice through effects unless explicitly requested
