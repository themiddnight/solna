import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { DEFAULT_VELOCITY } from '@/audio/constants';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';

/** The Beat lane's plan input: the stored pattern and the per-voice mix. Built per step, live
 *  (`beatPlanSnapshot`) or per loop, offline (`beatSnapshotForLoop`). */
export interface BeatPlanSnapshot {
  pattern: BeatPattern;
  mix: BeatMix;
}

/**
 * What one Beat step must trigger. Pure, so the per-step decision is testable
 * without a clock, an AudioContext or a React render.
 *
 * A Beat event names a DRUM VOICE and nothing else. Its predecessor
 * (`SequencerStepEvent`) was a union whose other arm played a synth note for a
 * track whose `instrument` was `'synth'` or `'bass'` — latent surface no track
 * ever reached, routed onto the Lead bus while the Beat fader was the control a
 * user would reach for. The roster is eleven drum voices, so that arm is
 * deleted rather than carried: an event that cannot name a synth cannot route
 * one wrong.
 */
export interface BeatStepEvent {
  voice: BeatVoiceId;
  velocity: number;
}

/**
 * The voices that sound at `context.stepInBar`, in canonical roster order.
 *
 * `stepInBar` indexes the STORED row, which is `MAX_STEPS_PER_BAR` wide
 * whatever the active meter is; the caller folds the clock's step into the
 * active bar first, so anything past the active window is simply never asked
 * for. An index past the row is silent rather than an error, the same way an
 * absent cell is.
 *
 * ONE of the two mute layers, deliberately. This one is the per-voice mute in
 * `beatMix.voices`. The BUS mute — and solo, which is session-only and must
 * never reach an export — is applied downstream in `engineSync.ts` off the
 * source-bus table. Both must pass for a voice to be heard, and folding them
 * together here would make the export unable to honour mute without also
 * honouring solo.
 *
 * Returns a fresh array: a timeline retains events.
 */
export function planBeatStep(snapshot: BeatPlanSnapshot, context: { stepInBar: number }): BeatStepEvent[] {
  const events: BeatStepEvent[] = [];
  for (const voice of BEAT_VOICE_IDS) {
    // Optional on BOTH halves, and for the same reason the row half already
    // was: this runs inside the shared 16th-clock callback, so a TypeError
    // here does not just drop a drum hit — it takes down that tick's whole
    // subscriber list, and the lead, chord and bass schedulers downstream of
    // it stop with it. Every producer is complete today; the asymmetry just
    // made the row's deliberate tolerance look accidental.
    if (snapshot.mix.voices[voice]?.muted) continue;
    if (!snapshot.pattern.rows[voice]?.[context.stepInBar]) continue;
    events.push({ voice, velocity: DEFAULT_VELOCITY });
  }
  return events;
}
