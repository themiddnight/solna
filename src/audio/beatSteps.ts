import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';

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
}

// Reused across calls: beatStepEvents runs on the shared clock's hot path
// (~8/sec at 120bpm) for the whole play session, and every caller consumes
// the result synchronously (see fireBeatStepEvents in
// components/useSequencerPlayback.ts) — nothing retains it past that call.
//
// Safe from re-entrancy only because the live caller (useSequencerPlayback)
// is mounted exactly once (SequencerView.tsx:200 → SequencerGrid.tsx:43) and
// its clock callback synchronously drains events via fireBeatStepEvents before
// returning, with no nested call back into the scheduler. The offline caller
// (renderMixdown.ts) uses sequential calls within one loop, never nested. If
// Beat playback ever becomes per-loop or multi-instance, this array must be
// thread-safe or per-instance.
const stepEventScratch: BeatStepEvent[] = [];

/**
 * The voices that sound at `stepIndex`, in canonical roster order.
 *
 * `stepIndex` indexes the STORED row, which is `MAX_STEPS_PER_BAR` wide
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
 * Returns a readonly array to prevent callers from retaining or mutating the
 * shared scratch buffer past their synchronous use. Both production callers
 * (live sequencer in useSequencerPlayback and offline mixdown in renderMixdown)
 * iterate the result synchronously and do not retain it.
 */
export function beatStepEvents(
  pattern: BeatPattern,
  mix: BeatMix,
  stepIndex: number,
): readonly BeatStepEvent[] {
  stepEventScratch.length = 0;
  for (const voice of BEAT_VOICE_IDS) {
    // Optional on BOTH halves, and for the same reason the row half already
    // was: this runs inside the shared 16th-clock callback, so a TypeError
    // here does not just drop a drum hit — it takes down that tick's whole
    // subscriber list, and the lead, chord and bass schedulers downstream of
    // it stop with it. Every producer is complete today; the asymmetry just
    // made the row's deliberate tolerance look accidental.
    if (mix.voices[voice]?.muted) continue;
    if (!pattern.rows[voice]?.[stepIndex]) continue;
    stepEventScratch.push({ voice });
  }
  return stepEventScratch;
}
