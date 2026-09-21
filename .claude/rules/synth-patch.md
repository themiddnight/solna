---
paths:
  - "src/types/synth.ts"
  - "src/utils/synthPatch.ts"
  - "src/utils/synthPresets.ts"
  - "src/data/synthPresets.ts"
  - "src/store/synthSlice.ts"
  - "src/store/sanitizeSynth.ts"
  - "src/store/synthPresetInstall.ts"
  - "src/store/synthPatchPreview.ts"
  - "src/components/loop/synth/**"
---

# Synth patch model

Engine-tagged complete patches, the arp stored beside the patch, and units in field names.

## Engine tag

- `ActiveSynth` (`src/types/synth.ts`) is an `engine` tag, a `patch` of `{ common, synth }`, and `sourcePresetId`; `sourcePresetId` is display provenance, never a DSP input. <!-- R186 -->
- `SynthEngineId` has one member; add no placeholder members. <!-- R187 -->
- Adding an engine = its params type in `EnginePatchMap` plus a case wherever the tag is read; `common` is engine-independent. <!-- R188 -->
- An unknown stored `engine` is never repaired: `sanitizeTrackSynth` returns the track's default. <!-- R189 -->

## Complete presets

- `applySynthPreset(currentArp, preset)` returns `{ activeSynth, arpSettings }` with a `structuredClone`d patch; never a `Partial` merge over the current patch. <!-- R190 -->
- Every `src/data/synthPresets.ts` entry states a whole `EnginePatch`. <!-- R191 -->
- Output calibration lives in `common.outputGainDb`; no preset-id trim table. <!-- R192 -->
- Never hand out the library preset object; the clone keeps knob edits out of the factory table. <!-- R193 -->

## Arp beside the patch

- Arp settings live per track beside the `ActiveSynth` (`chordArpSettings` next to `chordSynthParams`, …), never inside the patch; `applySynthPreset` passes the current arp straight back. <!-- R194 -->
- `ArpSettings` inlines its own literal unions; never reuse `src/types.ts`' `ArpMode`/`ArpRate` (arp scheduler types); the two modules do not import each other. <!-- R195 -->
- `FilterType` has one owner (`src/types/synth.ts`); `BeatFilterType` derives from it. <!-- R196 -->

## Units

- Every patch field names its unit: dB (`levelDb`, `subLevelDb`, `noiseLevelDb`, `driveDb`, `outputGainDb`), seconds for envelope/glide times, Hz (`cutoffHz`), integer `octave`/`semitone` plus `fineCents`/`unisonDetuneCents`, unitless 0..1 for `resonance`, `keyTrack`, `stereoWidth`, `velocityToAmplitude`, LFO `depth`. <!-- R197 -->
- Nothing stored is a linear gain or `-Infinity`; the conversion to linear gain happens at the `AudioParam`; `enabled: false` is silence; `SYNTH_GAIN_FLOOR_DB` clamps both conversion directions. <!-- R198 -->
- `ModRoute` is discriminated by target and carries `unit`: semitones for pitch and cutoff, dB for levels and amplitude, a normalized delta for resonance, -1..1 for pan. <!-- R199 -->
- `src/utils/synthPatch.ts` is the only place patch-level conversion math lives; it does not import `utils/gainUnits.ts`. <!-- R200 -->

([ADR-0020](../../docs/decisions/0020-synth-patch-model.md))

## Prohibited

- `sourcePresetId` used as a DSP input <!-- R186 -->
- A placeholder `SynthEngineId` member <!-- R187 -->
- Repairing an unknown stored `engine` <!-- R189 -->
- A `Partial` preset merged over the current patch <!-- R190 -->
- A preset that states less than a whole `EnginePatch` <!-- R191 -->
- A preset-id trim table <!-- R192 -->
- Handing out the library preset object uncloned <!-- R193 -->
- Arp settings inside the patch, or a preset overwriting the arp <!-- R194 -->
- Reusing the scheduler's `ArpMode`/`ArpRate` in `ArpSettings` <!-- R195 -->
- A second `FilterType` <!-- R196 -->
- A patch field without its unit in the name <!-- R197 -->
- A stored linear gain or `-Infinity` <!-- R198 -->
- A `ModRoute` without its target-discriminated `unit` <!-- R199 -->
- Patch conversion math outside `utils/synthPatch.ts`, or importing `gainUnits.ts` there <!-- R200 -->
