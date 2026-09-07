import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { ROOTS, getDiatonicChordForDegree } from './musicTheory';
import { DIATONIC_CHARACTERIZATION } from './diatonicCharacterizationFixture';

/**
 * A characterization lock: it states what the app does today so that a change
 * to how it decides has to declare, line by line, what it moved. It is NOT a
 * statement that today's answers are the right ones.
 */
describe('getDiatonicChordForDegree — characterization lock', () => {
  test('covers every scale x 12 roots x {triad, 7th}', () => {
    expect(Object.keys(DIATONIC_CHARACTERIZATION).length).toBe(264);
    expect(Object.keys(SCALES).length * ROOTS.length * 2).toBe(264);
  });

  test('every degree of every key still resolves to the pinned root, quality and numeral', () => {
    const actual: Record<string, string> = {};
    for (const scaleType of Object.keys(SCALES)) {
      for (const root of ROOTS) {
        for (const use7ths of [false, true]) {
          const cells = SCALES[scaleType].intervals.map((_, degree) => {
            const chord = getDiatonicChordForDegree(degree, root, scaleType, use7ths);
            return `${chord.root}:${chord.quality}:${chord.degreeName}`;
          });
          actual[`${scaleType}|${root}|${use7ths ? '7' : '3'}`] = cells.join(' ');
        }
      }
    }
    expect(actual).toEqual(DIATONIC_CHARACTERIZATION);
  });
});
