# Layer-Aware Header (SP4 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the header layer-aware: a "Loop | Song" toggle plus layer-scoped sub-tabs, with the loop selector and key/scale shown only on the loop layer.

**Architecture:** Two small edits to `Header.tsx` (add the toggle and gate the sub-tabs; move the loop selector in and gate key/scale) and one edit to `LoopPage.tsx` (drop the selector). Navigation reuses the existing `setActiveTab` primitive — the route sync (`useRouteSync`) already pushes the `/loop|/song` path and the song-mode coordinator already hard-stops at the boundary on a cross-layer tab change. No new URL or audio wiring.

**Tech Stack:** React 18, Zustand v5, bun:test, daisyUI.

**Spec:** `docs/superpowers/specs/2026-08-30-sp4-loop-song-layers-design.md` (§UI model → "Header (layer-aware)", "Loop selector").

## Global Constraints

- Bun runtime; `bun run lint` = `tsc --noEmit`; `bun run verify` = test + lint + check:keys + check:drums + build (the completion gate).
- Three-layer import boundaries (`components/` never imports `audio/engine`), enforced by eslint `no-restricted-imports`.
- No `tailwind.config.*`; daisyUI theme tokens only; name roles not colours; no raw hex/palette classes (`themeTokenGuard.ts` fails the build on them).
- Automation tab groups keep the `join`+`btn` segmented-control pattern — never daisyUI `tab`/`role="tablist"` for transport-joined groups.
- `setActiveTab` is the single navigation primitive. Do NOT add new URL/audio wiring: the route sync and song-mode hard-stop already react to the tab change.
- No DOM/testing-library. Tests are pure-logic helpers or `renderToString` of store-initialized components that don't touch `document`. `Header`'s render touches `document` (theme init in `useState` initializer), so it is NOT render-tested; its gating is pinned via exported pure helpers instead.

---

### Task 1: Layer toggle + layer-scoped sub-tabs

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/Header.test.tsx`

**Interfaces:**
- Consumes: `Layer`, `layerForTab`, `ViewMode` from `../types`; `defaultTabForLayer` from `../routing/tabRouting`; the existing `AUTOMATION_TABS`, `SONG_NAV_TABS`, `NAV_GROUP_CLASS`, `TabButton`, and `useAppStore`.
- Produces: `LAYER_META`, `layerToggleTarget` (both exported from `Header.tsx` for tests).

- [ ] **Step 1: Write the failing tests** in `src/components/Header.test.tsx`.

Add imports:

```ts
import { LAYER_META, layerToggleTarget } from './Header';
import { defaultTabForLayer, tabsForLayer } from '../routing/tabRouting';
```

Add this describe block (place after the existing `header tab grouping` block):

```ts
describe('layer toggle', () => {
  test('lists the two layers in order with stable labels', () => {
    expect(LAYER_META.map((l) => l.layer)).toEqual(['loop', 'song']);
    expect(LAYER_META.map((l) => l.label)).toEqual(['Loop', 'Song']);
  });

  test('clicking a different layer navigates to that layer default tab', () => {
    expect(layerToggleTarget('loop', 'song')).toBe('arrange');
    expect(layerToggleTarget('song', 'loop')).toBe('synth');
  });

  test('clicking the current layer is a no-op', () => {
    expect(layerToggleTarget('loop', 'loop')).toBeNull();
    expect(layerToggleTarget('song', 'song')).toBeNull();
  });

  test('every toggle target is a tab inside that layer', () => {
    for (const { layer } of LAYER_META) {
      expect(tabsForLayer(layer)).toContain(defaultTabForLayer(layer));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/Header.test.tsx`
Expected: FAIL — `LAYER_META` and `layerToggleTarget` are not exported from `./Header`.

- [ ] **Step 3: Write the implementation** in `src/components/Header.tsx`.

Change the types import (line 7) to also pull the layer helpers and add the routing import:

```ts
import { Layer, layerForTab, ViewMode } from "../types";
import { defaultTabForLayer } from "../routing/tabRouting";
```

Add these exports right after `SONG_NAV_TABS` (line 26):

```ts
/** The two layers in toggle order. Labels are user-facing copy. */
export const LAYER_META: ReadonlyArray<{ layer: Layer; label: string }> = [
  { layer: 'loop', label: 'Loop' },
  { layer: 'song', label: 'Song' },
];

/**
 * The tab to navigate to when the user clicks the layer toggle for `target`
 * while on `current`. Returns `null` when already on `target` — clicking the
 * active layer is a no-op (it must not reset the layer's current sub-tab).
 */
export function layerToggleTarget(current: Layer, target: Layer): ViewMode | null {
  return current === target ? null : defaultTabForLayer(target);
}
```

In the `Header` component body, after `const activeTab = useAppStore((s) => s.activeTab);` add:

```ts
const layer = layerForTab(activeTab);
```

Add the toggle to the brand group (the `<div className="flex items-center gap-2.5 shrink-0">` currently holding only `<Wordmark />`) — insert the toggle after `<Wordmark />`:

```tsx
<div className={NAV_GROUP_CLASS}>
  {LAYER_META.map(({ layer: l, label }) => {
    const isActive = layer === l;
    return (
      <button
        key={l}
        id={`layer-${l}`}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => {
          const target = layerToggleTarget(layer, l);
          if (target) setActiveTab(target);
        }}
        className={`btn btn-sm join-item text-xs font-bold ${
          isActive ? 'btn-active btn-primary' : 'btn-ghost'
        }`}
      >
        {label}
      </button>
    );
  })}
</div>
```

Gate the sub-tab groups by layer and remove the divider. Replace the current `<nav>` children (the two unguarded `<div>` groups and the `divider` between them) with:

```tsx
{layer === 'loop' && (
  <div className="flex items-center gap-1.5 shrink-0">
    {AUTOMATION_TABS.map((tab) => {
      const state = playerStateByModule[tab.module];
      return (
        <div key={tab.view} className={NAV_GROUP_CLASS}>
          <TabButton view={tab.view} activeTab={activeTab} onSelect={setActiveTab} />
          <PlayerTransport
            id={`btn-header-play-${tab.module}`}
            state={state}
            size="sm"
            compact
            unwrapped
            onPlay={() => play(tab.module)}
            onSoftStop={() => softStop(tab.module)}
          />
        </div>
      );
    })}
  </div>
)}
{layer === 'song' && (
  <div className="flex items-center gap-1.5 shrink-0">
    {SONG_NAV_TABS.map((view) => (
      <div key={view} className={NAV_GROUP_CLASS}>
        <TabButton view={view} activeTab={activeTab} onSelect={setActiveTab} />
      </div>
    ))}
  </div>
)}
```

(The loop group's inner markup — `TabButton` + `PlayerTransport` — is unchanged from today; only the wrapping conditional and the removal of the divider differ.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/components/Header.test.tsx`
Expected: PASS (all existing theme/grouping tests + the new `layer toggle` block).

- [ ] **Step 5: Type-check and lint**

Run: `bun run lint`
Expected: clean (no new errors).

- [ ] **Step 6: Commit**

```bash
git add src/components/Header.tsx src/components/Header.test.tsx
git commit -m "feat(header): add loop/song layer toggle and scope sub-tabs by layer"
```

---

### Task 2: Move loop selector into header + gate key/scale to loop layer

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/loop/LoopPage.tsx`
- Modify: `src/components/loop/LoopSelector.tsx` (docstring only)

**Interfaces:**
- Consumes: `LoopSelector` (now imported by `Header` instead of `LoopPage`); the `layer` local from Task 1; `ScaleSelects` (existing).
- Produces: `LoopPage` without the selector; header renders the selector + key/scale only on the loop layer.

- [ ] **Step 1: Move the selector out of the page** in `src/components/loop/LoopPage.tsx`.

Remove the `LoopSelector` import and its render line, so the file reads:

```tsx
import React from 'react';
import { useAppStore } from '../../store/store';
import { SynthView } from './SynthView';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';

export const LoopPage: React.FC = () => {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'synth' ? 'block' : 'hidden'}><SynthView /></div>
      <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}><SequencerView /></div>
      <div className={activeTab === 'chords' ? 'block' : 'hidden'}><ChordView /></div>
    </>
  );
};
```

- [ ] **Step 2: Render the selector + gate key/scale in the header** in `src/components/Header.tsx`.

Add the import (next to the other component imports):

```ts
import { LoopSelector } from "./loop/LoopSelector";
```

In the right-hand group (`<div className="flex items-center gap-1.5 shrink-0 xl:justify-self-end">`), wrap the loop-scoped controls in a `layer === 'loop'` fragment, before the theme button:

```tsx
<div className="flex items-center gap-1.5 shrink-0 xl:justify-self-end">
  {layer === 'loop' && (
    <>
      <LoopSelector />
      {/* Scale Picker Compact */}
      <div className="hidden md:flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-field">
        <ScaleSelects idPrefix="select-master-scale" />
      </div>

      {/* Below `md` the inline picker would leave the nav about 20px of room,
          so the same two selects move behind a root-note pill instead. */}
      <details className="dropdown dropdown-end md:hidden">
        <summary
          id="btn-scale-dropdown"
          className="btn btn-sm btn-ghost gap-1 text-xs font-bold list-none"
          title={`Key & Scale — ${scaleRoot} ${SCALES[scaleType]?.name ?? scaleType}`}
        >
          <span className="text-primary">{scaleRoot}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </summary>
        <div className="dropdown-content z-50 mt-1 w-56 p-2 flex flex-col gap-2 bg-base-100 border border-base-300 rounded-box shadow-xl">
          <ScaleSelects idPrefix="select-master-scale-compact" stacked />
        </div>
      </details>
    </>
  )}

  {/* Theme Toggle Button */}
  <button id="btn-toggle-theme" onClick={toggleTheme} ...>...</button>
</div>
```

(The inner markup of `LoopSelector`, `ScaleSelects`, and the dropdown is unchanged — only the `{layer === 'loop' && (...)}` wrapper is added, and `LoopSelector` is newly rendered. Keep the theme button outside the wrapper so it stays visible on both layers.)

- [ ] **Step 3: Fix the stale docstring** in `src/components/loop/LoopSelector.tsx`.

Replace the component's leading comment ("The loop picker shown on the four editing tabs (shared chrome, next to the tab bar)...") so it says the selector lives in the **header** on the loop layer. Keep `onSelectLoop` unchanged (it is covered by `LoopSelector.test.tsx`, which still passes because it imports `./LoopSelector` directly and `LoopSelector` does not touch `document`).

- [ ] **Step 4: Run tests**

Run: `bun test src/components/loop/LoopSelector.test.tsx src/components/Header.test.tsx`
Expected: PASS — `LoopSelector.test.tsx` is unaffected by the move; Header tests still pass.

- [ ] **Step 5: Type-check, lint, and full gate**

Run: `bun run lint` then `bun run verify`
Expected: clean; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/Header.tsx src/components/loop/LoopPage.tsx src/components/loop/LoopSelector.tsx
git commit -m "feat(header): move loop selector into header and show key/scale on loop layer only"
```

---

## Verification (after both tasks)

Manual click-through via `bun run dev`:

1. Land on `/loop?tab=synth`: header shows `Loop | Song` toggle (Loop active), the three loop tabs with transports, the loop-selector dropdown, key/scale, and theme.
2. Click **Song**: URL becomes `/song?tab=arrange`; header shows only Arrange + Master FX tabs; loop selector and key/scale disappear; theme stays. If audio was playing, it hard-stops.
3. Click **Loop**: back to `/loop?tab=synth`; loop selector + key/scale reappear.
4. On Arrange, use **Edit** on a row: deep-links to `/loop?tab=synth&loopId=<id>` with that loop selected in the header dropdown.
