# ADR-0020: Engine-tagged complete patches, arp beside, units in names

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

The synth patch shape this replaced was flat, merged presets over whatever the track held, buried
the arpeggiator inside the sound, stored some levels as linear gain, and looked a preset's output
level up in a preset-id trim table beside the engine. Each of those made the sound you got depend
on something other than the patch in front of you: two tracks on the same preset could differ and
nothing said so, a renamed preset could silently lose its level, installing a preset overwrote a
performance setting, and a stored number's unit could not be read off its name.

## Decision

### A patch names its ENGINE, and that tag is what a reader dispatches on

- A synth channel holds an `ActiveSynth` (`src/types/synth.ts`): an `engine` tag, a `patch` of
  `{ common, synth }`, and a `sourcePresetId` that is display provenance and **never a DSP input**.
- `SynthEngineId` has one member and deliberately no placeholder second one — an FM or wavetable id
  nothing implements is a branch every reader must handle and no test can reach.
- Adding an engine means adding its params type to `EnginePatchMap` and a case wherever the tag is
  read; `common` is the half that does NOT move, because a voice mode, a glide, a unison spread and
  an output calibration mean the same thing whatever makes the sound.
- A stored body whose `engine` is not a member is never repaired: `sanitizeTrackSynth` hands back
  that track's default, by the same "validate, don't migrate" rule as everything else here (see
  [ADR-0023](0023-validation-instead-of-migration.md)).

### A preset is a COMPLETE patch, and applying one installs it whole

`applySynthPreset(currentArp, preset)` returns `{ activeSynth, arpSettings }` whose patch is a
`structuredClone` of the preset's own — never a `Partial` merged over what the track was already
holding. Merging is what the flat shape it replaced did, and it meant the sound you got depended on
the sound you had. Three rules follow:

- Every entry in `src/data/synthPresets.ts` states a whole `EnginePatch`, so there is no such thing
  as a preset that inherits.
- **Output calibration lives in the patch** — `common.outputGainDb`, not a preset-id trim table
  beside the engine — so a patch a user edits or saves stays self-contained and a renamed preset
  cannot silently lose its level.
- The clone is load-bearing: handing out the library object would let the next knob edit write back
  into the factory table.

(The Beat instrument follows the same complete-patch rule; see
[ADR-0010](0010-beat-instrument-three-fields.md).)

### Arp is performance state, stored beside the patch and never inside it

- Each track carries its own Arp field beside the `ActiveSynth` its sound lives in —
  `chordArpSettings` next to `chordSynthParams`, and so on for every track — so installing a preset
  replaces the sound and leaves the arpeggiation running exactly as it was. That is why
  `applySynthPreset` takes the current Arp and hands it straight back rather than reading one out of
  the preset. An arp buried in the patch is a performance setting a preset would overwrite, which is
  the defect this split exists to make unrepresentable.
- `ArpSettings` (`src/types/synth.ts`) inlines its own literal unions rather than reusing the
  `ArpMode`/`ArpRate` in `src/types.ts`, which belong to the arp SCHEDULER (`audio/arpSchedule.ts`,
  `audio/arpeggiator.ts`); the two modules therefore export no colliding names and neither imports
  the other.
- The one filter-type name has a single owner: the synth `FilterType` in `src/types/synth.ts`, from
  which `src/types.ts`' narrower Beat bus `BeatFilterType` derives.

### Every patch field carries its unit in its name; conversion happens at the `AudioParam`

- Levels are dB (`levelDb`, `subLevelDb`, `noiseLevelDb`, `driveDb`, `outputGainDb`), envelope and
  glide times are seconds, frequency is Hz (`cutoffHz`), pitch offsets are an integer
  `octave`/`semitone` pair plus `fineCents`/`unisonDetuneCents`, and `resonance`, `keyTrack`,
  `stereoWidth`, `velocityToAmplitude` and LFO `depth` are unitless 0..1.
- **Nothing stored is a linear gain and nothing stored is `-Infinity`** — `enabled: false` is how a
  source represents silence, and `SYNTH_GAIN_FLOOR_DB` (`src/utils/synthPatch.ts`) is the floor both
  directions of the conversion clamp to, so every field stays a number a slider can produce and a
  validator can range-check.
- A modulation amount is the one value whose unit could not be read off its name, so `ModRoute` is
  discriminated BY TARGET and carries `unit` in the type: semitones for pitch and cutoff, dB for
  levels and amplitude, a normalized delta for resonance, -1..1 for pan.
- `src/utils/synthPatch.ts` is the only place that math lives, and it deliberately does not import
  `utils/gainUnits.ts` — that one is a branded fader/meter contract kept in sync with murva (see
  [ADR-0028](0028-sample-based-metering.md)), while a patch level is a plain unbranded number with
  its own floor.

## Consequences

- Two tracks on the same preset sound the same; a saved or exported patch is self-contained.
- Adding a second engine is a type-driven change: every `engine` read site fails to compile until it
  handles the new tag.
- Installing a preset never disturbs a running arpeggiation.
- Every stored patch number is range-checkable by the sanitizer without guessing its unit.

## Rules this implies

- **R186** — `ActiveSynth` (`src/types/synth.ts`) = `engine` tag + `patch {common, synth}` +
  `sourcePresetId`; `sourcePresetId` is never a DSP input.
- **R187** — `SynthEngineId` has one member; no placeholder members.
- **R188** — Adding an engine = params type in `EnginePatchMap` + a case wherever the tag is read;
  `common` is engine-independent.
- **R189** — An unknown stored `engine` is never repaired: `sanitizeTrackSynth` returns the track
  default.
- **R190** — `applySynthPreset(currentArp, preset)` returns `{activeSynth, arpSettings}` with a
  `structuredClone`d patch; never a `Partial` merge.
- **R191** — Every `src/data/synthPresets.ts` entry states a whole `EnginePatch`.
- **R192** — Output calibration lives in `common.outputGainDb`; no preset-id trim table.
- **R193** — Never hand out the library preset object (clone is load-bearing).
- **R194** — Arp settings live per track beside the `ActiveSynth` (`chordArpSettings` next to
  `chordSynthParams`, …), never inside the patch; `applySynthPreset` passes the current arp back.
- **R195** — `ArpSettings` inlines its own literal unions; never reuse `src/types.ts`
  `ArpMode`/`ArpRate` (arp scheduler types); the two modules do not import each other.
- **R196** — `FilterType` has one owner (`src/types/synth.ts`); `BeatFilterType` derives from it.
- **R197** — Every patch field names its unit (dB `…Db`, seconds, Hz `…Hz`, `octave`/`semitone`,
  `…Cents`, unitless 0..1 for `resonance`, `keyTrack`, `stereoWidth`, `velocityToAmplitude`, LFO
  `depth`).
- **R198** — Nothing stored is linear gain or `-Infinity`; `enabled: false` = silence;
  `SYNTH_GAIN_FLOOR_DB` clamps both conversion directions.
- **R199** — `ModRoute` is discriminated by target and carries `unit`.
- **R200** — `src/utils/synthPatch.ts` is the only place patch-level math lives; it does not import
  `utils/gainUnits.ts`.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 626-674.
