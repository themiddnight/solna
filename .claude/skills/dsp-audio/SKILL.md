---
name: dsp-audio
description: Use when touching anything under src/audio/ in solna — the audioEngine singleton, the master effect rack or signal routing, AudioContext lifecycle/first-click init, synth voice allocation, the Beat instrument (drum patches, presets, per-voice mix), the shared 16th clock, or when new audio state must reach the engine from the store. Also use when audio is silent, clicks, drones, or a knob has no audible effect.
---

# Solna DSP & Audio Routing

Solna's audio is **raw Web Audio API**. There is no Tone.js — `tonal` is a music-theory
dependency only, never used for audio.

Everything lives in one singleton: `src/audio/engine.ts` → `export const audioEngine = new AudioEngine()`.

## Non-negotiable rules

1. **Never call an engine setter from a component.** Add the value to a store slice and wire one
   subscription in `src/store/engineSync.ts`. eslint blocks `audio/engine` imports from
   `src/components/**`; the exempt list is the one in `eslint.config.js` (the read-only analyser
   consumers — `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`,
   `ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx` — plus test files). That file is the list
   that binds; this one has drifted behind it before.
2. **`src/audio/` must not import `src/store/` or `src/components/`.** The engine takes plain
   data (`ActiveSynth`, `MasterEffects`, `BeatParams`) and knows nothing about Zustand. The one
   door left open is `createRenderEngine(ctx)`, which binds a throwaway engine to a
   caller-supplied context for the offline mixdown.
3. **Every setter no-ops before `init()`.** They all start `if (!this.ctx) return;`. That is why
   `applyEngineSnapshot()` exists.
4. **Every automation anchor is COMPUTED, never read off `param.value`.** `value` is the param's
   [[current value]] — its intrinsic value at the START of the current render quantum — so it
   answers a question about now, never about the time being scheduled, and a note-off or a
   polyphony re-balance is routinely booked ahead. `cancelScheduledValues(at)` compounds it: it
   removes every event at time >= `at`, and a ramp is anchored only by its END event, so
   cancelling inside a ramp erases the ramp WHOLE — including the part before `at` that has not
   been rendered. Compute the anchor (`envelopeValueAt` / `linearValueAt`), then re-draw the
   erased segment before anchoring. `releaseScheduledParamTo` in `synth/modulation.ts` is the
   shape to copy; both defects above were shipped and measured.

## AudioContext lifecycle

`App.tsx` registers a one-shot `window` click handler:

```ts
audioEngine.init();        // creates AudioContext + setupMasterChain() + click buffers
applyEngineSnapshot();     // re-pushes the whole persisted audio state into the live engine
```

`init()` is idempotent and also `resume()`s a suspended context (browsers suspend on tab
background), so `engineSync.ts` calls it on **every** transport play/stop transition too.
`resetClock()` is called only on the fully-stopped → playing transition.

Values set before the first click are *not* lost — plain fields (`masterRack.beatFilter*`,
`sourceGains`, `sourceMuted`, `clockBpm`, `metronomeEnabled`, and the drum synth's Beat voices
patch) are stored on the instance and read when nodes are later created.

## Signal graph (from `setupMasterChain()`)

```
synth voice (one per bus): osc1/osc2 + sub (+ noise), each through its own level gain
   -> drive (WaveShaper) -> BiquadFilter (VCF) -> ampGain (ENV1's VCA)
   -> tremoloGain (unity; ENV2's amplitude route and the LFO)
   -> polyGain (equal-power polyphony) -> StereoPanner -> the source TAP
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
  lockstep by `setBeatFilter` — so the wet path is filtered too, then on to `reverbNode`.
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

- `triggerSynthNoteOn(noteName, synth, velocity, time, source, scaleFactor, owner)` takes a whole
  `ActiveSynth` (engine id + patch + `sourcePresetId`) and RETURNS a `VoiceId | null` — the only
  handle a note-off can address, and dropping it is how a note drones forever.
  Sources in use: `'synth'`, `'fx'`, `'chord'`, `'bass'`, `'pad'`, `'preview'`. `owner` is a
  `VoiceOwner` (`src/audio/voiceOwner.ts`: `live` / `arp` / `sequencer` / `preview`), is
  **required with no default**, and is stored on the voice. The bridges in `audio/playback/`
  choose it; nothing in `src/components/` names an owner.
- Three release methods, and picking the wrong one is audible. `stopSource(source, …)` kills
  EVERYTHING on the bus including future-scheduled hits and whoever created them — what a
  project install, a loop load or a vibe swap means. `stopOwnedVoices(source, owner, …)` is that
  narrowed to one player, which is what a melody-grid stop means, because live input and the arp
  share the melodic buses. `releaseSoundingVoices(source, releaseTime, owner)` releases only that
  owner's STARTED voices and leaves its future-scheduled hits alone — the arp key-release path.
  All three take the owner (or pointedly do not) as a required argument: whole-bus reach must
  never be reachable by leaving one off, which is how the pre-provenance defect existed.
- Two maps: `activeVoices` keyed `${source}:${noteName}` (latest voice per note, for dedup) and
  `sourceVoices: Map<string, Set<Voice>>` (every live *or future-scheduled* voice, so a whole
  layer can be silenced).
- `'bass'` is forced monophonic — a new bass note releases all other bass voices first.
- One voice slot per `${source}:${noteName}` is still shared BETWEEN owners — see the deferred
  note at `activeVoices` in `engine.ts`. Two players sounding the same note on one bus cut each
  other short; that is known, and not what provenance fixed.
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
- Library auditions (`src/audio/playback/presetPreview.ts`) run on their own `'preview'` source
  bus, not `'synth'`/`'chord'`/`'bass'` — deliberately, so a preview's disposer can call
  `stopSource('preview', …)` without also cutting the user's own held notes. One consequence:
  previews are NOT affected by the synth/chord/bass bus mute or gain (`setSourceMuted`/
  `setSourceGain`) — muting the chord bus does not silence a chord-progression audition.
- `updateSynthPatch(previous, next, source)` (→ `SynthVoiceManager.updatePatch`) re-shapes the
  voices sounding on one bus, and only the CONTINUOUS controls move — envelope timing, unison
  count and the route list shape a voice at construction, so they take effect on the next note.
  Two things release the bus instead of morphing it: a change of voice MODE or ENGINE
  (`changesTopology`), and a PRESET arriving (`installsDifferentPreset` — a non-null
  `sourcePresetId` that differs from the one playing; a knob move CLEARS that id, which is why
  a bare inequality would stop the bus on the first knob turn).
- A destination ENV2 already owns is SKIPPED by a live update rather than written: a
  `setValueAtTime` on a param carrying a scheduled contour re-anchors that contour, heard as the
  modulation collapsing the moment an unrelated knob moves.
- **ENV2 and the LFO write different params on purpose.** The ENV2 router computes absolute
  endpoints and writes the INTRINSIC value (`filter.frequency`, `oscillators[n].frequency`); the
  LFO CONNECTS a signal and therefore lands on the offset (`filter.detune`, `.detune`), where it
  sums instead of overwriting. A connected modulator arrives in the PARAM's unit, so every LFO
  destination carries a `unitScale` — without it 12 semitones reached a `detune` as 12 cents.
- The `amplitude` target drives the **series** `tremoloGain` between the VCA and the panner.
  Connecting a node to `ampGain.gain` would SUM with the amp envelope: the release would never
  reach silence and the sum would invert phase on the downswing. A depth of 0 tears the LFO down
  through `SynthLfoBank`'s `pendingTeardowns` sweep, on the AUDIO clock, so the node is
  disconnected only once its last ramp has actually been rendered.
- `setPolyphonyScale(source, scale, at)` ducks a whole bus equal-power as keys go down and lifts
  it as they come up. It is a RAMP on a gain of its own — never a write to `ampGain` or
  `tremoloGain`, both of which carry contours a write would re-anchor.

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
5. Do NOT bump the persist `version` for it. There are no migration chains any more: a persisted
   shape change is handled by validating the new key on every read
   (`sanitizePersistedState`/`sanitizeLoops` in `store.ts`), not by a version-gated branch. See
   CLAUDE.md's "no migration chains" note for the precondition under which that stops being true.

**Legacy trap:** `chorusWet`/`chorusRate`/`chorusDepth`/`delayTime` are GONE from `MasterEffects`,
and `sanitize.ts` deletes them from any old payload so they cannot resurrect. Don't wire UI to
them, and don't re-add one to the type to "support old saves".

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
(see the Beat-filter subscription) so the subscription fires only on real changes.

## The Beat instrument

There is no kit table and no merge. A **Beat patch is COMPLETE**: `BeatParams` carries `voices`
(every voice stating every field), an `outputTrimDb` calibration figure and its own bus `filter`,
so a patch a user edits, saves or exports is self-contained — no `Partial` over a shared default,
no `mergeDrumKit`, and no trim table beside the engine (`src/audio/trims.ts` does not exist).

- `src/data/beatPresets.ts` — `BEAT_PRESETS`, the factory library: `FactoryBeatPreset` literals
  with stable ids, each carrying a whole patch and its own provenance. A user's saved presets live
  in the store (`customBeatPresets`), never here. Installing a preset installs it WHOLE
  (`structuredClone`d on the way in).
- `src/data/beatPresets.ts` also exports `BEAT_VOICE_IDS` (beside `DEFAULT_BEAT_VOICES`, the
  default preset's own voices object, shared by reference with its entry in the table). It declares
  the eleven voices and their canonical order: `kick, snare, rimshot, clap, hihat, openhat, hitom,
  lowtom, ride, crash, bell`. The types are elsewhere — `BeatVoiceId`, `BeatVoices`, `BeatParams`
  and `FactoryBeatPreset` are all in `src/types.ts`. The `BeatVoices` interface, every preset patch,
  `DEFAULT_PADS` (`src/components/ui/DrumPadGrid.tsx`) and `triggerDrum`'s dispatch all follow that
  order, so any two of those lists compare as sorted lists. `BeatVoices` carries no
  `reference` field — provenance sits on `FactoryBeatPreset` — so `keyof BeatVoices` stays exactly
  the voice roster.
- `src/audio/beatAdapter.ts` — `applyBeatParams(engine, params, time?)` is the ONE hop from a patch
  to the DSP: `engine.setDrumKit(params.voices, params.outputTrimDb)` plus
  `engine.setBeatFilter(cutoff, resonance, type, time)`. It takes the engine as an argument, so the
  live bridge (`store/engineSync.ts`), the transient drag preview (`store/beatPreview.ts`) and the
  offline mixdown all install a Beat by the same definition, and the render never touches the
  singleton. Do not add a second installer.
- `triggerDrum(type, velocity, time?)` resolves `DRUM_ALIASES` (`src/audio/drumSynth.ts`) before
  its dispatch, and that table
  is exactly `{ closedhat: 'hihat' }` — an alias pointing at a voice that has since gained its own
  case would make that case dead code silently, which is why a test asserts the table exhaustively.
- **The Beat is per LOOP**, and the store holds it as three sibling fields — `beatParams` (sound),
  `beatPattern` (events), `beatMix` (levels). A per-voice mute is applied twice on purpose:
  `audio/beatSteps.ts` skips a muted voice's scheduled hits, and `engineSync.pushBeatVoiceGains`
  drives its gain to 0 so a drum-PAD hit or a live trigger the step walk never sees is silent too.
- **Legacy drum state (`soundKit`, `drumFilter*`, `masterSequencerVolume`, `drumMuted`,
  `sequencerTracks`, `DrumKit`, `DRUM_KITS`) is gone from the app.** The only place those names may
  appear is the read boundary `src/store/sanitizeBeat.ts`, pinned by a literal allowlist in
  `src/store/beatLegacyBoundary.test.ts`. Reintroducing one is a test failure, not a judgement call.

**Invariant, enforced by `bun run check:drums`** (`scripts/check-drum-kit-separation.ts`):
1. every preset must voice **every** one of the 11 voices away from the default — the one skipped
   entry is the default preset itself, and the script asserts exactly one baseline exists, so that
   exclusion cannot quietly grow;
2. listed params must spread far enough across presets (`max >= factor * min`); new parameters enter
   through `spread()`/`spreadDefined()`, never `PAIRWISE_PARAMS`;
3. voices that could collapse into a sibling *inside one patch* — rimshot against that preset's
   snare, the two toms, ride against crash — are covered by the separate `withinKit` check, which
   fails closed on an unmeasurable pair.

`bun run check:levels` re-measures the calibration trims against today's preset defaults. Adding or
editing a preset means running both; `bun run verify` includes them.

## Synth presets

`src/data/synthPresets.ts` exports `SYNTH_PRESETS`: a table of `SynthPreset` literals, each
carrying a COMPLETE `patch` (there is no base to merge over any more, so an audition is the sound
the card promises). The lookups — `presetById`, `applySynthPreset`, `getAllSynthPresets`,
`groupPresets`, `findPresetByName`, `resolveFactorySynth` — are in `src/utils/synthPresets.ts`;
there is no `src/audio/presetRegistry.ts`.

A preset reaches the engine only by being written into a store slice as an `ActiveSynth`, which
`engineSync.ts` forwards through `updateSynthPatch`. `applySynthPreset` stamps
`sourcePresetId`, and that id is what makes a preset install stop the bus rather than morph it
(see the voices section). Every patch a preset yields is `structuredClone`d — the library is
module-scope literal data, and one knob drag on a shared object would rewrite the factory entry
for the rest of the session.

## Debugging checklist

| Symptom | Likely cause |
|---|---|
| Nothing audible at all | No user click yet — `ctx` is null and every setter no-opped |
| Knob does nothing until next note | Param not handled in `updateVoice` (subtractiveVoice.ts) — or deliberately deferred there, as `noiseEnabled`/`noiseColor` are |
| New effect silent | Missing `bus.connect(this.fooNode)` in `getSourceBus()` |
| Note drones forever | A bridge dropped the `VoiceId` `triggerSynthNoteOn` returned, so no `triggerSynthNoteOff` can address the voice. There is NO wall-clock lifetime backstop — see `voiceManager.ts` rule 5 — so trace the bridge, not the manager |
| Scheduled pattern notes vanish | Something called `updateSynthPatch`/`stopSource` on future voices and cancelled their ramps |
| Clicks on mute | Bypassed the `setTargetAtTime(…, 0.01)` ramp in `setSourceMuted` |

Gate: `bun run verify` — see CLAUDE.md for what it runs; `bun run eslint` is part of it and must
report nothing at all. Engine tests live in `src/audio/engine.test.ts`, and what the synth voice
SOUNDS like is measured off rendered samples in `src/audio/synth/subtractiveSignal.test.ts`. A
graph assertion proves a param was scheduled; only a render proves what came out, and every ratio
there is guarded against a silent denominator.
