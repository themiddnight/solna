# Loop / Song Layers (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Solna's flat five-tab UI into two layers (loop editor + song/arrange) with hand-rolled two-path routing and a layer-boundary hard stop, while renaming "region"→"loop" throughout.

**Architecture:** The store already models a loop (SP3's `Region`) and a song mode; SP4 renames that model, adds a two-path URL (`/loop` + `/song`) read by a hand-rolled route-sync (no router library, all views stay mounted), keys play mode on the layer, and moves components into `components/loop/` + `components/song/`.

**Tech Stack:** React 18, Vite, Zustand v5 (persist + subscribeWithSelector), Bun (test runner + tsc lint), daisyUI theme tokens, raw Web Audio API.

**Spec:** `docs/superpowers/specs/2026-08-30-sp4-loop-song-layers-design.md`

## Global Constraints

- **Runtime is Bun.** `bun run dev` (Vite), `bun test <file>` (single file), `bun test -t "name"` (single test), `bun run lint` (tsc --noEmit), `bun run eslint` (import-layering), `bun run verify` (test + lint + check:keys + check:drums + build — the gate).
- **Tests are pure-logic** (`bun:test`, no DOM/testing-library). Components export helpers; tests import those. A mechanical rename's test is type-check + the renamed suite staying green.
- **Three-layer import boundaries** (enforced by `no-restricted-imports`): `audio/` never imports `store/` or `components/`; `store/` never imports `components/`; `components/` never imports `audio/engine` (except the 3 analyser consumers). `src/routing/` is outside the three layers; it may import `store/` (as `useTabRouting.ts` already does) but `store/` must never import `routing/`.
- **Persist:** key `musibox_project_state_v1`, `partialize` + `migrate` + `sanitizePersistedState` in `store.ts`; guarded localStorage with in-memory `memoryStorage` fallback. Current version **6** → becomes **7**.
- **No `tailwind.config.*`**; daisyUI theme-token roles only; `scripts/themeTokenGuard.ts` must stay green (no raw hex, palette classes, `text-white`/`bg-black`, `dark:`, `rgb()`/`rgba()`, dead utilities).
- **Store→engine bridge is `engineSync.ts`.** Never call engine setters from a component; add state to a slice and wire it in `engineSync.ts`.
- **Terminology lock:** the second layer is **"song"** (song page / song mode / song layer). The word **"main"** is banned. After Task 1, **"region" is banned** except inside `migrate.ts`'s `renameRegionKeysToLoop` (which exists only to translate the historical v6 key). The `'arrange'` tab name, `'effects'`/`'synth'`/`'sequencer'`/`'chords'` `ViewMode` values, and the `ArrangeView` component name are **kept**.
- **Commit messages:** conventional-commit style; end with the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **Do not call engine setters from components.** Do not unmount views on navigation (the block/hidden mount model preserves audio continuity within a layer).

---

### Task 1: Rename region→loop across the codebase + migrate v6→v7

The rename is atomic: `Loop` replaces `Region` everywhere, `loops` replaces `regions`, and it must land as one change or nothing compiles. The only *new behavior* is the v6→v7 migration, which is TDD'd; everything else is a mechanical rename verified by type-check + the renamed suite.

**Files:**
- Rename: `src/store/region.ts`→`loop.ts`, `src/store/regionSlice.ts`→`loopSlice.ts`, `src/store/loadRegion.ts`→`loadLoop.ts`, `src/store/regionSync.ts`→`loopSync.ts`
- Rename: `src/components/RegionSelector.tsx`→`LoopSelector.tsx`
- Rename: `src/store/region.test.ts`→`loop.test.ts`, `src/store/regionSlice.test.ts`→`loopSlice.test.ts`, `src/store/loadRegion.test.ts`→`loadLoop.test.ts`, `src/store/regionSync.test.ts`→`loopSync.test.ts`, `src/components/RegionSelector.test.tsx`→`LoopSelector.test.tsx`
- Modify: `src/store/types.ts`, `src/store/migrate.ts`, `src/store/store.ts`, `src/store/songMode.ts`, `src/store/transportSlice.ts`, `src/store/instantVibes.ts`, every file that references a renamed identifier (find with `grep -rn "region\|Region" src/` — includes `App.tsx`, `Header.tsx`, `ArrangeView.tsx`, `vibeVariation.ts`, `instantVibes*.ts`, `migrate.test.ts`, `songMode.test.ts`, `store.test.ts`, and docs comments).

**Interfaces:**
- Consumes: the SP3 region model exactly as-is.
- Produces (used by every later task): type `Loop`, `LoopStatePatch`, `LoopMixPatch`, `LoopSlice`; slice fields `loops`, `activeLoopId`, `songLoopIndex`; functions `loadLoop(id)`, `loopStatePatch`, `loopBars`, `newLoopId`, `nextLoopName`, `cloneLoop`, `fallbackActiveLoopId`, `loopLengthSteps`, `nextLoopIndex`, `LOOP_FLAT_KEYS`; actions `addLoop`/`duplicateLoop`/`deleteLoop`/`reorderLoops`/`setActiveLoop`/`setLoopMix`; component `LoopSelector`; migrate `renameRegionKeysToLoop`; persist `version: 7`.

**Rename map (verbatim, from the spec):**

| Old | New |
|---|---|
| `Region` | `Loop` |
| `RegionStatePatch` | `LoopStatePatch` |
| `RegionMixPatch` | `LoopMixPatch` |
| `RegionSlice` | `LoopSlice` |
| `regions` | `loops` |
| `activeRegionId` | `activeLoopId` |
| `songRegionIndex` | `songLoopIndex` |
| `loadRegion` | `loadLoop` |
| `regionBars` | `loopBars` |
| `newRegionId` | `newLoopId` |
| `nextRegionName` | `nextLoopName` |
| `cloneRegion` | `cloneLoop` |
| `regionStatePatch` | `loopStatePatch` |
| `regionLengthSteps` | `loopLengthSteps` |
| `nextRegionIndex` | `nextLoopIndex` |
| `fallbackActiveId` | `fallbackActiveLoopId` |
| `addRegion`/`duplicateRegion`/`deleteRegion`/`reorderRegions`/`setActiveRegion`/`setRegionMix` | `addLoop`/`duplicateLoop`/`deleteLoop`/`reorderLoops`/`setActiveLoop`/`setLoopMix` |
| `RegionSelector` | `LoopSelector` |
| `"Region N"` | `"Loop N"` |
| `REGION_FLAT_KEYS` | `LOOP_FLAT_KEYS` |
| `DEFAULT_REGION_ID` | `DEFAULT_LOOP_ID` |
| `createDefaultRegion` | `createDefaultLoop` |
| `createRegionSlice` | `createLoopSlice` |
| `wrapFlatStateIntoRegion` | `wrapFlatStateIntoLoop` |
| `isSongTab` | `isSongLayer` (body changes — see Task 4; do the *rename* here, keep `tab === 'arrange'` for now, Task 4 widens it) |

**Kept unchanged:** `ViewMode` values `'synth'|'sequencer'|'chords'|'effects'|'arrange'`, `ArrangeView`, the "arrange" tab name.

- [ ] **Step 1: Write the failing migration test**

Append to `src/store/migrate.test.ts` (create `migrate.test.ts` import of the new fn alongside the existing `wrapFlatStateIntoRegion` test):

```ts
import { renameRegionKeysToLoop } from './migrate';

test('renameRegionKeysToLoop renames the two persisted keys and leaves the rest', () => {
  const state = {
    regions: [{ id: 'a', name: 'Region 1' }],
    activeRegionId: 'a',
    bpm: 128,
  };
  const out = renameRegionKeysToLoop(state);
  expect(out.loops).toEqual([{ id: 'a', name: 'Region 1' }]);
  expect(out.activeLoopId).toBe('a');
  expect(out.regions).toBeUndefined();
  expect(out.activeRegionId).toBeUndefined();
  expect(out.bpm).toBe(128);
});

test('renameRegionKeysToLoop is a no-op when the keys are already absent', () => {
  const state = { loops: [], activeLoopId: null, bpm: 100 };
  expect(renameRegionKeysToLoop(state)).toEqual({ loops: [], activeLoopId: null, bpm: 100 });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun test src/store/migrate.test.ts -t "renameRegionKeysToLoop"`
Expected: FAIL — `renameRegionKeysToLoop is not a function` / import error.

- [ ] **Step 3: Add the migration function**

In `src/store/migrate.ts`, add (and change the `import { newRegionId, REGION_FLAT_KEYS } from './region'` to `import { newLoopId, LOOP_FLAT_KEYS } from './loop'`):

```ts
export function renameRegionKeysToLoop<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
  if ('regions' in next) {
    next.loops = next.regions;
    delete next.regions;
  }
  if ('activeRegionId' in next) {
    next.activeLoopId = next.activeRegionId;
    delete next.activeRegionId;
  }
  return next as unknown as T;
}
```

Rename `wrapFlatStateIntoRegion` → `wrapFlatStateIntoLoop` and change its body to emit the loop shape (so no "region" survives the chain):

```ts
export function wrapFlatStateIntoLoop<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
  const loop: Record<string, unknown> = { id: newLoopId(), name: 'Loop 1' };
  for (const key of LOOP_FLAT_KEYS) {
    if (key in next) loop[key] = next[key];
  }
  next.loops = [loop];
  next.activeLoopId = loop.id;
  for (const key of LOOP_FLAT_KEYS) delete next[key];
  return next as unknown as T;
}
```

- [ ] **Step 4: Wire the chain and bump the version**

In `src/store/store.ts`:
- Change `version: 6` → `version: 7`.
- Import `renameRegionKeysToLoop` and `wrapFlatStateIntoLoop` (replacing the `wrapFlatStateIntoRegion` import).
- Rewire `migrate` so the loop-rename runs last, after the wrap, for every `version < 7`:

```ts
const wrapped = (payload: PersistedState): PersistedState =>
  version >= 6 ? payload : (wrapFlatStateIntoLoop(payload) as PersistedState);
const looped = (payload: PersistedState): PersistedState =>
  version >= 7 ? payload : (renameRegionKeysToLoop(payload) as PersistedState);
if (version >= 2) return looped(wrapped(metered(recoloured)));
// v1 arp fix branch: also return looped(wrapped(metered(next))) at the end.
```

- [ ] **Step 5: Run the migration tests**

Run: `bun test src/store/migrate.test.ts`
Expected: PASS (both new tests, plus the renamed `wrapFlatStateIntoLoop` test asserting `loops`/`activeLoopId`). If the existing `wrapFlatStateIntoRegion` test still asserts `regions`, rename its assertions to `loops`/`activeLoopId`.

- [ ] **Step 6: Perform the mechanical rename**

Apply the rename map across `src/` and the test files. Use `grep -rn "region\|Region\|regions\|REGION" src/` repeatedly until the only remaining hit is `renameRegionKeysToLoop`'s own internals (the `regions`/`activeRegionId` string literals it translates). Rename the files listed above (`git mv`), then fix imports. This includes, notably:
- `src/store/types.ts`: `Region`→`Loop`, `RegionStatePatch`→`LoopStatePatch`, `RegionMixPatch`→`LoopMixPatch`, `RegionSlice`→`LoopSlice`, `regions`/`activeRegionId`/`songRegionIndex` field renames.
- `src/store/songMode.ts`: `songRegionIndex`→`songLoopIndex`, `regions`→`loops`, `regionLengthSteps`→`loopLengthSteps`, `nextRegionIndex`→`nextLoopIndex`, `loadRegion`→`loadLoop`, `isSongTab`→`isSongLayer` (keep body `tab === 'arrange'` for now).
- `src/store/transportSlice.ts`: `songRegionIndex`→`songLoopIndex`, `setSongRegionIndex`→`setSongLoopIndex`.
- `src/store/instantVibes.ts` + `vibeVariation.ts`: any `loadRegion`/`regions` references.

- [ ] **Step 7: Update `store.ts` partialize + sanitize + merge**

In `src/store/store.ts`, apply these exact changes:
- `partializeAppState`: `regions: state.regions` → `loops: state.loops`; `activeRegionId: state.activeRegionId` → `activeLoopId: state.activeLoopId`.
- `sanitizeRegions` → rename to `sanitizeLoops`; its `Region[]` return → `Loop[]`; `createDefaultRegion()` → `createDefaultLoop()`; `Region ${regions.length + 1}` fallback name → `Loop ${loops.length + 1}`.
- In `sanitizePersistedState`, the v6 block becomes:

```ts
const loops = sanitizeLoops(sanitized.loops);
if (loops) {
  sanitized.loops = loops;
  if (
    typeof sanitized.activeLoopId !== 'string' ||
    !loops.some((l) => l.id === sanitized.activeLoopId)
  ) {
    sanitized.activeLoopId = loops[0].id;
  }
} else {
  delete sanitized.loops;
  delete sanitized.activeLoopId;
}
```

- In `merge`, the tail becomes:

```ts
const loops = sanitized.loops as Loop[] | undefined;
if (Array.isArray(loops) && loops.length > 0) {
  const activeId =
    typeof sanitized.activeLoopId === 'string' ? sanitized.activeLoopId : loops[0].id;
  const active = loops.find((l) => l.id === activeId) ?? loops[0];
  return { ...withPresets, loops, activeLoopId: active.id, ...loopStatePatch(active) };
}
return withPresets;
```

- [ ] **Step 8: Type-check and run the full suite**

Run: `bun run lint` then `bun test`
Expected: both green. Any leftover `region`/`Region` reference is a compile error — fix it.

- [ ] **Step 9: Commit**

```bash
git add -A src/
git commit -m "refactor(store): rename region to loop and migrate persisted state to v7

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Layer model + routing pure helpers

Add the loop/song layer taxonomy to `types.ts` and the pure, path-aware route helpers to `tabRouting.ts`. All TDD.

**Files:**
- Modify: `src/types.ts`, `src/routing/tabRouting.ts`, `src/routing/tabRouting.test.ts`

**Interfaces:**
- Consumes: `ViewMode` (types.ts); Task 1's rename (no `region` left).
- Produces: `Layer`, `isSongLayer`, `layerForTab`, `LOOP_TABS`, `SONG_TABS` (types.ts); `LAYER_PATHS`, `parseLayerPath`, `defaultTabForLayer`, `tabsForLayer`, `parseLoopId`, `resolveRoute`, `buildRouteUrl` (tabRouting.ts).

- [ ] **Step 1: Write the failing tests**

In `src/routing/tabRouting.test.ts`, add:

```ts
import { isSongLayer, layerForTab } from '../types';
import {
  parseLayerPath, defaultTabForLayer, parseLoopId, resolveRoute, buildRouteUrl,
} from './tabRouting';

test('isSongLayer is true only for arrange and effects', () => {
  expect(isSongLayer('arrange')).toBe(true);
  expect(isSongLayer('effects')).toBe(true);
  expect(isSongLayer('synth')).toBe(false);
  expect(isSongLayer('sequencer')).toBe(false);
  expect(isSongLayer('chords')).toBe(false);
});

test('layerForTab maps the five tabs to loop or song', () => {
  expect(layerForTab('synth')).toBe('loop');
  expect(layerForTab('sequencer')).toBe('loop');
  expect(layerForTab('chords')).toBe('loop');
  expect(layerForTab('arrange')).toBe('song');
  expect(layerForTab('effects')).toBe('song');
});

test('parseLayerPath maps unknown and loop paths to loop, song to song', () => {
  expect(parseLayerPath('/loop')).toBe('loop');
  expect(parseLayerPath('/song')).toBe('song');
  expect(parseLayerPath('/')).toBe('loop');
  expect(parseLayerPath('/anything')).toBe('loop');
});

test('resolveRoute normalizes a missing or layer-mismatched tab to the layer default', () => {
  expect(resolveRoute('/loop', '?tab=sequencer').tab).toBe('sequencer');
  expect(resolveRoute('/loop', '').tab).toBe('synth');            // missing tab → default
  expect(resolveRoute('/loop', '?tab=arrange').tab).toBe('synth'); // arrange on loop layer → default
  expect(resolveRoute('/song', '?tab=effects').tab).toBe('effects');
  expect(resolveRoute('/song', '?tab=chords').tab).toBe('arrange'); // chords on song layer → default
});

test('resolveRoute reports needsNormalize for wrong path, wrong tab, or loopId on song layer', () => {
  expect(resolveRoute('/', '?tab=synth').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=arrange').needsNormalize).toBe(true);
  expect(resolveRoute('/song', '?tab=arrange&loopId=x').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=synth').needsNormalize).toBe(false);
});

test('parseLoopId extracts the loopId param', () => {
  expect(parseLoopId('?tab=synth&loopId=abc')).toBe('abc');
  expect(parseLoopId('?tab=synth')).toBe(null);
});

test('buildRouteUrl builds a two-path URL and only adds loopId on the loop layer', () => {
  expect(buildRouteUrl('loop', 'synth', 'abc')).toBe('/loop?tab=synth&loopId=abc');
  expect(buildRouteUrl('song', 'arrange')).toBe('/song?tab=arrange');
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/routing/tabRouting.test.ts`
Expected: FAIL — `isSongLayer`, `layerForTab`, `parseLayerPath`, `resolveRoute`, `buildRouteUrl` not defined.

- [ ] **Step 3: Add the layer taxonomy to types.ts**

Append to `src/types.ts` (after `ViewMode`):

```ts
export type Layer = 'loop' | 'song';

export const LOOP_TABS: readonly ViewMode[] = ['synth', 'sequencer', 'chords'];
export const SONG_TABS: readonly ViewMode[] = ['arrange', 'effects'];

export function isSongLayer(tab: ViewMode): boolean {
  return tab === 'arrange' || tab === 'effects';
}

export function layerForTab(tab: ViewMode): Layer {
  return isSongLayer(tab) ? 'song' : 'loop';
}
```

- [ ] **Step 4: Add the pure route helpers to tabRouting.ts**

```ts
import type { Layer, ViewMode } from '../types';
import { LOOP_TABS, SONG_TABS } from '../types';

export const LAYER_PATHS: Record<Layer, string> = { loop: 'loop', song: 'song' };

export function parseLayerPath(pathname: string): Layer {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return first === 'song' ? 'song' : 'loop';
}

export function defaultTabForLayer(layer: Layer): ViewMode {
  return layer === 'song' ? 'arrange' : 'synth';
}

export function tabsForLayer(layer: Layer): readonly ViewMode[] {
  return layer === 'song' ? SONG_TABS : LOOP_TABS;
}

export function parseLoopId(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get('loopId');
}

export interface ResolvedRoute {
  layer: Layer;
  tab: ViewMode;
  loopId: string | null;
  needsNormalize: boolean;
}

export function resolveRoute(pathname: string, search: string): ResolvedRoute {
  const layer = parseLayerPath(pathname);
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const rawTab = params.get('tab');
  const tab = rawTab && tabsForLayer(layer).includes(rawTab as ViewMode)
    ? (rawTab as ViewMode)
    : defaultTabForLayer(layer);
  const loopId = params.get('loopId');
  const needsNormalize =
    pathname !== `/${LAYER_PATHS[layer]}` ||
    tab !== rawTab ||
    (loopId !== null && layer !== 'loop');
  return { layer, tab, loopId, needsNormalize };
}

export function buildRouteUrl(layer: Layer, tab: ViewMode, loopId?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (layer === 'loop' && loopId) params.set('loopId', loopId);
  return `/${LAYER_PATHS[layer]}?${params.toString()}`;
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `bun test src/routing/tabRouting.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/routing/tabRouting.ts src/routing/tabRouting.test.ts
git commit -m "feat(routing): add loop/song layer model and path-aware route helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `useRouteSync` two-way hook (replaces `useTabRouting`)

Extend the tab-sync hook into a route-sync that keeps **layer** (derived), **tab**, and **active loop id** in two-way sync with `pathname` + `search`. The pure `resolveRoute`/`buildRouteUrl` are already tested; this task tests the pure resolver-wrapper and wires the hook.

**Files:**
- Rename: `src/routing/useTabRouting.ts` → `src/routing/useRouteSync.ts`
- Rename: `src/routing/useTabRouting.test.ts` → `src/routing/useRouteSync.test.ts`
- Modify: `src/App.tsx` (swap `useTabRouting` → `useRouteSync`)

**Interfaces:**
- Consumes: `resolveRoute`, `buildRouteUrl`, `parseLoopId`, `layerForTab` (Task 2); `loadLoop` (Task 1); `useAppStore`.
- Produces: `resolveInitialRoute(search, pathname)` pure fn + `useRouteSync()` hook (App.tsx's only routing call).

- [ ] **Step 1: Write the failing test**

In `src/routing/useRouteSync.test.ts` (after `git mv` of the old test), replace the body with:

```ts
import { resolveInitialRoute } from './useRouteSync';

test('resolveInitialRoute adopts URL tab and loopId, normalizes a missing tab', () => {
  expect(resolveInitialRoute('/loop', '?tab=chords&loopId=abc')).toEqual({
    tab: 'chords',
    loopId: 'abc',
    needsNormalize: false,
  });
  expect(resolveInitialRoute('/loop', '').tab).toBe('synth');
  expect(resolveInitialRoute('/song', '?tab=arrange').tab).toBe('arrange');
  expect(resolveInitialRoute('/', '?tab=synth').needsNormalize).toBe(true);
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/routing/useRouteSync.test.ts`
Expected: FAIL — `resolveInitialRoute` not exported.

- [ ] **Step 3: Implement the resolver + hook**

Rewrite `src/routing/useRouteSync.ts`:

```ts
import { useEffect } from 'react';
import type { ViewMode } from '../types';
import { layerForTab } from '../types';
import { useAppStore } from '../store/store';
import { loadLoop } from '../store/loadLoop';
import { buildRouteUrl, resolveRoute, parseLoopId } from './tabRouting';

export function resolveInitialRoute(
  pathname: string,
  search: string,
): { tab: ViewMode; loopId: string | null; needsNormalize: boolean } {
  const { tab, loopId, needsNormalize } = resolveRoute(pathname, search);
  return { tab, loopId, needsNormalize };
}

export function useRouteSync(): void {
  useEffect(() => {
    // Mount: URL wins — adopt tab and loopId, then normalize a bad URL.
    const { tab, loopId, needsNormalize } = resolveRoute(
      window.location.pathname,
      window.location.search,
    );
    const state = useAppStore.getState();
    state.setActiveTab(tab);
    if (loopId && loopId !== state.activeLoopId) loadLoop(loopId);
    if (needsNormalize) {
      window.history.replaceState(
        window.history.state,
        '',
        buildRouteUrl(resolveRoute(window.location.pathname, window.location.search).layer, tab, loopId),
      );
    }

    // Back/forward: mirror URL into the store, never push.
    const handlePopState = () => {
      const r = resolveRoute(window.location.pathname, window.location.search);
      const s = useAppStore.getState();
      s.setActiveTab(r.tab);
      if (r.loopId && r.loopId !== s.activeLoopId) loadLoop(r.loopId);
    };
    window.addEventListener('popstate', handlePopState);

    // Store-driven changes push, skipped when the URL already matches.
    const unsubTab = useAppStore.subscribe(
      (state) => state.activeTab,
      (activeTab) => {
        const current = resolveRoute(window.location.pathname, window.location.search);
        if (current.tab !== activeTab) {
          // Derive the layer from the NEW tab, not the current URL path — a
          // cross-layer switch must move the path (/loop ↔ /song), not keep it.
          window.history.pushState(
            window.history.state,
            '',
            buildRouteUrl(layerForTab(activeTab), activeTab, parseLoopId(window.location.search)),
          );
        }
      },
    );
    const unsubLoop = useAppStore.subscribe(
      (state) => state.activeLoopId,
      (activeLoopId) => {
        const current = resolveRoute(window.location.pathname, window.location.search);
        if (current.layer === 'loop' && parseLoopId(window.location.search) !== activeLoopId) {
          window.history.pushState(
            window.history.state,
            '',
            buildRouteUrl(current.layer, current.tab, activeLoopId),
          );
        }
      },
    );

    return () => {
      window.removeEventListener('popstate', handlePopState);
      unsubTab();
      unsubLoop();
    };
  }, []);
}
```

- [ ] **Step 4: Update App.tsx**

In `src/App.tsx`, change the import `useTabRouting` → `useRouteSync` and the call `useTabRouting();` → `useRouteSync();`.

- [ ] **Step 5: Run tests + type-check**

Run: `bun test src/routing/useRouteSync.test.ts` then `bun run lint`
Expected: PASS + clean. (`App.test.tsx` may import `useTabRouting`; fix its import if so.)

- [ ] **Step 6: Commit**

```bash
git add src/routing/ src/App.tsx
git commit -m "feat(routing): add two-way /loop and /song route sync with loopId

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Play mode keyed on layer + layer-boundary hard stop

Widen `isSongLayer` (already renamed in Task 1) to include `effects`, and replace SP3's detach rule with a hard stop at the layer boundary. Pure logic is TDD'd via `songMode.ts`'s injected-deps pattern.

**Files:**
- Modify: `src/store/songMode.ts`, `src/store/songMode.test.ts`, `src/types.ts` (drop the now-duplicate `isSongLayer` if Task 2 defined it — consolidate to types.ts and re-import in songMode.ts)

**Interfaces:**
- Consumes: `isSongLayer`/`layerForTab` (types.ts), `hardStopAll` + `setSongLoopIndex` (transportSlice), `loadLoop`, `loops`/`activeLoopId`/`songLoopIndex` (store).
- Produces: `isSongLayer(tab)` (final, `arrange || effects`), `startSongModeSync` with the hard-stop boundary and no detach branch; pure `songAdvanceTarget`, `loopLengthSteps`, `nextLoopIndex`, `enterSongIndex` (unchanged semantics).

- [ ] **Step 1: Write the failing tests**

In `src/store/songMode.test.ts`, add:

```ts
import { isSongLayer } from '../types';

test('isSongLayer is true for both song-layer tabs', () => {
  expect(isSongLayer('arrange')).toBe(true);
  expect(isSongLayer('effects')).toBe(true);
  expect(isSongLayer('synth')).toBe(false);
});
```

And add a boundary test using the injectable `subscribeClock`/store pattern already in this file — assert that, starting from a state where the layer changes from loop to song while playing, the reconcile path (a) calls `hardStopAll` (spy on `useAppStore.setState` or a captured flag) and (b) sets `songLoopIndex = null`. If `startSongModeSync` is currently tested by driving the real store, extend the existing test's fake state rather than introducing a new harness.

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/store/songMode.test.ts -t "isSongLayer"`
Expected: FAIL (or the boundary test fails because the detach rule is still in place).

- [ ] **Step 3: Consolidate + widen `isSongLayer`**

`isSongLayer` lives in `src/types.ts` (Task 2) with body `tab === 'arrange' || tab === 'effects'` — already correct. In `src/store/songMode.ts`, delete the local `isSongTab` definition (renamed in Task 1) and import `isSongLayer`/`layerForTab` from `../types`. Update `startSongModeSync`'s `isSongTab(s.activeTab)` call sites to `isSongLayer(s.activeTab)`.

- [ ] **Step 4: Replace detach with the layer-boundary hard stop**

Rewrite `startSongModeSync`'s `reconcile` (and remove the now-unused `detachSongPosition` export + its test) so that:

1. It tracks the previous layer across calls (a closure `let prevLayer: Layer | null = null`).
2. On each reconcile, computes `const layer = layerForTab(s.activeTab)`.
3. If `prevLayer !== null && prevLayer !== layer`, it is a boundary crossing: call `s.hardStopAll()` and `s.setSongLoopIndex(null)`.
4. Then the song-mode logic runs as before, but **entering the song layer no longer auto-starts the song** — song mode is entered only when a player is already `playing` (not `stopping`), and `songLoopIndex` is established from the active loop's index (`enterSongIndex`) without an explicit `loadLoop(regions[0])` auto-start. Remove the `'stopping' vs 'stopped'` guard and the `queueMicrotask` double-fire guard; `songAdvanceTarget`'s boundary swap can run synchronously since there is no cross-layer continuity to protect.

The simplified `reconcile` shape:

```ts
const reconcile = () => {
  const s = useAppStore.getState();
  const layer = layerForTab(s.activeTab);
  if (prevLayer !== null && prevLayer !== layer) {
    s.hardStopAll();
    s.setSongLoopIndex(null);
    stopClock();
    unsubClock = null;
  }
  prevLayer = layer;

  const playing =
    s.sequencerPlayer === 'playing' || s.chordsPlayer === 'playing' || s.leadPlayer === 'playing';
  if (layer === 'song' && playing) {
    if (s.songLoopIndex === null) {
      useAppStore.setState({ songLoopIndex: enterSongIndex(s.loops, s.activeLoopId) });
    }
    if (!unsubClock) {
      unsubClock = subscribeClock((step) => {
        const cur = useAppStore.getState();
        if (cur.songLoopIndex === null) return;
        if (
          cur.sequencerPlayer !== 'playing' &&
          cur.chordsPlayer !== 'playing' &&
          cur.leadPlayer !== 'playing'
        ) return;
        const target = songAdvanceTarget(cur.loops, cur.songLoopIndex, step, getMeter(cur.meterId).stepsPerBar);
        if (target === null) return;
        loadLoop(target);
      });
    }
  } else if (layer !== 'song' && s.songLoopIndex !== null) {
    s.setSongLoopIndex(null);
    stopClock();
  }
};
```

(The exact set of fields the store subscription selects may need to add the layer-derived comparison; keep the existing `equalityFn` shape.)

- [ ] **Step 5: Update the removed `detachSongPosition` references**

Delete `detachSongPosition` (and its import/test) — nothing else references it after this task.

- [ ] **Step 6: Run tests + type-check**

Run: `bun test src/store/songMode.test.ts` then `bun run lint`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add src/store/songMode.ts src/store/songMode.test.ts src/types.ts
git commit -m "feat(transport): key play mode on layer and hard-stop at the loop/song boundary

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Directory restructure — components into `loop/` + `song/`

Move the layer-owned components into `src/components/loop/` and `src/components/song/` and fix import paths. No behavior change; verified by type-check + eslint.

**Files (moves + import updates):**
- `src/components/SynthView.tsx` → `src/components/loop/SynthView.tsx`
- `src/components/ChordView.tsx` → `src/components/loop/ChordView.tsx`
- `src/components/SequencerView.tsx` → `src/components/loop/SequencerView.tsx`
- `src/components/lead/` → `src/components/loop/lead/`
- `src/components/LoopSelector.tsx` → `src/components/loop/LoopSelector.tsx`
- `src/components/ArrangeView.tsx` → `src/components/song/ArrangeView.tsx`
- `src/components/EffectsRackView.tsx` → `src/components/song/EffectsRackView.tsx`
- Follow-parent moves into `loop/`: `ChordPresetLibrary.tsx`, `SynthPresetLibrary.tsx`, `DrumPads.tsx`, `SimpleSynthPanel.tsx`, and the `chord/` + `sequencer/` helper dirs, plus their `.test.*` files.
- Stay at `src/components/` root: `Header.tsx`, `TransportBar.tsx`, `InstantVibesBar.tsx`, `AudioVisualizer.tsx`, `PlayheadReadout.tsx`, `ui/`, and shared helpers (`fxDescriptors`, `meterSelect`, `playerStop`, `sequencerGrid`, `usePlayheadSync`, `useSequencerPlayback`, `viewMeta`).

**Interfaces:**
- Consumes: Task 1–4 (all names already `loop`-based; no `region`).
- Produces: the moved files at their new paths; every import updated. No export signatures change.

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/components/loop src/components/song
git mv src/components/SynthView.tsx src/components/loop/SynthView.tsx
git mv src/components/ChordView.tsx src/components/loop/ChordView.tsx
git mv src/components/SequencerView.tsx src/components/loop/SequencerView.tsx
git mv src/components/lead src/components/loop/lead
git mv src/components/LoopSelector.tsx src/components/loop/LoopSelector.tsx
git mv src/components/ArrangeView.tsx src/components/song/ArrangeView.tsx
git mv src/components/EffectsRackView.tsx src/components/song/EffectsRackView.tsx
git mv src/components/ChordPresetLibrary.tsx src/components/loop/ChordPresetLibrary.tsx
git mv src/components/SynthPresetLibrary.tsx src/components/loop/SynthPresetLibrary.tsx
git mv src/components/DrumPads.tsx src/components/loop/DrumPads.tsx
git mv src/components/SimpleSynthPanel.tsx src/components/loop/SimpleSynthPanel.tsx
git mv src/components/chord src/components/loop/chord
git mv src/components/sequencer src/components/loop/sequencer
```

Also move the corresponding `.test.*` files alongside (e.g. `ArrangeView.test.tsx` → `song/`, `RegionSelector`-renamed `LoopSelector.test.tsx` → `loop/`, `SynthView.test.tsx`, `ChordView.test.tsx`, `SequencerView.test.tsx`, `DrumPads.test.tsx`, `SimpleSynthPanel.test.tsx`, `ChordPresetLibrary.test.tsx`, `SynthPresetLibrary.test.tsx` → `loop/`).

- [ ] **Step 2: Fix import paths**

Run `bun run lint` and fix every broken relative import (the compiler lists them). Imports that crossed into the moved files must now go through `./loop/…` or `./song/…`; imports *within* a moved subtree (`loop/SynthView.tsx` importing `./lead/LeadPianoRoll`) keep working. `src/App.tsx` and `src/components/Header.tsx` imports of `SynthView`/`ChordView`/`SequencerView`/`ArrangeView`/`EffectsRackView`/`LoopSelector` are updated to the new subdir paths (they are rewritten again in Task 6 to use the page wrappers).

- [ ] **Step 3: Run lint + eslint + tests**

Run: `bun run lint` then `bun run eslint` then `bun test`
Expected: all green. `eslint` must pass the `no-restricted-imports` layering (moves stay within `components/`).

- [ ] **Step 4: Commit**

```bash
git add -A src/components/
git commit -m "refactor(components): split into loop/ and song/ layer directories

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `LoopPage` / `SongPage` wrappers + `App.tsx` rewrite

Introduce the two page wrappers and make `App.tsx` toggle them by layer, replacing the flat five-tab toggle. Views stay mounted (block/hidden) inside each page.

**Files:**
- Create: `src/components/loop/LoopPage.tsx`, `src/components/song/SongPage.tsx`
- Modify: `src/App.tsx`, `src/components/Header.tsx` (relabel loop/song groups)

**Interfaces:**
- Consumes: `isSongLayer`/`layerForTab` (types.ts), `activeTab` (uiSlice), the moved views (Task 5).
- Produces: `LoopPage` (LoopSelector + three toggled tabs), `SongPage` (arrange + effects toggled); `App.tsx` renders `<LoopPage/>` + `<SongPage/>` gated by layer.

- [ ] **Step 1: Write `LoopPage`**

`src/components/loop/LoopPage.tsx`:

```tsx
import { useAppStore } from '../../store/store';
import { LoopSelector } from './LoopSelector';
import { SynthView } from './SynthView';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';

export const LoopPage: React.FC = () => {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <LoopSelector />
      <div className={activeTab === 'synth' ? 'block' : 'hidden'}><SynthView /></div>
      <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}><SequencerView /></div>
      <div className={activeTab === 'chords' ? 'block' : 'hidden'}><ChordView /></div>
    </>
  );
};
```

- [ ] **Step 2: Write `SongPage`**

`src/components/song/SongPage.tsx`:

```tsx
import { useAppStore } from '../../store/store';
import { ArrangeView } from './ArrangeView';
import { EffectsRackView } from './EffectsRackView';

export const SongPage: React.FC = () => {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'arrange' ? 'block' : 'hidden'}><ArrangeView /></div>
      <div className={activeTab === 'effects' ? 'block' : 'hidden'}><EffectsRackView /></div>
    </>
  );
};
```

- [ ] **Step 3: Rewrite `App.tsx` body**

Replace the five `<div className={activeTab === …}>` blocks with:

```tsx
<main className="flex-1 min-h-0 relative overflow-y-auto">
  <div className={isSongLayer(activeTab) ? 'hidden' : 'block'}>
    <LoopPage />
  </div>
  <div className={isSongLayer(activeTab) ? 'block' : 'hidden'}>
    <SongPage />
  </div>
</main>
```

Import `LoopPage`, `SongPage`, and `isSongLayer`; drop the now-unused `SynthView`/`SequencerView`/`ChordView`/`EffectsRackView`/`ArrangeView` imports. Keep the `useEngineSync`, `useRouteSync`, `usePlayheadSync`, `useLoopSync` (renamed `useRegionSync`), `useSongModeSync` calls.

- [ ] **Step 4: Relabel the Header groups**

In `src/components/Header.tsx`, the existing `AUTOMATION_TABS` (synth/sequencer/chords with their transport join) are the **loop** tabs and `SOLO_TABS` (`['arrange','effects']`) are the **song** tabs. Rename `SOLO_TABS` → `SONG_NAV_TABS` and add a comment to `AUTOMATION_TABS` ("loop-layer tabs"). No visual change required — the nav already groups them; `setActiveTab` now routes through `useRouteSync`.

- [ ] **Step 5: Run lint + eslint + tests**

Run: `bun run lint` then `bun run eslint` then `bun test`
Expected: green. `App.test.tsx` may render `<App/>`; if it asserts on the old tab divs, update it to assert on the layer gating (or just that it renders without throwing).

- [ ] **Step 6: Commit**

```bash
git add src/components/loop/LoopPage.tsx src/components/song/SongPage.tsx src/App.tsx src/components/Header.tsx
git commit -m "feat(ui): add LoopPage and SongPage wrappers and render by layer

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: LoopSelector dropdown in the loop layer + Arrange "Edit" deep-link

Put the loop selector dropdown inside the loop layer (already rendered by `LoopPage`) and add an "Edit" action on each Arrange row that deep-links into the loop editor for that loop.

**Files:**
- Modify: `src/components/loop/LoopSelector.tsx`, `src/components/song/ArrangeView.tsx`
- Modify: `src/components/song/ArrangeView.test.tsx`, `src/components/loop/LoopSelector.test.tsx` (rename `RegionSelector.test.tsx`)

**Interfaces:**
- Consumes: `loadLoop`, `loops`, `activeLoopId` (store); `buildRouteUrl`, `layerForTab` (routing); `setActiveTab` (uiSlice).
- Produces: a dropdown that writes `loopId` to the URL on pick; an Arrange-row "Edit" button that navigates to `/loop?tab=<current>&loopId=<id>`.

- [ ] **Step 1: Wire the dropdown to the URL**

In `src/components/loop/LoopSelector.tsx`, the existing `onChange={(e) => loadLoop(e.target.value)}` stays (it swaps content + sets `activeLoopId`). The `useRouteSync` loop-subscription (Task 3) already pushes `activeLoopId` → `loopId` on the URL. Add a test in `LoopSelector.test.tsx` that the `onChange` calls `loadLoop` with the selected value (drive the pure render via the existing store, or export the `onSelectLoop` handler for a pure test — follow the repo's "components export helpers" convention).

- [ ] **Step 2: Add the "Edit" action to Arrange rows**

In `src/components/song/ArrangeView.tsx`, each row currently has a select click (`loadLoop(loop.id)`) plus reorder/duplicate/delete. Add an "Edit" button to each row:

```tsx
// Import: `import { buildRouteUrl } from '../../routing/tabRouting';`
const editLoop = (id: string) => {
  // Push the target URL FIRST so the store subscriptions below see it already
  // matches and skip their own pushState (one history entry, not two).
  window.history.pushState(window.history.state, '', buildRouteUrl('loop', 'synth', id));
  useAppStore.getState().setActiveTab('synth');
  loadLoop(id); // sets activeLoopId — the loop subscription sees loopId already matches
};
```

Add a button next to the existing per-row controls:

```tsx
<button
  id={`btn-loop-edit-${loop.id}`}
  className="btn btn-xs btn-ghost"
  onClick={() => editLoop(loop.id)}
>
  Edit
</button>
```

(Use the nearest existing row-button styling in the file; do not introduce raw colour classes — themeTokenGuard fails on those.)

- [ ] **Step 3: Test the deep-link**

In `src/components/song/ArrangeView.test.tsx`, add a test that clicking the Edit action calls `loadLoop` with the row's id (spy via the store or via an exported `editLoop` helper). Follow the repo's pure-helper convention: if `ArrangeView` does not already export helpers, export `editLoop` (or a `buildEditRoute(id)` pure fn returning the target URL) and test that it returns `/loop?tab=synth&loopId=<id>`.

- [ ] **Step 4: Run lint + eslint + tests**

Run: `bun run lint` then `bun run eslint` then `bun test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/LoopSelector.tsx src/components/song/ArrangeView.tsx src/components/song/ArrangeView.test.tsx src/components/loop/LoopSelector.test.tsx
git commit -m "feat(ui): loop-selector dropdown and arrange edit deep-link

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Final gate

After Task 7, run the whole gate once from the branch root:

```bash
bun run verify && bun run eslint
```

`verify` runs test + lint(tsc) + check:keys + check:drums + build. Both must pass before the branch is considered done.
