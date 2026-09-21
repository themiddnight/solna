# ADR-0008: Reharmonization by registry category; Roman numeral accidentals

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

When a progression is snapped to a new key or scale, each chord either keeps the quality the user
picked or takes the landing degree's own diatonic quality. That decision used to be sniffed from
the quality token (`chord.quality.includes('7')`/`includes('9')`), which split "7th chord vs triad"
by string shape rather than by musical behaviour. Separately, Roman numerals need an accidental
convention that reads correctly in modes and minor keys.

## Decision

### A chord's reharmonization behavior is named on the registry, not sniffed from its token

`ChordQualityEntry.reharmonizationCategory` (`src/musicCore/chordQuality.ts`, the registry in
[ADR-0005](0005-music-core-and-tonal-confinement.md)) states which shape family a quality belongs
to — `triad`, `seventh`, `sixth`, `added-tone`, `extension`, `suspended`,
`diminished-half-diminished` or `altered` — and `shouldPreserveQualityOnSnap` derives a binary
policy from it: `sixth`, `added-tone`, `extension` and `suspended` PRESERVE a chord's quality
verbatim through `snapProgressionToScale`'s scale snap, and every other family REGENERATES the
landing degree's own diatonic quality instead.

The split is not "7th chord vs triad" and does not track family names by feel — it tracks
`resolveDegreeQuality`'s actual output set ([ADR-0006](0006-derived-degree-qualities-and-display-spelling.md)):
`triad`, `seventh`, `diminished-half-diminished` and `altered` are exactly the families whose
members that function CAN emit at some degree of some scale, so regenerating them asks the target
key for its own version of the same shape; `sixth`, `added-tone`, `extension` and `suspended` name
colour no scale degree's diatonic derivation ever produces, so there is no diatonic version to
regenerate to and a snap keeps what the user picked.

`dim`, `aug` and `dim7` regenerate for the unsurprising reason — a diminished or augmented triad
and a `dim7` are ordinary diatonic degrees of scales already in the registry. `minMaj7` and
`maj7#5` regenerate for a less obvious one, worth stating because it reads against intuition: both
sound like the most "altered", freeze-worthy qualities on the roster, yet they are Harmonic Minor's
own plain diatonic i and III — stack a seventh on Harmonic Minor's degree 0 and the result is
`minMaj7`, on degree 2 it is `maj7#5`. Preserving either across a key or scale change would carry a
Harmonic-Minor-specific color into a target scale that may have no such color at all; regenerating
asks the new scale what its own i or III actually is.

`snapProgressionToScale` (`src/utils/musicTheory.ts`) reads no substring of a quality token —
`chord.quality.includes('7')`/`includes('9')` do not appear anywhere in the reharmonization path, a
regression a source-scan test in `musicTheory.test.ts` pins — and root-snapping stays
nearest-degree with a tie going to the lower-indexed scale degree (`nearestDegrees(...)[0]`),
unchanged by this.

### A Roman numeral's accidental is relative to Major, and the mediant never carries one

`degreeToRoman` (`src/utils/musicTheory.ts`) builds a degree's numeral from three independent
parts: the position (I-VII), the case (lowercase iff the RESOLVED quality — the step's explicit
override if it has one, never the plain diatonic default — has a minor third), and, for scales with
exactly 7 degrees, an accidental comparing that scale's own interval at the degree's position
against Major's interval at the same position (Mixolydian's `bVII`, Lydian's `#IV`,
Natural/Harmonic Minor's `bVI`).

The THIRD degree is a deliberate, permanent exception — common practice never marks a minor key's
relative-major mediant (`III`, never `bIII`), because there is no competing raised form to
distinguish it from, unlike VI/VII, which distinguish the natural- and harmonic/melodic-minor
forms. A scale under 7 degrees (the pentatonic family, Hirajoshi) never gets an accidental at all —
a position-by-position comparison against a 7-note Major scale has no meaning there.

`CHORD_PROGRESSIONS`' authored `roman` summaries (`src/data/chordProgressions.ts`) are validated
against exactly this — numeral, case and accidental — by `src/audio/chordProgressions.test.ts`; the
trailing quality suffix (`m7`, `maj9`, `sus2`, …) stays unvalidated on purpose, since several
progressions deliberately simplify it for readability.

## Consequences

- Adding a chord quality means naming its category on the registry; its snap behaviour follows
  without any token parsing.
- A category whose members `resolveDegreeQuality` can emit must regenerate; one it can never emit
  must preserve. Changing that derivation's output set is a reason to revisit the split.
- A source-scan test fails if substring sniffing reappears in the reharmonization path.
- Authored Roman summaries cannot drift from `degreeToRoman`'s numeral, case and accidental, while
  their quality suffix may stay simplified.

## Rules this implies

- **R073** — `ChordQualityEntry.reharmonizationCategory` names the family;
  `shouldPreserveQualityOnSnap`: `sixth`, `added-tone`, `extension`, `suspended` PRESERVE;
  `triad`, `seventh`, `diminished-half-diminished`, `altered` REGENERATE the landing degree's
  diatonic quality.
- **R074** — The preserve/regenerate split tracks `resolveDegreeQuality`'s output set (regenerate
  iff some degree of some scale can emit the family).
- **R075** — `dim`, `aug`, `dim7`, `minMaj7`, `maj7#5` regenerate.
- **R076** — `snapProgressionToScale` reads no substring of a quality token (no
  `includes('7')`/`includes('9')`); pinned by a source-scan test in `musicTheory.test.ts`.
- **R077** — Root snap = nearest degree, tie → lower-indexed degree (`nearestDegrees(...)[0]`).
- **R078** — `degreeToRoman` = position + case (lowercase iff the RESOLVED quality — explicit
  override if present — has a minor third) + accidental for 7-degree scales comparing against
  Major's interval at that position.
- **R079** — The third degree never carries an accidental (`III`, never `bIII`).
- **R080** — Scales with <7 degrees never get an accidental.
- **R081** — `CHORD_PROGRESSIONS` `roman` summaries are validated (numeral, case, accidental) by
  `src/audio/chordProgressions.test.ts`; the quality suffix stays unvalidated on purpose.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 236-277.
