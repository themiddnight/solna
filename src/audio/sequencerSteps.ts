import { stepDurationSec } from '../utils/musicTheory';
import type { SequencerTrack, SynthParams } from '../types';

/** What one sequencer step must trigger. Pure so the per-step decision is
 *  testable without a clock, an AudioContext or a React render. */
export type SequencerStepEvent =
  | { kind: 'note'; note: string; release: number; offsetSec: number }
  | { kind: 'pad'; instrument: string };

export function sequencerStepEvents(
  tracks: readonly SequencerTrack[],
  stepIndex: number,
  synthParams: SynthParams,
  bpm: number,
): SequencerStepEvent[] {
  const events: SequencerStepEvent[] = [];
  const offsetSec = stepDurationSec(bpm) * 0.8;
  for (const track of tracks) {
    if (track.muted) continue;
    if (!track.steps[stepIndex]) continue;
    // NOTE (DEV-386): a sequencer NOTE goes to playbackNoteOn with `source`
    // defaulting to 'synth', so it sums on the Lead bus while the Beat fader
    // is what a user reaches for. Latent today only because all eleven
    // canonical tracks are drum voices; the first synth or bass track makes
    // it audible. Fixing it means deciding whether a sequencer note belongs
    // on the sequencer bus at all — an arrangement question, not a units
    // one. Left for a follow-up.
    if (track.instrument === 'synth' || track.instrument === 'bass') {
      events.push({
        kind: 'note',
        note: track.instrument === 'bass' ? 'C2' : 'C4',
        release: synthParams.release,
        offsetSec,
      });
    } else {
      events.push({ kind: 'pad', instrument: track.instrument });
    }
  }
  return events;
}
