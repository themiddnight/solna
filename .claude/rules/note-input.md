---
paths:
  - "src/audio/playback/synthPlayback.ts"
  - "src/audio/playback/noteInputBus.ts"
  - "src/store/midiInput.ts"
  - "src/store/leadRecord.ts"
  - "src/components/useInputDeck.ts"
  - "src/components/ui/Keyboard.tsx"
  - "src/components/ui/BottomInputDock.tsx"
  - "src/components/ui/useBottomInputDock.ts"
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
written note through the armed track's length setter (`setLeadNoteLength` or
`setFxNoteLength`). A source that plays a note but never announces the
release therefore records a one-step note — audible, visible, and silently
wrong. Announce both edges.

**Sequenced notes are not input.** Playback goes through `playbackEngine`
(`playbackNoteOn`), which is deliberately not on this bus. A step the
transport played is not a step the user performed.

**Observers do not belong in the audio layer.** `noteInputBus` lives in
`audio/` and imports nothing, so it stays inside layering rule 1. Anything
that needs store state — the melody recorder, for one — subscribes from
`store/`, started once beside the engine bridge in `useEngineSync`.

### Focus routing

- The computer keyboard, the on-screen keyboard and the arp play the input target
  (`inputTargetOf`, R341) — bus and patch. <!-- R163 -->
- A note's bus is captured at note-on and never recomputed at release, so a mid-hold focus change
  cannot send a note-off to the wrong bus. <!-- R164 -->
- Equal-power polyphony counts held notes per bus, never globally. <!-- R165 -->
- The arp releases every bus it actually triggered a voice on, not just the one focused at
  cleanup. <!-- R166 -->
- A `drum` input target makes the melodic keyboard a complete no-op: nothing sounds and nothing is
  announced on the note-input bus; the QWERTY drum-pad keys are a separate listener. <!-- R167 -->
- An external MIDI device always plays Lead whatever the focus (`store/midiInput.ts` names
  `'synth'`). <!-- R168 -->

([ADR-0016](../../docs/decisions/0016-focus-routed-note-input.md), amended by
[ADR-0048](../../docs/decisions/0048-input-target-link.md))

### The input target and its link

- The input target is `inputTargetOf` (`store/focusTrack.ts`): `focusTrack` while a track is
  armed, else the persisted ui-slice pin `inputTargetPin` if set, else `focusTrack`. `null` is
  linked; one field holds both the link state and the pinned track, with no sync subscription.
  The dock's target chip and its link toggle are one joined group: linked, a pick calls
  `setFocusTrack` (and navigates); pinned, a pick calls `setInputTargetPin` and never navigates;
  unlinking pins the current target, re-linking clears the pin, and arming a track re-links
  (`setRecordingTrack` clears the pin in the same `set()`; disarming never restores it). While a
  track is armed no pin can be set: `setInputTargetPin` is a no-op and the dock disables both the
  target chip and the link toggle. Linked,
  both halves of the group wear the accent tint; pinned, the idle style. The dock's panel is derived
  from the target (`drum` → pads, else keyboard) and the keyboard mode picker is hidden for
  `drum`. Pattern segment, Sound channel, mixer row, solo and record arm stay on `focusTrack`. <!-- R341 -->

([ADR-0048](../../docs/decisions/0048-input-target-link.md))

- The polyphony count is the caller's: `useInputDeck` counts held notes per bus, excluding the
  arp and the sequencer; the voice manager skips releasing groups. <!-- R184 -->
- Live keyboard backstop: `useInputDeck.ts` releases every held note on `window` blur and on
  `visibilitychange`. <!-- R202 -->
- `noteInputSuspended` gates QWERTY notes, QWERTY drum pads and MIDI note-on/CC at their entry (note-off and keyup pass); its rising edge releases every held QWERTY note. <!-- R336 --> ([ADR-0045](../../docs/decisions/0045-vibe-picker-preview.md))

([ADR-0019](../../docs/decisions/0019-polyphony-gain-and-voice-lifetime.md))

- MIDI access is one shared request, `requestMidiAccess()` (`store/midiInput.ts`), and only two
  things call it: opening MIDI settings (`useMidiInputs`, the only place the permission prompt can
  appear) and `connectWhenMidiGranted`, which the bridge runs at startup and which calls it only
  once the `midi` permission is already `granted`. Nothing else calls `requestMIDIAccess`, and a
  second listener on the shared access uses `addEventListener`, never `onstatechange`. <!-- R350 -->
  ([ADR-0052](../../docs/decisions/0052-midi-permission-on-settings-open.md))

- `midiActivityTimestamp` is an accepted exception to "high-frequency state stays out of slices":
  a ui-slice key written per MIDI message; it must stay unpersisted. <!-- R018 -->

([ADR-0001](../../docs/decisions/0001-always-mounted-views.md))

## What is not carried

Velocity reaches the bus but never the stored note: `LeadNote` is
`{ note, len }`, and widening it would force a persist `version` bump and a
project `formatVersion` bump. The bus carries it so that day needs no second
refactor.

The bus's `time` is likewise not what the recorder quantises against. It is
whatever the source scheduled at, and only some sources name one; the
recorder reads `ctx.currentTime` itself, through
`audio/playback/leadLiveClock.ts`, and subtracts the output latency there.

## Prohibited

- Playing the keyboard, on-screen keyboard or arp on anything but the input target's bus and patch <!-- R163 -->
- Recomputing a note's bus at release <!-- R164 -->
- A global (cross-bus) polyphony count <!-- R165 --> <!-- R184 -->
- An arp cleanup releasing only the currently focused bus <!-- R166 -->
- Sounding or announcing a melodic note under a `drum` input target <!-- R167 -->
- Reading `inputTargetPin` directly instead of `inputTargetOf`, a pin that outranks record arm, a
  separate `linked` flag beside the pin, a stored dock panel, or a pinned pick that navigates <!-- R341 -->
- Routing external MIDI by focus <!-- R168 -->
- Dropping the blur/`visibilitychange` release in `useInputDeck.ts` <!-- R202 -->
- A note or drum-pad keydown, MIDI note-on or CC that ignores noteInputSuspended <!-- R336 -->
- A MIDI access request at load without a granted permission, a second `requestMIDIAccess` call site, or `onstatechange` set on the shared access outside the bridge <!-- R350 -->
- Persisting `midiActivityTimestamp` <!-- R018 -->
