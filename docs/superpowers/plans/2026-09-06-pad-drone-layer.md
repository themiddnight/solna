# Pad / Drone Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth generative layer, `pad`, that rides the Chords player and plays either the current chord legato (pad mode) or a fixed scale degree held for a whole loop pass (drone mode).

**Architecture:** The pad has no rhythm pattern, so it has no per-step emission — one arm is one note-on/note-off pair through the existing `playFullHoldChord`. All theory lives in a new pure module `src/audio/playback/padPlayback.ts`; the only wiring into the transport is a single `armPad(...)` call in the branch of `useChordPlayback` that already arms a chord. State is eight per-loop keys in `LOOP_FLAT_KEYS`, required rather than optional, backfilled by both migration chains.

**Tech Stack:** TypeScript, React 18, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API, `tonal` for note/interval math, Tailwind v4 + daisyUI, Bun (test runner + scripts), Vite.

**Spec:** `docs/superpowers/specs/2026-09-06-pad-drone-layer-design.md`

## Global Constraints

- **Layering (enforced by eslint `no-restricted-imports`):** `src/audio/` must not import `store/` or `components/`. `src/store/` must not import `components/`. `src/components/` must not import `audio/engine`.
- **Tests are `bun:test`. There is no DOM and no testing-library in this repo, and none may be added.** Prefer pure-logic tests; rendered tests use `renderToString` from `react-dom/server` and assert on substrings.
- **The zustand + `renderToString` trap:** `getServerSnapshot` returns state captured at store creation, so `useAppStore.setState(...)` before a `renderToString` has no effect and the assertion silently checks the wrong value. Never test pad mode switching through a render; test the exported pure helper instead.
- **`src/types.ts` imports only the leaf module `./utils/meter` and must stay acyclic.** `PadMode`, `PadVoicing` and `PadInterval` are literal unions — they add no import.
- **Engine setters are never called from a component.** New engine-settable state goes into a slice and is wired in `src/store/engineSync.ts`.
- **Tailwind v4 scans source statically.** Class names in `TONE_CLASS`-style records must be complete literal strings; an interpolated class name emits no CSS at all.
- **The completion gate is `bun run verify`** (test + lint + eslint + check:keys + check:drums + build). `bun run eslint` must report zero errors.
- **Branch:** all work lands on `feat/pad-drone-layer`, which already exists and already holds the spec. Do not commit to `main`.
- **`padSynthParams` default preset id:** `factory-warm-polypad`.
- **Pad fader ceiling:** `max={1.5}` (the value chord and bass use).
- **Pad module hue:** amber ≈ 40°, a new `--module-pad` token in both theme blocks.

## Ordering note

The spec's section order is not the build order. Two adjustments were made after reading the source:

1. **The Synth-tab task (Task 8) must precede the Pad card (Task 9).** `SynthControlTarget` is consumed by `AdjustSynthButton` (`src/components/loop/chord/AdjustSynthButton.tsx:11`), which the pad card renders. Widening that union also breaks `SYNTH_TARGET_STYLES` (a `Record<SynthControlTarget, …>`), `resolveSynthControlChannel` and `SynthView` at compile time, so the widening and every site it breaks must land in **one** task or `bun run verify` cannot pass at the task boundary.
2. **Theme tokens (Task 7) must precede Tasks 8 and 9**, because both reference `module-pad` classes that do not exist until the CSS variables and the `tint-pad` utility are declared.

---

### Task 1: Pad type unions and `DEFAULT_PAD_STATE`

**Files:**
- Modify: `src/types.ts:34` (after `ArrangementTrackType`)
- Modify: `src/store/initialState.ts` (append)
- Test: `src/store/initialState.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PadMode = 'pad' | 'drone'` (from `src/types.ts`)
  - `type PadVoicing = 'triad' | 'open5' | 'root'` (from `src/types.ts`)
  - `type PadInterval = 1 | 4 | 5 | 8 | 12` (from `src/types.ts`)
  - `const PAD_INTERVALS: readonly PadInterval[]` (from `src/types.ts`)
  - `const PAD_DEFAULT_PRESET_ID = 'factory-warm-polypad'` (from `src/store/initialState.ts`)
  - `const INITIAL_PAD_SYNTH_PARAMS: SynthParams` (from `src/store/initialState.ts`)
  - `const DEFAULT_PAD_STATE` (from `src/store/initialState.ts`) — an object with all eight pad keys, `padMuted: false`

- [ ] **Step 1: Write the failing test**

Create `src/store/initialState.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { presetById } from '../audio/synthPresets';
import { PAD_INTERVALS } from '../types';
import { DEFAULT_PAD_STATE, INITIAL_PAD_SYNTH_PARAMS, PAD_DEFAULT_PRESET_ID } from './initialState';

describe('pad defaults', () => {
  // The default is resolved by id at module load. If the id is ever renamed in
  // synthPresets.ts, INITIAL_PAD_SYNTH_PARAMS would silently fall back to the
  // bare INITIAL_SYNTH_PARAMS and every new project would ship a raw saw as its
  // "pad". This test is the only thing that makes that rename loud.
  test('the default pad preset id resolves to a Pad-category preset', () => {
    const preset = presetById(PAD_DEFAULT_PRESET_ID);
    expect(preset?.category).toBe('Pad');
  });

  test('INITIAL_PAD_SYNTH_PARAMS is the resolved preset, not the bare synth default', () => {
    const preset = presetById(PAD_DEFAULT_PRESET_ID);
    expect(INITIAL_PAD_SYNTH_PARAMS.oscType).toBe(preset!.params.oscType!);
    expect(INITIAL_PAD_SYNTH_PARAMS.filterCutoff).toBe(preset!.params.filterCutoff!);
  });

  // padMuted:false is the NEW-project default. The migrations deliberately
  // override it to true. See the migration task; collapsing the two is the
  // failure this pair of expectations exists to catch.
  test('a new project ships an audible pad', () => {
    expect(DEFAULT_PAD_STATE.padMuted).toBe(false);
  });

  test('the default drone selection is root + fifth + octave on degree I', () => {
    expect(DEFAULT_PAD_STATE.padDroneDegree).toBe(0);
    expect(DEFAULT_PAD_STATE.padDroneIntervals).toEqual([1, 5, 8]);
  });

  test('every default interval is a member of the union', () => {
    for (const i of DEFAULT_PAD_STATE.padDroneIntervals) {
      expect(PAD_INTERVALS).toContain(i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/initialState.test.ts`
Expected: FAIL — `Export named 'PAD_INTERVALS' not found in module .../src/types.ts`

- [ ] **Step 3: Add the unions to `src/types.ts`**

Insert immediately after the `ArrangementTrackType` line (`src/types.ts:34`):

```ts
/** The pad layer's two articulations. `pad` follows the chords; `drone` does not. */
export type PadMode = 'pad' | 'drone';

/** How a chord is reduced before the pad plays it. Dormant in drone mode. */
export type PadVoicing = 'triad' | 'open5' | 'root';

/**
 * Intervals a drone may stack over its degree's root, in scale-degree-free
 * interval numbers: 1 = unison, 4 = perfect fourth, 5 = perfect fifth,
 * 8 = octave, 12 = perfect twelfth (an octave plus a fifth, 19 semitones).
 *
 * A literal union, not an enum: this file must keep importing nothing but the
 * leaf `utils/meter`, and these values are persisted verbatim in `.solna`
 * bodies, so the numbers are the contract.
 */
export type PadInterval = 1 | 4 | 5 | 8 | 12;

/** Render order for the interval toggles, and the validation set for sanitize. */
export const PAD_INTERVALS: readonly PadInterval[] = [1, 4, 5, 8, 12];
```

- [ ] **Step 4: Add the defaults to `src/store/initialState.ts`**

Add to the imports at the top of the file:

```ts
import { applyPreset, presetById } from '../audio/synthPresets';
import type { PadInterval, PadMode, PadVoicing } from '../types';
```

Append at the end of the file:

```ts
/** The Pad-category factory preset a fresh pad starts from. */
export const PAD_DEFAULT_PRESET_ID = 'factory-warm-polypad';

const PAD_DEFAULT_PRESET = presetById(PAD_DEFAULT_PRESET_ID);

/**
 * Built the same way `createDefaultLoop` builds `bassSynthParams`: the shared
 * synth defaults with a factory preset laid over them. Falls back to the bare
 * defaults if the id ever stops resolving — initialState.test.ts is what makes
 * that fallback loud instead of silent.
 */
export const INITIAL_PAD_SYNTH_PARAMS: SynthParams = PAD_DEFAULT_PRESET
  ? applyPreset(INITIAL_SYNTH_PARAMS, PAD_DEFAULT_PRESET)
  : INITIAL_SYNTH_PARAMS;

/**
 * Every pad key with its NEW-project value. Both migration chains spread this
 * and then override `padMuted` to `true`, because a project saved before the
 * pad existed must reopen sounding the way it sounded when it was closed.
 *
 * Do NOT collapse that override into this constant. Doing so gives every
 * pre-existing project a voice its author never wrote, and nothing in the UI
 * or the build would show it — three tests pin the distinction (see
 * initialState.test.ts, migrate.test.ts and projectFormat.test.ts).
 */
export const DEFAULT_PAD_STATE: {
  padSynthParams: SynthParams;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  padVolume: number;
  padMuted: boolean;
} = {
  padSynthParams: INITIAL_PAD_SYNTH_PARAMS,
  padMode: 'pad',
  padOctave: 3,
  padVoicing: 'triad',
  padDroneDegree: 0,
  padDroneIntervals: [1, 5, 8],
  padVolume: 1.0,
  padMuted: false,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/store/initialState.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/store/initialState.ts src/store/initialState.test.ts
git commit -m "feat(types): add the pad layer's unions and default state"
```

---

### Task 2: `padPlayback.ts` — the pure theory core

**Files:**
- Create: `src/audio/playback/padPlayback.ts`
- Create: `src/audio/playback/padPlayback.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts:214` (add a `source` parameter to `playFullHoldChord`)
- Modify: `src/components/loop/chord/useChordPlayback.ts:250` and `:429` (the two existing `playFullHoldChord` call sites)
- Modify: `src/audio/playback/chordPlayback.test.ts:508` (a **third** call site: `playFullHoldChord(notes, SYNTH, 10, 4)` — it must gain a final `"chord"` argument or `bun run lint` fails)

**Interfaces:**
- Consumes: `PadInterval`, `PadMode`, `PadVoicing` from `src/types.ts` (Task 1).
- Produces:
  - `resolveDroneNotes(degree: number, intervals: readonly PadInterval[], octave: number, scaleRoot: string, scaleType: string): string[]`
  - `applyPadVoicing(chordNotes: readonly string[], voicing: PadVoicing): string[]`
  - `padHoldSec(mode: PadMode, chordBars: number, loopBars: number, barDur: number): number`
  - `playFullHoldChord(notes, params, startTime, holdSec, source)` — fifth parameter added

- [ ] **Step 1: Write the failing test**

Create `src/audio/playback/padPlayback.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Note } from 'tonal';
import { applyPadVoicing, padHoldSec, resolveDroneNotes } from './padPlayback';

const midi = (n: string) => Note.midi(n)!;

describe('resolveDroneNotes', () => {
  test('degree I in C major gives root, fifth and octave', () => {
    const notes = resolveDroneNotes(0, [1, 5, 8], 3, 'C', 'Major');
    expect(notes).toEqual(['C3', 'G3', 'C4']);
  });

  // Asserted on semitone distance, not on the spelled name: 12P is one
  // interval (a perfect twelfth), not an octave composed with a fifth, and a
  // name comparison would pass for a wrong-but-enharmonic implementation.
  test('12P is nineteen semitones above the root and 8P is twelve', () => {
    const notes = resolveDroneNotes(0, [1, 8, 12], 3, 'C', 'Major');
    expect(midi(notes[1]) - midi(notes[0])).toBe(12);
    expect(midi(notes[2]) - midi(notes[0])).toBe(19);
  });

  test('4P is five semitones above the root', () => {
    const notes = resolveDroneNotes(0, [1, 4], 3, 'C', 'Major');
    expect(midi(notes[1]) - midi(notes[0])).toBe(5);
  });

  // Hirajoshi has five degrees. getDiatonicChordForDegree already wraps, and
  // the drone must inherit that rather than clamp: the stored degree survives
  // a trip through a shorter scale and comes back intact.
  test('the degree wraps on a five-degree scale', () => {
    const wrapped = resolveDroneNotes(6, [1], 3, 'A', 'Hirajoshi');
    const direct = resolveDroneNotes(1, [1], 3, 'A', 'Hirajoshi');
    expect(wrapped).toEqual(direct);
  });

  // INTENTIONAL, NOT A BUG — do not "fix" this by snapping into the scale or
  // by reading the diatonic chord's fifth. A drone's identity is the PERFECT
  // fifth; deriving it from the vii° chord would give a tritone held for a
  // whole loop pass, which is strictly worse than a note outside the key.
  // See the spec's "Drone's out-of-scale fifth on the leading tone is
  // intended" section.
  test('degree vii in C major yields a fifth outside the key, on purpose', () => {
    const notes = resolveDroneNotes(6, [1, 5], 3, 'C', 'Major');
    expect(midi(notes[0]) % 12).toBe(Note.chroma('B'));
    expect(midi(notes[1]) - midi(notes[0])).toBe(7);
    expect(midi(notes[1]) % 12).toBe(Note.chroma('F#'));
  });

  test('an empty interval set yields no notes', () => {
    expect(resolveDroneNotes(0, [], 3, 'C', 'Major')).toEqual([]);
  });
});

describe('applyPadVoicing', () => {
  test('triad returns the chord unchanged', () => {
    expect(applyPadVoicing(['C3', 'E3', 'G3'], 'triad')).toEqual(['C3', 'E3', 'G3']);
  });

  test('open5 keeps the root and the third chord tone', () => {
    expect(applyPadVoicing(['C3', 'E3', 'G3'], 'open5')).toEqual(['C3', 'G3']);
  });

  test('root keeps only the lowest tone', () => {
    expect(applyPadVoicing(['C3', 'E3', 'G3'], 'root')).toEqual(['C3']);
  });

  // A pentatonic or Hirajoshi voicing can be shorter than three notes, so
  // open5 falls back notes[2] -> notes[1] -> notes[0], the same chain
  // resolveBassSteps uses for its chord-tone tokens.
  test('open5 falls back to the second tone when there is no third', () => {
    expect(applyPadVoicing(['C3', 'G3'], 'open5')).toEqual(['C3', 'G3']);
  });

  test('open5 falls back to the root alone on a one-note chord', () => {
    expect(applyPadVoicing(['C3'], 'open5')).toEqual(['C3']);
  });

  test('an empty chord yields an empty voicing in every mode', () => {
    expect(applyPadVoicing([], 'triad')).toEqual([]);
    expect(applyPadVoicing([], 'open5')).toEqual([]);
    expect(applyPadVoicing([], 'root')).toEqual([]);
  });
});

describe('padHoldSec', () => {
  test('pad mode holds for the chord, drone mode holds for the loop', () => {
    expect(padHoldSec('pad', 2, 8, 2)).toBe(4);
    expect(padHoldSec('drone', 2, 8, 2)).toBe(16);
  });

  test('a zero-bar chord or loop never produces a negative hold', () => {
    expect(padHoldSec('pad', 0, 0, 2)).toBe(2);
    expect(padHoldSec('drone', 0, 0, 2)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/playback/padPlayback.test.ts`
Expected: FAIL — `Cannot find module './padPlayback'`

- [ ] **Step 3: Write `src/audio/playback/padPlayback.ts`**

```ts
import { transpose } from 'tonal';
import { getDiatonicChordForDegree } from '../../utils/musicTheory';
import type { PadInterval, PadMode, PadVoicing } from '../../types';

/**
 * Interval names for `tonal`. `12P` is a perfect twelfth — one interval name,
 * nineteen semitones — not an octave shift composed with a fifth. The
 * music-theory skill's rule applies: transposition goes through interval
 * notation, never through surgery on the octave digit of a note name.
 */
const INTERVAL_NAME: Record<PadInterval, string> = {
  1: '1P',
  4: '4P',
  5: '5P',
  8: '8P',
  12: '12P',
};

/**
 * The notes a drone holds: the chosen scale degree's root at `octave`,
 * transposed by each selected interval.
 *
 * The intervals are FIXED — the diatonic chord's own quality is never read.
 * That is what makes a drone sound like a drone (the tanpura is tuned to the
 * tonic and the perfect fifth), and it is why degree vii in a major key
 * produces a fifth outside the key. See padPlayback.test.ts; that behaviour is
 * pinned deliberately.
 *
 * `getDiatonicChordForDegree` wraps the degree index, so a degree stored while
 * a seven-note scale was active stays valid — and audible — under a five-note
 * one, and comes back unchanged when the scale is restored.
 */
export function resolveDroneNotes(
  degree: number,
  intervals: readonly PadInterval[],
  octave: number,
  scaleRoot: string,
  scaleType: string,
): string[] {
  if (intervals.length === 0) return [];
  const { root } = getDiatonicChordForDegree(degree, scaleRoot, scaleType, false);
  const base = `${root}${octave}`;
  const out: string[] = [];
  for (const interval of intervals) {
    const note = transpose(base, INTERVAL_NAME[interval]);
    if (note) out.push(note);
  }
  return out;
}

/**
 * Reduces a chord for pad mode.
 *
 * `open5` wants the chord's third tone, but a pentatonic or Hirajoshi voicing
 * can be shorter than three notes — so it falls back notes[2] -> notes[1] ->
 * notes[0], the same chain `resolveBassSteps` walks for its chord-tone tokens.
 * Without it an `open5` pad on a five-note scale would emit `undefined` as a
 * note name.
 */
export function applyPadVoicing(
  chordNotes: readonly string[],
  voicing: PadVoicing,
): string[] {
  if (chordNotes.length === 0) return [];
  switch (voicing) {
    case 'root':
      return [chordNotes[0]];
    case 'open5': {
      const upper = chordNotes[2] ?? chordNotes[1] ?? chordNotes[0];
      return upper === chordNotes[0] ? [chordNotes[0]] : [chordNotes[0], upper];
    }
    case 'triad':
    default:
      return [...chordNotes];
  }
}

/**
 * How long one arm holds. Pad mode is armed per chord and holds for that
 * chord; drone mode is armed once per loop pass and holds for the whole pass.
 *
 * Both floor at a single bar so a malformed chord (`bars: 0`) or an empty
 * progression can never schedule a note-off at or before its own note-on.
 */
export function padHoldSec(
  mode: PadMode,
  chordBars: number,
  loopBars: number,
  barDur: number,
): number {
  const bars = mode === 'drone' ? loopBars : chordBars;
  return Math.max(1, bars) * barDur;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/audio/playback/padPlayback.test.ts`
Expected: PASS, 15 tests

- [ ] **Step 5: Add the `source` parameter to `playFullHoldChord`**

In `src/audio/playback/chordPlayback.ts`, replace the function at `:214` (its two hardcoded `"chord"` literals are at `:226` and `:232`):

```ts
// Held full-bar chord: strike every note together and release them together.
// `source` is a parameter rather than a constant because the pad layer holds
// its voicing exactly this way on its own bus — copying the body to make a
// `playFullHoldPad` would leave two implementations to keep in step.
export function playFullHoldChord(
  notes: string[],
  params: SynthParams,
  startTime: number,
  holdSec: number,
  source: string,
): void {
  for (const n of notes) {
    audioEngine.triggerSynthNoteOn(
      n,
      params,
      DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),
      startTime,
      source,
    );
    audioEngine.triggerSynthNoteOff(
      n,
      params.release,
      startTime + holdSec,
      source,
    );
  }
}
```

- [ ] **Step 6: Update the three existing call sites**

Three call sites exist, not two. In `src/audio/playback/chordPlayback.test.ts:508`, change `playFullHoldChord(notes, SYNTH, 10, 4)` to `playFullHoldChord(notes, SYNTH, 10, 4, 'chord')`. Then in `src/components/loop/chord/useChordPlayback.ts`, both calls gain a final `"chord"` argument. At `:250`:

```ts
      playFullHoldChord(
        chordNotes,
        s.chordSynthParams,
        time,
        fullHoldDuration(totalBars, barDur, holdScale),
        "chord",
      );
```

and at `:429`:

```ts
          playFullHoldChord(
            chordNotes,
            params,
            time,
            fullHoldDuration(totalBars, barDur, holdScale),
            "chord",
          );
```

Read the surrounding lines before editing — the second call site is inside the pattern-preview path and its `params` variable is named differently from the transport path's. Keep whatever identifiers are already there; only the new argument is added.

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: all green. If `bun run lint` reports "Expected 5 arguments, but got 4", a `playFullHoldChord` call site was missed — `grep -rn "playFullHoldChord" src/` finds them all.

- [ ] **Step 8: Commit**

```bash
git add src/audio/playback/padPlayback.ts src/audio/playback/padPlayback.test.ts src/audio/playback/chordPlayback.ts src/components/loop/chord/useChordPlayback.ts
git commit -m "feat(audio): add the pad layer's note resolution and hold rules"
```

---

### Task 3: Store slice, loop keys and sanitize

**Files:**
- Create: `src/store/padSlice.ts`
- Modify: `src/store/types.ts` (add `PadSlice`, widen `Loop` and `LoopMixPatch`, add the slice to `AppStore`)
- Modify: `src/store/loop.ts:4` (`LOOP_FLAT_KEYS`)
- Modify: `src/store/loopSlice.ts:18` (`createDefaultLoop`)
- Modify: `src/store/store.ts` (compose the slice only — see the note below: `partializeAppState` must NOT gain the pad keys)
- Modify: `src/store/sanitize.ts:249` (`sanitizeLoops`)
- Test: `src/store/padSlice.test.ts` (create)

**Interfaces:**
- Consumes: `DEFAULT_PAD_STATE`, `INITIAL_PAD_SYNTH_PARAMS` (Task 1); `PadInterval`, `PadMode`, `PadVoicing`, `PAD_INTERVALS` (Task 1).
- Produces:
  - `createPadSlice(set): PadSlice` (from `src/store/padSlice.ts`)
  - Store actions: `setPadSynthParams`, `setPadMode`, `setPadOctave`, `setPadVoicing`, `setPadDroneDegree`, `togglePadDroneInterval`, `setPadVolume`, `togglePadMuted`
  - `asPadIntervals(value: unknown, fallback: PadInterval[]): PadInterval[]` (from `src/store/sanitize.ts`)
  - `asPadMode(value: unknown, fallback: PadMode): PadMode` (from `src/store/sanitize.ts`)
  - `asPadVoicing(value: unknown, fallback: PadVoicing): PadVoicing` (from `src/store/sanitize.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/store/padSlice.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { LOOP_FLAT_KEYS } from './loop';
import { createDefaultLoop } from './loopSlice';
import { asPadIntervals, asPadMode, asPadVoicing } from './sanitize';
import { useAppStore } from './store';

const PAD_KEYS = [
  'padSynthParams',
  'padMode',
  'padOctave',
  'padVoicing',
  'padDroneDegree',
  'padDroneIntervals',
  'padVolume',
  'padMuted',
] as const;

describe('pad state is per-loop', () => {
  // loopStatePatch writes every LOOP_FLAT_KEYS entry unconditionally, with no
  // guard and no ??. A pad key that is in the slice but missing from this list
  // would never round-trip through a loop switch; one that is in the list but
  // missing from createDefaultLoop would write undefined over the slice
  // default the first time a loop is activated.
  test('every pad key is in LOOP_FLAT_KEYS', () => {
    for (const key of PAD_KEYS) expect(LOOP_FLAT_KEYS).toContain(key);
  });

  test('createDefaultLoop supplies every pad key', () => {
    const loop = createDefaultLoop() as unknown as Record<string, unknown>;
    for (const key of PAD_KEYS) expect(loop[key]).toBeDefined();
  });

  test('the store hydrates with the pad audible', () => {
    expect(useAppStore.getState().padMuted).toBe(false);
  });
});

describe('pad actions', () => {
  test('togglePadDroneInterval adds and removes, keeping ascending order', () => {
    const s = useAppStore.getState();
    s.setPadDroneIntervals([1, 5]);
    useAppStore.getState().togglePadDroneInterval(4);
    expect(useAppStore.getState().padDroneIntervals).toEqual([1, 4, 5]);
    useAppStore.getState().togglePadDroneInterval(1);
    expect(useAppStore.getState().padDroneIntervals).toEqual([4, 5]);
  });

  test('unchecking the last interval is allowed and means a silent drone', () => {
    useAppStore.getState().setPadDroneIntervals([8]);
    useAppStore.getState().togglePadDroneInterval(8);
    expect(useAppStore.getState().padDroneIntervals).toEqual([]);
  });

  test('togglePadMuted flips', () => {
    const before = useAppStore.getState().padMuted;
    useAppStore.getState().togglePadMuted();
    expect(useAppStore.getState().padMuted).toBe(!before);
    useAppStore.getState().togglePadMuted();
  });
});

describe('pad sanitizers', () => {
  // The sort is not cosmetic. projectDirty fingerprints the content set, so
  // [5,1] and [1,5] — the same selection — would fingerprint differently and
  // raise an unsaved-changes badge that no edit caused.
  test('asPadIntervals filters, de-duplicates and sorts ascending', () => {
    expect(asPadIntervals([5, 1, 5, 99, 'x', 4], [1])).toEqual([1, 4, 5]);
  });

  test('asPadIntervals accepts an empty array as a real selection', () => {
    expect(asPadIntervals([], [1, 5, 8])).toEqual([]);
  });

  test('asPadIntervals falls back when the value is not an array', () => {
    expect(asPadIntervals('nope', [1, 5, 8])).toEqual([1, 5, 8]);
    expect(asPadIntervals(undefined, [1, 5, 8])).toEqual([1, 5, 8]);
  });

  test('asPadMode and asPadVoicing reject unknown values', () => {
    expect(asPadMode('drone', 'pad')).toBe('drone');
    expect(asPadMode('wobble', 'pad')).toBe('pad');
    expect(asPadVoicing('open5', 'triad')).toBe('open5');
    expect(asPadVoicing(7, 'triad')).toBe('triad');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/padSlice.test.ts`
Expected: FAIL — `Export named 'asPadIntervals' not found in module .../src/store/sanitize.ts`

- [ ] **Step 3: Write `src/store/padSlice.ts`**

```ts
import type { StoreApi } from 'zustand';
import { DEFAULT_PAD_STATE } from './initialState';
import type { AppStore, PadSlice } from './types';
import type { PadInterval } from '../types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Pad/drone module slice: a full synth voice plus the two modes' controls.
 *
 * `padVoicing` is dormant in drone mode and `padDroneDegree`/`padDroneIntervals`
 * are dormant in pad mode — both are still persisted, so switching modes back
 * and forth never loses a setting.
 */
export function createPadSlice(set: Set): PadSlice {
  return {
    ...DEFAULT_PAD_STATE,

    setPadSynthParams: (padSynthParams) => set({ padSynthParams }),
    setPadMode: (padMode) => set({ padMode }),
    setPadOctave: (padOctave) => set({ padOctave }),
    setPadVoicing: (padVoicing) => set({ padVoicing }),
    setPadDroneDegree: (padDroneDegree) => set({ padDroneDegree }),
    setPadVolume: (padVolume) => set({ padVolume }),
    togglePadMuted: () => set((state) => ({ padMuted: !state.padMuted })),

    // Stored ascending so the same selection always fingerprints the same way:
    // projectDirty hashes the content set, and [5,1] vs [1,5] would otherwise
    // raise an unsaved-changes badge that no edit caused.
    setPadDroneIntervals: (intervals) =>
      set({ padDroneIntervals: [...new Set(intervals)].sort((a, b) => a - b) }),

    togglePadDroneInterval: (interval: PadInterval) =>
      set((state) => {
        const next = state.padDroneIntervals.includes(interval)
          ? state.padDroneIntervals.filter((i) => i !== interval)
          : [...state.padDroneIntervals, interval];
        return { padDroneIntervals: next.sort((a, b) => a - b) };
      }),
  };
}
```

- [ ] **Step 4: Add `PadSlice` and widen the loop types in `src/store/types.ts`**

Add the pad types to the file's existing import from `../types` (it already imports `SynthParams`):

```ts
import type { PadInterval, PadMode, PadVoicing } from '../types';
```

Add the slice interface next to the other slice interfaces:

```ts
export interface PadSlice {
  padSynthParams: SynthParams;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  padVolume: number;
  padMuted: boolean;

  setPadSynthParams: (params: SynthParams) => void;
  setPadMode: (mode: PadMode) => void;
  setPadOctave: (octave: number) => void;
  setPadVoicing: (voicing: PadVoicing) => void;
  setPadDroneDegree: (degree: number) => void;
  setPadDroneIntervals: (intervals: PadInterval[]) => void;
  togglePadDroneInterval: (interval: PadInterval) => void;
  setPadVolume: (volume: number) => void;
  togglePadMuted: () => void;
}
```

Add `PadSlice` to the `AppStore` intersection type alongside the other slices.

Add the same eight fields to the `Loop` interface, immediately after `bassMuted` (`src/store/types.ts:344`):

```ts
  padSynthParams: SynthParams;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  padVolume: number;
  padMuted: boolean;
```

Widen `LoopMixPatch` (`:353`) and correct its doc comment — the comment is the type's specification, not decoration:

```ts
/** The per-loop mixer: the 10 volume/mute fields edited on each Arrange card. */
export type LoopMixPatch = Pick<
  Loop,
  | 'synthVolume'
  | 'synthMuted'
  | 'chordVolume'
  | 'chordMuted'
  | 'bassVolume'
  | 'bassMuted'
  | 'padVolume'
  | 'padMuted'
  | 'masterSequencerVolume'
  | 'drumMuted'
>;
```

- [ ] **Step 5: Add the keys to `LOOP_FLAT_KEYS`**

In `src/store/loop.ts`, insert after `'bassOctave'` in the array at `:4`:

```ts
  'padSynthParams',
  'padMode',
  'padOctave',
  'padVoicing',
  'padDroneDegree',
  'padDroneIntervals',
  'padVolume',
  'padMuted',
```

- [ ] **Step 6: Add the defaults to `createDefaultLoop`**

In `src/store/loopSlice.ts`, add `DEFAULT_PAD_STATE` to the existing `./initialState` import, and spread it into the returned object beside the other layers:

```ts
    ...DEFAULT_PAD_STATE,
```

- [ ] **Step 7: Compose the slice and persist the keys in `src/store/store.ts`**

Import `createPadSlice` from `./padSlice` alongside the other slice factories and add `...createPadSlice(set)` to the store creator beside `...createBassSlice(set)`.

**Do not touch `partializeAppState` (`:152`).** Its comment states the rule: it is an explicit allow-list of the global fields plus `loops`, and *"Every per-loop musical field lives inside `loops`; the flat copies in the live state are intentionally NOT persisted (they are the working copy of the active loop and are kept in sync by loopSync's live-write subscription)."* The pad keys reach storage through `loops`, exactly as `bassOctave` and `chordFeel` do. Adding them to the allow-list would persist a second, competing copy of the active loop's pad state.

Likewise **do not touch `PROJECT_CONTENT_KEYS`** (`src/store/projectFormat.ts:42`) — it lists `loops`, and that is the whole of the wiring. Saving writes the pad keys and `projectDirty` fingerprints them with no further change.

- [ ] **Step 8: Add the sanitizers**

In `src/store/sanitize.ts`, add the pad types to the imports from `../types`, then add the three helpers beside the existing `asPatternMode` / `asFilterType` group:

```ts
const PAD_MODES = new Set<string>(['pad', 'drone']);
const PAD_VOICINGS = new Set<string>(['triad', 'open5', 'root']);
const PAD_INTERVAL_SET = new Set<number>(PAD_INTERVALS);

export function asPadMode(value: unknown, fallback: PadMode): PadMode {
  return typeof value === 'string' && PAD_MODES.has(value) ? (value as PadMode) : fallback;
}

export function asPadVoicing(value: unknown, fallback: PadVoicing): PadVoicing {
  return typeof value === 'string' && PAD_VOICINGS.has(value)
    ? (value as PadVoicing)
    : fallback;
}

/**
 * Filters to union members, de-duplicates and sorts ascending.
 *
 * An empty result is a legal selection (a silent drone), so only a non-array
 * falls back. The sort is load-bearing: projectDirty fingerprints the content
 * set, and an unsorted array would let the same selection produce two
 * fingerprints and raise an unsaved-changes badge no edit caused.
 */
export function asPadIntervals(value: unknown, fallback: PadInterval[]): PadInterval[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<PadInterval>();
  for (const v of value) {
    if (typeof v === 'number' && PAD_INTERVAL_SET.has(v)) seen.add(v as PadInterval);
  }
  return [...seen].sort((a, b) => a - b);
}
```

- [ ] **Step 9: Sanitize the pad keys inside `sanitizeLoops`**

`sanitizeLoops` (`src/store/sanitize.ts:249`) builds each loop as an exhaustive object literal, so the eight keys must be listed there or they are dropped. Add after the `bassOctave` line:

```ts
      padSynthParams: sanitizeSynthParams(r.padSynthParams),
      padMode: asPadMode(r.padMode, fallback.padMode),
      padOctave: clampFinite(r.padOctave, 0, 8, fallback.padOctave),
      padVoicing: asPadVoicing(r.padVoicing, fallback.padVoicing),
      padDroneDegree: clampFinite(r.padDroneDegree, 0, 127, fallback.padDroneDegree),
      padDroneIntervals: asPadIntervals(r.padDroneIntervals, fallback.padDroneIntervals),
      padVolume: clampFinite(r.padVolume, 0, 1.5, fallback.padVolume),
      padMuted: asBoolean(r.padMuted),
```

`padDroneDegree` is clamped rather than modulo'd: the resolver wraps it at read time, so a large stored value is legal and must survive. The clamp only refuses a non-number or a negative index.

- [ ] **Step 10: Run test to verify it passes**

Run: `bun test src/store/padSlice.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 11: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 12: Commit**

```bash
git add src/store/padSlice.ts src/store/padSlice.test.ts src/store/types.ts src/store/loop.ts src/store/loopSlice.ts src/store/store.ts src/store/sanitize.ts
git commit -m "feat(store): add the pad slice and carry its keys through every loop"
```

---

### Task 4: Both migration chains, and the tests that keep the two defaults apart

**Files:**
- Modify: `src/store/migrate.ts` (add `migratePadLayer` beside `migrateLeadStepResolution` at `:309`)
- Modify: `src/store/store.ts:282` (bump the persist `version`) and `:287` (append the chain step)
- Modify: `src/store/projectFormat.ts:16` (bump `PROJECT_FORMAT_VERSION`)
- Modify: `src/store/projectFormatMigrate.ts:108` (append the chain step)
- Test: `src/store/migrate.test.ts` (extend)
- Test: `src/store/projectFormatMigrate.test.ts` (extend)

**Interfaces:**
- Consumes: `DEFAULT_PAD_STATE` (Task 1); `LOOP_FLAT_KEYS` (Task 3).
- Produces:
  - `migratePadLayer<T extends object>(state: T): T` (from `src/store/migrate.ts`)
  - `upgradePadLayerV4(raw: Record<string, unknown>): Record<string, unknown>` — module-private in `src/store/projectFormatMigrate.ts`, reached only through `migrateProjectBody`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/migrate.test.ts`:

```ts
import { DEFAULT_PAD_STATE } from './initialState';
import { migratePadLayer } from './migrate';

describe('migratePadLayer', () => {
  const PAD_KEYS = Object.keys(DEFAULT_PAD_STATE);

  // THE FIRST OF THE THREE TESTS THAT KEEP THE DEFAULTS APART.
  // A project written before the pad existed must reopen sounding the way it
  // sounded when it was closed. DEFAULT_PAD_STATE ships padMuted:false for new
  // projects; the migration overrides it to true. If a later refactor collapses
  // the two, this test is what goes red.
  test('a pre-pad loop is backfilled with the pad muted', () => {
    const out = migratePadLayer({ loops: [{ id: 'a', bassOctave: 2 }] }) as {
      loops: Record<string, unknown>[];
    };
    expect(out.loops[0].padMuted).toBe(true);
    expect(out.loops[0].padMode).toBe('pad');
    expect(out.loops[0].bassOctave).toBe(2);
  });

  // Backfilling only the active loop is the easy mistake here: loopStatePatch
  // writes every LOOP_FLAT_KEYS entry with no guard, so an unbackfilled loop
  // writes `undefined` over the slice defaults the moment the user switches to
  // it — and only then.
  test('every loop is backfilled, not only the first', () => {
    const out = migratePadLayer({
      loops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    }) as { loops: Record<string, unknown>[] };
    expect(out.loops).toHaveLength(4);
    for (const loop of out.loops) {
      for (const key of PAD_KEYS) expect(loop[key]).toBeDefined();
      expect(loop.padMuted).toBe(true);
    }
  });

  test('a loop that already carries pad state keeps nothing of its own', () => {
    // The step runs exactly once, at one version boundary, on payloads that by
    // definition predate the pad — so spreading over any stale value is right.
    const out = migratePadLayer({
      loops: [{ id: 'a', padVolume: 0.1, padMuted: false }],
    }) as { loops: Record<string, unknown>[] };
    expect(out.loops[0].padMuted).toBe(true);
    expect(out.loops[0].padVolume).toBe(DEFAULT_PAD_STATE.padVolume);
  });

  test('a payload with no loops passes through untouched', () => {
    expect(migratePadLayer({ bpm: 120 })).toEqual({ bpm: 120 });
  });
});
```

Append to `src/store/projectFormatMigrate.test.ts`:

```ts
import { DEFAULT_PAD_STATE } from './initialState';
import { migrateProjectBody } from './projectFormatMigrate';

describe('pad layer body upgrade', () => {
  // THE SECOND OF THE THREE. Same rule as the persist chain, enforced
  // separately because the two chains are deliberately not shared: a project
  // body is an external contract, a persist payload is private localStorage
  // shape, and their versions move for different reasons (CLAUDE.md).
  test('a body from before the pad opens with the pad muted', () => {
    const out = migrateProjectBody(
      { content: { loops: [{ id: 'a' }, { id: 'b' }] } },
      3,
    ) as { content: { loops: Record<string, unknown>[] } };
    for (const loop of out.content.loops) {
      expect(loop.padMuted).toBe(true);
      expect(loop.padDroneIntervals).toEqual(DEFAULT_PAD_STATE.padDroneIntervals);
    }
  });

  test('a body already at the current version is not re-backfilled', () => {
    const raw = { content: { loops: [{ id: 'a', padMuted: false }] } };
    const out = migrateProjectBody(raw, 4) as {
      content: { loops: Record<string, unknown>[] };
    };
    expect(out.content.loops[0].padMuted).toBe(false);
  });

  test('a body with no loops passes through', () => {
    expect(migrateProjectBody({ content: { bpm: 90 } }, 3)).toEqual({
      content: { bpm: 90 },
    });
  });
});
```

Append to `src/store/projectFormat.test.ts`:

```ts
import { DEFAULT_PAD_STATE } from './initialState';

// THE THIRD OF THE THREE. A NEW project ships an audible pad — that is the
// point of shipping the layer. Together with the two migration tests above,
// this pins the deliberate asymmetry: collapsing DEFAULT_PAD_STATE and the
// migrations' `padMuted: true` override into one constant turns exactly one of
// the three red.
test('a factory project ships the pad audible', () => {
  const content = factoryProjectContent();
  expect(content.loops[0].padMuted).toBe(false);
  expect(DEFAULT_PAD_STATE.padMuted).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts src/store/projectFormat.test.ts`
Expected: FAIL — `Export named 'migratePadLayer' not found in module .../src/store/migrate.ts`

- [ ] **Step 3: Add `migratePadLayer` to `src/store/migrate.ts`**

Add `import { DEFAULT_PAD_STATE } from './initialState';` to the file's imports, then append after `migrateLeadStepResolution` (`:309`):

```ts
/**
 * The pad/drone layer's eight per-loop fields. Every loop persisted before it
 * lacks them, and `loopStatePatch` writes each LOOP_FLAT_KEYS entry with no
 * guard — so an unbackfilled loop does not fall back to the slice defaults, it
 * writes `undefined` over them the moment it is activated.
 *
 * `padMuted` is overridden to `true` on purpose, against DEFAULT_PAD_STATE's
 * `false`. A new project gets an audible pad because that is the point of
 * shipping the layer; a project saved before the pad existed gets a silent one
 * because its author never wrote a pad and a reopened project must sound the
 * way it sounded when it was closed. Do not collapse these into one value —
 * the change is inaudible in review and only migrate.test.ts would catch it.
 *
 * Shares only DEFAULT_PAD_STATE — data — with the `.solna` chain's own step in
 * projectFormatMigrate.ts. The two traversals must NOT be merged.
 */
export function migratePadLayer<T extends object>(state: T): T {
  return mapLoops(state, (row) => ({
    ...row,
    ...DEFAULT_PAD_STATE,
    padMuted: true,
  }));
}
```

- [ ] **Step 4: Append the persist chain step in `src/store/store.ts`**

Add `migratePadLayer` to the existing `./migrate` import list. Bump the `version` at `:282` by one, and append one line to the bottom of the chain, directly after the `migrateLeadStepResolution` line — reading order is run order, and the file's comment states that a new version is one more line at the bottom:

```ts
        // v11 -> v12 (pad/drone layer)
        if (version < 12) next = migratePadLayer(next) as PersistedState;
```

Use whatever the current version number actually is: read the `version:` value at `:282` first, bump it, and make the guard match the new value.

- [ ] **Step 5: Append the project chain step**

In `src/store/projectFormat.ts`, bump `PROJECT_FORMAT_VERSION` at `:16` by one.

In `src/store/projectFormatMigrate.ts`, add `import { DEFAULT_PAD_STATE } from './initialState';`, then add the step function beside its siblings:

```ts
/**
 * v3 -> v4: every loop gains the pad/drone layer's eight fields, with the pad
 * MUTED — a project written before the layer existed must reopen sounding the
 * way it sounded when it was closed.
 *
 * Shares only DEFAULT_PAD_STATE with the persist chain's migratePadLayer, and
 * must not be refactored into one function with it: a project body is an
 * external contract, the persist payload is private localStorage shape, and
 * their version numbers move for different reasons.
 */
function upgradePadLayerV4(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => ({
    ...loop,
    ...DEFAULT_PAD_STATE,
    padMuted: true,
  }));
}
```

and extend `migrateProjectBody` at `:108`:

```ts
  if (fromVersion < 4) next = upgradePadLayerV4(next);
```

Match the guard to whatever `PROJECT_FORMAT_VERSION` was bumped to.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts src/store/projectFormat.test.ts`
Expected: PASS

- [ ] **Step 7: Mutation check — prove the trap tests bite**

Temporarily delete `padMuted: true,` from `migratePadLayer` in `src/store/migrate.ts`.
Run: `bun test src/store/migrate.test.ts`
Expected: FAIL on "a pre-pad loop is backfilled with the pad muted".
Restore the line.

Temporarily change `mapLoops` to `fn(next.loops[0])`-style single-loop handling — or simply change `migratePadLayer` to return `state` when `state.loops.length > 1`.
Run: `bun test src/store/migrate.test.ts`
Expected: FAIL on "every loop is backfilled, not only the first".
Restore.

Temporarily delete the `if (fromVersion < 4)` line from `migrateProjectBody`.
Run: `bun test src/store/projectFormatMigrate.test.ts`
Expected: FAIL on "a body from before the pad opens with the pad muted".
Restore.

- [ ] **Step 8: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 9: Commit**

```bash
git add src/store/migrate.ts src/store/migrate.test.ts src/store/store.ts src/store/projectFormat.ts src/store/projectFormat.test.ts src/store/projectFormatMigrate.ts src/store/projectFormatMigrate.test.ts
git commit -m "feat(store): backfill the pad layer in both migration chains, muted"
```

---

### Task 5: `engineSync` wiring

**Files:**
- Modify: `src/store/engineSync.ts:71` (`applyEngineSnapshot`) and `:122` (the subscription list)
- Test: `src/store/engineSync.test.ts` (extend)

**Interfaces:**
- Consumes: `padVolume` / `padMuted` store fields (Task 3).
- Produces: the `'pad'` source bus is gain- and mute-controlled from the store. Nothing else consumes this.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('engineSync', ...)` block in `src/store/engineSync.test.ts`. The file's convention is `spyOn(audioEngine, '<setter>').mockClear()` before `startEngineSync()`, and its `afterEach` already calls `stopEngineSync()`:

```ts
  test('the pad bus is bootstrapped and then tracks the store', () => {
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();

    // fireImmediately: the current value is pushed at subscribe time.
    expect(setSourceGain).toHaveBeenCalledWith('pad', useAppStore.getState().padVolume);
    expect(setSourceMuted).toHaveBeenCalledWith('pad', useAppStore.getState().padMuted);

    useAppStore.getState().setPadVolume(0.42);
    expect(setSourceGain).toHaveBeenLastCalledWith('pad', 0.42);

    const before = useAppStore.getState().padMuted;
    useAppStore.getState().togglePadMuted();
    expect(setSourceMuted).toHaveBeenLastCalledWith('pad', !before);
    useAppStore.getState().togglePadMuted();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/engineSync.test.ts`
Expected: FAIL — the pad bus has no recorded gain

- [ ] **Step 3: Add the snapshot lines**

In `src/store/engineSync.ts`, beside `:71` and `:75`:

```ts
  audioEngine.setSourceGain('pad', s.padVolume);
```

```ts
  audioEngine.setSourceMuted('pad', s.padMuted);
```

- [ ] **Step 4: Add the two subscriptions**

Beside `:122` and `:126`:

```ts
  subs.push(useAppStore.subscribe((s) => s.padVolume, (v) => audioEngine.setSourceGain('pad', v), { fireImmediately: true }));
```

```ts
  subs.push(useAppStore.subscribe((s) => s.padMuted, (v) => audioEngine.setSourceMuted('pad', v), { fireImmediately: true }));
```

Do **not** add a `padSynthParams` subscription. Like `chordSynthParams` and `bassSynthParams` it is read live from the store at arm time, which is what makes a timbre knob audible on the next chord instead of only on the next play.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/store/engineSync.test.ts`
Expected: PASS

- [ ] **Step 6: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "feat(store): wire the pad bus gain and mute through engineSync"
```

---

### Task 6: `armPad` in the transport, and stop handling

**Files:**
- Modify: `src/components/loop/chord/useChordPlayback.ts` — add `armPad` beside `startChordPlan` (`:219`), call it at `:624`, extend the stop paths at `:549`, `:586` and `:618`
- Test: `src/components/loop/chord/padArm.test.ts` (create)

**Interfaces:**
- Consumes: `resolveDroneNotes`, `applyPadVoicing`, `padHoldSec` (Task 2); `playFullHoldChord(…, source)` (Task 2); pad store fields (Task 3).
- Produces: `shouldArmPad(mode: PadMode, isLoopStart: boolean): boolean` — exported from `useChordPlayback.ts` for pure testing, the same way `chordStepAction` and `isFullHoldRhythm` already are.

- [ ] **Step 1: Write the failing test**

Create `src/components/loop/chord/padArm.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { shouldArmPad } from './useChordPlayback';

describe('shouldArmPad', () => {
  // Pad mode re-strikes the voicing on every chord; the outgoing chord's
  // release tail overlapping the incoming attack IS the legato.
  test('pad mode arms on every chord', () => {
    expect(shouldArmPad('pad', true)).toBe(true);
    expect(shouldArmPad('pad', false)).toBe(true);
  });

  // Drone mode arms once per loop pass and holds across every chord change.
  // `isLoopStart` is `arming.chordIndex % chords.length === 0`, a value the
  // caller already computes — no "loop boundary" concept is introduced.
  test('drone mode arms only at the top of a loop pass', () => {
    expect(shouldArmPad('drone', true)).toBe(true);
    expect(shouldArmPad('drone', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/chord/padArm.test.ts`
Expected: FAIL — `Export named 'shouldArmPad' not found`

- [ ] **Step 3: Add `shouldArmPad` and `armPad`**

In `src/components/loop/chord/useChordPlayback.ts`, add to the imports:

```ts
import { applyPadVoicing, padHoldSec, resolveDroneNotes } from "../../../audio/playback/padPlayback";
import { loopBars } from "../../../store/loop";
```

Add beside `startChordPlan` (`:219`):

```ts
/**
 * Whether this chord arm should also arm the pad.
 *
 * Pad mode re-strikes on every chord. Drone mode holds one voicing for a whole
 * loop pass, so it arms only at the top of one — `isLoopStart` is the
 * `arming.chordIndex % liveChords.length === 0` the caller already has.
 *
 * Exported so the rule is testable without React; see padArm.test.ts.
 */
export function shouldArmPad(mode: PadMode, isLoopStart: boolean): boolean {
  return mode === 'pad' || isLoopStart;
}

/**
 * Strikes the pad's voicing and schedules its release.
 *
 * Deliberately NOT folded into startChordPlan: that function has no access to
 * `arming.chordIndex`, and threading a flag in would turn the builder of the
 * chord/bass plan into the arm of three voices with two different lifetimes.
 *
 * The pad has no rhythm pattern, so it produces no BarInvariantEvent and needs
 * no per-step emission — one arm is one note-on/note-off pair. This is why
 * ChordPlan and emitChordPlanStep are untouched.
 */
function armPad(chord: ChordItem, isLoopStart: boolean, time: number): void {
  const s = useAppStore.getState();
  if (!shouldArmPad(s.padMode, isLoopStart)) return;

  const stepsPerBar = activeStepsPerBar();
  const barDur = barDurationSec(s.bpm, stepsPerBar);

  const notes =
    s.padMode === 'drone'
      ? resolveDroneNotes(
          s.padDroneDegree,
          s.padDroneIntervals,
          s.padOctave,
          s.scaleRoot,
          s.scaleType,
        )
      : applyPadVoicing(
          generateBlockChordNotes(chord.quality, chord.root, s.padOctave),
          s.padVoicing,
        );
  if (notes.length === 0) return;

  const holdSec = padHoldSec(
    s.padMode,
    chord.bars || 1,
    loopBars(s.chords),
    barDur,
  );
  playFullHoldChord(notes, s.padSynthParams, time, holdSec, 'pad');
}
```

`PadMode` and `ChordItem` come from `../../../types`; `generateBlockChordNotes`, `barDurationSec`, `activeStepsPerBar` and `playFullHoldChord` are already imported by this file — check the existing import block and only add what is missing.

- [ ] **Step 4: Call it from the arm branch**

At `:624`, in the `action === 'play'` branch, add one line immediately after the `startChordPlan` assignment:

```ts
        planRef.current = startChordPlan(chord, step, time);
        armPad(chord, index === 0, time);
```

- [ ] **Step 5: Extend the stop paths**

Update the comment at `:549` — it currently says "Cut BOTH sources" and names two; with the pad on the same player it must name three, and the word "droning" in it is now literal:

```ts
  // Cut ALL THREE sources: the Chords player drives the bass line and the pad
  // layer, so silencing 'chord' alone would leave the bass and the pad
  // droning — and a drone holds the longest note in the app.
```

Add beside the hard stop at `:586`:

```ts
          playbackStopSource('pad', HARD_STOP_RELEASE);
```

Add beside the soft stop at `:618`:

```ts
        playbackStopSource('pad', releasesRef.current.pad, time);
```

and add a `pad` entry to `releasesRef`, populated from `padSynthParams.release` the same way `chord` and `bass` are — read the ref's initialisation and its update site before editing, and mirror them. The ref exists so the soft stop uses the live release value rather than one captured when the clock subscription was created; a `pad` entry that is written once would reintroduce exactly the staleness the ref removes.

Add `padSynthParams` to `useChordPlaybackState()` so the ref has a live value to read, but **do not** add it to the clock effect's dependency array — that array must not gain a synth-params value, or the subscription would tear down and rebuild on every knob slide.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/components/loop/chord/padArm.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 7: Run the chord playback suite and the gate**

Run: `bun test src/components/loop/chord/`
Expected: PASS — the existing `useChordPlayback` tests must still pass; a failure here means the arm branch or the stop path was changed in a way the existing behaviour did not expect.

Run: `bun run verify`
Expected: all green

- [ ] **Step 8: Commit**

```bash
git add src/components/loop/chord/useChordPlayback.ts src/components/loop/chord/padArm.test.ts
git commit -m "feat(audio): arm the pad from the chords player and cut it on stop"
```

---

### Task 7: Theme tokens for the pad module

**Files:**
- Modify: `src/index.css` — `@theme` block beside `:145`, dark theme beside `:173`, light theme beside `:217`, `@utility` beside `:306`
- Modify: `src/components/ui/Knob.tsx:21` (`KNOB_COLORS`)
- Modify: `src/components/ui/PowerToggle.tsx:13` (`POWER_TOGGLE_TONES`) and its `TONE_CLASS` record
- Test: `src/components/ui/PowerToggle.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: the classes `text-module-pad`, `bg-module-pad`, `border-module-pad`, `tint-pad`; `PowerToggleTone` gains `'module-pad'`; `KnobColor` gains `'text-module-pad'`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ui/PowerToggle.test.tsx`, matching the file's existing assertion style:

```ts
test('the module-pad tone emits complete literal button-colour classes', () => {
  const { className } = resolvePowerToggle(true, 'module-pad', false);
  expect(className).toContain('[--btn-color:var(--color-module-pad)]');
  expect(className).toContain('[--btn-fg:var(--color-module-pad-content)]');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/PowerToggle.test.tsx`
Expected: FAIL — TypeScript rejects `'module-pad'`, or `TONE_CLASS['module-pad']` is `undefined`

- [ ] **Step 3: Declare the CSS variables**

In `src/index.css`, add to the `@theme` block beside `:145`:

```css
  --color-module-pad: var(--module-pad);
  --color-module-pad-content: var(--module-pad-content);
```

Add to the dark block (`:root, [data-theme="solna-dark"]`) beside `:173`:

```css
  --module-pad: #F0B265;          /* amber 40° */
  --module-pad-content: #17100F;
  --module-pad-tint: #F0B2651A;   /* the same amber at 10% — see tint-pad */
```

Add to the light block beside `:217`:

```css
  --module-pad: #A96B22;          /* amber 40° */
  --module-pad-content: #FFFFFF;
  --module-pad-tint: #A96B221A;   /* the same amber at 10% — see tint-pad */
```

Add the utility beside `:306`:

```css
@utility tint-pad {
  background-image: linear-gradient(var(--module-pad-tint), var(--module-pad-tint));
}
```

- [ ] **Step 4: Check the light-theme value by eye**

The dark value is unconstrained — module colours sit near L 0.75 and the canvas stops are all near L 0.1, so any amber separates. The light value is the one that must actually be looked at.

Run: `bun run dev`, open the app, switch to the light theme, open the Chords tab, and compare the amber against a daisyUI `warning` element. If the two read as the same colour, darken or desaturate the light value until they do not, and update the comment to match. `bun run check:theme` will not catch a collision — it scans for raw hex and palette classes in source, not for readability.

Record whichever pair of values survives this step; the hexes above are a starting point, not a result.

- [ ] **Step 5: Widen the two unions**

`src/components/ui/Knob.tsx:21` — add to `KNOB_COLORS`:

```ts
  'text-module-pad',
```

`src/components/ui/PowerToggle.tsx:13` — add to `POWER_TOGGLE_TONES`:

```ts
export const POWER_TOGGLE_TONES = ['primary', 'accent', 'module-chord', 'module-bass', 'module-pad'] as const;
```

and to `TONE_CLASS`:

```ts
  'module-pad':
    '[--btn-color:var(--color-module-pad)] [--btn-fg:var(--color-module-pad-content)]',
```

The class string must be a complete literal. The file's own comment explains why: Tailwind v4 scans source statically, so an interpolated class name emits no CSS at all.

Widening `KNOB_COLORS` may also require a `BADGE_COLOR` entry in the same file — `BADGE_COLOR` is a `Record<KnobColor, string>`, so TypeScript will say so. Add:

```ts
  'text-module-pad': '[--badge-color:var(--color-module-pad)]',
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/components/ui/PowerToggle.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: all green, `check:theme` included

- [ ] **Step 8: Commit**

```bash
git add src/index.css src/components/ui/Knob.tsx src/components/ui/PowerToggle.tsx src/components/ui/PowerToggle.test.tsx
git commit -m "feat(ui): add the pad module's amber theme tokens"
```

---

### Task 8: The Synth tab's fourth target

**Files:**
- Modify: `src/utils/synthControl.ts:3` (`SynthControlTarget`), `:14` (`SYNTH_TARGET_STYLES`), and `resolveSynthControlChannel`
- Modify: `src/components/loop/SynthView.tsx:62` (`resolveTargetBorderClass`) and `:92` (`activeTargetVolumeConfig`)
- Test: `src/utils/synthControl.test.ts` (extend)

**Interfaces:**
- Consumes: `padSynthParams` / `setPadSynthParams` / `padVolume` / `setPadVolume` (Task 3); `module-pad` classes (Task 7).
- Produces: `SynthControlTarget` includes `'pad'`, so `AdjustSynthButton target="pad"` compiles — Task 9 depends on this.

**Note:** every change in this task must land in one commit. Widening `SynthControlTarget` breaks `SYNTH_TARGET_STYLES` (a `Record` over the union), `resolveSynthControlChannel` and `SynthView` at compile time, so a partial change cannot pass `bun run verify`.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/synthControl.test.ts`:

```ts
test('the pad target carries its own module styling', () => {
  const style = SYNTH_TARGET_STYLES.pad;
  expect(style.label).toBe('Pad');
  expect(style.tint).toBe('tint-pad');
  expect(style.ring).toContain('module-pad');
  expect(style.activeBtn).toContain('--color-module-pad');
  expect(style.badge).toContain('--color-module-pad');
});

test('resolveSynthControlChannel routes the pad target to the pad channel', () => {
  const channels = {
    synth: { params: {} as never, setParams: () => {} },
    chord: { params: {} as never, setParams: () => {} },
    bass: { params: {} as never, setParams: () => {} },
    pad: { params: {} as never, setParams: () => {} },
  };
  expect(resolveSynthControlChannel('pad', channels)).toBe(channels.pad);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/synthControl.test.ts`
Expected: FAIL — `Property 'pad' does not exist on type ...`

- [ ] **Step 3: Widen the union and the style record**

`src/utils/synthControl.ts:3`:

```ts
export type SynthControlTarget = 'synth' | 'chord' | 'bass' | 'pad';
```

Add to `SYNTH_TARGET_STYLES` (`:14`) after the `bass` entry:

```ts
  pad: {
    label: 'Pad',
    tint: 'tint-pad',
    ring: 'ring-1 ring-module-pad/40',
    activeBtn: '[--btn-color:var(--color-module-pad)] [--btn-fg:var(--color-module-pad-content)]',
    badge: '[--badge-color:var(--color-module-pad)]',
  },
```

Widen `resolveSynthControlChannel`'s `channels` parameter:

```ts
export function resolveSynthControlChannel(
  target: SynthControlTarget,
  channels: {
    synth: SynthParamChannel;
    chord: SynthParamChannel;
    bass: SynthParamChannel;
    pad: SynthParamChannel;
  }
): SynthParamChannel {
  // Unknown runtime values (e.g. a persisted target predating this union) fall back to synth
  return channels[target] ?? channels.synth;
}
```

- [ ] **Step 4: Update `SynthView.tsx`**

Add the store reads beside the existing ones (`:85`–`:90`):

```ts
  const padVolume = useAppStore((s) => s.padVolume);
  const setPadVolume = useAppStore((s) => s.setPadVolume);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
```

Add a case to `activeTargetVolumeConfig` (`:92`) after the `bass` case, and add `padVolume` / `setPadVolume` to that `useMemo`'s dependency array:

```ts
      case "pad":
        return {
          idPrefix: "pad",
          volume: padVolume,
          onVolumeChange: setPadVolume,
          accentClass: "text-module-pad" as const,
          sliderClassName:
            "range range-xs text-module-pad [--range-thumb:var(--color-module-pad-content)]",
        };
```

Add a branch to `resolveTargetBorderClass` (`:62`) for `controlTarget === "pad"`, following the shape the existing chord/bass branches use with `module-pad` in place of their token.

Add `pad: { params: padSynthParams, setParams: setPadSynthParams }` to the `channels` object passed to `resolveSynthControlChannel` (near `:139`).

Add the `Pad` entry to whatever renders the target selector buttons — read the JSX near `:359` ("Row 1: Control Destination / Target Selector") and follow the pattern the other three use. If that row iterates a list of targets, add `'pad'` to the list; if it hardcodes three buttons, add a fourth.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/utils/synthControl.test.ts src/components/loop/SynthView.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the gate**

Run: `bun run verify`
Expected: all green. `bun run lint` is the real check here — any `Record<SynthControlTarget, …>` or exhaustive `switch` left unupdated shows up as a type error.

- [ ] **Step 7: Commit**

```bash
git add src/utils/synthControl.ts src/utils/synthControl.test.ts src/components/loop/SynthView.tsx
git commit -m "feat(ui): add Pad as a fourth synth control target"
```

---

### Task 9: The Pad module card

**Files:**
- Create: `src/components/loop/chord/PadModulePanel.tsx`
- Create: `src/components/loop/chord/padPanel.ts` (the panel's pure decisions)
- Create: `src/components/loop/chord/padPanel.test.ts`
- Modify: `src/components/loop/ChordView.tsx:572` (a third `PowerToggle`) and `:898` (render the panel after `<BassModulePanel>`)

**Interfaces:**
- Consumes: pad store fields and actions (Task 3); `tint-pad` / `module-pad` classes (Task 7); `SynthControlTarget` including `'pad'` (Task 8).
- Produces:
  - `padPanelFields(mode: PadMode): 'chord-voicing' | 'drone-select'`
  - `droneDegreeButtons(scaleRoot: string, scaleType: string, selected: number): { index: number; label: string; active: boolean }[]`

- [ ] **Step 1: Write the failing test**

Create `src/components/loop/chord/padPanel.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { droneDegreeButtons, padPanelFields } from './padPanel';

// These are pure functions ON PURPOSE. zustand wires getServerSnapshot to the
// store's creation-time state, so under renderToString a
// `useAppStore.setState({ padMode: 'drone' })` before the render has no effect
// and a rendered assertion silently checks the wrong mode. Nothing in
// `bun run verify` catches that. Test the decision, not the markup.
describe('padPanelFields', () => {
  test('pad mode shows the chord controls, drone mode the drone controls', () => {
    expect(padPanelFields('pad')).toBe('chord-voicing');
    expect(padPanelFields('drone')).toBe('drone-select');
  });
});

describe('droneDegreeButtons', () => {
  test('a seven-degree scale renders seven buttons with roman labels', () => {
    const buttons = droneDegreeButtons('C', 'Major', 0);
    expect(buttons).toHaveLength(7);
    expect(buttons[0].label).toBe('I');
    expect(buttons[0].active).toBe(true);
  });

  // SCALES holds five- and six-note scales too. Hardcoding seven is the
  // mistake the table's shape exists to prevent.
  test('Hirajoshi renders five buttons, not seven', () => {
    expect(droneDegreeButtons('A', 'Hirajoshi', 0)).toHaveLength(5);
  });

  // The highlight follows `selected % length`, and the STORED value is left
  // alone. Selecting degree 6 in Major and switching to Hirajoshi makes the
  // resolver wrap to degree 1; the highlight wraps with it, so what is shown is
  // always what is heard. Clamping the stored value would destroy a setting
  // merely because the user looked at another scale.
  test('a degree beyond the scale length highlights its wrapped position', () => {
    const buttons = droneDegreeButtons('A', 'Hirajoshi', 6);
    expect(buttons.filter((b) => b.active)).toHaveLength(1);
    expect(buttons[1].active).toBe(true);
  });

  test('minor and diminished degrees keep their lower-cased numerals', () => {
    const buttons = droneDegreeButtons('C', 'Major', 0);
    expect(buttons[1].label).toBe(buttons[1].label.toLowerCase());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/chord/padPanel.test.ts`
Expected: FAIL — `Cannot find module './padPanel'`

- [ ] **Step 3: Write `src/components/loop/chord/padPanel.ts`**

```ts
import { SCALES, getDiatonicChordForDegree } from '../../../utils/musicTheory';
import type { PadMode } from '../../../types';

/**
 * Which control block the card shows. The two blocks SWAP rather than both
 * rendering with one disabled: a greyed-out control invites the user to work
 * out why it does nothing, and both sets are dormant-but-persisted in the
 * other mode.
 *
 * Pure, and tested as such — a rendered test of mode switching would assert
 * against the store's creation-time state and pass while checking the wrong
 * mode. See padPanel.test.ts.
 */
export function padPanelFields(mode: PadMode): 'chord-voicing' | 'drone-select' {
  return mode === 'drone' ? 'drone-select' : 'chord-voicing';
}

/**
 * One button per degree of the ACTIVE scale — five for Hirajoshi, seven for
 * Major. Labels come from getDiatonicChordForDegree, which already lower-cases
 * minor and diminished numerals.
 *
 * The active button is `selected % length`, matching the wrap the resolver
 * performs, so the highlight always shows the degree that is actually heard.
 * The stored value is never clamped here.
 */
export function droneDegreeButtons(
  scaleRoot: string,
  scaleType: string,
  selected: number,
): { index: number; label: string; active: boolean }[] {
  const scale = SCALES[scaleType] ?? SCALES.Major;
  const length = scale.intervals.length;
  const activeIndex = ((selected % length) + length) % length;
  return Array.from({ length }, (_, index) => ({
    index,
    label: getDiatonicChordForDegree(index, scaleRoot, scaleType, false).degreeName,
    active: index === activeIndex,
  }));
}
```

Check `SCALES`'s export shape in `src/utils/musicTheory.ts` before writing this — if the table is not exported under that name, export it or add a `scaleDegreeCount(scaleType)` helper there and use that instead. The rule is what matters: the count comes from the scale, never from a literal 7.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/loop/chord/padPanel.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Write `PadModulePanel.tsx`**

Read `src/components/loop/chord/BassModulePanel.tsx` first and mirror its structure — the store-selector block at the top, the `card` wrapper, the `SECTION_HEADER` / `FIELD_LABEL` / `FIELD_SELECT` classes from `../../ui/fieldClasses`, the preset `<select>` built from `getPresetsGroupedByCategory`, the `AdjustSynthButton`, and the `ChannelStrip` at the bottom.

The card's own differences from the bass panel:

- Wrapper: `mt-4 card bg-panel tint-pad border border-module-pad/30 p-4`
- A two-button mode toggle writing `setPadMode`, styled from `SYNTH_TARGET_STYLES.pad.activeBtn` for the active one.
- `<AdjustSynthButton target="pad" className="text-module-pad" />`
- The preset `<select>` filters to the `Pad` category and writes `setPadSynthParams`.
- Between the header and the fader, render **one** block, chosen by `padPanelFields(padMode)`:
  - `'chord-voicing'` — an octave row (2/3/4) writing `setPadOctave`, and a voicing row (Triad / Open 5th / Root) writing `setPadVoicing`.
  - `'drone-select'` — a degree row built from `droneDegreeButtons(scaleRoot, scaleType, padDroneDegree)` writing `setPadDroneDegree(index)`, and an interval row over `PAD_INTERVALS` writing `togglePadDroneInterval(interval)`, each button active when `padDroneIntervals.includes(interval)`.
- `<ChannelStrip idPrefix="pad" volume={padVolume} onVolumeChange={setPadVolume} accentClass="text-module-pad" max={1.5} />` — `max` is required by design; the prop's doc comment explains that a default would hand whichever value it picked to the next caller by silence.

Every class name must be a complete literal string, never assembled by interpolation from a token name — Tailwind v4's static scan is what makes that rule load-bearing.

- [ ] **Step 6: Wire it into `ChordView.tsx`**

Add a third `PowerToggle` after the bass one at `:572`:

```tsx
            <PowerToggle
              id="btn-mute-pad"
              on={!padMuted}
              onToggle={togglePadMuted}
              name="Pad"
              tone="module-pad"
            />
```

with `padMuted` / `togglePadMuted` read from the store beside the existing `chordMuted` / `bassMuted` selectors.

Render the panel after `<BassModulePanel>` (`:898`), passing whatever props it needs — if the panel takes no props, `<PadModulePanel />` alone.

- [ ] **Step 7: Look at it**

Run: `bun run dev`, open the Chords tab.
Confirm: the card renders under the bass card; switching Pad/Drone swaps the middle block rather than disabling it; the degree row shows seven buttons in Major and five after switching the Header's scale to Hirajoshi; the amber reads clearly in both themes.

- [ ] **Step 8: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 9: Commit**

```bash
git add src/components/loop/chord/PadModulePanel.tsx src/components/loop/chord/padPanel.ts src/components/loop/chord/padPanel.test.ts src/components/loop/ChordView.tsx
git commit -m "feat(ui): add the pad/drone module card to the chords tab"
```

---

### Task 10: The Arrange mix row

**Files:**
- Modify: `src/components/song/SortableLoopCard.tsx:579` (add a `MixChannel` after the bass one)
- Test: `src/components/song/SortableLoopCard.test.tsx` (extend)

**Interfaces:**
- Consumes: `LoopMixPatch` with `padVolume` / `padMuted` (Task 3); `PowerToggleTone` including `'module-pad'` (Task 7).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `src/components/song/SortableLoopCard.test.tsx`, reusing the same `renderToString(...)` call the file's existing card tests build (see the ones near `:99` and `:124` — copy the props object those already construct rather than inventing a new fixture).

`MixChannel` renders `id={`btn-mute-${idPrefix}`}` and `id={`slider-${idPrefix}`}`, and the bass row passes `idPrefix={`bass-${loop.id}`}`, so the pad row's ids are derivable and stable:

```ts
  test('a loop card renders a pad mix channel', () => {
    const html = renderToString(
      // ...the same element the neighbouring card tests render
    );
    expect(html).toContain('id="btn-mute-pad-loop-default-1"');
    expect(html).toContain('id="slider-pad-loop-default-1"');
    expect(html).toContain('Pad');
  });
```

Use whatever loop id the surrounding tests use — `loop-default-1` is `DEFAULT_LOOP_ID` and is what the existing `id="card-loop-loop-default-1"` assertion at `:119` relies on.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/song/SortableLoopCard.test.tsx`
Expected: FAIL — the string is absent

- [ ] **Step 3: Add the mix channel**

After the bass `MixChannel` (the block starting at `:579`), following the same prop shape:

```tsx
            <MixChannel
              idPrefix={`pad-${loop.id}`}
              label="Pad"
              volume={loop.padVolume}
              muted={loop.padMuted}
              max={1.5}
              tone="module-pad"
              sliderAccent="text-module-pad"
              onVolume={(v) => onSetMix(loop.id, { padVolume: v })}
              onToggleMute={() => onSetMix(loop.id, { padMuted: !loop.padMuted })}
            />
```

`idPrefix` is `` `pad-${loop.id}` ``, matching the bass row's `` `bass-${loop.id}` `` — `MixChannel` builds `btn-mute-${idPrefix}` and `slider-${idPrefix}` from it, so a bare `"pad"` would collide across cards.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/song/SortableLoopCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/components/song/SortableLoopCard.tsx src/components/song/SortableLoopCard.test.tsx
git commit -m "feat(ui): add the pad channel to the arrange loop mixer"
```

---

### Task 11: Instant Vibes carry an optional pad

**Files:**
- Modify: `src/types.ts` (`InstantVibe` gains `pad?`)
- Modify: `src/store/instantVibes.ts:42` (resolve), `:68` (cut the bus), and the apply section; plus the six vibes' data
- Modify: `src/store/instantVibes.test.ts:320` (the existing silenced-sources assertion) and `:126` (add the pad preset invariant)

**Interfaces:**
- Consumes: `PadInterval`, `PadVoicing`, `PadMode` (Task 1); the pad store actions (Task 3).
- Produces: `InstantVibe.pad?` — the optional object every vibe may carry.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/instantVibes.test.ts`:

```ts
describe('vibe pad data', () => {
  // Mirrors the existing bassPresetId invariant at the top of this file.
  test('every pad preset id resolves to a Pad-category preset', () => {
    for (const vibe of INSTANT_VIBES) {
      if (!vibe.pad) continue;
      expect(`${vibe.id}=${presetById(vibe.pad.presetId)?.category}`).toBe(`${vibe.id}=Pad`);
    }
  });

  // An empty set is legal at runtime — it means a silent drone — but in
  // authored content it ships a layer that cannot make a sound, which is a
  // data bug rather than a choice.
  test('every vibe that ships a pad ships a non-empty interval set', () => {
    for (const vibe of INSTANT_VIBES) {
      if (!vibe.pad) continue;
      expect(vibe.pad.droneIntervals.length).toBeGreaterThan(0);
    }
  });

  // The optional shape is a real choice, not a field every entry fills.
  test('the two boombap-pool vibes ship no pad', () => {
    const byId = Object.fromEntries(INSTANT_VIBES.map((v) => [v.id, v]));
    expect(byId['hiphop-groove'].pad).toBeUndefined();
    expect(byId['afro-six-eight'].pad).toBeUndefined();
  });
});

describe('applying a vibe writes its pad', () => {
  test('a vibe with a pad unmutes and configures the layer', () => {
    const vibe = INSTANT_VIBES.find((v) => v.pad)!;
    applyInstantVibeToStore(vibe);
    const s = useAppStore.getState();
    expect(s.padMuted).toBe(false);
    expect(s.padMode).toBe(vibe.pad!.mode);
    expect(s.padVolume).toBe(vibe.pad!.volume);
    useAppStore.getState().hardStopAll();
  });

  // Muting is reversible and resetting is not: Boom Bap -> Synthwave -> Boom
  // Bap must not erase pad settings the user tuned by hand.
  test('a vibe without a pad mutes the layer and leaves its settings alone', () => {
    const withPad = INSTANT_VIBES.find((v) => v.pad)!;
    const withoutPad = INSTANT_VIBES.find((v) => !v.pad)!;
    applyInstantVibeToStore(withPad);
    const octaveBefore = useAppStore.getState().padOctave;
    applyInstantVibeToStore(withoutPad);
    const s = useAppStore.getState();
    expect(s.padMuted).toBe(true);
    expect(s.padOctave).toBe(octaveBefore);
    useAppStore.getState().hardStopAll();
  });
});
```

Then extend the existing silenced-sources test at `:319`. Rename it and add the pad assertion:

```ts
  test('silences the chord, bass and pad buses, at the hard-stop release', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
    stopSource.mockClear();

    useAppStore.getState().play('chords');
    applyInstantVibeToStore(INSTANT_VIBES[1]);

    const silenced = stopSource.mock.calls.map((c) => c[0]);
    expect(silenced).toContain('chord');
    expect(silenced).toContain('bass');
    expect(silenced).toContain('pad');
    for (const call of stopSource.mock.calls) expect(call[1]).toBe(0.02);

    useAppStore.getState().hardStopAll();
    stopSource.mockRestore();
  });
```

This existing test failing is the point: the assertion and the line that makes it true must land together, so a red test can never be resolved by weakening it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/store/instantVibes.test.ts`
Expected: FAIL — `Property 'pad' does not exist on type 'InstantVibe'`

- [ ] **Step 3: Add `pad?` to `InstantVibe`**

In `src/types.ts`, inside `InstantVibe` after the bass block:

```ts
  /**
   * The pad layer, when the genre uses one.
   *
   * OPTIONAL here and required on `Loop`, deliberately: a vibe *chooses*
   * whether to bring a pad, while a loop *always has* pad state. Absence
   * carries the enabled/disabled meaning with no extra boolean, and two of the
   * eight vibes exercise it.
   */
  pad?: {
    volume: number;
    /** Library reference into ALL_FACTORY_PRESETS; must resolve to category 'Pad'. */
    presetId: string;
    mode: PadMode;
    octave: number;
    voicing: PadVoicing;
    droneDegree: number;
    droneIntervals: readonly PadInterval[];
  };
```

`PadMode`, `PadVoicing` and `PadInterval` are declared in this same file, so no import is added and the file stays acyclic.

- [ ] **Step 4: Resolve the preset before mutating**

In `src/store/instantVibes.ts`, beside `:44`:

```ts
  const finalPadSynthParams = vibe.pad ? resolveVibeSynthParams(vibe.pad.presetId) : null;
```

The existing comment above those lines explains why every preset id is resolved before any state is touched: `resolveVibeSynthParams` throws on an unknown id, and throwing mid-swap would leave the store holding half of each vibe.

- [ ] **Step 5: Cut the pad bus during the swap**

Beside `:69`, after the bass line:

```ts
  audioEngine.stopSource('pad', VIBE_SWAP_RELEASE);
```

This is the sharpest edge in the vibe work. The comment above records that the whole swap runs inside one `onClick`, React batches it, the rendered player state goes `'playing' → 'playing'`, and no effect keyed on it ever runs — so the sources must be cut here, synchronously. The drone holds the longest note in the application; omitting this line leaves the outgoing vibe's drone singing over the incoming one for a full loop pass.

- [ ] **Step 6: Apply the pad**

Add after the bass apply section, following the `store.setX(...)` style the function uses throughout:

```ts
  // A vibe without a pad mutes the layer and leaves the rest of its settings
  // alone. Muting is reversible and resetting is not: Boom Bap -> Synthwave ->
  // Boom Bap must not erase pad settings the user tuned by hand.
  if (vibe.pad && finalPadSynthParams) {
    store.setPadSynthParams(finalPadSynthParams);
    store.setPadMode(vibe.pad.mode);
    store.setPadOctave(vibe.pad.octave);
    store.setPadVoicing(vibe.pad.voicing);
    store.setPadDroneDegree(vibe.pad.droneDegree);
    store.setPadDroneIntervals([...vibe.pad.droneIntervals]);
    store.setPadVolume(vibe.pad.volume);
    if (store.padMuted) store.togglePadMuted();
  } else if (!useAppStore.getState().padMuted) {
    store.togglePadMuted();
  }
```

Read `padMuted` through `useAppStore.getState()` in the else branch rather than through the `store` snapshot captured at the top of the function: by this point the swap has already written a great deal of state, and the captured snapshot's `padMuted` may be stale.

- [ ] **Step 7: Add the per-vibe data**

Add a `pad` object to six of the eight vibes. `hiphop-groove` and `afro-six-eight` get **no** `pad` key at all.

```ts
// lofi-chill — glue under the e-piano, not a foreground voice.
pad: { volume: 0.30, presetId: 'factory-warm-polypad', mode: 'pad', octave: 3, voicing: 'open5', droneDegree: 0, droneIntervals: [1, 5, 8] },

// synthwave-80s — the sustained half of the genre's two-layer chord stack.
pad: { volume: 0.65, presetId: 'factory-string-ensemble', mode: 'pad', octave: 3, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

// cyber-dance — supersaw holding under the trance-pluck stabs.
pad: { volume: 0.50, presetId: 'factory-neon-poly-saw', mode: 'pad', octave: 3, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

// ambient-chill — a pedal tone under the Lydian progression is the genre's gesture.
pad: { volume: 0.55, presetId: 'factory-dark-sub-pad', mode: 'drone', octave: 2, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

// asian-zen — the sustained shō of gagaku, a direct ancestor of drone music.
pad: { volume: 0.40, presetId: 'factory-warm-polypad', mode: 'drone', octave: 2, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

// lofi-waltz — same treatment as lofi-chill.
pad: { volume: 0.30, presetId: 'factory-warm-polypad', mode: 'pad', octave: 3, voicing: 'open5', droneDegree: 0, droneIntervals: [1, 5, 8] },
```

`voicing` is set on the drone vibes and `droneDegree`/`droneIntervals` on the pad vibes even though each is dormant in that mode: the fields are required by the object's shape, and giving them the defaults means switching a vibe's mode by hand in the UI lands on something sensible rather than on a hole.

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test src/store/instantVibes.test.ts`
Expected: PASS, including the updated silenced-sources test

- [ ] **Step 9: Mutation check**

Temporarily delete `audioEngine.stopSource('pad', VIBE_SWAP_RELEASE);`.
Run: `bun test src/store/instantVibes.test.ts`
Expected: FAIL on "silences the chord, bass and pad buses". Restore the line.

Temporarily change `asian-zen`'s `presetId` to `'bass-deep-sine'`.
Run: `bun test src/store/instantVibes.test.ts`
Expected: FAIL on "every pad preset id resolves to a Pad-category preset". Restore.

- [ ] **Step 10: Listen to it**

Run: `bun run dev`. Click through all eight vibes with the Chords player running.
Confirm: Deep Ambient and Zen Garden hold a drone across the whole progression; Synthwave and Cyber EDM have a sustained bed under their stabs; Boom Bap and the Afro 6/8 vibe have no pad at all; switching from a drone vibe to any other vibe cuts the drone immediately rather than letting it ring over the new one.

- [ ] **Step 11: Run the gate**

Run: `bun run verify`
Expected: all green

- [ ] **Step 12: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/instantVibes.test.ts
git commit -m "feat(vibes): give six Instant Vibes a pad or drone layer"
```

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: Playback → Tasks 2 and 6; State → Task 3; Migration → Task 4; UI/Chords → Task 9; UI/Synth → Task 8; UI/Arrange → Task 10; UI/Theme → Task 7; Instant Vibes → Task 11; Testing → distributed, with the five trap tests in Tasks 3, 4 and 11. The spec's `engineSync` paragraph is Task 5. The spec's "no engine change" and "`PROJECT_CONTENT_KEYS` is not touched" sections are satisfied by omission — no task modifies `src/audio/engine.ts` or `src/store/projectFormat.ts:42`.

**Trap test #5 is folded into Task 3, not given its own task.** The spec lists "editing a pad control marks the project dirty" as a fifth trap test. It is covered by Task 3's `LOOP_FLAT_KEYS` membership test plus the existing `projectDirty.test.ts` drift guard, which already asserts that every content key schedules a pass. An end-to-end dirty assertion adds a third assertion of the same fact; if the executor wants it, it belongs in Task 3 Step 1, not in a task of its own.

**Task 9 is the largest and could be split** — the pure helpers (`padPanel.ts` + its test) are independently reviewable from the component and the `ChordView` wiring. It is kept whole because the component is not testable on its own under this repo's rules, so splitting would produce one task whose only deliverable is markup no test covers.
