# ADR-0017: Note-on returns `VoiceId`; every voice has an owner

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Three players share each melodic bus: live input, the arp, and the melody-track sequencer. The
engine used to key a sounding voice by `` `${source}:${noteName}` ``. A source-and-note pair is NOT
an identity: that key named as many voices as happened to be sounding that note, and an arp key-up
cut short a melody track's note.

The bulk-release methods had the same flaw one level up: whole-bus reach was what you got by
omitting an argument, which is exactly how the defect came to exist. `applySynthVelocityScale`'s
required `source` carries the same scar (see [ADR-0019](0019-polyphony-gain-and-voice-lifetime.md)).

## Decision

**A note-on returns the identity a note-off addresses, and every voice records the PLAYER that
created it.**

- `triggerSynthNoteOn` hands back a `VoiceId` (`src/audio/synth/voiceId.ts`) and
  `triggerSynthNoteOff` takes one, so a bridge releases the instance it started.
- Every voice also carries an `owner: VoiceOwner` from `src/audio/voiceOwner.ts` — `live`, `arp`,
  `sequencer`, `preview` — **required with no default** at `triggerSynthNoteOn`, because the bulk
  calls are owner-scoped:
  - `releaseSoundingVoices(source, releaseTime, owner)` releases what one player holds and skips
    anything already releasing (so an arp key-up cannot cancel notes the clock has planned);
  - `stopOwnedVoices(source, owner, …)` reaches that player's booked tails too — which is why the
    two are different methods and not one with a flag.
- `stopSource` keeps its whole-bus meaning for a project install, a loop load and a vibe swap,
  which genuinely mean "silence this bus, whatever is on it". **Whole-bus reach therefore requires
  calling a method whose name says so, and can never be reached by omitting an argument.**
- The owner is chosen by the bridges in `src/audio/playback/` and **no file in `src/components/`
  names one**, so the layering rules do not move and a view cannot pick the wrong owner.
- A mono bus is the one SHARED voice: several players can hold notes on it, `group.owner` records
  only which of them built it, and every decision about it is therefore taken on the held-note
  stack — keying one off the owner stranded a sounding voice and left another player's id
  resolving to nothing.

## Consequences

- An arp key-up can no longer truncate a sequenced note on the same bus, and vice versa.
- Every new note-on call site must name its owner; forgetting is a type error, not a silent
  whole-bus default.
- A caller that keeps a `VoiceId` across an await, a render or a user event owns its release path
  (see [ADR-0019](0019-polyphony-gain-and-voice-lifetime.md), R204).
- The engine never needs a note name to find a voice, which is what lets
  [ADR-0018](0018-engine-frequency-boundary.md) remove note names from the engine entirely.

## Rules this implies

- **R169** — `triggerSynthNoteOn` returns a `VoiceId` (`src/audio/synth/voiceId.ts`);
  `triggerSynthNoteOff` takes it; source+note is never an identity.
- **R170** — Every voice carries `owner: VoiceOwner` (`live`/`arp`/`sequencer`/`preview`,
  `src/audio/voiceOwner.ts`), required with no default.
- **R171** — `releaseSoundingVoices(source, releaseTime, owner)` releases one player's sounding
  voices, skipping releasing ones; `stopOwnedVoices(source, owner, …)` also reaches booked tails;
  two methods, never one with a flag.
- **R172** — `stopSource` = whole bus; used for project install, loop load, vibe swap.
- **R173** — Whole-bus reach requires a method whose name says so, never an omitted argument (same
  for `applySynthVelocityScale`'s required `source`).
- **R174** — The owner is chosen by bridges in `src/audio/playback/`; no file in `src/components/`
  names one.
- **R175** — Mono-bus decisions are taken on the held-note stack, never on `group.owner`.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 563-584.
