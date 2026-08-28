# React Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the wasted work on Solna's three hot paths — the store→engine bridge, the per-beat/per-16th React re-render cascade, and the per-frame analyser loops — and split the 498 kB single-chunk bundle. No user-visible behaviour changes except the VU meter, which becomes explicitly 11-state quantized.

**Architecture:** Single-page audio workstation. Three enforced layers: `src/audio/` (raw Web Audio DSP + the `audioEngine` singleton), `src/store/` (one Zustand store of slices, bridged to the engine by `src/store/engineSync.ts`), `src/components/` (dumb views). All four tab views stay mounted at once; `activeTab` toggles `block`/`hidden` in `App.tsx` so audio never stops.

**Tech Stack:** Bun (test runner + scripts), Vite 6, React 18.3, Zustand 5.0.15 with `persist` + `subscribeWithSelector`, Tailwind CSS 4 + daisyUI 5 (CSS-first, no config file), `tonal` for theory only, `@dnd-kit` for chord reordering, `lucide-react` for icons.

**Spec:** docs/superpowers/specs/2026-08-28-react-performance.md

## Global Constraints

These are verbatim hard rules from `CLAUDE.md`. Violating any of them fails the task.

- **`bun run verify` is the completion gate** — `bun test && bun run lint && bun run check:keys && bun run check:drums && bun run build`. Run it before claiming work is done. It does **not** include `bun run eslint`; run that separately when you touch imports.
- **Three layers, enforced by eslint `no-restricted-imports`:**
  1. `src/audio/` — never imports `store/` or `components/`.
  2. `src/store/` — never imports `components/`.
  3. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`, `TransportBar.tsx` and `ui/AmbientBackdrop.tsx` (read-only analyser consumers) and test files are exempt — routing their per-frame analyser reads through the store would mean a store write on every animation frame and a re-render of every subscriber.
- **Never call engine setters from a component** — add the state to a slice and wire it in `engineSync.ts`.
- **Storage access is always guarded.** `localStorage` can *throw*, not just return null.
- **Theming — the hard rule.** Two daisyUI themes declared CSS-first in `src/index.css`. **There is no `tailwind.config.*` and none may be added.** Components name **roles**, never colours. `scripts/themeTokenGuard.ts` fails the build on: raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`/etc., the `dark:` variant, `rgb()`/`rgba()` literals, and silently-dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and the suite has hygiene + shrink tests that make re-populating it fail — **fix the code, not the allowlist**.
- **Testing conventions.** Tests are `bun:test` and mostly **pure-logic**: components export their testable helpers and the `.test.ts(x)` file imports those rather than rendering React. There is no DOM/testing-library setup — keep new tests in that style. (SSR-string rendering via `react-dom/server` exists in two preset-library tests, but **there is no way to count re-renders**. No step in this plan may be validated by a render-count test.)
- **Traps recorded in the spec — don't "fix" these:** Instant Vibes ids drift from labels (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden"); ids are persisted in project files. Tap Tempo and stereo VU are unbuilt, not broken.
- **Out of scope for this whole plan (from the spec §3):** do not convert the 131 atomic `useAppStore` selectors to object selectors + `useShallow`; do not "fix" `AmbientBackdrop`'s non-scaling by `devicePixelRatio`; do not make the four views conditionally mounted in `App.tsx`; do not raise `usePlayheadSync` from per-beat to per-16th; do not touch `AudioVisualizer`'s buffer reuse, palette cache, `paused` gate or imperative indicator.

**Environment note:** this worktree has **no `node_modules`**. Run `bun install` once before Task 1.

---

### Task 0: Install dependencies in the worktree

**Files:** none (installs only)

**Interfaces:**
- Consumes: `package.json`, `bun.lock`
- Produces: a populated `node_modules/` so `bun run verify` can run

**Steps:**

- [ ] Install:
  ```bash
  bun install
  ```
- [ ] Confirm the baseline is green before changing anything:
  ```bash
  bun run verify
  ```
- [ ] Record the baseline build output line for `dist/assets/index-*.js` (expected ≈ `498.10 kB │ gzip: 145.09 kB`) — Task 8 compares against it.
- [ ] No commit (nothing changed).

---

### Task 1: Replace the JSON.stringify selectors in engineSync with `equalityFn`

**Files:**
- `src/store/engineSync.ts` — line 7 (`import type { FilterType }`), lines 65-74 (drum-filter subscription), lines 76-95 (the comment block + effects subscription), lines 97-112 (the synth-params loop)

**Interfaces:**
- Consumes: `useAppStore.subscribe<U>(selector: (s: AppStore) => U, listener: (u: U, prevU: U) => void, options?: { equalityFn?: (a: U, b: U) => boolean; fireImmediately?: boolean })` — verified in `node_modules/zustand/middleware/subscribeWithSelector.d.ts`
- Consumes: `shallow<T>(valueA: T, valueB: T): boolean` from `zustand/shallow` (re-export of `zustand/vanilla/shallow`)
- Consumes: `audioEngine.updateEffects(effects: MasterEffects)`, `audioEngine.updateSynthParams(params: SynthParams, source: 'synth' | 'chord' | 'bass')`, `audioEngine.setDrumFilter(cutoff: number, resonance: number, type: FilterType)`
- Produces: no new exports; `startEngineSync(): Stop` keeps its signature

**Design decision to state in the commit body:** the drum-filter subscription becomes **one identity selector over a small derived object** compared with `shallow`, not three separate primitive subscriptions. Three primitive subscriptions would call `setDrumFilter` three times whenever a preset changes all three values in one `setState`, and each would have to re-read the other two from `getState()`. One derived object costs a single 3-field allocation per store write, reads all three from the same snapshot, and matches the pattern the effects/synth subscriptions now use.

**Steps:**

- [ ] Verify `zustand/shallow` resolves in this install before writing any code:
  ```bash
  bun -e "import { shallow } from 'zustand/shallow'; console.log(typeof shallow, shallow({a:1},{a:1}), shallow({a:1},{a:2}))"
  ```
  Expect `function true false`. If (and only if) this fails, create `src/store/shallowEqual.ts` with a `shallowEqual<T extends object>(a: T, b: T): boolean` plus `src/store/shallowEqual.test.ts` covering equal objects, one differing value, differing key counts, and identity, and use that everywhere `shallow` appears below.

- [ ] Add the `shallow` import at the top of `src/store/engineSync.ts`, immediately after the `react` import:
  ```ts
  import { useEffect } from 'react';
  import { shallow } from 'zustand/shallow';
  import { audioEngine } from '../audio/engine';
  ```

- [ ] Replace the drum-filter subscription. Find this block:
  ```ts
  subs.push(
    useAppStore.subscribe(
      (s) => `${s.drumFilterCutoff}|${s.drumFilterResonance}|${s.drumFilterType}`,
      (key) => {
        const [cutoff, resonance, type] = key.split('|');
        audioEngine.setDrumFilter(parseFloat(cutoff), parseFloat(resonance), type as FilterType);
      },
      { fireImmediately: true },
    ),
  );
  ```
  Replace it with:
  ```ts
  subs.push(
    useAppStore.subscribe(
      (s) => ({
        cutoff: s.drumFilterCutoff,
        resonance: s.drumFilterResonance,
        type: s.drumFilterType,
      }),
      ({ cutoff, resonance, type }) => audioEngine.setDrumFilter(cutoff, resonance, type),
      { equalityFn: shallow, fireImmediately: true },
    ),
  );
  ```

- [ ] Update the comment two lines above that subscription so it stops claiming a primitive encoding. Replace:
  ```ts
  // sequencer slice: kit + drum-bus filter (encoded as one primitive so the
  // subscription fires only when a filter value actually changes)
  ```
  with:
  ```ts
  // sequencer slice: kit + drum-bus filter. The filter is watched as one
  // derived object compared with `shallow`, so the subscription fires once
  // when any of the three values actually changes — and the listener gets all
  // three from the same snapshot instead of re-reading the store.
  ```

- [ ] Delete the whole obsolete comment block and replace the effects subscription. Find:
  ```ts
  // effects + synth params: subscribed as an encoded primitive so the
  // subscription fires only on a real VALUE change. Keying on object identity
  // re-ran updateEffects / updateSynthParams for any action that merely
  // respread the object — and updateSynthParams re-targets every live voice,
  // cancelling and re-planning their ramps for nothing. Same pattern as the
  // drum-filter subscription above. JSON.stringify is stable here because
  // both objects are plain literals built from a fixed set of keys
  // (INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS) and every writer spreads from
  // those, so key order does not vary.
  subs.push(
    useAppStore.subscribe(
      (s) => JSON.stringify(s.effects),
      () => audioEngine.updateEffects(useAppStore.getState().effects),
      { fireImmediately: true },
    ),
  );
  ```
  Replace it with:
  ```ts
  // effects + synth params: identity selectors compared with `shallow`, so the
  // subscription fires only on a real VALUE change. Keying on object identity
  // alone re-ran updateEffects / updateSynthParams for any action that merely
  // respread the object — and updateSynthParams re-targets every live voice,
  // cancelling and re-planning their ramps for nothing. Both types are flat
  // records of primitives (MasterEffects, SynthParams), so shallow equality is
  // exact — and unlike the JSON encoding it needs no assumption about key order.
  subs.push(
    useAppStore.subscribe(
      (s) => s.effects,
      (effects) => audioEngine.updateEffects(effects),
      { equalityFn: shallow, fireImmediately: true },
    ),
  );
  ```

- [ ] Replace the synth-params loop. Find:
  ```ts
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => JSON.stringify(s[field]),
        () => audioEngine.updateSynthParams(useAppStore.getState()[field], source),
        { fireImmediately: true },
      ),
    );
  }
  ```
  Replace it with:
  ```ts
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => s[field],
        (params) => audioEngine.updateSynthParams(params, source),
        { equalityFn: shallow, fireImmediately: true },
      ),
    );
  }
  ```

- [ ] Remove the now-unused `FilterType` import (nothing else in the file references it — the only use was the deleted `type as FilterType` cast). Delete this line:
  ```ts
  import type { FilterType } from '../types';
  ```
  `@typescript-eslint/no-unused-vars` from `tseslint.configs.recommended` will error if it is left behind.

- [ ] Reason explicitly (write it in the commit body): behaviour is unchanged because (a) `MasterEffects` and `SynthParams` are flat objects of primitives, so `shallow` and a `JSON.stringify` comparison agree on every possible pair; (b) the drum-filter listener previously round-tripped through `String`/`parseFloat`, which is lossy in principle and is now avoided entirely; (c) `fireImmediately: true` is preserved on all five subscriptions, so the bootstrap ordering into the engine is identical.

- [ ] Confirm the file got shorter:
  ```bash
  git diff --stat src/store/engineSync.ts
  ```
  Expect more deletions than insertions.

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] This task changed imports, so also run:
  ```bash
  bun run eslint
  ```

- [ ] Commit:
  ```bash
  git add src/store/engineSync.ts
  git commit -m "perf(store): compare engineSync selectors with shallow equality

Every zustand selector runs on every setState, so the four JSON.stringify
and template-string selectors ran ~240 times a second during a knob drag.
subscribeWithSelector takes an equalityFn; use identity selectors plus
zustand's shallow instead. Also drops the fragile 'key order does not vary'
invariant the JSON encoding depended on."
  ```

---

### Task 2: Memoize the tonal-heavy computations in ChordView

**Files:**
- `src/components/ChordView.tsx` — line 1-6 (react import), line 544 (`totalProgressionsCount` useMemo, the insertion anchor), line 876 (inline diatonic map), line 938 (inline `getBorrowedChords`)

**Interfaces:**
- Consumes: `getBorrowedChords(root: string, scaleType: string): BorrowedChord[]` from `src/utils/musicTheory.ts:189`
- Consumes: `getDiatonicChordForDegree(degree: number, root: string, scaleType: string, use7ths: boolean)` from `src/utils/musicTheory.ts`
- Consumes: `SCALES` from `src/utils/musicTheory.ts`
- Produces: two local memoized values inside `ChordView` — `borrowedChords` and `diatonicChords`; no new exports

**No new pure logic is created here, so there is no test to write.** The gate is `bun run verify` staying green plus the explicit dependency-audit step below.

**Steps:**

- [ ] `useMemo` is already imported in `src/components/ChordView.tsx` (line 5). No import change needed.

- [ ] Directly above the existing `totalProgressionsCount` memo (line 544), insert both memos:
  ```tsx
  // Both of these run tonal (Chord.getChord / Note.midi / Note.get) dozens of
  // times. ChordView subscribes to playheadBeat, so it re-renders twice a
  // second at 120 BPM — these must not sit inline in the JSX.
  const borrowedChords = useMemo(
    () => getBorrowedChords(scaleRoot, scaleType),
    [scaleRoot, scaleType],
  );

  const diatonicChords = useMemo(
    () =>
      Array.from({ length: SCALES[scaleType]?.intervals.length || 7 }).map((_, i) =>
        getDiatonicChordForDegree(i, scaleRoot, scaleType, use7thsInQuickAdd),
      ),
    [scaleRoot, scaleType, use7thsInQuickAdd],
  );
  ```

- [ ] Replace the inline diatonic map in the JSX. Find (line 876 area):
  ```tsx
            {Array.from({
              length: SCALES[scaleType]?.intervals.length || 7,
            }).map((_, i) => {
              const diatonic = getDiatonicChordForDegree(
                i,
                scaleRoot,
                scaleType,
                use7thsInQuickAdd,
              );
              return (
  ```
  Replace with:
  ```tsx
            {diatonicChords.map((diatonic, i) => {
              return (
  ```
  Leave the entire `<button>` body that follows completely unchanged.

- [ ] Replace the inline borrowed-chords call in the JSX. Find (line 938 area):
  ```tsx
              {getBorrowedChords(scaleRoot, scaleType).map((borrowed, i) => (
  ```
  Replace with:
  ```tsx
              {borrowedChords.map((borrowed, i) => (
  ```

- [ ] Dependency audit — read each hoisted expression and confirm every free variable it reads is in its dep array. Write the finding in the commit body:
  - `getBorrowedChords(scaleRoot, scaleType)` reads exactly `scaleRoot`, `scaleType` (both `useAppStore` values) and the module-level import `getBorrowedChords`. Deps `[scaleRoot, scaleType]` are complete.
  - The diatonic expression reads `SCALES` (module-level constant), `scaleType`, `scaleRoot`, `use7thsInQuickAdd` (local `useState`), and the module-level import `getDiatonicChordForDegree`. Deps `[scaleRoot, scaleType, use7thsInQuickAdd]` are complete.
  - The `.map` callbacks' JSX still closes over `addDiatonicChord` / `addBorrowedChord` / `handlePreviewMouseDown` etc. — those stay **inside the render**, not inside the memo, so they are unaffected.

- [ ] Confirm `deriveChordNotes` usage elsewhere in the file was not touched:
  ```bash
  git diff src/components/ChordView.tsx | grep -c deriveChordNotes
  ```
  Expect `0`.

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] Commit:
  ```bash
  git add src/components/ChordView.tsx
  git commit -m "perf(chords): hoist borrowed and diatonic chord builds into useMemo

ChordView subscribes to playheadBeat, so it re-renders on every beat. Both
of these expressions sat inline in the JSX and ran 50-100 tonal calls each
time, although they depend only on the key, the scale and the 7ths toggle."
  ```

---

### Task 3: Quantize the VU meter and extract it from TransportBar

**Files:**
- `src/utils/vuMeter.ts` — new
- `src/utils/vuMeter.test.ts` — new
- `src/components/ui/VuMeter.tsx` — new
- `src/components/TransportBar.tsx` — line 1 (react import), line 3 (`audioEngine` import), line 28 (`vuLevel` state), lines 34-56 (the rAF loop), lines 149-172 (the VU markup)
- `eslint.config.js` — the final config block's `files: [...]` array
- `CLAUDE.md` — the layering-rule-3 exemption sentence

**Interfaces:**
- Produces: `VU_SEGMENT_COUNT: number` (= 10), `vuSegment(level: number): number`, `isSegmentActive(segment: number, index: number): boolean` from `src/utils/vuMeter.ts`
- Produces: `VuMeter: React.FC<{ isPlaying: boolean }>` (a `React.memo` component) from `src/components/ui/VuMeter.tsx`
- Consumes: `audioEngine.getAudioLevel(): number` from `src/audio/engine.ts`

**Behaviour change to declare:** the meter goes from a continuous `level * 10 > i` test to `Math.round(level * 10)` segments. That is the point — the widget has 11 observable states and now commits at most 11 distinct values instead of ~60 per second. Segment boundaries shift by half a segment; nothing else changes.

**Steps:**

- [ ] TDD — write the test FIRST. Create `src/utils/vuMeter.test.ts`:
  ```ts
  import { describe, expect, test } from 'bun:test';
  import { isSegmentActive, vuSegment, VU_SEGMENT_COUNT } from './vuMeter';

  describe('vuSegment', () => {
    test('silence lights no segments', () => {
      expect(vuSegment(0)).toBe(0);
    });

    test('full scale lights every segment', () => {
      expect(vuSegment(1)).toBe(VU_SEGMENT_COUNT);
    });

    test('rounds to the nearest segment', () => {
      expect(vuSegment(0.5)).toBe(5);
      expect(vuSegment(0.44)).toBe(4);
      expect(vuSegment(0.46)).toBe(5);
    });

    test('clamps input below zero', () => {
      expect(vuSegment(-0.5)).toBe(0);
      expect(vuSegment(-100)).toBe(0);
    });

    test('clamps input above one', () => {
      expect(vuSegment(1.4)).toBe(VU_SEGMENT_COUNT);
      expect(vuSegment(100)).toBe(VU_SEGMENT_COUNT);
    });

    test('NaN reads as silence rather than propagating', () => {
      expect(vuSegment(Number.NaN)).toBe(0);
    });
  });

  describe('isSegmentActive', () => {
    test('lights exactly the first `segment` indices', () => {
      expect(isSegmentActive(3, 0)).toBe(true);
      expect(isSegmentActive(3, 2)).toBe(true);
      expect(isSegmentActive(3, 3)).toBe(false);
    });

    test('nothing is lit at zero', () => {
      expect(isSegmentActive(0, 0)).toBe(false);
    });

    test('everything is lit at full scale', () => {
      expect(isSegmentActive(VU_SEGMENT_COUNT, VU_SEGMENT_COUNT - 1)).toBe(true);
    });
  });
  ```

- [ ] Watch it fail (the module does not exist yet):
  ```bash
  bun test src/utils/vuMeter.test.ts
  ```

- [ ] Create `src/utils/vuMeter.ts`:
  ```ts
  /**
   * Pure quantization for the transport VU meter, kept out of the component so
   * it can be tested without rendering React — this repo has no DOM setup and
   * every component's testable logic is exported like this.
   */

  /** Number of discrete segments the transport meter draws. */
  export const VU_SEGMENT_COUNT = 10;

  /**
   * Quantize a 0..1 audio level to a lit-segment count in 0..VU_SEGMENT_COUNT.
   * Out-of-range input clamps to the ends; NaN reads as silence rather than
   * propagating through Math.round/min/max (all of which pass NaN through).
   */
  export function vuSegment(level: number): number {
    if (Number.isNaN(level)) return 0;
    return Math.max(0, Math.min(VU_SEGMENT_COUNT, Math.round(level * VU_SEGMENT_COUNT)));
  }

  /** Whether the 0-based segment at `index` is lit when `segment` are lit. */
  export function isSegmentActive(segment: number, index: number): boolean {
    return segment > index;
  }
  ```

- [ ] Watch it pass:
  ```bash
  bun test src/utils/vuMeter.test.ts
  ```

- [ ] Create `src/components/ui/VuMeter.tsx`:
  ```tsx
  import React, { useEffect, useRef, useState } from "react";
  import { audioEngine } from "../../audio/engine";
  import { isSegmentActive, VU_SEGMENT_COUNT, vuSegment } from "../../utils/vuMeter";

  export interface VuMeterProps {
    /** Whether anything is sounding; the rAF loop runs only while true. */
    isPlaying: boolean;
  }

  /**
   * Master output level meter. Owns its own rAF loop and its own state so a
   * level change re-renders ten <div>s instead of the whole TransportBar —
   * the meter has VU_SEGMENT_COUNT + 1 observable states, and it now commits
   * only when the quantized segment count actually moves.
   *
   * Reads audioEngine directly (layering rule 3 exemption, alongside
   * AudioVisualizer / TransportBar / AmbientBackdrop): routing a per-frame
   * analyser read through the store would mean a store write every animation
   * frame and a re-render of every subscriber.
   */
  export const VuMeter: React.FC<VuMeterProps> = React.memo(({ isPlaying }) => {
    const [segment, setSegment] = useState(0);
    const segmentRef = useRef(0);

    useEffect(() => {
      if (!isPlaying) {
        segmentRef.current = 0;
        setSegment(0);
        return;
      }
      let animId: number;
      const updateMeter = () => {
        const next = vuSegment(audioEngine.getAudioLevel());
        if (next !== segmentRef.current) {
          segmentRef.current = next;
          setSegment(next);
        }
        animId = requestAnimationFrame(updateMeter);
      };
      animId = requestAnimationFrame(updateMeter);
      return () => cancelAnimationFrame(animId);
    }, [isPlaying]);

    return (
      <div className="hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box">
        <div className="w-14 h-2 bg-base-300 rounded-xs overflow-hidden flex gap-0.5 p-0.5">
          {Array.from({ length: VU_SEGMENT_COUNT }).map((_, i) => {
            const active = isSegmentActive(segment, i);
            const isRed = i >= 8;
            const isYellow = i >= 6 && i < 8;

            return (
              <div
                key={i}
                className={`flex-1 rounded-xs transition-colors duration-75 ${
                  active
                    ? isRed
                      ? "bg-error"
                      : isYellow
                        ? "bg-warning"
                        : "bg-success"
                    : "bg-base-300/50"
                }`}
              />
            );
          })}
        </div>
      </div>
    );
  });
  ```

- [ ] Add the new file to the eslint layering exemption. In `eslint.config.js`, the last config block currently reads:
  ```js
  {
    files: [
      'src/components/AudioVisualizer.tsx',
      'src/components/TransportBar.tsx',
      'src/components/ui/AmbientBackdrop.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  ```
  Change it to:
  ```js
  {
    files: [
      'src/components/AudioVisualizer.tsx',
      'src/components/TransportBar.tsx',
      'src/components/ui/AmbientBackdrop.tsx',
      'src/components/ui/VuMeter.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  ```

- [ ] Update the comment above the layering-rule-3 block in `eslint.config.js`. Change:
  ```js
    // Exceptions: the three read-only analyser consumers (AudioVisualizer,
    // TransportBar's level meter, AmbientBackdrop) and test files. Routing
  ```
  to:
  ```js
    // Exceptions: the read-only analyser consumers (AudioVisualizer, the
    // transport VU meter in ui/VuMeter, AmbientBackdrop) and test files.
    // TransportBar stays listed while it still holds analyser-adjacent code.
    // Routing
  ```

- [ ] Update `CLAUDE.md` so the docs and the lint config agree. In the "Three layers" section, change:
  ```
  3. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`, `TransportBar.tsx` and `ui/AmbientBackdrop.tsx` (read-only analyser consumers) and test files are exempt
  ```
  to:
  ```
  3. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`, `TransportBar.tsx`, `ui/VuMeter.tsx` and `ui/AmbientBackdrop.tsx` (read-only analyser consumers) and test files are exempt
  ```

- [ ] Rewrite `src/components/TransportBar.tsx`. Change the react import on line 1 from:
  ```tsx
  import React, { useState, useEffect, useRef } from "react";
  ```
  to:
  ```tsx
  import React from "react";
  ```

- [ ] Remove the now-unused engine import (line 3) from `TransportBar.tsx`:
  ```tsx
  import { audioEngine } from "../audio/engine";
  ```
  Delete that line. Leave the eslint exemption entry for `TransportBar.tsx` in place — the file is still listed and removing it is out of scope here.

- [ ] Add the `VuMeter` import to `TransportBar.tsx` next to the other `./ui/` imports:
  ```tsx
  import { VuMeter } from "./ui/VuMeter";
  ```

- [ ] Delete the VU state and the rAF loop from `TransportBar.tsx`. Remove:
  ```tsx
    // Local VU meter state
    const [vuLevel, setVuLevel] = useState(0);
  ```
  and the whole block:
  ```tsx
    // Meter polling loop — runs only while playing, and only commits state when
    // the level moved enough to change a VU segment (avoids 60 re-renders/sec)
    const vuLevelRef = useRef(0);
    useEffect(() => {
      if (!isPlaying) {
        setVuLevel(0);
        vuLevelRef.current = 0;
        return;
      }
      let animId: number;
      const updateMeter = () => {
        const level = audioEngine.getAudioLevel();
        if (Math.abs(level - vuLevelRef.current) > 0.02) {
          vuLevelRef.current = level;
          setVuLevel(level);
        }
        animId = requestAnimationFrame(updateMeter);
      };
      animId = requestAnimationFrame(updateMeter);
      return () => cancelAnimationFrame(animId);
    }, [isPlaying]);
  ```
  Keep `const isPlaying = aggregate !== 'stopped';` and its comment — it is now the `VuMeter` prop.

- [ ] Replace the VU markup in `TransportBar.tsx`. Find the whole block starting at `{/* Real-time Stereo VU Meter */}` and ending with the two closing `</div>`s before `{/* Master Output Fader */}`, and replace it with:
  ```tsx
        {/* Real-time output level meter — owns its own rAF loop so the level
            does not re-render the transport bar (see ui/VuMeter). */}
        <VuMeter isPlaying={isPlaying} />
  ```

- [ ] Reason explicitly (write it in the commit body): the markup moved verbatim including its `bg-error` / `bg-warning` / `bg-success` / `bg-base-300/50` semantic tokens and the `hidden sm:flex` wrapper, so the rendered DOM is byte-identical for a given segment count. The only behaviour delta is the quantization boundary (`round` instead of a continuous compare), which is the deliberate change.

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] This task added and removed imports, so also run:
  ```bash
  bun run eslint
  ```

- [ ] Commit:
  ```bash
  git add src/utils/vuMeter.ts src/utils/vuMeter.test.ts src/components/ui/VuMeter.tsx src/components/TransportBar.tsx eslint.config.js CLAUDE.md
  git commit -m "perf(transport): quantize the VU meter into its own memo component

The rAF loop committed whenever the level moved by 0.02, which real audio
does nearly every frame — so the whole TransportBar re-rendered ~60x/sec for
a widget with 11 observable states. Quantize to segments in a tested pure
helper and move the loop into ui/VuMeter, added to the layering exemption."
  ```

---

### Task 4: Split the sequencer grid into memoized StepHeader and TrackRow

**Files:**
- `src/components/sequencer/StepHeader.tsx` — new
- `src/components/sequencer/TrackRow.tsx` — new
- `src/components/SequencerView.tsx` — line 1 (react import), lines 36-38 (`meter` / `cells`), lines 64-79 (`toggleStep` / `toggleMute`), lines 316-334 (step header JSX), lines 337-414 (track lane JSX)

**Placement decision to state in the commit body:** the two components go in a new `src/components/sequencer/` folder, mirroring the existing `src/components/chord/SortableChordCard.tsx`. `SequencerView.tsx` is already 424 lines; the pure view-model stays where it is in `src/components/sequencerGrid.ts`.

**Interfaces:**
- Consumes: `StepCell` (`{ index, label, isBeatStart, beatIndex, isAltBeatGroup }`) and `stepCells(meter: Meter): StepCell[]` from `src/components/sequencerGrid.ts`
- Consumes: `SequencerTrack` from `src/types.ts`
- Consumes: `useAppStore.getState(): AppStore` — `sequencerTracks`, `setSequencerTracks`, `synthParams`
- Produces: `StepHeader: React.FC<{ cells: StepCell[]; currentStep: number; isPlaying: boolean }>` (`React.memo`)
- Produces: `TrackRow: React.FC<{ track: SequencerTrack; cells: StepCell[]; currentStep: number; isPlaying: boolean; onToggleStep: (trackId: string, stepIndex: number) => void; onToggleMute: (trackId: string) => void; onPreview: (track: SequencerTrack) => void }>` (`React.memo`)

**What this does and does not save — state this verbatim in the commit body.** It does **not** stop the 16th-note tick from re-rendering the rows: the column highlight is per-step data every row needs, so `currentStep` is a real prop and the memo comparison fails on every tick by design. What it *does* stop is the other direction — dragging the drum-filter cutoff knob, the master sequencer volume, or changing the genre select currently re-renders `SequencerView` at up to 60 Hz and rebuilds all 112 step buttons with it; with stable callbacks, a memoized `cells` array and stable `track` identities, those interactions now skip every row entirely. `DrumPads` is already `React.memo`, so it is already off the tick path and this task does not change that.

**No new pure logic is created here, so there is no test to write.** The gate is `bun run verify` staying green plus the explicit markup-equivalence step below.

**Callback hazard resolution:** `src/store/sequencerSlice.ts:43` exposes `setSequencerTracks: (sequencerTracks) => set({ sequencerTracks })` — a plain-value setter with no updater form. The slice does use `set((state) => ...)` internally for `applyDrumPattern`, but exposing a second updater-style action just for this would widen the public slice API for one caller. So the callbacks read live state through `useAppStore.getState()` and keep `[]` deps.

**Steps:**

- [ ] Create `src/components/sequencer/StepHeader.tsx`:
  ```tsx
  import React from "react";
  import type { StepCell } from "../sequencerGrid";

  export interface StepHeaderProps {
    cells: StepCell[];
    currentStep: number;
    isPlaying: boolean;
  }

  /**
   * Step-number strip above the sequencer lanes. Memoized so the header is the
   * only thing that reconciles when nothing but the transport moved.
   */
  export const StepHeader: React.FC<StepHeaderProps> = React.memo(
    ({ cells, currentStep, isPlaying }) => (
      <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
        {cells.map((cell) => {
          const isCurrent = currentStep === cell.index && isPlaying;
          return (
            <div
              key={cell.index}
              className={`flex-1 text-center tabular-nums text-[10px] py-1 rounded transition-all ${
                isCurrent
                  ? "bg-primary text-primary-content font-bold shadow-md shadow-primary/50"
                  : cell.isBeatStart
                    ? "text-accent font-bold bg-base-300/40"
                    : "text-base-content/50"
              }`}
            >
              {cell.label}
            </div>
          );
        })}
      </div>
    ),
  );
  ```

- [ ] Create `src/components/sequencer/TrackRow.tsx`:
  ```tsx
  import React from "react";
  import { Play } from "lucide-react";
  import type { SequencerTrack } from "../../types";
  import type { StepCell } from "../sequencerGrid";
  import { PowerToggle } from "../ui/PowerToggle";

  export interface TrackRowProps {
    track: SequencerTrack;
    cells: StepCell[];
    currentStep: number;
    isPlaying: boolean;
    onToggleStep: (trackId: string, stepIndex: number) => void;
    onToggleMute: (trackId: string) => void;
    onPreview: (track: SequencerTrack) => void;
  }

  /**
   * One drum/synth lane. Memoized: the three callbacks are stable useCallbacks
   * in SequencerView and `cells` is memoized there, so a knob drag or a genre
   * change in the parent no longer rebuilds this row's 16 step buttons.
   * `currentStep` is a real prop, so a transport tick DOES still re-render
   * every row — the column highlight is per-step data each row needs.
   */
  export const TrackRow: React.FC<TrackRowProps> = React.memo(
    ({ track, cells, currentStep, isPlaying, onToggleStep, onToggleMute, onPreview }) => (
      <div
        id={`sequencer-row-${track.id}`}
        className="flex items-center gap-2 bg-base-200 p-2 rounded-box border border-base-300 hover:border-primary/40 transition-colors"
      >
        {/* Track Info & Mute */}
        <div className="w-40 flex items-center justify-between pr-2 border-r border-base-300">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
            <span className="text-xs font-bold text-base-content truncate">
              {track.name}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPreview(track)}
              className="btn btn-ghost btn-xs btn-square hover:text-primary"
              title="Preview Instrument"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <PowerToggle
              id={`btn-mute-${track.id}`}
              on={!track.muted}
              onToggle={() => onToggleMute(track.id)}
              name={track.name}
              tone="primary"
              iconOnly
              size="xs"
              verb={{ on: 'Unmute', off: 'Mute' }}
            />
          </div>
        </div>

        {/* Step Buttons — the visible window of this row */}
        <div className="flex-1 flex items-center gap-1.5">
          {cells.map((cell) => {
            const isActive = track.steps[cell.index] === true;
            const isCurrent = currentStep === cell.index && isPlaying;

            return (
              <button
                key={cell.index}
                id={`step-${track.id}-${cell.index}`}
                onClick={() => onToggleStep(track.id, cell.index)}
                className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
                  isActive
                    ? `${track.color} shadow-md shadow-primary/20 scale-[0.96]`
                    : cell.isAltBeatGroup
                      ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                      : "bg-base-200 hover:bg-base-300 border border-base-300/40"
                } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-base-content/10 rounded-field animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    ),
  );
  ```

- [ ] In `src/components/SequencerView.tsx`, add `useCallback` and `useMemo` to the react import. Change line 1 from:
  ```tsx
  import { useState, useEffect, useRef } from "react";
  ```
  to:
  ```tsx
  import { useCallback, useEffect, useMemo, useRef, useState } from "react";
  ```

- [ ] Add the new imports and the `SequencerTrack` type to `SequencerView.tsx`, next to the existing component imports:
  ```tsx
  import { StepHeader } from "./sequencer/StepHeader";
  import { TrackRow } from "./sequencer/TrackRow";
  import type { SequencerTrack } from "../types";
  ```

- [ ] Memoize `cells` in `SequencerView.tsx`. Replace:
  ```tsx
    const meter = getMeter(useAppStore((s) => s.meterId));
    const stepsPerBar = meter.stepsPerBar;
    const cells = stepCells(meter);
  ```
  with:
  ```tsx
    const meterId = useAppStore((s) => s.meterId);
    // getMeter returns the shared METERS[id] object, so `meter` is a stable
    // identity per meterId and this memo only rebuilds on a real meter change.
    const meter = getMeter(meterId);
    const stepsPerBar = meter.stepsPerBar;
    const cells = useMemo(() => stepCells(meter), [meter]);
  ```

- [ ] Replace `toggleStep` and `toggleMute` in `SequencerView.tsx` with stable callbacks. Find:
  ```tsx
    const toggleStep = (trackId: string, stepIndex: number) => {
      onChangeTracks(
        tracks.map((t) => {
          if (t.id !== trackId) return t;
          const newSteps = [...t.steps];
          newSteps[stepIndex] = !newSteps[stepIndex];
          return { ...t, steps: newSteps };
        }),
      );
    };

    const toggleMute = (trackId: string) => {
      onChangeTracks(
        tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
      );
    };
  ```
  Replace with:
  ```tsx
    // These are props of the memoized TrackRow, so their identity must be
    // stable. They read `sequencerTracks` LIVE from the store rather than from
    // the render scope: a useCallback([]) over the closed-over `tracks` would
    // capture the tracks as of the first render and silently drop every edit
    // made after it. The slice's setter takes a plain value, not an updater.
    const toggleStep = useCallback((trackId: string, stepIndex: number) => {
      const { sequencerTracks, setSequencerTracks } = useAppStore.getState();
      setSequencerTracks(
        sequencerTracks.map((t) => {
          if (t.id !== trackId) return t;
          const newSteps = [...t.steps];
          newSteps[stepIndex] = !newSteps[stepIndex];
          return { ...t, steps: newSteps };
        }),
      );
    }, []);

    const toggleMute = useCallback((trackId: string) => {
      const { sequencerTracks, setSequencerTracks } = useAppStore.getState();
      setSequencerTracks(
        sequencerTracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
      );
    }, []);

    const previewTrack = useCallback((track: SequencerTrack) => {
      if (track.instrument === "synth" || track.instrument === "bass") {
        const note = track.instrument === "bass" ? "C2" : "C4";
        previewRef.current?.();
        previewRef.current = previewSequencerNote(
          note,
          useAppStore.getState().synthParams,
          0.8,
        );
      } else {
        ensureDrumEngine();
        triggerPad(track.instrument, 0.8);
      }
    }, []);
  ```
  Note: `previewTrack` must be declared **after** `previewRef` (which is created at line 57), so place this whole block below the `const previewRef = useRef<PreviewHandle | null>(null);` line rather than at the original line 64 if that ordering is violated.

- [ ] Replace the step-header JSX in `SequencerView.tsx`. Find the block that starts with:
  ```tsx
        {/* Step Indicator Header — one cell per step of the active bar */}
        <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
  ```
  and ends with the matching `</div>` after the `cells.map`, and replace the whole thing with:
  ```tsx
        {/* Step Indicator Header — one cell per step of the active bar */}
        <StepHeader cells={cells} currentStep={currentStep} isPlaying={isPlaying} />
  ```

- [ ] Replace the track-lane JSX in `SequencerView.tsx`. Find:
  ```tsx
        <div className="space-y-2 min-w-[700px]">
          {tracks.map((track) => (
  ```
  through its closing `))}` and `</div>`, and replace the whole thing with:
  ```tsx
        <div className="space-y-2 min-w-[700px]">
          {tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              cells={cells}
              currentStep={currentStep}
              isPlaying={isPlaying}
              onToggleStep={toggleStep}
              onToggleMute={toggleMute}
              onPreview={previewTrack}
            />
          ))}
        </div>
  ```

- [ ] Remove imports from `SequencerView.tsx` that are now only used by `TrackRow` — check each one before deleting:
  ```bash
  grep -n "PowerToggle\|<Play\b\|\bPlay,\|synthParams" src/components/SequencerView.tsx
  ```
  `PowerToggle` and `Play` are used elsewhere in the file's toolbar; delete an import **only** if the grep shows no remaining use. `synthParams` is now read via `getState()` inside `previewTrack`, so drop `const synthParams = useAppStore((s) => s.synthParams);` if nothing else references it.

- [ ] Markup-equivalence check — confirm the two new files reproduce the original JSX exactly:
  ```bash
  bun run check:theme
  git diff -- src/components/SequencerView.tsx | grep '^-' | grep -o 'class[Nn]ame="[^"]*"' | sort > /tmp/removed-classes.txt
  grep -oh 'class[Nn]ame="[^"]*"' src/components/sequencer/StepHeader.tsx src/components/sequencer/TrackRow.tsx | sort > /tmp/added-classes.txt
  diff /tmp/removed-classes.txt /tmp/added-classes.txt || true
  ```
  Any static class string that appears on one side and not the other is a transcription error — fix it. (Template-literal classNames will not appear in either list; eyeball those two by hand.)

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] This task added imports, so also run:
  ```bash
  bun run eslint
  ```

- [ ] Manual check: start `bun run dev`, open the Sequencer tab, toggle several steps across different rows, mute/unmute a row, hit preview on a synth row and a drum row, then press play and confirm the step highlight walks the grid.

- [ ] Commit:
  ```bash
  git add src/components/sequencer/StepHeader.tsx src/components/sequencer/TrackRow.tsx src/components/SequencerView.tsx
  git commit -m "perf(sequencer): extract memoized StepHeader and TrackRow

A drum-filter knob drag re-rendered SequencerView at 60Hz and rebuilt all
112 step buttons with it. Memoized rows plus stable callbacks and a memoized
cells array stop that. This does NOT stop the 16th-note tick from
re-rendering the rows — the column highlight is per-step data every row
needs. The callbacks read sequencerTracks live from the store because a
useCallback([]) over the render-scope `tracks` would capture a stale value."
  ```

---

### Task 5: Memoize SortableChordCard with stable callbacks

**Files:**
- `src/components/chord/SortableChordCard.tsx` — line 33 (`export function SortableChordCard`) and the closing brace of the component
- `src/components/ChordView.tsx` — lines 1-6 (react import), line 242 (`handleMoveChord`), lines 439-455 (`handleCardPreviewMouseDown` / `handleCardPreviewMouseUp`), lines 531-542 (`removeChord` / `updateChord`)

**Interfaces:**
- Consumes: `useAppStore.getState(): AppStore` — `chords`, `chordOctave`, `chordSynthParams`, `setChords`
- Consumes: `deriveChordNotes(chord: ChordItem, octave: number): ChordItem` from `src/utils/musicTheory.ts`
- Consumes: `setActiveChordId` from `useChordPlayback()` (`src/components/chord/useChordPlayback.ts`, destructured at `ChordView.tsx:198`) — a `useState` setter, already stable
- Produces: `SortableChordCard` keeps its named export and its `SortableChordCardProps` shape exactly; only its identity changes to a `React.memo` wrapper

**No new pure logic is created here, so there is no test to write.** The gate is `bun run verify` staying green plus the stale-closure audit below.

**Stale-closure resolution:** `src/store/chordsSlice.ts:24` exposes `setChords: (chords) => set({ chords })` — a plain-value setter with no updater form, and the slice offers no updater-style alternative. All five callbacks therefore read live state through `useAppStore.getState()` and keep `[]` deps. Note `ChordView` already has a `chordOctaveRef` (line 271) for the auto-harmonize effect, but that ref is refreshed in an effect and exists for a different reason; `getState().chordOctave` is the direct read and is what these callbacks use.

**Expected residual, state it in the commit body:** `useSortable` from `@dnd-kit/sortable` subscribes to the drag context inside the card, so every card still re-renders during an active drag. That is correct and is not something `React.memo` can or should prevent.

**Steps:**

- [ ] Wrap the card in `React.memo`. In `src/components/chord/SortableChordCard.tsx`, change:
  ```tsx
  export function SortableChordCard({
    chord,
    idx,
    totalChords,
    startBar,
    isActive,
    activeBeat = null,
    beatsPerBar = BEATS_PER_BAR,
    updateChord,
    removeChord,
    handleMoveChord,
    handleCardPreviewMouseDown,
    handleCardPreviewMouseUp,
  }: SortableChordCardProps) {
  ```
  to:
  ```tsx
  /**
   * Memoized: ChordView re-renders on every beat (it subscribes to
   * playheadBeat) but only one card's `activeBeat` actually changes. All five
   * callback props are stable useCallbacks in ChordView, so the default
   * shallow prop comparison is meaningful. `useSortable` below still
   * subscribes to the drag context, so cards do re-render during a drag.
   */
  export const SortableChordCard = React.memo(function SortableChordCard({
    chord,
    idx,
    totalChords,
    startBar,
    isActive,
    activeBeat = null,
    beatsPerBar = BEATS_PER_BAR,
    updateChord,
    removeChord,
    handleMoveChord,
    handleCardPreviewMouseDown,
    handleCardPreviewMouseUp,
  }: SortableChordCardProps) {
  ```

- [ ] Close the wrapper. At the very end of `src/components/chord/SortableChordCard.tsx`, change the component's final closing brace from:
  ```tsx
  }
  ```
  to:
  ```tsx
  });
  ```
  Verify with `bun run lint` that the file still type-checks before continuing.

- [ ] Add `useCallback` to `ChordView`'s react import. Change:
  ```tsx
  import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
  } from "react";
  ```
  to:
  ```tsx
  import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
  } from "react";
  ```

- [ ] Replace `handleMoveChord` (line 242). Find:
  ```tsx
    const handleMoveChord = (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= chords.length) return;
      const updated = [...chords];
      const [removed] = updated.splice(index, 1);
      updated.splice(newIndex, 0, removed);
      setChords(updated);
    };
  ```
  Replace with:
  ```tsx
    // Props of the memoized SortableChordCard, so their identity must be
    // stable. `chords` and `chordOctave` are read LIVE from the store: a
    // useCallback([]) over the render-scope values would pin the progression
    // as of the first render and silently corrupt every later edit. The
    // chords slice exposes a plain-value setter, not an updater.
    const handleMoveChord = useCallback((index: number, direction: -1 | 1) => {
      const { chords, setChords } = useAppStore.getState();
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= chords.length) return;
      const updated = [...chords];
      const [removed] = updated.splice(index, 1);
      updated.splice(newIndex, 0, removed);
      setChords(updated);
    }, []);
  ```

- [ ] Replace `handleCardPreviewMouseDown` and `handleCardPreviewMouseUp` (lines 439-455). Find:
  ```tsx
    const handleCardPreviewMouseDown = (
      e: React.MouseEvent | React.TouchEvent,
      chord: ChordItem,
    ) => {
      e.stopPropagation();
      ensurePreviewEngine();
      playChordLegatoWithEngine(chord, chordSynthParams);
      setActiveChordId(chord.id);
    };

    const handleCardPreviewMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      if (!hasPreviewEngine()) return;
      setActiveChordId(null);

      stopChordPreviewSource(0.15);
    };
  ```
  Replace with:
  ```tsx
    const handleCardPreviewMouseDown = useCallback(
      (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => {
        e.stopPropagation();
        ensurePreviewEngine();
        playChordLegatoWithEngine(chord, useAppStore.getState().chordSynthParams);
        setActiveChordId(chord.id);
      },
      [setActiveChordId],
    );

    const handleCardPreviewMouseUp = useCallback(
      (e: React.MouseEvent | React.TouchEvent) => {
        e.stopPropagation();
        if (!hasPreviewEngine()) return;
        setActiveChordId(null);

        stopChordPreviewSource(0.15);
      },
      [setActiveChordId],
    );
  ```

- [ ] Replace `removeChord` and `updateChord` (lines 531-542). Find:
  ```tsx
    const removeChord = (id: string) => {
      setChords(chords.filter((c) => c.id !== id));
    };

    const updateChord = (id: string, updates: Partial<ChordItem>) => {
      setChords(
        chords.map((c) => {
          if (c.id !== id) return c;
          return deriveChordNotes({ ...c, ...updates }, chordOctave);
        }),
      );
    };
  ```
  Replace with:
  ```tsx
    const removeChord = useCallback((id: string) => {
      const { chords, setChords } = useAppStore.getState();
      setChords(chords.filter((c) => c.id !== id));
    }, []);

    const updateChord = useCallback((id: string, updates: Partial<ChordItem>) => {
      const { chords, chordOctave, setChords } = useAppStore.getState();
      setChords(
        chords.map((c) => {
          if (c.id !== id) return c;
          return deriveChordNotes({ ...c, ...updates }, chordOctave);
        }),
      );
    }, []);
  ```

- [ ] Stale-closure audit — for each of the five callbacks, list every value it reads and confirm it comes from `getState()`, from a module-level import, or from a `useState` setter. Write the table in the commit body:
  - `removeChord` → `chords`, `setChords` (getState).
  - `updateChord` → `chords`, `chordOctave`, `setChords` (getState); `deriveChordNotes` (module import).
  - `handleMoveChord` → `chords`, `setChords` (getState).
  - `handleCardPreviewMouseDown` → `chordSynthParams` (getState); `ensurePreviewEngine`, `playChordLegatoWithEngine` (module imports); `setActiveChordId` (in deps).
  - `handleCardPreviewMouseUp` → `hasPreviewEngine`, `stopChordPreviewSource` (module imports); `setActiveChordId` (in deps).

- [ ] Confirm nothing else in the file still calls the old closures over `chords`:
  ```bash
  bun run lint
  ```

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] Manual check: `bun run dev`, Chords tab — add three chords, delete the middle one, change a chord's root and quality, move a chord left and right with the arrows, press-and-hold a card to preview it, and drag a card to reorder. Then press play and confirm the beat dots advance on the correct card.

- [ ] Commit:
  ```bash
  git add src/components/chord/SortableChordCard.tsx src/components/ChordView.tsx
  git commit -m "perf(chords): memoize SortableChordCard behind stable callbacks

Every beat tick re-rendered every card although only one card's activeBeat
changes. All five callback props are now useCallback([]) that read chords,
chordOctave and chordSynthParams live from the store — the chords slice
exposes a plain-value setter, so closing over the render-scope values would
have pinned a stale progression and corrupted edits."
  ```

---

### Task 6: Fix SynthView's keyboard listener churn and unmemoized note lists

**Files:**
- `src/components/SynthView.tsx` — lines 236-251 (`arpStateRef` and its refresh effect, read-only reference), lines 253-281 (`handleNoteOn`), lines 283-305 (`handleNoteOff`), lines 348-351 (`chordKeyboardRows`, the insertion anchor), lines 353-430 (the keyboard `useEffect`), lines 1460-1467 (the `ScaleLockedKeyboard` JSX)

**Interfaces:**
- Consumes: `arpStateRef.current: { activeNotes: Set<string>; params: SynthParams; controlTarget: SynthControlTarget; bpm: number }`
- Consumes: `getScaleLockedKeyboardNotesFlat(root: string, scaleType: string, octave: number)`, `getScaleLockedKeyboardNotes(root: string, scaleType: string, octave: number)`, `getChromaticKeyboardNotes(octave: number)` from `src/utils/keyboard.ts`
- Produces: `handleNoteOn: (note: string) => void` and `handleNoteOff: (note: string) => void` with **stable identity** (`useCallback([])`); three new local memos `scaleLockedNotesFlat`, `scaleLockedRows`, `chromaticNotes`. No exported API changes — `KEYBOARD_NOTES` and every other export stay as they are.

**This is the riskiest task in the plan.** Read the surrounding comments before touching anything. There are load-bearing comments about voice stranding, `KEYBOARD_AUDITION_TARGET`, and the mode-change release effect.

**Equivalence argument to verify and then state in the commit body:**
`arpStateRef` is refreshed by an **unconditional** `useEffect` (no dep array) declared at line 244, so `arpStateRef.current.params` equals the most recently committed render's `keyboardParams`.
- Call site 1 — `handleNoteOn` / `handleNoteOff` invoked from a `window` `keydown`/`keyup` listener: DOM events are dispatched between commits, so the ref holds the current render's params. Equivalent to the closure.
- Call site 2 — `handleNoteOn` / `handleNoteOff` invoked from `ChordKeyboard` / `ScaleLockedKeyboard` / `ChromaticKeyboard` pointer props: same, React event handlers run after commit. Equivalent.
- Call site 3 — `handleNoteOffRef.current(note)` inside the cleanup of the `[keyboardMode]` effect at line 334. React runs all cleanups before all effects in a commit, and the `arpStateRef` refresh effect is one of those effects — so during that cleanup the ref still holds the **previous** commit's params. But `handleNoteOffRef` is itself refreshed in an effect (line 317), so today's code also calls a `handleNoteOff` closed over the previous commit's params. Identical behaviour, unchanged.
- `useArpPlayback(arpStateRef, keyboardParams.arpActive)` at line 310 is untouched and keeps reading the same ref.

**No new pure logic is created here, so there is no test to write** beyond the existing `bun run check:keys` invariant, which is already in `verify`.

**Steps:**

- [ ] Replace `handleNoteOn` (line 253). Find:
  ```tsx
    const handleNoteOn = useCallback(
      (note: string) => {
        initSynthPlayback();
        if (!keyboardParams.arpActive) {
  ```
  ...through its dep array `[keyboardParams.arpActive, keyboardParams],` and replace the whole `useCallback` with:
  ```tsx
    const handleNoteOn = useCallback(
      (note: string) => {
        // Params come from arpStateRef, refreshed by an unconditional effect
        // after every commit, so this reads exactly the value the closure used
        // to capture — but the callback identity no longer changes on every
        // knob move, which used to tear down and re-register the window
        // keydown/keyup listeners ~60 times a second during a drag.
        const params = arpStateRef.current.params;
        initSynthPlayback();
        if (!params.arpActive) {
          // Equal-power polyphony: a new note lowers every held voice so the
          // total level stays flat as keys are added. The ref mirrors
          // activeNotes synchronously so rapid presses see each other.
          const held = arpStateRef.current.activeNotes;
          const isNewNote = !held.has(note);
          held.add(note);
          const scale = equalPowerVelocityScale(held.size);
          if (isNewNote) {
            applySynthPlaybackVelocityScale(scale);
          }
          synthPlaybackNoteOn(
            note,
            params,
            1.0,
            undefined,
            KEYBOARD_AUDITION_TARGET,
            scale,
          );
        }
        setActiveNotes((prev) => new Set(prev).add(note));
      },
      [],
    );
  ```

- [ ] Replace `handleNoteOff` (line 283). Find the whole `useCallback` ending in `[keyboardParams.arpActive, keyboardParams.release],` and replace it with:
  ```tsx
    const handleNoteOff = useCallback(
      (note: string) => {
        // Same ref read as handleNoteOn — see the note there.
        const params = arpStateRef.current.params;
        const held = arpStateRef.current.activeNotes;
        const wasHeld = held.delete(note);
        if (wasHeld && !params.arpActive) {
          // Release first (marks the voice so re-scaling skips it), then let
          // the remaining held voices rise back toward full level.
          synthPlaybackNoteOff(
            note,
            params.release,
            undefined,
            KEYBOARD_AUDITION_TARGET,
          );
          applySynthPlaybackVelocityScale(equalPowerVelocityScale(held.size));
        }
        setActiveNotes((prev) => {
          const next = new Set(prev);
          next.delete(note);
          return next;
        });
      },
      [],
    );
  ```

- [ ] Leave line 310 (`useArpPlayback(arpStateRef, keyboardParams.arpActive);`), the `handleNoteOffRef` block at 316-319, the mode-change release effect at 322-334, and the arp-silence effect at 336-346 **completely untouched**. Confirm:
  ```bash
  git diff src/components/SynthView.tsx | sed -n '1,400p' | grep -n "useArpPlayback\|handleNoteOffRef\|notesToReleaseOnKeyboardModeChange\|releaseSynthPlaybackVoices"
  ```
  Expect no output.

- [ ] Add the three note-list memos immediately after the existing `chordKeyboardRows` memo (line 348-351):
  ```tsx
    // The keyboard handlers below used to rebuild these from tonal on every
    // keystroke, and the rows variant was called fresh in the JSX on every
    // render while its sibling chordKeyboardRows was already memoized.
    const scaleLockedNotesFlat = useMemo(
      () => getScaleLockedKeyboardNotesFlat(scaleRoot, scaleType, keyboardOctave),
      [scaleRoot, scaleType, keyboardOctave],
    );

    const scaleLockedRows = useMemo(
      () => getScaleLockedKeyboardNotes(scaleRoot, scaleType, keyboardOctave),
      [scaleRoot, scaleType, keyboardOctave],
    );

    const chromaticNotes = useMemo(
      () => getChromaticKeyboardNotes(keyboardOctave),
      [keyboardOctave],
    );
  ```

- [ ] In the keyboard `useEffect`, replace the note-list computation inside `handleKeyDown`. Find:
  ```tsx
        const notesList =
          keyboardMode === "scale-locked"
            ? getScaleLockedKeyboardNotesFlat(
                scaleRoot,
                scaleType,
                keyboardOctave,
              )
            : getChromaticKeyboardNotes(keyboardOctave);
        const keyObj = notesList.find((n) => n.key === e.code);
        if (keyObj) {
          handleNoteOn(keyObj.note);
        }
  ```
  Replace with:
  ```tsx
        const notesList =
          keyboardMode === "scale-locked" ? scaleLockedNotesFlat : chromaticNotes;
        const keyObj = notesList.find((n) => n.key === e.code);
        if (keyObj) {
          handleNoteOn(keyObj.note);
        }
  ```

- [ ] Replace the same computation inside `handleKeyUp`. Find:
  ```tsx
        const notesList =
          keyboardMode === "scale-locked"
            ? getScaleLockedKeyboardNotesFlat(
                scaleRoot,
                scaleType,
                keyboardOctave,
              )
            : getChromaticKeyboardNotes(keyboardOctave);
        const keyObj = notesList.find((n) => n.key === e.code);
        if (keyObj) {
          handleNoteOff(keyObj.note);
        }
  ```
  Replace with:
  ```tsx
        const notesList =
          keyboardMode === "scale-locked" ? scaleLockedNotesFlat : chromaticNotes;
        const keyObj = notesList.find((n) => n.key === e.code);
        if (keyObj) {
          handleNoteOff(keyObj.note);
        }
  ```

- [ ] Replace the keyboard effect's dep array. Find:
  ```tsx
    }, [
      handleNoteOn,
      handleNoteOff,
      keyboardMode,
      scaleRoot,
      scaleType,
      keyboardOctave,
      chordKeyboardRows,
    ]);
  ```
  Replace with:
  ```tsx
    }, [
      // handleNoteOn/handleNoteOff are useCallback([]) now, so they never
      // change — kept here because the effect genuinely calls them. scaleRoot,
      // scaleType and keyboardOctave are no longer read directly: they reach
      // the handlers through the three memos below, which change identity only
      // when the notes actually change.
      handleNoteOn,
      handleNoteOff,
      keyboardMode,
      chordKeyboardRows,
      scaleLockedNotesFlat,
      chromaticNotes,
    ]);
  ```
  Note `keyboardOctave` is still mutated inside `handleKeyDown` via the `setKeyboardOctave((o) => ...)` updater form, which never reads the current value from the closure — so dropping it from the deps is safe.

- [ ] Replace the inline rows call in the JSX (line 1462). Find:
  ```tsx
              rows={getScaleLockedKeyboardNotes(
                scaleRoot,
                scaleType,
                keyboardOctave,
              )}
  ```
  Replace with:
  ```tsx
              rows={scaleLockedRows}
  ```

- [ ] Verify the key-binding invariant still holds:
  ```bash
  bun run check:keys
  ```

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] **Manual verification — do every one of these by hand with `bun run dev`, Synth tab.** A stuck note in any case means revert and re-diagnose:
  1. Press and hold `A` on the QWERTY keyboard, and while holding it drag the filter-cutoff knob back and forth. Release `A`. The note must stop.
  2. Press and hold a key, then switch the keyboard mode (Chromatic → Scale Locked → Chord) while still holding it. Release. No note may keep sounding.
  3. Toggle the arpeggiator on, hold a chord's worth of keys, release them all — the arp must go silent. Toggle it back off and repeat step 1.
  4. Press `-` and `=` to change octave while holding a key; release. No stuck note.
  5. In Chord mode, hold a triad key, change the scale root, release. No stuck note.
  6. Click-and-hold a key on the on-screen keyboard in each of the three modes and release; the note must stop each time.

- [ ] Commit:
  ```bash
  git add src/components/SynthView.tsx
  git commit -m "perf(synth): stop re-registering the window key listeners on every knob move

handleNoteOn had the whole keyboardParams object in its dep list, so any
synth param edit changed its identity and the keydown/keyup effect tore down
and re-registered two window listeners ~60x/sec during a drag. Read params
from the existing arpStateRef instead (refreshed after every commit, so it
is the same value the closure captured) and memoize the three keyboard note
lists, including the rows variant that was called inline in the JSX."
  ```

---

### Task 7: Skip the unused analyser reads in AudioVisualizer's oscilloscope mode

**Files:**
- `src/components/AudioVisualizer.tsx` — lines 204-232 (the read + `isSounding` computation inside `render`)

**Interfaces:**
- Consumes: `AnalyserNode.getByteFrequencyData(array: Uint8Array): void`, `AnalyserNode.getByteTimeDomainData(array: Uint8Array): void`
- Produces: no signature changes; `isSounding` stays a `boolean` local in `render`

**Conclusion and reasoning to state in the commit body (from spec F7):** `maxDeviation > 3` alone is *not* a drop-in replacement for the two-term test in every case. A constant DC offset is a steady offset from 128 in the time domain, so `maxDeviation` does catch it — but a very slow sub-audio LFO sweep produces a large `maxDeviation` while `avgEnergy` stays near zero, and today's test rejects that. So the two-term test is **kept verbatim for `bars` and `wave`** (which need `freqData` anyway) and the time-domain-only test is used **only** in the `oscilloscope` branch, where nothing consumes frequency data. Spectrum-mode output is bit-identical.

**Everything else in this file stays exactly as it is** — the buffer reuse keyed on `frequencyBinCount` / `fftSize`, the cached theme palette, the `paused` gate, and the imperative indicator update through a ref. Those are already correct and their comments explain why.

**No new pure logic is created here, so there is no test to write.** The gate is `bun run verify` staying green plus the manual scope check.

**Steps:**

- [ ] Replace the read-and-classify block. Find:
  ```tsx
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);

        // Check if there is actual audio activity (filter out digital silence & DC bias)
        let energy = 0;
        for (let i = 0; i < bufferLength; i++) {
          energy += freqData[i];
        }
        const avgEnergy = energy / bufferLength;

        let maxDeviation = 0;
        for (let i = 0; i < timeData.length; i++) {
          const dev = Math.abs(timeData[i] - 128);
          if (dev > maxDeviation) maxDeviation = dev;
        }

        // Strictly consider sounding only if audio is genuinely active
        const isSounding = avgEnergy > 2.5 && maxDeviation > 3;
  ```
  Replace with:
  ```tsx
        // The oscilloscope draws from timeData alone, so neither the frequency
        // read nor the avgEnergy loop earns its keep there — and SynthView
        // keeps an inline scope alive alongside the panel visualizer.
        const needsFrequencyData = mode !== 'oscilloscope';
        if (needsFrequencyData) {
          analyser.getByteFrequencyData(freqData);
        }
        analyser.getByteTimeDomainData(timeData);

        // Check if there is actual audio activity (filter out digital silence & DC bias)
        let maxDeviation = 0;
        for (let i = 0; i < timeData.length; i++) {
          const dev = Math.abs(timeData[i] - 128);
          if (dev > maxDeviation) maxDeviation = dev;
        }

        // Strictly consider sounding only if audio is genuinely active. The
        // spectrum modes keep the original two-term test verbatim: maxDeviation
        // alone would also accept a sub-audio LFO sweep that avgEnergy rejects.
        // The oscilloscope uses the time-domain term only — it has no frequency
        // data to consult, and a DC offset is a steady deviation from 128 that
        // maxDeviation catches on its own.
        let isSounding: boolean;
        if (needsFrequencyData) {
          let energy = 0;
          for (let i = 0; i < bufferLength; i++) {
            energy += freqData[i];
          }
          isSounding = energy / bufferLength > 2.5 && maxDeviation > 3;
        } else {
          isSounding = maxDeviation > 3;
        }
  ```
  Note `mode !== 'oscilloscope'` rather than `mode === 'bars' || mode === 'wave'`: the render switch at the bottom of the function falls through to `renderSpectrumWave` for anything that is not `'bars'` or `'oscilloscope'`, so this phrasing matches the branch that actually consumes `freqData`.

- [ ] Confirm nothing else in the file changed:
  ```bash
  git diff --stat src/components/AudioVisualizer.tsx
  ```
  Expect a single hunk of roughly +20/-11 lines.

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] Manual check: `bun run dev`, play something. On the Monitor/panel visualizer cycle through `bars` and `wave` — the "live signal" indicator and the trace must behave exactly as before. Then check the inline oscilloscope in the Synth view: it must still go flat when nothing is sounding and trace when it is.

- [ ] Commit:
  ```bash
  git add src/components/AudioVisualizer.tsx
  git commit -m "perf(visualizer): skip the frequency read in oscilloscope mode

Every frame read both getByteFrequencyData and getByteTimeDomainData and ran
a full bufferLength loop for avgEnergy, but the oscilloscope draws from
timeData alone. Gate the frequency read and the avgEnergy loop on the modes
that consume them; the two-term isSounding test is kept verbatim for
bars/wave so their output is bit-identical."
  ```

---

### Task 8: Bundle — vendor chunks, lazy preset drawers, drop the unused dep

**Files:**
- `vite.config.ts` — add a `build` key
- `package.json` — remove `motion` from `dependencies`
- `src/components/chord/progressionAvailability.ts` — new
- `src/components/ChordPresetLibrary.tsx` — lines 55-64 (`isProgressionAvailable`), line 125 (`filterEntries`)
- `src/components/ChordView.tsx` — line 70 (the `ChordPresetLibrary` import), line 1181 (the usage site)
- `src/components/SynthView.tsx` — line 41 (the `SynthPresetLibrary` import), line 1484 (the usage site)
- `src/components/SynthPresetLibrary.tsx` — line 117 (`filterEntries`)

**Interfaces:**
- Produces: `isProgressionAvailable(p: ChordProgression, scaleType: string): boolean` from `src/components/chord/progressionAvailability.ts`, re-exported from `src/components/ChordPresetLibrary.tsx` so `ChordPresetLibrary.test.tsx` keeps working unchanged
- Consumes: `React.lazy(factory: () => Promise<{ default: ComponentType }>)`, `Suspense`
- Consumes: `filterEntries?: (entry: T, query: string, category: string) => boolean` — the `ui/PresetLibrary` prop at `src/components/ui/PresetLibrary.tsx:66`, in the `filtered` useMemo dep array at `:119`

**Baseline (measured):** one chunk, `dist/assets/index-*.js` 498.10 kB / 145.09 kB gzip, plus 154.75 kB CSS.

**No new pure logic is created here, so there is no test to write.** The gate is `bun run verify` staying green plus the recorded build output.

**Steps:**

- [ ] Confirm `motion` really has no importer anywhere before removing it:
  ```bash
  grep -rn "from ['\"]motion" src scripts index.html vite.config.ts || echo "no motion imports"
  grep -rn "framer-motion" src scripts || echo "no framer-motion imports"
  ```
  Both must report no imports. If either finds one, stop and report it instead of removing the dependency.

- [ ] Remove `motion` from `package.json`'s `dependencies` — delete the line:
  ```json
      "motion": "^13.1.1",
  ```

- [ ] Refresh the lockfile:
  ```bash
  bun install
  ```

- [ ] Add vendor chunking to `vite.config.ts`. Change the config object from:
  ```ts
  export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
  ```
  to:
  ```ts
  export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Split the three biggest third-party trees out of the app chunk so
          // an app-code edit stops invalidating them in the browser cache.
          manualChunks: {
            tonal: ['tonal'],
            dndkit: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
            icons: ['lucide-react'],
          },
        },
      },
    },
    resolve: {
  ```

- [ ] Create `src/components/chord/progressionAvailability.ts` so `ChordView` can stop statically importing the whole drawer module:
  ```ts
  import type { ChordProgression } from '../../audio/data/chordProgressions';
  import { SCALES } from '../../utils/musicTheory';

  /**
   * A progression is only offered in a scale that has at least as many degrees
   * as it was authored against. Entries that fail are hidden rather than
   * resolved with wrapped degrees, which would silently produce a different
   * progression.
   *
   * An unknown scaleType is treated as seven degrees, matching SCALES' own
   * `|| SCALES['Major']` fallback.
   *
   * Lives in its own module so ChordView can import it without pulling the
   * lazily-loaded ChordPresetLibrary back into the main chunk.
   */
  export function isProgressionAvailable(p: ChordProgression, scaleType: string): boolean {
    return (SCALES[scaleType]?.intervals.length ?? 7) >= p.minScaleLength;
  }
  ```

- [ ] In `src/components/ChordPresetLibrary.tsx`, delete the local definition (the doc comment plus the function at lines 55-64) and replace it with an import + re-export placed just below the existing imports:
  ```ts
  import { isProgressionAvailable } from './chord/progressionAvailability';

  export { isProgressionAvailable };
  ```
  The internal call at line 100 keeps working unchanged, and `ChordPresetLibrary.test.tsx`'s `import { ChordPresetLibrary, isProgressionAvailable } from './ChordPresetLibrary'` keeps resolving.

- [ ] Point `ChordView` at the new module. In `src/components/ChordView.tsx` change:
  ```tsx
  import { ChordPresetLibrary, isProgressionAvailable } from "./ChordPresetLibrary";
  ```
  to:
  ```tsx
  import { isProgressionAvailable } from "./chord/progressionAvailability";

  // The drawer is never needed on first paint — PresetLibrary early-returns
  // null when closed — so it is code-split out of the main chunk.
  const ChordPresetLibrary = React.lazy(() =>
    import("./ChordPresetLibrary").then((m) => ({ default: m.ChordPresetLibrary })),
  );
  ```
  Move the `React.lazy` declaration below the import block, at module scope above `ChordView`.

- [ ] Add `Suspense` to `ChordView`'s react import:
  ```tsx
  import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
    Suspense,
  } from "react";
  ```

- [ ] Wrap the `ChordPresetLibrary` usage in `ChordView` (line 1181). Replace:
  ```tsx
        <ChordPresetLibrary
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          currentChords={chords}
          scaleRoot={scaleRoot}
          scaleType={scaleType}
          autoReharmonize={autoReharmonize}
          synthParams={synthParams}
          onApplyChords={handleApplyLibraryChords}
        />
  ```
  with:
  ```tsx
        <Suspense
          fallback={
            isLibraryOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
                <span className="loading loading-spinner loading-lg text-primary" />
              </div>
            ) : null
          }
        >
          <ChordPresetLibrary
            isOpen={isLibraryOpen}
            onClose={() => setIsLibraryOpen(false)}
            currentChords={chords}
            scaleRoot={scaleRoot}
            scaleType={scaleType}
            autoReharmonize={autoReharmonize}
            synthParams={synthParams}
            onApplyChords={handleApplyLibraryChords}
          />
        </Suspense>
  ```

- [ ] Do the same for `SynthView`. Replace the static import at line 41:
  ```tsx
  import { SynthPresetLibrary } from "./SynthPresetLibrary";
  ```
  with a module-scope lazy declaration placed after the import block:
  ```tsx
  // The drawer is never needed on first paint — PresetLibrary early-returns
  // null when closed — so it is code-split out of the main chunk.
  const SynthPresetLibrary = React.lazy(() =>
    import("./SynthPresetLibrary").then((m) => ({ default: m.SynthPresetLibrary })),
  );
  ```

- [ ] Add `Suspense` to `SynthView`'s react import:
  ```tsx
  import React, {
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
    Suspense,
  } from "react";
  ```

- [ ] Wrap the `SynthPresetLibrary` usage in `SynthView` (line 1484). Replace:
  ```tsx
        <SynthPresetLibrary
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          currentParams={params}
          target={controlTarget}
          showSoundBadges={synthViewMode === "pro"}
          onSelectPreset={(preset) => {
            handleSelectPreset(preset);
            setIsLibraryOpen(false);
          }}
        />
  ```
  with:
  ```tsx
        <Suspense
          fallback={
            isLibraryOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
                <span className="loading loading-spinner loading-lg text-primary" />
              </div>
            ) : null
          }
        >
          <SynthPresetLibrary
            isOpen={isLibraryOpen}
            onClose={() => setIsLibraryOpen(false)}
            currentParams={params}
            target={controlTarget}
            showSoundBadges={synthViewMode === "pro"}
            onSelectPreset={(preset) => {
              handleSelectPreset(preset);
              setIsLibraryOpen(false);
            }}
          />
        </Suspense>
  ```

- [ ] Fold-in — stabilise `filterEntries` in `src/components/SynthPresetLibrary.tsx` (line 117) so `ui/PresetLibrary`'s `filtered` memo can actually hit. Change:
  ```tsx
    const filterEntries = (e: SynthLibraryEntry, query: string, categoryId: string) => {
  ```
  to:
  ```tsx
    // Stable identity: this is in the dep array of the `filtered` useMemo
    // inside ui/PresetLibrary, so a fresh function every render defeated it.
    // The body reads only its own arguments, so [] is complete.
    const filterEntries = useCallback((e: SynthLibraryEntry, query: string, categoryId: string) => {
  ```
  and change its closing `};` to:
  ```tsx
    }, []);
  ```
  Add `useCallback` to that file's react import if it is not already there.

- [ ] Fold-in — do the same for `src/components/ChordPresetLibrary.tsx` (line 125). Change:
  ```tsx
    const filterEntries = (e: ChordLibraryEntry, query: string, categoryId: string) => {
  ```
  to:
  ```tsx
    // Stable identity — see the note in SynthPresetLibrary. The body reads
    // only its own arguments, so [] is complete.
    const filterEntries = useCallback((e: ChordLibraryEntry, query: string, categoryId: string) => {
  ```
  and change its closing `};` to:
  ```tsx
    }, []);
  ```
  Add `useCallback` to that file's react import if it is not already there.

- [ ] Run the gate:
  ```bash
  bun run verify
  ```

- [ ] This task moved and added imports, so also run:
  ```bash
  bun run eslint
  ```

- [ ] Record the new build output. Run:
  ```bash
  bun run build
  ```
  and paste the `dist/assets/*.js` size lines into the commit body. **Expected shape** (sizes approximate — record the real numbers, do not copy these):
  - `dist/assets/tonal-*.js` — the `tonal` tree, roughly 90-130 kB
  - `dist/assets/dndkit-*.js` — `@dnd-kit/*`, roughly 40-60 kB
  - `dist/assets/icons-*.js` — the tree-shaken `lucide-react` icons actually used, roughly 15-30 kB
  - `dist/assets/SynthPresetLibrary-*.js` and `dist/assets/ChordPresetLibrary-*.js` — the two drawers plus the shared `ui/PresetLibrary`, each roughly 15-40 kB
  - `dist/assets/index-*.js` — the remainder, expected well below the 498.10 kB baseline
  - CSS is unchanged at ≈154.75 kB (this task does not touch styles)

- [ ] Manual check: `bun run dev`, open the Synth preset drawer and the Chords progression library. Each must open (a brief spinner overlay on the first open is expected and correct), filter by category chip, filter by search text, select an entry, and close.

- [ ] Commit:
  ```bash
  git add vite.config.ts package.json bun.lock src/components/chord/progressionAvailability.ts src/components/ChordPresetLibrary.tsx src/components/ChordView.tsx src/components/SynthView.tsx src/components/SynthPresetLibrary.tsx
  git commit -m "perf(build): vendor chunks, lazy preset drawers, drop unused motion dep

One 498 kB chunk became a set: tonal, @dnd-kit and lucide-react are split so
an app edit stops invalidating them, and the three preset drawers are
React.lazy since PresetLibrary early-returns null when closed.
isProgressionAvailable moved to its own module because ChordView's static
import of it would have kept the drawer in the main chunk. motion
(framer-motion v13) had zero importers and is removed. Also stabilises
filterEntries in both drawers, which was defeating ui/PresetLibrary's
filtered useMemo."
  ```

---

## Final verification

- [ ] Full gate from a clean tree:
  ```bash
  bun run verify && bun run eslint
  ```
- [ ] Confirm the theme allowlist is still empty:
  ```bash
  grep -n "ALLOWLIST" -A3 scripts/themeTokenGuard.ts
  ```
- [ ] Confirm no `tailwind.config.*` was added:
  ```bash
  ls tailwind.config.* 2>/dev/null && echo "FAIL: config added" || echo "ok"
  ```
- [ ] Review the eight commits read as one coherent story:
  ```bash
  git log --oneline main..HEAD
  ```
