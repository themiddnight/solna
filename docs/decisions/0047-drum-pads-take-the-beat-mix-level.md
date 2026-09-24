# ADR-0047: Drum pads take their level from the Beat mix

**Status:** Accepted — 2026-09-24. Amends [ADR-0010](0010-beat-instrument-three-fields.md) (R105).

## Context

The input dock's Drums tab put a velocity slider under each of its ten pads. The slider's value was
a persisted UI preference (`drumPadVelocities` in the ui slice, keyed by voice id), and each pad
also authored its own default (`DEFAULT_PADS.volume`, 0.75–0.9).

That gave a voice two level controls that did not know about each other. The pad hit already
passes through the voice's fader in the current loop's Beat mix (`engineSync` →
`setDrumTrackGain`), so a pad sounded at slider × fader. A user who balanced the kit on the Beat
page heard a different balance on the pads, and the slider's setting outlived the loop and the
project it was set for.

## Decision

A pad has no level of its own. Every pad strikes at `BEAT_PREVIEW_VELOCITY`, the velocity the Beat
page's own audition buttons use, and the voice's level is its Beat-mix fader (and mute) in the
current loop. The pad grid renders no slider; `DrumPad` has no `volume` field; the
`drumPadVelocities` key, its setter and its sanitizer are removed.

A `drumPadVelocities` key already in a user's `localStorage` needs no migration:
`sanitizePersistedState` builds its result from the keys it knows, so the stale key is dropped on
the next read and gone after the next write (R214).

## Rejected alternatives

- **Keep the authored per-pad velocities (kick 0.9, hi-hat 0.75, …).** A second, hidden balance on
  top of the Beat mix, which is the thing being removed. The Beat page's audition uses one
  velocity for every voice; the pads now sound exactly like it.
- **Show the Beat-mix fader under each pad.** The same control in two places; the dock is for
  playing, and the Beat page is one tab away.

## Consequences

- Muting a voice on the Beat page silences its pad too; that was already true of the fader path.
- A pad's loudness now changes with the loop, since each loop carries its own Beat mix.

## Rules this implies

- **R105** (replaces "a pad velocity override is `drumPadVelocities`"): a drum pad has no level
  control; it strikes at `BEAT_PREVIEW_VELOCITY`, and its voice's level is the current loop's
  Beat-mix fader.

## Sources

- `src/components/ui/DrumPadGrid.tsx` (`DEFAULT_PADS`, `DrumPadGrid`)
- `src/components/useInputDeck.ts` (`useDrumPads`)
- `src/audio/playback/drumPlayback.ts` (`BEAT_PREVIEW_VELOCITY`)
- `src/store/engineSync.ts` (the Beat-mix fader → `setDrumTrackGain`)
