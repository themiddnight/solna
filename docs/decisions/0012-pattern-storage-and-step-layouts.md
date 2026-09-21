# ADR-0012: Fixed-width storage, three step layouts, span mechanics

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

The Pattern grids must survive changes of meter and step resolution without losing what the user
wrote, must draw events with and without length in the layout that suits each, must share the
fiddly pointer mechanics of resizing a span without forcing one renderer on everything, and must
play custom Chord and Bass patterns whose cycles are independent of each other and of the
progression above them.

## Decision

### The melody tracks store at their own width, and only they do

The sequencer, chord-rhythm and bass grids store every bar at the widest meter's
`MAX_STEPS_PER_BAR` and window it to the active `stepsPerBar`. The two melody tracks — Lead and FX
— run the same non-destructive scheme on a second axis: they store at the finest *step resolution*
(`LEAD_TICKS_PER_BAR` in `utils/stepResolution.ts`) and *stride* to the active one, so a
`leadMelodySteps` or `fxMelodySteps` index is a tick, not a 16th, and a `LeadNote.len` counts ticks.
Two consequences: a slot is dormant either because the meter cannot reach it or because the
resolution cannot, and **both tests live in `leadActivePosAt` and nowhere else**; and a change of
view never writes — an explicit edit writes, changing meter or resolution does not.

### Three step layouts, and each lane keeps its own

The drum voices are the only thing on the fixed one-cell `StepRow`: a drum cell is one hit at one
step and has no length. An event that HAS a length gets a one-lane span timeline instead, and there
are two of them — Chord and Bass — drawn as bars of cells where an event is one block owning the
columns it holds. The melody tracks stay on the pitch matrix, where a length is a field on the note
rather than a column count. Rendering one of these three for a lane belonging to another is a
design change, not a refactor, and `playbackStep.wiring.test.ts` pins the drum half of it.

### The three span editors share headless pointer mechanics, never a renderer

Resizing a span is `useSpanResize` over the pure arithmetic in `spanResize.ts`, and neither knows
what a span IS beyond an opaque identity the feature hands it. Chord and Bass reach it through one
shared timeline component; Lead reaches it through its own grid. The mechanics are shared because a
gesture that must commit once on `pointerup`, write nothing on cancel, and keep its preview in
local state is the same gesture everywhere; the renderers are not, because a note in a pitch matrix
and an event on a bar lane do not draw the same thing.

### A custom Chord or Bass pattern is stored fixed-width and bar-major

Its active length is an independent divisor of the progression's bars. Every bar is
`MAX_STEPS_PER_BAR` slots whatever the active meter is, so a stored row never moves when the meter
changes — only which of its slots the view can reach. The two lanes' cycles are independent of each
other, so a two-bar chord lane under a four-bar bass lane is normal, and each is clamped to a
divisor of the progression so the pattern repeats evenly against the chords above it. A bar the
current cycle cannot reach is DORMANT, not deleted: raising the length again brings its onsets
back, which is why the read path pads a lane's width and never cuts it.

### A folded chord boundary caps every custom span, and a full-cycle span retriggers at the seam

The boundary map is the progression's chord durations folded onto the lane's cycle with `%`: a lane
shorter than the progression repeats, so a chord change can fall in the MIDDLE of every repetition.
A span may cross neither that boundary nor its own cycle end, and the write clamps to the nearer of
the two — so a span drawn longer stops at the chord change instead of swallowing it. A custom span
covering a whole cycle is a length the user drew, so it releases and retriggers at the seam: the
whole-chord full-hold fast path is preset-only and no custom pattern may borrow it, which is what
the `isFullHoldRhythmCycle`/`isFullHoldBassCycle` wrappers exist to make unforgettable.

### The Chord publisher emits a progression-relative ABSOLUTE step, and each reader folds it locally

One playback source feeds the chord lane and the bass lane, and their cycles have different widths,
so a bar-relative step would name a column only one of them has. The step is published once in
progression coordinates and every reader modulos it by its OWN cycle width; a producer that folded
it would hand an independently sized reader a column that does not exist.

## Consequences

- Changing meter or resolution is always reversible, because nothing is written by a view change.
- Dormancy has a single definition, so the grid and playback cannot disagree about which slots are
  live.
- Moving a lane to another layout is a design decision, not a cleanup.
- A resize gesture behaves identically in every editor, while each editor keeps its own drawing.
- Chord and bass lanes of different lengths stay in phase with the progression.
- The melody-track table these grids read is [ADR-0013](0013-melody-tracks-table-and-record-arm.md);
  the playback side of full-hold and step publishing is
  [ADR-0027](0027-planned-then-performed-playback.md).

## Rules this implies

- **R120** — Sequencer, chord-rhythm and bass grids store every bar at `MAX_STEPS_PER_BAR` and
  window to `stepsPerBar`.
- **R121** — Lead/FX store at `LEAD_TICKS_PER_BAR` (`utils/stepResolution.ts`) and stride;
  `leadMelodySteps`/`fxMelodySteps` index = tick; `LeadNote.len` in ticks.
- **R122** — Both dormancy tests (meter, resolution) live in `leadActivePosAt` only.
- **R123** — A view change (meter/resolution) never writes; only an explicit edit writes.
- **R124** — Three step layouts: drums on one-cell `StepRow`; Chord and Bass on the span timeline;
  melody on the pitch matrix; moving a lane between layouts is a design change
  (`playbackStep.wiring.test.ts` pins the drum half).
- **R125** — Span resize = `useSpanResize` over `spanResize.ts` with an opaque identity; commits
  once on `pointerup`, writes nothing on cancel, preview in local state; renderers are not shared.
- **R126** — Custom Chord/Bass pattern stored fixed-width (`MAX_STEPS_PER_BAR` per bar),
  bar-major.
- **R127** — Each lane's active length is independent and clamped to a divisor of the
  progression's bars.
- **R128** — An unreachable bar is dormant, not deleted; the read path pads a lane's width and
  never cuts it.
- **R129** — A custom span crosses neither the folded chord boundary (durations `%` cycle) nor its
  cycle end; the write clamps to the nearer.
- **R130** — A full-cycle custom span releases/retriggers at the seam; the full-hold fast path is
  preset-only (`isFullHoldRhythmCycle`/`isFullHoldBassCycle`).
- **R131** — The Chord publisher emits a progression-relative absolute step; each reader folds by
  its own cycle; a producer never folds.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 399-447.
