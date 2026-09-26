# ADR-0057: Harmony scales

**Status:** Accepted — 2026-09-26. Amends [ADR-0054](0054-derived-scale-intervals.md) (R061). No issue.

## Context

ADR-0054 left out eight of murva's scales: Whole Tone, Diminished, Bebop (Dominant), Bebop Major,
Bebop Minor, Double Harmonic Major, Hungarian Minor and Flamenco. Harmony in the app assumes a
7-note tertian scale, and `parent` covers only subsets of one (the pentatonics and blues). Probing
the eight showed two failures:

- **Passing tones.** The three bebops have 8 notes. Stacking thirds over the passing tone gives
  chords no player would use, and the extra degree shifts every degree-indexed progression: vi in
  Bebop Major lands on G#.
- **Degrees with no chord.** In Whole Tone, Diminished, Double Harmonic Major, Hungarian Minor and
  Flamenco, some degrees stack to interval tuples outside the quality tables, and some have no
  third in the scale at all (degree 7 of Double Harmonic Major). A `parent` does not help either,
  because their notes lie outside every candidate parent.

murva maps each of these scales to a "closest diatonic approximation" (its `parentMapping`), but
coarsely, to major or minor.

## Decision

- `ScaleDefinition` gains an optional `harmony`: the SCALES key of a 7-note scale whose chords
  the scale uses wholesale. Its own degrees host no chords. A scale sets `parent` or `harmony`,
  never both, and the harmony scale sets neither.
- `harmonyKey(scaleType)` in `src/musicCore/scale.ts` returns `SCALES[k].harmony ?? k`, with `k`
  from `resolveScaleKey`, so the Major fallback stays in one place.
- **Chord side** reads `scaleEntry(harmonyKey(scaleType))`: degree qualities, `degreeToRoman`,
  `getDiatonicChordForDegree`, `getDiatonicChords` (the palette), `getBorrowedChords` (list and
  both filters), `snapProgressionToScale`, progression availability, keyboard Chord mode, the pad
  drone's degree buttons, and bass diatonic steps. **Note side** reads `scaleEntry(scaleType)`:
  scale notes, `isNoteInScale`, `remapNoteByScaleDegree`, the scale-locked keyboard, the melody
  grid rows, the Chord-mode melody row, the arp and display spelling.
- The map, chosen by the user in detail over murva's coarse one:

  | Scale | harmony | Why |
  |---|---|---|
  | Bebop | Mixolydian | the scale minus its passing tone |
  | Bebop Major | Major | the scale minus its passing tone |
  | Bebop Minor | Dorian | the scale minus its passing tone |
  | Whole Tone | Lydian Augmented | shares 5 of its 6 notes; an augmented I |
  | Diminished | Locrian #2 | shares 6 of its 8 notes; the diminished i stays in the scale |
  | Double Harmonic Major | Phrygian Dominant | shares 6 of 7; keeps the bII–I cadence |
  | Hungarian Minor | Harmonic Minor | shares 6 of 7 |
  | Flamenco | Phrygian Dominant | murva's own mapping; the Andalusian major I |

- `tonality` stays authored. Its invariant reads the harmony scale's third, which is right for
  Bebop Minor (it holds both thirds and reads minor) and for Flamenco (its major I comes from
  Phrygian Dominant).
- Names, descriptions and categories are murva's. A new last category, `Jazz & Other`, holds the
  bebops, Whole Tone and Diminished; the other three join World.
- The scale-locked keyboard's home row starts at most 11 steps below the tonic, so an 8-note
  scale's phone rows keep all eight degrees. For 7 or fewer notes the start is unchanged.

Rejected:

- **A fit-search harmonizer** that picks the best-fitting chord per degree. It leaves chordless
  degrees, and an 8-degree scale still breaks degree-indexed progressions.
- **New chord qualities** for these scales (7b5, sus b5). They fill only some of the holes.
- **murva's coarse major/minor map.** The user declined it: it loses Whole Tone's augmented I and
  the Phrygian Dominant cadences.
- **Filtering borrowed chords against the scale's own notes.** F minor is built from C Bebop
  Major's notes, but the Major palette lacks it, so it would vanish from both lists.

## Consequences

- A chord can contain a note outside the scale. Whole Tone's chords include Lydian Augmented's A,
  which the scale-locked keyboard cannot play and the melody grid shows as a borrowed row. The
  "In-Scale Chords" heading stays as it is. murva makes the same trade.
- A harmony scale inherits its harmony's borrowed list and Roman-numeral accidentals: Whole Tone
  reads `#iv` and `#v`, although it has six notes.
- A seven-degree progression is offered in Whole Tone.
- A lead melody still remaps by the scale's own degree on a scale change, so Major → Bebop Major
  moves A to G#. A harmony-aware remap would be a separate decision.
- Adding a scale whose degrees host no chords is one SCALES entry naming its `tonal` scale and a
  7-note `harmony`. The characterization fixtures gain lines, and none of the existing ones move.

## Rules this implies

- **R061** (amended) — `SCALES` states at most one chord source: a 7-note `parent` for a scale
  under seven degrees whose own degrees host chords, or a `harmony` (a 7-note key setting
  neither) for a scale whose degrees host none.
- **R358** — chord-side code reads `scaleEntry(harmonyKey(scaleType))`; note-side code reads
  `scaleEntry(scaleType)`; R078–R080 measure the harmony scale.

## Sources

Spec: [`docs/superpowers/specs/2026-09-26-harmony-scales-design.md`](../superpowers/specs/2026-09-26-harmony-scales-design.md)
(commit `e5fd798e`). Plan: `docs/superpowers/plans/2026-09-26-harmony-scales.md`. Murva:
`murva-app/shared/src/music/musicUtils.ts`, `SUPPORTED_SCALES` and `parentMapping`.
