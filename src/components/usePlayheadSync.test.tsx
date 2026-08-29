import { describe, expect, test } from 'bun:test';
import { shouldRunPlayheadSync } from './usePlayheadSync';
import type { PlayerState } from '../store/types';

const ALL: PlayerState[] = ['stopped', 'playing', 'stopping'];

describe('shouldRunPlayheadSync (the playhead gate)', () => {
  test('runs only while at least one of the three players is active', () => {
    expect(shouldRunPlayheadSync('stopped', 'stopped', 'stopped')).toBe(false);
    for (const active of ALL.filter((p) => p !== 'stopped')) {
      expect(shouldRunPlayheadSync(active, 'stopped', 'stopped')).toBe(true);
      expect(shouldRunPlayheadSync('stopped', active, 'stopped')).toBe(true);
      expect(shouldRunPlayheadSync('stopped', 'stopped', active)).toBe(true);
    }
  });

  test('a lead-only player keeps the playhead running', () => {
    // Regression: a two-player derivation dropped the lead player entirely, so
    // the playhead readout froze while only the lead was playing.
    expect(shouldRunPlayheadSync('stopped', 'stopped', 'playing')).toBe(true);
    expect(shouldRunPlayheadSync('stopped', 'stopped', 'stopping')).toBe(true);
  });

  test('a stopping player keeps the playhead running (soft stop is not a stop)', () => {
    expect(shouldRunPlayheadSync('stopping', 'stopped', 'stopped')).toBe(true);
    expect(shouldRunPlayheadSync('stopped', 'stopping', 'stopped')).toBe(true);
    expect(shouldRunPlayheadSync('stopped', 'stopped', 'stopping')).toBe(true);
  });
});
