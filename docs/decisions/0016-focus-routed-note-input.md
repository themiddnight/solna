# ADR-0016: Input plays the focused track

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). R163 and R167
amended by [0048](0048-input-target-link.md): input plays the *input target*, which is
`focusTrack` unless the dock pins another track.

## Context

`focusTrack` names the track the user is currently working on — the Pattern segment and the Sound
control target are one value (see [ADR-0015](0015-session-only-track-solo.md)). The melodic input
surfaces — the QWERTY keyboard, the on-screen keyboard and the arpeggiator — need a single answer
to "which bus and which patch does this note play on", and that answer can change while a key is
held. Three players share each melodic bus (live input, the arp, the melody-track sequencer; see
[ADR-0017](0017-voice-identity-and-ownership.md)), so a routing decision that is recomputed at the
wrong moment, or a level decision counted across the wrong set of notes, is audible.

## Decision

**The keyboard, the on-screen keyboard and the arp all play whichever track `focusTrack` names —
bus AND patch.**

- A note's bus is CAPTURED at note-on and never recomputed at release, so a focus change mid-hold
  cannot send a note-off to a bus the voice was never on.
- Equal-power polyphony counts held notes per BUS, never globally — playing a second track never
  quietens the first (the gain mechanics are in
  [ADR-0019](0019-polyphony-gain-and-voice-lifetime.md)).
- The arp releases every bus it has actually TRIGGERED a voice on (not just whichever bus is
  focused at cleanup time), because one hold can span a focus change and leave voices on more
  than one bus.
- A `drum` focus makes the melodic keyboard a complete no-op: nothing sounds and nothing is
  announced on the note-input bus, because announcing a silent key would let the recorder capture
  a note that made no sound; the disjoint QWERTY drum-pad keys are a separate listener and keep
  working regardless of focus.
- **One surface is deliberately exempt: an external MIDI device still plays Lead whatever the
  focus is** — `store/midiInput.ts` names `'synth'` outright — because routing it needs a
  drum-pad ↔ GM-note mapping this app does not have and does not need, being designed to require
  no external device.

## Consequences

- A focus change while notes are held is safe: every held note releases on the bus it started on.
- A player's level on one bus is independent of what another bus is doing.
- The recorder (see [ADR-0013](0013-melody-tracks-table-and-record-arm.md)) can only capture notes
  that actually sounded.
- External MIDI is not focus-aware; that is a scoped choice, not a bug. Making it focus-aware
  requires a drum-pad ↔ GM-note mapping first.

## Rules this implies

- **R163** — Keyboard, on-screen keyboard and arp play the track `focusTrack` names (bus and patch).
- **R164** — A note's bus is captured at note-on, never recomputed at release.
- **R165** — Equal-power polyphony counts held notes per bus, never globally.
- **R166** — The arp releases every bus it actually triggered.
- **R167** — `drum` focus makes the melodic keyboard a complete no-op (nothing sounds, nothing on
  the note-input bus); drum-pad keys are a separate listener.
- **R168** — External MIDI always plays Lead (`store/midiInput.ts` names `'synth'`) whatever the
  focus.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 549-561.
