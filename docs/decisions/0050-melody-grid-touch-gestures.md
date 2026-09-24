# ADR-0050: Pattern-grid touch gestures

**Status:** Accepted — 2026-09-24.

Amended before merge to widen this decision to the custom Chord/Bass pattern lane.

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
- `useSpanResize` starts from any `{ pointerId, clientX }`, can be cancelled, and keeps at most one
  live resize (starting one cancels the other); R125 still holds.
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
  both axes and the header strips and note column with them, on every screen.
- **Chord/Bass adapter** (`loop/chord/patternTouch.ts`, wired by `usePatternTouch`): a tap
  activates the column, which is what a click does (on the Chord lane it toggles, so a tap on an
  event removes it). A hold on an event is a `resizeHold` whose span "click" is a no-op, so an
  unmoved lift keeps the event. A hold on an empty column is `null`. The touch `pointerdown` sits on
  the head's wrapper, because the handle is the head button's sibling. Columns never shrink below
  `PATTERN_CELL_MIN_WIDTH`, the same value as `LEAD_CELL_SIZE`; the lane scrolls instead.
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
  swipe that starts on the handle. Only mouse and pen drag it; on Lead, the handle keeps its
  visible strip and grabs across a wider area inside its own cell.

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
  or activates. The grab area covers the centre of a one-step note, so both hit the most natural
  place to press.
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
  as a pan and `pointercancel` it; that writes nothing, as a pen paint drag on the cells already
  does. A mouse drag is unchanged.
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
