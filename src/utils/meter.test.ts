import { describe, expect, test } from 'bun:test';
import {
  METERS,
  METER_IDS,
  DEFAULT_METER_ID,
  MAX_STEPS_PER_BAR,
  getMeter,
  isMeterId,
  beatIndexAt,
  isBeatBoundary,
  arpStepFor,
  type MeterId,
} from './meter';

describe('the meter table', () => {
  test('holds exactly the six meters the spec names, in declaration order', () => {
    expect(METER_IDS).toEqual(['4/4', '3/4', '6/8', '12/8', '5/4', '7/8']);
    expect(Object.keys(METERS).sort()).toEqual([...METER_IDS].sort());
  });

  test('every row carries the exact stepsPerBar and accentGroups from the spec', () => {
    expect(METERS['4/4'].stepsPerBar).toBe(16);
    expect(METERS['4/4'].accentGroups).toEqual([4, 4, 4, 4]);
    expect(METERS['3/4'].stepsPerBar).toBe(12);
    expect(METERS['3/4'].accentGroups).toEqual([4, 4, 4]);
    expect(METERS['6/8'].stepsPerBar).toBe(12);
    expect(METERS['6/8'].accentGroups).toEqual([6, 6]);
    expect(METERS['12/8'].stepsPerBar).toBe(24);
    expect(METERS['12/8'].accentGroups).toEqual([6, 6, 6, 6]);
    expect(METERS['5/4'].stepsPerBar).toBe(20);
    expect(METERS['5/4'].accentGroups).toEqual([4, 4, 4, 4, 4]);
    expect(METERS['7/8'].stepsPerBar).toBe(14);
    expect(METERS['7/8'].accentGroups).toEqual([6, 4, 4]);
  });

  test("INVARIANT: every row's accentGroups sums to its stepsPerBar", () => {
    for (const id of METER_IDS) {
      const meter = METERS[id];
      const sum = meter.accentGroups.reduce((a, b) => a + b, 0);
      expect(sum, `${id} accentGroups must sum to stepsPerBar`).toBe(meter.stepsPerBar);
    }
  });

  test('every row is self-consistent: id matches its key, groups are positive integers', () => {
    for (const id of METER_IDS) {
      const meter = METERS[id];
      expect(meter.id).toBe(id);
      expect(meter.label.length).toBeGreaterThan(0);
      expect(meter.accentGroups.length).toBeGreaterThan(0);
      for (const group of meter.accentGroups) {
        expect(Number.isInteger(group)).toBe(true);
        expect(group).toBeGreaterThan(0);
      }
    }
  });

  test('MAX_STEPS_PER_BAR is the widest row and no row exceeds it', () => {
    expect(MAX_STEPS_PER_BAR).toBe(24);
    const widest = Math.max(...METER_IDS.map((id) => METERS[id].stepsPerBar));
    expect(widest).toBe(MAX_STEPS_PER_BAR);
  });

  test('3/4 and 6/8 share a bar length and are told apart only by accentGroups', () => {
    expect(METERS['3/4'].stepsPerBar).toBe(METERS['6/8'].stepsPerBar);
    expect(METERS['3/4'].accentGroups).not.toEqual(METERS['6/8'].accentGroups);
  });
});

describe('getMeter / isMeterId', () => {
  test('resolves every known id to its own row', () => {
    for (const id of METER_IDS) expect(getMeter(id)).toBe(METERS[id]);
  });

  test('falls back to 4/4 for anything unknown, so persisted junk cannot break the clock', () => {
    expect(DEFAULT_METER_ID).toBe('4/4');
    expect(getMeter('9/8')).toBe(METERS['4/4']);
    expect(getMeter('')).toBe(METERS['4/4']);
    expect(getMeter(null)).toBe(METERS['4/4']);
    expect(getMeter(undefined)).toBe(METERS['4/4']);
  });

  test('isMeterId narrows only real ids', () => {
    expect(isMeterId('7/8')).toBe(true);
    expect(isMeterId('9/8')).toBe(false);
    expect(isMeterId(16)).toBe(false);
    expect(isMeterId(null)).toBe(false);
  });
});

describe('beatIndexAt / isBeatBoundary', () => {
  test('4/4 reproduces the current floor(step / 4) and step % 4 === 0 exactly', () => {
    const groups = METERS['4/4'].accentGroups;
    for (let step = 0; step < 16; step++) {
      expect(beatIndexAt(step, groups)).toBe(Math.floor(step / 4));
      expect(isBeatBoundary(step, groups)).toBe(step % 4 === 0);
    }
  });

  test('6/8 groups its twelve steps into two beats of six', () => {
    const groups = METERS['6/8'].accentGroups;
    expect([0, 1, 2, 3, 4, 5].map((s) => beatIndexAt(s, groups))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([6, 7, 8, 9, 10, 11].map((s) => beatIndexAt(s, groups))).toEqual([1, 1, 1, 1, 1, 1]);
    expect([0, 6].every((s) => isBeatBoundary(s, groups))).toBe(true);
    expect([1, 5, 7, 11].some((s) => isBeatBoundary(s, groups))).toBe(false);
  });

  test('7/8 boundaries follow the uneven 3+2+2 grouping', () => {
    const groups = METERS['7/8'].accentGroups;
    const boundaries = Array.from({ length: 14 }, (_, s) => s).filter((s) =>
      isBeatBoundary(s, groups),
    );
    expect(boundaries).toEqual([0, 6, 10]);
    expect(beatIndexAt(5, groups)).toBe(0);
    expect(beatIndexAt(6, groups)).toBe(1);
    expect(beatIndexAt(9, groups)).toBe(1);
    expect(beatIndexAt(10, groups)).toBe(2);
    expect(beatIndexAt(13, groups)).toBe(2);
  });

  test('a step past the last group clamps to the last beat rather than reporting NaN', () => {
    const groups = METERS['3/4'].accentGroups;
    expect(beatIndexAt(12, groups)).toBe(2);
    expect(beatIndexAt(99, groups)).toBe(2);
    expect(beatIndexAt(-1, groups)).toBe(0);
    expect(isBeatBoundary(-1, groups)).toBe(false);
    expect(isBeatBoundary(12, groups)).toBe(false);
  });
});

describe('arpStepFor — the monotonic-counter trap', () => {
  test('is the identity for every meter whose bar is a multiple of four steps', () => {
    for (const stepsPerBar of [16, 12, 24, 20]) {
      for (let step = 0; step < 200; step++) {
        expect(arpStepFor(step, stepsPerBar)).toBe(step);
      }
    }
  });

  test('7/8 lands the same arp phase in every bar instead of drifting', () => {
    const bar = METERS['7/8'].stepsPerBar; // 14
    for (let stepInBar = 0; stepInBar < bar; stepInBar++) {
      const first = arpStepFor(stepInBar, bar);
      for (let barIndex = 1; barIndex < 12; barIndex++) {
        const later = arpStepFor(barIndex * bar + stepInBar, bar);
        expect(later % 4).toBe(first % 4);
        expect(later % 2).toBe(first % 2);
      }
    }
  });

  test('the raw clock step DOES drift in 7/8 — this is the bug being fixed', () => {
    const bar = 14;
    expect(0 % 4).toBe(0);
    expect((1 * bar + 0) % 4).toBe(2); // bar 2 downbeat no longer lands on a quarter
    expect(arpStepFor(1 * bar + 0, bar) % 4).toBe(0); // ...but the phased step does
  });

  test('arpStepFor never goes backwards', () => {
    for (const stepsPerBar of [14, 16, 20]) {
      for (let step = 1; step < 300; step++) {
        expect(arpStepFor(step, stepsPerBar)).toBeGreaterThan(arpStepFor(step - 1, stepsPerBar));
      }
    }
  });
});

describe('type surface', () => {
  test('MeterId is assignable from every table key', () => {
    const ids: MeterId[] = [...METER_IDS];
    expect(ids.length).toBe(6);
  });
});
