import { describe, expect, test } from 'bun:test';
import { Note, Scale } from 'tonal';
import { SCALES } from './scales';
import { parentDegreesFor, resolveParentDegreeQuality } from '@/utils/musicTheory';

describe('SCALES', () => {
  test('holds 11 scales', () => {
    expect(Object.keys(SCALES).length).toBe(11);
  });

  test('every scale starts on the root', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.intervals[0], key).toBe(0);
    }
  });

  // intervals stays a literal — it is the table's content, readable by eye —
  // but a hand-edited interval that tonal disagrees with is either a typo or a
  // decision to leave tonal, and both should be visible.
  test('every intervals array is what tonal spells for its `tonal` name', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      const chroma = Scale.get(`C ${scale.tonal}`).notes.map((n) => Note.get(n).chroma);
      expect(chroma, key).toEqual(scale.intervals);
    }
  });

  test('every parent names a 7-note SCALES entry, and no 7-note scale declares one', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      if (scale.intervals.length === 7) {
        expect(scale.parent, key).toBeUndefined();
        continue;
      }
      expect(scale.parent, key).toBeDefined();
      const parent = SCALES[scale.parent as string];
      expect(parent, key).toBeDefined();
      expect(parent.intervals.length, key).toBe(7);
    }
  });

  // A degree the parent does not contain resolves through its nearest parent
  // neighbours. When two are equidistant their qualities must AGREE — the tie
  // is decided by agreement, never by array order. If this goes red, the answer
  // is an explicit `parent` change or intervals that were mis-entered, never a
  // tiebreak rule invented at that moment to make the suite pass.
  test('equidistant parent neighbours agree on the quality', () => {
    let ties = 0;
    for (const [key, scale] of Object.entries(SCALES)) {
      scale.intervals.forEach((_, degree) => {
        const { parentKey, degrees } = parentDegreesFor(key, degree);
        if (degrees.length < 2) return;
        ties++;
        for (const use7ths of [false, true]) {
          const qualities = degrees.map((d) => resolveParentDegreeQuality(parentKey, d, use7ths));
          expect(new Set(qualities).size, `${key} degree ${degree} 7ths=${use7ths}`).toBe(1);
        }
      });
    }
    // Exactly one tie exists today: Blues degree 3, the b5 at interval 6,
    // equidistant from Natural Minor's interval 5 and interval 7.
    expect(ties).toBe(1);
  });
});
