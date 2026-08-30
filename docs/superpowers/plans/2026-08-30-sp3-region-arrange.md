# SP3 — Region + Arrange Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Solna from a single-snapshot looper into a linear arranger — multiple full musical snapshots ("regions") arranged in a fixed order, with a dedicated Arrange tab, a region selector on the editing tabs, and a dual play mode (song mode on Arrange, loop mode everywhere else).

**Architecture:** A new `regionSlice` holds `regions: Region[]` + `activeRegionId`; the existing flat slices stay the live editing surface for the active region. Switching region is an atomic `loadRegion(id)` swap reusing the `applyInstantVibeToStore` capture→hardStopAll→stopSource→write→restart pattern. Edits sync back into `regions[activeRegionId]` via a live-write subscription (`regionSync.ts`), so `partializeAppState` stays a plain allow-list and persist always serializes the latest edits. A store-level song-mode coordinator (`songMode.ts`) subscribes to the shared clock and advances regions on their bar boundary, with a transient `songRegionIndex` cursor that is `null` in loop mode.

**Tech Stack:** Bun (runtime/test runner), Vite + React 18, TypeScript, Zustand 5 (`persist` + `subscribeWithSelector`), raw Web Audio API, daisyUI 5 (CSS-first theming), `bun:test` pure-logic tests + `react-dom/server` `renderToString` for components. No DOM/testing-library.

**Spec:** `docs/superpowers/specs/2026-08-30-sp3-region-arrange-design.md` (binding). The plan argues from the spec; executors read both.

## Global Constraints

These are project-wide requirements. Every task's requirements implicitly include this section.

1. **Three-layer import rule (eslint `no-restricted-imports`).** `src/audio/` never imports `store/` or `components/`. `src/store/` never imports `components/`. `src/components/` never imports `audio/engine` — the only exemptions are `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`, and test files. `store/ → audio/` is the allowed direction (`instantVibes.ts`, `engineSync.ts`).
2. **No `tailwind.config.*` may be added.** Theming is CSS-first in `src/index.css` via `@plugin "daisyui/theme"` (`solna-dark`, `solna-light`).
3. **Theme-token guard is a hard gate** (`scripts/themeTokenGuard.ts`). New `.tsx` code must contain no raw hex, no Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), no `text-white`/`bg-black`/etc., no `dark:` variant, no `rgb()`/`rgba()` literals. The `ALLOWLIST` is empty and must stay empty. Use daisyUI semantic tokens (`base-*`, `primary`, `secondary`, `error`, …) with `/NN` opacity modifiers where needed, exactly as `ViewHeader.tsx` and `Header.tsx` do.
4. **Canvas/engine code resolves theme colours at runtime** through `src/utils/themeColor.ts` — never inline colours.
5. **Testing convention.** Tests are `bun:test`, pure-logic first. Components export their testable helpers and the `.test.tsx` imports those rather than rendering React; when a component is SSR-tested, it is via `renderToString`, which observes only the store's initial snapshot. There is no DOM/testing-library setup — do not introduce one.
6. **Persistence.** Zustand persist key is `musibox_project_state_v1`; this plan bumps `version` 5 → 6. Storage access is always `try/catch`-guarded (it can throw).
7. **The "≥ 1 region" invariant holds after every action.** The last remaining region cannot be deleted.
8. **Region ids are the stable handle.** Names ("Region 1/2/3…") are presentation-level and may collide after deletes; never key anything off a name.
9. **Every region switch must pass through `loadRegion(id)`** — the single choke point that swaps the flat slices, sets `activeRegionId`, cuts queued voices, and restarts the players.
10. **Never call engine setters from a component.** Store state is added to a slice and wired in `engineSync.ts`; engine side-effects live in the bridge.
11. **Spec-quoted count discrepancy:** the spec's `Region` interface block lists **31** per-region fields while its prose says "30 fields". This plan implements the 31-field interface verbatim (the prose is the error). Flagged in the report-back.
12. **Look up daisyUI v5 docs before writing any daisyUI class** (user memory: `verify-daisyui-classes-in-docs`). Only classes already present in the codebase (`btn`, `btn-sm`, `btn-ghost`, `btn-primary`, `btn-square`, `badge`, `select`, `select-sm`, `select-ghost`, `join`, `join-item`, `rounded-box`, `divider`, `dropdown`, `card`, `card-body`, `navbar`, `range`) are reused — no new daisyUI components are introduced by this plan.

## File Structure

**New files:**
- `src/store/region.ts` — pure region helpers: `REGION_FLAT_KEYS`, `regionBars`, `newRegionId`, `nextRegionName`, `fallbackActiveId`, `cloneRegion`, `regionStatePatch`. No store dependency.
- `src/store/regionSlice.ts` — `createDefaultRegion`, `createRegionSlice` (regions, activeRegionId + 5 actions).
- `src/store/loadRegion.ts` — the atomic `loadRegion(id)` swap (mirrors `instantVibes.ts`, not imported by `store.ts`).
- `src/store/regionSync.ts` — live-write sync-back subscription + `useRegionSync`.
- `src/store/songMode.ts` — pure song-mode helpers + `startSongModeSync`/`useSongModeSync` coordinator (mirrors `engineSync.ts` shape).
- `src/components/ArrangeView.tsx` — the 5th tab.
- `src/components/RegionSelector.tsx` — the non-Arrange region picker.

**Modified files:**
- `src/types.ts` — `ViewMode` gains `'arrange'`.
- `src/store/types.ts` — add `Region`, `RegionStatePatch`, `RegionSlice`; extend `AppStore`; add `songRegionIndex`/`setSongRegionIndex` to `TransportSlice`; rewrite `PersistedState`.
- `src/store/store.ts` — compose `regionSlice`; v6 `partializeAppState`; `sanitizeRegions`; guarded merge region-load; version 6; wrap in the migrate chain (Task 5).
- `src/store/migrate.ts` — `wrapFlatStateIntoRegion` (v5→v6).
- `src/store/transportSlice.ts` — `songRegionIndex` + `setSongRegionIndex`.
- `src/components/viewMeta.ts` — `VIEW_ORDER`/`VIEW_META` gain `'arrange'` (`LayoutList` icon).
- `src/routing/tabRouting.ts` — `TAB_VALUES` gains `'arrange'`.
- `src/App.tsx` — mount `ArrangeView`, call `useRegionSync()` + `useSongModeSync()`.
- `src/components/Header.tsx` — `ARRANGE_TABS` const, arrange TabButton group, `<RegionSelector />`.
- `src/components/TransportBar.tsx` — `songModeLabel` helper + badge.
- Tests: `src/store/region.test.ts`, `src/store/regionSlice.test.ts`, `src/store/loadRegion.test.ts`, `src/store/regionSync.test.ts`, `src/store/songMode.test.ts`, `src/store/migrate.test.ts`, `src/store/store.test.ts`, `src/components/ArrangeView.test.tsx`, `src/components/RegionSelector.test.tsx`, `src/components/viewMeta.test.ts`, `src/components/Header.test.tsx`, `src/components/TransportBar.test.tsx`.

### Task 1: Region data model + pure helpers

**Files:**
- Modify: `src/store/types.ts` (add `Region`, `RegionStatePatch` interfaces)
- Create: `src/store/region.ts`
- Create: `src/store/region.test.ts`

**Interfaces:**
- Consumes: existing `SynthParams`, `ChordItem`, `SequencerTrack`, `FilterType`, `BassStepChoice` types from `src/types.ts` / `src/audio/bassPatterns.ts` (already imported by `types.ts`).
- Produces:
  - `export const REGION_FLAT_KEYS: readonly string[]` — the 31 per-region field keys, in one source of truth.
  - `export function regionBars(chords: readonly { bars?: number }[]): number` — `Σ (c.bars || 1)`.
  - `export function newRegionId(): string` — `region-${Date.now()}-${rand}` (matches the `presetsSlice.ts` id style).
  - `export function nextRegionName(regions: readonly Region[]): string` — `Region N`, N above the highest existing `Region N` suffix.
  - `export function fallbackActiveId(regions: readonly Region[], deletedId: string): string | null`.
  - `export function cloneRegion(region: Region): Region` — deep clone (`structuredClone`).
  - `export function regionStatePatch(source: object): RegionStatePatch` — picks the 31 keys off a `Region` or the flat `AppStore`.
  - Types `Region`, `RegionStatePatch = Omit<Region, 'id' | 'name'>` added to `src/store/types.ts`.

- [ ] **Step 1: Add `Region` and `RegionStatePatch` to `src/store/types.ts`**

Append before the `AppStore` interface:

```ts
/** A full per-region musical snapshot: identity + the 31 per-region fields. */
export interface Region {
  id: string;
  name: string; // auto-named "Region N"; ids are the stable handle
  scaleRoot: string;
  scaleType: string;
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  bassFeel: number;
  bassOctave: number;
  leadMelodySteps: string[][];
  leadLoopLength: number;
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  synthVolume: number;
  synthMuted: boolean;
  chordVolume: number;
  chordMuted: boolean;
  bassVolume: number;
  bassMuted: boolean;
  masterSequencerVolume: number;
  drumMuted: boolean;
}

/** The 31 per-region fields, without identity — what loadRegion writes to the flat slices. */
export type RegionStatePatch = Omit<Region, 'id' | 'name'>;
```

- [ ] **Step 2: Write the failing test `src/store/region.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { INITIAL_CHORDS, INITIAL_SEQUENCER_TRACKS, INITIAL_SYNTH_PARAMS } from './initialState';
import {
  cloneRegion,
  fallbackActiveId,
  newRegionId,
  nextRegionName,
  regionBars,
  regionStatePatch,
  REGION_FLAT_KEYS,
} from './region';
import type { Region } from './types';

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'region-x',
    name: 'Region X',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: INITIAL_SYNTH_PARAMS,
    chords: INITIAL_CHORDS.map((c) => ({ ...c })),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: 'bass-1',
    bassPatternMode: 'preset',
    customBassPattern: [],
    bassFeel: 0.5,
    bassOctave: 2,
    leadMelodySteps: [[]],
    leadLoopLength: 1,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    synthVolume: 1.0,
    synthMuted: false,
    chordVolume: 1.0,
    chordMuted: false,
    bassVolume: 1.0,
    bassMuted: false,
    masterSequencerVolume: 0.8,
    drumMuted: false,
    ...overrides,
  };
}

describe('regionBars', () => {
  test('sums chord bars with a 1-bar default for bar-less chords', () => {
    expect(regionBars([])).toBe(0);
    expect(regionBars([{ bars: 2 }, { bars: 1 }, { bars: 4 }])).toBe(7);
    expect(regionBars([{ bars: 0 }])).toBe(1);
    expect(regionBars([{ bars: undefined }])).toBe(1);
    expect(regionBars(INITIAL_CHORDS)).toBe(4);
  });
});

describe('newRegionId', () => {
  test('produces unique ids with the region- prefix', () => {
    expect(newRegionId().startsWith('region-')).toBe(true);
    expect(newRegionId()).not.toBe(newRegionId());
  });
});

describe('nextRegionName', () => {
  test('picks the next number above the highest Region N', () => {
    expect(nextRegionName([])).toBe('Region 1');
    expect(nextRegionName([makeRegion({ id: 'r1', name: 'Region 1' })])).toBe('Region 2');
    expect(
      nextRegionName([
        makeRegion({ id: 'r1', name: 'Region 1' }),
        makeRegion({ id: 'r3', name: 'Region 3' }),
      ])
    ).toBe('Region 4');
  });
  test('ignores custom names that do not match Region N', () => {
    expect(nextRegionName([makeRegion({ id: 'intro', name: 'Intro' })])).toBe('Region 1');
  });
});

describe('fallbackActiveId', () => {
  test('falls back to the next neighbour, then the previous, then the first', () => {
    const regions = [makeRegion({ id: 'a' }), makeRegion({ id: 'b' }), makeRegion({ id: 'c' })];
    expect(fallbackActiveId(regions, 'a')).toBe('b');
    expect(fallbackActiveId(regions, 'b')).toBe('c');
    expect(fallbackActiveId(regions, 'c')).toBe('b');
    expect(fallbackActiveId([regions[0]], 'a')).toBe('a');
    expect(fallbackActiveId(regions, 'missing')).toBe(null);
  });
});

describe('cloneRegion', () => {
  test('deep-clones nested arrays and objects', () => {
    const region = makeRegion();
    const clone = cloneRegion(region);
    expect(clone).toEqual(region);
    expect(clone).not.toBe(region);
    expect(clone.synthParams).not.toBe(region.synthParams);
    expect(clone.chords).not.toBe(region.chords);
    expect(clone.sequencerTracks).not.toBe(region.sequencerTracks);
    expect(clone.sequencerTracks[0].steps).not.toBe(region.sequencerTracks[0].steps);
  });
});

describe('regionStatePatch', () => {
  test('picks exactly the 31 per-region keys, never id or name', () => {
    const region = makeRegion({ scaleRoot: 'D', drumMuted: true });
    const patch = regionStatePatch(region);
    expect(Object.keys(patch).sort()).toEqual([...REGION_FLAT_KEYS].sort());
    expect(patch.scaleRoot).toBe('D');
    expect(patch.drumMuted).toBe(true);
    expect('id' in patch).toBe(false);
    expect('name' in patch).toBe(false);
  });
  test('works on a flat AppStore-shaped object too', () => {
    const patch = regionStatePatch({ scaleRoot: 'C', chords: INITIAL_CHORDS, id: 'nope' });
    expect(patch.scaleRoot).toBe('C');
    expect('id' in patch).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/store/region.test.ts`
Expected: FAIL with `Cannot find module './region'` / `REGION_FLAT_KEYS` not exported.

- [ ] **Step 4: Write `src/store/region.ts`**

```ts
import type { ChordItem } from '../types';
import type { Region, RegionStatePatch } from './types';

/** The 31 per-region persisted fields, in one source of truth. */
export const REGION_FLAT_KEYS = [
  'scaleRoot',
  'scaleType',
  'synthParams',
  'chordSynthParams',
  'bassSynthParams',
  'chords',
  'chordRhythmId',
  'chordRhythmMode',
  'customChordRhythm',
  'chordFeel',
  'chordOctave',
  'bassPatternId',
  'bassPatternMode',
  'customBassPattern',
  'bassFeel',
  'bassOctave',
  'leadMelodySteps',
  'leadLoopLength',
  'sequencerTracks',
  'soundKit',
  'drumFilterCutoff',
  'drumFilterResonance',
  'drumFilterType',
  'synthVolume',
  'synthMuted',
  'chordVolume',
  'chordMuted',
  'bassVolume',
  'bassMuted',
  'masterSequencerVolume',
  'drumMuted',
] as const;

/**
 * A region's length in bars — the same total the chord player already
 * advances through (`chord.bars × stepsPerBar` per chord), so the region
 * boundary is exactly where the progression wraps.
 */
export function regionBars(chords: readonly { bars?: number }[]): number {
  return chords.reduce((sum, c) => sum + (c.bars || 1), 0);
}

/** Region ids are new and unique per project (same style as presetsSlice). */
export function newRegionId(): string {
  return `region-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Auto-name "Region N", where N is one above the highest existing `Region N`
 * suffix, so a fresh add never collides with a name still in the list. Custom
 * names ("Intro", "Drop") do not consume numbers.
 */
export function nextRegionName(regions: readonly Region[]): string {
  let max = 0;
  for (const r of regions) {
    const m = /^Region (\d+)$/.exec(r.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Region ${max + 1}`;
}

/** The id to make active after deleting `deletedId`: next neighbour, else previous, else first. */
export function fallbackActiveId(regions: readonly Region[], deletedId: string): string | null {
  const index = regions.findIndex((r) => r.id === deletedId);
  if (index === -1) return null;
  const next = regions[index + 1] ?? regions[index - 1] ?? regions[0];
  return next ? next.id : null;
}

/** Deep clone so a duplicated/added region can never share mutable substructure with its source. */
export function cloneRegion(region: Region): Region {
  return structuredClone(region);
}

/**
 * Picks the 31 per-region fields off any object that carries them — a `Region`
 * (for `loadRegion`) or the flat `AppStore` (for the sync-back subscription).
 */
export function regionStatePatch(source: object): RegionStatePatch {
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const key of REGION_FLAT_KEYS) {
    out[key] = src[key];
  }
  return out as RegionStatePatch;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/store/region.test.ts`
Expected: PASS (all 6 describe blocks).

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/region.ts src/store/region.test.ts
git commit -m "feat(region): region data model and pure helpers (SP3 Task 1)"
```

### Task 2: regionSlice

**Files:**
- Modify: `src/store/types.ts` (add `RegionSlice`, extend `AppStore`)
- Create: `src/store/regionSlice.ts`
- Create: `src/store/regionSlice.test.ts`

**Interfaces:**
- Consumes: `Region`/`RegionStatePatch` from Task 1; `cloneRegion`, `fallbackActiveId`, `newRegionId`, `nextRegionName` from `./region`; `INITIAL_SYNTH_PARAMS`, `INITIAL_CHORDS`, `INITIAL_SEQUENCER_TRACKS` from `./initialState`; `FACTORY_BASS_PRESETS` from `../audio/bassPresets`; `BASS_PATTERNS` from `../audio/bassPatterns`; `deriveChordNotes` from `../utils/musicTheory`; `MAX_STEPS_PER_BAR` from `../utils/meter`.
- Produces:
  - `export const DEFAULT_REGION_ID = 'region-default-1'`
  - `export function createDefaultRegion(): Region`
  - `export function createRegionSlice(set: StoreApi<AppStore>['setState'], get: StoreApi<AppStore>['getState']): RegionSlice`
  - `RegionSlice` action semantics (consumed by ArrangeView in Task 8 and `store.ts` in Task 4):
    - `addRegion(): string` — deep-copies the active region, appends, auto-activates; returns the new id (no `loadRegion` needed — content is identical).
    - `duplicateRegion(id): string | null` — deep-clone inserted immediately after the original; when the original is the active region the clone is auto-activated and `null` is returned; otherwise returns the clone id for the caller to `loadRegion`.
    - `deleteRegion(id): string | null` — refuses (returns `null`) when it is the last region; when the active region was deleted, returns the fallback id for the caller to `loadRegion`.
    - `reorderRegions(id, direction: -1 | 1): void` — list-order move, edge no-op.
    - `setActiveRegion(id: string): void`.

- [ ] **Step 1: Add `RegionSlice` to `src/store/types.ts` and extend `AppStore`**

```ts
export interface RegionSlice {
  /** The arrangement, in list (playback) order. Always ≥ 1 element. */
  regions: Region[];
  /** Id of the region currently being edited. */
  activeRegionId: string;
  addRegion: () => string;
  duplicateRegion: (id: string) => string | null;
  deleteRegion: (id: string) => string | null;
  reorderRegions: (id: string, direction: -1 | 1) => void;
  setActiveRegion: (id: string) => void;
}
```

Change the `AppStore` interface to include it:

```ts
export interface AppStore
  extends TransportSlice,
    MusicContextSlice,
    SynthSlice,
    ChordsSlice,
    BassSlice,
    LeadSlice,
    SequencerSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice,
    RegionSlice {}
```

- [ ] **Step 2: Write the failing test `src/store/regionSlice.test.ts`**

Uses the `makeSlice` harness pattern from `transportSlice.test.ts` (a plain-object `set`/`get`), so the slice is exercised without the store.

```ts
import { describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { createRegionSlice } from './regionSlice';
import type { AppStore, RegionSlice } from './types';

function makeSlice(initial?: Partial<RegionSlice>) {
  let state = {} as AppStore;
  const set = ((partial: unknown) => {
    const patch =
      typeof partial === 'function' ? (partial as (s: AppStore) => object)(state) : partial;
    state = { ...state, ...(patch as object) } as AppStore;
  }) as StoreApi<AppStore>['setState'];
  const get = (() => state) as StoreApi<AppStore>['getState'];
  state = { ...createRegionSlice(set, get), ...initial } as AppStore;
  return {
    get state() {
      return state;
    },
  };
}

describe('regionSlice', () => {
  test('starts with one default region that is active', () => {
    const s = makeSlice().state;
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0].name).toBe('Region 1');
    expect(s.activeRegionId).toBe(s.regions[0].id);
  });

  test('addRegion appends a deep copy of the active region and auto-activates it', () => {
    const h = makeSlice();
    const first = h.state.regions[0];
    const id = h.state.addRegion();
    expect(h.state.regions).toHaveLength(2);
    expect(h.state.activeRegionId).toBe(id);
    const added = h.state.regions[1];
    expect(added.id).toBe(id);
    expect(added.name).toBe('Region 2');
    expect(added.scaleRoot).toBe(first.scaleRoot);
    expect(added.synthParams).toEqual(first.synthParams);
    expect(added.synthParams).not.toBe(first.synthParams);
    expect(added.chords).not.toBe(first.chords);
  });

  test('duplicateRegion of the active region inserts a deep clone after it and auto-activates it', () => {
    const h = makeSlice();
    const original = h.state.regions[0];
    const result = h.state.duplicateRegion(original.id);
    expect(result).toBe(null);
    expect(h.state.regions).toHaveLength(2);
    expect(h.state.regions[1].id).toBe(h.state.activeRegionId);
    expect(h.state.regions[1].name).toBe('Region 2');
    expect(h.state.regions[1].scaleRoot).toBe(original.scaleRoot);
    expect(h.state.regions[1].chords).not.toBe(original.chords);
  });

  test('duplicateRegion of a non-active region returns the clone id for the caller to load', () => {
    const h = makeSlice();
    h.state.addRegion(); // active is now region 2
    const firstId = h.state.regions[0].id;
    const cloneId = h.state.duplicateRegion(firstId);
    expect(cloneId).not.toBe(null);
    expect(h.state.regions).toHaveLength(3);
    expect(h.state.regions[1].id).toBe(cloneId); // right after the original, not at the end
    expect(h.state.activeRegionId).not.toBe(cloneId);
  });

  test('deleteRegion of the active region returns a fallback id and activates it', () => {
    const h = makeSlice();
    const first = h.state.regions[0];
    h.state.addRegion(); // region 2 active
    const secondId = h.state.regions[1].id;
    const fallback = h.state.deleteRegion(secondId);
    expect(fallback).toBe(first.id);
    expect(h.state.regions).toHaveLength(1);
    expect(h.state.activeRegionId).toBe(first.id);
  });

  test('deleteRegion of a non-active region leaves the active region alone', () => {
    const h = makeSlice();
    h.state.addRegion();
    const firstId = h.state.regions[0].id;
    const activeId = h.state.activeRegionId;
    const result = h.state.deleteRegion(firstId);
    expect(result).toBe(null);
    expect(h.state.regions).toHaveLength(1);
    expect(h.state.activeRegionId).toBe(activeId);
  });

  test('the last region cannot be deleted', () => {
    const h = makeSlice();
    const id = h.state.regions[0].id;
    expect(h.state.deleteRegion(id)).toBe(null);
    expect(h.state.regions).toHaveLength(1);
  });

  test('reorderRegions moves a region up and down, and no-ops off the edge', () => {
    const h = makeSlice();
    h.state.addRegion();
    h.state.addRegion();
    const ids = h.state.regions.map((r) => r.id);
    h.state.reorderRegions(ids[0], 1);
    expect(h.state.regions.map((r) => r.id)).toEqual([ids[1], ids[0], ids[2]]);
    h.state.reorderRegions(ids[0], -1);
    expect(h.state.regions.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
    h.state.reorderRegions(ids[0], -1); // off the top edge
    expect(h.state.regions.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  test('setActiveRegion updates the active id without touching the list', () => {
    const h = makeSlice();
    h.state.addRegion();
    const secondId = h.state.regions[1].id;
    h.state.setActiveRegion(secondId);
    expect(h.state.activeRegionId).toBe(secondId);
    expect(h.state.regions).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/store/regionSlice.test.ts`
Expected: FAIL with `Cannot find module './regionSlice'`.

- [ ] **Step 4: Write `src/store/regionSlice.ts`**

```ts
import type { StoreApi } from 'zustand';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { deriveChordNotes } from '../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { INITIAL_CHORDS, INITIAL_SEQUENCER_TRACKS, INITIAL_SYNTH_PARAMS } from './initialState';
import { cloneRegion, fallbackActiveId, newRegionId, nextRegionName } from './region';
import type { AppStore, Region, RegionSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DEFAULT_REGION_ID = 'region-default-1';

/** The region every fresh project starts with — matches the store's flat defaults. */
export function createDefaultRegion(): Region {
  return {
    id: DEFAULT_REGION_ID,
    name: 'Region 1',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
    chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: BASS_PATTERNS[0].id,
    bassPatternMode: 'preset',
    customBassPattern: [],
    bassFeel: 0.5,
    bassOctave: 2,
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
    leadLoopLength: 1,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    synthVolume: 1.0,
    synthMuted: false,
    chordVolume: 1.0,
    chordMuted: false,
    bassVolume: 1.0,
    bassMuted: false,
    masterSequencerVolume: 0.8,
    drumMuted: false,
  };
}

export function createRegionSlice(set: Set, get: Get): RegionSlice {
  return {
    regions: [createDefaultRegion()],
    activeRegionId: DEFAULT_REGION_ID,

    // A new region is a copy of the active region (default), appended. Content
    // is identical to what the flat slices already hold, so no loadRegion call
    // is needed — only the cursor moves.
    addRegion: () => {
      const state = get();
      const source =
        state.regions.find((r) => r.id === state.activeRegionId) ?? state.regions[0];
      const region: Region = {
        ...cloneRegion(source),
        id: newRegionId(),
        name: nextRegionName(state.regions),
      };
      set({ regions: [...state.regions, region], activeRegionId: region.id });
      return region.id;
    },

    // Deep clone inserted immediately after the original. When the clone is
    // auto-activated (original was active) the content matches the flat slices,
    // so no loadRegion is needed; otherwise the caller must load the clone.
    duplicateRegion: (id) => {
      const state = get();
      const index = state.regions.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const clone: Region = {
        ...cloneRegion(state.regions[index]),
        id: newRegionId(),
        name: nextRegionName(state.regions),
      };
      const cloneActive = id === state.activeRegionId;
      const regions = [
        ...state.regions.slice(0, index + 1),
        clone,
        ...state.regions.slice(index + 1),
      ];
      set(cloneActive ? { regions, activeRegionId: clone.id } : { regions });
      return cloneActive ? null : clone.id;
    },

    // A project always has ≥ 1 region. Deleting the active region returns the
    // fallback id so the caller can loadRegion it.
    deleteRegion: (id) => {
      const state = get();
      if (state.regions.length <= 1) return null;
      const index = state.regions.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const wasActive = id === state.activeRegionId;
      const regions = state.regions.filter((r) => r.id !== id);
      if (!wasActive) {
        set({ regions });
        return null;
      }
      const fallback = fallbackActiveId(state.regions, id) ?? regions[0].id;
      set({ regions, activeRegionId: fallback });
      return fallback;
    },

    reorderRegions: (id, direction) =>
      set((state) => {
        const index = state.regions.findIndex((r) => r.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= state.regions.length) return {};
        const regions = [...state.regions];
        const [moved] = regions.splice(index, 1);
        regions.splice(target, 0, moved);
        return { regions };
      }),

    setActiveRegion: (id) => set({ activeRegionId: id }),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/store/regionSlice.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the lint gate on the touched files**

Run: `bun run lint`
Expected: no type errors (regionSlice.test.ts's `makeSlice` may trigger an unused-import lint only if an import is unused — keep imports exactly as written above).

- [ ] **Step 7: Commit**

```bash
git add src/store/types.ts src/store/regionSlice.ts src/store/regionSlice.test.ts
git commit -m "feat(region): regionSlice with add/duplicate/delete/reorder/setActive (SP3 Task 2)"
```

### Task 3: Atomic `loadRegion(id)`

**Files:**
- Create: `src/store/loadRegion.ts`
- Create: `src/store/loadRegion.test.ts`

**Interfaces:**
- Consumes: `regionStatePatch` from Task 1; `audioEngine` from `../audio/engine`; `useAppStore` from `./store`.
- Produces:
  - `export const LOAD_REGION_RELEASE = 0.02`
  - `export function loadRegion(id: string): void` — the single choke point for every region switch. No-op for an unknown id. Captures per-player active state → `hardStopAll()` → `audioEngine.stopSource('chord'|'bass', LOAD_REGION_RELEASE)` → `useAppStore.setState({ ...regionStatePatch(region), activeRegionId: id })` → restarts the captured players.
  - Consumed by: `RegionSelector` (Task 9), `ArrangeView` (Task 8), song coordinator (Task 7).

- [ ] **Step 1: Write the failing test `src/store/loadRegion.test.ts`**

`audioEngine.stopSource` guards on `if (!this.ctx) return;`, so these tests need no fake `AudioContext` — but the store module is shared, so every test seeds its own region list via `setState` (order-independent).

```ts
import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createDefaultRegion } from './regionSlice';
import { loadRegion, LOAD_REGION_RELEASE } from './loadRegion';
import { useAppStore } from './store';
import type { Region } from './types';

describe('loadRegion', () => {
  test('swaps the flat slices to the target region and updates activeRegionId', () => {
    const regionB: Region = {
      ...createDefaultRegion(),
      id: 'region-b',
      name: 'Region B',
      scaleRoot: 'C',
      chordFeel: 0.1,
      drumMuted: true,
    };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
    expect(useAppStore.getState().scaleRoot).toBe('A');

    loadRegion('region-b');

    const after = useAppStore.getState();
    expect(after.activeRegionId).toBe('region-b');
    expect(after.scaleRoot).toBe('C');
    expect(after.chordFeel).toBe(0.1);
    expect(after.drumMuted).toBe(true);
    expect(after.regions).toHaveLength(2);
    // The target region in regions[] is the source of truth and stays untouched.
    expect(after.regions.find((r) => r.id === 'region-b')?.scaleRoot).toBe('C');
  });

  test('restarts exactly the players that were active before the swap', () => {
    const regionB: Region = { ...createDefaultRegion(), id: 'region-b', name: 'Region B' };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
    useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped' });
    useAppStore.getState().play('sequencer');
    useAppStore.getState().play('chords');

    loadRegion('region-b');

    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('playing');
    expect(after.chordsPlayer).toBe('playing');
    expect(after.leadPlayer).toBe('stopped');
  });

  test('cuts the chord and bass sources during the swap', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      useAppStore.setState({
        regions: [createDefaultRegion(), { ...createDefaultRegion(), id: 'region-b', name: 'B' }],
        activeRegionId: 'region-default-1',
      });
      loadRegion('region-b');
      expect(stopSource).toHaveBeenCalledWith('chord', LOAD_REGION_RELEASE);
      expect(stopSource).toHaveBeenCalledWith('bass', LOAD_REGION_RELEASE);
    } finally {
      stopSource.mockRestore();
    }
  });

  test('is a safe no-op for an unknown id', () => {
    useAppStore.setState({ regions: [createDefaultRegion()], activeRegionId: 'region-default-1', scaleRoot: 'A' });
    loadRegion('region-missing');
    expect(useAppStore.getState().scaleRoot).toBe('A');
    expect(useAppStore.getState().activeRegionId).toBe('region-default-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/loadRegion.test.ts`
Expected: FAIL with `Cannot find module './loadRegion'`.

- [ ] **Step 3: Write `src/store/loadRegion.ts`**

```ts
import { audioEngine } from '../audio/engine';
import { regionStatePatch } from './region';
import { useAppStore } from './store';

/** Same instant-but-clickless release the vibe swap and hard stop use. */
export const LOAD_REGION_RELEASE = 0.02;

/**
 * Atomic region switch, reusing the applyInstantVibeToStore swap verbatim:
 * capture who was active -> hardStopAll -> cut the chord/bass sources -> load
 * the region's 31 per-region fields into the flat slices -> restart whoever
 * was playing. Every switch (selector pick, Arrange click, duplicate/delete
 * fallback, song advance) MUST pass through here, so the flat slices and
 * activeRegionId can never disagree with regions[].
 *
 * A state-only swap would leave the OLD region's queued chord/bass voices
 * ringing over the new one — the exact React-18-batching reason documented in
 * instantVibes.ts (the rendered player state goes 'playing' -> 'playing', so a
 * React effect keyed on it never runs and the cut must happen here,
 * synchronously). Drums are fire-and-forget one-shots; one already-scheduled
 * hit can still land, which the spec accepts.
 */
export function loadRegion(id: string): void {
  const store = useAppStore.getState();
  const region = store.regions.find((r) => r.id === id);
  if (!region) return;

  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  store.hardStopAll();
  audioEngine.stopSource('chord', LOAD_REGION_RELEASE);
  audioEngine.stopSource('bass', LOAD_REGION_RELEASE);

  useAppStore.setState({
    ...regionStatePatch(region),
    activeRegionId: id,
  });

  // Restart whatever was playing. The playback hooks arm on the next bar line
  // for the active meter, so the restart lands on beat 1 with no alignment
  // code (the same guarantee the Instant Vibe swap relies on).
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
  if (wasActive.lead) store.play('lead');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/store/loadRegion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/loadRegion.ts src/store/loadRegion.test.ts
git commit -m "feat(region): atomic loadRegion region switch (SP3 Task 3)"
```

### Task 4: Store integration — v6 persist, sanitize, merge, live-write sync-back

**Files:**
- Modify: `src/store/types.ts` (rewrite `PersistedState`)
- Modify: `src/store/store.ts`
- Create: `src/store/regionSync.ts`
- Create: `src/store/regionSync.test.ts`
- Modify: `src/store/store.test.ts`

**Interfaces:**
- Consumes: `createRegionSlice`, `createDefaultRegion` from Task 2; `regionStatePatch`, `REGION_FLAT_KEYS` from Task 1; `Region` type from `./types`.
- Produces:
  - `partializeAppState(state): PersistedState` — now emits the 9 global fields + `regions` + `activeRegionId` (no per-region keys at the top level).
  - `version: 6`.
  - `sanitizeRegions(value: unknown): Region[] | undefined` — validates each region through the existing per-field guards/clamps, with `createDefaultRegion()` as the field fallback; undefined for a non-array.
  - Guarded merge region-load: after `migrateLegacyPresets`, when the SANITIZED payload had `regions`, load `regions[activeRegionId]` into the flat slices last.
  - `startRegionSync(): () => void` and `useRegionSync(): void` in `regionSync.ts`.
  - The `RegionSlice` is composed into the store.

**Sync-back strategy decision (recorded for the plan):** **live-write subscription.** One `subscribeWithSelector` subscription over the 31 per-region flat fields writes `regions[activeRegionId]` on every change. Rationale: `partializeAppState` stays a plain allow-list; persist always serializes the latest edits with no snapshot step bolted onto every switch path AND onto partialize; a crash between switch and persist can never lose the last edit. Cost (a `regions`-array write + persist serialize per knob move) is comparable to today, where every one of those fields already triggers a persist write.

- [ ] **Step 1: Rewrite `PersistedState` in `src/store/types.ts`**

Replace the current `PersistedState` interface (the flat 37-key allow-list shape) with:

```ts
// The exact allow-list shape produced by the persist `partialize` config.
// Per-region fields live inside `regions`; the nine global fields stay
// top-level. `regions` ∪ {the nine globals} reconstructs today's single
// persisted snapshot exactly.
export interface PersistedState {
  bpm: number;
  meterId: MeterId;
  masterVolume: number;
  metronomeActive: boolean;
  selectedVibeId: string | null;
  controlTarget: SynthControlTarget;
  effects: MasterEffects;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
  regions: Region[];
  activeRegionId: string;
}
```

- [ ] **Step 2: Write the failing sync-back test `src/store/regionSync.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { createDefaultRegion } from './regionSlice';
import { loadRegion } from './loadRegion';
import { startRegionSync } from './regionSync';
import { useAppStore } from './store';

describe('region live-write sync', () => {
  test('a flat per-region edit reaches regions[activeRegionId]', () => {
    const stop = startRegionSync();
    try {
      const id = useAppStore.getState().activeRegionId;
      useAppStore.getState().setScaleRoot('D');
      const region = useAppStore.getState().regions.find((r) => r.id === id)!;
      expect(region.scaleRoot).toBe('D');
    } finally {
      stop();
    }
  });

  test('syncs into the CURRENT active region after a loadRegion switch', () => {
    const stop = startRegionSync();
    try {
      const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B', scaleRoot: 'C' };
      useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
      loadRegion('region-b');
      useAppStore.getState().setScaleRoot('E');
      const region = useAppStore.getState().regions.find((r) => r.id === 'region-b')!;
      expect(region.scaleRoot).toBe('E');
      const regionA = useAppStore.getState().regions.find((r) => r.id === 'region-default-1')!;
      expect(regionA.scaleRoot).toBe('A');
    } finally {
      stop();
    }
  });

  test('an activeRegionId-only change does not rewrite the region', () => {
    const stop = startRegionSync();
    try {
      const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B', scaleRoot: 'C' };
      useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
      loadRegion('region-b');
      useAppStore.getState().setActiveRegion('region-default-1');
      const regionB = useAppStore.getState().regions.find((r) => r.id === 'region-b')!;
      expect(regionB.scaleRoot).toBe('C');
    } finally {
      stop();
    }
  });

  test('nested edits (synthParams) sync by reference change', () => {
    const stop = startRegionSync();
    try {
      const id = useAppStore.getState().activeRegionId;
      useAppStore.getState().setSynthParams({ ...useAppStore.getState().synthParams, detune: 42 });
      const region = useAppStore.getState().regions.find((r) => r.id === id)!;
      expect(region.synthParams.detune).toBe(42);
    } finally {
      stop();
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/store/regionSync.test.ts`
Expected: FAIL with `Cannot find module './regionSync'` (and/or the flat edit never reaches `regions`).

- [ ] **Step 4: Write `src/store/regionSync.ts`**

```ts
import React from 'react';
import { REGION_FLAT_KEYS, regionStatePatch } from './region';
import { useAppStore } from './store';

/**
 * Live-write sync-back: one subscribeWithSelector subscription over the 31
 * per-region flat fields writes the active region's copy in regions[] on every
 * change. regions[] is always authoritative and persist always serializes the
 * latest edits — the "edits always sync back" half of the editing model.
 *
 * The equalityFn compares the 31 fields by reference (a new synthParams object
 * counts as a change; a playhead write does not), so the listener only runs
 * when an actual per-region field changed or the active id moved.
 */
export function startRegionSync(): () => void {
  return useAppStore.subscribe(
    (state) => ({ activeRegionId: state.activeRegionId, patch: regionStatePatch(state) }),
    (next, prev) => {
      // loadRegion owns the activeRegionId change and has already loaded the
      // target region's fields into the flat slices; syncing here would only
      // rewrite the just-loaded region with itself.
      if (next.activeRegionId !== prev.activeRegionId) return;
      const patch = next.patch;
      useAppStore.setState((s) => ({
        regions: s.regions.map((r) => (r.id === s.activeRegionId ? { ...r, ...patch } : r)),
      }));
    },
    {
      equalityFn: (a, b) => {
        if (a.activeRegionId !== b.activeRegionId) return false;
        for (const key of REGION_FLAT_KEYS) {
          if (a.patch[key] !== b.patch[key]) return false;
        }
        return true;
      },
    }
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useRegionSync(): void {
  React.useEffect(() => startRegionSync(), []);
}
```

- [ ] **Step 5: Modify `src/store/store.ts` — imports, composition, partialize, version, sanitize, merge**

**(a) Imports.** Add after the existing `migrate` import block:

```ts
import { createRegionSlice, createDefaultRegion } from './regionSlice';
import { regionStatePatch } from './region';
import type { Region } from './types';
import type { BassStepChoice } from '../audio/bassPatterns';
import type { ChordItem, SequencerTrack, FilterType } from '../types';
```

**(b) `partializeAppState`.** Replace the whole function body with:

```ts
export function partializeAppState(state: AppStore): PersistedState {
  return {
    bpm: state.bpm,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    metronomeActive: state.metronomeActive,
    selectedVibeId: state.selectedVibeId,
    controlTarget: state.controlTarget,
    effects: state.effects,
    customSynthPresets: state.customSynthPresets,
    customChordProgressions: state.customChordProgressions,
    regions: state.regions,
    activeRegionId: state.activeRegionId,
  };
}
```

**(c) `sanitizeRegions`.** Add this module-level function above `sanitizePersistedState`:

```ts
/**
 * Validates a persisted `regions` array. Each region is rebuilt through the
 * same per-field guards/clamps the flat payload used (synth params, finite
 * clamps, string/enum checks), with createDefaultRegion() as the fallback for
 * missing or wrong-typed fields. Rows that are not plain objects are dropped;
 * an empty result means "no valid regions" and the caller falls back to the
 * default single region.
 */
function sanitizeRegions(value: unknown): Region[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const regions: Region[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const fallback = createDefaultRegion();
    const r = { ...fallback, ...(raw as Record<string, unknown>) } as Record<string, unknown>;
    regions.push({
      id: typeof r.id === 'string' && r.id.length > 0 ? r.id : `region-${regions.length}`,
      name: typeof r.name === 'string' && r.name.length > 0 ? r.name : `Region ${regions.length + 1}`,
      scaleRoot: typeof r.scaleRoot === 'string' ? r.scaleRoot : fallback.scaleRoot,
      scaleType: typeof r.scaleType === 'string' ? r.scaleType : fallback.scaleType,
      synthParams: sanitizeSynthParams(r.synthParams),
      chordSynthParams: sanitizeSynthParams(r.chordSynthParams),
      bassSynthParams: sanitizeSynthParams(r.bassSynthParams),
      chords: Array.isArray(r.chords) ? (r.chords as ChordItem[]) : fallback.chords,
      chordRhythmId: typeof r.chordRhythmId === 'string' ? r.chordRhythmId : fallback.chordRhythmId,
      chordRhythmMode:
        r.chordRhythmMode === 'preset' || r.chordRhythmMode === 'custom'
          ? r.chordRhythmMode
          : fallback.chordRhythmMode,
      customChordRhythm: Array.isArray(r.customChordRhythm)
        ? (r.customChordRhythm as boolean[])
        : fallback.customChordRhythm,
      chordFeel: clampFinite(r.chordFeel, 0, 1, fallback.chordFeel),
      chordOctave: clampFinite(r.chordOctave, 0, 8, fallback.chordOctave),
      bassPatternId: typeof r.bassPatternId === 'string' ? r.bassPatternId : fallback.bassPatternId,
      bassPatternMode:
        r.bassPatternMode === 'preset' || r.bassPatternMode === 'custom'
          ? r.bassPatternMode
          : fallback.bassPatternMode,
      customBassPattern: Array.isArray(r.customBassPattern)
        ? (r.customBassPattern as BassStepChoice[])
        : fallback.customBassPattern,
      bassFeel: clampFinite(r.bassFeel, 0, 1, fallback.bassFeel),
      bassOctave: clampFinite(r.bassOctave, 0, 8, fallback.bassOctave),
      leadMelodySteps: Array.isArray(r.leadMelodySteps)
        ? (r.leadMelodySteps as string[][])
        : fallback.leadMelodySteps,
      leadLoopLength:
        typeof r.leadLoopLength === 'number' && Number.isInteger(r.leadLoopLength) && r.leadLoopLength >= 1
          ? r.leadLoopLength
          : fallback.leadLoopLength,
      sequencerTracks: Array.isArray(r.sequencerTracks)
        ? (r.sequencerTracks as SequencerTrack[])
        : fallback.sequencerTracks,
      soundKit: typeof r.soundKit === 'string' ? r.soundKit : fallback.soundKit,
      drumFilterCutoff: clampFinite(r.drumFilterCutoff, 50, 12000, fallback.drumFilterCutoff),
      drumFilterResonance: clampFinite(r.drumFilterResonance, 0.1, 20, fallback.drumFilterResonance),
      drumFilterType: FILTER_TYPES.has(r.drumFilterType as string)
        ? (r.drumFilterType as FilterType)
        : fallback.drumFilterType,
      synthVolume: clampFinite(r.synthVolume, 0, 1.5, fallback.synthVolume),
      synthMuted: asBoolean(r.synthMuted),
      chordVolume: clampFinite(r.chordVolume, 0, 1.5, fallback.chordVolume),
      chordMuted: asBoolean(r.chordMuted),
      bassVolume: clampFinite(r.bassVolume, 0, 1.5, fallback.bassVolume),
      bassMuted: asBoolean(r.bassMuted),
      masterSequencerVolume: clampFinite(r.masterSequencerVolume, 0, 1, fallback.masterSequencerVolume),
      drumMuted: asBoolean(r.drumMuted),
    });
  }
  return regions.length > 0 ? regions : undefined;
}
```

**(d) Wire sanitize.** At the end of `sanitizePersistedState`, after the existing synth-params loop, add:

```ts
  // v6: regions + activeRegionId. A valid regions array also pins
  // activeRegionId to an existing region (else the first); a missing/invalid
  // array drops both keys so the currentState defaults win in the merge.
  const regions = sanitizeRegions(sanitized.regions);
  if (regions) {
    sanitized.regions = regions;
    if (
      typeof sanitized.activeRegionId !== 'string' ||
      !regions.some((r) => r.id === sanitized.activeRegionId)
    ) {
      sanitized.activeRegionId = regions[0].id;
    }
  } else {
    delete sanitized.regions;
    delete sanitized.activeRegionId;
  }
```

Note: `clampFinite`/`asBoolean`/`FILTER_TYPES` are already in scope inside `sanitizePersistedState` — but `sanitizeRegions` is a module-level function, so it CANNOT see them. **In `sanitizeRegions`, define its own local `clampFinite`/`asBoolean` helpers** (copy the two lines from `sanitizePersistedState`) and reference the module-level `FILTER_TYPES`. The plan's `sanitizeRegions` above already assumes this — when implementing, add at the top of `sanitizeRegions`:

```ts
  const clampFinite = (value: unknown, min: number, max: number, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  const asBoolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : false);
```

**(e) `merge`.** Replace the current `merge` callback with:

```ts
      merge: (persistedState, currentState) => {
        const sanitized = sanitizePersistedState(persistedState);
        const base = { ...currentState, ...sanitized };
        const withPresets = { ...base, ...migrateLegacyPresets(base as Partial<PersistedState>) };
        // v6: load regions[activeRegionId] into the flat slices LAST, so the
        // region's fields win over any stale top-level per-region keys that a
        // legacy payload still carried. Guarded on the SANITIZED payload having
        // regions (a pre-v6 flat payload has none, so the flat keys hydrate the
        // old way until Task 5's wrap migration normalises them).
        const regions = sanitized.regions as Region[] | undefined;
        if (Array.isArray(regions) && regions.length > 0) {
          const activeId =
            typeof sanitized.activeRegionId === 'string' ? sanitized.activeRegionId : regions[0].id;
          const active = regions.find((r) => r.id === activeId) ?? regions[0];
          return { ...withPresets, regions, activeRegionId: active.id, ...regionStatePatch(active) };
        }
        return withPresets;
      },
```

**(f) Compose + version.** In the store creator, add `...createRegionSlice(set, get),` after `...createPresetsSlice(set),`. Change `version: 5` to `version: 6`.

- [ ] **Step 6: Update `src/store/store.test.ts`**

**(a) The `persist partialize` test** — the current test has a 30-key `persistedKeys` array (lines 347–378) and a 28-entry `excludedKeys` array (lines 383–412) asserting transients/actions never leak. Replace `persistedKeys` with the v6 allow-list, keep the existing 28 `excludedKeys` entries exactly as they are, and append eight per-region keys to `excludedKeys` to assert they no longer appear at the top level:

```ts
    const persistedKeys = [
      'bpm',
      'meterId',
      'masterVolume',
      'metronomeActive',
      'selectedVibeId',
      'controlTarget',
      'effects',
      'customSynthPresets',
      'customChordProgressions',
      'regions',
      'activeRegionId',
    ];
    for (const key of persistedKeys) {
      expect(snapshot).toHaveProperty(key);
    }
    expect(snapshot.regions).toHaveLength(1);
    expect(snapshot.activeRegionId).toBe(snapshot.regions[0].id);

    // Keep the existing 28 excludedKeys entries (activeTab, keyboardMode,
    // sequencerPlayer/chordsPlayer/playheadBeat/..., every action, ...) and
    // append the eight representative per-region fields — the v6 split moved
    // them into regions[], so they must be absent at the top level:
    const excludedKeys = [
      // ...the existing 28 entries unchanged...
      'scaleRoot',
      'scaleType',
      'synthParams',
      'chordSynthParams',
      'bassSynthParams',
      'chords',
      'sequencerTracks',
      'leadMelodySteps',
    ];
```

**(b) The `persisted hydration returns stored chords verbatim` test** — the persisted payload is now v6-shaped, so `chords` must live inside `regions` for it to reach the payload. Replace its body:

```ts
  test('persisted hydration returns stored chords verbatim (no re-derivation on load)', async () => {
    const { useAppStore } = await getStore();
    const customChords = [
      { id: 'chord-x', root: 'C', quality: 'maj', bars: 2, notes: ['C3', 'E3', 'G3'] },
    ];

    // Persist custom chords (the persist middleware writes on every setState).
    // Seed BOTH the region copy and the flat slices so the v6 payload carries
    // the chords inside regions[].
    useAppStore.setState({
      regions: [{ ...useAppStore.getState().regions[0], chords: customChords }],
      chords: customChords,
    });
    const persistedPayload = fakeLocalStorage.getItem('musibox_project_state_v1');
    expect(persistedPayload).toContain('chord-x');

    // Reset the in-memory flat chords (simulating a fresh session), then put
    // the captured payload back into storage directly.
    useAppStore.setState({ chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)) });
    fakeLocalStorage.setItem('musibox_project_state_v1', persistedPayload!);

    // Hydration merges the stored value via the region path: chords come back
    // as stored, not re-derived.
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().chords).toEqual(customChords);
    expect(useAppStore.getState().chords).not.toEqual(
      INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4))
    );
  });
```

- [ ] **Step 7: Run tests to verify everything passes**

Run: `bun test src/store/regionSync.test.ts src/store/store.test.ts src/store/region.test.ts src/store/regionSlice.test.ts src/store/loadRegion.test.ts`
Expected: PASS. The existing v1–v5 payload tests still pass because a pre-v6 payload has no `regions` key, so sanitize drops it and the merge takes the old flat path (the wrap migration lands in Task 5).

- [ ] **Step 8: Run the lint gate**

Run: `bun run lint`
Expected: no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/store/types.ts src/store/store.ts src/store/regionSync.ts src/store/regionSync.test.ts src/store/store.test.ts
git commit -m "feat(region): v6 persist + sanitize + merge region-load + live-write sync-back (SP3 Task 4)"
```

### Task 5: v5→v6 single-region wrap migration

**Files:**
- Modify: `src/store/migrate.ts`
- Modify: `src/store/store.ts` (migrate chain wiring)
- Modify: `src/store/migrate.test.ts`
- Modify: `src/store/store.test.ts`

**Interfaces:**
- Consumes: `REGION_FLAT_KEYS`, `newRegionId` from `./region`.
- Produces:
  - `export function wrapFlatStateIntoRegion<T extends object>(state: T): T` — wraps the 31 flat per-region fields (that exist) into `regions: [{ id: <new>, name: 'Region 1', ...fields }]`, sets `activeRegionId` to that id, deletes the per-region keys from the top level, preserves globals. Pure and non-mutating.

- [ ] **Step 1: Write the failing unit tests in `src/store/migrate.test.ts`**

Append:

```ts
import { wrapFlatStateIntoRegion } from './migrate';
import { REGION_FLAT_KEYS } from './region';
import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';

describe('wrapFlatStateIntoRegion (v5 -> v6)', () => {
  test('wraps the flat per-region fields into a single region and drops them from the top level', () => {
    const out = wrapFlatStateIntoRegion({
      bpm: 96,
      scaleRoot: 'D',
      scaleType: 'Major',
      synthParams: INITIAL_SYNTH_PARAMS,
      chordFeel: 0.3,
      drumMuted: true,
      effects: { ...INITIAL_EFFECTS },
    } as never) as {
      bpm: number;
      effects: unknown;
      scaleRoot?: unknown;
      chordFeel?: unknown;
      regions: Array<{
        id: string;
        name: string;
        scaleRoot: string;
        scaleType: string;
        chordFeel: number;
        drumMuted: boolean;
      }>;
      activeRegionId: string;
    };

    expect(out.bpm).toBe(96);
    expect(out.effects).toEqual(INITIAL_EFFECTS);
    expect('scaleRoot' in out).toBe(false);
    expect('chordFeel' in out).toBe(false);
    expect(out.regions).toHaveLength(1);
    expect(out.regions[0].name).toBe('Region 1');
    expect(out.regions[0].scaleRoot).toBe('D');
    expect(out.regions[0].scaleType).toBe('Major');
    expect(out.regions[0].chordFeel).toBe(0.3);
    expect(out.regions[0].drumMuted).toBe(true);
    expect(out.activeRegionId).toBe(out.regions[0].id);
  });

  test('a payload with no per-region keys still produces a valid single region', () => {
    const out = wrapFlatStateIntoRegion({ bpm: 120 }) as { regions: unknown[] };
    expect(out.regions).toHaveLength(1);
  });

  test('does not mutate the payload it was given', () => {
    const input = { bpm: 96, scaleRoot: 'D' };
    wrapFlatStateIntoRegion(input);
    expect(input).toEqual({ bpm: 96, scaleRoot: 'D' });
  });

  test('wrap covers exactly the 31 per-region keys', () => {
    const source: Record<string, unknown> = { bpm: 90 };
    for (const key of REGION_FLAT_KEYS) source[key] = `v-${key}`;
    const out = wrapFlatStateIntoRegion(source) as {
      regions: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    for (const key of REGION_FLAT_KEYS) {
      expect(out.regions[0][key]).toBe(`v-${key}`);
      expect(key in out).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/migrate.test.ts`
Expected: FAIL with `wrapFlatStateIntoRegion is not exported`.

- [ ] **Step 3: Write `wrapFlatStateIntoRegion` in `src/store/migrate.ts`**

Add to the import block:

```ts
import { newRegionId, REGION_FLAT_KEYS } from './region';
```

Add at the end of the file:

```ts
/**
 * v5 -> v6: the single-region wrap. The flat per-region fields become the
 * first region; the global fields stay top-level. Runs at the END of the
 * migrate chain for every version < 6, after the v1->v5 chain has normalised
 * older payloads to the v5 flat shape — so it only ever sees the current flat
 * layout. Pure and non-mutating, like its four siblings above.
 */
export function wrapFlatStateIntoRegion<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
  const region: Record<string, unknown> = {
    id: newRegionId(),
    name: 'Region 1',
  };
  for (const key of REGION_FLAT_KEYS) {
    if (key in next) region[key] = next[key];
  }
  next.regions = [region];
  next.activeRegionId = region.id;
  for (const key of REGION_FLAT_KEYS) delete next[key];
  return next as unknown as T;
}
```

Note: a region built here may be missing fields (a sparse legacy payload). The fields are repaired by `sanitizeRegions` (Task 4), which runs on the wrapped payload before the merge loads the active region into the flat slices.

- [ ] **Step 4: Wire the wrap into `store.ts`'s migrate chain**

Modify the `migrate` callback in `store.ts`. Import `wrapFlatStateIntoRegion` from `./migrate`. Replace the current `if (version >= 2) return metered(recoloured);` structure with a `wrapped` wrapper applied to BOTH exit paths:

```ts
      migrate: (persisted, version) => {
        const migrated = migrateLegacyPresets(
          (persisted ?? {}) as Partial<PersistedState>
        ) as PersistedState;
        // v3 → v4
        const deprojected =
          version >= 4 ? migrated : (migrateProjectTitleToVibeId(migrated) as PersistedState);
        // v2 → v3
        const recoloured =
          version >= 3 ? deprojected : (migrateTrackColors(deprojected) as PersistedState);
        // v4 → v5 (runs on EVERY older version, after the chain above)
        const metered = (payload: PersistedState): PersistedState =>
          version >= 5 ? payload : (migrateMeterAndStepWidth(payload) as PersistedState);
        // v5 → v6 (single-region wrap; forward-compat guard for a future v7)
        const wrapped = (payload: PersistedState): PersistedState =>
          version >= 6 ? payload : (wrapFlatStateIntoRegion(payload) as PersistedState);
        if (version >= 2) return wrapped(metered(recoloured));
        // v1 arp fix (unchanged) …
        const next = { ...recoloured } as Record<string, unknown>;
        for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
          const params = next[key];
          if (params && typeof params === 'object' && !Array.isArray(params)) {
            next[key] = { ...(params as object), arpActive: false };
          }
        }
        return wrapped(metered(next as unknown as PersistedState));
      },
```

- [ ] **Step 5: Add an end-to-end migration test in `src/store/store.test.ts`**

Append inside a new describe block (after the existing meter migration block):

```ts
describe('region wrap migration wiring (v5 -> v6)', () => {
  test('a version-5 payload wraps into a single region and hydrates the flat slices from it', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();

    const wide = Array.from({ length: 24 }, (_, i) => i % 2 === 0);
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 5,
        state: {
          meterId: '4/4',
          bpm: 96,
          scaleRoot: 'D',
          scaleType: 'Major',
          sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], steps: wide }],
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0].name).toBe('Region 1');
    expect(s.regions[0].scaleRoot).toBe('D');
    expect(s.activeRegionId).toBe(s.regions[0].id);
    // The wrapped region's content reached the flat editing surface.
    expect(s.scaleRoot).toBe('D');
    expect(s.regions[0].sequencerTracks[0].steps).toEqual(wide);
    expect(s.bpm).toBe(96);
  });

  test('a corrupt regions array falls back to a valid single default region', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();
    useAppStore.setState({ scaleRoot: 'A' });

    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 6, state: { regions: [null, 7, 'x'], activeRegionId: 'nope' } })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0].name).toBe('Region 1');
    expect(s.activeRegionId).toBe(s.regions[0].id);
    expect(s.scaleRoot).toBe('A');
  });
});
```

- [ ] **Step 6: Run tests to verify everything passes**

Run: `bun test src/store/migrate.test.ts src/store/store.test.ts`
Expected: PASS — the existing v1–v5 migration tests still pass because the wrap runs at the END of the chain, after the meter/track-colour/arp migrations, and the merge region-load now drives the flat slices from the wrapped region.

- [ ] **Step 7: Commit**

```bash
git add src/store/migrate.ts src/store/store.ts src/store/migrate.test.ts src/store/store.test.ts
git commit -m "feat(region): v5->v6 single-region wrap migration (SP3 Task 5)"
```

### Task 6: Song-mode pure helpers + transport `songRegionIndex`

**Files:**
- Modify: `src/store/types.ts` (TransportSlice additions)
- Modify: `src/store/transportSlice.ts`
- Create: `src/store/songMode.ts`
- Create: `src/store/songMode.test.ts`

**Interfaces:**
- Consumes: `regionBars` from Task 1; `Region`, `ViewMode` types.
- Produces (pure helpers, consumed by the coordinator in Task 7 and `ArrangeView`/`TransportBar` in Tasks 8–10):
  - `export function isSongTab(tab: ViewMode): boolean`
  - `export function detachSongPosition(tab: ViewMode, index: number | null): number | null`
  - `export function regionLengthSteps(chords: readonly { bars?: number }[], stepsPerBar: number): number`
  - `export function nextRegionIndex(regions: readonly { id: string }[], current: number): number`
  - `export function enterSongIndex(regions: readonly { id: string }[], activeRegionId: string): number`
  - `export function songAdvanceTarget(regions: readonly Region[], songRegionIndex: number | null, step: number, stepsPerBar: number): string | null`
- `TransportSlice` gains transient `songRegionIndex: number | null` (null = loop mode) + `setSongRegionIndex`.

- [ ] **Step 1: Add to `src/store/types.ts`**

In `TransportSlice`, after the `setPlayheadChord` line:

```ts
  /** Transient song-mode cursor: index into regions[] currently sounding, null = loop mode. */
  songRegionIndex: number | null;
  setSongRegionIndex: (index: number | null) => void;
```

- [ ] **Step 2: Write the failing tests `src/store/songMode.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { INITIAL_CHORDS } from './initialState';
import { createDefaultRegion } from './regionSlice';
import {
  detachSongPosition,
  enterSongIndex,
  isSongTab,
  nextRegionIndex,
  regionLengthSteps,
  songAdvanceTarget,
} from './songMode';
import type { Region } from './types';

function shortRegion(id: string, bars: number): Region {
  return {
    ...createDefaultRegion(),
    id,
    name: `Region ${id}`,
    chords: [{ id: `c-${id}`, root: 'C', quality: 'maj', bars, notes: ['C4'] }],
  };
}

describe('song mode pure helpers', () => {
  test('isSongTab is true only for the arrange tab', () => {
    expect(isSongTab('arrange')).toBe(true);
    expect(isSongTab('synth')).toBe(false);
    expect(isSongTab('sequencer')).toBe(false);
    expect(isSongTab('chords')).toBe(false);
    expect(isSongTab('effects')).toBe(false);
  });

  test('detachSongPosition drops the cursor outside the arrange tab', () => {
    expect(detachSongPosition('arrange', 2)).toBe(2);
    expect(detachSongPosition('synth', 2)).toBe(null);
    expect(detachSongPosition('arrange', null)).toBe(null);
  });

  test('regionLengthSteps multiplies bars by stepsPerBar', () => {
    expect(regionLengthSteps([{ bars: 2 }, { bars: 1 }], 16)).toBe(48);
    expect(regionLengthSteps([{ bars: 0 }], 16)).toBe(16);
    expect(regionLengthSteps(INITIAL_CHORDS, 16)).toBe(64);
  });

  test('nextRegionIndex wraps to 0 after the last region', () => {
    expect(nextRegionIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0)).toBe(1);
    expect(nextRegionIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).toBe(0);
  });

  test('enterSongIndex resolves the active region to its list index, defaulting to 0', () => {
    expect(enterSongIndex([{ id: 'a' }, { id: 'b' }], 'b')).toBe(1);
    expect(enterSongIndex([{ id: 'a' }], 'missing')).toBe(0);
  });

  test('songAdvanceTarget returns the next region id exactly on the boundary', () => {
    const regions = [shortRegion('a', 4), shortRegion('b', 2)];
    expect(songAdvanceTarget(regions, 0, 63, 16)).toBe(null);
    expect(songAdvanceTarget(regions, 0, 64, 16)).toBe('b');
    expect(songAdvanceTarget(regions, 1, 32, 16)).toBe('a'); // wraps
    expect(songAdvanceTarget(regions, 1, 31, 16)).toBe(null);
  });

  test('songAdvanceTarget ignores step 0, loop mode and an out-of-range cursor', () => {
    const regions = [shortRegion('a', 4)];
    expect(songAdvanceTarget(regions, null, 64, 16)).toBe(null);
    expect(songAdvanceTarget(regions, 0, 0, 16)).toBe(null);
    expect(songAdvanceTarget(regions, 99, 64, 16)).toBe(null);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/store/songMode.test.ts`
Expected: FAIL with `Cannot find module './songMode'`.

- [ ] **Step 4: Write `src/store/songMode.ts` (pure helpers only)**

```ts
import type { ViewMode } from '../types';
import { regionBars } from './region';
import type { Region } from './types';

/** Play mode is coupled to the active tab: Arrange = song, every other tab = loop. */
export function isSongTab(tab: ViewMode): boolean {
  return tab === 'arrange';
}

/** The detach rule: leaving the Arrange tab drops the song position. */
export function detachSongPosition(tab: ViewMode, index: number | null): number | null {
  return isSongTab(tab) ? index : null;
}

/** A region's length in steps = Σ chord.bars × stepsPerBar. */
export function regionLengthSteps(chords: readonly { bars?: number }[], stepsPerBar: number): number {
  return regionBars(chords) * stepsPerBar;
}

/** Advance one slot in the arrangement, wrapping to the top (the song loops). */
export function nextRegionIndex(regions: readonly { id: string }[], current: number): number {
  return (current + 1) % regions.length;
}

/** Where the song starts: the active region's list index, else the top. */
export function enterSongIndex(regions: readonly { id: string }[], activeRegionId: string): number {
  const index = regions.findIndex((r) => r.id === activeRegionId);
  return index === -1 ? 0 : index;
}

/**
 * The region id to load when the current region's bars complete on this clock
 * step. `step` is measured from the shared clock's reset origin — after every
 * advance loadRegion hard-stops and restarts, which resets the clock, so each
 * region's boundary is `regionLength` steps from 0 (the same alignment the
 * Instant Vibe swap relies on). Non-boundary steps and loop mode return null.
 */
export function songAdvanceTarget(
  regions: readonly Region[],
  songRegionIndex: number | null,
  step: number,
  stepsPerBar: number,
): string | null {
  if (songRegionIndex === null) return null;
  const region = regions[songRegionIndex];
  if (!region) return null;
  const length = regionLengthSteps(region.chords, stepsPerBar);
  if (length <= 0 || step <= 0 || step % length !== 0) return null;
  return regions[nextRegionIndex(regions, songRegionIndex)]?.id ?? null;
}
```

- [ ] **Step 5: Add `songRegionIndex` to `src/store/transportSlice.ts`**

In the returned slice object, after the `playheadChordStartBeat: 0,` line:

```ts
    songRegionIndex: null,
    setSongRegionIndex: (songRegionIndex) => set({ songRegionIndex }),
```

- [ ] **Step 6: Run tests to verify everything passes**

Run: `bun test src/store/songMode.test.ts src/store/transportSlice.test.ts src/store/region.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/types.ts src/store/transportSlice.ts src/store/songMode.ts src/store/songMode.test.ts
git commit -m "feat(region): song-mode pure helpers and transient songRegionIndex (SP3 Task 6)"
```

### Task 7: Song-mode coordinator + `loadRegion` song cursor

**Files:**
- Modify: `src/store/loadRegion.ts` (song cursor update)
- Modify: `src/store/songMode.ts` (coordinator + hook)
- Modify: `src/store/songMode.test.ts` (coordinator tests)

**Interfaces:**
- Consumes: pure helpers from Task 6; `loadRegion` from Task 3; `subscribePlaybackClock` from `../audio/playback/playbackEngine`; `getMeter` from `../utils/meter`.
- Produces:
  - `export interface SongModeDeps { subscribeClock?: (cb: (step: number, beat: number, time: number) => void) => () => void }`
  - `export function startSongModeSync(deps?: SongModeDeps): () => void`
  - `export function useSongModeSync(): void`
  - `loadRegion` now also keeps `songRegionIndex` pointing at the loaded region when song mode is active (else null).

- [ ] **Step 1: Write the failing coordinator tests in `src/store/songMode.test.ts`**

Append imports at the top: `afterEach`, `loadRegion`, `useAppStore`, `startSongModeSync`. Then append:

```ts
import { afterEach } from 'bun:test';
import { loadRegion } from './loadRegion';
import { useAppStore } from './store';
import { startSongModeSync } from './songMode';

function makeFakeClock() {
  const cbs: Array<(step: number, beat: number, time: number) => void> = [];
  return {
    get count() {
      return cbs.length;
    },
    subscribe: (cb: (step: number, beat: number, time: number) => void) => {
      cbs.push(cb);
      return () => {
        const i = cbs.indexOf(cb);
        if (i >= 0) cbs.splice(i, 1);
      };
    },
    tick: (step: number) => {
      for (const cb of [...cbs]) cb(step, step, 0);
    },
  };
}

afterEach(() => {
  useAppStore.setState({
    activeTab: 'synth',
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songRegionIndex: null,
  });
});

describe('song mode coordinator', () => {
  test('entering song mode loads the first region and subscribes the clock', () => {
    const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B' };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-b' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().play('sequencer');

    const s = useAppStore.getState();
    expect(s.songRegionIndex).toBe(0);
    expect(s.activeRegionId).toBe('region-default-1');
    expect(clock.count).toBe(1);
    stop();
  });

  test('advances to the next region at the boundary and wraps to the top', () => {
    const regionB = {
      ...createDefaultRegion(),
      id: 'region-b',
      name: 'Region B',
      chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 2, notes: ['C4'] }],
    };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    expect(useAppStore.getState().songRegionIndex).toBe(0);

    // First region is 4 bars x 16 = 64 steps.
    clock.tick(64);
    expect(useAppStore.getState().activeRegionId).toBe('region-b');
    expect(useAppStore.getState().songRegionIndex).toBe(1);

    // Second region is 2 bars x 16 = 32 steps; 64 + 32 = 96 wraps to region 0.
    clock.tick(96);
    expect(useAppStore.getState().activeRegionId).toBe('region-default-1');
    expect(useAppStore.getState().songRegionIndex).toBe(0);
    stop();
  });

  test('detaches when the tab leaves arrange: cursor drops and the clock unsubscribes', () => {
    useAppStore.setState({ regions: [createDefaultRegion()], activeRegionId: 'region-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    useAppStore.getState().setActiveTab('synth');
    expect(useAppStore.getState().songRegionIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('re-entering song mode restarts from the top of the list', () => {
    const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B' };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-b' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    clock.tick(64);
    expect(useAppStore.getState().activeRegionId).toBe('region-b');
    useAppStore.getState().setActiveTab('synth');
    expect(useAppStore.getState().songRegionIndex).toBe(null);

    useAppStore.getState().setActiveTab('arrange');
    useAppStore.getState().play('sequencer');
    expect(useAppStore.getState().songRegionIndex).toBe(0);
    expect(useAppStore.getState().activeRegionId).toBe('region-default-1');
    stop();
  });
});
```

Note on the advance test's absolute step numbers: the real engine resets the clock after each advance (`loadRegion`'s hardStopAll→play), so the production boundary is `step % regionLength === 0` measured from each region's own origin — which the pure `songAdvanceTarget` tests in Task 6 already pin. The coordinator test feeds a non-resetting clock and asserts at the absolute boundaries (64, 96); both models agree on the advance points.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/songMode.test.ts`
Expected: FAIL (the coordinator functions are undefined; `loadRegion` also does not yet set `songRegionIndex`).

- [ ] **Step 3: Modify `src/store/loadRegion.ts` — keep the song cursor on the loaded region**

Replace the `useAppStore.setState({ ... })` call in `loadRegion` with:

```ts
  useAppStore.setState({
    ...regionStatePatch(region),
    activeRegionId: id,
    // Song mode keeps the cursor on the loaded region; loop mode stays null.
    songRegionIndex:
      store.songRegionIndex !== null
        ? Math.max(0, store.regions.findIndex((r) => r.id === id))
        : null,
  });
```

- [ ] **Step 4: Add the coordinator to `src/store/songMode.ts`**

Add imports at the top of the file:

```ts
import React from 'react';
import { subscribePlaybackClock } from '../audio/playback/playbackEngine';
import { getMeter } from '../utils/meter';
import { loadRegion } from './loadRegion';
import { useAppStore } from './store';
```

Append to the end of the file:

```ts
export interface SongModeDeps {
  /** Injectable clock subscriber for tests (defaults to the real shared clock). */
  subscribeClock?: (cb: (step: number, beat: number, time: number) => void) => () => void;
}

/**
 * Store-level song-mode coordinator (not a component — mirrors engineSync's
 * shape). Derives song mode from {activeTab, playing}: on the Arrange tab with
 * any player active, entering song mode loads regions[0] (the song restarts
 * from the top) and subscribes to the shared clock; on every region boundary
 * it calls loadRegion(next). Leaving the Arrange tab (or stopping) detaches:
 * the cursor drops to null and the clock subscription is removed — audio never
 * stops, only the advance cursor does, so loop mode keeps looping what was
 * playing (the flat slices already hold the last-sounded region).
 */
export function startSongModeSync(deps: SongModeDeps = {}): () => void {
  const subscribeClock = deps.subscribeClock ?? subscribePlaybackClock;
  let unsubClock: (() => void) | null = null;

  const stopClock = () => {
    if (unsubClock) {
      unsubClock();
      unsubClock = null;
    }
  };

  const reconcile = () => {
    const s = useAppStore.getState();
    const playing =
      s.sequencerPlayer !== 'stopped' || s.chordsPlayer !== 'stopped' || s.leadPlayer !== 'stopped';
    if (isSongTab(s.activeTab) && playing) {
      if (s.songRegionIndex === null) {
        // Entering song mode: restart the song from the top of the list.
        loadRegion(s.regions[0]?.id ?? s.activeRegionId);
      } else if (!unsubClock) {
        unsubClock = subscribeClock((step) => {
          const current = useAppStore.getState();
          if (current.songRegionIndex === null) return;
          const target = songAdvanceTarget(
            current.regions,
            current.songRegionIndex,
            step,
            getMeter(current.meterId).stepsPerBar,
          );
          if (target !== null) loadRegion(target);
        });
      }
    } else if (s.songRegionIndex !== null) {
      s.setSongRegionIndex(null);
      stopClock();
    }
  };

  reconcile();
  const unsubStore = useAppStore.subscribe(
    (state) => ({
      tab: state.activeTab,
      seq: state.sequencerPlayer,
      chords: state.chordsPlayer,
      lead: state.leadPlayer,
    }),
    reconcile,
    {
      equalityFn: (a, b) =>
        a.tab === b.tab && a.seq === b.seq && a.chords === b.chords && a.lead === b.lead,
    }
  );
  return () => {
    unsubStore();
    stopClock();
  };
}

/** React binding, mounted once at the app root (App.tsx). */
export function useSongModeSync(): void {
  React.useEffect(() => startSongModeSync(), []);
}
```

- [ ] **Step 5: Run tests to verify everything passes**

Run: `bun test src/store/songMode.test.ts src/store/loadRegion.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the lint gate**

Run: `bun run lint`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/store/loadRegion.ts src/store/songMode.ts src/store/songMode.test.ts
git commit -m "feat(region): song-mode coordinator and loadRegion song cursor (SP3 Task 7)"
```

### Task 8: ArrangeView (the 5th tab)

**Files:**
- Modify: `src/types.ts` (`ViewMode`)
- Modify: `src/components/viewMeta.ts`
- Create: `src/components/ArrangeView.tsx`
- Create: `src/components/ArrangeView.test.tsx`
- Modify: `src/components/viewMeta.test.ts`

**Interfaces:**
- Consumes: `useAppStore` actions (`regions`, `activeRegionId`, `songRegionIndex`, `addRegion`, `duplicateRegion`, `deleteRegion`, `reorderRegions`), `loadRegion`, `regionBars`, `ViewHeader`, `VIEW_META`.
- Produces: `export const ArrangeView: React.FC` — linear region list with add / reorder / duplicate / delete, name + bar count, playing highlight, row click = `loadRegion(id)`. Consumed by `App.tsx` in Task 10.

- [ ] **Step 1: Add `'arrange'` to `ViewMode` in `src/types.ts`**

```ts
export type ViewMode =
  | 'synth'
  | 'sequencer'
  | 'chords'
  | 'effects'
  | 'arrange';
```

- [ ] **Step 2: Add `arrange` to `src/components/viewMeta.ts`**

Change the import to include `LayoutList` and update `VIEW_ORDER` / `VIEW_META`:

```ts
import { AudioWaveform, Grid, LayoutList, Music, Sliders, type LucideIcon } from 'lucide-react';
```

```ts
export const VIEW_ORDER = ['synth', 'sequencer', 'chords', 'effects', 'arrange'] as const;
```

```ts
export const VIEW_META: Record<ViewMode, ViewMeta> = {
  synth: { icon: Sliders, tabLabel: 'Synth', title: 'Synth Lab' },
  sequencer: { icon: Grid, tabLabel: 'Beat Step', title: 'Drum Sequencer' },
  chords: { icon: Music, tabLabel: 'Chords', title: 'Chord Studio' },
  effects: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
  arrange: { icon: LayoutList, tabLabel: 'Arrange', title: 'Arrangement' },
};
```

- [ ] **Step 3: Write the failing test `src/components/ArrangeView.test.tsx`**

`renderToString` observes the store's initial snapshot (one default region → "Region 1", 4 bars, delete disabled).

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ArrangeView } from './ArrangeView';

describe('ArrangeView', () => {
  test('renders the default single region with its bar count and disabled delete', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-arrange-add"');
    expect(html).toContain('Region 1');
    expect(html).toContain('4 bars');
    expect(html).toContain('btn-region-delete-region-default-1');
    // A single region cannot be deleted.
    expect(html).toContain('disabled');
  });

  test('never uses raw colour literals', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('rgba(');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('dark:');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/components/ArrangeView.test.tsx`
Expected: FAIL with `Cannot find module './ArrangeView'`.

- [ ] **Step 5: Write `src/components/ArrangeView.tsx`**

```tsx
import React from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { loadRegion } from '../store/loadRegion';
import { regionBars } from '../store/region';
import { useAppStore } from '../store/store';
import { ViewHeader } from './ui/ViewHeader';

/**
 * The Arrange tab: a linear list of regions, top to bottom = playback order.
 * The currently-playing region is highlighted — in song mode that is
 * regions[songRegionIndex]; in loop mode it is the active region (the one
 * looping). Clicking a row selects it as active (loadRegion), which while
 * playing jumps the song/loop to that region.
 */
export const ArrangeView: React.FC = () => {
  const regions = useAppStore((s) => s.regions);
  const activeRegionId = useAppStore((s) => s.activeRegionId);
  const songRegionIndex = useAppStore((s) => s.songRegionIndex);
  const addRegion = useAppStore((s) => s.addRegion);
  const duplicateRegion = useAppStore((s) => s.duplicateRegion);
  const deleteRegion = useAppStore((s) => s.deleteRegion);
  const reorderRegions = useAppStore((s) => s.reorderRegions);

  const playingId =
    songRegionIndex !== null && regions[songRegionIndex]
      ? regions[songRegionIndex].id
      : activeRegionId;

  const handleDuplicate = (id: string) => {
    const cloneId = duplicateRegion(id);
    if (cloneId !== null) loadRegion(cloneId);
  };
  const handleDelete = (id: string) => {
    const fallback = deleteRegion(id);
    if (fallback !== null) loadRegion(fallback);
  };

  return (
    <div className="p-3 sm:p-4 flex flex-col gap-3">
      <ViewHeader
        view="arrange"
        badge={`${regions.length} region${regions.length === 1 ? '' : 's'}`}
        actions={
          <button
            id="btn-arrange-add"
            type="button"
            onClick={() => addRegion()}
            className="btn btn-sm btn-primary gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Region
          </button>
        }
      />

      <div className="flex flex-col gap-2">
        {regions.map((region, index) => {
          const bars = regionBars(region.chords);
          const isPlaying = region.id === playingId;
          return (
            <div
              key={region.id}
              className={`flex items-center gap-2 p-2 rounded-box border bg-base-200 ${
                isPlaying ? 'border-primary/40 bg-primary/5' : 'border-base-300'
              }`}
            >
              <button
                id={`btn-region-select-${region.id}`}
                type="button"
                onClick={() => loadRegion(region.id)}
                className="btn btn-sm btn-ghost flex-1 justify-start gap-2 min-w-0"
              >
                <span className="font-bold text-base-content truncate">{region.name}</span>
                <span className="text-xs text-base-content/50 shrink-0">
                  {bars} bar{bars === 1 ? '' : 's'}
                </span>
              </button>
              <button
                id={`btn-region-up-${region.id}`}
                type="button"
                aria-label={`Move ${region.name} up`}
                disabled={index === 0}
                onClick={() => reorderRegions(region.id, -1)}
                className="btn btn-sm btn-square btn-ghost"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                id={`btn-region-down-${region.id}`}
                type="button"
                aria-label={`Move ${region.name} down`}
                disabled={index === regions.length - 1}
                onClick={() => reorderRegions(region.id, 1)}
                className="btn btn-sm btn-square btn-ghost"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                id={`btn-region-duplicate-${region.id}`}
                type="button"
                aria-label={`Duplicate ${region.name}`}
                onClick={() => handleDuplicate(region.id)}
                className="btn btn-sm btn-square btn-ghost"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                id={`btn-region-delete-${region.id}`}
                type="button"
                aria-label={`Delete ${region.name}`}
                disabled={regions.length <= 1}
                onClick={() => handleDelete(region.id)}
                className="btn btn-sm btn-square btn-ghost"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/components/ArrangeView.test.tsx`
Expected: PASS.

- [ ] **Step 7: Update `src/components/viewMeta.test.ts`**

Change the two coverage expectations to include `arrange`:

```ts
    expect(VIEW_ORDER).toEqual(['synth', 'sequencer', 'chords', 'effects', 'arrange']);
    expect(Object.keys(VIEW_META).sort()).toEqual(
      ['arrange', 'chords', 'effects', 'sequencer', 'synth'],
    );
```

And update the "Header covers every view" test to include `ARRANGE_TABS` (imported from `./Header`, defined in Task 10 — this edit lands with Task 10; **for now** change the expected arrays in `viewMeta.test.ts` to the final five and note the `Header` import will resolve once Task 10 adds `ARRANGE_TABS`; alternatively defer this one assertion to Task 10 and run the rest now):

```ts
    const covered = [...SOLO_TABS, ...ARRANGE_TABS, ...AUTOMATION_TABS.map((t) => t.view)].sort();
    expect(covered).toEqual(['arrange', 'chords', 'effects', 'sequencer', 'synth']);
```

(If you run `bun test src/components/viewMeta.test.ts` between Task 8 and Task 10, expect the "Header covers every view" test to fail until Task 10 defines `ARRANGE_TABS`. Run this file again in Task 10.)

- [ ] **Step 8: Run the theme-token guard on the new component**

Run: `bun run check:theme`
Expected: PASS (no raw colours in `ArrangeView.tsx`).

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/components/viewMeta.ts src/components/ArrangeView.tsx src/components/ArrangeView.test.tsx src/components/viewMeta.test.ts
git commit -m "feat(region): Arrange tab view (SP3 Task 8)"
```

### Task 9: RegionSelector

**Files:**
- Create: `src/components/RegionSelector.tsx`
- Create: `src/components/RegionSelector.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`regions`, `activeRegionId`), `loadRegion`.
- Produces: `export const RegionSelector: React.FC` — a small `<select>` showing the active region's name and switching via `loadRegion`. Consumed by `Header.tsx` in Task 10.

- [ ] **Step 1: Write the failing test `src/components/RegionSelector.test.tsx`**

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { RegionSelector } from './RegionSelector';

describe('RegionSelector', () => {
  test('renders the default active region as an option', () => {
    const html = renderToString(<RegionSelector />);
    expect(html).toContain('id="select-region"');
    expect(html).toContain('Region 1');
    expect(html).toContain('value="region-default-1"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/RegionSelector.test.tsx`
Expected: FAIL with `Cannot find module './RegionSelector'`.

- [ ] **Step 3: Write `src/components/RegionSelector.tsx`**

```tsx
import React from 'react';
import { loadRegion } from '../store/loadRegion';
import { useAppStore } from '../store/store';

/**
 * The region picker shown on the four editing tabs (shared chrome, next to the
 * tab bar). Picking calls the same atomic loadRegion swap as the Arrange tab,
 * so it changes WHICH region the editing tabs target.
 */
export const RegionSelector: React.FC = () => {
  const regions = useAppStore((s) => s.regions);
  const activeRegionId = useAppStore((s) => s.activeRegionId);
  return (
    <select
      id="select-region"
      value={activeRegionId}
      onChange={(e) => loadRegion(e.target.value)}
      className="select select-sm select-ghost font-bold text-primary max-w-32"
      title="Active Region"
    >
      {regions.map((region) => (
        <option key={region.id} value={region.id}>
          {region.name}
        </option>
      ))}
    </select>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/RegionSelector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RegionSelector.tsx src/components/RegionSelector.test.tsx
git commit -m "feat(region): region selector for the editing tabs (SP3 Task 9)"
```

### Task 10: Wire-up — App, Header, TransportBar, tab routing

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/TransportBar.tsx`
- Modify: `src/routing/tabRouting.ts`
- Modify: `src/components/TransportBar.test.tsx`
- Modify: `src/components/Header.test.tsx`
- Modify: `src/components/viewMeta.test.ts` (finalize the `ARRANGE_TABS` assertion from Task 8)

**Interfaces:**
- Consumes: `ArrangeView` (Task 8), `RegionSelector` (Task 9), `useRegionSync` (Task 4), `useSongModeSync` (Task 7), `isSongTab` (Task 6), `Region` type.
- Produces:
  - `Header.tsx`: `export const ARRANGE_TABS: readonly ViewMode[] = ['arrange']`.
  - `TransportBar.tsx`: `export function songModeLabel(songRegionIndex: number | null, regions: readonly Region[]): string | null`.
  - `tabRouting.ts`: `TAB_VALUES` includes `'arrange'` (its existing `parseTabParam` loop and tests keep passing — no test asserts the length).

- [ ] **Step 1: Update `src/routing/tabRouting.ts`**

```ts
export const TAB_VALUES: ViewMode[] = ['synth', 'sequencer', 'chords', 'effects', 'arrange'];
```

Run `bun test src/routing/tabRouting.test.ts` — expected PASS (the "accepts all four valid tab values" test iterates `TAB_VALUES`, so it now covers five).

- [ ] **Step 2: Update `src/App.tsx`**

Add imports:

```tsx
import { ArrangeView } from './components/ArrangeView';
import { useRegionSync } from './store/regionSync';
import { useSongModeSync } from './store/songMode';
```

In the `App` component body, after the `usePlayheadSync()` line:

```tsx
  // Region live-write sync-back + song-mode coordinator (store-level, mounted once).
  useRegionSync();
  useSongModeSync();
```

Add the Arrange mount inside `<main>`, after the `effects` block:

```tsx
        <div className={activeTab === 'arrange' ? 'block' : 'hidden'}>
          <ArrangeView />
        </div>
```

- [ ] **Step 3: Update `src/components/Header.tsx`**

Add imports:

```tsx
import { RegionSelector } from './RegionSelector';
```

Add the const after `SOLO_TABS`:

```tsx
/** The arrange tab: song-mode region list, no transport of its own. */
export const ARRANGE_TABS: readonly ViewMode[] = ['arrange'];
```

In the nav, after the effects group (`</div>` closing the `SOLO_TABS[1]` group), add a divider and the arrange group:

```tsx
        <div className='divider divider-horizontal m-0' />

        <div className={NAV_GROUP_CLASS}>
          <TabButton view={ARRANGE_TABS[0]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>
```

In the right-hand actions group, before the Scale Picker Compact block, render the selector only on editing tabs:

```tsx
        {/* Region picker — hidden on the Arrange tab itself. */}
        {activeTab !== 'arrange' && <RegionSelector />}
```

- [ ] **Step 4: Update `src/components/TransportBar.tsx`**

Add imports:

```tsx
import type { Region } from '../store/types';
```

Add a pure helper above the component:

```ts
/** The song-mode badge: present only while a song position exists. */
export function songModeLabel(
  songRegionIndex: number | null,
  regions: readonly Region[],
): string | null {
  if (songRegionIndex === null) return null;
  const region = regions[songRegionIndex];
  return region ? `Song · ${region.name}` : null;
}
```

In the component, add selectors after the `metronomeActive` selector:

```tsx
  const songRegionIndex = useAppStore((s) => s.songRegionIndex);
  const regions = useAppStore((s) => s.regions);
```

And render the badge right after the master `PlayerTransport` (inside the Left Transport Actions group):

```tsx
        {songModeLabel(songRegionIndex, regions) && (
          <span
            id="badge-song-mode"
            className="badge badge-sm badge-ghost font-bold text-primary hidden md:inline-flex"
            title="Song mode: regions play in order on the Arrange tab"
          >
            {songModeLabel(songRegionIndex, regions)}
          </span>
        )}
```

- [ ] **Step 5: Update `src/components/TransportBar.test.tsx`**

Add a pure-helper test (the badge is absent in the initial snapshot, so it cannot be SSR-tested):

```tsx
import { songModeLabel } from './TransportBar';
import { createDefaultRegion } from '../store/regionSlice';
import type { Region } from '../store/types';

describe('songModeLabel', () => {
  test('returns a song-mode badge only while a song position exists', () => {
    const regions: Region[] = [createDefaultRegion()];
    expect(songModeLabel(null, regions)).toBe(null);
    expect(songModeLabel(0, regions)).toBe('Song · Region 1');
  });
});
```

- [ ] **Step 6: Update `src/components/Header.test.tsx`**

The coverage test at lines ~89-90 becomes:

```ts
    const views = [...SOLO_TABS, ...ARRANGE_TABS, ...AUTOMATION_TABS.map((t) => t.view)].sort();
    expect(views).toEqual(['arrange', 'chords', 'effects', 'sequencer', 'synth']);
```

(Add `ARRANGE_TABS` to the existing import from `./Header`.)

- [ ] **Step 7: Finalize `src/components/viewMeta.test.ts`**

The `Header covers every view across its two tab groups` test now passes with the Task 10 `ARRANGE_TABS` import (already written in Task 8's Step 7).

- [ ] **Step 8: Run the full test suite**

Run: `bun test`
Expected: PASS (including the previously-deferred `viewMeta.test.ts` coverage assertion).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/Header.tsx src/components/TransportBar.tsx src/routing/tabRouting.ts src/components/TransportBar.test.tsx src/components/Header.test.tsx src/components/viewMeta.test.ts
git commit -m "feat(region): wire Arrange tab, region selector, song-mode badge and routing (SP3 Task 10)"
```

### Task 11: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the type-check + invariant + build gate**

Run: `bun run verify`
Expected: PASS (tests + `tsc --noEmit` + `check:keys` + `check:drums` + build).

- [ ] **Step 2: Run the import-layering lint**

Run: `bun run eslint`
Expected: PASS. Verify no `store/` → `components/` or `components/` → `audio/engine` leaks were introduced (the new `ArrangeView`/`RegionSelector` import only `store/`; `loadRegion`/`regionSync`/`songMode` are `store/` modules importing `audio/` — the allowed direction).

- [ ] **Step 3: Run the theme-token guard**

Run: `bun run check:theme`
Expected: PASS.

- [ ] **Step 4: Manual smoke checklist**

1. Fresh project: one region "Region 1", 4 bars; Arrange tab lists it; delete is disabled.
2. Edit a knob on Synth, switch to Arrange, switch back — the edit survived (sync-back writes `regions[activeRegionId]`); confirm via the DevTools Application tab that `musibox_project_state_v1` (version 6) holds the edit inside `regions[]` with no top-level per-region keys.
3. Add a region → auto-activated copy; duplicate → clone right after the original; reorder up/down; delete a non-last region.
4. Play on the Arrange tab → song mode: regions advance in order and wrap; the Arrange row highlight follows the playing region. Switch to Synth mid-song → loop mode (active region loops), song cursor dropped; come back to Arrange and press play → song restarts from the top.
5. On a non-Arrange tab, the Header region selector switches regions (and jumps playback while playing).
6. Load an old v5 project → rehydrates as a single wrapped region with the same content.

- [ ] **Step 5: Commit any fix-ups**

If the gate found issues, fix them in the relevant task's files and commit; then re-run `bun run verify`.

```bash
git add -A
git commit -m "chore(region): final SP3 verification fixes"
```

## Self-Review

**1. Spec coverage** — each spec requirement maps to a task:
- `regionSlice` (regions + activeRegionId, ≥ 1 invariant, 5 setters): Task 2.
- `Region` = identity + 31 per-region fields, per-region ∪ global reconstructs today's snapshot: Task 1 (type), Task 4 (partialize split).
- Atomic swap reusing `applyInstantVibeToStore` pattern (capture → hardStopAll → stopSource chord/bass → write → restart): Task 3.
- Editing model (flat slices = live surface; edits always sync back): Task 4 live-write subscription.
- Region length = Σ chord.bars; boundary = regionLength × stepsPerBar: Task 1 (`regionBars`), Task 6 (`regionLengthSteps`, `songAdvanceTarget`).
- Play mode coupled to tab; transient `songRegionIndex`; advance on boundary with wrap; detach rule: Tasks 6–7.
- Arrange tab (linear list, name + bar count, playing highlight, add/reorder/duplicate/delete, click-to-select): Task 8.
- Region selector on non-Arrange tabs: Task 9 + Header wiring in Task 10.
- Persistence: version 6, `partialize` emits regions + activeRegionId + globals, `wrapFlatStateIntoRegion` at the end of the migrate chain, sanitize of `regions`/`activeRegionId` + corrupt-array fallback, merge loads `regions[activeRegionId]` into the flat slices: Tasks 4–5.
- Sync-back testing (flat edit reaches `regions[activeRegionId]`, post-switch target): Task 4 `regionSync.test.ts`.
- Testing list in the spec (regionBars, wrap, slice actions, loadRegion, boundary + detach, persist round-trip, sync-back): Tasks 1, 2, 3, 4, 5, 6, 7.

**2. Placeholder scan** — every step has actual test code and implementation code; no "TBD"/"implement later"/"add appropriate handling". The two deliberate forward references (`viewMeta.test.ts` `ARRANGE_TABS` assertion resolved in Task 10; `loadRegion`'s `songRegionIndex` added in Task 7) are called out inline with the exact resolution.

**3. Type consistency**
- `REGION_FLAT_KEYS` (Task 1) is the single source for `regionStatePatch` (Task 1), `sanitizeRegions` fallback logic (Task 4, via `createDefaultRegion`), and `wrapFlatStateIntoRegion` (Task 5).
- `loadRegion(id): void` is defined once (Task 3) and consumed by `regionSync.test.ts`, `songMode.ts`, `ArrangeView.tsx`, `RegionSelector.tsx` — same name and signature everywhere.
- `addRegion(): string`, `duplicateRegion(id): string | null`, `deleteRegion(id): string | null`, `reorderRegions(id, direction: -1 | 1)`, `setActiveRegion(id)` are defined in `types.ts` `RegionSlice` (Task 2) and implemented identically in `regionSlice.ts`; `ArrangeView` (Task 8) uses exactly these return contracts for the duplicate/delete `loadRegion` hand-off.
- `songAdvanceTarget` / `regionLengthSteps` / `nextRegionIndex` / `enterSongIndex` / `isSongTab` / `detachSongPosition` are the same names in `songMode.ts` (Task 6), its test (Task 6), and the coordinator (Task 7).
- `regionBars(chords: readonly { bars?: number }[])` is compatible with `ChordItem[]` and with the `shortRegion` fixtures.
- `startRegionSync()`/`useRegionSync()` (Task 4) and `startSongModeSync(deps)`/`useSongModeSync()` (Task 7) follow the established `engineSync` naming; `App.tsx` (Task 10) calls the `use*` variants exactly once.

**Discrepancies found (reported separately in the plan's report-back):**
- (a) Spec prose says `Region` has "30 fields"; the interface block lists 31. The plan implements the 31-field interface verbatim.
- (b) The suggested task list was 10 items; the plan adds an 11th verification-gate task.
- (c) The spec's merge note "wrapped legacy keys are dropped by the existing legacy-key removal" is imprecise: `removeLegacyKeys` drops the pre-Zustand `murva_*` storage keys. The per-region top-level keys are removed from the payload by the wrap itself (Task 5) and by `partializeAppState` (Task 4); stale flat keys on a legacy payload are overridden by the merge region-load. The plan implements the wrap + merge-load, which is the correct mechanism.
- (d) `store.test.ts`'s `persisted hydration returns stored chords verbatim` test needed updating for the v6 payload shape (chords now live inside `regions`), which the plan documents in Task 4 Step 6.
