# ADR-0006: Degree qualities are derived; spelling is display-only

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

`SCALES` used to state chord qualities per degree alongside its intervals, with override fields for
entries that did not fit. Two of eleven entries came to contradict the table's own stated rule with
nothing failing. Separately, note names must be shown with correct enharmonic spelling (a flat key
reads as flats), but the same names are stored, compared and used as lookup keys, where a second
spelling would make two names for one pitch.

## Decision

### A per-degree chord quality is derived

`SCALES` states `intervals` — content a reviewer can check by eye, pinned to `tonal` by
`src/data/scales.test.ts` — plus `tonal`, `tonality` and, for scales under seven degrees, a 7-note
`parent`. It states no chord qualities: `resolveDegreeQuality` derives them by mapping a degree
onto a parent degree **by semitone offset**, stacking thirds over the parent's spelled names and
measuring with `Interval.distance`.

Indexing `degree % 7` into the parent is the trap — it would make Minor Pentatonic's ♭III resolve
as the parent's ii°, with the right shape, the right length and only the sound wrong. An unmapped
interval tuple throws rather than falling back to `maj`, and **there are no overrides**: an
override field is the shortcut people reach for instead of fixing the derivation, which is exactly
how two of eleven entries came to contradict the table's own stated rule with nothing failing.

### A note name is spelled only where it is read

Separately, **a sharp name is an identity and a spelled name is a label.** Everything generated,
computed or persisted is `ROOTS`-spelled; `src/utils/noteSpelling.ts` spells for display only, at
`formatChordLabel`'s optional third parameter, the lead grid's `leadRowLabel`, the keyboard's
`label` field, the key picker's `KEY_OPTIONS`, and `getTonicSpelling(scaleRoot, scaleType)` at a
key name that is purely rendered — a heading, a chip, a tooltip, a toast, an option label.

The boundary is what the value becomes next, not where it sits: a key name that is only read stays
a candidate for spelling, one that is stored, compared, or used as a lookup key must stay
`ROOTS`-spelled. The progression quick-save name is the case that looks like a miss and is not — it
is built from the raw root and then written into a saved progression's name, so spelling it would
put an accidental into persisted state.

## Consequences

- A scale entry is reviewable by eye (its intervals) and checked by test against `tonal`; its
  chord qualities cannot drift from its intervals because they are not stated.
- A new scale needs no quality table; a scale whose intervals map to no known tuple fails loudly.
- Nothing spelled is persisted, so spelling never moves a persist `version` or a `.solna`
  `formatVersion`.
- The Roman-numeral and reharmonization logic built on `resolveDegreeQuality` is
  [ADR-0008](0008-reharmonization-category-and-roman-numerals.md).

## Rules this implies

- **R061** — `SCALES` states `intervals` (pinned by `src/data/scales.test.ts`), `tonal`,
  `tonality`, and for <7-degree scales a 7-note `parent`; it states no chord qualities.
- **R062** — `resolveDegreeQuality` maps a degree onto the parent by semitone offset, stacks thirds
  over spelled names, measures with `Interval.distance`; never index `degree % 7`.
- **R063** — An unmapped interval tuple throws (no `maj` fallback); no override fields in `SCALES`.
- **R064** — A sharp name is an identity; everything generated, computed or persisted is
  `ROOTS`-spelled.
- **R065** — `src/utils/noteSpelling.ts` spells for display only, at: `formatChordLabel`'s 3rd
  param, `leadRowLabel`, the keyboard `label`, `KEY_OPTIONS`, `getTonicSpelling(scaleRoot,
  scaleType)` for purely rendered key names.
- **R066** — The boundary is what the value becomes next: stored, compared or lookup-key values
  stay `ROOTS`-spelled.
- **R067** — The progression quick-save name is built from the raw root and must not be spelled.
- **R068** — Nothing spelled is persisted; spelling never moves persist `version` or `.solna`
  `formatVersion`.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 191-212.
