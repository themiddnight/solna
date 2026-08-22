import { generateBlockChordNotes } from '../../shared/src/index';
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
};

/**
 * Returns all notes contained in the given scale for a root note (e.g. ['C', 'D', 'E', 'F', 'G', 'A', 'B'])
 */
export function getScaleNotes(root: string, scaleType: string): string[] {
  const rootIndex = ROOTS.indexOf(root as RootNote) >= 0 ? ROOTS.indexOf(root as RootNote) : 0;
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.map((int) => ROOTS[(rootIndex + int) % 12]);
}

/**
 * Checks if a note (with or without octave, e.g. 'C#4' or 'A') is in the specified scale
 */
export function isNoteInScale(noteWithOrWithoutOctave: string, root: string, scaleType: string): boolean {
  const match = noteWithOrWithoutOctave.match(/^([A-G][#b]?)/);
  if (!match) return false;
  const noteLetter = match[1];
  const rootIndex = ROOTS.indexOf(root as RootNote);
  const noteIndex = ROOTS.indexOf(noteLetter as RootNote);
  if (rootIndex === -1 || noteIndex === -1) return false;

  const interval = (noteIndex - rootIndex + 12) % 12;
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.includes(interval);
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
  const rootIndex = ROOTS.indexOf(root as RootNote) >= 0 ? ROOTS.indexOf(root as RootNote) : 0;
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

/**
 * Re-harmonizes / snaps an existing chord progression to the nearest diatonic degrees of a new Key/Scale.
 * Option B: Diatonic Re-harmonization
 */
export function reharmonizeProgressionToScale(
  currentChords: ChordItem[],
  newRoot: string,
  newScaleType: string,
  octave = 4
): ChordItem[] {
  const newRootIndex = ROOTS.indexOf(newRoot as RootNote) >= 0 ? ROOTS.indexOf(newRoot as RootNote) : 0;
  const scale = SCALES[newScaleType] || SCALES['Major'];

  return currentChords.map((chord, idx) => {
    // Find semitone distance of chord from previous context, or snap to nearest scale degree
    const currentRootIdx = ROOTS.indexOf(chord.root as RootNote) >= 0 ? ROOTS.indexOf(chord.root as RootNote) : 0;
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

    const diatonic = getDiatonicChordForDegree(bestDegree, newRoot, newScaleType, chord.quality.includes('7') || chord.quality.includes('9'));
    
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
