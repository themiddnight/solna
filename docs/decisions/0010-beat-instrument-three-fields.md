# ADR-0010: Beat is a per-loop instrument of three complete fields

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). R105 amended by
[ADR-0047](0047-drum-pads-take-the-beat-mix-level.md).

## Context

Drums used to be kit-name-only state spread across flat sibling fields (`soundKit`,
`drumFilter*`, `masterSequencerVolume`, `drumMuted`, `sequencerTracks`), with levels looked up in a
trim table beside the engine and presets expressed as `Partial` overrides merged over a shared
default by `mergeDrumKit`. A sound edit could replace a pattern, the sound you got depended on the
sound you had, and voice lists were enumerated by hand in several places in different orders.

## Decision

### Beat is a per-loop INSTRUMENT, and it is exactly three sibling fields

`beatParams` is the sound, `beatPattern` is the events, `beatMix` is the levels, and every action
writes exactly one of them — a sound edit can never replace a pattern. There is no fourth field and
no flat sibling: the kit-name-only state this replaced (`soundKit`, `drumFilter*`,
`masterSequencerVolume`, `drumMuted`, `sequencerTracks`) is gone from the app, and
`src/store/beatLegacyBoundary.test.ts` enforces that those seven names appear in exactly three
files — `sanitizeBeat.ts`, its test, and the guard — with a LITERAL allowlist, so a second
compatibility reader fails review visibly rather than merging as a one-line addition. **Old input
is accepted, new writes never contain old fields**: `readBeatState` converts a body written in the
old shape, and it is the only thing in the app that may read one.

**`beatParams` carries its own output trim** (`outputTrimDb`, the measured calibration figure) and
its own bus filter, so a patch a user edits, saves or exports is self-contained — there is no trim
table beside the engine to look a kit's level up in, and `src/audio/trims.ts` does not exist.
(`src/data/trimTable.ts` is a generated calibration artefact that `check:levels` compares against,
read by no runtime code.)

**Every control writes the patch directly**; a knob mid-drag previews through a draft and commits
once (`useBeatParamDraft`), and `applyBeatParams` (`src/audio/beatAdapter.ts`) is the one hop from
a patch to the DSP, shared by the live bridge, the preview and the offline render.

### Eleven Beat voices, and the canonical order is written once

`kick snare rimshot clap hihat openhat hitom lowtom ride crash bell` is the order `BEAT_VOICE_IDS`
declares, and the `BeatVoices` interface, `DEFAULT_BEAT_VOICES`, every `BEAT_PRESETS` patch,
`DEFAULT_PADS` and `triggerDrum`'s dispatch all follow it, so a reviewer comparing any two of those
lists is comparing sorted lists. `DEFAULT_PADS` follows the order but is not the whole roster:
`bell` has no pad (`PADLESS_VOICES`). A pad has no level of its own: it strikes at the Beat
audition velocity and its voice's level is the current loop's Beat-mix fader (ADR-0047; this
replaced a persisted per-pad velocity override, `drumPadVelocities`).

`BeatVoices` carries no `reference` field — a preset's provenance lives on `FactoryBeatPreset`
instead, deliberately off the voices type, so `keyof BeatVoices` stays exactly the voice roster and
never drifts into carrying documentation. `DRUM_ALIASES` is `{ closedhat: 'hihat' }` and nothing
else: `triggerDrum` resolves an alias BEFORE its dispatch, so an alias pointing at a voice that has
since gained its own case makes that case dead code with no error and no failing test — a guard
asserts the table exhaustively (`toEqual`, not a subset check).

### A Beat patch is COMPLETE, and that is what removed the merge

Every voice states every field, so there is no `Partial` laid over a shared default and no
`mergeDrumKit` to enumerate voices by hand. `DEFAULT_BEAT_VOICES` is the default preset's own
voices object — the drum synth seeds its pre-patch default from it, and `beatPresets.test.ts` pins
that the two are the same object rather than copies that can drift. A preset is installed WHOLE
(`structuredClone`d on the way in), never merged over whatever the track was already holding.

## Consequences

- A sound edit, a pattern edit and a level edit can never interfere, because each writes its own
  field.
- A saved or exported Beat patch is self-contained, including its calibration trim and bus filter.
- Legacy shapes are readable in exactly one place; adding a second reader is a visible allowlist
  change. This is the Beat instance of validation-over-migration
  ([ADR-0023](0023-validation-instead-of-migration.md)).
- The same "complete patch, installed whole" rule governs synth presets
  ([ADR-0020](0020-synth-patch-model.md)).
- A drum grid changes `beatPattern` only, never `beatParams`
  ([ADR-0009](0009-vibes-as-data-and-single-drum-grid-library.md)); per-voice mute in `beatMix`
  is independent of track solo ([ADR-0015](0015-session-only-track-solo.md)).
- The audible-separation check over presets is [ADR-0011](0011-check-drums-non-vacuous.md).

## Rules this implies

- **R097** — Beat per loop = exactly `beatParams` (sound), `beatPattern` (events), `beatMix`
  (levels); every action writes exactly one.
- **R098** — No fourth field/flat sibling; legacy names (`soundKit`, `drumFilter*`,
  `masterSequencerVolume`, `drumMuted`, `sequencerTracks`) appear only in `sanitizeBeat.ts`, its
  test and `beatLegacyBoundary.test.ts` (literal allowlist).
- **R099** — `readBeatState` is the only reader of the old shape; new writes never contain old
  fields.
- **R100** — `beatParams` carries `outputTrimDb` and its bus filter; no runtime trim table;
  `src/audio/trims.ts` must not exist; `src/data/trimTable.ts` is a generated artefact read by no
  runtime code (`check:levels` only).
- **R101** — Every Beat control writes the patch directly; knob drag previews via draft and
  commits once (`useBeatParamDraft`).
- **R102** — `applyBeatParams` (`src/audio/beatAdapter.ts`) is the one patch→DSP hop (live,
  preview, offline).
- **R103** — Voice order `kick snare rimshot clap hihat openhat hitom lowtom ride crash bell` is
  declared once in `BEAT_VOICE_IDS`; `BeatVoices`, `DEFAULT_BEAT_VOICES`, `BEAT_PRESETS`,
  `DEFAULT_PADS`, `triggerDrum` follow it.
- **R104** — `bell` has no pad (`PADLESS_VOICES`).
- **R105** — A drum pad has no level control; it strikes at `BEAT_PREVIEW_VELOCITY`, and its
  voice's level is the current loop's Beat-mix fader ([ADR-0047](0047-drum-pads-take-the-beat-mix-level.md)).
- **R106** — `BeatVoices` has no `reference` field; provenance lives on `FactoryBeatPreset`;
  `keyof BeatVoices` = the roster.
- **R107** — `DRUM_ALIASES` is exactly `{ closedhat: 'hihat' }`, asserted with `toEqual`.
- **R108** — A Beat patch is complete: every voice states every field; no `Partial` over a
  default, no `mergeDrumKit`.
- **R109** — `DEFAULT_BEAT_VOICES` is the default preset's own voices object (identity pinned by
  `beatPresets.test.ts`).
- **R110** — A Beat preset is installed whole (`structuredClone`), never merged.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 331-368.
