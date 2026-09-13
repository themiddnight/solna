# Resizable Multi-Bar Custom Chord and Bass Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build independent, multi-bar 1/16 custom Chord and Bass timelines whose events can be resized without crossing a folded chord boundary or their pattern-cycle end.

**Architecture:** Keep Drum on the one-hit `StepRow`; keep Lead/FX as pitch matrices. Extract shared headless span-resize mechanics, add a one-lane Chord/Bass timeline, normalize preset/custom audio into cycle-aware patterns, and make live playback, previews, and offline rendering consume the same cycle phase.

**Tech Stack:** Bun, TypeScript, React, Zustand, Web Audio API, Tailwind/daisyUI, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-09-13-resizable-custom-chord-bass-pattern-design.md`

## Global Constraints

- Read the spec and repository `CLAUDE.md` before editing; Phase 2 is Linear `DEV-390` and is out of scope.
- Presets remain byte-identical one-bar templates. Drum remains one hit per cell. Chord/Bass remain fixed at 1/16 with no Record UI.
- Custom Chord and Bass loop lengths are independent positive divisors of progression bars.
- A custom span never crosses its cycle end or any chord boundary folded across all cycle repetitions.
- Custom Feel can shorten a drawn span but cannot extend it; preset Feel is unchanged.
- A full-cycle custom span releases and retriggers at the cycle seam; only presets use the whole-chord full-hold path.
- Pointer preview is local React state. Persisted state is written once on `pointerup`; `pointercancel` writes nothing.
- Persisted shape changes use sanitization/defaults, not a version-gated migration or a version bump.
- Every implementation task follows red-green-refactor and ends in its own commit. Completion requires `bun run verify` with no new ESLint warnings.

---

### Task 1: Shared pattern timeline arithmetic

**Files:**
- Create: `src/utils/patternTimeline.ts`
- Create: `src/utils/patternTimeline.test.ts`
- Modify: `src/audio/leadMelody.ts`
- Modify: `src/audio/leadMelody.test.ts`
- Modify: `src/components/loop/lead/useLeadGridModel.ts`

**Interfaces:**
- Produces `loopLengthDivisors(totalBars: number): number[]`, `clampLoopLength(current: number, totalBars: number): number`, `patternStoredIndexAt(column: number, stepsPerBar: number): number`, `foldPatternBoundaries(chordDurations: readonly number[], cycleSteps: number): number[]`, and `maxPatternHold(start: number, boundaries: readonly number[], cycleSteps: number): number`.
- `chordDurations` and all positions are active-meter 16th steps; stored rows remain `MAX_STEPS_PER_BAR` wide.

- [ ] **Step 1: Write failing table-driven tests for divisors, storage indexing, and folded boundaries.**

```ts
expect(loopLengthDivisors(6)).toEqual([1, 2, 3, 6]);
expect(clampLoopLength(5, 6)).toBe(3);
expect(patternStoredIndexAt(16, 16)).toBe(MAX_STEPS_PER_BAR);
expect(foldPatternBoundaries([16, 48], 32)).toEqual([0, 16, 32]);
expect(maxPatternHold(12, [0, 16, 32], 32)).toBe(4);
```

- [ ] **Step 2: Run the new test and confirm missing exports fail.**

Run: `bun test src/utils/patternTimeline.test.ts`
Expected: FAIL because `patternTimeline.ts` does not exist.

- [ ] **Step 3: Implement the pure functions and move the generic divisor/clamp logic out of `audio/leadMelody.ts`.**

```ts
export function patternStoredIndexAt(column: number, stepsPerBar: number): number {
  const bar = Math.floor(column / stepsPerBar);
  return bar * MAX_STEPS_PER_BAR + (column % stepsPerBar);
}

export function foldPatternBoundaries(durations: readonly number[], cycleSteps: number): number[] {
  const points = new Set<number>([0, cycleSteps]);
  let cursor = 0;
  for (const duration of durations) {
    cursor += duration;
    const folded = cursor % cycleSteps;
    if (folded > 0) points.add(folded);
  }
  return [...points].sort((a, b) => a - b);
}
```

Keep compatibility imports explicit: update Lead callers/tests to import the moved functions from `@/utils/patternTimeline`; do not leave re-export duplicates in the audio module.

- [ ] **Step 4: Run focused tests.**

Run: `bun test src/utils/patternTimeline.test.ts src/audio/leadMelody.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/patternTimeline.ts src/utils/patternTimeline.test.ts src/audio/leadMelody.ts src/audio/leadMelody.test.ts src/components/loop/lead/useLeadGridModel.ts
git commit -m "refactor: share pattern timeline arithmetic"
```

### Task 2: Pure fixed-width custom-pattern edits

**Files:**
- Create: `src/utils/customPattern.ts`
- Create: `src/utils/customPattern.test.ts`

**Interfaces:**
- Produces `resizePatternBars<T>(values, holds, bars, empty): { values: T[]; holds: number[] }` and `writePatternSpan<T>(input): { values: T[]; holds: number[] }`.
- Produces `normalizePatternSpans<T>(input): { values: T[]; holds: number[] }` for sanitization and defensive audio resolution.
- `writePatternSpan` consumes visible `column`, `holdSteps`, `stepsPerBar`, `cycleSteps`, `boundaries`, and `empty`; it clamps length and clears every covered onset through `patternStoredIndexAt`.

- [ ] **Step 1: Write failing tests for grow, trim, clamp, and swallowed onsets.**

```ts
const result = writePatternSpan({
  values: ['root', 'rest', 'fifth', 'rest'], holds: [1, 1, 1, 1],
  column: 0, value: 'root', holdSteps: 4, empty: 'rest',
  stepsPerBar: 4, cycleSteps: 4, boundaries: [0, 4],
});
expect(result.values).toEqual(['root', 'rest', 'rest', 'rest']);
expect(result.holds[0]).toBe(4);
```

Also assert a boundary at step 2 clamps the same request to 2, and growing to two bars allocates `2 * MAX_STEPS_PER_BAR` slots without moving bar zero. For normalization, assert non-positive/non-finite holds become one, boundary-crossing holds clamp, covered later onsets clear in earliest-onset order, and rest slots always end with hold one.

- [ ] **Step 2: Run and observe the missing-module failure.**

Run: `bun test src/utils/customPattern.test.ts`
Expected: FAIL because `utils/customPattern.ts` does not exist.

- [ ] **Step 3: Implement immutable edits with one clone per changed array.**

```ts
const allowed = Math.min(
  Math.max(1, Math.round(input.holdSteps)),
  maxPatternHold(input.column, input.boundaries, input.cycleSteps),
);
for (let offset = 1; offset < allowed; offset += 1) {
  values[patternStoredIndexAt(input.column + offset, input.stepsPerBar)] = input.empty;
}
```

An erase writes `empty` and resets that slot's hold to 1. Invalid/non-finite requested lengths become 1. `normalizePatternSpans` walks active visible columns left-to-right, clamps each head, clears any onset it covers, and resets active visible rest slots to hold one. It leaves meter-dormant fixed-width slots untouched so a meter round-trip stays non-destructive. This makes one-lane non-overlap an invariant before UI or audio consumes imported state.

- [ ] **Step 4: Run the focused test and commit.**

Run: `bun test src/utils/customPattern.test.ts`
Expected: PASS.

```bash
git add src/utils/customPattern.ts src/utils/customPattern.test.ts
git commit -m "feat(utils): add custom pattern span edits"
```

### Task 3: Store schema, actions, copy, and sanitization

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/chordsSlice.ts`
- Modify: `src/store/bassSlice.ts`
- Modify: `src/store/loopSlice.ts`
- Modify: `src/store/loop.ts`
- Modify: `src/store/loopCopy.ts`
- Modify: `src/store/sanitize.ts`
- Modify: `src/store/customStepSequencer.test.ts`
- Modify: `src/store/loopSlice.test.ts`
- Modify: `src/store/loopCopy.test.ts`
- Modify: `src/store/loopCopySlice.test.ts`
- Modify: `src/store/sanitize.test.ts`
- Modify: `src/store/projectFile.test.ts`
- Modify: `src/store/projectFormat.test.ts`
- Modify: `src/store/projectSlice.test.ts`
- Modify: `src/store/vibes.test.ts`

**Interfaces:**
- Adds per-loop fields `customChordLoopLength`, `customChordHoldSteps`, `customBassLoopLength`, and `customBassHoldSteps`.
- Adds actions `setCustomChordLoopLength`, `setCustomChordEvent(column, active)`, `setCustomChordEventLength(column, holdSteps)`, and Bass equivalents using `BassStepChoice`.
- Existing bulk setters remain for project installation and tests.

- [ ] **Step 1: Extend tests first.** Assert defaults are one bar/one-step holds; explicit growth/trimming is bar-sized; an automatic clamp preserves dormant bars; copying each pattern group includes its loop length and holds; importing the old shape keeps existing hits and defaults every hold to 1; invalid hold arrays fall back atomically. Assert applying a Vibe still switches both modes to presets while its progression replacement auto-clamps the dormant custom lengths/holds without deleting dormant bars.

```ts
expect(createDefaultLoop()).toMatchObject({
  customChordLoopLength: 1,
  customChordHoldSteps: new Array(MAX_STEPS_PER_BAR).fill(1),
  customBassLoopLength: 1,
  customBassHoldSteps: new Array(MAX_STEPS_PER_BAR).fill(1),
});
```

- [ ] **Step 2: Run store tests and confirm shape assertions fail.**

Run: `bun test src/store/customStepSequencer.test.ts src/store/loopSlice.test.ts src/store/loopCopy.test.ts src/store/loopCopySlice.test.ts src/store/sanitize.test.ts src/store/projectFile.test.ts src/store/projectFormat.test.ts src/store/projectSlice.test.ts src/store/vibes.test.ts`
Expected: FAIL on missing fields/actions.

- [ ] **Step 3: Add fields to every default, `Loop`, slice, and `LOOP_FLAT_KEYS`; update copy groups.**

```ts
customChordLoopLength: 1,
customChordHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
customBassLoopLength: 1,
customBassHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
```

Setters derive `stepsPerBar`, divisor clamp, folded boundaries, and immutable writes inside one Zustand `set` callback. A progression write must re-clamp active holds atomically with `chords`.

- [ ] **Step 4: Sanitize without migration gates.**

```ts
customChordLoopLength: asPositiveInteger(r.customChordLoopLength, 1),
customChordHoldSteps: asCheckedArray<number>(r.customChordHoldSteps, isPositiveInteger, fallback.customChordHoldSteps),
customBassLoopLength: asPositiveInteger(r.customBassLoopLength, 1),
customBassHoldSteps: asCheckedArray<number>(r.customBassHoldSteps, isPositiveInteger, fallback.customBassHoldSteps),
```

Add `isPositiveInteger(value): value is number` beside the existing sanitizer predicates (`Number.isFinite`, integer, and `> 0`). After reading one loop, normalize lengths to valid divisors and arrays to `loopLength * MAX_STEPS_PER_BAR`; missing hold keys default to one while valid legacy value arrays remain. Run `normalizePatternSpans` against the sanitized progression's folded boundaries so imported crossing holds clamp and covered onsets clear deterministically. Do not change persist/project format versions.

- [ ] **Step 5: Run focused tests and commit.**

Run: `bun test src/utils/customPattern.test.ts src/store/customStepSequencer.test.ts src/store/loopSlice.test.ts src/store/loopCopy.test.ts src/store/loopCopySlice.test.ts src/store/sanitize.test.ts src/store/projectFile.test.ts src/store/projectFormat.test.ts src/store/projectSlice.test.ts src/store/vibes.test.ts`
Expected: PASS.

```bash
git add src/store/types.ts src/store/chordsSlice.ts src/store/bassSlice.ts src/store/loopSlice.ts src/store/loop.ts src/store/loopCopy.ts src/store/sanitize.ts src/store/customStepSequencer.test.ts src/store/loopSlice.test.ts src/store/loopCopy.test.ts src/store/loopCopySlice.test.ts src/store/sanitize.test.ts src/store/projectFile.test.ts src/store/projectFormat.test.ts src/store/projectSlice.test.ts src/store/vibes.test.ts
git commit -m "feat(store): persist multi-bar custom pattern spans"
```

### Task 4: Normalize preset and custom patterns into playback cycles

**Files:**
- Modify: `src/audio/chordRhythms.ts`
- Modify: `src/audio/bassPatterns.ts`
- Modify: `src/audio/chordRhythms.test.ts`
- Modify: `src/audio/bassPatterns.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts`
- Modify: `src/audio/playback/chordPlayback.test.ts`

**Interfaces:**
- Produces `PlaybackPatternCycle<T> = { pattern: T; cycleSteps: number; custom: boolean }`.
- Replaces old resolvers with `resolvePlaybackRhythmCycle(...)` and `resolvePlaybackBassCycle(...)`, accepting values, holds, loop length, active meter, and progression chord durations.
- Generalizes `eventsForStep` to `eventsForCycleStep(events, progressionStep, cycleSteps, isLastBar)`, the single event-phase filter used by live scheduling, preview, and offline rendering.

- [ ] **Step 1: Write failing cycle tests.**

```ts
expect(customCycle.cycleSteps).toBe(32);
expect(customCycle.pattern.hits).toContainEqual({
  step: 20, type: 'block', velocity: 1, holdSteps: 4,
});
expect(presetCycle).toMatchObject({ cycleSteps: 16, custom: false });
```

Assert Bass retains `octave -> root + octaveShift: 1`, holds are copied, custom Feel uses `Math.min(1, feelToHoldScale(feel))`, and a full-cycle custom event does not satisfy the full-hold fast-path predicate.

- [ ] **Step 2: Run the audio tests and confirm old signatures fail.**

Run: `bun test src/audio/chordRhythms.test.ts src/audio/bassPatterns.test.ts src/audio/playback/chordPlayback.test.ts`
Expected: FAIL on missing cycle resolvers.

- [ ] **Step 3: Implement the normalized contract.**

```ts
export interface PlaybackPatternCycle<T> {
  pattern: T;
  cycleSteps: number;
  custom: boolean;
}

export function cycleStepAt(absoluteStep: number, cycleSteps: number): number {
  return ((absoluteStep % cycleSteps) + cycleSteps) % cycleSteps;
}
```

Preset branches resolve and adapt exactly as before, then return one active bar. Custom factories defensively call `normalizePatternSpans` for the current active meter/boundaries, walk every visible column across their selected bars through `patternStoredIndexAt`, copy holds, and return `loopLength * stepsPerBar`. This catches dormant cells that became active after a meter change without writing during the view change. Add `isFullHoldCycle` wrappers that return false when `custom` is true.

Implement `eventsForCycleStep` with `cycleStepAt(progressionStep, cycleSteps)`. Preserve `lastBarOnly`: preset approach events still fire only during the active chord's final bar even though their one-bar cycle repeats. Change `scheduleWholeChord` to accept a cycle length/total scheduled steps explicitly and call this same filter; do not leave a preview-only modulo implementation behind.

- [ ] **Step 4: Run tests and commit.**

Run: `bun test src/audio/chordRhythms.test.ts src/audio/bassPatterns.test.ts src/audio/playback/chordPlayback.test.ts`
Expected: PASS.

```bash
git add src/audio/chordRhythms.ts src/audio/bassPatterns.ts src/audio/chordRhythms.test.ts src/audio/bassPatterns.test.ts src/audio/playback/chordPlayback.ts src/audio/playback/chordPlayback.test.ts
git commit -m "feat(audio): resolve chord and bass pattern cycles"
```

### Task 5: Make live Chord/Bass playback cycle-aware

**Files:**
- Modify: `src/components/loop/chord/useChordPlayback.ts`
- Modify: `src/components/loop/chord/useChordPlayback.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts`
- Modify: `src/audio/playback/chordPlayback.test.ts`
- Modify: `src/components/playbackStep.ts`
- Modify: `src/components/playbackStep.test.ts`
- Modify: `src/components/playbackStep.wiring.test.ts`

**Interfaces:**
- `ChordArming` records `playbackOriginStep`, the clock step at which this playback run began.
- A plan carries the resolved Chord and Bass cycle lengths instead of assuming `stepsPerBar`.
- `emitChordPlanStep` receives a progression-relative step and compares `cycleStepAt(progressionStep, cycleSteps)` with each event.
- The existing `'chords'` publisher emits the progression-relative absolute step. It is not reduced modulo a bar; the two custom timeline readers reduce it by their own independent cycle lengths.

- [ ] **Step 1: Add failing scheduling and publisher tests.**

Cover all of these cases explicitly:

- a two-bar Chord custom event at column 20 fires in bar two;
- a one-bar preset still repeats once per bar inside a multi-bar chord;
- independent Chord and Bass cycles (for example 2 bars and 3 bars inside a 6-bar progression) phase correctly from the same progression-relative step;
- playback started when the shared clock is non-zero still begins both custom cycles at column zero;
- a custom span ending at its cycle seam releases and retriggers at column zero on the next cycle;
- the publisher reports `0, 1, ... stepsPerBar, stepsPerBar + 1` instead of wrapping at the bar edge.

```ts
expect(cycleStepAt(progressionStep, plan.chordCycleSteps)).toBe(20);
expect(publishedSteps).toEqual([0, 1, 2, 3, 4]);
```

- [ ] **Step 2: Run the focused tests and observe the one-bar assumptions fail.**

Run: `bun test src/audio/playback/chordPlayback.test.ts src/components/loop/chord/useChordPlayback.test.ts src/components/playbackStep.test.ts src/components/playbackStep.wiring.test.ts`
Expected: FAIL because plans and the publisher still use `stepInBar`.

- [ ] **Step 3: Rebase live playback to one explicit origin.**

```ts
interface ChordArming {
  playbackOriginStep: number;
  // retain the existing arming fields
}

const progressionStep = step - arming.playbackOriginStep;
const chordCycleStep = cycleStepAt(progressionStep, plan.chordCycleSteps);
const bassCycleStep = cycleStepAt(progressionStep, plan.bassCycleSteps);
```

Set `playbackOriginStep` once when a stopped player arms. Keep it stable across progression wraps, and reset it on the same stop/project/loop transitions that already replace `ChordArming`. Resolve both cycles from the loop snapshot used to start the plan; do not read Zustand again on every clock tick.

- [ ] **Step 4: Schedule and publish with cycle-relative positions.**

Change `emitChordPlanStep` so the caller supplies `progressionStep`; inside it, filter Chord and Bass events against their own cycle steps. Retain the current chord-index/duration calculation for harmony selection. Publish `progressionStep` after the arming transition for that tick has been computed, so the first visible value is zero even if the global clock was already running.

Do not put the published step in Zustand. Do not change the `'chords'` player id: there remains one playback source with two independent UI readers.

- [ ] **Step 5: Run tests and commit.**

Run: `bun test src/audio/chordRhythms.test.ts src/audio/bassPatterns.test.ts src/audio/playback/chordPlayback.test.ts src/components/loop/chord/useChordPlayback.test.ts src/components/playbackStep.test.ts src/components/playbackStep.wiring.test.ts`
Expected: PASS.

```bash
git add src/components/loop/chord/useChordPlayback.ts src/components/loop/chord/useChordPlayback.test.ts src/audio/playback/chordPlayback.ts src/audio/playback/chordPlayback.test.ts src/components/playbackStep.ts src/components/playbackStep.test.ts src/components/playbackStep.wiring.test.ts
git commit -m "feat(audio): schedule custom chord and bass cycles"
```

### Task 6: Keep preview and offline rendering phase-equivalent

**Files:**
- Modify: `src/components/loop/chord/useChordView.ts`
- Create: `src/components/loop/chord/useChordView.test.ts`
- Modify: `src/components/loop/chord/useChordPlayback.ts`
- Modify: `src/components/loop/chord/useChordPlayback.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts`
- Modify: `src/audio/playback/chordPlayback.test.ts`
- Modify: `src/audio/export/renderMixdown.ts`
- Modify: `src/audio/export/renderMixdown.test.ts`
- Modify: `src/audio/export/mixdownFixture.ts`
- Modify: `src/store/mixdownSlice.test.ts`

**Interfaces:**
- Preview receives `PlaybackPatternCycle`, schedules exactly `cycleSteps`, and loops at that boundary.
- `previewCycleSeconds(cycleSteps, bpm)` is the pure duration contract used by both preview buttons.
- Offline rendering uses `stepInPass` as its progression-relative phase and calls the same `cycleStepAt`/cycle resolver contract as live playback.
- The render snapshot already owns the Loop fields through the store snapshot; extend fixtures rather than reaching from `src/audio/` into the store.

- [ ] **Step 1: Write failing preview and render parity tests.**

Assert with pure scheduler/engine spies:

- previewing a two-bar custom pattern schedules its bar-two event before looping;
- previewing a preset schedules one bar, unchanged;
- offline rendering includes a custom event after the first bar;
- a table of progression steps produces identical Chord/Bass event identities for live scheduling and offline filtering;
- the custom full-cycle event is emitted at both cycle starts, while its release remains capped at the seam.
- `previewCycleSeconds(32, 120)` equals two 4/4 bars and the source of `useChordView` uses the selected cycle's length for both its scheduler callback and timer interval.

```ts
for (const step of [0, 15, 16, 20, 31, 32, 47]) {
  expect(renderEventsAt(step)).toEqual(liveEventsAt(step));
}
```

- [ ] **Step 2: Run focused tests and confirm bar-two cases fail.**

Run: `bun test src/components/loop/chord/useChordView.test.ts src/components/loop/chord/useChordPlayback.test.ts src/audio/playback/chordPlayback.test.ts src/audio/export/renderMixdown.test.ts src/store/mixdownSlice.test.ts`
Expected: FAIL because previews and render mixdown still resolve/filter one bar.

- [ ] **Step 3: Update previews without changing preset behavior.**

Resolve the selected Chord/Bass source to a cycle before calling the existing preview scheduler. Change the Chord/Bass preview callbacks in `useChordPlayback.ts` to accept a cycle and schedule `cycleSteps` rather than deriving `totalBars` from the one-bar preview chord. For a preset, pass `stepsPerBar`; for custom, pass `custom*LoopLength * stepsPerBar`. The preview must take an immutable state snapshot at start and stop/restart through the existing preview ownership path when the user explicitly previews again.

- [ ] **Step 4: Update offline mixdown to consume normalized cycles.**

Delete duplicate custom-to-pattern conversion from `renderMixdown.ts`. Resolve both cycles once per render snapshot, then filter each step with:

```ts
const chordStep = cycleStepAt(stepInPass, chordCycle.cycleSteps);
const bassStep = cycleStepAt(stepInPass, bassCycle.cycleSteps);
```

Keep harmony/chord selection driven by progression duration, not by pattern-cycle length. Ensure source event `holdSteps` is already clamped by the resolver; the renderer must not silently lengthen it.

- [ ] **Step 5: Run tests and commit.**

Run: `bun test src/components/loop/chord/useChordView.test.ts src/components/loop/chord/useChordPlayback.test.ts src/audio/playback/chordPlayback.test.ts src/audio/export/renderMixdown.test.ts src/store/mixdownSlice.test.ts`
Expected: PASS.

```bash
git add src/components/loop/chord/useChordView.ts src/components/loop/chord/useChordView.test.ts src/components/loop/chord/useChordPlayback.ts src/components/loop/chord/useChordPlayback.test.ts src/audio/playback/chordPlayback.ts src/audio/playback/chordPlayback.test.ts src/audio/export/renderMixdown.ts src/audio/export/renderMixdown.test.ts src/audio/export/mixdownFixture.ts src/store/mixdownSlice.test.ts
git commit -m "feat(audio): render and preview custom pattern cycles"
```

### Task 7: Extract reusable headless span-resize interaction

**Files:**
- Create: `src/components/ui/spanResize.ts`
- Create: `src/components/ui/spanResize.test.ts`
- Create: `src/components/ui/useSpanResize.ts`
- Modify: `src/components/loop/lead/useLeadNoteResize.ts`
- Modify: `src/components/loop/lead/useLeadNoteResize.test.ts`
- Modify: `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Pure `resizeLengthAtPointer(startLength, deltaPx, pixelsPerStep, maxLength): number` owns rounding and clamping.
- `useSpanResize<TIdentity>()` owns window pointer listeners, drag slop, local preview length, `pointerup` commit/click, and `pointercancel` rollback.
- Feature wrappers supply identity, start/max length, pixels per step, `onCommit`, and `onClick`; the hook never imports a store slice or audio code.

- [ ] **Step 1: Add failing pure outcome tests and source-level hook contracts.**

The repository deliberately has no DOM test environment, so move every decision into `spanResize.ts` and test it directly: minimum/maximum clamping, fractional pointer movement, sticky drag slop, a `click` outcome for an unmoved `pointerup`, a `resize` outcome for a moved `pointerup`, and `none` for `pointercancel`. In `useLeadNoteResize.test.ts`, retain the existing narrow source checks for window listener attachment/removal, one store-write call site per outcome, and absence of `setPointerCapture`.

```ts
expect(resizeLengthAtPointer(2, 19, 10, 4)).toBe(4);
expect(spanResizeOutcome(drag, 'pointercancel', 140)).toEqual({ kind: 'none' });
expect(spanResizeOutcome(press, 'pointerup', 101)).toEqual({ kind: 'click', identity });
```

- [ ] **Step 2: Run tests and confirm the shared module is missing.**

Run: `bun test src/components/ui/spanResize.test.ts src/components/loop/lead/useLeadNoteResize.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the headless hook.**

```ts
interface SpanResizeStart<TIdentity> {
  identity: TIdentity;
  startLength: number;
  maxLength: number;
  pixelsPerStep: number;
  onCommit: (identity: TIdentity, length: number) => void;
  onClick: (identity: TIdentity) => void;
}
```

Return `previewFor(identity)` and `startResize(event, input)`. Every gesture closes over its own drag record, attaches `pointermove`/`pointerup`/`pointercancel` to `window`, and removes all three listeners on either terminal event. Store preview in local state only. On `pointerup`, call `onCommit` for a moved drag or `onClick` for an unmoved press; on `pointercancel`, call neither. Do not use pointer capture because preview growth can unmount and relocate the handle.

- [ ] **Step 4: Refactor Lead to adapt to the shared hook.**

Keep `useLeadNoteResize` as the Lead-specific adapter responsible for note identity and `leadMaxNoteLength`; replace only its pointer mechanics. Lead/FX DOM, keyboard behavior, and store write count must remain unchanged. This is the regression proof that the abstraction is genuinely reusable without making Chord/Bass a pitch matrix.

- [ ] **Step 5: Run tests and commit.**

Run: `bun test src/components/ui/spanResize.test.ts src/components/loop/lead/useLeadNoteResize.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx`
Expected: PASS.

```bash
git add src/components/ui/spanResize.ts src/components/ui/spanResize.test.ts src/components/ui/useSpanResize.ts src/components/loop/lead/useLeadNoteResize.ts src/components/loop/lead/useLeadNoteResize.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx
git commit -m "refactor(ui): share span resize interaction"
```

### Task 8: Build the one-lane custom-pattern timeline

**Files:**
- Create: `src/components/loop/chord/customPatternGrid.ts`
- Create: `src/components/loop/chord/customPatternGrid.test.ts`
- Create: `src/components/loop/chord/CustomPatternTimeline.tsx`
- Create: `src/components/loop/chord/CustomPatternTimeline.test.tsx`
- Modify: `src/components/playbackStep.wiring.test.ts`

**Interfaces:**
- `customPatternCells(values, holds, loopLength, stepsPerBar, empty)` returns an active-meter, bar-major view with `empty`, `head`, and `body` cells. A head includes its visible `length`; a body includes `ownerColumn`.
- `customPatternKeyOutcome(key, shiftKey, cell)` returns `none`, `activate`, `erase`, or `resize` so keyboard semantics have real unit coverage without a DOM shim.
- `CustomPatternTimeline<TValue>` is presentational except for reading `useCurrentStep('chords')`; it receives independent values, holds, boundary limits, labels, colors, and edit callbacks.
- It renders bars horizontally, repeats beat/bar headers for orientation, and maps visible columns to fixed-width storage with `patternStoredIndexAt`.

- [ ] **Step 1: Write failing grid-model tests.**

```ts
expect(customPatternCells(values, holds, 2, 16, false)[16]).toMatchObject({
  kind: 'head',
  column: 16,
  storedIndex: MAX_STEPS_PER_BAR,
  length: 4,
});
expect(cells[17]).toMatchObject({ kind: 'body', ownerColumn: 16 });
```

Also cover a 3/4 active meter where bar two begins at visible column 12 but stored index `MAX_STEPS_PER_BAR`, an invalid stored hold clamped to one for rendering, and a head capped visually at the next supplied folded boundary.

- [ ] **Step 2: Write failing keyboard-outcome and renderer tests.**

Unit-test the pure keyboard outcome for Enter/Space activation, Shift+ArrowLeft/Right resize within `maxLength`, Delete/Backspace erase, and unmodified arrows doing nothing. Render a two-bar timeline with `renderToString` and explicit props and assert:

- all visible cells and both bar labels exist;
- an explicit `currentStep={20}` places the marker in bar two after modulo;
- empty cells are buttons with the expected activation label;
- an event head exposes its semantic label and resize handle;
- body cells point back to their owner and are not separate editable events;
- no raw palette color is present.

Pointer commit/cancel semantics are already covered through `spanResizeOutcome`; add a narrow source assertion that this renderer calls `useSpanResize` rather than duplicating window listeners.

- [ ] **Step 3: Run focused tests and observe missing modules.**

Run: `bun test src/components/loop/chord/customPatternGrid.test.ts src/components/loop/chord/CustomPatternTimeline.test.tsx`
Expected: FAIL because the model and component do not exist.

- [ ] **Step 4: Implement the pure cell model.**

```ts
export type CustomPatternCell<TValue> =
  | { kind: 'empty'; column: number; storedIndex: number }
  | { kind: 'head'; column: number; storedIndex: number; value: TValue; length: number; maxLength: number }
  | { kind: 'body'; column: number; storedIndex: number; ownerColumn: number };
```

Walk visible columns in order. When an active head is encountered, cap its stored hold with `maxPatternHold`; mark only the following visible columns before that cap as bodies. Because store writes clear swallowed onsets, encountering another active value before the calculated end is treated as a new head and ends the prior visual span defensively.

- [ ] **Step 5: Implement the timeline with local drag preview.**

Use CSS grid columns of equal 1/16 width; a head's visual block spans its current preview length and owns a right-edge resize handle. Keep the underlying cells addressable so empty-space activation remains deterministic. Add `touch-action: none` only to the handle, not the whole horizontal scroller. Use module token classes passed by the caller; do not introduce literal colors.

Give interactive elements stable accessible names such as `Chord event at bar 2 beat 2`, `Resize Chord event at bar 2 beat 2`, and `Bass 5th at bar 1 beat 3`. Mark body cells as owned by their head rather than separate editable events. Export a `CustomPatternTimelineView` that accepts `currentStep: number | null` for deterministic server-render tests; the public `CustomPatternTimeline` is the thin subscriber that reads `useCurrentStep('chords')` and passes it down.

- [ ] **Step 6: Update the playback wiring contract and commit.**

Replace the source-scanning assumption that `CustomPatternSteps` contains a `PlayingStepRow`. Assert `CustomPatternTimeline.tsx` reads `'chords'`, both panel files render that timeline, and `TrackRow.tsx` still renders `StepRow` for drums.

Run: `bun test src/components/loop/chord/customPatternGrid.test.ts src/components/loop/chord/CustomPatternTimeline.test.tsx src/components/playbackStep.wiring.test.ts`
Expected: PASS.

```bash
git add src/components/loop/chord/customPatternGrid.ts src/components/loop/chord/customPatternGrid.test.ts src/components/loop/chord/CustomPatternTimeline.tsx src/components/loop/chord/CustomPatternTimeline.test.tsx src/components/playbackStep.wiring.test.ts
git commit -m "feat(ui): add custom pattern span timeline"
```

### Task 9: Wire Chord and Bass editors, bar selection, and Bass tools

**Files:**
- Modify: `src/components/loop/chord/ChordModulePanel.tsx`
- Modify: `src/components/loop/chord/BassModulePanel.tsx`
- Modify: `src/components/loop/chord/moduleFields.tsx`
- Modify: `src/components/loop/chord/bassStepChoice.ts`
- Modify: `src/components/loop/chord/modulePanels.test.tsx`
- Modify: `src/components/loop/chord/padPanel.test.ts`
- Modify: `src/components/loop/ChordView.test.tsx`

**Interfaces:**
- `PatternBarsField` receives `value`, `options`, `onChange`, and a module-specific id; options are `loopLengthDivisors(loopBars(chords))`.
- Chord editor activation toggles an onset on/off; new events start at one step.
- Bass editor keeps a local selected tool: `'root' | 'third' | 'fifth' | 'seventh' | 'octave' | 'erase'`. Selecting a note tool and clicking a cell writes that interval; selecting Erase removes the onset. There is no click-cycle interaction.
- Palette labels are `R`, `3`, `5`, `7`, `8`, and `Erase`; full names are present in accessible labels/tooltips.

- [ ] **Step 1: Replace old expectations with failing store, pure-handler, markup, and wiring tests.**

The repository has no DOM event environment. Exercise edit outcomes through the pure keyboard/tool functions and Task 3 store actions, render `PatternBarsField`/`CustomPatternTimelineView` with explicit props, and use narrow source checks only for panel-to-setter wiring. Cover both editors independently:

- Custom mode alone reveals the bar field and timeline; preset mode reveals neither.
- Default progression offers `1, 2, 4` bars and each panel reflects its own loop length.
- The Chord panel names only `setCustomChordLoopLength`; the Bass panel names only `setCustomBassLoopLength`.
- Chord activation/keyboard outcomes route to toggle, resize, and erase actions whose store behavior was pinned in Task 3.
- `bassToolValue('root')` returns `'root'`, `bassToolValue('fifth')` returns `'fifth'`, and `bassToolValue('erase')` returns `'rest'`; the panel initializes `useState<BassPatternTool>('root')` and routes activation through this helper.
- Bass active spans render `R/3/5/7/8` on their heads.
- Chord and Bass playback markers can occupy different columns from the same published absolute step.
- The old `nextBassStepChoice` export and click-cycle assertions are removed; `bassStepLabel` remains exhaustive for stored note choices.

- [ ] **Step 2: Run tests and confirm the old `PlayingStepRow` UI fails them.**

Run: `bun test src/components/loop/chord/modulePanels.test.tsx src/components/loop/chord/padPanel.test.ts src/components/loop/ChordView.test.tsx src/components/loop/chord/CustomPatternTimeline.test.tsx src/store/customStepSequencer.test.ts`
Expected: FAIL on missing bar selector, tools, and span editor.

- [ ] **Step 3: Add the shared bar field.**

```tsx
export function PatternBarsField({ id, value, options, onChange }: PatternBarsFieldProps) {
  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={id}>Bars</label>
      <select id={id} className={FIELD_SELECT} value={value}
        onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((bars) => <option key={bars} value={bars}>{bars}</option>)}
      </select>
    </div>
  );
}
```

Render it in the main field row only while custom mode is selected. Derive `totalBars` with the existing `loopBars(chords)` utility. The slice remains the authority that clamps invalid choices; the component only displays valid divisor options.

- [ ] **Step 4: Replace `ChordPatternEditor`.**

Subscribe narrowly to Chord values, holds, loop length, chords, meter, and the three event actions. Derive active cells and folded boundaries with memoized pure helpers. Pass `bg-module-chord text-module-chord-content` tokens to `CustomPatternTimeline`; do not import `StepRow` or mutate arrays in the component.

- [ ] **Step 5: Replace `BassStepEditor` and add the explicit palette.**

Keep selected tool in `useState<BassPatternTool>('root')`, because it is transient editor state and must not be persisted. Render the palette immediately above the timeline as a single-select toolbar with `aria-pressed`. Route timeline callbacks to the event actions:

```ts
const activate = (column: number) => {
  setCustomBassEvent(column, bassToolValue(tool));
};
```

An existing span clicked with a note tool changes its interval but retains a legal hold; Erase resets it to rest/hold 1. The resize callback changes only the hold.

- [ ] **Step 6: Remove the fixed-row shell and stale imports.**

Delete `CustomPatternSteps` from `moduleFields.tsx` and its `StepRow`/`StepHeader` imports. Keep `StepRow` itself unchanged for the drum sequencer. Update explanatory comments in both panels so they describe independent timelines, not a shared drum row.

- [ ] **Step 7: Run tests and commit.**

Run: `bun test src/components/loop/chord/modulePanels.test.tsx src/components/loop/chord/padPanel.test.ts src/components/loop/ChordView.test.tsx src/components/loop/chord/customPatternGrid.test.ts src/components/loop/chord/CustomPatternTimeline.test.tsx src/components/playbackStep.wiring.test.ts src/store/customStepSequencer.test.ts`
Expected: PASS.

```bash
git add src/components/loop/chord/ChordModulePanel.tsx src/components/loop/chord/BassModulePanel.tsx src/components/loop/chord/moduleFields.tsx src/components/loop/chord/bassStepChoice.ts src/components/loop/chord/modulePanels.test.tsx src/components/loop/chord/padPanel.test.ts src/components/loop/ChordView.test.tsx
git commit -m "feat(ui): wire resizable chord and bass patterns"
```

### Task 10: Lock persistence, architecture, and end-to-end regressions

**Files:**
- Modify: `src/store/projectFile.test.ts`
- Modify: `src/store/store.test.ts`
- Modify: `src/store/loopCopy.test.ts`
- Modify: `src/audio/export/renderMixdown.test.ts`
- Modify: `src/components/loop/chord/modulePanels.test.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Project export/import, local persistence, loop duplication, and module copy/paste all preserve the four new fields.
- Sanitizers accept valid multi-bar shapes and repair malformed lengths/holds without version branches.
- Architecture documentation records the new component boundary and timeline invariants.

- [ ] **Step 1: Add cross-boundary regression fixtures before final implementation cleanup.**

Build one two-bar Chord + four-bar Bass custom loop fixture with a non-4/4 meter and explicit holds. Round-trip it through project serialization, persisted-state merge, loop duplication, and module copy/paste. Assert values and holds remain bar-major at `MAX_STEPS_PER_BAR` while playback/render sees active-meter columns.

Add malformed variants for: non-divisor loop length, too-short hold array, zero/negative/non-finite holds, and a hold crossing a folded chord boundary. Expected repair is deterministic default/clamp, never a thrown migration error.

- [ ] **Step 2: Run the regression set and fix only uncovered contract gaps.**

Run: `bun test src/store/projectFile.test.ts src/store/store.test.ts src/store/loopCopy.test.ts src/store/sanitize.test.ts src/audio/export/renderMixdown.test.ts src/components/loop/chord/modulePanels.test.tsx`
Expected before cleanup: any remaining serialization/copy contract omissions FAIL. Update the production file named by each failure; add it to this task's final `git add` command rather than broad-adding a directory.

- [ ] **Step 3: Update the repository architecture notes.**

In `CLAUDE.md`, record these durable rules:

- Drum alone uses fixed one-cell `StepRow`; Chord/Bass use their own one-lane span timeline; Lead/FX use the pitch matrix.
- The three span editors share headless pointer mechanics, not a renderer.
- Custom Chord/Bass storage is fixed-width/bar-major and its active length is an independent divisor of progression bars.
- Folded chord boundaries cap every custom span; full-cycle custom spans retrigger at cycle seams.
- The Chord playback publisher emits progression-relative absolute steps so independently sized readers can modulo locally.

Do not add dependency versions, file counts, or line numbers.

- [ ] **Step 4: Run the complete completion gate.**

Run: `bun run verify`
Expected: all tests pass; TypeScript reports no errors; ESLint reports no errors or new warnings; key/drum/contrast/level checks pass; production build succeeds.

- [ ] **Step 5: Inspect the final diff and commit.**

Run: `git status --short && git diff --check && git diff main...HEAD --stat`
Expected: only Phase 1 implementation, tests, design/plan docs, and architecture notes are present; no Record or Resolution control exists; `DEV-390` remains backlog-only.

Stage the explicit files changed while closing regression gaps plus `CLAUDE.md`, then commit:

```bash
git add CLAUDE.md src/store/projectFile.test.ts src/store/store.test.ts src/store/loopCopy.test.ts src/audio/export/renderMixdown.test.ts src/components/loop/chord/modulePanels.test.tsx
git commit -m "docs: record custom pattern timeline contracts"
```

If Step 2 required a production file not already committed, include that exact path in this final commit and explain the omission it closes in the commit body.

## Handoff Checklist

- [ ] All ten task commits exist in order and `git status --short` is empty.
- [ ] Preset Chord/Bass playback and previews are still one bar and unchanged.
- [ ] Custom Chord/Bass bar selectors are independent and offer only progression divisors.
- [ ] Chord/Bass spans cannot cross any folded chord boundary or their cycle end.
- [ ] Bass uses explicit Root/3rd/5th/7th/8ve/Erase tools; click-cycling is gone.
- [ ] Pointer drag writes once on `pointerup`; cancel writes nothing; keyboard resize/erase works.
- [ ] Live playback, preview, and offline render agree at bar and cycle seams.
- [ ] Old saved/project shapes keep their hits and default missing holds/lengths safely.
- [ ] Drum remains on `StepRow`; Lead/FX behavior remains unchanged after hook extraction.
- [ ] No Record or Resolution UI/state/audio work is included; that work remains Linear `DEV-390`.
- [ ] `bun run verify` is green and its output is reported in the implementation handoff.
