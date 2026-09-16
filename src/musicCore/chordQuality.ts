import { intervalSemitones, noteMidi, resolveTonalChord } from './tonalAdapter';

/** The twelve sharp-spelled pitch-class names, index = chroma. Canonical identity per DEV-380 — nothing here ever spells a flat. */
export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * The chord FAMILY a quality belongs to — a shape axis, not a policy by
 * itself. `shouldPreserveQualityOnSnap` below is the policy derived from it:
 * see that function's docblock for which families preserve a quality through
 * a scale snap and which regenerate the landing degree's own version, and why
 * the split does not track family names the way it looks like it should
 * (`diminished-half-diminished` and `altered` both REGENERATE, because
 * `resolveDegreeQuality` can itself emit every member of both).
 */
type ReharmonizationCategory =
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
  /**
   * The chord family this quality belongs to. Read by
   * `shouldPreserveQualityOnSnap` below, this registry's only consumer of the
   * raw category — `ReharmonizationCategory` itself stays unexported, since
   * nothing outside this file needs the category, only the derived boolean.
   */
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

/**
 * Whether `value` is a registered chord-quality token (case-insensitive,
 * matching the historical `.toLowerCase()` lookup contract
 * `formatChordQuality`/`generateBlockChordNotes` used).
 *
 * The narrow is deliberately UNSOUND, and a caller has to know it: the match
 * ignores case, so `'MINMAJ7'` and `'MinMaj7'` both return `true` and both get
 * narrowed to `ChordQuality` even though neither is a member of that literal
 * union — only `'minMaj7'` is. A true result therefore means "names a
 * registered quality", NOT "is already written in canonical form". Anything
 * that PERSISTS the value, compares it against a token, or uses it as a lookup
 * key (a `ChordItem.quality` write, a `<select>` value, a registry index) must
 * canonicalize through `getChordQualityEntry(value)?.token` first rather than
 * trusting the narrow; only a read-and-discard check can use this on its own.
 */
export function isChordQuality(value: string): value is ChordQuality {
  return registryByLowercaseToken.has(value.toLowerCase());
}

/** The registry entry for `quality`, or `undefined` if it names no registered quality. */
export function getChordQualityEntry(quality: string): ChordQualityEntry | undefined {
  return registryByLowercaseToken.get(quality.toLowerCase());
}

/**
 * The four categories a snap preserves verbatim rather than regenerating —
 * see shouldPreserveQualityOnSnap for why this specific split.
 */
const SNAP_PRESERVED_CATEGORIES: ReadonlySet<ReharmonizationCategory> = new Set([
  'sixth',
  'added-tone',
  'extension',
  'suspended',
]);

/**
 * Whether `snapProgressionToScale` (src/utils/musicTheory.ts) should keep `quality`
 * verbatim on a scale snap rather than regenerating the landing degree's own
 * diatonic quality.
 *
 * The split is read off `resolveDegreeQuality`'s ACTUAL output set, not off
 * family names by feel: `triad`, `seventh`, `diminished-half-diminished` and
 * `altered` are exactly the four families whose members `resolveDegreeQuality`
 * (src/utils/musicTheory.ts) can itself emit at some degree of some scale — a
 * snap regenerating one of them asks the target key for its OWN version of the
 * same shape, e.g. a min7 ii moved into a new key becomes that key's own ii7,
 * not a frozen min7. `sixth`, `added-tone`, `extension` and `suspended` name
 * colour no interval tuple in that function's tables ever resolves to — there
 * is no diatonic 6th, add9, extension or sus chord to regenerate TO at any
 * degree of any scale — so a snap keeps the quality the user picked and only
 * moves its root. This is why `dim`, `aug`, `dim7`, `m7b5`, `minMaj7` and
 * `maj7#5` all REGENERATE despite sounding like the more "special" qualities:
 * the scale itself produces every one of them at the right degree, and
 * freezing them would mean freezing chords the key change already has a
 * correct diatonic answer for.
 *
 * Throws for an unregistered quality, same "stop, don't guess" contract as
 * `resolveChordNotes` above — a caller holding a quality from outside this
 * module must validate or sanitize it first.
 */
export function shouldPreserveQualityOnSnap(quality: ChordQuality): boolean {
  const entry = getChordQualityEntry(quality);
  if (!entry) {
    throw new Error(`Unregistered chord quality: "${quality}"`);
  }
  return SNAP_PRESERVED_CATEGORIES.has(entry.reharmonizationCategory);
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
 * exhaustively by this file's own test). It THROWS, rather than silently
 * returning a `maj` triad the way `generateBlockChordNotes` did before this
 * issue — the one explicit behavior fix DEV-394's acceptance criteria
 * require — in all three of these cases:
 *
 * 1. **Any quality this registry does not list, whether or not Tonal itself
 *    could resolve it.** The registry is the authority, not Tonal: `'13'`,
 *    `'11'`, `'7b9'` and `'sus'` are all perfectly good Tonal chord types and
 *    all four throw here, because Solna cannot store, render or pick them. So
 *    "unregistered" is a much wider class than "Tonal rejected it", and a
 *    caller holding a quality from outside this module — a persisted
 *    `ChordItem.quality`, a `.solna` body, a URL — must validate or
 *    sanitize it before calling.
 * 2. **A registered quality Tonal cannot resolve at the given root**, which in
 *    practice means an unparseable root: `'H'` and `'x'` both throw. (`'Cb'`
 *    parses fine and comes back sharp-spelled, as `B3`.)
 * 3. Never for a valid pair — a registered quality at a parseable root always
 *    returns at least one note.
 *
 * One edge that is NOT a throw, recorded so nobody reads case 2 as broader
 * than it is: an EMPTY-string root resolves as `C`, because Tonal treats it as
 * a chord with no tonic and the MIDI fallback lands on `C{octave}`. Pass a
 * real root.
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
