# ADR-0039: PlaybackHost — transport controllers out of the grids

**Status:** Accepted — 2026-09-22. DEV-422

## Context

The structure audit's U4/A3 finding: each lane sounded only because its grid was mounted (R040),
so `components/` views were not the dumb layout the layer map otherwise promises — a view's mount
state was also an audio decision. A5 found the matching hole in `src/audio/`: `arpPlayback.ts` was
the one file there importing `react`, against the layer's "raw Web Audio API" contract. Both traced
back to the always-mounted rule (ADR-0001) doing double duty as the reason audio kept playing,
instead of being only a UI-state guarantee.

## Decision

- `components/playback/` holds the transport controllers: code used by the transport, not by any
  single view.
- `PlaybackHost` returns `null`, wrapped in `React.memo`, and is rendered once in `Workspace`
  (`App.tsx`) before `<LoopPage />`, ahead of `ArrangeView`; its hook order is the clock-listener
  order — lead, lead publisher, fx, fx publisher, chord, sequencer.
- `useLeadStepPublisher` moves with the rest: store and clock in, the `playbackStep` pub/sub out.
- The chord controller splits into `useChordClockPlayback` (mounted by the host: clock
  subscription, note-on/off) and `useChordAudition` (mounted by the chord view: pattern preview).
- The playing chord travels on `components/playingChord.ts`, a pub/sub with a content-equal no-op
  and an always-notify clear; the chord view's held-card id is local state, reset on every publish
  (last-writer-wins preserved).
- The arp keeps its body, `startArpClock`, in `src/audio/`; its React wrapper is
  `components/playback/useArpPlayback.ts`, still mounted by the input deck, because the arp follows
  held keys, not the transport.
- `REACT_IMPORT_BAN` is applied to all four `src/audio/` import blocks in `eslint.config.js`.
- `PlaybackHost` is tested by a `renderToString` smoke and a source composition test that pins the
  hook-call order.

## Rejected alternatives

- **Keep the controllers in the grids** — R040 stays true as written, and every view stays
  audio-aware just to keep a lane sounding.
- **A store slice for the playing chord** — a per-chord write would re-render every mounted view
  (R016); a pub/sub does not.
- **Moving the arp into the host** — the arp follows held keys, not the transport; it has no
  clock-listener slot to occupy.
- **A `playbackEngine` bridge per arp engine call** — four bridges for what is, underneath,
  one plain function (`startArpClock`).
- **`mock.module` spies to observe subscriptions** — process-wide in Bun, so a spy in one test file
  leaks into every other file in the run.
- **Adding `happy-dom` for one test** — the composition test reads `PlaybackHost`'s source instead
  of rendering it, so no DOM dependency is needed for one file.

## Consequences

R040 is inverted: a lane no longer sounds because its grid is mounted, but because `PlaybackHost`
is. R014/R015 keep their rule with a new reason — views stay mounted to keep their UI state
(scroll, drag, meter history, local state), not to keep audio alive; audio no longer depends on
mounting at all, so unmounting a view is now a UI change, never a silence. `SortableProgression`
re-renders on a chord change instead of the whole `ChordView` body re-rendering with it. The golden
and `bun run verify` did not change.

**Supersedes in part [ADR-0001](0001-always-mounted-views.md)** (its R040 and the "a lane sounds
because its grid is mounted" reasoning) and **amends [ADR-0002](0002-four-layer-import-architecture.md)**
(R039's controller list) and **[ADR-0027](0027-planned-then-performed-playback.md)** (R230's
controller file names).

## Rules this implies

- **R040** — Transport controllers are mounted once, in `PlaybackHost`: a lane sounds because the
  host is mounted, never because its grid is.
- **R312** — `PlaybackHost` (`components/playback/PlaybackHost.tsx`) is the only mount of the
  transport controllers (`useLeadPlayback`, `useLeadStepPublisher`, `useChordClockPlayback`,
  `useSequencerPlayback`), each called there in clock-listener order; a view never calls one.
- **R313** — The playing chord travels through `components/playingChord.ts`, never a slice; the
  chord view's held-card id is local state reset on every publish.
- **R314** — `src/audio/` imports neither `react` nor `react-dom` (`REACT_IMPORT_BAN` in every
  `src/audio/` import block); a React wrapper over an audio clock lives in `components/playback/`.

## Sources

DEV-422; `docs/superpowers/specs/2026-09-22-dev-422-playback-host-design.md`;
`docs/superpowers/plans/2026-09-22-dev-422-playback-host.md`; ADR-0001, ADR-0002, ADR-0027.
