import { Chord, Interval, Note, transpose } from 'tonal';
import { ChordItem } from '../types';

export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type RootNote = typeof ROOTS[number];

export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  intervals: number[]; // semitone intervals from root [0, 2, 4, 5, 7, 9, 11]
  triadQualities: string[]; // chord quality for each scale degree: e.g. ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']
  seventhQualities: string[]; // 7th chord quality: e.g. ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5']
}

export const SCALES: Record<string, ScaleDefinition> = {
  'Major': {
    name: 'Major (Ionian)',
    category: 'Major / Minor',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    triadQualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
    seventhQualities: ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5'],
  },
  'Natural Minor': {
    name: 'Natural Minor (Aeolian)',
    category: 'Major / Minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    triadQualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
    seventhQualities: ['min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7', '7'],
  },
  'Harmonic Minor': {
    name: 'Harmonic Minor',
    category: 'Major / Minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    triadQualities: ['min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim'],
    seventhQualities: ['minMaj7', 'm7b5', 'maj7#5', 'min7', '7', 'maj7', 'dim7'],
  },
  'Dorian': {
    name: 'Dorian (Funk / Modal)',
    category: 'Modal',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    triadQualities: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'],
    seventhQualities: ['min7', 'min7', 'maj7', '7', 'min7', 'm7b5', 'maj7'],
  },
  'Mixolydian': {
    name: 'Mixolydian (Blues / Rock)',
    category: 'Modal',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    triadQualities: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'],
    seventhQualities: ['7', 'min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7'],
  },
  'Lydian': {
    name: 'Lydian (Bright / Dreamy)',
    category: 'Modal',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    triadQualities: ['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min'],
    seventhQualities: ['maj7', '7', 'min7', 'm7b5', 'maj7', 'min7', 'min7'],
  },
  'Phrygian': {
    name: 'Phrygian (Flamenco / Dark)',
    category: 'Modal',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    triadQualities: ['min', 'maj', 'maj', 'min', 'dim', 'maj', 'min'],
    seventhQualities: ['min7', 'maj7', '7', 'min7', 'm7b5', 'maj7', 'min7'],
  },
  'Minor Pentatonic': {
    name: 'Minor Pentatonic',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 7, 10],
    triadQualities: ['min', 'maj', 'min', 'min', 'maj'],
    seventhQualities: ['min7', 'maj7', 'min7', 'min7', '7'],
  },
  'Major Pentatonic': {
    name: 'Major Pentatonic',
    category: 'Pentatonic & Blues',
    intervals: [0, 2, 4, 7, 9],
    triadQualities: ['maj', 'min', 'min', 'maj', 'min'],
    seventhQualities: ['maj7', 'min7', 'min7', '7', 'min7'],
  },
  'Blues': {
    name: 'Blues Scale',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 6, 7, 10],
    triadQualities: ['min', 'maj', 'dim', 'dim', 'min', 'maj'],
    seventhQualities: ['7', 'maj7', 'dim7', 'dim7', '7', '7'],
  },
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    category: 'World & Exotic',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
    intervals: [0, 2, 3, 7, 8],
    // Stacking scale-steps on a scale with two major-third gaps does not give
    // tertian chords (degree 0 would be {0,3,8}). The repo's pentatonics solve
    // this by inheriting the parent 7-note scale's qualities; Hirajoshi is
    // natural minor at degrees 1, 2, 3, 5, 6 -> i, ii°, bIII, v, bVI.
    // One deliberate deviation: degree 3 is sus4/7sus4, not min/min7. The
    // parent's minor third reaches a semitone Hirajoshi does not contain,
    // while root-4th-5th (degrees 3, 4, 0) is entirely inside the five notes
    // and is the canonical open-fourth koto sound.
    triadQualities: ['min', 'dim', 'maj', 'sus4', 'maj'],
    seventhQualities: ['min7', 'm7b5', 'maj7', '7sus4', 'maj7'],
  },
};

/**
 * Returns all notes contained in the given scale for a root note (e.g. ['C', 'D', 'E', 'F', 'G', 'A', 'B'])
 */
export function getScaleNotes(root: string, scaleType: string): string[] {
  const rootIndex = rootSemitone(root);
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.map((int) => ROOTS[(rootIndex + int) % 12]);
}

/**
 * Checks if a note (with or without octave, e.g. 'C#4' or 'A') is in the specified scale
 */
export function isNoteInScale(noteWithOrWithoutOctave: string, root: string, scaleType: string): boolean {
  const note = Note.get(noteWithOrWithoutOctave);
  if (note.empty) return false;
  const rootNote = Note.get(root);
  if (rootNote.empty) return false;

  const interval = (note.chroma - rootNote.chroma + 12) % 12;
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.includes(interval);
}

// True when the in-scale palette (triads or 7ths) renders the same root+quality.
function isInScalePaletteChord(
  chordRoot: string,
  quality: string,
  root: string,
  scaleType: string,
): boolean {
  const scale = SCALES[scaleType] || SCALES['Major'];
  for (let degree = 0; degree < scale.intervals.length; degree++) {
    for (const use7ths of [false, true]) {
      const chord = getDiatonicChordForDegree(degree, root, scaleType, use7ths);
      if (chord.root === chordRoot && chord.quality === quality) return true;
    }
  }
  return false;
}

/**
 * Given a scale degree index (0-based, 0 = Degree I, 1 = Degree II, etc.)
 * returns the diatonic root note and chord quality according to the active scale.
 */
export function getDiatonicChordForDegree(
  degreeIndex: number,
  root: string,
  scaleType: string,
  use7ths = false
): { root: string; quality: string; degreeName: string } {
  const rootIndex = rootSemitone(root);
  const scale = SCALES[scaleType] || SCALES['Major'];
  const numDegrees = scale.intervals.length;

  const normDegree = ((degreeIndex % numDegrees) + numDegrees) % numDegrees;
  const semitoneOffset = scale.intervals[normDegree];
  const chordRoot = ROOTS[(rootIndex + semitoneOffset) % 12];
  
  const quality = use7ths 
    ? (scale.seventhQualities[normDegree] || '7')
    : (scale.triadQualities[normDegree] || 'maj');

  const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const isMinor = quality.includes('min') || quality === 'dim';
  const rawNumeral = ROMAN_NUMERALS[normDegree] || `${normDegree + 1}`;
  const degreeName = isMinor ? rawNumeral.toLowerCase() : rawNumeral;

  return {
    root: chordRoot,
    quality,
    degreeName,
  };
}

export interface BorrowedChord {
  root: string;
  quality: string;
  label: string;
}

/**
 * Returns a curated list of popular borrowed chords (modal interchange / chromatic chords) for the given scale/key.
 */
export function getBorrowedChords(root: string, scaleType: string): BorrowedChord[] {
  const rootIndex = rootSemitone(root);
  const candidates: BorrowedChord[] =
    scaleType === 'Major' || scaleType === 'Lydian' || scaleType === 'Mixolydian'
      ? [
          { root: ROOTS[(rootIndex + 5) % 12], quality: 'min', label: 'iv (Minor IV)' },
          { root: ROOTS[(rootIndex + 8) % 12], quality: 'maj', label: '♭VI (Flat VI)' },
          { root: ROOTS[(rootIndex + 10) % 12], quality: 'maj', label: '♭VII (Flat VII)' },
          { root: ROOTS[(rootIndex + 3) % 12], quality: 'maj', label: '♭III (Flat III)' },
          { root: ROOTS[(rootIndex + 1) % 12], quality: 'maj', label: '♭II (Neapolitan)' },
          { root: ROOTS[(rootIndex + 2) % 12], quality: 'm7b5', label: 'iiø7 (Half-Dim)' },
        ]
      : scaleType === 'Natural Minor' || scaleType === 'Harmonic Minor' || scaleType === 'Dorian' || scaleType === 'Phrygian'
        ? [
            { root: ROOTS[(rootIndex + 5) % 12], quality: 'maj', label: 'IV (Major IV)' },
            { root: ROOTS[(rootIndex + 7) % 12], quality: 'maj', label: 'V (Major V)' },
            { root: ROOTS[(rootIndex + 8) % 12], quality: 'maj', label: '♭VI (Flat VI)' },
            { root: ROOTS[(rootIndex + 10) % 12], quality: 'maj', label: '♭VII (Flat VII)' },
          ]
        : [
            // Default universal borrowed / chromatic accents
            { root: ROOTS[(rootIndex + 3) % 12], quality: 'maj', label: '♭III' },
            { root: ROOTS[(rootIndex + 5) % 12], quality: 'min', label: 'iv' },
            { root: ROOTS[(rootIndex + 8) % 12], quality: 'maj', label: '♭VI' },
            { root: ROOTS[(rootIndex + 10) % 12], quality: 'maj', label: '♭VII' },
          ];

  // Borrowed chords must stay chromatic: drop anything the active scale
  // already contains (strictly diatonic) or that the in-scale palette
  // renders with the same root and quality.
  const isDiatonic = (chordRoot: string, quality: string): boolean => {
    const notes = generateBlockChordNotes(quality, chordRoot);
    return notes.length > 0 && notes.every((n) => isNoteInScale(n, root, scaleType));
  };
  return candidates.filter(
    (c) => !isDiatonic(c.root, c.quality) && !isInScalePaletteChord(c.root, c.quality, root, scaleType),
  );
}


/**
 * Moves a progression from one key to another. Every chord shifts by the same
 * interval, so scale degrees are preserved by construction and the tonic stays
 * where the user put it. `id`, `quality` and `bars` are untouched.
 *
 * This is the operation a ROOT change needs. It is not the operation a SCALE
 * change needs — see snapProgressionToScale.
 */
export function transposeProgression(
  chords: ChordItem[],
  fromRoot: string,
  toRoot: string,
  octave = 4,
): ChordItem[] {
  const shift = (rootSemitone(toRoot) - rootSemitone(fromRoot) + 12) % 12;
  return chords.map((chord) =>
    deriveChordNotes(
      {
        ...chord,
        root: ROOTS[(rootSemitone(chord.root) + shift) % 12],
        ...(chord.bassNote ? { bassNote: transposePitchClass(chord.bassNote, shift) } : {}),
      },
      octave,
    ),
  );
}

/**
 * Shifts a note's pitch class and keeps its written octave, so a slash bass
 * never jumps a register on a key change — and a transpose round trip is exact.
 * Returns the input unchanged when it is not a note name.
 */
function transposePitchClass(note: string, shift: number): string {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)?$/);
  if (!match) return note;
  const shifted = ROOTS[(rootSemitone(match[1]) + shift) % 12];
  return match[2] === undefined ? shifted : `${shifted}${match[2]}`;
}

/**
 * Snaps each chord to the nearest diatonic degree of the given key/scale.
 * Body carried over verbatim from reharmonizeProgressionToScale, including the
 * maj9 / min9 / 7sus4 / sus4 quality-preservation clause.
 *
 * This is the operation a SCALE change needs. It measures the chords against
 * `root`, so it is only correct when they are already in that key — feeding it
 * chords from another key is the bug this split exists to remove. Two chords a
 * scale cannot distinguish still collapse onto one degree; that is inherent to
 * snapping and is why five-note scales lose the most.
 */
export function snapProgressionToScale(
  currentChords: ChordItem[],
  root: string,
  scaleType: string,
  octave = 4
): ChordItem[] {
  const newRootIndex = rootSemitone(root);
  const scale = SCALES[scaleType] || SCALES['Major'];

  return currentChords.map((chord, idx) => {
    // Find semitone distance of chord from previous context, or snap to nearest scale degree
    const currentRootIdx = rootSemitone(chord.root);
    const intervalFromNewRoot = (currentRootIdx - newRootIndex + 12) % 12;

    // Find closest degree in scale
    let bestDegree = 0;
    let minDiff = 999;
    scale.intervals.forEach((degInt, dIdx) => {
      const diff = Math.min(
        Math.abs(degInt - intervalFromNewRoot),
        12 - Math.abs(degInt - intervalFromNewRoot)
      );
      if (diff < minDiff) {
        minDiff = diff;
        bestDegree = dIdx;
      }
    });

    const diatonic = getDiatonicChordForDegree(bestDegree, root, scaleType, chord.quality.includes('7') || chord.quality.includes('9'));

    // Preserve custom qualities if user intentionally used extended qualities like maj9, 7sus4, otherwise use diatonic
    let targetQuality = diatonic.quality;
    if (chord.quality === 'maj9' || chord.quality === 'min9' || chord.quality === '7sus4' || chord.quality === 'sus4') {
      targetQuality = chord.quality;
    }

    return {
      ...chord,
      id: chord.id || `chord-${Date.now()}-${idx}`,
      root: diatonic.root,
      quality: targetQuality,
      notes: generateBlockChordNotes(targetQuality, diatonic.root, octave),
    };
  });
}

/** Single source of truth for deriving a chord's note list from its root/quality/octave. */
export function deriveChordNotes(chord: ChordItem, octave: number): ChordItem {
  return { ...chord, notes: generateBlockChordNotes(chord.quality, chord.root, octave) };
}

export function rootSemitone(root: string): number {
  const n = Note.get(root);
  return n.empty ? 0 : n.chroma;
}

export function sixteenthNoteMs(bpm: number): number {
  return ((60 / Math.max(1, bpm)) * 1000) / 4;
}


/**
 * The shared grid resolution. Declared here rather than in audio/engine.ts so
 * barDurationSec can use it without a cycle — engine.ts already imports this
 * module. engine.ts re-exports it, so every existing `from '../engine'` import
 * of STEPS_PER_BAR keeps working.
 */
export const STEPS_PER_BAR = 16;

/** Transport tempo bounds. The engine clock and the store clamp to the same pair. */
export const MIN_BPM = 20;
export const MAX_BPM = 300;

/**
 * A bpm the clock can actually use. The BPM input is `type="number"`, so an
 * empty field yields 0 — an unclamped 0 makes every listener compute a step
 * duration from a 1-bpm floor and land its note-offs minutes away (stuck notes).
 */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** One 16th-note step, in seconds. */
export function stepDurationSec(bpm: number): number {
  return sixteenthNoteMs(bpm) / 1000;
}

/** One STEPS_PER_BAR bar, in seconds. */
export function barDurationSec(bpm: number): number {
  return stepDurationSec(bpm) * STEPS_PER_BAR;
}

export function noteFrequency(note: string, octaveOffset = 0): number {
  const midi = Note.midi(note);
  if (midi == null) return 440;
  return 440 * Math.pow(2, (midi + 12 * octaveOffset - 69) / 12);
}

export function shiftNoteOctave(note: string, octaves: number): string {
  if (octaves === 0) return note;
  const degree = 8 + 7 * (Math.abs(octaves) - 1);
  const shifted = transpose(note, `${octaves > 0 ? '' : '-'}${degree}P`);
  return shifted || note;
}

// App quality names that differ from tonal's chord-type tokens (keys are lowercase — lookups use toLowerCase()).
// Exported so authored chord data can be validated against tonal in tests:
// generateBlockChordNotes falls back to `maj` on an unknown token, so a typo
// in a progression's quality is inaudible unless something checks it.
export const TONAL_CHORD_ALIASES: Record<string, string> = {
  min9: 'm9',
  min6: 'm6',
  minmaj7: 'mMaj7',
};

// Standard display labels for chord quality tokens (keys lowercase; lookups use toLowerCase()).
// Internal tokens stored in ChordItem.quality stay unchanged everywhere else.
const CHORD_QUALITY_LABELS: Record<string, string> = {
  maj: '',
  min: 'm',
  maj7: 'maj7',
  min7: 'm7',
  '7': '7',
  m7b5: 'm7b5',
  dim: 'dim',
  dim7: 'dim7',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '7sus4': '7sus4',
  '9': '9',
  maj9: 'maj9',
  min9: 'm9',
  add9: 'add9',
  '6': '6',
  min6: 'm6',
  minmaj7: 'mM7',
  'maj7#5': 'maj7#5',
};

/** Display suffix for a chord quality token, e.g. 'maj' → '', 'min7' → 'm7', 'minMaj7' → 'mM7'. */
export function formatChordQuality(quality: string): string {
  const label = CHORD_QUALITY_LABELS[quality.toLowerCase()];
  return label === undefined ? quality : label;
}

/** Standard display name for a chord, e.g. ('C', 'maj') → 'C', ('A', 'min7') → 'Am7'. */
export function formatChordLabel(root: string, quality: string): string {
  return root + formatChordQuality(quality);
}

export function generateBlockChordNotes(chord: string, root = 'C', octave = 4): string[] {
  const tonalType = TONAL_CHORD_ALIASES[chord.toLowerCase()] || chord.toLowerCase();
  const chordData = Chord.getChord(tonalType, root);
  const resolved = chordData.empty ? Chord.getChord('maj', root) : chordData;
  if (resolved.empty) return [];

  const rootMidi = Note.midi(`${root}${octave}`) ?? Note.midi(`C${octave}`) ?? 60;

  return resolved.intervals.map((ivl) => {
    const semitones = Interval.semitones(ivl);
    const midi = rootMidi + (Number.isFinite(semitones) ? semitones : 0);
    const noteName = ROOTS[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${noteName}${oct}`;
  });
}
