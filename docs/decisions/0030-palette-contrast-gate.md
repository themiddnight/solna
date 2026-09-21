# ADR-0030: Palette contrast is a non-vacuous gate

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Solna colours Beat voices and synth modules from two namespaced CSS palettes, `--drum-*` and
`--module-*`, each declared per theme. Their closest pair sits a few thousandths above the WCAG AA
4.5 floor, so a small palette edit can fail it. A contrast script that merely reports numbers, or
that silently skips a colour it cannot find, would let that happen.

## Decision

- `check:contrast` holds **both** namespaced palettes — `--drum-*` and `--module-*` — above the AA
  floor in both themes; the closest pair sits a few thousandths above 4.5, so that step is a gate a
  palette can fail, not a report of what the palettes are.
- The two rosters are named differently on purpose:
  - Beat voices come from `BEAT_VOICE_IDS` (a voice exists in code whether or not it has a colour;
    the CSS tokens are still named `--drum-*`, and the ids are the same strings);
  - module names are read out of `index.css` itself, since the only module list is `Knob`'s
    `KnobColor` union and a CLI gate should not import a React component to learn a list of colours.
- What stops the CSS-derived half passing vacuously is that the script asserts both themes declare
  the *same* module set and that the set is non-empty — a module colour added to one theme only
  fails rather than being skipped.

## Consequences

- A palette edit that drops any pair below 4.5 in either theme fails `verify`.
- Adding a module colour requires adding it to both themes.
- Adding a Beat voice (see [ADR-0010](0010-beat-instrument-three-fields.md)) puts it on the contrast
  roster automatically through `BEAT_VOICE_IDS`.

## Rules this implies

- **R011** — `check:contrast` holds both `--drum-*` and `--module-*` palettes ≥ AA 4.5 in both
  themes; it is a gate, not a report.
- **R012** — Contrast rosters: Beat voices from `BEAT_VOICE_IDS` (CSS tokens stay `--drum-*`, same id
  strings); module names parsed from `index.css`; the CLI gate must not import a React component
  (`Knob`'s `KnobColor`).
- **R013** — Contrast script asserts both themes declare the same, non-empty module set
  (one-theme-only colour fails).

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 43-53.
