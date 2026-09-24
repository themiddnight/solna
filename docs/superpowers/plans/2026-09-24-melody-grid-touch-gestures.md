# Melody Grid Touch Gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lead/FX piano roll usable on a phone: 28px square cells everywhere, and a touch gesture model where a tap edits, a swipe scrolls without editing, and a long-press paints or resizes. Mouse and pen stay as they are.

**Architecture:** Two new pure modules sit in `src/components/loop/lead/` with no DOM and no React. `leadTouchGesture.ts` holds the tap/swipe/long-press classifier and the coordinate hit test. `leadTouchSession.ts` holds the touch session that drives the existing paint controller and the existing span resize. `leadPaint.ts` routes `pointerType === 'touch'` to the session. `useLeadNotePaint` supplies timers, geometry and the lifetime window and matrix listeners. `useSpanResize` gains a plain-object start and `cancel()`. `useLeadNoteResize` gains `clickErases`.

**Tech Stack:** React 19 + TypeScript, Tailwind + daisyUI classes, Bun test runner (`bun:test`, no DOM), ESLint, Knip.

**Spec:** `docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md`

## Global Constraints

- Branch `feat/enhance-beat-pattern-ui`. One conventional commit per task. Every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- `LEAD_CELL_SIZE = 28` (renamed from `LEAD_CELL_WIDTH`) sizes both axes: columns, rows, header strips and row labels.
- `LEAD_LONG_PRESS_MS = 300` and `LEAD_TOUCH_SLOP_PX = 8`. A tap lifts before 300ms having moved less than 8px. A swipe moves 8px or more before 300ms. A long-press reaches 300ms inside the slop.
- Mouse and pen gestures are unchanged. Nothing branches on `useLayoutMode()`. The only branch is `pointerType === 'touch'`.
- R125: a span resize commits once on `pointerup`, writes nothing on `pointercancel`, and keeps its preview in local state.
- R016: no gesture state enters a zustand slice.
- R266 and `testing.md`: no DOM and no testing-library. The test seam is a pure factory. `renderToString` tests pass props directly, never `useAppStore.setState` first (R257).
- `theming.md`: no raw colours. No colour is added.
- Per-task gate: the task's `bun test <files>`, then `bun run lint`, then `bun run eslint` with **zero errors and zero warnings**. Never ignore a warning (R005/R264). Fix it, or add a line-level `eslint-disable-next-line <rule> -- <reason>`.
- ESLint `max-lines-per-function` is 100 code lines and applies to test `describe` callbacks. Keep each `describe` under it. `complexity` warns above 20.
- Knip must stay at zero findings. Export only what another file (a test included) imports.
- Rules and ADRs never record version numbers or line numbers.
- Out of scope: the Chord/Bass custom-pattern timeline and the Beat grid. Their only exposure is that `CustomPatternTimeline.tsx` must still type-check against the widened `useSpanResize`.

## Review Focus

1. **A lift at exactly the hold threshold, before the timer callback ran** (a late `setTimeout`). On an empty cell it adds one note, and on a note it leaves the note alone, exactly as a hold would. Pinned in Task 4: "a lift at the hold threshold before the timer runs still counts as a hold".
2. **A long-press stroke dragged under the sticky note-name column, or off the matrix,** paints nothing hidden. Pinned in Task 4: "a stroke dragged under the sticky note column paints nothing there" and the `leadCellAtPoint` clip tests.
3. **The grid unmounting mid-gesture** (layout switch, R316) cancels the timer, stops blocking scroll and writes nothing. Pinned in Task 4: "dispose (unmount) mid-hold cancels the timer and writes nothing".
4. **Chord/Bass resize handles still stop propagation and prevent default** when started from a React event, so a drag never toggles the span underneath. Pinned in Task 3: "a React-event start stops propagation and default, as the Chord/Bass handles rely on".
5. **Long-press on a note, then lift without dragging,** keeps the note. The span "click" outcome must not erase. Pinned in Task 3: "an unmoved release after a touch long-press keeps the note". Also in Task 4: "on a note: it starts a resize from the finger's position and paints nothing".

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/loop/lead/melodyGrid.ts` | modify | `LEAD_CELL_SIZE = 28` (renamed) |
| `src/components/loop/lead/LeadMelodyGrid.tsx` | modify | header strips and row labels sized by the constant; scroller `touch-pan-x touch-pan-y` and `data-lead-scroller`; sticky label column `data-lead-labels` |
| `src/components/loop/lead/LeadMelodyCells.tsx` | modify | `gridAutoRows`; matrix ref, `select-none`, callout off; long-press resize wiring; handle hit area; new `startResize` call shape |
| `src/components/loop/lead/leadTouchGesture.ts` | **create** | pure classifier (`leadTouchStart`, `leadTouchReduce`) and pure hit test (`leadCellAtPoint`) |
| `src/components/loop/lead/leadTouchSession.ts` | **create** | pure touch session over the paint controller and resize callbacks |
| `src/components/loop/lead/leadPaint.ts` | modify | `pointerType` routing, window end/move, `touchHolding`/`touchOpen`/`dispose` |
| `src/components/loop/lead/useLeadNotePaint.ts` | modify | builds `LeadTouchDeps`; lifetime window listeners plus matrix `touchmove` (non-passive) and `contextmenu` |
| `src/components/loop/lead/useLeadNoteResize.ts` | modify | object-shaped `startResize(pointer, target)`, `clickErases`, `cancelResize`, pure `leadResizeCallbacks` |
| `src/components/ui/useSpanResize.ts` | modify | `SpanResizePointer`, exported `openSpanResizeSession` (listens on any `EventTarget`), `cancel()` |
| `src/components/ui/spanResize.ts` | modify | comment only (20px → 28px) |
| Tests | create or modify | `leadTouchGesture.test.ts`, `leadTouchSession.test.ts`, `useSpanResize.test.ts` (new); `leadPaint.test.ts`, `useLeadNoteResize.test.ts`, `LeadMelodyGrid.test.tsx` (modified) |
| `.claude/rules/pattern-grids.md`, `docs/decisions/0050-melody-grid-touch-gestures.md`, `docs/decisions/README.md`, `CLAUDE.md`, the spec | modify or create | R343, ADR-0050, index row, rules-table row, and a spec correction (lifetime `touchmove`) |

---

### Task 1: Cell size — `LEAD_CELL_SIZE = 28` on both axes

Read first: `.claude/rules/components.md`, `.claude/rules/testing.md`, `.claude/rules/theming.md`.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts` (the `LEAD_CELL_WIDTH` declaration)
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx` (`LeadMarkerView`, `LeadMelodyHeaders` strips, `LeadRowLabels`)
- Modify: `src/components/loop/lead/LeadMelodyCells.tsx` (cell `<button>` class, matrix `<div>` style)
- Modify: `src/components/loop/lead/useLeadNoteResize.ts` (import and `pixelsPerStep`)
- Modify: `src/components/ui/spanResize.ts` (the `spanPreviewUnchanged` doc comment)
- Test: `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Produces: `export const LEAD_CELL_SIZE = 28;` in `melodyGrid.ts`. Tasks 4 and 5 divide by it. `LEAD_CELL_WIDTH` no longer exists.

- [ ] **Step 1: Write the failing test.** Add the import and a new `describe` to `LeadMelodyGrid.test.tsx`:

```tsx
import { LEAD_CELL_SIZE, leadColumnCells } from './melodyGrid';
```

(Replace the existing `import { leadColumnCells } from './melodyGrid';`.)

```tsx
describe('the cell size', () => {
  test('is 28px on both axes, from the one constant', () => {
    expect(LEAD_CELL_SIZE).toBe(28);
    const html = renderToString(<LeadMelodyGrid trackId="lead" />);
    expect(html).toContain('grid-template-columns:repeat(16, 28px);grid-auto-rows:28px');
    // No Tailwind row height survives: cells, both header strips and the
    // note-name column all read the constant, so the touch hit test's
    // row divisor is the same number as its column divisor.
    expect(html).not.toMatch(/class="[^"]*\bh-5\b/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `bun test src/components/loop/lead/LeadMelodyGrid.test.tsx -t "the cell size"`
Expected: FAIL. `LEAD_CELL_SIZE` is not exported (a TypeScript/undefined error), or the assertion fails because it finds `repeat(16, 20px)`.

- [ ] **Step 3: Rename the constant everywhere in `src/`.**

```bash
grep -rl LEAD_CELL_WIDTH src | xargs sed -i '' 's/LEAD_CELL_WIDTH/LEAD_CELL_SIZE/g'
grep -rn LEAD_CELL_WIDTH src   # expect no output
```

- [ ] **Step 4: Change the value and its doc comment in `melodyGrid.ts`.**

```ts
/**
 * Fixed cell size in px, on BOTH axes: the column width, the row height,
 * the marker's translateX stride, the resize drag's pixels-per-step and the
 * touch hit test's divisor. One number, so none of them can drift.
 */
export const LEAD_CELL_SIZE = 28;
```

- [ ] **Step 5: Size the rows from the constant.**

In `LeadMelodyCells.tsx`, the matrix `<div>` becomes:

```tsx
    <div
      className="grid shrink-0"
      style={{
        gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_SIZE}px)`,
        gridAutoRows: `${LEAD_CELL_SIZE}px`,
      }}
    >
```

In the cell `<button>` className, delete `h-5`, so the class begins `relative border border-base-300`:

```tsx
      className={`relative border border-base-300 ${span || inactive} ${
        kind === 'none' || kind === 'start' ? sep : ''
      }`}
```

In `LeadMelodyGrid.tsx` (`LeadMelodyHeaders`), make these changes:
- Bar strip button: remove `h-5 ` from the class string and set `style={{ width: LEAD_CELL_SIZE, height: LEAD_CELL_SIZE }}`.
- Beat strip button: remove `h-5 ` from the class string and set `style={{ width: LEAD_CELL_SIZE, height: LEAD_CELL_SIZE }}`.
- Replace the strip comment `Both strips are h-5 — one grid row cell tall — so a bar and a beat are pointer targets rather than 8px bands.` with `Both strips are one grid row tall (LEAD_CELL_SIZE), so a bar and a beat are pointer targets rather than thin bands.`

In `LeadRowLabels`, remove `h-5 ` from the class string and add `style={{ height: LEAD_CELL_SIZE }}`:

```tsx
        <button
          key={note}
          type="button"
          onClick={() => onPreview(note)}
          title={`Preview ${rowLabels[rowIndex]}`}
          className={`flex items-center justify-end pr-2 text-[10px] leading-none cursor-pointer ${leadRowLabelTone(outOfScale[rowIndex])}`}
          style={{ height: LEAD_CELL_SIZE }}
        >
```

In `src/components/ui/spanResize.ts`, change `at 20px, most moves of a gesture` to `at Lead's 28px, most moves of a gesture`.

- [ ] **Step 6: Update the pinned geometry in `LeadMelodyGrid.test.tsx`.**

```bash
f=src/components/loop/lead/LeadMelodyGrid.test.tsx
sed -i '' -e 's/16 columns of 20px/16 columns of 28px/' \
  -e 's/repeat(16, 20px)/repeat(16, 28px)/' \
  -e 's/translateX(60px)/translateX(84px)/g' \
  -e 's|// 3 × 20|// 3 × 28|' \
  -e "s/split('width:20px')/split('width:28px')/g" \
  -e 's/text-base-content\/60" style="width:20px">3<\/button>/text-base-content\/60" style="width:28px;height:28px">3<\/button>/' \
  -e 's/aria-pressed="true" class="relative h-5/aria-pressed="true" class="relative border/' "$f"
grep -n '20px\|h-5' "$f"   # only the lines rewritten below may remain
```

Then, in the test `both strips are a full grid row tall, and the DEV-371 contract survives it`, replace the `h-5` comment and assertion:

```tsx
    // Every strip cell is one grid row tall — LEAD_CELL_SIZE, the constant
    // the cells and the note-name column also size by.
    expect(html.split('style="width:28px;height:28px"').length - 1).toBe(32);
```

- [ ] **Step 7: Run the grid tests.**

Run: `bun test src/components/loop/lead/`
Expected: PASS, with no reference to 20px left.

- [ ] **Step 8: Gate.**

Run: `bun run lint && bun run eslint`
Expected: exit 0, with zero errors and zero warnings.

- [ ] **Step 9: Commit.**

```bash
git add src/components/loop/lead src/components/ui/spanResize.ts
git commit -m "feat(lead): size melody grid cells from one 28px constant on both axes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure touch-gesture classifier

Read first: `.claude/rules/pattern-grids.md`, `.claude/rules/testing.md`.

**Files:**
- Create: `src/components/loop/lead/leadTouchGesture.ts`
- Test: `src/components/loop/lead/leadTouchGesture.test.ts`

**Interfaces:**
- Produces (exported):
  - `LEAD_LONG_PRESS_MS: 300` and `LEAD_TOUCH_SLOP_PX: 8`
  - `interface LeadTouchState { phase: 'pending' | 'tap' | 'long-press' | 'scroll' | 'cancelled'; downAt: number; downX: number; downY: number }`
  - `type LeadTouchEvent = { type: 'move' | 'up'; t: number; x: number; y: number } | { type: 'timer' } | { type: 'cancel' }`
  - `leadTouchStart(t: number, x: number, y: number): LeadTouchState`
  - `leadTouchReduce(state: LeadTouchState, event: LeadTouchEvent): LeadTouchState`. Every state other than `pending` is returned as-is (the same object).

- [ ] **Step 1: Write the failing test.** Create `leadTouchGesture.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  LEAD_LONG_PRESS_MS,
  LEAD_TOUCH_SLOP_PX,
  leadTouchReduce,
  leadTouchStart,
  type LeadTouchEvent,
  type LeadTouchState,
} from './leadTouchGesture';

const DOWN_AT = 1000;
const start = (): LeadTouchState => leadTouchStart(DOWN_AT, 100, 100);
const move = (dt: number, dx: number, dy = 0): LeadTouchEvent => ({
  type: 'move',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});
const up = (dt: number, dx = 0, dy = 0): LeadTouchEvent => ({
  type: 'up',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});

describe('leadTouchReduce — the gesture table', () => {
  test('the thresholds are the agreed 300ms and 8px', () => {
    expect(LEAD_LONG_PRESS_MS).toBe(300);
    expect(LEAD_TOUCH_SLOP_PX).toBe(8);
  });

  test('a lift before the hold, inside the slop, is a tap', () => {
    expect(leadTouchReduce(start(), up(299, 7)).phase).toBe('tap');
  });

  test('a lift at exactly the hold is a long-press, never a tap', () => {
    expect(leadTouchReduce(start(), up(300)).phase).toBe('long-press');
    expect(leadTouchReduce(start(), up(301)).phase).toBe('long-press');
  });

  test('the timer turns a still finger into a long-press', () => {
    expect(leadTouchReduce(start(), { type: 'timer' }).phase).toBe('long-press');
  });

  test('moving 8px before the hold is a scroll; 7px is still pending', () => {
    expect(leadTouchReduce(start(), move(50, 8)).phase).toBe('scroll');
    expect(leadTouchReduce(start(), move(50, 7)).phase).toBe('pending');
    expect(leadTouchReduce(start(), move(50, 0, -8)).phase).toBe('scroll');
  });

  test('the slop is a distance, not per axis', () => {
    // 6px right and 6px down is 8.49px from the down point.
    expect(leadTouchReduce(start(), move(50, 6, 6)).phase).toBe('scroll');
    // 5px and 5px is 7.07px.
    expect(leadTouchReduce(start(), move(50, 5, 5)).phase).toBe('pending');
  });

  test('a lift after moving past the slop, before the hold, is a scroll, not a tap', () => {
    expect(leadTouchReduce(start(), up(120, 12)).phase).toBe('scroll');
  });

  test('a move once the hold is due counts as the hold, whatever its distance', () => {
    // The gesture is only still pending because it stayed inside the slop
    // until now; a late timer must not turn a hold into a scroll.
    expect(leadTouchReduce(start(), move(301, 40)).phase).toBe('long-press');
  });

  test('cancel from pending is cancelled', () => {
    expect(leadTouchReduce(start(), { type: 'cancel' }).phase).toBe('cancelled');
  });
});

describe('leadTouchReduce — every verdict is final', () => {
  const verdicts: LeadTouchEvent[] = [up(100), { type: 'timer' }, move(50, 20), { type: 'cancel' }];
  for (const verdict of verdicts) {
    test(`after ${verdict.type}, no later event changes the state`, () => {
      const settled = leadTouchReduce(start(), verdict);
      for (const later of [move(400, 0), up(500), { type: 'timer' } as const, { type: 'cancel' } as const]) {
        expect(leadTouchReduce(settled, later)).toBe(settled);
      }
    });
  }
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `bun test src/components/loop/lead/leadTouchGesture.test.ts`
Expected: FAIL with `Cannot find module './leadTouchGesture'`.

- [ ] **Step 3: Implement.** Create `leadTouchGesture.ts`:

```ts
/**
 * Touch gestures on the melody grid, decided with no DOM, no React and no
 * timers: the caller feeds timestamps and positions, this answers what the
 * finger meant. Mouse and pen never come here — they paint on pointerdown.
 *
 * The table (R343): a lift before LEAD_LONG_PRESS_MS inside the slop is a
 * TAP; LEAD_TOUCH_SLOP_PX of travel before that is a SCROLL (the browser's,
 * nothing is written); reaching LEAD_LONG_PRESS_MS inside the slop is a
 * LONG-PRESS, after which the session — not this reducer — owns the finger.
 */

/** How long a still finger must stay down to become a long-press. */
export const LEAD_LONG_PRESS_MS = 300;

/** How far a finger may drift before the gesture is a scroll. */
export const LEAD_TOUCH_SLOP_PX = 8;

type LeadTouchPhase = 'pending' | 'tap' | 'long-press' | 'scroll' | 'cancelled';

export interface LeadTouchState {
  phase: LeadTouchPhase;
  downAt: number;
  downX: number;
  downY: number;
}

interface LeadTouchPointerEvent {
  type: 'move' | 'up';
  t: number;
  x: number;
  y: number;
}

/** `timer` is the scheduled LEAD_LONG_PRESS_MS callback; it carries no time
 * because firing at all is the proof that the hold elapsed. */
export type LeadTouchEvent = LeadTouchPointerEvent | { type: 'timer' } | { type: 'cancel' };

export function leadTouchStart(t: number, x: number, y: number): LeadTouchState {
  return { phase: 'pending', downAt: t, downX: x, downY: y };
}

/**
 * One step of the classifier. Order matters: cancel, then TIME, then
 * distance. Time goes first because a gesture is only still pending if it
 * stayed inside the slop until now — so a late timer, or a move or lift that
 * arrives after the hold was due, still counts as the hold.
 */
export function leadTouchReduce(state: LeadTouchState, event: LeadTouchEvent): LeadTouchState {
  if (state.phase !== 'pending') return state;
  if (event.type === 'cancel') return { ...state, phase: 'cancelled' };
  if (event.type === 'timer') return { ...state, phase: 'long-press' };
  if (event.t - state.downAt >= LEAD_LONG_PRESS_MS) return { ...state, phase: 'long-press' };
  if (Math.hypot(event.x - state.downX, event.y - state.downY) >= LEAD_TOUCH_SLOP_PX) {
    return { ...state, phase: 'scroll' };
  }
  return event.type === 'up' ? { ...state, phase: 'tap' } : state;
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `bun test src/components/loop/lead/leadTouchGesture.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate.**

Run: `bun run lint && bun run eslint`
Expected: zero errors and zero warnings.

- [ ] **Step 6: Commit.**

```bash
git add src/components/loop/lead/leadTouchGesture.ts src/components/loop/lead/leadTouchGesture.test.ts
git commit -m "feat(lead): classify melody-grid touches as tap, swipe or long-press

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Span resize — plain-object start, `cancel()`, `clickErases`, larger handle hit area

Read first: `.claude/rules/pattern-grids.md` (R125), `.claude/rules/components.md`, `.claude/rules/theming.md`.

**Files:**
- Modify: `src/components/ui/useSpanResize.ts`
- Modify: `src/components/loop/lead/useLeadNoteResize.ts`
- Modify: `src/components/loop/lead/LeadMelodyCells.tsx` (handle `<span>`: call shape and hit-area classes)
- Test: `src/components/ui/useSpanResize.test.ts` (create), `src/components/loop/lead/useLeadNoteResize.test.ts`, `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `SpanResizeStart`, `SpanResizePreview`, `SpanResizeDrag` and `spanResizeOutcome` (existing).
- Produces:
  - `export interface SpanResizePointer { pointerId: number; clientX: number; stopPropagation?: () => void; preventDefault?: () => void }` (`useSpanResize.ts`)
  - `export function openSpanResizeSession<T>(pointer: SpanResizePointer, input: SpanResizeStart<T>, setPreview: React.Dispatch<React.SetStateAction<SpanResizePreview<T> | null>>, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): { cancel: () => void }`
  - `useSpanResize<T>()` returns `{ previewFor, startResize: (pointer: SpanResizePointer, input: SpanResizeStart<T>) => void, cancel: () => void }`
  - `useLeadNoteResize(trackId)` returns `{ preview, startResize: (pointer: SpanResizePointer, target: { stepIndex: number; note: string; startLen: number; maxLen: number; stride: number; clickErases?: boolean }) => void, cancelResize: () => void }`
  - `export function leadResizeCallbacks(write: { setNoteLength(stepIndex: number, note: string, len: number): void; erase(stepIndex: number, note: string): void }, stride: number, clickErases: boolean): { onCommit, onClick }`

- [ ] **Step 1: Write the failing session tests.** Create `src/components/ui/useSpanResize.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type React from 'react';
import type { SpanResizePreview } from './spanResize';
import { openSpanResizeSession, type SpanResizeStart } from './useSpanResize';

type Preview = SpanResizePreview<string> | null;

function previewBox(): { set: React.Dispatch<React.SetStateAction<Preview>>; get: () => Preview } {
  let value: Preview = null;
  return {
    set: (next) => {
      value = typeof next === 'function' ? next(value) : next;
    },
    get: () => value,
  };
}

/** A pointer event as the session reads it: a real Event with the two fields added. */
const pointerEvent = (type: string, pointerId: number, clientX: number): Event =>
  Object.assign(new Event(type), { pointerId, clientX });

function rig() {
  const target = new EventTarget();
  const preview = previewBox();
  const commits: Array<[string, number]> = [];
  const clicks: string[] = [];
  const input: SpanResizeStart<string> = {
    identity: 'C4:0',
    startLength: 2,
    maxLength: 8,
    pixelsPerStep: 28,
    onCommit: (id, length) => {
      commits.push([id, length]);
    },
    onClick: (id) => {
      clicks.push(id);
    },
  };
  return { target, preview, commits, clicks, input };
}

describe('openSpanResizeSession', () => {
  test('a React-event start stops propagation and default, as the Chord/Bass handles rely on', () => {
    const { target, preview, input } = rig();
    let stopped = 0;
    let prevented = 0;
    openSpanResizeSession(
      {
        pointerId: 1,
        clientX: 100,
        stopPropagation: () => {
          stopped += 1;
        },
        preventDefault: () => {
          prevented += 1;
        },
      },
      input,
      preview.set,
      target,
    );
    expect([stopped, prevented]).toEqual([1, 1]);
  });

  test('a plain-object start (the touch long-press) works without either', () => {
    const { target, preview, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    expect(preview.get()).toEqual({ identity: 'C4:0', length: 2 });
  });

  test('a moved pointerup commits once, at the step-quantised length', () => {
    const { target, preview, commits, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointermove', 1, 156));
    expect(preview.get()?.length).toBe(4);
    target.dispatchEvent(pointerEvent('pointerup', 1, 156));
    expect(commits).toEqual([['C4:0', 4]]);
    expect(preview.get()).toBeNull();
  });

  test('pointercancel commits nothing and clears the preview (R125)', () => {
    const { target, preview, commits, clicks, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointermove', 1, 156));
    target.dispatchEvent(pointerEvent('pointercancel', 1, 156));
    expect(commits).toEqual([]);
    expect(clicks).toEqual([]);
    expect(preview.get()).toBeNull();
  });

  test('cancel() detaches: a later pointerup commits nothing', () => {
    const { target, preview, commits, input } = rig();
    const session = openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointermove', 1, 156));
    session.cancel();
    target.dispatchEvent(pointerEvent('pointerup', 1, 156));
    expect(commits).toEqual([]);
    expect(preview.get()).toBeNull();
  });

  test("another pointer's release does not end the drag", () => {
    const { target, preview, commits, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointerup', 2, 300));
    expect(commits).toEqual([]);
    expect(preview.get()).not.toBeNull();
  });

  test('an unmoved pointerup is a click on the span', () => {
    const { target, preview, clicks, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointerup', 1, 102));
    expect(clicks).toEqual(['C4:0']);
  });
});
```

- [ ] **Step 2: Write the failing Lead adapter and handle tests.** Append to `useLeadNoteResize.test.ts` (and add `leadResizeCallbacks` to its import from `./useLeadNoteResize`):

```ts
describe('leadResizeCallbacks', () => {
  function writes() {
    const lengths: Array<[number, string, number]> = [];
    const erased: Array<[number, string]> = [];
    return {
      lengths,
      erased,
      write: {
        setNoteLength: (stepIndex: number, note: string, len: number) => {
          lengths.push([stepIndex, note, len]);
        },
        erase: (stepIndex: number, note: string) => {
          erased.push([stepIndex, note]);
        },
      },
    };
  }

  test('a drag commits the new length in ticks', () => {
    const w = writes();
    leadResizeCallbacks(w.write, 2, true).onCommit({ stepIndex: 4, note: 'C4' }, 3);
    expect(w.lengths).toEqual([[4, 'C4', 6]]);
  });

  test('an unmoved release on the handle erases the note, as a click on it does', () => {
    const w = writes();
    leadResizeCallbacks(w.write, 2, true).onClick({ stepIndex: 4, note: 'C4' });
    expect(w.erased).toEqual([[4, 'C4']]);
  });

  test('an unmoved release after a touch long-press keeps the note', () => {
    // A hold and lift is not a tap: the note survives.
    const w = writes();
    leadResizeCallbacks(w.write, 2, false).onClick({ stepIndex: 4, note: 'C4' });
    expect(w.erased).toEqual([]);
    expect(w.lengths).toEqual([]);
  });
});
```

Append to `LeadMelodyGrid.test.tsx`. Add these imports: `import { LeadMelodyCells } from './LeadMelodyCells';`, `import type { LeadNote } from '@/audio/playback/leadMelody';`, and `import { LEAD_TICKS_PER_BAR, columnsPerBar, strideFor } from '@/utils/stepResolution';`.

```tsx
describe('the resize handle', () => {
  function cellsWithOneNote(): string {
    const meter = getMeter('4/4');
    const stride = strideFor(null);
    const melody: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    melody[0] = [{ note: 'C4', len: stride }];
    // Props passed directly: renderToString serves the store's creation-time
    // state, so a setState here would have no effect (R257).
    return renderToString(
      <LeadMelodyCells
        trackId="lead"
        meter={meter}
        loopLength={1}
        melody={melody}
        rows={['C4']}
        rowLabels={['C4']}
        outOfScale={[false]}
        root="C"
        onResize={() => {}}
        stride={stride}
        colsPerBar={columnsPerBar(meter.stepsPerBar, stride)}
        cellsPerBar={leadColumnCells(meter, stride)}
        onPreview={() => {}}
      />,
    );
  }

  test('keeps its visible 8px strip but grabs across 16px, all inside the end cell', () => {
    const html = cellsWithOneNote();
    expect(html).toContain(
      'class="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none before:absolute before:inset-y-0 before:right-0 before:w-4"',
    );
  });
});
```

- [ ] **Step 3: Run them and confirm they fail.**

Run: `bun test src/components/ui/useSpanResize.test.ts src/components/loop/lead/useLeadNoteResize.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx`
Expected: FAIL. `openSpanResizeSession` and `leadResizeCallbacks` are not exported, and the handle class lacks `before:w-4`.

- [ ] **Step 4: Implement `useSpanResize.ts`.** Replace the hook with a pure session plus a thin hook. Keep the existing docblocks on `SpanResizeStart` and the hook, and keep the WINDOW comment on the listeners.

```ts
import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import {
  resizeLengthAtPointer,
  spanPreviewUnchanged,
  spanResizeMoved,
  spanResizeOutcome,
  type SpanResizeDrag,
  type SpanResizePreview,
} from './spanResize';

// SpanResizeStart<TIdentity> — unchanged.

/**
 * What a resize reads to start. A React pointer event qualifies (Chord/Bass
 * and the Lead handle pass theirs, and get propagation and default stopped);
 * so does a plain object, which is how a touch long-press starts a resize
 * after its pointerdown has long passed.
 */
export interface SpanResizePointer {
  pointerId: number;
  clientX: number;
  stopPropagation?: () => void;
  preventDefault?: () => void;
}

/** The fields a session reads off a window pointer event. */
interface SpanResizePointerEvent extends Event {
  pointerId: number;
  clientX: number;
}

/** `window` in the app; a bare EventTarget in tests. */
type SpanResizeTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * One resize gesture's listeners, with no React in it — the hook below is a
 * wrapper, and this is the part a test can drive with a plain EventTarget.
 * `cancel` detaches and clears the preview without committing: a gesture the
 * caller abandons writes nothing, exactly as a pointercancel (R125).
 */
export function openSpanResizeSession<TIdentity>(
  pointer: SpanResizePointer,
  input: SpanResizeStart<TIdentity>,
  setPreview: React.Dispatch<React.SetStateAction<SpanResizePreview<TIdentity> | null>>,
  target: SpanResizeTarget,
): { cancel: () => void } {
  // Never let the gesture reach the element's own click handling, or the
  // drag would toggle off the very thing it started on.
  pointer.stopPropagation?.();
  pointer.preventDefault?.();
  const drag: SpanResizeDrag<TIdentity> = {
    identity: input.identity,
    startLength: input.startLength,
    maxLength: input.maxLength,
    pixelsPerStep: input.pixelsPerStep,
    startX: pointer.clientX,
    pointerId: pointer.pointerId,
    moved: false,
  };
  setPreview({ identity: drag.identity, length: drag.startLength });

  const onMove = (event: Event): void => {
    const ev = event as SpanResizePointerEvent;
    if (ev.pointerId !== drag.pointerId) return;
    if (!drag.moved && spanResizeMoved(drag.startX, ev.clientX)) drag.moved = true;
    const next: SpanResizePreview<TIdentity> = {
      identity: drag.identity,
      length: resizeLengthAtPointer(
        drag.startLength,
        ev.clientX - drag.startX,
        drag.pixelsPerStep,
        drag.maxLength,
      ),
    };
    setPreview((prev) => (spanPreviewUnchanged(prev, next) ? prev : next));
  };
  const detach = (): void => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onEnd);
    target.removeEventListener('pointercancel', onEnd);
    setPreview(null);
  };
  const onEnd = (event: Event): void => {
    const ev = event as SpanResizePointerEvent;
    if (ev.pointerId !== drag.pointerId) return;
    detach();
    const outcome = spanResizeOutcome(drag, ev.type, ev.clientX);
    if (outcome.kind === 'resize') {
      input.onCommit(outcome.identity, outcome.length);
    } else if (outcome.kind === 'click') {
      input.onClick(outcome.identity);
    }
  };
  // WINDOW, not the grabbed handle, and no setPointerCapture. A handle that
  // sits at the END of a span is relocated by the first preview growth:
  // React unmounts the element the gesture started on, taking a pointer
  // capture and its listeners with it. Listening on window is immune to
  // that; pointerId keeps a second touch from steering someone else's drag.
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
  return { cancel: detach };
}

export function useSpanResize<TIdentity>(): {
  previewFor: (identity: TIdentity) => number | null;
  startResize: (pointer: SpanResizePointer, input: SpanResizeStart<TIdentity>) => void;
  /** Abandon the live gesture: no commit, preview cleared. */
  cancel: () => void;
} {
  const [preview, setPreview] = useState<SpanResizePreview<TIdentity> | null>(null);
  const sessionRef = useRef<{ cancel: () => void } | null>(null);

  const previewFor = useCallback(
    (identity: TIdentity): number | null =>
      preview !== null && preview.identity === identity ? preview.length : null,
    [preview],
  );

  const startResize = useCallback(
    (pointer: SpanResizePointer, input: SpanResizeStart<TIdentity>): void => {
      sessionRef.current = openSpanResizeSession(pointer, input, setPreview, window);
    },
    [],
  );

  const cancel = useCallback((): void => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
  }, []);

  return { previewFor, startResize, cancel };
}
```

If ESLint flags the two `as SpanResizePointerEvent` assertions, keep them and add `// eslint-disable-next-line <rule> -- window pointer listeners receive PointerEvent; EventTarget types them as Event`.

- [ ] **Step 5: Implement `useLeadNoteResize.ts`.** Keep `LeadResizePreview`, `LeadResizeIdentity`, `LeadResizeGesture`, `leadTicksFromCells` and the docblocks. Replace the hook and add the pure callbacks:

```ts
import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '@/store/store';
import { type MelodyTrackId } from '@/store/melodyTracks';
import { MELODY_ACTIONS } from '@/store/leadSlice';
import {
  useSpanResize,
  type SpanResizePointer,
  type SpanResizeStart,
} from '@/components/ui/useSpanResize';
import { LEAD_CELL_SIZE } from './melodyGrid';

/** The two writes a finished Lead resize can make. */
interface LeadResizeWrites {
  setNoteLength: (stepIndex: number, note: string, len: number) => void;
  erase: (stepIndex: number, note: string) => void;
}

/** What one resize grabs, and whether an unmoved release erases it. */
interface LeadResizeTarget {
  stepIndex: number;
  note: string;
  startLen: number;
  maxLen: number;
  stride: number;
  /**
   * An unmoved release is a click on the span, which erases it — right for
   * the mouse handle. A touch long-press passes false: a hold and lift is
   * not a tap, so the note must survive it.
   */
  clickErases?: boolean;
}

/**
 * The end-of-gesture writes, pure so the clickErases ruling is testable
 * without a DOM.
 */
export function leadResizeCallbacks(
  write: LeadResizeWrites,
  stride: number,
  clickErases: boolean,
): Pick<SpanResizeStart<LeadResizeIdentity>, 'onCommit' | 'onClick'> {
  return {
    onCommit: (target, cells) =>
      write.setNoteLength(target.stepIndex, target.note, leadTicksFromCells(cells, stride)),
    onClick: (target) => {
      if (clickErases) write.erase(target.stepIndex, target.note);
    },
  };
}

export function useLeadNoteResize(trackId: MelodyTrackId): {
  preview: LeadResizePreview | null;
  startResize: (pointer: SpanResizePointer, target: LeadResizeTarget) => void;
  cancelResize: () => void;
} {
  const actions = MELODY_ACTIONS[trackId];
  const {
    previewFor,
    startResize: startSpanResize,
    cancel: cancelResize,
  } = useSpanResize<LeadResizeIdentity>();
  const [gesture, setGesture] = useState<LeadResizeGesture | null>(null);

  const startResize = useCallback(
    (pointer: SpanResizePointer, target: LeadResizeTarget) => {
      const identity: LeadResizeIdentity = { stepIndex: target.stepIndex, note: target.note };
      setGesture({ identity, stride: target.stride });
      startSpanResize(pointer, {
        identity,
        startLength: target.startLen,
        maxLength: target.maxLen,
        pixelsPerStep: LEAD_CELL_SIZE,
        ...leadResizeCallbacks(
          {
            setNoteLength: (stepIndex, note, len) =>
              useAppStore.getState()[actions.setNoteLength](stepIndex, note, len),
            erase: (stepIndex, note) =>
              useAppStore.getState()[actions.paintNote](stepIndex, note, 'erase'),
          },
          target.stride,
          target.clickErases ?? true,
        ),
      });
    },
    [actions, startSpanResize],
  );

  const preview = useMemo<LeadResizePreview | null>(() => {
    if (!gesture) return null;
    const cells = previewFor(gesture.identity);
    if (cells === null) return null;
    return {
      stepIndex: gesture.identity.stepIndex,
      note: gesture.identity.note,
      len: leadTicksFromCells(cells, gesture.stride),
    };
  }, [gesture, previewFor]);

  return { preview, startResize, cancelResize };
}
```

The file's existing test asserts `useSpanResize<LeadResizeIdentity>()` appears verbatim, and the call above keeps that text on one line.

- [ ] **Step 6: Update the handle in `LeadMelodyCells.tsx`.** Change the call shape and widen the hit area. The pseudo-element is anchored to the handle's right edge and extends 16px inward, so it never covers the next cell.

```tsx
        <span
          aria-hidden="true"
          onPointerDown={(e) => {
            const { spanStartIdx, spanCells, startCol } = spanAt(col);
            startResize(e, {
              stepIndex: spanStartIdx,
              note,
              startLen: spanCells,
              maxLen: columns - startCol,
              stride,
            });
          }}
          // touch-none: without it a touch drag the browser turns into a
          // scroll fires pointercancel, which correctly discards — so the
          // gesture would silently do nothing on a touch device.
          // before:*: the visible strip stays w-2; the grab area is 16px,
          // all inside this end cell so it never takes a neighbour's tap.
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none before:absolute before:inset-y-0 before:right-0 before:w-4"
        />
```

- [ ] **Step 7: Run the tests and confirm they pass.**

Run: `bun test src/components/ui/ src/components/loop/lead/ src/components/loop/chord/`
Expected: PASS. The Chord/Bass timeline tests stay unchanged and green.

- [ ] **Step 8: Gate.**

Run: `bun run lint && bun run eslint`
Expected: zero errors and zero warnings. `CustomPatternTimeline.tsx` type-checks unchanged, because a React pointer event is a `SpanResizePointer`.

- [ ] **Step 9: Commit.**

```bash
git add src/components/ui/useSpanResize.ts src/components/ui/useSpanResize.test.ts \
  src/components/loop/lead/useLeadNoteResize.ts src/components/loop/lead/useLeadNoteResize.test.ts \
  src/components/loop/lead/LeadMelodyCells.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx
git commit -m "feat(resize): start a span resize from a plain pointer and let it be cancelled

Adds clickErases to the Lead adapter and a 16px grab area on the handle.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Coordinate hit test and the pure touch session

Read first: `.claude/rules/pattern-grids.md`, `.claude/rules/components.md` (placement R276), `.claude/rules/testing.md`.

**Files:**
- Modify: `src/components/loop/lead/leadTouchGesture.ts` (add the hit test)
- Create: `src/components/loop/lead/leadTouchSession.ts`
- Test: `src/components/loop/lead/leadTouchGesture.test.ts`, `src/components/loop/lead/leadTouchSession.test.ts` (create)

**Interfaces:**
- Consumes:
  - `LEAD_CELL_SIZE` (Task 1), `leadTouchStart`, `leadTouchReduce`, `LEAD_LONG_PRESS_MS`, `LeadTouchState` and `LeadTouchEvent` (Task 2), `SpanResizePointer` (Task 3)
  - `LeadPaintController` (`leadPaint.ts`, existing): `begin(pointerId, stepIndex, col, note, covered)`, `visit(pointerId, stepIndex, col, note)`, `end(pointerId)`
- Produces:
  - `export interface LeadGridGeometry { left: number; top: number; clipLeft: number; clipRight: number; columns: number; rowCount: number }` and `export function leadCellAtPoint(g: LeadGridGeometry, x: number, y: number): { col: number; row: number } | null` (`leadTouchGesture.ts`)
  - `export interface LeadTouchDeps { now(): number; schedule(ms: number, fn: () => void): () => void; measure(): LeadGridGeometry | null; rowNote(row: number): string | undefined; resolveStepIndex(col: number): number; startNoteResize(pointer: SpanResizePointer, col: number, note: string): void; cancelNoteResize(): void }`
  - `export interface LeadTouchSession { down(p: { pointerId: number; clientX: number; clientY: number }, cell: { stepIndex: number; col: number; note: string; covered: boolean }): void; move(p): void; end(p, type: 'pointerup' | 'pointercancel'): boolean; holding(): boolean; isOpen(): boolean; dispose(): void }`
  - `export function createLeadTouchSession(controller: LeadPaintController, deps: LeadTouchDeps): LeadTouchSession`

- [ ] **Step 1: Write the failing hit-test tests.** Append to `leadTouchGesture.test.ts`, extending its import with `leadCellAtPoint` and `type LeadGridGeometry`, and adding `import { LEAD_CELL_SIZE } from './melodyGrid';`:

```ts
describe('leadCellAtPoint', () => {
  const S = LEAD_CELL_SIZE;
  const grid: LeadGridGeometry = {
    left: 100,
    top: 50,
    clipLeft: 100,
    clipRight: 100 + 16 * S,
    columns: 16,
    rowCount: 3,
  };

  test('maps a point to the cell under it, both axes by the one size', () => {
    expect(leadCellAtPoint(grid, 100, 50)).toEqual({ col: 0, row: 0 });
    expect(leadCellAtPoint(grid, 100 + S - 0.01, 50 + S - 0.01)).toEqual({ col: 0, row: 0 });
    expect(leadCellAtPoint(grid, 100 + S, 50 + S)).toEqual({ col: 1, row: 1 });
    expect(leadCellAtPoint(grid, 100 + 15 * S + 1, 50 + 2 * S + 1)).toEqual({ col: 15, row: 2 });
  });

  test('outside the matrix is no cell', () => {
    expect(leadCellAtPoint(grid, 100, 49)).toBeNull();
    expect(leadCellAtPoint(grid, 100, 50 + 3 * S)).toBeNull();
    expect(leadCellAtPoint(grid, 99, 60)).toBeNull();
  });

  test('left of the sticky note column, or right of the scroller, is no cell', () => {
    // Scrolled: the matrix starts off-screen left, and its first columns
    // sit under the sticky note-name column that ends at clipLeft.
    const scrolled: LeadGridGeometry = { ...grid, left: 100 - 4 * S, clipLeft: 144, clipRight: 400 };
    expect(leadCellAtPoint(scrolled, 143, 60)).toBeNull();
    expect(leadCellAtPoint(scrolled, 144, 60)).toEqual({ col: Math.floor((144 - (100 - 4 * S)) / S), row: 0 });
    expect(leadCellAtPoint(scrolled, 400, 60)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing session tests.** Create `leadTouchSession.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import { createLeadPaintController, type LeadPaintCommit } from './leadPaint';
import { createLeadTouchSession, type LeadTouchDeps } from './leadTouchSession';
import { LEAD_LONG_PRESS_MS } from './leadTouchGesture';
import { LEAD_CELL_SIZE } from './melodyGrid';

const ROWS = ['E4', 'D4', 'C4'];
const S = LEAD_CELL_SIZE;

/** The matrix sits at the client origin; this is a cell's centre. */
const centre = (col: number, row: number) => ({ x: col * S + S / 2, y: row * S + S / 2 });

function rig(clipLeft = 0) {
  const commits: LeadPaintCommit[] = [];
  const controller = createLeadPaintController((c) => commits.push(c), (col) => col);
  let clock = 0;
  let timer: (() => void) | null = null;
  const log = {
    resizes: [] as Array<{ pointer: SpanResizePointer; col: number; note: string }>,
    cancels: 0,
  };
  const deps: LeadTouchDeps = {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      return () => {
        if (timer === fn) timer = null;
      };
    },
    measure: () => ({ left: 0, top: 0, clipLeft, clipRight: 16 * S, columns: 16, rowCount: ROWS.length }),
    rowNote: (row) => ROWS[row],
    resolveStepIndex: (col) => col,
    startNoteResize: (pointer, col, note) => {
      log.resizes.push({ pointer, col, note });
    },
    cancelNoteResize: () => {
      log.cancels += 1;
    },
  };
  const session = createLeadTouchSession(controller, deps);
  const at = (col: number, row: number, pointerId = 7, dx = 0) => ({
    pointerId,
    clientX: centre(col, row).x + dx,
    clientY: centre(col, row).y,
  });
  return {
    session,
    commits,
    log,
    at,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let the long-press timer fire, LEAD_LONG_PRESS_MS after now. */
    hold: () => {
      clock += LEAD_LONG_PRESS_MS;
      timer?.();
    },
    down: (col: number, row: number, covered: boolean, pointerId = 7) =>
      session.down(at(col, row, pointerId), { stepIndex: col, col, note: ROWS[row], covered }),
  };
}

describe('touch tap', () => {
  test('a tap on an empty cell adds one note, on pointerup and not before', () => {
    const r = rig();
    r.down(2, 2, false);
    expect(r.commits).toEqual([]);
    r.advance(120);
    expect(r.session.end(r.at(2, 2, 7, 2), 'pointerup')).toBe(true);
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'draw' }]);
    expect(r.session.isOpen()).toBe(false);
  });

  test('a tap on a note removes it', () => {
    const r = rig();
    r.down(2, 2, true);
    r.advance(120);
    r.session.end(r.at(2, 2), 'pointerup');
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'erase' }]);
  });

  test('end answers false for a pointer it does not own, so the mouse stroke can close', () => {
    const r = rig();
    expect(r.session.end(r.at(2, 2, 99), 'pointerup')).toBe(false);
  });
});

describe('touch swipe and cancel', () => {
  test('a swipe past the slop writes nothing, and the timer after it does nothing', () => {
    const r = rig();
    r.down(2, 2, false);
    r.advance(50);
    r.session.move(r.at(2, 2, 7, 10));
    expect(r.session.isOpen()).toBe(false);
    r.hold();
    r.session.end(r.at(2, 2, 7, 10), 'pointerup');
    expect(r.commits).toEqual([]);
  });

  test('pointercancel (the browser took the pan) writes nothing', () => {
    const r = rig();
    r.down(2, 2, true);
    r.session.end(r.at(2, 2), 'pointercancel');
    r.hold();
    expect(r.commits).toEqual([]);
    expect(r.log.resizes).toEqual([]);
  });

  test('scroll is blocked only once the hold has taken the gesture', () => {
    const r = rig();
    r.down(2, 2, false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.session.holding()).toBe(false);
    r.hold();
    expect(r.session.holding()).toBe(true);
    r.session.end(r.at(2, 2), 'pointerup');
    expect(r.session.holding()).toBe(false);
  });
});

describe('touch long-press', () => {
  test('on an empty cell: the pressed cell fills at the hold, then the stroke follows the finger', () => {
    const r = rig();
    r.down(2, 2, false);
    r.hold();
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'draw' }]);
    r.session.move(r.at(3, 2));
    r.session.move(r.at(5, 2)); // skipped column 4 is filled along the row
    r.session.end(r.at(5, 2), 'pointerup');
    r.session.move(r.at(6, 2)); // after the lift: nothing
    expect(r.commits.map((c) => c.stepIndex)).toEqual([2, 3, 4, 5]);
    expect(r.commits.every((c) => c.mode === 'draw' && c.note === 'C4')).toBe(true);
  });

  test("on a note: it starts a resize from the finger's position and paints nothing", () => {
    const r = rig();
    r.down(2, 2, true);
    r.advance(100);
    r.session.move(r.at(2, 2, 7, 3)); // inside the slop
    r.hold();
    expect(r.log.resizes).toEqual([
      { pointer: { pointerId: 7, clientX: centre(2, 2).x + 3 }, col: 2, note: 'C4' },
    ]);
    r.session.end(r.at(2, 2, 7, 60), 'pointerup');
    expect(r.commits).toEqual([]);
  });

  test('a stroke dragged under the sticky note column paints nothing there', () => {
    const r = rig(2 * S); // columns 0 and 1 are hidden under the note column
    r.down(2, 2, false);
    r.hold();
    r.session.move(r.at(1, 2));
    r.session.move(r.at(0, 2));
    expect(r.commits.map((c) => c.stepIndex)).toEqual([2]);
  });

  test('a lift at the hold threshold before the timer runs still counts as a hold', () => {
    const empty = rig();
    empty.down(2, 2, false);
    empty.advance(LEAD_LONG_PRESS_MS);
    empty.session.end(empty.at(2, 2), 'pointerup');
    expect(empty.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'draw' }]);

    const note = rig();
    note.down(2, 2, true);
    note.advance(LEAD_LONG_PRESS_MS);
    note.session.end(note.at(2, 2), 'pointerup');
    expect(note.commits).toEqual([]);
    expect(note.log.resizes).toEqual([]);
  });
});

describe('touch interruptions', () => {
  test('a second finger cancels a pending touch, and is itself ignored', () => {
    const r = rig();
    r.down(2, 2, false, 7);
    r.down(5, 2, false, 8);
    expect(r.session.end(r.at(2, 2, 7), 'pointerup')).toBe(false);
    expect(r.session.end(r.at(5, 2, 8), 'pointerup')).toBe(false);
    expect(r.commits).toEqual([]);
  });

  test('a second finger during a stroke ends it; the cells already painted stay', () => {
    const r = rig();
    r.down(2, 2, false);
    r.hold();
    r.session.move(r.at(3, 2));
    r.down(8, 0, false, 8);
    r.session.move(r.at(4, 2));
    expect(r.commits.map((c) => c.stepIndex)).toEqual([2, 3]);
  });

  test('a second finger or a pointercancel during a resize aborts it', () => {
    const r = rig();
    r.down(2, 2, true);
    r.hold();
    r.down(8, 0, false, 8);
    expect(r.log.cancels).toBe(1);

    const c = rig();
    c.down(2, 2, true);
    c.hold();
    c.session.end(c.at(2, 2), 'pointercancel');
    expect(c.log.cancels).toBe(1);
  });

  test('dispose (unmount) mid-hold cancels the timer and writes nothing', () => {
    const r = rig();
    r.down(2, 2, false);
    r.session.dispose();
    r.hold();
    expect(r.commits).toEqual([]);
    expect(r.session.isOpen()).toBe(false);

    const p = rig();
    p.down(2, 2, false);
    p.hold();
    p.session.dispose();
    p.session.move(p.at(3, 2));
    expect(p.commits.map((c) => c.stepIndex)).toEqual([2]);
    expect(p.session.holding()).toBe(false);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail.**

Run: `bun test src/components/loop/lead/leadTouchGesture.test.ts src/components/loop/lead/leadTouchSession.test.ts`
Expected: FAIL. `leadCellAtPoint` is not exported, and `./leadTouchSession` cannot be found.

- [ ] **Step 4: Implement the hit test.** Append to `leadTouchGesture.ts` and add `import { LEAD_CELL_SIZE } from './melodyGrid';` at the top:

```ts
/**
 * Where the matrix is on screen, read once when a long-press starts painting.
 * Scrolling is blocked for the rest of that gesture, so it cannot go stale.
 * clipLeft is the right edge of the sticky note-name column and clipRight
 * the scroller's right edge: cells outside that band are hidden.
 */
export interface LeadGridGeometry {
  left: number;
  top: number;
  clipLeft: number;
  clipRight: number;
  columns: number;
  rowCount: number;
}

/**
 * The cell under a client point, or null. Arithmetic rather than
 * elementFromPoint: a touch pointer is captured to its pointerdown target,
 * so no pointerenter reaches other cells, and this form needs no DOM to
 * test and no per-cell attributes. It relies on square LEAD_CELL_SIZE
 * cells, which the grid guarantees.
 */
export function leadCellAtPoint(
  g: LeadGridGeometry,
  x: number,
  y: number,
): { col: number; row: number } | null {
  if (x < g.clipLeft || x >= g.clipRight) return null;
  const col = Math.floor((x - g.left) / LEAD_CELL_SIZE);
  const row = Math.floor((y - g.top) / LEAD_CELL_SIZE);
  if (col < 0 || col >= g.columns || row < 0 || row >= g.rowCount) return null;
  return { col, row };
}
```

- [ ] **Step 5: Implement the session.** Create `leadTouchSession.ts`:

```ts
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import type { LeadPaintController } from './leadPaint';
import {
  LEAD_LONG_PRESS_MS,
  leadCellAtPoint,
  leadTouchReduce,
  leadTouchStart,
  type LeadGridGeometry,
  type LeadTouchEvent,
  type LeadTouchState,
} from './leadTouchGesture';

interface LeadTouchPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** The cell a finger went down on, as the cell handler already knows it. */
interface LeadTouchCell {
  stepIndex: number;
  col: number;
  note: string;
  covered: boolean;
}

/** Everything the session cannot decide by itself; the hook supplies the DOM halves. */
export interface LeadTouchDeps {
  now: () => number;
  /** Run `fn` once after `ms`; returns a canceller. */
  schedule: (ms: number, fn: () => void) => () => void;
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

export interface LeadTouchSession {
  down: (p: LeadTouchPointer, cell: LeadTouchCell) => void;
  move: (p: LeadTouchPointer) => void;
  /** True when the pointer was this session's; false lets the mouse stroke close. */
  end: (p: LeadTouchPointer, type: 'pointerup' | 'pointercancel') => boolean;
  /** A long-press owns the finger: the grid blocks scrolling. */
  holding: () => boolean;
  /** A touch gesture is open: the grid swallows contextmenu. */
  isOpen: () => boolean;
  /** Unmount: drop everything, write nothing more. */
  dispose: () => void;
}

interface OpenTouch {
  pointerId: number;
  cell: LeadTouchCell;
  gesture: LeadTouchState;
  mode: 'classifying' | 'painting' | 'resizing';
  lastX: number;
  geometry: LeadGridGeometry | null;
  cancelTimer: () => void;
}

const noop = (): void => undefined;

/**
 * One finger's gesture on the melody grid (R343). Nothing is written on
 * pointerdown: a tap edits its cell on pointerup through the paint
 * controller, a swipe or a cancel writes nothing, and a long-press starts
 * the controller's draw stroke (empty cell) or the shared span resize (note).
 * A second finger cancels whatever the first was doing.
 */
export function createLeadTouchSession(
  controller: LeadPaintController,
  deps: LeadTouchDeps,
): LeadTouchSession {
  let current: OpenTouch | null = null;

  const close = (): void => {
    current?.cancelTimer();
    current = null;
  };

  const abort = (): void => {
    if (current?.mode === 'painting') controller.end(current.pointerId);
    if (current?.mode === 'resizing') deps.cancelNoteResize();
    close();
  };

  const hold = (t: OpenTouch): void => {
    const { stepIndex, col, note, covered } = t.cell;
    if (covered) {
      t.mode = 'resizing';
      deps.startNoteResize({ pointerId: t.pointerId, clientX: t.lastX }, col, note);
      return;
    }
    t.mode = 'painting';
    t.geometry = deps.measure();
    // Draw mode, and the pressed cell fills now: the user sees the hold took.
    controller.begin(t.pointerId, stepIndex, col, note, false);
  };

  const classify = (t: OpenTouch, event: LeadTouchEvent): void => {
    t.gesture = leadTouchReduce(t.gesture, event);
    if (t.gesture.phase === 'long-press') hold(t);
    else if (t.gesture.phase !== 'pending') close();
  };

  const release = (t: OpenTouch, p: LeadTouchPointer): void => {
    if (t.mode === 'painting') {
      controller.end(t.pointerId);
      return;
    }
    // Resizing: useSpanResize's own pointerup listener commits.
    if (t.mode !== 'classifying') return;
    const verdict = leadTouchReduce(t.gesture, {
      type: 'up',
      t: deps.now(),
      x: p.clientX,
      y: p.clientY,
    }).phase;
    const { stepIndex, col, note, covered } = t.cell;
    // A tap edits its cell. A lift at the hold threshold before the timer
    // ran is a hold: it draws on an empty cell and leaves a note alone.
    if (verdict === 'tap' || (verdict === 'long-press' && !covered)) {
      controller.begin(t.pointerId, stepIndex, col, note, covered);
      controller.end(t.pointerId);
    }
  };

  return {
    down: (p, cell) => {
      if (current) {
        abort();
        return;
      }
      const t: OpenTouch = {
        pointerId: p.pointerId,
        cell,
        gesture: leadTouchStart(deps.now(), p.clientX, p.clientY),
        mode: 'classifying',
        lastX: p.clientX,
        geometry: null,
        cancelTimer: noop,
      };
      current = t;
      t.cancelTimer = deps.schedule(LEAD_LONG_PRESS_MS, () => {
        if (current === t && t.mode === 'classifying') classify(t, { type: 'timer' });
      });
    },
    move: (p) => {
      const t = current;
      if (!t || p.pointerId !== t.pointerId) return;
      t.lastX = p.clientX;
      if (t.mode === 'classifying') {
        classify(t, { type: 'move', t: deps.now(), x: p.clientX, y: p.clientY });
        return;
      }
      if (t.mode !== 'painting' || !t.geometry) return;
      const hit = leadCellAtPoint(t.geometry, p.clientX, p.clientY);
      const note = hit ? deps.rowNote(hit.row) : undefined;
      if (!hit || note === undefined) return;
      controller.visit(t.pointerId, deps.resolveStepIndex(hit.col), hit.col, note);
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
    holding: () => current !== null && current.mode !== 'classifying',
    isOpen: () => current !== null,
    dispose: abort,
  };
}
```

- [ ] **Step 6: Run the tests and confirm they pass.**

Run: `bun test src/components/loop/lead/leadTouchGesture.test.ts src/components/loop/lead/leadTouchSession.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate.**

Run: `bun run lint && bun run eslint`
Expected: zero errors and zero warnings. If `complexity` or `max-lines-per-function` fires on `createLeadTouchSession`, move `release` or `hold` to module level as a function taking `(t, controller, deps)`. Do not disable the rule.

- [ ] **Step 8: Commit.**

```bash
git add src/components/loop/lead/leadTouchGesture.ts src/components/loop/lead/leadTouchGesture.test.ts \
  src/components/loop/lead/leadTouchSession.ts src/components/loop/lead/leadTouchSession.test.ts
git commit -m "feat(lead): add the touch session and coordinate hit test for the melody grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire touch into the grid — handlers, hook, scroller, matrix

Read first: `.claude/rules/components.md` (R265 colocated hook, R016), `.claude/rules/testing.md` (R257), `.claude/rules/pattern-grids.md`.

**Files:**
- Modify: `src/components/loop/lead/leadPaint.ts` (`LeadPaintPointerLike`, `LeadPaintHandlers`, `createLeadPaintHandlers`)
- Modify: `src/components/loop/lead/useLeadNotePaint.ts`
- Modify: `src/components/loop/lead/LeadMelodyCells.tsx` (`useLeadCellPaint`, matrix `<div>`)
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx` (scroller and sticky label column markup)
- Test: `src/components/loop/lead/leadPaint.test.ts`, `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `createLeadTouchSession`, `LeadTouchSession` and `LeadTouchDeps` (Task 4); `LeadGridGeometry` (Task 4); `useLeadNoteResize().startResize` and `cancelResize` (Task 3); `SpanResizePointer` (Task 3).
- Produces:
  - `createLeadPaintHandlers(controller, toggle, touch?: LeadTouchSession): LeadPaintHandlers`
  - `LeadPaintHandlers` gains `onWindowPointerMove(e)`, `onWindowPointerEnd(e, 'pointerup' | 'pointercancel')`, `touchHolding(): boolean`, `touchOpen(): boolean` and `dispose(): void`
  - `useLeadNotePaint(trackId, resolveStepIndex, wiring: { matrixRef; rows; columns; startNoteResize; cancelNoteResize })`
  - Markup hooks for `measure()`: `data-lead-scroller` on the scroller and `data-lead-labels` on the sticky note column

- [ ] **Step 1: Write the failing handler tests.** Append to `leadPaint.test.ts` and add `import type { LeadTouchSession } from './leadTouchSession';`:

```ts
describe('createLeadPaintHandlers — pointer routing', () => {
  function withTouch(owns = false) {
    const commits: LeadPaintCommit[] = [];
    const calls: string[] = [];
    const ctl = createLeadPaintController((c) => commits.push(c), (col) => col);
    const touch: LeadTouchSession = {
      down: (p, cell) => {
        calls.push(`down ${p.pointerId} ${cell.col} ${cell.note} ${cell.covered}`);
      },
      move: (p) => {
        calls.push(`move ${p.pointerId}`);
      },
      end: (p, type) => {
        calls.push(`end ${p.pointerId} ${type}`);
        return owns;
      },
      holding: () => true,
      isOpen: () => true,
      dispose: () => {
        calls.push('dispose');
      },
    };
    const h = createLeadPaintHandlers(ctl, () => {}, touch);
    return { commits, calls, h };
  }

  test('a touch pointerdown opens the touch session and paints nothing', () => {
    const { commits, calls, h } = withTouch();
    h.onCellPointerDown({ pointerId: 3, button: 0, pointerType: 'touch', clientX: 10, clientY: 20 }, 4, 4, 'C4', true);
    expect(calls).toEqual(['down 3 4 C4 true']);
    expect(commits).toEqual([]);
  });

  test('mouse and pen still paint on pointerdown, touch session or not', () => {
    for (const pointerType of ['mouse', 'pen', undefined]) {
      const { commits, calls, h } = withTouch();
      h.onCellPointerDown({ pointerId: 1, button: 0, pointerType }, 4, 4, 'C4', false);
      expect(commits).toEqual([{ stepIndex: 4, note: 'C4', mode: 'draw' }]);
      expect(calls).toEqual([]);
    }
  });

  test('a window end the touch session owns stops there', () => {
    const { calls, h } = withTouch(true);
    h.onWindowPointerEnd({ pointerId: 3 }, 'pointercancel');
    expect(calls).toEqual(['end 3 pointercancel']);
  });

  test('a window end the touch session does not own closes the mouse stroke', () => {
    const { commits, h } = withTouch(false);
    h.onCellPointerDown({ pointerId: 1, button: 0 }, 4, 4, 'C4', false);
    h.onWindowPointerEnd({ pointerId: 1 }, 'pointerup');
    h.onCellPointerEnter({ pointerId: 1 }, 5, 5, 'C4');
    expect(commits).toHaveLength(1);
  });

  test('moves, queries and dispose reach the touch session', () => {
    const { calls, h } = withTouch();
    h.onWindowPointerMove({ pointerId: 3, clientX: 1, clientY: 2 });
    h.dispose();
    expect(calls).toEqual(['move 3', 'dispose']);
    expect(h.touchHolding()).toBe(true);
    expect(h.touchOpen()).toBe(true);
  });

  test('with no touch session, a window end still closes the stroke and nothing holds', () => {
    const commits: LeadPaintCommit[] = [];
    const ctl = createLeadPaintController((c) => commits.push(c), (col) => col);
    const h = createLeadPaintHandlers(ctl, () => {});
    h.onCellPointerDown({ pointerId: 1, button: 0, pointerType: 'touch' }, 4, 4, 'C4', false);
    h.onWindowPointerEnd({ pointerId: 1 }, 'pointerup');
    h.onCellPointerEnter({ pointerId: 1 }, 5, 5, 'C4');
    expect(commits).toHaveLength(1);
    expect(h.touchHolding()).toBe(false);
    expect(h.touchOpen()).toBe(false);
  });
});
```

Append to `LeadMelodyGrid.test.tsx`:

```tsx
describe('touch markup', () => {
  test('the scroller lets the browser pan both ways and is findable for the hit test', () => {
    const html = renderToString(<LeadMelodyGrid trackId="lead" />);
    expect(html).toContain('data-lead-scroller="" class="overflow-x-auto touch-pan-x touch-pan-y');
    expect(html).toContain('data-lead-labels=""');
  });

  test('the cell matrix blocks text selection and the iOS callout', () => {
    const html = renderToString(<LeadMelodyGrid trackId="lead" />);
    expect(html).toContain('class="grid shrink-0 select-none [-webkit-touch-callout:none]"');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `bun test src/components/loop/lead/leadPaint.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx`
Expected: FAIL. `onWindowPointerEnd` is not a function, and the markup strings are missing.

- [ ] **Step 3: Implement the routing in `leadPaint.ts`.** Add `import type { LeadTouchSession } from './leadTouchSession';` and replace the pointer type, the handlers interface and the factory. Keep `LeadPaintClickLike` and all controller code.

```ts
/** The parts of a pointer event the paint handlers read. */
interface LeadPaintPointerLike {
  pointerId: number;
  button?: number;
  /** 'touch' goes to the touch session; absent, 'mouse' or 'pen' paint at once. */
  pointerType?: string;
  clientX?: number;
  clientY?: number;
}

export interface LeadPaintHandlers {
  onCellPointerDown: (
    e: LeadPaintPointerLike,
    stepIndex: number,
    col: number,
    note: string,
    covered: boolean,
  ) => void;
  onCellPointerEnter: (e: LeadPaintPointerLike, stepIndex: number, col: number, note: string) => void;
  onCellClick: (e: LeadPaintClickLike, stepIndex: number, note: string) => void;
  /** A window pointermove: only a touch session reads it. */
  onWindowPointerMove: (e: LeadPaintPointerLike) => void;
  /** A window pointerup/pointercancel: the touch session's when it owns the
   * pointer, otherwise the end of a mouse or pen stroke. */
  onWindowPointerEnd: (e: LeadPaintPointerLike, type: 'pointerup' | 'pointercancel') => void;
  /** A touch long-press holds the finger: block scrolling. */
  touchHolding: () => boolean;
  /** A touch gesture is open: swallow contextmenu. */
  touchOpen: () => boolean;
  /** Unmount: drop a touch session without writing. */
  dispose: () => void;
}

const touchPointer = (e: LeadPaintPointerLike) => ({
  pointerId: e.pointerId,
  clientX: e.clientX ?? 0,
  clientY: e.clientY ?? 0,
});

/**
 * Turns pointer and click events into controller calls. Kept out of the hook
 * so the event filtering — which button may paint, which pointer goes to the
 * touch session, which click may toggle — is testable.
 */
export function createLeadPaintHandlers(
  controller: LeadPaintController,
  toggle: (stepIndex: number, note: string) => void,
  touch?: LeadTouchSession,
): LeadPaintHandlers {
  return {
    onCellPointerDown: (e, stepIndex, col, note, covered) => {
      // Only the primary button draws. `button` is 0 for touch and pen too.
      if ((e.button ?? 0) !== 0) return;
      // Touch never paints on pointerdown (R343): the finger may be starting
      // a scroll. The session decides on tap, swipe or long-press.
      if (touch && e.pointerType === 'touch') {
        touch.down(touchPointer(e), { stepIndex, col, note, covered });
        return;
      }
      controller.begin(e.pointerId, stepIndex, col, note, covered);
    },
    onCellPointerEnter: (e, stepIndex, col, note) => {
      controller.visit(e.pointerId, stepIndex, col, note);
    },
    onCellClick: (e, stepIndex, note) => {
      if (!leadPaintClickIsKeyboard(e.detail)) return;
      toggle(stepIndex, note);
    },
    onWindowPointerMove: (e) => {
      touch?.move(touchPointer(e));
    },
    onWindowPointerEnd: (e, type) => {
      if (touch?.end(touchPointer(e), type)) return;
      controller.end(e.pointerId);
    },
    touchHolding: () => touch?.holding() ?? false,
    touchOpen: () => touch?.isOpen() ?? false,
    dispose: () => {
      touch?.dispose();
    },
  };
}
```

- [ ] **Step 4: Implement the hook.** Replace `useLeadNotePaint.ts`:

```ts
import { useEffect, useRef } from 'react';
import type React from 'react';
import { useAppStore } from '@/store/store';
import { type MelodyTrackId } from '@/store/melodyTracks';
import { MELODY_ACTIONS } from '@/store/leadSlice';
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import {
  createLeadPaintController,
  createLeadPaintHandlers,
  type LeadPaintHandlers,
} from './leadPaint';
import { createLeadTouchSession, type LeadTouchDeps } from './leadTouchSession';
import type { LeadGridGeometry } from './leadTouchGesture';

/** What the touch path needs from the cell matrix — read through a ref, so
 * every callback sees the current render's rows, spans and resize. */
interface LeadTouchWiring {
  matrixRef: React.RefObject<HTMLDivElement | null>;
  rows: readonly string[];
  columns: number;
  startNoteResize: (pointer: SpanResizePointer, col: number, note: string) => void;
  cancelNoteResize: () => void;
}

/** The matrix's on-screen box, clipped to what the scroller shows right of
 * the sticky note column (markup: data-lead-scroller, data-lead-labels). */
function measureLeadGrid(matrix: HTMLElement, columns: number, rowCount: number): LeadGridGeometry {
  const box = matrix.getBoundingClientRect();
  const scroller = matrix.closest('[data-lead-scroller]');
  const labels = scroller?.querySelector('[data-lead-labels]');
  return {
    left: box.left,
    top: box.top,
    clipLeft: labels ? labels.getBoundingClientRect().right : box.left,
    clipRight: scroller ? scroller.getBoundingClientRect().right : box.right,
    columns,
    rowCount,
  };
}

function leadTouchDeps(
  wiringRef: React.RefObject<LeadTouchWiring>,
  resolveRef: React.RefObject<(col: number) => number>,
): LeadTouchDeps {
  return {
    now: () => performance.now(),
    schedule: (ms, fn) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
    measure: () => {
      const { matrixRef, columns, rows } = wiringRef.current;
      return matrixRef.current ? measureLeadGrid(matrixRef.current, columns, rows.length) : null;
    },
    rowNote: (row) => wiringRef.current.rows[row],
    resolveStepIndex: (col) => resolveRef.current(col),
    startNoteResize: (pointer, col, note) => wiringRef.current.startNoteResize(pointer, col, note),
    cancelNoteResize: () => wiringRef.current.cancelNoteResize(),
  };
}

/**
 * Wires the paint state machine and the touch session to the DOM. Every
 * decision lives in leadPaint.ts and leadTouchSession.ts; this file forwards
 * events and owns the listeners, all of them for the component's whole life.
 *
 * Each committed cell is written to the store on its own (see the stroke
 * rationale in leadPaint.ts); a resize still commits once, on pointerup.
 *
 * The matrix's touchmove listener is NON-PASSIVE and lifetime on purpose: a
 * browser decides whether a touch sequence may be cancelled when it begins,
 * so a listener added at pointerdown is too late to stop the pan under a
 * long-press. It calls preventDefault only while a hold owns the finger, so a
 * swipe still scrolls natively.
 */
export function useLeadNotePaint(
  trackId: MelodyTrackId,
  resolveStepIndex: (col: number) => number,
  wiring: LeadTouchWiring,
): LeadPaintHandlers {
  const actions = MELODY_ACTIONS[trackId];
  const ref = useRef<LeadPaintHandlers | null>(null);
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
    ref.current = createLeadPaintHandlers(
      controller,
      (stepIndex, note) => {
        useAppStore.getState()[actions.toggleNote](stepIndex, note);
      },
      touch,
    );
  }

  useEffect(() => {
    const handlers = ref.current;
    const matrix = wiringRef.current.matrixRef.current;
    const onMove = (ev: PointerEvent): void => handlers?.onWindowPointerMove(ev);
    const onUp = (ev: PointerEvent): void => handlers?.onWindowPointerEnd(ev, 'pointerup');
    const onCancel = (ev: PointerEvent): void => handlers?.onWindowPointerEnd(ev, 'pointercancel');
    const onTouchMove = (ev: TouchEvent): void => {
      if (ev.cancelable && handlers?.touchHolding()) ev.preventDefault();
    };
    const onContextMenu = (ev: MouseEvent): void => {
      if (handlers?.touchOpen()) ev.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    matrix?.addEventListener('touchmove', onTouchMove, { passive: false });
    matrix?.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      matrix?.removeEventListener('touchmove', onTouchMove);
      matrix?.removeEventListener('contextmenu', onContextMenu);
      // Unmount mid-gesture (a layout switch): cancel the timer, write nothing.
      handlers?.dispose();
    };
  }, []);

  return ref.current;
}
```

- [ ] **Step 5: Wire the matrix in `LeadMelodyCells.tsx`.** Add `useRef` to the React import, and add `import type { SpanResizePointer } from '@/components/ui/useSpanResize';`. Replace `useLeadCellPaint`:

```tsx
function useLeadCellPaint(
  trackId: MelodyTrackId,
  grid: Pick<LeadMelodyCellsProps, 'melody' | 'rows' | 'stride'> & {
    columns: number;
    stepsPerBar: number;
  },
) {
  const { melody, rows, columns, stepsPerBar, stride } = grid;
  const { preview, startResize, cancelResize } = useLeadNoteResize(trackId);
  const matrixRef = useRef<HTMLDivElement>(null);
  // Column → stored index. Stored indices are bar-major at MAX_STEPS_PER_BAR,
  // so this is not the identity and a skipped-cell fill must go through it.
  const resolveStepIndex = useCallback(
    (col: number) => leadStoredIndexAt(col, stepsPerBar, stride),
    [stepsPerBar, stride],
  );
  // The drag preview is applied here, in local render state — the store is
  // written once, on pointerup (see useLeadNoteResize).
  const previewed = useMemo(() => {
    if (!preview) return melody;
    return melody.map((row, i) =>
      i === preview.stepIndex
        ? row.map((n) => (n.note === preview.note ? { note: n.note, len: preview.len } : n))
        : row,
    );
  }, [melody, preview]);
  // One pass over the notes, not a per-cell backward search.
  const kinds = useMemo(
    () => leadCellKinds(previewed, rows, columns, stepsPerBar, stride),
    [previewed, rows, columns, stepsPerBar, stride],
  );
  // A touch long-press on a note resizes the span it sits in. clickErases
  // false: a hold and lift is not a tap, so the note survives it.
  const startNoteResize = useCallback(
    (pointer: SpanResizePointer, col: number, note: string) => {
      const { spanStartIdx, spanCells, startCol } = resolveLeadCellSpan(
        kinds.get(note) ?? [],
        col,
        stepsPerBar,
        stride,
        note,
        previewed,
      );
      startResize(pointer, {
        stepIndex: spanStartIdx,
        note,
        startLen: spanCells,
        maxLen: columns - startCol,
        stride,
        clickErases: false,
      });
    },
    [kinds, stepsPerBar, stride, previewed, startResize, columns],
  );
  const controller = useLeadNotePaint(trackId, resolveStepIndex, {
    matrixRef,
    rows,
    columns,
    startNoteResize,
    cancelNoteResize: cancelResize,
  });

  return { controller, startResize, resolveStepIndex, previewed, kinds, matrixRef };
}
```

Then make the matrix `<div>` in `LeadMelodyCells`:

```tsx
    <div
      ref={paint.matrixRef}
      // select-none and the callout: a long-press is a gesture here, never a
      // text selection or the iOS link/image menu.
      className="grid shrink-0 select-none [-webkit-touch-callout:none]"
      style={{
        gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_SIZE}px)`,
        gridAutoRows: `${LEAD_CELL_SIZE}px`,
      }}
    >
```

- [ ] **Step 6: Mark the scroller and the note column in `LeadMelodyGrid.tsx`.**

```tsx
        <div
          data-lead-scroller=""
          // pan-x pan-y: the browser scrolls a swipe natively (and then
          // pointercancels it, which writes nothing); double-tap zoom is off,
          // so a tap is a tap.
          className="overflow-x-auto touch-pan-x touch-pan-y bg-base-200 p-3 rounded"
        >
```

and put `data-lead-labels=""` on the sticky label column:

```tsx
              <div
                data-lead-labels=""
                className="sticky left-0 z-10 shrink-0 bg-panel"
                style={{ width: LABEL_WIDTH }}
              >
```

- [ ] **Step 7: Run the tests and confirm they pass.**

Run: `bun test src/components/loop/`
Expected: PASS, including the unchanged existing `createLeadPaintHandlers` tests.

- [ ] **Step 8: Gate.**

Run: `bun run lint && bun run eslint`
Expected: zero errors and zero warnings. If `react-hooks/exhaustive-deps` flags the effect's empty dependency list, the refs make it correct. Add `// eslint-disable-next-line react-hooks/exhaustive-deps -- lifetime listeners; every value is read through a ref`, and add it only if the warning actually appears.

- [ ] **Step 9: Commit.**

```bash
git add src/components/loop/lead/leadPaint.ts src/components/loop/lead/leadPaint.test.ts \
  src/components/loop/lead/useLeadNotePaint.ts src/components/loop/lead/LeadMelodyCells.tsx \
  src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx
git commit -m "feat(lead): tap, swipe and long-press on the melody grid by touch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs (R343, ADR-0050), the full gate and a manual check

Read first: `docs/decisions/README.md` (the "Adding or changing a decision" section and the template), `.claude/rules/pattern-grids.md`, `.claude/rules/boundaries-and-gates.md`.

**Files:**
- Modify: `.claude/rules/pattern-grids.md`
- Create: `docs/decisions/0050-melody-grid-touch-gestures.md`
- Modify: `docs/decisions/README.md` (index row after 0049)
- Modify: `CLAUDE.md` (the `pattern-grids.md` row in the rules table)
- Modify: `docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md` (the Scroll section)

**Interfaces:**
- Consumes: the names that Tasks 1–5 shipped (`LEAD_CELL_SIZE`, `leadTouchReduce`, `createLeadTouchSession`, `leadCellAtPoint`, `clickErases`).

- [ ] **Step 1: Add R343 to `.claude/rules/pattern-grids.md`.**
  - Change the intro line to: `Step storage width, the three step layouts, span-resize mechanics, custom Chord/Bass patterns and the melody-grid touch gestures.`
  - After the `([ADR-0012](../../docs/decisions/0012-pattern-storage-and-step-layouts.md))` line, add:

```md
- The Lead/FX pitch matrix is `LEAD_CELL_SIZE` square on every screen, and a touch pointer never edits on `pointerdown`: `leadTouchReduce` (`loop/lead/leadTouchGesture.ts`) rules tap (edit the cell on `pointerup`), swipe (the browser scrolls, nothing is written) and long-press (a draw stroke from an empty cell, a resize from a note, where an unmoved lift keeps the note); `pointercancel` writes nothing; mouse and pen keep paint-on-`pointerdown`. <!-- R343 --> ([ADR-0050](../../docs/decisions/0050-melody-grid-touch-gestures.md))
```

  - Append to `## Prohibited`:

```md
- A touch pointer that edits a melody-grid cell on `pointerdown`, a swipe or `pointercancel` that writes, or a melody-grid row height not read from `LEAD_CELL_SIZE` <!-- R343 -->
```

- [ ] **Step 2: Write `docs/decisions/0050-melody-grid-touch-gestures.md`.**

```md
# ADR-0050: Melody grid touch gestures

**Status:** Accepted — 2026-09-24.

## Context

On a phone the Lead/FX piano roll was hard to use. Cells were small enough that taps landed on the
wrong one and the right-edge length handle was hard to grab. A horizontal swipe to scroll the grid
added or removed notes where the finger landed, because a cell's `pointerdown` began a paint stroke
at once and the scroller declared no `touch-action`. A touch pointer is also implicitly captured to
its `pointerdown` target, so `pointerenter` never reached other cells and drag-to-paint could not
work by touch anyway. The grid must look the same on every screen, like the Beat grid.

## Decision

- One constant, `LEAD_CELL_SIZE`, sizes the cells on both axes and the header strips and note
  column with them. The cells are square and larger on every screen; nothing branches on the layout
  mode.
- Mouse and pen are unchanged. A touch pointer goes to a touch session instead:
  - `leadTouchReduce` (`loop/lead/leadTouchGesture.ts`) is a pure classifier over timestamps and
    positions, with `LEAD_LONG_PRESS_MS` and `LEAD_TOUCH_SLOP_PX`. A lift before the hold inside
    the slop is a tap; travel past the slop before the hold is a swipe; reaching the hold inside the
    slop is a long-press. Time is checked before distance, so a late timer still counts as the hold.
  - `createLeadTouchSession` (`loop/lead/leadTouchSession.ts`) acts on the verdict through the
    existing paint controller and span resize. A tap is a one-cell stroke on `pointerup`. A swipe or
    `pointercancel` writes nothing. A long-press on an empty cell begins a draw stroke. A long-press
    on a note starts the shared span resize with `clickErases: false`, so an unmoved lift keeps the
    note. A second finger cancels the gesture.
  - During a touch stroke the cell under the finger comes from arithmetic (`leadCellAtPoint`) over
    the matrix box read at the hold, clipped to the part of the scroller right of the sticky note
    column.
- The scroller declares `touch-action: pan-x pan-y`. The matrix holds a lifetime, non-passive
  `touchmove` listener that calls `preventDefault` only while a hold owns the finger, and swallows
  `contextmenu` while a touch gesture is open. It is lifetime because a browser fixes whether a
  touch sequence can be cancelled when the sequence begins.
- `useSpanResize` starts from any `{ pointerId, clientX }` and can be cancelled; R125 still holds.
  The resize handle keeps its visible strip and grabs across a wider area inside its own cell.

### Rejected alternatives

- **A zoom control** (deferred). The marker's `translateX`, the ruler buttons and the resize
  pixels-per-step would all have to agree on a live cell size. Revisit if a fixed size proves wrong.
- **Immediate drag-to-paint on touch.** This was the bug: it cannot tell a scroll from a stroke.
- **An explicit scroll/draw mode toggle.** It is one more mode to remember, and it makes touch
  diverge from the desktop grid.
- **`elementFromPoint` hit testing.** It needs a DOM to test and per-cell attributes to read.
- **A `touchmove` listener added per gesture.** It arrives too late to cancel the pan under a
  long-press.

## Consequences

- On touch, erasing is one tap per note: there is no multi-note erase drag.
- A swipe that starts on a note's resize handle resizes instead of scrolling (the handle is
  `touch-none`).
- Pinch-zoom that starts on the grid is disabled; it still works elsewhere on the page.
- A swipe over the grid waits for the lifetime `touchmove` listener's quick check.
- Keyboard editing and audition are unchanged: only a keyboard add auditions, so a tap is silent.

## Rules this implies

- **R343** — touch never edits on `pointerdown`; tap, swipe and long-press as above; cells sized by
  `LEAD_CELL_SIZE` on both axes (`.claude/rules/pattern-grids.md`).

## Sources

- Spec: `docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md`
- Plan: `docs/superpowers/plans/2026-09-24-melody-grid-touch-gestures.md`
```

- [ ] **Step 3: Add the index row** in `docs/decisions/README.md`, directly after the `[0049]` row:

```md
| [0050](0050-melody-grid-touch-gestures.md) | Melody grid touch gestures | Lead/FX cells are square from one constant on every screen; by touch a tap edits on pointerup, a swipe scrolls and writes nothing, a long-press paints from an empty cell or resizes a note; mouse and pen keep paint-on-pointerdown. |
```

- [ ] **Step 4: Update the rules table in `CLAUDE.md`.** Change the `pattern-grids.md` row's Covers text from `Fixed-width storage, the three step layouts, span editing, custom Chord/Bass patterns` to `Fixed-width storage, the three step layouts, span editing, custom Chord/Bass patterns, melody-grid touch gestures`.

- [ ] **Step 5: Correct the spec's Scroll section.** In `docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md`, replace the second Scroll bullet with the following text. It records the lifetime listener that Task 5 implements.

```md
- The matrix holds a **lifetime, non-passive** `touchmove` listener (added in `useLeadNotePaint`'s
  effect) that calls `preventDefault()` only while a long-press session is active, so nothing
  scrolls mid-paint or mid-resize. It is lifetime rather than per gesture: a browser fixes whether a
  touch sequence can be cancelled when the sequence begins, so a listener added at pointerdown
  cannot stop the pan. The cost is that a swipe waits on one cheap main-thread check.
```

In the same spec, bring two more places in line with what shipped:
- **Paint handlers section.** The dependency object is `now()`, `schedule(ms, fn) → cancel`, `measure()`, `rowNote(row)`, `resolveStepIndex(col)`, `startNoteResize(pointer, col, note)` and `cancelNoteResize()`, all in `leadTouchSession.ts`. It replaces `cellAt(x, y)`.
- **Hit test section and the Tests bullet that mentions `visibleLeft`.** The signature is `leadCellAtPoint(geometry, x, y)`, in `leadTouchGesture.ts`, where `geometry` is `{ left, top, clipLeft, clipRight, columns, rowCount }`.

Then run `grep -n "added at pointerdown\|not a lifetime\|cellAt(x, y)\|visibleLeft" docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md` and expect no output.

- [ ] **Step 6: Run the full gate.**

Run: `bun run verify`
Expected: exit 0. That covers all tests, the static and domain checks, both Knip scans (zero findings) and the production build.

Run: `bun run eslint`
Expected: zero errors and zero warnings. Before claiming done, decide on every warning printed by build, test or lint and state the decision in the summary.

- [ ] **Step 7: Manual check in a mobile viewport.** Start the `solna-dev` launch configuration (`.claude/launch.json`, `bun run dev` on port 3000). Set the viewport to 375×812 with touch emulation, then open Pattern → Lead. Record decisive observations in `work/browser-evidence.md`.
  1. Swipe the grid horizontally: it scrolls, and no note is added or removed.
  2. Tap an empty cell: a note appears on lift. Tap it again: it goes.
  3. Long-press an empty cell (about 300ms), then drag along the row: the pressed cell fills at the hold, and the stroke follows the finger without the page or grid scrolling.
  4. Long-press a note, then drag right: its length previews and commits on lift. Long-press a note and lift without dragging: the note is unchanged.
  5. Drag a note's right-edge handle: it resizes.
  6. Switch to the FX segment and repeat steps 1–2 (same grid).
  7. At desktop width with a mouse: click toggles, drag paints and erases as before, and right-click still opens the browser menu.
  Emulated touch does not reproduce native pan takeover faithfully. If a real iOS Safari or Android Chrome device is available, repeat steps 1 and 3 on it. If none is, say so in the summary.

- [ ] **Step 8: Commit.**

```bash
git add .claude/rules/pattern-grids.md docs/decisions/0050-melody-grid-touch-gestures.md \
  docs/decisions/README.md CLAUDE.md docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md
git commit -m "docs(decisions): record melody-grid touch gestures as R343 and ADR-0050

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.**
  - Cell size: Task 1.
  - Classifier: Task 2.
  - Plain-object start, `cancel`, `clickErases` and the handle hit area: Task 3.
  - Hit test and session (tap on up, swipe and cancel write nothing, long-press paints or resizes, second finger, unmount): Task 4.
  - `pointerType` routing, `touch-action`, the non-passive `touchmove`, `contextmenu`, `select-none` and the callout: Task 5.
  - R343, ADR-0050, the index, CLAUDE.md, verify and the manual check: Task 6.
  - Audition and keyboard are unchanged by construction, because `onCellClick` and `leadClickShouldPreview` are untouched. The existing tests pin them.
- **Deviation from the spec, corrected in Task 6 Step 5:** the matrix `touchmove` listener is lifetime rather than per gesture, with the reason given there. `holdTouchGuards` became the `touchHolding()` and `touchOpen()` queries.
- **Type consistency:** `SpanResizePointer`, `LeadGridGeometry`, `LeadTouchDeps`, `LeadTouchSession` and `LeadPaintHandlers` members are spelled identically in every task that uses them.
