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
- `useSpanResize` starts from any `{ pointerId, clientX }`, can be cancelled, and keeps at most one
  live resize (starting one cancels the other); R125 still holds.
- On touch the whole note is one target. A touch `pointerdown` on the resize handle does nothing
  there and bubbles to the cell, so the note's touch session rules it: a tap removes the note, a
  swipe scrolls, a long-press keeps or resizes it. Only mouse and pen drag the handle, which keeps
  its visible strip and grabs across a wider area inside its own cell. The handle sets no
  `touch-action`: CSS cannot branch on pointer type, and `touch-none` would block the pan for every
  swipe that starts on a note's last cell (its grab area covers most of a one-step note).

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
  starts there resizes instead of scrolling, and a hold-and-lift on it counts as a click that erases.
  The grab area covers the centre of a one-step note, so both hit the most natural place to press.

## Consequences

- On touch, erasing is one tap per note: there is no multi-note erase drag.
- A pen on a touchscreen honours `touch-action` too, so the browser may take a pen drag on the
  handle as a pan and `pointercancel` it; that writes nothing, as a pen paint drag on the cells
  already does. A mouse drag is unchanged.
- Pinch-zoom that starts on the grid is disabled; it still works elsewhere on the page.
- A swipe over the grid waits for the lifetime `touchmove` listener's quick check.
- Keyboard editing and audition are unchanged: only a keyboard add auditions, so a tap is silent.

## Rules this implies

- **R343** — touch never edits on `pointerdown`; tap, swipe and long-press as above; a touch on the
  resize handle is a touch on the note, and only mouse and pen drag the handle; cells sized by
  `LEAD_CELL_SIZE` on both axes (`.claude/rules/pattern-grids.md`).

## Sources

- Spec: `docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md`
- Plan: `docs/superpowers/plans/2026-09-24-melody-grid-touch-gestures.md`
