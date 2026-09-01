# Implementation plan — PlaybackScope (solo vs. song)

Spec: `docs/superpowers/specs/2026-09-01-playback-scope-redesign.md`
Branch: `fix/playback-scope` (off `main` at `99185e6`)

Replace `auditionLoopId: string | null` with an explicit union so the stuck state cannot be
represented, and move the transition logic into a pure reducer with its own tests.

```ts
type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  | { kind: 'solo'; loopId: string };
```

---

## Global constraints

Binding on every task. A task is not done until all of these hold.

- **Runtime is Bun.** `bun run verify` (= `bun test` + `tsc --noEmit` + `check:keys` +
  `check:drums` + `build`) is the completion gate and must be green at every commit.
- **`bun run verify` does NOT run eslint.** Every task must additionally run `bun run eslint`
  separately — unused imports and dead variables pass the gate unnoticed otherwise. Both tasks
  that delete code (Task 3) and tasks that add imports (Tasks 2–4) will trip it if sloppy.
- **Three layers, enforced by eslint `no-restricted-imports`:** `src/audio/` imports neither
  `store/` nor `components/`; `src/store/` never imports `components/`; `src/components/` never
  imports `audio/engine` (exempt: `AudioVisualizer.tsx`, `ui/VuMeter.tsx`,
  `ui/AmbientBackdrop.tsx`, and test files). Nothing in this plan touches `src/audio/`.
  `src/store/playbackScope.ts` is a **leaf module with zero imports**; keep it that way.
- **Tests are `bun:test`. No DOM, no testing-library, and none may be added.** Prefer pure-logic
  tests over rendered ones (`.claude/rules/testing.md` style 1). `renderToString` from
  `react-dom/server` is normal (29 of 92 files use it) and returns an HTML **string**; assertions
  are single literal substrings covering several classes at once, which proves the classes sit on
  the *same* element.
- **The zustand + `renderToString` trap.** zustand serves `getServerSnapshot` from
  `api.getInitialState()` — the object captured **once at store creation**. A plain
  `useAppStore((s) => ...)` therefore renders creation-time values under `renderToString`, so
  `useAppStore.setState(...)` before a render has **no effect**, silently, and nothing in
  `bun run verify` catches it. `ArrangeView` reads the store this way and is **not** the
  `useLiveStore` pattern of `ui/BottomInputDock.tsx`. **Consequence for this plan: no scope-driven
  UI assertion may be written by setting the store and rendering `<ArrangeView />`.** Scope UI is
  tested (a) purely, via `loopPlayButton` / `transportDisplayState`, and (b) by rendering
  `<SortableLoopCard {...props} />` directly with props, which is how
  `src/components/song/SortableLoopCard.test.tsx` already works.
- **Effects do not run under `renderToString` at all** — `ArrangeView`'s
  `subscribePlaybackClock` effect never fires in tests; do not write a test that depends on it.
- **No npm dependency** may be added. **No `tailwind.config.*`.**
- **`scripts/themeTokenGuard.ts`'s ALLOWLIST is empty and stays empty.** Components name roles
  (`btn-error`, `btn-success`, `badge-accent`, `disabled:opacity-30`), never colours. The new
  disabled state reuses the exact class string already used by
  `btn-loop-delete-*` (`disabled:opacity-30`).
- **Every test must fail when the source is mutated.** Each task below names at least one source
  mutation that must turn a specific test red. A test that passes with and without the change is
  a defect — verify the mutation, then revert it.
- **No persist migration.** `auditionLoopId` is not in `partializeAppState`
  (`src/store/store.ts` — the allow-list is bpm, meterId, masterVolume, metronomeActive,
  selectedVibeId, controlTarget, effects, customSynthPresets, customChordProgressions, loops,
  activeLoopId), and `playbackScope` must not be added to it either. **Do not bump `version: 7`**
  and do not add a step to `migrate`. Confirmed by reading `partializeAppState`; this is also
  exactly why the user's step 1 ("refresh, then Play All works") works today.
- **`persist` has no throttle** — every `set()` touching a partialized key writes
  `localStorage` synchronously. `playbackScope` is transient, so scope writes cost nothing;
  keep it out of `partialize` for that reason too.

---

## Two design decisions, decided here — do not re-open during implementation

### 1. `PlaybackScope` lives in the **transport slice**, not a new slice

`playbackScope` is added to `TransportSlice` in `src/store/types.ts` and initialised in
`createTransportSlice`. The *type* and the *reducer* live in a new leaf module
`src/store/playbackScope.ts`; only the state field and the actions live in the slice.

**Reason.** Every scope transition must land in the *same* `set()` call as the player-state
transition it accompanies — `playAll` flips three player fields and the scope atomically, and
`soloLoop` flips three player fields, the scope, and `songLoopIndex` atomically. A separate slice
would force cross-slice `get()` plus a second `set()` per transport action, and each intermediate
`set()` synchronously fires `songMode`'s `subscribeWithSelector` subscription against a state
where the scope and the players disagree. That two-writer split is precisely the shape that
produced this bug; a second slice would rebuild it. The store composes slices into one flat
object anyway, so a separate slice buys namespacing only.

### 2. `songLoopIndex` stays a **separate field**, demoted to a pure cursor

It does **not** fold into the `'song'` variant.

**Reason.** `songLoopIndex` is re-derived by four call sites that have nothing to do with playback
mode — `deleteLoop`, `reorderLoops`, `reorderLoopsArray` (all in `src/store/loopSlice.ts`) and
`loadLoop` (`src/store/loadLoop.ts`) — each doing index arithmetic against a *new* `loops` array
so the cursor keeps pointing at the active loop. Folding it into the variant would force all four
to destructure and rebuild a `PlaybackScope`, spreading scope-writing back across four files and
re-creating the multi-writer shape decision 1 removes, and would churn roughly ten assertions in
`src/store/loopSlice.test.ts` for zero behavioural gain. The reducer would also acquire a second
responsibility (cursor arithmetic over `loops`), which would stop the transition table from being
the whole test.

The safety property is preserved by a rule instead: **`playbackScope` is the only source of truth
for playback *mode*; `songLoopIndex` is only ever a cursor.** After this refactor no code may read
`songLoopIndex !== null` as "song mode is on". The four re-derivation sites read it only as "if a
cursor exists, keep it valid", which is mode-free and stays exactly as written.

### 2b. What `{ kind: 'none' }` means — read this before touching `songMode.ts`

`'none'` is **unscoped**, not "stopped". Song advance is gated on **`kind !== 'solo'`**, not on
`kind === 'song'`.

This is load-bearing. `src/store/loadLoop.ts` restarts playback with the per-module
`store.play('sequencer' | 'chords' | 'lead')` primitive, so `play(module)` is a *restart*
mechanism, not a user intent — it must **not** dispatch a scope action, or clicking a card row
(`handleSelectLoop` → `loadLoop`) while soloing would flip solo → song. The existing test
`songMode.test.ts > 're-entering song mode re-enters at the active loop'` starts song mode with a
bare `play('sequencer')` and pins this: song mode must engage from a per-module play. Gating on
`kind !== 'solo'` preserves it exactly (it is today's `!s.auditionLoopId` gate, made explicit) and
keeps every existing `songMode` test passing unchanged.

`kind === 'song'` therefore means specifically "**Play All** owns the transport", and that is what
disables the loop-card buttons.

---

## The pure reducer — the core of the change

`src/store/playbackScope.ts`, a leaf module with **no imports**.

### Transition table (this table is the test)

Actions: `play-all` (master transport Play, including takeover), `stop-all` (master soft **or**
hard stop), `toggle-loop(id)` (a loop card's own play/stop button), `layer-change` (crossing the
loop/song layer boundary).

| from ↓ \ action → | `play-all` | `stop-all` | `toggle-loop(A)` | `toggle-loop(B)` | `layer-change` |
| --- | --- | --- | --- | --- | --- |
| `none`   | `song`               | `none` *(identity)*        | `solo A`     | `solo B`                   | `none` *(identity)* |
| `song`   | `song` *(identity)*  | `none`                     | `song` *(identity, unreachable)* | `song` *(identity, unreachable)* | `none` |
| `solo A` | `song` **(takeover)**| `none`                     | `none` *(stop)* | `solo A` *(identity, unreachable)* | `none` |

**Identity means the same object reference is returned**, not an equal one. `songMode`'s
subscription compares scopes by `===`, so a no-op transition must not allocate.

Two rows are marked *unreachable*: while `kind === 'song'` every card button is `disabled`, and
while `kind === 'solo'` every card except the soloing one is `disabled`. The reducer is still
**total** and answers them with **identity**. Rule: *a button the UI disables is also a no-op in
the reducer*, so a stray programmatic call can never produce a state the UI offers no exit from.
Pin both unreachable cells with tests — they are the cheapest guard against a future caller
inventing a transition.

`layer-change` carries no payload and always yields `none` in both directions, because
`songMode`'s `reconcile` hard-stops every player on **either** crossing.

### The code

```ts
/**
 * The single source of truth for playback MODE.
 *
 *   none — unscoped. Nothing owns the transport; song advance is still allowed
 *          (a per-module play in the song layer runs the arrangement), but no
 *          card is soloing and no card button is disabled.
 *   song — Play All owns the transport. Every loop-card button is disabled.
 *   solo — one loop is auditioned in isolation. Song advance is suppressed;
 *          that card shows Stop and every other card button is disabled.
 *
 * The three are mutually exclusive by construction, which is the whole point:
 * the old `auditionLoopId: string | null` could sit non-null underneath a
 * running Play All, and nothing but a page refresh cleared it.
 *
 * `songLoopIndex` is NOT part of this union — it is a pure cursor into loops[]
 * (see the plan's decision 2). Never read its null-ness as a mode.
 */
export type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  | { kind: 'solo'; loopId: string };

export type PlaybackScopeAction =
  /** Master transport Play — starts the song, and TAKES OVER from a solo. */
  | { type: 'play-all' }
  /** Master transport soft or hard stop. */
  | { type: 'stop-all' }
  /** A loop card's own play/stop button. */
  | { type: 'toggle-loop'; loopId: string }
  /** Crossing the loop/song layer boundary (either direction). */
  | { type: 'layer-change' };

/**
 * Frozen singletons: the reducer must be reference-stable for no-op
 * transitions, because songMode's subscribeWithSelector equality compares
 * scopes with === and would otherwise re-run reconcile on every stop.
 */
export const SCOPE_NONE: PlaybackScope = Object.freeze({ kind: 'none' as const });
export const SCOPE_SONG: PlaybackScope = Object.freeze({ kind: 'song' as const });

/**
 * The whole transition logic, in one total pure function. Every cell of the
 * table in docs/superpowers/plans/2026-09-01-playback-scope.md is pinned by
 * playbackScope.test.ts.
 */
export function playbackScopeReducer(
  scope: PlaybackScope,
  action: PlaybackScopeAction,
): PlaybackScope {
  switch (action.type) {
    case 'play-all':
      // Takeover: from a solo this is one click, not two. Disabling the
      // transport instead would leave audio sounding with no visible global
      // stop once the soloing card scrolls out of view.
      return scope.kind === 'song' ? scope : SCOPE_SONG;
    case 'stop-all':
    case 'layer-change':
      return scope.kind === 'none' ? scope : SCOPE_NONE;
    case 'toggle-loop':
      if (scope.kind === 'solo') {
        // Same card again = stop. A different card is unreachable (disabled).
        return scope.loopId === action.loopId ? SCOPE_NONE : scope;
      }
      // Unreachable while the song owns the transport (cards are disabled).
      if (scope.kind === 'song') return scope;
      return { kind: 'solo', loopId: action.loopId };
  }
}

/** The soloing loop's id, or null. The one accessor views should need. */
export function soloLoopId(scope: PlaybackScope): string | null {
  return scope.kind === 'solo' ? scope.loopId : null;
}

/**
 * A loop card's own play/stop button, derived from the scope alone. Pure so it
 * can be tested without a DOM — the store cannot be observed through a
 * renderToString of ArrangeView (see the plan's Global Constraints).
 */
export function loopPlayButton(
  scope: PlaybackScope,
  loopId: string,
): { mode: 'play' | 'stop'; disabled: boolean } {
  if (scope.kind === 'song') return { mode: 'play', disabled: true };
  if (scope.kind === 'solo')
    return scope.loopId === loopId
      ? { mode: 'stop', disabled: false }
      : { mode: 'play', disabled: true };
  return { mode: 'play', disabled: false };
}
```

---

## Tasks

Five tasks. Each is independently committable, leaves `bun run verify` green **and**
`bun run eslint` clean, and leaves the app in a self-consistent state (never half-migrated).
Ordering rule used: **add the new mechanism inert → make it authoritative in one commit →
then layer the presentational rules on top.**

---

### Task 1 — the pure reducer and its transition-table tests

Inert: nothing imports it yet. Behaviour unchanged; the bug is still present after this commit.

**Files**
- new `src/store/playbackScope.ts` — exactly the code in the section above.
- new `src/store/playbackScope.test.ts`.

**Interfaces exported:** `PlaybackScope`, `PlaybackScopeAction`, `SCOPE_NONE`, `SCOPE_SONG`,
`playbackScopeReducer`, `soloLoopId`, `loopPlayButton`. No imports in the module.

**Test.** Drive the table as data, so a new cell cannot be added without a row:

```ts
import { describe, expect, test } from 'bun:test';
import {
  loopPlayButton,
  playbackScopeReducer,
  SCOPE_NONE,
  SCOPE_SONG,
  soloLoopId,
  type PlaybackScope,
  type PlaybackScopeAction,
} from './playbackScope';

const SOLO_A: PlaybackScope = { kind: 'solo', loopId: 'A' };

const PLAY_ALL: PlaybackScopeAction = { type: 'play-all' };
const STOP_ALL: PlaybackScopeAction = { type: 'stop-all' };
const LAYER: PlaybackScopeAction = { type: 'layer-change' };
const TOGGLE_A: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'A' };
const TOGGLE_B: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'B' };

// Every cell of the plan's transition table, as data.
const TABLE: Array<[PlaybackScope, PlaybackScopeAction, PlaybackScope]> = [
  [SCOPE_NONE, PLAY_ALL, { kind: 'song' }],
  [SCOPE_NONE, STOP_ALL, { kind: 'none' }],
  [SCOPE_NONE, TOGGLE_A, { kind: 'solo', loopId: 'A' }],
  [SCOPE_NONE, TOGGLE_B, { kind: 'solo', loopId: 'B' }],
  [SCOPE_NONE, LAYER, { kind: 'none' }],

  [SCOPE_SONG, PLAY_ALL, { kind: 'song' }],
  [SCOPE_SONG, STOP_ALL, { kind: 'none' }],
  [SCOPE_SONG, TOGGLE_A, { kind: 'song' }],
  [SCOPE_SONG, TOGGLE_B, { kind: 'song' }],
  [SCOPE_SONG, LAYER, { kind: 'none' }],

  [SOLO_A, PLAY_ALL, { kind: 'song' }],
  [SOLO_A, STOP_ALL, { kind: 'none' }],
  [SOLO_A, TOGGLE_A, { kind: 'none' }],
  [SOLO_A, TOGGLE_B, { kind: 'solo', loopId: 'A' }],
  [SOLO_A, LAYER, { kind: 'none' }],
];

describe('playbackScopeReducer', () => {
  for (const [from, action, expected] of TABLE) {
    const label = from.kind === 'solo' ? `solo(${from.loopId})` : from.kind;
    const act = action.type === 'toggle-loop' ? `toggle-loop(${action.loopId})` : action.type;
    test(`${label} + ${act} -> ${expected.kind === 'solo' ? `solo(${expected.loopId})` : expected.kind}`, () => {
      expect(playbackScopeReducer(from, action)).toEqual(expected);
    });
  }

  // The bug, stated as an invariant: no action can leave a solo id behind
  // under a song, and none can produce a solo the user did not ask for.
  test('play-all takes over from a solo — a solo id can never survive it', () => {
    expect(playbackScopeReducer(SOLO_A, PLAY_ALL)).toEqual({ kind: 'song' });
    expect(soloLoopId(playbackScopeReducer(SOLO_A, PLAY_ALL))).toBe(null);
  });

  test('no-op transitions return the identical object (songMode compares by ===)', () => {
    expect(playbackScopeReducer(SCOPE_NONE, STOP_ALL)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_NONE, LAYER)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_SONG, PLAY_ALL)).toBe(SCOPE_SONG);
    expect(playbackScopeReducer(SOLO_A, TOGGLE_B)).toBe(SOLO_A);
  });
});

describe('loopPlayButton', () => {
  test('unscoped: every card offers Play', () => {
    expect(loopPlayButton(SCOPE_NONE, 'A')).toEqual({ mode: 'play', disabled: false });
  });
  test('song scope disables every card button', () => {
    expect(loopPlayButton(SCOPE_SONG, 'A')).toEqual({ mode: 'play', disabled: true });
    expect(loopPlayButton(SCOPE_SONG, 'B')).toEqual({ mode: 'play', disabled: true });
  });
  test('solo: the soloing card shows Stop, the others are disabled', () => {
    expect(loopPlayButton(SOLO_A, 'A')).toEqual({ mode: 'stop', disabled: false });
    expect(loopPlayButton(SOLO_A, 'B')).toEqual({ mode: 'play', disabled: true });
  });
});
```

**Verification:** `bun test src/store/playbackScope.test.ts`, then `bun run verify` and
`bun run eslint`.

**Mutation check (must go red):** change `case 'play-all'` to `return scope` — the
`solo(A) + play-all -> song` row and the takeover invariant test both fail. Change the
`toggle-loop` solo branch to `return { kind: 'solo', loopId: action.loopId }` — the
`solo(A) + toggle-loop(A) -> none` row fails. Revert both.

---

### Task 2 — `playbackScope` enters the transport slice (still not read by anyone)

The slice gains the field and dispatches the reducer atomically with the player transitions.
`auditionLoopId` is left in place and remains the authoritative field for `songMode` and
`ArrangeView`, so behaviour at this commit is **identical to today**, bug included.

**Files:** `src/store/types.ts`, `src/store/transportSlice.ts`, `src/store/transportSlice.test.ts`.

**`src/store/types.ts`** — in `TransportSlice`, keep `songLoopIndex` / `setSongLoopIndex` /
`auditionLoopId` / `setAuditionLoopId` exactly as they are and add:

```ts
import type { PlaybackScope } from './playbackScope';
```
```ts
  /**
   * Transient (never persisted): the single source of truth for playback MODE.
   * `songLoopIndex` beside it is a pure CURSOR — never read its null-ness as a
   * mode. See src/store/playbackScope.ts.
   */
  playbackScope: PlaybackScope;
  /** A loop card's own play/stop button: solo the loop, or stop the solo. */
  soloLoop: (loopId: string) => void;
```

**`src/store/transportSlice.ts`** — extract the body of `transitionAll` into a pure patch builder
so a scope change and a player change can share one `set()`. Add above `createTransportSlice`:

```ts
/**
 * The player half of an all-players transition, as a pure patch. Extracted so
 * playAll / softStopAll / hardStopAll / soloLoop can each fold the player patch
 * and the PlaybackScope patch into ONE set() — an intermediate set() would fire
 * songMode's subscription against a state where the scope and the players
 * disagree, which is the two-writer shape this refactor exists to remove.
 */
function allPlayersPatch(
  state: AppStore,
  next: (current: PlayerState) => PlayerState,
): Partial<AppStore> {
  const patch: Partial<AppStore> = {};
  (Object.keys(FIELD) as PlayerModule[]).forEach((module) => {
    const field = FIELD[module];
    const current = state[field];
    const target = next(current);
    if (target !== current) patch[field] = target;
  });
  return patch;
}

/**
 * What the MASTER transport button shows. While a loop is soloing the master
 * button presents as Play, so clicking it TAKES OVER into song mode in one
 * click (spec: "Transport Play All shows Stop only when kind === 'song'").
 * Hard stop is unaffected — it stays live off the real player states via
 * isHardStopEnabled, so soloing audio always has a visible global kill.
 */
export function transportDisplayState(
  scope: PlaybackScope,
  aggregate: PlayerState,
): PlayerState {
  return scope.kind === 'solo' ? 'stopped' : aggregate;
}
```

Rewrite the closure `transitionAll` as `(next) => set((state) => allPlayersPatch(state, next))`,
then replace the three master actions and add `soloLoop`:

```ts
    playbackScope: SCOPE_NONE,

    playAll: () =>
      set((state) => ({
        ...allPlayersPatch(state, (current) => (current === 'stopped' ? 'playing' : current)),
        playbackScope: playbackScopeReducer(state.playbackScope, { type: 'play-all' }),
      })),
    softStopAll: () =>
      set((state) => ({
        ...allPlayersPatch(state, (current) => (current === 'playing' ? 'stopping' : current)),
        playbackScope: playbackScopeReducer(state.playbackScope, { type: 'stop-all' }),
      })),
    hardStopAll: () =>
      set((state) => ({
        ...allPlayersPatch(state, () => 'stopped'),
        playbackScope: playbackScopeReducer(state.playbackScope, { type: 'stop-all' }),
      })),

    /**
     * A loop card's own play/stop button. Starting a solo also drops the song
     * cursor, in the same set() — the two can never be observed disagreeing.
     * The caller (ArrangeView) is responsible for loadLoop-ing the target
     * FIRST, because loadLoop hard-stops and restarts whatever was playing.
     */
    soloLoop: (loopId) =>
      set((state) => {
        const scope = playbackScopeReducer(state.playbackScope, { type: 'toggle-loop', loopId });
        if (scope === state.playbackScope) return {};
        return scope.kind === 'solo'
          ? {
              playbackScope: scope,
              songLoopIndex: null,
              ...allPlayersPatch(state, (current) => (current === 'stopped' ? 'playing' : current)),
            }
          : { playbackScope: scope, ...allPlayersPatch(state, () => 'stopped') };
      }),
```

Imports to add at the top of `transportSlice.ts`:
```ts
import { playbackScopeReducer, SCOPE_NONE } from './playbackScope';
import type { PlaybackScope } from './playbackScope';
```

Note `transitionAll` keeps its remaining callers; if none survive, delete it — `bun run eslint`
will say so, `bun run verify` will not.

**Tests** (`src/store/transportSlice.test.ts`, using the existing `makeSlice` harness, which backs
`set`/`get` with a plain object and therefore exercises the slice without a store):

```ts
  test('playAll starts stopped players AND claims the song scope in one set', () => {
    const h = makeSlice();
    h.state.playAll();
    expect(h.state.sequencerPlayer).toBe('playing');
    expect(h.state.playbackScope).toEqual({ kind: 'song' });
  });

  test('playAll takes over from a solo — the solo id cannot survive it', () => {
    const h = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    h.state.playAll();
    expect(h.state.playbackScope).toEqual({ kind: 'song' });
  });

  test('soft and hard stop both clear the scope', () => {
    const soft = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    soft.state.softStopAll();
    expect(soft.state.playbackScope).toEqual({ kind: 'none' });
    const hard = makeSlice({ playbackScope: { kind: 'song' } });
    hard.state.hardStopAll();
    expect(hard.state.playbackScope).toEqual({ kind: 'none' });
  });

  test('soloLoop starts the players, claims the solo and drops the song cursor', () => {
    const h = makeSlice({ songLoopIndex: 2 });
    h.state.soloLoop('loop-a');
    expect(h.state.playbackScope).toEqual({ kind: 'solo', loopId: 'loop-a' });
    expect(h.state.songLoopIndex).toBe(null);
    expect(h.state.sequencerPlayer).toBe('playing');
    expect(h.state.chordsPlayer).toBe('playing');
    expect(h.state.leadPlayer).toBe('playing');
  });

  test('soloLoop on the soloing loop stops every player immediately', () => {
    const h = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    h.state.soloLoop('loop-a');
    expect(h.state.playbackScope).toEqual({ kind: 'none' });
    expect(h.state.sequencerPlayer).toBe('stopped');
    expect(h.state.chordsPlayer).toBe('stopped');
    expect(h.state.leadPlayer).toBe('stopped');
  });

  test('per-module play never touches the scope (loadLoop restarts through it)', () => {
    const h = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    h.state.play('sequencer');
    expect(h.state.playbackScope).toEqual({ kind: 'solo', loopId: 'loop-a' });
  });

  test('transportDisplayState presents Play while soloing so Play All takes over', () => {
    expect(transportDisplayState({ kind: 'solo', loopId: 'a' }, 'playing')).toBe('stopped');
    expect(transportDisplayState({ kind: 'song' }, 'playing')).toBe('playing');
    expect(transportDisplayState({ kind: 'none' }, 'stopping')).toBe('stopping');
  });
```

**Verification:** `bun test src/store/transportSlice.test.ts`, then `bun run verify` +
`bun run eslint`. Manual smoke: the app behaves exactly as before (the bug still reproduces) —
that is the expected state at this boundary.

**Mutation check:** drop `playbackScope:` from `hardStopAll`'s patch — "soft and hard stop both
clear the scope" fails. Make `play(module)` dispatch `play-all` — "per-module play never touches
the scope" fails.

---

### Task 3 — the scope becomes authoritative; `auditionLoopId` is deleted

The behaviour-changing commit. The bug is fixed here.

**Files:** `src/store/songMode.ts`, `src/components/song/ArrangeView.tsx`,
`src/store/types.ts`, `src/store/transportSlice.ts`, `src/store/songMode.test.ts`.

**`src/store/types.ts` / `src/store/transportSlice.ts`:** delete `auditionLoopId` and
`setAuditionLoopId` from the interface, the initial state and the setters. Keep `songLoopIndex`
and `setSongLoopIndex` untouched.

**`src/store/songMode.ts`** — four reads change; nothing else in the file moves.

In `reconcile`, the layer-boundary block:
```ts
    if (prevLayer !== null && prevLayer !== layer) {
      s.hardStopAll();
      s.setSongLoopIndex(null);
      s.dispatchPlaybackScope({ type: 'layer-change' });
      stopClock();
      unsubClock = null;
    }
```
Rather than add a `dispatchPlaybackScope` action to the slice for one caller, prefer: **drop that
line entirely.** `hardStopAll()` already dispatches `stop-all`, and the table shows
`stop-all` and `layer-change` are the same transition from every state, so the layer rule is
already enforced — and it is stated executably by the three `layer-change` rows in
`playbackScope.test.ts`. Replacing `s.setAuditionLoopId(null)` with nothing is correct; say so in
a comment so the next reader does not think it was forgotten:

```ts
      // hardStopAll dispatches 'stop-all', which resets the scope to 'none' —
      // the reducer's layer-change rows are the same transition, so crossing a
      // layer boundary can never preserve a solo. (This is where the old
      // auditionLoopId was cleared, and the ONLY place it ever was.)
```

The song-mode gate:
```ts
    if (layer === 'song' && playing && s.playbackScope.kind !== 'solo') {
```
The clock-callback guard:
```ts
          if (cur.songLoopIndex === null || cur.playbackScope.kind === 'solo') return;
```
The cursor-drop branch:
```ts
    } else if ((layer !== 'song' || s.playbackScope.kind === 'solo') && s.songLoopIndex !== null) {
```
The subscription selector and its equality fn:
```ts
      scope: state.playbackScope,
```
```ts
        a.scope === b.scope,
```
(`===` is why the reducer returns identity on no-ops — Task 1's identity test guards this.)

Gating on `kind !== 'solo'` rather than `kind === 'song'` is deliberate; see decision 2b. Every
existing `songMode` test then passes **unchanged**, including the one that enters song mode via a
bare `play('sequencer')`.

**`src/components/song/ArrangeView.tsx`** — seven reads change.

Replace the selector `const auditionLoopId = useAppStore((s) => s.auditionLoopId);` with:
```ts
  const playbackScope = useAppStore((s) => s.playbackScope);
```
Add the import `import { loopPlayButton, playbackScopeReducer, soloLoopId } from '../../store/playbackScope';`
(components may import `store/`; only `audio/engine` is off-limits).

Derivations:
```ts
  const soloId = soloLoopId(playbackScope);

  const playingId =
    soloId ??
    (songLoopIndex !== null && loops[songLoopIndex] ? loops[songLoopIndex].id : activeLoopId);
```

`handleTogglePlayLoop` becomes:
```ts
  const handleTogglePlayLoop = useCallback((id: string) => {
    const s = useAppStore.getState();
    const next = playbackScopeReducer(s.playbackScope, { type: 'toggle-loop', loopId: id });
    // Disabled buttons are no-ops in the reducer too; nothing to do.
    if (next === s.playbackScope) return;
    // Order matters: loadLoop hard-stops every player and restarts only what
    // was already playing, so it must run BEFORE soloLoop starts them.
    if (next.kind === 'solo') loadLoop(id);
    useAppStore.getState().soloLoop(id);
  }, []);
```
This replaces the old `loadLoop(id); s.playAll(); useAppStore.setState({ auditionLoopId: id,
songLoopIndex: null })` three-write sequence with one `loadLoop` plus one atomic `set()`.

Per-card flags inside the `loops.map`:
```ts
              const isAuditioning = isPlaying && soloId === loop.id;
              const isSongPlaying = isPlaying && soloId === null && loop.id === playingId;
              const playButton = loopPlayButton(playbackScope, loop.id);
```
(`soloId === null` is the exact translation of today's `auditionLoopId === null`; do **not**
narrow it to `kind === 'song'` here or a per-module play in the song layer stops highlighting the
sounding card.)

`playButton` is passed to the card in Task 4; adding it in Task 3 would be an unused variable that
`bun run eslint` rejects, so **compute it in Task 4, not here**.

**Tests.** In `src/store/songMode.test.ts`:
- rename the existing test `'auditionLoopId keeps playback isolated…'` to
  `'a solo scope keeps playback isolated and suppresses song advance'` and rewrite its setup: drop
  `auditionLoopId: 'loop-default-1'` from the `setState`, and replace the `playAll()` call with
  `useAppStore.getState().soloLoop('loop-default-1')`. The assertions (`songLoopIndex` stays
  `null`; `clock.tick(64)` leaves `activeLoopId` on `loop-default-1`) stay as they are.
- add the regression test the spec asks for — **this is the executable form of the user's repro**:

```ts
  test('solo, stop, then Play All advances the arrangement — the solo cannot survive', async () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: null,
    });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    // 2. Play one loop from its card.
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().playbackScope).toEqual({
      kind: 'solo',
      loopId: 'loop-default-1',
    });

    useAppStore.getState().hardStopAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'none' });

    // 3. Every later Play All must run the arrangement, with no refresh.
    useAppStore.getState().playAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    clock.tick(64);
    await new Promise((r) => setTimeout(r, 0)); // songMode defers loadLoop to a microtask
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    stop();
  });
```

The `await` is required: `songMode` defers `loadLoop` with `queueMicrotask` so the clock reset
does not land mid-dispatch — the existing `'re-entering song mode…'` test uses the same
`setTimeout(r, 0)`.

Also update `resetState` in `songMode.test.ts` and `resetStore` in
`src/components/song/ArrangeView.test.tsx` to add `playbackScope: { kind: 'none' }` beside the
existing `songLoopIndex: null`, so the suite stays order-independent (bun runs every test file in
one process without isolation).

**Verification:** `bun test src/store src/components/song`, then `bun run verify` +
`bun run eslint`. Grep must come back empty:
`grep -rn "auditionLoopId\|setAuditionLoopId" src scripts` → no matches.

**Mutation check:** restore the `!s.auditionLoopId`-equivalent bug by changing `hardStopAll` to
skip the scope patch — the new regression test fails at `activeLoopId` still being
`loop-default-1`. Change the song-mode gate to `s.playbackScope.kind === 'song'` — the existing
`'re-entering song mode re-enters at the active loop'` test fails at its
`play('sequencer')` step, which is the guard for decision 2b.

---

### Task 4 — the UI rules: takeover button, disabled cards, SOLO badge

Purely presentational; the store is already correct.

**Files:** `src/components/TransportBar.tsx`, `src/components/song/ArrangeView.tsx`,
`src/components/song/SortableLoopCard.tsx`, `src/components/TransportBar.test.tsx`,
`src/components/song/SortableLoopCard.test.tsx`.

**`TransportBar.tsx`** — the master transport presents as Play while soloing, so clicking it takes
over. `PlayerTransport`'s own `onClick` is `state === 'playing' ? onSoftStop : onPlay`, so
presenting `'stopped'` routes the click to `playAll` with no extra wiring, and `playAll`'s
`play-all` action performs the takeover:

```ts
  const playbackScope = useAppStore((s) => s.playbackScope);
```
```ts
  const aggregate = aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer);
  // While a loop is soloing the master button offers Play (a one-click
  // takeover). Hard stop stays live off the REAL player states, so soloing
  // audio always has a visible global kill even if the card is scrolled away.
  const displayState = transportDisplayState(playbackScope, aggregate);
  const hardStopDisabled = !isHardStopEnabled(sequencerPlayer, chordsPlayer, leadPlayer);
  const isPlaying = aggregate !== 'stopped';
```
and pass `state={displayState}` to `<PlayerTransport id="btn-bottom-transport" …>`. Leave
`isPlaying` on the true aggregate — it drives the VU meter loop, which must keep running while a
solo sounds. Import `transportDisplayState` from `../store/transportSlice` (which already supplies
`aggregatePlayerState` and `isHardStopEnabled` to this file).

**`ArrangeView.tsx`** — compute and forward the per-card button state:
```ts
              const playButton = loopPlayButton(playbackScope, loop.id);
```
```tsx
                  playDisabled={playButton.disabled}
```

**`SortableLoopCard.tsx`** — add to the props interface, beside `isAuditioning?: boolean`:
```ts
  /** Scope rule: disabled while the song owns the transport, and on every
   *  non-soloing card while another loop is soloing. */
  playDisabled?: boolean;
```
destructure `playDisabled = false`, and on the `btn-loop-play-${loop.id}` button add:
```tsx
                disabled={playDisabled}
```
and append `disabled:opacity-30` to its `className` (the same role-named class
`btn-loop-delete-*` already uses for its disabled state — no new colour token, so
`bun run check:theme` stays green with its empty ALLOWLIST).

The SOLO badge and the Stop label already key on `isAuditioning`, which Task 3 rewired to
`soloId === loop.id`; no change is needed there, and that is the point — the badge now renders
only for `kind === 'solo'` by construction.

**Tests.**
- `SortableLoopCard.test.tsx` (props-driven `renderToString`, no store — the only way to assert
  this, per the Global Constraints trap):

```tsx
  test('the play button is disabled when the scope forbids it', () => {
    const html = renderToString(<SortableLoopCard {...baseProps} playDisabled />);
    expect(html).toContain('disabled:opacity-30');
    expect(html).toContain('disabled');
  });

  test('the soloing card shows Stop and the SOLO badge, and is not disabled', () => {
    const html = renderToString(<SortableLoopCard {...baseProps} isPlaying isAuditioning />);
    expect(html).toContain('badge badge-sm badge-accent');
    expect(html).toContain('Solo ');
    expect(html).toContain('btn btn-xs gap-1 font-bold shadow-xs transition-all btn-error');
  });

  test('a non-soloing card shows no SOLO badge', () => {
    const html = renderToString(<SortableLoopCard {...baseProps} isPlaying />);
    expect(html).not.toContain('badge-accent');
  });
```
  Reuse the file's existing props factory rather than inventing a second one; the third
  assertion is a single literal covering several classes at once, matching house style.
  A bare `toContain('disabled')` is weak on its own — pair it with the `disabled:opacity-30`
  literal and confirm the negative case (`playDisabled={false}` → the class is absent) so the
  test cannot pass vacuously.

- `TransportBar.test.tsx`: assert `transportDisplayState` purely (Task 2 already covers the three
  cases; here add the composition that matters) —
  `expect(transportDisplayState({ kind: 'solo', loopId: 'a' }, 'playing')).toBe('stopped')` and
  then `resolveTransportButtons('stopped').main.label === 'Play'`, proving the rendered master
  button offers Play while soloing. Do **not** try to prove this by `setState` + rendering
  `<TransportBar />`; the file's own header note already records which cases cannot be exercised
  through a rendered component.

**Verification:** `bun test src/components`, `bun run verify`, `bun run eslint`,
`bun run check:theme`.

**Mutation check:** remove `disabled={playDisabled}` from the card button — the disabled test
fails. Change `transportDisplayState` to `return aggregate` — the takeover composition test fails.

---

### Task 5 — acceptance

No source change unless the acceptance run finds one. Commit only test/doc adjustments.

**Full gate:** `bun run verify` **and** `bun run eslint` **and** `bun run check:theme`, all green,
output pasted into the commit or the task note. Then
`grep -rn "auditionLoopId" src scripts docs/superpowers/plans` → matches only in this plan and the
spec, never in `src/`.

**Manual acceptance test — verbatim from the spec** (`bun run build && bunx vite preview`, fresh
profile / cleared `localStorage`, an arrangement of at least three loops with distinct chord
content, Arrange tab):

> 1. Refresh the page, press Play All first thing → **works correctly**, the arrangement advances.
> 2. Play any single loop from its card once.
> 3. Every subsequent Play All plays that one loop solo, **until the page is refreshed**.

**Step 3 must stop happening.** The pass criterion: after step 2, pressing the master transport's
Play must take over — the SOLO badge disappears, the card shows "Playing N/M" not "Solo N/M", and
`activeLoopId` advances loop 1 → loop 2 → loop 3 with **no page refresh**. Watch the per-card
badges in `SortableLoopCard` for this; `playbackScope` and `songLoopIndex` are transient and never
reach `localStorage`, so the DOM badge is the instrument (the spec's browser repro used exactly
this method, polling `localStorage['musibox_project_state_v1'].state.activeLoopId` for the
persisted half).

Also confirm the three UI rules by eye, since no automated test spans them end to end:
1. While one loop solos, the other cards' play buttons are visibly disabled and the master
   transport shows **Play**, while its hard-stop (`btn-bottom-transport-hard`) stays enabled.
2. While Play All runs, **every** card's play button is disabled.
3. Clicking the soloing card's own **Stop** silences everything and re-enables the other cards.

Kill the preview server when done; leave `git status` clean apart from the intended commits.

---

## Blast radius — files touched, and files deliberately not touched

**Touched:** `src/store/playbackScope.ts` (new), `src/store/playbackScope.test.ts` (new),
`src/store/types.ts`, `src/store/transportSlice.ts`, `src/store/transportSlice.test.ts`,
`src/store/songMode.ts`, `src/store/songMode.test.ts`, `src/components/song/ArrangeView.tsx`,
`src/components/song/ArrangeView.test.tsx`, `src/components/song/SortableLoopCard.tsx`,
`src/components/song/SortableLoopCard.test.tsx`, `src/components/TransportBar.tsx`,
`src/components/TransportBar.test.tsx`.

**Not touched, on purpose:**
- `src/store/loopSlice.ts` — its three `songLoopIndex` re-derivations are cursor maintenance, not
  mode (decision 2). `src/store/loopSlice.test.ts` needs no edit.
- `src/store/loadLoop.ts` — same reason; its `songLoopIndex` recompute is cursor maintenance, and
  its `store.play(module)` restarts must stay scope-free (decision 2b).
- `src/store/store.ts` — `partializeAppState`, `version: 7` and `migrate` are all unchanged.
- `src/store/engineSync.ts` — the `resetClock` subscription reads player states, not the scope.
- Anything under `src/audio/`.
