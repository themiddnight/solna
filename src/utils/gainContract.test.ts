import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_UNITY_POS,
  DISPLAY_FLOOR_DBFS,
  FADER_MAX_DB,
  MAX_FADER_GAIN,
  SILENCE_DB,
  UNITY_DB,
  UNITY_GAIN,
  clampForDisplay,
  dbToGain,
  dbToSliderPos,
  sliderPosTodB,
  toDecibels,
} from './gainUnits';
import { ZONE_GOOD_MAX, ZONE_HOT_MAX, ZONE_TOO_QUIET_MAX, classifyZone } from './meterZones';
import { METER_SCALE_CEILING_DBFS, METER_TICK_DBFS, dbfsToPercent } from './meterScale';
import { TARGET_DBFS, TOLERANCE_DB } from './trimMath';

/**
 * The interop tripwire between solna and murva. These modules are COPIES, by
 * decision: two repos in two git roots, ~90 lines of pure arithmetic, and a
 * shared package would buy synchronisation at the price of a release process
 * and a version matrix in both. The price of the copy is that a constant can
 * move on one side in silence — projects would still import, just at the wrong
 * loudness — so this file is the thing that notices.
 *
 * Every expectation below is a LITERAL, with a comment naming the murva file it
 * mirrors. Never re-import a constant and compare it to itself: the whole value
 * here is that editing a constant makes a hard-coded number wrong, forcing a
 * human to decide whether murva is moving too.
 */
describe('pinned murva constants', () => {
  test('gainUnits scalars match murva src/shared/audio/gainUnits.ts', () => {
    expect(UNITY_DB).toBe(0); // murva gainUnits.ts: UNITY_DB
    expect(UNITY_GAIN).toBe(1); // murva gainUnits.ts: UNITY_GAIN
    expect(DISPLAY_FLOOR_DBFS).toBe(-60); // murva gainUnits.ts: DISPLAY_FLOOR_DBFS
    expect(DEFAULT_UNITY_POS).toBe(0.75); // murva gainUnits.ts: DEFAULT_UNITY_POS
  });

  test('the fader range is -60 .. +12 dB', () => {
    // murva gainUnits.ts: dbToSliderPos/sliderPosTodB default minDb = DISPLAY_FLOOR_DBFS,
    // maxDb = 12. Both ends pinned as literals so widening either is a visible edit.
    expect(DISPLAY_FLOOR_DBFS).toBe(-60);
    expect(FADER_MAX_DB).toBe(12);
  });

  test('MAX_FADER_GAIN stays DERIVED from the murva-owned fader top', () => {
    // The one deliberate inversion of this file's "never re-derive an
    // expectation from an import" rule, and the reason is that MAX_FADER_GAIN
    // is not a murva constant at all: murva's numbers table has no counterpart,
    // it is solna's own (DEV-386) linear ceiling for both engine clamps. Its
    // VALUE therefore cannot drift from murva independently — it can only move
    // if FADER_MAX_DB or dbToGain moves, and both are pinned as literals above,
    // so a second literal here would only fail twice for one cause.
    // What CAN drift in silence is the DERIVATION: replace the call with a
    // literal (a hand-restored 1.5, a rounded 4) and the ceiling detaches from
    // the fader range while FADER_MAX_DB still reads 12 and every literal pin
    // in this file still passes. Faders would show +12 dB and stop responding
    // partway, which is the exact dishonesty DEV-386 removed. So pin the
    // identity, not the number. DEV-386's src/utils/faderTaper.test.ts owns the
    // literal ~3.9810717; that is its pin to keep, not a duplicate to make here.
    expect(MAX_FADER_GAIN).toBe(dbToGain(toDecibels(FADER_MAX_DB)));
  });

  test('SILENCE_DB is a FINITE -60 here and -Infinity in murva (divergence 2)', () => {
    // Deliberate divergence, not drift: solna's levels cross JSON.stringify twice
    // (persist + the .solna body) and JSON.stringify(-Infinity) is null. -60 also
    // coincides with DISPLAY_FLOOR_DBFS, so the fader bottom and the silence value
    // are the same place. Do NOT "align" this with murva's -Infinity.
    expect(SILENCE_DB).toBe(-60);
    expect(Number.isFinite(SILENCE_DB)).toBe(true);
    expect(dbToGain(SILENCE_DB)).toBeCloseTo(0.001, 9); // 10 ** (-60 / 20), inaudible
  });

  test('meterZones boundaries match murva src/shared/audio/meterZones.ts', () => {
    expect(ZONE_TOO_QUIET_MAX).toBe(-24); // murva meterZones.ts: tooQuiet is < -24
    expect(ZONE_GOOD_MAX).toBe(-6); // murva meterZones.ts: good is -24 .. -6
    expect(ZONE_HOT_MAX).toBe(-1); // murva meterZones.ts: hot is -6 .. -1, over is >= -1
  });

  test('meterScale ceiling and ticks match murva src/shared/audio/meterScale.ts', () => {
    expect(METER_SCALE_CEILING_DBFS).toBe(6); // murva meterScale.ts: METER_SCALE_CEILING_DBFS
    expect([...METER_TICK_DBFS]).toEqual([-24, -6, 0]); // murva meterScale.ts: METER_TICK_DBFS
  });

  test('calibration target matches murva calibration/trimMath.ts', () => {
    expect(TARGET_DBFS).toBe(-18); // murva trimMath.ts: TARGET_DBFS
    expect(TOLERANCE_DB).toBe(3); // murva trimMath.ts: TOLERANCE_DB
  });
});

/**
 * A formula drifts without any named constant changing: the meter scale's
 * interior breakpoints (-48 dBFS, 5%, 30%) are module-private in murva and
 * likely private here too, and the taper's two segments are arithmetic with no
 * constant of their own. So the behaviour is pinned at the points where a
 * reshape shows up, again as literals.
 */
describe('pinned murva behaviour', () => {
  test('dbfsToPercent draws murva meterScale.ts three segments', () => {
    // murva meterScale.ts: <=-60 -> 0, -60..-48 -> 0..5, -48..-24 -> 5..30, -24..+6 -> 30..100
    expect(dbfsToPercent(-60)).toBe(0); // the floor
    expect(dbfsToPercent(-48)).toBeCloseTo(5, 9); // first knee
    expect(dbfsToPercent(-24)).toBeCloseTo(30, 9); // second knee
    expect(dbfsToPercent(0)).toBeCloseTo(86, 9); // digital ceiling, interpolated
    expect(dbfsToPercent(6)).toBe(100); // METER_SCALE_CEILING_DBFS
  });

  test('dbfsToPercent interpolates linearly inside each segment', () => {
    // Midpoints. A single linear -60..0 mapping would put -36 at 40 and -6 at 90;
    // these three numbers are what make the scale piecewise rather than straight.
    expect(dbfsToPercent(-54)).toBeCloseTo(2.5, 9); // half of -60..-48
    expect(dbfsToPercent(-36)).toBeCloseTo(17.5, 9); // half of -48..-24
    expect(dbfsToPercent(-6)).toBeCloseTo(72, 9); // 60% of -24..+6
  });

  test('dbfsToPercent saturates outside the track and survives -Infinity', () => {
    expect(dbfsToPercent(-100)).toBe(0);
    expect(dbfsToPercent(20)).toBe(100);
    expect(dbfsToPercent(-Infinity)).toBe(0); // a transient silent meter reading
    expect(dbfsToPercent(Infinity)).toBe(100);
  });

  test('the taper puts unity at 0.75 and holds murva gainUnits.ts endpoints', () => {
    expect(dbToSliderPos(0)).toBe(0.75); // 0 dB sits at DEFAULT_UNITY_POS
    expect(dbToSliderPos(-60)).toBe(0); // bottom of the fader
    expect(dbToSliderPos(12)).toBe(1); // top of the fader
    expect(dbToSliderPos(-30)).toBeCloseTo(0.375, 9); // half the lower segment
    expect(dbToSliderPos(-6)).toBeCloseTo(0.675, 9); // lower segment, linear in dB
    expect(dbToSliderPos(6)).toBeCloseTo(0.875, 9); // half the upper segment
  });

  test('sliderPosTodB is the taper read backwards', () => {
    expect(sliderPosTodB(0)).toBe(-60);
    expect(sliderPosTodB(0.75)).toBeCloseTo(0, 9);
    expect(sliderPosTodB(1)).toBe(12);
    expect(sliderPosTodB(0.375)).toBeCloseTo(-30, 9);
    expect(sliderPosTodB(0.875)).toBeCloseTo(6, 9);
  });

  test('the taper round-trips at the calibration target and either side of unity', () => {
    for (const db of [-60, -18, -6, 0, 6, 12]) {
      expect(sliderPosTodB(dbToSliderPos(db))).toBeCloseTo(db, 9);
    }
  });

  test('classifyZone splits on murva meterZones.ts boundaries, exclusive at the top', () => {
    expect(classifyZone(-25)).toBe('tooQuiet');
    expect(classifyZone(-24)).toBe('good'); // boundary belongs to the zone above
    expect(classifyZone(-7)).toBe('good');
    expect(classifyZone(-6)).toBe('hot');
    expect(classifyZone(-2)).toBe('hot');
    expect(classifyZone(-1)).toBe('over');
    expect(classifyZone(0)).toBe('over');
  });

  test('clampForDisplay lifts a silent reading to the display floor', () => {
    expect(clampForDisplay(-Infinity)).toBe(-60); // murva gainUnits.ts: clampForDisplay
    expect(clampForDisplay(-90)).toBe(-60);
    expect(clampForDisplay(-12)).toBe(-12);
  });
});
