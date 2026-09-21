# ADR-0019: Dedicated polyphony gain; no lifetime timer

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Two voice-level concerns in `SynthVoiceManager` share one theme: never let a convenience mechanism
touch a voice's sound or lifetime in a way the audio clock does not control.

**Polyphony level.** One bus's total level should stay flat as keys are added to it. The legacy
engine folded the equal-power scale into the amp envelope's peak and had to cancel and re-plan
every held voice's ramps on each key change. An amp envelope cannot be re-planned mid-note without
a click, and `tremoloGain` carries whatever contour ENV2's amplitude route and the LFO have
scheduled, which a write would re-anchor. Keydowns are sequential, so a scale baked into each
note's velocity would leave a chord pressed key by key at 1, 1/√2, 1/√3 by press order.

**Voice lifetime.** The flat engine armed a 30-second wall-clock backstop per voice against a
note-off that never arrived.

## Decision

### Equal-power polyphony rides a gain of its own, never the envelope

- `applySynthVelocityScale(scale, source)` reaches `SynthVoiceManager.setPolyphonyScale`, which
  ramps a dedicated `polyGain` sitting between the voice's tremolo gain and its panner. It has to be
  separable from both neighbours (the amp envelope and `tremoloGain`, for the reasons above).
- The COUNT is the caller's: `useInputDeck` counts the notes held on that bus, so the arp and the
  melody sequencer, which share these buses, never enter into it — and the manager skips any group
  already releasing, so a key-down cannot duck what the transport is playing and a key-up cannot
  re-lift a fading tail.
- The note itself is played at plain velocity and the rebalance runs AFTER it, one call covering the
  arriving voice and the ones already sounding.

### No timer guards a voice's lifetime

`SynthVoiceManager` has no counterpart to the 30-second backstop on purpose (rule 5 in its header
records the whole argument): nearly every `triggerSynthNoteOn` in the app calls
`triggerSynthNoteOff` in the same synchronous block on the audio clock — arp, preview, all four
sequencer bridges, the offline render — so for those nothing can fail to arrive. Two paths depend on
a later event rather than on the audio clock:

- **Live keyboard input**, whose key-up carries its own backstop in `useInputDeck.ts` (every held
  note released on `window` blur and on `visibilitychange`).
- **The held chord preview**, which does not. `playChordLegato` schedules no note-off and drops the
  `VoiceId`s outright; release is `stopSource('chord')` from a pointer event, and `useInputDeck`'s
  backstop releases what the KEYBOARD holds and knows nothing about a chord held with the mouse.
  That one is narrowed rather than closed — every surface binds `onMouseLeave` and `onTouchEnd`
  beside `onMouseUp`, and `playChordLegato` opens by stopping its own bus, so a stranded preview
  lasts until the next preview, loop load, project install or vibe swap. Closing it properly means
  a blur/`visibilitychange` backstop for that preview, never a timer in the manager.

A new caller that keeps a `VoiceId` across an await, a React render or a user event is adding a
third such path and owes itself the same treatment. The per-source budget (`maxVoicesPerSource`)
bounds the voice COUNT and is not a leak guard; a voice that does drone means a bridge dropped its
id, so trace the bridge and not the manager.

## Consequences

- A chord pressed key by key ends at equal per-voice levels regardless of press order, and held
  voices never click when the count changes.
- Live input's polyphony scale never ducks sequenced or arpeggiated notes on the same bus.
- The held chord preview is a known, narrowed gap, not a closed one (see Decision).
- Debugging a drone starts at the bridge that dropped its `VoiceId`
  ([ADR-0017](0017-voice-identity-and-ownership.md)), not at the manager.
- The "all four sequencer bridges" count above is carried from the source text and was not
  re-verified during DEV-425.

## Rules this implies

- **R183** — Polyphony scale = `applySynthVelocityScale(scale, source)` →
  `SynthVoiceManager.setPolyphonyScale` ramping a dedicated `polyGain` between tremolo gain and
  panner; never the amp envelope or `tremoloGain`.
- **R184** — The count is the caller's (`useInputDeck` counts held notes per bus; arp/sequencer
  excluded); the manager skips releasing groups.
- **R185** — Notes play at plain velocity; the rebalance runs after, one call covering all sounding
  voices.
- **R201** — No wall-clock timer guards a voice's lifetime in `SynthVoiceManager`.
- **R202** — Live keyboard backstop: `useInputDeck.ts` releases every held note on `window` blur and
  `visibilitychange`.
- **R203** — Known narrowed gap: held chord preview (`playChordLegato`) — surfaces bind
  `onMouseLeave`/`onTouchEnd` beside `onMouseUp`; `playChordLegato` first stops its bus; the proper
  fix is a blur/`visibilitychange` backstop, never a manager timer.
- **R204** — A new caller holding a `VoiceId` across an await, render or user event must add its own
  backstop.
- **R205** — `maxVoicesPerSource` bounds count, not leaks; a droning voice means a bridge dropped its
  id.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 612-624 and 676-693.
