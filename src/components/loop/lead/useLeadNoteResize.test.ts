import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leadResizeCallbacks, leadTicksFromCells } from './useLeadNoteResize';

describe('leadTicksFromCells', () => {
  test('converts the shared gesture cell length into LeadNote ticks', () => {
    expect(leadTicksFromCells(3, 1)).toBe(3);
    expect(leadTicksFromCells(3, 2)).toBe(6);
    expect(leadTicksFromCells(1, 8)).toBe(8);
  });
});

describe('the Lead adapter keeps pointer mechanics in the shared hook', () => {
  test('uses the shared span gesture and owns no second listener path', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/loop/lead/useLeadNoteResize.ts'),
      'utf8',
    );
    expect(source).toContain('useSpanResize<LeadResizeIdentity>()');
    expect(source).not.toContain('addEventListener');
    expect(source).not.toContain('removeEventListener');
  });
});

describe('leadResizeCallbacks', () => {
  function writes() {
    const lengths: Array<[number, string, number]> = [];
    const erased: Array<[number, string]> = [];
    return {
      lengths,
      erased,
      write: {
        setNoteLength: (stepIndex: number, note: string, len: number) => {
          lengths.push([stepIndex, note, len]);
        },
        erase: (stepIndex: number, note: string) => {
          erased.push([stepIndex, note]);
        },
      },
    };
  }

  test('a drag commits the new length in ticks', () => {
    const w = writes();
    leadResizeCallbacks(w.write, 2, true).onCommit({ stepIndex: 4, note: 'C4' }, 3);
    expect(w.lengths).toEqual([[4, 'C4', 6]]);
  });

  test('an unmoved release on the handle erases the note, as a click on it does', () => {
    const w = writes();
    leadResizeCallbacks(w.write, 2, true).onClick({ stepIndex: 4, note: 'C4' });
    expect(w.erased).toEqual([[4, 'C4']]);
  });

  test('an unmoved release after a touch long-press keeps the note', () => {
    // A hold and lift is not a tap: the note survives.
    const w = writes();
    leadResizeCallbacks(w.write, 2, false).onClick({ stepIndex: 4, note: 'C4' });
    expect(w.erased).toEqual([]);
    expect(w.lengths).toEqual([]);
  });
});
