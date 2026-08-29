# SP1 — Reusable StepRow + chord/bass custom step sequencers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable `StepRow<T>` UI primitive and additive "Custom" step-sequencer modes for chord rhythm (boolean hit grid) and bass pattern (per-step chord-tone grid), sitting alongside the existing presets.

**Architecture:** The two custom grids live in the store (`customChordRhythm: boolean[]`, `customBassPattern: BassStepChoice[]`) and are stored at a fixed `MAX_STEPS_PER_BAR` (24) width — the same non-destructive scheme the drum rows use, so switching meter never drops steps drawn in a wider meter. At playback time `useChordPlayback.ts` synthesizes a `RhythmPattern` / `BassPattern` from the grid and feeds it through the existing `adaptRhythmPattern` / `adaptBassPattern` + chord-event-builder / `resolveBassSteps` pipeline unchanged — the custom `octave` step maps to `note: 'root', octaveShift: 1`, so all chord-tone quality-aware resolution (`TONE_INDEX` + `FALLBACK_CHAIN`) is reused verbatim. `StepRow<T>` is a theme-agnostic primitive whose active-step classes come from a caller-supplied `color` prop, so chord passes `bg-module-chord text-module-chord-content` and bass passes `bg-module-bass text-module-bass-content`.

**Tech Stack:** Bun, Vite, React 18, TypeScript, Zustand, raw Web Audio

**Spec:** https://linear.app/pathompong-thitithan/issue/DEV-365/sp1-reusable-steprow-chordbass-custom-step-sequencers

## Global Constraints

- **Layering (eslint `no-restricted-imports`):** `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` never imports `audio/engine` except the three read-only analyser consumers `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx` and test files.
- **Store→engine bridge:** never call engine setters from a component — add state to a slice and wire it in `src/store/engineSync.ts`. `useChordPlayback.ts` reaches the engine only through `audio/playback/playbackEngine.ts`.
- **Theming:** two daisyUI themes (`solna-dark`, `solna-light`) declared CSS-first in `src/index.css`; no `tailwind.config.*` may be added. Components name **roles**, never colours. `scripts/themeTokenGuard.ts` fails on raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`/etc., the `dark:` variant, `rgb()`/`rgba()` literals, and silently-dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty; fix code, not the allowlist.
- **Module identity tokens:** `module-chord`/`-content` and `module-bass`/`-content` are registered in `@theme` (`src/index.css`), so `bg-module-chord`, `text-module-chord-content`, `bg-module-bass`, `text-module-bass-content` are valid Tailwind utilities (verified against the existing `border-module-chord/30`, `text-module-bass` usage).
- **Testing:** tests are `bun:test`, pure-logic-first — components export their testable helpers, and component rendering uses `renderToString` from `react-dom/server` (no DOM / testing-library setup). No new test style.
- **`bun run verify` is the completion gate:** `test + lint + check:keys + check:drums + build`. It does **not** run `bun run eslint` — run `bun run eslint` separately when imports change (every task here touches imports).
- **Storage access is guarded:** `localStorage` can throw; `store.ts` already falls back to an in-memory `StateStorage`. Persisted payloads are sanitized in `sanitizePersistedState` before merge.
- **Meter adaptation:** custom grids are stored at a fixed `MAX_STEPS_PER_BAR` (24) width — the same non-destructive scheme as the drum rows — so `setMeter` does **not** touch them and switching meter never drops steps drawn in a wider meter. The UI renders only `stepsPerBar` cells; `customRhythmPattern` / `customBassPattern` trim the grid to the active `stepsPerBar` at use-time (`Math.min(grid.length, stepsPerBar)`).

---

## File Structure

**New files:**
- `src/components/ui/StepRow.tsx` — generic, theme-agnostic step-grid primitive (the chord/bass grids' shared row). Its only colour input is the caller's `color` prop.
- `src/audio/rhythmPatterns.test.ts` — pure tests for `customRhythmPattern`.
- `src/audio/bassPatterns.test.ts` — pure tests for `customBassPattern` including resolution through `resolveBassSteps`.
- `src/store/customStepSequencer.test.ts` — store defaults, verbatim setters, non-destructive meter invariance, vibe mode reset.
- `src/components/ui/StepRow.test.tsx` — `renderToString` tests for the primitive.

**Modified files:**
- `src/audio/rhythmPatterns.ts` — add `customRhythmPattern(grid, stepsPerBar, meter)` (boolean grid → `RhythmPattern`, block hits only).
- `src/audio/bassPatterns.ts` — add `BassStepChoice` type + `customBassPattern(choices, stepsPerBar, meter)` (choice grid → `BassPattern`; `octave` → `note: 'root', octaveShift: 1`).
- `src/store/types.ts` — extend `ChordsSlice`, `BassSlice`, `PersistedState` with the four new fields + setters.
- `src/store/chordsSlice.ts` — chord custom fields + setters (fixed `MAX_STEPS_PER_BAR`-width storage, no per-edit normalization).
- `src/store/bassSlice.ts` — bass custom fields + setters (same fixed-width storage).
- `src/store/store.ts` — persist the four new fields in `partializeAppState`; sanitize them in `sanitizePersistedState`.
- `src/store/instantVibes.ts` — `applyInstantVibeToStore` resets `chordRhythmMode`/`bassPatternMode` to `'preset'` (a vibe sets the ids; the custom grid must not shadow them).
- `src/components/chord/useChordPlayback.ts` — mode-aware pattern resolution (`resolvePlaybackRhythmPattern` / `resolvePlaybackBassPattern`), plus expose `currentStep` / `isPlaying` for the grid playhead.
- `src/components/chord/useChordPlayback.test.ts` — tests for the resolution helpers + custom-pattern adaptation/full-hold behavior.
- `src/components/ChordView.tsx` — "Custom…" options on both dropdowns, `StepRow` grids, exported `nextBassStepChoice` / `bassStepLabel` helpers, mode-aware preview memos.
- `src/components/ChordView.test.tsx` — helper tests + custom-grid rendering tests.

---

### Task 1: Chord custom grid → `RhythmPattern` helper

**Files:**
- Modify: `src/audio/rhythmPatterns.ts` (append the export after `fullHoldDuration`, end of file)
- Test: `src/audio/rhythmPatterns.test.ts` (new)

**Interfaces:**
- Consumes: `RhythmPattern`, `RhythmHit` (same file), `MeterId` type (already imported in `rhythmPatterns.ts`).
- Produces: `customRhythmPattern(grid: readonly boolean[], stepsPerBar: number, meter: MeterId): RhythmPattern` — every `true` step becomes one `{ step, type: 'block', velocity: 1, holdSteps: 1 }` hit; steps at or past `stepsPerBar` are ignored; the returned pattern carries `id: 'custom'`, `name: 'Custom'`, `style: 'Custom'` and the active `meter` so `adaptRhythmPattern` returns it unchanged in the active meter.

- [ ] **Step 1: Write the failing test**

Create `src/audio/rhythmPatterns.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { customRhythmPattern } from './rhythmPatterns';
import type { MeterId } from '../utils/meter';

const FOUR_FOUR: MeterId = '4/4';

const FOUR_ON_FLOOR = [
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
];

describe('customRhythmPattern — boolean grid to RhythmPattern', () => {
  test('every true step becomes one block hit at that step', () => {
    const pattern = customRhythmPattern(FOUR_ON_FLOOR, 16, FOUR_FOUR);
    expect(pattern.id).toBe('custom');
    expect(pattern.name).toBe('Custom');
    expect(pattern.meter).toBe('4/4');
    expect(pattern.hits).toEqual([
      { step: 0, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 4, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 8, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 12, type: 'block', velocity: 1, holdSteps: 1 },
    ]);
  });

  test('all-false grid yields no hits', () => {
    expect(customRhythmPattern(new Array(16).fill(false), 16, FOUR_FOUR).hits).toEqual([]);
  });

  test('steps at or past stepsPerBar are ignored even if the array is longer', () => {
    const grid = [true, true, true, true, true];
    expect(customRhythmPattern(grid, 4, FOUR_FOUR).hits).toEqual([
      { step: 0, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 1, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 2, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 3, type: 'block', velocity: 1, holdSteps: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/rhythmPatterns.test.ts`
Expected: FAIL with `customRhythmPattern is not a function` (module has no such export).

- [ ] **Step 3: Implement the helper**

Append to `src/audio/rhythmPatterns.ts`:

```ts
/**
 * Synthesize a RhythmPattern from the user's custom chord grid. Every true step
 * is one block hit (no strum); the pattern is authored at the ACTIVE meter, so
 * the meter is stamped on it and `adaptRhythmPattern` returns it unchanged in
 * that meter. Never full-hold: holdSteps is always 1, so `isFullHoldRhythm`
 * resolves false even for a one-hit grid.
 */
export function customRhythmPattern(
  grid: readonly boolean[],
  stepsPerBar: number,
  meter: MeterId,
): RhythmPattern {
  const hits: RhythmHit[] = [];
  const length = Math.min(grid.length, stepsPerBar);
  for (let step = 0; step < length; step++) {
    if (grid[step] === true) {
      hits.push({ step, type: 'block' as const, velocity: 1, holdSteps: 1 });
    }
  }
  return { id: 'custom', name: 'Custom', style: 'Custom', meter, hits };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/rhythmPatterns.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/rhythmPatterns.ts src/audio/rhythmPatterns.test.ts
git commit -m "feat(audio): add customRhythmPattern boolean-grid helper

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Bass custom grid → `BassPattern` helper + `BassStepChoice`

**Files:**
- Modify: `src/audio/bassPatterns.ts` (add `BassStepChoice` after the `BassNoteToken` type; append `customBassPattern` at the end, after `BASS_STYLE_GROUPS`)
- Test: `src/audio/bassPatterns.test.ts` (new)

**Interfaces:**
- Consumes: `BassStep`, `BassPattern`, `BassNoteToken`, `resolveBassSteps` (same file), `MeterId` type (already imported), `ChordItem` (`src/types`).
- Produces:
  - `type BassStepChoice = Extract<BassNoteToken, 'rest' | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'>` — the closed set the custom bass grid stores per step. Deliberately no scale-degree or 2-4-6 colour tones: borrowed/non-diatonic chords are always possible, so a scale-degree step could resolve off-key.
  - `customBassPattern(choices: readonly BassStepChoice[], stepsPerBar: number, meter: MeterId): BassPattern` — each non-rest step becomes one `BassStep` with `holdSteps` defaulting to 1 (no staccato/alternate); `'octave'` maps to `{ step, note: 'root', octaveShift: 1 }` (root + 12, per the SP1 spec); the returned pattern carries `id: 'custom'`, `name: 'Custom'`, `style: 'Custom'`, the active `meter`.

- [ ] **Step 1: Write the failing test**

Create `src/audio/bassPatterns.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { customBassPattern, resolveBassSteps, type BassStepChoice } from './bassPatterns';
import type { MeterId } from '../utils/meter';
import type { ChordItem } from '../types';

const FOUR_FOUR: MeterId = '4/4';

describe('customBassPattern — choice grid to BassPattern', () => {
  test('root/third/fifth/seventh map to one 16th step each; octave maps to root + octaveShift', () => {
    const choices: BassStepChoice[] = [
      'root', 'rest', 'third', 'rest', 'fifth', 'rest', 'seventh', 'rest',
      'rest', 'rest', 'rest', 'rest', 'octave', 'rest', 'rest', 'rest',
    ];
    const pattern = customBassPattern(choices, 16, FOUR_FOUR);
    expect(pattern.id).toBe('custom');
    expect(pattern.meter).toBe('4/4');
    expect(pattern.steps).toEqual([
      { step: 0, note: 'root' },
      { step: 2, note: 'third' },
      { step: 4, note: 'fifth' },
      { step: 6, note: 'seventh' },
      { step: 12, note: 'root', octaveShift: 1 },
    ]);
  });

  test('all-rest grid yields no steps', () => {
    const choices: BassStepChoice[] = new Array(16).fill('rest');
    expect(customBassPattern(choices, 16, FOUR_FOUR).steps).toEqual([]);
  });

  test('steps at or past stepsPerBar are ignored', () => {
    const choices: BassStepChoice[] = ['root', 'root', 'root', 'root', 'root'];
    expect(customBassPattern(choices, 4, FOUR_FOUR).steps).toEqual([
      { step: 0, note: 'root' },
      { step: 1, note: 'root' },
      { step: 2, note: 'root' },
      { step: 3, note: 'root' },
    ]);
  });
});

describe('customBassPattern — resolution reuses the existing quality-aware resolver', () => {
  const maj7: ChordItem = {
    id: 't', root: 'C', quality: 'maj7', bars: 1,
    notes: ['C4', 'E4', 'G4', 'B4'],
  };

  test('octave resolves an octave above the bass root', () => {
    const choices: BassStepChoice[] = ['octave', ...new Array<BassStepChoice>(15).fill('rest')];
    const events = resolveBassSteps(
      customBassPattern(choices, 16, FOUR_FOUR),
      [maj7], 0, 2, 'C', 'major', 120,
    );
    expect(events[0].noteName).toBe('C3'); // bass octave 2 → C2, +12 → C3
  });

  test('seventh falls back through the FALLBACK_CHAIN to fifth on a triad', () => {
    const triad: ChordItem = {
      id: 't', root: 'C', quality: 'maj', bars: 1,
      notes: ['C4', 'E4', 'G4'],
    };
    const choices: BassStepChoice[] = ['seventh', ...new Array<BassStepChoice>(15).fill('rest')];
    const events = resolveBassSteps(
      customBassPattern(choices, 16, FOUR_FOUR),
      [triad], 0, 2, 'C', 'major', 120,
    );
    expect(events[0].noteName).toBe('G2'); // C2 + 7 semitones
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: FAIL — `BassStepChoice`/`customBassPattern` do not exist in `bassPatterns.ts`.

- [ ] **Step 3: Implement the type and helper**

In `src/audio/bassPatterns.ts`, directly after the `BassNoteToken` type declaration add:

```ts
/**
 * The subset of BassNoteToken the custom bass grid offers. Deliberately no
 * scale-degree or 2-4-6 colour tones: borrowed/non-diatonic chords are always
 * possible, so a step that assumes a scale degree could resolve off-key.
 */
export type BassStepChoice = Extract<
  BassNoteToken,
  'rest' | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
>;
```

Append at the end of the file (after `export const BASS_STYLE_GROUPS`):

```ts
/**
 * Synthesize a BassPattern from the user's custom bass grid. Each non-rest step
 * is a single 16th hit (holdSteps defaults to 1, no staccato/alternate);
 * 'octave' maps to root + octaveShift 1 (the +12 the resolver's own 'octave'
 * token would give, expressed per the SP1 spec). Authored at the ACTIVE meter.
 * Resolution is NOT reimplemented here — resolveBassSteps consumes this the
 * same way it consumes any library pattern.
 */
export function customBassPattern(
  choices: readonly BassStepChoice[],
  stepsPerBar: number,
  meter: MeterId,
): BassPattern {
  const steps: BassStep[] = [];
  const length = Math.min(choices.length, stepsPerBar);
  for (let step = 0; step < length; step++) {
    const choice = choices[step];
    if (choice === 'rest') continue;
    steps.push(
      choice === 'octave'
        ? { step, note: 'root' as const, octaveShift: 1 }
        : { step, note: choice },
    );
  }
  return { id: 'custom', name: 'Custom', style: 'Custom', meter, steps };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS (5 tests). Note the resolution tests prove no new resolver was written — the custom pattern flows through the existing `resolveBassSteps` unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/audio/bassPatterns.ts src/audio/bassPatterns.test.ts
git commit -m "feat(audio): add BassStepChoice and customBassPattern grid helper

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Store fields, persist wiring, non-destructive storage, vibe mode reset

**Files:**
- Modify: `src/store/types.ts` (`ChordsSlice`, `BassSlice`, `PersistedState`)
- Modify: `src/store/chordsSlice.ts`
- Modify: `src/store/bassSlice.ts`
- Modify: `src/store/store.ts` (`partializeAppState`, `sanitizePersistedState`)
- Modify: `src/store/instantVibes.ts` (`applyInstantVibeToStore`)
- Test: `src/store/customStepSequencer.test.ts` (new)

**Interfaces:**
- Consumes: `BassStepChoice` from `../audio/bassPatterns` (Task 2); `MAX_STEPS_PER_BAR` from `../utils/meter`; `applyInstantVibeToStore`, `INSTANT_VIBES` from `./instantVibes`.
- Produces (on `ChordsSlice`):
  - `chordRhythmMode: 'preset' | 'custom'`
  - `customChordRhythm: boolean[]` (always `MAX_STEPS_PER_BAR` long — non-destructive, drum-row style)
  - `setChordRhythmMode: (mode: 'preset' | 'custom') => void`
  - `setCustomChordRhythm: (steps: boolean[]) => void` (stores the grid verbatim; the UI passes a `MAX_STEPS_PER_BAR`-long array)
- Produces (on `BassSlice`):
  - `bassPatternMode: 'preset' | 'custom'`
  - `customBassPattern: BassStepChoice[]` (always `MAX_STEPS_PER_BAR` long)
  - `setBassPatternMode: (mode: 'preset' | 'custom') => void`
  - `setCustomBassPattern: (steps: BassStepChoice[]) => void`
- Produces (on `PersistedState`): `chordRhythmMode`, `customChordRhythm`, `bassPatternMode`, `customBassPattern`.

**Design note — why non-destructive (per the SP1 decision):** both grids are stored at a fixed `MAX_STEPS_PER_BAR` (24) width, exactly like the drum `sequencerTracks` steps. `setMeter` does **not** touch them, so switching meter and back never drops steps drawn in a wider meter. The UI renders only `stepsPerBar` cells (`stepCells(meter)`); playback trims via `customRhythmPattern` / `customBassPattern` (`Math.min(grid.length, stepsPerBar)`). `writeStepWindow`/`padStepRow` (boolean-only) stay drum-row only and are not reused here; the setters store the already-24-wide array verbatim.

- [ ] **Step 1: Write the failing test**

Create `src/store/customStepSequencer.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { applyInstantVibeToStore, INSTANT_VIBES } from './instantVibes';
import type { BassStepChoice } from '../audio/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

/** Reset the four new fields to their factory defaults so tests never leak. */
function resetCustomFields(): void {
  useAppStore.setState({
    chordRhythmMode: 'preset',
    bassPatternMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
  });
}

describe('custom step sequencer — store defaults', () => {
  beforeEach(resetCustomFields);

  test('both modes default to preset with silent MAX-width grids', () => {
    const s = useAppStore.getState();
    expect(s.chordRhythmMode).toBe('preset');
    expect(s.bassPatternMode).toBe('preset');
    expect(s.customChordRhythm).toEqual(new Array<boolean>(MAX_STEPS_PER_BAR).fill(false));
    expect(s.customBassPattern).toEqual(new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'));
  });
});

describe('custom step sequencer — setters store verbatim', () => {
  beforeEach(resetCustomFields);

  test('setCustomChordRhythm stores the grid as-is', () => {
    const grid = [...new Array<boolean>(MAX_STEPS_PER_BAR).fill(false)];
    grid[0] = true;
    grid[5] = true;
    useAppStore.getState().setChordRhythmMode('custom');
    useAppStore.getState().setCustomChordRhythm(grid);
    const s = useAppStore.getState();
    expect(s.chordRhythmMode).toBe('custom');
    expect(s.customChordRhythm).toEqual(grid);
    expect(s.customChordRhythm.length).toBe(MAX_STEPS_PER_BAR);
  });

  test('setCustomBassPattern stores the choice grid as-is', () => {
    const choices: BassStepChoice[] = new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest');
    choices[0] = 'root';
    choices[4] = 'fifth';
    choices[12] = 'octave';
    useAppStore.getState().setBassPatternMode('custom');
    useAppStore.getState().setCustomBassPattern(choices);
    const s = useAppStore.getState();
    expect(s.bassPatternMode).toBe('custom');
    expect(s.customBassPattern).toEqual(choices);
  });
});

describe('custom step sequencer — non-destructive across meter change', () => {
  beforeEach(resetCustomFields);

  test('setMeter leaves both grids untouched (no re-window, no trim)', () => {
    const s = useAppStore.getState();
    const chord = [...new Array<boolean>(MAX_STEPS_PER_BAR).fill(false)];
    chord[18] = true; // a step only visible in 12/8 (24 steps), hidden in 4/4
    const bass: BassStepChoice[] = new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest');
    bass[20] = 'seventh';
    s.setCustomChordRhythm(chord);
    s.setCustomBassPattern(bass);

    s.setMeter('4/4');
    let after = useAppStore.getState();
    expect(after.customChordRhythm[18]).toBe(true); // preserved, not trimmed
    expect(after.customBassPattern[20]).toBe('seventh');
    expect(after.customChordRhythm.length).toBe(MAX_STEPS_PER_BAR);

    s.setMeter('12/8');
    after = useAppStore.getState();
    expect(after.customChordRhythm[18]).toBe(true); // still there when widened back
    expect(after.customBassPattern[20]).toBe('seventh');
  });
});

describe('custom step sequencer — instant vibes reset the mode', () => {
  beforeEach(resetCustomFields);

  test('applyInstantVibeToStore returns both modes to preset', () => {
    const s = useAppStore.getState();
    s.setChordRhythmMode('custom');
    s.setBassPatternMode('custom');
    applyInstantVibeToStore(INSTANT_VIBES[0]);
    expect(useAppStore.getState().chordRhythmMode).toBe('preset');
    expect(useAppStore.getState().bassPatternMode).toBe('preset');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/customStepSequencer.test.ts`
Expected: FAIL — `chordRhythmMode`, `setChordRhythmMode`, etc. do not exist on the store.

- [ ] **Step 3: Implement the store changes**

**3a. `src/store/types.ts`** — add to `ChordsSlice` (after `chordRhythmId`):

```ts
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  setChordRhythmMode: (mode: 'preset' | 'custom') => void;
  setCustomChordRhythm: (steps: boolean[]) => void;
```

Add to `BassSlice` (after `bassPatternId`):

```ts
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  setBassPatternMode: (mode: 'preset' | 'custom') => void;
  setCustomBassPattern: (steps: BassStepChoice[]) => void;
```

Add the import (next to the existing `synthPresets` import):

```ts
import type { BassStepChoice } from '../audio/bassPatterns';
```

Add to `PersistedState` (after `chordRhythmId`):

```ts
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
```

Add after `bassPatternId`:

```ts
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
```

**3b. `src/store/chordsSlice.ts`** — add the import (the file has no meter import yet):

```ts
import { MAX_STEPS_PER_BAR } from '../utils/meter';
```

Add fields + setters to the slice object (after `chordRhythmId` / `setChordRhythmId`):

```ts
    chordRhythmMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),

    setChordRhythmMode: (chordRhythmMode) => set({ chordRhythmMode }),
    // Stored at a fixed MAX width (non-destructive, drum-row style): the UI
    // toggles one step of the already-wide array, so no per-edit normalization
    // is needed and setMeter never rewrites it.
    setCustomChordRhythm: (customChordRhythm) => set({ customChordRhythm }),
```

**3c. `src/store/bassSlice.ts`** — extend the existing `bassPatterns` import to a combined value+type import (avoids `import/no-duplicates`) and add the meter import:

```ts
import { BASS_PATTERNS, type BassStepChoice } from '../audio/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
```

Add fields + setters (after `bassPatternId` / `setBassPatternId`):

```ts
    bassPatternMode: 'preset',
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),

    setBassPatternMode: (bassPatternMode) => set({ bassPatternMode }),
    setCustomBassPattern: (customBassPattern) => set({ customBassPattern }),
```

**3d. `src/store/store.ts`** — in `partializeAppState`, after `chordRhythmId: state.chordRhythmId,` add:

```ts
    chordRhythmMode: state.chordRhythmMode,
    customChordRhythm: state.customChordRhythm,
```

After `bassPatternId: state.bassPatternId,` add:

```ts
    bassPatternMode: state.bassPatternMode,
    customBassPattern: state.customBassPattern,
```

In `sanitizePersistedState`, extend the array type-check loop to:

```ts
  for (const key of ['chords', 'sequencerTracks', 'customSynthPresets', 'customChordProgressions', 'customChordRhythm', 'customBassPattern']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
```

And add a mode union check after the existing string loop:

```ts
  for (const key of ['chordRhythmMode', 'bassPatternMode']) {
    const v = sanitized[key];
    if (v !== 'preset' && v !== 'custom') delete sanitized[key];
  }
```

No persist `version` bump: the fields are additive and absent from older payloads, so the `merge` spread falls back to the freshly-built `currentState` defaults (the same mechanism the existing sanitizer relies on for absent keys).

**3e. `src/store/instantVibes.ts`** — in `applyInstantVibeToStore`, after `store.setChordRhythmId(vibe.chordRhythmId);` add:

```ts
  store.setChordRhythmMode('preset');
```

After `store.setBassPatternId(vibe.bassPatternId);` add:

```ts
  store.setBassPatternMode('preset');
```

This covers both vibe loading and vibe reroll — `rerollVibe` in `InstantVibesBar.tsx` funnels through `applyInstantVibeToStore`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/customStepSequencer.test.ts`
Expected: PASS (6 tests). Also run `bun test src/store/store.test.ts src/store/transportSlice.test.ts src/store/instantVibes.test.ts` to confirm the sanitize/partialize changes did not regress existing store behavior.

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/chordsSlice.ts src/store/bassSlice.ts src/store/store.ts src/store/instantVibes.ts src/store/customStepSequencer.test.ts
git commit -m "feat(store): persist custom chord/bass grids at fixed MAX width, reset mode on vibe

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: `StepRow<T>` UI primitive

**Files:**
- Create: `src/components/ui/StepRow.tsx`
- Test: `src/components/ui/StepRow.test.tsx` (new)

**Interfaces:**
- Consumes: `StepCell` and `stepCells` from `../sequencerGrid` (components → components); no audio/store imports.
- Produces:
  - `interface StepRowProps<T> { cells: StepCell[]; steps: readonly T[]; currentStep: number; isPlaying: boolean; color: string; isActive: (value: T) => boolean; getLabel?: (value: T) => React.ReactNode; onStepClick: (index: number) => void }`
  - `function StepRow<T>(props: StepRowProps<T>): JSX.Element` — renders one `button` per `cell`; active steps wear `color` + `shadow-md shadow-primary/20 scale-[0.96]`, inactive steps wear the base-100/base-200 alt-beat-group classes, and the playing step adds `ring-2 ring-primary brightness-125` (exactly the TrackRow step-button convention). When `getLabel` is supplied, active steps render the label centred, inheriting `currentColor` (so the caller's `color` prop must carry both the fill and the `-content` text token, e.g. `bg-module-bass text-module-bass-content`).

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/StepRow.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { StepRow } from './StepRow';
import { stepCells } from '../sequencerGrid';
import { getMeter } from '../../utils/meter';
import type { BassStepChoice } from '../../audio/bassPatterns';

describe('StepRow — boolean grid', () => {
  const cells = stepCells(getMeter('4/4'));
  const steps = [
    true, false, false, false,
    true, false, false, false,
    true, false, false, false,
    true, false, false, false,
  ];

  test('renders one button per cell', () => {
    const html = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={-1}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(html.split('<button').length - 1).toBe(16);
  });

  test('active steps wear the caller colour; inactive steps wear base tokens', () => {
    const html = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={-1}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(html).toContain('bg-module-chord text-module-chord-content');
    expect(html).toContain('bg-base-200');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('#');
  });

  test('the playing step carries the playhead ring, gated by isPlaying', () => {
    const playing = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={0}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(playing).toContain('ring-2 ring-primary');
    const stopped = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={0}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(stopped).not.toContain('ring-2 ring-primary');
  });
});

describe('StepRow — bass choices with labels', () => {
  const cells = stepCells(getMeter('4/4'));
  const choices: BassStepChoice[] = [
    'root', 'rest', 'rest', 'rest',
    'fifth', 'rest', 'rest', 'rest',
    'seventh', 'rest', 'rest', 'rest',
    'octave', 'rest', 'rest', 'rest',
  ];
  const label = (v: BassStepChoice): string =>
    v === 'root' ? 'R' : v === 'third' ? '3' : v === 'fifth' ? '5' : v === 'seventh' ? '7' : v === 'octave' ? '8' : '';

  test('labels render on active steps', () => {
    const html = renderToString(
      <StepRow<BassStepChoice>
        cells={cells}
        steps={choices}
        currentStep={-1}
        isPlaying={false}
        color="bg-module-bass text-module-bass-content"
        isActive={(v) => v !== 'rest'}
        getLabel={label}
        onStepClick={() => {}}
      />,
    );
    expect(html).toContain('>R<');
    expect(html).toContain('>5<');
    expect(html).toContain('>7<');
    expect(html).toContain('>8<');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/ui/StepRow.test.tsx`
Expected: FAIL — `./StepRow` does not resolve.

- [ ] **Step 3: Implement the primitive**

Create `src/components/ui/StepRow.tsx`:

```tsx
import React from "react";
import type { StepCell } from "../sequencerGrid";

export interface StepRowProps<T> {
  /** Machine-computed cell metadata (index, beat grouping) from stepCells(). */
  cells: StepCell[];
  /** One value per visible step; length should match cells.length. */
  steps: readonly T[];
  /** The currently sounding step index (a step that is not playing is ignored). */
  currentStep: number;
  /** Whether the owning player is running (gates the playhead ring). */
  isPlaying: boolean;
  /**
   * Classes applied to ACTIVE steps. The caller owns the module colour here —
   * chord passes `bg-module-chord text-module-chord-content`, bass passes
   * `bg-module-bass text-module-bass-content` — so the primitive stays
   * theme-agnostic and never names a colour itself.
   */
  color: string;
  /** Whether a step value counts as "on" (filled). */
  isActive: (value: T) => boolean;
  /** Optional short label for active steps (e.g. bass tone letters). */
  getLabel?: (value: T) => React.ReactNode;
  /** Fired on click with the 0-based step index. The parent cycles the value. */
  onStepClick: (index: number) => void;
}

/**
 * A theme-agnostic step grid row. The step-button class conventions mirror
 * TrackRow (daisyUI role classes only; active steps wear the caller's module
 * colour), the only difference being the per-step VALUE is generic — so a
 * boolean hit grid and a chord-tone-choice grid share one implementation.
 */
export function StepRow<T>({
  cells,
  steps,
  currentStep,
  isPlaying,
  color,
  isActive,
  getLabel,
  onStepClick,
}: StepRowProps<T>) {
  return (
    <div className="flex items-center gap-1.5">
      {cells.map((cell) => {
        const value = steps[cell.index];
        const active = value !== undefined && isActive(value);
        const isCurrent = isPlaying && currentStep === cell.index;
        return (
          <button
            key={cell.index}
            onClick={() => onStepClick(cell.index)}
            className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
              active
                ? `${color} shadow-md shadow-primary/20 scale-[0.96]`
                : cell.isAltBeatGroup
                  ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                  : "bg-base-200 hover:bg-base-300 border border-base-300/40"
            } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
          >
            {active && getLabel ? (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none pointer-events-none select-none">
                {getLabel(value)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/ui/StepRow.test.tsx`
Expected: PASS (5 tests). Also run `bun run check:theme` to confirm the new classes pass the token guard (they are all role tokens; `scale-[0.96]` is the same arbitrary value `TrackRow.tsx` already ships).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/StepRow.tsx src/components/ui/StepRow.test.tsx
git commit -m "feat(ui): add reusable generic StepRow primitive

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Playback integration in `useChordPlayback.ts`

**Files:**
- Modify: `src/components/chord/useChordPlayback.ts`
- Modify: `src/components/chord/useChordPlayback.test.ts`
- Test: run the existing + new tests in that file

**Interfaces:**
- Consumes: `customRhythmPattern` from `../../audio/rhythmPatterns` (Task 1); `customBassPattern` + `type BassStepChoice` from `../../audio/bassPatterns` (Task 2); `getMeter` + `type MeterId` from `../../utils/meter`; `resolveRhythmPattern` / `resolveBassPattern` (already module-private in this file).
- Produces:
  - `export function resolvePlaybackRhythmPattern(mode: 'preset' | 'custom', rhythmId: string, customGrid: readonly boolean[], stepsPerBar: number, meterId: MeterId): RhythmPattern`
  - `export function resolvePlaybackBassPattern(mode: 'preset' | 'custom', patternId: string, customGrid: readonly BassStepChoice[], stepsPerBar: number, meterId: MeterId): BassPattern`
  - `useChordPlayback()` additionally returns `currentStep: number` and `isPlaying: boolean` (isPlaying was already computed internally; currentStep is the clock `step % stepsPerBar`).

- [ ] **Step 1: Write the failing test**

Append to `src/components/chord/useChordPlayback.test.ts` (the file already imports `adaptRhythmPattern`, `adaptBassPattern`, `isFullHoldRhythm`, `isFullHoldBass` from `./useChordPlayback`):

```ts
import {
  resolvePlaybackBassPattern,
  resolvePlaybackRhythmPattern,
} from './useChordPlayback';
import type { BassStepChoice } from '../../audio/bassPatterns';

describe('playback pattern resolution honours the mode', () => {
  test('preset mode resolves the library pattern by id', () => {
    const pattern = resolvePlaybackRhythmPattern('preset', 'offbeatStabs', [true], 16, '4/4');
    expect(pattern.id).toBe('offbeatStabs');
    const bass = resolvePlaybackBassPattern('preset', 'classic-walk', ['root'], 16, '4/4');
    expect(bass.id).toBe('classic-walk');
  });

  test('custom mode synthesizes a grid into a custom pattern', () => {
    const grid = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const pattern = resolvePlaybackRhythmPattern('custom', 'offbeatStabs', grid, 16, '4/4');
    expect(pattern.id).toBe('custom');
    expect(pattern.hits).toHaveLength(4);
  });

  test('bass custom mode maps choices to steps with no approach tokens', () => {
    const choices: BassStepChoice[] = [
      'root', 'rest', 'third', 'rest', 'fifth', 'rest', 'seventh', 'rest',
      'octave', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest',
    ];
    const pattern = resolvePlaybackBassPattern('custom', 'classic-walk', choices, 16, '4/4');
    expect(pattern.id).toBe('custom');
    expect(pattern.steps.map((s) => s.note)).toEqual(['root', 'third', 'fifth', 'seventh', 'root']);
  });
});

describe('custom patterns flow through the playback pipeline', () => {
  test('a custom rhythm pattern is never a full-hold and adapts to other meters', () => {
    const grid = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const custom = resolvePlaybackRhythmPattern('custom', 'sustained', grid, 16, '4/4');
    expect(isFullHoldRhythm(custom, 16)).toBe(false);
    const adapted = adaptRhythmPattern(custom, 24);
    expect(adapted.hits.map((h) => h.step)).toEqual([0, 4, 8, 12, 16, 20]);
  });

  test('a custom bass pattern is never a full-hold and is returned unchanged in 4/4', () => {
    const choices: BassStepChoice[] = ['root', ...new Array<BassStepChoice>(15).fill('rest')];
    const custom = resolvePlaybackBassPattern('custom', 'whole-note-root', choices, 16, '4/4');
    expect(isFullHoldBass(custom, 16)).toBe(false);
    expect(adaptBassPattern(custom, 16)).toBe(custom);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test -t "playback pattern resolution|custom patterns flow" src/components/chord/useChordPlayback.test.ts`
Expected: FAIL — `resolvePlaybackRhythmPattern` / `resolvePlaybackBassPattern` are not exported.

- [ ] **Step 3: Implement**

**3a. Imports** — in `src/components/chord/useChordPlayback.ts`, extend the `rhythmPatterns` import:

```ts
import {
  RHYTHM_PATTERNS,
  RhythmPattern,
  customRhythmPattern,
  feelToHoldScale,
  fullHoldDuration,
} from "../../audio/rhythmPatterns";
```

Extend the `bassPatterns` import:

```ts
import {
  BASS_PATTERNS,
  BassPattern,
  customBassPattern,
  isApproachToken,
  resolveBassSteps,
  type BassStepChoice,
} from "../../audio/bassPatterns";
```

Extend the meter import:

```ts
import { getMeter, type MeterId } from "../../utils/meter";
```

**3b. Resolution helpers** — add after `resolveBassPattern` (module-private, around line 141):

```ts
/**
 * Mode-aware pattern resolution for playback. Custom grids are synthesized at
 * the ACTIVE meter, so the returned pattern is stamped with `meterId` and
 * `adaptRhythmPattern`/`adaptBassPattern` return it unchanged there.
 */
export function resolvePlaybackRhythmPattern(
  mode: 'preset' | 'custom',
  rhythmId: string,
  customGrid: readonly boolean[],
  stepsPerBar: number,
  meterId: MeterId,
): RhythmPattern {
  return mode === 'custom'
    ? customRhythmPattern(customGrid, stepsPerBar, meterId)
    : resolveRhythmPattern(rhythmId);
}

export function resolvePlaybackBassPattern(
  mode: 'preset' | 'custom',
  patternId: string,
  customGrid: readonly BassStepChoice[],
  stepsPerBar: number,
  meterId: MeterId,
): BassPattern {
  return mode === 'custom'
    ? customBassPattern(customGrid, stepsPerBar, meterId)
    : resolveBassPattern(patternId);
}
```

**3c. `startChordPlan`** — replace the two pattern lines. Current chord line:

```ts
    const pattern = adaptRhythmPattern(resolveRhythmPattern(s.chordRhythmId), stepsPerBar);
```

becomes:

```ts
    const pattern = adaptRhythmPattern(
      resolvePlaybackRhythmPattern(
        s.chordRhythmMode,
        s.chordRhythmId,
        s.customChordRhythm,
        stepsPerBar,
        getMeter(s.meterId).id,
      ),
      stepsPerBar,
    );
```

Current bass line:

```ts
    const pattern = adaptBassPattern(resolveBassPattern(s.bassPatternId), stepsPerBar);
```

becomes:

```ts
    const pattern = adaptBassPattern(
      resolvePlaybackBassPattern(
        s.bassPatternMode,
        s.bassPatternId,
        s.customBassPattern,
        stepsPerBar,
        getMeter(s.meterId).id,
      ),
      stepsPerBar,
    );
```

**3d. Expose `currentStep` / `isPlaying`** — in the hook body add the state (next to the existing `playingIndex` state):

```ts
  const [currentStep, setCurrentStep] = useState<number>(0);
```

In the store-subscription stop handler (`next === 'stopped'` branch), next to `setPlayingIndex(null);` add:

```ts
            setCurrentStep(0);
```

In the clock effect's `!isPlaying || chords.length === 0` branch, next to `setPlayingIndex(null);` add:

```ts
      setCurrentStep(0);
```

In the clock subscription, right after `const stepsPerBar = activeStepsPerBar();` add:

```ts
      setCurrentStep(step % stepsPerBar);
```

Update the return statement:

```ts
  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId, currentStep, isPlaying };
```

(`isPlaying` is already computed in the hook as `playerState !== 'stopped'`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/chord/useChordPlayback.test.ts`
Expected: PASS — existing scheduler tests plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/components/chord/useChordPlayback.ts src/components/chord/useChordPlayback.test.ts
git commit -m "feat(chords): route custom chord/bass grids through playback and expose the step playhead

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `ChordView` UI — "Custom" options + `StepRow` grids

**Files:**
- Modify: `src/components/ChordView.tsx`
- Modify: `src/components/ChordView.test.tsx`
- Test: run the ChordView test file

**Interfaces:**
- Consumes: `StepRow` from `./ui/StepRow`; `stepCells` from `./sequencerGrid`; `customRhythmPattern` from `../audio/rhythmPatterns`; `customBassPattern` + `type BassStepChoice` from `../audio/bassPatterns`; the store fields/setters from Task 3; `currentStep`/`isPlaying` from Task 5.
- Produces (exported for the repo's pure-logic test convention):
  - `export function nextBassStepChoice(current: BassStepChoice): BassStepChoice` — cycles `rest → root → third → fifth → seventh → octave → rest`.
  - `export function bassStepLabel(choice: BassStepChoice): string` — `'R' | '3' | '5' | '7' | '8' | ''`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ChordView.test.tsx`:

```tsx
import { nextBassStepChoice, bassStepLabel } from './ChordView';
import type { BassStepChoice } from '../audio/bassPatterns';

describe('ChordView custom step grid helpers', () => {
  test('bass steps cycle rest → root → third → fifth → seventh → octave → rest', () => {
    let value: BassStepChoice = 'rest';
    const seen: BassStepChoice[] = [value];
    for (let i = 0; i < 6; i++) {
      value = nextBassStepChoice(value);
      seen.push(value);
    }
    expect(seen).toEqual(['rest', 'root', 'third', 'fifth', 'seventh', 'octave', 'rest']);
  });

  test('bass step labels abbreviate each tone', () => {
    expect(bassStepLabel('root')).toBe('R');
    expect(bassStepLabel('third')).toBe('3');
    expect(bassStepLabel('fifth')).toBe('5');
    expect(bassStepLabel('seventh')).toBe('7');
    expect(bassStepLabel('octave')).toBe('8');
    expect(bassStepLabel('rest')).toBe('');
  });
});

describe('ChordView custom step grids', () => {
  test('the rhythm dropdown offers Custom; the grid renders only in custom mode', () => {
    useAppStore.getState().setChordRhythmMode('preset');
    const presetHtml = renderToString(<ChordView />);
    expect(presetHtml).toContain('>Custom…<');
    expect(presetHtml).not.toContain('bg-module-chord text-module-chord-content');

    useAppStore.getState().setChordRhythmMode('custom');
    useAppStore.getState().setCustomChordRhythm([true, ...new Array(15).fill(false)]);
    const customHtml = renderToString(<ChordView />);
    // The active step 0 of the chord grid wears the module fill.
    expect(customHtml).toContain('bg-module-chord text-module-chord-content');
    // The chord grid has no per-step labels, so no tone letter can appear.
    expect(customHtml).not.toContain('>R<');

    useAppStore.getState().setChordRhythmMode('preset');
    useAppStore.getState().setCustomChordRhythm(new Array(16).fill(false));
  });

  test('the bass dropdown offers Custom; the bass grid renders in custom mode', () => {
    useAppStore.getState().setBassPatternMode('custom');
    useAppStore.getState().setCustomBassPattern(['root', ...new Array<BassStepChoice>(15).fill('rest')]);
    const customHtml = renderToString(<ChordView />);
    // The active step 0 of the bass grid wears the module fill and its label.
    expect(customHtml).toContain('bg-module-bass text-module-bass-content');
    expect(customHtml).toContain('>R<');
    useAppStore.getState().setBassPatternMode('preset');
    useAppStore.getState().setCustomBassPattern(new Array<BassStepChoice>(16).fill('rest'));
  });
});
```

Note: `useAppStore` is already imported at the top of `ChordView.test.tsx`; `renderToString` is already imported; both dropdowns always render the `Custom…` option, so the preset-mode assertion `not.toContain('bg-module-chord text-module-chord-content')` proves the grid itself is conditional.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test -t "ChordView custom" src/components/ChordView.test.tsx`
Expected: FAIL — `nextBassStepChoice` / `bassStepLabel` are not exported, and no Custom option renders.

- [ ] **Step 3: Implement**

**3a. Imports** — in `src/components/ChordView.tsx`, extend the rhythmPatterns import:

```ts
import {
  RHYTHM_PATTERNS,
  RHYTHM_STYLE_GROUPS,
  customRhythmPattern,
} from "../audio/rhythmPatterns";
```

Extend the bassPatterns import. The function is aliased because the store selector for the grid is ALSO named `customBassPattern` — an unaliased import would shadow the function inside the bass-preview memo:

```ts
import {
  BASS_PATTERNS,
  BASS_STYLE_GROUPS,
  customBassPattern as buildCustomBassPattern,
  type BassStepChoice,
} from "../audio/bassPatterns";
```

Add imports (near the other `./ui/` and `./sequencerGrid` imports):

```ts
import { StepRow } from "./ui/StepRow";
import { stepCells } from "./sequencerGrid";
```

**3b. Exported helpers** — add at module scope (next to `shouldClearReharmonizeIndicator`):

```ts
const BASS_STEP_CYCLE: BassStepChoice[] = ['rest', 'root', 'third', 'fifth', 'seventh', 'octave'];

/**
 * The next bass grid value for a click. Exported so the pure-logic tests can
 * pin the full cycle without a DOM.
 */
export function nextBassStepChoice(current: BassStepChoice): BassStepChoice {
  const idx = BASS_STEP_CYCLE.indexOf(current);
  return BASS_STEP_CYCLE[(idx + 1) % BASS_STEP_CYCLE.length];
}

/**
 * The short label shown on an active bass grid step. Exported for the same
 * reason as nextBassStepChoice.
 */
export function bassStepLabel(choice: BassStepChoice): string {
  switch (choice) {
    case 'root': return 'R';
    case 'third': return '3';
    case 'fifth': return '5';
    case 'seventh': return '7';
    case 'octave': return '8';
    case 'rest': return '';
  }
}
```

**3c. Store selectors** — add to the component body (next to the existing `rhythmId`/`setChordRhythmId` and `bassPatternId`/`setBassPatternId` selectors):

```ts
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);
  const setChordRhythmMode = useAppStore((s) => s.setChordRhythmMode);
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const setCustomChordRhythm = useAppStore((s) => s.setCustomChordRhythm);
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);
  const setBassPatternMode = useAppStore((s) => s.setBassPatternMode);
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const setCustomBassPattern = useAppStore((s) => s.setCustomBassPattern);
```

Update the `useChordPlayback` destructure:

```ts
  const { playChordWithRhythm, playBassWithPattern, playingIndex, activeChordId, setActiveChordId, currentStep, isPlaying } = useChordPlayback();
```

**3d. Grid cells memo** — add near the other memos (after `rhythmPattern`):

```ts
  const chordCells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);
```

**3e. Mode-aware preview memos** — replace the existing `rhythmPattern` memo:

```ts
  const rhythmPattern = useMemo(() => {
    if (chordRhythmMode === 'custom') {
      return customRhythmPattern(
        customChordRhythm,
        getMeter(meterId).stepsPerBar,
        getMeter(meterId).id,
      );
    }
    return RHYTHM_PATTERNS.find((p) => p.id === rhythmId) ?? RHYTHM_PATTERNS[0];
  }, [chordRhythmMode, customChordRhythm, rhythmId, meterId]);
```

Replace the plain `bassPattern` const:

```ts
  const bassPattern =
    BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];
```

with a memo:

```ts
  const bassPattern = useMemo(() => {
    if (bassPatternMode === 'custom') {
      return buildCustomBassPattern(
        customBassPattern,
        getMeter(meterId).stepsPerBar,
        getMeter(meterId).id,
      );
    }
    return BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];
  }, [bassPatternMode, customBassPattern, bassPatternId, meterId]);
```

These keep the hold-to-preview buttons looping the CUSTOM grid when the mode is custom.

**3f. Chord rhythm dropdown + grid** — replace the select's `value`/`onChange` and add the grid inside the same `<div>` (the block currently at lines ~754-793, the `id="select-chord-rhythm-pattern"` select):

```tsx
            <div>
              <label className={FIELD_LABEL}>Chord Pattern</label>
              <div className="flex items-center gap-1.5">
                <select
                  id="select-chord-rhythm-pattern"
                  value={chordRhythmMode === 'custom' ? 'custom' : rhythmId}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setChordRhythmMode('custom');
                    } else {
                      setChordRhythmMode('preset');
                      setChordRhythmId(e.target.value);
                    }
                  }}
                  className={FIELD_SELECT}
                  title="Rhythm pattern for chord playback"
                >
                  <option value="custom">Custom…</option>
                  {RHYTHM_STYLE_GROUPS.map((group) => (
                    <optgroup key={group.style} label={group.style}>
                      {group.patterns.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          title={patternMeterTitle(p.name, p.meter, meterId)}
                        >
                          {patternOptionLabel(p.name, p.meter, meterId)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  id="btn-preview-chord-pattern"
                  type="button"
                  onMouseDown={handleChordPatternPreviewMouseDown}
                  onMouseUp={handleChordPatternPreviewMouseUp}
                  onMouseLeave={handleChordPatternPreviewMouseUp}
                  onTouchStart={handleChordPatternPreviewMouseDown}
                  onTouchEnd={handleChordPatternPreviewMouseUp}
                  className="btn btn-xs btn-ghost btn-square text-module-chord select-none"
                  title="Hold to Preview Chord Pattern Loop"
                >
                  <Volume2 className="w-3 h-3" />
                </button>
              </div>
              {chordRhythmMode === 'custom' && (
                <div className="mt-2 overflow-x-auto">
                  <StepRow<boolean>
                    cells={chordCells}
                    steps={customChordRhythm}
                    currentStep={currentStep}
                    isPlaying={isPlaying}
                    color="bg-module-chord text-module-chord-content"
                    isActive={(v) => v === true}
                    onStepClick={(i) =>
                      setCustomChordRhythm(
                        customChordRhythm.map((v, idx) => (idx === i ? !v : v)),
                      )
                    }
                  />
                </div>
              )}
            </div>
```

**3g. Bass dropdown + grid** — same treatment for the `id="select-bass-rhythm-pattern"` select (currently at lines ~1131-1169):

```tsx
          <div>
            <label className={FIELD_LABEL}>Bass Pattern</label>
            <div className="flex items-center gap-1.5">
              <select
                id="select-bass-rhythm-pattern"
                value={bassPatternMode === 'custom' ? 'custom' : bassPatternId}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setBassPatternMode('custom');
                  } else {
                    setBassPatternMode('preset');
                    setBassPatternId(e.target.value);
                  }
                }}
                className={FIELD_SELECT}
                title="Bass pattern (16th-note grid, deterministic)"
              >
                <option value="custom">Custom…</option>
                {BASS_STYLE_GROUPS.map((group) => (
                  <optgroup key={group.style} label={group.style}>
                    {group.patterns.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        title={patternMeterTitle(p.name, p.meter, meterId)}
                      >
                        {patternOptionLabel(p.name, p.meter, meterId)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                id="btn-preview-bass-pattern"
                type="button"
                onMouseDown={handleBassPatternPreviewMouseDown}
                onMouseUp={handleBassPatternPreviewMouseUp}
                onMouseLeave={handleBassPatternPreviewMouseUp}
                onTouchStart={handleBassPatternPreviewMouseDown}
                onTouchEnd={handleBassPatternPreviewMouseUp}
                className="btn btn-xs btn-ghost btn-square text-module-bass select-none"
                title="Hold to Preview Bass Pattern Loop"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
            {bassPatternMode === 'custom' && (
              <div className="mt-2 overflow-x-auto">
                <StepRow<BassStepChoice>
                  cells={chordCells}
                  steps={customBassPattern}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                  color="bg-module-bass text-module-bass-content"
                  isActive={(v) => v !== 'rest'}
                  getLabel={bassStepLabel}
                  onStepClick={(i) =>
                    setCustomBassPattern(
                      customBassPattern.map((v, idx) =>
                        idx === i ? nextBassStepChoice(v) : v,
                      ),
                    )
                  }
                />
              </div>
            )}
          </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/ChordView.test.tsx`
Expected: PASS — existing ChordView tests plus the 4 new ones. Then run `bun run check:theme` (new class strings are all role tokens) and `bun run eslint` (import layering).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChordView.tsx src/components/ChordView.test.tsx
git commit -m "feat(chords): add Custom chord/bass step-sequencer grids to ChordView

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Final verification gate

**Files:** none (no code).

- [ ] **Step 1: Run the full gate**

Run: `bun run verify`
Expected: PASS (test + lint + check:keys + check:drums + build). This runs the theme-token guard too (`check:theme` is enforced under `bun test`).

- [ ] **Step 2: Run the import-layering lint**

Run: `bun run eslint`
Expected: PASS — confirm no task introduced a `no-restricted-imports` violation (audio never imports store/components; store never imports components; ChordView/useChordPlayback/StepRow import only allowed layers).

- [ ] **Step 3: Commit any residuals**

```bash
git add -A
git commit -m "chore: SP1 verification clean

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

(If the working tree is already clean after Task 6, skip this commit.)

---

## Self-review checklist

- **Spec coverage:** StepRow primitive (Task 4); chord custom boolean grid, fixed `MAX_STEPS_PER_BAR` width (Tasks 1, 3); bass custom grid with `BassStepChoice` and no scale-degrees (Task 2); additive "Custom" dropdown option + grids (Task 6); `octave → root + octaveShift`, no new bass resolver (Task 2 + resolution tests); non-destructive storage; `setMeter` leaves grids untouched (Task 3); vibe apply resets mode (Task 3); playback reuses `adaptRhythmPattern`/`adaptBassPattern` + builders unchanged (Task 5). Drum `TrackRow` untouched; lead melody / region / arrange not planned.
- **Placeholder scan:** every step has concrete code/commands; no TBD/TODO/"similar to Task N".
- **Type consistency:** `BassStepChoice`, `customRhythmPattern`, `customBassPattern`, `StepRowProps<T>`, `nextBassStepChoice`, `bassStepLabel`, `resolvePlaybackRhythmPattern`, `resolvePlaybackBassPattern`, and the store field/setter names (`chordRhythmMode`, `customChordRhythm`, `setChordRhythmMode`, `setCustomChordRhythm`, `bassPatternMode`, `customBassPattern`, `setBassPatternMode`, `setCustomBassPattern`) are defined in exactly one task and referenced verbatim in the tasks that consume them.
