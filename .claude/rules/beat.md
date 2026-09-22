---
paths:
  - "src/store/beatSlice.ts"
  - "src/store/beatPresets.ts"
  - "src/store/beatPreview.ts"
  - "src/store/sanitizeBeat.ts"
  - "src/data/beatPresets.ts"
  - "src/data/trimTable.ts"
  - "src/audio/beatAdapter.ts"
  - "src/audio/playback/plan/beatPlan.ts"
  - "src/audio/drumSynth.ts"
  - "src/components/loop/beat/**"
  - "src/components/ui/DrumPadGrid.tsx"
  - "src/components/drumPadVelocity.ts"
  - "scripts/check-drum-kit-separation.ts"
  - "scripts/check-levels.ts"
  - "scripts/calibration/**"
---

# Beat instrument

The per-loop Beat instrument: its three fields, voice roster, complete patches, per-voice mute and the `check:drums` gate.

## Three fields, complete patches

- Beat per loop is exactly `beatParams` (sound), `beatPattern` (events), `beatMix` (levels); every action writes exactly one of them. <!-- R097 -->
- No fourth field or flat sibling: `soundKit`, `drumFilter*`, `masterSequencerVolume`, `drumMuted`, `sequencerTracks` appear only in `sanitizeBeat.ts`, its test and `beatLegacyBoundary.test.ts` (literal allowlist). <!-- R098 -->
- `readBeatState` is the only reader of the old shape; new writes never contain old fields. <!-- R099 -->
- `beatParams` carries its own `outputTrimDb` and bus filter; there is no runtime trim table, `src/audio/trims.ts` must not exist, and `src/data/trimTable.ts` is a generated artefact read only by `check:levels`. <!-- R100 -->
- Every Beat control writes the patch directly; a knob drag previews through a draft and commits once (`useBeatParamDraft`). <!-- R101 -->
- `applyBeatParams` (`src/audio/beatAdapter.ts`) is the one patch → DSP hop for live, preview and offline. <!-- R102 -->
- Voice order `kick snare rimshot clap hihat openhat hitom lowtom ride crash bell` is declared once in `BEAT_VOICE_IDS`; `BeatVoices`, `DEFAULT_BEAT_VOICES`, `BEAT_PRESETS`, `DEFAULT_PADS` and `triggerDrum` follow it. <!-- R103 -->
- `bell` has no pad (`PADLESS_VOICES`). <!-- R104 -->
- A pad velocity override is `drumPadVelocities` in the ui slice keyed by voice id, committed once on slider release, never per drag frame. <!-- R105 -->
- `BeatVoices` has no `reference` field; provenance lives on `FactoryBeatPreset`, so `keyof BeatVoices` is exactly the roster. <!-- R106 -->
- `DRUM_ALIASES` is exactly `{ closedhat: 'hihat' }`, asserted with `toEqual` (an alias resolved before dispatch silently shadows a real case). <!-- R107 -->
- A Beat patch is complete: every voice states every field; no `Partial` over a default, no `mergeDrumKit`. <!-- R108 -->
- `DEFAULT_BEAT_VOICES` is the default preset's own voices object; `beatPresets.test.ts` pins the identity. <!-- R109 -->
- A Beat preset is installed whole (`structuredClone`), never merged. <!-- R110 -->
- A voice's `reverbSend` multiplies the Beat track's reverb send; it is not a direct send to the master reverb. The effective drum reverb is `reverbSend × voice track gain × Beat bus level × Beat track reverb send`. <!-- R305 -->

([ADR-0010](../../docs/decisions/0010-beat-instrument-three-fields.md), [ADR-0037](../../docs/decisions/0037-per-track-sends.md))

## Grids and mute

- `replaceBeatPattern` clears every voice no grid row names; never merge. <!-- R088 --> ([ADR-0009](../../docs/decisions/0009-vibes-as-data-and-single-drum-grid-library.md))
- Solo moves the Beat bus only; the per-voice mute in `beatMix.voices` is independent, and both must pass for a voice to sound. <!-- R161 -->
- Per-voice mute has two appliers; keep both: `planBeatStep` (`audio/playback/plan/beatPlan.ts`, path updated by ADR-0034) skips a muted voice's scheduled hits, and `engineSync`'s `pushBeatVoiceGains` sets its gain to 0 (covers pads and live triggers). <!-- R162 -->

([ADR-0015](../../docs/decisions/0015-session-only-track-solo.md))

## `check:drums`

- New parameters enter through `spread()`/`spreadDefined()`, never `PAIRWISE_PARAMS` (a `max` over the list only gets easier). <!-- R111 -->
- A voice collapsing into a sibling inside one preset is covered by the within-kit check. <!-- R112 -->
- `spreadDefined` drops zeros and enforces a counted minimum. <!-- R113 -->
- `withinKit` fails closed on a non-finite ratio, with a counted minimum. <!-- R114 -->
- The "voiced away from default" check skips exactly one entry (the default preset), and the script asserts that. <!-- R115 -->
- A `spread()` factor chosen after measurement is commented as calibration and is a floor, never lowered. <!-- R116 -->

([ADR-0011](../../docs/decisions/0011-check-drums-non-vacuous.md))

## Prohibited

- A Beat action writing more than one of `beatParams`/`beatPattern`/`beatMix`, or a fourth Beat field <!-- R097 -->
- The legacy names (`soundKit`, `drumFilter*`, `masterSequencerVolume`, `drumMuted`, `sequencerTracks`) outside the three allowlisted files <!-- R098 -->
- A second reader of the old Beat shape, or a new write containing old fields <!-- R099 -->
- A runtime trim table, or `src/audio/trims.ts` <!-- R100 -->
- A per-drag-frame patch write from a Beat knob <!-- R101 -->
- A second patch → DSP path beside `applyBeatParams` <!-- R102 -->
- A voice list in any order other than `BEAT_VOICE_IDS`' <!-- R103 -->
- A pad for `bell` <!-- R104 -->
- Writing `drumPadVelocities` per drag frame <!-- R105 -->
- A `reference` field on `BeatVoices` <!-- R106 -->
- Any `DRUM_ALIASES` entry beyond `closedhat`, or a subset assertion on it <!-- R107 -->
- A `Partial` Beat patch merged over a default, or `mergeDrumKit` <!-- R108 -->
- A copy of the default preset's voices as `DEFAULT_BEAT_VOICES` <!-- R109 -->
- Merging a Beat preset instead of installing a clone <!-- R110 -->
- Treating `reverbSend` as a direct master-reverb send <!-- R305 -->
- A grid apply that merges into the existing pattern <!-- R088 -->
- Letting solo reach per-voice mute, or dropping either mute applier <!-- R161 --> <!-- R162 -->
- A new `check:drums` parameter added to `PAIRWISE_PARAMS` <!-- R111 -->
- A zero counted by `spreadDefined`, or a check without its counted minimum <!-- R113 --> <!-- R114 -->
- A non-finite `withinKit` ratio treated as passing <!-- R114 -->
- Growing the default-preset exclusion beyond one entry <!-- R115 -->
- Lowering a calibrated `spread()` factor <!-- R116 -->
