# Sound Header and Beat Voice Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Sound tab's header back to `SoundView`, make the depth switch one stored value with two vocabularies, and turn the eleven Beat voice accordion rows into cards in a responsive grid.

**Architecture:** `SoundView` becomes the tab's shell — it renders `ViewHeader view="sound"`, owns the depth hook, carries the focus chips and the focus-following solo button in `viewControls`, and gates the two mutually exclusive editors below it (`SoundSynthSection` on a melodic focus, `BeatSoundSection` on a drum focus). The depth value stays `'simple' | 'pro'` and is labelled `Simple`/`Pro` on a melodic focus and `Essential`/`All` on a drum focus, from one table keyed by focus. The Beat editor drops its accordion entirely: each voice becomes a `PanelCard inset` + `ModuleHeader` card in a 1/2/3-column grid, whose knob lane shows `primary` at `simple` and `primary` then `more` in the same lane at `pro`.

**Tech Stack:** React 19 + TypeScript, Zustand (store untouched by this work), Tailwind v4 + daisyUI (CSS-first themes, no config file), Bun test runner with `renderToString` from `react-dom/server` (no DOM, no testing-library), Vite.

**Spec:** docs/superpowers/specs/2026-09-15-sound-header-and-beat-voice-cards-design.md

## Global Constraints

- **Four-layer import rule:** `src/data/` imports nothing at runtime; `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` is dumb views. ESLint's `no-restricted-imports` enforces it — all work here is inside `src/components/`, which may import `store/` and `utils/` but nothing from `audio/engine`.
- **`src/components/` may not import `audio/engine`.** Nothing in this plan adds an engine call: the Beat preview already goes through `audio/playback/drumPlayback` and stays exactly as it is.
- **No version numbers, no file counts and no line numbers in documentation prose** — state the rule, not the number. That applies to the docblocks this plan asks you to write as much as to the plan itself.
- **`bun run verify` is the completion gate.** Do not claim work is done before it passes.
- **ESLint reports nothing at all** — no errors and no warnings — and both Knip scans have a zero-finding baseline. A new module referenced by nothing, or an export nobody imports, fails the gate.
- **Tests use `renderToString` and `useLiveStore`.** zustand serves `getServerSnapshot` the store's *creation-time* state, so a component that must reflect a value a test sets with `useAppStore.setState` has to read it through `useLiveStore` (`src/components/ui/useLiveStore.ts`). Getting this wrong makes a test silently assert nothing. Read `.claude/rules/testing.md` before writing a test.
- **No meter value and no high-frequency value may enter a zustand slice.** Every tab view and every Pattern segment stays mounted at once, so a slice write re-renders all of them — which is why the depth value and every disclosure flag in this plan are local React state.
- **Storage access is always guarded.** `localStorage` can *throw* (Safari private mode, blocked cookies, embedded webviews), not merely return null, so every read and write is inside a `try` and the storage object is resolved *inside* it, never in a default-parameter expression.
- **Theming:** components name roles, never colours. `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes, `dark:`, and silently-dead utilities, and its allowlist is empty. Every class string is a literal — Tailwind v4 scans source statically, so a class assembled at runtime is never emitted. Read `.claude/rules/theming.md` before touching a class.

---

## File Structure

| Path | Change | Its one responsibility |
| --- | --- | --- |
| `src/components/loop/useSoundDepth.ts` | **Create** | The Sound tab's depth value: the guarded/injectable storage read and write, the focus→vocabulary table, and the hook `SoundView` owns. |
| `src/components/loop/useSoundDepth.test.ts` | **Create** | Pure tests for the storage read (including a throwing storage and the two legacy keys), the write, and the vocabulary table. |
| `src/components/loop/synth/synthPresetBrowser.ts` | **Modify** | Loses `useSynthViewMode` — the browser answers "which preset is this patch on" and never owned a UI depth flag. |
| `src/components/loop/SoundView.tsx` | **Modify** | The tab's shell: renders `ViewHeader view="sound"`, owns `useSoundDepth`, renders the focus chips and the focus-following solo button, gates the two editors, renders the mixer. |
| `src/components/loop/SoundSynthSection.tsx` | **Modify** | Only the synth half: takes a non-null `synthTarget` and a `depth`, renders the Synth `SectionCard` (now including the per-target oscilloscope) and the two overlays. Loses its `ViewHeader` and `SoundFocusRow`. |
| `src/components/ui/ViewHeader.tsx` | **Modify** | Docblocks only: `viewControls` holds what selects WHAT the view shows; `actions` holds the rest of the right cluster, including HOW DEEP. |
| `src/components/loop/beat/BeatSoundSection.tsx` | **Modify** | The Beat instrument's sound editor: takes `depth`, renders the preset toolbar, the bus filter and the voice grid. |
| `src/components/loop/beat/BeatVoiceCard.tsx` | **Create** (from `BeatVoiceRow.tsx`) | One voice as a card: bespoke header cell (Preview, colour chip, name), `+N` chip and Reset on the right, one depth-driven wrapping knob lane. |
| `src/components/loop/beat/BeatVoiceRow.tsx` | **Delete** | Replaced by `BeatVoiceCard.tsx`. |
| `src/components/loop/beat/BeatVoiceGrid.tsx` | **Create** (from `BeatVoiceList.tsx`) | The eleven cards in canonical order, in a responsive grid with no disclosure state of its own. |
| `src/components/loop/beat/BeatVoiceList.tsx` | **Delete** | Replaced by `BeatVoiceGrid.tsx`. |
| `src/components/loop/beat/BeatSoundSection.test.tsx` | **Modify** | Substantial rewrite: the accordion, the per-row More disclosure and the row summary assertions go; a card per voice, the depth-driven lane and the `+N` chip arrive. |
| `src/components/loop/SoundView.test.tsx` | **Modify** | Header assertions follow the controls that moved; new assertions for the synth section unmounting and for the depth vocabulary on a drum focus. |

Unchanged on purpose: `beatControlSchema.ts` and its test, `beatVoices.ts`, `useBeatParamDraft`, `BeatFilterPanel`, `BeatPresetToolbar`, `ui/PanelCard`, `ui/ModuleHeader`, `loop/synth/proControls.tsx`, and everything under `src/audio/` and `src/store/`.

**Starting point.** The working tree already contains committed-by-assumption work you must build on, not redo: `ui/Knob.tsx` carries the eleven `text-drum-*` entries in `KNOB_COLORS` and `BADGE_COLOR`, and `beat/beatVoices.ts` carries a `knobColor: KnobColor` field on `BeatVoiceMeta`. `BeatVoiceRow.tsx` already lays its knobs out with the wrapping `KNOB_LANE` constant. Read those three files before Task 5.

---

### Task 1: The depth hook, with its own module and its own vocabulary table

`useSynthViewMode` is renamed `useSoundDepth` and moves out of the preset browser into its own module beside `SoundView.tsx`. This task moves it *in place* — `SoundSynthSection` keeps calling it — so nothing else has to change yet and the tree stays green. The storage read gains the guard it is missing today and an injectable storage so a test can drive one that throws.

**Files:**
- Create: `src/components/loop/useSoundDepth.ts`
- Test: `src/components/loop/useSoundDepth.test.ts`
- Modify: `src/components/loop/synth/synthPresetBrowser.ts` (delete `useSynthViewMode`)
- Modify: `src/components/loop/SoundSynthSection.tsx` (call the new hook; delete the local `SYNTH_VIEW_MODES` table; rename the `synthViewMode` prop threaded through `SynthCard`, `SynthPresetBar` and `SynthPanels` to `depth`)

**Interfaces:**
- Consumes: nothing from an earlier task.
- Produces:
  - `type SoundDepth = 'simple' | 'pro'`
  - `const SOUND_DEPTHS: readonly ['simple', 'pro']`
  - `const SOUND_DEPTH_KEY = 'musibox_sound_depth'`
  - `const LEGACY_SOUND_DEPTH_KEYS: readonly string[]`
  - `interface DepthStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `interface SoundDepthOption { depth: SoundDepth; label: string; icon: LucideIcon; title: string }`
  - `function soundDepthOptions(focus: MixLayerId): readonly SoundDepthOption[]`
  - `function readSoundDepth(storage?: DepthStorage | null): SoundDepth`
  - `function writeSoundDepth(depth: SoundDepth, storage?: DepthStorage | null): void`
  - `function useSoundDepth(storage?: DepthStorage | null): { depth: SoundDepth; setDepth: (next: SoundDepth) => void }`

- [ ] **Step 1: Write the failing test**

Create `src/components/loop/useSoundDepth.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Sliders, Zap } from 'lucide-react';
import {
  LEGACY_SOUND_DEPTH_KEYS,
  readSoundDepth,
  soundDepthOptions,
  SOUND_DEPTH_KEY,
  writeSoundDepth,
  type DepthStorage,
} from './useSoundDepth';

/** A storage a test drives: every read and write is recorded, none is global. */
function fakeStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  const writes: [string, string][] = [];
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
      writes.push([key, value]);
    },
    writes,
  };
}

/** The case the `typeof window` test never caught: storage that THROWS. */
const throwingStorage: DepthStorage = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

describe('the stored Sound depth', () => {
  test('reads the current key', () => {
    expect(readSoundDepth(fakeStorage({ [SOUND_DEPTH_KEY]: 'pro' }))).toBe('pro');
    expect(readSoundDepth(fakeStorage({ [SOUND_DEPTH_KEY]: 'simple' }))).toBe('simple');
  });

  test('falls back to each legacy key, newest first', () => {
    for (const key of LEGACY_SOUND_DEPTH_KEYS) {
      expect(readSoundDepth(fakeStorage({ [key]: 'pro' }))).toBe('pro');
    }
    // The current key wins over every legacy one, whatever they hold.
    const both = fakeStorage(
      Object.fromEntries([
        [SOUND_DEPTH_KEY, 'simple'],
        ...LEGACY_SOUND_DEPTH_KEYS.map((key) => [key, 'pro'] as const),
      ]),
    );
    expect(readSoundDepth(both)).toBe('simple');
  });

  test('a missing, unreadable or nonsense value reads as simple', () => {
    expect(readSoundDepth(fakeStorage())).toBe('simple');
    expect(readSoundDepth(fakeStorage({ [SOUND_DEPTH_KEY]: 'expert' }))).toBe('simple');
    expect(readSoundDepth(null)).toBe('simple');
    // The whole reason the read is inside the try: this must not propagate.
    expect(() => readSoundDepth(throwingStorage)).not.toThrow();
    expect(readSoundDepth(throwingStorage)).toBe('simple');
  });

  test('writes only the current key, and survives a storage that throws', () => {
    const storage = fakeStorage({ [LEGACY_SOUND_DEPTH_KEYS[0]]: 'simple' });
    writeSoundDepth('pro', storage);
    expect(storage.writes).toEqual([[SOUND_DEPTH_KEY, 'pro']]);
    expect(() => writeSoundDepth('simple', throwingStorage)).not.toThrow();
  });
});

/**
 * One value, two vocabularies. The synth's Simple/Pro is a real depth split —
 * two panel trees — while Beat's is disclosure over one parameter model, so
 * calling Beat's deep state "Pro" would make one word mean two things.
 */
describe('the depth vocabulary', () => {
  test('a melodic focus reads Simple and Pro', () => {
    for (const focus of ['synth', 'fx', 'chord', 'bass', 'pad'] as const) {
      expect(soundDepthOptions(focus).map((o) => o.label)).toEqual(['Simple', 'Pro']);
    }
  });

  test('a drum focus reads Essential and All', () => {
    expect(soundDepthOptions('drum').map((o) => o.label)).toEqual(['Essential', 'All']);
  });

  // The same stored value and the same switch, so the same icons: a second
  // icon pair across a focus change would say a different control had appeared.
  test('the icons never change with the vocabulary', () => {
    for (const focus of ['synth', 'drum'] as const) {
      expect(soundDepthOptions(focus).map((o) => o.icon)).toEqual([Sliders, Zap]);
      expect(soundDepthOptions(focus).map((o) => o.depth)).toEqual(['simple', 'pro']);
      expect(soundDepthOptions(focus).every((o) => o.title.length > 0)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/useSoundDepth.test.ts`
Expected: FAIL — `Cannot find module './useSoundDepth' from '.../src/components/loop/useSoundDepth.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/components/loop/useSoundDepth.ts`:

```ts
import { useState } from 'react';
import { Sliders, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isMelodicFocus, type MixLayerId } from '@/store/focusTrack';

/** How deep the Sound tab shows whatever is focused. ONE value for the tab. */
export type SoundDepth = 'simple' | 'pro';

/** The two depths in toggle order. The switch renders this, never a pair of
 *  hand-written buttons: the two must stay identical in all but label and icon. */
export const SOUND_DEPTHS: readonly SoundDepth[] = ['simple', 'pro'];

/** The key every write goes to. */
export const SOUND_DEPTH_KEY = 'musibox_sound_depth';

/**
 * Keys an older build wrote, newest first, read-only.
 *
 * This is NOT a migration chain in the sense CLAUDE.md forbids: there is no
 * version gate and no read-time transform, only one more rung on the
 * legacy-key adoption ladder this read already climbed. It exists because the
 * value's MEANING widened — it is no longer the synth's view mode, it is the
 * Sound tab's depth — so keeping the old name would make the key a lie about
 * what it stores.
 */
export const LEGACY_SOUND_DEPTH_KEYS: readonly string[] = [
  'musibox_synth_view_mode',
  'murva_synth_view_mode',
];

/** The slice of `Storage` this module uses, so a test can pass its own. */
export interface DepthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The ambient storage, resolved INSIDE a caller's `try`.
 *
 * Reaching `window.localStorage` can itself throw (Safari private mode,
 * blocked cookies, embedded webviews), which is why this is never a
 * default-parameter expression — a default argument is evaluated before the
 * guard can catch it, the same rule `Header.tsx`'s theme helpers follow.
 */
function ambientStorage(): DepthStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function readSoundDepth(storage?: DepthStorage | null): SoundDepth {
  try {
    const store = storage ?? ambientStorage();
    if (store) {
      for (const key of [SOUND_DEPTH_KEY, ...LEGACY_SOUND_DEPTH_KEYS]) {
        const stored = store.getItem(key);
        if (stored === 'simple' || stored === 'pro') return stored;
      }
    }
  } catch {
    // A storage that throws is a storage holding no preference.
  }
  return 'simple';
}

export function writeSoundDepth(depth: SoundDepth, storage?: DepthStorage | null): void {
  try {
    const store = storage ?? ambientStorage();
    store?.setItem(SOUND_DEPTH_KEY, depth);
  } catch {
    // Best-effort: a depth we cannot remember is still a depth we can show.
  }
}

/** One rendered depth button: the value it selects and the words for it. */
export interface SoundDepthOption {
  depth: SoundDepth;
  label: string;
  icon: LucideIcon;
  title: string;
}

/**
 * The vocabulary, keyed by what is focused — a table, never an `if` at the
 * render site.
 *
 * The synth's Simple/Pro is a real depth split: two panel trees, a macro deck
 * against raw per-stage parameters. Beat's is pure disclosure over ONE
 * parameter model, where every knob writes one stored field at either depth
 * and the deep state shows strictly more of the same knobs. Calling that "Pro"
 * would make one word mean two things in one app. Reusing the VALUE carries
 * none of that risk: a user who chose depth on the synth has expressed a
 * preference about detail, and honouring it on Beat is the point.
 */
const DEPTH_WORDS: Record<'melodic' | 'drum', Record<SoundDepth, { label: string; title: string }>> = {
  melodic: {
    simple: { label: 'Simple', title: 'Simple Mode' },
    pro: { label: 'Pro', title: 'Pro Mode' },
  },
  drum: {
    simple: { label: 'Essential', title: 'Essential controls' },
    pro: { label: 'All', title: 'All controls' },
  },
};

/**
 * The icons do NOT change with the vocabulary, deliberately: it is the same
 * stored value and the same switch, so the same icons say "same control,
 * different context" across a focus change, where a second icon pair would say
 * a different control had appeared.
 */
const DEPTH_ICONS: Record<SoundDepth, LucideIcon> = { simple: Sliders, pro: Zap };

export function soundDepthOptions(focus: MixLayerId): readonly SoundDepthOption[] {
  const words = DEPTH_WORDS[isMelodicFocus(focus) ? 'melodic' : 'drum'];
  return SOUND_DEPTHS.map((depth) => ({
    depth,
    icon: DEPTH_ICONS[depth],
    ...words[depth],
  }));
}

/**
 * The depth, as LOCAL state of whichever component owns the Sound tab.
 *
 * Not a slice: every tab view and every Pattern segment stays mounted at once,
 * so a slice write re-renders all of them. Nothing persists it into the
 * project either — its only durability is the storage key above.
 */
export function useSoundDepth(storage?: DepthStorage | null) {
  const [depth, setStateDepth] = useState<SoundDepth>(() => readSoundDepth(storage));

  const setDepth = (next: SoundDepth) => {
    setStateDepth(next);
    writeSoundDepth(next, storage);
  };

  return { depth, setDepth };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/loop/useSoundDepth.test.ts`
Expected: PASS

- [ ] **Step 5: Retire `useSynthViewMode` and call the new hook**

Delete `useSynthViewMode` from `src/components/loop/synth/synthPresetBrowser.ts` outright (the function and, if they become unused, its `useState` import). It was never the preset browser's: the browser answers "which preset is this patch on", and a UI depth flag shares nothing with that question but a file.

In `src/components/loop/SoundSynthSection.tsx`:

1. Delete the local `SYNTH_VIEW_MODES` table and the now-unused `Sliders` / `Zap` imports.
2. Drop `useSynthViewMode` from the `./synth/synthPresetBrowser` import list and add `import { soundDepthOptions, useSoundDepth, type SoundDepth } from './useSoundDepth';`
3. In the exported `SoundSynthSection`, replace the hook call and the switch:

```tsx
  const { depth, setDepth } = useSoundDepth();
```

```tsx
        viewControls={
          /* Mode Switcher. Its words come from `soundDepthOptions(focusTrack)`,
             not from a literal pair: the same stored value is Simple/Pro on a
             melodic focus and Essential/All on a drum focus. */
          <SegmentedGroup>
            {soundDepthOptions(focusTrack).map(({ depth: option, label, icon, title }) => (
              <SegmentedButton
                key={option}
                id={`btn-mode-${option}`}
                icon={icon}
                label={label}
                active={depth === option}
                onSelect={() => setDepth(option)}
                title={title}
              />
            ))}
          </SegmentedGroup>
        }
```

4. Rename the prop threaded downward from `synthViewMode` to `depth`, typed `SoundDepth`, at every declaration and call site inside this file — `SynthCard`, `SynthPresetBar`, `SynthPanels`, `ProPresetBar`, and the `showSoundBadges={depth === 'pro'}` on `SynthPresetDrawer`. One name for one value: a `depth` in one component and a `synthViewMode` in the next is the drift this rename exists to stop.
5. `onSwitchToPro={() => setDepth('pro')}`.

- [ ] **Step 6: Run the affected suites**

Run: `bun test src/components/loop/useSoundDepth.test.ts src/components/loop/SoundView.test.tsx && bun run lint`
Expected: PASS. The button ids are unchanged (`btn-mode-simple`, `btn-mode-pro`), so `SoundView.test.tsx` still passes untouched.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/useSoundDepth.ts src/components/loop/useSoundDepth.test.ts src/components/loop/synth/synthPresetBrowser.ts src/components/loop/SoundSynthSection.tsx
git commit -m "refactor(sound): give the depth switch its own module and two vocabularies"
```

---

### Task 2: `SoundView` owns the Sound header, and the depth switch moves to `actions`

The tab's identity — its icon, its title, the `SoloChip` every `HeaderCard` carries — stops being drawn by a component whose name claims only the synth. The depth switch moves with it, into the right-hand cluster beside the `SoloChip`, and `ViewHeader`'s docblocks are rewritten to say why.

**Files:**
- Modify: `src/components/loop/SoundView.tsx`
- Modify: `src/components/loop/SoundSynthSection.tsx`
- Modify: `src/components/ui/ViewHeader.tsx`
- Test: `src/components/loop/SoundView.test.tsx`

**Interfaces:**
- Consumes: `useSoundDepth()` → `{ depth: SoundDepth; setDepth: (next: SoundDepth) => void }`, `soundDepthOptions(focus: MixLayerId)`, `type SoundDepth` — all from `./useSoundDepth` (Task 1).
- Produces: `SoundSynthSection` props become `{ focusTrack: MixLayerId; activeTab: string; onFocus: (focus: MixLayerId) => void; soundGroups: Record<SynthControlTarget, LoopCopyGroupId>; depth: SoundDepth; onDepth: (next: SoundDepth) => void }`. `onDepth` is what the Simple deck's "switch to Pro" footer invitation calls.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/SoundView.test.tsx`, replace the whole `describe('SoundView mode switch', …)` block with this one, and add `ACTION_CLUSTER` to the existing `../ui/fieldClasses` import (leave `HEADER_GROUP` in place — the new test still uses it):

```tsx
describe('SoundView mode switch', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  /**
   * `viewControls` holds the control that selects WHAT this view shows;
   * `actions` holds everything else in the right-hand cluster, including HOW
   * DEEP the selected thing is shown. Focus and depth are different axes —
   * which track, versus how much of it — so they sit on opposite sides rather
   * than reading as one compound switcher.
   */
  test('rides the right-hand action cluster, after the solo chip', () => {
    const html = renderToString(<SoundView />);
    const title = html.indexOf('>Sound</h2>');
    const cluster = html.indexOf(ACTION_CLUSTER);
    const simple = html.indexOf('id="btn-mode-simple"');
    const synthBand = html.indexOf('>Synth<');
    expect(title).toBeGreaterThan(-1);
    expect(cluster).toBeGreaterThan(title);
    expect(simple).toBeGreaterThan(cluster);
    expect(simple).toBeLessThan(synthBand);
    // Still the shared segmented shell, so it is one height with the tab bar.
    expect(html.slice(cluster, simple)).toContain(HEADER_GROUP);
  });

  /**
   * Which depth is showing must reach a screen reader, not only a colour.
   * `btn-active` is the whole visual cue for the selected segment.
   */
  test('the selected depth is announced, not just coloured', () => {
    const html = renderToString(<SoundView />);
    expect(openTagContaining(html, 'id="btn-mode-simple"')).toContain('aria-pressed="true"');
    expect(openTagContaining(html, 'id="btn-mode-pro"')).toContain('aria-pressed="false"');
  });

  /** One header for the tab, drawn by the tab — not one per section. */
  test('the Sound header is rendered exactly once', () => {
    const html = renderToString(<SoundView />);
    expect(html.split('>Sound</h2>').length - 1).toBe(1);
  });

  /** The same stored value, in the vocabulary of whatever is focused. */
  test('a drum focus relabels the same switch Essential and All', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-mode-simple"');
    expect(html).toContain('>Essential<');
    expect(html).toContain('>All<');
    expect(html).not.toContain('>Pro<');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/SoundView.test.tsx -t "rides the right-hand action cluster"`
Expected: FAIL — the switch is still in `viewControls`, so `simple` comes *before* the `ACTION_CLUSTER` index and the `toBeGreaterThan(cluster)` assertion reports a received value lower than expected. (`a drum focus relabels the same switch` fails too: today the Beat focus renders no depth switch at all, so `id="btn-mode-simple"` is absent.)

- [ ] **Step 3: Write minimal implementation**

In `src/components/loop/SoundView.tsx`, add the imports and render the header:

```tsx
import { ViewHeader } from "../ui/ViewHeader";
import { SegmentedButton, SegmentedGroup } from "../ui/SegmentedControl";
import { soundDepthOptions, useSoundDepth } from "./useSoundDepth";
```

```tsx
  const { depth, setDepth } = useSoundDepth();

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* The tab's own header, drawn by the tab. It used to be rendered by the
          Synth section, which made the tab's identity — its icon, its title,
          the SoloChip every HeaderCard carries — the property of a component
          that is unmounted on a drum focus. */}
      <ViewHeader
        view="sound"
        actions={
          /* Depth: HOW DEEP the focused thing is shown, in the right-hand
             cluster beside the SoloChip. `viewControls` is for what selects
             WHAT the view shows, which on this tab is the focus. */
          <SegmentedGroup>
            {soundDepthOptions(focusTrack as MixLayerId).map(({ depth: option, label, icon, title }) => (
              <SegmentedButton
                key={option}
                id={`btn-mode-${option}`}
                icon={icon}
                label={label}
                active={depth === option}
                onSelect={() => setDepth(option)}
                title={title}
              />
            ))}
          </SegmentedGroup>
        }
      />

      <SoundSynthSection
        focusTrack={focusTrack as MixLayerId}
        activeTab={activeTab}
        onFocus={setFocusTrack}
        soundGroups={SYNTH_SOUND_GROUP}
        depth={depth}
        onDepth={setDepth}
      />
```

In `src/components/loop/SoundSynthSection.tsx`:

1. Delete the `<ViewHeader … />` element and its `viewControls` switch, the `ViewHeader` import, the `SegmentedButton`/`SegmentedGroup` imports, and the `useSoundDepth` / `soundDepthOptions` imports (the hook is `SoundView`'s now). Keep `import type { SoundDepth } from './useSoundDepth';`.
2. Take `depth` and `onDepth` as props instead of calling the hook:

```tsx
export function SoundSynthSection({
  focusTrack,
  activeTab,
  onFocus,
  soundGroups,
  depth,
  onDepth,
}: {
  focusTrack: MixLayerId;
  activeTab: string;
  onFocus: (focus: MixLayerId) => void;
  /** SYNTH_SOUND_GROUP, owned by SoundView — see its docblock for why the
   *  paste button follows the FOCUS rather than the tab. */
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
  /** The Sound tab's ONE depth value, owned by SoundView. */
  depth: SoundDepth;
  /** Raised by the Simple deck's own "switch to Pro" footer invitation. */
  onDepth: (next: SoundDepth) => void;
}) {
```

3. Return a fragment that opens with `<SoundFocusRow … />` (still here; it moves in Task 3) and pass `onSwitchToPro={() => onDepth("pro")}`.
4. Rewrite the docblock on the exported component so it no longer claims to render the header:

```tsx
/**
 * The Synth half of the Sound tab: the focus row, the Synth card and the two
 * overlays it raises. It reads the five synth channels from the store itself
 * rather than taking them as props.
 *
 * It does NOT render the tab's header. The header is SoundView's, because the
 * tab's identity must not belong to a section that is unmounted on a drum
 * focus.
 */
```

In `src/components/ui/ViewHeader.tsx`, replace the `viewControls` docblock on `HeaderCardProps` — leaving the old prose in place is how a later reader "restores" the depth switch to `viewControls` and undoes the distinction:

```tsx
  /**
   * The control that selects WHAT this view shows — Pattern's segment row
   * (which content) and the Sound tab's focus chips (which track).
   *
   * `actions` holds everything else in the header's right cluster, INCLUDING
   * how deep the selected thing is shown. Focus and depth are different axes —
   * which track, versus how much of it — and putting both on the same side
   * would read as one compound switcher rather than two controls.
   *
   * This slot used to hold the Sound tab's depth switch, on the argument that
   * `actions` is for things you DO to what is on screen and a control that
   * changes the screen itself is not one of them. That argument was made when
   * the slot had exactly one candidate to sort, which made it untestable;
   * opposite sides is more honest than that placement was, not a relaxation
   * of it.
   *
   * Callers wear `HEADER_GROUP`, so every occupant is one height and reads as
   * one kind of control.
   */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/loop/SoundView.test.tsx && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/SoundView.tsx src/components/loop/SoundSynthSection.tsx src/components/ui/ViewHeader.tsx src/components/loop/SoundView.test.tsx
git commit -m "refactor(sound): give the tab's header back to SoundView"
```

---

### Task 3: The focus chips and the solo button move into the header; `SoundFocusRow` is deleted

`SoundFocusRow` is deleted as a *component*, not as a set of controls: the chips and `SoloButton` move into `viewControls`, and the per-target oscilloscope moves DOWN into the Synth card, where the tap it reads actually belongs.

**Files:**
- Modify: `src/components/loop/SoundView.tsx` (gains `SoundFocusChips`)
- Modify: `src/components/loop/SoundSynthSection.tsx` (deletes `SoundFocusRow`, gains `SynthScope` inside `SynthCard`)
- Test: `src/components/loop/SoundView.test.tsx`

**Interfaces:**
- Consumes: `SoundSynthSection`'s props from Task 2; this task drops `onFocus` from them, leaving `{ focusTrack; activeTab; soundGroups; depth; onDepth }`.
- Produces: `function SoundFocusChips({ focusTrack, synthTarget, onFocus }: { focusTrack: MixLayerId; synthTarget: SynthControlTarget | null; onFocus: (focus: MixLayerId) => void })` — module-local to `SoundView.tsx`, not exported. Button ids are unchanged: `btn-focus-${focus}` per chip and `btn-solo-target` for the solo toggle.

- [ ] **Step 1: Write the failing test**

Add to `src/components/loop/SoundView.test.tsx`, inside the existing `describe('the Sound focus row', …)` block:

```tsx
  /**
   * The chips select WHAT this view shows, so they are the header's
   * `viewControls` occupant — beside the title, opposite the depth switch.
   * `SoloButton id="btn-solo-target"` moves with them: "it follows the focus"
   * is only legible beside the focus.
   */
  test('the chips and the focus solo ride the header, before the depth switch', () => {
    const html = renderToString(<SoundView />);
    const title = html.indexOf('>Sound</h2>');
    const chips = html.indexOf('id="btn-focus-synth"');
    const solo = html.indexOf('id="btn-solo-target"');
    const depth = html.indexOf('id="btn-mode-simple"');
    const synthBand = html.indexOf('>Synth<');
    expect(chips).toBeGreaterThan(title);
    expect(solo).toBeGreaterThan(chips);
    expect(depth).toBeGreaterThan(solo);
    expect(chips).toBeLessThan(synthBand);
  });

  /**
   * `SoloChip` and `SoloButton` look adjacent now and must never be deduped.
   * One says "something is silenced, stop it"; the other says "silence
   * everything but this".
   */
  test('the loop-wide solo chip and the per-track solo toggle both exist', () => {
    useAppStore.setState({ soloTracks: ['lead'] });
    try {
      const html = renderToString(<SoundView />);
      expect(html).toContain('id="btn-solo-target"');
      // The chip carries `data-solo-chip`, never an id: every view header
      // stays mounted, so an id would be several copies of one id in the live
      // page — the same trap `btn-solo-target` exists to avoid.
      expect(html).toContain('data-solo-chip');
    } finally {
      useAppStore.setState({ soloTracks: [] });
    }
  });

  /**
   * The oscilloscope taps the TARGET layer's own pre-fader tap, so it belongs
   * to the synth channel and not to the tab — which also means a drum focus
   * shows none, because the component that draws it is not mounted.
   */
  test('the oscilloscope sits inside the Synth card, below the header', () => {
    const html = renderToString(<SoundView />);
    const synthBand = html.indexOf('>Synth<');
    const scope = html.indexOf('Oscilloscope —');
    expect(scope).toBeGreaterThan(synthBand);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/SoundView.test.tsx -t "the chips and the focus solo ride the header"`
Expected: FAIL — the chips still render in `SoundFocusRow` below the header, so `chips` is greater than `depth` and the `expect(depth).toBeGreaterThan(solo)` assertion reports a received value lower than expected.

- [ ] **Step 3: Write minimal implementation**

Move the chip markup into `src/components/loop/SoundView.tsx`, together with the three module-scope tables it reads. Add to the imports there:

```tsx
import { soloTrackForFocus } from "@/store/trackAudibility";
import { SoloButton } from "../ui/SoloButton";
import { GroupFrame } from "../ui/GroupFrame";
import {
  MIX_LAYER_IDS,
  controlTargetForFocus,
  isMelodicFocus,
  melodyTrackForFocus,
} from "@/store/focusTrack";
import { MIX_LAYER_LABELS } from "../mixLayers";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
```

```tsx
// The two MELODY focuses render as bare chips, the three accompaniment ones go
// in the framed group, and Beat sits last on its own — the same pitched-first,
// rhythm-after order MIX_LAYERS uses. Derived from the roster rather than
// hand-listed so a seventh layer renders somewhere instead of silently
// nowhere, and the melody split asks the store which focuses ARE melody tracks
// rather than testing `!== 'synth'`: FX is a melody track beside Lead, and
// putting it under a frame labelled "Accompaniment" would make the frame say
// something untrue. Module scope, so the tables are not rebuilt per render.
const MELODY_FOCUSES: readonly MixLayerId[] = MIX_LAYER_IDS.filter(
  (id) => melodyTrackForFocus(id) !== null,
);
const BEAT_FOCUS: MixLayerId = 'drum';
const ACCOMPANIMENT_FOCUSES = MIX_LAYER_IDS.filter(
  (id) => !MELODY_FOCUSES.includes(id) && id !== BEAT_FOCUS,
);

// The Beat chip's label comes from MIX_LAYERS' drum row; its styling is
// literal rather than from SYNTH_TARGET_STYLES, which has five entries and no
// sixth to add: a drum focus has no synth channel, so a row in that table
// would be a claim that it does. Both class strings are literals — Tailwind v4
// scans source statically, so a class assembled at runtime is never emitted.
const BEAT_CHIP = {
  label: MIX_LAYER_LABELS[BEAT_FOCUS],
  activeBtn: 'btn-accent',
  softBtn: 'btn-soft btn-accent',
};

/**
 * The one "what am I working on" control, and the only place on this tab that
 * can change it — the header's `viewControls` occupant.
 *
 * It lives in the HEADER, not in the Synth section, because the Synth section
 * is unmounted on a drum focus: inside it, the row would take the only way
 * back to a melodic focus down with it.
 */
function SoundFocusChips({
  focusTrack,
  synthTarget,
  onFocus,
}: {
  focusTrack: MixLayerId;
  synthTarget: SynthControlTarget | null;
  onFocus: (focus: MixLayerId) => void;
}) {
  const renderFocusChip = (focus: MixLayerId) => {
    const style = isMelodicFocus(focus)
      ? SYNTH_TARGET_STYLES[controlTargetForFocus(focus)]
      : BEAT_CHIP;
    return (
      <button
        key={focus}
        id={`btn-focus-${focus}`}
        aria-current={focusTrack === focus ? 'true' : undefined}
        onClick={() => onFocus(focus)}
        className={`btn btn-xs text-[11px] font-semibold rounded-sm ${
          focusTrack === focus ? style.activeBtn : style.softBtn
        }`}
      >
        {style.label}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Six chips, not five: `drum` is a focus like any other and Beat is
          where the drum kit is edited. */}
      <div
        className={`flex items-center gap-1 flex-wrap bg-base-200 border rounded-box px-2 py-1 ${synthTarget ? SYNTH_TARGET_STYLES[synthTarget].border : 'border-accent'}`}
      >
        {MELODY_FOCUSES.map(renderFocusChip)}
        {/* Chord, bass and pad are one job done three ways. The frame is
            inside the tinted outer group, not replacing it: the outer tint
            tracks the ACTIVE target, this one groups three of the four. See
            ui/GroupFrame for why it adds no colour. daisyUI's join requires
            its direct children to be the joined items, which a GroupFrame
            between the outer div and three of the four chips breaks — so
            join/join-item are not used here and gap-1 carries the spacing. */}
        <GroupFrame label="Accompaniment" className="flex items-center gap-1 p-1">
          {ACCOMPANIMENT_FOCUSES.map(renderFocusChip)}
        </GroupFrame>
        {renderFocusChip(BEAT_FOCUS)}
      </div>

      {/* ONE solo button, following the focus — Sound edits exactly one layer
          at a time, so five buttons here would be four controls for layers
          this view is not editing. It sits beside the Focus chips because "it
          follows the focus" is only legible next to the focus. Session-only,
          and cleared by LEAVING the loop layer, by a change of active loop, or
          by a project swap — NOT by a focus change, which is what makes a set
          spanning two tracks buildable from here at all. store/soloNav.ts owns
          that rule and says why. It is NOT the header's SoloChip: that one is
          the loop's own state showing up wherever the user is, this one is a
          toggle for the one track the focus names. */}
      <SoloButton id="btn-solo-target" track={soloTrackForFocus(focusTrack)} size="sm" />
    </div>
  );
}
```

Pass it to the header:

```tsx
      <ViewHeader
        view="sound"
        viewControls={
          <SoundFocusChips
            focusTrack={focusTrack as MixLayerId}
            synthTarget={synthTarget}
            onFocus={setFocusTrack}
          />
        }
        actions={
          <SegmentedGroup>
            {soundDepthOptions(focusTrack as MixLayerId).map(({ depth: option, label, icon, title }) => (
              <SegmentedButton
                key={option}
                id={`btn-mode-${option}`}
                icon={icon}
                label={label}
                active={depth === option}
                onSelect={() => setDepth(option)}
                title={title}
              />
            ))}
          </SegmentedGroup>
        }
      />
```

In `src/components/loop/SoundSynthSection.tsx`, delete `SoundFocusRow` entirely along with `MELODY_FOCUSES`, `BEAT_FOCUS`, `ACCOMPANIMENT_FOCUSES`, `BEAT_CHIP`, and the imports only they used (`soloTrackForFocus`, `SoloButton`, `GroupFrame`, `MIX_LAYER_IDS`, `controlTargetForFocus`, `isMelodicFocus`, `melodyTrackForFocus`, `MIX_LAYER_LABELS`, `GROUP_LABEL`). Delete the `<SoundFocusRow … />` element from the returned fragment.

Delete the `onFocus` prop from `SoundSynthSection`'s props and stop passing it from `SoundView` — the chips are the header's now, so nothing inside the section changes the focus and a prop nobody reads is a claim that it does.

Move the oscilloscope into `SynthCard`, as its own component in the same file, and render it as the card's first child above `SynthPresetBar`:

```tsx
/**
 * The per-target oscilloscope, the way a hardware synth puts a scope beside
 * the section you are editing.
 *
 * It taps the TARGET layer's own pre-fader tap — after the VCA, before that
 * layer's bus gain and the sends — so it shows the patch being edited rather
 * than the finished mix the transport bar's master meter reads, and a fader
 * move does not resize a wave that has not changed. The trace is raw -1..+1
 * mapped straight onto the box height: no normalisation, no AGC, no dB curve,
 * which is only legible because the tap is ahead of the bus default.
 *
 * It lives in the SYNTH card, not in the tab's header: it reads the synth
 * channel's own tap, so on a drum focus it renders nowhere because the
 * component that draws it is not mounted — stricter and cheaper than a
 * `synthTarget !== null` test at the render site.
 *
 * `paused` is not optional. App keeps every view mounted (block/hidden) so
 * audio survives a tab switch, which means this rAF loop would otherwise run
 * forever behind a hidden tab.
 */
function SynthScope({
  synthTarget,
  activeTab,
}: {
  synthTarget: SynthControlTarget;
  activeTab: string;
}) {
  return (
    <div
      className="hidden sm:flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2 py-1 self-start"
      title={`Oscilloscope — ${SYNTH_TARGET_STYLES[synthTarget].label} layer`}
    >
      <span className="text-[10px] uppercase tracking-wider font-semibold text-base-content/50">
        {SYNTH_TARGET_STYLES[synthTarget].label}
      </span>
      <AudioVisualizer
        mode="oscilloscope"
        variant="inline"
        source={synthTarget}
        paused={activeTab !== 'sound'}
        height="auto"
        className="w-28 lg:w-40 rounded self-stretch"
        colorTheme={synthTarget === "chord" ? "accent" : "primary"}
      />
    </div>
  );
}
```

`SynthCard` gains an `activeTab: string` prop, and `SoundSynthSection` passes its own `activeTab` through.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/loop/SoundView.test.tsx && bun run lint && bun run eslint`
Expected: PASS, and `bun run eslint` reports nothing at all.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/SoundView.tsx src/components/loop/SoundSynthSection.tsx src/components/loop/SoundView.test.tsx
git commit -m "refactor(sound): move the focus chips into the header and the scope into the synth card"
```

---

### Task 4: The synth section unmounts on a drum focus

With the focus chips safely in the header, the Synth section can be gated out entirely rather than rendering a bodiless card. That also lets `SoundSynthSection` take a non-null `synthTarget`, which removes three `synthTarget !== null` guards and the `?? 'synth'` fallbacks inside it.

**Files:**
- Modify: `src/components/loop/SoundView.tsx`
- Modify: `src/components/loop/SoundSynthSection.tsx`
- Test: `src/components/loop/SoundView.test.tsx`

**Interfaces:**
- Consumes: `SoundSynthSection` props from Task 2 and Task 3.
- Produces: `SoundSynthSection` props gain `synthTarget: SynthControlTarget` (non-null, supplied by `SoundView`) and `focusTrack` stays for `useSynthChannel`. `SynthCard` no longer computes or null-checks `synthTarget`; it takes it as a prop.

- [ ] **Step 1: Write the failing test**

Replace the existing `test('the focus row is still on screen with the Synth section gone', …)` in `describe('the Sound page on a drum focus', …)` with:

```tsx
  /**
   * The chips are in the HEADER now, so a drum focus keeps every way back to a
   * melodic focus even though the whole Synth section is gone.
   */
  test('the focus chips are still on screen with the Synth section gone', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-focus-synth"');
    expect(html).toContain('id="btn-focus-drum"');
    expect(html).toContain('id="btn-solo-target"');
  });

  /**
   * The section must be ABSENT from the markup, not merely bodiless. That is
   * the gate `useSynthChannel`'s drum branch relies on: with the section
   * unmounted no panel calls that hook, so its Lead fallback can never edit
   * anything. It is also what removes the empty card that used to sit between
   * the header and the real editor.
   */
  test('no synth card, no oscilloscope and no preset overlays on a drum focus', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).not.toContain('>Synth<');
    expect(html).not.toContain('Oscilloscope —');
    expect(html).not.toContain('id="btn-quick-save-preset"');
    expect(html).not.toContain('id="btn-open-presets-library"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/SoundView.test.tsx -t "no synth card, no oscilloscope"`
Expected: FAIL — the section is still mounted on a drum focus, so `Oscilloscope —` is present and `expect(html).not.toContain('Oscilloscope —')` fails.

- [ ] **Step 3: Write minimal implementation**

In `src/components/loop/SoundView.tsx`, gate the two editors as mutual exclusives:

```tsx
      {/* Exactly one editor. A melodic focus has a synth channel to shape; a
          drum focus has the Beat instrument's own editor instead. The synth
          section UNMOUNTS rather than rendering bodiless: an editor with no
          patch to edit must not be left holding one, and `useSynthChannel`'s
          Lead fallback must never be reachable from a drum focus.

          `shouldCloseSynthOverlays` already covers the consequence — the
          preset library and the quick-save popover are `useState` inside a
          section that does not survive this gate. */}
      {synthTarget !== null && (
        <SoundSynthSection
          focusTrack={focusTrack as MixLayerId}
          synthTarget={synthTarget}
          activeTab={activeTab}
          soundGroups={SYNTH_SOUND_GROUP}
          depth={depth}
          onDepth={setDepth}
        />
      )}

      {synthTarget === null && <BeatSoundSection />}
```

In `src/components/loop/SoundSynthSection.tsx`:

1. Add `synthTarget: SynthControlTarget` to the props.
2. Delete the local `const synthTarget = synthTargetForFocus(focusTrack);` from both `SoundSynthSection` and `SynthCard`, and delete `SynthCard`'s `if (synthTarget === null) return null;`. `SynthCard` takes `synthTarget` as a prop.
3. `useSynthPresetBrowser(synthTarget)` and `useSynthOverlays({ focusTrack, target: synthTarget, … })` lose their `?? 'synth'` fallbacks.
4. Drop the `{synthTarget !== null && …}` wrappers from `SynthQuickSaveOverlay` and `SynthPresetDrawer`.
5. Remove the now-unused `synthTargetForFocus` import if nothing else in the file uses it.
6. Update the docblock on `SynthCard`'s null-branch comment — the paragraph explaining "Null when the focus is `drum`" describes a branch that no longer exists and must go rather than be left as prose about deleted code.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/loop/SoundView.test.tsx && bun run lint && bun run eslint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/SoundView.tsx src/components/loop/SoundSynthSection.tsx src/components/loop/SoundView.test.tsx
git commit -m "refactor(sound): unmount the synth section on a drum focus"
```

---

### Task 5: Depth reaches Beat, and the per-voice More disclosure goes

`BeatSoundSection` takes the tab's `depth` and threads it to each voice. At `simple` a voice shows its `primary` set; at `pro` it shows `primary` then `more` **in the same lane** — one continuous wrapping run, not a second lane below a divider, because at that depth they are one set. The `moreOpen` state and the More/Less button are deleted here, in the task that makes them dead.

**Files:**
- Modify: `src/components/loop/SoundView.tsx`
- Modify: `src/components/loop/beat/BeatSoundSection.tsx`
- Modify: `src/components/loop/beat/BeatVoiceList.tsx`
- Modify: `src/components/loop/beat/BeatVoiceRow.tsx`
- Test: `src/components/loop/beat/BeatSoundSection.test.tsx`

**Interfaces:**
- Consumes: `type SoundDepth = 'simple' | 'pro'` from `../useSoundDepth` (Task 1); `depth` from `SoundView` (Task 2).
- Produces:
  - `BeatSoundSection` props: `{ depth: SoundDepth }` (the component stays `React.memo`).
  - `BeatVoiceListProps` gains `depth: SoundDepth`.
  - `BeatVoiceRowProps` gains `depth: SoundDepth` and **loses nothing yet** — `open`/`onToggle` stay until Task 6.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/beat/BeatSoundSection.test.tsx`:

- change the render helper to take a depth:

```tsx
const render = (depth: SoundDepth = 'simple') => renderToString(<BeatSoundSection depth={depth} />);
```

  and add `import type { SoundDepth } from '../useSoundDepth';`
- delete the `test('a More group renders beneath its own row and only where the schema has one', …)` case outright;
- delete the last `expect(html).toContain('id="btn-beat-more-kick" …')` line from `test('every control a row introduces clears the 44px touch floor', …)`, leaving the three square buttons asserted;
- replace `test('one knob per schema control, keyed by voice and parameter', …)` with the two below.

```tsx
  test('simple shows each voice its Primary set and nothing else', () => {
    const html = render('simple');
    for (const id of BEAT_VOICE_IDS) {
      const { primary, more } = BEAT_CONTROL_SCHEMA[id];
      for (const control of primary) {
        expect(html).toContain(`id="knob-beat-${id}-${control.key}"`);
      }
      for (const control of more) {
        expect(html).not.toContain(`id="knob-beat-${id}-${control.key}"`);
      }
    }
    // The disclosure this depth replaces is gone: there is no per-voice
    // More/Less button on top of the section-level switch.
    expect(html).not.toContain('id="btn-beat-more-kick"');
  });

  /**
   * At `pro` the two sets are ONE set — `more` follows `primary` in the same
   * wrapping lane, not in a second lane below a divider.
   */
  test('pro shows Primary then More, in that order, in one lane', () => {
    const html = render('pro');
    for (const id of BEAT_VOICE_IDS) {
      const { primary, more } = BEAT_CONTROL_SCHEMA[id];
      if (more.length === 0) continue;
      const lastPrimary = html.indexOf(`id="knob-beat-${id}-${primary[primary.length - 1].key}"`);
      const firstMore = html.indexOf(`id="knob-beat-${id}-${more[0].key}"`);
      expect(lastPrimary).toBeGreaterThan(-1);
      expect(firstMore).toBeGreaterThan(lastPrimary);
    }
    expect(html).not.toContain('id="btn-beat-more-kick"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/beat/BeatSoundSection.test.tsx -t "simple shows each voice its Primary set"`
Expected: FAIL — `BeatSoundSection` takes no `depth` prop yet, so TypeScript rejects the render helper and, at runtime, every `more` knob still renders: `expect(html).not.toContain('id="knob-beat-kick-…"')` fails on the first `more` control.

- [ ] **Step 3: Write minimal implementation**

`src/components/loop/beat/BeatVoiceRow.tsx` — take `depth`, build one control list, delete `moreOpen` and the More button:

```tsx
export interface BeatVoiceRowProps {
  voice: BeatVoiceId;
  meta: BeatVoiceMeta;
  /** The DRAFT voices — a gesture in flight shows here before it commits. */
  voices: BeatVoices;
  /** The Sound tab's ONE depth value. `simple` is the voice's Primary set;
   *  `pro` is Primary then More, in the SAME lane — at this depth they are
   *  one set, so a divider between them would claim a split that is not
   *  there. */
  depth: SoundDepth;
  open: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onDraft: (key: string, value: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onReset: () => void;
  resetDisabled: boolean;
}
```

Inside the component, replace the destructure and the lane body:

```tsx
  const { primary, more } = BEAT_CONTROL_SCHEMA[voice];
  const controls = depth === 'pro' ? [...primary, ...more] : primary;
```

```tsx
        <div className={`flex ${KNOB_LANE}`}>{controls.map(knob)}</div>
```

Delete the `useState` import, the `moreOpen` state, the `<button id={`btn-beat-more-${voice}`} …>` and the `basis-full` More lane. Add `import type { SoundDepth } from '../useSoundDepth';`.

`src/components/loop/beat/BeatVoiceList.tsx` — add `depth: SoundDepth` to `BeatVoiceListProps` and pass it straight through to each `BeatVoiceRow`.

`src/components/loop/beat/BeatSoundSection.tsx` — take the prop and pass it down:

```tsx
export interface BeatSoundSectionProps {
  /** The Sound tab's ONE depth value, owned by SoundView. On this section it
   *  reads `Essential`/`All`, never Simple/Pro: Beat has no second parameter
   *  model for a "Pro" to switch to. */
  depth: SoundDepth;
}

export const BeatSoundSection = React.memo(function BeatSoundSection({ depth }: BeatSoundSectionProps) {
```

and `<BeatVoiceList depth={depth} … />`. Extend the component's existing docblock — do not replace it — so the NO SIMPLE/PRO paragraph gains its vocabulary note:

```tsx
 * NO SIMPLE/PRO SPLIT. Beat has one detailed editor by design — every knob
 * maps to exactly one stored parameter and Primary/More is disclosure, not a
 * second parameter model. The tab's depth switch therefore reaches this
 * section under DIFFERENT WORDS: `Essential` and `All`, from
 * `soundDepthOptions`. It is the same stored value the synth half uses,
 * because a user who asked for detail has expressed a preference about
 * detail — but calling this side "Pro" would make one word mean two things in
 * one app and would contradict the paragraph above it.
```

`src/components/loop/SoundView.tsx` — `{synthTarget === null && <BeatSoundSection depth={depth} />}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/loop/beat src/components/loop/SoundView.test.tsx && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/SoundView.tsx src/components/loop/beat/BeatSoundSection.tsx src/components/loop/beat/BeatVoiceList.tsx src/components/loop/beat/BeatVoiceRow.tsx src/components/loop/beat/BeatSoundSection.test.tsx
git commit -m "feat(beat): drive the voice controls from the Sound tab's depth"
```

---

### Task 6: The voice rows become cards in a grid

`BeatVoiceRow.tsx` → `BeatVoiceCard.tsx`, `BeatVoiceList.tsx` → `BeatVoiceGrid.tsx`. The accordion goes with them: `openVoice`, the per-card toggle, the `lg:hidden` summary and `beatVoiceSummary` itself are deleted in this task, because a card is never collapsed and the summary was the collapsed row's stand-in for knobs that were off screen.

**Files:**
- Create: `src/components/loop/beat/BeatVoiceCard.tsx`
- Delete: `src/components/loop/beat/BeatVoiceRow.tsx`
- Create: `src/components/loop/beat/BeatVoiceGrid.tsx`
- Delete: `src/components/loop/beat/BeatVoiceList.tsx`
- Modify: `src/components/loop/beat/BeatSoundSection.tsx`
- Test: `src/components/loop/beat/BeatSoundSection.test.tsx`

**Interfaces:**
- Consumes: `type SoundDepth` from `../useSoundDepth`; `BEAT_CONTROL_SCHEMA` and `readBeatParam` from `./beatControlSchema`; `BEAT_VOICE_ROWS` and `type BeatVoiceMeta` from `./beatVoices`; `PanelCard` from `@/components/ui/PanelCard`; `ModuleHeader` from `@/components/ui/ModuleHeader`; `Knob` from `@/components/ui/Knob`.
- Produces:
  - `interface BeatVoiceCardProps { voice: BeatVoiceId; meta: BeatVoiceMeta; voices: BeatVoices; depth: SoundDepth; onPreview: () => void; onDraft: (key: string, value: number) => void; onCommit: () => void; onCancel: () => void; onReset: () => void; resetDisabled: boolean }`
  - `function BeatVoiceCard(props: BeatVoiceCardProps)`
  - `interface BeatVoiceGridProps { voices: BeatVoices; depth: SoundDepth; onPreview: (voice: BeatVoiceId) => void; onDraft: (voice: BeatVoiceId, key: string, value: number) => void; onCommit: () => void; onCancel: () => void; onResetVoice: (voice: BeatVoiceId) => void; resetDisabled: boolean }`
  - `function BeatVoiceGrid(props: BeatVoiceGridProps)`
  - Markup ids: `beat-voice-card-${voice}`, `beat-voice-chip-${voice}`, `btn-beat-preview-${voice}`, `btn-beat-reset-${voice}`, `knob-beat-${voice}-${key}`. `beat-voice-row-*`, `beat-voice-body-*`, `btn-beat-toggle-*` and `btn-beat-more-*` no longer exist.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/beat/BeatSoundSection.test.tsx`:

- delete the `import { beatVoiceSummary } from './BeatVoiceRow';` line and the `test('a row summary reads its first two Primary controls, in their units', …)` case;
- in `test('orders the toolbar, then the filter, then the voices', …)` change `id="beat-voice-row-kick"` to `id="beat-voice-card-kick"`;
- replace `describe('the responsive voice list', …)` in full with the block below, and rename `test('renders one row per voice, …')` to read `id="beat-voice-card-${id}"`.

```tsx
/**
 * The eleven voices are an instrument's compartments, in a grid. There is no
 * accordion and no per-card disclosure: a card is never collapsed, so it needs
 * no stand-in for knobs that are off screen and no control to open it.
 *
 * The layout contract is in the CLASSES, not in JS — there is no viewport here
 * and no `matchMedia` in the component — so these assert the class strings
 * that carry it.
 */
describe('the Beat voice grid', () => {
  test('is a one/two/three column grid whose cards keep their own height', () => {
    const html = render();
    // `items-start`: the whole point of a wrapping knob lane is that a short
    // voice is short, and a stretching grid item hands the saved height back
    // as whitespace.
    expect(html).toContain(
      '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 items-start">',
    );
  });

  test('a card lays its knobs out as one wrapping lane', () => {
    const html = render();
    for (const id of BEAT_VOICE_IDS) {
      expect(html).toContain(
        `<div id="beat-voice-card-${id}" class="card-body p-3 gap-2.5">`,
      );
    }
    // The lane carries no breakpoint on purpose: the knobs have a fixed
    // footprint and wrap at whatever width they are given, so a column count
    // that has to track the schema does not exist.
    expect(html).toContain('<div class="flex flex-wrap gap-x-1 gap-y-1.5 sm:gap-x-2">');
  });

  test('no accordion survives the move to cards', () => {
    const html = render();
    for (const id of BEAT_VOICE_IDS) {
      expect(html).not.toContain(`id="btn-beat-toggle-${id}"`);
      expect(html).not.toContain(`id="beat-voice-body-${id}"`);
      expect(html).not.toContain(`id="btn-beat-more-${id}"`);
    }
    expect(html).not.toContain('aria-expanded');
  });

  test('Preview and Reset each keep their own 44px target', () => {
    const html = render();
    const square = 'class="btn btn-ghost btn-square min-h-11 min-w-11"';
    for (const id of BEAT_VOICE_IDS) {
      expect(html).toContain(`id="btn-beat-preview-${id}" ${square}`);
      expect(html).toContain(`id="btn-beat-reset-${id}" type="button" ${square}`);
    }
  });
});

/**
 * The `+N` chip: a section-level depth switch that visibly changes only a
 * minority of the cards reads as broken — the user presses All, some cards
 * change and the rest look like they failed. The chip makes the affected cards
 * legible BEFORE the switch is pressed, so a card WITH a chip has more to show
 * and a card WITHOUT one is complete rather than silent.
 */
describe('the More count chip', () => {
  test('appears at simple, only on a voice whose More set is non-empty', () => {
    const html = render('simple');
    for (const id of BEAT_VOICE_IDS) {
      const count = BEAT_CONTROL_SCHEMA[id].more.length;
      expect(html.includes(`id="beat-voice-chip-${id}"`)).toBe(count > 0);
    }
  });

  // Read off the schema, never a second hand-written list: a re-partitioned
  // schema can then never leave the chip claiming a number nothing renders.
  test('states the number of controls the deeper depth will add', () => {
    const html = render('simple');
    for (const id of BEAT_VOICE_IDS) {
      const count = BEAT_CONTROL_SCHEMA[id].more.length;
      if (count === 0) continue;
      const chip = html.slice(html.indexOf(`id="beat-voice-chip-${id}"`));
      expect(chip.slice(0, chip.indexOf('</span>'))).toContain(`+${count}`);
    }
  });

  test('never appears at pro, where there is nothing left to reveal', () => {
    const html = render('pro');
    for (const id of BEAT_VOICE_IDS) {
      expect(html).not.toContain(`id="beat-voice-chip-${id}"`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/beat/BeatSoundSection.test.tsx -t "is a one/two/three column grid"`
Expected: FAIL — the voices still render as a `flex flex-col gap-1.5` list, so `expect(html).toContain('<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 items-start">')` fails.

- [ ] **Step 3: Write the card**

Create `src/components/loop/beat/BeatVoiceCard.tsx` (and `git rm` `BeatVoiceRow.tsx` once nothing imports it):

```tsx
import { Play, RotateCcw } from 'lucide-react';
import { Knob } from '@/components/ui/Knob';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { PanelCard } from '@/components/ui/PanelCard';
import { BEAT_CONTROL_SCHEMA, readBeatParam } from './beatControlSchema';
import type { BeatControl } from './beatControlSchema';
import type { BeatVoiceMeta } from './beatVoices';
import type { SoundDepth } from '../useSoundDepth';
import type { BeatVoiceId, BeatVoices } from '@/types';

/**
 * The knob lane: a WRAPPING FLEX ROW, not a column grid.
 *
 * A grid gave every voice the same columns whatever it held, so a sparse voice
 * paid for the densest voice's width and the rows sat far apart. Flex packs
 * each knob at its own fixed footprint and breaks when it runs out — the lane
 * is then as tall as the voice needs and no taller, at every width, with no
 * breakpoint to keep in step with the schema. The fixed `w-14` on each knob is
 * what keeps the wrapped rows aligned: a dial under a caption and over a
 * readout is otherwise as wide as its longest string.
 *
 * The argument gets STRONGER inside a card. Knob counts per voice differ by a
 * factor of several, so a fixed column count makes the sparsest voice pay the
 * densest voice's width in a column that is now a fraction of the viewport
 * rather than all of it.
 *
 * `flex` is NOT in here: a lane that toggles between `flex` and `hidden` with
 * two display utilities on one element resolves by stylesheet order rather
 * than by class order — which is a coin toss, not a contract.
 */
const KNOB_LANE = 'flex-wrap gap-x-1 gap-y-1.5 sm:gap-x-2';

/**
 * The `+N` chip's shell. Styled like the synth's `ModuleChip` rather than
 * imported from it: that one takes a `ProModuleColor`, the six synth
 * signal-stage tints, and every Beat voice uses a `text-drum-*` tint instead.
 * Widening a synth-owned union to admit drum tokens would couple two features
 * permanently for the sake of a badge.
 */
const VOICE_CHIP = 'badge badge-sm badge-outline text-[9px] font-semibold';

export interface BeatVoiceCardProps {
  voice: BeatVoiceId;
  meta: BeatVoiceMeta;
  /** The DRAFT voices — a gesture in flight shows here before it commits. */
  voices: BeatVoices;
  /** `simple` is the voice's Primary set; `pro` is Primary then More in the
   *  SAME lane, because at that depth they are one set. */
  depth: SoundDepth;
  onPreview: () => void;
  /** Writes one parameter into the draft and previews it. */
  onDraft: (key: string, value: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onReset: () => void;
  /** True when the loop's base preset cannot be resolved: a voice reset copies
   *  FROM that preset, so there is nothing for it to do. */
  resetDisabled: boolean;
}

/**
 * One voice, as one compartment of the instrument: Preview, its colour, its
 * name, a `+N` chip where a deeper depth has more to show, Reset, and one
 * wrapping lane of knobs.
 *
 * THE SHELL IS BEAT'S OWN, not `loop/synth/proControls`' `ProModule`. That one
 * is typed on `ProModuleColor` — the synth's signal-stage tints — which
 * excludes every `text-drum-*` tint a Beat voice uses. Both are a `PanelCard
 * inset` plus a `ModuleHeader`, and two near-identical shells in two features
 * are cheaper to read and cheaper to change than one shared component with a
 * union widened to serve both. RULE OF THREE: a third consumer promotes the
 * shell into `ui/`; the second does not.
 *
 * `inset` is the recessed compartment idiom and is correct here — these cards
 * sit inside `BeatSoundSection`'s own `SectionCard`.
 *
 * The header's left cell is BESPOKE, passed through `children` rather than
 * `title`: Preview must sit beside the voice name, and a 44px tap target
 * wedged into the canonical `MODULE_TITLE` text run is a button inside a
 * sentence. `ModuleHeader` supports exactly this — `title` is optional and
 * `children` replaces it when the left cell is not canonical.
 *
 * There is no accordion and no per-card More button. The section-level depth
 * switch is the one disclosure model on this surface; a second one on top of
 * it was two models in one screen.
 */
export function BeatVoiceCard({
  voice,
  meta,
  voices,
  depth,
  onPreview,
  onDraft,
  onCommit,
  onCancel,
  onReset,
  resetDisabled,
}: BeatVoiceCardProps) {
  const { primary, more } = BEAT_CONTROL_SCHEMA[voice];
  const controls = depth === 'pro' ? [...primary, ...more] : primary;
  // Derived from the schema, never a second hand-written list: a re-sorted or
  // re-partitioned schema can then never leave the chip claiming a number
  // nothing renders.
  const hiddenCount = depth === 'simple' ? more.length : 0;

  const knob = (control: BeatControl) => (
    <Knob
      key={control.key}
      id={`knob-beat-${voice}-${control.key}`}
      size="sm"
      // The voice's OWN colour, not the section's: eleven cards of identical
      // secondary knobs read as one undifferentiated field, and the chip in
      // the header already names each card by colour.
      color={meta.knobColor}
      className="w-14 shrink-0"
      label={control.label}
      // Contains the visible label, per WCAG 2.5.3 — eleven cards draw the
      // same "Decay" caption and a screen-reader user must be able to tell
      // them apart.
      ariaLabel={`${meta.label} ${control.label}`}
      value={readBeatParam(voices, voice, control.key)}
      min={control.min}
      max={control.max}
      step={control.step}
      scale={control.scale}
      format={control.format}
      onChange={(value) => onDraft(control.key, value)}
      onCommit={(value) => {
        onDraft(control.key, value);
        onCommit();
      }}
      onCancel={onCancel}
    />
  );

  return (
    <PanelCard inset className="min-w-0">
      <div id={`beat-voice-card-${voice}`} className="card-body p-3 gap-2.5">
        <ModuleHeader
          right={
            <div className="flex items-center gap-1 shrink-0">
              {hiddenCount > 0 && (
                <span id={`beat-voice-chip-${voice}`} className={`${VOICE_CHIP} ${meta.knobColor}`}>
                  +{hiddenCount}
                </span>
              )}
              <button
                id={`btn-beat-reset-${voice}`}
                disabled={resetDisabled}
                type="button"
                className="btn btn-ghost btn-square min-h-11 min-w-11"
                title={resetDisabled ? 'This patch has no preset to reset to' : `Reset ${meta.label}`}
                aria-label={`Reset ${meta.label}`}
                onClick={onReset}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          }
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <button
              id={`btn-beat-preview-${voice}`}
              className="btn btn-ghost btn-square min-h-11 min-w-11"
              type="button"
              aria-label={`Preview ${meta.label}`}
              onClick={onPreview}
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.color}`} aria-hidden="true" />
            <span className="text-xs font-bold text-base-content truncate">{meta.label}</span>
          </span>
        </ModuleHeader>

        <div className={`flex ${KNOB_LANE}`}>{controls.map(knob)}</div>
      </div>
    </PanelCard>
  );
}
```

- [ ] **Step 4: Write the grid and wire the section**

Create `src/components/loop/beat/BeatVoiceGrid.tsx` (and `git rm` `BeatVoiceList.tsx`):

```tsx
import { BEAT_VOICE_ROWS } from './beatVoices';
import { BeatVoiceCard } from './BeatVoiceCard';
import type { SoundDepth } from '../useSoundDepth';
import type { BeatVoiceId, BeatVoices } from '@/types';

export interface BeatVoiceGridProps {
  /** The DRAFT voices — a gesture in flight shows here before it commits. */
  voices: BeatVoices;
  depth: SoundDepth;
  onPreview: (voice: BeatVoiceId) => void;
  onDraft: (voice: BeatVoiceId, key: string, value: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onResetVoice: (voice: BeatVoiceId) => void;
  resetDisabled: boolean;
}

/**
 * The eleven voice cards, in canonical order. It holds NO state: the accordion
 * this replaced kept one open voice, and a card is never collapsed.
 *
 * One column, two at `md`, three at `xl`. Not four at `xl`: the densest
 * voice's lane gets uncomfortable in a narrower column, where the knob row
 * wraps into a column tall enough to undo the density the grid bought.
 *
 * `items-start` so a card keeps its natural height instead of stretching to
 * the tallest sibling in its row — the whole point of the wrapping knob lane
 * is that a sparse voice is short, and a stretching grid item would hand that
 * saved height back as whitespace.
 *
 * On a phone the cards stack one per row with no accordion, so this surface
 * scrolls further than the list did. Accepted: the default depth shows only
 * each voice's Primary set, the tab already scrolls at that width, and a
 * mobile-only accordion would be a second interaction model reachable only by
 * viewport — which would also render the wrong one for a frame on every mount.
 */
export function BeatVoiceGrid({
  voices,
  depth,
  onPreview,
  onDraft,
  onCommit,
  onCancel,
  onResetVoice,
  resetDisabled,
}: BeatVoiceGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 items-start">
      {BEAT_VOICE_ROWS.map((row) => (
        <BeatVoiceCard
          key={row.id}
          voice={row.id}
          meta={row}
          voices={voices}
          depth={depth}
          onPreview={() => onPreview(row.id)}
          onDraft={(key, value) => onDraft(row.id, key, value)}
          onCommit={onCommit}
          onCancel={onCancel}
          onReset={() => onResetVoice(row.id)}
          resetDisabled={resetDisabled}
        />
      ))}
    </div>
  );
}
```

In `src/components/loop/beat/BeatSoundSection.tsx`, swap the import and the element: `import { BeatVoiceGrid } from './BeatVoiceGrid';` and `<BeatVoiceGrid voices={draft.voices} depth={depth} … />`, with the remaining props unchanged. Replace the docblock's "then one row per voice in canonical order" with "then one card per voice in canonical order".

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/components/loop/beat src/components/loop/SoundView.test.tsx && bun run lint && bun run eslint`
Expected: PASS, and `bun run eslint` reports nothing at all.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/loop/beat
git commit -m "feat(beat): render the eleven voices as cards in a grid"
```

---

### Task 7: Run the completion gate and close what it finds

**Files:**
- Modify: whatever `bun run verify` reports, most likely under `src/components/loop/`

**Interfaces:**
- Consumes: everything Tasks 1–6 produced.
- Produces: no new exports.

- [ ] **Step 1: Run the whole gate**

Run: `bun run verify`
Expected: PASS — all tests, the static and domain checks, both Knip scans and the production build.

- [ ] **Step 2: Work the findings, in this order**

Do not silence a finding; fix the code behind it.

1. **Knip, unused files.** The restructure deletes two files and adds three. A module left importable but imported by nothing fails the default scan; a module kept alive only by a test appears in the *production* scan as an unused production file. Expect `BeatVoiceRow.tsx` and `BeatVoiceList.tsx` to be reported if a `git rm` was missed.
2. **Knip, unused exports.** `useSynthViewMode` is gone from `synthPresetBrowser.ts`; if `beatVoiceSummary` or a prop type survived its last consumer, delete it rather than re-exporting it for a test.
3. **ESLint.** The baseline is zero findings, including zero warnings. Watch for a `react-hooks/exhaustive-deps` warning introduced by `useSoundDepth`; if one is genuine, fix the dependency — a line disable is only for an exception that carries a comment naming its reason.
4. **`bun run check:theme`.** Every class string added in Tasks 3, 5 and 6 must be a literal naming a role. The token guard's allowlist is empty and must stay empty.
5. **`bun run check:contrast`.** No `--drum-*` or `--module-*` token changed here, so this should be untouched; if it fails, a colour was added and needs declaring in **both** themes.
6. **The production build.** A type error that `bun run lint` (`tsc --noEmit`) misses is unlikely, but the build is the last word.

- [ ] **Step 3: Re-run the gate until it is clean**

Run: `bun run verify`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(sound): close the verify gate after the header and voice-card restructure"
```
