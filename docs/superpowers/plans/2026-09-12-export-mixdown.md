# Export Mixdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Export ▾ → Export mixdown (WAV)** action to the header on the song layer that renders the whole arrangement offline through the full master chain and downloads a 16-bit / 44.1 kHz stereo WAV.

**Architecture:** A fresh `OfflineAudioContext(2, totalSamples, 44100)` is bound to a throwaway `AudioEngine` through a new `createRenderEngine(ctx)` seam, the snapshot is applied through the engine's existing public setters, and the arrangement is walked loop × repeat × step — driving pure step-decision functions that must first be **moved down** out of `src/store/` and `src/components/` hooks into `src/utils/` and `src/audio/`, because an offline render has to know every event before it starts and `src/audio/**` may not import `store/**` or `components/**`.

**Tech Stack:** TypeScript, Vite + React 19, zustand 5, daisyUI 5, Bun test runner, raw Web Audio API (no Tone.js), `node-web-audio-api` (devDependency) for offline contexts under Bun.

**Spec:** `docs/superpowers/specs/2026-09-12-export-mixdown-design.md`

## Global Constraints

- **The gate is `bun run verify`** — `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run check:contrast && bun run check:levels && bun run build`. Run it in full at Task 9. `bun run eslint` currently reports nothing at all; that is the state to keep.
- **Test runner is Bun.** One file: `bun test src/audio/engine.test.ts`. One test by name: `bun test -t "reverb decay"`. Type-check only: `bun run lint` (`tsc --noEmit`).
- **Layering is enforced by `no-restricted-imports` in `eslint.config.js`.** `src/audio/**` may not import `store/**` or `components/**`, and that block has **no `allowTypeImports`** — not even a type may cross. `src/components/**` may not import `audio/engine` (allowlisted: the three read-only analyser consumers plus test files). `src/utils/` may not read store state.
- **The renderer never reads the store.** It works from a plain-serialisable `MixdownSnapshot` captured before it starts. No `Blob`, no `FileSystemFileHandle`, no functions in the snapshot.
- **The store never touches `document`, never creates a URL and never clicks an anchor.** It returns `{ ok: true, destination: 'download', blob, fileName }` and the component downloads — exactly the `ProjectSaveResult` split (`src/store/projectSlice.ts:50`).
- **Storage access is always guarded.** `localStorage` and `sessionStorage` can **throw**, not merely return `null`; every read goes inside a `try`.
- **No DOM and no testing-library in the suite, and none may be added.** Tests are `bun:test`: pure-logic helpers first, `renderToString` substring assertions second.
- **A component under `renderToString` must take `layer` as a prop and read the store through `useLiveStore`** (`src/components/ui/useLiveStore.ts`), never a bare `useAppStore` selector — zustand wires `getServerSnapshot` to the store's creation-time state, so a test's `setState()` before a render has no effect otherwise. See `.claude/rules/testing.md`.
- **Themes name roles, never colours.** No raw hex, no Tailwind palette classes, no `dark:` variant. `bun run check:theme` is part of `bun run verify`'s neighbourhood and must stay green.
- **Commits are conventional commits,** each ending with the trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Branch: `feat/export-mixdown`, cut from `main`. Never commit feature work straight to `main`.
- **Do not bump `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`.** `exporting` is session-only and is absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`; the snapshot is never persisted.
- **No AAC/MP3/Opus, no stem tracks, no realtime capture, no normalisation/dither, no export settings dialog.** The menu is *shaped* to take a stem row later; the row is not built.

### Two recorded deviations from the spec

Both are deliberate and are referred to again at the task that carries them:

1. **`renderMixdown` returns a result union, not a bare `AudioBuffer`.** The spec's signature sketch is `renderMixdown(snapshot): Promise<AudioBuffer>`, but its own error table requires the renderer to catch at its own boundary and return a failed result ("The renderer never throws... `renderMixdown` catches at its own boundary"). A `Promise<AudioBuffer>` cannot express that. The shipped shape is `{ ok: true; buffer: AudioBuffer; blob: Blob } | { ok: false; reason }` — the `buffer` so the spec's own test assertions (length, channel count, non-silence) can be written, the `blob` so the whole encode stays inside the one `try`.
2. **The spec's timeline pseudocode double-counts repeats.** It reads `dwell = loopDwellSteps(...)` and then `for rep in 0 .. repeatCount - 1: for step in 0 .. dwell - 1`, which schedules `repeatCount²` passes. `loopDwellSteps` is defined as the loop's **total** dwell (`effectiveLength × repeats`) — it is `songAdvanceDecision`'s `totalSteps`, which is what makes it one expression of the rule — so the walk iterates `dwell` steps once, with a pass-relative index `i % passSteps` for anything that must reset per pass. Getting this wrong is silent: `chordPlanPosition` returns `null` on every repeat, so repeats 2..n render silent.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/songStructure.ts` | **new.** Store-free structural loop maths: `loopBars`, `loopLengthSteps`, `loopDwellSteps`, `songAdvanceDecision` + `SongAdvance`/`SONG_HOLD`/`SONG_END`. Declares its own `StructuralChord`/`StructuralLoop` so it never imports `store/`. |
| `src/utils/songStructure.test.ts` | **new.** Pure literal cases for all four functions, including the dwell rule's full matrix. |
| `src/utils/encodeWav.ts` | **new.** `encodeWavBytes(channels, sampleRate): Uint8Array` (the verbatim calibration port) and `encodeWav(channels, sampleRate): Blob` (`type: 'audio/wav'`). No DOM, no download. |
| `src/utils/encodeWav.test.ts` | **new.** The nine calibration assertions, the `Blob` wrapper, and the round-trip decode. |
| `src/utils/projectFileIO.ts` | **modified.** Adds `downloadBlob(fileName, blob, doc?, url?)`; `downloadTextFile` delegates to it; adds `wavFileName(name)`. |
| `src/audio/rng.ts` | **modified.** Gains `MIXDOWN_SEED`, `mulberry32` and `withSeededRandom`; its docblock's "no production code path installs a replacement" claim is corrected. |
| `src/audio/rng.test.ts` | **modified.** Pinned-value port-faithfulness test, determinism/range tests, and the two restore-on-every-exit-path tests. |
| `src/audio/engine.ts` | **modified.** `AudioEngine` exported; `private ctx` widened to `BaseAudioContext \| null`; `getAudioContext()` widened; new public `bindContext`; new `createRenderEngine(ctx)` factory. `init()` unchanged. |
| `src/audio/engine.render.test.ts` | **new.** Proves the seam: a real `OfflineAudioContext`, a bound engine, a non-silent kick. |
| `src/audio/sequencerSteps.ts` | **new.** `SequencerStepEvent` + `sequencerStepEvents`, moved out of `src/components/useSequencerPlayback.ts`. |
| `src/audio/sequencerSteps.test.ts` | **new.** The `sequencerStepEvents` describe, moved verbatim from the component test. |
| `src/audio/leadMelody.ts` | **modified.** Gains `leadDispatchTicks` and `leadScheduleHits` + `LeadScheduleHit`, moved from the lead hook. |
| `src/audio/leadMelody.test.ts` | **modified.** The two moved describes land here. |
| `src/audio/chordRhythms.ts` | **modified.** Gains the six chord/bass rhythm helpers plus the two private pattern resolvers, moved from `useChordPlayback.ts`. |
| `src/audio/chordRhythms.test.ts` | **modified.** The five moved describes land here. |
| `src/audio/playback/padPlayback.ts` | **modified.** Gains `resolvePadArm` (the decision half of the hook's `armPad`); `padHoldSec`'s `loopBars` parameter is renamed. |
| `src/audio/playback/padPlayback.test.ts` | **modified.** `resolvePadArm` cases, and `padHoldSec`'s renamed parameter. |
| `src/audio/export/renderMixdown.ts` | **new.** `MixdownSnapshot` + its sub-types, `MixdownRenderResult`, `planArrangement`, `renderMixdown`. Imports only `data/`, `utils/` and `audio/`. |
| `src/audio/export/renderMixdown.test.ts` | **new.** Non-silent stereo buffer, exact length, determinism, RNG restore, and the two failure reasons. |
| `src/audio/export/mixdownFixture.ts` | **new.** `mixdownSnapshot()` / `mixdownLoop()` builders shared by the renderer and slice tests. |
| `src/store/mixdownSlice.ts` | **new.** `exporting`, `exportMixdown()`, `MixdownResult`, `buildMixdownSnapshot`, `buildMixdownLoop`. |
| `src/store/mixdownSlice.test.ts` | **new.** Slice tests against an injected renderer. |
| `src/store/store.ts` | **modified.** Registers `createMixdownSlice(setWithLoopMirror, get)`. |
| `src/store/types.ts` | **modified.** `AppStore` extends `MixdownSlice`. |
| `src/components/Header.tsx` | **modified.** `ExportButton({ layer })` + exported `runMixdownExport`; rendered beside `FollowPlayheadToggle`. |
| `src/components/Header.test.tsx` | **modified.** Rendered-markup tests + the click-wiring spy tests. |
| `scripts/calibration/encodeWav.ts`, `.test.ts` | **deleted.** Superseded by `src/utils/encodeWav.ts`. |
| `scripts/calibration/seededRandom.ts` | **modified.** Re-exports `mulberry32` from `@/audio/rng`, keeps `CALIBRATION_SEED`. |
| `scripts/calibration/renderOffline.ts` | **modified.** Uses `createRenderEngine` and `@/utils/encodeWav`. |
| `scripts/calibration/busHeadroom.smoke.ts` | **modified.** Uses `@/utils/encodeWav`. |
| `src/store/loop.ts`, `src/store/loop.test.ts` | **modified.** `loopBars` leaves; the one `INITIAL_CHORDS` content assertion stays. |
| `src/store/songMode.ts`, `src/store/songMode.test.ts` | **modified.** Two functions and three constants leave; `songMode.test.ts` shrinks to the coordinator's own tests. |
| `src/components/useSequencerPlayback.ts` | **modified.** `sequencerStepEvents` leaves; `fireSequencerStepEvents` stays (it touches the engine). |
| `src/components/loop/lead/useLeadPlayback.ts` | **modified.** Two helpers leave; the hook imports them. |
| `src/components/loop/chord/useChordPlayback.ts` | **modified.** Eight helpers leave; `armPad`'s decision half calls `resolvePadArm`. |
| `src/components/song/SortableLoopCard.tsx`, `ArrangeView.tsx`, `LoopCopyDialog.tsx`, `src/components/loop/lead/LeadMelodyGrid.tsx` | **modified.** One import line each. |
---

## Task 1: Move the structural loop maths to `src/utils/songStructure.ts`

A loop's length, and the rule that decides how long the arrangement dwells it, must be one expression. Today the arithmetic lives inline inside `songAdvanceDecision` (`src/store/songMode.ts:69-77`) and the renderer cannot reach it, because `src/audio/**` may not import `store/**`.

**Files:**
- Create: `src/utils/songStructure.ts`
- Create: `src/utils/songStructure.test.ts`
- Modify: `src/store/loop.ts` (delete `loopBars`), `src/store/loop.test.ts`
- Modify: `src/store/songMode.ts`, `src/store/songMode.test.ts`
- Modify: `src/components/song/SortableLoopCard.tsx:21`, `src/components/song/ArrangeView.tsx:20`, `src/components/song/LoopCopyDialog.tsx:3`, `src/components/loop/lead/LeadMelodyGrid.tsx:9`, `src/components/loop/chord/useChordPlayback.ts:61`

**Interfaces:**
- Consumes: nothing.
- Produces: `loopBars(chords: readonly StructuralChord[]): number`, `loopLengthSteps(chords: readonly StructuralChord[], stepsPerBar: number): number`, `loopDwellSteps(loop: StructuralLoop, stepsPerBar: number): number`, `songAdvanceDecision(loops: readonly StructuralLoop[], songLoopIndex: number | null, step: number, stepsPerBar: number): SongAdvance`, `SongAdvance`, `SONG_HOLD`, `SONG_END`, `StructuralChord`, `StructuralLoop`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/songStructure.test.ts`. Note it imports **nothing** from `src/store/` — the fixture loops are literals, which is the whole point of the module declaring its own structural types.

```ts
import { describe, expect, test } from 'bun:test';
import {
  loopBars,
  loopDwellSteps,
  loopLengthSteps,
  SONG_END,
  SONG_HOLD,
  songAdvanceDecision,
  type StructuralLoop,
} from './songStructure';

/** One chord per entry, `bars` wide. The fixture the old store tests built with
 *  `createDefaultLoop()` reduced to the fields this module actually reads. */
function structLoop(id: string, bars: number, repeatCount?: number): StructuralLoop {
  return { id, chords: [{ bars }], repeatCount };
}

describe('loopBars', () => {
  test('sums chord bars with a 1-bar default for bar-less chords', () => {
    expect(loopBars([])).toBe(0);
    expect(loopBars([{ bars: 2 }, { bars: 1 }, { bars: 4 }])).toBe(7);
    expect(loopBars([{ bars: 0 }])).toBe(1);
    expect(loopBars([{ bars: undefined }])).toBe(1);
  });
});

describe('loopLengthSteps', () => {
  test('multiplies bars by stepsPerBar', () => {
    expect(loopLengthSteps([{ bars: 2 }, { bars: 1 }], 16)).toBe(48);
    expect(loopLengthSteps([{ bars: 0 }], 16)).toBe(16);
    expect(loopLengthSteps([], 16)).toBe(0);
    expect(loopLengthSteps([{ bars: 2 }], 12)).toBe(24);
  });
});

describe('loopDwellSteps', () => {
  test('is the pass length when repeatCount is absent, 0 or 1', () => {
    expect(loopDwellSteps(structLoop('a', 4), 16)).toBe(64);
    expect(loopDwellSteps(structLoop('a', 4, 0), 16)).toBe(64);
    expect(loopDwellSteps(structLoop('a', 4, 1), 16)).toBe(64);
  });

  test('multiplies the pass length by repeatCount', () => {
    expect(loopDwellSteps(structLoop('a', 2, 3), 16)).toBe(96);
    expect(loopDwellSteps(structLoop('a', 1, 2), 16)).toBe(32);
    expect(loopDwellSteps({ id: 'a', chords: [{ bars: 1 }, { bars: 1 }], repeatCount: 2 }, 16)).toBe(64);
  });

  test('dwells a chordless loop one bar, not zero', () => {
    // The obvious simplification — loopLengthSteps x repeatCount — is wrong
    // here: loopLengthSteps is 0, so the renderer would schedule nothing and
    // the live arrangement would freeze. The app dwells it one bar.
    const empty: StructuralLoop = { id: 'empty', chords: [] };
    expect(loopDwellSteps(empty, 16)).toBe(16);
    expect(loopDwellSteps({ ...empty, repeatCount: 3 }, 16)).toBe(48);
    expect(loopDwellSteps({ id: 'z', chords: [{ bars: 0 }] }, 16)).toBe(16);
    expect(loopDwellSteps(empty, 24)).toBe(24);
  });

  test('floors a malformed repeatCount at one pass', () => {
    expect(loopDwellSteps(structLoop('a', 1, -2), 16)).toBe(16);
    expect(loopDwellSteps(structLoop('a', 1, 0.5), 16)).toBe(16);
  });
});

describe('songAdvanceDecision', () => {
  test('advances exactly on the boundary and holds everywhere else', () => {
    const loops = [structLoop('a', 4), structLoop('b', 2), structLoop('c', 1)];
    expect(songAdvanceDecision(loops, 0, 63, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 0, 64, 16)).toEqual({ kind: 'advance', loopId: 'b' });
    expect(songAdvanceDecision(loops, 1, 31, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 1, 32, 16)).toEqual({ kind: 'advance', loopId: 'c' });
  });

  test('ENDS the song after the last loop instead of wrapping', () => {
    const loops = [structLoop('a', 4), structLoop('b', 2)];
    expect(songAdvanceDecision(loops, 1, 32, 16)).toBe(SONG_END);
    expect(songAdvanceDecision(loops, 1, 31, 16)).toBe(SONG_HOLD);
  });

  test('ends a SINGLE-loop arrangement too', () => {
    expect(songAdvanceDecision([structLoop('a', 4)], 0, 64, 16)).toBe(SONG_END);
  });

  test('multiplies loop length by repeatCount before deciding', () => {
    const loops = [
      { ...structLoop('a', 2), repeatCount: 3 },
      { ...structLoop('b', 1), repeatCount: 2 },
    ];
    expect(songAdvanceDecision(loops, 0, 32, 16)).toBe(SONG_HOLD); // after rep 1
    expect(songAdvanceDecision(loops, 0, 64, 16)).toBe(SONG_HOLD); // after rep 2
    expect(songAdvanceDecision(loops, 0, 95, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 0, 96, 16)).toEqual({ kind: 'advance', loopId: 'b' });
    expect(songAdvanceDecision(loops, 1, 16, 16)).toBe(SONG_HOLD); // after rep 1
    expect(songAdvanceDecision(loops, 1, 32, 16)).toBe(SONG_END); // after rep 2
  });

  test('holds on step 0, in loop mode and on an out-of-range cursor', () => {
    const loops = [structLoop('a', 4)];
    expect(songAdvanceDecision(loops, null, 64, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 0, 0, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 99, 64, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision([], 0, 64, 16)).toBe(SONG_HOLD);
  });

  test('dwells an empty loop one bar then advances', () => {
    const loops = [{ id: 'empty', chords: [] } as StructuralLoop, structLoop('b', 1)];
    expect(songAdvanceDecision(loops, 0, 0, 16)).toBe(SONG_HOLD); // step 0
    expect(songAdvanceDecision(loops, 0, 15, 16)).toBe(SONG_HOLD); // mid-bar
    expect(songAdvanceDecision(loops, 0, 16, 16)).toEqual({ kind: 'advance', loopId: 'b' });
  });
});

describe('the dwell rule and the boundary rule agree', () => {
  /** The one test that stops the renderer's length rule and the arrangement's
   *  boundary rule from drifting: for every shape, the step `songAdvanceDecision`
   *  calls the boundary must be exactly `loopDwellSteps`. */
  const shapes: Array<[string, StructuralLoop]> = [
    ['4 bars, one pass', { id: 'a', chords: [{ bars: 4 }] }],
    ['4 bars, three passes', { id: 'a', chords: [{ bars: 4 }], repeatCount: 3 }],
    ['2+2 bars, two passes', { id: 'a', chords: [{ bars: 2 }, { bars: 2 }], repeatCount: 2 }],
    ['no chords', { id: 'a', chords: [] }],
    ['no chords, two passes', { id: 'a', chords: [], repeatCount: 2 }],
    ['a zero-bar chord', { id: 'a', chords: [{ bars: 0 }] }],
  ];

  for (const [name, loop] of shapes) {
    test(name, () => {
      const stepsPerBar = 16;
      const dwell = loopDwellSteps(loop, stepsPerBar);
      const loops = [loop, structLoop('next', 1)];
      expect(songAdvanceDecision(loops, 0, dwell, stepsPerBar)).toEqual({
        kind: 'advance',
        loopId: 'next',
      });
      expect(songAdvanceDecision(loops, 0, dwell - 1, stepsPerBar)).toBe(SONG_HOLD);
    });
  }
});
```

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/utils/songStructure.test.ts
```

Expect a module-not-found failure: `Cannot find module './songStructure'`.

- [ ] **Step 3: Write the module**

Create `src/utils/songStructure.ts`:

```ts
/**
 * Structural loop maths, free of the store. `src/audio/export/renderMixdown.ts`
 * has to know how long each loop dwells BEFORE it can size an
 * OfflineAudioContext, and src/audio/ may not import src/store/ — so the rule
 * lives here, in the one layer both can reach.
 *
 * The parameter types are declared HERE rather than imported from
 * `src/store/types.ts`, deliberately: importing them would widen the one
 * recorded `utils/ -> store/` inversion (utils/localFileSave.ts,
 * utils/driveBrowser.ts), which exists for a constant that cannot be
 * duplicated and would not be justified by a type. `Loop` is structurally
 * assignable to `StructuralLoop`, so no caller changes.
 */

/** One chord's structural contribution. `bars` absent means one bar. */
export interface StructuralChord {
  bars?: number;
}

/** The structural half of a loop — what the arrangement needs to know about it. */
export interface StructuralLoop {
  id: string;
  chords: readonly StructuralChord[];
  repeatCount?: number;
}

/**
 * A loop's length in bars — the same total the chord player already advances
 * through (`chord.bars x stepsPerBar` per chord), so the loop boundary is
 * exactly where the progression wraps.
 */
export function loopBars(chords: readonly StructuralChord[]): number {
  return chords.reduce((sum, c) => sum + (c.bars || 1), 0);
}

/** A loop's length in steps = sum(chord.bars) x stepsPerBar. */
export function loopLengthSteps(chords: readonly StructuralChord[], stepsPerBar: number): number {
  return loopBars(chords) * stepsPerBar;
}

/**
 * How many steps the arrangement spends on `loop`, repeats included.
 *
 * ONE expression of the dwell rule, shared by `songAdvanceDecision` and the
 * offline renderer, so the file's length and the live arrangement cannot
 * disagree. The obvious form — `loopLengthSteps x repeatCount` — is WRONG for a
 * chordless loop: its `loopLengthSteps` is 0, so the naive version schedules
 * nothing where the app dwells one silent bar. The `max(..., stepsPerBar)`
 * floor is what keeps `step % totalSteps === 0` reachable at all.
 */
export function loopDwellSteps(loop: StructuralLoop, stepsPerBar: number): number {
  const effectiveLength = Math.max(loopLengthSteps(loop.chords, stepsPerBar), stepsPerBar);
  return effectiveLength * Math.max(1, loop.repeatCount ?? 1);
}

/**
 * What the arrangement does at this clock step.
 *
 * Three answers, not two, and the third is why this is a union: `hold` is
 * "not a transition boundary" — every non-boundary step, loop mode, an
 * out-of-range cursor — while `end` is "the song is over". The old
 * `string | null` return spelled both of them `null`, so the caller could not
 * stop on one and do nothing on the other, and the arrangement could only
 * ever wrap.
 */
export type SongAdvance =
  | { kind: 'hold' }
  | { kind: 'advance'; loopId: string }
  | { kind: 'end' };

/** Nothing happens on this step. */
export const SONG_HOLD: SongAdvance = Object.freeze({ kind: 'hold' });

/** The last loop's last repeat just completed: the song is over. */
export const SONG_END: SongAdvance = Object.freeze({ kind: 'end' });

/**
 * The decision for one clock step. `step` is measured from the shared clock's
 * reset origin — every advance re-anchors the grid at the boundary, so each
 * loop's boundary is `loopDwellSteps` steps from 0 (the same alignment the
 * Instant Vibe swap relies on).
 *
 * The last slot ENDS the song; it does not wrap. A single-loop arrangement is
 * no exception. The user-facing reason is a separation of duties: auditioning
 * a loop card already means "loop one thing forever"; song mode means a piece
 * with an ending, and one arrangement size must not silently switch which of
 * the two the Play button does.
 */
export function songAdvanceDecision(
  loops: readonly StructuralLoop[],
  songLoopIndex: number | null,
  step: number,
  stepsPerBar: number,
): SongAdvance {
  if (songLoopIndex === null) return SONG_HOLD;
  const loop = loops[songLoopIndex];
  if (!loop) return SONG_HOLD;
  const totalSteps = loopDwellSteps(loop, stepsPerBar);
  if (step <= 0 || step % totalSteps !== 0) return SONG_HOLD;
  const next = loops[songLoopIndex + 1];
  return next ? { kind: 'advance', loopId: next.id } : SONG_END;
}
```

- [ ] **Step 4: Run the test and expect it to pass**

```bash
bun test src/utils/songStructure.test.ts
```

Expect all describes green.

- [ ] **Step 5: Delete the originals and repoint every importer**

In `src/store/loop.ts`, delete the `loopBars` function and its docblock (keep everything else, including `loopLabel`).

In `src/store/songMode.ts`:

```ts
// delete: the loopBars import (line 7), loopLengthSteps, SongAdvance,
// SONG_HOLD, SONG_END and songAdvanceDecision (lines 14-79)
// replace with:
import { songAdvanceDecision, type SongAdvance } from '../utils/songStructure';
```

`enterSongIndex` **stays** where it is — it is pure, but the renderer walks loops from index 0 and never computes a song entry index.

Repoint the six import sites (a plain path change; `loopLabel` does NOT move):

```ts
// src/components/song/SortableLoopCard.tsx:21
import { loopBars } from '@/utils/songStructure';

// src/components/song/ArrangeView.tsx:20 — becomes TWO lines, because
// loopLabel stays behind in the store:
import { loopLabel } from '@/store/loop';
import { loopBars } from '@/utils/songStructure';

// src/components/song/LoopCopyDialog.tsx:3
import { loopBars } from '@/utils/songStructure';

// src/components/loop/lead/LeadMelodyGrid.tsx:9
import { loopBars } from '@/utils/songStructure';

// src/components/loop/chord/useChordPlayback.ts:61
import { loopBars } from "@/utils/songStructure";
```

In `src/store/loop.test.ts`, drop `loopBars` from the `./loop` import list and drop the `loopBars` describe (lines 71-78). Add, importing from the new module:

```ts
import { loopBars, loopLengthSteps } from '@/utils/songStructure';

/**
 * The MOVED maths is covered in src/utils/songStructure.test.ts. What stays
 * here is the CONTENT: the store's factory progression is four bars, and every
 * loop-length readout in the app is calibrated against that number.
 */
describe('the factory progression', () => {
  test('is four bars, 64 steps in 4/4', () => {
    expect(loopBars(INITIAL_CHORDS)).toBe(4);
    expect(loopLengthSteps(INITIAL_CHORDS, 16)).toBe(64);
  });
});
```

In `src/store/songMode.test.ts`, delete the `loopLengthSteps`, `SONG_END`, `SONG_HOLD` and `songAdvanceDecision` entries from the `./songMode` import (lines 11-16) and delete these describes in full — every one of their cases now lives, rewritten against literal fixtures, in `src/utils/songStructure.test.ts`:

- `loopLengthSteps multiplies bars by stepsPerBar` (line 36)
- `songAdvanceDecision advances exactly on the boundary and holds everywhere else` (line 47)
- `songAdvanceDecision ENDS the song after the last loop instead of wrapping` (line 55)
- `songAdvanceDecision ends a SINGLE-loop arrangement too` (line 63)
- `songAdvanceDecision multiplies loop length by repeatCount before deciding` (line 73)
- `songAdvanceDecision holds on step 0, in loop mode and on an out-of-range cursor` (line 86)
- `songAdvanceDecision dwells an empty loop one bar then advances` (line 95)

Keep `isSongLayer` and `enterSongIndex`. If `INITIAL_CHORDS`, `createDefaultLoop` or `Loop` become unused imports after the deletion, remove them — `bun run eslint` will not tell you, but `tsc` will.

- [ ] **Step 6: Run the affected tests**

```bash
bun test src/utils/songStructure.test.ts src/store/loop.test.ts src/store/songMode.test.ts
bun run lint
```

Expect both suites green and `tsc` clean. `tsc` is what proves the move is complete: a leftover `import { loopBars } from '@/store/loop'` anywhere fails the type check.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(utils): move structural loop maths into songStructure

loopBars, loopLengthSteps and songAdvanceDecision move out of src/store/
into a store-free src/utils/songStructure.ts, and the dwell rule that used
to be inline inside songAdvanceDecision becomes an exported
loopDwellSteps — the one expression the offline mixdown renderer will size
its buffer from.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: Port `mulberry32` into `src/audio/rng.ts`

An offline render must be reproducible: reverb impulse noise, noise-voice buffers and the arp's `'random'` note order all read `random()`, and today the only seeded generator in the repo lives in `scripts/calibration/`, which `src/` cannot import.

**Files:**
- Modify: `src/audio/rng.ts`
- Modify: `src/audio/rng.test.ts`
- Modify: `scripts/calibration/seededRandom.ts` (re-export)

**Interfaces:**
- Consumes: nothing.
- Produces: `mulberry32(seed: number): () => number`, `MIXDOWN_SEED: number`, `withSeededRandom<T>(seed: number, run: () => T | Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/rng.test.ts`. Note that this file is one of the two paths `eslint.config.js` exempts from the `Math.random` ban, which is why the restore tests may patch `Math.random` directly.

```ts
import { mulberry32, MIXDOWN_SEED, withSeededRandom } from './rng';

describe('mulberry32', () => {
  test('is byte-for-byte the calibration stream it was ported from', () => {
    // Pinned from scripts/calibration/seededRandom.ts BEFORE the port. The
    // port is only correct if these three numbers do not move.
    const r = mulberry32(42);
    expect([r(), r(), r()]).toEqual([
      0.60110375192016363, 0.44829055899754167, 0.85246579349040985,
    ]);
  });

  test('the same seed replays the same stream, a different seed does not', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const c = mulberry32(1235);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect([mulberry32(1234)(), mulberry32(1234)()]).toEqual([mulberry32(1234)(), mulberry32(1234)()]);
    expect(mulberry32(1234)()).not.toBe(c());
  });

  test('every value is inside [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('MIXDOWN_SEED is a 32-bit unsigned integer', () => {
    expect(Number.isInteger(MIXDOWN_SEED)).toBe(true);
    expect(MIXDOWN_SEED).toBeGreaterThanOrEqual(0);
    expect(MIXDOWN_SEED).toBeLessThanOrEqual(0xffff_ffff);
  });
});

describe('withSeededRandom', () => {
  test('random() is the seeded stream for the duration of `run`', async () => {
    const inside = await withSeededRandom(99, () => random());
    expect(inside).toBe(mulberry32(99)());
  });

  test('restores the default on the success path', async () => {
    const original = Math.random;
    // Patch Math.random so "the default" is an exact value rather than a
    // statistical claim: setRandomSource(null) reads Math.random at call
    // time, so a patch installed before the call is what it lands on.
    Math.random = () => 0.3141592653589793;
    try {
      await withSeededRandom(5, () => undefined);
      expect(random()).toBe(0.3141592653589793);
    } finally {
      Math.random = original;
    }
  });

  test('restores the default when `run` throws, and rethrows', async () => {
    const original = Math.random;
    Math.random = () => 0.2718281828459045;
    try {
      const boom = new Error('render exploded');
      await expect(withSeededRandom(5, () => {
        throw boom;
      })).rejects.toBe(boom);
      expect(random()).toBe(0.2718281828459045);
    } finally {
      Math.random = original;
    }
  });

  test('a SECOND render replays the stream from the top, not from where it stopped', async () => {
    const first = await withSeededRandom(3, () => [random(), random(), random()]);
    const second = await withSeededRandom(3, () => [random(), random(), random()]);
    expect(second).toEqual(first);
  });
});
```

The existing file's import line becomes:

```ts
import { describe, expect, test, afterEach } from 'bun:test';
import { mulberry32, MIXDOWN_SEED, random, setRandomSource, withSeededRandom } from './rng';
```

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/audio/rng.test.ts
```

Expect `SyntaxError: Export named 'mulberry32' not found` from the new import line.

- [ ] **Step 3: Implement**

In `src/audio/rng.ts`, append below `setRandomSource`, and **rewrite the docblock paragraph that is now false**. The paragraph to replace is the one ending "only tests and the calibration harness call `setRandomSource`" — it must say:

```
 * It exists so an offline render can be made reproducible by installing a
 * seeded generator for the duration of the render. THREE callers install a
 * replacement: the calibration harness in scripts/calibration/, the tests in
 * this directory, and — since the mixdown export shipped — the offline
 * renderer in src/audio/export/renderMixdown.ts, which is the first
 * PRODUCTION path to do so. Its replacement is scoped to one render and is
 * restored on every exit path; a caller that leaves one installed would make
 * every later caller, in the same process, silently non-random.
```

Then the code:

```ts
/**
 * A tiny deterministic PRNG (mulberry32), ported verbatim from
 * scripts/calibration/seededRandom.ts — which now re-exports THIS one — so the
 * offline mixdown render and the calibration renders draw from one
 * implementation rather than two that must be kept in step.
 *
 * Not cryptographically random and not meant to be: the only requirement is
 * that the same seed produces the same stream of [0, 1) values every time, on
 * every platform, so a render is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seed every offline mixdown render resets to. A constant, not a secret:
 * any value works as long as it never changes between renders, which is what
 * makes two exports of the same song byte-identical.
 */
export const MIXDOWN_SEED = 0x6d69_7864; // 'mixd' ascii-ish, arbitrary

/**
 * Installs a FRESH `mulberry32(seed)` stream, runs `run`, and restores the
 * default on every exit path — success, throw and rejection alike.
 *
 * The reset happens at the START of every call rather than once per process,
 * so a render never carries stream state over from an earlier one. That is not
 * a nicety: without it, exporting the same song twice would produce two
 * different files, and a re-run of one test in isolation would not reproduce
 * the value a full-suite run produced.
 *
 * The seeding lives here rather than at each call site so "restored on every
 * exit path" is a property of one function instead of a `finally` every caller
 * has to remember.
 */
export async function withSeededRandom<T>(seed: number, run: () => T | Promise<T>): Promise<T> {
  setRandomSource(mulberry32(seed));
  try {
    return await run();
  } finally {
    setRandomSource(null);
  }
}
```

- [ ] **Step 4: Run the test and expect it to pass**

```bash
bun test src/audio/rng.test.ts
```

- [ ] **Step 5: Make the calibration copy a re-export**

Replace the body of `scripts/calibration/seededRandom.ts` — the `mulberry32` function and its docblock — with a re-export, keeping `CALIBRATION_SEED` exactly as it is:

```ts
/**
 * The calibration harness's seeded PRNG. `mulberry32` itself now lives in
 * src/audio/rng.ts, beside the `setRandomSource` seam it feeds, because the
 * offline mixdown renderer needs it too and `src/` cannot import from
 * `scripts/`. Re-exported rather than duplicated: two implementations of "the
 * seeded stream" is the shape that drifts silently, and the pinning test in
 * src/audio/rng.test.ts is what holds this one honest.
 */
export { mulberry32 } from '@/audio/rng';

/** The fixed seed every calibration render is reset to. Not a secret, just a
 *  constant: any value works as long as it never changes between renders. */
export const CALIBRATION_SEED = 0x53_4f_4c_4e; // 'SOLN' ascii-ish, arbitrary
```

`scripts/calibration/seededRandom.test.ts` is unchanged — it still imports `./seededRandom.ts` and still passes, which is the cheapest proof that the wiring survives.

- [ ] **Step 6: Run the affected tests**

```bash
bun test src/audio/rng.test.ts scripts/calibration/seededRandom.test.ts
bun run lint && bun run eslint
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(audio): port mulberry32 into the rng seam

The offline renderer needs a deterministic stream and src/ cannot import
from scripts/, so mulberry32 moves into src/audio/rng.ts beside
setRandomSource, with a withSeededRandom helper that restores the default
on every exit path. The calibration copy becomes a re-export, and rng.ts's
docblock no longer claims that no production path installs a replacement —
the renderer is one.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: Port the WAV encoder to `src/utils/encodeWav.ts`

The encoder is the only thing between an `AudioBuffer` and a downloadable file, and today it lives in `scripts/calibration/`, unreachable from the app.

**Files:**
- Create: `src/utils/encodeWav.ts`
- Create: `src/utils/encodeWav.test.ts`
- Delete: `scripts/calibration/encodeWav.ts`, `scripts/calibration/encodeWav.test.ts`
- Modify: `scripts/calibration/renderOffline.ts:39,236`, `scripts/calibration/busHeadroom.smoke.ts:51,116`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodeWavBytes(channels: Float32Array[], sampleRate: number): Uint8Array`, `encodeWav(channels: Float32Array[], sampleRate: number): Blob`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/encodeWav.test.ts` — the nine calibration assertions moved verbatim, plus the `Blob` wrapper. The decode helper is local to the test:

```ts
import { describe, expect, test } from 'bun:test';
import { encodeWav, encodeWavBytes } from './encodeWav';

/** Reads back the samples a 16-bit PCM WAV carries, in channel order. */
function decodePcm16(wav: Uint8Array, channel: number, channelCount: number, frame: number): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const offset = 44 + (frame * channelCount + channel) * 2;
  return view.getInt16(offset, true);
}

describe('encodeWavBytes', () => {
  test('writes a RIFF/WAVE header with a fmt and a data chunk', () => {
    const wav = encodeWavBytes([new Float32Array(4)], 44100);
    const view = new DataView(wav.buffer);
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
  });

  test('declares PCM, the channel count, the sample rate and 16 bits', () => {
    const view = new DataView(encodeWavBytes([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint16(20, true)).toBe(1); // format 1 = PCM
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  test('byte rate and block align follow from the channel count', () => {
    const view = new DataView(encodeWavBytes([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2);
    expect(view.getUint16(32, true)).toBe(4);
  });

  test('is 44 header bytes plus 2 bytes per sample, and the sizes agree', () => {
    const wav = encodeWavBytes([new Float32Array(100), new Float32Array(100)], 44100);
    const view = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(44 + 100 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8); // RIFF size
    expect(view.getUint32(40, true)).toBe(100 * 2 * 2); // data size
  });

  test('interleaves channels frame by frame, little-endian', () => {
    const left = new Float32Array([1, 0, -1, 0]);
    const right = new Float32Array([0, 0.5, 0, -0.5]);
    const wav = encodeWavBytes([left, right], 44100);
    expect(decodePcm16(wav, 0, 2, 0)).toBe(0x7fff);
    expect(decodePcm16(wav, 1, 2, 0)).toBe(0);
    expect(decodePcm16(wav, 0, 2, 1)).toBe(0);
    expect(decodePcm16(wav, 1, 2, 1)).toBe(Math.round(0.5 * 0x7fff));
    expect(decodePcm16(wav, 0, 2, 2)).toBe(-0x8000);
    expect(decodePcm16(wav, 1, 2, 3)).toBe(Math.round(-0.5 * 0x8000));
  });

  test('clamps past +/-1 instead of wrapping', () => {
    const view = new DataView(encodeWavBytes([new Float32Array([2, -2])], 44100).buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  test('round-trips a signal back to within one quantization step', () => {
    const signal = new Float32Array([0, 0.25, -0.25, 0.5, -0.5, 0.999, -0.999]);
    const wav = encodeWavBytes([signal], 44100);
    for (let i = 0; i < signal.length; i += 1) {
      // Asymmetric scale factors: +1 maps to 0x7fff, -1 to -0x8000.
      const expected = signal[i] < 0 ? (signal[i] * 0x8000) / 0x8000 : (signal[i] * 0x7fff) / 0x7fff;
      expect(decodePcm16(wav, 0, 1, i) / (signal[i] < 0 ? 0x8000 : 0x7fff)).toBeCloseTo(expected, 4);
    }
  });

  test('an empty channel array throws', () => {
    expect(() => encodeWavBytes([], 44100)).toThrow(/at least one channel/);
  });

  test('mismatched channel lengths throw', () => {
    const short = new Float32Array(4);
    const long = new Float32Array(8);
    expect(() => encodeWavBytes([short, long], 44100)).toThrow(/same length/);
  });
});

describe('encodeWav', () => {
  test('returns a Blob of the same bytes, typed as audio/wav', async () => {
    const channels = [new Float32Array([0.5, -0.5]), new Float32Array([0.25, -0.25])];
    const blob = encodeWav(channels, 44100);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 2 * 2 * 2);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toEqual(encodeWavBytes(channels, 44100));
  });
});
```

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/utils/encodeWav.test.ts
```

Expect `Cannot find module './encodeWav'`.

- [ ] **Step 3: Implement**

Create `src/utils/encodeWav.ts` — `encodeWavBytes` is the calibration body **verbatim**, comments included, because `check:levels` hashes what the harness writes and a byte of drift fails the gate:

```ts
/**
 * Rendered `AudioBuffer` channels -> a 16-bit PCM WAV, because a file is what
 * the user asked for and `startRendering()` returns Float32 channel data.
 *
 * 16-bit is deliberate and not a shortcut: the quantization floor is about
 * -96 dBFS while a Solna mix sits near -18 dBFS, so the encoding contributes
 * nothing measurable. The calibration harness measured against this same
 * argument for a year.
 *
 * Live in src/utils/ rather than scripts/ because it is no longer only a
 * harness concern: it is above data/, reachable from both src/audio/ and
 * src/components/, and free of DOM events — this function does not download
 * anything, it only encodes.
 */
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/** The 44-byte RIFF/WAVE header, little-endian samples, clamped to +/-1. */
export function encodeWavBytes(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  if (channelCount === 0) {
    throw new Error('encodeWav requires at least one channel; got an empty array.');
  }
  const frameCount = channels[0]?.length ?? 0;
  for (const [index, channel] of channels.entries()) {
    if (channel.length !== frameCount) {
      throw new Error(
        `encodeWav requires every channel to have the same length; channel 0 has ` +
          `${frameCount} frames but channel ${index} has ${channel.length}.`,
      );
    }
  }
  const dataBytes = frameCount * channelCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, channelCount * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]?.[frame] ?? 0;
      // Clamp, never wrap: a sample past +1 wrapping to -32768 would turn an
      // over-hot voice into a measurement that reads plausible.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}

/**
 * The download-shaped wrapper. `Blob` rather than `Uint8Array` because that is
 * what `downloadBlob` and `ProjectSaveResult.destination: 'download'` take;
 * the harness adapts with `new Uint8Array(await blob.arrayBuffer())` instead of
 * keeping a second implementation.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  return new Blob([encodeWavBytes(channels, sampleRate)], { type: 'audio/wav' });
}
```

- [ ] **Step 4: Run the test and expect it to pass**

```bash
bun test src/utils/encodeWav.test.ts
```

- [ ] **Step 5: Delete the calibration copy and repoint its two callers**

```bash
git rm scripts/calibration/encodeWav.ts scripts/calibration/encodeWav.test.ts
```

In `scripts/calibration/renderOffline.ts`, change the import (line 39) to `import { encodeWav } from '@/utils/encodeWav';` and make `renderToWav` adapt the Blob — it is already `async`:

```ts
async function renderToWav(ctx: any): Promise<Uint8Array> {
  const buffer = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  // The shared encoder returns a Blob; the harness writes bytes to a file, so
  // it adapts here rather than keeping a second implementation of the format.
  return new Uint8Array(await encodeWav(channels, CALIBRATION_SAMPLE_RATE).arrayBuffer());
}
```

In `scripts/calibration/busHeadroom.smoke.ts`, change the import (line 51) to `import { encodeWav } from '@/utils/encodeWav';` and the call site (line 116) from `const wav = encodeWav(summed, CALIBRATION_SAMPLE_RATE);` to:

```ts
  const wav = new Uint8Array(await encodeWav(summed, CALIBRATION_SAMPLE_RATE).arrayBuffer());
```

`decodeWav` in that file reads a `Uint8Array`, so the wrapping belongs at the call site and the decoder is untouched. Its enclosing function is already `async`.

- [ ] **Step 6: Run the level gate and the affected tests**

```bash
bun test src/utils/encodeWav.test.ts scripts/calibration/seededRandom.test.ts
bun run check:levels
bun run lint && bun run eslint
```

`check:levels` asserts the calibration trim table still matches today's kit and preset defaults. It does not render audio, so the port cannot move its numbers — if it goes red, the port was not byte-faithful and that is the signal, not a gate to relax.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(utils): port the WAV encoder into src

encodeWavBytes is the calibration encoder verbatim, so the harness's
bytes — and therefore the check:levels hash — cannot move. encodeWav
wraps it in the Blob the download path takes, and the two calibration
callers adapt rather than keeping a second implementation.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
---

## Task 4: Widen the engine's context and add the render seam

`AudioEngine.init()` is the only way to bind a context today, and it creates a *realtime* one from `window.AudioContext`. An offline render needs a second, throwaway engine bound to a caller-supplied `OfflineAudioContext` — the three steps `scripts/calibration/renderOffline.ts:185-186` already performs through `makeEngine() as any`.

**Files:**
- Modify: `src/audio/engine.ts`
- Create: `src/audio/engine.render.test.ts`
- Modify: `scripts/calibration/renderOffline.ts:185-186`

**Interfaces:**
- Consumes: nothing.
- Produces: `export class AudioEngine`, `createRenderEngine(ctx: BaseAudioContext): AudioEngine`, `AudioEngine.bindContext(ctx: BaseAudioContext): void`, `AudioEngine.getAudioContext(): BaseAudioContext | null`.

- [ ] **Step 1: Write the failing test**

Create `src/audio/engine.render.test.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine's public
   surface is typed against the DOM's BaseAudioContext, and node-web-audio-api
   implements the same spec with its own class objects. The casts are at the
   seam, in a test, and nowhere in src/audio/export/. */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine, createRenderEngine } from './engine';
import { DEFAULT_DRUM_KIT } from '@/data/drumKits';

/** A real offline context, at the app's working rate and channel count. */
function offlineCtx(seconds: number): any {
  return new OfflineAudioContext(2, Math.round(44100 * seconds), 44100);
}

describe('createRenderEngine', () => {
  test('returns a fresh AudioEngine bound to the context it was handed', () => {
    const ctx = offlineCtx(0.1);
    const engine = createRenderEngine(ctx);
    expect(engine).toBeInstanceOf(AudioEngine);
    expect(engine.getAudioContext()).toBe(ctx as unknown as BaseAudioContext);
  });

  test('builds the master chain, so a bus exists and a kick makes sound', async () => {
    const ctx = offlineCtx(0.25);
    const engine = createRenderEngine(ctx);
    engine.setDrumKit(DEFAULT_DRUM_KIT, 'default');
    engine.setMasterVolume(1);
    engine.triggerDrum('kick', 1, 0);
    const buffer: any = await ctx.startRendering();
    const data: Float32Array = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    // A seam that bound the context but never ran setupMasterChain() would
    // render a perfectly well-formed, perfectly silent buffer, and the
    // instance assertions above would all still pass.
    expect(peak).toBeGreaterThan(0);
  });

  test('each call gets its OWN engine — the singleton is never reused', () => {
    const a = createRenderEngine(offlineCtx(0.05));
    const b = createRenderEngine(offlineCtx(0.05));
    expect(a).not.toBe(b);
  });
});

describe('getAudioContext on a render engine', () => {
  test('is the offline context, not an AudioContext', () => {
    const ctx = offlineCtx(0.05);
    const engine = createRenderEngine(ctx);
    const widened = engine.getAudioContext();
    // The field is BaseAudioContext | null. An OfflineAudioContext has no
    // resume()/close()/state — which is exactly why every realtime-only path
    // narrows back through the engine's own realtimeCtx() helper — so the
    // presence of currentTime and the absence of state is the assertion.
    expect(widened).not.toBeNull();
    expect(typeof widened?.currentTime).toBe('number');
    expect((widened as any).state).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/audio/engine.render.test.ts
```

Expect `SyntaxError: Export named 'AudioEngine' not found` (the class is unexported today) and, once that is fixed, `createRenderEngine` not existing.

- [ ] **Step 3: Export the class and widen the field**

In `src/audio/engine.ts`:

```ts
// line 220 — was `class AudioEngine {`
export class AudioEngine {
```

```ts
// line 221 — was `private ctx: AudioContext | null = null;`
  /**
   * The audio context this engine is bound to. `BaseAudioContext`, not
   * `AudioContext`: an offline render binds an `OfflineAudioContext`, which
   * implements the node factories, `currentTime` and `destination` but has no
   * `resume()`, `close()` or `state`. Every realtime-only path narrows back
   * through `realtimeCtx()` below rather than assuming the narrower type.
   */
  private ctx: BaseAudioContext | null = null;
```

```ts
// line 2994 — the return type widens with the field
  getAudioContext(): BaseAudioContext | null {
    return this.ctx;
  }
```

- [ ] **Step 4: Narrow the three realtime-only call sites**

Add the narrowing helper beside `init()`:

```ts
  /**
   * The bound context, narrowed to a realtime one, or null.
   *
   * `state`, `resume()` and `suspend()` exist on `AudioContext` and NOT on
   * `BaseAudioContext`, so this is the ONE place the widened field is narrowed
   * back. Duck-typed on `resume` rather than `instanceof AudioContext`: the
   * global does not exist under `bun test`, and a render engine running there
   * would otherwise throw a ReferenceError from an idle timer that has
   * nothing to do.
   */
  private realtimeCtx(): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || !('resume' in ctx)) return null;
    return ctx as AudioContext;
  }
```

Then rewrite `init()` so it holds the realtime context in a local (it created it, so it knows):

```ts
  async init(): Promise<void> {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.setupMasterChain();
      this.createClickBuffers();
    }

    const ctx = this.realtimeCtx();
    if (ctx?.state === 'suspended') {
      try {
        await ctx.resume();
        this.rearmVoiceTeardowns();
        this.suspendedForIdle = false;
      } catch {
        // browser autoplay policy requires user gesture
      }
    }
    this.markActivity();
    this.isInitialized = true;
  }
```

`maybeSuspendNow()` becomes:

```ts
  private maybeSuspendNow(): void {
    const ctx = this.realtimeCtx();
    if (!ctx) return;
    const ok = shouldSuspendWhenIdle({
      clockListenerCount: this.clockListeners.size,
      liveVoiceCount: this.liveVoiceCount(),
      contextState: ctx.state,
    });
    if (!ok) {
      this.markActivity();
      return;
    }
    try {
      const suspending = Promise.resolve(ctx.suspend());
      this.suspendedForIdle = true;
      void suspending.catch(() => {
        this.suspendedForIdle = false;
      });
    } catch {
      this.suspendedForIdle = false;
    }
  }
```

`wakeIfIdle()`'s guard becomes a realtime-context test, and the reason matters:

```ts
  wakeIfIdle(): void {
    // An offline render engine has no idle lifecycle. There is nothing to
    // resume, the wall clock plays no part in a render, and arming
    // markActivity's setTimeout here would keep a `bun test` process alive
    // for IDLE_SUSPEND_MS after every render test. triggerDrum and
    // triggerSynthNoteOn both reach this on every event, so the guard is on
    // the hot path for renders, not a rare branch.
    const ctx = this.realtimeCtx();
    if (!ctx) return;
    if (!this.suspendedForIdle) {
      this.markActivity();
      return;
    }
    void Promise.resolve(ctx.resume())
      .then(() => {
        this.suspendedForIdle = false;
      })
      .catch(() => {
        // Left true so the NEXT gesture retries resume() instead of
        // silently giving up on a rejection that may not be permanent.
      });
```

Leave the rest of `wakeIfIdle`'s body (the synchronous re-arm) exactly as it is.

- [ ] **Step 5: Add `bindContext` and the factory**

Insert directly below `init()`:

```ts
  /**
   * Binds an already-constructed context and builds the master chain on it.
   *
   * The seam an offline render comes through: `init()` creates a realtime
   * context and is untouched, while a render engine binds the caller's
   * `OfflineAudioContext` with this. Public rather than private because the
   * module-level `createRenderEngine` is not a member of the class, and
   * `setupMasterChain` stays private — this is the one door to it.
   *
   * A render engine is never stored in the singleton, never reaches
   * engineSync.ts, and never outlives its `startRendering()` call.
   */
  bindContext(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.setupMasterChain();
  }
```

And at the bottom of the file, beside `export const audioEngine = new AudioEngine();`:

```ts
/**
 * A throwaway engine bound to a caller-supplied context, for offline renders.
 *
 * Replaces the `makeEngine() as any; engine.ctx = ctx; engine.setupMasterChain()`
 * dance scripts/calibration/renderOffline.ts used to perform — the same three
 * steps, through a supported door instead of a cast.
 *
 * The singleton above is deliberately NOT involved: a render must not disturb
 * the session's engine, and the session's engine must not be audible in the
 * render.
 */
export function createRenderEngine(ctx: BaseAudioContext): AudioEngine {
  const engine = new AudioEngine();
  engine.bindContext(ctx);
  return engine;
}
```

- [ ] **Step 6: Run the test and expect it to pass**

```bash
bun test src/audio/engine.render.test.ts
```

Expect all five tests green.

- [ ] **Step 7: Switch the calibration harness to the seam**

In `scripts/calibration/renderOffline.ts`, import `createRenderEngine` from `@/audio/engine`, and replace lines 185-186:

```ts
  // was: const engine = makeEngine() as any; engine.ctx = ctx; engine.setupMasterChain();
  const engine = createRenderEngine(ctx) as any;
```

The `as any` stays for the fields the harness reaches AFTER binding (`engine.reverbGain` and the other send nodes, in the dry-only loop below) — those are still private, and that is still the harness's business. What is gone is the cast that existed only to *construct* an engine. `makeEngine` keeps its other users in `src/audio/testFakes.ts`; drop it from this file's imports if it is now unused.

- [ ] **Step 8: Run the affected tests**

```bash
bun test src/audio/engine.test.ts src/audio/engine.render.test.ts
bun run lint && bun run eslint
bun run check:levels
```

`engine.test.ts` is 3000+ lines and the whole of it exercises the widened field, so it is the real regression net here.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(audio): add an offline render seam to the engine

AudioEngine is exported, its ctx widens to BaseAudioContext | null, and a
createRenderEngine(ctx) factory binds a throwaway engine to a caller's
context and builds the master chain on it. The three realtime-only paths
(init, maybeSuspendNow, wakeIfIdle) narrow back through a realtimeCtx()
helper, and wakeIfIdle no-ops for an offline context so a render cannot arm
an idle timer that keeps a test process alive. init() is unchanged in
behaviour: it is still the only thing that creates a realtime context.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 5: Move the pure step functions into `src/audio/`

Four moves, four commits. Every one of them is the same shape: the function is pure, it lives where the renderer cannot reach it, and the hook keeps the half that touches the engine. **These are moves, not copies** — a second implementation of "what happens at this step" is exactly the shape that silently drifts, and the renderer would be the copy no test exercises.

### 5A — `sequencerStepEvents`

- [ ] **Step 1: Move the failing test**

Move the `describe('sequencerStepEvents', ...)` block out of `src/components/useSequencerPlayback.test.ts` (it starts at line 84 and runs to line 138) into a new `src/audio/sequencerSteps.test.ts`. It needs `SequencerTrack` / `SynthParams` from `@/types`, and its synth-params fixture from the shared audio fixture (Task 5A's Step 3 adds it) rather than a store import — `src/audio/**` may not import `store/**` and there is no `allowTypeImports` exemption.

The remaining describes in `useSequencerPlayback.test.ts` (`sequencer stepper`, `sequencer stepper in a non-4/4 meter`, `the clock effect resubscribes only on isPlaying/hardStop`, `the sequencer fader is a bus gain, never a velocity`) stay where they are — they are about the hook.

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/audio/sequencerSteps.test.ts
```

- [ ] **Step 3: Add the shared synth-params fixture**

In `src/audio/testFakes.ts`, append a fixture that mirrors `INITIAL_SYNTH_PARAMS` (`src/store/initialState.ts:11-37`) — the audio layer may not import the store, and every moved test that needs a patch needs one of these:

```ts
/**
 * A SynthParams literal mirroring the store's `INITIAL_SYNTH_PARAMS`. It lives
 * here rather than being imported because src/audio/ may not import
 * src/store/ — the eslint block for this directory has no allowTypeImports
 * exemption — and a test that had to build one inline would drift from the
 * default patch the moment the store's changed.
 */
export function synthParamsFixture(over: Partial<SynthParams> = {}): SynthParams {
  return {
    oscType: 'sawtooth',
    subOscVolume: 0.3,
    noiseVolume: 0.02,
    detune: 6,
    filterType: 'lowpass',
    filterCutoff: 2400,
    filterResonance: 3.0,
    filterEnvAmount: 1200,
    attack: 0.02,
    decay: 0.4,
    sustain: 0.6,
    release: 0.5,
    filterAttack: 0.02,
    filterDecay: 0.4,
    filterSustain: 0,
    filterRelease: 0.5,
    lfoRate: 3.5,
    lfoDepth: 0.2,
    lfoTarget: 'cutoff',
    octave: 0,
    arpActive: false,
    arpMode: 'up',
    arpRate: '16n',
    arpOctaves: 1,
    preset: 'Cosmic Lead',
    ...over,
  };
}
```

It needs `import type { SynthParams } from '@/types';` at the top of `testFakes.ts`.

- [ ] **Step 4: Implement the move**

Create `src/audio/sequencerSteps.ts` containing `SequencerStepEvent`, `sequencerStepEvents` and their docblocks, moved verbatim from `src/components/useSequencerPlayback.ts:48-85`. Its imports are `stepDurationSec` from `../utils/musicTheory` and `SequencerTrack`/`SynthParams` from `../types` — all already audio-reachable.

`sequencerStepAction` and `fireSequencerStepEvents` **stay** in the hook: the first is arming state and the second calls `playbackNoteOn`/`triggerPad`. `useSequencerPlayback.ts` gains `import { sequencerStepEvents, type SequencerStepEvent } from '@/audio/sequencerSteps';` and its test file keeps its remaining describes.

- [ ] **Step 5: Run the tests and expect them to pass**

```bash
bun test src/audio/sequencerSteps.test.ts src/components/useSequencerPlayback.test.ts
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(audio): move sequencerStepEvents into src/audio

The per-step drum/note decision is pure and the offline renderer needs it,
but src/audio/ may not import src/components/. The arming decision and the
engine-touching fireSequencerStepEvents stay in the hook.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### 5B — `leadDispatchTicks` and `leadScheduleHits`

- [ ] **Step 1: Move the failing tests**

Move `describe('leadDispatchTicks', ...)` (line 59) and `describe('leadScheduleHits — the arp runs on the clock, not on the grid', ...)` (line 86) out of `src/components/loop/lead/useLeadPlayback.test.ts` into `src/audio/leadMelody.test.ts`, adjusting the import to the local `./leadMelody`. `leadMelody.ts` already imports `clockStepToGridColumn`/`tickToColumn` from `@/audio/leadLiveRecord` and `TICKS_PER_SIXTEENTH` from `@/utils/stepResolution`, so nothing new is needed.

Three describes stay in the hook test: `leadStepAction`, `useLeadPlayback shares the one HARD_STOP_RELEASE`, and `useLeadPlayback feeds the loop gate and the sounding notes into the scheduler`.

- [ ] **Step 2: Run the tests and expect failure**

```bash
bun test src/audio/leadMelody.test.ts
```

- [ ] **Step 3: Implement the move**

Move `LeadScheduleHit`, `leadDispatchTicks` and `leadScheduleHits` (`src/components/loop/lead/useLeadPlayback.ts:43-113`) into `src/audio/leadMelody.ts`, docblocks included — those docblocks carry the two-branch rule ("arp OFF is COLUMN-driven, arp ON is CLOCK-driven") and are the reason the function is one function rather than two. Add whatever of `TICKS_PER_SIXTEENTH` / `clockStepToGridColumn` / `tickToColumn` / `strideFor` the moved code needs to `leadMelody.ts`'s existing import list.

`useLeadPlayback.ts` gains:

```ts
import { leadDispatchTicks, leadScheduleHits, leadSoundingNotes, resolveLeadStepTriggers } from '@/audio/leadMelody';
```

and drops `leadDispatchTicks`/`leadScheduleHits` from its own exports. `leadStepAction` and `arming` stay.

- [ ] **Step 4: Run the tests and expect them to pass**

```bash
bun test src/audio/leadMelody.test.ts src/components/loop/lead/useLeadPlayback.test.ts
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(audio): move the lead schedule helpers into leadMelody

leadDispatchTicks and leadScheduleHits are pure scheduling arithmetic — the
one place the grid's question and the arpeggiator's part company — and the
offline renderer schedules both. The hook keeps leadStepAction and the
engine calls.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### 5C — the six chord/bass rhythm helpers

- [ ] **Step 1: Move the failing tests**

Move these five describes out of `src/components/loop/chord/useChordPlayback.test.ts` into `src/audio/chordRhythms.test.ts`:

- `adaptRhythmPattern` (line 161)
- `adaptBassPattern` (line 191)
- `isFullHoldRhythm / isFullHoldBass measure the hold against the ACTIVE bar` (line 246)
- `playback pattern resolution honours the mode` (line 307)
- `custom patterns flow through the playback pipeline` (line 338)

Adjust their import to `./chordRhythms` (the file they land in). The `isFullHold...` describe must NOT reach for `activeStepsPerBar` — that helper reads the store and stays in the hook; every case in that describe already passes an explicit `stepsPerBar`, so it moves unchanged.

The describes that stay in `useChordPlayback.test.ts` are the arming, stop-timing, `activeStepsPerBar`, `HARD_STOP_RELEASE` and `playbackStopOwnedVoices` ones — every one of them is about the hook.

- [ ] **Step 2: Run the tests and expect failure**

```bash
bun test src/audio/chordRhythms.test.ts
```

- [ ] **Step 3: Implement the move**

Into `src/audio/chordRhythms.ts`, add:

- the two **private** resolvers `resolveRhythmPattern(id)` and `resolveBassPattern(id)` (from `useChordPlayback.ts:168`, `:172`) — private, because only the two `resolvePlayback*` functions call them, and they are not part of the moved contract;
- `resolvePlaybackRhythmPattern`, `resolvePlaybackBassPattern`, `adaptRhythmPattern`, `adaptBassPattern`, `isFullHoldRhythm`, `isFullHoldBass` (`:181`, `:193`, `:216`, `:222`, `:150`, `:159`), docblocks included.

They go **here**, not into `src/utils/patternAdapt.ts`. That file and `eventAdapt.ts` hold *step-row* adapters (`adaptStepRow`, `writeStepWindow`, `adaptStepEvents`); these adapt a *pattern object* to a meter, and this module already owns `customRhythmPattern` and the chord-rhythm catalogue. Do not fold them together on the strength of the shared word "adapt".

New imports for `chordRhythms.ts`:

```ts
import { CHORD_RHYTHMS, type RhythmHit, type RhythmPattern } from '@/data/chordRhythms';
import { BASS_PATTERNS, type BassPattern, type BassStepChoice } from '@/data/bassPatterns';
import { customBassPattern } from './bassPatterns';
import { adaptStepEvents } from '../utils/eventAdapt';
import { getMeter } from '../utils/meter';
```

`useChordPlayback.ts` imports the six from `@/audio/chordRhythms` and keeps `activeStepsPerBar`, `startChordPlan`, `emitChordPlanStep`, `armPad` and the React hook itself.

- [ ] **Step 4: Run the tests and expect them to pass**

```bash
bun test src/audio/chordRhythms.test.ts src/components/loop/chord/useChordPlayback.test.ts
bun run lint && bun run eslint
```

`eslint` is the check that matters here: it fails if `chordRhythms.ts` reached for anything under `store/` or `components/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(audio): move the chord/bass rhythm helpers into chordRhythms

Pattern resolution and meter adaptation are pure and the offline renderer
drives them per chord. They land beside customRhythmPattern, which already
owns the rhythm catalogue, rather than in utils/patternAdapt.ts — that file
holds step-row adapters, not pattern adapters.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### 5D — the pad arm decision

`armPad` (`useChordPlayback.ts:239`) reads six things off the store and then arms a drone. The pure helpers it needs already exist in `src/audio/playback/padPlayback.ts`; what is missing is the decision layer around them.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/playback/padPlayback.test.ts`, and move the two `shouldArmPad` tests in from `src/components/loop/chord/padArm.test.ts` (then delete that file — its subject stopped being a component concern):

```ts
import { resolvePadArm, type PadArmInput } from './padPlayback';

describe('resolvePadArm', () => {
  const base: PadArmInput = {
    mode: 'pad',
    isLoopStart: false,
    chord: { id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
    degree: 1,
    intervals: [1, 5, 8],
    padOctave: 4,
    voicing: 'triad',
    scaleRoot: 'C',
    scaleType: 'major',
    barDur: 2,
    loopBarCount: 8,
  };

  /** Narrowing helper: `expect(x).not.toBeNull()` does not narrow `x`. */
  function mustArm(input: PadArmInput): { notes: string[]; holdSec: number } {
    const arm = resolvePadArm(input);
    if (!arm) throw new Error('expected an arm');
    return arm;
  }

  test('pad mode arms on every chord, however the pass started', () => {
    const arm = mustArm({ ...base, isLoopStart: false });
    expect(arm.holdSec).toBe(2); // one bar
    expect(arm.notes.length).toBeGreaterThan(0);
    expect(mustArm({ ...base, isLoopStart: true }).holdSec).toBe(2);
  });

  test('drone mode arms only at the top of a loop pass, holding the whole loop', () => {
    expect(resolvePadArm({ ...base, mode: 'drone', isLoopStart: false })).toBeNull();
    // degree I in C major over [1, 5, 8] is root, fifth, octave...
    expect(mustArm({ ...base, mode: 'drone', isLoopStart: true })).toEqual({
      notes: ['C4', 'G4', 'C5'],
      // ...and it holds loopBarCount bars, not the chord's one.
      holdSec: 16,
    });
  });

  test('a zero-bar chord never produces a hold shorter than a bar', () => {
    const arm = mustArm({ ...base, chord: { ...base.chord, bars: 0 } });
    expect(arm.holdSec).toBe(2);
  });

  test('off mode never arms', () => {
    expect(resolvePadArm({ ...base, mode: 'off', isLoopStart: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/audio/playback/padPlayback.test.ts
```

- [ ] **Step 3: Implement `resolvePadArm`, and rename the shadowed parameter**

In `src/audio/playback/padPlayback.ts`, first rename `padHoldSec`'s third parameter, which is about to collide with the `loopBars` import:

```ts
/**
 * How long one arm holds. Pad mode is armed per chord and holds for that
 * chord; drone mode is armed once per loop pass and holds for the whole pass.
 *
 * Both floor at a single bar so a malformed chord (`bars: 0`) or an empty
 * progression can never schedule a note-off at or before its own note-on.
 *
 * The third parameter is `loopBarCount`, not `loopBars`: `loopBars` is now a
 * function imported from `@/utils/songStructure`, and a parameter wearing the
 * function's name reads as if the parameter were the function.
 */
export function padHoldSec(
  mode: PadMode,
  chordBars: number,
  loopBarCount: number,
  barDur: number,
): number {
  const bars = padHoldsAcrossLoop(mode) ? loopBarCount : chordBars;
  return Math.max(1, bars) * barDur;
}
```

Then add:

```ts
/**
 * The decision half of the hook's `armPad`, with its store reads turned into
 * parameters — the hook passes `get()`-derived values, the offline renderer
 * passes snapshot values, and this function knows nothing about either.
 *
 * Returns `null` when nothing should sound; otherwise the notes and the hold.
 * The TRIGGER stays out of here on purpose: `playFullHoldChord` touches the
 * engine, and a function that touches the engine cannot be called by a test
 * with no engine.
 *
 * The caller owns `loopBarCount` because only drone mode reads it, and
 * `loopBars` walks the whole progression — pad mode arms on EVERY chord and
 * must not pay for it.
 */
export interface PadArmInput {
  mode: PadMode;
  /** Whether this arm lands on the first chord of a loop pass. */
  isLoopStart: boolean;
  chord: ChordItem;
  degree: number;
  intervals: readonly PadInterval[];
  padOctave: number;
  voicing: PadVoicing;
  scaleRoot: string;
  scaleType: string;
  barDur: number;
  /** The loop's total bars. Read by drone mode only. */
  loopBarCount: number;
}

export function resolvePadArm(input: PadArmInput): { notes: string[]; holdSec: number } | null {
  if (!shouldArmPad(input.mode, input.isLoopStart)) return null;

  const notes =
    input.mode === 'drone'
      ? resolveDroneNotes(input.degree, input.intervals, input.padOctave, input.scaleRoot, input.scaleType)
      : applyPadVoicing(
          generateBlockChordNotes(input.chord.quality, input.chord.root, input.padOctave),
          input.voicing,
        );
  if (notes.length === 0) return null;

  return {
    notes,
    // No `|| 1` guard on chord.bars: padHoldSec already floors at one bar, so
    // a malformed `bars: 0` cannot schedule a note-off at its own note-on.
    holdSec: padHoldSec(input.mode, input.chord.bars, input.loopBarCount, input.barDur),
  };
}
```

Add to the file's imports: `import type { ChordItem, PadInterval, PadMode, PadVoicing } from '@/types';` (merge with the existing `@/types` import) and `generateBlockChordNotes` from `@/utils/musicTheory`.

If `ChordItem.bars` is optional in `@/types`, `padHoldSec(input.mode, input.chord.bars, ...)` will not type-check — pass `input.chord.bars ?? 1` in that case. Read the type before deciding; do not add a cast.

- [ ] **Step 4: Rewrite the hook's `armPad` against it**

In `src/components/loop/chord/useChordPlayback.ts`, replace the body of `armPad` (lines 239-275) — the six store reads, the two note branches and the `padHoldSec` call all move into `resolvePadArm`:

```ts
function armPad(chord: ChordItem, isLoopStart: boolean, time: number): void {
  const s = useAppStore.getState();
  const stepsPerBar = activeStepsPerBar();

  const arm = resolvePadArm({
    mode: s.padMode,
    isLoopStart,
    chord,
    degree: s.padDroneDegree,
    intervals: s.padDroneIntervals,
    padOctave: s.padOctave,
    voicing: s.padVoicing,
    scaleRoot: s.scaleRoot,
    scaleType: s.scaleType,
    barDur: barDurationSec(s.bpm, stepsPerBar),
    // Only a drone reads the loop's length, and loopBars walks the whole
    // progression — pad mode arms on EVERY chord and must not pay for it.
    loopBarCount: padHoldsAcrossLoop(s.padMode) ? loopBars(s.chords) : 0,
  });
  if (!arm) return;

  playFullHoldChord(arm.notes, s.padSynthParams, time, arm.holdSec, 'pad');
}
```

`armPad` stays unexported and stays in the hook: it reads the store and fires the engine. `shouldArmPad`, `resolveDroneNotes`, `applyPadVoicing`, `padHoldsAcrossLoop` and `padHoldSec` remain exported from `padPlayback.ts` — the live hook still needs `padHoldsAcrossLoop` and `playFullHoldChord`, and the renderer needs the rest.

- [ ] **Step 5: Run the tests and expect them to pass**

```bash
bun test src/audio/playback/padPlayback.test.ts src/components/loop/chord/useChordPlayback.test.ts
bun run lint && bun run eslint
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(audio): extract the pad arm decision into padPlayback

armPad's six store reads become parameters of a pure resolvePadArm, which
the hook and the offline renderer both call. padHoldSec's third parameter
is renamed loopBarCount so it does not wear the name of the loopBars
function that now sits beside it. The trigger stays in the hook, because a
function that touches the engine cannot be tested without one.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
---

## Task 6: The offline renderer

**Files:**
- Create: `src/audio/export/renderMixdown.ts`
- Create: `src/audio/export/mixdownFixture.ts`
- Create: `src/audio/export/renderMixdown.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts` (two functions gain a trailing `engine` parameter)

**Interfaces:**
- Consumes: `createRenderEngine`, `sequencerStepEvents`, `leadScheduleHits`/`leadSoundingNotes`/`resolveLeadStepTriggers`, `resolvePlaybackRhythmPattern`/`resolvePlaybackBassPattern`/`adaptRhythmPattern`/`adaptBassPattern`/`isFullHoldRhythm`/`isFullHoldBass`/`feelToHoldScale`/`fullHoldDuration`, `resolveBassSteps`, `buildChordEvents`/`eventsForStep`/`emitStepEvents`/`arpEventsForStep`/`playFullHoldChord`, `resolvePadArm`, `loopLengthSteps`/`loopDwellSteps`, `encodeWav`, `mulberry32`/`MIXDOWN_SEED`/`setRandomSource`.
- Note: `chordPlanPosition` is NOT consumed. It answers "where does this step fall inside the plan armed at `startStep`" for a live clock that advances monotonically; the renderer knows every chord's span up front and gets the same answer from `chordsByBar`, without a plan object it would have to build. `loopBars` is not consumed either — the pass's bars are `passSteps / stepsPerBar`, which is already the floored length the walk uses.
- Produces: `MixdownSnapshot` and its sub-types, `MixdownRenderResult`, `MixdownFailureReason`, `planArrangement`, `buildLoopVoices`, `renderMixdown`, and the constants `MIXDOWN_SAMPLE_RATE`, `MIXDOWN_CHANNELS`, `MIXDOWN_TAIL_SEC`.

**Two design decisions this task carries**, both stated in the module docblock:

1. **The mixer is applied once, not per loop.** `setDrumTrackGain` and `setDrumFilter` read `this.ctx.currentTime`, which is `0` in an offline render, so they cannot be time-scheduled — they settle the graph before the first event. Consequence: a song whose loops differ in mixer settings renders with the active loop's mixer. Recorded as a Known limitation with its follow-up (moving per-track drum gain onto the audio clock).
2. **`emitStepEvents` and `playFullHoldChord` gain a trailing `engine: AudioEngine = audioEngine` parameter** rather than being re-implemented here. The clamp that floors a chord gate at 10 ms (and the comment explaining why a strum's last note can start past `chordEnd`) is one rule with one home; a second copy in the renderer would be the copy no live test exercises.

- [ ] **Step 1: Write the failing tests and the fixture**

Create `src/audio/export/mixdownFixture.ts`:

```ts
/**
 * Builders for a minimal renderable song, shared by the renderer's own tests
 * and the store slice's.
 *
 * One bar, one chord, one loop, one kick: every assertion the renderer makes
 * (a non-silent buffer, an exact sample count, byte-identical repeat renders)
 * is easier to read against the smallest arrangement that produces sound than
 * against a five-loop fixture whose silent bar could be hiding the bug.
 */
import { DEFAULT_DRUM_KIT } from '@/data/drumKits';
import { DRUM_TYPES } from '@/types';
import type { MixdownLoop, MixdownSnapshot } from './renderMixdown';

/** The kick row of a one-bar 4/4 grid: steps 0 and 8. */
const KICK_STEPS = Array.from({ length: 16 }, (_, i) => i === 0 || i === 8);

export function mixdownLoop(over: Partial<MixdownLoop> = {}): MixdownLoop {
  return {
    id: 'loop-1',
    repeatCount: 1,
    scaleRoot: 'C',
    scaleType: 'major',
    chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] }],
    chordSynthParams: synthFixture(),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    chordFeel: 0.5,
    chordOctave: 4,
    bassSynthParams: synthFixture(),
    bassPatternId: 'whole-note-root',
    bassPatternMode: 'preset',
    customBassPattern: [],
    bassFeel: 0.5,
    bassOctave: 2,
    padSynthParams: synthFixture(),
    padMode: 'off',
    padOctave: 4,
    padVoicing: 'triad',
    padDroneDegree: 1,
    padDroneIntervals: [1, 5, 8],
    sequencerTracks: [
      {
        instrument: 'kick',
        steps: KICK_STEPS,
        volume: 0,
        muted: false,
      },
    ],
    synthParams: synthFixture(),
    fxSynthParams: synthFixture(),
    leadMelodySteps: [],
    leadLoopLength: 1,
    leadStepResolution: '16n',
    leadGate: 0.85,
    fxMelodySteps: [],
    fxLoopLength: 1,
    fxStepResolution: '16n',
    fxGate: 0.85,
    ...over,
  };
}

export function mixdownSnapshot(over: Partial<MixdownSnapshot> = {}): MixdownSnapshot {
  return {
    bpm: 120,
    meterId: '4/4',
    stepsPerBar: 16,
    masterVolume: 1,
    effects: FACTORY_EFFECTS,
    buses: SOURCE_BUSES.map((b) => ({ source: b.source, gain: 1, muted: false })),
    drumTracks: DRUM_TYPES.map((instrument) => ({ instrument, gain: 1 })),
    drumKit: DEFAULT_DRUM_KIT,
    drumKitName: 'default',
    drumFilter: { cutoff: 20000, resonance: 0.7, type: 'lowpass' },
    sequencerParams: synthFixture(),
    loops: [mixdownLoop()],
    ...over,
  };
}

/** The store's factory `effects`, copied here so the audio layer stays store-free. */
export const FACTORY_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 1.5,
  delayWet: 0.2,
  delayFeedback: 0.3,
  distortionWet: 0,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compressorEnabled: false,
  limiterEnabled: true,
};

/** The store's `INITIAL_SYNTH_PARAMS`, mirrored — see testFakes' synthParamsFixture. */
function synthFixture(): SynthParams {
  return synthParamsFixture();
}
```

The file's imports are `import { synthParamsFixture } from '../testFakes';`, `import type { MasterEffects, SynthParams } from '@/types';` and the bus roster, which is declared locally rather than imported:

```ts
/**
 * The six source buses, spelled out.
 *
 * `SOURCE_BUSES` (src/store/sourceBuses.ts) is the real roster, and the SLICE
 * iterates it — this module may not import it, because the eslint block
 * covering src/audio/** has no allowTypeImports exemption and this is a runtime
 * value. So the fixture states its own list, and `mixdownSlice.test.ts` asserts
 * the slice's output names exactly the SOURCE_BUSES roster. Keep the two in
 * step by hand; the test is what fails when they drift.
 */
const BUSES = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;
```

and the snapshot's line is `buses: BUSES.map((source) => ({ source, gain: 1, muted: false }))` — replace the `SOURCE_BUSES.map(...)` line in the block above with it.

`mixdownFixture.ts` is NOT a test file, so it is scanned by `bun run eslint` and `check:theme` like any other module — no `any`, no colour literals. `synthParamsFixture` lives in `src/audio/testFakes.ts`, which starts with a file-level `no-explicit-any` disable; importing from it is fine.

Now create `src/audio/export/renderMixdown.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { buildLoopVoices, MIXDOWN_SAMPLE_RATE, planArrangement, renderMixdown } from './renderMixdown';
import { mixdownLoop, mixdownSnapshot } from './mixdownFixture';

// The capability probe reads `globalThis.OfflineAudioContext`, so the TEST
// provides it — the same way a browser does. There is no injection seam in
// the production code for this, deliberately: a device with no offline
// context is a degraded state the probe reports, and a seam only tests use
// would be a second path through the one branch that matters.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('planArrangement', () => {
  test('one loop, one bar, one repeat is stepsPerBar steps', () => {
    const plan = planArrangement(mixdownSnapshot());
    expect(plan.totalSteps).toBe(16);
    expect(plan.passes).toEqual([
      { loopIndex: 0, startStep: 0, passSteps: 16, dwellSteps: 16 },
    ]);
  });

  test('repeats multiply the dwell, not the pass', () => {
    const plan = planArrangement(
      mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 3 })] }),
    );
    expect(plan.passes[0]).toEqual({
      loopIndex: 0,
      startStep: 0,
      passSteps: 16,
      dwellSteps: 48,
    });
    expect(plan.totalSteps).toBe(48);
  });

  test('a chordless loop still dwells a whole bar', () => {
    // The spec's edge case: loopDwellSteps floors a loop with no chords at
    // stepsPerBar, matching live playback. A silent BAR in the file, never a
    // skipped loop.
    const plan = planArrangement(
      mixdownSnapshot({ loops: [mixdownLoop({ chords: [] })] }),
    );
    expect(plan.passes[0]).toEqual({
      loopIndex: 0,
      startStep: 0,
      passSteps: 16,
      dwellSteps: 16,
    });
  });

  test('a second loop starts where the first stopped', () => {
    const plan = planArrangement(
      mixdownSnapshot({
        loops: [
          mixdownLoop({ id: 'a', repeatCount: 2 }),
          mixdownLoop({ id: 'b', chords: [{ id: 'c2', root: 'F', quality: 'maj', bars: 2, notes: ['F4', 'A4', 'C5'] }] }),
        ],
      }),
    );
    expect(plan.passes[1]).toEqual({
      loopIndex: 1,
      startStep: 32,
      passSteps: 32,
      dwellSteps: 32,
    });
    expect(plan.totalSteps).toBe(64);
  });

  test('repeatCount 0 and absent both floor at one pass', () => {
    const zero = planArrangement(mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 0 })] }));
    const absent = planArrangement(mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: undefined })] }));
    expect(zero.totalSteps).toBe(16);
    expect(absent.totalSteps).toBe(16);
  });
});

describe('buildLoopVoices', () => {
  test('maps every bar of a pass to the chord that covers it', () => {
    const loop = mixdownLoop({
      chords: [
        { id: 'a', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] },
        { id: 'b', root: 'F', quality: 'maj', bars: 3, notes: ['F4'] },
      ],
    });
    const voices = buildLoopVoices(loop, '4/4', 'major', 120, 16);
    expect(voices.chordsByBar).toEqual([0, 1, 1, 1]);
    expect(voices.chordStartStep).toEqual([0, 16]);
  });

  test('a full-hold rhythm produces no per-step events, only a hold', () => {
    // 'sustained' is the full-hold chord rhythm, 'whole-note-root' the
    // full-hold bass — both short-written in the fixture above.
    const voices = buildLoopVoices(mixdownLoop(), '4/4', 'major', 120, 16);
    expect(voices.chordArp).toBe(false);
    expect(voices.chordEvents[0]).toEqual([]);
    expect(voices.chordHold).toEqual(['C4', 'E4', 'G4']);
    expect(voices.bassHold).not.toBeNull();
  });

  test('a one-hit rhythm produces per-step events and no hold', () => {
    const voices = buildLoopVoices(
      mixdownLoop({ chordRhythmId: 'offbeat', chordOctave: 4, bassPatternId: 'root-8ths' }),
      '4/4',
      'major',
      120,
      16,
    );
    expect(voices.chordHold).toBeNull();
    expect(voices.chordEvents[0].length).toBeGreaterThan(0);
    expect(voices.bassHold).toBeNull();
  });
});

describe('renderMixdown', () => {
  test('renders a non-silent stereo buffer of the exact expected length', async () => {
    const snapshot = mixdownSnapshot();
    const result = await renderMixdown(snapshot);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);

    // 16 steps at 120 bpm = 16 * (60/120/4) = 2.0 s, plus the tail.
    // reverbDecay is 1.5, so the tail is max(2, 2.5) = 2.5 s.
    expect(result.buffer.numberOfChannels).toBe(2);
    expect(result.buffer.length).toBe(Math.round(4.5 * MIXDOWN_SAMPLE_RATE));
    expect(result.buffer.sampleRate).toBe(MIXDOWN_SAMPLE_RATE);

    const left = result.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < left.length; i += 1) peak = Math.max(peak, Math.abs(left[i]));
    expect(peak).toBeGreaterThan(0);
  });

  test('the blob is a WAV of the same length', async () => {
    const result = await renderMixdown(mixdownSnapshot());
    if (!result.ok) throw new Error('expected ok');
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBe(44 + Math.round(4.5 * MIXDOWN_SAMPLE_RATE) * 2 * 2);
  });

  test('an empty arrangement fails rather than writing a silent file', async () => {
    const result = await renderMixdown(mixdownSnapshot({ loops: [] }));
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('two renders of one snapshot are byte-identical', async () => {
    const snapshot = mixdownSnapshot();
    const a = await renderMixdown(snapshot);
    const b = await renderMixdown(snapshot);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(Array.from(new Uint8Array(await a.blob.arrayBuffer()))).toEqual(
      Array.from(new Uint8Array(await b.blob.arrayBuffer())),
    );
  });

  test('restores the random source on the way out', async () => {
    // setRandomSource is installed for the render and cleared in a finally.
    // A leaked seeded source would make every later Math.random in the
    // session reproducible from MIXDOWN_SEED.
    const before = Math.random;
    await renderMixdown(mixdownSnapshot());
    expect(Math.random).toBe(before);
  });
});
```

Two fixture literals above depend on the chord-rhythm and bass-pattern libraries; if `'offbeat'` or `'root-8ths'` are not real ids the test still passes (the resolvers fall back to `CHORD_RHYTHMS[0]` / `BASS_PATTERNS[0]`), but the assertion `chordHold` is `null` would then be testing the fallback. **Read `src/data/chordRhythms.ts` and `src/data/bassPatterns.ts` and use two ids that are genuinely one-hit and genuinely non-full-hold before running the test.**

- [ ] **Step 2: Run the tests and expect failure**

```bash
bun test src/audio/export/renderMixdown.test.ts
```

Expect `Cannot find module './renderMixdown'`.

- [ ] **Step 3: Widen the two playback functions with an engine parameter**

In `src/audio/playback/chordPlayback.ts`, add the parameter to `emitStepEvents` and `playFullHoldChord`:

```ts
export function emitStepEvents(
  events: StepEvent[],
  params: SynthParams,
  source: string,
  time: number,
  chordEnd: number,
  /**
   * The engine to play on. Defaults to the singleton, so every live call site
   * is unchanged; the offline renderer passes its own render engine. The
   * parameter exists rather than a copy of this function existing in the
   * renderer, because the clamp below is one rule — a strum's later notes can
   * start past `chordEnd` at high bpm — and a second copy would be the copy
   * no live test exercises.
   */
  engine: AudioEngine = audioEngine,
): void {
```

then replace the two `audioEngine.` calls inside its body with `engine.`. Same for `playFullHoldChord`, with `engine: AudioEngine = audioEngine` last, and its two `audioEngine.` calls become `engine.`.

Add `import { audioEngine, STEPS_PER_BAR } from "../engine";` — the file already has this line; extend it to `import { audioEngine, STEPS_PER_BAR, type AudioEngine } from "../engine";`.

```bash
bun test src/audio/playback/chordPlayback.test.ts src/components/loop/chord/useChordPlayback.test.ts
bun run lint
```

Expect both green with no call site touched.

- [ ] **Step 4: Implement the snapshot types and `planArrangement`**

Create `src/audio/export/renderMixdown.ts`:

```ts
/**
 * The offline mixdown renderer.
 *
 * Binds a throwaway engine to an `OfflineAudioContext`, applies the snapshot
 * through the engine's own public setters, walks the arrangement driving the
 * SAME pure step functions the live clock drives, and hands back an encoded
 * WAV. The realtime singleton, the shared clock and the transport are not
 * involved and are not disturbed: an export is a side effect on a file, not
 * on the session.
 *
 * Imports only src/data/, src/utils/ and src/audio/ — no store, no component,
 * not even a type: the eslint block covering src/audio/** has no
 * allowTypeImports exemption. Everything the render reads arrives in the
 * snapshot, which is why `MixdownLoop` below is a structural type naming the
 * fields this module reads rather than an import of the store's `ProjectLoop`
 * (a `ProjectLoop` is structurally assignable to it, so the slice's
 * `const loops: MixdownLoop[] = content.loops` type-checks and tsc proves
 * every field is present).
 *
 * Two consequences of the offline clock, both deliberate:
 *
 *  - `setDrumTrackGain` and `setDrumFilter` read `ctx.currentTime`, which is
 *    0 offline, so they cannot be time-scheduled. The whole mixer is applied
 *    ONCE, before the first event. A song whose loops differ in mixer
 *    settings therefore renders with the active loop's mixer.
 *  - `updateSynthParams` is not called at all: it only reshapes voices that
 *    are already live, and there are none before the first note. Each voice
 *    gets its params at trigger time, which is where they come from anyway.
 */
import { createRenderEngine, type AudioEngine } from '../engine';
import { sequencerStepEvents } from '../sequencerSteps';
import {
  leadScheduleHits,
  leadSoundingNotes,
  resolveLeadStepTriggers,
  type LeadNote,
  type LeadTrigger,
} from '../leadMelody';
import { resolveBassSteps } from '../bassPatterns';
import { buildChordEvents, emitStepEvents, eventsForStep, arpEventsForStep, playFullHoldChord, type BarInvariantEvent } from '../playback/chordPlayback';
import { resolvePadArm } from '../playback/padPlayback';
import {
  adaptBassPattern,
  adaptRhythmPattern,
  feelToHoldScale,
  fullHoldDuration,
  isFullHoldBass,
  isFullHoldRhythm,
  resolvePlaybackBassPattern,
  resolvePlaybackRhythmPattern,
} from '../chordRhythms';
import { mulberry32, MIXDOWN_SEED, setRandomSource } from '../rng';
import { loopDwellSteps, loopLengthSteps } from '../../utils/songStructure';
import { barDurationSec, generateBlockChordNotes, stepDurationSec } from '../../utils/musicTheory';
import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor, type LeadStepResolutionId } from '../../utils/stepResolution';
import { arpStepFor, type MeterId } from '../../utils/meter';
import { encodeWav } from '../../utils/encodeWav';
import type {
  BassStepChoice,
  ChordItem,
  DrumKit,
  FilterType,
  MasterEffects,
  PadInterval,
  PadMode,
  PadVoicing,
  SequencerTrack,
  SynthParams,
} from '../../types';

export const MIXDOWN_SAMPLE_RATE = 44100;
export const MIXDOWN_CHANNELS = 2;
/** The floor on the tail: release + reverb. Never shorter than this. */
export const MIXDOWN_TAIL_SEC = 2;

/** One source bus, its gain already converted from the store's dB to linear. */
export interface MixdownBusState {
  source: string;
  gain: number;
  muted: boolean;
}

/** One drum track's fader, already converted from dB to linear. */
export interface MixdownDrumTrack {
  instrument: string;
  gain: number;
}

/**
 * One melody track's render material: the four per-track columns the renderer
 * reads, plus the engine source its voices belong on (`'synth'` for Lead,
 * `'fx'` for FX) and the patch it plays. Built by `mixdownLeadTrack` /
 * `mixdownFxTrack` below, because the store spells the Lead row irregularly
 * (`synthParams`, not `leadSynthParams`) and that irregularity is exactly what
 * `MELODY_TRACKS` exists to encode — a table this module may not import.
 */
export interface MixdownMelodyTrack {
  steps: LeadNote[][];
  /** Bars. The melody loop's own length, not the chord loop's. */
  loopLength: number;
  stepResolution: LeadStepResolutionId;
  gate: number;
  params: SynthParams;
  source: string;
}

function mixdownLeadTrack(loop: MixdownLoop): MixdownMelodyTrack {
  return {
    steps: loop.leadMelodySteps,
    loopLength: loop.leadLoopLength,
    stepResolution: loop.leadStepResolution,
    gate: loop.leadGate,
    params: loop.synthParams,
    source: 'synth',
  };
}

function mixdownFxTrack(loop: MixdownLoop): MixdownMelodyTrack {
  return {
    steps: loop.fxMelodySteps,
    loopLength: loop.fxLoopLength,
    stepResolution: loop.fxStepResolution,
    gate: loop.fxGate,
    params: loop.fxSynthParams,
    source: 'fx',
  };
}

/**
 * One loop of the arrangement, structurally: the per-loop columns this module
 * reads, named exactly as `ProjectLoop` names them (`src/store/projectFormat.ts`).
 *
 * Deliberately the flat store names rather than a nested, renderer-shaped
 * restatement. A `ProjectLoop` is then assignable to a `MixdownLoop` with no
 * mapping function at all, so the slice's `const loops: MixdownLoop[] =
 * content.loops;` type-checks and `tsc` proves every field the render reads is
 * present in the content set. A nested shape would need a hand-written mapper,
 * and a mapper is a place a field can be silently dropped.
 */
export interface MixdownLoop {
  id: string;
  repeatCount?: number;
  scaleRoot: string;
  scaleType: string;
  chords: ChordItem[];
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  padSynthParams: SynthParams;
  fxSynthParams: SynthParams;
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
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  sequencerTracks: SequencerTrack[];
  leadMelodySteps: LeadNote[][];
  leadLoopLength: number;
  leadStepResolution: LeadStepResolutionId;
  leadGate: number;
  fxMelodySteps: LeadNote[][];
  fxLoopLength: number;
  fxStepResolution: LeadStepResolutionId;
  fxGate: number;
}

export interface MixdownSnapshot {
  bpm: number;
  meterId: MeterId;
  /** Resolved from `meterId` before it crosses the seam, so the renderer never parses a meter string. */
  stepsPerBar: number;
  /** Linear gain. */
  masterVolume: number;
  effects: MasterEffects;
  buses: MixdownBusState[];
  drumTracks: MixdownDrumTrack[];
  drumKit: Partial<DrumKit>;
  drumKitName: string | undefined;
  drumFilter: { cutoff: number; resonance: number; type: FilterType };
  /** The flat `synthParams` — what a sequencer note voice uses (the DEV-386 note). */
  sequencerParams: SynthParams;
  loops: MixdownLoop[];
}

/**
 * Why a render produced no file. A union rather than a string so the slice's
 * `projectNotice` sentence is a switch the compiler checks, and so a test can
 * assert the reason without matching prose.
 */
export type MixdownFailureReason =
  | { kind: 'empty-arrangement' }
  | { kind: 'unsupported-context' }
  | { kind: 'render-failed'; detail: string };

/**
 * The buffer is returned BESIDE the blob, not instead of it: the spec's own
 * assertions (channel count, exact length, non-silence) are only writable
 * against samples, and the encode has to sit inside the same `try` that turns
 * a throw into a failed result.
 */
export type MixdownRenderResult =
  | { ok: true; buffer: AudioBuffer; blob: Blob }
  | { ok: false; reason: MixdownFailureReason };

/** One loop's dwell in the arrangement, as a range of absolute steps. */
export interface ArrangementPass {
  loopIndex: number;
  startStep: number;
  /** One pass: the loop's own length, floored at a bar for a chordless loop. */
  passSteps: number;
  /** The whole loop: `passSteps × repeats`. */
  dwellSteps: number;
}

export interface ArrangementPlan {
  totalSteps: number;
  passes: ArrangementPass[];
}

/**
 * Every pass of every loop, in order, as absolute step ranges.
 *
 * `loopDwellSteps` is the loop's TOTAL dwell (`passSteps × repeats`) — it is
 * `songAdvanceDecision`'s own `totalSteps`, deliberately, so the walk the
 * renderer performs and the decision the live transport makes are the same
 * arithmetic. The walk therefore iterates `dwellSteps` ONCE and derives a
 * pass-relative index as `i % passSteps`; iterating `repeats × dwell` would
 * schedule `repeats²` passes, and the repeats past the first would render
 * silent because `chordPlanPosition`'s equivalent — the `chordsByBar` lookup
 * below — would run out of bars.
 */
export function planArrangement(snapshot: MixdownSnapshot): ArrangementPlan {
  const passes: ArrangementPass[] = [];
  let step = 0;
  for (let loopIndex = 0; loopIndex < snapshot.loops.length; loopIndex += 1) {
    const loop = snapshot.loops[loopIndex];
    const repeats = Math.max(1, loop.repeatCount ?? 1);
    const passSteps = Math.max(
      loopLengthSteps(loop.chords, snapshot.stepsPerBar),
      snapshot.stepsPerBar,
    );
    const dwellSteps = loopDwellSteps(loop, snapshot.stepsPerBar);
    passes.push({ loopIndex, startStep: step, passSteps, dwellSteps });
    step += dwellSteps;
  }
  return { totalSteps: step, passes };
}
```

- [ ] **Step 5: Run the plan tests and expect them to pass**

```bash
bun test src/audio/export/renderMixdown.test.ts -t planArrangement
```

- [ ] **Step 6: Implement `buildLoopVoices`**

Append to `src/audio/export/renderMixdown.ts`:

```ts
/**
 * Everything one loop needs to sound, resolved ONCE for the whole render
 * rather than per pass: the chord patterns, the bass patterns, the arp flag,
 * the whole-chord holds and the bar→chord map. A loop is played `repeatCount`
 * times and every repeat is identical, so resolving twice would be work the
 * render pays for and nothing reads.
 */
export interface LoopVoices {
  /** Chord index per bar of ONE pass; length = the pass's bars. */
  chordsByBar: number[];
  /** Per chord: its first step within a pass. */
  chordStartStep: number[];
  /** Per chord: its bars, floored at 1. */
  chordBars: number[];
  /** Per chord: its block notes at `chordOctave`. */
  chordNotes: string[][];
  /** Per chord: its rhythm events, empty when arpeggiated or a full hold. */
  chordEvents: BarInvariantEvent[][];
  /** Per chord: its bass events, empty when arpeggiated or a full hold. */
  bassEvents: BarInvariantEvent[][];
  chordArp: boolean;
  bassArp: boolean;
  /** The notes to strike as one held chord, or null when the rhythm is not a full hold. */
  chordHold: { notes: string[]; holdSec: number } | null;
  bassHold: { noteName: string; velocity: number; holdSec: number } | null;
  chordHoldScale: number;
  bassHoldScale: number;
  /** Resolved pad material, or null when the pad is off. */
  pad: { notes: string[]; holdSec: number } | null;
}

export function buildLoopVoices(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): LoopVoices {
  const stepDur = stepDurationSec(bpm);
  const barDur = barDurationSec(bpm, stepsPerBar);
  const chordOctave = loop.chordOctave;
  const passBars = Math.max(
    loop.chords.reduce((sum, c) => sum + (c.bars || 1), 0),
    1,
  );

  const chordsByBar: number[] = [];
  const chordStartStep: number[] = [];
  const chordBars: number[] = [];
  const chordNotes: string[][] = [];
  const chordEvents: BarInvariantEvent[][] = [];
  const bassEvents: BarInvariantEvent[][] = [];

  const chordArp = !!loop.chordSynthParams.arpActive;
  const bassArp = !!loop.bassSynthParams.arpActive;
  const chordHoldScale = feelToHoldScale(loop.chordFeel);
  const bassHoldScale = feelToHoldScale(loop.bassFeel);

  // One resolution for the whole loop. A custom grid is synthesized at the
  // ACTIVE meter and is stamped with it, so adaptRhythmPattern returns it
  // unchanged — the same two-step the live hook performs, in the same order.
  const rhythmPattern = adaptRhythmPattern(
    resolvePlaybackRhythmPattern(
      loop.chordRhythmMode,
      loop.chordRhythmId,
      loop.customChordRhythm,
      stepsPerBar,
      meterId,
    ),
    stepsPerBar,
  );
  const bassPattern = adaptBassPattern(
    resolvePlaybackBassPattern(
      loop.bassPatternMode,
      loop.bassPatternId,
      loop.customBassPattern,
      stepsPerBar,
      meterId,
    ),
    stepsPerBar,
  );
  const chordFullHold = !chordArp && isFullHoldRhythm(rhythmPattern, stepsPerBar);
  const bassFullHold = !bassArp && isFullHoldBass(bassPattern, stepsPerBar);

  let barCursor = 0;
  for (let i = 0; i < loop.chords.length; i += 1) {
    const chord = loop.chords[i];
    const bars = Math.max(1, chord.bars || 1);
    const notes = generateBlockChordNotes(chord.quality, chord.root, chordOctave);

    chordStartStep.push(barCursor * stepsPerBar);
    chordBars.push(bars);
    chordNotes.push(notes);
    for (let b = 0; b < bars; b += 1) chordsByBar.push(i);
    barCursor += bars;

    chordEvents.push(
      chordFullHold || chordArp
        ? []
        : buildChordEvents(rhythmPattern, notes, stepDur, chordHoldScale),
    );

    if (bassFullHold || bassArp) {
      bassEvents.push([]);
      continue;
    }
    // The chord INDEX matters, not the chord object: resolveBassSteps walks
    // `chords[(i + 1) % length]` for its approach tones, which is what makes
    // the last chord lead back into the first at the loop seam.
    bassEvents.push(
      resolveBassSteps(
        bassPattern,
        loop.chords,
        i,
        loop.bassOctave,
        loop.scaleRoot,
        loop.scaleType,
        bpm,
        bassHoldScale,
      ).map((ev) => ({
        step: ev.step,
        noteName: ev.noteName,
        velocity: ev.velocity,
        timeOffset: 0,
        hold: ev.holdSec,
        // Approach tones lead into the NEXT chord, so they belong on the last bar.
        lastBarOnly: ev.token.startsWith('approach'),
      })),
    );
  }
  // A chordless loop dwells a bar and plays no chord. The map needs that bar.
  if (chordsByBar.length === 0) {
    for (let b = 0; b < passBars; b += 1) chordsByBar.push(0);
  }

  const firstChord = loop.chords[0];
  const chordHoldSec = firstChord
    ? fullHoldDuration(chordBars[0], barDur, chordHoldScale)
    : 0;
  const bassHoldSec = firstChord
    ? fullHoldDuration(chordBars[0], barDur, bassHoldScale)
    : 0;
  const firstBass = bassEvents.length > 0 ? null : resolveBassSteps(
    bassPattern,
    loop.chords,
    0,
    loop.bassOctave,
    loop.scaleRoot,
    loop.scaleType,
    bpm,
    1,
  )[0];

  return {
    chordsByBar,
    chordStartStep,
    chordBars,
    chordNotes,
    chordEvents,
    bassEvents,
    chordArp,
    bassArp,
    chordHold:
      chordFullHold && firstChord
        ? { notes: chordNotes[0], holdSec: chordHoldSec }
        : null,
    bassHold:
      bassFullHold && firstBass
        ? { noteName: firstBass.noteName, velocity: firstBass.velocity, holdSec: bassHoldSec }
        : null,
    chordHoldScale,
    bassHoldScale,
    pad: resolvePadArm({
      mode: loop.padMode,
      // The pass-relative flag is supplied by the caller per pass; build a
      // loop that can arm on ANY chord by asking for the loop-start form and
      // letting the caller choose which chord it fires on.
      isLoopStart: true,
      chord: firstChord,
      ...
    }),
  };
}
```

**The `LoopVoices` interface and the loop body ABOVE are wrong in two ways, and the corrected versions follow. Do not paste the block above.**

1. **`chordHoldSec` is per chord, not per loop.** A full-hold rhythm holds each chord for that chord's own bars, so a loop whose chords are 1 and 3 bars long holds 1 bar then 3 bars. Return `chordHoldSec: number[]` and `bassHoldSec: number[]`, one entry per chord, each `fullHoldDuration(chordBars[i], barDur, holdScale)`.
2. **`pad` cannot be resolved in `buildLoopVoices`.** `resolvePadArm` takes a chord and an `isLoopStart` flag, and pad mode arms on *every* chord — so it is a per-chord decision made at the per-chord step inside the walk, not a per-loop one. **Drop the `pad` field from `LoopVoices` entirely** and call `resolvePadArm` at the chord's first step in Step 7, with `isLoopStart` true only when that chord is the chord at the top of a pass.

Also drop the `firstBass` gymnastics: with `bassFullHold` the per-chord bass events are `[]`, so compute the full-hold bass the same way the live hook does — `resolveBassSteps(bassPattern, loop.chords, i, ...)` with `holdScale` 1, take `[0]` — inside the same per-chord loop, and store `bassHoldNotes: ({ noteName: string; velocity: number } | null)[]` alongside.

The corrected shape, which is what to write:

```ts
export interface LoopVoices {
  chordsByBar: number[];
  chordStartStep: number[];
  chordBars: number[];
  chordNotes: string[][];
  chordEvents: BarInvariantEvent[][];
  bassEvents: BarInvariantEvent[][];
  chordArp: boolean;
  bassArp: boolean;
  /** Per chord: the hold length for a full-hold rhythm, else 0. */
  chordHoldSec: number[];
  /** Per chord: the bass root for a full-hold bass pattern, else null. */
  bassHoldNotes: ({ noteName: string; velocity: number } | null)[];
  /** Per chord: the hold length for a full-hold bass, else 0. */
  bassHoldSec: number[];
  chordHoldScale: number;
  bassHoldScale: number;
}
```

and inside the per-chord loop, after the `chordEvents.push`:

```ts
    chordHoldSec.push(chordFullHold ? fullHoldDuration(bars, barDur, chordHoldScale) : 0);
    const bassRoot = bassFullHold
      // holdScale 1: the live hook resolves the full-hold bass at full length
      // and applies the feel only through fullHoldDuration, so the note-off
      // and the hold it is paired with are measured the same way.
      ? resolveBassSteps(bassPattern, loop.chords, i, loop.bassOctave, loop.scaleRoot, loop.scaleType, bpm, 1)[0]
      : undefined;
    bassHoldNotes.push(bassRoot ? { noteName: bassRoot.noteName, velocity: bassRoot.velocity } : null);
    bassHoldSec.push(bassFullHold ? fullHoldDuration(bars, barDur, bassHoldScale) : 0);
```

The `chordsByBar.length === 0` fallback for a chordless loop then becomes: `chordsByBar` stays empty and `chordStartStep`/`chordBars` stay empty, which is fine — the walk's `chordsByBar[barInPass]` would read `undefined`. **Give the chordless loop one synthetic bar** instead:

```ts
  if (loop.chords.length === 0) {
    // A chordless loop dwells a bar and plays nothing. Give the map that bar
    // pointing at chord 0 so the walk's lookup is total — nothing plays
    // because chordNotes[0] is undefined and every per-chord array is empty,
    // which is exactly the "silent bar, not a skipped loop" the spec asks for.
    chordsByBar.push(0);
  }
```

and guard the per-step bodies with `if (chordIndex === undefined) continue;`-style checks by reading `loop.chords.length === 0` once at the top of the pass walk and skipping the chord/bass/pad work entirely. State that guard explicitly in the walk.

- [ ] **Step 7: Implement the master state, the schedule walk and `renderMixdown`**

```ts
/**
 * Settles the graph from the snapshot, in the order `applySliceState`
 * (src/store/engineSync.ts) uses, so an export is configured by the same
 * call sequence a live session uses rather than a parallel one.
 *
 * `time` 0 on the two bus setters: an offline render has no "now" to
 * automate against, and passing 0 makes the bus state settled before the
 * first event instead of ramping into it.
 */
function applyMasterState(engine: AudioEngine, snapshot: MixdownSnapshot): void {
  engine.setClockBpm(snapshot.bpm);
  engine.setMeter(snapshot.meterId);
  engine.setMasterVolume(snapshot.masterVolume);
  for (const bus of snapshot.buses) {
    engine.setSourceGain(bus.source, bus.gain, 0);
    engine.setSourceMuted(bus.source, bus.muted, 0);
  }
  engine.setDrumKit(snapshot.drumKit, snapshot.drumKitName);
  for (const track of snapshot.drumTracks) {
    engine.setDrumTrackGain(track.instrument, track.gain);
  }
  engine.setDrumFilter(snapshot.drumFilter.cutoff, snapshot.drumFilter.resonance, snapshot.drumFilter.type);
  engine.updateEffects(snapshot.effects);
  engine.setReverbDecay(snapshot.effects.reverbDecay);
}
```

Then the melody track scheduler, mirroring `useLeadPlayback`'s clock callback with explicit times:

```ts
/**
 * One melody track's material at one absolute step, at an explicit time.
 *
 * A transcription of the live hook's clock callback with `time` supplied
 * instead of read from the scheduler, and with the store reads replaced by
 * the snapshot. The three-way split it keeps — `leadScheduleHits` decides
 * which columns fire, `leadSoundingNotes` decides what is held, and
 * `resolveLeadStepTriggers` decides what sounds and for how long — is the
 * whole point: this function contains no scheduling decision of its own.
 */
function scheduleMelodyStep(
  engine: AudioEngine,
  track: MixdownMelodyTrack,
  step: number,
  stepsPerBar: number,
  tickDur: number,
  time: number,
): void {
  const stride = strideFor(track.stepResolution);
  const columns = track.loopLength * columnsPerBar(stepsPerBar, stride);
  const melodyTicks = track.loopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
  const arpStep = arpStepFor(step, stepsPerBar);
  const hits = leadScheduleHits(step, stride, columns, track.params.arpActive, tickDur);

  for (const hit of hits) {
    const at = time + hit.offsetSec;
    const sounding = leadSoundingNotes(track.steps, hit.column, stepsPerBar, stride);
    const triggers: LeadTrigger[] = resolveLeadStepTriggers(
      sounding,
      track.params.arpActive,
      arpStep,
      track.params,
      tickDur,
      track.gate,
      stride,
      { tickInLoop: hit.column * stride, melodyTicks },
    );
    for (const trigger of triggers) {
      const start = at + trigger.timeOffsetSec;
      engine.triggerSynthNoteOn(trigger.note, track.params, DEFAULT_VELOCITY, start, track.source, 1, 'sequencer');
      engine.triggerSynthNoteOff(trigger.note, track.params.release, start + trigger.holdSec, track.source);
    }
  }
}
```

Add `import { DEFAULT_VELOCITY } from '../constants';` to the imports.

```ts
/** The default velocity a sequencer voice gets, matching `fireSequencerStepEvents`. */
```

Then the main walk, which is the only long function in the module:

```ts
function scheduleArrangement(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
): void {
  const stepDur = stepDurationSec(snapshot.bpm);
  const tickDur = stepDur / TICKS_PER_SIXTEENTH;
  const { stepsPerBar, meterId } = snapshot;

  for (const pass of plan.passes) {
    const loop = snapshot.loops[pass.loopIndex];
    const voices = buildLoopVoices(loop, meterId, snapshot.bpm, stepsPerBar);
    const chordless = loop.chords.length === 0;
    // Built once per pass, not once per step: the walk runs for every step of
    // every repeat, and two fresh objects per step is garbage the render pays
    // for and nobody reads.
    const leadTrack = mixdownLeadTrack(loop);
    const fxTrack = mixdownFxTrack(loop);

    for (let i = 0; i < pass.dwellSteps; i += 1) {
      // Pass-relative, so repeats 2..n reset the chord plan exactly as a live
      // loop restart does. See planArrangement's docblock: the dwell already
      // counts the repeats, so this is NOT a repeat loop.
      const stepInPass = i % pass.passSteps;
      const step = pass.startStep + i;
      const time = step * stepDur;
      const stepInBar = stepInPass % stepsPerBar;
      const barInPass = Math.floor(stepInPass / stepsPerBar);
      const isLoopStart = stepInPass === 0;

      // Drums: the same per-step decision the sequencer hook makes, with the
      // explicit time the render needs.
      for (const ev of sequencerStepEvents(loop.sequencerTracks, stepInBar, snapshot.sequencerParams, snapshot.bpm)) {
        if (ev.kind === 'note') {
          engine.triggerSynthNoteOn(ev.note, snapshot.sequencerParams, DEFAULT_VELOCITY, time, 'synth', 1, 'sequencer');
          engine.triggerSynthNoteOff(ev.note, ev.release, time + ev.offsetSec, 'synth');
        } else {
          engine.triggerDrum(ev.instrument, DEFAULT_VELOCITY, time);
        }
      }

      if (!chordless) {
        const chordIndex = voices.chordsByBar[barInPass];
        const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
        const chordSteps = voices.chordBars[chordIndex] * stepsPerBar;
        const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
        const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === voices.chordBars[chordIndex] - 1;
        const chordParams = loop.chordSynthParams;

        // Chord. Full hold arms once, on the chord's own first step; the arp
        // reads the ABSOLUTE step so it keeps stride across chords and bars;
        // otherwise the bar-invariant events are filtered to this step.
        if (voices.chordArp) {
          emitStepEvents(
            arpEventsForStep(voices.chordNotes[chordIndex], chordParams, step, stepDur, voices.chordHoldScale, stepsPerBar),
            chordParams, 'chord', time, chordEnd, engine,
          );
        } else if (voices.chordHoldSec[chordIndex] > 0) {
          if (stepsIntoChord === 0) {
            playFullHoldChord(voices.chordNotes[chordIndex], chordParams, time, voices.chordHoldSec[chordIndex], 'chord', engine);
          }
        } else {
          emitStepEvents(
            eventsForStep(voices.chordEvents[chordIndex], stepInBar, isLastBar),
            chordParams, 'chord', time, chordEnd, engine,
          );
        }

        // Bass, the same three-way split on its own bus.
        const bassParams = loop.bassSynthParams;
        if (voices.bassArp) {
          const bassNotes = generateBlockChordNotes(loop.chords[chordIndex].quality, loop.chords[chordIndex].root, loop.bassOctave);
          emitStepEvents(
            arpEventsForStep(bassNotes, bassParams, step, stepDur, voices.bassHoldScale, stepsPerBar),
            bassParams, 'bass', time, chordEnd, engine,
          );
        } else if (voices.bassHoldSec[chordIndex] > 0) {
          const root = voices.bassHoldNotes[chordIndex];
          if (root && stepsIntoChord === 0) {
            engine.triggerSynthNoteOn(root.noteName, bassParams, root.velocity, time, 'bass', 1, 'sequencer');
            engine.triggerSynthNoteOff(root.noteName, bassParams.release, time + voices.bassHoldSec[chordIndex], 'bass');
          }
        } else {
          emitStepEvents(
            eventsForStep(voices.bassEvents[chordIndex], stepInBar, isLastBar),
            bassParams, 'bass', time, chordEnd, engine,
          );
        }

        // Pad. `resolvePadArm` is called per chord because pad mode arms on
        // EVERY chord and drone mode only at the top of a pass — see its own
        // docblock. The trigger is `playFullHoldChord` on the pad bus, which
        // is exactly how the live hook holds a drone.
        if (stepsIntoChord === 0) {
          const arm = resolvePadArm({
            mode: loop.padMode,
            isLoopStart,
            chord: loop.chords[chordIndex],
            degree: loop.padDroneDegree,
            intervals: loop.padDroneIntervals,
            padOctave: loop.padOctave,
            voicing: loop.padVoicing,
            scaleRoot: loop.scaleRoot,
            scaleType: loop.scaleType,
            barDur: barDurationSec(snapshot.bpm, stepsPerBar),
            // Only a drone reads the loop's length, and loopBars walks the
            // whole progression — pad mode arms on every chord and must not
            // pay for it. `pass.passSteps / stepsPerBar` is the pass's bars.
            loopBarCount: pass.passSteps / stepsPerBar,
          });
          if (arm) {
            playFullHoldChord(arm.notes, loop.padSynthParams, time, arm.holdSec, 'pad', engine);
          }
        }
      }

      // Melody tracks run whether or not the loop has chords: a lead over a
      // chordless loop is a real thing, and the grid's own loop length is what
      // decides its material. No `stepInBar < stepsPerBar` guard here —
      // `stepInBar` IS a modulo by `stepsPerBar`, so such a guard is a
      // tautology, and the melody's own windowing already happens inside
      // leadActivePosAt/leadSoundingNotes.
      scheduleMelodyStep(engine, leadTrack, step, stepsPerBar, tickDur, time);
      scheduleMelodyStep(engine, fxTrack, step, stepsPerBar, tickDur, time);
    }
  }
}
```

**Two things this walk deliberately does NOT do, so nobody adds them back:** there is no `engine.triggerSynthNoteOn` beside `playFullHoldChord` — `playFullHoldChord` is the whole strike, and calling the two together sounds every pad note twice. And there is no `stepInBar < stepsPerBar` guard around the melody calls: `stepInBar` IS a modulo by `stepsPerBar`, so such a guard is a tautology, and the melody's own windowing already happens inside `leadActivePosAt`/`leadSoundingNotes`, which return nothing for a column the meter cannot reach. A guard here would be a second, silently-drifting copy of that rule.

Finally, the entry point:

```ts
type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/**
 * The offline context constructor, or null. A capability probe, like the File
 * System Access API path: a device without one is a degraded state the UI
 * renders, never an exception path. Read off `globalThis` and tested for
 * presence rather than caught from a `new`, so nothing has to be constructed
 * to find out.
 */
function offlineContextCtor(): OfflineCtor | null {
  const g = globalThis as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/**
 * Renders the arrangement to a WAV. NEVER THROWS.
 *
 * The one `try` covers the context construction, the encode and the render
 * itself, so a failure anywhere becomes a failed result with a reason rather
 * than an unhandled rejection crossing into a click handler with no message
 * for the user.
 *
 * The seeded generator is installed for the SCHEDULING walk only — reverb
 * impulse noise, noise-voice buffers and the arp's `'random'` note order all
 * read from it as they are created, which happens while the graph is being
 * built and not while it renders. It is restored in a `finally` on every exit
 * path, including the throwing one, so a leaked source cannot make the rest
 * of the session reproducible.
 */
export async function renderMixdown(snapshot: MixdownSnapshot): Promise<MixdownRenderResult> {
  try {
    if (snapshot.loops.length === 0) {
      return { ok: false, reason: { kind: 'empty-arrangement' } };
    }
    const Offline = offlineContextCtor();
    if (!Offline) return { ok: false, reason: { kind: 'unsupported-context' } };

    const stepDur = stepDurationSec(snapshot.bpm);
    const plan = planArrangement(snapshot);
    const bodySamples = Math.ceil(plan.totalSteps * stepDur * MIXDOWN_SAMPLE_RATE);
    // The tail has to cover the longest release AND the reverb it feeds, or a
    // song ending on a held chord is cut off mid-decay.
    const tailSec = Math.max(MIXDOWN_TAIL_SEC, snapshot.effects.reverbDecay + 1);
    const ctx = new Offline(
      MIXDOWN_CHANNELS,
      bodySamples + Math.ceil(tailSec * MIXDOWN_SAMPLE_RATE),
      MIXDOWN_SAMPLE_RATE,
    );

    const engine = createRenderEngine(ctx);
    applyMasterState(engine, snapshot);

    setRandomSource(mulberry32(MIXDOWN_SEED));
    try {
      scheduleArrangement(engine, snapshot, plan);
    } finally {
      setRandomSource(null);
    }

    const buffer = await ctx.startRendering();
    const blob = encodeWav(
      [buffer.getChannelData(0), buffer.getChannelData(1)],
      MIXDOWN_SAMPLE_RATE,
    );
    return { ok: true, buffer, blob };
  } catch (err) {
    return {
      ok: false,
      reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) },
    };
  }
}
```

No cast is needed at the `createRenderEngine` call: `OfflineCtor` is typed as the DOM's `OfflineAudioContext`, which extends `BaseAudioContext`. At runtime the object is whichever class the environment's global holds — the DOM's in a browser, `node-web-audio-api`'s under Bun — and the engine's public setters, `currentTime` and the node factories are the whole surface it touches, all of which that library implements.

Under `bun test` the global is not there by default, which is why the test file above installs it. That is the honest arrangement: the probe tests for a capability, the test provides the capability, and production has one path.


- [ ] **Step 8: Run the tests and expect them to pass**

```bash
bun test src/audio/export/renderMixdown.test.ts
bun run lint && bun run eslint
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(audio): render a mixdown offline from a snapshot

The renderer binds a throwaway engine to an OfflineAudioContext, applies the
snapshot through the engine's own public setters in engineSync's order, walks
the arrangement driving the same pure step functions the live clock drives,
and encodes the result. emitStepEvents and playFullHoldChord gain a trailing
engine parameter defaulting to the singleton rather than being copied, so the
gate clamp keeps one home.

The mixer is applied once, not per loop: setDrumTrackGain and setDrumFilter
read ctx.currentTime, which is 0 offline. updateSynthParams is not called at
all — each voice gets its params at trigger time.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
---

## Task 7: The store slice

**Files:**
- Create: `src/store/mixdownSlice.ts`
- Create: `src/store/mixdownSlice.test.ts`
- Modify: `src/store/store.ts`
- Modify: `src/store/types.ts`

**Interfaces:**
- Consumes: `renderMixdown`, `MixdownLoop`, `MixdownSnapshot`, `MixdownFailureReason` from `@/audio/export/renderMixdown`; `buildProjectContent` from `./projectFormat`; `SOURCE_BUSES` from `./sourceBuses`; `faderDbToGain`, `DEFAULT_FADER_DB` from `./levelUnits`; `DRUM_KITS` from `@/data/drumKits`.
- Produces: `MixdownResult`, `MixdownSlice`, `MIXDOWN_FAILURE_MESSAGE`, `buildMixdownSnapshot`, `wavFileName`.

- [ ] **Step 1: Write the failing tests**

Create `src/store/mixdownSlice.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { SOURCE_BUSES } from './sourceBuses';
import { DRUM_TYPES } from '@/types';
import { MIXDOWN_FAILURE_MESSAGE, wavFileName } from './mixdownSlice';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does — see
// src/audio/export/renderMixdown.test.ts for why there is no injection seam.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('wavFileName', () => {
  test('slugs the project name and swaps the extension', () => {
    expect(wavFileName('My Song')).toBe('my-song.wav');
    expect(wavFileName('')).toBe('project.wav');
    expect(wavFileName('!!!')).toBe('project.wav');
  });
});

describe('buildMixdownSnapshot', () => {
  test('carries one bus row per SOURCE_BUSES entry and one drum row per voice', () => {
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    expect(snapshot.buses.map((b) => b.source)).toEqual(SOURCE_BUSES.map((b) => b.source));
    expect(snapshot.drumTracks.map((t) => t.instrument)).toEqual([...DRUM_TYPES]);
  });

  test('converts the store\'s dB to linear gain, exactly once', () => {
    useAppStore.setState({ masterVolume: 0, chordVolume: 0, chordMuted: false });
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    // 0 dB is unity, and faderDbToGain is the SAME boundary engineSync uses —
    // a snapshot carrying dB would make the engine read 0 as silence.
    expect(snapshot.masterVolume).toBeCloseTo(1, 6);
    expect(snapshot.buses.find((b) => b.source === 'chord')?.gain).toBeCloseTo(1, 6);
  });

  test('solo does not leak into the export; mute does', () => {
    useAppStore.setState({ soloTracks: new Set(['drums']), chordMuted: false, bassMuted: true });
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    // Solo is a session-only monitoring gesture; it never reaches the export.
    expect(snapshot.buses.find((b) => b.source === 'chord')?.muted).toBe(false);
    // Mute is arrangement intent and does.
    expect(snapshot.buses.find((b) => b.source === 'bass')?.muted).toBe(true);
  });

  test('resolves stepsPerBar from the meter, so the renderer never parses a meter string', () => {
    useAppStore.setState({ meterId: '3/4' });
    expect(useAppStore.getState().buildMixdownSnapshot().stepsPerBar).toBe(12);
    useAppStore.setState({ meterId: '4/4' });
    expect(useAppStore.getState().buildMixdownSnapshot().stepsPerBar).toBe(16);
  });

  test('carries the loops from buildProjectContent, unmodified', () => {
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    expect(snapshot.loops.length).toBe(useAppStore.getState().loops.length);
    expect(snapshot.loops[0].chords).toEqual(useAppStore.getState().loops[0].chords);
  });
});

describe('exportMixdown', () => {
  const initialNotice = useAppStore.getState().projectNotice;
  const initialLoops = useAppStore.getState().loops;
  afterEach(() => {
    useAppStore.setState({ projectNotice: initialNotice, loops: initialLoops, exporting: false });
  });

  test('a successful export returns a WAV blob and a file name, and clears exporting', async () => {
    const result = await useAppStore.getState().exportMixdown();
    if (!result.ok) throw new Error('expected ok');
    expect(result.destination).toBe('download');
    expect(result.fileName.endsWith('.wav')).toBe(true);
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBeGreaterThan(44);
    expect(useAppStore.getState().exporting).toBe(false);
  });

  test('an empty arrangement fails with a notice, and exporting is cleared anyway', async () => {
    useAppStore.setState({ loops: [] });
    const result = await useAppStore.getState().exportMixdown();
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
    expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['empty-arrangement']);
    // The `finally`: a failure must not leave the button stuck on "Exporting…".
    expect(useAppStore.getState().exporting).toBe(false);
  });

  test('the store never touches the DOM — it hands the blob back instead', async () => {
    // No `document`, no `URL.createObjectURL`, no anchor click: the component
    // downloads, exactly as it does for a `.solna` written to 'download'.
    const createObjectURL = globalThis.URL.createObjectURL;
    let called = false;
    globalThis.URL.createObjectURL = () => {
      called = true;
      return 'blob:test';
    };
    try {
      await useAppStore.getState().exportMixdown();
      expect(called).toBe(false);
    } finally {
      globalThis.URL.createObjectURL = createObjectURL;
    }
  });
});

describe('exporting is session state', () => {
  test('it is absent from the persisted shape', async () => {
    const { partializeAppState } = await import('./store');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('exporting' in persisted).toBe(false);
  });

  test('it starts false', () => {
    expect(useAppStore.getState().exporting).toBe(false);
  });
});
```

Two things to confirm before running: the default project's loop must contain at least one **audible** voice for the non-silence assertion to be meaningful — this test only asserts `blob.size > 44`, which is true of silence too, deliberately, because the renderer's own suite is where non-silence is pinned against a known fixture. And `'3/4'` must be a real `MeterId`; check `src/utils/meter.ts`'s `METERS` and use a meter whose `stepsPerBar` is not 16.

- [ ] **Step 2: Run the tests and expect failure**

```bash
bun test src/store/mixdownSlice.test.ts
```

Expect `Cannot find module './mixdownSlice'`.

- [ ] **Step 3: Write the slice**

Create `src/store/mixdownSlice.ts`:

```ts
/**
 * The export mixdown slice.
 *
 * The split follows `projectSlice`'s `destination: 'download'` variant exactly:
 * **the store decides and the component writes.** Nothing here touches
 * `document`, creates an object URL or clicks an anchor — it returns the Blob
 * and the file name, and the header's click handler hands them to the browser.
 * That is what makes the whole export testable with no DOM.
 *
 * `exporting` is SESSION state: absent from `partializeAppState` and from
 * `PROJECT_CONTENT_KEYS`, never persisted, and it does not move
 * `PERSIST_VERSION`.
 */
import { renderMixdown, type MixdownFailureReason, type MixdownLoop, type MixdownSnapshot } from '../audio/export/renderMixdown';
import { DRUM_KITS } from '../data/drumKits';
import { DRUM_TYPES } from '../types';
import { getMeter } from '../utils/meter';
import { slugifyProjectName } from '../utils/projectFileIO';
import { buildProjectContent } from './projectFormat';
import { DEFAULT_FADER_DB, faderDbToGain } from './levelUnits';
import { SOURCE_BUSES } from './sourceBuses';
import type { AppStore } from './types';

export type MixdownResult =
  | { ok: true; destination: 'download'; blob: Blob; fileName: string }
  | { ok: false; reason: MixdownFailureReason };

export interface MixdownSlice {
  exporting: boolean;
  exportMixdown: () => Promise<MixdownResult>;
  buildMixdownSnapshot: () => MixdownSnapshot;
}

/**
 * One sentence per failure, in the same voice as `SAVE_FAILED_MESSAGE`: what
 * happened, and what the user can do about it. A `Record` over the reason's
 * `kind` rather than a switch, so a new reason is a compile error here instead
 * of an empty toast.
 */
export const MIXDOWN_FAILURE_MESSAGE: Record<MixdownFailureReason['kind'], string> = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
  'unsupported-context': 'This browser cannot render audio offline, so the mixdown could not be written.',
  'render-failed': 'The mixdown could not be rendered. Your project is unchanged; try again.',
};

/** The file name an export downloads: the project's slug, with a `.wav` extension. */
export function wavFileName(projectName: string | null): string {
  return `${slugifyProjectName(projectName ?? '')}.wav`;
}

/**
 * The snapshot the renderer works from: the `.solna` CONTENT set plus the mix
 * and bus fields a project body deliberately excludes.
 *
 * Built from `buildProjectContent` rather than from raw state on purpose —
 * "what is exported" and "what is saved" are then the same idea of the song,
 * and a field added to a project body reaches the export without a second
 * edit here. `loops` is assignable to `MixdownLoop[]` structurally, so `tsc`
 * proves every field the renderer reads is present in the content set.
 *
 * The dB→linear conversion happens HERE, once, and it goes through
 * `faderDbToGain` — the same boundary `engineSync.ts` crosses — so the bottom
 * of a fader is an exact 0 and a bus a user pulled all the way down exports
 * nothing.
 */
function buildMixdownSnapshot(get: () => AppStore): MixdownSnapshot {
  const s = get();
  const content = buildProjectContent(s);
  const loops: MixdownLoop[] = content.loops;

  return {
    bpm: content.bpm,
    meterId: content.meterId,
    stepsPerBar: getMeter(content.meterId).stepsPerBar,
    masterVolume: faderDbToGain(content.masterVolume),
    effects: content.effects,
    // The raw mute flag, NOT isTrackAudible: solo is a session-only monitoring
    // gesture and must never reach the export, while mute is arrangement intent
    // and must.
    buses: SOURCE_BUSES.map((bus) => ({
      source: bus.source,
      gain: faderDbToGain(s[bus.volume]),
      muted: s[bus.muted],
    })),
    // One row per CANONICAL voice, named or not. `pushDrumTrackGains` resets
    // every voice no track names to DEFAULT_FADER_DB, so a roster missing a
    // voice ends up at unity — stating that here makes the snapshot total and
    // saves the engine from having to know which rows it did not get.
    drumTracks: DRUM_TYPES.map((instrument) => {
      const track = s.sequencerTracks.find((t) => t.instrument === instrument);
      return { instrument, gain: faderDbToGain(track ? track.volume : DEFAULT_FADER_DB) };
    }),
    drumKit: DRUM_KITS[s.soundKit],
    drumKitName: s.soundKit,
    drumFilter: {
      cutoff: s.drumFilterCutoff,
      resonance: s.drumFilterResonance,
      type: s.drumFilterType,
    },
    sequencerParams: s.synthParams,
    loops,
  };
}

type Set = (partial: Partial<AppStore>) => void;
type Get = () => AppStore;

export function createMixdownSlice(set: Set, get: Get): MixdownSlice {
  return {
    exporting: false,
    buildMixdownSnapshot: () => buildMixdownSnapshot(get),

    exportMixdown: async () => {
      set({ exporting: true });
      try {
        const snapshot = buildMixdownSnapshot(get);
        const rendered = await renderMixdown(snapshot);
        if (!rendered.ok) {
          // The FAILURE notice is written here, not by the caller: it is a
          // property of the render, which this slice is the only witness to,
          // and a caller that ignored the result would otherwise leave the
          // user with a button that did nothing. The SUCCESS notice is the
          // component's, because it names a file the component has just
          // handed to the browser — the same split projectSlice's 'download'
          // destination uses.
          set({ projectNotice: MIXDOWN_FAILURE_MESSAGE[rendered.reason.kind] });
          return { ok: false, reason: rendered.reason };
        }
        return {
          ok: true,
          destination: 'download',
          blob: rendered.blob,
          fileName: wavFileName(get().projectName),
        };
      } finally {
        set({ exporting: false });
      }
    },
  };
}
```

`renderMixdown` catching its own throws is what makes the outer `try` a `try/finally` with no `catch`: a throw here would be a bug in the slice, not a render failure, and it should surface loudly rather than becoming a notice.

`Set`/`Get` are declared locally, following `projectSlice.ts:35-36`'s pattern — check whether the repo has since hoisted those two aliases into a shared module and import them instead if it has.

- [ ] **Step 4: Register the slice**

In `src/store/store.ts`, beside `createProjectSlice`:

```ts
        ...createMixdownSlice(setWithLoopMirror, get),
```

and add `createMixdownSlice` to the import block at the top. In `src/store/types.ts`, add `MixdownSlice` to `AppStore`'s `extends` list and import its type:

```ts
import type { MixdownSlice } from './mixdownSlice';
```

```ts
    ProjectSlice,
    MixdownSlice {}
```

`partializeAppState` is **not** touched: `exporting` must stay out of the persisted shape, and the slice's functions are not serialisable anyway (zustand's `partialize` returns an explicit allow-list, so nothing leaks by default — that is the point of the allow-list).

- [ ] **Step 5: Run the tests and expect them to pass**

```bash
bun test src/store/mixdownSlice.test.ts
bun test src/store/store.test.ts
bun run lint && bun run eslint
```

`store.test.ts` and the other slice tests are the regression net for the registration change.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(store): add the export mixdown slice

exportMixdown builds a snapshot from buildProjectContent plus the mix and bus
fields a project body excludes, converts dB to linear gain once through
faderDbToGain, and returns the Blob and file name the component downloads.
The store never touches document. exporting is session state and stays out of
partializeAppState.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 8: `downloadBlob` and the Export button

**Files:**
- Modify: `src/utils/projectFileIO.ts`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/Header.test.tsx`

**Interfaces:**
- Consumes: `exportMixdown`, `MixdownResult` from `@/store/store`; `downloadBlob`, `wavFileName` from `@/utils/projectFileIO`; `useLiveStore` from `./ui/useLiveStore`.
- Produces: `downloadBlob(fileName, blob, doc?, url?)`, `ObjectUrlApi` (now exported), `ExportButton({ layer })`, `runMixdownExport(deps)`, `MixdownExportDeps`.

- [ ] **Step 1: Write the failing `downloadBlob` test**

Append to `src/utils/projectFileIO.test.ts`:

```ts
describe('downloadBlob', () => {
  /** A document stub that records the anchor it was handed. */
  function recordingDoc() {
    const clicks: string[] = [];
    const removed: string[] = [];
    const doc = {
      createElement: () => {
        const anchor = {
          href: '',
          download: '',
          click: () => clicks.push(anchor.href),
          remove: () => removed.push(anchor.href),
        };
        return anchor;
      },
      body: { appendChild: () => {} },
    } as unknown as Document;
    return { doc, clicks, removed };
  }

  test('creates a URL, clicks the anchor, and revokes in the same order', () => {
    const { doc, clicks, removed } = recordingDoc();
    const revoked: string[] = [];
    const url = {
      createObjectURL: () => 'blob:1',
      revokeObjectURL: (href: string) => revoked.push(href),
    };
    downloadBlob('song.wav', new Blob(['x'], { type: 'audio/wav' }), doc, url);
    expect(clicks).toEqual(['blob:1']);
    // Revoked, and revoked AFTER the click: a URL revoked first is a download
    // that never starts.
    expect(removed).toEqual(['blob:1']);
    expect(revoked).toEqual(['blob:1']);
  });

  test('revokes even when the click throws', () => {
    const { doc } = recordingDoc();
    (doc.createElement as unknown as () => { click: () => void }) = () => ({
      click: () => {
        throw new Error('blocked');
      },
      remove: () => {},
      href: '',
      download: '',
    });
    const revoked: string[] = [];
    const url = { createObjectURL: () => 'blob:2', revokeObjectURL: (h: string) => revoked.push(h) };
    expect(() => downloadBlob('song.wav', new Blob(['x']), doc, url)).toThrow('blocked');
    expect(revoked).toEqual(['blob:2']);
  });

  test('downloadTextFile is the same download with a text blob', () => {
    const { doc, clicks } = recordingDoc();
    const url = { createObjectURL: () => 'blob:3', revokeObjectURL: () => {} };
    downloadTextFile('a.solna', 'body', 'application/json', doc, url);
    expect(clicks).toEqual(['blob:3']);
  });
});
```

The second test's assignment through a cast is ugly. **Simpler and honest:** give `recordingDoc` a `throwOnClick` flag and drop the cast. Do that.

- [ ] **Step 2: Run the test and expect failure**

```bash
bun test src/utils/projectFileIO.test.ts
```

Expect `downloadBlob is not a function` / an import error.

- [ ] **Step 3: Implement `downloadBlob`**

In `src/utils/projectFileIO.ts`, export the URL-api interface and add:

```ts
export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/**
 * Hands a Blob to the browser as a download.
 *
 * The `<a download>` dance, in one place, with the URL revoked in a `finally`
 * so a click that throws — a blocked download, a sandboxed frame — does not
 * leak an object URL that pins the blob for the life of the page. `doc` and
 * `url` are injectable for exactly the reason `downloadTextFile`'s are: the
 * store never touches the DOM, so the component does, and the component's
 * helper is then testable with no DOM at all.
 *
 * A Blob URL rather than a data URL, for the reason this file already
 * records: a rendered mixdown is far past any browser's data-URL length
 * limit.
 */
export function downloadBlob(
  fileName: string,
  blob: Blob,
  doc?: Document,
  url?: ObjectUrlApi,
): void {
  const d = doc ?? document;
  const u = url ?? URL;
  const href = u.createObjectURL(blob);
  const anchor = d.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  d.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    u.revokeObjectURL(href);
  }
}

export function downloadTextFile(
  fileName: string,
  text: string,
  mime: string,
  doc?: Document,
  url?: ObjectUrlApi,
): void {
  downloadBlob(fileName, new Blob([text], { type: mime }), doc, url);
}
```

- [ ] **Step 4: Write the failing Header tests**

Append to `src/components/Header.test.tsx`:

```tsx
// Reads the store through useLiveStore, so a test's setState lands (see
// ui/useLiveStore.ts). The LAYER comes from the prop, which is what makes
// "song layer only" an assertable statement under renderToString.
describe('ExportButton (song layer only)', () => {
  test('the song layer shows the trigger and its one item', () => {
    const html = renderToString(<ExportButton layer="song" />);
    expect(html).toContain('id="btn-export"');
    expect(html).toContain('id="btn-export-mixdown"');
    expect(html).toContain('Export mixdown (WAV)');
  });

  test('the loop layer never shows it — an export is an arrangement action', () => {
    const html = renderToString(<ExportButton layer="loop" />);
    expect(html).not.toContain('id="btn-export"');
  });

  test('the menu is shaped to take a stem row, and does not advertise one', () => {
    const html = renderToString(<ExportButton layer="song" />);
    // The row is out of scope, and a control that can never work on this build
    // must not be advertised — the same rule the Drive rows follow when
    // VITE_GOOGLE_CLIENT_ID is unset.
    expect(html).not.toContain('stem');
    expect(html).not.toContain('Stem');
    expect(html).not.toContain('coming soon');
    expect(html).not.toContain('disabled');
  });

  test('while exporting, the trigger is disabled and the item says so', () => {
    useAppStore.setState({ exporting: true });
    const html = renderToString(<ExportButton layer="song" />);
    const trigger = openTagContaining(html, 'id="btn-export"');
    expect(trigger).toContain('disabled');
    expect(html).toContain('Exporting');
    useAppStore.setState({ exporting: false });
  });

  test('the panel is focusable, like every other dropdown in the app', () => {
    // daisyUI holds `dropdown-content` open on :focus-within, so a
    // non-focusable panel closes the instant a pointer lands inside it.
    const html = renderToString(<ExportButton layer="song" />);
    const panel = openTagContaining(html, 'id="export-menu"');
    expect(panel).toContain('tabindex="0"');
  });
});

describe('runMixdownExport', () => {
  test('a successful export downloads the blob and names the file', async () => {
    const downloaded: [string, Blob][] = [];
    const notices: string[] = [];
    const result = await runMixdownExport({
      exportMixdown: async () => ({
        ok: true,
        destination: 'download',
        blob: new Blob(['wav'], { type: 'audio/wav' }),
        fileName: 'my-song.wav',
      }),
      download: (fileName, blob) => downloaded.push([fileName, blob]),
      setNotice: (message) => notices.push(message),
    });
    expect(result.ok).toBe(true);
    expect(downloaded.map(([name]) => name)).toEqual(['my-song.wav']);
    expect(notices).toEqual(['Exported my-song.wav.']);
  });

  test('a failed export downloads nothing and writes no success notice', async () => {
    const downloaded: string[] = [];
    const notices: string[] = [];
    const result = await runMixdownExport({
      // The slice already wrote the failure notice; this path must not write a
      // SECOND, contradicting one on top of it.
      exportMixdown: async () => ({ ok: false, reason: { kind: 'empty-arrangement' } }),
      download: (fileName) => downloaded.push(fileName),
      setNotice: (message) => notices.push(message),
    });
    expect(result.ok).toBe(false);
    expect(downloaded).toEqual([]);
    expect(notices).toEqual([]);
  });
});
```

and add `ExportButton, runMixdownExport` to the existing import of `./Header`.

- [ ] **Step 5: Run the tests and expect failure**

```bash
bun test src/components/Header.test.tsx
```

- [ ] **Step 6: Implement `ExportButton` and `runMixdownExport`**

In `src/components/Header.tsx`, beside `FollowPlayheadToggle`:

```tsx
/** What a click handler needs, injected so the wiring is testable with no DOM. */
export interface MixdownExportDeps {
  exportMixdown: () => Promise<MixdownResult>;
  download: (fileName: string, blob: Blob) => void;
  setNotice: (message: string) => void;
}

/**
 * The click handler's whole body: run the export, download on success, and say
 * so.
 *
 * Extracted and dependency-injected for the reason `runMixdownExport` is a
 * plain function rather than an inline arrow: the suite has no DOM and no
 * testing-library, so a handler that called `downloadBlob` and
 * `setProjectNotice` directly would be untestable — the buttons would render
 * and nothing would prove they were wired to anything.
 *
 * A failure writes NO notice here. The slice already wrote one, and a second
 * message on top of it would be the same fact told twice in two voices.
 */
export async function runMixdownExport(deps: MixdownExportDeps): Promise<MixdownResult> {
  const result = await deps.exportMixdown();
  if (result.ok) {
    deps.download(result.fileName, result.blob);
    deps.setNotice(`Exported ${result.fileName}.`);
  }
  return result;
}

/**
 * Export ▾ — the song layer's one arrangement-wide action.
 *
 * Takes `layer` as a prop rather than deriving it, for the same testability
 * reason `FollowPlayheadToggle` and `ProjectNameLabel` do: `Header` derives
 * `layer` from `activeTab` through a plain `useAppStore` selector, which under
 * `renderToString` serves the store's creation-time state, so a rendered
 * `<Header />` can never reach the song layer. The prop is what makes
 * "song layer only" an assertable statement.
 *
 * The menu is SHAPED to take a stem row later — one row per export kind, each
 * owning its own action — and no row is built for it. A control that can never
 * work on this build must not be advertised.
 */
export function ExportButton({ layer }: { layer: Layer }) {
  const exporting = useLiveStore((s) => s.exporting);
  const exportMixdown = useLiveStore((s) => s.exportMixdown);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  if (layer !== 'song') return null;

  return (
    <div className="dropdown dropdown-end">
      <button
        id="btn-export"
        type="button"
        disabled={exporting}
        className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"
        aria-label="Export"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>
      <ul
        id="export-menu"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="dropdown-content menu menu-sm z-50 mt-2 min-w-44 max-w-[calc(100vw-2rem)] rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
      >
        <li>
          <button
            id="btn-export-mixdown"
            type="button"
            disabled={exporting}
            onClick={() => {
              void runMixdownExport({
                exportMixdown,
                download: downloadBlob,
                setNotice: setProjectNotice,
              });
            }}
          >
            {exporting ? 'Rendering mixdown…' : 'Export mixdown (WAV)'}
          </button>
        </li>
      </ul>
    </div>
  );
}
```

Add to the imports: `ChevronDown` and a download glyph from `lucide-react` (check which one the repo already imports; `Download` if present, otherwise add it), `downloadBlob` from `@/utils/projectFileIO`, `useLiveStore` from `./ui/useLiveStore`, and `import type { MixdownResult } from '@/store/store';`.

The trigger carries `disabled`, not the `btn-disabled` class: a `disabled` attribute is what the test can assert on and what actually blocks the click, and daisyUI styles `:disabled` on `.btn` already. **Drop the second `disabled` on the menu item** if that leaves only one assertable spot — keep it: a menu that stays open while the render runs must not offer the action again, and `exporting` guards the slice anyway, so this is belt-and-braces for the pointer, not the correctness.

Then render it beside the toggle in `Header`'s song-layer cluster:

```tsx
        <ExportButton layer={layer} />
```

next to `<FollowPlayheadToggle layer={layer} />` at line 375.

- [ ] **Step 7: Run the tests and expect them to pass**

```bash
bun test src/components/Header.test.tsx src/utils/projectFileIO.test.ts
bun run lint && bun run eslint
bun run check:theme
```

`check:theme` is a gate here: the new markup must use role-based tokens, and no raw colour, Tailwind palette class or `dark:` variant may appear.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): add the Export mixdown action to the header

ExportButton renders on the song layer only, takes layer as a prop and reads
the store through useLiveStore, so both rules are assertable under
renderToString. The click body is an injected runMixdownExport so the wiring
is testable with no DOM, and downloadBlob joins downloadTextFile in the utils
with the object URL revoked in a finally.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 9: Verify, and sweep the docs

- [ ] **Step 1: Run the full gate**

```bash
bun run verify
```

It runs `bun test`, `bun run lint`, `bun run eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels` and `bun run build`. `check:levels` is the one to watch: it asserts the calibration trim table still matches today's kit and preset defaults, and Task 3 moved `encodeWav` and repointed the harness at the `src/utils/` copy. A moved hash there means the port was not byte-faithful.

- [ ] **Step 2: Fix whatever the gate reports**

`bun run eslint` must report **nothing at all** — no errors and no warnings — which is the state the repo keeps it in. The three rules most likely to fire on this change, and their honest fixes:

| Rule | Where | Fix |
| --- | --- | --- |
| `no-restricted-imports` | `src/audio/export/renderMixdown.ts` naming `store/` or `components/` | Move the value down a layer or put it in the snapshot. Never an eslint-disable on the layering block. |
| `@typescript-eslint/no-explicit-any` | `renderMixdown.ts` | A `unknown` plus a narrowing check, or a structural type. The test files already have file-level disables where the engine's DOM typing needs one. |
| `react-hooks/exhaustive-deps` | `ExportButton` | A line disable naming the reason, following the repo's rule — never a rule relaxed for everybody. |

- [ ] **Step 3: Sweep the docs that now say something untrue**

Read each and fix only what the feature made false:

- **`docs/design.md`** — look for a stale "Export" entry, and for any statement that the header has no arrangement-wide action. Add the new action, or remove the stale line.
- **`docs/superpowers/specs/2026-09-12-export-mixdown-design.md`** — the design is now built. Add a one-line status note at the top pointing at this plan, if the repo's other specs do that. Do not rewrite the spec's decisions; it is the record of what was decided, and the two deviations this plan records belong in the plan.
- **`CLAUDE.md`** — only if a rule changed. Two candidates: the `src/audio/` bullet, if the offline render seam is worth naming there (it is a new public door into the engine), and the Commands section, which is untouched. Prefer one sentence over a paragraph, and remember the file's own instruction not to record version numbers.
- **Do not touch** `PERSIST_VERSION`, `PROJECT_FORMAT_VERSION` or the `.solna` content set — the export adds nothing to any of them.

- [ ] **Step 4: Re-run the gate after the doc edits**

```bash
bun run verify
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: record the export mixdown feature

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Known limitations this plan carries forward

Recorded here so the follow-ups are named and not rediscovered:

- **The mixer is applied once, not per loop.** `setDrumTrackGain` and `setDrumFilter` read `ctx.currentTime`, which is 0 in an offline render, so a song whose loops differ in mixer settings exports with one loop's mixer. The live app schedules per-bus gain and mute changes at song boundaries (`src/store/sourceTransition.ts`, commit `e3253ca`) — the follow-up is doing the same for the per-track drum gain, which means giving `setDrumTrackGain` a `time` the way `setSourceGain` already has one.
- **The render is not bit-identical to realtime under voice-stealing.** A voice's node teardown is armed with `setTimeout`, which is wall-clock while the envelope runs on the audio clock. Teardown runs after the envelope has reached 0, so what a late teardown leaks is a disconnected node, not a sound. See the spec's own Known limitations.
- **The arp as a live gesture is absent**, deliberately: no keys are held in a render. Arp *material* (`arpActive`) is rendered.
- **`repeatCount` is honoured through `loopDwellSteps`, so the walk is `dwell` steps once with a pass-relative index** — see the plan's two recorded deviations. A future change to `loopDwellSteps`' meaning changes the renderer too, which is why the renderer calls it rather than re-deriving the arithmetic.
