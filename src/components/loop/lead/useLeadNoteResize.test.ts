import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leadTicksFromCells } from './useLeadNoteResize';

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
