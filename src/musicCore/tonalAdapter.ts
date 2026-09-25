import { Chord, Interval, Note, Scale, transpose } from 'tonal';

/**
 * The ONLY file in production code permitted to `import ... from 'tonal'`
 * (DEV-394, closing the allowlist DEV-395 opened across six call sites — see
 * eslint.config.js's TONAL_IMPORT_BAN carve-out and
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md).
 * Every export here is a thin, Solna-shaped wrapper: plain strings and
 * numbers in, plain strings/numbers/booleans out — never a Tonal `NoteName`,
 * `Chord` or `Interval` object. `src/musicCore/chordQuality.ts` and every
 * production file outside this one call these wrappers through
 * `src/musicCore/index.ts`'s barrel, never `tonal` itself and never this file
 * directly.
 *
 * This module is not DEV-392's canonical pitch-parsing API: it does not
 * define a "parse a pitch" operation, a failure-policy contract, or a
 * MIDI/pitch-class abstraction beyond what today's six call sites already
 * compute. It exists to move Tonal's call surface behind one door, not to
 * redesign it.
 */

/** `Note.get(note).chroma` verbatim — `NaN` for an unparseable name (Tonal's own contract; every caller already guards it with `Number.isFinite`). */
export function chromaOfNote(note: string): number {
  return Note.get(note).chroma;
}

/** `Note.midi(note)` verbatim; `null` for an unparseable name or a name with no octave. */
export function noteMidi(note: string): number | null {
  return Note.midi(note);
}

/** `Note.fromMidiSharps(midi)` — always the sharp spelling, with octave. */
export function midiToSharpName(midi: number): string {
  return Note.fromMidiSharps(midi);
}

/** `Note.fromMidi(midi)` — Tonal's default (flat) spelling, with octave. */
export function midiToFlatName(midi: number): string {
  return Note.fromMidi(midi);
}

/** `Note.pitchClass(note)` — the note name with its octave stripped. */
export function pitchClassOfNote(note: string): string {
  return Note.pitchClass(note);
}

/** `Note.get(note).oct` — the note's octave, or `null` when `note` has no octave or does not parse (Tonal returns `undefined` for both; this wrapper narrows to `null` so every Music Core typed failure reads the same way). */
export function octaveOfNote(note: string): number | null {
  return Note.get(note).oct ?? null;
}

/** `transpose(note, intervalName)` verbatim — Tonal's own interval notation (e.g. `'8P'`); an empty string on failure, exactly as Tonal returns it. Callers already guard the falsy result themselves. */
export function transposeByInterval(note: string, intervalName: string): string {
  return transpose(note, intervalName);
}

/** `Interval.distance(from, to)` — the interval name between two spelled note names (e.g. `'3M'`). */
export function intervalDistance(from: string, to: string): string {
  return Interval.distance(from, to);
}

/** `Interval.semitones(intervalName)` — `NaN` for an unparseable interval name. */
export function intervalSemitones(intervalName: string): number {
  return Interval.semitones(intervalName);
}

/** `Scale.get('${tonic} ${tonalScaleName}').notes` — the scale's spelled note names, tonic first. */
export function scaleNotesForTonal(tonic: string, tonalScaleName: string): string[] {
  return Scale.get(`${tonic} ${tonalScaleName}`).notes;
}

/**
 * The semitone offsets of `Scale.get('C ' + name).intervals`, tonic first.
 * Throws on a name tonal does not know: a scale library entry that resolves
 * to nothing is a typo, and it must fail at load rather than sound as silence.
 */
export function scaleSemitonesForTonal(name: string): number[] {
  const scale = Scale.get(`C ${name}`);
  if (scale.empty || scale.intervals.length === 0) {
    throw new Error(`tonal has no scale named '${name}'`);
  }
  return scale.intervals.map((interval) => Interval.semitones(interval));
}

/** A Tonal chord-lookup result, narrowed to the two fields any caller needs. */
export interface TonalChordResult {
  empty: boolean;
  intervals: readonly string[];
}

/**
 * `Chord.getChord(tonalType, root)`, narrowed to `{ empty, intervals }`.
 * Deliberately NOT re-exported from `src/musicCore/index.ts` — only
 * `chordQuality.ts`'s `resolveChordNotes` calls it, so the public Music Core
 * surface never hands out a near-passthrough of a raw Tonal lookup.
 */
export function resolveTonalChord(tonalType: string, root: string): TonalChordResult {
  const chord = Chord.getChord(tonalType, root);
  return { empty: chord.empty, intervals: chord.intervals };
}
