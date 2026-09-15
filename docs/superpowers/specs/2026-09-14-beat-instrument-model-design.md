# Beat Instrument Model and Editor — Design

> Replace the kit-name-only drum state with a complete, editable Beat instrument per loop.
> Written 2026-09-14 against `main` (`62e2dd2`). Every decision below is settled.

## Goal

Make Beat a first-class loop instrument with the same semantic boundaries as the melodic
instruments: editable sound parameters in Sound, musical events in Pattern, and levels/mutes in
Mix. A user can load a preset, edit every drum voice in detail, save the result as a reusable
preset, switch loops without losing it, and export exactly what they hear.

## Non-goals

- No Simple mode or macro layer for Beat. Fast sound changes come from presets.
- No new drum synthesis topology, samples, velocity, probability, or microtiming.
- No generic `InstrumentState<T>` migration for Lead, FX, Chord, Bass, or Pad.
- No requirement to preserve the legacy state shape after it has been read.
- No full Beat preset-library drawer in the first delivery; selector and Quick Save are enough.

## Vocabulary

- **Beat** is the loop's rhythmic instrument layer.
- **Beat Params** is the complete editable sound instance used by one loop.
- **Beat Preset** is a named factory or user template copied into Beat Params.
- **Beat Voice** is one playable sound such as kick, snare, or hihat.
- **Beat Pattern** is the step data that triggers Beat Voices.
- **Beat Mix** is the Beat bus and per-voice level/mute state.
- **Drum** remains the audio-layer term for the synthesis mechanism (`DrumSynth`,
  `triggerDrum`). **Kit** is not a canonical store concept in the new model.

## Canonical Model

The loop owns three sibling fields rather than one monolithic `beat` object. A sound edit must not
replace the pattern or mix object.

```ts
interface Loop {
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
}

type BeatVoiceId =
  | 'kick' | 'snare' | 'rimshot' | 'clap' | 'hihat' | 'openhat'
  | 'hitom' | 'lowtom' | 'ride' | 'crash' | 'bell';

interface BeatParams {
  basePresetId: string | null;
  outputTrimDb: number;
  filter: BeatFilterParams;
  voices: BeatVoices;
}

interface BeatPattern {
  rows: Record<BeatVoiceId, boolean[]>;
}

interface BeatMix {
  levelDb: number;
  muted: boolean;
  voices: Record<BeatVoiceId, { levelDb: number; muted: boolean }>;
}
```

`BeatVoices` has one explicitly typed member per `BeatVoiceId`, using the existing heterogeneous
kick, snare, hat, clap, tom, ride, crash, and bell parameter families. Its shape is complete: every
numeric parameter is required. In particular, a kick without a click uses `clickLevel: 0` rather
than missing click fields.

`outputTrimDb` is hidden calibration data and part of the sound snapshot. The engine no longer
needs a preset name to recover a trim from an external table. Factory and user patches, saved
projects, live playback, and export therefore share the same output level.

Voice gain inside Beat Params is linear preset voicing and is displayed as a percentage. Voice
level inside Beat Mix is a user-owned dB fader. They remain distinct because preset/reset/copy
semantics differ even though both multiply the signal.

A single Beat Voice registry supplies stable order, labels, colors, and other presentation
metadata. Those values are derived at runtime and are not repeated in every loop.

## Presets

```ts
interface BeatPatch {
  outputTrimDb: number;
  filter: BeatFilterParams;
  voices: BeatVoices;
}

interface BeatPreset {
  id: string;
  name: string;
  origin: 'factory' | 'user';
  patch: BeatPatch;
}
```

Selecting a preset copies its complete patch into `beatParams` and records its ID as
`basePresetId`. Editing does not clear that ID. `Edited` is derived by comparing the current patch
with its base preset. Reset Voice copies only the selected voice; Reset All copies the full base
patch. If the base cannot be resolved, the sound remains playable, the UI says `Custom patch`, and
reset actions that require the missing source are disabled.

Quick Save creates a new user preset from the current patch and makes it the new base. User Beat
presets live in app-level persisted storage beside custom Synth presets, not in project content.
Every project nevertheless stores complete Beat Params, so deleting or not having a user preset
never changes a loop's sound.

## Sound UI

Beat has one detailed editor, equivalent in depth to Synth Pro mode. There is no Beat Simple/Pro
toggle. Every knob maps one-to-one to one stored parameter; Primary versus More is disclosure only,
not a second parameter model. Labels use musical language while values retain explicit units.

The section order is:

1. preset selector, previous/next, Quick Save, and Reset All;
2. the Beat-wide filter type, cutoff, and resonance;
3. one row per Beat Voice in canonical order.

Each voice row contains Preview, name, a short current-character summary, Primary controls, More
controls where necessary, and Reset Voice. Clap, hats, toms, and crash already fit their primary
set and need no artificial More group. Denser voices such as kick, snare, rimshot, ride, and bell
use More for the less frequently adjusted partial, start-frequency, and component controls.

The first version exposes direct DSP parameters, not musical macros that secretly edit several
fields. Hz is used for frequency, ms/s for time, percent for linear gain/send/balance, and dB only
for mixer levels. `outputTrimDb` is not editable.

### Responsive Contract

There are two structural modes:

- Below `lg` (1024px), the voice list is an accordion. One voice is open at a time and its knobs
  use a three-column grid. `sm` may adjust spacing and sizing but does not introduce a third
  interaction model.
- At `lg` and above, every row shows its Primary controls. More expands beneath its row.

The initial open voice is Kick. The open voice is session-only UI state. It survives Sound/Pattern
navigation and loop changes to support comparison, but is never persisted. Preview has its own
touch target separate from the accordion header. Interactive targets are at least 44px and the
editor introduces no horizontal scrolling, which would conflict with knob gestures.

## Editing and Audio Flow

A pointer gesture keeps a component-local draft. Pointer moves update the displayed value and a
frame-coalesced audio preview without writing persisted state. Pointerup commits Beat Params once;
pointercancel restores the committed engine state. Keyboard changes commit per keypress. A loop
change during a gesture cancels the draft before installing the next loop.

Components never import the audio engine. A store/audio boundary accepts transient Beat previews,
while ordinary engine sync installs committed Beat Params and Beat Mix. Changing voice parameters
affects subsequently created drum hits; an already sounding one-shot finishes with the parameters
with which it was created.

The existing drum DSP remains responsible for synthesis. A Beat adapter translates the complete
product model into its engine-facing shape. Beat filter state drives both dry and send filters as it
does today. Preview uses the same trigger path as drum-pad and sequencer playback.

### Ownership Boundaries

- `data/beatPresets.ts` owns factory preset literals.
- `store/beatSlice.ts` owns committed Params, Pattern, Mix, and their actions.
- `store/sanitizeBeat.ts` owns new-shape validation and legacy conversion.
- `audio/beatAdapter.ts` owns the Beat-to-drum-engine translation; `audio/drumSynth.ts` keeps DSP.
- `components/loop/beat/` owns the preset toolbar, filter panel, responsive voice list, rows, and
  the declarative control schema containing labels, ranges, units, and Primary/More placement.

The control schema lives outside `src/data/` because it is a UI registry, not factory content. No
voice component hand-lists a second parameter roster.

## Pattern and Mix

Beat Pattern stores only fixed-width boolean rows. Beat Mix stores the bus and per-voice faders and
mutes. The old `SequencerTrack` bundle is removed from canonical loop state; ID, name, color, volume,
mute, and steps no longer travel together.

Copy groups become exact: Beat Sound copies `beatParams`, Beat Pattern copies `beatPattern`, and Mix
copies `beatMix` with the other instrument mixes. A vibe selects a Beat preset and Beat pattern
independently. Applying either never carries the other's state accidentally.

## Persistence and Legacy Reads

Both persisted Zustand input and `.solna` input pass through one sanitizer. New-shape input is
validated directly. Legacy input is converted on read:

- `soundKit` plus the three `drumFilter*` fields become complete Beat Params;
- `sequencerTracks[].steps` become Beat Pattern rows;
- `masterSequencerVolume`, `drumMuted`, and each track's volume/mute become Beat Mix.

The conversion resolves the legacy kit name to a stable factory preset ID and includes its measured
trim. Missing rows become silent; missing mix entries become unity and unmuted. Unknown voices are
rejected. Numeric values are finite and range-checked per field, with invalid fields defaulted from
the resolved base preset or the default Beat preset. Valid sibling fields survive.

An unresolved `basePresetId` becomes `null`; the complete stored patch remains unchanged except for
any independently invalid fields.

Only the new shape is written. The project-format marker changes because the content contract has
changed, but it does not select a migration chain. Old fields are not retained in canonical state
or written back.

## Mixdown

Each mixdown loop carries Beat Params, Pattern, and Mix. At every arrangement boundary the offline
engine installs that loop's Beat Params before scheduling its hits, in addition to the existing bus
and filter automation. This also closes the current gap where mixdown initializes one active drum
kit and does not change kit per loop.

## Failure Rules

- Preview before audio initialization is a safe no-op.
- A missing preset never silences or rewrites the stored patch.
- Invalid imported values fall back per field rather than resetting a whole patch.
- Unknown pattern/mix voices are dropped; the canonical roster remains total.
- Cancelled gestures write nothing and restore committed audio state.
- Deleting a user preset does not mutate loops that were based on it.

## Verification

Tests must cover factory preset completeness and ranges; preset select/save/delete/reset; direct
voice editing; one persisted commit per pointer gesture; preview cancellation; loop switching and
mirroring; exact Sound/Pattern/Mix copy groups; legacy conversion through both read paths; project
round-trip; vibe application; live engine sync; two-loop mixdown with different Beat patches;
responsive accordion/full-row contracts; and the existing drum separation and level calibration
gates. Completion requires `bun run verify` with zero new ESLint output.
