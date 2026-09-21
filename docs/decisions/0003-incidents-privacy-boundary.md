# ADR-0003: `src/incidents/` is a privacy boundary

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

`src/incidents/` builds public bug reports. A report that could reach application state would be
one careless argument away from publishing a user's project, session or library content. The
module therefore needs a structural guarantee, not a review habit, that nothing but
already-sanitized arguments can flow into a report.

## Decision

**`src/incidents/` is a privacy boundary beside the four layers**
([ADR-0002](0002-four-layer-import-architecture.md)). It builds public bug reports from
already-sanitized arguments, so `eslint.config.js` bans it from importing `store/`, `components/`
or the audio engine (type-only imports from `@/audio/runtime/*` are fine): a state snapshot must
have no path into a report.

`IncidentReportV1` is a closed schema with no open-ended bag, and `isIncidentReportV1` rejects
unknown keys.

## Consequences

- Anything a report needs must be passed in explicitly, already sanitized, by the caller; the
  incidents module cannot go and fetch it.
- Adding a field to a report is a schema change to `IncidentReportV1`, not an extra key in a bag;
  an unknown key is rejected rather than carried through.
- Type-only imports from `@/audio/runtime/*` remain available, since they are erased at compile and
  carry no state.

## Rules this implies

- **R056** — `src/incidents/` may not import `store/`, `components/` or the audio engine (type-only
  `@/audio/runtime/*` allowed); a state snapshot must have no path into a report.
- **R057** — `IncidentReportV1` is a closed schema (no open bag); `isIncidentReportV1` rejects
  unknown keys.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 169-173.
