import { describe, expect, test } from 'bun:test';
import { arpFiresOnStep, computeArpTriggers } from './arpSchedule';

describe('arpFiresOnStep', () => {
  test('16n fires on every step', () => {
    for (let step = 0; step < 16; step++) {
      expect(arpFiresOnStep(step, '16n')).toBe(true);
    }
  });

  test('8n fires on every other step', () => {
    expect([0, 1, 2, 3, 4].map((s) => arpFiresOnStep(s, '8n'))).toEqual([
      true, false, true, false, true,
    ]);
  });

  test('4n fires on one step in four', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => arpFiresOnStep(s, '4n'))).toEqual([
      true, false, false, false, true, false,
    ]);
  });

  test('32n fires on every step (it emits two notes per step)', () => {
    for (let step = 0; step < 8; step++) {
      expect(arpFiresOnStep(step, '32n')).toBe(true);
    }
  });

  test('it agrees exactly with computeArpTriggers returning nothing', () => {
    for (const rate of ['4n', '8n', '16n', '32n'] as const) {
      for (let step = 0; step < 32; step++) {
        const fires = computeArpTriggers(step, 4, rate, 0.125).length > 0;
        expect(`${rate}@${step}=${arpFiresOnStep(step, rate)}`).toBe(`${rate}@${step}=${fires}`);
      }
    }
  });
});

describe('computeArpTriggers edge cases', () => {
  test('a single-note chord always resolves to index 0', () => {
    for (const rate of ['4n', '8n', '16n', '32n'] as const) {
      for (let step = 0; step < 16; step++) {
        for (const t of computeArpTriggers(step, 1, rate, 0.125)) {
          expect(t.noteIndex).toBe(0);
        }
      }
    }
  });

  test('a sequence length that does not divide the bar wraps by modulo, not by truncation', () => {
    // seqLen 3 against a 16-step bar: the arp must keep cycling 0,1,2,0,1,2...
    // rather than stalling or going out of bounds once the bar outruns it.
    const indices = Array.from({ length: 16 }, (_, step) => computeArpTriggers(step, 3, '16n', 0.125)[0].noteIndex);
    expect(indices).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });

  test('a rate change mid-hold is not remembered across calls', () => {
    // computeArpTriggers takes no state beyond its arguments, so switching the
    // rate argument between calls at the SAME step must behave exactly as if
    // that rate had been in effect from the start — nothing carries over from
    // the previous call's rate.
    const at4n = computeArpTriggers(4, 5, '4n', 0.125);
    const at8n = computeArpTriggers(4, 5, '8n', 0.125);
    expect(at4n.length).toBeGreaterThan(0);
    expect(at8n.length).toBeGreaterThan(0);
    expect(at4n[0].holdSec).not.toBe(at8n[0].holdSec);
  });

  test('repeated calls with identical inputs return an identical sequence', () => {
    const first = computeArpTriggers(2, 5, '8n', 0.125);
    const second = computeArpTriggers(2, 5, '8n', 0.125);
    expect(second).toEqual(first);
  });
});
