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
 * needs a near-passthrough of a raw Tonal chord lookup.
 */
export {
  chromaOfNote,
  intervalDistance,
  intervalSemitones,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  pitchClassOfNote,
  scaleNotesForTonal,
  transposeByInterval,
} from './tonalAdapter';

export {
  CHORD_QUALITY_ALIASES,
  CHORD_QUALITY_GROUPS,
  CHORD_QUALITY_REGISTRY,
  ROOTS,
  formatChordQuality,
  getChordQualityEntry,
  isChordQuality,
  resolveChordNotes,
} from './chordQuality';
export type { ChordQuality, ChordQualityEntry, ReharmonizationCategory } from './chordQuality';
