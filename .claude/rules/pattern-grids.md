---
paths:
  - "src/utils/stepResolution.ts"
  - "src/utils/customPattern.ts"
  - "src/utils/patternTimeline.ts"
  - "src/utils/patternAdapt.ts"
  - "src/audio/leadMelody.ts"
  - "src/store/bassSlice.ts"
  - "src/store/chordsSlice.ts"
  - "src/components/ui/StepRow.tsx"
  - "src/components/ui/spanResize.ts"
  - "src/components/ui/useSpanResize.ts"
  - "src/components/playbackStep.ts"
  - "src/components/loop/chord/**"
  - "src/components/loop/lead/**"
  - "src/components/loop/sequencer/**"
---

# Pattern grids

Step storage width, the three step layouts, span-resize mechanics and custom Chord/Bass patterns.

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
