import { describe, expect, test } from 'bun:test';
import {
  LEAD_GATE,
  clampLeadLoopLength,
  leadStepNotes,
  loopLengthDivisors,
  resizeLeadMelody,
  resolveLeadStepTriggers,
  stepInLoopFor,
} from './leadMelody';

describe('loopLengthDivisors', () => {
  test('lists every positive divisor ascending', () => {
    expect(loopLengthDivisors(4)).toEqual([1, 2, 4]);
    expect(loopLengthDivisors(6)).toEqual([1, 2, 3, 6]);
    expect(loopLengthDivisors(1)).toEqual([1]);
  });
});

describe('clampLeadLoopLength', () => {
  test('returns the current value when it already divides', () => {
    expect(clampLeadLoopLength(2, 4)).toBe(2);
    expect(clampLeadLoopLength(4, 4)).toBe(4);
  });
  test('clamps DOWN to the largest divisor <= current', () => {
    expect(clampLeadLoopLength(3, 4)).toBe(2);
    expect(clampLeadLoopLength(5, 6)).toBe(3);
    expect(clampLeadLoopLength(3, 2)).toBe(2);
  });
  test('a zero/invalid total falls back to 1', () => {
    expect(clampLeadLoopLength(4, 0)).toBe(1);
  });
});

describe('resizeLeadMelody', () => {
  const twoBars = Array.from({ length: 48 }, (_, i) => (i < 24 ? ['C4'] : ['E4']));
  test('pads empty bars when growing', () => {
    const out = resizeLeadMelody([['C4']], 2);
    expect(out).toHaveLength(48);
    expect(out[0]).toEqual(['C4']);
    expect(out[24]).toEqual([]);
    expect(out[47]).toEqual([]);
  });
  test('trims trailing bars when shrinking', () => {
    const out = resizeLeadMelody(twoBars, 1);
    expect(out).toHaveLength(24);
    expect(out[0]).toEqual(['C4']);
    expect(out[24]).toBeUndefined();
  });
});

describe('stepInLoopFor', () => {
  test('wraps the absolute step into the melody loop', () => {
    expect(stepInLoopFor(0, 32)).toBe(0);
    expect(stepInLoopFor(16, 32)).toBe(16);
    expect(stepInLoopFor(32, 32)).toBe(0);
    expect(stepInLoopFor(33, 32)).toBe(1);
  });
  test('a short 1-bar loop repeats as an ostinato', () => {
    expect(stepInLoopFor(48, 16)).toBe(0);
    expect(stepInLoopFor(50, 16)).toBe(2);
  });
});

describe('leadStepNotes — non-destructive per-bar windowing', () => {
  const melody: string[][] = [
    ['C4'], ...new Array<string[]>(23).fill([]), // bar 0, step 0 = C4
    ...new Array<string[]>(24).fill([]), // bar 1 empty
  ];
  test('windowed at 24 steps (12/8) the full bar is reachable', () => {
    expect(leadStepNotes(melody, 0, 24)).toEqual(['C4']);
  });
  test('windowed at 16 steps (4/4) step 0 still resolves', () => {
    expect(leadStepNotes(melody, 0, 16)).toEqual(['C4']);
    expect(leadStepNotes(melody, 15, 16)).toEqual([]);
  });
  test('step 16 in 4/4 maps into bar 1, not bar 0 step 16', () => {
    expect(leadStepNotes(melody, 16, 16)).toEqual([]);
  });
  test('a step past the stored melody resolves to a rest (empty array)', () => {
    expect(leadStepNotes(melody, 1000, 16)).toEqual([]);
  });
});

describe('resolveLeadStepTriggers', () => {
  const params = { arpMode: 'up' as const, arpRate: '16n' as const, arpOctaves: 1 };
  test('arp OFF fires every note together (block) at the step start', () => {
    const triggers = resolveLeadStepTriggers(['C4', 'E4', 'G4'], false, 0, params, 0.125);
    expect(triggers).toEqual([
      { note: 'C4', timeOffsetSec: 0, holdSec: LEAD_GATE * 0.125 },
      { note: 'E4', timeOffsetSec: 0, holdSec: LEAD_GATE * 0.125 },
      { note: 'G4', timeOffsetSec: 0, holdSec: LEAD_GATE * 0.125 },
    ]);
  });
  test('an empty note set yields no triggers', () => {
    expect(resolveLeadStepTriggers([], false, 0, params, 0.125)).toEqual([]);
  });
  test('arp ON reuses buildArpSequence + computeArpTriggers (16n fires one note)', () => {
    const triggers = resolveLeadStepTriggers(['C4', 'E4', 'G4'], true, 0, params, 0.125);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].note).toBe('C4'); // ascending arp, first note
    expect(triggers[0].timeOffsetSec).toBe(0);
  });
  test('arp ON expands octaves through the arpeggiator (unchanged)', () => {
    const triggers = resolveLeadStepTriggers(['C4'], true, 0, { ...params, arpOctaves: 2 }, 0.125);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].note).toBe('C4'); // step 0 → first of [C4, C5]
  });
});
