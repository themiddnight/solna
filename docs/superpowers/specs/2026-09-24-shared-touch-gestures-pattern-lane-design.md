# Shared touch gestures for the Chord/Bass pattern lane — spec

Branch `feat/enhance-beat-pattern-ui`. Sequel to
`docs/superpowers/specs/2026-09-24-melody-grid-touch-gestures-design.md`. Widens R343
(`.claude/rules/pattern-grids.md`) and amends ADR-0050 in place, since neither has reached `main`.
Touches the Chord/Bass custom-pattern lane (`CustomPatternTimeline`) and moves the Lead/FX touch
machinery into a shared core. R125 (span resize mechanics) is kept, not amended.

## Problem

On a phone, in the Chord and Bass custom-pattern lanes:

1. A column is at least 18px wide (`PATTERN_CELL_MIN_WIDTH`) and stretches `1fr` to fill the
   card. On a phone, where 32 columns overflow the card, it lands at the floor: about 18px. Taps
   hit the wrong column.
2. The resize handle is 6px wide (`w-1.5`) and carries `touch-none`. It is hard to grab, and a
   swipe that starts on it resizes the span instead of scrolling the lane.

A swipe that starts on a cell already scrolls without writing: the lane edits on `click`, not on
`pointerdown`. That stays.

The Lead/FX grid solved the same problems with R343, but its classifier and session are Lead-only
code in `loop/lead/`. A second copy for Chord/Bass would let the two drift.

## Decisions (agreed with the user)

1. **One gesture behaviour, two grids.** The touch classifier, the finger lifecycle and the
   element listeners become one shared implementation at the `src/components/` root. Lead/FX and
   Chord/Bass each supply a thin adapter that says what a tap and a hold mean on their grid.
2. **Visuals stay per grid.** Lead keeps its look. Chord/Bass columns grow to a 28px floor.
3. **Mouse and pen stay as they are on both grids.** Lead drag-paints; Chord/Bass clicks and drags
   the handle. Unifying mouse behaviour is out of scope.
4. **Touch on the Chord/Bass lane uses this gesture table:**

   | Gesture | Starts on an empty column | Starts on an existing event (the whole span, handle included) |
   |---|---|---|
   | Tap (lifted before 300ms, moved less than 8px) | activate the column (today's `onActivate`) | activate the column (today's click on a head) |
   | Swipe (moved 8px or more before 300ms) | native scroll, no write | native scroll, no write |
   | Long-press (300ms), then drag | nothing: past the slop the finger goes back to the browser, which may pan | resize the span; one commit on the lift (R125) |
   | Long-press, then lift without a drag | counts as a tap: activates the column | no change |

   "Activate" is what a click does today. On the Chord lane it toggles (`chordActivationValue`),
   so a tap on an event removes it. On the Bass lane it writes the palette's current tool.
5. **One lift rule for both grids.** After a long-press, a lift on an empty cell adds that cell,
   and a lift on a note or event changes nothing. Lead already behaves this way, confirmed in
   `leadTouchSession.ts`. After the timer, the paint hold has already filled the pressed cell, and
   the lift ends the stroke. A lift at the threshold before the timer runs is a one-cell stroke on
   an empty cell and nothing on a note. The note resize passes `clickErases: false`. The shared
   core keeps this rule.
6. **The Chord/Bass handle follows Lead's handle.** It is for mouse and pen only. A finger on it
   is a finger on the event. It loses `touch-none`, and a touch `pointerdown` on it goes to the
   touch session.

## Model

### Layer 1: the shared core (`src/components/` root)

Placement (R276): code used by two areas lifts to the shared location its layer already has, and
for shared hooks and controllers that is the `src/components/` root — `ui/` is for shared view
pieces. None of these files renders anything, so they sit at the root beside `playbackStep.ts`,
not in `ui/`. (`useSpanResize.ts` living in `ui/` is existing placement this change does not move.)

**`touchGesture.ts`:** the classifier, moved from `leadTouchGesture.ts` with generic names and no
change in behaviour:

- `TOUCH_LONG_PRESS_MS = 300` and `TOUCH_SLOP_PX = 8`.
- `touchGestureStart(t, x, y)` and `touchGestureReduce(state, event)`, with the types
  `TouchGestureState` and `TouchGestureEvent`. The phases are the same (`pending`, `tap`,
  `long-press`, `scroll`, `cancelled`), and so is the order: cancel, then time, then distance.
- `leadCellAtPoint` and `LeadGridGeometry` stay in `loop/lead/leadTouchGesture.ts`. They are
  Lead-only: arithmetic over square `LEAD_CELL_SIZE` cells.

**`touchGestureSession.ts`:**
`createTouchGestureSession<TCell extends { covered: boolean }>(target, deps)` owns one finger's
lifecycle, and nothing about what a grid does with it:

- `deps` is `{ now, schedule(ms, fn) → cancel }`, the same seam `LeadTouchDeps` has today.
- `target` is `{ tap(cell, pointerId), hold(cell, pointer: SpanResizePointer): TouchHold | null }`.
  `TouchHold` is `{ move(p), end(), cancel() }`. `hold` receives the finger's latest `clientX`, so
  a resize starts where the finger is and the preview does not jump.
- The session returns `down(p, cell)`, `move(p)`, `end(p, type) → boolean`, `holding()`,
  `isOpen()` and `dispose()`. These are today's `LeadTouchSession` members. `end` answers `false`
  for a pointer it does not own.
- Lifecycle, carried over from `createLeadTouchSession` unchanged:
  - `down` records the pointer and the cell, starts the classifier and schedules the long-press
    timer. It writes nothing.
  - While classifying, `move` and the timer feed the reducer. `tap` waits for the lift, `scroll`
    closes the session, and `long-press` calls `target.hold`.
  - On `pointerup` while classifying: a `tap` verdict calls `target.tap`. A `long-press` verdict
    (the lift came at the threshold before the timer ran) applies the lift rule directly:
    `target.tap` on an empty cell, nothing on a covered one. It never calls `hold`. A resize
    opened at this point would register its window `pointerup` listener during the very dispatch
    it needed to hear, and would never close.
  - A second finger's `down` while a session is open aborts the session and is itself ignored.
  - `pointercancel` and `dispose` abort. Aborting cancels the timer and calls `hold.cancel()` if
    a hold is live. It writes nothing more.
  - A timer that fires after the session closed or moved on does nothing. It checks that the
    session is still the same one and still classifying, as today.
- **A hold returning `null`** means a long-press has no drag behaviour on this cell. The session
  stays open in an inert mode. `holding()` stays `false`, so nothing blocks the pan. `isOpen()`
  stays `true`, so the contextmenu is still swallowed. A lift applies the lift rule. A move
  `TOUCH_SLOP_PX` or more from the down point closes the session. It writes nothing and leaves the
  finger to the browser.
- **A live hold** puts the session in holding mode. `holding()` is `true`, `move` goes to
  `hold.move`, `pointerup` goes to `hold.end()` and closes the session, and an abort goes to
  `hold.cancel()`.
- **`resizeHold(pointer, start, cancel): TouchHold`** is the ready-made hold for "long-press a
  note or event, then resize". It calls `start(pointer)`, which opens the grid's span resize, and
  returns a hold whose `move` and `end` do nothing: `useSpanResize`'s own window listeners drive
  the preview and commit on `pointerup` (R125). The hold's `cancel` calls `cancel`, the grid's
  cancel-resize.

**`useTouchGestureListeners.ts`:** the element and window listeners, shared too. The decision is
to share the window forwarding as well: both grids need the same lifetime listeners. Lead's
window handlers also close its mouse stroke, and that stays expressible:

- A pure `attachTouchGestureListeners(element, windowTarget, listeners) → detach`, drivable with a
  plain `EventTarget` in tests, as `openSpanResizeSession` is. It adds:
  - `pointermove`, `pointerup` and `pointercancel` on the window target, forwarded to
    `listeners.move` and `listeners.end(p, type)`;
  - a **lifetime, non-passive** `touchmove` on the element that calls `preventDefault()` only when
    `ev.cancelable && listeners.holding()`;
  - `contextmenu` on the element, prevented while `listeners.isOpen()`.
- `detach` removes all five and calls `listeners.dispose()`, so an unmount mid-gesture (a layout
  switch, R316; the lane switching to a preset pattern) cancels the timer and any live resize and
  writes nothing.
- `useTouchGestureListeners(elementRef, listeners)` attaches once in an effect with empty deps.
  It reads `listeners` from the object it was given once, which the caller builds once.
- `listeners` is a structural `{ move, end, holding, isOpen, dispose }`. A `TouchGestureSession`
  fits it as it is, which is how Chord/Bass uses it. Lead passes its paint handlers, mapped:
  `end` is `onWindowPointerEnd`, which tries the touch session first and closes the mouse stroke
  when the session answers `false`. This is today's routing.

### Layer 2a: the Lead adapter

`leadTouchSession.ts` shrinks to an adapter. `createLeadTouchSession(controller, deps)` keeps its
signature and `LeadTouchDeps` keeps its members, so the existing tests drive it unchanged. It
builds a target and hands it to `createTouchGestureSession`:

- `tap(cell, id)`: `controller.begin(id, stepIndex, col, note, covered)` then
  `controller.end(id)`. This is the one-cell stroke, which draws on an empty cell and erases on a
  covered one.
- `hold` on an empty cell: a paint hold. On creation it reads `deps.measure()` and calls
  `controller.begin(..., false)`, so the pressed cell fills as feedback. `move` maps the point
  through `leadCellAtPoint`, `rowNote` and `resolveStepIndex` to `controller.visit`. `end` and
  `cancel` both call `controller.end`, so committed cells stay, as in a mouse stroke.
- `hold` on a covered cell: `resizeHold(pointer, (p) => deps.startNoteResize(p, col, note),
  deps.cancelNoteResize)`.
- `useLeadNotePaint` replaces its hand-written effect with `useTouchGestureListeners(matrixRef,
  …)`. `leadPaint.ts` keeps its routing: touch on a cell goes to the session, touch on the handle
  starts nothing, and a window end the session does not own closes the stroke.

### Layer 2b: the Chord/Bass adapter

New pure `src/components/loop/chord/patternTouch.ts`, plus a colocated hook
`usePatternTouch.ts` that wires it (R265):

- `PatternTouchCell` is `{ column, covered: false }` or
  `{ column, covered: true, length, maxLength }`. The cell renderer knows these at `pointerdown`,
  and nothing writes during the gesture, so they cannot go stale.
- `createPatternTouchTarget(deps)` returns the `target`:
  - `tap(cell)`: `onActivate(cell.column)`, for both empty and covered cells.
  - `hold` on an empty cell: `null`.
  - `hold` on an event: `resizeHold(pointer, (p) => startResize(p, { identity:
    identityFor(column), startLength: length, maxLength, pixelsPerStep: columnWidthPx(),
    onCommit: (span, next) => onResize(span.column, next), onClick: () => {} }), cancel)`, where
    `cancel` is `useSpanResize`'s. `onClick` is a no-op, so an unmoved lift keeps the
    event and never activates it. `identityFor` is the lane's per-column reference-stable
    identity, so `previewFor` matches during the drag.
- **Starting and cancelling a resize from a plain pointer needs no new API.**
  `useSpanResize.startResize` already takes a `SpanResizePointer`, and `cancel()` already exists
  (the Lead work added both). The lane only has to widen `PatternCellContext.startResize` from
  `React.PointerEvent` to `SpanResizePointer`, and destructure `cancel` in
  `usePatternCellContext`.
- **Routing a touch `pointerdown`.** The resize handle is a sibling of the head button, not a
  child, so a touch on it cannot bubble to the head button. The touch handler sits on the head's
  wrapper `div` (the `relative` element that spans the event's columns). It covers both the head
  button and the handle. The empty button gets its own handler.
  - The handle's `onPointerDown`: `pointerType === 'touch'` returns at once. It does not stop
    propagation, so the event bubbles to the wrapper. Mouse and pen call `startResize(event, …)`
    as today.
  - The wrapper's and the empty button's `onPointerDown`: touch with `button === 0` calls
    `session.down({ pointerId, clientX, clientY }, cell)`. Mouse and pen do nothing there; their
    `click` still activates.
  - Body cells stay `pointer-events-none`. The head's `absolute inset-0` button covers the whole
    span, so a finger anywhere on an event is on that event.
- **Click de-dup.** The session performs the tap on `pointerup`, so the click the browser
  synthesizes after a finger tap must not activate a second time. Pure
  `createPatternClickFilter()` returns `{ pointerDown(pointerType), allowClick(detail) }`:
  - A touch `pointerdown` in the lane sets the flag. The next non-touch `pointerdown` clears it.
    The grid element observes both through React's `onPointerDownCapture`, so a mouse press on the
    handle, whose drag stops propagation, is still seen.
  - `allowClick(0)` is always `true`: keyboard, assistive technology and programmatic clicks
    (`detail === 0`) are always honoured. Any other click is honoured only while the flag is clear.
  - Enter and Space are already handled in `onKeyDown` with `preventDefault`, so they never reach
    `onClick`. Unchanged.
  - Both `onClick` handlers (empty and head) call `onActivate` only when `allowClick` passes.
- `usePatternTouch` builds the target, the session and the click filter once, in refs. It reads
  `onActivate`, `onResize`, `identityFor`, `columnWidthPx`, `startResize` and `cancel` through a
  ref, because both panels pass fresh closures on every render. It attaches
  `useTouchGestureListeners(gridRef, session)`. Its return type is named and exported (R266).
- `CustomPatternTimeline`'s header comment says the pointer plumbing is `useSpanResize` and that
  the file adds no window listener. It is rewritten: the pointer plumbing is `useSpanResize` and
  `useTouchGestureListeners`, and the file still adds no listener of its own.

### Layer 3: visuals, per grid

Chord/Bass only. Lead is unchanged.

- `PATTERN_CELL_MIN_WIDTH` goes from 18 to 28, a 28px touch target, the same size as a Lead cell.
  It stays its own constant: the grids size themselves independently. The columns still stretch
  `1fr` to fill the card, so the scroller's `min-width` is `cycleSteps * 28`. The comment "Half
  of `CELL_CLASS`'s `h-9`" is wrong after this change and is rewritten to give the real reason
  (the touch-target floor).
- `PATTERN_STEP_PX`, the drag fallback used when the grid cannot be measured, goes from 24 to 28,
  so it agrees with the floor.
- The height stays `h-9` (36px).
- The `overflow-x-auto` scroller gets `touch-pan-x touch-pan-y`. If the browser takes a pan
  first, it sends `pointercancel`, and nothing is written. The grid element gets `select-none`
  and `[-webkit-touch-callout:none]`.
- `RESIZE_HANDLE_CLASS` drops `touch-none`. Its comment, which explains why the handle swallowed
  the pan, is replaced: the handle sets no `touch-action`, so a swipe from it scrolls. The visible
  `w-1.5` strip is unchanged. Only mouse and pen use it now.

## Constraints

- **R016:** no gesture state in a zustand slice. The session, the click flag and the resize
  preview live in closures and refs, or in `useSpanResize`'s local state.
- **R125:** a resize commits once, on `pointerup`, and writes nothing on cancel. Touch reaches
  the same `useSpanResize` as the mouse.
- **R212:** pointer code never writes persisted state directly. A tap calls the existing
  `onActivate`, and a resize calls the existing `onResize`. Each is one action call, like today's
  click.
- **R014 and R316:** the lane stays mounted across tab switches. On unmount, `detach` disposes the
  session.
- **No ad-hoc window listeners in components.** The only window listeners are
  `useSpanResize`'s and `useTouchGestureListeners`'s.
- **No DOM in tests:** every decision sits behind a pure factory with a fake clock and scheduler.
  Markup is checked with `renderToString`.
- **Gate:** `bun run verify` passes, `bun run eslint` reports zero errors and zero warnings, and
  both Knip scans report nothing. Only symbols another module imports are exported.
- Rules and ADRs record no version numbers and no line numbers.

## Out of scope

- Unifying mouse behaviour between the grids: drag-to-paint on Chord/Bass, or click-to-toggle on
  Lead.
- The Beat grid.
- Multi-column paint on the Chord/Bass lane (a long-press on an empty column drawing a run).
- Drawing a span by dragging across empty columns.
- A wider mouse hit area for the Chord/Bass handle. Lead's `before:` extension is not copied here.

## Rejected and deferred

- **A second, Chord/Bass-only copy of the Lead session.** The two would drift. The gesture table
  is one rule (R343), so it gets one implementation.
- **Moving the whole Lead session to the shared root unchanged.** It is bound to the paint controller and
  `leadCellAtPoint`. The shared core has to know only about a tap and a hold.
- **Keeping the window forwarding per grid.** It would be the same five listeners twice, and a
  forgotten `dispose` in one copy would leak a timer. Lead's fallthrough to the mouse stroke fits
  in `listeners.end`.
- **Making a Chord/Bass long-press on an empty column start a draw.** That is multi-cell paint,
  which is out of scope. A `null` hold keeps the lift rule instead.
- **Ignoring every pointer click (`detail !== 0`), as Lead's `onCellClick` does.** Lead can do
  this because its mouse paints on `pointerdown`. The Chord/Bass mouse edits on `click`, and
  that stays.

## Docs

- **R343** in `.claude/rules/pattern-grids.md` is widened to both grids. It says: the shared
  classifier (`touchGestureReduce`, `components/touchGesture.ts`) and session (`components/touchGestureSession.ts`)
  own tap, swipe and long-press on the Lead/FX pitch matrix and on the custom Chord/Bass lane;
  touch never edits on `pointerdown`; a swipe or `pointercancel` writes nothing; a long-press then
  lift adds on an empty cell and changes nothing on a note or event; on touch the whole note or
  event is one target and only mouse and pen drag its handle; the Lead matrix is `LEAD_CELL_SIZE`
  square; and a Chord/Bass column never shrinks below `PATTERN_CELL_MIN_WIDTH`. Its
  `## Prohibited` line gains: a custom-lane touch that activates on `pointerdown` or twice
  through the synthesized click; a `touch-action` on either grid's handle; a per-grid copy of the
  classifier or the session. The file's intro line changes "the melody-grid touch gestures" to
  "the pattern-grid touch gestures".
- **ADR-0050** is amended in place: the branch is unmerged. Its title becomes "Pattern-grid touch
  gestures". The filename is kept, so links from the rules file, the specs and the plan stay
  valid. It records the shared core, the adapters, the `null`-hold path, the click de-dup and the
  rejected alternatives above. `docs/decisions/README.md` takes the new title.
- **`CLAUDE.md`**, the `pattern-grids.md` row of the rules table: "melody-grid touch gestures"
  becomes "touch gestures (melody grid and custom-pattern lane)".
- A rule change updates the rules file and the ADR in the same change. Neither records a version
  or a line number.

## Tests

- **`components/touchGesture.test.ts`:** the reducer cases move here from `leadTouchGesture.test.ts`, one
  for one and with the same expectations, under the new names: every table row, 299/300/301ms,
  7/8px, Euclidean slop, a late timer or move resolving to `long-press`, and terminal states.
  `leadCellAtPoint`'s cases stay in `leadTouchGesture.test.ts`.
- **`components/touchGestureSession.test.ts`**, run against a fake target with a fake clock and timer:
  - A tap calls `tap` on `pointerup` only, never on `down`.
  - A swipe calls nothing, and the timer after it does nothing.
  - A long-press calls `hold` with the latest `clientX`.
  - A live hold receives `move` and `end`, and `holding()` is `true` only while it is live.
  - The `null`-hold path. A lift on an empty cell taps it, and on a covered cell does nothing. A
    move past the slop closes the session without writing. While inert, `holding()` is `false`
    and `isOpen()` is `true`.
  - A second finger aborts a pending gesture or a live hold (`hold.cancel`) and is ignored itself.
  - `pointercancel` writes nothing.
  - `dispose` cancels the timer and a live hold.
  - A lift at the threshold before the timer runs: `tap` on an empty cell, and neither `tap` nor
    `hold` on a covered one.
  - `end` answers `false` for a pointer the session does not own.
- **`resizeHold`:** it calls `start` once with the pointer, `cancel` reaches the canceller, and
  `move` and `end` call nothing. Paired with
  `createSpanResizeSlot` on a plain `EventTarget`: a moved lift commits once, an unmoved lift
  commits nothing and does not click, and a cancel commits nothing.
- **`attachTouchGestureListeners`**, on plain `EventTarget`s: forwarding, `preventDefault` only
  while holding and only on a cancelable `touchmove`, contextmenu only while open, and `detach`
  removing every listener and calling `dispose`.
- **Lead regression contract:** `leadTouchSession.test.ts`, `leadPaint.test.ts` and
  `useLeadNoteResize.test.ts` keep every expectation. Only imports may change, for example
  `TOUCH_LONG_PRESS_MS` from `@/components/touchGesture`. A changed expectation is a
  regression, not an update.
- **`patternTouch.test.ts`:**
  - A tap on an empty column or on an event calls `onActivate` once, on the lift.
  - A long-press on an empty column followed by a lift activates it.
  - A long-press on an event starts a span resize with the event's identity, length, maxLength
    and the measured pixels per step.
  - A drag then a lift calls `onResize` once. An unmoved lift calls neither `onResize` nor
    `onActivate`.
  - A second finger or a `pointercancel` during the resize writes nothing.
  - The real handle and wrapper handlers, in DOM order: a touch on the handle opens the session and
    no span resize. Mouse and pen on the handle start the drag at once.
- **Click filter:**
  - After a touch `pointerdown`, a click with `detail` 1 is dropped and a click with `detail` 0
    passes.
  - A mouse `pointerdown` clears the flag, so a mouse click activates.
  - With no pointerdown seen, every click passes.
- **`CustomPatternTimeline.test.tsx` (`renderToString`):** the min-width test becomes
  `min-width:896px` (32 × 28), and its name loses the "half its height" wording. The scroller
  carries `touch-pan-x touch-pan-y`. The grid carries `select-none` and
  `[-webkit-touch-callout:none]`. The handle no longer carries `touch-none`.
- **Manual check in the preview** at a 375px viewport with synthetic touch, on both the Chord lane
  and the Bass lane:
  - swipe;
  - tap on an empty column and on an event;
  - long-press and lift on each;
  - long-press and drag on an event;
  - a tap and a swipe that start on the handle.
  Then Lead, to confirm it is unchanged. Then a mouse at desktop width: click, handle drag, and
  Lead paint.
- **Real devices, by the user:** iOS Safari and Android Chrome. Emulation does not reproduce a
  native pan taking over, the iOS callout, or the Android long-press contextmenu.

## Risks and open edges

- **A pen on a touchscreen** honours `touch-action`, so the browser may take a pen drag on the
  Chord/Bass handle as a pan and `pointercancel` it. That writes nothing. The Lead handle already
  has this behaviour; the lane inherits it.
- **Refactor risk to Lead.** Lead's session moves under a new core. This is mitigated by the
  regression contract above: the Lead test files keep their expectations, and they pass before
  the Chord/Bass adapter is written.
- **Screen-reader clicks.** Some mobile screen readers may dispatch an activation click with
  `detail !== 0` and no preceding pointer event. After an earlier finger touch left the flag set,
  such a click would be dropped. This needs checking on a device with VoiceOver and TalkBack. If
  it happens, the fallback is to arm the flag per tap, consumed by the next click, rather than
  per touch `pointerdown`.
- **Real-device-only behaviour:** native pan takeover, the callout, and whether a click follows a
  long-press. The last one does not matter: the filter drops a click that follows a touch.
- **The Android contextmenu after an inert hold.** The session swallows it while open. Once the
  finger moves past the slop the session closes, and a late menu would no longer be swallowed.
  Movement normally cancels the menu, so this is a device check, not a design change.
- **Pinch-zoom** that starts on the lane is disabled by `pan-x pan-y`, as on Lead.
- **Keyboard path unchanged:** Enter and Space activate through `onKeyDown`, and Shift+Arrow
  resizes. A keyboard click has `detail === 0` and always passes the filter.

## Gate

`bun run verify` passes, `bun run eslint` reports zero errors and zero warnings, and both Knip
scans report nothing.
