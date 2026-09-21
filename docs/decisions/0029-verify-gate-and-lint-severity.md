# ADR-0029: `verify` gate, Knip baselines, D5 severity policy

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). Severity policy
D5 comes from `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md`.

## Context

Work in this repo is largely agent-written, so "done" needs one mechanical definition. A gate that
tolerates warnings drifts: a new rule landed at `error` on a tree that still violates it blocks
everything, while a rule left at `warn` forever is noise nobody reads. Dead-code scans have a
similar problem — a scan whose graph includes tests hides code that only tests keep alive.

The pre-restructure text also contradicted itself: one sentence said the only warnings `eslint`
prints are `react-hooks/exhaustive-deps` sites; a later one said both `exhaustive-deps` and
`complexity` stay at `warn` with every remaining site carrying a line disable. This ADR states the
reconciled policy.

## Decision

### `bun run verify` is the completion gate

Run it before claiming work is done. It runs all tests, the static/domain checks, both dead-code
scans and the production build, including `bun run eslint`.

### ESLint severity

- `bun run eslint` reports **zero errors**.
- Only two rules may be configured at `warn`: `react-hooks/exhaustive-deps` and `complexity`. Both
  stay at `warn` deliberately: both have legitimate exceptions, so each remaining exception carries
  a line disable naming its reason rather than a rule relaxed for everybody.
- **No other rule may warn.**
- **A warning is never ignored (added 2026-09-22).** Warnings used to be tolerated as "known,
  pre-existing" — nine `exhaustive-deps` sites printed on every `verify` and every session learned
  to read past them, which is exactly how a real defect hides in a warning list. The rule is now:
  open the code at each warning; fix it when it points at a real defect, otherwise add a line-level
  `eslint-disable-next-line <rule> -- <reason>`. `bun run eslint` must print zero warnings, so a new
  warning is always news.
- **D5:** a new rule lands as `warn` and flips to `error` in the change that empties it, which is
  why the `React.FC` ban, the `../../` ban and `consistent-type-definitions` are now errors (see the
  ESLint rule matrix in `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md`).

### Knip baselines

- Both Knip scans (`check:dead-code`, `check:dead-code:production`) have a zero-finding baseline.
- The default Knip graph includes tests and manually invoked tooling; the production graph excludes
  tests and narrowly named test-support fixtures, so code kept alive only by tests still appears as
  an unused production file while intentional test infrastructure does not.

## Consequences

- Because `verify` tolerates warnings, any gate whose strength matters asserts its own severity (e.g.
  the planner purity test in [ADR-0027](0027-planned-then-performed-playback.md) and the engine
  domain test in [ADR-0018](0018-engine-frequency-boundary.md)).
- A new warning from any rule other than the two named is a regression, not noise.
- Code reachable only from tests is reported, so it must be either deleted or explicitly named as
  test-support.

## Rules this implies

- **R004** — `bun run verify` is the completion gate; run it before claiming work done.
- **R005** — `bun run eslint` reports zero errors; no rule other than `react-hooks/exhaustive-deps`
  and `complexity` may be configured `warn`, and no other rule may warn; eslint prints zero warnings.
- **R006** — Both Knip scans (`check:dead-code`, `check:dead-code:production`) hold a zero-finding
  baseline.
- **R007** — Default Knip graph includes tests + manually invoked tooling; production graph excludes
  tests and narrowly named test-support fixtures (test-only-kept code shows as unused production
  file).
- **R008** — D5: a new ESLint rule lands as `warn` and flips to `error` in the change that empties
  it.
- **R009** — `React.FC` ban, `../../` ban, `consistent-type-definitions` are `error`.
- **R010** — `react-hooks/exhaustive-deps` and `complexity` stay `warn`; each legitimate exception carries a line disable naming its reason; never relax either rule for everybody.
- **R264** — never ignore an ESLint warning: fix it, or line-disable it with a reason; `bun run eslint` prints zero warnings.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 31-43. R264 added 2026-09-22 (user decision), not from the pre-restructure file.
