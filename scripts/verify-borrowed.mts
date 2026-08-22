// Throwaway research script: audit borrowed-chord catalog for duplicates vs diatonic chords.
// Run: bun run scripts/verify-borrowed.mts
import { Chord, Note, Scale } from 'tonal';
import {
  SCALES,
  getBorrowedChords,
  getDiatonicChordForDegree,
  getScaleNotes,
} from '../src/utils/musicTheory';

const pcs = (notes: string[]): number[] =>
  [...new Set(notes.map((n) => Note.get(n).chroma))].sort((a, b) => a - b);
const chordPcs = (root: string, quality: string): number[] =>
  pcs(Chord.getChord(quality.toLowerCase(), root).notes);
const subset = (a: number[], b: number[]): boolean => a.every((p) => b.includes(p));

console.log('=== EXACT DUPLICATES: borrowed (root,quality) == diatonic (root,quality) ===');
for (const scaleType of Object.keys(SCALES)) {
  for (const root of ['C', 'F#']) {
    const diatTriads = SCALES[scaleType].intervals.map((_, i) =>
      getDiatonicChordForDegree(i, root, scaleType, false),
    );
    const diat7 = SCALES[scaleType].intervals.map((_, i) =>
      getDiatonicChordForDegree(i, root, scaleType, true),
    );
    const borrowed = getBorrowedChords(root, scaleType);
    const scalePcs = pcs(getScaleNotes(root, scaleType));

    const exTriad = borrowed.filter((b) =>
      diatTriads.some((d) => d.root === b.root && d.quality === b.quality),
    );
    const ex7 = borrowed.filter((b) =>
      diat7.some((d) => d.root === b.root && d.quality === b.quality),
    );
    const near = borrowed.filter(
      (b) =>
        !exTriad.includes(b) &&
        diatTriads.some((d) => d.root === b.root && (d.quality === b.quality.replace('7', '') || b.quality === d.quality.replace('7', ''))),
    );
    const nonDiatonic = borrowed.filter((b) => !subset(chordPcs(b.root, b.quality), scalePcs));

    const line = [`${scaleType} / ${root}:`, `exactTriad=[${exTriad.map((b) => `${b.root}${b.quality}`)}]`, `exact7=[${ex7.map((b) => `${b.root}${b.quality}`)}]`, `sameRootTriadVs7th=[${near.map((b) => `${b.root}${b.quality}`)}]`, `nonDiatonic(tonalPcCheck)=[${nonDiatonic.map((b) => `${b.root}${b.quality}`)}]`];
    console.log(line.join(' '));
  }
}

console.log('\n=== BORROWED CHORDS PER SCALE (root C, with labels) ===');
for (const scaleType of Object.keys(SCALES)) {
  const borrowed = getBorrowedChords('C', scaleType);
  console.log(
    `${scaleType}: ${borrowed.map((b) => `${b.label}=${b.root} ${b.quality}`).join(' | ')}`,
  );
}

console.log('\n=== TONAL API CAPABILITY CHECK (v6.4.3) ===');
console.log('Scale.scaleChords("major"):', JSON.stringify(Scale.scaleChords('major').slice(0, 12)));
console.log('Scale.scaleChords("minor"):', JSON.stringify(Scale.scaleChords('minor').slice(0, 12)));
console.log('Scale.get("C major").notes:', JSON.stringify(Scale.get('C major').notes));
console.log('Chord.detect(["C","E","G"]):', JSON.stringify(Chord.detect(['C', 'E', 'G'])));
console.log('Chord.detect(["C","E","G","B"]):', JSON.stringify(Chord.detect(['C', 'E', 'G', 'B'])));
console.log('Chord.get("Cmaj7").notes:', JSON.stringify(Chord.get('Cmaj7').notes));
console.log('Scale.detect(["C","D","E","F","G","A","B"]):', JSON.stringify(Scale.detect(['C', 'D', 'E', 'F', 'G', 'A', 'B'])));
