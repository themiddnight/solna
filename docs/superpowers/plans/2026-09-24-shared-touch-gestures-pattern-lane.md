# Shared Touch Gestures for the Chord/Bass Pattern Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the custom Chord/Bass lane the Lead/FX touch model (tap activates on lift, swipe scrolls without writing, long-press on an event resizes it) through one shared classifier, session and listener module, and widen its columns to a 28px floor.

**Architecture:** Three DOM-free or DOM-thin modules move to the `src/components/` root. `touchGesture.ts` holds the classifier, moved from Lead with generic names. `touchGestureSession.ts` holds one finger's lifecycle over a `{ tap, hold }` target, plus `resizeHold`. `useTouchGestureListeners.ts` holds the lifetime window and element listeners. Lead's `leadTouchSession.ts` becomes a thin adapter over the core, and its tests do not change. A new pure `loop/chord/patternTouch.ts` adapter, a colocated `usePatternTouch.ts` hook and a click filter wire the lane. Mouse and pen stay as they are on both grids.

**Tech Stack:** React 19 + TypeScript, Tailwind + daisyUI classes, Bun test runner (`bun:test`, no DOM), ESLint, Knip.

**Spec:** `docs/superpowers/specs/2026-09-24-shared-touch-gestures-pattern-lane-design.md`

## Global Constraints

- Branch `feat/enhance-beat-pattern-ui`. One conventional commit per task. Every message ends with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- `TOUCH_LONG_PRESS_MS = 300` and `TOUCH_SLOP_PX = 8`. A tap lifts before 300ms having moved less than 8px. A swipe moves 8px or more before 300ms. A long-press reaches 300ms inside the slop. The reducer checks cancel, then time, then distance.
- Lift rule, both grids: after a long-press, a lift on an empty cell adds that cell, and a lift on a note or event changes nothing.
- Mouse and pen are unchanged on both grids. Lead drag-paints on `pointerdown`; Chord/Bass activates on `click` and drags the handle. The only branch is `pointerType === 'touch'`.
- `PATTERN_CELL_MIN_WIDTH = 28`, `PATTERN_STEP_PX = 28`. The lane height stays `h-9`. Lead's look is unchanged.
- R125: a span resize commits once on `pointerup`, writes nothing on cancel, and keeps its preview in local state. Touch reaches the same `useSpanResize` as the mouse.
- R016: no gesture state in a zustand slice. R212: pointer code writes only through the existing `onActivate`, `onResize` and paint-controller calls.
- No ad-hoc window listeners in components. The only window listeners are `useSpanResize`'s and `useTouchGestureListeners`'s.
- R266 and `testing.md`: no DOM and no testing-library. Every decision sits behind a pure factory with a fake clock and scheduler. Markup is checked with `renderToString`, props passed directly.
- **Lead regression contract:** `leadTouchSession.test.ts`, `leadPaint.test.ts` and `useLeadNoteResize.test.ts` keep every expectation. Only imports and the renamed constant may change (Task 1). A changed expectation is a regression, not an update.
- Per-task gate: the task's `bun test <files>`, then `bun run lint`, then `bun run eslint` with **zero errors and zero warnings**. Never ignore a warning (R005/R264). Fix it, or add a line-level `eslint-disable-next-line <rule> -- <reason>`.
- ESLint `max-lines-per-function` is 100 code lines and applies to test `describe` callbacks too. `complexity` warns above 20.
- Knip: export only what another file (a test included) imports. Tasks 2 and 3 add shared files that nothing shipped imports yet, so `check:dead-code:production` reports them as unused files until Task 4. From Task 4 on, both Knip scans must report zero.
- Rules and ADRs record no version numbers and no line numbers.
- Out of scope: unifying mouse behaviour, the Beat grid, multi-column paint on the lane, drawing a span by dragging across empty columns, a wider mouse hit area for the lane handle.

## Review Focus

1. **A hybrid device: a finger touch, then a mouse click on the lane.** The click must activate. The mouse `pointerdown`, seen in the grid's capture phase, clears the touch flag. Pinned in Task 6: "a mouse pointerdown clears the flag, so a mouse click activates".
2. **Keyboard or assistive-technology activation after a touch** (`detail === 0`). It is always honoured. Pinned in Task 6: "after a touch pointerdown, a detail-1 click is dropped and a detail-0 click passes".
3. **The lane unmounting mid-resize** (a switch to a preset pattern, or a layout switch, R316). It writes nothing and leaves no live resize. Pinned in Task 6: "dispose mid-resize cancels it and writes nothing". Task 3 pins that `detach` calls `dispose`.
4. **A long-press on an empty column followed by a drag.** A user may expect it to draw. It writes nothing, and the session closes past the slop so the finger returns to the browser and no stale session swallows later input. Pinned in Task 2 ("a move past the slop closes it and writes nothing") and Task 6 ("a long-press on an empty column then a drag writes nothing").
5. **A long-press timer from a closed gesture firing into the next finger's gesture** (a late `setTimeout`). It must do nothing. Pinned in Task 2: "a timer from a closed gesture does nothing to the next one".

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/touchGesture.ts` | **create** | pure classifier: `TOUCH_LONG_PRESS_MS`, `TOUCH_SLOP_PX`, `touchGestureStart`, `touchGestureReduce` |
| `src/components/touchGestureSession.ts` | **create** | pure one-finger lifecycle over a `{ tap, hold }` target; `resizeHold` |
| `src/components/useTouchGestureListeners.ts` | **create** | pure `attachTouchGestureListeners`, the `useTouchGestureListeners` hook, `browserTouchClock` |
| `src/components/loop/lead/leadTouchGesture.ts` | modify | keeps only `leadCellAtPoint` and `LeadGridGeometry` |
| `src/components/loop/lead/leadTouchSession.ts` | modify | Lead adapter: tap = one-cell stroke; hold = paint hold or `resizeHold` |
| `src/components/loop/lead/useLeadNotePaint.ts` | modify | listeners through `useTouchGestureListeners`; clock through `browserTouchClock` |
| `src/components/loop/chord/patternTouch.ts` | **create** | pure lane adapter: `createPatternTouchTarget`, `createPatternTouchHandlers`, `createPatternClickFilter`, `PatternSpanIdentity`, `PatternTouchCell` |
| `src/components/loop/chord/usePatternTouch.ts` | **create** | builds target, session and filter once; attaches the shared listeners |
| `src/components/loop/chord/CustomPatternTimeline.tsx` | modify | 28px floor and fallback; scroller and grid touch classes; handle loses `touch-none`; touch wiring; head renderer split out |
| Tests | create or modify | `touchGesture.test.ts`, `touchGestureSession.test.ts`, `useTouchGestureListeners.test.ts`, `patternTouch.test.ts` (new); `leadTouchGesture.test.ts`, `leadTouchSession.test.ts` (imports only), `CustomPatternTimeline.test.tsx` (modified) |
| `.claude/rules/pattern-grids.md`, `docs/decisions/0050-melody-grid-touch-gestures.md`, `docs/decisions/README.md`, `CLAUDE.md` | modify | R343 widened, ADR-0050 amended in place, index row, rules-table row |

Task 5 (visuals) and Task 6 (behaviour) stay separate: a reviewer can reject the 28px floor or the scroller classes without touching the gesture wiring. The handle's `touch-none` removal moves from the visuals task into Task 6. Without the touch routing, a handle with no `touch-action` would still start its drag on a finger `pointerdown`, and the browser would then take the pan and cancel it. The two changes land in one commit so no intermediate commit has that state.

---

### Task 1: Shared classifier at the components root

Read first: `.claude/rules/components.md` (R276 placement), `.claude/rules/testing.md`, `src/components/loop/lead/leadTouchGesture.ts`.

**Files:**
- Create: `src/components/touchGesture.ts`
- Create: `src/components/touchGesture.test.ts`
- Modify: `src/components/loop/lead/leadTouchGesture.ts` (drop the classifier; keep `LeadGridGeometry`, `leadCellAtPoint`)
- Modify: `src/components/loop/lead/leadTouchGesture.test.ts` (drop the two reducer `describe`s; keep `leadCellAtPoint`)
- Modify: `src/components/loop/lead/leadTouchSession.ts` (imports and renamed identifiers only)
- Modify: `src/components/loop/lead/leadTouchSession.test.ts` (import and renamed constant only)

**Interfaces:**
- Produces, in `src/components/touchGesture.ts`:
  - `export const TOUCH_LONG_PRESS_MS = 300;`
  - `export const TOUCH_SLOP_PX = 8;`
  - `export interface TouchGestureState { phase: 'pending' | 'tap' | 'long-press' | 'scroll' | 'cancelled'; downAt: number; downX: number; downY: number }`
  - `export type TouchGestureEvent = { type: 'move' | 'up'; t: number; x: number; y: number } | { type: 'timer' } | { type: 'cancel' };`
  - `export function touchGestureStart(t: number, x: number, y: number): TouchGestureState`
  - `export function touchGestureReduce(state: TouchGestureState, event: TouchGestureEvent): TouchGestureState`
- `leadTouchGesture.ts` no longer exports `LEAD_LONG_PRESS_MS`, `LEAD_TOUCH_SLOP_PX`, `leadTouchStart`, `leadTouchReduce`, `LeadTouchState` or `LeadTouchEvent`.

- [ ] **Step 1: Write the failing test.** Create `src/components/touchGesture.test.ts`. These are the reducer cases from `leadTouchGesture.test.ts`, one for one and with the same expectations, under the new names:

```ts
import { describe, expect, test } from 'bun:test';
import {
  TOUCH_LONG_PRESS_MS,
  TOUCH_SLOP_PX,
  touchGestureReduce,
  touchGestureStart,
  type TouchGestureEvent,
  type TouchGestureState,
} from './touchGesture';

const DOWN_AT = 1000;
const start = (): TouchGestureState => touchGestureStart(DOWN_AT, 100, 100);
const move = (dt: number, dx: number, dy = 0): TouchGestureEvent => ({
  type: 'move',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});
const up = (dt: number, dx = 0, dy = 0): TouchGestureEvent => ({
  type: 'up',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});

describe('touchGestureReduce — the gesture table', () => {
  test('the thresholds are the agreed 300ms and 8px', () => {
    expect(TOUCH_LONG_PRESS_MS).toBe(300);
    expect(TOUCH_SLOP_PX).toBe(8);
  });

  test('a lift before the hold, inside the slop, is a tap', () => {
    expect(touchGestureReduce(start(), up(299, 7)).phase).toBe('tap');
  });

  test('a lift at exactly the hold is a long-press, never a tap', () => {
    expect(touchGestureReduce(start(), up(300)).phase).toBe('long-press');
    expect(touchGestureReduce(start(), up(301)).phase).toBe('long-press');
  });

  test('the timer turns a still finger into a long-press', () => {
    expect(touchGestureReduce(start(), { type: 'timer' }).phase).toBe('long-press');
  });

  test('moving 8px before the hold is a scroll; 7px is still pending', () => {
    expect(touchGestureReduce(start(), move(50, 8)).phase).toBe('scroll');
    expect(touchGestureReduce(start(), move(50, 7)).phase).toBe('pending');
    expect(touchGestureReduce(start(), move(50, 0, -8)).phase).toBe('scroll');
  });

  test('the slop is a distance, not per axis', () => {
    // 6px right and 6px down is 8.49px from the down point.
    expect(touchGestureReduce(start(), move(50, 6, 6)).phase).toBe('scroll');
    // 5px and 5px is 7.07px.
    expect(touchGestureReduce(start(), move(50, 5, 5)).phase).toBe('pending');
  });

  test('a lift after moving past the slop, before the hold, is a scroll, not a tap', () => {
    expect(touchGestureReduce(start(), up(120, 12)).phase).toBe('scroll');
  });

  test('a move once the hold is due counts as the hold, whatever its distance', () => {
    // The gesture is only still pending because it stayed inside the slop
    // until now; a late timer must not turn a hold into a scroll.
    expect(touchGestureReduce(start(), move(301, 40)).phase).toBe('long-press');
  });

  test('cancel from pending is cancelled', () => {
    expect(touchGestureReduce(start(), { type: 'cancel' }).phase).toBe('cancelled');
  });
});

describe('touchGestureReduce — every verdict is final', () => {
  const verdicts: TouchGestureEvent[] = [up(100), { type: 'timer' }, move(50, 20), { type: 'cancel' }];
  for (const verdict of verdicts) {
    test(`after ${verdict.type}, no later event changes the state`, () => {
      const settled = touchGestureReduce(start(), verdict);
      for (const later of [move(400, 0), up(500), { type: 'timer' } as const, { type: 'cancel' } as const]) {
        expect(touchGestureReduce(settled, later)).toBe(settled);
      }
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `bun test src/components/touchGesture.test.ts`
Expected: FAIL. The module `./touchGesture` cannot be resolved.

- [ ] **Step 3: Create `src/components/touchGesture.ts`.**

```ts
/**
 * Touch gestures on a pattern grid, decided with no DOM, no React and no
 * timers: the caller feeds timestamps and positions, this answers what the
 * finger meant. Mouse and pen never come here. One classifier for every grid
 * that takes touch — the Lead/FX pitch matrix and the custom Chord/Bass lane
 * (R343) — so the two cannot drift.
 *
 * The table: a lift before TOUCH_LONG_PRESS_MS inside the slop is a TAP;
 * TOUCH_SLOP_PX of travel before that is a SCROLL (the browser's, nothing is
 * written); reaching TOUCH_LONG_PRESS_MS inside the slop is a LONG-PRESS,
 * after which the session — not this reducer — owns the finger.
 */

/** How long a still finger must stay down to become a long-press. */
export const TOUCH_LONG_PRESS_MS = 300;

/** How far a finger may drift before the gesture is a scroll. */
export const TOUCH_SLOP_PX = 8;

type TouchGesturePhase = 'pending' | 'tap' | 'long-press' | 'scroll' | 'cancelled';

export interface TouchGestureState {
  phase: TouchGesturePhase;
  downAt: number;
  downX: number;
  downY: number;
}

interface TouchGestureSample {
  type: 'move' | 'up';
  t: number;
  x: number;
  y: number;
}

/** `timer` is the scheduled TOUCH_LONG_PRESS_MS callback; it carries no time
 * because firing at all is the proof that the hold elapsed. */
export type TouchGestureEvent = TouchGestureSample | { type: 'timer' } | { type: 'cancel' };

export function touchGestureStart(t: number, x: number, y: number): TouchGestureState {
  return { phase: 'pending', downAt: t, downX: x, downY: y };
}

/**
 * One step of the classifier. Order matters: cancel, then TIME, then
 * distance. Time goes first because a gesture is only still pending if it
 * stayed inside the slop until now — so a late timer, or a move or lift that
 * arrives after the hold was due, still counts as the hold.
 */
export function touchGestureReduce(state: TouchGestureState, event: TouchGestureEvent): TouchGestureState {
  if (state.phase !== 'pending') return state;
  if (event.type === 'cancel') return { ...state, phase: 'cancelled' };
  if (event.type === 'timer') return { ...state, phase: 'long-press' };
  if (event.t - state.downAt >= TOUCH_LONG_PRESS_MS) return { ...state, phase: 'long-press' };
  if (Math.hypot(event.x - state.downX, event.y - state.downY) >= TOUCH_SLOP_PX) {
    return { ...state, phase: 'scroll' };
  }
  return event.type === 'up' ? { ...state, phase: 'tap' } : state;
}
```

- [ ] **Step 4: Trim `src/components/loop/lead/leadTouchGesture.ts`.** Delete everything from the file's top doc comment through the end of `leadTouchReduce`: the doc comment, both constants, `LeadTouchPhase`, `LeadTouchState`, `LeadTouchPointerEvent`, `LeadTouchEvent`, `leadTouchStart` and `leadTouchReduce`. Keep the `LEAD_CELL_SIZE` import, `LeadGridGeometry` and `leadCellAtPoint` unchanged. The file then starts:

```ts
/**
 * Lead-only touch geometry: which melody-grid cell sits under a client point.
 * It is arithmetic over square LEAD_CELL_SIZE cells, which only this grid
 * has. The tap/swipe/long-press classifier every grid shares is
 * `@/components/touchGesture` (R343).
 */

import { LEAD_CELL_SIZE } from './melodyGrid';
```

- [ ] **Step 5: Trim `src/components/loop/lead/leadTouchGesture.test.ts`.** Delete both `describe('leadTouchReduce …')` blocks and the `DOWN_AT`, `start`, `move` and `up` helpers. Keep `describe('leadCellAtPoint', …)` unchanged. Replace the import block with:

```ts
import { describe, expect, test } from 'bun:test';
import { leadCellAtPoint, type LeadGridGeometry } from './leadTouchGesture';
import { LEAD_CELL_SIZE } from './melodyGrid';
```

- [ ] **Step 6: Point `leadTouchSession.ts` at the shared classifier.** This is a rename only. Task 4 rewrites the file.

```bash
sed -i '' -e 's/LEAD_LONG_PRESS_MS/TOUCH_LONG_PRESS_MS/g' \
  -e 's/leadTouchReduce/touchGestureReduce/g' \
  -e 's/leadTouchStart/touchGestureStart/g' \
  -e 's/LeadTouchEvent/TouchGestureEvent/g' \
  -e 's/LeadTouchState/TouchGestureState/g' \
  src/components/loop/lead/leadTouchSession.ts
```

Then replace the file's `from './leadTouchGesture'` import block with:

```ts
import {
  TOUCH_LONG_PRESS_MS,
  touchGestureReduce,
  touchGestureStart,
  type TouchGestureEvent,
  type TouchGestureState,
} from '@/components/touchGesture';
import { leadCellAtPoint, type LeadGridGeometry } from './leadTouchGesture';
```

- [ ] **Step 7: Point `leadTouchSession.test.ts` at the shared constant.** This changes imports and names only. No expectation changes.

```bash
sed -i '' 's/LEAD_LONG_PRESS_MS/TOUCH_LONG_PRESS_MS/g' src/components/loop/lead/leadTouchSession.test.ts
```

Then change `import { TOUCH_LONG_PRESS_MS } from './leadTouchGesture';` to `import { TOUCH_LONG_PRESS_MS } from '@/components/touchGesture';`.

- [ ] **Step 8: Run the tests and the gate.**

Run: `bun test src/components/touchGesture.test.ts src/components/loop/lead/`
Expected: PASS, with the same Lead test count as before the task.

Run: `grep -rn "LEAD_LONG_PRESS_MS\|LEAD_TOUCH_SLOP_PX\|leadTouchReduce\|leadTouchStart\|LeadTouchState\|LeadTouchEvent" src`
Expected: no output.

Run: `bun run lint && bun run eslint`
Expected: exit 0, and zero errors and zero warnings.

Run: `bun run check:dead-code && bun run check:dead-code:production`
Expected: zero findings. `touchGesture.ts` is reachable through Lead.

- [ ] **Step 9: Commit.**

```bash
git add src/components/touchGesture.ts src/components/touchGesture.test.ts \
  src/components/loop/lead/leadTouchGesture.ts src/components/loop/lead/leadTouchGesture.test.ts \
  src/components/loop/lead/leadTouchSession.ts src/components/loop/lead/leadTouchSession.test.ts
git commit -m "refactor(touch): move the touch gesture classifier to the components root

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared session core and `resizeHold`

Read first: `src/components/loop/lead/leadTouchSession.ts` (the lifecycle this carries over), `src/components/ui/useSpanResize.ts` (`SpanResizePointer`, `createSpanResizeSlot`).

**Files:**
- Create: `src/components/touchGestureSession.ts`
- Create: `src/components/touchGestureSession.test.ts`

**Interfaces:**
- Consumes (Task 1): `TOUCH_LONG_PRESS_MS`, `TOUCH_SLOP_PX`, `touchGestureStart`, `touchGestureReduce`, `TouchGestureState`, `TouchGestureEvent` from `./touchGesture`. `SpanResizePointer` from `@/components/ui/useSpanResize`.
- Produces, in `src/components/touchGestureSession.ts`:
  - `export interface TouchGesturePointer { pointerId: number; clientX: number; clientY: number }`
  - `export interface TouchHold { move: (p: TouchGesturePointer) => void; end: () => void; cancel: () => void }`
  - `export interface TouchGestureTarget<TCell extends { covered: boolean }> { tap: (cell: TCell, pointerId: number) => void; hold: (cell: TCell, pointer: SpanResizePointer) => TouchHold | null }`
  - `export interface TouchGestureDeps { now: () => number; schedule: (ms: number, fn: () => void) => () => void }`
  - `export interface TouchGestureSession<TCell> { down(p, cell); move(p); end(p, type: 'pointerup' | 'pointercancel'): boolean; holding(): boolean; isOpen(): boolean; dispose(): void }`
  - `export function createTouchGestureSession<TCell extends { covered: boolean }>(target: TouchGestureTarget<TCell>, deps: TouchGestureDeps): TouchGestureSession<TCell>`
  - `export function resizeHold(pointer: SpanResizePointer, start: (pointer: SpanResizePointer) => void, cancel: () => void): TouchHold`

- [ ] **Step 1: Write the failing tests.** Create `src/components/touchGestureSession.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createSpanResizeSlot, type SpanResizePointer } from '@/components/ui/useSpanResize';
import { TOUCH_LONG_PRESS_MS, TOUCH_SLOP_PX } from './touchGesture';
import { createTouchGestureSession, resizeHold, type TouchGestureTarget } from './touchGestureSession';

interface Cell {
  name: string;
  covered: boolean;
}
const EMPTY: Cell = { name: 'empty', covered: false };
const NOTE: Cell = { name: 'note', covered: true };

/** A session over a logging target. `liveHold: false` makes every hold null. */
function rig(liveHold = true) {
  const log: string[] = [];
  let clock = 0;
  let timer: (() => void) | null = null;
  const scheduled: Array<() => void> = [];
  const target: TouchGestureTarget<Cell> = {
    tap: (cell, pointerId) => {
      log.push(`tap ${cell.name} ${pointerId}`);
    },
    hold: (cell, pointer) => {
      log.push(`hold ${cell.name} ${pointer.pointerId} x=${pointer.clientX}`);
      if (!liveHold) return null;
      return {
        move: (p) => {
          log.push(`hold.move x=${p.clientX}`);
        },
        end: () => {
          log.push('hold.end');
        },
        cancel: () => {
          log.push('hold.cancel');
        },
      };
    },
  };
  const session = createTouchGestureSession(target, {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      scheduled.push(fn);
      return () => {
        if (timer === fn) timer = null;
      };
    },
  });
  const at = (dx = 0, dy = 0, pointerId = 7) => ({ pointerId, clientX: 100 + dx, clientY: 100 + dy });
  return {
    session,
    log,
    at,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let the live long-press timer fire, TOUCH_LONG_PRESS_MS after now. */
    hold: () => {
      clock += TOUCH_LONG_PRESS_MS;
      timer?.();
    },
    /** Whether a long-press timer is still scheduled (its canceller not run). */
    timerPending: () => timer !== null,
    /** The i-th scheduled callback, even after its canceller ran: a timer the browser fires late. */
    fireLate: (i: number) => {
      scheduled[i]?.();
    },
    down: (cell: Cell, pointerId = 7) => session.down(at(0, 0, pointerId), cell),
  };
}

describe('a tap', () => {
  test('calls tap on pointerup only, never on down', () => {
    const r = rig();
    r.down(EMPTY);
    expect(r.log).toEqual([]);
    r.advance(120);
    expect(r.session.end(r.at(2), 'pointerup')).toBe(true);
    expect(r.log).toEqual(['tap empty 7']);
    expect(r.session.isOpen()).toBe(false);
    expect(r.timerPending()).toBe(false);
  });

  test('a tap on a covered cell is a tap too', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(120);
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual(['tap note 7']);
  });

  test('end answers false for a pointer the session does not own', () => {
    const r = rig();
    expect(r.session.end(r.at(), 'pointerup')).toBe(false);
    r.down(EMPTY);
    expect(r.session.end(r.at(0, 0, 9), 'pointerup')).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.log).toEqual([]);
  });
});

describe('a swipe and a cancel', () => {
  test('a swipe calls nothing, and the timer after it does nothing', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(50);
    r.session.move(r.at(TOUCH_SLOP_PX));
    expect(r.session.isOpen()).toBe(false);
    expect(r.timerPending()).toBe(false);
    r.fireLate(0);
    expect(r.session.end(r.at(TOUCH_SLOP_PX), 'pointerup')).toBe(false);
    expect(r.log).toEqual([]);
  });

  test('pointercancel writes nothing', () => {
    const r = rig();
    r.down(EMPTY);
    r.advance(50);
    expect(r.session.end(r.at(), 'pointercancel')).toBe(true);
    expect(r.session.isOpen()).toBe(false);
    expect(r.log).toEqual([]);
  });

  test('a timer from a closed gesture does nothing to the next one', () => {
    const r = rig();
    r.down(EMPTY);
    r.session.move(r.at(TOUCH_SLOP_PX));
    r.down(NOTE, 8);
    r.fireLate(0);
    expect(r.log).toEqual([]);
    expect(r.session.holding()).toBe(false);
    r.hold();
    expect(r.log).toEqual(['hold note 8 x=100']);
  });
});

describe('a long-press with a live hold', () => {
  test('calls hold with the latest clientX', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(100);
    r.session.move(r.at(5));
    expect(r.session.holding()).toBe(false);
    r.hold();
    expect(r.log).toEqual(['hold note 7 x=105']);
    expect(r.session.holding()).toBe(true);
    expect(r.session.isOpen()).toBe(true);
  });

  test('the hold receives move and end, and holding() is true only while it is live', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    r.session.move(r.at(40));
    r.session.move(r.at(60, 0, 9));
    expect(r.session.end(r.at(40), 'pointerup')).toBe(true);
    expect(r.log).toEqual(['hold empty 7 x=100', 'hold.move x=140', 'hold.end']);
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(false);
  });
});

describe('a long-press whose hold is null (inert)', () => {
  test('stays open without blocking the pan, and a lift taps an empty cell', () => {
    const r = rig(false);
    r.down(EMPTY);
    r.hold();
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.session.end(r.at(3), 'pointerup')).toBe(true);
    expect(r.log).toEqual(['hold empty 7 x=100', 'tap empty 7']);
    expect(r.session.isOpen()).toBe(false);
  });

  test('a lift on a covered cell does nothing', () => {
    const r = rig(false);
    r.down(NOTE);
    r.hold();
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual(['hold note 7 x=100']);
  });

  test('a move past the slop closes it and writes nothing', () => {
    const r = rig(false);
    r.down(EMPTY);
    r.hold();
    r.session.move(r.at(TOUCH_SLOP_PX - 1));
    expect(r.session.isOpen()).toBe(true);
    r.session.move(r.at(TOUCH_SLOP_PX));
    expect(r.session.isOpen()).toBe(false);
    expect(r.session.end(r.at(TOUCH_SLOP_PX), 'pointerup')).toBe(false);
    expect(r.log).toEqual(['hold empty 7 x=100']);
  });
});

describe('a lift at the hold threshold before the timer runs', () => {
  test('taps an empty cell and never opens a hold', () => {
    const r = rig();
    r.down(EMPTY);
    r.advance(TOUCH_LONG_PRESS_MS);
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual(['tap empty 7']);
  });

  test('does nothing on a covered cell', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(TOUCH_LONG_PRESS_MS);
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual([]);
  });
});

describe('interruptions', () => {
  test('a second finger aborts a pending gesture and is itself ignored', () => {
    const r = rig();
    r.down(EMPTY);
    r.down(EMPTY, 8);
    expect(r.session.isOpen()).toBe(false);
    expect(r.timerPending()).toBe(false);
    expect(r.session.end(r.at(0, 0, 8), 'pointerup')).toBe(false);
    expect(r.session.end(r.at(), 'pointerup')).toBe(false);
    expect(r.log).toEqual([]);
  });

  test('a second finger aborts a live hold through its cancel', () => {
    const r = rig();
    r.down(NOTE);
    r.hold();
    r.down(EMPTY, 8);
    expect(r.log).toEqual(['hold note 7 x=100', 'hold.cancel']);
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(false);
  });

  test('pointercancel during a live hold cancels it and never ends it', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    r.session.end(r.at(), 'pointercancel');
    expect(r.log).toEqual(['hold empty 7 x=100', 'hold.cancel']);
  });

  test('dispose cancels the timer and writes nothing', () => {
    const r = rig();
    r.down(EMPTY);
    r.session.dispose();
    expect(r.timerPending()).toBe(false);
    expect(r.session.isOpen()).toBe(false);
    r.fireLate(0);
    expect(r.log).toEqual([]);
  });

  test('dispose cancels a live hold', () => {
    const r = rig();
    r.down(NOTE);
    r.hold();
    r.session.dispose();
    expect(r.log).toEqual(['hold note 7 x=100', 'hold.cancel']);
  });
});

describe('resizeHold', () => {
  test('calls start once with the pointer; move and end call nothing; cancel reaches the canceller', () => {
    const calls: string[] = [];
    const pointer: SpanResizePointer = { pointerId: 4, clientX: 50 };
    const hold = resizeHold(
      pointer,
      (p) => calls.push(`start ${p.pointerId} ${p.clientX}`),
      () => calls.push('cancel'),
    );
    expect(calls).toEqual(['start 4 50']);
    hold.move({ pointerId: 4, clientX: 90, clientY: 0 });
    hold.end();
    expect(calls).toEqual(['start 4 50']);
    hold.cancel();
    expect(calls).toEqual(['start 4 50', 'cancel']);
  });

  /** A resizeHold over the real span-resize slot, listening on a plain EventTarget. */
  function slotRig() {
    const win = new EventTarget();
    const slot = createSpanResizeSlot<{ id: string }>(() => win);
    const writes: string[] = [];
    const hold = resizeHold(
      { pointerId: 4, clientX: 100 },
      (p) =>
        slot.start(
          p,
          {
            identity: { id: 'span' },
            startLength: 1,
            maxLength: 8,
            pixelsPerStep: 20,
            onCommit: (_identity, length) => writes.push(`commit ${length}`),
            onClick: () => writes.push('click'),
          },
          () => {},
        ),
      () => slot.cancel(),
    );
    const send = (type: string, x: number): void => {
      win.dispatchEvent(Object.assign(new Event(type), { pointerId: 4, clientX: x }));
    };
    return { hold, writes, send };
  }

  test('with the real slot, a moved lift commits once', () => {
    const s = slotRig();
    s.send('pointermove', 140);
    s.send('pointerup', 140);
    s.send('pointerup', 140);
    expect(s.writes).toEqual(['commit 3']);
  });

  test("with the real slot, an unmoved lift commits nothing: it is the slot's click, which each adapter points at a no-op", () => {
    const s = slotRig();
    s.send('pointerup', 100);
    expect(s.writes).toEqual(['click']);
  });

  test('with the real slot, a cancel commits nothing', () => {
    const s = slotRig();
    s.send('pointermove', 140);
    s.hold.cancel();
    s.send('pointerup', 140);
    expect(s.writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `bun test src/components/touchGestureSession.test.ts`
Expected: FAIL. The module `./touchGestureSession` cannot be resolved.

- [ ] **Step 3: Create `src/components/touchGestureSession.ts`.**

```ts
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import {
  TOUCH_LONG_PRESS_MS,
  TOUCH_SLOP_PX,
  touchGestureReduce,
  touchGestureStart,
  type TouchGestureEvent,
  type TouchGestureState,
} from './touchGesture';

/** One finger's position, as the grid's pointer handlers and window listeners read it. */
export interface TouchGesturePointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** What a long-press does with the finger until it lifts. */
export interface TouchHold {
  move: (p: TouchGesturePointer) => void;
  /** The lift: the gesture completed. */
  end: () => void;
  /** An abort (a second finger, pointercancel, unmount): write nothing more. */
  cancel: () => void;
}

/** What a tap and a hold mean on one grid. Each grid's adapter supplies this. */
export interface TouchGestureTarget<TCell extends { covered: boolean }> {
  tap: (cell: TCell, pointerId: number) => void;
  /** A long-press took the finger. `pointer.clientX` is where the finger is
   * now, so a resize starts under it. Null: there is nothing to drag from
   * this cell; the session stays open, inert, and the lift rule decides. */
  hold: (cell: TCell, pointer: SpanResizePointer) => TouchHold | null;
}

/** The clock and timer the session cannot own; tests pass fakes. */
export interface TouchGestureDeps {
  now: () => number;
  /** Run `fn` once after `ms`; returns a canceller. */
  schedule: (ms: number, fn: () => void) => () => void;
}

export interface TouchGestureSession<TCell> {
  down: (p: TouchGesturePointer, cell: TCell) => void;
  move: (p: TouchGesturePointer) => void;
  /** True when the pointer was this session's; false lets a caller's mouse stroke close. */
  end: (p: TouchGesturePointer, type: 'pointerup' | 'pointercancel') => boolean;
  /** A live hold owns the finger: the grid blocks scrolling. */
  holding: () => boolean;
  /** A touch gesture is open: the grid swallows contextmenu. */
  isOpen: () => boolean;
  /** Unmount: drop everything, write nothing more. */
  dispose: () => void;
}

interface OpenTouch<TCell> {
  pointerId: number;
  cell: TCell;
  gesture: TouchGestureState;
  /** classifying: the reducer decides. inert: a long-press with nothing to
   * drag. holding: a live hold owns the finger. */
  mode: 'classifying' | 'inert' | 'holding';
  hold: TouchHold | null;
  lastX: number;
  cancelTimer: () => void;
}

const noop = (): void => undefined;

/**
 * One finger's gesture on a pattern grid (R343), and nothing about what the
 * grid does with it. Nothing is written on pointerdown: a tap reaches
 * `target.tap` on pointerup, a swipe or a cancel writes nothing, and a
 * long-press hands the finger to `target.hold`. A second finger cancels
 * whatever the first was doing and is itself ignored.
 */
export function createTouchGestureSession<TCell extends { covered: boolean }>(
  target: TouchGestureTarget<TCell>,
  deps: TouchGestureDeps,
): TouchGestureSession<TCell> {
  let current: OpenTouch<TCell> | null = null;

  const close = (): void => {
    current?.cancelTimer();
    current = null;
  };

  const abort = (): void => {
    current?.hold?.cancel();
    close();
  };

  // The lift rule after a long-press: add on an empty cell, leave a covered one alone.
  const liftAfterHold = (t: OpenTouch<TCell>): void => {
    if (!t.cell.covered) target.tap(t.cell, t.pointerId);
  };

  const startHold = (t: OpenTouch<TCell>): void => {
    const hold = target.hold(t.cell, { pointerId: t.pointerId, clientX: t.lastX });
    t.hold = hold;
    t.mode = hold ? 'holding' : 'inert';
  };

  const classify = (t: OpenTouch<TCell>, event: TouchGestureEvent): void => {
    t.gesture = touchGestureReduce(t.gesture, event);
    if (t.gesture.phase === 'long-press') startHold(t);
    else if (t.gesture.phase !== 'pending') close();
  };

  const release = (t: OpenTouch<TCell>, p: TouchGesturePointer): void => {
    if (t.mode === 'holding') {
      t.hold?.end();
      return;
    }
    if (t.mode === 'inert') {
      liftAfterHold(t);
      return;
    }
    const verdict = touchGestureReduce(t.gesture, {
      type: 'up',
      t: deps.now(),
      x: p.clientX,
      y: p.clientY,
    }).phase;
    // A lift at the hold threshold before the timer ran counts as the hold,
    // but never opens one: a resize started now would add its window
    // pointerup listener during the very dispatch it needed to hear.
    if (verdict === 'tap') target.tap(t.cell, t.pointerId);
    else if (verdict === 'long-press') liftAfterHold(t);
  };

  const pastSlop = (t: OpenTouch<TCell>, p: TouchGesturePointer): boolean =>
    Math.hypot(p.clientX - t.gesture.downX, p.clientY - t.gesture.downY) >= TOUCH_SLOP_PX;

  return {
    down: (p, cell) => {
      if (current) {
        abort();
        return;
      }
      const t: OpenTouch<TCell> = {
        pointerId: p.pointerId,
        cell,
        gesture: touchGestureStart(deps.now(), p.clientX, p.clientY),
        mode: 'classifying',
        hold: null,
        lastX: p.clientX,
        cancelTimer: noop,
      };
      current = t;
      t.cancelTimer = deps.schedule(TOUCH_LONG_PRESS_MS, () => {
        if (current === t && t.mode === 'classifying') classify(t, { type: 'timer' });
      });
    },
    move: (p) => {
      const t = current;
      if (!t || p.pointerId !== t.pointerId) return;
      t.lastX = p.clientX;
      if (t.mode === 'classifying') {
        classify(t, { type: 'move', t: deps.now(), x: p.clientX, y: p.clientY });
      } else if (t.mode === 'holding') {
        t.hold?.move(p);
      } else if (pastSlop(t, p)) {
        // Inert: the finger is leaving; give it back to the browser.
        close();
      }
    },
    end: (p, type) => {
      const t = current;
      if (!t || p.pointerId !== t.pointerId) return false;
      if (type === 'pointercancel') {
        abort();
      } else {
        release(t, p);
        close();
      }
      return true;
    },
    holding: () => current?.mode === 'holding',
    isOpen: () => current !== null,
    dispose: abort,
  };
}

/**
 * The hold for "long-press a note or event, then resize": `start` opens the
 * grid's span resize from the finger's position. The resize's own window
 * listeners drive the preview and commit once on pointerup (R125), so this
 * hold's move and end do nothing; an abort reaches the grid's cancel.
 */
export function resizeHold(
  pointer: SpanResizePointer,
  start: (pointer: SpanResizePointer) => void,
  cancel: () => void,
): TouchHold {
  start(pointer);
  return { move: noop, end: noop, cancel };
}
```

- [ ] **Step 4: Run the tests and the gate.**

Run: `bun test src/components/touchGestureSession.test.ts src/components/touchGesture.test.ts`
Expected: PASS.

Run: `bun run lint && bun run eslint`
Expected: exit 0, and zero errors and zero warnings.

Knip is not run here: `touchGestureSession.ts` has no shipped importer until Task 4 (see Global Constraints).

- [ ] **Step 5: Commit.**

```bash
git add src/components/touchGestureSession.ts src/components/touchGestureSession.test.ts
git commit -m "feat(touch): add the shared touch gesture session and resize hold

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared listeners

Read first: the `useEffect` in `src/components/loop/lead/useLeadNotePaint.ts` (the five listeners this generalises, and why `touchmove` is lifetime and non-passive).

**Files:**
- Create: `src/components/useTouchGestureListeners.ts`
- Create: `src/components/useTouchGestureListeners.test.ts`

**Interfaces:**
- Consumes (Task 2): `TouchGesturePointer` from `./touchGestureSession`.
- Produces, in `src/components/useTouchGestureListeners.ts`:
  - `export interface TouchGestureListeners { move: (p: TouchGesturePointer) => void; end: (p: TouchGesturePointer, type: 'pointerup' | 'pointercancel') => void; holding: () => boolean; isOpen: () => boolean; dispose: () => void }`. A `TouchGestureSession` fits it as it is.
  - `export function attachTouchGestureListeners(element: ListenerTarget | null, windowTarget: ListenerTarget, listeners: TouchGestureListeners): () => void`, where `ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>`.
  - `export function useTouchGestureListeners(elementRef: React.RefObject<HTMLElement | null>, listeners: TouchGestureListeners): void`
  - Task 4 adds `browserTouchClock` to this file.

- [ ] **Step 1: Write the failing tests.** Create `src/components/useTouchGestureListeners.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { attachTouchGestureListeners } from './useTouchGestureListeners';

function rig(withElement = true) {
  const element = new EventTarget();
  const win = new EventTarget();
  const calls: string[] = [];
  const state = { holding: false, open: false };
  const detach = attachTouchGestureListeners(withElement ? element : null, win, {
    move: (p) => {
      calls.push(`move ${p.pointerId} ${p.clientX} ${p.clientY}`);
    },
    end: (p, type) => {
      calls.push(`end ${p.pointerId} ${type}`);
    },
    holding: () => state.holding,
    isOpen: () => state.open,
    dispose: () => {
      calls.push('dispose');
    },
  });
  const pointer = (type: string): Event =>
    Object.assign(new Event(type), { pointerId: 3, clientX: 10, clientY: 20 });
  /** Dispatch on the element; answers whether the default was prevented. */
  const onElement = (type: string, cancelable = true): boolean => {
    const ev = new Event(type, { cancelable });
    element.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  return { win, calls, state, detach, pointer, onElement };
}

describe('attachTouchGestureListeners', () => {
  test('forwards window pointermove, pointerup and pointercancel', () => {
    const r = rig();
    r.win.dispatchEvent(r.pointer('pointermove'));
    r.win.dispatchEvent(r.pointer('pointerup'));
    r.win.dispatchEvent(r.pointer('pointercancel'));
    expect(r.calls).toEqual(['move 3 10 20', 'end 3 pointerup', 'end 3 pointercancel']);
  });

  test('prevents a touchmove only while holding and only when it is cancelable', () => {
    const r = rig();
    expect(r.onElement('touchmove')).toBe(false);
    r.state.holding = true;
    expect(r.onElement('touchmove')).toBe(true);
    expect(r.onElement('touchmove', false)).toBe(false);
  });

  test('prevents contextmenu only while a gesture is open', () => {
    const r = rig();
    expect(r.onElement('contextmenu')).toBe(false);
    r.state.open = true;
    expect(r.onElement('contextmenu')).toBe(true);
  });

  test('detach removes every listener and disposes the session once', () => {
    const r = rig();
    r.state.holding = true;
    r.state.open = true;
    r.detach();
    expect(r.calls).toEqual(['dispose']);
    r.win.dispatchEvent(r.pointer('pointermove'));
    r.win.dispatchEvent(r.pointer('pointerup'));
    r.win.dispatchEvent(r.pointer('pointercancel'));
    expect(r.onElement('touchmove')).toBe(false);
    expect(r.onElement('contextmenu')).toBe(false);
    expect(r.calls).toEqual(['dispose']);
  });

  test('with no element, the window listeners still attach and detach', () => {
    const r = rig(false);
    r.win.dispatchEvent(r.pointer('pointerup'));
    r.detach();
    r.win.dispatchEvent(r.pointer('pointerup'));
    expect(r.calls).toEqual(['end 3 pointerup', 'dispose']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `bun test src/components/useTouchGestureListeners.test.ts`
Expected: FAIL. The module `./useTouchGestureListeners` cannot be resolved.

- [ ] **Step 3: Create `src/components/useTouchGestureListeners.ts`.**

```ts
import { useEffect, useRef } from 'react';
import type React from 'react';
import type { TouchGesturePointer } from './touchGestureSession';

/** `window` and the grid element in the app; bare EventTargets in tests. */
type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * What the listeners forward to. A TouchGestureSession fits as it is; Lead
 * passes its paint handlers, whose `end` closes the mouse stroke when the
 * touch session does not own the pointer.
 */
export interface TouchGestureListeners {
  move: (p: TouchGesturePointer) => void;
  end: (p: TouchGesturePointer, type: 'pointerup' | 'pointercancel') => void;
  holding: () => boolean;
  isOpen: () => boolean;
  dispose: () => void;
}

const pointerOf = (event: Event): TouchGesturePointer => {
  const ev = event as Event & TouchGesturePointer;
  return { pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY };
};

/**
 * The five listeners a touch grid needs for its whole life, with no React in
 * it. The window's pointer events reach the session wherever the finger goes.
 * The element's `touchmove` is NON-PASSIVE and lifetime on purpose: a browser
 * decides whether a touch sequence may be cancelled when it begins, so a
 * listener added at pointerdown is too late to stop the pan under a
 * long-press. It calls preventDefault only while a hold owns the finger, so
 * a swipe still scrolls natively. `contextmenu` is swallowed while a gesture
 * is open (the Android long-press menu).
 *
 * The returned detach removes all five and disposes the session: an unmount
 * mid-gesture (a layout switch, R316) cancels the timer and any live hold
 * and writes nothing.
 */
export function attachTouchGestureListeners(
  element: ListenerTarget | null,
  windowTarget: ListenerTarget,
  listeners: TouchGestureListeners,
): () => void {
  const onMove = (ev: Event): void => listeners.move(pointerOf(ev));
  const onUp = (ev: Event): void => listeners.end(pointerOf(ev), 'pointerup');
  const onCancel = (ev: Event): void => listeners.end(pointerOf(ev), 'pointercancel');
  const onTouchMove = (ev: Event): void => {
    if (ev.cancelable && listeners.holding()) ev.preventDefault();
  };
  const onContextMenu = (ev: Event): void => {
    if (listeners.isOpen()) ev.preventDefault();
  };
  windowTarget.addEventListener('pointermove', onMove);
  windowTarget.addEventListener('pointerup', onUp);
  windowTarget.addEventListener('pointercancel', onCancel);
  element?.addEventListener('touchmove', onTouchMove, { passive: false });
  element?.addEventListener('contextmenu', onContextMenu);
  return () => {
    windowTarget.removeEventListener('pointermove', onMove);
    windowTarget.removeEventListener('pointerup', onUp);
    windowTarget.removeEventListener('pointercancel', onCancel);
    element?.removeEventListener('touchmove', onTouchMove);
    element?.removeEventListener('contextmenu', onContextMenu);
    listeners.dispose();
  };
}

/**
 * Attaches the touch listeners once, for the component's whole life. It
 * keeps the ref and the listeners it was first given; the caller builds the
 * listeners object once, so there is nothing newer to read.
 */
export function useTouchGestureListeners(
  elementRef: React.RefObject<HTMLElement | null>,
  listeners: TouchGestureListeners,
): void {
  const first = useRef({ elementRef, listeners });
  useEffect(() => {
    const { elementRef: ref, listeners: forward } = first.current;
    return attachTouchGestureListeners(ref.current, window, forward);
  }, []);
}
```

The effect reads its arguments through `first`, a local ref, so `react-hooks/exhaustive-deps` has nothing to report and the empty deps array is honest.

- [ ] **Step 4: Run the tests and the gate.**

Run: `bun test src/components/useTouchGestureListeners.test.ts`
Expected: PASS.

Run: `bun run lint && bun run eslint`
Expected: exit 0, and zero errors and zero warnings.

- [ ] **Step 5: Commit.**

```bash
git add src/components/useTouchGestureListeners.ts src/components/useTouchGestureListeners.test.ts
git commit -m "feat(touch): add the shared touch gesture listeners

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lead onto the shared core

**Task constraint (regression contract):** this task changes no test file. `leadTouchSession.test.ts`, `leadPaint.test.ts` and `useLeadNoteResize.test.ts` must pass with every expectation as it stands after Task 1. If one fails, the adapter is wrong. Do not edit the test.

Read first: `src/components/loop/lead/leadTouchSession.ts`, `src/components/loop/lead/leadPaint.ts` (`createLeadPaintHandlers`: `onWindowPointerMove`, `onWindowPointerEnd`, `touchHolding`, `touchOpen`, `dispose`), `src/components/loop/lead/useLeadNotePaint.ts`.

**Files:**
- Modify: `src/components/loop/lead/leadTouchSession.ts` (rewritten as an adapter)
- Modify: `src/components/loop/lead/useLeadNotePaint.ts` (the listener effect and the clock)
- Modify: `src/components/useTouchGestureListeners.ts` (add `browserTouchClock`)

**Interfaces:**
- Consumes: `createTouchGestureSession`, `resizeHold`, `TouchGestureDeps`, `TouchGestureSession`, `TouchHold` (Task 2); `useTouchGestureListeners`, `TouchGestureListeners` (Task 3).
- Produces:
  - `leadTouchSession.ts`: `createLeadTouchSession(controller: LeadPaintController, deps: LeadTouchDeps): LeadTouchSession` (signature unchanged); `export interface LeadTouchDeps extends TouchGestureDeps` with the same members as today; `export type LeadTouchSession = TouchGestureSession<LeadTouchCell>`.
  - `useTouchGestureListeners.ts`: `export const browserTouchClock: TouchGestureDeps`. Task 6 uses it.

- [ ] **Step 1: Record the baseline.**

Run: `bun test src/components/loop/lead/`
Expected: PASS. Note the pass count; Step 6 must match it.

- [ ] **Step 2: Rewrite `src/components/loop/lead/leadTouchSession.ts`.** Replace the whole file with:

```ts
import {
  createTouchGestureSession,
  resizeHold,
  type TouchGestureDeps,
  type TouchGestureSession,
  type TouchHold,
} from '@/components/touchGestureSession';
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import type { LeadPaintController } from './leadPaint';
import { leadCellAtPoint, type LeadGridGeometry } from './leadTouchGesture';

/** The cell a finger went down on, as the cell handler already knows it. */
interface LeadTouchCell {
  stepIndex: number;
  col: number;
  note: string;
  covered: boolean;
}

/** Everything the session cannot decide by itself; the hook supplies the DOM halves. */
export interface LeadTouchDeps extends TouchGestureDeps {
  /** The matrix's on-screen geometry, or null when it is not mounted. */
  measure: () => LeadGridGeometry | null;
  /** A matrix row's note, or undefined past the last row. */
  rowNote: (row: number) => string | undefined;
  /** Column → stored index, the same resolver the paint controller fills gaps with. */
  resolveStepIndex: (col: number) => number;
  /** Start resizing the note covering (col, note), keeping it on an unmoved lift. */
  startNoteResize: (pointer: SpanResizePointer, col: number, note: string) => void;
  /** Abandon that resize: no commit (R125). */
  cancelNoteResize: () => void;
}

export type LeadTouchSession = TouchGestureSession<LeadTouchCell>;

/**
 * A long-press on an empty cell: draw mode, and the pressed cell fills now,
 * so the user sees the hold took. The matrix box is read once, here: scrolling
 * is blocked for the rest of the gesture, so it cannot go stale. Ending or
 * cancelling both close the stroke; cells already committed stay, as in a
 * mouse stroke.
 */
function leadPaintHold(
  controller: LeadPaintController,
  deps: LeadTouchDeps,
  cell: LeadTouchCell,
  pointerId: number,
): TouchHold {
  const geometry = deps.measure();
  controller.begin(pointerId, cell.stepIndex, cell.col, cell.note, false);
  const endStroke = (): void => controller.end(pointerId);
  return {
    move: (p) => {
      if (!geometry) return;
      const hit = leadCellAtPoint(geometry, p.clientX, p.clientY);
      const note = hit ? deps.rowNote(hit.row) : undefined;
      if (!hit || note === undefined) return;
      controller.visit(pointerId, deps.resolveStepIndex(hit.col), hit.col, note);
    },
    end: endStroke,
    cancel: endStroke,
  };
}

/**
 * The melody grid's touch adapter (R343): what a tap and a hold mean here.
 * The finger's lifecycle — tap on pointerup, swipe and cancel write nothing,
 * a second finger aborts — is the shared session's. A tap is a one-cell
 * stroke: it draws on an empty cell and erases on a note. A hold paints from
 * an empty cell, or resizes the note under it with `clickErases: false`, so
 * an unmoved lift keeps the note.
 */
export function createLeadTouchSession(
  controller: LeadPaintController,
  deps: LeadTouchDeps,
): LeadTouchSession {
  return createTouchGestureSession<LeadTouchCell>(
    {
      tap: ({ stepIndex, col, note, covered }, pointerId) => {
        controller.begin(pointerId, stepIndex, col, note, covered);
        controller.end(pointerId);
      },
      hold: (cell, pointer) =>
        cell.covered
          ? resizeHold(
              pointer,
              (p) => deps.startNoteResize(p, cell.col, cell.note),
              () => deps.cancelNoteResize(),
            )
          : leadPaintHold(controller, deps, cell, pointer.pointerId),
    },
    deps,
  );
}
```

`LeadTouchPointer`, `OpenTouch`, `noop` and every direct use of the classifier are gone; `LeadTouchDeps` keeps every member it had.

- [ ] **Step 3: Add `browserTouchClock` to `src/components/useTouchGestureListeners.ts`.** Change the type import to `import type { TouchGestureDeps, TouchGesturePointer } from './touchGestureSession';`, and add after `pointerOf`:

```ts
/** The real clock and timer for a touch session in the browser. */
export const browserTouchClock: TouchGestureDeps = {
  now: () => performance.now(),
  schedule: (ms, fn) => {
    const id = window.setTimeout(fn, ms);
    return () => window.clearTimeout(id);
  },
};
```

- [ ] **Step 4: Rewire `src/components/loop/lead/useLeadNotePaint.ts`.**
  - Imports: change `import { useEffect, useRef } from 'react';` to `import { useRef } from 'react';` and add:

```ts
import {
  browserTouchClock,
  useTouchGestureListeners,
  type TouchGestureListeners,
} from '@/components/useTouchGestureListeners';
```

  - In `leadTouchDeps`, replace the `now` and `schedule` members with `...browserTouchClock,` as the object's first line.
  - Replace the hook body from `const ref = useRef<LeadPaintHandlers | null>(null);` through the end of the function with:

```ts
  const ref = useRef<{ handlers: LeadPaintHandlers; listeners: TouchGestureListeners } | null>(null);
  // The controller is built once, but the column-to-stored-index mapping
  // moves with the meter — so it reads the CURRENT one on every gap it fills.
  const resolveRef = useRef(resolveStepIndex);
  resolveRef.current = resolveStepIndex;
  const wiringRef = useRef(wiring);
  wiringRef.current = wiring;

  if (!ref.current) {
    const controller = createLeadPaintController(
      ({ stepIndex, note, mode }) => {
        useAppStore.getState()[actions.paintNote](stepIndex, note, mode);
      },
      (col) => resolveRef.current(col),
    );
    const touch = createLeadTouchSession(controller, leadTouchDeps(wiringRef, resolveRef));
    const handlers = createLeadPaintHandlers(
      controller,
      (stepIndex, note) => {
        useAppStore.getState()[actions.toggleNote](stepIndex, note);
      },
      touch,
    );
    ref.current = {
      handlers,
      // A window end the touch session does not own closes the mouse
      // stroke: onWindowPointerEnd asks the session first (leadPaint.ts).
      listeners: {
        move: (p) => handlers.onWindowPointerMove(p),
        end: (p, type) => handlers.onWindowPointerEnd(p, type),
        holding: () => handlers.touchHolding(),
        isOpen: () => handlers.touchOpen(),
        dispose: () => handlers.dispose(),
      },
    };
  }

  useTouchGestureListeners(wiring.matrixRef, ref.current.listeners);
  return ref.current.handlers;
```

  - In the hook's doc comment, replace the final paragraph (the one that begins "The matrix's touchmove listener is NON-PASSIVE") with:

```ts
 * The window and matrix listeners are the shared useTouchGestureListeners,
 * attached for the component's whole life; its doc says why the matrix's
 * touchmove listener is lifetime and non-passive.
```

  and change "this file forwards events and owns the listeners, all of them for the component's whole life." to "this file forwards events.".

- [ ] **Step 5: Confirm no test file changed.**

Run: `git diff --exit-code -- 'src/**/*.test.ts' 'src/**/*.test.tsx'`
Expected: exit 0, no output.

- [ ] **Step 6: Run the tests and the full static gate.**

Run: `bun test src/components/loop/lead/ src/components/touchGesture.test.ts src/components/touchGestureSession.test.ts src/components/useTouchGestureListeners.test.ts`
Expected: PASS. The Lead pass count equals Step 1's.

Run: `bun run lint && bun run eslint`
Expected: exit 0, and zero errors and zero warnings.

Run: `bun run check:dead-code && bun run check:dead-code:production`
Expected: zero findings. The shared session and listeners are now reachable through Lead.

- [ ] **Step 7: Commit.**

```bash
git add src/components/loop/lead/leadTouchSession.ts src/components/loop/lead/useLeadNotePaint.ts \
  src/components/useTouchGestureListeners.ts
git commit -m "refactor(lead): run the melody-grid touch gestures on the shared core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Chord/Bass lane visuals — the 28px floor and the touch classes

Read first: `.claude/rules/theming.md`, `.claude/rules/testing.md`, the top of `src/components/loop/chord/CustomPatternTimeline.tsx` (constants) and its `CustomPatternTimeline` return.

**Files:**
- Modify: `src/components/loop/chord/CustomPatternTimeline.tsx` (`PATTERN_STEP_PX`, `PATTERN_CELL_MIN_WIDTH`, the scroller `div`, the cell-grid `div`)
- Test: `src/components/loop/chord/CustomPatternTimeline.test.tsx`

**Interfaces:**
- Produces: the markup that Task 6's tests extend: scroller class `overflow-x-auto touch-pan-x touch-pan-y`, and cell-grid class `grid gap-px select-none [-webkit-touch-callout:none]`.

- [ ] **Step 1: Write the failing tests.** In `CustomPatternTimeline.test.tsx`, replace the test `'holds every column at least half its height, scrolling instead of shrinking'` with the following, inside the same `describe`:

```tsx
  test('holds every column at the 28px touch-target floor, scrolling instead of shrinking', () => {
    // 28px is a Lead cell's size; the scroller's min-width is that floor
    // times the column count (32), not the old fixed 420/520px.
    expect(html).toContain('min-width:896px');
    expect(html).not.toContain('min-w-[420px]');
    // The unmeasured drag fallback agrees with the floor.
    expect(source).toMatch(/const PATTERN_STEP_PX = 28;/);
  });

  test('the scroller pans natively; the grid suppresses selection and the callout', () => {
    expect(html).toContain('overflow-x-auto touch-pan-x touch-pan-y');
    expect(html).toContain('grid gap-px select-none [-webkit-touch-callout:none]');
  });
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `bun test src/components/loop/chord/CustomPatternTimeline.test.tsx`
Expected: FAIL on `min-width:896px`, on `PATTERN_STEP_PX = 28` and on `touch-pan-x`.

- [ ] **Step 3: Implement.** In `CustomPatternTimeline.tsx`:

```tsx
/** Fallback step width while dragging, when the grid cannot be measured (server render). Matches the floor. */
const PATTERN_STEP_PX = 28;

/**
 * The floor below which a column never shrinks: a 28px touch target, the size
 * of a Lead cell. Below it the lane scrolls instead (R343).
 */
const PATTERN_CELL_MIN_WIDTH = 28;
```

The scroller `div` in `CustomPatternTimeline`'s return becomes:

```tsx
    <div className={cx('overflow-x-auto touch-pan-x touch-pan-y', className)}>
```

The cell-grid `div` (the one with `ref={gridRef}`) becomes:

```tsx
        <div
          ref={gridRef}
          className={cx(GRID_CLASS, 'select-none [-webkit-touch-callout:none]')}
          style={gridStyle}
        >
```

The header grids keep plain `GRID_CLASS`.

- [ ] **Step 4: Run the tests and the gate.**

Run: `bun test src/components/loop/chord/`
Expected: PASS.

Run: `bun run lint && bun run eslint && bun run check:theme`
Expected: exit 0, and zero errors and zero warnings.

- [ ] **Step 5: Commit.**

```bash
git add src/components/loop/chord/CustomPatternTimeline.tsx src/components/loop/chord/CustomPatternTimeline.test.tsx
git commit -m "feat(chord): widen pattern-lane columns to a 28px touch target and let the lane pan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Chord/Bass lane touch behaviour

Read first: `.claude/rules/components.md` (R265 colocated hook, R266 named return type), `src/components/loop/chord/CustomPatternTimeline.tsx` (`PatternSpanIdentity`, `PatternCellContext`, `patternCellNode`, `usePatternCellContext`), `src/components/ui/useSpanResize.ts`.

**Files:**
- Create: `src/components/loop/chord/patternTouch.ts`
- Create: `src/components/loop/chord/patternTouch.test.ts`
- Create: `src/components/loop/chord/usePatternTouch.ts`
- Modify: `src/components/loop/chord/CustomPatternTimeline.tsx` (header comment, `RESIZE_HANDLE_CLASS`, `PatternSpanIdentity` moves out, `PatternCellContext`, `patternCellNode`, new `patternHeadNode`, `usePatternCellContext`, the grid `div`)
- Test: `src/components/loop/chord/CustomPatternTimeline.test.tsx`

**Interfaces:**
- Consumes: `createTouchGestureSession`, `resizeHold`, `TouchGestureSession`, `TouchGestureTarget` (Task 2); `useTouchGestureListeners`, `browserTouchClock` (Tasks 3–4); `SpanResizePointer`, `SpanResizeStart`, `createSpanResizeSlot` (`useSpanResize.ts`); `TOUCH_LONG_PRESS_MS` (Task 1).
- Produces, in `patternTouch.ts`:
  - `export interface PatternSpanIdentity { column: number }` (moved from `CustomPatternTimeline.tsx`)
  - `export type PatternTouchCell = { column: number; covered: false } | { column: number; covered: true; length: number; maxLength: number }`
  - `export interface PatternTouchDeps { onActivate(column); onResize(column, length); identityFor(column): PatternSpanIdentity; columnWidthPx(): number; startResize(pointer: SpanResizePointer, input: SpanResizeStart<PatternSpanIdentity>): void; cancelResize(): void }`
  - `export function createPatternTouchTarget(deps: PatternTouchDeps): TouchGestureTarget<PatternTouchCell>`
  - `export interface PatternTouchHandlers { onCellPointerDown(event: PatternPointerLike, cell: PatternTouchCell): void; onHandlePointerDown(event: PatternPointerLike, startDrag: () => void): void }`
  - `export function createPatternTouchHandlers(session: Pick<TouchGestureSession<PatternTouchCell>, 'down'>): PatternTouchHandlers`
  - `export function createPatternClickFilter(): { pointerDown(pointerType: string): void; allowClick(detail: number): boolean }`
- Produces, in `usePatternTouch.ts`: `export interface UsePatternTouch extends PatternTouchHandlers { onGridPointerDownCapture(event: { pointerType: string }): void; allowClick(detail: number): boolean }` and `export function usePatternTouch(gridRef: React.RefObject<HTMLDivElement | null>, deps: PatternTouchDeps): UsePatternTouch`.

- [ ] **Step 1: Write the failing adapter tests.** Create `src/components/loop/chord/patternTouch.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { TOUCH_LONG_PRESS_MS } from '@/components/touchGesture';
import { createTouchGestureSession } from '@/components/touchGestureSession';
import { createSpanResizeSlot } from '@/components/ui/useSpanResize';
import {
  createPatternClickFilter,
  createPatternTouchHandlers,
  createPatternTouchTarget,
  type PatternSpanIdentity,
  type PatternTouchCell,
} from './patternTouch';

const COLUMN_PX = 28;
const EMPTY: PatternTouchCell = { column: 3, covered: false };
const EVENT: PatternTouchCell = { column: 16, covered: true, length: 2, maxLength: 8 };

/**
 * The lane's real target and session over the real span-resize slot, which
 * listens on a plain EventTarget standing in for window. Wired the way
 * usePatternTouch wires them.
 */
function rig() {
  const writes: string[] = [];
  const spanStarts: Array<{ identity: PatternSpanIdentity; startLength: number; maxLength: number; pixelsPerStep: number }> = [];
  const identities = new Map<number, PatternSpanIdentity>();
  const identityFor = (column: number): PatternSpanIdentity => {
    let identity = identities.get(column);
    if (!identity) {
      identity = { column };
      identities.set(column, identity);
    }
    return identity;
  };
  const win = new EventTarget();
  const slot = createSpanResizeSlot<PatternSpanIdentity>(() => win);
  let clock = 0;
  let timer: (() => void) | null = null;
  const target = createPatternTouchTarget({
    onActivate: (column) => writes.push(`activate ${column}`),
    onResize: (column, length) => writes.push(`resize ${column} ${length}`),
    identityFor,
    columnWidthPx: () => COLUMN_PX,
    startResize: (pointer, input) => {
      const { identity, startLength, maxLength, pixelsPerStep } = input;
      spanStarts.push({ identity, startLength, maxLength, pixelsPerStep });
      slot.start(pointer, input, () => {});
    },
    cancelResize: () => slot.cancel(),
  });
  const session = createTouchGestureSession(target, {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      return () => {
        if (timer === fn) timer = null;
      };
    },
  });
  const X = 500;
  const Y = 40;
  const p = (dx = 0, pointerId = 7) => ({ pointerId, clientX: X + dx, clientY: Y });
  const windowEvent = (type: string, dx: number): Event =>
    Object.assign(new Event(type), { pointerId: 7, clientX: X + dx, clientY: Y });
  return {
    session,
    writes,
    spanStarts,
    identityFor,
    p,
    advance: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      clock += TOUCH_LONG_PRESS_MS;
      timer?.();
    },
    down: (cell: PatternTouchCell, pointerId = 7) => session.down(p(0, pointerId), cell),
    /** A window event reaches the lane's lifetime listener, then the resize's. */
    move: (dx: number) => {
      session.move(p(dx));
      win.dispatchEvent(windowEvent('pointermove', dx));
    },
    up: (dx = 0) => {
      session.end(p(dx), 'pointerup');
      win.dispatchEvent(windowEvent('pointerup', dx));
    },
    cancel: () => {
      session.end(p(), 'pointercancel');
      win.dispatchEvent(windowEvent('pointercancel', 0));
    },
  };
}

describe('lane touch: tap and swipe', () => {
  test('a tap on an empty column activates it once, on the lift', () => {
    const r = rig();
    r.down(EMPTY);
    expect(r.writes).toEqual([]);
    r.advance(100);
    r.up(2);
    expect(r.writes).toEqual(['activate 3']);
  });

  test('a tap on an event activates its column once, on the lift', () => {
    const r = rig();
    r.down(EVENT);
    r.advance(100);
    r.up();
    expect(r.writes).toEqual(['activate 16']);
    expect(r.spanStarts).toEqual([]);
  });

  test('a swipe writes nothing and starts no resize', () => {
    const r = rig();
    r.down(EVENT);
    r.move(10);
    r.up(10);
    r.hold();
    expect(r.writes).toEqual([]);
    expect(r.spanStarts).toEqual([]);
  });
});

describe('lane touch: long-press on an empty column', () => {
  test('then a lift activates it', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    r.up();
    expect(r.writes).toEqual(['activate 3']);
  });

  test('then a drag writes nothing and gives the finger back', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    r.move(40);
    expect(r.session.isOpen()).toBe(false);
    r.up(40);
    expect(r.writes).toEqual([]);
    expect(r.spanStarts).toEqual([]);
  });
});

describe('lane touch: long-press on an event', () => {
  test("starts a span resize with the event's identity, length, maxLength and the measured step", () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    expect(r.spanStarts).toHaveLength(1);
    expect(r.spanStarts[0]?.identity).toBe(r.identityFor(16));
    expect(r.spanStarts[0]).toEqual({ identity: { column: 16 }, startLength: 2, maxLength: 8, pixelsPerStep: COLUMN_PX });
    expect(r.session.holding()).toBe(true);
  });

  test('a drag then a lift resizes once, on the lift', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(2 * COLUMN_PX);
    expect(r.writes).toEqual([]);
    r.up(2 * COLUMN_PX);
    expect(r.writes).toEqual(['resize 16 4']);
  });

  test('an unmoved lift neither resizes nor activates', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.up();
    expect(r.writes).toEqual([]);
  });

  test('a second finger during the resize writes nothing', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(COLUMN_PX);
    r.down(EMPTY, 9);
    r.up(COLUMN_PX);
    expect(r.writes).toEqual([]);
  });

  test('a pointercancel during the resize writes nothing', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(COLUMN_PX);
    r.cancel();
    expect(r.writes).toEqual([]);
  });

  test('dispose mid-resize cancels it and writes nothing', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(COLUMN_PX);
    r.session.dispose();
    r.up(COLUMN_PX);
    expect(r.writes).toEqual([]);
  });
});

describe('the handle and the head wrapper, in DOM order', () => {
  function domRig() {
    const downs: string[] = [];
    const handlers = createPatternTouchHandlers({
      down: (p, cell) => {
        downs.push(`down ${p.pointerId} ${cell.column}`);
      },
    });
    const pointer = (pointerType: string, button = 0) => ({ pointerId: 4, pointerType, button, clientX: 10, clientY: 10 });
    /** A pointerdown on the handle: its own handler, then — unless its drag
     * started, which stops propagation — the head wrapper's. */
    const pressHandle = (pointerType: string): boolean => {
      let dragged = false;
      handlers.onHandlePointerDown(pointer(pointerType), () => {
        dragged = true;
      });
      if (!dragged) handlers.onCellPointerDown(pointer(pointerType), EVENT);
      return dragged;
    };
    return { downs, handlers, pointer, pressHandle };
  }

  test('a touch on the handle opens the session and starts no span resize', () => {
    const d = domRig();
    expect(d.pressHandle('touch')).toBe(false);
    expect(d.downs).toEqual(['down 4 16']);
  });

  test('mouse and pen on the handle start the drag at once', () => {
    const d = domRig();
    expect(d.pressHandle('mouse')).toBe(true);
    expect(d.pressHandle('pen')).toBe(true);
    expect(d.downs).toEqual([]);
  });

  test('a mouse, or a non-primary touch, on a cell opens no session', () => {
    const d = domRig();
    d.handlers.onCellPointerDown(d.pointer('mouse'), EMPTY);
    d.handlers.onCellPointerDown(d.pointer('pen'), EMPTY);
    d.handlers.onCellPointerDown(d.pointer('touch', 2), EMPTY);
    expect(d.downs).toEqual([]);
  });
});

describe('the click filter', () => {
  test('with no pointerdown seen, every click passes', () => {
    const f = createPatternClickFilter();
    expect(f.allowClick(1)).toBe(true);
    expect(f.allowClick(0)).toBe(true);
  });

  test('after a touch pointerdown, a detail-1 click is dropped and a detail-0 click passes', () => {
    const f = createPatternClickFilter();
    f.pointerDown('touch');
    expect(f.allowClick(1)).toBe(false);
    expect(f.allowClick(0)).toBe(true);
  });

  test('a mouse pointerdown clears the flag, so a mouse click activates', () => {
    const f = createPatternClickFilter();
    f.pointerDown('touch');
    f.pointerDown('mouse');
    expect(f.allowClick(1)).toBe(true);
  });
});
```

- [ ] **Step 2: Add the failing markup tests.** In `CustomPatternTimeline.test.tsx`, inside `describe('CustomPatternTimeline (the memoized cell grid)', …)`, add:

```tsx
  test('the resize handle sets no touch-action: a finger on it is a finger on the event', () => {
    expect(html).toContain('aria-label="Resize Chord event at bar 2 beat 1 step 1"');
    expect(html).not.toContain('touch-none');
  });

  test('adds no listener of its own: pointer plumbing is useSpanResize and the shared touch listeners', () => {
    expect(source).not.toMatch(/addEventListener/);
  });
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `bun test src/components/loop/chord/patternTouch.test.ts src/components/loop/chord/CustomPatternTimeline.test.tsx`
Expected: FAIL. `./patternTouch` cannot be resolved, and the markup still contains `touch-none`.

- [ ] **Step 4: Create `src/components/loop/chord/patternTouch.ts`.**

```ts
import {
  resizeHold,
  type TouchGestureSession,
  type TouchGestureTarget,
} from '@/components/touchGestureSession';
import type { SpanResizePointer, SpanResizeStart } from '@/components/ui/useSpanResize';

/** What one head's resize gesture needs to identify — stable by reference. */
export interface PatternSpanIdentity {
  column: number;
}

/** The column a finger went down on, as the cell renderer knows it at
 * pointerdown. Nothing writes during the gesture, so it cannot go stale. */
export type PatternTouchCell =
  | { column: number; covered: false }
  | { column: number; covered: true; length: number; maxLength: number };

/** Everything the lane adapter calls out to; the hook reads each through a ref. */
export interface PatternTouchDeps {
  onActivate: (column: number) => void;
  onResize: (column: number, length: number) => void;
  /** The lane's per-column, reference-stable identity, so previewFor matches. */
  identityFor: (column: number) => PatternSpanIdentity;
  /** One column's measured width in px. */
  columnWidthPx: () => number;
  startResize: (pointer: SpanResizePointer, input: SpanResizeStart<PatternSpanIdentity>) => void;
  cancelResize: () => void;
}

/** The fields the lane's pointerdown handlers read; a React pointer event qualifies. */
interface PatternPointerLike {
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
}

export interface PatternTouchHandlers {
  /** The empty button's and the head wrapper's pointerdown. */
  onCellPointerDown: (event: PatternPointerLike, cell: PatternTouchCell) => void;
  /** The resize handle's pointerdown; `startDrag` is the mouse/pen drag. */
  onHandlePointerDown: (event: PatternPointerLike, startDrag: () => void) => void;
}

interface PatternClickFilter {
  /** Every pointerdown in the lane, seen in the capture phase. */
  pointerDown: (pointerType: string) => void;
  /** Whether a click may activate. */
  allowClick: (detail: number) => boolean;
}

const noop = (): void => undefined;

/**
 * What a tap and a hold mean on the custom Chord/Bass lane (R343). A tap
 * activates the column — what a click does, so on the Chord lane a tap on an
 * event removes it. A long-press on an event resizes it; an unmoved lift is
 * the span's "click", pointed at a no-op so it keeps the event. A long-press
 * on an empty column has nothing to drag: the hold is null, and the shared
 * lift rule activates the column on the lift.
 */
export function createPatternTouchTarget(deps: PatternTouchDeps): TouchGestureTarget<PatternTouchCell> {
  return {
    tap: (cell) => deps.onActivate(cell.column),
    hold: (cell, pointer) => {
      if (!cell.covered) return null;
      return resizeHold(
        pointer,
        (p) =>
          deps.startResize(p, {
            identity: deps.identityFor(cell.column),
            startLength: cell.length,
            maxLength: cell.maxLength,
            pixelsPerStep: deps.columnWidthPx(),
            onCommit: (span, next) => deps.onResize(span.column, next),
            onClick: noop,
          }),
        () => deps.cancelResize(),
      );
    },
  };
}

/**
 * The lane's pointerdown routing. Only a primary touch opens the session;
 * mouse and pen keep activating on click. A touch on the handle does nothing
 * there and does not stop propagation, so it bubbles to the head wrapper:
 * on touch the whole event is one target.
 */
export function createPatternTouchHandlers(
  session: Pick<TouchGestureSession<PatternTouchCell>, 'down'>,
): PatternTouchHandlers {
  return {
    onCellPointerDown: (event, cell) => {
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      session.down({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }, cell);
    },
    onHandlePointerDown: (event, startDrag) => {
      if (event.pointerType === 'touch') return;
      startDrag();
    },
  };
}

/**
 * The session performs a tap on pointerup, so the click a browser synthesizes
 * after a finger tap must not activate a second time. A touch pointerdown
 * sets the flag and the next non-touch pointerdown clears it. A click with
 * `detail === 0` — keyboard, assistive technology, programmatic — always
 * passes.
 */
export function createPatternClickFilter(): PatternClickFilter {
  let afterTouch = false;
  return {
    pointerDown: (pointerType) => {
      afterTouch = pointerType === 'touch';
    },
    allowClick: (detail) => detail === 0 || !afterTouch,
  };
}
```

- [ ] **Step 5: Create `src/components/loop/chord/usePatternTouch.ts`.**

```ts
import { useRef } from 'react';
import type React from 'react';
import { createTouchGestureSession, type TouchGestureSession } from '@/components/touchGestureSession';
import { browserTouchClock, useTouchGestureListeners } from '@/components/useTouchGestureListeners';
import {
  createPatternClickFilter,
  createPatternTouchHandlers,
  createPatternTouchTarget,
  type PatternTouchCell,
  type PatternTouchDeps,
  type PatternTouchHandlers,
} from './patternTouch';

/** What the lane's cells and its grid element wire to. */
export interface UsePatternTouch extends PatternTouchHandlers {
  /** The grid's onPointerDownCapture: tells the click filter which pointer pressed last. */
  onGridPointerDownCapture: (event: { pointerType: string }) => void;
  /** Whether a click may activate: always for detail 0, never right after a touch. */
  allowClick: (detail: number) => boolean;
}

/**
 * Touch on the custom Chord/Bass lane (R343). Every decision lives in
 * patternTouch.ts and the shared session; this builds them once and attaches
 * the shared listeners. Both panels pass fresh callbacks on every render, so
 * the target reads them through a ref.
 */
export function usePatternTouch(
  gridRef: React.RefObject<HTMLDivElement | null>,
  deps: PatternTouchDeps,
): UsePatternTouch {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const built = useRef<{ session: TouchGestureSession<PatternTouchCell>; wiring: UsePatternTouch } | null>(null);

  if (!built.current) {
    const target = createPatternTouchTarget({
      onActivate: (column) => depsRef.current.onActivate(column),
      onResize: (column, length) => depsRef.current.onResize(column, length),
      identityFor: (column) => depsRef.current.identityFor(column),
      columnWidthPx: () => depsRef.current.columnWidthPx(),
      startResize: (pointer, input) => depsRef.current.startResize(pointer, input),
      cancelResize: () => depsRef.current.cancelResize(),
    });
    const session = createTouchGestureSession(target, browserTouchClock);
    const filter = createPatternClickFilter();
    built.current = {
      session,
      wiring: {
        ...createPatternTouchHandlers(session),
        onGridPointerDownCapture: (event) => filter.pointerDown(event.pointerType),
        allowClick: (detail) => filter.allowClick(detail),
      },
    };
  }

  useTouchGestureListeners(gridRef, built.current.session);
  return built.current.wiring;
}
```

- [ ] **Step 6: Wire `CustomPatternTimeline.tsx`.**
  1. Imports. Change the `useSpanResize` import to `import { useSpanResize, type SpanResizePointer, type SpanResizeStart } from '@/components/ui/useSpanResize';`, add `type CustomPatternHead,` to the `./customPatternGrid` import list, and add:

```tsx
import type { PatternSpanIdentity } from './patternTouch';
import { usePatternTouch, type UsePatternTouch } from './usePatternTouch';
```

  2. Header comment. Replace the bullet that begins ` *  - The pointer plumbing.` (two lines) with:

```tsx
 *  - The pointer plumbing. The resize gesture is `useSpanResize` and the touch
 *    gesture is the shared `useTouchGestureListeners` (through
 *    `usePatternTouch`); this file adds no listener of its own.
```

  3. Replace `RESIZE_HANDLE_CLASS` and its comment with:

```tsx
/**
 * The grab strip on a span's right edge, for mouse and pen. It sets no
 * `touch-action`: a finger on it is a finger on the event (R343), so a swipe
 * that starts here scrolls the lane and a long-press resizes through the
 * touch session.
 */
const RESIZE_HANDLE_CLASS =
  'absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-base-content/20';
```

  4. Delete the local `interface PatternSpanIdentity` and its comment; it now comes from `./patternTouch`.
  5. In `PatternCellContext`, change `startResize` and add `touch`:

```tsx
  startResize: (
    pointer: SpanResizePointer,
    input: SpanResizeStart<PatternSpanIdentity>,
  ) => void;
  /** Touch routing and the click filter (R343). */
  touch: UsePatternTouch;
```

  6. In `patternCellNode`, the `empty` branch's button gains a touch `pointerdown` and a filtered click. Replace its `onClick` line with:

```tsx
        onPointerDown={(event) =>
          context.touch.onCellPointerDown(event, { column: cell.column, covered: false })
        }
        onClick={(event) => {
          if (context.touch.allowClick(event.detail)) context.onActivate(cell.column);
        }}
```

  7. Replace everything in `patternCellNode` after the `empty` branch (from `const spanName = …` to the function's closing `}`) with `return patternHeadNode(cell, context);` and the function's closing brace. Then add, directly after `patternCellNode`:

```tsx
/**
 * An event: the head block over its whole span and the resize handle on its
 * right edge. The touch pointerdown sits on the wrapper because the handle is
 * the head button's sibling, not its child: a finger anywhere on the event,
 * handle included, reaches the one touch session (R343).
 */
function patternHeadNode<TValue>(
  cell: CustomPatternHead<TValue>,
  context: PatternCellContext<TValue>,
): React.ReactNode {
  const spanName = context.valueLabel?.(cell.value) ?? 'event';
  const name = context.nameOf(cell.column, spanName);
  const identity = context.identityFor(cell.column);
  // The live preview while THIS span is being dragged, its stored length
  // otherwise. The block's width and the grid item's span are the same number,
  // so a drag resizes the block without a store write per frame.
  const length = context.previewFor(identity) ?? cell.length;

  return (
    <div
      key={cell.column}
      data-column={cell.column}
      className={cx(CELL_CLASS, 'relative')}
      style={{ gridColumn: `${cell.column + 1} / span ${length}`, gridRow: '1' }}
      onPointerDown={(event) =>
        context.touch.onCellPointerDown(event, {
          column: cell.column,
          covered: true,
          length: cell.length,
          maxLength: cell.maxLength,
        })
      }
    >
      <button
        type="button"
        aria-label={name}
        onClick={(event) => {
          if (context.touch.allowClick(event.detail)) context.onActivate(cell.column);
        }}
        onKeyDown={(event) => context.onKeyDown(event, cell)}
        className={cx(HEAD_BLOCK_CLASS, context.color)}
      >
        {context.valueLabel ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none pointer-events-none select-none"
          >
            {spanName}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={`Resize ${name}`}
        // A focused handle answers the same keys the head does, so it is not a
        // focusable control that does nothing: Enter activates the span (which
        // is what an unmoved press on the handle does with a pointer) and
        // Shift+Arrow resizes it.
        onKeyDown={(event) => context.onKeyDown(event, cell)}
        // Mouse and pen drag at once. A touch returns without stopping
        // propagation, so it bubbles to the wrapper's touch session.
        onPointerDown={(event) =>
          context.touch.onHandlePointerDown(event, () =>
            context.startResize(event, {
              identity,
              startLength: cell.length,
              maxLength: cell.maxLength,
              pixelsPerStep: context.columnWidthPx(),
              onCommit: (span, next) => context.onResize(span.column, next),
              onClick: (span) => context.onActivate(span.column),
            }),
          )
        }
        className={RESIZE_HANDLE_CLASS}
      />
    </div>
  );
}
```

  8. In `usePatternCellContext`: change `const { previewFor, startResize } = useSpanResize<PatternSpanIdentity>();` to `const { previewFor, startResize, cancel } = useSpanResize<PatternSpanIdentity>();`. After the `columnWidthPx` `useCallback`, add:

```tsx
  const touch = usePatternTouch(gridRef, {
    onActivate,
    onResize,
    identityFor,
    columnWidthPx,
    startResize,
    cancelResize: cancel,
  });
```

  Add `touch,` to both the `useMemo` object and its dependency array, after `startResize`.

  9. The cell-grid `div` gains the click filter's capture listener:

```tsx
        <div
          ref={gridRef}
          className={cx(GRID_CLASS, 'select-none [-webkit-touch-callout:none]')}
          style={gridStyle}
          onPointerDownCapture={context.touch.onGridPointerDownCapture}
        >
```

  Capture phase, so a mouse press on the handle, whose drag stops propagation, still clears the touch flag.

- [ ] **Step 7: Run the tests.**

Run: `bun test src/components/loop/chord/ src/components/touchGestureSession.test.ts src/components/loop/lead/`
Expected: PASS.

Run: `grep -n "touch-none\|React.PointerEvent<HTMLElement>" src/components/loop/chord/CustomPatternTimeline.tsx`
Expected: no output.

- [ ] **Step 8: Run the full gate.** This is the last code task.

Run: `bun run verify`
Expected: exit 0. That covers all tests, the static and domain checks, both Knip scans (zero findings) and the production build.

Run: `bun run eslint`
Expected: zero errors and zero warnings. If `max-lines-per-function` or `complexity` fires on `patternCellNode`, `patternHeadNode` or `usePatternCellContext`, split the function; never disable the rule for it. For every warning printed by build, test or lint, record the decision in the task summary.

- [ ] **Step 9: Commit.**

```bash
git add src/components/loop/chord/patternTouch.ts src/components/loop/chord/patternTouch.test.ts \
  src/components/loop/chord/usePatternTouch.ts src/components/loop/chord/CustomPatternTimeline.tsx \
  src/components/loop/chord/CustomPatternTimeline.test.tsx
git commit -m "feat(chord): share the touch gesture model with the chord and bass lane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs (R343 widened, ADR-0050 amended), the full gate and a manual check

Read first: `docs/decisions/README.md` (the "Adding or changing a decision" section), `.claude/rules/pattern-grids.md`, `docs/decisions/0050-melody-grid-touch-gestures.md`.

**Files:**
- Modify: `.claude/rules/pattern-grids.md` (`paths:`, intro line, R343 bullet, R343 `## Prohibited` line)
- Modify: `docs/decisions/0050-melody-grid-touch-gestures.md` (amended in place; the filename is kept)
- Modify: `docs/decisions/README.md` (the 0050 row)
- Modify: `CLAUDE.md` (the `pattern-grids.md` row of the rules table)

**Interfaces:**
- Consumes: the names Tasks 1–6 shipped: `touchGestureReduce`, `createTouchGestureSession`, `resizeHold`, `useTouchGestureListeners`, `createLeadTouchSession`, `createPatternTouchTarget`, `createPatternClickFilter`, `PATTERN_CELL_MIN_WIDTH`, `LEAD_CELL_SIZE`.

- [ ] **Step 1: Widen R343 in `.claude/rules/pattern-grids.md`.**
  - Add the shared files to `paths:`, after `"src/components/playbackStep.ts"`, so the rule loads when they are opened:

```yaml
  - "src/components/touchGesture.ts"
  - "src/components/touchGestureSession.ts"
  - "src/components/useTouchGestureListeners.ts"
```

  - Change the intro line to: `Step storage width, the three step layouts, span-resize mechanics, custom Chord/Bass patterns and the pattern-grid touch gestures.`
  - Replace the whole R343 bullet (the line that begins `- The Lead/FX pitch matrix is`) with:

```md
- On the Lead/FX pitch matrix and on the custom Chord/Bass lane a touch pointer never edits on `pointerdown`. One shared classifier (`touchGestureReduce`, `components/touchGesture.ts`) and one session (`createTouchGestureSession`, `components/touchGestureSession.ts`) rule tap (on `pointerup`: Lead edits the cell, the lane activates the column), swipe (the browser scrolls, nothing is written) and long-press (Lead draws from an empty cell; on both grids a note or event resizes, and an unmoved lift keeps it). `pointercancel` writes nothing. A long-press then a lift adds on an empty cell and changes nothing on a note or event. Each grid supplies only an adapter (`loop/lead/leadTouchSession.ts`, `loop/chord/patternTouch.ts`) that says what a tap and a hold mean there, and the element and window listeners are `useTouchGestureListeners`. Mouse and pen are unchanged: Lead paints on `pointerdown`, the lane activates on `click`. On touch the whole note or event is one target: a touch on its resize handle goes to the same session, the handle sets no `touch-action`, and only mouse and pen drag it. The lane drops the click a browser synthesizes after a touch, and always honours a `detail === 0` click. The Lead matrix is `LEAD_CELL_SIZE` square on every screen; a Chord/Bass column never shrinks below `PATTERN_CELL_MIN_WIDTH`. <!-- R343 --> ([ADR-0050](../../docs/decisions/0050-melody-grid-touch-gestures.md))
```

  - Replace the R343 line in `## Prohibited` with:

```md
- A touch pointer that edits either grid on `pointerdown`, a swipe or `pointercancel` that writes, a custom-lane touch that activates on `pointerdown` or twice through the synthesized click, a touch on a handle that starts the handle's own drag or erases on a hold-and-lift, a `touch-action` on either grid's handle, a per-grid copy of the classifier or the session, a melody-grid row height not read from `LEAD_CELL_SIZE`, or a Chord/Bass column narrower than `PATTERN_CELL_MIN_WIDTH` <!-- R343 -->
```

- [ ] **Step 2: Amend `docs/decisions/0050-melody-grid-touch-gestures.md` in place.** The branch is unmerged, so the ADR is rewritten rather than superseded, and the filename stays so existing links hold. Replace the whole file with:

```md
# ADR-0050: Pattern-grid touch gestures

**Status:** Accepted — 2026-09-24.

## Context

On a phone the Lead/FX piano roll was hard to use. Cells were small enough that taps landed on the
wrong one and the right-edge length handle was hard to grab. A horizontal swipe to scroll the grid
added or removed notes where the finger landed, because a cell's `pointerdown` began a paint stroke
at once and the scroller declared no `touch-action`. A touch pointer is also implicitly captured to
its `pointerdown` target, so `pointerenter` never reached other cells and drag-to-paint could not
work by touch anyway. The grid must look the same on every screen, like the Beat grid.

The custom Chord/Bass lane had the same two problems in a milder form. Its columns stretch to fill
the card but fell to an 18px floor on a phone, and its 6px resize handle carried `touch-none`, so a
swipe that started on it resized the span instead of scrolling. A swipe from a cell already
scrolled without writing, because the lane edits on `click`.

## Decision

- **One gesture behaviour, two grids.** The classifier, one finger's lifecycle and the element and
  window listeners are one shared implementation at the `src/components/` root. Each grid supplies
  a thin adapter that says what a tap and a hold mean on it. Visuals stay per grid.
- `touchGestureReduce` (`components/touchGesture.ts`) is a pure classifier over timestamps and
  positions, with `TOUCH_LONG_PRESS_MS` and `TOUCH_SLOP_PX`. A lift before the hold inside the slop
  is a tap; travel past the slop before the hold is a swipe; reaching the hold inside the slop is a
  long-press. Time is checked before distance, so a late timer still counts as the hold.
- `createTouchGestureSession` (`components/touchGestureSession.ts`) owns one finger over a
  `{ tap, hold }` target. Nothing is written on `pointerdown`. A tap calls `tap` on `pointerup`. A
  swipe or `pointercancel` writes nothing. A long-press calls `hold` with the finger's latest
  position. A second finger aborts the gesture and is itself ignored. An abort or an unmount
  cancels the timer and a live hold. A lift at the threshold before the timer ran follows the lift
  rule without opening a hold, because a resize opened then would add its window `pointerup`
  listener during the very dispatch it needed to hear.
- **The lift rule, both grids:** after a long-press, a lift on an empty cell adds that cell, and a
  lift on a note or event changes nothing.
- **A `null` hold** means a long-press has nothing to drag from this cell. The session stays open
  and inert: it does not block the pan, it still swallows `contextmenu`, a lift applies the lift
  rule, and a move past the slop closes it and leaves the finger to the browser.
- `resizeHold` is the ready-made hold for "long-press a note or event, then resize". It opens the
  grid's `useSpanResize` from the finger, whose own window listeners preview and commit once on
  `pointerup` (R125); an abort reaches the grid's cancel.
- `useTouchGestureListeners` (pure core `attachTouchGestureListeners`) holds, for the component's
  whole life, the window `pointermove`, `pointerup` and `pointercancel` forwarding, a non-passive
  element `touchmove` that calls `preventDefault` only while a hold owns the finger, and an element
  `contextmenu` swallowed while a gesture is open. It is lifetime because a browser fixes whether a
  touch sequence can be cancelled when the sequence begins. Detaching disposes the session.
- **Lead/FX adapter** (`loop/lead/leadTouchSession.ts`): a tap is a one-cell stroke through the
  paint controller (draw on an empty cell, erase on a note). A hold on an empty cell is a draw
  stroke that follows the finger by arithmetic (`leadCellAtPoint`) over the matrix box read at the
  hold, clipped to the part of the scroller right of the sticky note column. A hold on a note is a
  `resizeHold` with `clickErases: false`, so an unmoved lift keeps the note. A window end the
  session does not own closes a mouse stroke. One constant, `LEAD_CELL_SIZE`, sizes the cells on
  both axes on every screen.
- **Chord/Bass adapter** (`loop/chord/patternTouch.ts`, wired by `usePatternTouch`): a tap
  activates the column, which is what a click does (on the Chord lane it toggles, so a tap on an
  event removes it). A hold on an event is a `resizeHold` whose span "click" is a no-op, so an
  unmoved lift keeps the event. A hold on an empty column is `null`. The touch `pointerdown` sits on
  the head's wrapper, because the handle is the head button's sibling. Columns never shrink below
  `PATTERN_CELL_MIN_WIDTH` (28px, a Lead cell's size); the lane scrolls instead.
- **Click de-dup on the lane.** The session taps on `pointerup`, so the click a browser synthesizes
  after a finger tap must not activate again. A touch `pointerdown`, seen in the grid's capture
  phase, sets a flag and the next non-touch `pointerdown` clears it. A click with `detail === 0`
  (keyboard, assistive technology) always passes; any other click passes only while the flag is
  clear.
- Mouse and pen are unchanged on both grids: Lead paints on `pointerdown`, the lane activates on
  `click`, and both drag a handle at once. Both scrollers declare `touch-action: pan-x pan-y`.
- On touch the whole note or event is one target. A touch `pointerdown` on a resize handle does
  nothing there and bubbles to the cell or wrapper, so the session rules it. The handles set no
  `touch-action`: CSS cannot branch on pointer type, and `touch-none` would block the pan for every
  swipe that starts on the handle.

### Rejected alternatives

- **A zoom control** (deferred). The marker's `translateX`, the ruler buttons and the resize
  pixels-per-step would all have to agree on a live cell size. Revisit if a fixed size proves wrong.
- **Immediate drag-to-paint on touch.** This was the bug: it cannot tell a scroll from a stroke.
- **An explicit scroll/draw mode toggle.** It is one more mode to remember, and it makes touch
  diverge from the desktop grid.
- **`elementFromPoint` hit testing.** It needs a DOM to test and per-cell attributes to read.
- **A `touchmove` listener added per gesture.** It arrives too late to cancel the pan under a
  long-press.
- **Keeping the handle's immediate drag on touch.** With `touch-none` on the handle a swipe that
  starts there resizes instead of scrolling, and a hold-and-lift on it counts as a click that erases
  or activates.
- **A second, Chord/Bass-only copy of the Lead session.** The two would drift; the gesture table is
  one rule, so it gets one implementation.
- **Moving the whole Lead session to the shared root unchanged.** It is bound to the paint
  controller and `leadCellAtPoint`; the shared core has to know only about a tap and a hold.
- **Keeping the window forwarding per grid.** It would be the same five listeners twice, and a
  forgotten `dispose` in one copy would leak a timer. Lead's fallthrough to the mouse stroke fits in
  the listeners' `end`.
- **A Chord/Bass long-press on an empty column that starts a draw.** That is multi-cell paint, out
  of scope; a `null` hold keeps the lift rule instead.
- **Ignoring every pointer click on the lane, as Lead's cell click does.** Lead can, because its
  mouse paints on `pointerdown`. The lane's mouse edits on `click`, and that stays.

## Consequences

- On touch, erasing is one tap per note or event: there is no multi-cell erase drag.
- A pen on a touchscreen honours `touch-action` too, so the browser may take a pen drag on a handle
  as a pan and `pointercancel` it; that writes nothing. A mouse drag is unchanged.
- Pinch-zoom that starts on either grid is disabled; it still works elsewhere on the page.
- A swipe over either grid waits for the lifetime `touchmove` listener's quick check.
- Keyboard editing is unchanged on both grids. Only a Lead keyboard add auditions, so a tap is
  silent.
- A mobile screen reader that dispatches an activation click with `detail !== 0` after an earlier
  finger touch would be dropped by the lane's filter. If a device check finds this, the fallback is
  to arm the flag per tap and consume it on the next click.
- The Android `contextmenu` after an inert hold is swallowed while the session is open; once the
  finger moves past the slop the session closes. Movement normally cancels the menu.

## Rules this implies

- **R343** — on both grids touch never edits on `pointerdown`; tap, swipe and long-press as above
  through the one shared classifier and session; a long-press then lift adds on an empty cell and
  changes nothing on a note or event; a touch on a resize handle is a touch on the note or event,
  and only mouse and pen drag the handle; the lane drops the synthesized click after a touch; Lead
  cells sized by `LEAD_CELL_SIZE` on both axes, lane columns never below `PATTERN_CELL_MIN_WIDTH`
  (`.claude/rules/pattern-grids.md`).

## Sources

- Spec: `docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md`
- Plan: `docs/superpowers/plans/2026-09-24-melody-grid-touch-gestures.md`
- Spec: `docs/superpowers/specs/2026-09-24-shared-touch-gestures-pattern-lane-design.md`
- Plan: `docs/superpowers/plans/2026-09-24-shared-touch-gestures-pattern-lane.md`
```

- [ ] **Step 3: Update the 0050 row in `docs/decisions/README.md`.** Replace it with:

```md
| [0050](0050-melody-grid-touch-gestures.md) | Pattern-grid touch gestures | One shared classifier and session rule touch on the Lead/FX matrix and the custom Chord/Bass lane: a tap edits on pointerup, a swipe scrolls and writes nothing, a long-press paints (Lead) or resizes a note or event; mouse and pen are unchanged. |
```

- [ ] **Step 4: Update the rules table in `CLAUDE.md`.** In the `pattern-grids.md` row, change `melody-grid touch gestures` to `touch gestures (melody grid and custom-pattern lane)`.

- [ ] **Step 5: Check the docs for stale names.**

Run: `grep -n "leadTouchReduce\|LEAD_LONG_PRESS_MS\|LEAD_TOUCH_SLOP_PX\|Melody grid touch gestures\|melody-grid touch gestures" .claude/rules/pattern-grids.md docs/decisions/0050-melody-grid-touch-gestures.md docs/decisions/README.md CLAUDE.md`
Expected: no output.

- [ ] **Step 6: Run the full gate.**

Run: `bun run verify`
Expected: exit 0.

Run: `bun run eslint`
Expected: zero errors and zero warnings. State the decision on every warning printed by build, test or lint in the summary.

- [ ] **Step 7: Commit.**

```bash
git add .claude/rules/pattern-grids.md docs/decisions/0050-melody-grid-touch-gestures.md \
  docs/decisions/README.md CLAUDE.md
git commit -m "docs(decisions): widen R343 and ADR-0050 to the chord and bass lane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Manual check in the preview (controller).** The implementer subagents have no browser, so the controlling session runs this step. Start the `solna-dev` launch configuration (`bun run dev` on port 3000). Set the viewport to 375×812 with touch emulation. Record decisive observations in `work/browser-evidence.md`. Run each check on the Chord lane and on the Bass lane (custom pattern selected):
  1. Swipe the lane horizontally: it scrolls, and nothing is written.
  2. Tap an empty column: it activates on lift. Tap an event: Chord removes it; Bass writes the current tool. Nothing activates twice.
  3. Long-press an empty column and lift: it activates. Long-press an event and lift: it is unchanged.
  4. Long-press an event and drag right: its length previews, and it commits once on lift.
  5. Tap and swipe starting on an event's handle strip: they act as a tap and a swipe on the event.
  Then open Pattern → Lead and repeat the Lead checks (swipe, tap, long-press paint, long-press resize) to confirm it is unchanged. Then at desktop width with a mouse: a lane click activates, a handle drag resizes, and Lead drag-paints.
  Emulation does not reproduce native pan takeover, the iOS callout or the Android long-press menu. Real iOS Safari and Android Chrome checks belong to the user; say so in the summary.

---

## Self-review notes

- **Spec coverage.**
  - Shared classifier (Layer 1, `touchGesture.ts`; Tests, `components/touchGesture.test.ts`): Task 1.
  - Shared session, `null`-hold path, lift rule and `resizeHold` (Layer 1; Tests, session and `resizeHold`): Task 2.
  - Shared listeners (Layer 1, `useTouchGestureListeners.ts`; Tests, `attachTouchGestureListeners`): Task 3.
  - Lead adapter and `useLeadNotePaint` (Layer 2a; Tests, Lead regression contract): Task 4.
  - Visuals: 28px floor, `PATTERN_STEP_PX`, scroller and grid classes (Layer 3): Task 5. The handle's `touch-none` removal and its comment: Task 6.
  - Chord/Bass adapter, hook, wrapper routing, widened `startResize`, `cancel`, click de-dup and the header comment (Layer 2b; Tests, `patternTouch.test.ts`, click filter, `renderToString`): Task 6.
  - Docs (R343, ADR-0050, README, CLAUDE.md): Task 7. The manual preview check: Task 7 Step 8.
  - Constraints: R016 (closures and refs only), R125 (`resizeHold` over `useSpanResize`), R212 (writes only through `onActivate`, `onResize` and the paint controller), R014/R316 (`detach` disposes), no ad-hoc window listeners (Task 6 source test), no DOM in tests.
- **Spec ambiguities, resolved here.**
  - The spec asks the `resizeHold` + `createSpanResizeSlot` pairing to show that "an unmoved lift commits nothing and does not click". At the core level the slot's unmoved outcome *is* the span `onClick`; whether it activates is the adapter's choice. Task 2 pins that the unmoved lift commits nothing and reaches `onClick` once. The "no activation, no erase" half is pinned by each adapter: Task 6 ("an unmoved lift neither resizes nor activates") and Lead's existing "a long-press and an unmoved lift keeps a 1-step note".
  - The spec lists the handle's `touch-none` removal under visuals. Without the touch routing it would leave a commit where a finger on the handle starts a drag the browser then cancels, so it lands with the routing in Task 6.
  - "Attaches once in an effect with empty deps" would trip `react-hooks/exhaustive-deps` if the effect read its parameters. `useTouchGestureListeners` keeps its first arguments in a local ref.
  - The spec gives `attachTouchGestureListeners` a required element. The plan accepts `null` and still attaches the window listeners, as Lead's current effect does with `matrix?.`, so a missing element can never leave a mouse stroke unclosed.
  - The rules file's `paths:` must list the three root files, or R343 would not load when they are edited. The spec is silent; Task 7 adds them.
  - `browserTouchClock` is shared by the two hooks, so the real `now`/`schedule` pair is written once. Lead's `LeadTouchDeps` keeps its members.
  - `patternCellNode` would approach the function-length cap with the touch wiring inline. Task 6 splits the event branch into `patternHeadNode`.
- **Type consistency:** `TouchGesturePointer`, `TouchHold`, `TouchGestureTarget`, `TouchGestureDeps`, `TouchGestureSession`, `TouchGestureListeners`, `PatternTouchCell`, `PatternTouchDeps`, `PatternTouchHandlers`, `UsePatternTouch`, `PatternSpanIdentity`, `LeadTouchDeps` and `LeadTouchSession` are spelled the same in every task that uses them.
