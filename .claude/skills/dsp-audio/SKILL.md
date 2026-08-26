---
name: dsp-audio
description: Use when touching anything under src/audio/ in solna — the audioEngine singleton, the master effect rack or signal routing, AudioContext lifecycle/first-click init, synth voice allocation, drum kits, the shared 16th clock, or when new audio state must reach the engine from the store. Also use when audio is silent, clicks, drones, or a knob has no audible effect.
---

# Solna DSP & Audio Routing

Solna's audio is **raw Web Audio API**. There is no Tone.js — `tonal` is a music-theory
dependency only, never used for audio.

Everything lives in one singleton: `src/audio/engine.ts` → `export const audioEngine = new AudioEngine()`.

## Non-negotiable rules

1. **Never call an engine setter from a component.** Add the value to a store slice and wire one
   subscription in `src/store/engineSync.ts`. eslint blocks `audio/engine` imports from
   `src/components/**` (exempt: `AudioVisualizer.tsx`, `TransportBar.tsx`, test files).
2. **`src/audio/` must not import `src/store/` or `src/components/`.** The engine takes plain
   params (`SynthParams`, `MasterEffects`, `DrumKit`) and knows nothing about Zustand.
3. **Every setter no-ops before `init()`.** They all start `if (!this.ctx) return;`. That is why
   `applyEngineSnapshot()` exists.

## AudioContext lifecycle

`App.tsx` registers a one-shot `window` click handler:

```ts
audioEngine.init();        // creates AudioContext + setupMasterChain() + click buffers
applyEngineSnapshot();     // re-pushes the whole persisted audio state into the live engine
```

`init()` is idempotent and also `resume()`s a suspended context (browsers suspend on tab
background), so `engineSync.ts` calls it on **every** transport play/stop transition too.
`resetClock()` is called only on the fully-stopped → playing transition.

Values set before the first click are *not* lost — plain fields (`drumFilterCutoff`,
`sourceGains`, `sourceMuted`, `clockBpm`, `metronomeEnabled`, `drumKit`) are stored on the
instance and read when nodes are later created.

## Signal graph (from `setupMasterChain()`)

```
synth/chord/bass voice: osc1 + subOsc (+ noise) -> BiquadFilter (VCF) -> GainNode (VCA) -> tremoloGain (unity)
                                                                                           |
                                                                                           v
                        per-source GainNode bus   (lazy, one per source string)
                          |      |       |     \
                        dry   delay   reverb  distortion
                                 |       |         |
drums: osc/noise -> drumEnv -> drumBusFilter -> dryGain
                            \_ (snare/clap/crash only) send gain (kit's
                               reverbSend LEVEL) -> drumSendFilter -> reverbNode
                                 |       |         |
   delayNode <-> delayFeedbackGain, delayNode -> delayGain
   reverbNode(Convolver) -> reverbGain
   distortionNode(WaveShaper 4x) -> distortionGain
                          \       |       |        /
                           -> eqLow(lowshelf 250Hz)
                              -> eqMid(peaking 1.5kHz Q1)
                                 -> eqHigh(highshelf 4kHz)
                                    -> compressor (-12dB, 4:1, knee 30)
                                       -> masterGain (user master trim, setMasterVolume)
                                          -> limiter (-3dB, 20:1, knee 0)
                                             -> analyser (fftSize 256)
                                                -> ctx.destination
```

Key consequences:
- Effects are **parallel sends**, not a serial insert chain. Dry always passes; wet amount is the
  send gain (`reverbGain`/`delayGain`/`distortionGain`).
- EQ → compressor → masterGain → limiter → analyser is **serial and fixed**. The analyser is
  post-limiter, so `getAudioLevel()` reflects final output.
- Drums bypass delay and distortion entirely — the dry path hits `drumBusFilter → dryGain` only.
  The snare/clap/crash reverb send is a per-voice gain (the kit's authored `reverbSend` LEVEL,
  not a boolean) that feeds a second shared `drumSendFilter` — a mirror of `drumBusFilter` kept in
  lockstep by `setDrumFilter` — so the wet path is filtered too, then on to `reverbNode`.
- `masterGain` is the user's master trim only (`setMasterVolume()`, clamped 0..1, seeded at unity). Headroom is the compressor (-12 dB, 4:1) and the limiter (-3 dB, 20:1); there is no separate staging gain.
- Bypass flags are applied in `updateEffects()` by forcing the wet/gain value to 0, not by
  rewiring. `reverbDecay` is the impulse **duration in seconds** (the curve exponent is a fixed
  2.0); changes are quantised to 0.1 s and the built `AudioBuffer`s are cached in
  `impulseCache`, which `setupMasterChain()` clears because a buffer belongs to its context.
- Every numeric `MasterEffects` value is clamped by `src/audio/effectLimits.ts` in BOTH `updateEffects()` and `store.sanitizePersistedState`. Add a new effect's range there, not inline.

## Voices and per-source buses

- `triggerSynthNoteOn(noteName, params, velocity, time?, source='synth', scaleFactor=1)`.
  Sources in use: `'synth'`, `'chord'`, `'bass'`.
- Two maps: `activeVoices` keyed `${source}:${noteName}` (latest voice per note, for dedup) and
  `sourceVoices: Map<string, Set<Voice>>` (every live *or future-scheduled* voice, so a whole
  layer can be silenced).
- `'bass'` is forced monophonic — a new bass note releases all other bass voices first.
- Layer control goes through the lazy per-source `GainNode` bus: `setSourceGain(source, v)` /
  `setSourceMuted(source, bool)`, both with a ~10 ms `setTargetAtTime` ramp (click-free).
  `setupMasterChain()` clears `sourceBuses` because old buses point at dead nodes.
- `stopSource()` kills everything including future-scheduled hits; `releaseSoundingVoices()`
  leaves future hits alone (used for arp key-release). Pick deliberately.
- `updateSynthParams(params, source?)` re-shapes only voices that are already sounding; voices
  scheduled in the future and voices already in their release tail are skipped on purpose —
  re-targeting them cancels their scheduled ramps and makes them silent.
- The LFO's `'volume'` target drives a **series** `tremoloGain` between the VCA and the bus.
  Connecting a node to `gains[0].gain` would SUM with the amp envelope: the release would never
  reach silence and the sum would invert phase on the downswing. Depth 0 stops and disconnects
  the LFO after ~5 time constants; `setTargetAtTime(0, …)` alone never reaches zero.

## Shared clock

One lookahead scheduler (`subscribeClock`) drives every player off a single 16th-note grid:
`setInterval` every 25 ms, schedules 100 ms ahead, re-anchors after stalls. Listeners get
`(step, beat, audioTime)` and must schedule with that exact `time`, never `currentTime`.
The grid keeps position across stop/start so mid-playback re-renders don't glitch.

## Adding a new effect

Follow how distortion is wired — it is the smallest complete example.

1. `src/types.ts`: add fields to `MasterEffects` (e.g. `fooWet: number; fooBypass?: boolean`).
1b. `src/audio/effectLimits.ts`: add the field's `{ min, max, fallback }` to `EFFECT_LIMITS`.
2. `src/audio/engine.ts`:
   - add private node fields (`fooNode`, `fooGain`);
   - create them in `setupMasterChain()`, set `fooGain.gain.value` to a default, and
     `fooNode.connect(fooGain)` then `fooGain.connect(this.eqLowNode)`;
   - add `if (this.fooNode) bus.connect(this.fooNode);` inside `getSourceBus()` so every source
     feeds the new send (this is the step that is easy to forget — without it the effect is
     wired but receives nothing);
   - in `updateEffects()`, compute `const fooWet = fx.fooBypass ? 0 : fx.fooWet;` and apply with
     `setTargetAtTime(fooWet, this.ctx.currentTime, 0.05)`.
3. `src/store/initialState.ts`: add the default to `INITIAL_EFFECTS`.
4. No new subscription is needed — `engineSync.ts` already subscribes to the whole `effects`
   object and calls `updateEffects`. Only add a subscription for state outside `effects`.
5. Bump the persist `version` in `src/store/store.ts` if the shape change breaks old saves.

**Legacy trap:** `MasterEffects` still declares `chorusWet`/`chorusRate`/`chorusDepth`/`delayTime`.
Nothing implements them; `store.ts`'s migrate strips them. Don't wire UI to those fields.

## Adding store state that must reach the engine

```ts
// src/store/engineSync.ts, inside startEngineSync()
subs.push(useAppStore.subscribe(
  (s) => s.myValue,
  (v) => audioEngine.setMyValue(v),
  { fireImmediately: true },   // always: bootstraps the engine with the current value
));
```
Then add the same call to `applySliceState()` so `applyEngineSnapshot()` re-applies it after the
context is created. Multi-field engine setters are subscribed as one encoded primitive string
(see the drum-filter subscription) so the subscription fires only on real changes.

## Drum kits

`src/audio/drumKits.ts`: `DrumKit` has 7 types — `kick, snare, hihat, openhat, clap, tom, crash`.
`DRUM_KITS` holds `Partial<DrumKit>` overrides merged onto `DEFAULT_DRUM_KIT` by `mergeDrumKit()`.
`triggerDrum(type, velocity, time?)` accepts aliases: `closedhat`→hihat, `lowtom`→tom, `ride`→crash.

**Invariant, enforced by `bun run check:drums`** (`scripts/check-drum-kit-separation.ts`):
1. every kit must override **every** one of the 7 types (no type left equal to defaults);
2. listed params must spread far enough across kits (`max >= factor * min`), e.g. `kick.decay` 3×,
   `snare.noiseFilter` 2.8×, `hihat.filter` 2.5×.

Adding or editing a kit means running `bun run check:drums`. `bun run verify` includes it.

## Synth presets

`src/audio/synthPresets.ts` exports `FACTORY_PRESETS` / `ALL_FACTORY_PRESETS` (`SynthPresetItem`
grouped by `SynthPresetCategory`). Presets are plain `SynthParams` data — they reach the engine
only by being set into a store slice, which `engineSync.ts` forwards to `updateSynthParams`.

## Debugging checklist

| Symptom | Likely cause |
|---|---|
| Nothing audible at all | No user click yet — `ctx` is null and every setter no-opped |
| Knob does nothing until next note | Param not handled in `updateSynthParams` (only live voices are re-shaped) |
| New effect silent | Missing `bus.connect(this.fooNode)` in `getSourceBus()` |
| Note drones forever | Release path skipped — check `releaseScheduledAt` / `releaseVoice` teardown timeout |
| Scheduled pattern notes vanish | Something called `updateSynthParams`/`stopSource` on future voices and cancelled their ramps |
| Clicks on mute | Bypassed the `setTargetAtTime(…, 0.01)` ramp in `setSourceMuted` |

Gate: `bun run verify` (test + lint + check:keys + check:drums + build). Engine tests live in
`src/audio/engine.test.ts`.
