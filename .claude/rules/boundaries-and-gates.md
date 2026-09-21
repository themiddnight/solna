---
paths:
  - "eslint.config.js"
  - "knip.json"
  - "src/architecture/**"
  - "src/incidents/**"
  - "src/utils/localFileSave.ts"
  - "src/utils/driveBrowser.ts"
---

# Boundaries and gates

ESLint severity policy, Knip graphs, import-ban mechanics, architecture tests, and the incidents and utils boundaries.

## Lint and dead-code gates

- `bun run eslint` reports zero errors and zero warnings. Only `react-hooks/exhaustive-deps` and `complexity` may be configured `warn`; no other rule may warn. <!-- R005 -->
- Never ignore an ESLint warning, and never dismiss one as pre-existing: open the code at each warning and either fix it, when it points at a real defect, or add a line-level `eslint-disable-next-line <rule> -- <reason>` naming why this site is a legitimate exception. Work is done only when `bun run eslint` prints zero errors and zero warnings. <!-- R264 -->
- The default Knip graph includes tests and manually invoked tooling; the production graph excludes tests and narrowly named test-support fixtures, so code kept alive only by tests shows as an unused production file. <!-- R007 -->
- Decision D5: a new ESLint rule lands as `warn` and flips to `error` in the change that empties it. <!-- R008 -->
- The `React.FC` ban, the `../../` ban and `consistent-type-definitions` are `error`. <!-- R009 -->
- `react-hooks/exhaustive-deps` and `complexity` stay `warn`; each legitimate exception carries a line disable naming its reason; never relax either rule for everybody. <!-- R010 -->

([ADR-0029](../../docs/decisions/0029-verify-gate-and-lint-severity.md))

## Import bans

- The four read-only analyser consumers listed in `.claude/rules/metering.md`, plus tests, are exempt from the `components/` → `audio/engine` ban. <!-- R041 --> ([ADR-0028](../../docs/decisions/0028-sample-based-metering.md))
- `eslint.config.js` is the binding list; `metering.md` is the only doc copy of the analyser allowlist — change both together. <!-- R043 -->
- `src/architecture/` holds cross-cutting architecture tests; `dependencyLayers.test.ts` proves Music Core layering and tonal confinement, while `bun run eslint` over the tree proves the layer bans. <!-- R054 -->
- A non-test file in `src/architecture/` falls under the `src/**` catch-all block; the folder has no layering block of its own. <!-- R055 -->

([ADR-0002](../../docs/decisions/0002-four-layer-import-architecture.md))

- Tonal confinement uses the replace-not-merge `no-restricted-imports` pattern (the `TAPER_CONVERSION_BAN` mechanism). <!-- R045 -->
- Import bans cover non-test `src/**` only: the final config block exempts `**/*.test.{ts,tsx}` from every import ban, and `scripts/` is outside the gate. <!-- R053 -->
- `NOTE_REGEX_BAN` bans any regex literal in `leadStepRecord.ts`, `bassPatterns.ts`, `melodyGrid.ts`, `Keyboard.tsx`, `musicTheory.ts`. <!-- R085 -->

([ADR-0005](../../docs/decisions/0005-music-core-and-tonal-confinement.md))

- The engine may import only the timing half of `utils/musicTheory.ts` (`STEPS_PER_BAR`, `stepDurationSec`): `ENGINE_MUSIC_DOMAIN_BAN` is an `allowImportNames` allowlist, so a new pitch export is banned on the day it is written. <!-- R179 -->

([ADR-0018](../../docs/decisions/0018-engine-frequency-boundary.md))

## Incidents

- `src/incidents/` may not import `store/`, `components/` or the audio engine (type-only `@/audio/runtime/*` is allowed); a state snapshot must have no path into a report. <!-- R056 -->
- `IncidentReportV1` is a closed schema with no open-ended bag; `isIncidentReportV1` rejects unknown keys. <!-- R057 -->

([ADR-0003](../../docs/decisions/0003-incidents-privacy-boundary.md))

## Utils → store inversion

- The sole inversion: `utils/localFileSave.ts` and `utils/driveBrowser.ts` import types and constants (the `.solna` MIME type, the Drive MIME type) from `src/store/`; no `utils/` file reads store state, subscribes or names a slice. <!-- R060 -->

([ADR-0004](../../docs/decisions/0004-utils-placement-and-store-constant-inversion.md))

## Prohibited

- Finishing with any ESLint warning, or dismissing one as pre-existing <!-- R005 --> <!-- R264 -->
- A rule other than `react-hooks/exhaustive-deps` or `complexity` configured `warn` after the change that empties it <!-- R005 --> <!-- R008 -->
- Relaxing `exhaustive-deps` or `complexity` for everybody instead of a reasoned line disable <!-- R010 -->
- Downgrading the `React.FC`, `../../` or `consistent-type-definitions` bans <!-- R009 -->
- Changing the analyser allowlist in `eslint.config.js` without `metering.md`, or the reverse <!-- R043 -->
- A merged (not replaced) `no-restricted-imports` block for the tonal ban <!-- R045 -->
- A regex literal in the five `NOTE_REGEX_BAN` files <!-- R085 -->
- A pitch export from `utils/musicTheory.ts` imported by the engine <!-- R179 -->
- `src/incidents/` importing `store/`, `components/` or the audio engine <!-- R056 -->
- An open-ended bag in `IncidentReportV1`, or accepting unknown keys <!-- R057 -->
- A second `utils/` → `store/` import, or a `utils/` file reading store state <!-- R060 -->
