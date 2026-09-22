# ADR-0015: Track solo is a session-only monitoring set

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

With the per-module play buttons gone, the only way to hear a subset of tracks while editing is
solo. Solo has to coexist with mute (which is arrangement intent stored per loop), with the Beat
instrument's own per-voice mute, and with `focusTrack` — a single value that merged the Pattern
segment and the Sound control target. A view may not import `audio/engine`, so whatever computes
effective audibility cannot live in a view.

## Decision

**Track solo is a monitoring gesture, and it is session-only on purpose.** `soloTracks` lives in
the ui slice, is absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`, and never touches
`LoopMixPatch` — mute is arrangement intent and stays per loop; solo exists only to hear something
while editing it.

It is a **set, not a radio** (soloing Drums then Lead sounds both — with the per-module play buttons
gone, "write a lead over just the drums" is only expressible that way), **solo beats mute**, and its
scope is the whole loop.

It is **cleared by leaving the Loop layer, by changing the active loop, or by swapping the
project** — a change of the LAYER (derived from `activeTab` via `layerForTab`) or of
`activeLoopId`, watched by the single subscription in `store/soloNav.ts` rather than by a clear
inside each writer, plus `projectSlice`'s own atomic clear on an install.

**A `focusTrack` change never clears it.** That is forced rather than chosen: `focusTrack` merged
the Pattern segment and the Sound control target into one value, and soloNav's docblock used to
argue that a segment change must clear while a target change must not — contradictory once they are
the same event. The target rule wins, because solo is a monitoring gesture whose entire purpose is
comparing tracks and clearing on every focus change would make a multi-track set unbuildable
anywhere. Consequence, on the record: a set spanning Drums and the melodic tracks is buildable from
any surface — solo Drums with focus on `drum`, then focus each melodic track in turn and solo it, on
Sound, on Pattern or from the mixer. What still empties the set is leaving the Loop layer, changing
the active loop, or swapping the project.

That clearing rule is the feature, not a rough edge: a control that can silence a track must not
keep doing so once the user has left the loop it was set in or moved to a different thing to edit.

Effective audibility is computed **only** in `engineSync.ts`, off the same `SOURCE_BUSES` table
that drives the snapshot and the subscriptions, using `isTrackAudible` from
`store/trackAudibility.ts` — `src/components/` may not import `audio/engine`, so a view may never
compute it ([ADR-0002](0002-four-layer-import-architecture.md),
[ADR-0026](0026-clock-and-engine-bridge.md)).

Solo moves the Beat **bus** only; the per-voice mute in `beatMix.voices`
([ADR-0010](0010-beat-instrument-three-fields.md)) is a second, independent layer, and both must
pass for a voice to sound. That layer has TWO appliers by design: `planBeatStep`
(`audio/playback/plan/beatPlan.ts`, path updated by ADR-0034) skips a muted voice's scheduled hits
so no silent voice is ever built, and `engineSync`'s `pushBeatVoiceGains` drives the voice's gain
to 0 — which is the one that silences what the step walk never sees, a drum PAD hit or a live
trigger. Neither cancels the other; both mean silence.

## Consequences

- Solo never reaches a saved project or the persisted session, and never alters a loop's mix.
- A multi-track solo set survives focus changes, so comparing tracks works from any surface.
- Solo ends when the user leaves the loop or the layer, so a forgotten solo cannot silently mute a
  track elsewhere.
- The record arm watches the same layer and loop axes plus focus
  ([ADR-0013](0013-melody-tracks-table-and-record-arm.md)); a project install clears both in one
  atomic patch.
- Removing either per-voice-mute applier would let some hits through (scheduled hits or pad/live
  triggers respectively).

## Rules this implies

- **R156** — `soloTracks` is in the ui slice, absent from `partializeAppState` and
  `PROJECT_CONTENT_KEYS`, never touches `LoopMixPatch`.
- **R157** — Solo is a set (not a radio), beats mute, scopes the whole loop.
- **R158** — Solo clears on layer change (`layerForTab`) or `activeLoopId` change (single
  subscription in `store/soloNav.ts`) and on project install (`projectSlice` atomic clear).
- **R159** — A `focusTrack` change never clears solo.
- **R160** — Effective audibility is computed only in `engineSync.ts` (`SOURCE_BUSES` +
  `isTrackAudible` from `store/trackAudibility.ts`); a view never computes it.
- **R161** — Solo moves the Beat bus only; per-voice mute (`beatMix.voices`) is independent; both
  must pass.
- **R162** — Per-voice mute has two appliers, keep both: `planBeatStep`
  (`audio/playback/plan/beatPlan.ts`, path updated by ADR-0034) skips hits; `engineSync`'s
  `pushBeatVoiceGains` sets gain 0 (pads, live triggers).

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 517-547.
