import { audioEngine } from "../engine";
import { emitNoteInput } from "./noteInputBus";
import type { ActiveSynth } from "@/types/synth";
import type { VoiceId } from "../synth/voiceId";
import type { SynthControlTarget } from "@/utils/synthControl";
import type { VoiceOwner } from "../voiceOwner";

// Thin engine bridge for SoundView's keyboard/arp handlers (layering rule 3):
// the view never touches audio/engine directly. The handlers keep all their
// logic (equal-power velocity from held.size, arp state); only the engine
// calls live here, one per wrapper.
export function initSynthPlayback(): void {
  audioEngine.init();
}

export function hasSynthPlaybackContext(): boolean {
  return !!audioEngine.getAudioContext();
}

/**
 * Equal-power polyphony: the level every voice on ONE bus settles to while
 * `n` keys are held there. The count is the CALLER's — `useInputDeck` counts
 * the notes held on that bus — so the arp and the melody sequencer, which
 * share these buses, never enter into it.
 */
export function applySynthPlaybackVelocityScale(
  scale: number,
  target: SynthControlTarget,
): void {
  // audioEngine.applySynthVelocityScale deliberately stays typed `source:
  // string` (see releaseSynthPlaybackVoices below) — the narrowing to the
  // store's target vocabulary happens here, at the store-facing wrapper.
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
  synth: ActiveSynth,
  velocity = 0.8,
  time?: number,
  target = "synth",
  scaleFactor = 1,
): VoiceId | null {
  const voiceId = audioEngine.triggerSynthNoteOn(
    note,
    synth,
    velocity,
    time,
    target,
    scaleFactor,
    "live",
  );
  // After the engine call, never before: a subscriber that throws must not be
  // able to swallow the note the user played.
  emitNoteInput({ kind: "on", note, velocity, time });
  // The caller keeps this and releases THAT voice. `null` before the context
  // exists, which is the one case a caller has nothing to hold on to — and
  // nothing sounded either, so there is nothing to release.
  return voiceId;
}

/**
 * The release half of synthPlaybackNoteOn; announced on the same bus.
 *
 * Takes the ID `synthPlaybackNoteOn` returned, not a note name: the live
 * keyboard shares its bus with the arp and the melody sequencer, and a release
 * resolved by name would cut whichever of the three the engine happened to
 * find. `note` is still passed, for the note-input bus alone — the recorder
 * needs the pitch, and a voice id is not one.
 */
export function synthPlaybackNoteOff(
  voiceId: VoiceId | null,
  note: string,
  releaseSeconds = 0.3,
  time?: number,
): void {
  if (voiceId) audioEngine.triggerSynthNoteOff(voiceId, releaseSeconds, time);
  emitNoteInput({ kind: "off", note, velocity: 0, time });
}

export function releaseSynthPlaybackVoices(
  target: SynthControlTarget,
  releaseTime: number,
  owner: VoiceOwner,
): void {
  // audioEngine.releaseSoundingVoices deliberately stays typed `source:
  // string` — the engine knows nothing about the store's target vocabulary —
  // so the narrowing to SynthControlTarget happens here, at the one call site
  // a wrong bus name could otherwise slip through untyped.
  //
  // `owner` is threaded, not pinned. It used to be a second `'arp'` literal
  // here, matching the one `releaseTriggeredTargets` already passes its
  // callback — two copies with nothing checking they agreed, which the comment
  // that stood here admitted would drift silently. Required with no default,
  // the same rule `triggerSynthNoteOn` follows: an owner-blind release must
  // not be reachable by omitting an argument. `src/components/` still never
  // names an owner — it passes this function BY REFERENCE as the callback, so
  // the value comes from arpPlayback.ts and the layering rule is untouched.
  audioEngine.releaseSoundingVoices(target, releaseTime, owner);
}
