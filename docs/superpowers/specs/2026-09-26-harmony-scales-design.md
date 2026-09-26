# Harmony scales: the 8 excluded scales — design

This follows the scale library (ADR-0054). It adds the 8 scales that spec left out: Whole Tone,
Diminished, Bebop (Dominant), Bebop Major, Bebop Minor, Double Harmonic Major, Hungarian Minor
and Flamenco. Their names, descriptions and categories come from murva
(`murva/murva-app/shared/src/music/musicUtils.ts`, `SUPPORTED_SCALES`).

Branch `feat/harmony-scales`, no Linear issue.

## Problem

Harmony in the app assumes a 7-note tertian scale. `parent` covers subsets of a 7-note scale
(the pentatonics and blues). These 8 scales break that assumption in two ways:

- **Passing tones (the three bebops, 8 notes).** Stacking thirds over the passing tone gives
  chords no player would use. The extra degree also shifts every degree-indexed progression:
  vi in Bebop Major lands on G#.
- **Degrees with no chord.** These are Whole Tone, Diminished, Double Harmonic Major, Hungarian
  Minor and Flamenco. Some of their degrees stack to tuples outside the quality tables, and
  some have no third in the scale at all: degree 7 of Double Harmonic Major has none. Parent
  mapping fails too, because their notes lie outside every candidate parent.

## Decision: a `harmony` scale

Each of the 8 scales names a 7-note scale already in the library as its **`harmony`**. murva
does the same (its `parentMapping`, "closest diatonic approximation"), but coarsely. The user
chose this detailed map on 2026-09-26:

| Key | Name (murva) | tonal | Category | harmony | Why |
|---|---|---|---|---|---|
| `Bebop` | Bebop (Dominant) | `bebop` | Jazz & Other | Mixolydian | the scale minus its passing tone |
| `Bebop Major` | Bebop Major | `bebop major` | Jazz & Other | Major | the same |
| `Bebop Minor` | Bebop Minor | `bebop minor` | Jazz & Other | Dorian | the same |
| `Whole Tone` | Whole Tone | `whole tone` | Jazz & Other | Lydian Augmented | shares 5 of its 6 notes; I+ tonic |
| `Diminished` | Diminished | `diminished` | Jazz & Other | Locrian #2 | shares 6 of its 8 notes; i° tonic stays in the scale |
| `Double Harmonic Major` | Double Harmonic Major | `double harmonic major` | World | Phrygian Dominant | shares 6 of 7; the bII–I cadence |
| `Hungarian Minor` | Hungarian Minor | `hungarian minor` | World | Harmonic Minor | shares 6 of 7 |
| `Flamenco` | Flamenco | `flamenco` | World | Phrygian Dominant | murva's own mapping; the Andalusian major I |

Descriptions are murva's, verbatim. Each `abbr` is authored: unique, at most seven characters,
and never a cut of the name (R061). Suggested values: `Bebop`, `BebMaj`, `BebMin`, `WholeT`,
`Dim`, `DblHarm`, `HungMin`, `Flamnco`. The plan checks each for uniqueness.

### The rule: chord side reads `harmony`, note side reads the scale

A new musicCore helper returns the scale that hosts chords:
`harmonyKey(scaleType) = SCALES[k].harmony ?? k`, with `k` resolved by `resolveScaleKey`.

**Chord side (reads `scaleEntry(harmonyKey(scaleType))`):**

- degree qualities (`resolveDegreeQuality`, which resolves the harmony key before its
  parent/tertian logic);
- `degreeToRoman`, `getDiatonicChordForDegree`, `getBorrowedChords` (its per-scale lists match
  on the harmony key) and `snapProgressionToScale`;
- the chord palette's degree count (`useChordView`) and `progressionAvailability`;
- keyboard Chord mode (`getChordKeyboardRows`);
- the pad drone degree (`droneDegreeButtons` and the drone's intervals);
- bass diatonic steps (`bassPatterns.diatonicStepAbove`), because the bass follows the chords;
- `isInScalePaletteChord`.

**Note side (reads `scaleEntry(scaleType)`, unchanged):**

- `getScaleNotes` and `getScaleNotesInOctave`, `isNoteInScale`, `remapNoteByScaleDegree`;
- the scale-locked keyboard, the melody grid rows and the arp;
- display spelling of the scale's notes.

The plan audits every `scaleEntry(` and `.intervals` call site (the list comes from a grep) and
assigns each one a side. A site that fits neither side is a plan-time question, not a guess.

### Tonality

`tonality` stays authored. The invariant test changes from "the scale contains a major third" to
"the **harmony** scale contains a major third". That is correct for Bebop Minor, which contains
both b3 and 3, and for Flamenco, whose major I comes from Phrygian Dominant. For the 24 existing
scales `harmony` is absent, so their harmony scale is themselves and the test result does not
change.

Resulting tonalities: Bebop, Bebop Major, Whole Tone, Double Harmonic Major and Flamenco are
`major`; Bebop Minor, Diminished and Hungarian Minor are `minor`.

### `harmony` versus `parent`

- **`parent`** (unchanged): a sub-7-note scale's **own** degrees host chords, and each degree
  takes its quality from the nearest degree of its parent. The pentatonics and blues keep it.
- **`harmony`**: the scale's degrees host **no** chords. Chord degrees are the harmony scale's
  seven.
- A scale may set one of the two, never both. `harmony` must name a 7-note entry with neither
  field set. Both are checked by a test.

### Accepted trade-off

A chord can contain a note outside the scale. For example, Whole Tone's chords include Lydian
Augmented's A, which the scale-locked keyboard cannot play. The "In-Scale Chords" heading stays
as it is. murva makes the same trade.

## Data — `src/data/scales.ts`

- `ScaleCategory` gains `'Jazz & Other'`, which is last in `SCALE_CATEGORIES`.
- The 8 entries go in display order: after Vietnamese in World, and in the new category
  (murva's order).
- `ScaleDefinition` gains `harmony?: string`. The JSDoc says it is a SCALES key of a 7-note
  scale whose chords this scale uses wholesale, and that it is exclusive with `parent`.
- The file still imports nothing at runtime (R020).
- The header's `SCALE_GROUPS`, the listbox and `ScaleTypeOptions` pick up the new category from
  `SCALE_CATEGORIES`, with no code change. Check that a `SCALE_GROUPS` test does not pin 24
  entries or 5 categories. If one does, update it to derive from `SCALES`.

## Where 6- and 8-note scales meet the note side

Each of these is checked, and the plan names a test for each:

- The **scale-locked keyboard** already handles 5- and 6-note scales. The plan checks that 8
  degrees per octave map onto the QWERTY rows without a collision (`check:keys`) or a dropped
  degree.
- **Melody grid rows** list the scale's notes. 8 rows per octave must render and sanitize.
- **`remapNoteByScaleDegree`** already tolerates scales of different sizes.
- **Vibes and the dice** only reference existing scales. No vibe gets one of the new scales.

## Rules and docs

- **R061** (amended, in `.claude/rules/music-domain.md`): `SCALES` may state `harmony` (a 7-note
  SCALES key, exclusive with `parent`).
- **New R358:** "Chord-side code (qualities, Roman numerals, diatonic and borrowed chords,
  progressions, Chord mode, pad drone, bass steps) reads `scaleEntry(harmonyKey(scaleType))`.
  Note-side code (scale notes, scale lock, melody rows, arp, remap, spelling) reads
  `scaleEntry(scaleType)`." Add a `## Prohibited` line for a chord-side read that skips
  `harmonyKey`.
- **New ADR `docs/decisions/0057-harmony-scales.md`**, which records:
  - why a harmony scale (the probe results, murva's precedent);
  - the map and the reasons for each entry;
  - the rejected alternatives:
    - a fit-search harmonizer, which leaves chordless degrees and breaks degree-indexed
      progressions;
    - new chord qualities per scale (7b5, sus b5), which fill only some holes;
    - murva's coarse major/minor map, which the user declined;
  - the trade-off above.

  Add its row to `docs/decisions/README.md`. ADR-0054 is Accepted and gets only a Status-line
  pointer.
- **`.claude/skills/music-theory/SKILL.md`:** one line on `harmony`.
- **Memory `scale-select-followups.md`:** item 1 done.

## Testing

`bun:test`, pure functions first.

- **`scales.test.ts`:**
  - the 8 keys exist, with murva's names and descriptions and the categories above;
  - `harmony` names a 7-note entry with no `parent` and no `harmony`, and it is never set
    together with `parent`;
  - the tonality invariant now reads the harmony scale;
  - "every degree resolves a triad and a seventh" now iterates the harmony scale's degrees;
  - the legacy scales' pinned intervals are unchanged, and the new scales' intervals match
    tonal (spot-check two).
- **`musicTheory.test.ts`:**
  - `harmonyKey`;
  - Bebop Major degree 5 is A minor, not G#;
  - Whole Tone I is `aug`;
  - Diminished I is `dim`;
  - Hungarian Minor V is `maj`;
  - `degreeToRoman` on Double Harmonic Major degree 1 is `bII`;
  - `getBorrowedChords` for Bebop Major equals Major's;
  - `getScaleNotes('C', 'Bebop Major')` has 8 notes including G#;
  - `isNoteInScale('G#', 'C', 'Bebop Major')` is true.
- **Keyboard:** scale-lock rows for Bebop Major (8) and Whole Tone (6); Chord mode rows for
  Bebop Major have 7 chords.
- **Bass:** a diatonic step over Bebop Major never lands on G#.
- **Persistence:** `sanitize` accepts each new key, and an unknown key still falls back to Major.
- **Header:** the listbox shows the "Jazz & Other" group with its 5 options.
- **Gates:** `check:keys`, `check:content`, `bun run verify`, and `bun run eslint` with zero
  errors and zero warnings.
- **Browser check:**
  - choose Bebop Major: the chord palette shows 7 chords with vi = Am, and the scale-locked
    keyboard plays G#;
  - choose Whole Tone and play a progression: no console errors;
  - the header listbox shows the new group.

## Out of scope

- New chord qualities.
- Per-scale borrowed-chord lists for the new scales, which inherit their harmony scale's list.
- Changing the "In-Scale Chords" heading.
- Phrygian Dominant spelling (dropped by the user).
