# One Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **VOCABULARY NOTE — this file predates two renames, and one of them now means something else.**
> Everything below spells the scope kind `'solo'`: `{ kind: 'solo', loopId }`, "a soloing Arrange
> card". Phase 3 Task 1 renamed that kind to **`'loop'`**
> (`{ kind: 'loop', loopId }`, `scopedLoopId()`, "AUDITION" on the card badge) precisely because
> Phase 4 then added **track solo** — a different feature in a different slice (`soloTracks` in the
> ui slice, formula in `src/store/trackAudibility.ts`) — and one screen must not use the same word
> for playing one loop alone and for hearing one track alone. Read every `'solo'` below as the
> playback scope, never as `soloTracks`; `src/store/playbackScope.ts` is the shipped spelling.
> The store action is still called `soloLoop` — that name did not move, because two components
> call it. `transportDisplayState`'s shipped doc comment is the post-rename wording of the one
> quoted in Task 1.

**Goal:** Collapse the three per-tab play/stop buttons into the transport bar's single Play, so that starting playback always records what is sounding in `playbackScope`.

**Architecture:** The master Play becomes layer-aware. On the Song layer it keeps calling `playAll()` (scope → `song`). On the Loop layer it calls the existing `soloLoop(activeLoopId)` (scope → `solo{activeLoopId}`), which already starts every player and clears the song cursor in one `set()`. No new store action is added. The decision itself is extracted as a pure function next to the component, following the repo's existing `playerStop.ts` / `playbackStep.ts` precedent, because the repo has no testing-library setup and React behaviour is tested through `renderToString`.

**Tech Stack:** TypeScript, React 19, Zustand, Bun test runner, Vite, Tailwind + daisyUI.

**Spec:** `docs/superpowers/specs/2026-09-08-loop-song-ia-and-playback-continuity-design.md` (§5 One transport; §6's "Loop-layer play now carries a scope")

**Phase:** 1 of 4. The remaining phases — nav restructure, playback continuity, track solo — get their own plans. Phase 3 (continuity) depends on the invariant this phase establishes, and Phase 2 (nav) depends on `AUTOMATION_TABS` no longer mapping one tab to one `PlayerModule`.

## Global Constraints

- `bun run verify` is the completion gate for every task. It runs test + lint + eslint + check:keys + check:drums + check:contrast + check:levels + build.
- `bun run eslint` currently reports **nothing at all** — no errors and no warnings. That is the state to keep it in. A new `react-hooks/exhaustive-deps` or `complexity` warning must be silenced with a line disable naming its reason, not by relaxing the rule.
- Components in `src/components/` must not import `audio/engine`. Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx` and `ui/AmbientBackdrop.tsx` are exempt.
- Never call engine setters from a component. State goes in a slice and is wired in `src/store/engineSync.ts`.
- Nothing in this phase is persisted. Do not add keys to `partializeAppState` and do not move `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`.
- Branch: `refactor/one-transport`, cut from `main`. Feature work never lands as a commit made directly on `main`.
- Import style: `@/` alias for cross-directory imports; relative for siblings. The `../../` form is an eslint error.
- Type declarations use `interface`, not `type`, for object shapes (`consistent-type-definitions` is an error). Discriminated unions stay `type`.

---

### Task 1: `transportDisplayState` learns which loop the master button owns

`transportDisplayState` returns `'stopped'` whenever the scope is a solo, so that a soloing Arrange card leaves the master button offering Play as a one-click takeover. Once Loop-layer playback also uses the solo scope (Task 2), that rule would make the master button show Play while audio is sounding on the very page you are looking at. The rule has to narrow: the master button disowns a solo only when the solo is not the loop this page is editing.

**Files:**
- Modify: `src/store/transportSlice.ts:74-86` (the doc comment and the function)
- Test: `src/store/transportSlice.test.ts`

**Interfaces:**
- Consumes: `PlaybackScope` from `./playbackScope`, `PlayerState` from `./types`, `Layer` from `../types`.
- Produces: `transportDisplayState(scope: PlaybackScope, aggregate: PlayerState, layer: Layer, activeLoopId: string): PlayerState` — Task 2 calls it with these four arguments.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/transportSlice.test.ts`:

```ts
describe('transportDisplayState — which solo the master button owns', () => {
  it('shows the real player state while the loop layer plays the loop it is editing', () => {
    expect(
      transportDisplayState({ kind: 'solo', loopId: 'l1' }, 'playing', 'loop', 'l1'),
    ).toBe('playing');
  });

  it('still offers Play on the song layer while a card solos, so one click takes over', () => {
    expect(
      transportDisplayState({ kind: 'solo', loopId: 'l1' }, 'playing', 'song', 'l1'),
    ).toBe('stopped');
  });

  it('offers Play on the loop layer when the loop sounding is not the one being edited', () => {
    expect(
      transportDisplayState({ kind: 'solo', loopId: 'l1' }, 'playing', 'loop', 'l2'),
    ).toBe('stopped');
  });

  it('passes the aggregate through for the song and none scopes', () => {
    expect(transportDisplayState({ kind: 'song' }, 'playing', 'song', 'l1')).toBe('playing');
    expect(transportDisplayState({ kind: 'song' }, 'stopping', 'loop', 'l1')).toBe('stopping');
    expect(transportDisplayState({ kind: 'none' }, 'stopped', 'loop', 'l1')).toBe('stopped');
  });
});
```

If `transportDisplayState` is not already imported at the top of that test file, add it to the existing import from `./transportSlice`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/transportSlice.test.ts`
Expected: FAIL — TypeScript reports "Expected 2 arguments, but got 4", and the first case fails at runtime returning `'stopped'`.

- [ ] **Step 3: Widen the function**

Replace `src/store/transportSlice.ts:74-86` with:

```ts
/**
 * What the MASTER transport button shows. It disowns a solo it is not the
 * transport for: on the song layer every solo belongs to a loop card, so the
 * button presents as Play and one click TAKES OVER into song mode (spec:
 * "Transport Play All shows Stop only when kind === 'song'"). On the loop
 * layer the button IS the transport for the loop being edited, so that one
 * solo reports its real state — without this the button would offer Play
 * while its own page is sounding. A solo of some other loop stays disowned on
 * either layer.
 *
 * Hard stop is unaffected — it stays live off the real player states via
 * isHardStopEnabled, so soloing audio always has a visible global kill.
 */
export function transportDisplayState(
  scope: PlaybackScope,
  aggregate: PlayerState,
  layer: Layer,
  activeLoopId: string,
): PlayerState {
  if (scope.kind !== 'solo') return aggregate;
  return layer === 'loop' && scope.loopId === activeLoopId ? aggregate : 'stopped';
}
```

Add `import type { Layer } from '../types';` to the file's imports if it is not already there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/transportSlice.test.ts`
Expected: PASS, including every pre-existing test in the file. Any pre-existing call site inside the test file that passes two arguments must be updated to four — do that now rather than loosening the signature with optional parameters.

- [ ] **Step 5: Verify and commit**

```bash
bun run verify
git add src/store/transportSlice.ts src/store/transportSlice.test.ts
git commit -m "refactor(transport): the master button owns the solo of the loop it edits"
```

---

### Task 2: the master Play plays the focused loop on the Loop layer

**Files:**
- Create: `src/components/transportAction.ts`
- Create: `src/components/transportAction.test.ts`
- Modify: `src/components/TransportBar.tsx` (the `playAll` wiring at lines 29-31 and 66-78)

**Interfaces:**
- Consumes: `transportDisplayState(scope, aggregate, layer, activeLoopId)` from Task 1.
- Produces: `masterPlayTarget(layer: Layer): 'song' | 'loop'` — Task 3 does not use it; nothing else depends on it.

- [ ] **Step 1: Write the failing test**

Create `src/components/transportAction.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { masterPlayTarget } from './transportAction';

describe('masterPlayTarget', () => {
  it('runs the arrangement from the song layer', () => {
    expect(masterPlayTarget('song')).toBe('song');
  });

  it('runs the loop being edited from the loop layer', () => {
    expect(masterPlayTarget('loop')).toBe('loop');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/transportAction.test.ts`
Expected: FAIL — "Cannot find module './transportAction'".

- [ ] **Step 3: Write the helper**

Create `src/components/transportAction.ts`:

```ts
import type { Layer } from '@/types';

/**
 * What the single master Play starts, given the layer it is pressed on.
 *
 * Kept as a pure function rather than an inline ternary in TransportBar for
 * the same reason as playerStop.ts: the repo has no testing-library setup, so
 * a decision that has to be asserted is a decision that lives outside the
 * component. The two results map to the two store actions that already exist
 * — playAll() for 'song', soloLoop(activeLoopId) for 'loop' — so this phase
 * adds no transport action of its own.
 */
export function masterPlayTarget(layer: Layer): 'song' | 'loop' {
  return layer === 'song' ? 'song' : 'loop';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/transportAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into TransportBar**

In `src/components/TransportBar.tsx`, add to the existing store reads near lines 29-31:

```tsx
const soloLoop = useAppStore((s) => s.soloLoop);
const activeLoopId = useAppStore((s) => s.activeLoopId);
const activeTab = useAppStore((s) => s.activeTab);
```

Add the imports `import { layerForTab } from '@/types';` and `import { masterPlayTarget } from './transportAction';`, then above the returned JSX:

```tsx
const layer = layerForTab(activeTab);
const onPlay = () => {
  if (masterPlayTarget(layer) === 'song') {
    playAll();
    return;
  }
  soloLoop(activeLoopId);
};
```

Change the `PlayerTransport` at line 69 to pass `onPlay={onPlay}` instead of `onPlay={playAll}`, and update its `state` prop to pass the two new arguments `transportDisplayState` now takes: `layer` and `activeLoopId`.

- [ ] **Step 6: Verify and commit**

```bash
bun run verify
git add src/components/transportAction.ts src/components/transportAction.test.ts src/components/TransportBar.tsx
git commit -m "feat(transport): the master Play starts the focused loop on the loop layer"
```

---

### Task 3: remove the per-tab play/stop buttons

**Files:**
- Modify: `src/components/Header.tsx:25-29` (`AUTOMATION_TABS`), `:215` (the `play` store read), `:308-328` (the loop-layer tab buttons)
- Modify: `src/components/viewMeta.test.ts` (the "Header covers every view" test reads `AUTOMATION_TABS`)
- Test: `src/components/Header.test.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `AUTOMATION_TABS: readonly ViewMode[]` — Phase 2's nav restructure edits this list. The `{ view, module }` object shape is gone; it is now a flat list of views, the same shape `SONG_NAV_TABS` already has.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Header.test.tsx`:

```tsx
import { AUTOMATION_TABS, SONG_NAV_TABS } from './Header';

describe('nav tab groups', () => {
  it('lists loop-layer views as plain view ids, with no player module attached', () => {
    expect(AUTOMATION_TABS).toEqual(['synth', 'chords', 'sequencer']);
  });

  it('keeps the two layer groups disjoint', () => {
    const overlap = AUTOMATION_TABS.filter((view) => SONG_NAV_TABS.includes(view));
    expect(overlap).toEqual([]);
  });
});
```

Merge the import with the file's existing import from `./Header` if one is already present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/Header.test.tsx`
Expected: FAIL — the received value is `[{ view: 'synth', module: 'lead' }, ...]`.

- [ ] **Step 3: Flatten the list and drop the buttons**

In `src/components/Header.tsx`, replace lines 25-29 with:

```ts
/** The three loop-layer tabs. Playback is the transport bar's single Play —
 *  see docs/superpowers/plans/2026-09-08-one-transport.md — so a tab no longer
 *  owns a PlayerModule and no longer carries its own play/stop pair. */
export const AUTOMATION_TABS: readonly ViewMode[] = ['synth', 'chords', 'sequencer'];
```

Then in the loop-layer tab loop at lines 308-328: change `AUTOMATION_TABS.map((tab) => ...)` to map over view ids directly (`tab.view` becomes `view`), and delete the `PlayerTransport` element together with the `play`, `softStop` and per-module player-state reads that only it used. Delete the now-unused `play` read at line 215 and any import — `PlayerTransport`, `PlayerModule` — left with no remaining use in the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/Header.test.tsx src/components/viewMeta.test.ts`
Expected: PASS. `viewMeta.test.ts`'s "Header covers every view across its two tab groups" reads `AUTOMATION_TABS.map(t => t.view)` today and must be changed to read the flat list; it is the only other reader of the old shape.

- [ ] **Step 5: Verify and commit**

```bash
bun run verify
git add src/components/Header.tsx src/components/Header.test.tsx src/components/viewMeta.test.ts
git commit -m "refactor(nav): drop the per-tab play/stop pairs and the tab-to-module map"
```

---

### Task 4: lock the invariant this phase exists to create

Every later phase reads the scope alone to answer "what is sounding". That is only sound if playback can never run unscoped. `play(module)` still has two callers — `store/loadLoop.ts:115-117` and `store/vibes.ts:194-196` — and both are actually holes, not exceptions: each calls `hardStopAll()` first, which resets the scope to `none`, then restarts whatever was active with `play(module)`, which sets no scope, so both CAN leave players `'playing'` under a `none` scope (documented as an open invariant gap in `playbackScope.ts`'s INVARIANT comment; closing it is Phase 3's decision, out of scope here). What this task actually locks is narrower: a test pins that `playAll`, `soloLoop`, `hardStopAll` and `softStopAll` — the transport actions that are supposed to keep the scope in sync — do so, and a source-scan guard (`playbackScope.test.ts`) pins the `play(module)` caller list at exactly these two documented sites, so a future third caller fails the suite instead of quietly breaking Phase 3.

**Files:**
- Test: `src/store/transportSlice.test.ts`

**Interfaces:**
- Consumes: `playAll`, `soloLoop`, `softStopAll`, `hardStopAll` from the store; `SCOPE_NONE` from `./playbackScope`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `src/store/transportSlice.test.ts`:

```ts
describe('playing implies a scope', () => {
  const playing = (s: ReturnType<typeof useAppStore.getState>) =>
    s.sequencerPlayer === 'playing' || s.chordsPlayer === 'playing' || s.leadPlayer === 'playing';

  it('never leaves a player playing while the scope is none', () => {
    useAppStore.getState().hardStopAll();
    expect(playing(useAppStore.getState())).toBe(false);

    useAppStore.getState().playAll();
    expect(playing(useAppStore.getState())).toBe(true);
    expect(useAppStore.getState().playbackScope.kind).not.toBe('none');

    useAppStore.getState().hardStopAll();
    useAppStore.getState().soloLoop(useAppStore.getState().activeLoopId);
    expect(playing(useAppStore.getState())).toBe(true);
    expect(useAppStore.getState().playbackScope.kind).toBe('solo');

    useAppStore.getState().hardStopAll();
    expect(useAppStore.getState().playbackScope).toBe(SCOPE_NONE);
  });
});
```

Import `useAppStore` from `./store` and `SCOPE_NONE` from `./playbackScope` if the file does not already.

- [ ] **Step 2: Run the test**

Run: `bun test src/store/transportSlice.test.ts`
Expected: PASS on the first run. This test documents behaviour Tasks 1-3 already produce; it is a regression lock, not a driver. If it fails, one of the three earlier tasks is wrong — fix that task rather than the assertion.

- [ ] **Step 3: Record the invariant where the next reader will hit it**

Add to the doc comment at the top of `src/store/playbackScope.ts`, after the description of the three kinds:

```
 * INVARIANT, locked by transportSlice.test.ts: while any player is 'playing'
 * the scope is never 'none'. Loop-layer playback goes through soloLoop, so
 * `none` means stopped on both layers. Phase 3's focus-loop rule reads the
 * scope alone to decide what survives a navigation, which is only sound
 * while this holds — a new caller of play(module) that starts a stopped
 * player without setting a scope breaks it.
```

- [ ] **Step 4: Verify and commit**

```bash
bun run verify
git add src/store/transportSlice.test.ts src/store/playbackScope.ts
git commit -m "test(transport): lock 'playing implies a scope' before phase 3 depends on it"
```

---

### Task 5: the transport bar names what Play will start

Spec §5: "The transport bar shows what the play button will play (`Loop A` or `Song`)." With one button for two scopes, the button needs a label or the user cannot tell which they are about to get. The `SOLO · … ×` chip from the same spec paragraph is Phase 4 and is not built here.

**Files:**
- Modify: `src/components/TransportBar.tsx`
- Test: `src/components/transportAction.test.ts`

**Interfaces:**
- Consumes: `masterPlayTarget(layer)` from Task 2.
- Produces: `playTargetLabel(layer: Layer, activeLoopName: string): string`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/transportAction.test.ts`:

```ts
import { playTargetLabel } from './transportAction';

describe('playTargetLabel', () => {
  it('names the arrangement on the song layer', () => {
    expect(playTargetLabel('song', 'Loop 2')).toBe('Song');
  });

  it('names the loop being edited on the loop layer', () => {
    expect(playTargetLabel('loop', 'Loop 2')).toBe('Loop 2');
  });

  it('falls back to a generic word rather than rendering an empty label', () => {
    expect(playTargetLabel('loop', '')).toBe('Loop');
  });
});
```

Merge the import with the file's existing import from `./transportAction`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/transportAction.test.ts`
Expected: FAIL — "playTargetLabel is not a function".

- [ ] **Step 3: Add the helper**

Append to `src/components/transportAction.ts`:

```ts
/**
 * What the master Play will start, as a word next to the button. A loop whose
 * name has been cleared still gets a label — an empty string beside a play
 * button reads as a rendering bug, not as an unnamed loop.
 */
export function playTargetLabel(layer: Layer, activeLoopName: string): string {
  if (layer === 'song') return 'Song';
  return activeLoopName.trim() === '' ? 'Loop' : activeLoopName;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/transportAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the label**

In `src/components/TransportBar.tsx`, add the store read — selecting the **name**, not the loops array, so that editing any loop field does not re-render the always-mounted transport bar:

```tsx
const activeLoopName = useAppStore(
  (s) => s.loops.find((loop) => loop.id === s.activeLoopId)?.name ?? '',
);
```

Import `playTargetLabel` alongside `masterPlayTarget`, and render it immediately after the `PlayerTransport` at line 69:

```tsx
<span className="text-xs text-base-content/70 whitespace-nowrap">
  {playTargetLabel(layer, activeLoopName)}
</span>
```

- [ ] **Step 6: Verify and commit**

```bash
bun run verify
git add src/components/transportAction.ts src/components/transportAction.test.ts src/components/TransportBar.tsx
git commit -m "feat(transport): name what the master Play will start"
```

---

## Manual check before opening the PR

`bun run verify` does not press buttons. Run `bun run dev` and confirm, in this order:

1. On the Loop layer, the three tabs have no play/stop buttons.
2. Press the transport bar's Play on the Loop layer — audio starts and the button shows Stop. This is the case the old `transportDisplayState` got wrong.
3. Switch to Song › Arrange while it plays. Audio stops, as it does today; continuity is Phase 3, not this phase.
4. On Arrange, press a loop card's play. The master button offers Play, not Stop — the one-click takeover is unchanged.
5. Press the master Play from there. The arrangement takes over.
