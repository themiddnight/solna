# ADR-0034: Pure song event timeline

**Status:** Accepted — 2026-09-22. DEV-420.

## Context

The structure audit ([04-domain-and-dependencies.md](../architecture/structure/04-domain-and-dependencies.md),
summarised in [structure/README.md](../architecture/structure/README.md)) left two findings open:
A4, a "pure" planner (`plan/chordPlan.ts`) reached the engine singleton transitively through
`chordPlayback.ts`, because the chord/bass event math lived beside the engine-touching emitters in
that file; and A5, drums had no planner in `plan/` at all — their per-step decision lived in a
root-level module outside the planner-purity lint tree, with a second, unrelated finding (a React
hook living inside `audio/`) bundled into the same row. Separately, `renderMixdown.ts` interleaved
planning with rendering: it walked every pass and every step of the arrangement itself, calling the
lane planners inline as it went, so there was no single artifact answering "what plays when" for a
whole song. DEV-428 and DEV-429 both need that artifact — a rendered arrangement's event list,
independent of the act of performing it.

## Decision

`src/audio/playback/plan/songTimeline.ts` turns a `MixdownSnapshot` into timed events:
`walkSongTimeline` is a generator that yields the walk item by item (a pass marker, a note or drum
event, a step-end marker); `buildSongTimeline` drains that generator, keeps only the note/drum
events and returns them time-sorted (`Array.prototype.sort` is stable, so equal-time events keep
their emit order) alongside the pass plan — the form DEV-428/DEV-429 can consume without
performing anything. `TimelineEvent` is the event union both functions traffic in.

`src/audio/playback/plan/songSnapshot.ts` holds what `renderMixdown.ts` used to assemble inline:
the snapshot types, `mixdownLeadTrack`/`mixdownFxTrack` and the other per-lane snapshot builders,
and `songTrackVoice` — the one offline table of patch field + bus per track. `beatSnapshotForLoop`
lives here too, the offline twin of the live Beat snapshot.

`src/audio/playback/plan/chordEvents.ts` is the fix for A4: the chord and bass event math
(`buildChordEvents`, `arpEventsForStep`, `phaseEventsForStep`, `fullHoldVelocity`, and the rest)
moved out of `chordPlayback.ts` into a file that imports nothing engine-touching, so
`plan/chordPlan.ts` no longer has a transitive edge to the engine singleton. `src/audio/playback/plan/beatPlan.ts`
(`planBeatStep`) is the fix for the drum half of A5: one pure function, called by both the live
stepper and the timeline walk, deciding drum voices and velocity in one place. The arp-hook half of
A5 (`arpPlayback.ts`) is unchanged and stays open — a React hook does not move by drawing an event
timeline around it.

`src/architecture/playbackPlannerImportGraph.test.ts` is the new guard the fix needed: the
per-file ESLint block on `plan/` (R227) cannot see a transitive edge, so A4 existed for as long as
the block was armed. The test walks the real import graph from every file in `plan/` and fails if
any path reaches `audio/engine.ts` or `playbackEngine.ts`, aliased or relative, type-only imports
excluded (they erase at runtime and cannot instantiate the singleton).

`renderMixdown.ts`'s `scheduleArrangement` no longer plans anything: it applies each pass's audio
automation and performs each walk item — `performTimelineEvent` for a note or drum event — before
resuming the generator. It calls no planner.

## Why incremental, not collect-then-perform (spec F8 and §6)

Several engine call sites draw from the shared RNG seam (`audio/rng.ts`'s `random()`) at the moment
they run, not at plan time:

- the drum noise offset picked per hit (`drumSynth.ts`);
- the master reverb's noise buffer, built lazily on first use (`masterRack.ts`);
- each subtractive voice's noise buffer, drawn per colour (`synth/noise.ts`);
- the sample-and-hold LFO's buffer (`synth/synthLfo.ts`).

The planner side draws too: the arp's `'random'` mode reorders a note sequence by drawing from the
same seam (`arpeggiator.ts`). Both draws are seeded by the same `withSeededRandom(MIXDOWN_SEED)`
call around the whole render, so their combined order is what makes a render byte-reproducible.
Performing the walk incrementally — one item, then resume the generator, then the next — keeps that
draw order identical to the pre-refactor renderer, which called the same functions inline in the
same sequence. Collecting `walkSongTimeline`'s output into an array before performing any of it
would still produce the same events, but would draw every planner's RNG calls (arp `'random'`)
before any engine call's RNG draws, instead of interleaved with them — a different draw order,
and therefore a different WAV, for any arrangement using an arp `'random'` mode.

## Rejected alternatives

- **Collect-then-perform.** Rejected above: it reorders the shared RNG stream and changes the
  rendered WAV.
- **A dedicated RNG stream for the arp planner**, separate from the engine's draws. Rejected: it
  would make the planner's output reproducible on its own, but the combined draw order — and so
  the WAV — would still change from today's, which is exactly the audible regression this refactor
  must not introduce.
- **A sequence field on each event**, letting the renderer sort by draw order after collecting the
  whole timeline. Rejected: the draw order is a property of performing an event against the live
  RNG state at that moment, not a property of the event itself; stamping a sequence number would
  require simulating the walk once to assign it and once to perform it, which is the incremental
  walk already, with extra steps.
- **An ESLint rule for the import graph.** Rejected: ESLint's import rules operate per file and
  cannot see a transitive edge, which is exactly how A4 survived under an already-armed block; only
  a graph walk (the new test) can see the whole chain.
- **Extending the existing config-asserting purity test** (`playbackPlannerPurity.test.ts`) to also
  check the import graph. Rejected: that test asserts the ESLint block's own severity is armed at
  `error`; it does not execute the block against real files, so it cannot see what the block cannot
  see either. The two tests check different things and stay separate.

## Known limit (spec §11 R3)

`buildSongTimeline`, called outside an actual render (for example by a future preview feature),
draws the arp's `'random'` notes from whatever RNG stream is live at that moment — the shared
module seam, not seeded the way `renderMixdown.ts` seeds it around the walk it performs. Its notes
for an arp in `'random'` mode will therefore not match the notes a real render of the same
arrangement produces. Fixing that (giving `buildSongTimeline` its own seeded, deterministic call)
belongs to DEV-428, whichever consumer needs the timeline reproducible outside a render.

## Proof

The golden test (`src/audio/export/renderMixdownGolden.test.ts`) recorded a WAV hash and an
engine-call log against the pre-refactor renderer and is never edited by a later commit; every
task in this refactor runs it unchanged and it stays green, which is the equivalence proof that
the walk-based renderer performs the same calls in the same order as the code it replaced.

## Rules this implies

- **R287** — `buildSongTimeline`/`walkSongTimeline` in `plan/songTimeline.ts` is the one place an
  arrangement becomes timed events; `renderMixdown.ts` only applies pass automation and performs
  walk items, and calls no planner.
- **R288** — The renderer consumes `walkSongTimeline` incrementally, performing each item before
  resuming the walk; never collect the timeline before performing it. The walk's per-step emit
  order (drums, chord hold, bass hold, chord, bass, pad, lead, FX) is part of the contract.
- **R289** — No runtime import path from `src/audio/playback/plan/` reaches `audio/engine` or
  `playbackEngine`; `src/architecture/playbackPlannerImportGraph.test.ts` walks the graph.
- **R290** — Drums are planned by `planBeatStep` (`plan/beatPlan.ts`) for both the live stepper and
  the timeline; no caller decides drum voices or velocity itself.

**Amends [ADR-0027](0027-planned-then-performed-playback.md): R227, R229, R230, R231, R234** — the
planner list, the `chordPlayback` import rule, who performs offline events, the per-lane snapshot
list and where the offline snapshot builder lives all changed shape under this decision; their
text is updated in place there rather than superseded, since the split they describe (pure
planners vs. a performing controller) still holds.

## Sources

Spec `docs/superpowers/specs/2026-09-22-dev-420-song-event-timeline-design.md`; plan
`docs/superpowers/sdd/2026-09-22-dev-420-song-event-timeline/`; structure audit findings A4/A5
(`docs/architecture/structure/README.md`, `docs/architecture/structure/03-audio.md`).
