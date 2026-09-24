# Melody grid touch gestures — spec

Branch `feat/enhance-beat-pattern-ui`. New rule R343 (`.claude/rules/pattern-grids.md`), new
ADR-0050. Touches the Lead/FX pitch matrix only; R125 (span resize mechanics) is kept, not amended.

## Problem

Reported on mobile, in the Lead and FX piano rolls:

1. Cells are 20px square. Taps land on the wrong cell, and the right-edge length handle (an 8px
   strip) is hard to grab.
2. A horizontal swipe to scroll the grid adds or removes notes where the finger landed.
   `onCellPointerDown` begins a paint stroke at once, and the scroller has no `touch-action`.

Constraint: the grid looks the same on every screen, like the Beat grid. Nothing branches on
`useLayoutMode()`. The only branch is on `pointerType`, which describes the input device, not the
layout.

FX uses the same components: `PatternView.tsx` mounts `LeadMelodyGrid` with `trackId="lead"` and
with `trackId="fx"`, and the hooks resolve actions through `MELODY_ACTIONS[trackId]`.

## Decisions (agreed with the user)

1. **Bigger cells on every screen.** The cell grows from 20px to 28px and stays square. The bar
   and beat header strips and the note-name rows follow the same constant.
2. **Mouse and pen gestures stay as they are.** Click to toggle, drag to paint (draw or erase,
   decided by the first cell), drag the right-edge handle to resize, keyboard unchanged. The
   larger cells and the wider handle hit area apply to them as well.
3. **Touch uses this gesture table:**

   | Gesture | Starts on an empty cell | Starts on an existing note |
   |---|---|---|
   | Tap (lifted before 300ms, moved less than 8px) | add one note | remove that note |
   | Swipe (moved 8px or more before 300ms) | native scroll, no edit | native scroll, no edit |
   | Long-press (300ms), then drag | paint stroke (draw) across cells | resize that note's length |
   | Drag the note's right-edge handle | — | resize (as today, larger hit area) |

   Accepted trade-off: on touch you can no longer erase several notes in one drag. You erase one
   note per tap.
4. **The cell size is fixed. A zoom control is deferred** (see Rejected and deferred).

## Model

### Cell size

`melodyGrid.ts` has `export const LEAD_CELL_WIDTH = 20`, but the row height does not come from it.
Row height is a Tailwind `h-5` class in four places: the cell `<button>` in `LeadMelodyCells.tsx`,
the bar and beat header strips in `LeadMelodyHeaders`, and the row labels in `LeadRowLabels`
(both in `LeadMelodyGrid.tsx`). The coordinate hit test below depends on row height equalling
column width, so this change ties them together:

- Rename `LEAD_CELL_WIDTH` to `LEAD_CELL_SIZE = 28`. The constant now sizes both axes, and a
  height that reads "WIDTH" would mislead. The rename covers `useLeadNoteResize.ts`
  (`pixelsPerStep`), `LeadMarkerView`, the headers, the cells and the tests.
- The cell matrix sets `gridAutoRows: ${LEAD_CELL_SIZE}px` next to its existing
  `gridTemplateColumns`, and the cells drop `h-5`. The header strips and row labels replace `h-5`
  with `style={{ height: LEAD_CELL_SIZE }}`.
- Font sizes and the marker (`top-0 bottom-0`, which strides by the constant) do not change.

### Touch gesture classifier

New pure file `src/components/loop/lead/leadTouchGesture.ts`, with no DOM, React or timers:

- `LEAD_LONG_PRESS_MS = 300` and `LEAD_TOUCH_SLOP_PX = 8`.
- A reducer, `leadTouchReduce(state, event)`. The state is `pending`, `tap`, `long-press`,
  `scroll` or `cancelled`, plus the down timestamp and position. The events are
  `move(t, x, y)`, `timer(t)`, `up(t, x, y)` and `cancel`. Every state except `pending` is
  terminal. The reducer only classifies; what happens after `long-press` belongs to the session
  that follows.
- Rules, checked in this order while `pending`:
  1. `cancel` gives `cancelled`.
  2. If `t - downAt >= LEAD_LONG_PRESS_MS`, the result is `long-press`. Time is checked before
     distance: the gesture is still `pending` only because it stayed inside the slop until now, so
     a late timer or a late move still counts as a hold.
  3. If the Euclidean distance from the down point is `>= LEAD_TOUCH_SLOP_PX`, the result is
     `scroll`.
  4. `up` gives `tap`. Anything else stays `pending`.

### Paint handlers: the touch branch

`createLeadPaintHandlers` (`leadPaint.ts`) gets a third dependency object: `now()`,
`schedule(ms, fn) → cancel`, `measure()`, `rowNote(row)`, `resolveStepIndex(col)`,
`startNoteResize(pointer, col, note)` and `cancelNoteResize()`, all in `leadTouchSession.ts`. It
replaces the earlier per-point cell lookup. Tests can drive the touch path with a fake clock. `LeadPaintPointerLike` gains optional `pointerType`,
`clientX` and `clientY`. An absent `pointerType` takes the mouse path, so the existing tests keep
their meaning.

- **Mouse or pen:** `onCellPointerDown` behaves exactly as today.
- **Touch:** `onCellPointerDown` opens a session (pointer id, cell, whether it is covered,
  classifier state) and schedules the long-press timer. It commits nothing.
  - **Tap:** on `up`, `controller.begin(...)` then `controller.end(pointerId)`. This is a
    one-cell stroke through the existing controller, so it draws on an empty cell and erases on a
    covered one, with the same slice rules as a mouse click.
  - **Swipe or cancel:** the session is dropped. Nothing is written.
  - **Long-press on an empty cell:** `controller.begin(...)` in draw mode, so the pressed cell
    fills at once as feedback. Later moves go through `cellAt` and then `controller.visit`, which
    fills gaps along a row as it does today. `up` or `cancel` calls `controller.end`. Cells
    already committed stay, as in a mouse stroke.
  - **Long-press on a note:** `startNoteResize` with the latest pointer position. Lifting without
    a drag changes nothing (see Resize below).
- `useLeadNotePaint` forwards touch `pointermove`, `pointerup` and `pointercancel` from its
  lifetime window listeners, adding `pointermove`. It supplies `performance.now`, `setTimeout`,
  and a `cellAt` over a ref to the matrix element in `LeadMelodyCells`. `useLeadCellPaint`
  supplies `startNoteResize`, since it already holds `kinds`, `previewed` and `startResize`, and
  gets the span from `resolveLeadCellSpan`.

### Hit test: coordinates, not `elementFromPoint`

A touch pointer is implicitly captured to its pointerdown target, so `pointerenter` never fires on
other cells during a touch drag. The touch paint path finds the cell under the finger with
arithmetic:

- New pure `leadCellAtPoint(geometry, x, y)`, in `leadTouchGesture.ts`, where `geometry` is
  `{ left, top, clipLeft, clipRight, columns, rowCount }`. It returns `{ col, row }`, or `null`
  outside the matrix. It also returns `null` left of `clipLeft`, the right edge of the sticky
  note-name column, so a stroke never paints cells hidden under that column. The caller maps `row`
  to `rows[row]` and `col` through `resolveStepIndex`.
- The rect is read once, when the long-press fires. Scrolling is blocked for the rest of the
  session (see Scroll), so the rect cannot go stale.

Why not `elementFromPoint`: this version is unit-testable in bun with no DOM, and it needs no
per-cell `data-*` attributes and no hit-test layout query on each move. The cost is a dependence on
fixed square cells, which the cell-size change guarantees. Releasing the implicit capture to get
`pointerenter` back would leave the touch path untestable too.

### Scroll

- The `overflow-x-auto` scroller in `LeadMelodyGrid.tsx` gets `touch-pan-x touch-pan-y`
  (`touch-action: pan-x pan-y`). If the browser takes the pan first, it sends `pointercancel`,
  which is classified `cancelled`, so nothing is written.
- The matrix holds a **lifetime, non-passive** `touchmove` listener (added in `useLeadNotePaint`'s
  effect) that calls `preventDefault()` only while a long-press session is active, so nothing
  scrolls mid-paint or mid-resize. It is lifetime rather than per gesture: a browser fixes whether a
  touch sequence can be cancelled when the sequence begins, so a listener registered only once the
  gesture starts cannot stop the pan. The cost is that a swipe waits on one cheap main-thread check.
- While a touch session is open, `contextmenu` is prevented (Android long-press menu). Mouse
  right-click is unchanged. The matrix gets `select-none` and `[-webkit-touch-callout:none]`
  (iOS).

### Resize

- The long-press route reuses `useLeadNoteResize` → `useSpanResize`, so R125 holds: local
  preview, one commit on `pointerup`, nothing on cancel.
- `useSpanResize.startResize` today takes a `React.PointerEvent`. Its first parameter widens to a
  structural `{ pointerId, clientX, stopPropagation?, preventDefault? }`. A long-press can then
  start a gesture after pointerdown has passed, with `startX` at the finger's position when the
  hold fires, so the preview does not jump. The Chord/Bass callers do not change.
- `useLeadNoteResize.startResize` gains an optional `clickErases` flag, default `true`. The touch
  long-press passes `false`. An unmoved release (`spanResizeOutcome` → `click`) must not erase:
  a hold and lift is not a tap.
- `useSpanResize` gains `cancel()`. It detaches and clears the preview with no commit, for the
  multi-touch rule under Risks.
- **Handle hit area:** the visible `w-2` box stays. A `before:` pseudo-element
  (`before:absolute before:inset-y-0 before:right-0 before:w-4`) widens the hit area to 16px, all
  inside the end cell, so it never takes a neighbour's tap. A tap on the handle still erases,
  which matches "tap a note removes it".

## Rejected and deferred

- **Zoom control (deferred).** The marker's `translateX`, the ruler buttons and the resize
  `pixelsPerStep` would all have to agree on a live value. The "no zoom, on purpose" test in
  `LeadMelodyGrid.test.tsx` guards against exactly that. Revisit if 28px proves wrong.
- **Immediate drag-to-paint on touch.** This is today's behaviour, and it is the bug.
- **An explicit scroll/draw mode toggle.** It is one more mode to remember, and it makes touch
  diverge from the desktop grid.

## Docs

- **R343** in `.claude/rules/pattern-grids.md` states the touch gesture model for the melody
  grids: the classifier owns tap, swipe and long-press; touch never paints on pointerdown; a swipe
  or cancel writes nothing. A matching `## Prohibited` line is added.
- **ADR-0050** `docs/decisions/0050-melody-grid-touch-gestures.md` records the reasons and the
  three alternatives above.
- Both are written during implementation, without version numbers or line numbers. The ADR index
  in `docs/decisions/README.md` gets the new entry.

## Tests

- `leadTouchGesture.test.ts` (new) covers every table row. It also covers `cancel` from
  `pending`; the edges at exactly 299, 300 and 301ms and exactly 7 and 8px; a diagonal slop
  measured as Euclidean distance; a late `timer` or `move` after 300ms resolving to `long-press`;
  and terminal states that ignore further events.
- `leadCellAtPoint` tests cover cell boundaries, outside the matrix, and left of `clipLeft`.
- `leadPaint.test.ts`, touch branch with a fake scheduler:
  - A tap commits on `up` only, with nothing at pointerdown.
  - A swipe commits nothing, and neither does `pointercancel`.
  - A long-press on an empty cell draws the pressed cell, then visits along `cellAt`.
  - A long-press on a note calls `startNoteResize` and never the controller.
  - A pointer with no `pointerType` still takes the mouse path.
- `useLeadNoteResize` or `spanResize` tests: with `clickErases: false`, an unmoved release commits
  nothing.
- `LeadMelodyGrid.test.tsx` is updated for 28px: `repeat(16, 28px)`, `translateX(84px)`,
  `width:28px`, and the `h-5` counts rewritten against the new height style.
- Manual check in the preview at a 375px viewport with touch emulation: swipe, tap, long-press
  paint and resize, and handle drag. Then a mouse at desktop width. Then iOS Safari and Android
  Chrome on real devices, because emulation does not reproduce native pan takeover.

## Risks and open edges

- **Timer cleanup:** the long-press timer and the per-session `touchmove` listener are cleared
  on session end, on cancel, and in the hook's unmount cleanup. A layout switch unmounts the grid
  (R316).
- **Multi-touch:** a second touch pointerdown while a session is open cancels it. `pending` is
  dropped. An active stroke ends, and its committed cells stay. An active resize calls
  `useSpanResize.cancel()`, so nothing is written.
- **Swipe from a note's end cell:** the handle keeps `touch-none`, so a swipe that starts on the
  inner 16px of a note's last cell resizes instead of scrolling. This is accepted, because
  "drag the handle" is a row of the table.
- **Pinch-zoom** that starts on the grid is disabled by `pan-x pan-y`. It still works elsewhere
  on the page.
- **Keyboard path unchanged:** Enter/Space toggles through `onCellClick` (`detail === 0`), and
  Shift+Arrow resizes through `onResize`.
- **Audition unchanged:** `leadClickShouldPreview` auditions only a keyboard add. The synthetic
  click after a touch tap has `detail >= 1`, so the tap is silent, as a mouse click is today. It
  is also ignored by `onCellClick`, so it cannot toggle a second time.

## Gate

`bun run verify` green, and `bun run eslint` with zero errors and zero warnings.
