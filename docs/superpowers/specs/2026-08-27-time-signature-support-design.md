# Variable Time Signature Support — Design

Status: design agreed, not implemented. Date: 2026-08-27.

## Problem

Solna is hardwired to 4/4. `STEPS_PER_BAR = 16` (`src/utils/musicTheory.ts:345`) is a
module constant referenced at 27 sites across 9 files, and `BEATS_PER_BAR = 4`
(`src/utils/playhead.ts:4`) mirrors it for the chord playhead. A bar is therefore
structurally 16 sixteenth-steps everywhere: the metronome, the sequencer grid, chord
scheduling, the beat counter and every pattern library. Users cannot play 3/4, 6/8 or
anything else.

The enabling fact is that **the 16th-note grid does not change**. Every meter in scope is
an integer number of 16th steps per bar, and the engine clock
(`src/audio/engine.ts:141-147`, `clockStepIndex` — a monotonic 16th counter) is already
indifferent to bars except inside the metronome branch. So this is a plumbing and data
problem, not a DSP one.

## Scope

**In scope.** A single `select` in the transport area offering six meters (no separate
numerator/denominator inputs). Meter as transport state, reaching the engine through
`src/store/engineSync.ts`. Bar-relative derivation of `stepInBar`. Accent-group-driven
metronome and sequencer UI grouping. A `meter` tag on all 43 existing patterns plus two
adaptation utilities. Persist migration. Non-destructive meter switching for the user's
own drum grid.

**Out of scope.** Multi-bar patterns (2- and 4-bar loops). Latin styles — bossa, samba,
salsa, son, mambo, cha-cha — are 4/4; what they need is a 2-bar clave, not a new meter.
Only the Afro-Cuban 6/8 bell genuinely needs a meter change. Multi-bar support is a
natural follow-on phase and nothing in this design blocks it.

## The Meter model

New module `src/utils/meter.ts` (verified: no such file exists today). It exports a
closed table.

```ts
type MeterId = '4/4' | '3/4' | '6/8' | '12/8' | '5/4' | '7/8'
interface Meter {
  id: MeterId
  stepsPerBar: number    // in 16th steps
  accentGroups: number[] // 16th steps per beat group; must sum to stepsPerBar
}
```

| id | stepsPerBar | accentGroups |
|----|-------------|--------------|
| 4/4 | 16 | [4, 4, 4, 4] |
| 3/4 | 12 | [4, 4, 4] |
| 6/8 | 12 | [6, 6] |
| 12/8 | 24 | [6, 6, 6, 6] |
| 5/4 | 20 | [4, 4, 4, 4, 4] |
| 7/8 | 14 | [6, 4, 4] (a 3+2+2 grouping) |

`MAX_STEPS_PER_BAR = 24` (the 12/8 row) is the widest bar and matters for state sizing.

**`accentGroups` replaces a separate `stepsPerBeat` field.** It is the single source for
three things: the metronome clicks at each cumulative group boundary (high click at step
0, normal click at the others); the playhead beat count is `accentGroups.length`; and the
sequencer UI draws its beat groupings from it. 3/4 and 6/8 both have 12 steps and are
distinguished **only** by `accentGroups` — this is precisely why bar length alone is not a
sufficient tag.

Invariant test: every row's `accentGroups` sums to its `stepsPerBar`.

## Architecture changes by layer

### `src/audio/`

- `barDurationSec(bpm)` (`src/utils/musicTheory.ts:367`) multiplies by the constant; it
  must take `stepsPerBar`.
- Metronome (`src/audio/engine.ts:268-269`) uses `step % 4 === 0` and
  `step % STEPS_PER_BAR === 0`. Replace with accent-group boundary logic computed from
  `stepInBar`.
- `src/audio/playback/chordPlayback.ts` already threads `stepsPerBar` as a **parameter**
  defaulting to `STEPS_PER_BAR` — `scheduleWholeChord` (`:127`, `totalSteps` at `:128`,
  `isLastBar` at `:133`) and `chordPlanPosition` (`:150-158`). The work here is passing
  the meter-derived value rather than relying on the default. Same for
  `sequencerStepAction` (`src/components/useSequencerPlayback.ts:35`) and
  `chordStepAction` (`src/components/chord/useChordPlayback.ts:251`).
- `src/audio/playback/playbackEngine.ts:9` and `src/audio/engine.ts:1498` re-export
  `STEPS_PER_BAR`; the re-exports become a derived accessor or move to the meter module.

**The monotonic-counter trap — the sharpest edge in this work.** `clockStepIndex` never
resets. The arpeggiator (`src/audio/arpSchedule.ts:14-23`) fires on `step % stepMod` with
`stepMod ∈ {4, 2, 1, 0.5}`. When `stepsPerBar` is not a multiple of 4 (7/8 = 14, or a
14-step bar under 5/4 crossings), the arp phase drifts across bar lines and never lands
the same way twice. Fix: **all bar-relative logic — metronome and arp alike — must derive
`stepInBar = clockStepIndex % stepsPerBar` and count from the bar start.** Document in
code that the arp deliberately re-phases at each bar; that is the intended behaviour, not
a rounding artefact.

Meter must reach the engine through **one** subscription in `src/store/engineSync.ts`
(alongside `bpm` at `:48` and `metronomeActive` at `:50`) — never from a component.

### `src/store/`

`meterId: MeterId` is added to `TransportSlice` (`src/store/types.ts:19-44`, next to
`bpm`) with a `setMeter` action in `src/store/transportSlice.ts`. `STEPS_PER_BAR` becomes
a value derived from it.

### `src/components/`

`src/components/SequencerView.tsx` hardcodes the bar in five places: `:77`
(`clearAllSteps`, `new Array(16)`), `:86` (`randomizeSteps`, `{ length: 16 }`), `:133`
(the label `Drum Sequencer (16-Step)`), `:294` (step header
`Array.from({ length: 16 })`), and the grouping at `:295` (`i % 4 === 0`) and `:371`
(`Math.floor(stepIdx / 4) % 2`). The two grouping expressions must derive from
`accentGroups`, not from a fixed 4.

`shiftSteps` (`SequencerView.tsx:91-104`) rotates the whole `steps` array. Once arrays are
padded to 24 (below) it must rotate only the visible `stepsPerBar` window, or it will
rotate padding into view.

`BEATS_PER_BAR = 4` (`src/utils/playhead.ts:4`, used at `:53`, `:65` and
`src/components/chord/SortableChordCard.tsx:142`) becomes `accentGroups.length`.

`src/components/useSequencerPlayback.ts:134` computes `step % STEPS_PER_BAR` from the
module constant even though the sibling function already accepts a parameter — this is the
real bug site in that file.

## Pattern adaptation

All four pattern libraries are 4/4 today and stay **byte-identical**; they only gain a
`meter` tag.

| Library | Count | Shape |
|---|---|---|
| `src/audio/rhythmPatterns.ts` | 15 chord patterns | `RhythmHit[]`, step 0–15 |
| `src/audio/bassPatterns.ts` | 12 bass patterns | `BassStep[]`, step 0–15 |
| `src/audio/data/vibeDrumPatterns.ts` | 6 patterns | 7 rows × 16 `number[]` (kick/snare/hihat/openhat/clap/tom/crash) |
| `src/audio/data/genrePresets.ts` | 10 presets | 7 rows × 16 `boolean[]` (…/tom/bass) |

Adaptation rules when a pattern's native meter differs from the active meter:

- **Shorter target → trim.** Drop steps at or after `stepsPerBar`; for event-shaped
  patterns also **clamp `holdSteps`** so no note rings past the bar end.
- **Longer target → loop.** Repeat the source from step 0 until the bar is filled
  (16 → 20 fills steps 16–19 from source steps 0–3). Every bar is then identical; no
  cross-bar drift.
- **Never stretch or rescale.** A four-on-floor kick at steps 0, 4, 8, 12 trimmed to 3/4
  yields 0, 4, 8 — musically correct. Proportional stretch would yield 0, 3, 6, 9 —
  wrong. Rounding onto a 16th grid also collapses or duplicates dense hi-hat rows.

Two utilities are needed because there are two data shapes: an **array-shaped** one for
drum rows (`boolean[]` / `number[]`) that slices and repeats, and an **event-shaped** one
for `RhythmHit[]` / `BassStep[]` that filters by step and clamps `holdSteps`. Note that
`lastBarOnly` approach-note handling (`useChordPlayback.ts:191` sets the flag from
`isApproachToken`; the gating happens in `chordPlayback.ts:133` and `:157` via `isLastBar`)
interacts with the bar boundary and must be reasoned about when trimming.

### Where adaptation happens differs by target

- **Drum sequencer → apply-time.** The user edits the grid, so applying a preset must
  materialise the adapted rows into store state. Storing 16 and trimming at playback would
  make the UI lie, showing steps that never sound.
- **Chord and bass rhythm → playback-time.** The user picks these by id and never edits
  them, so the library stays pure, no migration is needed, and changing meter re-adapts
  automatically.

### The user's own grid: window, don't destroy

`SequencerTrack.steps` (`src/types.ts:74-82`; initial values `src/store/initialState.ts:33-79`,
5 tracks: kick/snare/hihat/openhat/clap) is padded to and **always stored at**
`MAX_STEPS_PER_BAR = 24`. Playback and the UI window the first `stepsPerBar` entries.
Switching meter back and forth is therefore non-destructive to the user's own
programming. This is deliberately distinct from preset adaptation, which is lossy by
design.

## Persistence and migration

The store persists under `musibox_project_state_v1` at **version 4**
(`src/store/store.ts:282`; note `CLAUDE.md` still says version 3 — it is stale and should
be corrected in the same change). This work bumps it to **version 5**, with a migrate step
in `src/store/store.ts` / `src/store/migrate.ts` that:

1. Pads existing 16-length `steps` arrays to 24 with `false`.
2. Defaults `meterId` to `'4/4'`.

Existing `migrate.ts` helpers (`migrateLegacyPresets`, `migrateProjectTitleToVibeId`,
`migrateTrackColors`) establish the pattern to follow: a pure exported function plus a
guard on the incoming `version`.

## Vibes

Each Instant Vibe declares its meter, and applying a vibe also sets the transport meter,
so a vibe always resolves patterns of the right meter. All six current vibes
(`src/store/instantVibes.ts:125,184,245,303,361,422`) are 4/4, so nothing about them
changes today. **Do not rename any vibe id** — ids are persisted in project files and the
label/id drift is intentional.

## One shape change

`GENRE_PRESETS` is `Record<string, Record<string, boolean[]>>`
(`src/audio/data/genrePresets.ts:7`) — flat rows with nowhere to hang metadata. It must be
reshaped to carry a meter:

```ts
Record<string, { meter: MeterId; rows: Record<string, boolean[]> }>
```

The other three libraries are already object-shaped and just gain a field. The reshape has
two known consumers to update: `src/components/SequencerView.tsx:109,162` and
`src/audio/data/genrePresets.test.ts` (which iterates `GENRE_PRESETS[genre]` directly as
instruments). `src/audio/drumKits.test.ts:42-46` asserts key-set parity with
`GENRE_TO_KIT`; top-level keys are unchanged so it should keep passing — verify it does.

## UI

One `select` in the transport area listing the six meters. Preset pickers show each
pattern's native meter and can filter by the active meter. A pattern whose meter differs
stays **selectable** — the user keeps the freedom to run a 4/4 pattern in 6/8 and hear
what happens — but is labelled so the result is not surprising. The sequencer header must
stop saying "16-Step" (`SequencerView.tsx:133`) and derive its label from the meter.

Theme rule reminder: name roles, never colours. `scripts/themeTokenGuard.ts` fails the
build on raw palette classes and its `ALLOWLIST` must stay empty.

## Delivery stages

**Stage 1.** Meter table; transport `meterId` state and select; `stepInBar` plumbing
through metronome, arp, sequencer and chord playback; accent-group UI grouping; a `meter`
tag on all 43 existing patterns; the two adaptation utilities; the persist v4→v5
migration. Acceptance: **default 4/4 output is byte-identical to today's behaviour** and
every existing preset keeps working.

**Stage 2.** Author native 3/4 and 6/8 patterns (drums, chord rhythms, bass) and any vibes
that use them.

## Testing

Existing tests that pin the number 16 and must be updated (each verified):

| File | Site |
|---|---|
| `src/utils/musicTheory.test.ts` | `:318` `barDurationSec`, `:322-323` asserts `STEPS_PER_BAR === 16` |
| `src/audio/clock.test.ts` | `:190-208` metronome downbeat spacing |
| `src/audio/data/vibeDrumPatterns.test.ts` | `:26,:30` row length 16 |
| `src/audio/data/genrePresets.test.ts` | `:5-15` row length 16 + the shape change above |
| `src/store/instantVibesDrums.test.ts` | `:26` row length 16 |
| `src/components/useSequencerPlayback.test.ts` | `:7` `const BAR = 16` |

New tests required:

1. Meter-table invariant — every row's `accentGroups` sums to `stepsPerBar`.
2. Trim/loop utilities on **both** shapes, including `holdSteps` clamping at the bar end.
3. `stepInBar` derivation across a bar boundary for a non-multiple-of-4 meter (7/8), which
   is the arp-drift regression.
4. Persist v4 → v5 migration: 16-length arrays padded to 24, `meterId` defaults to `'4/4'`.
5. A regression test that 4/4 output is unchanged.

Keep new tests in the repo's pure-logic `bun:test` style — import the exported helper, do
not render React.

The completion gate is `bun run verify`, **plus `bun run eslint`** separately, since a new
`src/utils/meter.ts` changes imports across all three layers.

## Risks and open decisions

- **Arp re-phasing is a behaviour change** for any meter whose `stepsPerBar` is not a
  multiple of 4. It is correct, but it means the arp is no longer a pure function of the
  absolute clock step. Pin it with test 3 above.
- **24-wide step arrays inflate every persisted project by 50%** even for 4/4 users.
  Accepted: it buys non-destructive meter switching, and the payload is five boolean
  arrays.
- **Adaptation is lossy and users will notice.** Trimming a 4/4 backbeat to 3/4 silently
  drops the step-12 snare. The UI labelling is the mitigation, not a fix.
- **Open:** whether the meter select belongs in `TransportBar.tsx` next to BPM or in the
  sequencer header. Transport is the argued default since meter affects chords and the
  metronome too, not just drums.
