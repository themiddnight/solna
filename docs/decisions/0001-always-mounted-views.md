# ADR-0001: Every view stays mounted; high-frequency state stays local

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Solna is a single-page audio workstation with two layers (Loop, Song) holding four tab views
between them — Sound and Pattern on the loop layer, Arrange and Master on the song layer — plus
Pattern's own four segments (Lead, FX, Accompaniment, Beat). Audio must never stop when the user
switches tabs, and the live playback controllers that make a lane sound are mounted inside the
grids that show it. (Superseded by ADR-0039: they are mounted once, in PlaybackHost.)

## Decision

**Every one of the layers, tab views and Pattern segments stays mounted simultaneously**, gated
`block`/`hidden` at three levels:

- `App.tsx` on the layer (`isSongLayer(activeTab)`),
- `LoopPage.tsx` on `activeTab`,
- `PatternView.tsx` on `segmentForFocus(focusTrack)`.

Audio therefore never stops when switching tabs.

**Superseded by [ADR-0039](0039-playback-host.md).** The live playback controllers —
`useChordPlayback`, `useLeadPlayback`, `useSequencerPlayback`, `useInputDeck`, `usePlayheadSync` —
are mounted inside the grids: **a lane sounds because its grid is mounted**, which is one more
reason every view stays mounted. (Where controllers live and what they may import is
[ADR-0002](0002-four-layer-import-architecture.md).)

High-frequency state — the current playback step, the playhead beat, a value being dragged on a
knob — stays local to the subtree that shows it, never in a slice. The step and the playhead beat
each travel through a module-level pub/sub in `src/components/` (`playbackStep.ts`,
`playheadBeat.ts`).

## Consequences

- State that lives in a store slice or high in the tree re-renders *every* mounted view, not just
  the visible one. High-frequency state must therefore stay local to the subtree that shows it.
- One known, accepted exception: `midiActivityTimestamp` is still a ui-slice key written per MIDI
  message, kept cheap because it is not persisted (see the persist write path,
  [ADR-0022](0022-persist-write-path-and-guarded-storage.md)).
- Anything with a per-frame cost on a surface nobody is looking at needs its own visibility gate
  (meters do this through `utils/meterScheduler.ts`, [ADR-0028](0028-sample-based-metering.md)).
- Unmounting a grid silences its lane, so "hide a view by unmounting it" is not a refactor; it is
  a behaviour change — superseded by ADR-0039: unmounting a view no longer silences anything, but
  it still loses the view's UI state.

## Rules this implies

- **R014** — Every layer (Loop, Song), tab view (Sound, Pattern, Arrange, Master) and Pattern
  segment (Lead, FX, Accompaniment, Beat) stays mounted; gated `block`/`hidden` in `App.tsx`
  (`isSongLayer(activeTab)`), `LoopPage.tsx` (`activeTab`), `PatternView.tsx`
  (`segmentForFocus(focusTrack)`).
- **R015** — Audio never stops when switching tabs.
- **R016** — High-frequency state (playback step, playhead beat, knob drag value) stays local to
  the subtree that shows it, never in a store slice.
- **R017** — Step and playhead beat travel through module pub/subs
  `src/components/playbackStep.ts`, `playheadBeat.ts`.
- **R018** — Accepted exception: `midiActivityTimestamp` is a ui-slice key written per MIDI
  message; it must stay unpersisted.
- **R040** — Transport controllers are mounted once, in `PlaybackHost`: a lane sounds because the
  host is mounted, never because its grid is. (inverted by ADR-0039)

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 57-69, 117-118.
