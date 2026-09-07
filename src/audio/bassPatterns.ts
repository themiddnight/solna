import { Note } from 'tonal';
import type { ChordItem } from '../types';
import { SCALES } from '@/data/scales';
import { rootSemitone, stepDurationSec } from '../utils/musicTheory';
import { DEFAULT_VELOCITY } from './constants';
import { groupByStyle } from './groupByStyle';
import type { MeterId } from '../utils/meter';
import { BASS_PATTERNS, type BassNoteToken, type BassPattern, type BassStep, type BassStepChoice } from '@/data/bassPatterns';

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

function pitchClass(noteName: string): string {
  return noteName.replace(/[0-9-]/g, '');
}

function midiAtOctave(pc: string, octave: number): number {
  return Note.midi(`${pc}${octave}`) ?? Note.midi(`C${octave}`) ?? 60;
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
  const bassRootMidi = midiAtOctave(pitchClass(chord.bassNote ?? chord.root), octave);
  const nextRootMidi = midiAtOctave(pitchClass(nextChord.bassNote ?? nextChord.root), octave);

  const stepDur = stepDurationSec(bpm);

  // Fallback: seventh → fifth → third → root
  const toneMidi = (token: 'third' | 'fifth' | 'seventh'): number => {
    for (const t of FALLBACK_CHAIN[token]) {
      const note = chord.notes[TONE_INDEX[t]];
      if (note) return midiAtOctave(pitchClass(note), octave);
    }
    return bassRootMidi;
  };

  // First scale degree (rootSemitone + intervals) above the target pitch class; wraps to next octave
  const diatonicStepAbove = (targetPc: number): number => {
    const rootPc = rootSemitone(scaleRoot);
    const intervals = SCALES[scaleType]?.intervals ?? [0, 2, 4, 5, 7, 9, 11];
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
      noteName: Note.fromMidiSharps(shiftedMidi) ?? 'C2',
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
 * Synthesize a BassPattern from the user's custom bass grid. Each non-rest step
 * is a single 16th hit (holdSteps defaults to 1, no staccato/alternate);
 * 'octave' maps to root + octaveShift 1 (the +12 the resolver's own 'octave'
 * token would give, expressed per the SP1 spec). Authored at the ACTIVE meter.
 * Resolution is NOT reimplemented here — resolveBassSteps consumes this the
 * same way it consumes any library pattern.
 */
export function customBassPattern(
  choices: readonly BassStepChoice[],
  stepsPerBar: number,
  meter: MeterId,
): BassPattern {
  const steps: BassStep[] = [];
  const length = Math.min(choices.length, stepsPerBar);
  for (let step = 0; step < length; step++) {
    const choice = choices[step];
    if (choice === 'rest') continue;
    steps.push(
      choice === 'octave'
        ? { step, note: 'root' as const, octaveShift: 1 }
        : { step, note: choice },
    );
  }
  return { id: 'custom', name: 'Custom', style: 'Custom', meter, steps };
}
