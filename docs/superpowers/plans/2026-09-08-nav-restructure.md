# Nav Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three loop-layer tabs into two — `Sound` and `Pattern` — split by the rule *changes the sound but not the notes → Sound; changes the notes or the rhythm → Pattern*, with Pattern carrying three segments and Sound carrying one five-track mixer.

**Architecture:** `ViewMode` becomes `'sound' | 'pattern' | 'arrange' | 'master'`. The Pattern segment is a second, independent ui-slice axis (`patternSegment: 'lead' | 'accompaniment' | 'beat'`), not a fifth view id, so the router keeps validating exactly one query key. Almost every change is a *move*: `SynthView`'s body becomes Sound, `ChordView` and `SequencerView`'s Pattern card become two of Pattern's three segments, and the lead grid moves from Sound to Pattern. The two genuinely new pieces of UI are the segment row and the mixer; the mixer's shape is copied from `SortableLoopCard`'s existing `LOOP_MIX_CHANNELS` table but bound to the live slice fields instead of a per-loop `LoopMixPatch`.

**Tech Stack:** TypeScript, React 19, Zustand, Bun test runner, Vite, Tailwind v4 + daisyUI (CSS-first themes, no `tailwind.config.*`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-09-08-loop-song-ia-and-playback-continuity-design.md` — §2 (Navigation), §3 (the Accompaniment group frame), Out of scope, Implementation order item 2.

**Phase:** 2 of 4. Phase 1 (`docs/superpowers/plans/2026-09-08-one-transport.md`) has landed: `AUTOMATION_TABS` is already a flat `readonly ViewMode[]` with no `module` field, which is the precondition this phase needed. Phase 3 (playback continuity) and Phase 4 (track solo) follow and are not touched here.

## Global Constraints

- `bun run verify` is the completion gate for every task. It runs `test + lint + eslint + check:keys + check:drums + check:contrast + check:levels + build`.
- `bun run eslint` currently reports **nothing at all** — no errors and no warnings. That is the state to keep it in. A new `react-hooks/exhaustive-deps` or `complexity` warning must be silenced with a line disable naming its reason, never by relaxing the rule.
- The four-layer import chain is eslint-enforced: `src/data/` → `src/audio/` → `src/store/` → `src/components/`. `src/utils/` sits outside it, above `data/`, and `components/` may import it freely.
- Components in `src/components/` **must not import `audio/engine`**, and must **never call an engine setter**. State goes in a slice and is wired in `src/store/engineSync.ts`. This phase adds no engine-settable state at all.
- All four tab views stay mounted simultaneously (`activeTab` toggles `block`/`hidden` in `App.tsx`), so **any** store subscription re-renders every mounted view. No high-frequency value — a playback step, a value mid-drag — may enter a slice. `patternSegment` is a click-rate value and is safe.
- Nothing in this phase is persisted. Do not add a key to `partializeAppState`, and do not move `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`. Per the spec's Out of scope: "No persist `version` or `.solna` `formatVersion` move: nothing new is persisted, and `activeTab` was never persisted."
- `interface` for object shapes (`consistent-type-definitions` is an error); `type` only for unions.
- Import style: `@/` for cross-directory imports, relative for siblings. `../../` is an eslint error. `React.FC` is banned.
- Theming: name **roles**, never colours. `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes, `text-white`/`bg-black`, the `dark:` variant, `rgb()` literals and dead utilities (`xs:`, `z-60`, `scale-102`, `py-0.2`). Its `ALLOWLIST` is empty and must stay empty. Every new class in this plan is a daisyUI or theme-token class for exactly this reason.
- Testing: `bun:test`, **no DOM and no testing-library**, and none may be added. **This repo's `bun:test` typings do not export `it` — write `test(...)`, never `it(...)`.** Rendered-markup tests use `renderToString` from `react-dom/server` and assert with substring checks.
- The zustand + `renderToString` trap: a plain `useAppStore((s) => ...)` serves the store's **creation-time** state under `renderToString`, so `useAppStore.setState(...)` before a render has no effect. Every assertion in this plan that needs non-default state is written against a pure exported helper or a prop, never against a rendered store read.
- Branch: `refactor/nav-restructure`, cut from `main`. Feature work never lands as a commit made directly on `main`.
- Every task ends green under `bun run verify` and is committed. **The app must be usable at every commit — no task may leave a tab that renders nothing.**

---

## File Structure

**Renamed**
- `src/components/loop/SynthView.tsx` → `src/components/loop/SoundView.tsx` (Task 5). Everything the file already exports travels with it; the exported component is renamed `SynthView` → `SoundView`.
- `src/components/loop/SynthView.test.tsx` → `src/components/loop/SoundView.test.tsx` (Task 5).

**Created**
- `src/components/loop/PatternView.tsx` (Task 5) — the Pattern tab: the segment row plus the three always-mounted segments.
- `src/components/ui/SegmentHeader.tsx` (Task 5) — `ViewHeader`'s sibling for a Pattern segment; both become thin wrappers over one shared header card.
- `src/components/loop/SoundMixer.tsx` (Task 7) — the single five-track mixer.
- `src/components/loop/SoundMixer.test.tsx` (Task 7).
- `src/components/ui/GroupFrame.tsx` (Task 8) — the neutral Accompaniment frame.
- `src/components/ui/GroupFrame.test.tsx` (Task 8).

**Modified**
- `src/types.ts` — `ViewMode`, `LOOP_TABS`, `SONG_TABS`, `isSongLayer`; new `PatternSegment` union.
- `src/routing/tabRouting.ts:11-13` — `defaultTabForLayer`.
- `src/store/uiSlice.ts:45,56` — defaults and setters; `src/store/types.ts:314,329` — `UiSlice`.
- `src/components/viewMeta.ts` — `VIEW_ORDER`, `VIEW_META`, new `PATTERN_SEGMENTS`.
- `src/components/Header.tsx:23` — `AUTOMATION_TABS`; new exported `PatternSegmentRow`.
- `src/components/loop/LoopPage.tsx` — renders the two new views.
- `src/components/loop/ChordView.tsx`, `src/components/loop/SequencerView.tsx` — headers become segment headers; the Drum Sound card and the mute toggles leave.
- `src/components/loop/chord/{Chord,Bass,Pad}ModulePanel.tsx` — each loses its `ChannelStrip`.
- `src/components/song/ArrangeView.tsx:32,41-42` — the deep-link target.
- `src/components/ui/ViewHeader.tsx` — the shared header card is extracted out of it.

**Tests modified**
`src/routing/tabRouting.test.ts`, `src/components/viewMeta.test.ts`, `src/components/Header.test.tsx`, `src/store/store.test.ts:182,478-484`, `src/store/songMode.test.ts` (5 `setActiveTab` call sites at lines 248, 271, 274, 290, 310), `src/store/projectSlice.test.ts:104,113`, `src/components/loop/SequencerView.test.tsx:26,32,47`, `src/components/appChildMemo.test.tsx:7-8,57-58`, `src/components/song/ArrangeView.test.tsx`.

---

### Task 1: `ViewMode` becomes the four new ids

This is the rename that everything else stands on, and it has to land in one commit because `ViewMode` is a closed union: a half-renamed union does not type-check, so there is no smaller green step. The interesting part is what does **not** need doing. `activeTab` is not in `partializeAppState` (`src/store/store.ts:182-198`, and `src/store/store.test.ts:478-484` positively asserts it is excluded), so no persisted payload anywhere contains a view id and there is nothing to sanitize or migrate. And a stale bookmark carrying `?tab=synth` already resolves correctly today: `resolveRoute` (`src/routing/tabRouting.ts:36-38`) validates the raw tab against `tabsForLayer(layer).includes(...)` and silently falls back to `defaultTabForLayer(layer)`, setting `needsNormalize` so `useRouteSync` rewrites the URL. **That normalisation is the whole of this rename's migration story** — a link from before this change lands on Sound with a tidied URL rather than a blank page. This task pins that with a test instead of adding any new validation, because new validation for a case the router already handles is dead code with nothing forcing it to stay honest.

The loop layer temporarily renders `SynthView` for `sound` and **`ChordView` and `SequencerView` stacked** for `pattern`. Stacked, not one of the two: any other interim strands one of the three existing views' content behind no reachable tab for the length of a commit, which breaks the "usable at every commit" rule. Task 5 replaces the stack with the real segmented `PatternView`.

**Files:**
- Modify: `src/types.ts:2-16` (`ViewMode`, `LOOP_TABS`, `SONG_TABS`, `isSongLayer`)
- Modify: `src/routing/tabRouting.ts:11-13` (`defaultTabForLayer`)
- Modify: `src/store/uiSlice.ts:45` (the default)
- Modify: `src/components/loop/LoopPage.tsx:11-13`
- Modify: `src/components/song/SongPage.tsx:10-11`
- Modify: `src/components/song/ArrangeView.tsx:32,41-42`
- Modify: `src/components/loop/SynthView.tsx:398` (`paused={activeTab !== 'synth'}`)
- Test: `src/routing/tabRouting.test.ts`, `src/store/store.test.ts:182`, `src/store/songMode.test.ts`, `src/store/projectSlice.test.ts:104,113`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type ViewMode = 'sound' | 'pattern' | 'arrange' | 'master'`; `LOOP_TABS: readonly ViewMode[] = ['sound', 'pattern']`; `SONG_TABS: readonly ViewMode[] = ['arrange', 'master']`; `defaultTabForLayer('loop') === 'sound'`. Every later task uses these four ids and no others.

- [ ] **Step 1: Write the failing routing tests**

Replace the first two tests in `src/routing/tabRouting.test.ts:7-21` with these, and replace the two `resolveRoute` tests at `:30-43`:

```ts
test('isSongLayer is true only for arrange and master', () => {
  expect(isSongLayer('arrange')).toBe(true);
  expect(isSongLayer('master')).toBe(true);
  expect(isSongLayer('sound')).toBe(false);
  expect(isSongLayer('pattern')).toBe(false);
});

test('layerForTab maps the four tabs to loop or song', () => {
  expect(layerForTab('sound')).toBe('loop');
  expect(layerForTab('pattern')).toBe('loop');
  expect(layerForTab('arrange')).toBe('song');
  expect(layerForTab('master')).toBe('song');
});

test('resolveRoute normalizes a missing or layer-mismatched tab to the layer default', () => {
  expect(resolveRoute('/loop', '?tab=pattern').tab).toBe('pattern');
  expect(resolveRoute('/loop', '').tab).toBe('sound');             // missing tab → default
  expect(resolveRoute('/loop', '?tab=arrange').tab).toBe('sound'); // arrange on loop layer → default
  expect(resolveRoute('/song', '?tab=master').tab).toBe('master');
  expect(resolveRoute('/song', '?tab=pattern').tab).toBe('arrange'); // pattern on song layer → default
});

test('resolveRoute reports needsNormalize for wrong path, wrong tab, or loopId on song layer', () => {
  expect(resolveRoute('/', '?tab=sound').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=arrange').needsNormalize).toBe(true);
  expect(resolveRoute('/song', '?tab=arrange&loopId=x').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=sound').needsNormalize).toBe(false);
});

/**
 * THE MIGRATION STORY, in one test. `activeTab` is not persisted (see
 * partializeAppState in store/store.ts and its exclusion assertion in
 * store.test.ts), so the only place an old view id can survive this rename is
 * a bookmark or a pasted link. resolveRoute already validates ?tab against the
 * layer's own tab list and falls back to the layer default, flagging
 * needsNormalize so useRouteSync rewrites the URL. No sanitize path, no
 * persist version move, and deliberately no new "legacy id" table: a mapping
 * from ids nothing produces any more would be dead code with no test forcing
 * it to stay honest.
 */
test('a bookmark from before the rename lands on the layer default, tidied', () => {
  for (const stale of ['synth', 'sequencer', 'chords']) {
    const route = resolveRoute('/loop', `?tab=${stale}`);
    expect(route.tab).toBe('sound');
    expect(route.needsNormalize).toBe(true);
  }
  const staleSong = resolveRoute('/song', '?tab=effects');
  expect(staleSong.tab).toBe('arrange');
  expect(staleSong.needsNormalize).toBe(true);
});

/**
 * The Arrange → loop-editor deep link (ArrangeView.buildEditRoute) hard-codes
 * its tab. Pinned here so the literal and the router's own default cannot
 * drift into disagreeing — a deep link that needed normalising would burn a
 * history entry on every click.
 */
test('the loop-editor deep link targets the loop layer default', () => {
  expect(buildRouteUrl('loop', defaultTabForLayer('loop'), 'abc')).toBe(
    '/loop?tab=sound&loopId=abc',
  );
});
```

Update the remaining literals in that file: `:46-47` `parseLoopId('?tab=synth&loopId=abc')` → `'?tab=sound&loopId=abc'` and `parseLoopId('?tab=synth')` → `'?tab=sound'`; `:51` expects `'/loop?tab=sound&loopId=abc'`. Add `defaultTabForLayer` to the existing import from `./tabRouting` at `:3-5`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/routing/tabRouting.test.ts`
Expected: FAIL — TypeScript rejects `isSongLayer('master')` and `layerForTab('sound')` because those strings are not in `ViewMode` yet.

- [ ] **Step 3: Rename the union and its two tab lists**

Replace `src/types.ts:2-16` with:

```ts
/**
 * The four tabs, two per layer. The loop layer's split is a rule, not a
 * grouping of what happened to exist: changes the SOUND but not the notes →
 * `sound`; changes the NOTES or the rhythm → `pattern`. Oscillator, filter,
 * envelopes, LFO, arpeggiator, the preset library and the faders are Sound;
 * chord progression, chord rhythm, bass pattern, drum grid and drum kit are
 * Pattern. `arrange` now means one thing only — ordering loops — and nothing
 * else may take that name.
 *
 * Pattern's three segments are a SECOND axis (`patternSegment` in the ui
 * slice), not three more view ids: the router validates exactly one query key,
 * and a segment is a within-tab position, not a route.
 */
export type ViewMode =
  | 'sound'
  | 'pattern'
  | 'arrange'
  | 'master';

export type Layer = 'loop' | 'song';

export const LOOP_TABS: readonly ViewMode[] = ['sound', 'pattern'];
export const SONG_TABS: readonly ViewMode[] = ['arrange', 'master'];

export function isSongLayer(tab: ViewMode): boolean {
  return tab === 'arrange' || tab === 'master';
}
```

Leave `layerForTab` at `:18-20` exactly as it is, and **leave `ArrangementTrackType` at `:22` alone** — it reuses the spelling `'chords'` but is an arrangement track kind, not a view id.

- [ ] **Step 4: Point the router and the slice default at `sound`**

`src/routing/tabRouting.ts:11-13`:

```ts
export function defaultTabForLayer(layer: Layer): ViewMode {
  return layer === 'song' ? 'arrange' : 'sound';
}
```

`src/store/uiSlice.ts:45`: `activeTab: 'synth',` → `activeTab: 'sound',`.

- [ ] **Step 5: Point the two page shells and the deep link at the new ids**

`src/components/loop/LoopPage.tsx` — replace the whole component body. Pattern renders both remaining views stacked so that no view's content becomes unreachable for the length of this commit; Task 5 replaces the stack:

```tsx
export const LoopPage = React.memo(function LoopPage() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'sound' ? 'block' : 'hidden'}><SynthView /></div>
      {/* INTERIM (Task 1 of the nav restructure): Pattern stacks the two
          note-editing views so nothing goes unreachable while the real
          segmented PatternView is built in Task 5. */}
      <div className={activeTab === 'pattern' ? 'block' : 'hidden'}>
        <ChordView />
        <SequencerView />
      </div>
    </>
  );
});
```

`src/components/song/SongPage.tsx:10-11`: `activeTab === 'effects'` → `activeTab === 'master'`.

`src/components/song/ArrangeView.tsx:32` and `:41`: replace `buildRouteUrl('loop', 'synth', id)` with `buildRouteUrl('loop', 'sound', id)` in both, and `:42` `setActiveTab('synth')` → `setActiveTab('sound')`.

`src/components/loop/SynthView.tsx:398`: `paused={activeTab !== 'synth'}` → `paused={activeTab !== 'sound'}`.

- [ ] **Step 6: Chase the remaining type errors**

Run: `bun run lint`

Fix each reported site. The ones known to exist:
- `src/components/viewMeta.ts:25,28-36` — `VIEW_ORDER` and `VIEW_META` still key the old five. As a **temporary** measure only, key `VIEW_META` on the four new ids reusing the old rows' icons and labels verbatim (`sound` takes `synth`'s `Sliders`/`'Synth/Lead'`, `pattern` takes `sequencer`'s `Grid`/`'Beat Step'`, `arrange` and `master` keep `LayoutList`/`AudioWaveform`), and set `VIEW_ORDER = ['sound', 'pattern', 'arrange', 'master'] as const`. Task 3 chooses the real labels; this step only has to compile and render something truthful enough to click.
- `src/components/Header.tsx:23,26` — `AUTOMATION_TABS` → `['sound', 'pattern']`, `SONG_NAV_TABS` → `['arrange', 'master']`.
- `src/components/loop/ChordView.tsx:565` and `src/components/loop/SequencerView.tsx:195` — both pass `view="chords"` / `view="sequencer"` to `ViewHeader`. Temporarily pass `view="pattern"` to both; Task 5 replaces both with `SegmentHeader`.
- `src/components/loop/SynthView.tsx:249` — `view="synth"` → `view="sound"`.

Then run `grep -rn "'synth'\|'sequencer'\|'chords'\|'effects'" src --include='*.ts' --include='*.tsx'` and check each remaining hit **by hand**. Most are not view ids and must not be touched: `SynthControlTarget` (`'synth' | 'chord' | 'bass' | 'pad'` — every hit in `SynthView.tsx`, `utils/synthControl.ts` and the module panels), `StepPlayerId` (`'sequencer'` in `SequencerGrid`/`playbackStep`), `PlayerModule` (`'sequencer' | 'chords' | 'lead'`), the audio source-bus names, and `ArrangementTrackType`'s `'chords'`. If a hit is not passed to `setActiveTab`, compared to `activeTab`, or handed to `buildRouteUrl`/`ViewHeader`/`VIEW_META`, leave it.

- [ ] **Step 7: Update the store and song-mode tests**

- `src/store/store.test.ts:182`: `expect(s.activeTab).toBe('synth')` → `toBe('sound')`.
- `src/store/songMode.test.ts` — five call sites: `:248`, `:271`, `:310` are `setActiveTab('synth')` → `setActiveTab('sound')`; `:274` and `:290` are `setActiveTab('arrange')` and are unchanged.
- `src/store/projectSlice.test.ts:104` `activeTab: 'effects'` → `activeTab: 'master'`, and `:113` `expect(s.activeTab).toBe('effects')` → `toBe('master')`.
- `src/components/viewMeta.test.ts:7,9,32` and `src/components/Header.test.tsx:93,97-98,109-110,130,136-156,216` all assert the old five literally. Update them to the four new ids now so the suite is green; Task 3 and Task 4 rewrite the same assertions for the final labels.

- [ ] **Step 8: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "refactor(nav): ViewMode becomes sound/pattern/arrange/master"
```

---

### Task 2: `patternSegment` in the ui slice

Pattern needs a within-tab position, and it has to be store state rather than `useState` inside `PatternView` for one reason: the segment row and the three segments are siblings, so a local `useState` would have to be lifted to their common parent anyway — and `PatternView` is exactly that parent, which makes it look like a fair fight until you notice `PatternSegmentRow` is nav chrome that belongs with the other nav chrome in `Header.tsx`. The slice is also what lets a later phase (or a vibe, or a deep link) put the user on a segment without threading a prop. It is a click-rate value, so it does not violate the "no high-frequency state in a slice" rule; it is a session position, so it stays out of `partializeAppState` for the same reason `activeTab` does.

**Files:**
- Modify: `src/types.ts` (add `PatternSegment` immediately after `Layer`)
- Modify: `src/store/types.ts:314,329` (the `UiSlice` interface)
- Modify: `src/store/uiSlice.ts:45,56` (the default and the setter)
- Modify: `src/components/viewMeta.ts` (add `PATTERN_SEGMENTS`)
- Test: `src/store/store.test.ts`, `src/components/viewMeta.test.ts`

**Interfaces:**
- Consumes: `ViewMode` from Task 1.
- Produces:
  - `type PatternSegment = 'lead' | 'accompaniment' | 'beat'` (from `src/types.ts`)
  - `UiSlice.patternSegment: PatternSegment` (default `'lead'`) and `UiSlice.setPatternSegment: (segment: PatternSegment) => void`
  - `PATTERN_SEGMENTS: ReadonlyArray<{ id: PatternSegment; label: string; title: string; icon: LucideIcon }>` from `src/components/viewMeta.ts`. Tasks 4 and 5 both iterate it.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/store.test.ts`:

```ts
describe('patternSegment', () => {
  test('starts on lead — the segment a new loop is most likely to be opened for', () => {
    expect(useAppStore.getState().patternSegment).toBe('lead');
  });

  test('the setter moves it and nothing else', () => {
    useAppStore.getState().setPatternSegment('beat');
    expect(useAppStore.getState().patternSegment).toBe('beat');
    expect(useAppStore.getState().activeTab).toBe('sound');
    useAppStore.getState().setPatternSegment('lead');
  });
});
```

And extend the existing excluded-keys assertion at `src/store/store.test.ts:478-484` by adding `'patternSegment'` to the `excludedKeys` array, directly after `'activeTab'`. That is the guard that keeps it out of the persist blob: a within-tab position is no more composition data than the active tab is.

Append to `src/components/viewMeta.test.ts`:

```ts
describe('PATTERN_SEGMENTS', () => {
  test('lists the three segments in the order the row renders them', () => {
    expect(PATTERN_SEGMENTS.map((s) => s.id)).toEqual(['lead', 'accompaniment', 'beat']);
  });

  test('every segment has its own icon, and none collides with a view icon', () => {
    const segmentIcons = PATTERN_SEGMENTS.map((s) => s.icon);
    expect(new Set(segmentIcons).size).toBe(PATTERN_SEGMENTS.length);
    const viewIcons = new Set(VIEW_ORDER.map((v) => VIEW_META[v].icon));
    for (const icon of segmentIcons) expect(viewIcons.has(icon)).toBe(false);
  });

  test('labels and titles are unique and non-empty', () => {
    const labels = PATTERN_SEGMENTS.map((s) => s.label);
    const titles = PATTERN_SEGMENTS.map((s) => s.title);
    expect(new Set(labels).size).toBe(PATTERN_SEGMENTS.length);
    expect(new Set(titles).size).toBe(PATTERN_SEGMENTS.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(titles.every((t) => t.trim().length > 0)).toBe(true);
  });
});
```

Add `PATTERN_SEGMENTS` to the existing import from `./viewMeta` at `src/components/viewMeta.test.ts:2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/store.test.ts src/components/viewMeta.test.ts`
Expected: FAIL — `setPatternSegment is not a function`, and `PATTERN_SEGMENTS` is not exported.

- [ ] **Step 3: Add the union**

In `src/types.ts`, immediately after `export type Layer = 'loop' | 'song';`:

```ts
/**
 * Pattern's three segments. A second axis alongside `ViewMode`, not three more
 * view ids: the URL carries the tab, and a segment is a position inside one
 * tab. Kept here rather than in store/types.ts because both the store and the
 * components read it, exactly as `ViewMode` is.
 */
export type PatternSegment = 'lead' | 'accompaniment' | 'beat';
```

- [ ] **Step 4: Add the slice field**

In `src/store/types.ts`, add `PatternSegment` to the existing `import type { ... } from '../types'` at the top of the file, then inside `interface UiSlice` add after `activeTab: ViewMode;` (`:314`):

```ts
  // Which of Pattern's three segments is showing. Transient like activeTab —
  // a session position, not composition data (see partializeAppState in
  // store.ts). Click-rate, so it is safe in a slice even though every mounted
  // view re-renders on a slice write.
  patternSegment: PatternSegment;
```

and after `setActiveTab: (tab: ViewMode) => void;` (`:329`):

```ts
  setPatternSegment: (segment: PatternSegment) => void;
```

In `src/store/uiSlice.ts`, add `patternSegment: 'lead',` immediately after `activeTab: 'sound',` (`:45`), and `setPatternSegment: (patternSegment) => set({ patternSegment }),` immediately after the `setActiveTab` line (`:56`).

Extend the slice's own doc comment at `src/store/uiSlice.ts:36-42` — after the sentence about the active tab living in the URL, add: `The Pattern segment is a sibling of it: also transient, but not in the URL, because a segment is a position inside a tab rather than a route.`

- [ ] **Step 5: Add the registry**

Append to `src/components/viewMeta.ts`, and add `Drum, Layers, Music` to the existing `lucide-react` import at `:1` and `PatternSegment` to the type import at `:2`:

```ts
/**
 * Pattern's segment row: id, the short name on the button, the long name on
 * the segment's own header card, and the icon. Same contract as VIEW_META
 * above and for the same reason — `Header`'s segment row and each segment's
 * `SegmentHeader` both read this table, so a button and the thing it opens can
 * never disagree about what they are called.
 *
 * Unlike VIEW_ORDER/VIEW_META this is ONE list, not an order plus a record:
 * there are three entries, the row renders them in this order, and nothing
 * needs to look a segment up by id often enough to earn a second structure.
 */
export const PATTERN_SEGMENTS: ReadonlyArray<{
  id: PatternSegment;
  label: string;
  title: string;
  icon: LucideIcon;
}> = [
  // `Music` is free: it was the departed `chords` view's icon, and the note
  // grid is the most literally musical surface in the app.
  { id: 'lead', label: 'Lead', title: 'Lead Melody', icon: Music },
  // Chord + bass + pad, stacked — `Layers` says "several at once" without
  // naming any one of them, the same reasoning that made this group
  // `Accompany` rather than `Chords/Bass` when the pad layer landed.
  { id: 'accompaniment', label: 'Accompaniment', title: 'Accompaniment', icon: Layers },
  { id: 'beat', label: 'Beat', title: 'Drum Pattern', icon: Drum },
];
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/store/store.test.ts src/components/viewMeta.test.ts`
Expected: PASS. If the icon-collision test fails, one of `Music`/`Layers`/`Drum` was already taken by a view — resolve it in favour of the view and pick a different segment icon, because a tab is seen more often than a segment.

- [ ] **Step 7: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "feat(nav): patternSegment ui state and the PATTERN_SEGMENTS registry"
```

---

### Task 3: `VIEW_META` / `VIEW_ORDER` name the four views for real

Task 1 left `VIEW_META` compiling with borrowed labels — Sound still calls itself "Synth/Lead" and Pattern calls itself "Beat Step", both of which now name a *part* of the tab rather than the tab. This task fixes the copy and locks the icon choices.

**The icons.** The two departing views free two: `chords` frees `Music` (taken by Pattern › Lead in Task 2) and `sequencer` frees `Grid`. `sound` keeps `Sliders` — it is still the synth engine, and a fader bank is what the tab now is. `pattern` takes `Grid`, because every one of its three segments is literally a step grid. `arrange` keeps `LayoutList` and `master` keeps `AudioWaveform` unchanged. That leaves four distinct icons, which `viewMeta.test.ts:16-19` enforces — the bug it was written for is Synth and Master FX both rendering `Sliders` under 1280px where the tab label is `hidden xl:inline` and the icon is all you see.

**The labels.** `tabLabel` is the short form on the nav button and `title` the long form on the view's header card. Sound's two are both `Sound`: there is no longer-form true name for it that is not a list of its contents, and `viewMeta.test.ts:21-28` only requires that tab labels are unique among themselves and titles unique among themselves — it does not require a title to differ from its own tab label. Pattern's are `Pattern` / `Pattern` for the same reason.

**Files:**
- Modify: `src/components/viewMeta.ts:4-16` (the `ViewMeta` doc comment), `:18-25` (`VIEW_ORDER` and its comment), `:27-37` (`VIEW_META`)
- Test: `src/components/viewMeta.test.ts`

**Interfaces:**
- Consumes: `ViewMode` and `PATTERN_SEGMENTS` from Tasks 1-2.
- Produces: `VIEW_ORDER = ['sound', 'pattern', 'arrange', 'master'] as const`; `VIEW_META` with `sound: { icon: Sliders, tabLabel: 'Sound', title: 'Sound' }`, `pattern: { icon: Grid, tabLabel: 'Pattern', title: 'Pattern' }`, `arrange: { icon: LayoutList, tabLabel: 'Arrange', title: 'Arrangement' }`, `master: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' }`. Task 4's `TabButton` and Task 5's `ViewHeader` read both fields.

- [ ] **Step 1: Write the failing test**

Replace `src/components/viewMeta.test.ts:5-11` (the "covers every view exactly once" test) with:

```ts
describe('VIEW_META', () => {
  test('covers every view exactly once', () => {
    expect(VIEW_ORDER).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(Object.keys(VIEW_META).sort()).toEqual(
      ['arrange', 'master', 'pattern', 'sound'],
    );
  });

  // The tab label is the only text on a nav button that is not `hidden
  // xl:inline`-suppressed below 1280px, so a label that names a PART of a tab
  // is a wrong label, not a terse one. "Synth/Lead" named a part of Sound;
  // "Beat Step" named a part of Pattern.
  test('a tab is named for the whole tab, not for one thing inside it', () => {
    expect(VIEW_META.sound.tabLabel).toBe('Sound');
    expect(VIEW_META.pattern.tabLabel).toBe('Pattern');
    expect(VIEW_META.arrange.tabLabel).toBe('Arrange');
    expect(VIEW_META.master.tabLabel).toBe('Master FX');
  });
```

Leave the three tests at `:16-33` as they are — they iterate `VIEW_ORDER` and need no literal edit — except for `:32`, whose expected array becomes `['arrange', 'master', 'pattern', 'sound']`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/viewMeta.test.ts`
Expected: FAIL — `VIEW_META.sound.tabLabel` is still `'Synth/Lead'` from Task 1's interim.

- [ ] **Step 3: Rewrite the registry**

Replace `src/components/viewMeta.ts:18-37` with:

```ts
/**
 * Every view exactly once, in the order the nav happens to show them — but the
 * nav does NOT read this. `Header`'s `AUTOMATION_TABS` and `SONG_NAV_TABS` are
 * what actually render, so reordering here alone moves nothing on screen; keep
 * the two in step by hand. What this list is for is coverage: the tests below
 * iterate it to prove every view has a distinct icon and a unique label.
 */
export const VIEW_ORDER = ['sound', 'pattern', 'arrange', 'master'] as const;

export const VIEW_META: Record<ViewMode, ViewMeta> = {
  // Keeps `Sliders` from the old `synth` view: the tab is still the synth
  // engine, and after the mixer lands (Task 7) a fader bank is literally what
  // the icon depicts.
  sound: { icon: Sliders, tabLabel: 'Sound', title: 'Sound' },
  // Takes `Grid` from the old `sequencer` view. All three Pattern segments are
  // step grids, so the icon that named one of them now names all three.
  pattern: { icon: Grid, tabLabel: 'Pattern', title: 'Pattern' },
  arrange: { icon: LayoutList, tabLabel: 'Arrange', title: 'Arrangement' },
  // Was `Sliders`, identical to the synth tab's — see viewMeta.test.ts.
  master: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
};
```

Remove `Music` from the `VIEW_META` side of the `lucide-react` import only if `PATTERN_SEGMENTS` (Task 2) is not also in this file — it is, so the import line at `:1` keeps `Music`, and gains nothing new. Confirm the final import reads `AudioWaveform, Drum, Grid, Layers, LayoutList, Music, Sliders, type LucideIcon` and that eslint reports no unused import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/viewMeta.test.ts src/components/Header.test.tsx`
Expected: PASS on `viewMeta.test.ts`. `Header.test.tsx:145` asserts the string `'Arrange'` renders, which still holds. If a `Header.test.tsx` assertion fails on a label string, update it to the new label — Task 4 rewrites that file's tab-group tests anyway.

- [ ] **Step 5: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "refactor(nav): name the four views for the whole tab, not one part of it"
```

---

### Task 4: `Header` renders two loop tabs, and owns the segment row

`AUTOMATION_TABS` is already down to two ids from Task 1, so the nav renders correctly — but the segment row does not exist yet, which means Pattern's three stacked bodies (Task 1's interim) have no way to be chosen between. This task builds the row.

**Where the row lives is split deliberately, and this is a judgement call worth reading.** The component is defined and exported from `Header.tsx`, next to `TabButton`, `LAYER_META` and `NAV_GROUP_CLASS`, because it is nav chrome and it must use the same join-group idiom or it will drift out of visual step with the tabs above it. But it is *rendered* from `LoopPage`'s `pattern` branch, not from `Header`. Two reasons: the spec's shell diagram puts the row on its own line *below* the vibes bar rather than inside the navbar, and mounting it inside the branch that is already gated on `activeTab === 'pattern'` makes "appears only on Pattern" structural — there is no second `activeTab` comparison to get wrong, and the always-mounted `Header` gains no new store subscription.

**Files:**
- Modify: `src/components/Header.tsx` (add `PatternSegmentRow` after `TabButton` at `:79`)
- Modify: `src/components/loop/LoopPage.tsx`
- Test: `src/components/Header.test.tsx`

**Interfaces:**
- Consumes: `PATTERN_SEGMENTS` and `setPatternSegment`/`patternSegment` from Task 2; `VIEW_META` from Task 3.
- Produces: `PatternSegmentRow` — a zero-prop exported component. Task 5's `PatternView` renders it as its first child.

- [ ] **Step 1: Write the failing test**

Replace the `describe('header tab grouping', ...)` block at `src/components/Header.test.tsx:91-100` and the `describe('nav tab groups', ...)` block near `:231` with one block, and append the render test:

```tsx
describe('header tab grouping', () => {
  test('the loop layer has exactly two tabs', () => {
    expect(AUTOMATION_TABS).toEqual(['sound', 'pattern']);
  });

  test('the song layer has arrange and the master rack', () => {
    expect(SONG_NAV_TABS).toEqual(['arrange', 'master']);
  });

  test('every tab view is still reachable', () => {
    const views = [...SONG_NAV_TABS, ...AUTOMATION_TABS].sort();
    expect(views).toEqual(['arrange', 'master', 'pattern', 'sound']);
  });

  test('the two layer groups are disjoint', () => {
    const overlap = AUTOMATION_TABS.filter((view) => SONG_NAV_TABS.includes(view));
    expect(overlap).toEqual([]);
  });
});

/**
 * The segment row renders through the same join + btn + btn-active idiom as
 * TabButton, so a substring covering several classes at once is what proves
 * they sit on the SAME element (see .claude/rules/testing.md).
 *
 * The active segment cannot be varied from a test: PatternSegmentRow reads
 * `patternSegment` with a plain useAppStore selector, and under renderToString
 * zustand serves the store's CREATION-time value ('lead'). So this asserts the
 * default-active case and the two inactive cases, which is the whole matrix
 * reachable without a DOM.
 */
describe('PatternSegmentRow', () => {
  const html = renderToString(<PatternSegmentRow />);

  test('renders one button per segment, in registry order', () => {
    expect(html).toContain('id="segment-lead"');
    expect(html).toContain('id="segment-accompaniment"');
    expect(html).toContain('id="segment-beat"');
    expect(html.indexOf('segment-lead')).toBeLessThan(html.indexOf('segment-accompaniment'));
    expect(html.indexOf('segment-accompaniment')).toBeLessThan(html.indexOf('segment-beat'));
  });

  test('the active segment is the primary-filled join item, the others are ghosts', () => {
    expect(html).toContain('btn btn-sm join-item');
    expect(html).toContain('btn-active btn-primary');
    expect(html).toContain('btn-ghost');
  });

  test('every segment label is readable at every width — no xl-only labels here', () => {
    expect(html).toContain('Lead');
    expect(html).toContain('Accompaniment');
    expect(html).toContain('Beat');
    expect(html).not.toContain('hidden xl:inline');
  });

  test('marks exactly one button as the current page', () => {
    expect(html.split('aria-current="page"').length - 1).toBe(1);
  });
});
```

Add `PatternSegmentRow` to the existing import from `./Header` at `src/components/Header.test.tsx:4`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/Header.test.tsx`
Expected: FAIL — `PatternSegmentRow` is not exported from `./Header`.

- [ ] **Step 3: Build the row**

In `src/components/Header.tsx`, add `PATTERN_SEGMENTS` to the existing import from `./viewMeta` at `:17`, and insert after `TabButton` ends at `:79`:

```tsx
/**
 * Pattern's three segments. Defined here, with the other nav chrome, so it
 * shares NAV_GROUP_CLASS and the join + btn + btn-active idiom with the tab
 * buttons above it — a segment row built from its own classes would drift out
 * of visual step with the tabs on the first restyle.
 *
 * It is RENDERED by PatternView, not by Header: the spec puts the row on its
 * own line under the vibes bar, and mounting it inside the branch that already
 * gates on `activeTab === 'pattern'` makes "only on Pattern" structural rather
 * than a second comparison that could disagree with the first.
 *
 * Unlike TabButton the labels are never hidden. There are only three of them
 * and they carry the whole of the user's sense of where they are inside the
 * tab; the tab buttons can afford icon-only below `xl` because the view header
 * underneath repeats the name, and here the view header IS per segment.
 */
export function PatternSegmentRow() {
  const patternSegment = useAppStore((s) => s.patternSegment);
  const setPatternSegment = useAppStore((s) => s.setPatternSegment);

  return (
    <div className={`${NAV_GROUP_CLASS} inline-flex items-center`}>
      {PATTERN_SEGMENTS.map(({ id, label, icon: Icon }) => {
        const isActive = patternSegment === id;
        return (
          <button
            key={id}
            id={`segment-${id}`}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => setPatternSegment(id)}
            className={`btn btn-sm join-item min-w-0 px-2 sm:px-3 gap-1 sm:gap-1.5 text-xs font-bold ${
              isActive ? 'btn-active btn-primary' : 'btn-ghost'
            }`}
            title={label}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

`NAV_GROUP_CLASS` is declared at `:166-168`, *below* this insertion point. `const` declarations are hoisted into the temporal dead zone but the reference is inside a function body that only runs at render time, so this is fine and matches how `TabButton` already reads `VIEW_META`. If eslint's `no-use-before-define` objects, move the `NAV_GROUP_CLASS` declaration up to just above `TabButton` rather than duplicating the string.

- [ ] **Step 4: Render it from the Pattern branch**

In `src/components/loop/LoopPage.tsx`, add `import { PatternSegmentRow } from '../Header';` and make the pattern branch:

```tsx
      <div className={activeTab === 'pattern' ? 'block' : 'hidden'}>
        <div className="px-3 sm:px-4 pt-3 sm:pt-4">
          <PatternSegmentRow />
        </div>
        {/* INTERIM (Task 1): still stacked. Task 5 gates these on
            patternSegment and adds the lead segment. */}
        <ChordView />
        <SequencerView />
      </div>
```

The wrapper's `px-3 sm:px-4` matches the padding `ChordView` and `SequencerView` each already apply to their own root, so the row lines up with the cards under it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/components/Header.test.tsx src/components/viewMeta.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "feat(nav): the Pattern segment row"
```

---

### Task 5: `SoundView` and `PatternView`

This is the move the whole phase is for. Nothing here is rewritten — three blocks change file and one JSX line changes parent. Do it as moves, so a reviewer diffs rather than re-reads.

**Segments carry their own header; the Pattern tab does not add a second one.** A tab-level `ViewHeader view="pattern"` would be a constant strip reading "Pattern" directly above a segment row that already says which segment you are on — pure duplication — while each of the three segments genuinely owns an actions cluster that has nowhere else to go (Accompaniment's quick-save progression button, Beat's meter badge). So `ViewHeader` keeps its markup but gains a sibling: the card is extracted into a shared internal component and `SegmentHeader` looks its icon and title up in `PATTERN_SEGMENTS` exactly as `ViewHeader` looks them up in `VIEW_META`. Neither ever takes an icon or title as a prop — that is the rule `ViewHeader`'s own doc comment was written to enforce, and the reason `SequencerView`, `ChordView` and `EffectsRackView` stopped drifting.

**Why `block`/`hidden` for the segments and not conditional mounting.** Same reason as `App.tsx`'s four tabs, plus two sharper ones here. `ChordView` holds pointer-driven local state and the chord/bass preview refs at `ChordView.tsx:377-515`; `SequencerView` holds `selectedGridId` and a memoised 30-entry option list — unmounting drops all of it, so switching segments would silently reset a half-finished edit. And `LeadMelodyGrid` subscribes to the step publisher; unmounting and remounting it mid-playback would drop and re-take that subscription on every segment click. Cost is covered: every meter ticks through `utils/meterScheduler.ts`, which gates each registration on an `IntersectionObserver`, so a hidden segment's meters stop reading.

**Ordering note:** at the end of this task, Pattern › Beat still contains the Drum Sound card — that card does not move until Task 6. That is a correct intermediate state, not an oversight: Beat is fully usable, just not yet split.

**Files:**
- Rename: `src/components/loop/SynthView.tsx` → `src/components/loop/SoundView.tsx`; `src/components/loop/SynthView.test.tsx` → `src/components/loop/SoundView.test.tsx`
- Modify: `SoundView.tsx` — delete the `LeadMelodyGrid` import (old `:40`) and its single JSX line (old `:679`, with the comment above it)
- Create: `src/components/ui/SegmentHeader.tsx`
- Modify: `src/components/ui/ViewHeader.tsx` (extract the card)
- Create: `src/components/loop/PatternView.tsx`
- Modify: `src/components/loop/LoopPage.tsx`, `src/components/loop/ChordView.tsx:564-566`, `src/components/loop/SequencerView.tsx:195`
- Modify: `src/components/appChildMemo.test.tsx:7-8,57-58`

**Interfaces:**
- Consumes: `PatternSegmentRow` (Task 4), `PATTERN_SEGMENTS` and `patternSegment` (Task 2), `VIEW_META` (Task 3).
- Produces:
  - `SoundView` — zero-prop `React.memo` component from `src/components/loop/SoundView.tsx`. Tasks 6, 7 and 8 all edit this file.
  - `SegmentHeader({ segment, badge, actions, children })` from `src/components/ui/SegmentHeader.tsx`, where `segment: PatternSegment` and the other three props are `ViewHeaderProps`' existing `badge?: React.ReactNode`, `actions?: React.ReactNode`, `children?: React.ReactNode`.
  - `PatternView` — zero-prop `React.memo` component from `src/components/loop/PatternView.tsx`.

- [ ] **Step 1: Write the failing test for `SegmentHeader`**

Create `src/components/ui/SegmentHeader.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SegmentHeader } from './SegmentHeader';
import { ViewHeader } from './ViewHeader';

describe('SegmentHeader', () => {
  test('reads its title from PATTERN_SEGMENTS, not from a prop', () => {
    const html = renderToString(<SegmentHeader segment="accompaniment" />);
    expect(html).toContain('Accompaniment');
  });

  test('renders the badge and actions slots the same way ViewHeader does', () => {
    const html = renderToString(
      <SegmentHeader segment="beat" badge="16-Step" actions={<button id="x">x</button>} />,
    );
    expect(html).toContain('Drum Pattern');
    expect(html).toContain('16-Step');
    expect(html).toContain('id="x"');
  });

  // The two share one card, so a restyle of one cannot skip the other. This
  // compares the OUTER wrapper markup, which is the part that must not drift.
  test('shares its card markup with ViewHeader', () => {
    const segment = renderToString(<SegmentHeader segment="lead" />);
    const view = renderToString(<ViewHeader view="sound" />);
    const shell = 'card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5';
    expect(segment).toContain(shell);
    expect(view).toContain(shell);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/ui/SegmentHeader.test.tsx`
Expected: FAIL — "Cannot find module './SegmentHeader'".

- [ ] **Step 3: Extract the card and add `SegmentHeader`**

Replace `src/components/ui/ViewHeader.tsx:26-49` (the component body) with a thin wrapper plus the shared card, keeping the existing doc comment at `:17-25` on `ViewHeader`:

```tsx
export interface HeaderCardProps {
  icon: LucideIcon;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The card itself. Takes its icon and title as props because it has exactly
 * two callers, and each of those looks the pair up in ITS OWN registry —
 * ViewHeader in VIEW_META, SegmentHeader in PATTERN_SEGMENTS. Feature code
 * never reaches this component, so "icon and label come from a registry, never
 * from a local literal" still holds at every call site that exists.
 */
export function HeaderCard({ icon: Icon, title, badge, actions, children }: HeaderCardProps) {
  return (
    <PanelCard className="relative">
      <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-h-8">
          <div className="p-1.5 rounded-selector bg-primary/20 border border-primary/30 text-primary">
            <Icon className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-base-content">{title}</h2>
          {badge !== undefined && (
            <span className={HEADER_BADGE}>
              {badge}
            </span>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex items-center flex-wrap gap-1.5 min-h-8">{actions}</div>
        )}
        {children}
      </div>
    </PanelCard>
  );
}

export function ViewHeader({ view, badge, actions, children }: ViewHeaderProps) {
  const { icon, title } = VIEW_META[view];
  return (
    <HeaderCard icon={icon} title={title} badge={badge} actions={actions}>
      {children}
    </HeaderCard>
  );
}
```

Add `import type { LucideIcon } from 'lucide-react';` to that file's imports.

Create `src/components/ui/SegmentHeader.tsx`:

```tsx
import React from 'react';
import type { PatternSegment } from '@/types';
import { PATTERN_SEGMENTS } from '../viewMeta';
import { HeaderCard } from './ViewHeader';

export interface SegmentHeaderProps {
  segment: PatternSegment;
  /** Machine-computed context, e.g. the beat segment's "16-Step · 4/4". */
  badge?: React.ReactNode;
  /** Right-hand control cluster. */
  actions?: React.ReactNode;
  /** Absolutely-positioned extras that belong to the header, e.g. save toasts. */
  children?: React.ReactNode;
}

/**
 * The header card a Pattern SEGMENT opens with — ViewHeader's sibling, sharing
 * its card so the two cannot drift.
 *
 * Pattern deliberately has no tab-level header of its own: a strip reading
 * "Pattern" directly under a segment row that already names the segment is
 * duplication, while each segment owns an actions cluster (Accompaniment's
 * quick-save, Beat's meter badge) that needs a home. So the header is per
 * segment, and there is exactly one of them on screen at a time.
 */
export function SegmentHeader({ segment, badge, actions, children }: SegmentHeaderProps) {
  const meta = PATTERN_SEGMENTS.find((s) => s.id === segment);
  if (!meta) throw new Error(`SegmentHeader: unknown segment "${segment}"`);
  return (
    <HeaderCard icon={meta.icon} title={meta.title} badge={badge} actions={actions}>
      {children}
    </HeaderCard>
  );
}
```

The `throw` is deliberate and follows `resolveDegreeQuality`'s precedent: `PatternSegment` is a closed union, so an unknown id can only mean the registry and the union disagree, and a silent fallback would render the wrong header rather than fail.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/ui/SegmentHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rename `SynthView` to `SoundView`**

```bash
git mv src/components/loop/SynthView.tsx src/components/loop/SoundView.tsx
git mv src/components/loop/SynthView.test.tsx src/components/loop/SoundView.test.tsx
```

Rename the exported component. In `SoundView.tsx`, `export const SynthView = React.memo(function SynthView() {` becomes `export const SoundView = React.memo(function SoundView() {`. Then:

```bash
grep -rn "SynthView" src docs scripts
```

Fix **every** hit. The ones known to exist: `src/components/loop/LoopPage.tsx` (import and JSX), `src/components/appChildMemo.test.tsx:8` (the import) and `:57` (the `['SynthView', SynthView, {}]` row — both the string and the identifier), and the import in the renamed test file. Do **not** rename anything else the file exports — `KEYBOARD_NOTES`, `resolveSynthControlChannel` and the rest keep their names, because they are about the synth engine and the synth engine did not get renamed; only the view did. Likewise leave `SYNTH_TARGET_STYLES` in `src/utils/synthControl.ts` alone: its four keys are `SynthControlTarget` values, not view ids.

- [ ] **Step 6: Move the lead grid out of Sound**

In `src/components/loop/SoundView.tsx`, delete the import at old line `:40` (`import { LeadMelodyGrid } from "./lead/LeadMelodyGrid";`) and delete these three lines at old `:678-679`:

```tsx
      {/* Lead Melody Grid — the per-step pitch sequencer */}
      <LeadMelodyGrid />
```

Nothing else changes: `<LeadMelodyGrid />` consumes none of `SoundView`'s local state, which is why this is a two-line move and not a refactor.

- [ ] **Step 7: Build `PatternView`**

Create `src/components/loop/PatternView.tsx`:

```tsx
import React from 'react';
import { useAppStore } from '@/store/store';
import { PatternSegmentRow } from '../Header';
import { SegmentHeader } from '../ui/SegmentHeader';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';
import { LeadMelodyGrid } from './lead/LeadMelodyGrid';

/**
 * The Pattern tab: everything that changes the NOTES or the rhythm.
 *
 * All three segments stay mounted and are gated with block/hidden, the same
 * way App.tsx gates the four tabs. Unmounting would be worse here than there:
 * ChordView holds the chord/bass preview refs and pointer-driven local state,
 * SequencerView holds its selected-grid id and a memoised 30-entry option
 * list, and LeadMelodyGrid holds a step-publisher subscription — a segment
 * click would silently reset all of it. The cost is covered: every meter ticks
 * through utils/meterScheduler.ts, which gates each registration on an
 * IntersectionObserver, so a hidden segment's meters stop reading.
 *
 * There is no tab-level ViewHeader here on purpose — see SegmentHeader.
 */
export const PatternView = React.memo(function PatternView() {
  const patternSegment = useAppStore((s) => s.patternSegment);
  return (
    <>
      <div className="px-3 sm:px-4 pt-3 sm:pt-4">
        <PatternSegmentRow />
      </div>
      <div className={patternSegment === 'lead' ? 'block' : 'hidden'}>
        {/* The lead segment has no card wrapper of its own — LeadMelodyGrid is
            one card — so it borrows the padding/width shell ChordView and
            SequencerView each apply to their own root. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="lead" />
          <LeadMelodyGrid />
        </div>
      </div>
      <div className={patternSegment === 'accompaniment' ? 'block' : 'hidden'}>
        <ChordView />
      </div>
      <div className={patternSegment === 'beat' ? 'block' : 'hidden'}>
        <SequencerView />
      </div>
    </>
  );
});
```

- [ ] **Step 8: Point the two existing segment views at `SegmentHeader`**

`src/components/loop/ChordView.tsx` — replace `<ViewHeader\n        view="pattern"` at `:564-566` (Task 1 left it as `view="pattern"`) with `<SegmentHeader\n        segment="accompaniment"`, and the closing `</ViewHeader>` at `:628` with `</SegmentHeader>`. Change the import at `:71` from `ViewHeader` to `SegmentHeader` (`import { SegmentHeader } from "../ui/SegmentHeader";`). Everything between — including the three `PowerToggle`s at `:568-588`, which Task 7 removes — is untouched.

`src/components/loop/SequencerView.tsx:195` — `<ViewHeader view="pattern" badge={sequencerMeterBadge(meter)} />` becomes `<SegmentHeader segment="beat" badge={sequencerMeterBadge(meter)} />`, with the import at `:21` swapped the same way.

- [ ] **Step 9: Simplify `LoopPage`**

Replace `src/components/loop/LoopPage.tsx` entirely:

```tsx
import React from 'react';
import { useAppStore } from '@/store/store';
import { SoundView } from './SoundView';
import { PatternView } from './PatternView';

export const LoopPage = React.memo(function LoopPage() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'sound' ? 'block' : 'hidden'}><SoundView /></div>
      <div className={activeTab === 'pattern' ? 'block' : 'hidden'}><PatternView /></div>
    </>
  );
});
```

- [ ] **Step 10: Update `appChildMemo.test.tsx`**

`src/components/appChildMemo.test.tsx:7-8` imports `SequencerView` and `SynthView`; `:57-58` lists `['SynthView', SynthView, {}]` and `['SequencerView', SequencerView, {}]`. Change the `SynthView` row to `['SoundView', SoundView, {}]` with the matching import, and **add** `['PatternView', PatternView, {}]` — `PatternView` is a new `React.memo` App-level child and belongs under the same guard. Keep the `SequencerView` row: it is still a memoised component, just one level deeper.

- [ ] **Step 11: Run the tests**

Run: `bun test src/components/`
Expected: PASS. `src/components/loop/SequencerView.test.tsx:26,32,47` search the rendered string for `'Drum Sound'` and `'>Pattern<'` — both still render from `SequencerView`, so those assertions still hold at this commit. They break in Task 6, which fixes them there.

- [ ] **Step 12: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "feat(nav): SoundView and PatternView, with the lead grid on Pattern"
```

---

### Task 6: the Drum Sound card moves to Sound

`SequencerView` has held two cards side by side that answer different questions: **Drum Sound** (`:197-294` — kit, filter type, cutoff, resonance, level) shapes how the kit sounds and changes no note; **Pattern** (`:295-384` — grid preset, shift/random/clear, the grid itself) changes the rhythm and no sound. That is exactly the boundary rule, and the card is already a self-contained `PanelCard`, so the move is a cut and paste of one block.

**The cross-tab write, named explicitly.** `applyDrumGrid` (`SequencerView.tsx:158-167`) does two things: `replaceDrumPattern(grid.rows)` **and** `onChangeSoundKit(grid.kit)`. After this task the kit `<select>` lives on Sound while `applyDrumGrid` fires from Pattern › Beat, so picking a grid on one tab rewrites a control on another. What keeps that correct is that both sides read and write the same `soundKit` slice field through the same store — the select is `value={soundKit}` bound, both tabs stay mounted, and a slice write re-renders every mounted view, so the Sound select shows the new kit the instant the grid is picked. Nothing needs to be threaded and nothing needs to be synced.

**The trap this must not reintroduce.** The comment at `SequencerView.tsx:147-157` records that a `useEffect` keyed on `selectedGridId` used to fire on every mount and overwrite the rehydrated kit with synthwave's — the "kit resets to Retro Drive on refresh" bug. Splitting the select away from `applyDrumGrid` makes exactly that wrong fix look attractive again ("the tabs need to stay in sync"). They do not; they already are. That comment stays with `applyDrumGrid` in `SequencerView` and gains a sentence saying the select now lives on Sound and still needs no effect.

**Files:**
- Modify: `src/components/loop/SequencerView.tsx:197-294` (delete the card and its comment), plus the store reads and imports it alone used
- Modify: `src/components/loop/SoundView.tsx` (paste the card in)
- Test: `src/components/loop/SequencerView.test.tsx:20-55`

**Interfaces:**
- Consumes: `SoundView` from Task 5.
- Produces: nothing new. `SoundView` now renders the Drum Sound card; Task 7 removes its `ChannelStrip`.

- [ ] **Step 1: Update the failing test**

`src/components/loop/SequencerView.test.tsx:20-55` contains two tests that assert the card ordering (`html.indexOf('Drum Sound')` before `select-sequencer-sound-kit`, and a `soundRow` slice from `'Drum Sound'` to `'>Pattern<'`). Replace that whole `describe` block with:

```tsx
/**
 * Drum Sound moved to the Sound tab (nav restructure phase 2): a kit, a filter
 * and a level change how the drums SOUND and change no note, which is the
 * whole of the Sound/Pattern boundary rule. What is left here is the rhythm.
 */
describe('the beat segment is pattern only', () => {
  const html = renderToString(<SequencerView />);

  test('renders the Pattern card', () => {
    expect(html).toContain('>Pattern<');
  });

  test('no longer renders any sound-shaping control', () => {
    expect(html).not.toContain('Drum Sound');
    expect(html).not.toContain('select-sequencer-sound-kit');
    expect(html).not.toContain('Drum Level');
  });

  test('keeps the grid preset select, which rewrites notes rather than sound', () => {
    expect(html).toContain('select-sequencer-grid');
  });
});
```

**Check before writing the last assertion:** open `src/components/loop/SequencerView.tsx` around `:318-332` and read the grid preset `<select>`'s actual `id`. `select-sequencer-grid` is a guess from the naming convention of its sibling at `:215`; use whatever is really there rather than trusting this line.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/loop/SequencerView.test.tsx`
Expected: FAIL — `'Drum Sound'` is still rendered.

- [ ] **Step 3: Cut the card out of `SequencerView`**

Delete `src/components/loop/SequencerView.tsx:197-294` — the `{/* Drum Sound — ... */}` comment at `:197-198` through the `</PanelCard>` at `:293` and the blank line after it. Keep everything from `:295` (the `{/* Pattern — ... */}` comment) onward.

Then delete the store reads and imports the card alone used. Read `SequencerView.tsx:35-70` and remove, from that block, only the names no surviving line references:
- `masterSequencerVolume` / `setMasterSequencerVolume` (`:50-53`)
- `drumFilterCutoff`, `drumFilterResonance`, `drumFilterType`, `setDrumFilterCutoff`, `setDrumFilterResonance`, `setDrumFilterType` (`:54-59`)
- `soundKit` (`:48`) — but **keep `onChangeSoundKit` (`:49`)**, which `applyDrumGrid` still calls.
- Module scope: `DRUM_KIT_NAMES` (`:33`) and the `DRUM_KITS` import (`:18`).
- Imports: `Disc3` (`:7`), `Knob` (`:20`), `ChannelStrip` (`:23`). Check `Field` (`:25`) and `FIELD_SELECT`/`FIELD_LANE`/`SECTION_HEADER` (`:24`) against the surviving Pattern card before removing any of them — the Pattern card has its own section header and its own select, so several of these are probably still used.

Run `bun run eslint` after this step; an unused import or variable is an error and is the fastest way to find anything missed.

Extend the comment at `:147-157` (now shifted) by appending, before the closing `*/`:

```
  // The kit SELECT now lives on the Sound tab, so this line writes a control
  // on another tab. That is correct and needs nothing added: both sides bind
  // the same `soundKit` slice field, both tabs stay mounted, and a slice write
  // re-renders every mounted view, so the select shows the new kit the instant
  // a grid is picked. Do NOT add an effect to "keep them in sync" — that is
  // precisely the effect described above, and it is how the reset bug got in.
```

- [ ] **Step 4: Paste the card into `SoundView`**

In `src/components/loop/SoundView.tsx`, insert the deleted block verbatim into the slot Task 5's lead-grid removal left, i.e. between the Simple/Pro body block (which ends at old `:676`) and the `{/* Preset Library Sidebar Drawer / Modal */}` `<Suspense>` (old `:681`). Change only the leading comment:

```tsx
      {/* Drum Sound — kit, filter and level. Moved here from the sequencer:
          all of it changes how the kit SOUNDS and none of it changes a note,
          which is the Sound/Pattern boundary rule. The grid that picks these
          notes lives on Pattern › Beat. */}
```

Add to `SoundView`'s imports and store reads exactly what Step 3 removed from `SequencerView`: `Disc3` from `lucide-react`, `DRUM_KITS` from `@/data/drumKits` (plus the module-scope `const DRUM_KIT_NAMES = Object.keys(DRUM_KITS);` and its comment, verbatim from `SequencerView.tsx:30-33`), `Knob`, `ChannelStrip` (already imported at old `:41`), `Field`, and the `FIELD_SELECT`/`FIELD_LANE`/`SECTION_HEADER` class constants the card's JSX names. Add the six drum-filter reads, `masterSequencerVolume`/`setMasterSequencerVolume`, and `soundKit`/`setSoundKit` as `useAppStore` selectors, naming the local for `setSoundKit` `onChangeSoundKit` so the pasted JSX needs no edit.

**Check rather than trust:** re-read the pasted JSX and list every identifier it references before adding imports, instead of working from this list — the block is ~95 lines and this plan names what was visible in it, not necessarily all of it.

- [ ] **Step 5: Run the tests**

Run: `bun test src/components/loop/`
Expected: PASS. If a `SoundView.test.tsx` assertion breaks, it is because the file's rendered markup grew — update the assertion, do not move the card back.

- [ ] **Step 6: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "refactor(nav): the drum kit, filter and level move to Sound"
```

---

### Task 7: one mixer on Sound, five tracks

Today the five layer faders are in five different places and three of the five mutes are in a sixth, so there is nowhere to balance a mix — you cannot see the lead and the bass at the same time. Two of the ten controls do not exist at all: `synthMuted`/`toggleSynthMuted` (`store/types.ts:90,96`) and `drumMuted`/`toggleDrumMuted` (`:260,282`) are in the store, are `LoopMixPatch` members, are honoured by the audio path, and are wired to no live UI. So this is not only a relocation — it completes the set.

**This mixer reads and writes the LIVE slice fields, not `LoopMixPatch`.** `SortableLoopCard.tsx:143-156`'s `LOOP_MIX_CHANNELS` is the shape to copy — five rows, the same order, the same labels, the same tones — but it is bound to a per-loop override patch on an Arrange card. This one is bound to `synthVolume`, `chordVolume`, `bassVolume`, `padVolume`, `masterSequencerVolume` and their five mute siblings on the store root: the values the engine is actually using right now. Two tables that look alike and mean different things is the risk here; the doc comment has to say which is which, in both files.

**Files:**
- Create: `src/components/loop/SoundMixer.tsx`, `src/components/loop/SoundMixer.test.tsx`
- Modify: `src/components/loop/SoundView.tsx` — delete the `ChannelStrip` at old `:366-374`; render `<SoundMixer />`
- Modify: `src/components/loop/chord/ChordModulePanel.tsx:199-207`, `BassModulePanel.tsx:184-192`, `PadModulePanel.tsx:250-258` — delete each `ChannelStrip`
- Modify: `src/components/loop/ChordView.tsx:568-589` — delete the three `PowerToggle`s and the `divider` after them
- Modify: `src/components/loop/SoundView.tsx` — delete the `ChannelStrip` inside the Drum Sound card Task 6 just moved
- Modify: `src/components/song/SortableLoopCard.tsx:143` — extend the `LOOP_MIX_CHANNELS` comment

**Interfaces:**
- Consumes: `SoundView` (Task 5), the Drum Sound card's presence in it (Task 6).
- Produces: `SoundMixer` — zero-prop component; `MIXER_CHANNELS: ReadonlyArray<MixerChannel>` exported from the same file for its test.

- [ ] **Step 1: Write the failing test**

Create `src/components/loop/SoundMixer.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { MIXER_CHANNELS, SoundMixer } from './SoundMixer';

describe('MIXER_CHANNELS', () => {
  // The same five layers, in the same order, as LOOP_MIX_CHANNELS in
  // song/SortableLoopCard.tsx. The spec's rule is that nothing may introduce a
  // sixth grouping of the same layers, and a table that drifted in order would
  // be exactly that.
  test('lists the five layers in the canonical order', () => {
    expect(MIXER_CHANNELS.map((c) => c.volumeKey)).toEqual([
      'synthVolume', 'chordVolume', 'bassVolume', 'padVolume', 'masterSequencerVolume',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.muteKey)).toEqual([
      'synthMuted', 'chordMuted', 'bassMuted', 'padMuted', 'drumMuted',
    ]);
  });

  test('every channel has both a volume setter and a mute toggle', () => {
    expect(MIXER_CHANNELS.map((c) => c.setVolumeKey)).toEqual([
      'setSynthVolume', 'setChordVolume', 'setBassVolume', 'setPadVolume',
      'setMasterSequencerVolume',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.toggleKey)).toEqual([
      'toggleSynthMuted', 'toggleChordMuted', 'toggleBassMuted', 'togglePadMuted',
      'toggleDrumMuted',
    ]);
  });

  test('labels are unique and human, and ids are unique', () => {
    expect(new Set(MIXER_CHANNELS.map((c) => c.label)).size).toBe(5);
    expect(new Set(MIXER_CHANNELS.map((c) => c.idPrefix)).size).toBe(5);
  });
});

describe('SoundMixer', () => {
  const html = renderToString(<SoundMixer />);

  test('renders five faders', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`id="slider-${c.idPrefix}-layer-volume"`);
    }
  });

  test('renders five mutes, including the two that had no UI before', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`id="btn-mix-mute-${c.idPrefix}"`);
    }
    expect(html).toContain('id="btn-mix-mute-synth"');
    expect(html).toContain('id="btn-mix-mute-drum"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/loop/SoundMixer.test.tsx`
Expected: FAIL — "Cannot find module './SoundMixer'".

- [ ] **Step 3: Build the mixer**

Create `src/components/loop/SoundMixer.tsx`:

```tsx
import React from 'react';
import { useAppStore } from '@/store/store';
import { SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import { PanelCard } from '../ui/PanelCard';
import { ChannelStrip } from '../ui/ChannelStrip';
import { PowerToggle, type PowerToggleTone } from '../ui/PowerToggle';
import { SECTION_HEADER } from '../ui/fieldClasses';

export interface MixerChannel {
  idPrefix: string;
  label: string;
  volumeKey: 'synthVolume' | 'chordVolume' | 'bassVolume' | 'padVolume' | 'masterSequencerVolume';
  setVolumeKey:
    | 'setSynthVolume' | 'setChordVolume' | 'setBassVolume' | 'setPadVolume'
    | 'setMasterSequencerVolume';
  muteKey: 'synthMuted' | 'chordMuted' | 'bassMuted' | 'padMuted' | 'drumMuted';
  toggleKey:
    | 'toggleSynthMuted' | 'toggleChordMuted' | 'toggleBassMuted' | 'togglePadMuted'
    | 'toggleDrumMuted';
  tone: PowerToggleTone;
  accentClass: string;
  sliderClassName: string;
}

/**
 * The five layers, in the canonical order, bound to the LIVE slice fields —
 * the levels the engine is using right now.
 *
 * This deliberately mirrors LOOP_MIX_CHANNELS in song/SortableLoopCard.tsx:
 * same five layers, same order, same labels and tones. The two are NOT
 * interchangeable and must never be merged. That one writes a per-loop
 * LoopMixPatch — an arrangement override stored on a loop; this one writes the
 * live store root. Same rows, different destination.
 *
 * Two of these ten controls are new rather than moved: synthMuted and
 * drumMuted have existed in the store and been honoured by the audio path
 * since before this file, with no UI anywhere.
 */
export const MIXER_CHANNELS: ReadonlyArray<MixerChannel> = [
  {
    idPrefix: 'synth', label: 'Lead',
    volumeKey: 'synthVolume', setVolumeKey: 'setSynthVolume',
    muteKey: 'synthMuted', toggleKey: 'toggleSynthMuted',
    tone: 'primary',
    accentClass: SYNTH_TARGET_STYLES.synth.accent,
    sliderClassName: SYNTH_TARGET_STYLES.synth.slider,
  },
  {
    idPrefix: 'chord', label: 'Chord',
    volumeKey: 'chordVolume', setVolumeKey: 'setChordVolume',
    muteKey: 'chordMuted', toggleKey: 'toggleChordMuted',
    tone: 'module-chord',
    accentClass: SYNTH_TARGET_STYLES.chord.accent,
    sliderClassName: SYNTH_TARGET_STYLES.chord.slider,
  },
  {
    idPrefix: 'bass', label: 'Bass',
    volumeKey: 'bassVolume', setVolumeKey: 'setBassVolume',
    muteKey: 'bassMuted', toggleKey: 'toggleBassMuted',
    tone: 'module-bass',
    accentClass: SYNTH_TARGET_STYLES.bass.accent,
    sliderClassName: SYNTH_TARGET_STYLES.bass.slider,
  },
  {
    idPrefix: 'pad', label: 'Pad',
    volumeKey: 'padVolume', setVolumeKey: 'setPadVolume',
    muteKey: 'padMuted', toggleKey: 'togglePadMuted',
    tone: 'module-pad',
    accentClass: SYNTH_TARGET_STYLES.pad.accent,
    sliderClassName: SYNTH_TARGET_STYLES.pad.slider,
  },
  {
    // The drum bus has no SynthControlTarget entry — it is not a synth voice —
    // so its two classes are literals here. `accent` matches the tone
    // SortableLoopCard gives the same row.
    idPrefix: 'drum', label: 'Beat',
    volumeKey: 'masterSequencerVolume', setVolumeKey: 'setMasterSequencerVolume',
    muteKey: 'drumMuted', toggleKey: 'toggleDrumMuted',
    tone: 'accent',
    accentClass: 'text-accent',
    sliderClassName: 'range range-xs range-accent',
  },
];

function MixerRow({ channel }: { channel: MixerChannel }) {
  const volume = useAppStore((s) => s[channel.volumeKey]);
  const setVolume = useAppStore((s) => s[channel.setVolumeKey]);
  const muted = useAppStore((s) => s[channel.muteKey]);
  const toggleMuted = useAppStore((s) => s[channel.toggleKey]);

  return (
    <div className="flex items-center gap-2">
      <PowerToggle
        id={`btn-mix-mute-${channel.idPrefix}`}
        on={!muted}
        onToggle={toggleMuted}
        name={channel.label}
        tone={channel.tone}
        size="xs"
      />
      <div className="flex-1 min-w-40">
        <ChannelStrip
          idPrefix={channel.idPrefix}
          label={channel.label}
          volumeDb={volume}
          accentClass={channel.accentClass}
          sliderClassName={channel.sliderClassName}
          onVolumeDbChange={setVolume}
        />
      </div>
    </div>
  );
}

/**
 * The one mixer. Every layer's level and mute in one place, on Sound, because
 * a fader changes how something sounds and not what it plays — and because a
 * balance you cannot see all of at once is not a balance.
 */
export const SoundMixer = React.memo(function SoundMixer() {
  return (
    <PanelCard>
      <div className="card-body p-3 sm:p-4 gap-3">
        <span className={SECTION_HEADER}>Mixer</span>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2">
          {MIXER_CHANNELS.map((channel) => (
            <MixerRow key={channel.idPrefix} channel={channel} />
          ))}
        </div>
      </div>
    </PanelCard>
  );
});
```

**Two things to check rather than trust.** First, `ChannelStrip`'s `accentClass` prop is typed `StripAccent = KnobColor` (`ui/ChannelStrip.tsx`), a closed union — confirm `'text-accent'` is a member; if it is not, use a member that is and record why in a comment rather than widening the union. Second, confirm `PowerToggle` accepts a `size` prop with an `'xs'` member (`ui/PowerToggle.tsx`'s `SIZE_CLASS` suggests it does) and that its props are named `id` / `on` / `onToggle` / `name` / `tone` — `ChordView.tsx:568-574` is the working call to copy from.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/loop/SoundMixer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render it and delete the five old homes**

In `src/components/loop/SoundView.tsx`:
1. Render `<SoundMixer />` immediately after the Drum Sound card Task 6 added, so the Sound page reads: header → synth card → Drum Sound → Mixer → preset drawer.
2. Delete the `<div className="flex-1 min-w-44 max-w-xs">` wrapper and the `ChannelStrip` inside it at old `:365-374` (the `controlTarget`-driven strip), together with the `{/* Target Volume Slider, dynamic to active target with matching tint */}` comment above it. **Leave the target chip row above it alone** — Task 8 edits that. Then check whether the local `activeTargetVolume` (used only by that strip) is now unused and remove it and its derivation if so; `bun run eslint` will say.
3. Delete the `ChannelStrip` inside the Drum Sound card (`idPrefix="drums"`, `label="Drum Level"`).

In `src/components/loop/chord/ChordModulePanel.tsx`, delete the `{/* Chord Layer Volume Slider */}` comment and the `ChannelStrip` at `:199-207`. Same in `BassModulePanel.tsx:184-192` and `PadModulePanel.tsx:250-258`. In each file remove the now-unused `chordVolume`/`setChordVolume` (etc.) store reads and the `ChannelStrip` import.

In `src/components/loop/ChordView.tsx`, delete the three `PowerToggle`s at `:568-588` and the `<div className="divider divider-horizontal mx-0" />` at `:589` that separated them from the quick-save button — with the toggles gone the divider divides nothing. Remove the six now-unused store reads (`chordMuted`, `toggleChordMuted`, `bassMuted`, `toggleBassMuted`, `padMuted`, `togglePadMuted`) and the `PowerToggle` import at `:69` **only if** nothing else in the 967-line file uses it — grep first.

In `src/components/song/SortableLoopCard.tsx`, extend the comment above `LOOP_MIX_CHANNELS` at `:143` with:

```
// The live-value twin of this table is MIXER_CHANNELS in
// loop/SoundMixer.tsx: same five layers, same order, same labels and tones.
// They must not be merged — this one writes a per-loop LoopMixPatch (an
// arrangement override), that one writes the live store root.
```

- [ ] **Step 6: Fix the tests the deletions break**

Run: `bun test`

Expected failures and their fixes:
- `src/components/loop/ChordView.test.tsx` — any assertion on `btn-mute-chord` / `btn-mute-bass` / `btn-mute-pad` inside `ChordView`. Delete those assertions; the behaviour now lives in `SoundMixer.test.tsx`.
- `src/components/song/SortableLoopCard.test.tsx:295,297,361` and `src/components/song/ArrangeView.test.tsx:78-79` assert `btn-mute-chord-loop-default-1` — **those are the per-loop card's toggles and are unaffected.** Do not touch them. If they fail, something in Step 5 reached into `song/` by mistake.
- Any `SoundView.test.tsx` / module-panel test asserting a `slider-*-layer-volume` id that has moved.

- [ ] **Step 7: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "feat(mixer): one five-track mixer on Sound, with the two missing mutes"
```

---

### Task 8: the Accompaniment group frame

Chord, bass and pad are one job — accompaniment — done three ways, and after Task 7 they appear as three adjacent rows in a five-row mixer and three adjacent chips in a four-chip target row, with nothing saying they belong together. §3 asks for a neutral frame in three places.

**The frame is neutral, and that is the interesting constraint.** `index.css` spaces the module hues around the OKLCH wheel deliberately and records that chord (125°), bass (256°) and pad (40°, the one recorded exception in the amber band) must stay separable. A group tint — a shared background, a coloured border, a wash over the three — would undo exactly that separation to express a grouping the enclosure already expresses. So: **the frame groups by enclosure; the dots keep saying which is which.** A 1px `border-base-300`, no background, no colour on or inherited by its children. This is presentation only: `controlTarget`'s persisted values (`'synth' | 'chord' | 'bass' | 'pad'`) do not change.

Three places, of which two exist after this phase and one is a no-label case:
- **Sound › target chips** — `[Lead]`, then the frame around `[Chord][Bass][Pad]`, labelled.
- **Sound › mixer** — `Lead`, the frame around the chord/bass/pad rows, then `Beat`, labelled.
- **Pattern › Accompaniment** — the segment header already names the group, so the frame goes around the three module panels **with no label**; a second `ACCOMPANIMENT` there would duplicate the card title.

**Files:**
- Create: `src/components/ui/GroupFrame.tsx`, `src/components/ui/GroupFrame.test.tsx`
- Modify: `src/components/loop/SoundView.tsx` (the target chip row, old `:341-363`)
- Modify: `src/components/loop/SoundMixer.tsx` (Task 7)
- Modify: `src/components/loop/ChordView.tsx:928-942` (the three module panels)

**Interfaces:**
- Consumes: `SoundMixer` and `MIXER_CHANNELS` from Task 7.
- Produces: `GroupFrame({ label, className, children })` where `label?: string`, `className?: string`, `children: React.ReactNode`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/GroupFrame.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { GroupFrame } from './GroupFrame';

describe('GroupFrame', () => {
  test('draws a 1px neutral border and no background', () => {
    const html = renderToString(<GroupFrame><span>x</span></GroupFrame>);
    expect(html).toContain('border border-base-300 rounded-box');
    expect(html).not.toContain('bg-');
  });

  /**
   * The point of the whole component. index.css spaces chord (125deg), bass
   * (256deg) and pad (40deg) around the OKLCH wheel so the three stay
   * separable; a group tint would undo that to say something the enclosure
   * already says. The frame groups by enclosure; the dots keep saying which is
   * which. This test is what stops a future "make the group read better"
   * change from adding one.
   */
  test('never names a module colour', () => {
    const html = renderToString(
      <GroupFrame label="Accompaniment"><span>x</span></GroupFrame>,
    );
    expect(html).not.toContain('module-chord');
    expect(html).not.toContain('module-bass');
    expect(html).not.toContain('module-pad');
    expect(html).not.toContain('text-primary');
    expect(html).not.toContain('text-accent');
  });

  test('renders the label in caps when given one', () => {
    const html = renderToString(<GroupFrame label="Accompaniment"><span>x</span></GroupFrame>);
    expect(html).toContain('uppercase');
    expect(html).toContain('Accompaniment');
  });

  test('renders no label element at all when given none', () => {
    const html = renderToString(<GroupFrame><span id="c">x</span></GroupFrame>);
    expect(html).not.toContain('uppercase');
    expect(html).toContain('id="c"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/ui/GroupFrame.test.tsx`
Expected: FAIL — "Cannot find module './GroupFrame'".

- [ ] **Step 3: Build it**

Create `src/components/ui/GroupFrame.tsx`:

```tsx
import React from 'react';

export interface GroupFrameProps {
  /**
   * Rendered in caps above the frame's contents. Omitted where the enclosing
   * card is already named for the group — Pattern › Accompaniment — because a
   * second label there duplicates the card title.
   */
  label?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A neutral enclosure that says "these belong together" and nothing else.
 *
 * It NEVER recolors its contents and carries no tint of its own. index.css
 * spaces the module hues around the OKLCH wheel deliberately and records that
 * chord (125deg), bass (256deg) and pad (40deg, the one recorded exception in
 * the amber band) must stay separable; a group tint would undo exactly that,
 * to express a grouping the enclosure already expresses. The frame groups by
 * enclosure; the dots keep saying which is which.
 *
 * Presentation only. controlTarget's persisted values are unchanged.
 */
export function GroupFrame({ label, className, children }: GroupFrameProps) {
  return (
    <div className={`border border-base-300 rounded-box p-1 ${className ?? ''}`}>
      {label !== undefined && (
        <span className="block text-[10px] uppercase tracking-wider text-base-content/50 font-semibold px-1 pb-0.5">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/ui/GroupFrame.test.tsx`
Expected: PASS. If the `not.toContain('bg-')` assertion fails, something in the class list carries a background — remove it rather than loosening the assertion; that assertion is the component's whole contract.

- [ ] **Step 5: Frame the Sound target chips**

`src/components/loop/SoundView.tsx`, old `:341-363` — the join renders `Object.keys(SYNTH_TARGET_STYLES)` in one `.map`. Split it into the lead chip and the framed three, keeping the button JSX identical by hoisting it into a local render function so it is written once:

```tsx
          <div
            className={`flex items-center gap-1 bg-base-200 border rounded-box p-1 shrink-0 ${SYNTH_TARGET_STYLES[controlTarget].border}`}
          >
            <span className="text-[10px] uppercase tracking-wider text-base-content/50 font-semibold pl-1 pr-1 hidden sm:inline">
              Target:
            </span>
            {renderTargetChip('synth')}
            {/* Chord, bass and pad are one job done three ways. The frame is
                inside the tinted outer group, not replacing it: the outer
                tint tracks the ACTIVE target, this one groups three of the
                four. See ui/GroupFrame for why it adds no colour. */}
            <GroupFrame label="Accompaniment" className="flex items-center gap-1">
              {(['chord', 'bass', 'pad'] as SynthControlTarget[]).map(renderTargetChip)}
            </GroupFrame>
          </div>
```

with, above the `return`:

```tsx
  const renderTargetChip = (target: SynthControlTarget) => (
    <button
      key={target}
      onClick={() => onChangeControlTarget(target)}
      className={`btn btn-xs text-[11px] font-semibold ${
        controlTarget === target
          ? SYNTH_TARGET_STYLES[target].activeBtn
          : "btn-ghost text-base-content/60"
      }`}
    >
      {SYNTH_TARGET_STYLES[target].label}
    </button>
  );
```

Note two deliberate changes carried in the above: the outer wrapper loses its `join` class and each chip loses `join-item`, because daisyUI's `join` requires its direct children to be the joined items and a `GroupFrame` between them breaks that contract — three chips inside a frame are no longer siblings of the first. Spacing is carried by `gap-1`, which the row already had. **Check the rendered result in both themes** — this is the one visual regression risk in the task.

Also confirm the four keys of `SYNTH_TARGET_STYLES` really are `synth`/`chord`/`bass`/`pad` in that order in `src/utils/synthControl.ts:19`; the explicit array above no longer derives from `Object.keys`, so a fifth target added later would silently not render, and that is worth a one-line comment saying so.

- [ ] **Step 6: Frame the mixer's middle three**

In `src/components/loop/SoundMixer.tsx`, replace the flat `.map` over `MIXER_CHANNELS` with three groups, derived from the table rather than re-listed:

```tsx
        <div className="flex flex-col gap-2">
          <MixerRow channel={MIXER_CHANNELS[0]} />
          <GroupFrame label="Accompaniment" className="flex flex-col gap-2">
            {MIXER_CHANNELS.slice(1, 4).map((channel) => (
              <MixerRow key={channel.idPrefix} channel={channel} />
            ))}
          </GroupFrame>
          <MixerRow channel={MIXER_CHANNELS[4]} />
        </div>
```

The indices are safe because `SoundMixer.test.tsx` (Task 7) pins the table's order and length; add a comment saying exactly that, so the coupling is visible:

```tsx
        {/* Indices, not a filter: SoundMixer.test.tsx pins MIXER_CHANNELS'
            order and length, so [0] is Lead, [1..3] are the accompaniment
            three and [4] is Beat. A filter would silently drop a row that got
            renamed; a bad index fails the suite. */}
```

Drop the responsive `grid` from Task 7's version in favour of the single column above — three framed rows inside a wrapping grid would put the frame's members on two lines.

- [ ] **Step 7: Frame the three module panels on Pattern › Accompaniment**

`src/components/loop/ChordView.tsx:928-942` renders `<ChordModulePanel …/>`, `<BassModulePanel …/>`, `<PadModulePanel />` as siblings. Wrap the three:

```tsx
      {/* No label: the segment header above already reads "Accompaniment", and
          a second one here would duplicate the card title (spec §3). */}
      <GroupFrame className="flex flex-col gap-3 sm:gap-4">
        <ChordModulePanel … />
        <BassModulePanel … />
        <PadModulePanel />
      </GroupFrame>
```

Keep each panel's existing props exactly as they are — copy the three elements verbatim from `:928-942` and only add the wrapper. The `gap-3 sm:gap-4` reproduces the `space-y-3 sm:space-y-4` the parent's root div was applying to them as siblings; **check that the spacing between the three panels is unchanged** after the wrap, since `space-y-*` on the parent no longer reaches them.

- [ ] **Step 8: Verify and commit**

```bash
bun run verify
git add -A
git commit -m "feat(ui): the neutral Accompaniment group frame, in its three places"
```

---

## Manual check before opening the PR

`bun run verify` does not press buttons, does not load a URL, and cannot see a colour. Run `bun run dev` and confirm, in this order:

1. **Every tab renders.** Loop › Sound, Loop › Pattern, Song › Arrange, Song › Master FX. Each shows content, not a blank page. Sound and each Pattern segment show exactly one header card, never two.
2. **Every segment renders.** On Pattern, click Lead, Accompaniment and Beat in turn. Lead shows the melody grid, Accompaniment the progression plus the three module panels, Beat the drum grid and its tools.
3. **The segment row appears only on Pattern.** Switch to Sound — the row is gone. Switch to Song › Arrange and Song › Master FX — still gone. Back to Pattern — the row is there and the segment you left is still selected.
4. **An old URL lands somewhere sensible.** Paste `http://localhost:3000/loop?tab=synth` into the address bar. It must open Loop › Sound and the URL must rewrite itself to `?tab=sound`. Repeat with `?tab=chords`, `?tab=sequencer` and `/song?tab=effects` (which must land on Arrange). Then check the back button still works after the rewrite — one history entry per navigation, not two.
5. **The Arrange deep link.** On Song › Arrange, click a loop card's edit affordance. It must open Loop › Sound for that loop, in one history entry.
6. **The mixer's five faders each move the right thing.** With the transport playing a loop that has all five layers sounding, drag each fader alone and confirm the layer that changes is the one named: Lead → the synth melody, Chord → the chord pad stabs, Bass → the bassline, Pad → the sustained pad, Beat → the drums. This is the check that catches a mis-typed `volumeKey`, which no test can catch because the table would still be self-consistent.
7. **The mixer's five mutes each mute the right thing.** Same procedure, one at a time. Pay particular attention to **Lead** and **Beat**: those two mutes have never had a UI before this phase, so they have never been exercised by a human.
8. **The kit still follows the grid across tabs.** On Pattern › Beat, pick a different drum grid. Switch to Sound: the Kit select must already show the grid's kit. Then reload the page — the kit must be the one you last chose, not "Retro Drive". That reload is the regression the `SequencerView` comment describes.
9. **Both themes.** Toggle light/dark and re-check Sound and each Pattern segment. Specifically: the Accompaniment frame must be visible but quiet in both — a 1px neutral line, not a box that competes with the module dots — and the three chord/bass/pad chips inside it must still read as three different colours.
10. **Narrow widths.** At ~380px and at ~1000px, confirm the two loop tabs and the three segment buttons all fit without the navbar growing an extra row, and that the segment labels are still readable (they are never `xl`-only).
