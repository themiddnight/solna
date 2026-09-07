/**
 * The bass-figure library: 16 patterns of note tokens over a one-bar grid.
 *
 * A step names a CHORD TONE or an approach, never a pitch — resolution against
 * the current chord happens in audio/bassPatterns.ts, which is where the
 * Note/tonal import and the fallback chain live. That split is why this file
 * can be a leaf: a table of tokens needs nothing but the tokens.
 *
 * Adaptation to a different active meter happens at PLAYBACK time; the user
 * picks these by id and never edits them.
 */
import type { MeterId } from '@/utils/meter';

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
  style: string;           // dropdown group, same as CHORD_RHYTHM_STYLE_GROUPS
  description?: string;
  /** Authored meter; see RhythmPattern.meter. Resolved with getMeter(). */
  meter?: MeterId;
  steps: BassStep[];
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
