# ADR-0032: Key change as a loop-content operation

**Status:** Accepted — 2026-09-22. DEV-424 (epic DEV-433).

## Context

A key change used to be two separate paths: melodies followed it inside the store
(`keyChangePatch`), while chords followed it through a chord-view effect gated by
component-local state. That effect only ran for the active loop, so a loop that was not
active could never have its chords follow a key change — a hard blocker for batch key change
(DEV-427). The same effect also harmonized chords when a key-only loop copy landed in the
active loop, but not when the same copy landed in any other loop: one user action, two
different outcomes depending on which loop happened to be open.

## Decision

`LoopContent` is now `Pick<Loop, LoopFlatKey>`, bound to `LOOP_FLAT_KEYS` at compile time, so a
`Loop` field that is neither slot identity nor flat content fails to compile.
`createDefaultLoopContent()` is the single source of per-loop defaults; slice factories read it
through a `defaults` parameter instead of repeating literals.

A key change is now the pure function `changeKey(content, target, { harmonizeChords })` in
`src/store/keyChange.ts`, operating over any `KeyChangeSource` — the flat `AppStore` or any
`Loop`. Melodies always follow; chords transpose (root) then snap (type) only when
`harmonizeChords` is true. Every setter that changes the key applies `changeKey` inside its own
`set()`, so key and chords land in one write. `autoReharmonize` and `reharmonizedIndicator` are
session-only store fields: the toggle gates whether a key-change write also harmonizes chords,
and the indicator is a badge raised by that same write. The badge clears wherever chords are
replaced wholesale: a vibe's single write (which calls `changeKey` with
`harmonizeChords: false`), `applyLoopCopy` with the `chord-progression` group, library apply, the
toggle being switched off, and the `reharmonizeNav.ts` subscription (loop switch, project
install). The key-delta bookkeeping the old effect needed to decide when to clear the badge is
gone — there is no delta to track because the badge is set and cleared entirely by whole-write
call sites.

**Rejected:**
- Keep the chord-view effect and add a second store-side path for non-active loops — two
  implementations of one rule, and the one that ran in a component effect could not run against
  an inactive loop's `Loop` at all.
- Move the active loop into `loops[]` so a single indexed write reaches everything — large
  churn across the codebase for no behavior the flat-`AppStore`-plus-`Pick` shape does not
  already provide.
- Persist `autoReharmonize` — it was never persisted before this change, and nothing in the
  spec calls for changing that.

## Consequences

Copying only the `key` group into the *active* loop no longer harmonizes its chords: this now
matches the already-existing behavior for a key-only copy into any other loop, and matches R144
(a loop-copy `key` group already transposed neither melody). A same-key vibe no longer leaves a
stale reharmonized badge behind, because the badge is scoped to a single write rather than a
delta computed after the fact. Any future batch key-change entry point can call `changeKey`
directly, per loop, without depending on which loop happens to be active or mounted.

## Rules this implies

- **R279** — A key change's chord harmonize runs only in `changeKey` (`store/keyChange.ts`),
  transpose then snap; never in a component effect.
- **R280** — `autoReharmonize` and `reharmonizedIndicator` are session-only store fields (not in
  `partializeAppState`, `PROJECT_CONTENT_KEYS` or `LOOP_FLAT_KEYS`); turning the toggle on
  rewrites nothing.
- **R281** — The badge clears only where chords are replaced wholesale: a vibe's single write,
  `applyLoopCopy` with `chord-progression`, library apply, toggle off, and the
  `reharmonizeNav.ts` subscription (loop change, project install).
- **R282** — `LoopContent` (`store/loop.ts`) is `Pick<Loop, LoopFlatKey>`; a loop is slot
  identity (`id`, `name`, `tempName`, `repeatCount`) plus content, and `loop.test.ts` fails to
  compile if a `Loop` field is neither.
- **R283** — `createDefaultLoopContent()` (`store/loopDefaults.ts`) is the only place a per-loop
  default is written; slices read it through their `defaults` parameter.

## Sources

Spec `docs/superpowers/specs/2026-09-22-loop-content-and-batch-key-design.md`; plan
`.superpowers/sdd/2026-09-22-dev-424-loop-content/`.
