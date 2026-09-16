import { intervalSemitones, noteMidi, resolveTonalChord } from './tonalAdapter';

/** The twelve sharp-spelled pitch-class names, index = chroma. Canonical identity per DEV-380 — nothing here ever spells a flat. */
export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * How a quality reharmonizes when a progression is snapped to a new key
 * (DEV-393's concern, not this issue's). A plain triad or seventh can be
 * replaced by the target scale's own diatonic chord at that degree; every
 * other category names a shape snapping cannot safely regenerate (a 6th, an
 * added tone, an extension, a suspension, a half-diminished/diminished
 * shape, or an altered chord like minMaj7/maj7#5) and today is preserved
 * verbatim by `snapProgressionToScale`'s own hardcoded list
 * (`src/utils/musicTheory.ts`). This issue only assigns the category; it
 * wires nothing to read it.
 */
export type ReharmonizationCategory =
  | 'triad'
  | 'seventh'
  | 'sixth'
  | 'added-tone'
  | 'extension'
  | 'suspended'
  | 'diminished-half-diminished'
  | 'altered';

export interface ChordQualityEntry {
  /** The token `ChordItem.quality` stores and every reader compares against. */
  token: ChordQuality;
  /** The chord-type string Tonal's `Chord.getChord` resolves for this token. */
  tonalAlias: string;
  /** The suffix `formatChordQuality`/`formatChordLabel` render after a spelled root, e.g. `''`, `'m7'`, `'mM7'`. */
  displaySuffix: string;
  /** The chord picker's option text, e.g. `'Minor 7th (min7)'`. */
  pickerLabel: string;
  /** The chord picker's `<optgroup>` label; option order within a group follows registry order. */
  pickerGroup: 'Triads' | '7th Chords' | 'Extensions & Additions';
  /** DEV-393's classification axis — read but not yet acted on by anything in this issue. */
  reharmonizationCategory: ReharmonizationCategory;
}

// prettier-ignore
const CHORD_QUALITY_REGISTRY_ENTRIES = [
  { token: 'maj', tonalAlias: 'maj', displaySuffix: '', pickerLabel: 'Major (maj)', pickerGroup: 'Triads', reharmonizationCategory: 'triad' },
  { token: 'min', tonalAlias: 'min', displaySuffix: 'm', pickerLabel: 'Minor (min)', pickerGroup: 'Triads', reharmonizationCategory: 'triad' },
  { token: 'dim', tonalAlias: 'dim', displaySuffix: 'dim', pickerLabel: 'Diminished (dim)', pickerGroup: 'Triads', reharmonizationCategory: 'diminished-half-diminished' },
  { token: 'aug', tonalAlias: 'aug', displaySuffix: 'aug', pickerLabel: 'Augmented (aug)', pickerGroup: 'Triads', reharmonizationCategory: 'altered' },
  { token: 'sus2', tonalAlias: 'sus2', displaySuffix: 'sus2', pickerLabel: 'Sus 2', pickerGroup: 'Triads', reharmonizationCategory: 'suspended' },
  { token: 'sus4', tonalAlias: 'sus4', displaySuffix: 'sus4', pickerLabel: 'Sus 4', pickerGroup: 'Triads', reharmonizationCategory: 'suspended' },
  { token: 'maj7', tonalAlias: 'maj7', displaySuffix: 'maj7', pickerLabel: 'Major 7th (maj7)', pickerGroup: '7th Chords', reharmonizationCategory: 'seventh' },
  { token: 'min7', tonalAlias: 'min7', displaySuffix: 'm7', pickerLabel: 'Minor 7th (min7)', pickerGroup: '7th Chords', reharmonizationCategory: 'seventh' },
  { token: '7', tonalAlias: '7', displaySuffix: '7', pickerLabel: 'Dominant 7th (7)', pickerGroup: '7th Chords', reharmonizationCategory: 'seventh' },
  { token: 'm7b5', tonalAlias: 'm7b5', displaySuffix: 'm7b5', pickerLabel: 'Half-Dim (m7b5)', pickerGroup: '7th Chords', reharmonizationCategory: 'diminished-half-diminished' },
  { token: 'dim7', tonalAlias: 'dim7', displaySuffix: 'dim7', pickerLabel: 'Diminished 7th (dim7)', pickerGroup: '7th Chords', reharmonizationCategory: 'diminished-half-diminished' },
  { token: '7sus4', tonalAlias: '7sus4', displaySuffix: '7sus4', pickerLabel: '7 Sus 4', pickerGroup: '7th Chords', reharmonizationCategory: 'suspended' },
  { token: 'minMaj7', tonalAlias: 'mMaj7', displaySuffix: 'mM7', pickerLabel: 'Minor Major 7th (mM7)', pickerGroup: '7th Chords', reharmonizationCategory: 'altered' },
  { token: 'maj7#5', tonalAlias: 'maj7#5', displaySuffix: 'maj7#5', pickerLabel: 'Major 7th #5 (maj7#5)', pickerGroup: '7th Chords', reharmonizationCategory: 'altered' },
  { token: '9', tonalAlias: '9', displaySuffix: '9', pickerLabel: 'Dominant 9th (9)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'extension' },
  { token: 'maj9', tonalAlias: 'maj9', displaySuffix: 'maj9', pickerLabel: 'Major 9th (maj9)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'extension' },
  { token: 'min9', tonalAlias: 'm9', displaySuffix: 'm9', pickerLabel: 'Minor 9th (min9)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'extension' },
  { token: 'add9', tonalAlias: 'add9', displaySuffix: 'add9', pickerLabel: 'Add 9', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'added-tone' },
  { token: '6', tonalAlias: '6', displaySuffix: '6', pickerLabel: 'Major 6th (6)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'sixth' },
  { token: 'min6', tonalAlias: 'm6', displaySuffix: 'm6', pickerLabel: 'Minor 6th (min6)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'sixth' },
] as const;

/** Every chord quality Solna's chord editor, degree resolver and playback can name. */
export type ChordQuality = (typeof CHORD_QUALITY_REGISTRY_ENTRIES)[number]['token'];

/**
 * One entry per token; a new quality is one row above, never a second
 * hand-written array — `ChordQuality`, `CHORD_QUALITY_GROUPS`,
 * `CHORD_QUALITY_ALIASES` and `formatChordQuality` are all DERIVED from this
 * table, not maintained beside it.
 *
 * The roster is a superset of everything `resolveDegreeQuality` can emit: its
 * output set is the values of its two interval->quality tables (maj/min/dim/aug
 * and maj7/7/min7/m7b5/dim7/minMaj7/maj7#5), and `chordQuality.test.ts` pins
 * that all eleven are registered. `minMaj7` and `maj7#5` were resolvable but
 * unpickable before DEV-394.
 */
export const CHORD_QUALITY_REGISTRY: readonly ChordQualityEntry[] = CHORD_QUALITY_REGISTRY_ENTRIES;

const registryByLowercaseToken = new Map<string, ChordQualityEntry>(
  CHORD_QUALITY_REGISTRY.map((entry) => [entry.token.toLowerCase(), entry]),
);

/** Whether `value` is a registered chord-quality token (case-insensitive, matching the historical `.toLowerCase()` lookup contract `formatChordQuality`/`generateBlockChordNotes` used). */
export function isChordQuality(value: string): value is ChordQuality {
  return registryByLowercaseToken.has(value.toLowerCase());
}

/** The registry entry for `quality`, or `undefined` if it names no registered quality. */
export function getChordQualityEntry(quality: string): ChordQualityEntry | undefined {
  return registryByLowercaseToken.get(quality.toLowerCase());
}

/** Display suffix for a chord quality token, e.g. 'maj' -> '', 'min7' -> 'm7'. An unregistered token echoes itself, same contract as the pre-DEV-394 `CHORD_QUALITY_LABELS` lookup. */
export function formatChordQuality(quality: string): string {
  return getChordQualityEntry(quality)?.displaySuffix ?? quality;
}

/** App-token -> Tonal-alias pairs, but ONLY where they differ — the historical `TONAL_CHORD_ALIASES` contract `musicTheory.test.ts` pins (`app !== tonalType` for every entry). */
export const CHORD_QUALITY_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  CHORD_QUALITY_REGISTRY.filter(
    (entry) => entry.token.toLowerCase() !== entry.tonalAlias.toLowerCase(),
  ).map((entry) => [entry.token.toLowerCase(), entry.tonalAlias]),
);

/** The picker's option groups, built from the registry so a new quality needs one row, never a second table. Group order and per-group option order both follow registry order. */
export const CHORD_QUALITY_GROUPS: readonly {
  label: string;
  options: readonly { value: ChordQuality; label: string }[];
}[] = (['Triads', '7th Chords', 'Extensions & Additions'] as const).map((label) => ({
  label,
  options: CHORD_QUALITY_REGISTRY.filter((entry) => entry.pickerGroup === label).map((entry) => ({
    value: entry.token,
    label: entry.pickerLabel,
  })),
}));

/**
 * A chord quality's notes at a root/octave, canonical sharp-spelled (DEV-380).
 *
 * Every registered quality resolves through Tonal's `Chord.getChord` (proven
 * exhaustively by this file's own test); an unregistered quality — or a
 * registered one Tonal still cannot resolve for the given root — throws
 * instead of silently becoming a `maj` triad, which is what
 * `generateBlockChordNotes` did before this issue (the one explicit behavior
 * fix DEV-394's acceptance criteria require).
 */
export function resolveChordNotes(quality: string, root = 'C', octave = 4): string[] {
  const entry = getChordQualityEntry(quality);
  if (!entry) {
    throw new Error(`Unregistered chord quality: "${quality}"`);
  }
  const chordData = resolveTonalChord(entry.tonalAlias, root);
  if (chordData.empty) {
    throw new Error(
      `Tonal could not resolve registered quality "${quality}" (alias "${entry.tonalAlias}") at root "${root}"`,
    );
  }
  const rootMidi = noteMidi(`${root}${octave}`) ?? noteMidi(`C${octave}`) ?? 60;
  return chordData.intervals.map((ivl) => {
    const semitones = intervalSemitones(ivl);
    const midi = rootMidi + (Number.isFinite(semitones) ? semitones : 0);
    const noteName = ROOTS[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${noteName}${oct}`;
  });
}
