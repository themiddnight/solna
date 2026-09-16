/**
 * Music Core's public API (DEV-394). Every production file outside
 * `src/musicCore/` that needs pitch, interval or chord-quality operations
 * imports from here — never from `./tonalAdapter` or `./chordQuality`
 * directly, and never from `tonal` (eslint.config.js's `TONAL_IMPORT_BAN`
 * enforces the latter; see
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md).
 *
 * `resolveTonalChord`/`TonalChordResult` (tonalAdapter.ts) are deliberately
 * NOT re-exported: nothing outside `chordQuality.ts`'s `resolveChordNotes`
 * needs a near-passthrough of a raw Tonal chord lookup. `ReharmonizationCategory`
 * itself is still not re-exported — DEV-393 (the consumer this was reserved
 * for) only needs the boolean `shouldPreserveQualityOnSnap` derives from it, so
 * the raw category type stays module-private to `chordQuality.ts`.
 */
export {
  chromaOfNote,
  intervalDistance,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  octaveOfNote,
  pitchClassOfNote,
  scaleNotesForTonal,
  transposeByInterval,
} from './tonalAdapter';

export {
  CHORD_QUALITY_ALIASES,
  CHORD_QUALITY_GROUPS,
  ROOTS,
  formatChordQuality,
  getChordQualityEntry,
  isChordQuality,
  resolveChordNotes,
  shouldPreserveQualityOnSnap,
} from './chordQuality';
export type { ChordQuality } from './chordQuality';

export { resolveScaleKey, scaleEntry } from './scale';

export { transposePitchClassPreservingOctave } from './pitch';
