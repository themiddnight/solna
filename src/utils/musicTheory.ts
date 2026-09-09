import { Chord, Interval, Note, Scale, transpose } from 'tonal';
import { ChordItem } from '../types';
import { METERS } from './meter';

export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type RootNote = typeof ROOTS[number];

// SCALES is authored content and lives in src/data/, below this file in the
// layering: data -> audio -> store -> components. Reading DOWN into it, as
// this line does, is the allowed direction. The other way is not: src/data/
// may only `import type` from here (see src/data/bassPatterns.ts,
// chordRhythms.ts, drumGrids.ts importing `MeterId`), which is erased at
// compile and is what keeps every data file an independent leaf.
import { SCALES } from '@/data/scales';
import { spellPitchClassInKey, type SpellingKey } from './noteSpelling';
import { resolveScaleKey, scaleEntry } from './scaleLookup';

/**
 * Returns all notes contained in the given scale for a root note (e.g. ['C', 'D', 'E', 'F', 'G', 'A', 'B']).
 * Spelling is sharp-only (the ROOTS convention): C# major's 7th is `C` (enharmonic
 * B#), F major's 4th is `A#` (enharmonic Bb). This keeps every pitch-class name
 * identical to the chromatic rows.
 */
export function getScaleNotes(root: string, scaleType: string): string[] {
  const rootIndex = rootSemitone(root);
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.map((int) => ROOTS[(rootIndex + int) % 12]);
}

/**
 * The scale's notes in a specific octave, with correct OCTAVE rollover — D
 * major's 7th is `C#5` (not `C#4`). Spelling stays sharp-only (ROOTS), matching
 * getScaleNotes and the chromatic rows. The pitch-class-only getScaleNotes stays
 * for consumers that wrap octaves themselves (the keyboard).
 */
export function getScaleNotesInOctave(root: string, scaleType: string, octave: number): string[] {
  const rootIndex = rootSemitone(root);
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.map((int) => {
    const abs = rootIndex + int;
    return `${ROOTS[abs % 12]}${octave + Math.floor(abs / 12)}`;
  });
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

/** Transpose a note by a raw semitone count (sharp-spelled via ROOTS convention). */
export function transposeNoteBySemitones(note: string, semitones: number): string {
  const midi = Note.midi(note);
  if (midi == null) return note;
  return Note.fromMidiSharps(midi + semitones);
}

/**
 * Re-map an in-scale note to the same degree of a new key/scale, preserving its
 * position in the scale (degree + octave block). Returns the note unchanged when
 * it is out of the source scale or its degree has no target (a 7-note scale's
 * 6th degree has no home in a 5-note pentatonic). Sharp-spelled, like the rest
 * of the ROOTS convention.
 */
export function remapNoteByScaleDegree(
  note: string,
  fromRoot: string,
  fromScaleType: string,
  toRoot: string,
  toScaleType: string,
): string {
  const midi = Note.midi(note);
  if (midi == null) return note;
  const rootRef = rootSemitone(fromRoot);
  const block = Math.floor((midi - rootRef) / 12);
  const offset = ((midi - rootRef) % 12 + 12) % 12;
  const fromIntervals = (SCALES[fromScaleType] || SCALES['Major']).intervals;
  const degree = fromIntervals.indexOf(offset);
  if (degree === -1) return note;
  const toIntervals = (SCALES[toScaleType] || SCALES['Major']).intervals;
  if (degree >= toIntervals.length) return note;
  return Note.fromMidiSharps(rootSemitone(toRoot) + block * 12 + toIntervals[degree]);
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

// The interval tuples a stacked triad can measure to, and the app quality token
// each one names. Exhaustive over what the eleven scales produce. An unmapped
// tuple THROWS: a silent fallback to `maj` is how a wrong chord reaches the UI
// with nothing to notice it, and a twelfth scale whose stacking produces a
// tuple nobody has named should stop, not guess.
const TRIAD_QUALITY_BY_INTERVALS: Record<string, string> = {
  '3M 5P': 'maj',
  '3m 5P': 'min',
  '3m 5d': 'dim',
  '3M 5A': 'aug',
};

const SEVENTH_QUALITY_BY_INTERVALS: Record<string, string> = {
  '3M 5P 7M': 'maj7',
  '3M 5P 7m': '7',
  '3m 5P 7m': 'min7',
  '3m 5d 7m': 'm7b5',
  '3m 5d 7d': 'dim7',
  '3m 5P 7M': 'minMaj7',
  '3M 5A 7M': 'maj7#5',
};

// The app quality tokens built on a MINOR third, read off the same tables that
// assign them — so a new entry can never fall out of sync with the roman
// numeral's case. Hand-testing the token's spelling instead (`includes('min')
// || === 'dim'`) put an uppercase numeral under every `m7b5` and `dim7` while
// the same degree's triad stayed lowercase: C major's vii became VII the
// moment the 7ths toggle went on.
const MINOR_THIRD_QUALITIES: ReadonlySet<string> = new Set(
  [
    ...Object.entries(TRIAD_QUALITY_BY_INTERVALS),
    ...Object.entries(SEVENTH_QUALITY_BY_INTERVALS),
  ]
    .filter(([intervals]) => intervals.startsWith('3m'))
    .map(([, quality]) => quality),
);

// Keyed `${scaleType}|${degree}|${use7ths}`. Correct forever because SCALES is
// frozen content. The cache lives in utils/, not data/ — a src/data/ file holds
// no mutable module-scope binding.
const degreeQualityCache = new Map<string, string>();

/**
 * The degree indices whose interval sits nearest `target`, measured around the
 * octave so 11 and 0 are one semitone apart, not eleven.
 *
 * Returns EVERY equidistant index. An exact match is not special-cased: a
 * scale's intervals are distinct, so distance 0 wins alone and the loop
 * already returns the single index a lookup would have.
 */
function nearestDegrees(intervals: readonly number[], target: number): number[] {
  let best = Number.POSITIVE_INFINITY;
  let degrees: number[] = [];
  intervals.forEach((interval, degree) => {
    const raw = Math.abs(interval - target);
    const distance = Math.min(raw, 12 - raw);
    if (distance < best) {
      best = distance;
      degrees = [degree];
    } else if (distance === best) {
      degrees.push(degree);
    }
  });
  return degrees;
}

/**
 * The parent degree(s) whose interval is nearest this scale's `degree`.
 *
 * Mapped by SEMITONE OFFSET, never by index. `degree % 7` is correct only when
 * a scale and its parent have the same number of degrees, which for a
 * pentatonic is never: it would make Minor Pentatonic degree 1 — interval 3,
 * the bIII — resolve as Natural Minor's degree 1, the ii(dim), and nothing
 * would fail because the shape and the length are both right.
 *
 * Returns every equidistant neighbour when no parent degree matches exactly,
 * so scales.test.ts can assert the tie's sides agree rather than the code
 * picking one. Exactly one such degree exists today: Blues degree 3.
 */
export function parentDegreesFor(
  scaleType: string,
  degree: number,
): { parentKey: string; degrees: number[] } {
  const resolvedKey = resolveScaleKey(scaleType);
  const scale = SCALES[resolvedKey];
  const parentKey = scale.parent ?? resolvedKey;
  const degrees = nearestDegrees(SCALES[parentKey].intervals, scale.intervals[degree]);
  return { parentKey, degrees };
}

/**
 * The quality of the chord stacked in thirds over a 7-note parent's degree.
 *
 * Measured from tonal's SPELLED note names, which is what makes it work:
 * `Eb`->`B` is `5A` and `Eb`->`Cb` would be `6m`, and only a speller that
 * agrees with the scale gets that right. Hand-rolled semitone arithmetic
 * cannot tell an augmented fifth from a minor sixth at all.
 */
export function resolveParentDegreeQuality(
  parentKey: string,
  parentDegree: number,
  use7ths: boolean,
): string {
  const notes = Scale.get(`C ${SCALES[parentKey].tonal}`).notes;
  const chordRoot = notes[parentDegree];
  const third = Interval.distance(chordRoot, notes[(parentDegree + 2) % 7]);
  const fifth = Interval.distance(chordRoot, notes[(parentDegree + 4) % 7]);

  const seventh = Interval.distance(chordRoot, notes[(parentDegree + 6) % 7]);

  const tuple = use7ths ? `${third} ${fifth} ${seventh}` : `${third} ${fifth}`;
  const table = use7ths ? SEVENTH_QUALITY_BY_INTERVALS : TRIAD_QUALITY_BY_INTERVALS;
  const quality = table[tuple];
  if (quality === undefined) {
    throw new Error(
      `No ${use7ths ? 'seventh' : 'triad'} quality for (${tuple}) at ${parentKey} degree ${parentDegree}`,
    );
  }
  return quality;
}

/**
 * The chord quality a scale degree carries — derived, not stated.
 *
 * Replaces the hand-written triadQualities/seventhQualities arrays: a quality
 * array is a computation frozen into a literal, and a frozen computation
 * drifts silently (two of eleven entries were already wrong by the table's own
 * stated rule). There are no overrides of any kind — if the derivation is wrong
 * for a scale, the fix is the derivation or the `parent`. A specific chord at a
 * specific degree belongs in a CHORD_PROGRESSIONS step's explicit `quality`,
 * which is authored content and cannot leak into every other song in the scale.
 */
export function resolveDegreeQuality(scaleType: string, degree: number, use7ths: boolean): string {
  const cacheKey = `${scaleType}|${degree}|${use7ths}`;
  const cached = degreeQualityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { parentKey, degrees } = parentDegreesFor(scaleType, degree);
  // Equidistant neighbours must AGREE. Taking degrees[0] made array order the
  // tiebreak — the one rule scales.test.ts says must never decide it — and a
  // twelfth scale whose tie disagreed would have resolved to whichever parent
  // degree sits earlier in `intervals`, with the right shape, the right length
  // and only the sound wrong. Same stance as the unmapped tuple: stop, don't
  // guess.
  const qualities = [
    ...new Set(degrees.map((d) => resolveParentDegreeQuality(parentKey, d, use7ths))),
  ];
  if (qualities.length > 1) {
    throw new Error(
      `Equidistant parent degrees ${degrees.join(', ')} of ${parentKey} disagree ` +
        `(${qualities.join(', ')}) for ${scaleType} degree ${degree}`,
    );
  }
  const quality = qualities[0];
  degreeQualityCache.set(cacheKey, quality);
  return quality;
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
  // Resolved ONCE and handed down. Normalising the degree against the fallback
  // entry and then passing the original `scaleType` on left the resolver to
  // redo the same fallback for itself — two copies of one rule, and only one
  // of them would move if the rule ever changed.
  const resolvedType = resolveScaleKey(scaleType);
  const scale = SCALES[resolvedType];
  const numDegrees = scale.intervals.length;

  const normDegree = ((degreeIndex % numDegrees) + numDegrees) % numDegrees;
  const semitoneOffset = scale.intervals[normDegree];
  const chordRoot = ROOTS[(rootIndex + semitoneOffset) % 12];

  // The `|| 'maj'` / `|| '7'` fallbacks went away with the arrays they guarded:
  // an unresolvable degree now throws inside the resolver rather than sounding
  // a wrong chord.
  const quality = resolveDegreeQuality(resolvedType, normDegree, use7ths);

  const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const isMinor = MINOR_THIRD_QUALITIES.has(quality);
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
  const scale = scaleEntry(scaleType);

  return currentChords.map((chord, idx) => {
    // Find semitone distance of chord from previous context, or snap to nearest scale degree
    const currentRootIdx = rootSemitone(chord.root);
    const intervalFromNewRoot = (currentRootIdx - newRootIndex + 12) % 12;

    // Nearest degree, the same search parentDegreesFor runs. A snap has no tie
    // to resolve — either neighbour is an equally good landing spot — so it
    // takes the first.
    const bestDegree = nearestDegrees(scale.intervals, intervalFromNewRoot)[0];

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
 * The 4/4 bar length, in 16th steps.
 *
 * This is now only a DEFAULT: the live bar length comes from the transport's
 * meter (`getMeter(meterId).stepsPerBar`). It stays exported and stays 16 so
 * the functions that already accept `stepsPerBar` as a defaulted parameter keep
 * their historical behaviour when a caller has no meter to hand — and so
 * engine.ts's and playbackEngine.ts's re-exports keep resolving.
 *
 * Declared here rather than in audio/engine.ts so barDurationSec can use it
 * without a cycle; utils/meter.ts imports nothing, so this import is safe.
 */
export const STEPS_PER_BAR = METERS['4/4'].stepsPerBar;

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

/** One bar, in seconds. `stepsPerBar` defaults to the 4/4 bar. */
export function barDurationSec(bpm: number, stepsPerBar: number = STEPS_PER_BAR): number {
  return stepDurationSec(bpm) * stepsPerBar;
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

/**
 * Standard display name for a chord, e.g. ('C', 'maj') → 'C', ('A', 'min7') → 'Am7'.
 *
 * `key` is optional and is the ONLY place spelling enters a chord label. It is
 * for DISPLAY only — never pass it when the result feeds something that gets
 * stored (a saved progression's `roman` text, for one): spelling is a label,
 * never an identity, and nothing spelled may be persisted. The resolvers keep
 * returning canonical sharp roots — an `Eb` would match no `<option>` in
 * SortableChordCard's ROOTS-built root `<select>`, would sit beside a note
 * list `generateBlockChordNotes` spelled with sharps (it maps names back
 * through ROOTS), and would be persisted into `ChordItem.root`.
 */
export function formatChordLabel(root: string, quality: string, key?: SpellingKey): string {
  return spellChordRoot(root, key) + formatChordQuality(quality);
}

/**
 * A chord root as the given key writes it: ('D#', A# Major) -> 'Eb'.
 *
 * Same DISPLAY-only contract as formatChordLabel's `key` parameter — the two
 * share this function so a card that renders root and quality as separate
 * elements spells the root exactly the way the one-string label does. Without
 * `key` the canonical sharp name comes straight back.
 */
export function spellChordRoot(root: string, key?: SpellingKey): string {
  return key ? spellPitchClassInKey(rootSemitone(root), key.scaleRoot, key.scaleType) : root;
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
