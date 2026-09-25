# ADR-0054: Scale intervals are derived from tonal

**Status:** Accepted — 2026-09-26. Amends [ADR-0006](0006-derived-degree-qualities-and-display-spelling.md) (R061). No issue.

## Context

ADR-0006 kept `intervals` in `SCALES` as content a reviewer could check by eye, with a test
pinning each array to `tonal`. Every entry already named its `tonal` scale, so each scale's
intervals were stated twice, and the test existed only to keep the copies equal. Growing the
library to murva's scale list would have multiplied that duplication, and a reviewer cannot check a
Lydian Augmented or Locrian ♯2 array by eye any better than a chord-quality list.

## Decision

- `SCALES` states `name`, `abbr`, `description`, `category`, `tonal`, `tonality` and, for scales
  under seven degrees, a 7-note `parent`. It states no intervals and no chord qualities.
- `src/musicCore/tonalAdapter.ts`'s `scaleSemitonesForTonal` measures a tonal scale in semitones.
  `src/musicCore/scale.ts` resolves every entry once at module load into `SCALE_LIBRARY`
  (`ResolvedScale` = definition + derived `intervals`), and `scaleEntry` returns from it. A `tonal`
  name that does not resolve throws at load.
- Every interval read goes through `scaleEntry`; nothing indexes `SCALES[key].intervals`.
- A golden pin in `src/data/scales.test.ts` holds the interval arrays of the scales that were
  authored by hand, verbatim. A saved project names its scale by key, so those scales must keep
  sounding as they did; a `tonal` upgrade that moves one fails the pin.
- Names, descriptions, categories and order come from murva, because `tonal` has no mood or genre
  data. Existing keys are identities and stay; new keys are readable ASCII because the header's
  short label renders the key.
- `abbr` is an authored abbreviation for the header's compact trigger, unique and at most seven
  characters (pinned by `scales.test.ts`). A cut of the display name is not an abbreviation:
  four letters read `Mino` for three different minor scales.

Rejected:

- **Keeping `intervals` as content.** Two sources for one fact, kept equal only by a test.
- **Cutting the display name for the compact trigger** (`name.slice(0, 4)`, as before). It
  collided once the library grew; an authored field is the only way to keep every label distinct.
- **Deriving intervals at every call.** A `Scale.get` per lookup on paths the keyboard and
  pads call per render; resolving once at load costs nothing and fails fast.
- **Scales the `parent` mechanism cannot harmonize** (whole tone, diminished, bebop, double
  harmonic major, Hungarian minor, flamenco). They need their own harmony design; see the spec.

## Consequences

- Adding a scale is one `SCALES` entry naming a `tonal` scale; a scale whose derived chord tuple is
  missing from the quality tables fails the harmony invariant in `scales.test.ts`.
- `ScaleDefinition` has no `intervals`; consumers type against `ResolvedScale`.
- The characterization fixtures grow with the library; a legacy entry that changes is a
  behaviour change and must be explained.

## Rules this implies

- **R061** (amended) — `SCALES` states `name`, `abbr`, `description`, `category`, `tonal`, `tonality` and,
  for <7-degree scales, a 7-note `parent`; neither intervals (derived in `src/musicCore/scale.ts`,
  legacy intervals pinned by `src/data/scales.test.ts`) nor chord qualities.

## Sources

Spec: [`docs/superpowers/specs/2026-09-26-scale-library-design.md`](../superpowers/specs/2026-09-26-scale-library-design.md)
(commit `201994a4`). Plan: `docs/superpowers/plans/2026-09-26-scale-library.md`. Murva:
`murva-app/shared/src/music/musicUtils.ts`, `SUPPORTED_SCALES`.
