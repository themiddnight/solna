import { Note } from 'tonal';
import type { ChordItem } from '../types';
import { SCALES, rootSemitone, sixteenthNoteMs } from '../utils/musicTheory';

export type BassNoteToken =
  | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
  | 'approachChromaticAbove' | 'approachChromaticBelow'
  | 'approachDiatonicUp' | 'approachFifthOfNext'
  | 'rest';

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
  steps: BassStep[];
}

export interface ResolvedBassEvent {
  noteName: string;        // 'C2' style, octave embedded
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

export function resolveBassSteps(
  pattern: BassPattern,
  chords: ChordItem[],
  chordIndex: number,
  octave: number,
  scaleRoot: string,
  scaleType: string,
  bpm: number
): ResolvedBassEvent[] {
  if (chords.length === 0) return [];
  const chord = chords[chordIndex % chords.length];
  const nextChord = chords[(chordIndex + 1) % chords.length];

  // bassRoot = bassNote override (octave stripped, re-placed at bass octave) or chord.root
  const bassRootMidi = midiAtOctave(pitchClass(chord.bassNote ?? chord.root), octave);
  const nextRootMidi = midiAtOctave(pitchClass(nextChord.bassNote ?? nextChord.root), octave);

  const stepDur = sixteenthNoteMs(bpm) / 1000;

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
    let token = step.note;
    if (step.alternate && chordIndex % 2 === 1) {
      if (token === 'approachChromaticAbove') token = 'approachChromaticBelow';
      else if (token === 'approachChromaticBelow') token = 'approachChromaticAbove';
    }

    const targetPc = nextRootMidi % 12;
    let midi: number;
    switch (token) {
      case 'root': midi = bassRootMidi; break;
      case 'third': case 'fifth': case 'seventh': midi = toneMidi(token); break;
      case 'octave': midi = bassRootMidi + 12; break;
      case 'approachChromaticAbove': midi = nextRootMidi + 1; break;
      case 'approachChromaticBelow': midi = nextRootMidi - 1; break;
      case 'approachFifthOfNext': midi = nextRootMidi + 7; break;
      case 'approachDiatonicUp': midi = nextRootMidi - targetPc + diatonicStepAbove(targetPc); break;
      default: continue;
    }
    midi += 12 * (step.octaveShift ?? 0);

    const holdSec = (step.holdSteps ?? 1) * stepDur * (step.staccato ? 0.5 : 1);
    events.push({
      noteName: Note.fromMidiSharps(midi) ?? 'C2',
      timeOffsetSec: step.step * stepDur,
      holdSec,
      velocity: 0.8 * (step.velocity ?? 1), // mirror the engine's default velocity
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
    id: 'driving-eighths',
    name: 'Driving 8ths',
    style: 'Grooves',
    description: 'Straight 8th notes on the root (rock/punk drive)',
    steps: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, note: 'root' as const, holdSteps: 2 })),
  },
  {
    id: 'funk-octaves',
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
    name: 'Whole-Note Root',
    style: 'Minimal',
    description: 'Root held the full bar',
    steps: [{ step: 0, note: 'root', holdSteps: 16 }],
  },
];

export const BASS_STYLE_GROUPS: { style: string; patterns: BassPattern[] }[] = (() => {
  const byStyle = new Map<string, BassPattern[]>();
  for (const p of BASS_PATTERNS) {
    const list = byStyle.get(p.style);
    if (list) list.push(p);
    else byStyle.set(p.style, [p]);
  }
  return Array.from(byStyle, ([style, patterns]) => ({ style, patterns }));
})();
