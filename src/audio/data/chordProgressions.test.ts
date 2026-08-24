import { describe, expect, test } from 'bun:test';
import { CHORD_PROGRESSION_TEMPLATES } from './chordProgressions';

describe('CHORD_PROGRESSION_TEMPLATES data sanity', () => {
  test('every template has name, roman, description, and valid relativeChords', () => {
    expect(CHORD_PROGRESSION_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of CHORD_PROGRESSION_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.roman.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.relativeChords.length).toBeGreaterThan(0);
      for (const rc of t.relativeChords) {
        expect(rc.interval).toBeGreaterThanOrEqual(0);
        expect(rc.interval).toBeLessThan(12);
        expect(rc.bars).toBeGreaterThan(0);
        expect(typeof rc.quality).toBe('string');
      }
    }
  });
});
