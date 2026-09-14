# Extensible Synth Engine and Presets Design

**Status:** Approved design

## Context

Solna currently stores one flat `SynthParams` object and renders it through a fixed Web Audio subtractive voice. That voice has one main oscillator, one fixed sine sub oscillator, noise, a filter envelope hard-wired to cutoff, and a per-voice LFO with one of three targets. The approved Synth Lab UI now describes a deeper instrument: two independent oscillators, a sub/noise utility source, two envelopes, routable modulation, transport-synced LFO, Mono/Poly voice behavior, and Simple and Pro views over the same patch.

Solna's product character comes from its composition workflow, not a proprietary synthesis character. The synth should therefore use conventional subtractive terminology and canonical units so a musician can transfer settings to or from another standard synth. Factory content will initially lean electronic because Solna synthesizes its sounds rather than using PCM or samples, but neither the patch model nor Vibe model is genre-bound.

## Approved visual source

[`../prototypes/2026-09-14-synth-lab-approved-ui.html`](../prototypes/2026-09-14-synth-lab-approved-ui.html) is the visual implementation reference. Variant A is the locked Subtractive Pro layout and Variant B is the locked Subtractive Simple layout. Variant C remains only as historical exploration and is non-normative. The artifact is static prototype code: production implementation must reconstruct the approved layouts with project components, accessibility, state wiring, and tests rather than promoting the prototype directly.

## Goals

- Implement the approved standard subtractive synth without implementing FM or wavetable synthesis.
- Establish a typed boundary that can add other engine families without optional-field growth in one universal parameter object.
- Keep Simple and Pro as lossless views of one patch, with no persisted Simple macro state.
- Store complete, stable presets in canonical units.
- Keep Arp and effects outside the synth preset.
- Preserve realtime and offline-render behavior through one DSP implementation.
- Make one-shot pitch sweeps, risers, downers, lasers, and zaps first-class acceptance cases.

## Non-goals

- FM or wavetable engine implementations or placeholder controls
- An arbitrary modular graph or unlimited modulation matrix
- Filter self-oscillation, custom ladder filters, or selectable filter slope
- User-editable envelope curves
- Arp or effect-chain state inside synth presets
- A compatibility migration chain for the old flat `SynthParams` shape
- An analog pitch-drift parameter. The approved prototype's Voice module draws a Drift knob; `CommonVoiceParams` has no parameter behind it and this change does not add one. The Pro Voice module builds Mono/Poly, Unison, Spread, Glide, and Width instead, so every control on screen writes a real canonical parameter.

## Domain model

The store holds a discriminated active synth per melodic track. Engine-specific parameters are isolated from settings that apply to a complete voice regardless of synthesis method.

```ts
type SynthEngineId = 'subtractive';

interface EnginePatchMap {
  subtractive: SubtractiveParams;
}

interface EnginePatch<E extends SynthEngineId> {
  common: CommonVoiceParams;
  synth: EnginePatchMap[E];
}

interface ActiveSynth<E extends SynthEngineId = SynthEngineId> {
  engine: E;
  patch: EnginePatch<E>;
  sourcePresetId: string | null;
}

interface SynthPreset<E extends SynthEngineId = SynthEngineId> {
  id: string;
  name: string;
  category: SoundCategory;
  engine: E;
  patch: EnginePatch<E>;
  tags: SynthTag[];
  description: string;
  isFactory: boolean;
}
```

`sourcePresetId` is display provenance, not a DSP input. Patch output calibration moves from a preset-ID lookup into `CommonVoiceParams.outputGainDb`, so a saved or edited patch remains self-contained.

`CommonVoiceParams` contains Mono/Poly mode, glide seconds, unison voice count, unison detune cents, stereo width, velocity-to-amplitude, and output gain dB. The two width-like controls are named once and never again: Pro's **Spread** is `unisonDetuneCents` and both Pro's and Simple's **Width** are `stereoWidth`. Arp is a separate performance-layer object. A Vibe continues to reference preset IDs and separately selects Arp settings, effect chain, BPM, chord progression/rhythm, bass pattern, and drum grid.

When another engine ships, it adds one `EnginePatchMap` member, DSP implementation, validator, Pro panel, and Simple adapter. No empty FM types or runtime registry entries land in this change.

## Subtractive patch contract

```ts
interface SubtractiveParams {
  oscillators: [OscillatorParams, OscillatorParams];
  utility: UtilitySourceParams;
  filter: FilterParams;
  ampEnvelope: AdsrParams;
  modEnvelope: AdsrParams;
  env2Routes: ModRoute[];
  lfo: LfoParams;
}
```

Both oscillators have enabled state, waveform, octave, semitone, fine cents, and level dB. Waveforms are sawtooth, square, triangle, and sine. The utility source has a fixed sine sub at octave -1 or -2 and a level dB, plus white, pink, or brown noise and its level dB. Enabled state represents silence; the model does not use negative infinity as stored state.

The filter supports lowpass, bandpass, highpass, and notch; cutoff Hz; resonance as a unitless 0..1 synth control; pre-filter drive dB; and key tracking 0..1. The v1 implementation is the 12 dB/octave `BiquadFilterNode`. The adapter maps resonance to the browser-specific Q semantics and clamps cutoff to the usable range below Nyquist.

Both envelopes use attack, decay, and release seconds plus sustain 0..1. ENV1 is permanently connected to amplitude. ENV2 exposes exactly two route slots. The LFO exposes one route slot, waveform, depth 0..1, phase degrees, trigger mode, and either Hz or a musical note division. Its waveforms are sine, triangle, sawtooth, square, and sample-and-hold.

Modulation targets are `pitch-all`, `osc1-pitch`, `osc2-pitch`, `osc1-level`, `osc2-level`, `filter-cutoff`, `filter-resonance`, `amplitude`, and `pan`. Route amounts are signed and use target units: semitones for pitch and cutoff, dB for levels and amplitude, normalized delta for resonance, and -1..1 for pan. LFO output is `depth * route.amount`. The validator caps ENV2 at two routes and LFO at one; arrays are not unlimited matrices.

Automation curves are fixed in v1. Frequency and time controls use logarithmic UI mapping, while semitone, cents, phase, and pan controls use linear mapping. DSP converts pitch semitones to cents and schedules sample-accurate `AudioParam` changes.

## Engine and voice lifecycle

`SynthVoiceManager` owns note identity, ownership, Mono/Poly behavior, unison allocation, voice stealing, engine switching, and LFO lifecycle. `SubtractiveEngine` owns graph construction, modulation, live parameter updates, and node teardown. Both realtime and offline renderers bind the same implementation to a `BaseAudioContext`.

Each note-on receives a unique voice ID and records its `VoiceOwner`. Releases address a voice instance, not only a source/note pair, so live input, Arp, and sequencer may sound the same note without cutting one another off. Poly voice stealing prefers voices already releasing, then the oldest eligible voice.

Mono maintains an owner-aware held-note stack. The first note starts both envelopes. A new overlapping note glides the existing voice without retriggering; releasing it glides back to the previous held note. Releasing the final held note starts release. Glide zero changes pitch immediately but retains legato envelope behavior. Poly creates independent envelopes and does not glide.

Transport-triggered LFO is shared per synth channel and phase-locked to the transport origin. Note-triggered LFO is per voice and begins at `phaseDegrees`. Sync rate follows BPM and supports straight, dotted, and triplet divisions; Hz mode is independent of transport tempo.

Continuous controls update sounding voices: tuning, waveform, source levels, filter, drive, LFO rate/depth, and pan. Envelope timing and unison count apply to newly created voices. Changing voice mode or engine quickly releases existing voices before using the new topology. Preset application stops current voices and atomically installs engine and complete patch.

## Presets, defaults, and Vibes

Factory presets remain literal data in `src/data/synthPresets.ts` and obey the data-layer leaf rule. Every preset is complete; applying one never merges against a mutable global default. Custom presets persist the same engine-discriminated complete shape.

`factory-subtractive-init` is the neutral manual-engine-switch default and remains discoverable through All/Search without adding an Init category tab. New projects use explicit, role-appropriate preset IDs for Lead, FX, Chord, Bass, and Pad. Changing engine manually loads that engine's init preset. Selecting any preset switches to its engine automatically.

Categories remain Bass, Lead, Pad, Keys, Pluck, Brass, and FX. Controlled tags cover tonal character, articulation, movement, register, voice behavior, and synthesis technique. Engine is a separate axis from category and tags. The browser adds an Engine filter and mixed-result badges only when more than one engine exists.

A preset changes only the synth patch. It preserves Arp and the external effect chain. A Vibe may set all three independently by referencing synth preset IDs, Arp settings, and an effect-chain ID. Missing factory references fail data tests; runtime resolution falls back to the relevant track default.

Factory content is re-authored for the new topology rather than mechanically padded. Required FX fixtures include down-sweep, up-sweep, noise riser, and zap. The down-sweep uses a sine oscillator, ENV2 routed to `pitch-all` at +48 semitones, zero attack, timed decay, zero sustain, and ENV1 for amplitude.

## Simple and Pro UI

The approved Synth Lab shell, preset bar, Focus row, and Simple/Pro switch are engine-independent. The approved Pro surface is `SubtractiveProPanel`. Future engine Pro panels may use different internal layouts rather than conforming to one generic panel.

Simple uses an engine-specific adapter with `read` and `write` operations. Its eight subtractive controls map to OSC balance, sub level, filter cutoff, filter resonance, amp attack, amp release, LFO depth, and stereo width. Descriptors such as Warm, Open, Quick, and Wide are derived and never persisted.

OSC balance is a reversible coordinate transform over the two oscillator levels. Reading derives their equal-power balance; writing crossfades while preserving combined power. Every other Simple control has one canonical Pro parameter. Merely switching view performs no store write.

No engine selector appears while subtractive is the only implementation. When a second engine ships, a compact selector enters the existing preset bar. Manual selection loads the target engine's init preset; preset selection changes engine implicitly.

## Validation and compatibility

Persisted projects, imported `.solna` bodies, custom presets, and factory data pass through engine-discriminated validation before reaching DSP. Unknown engines and incomplete or wrong-shaped patches fall back as whole patches to the relevant track default and produce an import/open warning. Finite out-of-range numbers clamp; non-finite or wrong-type fields invalidate the patch. Engine plus patch installs in one store update.

The old flat `SynthParams` shape receives no migration chain. Under the project's current no-real-users precondition, an incompatible old synth body falls back to a track default rather than guessing units or partially merging shapes.

`PROJECT_FORMAT_VERSION` also stays put, and that is a decision with its own precondition rather than the no-migration rule reapplied. The constant is the murva-facing interop marker, and replacing the value type of five top-level content keys would ordinarily be exactly the content-contract change it exists to announce — but murva has not implemented the synth half of the contract at all, so there is no reader to signal and a bump would protect nothing. The first time murva reads a synth body, this reasoning expires and a bump is owed.

## Verification

- Domain tests enforce complete factory patches, valid engine/patch pairs, unique IDs, controlled tags, valid Vibe references, and explicit track defaults.
- DSP tests cover oscillator tuning/mix, envelopes, modulation polarity and units, owner isolation, Mono legato stack behavior, voice stealing, and both LFO trigger modes.
- Offline signal tests prove pitch-sweep direction, distinct filter responses, distinct white/pink/brown noise slopes, unison width, and bounded output.
- Simple/Pro tests prove derived readings, no write on mode switch, canonical parameter writes, and equal-power OSC balance.
- Calibration renders category-appropriate reference registers, rejects clipping, and enforces peak/loudness tolerances for defaults and Vibe-referenced presets.
- The repository completion gate remains `bun run verify`.

## Delivery slices

1. Domain schema, engine boundary, complete validation, explicit defaults, and store/project installation.
2. Subtractive DSP, unique voice identity, Mono/Poly lifecycle, modulation, shared transport LFO, offline parity, and approved Pro UI.
3. Simple adapter, re-authored factory presets, calibration gates, and Vibe integration.

Each slice must keep factory data valid and realtime/offline rendering aligned; no slice introduces an inert future engine.
