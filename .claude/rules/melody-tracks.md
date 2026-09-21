---
paths:
  - "src/store/melodyTracks.ts"
  - "src/store/leadSlice.ts"
  - "src/store/fxSlice.ts"
  - "src/store/leadRecord.ts"
  - "src/store/musicContextSlice.ts"
  - "src/store/loopCopy*.ts"
  - "src/audio/leadMelody.ts"
  - "src/components/loop/lead/**"
---

# Melody tracks (Lead and FX)

The `MELODY_TRACKS` table, the record arm, key changes and borrowed out-of-scale rows.

## Table, record arm, key change

- `MELODY_TRACKS` (`store/melodyTracks.ts`) spells each row's store field names as data; no `` `${id}MelodySteps` `` naming convention (the Lead row is irregular). <!-- R132 -->
- `leadSlice` is one factory instantiated twice. <!-- R133 -->
- `LeadMelodyGrid` takes a required `trackId` with no default (a forgotten prop would silently render a second Lead grid). <!-- R134 -->
- Two mounted melody grids hold two clock subscriptions (allowed by the clock rule in `playback.md`); neither starts a timer. <!-- R135 -->
- The step publisher is keyed per track (`StepPlayerId` includes `'fx'`). <!-- R136 -->
- `recordingTrack: MelodyTrackId | null` lives in the ui slice, so at most one track is armed. <!-- R137 -->
- `store/leadRecord.ts` is a factory over `MELODY_TRACKS`; each bridge writes only while `recordingTrack` names its row; one shared anchor collector. <!-- R138 -->
- The Rec button renders on the grid `melodyTrackForFocus(focusTrack)` names, and on neither for chord, bass, pad or drum focus. <!-- R139 -->
- `startRecordArmSync` clears the arm on a layer change (not a Sound ↔ Pattern hop), an `activeLoopId` change and a focus change; a project install clears it in the same atomic patch that clears solo. <!-- R140 -->
- Nothing couples the arm back to the audition target. <!-- R141 -->
- Deferred limits, not bugs: the FX synth voice has no pitch riser (the filter envelope ramps `filter.frequency` only) and its LFO restarts per note. <!-- R142 -->
- `keyChangePatch` (`store/musicContextSlice.ts`) is the whole write for a root/scale change, transposing/remapping every `MELODY_TRACKS` row; a vibe folds it into its single `set()`. <!-- R143 -->
- The loop-copy `key` group copies the key and transposes neither melody (`impliesKeyCopy`). <!-- R144 -->

## Borrowed rows

- A view change never deletes or hides an out-of-key note: `leadPitchRows` merges out-of-scale notes from `leadNotesInWindow` back in as rows. <!-- R145 -->
- A borrowed row is derived, not stored; a note the resolution or loop length cannot reach conjures no row. <!-- R146 -->
- A borrowed row's window is the span the scale rows cover, not the octave suffix. <!-- R147 -->
- Out-of-scale rows use `--color-accent` via `leadSpanClasses`' third argument and `leadRowLabelTone`. <!-- R148 -->

([ADR-0013](../../docs/decisions/0013-melody-tracks-table-and-record-arm.md))

## Persisted shape

- `asLeadNoteMatrix` (`sanitize.ts`) returns `undefined` for the pre-DEV-369 `string[][]` shape, so such a payload comes back blank with no throw or warning; do not "fix" it. <!-- R259 -->

([ADR-0023](../../docs/decisions/0023-validation-instead-of-migration.md))
