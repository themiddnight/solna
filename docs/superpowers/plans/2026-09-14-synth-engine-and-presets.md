# Extensible Synth Engine and Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat single-oscillator synth with the approved engine-discriminated standard subtractive synth, complete presets, owner-safe voice lifecycle, and locked Simple/Pro interfaces.

**Architecture:** Introduce the engine-domain types and a new subtractive DSP beside the current engine, verify it independently, then cut store/playback over atomically. Keep Arp as separate performance state, drive realtime and offline rendering through one voice manager, and make both approved UI depths read one complete patch.

**Tech Stack:** Bun, TypeScript, React, Zustand, Web Audio API, Tailwind/daisyUI, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md`

**Visual reference:** `docs/superpowers/prototypes/2026-09-14-synth-lab-approved-ui.html` — Variant A is locked Pro; Variant B is locked Simple. Reconstruct these layouts with production components; do not promote prototype code.

**Scope note:** This remains one plan because the domain model, DSP, store shape, UI adapters, preset content, and offline calibration depend on the preceding contracts and converge on one cutover. The tasks are staged so the new DSP is independently testable before that cutover.

## Global Constraints

- Implement only the `subtractive` engine; do not add inert FM or wavetable runtime entries.
- Persist canonical units: Hz, seconds, cents, semitones, dB, degrees, and documented unitless 0..1 controls.
- A synth preset is a complete engine-discriminated patch. Arp and the external effect chain are not part of it.
- ENV1 is amplitude-only. ENV2 has at most two routes. LFO has one route and supports Hz/Sync plus Transport/Note trigger.
- Mono uses automatic legato over an owner-aware held-note stack. Poly has independent voices and no glide.
- Simple has no persisted state and writes the approved canonical Pro controls; switching view performs no write.
- Realtime and offline rendering use the same engine and graph-building code.
- Incompatible legacy flat synth bodies fall back to explicit track defaults; do not add a version-gated migration chain or bump a format version.
- `PROJECT_FORMAT_VERSION` stays at its current value even though this change replaces the value type of five top-level content keys. That is a deliberate call, not the no-migration rule applied mechanically: the constant is the murva-facing interop marker, and murva has not implemented the synth half of the contract at all, so there is no reader to signal and nothing for a bump to protect. Revisit the moment murva reads a synth body — at that point a wholesale patch-shape replacement IS a content-contract change and does warrant a bump.
- Preserve repository import layering. `src/data/` remains independent literal leaves and imports types only.
- Every task follows red-green-refactor and ends in a focused commit. Completion requires `bun run verify` with no new ESLint warnings.

---

### Task 1: Engine-domain types and canonical patch math

**Files:**
- Create: `src/types/synth.ts`
- Create: `src/utils/synthPatch.ts`
- Create: `src/utils/synthPatch.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Produces `SynthEngineId`, `EnginePatchMap`, `EnginePatch<E>`, `ActiveSynth<E>`, `CommonVoiceParams`, `SubtractiveParams`, `ModRoute`, `LfoParams`, and `ArpSettings` from `@/types/synth`.
- Produces `dbToGain`, `gainToDb`, `semitonesToRatio`, `oscillatorBalance`, `writeOscillatorBalance`, `lfoRateHz`, and `modulationAmount` from `@/utils/synthPatch`.
- `src/types.ts` re-exports the new public types while the legacy `SynthParams` remains until Task 7 cutover.

- [ ] **Step 1: Write failing table-driven tests for unit transforms and equal-power balance.**

```ts
expect(dbToGain(0)).toBeCloseTo(1);
expect(gainToDb(dbToGain(-18))).toBeCloseTo(-18);
expect(semitonesToRatio(12)).toBeCloseTo(2);

const original = { osc1Db: -6, osc2Db: -12 };
const moved = writeOscillatorBalance(original, 0.75);
expect(oscillatorBalance(moved)).toBeCloseTo(0.75);
expect(dbToGain(moved.osc1Db) ** 2 + dbToGain(moved.osc2Db) ** 2)
  .toBeCloseTo(dbToGain(original.osc1Db) ** 2 + dbToGain(original.osc2Db) ** 2);
```

Also cover signed target units, dotted/triplet note divisions, zero-gain dB flooring, and invalid balance clamping.

- [ ] **Step 2: Run the test and confirm the missing modules fail.**

Run: `bun test src/utils/synthPatch.test.ts`
Expected: FAIL because `types/synth.ts` and `utils/synthPatch.ts` do not exist.

- [ ] **Step 3: Add the discriminated types and pure transforms.**

```ts
export type SynthEngineId = 'subtractive';

export interface EnginePatchMap {
  subtractive: SubtractiveParams;
}

export interface ActiveSynth<E extends SynthEngineId = SynthEngineId> {
  engine: E;
  patch: { common: CommonVoiceParams; synth: EnginePatchMap[E] };
  sourcePresetId: string | null;
}
```

Represent `LfoParams.rate` as `{ mode: 'hz'; hz: number } | { mode: 'sync'; division: NoteDivision }`. Represent `ModRoute` as a target-discriminated union so the amount's documented unit travels with each target family. Keep Arp types in this neutral module but outside `EnginePatch`.

- [ ] **Step 4: Run focused tests and type-check.**

Run: `bun test src/utils/synthPatch.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/types/synth.ts src/utils/synthPatch.ts src/utils/synthPatch.test.ts src/types.ts
git commit -m "feat(synth): define engine patch domain"
```

### Task 2: Whole-patch validation and explicit defaults

**Files:**
- Create: `src/store/sanitizeSynth.ts`
- Create: `src/store/sanitizeSynth.test.ts`
- Create: `src/data/subtractiveDefaults.ts`
- Modify: `src/store/initialState.ts`

**Interfaces:**
- Produces `sanitizeActiveSynth(value, fallback): { value: ActiveSynth; issues: SynthValidationIssue[] }` and `sanitizeArpSettings(value, fallback): ArpSettings`.
- Produces temporary explicit `SUBTRACTIVE_INIT` and `TRACK_SYNTH_DEFAULTS` literals in `src/data/subtractiveDefaults.ts`, plus permanent `TRACK_ARP_DEFAULTS` in `initialState.ts`. Task 11 replaces the temporary sound literals with preset-ID resolution and deletes their duplicate file.
- Validation accepts a complete patch or returns the complete supplied fallback; it never partially merges a malformed patch.

- [ ] **Step 1: Write failing tests for valid, clamped, incomplete, and unknown-engine inputs.**

```ts
expect(sanitizeActiveSynth(SUBTRACTIVE_INIT, SUBTRACTIVE_INIT).value)
  .toEqual(SUBTRACTIVE_INIT);

const clipped = structuredClone(SUBTRACTIVE_INIT);
clipped.patch.synth.filter.cutoffHz = 99_000;
expect(sanitizeActiveSynth(clipped, SUBTRACTIVE_INIT).value.patch.synth.filter.cutoffHz)
  .toBe(20_000);

expect(sanitizeActiveSynth({ engine: 'fm', patch: {} }, SUBTRACTIVE_INIT).value)
  .toEqual(SUBTRACTIVE_INIT);
expect(sanitizeActiveSynth({ engine: 'subtractive', patch: {} }, SUBTRACTIVE_INIT).value)
  .toEqual(SUBTRACTIVE_INIT);
```

Assert ENV2 route arrays over two invalidate the patch, LFO has exactly one route, wrong enums invalidate, finite numeric overflow clamps, and legacy `SynthParams` falls back with an issue.

- [ ] **Step 2: Run the validator test and confirm missing exports fail.**

Run: `bun test src/store/sanitizeSynth.test.ts`
Expected: FAIL because the validator and fixtures do not exist.

- [ ] **Step 3: Write complete literal init/track fixtures and recursive engine-specific validation.**

Use one neutral saw init plus explicit Lead, FX, Chord, Bass, and Pad defaults. Do not generate data entries at module evaluation time. Validate every property, tuple length, enum, route target, and array cap; copy accepted values so untrusted input cannot retain object identity with installed state.

- [ ] **Step 4: Run validator, data-purity, and initial-state tests.**

Run: `bun test src/store/sanitizeSynth.test.ts src/data/dataLayerPurity.test.ts src/store/initialState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/store/sanitizeSynth.ts src/store/sanitizeSynth.test.ts src/data/subtractiveDefaults.ts src/store/initialState.ts
git commit -m "feat(store): validate complete synth patches"
```

### Task 3: Modulation, noise, and automation primitives

**Files:**
- Create: `src/audio/synth/modulation.ts`
- Create: `src/audio/synth/modulation.test.ts`
- Create: `src/audio/synth/noise.ts`
- Create: `src/audio/synth/noise.test.ts`
- Modify: `src/audio/engineTestHelpers.ts`

**Interfaces:**
- Produces `scheduleAdsr(param, envelope, levels, at)`, `schedulePitchEnvelope(param, envelope, semitones, at)`, and `releaseScheduledParam(param, at, seconds)`.
- Produces `createNoiseBuffer(ctx, type, random): AudioBuffer` for white, pink, and brown noise with injectable randomness.
- All functions accept `BaseAudioContext`-compatible nodes and exact audio-clock times.

- [ ] **Step 1: Write failing automation tests against fake `AudioParam` event logs.**

```ts
schedulePitchEnvelope(detune, { attackSeconds: 0, decaySeconds: 1, sustain: 0, releaseSeconds: .1 }, 48, 2);
expect(detune.events).toEqual([
  ['set', 4800, 2],
  ['ramp', 0, 3],
]);
```

Cover negative route amounts, non-zero sustain, release from attack/decay/sustain, amplitude flooring, and cancellation at an exact scheduled time.

- [ ] **Step 2: Write failing spectral-statistic tests for deterministic noise.**

Generate all three buffers with a seeded test random function. Assert near-zero DC, white's broad flatness, pink's lower high-band energy, and brown's lower high-band energy than pink. Assert two calls with the same injected sequence match byte-for-byte.

- [ ] **Step 3: Run both tests and confirm missing modules fail.**

Run: `bun test src/audio/synth/modulation.test.ts src/audio/synth/noise.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement minimal scheduling and noise generation.**

Use audio-clock automation only; do not use wall-clock timers for envelopes. Convert pitch semitones to cents before scheduling. Cache production noise buffers by context and type in the eventual engine owner, not in this pure generator.

- [ ] **Step 5: Run focused tests and commit.**

Run: `bun test src/audio/synth/modulation.test.ts src/audio/synth/noise.test.ts`
Expected: PASS.

```bash
git add src/audio/synth/modulation.ts src/audio/synth/modulation.test.ts src/audio/synth/noise.ts src/audio/synth/noise.test.ts src/audio/engineTestHelpers.ts
git commit -m "feat(audio): add synth modulation primitives"
```

### Task 4: Subtractive voice graph

**Files:**
- Create: `src/audio/synth/subtractiveVoice.ts`
- Create: `src/audio/synth/subtractiveVoice.test.ts`
- Create: `src/audio/synth/driveCurve.ts`
- Modify: `src/audio/synth/modulation.ts`
- Modify: `src/audio/engineTestHelpers.ts`

**Interfaces:**
- Produces `createSubtractiveVoice(ctx, patch, event, destinations): SubtractiveVoice`.
- `SubtractiveVoice` exposes its unique ID, owner/source/note metadata, node groups, `release(at, seconds)`, `update(previous, next, at)`, and `teardown(at)`.
- Signal path is oscillator gains + sub gain + noise gain → pre-filter drive → one 12 dB multimode filter → amp envelope → tremolo gain → stereo pan → source tap.

- [ ] **Step 1: Write a failing graph-construction test.**

```ts
const voice = createSubtractiveVoice(ctx, SUBTRACTIVE_INIT.patch, event, destinations);
expect(ctx.oscillators).toHaveLength(3); // OSC 1, OSC 2, sub
expect(voice.nodes.oscillatorGains).toHaveLength(2);
expect(voice.nodes.filter.type).toBe('lowpass');
expect(voice.owner).toBe('live');
```

Assert disabled sources create no source node, enabled noise uses the selected cached buffer, output gain includes velocity and `outputGainDb`, unison one is center-panned, and every created source has a scheduled stop/teardown path.

- [ ] **Step 2: Write the failing down-sweep acceptance test.**

Create a sine-only patch with ENV2 route `{ target: 'pitch-all', amountSemitones: 48 }`, zero attack, one-second decay, and zero sustain. Assert both main oscillator detune logs start at +4800 cents and ramp to zero one second later while ENV1 schedules amplitude independently.

- [ ] **Step 3: Run the test and confirm the missing graph fails.**

Run: `bun test src/audio/synth/subtractiveVoice.test.ts`
Expected: FAIL because `subtractiveVoice.ts` does not exist.

- [ ] **Step 4: Implement the graph and target router.**

Connect ENV2's zero-to-one contour through target-specific conversion. Apply cutoff routes in semitone ratio space, clamp the final base/routed cutoff below Nyquist, and multiply amplitude modulation on a separate gain so it never overwrites ENV1 automation. Implement drive with a deterministic `WaveShaperNode` curve and unity behavior at 0 dB.

- [ ] **Step 5: Run focused tests and commit.**

Run: `bun test src/audio/synth/subtractiveVoice.test.ts src/audio/synth/modulation.test.ts`
Expected: PASS.

```bash
git add src/audio/synth/subtractiveVoice.ts src/audio/synth/subtractiveVoice.test.ts src/audio/synth/driveCurve.ts src/audio/synth/modulation.ts src/audio/engineTestHelpers.ts
git commit -m "feat(audio): build subtractive synth voices"
```

### Task 5: Note- and transport-triggered LFO

**Files:**
- Create: `src/audio/synth/synthLfo.ts`
- Create: `src/audio/synth/synthLfo.test.ts`
- Modify: `src/audio/synth/subtractiveVoice.ts`
- Modify: `src/audio/synth/subtractiveVoice.test.ts`
- Modify: `src/audio/clock.ts`
- Modify: `src/audio/clock.test.ts`

**Interfaces:**
- Produces `SynthLfoBank`, keyed by synth source, with `setTransportOrigin(time)`, `connectVoice(voice, params, time)`, `updateSource(source, previous, next, time)`, and `disconnectVoice(voice)`.
- Produces `phasePeriodicWave(ctx, waveform, phaseDegrees)` and deterministic sample-and-hold sources.
- `Clock` publishes the exact transport origin/reset time to `AudioEngine`, which forwards it to `SynthLfoBank`.

- [ ] **Step 1: Write failing tests for BPM conversion, phase, and trigger ownership.**

```ts
bank.setTransportOrigin(4);
bank.connectVoice(voiceA, transportLfo, 5);
bank.connectVoice(voiceB, transportLfo, 5.5);
expect(voiceA.lfoSource).toBe(voiceB.lfoSource);

bank.connectVoice(voiceC, noteLfo, 6);
bank.connectVoice(voiceD, noteLfo, 6.2);
expect(voiceC.lfoSource).not.toBe(voiceD.lfoSource);
```

Assert 1/8 at 120 BPM equals 4 Hz for one full waveform cycle per division, dotted and triplet ratios are exact, Note trigger honors phase degrees, Transport trigger retains common phase across late notes, and an updated BPM changes only sync-mode rate.

- [ ] **Step 2: Add failing sample-and-hold tests.**

Use injected random values and assert each held plateau lasts one LFO period, transport voices share the same sequence/position, and note-triggered voices restart at their own first value.

- [ ] **Step 3: Run focused tests and confirm failures.**

Run: `bun test src/audio/synth/synthLfo.test.ts src/audio/clock.test.ts`
Expected: FAIL on missing `SynthLfoBank` and transport-origin notification.

- [ ] **Step 4: Implement shared and per-voice LFO paths.**

Use one persistent transport source per synth channel and waveform/rate configuration. Use a phase-adjusted `PeriodicWave` for note-triggered periodic shapes. Use a looping step buffer for sample-and-hold. Reconnect destination `AudioParam`s without rebuilding audible oscillators when a route target changes.

- [ ] **Step 5: Run focused tests and commit.**

Run: `bun test src/audio/synth/synthLfo.test.ts src/audio/synth/subtractiveVoice.test.ts src/audio/clock.test.ts`
Expected: PASS.

```bash
git add src/audio/synth/synthLfo.ts src/audio/synth/synthLfo.test.ts src/audio/synth/subtractiveVoice.ts src/audio/synth/subtractiveVoice.test.ts src/audio/clock.ts src/audio/clock.test.ts
git commit -m "feat(audio): add transport-synced synth LFO"
```

### Task 6: Owner-safe SynthVoiceManager and automatic Mono legato

**Files:**
- Create: `src/audio/synth/voiceManager.ts`
- Create: `src/audio/synth/voiceManager.test.ts`
- Create: `src/audio/synth/voiceId.ts`
- Modify: `src/audio/synth/subtractiveVoice.ts`
- Modify: `src/audio/voiceOwner.ts`

**Interfaces:**
- Produces `VoiceId` as an opaque string and `SynthVoiceManager.noteOn(input): VoiceId | null`, `noteOff(voiceId, at, releaseSeconds)`, `releaseOwner(source, owner, at)`, `stopSource(source, at)`, `updatePatch(source, previous, next, at)`, and `liveVoiceCount()`.
- A note-on input contains source, owner, note name, velocity, audio time, scale factor, and complete `ActiveSynth`.
- Mono stacks entries by voice ID, note, and owner; Poly tracks every physical voice under its logical voice ID.

- [ ] **Step 1: Write failing same-note ownership tests.**

```ts
const live = manager.noteOn(event({ owner: 'live', noteName: 'C4' }));
const arp = manager.noteOn(event({ owner: 'arp', noteName: 'C4' }));
manager.noteOff(arp!, 2, .1);
expect(manager.has(live!)).toBe(true);
expect(manager.has(arp!)).toBe(false);
```

Cover same owner/same note retriggers, scheduled future voices, owner-scoped cleanup, whole-source stop, and teardown removing only the exact voice ID.

- [ ] **Step 2: Write failing Mono stack tests.**

Assert C4 starts envelopes, overlapping E4 reuses the voice and glides without retriggering, releasing E4 returns to held C4, glide zero jumps immediately, and releasing C4 releases the voice. Repeat with two owners to prove one owner's key-up cannot remove the other's stack entry.

- [ ] **Step 3: Write failing Poly/unison budget tests.**

Assert Poly creates independent logical voices, unison gains preserve equal power, released voices steal before held voices, future-scheduled voices are ineligible, and oldest eligible held voice is the final fallback.

- [ ] **Step 4: Run the manager test and confirm the missing implementation fails.**

Run: `bun test src/audio/synth/voiceManager.test.ts`
Expected: FAIL because `voiceManager.ts` does not exist.

- [ ] **Step 5: Implement manager maps, stacks, stealing, and lifecycle teardown.**

Keep all high-frequency voice state inside audio classes. Do not publish held notes or current modulation phase to Zustand. Inject the voice factory in tests; production supplies `createSubtractiveVoice` through the engine registry switch.

- [ ] **Step 6: Run focused tests and commit.**

Run: `bun test src/audio/synth/voiceManager.test.ts src/audio/synth/subtractiveVoice.test.ts`
Expected: PASS.

```bash
git add src/audio/synth/voiceManager.ts src/audio/synth/voiceManager.test.ts src/audio/synth/voiceId.ts src/audio/synth/subtractiveVoice.ts src/audio/voiceOwner.ts
git commit -m "fix(audio): isolate synth voices by owner"
```

### Task 7: AudioEngine and playback cutover

**Files:**
- Modify: `src/audio/engine.ts`
- Modify: `src/audio/engine.test.ts`
- Modify: `src/audio/engine.render.test.ts`
- Modify: `src/audio/playback/synthPlayback.ts`
- Modify: `src/audio/playback/synthPlayback.test.ts`
- Modify: `src/audio/playback/playbackEngine.ts`
- Modify: `src/audio/playback/playbackEngine.test.ts`
- Modify: `src/audio/playback/padPlayback.ts`
- Modify: `src/audio/playback/padPlayback.test.ts`
- Modify: `src/audio/playback/arpPlayback.ts`
- Modify: `src/audio/playback/arpPlayback.test.ts`
- Modify: `src/audio/playback/presetPreview.ts`
- Modify: `src/audio/playback/presetPreview.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts`
- Modify: `src/audio/playback/chordPlayback.test.ts`
- Modify: `src/audio/testFakes.ts`
- Modify: `src/audio/engineTestHelpers.ts`
- Modify: `src/components/useInputDeck.ts`
- Modify: `src/components/useInputDeck.test.tsx`
- Modify: `src/store/midiInput.ts`
- Modify: `src/store/midiInput.test.ts`

**Interfaces:**
- `AudioEngine.triggerSynthNoteOn(...)` accepts `ActiveSynth` and returns `VoiceId | null`.
- `AudioEngine.triggerSynthNoteOff(voiceId, releaseSeconds, time?)` releases exactly that logical voice.
- Playback bridges retain returned IDs until release; bulk cleanup remains owner- or source-scoped through explicit methods.
- `AudioEngine.updateSynthPatch(activeSynth, source)` delegates continuous changes to `SynthVoiceManager`.
- `src/audio/playback/playbackEngine.ts` is the shared sequencer bridge and the only file outside the engine that calls `triggerSynthNoteOn`/`triggerSynthNoteOff` for the pad, lead, and FX paths — `padPlayback.ts` routes through it rather than calling the engine itself. It must hold voice IDs per scheduled hit, so it is a required part of this cutover, not a follow-up.

- [ ] **Step 1: Update bridge tests to require voice-ID round trips.**

```ts
const id = engine.triggerSynthNoteOn('C4', activeSynth, 1, 2, 'synth', 1, 'live');
expect(id).toBeTruthy();
engine.triggerSynthNoteOff(id!, .2, 3);
expect(fakeManager.noteOff).toHaveBeenCalledWith(id, 3, .2);
```

Assert live keyboard, MIDI, preset preview, sequencer, chord player, and Arp each retain/release their own IDs and their existing bus-capture behavior survives a Focus change.

- [ ] **Step 2: Run focused tests and confirm signature failures.**

Run: `bun test src/audio/engine.test.ts src/audio/playback/synthPlayback.test.ts src/audio/playback/presetPreview.test.ts src/components/useInputDeck.test.tsx src/store/midiInput.test.ts`
Expected: FAIL because the old APIs release by note name.

- [ ] **Step 3: Bind `SynthVoiceManager` inside `AudioEngine` and update every bridge.**

Return null before context initialization as the old setter/no-op contract requires. Preserve scheduled audio times, source capture at note-on, owner-specific cleanup, idle wake/suspend accounting, and offline context binding.

Leave `setPresetTrim` in place for now. Its only remaining caller is `scripts/calibration/renderOffline.ts`, which Task 12 cuts over to `common.outputGainDb`; removing the method here would break the calibration scripts in an intermediate commit for no gain. Task 12 deletes the method, `src/audio/trims.ts`'s `synthTrimGainFor`, and that call site together.

- [ ] **Step 4: Run all audio and bridge tests.**

Run: `bun test src/audio src/components/useInputDeck.test.tsx src/components/useSequencerPlayback.test.ts src/store/midiInput.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts src/audio/engine.render.test.ts src/audio/playback src/audio/testFakes.ts src/audio/engineTestHelpers.ts src/components/useInputDeck.ts src/components/useInputDeck.test.tsx src/store/midiInput.ts src/store/midiInput.test.ts
git commit -m "refactor(audio): route playback through voice IDs"
```

### Task 8: Store, project, Arp, and engine synchronization cutover

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/synthSlice.ts`
- Modify: `src/store/initialState.ts`
- Modify: `src/store/loop.ts`
- Modify: `src/store/loopSlice.ts`
- Modify: `src/store/sanitize.ts`
- Modify: `src/store/projectFormat.ts`
- Modify: `src/store/projectFile.ts`
- Modify: `src/store/sourceBuses.ts`
- Modify: `src/store/melodyTracks.ts`
- Modify: `src/store/engineSync.ts`
- Modify: `src/utils/synthControl.ts`
- Modify: `src/store/mixdownSlice.ts`
- Modify: `src/audio/leadMelody.ts`
- Modify: `src/audio/testFakes.ts`
- Modify: `src/components/loop/lead/useLeadPlayback.ts`
- Modify: `src/components/loop/chord/useChordPlayback.ts`
- Test: `src/audio/leadMelody.test.ts`
- Test: `src/components/loop/lead/useLeadPlayback.test.ts`
- Test: `src/components/loop/chord/useChordPlayback.test.ts`
- Test: `src/store/sanitize.test.ts`
- Test: `src/store/store.test.ts`
- Test: `src/store/loopSlice.test.ts`
- Test: `src/store/projectFile.test.ts`
- Test: `src/store/projectFormat.test.ts`
- Test: `src/store/engineSync.test.ts`
- Test: `src/utils/synthControl.test.ts`

**Interfaces:**
- Existing per-track fields `synthParams`, `chordSynthParams`, `bassSynthParams`, `padSynthParams`, and `fxSynthParams` retain their names but change value type to `ActiveSynth`; this minimizes unrelated loop/copy churn.
- Adds parallel `synthArpSettings`, `chordArpSettings`, `bassArpSettings`, `padArpSettings`, and `fxArpSettings` fields of type `ArpSettings`.
- `SynthParamChannel` becomes `SynthChannel` with `{ activeSynth, arpSettings, setActiveSynth, setArpSettings }`.
- `engineSync` sends only `ActiveSynth` changes to `audioEngine.updateSynthPatch`; Arp state is consumed by Arp playback, not DSP synchronization.
- Four consumers read the arp flags directly off the patch today and move to the new `*ArpSettings` field in this same atomic change: `useLeadPlayback.ts` gates `leadScheduleHits` on `params.arpActive`, `useChordPlayback.ts` derives `chordArp`/`bassArp` from `chordSynthParams`/`bassSynthParams`, `leadMelody.ts` takes `arpActive` as a parameter, and `testFakes.ts` carries the four fields in its fixture. They are part of the cutover, not of Task 13's cleanup sweep — the store will not type-check without them.

- [ ] **Step 1: Change store/project tests to assert complete active synths and separate Arp defaults.**

```ts
expect(createDefaultLoop()).toMatchObject({
  synthParams: TRACK_SYNTH_DEFAULTS.synth,
  synthArpSettings: TRACK_ARP_DEFAULTS.synth,
});
expect(createDefaultLoop().synthParams.patch).not.toHaveProperty('arpActive');
```

Assert all five targets survive loop save/load, copy groups continue carrying the sound for their target, custom Arp state stays independent, and changing only Arp does not call `updateSynthPatch`.

- [ ] **Step 2: Add failing sanitization/import tests.**

Assert a complete valid patch survives, out-of-range finite values clamp, a flat legacy `SynthParams` object falls back to the target's complete default, an unknown engine emits a project warning, and one invalid track patch does not replace valid sibling tracks.

- [ ] **Step 3: Run the focused store suite and confirm shape failures.**

Run: `bun test src/store/sanitize.test.ts src/store/store.test.ts src/store/loopSlice.test.ts src/store/projectFile.test.ts src/store/projectFormat.test.ts src/store/engineSync.test.ts src/utils/synthControl.test.ts`
Expected: FAIL because loop/store fields still contain flat `SynthParams` and Arp is embedded.

- [ ] **Step 4: Cut all five fields and channel tables over in one atomic change.**

Delegate validation to `sanitizeActiveSynth`/`sanitizeArpSettings`; do not duplicate engine enum checks in `sanitize.ts`. Keep the persisted version and `.solna` format version unchanged. Extend project warning assembly with target-specific messages. Update snapshot building so offline render receives active synths and separate Arp settings.

- [ ] **Step 5: Update engine sync and run focused tests.**

Run: `bun test src/store src/utils/synthControl.test.ts src/audio/leadMelody.test.ts src/components/loop/lead/useLeadPlayback.test.ts src/components/loop/chord/useChordPlayback.test.ts`
Expected: PASS.

- [ ] **Step 6: Run type-check and commit.**

Run: `bun run lint`
Expected: PASS.

```bash
git add src/store/types.ts src/store/synthSlice.ts src/store/initialState.ts src/store/loop.ts src/store/loopSlice.ts src/store/sanitize.ts src/store/projectFormat.ts src/store/projectFile.ts src/store/sourceBuses.ts src/store/melodyTracks.ts src/store/engineSync.ts src/store/mixdownSlice.ts src/store/sanitize.test.ts src/store/store.test.ts src/store/loopSlice.test.ts src/store/projectFile.test.ts src/store/projectFormat.test.ts src/store/engineSync.test.ts src/store/mixdownSlice.test.ts src/utils/synthControl.ts src/utils/synthControl.test.ts src/audio/leadMelody.ts src/audio/leadMelody.test.ts src/audio/testFakes.ts src/components/loop/lead/useLeadPlayback.ts src/components/loop/lead/useLeadPlayback.test.ts src/components/loop/chord/useChordPlayback.ts src/components/loop/chord/useChordPlayback.test.ts
git commit -m "refactor(store): install engine-discriminated synth patches"
```

### Task 9: Approved Subtractive Pro interface

**Files:**
- Create: `src/components/loop/synth/SubtractiveProPanel.tsx`
- Modify: `src/components/loop/synth/OscillatorPanel.tsx`
- Modify: `src/components/loop/synth/FilterPanel.tsx`
- Modify: `src/components/loop/synth/EnvelopePanel.tsx`
- Modify: `src/components/loop/synth/LfoPanel.tsx`
- Modify: `src/components/loop/synth/ArpeggiatorPanel.tsx`
- Create: `src/components/loop/synth/UtilitySourcePanel.tsx`
- Create: `src/components/loop/synth/VoicePanel.tsx`
- Create: `src/components/loop/synth/WaveformIcon.tsx`
- Create: `src/components/loop/synth/FilterTypeIcon.tsx`
- Modify: `src/components/loop/SoundSynthSection.tsx`
- Modify: `src/components/loop/synth/useSynthChannel.ts`
- Modify: `src/components/loop/synth/synthPanels.test.tsx`
- Modify: `src/components/loop/SoundView.test.tsx`
- Modify (only if a new module identity is introduced): `src/index.css`, `src/components/ui/Knob.tsx`, `src/components/ui/Knob.test.tsx`

**Interfaces:**
- `SubtractiveProPanel` consumes one `SynthChannel`; it writes complete immutable patches and separate focused Arp settings.
- Waveform and filter-type buttons use SVG icons with accessible full names and selected state.
- The layout and responsive grouping match approved prototype Variant A, with one recorded departure: the Voice module is Mono/Poly, Unison (count), Spread (`common.unisonDetuneCents`), Glide, and Width (`common.stereoWidth`). The prototype's Drift knob is deliberately NOT built — `CommonVoiceParams` has no analog-drift parameter, and adding one is its own spec, not a side effect of this change. Width takes the slot Drift occupied, which is what gives Simple's Width control a canonical Pro parameter to be a lossless view of.
- The Utility (OSC 3), Voice, and modulation-route groups need a module colour identity. Reuse an existing `--module-*` token where the meaning genuinely matches; only introduce a new one if none does. A new token is four coordinated edits — the fill and its `-content` ink in BOTH theme blocks of `src/index.css`, plus `KNOB_COLORS` and `BADGE_COLOR` in `Knob.tsx` — and `bun run check:contrast` fails outright if a module is declared in one theme only.

- [ ] **Step 1: Write failing render tests for every approved module and route slot.**

```tsx
const html = renderToString(<SubtractiveProPanel channel={channel} />);
expect(html).toContain('Oscillators');
expect(html).toContain('OSC 3 / Utility');
expect(html).toContain('ENV 1');
expect(html).toContain('ENV 2');
expect(html).toContain('Arpeggiator');
```

Assert ENV1 destination is read-only Amplitude; ENV2 renders exactly two target/amount rows; LFO renders Hz/Sync, Transport/Note, waveform, phase, depth, and one route; Voice renders only Mono/Poly plus unison, spread, glide, and width controls, and renders NO drift control; Arp writes the separate `ArpSettings` object.

- [ ] **Step 2: Add failing icon/accessibility tests.**

Assert Saw, Square, Triangle, Sine, LP, BP, HP, and Notch are exposed by `aria-label`, selected buttons carry `aria-pressed="true"`, noise type does not use an overflowing segmented row, and every knob has a unique label/id.

- [ ] **Step 3: Run component tests and confirm failures.**

Run: `bun test src/components/loop/synth/synthPanels.test.tsx src/components/loop/SoundView.test.tsx`
Expected: FAIL because the approved composition and new controls are absent.

- [ ] **Step 4: Reconstruct Variant A with production components.**

Keep the existing Focus/preset shell and theme tokens. Compose the desktop signal-flow layout, distinct OSC 1/2 inset panels, utility sub/noise split, filter icons, two knob-based ADSRs, modulation row, Voice (Mono/Poly, Unison, Spread, Glide, Width — no Drift), and Arp. At the existing responsive breakpoints, use two columns at tablet width and one module column on narrow screens without page-level horizontal overflow.

- [ ] **Step 5: Run component tests, contrast checks, and type-check.**

Run: `bun test src/components/loop/synth/synthPanels.test.tsx src/components/loop/SoundView.test.tsx && bun run check:contrast && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/components/loop/SoundSynthSection.tsx src/components/loop/SoundView.test.tsx src/components/loop/synth src/index.css src/components/ui/Knob.tsx src/components/ui/Knob.test.tsx
git commit -m "feat(ui): build subtractive Pro synth panel"
```

### Task 10: Approved Simple projection

**Files:**
- Create: `src/utils/subtractiveSimple.ts`
- Create: `src/utils/subtractiveSimple.test.ts`
- Modify: `src/components/loop/SimpleSynthPanel.tsx`
- Modify: `src/components/loop/SimpleSynthPanel.test.tsx`
- Modify: `src/components/loop/SoundSynthSection.tsx`

**Interfaces:**
- Produces `readSubtractiveSimple(activeSynth): SimpleSynthReadings` and `writeSubtractiveSimple(activeSynth, control, value): ActiveSynth`.
- Simple controls are Shape/OSC balance, Weight/sub level, Brightness/cutoff, Bite/resonance, Attack/amp attack, Tail/amp release, Movement/LFO depth, and Width/`common.stereoWidth`.
- The three spread-ish names are pinned here so they cannot drift apart again: Pro's **Spread** writes `common.unisonDetuneCents`, Pro's **Width** and Simple's **Width** both write `common.stereoWidth`, and Simple has no control over unison detune at all. Every Simple control except Shape therefore has exactly one canonical Pro parameter, which is what "lossless view" means.
- Descriptors derive from canonical values and are not stored.

- [ ] **Step 1: Write failing pure adapter tests.**

```ts
const reading = readSubtractiveSimple(SUBTRACTIVE_INIT);
expect(reading.brightness.value).toBe(SUBTRACTIVE_INIT.patch.synth.filter.cutoffHz);

const changed = writeSubtractiveSimple(SUBTRACTIVE_INIT, 'tail', 1.2);
expect(changed.patch.synth.ampEnvelope.releaseSeconds).toBe(1.2);
expect(changed.patch.synth.modEnvelope).toEqual(SUBTRACTIVE_INIT.patch.synth.modEnvelope);
```

Assert each control changes only its canonical parameter, except Shape's documented two-level equal-power transform. Assert all unrelated patch branches retain reference identity and mode switching performs no write.

- [ ] **Step 2: Write failing UI tests for the locked Variant B hierarchy.**

Assert the four groups Source/Tone/Feel/Motion, eight controls, Current feel summary, Mono/Poly, and compact Arp strip render. Assert Pro-only terms such as Q, cents, ENV2 target, key tracking, and unison detune do not appear.

- [ ] **Step 3: Run focused tests and confirm failures.**

Run: `bun test src/utils/subtractiveSimple.test.ts src/components/loop/SimpleSynthPanel.test.tsx`
Expected: FAIL because the new adapter and approved Simple layout are absent.

- [ ] **Step 4: Implement the adapter and reconstruct Variant B.**

Use one continuous panel with four visually separated groups rather than one card per knob. Use the same module color identities as Pro. Keep value descriptors concise, expose canonical values to assistive labels/tooltips, and stack groups without horizontal overflow below the mobile breakpoint.

- [ ] **Step 5: Run focused tests and type-check.**

Run: `bun test src/utils/subtractiveSimple.test.ts src/components/loop/SimpleSynthPanel.test.tsx src/components/loop/SoundView.test.tsx && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/subtractiveSimple.ts src/utils/subtractiveSimple.test.ts src/components/loop/SimpleSynthPanel.tsx src/components/loop/SimpleSynthPanel.test.tsx src/components/loop/SoundSynthSection.tsx
git commit -m "feat(ui): add lossless Simple synth controls"
```

### Task 11: Complete preset library, custom presets, and Vibes

**Files:**
- Modify: `src/data/synthPresets.ts`
- Modify: `src/data/synthPresets.test.ts`
- Modify: `src/data/vibes.ts`
- Modify: `src/data/vibes.test.ts`
- Delete: `src/data/subtractiveDefaults.ts`
- Create: `src/utils/synthPresets.ts`
- Create: `src/utils/synthPresets.test.ts`
- Modify: `src/audio/presetRegistry.ts`
- Modify: `src/store/presetsSlice.ts`
- Modify: `src/store/initialState.ts`
- Modify: `src/store/vibes.ts`
- Modify: `src/store/vibes.test.ts`
- Modify: `src/store/vibeSynthPresets.test.ts`
- Modify: `src/store/migrate.ts`
- Modify: `src/store/store.ts`
- Modify: `src/components/loop/synth/synthPresetBrowser.ts`
- Modify: `src/components/loop/SynthPresetLibrary.tsx`
- Modify: `src/components/loop/SynthPresetLibrary.test.tsx`

**Interfaces:**
- `SYNTH_PRESETS` becomes complete `SynthPreset<'subtractive'>[]`; every entry includes engine, complete patch, controlled tags, description, and output gain dB.
- Produces `presetById`, `getAllSynthPresets`, `groupPresets`, and `applySynthPreset(currentArp, preset): { activeSynth; arpSettings }` from `@/utils/synthPresets`.
- `initialState.ts` exports `SUBTRACTIVE_INIT_PRESET_ID`, `TRACK_SYNTH_PRESET_IDS`, and resolved `SUBTRACTIVE_INIT`/`TRACK_SYNTH_DEFAULTS`; existing downstream fixture imports keep those resolved object names after the temporary data file is removed.
- Applying a synth preset replaces the complete patch and preserves the passed Arp object. Applying a Vibe resolves synth presets and Arp settings independently.
- Custom-preset save/import/export uses the same complete discriminated shape; invalid legacy custom entries are dropped by persisted-state sanitization.

- [ ] **Step 1: Rewrite data tests before the table.**

Assert all preset IDs are unique, all factory entries are complete, engine matches patch, tags belong to the controlled set, no Arp/effect keys exist, and each category has at least one preset. Add explicit assertions that Init, Lead, Bass, Pad, and the four required FX techniques are present.

```ts
for (const preset of SYNTH_PRESETS) {
  expect(sanitizeActiveSynth({
    engine: preset.engine,
    patch: preset.patch,
    sourcePresetId: preset.id,
  }, SUBTRACTIVE_INIT).issues).toEqual([]);
}
```

- [ ] **Step 2: Add failing application and Vibe tests.**

Assert selecting a preset replaces every old patch field, installs the preset's engine discriminator rather than retaining the current value, preserves current Arp/effects, and records `sourcePresetId`. Assert each Vibe resolves every referenced preset, writes explicit Arp settings, and preserves its existing progression/pattern/BPM/effect behavior.

- [ ] **Step 3: Run data/store/library tests and confirm failures.**

Run: `bun test src/data/synthPresets.test.ts src/data/vibes.test.ts src/utils/synthPresets.test.ts src/store/vibes.test.ts src/store/vibeSynthPresets.test.ts src/components/loop/SynthPresetLibrary.test.tsx`
Expected: FAIL because presets are partial and Vibes do not own separate Arp settings.

- [ ] **Step 4: Re-author the complete factory table.**

Translate recognizable existing sounds into the two-oscillator topology, then deliberately author OSC 2, utility source, routing, LFO trigger, voice, and output gain for every entry. Do not spread a shared runtime default into data entries. Add down-sweep, up-sweep, noise-riser, and zap patches whose routes match the approved acceptance definitions.

Fold Task 2's temporary init/track literals into named complete factory presets, update `initialState.ts` to resolve explicit preset IDs, then delete `src/data/subtractiveDefaults.ts`. The final tree must not keep duplicate default patch bodies.

- [ ] **Step 5: Move preset resolution to utils and update custom preset persistence.**

Make `src/audio/presetRegistry.ts` a temporary re-export so untouched imports remain green inside this task; Task 13 removes it after an import search. Sanitize custom presets on persisted read, and make Save capture the current engine and complete patch without Arp/effects.

- [ ] **Step 6: Update Vibe data and application.**

Write each Vibe's chosen Arp values as literal data. Apply all preset/Arp/effect changes in the existing stopped atomic swap, then restart the previously active scope. A missing preset ID uses the explicit target default in runtime code and remains a failing data test.

- [ ] **Step 7: Run focused tests, data purity, and type-check.**

Run: `bun test src/data/synthPresets.test.ts src/data/vibes.test.ts src/data/dataLayerPurity.test.ts src/utils/synthPresets.test.ts src/store/vibes.test.ts src/store/vibeSynthPresets.test.ts src/components/loop/SynthPresetLibrary.test.tsx src/store/store.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/data/synthPresets.ts src/data/synthPresets.test.ts src/data/vibes.ts src/data/vibes.test.ts src/data/subtractiveDefaults.ts src/utils/synthPresets.ts src/utils/synthPresets.test.ts src/audio/presetRegistry.ts src/store/presetsSlice.ts src/store/initialState.ts src/store/vibes.ts src/store/vibes.test.ts src/store/vibeSynthPresets.test.ts src/store/migrate.ts src/store/store.ts src/components/loop/synth/synthPresetBrowser.ts src/components/loop/SynthPresetLibrary.tsx src/components/loop/SynthPresetLibrary.test.tsx
git commit -m "feat(presets): author complete subtractive patches"
```

### Task 12: Offline parity, signal assertions, and calibration

**Files:**
- Modify: `src/audio/export/renderMixdown.ts`
- Modify: `src/audio/export/mixdownFixture.ts`
- Modify: `src/audio/engine.render.test.ts`
- Create: `src/audio/synth/subtractiveSignal.test.ts`
- Modify: `src/data/trimTable.ts`
- Modify: `scripts/calibration/loudnessConfig.ts`
- Modify: `scripts/calibration/levelChecks.ts`
- Modify: `scripts/calibration/generateTrimTable.ts`
- Modify: `scripts/calibration/renderOffline.ts`
- Modify: `scripts/calibration/renderOffline.smoke.ts`
- Modify: `scripts/calibration/verifyApplied.smoke.ts`
- Modify: `scripts/calibration/trimTable.lock.test.ts`
- Modify: `scripts/calibration/loudnessConfig.test.ts`
- Modify: `scripts/check-levels.ts`
- Modify: `src/audio/trims.ts`
- Modify: `src/audio/trims.test.ts`
- Modify: `src/audio/engine.ts`

**Interfaces:**
- Offline snapshots carry `ActiveSynth` and separate Arp settings for every melodic target.
- `renderMixdown` calls the same `AudioEngine`/`SynthVoiceManager` public API as realtime playback.
- Committed synth calibration records measurement/hash provenance; applied gain comes from `patch.common.outputGainDb`, not a preset-ID lookup.
- `src/audio/trims.ts` loses `synthTrimGainFor` but KEEPS `drumTrimGainFor` and `NEUTRAL_TRIM_GAIN` — drum kits are still calibrated by name and that half of the table is unchanged. `src/audio/trims.test.ts` drops its `synthTrimGainFor` describe block for the same reason.
- `AudioEngine.setPresetTrim` is deleted here, together with its one remaining caller at `scripts/calibration/renderOffline.ts` (Task 7 deliberately left both standing so no intermediate commit broke the calibration scripts).
- `scripts/calibration/trimTable.lock.test.ts` locks the committed preset roster and will fail the moment Task 11 re-authors the table; it is regenerated, not exempted.

- [ ] **Step 1: Change mixdown tests to consume complete active synths.**

Assert all five sources schedule the engine-discriminated patch, Arp uses its separate settings, cancellation remains prompt, and an offline render never touches the singleton `audioEngine`.

- [ ] **Step 2: Add failing offline signal assertions.**

Render short deterministic fixtures and inspect windows with the existing analyser helpers. Assert the down-sweep's dominant frequency decreases across at least three windows; up-sweep increases; LP/BP/HP/Notch produce distinct band-energy orderings; pink has less high-band energy than white; brown has less than pink; and a wide unison patch has greater side-channel energy than its mono equivalent without exceeding the peak ceiling.

- [ ] **Step 3: Run render/signal tests and confirm old snapshot failures.**

Run: `bun test src/audio/engine.render.test.ts src/audio/synth/subtractiveSignal.test.ts src/store/mixdownSlice.test.ts`
Expected: FAIL because offline scheduling still expects flat params and calibration still uses preset-ID trims.

- [ ] **Step 4: Cut offline rendering over to the shared engine path.**

Do not duplicate oscillator, envelope, LFO, or routing math in `renderMixdown.ts`. Keep deterministic test randomness injectable while production noise/sample-and-hold may use the engine's random source.

- [ ] **Step 5: Move applied synth trim into complete patches.**

Remove the runtime preset-trim lookup: delete `synthTrimGainFor` from `src/audio/trims.ts`, `setPresetTrim` from `src/audio/engine.ts`, and the `setPresetTrim` call from `scripts/calibration/renderOffline.ts` — which now renders a preset by installing its complete patch, with `common.outputGainDb` either at its authored value or neutralised for the uncalibrated measurement pass. Keep `drumTrimGainFor` and the drum half of `trimTable.ts` untouched. Keep committed measurements and config hashes sufficient for `check:levels` to detect missing, orphaned, drifted, and out-of-tolerance presets. Change the tolerance check to combine measured dBFS with each live preset's `common.outputGainDb`.

- [ ] **Step 6: Regenerate and verify calibration.**

Run: `bun run calibration:generate`
Expected: rewrites committed preset measurements/hashes for every new complete preset.

Run: `bun run calibration:smoke && bun run calibration:verify && bun run check:levels`
Expected: PASS with every preset present, in tolerance, and audibly applying its embedded output gain.

- [ ] **Step 7: Run audio/export tests and commit.**

Run: `bun test src/audio src/store/mixdownSlice.test.ts scripts/calibration`
Expected: PASS.

```bash
git add src/audio/export src/audio/engine.ts src/audio/engine.render.test.ts src/audio/synth/subtractiveSignal.test.ts src/audio/trims.ts src/audio/trims.test.ts src/data/trimTable.ts scripts/calibration scripts/check-levels.ts
git commit -m "test(audio): calibrate subtractive presets"
```

### Task 13: Remove legacy synth path, document invariants, and verify

**Files:**
- Delete: `src/audio/synthVoices.ts`
- Delete: `src/audio/synthVoices.test.ts`
- Delete: `src/audio/presetRegistry.ts`
- Modify: `src/types.ts`
- Modify: `CLAUDE.md`
- Modify: `src/audio/engineTestHelpers.ts`
- Modify: `src/audio/engine.test.ts`
- Modify: `src/audio/engine.render.test.ts`
- Modify: `src/store/engineSync.test.ts`
- Modify: `src/components/loop/synth/synthPanels.test.tsx`

**Interfaces:**
- No production import names legacy `SynthParams`, `SynthVoices`, `applyPreset(base, preset)`, `setPresetTrim`, or embedded Arp fields.
- `CLAUDE.md` records the engine discriminator, complete-preset rule, separate Arp ownership, canonical units, and shared realtime/offline engine boundary.

- [ ] **Step 1: Search for legacy contracts and make the test fail on any remaining production use.**

Run:

```bash
rg -n "SynthParams|SynthVoices|setPresetTrim|synthTrimGainFor|arpActive|arpMode|arpRate|arpOctaves" src scripts --glob '!**/*.test.*'
rg -n "@/audio/presetRegistry|audio/presetRegistry" src scripts
```

Expected: remaining hits identify only files that still require cutover; after cleanup both searches return no old production contract. The first search covers `scripts/` too, because the calibration path — not just `src/` — carried `setPresetTrim` and `synthTrimGainFor`. New separate Arp fields may contain `Arp` in their names but not the deleted embedded field names; `drumTrimGainFor` survives and is expected to have no hits under these patterns.

- [ ] **Step 2: Delete compatibility modules and update architecture documentation.**

Remove the old voice implementation and preset-registry re-export only after the searches show no consumers. Remove the legacy type from `src/types.ts`. Update `CLAUDE.md` with rules rather than counts or version numbers.

- [ ] **Step 3: Run targeted regression suites.**

Run: `bun test src/audio src/store src/components/loop/SimpleSynthPanel.test.tsx src/components/loop/SynthPresetLibrary.test.tsx src/components/loop/SoundView.test.tsx src/components/loop/synth/synthPanels.test.tsx src/utils/synthPatch.test.ts src/utils/subtractiveSimple.test.ts`
Expected: PASS.

- [ ] **Step 4: Visually compare production UI to the approved artifact.**

Run: `bun run dev`

Open the Sound tab at desktop, 900×900, and 390×844. Compare Pro to artifact Variant A and Simple to Variant B. Verify distinct OSC 1/2 grouping, no Noise Type overflow, waveform/filter icons, two ENV2 routes, visible Arp, balanced desktop density, single-column mobile modules, and `document.documentElement.scrollWidth === document.documentElement.clientWidth` at both responsive widths. One difference from Variant A is intended and must NOT be "fixed" here: the Voice module shows Width where the prototype shows Drift (see Task 9). Stop the dev server after inspection.

- [ ] **Step 5: Run the repository completion gate.**

Run: `bun run verify`
Expected: all tests, type-check, ESLint, key/drum/contrast/level guards, and production build pass with no ESLint output.

- [ ] **Step 6: Review the final diff and commit.**

Run: `git diff --check && git status --short`
Expected: no whitespace errors and only intended synth/preset/UI/docs changes.

```bash
git add src/audio/synthVoices.ts src/audio/synthVoices.test.ts src/audio/presetRegistry.ts src/audio/engineTestHelpers.ts src/audio/engine.test.ts src/audio/engine.render.test.ts src/store/engineSync.test.ts src/components/loop/synth/synthPanels.test.tsx src/types.ts CLAUDE.md
git commit -m "refactor(synth): remove legacy flat engine"
```
