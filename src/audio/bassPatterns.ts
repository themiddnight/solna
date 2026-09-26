import { harmonyKey, midiToSharpName, noteMidi, pitchClassOfNote, scaleEntry } from '@/musicCore';
import type { ChordItem } from '../types';
import { generateBlockChordNotes, rootSemitone } from '../utils/musicTheory';
import { stepDurationSec } from '../utils/tempo';
import { DEFAULT_VELOCITY } from './constants';
import { groupByStyle } from './groupByStyle';
import type { MeterId } from '../utils/timeSignature';
import { BASS_PATTERNS, type BassNoteToken, type BassPattern, type BassStep, type BassStepChoice } from '@/data/bassPatterns';
import { normalizePatternSpans } from '../utils/customPattern';
import { patternStoredIndexAt } from '../utils/patternTimeline';

export interface ResolvedBassEvent {
  noteName: string;        // 'C2' style, octave embedded
  step: number;            // originating 16th step in the bar (0-15)
  timeOffsetSec: number;
  holdSec: number;
  velocity: number;
  token: BassNoteToken;    // originating step token (post-alternation); 'approach*' tokens lead into the NEXT chord
}

const TONE_INDEX: Record<'third' | 'fifth' | 'seventh', number> = { third: 1, fifth: 2, seventh: 3 };
const FALLBACK_CHAIN: Record<'third' | 'fifth' | 'seventh', ('third' | 'fifth' | 'seventh')[]> = {
  seventh: ['seventh', 'fifth', 'third'],
  fifth: ['fifth', 'third'],
  third: ['third'],
};

function midiAtOctave(pc: string, octave: number): number {
  return noteMidi(`${pc}${octave}`) ?? noteMidi(`C${octave}`) ?? 60;
}

// Deterministic above/below alternation: odd bars flip the direction
function resolveAlternatedToken(
  note: BassNoteToken,
  alternate: boolean | undefined,
  chordIndex: number,
): BassNoteToken {
  if (alternate && chordIndex % 2 === 1) {
    if (note === 'approachChromaticAbove') return 'approachChromaticBelow';
    if (note === 'approachChromaticBelow') return 'approachChromaticAbove';
  }
  return note;
}

// MIDI for a step token; null for unknown tokens (the caller skips those steps)
function resolveStepMidi(
  token: BassNoteToken,
  bassRootMidi: number,
  nextRootMidi: number,
  toneMidi: (tone: 'third' | 'fifth' | 'seventh') => number,
  diatonicStepAbove: (targetPc: number) => number,
): number | null {
  switch (token) {
    case 'root': return bassRootMidi;
    case 'third':
    case 'fifth':
    case 'seventh': return toneMidi(token);
    case 'octave': return bassRootMidi + 12;
    case 'approachChromaticAbove': return nextRootMidi + 1;
    case 'approachChromaticBelow': return nextRootMidi - 1;
    case 'approachFifthOfNext': return nextRootMidi + 7;
    case 'approachDiatonicUp': return nextRootMidi - (nextRootMidi % 12) + diatonicStepAbove(nextRootMidi % 12);
    default: return null;
  }
}

export function resolveBassSteps(
  pattern: BassPattern,
  chords: ChordItem[],
  chordIndex: number,
  octave: number,
  scaleRoot: string,
  scaleType: string,
  bpm: number,
  holdScale: number = 1
): ResolvedBassEvent[] {
  if (chords.length === 0) return [];
  const chord = chords[chordIndex % chords.length];
  const nextChord = chords[(chordIndex + 1) % chords.length];

  // bassRoot = bassNote override (octave stripped, re-placed at bass octave) or chord.root
  const bassRootMidi = midiAtOctave(pitchClassOfNote(chord.bassNote ?? chord.root), octave);
  const nextRootMidi = midiAtOctave(pitchClassOfNote(nextChord.bassNote ?? nextChord.root), octave);

  const stepDur = stepDurationSec(bpm);

  // Fallback: seventh → fifth → third → root
  const chordNotes = generateBlockChordNotes(chord.quality, chord.root, octave);
  const toneMidi = (token: 'third' | 'fifth' | 'seventh'): number => {
    for (const t of FALLBACK_CHAIN[token]) {
      const note = chordNotes[TONE_INDEX[t]];
      if (note) return midiAtOctave(pitchClassOfNote(note), octave);
    }
    return bassRootMidi;
  };

  // First scale degree (rootSemitone + intervals) above the target pitch class; wraps to next octave
  const diatonicStepAbove = (targetPc: number): number => {
    const rootPc = rootSemitone(scaleRoot);
    // Chord side (R358): the bass follows the chords, so it steps on the
    // harmony scale's degrees and never lands on a bebop passing tone.
    const intervals = scaleEntry(harmonyKey(scaleType)).intervals;
    let above: number | null = null;
    let lowest = 12;
    for (const ivl of intervals) {
      const deg = (rootPc + ivl) % 12;
      if (deg < lowest) lowest = deg;
      if (deg > targetPc && (above === null || deg < above)) above = deg;
    }
    return above ?? lowest + 12;
  };

  const events: ResolvedBassEvent[] = [];
  for (const step of pattern.steps) {
    if (step.note === 'rest') continue;

    // Deterministic above/below alternation: odd bars flip the direction
    const token = resolveAlternatedToken(step.note, step.alternate, chordIndex);

    const midi = resolveStepMidi(token, bassRootMidi, nextRootMidi, toneMidi, diatonicStepAbove);
    if (midi === null) continue;

    const shiftedMidi = midi + 12 * (step.octaveShift ?? 0);

    const holdSec = (step.holdSteps ?? 1) * stepDur * (step.staccato ? 0.5 : 1) * holdScale;
    events.push({
      noteName: midiToSharpName(shiftedMidi) ?? 'C2',
      step: step.step,
      timeOffsetSec: step.step * stepDur,
      holdSec,
      velocity: DEFAULT_VELOCITY * (step.velocity ?? 1),
      token,
    });
  }
  return events;
}

export function isApproachToken(token: BassNoteToken): boolean {
  return token.startsWith('approach');
}

export const BASS_STYLE_GROUPS = groupByStyle(BASS_PATTERNS);

/**
 * Synthesize a BassPattern from a STORED span row at the active meter.
 *
 * The row is `loopLength * MAX_STEPS_PER_BAR` slots wide and bar-major; the
 * walk below is over COLUMNS (a cycle is `loopLength * stepsPerBar` of them)
 * through `patternStoredIndexAt`, which is what keeps a slot the active meter
 * cannot reach DORMANT rather than moving it.
 *
 * `normalizePatternSpans` runs first, against the ACTIVE boundaries, because a
 * meter or progression change never writes: a slot that was dormant when the
 * user drew it can become visible — and over-long against a boundary nobody
 * had when it was stored — without any edit having happened. Normalizing at
 * read time is what makes that legal without making the round trip lossy.
 *
 * Each visible onset becomes one step at its CYCLE column carrying the stored
 * hold; the lane offers no velocity, staccato or alternate control, so none is
 * invented here. `octave` stays what this lane means by it — root plus
 * octaveShift 1 — never a second token the resolver would have to learn.
 */
export function customBassPatternFromSpans(
  values: readonly BassStepChoice[],
  holds: readonly number[],
  stepsPerBar: number,
  cycleSteps: number,
  boundaries: readonly number[],
  meter: MeterId,
): BassPattern {
  // The type argument is explicit for the same reason the store's
  // `reclampCustomPattern<BassStepChoice>` spells it out: `empty: 'rest'` is a
  // candidate too, and inference across both would widen the row to `string`.
  const normalized = normalizePatternSpans<BassStepChoice>({
    values,
    holds,
    stepsPerBar,
    cycleSteps,
    boundaries,
    empty: 'rest',
  });

  const steps: BassStep[] = [];
  for (let column = 0; column < cycleSteps; column += 1) {
    const index = patternStoredIndexAt(column, stepsPerBar);
    const choice = index < normalized.values.length ? normalized.values[index] : undefined;
    if (choice === undefined || choice === 'rest') continue;
    const holdSteps = normalized.holds[index];
    if (choice === 'octave') {
      steps.push({ step: column, note: 'root', octaveShift: 1, holdSteps });
      continue;
    }
    steps.push({ step: column, note: choice, holdSteps });
  }
  return { id: 'custom', name: 'Custom', style: 'Custom', meter, steps };
}
