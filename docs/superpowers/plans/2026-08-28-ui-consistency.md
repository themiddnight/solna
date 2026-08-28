# Cross-Tab UI Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Solna's four tabs one structural vocabulary — a shared view header, one on/off control, one preset noun, one casing rule — and move the visualizer out of the transport bar so every tab shows the playhead.

**Architecture:** Three new `ui/` primitives (`ViewHeader`, `PowerToggle`, plus a `viewMeta` data table) replace markup that was copy-pasted into three view files. Consistency is enforced by data and by closed union types rather than by discipline: the tab bar and the view header read the same table, so they cannot disagree, and a test asserts the four tab icons are distinct.

**Tech Stack:** React 18 + Vite, Bun test runner, Zustand, Tailwind v4 + daisyUI v5 (CSS-first, **no `tailwind.config.*` exists and none may be added**), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-08-28-ui-consistency-design.md` — read it alongside this plan.

## Global Constraints

Every task's requirements implicitly include this section.

* **Gate:** `bun run verify` must pass before every commit. Run `bun run eslint` separately in any task that touches imports (Task 10).
* **No `tailwind.config.*`.** Themes are CSS-first in `src/index.css`.
* **Token discipline** (`scripts/themeTokenGuard.ts`, `ALLOWLIST` is empty and must stay empty): no raw hex, no Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), no `text-white` / `bg-black`, no `dark:` variant, no `rgb()`/`rgba()` literals, no dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Name roles, never colours.
* **Tailwind v4 scans source statically.** Never build a class name by string concatenation or template interpolation — a class assembled at runtime is never generated. Use literal strings in lookup tables.
* **Verify daisyUI v5 class names against the v5 docs before writing them.** v4 names silently do nothing (`card-compact` → `card-sm`).
* **Layering** (`eslint.config.js`): `components/` must not import `audio/engine`. Only `AudioVisualizer.tsx`, `TransportBar.tsx` and test files are exempt. Task 10 adds one more, deliberately.
* **Never call engine setters from a component.** New audio-visible state goes in a slice and is wired in `store/engineSync.ts`.
* **Tests are `bun:test` and pure-logic.** There is no DOM or testing-library setup. Components export their testable helpers and the test imports those; never render React in a test.
* **Copy rules:** view header titles are Title Case; in-page section headers are `text-xs font-bold uppercase tracking-wider`; card titles are Title Case. The preset noun is **Library**, never "Presets".

---

### Task 1: `viewMeta` — one table for tab buttons and view headers

Fixes design §1 problem 2 (Synth and Master FX share the `Sliders` icon; tab text is `hidden xl:inline`, so below 1280px the two tabs are indistinguishable).

**Files:**
- Create: `src/components/viewMeta.ts`
- Create: `src/components/viewMeta.test.ts`
- Modify: `src/components/Header.tsx:26-62` (`AUTOMATION_TABS`, `SOLO_TABS`, `TabButton`), `src/components/Header.tsx:205-244` (the three `TabButton` call sites)
- Modify: `src/components/Header.test.tsx:2,85,89` — the import line, and the two assertions that call `SOLO_TABS.map((t) => t.view)`. `SOLO_TABS` becomes a bare `ViewMode[]`, so `t.view` would silently be `undefined` and the assertion would compare `[undefined, undefined]` rather than failing usefully.

**Interfaces:**
- Consumes: `ViewMode` from `src/types.ts` (`'synth' | 'sequencer' | 'chords' | 'effects'`), `PlayerModule` from `src/store/types.ts`.
- Produces: `VIEW_META: Record<ViewMode, ViewMeta>`, `ViewMeta { icon: LucideIcon; tabLabel: string; title: string }`, `VIEW_ORDER: readonly ViewMode[]`. Tasks 4, 5, 6, 9 and `ui/ViewHeader` all read `VIEW_META`.
- Changed exports: `AUTOMATION_TABS: ReadonlyArray<{ view: ViewMode; module: PlayerModule }>` (was `Array<NavTab & { module }>`), `SOLO_TABS: readonly ViewMode[]` (was `NavTab[]`).

- [ ] **Step 1: Write the failing test**

Create `src/components/viewMeta.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { VIEW_META, VIEW_ORDER } from './viewMeta';
import { AUTOMATION_TABS, SOLO_TABS } from './Header';

describe('VIEW_META', () => {
  test('covers every view exactly once', () => {
    expect(VIEW_ORDER).toEqual(['synth', 'sequencer', 'chords', 'effects']);
    expect(Object.keys(VIEW_META).sort()).toEqual(
      ['chords', 'effects', 'sequencer', 'synth'],
    );
  });

  // The bug this pins: Synth and Master FX both used `Sliders`, and the tab
  // label is `hidden xl:inline`, so under 1280px the two tabs rendered
  // identically. Distinctness is now an invariant, not a code review.
  test('every view has its own icon', () => {
    const icons = VIEW_ORDER.map((v) => VIEW_META[v].icon);
    expect(new Set(icons).size).toBe(VIEW_ORDER.length);
  });

  test('labels and titles are unique and non-empty', () => {
    const tabLabels = VIEW_ORDER.map((v) => VIEW_META[v].tabLabel);
    const titles = VIEW_ORDER.map((v) => VIEW_META[v].title);
    expect(new Set(tabLabels).size).toBe(VIEW_ORDER.length);
    expect(new Set(titles).size).toBe(VIEW_ORDER.length);
    expect(tabLabels.every((l) => l.trim().length > 0)).toBe(true);
    expect(titles.every((t) => t.trim().length > 0)).toBe(true);
  });

  test('Header covers every view across its two tab groups', () => {
    const covered = [...SOLO_TABS, ...AUTOMATION_TABS.map((t) => t.view)].sort();
    expect(covered).toEqual(['chords', 'effects', 'sequencer', 'synth']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/viewMeta.test.ts`
Expected: FAIL — `Cannot find module './viewMeta'`.

- [ ] **Step 3: Create the table**

Create `src/components/viewMeta.ts`:

```ts
import { AudioWaveform, Grid, Music, Sliders, type LucideIcon } from 'lucide-react';
import type { ViewMode } from '../types';

/**
 * One row per tab: the icon and the two names it goes by. Both `Header`'s tab
 * buttons and `ui/ViewHeader` read this table, so a tab and the view it opens
 * can never disagree about what they are called.
 *
 * `tabLabel` is the short form on the nav button (hidden below `xl`);
 * `title` is the long form on the view's own header card.
 */
export interface ViewMeta {
  icon: LucideIcon;
  tabLabel: string;
  title: string;
}

/** Left-to-right order in the nav; also the iteration order tests assert on. */
export const VIEW_ORDER = ['synth', 'sequencer', 'chords', 'effects'] as const;

export const VIEW_META: Record<ViewMode, ViewMeta> = {
  synth: { icon: Sliders, tabLabel: 'Synth', title: 'Synth Lab' },
  sequencer: { icon: Grid, tabLabel: 'Beat Step', title: 'Drum Sequencer' },
  chords: { icon: Music, tabLabel: 'Chords', title: 'Chord Studio' },
  // Was `Sliders`, identical to Synth's — see viewMeta.test.ts.
  effects: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
};
```

- [ ] **Step 4: Rewire `Header.tsx` to read the table**

In `src/components/Header.tsx`, delete the `NavTab` interface and replace the two tab constants and `TabButton` (lines 19-62):

```tsx
/** The two automation players. Each gets its own play / soft-stop button. */
export const AUTOMATION_TABS: ReadonlyArray<{ view: ViewMode; module: PlayerModule }> = [
  { view: 'sequencer', module: 'sequencer' },
  { view: 'chords', module: 'chords' },
];

/** Views with nothing to play: the instrument and the master rack. */
export const SOLO_TABS: readonly ViewMode[] = ['synth', 'effects'];

/**
 * One view-switch button. Deliberately NOT daisyUI's `tab` component: an
 * automation group joins this button to a transport control, and daisyUI's
 * tabs expect a `role="tablist"` holding only `role="tab"` children. This is
 * the documented join + btn + btn-active segmented-control pattern instead,
 * so every group is one `join` whose direct children all carry `join-item`.
 *
 * Icon and label come from VIEW_META, never from a local literal.
 */
const TabButton: React.FC<{
  view: ViewMode;
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
}> = ({ view, activeTab, onSelect }) => {
  const isActive = activeTab === view;
  const { icon: Icon, tabLabel } = VIEW_META[view];
  return (
    <button
      id={`tab-${view}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onSelect(view)}
      className={`btn btn-sm join-item gap-1.5 text-xs font-bold whitespace-nowrap ${
        isActive ? 'btn-active btn-primary' : 'btn-ghost'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="hidden xl:inline">{tabLabel}</span>
    </button>
  );
};
```

Add `import { VIEW_META } from './viewMeta';` and drop `Grid`, `Music`, `Sliders` and `type LucideIcon` from the `lucide-react` import (keep `Sun`, `Moon`, `ChevronDown`).

- [ ] **Step 5: Update the three call sites**

`Header.tsx` line ~207: `<TabButton tab={SOLO_TABS[0]} …>` → `<TabButton view={SOLO_TABS[0]} activeTab={activeTab} onSelect={setActiveTab} />`
Line ~243: same for `SOLO_TABS[1]`.
Inside the `AUTOMATION_TABS.map` (line ~221): `<TabButton view={tab.view} activeTab={activeTab} onSelect={setActiveTab} />`.

- [ ] **Step 6: Update the two `SOLO_TABS` assertions**

In `src/components/Header.test.tsx`, line 85 becomes `expect(SOLO_TABS).toEqual(['synth', 'effects']);` and line 89's mapping becomes:

```ts
    const views = [...SOLO_TABS, ...AUTOMATION_TABS.map((t) => t.view)].sort();
```

`AUTOMATION_TABS` keeps its `.view` field, so line 80 is unchanged.

- [ ] **Step 7: Run the tests**

Run: `bun test src/components/viewMeta.test.ts src/components/Header.test.tsx`
Expected: PASS.

- [ ] **Step 8: Gate and commit**

```bash
bun run verify
git add src/components/viewMeta.ts src/components/viewMeta.test.ts src/components/Header.tsx src/components/Header.test.tsx
git commit -m "feat(ui): centralise tab icon and titles in viewMeta

Synth and Master FX both rendered the Sliders icon, and the tab label is
hidden below xl, so the two tabs were indistinguishable under 1280px.
Header now reads icon and label from one table that ViewHeader will share,
and a test pins the four icons as distinct."
```

---

### Task 2: `ui/PowerToggle` — one on/off control

Fixes design §1 problem 3 (three different on/off languages) and design §3.4.

**Files:**
- Create: `src/components/ui/PowerToggle.tsx`
- Create: `src/components/ui/PowerToggle.test.tsx`

**Interfaces:**
- Produces: `PowerToggleTone`, `POWER_TOGGLE_TONES`, `resolvePowerToggle(on, tone, iconOnly): { className: string; label: string }`, and the `PowerToggle` component. Tasks 4, 5 and 6 consume it.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/PowerToggle.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { POWER_TOGGLE_TONES, resolvePowerToggle } from './PowerToggle';

describe('resolvePowerToggle', () => {
  test('on wears the module tone, off is a plain ghost', () => {
    const on = resolvePowerToggle(true, 'module-chord', false);
    expect(on.className).toContain('[--btn-color:var(--color-module-chord)]');
    expect(on.label).toBe('On');

    const off = resolvePowerToggle(false, 'module-chord', false);
    expect(off.className).toContain('btn-ghost');
    expect(off.label).toBe('Off');
  });

  // design.md 6.5: `error` means destructive. ChordView used to paint the
  // off state btn-error, which reads as "broken" rather than "muted".
  test('the off state is never an error colour, for any tone', () => {
    for (const tone of POWER_TOGGLE_TONES) {
      expect(resolvePowerToggle(false, tone, false).className).not.toContain('error');
      expect(resolvePowerToggle(true, tone, false).className).not.toContain('error');
    }
  });

  test('every tone resolves to a token class, never a raw palette', () => {
    for (const tone of POWER_TOGGLE_TONES) {
      const { className } = resolvePowerToggle(true, tone, false);
      expect(className).not.toMatch(/indigo|slate|purple|emerald|pink|cyan|rose/);
      expect(className).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  test('iconOnly drops the text but keeps the square button shape', () => {
    const square = resolvePowerToggle(true, 'primary', true);
    expect(square.className).toContain('btn-square');
    expect(resolvePowerToggle(true, 'primary', false).className).not.toContain('btn-square');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/PowerToggle.test.tsx`
Expected: FAIL — `Cannot find module './PowerToggle'`.

- [ ] **Step 3: Write the component**

Create `src/components/ui/PowerToggle.tsx`:

```tsx
import React from 'react';
import { Power } from 'lucide-react';

/**
 * Closed union, in the spirit of `KnobColor` in Knob.tsx: the set of legal
 * toggle tones stays reviewable, and Tailwind can see every class literally.
 *
 * Sequencer track mutes deliberately do NOT pass their track's colour —
 * `SequencerTrack.color` is a persisted string (store/initialState.ts) and so
 * cannot join a closed union, and the coloured dot beside the track name
 * already carries that identity. Track mutes pass 'primary'.
 */
export const POWER_TOGGLE_TONES = ['primary', 'accent', 'module-chord', 'module-bass'] as const;
export type PowerToggleTone = (typeof POWER_TOGGLE_TONES)[number];

/**
 * Full literal class strings. Never assemble these by interpolation —
 * Tailwind v4 scans source statically and would emit nothing.
 */
const TONE_CLASS: Record<PowerToggleTone, string> = {
  primary: 'btn-primary',
  accent: 'btn-accent',
  // No leading `btn` here — the component already applies `btn btn-${size}`.
  'module-chord':
    '[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]',
  'module-bass':
    '[--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]',
};

/**
 * Pure state -> appearance mapping, exported so behaviour is testable without
 * a DOM — the same shape as `resolveTransportButtons` in PlayerTransport.tsx.
 *
 * On wears the module's own tone; off is `btn-ghost` plus dimmed text. The off
 * state is never `btn-error`: per design.md 6.5, `error` means destructive, so
 * red would read as "this is broken" rather than "this is muted".
 */
export function resolvePowerToggle(
  on: boolean,
  tone: PowerToggleTone,
  iconOnly: boolean,
): { className: string; label: string } {
  const shape = iconOnly ? 'btn-square' : 'gap-1';
  return {
    className: on
      ? `${TONE_CLASS[tone]} btn-active ${shape}`
      : `btn-ghost text-base-content/40 ${shape}`,
    label: on ? 'On' : 'Off',
  };
}

export interface PowerToggleProps {
  on: boolean;
  onToggle: () => void;
  /** Subject of the control, e.g. "Chord", "Reverb". Rendered as `${name} On`. */
  name: string;
  tone: PowerToggleTone;
  /** Icon-only square button — used for the sequencer's per-track mutes. */
  iconOnly?: boolean;
  size?: 'xs' | 'sm';
  id?: string;
}

/**
 * The app's single on/off affordance. One icon everywhere: `Power` means
 * on/off, and `Volume2`/`VolumeX` are reserved for actual level controls.
 */
export const PowerToggle: React.FC<PowerToggleProps> = ({
  on, onToggle, name, tone, iconOnly = false, size = 'sm', id,
}) => {
  const { className, label } = resolvePowerToggle(on, tone, iconOnly);
  return (
    <button
      id={id}
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`btn btn-${size} text-xs font-semibold ${className}`}
      title={`${name} — ${label}`}
    >
      <Power className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {!iconOnly && <span>{`${name} ${label}`}</span>}
    </button>
  );
};
```

> `btn-${size}` interpolates, but both `btn-xs` and `btn-sm` already appear
> literally elsewhere in `src/`, so Tailwind emits them. If that ever stops
> being true, replace it with a two-entry literal map.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/ui/PowerToggle.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Gate and commit**

```bash
bun run verify
git add src/components/ui/PowerToggle.tsx src/components/ui/PowerToggle.test.tsx
git commit -m "feat(ui): add PowerToggle, one on/off control for all views

Chords, Master FX and the sequencer each expressed on/off differently, and
Chords painted the off state btn-error, which reads as an error rather than
a mute. One primitive, one Power icon, and off is never red."
```

---

### Task 3: `Knob` descriptor badge

Fixes design §1 problem 9 and §4.4. Removes four hand-rolled badges from `SimpleSynthPanel`.

**Files:**
- Modify: `src/components/ui/Knob.tsx:21-34` (`KnobColor`), `:36-55` (`KnobProps`), `:279-283` (vertical value block)
- Modify: `src/components/ui/Knob.test.tsx` (append)
- Modify: `src/components/SimpleSynthPanel.tsx` (four macro cards)

**Interfaces:**
- Produces: `KNOB_COLORS: readonly KnobColor[]`, `badgeColorFor(color: KnobColor): string`, and `KnobProps.descriptor?: string`. Tasks 4 and 5 pass `descriptor`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ui/Knob.test.tsx`:

```tsx
import { badgeColorFor, KNOB_COLORS } from './Knob';

describe('badgeColorFor', () => {
  test('every legal knob colour has a badge class', () => {
    for (const color of KNOB_COLORS) {
      expect(badgeColorFor(color)).toMatch(/^\[--badge-color:var\(--color-[a-z-]+\)\]$/);
    }
    expect(new Set(KNOB_COLORS.map(badgeColorFor)).size).toBe(KNOB_COLORS.length);
  });

  test('maps the colour role, not a palette name', () => {
    expect(badgeColorFor('text-module-filter')).toBe('[--badge-color:var(--color-module-filter)]');
    expect(badgeColorFor('text-primary')).toBe('[--badge-color:var(--color-primary)]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/Knob.test.tsx`
Expected: FAIL — `badgeColorFor is not a function`.

- [ ] **Step 3: Derive the union from a runtime list and add the map**

In `src/components/ui/Knob.tsx`, replace lines 21-34 with:

```ts
/** Runtime list so tests can assert the badge map is exhaustive. */
export const KNOB_COLORS = [
  'text-primary',
  'text-secondary',
  'text-accent',
  'text-success',
  'text-error',
  'text-module-chord',
  'text-module-bass',
  'text-module-osc',
  'text-module-filter',
  'text-module-env-vca',
  'text-module-env-vcf',
  'text-module-lfo',
  'text-module-arp',
] as const;

export type KnobColor = (typeof KNOB_COLORS)[number];

/**
 * Badge tint for the descriptor, keyed off the knob's own colour so the badge
 * and the needle always agree.
 *
 * Written out as literals on purpose: Tailwind v4 scans source statically, so
 * a class assembled from `--color-${token}` at runtime would never be emitted.
 */
const BADGE_COLOR: Record<KnobColor, string> = {
  'text-primary': '[--badge-color:var(--color-primary)]',
  'text-secondary': '[--badge-color:var(--color-secondary)]',
  'text-accent': '[--badge-color:var(--color-accent)]',
  'text-success': '[--badge-color:var(--color-success)]',
  'text-error': '[--badge-color:var(--color-error)]',
  'text-module-chord': '[--badge-color:var(--color-module-chord)]',
  'text-module-bass': '[--badge-color:var(--color-module-bass)]',
  'text-module-osc': '[--badge-color:var(--color-module-osc)]',
  'text-module-filter': '[--badge-color:var(--color-module-filter)]',
  'text-module-env-vca': '[--badge-color:var(--color-module-env-vca)]',
  'text-module-env-vcf': '[--badge-color:var(--color-module-env-vcf)]',
  'text-module-lfo': '[--badge-color:var(--color-module-lfo)]',
  'text-module-arp': '[--badge-color:var(--color-module-arp)]',
};

export function badgeColorFor(color: KnobColor = 'text-primary'): string {
  return BADGE_COLOR[color];
}
```

- [ ] **Step 4: Add the prop and render it**

In `KnobProps` (after `label?: string;`):

```ts
  /**
   * Plain-language reading of the current value, shown as a badge under the
   * knob (vertical layout only). Use it where the number alone does not say
   * what the user will hear — decay in seconds, cutoff in Hz — and NOT for
   * percentages or dB, which already read plainly.
   */
  descriptor?: string;
```

Add `descriptor,` to the destructured props, then replace the vertical value block at the end of the render:

```tsx
      {layout === 'vertical' && (
        <span className="text-[10px] tabular-nums text-current block text-center">
          {display}
        </span>
      )}
      {layout === 'vertical' && descriptor !== undefined && (
        <span
          className={`badge badge-sm badge-soft text-[10px] font-semibold ${badgeColorFor(color)}`}
        >
          {descriptor}
        </span>
      )}
```

- [ ] **Step 5: Move `SimpleSynthPanel`'s four badges onto the prop**

For each of the four macro cards in `src/components/SimpleSynthPanel.tsx`, delete the trailing `<span className="badge badge-sm badge-soft …">{toneLabel}</span>` element and pass the value to the `Knob` instead — e.g. for Tone:

```tsx
                <Knob
                  id="simple-macro-tone"
                  label=""
                  color="text-module-filter"
                  descriptor={toneLabel}
                  value={cutoffValue}
                  min={300}
                  max={12000}
                  step={50}
                  format={(v) => `${(v / 1000).toFixed(1)}k`}
                  onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
                />
```

Repeat for `spaceLabel` / `text-module-env-vca`, `vibeLabel` / `text-module-lfo`, `punchLabel` / `text-module-osc`. The card body's `justify-between` still works — the badge is now the knob's last child rather than the card's.

- [ ] **Step 6: Run tests**

Run: `bun test src/components/ui/Knob.test.tsx src/components/SimpleSynthPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Gate and commit**

```bash
bun run verify
git add src/components/ui/Knob.tsx src/components/ui/Knob.test.tsx src/components/SimpleSynthPanel.tsx
git commit -m "feat(ui): move the knob descriptor badge into Knob

SimpleSynthPanel hand-rolled the same badge four times. Knob now owns it and
tints it from its own colour, and a test pins the colour map as exhaustive
over KnobColor."
```

---

### Task 4: `ui/ViewHeader` and the Master FX rework

Creates the shared header and proves it on the smallest view. Fixes problems 1 and 8, plus §3.2 and §5.

`ViewHeader` is a layout shell with no branching logic, so it has no unit test of its own — the repo has no DOM test setup and inventing a helper just to have something to assert would be worse. Its correctness is proved by adoption here and in Tasks 5, 6 and 9, plus the visual check in Step 7.

**Files:**
- Create: `src/components/ui/ViewHeader.tsx`
- Create: `src/components/fxDescriptors.ts`
- Create: `src/components/fxDescriptors.test.ts`
- Modify: `src/components/EffectsRackView.tsx` (whole file)

**Interfaces:**
- Consumes: `VIEW_META` (Task 1), `PowerToggle` (Task 2), `Knob.descriptor` (Task 3).
- Produces: `ViewHeader` component; `reverbDecayDescriptor`, `delayFeedbackDescriptor`, `distortionDriveDescriptor`. Tasks 5, 6 and 9 consume `ViewHeader`.

- [ ] **Step 1: Write the failing descriptor test**

Create `src/components/fxDescriptors.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  reverbDecayDescriptor,
} from './fxDescriptors';

describe('reverbDecayDescriptor', () => {
  test('names the space at the boundaries of the 0.5s-6.0s range', () => {
    expect(reverbDecayDescriptor(0.5)).toBe('Room');
    expect(reverbDecayDescriptor(1.4)).toBe('Room');
    expect(reverbDecayDescriptor(1.5)).toBe('Hall');
    expect(reverbDecayDescriptor(3.4)).toBe('Hall');
    expect(reverbDecayDescriptor(3.5)).toBe('Cathedral');
    expect(reverbDecayDescriptor(6.0)).toBe('Cathedral');
  });
});

describe('delayFeedbackDescriptor', () => {
  test('names the repeat character across 0-1', () => {
    expect(delayFeedbackDescriptor(0)).toBe('Slapback');
    expect(delayFeedbackDescriptor(0.24)).toBe('Slapback');
    expect(delayFeedbackDescriptor(0.25)).toBe('Echo');
    expect(delayFeedbackDescriptor(0.64)).toBe('Echo');
    expect(delayFeedbackDescriptor(0.65)).toBe('Runaway');
    expect(delayFeedbackDescriptor(1)).toBe('Runaway');
  });
});

describe('distortionDriveDescriptor', () => {
  test('names the drive character across 0-1', () => {
    expect(distortionDriveDescriptor(0)).toBe('Warm');
    expect(distortionDriveDescriptor(0.29)).toBe('Warm');
    expect(distortionDriveDescriptor(0.3)).toBe('Crunch');
    expect(distortionDriveDescriptor(0.64)).toBe('Crunch');
    expect(distortionDriveDescriptor(0.65)).toBe('Fuzz');
    expect(distortionDriveDescriptor(1)).toBe('Fuzz');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/fxDescriptors.test.ts`
Expected: FAIL — `Cannot find module './fxDescriptors'`.

- [ ] **Step 3: Write the descriptors**

Create `src/components/fxDescriptors.ts`:

```ts
/**
 * Plain-language readings for the master-rack knobs, kept out of
 * EffectsRackView so they can be tested without rendering React — the same
 * pattern as sequencerGrid.ts and meterSelect.ts.
 *
 * Only parameters whose number does not say what the user will hear get one.
 * Mix percentages and EQ gains in dB already read plainly and deliberately
 * have no descriptor; adding one there would be noise, not consistency.
 */

/** Reverb decay, 0.5s - 6.0s. */
export function reverbDecayDescriptor(seconds: number): string {
  if (seconds < 1.5) return 'Room';
  if (seconds < 3.5) return 'Hall';
  return 'Cathedral';
}

/** Delay feedback, 0 - 1. */
export function delayFeedbackDescriptor(amount: number): string {
  if (amount < 0.25) return 'Slapback';
  if (amount < 0.65) return 'Echo';
  return 'Runaway';
}

/** Distortion drive, 0 - 1. */
export function distortionDriveDescriptor(amount: number): string {
  if (amount < 0.3) return 'Warm';
  if (amount < 0.65) return 'Crunch';
  return 'Fuzz';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/fxDescriptors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `ViewHeader`**

Create `src/components/ui/ViewHeader.tsx`:

```tsx
import React from 'react';
import type { ViewMode } from '../../types';
import { VIEW_META } from '../viewMeta';

export interface ViewHeaderProps {
  view: ViewMode;
  /** Machine-computed context, e.g. the sequencer's "16-Step · 4/4". */
  badge?: React.ReactNode;
  /** Right-hand control cluster. */
  actions?: React.ReactNode;
  /** Absolutely-positioned extras that belong to the header, e.g. save toasts. */
  children?: React.ReactNode;
}

/**
 * The header card every view opens with. This markup used to be copy-pasted
 * into SequencerView, ChordView and EffectsRackView (and was simply missing
 * from SynthView); centralising it is what stops the four from drifting again.
 *
 * The icon chip is always `primary`. Module identity colours are reserved for
 * the synth's signal stages (design.md 6.5) — ChordView used to tint this chip
 * `module-chord`, which is the violation this component removes.
 */
export const ViewHeader: React.FC<ViewHeaderProps> = ({ view, badge, actions, children }) => {
  const { icon: Icon, title } = VIEW_META[view];
  return (
    <div className="card bg-panel border border-base-300 shadow-md relative">
      <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-selector bg-primary/20 border border-primary/30 text-primary">
            <Icon className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-base-content">{title}</h2>
          {badge !== undefined && (
            <span className="badge badge-sm badge-outline text-[10px] font-semibold tabular-nums">
              {badge}
            </span>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex items-center flex-wrap gap-1.5">{actions}</div>
        )}
        {children}
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Rework `EffectsRackView`**

Replace the hand-rolled header (lines 20-31) with `<ViewHeader view="effects" />`.

Change the rack grid from `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` to `grid-cols-1 lg:grid-cols-2` and wrap it in a section:

```tsx
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-base-content px-1">
          FX Chain
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {/* the four units */}
        </div>
      </section>
```

For each of the four unit cards, replace the header row's `<span>` and bypass `<button>` with:

```tsx
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className="badge badge-sm badge-outline tabular-nums">1</span>
                <Waves className="w-3.5 h-3.5 text-accent" />
                Space Reverb
              </span>
              <PowerToggle
                id="btn-bypass-reverb"
                on={!effects.reverbBypass}
                onToggle={() => updateFx({ reverbBypass: !effects.reverbBypass })}
                name="Reverb"
                tone="accent"
                size="xs"
              />
            </div>
```

Repeat with badge `2` / `Stereo Echo` / `Delay`, `3` / `Distortion`, `4` / `3-Band EQ`, each keeping its existing icon. Note the polarity flip: `on={!effects.*Bypass}`.

Add descriptors to the three knobs that earn one:

```tsx
  descriptor={reverbDecayDescriptor(effects.reverbDecay)}   // Decay knob
  descriptor={delayFeedbackDescriptor(effects.delayFeedback)} // Feedback knob
  descriptor={distortionDriveDescriptor(effects.distortionDrive)} // Drive knob
```

Leave every Mix knob and all three EQ gain knobs without a descriptor.

Add the imports: `ViewHeader`, `PowerToggle`, and the three descriptor functions. Drop `Sliders` and `Power` from the `lucide-react` import if nothing else uses them.

> Check the field names on `MasterEffects` in `src/types.ts` before writing the
> descriptor calls — use whatever `EffectsRackView` already reads for the
> delay-feedback and distortion-drive knobs rather than assuming these names.

- [ ] **Step 7: Verify visually in both themes**

```bash
bun run dev
```
Open `http://localhost:3000/?tab=effects`. Confirm: header title reads "Master Effects Rack" with the waveform icon; four units in a 2×2 grid; each unit header shows `[N] Title Case`; the three descriptor badges appear under their knobs; bypassing a unit dims it and the toggle goes ghost — **not red**. Toggle the theme and check the same page in `solna-light`.

- [ ] **Step 8: Gate and commit**

```bash
bun run verify
git add src/components/ui/ViewHeader.tsx src/components/fxDescriptors.ts src/components/fxDescriptors.test.ts src/components/EffectsRackView.tsx
git commit -m "feat(fx): adopt ViewHeader and PowerToggle in the master rack

Extracts the header card the three views had copy-pasted, and reworks the
rack into a two-column FX Chain section so the units are readable and there
is room for a compressor or graphic EQ later."
```

---

### Task 5: `SequencerView` adopts the shared header

Fixes problems 1, 3 and 5 for this view, plus §3.5 (the meter moves from the title into a badge).

**Files:**
- Modify: `src/components/sequencerGrid.ts:9-12`
- Modify: `src/components/sequencerGrid.test.ts:5-12`
- Modify: `src/components/SequencerView.tsx:122-233` (header), and the per-track mute buttons (~line 322)

**Interfaces:**
- Consumes: `ViewHeader` (Task 4), `PowerToggle` (Task 2).
- Produces: `sequencerMeterBadge(meter: Meter): string`, replacing `sequencerTitle`.

- [ ] **Step 1: Rewrite the failing test**

In `src/components/sequencerGrid.test.ts`, replace the `sequencerTitle` describe block:

```ts
describe('sequencerMeterBadge', () => {
  // The name now comes from VIEW_META; the badge carries only the
  // machine-computed part, which design.md 3 says belongs in tabular-nums
  // chrome rather than inside a heading.
  test('reports step count and meter label', () => {
    expect(sequencerMeterBadge(METERS['4/4'])).toBe('16-Step · 4/4');
    expect(sequencerMeterBadge(METERS['3/4'])).toBe('12-Step · 3/4');
    expect(sequencerMeterBadge(METERS['6/8'])).toBe('12-Step · 6/8');
    expect(sequencerMeterBadge(METERS['12/8'])).toBe('24-Step · 12/8');
    expect(sequencerMeterBadge(METERS['7/8'])).toBe('14-Step · 7/8');
  });
});
```

Update the import on line 2 to `import { sequencerMeterBadge, stepCells } from './sequencerGrid';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/sequencerGrid.test.ts`
Expected: FAIL — `sequencerMeterBadge is not a function`.

- [ ] **Step 3: Split the function**

In `src/components/sequencerGrid.ts`, replace `sequencerTitle`:

```ts
/**
 * The machine-computed half of the old header string. The name itself now
 * lives in VIEW_META, so this returns only what belongs in the badge.
 */
export function sequencerMeterBadge(meter: Meter): string {
  return `${meter.stepsPerBar}-Step · ${meter.label}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/sequencerGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Adopt `ViewHeader`**

In `SequencerView.tsx`, replace the header card (lines 124-231) with:

```tsx
      <ViewHeader
        view="sequencer"
        badge={sequencerMeterBadge(meter)}
        actions={
          <>
            {/* the existing volume slider, genre select, kit select and the
                shift / random / clear button group, unchanged */}
          </>
        }
      />
```

Move the contents of the old `{/* Preset & Action Buttons */}` div into that fragment verbatim — the wrapper `<div className="flex items-center flex-wrap gap-2">` is dropped because `ViewHeader` supplies it.

Update the import on line 17 to `sequencerMeterBadge`, and add `import { ViewHeader } from './ui/ViewHeader';` and `import { PowerToggle } from './ui/PowerToggle';`.

- [ ] **Step 6: Move the track mutes onto `PowerToggle`**

Replace each per-track mute button with:

```tsx
                <PowerToggle
                  id={`btn-mute-${track.id}`}
                  on={!track.muted}
                  onToggle={() => toggleMute(track.id)}
                  name={track.name}
                  tone="primary"
                  iconOnly
                  size="xs"
                />
```

`toggleMute` is defined at `SequencerView.tsx:75` and is the handler the current button already calls at `:355`. Drop `Volume2` / `VolumeX` from the `lucide-react` import **only if** the master-volume slider label no longer uses `Volume2` — it does, so keep `Volume2` and drop `VolumeX`.

- [ ] **Step 7: Verify visually**

Open `http://localhost:3000/?tab=sequencer`. Confirm the header reads "Drum Sequencer" with a `16-Step · 4/4` badge, the action cluster is unchanged, and muting a track dims its power button without turning it red. Change the meter in the transport bar and confirm the badge follows.

- [ ] **Step 8: Gate and commit**

```bash
bun run verify
git add src/components/sequencerGrid.ts src/components/sequencerGrid.test.ts src/components/SequencerView.tsx
git commit -m "refactor(sequencer): adopt ViewHeader and move the meter into a badge

sequencerTitle baked a machine-computed value into a heading; the name now
comes from VIEW_META and sequencerMeterBadge supplies only the badge text.
Track mutes move onto PowerToggle."
```

---

### Task 6: `ChordView` adopts the shared header

Fixes problems 1, 3 and 5 for this view, and removes the `module-chord` violation identified in design §3.1.

**Files:**
- Modify: `src/components/ChordView.tsx:553-638` (header), plus the `Bass Module` heading (~line 1045)

**Interfaces:**
- Consumes: `ViewHeader` (Task 4), `PowerToggle` (Task 2).

- [ ] **Step 1: Adopt `ViewHeader`**

Replace lines 555-638 with:

```tsx
      <ViewHeader
        view="chords"
        actions={
          <>
            <PowerToggle
              id="btn-mute-chord"
              on={!chordMuted}
              onToggle={toggleChordMuted}
              name="Chord"
              tone="module-chord"
            />
            <PowerToggle
              id="btn-mute-bass"
              on={!bassMuted}
              onToggle={toggleBassMuted}
              name="Bass"
              tone="module-bass"
            />
            <div className="divider divider-horizontal mx-0" />
            {/* the existing Save button and Library button, unchanged */}
          </>
        }
      >
        {saveToast && (
          <div className="alert alert-success absolute top-full right-4 mt-2 z-20 w-auto py-1.5 px-3 text-xs shadow-lg animate-fade-in">
            <Check className="w-3.5 h-3.5" />
            <span>{saveToast}</span>
          </div>
        )}
      </ViewHeader>
```

Add `import { ViewHeader } from './ui/ViewHeader';` and `import { PowerToggle } from './ui/PowerToggle';`. Drop `Volume2` / `VolumeX` and `Music` from the `lucide-react` import if nothing else in the file uses them — check first.

Note the polarity flip: the old buttons keyed off `chordMuted`; `PowerToggle` takes `on`, so pass `!chordMuted`.

- [ ] **Step 2: Fix the section heading casing**

Change the `Bass Module` heading to match `ACTIVE CHORD PROGRESSION LOOP`:

```tsx
        <h3 className="text-xs font-bold uppercase tracking-wider text-base-content">
          Bass Module
        </h3>
```

Keep the descriptive sentence under it as-is.

- [ ] **Step 3: Verify visually**

Open `http://localhost:3000/?tab=chords`. Confirm: the header icon chip is `primary`-tinted, not olive; "Chord On" / "Bass On" use the power icon and go ghost (not red) when off; the save toast still appears under the header's right edge; the Bass Module heading is uppercase.

- [ ] **Step 4: Gate and commit**

```bash
bun run verify
git add src/components/ChordView.tsx
git commit -m "refactor(chords): adopt ViewHeader and PowerToggle

Drops the module-chord tint from the view header, which design.md 6.5
reserves for the synth's signal stages, and stops painting the muted state
btn-error, which read as an error rather than a mute."
```

---

### Task 7: Plain-language transport copy

Fixes problem 7 / design §6.

**Files:**
- Modify: `src/components/ui/PlayerTransport.tsx:23-40` (`resolveTransportButtons`), `:105-115` (hard-stop button)
- Modify: `src/components/ui/PlayerTransport.test.tsx:16,23`

- [ ] **Step 1: Rewrite the failing assertions**

In `src/components/ui/PlayerTransport.test.tsx`, change line 16 to `expect(b.main.label).toBe('Stop');` and line 23 to `expect(b.main.label).toBe('Stopping…');`. Rename the two test descriptions to say "stop" rather than "soft stop".

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/PlayerTransport.test.tsx`
Expected: FAIL — received `'Soft Stop'`, expected `'Stop'`.

- [ ] **Step 3: Change the labels**

In `resolveTransportButtons`, `'Soft Stop'` → `'Stop'` and `'Stopping'` → `'Stopping…'`. Leave every class and `disabled` value untouched — only the user-facing strings change.

- [ ] **Step 4: Make the hard stop icon-only**

At line ~109-113, keep `title="Stop immediately"` and delete the text `<span>`:

```tsx
          title="Stop immediately"
        >
          <X className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        </button>
```

Use the icon sizing the surrounding code already uses; do not introduce a new size.

- [ ] **Step 5: Run tests**

Run: `bun test src/components/ui/PlayerTransport.test.tsx src/components/TransportBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gate and commit**

```bash
bun run verify
git add src/components/ui/PlayerTransport.tsx src/components/ui/PlayerTransport.test.tsx
git commit -m "fix(ui): replace soft/hard stop jargon with plain labels

Soft Stop and Hard Stop are internal vocabulary that does not tell a user
what differs. The main button now says Stop; the immediate variant is an X
with a tooltip."
```

---

### Task 8: Swap the visualizer and the playhead readout

Fixes problem 6 and completes §3.2 / §6. This is the task that introduces the hidden-tab rAF hazard, so read the note in Step 3 carefully.

**Files:**
- Modify: `src/components/AudioVisualizer.tsx` (add a `paused` prop)
- Modify: `src/components/TransportBar.tsx:4,29,145-168` (visualizer out, `PlayheadReadout` in)
- Modify: `src/components/EffectsRackView.tsx` (add the Monitor section)

**Interfaces:**
- Consumes: `PlayheadReadout` from `src/components/PlayheadReadout.tsx`.
- Produces: `AudioVisualizerProps.paused?: boolean`.

- [ ] **Step 1: Add `paused` to `AudioVisualizer`**

Add to its props interface:

```ts
  /**
   * Freeze the render loop. `App.tsx` keeps all four views mounted (toggling
   * `block`/`hidden`) so audio never stops on a tab switch, which means a
   * visualizer inside a view would otherwise keep an rAF loop alive on every
   * hidden tab. Callers inside a view MUST bind this to their tab's activity.
   */
  paused?: boolean;
```

In the effect that starts the loop (around line 466), return early and cancel when paused:

```ts
    if (paused) {
      return;
    }
    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
    };
```

Add `paused` to the effect's dependency array so unpausing restarts the loop.

- [ ] **Step 2: Put the visualizer in Master FX**

In `EffectsRackView.tsx`, read the active tab and append a Monitor section after the FX Chain section:

```tsx
  const activeTab = useAppStore((s) => s.activeTab);
  const [vizMode, setVizMode] = React.useState<VisualizerMode>('wave');
```

Add `import { AudioVisualizer, type VisualizerMode } from './AudioVisualizer';`
to `EffectsRackView.tsx`. `React` and `useAppStore` are already imported there.

```tsx
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-base-content px-1">
          Monitor
        </h3>
        <div className="card bg-panel border border-base-300 shadow-md">
          <div className="card-body p-3 sm:p-4 gap-3">
            <div className="join self-start">
              {(['wave', 'bars', 'oscilloscope'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVizMode(mode)}
                  className={`btn btn-xs join-item text-[11px] font-semibold ${
                    vizMode === mode ? 'btn-active btn-primary' : 'btn-ghost'
                  }`}
                >
                  {mode === 'wave' ? 'Spectrum' : mode === 'bars' ? 'Bars' : 'Waveform'}
                </button>
              ))}
            </div>
            <AudioVisualizer
              mode={vizMode}
              height={120}
              className="w-full rounded-box"
              colorTheme="primary"
              showControls={false}
              paused={activeTab !== 'effects'}
            />
          </div>
        </div>
      </section>
```

The mode switcher is now a visible control; it used to be a button revealed only on hover (`TransportBar.tsx:156-165`), which almost nobody found.

- [ ] **Step 3: Replace the transport-bar centre with the playhead**

In `TransportBar.tsx`, delete the visualizer block (lines ~145-168) along with the `vizMode` state (line 29) and the `AudioVisualizer` / `VisualizerMode` import (line 4). Render `<PlayheadReadout />` in that centre column instead, keeping the column's existing layout classes.

Add `import { PlayheadReadout } from './PlayheadReadout';`.

Leave the VU meter and the master fader untouched — master level must stay reachable from every tab.

- [ ] **Step 4: Verify the rAF gate actually works**

```bash
bun run dev
```
Open the Master FX tab, confirm the visualizer animates while playing. Switch to the Synth tab with audio still playing, open DevTools' Performance panel, record two seconds, and confirm there is no ongoing canvas work from the hidden view. Switch back and confirm it resumes.

- [ ] **Step 5: Confirm the playhead reads on all four tabs**

Press play, then visit each of the four tabs and confirm the transport bar shows the now/next chord and the beat dots advancing.

- [ ] **Step 6: Gate and commit**

```bash
bun run verify
git add src/components/AudioVisualizer.tsx src/components/TransportBar.tsx src/components/EffectsRackView.tsx
git commit -m "feat(ui): move the visualizer to Master FX, the playhead to the transport

The playhead readout rendered on the Synth tab only; the transport bar's
centre now carries it so every tab shows position. The visualizer becomes a
Monitor unit in Master FX with a visible mode switcher, gated on the active
tab because App keeps hidden views mounted."
```

---

### Task 9: `SynthView` gets a header

Fixes problem 1 for the last view and problem 4 (the preset noun), and reflows row 1 now that the playhead has moved.

**Files:**
- Modify: `src/components/SynthView.tsx:452-500` (row 1), the "Presets" button label, and the `PlayheadReadout` usage at `:43,483`

**Interfaces:**
- Consumes: `ViewHeader` (Task 4).

- [ ] **Step 1: Add the header and move the actions into it**

Insert `<ViewHeader view="synth" actions={…} />` as the first child of the view's root `<div>`, above the existing synth card. Move the Simple/Pro switcher, the Save button and the presets button out of the card's row 1 and into `actions`.

Add `import { ViewHeader } from './ui/ViewHeader';`.

- [ ] **Step 2: Remove the playhead readout**

Delete the `<PlayheadReadout … />` element at line ~483 and its import at line 43. It now lives in the transport bar (Task 8).

- [ ] **Step 3: Reflow row 1**

Row 1 now holds only the TARGET selector. Move that `join` element (`SynthView.tsx:459-477`) into the left of the row that already exists below it — the Simple-mode preset bar at `:673-730`, whose own `{/* Preset Title & Category Badge */}` block becomes its right-hand sibling. Delete the emptied row-1 wrapper.

Then remove the two positioning artefacts that only existed to anchor the absolutely-centred playhead: `relative` on the wrapper at `:457`, and `relative` on the header card at `:454` if nothing else in the card is absolutely positioned — the save toast still is, so check before removing that second one.

Pro mode (`:550-672`) renders its own preset bar and is unaffected; confirm it still lays out correctly in Step 5.

- [ ] **Step 4: Rename the preset noun**

Change the presets button's visible text from `Presets` to `Library` so it matches Chords. Leave every `id` attribute unchanged — ids are referenced elsewhere.

- [ ] **Step 5: Verify visually**

Open `http://localhost:3000/?tab=synth`. Confirm the view opens with a "Synth Lab" header carrying Simple/Pro, Save and Library; the TARGET selector sits with the preset stepper on one row; nothing overlaps at 1280px, 1024px and 768px; and Pro mode still renders its category bar correctly.

- [ ] **Step 6: Gate and commit**

```bash
bun run verify
git add src/components/SynthView.tsx
git commit -m "refactor(synth): add the view header and align the preset noun

Synth was the only view opening without a title. Its actions move into the
shared header, the playhead readout moves to the transport bar, and Presets
is renamed Library to match Chords."
```

---

### Task 10: `AmbientBackdrop`

Implements design §3.3. This is the only task that changes the layering rules, so it is deliberately last before docs.

**Files:**
- Create: `src/components/ui/AmbientBackdrop.tsx`
- Create: `src/components/ui/AmbientBackdrop.test.tsx`
- Modify: `src/App.tsx` (mount it)
- Modify: `eslint.config.js:59-66` (exemption list)

**Interfaces:**
- Produces: `shouldAnimateBackdrop(isPlaying: boolean, prefersReducedMotion: boolean): boolean`, and the `AmbientBackdrop` component.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/AmbientBackdrop.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { shouldAnimateBackdrop } from './AmbientBackdrop';

// The media query itself cannot be tested here (no DOM), so the decision is
// extracted into a pure helper — the same approach resolveInitialTheme in
// Header.tsx takes for the theme preference.
describe('shouldAnimateBackdrop', () => {
  test('animates only while playing', () => {
    expect(shouldAnimateBackdrop(true, false)).toBe(true);
    expect(shouldAnimateBackdrop(false, false)).toBe(false);
  });

  test('reduced motion wins over playback', () => {
    expect(shouldAnimateBackdrop(true, true)).toBe(false);
    expect(shouldAnimateBackdrop(false, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/AmbientBackdrop.test.tsx`
Expected: FAIL — `Cannot find module './AmbientBackdrop'`.

- [ ] **Step 3: Write the component**

Create `src/components/ui/AmbientBackdrop.tsx` around this skeleton:

```tsx
import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../../audio/engine';
import { useAppStore } from '../../store/store';
import { aggregatePlayerState } from '../../store/transportSlice';
import { resolveThemeColor } from '../../utils/themeColor';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Pure decision, exported so it is testable without a DOM — the same shape
 *  `resolveInitialTheme` in Header.tsx uses for the theme preference. */
export function shouldAnimateBackdrop(isPlaying: boolean, prefersReducedMotion: boolean): boolean {
  return isPlaying && !prefersReducedMotion;
}

export function AmbientBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const isPlaying = aggregatePlayerState(sequencerPlayer, chordsPlayer) !== 'stopped';

  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const animate = shouldAnimateBackdrop(isPlaying, reducedMotion);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (!animate) {
      // Clear rather than leaving a stale frame frozen on screen.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let animationId = 0;
    const render = () => {
      const analyser = audioEngine.getAnalyser();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (analyser) {
        // ... average the frequency data, then paint two or three large,
        // slow radial gradients whose radius and alpha follow that average.
        // Colours come from resolveThemeColor — canvas cannot take classes.
      }
      animationId = requestAnimationFrame(render);
    };
    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [animate]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 z-0 pointer-events-none opacity-30"
    />
  );
}
```

Check the exact export names of `themeColor.ts` and `transportSlice.ts` before
writing the imports; use whatever those modules actually export.

The remaining requirements are part of the design, and none is optional:

* Export the pure helper first:
  ```ts
  export function shouldAnimateBackdrop(isPlaying: boolean, prefersReducedMotion: boolean): boolean {
    return isPlaying && !prefersReducedMotion;
  }
  ```
* A full-bleed `<canvas>`: `absolute inset-0 z-0 pointer-events-none opacity-30`.
  **Not `fixed … -z-10`.** The App root carries an opaque `bg-canvas`, and
  `position: relative` with `z-index: auto` creates no stacking context, so a
  `-z-10` canvas would paint behind that background and never be seen. As the
  first child of the root `div`, at `z-0`, it paints above the root background
  and below every later sibling by DOM order — no existing `z-index` changes.
  `main` has no background of its own, and the cards are opaque `bg-panel`, so
  the field shows only in the gutters between panels.
* Read the analyser via `audioEngine.getAnalyser()` in the rAF loop — the same
  read `AudioVisualizer.tsx:89` performs. Bail out and render nothing when it
  returns null (before first gesture).
* Read `prefers-reduced-motion` through `window.matchMedia('(prefers-reduced-motion: reduce)')`,
  subscribing to changes, and feed it plus `aggregatePlayerState(sequencerPlayer, chordsPlayer) !== 'stopped'`
  into `shouldAnimateBackdrop`. When it returns false, `cancelAnimationFrame`
  and clear the canvas — do not leave a stale frame.
* Resolve every colour through `src/utils/themeColor.ts`. Canvas cannot take
  classes, which is exactly why that helper exists.
* Keep the render cheap: a few large, slow-moving radial gradients whose radius
  and alpha follow the analyser's average level. This is decoration, not a
  meter — do not draw per-bin detail.

- [ ] **Step 4: Add the eslint exemption**

In `eslint.config.js`, add `'src/components/ui/AmbientBackdrop.tsx'` to the `files` array at lines 60-65, and extend the comment above it:

```js
    // Exceptions: the three read-only analyser consumers (AudioVisualizer,
    // TransportBar's level meter, AmbientBackdrop) and test files. Routing
    // their per-frame reads through the store would mean a store write every
    // animation frame and a re-render of every subscriber.
```

- [ ] **Step 5: Mount it**

In `src/App.tsx`, render `<AmbientBackdrop />` as the **first child** of the root `<div>`, before `<Header />`. The root already carries `relative overflow-hidden`, which is what an `absolute inset-0` child needs. First-child position is load-bearing, not cosmetic — see Step 3.

- [ ] **Step 6: Run tests and both lint gates**

```bash
bun test src/components/ui/AmbientBackdrop.test.tsx
bun run verify
bun run eslint
```
Expected: all pass. `bun run eslint` is not part of `verify` and must be run here because this task changes imports.

- [ ] **Step 7: Verify in both themes and with reduced motion**

Play something and confirm the backdrop moves in the gutters between panels without making any text harder to read — check `solna-light` especially, where the alpha that suits the dark espresso base is likely too strong. Then enable "Reduce motion" in macOS System Settings → Accessibility → Display, reload, and confirm the backdrop is completely static.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/AmbientBackdrop.tsx src/components/ui/AmbientBackdrop.test.tsx src/App.tsx eslint.config.js
git commit -m "feat(ui): add an analyser-driven ambient backdrop

Gives every tab a moving surface while audio plays. Frozen under
prefers-reduced-motion and idle when stopped. Joins the analyser-consumer
eslint exemption deliberately: routing per-frame reads through the store
would re-render every subscriber sixty times a second."
```

---

### Task 11: Documentation

Implements design §8, including the factual error the audit found in the spec.

**Files:**
- Modify: `docs/design.md` §3, §4 (items 3, 7, 9 and the `ui/` primitive list), §6.5
- Modify: `CLAUDE.md` (layering paragraph)

- [ ] **Step 1: Record the casing rule in §3**

Under "Font Scaling", add:

```markdown
* **Casing by role.** A view's header title is Title Case (`Synth Lab`,
  `Drum Sequencer`). A section header inside a view is
  `text-xs font-bold uppercase tracking-wider` (`KEYBOARD`, `FX CHAIN`,
  `BASS MODULE`). A card title is Title Case (`Space Reverb`). Machine-computed
  context never sits inside a heading — it goes in a `tabular-nums` badge beside
  it, which is why `sequencerMeterBadge` exists.
```

- [ ] **Step 2: Correct §4 item 9**

Replace "four modes (`wave`, `bars`, `oscilloscope`, `ambient-bg`)" with "three modes (`wave`, `bars`, `oscilloscope`)" — `VisualizerMode` never had a fourth. Add that it lives in Master FX's Monitor section and takes a `paused` prop, and say why: `App.tsx` keeps every view mounted, so an in-view animation loop must be gated on the active tab.

- [ ] **Step 3: Document the new primitives in §4**

Add `AmbientBackdrop.tsx` as item 14, noting its eslint exemption and the reason. In "The `ui/` primitive layer", add entries for `ViewHeader.tsx` (owns the header card; icon and title come from `viewMeta`, chip is always `primary`), `PowerToggle.tsx` (the single on/off control; off is never `btn-error`; `Power` means on/off and `Volume*` means level), and note `Knob`'s new `descriptor` prop with the rule for when to use it. Add `viewMeta.ts` alongside them as the shared table.

- [ ] **Step 4: Update §4 items 3 and 7**

Item 3 (`TransportBar`): its centre now carries `PlayheadReadout`, not the visualizer. Item 7 (`EffectsRackView`): two sections, FX Chain (two columns, room for a compressor or graphic EQ) and Monitor.

- [ ] **Step 5: Confirm the §6.5 boundary**

Append to §6.5: view-header chrome is `primary` like every other non-signal-stage control; `ChordView` tinted its header chip `module-chord` until this work and was the sole violation. No `module-drum` or `module-fx` token exists, deliberately.

- [ ] **Step 6: Drop the stale `error` = mute usage from §2**

"mute-on" appears as an `error` usage in **two** places, and both are now wrong:

* `docs/design.md:32` — the §2 token description: "destructive actions, VU clip
  segments, mute-on".
* `docs/design.md:184` — the §6.1 legacy-colour map row: "`rose-*` / `red-*` —
  delete, mute-on, clip → `error`".

Nothing paints a mute red any more: `PowerToggle` is the single on/off control
and its off state is `btn-ghost text-base-content/40`. Drop "mute-on" from both,
leaving `error` meaning destructive actions and clip indication only. Line 184 is
a historical migration map, so keep its shape — just remove the one stale usage
rather than rewriting the row. Cross-reference §6.5, which already states the
rule these two lines contradict.

- [ ] **Step 7: Update `CLAUDE.md`**

In the layering paragraph, change the exemption sentence to name three files: `AudioVisualizer.tsx`, `TransportBar.tsx` and `ui/AmbientBackdrop.tsx`, with the per-frame-read reason.

- [ ] **Step 8: Gate and commit**

```bash
bun run verify
git add docs/design.md CLAUDE.md
git commit -m "docs(design): record the shared view chrome and fix the visualizer count

Adds the casing rule, documents ViewHeader / PowerToggle / viewMeta /
AmbientBackdrop, and corrects section 4 item 9, which claimed a fourth
ambient-bg visualizer mode that never existed."
```

---

## Verification

After Task 11, confirm the whole set:

```bash
bun run verify
bun run eslint
```

Then walk all four tabs at 1440px, 1024px and 768px in both `solna-dark` and `solna-light` and check:

1. Every tab opens with a header card carrying a distinct icon and a Title Case name.
2. Below 1280px the Synth and Master FX tab buttons are still distinguishable.
3. Every on/off control uses the power icon, and none is red when off.
4. Both preset entry points say "Library".
5. The transport bar shows the playhead on all four tabs.
6. The backdrop moves only while playing, and freezes under reduced motion.
