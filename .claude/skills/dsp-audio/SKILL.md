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
                        per-source TAP GainNode (unity, lazy)  [TAP: getSourceAnalyser -> per-layer scope]
                                                                                           |
                                                                                           v
                        per-source GainNode bus   (lazy, one per source string)
                          |-> per-source LEVEL analyser (lazy, fftSize 2048)
                          |     [TAP: getSourceLevelAnalyser -> the mixer's per-layer SourceMeter]
                          |      |       |     \
                        dry   delay   reverb  distortion
                                 |       |         |
drums: osc/noise -> drumEnv -> drumBusFilter -> sequencer TAP -> sequencer bus -> dryGain
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
                                    -> masterGain (user master trim, setMasterVolume)
                                       |-> analyser (fftSize 256)    [TAP: no output]
                                       |-> levelAnalyser (fftSize 2048) [TAP: no output]
                                       -> [compressor?] -> [limiter?] -> ctx.destination
```

Two taps on `masterGain`, not one: `analyser` is the spectrum node `AudioVisualizer` draws,
`levelAnalyser` is the one `getMasterLevelAnalyser()` returns and every MASTER dBFS meter reads.

Each SOURCE has two of its own, for the same reason, and they read DIFFERENT POINTS — do not
merge them:
- `getSourceAnalyser()` is **pre-fader**, off the TAP gain after the VCA and before the bus gain
  and the sends. It feeds that layer's scope, so the scope shows the patch being edited whatever
  the fader is doing.
- `getSourceLevelAnalyser()` is an observe-only send off the **bus**, so it is **post-fader** and
  after mute/solo. It feeds the mixer's per-layer `SourceMeter`, which is what makes a fader move
  show on the meter beside it — and what lets `ui/SourceMeter.tsx` be a legal reader under
  layering rule 4, since the audibility is already IN the number.

Key consequences:
- Effects are **parallel sends**, not a serial insert chain. Dry always passes; wet amount is the
  send gain (`reverbGain`/`delayGain`/`distortionGain`).
- EQ → masterGain is serial and fixed. TWO analysers are TAPS off `masterGain` — post-fader,
  pre-dynamics, each with no onward output — so a reading reflects the mix the user made, not
  the post-squash output. `analyser` (fftSize 256) is the spectrum node `AudioVisualizer` draws;
  `levelAnalyser` (fftSize 2048) is what `getMasterLevelAnalyser()` returns and `useMeterLevel`
  reads for `VuMeter` and `AmbientBackdrop`. They are NOT interchangeable, and because the tap
  ends both dynamics stages' reach, the `over` zone (≥ −1 dBFS) is reachable.
- Drums bypass delay and distortion entirely — the dry path hits `drumBusFilter → dryGain` only.
  The snare/clap/crash reverb send is a per-voice gain (the kit's authored `reverbSend` LEVEL,
  not a boolean) that feeds a second shared `drumSendFilter` — a mirror of `drumBusFilter` kept in
  lockstep by `setDrumFilter` — so the wet path is filtered too, then on to `reverbNode`.
- `masterGain` is the user's master trim only (`setMasterVolume()`, clamped 0..1, seeded at
  unity). The master compressor and limiter are explicit, toggleable master FX
  (`compressorEnabled` / `limiterEnabled` in `MasterEffects`). `compressorEnabled` defaults
  off; `limiterEnabled` defaults on (DEV-383) — the master analysers tap ahead of both stages,
  so this doesn't compromise metering, and the -3 dB threshold against the -6 dB source-bus
  default only catches occasional peaks rather than compressing continuously. When a stage is
  off it is genuinely disconnected, not neutralised. The "limiter" is a
  max-ratio compressor with a hard knee — the standard Web Audio stand-in, since the API has no
  dedicated limiter.
- A SERIES stage cannot use the `*Bypass` mechanism: bypass flags force a wet/send gain to 0,
  which for a compressor is silence rather than passthrough. `rewireMasterDynamics` reconnects
  the master tail instead. The three nodes are built once and never re-created, so a rewire can
  never orphan one; it re-makes BOTH analyser taps first and unconditionally, because
  `masterGain.disconnect()` drops both and neither has an output that would put it back.
  Forgetting `levelAnalyser` there throws nothing and orphans nothing — it just pins every meter
  at −∞, which is why `engine.test.ts` asserts the tap survives a full toggle cycle.
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
- **Nothing connects to a source bus directly — everything connects to its `sourceTaps` entry**,
  a unity `GainNode` whose only output is the bus. It exists so `getSourceAnalyser` can read a
  layer PRE-fader: the per-layer scope draws a raw −1..+1 waveform against the full height of its
  box, so a post-fader tap made "full height" mean "full scale after the −6 dB bus default" —
  a patch as loud as it can get painted a half-height trace, and moving a fader resized the wave
  of a patch that had not changed. Fader and mute stay on the bus and are unchanged. Adding a new
  producer for a layer means connecting it to `getSourceTap(source)`; wiring it to
  `getSourceBus(source)` is audible but invisible to that layer's scope. Cleared with
  `sourceBuses` for the same dead-context reason.
- `stopSource()` kills everything including future-scheduled hits; `releaseSoundingVoices()`
  leaves future hits alone (used for arp key-release). Pick deliberately.
- Library auditions (`src/audio/playback/presetPreview.ts`) run on their own `'preview'` source
  bus, not `'synth'`/`'chord'`/`'bass'` — deliberately, so a preview's disposer can call
  `stopSource('preview', …)` without also cutting the user's own held notes. One consequence:
  previews are NOT affected by the synth/chord/bass bus mute or gain (`setSourceMuted`/
  `setSourceGain`) — muting the chord bus does not silence a chord-progression audition.
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

`src/data/drumKits.ts`: `DRUM_TYPES` declares 11 voices, and its order is the canonical one —
`kick, snare, rimshot, clap, hihat, openhat, hitom, lowtom, ride, crash, bell`. `DrumKit` and
`triggerDrum`'s dispatch follow it, so any two of those lists compare as sorted lists.
`mergeDrumKit` is in `src/audio/drumKits.ts`.
`DRUM_KITS` holds `Partial<DrumKit>` overrides merged onto `DEFAULT_DRUM_KIT` by `mergeDrumKit()`.
`triggerDrum(type, velocity, time?)` resolves `DRUM_ALIASES` before its dispatch, and that table is
exactly `{ closedhat: 'hihat' }` — an alias pointing at a voice that has since gained its own case
would make that case dead code silently, which is why a test asserts the table exhaustively.

**Invariant, enforced by `bun run check:drums`** (`scripts/check-drum-kit-separation.ts`):
1. every kit must override **every** one of the 11 voices (no voice left equal to defaults);
2. listed params must spread far enough across kits (`max >= factor * min`), e.g. `kick.decay` 3×,
   `snare.noiseFilter` 2.8×, `hihat.filter` 2.5×;
3. voices that could collapse into a sibling *inside one kit* — rimshot against that kit's snare, the
   two toms, ride against crash — are covered by the separate `withinKit` check, not by the
   across-kit spread, and it fails closed on an unmeasurable pair.

Adding or editing a kit means running `bun run check:drums`. `bun run verify` includes it.

## Synth presets

`src/data/synthPresets.ts` exports `SYNTH_PRESETS` (29 entries, `SynthPresetItem` …); the lookups
(`presetById`, `applyPreset`, `getAllSynthPresets`, `getPresetsGroupedByCategory`) are in
`src/audio/presetRegistry.ts`. Presets are plain `SynthParams` data — they reach the engine only
by being set into a store slice, which `engineSync.ts` forwards to `updateSynthParams`.

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
