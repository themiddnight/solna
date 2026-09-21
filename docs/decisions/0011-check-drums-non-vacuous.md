# ADR-0011: `check:drums` asks two questions and cannot pass vacuously

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

`bun run check:drums` is the Beat-preset audible-separation check. A separation gate is easy to
make pass for the wrong reason: a `max` over more parameters only gets easier, a ratio check is
vacuously true against zero, an unmeasurable pair can be mistaken for a passing one, and an
exclusion list can quietly grow. Each of those failure modes has to be closed explicitly.

## Decision

**`check:drums` asks two different questions, and neither can pass vacuously.**

- `PAIRWISE_PARAMS` asks whether two PRESETS differ, and its separation for a pair is a `max` over
  the list — so adding a parameter can only raise every pair's separation and make the floor easier
  to clear. New parameters therefore enter through `spread()`/`spreadDefined()`, never
  `PAIRWISE_PARAMS`.
- A voice that could collapse into a sibling voice inside one preset (a rimshot against that
  preset's own snare, a tom against its own sibling tom) is covered by the separate within-kit
  check instead, which asks whether two VOICES differ inside the same patch.

Non-vacuity guards:

- `spread()` asserts `max >= factor * min`, which is vacuously true at `min = 0`, so
  `spreadDefined` DROPS a zero — a zero is the disabled state stated explicitly (`clickLevel: 0`),
  not a measurement — and its counted minimum then makes "too few presets carry one" a failure
  rather than a silent pass.
- `withinKit` fails CLOSED on a non-finite ratio — an unmeasurable pair is dropped, never treated as
  passing — plus a counted minimum, so a preset that goes entirely unmeasurable fails the count
  instead of silently clearing the floor.
- The "every preset voices every voice away from the default" check skips exactly ONE entry, the
  default preset itself, because a baseline cannot differ from itself; the script asserts that
  exactly one entry is the baseline, so that exclusion cannot quietly grow.

A `spread()` factor chosen after its values were measured is calibration, and its comment says so:
from the commit that adds it, the factor is a floor, never lowered to make a retune easier.

## Consequences

- The check is a gate a preset set can fail, not a report of what the presets are.
- Adding a parameter to the pairwise list would weaken the check, which is why new parameters go
  through `spread()`/`spreadDefined()` instead.
- A retune that fails a calibrated floor is a retune problem, not a floor problem.
- The Beat patch model the check measures is [ADR-0010](0010-beat-instrument-three-fields.md).

## Rules this implies

- **R111** — New `check:drums` parameters enter through `spread()`/`spreadDefined()`, never
  `PAIRWISE_PARAMS`.
- **R112** — Voice-vs-sibling collapse inside one preset is covered by the within-kit check.
- **R113** — `spreadDefined` drops zeros and enforces a counted minimum.
- **R114** — `withinKit` fails closed on a non-finite ratio, with a counted minimum.
- **R115** — The "voiced away from default" check skips exactly one entry (the default preset),
  asserted.
- **R116** — A `spread()` factor chosen after measurement is commented as calibration and is a
  floor, never lowered.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 370-386.
