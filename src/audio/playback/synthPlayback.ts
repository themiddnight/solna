import { audioEngine } from "../engine";
import { emitNoteInput } from "./noteInputBus";
import type { SynthParams } from "@/types";
import type { SynthControlTarget } from "@/utils/synthControl";

// Thin engine bridge for SoundView's keyboard/arp handlers (layering rule 3):
// the view never touches audio/engine directly. The handlers keep all their
// logic (equal-power velocity scaling with held.size, arp state) — only the
// engine calls move here, one per wrapper, bodies verbatim.
export function initSynthPlayback(): void {
  audioEngine.init();
}

export function hasSynthPlaybackContext(): boolean {
  return !!audioEngine.getAudioContext();
}

export function applySynthPlaybackVelocityScale(
  scale: number,
  target: SynthControlTarget,
): void {
  // audioEngine.applySynthVelocityScale deliberately stays typed `source:
  // string` (see releaseSynthPlaybackVoices below) — the narrowing happens
  // here, at the store-facing wrapper.
  audioEngine.applySynthVelocityScale(scale, target);
}

/**
 * A note a PERSON played — the computer keyboard, the on-screen keyboard, a
 * MIDI device. Every one of those routes through here, and here is where the
 * note-input bus is told about it, so a feature that wants performed notes
 * subscribes once instead of being soldered onto each source.
 *
 * Two things deliberately do NOT come through here. Sequenced notes go to
 * playbackEngine, because a step the transport played is not a step the user
 * performed. Grid auditions go to previewSequencerNote, because clicking a
 * cell to hear what you just drew is not playing a note either — routing it
 * here would let a preview click record itself. That one also has to stay off
 * the 'synth' bus, which carries the notes the player is holding down.
 */
export function synthPlaybackNoteOn(
  note: string,
  params: SynthParams,
  velocity = 0.8,
  time?: number,
  target = "synth",
  scaleFactor = 1,
): void {
  audioEngine.triggerSynthNoteOn(
    note,
    params,
    velocity,
    time,
    target,
    scaleFactor,
    "live",
  );
  // After the engine call, never before: a subscriber that throws must not be
  // able to swallow the note the user played.
  emitNoteInput({ kind: "on", note, velocity, time });
}

/** The release half of synthPlaybackNoteOn; announced on the same bus. */
export function synthPlaybackNoteOff(
  note: string,
  releaseTime = 0.3,
  time?: number,
  target = "synth",
): void {
  audioEngine.triggerSynthNoteOff(note, releaseTime, time, target);
  emitNoteInput({ kind: "off", note, velocity: 0, time });
}

export function releaseSynthPlaybackVoices(
  target: SynthControlTarget,
  releaseTime = 0.1,
): void {
  // audioEngine.releaseSoundingVoices deliberately stays typed `source:
  // string` — the engine knows nothing about the store's target vocabulary —
  // so the narrowing to SynthControlTarget happens here, at the one call site
  // a wrong bus name could otherwise slip through untyped.
  //
  // The 'arp' literal below is pinned rather than threaded through as a
  // parameter, because this two-parameter signature is what keeps
  // `src/components/` from having to import `VoiceOwner`. arpPlayback.ts's
  // `releaseTriggeredTargets` passes its own 'arp' literal to this function's
  // callers, and nothing checks the two stay in sync — if either literal ever
  // changed, the drift would be silent.
  audioEngine.releaseSoundingVoices(target, releaseTime, 'arp');
}
