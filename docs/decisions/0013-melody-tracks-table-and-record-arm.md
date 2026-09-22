# ADR-0013: FX as Lead's twin via `MELODY_TRACKS`; one armed track; borrowed rows

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

FX was added as a second melody track beside Lead. The two need the same slice, grid, recorder,
step publisher and key-change behaviour, but Lead's store fields predate FX and are irregular. Two
recordable grids also raise the question of which one a keypress writes to, and when an arm stops
applying. Separately, switching the lead grid to a scale-locked view used to make out-of-key notes
invisible, because they had no row to be drawn on.

## Decision

### FX is the lead track's twin, and the symmetry comes from a table rather than a rename

`MELODY_TRACKS` (`store/melodyTracks.ts`) has one row per melody track and spells its store field
names out as table data — the `SOURCE_BUSES` precedent — because the LEAD row is irregular in four
columns (`synthParams`, `synthVolume`, `synthMuted`, engine source `'synth'`) and a
`` `${id}MelodySteps` `` convention would need a per-column exception for one of the two rows.

`leadSlice` is one factory instantiated twice, and `LeadMelodyGrid` takes a **required** `trackId`
with no default — a default of `'lead'` would make a call site that forgot the prop render a second
copy of the lead grid, visually plausible and caught by no test, because both instances would be
internally consistent.

Two mounted grids hold two clock subscriptions, which is what the "the clock runs iff a player
holds a subscription" rule ([ADR-0026](0026-clock-and-engine-bridge.md)) permits: both are players
and neither starts a timer. The step publisher is keyed per track (`StepPlayerId` gained `'fx'`);
one shared slot would have the FX playhead driving the lead's marker at whichever grid's stride
published last, with no error anywhere.

### Rec is armed per melody track, and the armed track is ONE value

`recordingTrack: MelodyTrackId | null` lives in the ui slice, so two tracks can never be armed at
once and one keypress can never write two grids; `store/leadRecord.ts` is a factory over
`MELODY_TRACKS` and each bridge writes only while `recordingTrack` names its own row, with one
shared anchor collector rather than one per bridge. The Rec button renders on whichever melody grid
`melodyTrackForFocus(focusTrack)` names and on neither when focus is chord, bass, pad or drum.

**The arm is cleared by any navigation away from the armed grid**, not by a focus change alone:
`startRecordArmSync` watches the two axes `soloNav.ts` watches — the LAYER (derived from
`activeTab`, so a Sound <-> Pattern hop does NOT disarm) and `activeLoopId` — PLUS the focus, which
solo deliberately ignores ([ADR-0015](0015-session-only-track-solo.md)), and a project install
clears the arm in the same atomic patch that clears the solo set. A recorder left armed on a grid
the user has navigated away from writes notes the user cannot see, and a focus change is not the
only way to navigate away. Nothing couples the arm back to the audition target, because the armed
track already IS the focused track.

### Known deferred limits of the FX synth voice

Separately, **the FX track's synth voice** cannot do a PITCH riser as shipped (the filter envelope
ramps `filter.frequency` only), and its LFO still restarts on every note (the LFO oscillator is
created per voice at note-on); a FILTER-SWEEP riser works today. Both limits are deferred to their
own spec — they are not bugs to fix in passing.

### A key change moves every melody track, and the table says which

`changeKey` (`store/keyChange.ts`) is the whole write a root or scale change makes —
the new key plus every `MELODY_TRACKS` row transposed (root) and remapped (scale) to follow it — so
Lead and FX can never disagree about the key, and a vibe folds the same patch into its own single
`set()`. The loop-copy `key` group is the deliberate exception: it copies a key and transposes
neither melody (`impliesKeyCopy`).

### A scale-locked lead grid borrows a row; it never hides a note

A note outside the key is never deleted by a view change — before, it simply had no row to be drawn
on, so switching to scale-locked made it invisible. `leadPitchRows` now takes the set
`leadNotesInWindow` returns — the notes the ACTIVE window actually draws, walked in leadCellKinds'
own coordinate space — and merges any that are out of scale back in as rows.

Two consequences. A borrowed row is **derived, not stored**: erase its last note and the row goes
with it, and a note the resolution or the loop length cannot reach conjures no row, because an
empty row whose note is invisible reads as a bug rather than as preservation. And the window a
borrowed row is bounded by is **the span the scale rows cover, not the octave suffix** — a scale
spills into the next octave label (D major at octave 4 runs D4..C#5), so bounding by suffix would
admit a C4 that sits below the grid's own lowest row.

Out-of-scale rows name `--color-accent` in both views — `leadSpanClasses`' third argument for the
notes, `leadRowLabelTone` for the label — so in chromatic view the accent labels also read as the
semitones the key leaves out.

## Consequences

- Adding a third melody track is a new table row plus whatever its irregular columns need, not a
  rename across the code.
- A forgotten `trackId` is a compile error, not a silent duplicate lead grid.
- A keypress can write to at most one grid, and never to a grid the user has navigated away from.
- Lead and FX always share the key; loop-copy's `key` group is the one intended exception.
- An out-of-key note is always visible in the grid that owns it, whichever view is active.
- The grids' storage and stride model is [ADR-0012](0012-pattern-storage-and-step-layouts.md).

## Rules this implies

- **R132** — `MELODY_TRACKS` (`store/melodyTracks.ts`) spells each row's store field names as
  data; no `` `${id}MelodySteps` `` convention.
- **R133** — `leadSlice` is one factory instantiated twice.
- **R134** — `LeadMelodyGrid` takes a required `trackId` with no default.
- **R135** — Two mounted melody grids hold two clock subscriptions (permitted by R220); neither
  starts a timer.
- **R136** — The step publisher is keyed per track (`StepPlayerId` includes `'fx'`).
- **R137** — `recordingTrack: MelodyTrackId | null` in the ui slice: at most one armed track.
- **R138** — `store/leadRecord.ts` is a factory over `MELODY_TRACKS`; each bridge writes only while
  `recordingTrack` names its row; one shared anchor collector.
- **R139** — Rec renders on the grid `melodyTrackForFocus(focusTrack)` names; on neither for
  chord/bass/pad/drum focus.
- **R140** — `startRecordArmSync` clears the arm on layer change (not Sound↔Pattern),
  `activeLoopId` change and focus change; a project install clears it in the same atomic patch
  that clears solo.
- **R141** — Nothing couples the arm back to the audition target.
- **R142** — Known deferred limits, not bugs: FX synth voice has no pitch riser (filter env ramps
  `filter.frequency` only); LFO restarts per note.
- **R143** — `changeKey` (`store/keyChange.ts`) is the whole write for a root/scale
  change, transposing/remapping every `MELODY_TRACKS` row; a vibe folds it into its single
  `set()`.
- **R144** — Loop-copy `key` group copies the key and transposes neither melody
  (`impliesKeyCopy`).
- **R145** — A view change never deletes/hides an out-of-key note: `leadPitchRows` merges
  out-of-scale notes from `leadNotesInWindow` back in as rows.
- **R146** — A borrowed row is derived, not stored; a note unreachable by resolution/loop length
  conjures no row.
- **R147** — A borrowed row's window is the span the scale rows cover, not the octave suffix.
- **R148** — Out-of-scale rows use `--color-accent` via `leadSpanClasses`' 3rd arg and
  `leadRowLabelTone`.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 449-484, 503-515.
