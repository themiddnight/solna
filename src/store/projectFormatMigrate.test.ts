import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { migrateProjectBody } from './projectFormatMigrate';
import { PROJECT_FORMAT_VERSION } from './projectFormat';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { LEAD_TICKS_PER_BAR } from '../utils/stepResolution';

describe('the .solna chain widens the melody to ticks', () => {
  const body = (steps: unknown, formatVersion: number): Record<string, unknown> => ({
    formatVersion,
    content: {
      loops: [{ id: 'loop-1', name: 'Loop 1', leadLoopLength: 1, leadMelodySteps: steps }],
    },
  });

  test('a current-shape body one version behind is widened and defaulted', () => {
    const steps: unknown[][] = Array.from({ length: MAX_STEPS_PER_BAR }, () => []);
    steps[4] = [{ note: 'C4', len: 2 }];
    const out = migrateProjectBody(body(steps, PROJECT_FORMAT_VERSION - 1), PROJECT_FORMAT_VERSION - 1);
    const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
    expect(loop.leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
    expect((loop.leadMelodySteps as LeadNote[][])[8]).toEqual([{ note: 'C4', len: 4 }]);
    expect(loop.leadStepResolution).toBe('1/16');
  });

  test('a v1 body runs BOTH lead steps, in order, and lands populated', () => {
    // Same trap as the persist chain, and the reason each chain needs its
    // own end-to-end test: a v1 string[][] widened first would never become
    // LeadNote[][] at all, and sanitizeContent would hand back a blank
    // melody with no throw and no warning.
    const legacy = Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]);
    legacy[2] = ['C4'];
    const out = migrateProjectBody(body(legacy, 1), 1);
    const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
    expect((loop.leadMelodySteps as LeadNote[][])[4]).toEqual([{ note: 'C4', len: 2 }]);
    expect(loop.leadGate).toBeCloseTo(DEFAULT_LEAD_GATE, 10);
    expect(loop.leadStepResolution).toBe('1/16');
  });

  test('a melody wider than leadLoopLength keeps every bar, at the right beat', () => {
    // The same ordinary state the persist chain is pinned against: a melody
    // left wider than the loop by setLeadLoopLengthPreserve. At exactly 2x
    // the old array is the width of one new bar, which is what made
    // trusting leadLoopLength re-read bar 0 at half its beat and bury bar 1.
    const steps: unknown[][] = Array.from({ length: 2 * MAX_STEPS_PER_BAR }, () => []);
    steps[4] = [{ note: 'C4', len: 2 }];
    steps[MAX_STEPS_PER_BAR + 4] = [{ note: 'E4', len: 2 }];
    const out = migrateProjectBody(
      body(steps, PROJECT_FORMAT_VERSION - 1),
      PROJECT_FORMAT_VERSION - 1,
    );
    const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
    const melody = loop.leadMelodySteps as LeadNote[][];
    expect(melody).toHaveLength(2 * LEAD_TICKS_PER_BAR);
    expect(melody[8]).toEqual([{ note: 'C4', len: 4 }]);
    expect(melody[LEAD_TICKS_PER_BAR + 8]).toEqual([{ note: 'E4', len: 4 }]);
  });

  test('the two chains are separate functions, and stay separate', () => {
    const src = readFileSync(new URL('./projectFormatMigrate.ts', import.meta.url), 'utf8');
    // The ONLY thing shared with the persist chain is the pure transform.
    expect(src).toContain('upgradeLeadMelodyToTicks');
    expect(src).not.toContain("from './migrate'");
    expect(src).not.toContain("from './store'");
  });
});
