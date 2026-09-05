# Live Lead Capture and a Single Grid Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player record a melody *in time* while the transport runs — the note lands on the column it was heard on, and its length is how long the key was held — and collapse the melody grid's two "this column" indicators into one marker sitting on a ruler big enough to hit.

**Architecture:** Two clock anchors `(step, time)` handed over by `subscribePlaybackClock` are the whole time reference. `src/audio/leadLiveRecord.ts` holds the arithmetic as pure functions over plain numbers — measure the step duration from the anchors, subtract `outputLatency` from the observed press, round to the nearest step, count the held length in steps — with `createLeadLiveClock` as the injectable stateful wrapper. `src/audio/playback/leadLiveClock.ts` is the one place that wires that wrapper to the real engine. `src/store/leadRecord.ts` stays the single `noteInputBus` subscriber: it resolves the write column (live clock column while music plays, `leadCursor` otherwise), holds the note-on step per note, and extends on note-off through `setLeadNoteLength`, which already owns all three length invariants. On the view side `leadCursor` remains the source while stopped and `stepPublisher` remains the source while playing — they are never merged into one stored value; a small hook picks the live one and one absolutely-positioned `LeadMarker` draws it across a header ruler grown to a full row's height.

**Tech Stack:** Bun (test runner + scripts), Vite + React 19, TypeScript `strict`, Zustand with `persist` + `subscribeWithSelector`, raw Web Audio API, Tailwind v4 + daisyUI v5, ESLint flat config with the three-layer `no-restricted-imports` rules.

**Spec:** docs/superpowers/specs/2026-09-04-lead-live-record-and-grid-ruler-design.md

## Global Constraints

- Branch is `feat/dev-374-live-record-and-marker`. All work lands there; feature work never lands as a commit made directly on `main`.
- Three-layer import rule (eslint `no-restricted-imports`, all `error`): `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` never imports `audio/engine`.
- **The recorder must never read `src/components/playbackStep.ts`.** It is components-layer, `store/` may not import it, and it carries whole-number steps meant for a highlight. The recorder derives its own sub-step position from the audio-layer anchors plus `ctx.currentTime`.
- `bun run verify` is the completion gate: `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. `bun run lint` (tsc `--noEmit`) must pass at **every** task boundary — the decomposition below is ordered so it does.
- `bun run eslint` must report **zero errors** and **no more than the current 325 warnings** at every task boundary. Warnings are tolerated; new ones are not.
- Tests are `bun:test`, run with `bun test`. **There is no DOM and no testing-library, and none may be added** (`.claude/rules/testing.md`). Rendered-markup tests use `renderToString` from `react-dom/server` and assert single literal substrings covering several classes at once.
- The zustand + `renderToString` trap: `getServerSnapshot` is `selector(api.getInitialState())`, captured once at store creation, so `useAppStore.setState(...)` before a `renderToString` has **no effect, silently**. Marker geometry is therefore tested through the `LeadMarker` component with an explicit `column` prop, never by setting `leadCursor` and rendering `LeadMelodyGrid`.
- **No persisted shape changes in this plan, so the persist `version` does NOT move and `PROJECT_FORMAT_VERSION` does NOT move.** `leadMelodySteps` stays `LeadNote[][]`, `leadCursor` stays a number, and no field is added to any persisted slice. (Bump the persist `version` and add a migration step whenever the persisted shape *does* change; bump `PROJECT_FORMAT_VERSION` only when the content contract changes.) Velocity stays off `LeadNote` for exactly this reason.
- Never call engine setters from a component. Nothing here is an engine-settable value, so `engineSync.ts` changes only in that it already starts `startLeadRecordBridge()`; that call site is untouched.
- Theming (`.claude/rules/theming.md`): components name roles, never colours. `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes, `text-white` and the `dark:` variant. Every class string this plan writes already exists in `src/`.
- The note-input rules in `.claude/rules/note-input.md` are unchanged: previews do not announce, a source that swallows the sound still announces, observers live in `store/` and not in `audio/`, and sequenced notes are not input.
- Commits use `git add <named files>`, never `-A` and never `.`. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  ```

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/audio/leadLiveRecord.ts` | Pure live-capture arithmetic: anchor bookkeeping, measured step duration, latency-compensated round-to-nearest quantise, held length in steps, clock-step-to-grid-column — plus `createLeadLiveClock`, the injectable stateful wrapper. |
| `src/audio/leadLiveRecord.test.ts` | Tests every one of the above with plain numbers: no AudioContext, no DOM. |
| `src/audio/playback/leadLiveClock.ts` | The one place the pure clock is wired to the real engine: subscribes `subscribePlaybackClock` for anchors and reads `currentTime` / `outputLatency` through `playbackEngine`. |
| `src/components/loop/lead/useLeadMarker.ts` | `useLeadMarkerColumn(isPlaying, columns)` — picks the live source (`stepPublisher` while playing, `leadCursor` while stopped) without merging them. |

**Modified**

| Path | Change |
|---|---|
| `src/audio/playback/playbackEngine.ts` | Adds `outputLatencySec` (pure), `playbackOutputLatencySec`, `playbackNowSec`; `playbackAudibleDelaySec` re-expressed on top of them so both directions share one latency rule. |
| `src/audio/playback/playbackEngine.test.ts` | Tests the pure `outputLatencySec` fallback chain. |
| `src/store/types.ts` | `recordLeadNote` gains its optional `column` argument. |
| `src/store/leadSlice.ts` | `recordLeadNote` writes at `column ?? leadCursor` and no longer refuses while the transport plays. |
| `src/store/leadSlice.test.ts` | Replaces the DEV-374 refusal test with the write-head tests. |
| `src/store/leadRecord.ts` | Resolves the write column, owns the held-note map and the anchor-collector lifecycle; gains injectable deps. |
| `src/store/leadRecord.test.ts` | Replaces the DEV-374 refusal test; adds live-column, held-length and lifecycle tests. |
| `src/components/loop/lead/melodyGrid.ts` | Adds the pure `leadMarkerColumn`. |
| `src/components/loop/lead/melodyGrid.test.ts` | Tests `leadMarkerColumn`. |
| `src/components/loop/lead/LeadMelodyGrid.tsx` | Ruler strips grow to a row's height; `LeadPlayhead` becomes `LeadMarker`, drawn once across headers and body from the merged column. |
| `src/components/loop/lead/LeadMelodyGrid.test.tsx` | Updates the playhead tests to marker tests; adds the DEV-371 a11y-contract-survives test. |
| `.claude/rules/note-input.md` | Records that a note-off is now data, not just a release. |

---

### Task 1: One rule for output latency, shared by both directions

DEV-376 subtracts nothing and *adds* `outputLatency` to delay a visual; DEV-374 *subtracts* the same number to advance an input. The fallback chain (`outputLatency || baseLatency || 0`) must not exist twice, and it must be testable without an AudioContext.

**Files:**
- Modify: `src/audio/playback/playbackEngine.ts`
- Test: `src/audio/playback/playbackEngine.test.ts`

**Interfaces:**
- Consumes: `audioEngine.getAudioContext()`.
- Produces:
  ```ts
  export function outputLatencySec(
    ctx: { outputLatency?: number; baseLatency?: number } | null | undefined,
  ): number
  export function playbackOutputLatencySec(): number
  export function playbackNowSec(): number | null
  ```
  `playbackAudibleDelaySec(time: number): number` keeps its signature and its behaviour exactly.

**Steps:**

- [ ] **Step 1: Write the failing test for the pure fallback chain.**
  Append to `src/audio/playback/playbackEngine.test.ts`, and change the import line to `import { HARD_STOP_RELEASE, outputLatencySec } from './playbackEngine';`:
  ```ts
  describe('outputLatencySec', () => {
    test('prefers outputLatency when the browser reports one', () => {
      expect(outputLatencySec({ outputLatency: 0.03, baseLatency: 0.01 })).toBe(0.03);
    });

    test('falls back to baseLatency where outputLatency is unimplemented', () => {
      expect(outputLatencySec({ outputLatency: 0, baseLatency: 0.011 })).toBe(0.011);
      expect(outputLatencySec({ baseLatency: 0.011 })).toBe(0.011);
    });

    test('is 0, never NaN, with no numbers and with no context at all', () => {
      // 0 biases a recorded note by a few ms; NaN would send it to no column
      // at all, so the floor matters more than the precision.
      expect(outputLatencySec({})).toBe(0);
      expect(outputLatencySec(null)).toBe(0);
      expect(outputLatencySec(undefined)).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/audio/playback/playbackEngine.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'outputLatencySec' not found in module '.../src/audio/playback/playbackEngine.ts'`.

- [ ] **Step 3: Extract the three helpers and re-express `playbackAudibleDelaySec` on them.**
  In `src/audio/playback/playbackEngine.ts`, replace the whole body of `playbackAudibleDelaySec` (keeping the doc comment above it) with:
  ```ts
  export function playbackAudibleDelaySec(time: number): number {
    const now = playbackNowSec();
    if (now === null) return 0;
    return Math.max(0, time + playbackOutputLatencySec() - now);
  }

  /** The AudioContext's clock, or null when there is no context yet. */
  export function playbackNowSec(): number | null {
    return audioEngine.getAudioContext()?.currentTime ?? null;
  }

  /**
   * The delay between the context reaching a time and the sound leaving the
   * speaker. Pure and separately exported because it is read in BOTH
   * directions: playbackAudibleDelaySec adds it to hold a playhead back until
   * the step is heard (DEV-376), and live lead capture subtracts it to place a
   * press at the moment the player actually reacted to (DEV-374).
   *
   * outputLatency is unimplemented on some browsers; baseLatency is the
   * conservative stand-in, and 0 is better than NaN in either case.
   */
  export function outputLatencySec(
    ctx: { outputLatency?: number; baseLatency?: number } | null | undefined,
  ): number {
    if (!ctx) return 0;
    return ctx.outputLatency || ctx.baseLatency || 0;
  }

  export function playbackOutputLatencySec(): number {
    return outputLatencySec(audioEngine.getAudioContext());
  }
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/audio/playback/playbackEngine.test.ts
  bun test src/components/playbackStep.test.ts
  bun run lint
  ```
  All three must pass; `playbackStep.test.ts` is the DEV-376 consumer and proves the refactor changed no behaviour.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/audio/playback/playbackEngine.ts src/audio/playback/playbackEngine.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(audio): name the output latency once, so both directions share it

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 2: The quantiser, as pure arithmetic over plain numbers

Anchor bookkeeping, the measured step duration, the latency subtraction, round-to-nearest, the held length, and the named clock-step-to-grid-column conversion. No AudioContext, no store, no DOM — this is the only reason any of it is testable.

**Files:**
- Create: `src/audio/leadLiveRecord.ts`
- Test: `src/audio/leadLiveRecord.test.ts`

**Interfaces:**
- Consumes: nothing. The module imports nothing at all.
- Produces:
  ```ts
  export interface ClockAnchor { step: number; time: number }
  export const LEAD_ANCHOR_STALE_STEPS = 4;
  export function pushClockAnchor(anchors: readonly ClockAnchor[], next: ClockAnchor): ClockAnchor[]
  export function measuredStepDurationSec(anchors: readonly ClockAnchor[]): number | null
  export function quantiseInputStep(
    anchors: readonly ClockAnchor[],
    observedTime: number,
    outputLatencySec: number,
  ): number | null
  export function heldStepLength(onStep: number, offStep: number): number
  export function clockStepToGridColumn(clockStep: number, columns: number): number
  ```

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  Create `src/audio/leadLiveRecord.test.ts`:
  ```ts
  import { describe, expect, test } from 'bun:test';
  import { readFileSync } from 'node:fs';
  import {
    clockStepToGridColumn,
    heldStepLength,
    measuredStepDurationSec,
    pushClockAnchor,
    quantiseInputStep,
  } from './leadLiveRecord';
  import { stepDurationSec } from '../utils/musicTheory';

  describe('pushClockAnchor', () => {
    test('keeps the two most recent anchors and nothing else', () => {
      let anchors = pushClockAnchor([], { step: 1, time: 0.1 });
      anchors = pushClockAnchor(anchors, { step: 2, time: 0.2 });
      anchors = pushClockAnchor(anchors, { step: 3, time: 0.3 });
      expect(anchors).toEqual([
        { step: 2, time: 0.2 },
        { step: 3, time: 0.3 },
      ]);
    });

    test('a repeated step replaces its anchor rather than duplicating it', () => {
      // The clock re-dispatches a step whenever the stall detector re-anchors
      // the grid. That is a better time for the same step, not a new anchor —
      // and taking it as one would make the measured duration 0.
      const anchors = pushClockAnchor(
        [
          { step: 1, time: 0.1 },
          { step: 2, time: 0.2 },
        ],
        { step: 2, time: 0.25 },
      );
      expect(anchors).toEqual([
        { step: 1, time: 0.1 },
        { step: 2, time: 0.25 },
      ]);
    });

    test('a step going backwards is a rewind, and drops the history', () => {
      // resetClock() sets clockStepIndex back to 0. Projecting across that
      // seam would give a negative duration and a nonsense column.
      const anchors = pushClockAnchor(
        [
          { step: 40, time: 9.0 },
          { step: 41, time: 9.25 },
        ],
        { step: 0, time: 12.0 },
      );
      expect(anchors).toEqual([{ step: 0, time: 12.0 }]);
    });
  });

  describe('measuredStepDurationSec', () => {
    test('is the gap between two anchors divided by the steps between them', () => {
      expect(
        measuredStepDurationSec([
          { step: 8, time: 10 },
          { step: 9, time: 10.2 },
        ]),
      ).toBeCloseTo(0.2, 10);
      expect(
        measuredStepDurationSec([
          { step: 8, time: 10 },
          { step: 12, time: 10.8 },
        ]),
      ).toBeCloseTo(0.2, 10);
    });

    test('bpm is irrelevant to the result, because bpm is not an input', () => {
      // The whole point of measuring: a bpm change, a meter change and a
      // future adjustable step resolution all follow for free. A bpm-derived
      // constant would keep returning the old value with no error anywhere —
      // the notes would simply land on the wrong columns.
      const anchors = [
        { step: 8, time: 10 },
        { step: 9, time: 10.2 },
      ];
      expect(measuredStepDurationSec(anchors)).toBeCloseTo(0.2, 10);
      expect(stepDurationSec(120)).toBeCloseTo(0.125, 10);
      expect(stepDurationSec(60)).toBeCloseTo(0.25, 10);
      expect(measuredStepDurationSec(anchors)).not.toBeCloseTo(stepDurationSec(120), 10);
      expect(measuredStepDurationSec(anchors)).not.toBeCloseTo(stepDurationSec(60), 10);
    });

    test('the module cannot even reach the bpm-derived duration', () => {
      const src = readFileSync(new URL('./leadLiveRecord.ts', import.meta.url), 'utf8');
      expect(src).not.toContain('stepDurationSec');
      // And nothing else either: the module is pure arithmetic, which is what
      // makes it testable with no AudioContext and no DOM.
      expect(src).not.toMatch(/^import /m);
    });

    test('one anchor, none, or a non-advancing pair has no answer', () => {
      expect(measuredStepDurationSec([])).toBeNull();
      expect(measuredStepDurationSec([{ step: 8, time: 10 }])).toBeNull();
      expect(
        measuredStepDurationSec([
          { step: 8, time: 10 },
          { step: 8, time: 10 },
        ]),
      ).toBeNull();
    });
  });

  describe('quantiseInputStep', () => {
    // 0.25 s per step — a 60 bpm 16th, chosen so the numbers stay readable.
    const anchors = [
      { step: 32, time: 10.0 },
      { step: 33, time: 10.25 },
    ];

    test('a press one step past the newest anchor lands on the next step', () => {
      expect(quantiseInputStep(anchors, 10.5, 0)).toBe(34);
    });

    test('rounds to the NEAREST step, never the floor', () => {
      // 0.6 of a step past 33: the floor says 33, the ear says 34.
      expect(quantiseInputStep(anchors, 10.4, 0)).toBe(34);
      expect(quantiseInputStep(anchors, 10.65, 0)).toBe(35);
    });

    test('a press slightly EARLY still lands on the step it was aiming at', () => {
      // 20 ms before step 34 sounds. Flooring would push it back to 33, which
      // is the same one-sided error the latency subtraction exists to avoid.
      expect(quantiseInputStep(anchors, 10.48, 0)).toBe(34);
    });

    test('output latency advances the press: what was heard was already late', () => {
      // Uncompensated, a press observed at 10.63 rounds up to step 35.
      expect(quantiseInputStep(anchors, 10.63, 0)).toBe(35);
      // The sound the player reacted to left the speaker 20 ms after the
      // context reached its time, so the press really happened at 10.61 —
      // step 34, the one they were aiming at.
      expect(quantiseInputStep(anchors, 10.63, 0.02)).toBe(34);
    });

    test('fewer than two anchors means no clock, and no answer', () => {
      expect(quantiseInputStep([], 10.5, 0)).toBeNull();
      expect(quantiseInputStep([{ step: 32, time: 10 }], 10.5, 0)).toBeNull();
    });

    test('a stale newest anchor means the clock has stopped', () => {
      // Anchors are FUTURE times (the clock is a lookahead scheduler), so a
      // `now` well past the newest one can only mean nothing is scheduling.
      expect(quantiseInputStep(anchors, 10.25 + 1.0 + 0.01, 0)).toBeNull();
      expect(quantiseInputStep(anchors, 10.25 + 1.0 - 0.01, 0)).not.toBeNull();
    });
  });

  describe('heldStepLength', () => {
    test('is the number of steps the key was down', () => {
      expect(heldStepLength(4, 8)).toBe(4);
    });

    test('a tap is one step, never zero — a zero-length note is invisible', () => {
      expect(heldStepLength(4, 4)).toBe(1);
    });

    test('a release quantised earlier than the press is still one step', () => {
      expect(heldStepLength(4, 3)).toBe(1);
    });

    test('counts straight across the loop seam, because the clock step never wraps', () => {
      // Truncating at the loop end is setLeadNoteLength's job (invariant 2),
      // not this function's; counting in raw clock steps is what makes the
      // length immune to a bpm change during the hold.
      expect(heldStepLength(14, 20)).toBe(6);
    });
  });

  describe('clockStepToGridColumn', () => {
    test('is the identity inside the first loop — today a clock step IS a column', () => {
      expect(clockStepToGridColumn(0, 16)).toBe(0);
      expect(clockStepToGridColumn(7, 16)).toBe(7);
    });

    test('wraps by the loop width, exactly as useLeadPlayback does', () => {
      expect(clockStepToGridColumn(16, 16)).toBe(0);
      expect(clockStepToGridColumn(37, 16)).toBe(5);
    });

    test('a negative step wraps forward rather than escaping the grid', () => {
      expect(clockStepToGridColumn(-1, 16)).toBe(15);
    });

    test('a loop with no columns has nowhere to land', () => {
      expect(clockStepToGridColumn(4, 0)).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/audio/leadLiveRecord.test.ts
  ```
  Expected failure: `error: Cannot find module './leadLiveRecord' from '.../src/audio/leadLiveRecord.test.ts'`.

- [ ] **Step 3: Write the module.**
  Create `src/audio/leadLiveRecord.ts`:
  ```ts
  /**
   * Live capture: the arithmetic that turns "a key went down just now" into a
   * grid column, and "it came back up" into a length in steps.
   *
   * Everything here is a pure function over plain numbers — no AudioContext,
   * no store, no DOM, and no imports at all. That is not tidiness. There is no
   * DOM in this suite to press a key against, so anything left inside the
   * clock callback or the bus listener cannot be tested at all, and this
   * feature area's history is a fully green suite that proved nothing about
   * whether the gesture worked.
   */

  /** One clock dispatch, as handed over by subscribePlaybackClock. */
  export interface ClockAnchor {
    /** The clock's monotonic 16th-step index. Never wraps; resetClock zeroes it. */
    step: number;
    /** The AudioContext time that step is scheduled to SOUND at — in the future. */
    time: number;
  }

  /**
   * How far past the newest anchor an observation may sit before the clock
   * counts as stopped. Anchors are future times, so this is generous by
   * construction: the honest reading of a `now` well past the last scheduled
   * step is that nothing is scheduling any more.
   */
  export const LEAD_ANCHOR_STALE_STEPS = 4;

  /**
   * The two most recent anchors, and only those. Two is all the arithmetic
   * needs, and keeping more would mean averaging across a tempo change.
   */
  export function pushClockAnchor(
    anchors: readonly ClockAnchor[],
    next: ClockAnchor,
  ): ClockAnchor[] {
    const last = anchors[anchors.length - 1];
    // A rewind (resetClock sets the index back to 0) makes the two sides of
    // the seam incomparable: projecting across it yields a negative duration.
    if (last && next.step < last.step) return [next];
    // The stall detector re-dispatches a step already handed over. That is a
    // better time for the same step, not a second anchor — taken as one, the
    // measured duration would be a division by zero steps.
    if (last && next.step === last.step) return [...anchors.slice(0, -1), next];
    return [...anchors, next].slice(-2);
  }

  /**
   * Seconds per step, MEASURED from the anchors rather than computed from bpm.
   * Measuring makes the quantiser independent of what a step is: a bpm change,
   * a meter change and a future adjustable step resolution all follow for
   * free. A bpm-derived constant would keep returning the old value with no
   * error anywhere — the notes would simply land on the wrong columns.
   */
  export function measuredStepDurationSec(anchors: readonly ClockAnchor[]): number | null {
    if (anchors.length < 2) return null;
    const a = anchors[anchors.length - 2];
    const b = anchors[anchors.length - 1];
    const steps = b.step - a.step;
    const seconds = b.time - a.time;
    if (steps <= 0 || !(seconds > 0)) return null;
    return seconds / steps;
  }

  /**
   * The clock step a press observed at `observedTime` belongs to, or null when
   * there is no running clock to quantise against.
   *
   * Two decisions live here. The latency subtraction: at ctx.currentTime = C
   * the sound reaching the player's ear was scheduled for C - outputLatency,
   * so a press observed at C is interpreted as having happened then — the
   * exact mirror of the delay DEV-376 adds to hold a playhead back. And
   * round-to-nearest: players straddle the beat in both directions, and
   * flooring turns that into a one-directional drag onto the previous step,
   * which reads as a sluggish groove and gets worse as tempo rises.
   *
   * Input latency — finger to JS event — is deliberately not compensated: it
   * cannot be measured from the page, and it is a few milliseconds.
   */
  export function quantiseInputStep(
    anchors: readonly ClockAnchor[],
    observedTime: number,
    outputLatencySec: number,
  ): number | null {
    const stepDur = measuredStepDurationSec(anchors);
    if (stepDur === null) return null;
    const latest = anchors[anchors.length - 1];
    if (observedTime - latest.time > LEAD_ANCHOR_STALE_STEPS * stepDur) return null;
    const inputTime = observedTime - outputLatencySec;
    return Math.round(latest.step + (inputTime - latest.time) / stepDur);
  }

  /**
   * How many steps the key was held for. Counted in STEPS, not seconds, so a
   * bpm change during the hold cannot change the answer. The loop-end
   * truncation is setLeadNoteLength's (invariant 2), not this function's.
   */
  export function heldStepLength(onStep: number, offStep: number): number {
    return Math.max(1, Math.round(offStep - onStep));
  }

  /**
   * A clock step as a grid column. Today the clock's 16th step and a grid
   * column are the same thing, so the resolution part is the identity and only
   * the loop wrap does any work — named anyway, because when DEV-375 makes the
   * step resolution adjustable there is then ONE place to change instead of
   * three scattered pieces of arithmetic that each look correct in isolation.
   */
  export function clockStepToGridColumn(clockStep: number, columns: number): number {
    if (!(columns > 0)) return 0;
    const step = Math.round(clockStep);
    return ((step % columns) + columns) % columns;
  }
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/audio/leadLiveRecord.test.ts
  bun run lint
  ```

- [ ] **Step 5: Commit.**
  ```bash
  git add src/audio/leadLiveRecord.ts src/audio/leadLiveRecord.test.ts
  git commit -m "$(cat <<'EOF'
  feat(audio): quantise a played note against the clock's own measured step

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 3: The anchor collector, injectable and then wired to the engine

`createLeadLiveClock` is the stateful half — it holds the anchors and answers "which step is now" — but every dependency on the real world is a function it is handed, so the whole thing is testable. `leadLiveClock.ts` is the single, untestable line that hands it the real engine.

**Files:**
- Modify: `src/audio/leadLiveRecord.ts` (append the factory)
- Create: `src/audio/playback/leadLiveClock.ts`
- Test: `src/audio/leadLiveRecord.test.ts` (append)

**Interfaces:**
- Consumes: `subscribePlaybackClock`, `playbackNowSec`, `playbackOutputLatencySec` from Task 1.
- Produces:
  ```ts
  // src/audio/leadLiveRecord.ts
  export interface LeadLiveClockDeps {
    now: () => number | null;
    outputLatency: () => number;
  }
  export interface LeadLiveClock {
    anchor(step: number, time: number): void;
    inputStep(): number | null;
    reset(): void;
  }
  export function createLeadLiveClock(deps: LeadLiveClockDeps): LeadLiveClock

  // src/audio/playback/leadLiveClock.ts
  export function startLeadLiveClock(): () => void
  export function leadLiveInputStep(): number | null
  ```

**Steps:**

- [ ] **Step 1: Write the failing tests for the factory.**
  Append to `src/audio/leadLiveRecord.test.ts`, and add `createLeadLiveClock` to the existing `from './leadLiveRecord'` import list:
  ```ts
  describe('createLeadLiveClock', () => {
    const makeClock = (): {
      clock: ReturnType<typeof createLeadLiveClock>;
      world: { now: number | null; latency: number };
    } => {
      const world = { now: 0 as number | null, latency: 0 };
      const clock = createLeadLiveClock({
        now: () => world.now,
        outputLatency: () => world.latency,
      });
      return { clock, world };
    };

    test('has no answer until two anchors have arrived', () => {
      const { clock, world } = makeClock();
      world.now = 10.5;
      expect(clock.inputStep()).toBeNull();
      clock.anchor(32, 10.0);
      expect(clock.inputStep()).toBeNull();
      clock.anchor(33, 10.25);
      expect(clock.inputStep()).toBe(34);
    });

    test('subtracts the output latency it is handed, live', () => {
      const { clock, world } = makeClock();
      clock.anchor(32, 10.0);
      clock.anchor(33, 10.25);
      world.now = 10.63;
      expect(clock.inputStep()).toBe(35);
      world.latency = 0.02;
      expect(clock.inputStep()).toBe(34);
    });

    test('reset makes it silent again, so a stopped transport cannot answer', () => {
      const { clock, world } = makeClock();
      clock.anchor(32, 10.0);
      clock.anchor(33, 10.25);
      world.now = 10.5;
      expect(clock.inputStep()).toBe(34);
      clock.reset();
      expect(clock.inputStep()).toBeNull();
    });

    test('no context means no time, and therefore no answer', () => {
      const clock = createLeadLiveClock({ now: () => null, outputLatency: () => 0 });
      clock.anchor(32, 10.0);
      clock.anchor(33, 10.25);
      expect(clock.inputStep()).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/audio/leadLiveRecord.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'createLeadLiveClock' not found in module '.../src/audio/leadLiveRecord.ts'`. Note that the earlier `expect(src).not.toContain('import')` test must still pass — the factory adds no imports.

- [ ] **Step 3: Append the factory, then wire it to the engine.**
  At the end of `src/audio/leadLiveRecord.ts`:
  ```ts
  /** Everything the live clock needs from the outside world, as functions. */
  export interface LeadLiveClockDeps {
    /** The AudioContext's clock, or null when there is no context. */
    now: () => number | null;
    /** Seconds between the context reaching a time and the sound being heard. */
    outputLatency: () => number;
  }

  export interface LeadLiveClock {
    /** One clock dispatch: the step, and the time it will sound at. */
    anchor(step: number, time: number): void;
    /**
     * The quantised clock step for an input observed NOW, or null when there
     * is no running clock to quantise against. Null is the mode gate: it is
     * what tells the recorder to fall back to the cursor.
     */
    inputStep(): number | null;
    /** Drops every anchor. A stopped transport must not still have an answer. */
    reset(): void;
  }

  export function createLeadLiveClock(deps: LeadLiveClockDeps): LeadLiveClock {
    let anchors: ClockAnchor[] = [];
    return {
      anchor: (step, time) => {
        anchors = pushClockAnchor(anchors, { step, time });
      },
      inputStep: () => {
        const now = deps.now();
        if (now === null) return null;
        return quantiseInputStep(anchors, now, deps.outputLatency());
      },
      reset: () => {
        anchors = [];
      },
    };
  }
  ```
  Create `src/audio/playback/leadLiveClock.ts`:
  ```ts
  import { createLeadLiveClock, type LeadLiveClock } from '../leadLiveRecord';
  import {
    playbackNowSec,
    playbackOutputLatencySec,
    subscribePlaybackClock,
  } from './playbackEngine';

  /**
   * The one place the pure live clock meets the real engine.
   *
   * Deliberately NOT the components-layer stepPublisher: that is a whole
   * number published for a highlight, store/ may not import it, and live
   * capture needs sub-step resolution. The anchors come straight from the
   * clock, and the position is derived here from ctx.currentTime.
   */
  const clock: LeadLiveClock = createLeadLiveClock({
    now: playbackNowSec,
    outputLatency: playbackOutputLatencySec,
  });

  /**
   * Starts collecting anchors. Returns the stop function, which also clears
   * them — an anchor surviving a stop would let a press quantise against a
   * clock that is no longer running.
   *
   * Started and stopped with the transport rather than at boot: subscribing
   * the clock starts its 25 ms timer, so a permanent subscriber would keep
   * the shared clock alive for the life of the app.
   */
  export function startLeadLiveClock(): () => void {
    const unsubscribe = subscribePlaybackClock((step, _beat, time) => clock.anchor(step, time));
    return () => {
      unsubscribe();
      clock.reset();
    };
  }

  /** The quantised clock step for an input observed now; null if no clock. */
  export function leadLiveInputStep(): number | null {
    return clock.inputStep();
  }
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/audio/leadLiveRecord.test.ts
  bun run lint
  bun run eslint
  ```
  `eslint` must still be `0 errors` and no more than 325 warnings — the new audio module imports nothing from `store/` or `components/`.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/audio/leadLiveRecord.ts src/audio/leadLiveRecord.test.ts src/audio/playback/leadLiveClock.ts
  git commit -m "$(cat <<'EOF'
  feat(audio): follow the clock's last two anchors while the transport runs

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 4: The write head becomes an argument, and the transport stops refusing

`recordLeadNote` currently declines outright when `leadPlayer !== 'stopped'`. That branch goes: the slice no longer knows anything about players, it just writes wherever it is told, and the cursor is only the *default* write head. The gate moves to the bridge in Task 5.

**Files:**
- Modify: `src/store/types.ts`, `src/store/leadSlice.ts`
- Test: `src/store/leadSlice.test.ts`

**Interfaces:**
- Consumes: `clampLeadCursor`, `leadStoredIndexAt` from `src/audio/leadMelody.ts` (both already imported by the slice).
- Produces: `recordLeadNote: (note: string, column?: number) => boolean` — writes at `column` when given, at `leadCursor` otherwise; the column is clamped to the live loop window either way. Never moves `leadCursor`.

**Steps:**

- [ ] **Step 1: Replace the refusal test with the write-head tests.**
  In `src/store/leadSlice.test.ts`, **delete** this test (currently at line 533) — it asserts the DEV-370 behaviour this task deliberately changes:
  ```ts
  test('recording declines while the transport plays — that is DEV-374', () => {
    arm();
    useAppStore.setState({ leadPlayer: 'playing' });

    expect(useAppStore.getState().recordLeadNote('C4')).toBe(false);
    expect(at(0)).toEqual([]);
  });
  ```
  and put these three in its place:
  ```ts
  test('a column argument overrides the cursor — that is the live write head', () => {
    arm();
    useAppStore.getState().setLeadCursor(2);

    expect(useAppStore.getState().recordLeadNote('C4', 9)).toBe(true);

    expect(at(9)).toEqual([{ note: 'C4', len: 1 }]);
    expect(at(2)).toEqual([]);
    // The cursor is still the user's. The write head is a different thing.
    expect(useAppStore.getState().leadCursor).toBe(2);
  });

  test('a column past the loop end is clamped, never written out of bounds', () => {
    arm();
    expect(useAppStore.getState().recordLeadNote('C4', 999)).toBe(true);
    // 1-bar loop in 4/4 → columns 0..15.
    expect(at(15)).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('the transport playing no longer refuses the write — that is DEV-374', () => {
    arm();
    useAppStore.setState({ leadPlayer: 'playing' });

    expect(useAppStore.getState().recordLeadNote('C4', 4)).toBe(true);
    expect(at(4)).toEqual([{ note: 'C4', len: 1 }]);
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/store/leadSlice.test.ts
  ```
  Expected failures: `a column argument overrides the cursor` fails with `expect(received).toEqual(expected)` — `at(9)` is `[]` and `at(2)` holds the note, because the extra argument is ignored today. `the transport playing no longer refuses the write` fails with `expect(false).toBe(true)`.

- [ ] **Step 3: Take the column as an argument and drop the player guard.**
  In `src/store/types.ts`, change line 177 to:
  ```ts
  recordLeadNote: (note: string, column?: number) => boolean;
  ```
  In `src/store/leadSlice.ts`, replace the whole `recordLeadNote` implementation with:
  ```ts
    // Returns whether it actually wrote, so a caller can tell a captured note
    // from one the grid refused.
    //
    // `column` is the WRITE HEAD, and it is the caller's to choose: the record
    // bridge passes the clock-derived column while music plays and omits it
    // while nothing is, in which case the cursor is the write head. The slice
    // knows nothing about the transport — the old `leadPlayer !== 'stopped'`
    // refusal was replaced in DEV-374, not patched, because the honest rule is
    // about whether there is a clock to play along to, which is not this
    // slice's to answer.
    recordLeadNote: (note, column) => {
      const state = get();
      if (!state.leadRecording) return false;

      // Both guards exist to keep one promise: a recorded note is visible on
      // the grid the moment it is recorded. Storing what the grid cannot draw
      // would leave notes that play back but cannot be seen or erased.
      if (
        state.leadMelodyView === 'scale-locked' &&
        !isNoteInScale(note, state.scaleRoot, state.scaleType)
      ) {
        return false;
      }
      const octave = leadRecordOctave(
        note,
        state.leadMelodyOctave,
        LEAD_WINDOW_OCTAVES,
        LEAD_OCTAVE_MIN,
        LEAD_OCTAVE_MAX,
      );
      if (octave === null) return false;

      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      // Clamped whichever head it came from: a meter or loop-length change can
      // narrow the window under a column that was legal when it was chosen.
      const target = clampLeadCursor(column ?? state.leadCursor, state.leadLoopLength, stepsPerBar);
      if (octave !== state.leadMelodyOctave) set({ leadMelodyOctave: octave });
      // 'draw', never 'toggle': playing a note that is already at this column
      // must be a no-op, not a delete. A performer repeating a note expects
      // nothing to happen, not the note to vanish.
      paintLeadNote(leadStoredIndexAt(target, stepsPerBar), note, 'draw');
      return true;
    },
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/store/leadSlice.test.ts
  bun run lint
  ```
  `bun test src/store/leadRecord.test.ts` will still show its own DEV-374 refusal test failing — that one is Task 5's, and it is expected to be red between these two commits only if you run it; the slice's own suite must be fully green here.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/store/types.ts src/store/leadSlice.ts src/store/leadSlice.test.ts
  git commit -m "$(cat <<'EOF'
  feat(store): let a recorded note name the column it lands on

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 5: The bridge records in time, and holds notes for their length

The single `noteInputBus` subscriber gains three jobs: run the anchor collector for as long as there is music to play along to, resolve the write column from the clock, and turn a note-off into a length. The mode gate now reads "is there a running clock", which is what the DEV-370 `leadPlayer` guard should have said.

**Files:**
- Modify: `src/store/leadRecord.ts`
- Test: `src/store/leadRecord.test.ts`

**Interfaces:**
- Consumes: `subscribeNoteInput`; `clockStepToGridColumn`, `heldStepLength` (Task 2); `leadLiveInputStep`, `startLeadLiveClock` (Task 3); `leadStoredIndexAt` from `src/audio/leadMelody.ts`; `isPlayerActive` from `./transportSlice`; `recordLeadNote` (Task 4) and `setLeadNoteLength`.
- Produces:
  ```ts
  export interface LeadRecordDeps {
    inputStep: () => number | null;
    startClock: () => () => void;
  }
  export function leadClockActive(state: {
    metronomeActive: boolean;
    sequencerPlayer: PlayerState;
    chordsPlayer: PlayerState;
    leadPlayer: PlayerState;
  }): boolean
  export function startLeadRecordBridge(deps?: LeadRecordDeps): () => void
  ```
  The default `deps` is the real clock, so the `useEngineSync` call site (`startLeadRecordBridge()`) is unchanged.

**Steps:**

- [ ] **Step 1: Rewrite the test harness and the DEV-374 tests.**
  In `src/store/leadRecord.test.ts`, replace everything from the imports down to the end of `afterEach` with:
  ```ts
  import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
  import { useAppStore } from './store';
  import { startLeadRecordBridge, leadClockActive } from './leadRecord';
  import { emitNoteInput, resetNoteInputListeners } from '../audio/playback/noteInputBus';
  import { MAX_STEPS_PER_BAR } from '../utils/meter';
  import type { LeadNote } from '../audio/leadMelody';

  let stop: (() => void) | null = null;
  // The live clock, faked: the real one needs an AudioContext, and there is
  // none in this suite. `liveStep` null means "no running clock".
  let liveStep: number | null = null;
  let clockRuns = 0;

  const deps = {
    inputStep: (): number | null => liveStep,
    startClock: (): (() => void) => {
      clockRuns++;
      return () => {
        clockRuns--;
      };
    },
  };

  beforeEach(() => {
    liveStep = null;
    clockRuns = 0;
    useAppStore.setState({
      meterId: '4/4',
      leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
      leadLoopLength: 1,
      leadMelodyView: 'chromatic',
      leadMelodyOctave: 3,
      leadCursor: 0,
      leadRecording: true,
      leadPlayer: 'stopped',
      chordsPlayer: 'stopped',
      sequencerPlayer: 'stopped',
      metronomeActive: false,
      scaleRoot: 'C',
      scaleType: 'Major',
    });
    stop = startLeadRecordBridge(deps);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    resetNoteInputListeners();
  });

  const down = (note: string): void => emitNoteInput({ kind: 'on', note, velocity: 1 });
  const up = (note: string): void => emitNoteInput({ kind: 'off', note, velocity: 0 });
  const cursor = (): number => useAppStore.getState().leadCursor;
  const at = (col: number): string[] =>
    useAppStore.getState().leadMelodySteps[col].map((n) => n.note).sort();
  const lenAt = (col: number, note: string): number | undefined =>
    useAppStore.getState().leadMelodySteps[col].find((n) => n.note === note)?.len;
  ```
  Then **delete** this test (currently at line 85) — it asserts the DEV-370 behaviour this task deliberately changes:
  ```ts
  test('nothing is captured while the transport plays — that is DEV-374', () => {
    useAppStore.setState({ leadPlayer: 'playing' });

    down('C4');

    expect(at(0)).toEqual([]);
  });
  ```
  and add this describe block at the end of the file:
  ```ts
  describe('leadRecord bridge — live capture', () => {
    const play = (): void => useAppStore.setState({ leadPlayer: 'playing' });

    test('while music plays, the note lands on the clock column, not the cursor', () => {
      useAppStore.getState().setLeadCursor(2);
      play();
      liveStep = 9;

      down('C4');

      expect(at(9)).toEqual(['C4']);
      expect(at(2)).toEqual([]);
      // The playhead is the write head; the cursor stays where it was put.
      expect(cursor()).toBe(2);
    });

    test('a held note is extended to the number of steps it was held for', () => {
      play();
      liveStep = 4;
      down('C4');
      liveStep = 8;
      up('C4');

      expect(lenAt(4, 'C4')).toBe(4);
    });

    test('a tap stays one step long', () => {
      play();
      liveStep = 4;
      down('C4');
      up('C4');

      expect(lenAt(4, 'C4')).toBe(1);
    });

    test('a key repeat cannot re-date the note-on that is still held', () => {
      play();
      liveStep = 4;
      down('C4');
      liveStep = 6;
      down('C4');
      liveStep = 8;
      up('C4');

      expect(lenAt(4, 'C4')).toBe(4);
    });

    test('the clock step wraps into the loop before it becomes a column', () => {
      play();
      liveStep = 37; // 16-column loop: 37 % 16 = 5.

      down('C4');

      expect(at(5)).toEqual(['C4']);
    });

    test('with the clock running but no anchors yet, the cursor is still the write head', () => {
      // liveStep stays null: two anchors have not arrived, so there is nothing
      // to quantise against and the DEV-370 behaviour stands rather than the
      // note being dropped.
      play();
      useAppStore.getState().setLeadCursor(3);

      down('C4');

      expect(at(3)).toEqual(['C4']);
    });

    test('the anchor collector runs exactly while there is music to play along to', () => {
      expect(clockRuns).toBe(0);
      play();
      expect(clockRuns).toBe(1);
      useAppStore.setState({ leadPlayer: 'stopped' });
      expect(clockRuns).toBe(0);

      // Drums alone count: the user is plainly playing along to something, and
      // the old leadPlayer guard called that "stopped".
      useAppStore.setState({ sequencerPlayer: 'playing' });
      expect(clockRuns).toBe(1);
      useAppStore.setState({ sequencerPlayer: 'stopped' });
      expect(clockRuns).toBe(0);

      // So does the metronome — it is the same clock, and it is what a player
      // counts against when nothing else is running.
      useAppStore.setState({ metronomeActive: true });
      expect(clockRuns).toBe(1);
    });

    test('unsubscribing stops the anchor collector too', () => {
      play();
      expect(clockRuns).toBe(1);
      stop?.();
      stop = null;
      expect(clockRuns).toBe(0);
    });
  });

  describe('leadClockActive', () => {
    type ClockState = Parameters<typeof leadClockActive>[0];
    const clockState = (patch: Partial<ClockState>): ClockState => ({
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      metronomeActive: false,
      ...patch,
    });

    test('is false only when nothing at all is running', () => {
      expect(leadClockActive(clockState({}))).toBe(false);
    });

    test('any single running player is enough', () => {
      expect(leadClockActive(clockState({ leadPlayer: 'playing' }))).toBe(true);
      expect(leadClockActive(clockState({ chordsPlayer: 'playing' }))).toBe(true);
      expect(leadClockActive(clockState({ sequencerPlayer: 'playing' }))).toBe(true);
      expect(leadClockActive(clockState({ metronomeActive: true }))).toBe(true);
    });

    test('a player still stopping still owns the clock', () => {
      expect(leadClockActive(clockState({ leadPlayer: 'stopping' }))).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/store/leadRecord.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'leadClockActive' not found in module '.../src/store/leadRecord.ts'`.

- [ ] **Step 3: Rewrite the bridge.**
  Replace the whole of `src/store/leadRecord.ts` with:
  ```ts
  import { subscribeNoteInput } from '../audio/playback/noteInputBus';
  import { leadStoredIndexAt } from '../audio/leadMelody';
  import { clockStepToGridColumn, heldStepLength } from '../audio/leadLiveRecord';
  import { leadLiveInputStep, startLeadLiveClock } from '../audio/playback/leadLiveClock';
  import { getMeter } from '../utils/meter';
  import { isPlayerActive } from './transportSlice';
  import { useAppStore } from './store';
  import type { PlayerState } from './types';

  /**
   * Is there music to play along to?
   *
   * The DEV-370 guard was `leadPlayer !== 'stopped'`, which meant that playing
   * only the drums and then pressing a key wrote to a static cursor while the
   * beat ran. The rule should fit in one sentence — if music is playing,
   * record in time; if not, record at the cursor — and the metronome counts,
   * because it runs on the same clock and is exactly what a player counts
   * against when nothing else is going.
   */
  export function leadClockActive(state: {
    metronomeActive: boolean;
    sequencerPlayer: PlayerState;
    chordsPlayer: PlayerState;
    leadPlayer: PlayerState;
  }): boolean {
    return (
      state.metronomeActive ||
      isPlayerActive(state.sequencerPlayer) ||
      isPlayerActive(state.chordsPlayer) ||
      isPlayerActive(state.leadPlayer)
    );
  }

  /** The real live clock. Injectable so the bridge is testable without one. */
  export interface LeadRecordDeps {
    inputStep: () => number | null;
    startClock: () => () => void;
  }

  const REAL_CLOCK: LeadRecordDeps = {
    inputStep: leadLiveInputStep,
    startClock: startLeadLiveClock,
  };

  interface HeldNote {
    /** The RAW clock step of the press — never wrapped, so a note held across
     *  the loop seam still yields a positive length. */
    onStep: number;
    /** Where the note went in, so note-off knows what to extend. */
    storedIndex: number;
  }

  /**
   * The bridge from performed notes to the melody grid.
   *
   * ONE subscriber, not a call bolted onto each input source. The bus already
   * settled which events count as somebody playing (see noteInputBus), so this
   * module only has to answer what to do with them — and answering it once is
   * why the computer keyboard, the on-screen keyboard and MIDI all behave the
   * same without three copies of this rule.
   *
   * The cursor never moves, in either mode. Stopped, it IS the write head, so
   * notes played together land together and a key repeat writes nothing new.
   * Playing, the clock is the write head and the cursor is simply left where
   * the user put it — which is what makes "stop returns the marker to where
   * you put it" free, with no save-and-restore step to get wrong.
   */
  export function startLeadRecordBridge(deps: LeadRecordDeps = REAL_CLOCK): () => void {
    const held = new Map<string, HeldNote>();
    let stopClock: (() => void) | null = null;

    // The collector is started and stopped with the music, not at boot:
    // subscribing the shared clock starts its timer, so a permanent
    // subscriber would keep it alive for the life of the app.
    const syncClock = (active: boolean): void => {
      if (active === (stopClock !== null)) return;
      if (active) {
        stopClock = deps.startClock();
        return;
      }
      stopClock?.();
      stopClock = null;
      // A note still down when the transport stops has no length to compute
      // against, and its release must not extend anything later.
      held.clear();
    };

    const unsubscribeTransport = useAppStore.subscribe(leadClockActive, syncClock, {
      fireImmediately: true,
    });

    const unsubscribeInput = subscribeNoteInput((event) => {
      if (event.kind === 'off') {
        const entry = held.get(event.note);
        if (!entry) return;
        held.delete(event.note);
        const offStep = deps.inputStep();
        if (offStep === null) return;
        const len = heldStepLength(entry.onStep, offStep);
        // setLeadNoteLength owns all three length invariants, including the
        // clamp against the loop end — so a note held across the seam is
        // truncated rather than wrapped, with no special case here.
        if (len > 1) useAppStore.getState().setLeadNoteLength(entry.storedIndex, event.note, len);
        return;
      }

      const state = useAppStore.getState();
      const clockStep = deps.inputStep();
      if (clockStep === null) {
        // No running clock: the cursor is the write head, and there is no step
        // count to give the note a length with, so it stays one step long.
        state.recordLeadNote(event.note);
        return;
      }
      // A key repeat must not re-date a press that is still down.
      if (held.has(event.note)) return;

      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const column = clockStepToGridColumn(clockStep, state.leadLoopLength * stepsPerBar);
      // The note goes in at len 1 immediately, so it appears on the grid the
      // moment it is played; note-off extends it.
      if (!state.recordLeadNote(event.note, column)) return;
      held.set(event.note, {
        onStep: clockStep,
        storedIndex: leadStoredIndexAt(column, stepsPerBar),
      });
    });

    return () => {
      unsubscribeInput();
      unsubscribeTransport();
      syncClock(false);
    };
  }
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/store/leadRecord.test.ts
  bun test src/store/leadSlice.test.ts
  bun test src/store/engineSync.test.ts
  bun run lint
  bun run eslint
  ```
  All green, `0 errors`, no more than 325 warnings.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/store/leadRecord.ts src/store/leadRecord.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): record played notes in time while the transport runs (DEV-374)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 6: Hand-verify DEV-374 against a running transport, and record what changed

The spec is explicit: this feature area's history is a fully green suite that proved nothing about whether a gesture worked. Hand verification is required, not optional. The note-input rule also gains a line, because a note-off now carries data.

**Files:**
- Modify: `.claude/rules/note-input.md`
- Test: none — this task adds no code.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: no code. A documented rule and a verified gesture.

**Steps:**

- [ ] **Step 1: Run the whole gate.**
  ```bash
  bun run verify
  ```
  Must be green, with `bun run eslint` reporting `0 errors` and no more than 325 warnings.

- [ ] **Step 2: Hand-verify against a running transport.**
  ```bash
  bun run dev
  ```
  Then, in the browser, work through every line and confirm each before moving on:
  1. Click once to create the AudioContext. Arm the lead recorder (the record toggle on the melody grid).
  2. Press Play on the sequencer only (drums, lead stopped). Play four notes on the QWERTY keyboard on the beat. **Expect:** each note appears on the column it was heard on, not at the cursor, and the cursor has not moved.
  3. Hold one key for roughly a bar. **Expect:** the note appears at length 1 the instant the key goes down, and extends to its held length when released.
  4. Hold a key across the loop end. **Expect:** the note is truncated at the last column, never wrapped to column 0.
  5. Change the bpm mid-take from 90 to 150 and keep playing. **Expect:** notes keep landing on the column they are heard on — this is the measured step duration doing its job.
  6. Play the same pitch twice on the same column. **Expect:** nothing happens the second time; the note is not deleted.
  7. Stop the transport. Play a note. **Expect:** it lands at the cursor exactly as it did before this change, and the cursor is still where you left it.
  8. Turn the metronome on with every player stopped. Play a note. **Expect:** it lands in time, on the click.

- [ ] **Step 3: Record the new rule.**
  In `.claude/rules/note-input.md`, add this to the `## Rules` section, after the "Emit after the sound is scheduled, never before." rule:
  ```md
  **A note-off is data now, not just a release.** Live capture (DEV-374) reads
  the gap between a note's on and its off, quantised in steps, and extends the
  written note through `setLeadNoteLength`. A source that plays a note but
  never announces the release therefore records a one-step note — audible,
  visible, and silently wrong. Announce both edges.
  ```
  And in the `## What is not carried` section, after the velocity paragraph:
  ```md
  The bus's `time` is likewise not what the recorder quantises against. It is
  whatever the source scheduled at, and only some sources name one; the
  recorder reads `ctx.currentTime` itself, through
  `audio/playback/leadLiveClock.ts`, and subtracts the output latency there.
  ```

- [ ] **Step 4: Commit.**
  ```bash
  git add .claude/rules/note-input.md
  git commit -m "$(cat <<'EOF'
  docs: record that a note-off now carries a note's length (DEV-374)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 7: One column, picked from whichever source is live

The merge is in the semantics and the pixels only. `leadCursor` stays in the store and `stepPublisher` stays outside it — writing the running step into `leadCursor` would re-render every mounted view 8-16 times a second *and* run the persist serialiser on top.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts`
- Create: `src/components/loop/lead/useLeadMarker.ts`
- Test: `src/components/loop/lead/melodyGrid.test.ts`

**Interfaces:**
- Consumes: `useCurrentStep` from `src/components/playbackStep.ts`, `leadCursor` from the store.
- Produces:
  ```ts
  // melodyGrid.ts
  export function leadMarkerColumn(
    isPlaying: boolean,
    currentStep: number,
    cursor: number,
    columns: number,
  ): number

  // useLeadMarker.ts
  export function useLeadMarkerColumn(isPlaying: boolean, columns: number): number
  ```

**Steps:**

- [ ] **Step 1: Write the failing test.**
  Append to `src/components/loop/lead/melodyGrid.test.ts`, and add `leadMarkerColumn` to the existing `from './melodyGrid'` import list:
  ```ts
  describe('leadMarkerColumn', () => {
    test('stopped, the marker is the cursor — the user placed it there', () => {
      expect(leadMarkerColumn(false, 7, 3, 16)).toBe(3);
    });

    test('playing, the marker is the clock — and the cursor is untouched', () => {
      expect(leadMarkerColumn(true, 7, 3, 16)).toBe(7);
    });

    test('stopping returns the marker to where the cursor was left', () => {
      // Free, because leadCursor was never written during playback: there is
      // no save-and-restore step here to get wrong.
      expect(leadMarkerColumn(true, 11, 3, 16)).toBe(11);
      expect(leadMarkerColumn(false, 11, 3, 16)).toBe(3);
    });

    test('a column outside the live window lands on the edge, not off the grid', () => {
      // A meter or loop-length change can narrow the window under either
      // source between one render and the next.
      expect(leadMarkerColumn(false, 0, 99, 16)).toBe(15);
      expect(leadMarkerColumn(true, -4, 0, 16)).toBe(0);
    });

    test('a grid with no columns has column 0 and nothing else', () => {
      expect(leadMarkerColumn(false, 0, 5, 0)).toBe(0);
    });

    test('a non-finite source is column 0, never NaN pixels', () => {
      expect(leadMarkerColumn(false, 0, Number.NaN, 16)).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'leadMarkerColumn' not found in module '.../src/components/loop/lead/melodyGrid.ts'`.

- [ ] **Step 3: Write the function and the hook.**
  Append to `src/components/loop/lead/melodyGrid.ts`:
  ```ts
  /**
   * The one column the grid marks: the clock while playing, the cursor while
   * stopped. Kept as a pure function of both sources rather than as one stored
   * value, because the running step lives outside zustand on purpose — holding
   * it in React state re-rendered whole views 8-16 times a second, including
   * views on hidden tabs (see the note at the top of components/playbackStep.ts),
   * and writing it into leadCursor would add the persist serialiser to that.
   */
  export function leadMarkerColumn(
    isPlaying: boolean,
    currentStep: number,
    cursor: number,
    columns: number,
  ): number {
    const raw = isPlaying ? currentStep : cursor;
    if (!Number.isFinite(raw)) return 0;
    return Math.min(Math.max(0, columns - 1), Math.max(0, Math.round(raw)));
  }
  ```
  Create `src/components/loop/lead/useLeadMarker.ts`:
  ```ts
  import { useAppStore } from '../../../store/store';
  import { useCurrentStep } from '../../playbackStep';
  import { leadMarkerColumn } from './melodyGrid';

  /**
   * The marker's column, from whichever source is live. The two sources are
   * deliberately NOT merged into one stored value: stepPublisher stays outside
   * zustand so the re-render lands on the leaf that draws the marker, and
   * leadCursor stays in the store so a header click during playback still
   * takes effect the moment the transport stops.
   *
   * Note the renderToString trap: zustand serves the creation-time state as
   * the server snapshot, so a test that sets leadCursor and renders the grid
   * sees column 0. Marker geometry is tested through LeadMarker's own prop.
   */
  export function useLeadMarkerColumn(isPlaying: boolean, columns: number): number {
    const currentStep = useCurrentStep('lead');
    const cursor = useAppStore((s) => s.leadCursor);
    return leadMarkerColumn(isPlaying, currentStep, cursor, columns);
  }
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  bun run lint
  ```

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts src/components/loop/lead/useLeadMarker.ts
  git commit -m "$(cat <<'EOF'
  feat(ui): pick the melody grid's marked column from whichever source is live

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 8: A ruler you can hit

The bar and step strips are thin `text-[8px]` / `text-[9px]` bands today. They grow to a grid row cell's height — `h-5`, the same class the cells and the note-name buttons use — so a bar or a beat is an easy target. The DEV-371 `aria-pressed` / `aria-label` contract and the arrow-key navigation survive unaltered.

**Files:**
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx` (`LeadMelodyHeaders` only)
- Test: `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `LEAD_CELL_WIDTH`, `leadCursorKeyTarget` — both unchanged.
- Produces: no new exports. `LeadMelodyHeaders` keeps its exact props: `{ stepsPerBar, columns, cellsPerBar, cursor, selectedBar, onSelectColumn }`.

**Steps:**

- [ ] **Step 1: Write the failing test.**
  In `src/components/loop/lead/LeadMelodyGrid.test.tsx`, add to the `describe('LeadMelodyHeaders', ...)` block:
  ```ts
  test('both strips are a full grid row tall, and the DEV-371 contract survives it', () => {
    const html = renderToString(<LeadMelodyHeaders {...headerProps(16, 5)} />);
    // h-5 is the grid row cell's height (LeadMelodyCells and the note-name
    // column both use it), so a bar or a beat is an easy pointer target.
    expect(html.split('h-5 flex items-center justify-center').length - 1).toBe(32);
    // Everything DEV-371 delivered, unchanged: every column is a real button,
    // every button is labelled, the selected bar and the cursor column are the
    // pressed ones, and the arrow-key handler is still on both strips.
    expect(html.split('<button').length - 1).toBe(32);
    expect(html).toContain('aria-label="Bar 1"');
    expect(html).toContain('aria-label="Bar 1 step 6"');
    expect(html.split('aria-pressed="true"').length - 1).toBe(meter.stepsPerBar + 1);
    expect(html.split('width:20px').length - 1).toBe(32);
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  ```
  Expected failure: `expect(received).toBe(expected)` — `0` received for the `h-5 flex items-center justify-center` count, expected `32`.

- [ ] **Step 3: Grow both strips.**
  In `src/components/loop/lead/LeadMelodyGrid.tsx`, in the bar-number strip, replace:
  ```tsx
                className={`text-[8px] leading-none text-center font-bold ${
  ```
  with:
  ```tsx
                className={`h-5 flex items-center justify-center text-[8px] leading-none font-bold ${
  ```
  and in the beat-number strip, replace:
  ```tsx
                className={`text-[9px] leading-none text-center ${
  ```
  with:
  ```tsx
                className={`h-5 flex items-center justify-center text-[9px] leading-none ${
  ```
  Add this comment immediately above the `{/* Bar-number header ... */}` line:
  ```tsx
      {/* Both strips are h-5 — one grid row cell tall — so a bar and a beat
          are pointer targets rather than 8px bands. The widths stay
          LEAD_CELL_WIDTH, the same constant the marker's translateX strides
          by: a marker that drifts from its own ruler is worse than two
          honest markers. */}
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  bun test src/components/loop/lead/melodyGrid.test.ts
  bun run lint
  ```
  `melodyGrid.test.ts` is run explicitly to confirm the keyboard-navigation target function (`leadCursorKeyTarget`) is untouched — the handler that calls it was not edited, and its tests must pass without modification.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui): make the melody grid's bar and beat ruler a full row tall (DEV-377)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 9: One marker, drawn across the ruler and the grid

`LeadPlayhead` becomes `LeadMarker`: always rendered, positioned from the merged column, and spanning the header strips as well as the body so the ruler and the marker read as one thing. The step strip's `bg-secondary` cursor band goes — it was the second marker — while its `aria-pressed` stays, because that is the button's selection state, not its pixels.

**Files:**
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx`
- Test: `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `useLeadMarkerColumn` (Task 7), `LEAD_CELL_WIDTH`, `LABEL_WIDTH`.
- Produces:
  ```ts
  export const LeadMarker: React.FC<{ column: number }>
  ```
  `LeadPlayhead` is removed. `useCurrentStep` is no longer imported by `LeadMelodyGrid.tsx` — the hook owns that read now.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  In `src/components/loop/lead/LeadMelodyGrid.test.tsx`, change the component import to:
  ```tsx
  import { LeadMelodyHeaders, LeadMelodyGrid, LeadMarker } from './LeadMelodyGrid';
  ```
  **Delete** these two tests from the `describe('LeadMelodyGrid', ...)` block — they assert the two-marker rendering this task replaces:
  ```tsx
  test('the playhead overlay translates by step × cell width', () => {
    expect(renderToString(<LeadPlayhead currentStep={3} />)).toContain('translateX(60px)'); // 3 × 20
    expect(renderToString(<LeadPlayhead currentStep={0} />)).toContain('translateX(0px)');
  });

  test('a stopped lead player renders no playhead at all', () => {
    // The store's lead player is 'stopped' by default, and LeadMelodyGrid now
    // owns useLeadPlayback, so this is the real stopped rendering.
    expect(renderToString(<LeadMelodyGrid />)).not.toContain('ring-inset ring-primary');
  });
  ```
  and put these in their place:
  ```tsx
  test('the marker translates by column × cell width, from the ruler onward', () => {
    // The stride is LEAD_CELL_WIDTH, the same constant the header buttons size
    // themselves with — a marker that drifts from its own ruler is worse than
    // two honest markers. `left` is the note-name column's width.
    const html = renderToString(<LeadMarker column={3} />);
    expect(html).toContain('translateX(60px)'); // 3 × 20
    expect(html).toContain('left:44px');
    expect(renderToString(<LeadMarker column={0} />)).toContain('translateX(0px)');
  });

  test('a stopped grid still draws the marker, parked on the cursor', () => {
    // One marker, always. Stopped it is the cursor (0 by default under
    // renderToString), playing it is the clock — but it never disappears, and
    // the header strip no longer draws a second band of its own.
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('ring-inset ring-primary');
    expect(html).toContain('translateX(0px)');
    expect(html).not.toContain('bg-secondary text-secondary-content');
  });
  ```
  Then, in the `describe('LeadMelodyHeaders', ...)` block, replace the body of `'the whole selected bar is pressed, and exactly one column is the cursor'` with:
  ```tsx
  test('the whole selected bar is pressed, and exactly one column is the cursor', () => {
    // The bar strip marks every column of the selected bar so the band reads
    // as one target; the beat strip marks the single cursor column. The
    // cursor's PIXELS belong to the marker now (DEV-377), so the strip carries
    // only the a11y state.
    const html = renderToString(<LeadMelodyHeaders {...headerProps(32, 20)} />);
    expect(html.split('aria-pressed="true"').length - 1).toBe(meter.stepsPerBar + 1);
    expect(html).toContain('bg-primary/20 text-primary');
    expect(html).not.toContain('bg-secondary');
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  ```
  Expected failure: `SyntaxError: Export named 'LeadMarker' not found in module '.../src/components/loop/lead/LeadMelodyGrid.tsx'`.

- [ ] **Step 3: Replace the playhead with the marker.**
  In `src/components/loop/lead/LeadMelodyGrid.tsx`:

  a. Replace the `LeadPlayhead` component and its doc comment with:
  ```tsx
  /**
   * The one marker. Not two: the selection cursor and the playback playhead
   * both meant "this column", so they are drawn once, the way a DAW does —
   * except that this marker is also the column pointer recording writes at.
   *
   * Split out with an explicit prop so the geometry stays unit-testable:
   * renderToString cannot force a playing store state (zustand v5 serves
   * selector(api.getInitialState()) as the server snapshot — see
   * ui/BottomInputDock.tsx:9-21).
   *
   * It spans the header strips as well as the body, so it is offset by the
   * note-name column's width and strides by LEAD_CELL_WIDTH — the same
   * constant the header buttons size themselves with.
   */
  export const LeadMarker: React.FC<{ column: number }> = ({ column }) => (
    <div
      className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
      style={{
        width: LEAD_CELL_WIDTH,
        left: LABEL_WIDTH,
        transform: `translateX(${column * LEAD_CELL_WIDTH}px)`,
      }}
    />
  );
  ```

  b. Remove the `useCurrentStep` import line (`import { useCurrentStep } from '../../playbackStep';`) and add:
  ```tsx
  import { useLeadMarkerColumn } from './useLeadMarker';
  ```

  c. In `LeadMelodyGrid`, replace `const currentStep = useCurrentStep('lead');` with nothing, and add this immediately after the `const columns = leadLoopLength * stepsPerBar;` line:
  ```tsx
    const markerColumn = useLeadMarkerColumn(isPlaying, columns);
  ```

  d. In the beat-number strip, drop the cursor band but keep `aria-pressed`. Replace:
  ```tsx
                className={`h-5 flex items-center justify-center text-[9px] leading-none ${
                  col === cursor
                    ? 'bg-secondary text-secondary-content'
                    : 'text-base-content/50'
                }`}
  ```
  with:
  ```tsx
                // aria-pressed stays: it is the button's SELECTION state, and
                // DEV-371's contract does not change. Only the band goes —
                // the marker is the one thing that says "this column" now.
                className="h-5 flex items-center justify-center text-[9px] leading-none text-base-content/50"
  ```

  e. Make the headers and the body share one positioning context, and draw the marker across both. Replace:
  ```tsx
          <div className="w-fit mx-auto">
  ```
  with:
  ```tsx
          <div className="w-fit mx-auto relative">
  ```
  Replace:
  ```tsx
                <div className="relative shrink-0">
                  <LeadMelodyCells
  ```
  with:
  ```tsx
                <div className="shrink-0">
                  <LeadMelodyCells
  ```
  and replace:
  ```tsx
                  {isPlaying && <LeadPlayhead currentStep={currentStep} />}
                </div>
              </div>
            </div>
  ```
  with:
  ```tsx
                </div>
              </div>

              {/* Last child of the w-fit container, so it spans the ruler and
                  the grid body as one column. */}
              <LeadMarker column={markerColumn} />
            </div>
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  bun test src/components/loop/lead/useLeadPlayback.test.ts
  bun test src/components/playbackStep.test.ts
  bun run lint
  bun run eslint
  ```
  `0 errors`, no more than 325 warnings. `isPlaying` from `useLeadPlayback()` is still consumed (by `useLeadMarkerColumn`), so no unused-variable warning appears.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui): draw one marker for the cursor and the playhead (DEV-377)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 10: The gate, and a hand check of the marker

No new code. The branch is done when this task is done, and not before.

**Files:** none.

**Interfaces:** none.

**Steps:**

- [ ] **Step 1: Run the full gate.**
  ```bash
  bun run verify
  ```
  Every part must pass: `bun test`, `bun run lint`, `bun run eslint` (`0 errors`, no more than 325 warnings), `bun run check:keys`, `bun run check:drums`, `bun run build`.

- [ ] **Step 2: Hand-verify the marker.**
  ```bash
  bun run dev
  ```
  Confirm each of these in the browser before claiming the branch is finished:
  1. Stopped: exactly one marker on the grid, sitting on the cursor. Click a step in the beat strip — the marker moves there. Arrow-key left and right — it moves with the focus. Shift+Arrow jumps a bar.
  2. The bar and beat strips are as tall as a grid row and are comfortable to click.
  3. Play the lead. The marker follows the clock, and it lines up with the ruler column above it at every step — no drift at the right-hand end of a 4-bar loop.
  4. While playing, click a different step in the ruler. **Expect:** nothing visibly moves (the marker is the clock's), and the moment you stop, the marker is on the column you clicked.
  5. Stop. **Expect:** the marker returns to where you put the cursor, not to column 0.
  6. Arm recording, play the lead, play a few notes. **Expect:** the notes land on the marked column as it passes.

- [ ] **Step 3: If anything in step 1 or 2 failed, fix it and commit the fix.**
  Stage only the files you changed, by name, and use a conventional-commit subject describing the behaviour restored. End the message with the two trailer lines:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  ```
  Then re-run `bun run verify` and repeat step 2.

---

## Known gaps, stated rather than hidden

- **A drums-only transport records in time but the marker does not move.** `useLeadPlayback` publishes a step only for steps the *lead* actually sounds, so with the lead stopped there is nothing for the marker to follow, while `leadClockActive` is true and capture is live. This is the honest consequence of the two sources the spec insists on keeping separate; closing it needs a second publisher and is not in this scope.
- **DEV-375, adjustable step resolution, is excluded** — it is a storage-width change (`MAX_STEPS_PER_BAR`), a persist `version` bump and a project `formatVersion` bump. `measuredStepDurationSec` and `clockStepToGridColumn` exist precisely so this work does not have to be redone when it lands.
- **Velocity is still not stored on a note.** It reaches the bus and the recorder, and stops there, for the same two-version-bump reason.
