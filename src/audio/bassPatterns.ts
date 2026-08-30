import { Note } from 'tonal';
import type { ChordItem } from '../types';
import { SCALES, rootSemitone, stepDurationSec } from '../utils/musicTheory';
import { DEFAULT_VELOCITY } from './constants';
import { groupByStyle } from './groupByStyle';
import type { MeterId } from '../utils/meter';

export type BassNoteToken =
  | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
  | 'approachChromaticAbove' | 'approachChromaticBelow'
  | 'approachDiatonicUp' | 'approachFifthOfNext'
  | 'rest';

/**
 * The subset of BassNoteToken the custom bass grid offers. Deliberately no
 * scale-degree or 2-4-6 colour tones: borrowed/non-diatonic chords are always
 * possible, so a step that assumes a scale degree could resolve off-key.
 */
export type BassStepChoice = Extract<
  BassNoteToken,
  'rest' | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
>;

export interface BassStep {
  step: number;            // 16th-note position in the bar (0–15)
  note: BassNoteToken;
  holdSteps?: number;      // 16th steps to hold (default 1)
  velocity?: number;       // accent 0–1
  octaveShift?: number;    // per-step octave shift
  staccato?: boolean;      // true = hold cut to 50%
  alternate?: boolean;     // flip approachChromaticAbove/Below on odd chordIndex
}

export interface BassPattern {
  id: string;
  name: string;
  style: string;           // dropdown group, same as RHYTHM_STYLE_GROUPS
  description?: string;
  /** Authored meter; see RhythmPattern.meter. Resolved with getMeter(). */
  meter?: MeterId;
  steps: BassStep[];
}

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

export const BASS_PATTERNS: BassPattern[] = [
  {
    id: 'classic-walk',
    meter: '4/4',
    name: 'Classic Walk',
    style: 'Walking',
    description: 'Root, 3rd, 5th, then chromatic approach to the next root (alternates above/below per bar)',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'third' },
      { step: 8, note: 'fifth' },
      { step: 12, note: 'approachChromaticAbove', alternate: true },
    ],
  },
  {
    id: 'swing-double-approach',
    meter: '4/4',
    name: 'Swing Double Approach',
    style: 'Walking',
    description: 'Root, 5th, then two chromatic approaches into the next root',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'fifth' },
      { step: 8, note: 'approachChromaticBelow' },
      { step: 12, note: 'approachChromaticBelow' },
    ],
  },
  {
    id: 'root-fifth-walk',
    meter: '4/4',
    name: 'Root–5th Walk',
    style: 'Walking',
    description: 'Root, 5th, root, then the 5th of the next chord (dominant approach)',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'fifth' },
      { step: 8, note: 'root' },
      { step: 12, note: 'approachFifthOfNext' },
    ],
  },
  {
    id: 'dilla-sub',
    meter: '4/4',
    name: 'Dilla Sub Groove',
    style: 'Grooves',
    description: 'Swung, deep sub notes hitting on 1, the and-of-2, and beat 3',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 6, note: 'fifth', holdSteps: 2 },
      { step: 8, note: 'root', holdSteps: 3 },
      { step: 12, note: 'octave', holdSteps: 2 },
    ],
  },
  {
    id: 'offbeat-sub',
    meter: '4/4',
    name: 'Offbeat EDM Sub',
    style: 'Grooves',
    description: 'Offbeat sub pulses locking with synth stabs',
    steps: [
      { step: 2, note: 'root', holdSteps: 2 },
      { step: 6, note: 'root', holdSteps: 2 },
      { step: 10, note: 'root', holdSteps: 2 },
      { step: 14, note: 'root', holdSteps: 2 },
    ],
  },
  {
    id: 'walking-groove',
    meter: '4/4',
    name: 'Soulful Walking Bass',
    style: 'Walking',
    description: 'Walking bassline moving through root, 3rd, 5th and chromatic approaches',
    steps: [
      { step: 0, note: 'root', holdSteps: 3 },
      { step: 4, note: 'third', holdSteps: 3 },
      { step: 8, note: 'fifth', holdSteps: 3 },
      { step: 12, note: 'approachChromaticAbove', holdSteps: 3, alternate: true },
    ],
  },
  {
    id: 'driving-eighths',
    meter: '4/4',
    name: 'Driving 8ths',
    style: 'Grooves',
    description: 'Straight 8th notes on the root (rock/punk drive)',
    steps: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, note: 'root' as const, holdSteps: 2 })),
  },
  {
    id: 'funk-octaves',
    meter: '4/4',
    name: 'Funk Octaves',
    style: 'Grooves',
    description: 'Syncopated root/octave pops with staccato',
    steps: [
      { step: 0, note: 'root', staccato: true },
      { step: 3, note: 'root', staccato: true },
      { step: 6, note: 'octave', staccato: true },
      { step: 8, note: 'root' },
      { step: 11, note: 'octave', staccato: true },
      { step: 14, note: 'root', staccato: true },
    ],
  },
  {
    id: 'reggae-one-drop',
    meter: '4/4',
    name: 'Reggae One-Drop',
    style: 'Grooves',
    description: 'Root–5th–octave on offbeats, staccato, downbeat left open',
    steps: [
      { step: 2, note: 'root', staccato: true },
      { step: 6, note: 'fifth', staccato: true },
      { step: 10, note: 'root', staccato: true },
      { step: 14, note: 'octave', staccato: true },
    ],
  },
  {
    id: 'arp-1357',
    meter: '4/4',
    name: 'Arp 1-3-5-7',
    style: 'Grooves',
    description: 'Quarter-note arpeggio; 7th falls back to 5th on triads',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'third' },
      { step: 8, note: 'fifth' },
      { step: 12, note: 'seventh' },
    ],
  },
  {
    id: 'half-time-legato',
    meter: '4/4',
    name: 'Half-Time Legato',
    style: 'Minimal',
    description: 'Root held 2 beats, 5th held 2 beats',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 8, note: 'fifth', holdSteps: 4 },
    ],
  },
  {
    id: 'whole-note-root',
    meter: '4/4',
    name: 'Whole-Note Root',
    style: 'Minimal',
    description: 'Root held the full bar',
    steps: [{ step: 0, note: 'root', holdSteps: 16 }],
  },
  // --- 3/4, accentGroups [4,4,4]: one note per beat at steps 0, 4, 8 ---
  {
    id: 'waltz-root-fifth',
    meter: '3/4',
    name: 'Waltz Root–5th',
    style: 'Waltz',
    description: 'Rising root, 5th, octave — one note on each of the three beats',
    steps: [
      { step: 0, note: 'root', holdSteps: 3 },
      { step: 4, note: 'fifth', holdSteps: 3, velocity: 0.8 },
      { step: 8, note: 'octave', holdSteps: 3, velocity: 0.75 },
    ],
  },
  {
    id: 'waltz-walking-three',
    meter: '3/4',
    name: 'Waltz Walking Three',
    style: 'Waltz',
    description: 'Jazz-waltz quarter notes: root, 3rd, chromatic approach to the next root',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 4, note: 'third', holdSteps: 4 },
      { step: 8, note: 'approachChromaticBelow', holdSteps: 4, alternate: true },
    ],
  },
  // --- 6/8, accentGroups [6,6]: TWO dotted-quarter beats at steps 0 and 6 ---
  {
    id: 'six-eight-root-pulse',
    meter: '6/8',
    name: '6/8 Root Pulse',
    style: '6/8',
    description: 'Root then 5th, one held note per dotted-quarter beat',
    steps: [
      { step: 0, note: 'root', holdSteps: 6 },
      { step: 6, note: 'fifth', holdSteps: 6 },
    ],
  },
  {
    id: 'afro-six-eight-tumbao',
    meter: '6/8',
    name: 'Afro 6/8 Tumbao',
    style: '6/8',
    description: 'Both beats plus an octave push on the last eighth of beat 2',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 6, note: 'fifth', holdSteps: 2, velocity: 0.85 },
      { step: 10, note: 'octave', holdSteps: 2, velocity: 0.8 },
    ],
  },
];

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
