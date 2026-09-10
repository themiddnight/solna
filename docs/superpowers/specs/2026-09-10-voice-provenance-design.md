# Per-Voice Provenance Design

**Status:** approved, not yet implemented
**Date:** 2026-09-10

## The problem

`audioEngine.releaseSoundingVoices(source, releaseTime)` releases every SOUNDING
voice on a source bus, not only the voices the caller created. The arpeggiator's
key-up path calls it, so releasing an arp hold cuts short a melody track's note
that is sounding on the same bus. The lead track's engine source is `'synth'` and
the FX track's is `'fx'`; the arp plays whichever bus `focusTrack` names, so this
is reachable on every melodic bus.

This predates the focus-track work — the lead has always shared `'synth'` — and
focus routing only widened which buses it can happen on.

The same defect exists in the opposite direction and was found while designing
this: `useLeadPlayback` stops a melody grid with
`playbackStopSource(track.engineSource, …)`, which cuts the note the player is
holding down and every arp voice on that bus.

Neither can be fixed at the call site. The engine has no per-voice record of
which player created a voice, so a release cannot scope itself to one player.

## Three players share one melodic bus

| player | reaches the engine through |
|---|---|
| live input (computer keyboard, on-screen keyboard, MIDI) | `audio/playback/synthPlayback.ts` |
| the arpeggiator | `audio/playback/arpPlayback.ts` |
| the melody-track sequencer | `audio/playback/playbackEngine.ts` (from `useLeadPlayback`) |

`'preview'` has one player today. `'chord'`, `'bass'` and `'pad'` do not:
`SynthControlTarget` (`src/utils/synthControl.ts`) includes them alongside
`'synth'` and `'fx'`, and `focusTrack` can route live input and the arp onto
any of them, so `useChordPlayback.ts`'s `playbackStopSource` calls carry the
same whole-bus-stop defect this plan fixes for the lead and FX tracks — not yet
addressed, and out of this plan's scope. The design still labels every voice's
owner regardless, because an unlabelled voice would be a hole the required
parameter below exists to close.

## Design

### The owner roster

`src/audio/voiceOwner.ts`, a leaf module that imports nothing:

```ts
export const VOICE_OWNERS = ['live', 'arp', 'sequencer', 'preview'] as const;
export type VoiceOwner = (typeof VOICE_OWNERS)[number];
```

Four values, each mapping to a kind of caller that exists today; none is
speculative. `'live'` is a person pressing something. `'arp'` is the
arpeggiator's clock. `'sequencer'` is the transport playing back written
material. `'preview'` is an audition — clicking a library item or a grid cell to
hear it.

The roster is a table so a test can assert `VOICE_OWNERS` and `VoiceOwner` stay
in step; a union declared alone cannot be enumerated at runtime, and a roster
declared alone cannot be checked at compile time.

It is its own module rather than an export of `engine.ts` because every bridge in
`audio/playback/` needs the type and none of them should widen its dependency on
the engine to get it.

### Engine changes (`src/audio/engine.ts`)

- `SynthVoice` gains `owner: VoiceOwner`. It is written at the single voice
  construction site, which is the only moment that means "this player now owns a
  voice here".
- `triggerSynthNoteOn(noteName, params, velocity, time, source, scaleFactor, owner)`
  — `owner` is **required and has no default**. This is the same rule
  `applySynthVelocityScale(scale, source)` already enforces, for the same
  recorded reason: that bug existed precisely because a call site could leave the
  argument off and silently re-acquire reach over every voice. A default value
  would let the next call site do it again, with no type error to see.
- `releaseSoundingVoices(source, releaseTime, owner)` — `owner` required.
  Releases only that owner's sounding voices. Its existing rules are unchanged: a
  future-scheduled voice that already owns a release keeps it, and a future voice
  with no release of its own is still silenced so it cannot drone.
- `stopOwnedVoices(source, owner, releaseTime, time?)` — new. `stopSource`'s
  semantics (it also drops hits scheduled ahead of the transport) narrowed to one
  owner.
- `stopSource(source, releaseTime, time?)` keeps its whole-bus meaning,
  unchanged. `store/loadLoop.ts`, `store/vibes.ts` and `store/projectSlice.ts`
  genuinely mean "silence this bus, whatever is on it", and a project install
  that left a held note ringing would be a worse bug than the one this spec
  closes.

Whole-bus reach therefore requires calling a method whose name says so. It can
never be reached by omitting an argument — which is how the defect being fixed
here came to exist.

The skip guard inside `stopSource` (a voice already fading toward a teardown no
later than the one this stop would plan is left alone, so a fast-clicked preview
does not pin dead voices in `sourceVoices`) is extracted into one private helper
that takes an optional owner. Both public methods delegate to it and pass their
owner explicitly. That guard must not exist in two copies: it is subtle, it was
arrived at from a real bug, and a drift between the two copies would be
inaudible until it wasn't.

### Who owns what — the bridge decides, not the caller

| bridge function | owner it stamps |
|---|---|
| `synthPlayback.synthPlaybackNoteOn` | `'live'` |
| `synthPlayback.releaseSynthPlaybackVoices` | `'arp'` |
| `arpPlayback` (calls the engine directly) | `'arp'` |
| `playbackEngine.playbackNoteOn` | `'sequencer'` |
| `chordPlayback` scheduled hits and `playFullHoldChord` | `'sequencer'` |
| `chordPlayback` preview helpers, `presetPreview` | `'preview'` |

`releaseSynthPlaybackVoices` stamps `'arp'` because its one caller is
`useInputDeck`'s arp cleanup — the callback it hands to
`releaseTriggeredTargets`. It is not a general-purpose release and must not
become one; a future caller that means something else needs its own wrapper
naming its own owner.

Consequence worth stating: **no file in `src/components/` names an owner.** The
mapping lives entirely at the bridge layer, so the layering rules do not move and
a view cannot pick the wrong owner.

### The two behaviours that change

- `arpPlayback.ts`'s cleanup passes `'arp'`. The KNOWN LIMITATION comment there
  is deleted rather than reworded — it stops being true.
- `useLeadPlayback`'s two stop paths (the hard stop and the bar-boundary stop)
  call a new `playbackEngine` wrapper, `playbackStopOwnedVoices`, which pins
  `'sequencer'`. Stopping a melody grid no longer cuts a held key or the arp.

## What this deliberately does not fix

`activeVoices` stays keyed `` `${source}:${noteName}` `` and keeps only the
latest voice per key. Two players on one bus therefore still share one voice
slot: if the melody grid plays C4 on `'synth'` while a key holding C4 is down,
the dedup at the top of `triggerSynthNoteOn` releases the held note's voice.

The note is **cut short, not left droning** — the dedup releases the older voice
correctly, which is why this is a musical wart and not a stuck-voice bug. Giving
each owner its own voice slot would mean revisiting the same-note dedup, the bass
mono-kill, voice stealing and `updateSynthParams`, all of which the existing
tests pin to today's one-slot behaviour. That is a larger change than the defect
being fixed here justifies, and it is deferred.

This limitation is recorded as a comment at `activeVoices` — at the cause — not
at the arp, which is merely one place it can be noticed.

`applySynthVelocityScale` needs no owner filter. It already skips every voice
with a planned release, and sequenced voices always have one (`playbackNoteOff`
schedules the release at scheduling time), so equal-power polyphony from a
keyboard hold already cannot re-shape the sequencer's notes. This is written down
so a reader does not have to conclude it was forgotten.

## Testing

The audio harness is `src/audio/testFakes.ts`. `fakeParam.valueAt(t)` refuses a
timeline containing `setTargetAtTime`, and release ramps use it, so these assert
on the recorded `events` / `targets` / `cancels` instead.

- Two voices on one bus with different owners; `releaseSoundingVoices(source, r,
  'arp')` gives the `'arp'` voice a release ramp and leaves the `'sequencer'`
  voice with no new events at all.
- The same for `stopOwnedVoices`, plus a future-scheduled voice belonging to
  another owner surviving untouched — that is the case a whole-bus stop destroys.
- Verified by deletion: removing the owner filter must turn a named test red.
  A filter test that passes with the filter gone is not a test.
- `arpPlayback.test.ts`: `releaseTriggeredTargets` carries the owner through to
  its injected release callback.
- `VOICE_OWNERS` and `VoiceOwner` agree, as a compile-time assertion plus a
  runtime roster check.

## Gate

`bun run verify`. `bun run eslint` must report zero errors and zero warnings.
`src/audio/` may not import `src/store/` or `src/components/`.
