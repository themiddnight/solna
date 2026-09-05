---
paths:
  - "src/audio/playback/synthPlayback.ts"
  - "src/audio/playback/noteInputBus.ts"
  - "src/store/midiInput.ts"
  - "src/store/leadRecord.ts"
  - "src/components/useInputDeck.ts"
  - "src/components/ui/Keyboard.tsx"
---

# The note-input layer

Three things can play a note in solna — the computer keyboard, the on-screen
keyboard, and a MIDI device — and every one of them goes through **one
dispatcher**. Features that want performed notes subscribe to that dispatcher
instead of being soldered onto each source in turn.

The shape comes from murva's `NoteDispatch`: a single entry point, MIDI
normalised before it gets there, and **recording as a parallel observer of the
play call** rather than logic embedded in whatever made the sound.

## The two functions that matter

| | plays audio | announces on the bus |
|---|---|---|
| `synthPlaybackNoteOn` / `…NoteOff` | yes | **yes** |
| `synthPlaybackPreview` | yes | **no** |

`synthPlaybackNoteOn` means *a person played this note*. `synthPlaybackPreview`
means *the UI is sounding something it is showing you* — a melody-grid cell you
clicked, a preset chip. The split is not cosmetic: if a preview announced
itself, arming the recorder and clicking a cell would write that cell twice.

`noteInputBus` carries `{ kind, note, velocity, time }`. Subscribe with
`subscribeNoteInput`; it returns the unsubscribe.

## Rules

**A new input source joins the funnel.** Call `synthPlaybackNoteOn/Off`, never
`audioEngine.triggerSynthNote*` directly. MIDI used to call the engine
directly, and the result was a device that was audible but invisible: anything
watching for performed notes heard the computer keyboard and silently missed
the piano. That is the exact failure this layer exists to prevent.

**Announce even when you do not play.** `useInputDeck`'s arp branch calls
`emitNoteInput` by hand, because with the arp on the arp schedules the note
itself and nothing reaches the wrapper. A source that swallows the sound still
has to announce the press, or every key pressed with the arp on goes
uncaptured with no error anywhere.

**Emit after the sound is scheduled, never before.** A subscriber that throws
must not be able to swallow a note the user played.

**A note-off is data now, not just a release.** Live capture (DEV-374) reads
the gap between a note's on and its off, quantised in steps, and extends the
written note through `setLeadNoteLength`. A source that plays a note but
never announces the release therefore records a one-step note — audible,
visible, and silently wrong. Announce both edges.

**Sequenced notes are not input.** Playback goes through `playbackEngine`
(`playbackNoteOn`), which is deliberately not on this bus. A step the
transport played is not a step the user performed.

**Observers do not belong in the audio layer.** `noteInputBus` lives in
`audio/` and imports nothing, so it stays inside layering rule 1. Anything
that needs store state — the melody recorder, for one — subscribes from
`store/`, started once beside the engine bridge in `useEngineSync`.

## What is not carried

Velocity reaches the bus but never the stored note: `LeadNote` is
`{ note, len }`, and widening it would force a persist `version` bump and a
project `formatVersion` bump. The bus carries it so that day needs no second
refactor.

The bus's `time` is likewise not what the recorder quantises against. It is
whatever the source scheduled at, and only some sources name one; the
recorder reads `ctx.currentTime` itself, through
`audio/playback/leadLiveClock.ts`, and subtracts the output latency there.
