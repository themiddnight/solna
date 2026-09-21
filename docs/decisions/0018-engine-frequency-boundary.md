# ADR-0018: The engine takes Hz, never a note name

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). Implements
DEV-399 (the engine's input narrowed to resolved playable events).

## Context

[ADR-0005](0005-music-core-and-tonal-confinement.md) separates musical intent, derived
representation and playable event; a playable event is the sole input the audio engine takes.
While the engine still accepted note names it carried a music-domain vocabulary it had no need
for, and a note name inside the engine is the raw material a `` `${source}:${noteName}` `` voice
lookup gets rebuilt from — the exact defect `VoiceId` exists to make unrepresentable (see
[ADR-0017](0017-voice-identity-and-ownership.md)).

## Decision

**The engine takes a frequency, not a note name, and that is where the music domain stops.**

- `triggerSynthNoteOn(frequency, synth, velocity, time, source, scaleFactor, owner)` takes Hz
  already resolved by its caller (DEV-399); `SynthVoiceNoteOn`, `ManagedVoice` and
  `SubtractiveVoiceEvent` all carry `frequency: number` and no note name at all.
- The conversion is `noteFrequency` — the same function, unmoved and unchanged — called by the
  CONTROLLER that schedules the note, and `src/architecture/frequencyBoundary.test.ts` holds the
  literal allowlist of files permitted to name it (walking both `src/` and `scripts/`, since a
  calibration script is a controller too), so widening the list is a decision a reviewer sees.

Two things follow that are easy to undo by accident.

- **The engine has no display vocabulary and must not regain one**: a note name passed in "just for
  logging" is the raw material a `` `${source}:${noteName}` `` voice lookup gets rebuilt from. The
  name belongs to the note-input bus (`emitNoteInput({ kind, note, … })` in `synthPlayback.ts`),
  which is a controller.
- **The engine may still read the TIMING half of `utils/musicTheory.ts`** (`STEPS_PER_BAR`,
  `stepDurationSec`) — `ENGINE_MUSIC_DOMAIN_BAN` in `eslint.config.js` is an `allowImportNames`
  allowlist over that module rather than a ban on it, so a pitch, chord, scale or reharmonization
  export added there later is banned in the engine on the day it is written, with no config edit.

Scope of the gate:

- It covers `src/audio/engine.ts`, `src/audio/synth/**`, `drumSynth.ts` and `masterRack.ts`, and
  deliberately not `clock.ts` (a timing service) or `src/audio/playback/**` itself (the controllers
  whose job is the resolving it forbids).
- The guarded files may not IMPORT from `src/audio/playback/**` either, since a planner's own output
  types there still name a pitch (`ArmedChordPlan`, `BarInvariantEvent`), so even a type-only import
  would smuggle a note name back into the engine with no runtime cycle to catch it.
- `src/architecture/engineDomainPurity.test.ts` is the committed proof that the block is armed, at
  `error`, in both the aliased and the relative import form.

## Consequences

- Pitch resolution happens once, in the controller (live) or the planner/render path (offline;
  see [ADR-0027](0027-planned-then-performed-playback.md)), never inside the engine.
- Adding a file that calls `noteFrequency` requires editing the literal allowlist in
  `frequencyBoundary.test.ts` — a visible review decision.
- Logging inside the engine must use ids and frequencies, not note names.

## Rules this implies

- **R176** — The engine takes a frequency (Hz), never a note name:
  `triggerSynthNoteOn(frequency, synth, velocity, time, source, scaleFactor, owner)`;
  `SynthVoiceNoteOn`, `ManagedVoice`, `SubtractiveVoiceEvent` carry `frequency` and no name.
- **R177** — `noteFrequency` is called by the controller; `src/architecture/frequencyBoundary.test.ts`
  holds the literal allowlist of files (src + scripts) that may name it.
- **R178** — The engine never regains a note name, not even for logging; names belong on the
  note-input bus (`emitNoteInput`).
- **R179** — The engine may import only the timing half of `utils/musicTheory.ts`
  (`STEPS_PER_BAR`, `stepDurationSec`) — `ENGINE_MUSIC_DOMAIN_BAN` is an `allowImportNames`
  allowlist.
- **R180** — The gate covers `src/audio/engine.ts`, `src/audio/synth/**`, `drumSynth.ts`,
  `masterRack.ts`; not `clock.ts` or `src/audio/playback/**`.
- **R181** — Guarded files may not import `src/audio/playback/**`, not even type-only.
- **R182** — `src/architecture/engineDomainPurity.test.ts` proves the block armed at `error`,
  aliased and relative.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 586-610.
