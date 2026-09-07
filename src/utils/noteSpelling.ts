import { Note, Scale } from 'tonal';
import { SCALES } from '@/data/scales';
import { scaleEntry } from './scaleLookup';

/**
 * How a key is WRITTEN, as opposed to which pitches it contains.
 *
 * A stored root is an identity — one of twelve pitch classes, persisted as its
 * canonical sharp name — so a stored value can never disagree with the scale it
 * is paired with. Every accidental a user sees is derived here, from
 * (scaleRoot, scaleType), at render time. Nothing spelled is ever persisted,
 * which is why this change needs no persist-version and no .solna format bump.
 *
 * This module imports `tonal`, `@/data/scales` and `./scaleLookup` — leaves,
 * all three — and NOTHING ELSE. That is deliberate: musicTheory.ts imports
 * this file (formatChordLabel's key parameter), so importing musicTheory back
 * would make the cycle load-bearing at module-evaluation time. The `tonality`
 * field lives on the SCALES entry precisely so that never has to happen, and
 * both name lists come from tonal rather than from a hand-copied duplicate of
 * ROOTS that would need its own guard test.
 */
const SHARP_NAMES: readonly string[] = Array.from({ length: 12 }, (_, pc) =>
  Note.pitchClass(Note.fromMidiSharps(60 + pc)),
);
const FLAT_NAMES: readonly string[] = Array.from({ length: 12 }, (_, pc) =>
  Note.pitchClass(Note.fromMidi(60 + pc)),
);

/**
 * Conventional tonic spelling per pitch class, by circle-of-fifths practice —
 * NOT computed. Counting accidentals is not enough: it ties on Eb/D# minor and
 * picks the wrong side outright for blues and pentatonic scales, whose tonal
 * spelling carries accidentals that say nothing about the key.
 */
const MAJOR_TONICS: readonly string[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
];
const MINOR_TONICS: readonly string[] = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B',
];

/**
 * Which accidental each of those tonics' key signature writes, by chroma —
 * the sign of tonal's `Key.majorKey(tonic).alteration`, tabulated rather than
 * called. Read straight down beside the tonic above it: the answer is fixed
 * the moment that tonic is chosen, so calling tonal for it re-derived a
 * constant at ~18us a miss AND pulled `@tonaljs/key` (plus `mode` and
 * `roman-numeral`) into the eager bundle for one boolean. `noteSpelling.test.ts`
 * pins both rows back to tonal, so this is a lookup of a computation, not a
 * second opinion about it.
 */
const MAJOR_ACCIDENTALS: readonly ('sharp' | 'flat')[] = [
  'sharp', 'flat', 'sharp', 'flat', 'sharp', 'flat', 'sharp', 'sharp', 'flat', 'sharp', 'flat', 'sharp',
];
const MINOR_ACCIDENTALS: readonly ('sharp' | 'flat')[] = [
  'flat', 'sharp', 'flat', 'flat', 'sharp', 'flat', 'sharp', 'flat', 'sharp', 'sharp', 'flat', 'sharp',
];

/** The (scaleRoot, scaleType) pair every display surface spells against. */
export interface SpellingKey {
  scaleRoot: string;
  scaleType: string;
}

/** The tonic as this key writes it: `A#` + Major -> `Bb`, `G#` + Natural Minor -> `G#`. */
export function getTonicSpelling(rootNote: string, scaleType: string): string {
  // For a name it cannot parse tonal types `chroma` as `null` and hands back
  // `NaN`. Neither `=== undefined` nor `== null` fires on that: both read as
  // if they guard the table lookup, and the lookup returns `undefined`
  // regardless. Only a finiteness check actually catches it.
  const chroma = Note.get(rootNote).chroma;
  if (!Number.isFinite(chroma)) return rootNote;
  const tonics = scaleEntry(scaleType).tonality === 'minor' ? MINOR_TONICS : MAJOR_TONICS;
  return tonics[chroma];
}

/**
 * Which accidental this key writes its out-of-scale notes with.
 *
 * Read from the key signature, not from the tonic's own name: F major is a flat
 * key while its tonic carries no accidental at all.
 */
export function getKeyAccidental(rootNote: string, scaleType: string): 'sharp' | 'flat' {
  const chroma = Note.get(rootNote).chroma;
  if (!Number.isFinite(chroma)) return 'sharp';
  return scaleEntry(scaleType).tonality === 'minor'
    ? MINOR_ACCIDENTALS[chroma]
    : MAJOR_ACCIDENTALS[chroma];
}

// Keyed `${pitchClass}|${rootNote}|${scaleType}`, so at most 12 x 12 x 11
// entries. Correct forever because SCALES is frozen content and tonal is pure.
// Without it every call rebuilds a tonal Scale — ~2us a call, and the
// keyboard spells every cap in the octave on every scale or key change.
const pitchClassSpellingCache = new Map<string, string>();

/** Pitch-class name (no octave) as the given key writes it. */
export function spellPitchClassInKey(chroma: number, rootNote: string, scaleType: string): string {
  const pitchClass = ((chroma % 12) + 12) % 12;
  const cacheKey = `${pitchClass}|${rootNote}|${scaleType}`;
  const cached = pitchClassSpellingCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const spelled = spellPitchClassUncached(pitchClass, rootNote, scaleType);
  pitchClassSpellingCache.set(cacheKey, spelled);
  return spelled;
}

function spellPitchClassUncached(pitchClass: number, rootNote: string, scaleType: string): string {
  const entry = scaleEntry(scaleType);
  const tonic = getTonicSpelling(rootNote, scaleType);

  for (const degree of Scale.get(`${tonic} ${entry.tonal}`).notes) {
    if (Note.get(degree).chroma !== pitchClass) continue;
    // A few keys (D# blues, G# harmonic minor) reach a double accidental.
    // Those are unreadable on a grid row, so fall through to the key's plain
    // sharp/flat name; single accidentals like F# major's E# are kept, because
    // that is what the key signature writes and it is readable.
    if (!/##|bb/.test(degree)) return degree;
    break;
  }

  const names = getKeyAccidental(rootNote, scaleType) === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  return names[pitchClass];
}

/**
 * Note name with octave for a MIDI number, as the given key writes it.
 *
 * The octave cannot be read off the MIDI number alone: `Cb4` and `B3` are the
 * same key, so a letter that wraps the octave boundary shifts it. The result is
 * checked against `Note.midi` and corrected, which makes it structurally
 * impossible for this function to return a name denoting a different pitch.
 */
export function spellMidiInKey(midi: number, rootNote: string, scaleType: string): string {
  const pitchClass = spellPitchClassInKey(midi % 12, rootNote, scaleType);
  const octave = Math.floor(midi / 12) - 1;
  for (const candidate of [
    `${pitchClass}${octave}`,
    `${pitchClass}${octave + 1}`,
    `${pitchClass}${octave - 1}`,
  ]) {
    if (Note.midi(candidate) === midi) return candidate;
  }
  return `${pitchClass}${octave}`;
}

/** Spell a note name that carries an octave: ('D#4', 'A#', 'Major') -> 'Eb4'. */
export function spellNoteInKey(note: string, rootNote: string, scaleType: string): string {
  const midi = Note.midi(note);
  return midi === null ? note : spellMidiInKey(midi, rootNote, scaleType);
}

/**
 * The DISPLAY counterpart of getScaleNotes.
 *
 * No surface renders a whole spelled scale today: this is the shape the
 * spelling characterization is generated and asserted over, which is why it
 * exists ahead of its first caller. Every 12 x 11 pair it covers reaches
 * spellPitchClassInKey, so the lock is over the function that does ship.
 *
 * getScaleNotes must keep returning sharp names — ui/Keyboard.tsx does
 * `ROOTS.indexOf(n)` on its output to recover a semitone, and a flat name
 * yields -1 with no throw and no failing type. So display gets its own
 * function and getScaleNotes is not touched.
 */
export function spellScaleNotes(rootNote: string, scaleType: string): string[] {
  const chroma = Note.get(rootNote).chroma;
  if (!Number.isFinite(chroma)) return [];
  return scaleEntry(scaleType).intervals.map((interval) =>
    spellPitchClassInKey(chroma + interval, rootNote, scaleType),
  );
}

/**
 * The twelve key choices offered in the UI.
 *
 * `value` stays the canonical sharp name — identical to ROOTS, so the stored
 * contract is unchanged — while `label` shows both spellings of an enharmonic
 * key regardless of the scale, so the picker never has to explain why the same
 * button reads differently after a scale change.
 */
export const KEY_OPTIONS: readonly { value: string; label: string }[] = SHARP_NAMES.map(
  (value, chroma) => {
    const flat = FLAT_NAMES[chroma] ?? value;
    return { value, label: flat === value ? value : `${value}/${flat}` };
  },
);

/**
 * How a key reads on screen: ('A#', 'Major') -> 'Bb Major'.
 *
 * The spelled tonic followed by the scale type was open-coded at eight
 * surfaces, so "how a key reads" was a convention rather than a function and
 * any refinement to it was an eight-file edit. `long` swaps the raw type for
 * the SCALES entry's display name ('Major (Ionian)'), which is what the header
 * tooltip wants; an unknown type still echoes itself rather than resolving to
 * Major, because a label that silently renames the user's scale is worse than
 * one that shows an unfamiliar word.
 */
export function formatKeyLabel(
  scaleRoot: string,
  scaleType: string,
  opts?: { long?: boolean },
): string {
  const name = opts?.long ? (SCALES[scaleType]?.name ?? scaleType) : scaleType;
  return `${getTonicSpelling(scaleRoot, scaleType)} ${name}`;
}
