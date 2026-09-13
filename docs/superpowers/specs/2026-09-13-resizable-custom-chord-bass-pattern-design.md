# Resizable Multi-Bar Custom Chord and Bass Patterns — Design

> Phase 1 makes the custom chord and bass editors multi-bar, span-aware timelines while
> leaving preset patterns, recording, and variable resolution unchanged. Written 2026-09-13
> against `main` (`c43d893`).

## Goal

Let a user choose independent loop lengths for the custom chord and bass patterns, place
events on a 16th-note timeline, and drag each event's right edge to set its audible length.
The grid, live playback, preview, and offline render must agree, and no event may sound past
the current custom-pattern cycle or a chord boundary.

## Non-goals

- Preset chord and bass patterns remain one-bar templates with their current data and playback.
- Chord/bass recording and selectable step resolution are deferred to Phase 2.
- Drum sequencing remains one hit per cell and keeps using `StepRow`.
- This phase does not add fractional chord durations. Its boundary model uses absolute steps so
  a later fractional-duration feature does not require redesigning span validation.
- Custom chord events remain block chords; this phase adds neither strum authoring nor velocity.

## Decisions

1. Chord and bass receive independent custom-pattern loop lengths. Like Lead and FX, the choices
   are the positive divisors of the progression's total bar count. A four-bar progression offers
   1, 2, and 4 bars, preventing a partial pattern cycle at the progression wrap.
2. Custom timelines stay at 1/16 resolution. A separate Phase 2 will decide whether finer
   resolution justifies extending the chord scheduler beyond its current 16th-note clock model.
3. A span may cross a bar line, but never a folded chord boundary or its pattern-cycle end.
4. When a resize covers later onsets in the same lane, those onsets are deleted on commit, matching
   Lead/FX's explicit-edit rule. A preview never mutates persisted state.
5. Explicit note length is the audible ceiling. For custom patterns, Feel may tighten a gate but
   may not extend it beyond the drawn span. Preset Feel behaviour is unchanged.
6. Existing value arrays remain intact and receive parallel hold arrays. This preserves existing
   saved custom patterns without a migration chain: an absent hold array sanitizes to one step per
   slot, while the existing boolean/token values survive.
7. Reuse is below the renderer. Lead/FX and Chord/Bass share timeline arithmetic, resize gesture
   semantics, and small visual primitives; they do not share one all-purpose grid component.
8. A custom event that fills its whole pattern cycle still retriggers when that cycle repeats. The
   `isFullHoldRhythm`/`isFullHoldBass` whole-chord fast path remains preset-only; otherwise a
   one-bar custom block under a four-bar chord would silently become a four-bar sustained voice.

## Timeline and chord-boundary model

Each custom pattern repeats continuously from progression step zero. A shorter pattern can occur
under different chords on different repetitions, so validating a span against only the first
occurrence is incorrect. For a pattern cycle of `cycleSteps`, collect every chord end in the
progression, fold each boundary to `boundary % cycleSteps`, and add cycle start/end. The resulting
sorted set is the effective boundary map shown by the editor and enforced everywhere.

For an onset at cycle position `p`:

```text
maxHold(p) = nextEffectiveBoundaryAfter(p) - p
```

Example: a two-bar pattern repeating over a `1 bar + 3 bars` progression sees a folded boundary at
the middle of its cycle because the first occurrence crosses the one-bar chord end. A span that
starts before that point is capped there even if a later occurrence sits inside the three-bar chord.
This conservative union is the only stored length that is legal on every repetition, so the drawn
block never promises a duration playback must silently shorten.

The boundary functions operate on integer absolute steps rather than `ChordItem.bars` directly.
Today callers convert whole bars with the active meter's `stepsPerBar`; a future half-bar chord can
supply its step duration without changing the folding or clamping contracts.

Changing the progression or a custom loop length recomputes the map. An explicit progression edit
atomically clamps holds that became invalid. Automatically lowering a no-longer-valid loop length
uses the existing non-destructive Lead/FX precedent for hidden bars, but every active hold is still
clamped before rendering and playback. Raising the length again restores dormant onsets, not an
invalid duration across a new chord boundary.

## Stored state

Add these per-loop fields:

```ts
customChordLoopLength: number
customChordHoldSteps: number[]
customBassLoopLength: number
customBassHoldSteps: number[]
```

Keep `customChordRhythm: boolean[]` and `customBassPattern: BassStepChoice[]` as the onset/value
arrays. Arrays use bar-major fixed-width storage: every stored bar reserves `MAX_STEPS_PER_BAR`,
while the active meter exposes only `stepsPerBar`. A shared column-to-storage-index helper prevents
bar two in 4/4 from being packed immediately after step 15 and preserves dormant 12/8 cells.

An explicit loop-length selection grows or trims all value/hold arrays by whole fixed-width bars,
as Lead/FX does. An automatic clamp caused by a shorter progression changes the active length
without trimming. Hold values are finite positive integers; rest slots sanitize to a harmless
default of one. No persist or project format version branch is added: missing new keys receive
defaults through normal sanitization.

The new fields join `Loop`, the flat loop-key registry, Chord/Bass copy groups, project content,
dirty-state fingerprinting, default-loop construction, vibe application rules, and both persisted
and `.solna` sanitization paths.

## Component boundaries and interaction

`StepRow` remains the shared primitive for fixed one-cell triggers and stays with the drum grid.
The chord and bass cards replace `PlayingStepRow` with a shared single-lane custom-pattern editor.
Lead/FX keep their pitch-matrix renderer.

The shared layer consists of:

- pure timeline functions for stored-index mapping, span painting, folded boundaries, maximum hold,
  resize quantization, and covered-onset removal;
- a store-independent resize controller that owns pointer listeners and local preview, then reports
  one commit/erase outcome to its caller;
- small ruler, playhead, boundary, and right-edge handle primitives whose props contain no store or
  audio knowledge.

Chord and bass share a `CustomPatternTimeline` shell and `SpanLane` renderer. Their feature wrappers
provide value labels, colours, store actions, and audio preview behaviour. Lead/FX may adopt the
generic resize controller and arithmetic, but `LeadMelodyCells` continues to own pitch rows,
scale colouring, tick stride, paint gestures, and polyphonic note identity. Avoid a generic grid
whose props encode both a piano roll and a one-lane pattern; that would move their differences into
conditionals instead of removing duplication.

Pointer interaction follows the proven Lead/FX contract: the handle stops propagation, listens on
`window`, previews in local state, writes once on `pointerup`, and discards `pointercancel`. A press
that never exceeds drag slop acts as the normal click. `Shift+ArrowLeft/Right` changes length for
keyboard users, and Delete/Backspace erases the focused event.

The bass lane adds an explicit palette: Root, 3rd, 5th, 7th, 8ve, and Erase. Applying a token to an
empty slot creates a one-step onset; applying a different token replaces the onset value; Erase
removes the whole span. Active blocks display `R`, `3`, `5`, `7`, or `8`. This replaces click-to-cycle,
which becomes ambiguous once a block also has a resize handle. The chord lane needs no palette:
click toggles a block-chord onset and its handle changes length.

Each grid has its own loop-length control and playhead. The chord player publishes one absolute
progression step; each mounted editor derives `absoluteStep % cycleSteps` locally, keeping the
high-frequency position out of Zustand and allowing different chord and bass cycle lengths.

## Playback and preview

Normalize both preset and custom selections to an audio-layer cycle contract containing events and
`cycleSteps`. Presets normalize to one active bar. Custom events retain their multi-bar cycle
positions and copy the matching hold value into `RhythmHit.holdSteps` or `BassStep.holdSteps`.
The chord scheduler matches events against cycle phase rather than only `stepInBar`; bass tokens are
still resolved against the chord active for that occurrence.

Only preset patterns may take the existing whole-chord full-hold optimization. A custom cycle always
uses phase-matched events, including the case where it contains one onset whose hold equals the
entire cycle; reaching the cycle end releases that event and the next cycle retriggers it.

Live playback, pattern preview, and offline rendering consume the same normalized cycle and folded
boundary helper. Note-off remains defensively clamped at the active chord end. This is a safety net,
not the primary validator. Custom Feel uses `min(1, feelToHoldScale(feel))`; preset patterns retain
the current full range.

## Testing and completion gate

Pure tests cover divisor choices, bar-major indexing in every meter, folded boundaries, span clamps,
covered-onset deletion, and resize outcomes. Store tests cover defaults, grow/trim, non-destructive
auto-clamp, loop copy, project round-trip, old-shape defaults, and invalid hold rejection. Component
tests cover palette actions, labels, playhead phase, local preview, pointer cancellation, and keyboard
editing. Audio tests cover multi-bar event phase, chord-relative bass resolution, Feel ceilings,
chord-end clamps, preview, and live/offline parity. Existing preset fixtures must remain byte-identical.

Completion requires `bun run verify` with no new ESLint warnings.

## Deferred Phase 2

Phase 2 adds quantized recording and selectable resolution after this timeline foundation ships.
Chord recording captures press/release of a chord trigger. Bass recording captures a selected
symbolic token through a dedicated trigger rather than guessing Root/3rd/5th from MIDI pitch.
The phase must decide its finest resolution and extend scheduling/storage only if it goes beyond
1/16. It is backlog work and is not required for any Phase 1 acceptance criterion.
