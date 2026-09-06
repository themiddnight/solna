import { transpose } from 'tonal';
import { getDiatonicChordForDegree } from '../../utils/musicTheory';
import type { PadInterval, PadMode, PadVoicing } from '../../types';

/**
 * Interval names for `tonal`. `12P` is a perfect twelfth — one interval name,
 * nineteen semitones — not an octave shift composed with a fifth. The
 * music-theory skill's rule applies: transposition goes through interval
 * notation, never through surgery on the octave digit of a note name.
 */
const INTERVAL_NAME: Record<PadInterval, string> = {
  1: '1P',
  4: '4P',
  5: '5P',
  8: '8P',
  12: '12P',
};

/**
 * The notes a drone holds: the chosen scale degree's root at `octave`,
 * transposed by each selected interval.
 *
 * The intervals are FIXED — the diatonic chord's own quality is never read.
 * That is what makes a drone sound like a drone (the tanpura is tuned to the
 * tonic and the perfect fifth), and it is why degree vii in a major key
 * produces a fifth outside the key. See padPlayback.test.ts; that behaviour is
 * pinned deliberately.
 *
 * `getDiatonicChordForDegree` wraps the degree index, so a degree stored while
 * a seven-note scale was active stays valid — and audible — under a five-note
 * one, and comes back unchanged when the scale is restored.
 */
export function resolveDroneNotes(
  degree: number,
  intervals: readonly PadInterval[],
  octave: number,
  scaleRoot: string,
  scaleType: string,
): string[] {
  if (intervals.length === 0) return [];
  const { root } = getDiatonicChordForDegree(degree, scaleRoot, scaleType, false);
  const base = `${root}${octave}`;
  const out: string[] = [];
  for (const interval of intervals) {
    const note = transpose(base, INTERVAL_NAME[interval]);
    if (note) out.push(note);
  }
  return out;
}

/**
 * Reduces a chord for pad mode.
 *
 * `open5` wants the chord's third tone, but a pentatonic or Hirajoshi voicing
 * can be shorter than three notes — so it falls back notes[2] -> notes[1] ->
 * notes[0], the same chain `resolveBassSteps` walks for its chord-tone tokens.
 * Without it an `open5` pad on a five-note scale would emit `undefined` as a
 * note name.
 */
export function applyPadVoicing(
  chordNotes: readonly string[],
  voicing: PadVoicing,
): string[] {
  if (chordNotes.length === 0) return [];
  switch (voicing) {
    case 'root':
      return [chordNotes[0]];
    case 'open5': {
      const upper = chordNotes[2] ?? chordNotes[1] ?? chordNotes[0];
      return upper === chordNotes[0] ? [chordNotes[0]] : [chordNotes[0], upper];
    }
    case 'triad':
    default:
      return [...chordNotes];
  }
}

/**
 * How long one arm holds. Pad mode is armed per chord and holds for that
 * chord; drone mode is armed once per loop pass and holds for the whole pass.
 *
 * Both floor at a single bar so a malformed chord (`bars: 0`) or an empty
 * progression can never schedule a note-off at or before its own note-on.
 */
/**
 * Whether this chord arm should also arm the pad.
 *
 * Pad mode re-strikes on every chord. Drone mode holds one voicing for a whole
 * loop pass, so it arms only at the top of one — `isLoopStart` is the
 * `arming.chordIndex % liveChords.length === 0` the caller already has.
 *
 * Lives here rather than in the hook so the rule is testable without React and
 * sits beside padHoldSec, which decides how long that arm then holds; see
 * padArm.test.ts.
 */
export function shouldArmPad(mode: PadMode, isLoopStart: boolean): boolean {
  return mode === 'pad' || isLoopStart;
}

/**
 * Whether a single arm spans the whole loop pass rather than one chord.
 *
 * The same `mode === 'drone'` test decides three separate things — how long
 * padHoldSec holds, whether a voice may be left ringing across a seamless loop
 * switch, and whether the loop's bar count is worth computing at all — so it
 * is named once here instead of being re-typed at each site.
 */
export function padHoldsAcrossLoop(mode: PadMode): boolean {
  return mode === 'drone';
}

export function padHoldSec(
  mode: PadMode,
  chordBars: number,
  loopBars: number,
  barDur: number,
): number {
  const bars = padHoldsAcrossLoop(mode) ? loopBars : chordBars;
  return Math.max(1, bars) * barDur;
}
