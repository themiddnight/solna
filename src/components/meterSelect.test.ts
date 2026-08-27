import { describe, expect, test } from 'bun:test';
import {
  METER_OPTIONS,
  coerceMeterChoice,
  isMeterMismatch,
  patternMeterLabel,
  patternOptionLabel,
  patternMeterTitle,
} from './meterSelect';
import { METERS, METER_IDS } from '../utils/meter';

describe('METER_OPTIONS', () => {
  test('offers exactly the six meters, in table order', () => {
    expect(METER_OPTIONS.map((o) => o.value)).toEqual(METER_IDS);
    expect(METER_OPTIONS.length).toBe(6);
  });

  test('labels come from the table, so the select and the metronome cannot disagree', () => {
    for (const option of METER_OPTIONS) {
      expect(option.label).toBe(METERS[option.value].label);
    }
  });

  test('each title spells out the bar length and grouping', () => {
    expect(METER_OPTIONS[0].title).toBe('4/4 — 16 steps per bar, beats of 4+4+4+4');
    const sevenEight = METER_OPTIONS.find((o) => o.value === '7/8')!;
    expect(sevenEight.title).toBe('7/8 — 14 steps per bar, beats of 6+4+4');
    const sixEight = METER_OPTIONS.find((o) => o.value === '6/8')!;
    expect(sixEight.title).toBe('6/8 — 12 steps per bar, beats of 6+6');
  });

  test('3/4 and 6/8 are distinguishable from their titles alone', () => {
    const threeFour = METER_OPTIONS.find((o) => o.value === '3/4')!;
    const sixEight = METER_OPTIONS.find((o) => o.value === '6/8')!;
    expect(threeFour.title).not.toBe(sixEight.title);
  });
});

describe('coerceMeterChoice', () => {
  test('passes through every real id', () => {
    for (const id of METER_IDS) expect(coerceMeterChoice(id, '4/4')).toBe(id);
  });

  test('falls back to the current meter for junk rather than resetting to 4/4', () => {
    expect(coerceMeterChoice('9/8', '5/4')).toBe('5/4');
    expect(coerceMeterChoice('', '7/8')).toBe('7/8');
  });
});

describe('isMeterMismatch', () => {
  test('a pattern in the active meter is not a mismatch', () => {
    expect(isMeterMismatch('4/4', '4/4')).toBe(false);
    expect(isMeterMismatch('6/8', '6/8')).toBe(false);
  });

  test('3/4 and 6/8 are a mismatch despite sharing a bar length', () => {
    expect(isMeterMismatch('3/4', '6/8')).toBe(true);
    expect(isMeterMismatch('6/8', '3/4')).toBe(true);
  });

  test('an untagged pattern is treated as 4/4, exactly as playback treats it', () => {
    expect(isMeterMismatch(undefined, '4/4')).toBe(false);
    expect(isMeterMismatch(undefined, '3/4')).toBe(true);
  });
});

describe('patternMeterLabel', () => {
  test('shows just the meter when it matches', () => {
    expect(patternMeterLabel('4/4', '4/4')).toBe('4/4');
    expect(patternMeterLabel('3/4', '3/4')).toBe('3/4');
  });

  test('shows native → active when it differs', () => {
    expect(patternMeterLabel('4/4', '6/8')).toBe('4/4 → 6/8');
    expect(patternMeterLabel('3/4', '6/8')).toBe('3/4 → 6/8');
  });
});

describe('patternOptionLabel', () => {
  test('appends the meter to the pattern name with a middot', () => {
    expect(patternOptionLabel('Sustained', '4/4', '4/4')).toBe('Sustained · 4/4');
  });

  test('a differing pattern stays listed and says what it will become', () => {
    expect(patternOptionLabel('Sustained', '4/4', '3/4')).toBe('Sustained · 4/4 → 3/4');
  });
});

describe('patternMeterTitle', () => {
  test('a matching pattern says so plainly', () => {
    expect(patternMeterTitle('Waltz', '3/4', '3/4')).toBe(
      'Waltz — written in 3/4, the active meter',
    );
  });

  test('a longer source bar is trimmed', () => {
    expect(patternMeterTitle('Rock', '4/4', '3/4')).toBe(
      'Rock — written in 4/4; trimmed to fill a 3/4 bar of 12 steps',
    );
  });

  test('a shorter source bar is looped', () => {
    expect(patternMeterTitle('Waltz', '3/4', '5/4')).toBe(
      'Waltz — written in 3/4; looped to fill a 5/4 bar of 20 steps',
    );
  });

  test('THE 3/4 vs 6/8 CASE: same bar length, re-grouped rather than resized', () => {
    expect(patternMeterTitle('Waltz', '3/4', '6/8')).toBe(
      'Waltz — written in 3/4; same 12-step bar, re-grouped as 6+6',
    );
    expect(patternMeterTitle('Afro', '6/8', '3/4')).toBe(
      'Afro — written in 6/8; same 12-step bar, re-grouped as 4+4+4',
    );
  });
});
