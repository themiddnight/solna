---
paths:
  - "src/utils/stepResolution.ts"
  - "src/utils/customPattern.ts"
  - "src/utils/patternTimeline.ts"
  - "src/utils/patternAdapt.ts"
  - "src/audio/playback/leadMelody.ts"
  - "src/store/bassSlice.ts"
  - "src/store/chordsSlice.ts"
  - "src/components/ui/StepRow.tsx"
  - "src/components/ui/spanResize.ts"
  - "src/components/ui/useSpanResize.ts"
  - "src/components/playbackStep.ts"
  - "src/components/touchGesture.ts"
  - "src/components/touchGestureSession.ts"
  - "src/components/useTouchGestureListeners.ts"
  - "src/components/loop/chord/**"
  - "src/components/loop/lead/**"
  - "src/components/loop/sequencer/**"
---

# Pattern grids

Step storage width, the three step layouts, span-resize mechanics, custom Chord/Bass patterns and the pattern-grid touch gestures.

- Sequencer, chord-rhythm and bass grids store every bar at `MAX_STEPS_PER_BAR` and window it to the active `stepsPerBar`. <!-- R120 -->
- Lead and FX store at `LEAD_TICKS_PER_BAR` (`utils/stepResolution.ts`) and stride to the active resolution; a `leadMelodySteps`/`fxMelodySteps` index is a tick and `LeadNote.len` counts ticks. <!-- R121 -->
- Both dormancy tests (meter, resolution) live in `leadActivePosAt` and nowhere else. <!-- R122 -->
- A view change (meter or resolution) never writes; only an explicit edit writes. <!-- R123 -->
- Three step layouts: drums on the one-cell `StepRow`, Chord and Bass on the span timeline, melody tracks on the pitch matrix; moving a lane to another layout is a design change, not a refactor (`playbackStep.wiring.test.ts` pins the drum half). <!-- R124 -->
- Span resize is `useSpanResize` over the pure arithmetic in `spanResize.ts`, with an opaque span identity: commit once on `pointerup`, write nothing on cancel, keep the preview in local state. Mechanics are shared; renderers are not — Chord and Bass share one timeline component, Lead uses its own grid. <!-- R125 -->
- A custom Chord/Bass pattern is stored fixed-width (`MAX_STEPS_PER_BAR` per bar) and bar-major. <!-- R126 -->
- Each lane's active length is independent of the other lane and clamped to a divisor of the progression's bars. <!-- R127 -->
- A bar the cycle cannot reach is dormant, not deleted; the read path pads a lane's width and never cuts it. <!-- R128 -->
- A custom span crosses neither the folded chord boundary (chord durations `%` the lane cycle) nor its own cycle end; the write clamps to the nearer. <!-- R129 -->
- A full-cycle custom span releases and retriggers at the seam; the whole-chord full-hold fast path is preset-only (`isFullHoldRhythmCycle`/`isFullHoldBassCycle`). <!-- R130 -->
- The Chord publisher emits a progression-relative absolute step; each reader folds it by its own cycle width; a producer never folds. <!-- R131 -->

([ADR-0012](../../docs/decisions/0012-pattern-storage-and-step-layouts.md))

- On the Lead/FX pitch matrix and on the custom Chord/Bass lane a touch pointer never edits on `pointerdown`. One shared classifier (`touchGestureReduce`, `components/touchGesture.ts`) and one session (`createTouchGestureSession`, `components/touchGestureSession.ts`) rule tap (on `pointerup`: Lead edits the cell, the lane activates the column), swipe (the browser scrolls, nothing is written) and long-press (Lead draws from an empty cell; on both grids a note or event resizes, and an unmoved lift keeps it). `pointercancel` writes nothing. A long-press then a lift adds on an empty cell and changes nothing on a note or event. Each grid supplies only an adapter (`loop/lead/leadTouchSession.ts`, `loop/chord/patternTouch.ts`) that says what a tap and a hold mean there, and the element and window listeners are `useTouchGestureListeners`. Mouse and pen are unchanged: Lead paints on `pointerdown`, the lane activates on `click`. On touch the whole note or event is one target: a touch on its resize handle goes to the same session, the handle sets no `touch-action`, and only mouse and pen drag it. The lane drops the click a browser synthesizes after a touch, and always honours a `detail === 0` click. The Lead matrix is `LEAD_CELL_SIZE` square on every screen; a Chord/Bass column never shrinks below `PATTERN_CELL_MIN_WIDTH`. <!-- R343 --> ([ADR-0050](../../docs/decisions/0050-melody-grid-touch-gestures.md))

## Prohibited

- Storing a sequencer, chord-rhythm or bass bar at the active width <!-- R120 -->
- Storing Lead/FX at the active resolution instead of ticks <!-- R121 -->
- A dormancy test outside `leadActivePosAt` <!-- R122 -->
- A meter or resolution change that writes <!-- R123 -->
- Moving a lane to another step layout as a "refactor" <!-- R124 -->
- A span resize that writes before `pointerup` or on cancel, or a shared span renderer <!-- R125 -->
- A custom Chord/Bass pattern stored at the active meter's width <!-- R126 -->
- A lane length that does not divide the progression's bars <!-- R127 -->
- Deleting or cutting a dormant bar <!-- R128 -->
- A custom span crossing a folded chord boundary or its cycle end <!-- R129 -->
- A custom pattern using the full-hold fast path <!-- R130 -->
- A producer folding the published Chord step <!-- R131 -->
- A touch pointer that edits either grid on `pointerdown`, a swipe or `pointercancel` that writes, a custom-lane touch that activates on `pointerdown` or twice through the synthesized click, a touch on a handle that starts the handle's own drag or erases on a hold-and-lift, a `touch-action` on either grid's handle, a per-grid copy of the classifier or the session, a melody-grid row height not read from `LEAD_CELL_SIZE`, or a Chord/Bass column narrower than `PATTERN_CELL_MIN_WIDTH` <!-- R343 -->
