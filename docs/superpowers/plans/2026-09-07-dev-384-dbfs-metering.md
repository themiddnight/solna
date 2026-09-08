# DEV-384: True dBFS peak/RMS metering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `getAudioLevel()`'s spectrum average with real peak + windowed-RMS dBFS metering, tapped post-fader/pre-limiter, drawn on a piecewise dB scale, with a tiered scheduler so hidden tabs stop reading analysers. This issue lands the metering **wiring** and an honest reading for the two metering surfaces that already exist — `VuMeter` and `AmbientBackdrop`. The meter's visual design, and the placement of a per-source meter beside each channel strip, are **DEV-389 "Design and place the meter and fader UI on the dBFS wiring"** (parent DEV-383; depends on this issue and on DEV-386).

**Architecture:** Four pure modules in `src/utils/` carry the arithmetic — `gainUnits.ts` (dB↔linear, branded units), `meterZones.ts` (`classifyZone`), `meterScale.ts` (`dbfsToPercent`, piecewise), `meterLevel.ts` (per-tick peak/mean-square, rolling-RMS ring buffer, decaying peak-hold). A fifth, `meterColor.ts`, maps a zone to a theme token, so this issue's segments and the readouts DEV-389 and DEV-385 will draw name the same four colours. A side-effecting singleton `meterScheduler.ts` owns one rAF loop and ticks each registration at its tier's cadence, pausing any registration whose observed element is not intersecting. `meterAttach.ts` composes tracker + scheduler into one `attachMeter()` call that is testable with no DOM; `components/ui/useMeterLevel.ts` is a thin React wrapper over it that takes an `AnalyserNode | null`, so a master analyser and a per-source analyser are read by exactly the same path. The engine grows a dedicated `levelAnalyser` fed by an observe-only send from `masterGain` (post-fader, pre-limiter) and loses `getAudioLevel()`. `MeterBar` is a provisional presentation shim whose only job is to prove the dBFS path draws; DEV-389 replaces it.

**Tech Stack:** TypeScript, React 19, Bun test, raw Web Audio API, daisyUI/Tailwind theme tokens.

**Spec:** Linear DEV-384; shared contract at `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`

## Global Constraints

- `bun run verify` is the gate; `bun run eslint` must report **nothing at all** — no errors and no warnings.
- All four tab views stay mounted (`App.tsx` toggles `block`/`hidden`), so anything per-frame must be pausable per view.
- **No meter value may enter a zustand slice.** A store write per frame re-renders every mounted view.
- Engine setters are called only from `src/store/engineSync.ts`, never from a component (layering rule 3). Read-only analyser consumers are the named exemption list in `eslint.config.js`.
- `src/audio/` keeps receiving linear gain; no engine setter signature changes here.
- `src/data/` files are independent leaves — these modules declare functions, so they go in `src/utils/`, never `src/data/`.
- `localStorage` can throw, not just return null. (Nothing in this plan persists; no persist `version` and no `.solna` `formatVersion` moves.)
- Testing trap: roughly a third of the suite renders through `renderToString`, and zustand wires `getServerSnapshot` to the store's creation-time state. Prefer exporting pure logic and testing the function (`.claude/rules/testing.md`).
- Read `.claude/skills/dsp-audio/SKILL.md` before Task 7 (signal routing).
- `UNITY_DB` = `0`. `UNITY_GAIN` = `1`. `SILENCE_DB` = `-60` (solna divergence 2 — `JSON.stringify(-Infinity)` is `null`). `DISPLAY_FLOOR_DBFS` = `-60`. `FADER_MAX_DB` = `+12`. `DEFAULT_UNITY_POS` = `0.75`. Fader range `-60 .. +12` dB.
- `ZONE_TOO_QUIET_MAX` = `-24` (`tooQuiet` is `< -24`). `ZONE_GOOD_MAX` = `-6` (`good` is `-24 .. -6`). `ZONE_HOT_MAX` = `-1` (`hot` is `-6 .. -1`, `over` is `>= -1`).
- Meter scale, piecewise: `<= -60` → `0`; `-60 .. -48` → `0 .. 5`; `-48 .. -24` → `5 .. 30`; `-24 .. +6` → `30 .. 100`. `METER_SCALE_CEILING_DBFS = 6`. `METER_TICK_DBFS = [-24, -6, 0]`.
- `PEAK_DECAY_DB_PER_SEC` = `14`. `DEFAULT_RMS_WINDOW_MS` = `300`. `LEVEL_EPSILON_DB` = `0.1`. Tier `master` = `1000 / 60` ms, tier `track` = `1000 / 30` ms, tier `offscreen` = `Infinity`. `TICK_EPSILON_MS` = `1`.
- No Zod. Plain TS branded aliases, keeping the `Decibels` (RELATIVE, `0` = unity, may be ±) vs `Dbfs` (ABSOLUTE, `0` = ceiling) distinction.
- solna's tiers are `master` / `track` / `offscreen`. murva's `glow` tier is dropped.
- Branch: `feat/dev-384-dbfs-metering`. Conventional commits.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/utils/gainUnits.ts` | Branded `Decibels`/`Dbfs`/`LinearGain`/`Velocity`, the unity/silence/floor constants, dB↔linear conversion, fader taper, `formatDb`. Pure; no runtime imports. |
| `src/utils/gainUnits.test.ts` | Round-trips, taper endpoints, `formatDb` shapes, the `-60` silence divergence. |
| `src/utils/meterZones.ts` | `MeterZone` union, the three zone constants, `classifyZone`. Pure; no runtime imports. |
| `src/utils/meterZones.test.ts` | Every boundary, on both sides, including the exclusive/inclusive edges. |
| `src/utils/meterColor.ts` | `meterZoneClass` — the zone → theme-token map DEV-389's meter and DEV-385's gain-reduction readout both draw from. Imports `meterZones` for the type only. |
| `src/utils/meterColor.test.ts` | All four zones map to a token; the three tones the segment map also produces agree with it. |
| `src/utils/meterScale.ts` | `dbfsToPercent` (three linear segments), `METER_SCALE_CEILING_DBFS`, `METER_TICK_DBFS`. Imports `gainUnits` + `meterZones`. |
| `src/utils/meterScale.test.ts` | Breakpoints, segment interiors, monotonicity, infinities. |
| `src/utils/meterLevel.ts` | `bufferPeakDbfs`, `bufferMeanSquare`, the rolling-RMS ring buffer, peak-hold decay, dead-zone guard, `createLevelTracker`. Pure (no timers, no rAF, no analyser). |
| `src/utils/meterLevel.test.ts` | Known-amplitude buffers → expected dBFS; RMS window averaging in the power domain; decay; dead-zone suppression. |
| `src/utils/meterScheduler.ts` | One rAF loop, tiered cadence, `TICK_EPSILON_MS`, per-element `IntersectionObserver` sharing, document-visibility gate, test hooks. |
| `src/utils/meterScheduler.test.ts` | Tier cadence, epsilon tolerance, visibility pausing, unregister, throwing `onTick` does not kill the loop. |
| `src/utils/meterAttach.ts` | `attachMeter()` — the composition of tracker + scheduler that the React hook performs, extracted so it is testable without a DOM. |
| `src/utils/meterAttach.test.ts` | Full-scale sine through a fake analyser → `peakDbfs ≈ 0`, `rmsDbfs ≈ -3`; half amplitude → `peakDbfs ≈ -6`; hidden element → no ticks. |
| `src/components/ui/useMeterLevel.ts` | React hook over `attachMeter`; takes `AnalyserNode \| null` as a parameter, so it needs **no** eslint exemption. |
| `src/components/ui/MeterBar.tsx` | **Provisional** segment bar for `VuMeter` — placeholder presentation that DEV-389 replaces. No engine import. |
| `src/components/ui/MeterBar.test.tsx` | `renderToString` assertions on lit/unlit segments and zone classes. |

**Modified**

| Path | Change |
|---|---|
| `src/audio/engine.ts` | Add `levelAnalyser` field + `getMasterLevelAnalyser()`; move the analyser tap to an observe-only send from `masterGain`; `masterGain → limiter → destination`; delete `getAudioLevel()` and `levelBuffer`. |
| `src/audio/engine.test.ts` | Update the master-chain wiring assertions (~line 563-593) and add a level-analyser assertion. |
| `src/utils/vuMeter.ts` | Re-key from a 0..1 level to dBFS: `vuSegment(dbfs)` via `dbfsToPercent`, plus `segmentTone(index)` derived from the zone constants. |
| `src/utils/vuMeter.test.ts` | Re-keyed from 0..1 segments to dB. |
| `src/components/ui/VuMeter.tsx` | Reads `getMasterLevelAnalyser()`, uses `useMeterLevel` at tier `master`/`offscreen`, draws through `MeterBar`. |
| `src/components/ui/AmbientBackdrop.tsx` | Replaces `getAudioLevel()` with an RMS-dBFS reading mapped through `dbfsToPercent`, written to a ref by the scheduler (no re-render). |

**Not touched here.** No view file gains a meter, and `eslint.config.js` needs no new exemption:
`VuMeter` and `AmbientBackdrop` are already on the layering-rule-3 list, and `useMeterLevel` takes
its `AnalyserNode` as a parameter so it never needs one. Both are DEV-389's to change.

---

### Task 1: `gainUnits.ts` — the unit layer

**Files:**
- Create: `src/utils/gainUnits.ts`
- Test: `src/utils/gainUnits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Decibels`, `type Dbfs`, `type LinearGain`, `type Velocity`; `toDecibels(value: number): Decibels`, `toDbfs(value: number): Dbfs`, `toLinearGain(value: number): LinearGain`, `toVelocity(value: number): Velocity`; `UNITY_DB: Decibels`, `UNITY_GAIN: LinearGain`, `SILENCE_DB: Decibels`, `DISPLAY_FLOOR_DBFS: number`, `FADER_MAX_DB: number`, `DEFAULT_UNITY_POS: number`; `dbToGain(db: Decibels): LinearGain`, `gainToDb(gain: LinearGain): Decibels`, `gainToDbfs(gain: LinearGain): Dbfs`, `clampForDisplay(value: number, floor?: number): number`, `dbToSliderPos(db: number, minDb?: number, maxDb?: number, unityPos?: number): number`, `sliderPosTodB(pos: number, minDb?: number, maxDb?: number, unityPos?: number): Decibels`, `formatDb(db: number): string`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/gainUnits.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  clampForDisplay,
  dbToGain,
  dbToSliderPos,
  DEFAULT_UNITY_POS,
  DISPLAY_FLOOR_DBFS,
  FADER_MAX_DB,
  formatDb,
  gainToDb,
  gainToDbfs,
  SILENCE_DB,
  sliderPosTodB,
  toDecibels,
  toLinearGain,
  UNITY_DB,
  UNITY_GAIN,
} from './gainUnits';

describe('constants', () => {
  test('unity is 0 dB and 1.0 linear', () => {
    expect(UNITY_DB).toBe(0);
    expect(UNITY_GAIN).toBe(1);
  });

  test('silence is a finite -60, never -Infinity, because it is JSON.stringify-ed twice', () => {
    expect(SILENCE_DB).toBe(-60);
    expect(Number.isFinite(SILENCE_DB)).toBe(true);
    expect(JSON.parse(JSON.stringify({ db: SILENCE_DB })).db).toBe(-60);
  });

  test('the display floor and the silence value are the same place', () => {
    expect(DISPLAY_FLOOR_DBFS).toBe(-60);
    expect(DISPLAY_FLOOR_DBFS).toBe(SILENCE_DB as number);
  });

  test('the fader tops out at +12 with unity three quarters up', () => {
    expect(FADER_MAX_DB).toBe(12);
    expect(DEFAULT_UNITY_POS).toBe(0.75);
  });
});

describe('dbToGain / gainToDb', () => {
  test('unity round-trips', () => {
    expect(dbToGain(UNITY_DB)).toBeCloseTo(1, 12);
    expect(gainToDb(UNITY_GAIN)).toBeCloseTo(0, 12);
  });

  test('-6 dB halves, +6 dB doubles', () => {
    expect(dbToGain(toDecibels(-6))).toBeCloseTo(0.5012, 4);
    expect(dbToGain(toDecibels(6))).toBeCloseTo(1.9953, 4);
  });

  test('stored silence is inaudible but not zero', () => {
    expect(dbToGain(SILENCE_DB)).toBeCloseTo(0.001, 9);
  });

  test('round-trips an arbitrary value', () => {
    expect(gainToDb(dbToGain(toDecibels(-18)))).toBeCloseTo(-18, 10);
  });
});

describe('gainToDbfs', () => {
  test('full scale is 0 dBFS', () => {
    expect(gainToDbfs(toLinearGain(1))).toBeCloseTo(0, 12);
  });

  test('half amplitude is about -6 dBFS', () => {
    expect(gainToDbfs(toLinearGain(0.5))).toBeCloseTo(-6.0206, 4);
  });

  test('a sine RMS of 1/sqrt(2) is about -3 dBFS', () => {
    expect(gainToDbfs(toLinearGain(Math.SQRT1_2))).toBeCloseTo(-3.0103, 4);
  });

  test('zero gain is -Infinity, which is legal in a transient reading', () => {
    expect(gainToDbfs(toLinearGain(0))).toBe(-Infinity);
  });
});

describe('clampForDisplay', () => {
  test('lifts -Infinity to the display floor', () => {
    expect(clampForDisplay(-Infinity)).toBe(-60);
  });

  test('leaves a value above the floor alone', () => {
    expect(clampForDisplay(-12)).toBe(-12);
  });

  test('honours an explicit floor', () => {
    expect(clampForDisplay(-90, -48)).toBe(-48);
  });
});

describe('dbToSliderPos / sliderPosTodB', () => {
  test('unity sits at the default unity position', () => {
    expect(dbToSliderPos(0)).toBeCloseTo(0.75, 12);
    expect(sliderPosTodB(0.75)).toBeCloseTo(0, 12);
  });

  test('the ends are the ends', () => {
    expect(dbToSliderPos(-60)).toBe(0);
    expect(dbToSliderPos(12)).toBe(1);
    expect(sliderPosTodB(0)).toBe(-60);
    expect(sliderPosTodB(1)).toBe(12);
  });

  test('below the floor and -Infinity both pin to zero', () => {
    expect(dbToSliderPos(-120)).toBe(0);
    expect(dbToSliderPos(-Infinity)).toBe(0);
  });

  test('round-trips inside each half of the taper', () => {
    expect(sliderPosTodB(dbToSliderPos(-24))).toBeCloseTo(-24, 10);
    expect(sliderPosTodB(dbToSliderPos(6))).toBeCloseTo(6, 10);
  });

  test('a position outside 0..1 clamps rather than extrapolating', () => {
    expect(sliderPosTodB(-2)).toBe(-60);
    expect(sliderPosTodB(9)).toBe(12);
  });
});

describe('formatDb', () => {
  test('renders one decimal with a unit', () => {
    expect(formatDb(0)).toBe('0.0 dB');
    expect(formatDb(-6)).toBe('-6.0 dB');
    expect(formatDb(3.14159)).toBe('3.1 dB');
  });

  test('negative zero prints as zero, not "-0.0 dB"', () => {
    expect(formatDb(-0)).toBe('0.0 dB');
  });

  test('the infinities and NaN read as silence or ceiling, never "NaN dB"', () => {
    expect(formatDb(-Infinity)).toBe('-∞ dB');
    expect(formatDb(Infinity)).toBe('+∞ dB');
    expect(formatDb(Number.NaN)).toBe('-∞ dB');
    // The finite silence sentinel renders as silence, not as its number — the fader's bottom
    // detent and true silence are the same place (contract divergence 2).
    expect(formatDb(SILENCE_DB)).toBe('-∞ dB');
    expect(formatDb(-59.9)).toBe('-59.9 dB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/gainUnits.test.ts`
Expected: FAIL with `error: Cannot find module './gainUnits' from '/Users/Pathompong/Sites/Personal/solna/src/utils/gainUnits.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/gainUnits.ts`:

```ts
/**
 * Canonical dB/linear-gain conversion for the whole app. Ported from murva's
 * `src/shared/audio/gainUnits.ts`; the numbers are an interop contract with that repo and are
 * copied, never re-derived (see the DEV-383 contract's "The numbers" table).
 *
 * Two dB types exist and must never be assigned to each other:
 *   - `Decibels`: RELATIVE — a fader/trim/pre-gain value. 0 = unity (untouched), may be ±.
 *   - `Dbfs`:     ABSOLUTE — a meter reading against digital full scale. 0 = ceiling.
 * `LinearGain` is the raw multiplier written to a Web Audio AudioParam. Conversion to linear
 * happens ONLY at the moment of writing to an AudioParam.
 *
 * murva brands these with Zod. solna has no Zod and is not adding one for ninety lines of
 * arithmetic, so the brands are plain TS intersections. The naming distinction is the part that
 * carries meaning and it is kept exactly.
 */

export type Decibels = number & { readonly __brand: 'Decibels' };
export type Dbfs = number & { readonly __brand: 'Dbfs' };
export type LinearGain = number & { readonly __brand: 'LinearGain' };

/**
 * A per-hit PERFORMANCE attribute, 0..1 — how hard a note or drum was struck. Deliberately a
 * DIFFERENT brand from the three above, so a fader value and a velocity cannot be assigned to
 * each other by accident. The rule, in both directions: a fader value is never passed into a
 * velocity parameter, and a velocity is never written to a gain node a fader owns. See the
 * epic's decision D-383-3 — `masterSequencerVolume` was doing exactly the first of those, which
 * made the drum fader's law `volume²`.
 */
export type Velocity = number & { readonly __brand: 'Velocity' };

/** Unchecked casts. These are the only place a raw number becomes a branded one. */
export const toDecibels = (value: number): Decibels => value as Decibels;
export const toDbfs = (value: number): Dbfs => value as Dbfs;
export const toLinearGain = (value: number): LinearGain => value as LinearGain;
export const toVelocity = (value: number): Velocity => value as Velocity;

export const UNITY_DB: Decibels = toDecibels(0);
export const UNITY_GAIN: LinearGain = toLinearGain(1);

/**
 * UI display floor, and — deliberately — the same place as stored silence.
 *
 * murva's canonical silence is `-Infinity`, which survives its Zod socket boundary. solna's
 * values go through `JSON.stringify` twice (the persist payload and the `.solna` body) and
 * `JSON.stringify(-Infinity)` is `null`, so a stored `-Infinity` comes back as a hole. Stored
 * silence is therefore a finite `-60`: `dbToGain(-60)` is `0.001`, inaudible, and it lands
 * exactly on the fader's bottom so "silent" and "fader all the way down" are one position
 * rather than two. `-Infinity` stays legal in TRANSIENT meter readings, which are never
 * serialised.
 */
export const DISPLAY_FLOOR_DBFS = -60;
export const SILENCE_DB: Decibels = toDecibels(DISPLAY_FLOOR_DBFS);

export const FADER_MAX_DB = 12;
export const DEFAULT_UNITY_POS = 0.75;

/**
 * Silence at 0 gain and -Infinity dB fall out of these formulas naturally
 * (`Math.pow(10, -Infinity / 20) === 0`, `Math.log10(0) === -Infinity`) — no special-casing.
 */
export const dbToGain = (db: Decibels): LinearGain => toLinearGain(Math.pow(10, db / 20));

export const gainToDb = (gain: LinearGain): Decibels => toDecibels(20 * Math.log10(gain));

export const gainToDbfs = (gain: LinearGain): Dbfs => toDbfs(20 * Math.log10(gain));

/**
 * Lifts a reading to the display floor so meter consumers never have to special-case
 * `-Infinity`. Display only — never for a stored value, which uses `SILENCE_DB`.
 */
export const clampForDisplay = (value: number, floor: number = DISPLAY_FLOOR_DBFS): number =>
  Math.max(floor, value);

/**
 * Maps a dB value (-60..+12) to a normalised slider position (0..1) with a DAW-style piecewise
 * taper that puts 0 dB at `unityPos` (default 0.75), so the useful range gets three quarters of
 * the travel and the boost range gets the last quarter.
 */
export const dbToSliderPos = (
  db: number,
  minDb: number = DISPLAY_FLOOR_DBFS,
  maxDb: number = FADER_MAX_DB,
  unityPos: number = DEFAULT_UNITY_POS,
): number => {
  if (!Number.isFinite(db) || db <= minDb) return 0;
  if (db >= maxDb) return 1;
  if (db <= 0) return ((db - minDb) / (0 - minDb)) * unityPos;
  return unityPos + (db / maxDb) * (1 - unityPos);
};

/** The inverse of `dbToSliderPos`; a position outside 0..1 clamps rather than extrapolating. */
export const sliderPosTodB = (
  pos: number,
  minDb: number = DISPLAY_FLOOR_DBFS,
  maxDb: number = FADER_MAX_DB,
  unityPos: number = DEFAULT_UNITY_POS,
): Decibels => {
  const clampedPos = Math.max(0, Math.min(1, pos));
  if (clampedPos <= 0) return toDecibels(minDb);
  if (clampedPos >= 1) return toDecibels(maxDb);
  if (clampedPos <= unityPos) {
    return toDecibels(minDb + (clampedPos / unityPos) * (0 - minDb));
  }
  return toDecibels(((clampedPos - unityPos) / (1 - unityPos)) * maxDb);
};

/**
 * One decimal and a unit, with the non-finite cases spelled rather than leaked. NaN reads as
 * silence: a meter that has never seen a sample should say "-∞ dB", not "NaN dB".
 */
export const formatDb = (db: number): string => {
  // The contract's rendering, and the fader's bottom detent reads the same as true silence:
  // SILENCE_DB is the finite -60 sentinel, so it must render '-∞ dB' too, not '-60.0 dB'.
  if (Number.isNaN(db) || db === -Infinity || db <= SILENCE_DB) return '-∞ dB';
  if (db === Infinity) return '+∞ dB';
  // `-0` would otherwise print as "-0.0 dB" on engines that preserve the sign.
  const value = db === 0 ? 0 : db;
  return `${value.toFixed(1)} dB`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/gainUnits.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/dev-384-dbfs-metering
git add src/utils/gainUnits.ts src/utils/gainUnits.test.ts
git commit -m "feat(meter): add the dB/linear unit layer with branded Decibels and Dbfs

Ported from murva's shared/audio/gainUnits.ts. Zod branding is dropped for
plain TS intersections; the Decibels (relative) vs Dbfs (absolute) naming
distinction is kept because that is the part that carries meaning. Stored
silence is a finite -60 rather than murva's -Infinity: solna's values are
JSON.stringify-ed twice and -Infinity serialises to null.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 2: `meterZones.ts` — zone classification

**Files:**
- Create: `src/utils/meterZones.ts`
- Test: `src/utils/meterZones.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type MeterZone = 'tooQuiet' | 'good' | 'hot' | 'over'`; `ZONE_TOO_QUIET_MAX: number` (`-24`), `ZONE_GOOD_MAX: number` (`-6`), `ZONE_HOT_MAX: number` (`-1`); `classifyZone(peakDbfs: number): MeterZone`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/meterZones.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  classifyZone,
  ZONE_GOOD_MAX,
  ZONE_HOT_MAX,
  ZONE_TOO_QUIET_MAX,
} from './meterZones';

describe('zone constants', () => {
  test('are the contract values and nothing else', () => {
    expect(ZONE_TOO_QUIET_MAX).toBe(-24);
    expect(ZONE_GOOD_MAX).toBe(-6);
    expect(ZONE_HOT_MAX).toBe(-1);
  });
});

describe('classifyZone', () => {
  test('below -24 is tooQuiet', () => {
    expect(classifyZone(-60)).toBe('tooQuiet');
    expect(classifyZone(-24.0001)).toBe('tooQuiet');
    expect(classifyZone(-Infinity)).toBe('tooQuiet');
  });

  test('-24 itself is already good — the boundary is inclusive upward', () => {
    expect(classifyZone(-24)).toBe('good');
  });

  test('-24 up to -6 is good', () => {
    expect(classifyZone(-18)).toBe('good');
    expect(classifyZone(-6.0001)).toBe('good');
  });

  test('-6 itself is already hot', () => {
    expect(classifyZone(-6)).toBe('hot');
  });

  test('-6 up to -1 is hot', () => {
    expect(classifyZone(-3)).toBe('hot');
    expect(classifyZone(-1.0001)).toBe('hot');
  });

  test('-1 and above is over, which is only reachable with a pre-limiter tap', () => {
    expect(classifyZone(-1)).toBe('over');
    expect(classifyZone(0)).toBe('over');
    expect(classifyZone(3)).toBe('over');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/meterZones.test.ts`
Expected: FAIL with `error: Cannot find module './meterZones' from '/Users/Pathompong/Sites/Personal/solna/src/utils/meterZones.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/meterZones.ts`:

```ts
/**
 * The four bands a meter reading falls into. Ported verbatim from murva's
 * `src/shared/audio/meterZones.ts` — these boundaries are an interop contract with that repo
 * (DEV-383 "The numbers"), so they are copied, never re-argued here.
 *
 * Every boundary is INCLUSIVE UPWARD: -24 is already `good`, -6 is already `hot`, -1 is already
 * `over`. Written as a descending ladder of `<` tests so there is exactly one place each edge
 * can sit.
 */
export type MeterZone = 'tooQuiet' | 'good' | 'hot' | 'over';

export const ZONE_TOO_QUIET_MAX = -24;
export const ZONE_GOOD_MAX = -6;
export const ZONE_HOT_MAX = -1;

export function classifyZone(peakDbfs: number): MeterZone {
  if (peakDbfs < ZONE_TOO_QUIET_MAX) return 'tooQuiet';
  if (peakDbfs < ZONE_GOOD_MAX) return 'good';
  if (peakDbfs < ZONE_HOT_MAX) return 'hot';
  return 'over';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/meterZones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/meterZones.ts src/utils/meterZones.test.ts
git commit -m "feat(meter): classify a dBFS reading into tooQuiet/good/hot/over

Boundaries copied from murva's meterZones.ts: tooQuiet < -24, good -24..-6,
hot -6..-1, over >= -1. Every edge is inclusive upward.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 3: `meterScale.ts` — the piecewise display scale

**Files:**
- Create: `src/utils/meterScale.ts`
- Test: `src/utils/meterScale.test.ts`

**Interfaces:**
- Consumes: `DISPLAY_FLOOR_DBFS` from `src/utils/gainUnits.ts`; `ZONE_TOO_QUIET_MAX`, `ZONE_GOOD_MAX` from `src/utils/meterZones.ts`.
- Produces: `METER_SCALE_CEILING_DBFS: number` (`6`), `METER_TICK_DBFS: readonly number[]` (`[-24, -6, 0]`), `dbfsToPercent(dbfs: number): number` (0..100).

- [ ] **Step 1: Write the failing test**

Create `src/utils/meterScale.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { dbfsToPercent, METER_SCALE_CEILING_DBFS, METER_TICK_DBFS } from './meterScale';

describe('scale constants', () => {
  test('the ceiling is +6 dBFS, so 0 dBFS is not on the bar edge', () => {
    expect(METER_SCALE_CEILING_DBFS).toBe(6);
  });

  test('the ticks are the two zone edges plus the digital ceiling', () => {
    expect([...METER_TICK_DBFS]).toEqual([-24, -6, 0]);
  });
});

describe('dbfsToPercent breakpoints', () => {
  test('the display floor and everything under it is 0%', () => {
    expect(dbfsToPercent(-60)).toBeCloseTo(0, 10);
    expect(dbfsToPercent(-120)).toBeCloseTo(0, 10);
    expect(dbfsToPercent(-Infinity)).toBeCloseTo(0, 10);
  });

  test('-48 dBFS is the first knee at 5%', () => {
    expect(dbfsToPercent(-48)).toBeCloseTo(5, 10);
  });

  test('-24 dBFS is the second knee at 30%', () => {
    expect(dbfsToPercent(-24)).toBeCloseTo(30, 10);
  });

  test('the ceiling is 100%', () => {
    expect(dbfsToPercent(6)).toBeCloseTo(100, 10);
    expect(dbfsToPercent(12)).toBeCloseTo(100, 10);
    expect(dbfsToPercent(Infinity)).toBeCloseTo(100, 10);
  });
});

describe('dbfsToPercent segment interiors', () => {
  test('the bottom segment is linear from -60..-48 onto 0..5', () => {
    expect(dbfsToPercent(-54)).toBeCloseTo(2.5, 10);
  });

  test('the middle segment is linear from -48..-24 onto 5..30', () => {
    expect(dbfsToPercent(-36)).toBeCloseTo(17.5, 10);
  });

  test('the top segment is linear from -24..+6 onto 30..100', () => {
    expect(dbfsToPercent(-6)).toBeCloseTo(72, 10);
    expect(dbfsToPercent(0)).toBeCloseTo(86, 10);
  });

  test('0 dBFS sits well inside the bar, not on its edge', () => {
    expect(dbfsToPercent(0)).toBeLessThan(100);
    expect(dbfsToPercent(0)).toBeGreaterThan(80);
  });
});

describe('dbfsToPercent shape', () => {
  test('is monotonically non-decreasing across the whole range', () => {
    let previous = -1;
    for (let db = -70; db <= 10; db += 0.25) {
      const percent = dbfsToPercent(db);
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
  });

  test('never leaves 0..100', () => {
    for (let db = -200; db <= 60; db += 1) {
      const percent = dbfsToPercent(db);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });

  test('gives the good..over range more travel than the bottom 36 dB', () => {
    const bottom36 = dbfsToPercent(-24) - dbfsToPercent(-60);
    const top30 = dbfsToPercent(6) - dbfsToPercent(-24);
    expect(top30).toBeGreaterThan(bottom36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/meterScale.test.ts`
Expected: FAIL with `error: Cannot find module './meterScale' from '/Users/Pathompong/Sites/Personal/solna/src/utils/meterScale.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/meterScale.ts`:

```ts
import { DISPLAY_FLOOR_DBFS } from './gainUnits';
import { ZONE_GOOD_MAX, ZONE_TOO_QUIET_MAX } from './meterZones';

/**
 * The meter's display scale, ported from murva's `src/shared/audio/meterScale.ts`. Three linear
 * segments, not one:
 *
 *   -inf .. -48 dBFS  ->   0 -  5% of the track
 *   -48  .. -24       ->   5 - 30%
 *   -24  ..  +6       ->  30 - 100%
 *
 * A single linear -60..0 mapping spends 60% of the track on a zone with no decision in it, puts
 * 0 dBFS exactly on the bar's edge (indistinguishable from the bar simply ending), and squeezes
 * the whole `over` zone into 1.7%. Professional meters are piecewise for this reason — IEC
 * 60268-18 specifies a piecewise digital PPM scale — and the principle is always the same:
 * resolution where decisions are made, compression where nothing is actionable.
 */

// Module-private: nothing outside needs the interior breakpoints, and exporting them would
// leave two exports nothing imports.
const METER_SCALE_KNEE_DBFS = ZONE_TOO_QUIET_MAX; // -24
const METER_SCALE_FLOOR_DBFS = -48;

export const METER_SCALE_CEILING_DBFS = 6;

const FLOOR_PERCENT = 5;
const KNEE_PERCENT = 30;

/**
 * The ticks a scale draws. Two of the three are IMPORTED from `meterZones.ts` rather than
 * re-typed, so if `classifyZone`'s boundaries ever move these ticks move with them instead of
 * going stale. The third, `0`, is not a zone boundary at all (the hot->over edge is
 * `ZONE_HOT_MAX` = -1); it marks the digital ceiling, a landmark a meter always wants shown.
 * `ZONE_HOT_MAX` itself is deliberately absent: it sits 1.7% from 0 and the two lines collide.
 */
export const METER_TICK_DBFS: readonly number[] = [ZONE_TOO_QUIET_MAX, ZONE_GOOD_MAX, 0];

/** Maps `from`..`to` onto `fromPercent`..`toPercent`, linearly. */
function interpolate(
  value: number,
  from: number,
  to: number,
  fromPercent: number,
  toPercent: number,
): number {
  return fromPercent + ((value - from) / (to - from)) * (toPercent - fromPercent);
}

/**
 * The single source of truth for turning a dBFS reading into a position along the track. Fills,
 * ticks, markers and the transport meter's segment quantisation all go through here, so they
 * can never disagree about where a given dB value sits.
 */
export function dbfsToPercent(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return dbfs > 0 ? 100 : 0;
  if (dbfs <= DISPLAY_FLOOR_DBFS) return 0;
  if (dbfs >= METER_SCALE_CEILING_DBFS) return 100;

  if (dbfs <= METER_SCALE_FLOOR_DBFS) {
    return interpolate(dbfs, DISPLAY_FLOOR_DBFS, METER_SCALE_FLOOR_DBFS, 0, FLOOR_PERCENT);
  }
  if (dbfs <= METER_SCALE_KNEE_DBFS) {
    return interpolate(
      dbfs,
      METER_SCALE_FLOOR_DBFS,
      METER_SCALE_KNEE_DBFS,
      FLOOR_PERCENT,
      KNEE_PERCENT,
    );
  }
  return interpolate(dbfs, METER_SCALE_KNEE_DBFS, METER_SCALE_CEILING_DBFS, KNEE_PERCENT, 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/meterScale.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/meterScale.ts src/utils/meterScale.test.ts
git commit -m "feat(meter): map dBFS onto the track with a three-segment piecewise scale

Ported from murva's meterScale.ts. A linear -60..0 fill spends 60% of the bar
on a zone with no decision in it and squeezes the whole over zone into 1.7%;
the piecewise scale puts resolution where decisions are made. The two ticks
that are zone edges are imported from meterZones so they cannot go stale.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 4: `meterLevel.ts` — peak, windowed RMS and peak-hold, as pure functions

**Files:**
- Create: `src/utils/meterLevel.ts`
- Test: `src/utils/meterLevel.test.ts`

**Interfaces:**
- Consumes: `gainToDbfs`, `toLinearGain`, `DISPLAY_FLOOR_DBFS` from `src/utils/gainUnits.ts`.
- Produces: `interface MeterLevel { peakDbfs: number; rmsDbfs: number; heldPeakDbfs: number }`; `SILENT_LEVEL: MeterLevel`; `PEAK_DECAY_DB_PER_SEC: number` (`14`), `DEFAULT_RMS_WINDOW_MS: number` (`300`), `LEVEL_EPSILON_DB: number` (`0.1`); `bufferPeakDbfs(buffer: Float32Array): number`, `bufferMeanSquare(buffer: Float32Array): number`, `meanSquareToDbfs(meanSquare: number): number`, `decayToward(prev: number, dtSec: number): number`, `closeEnough(a: number, b: number): boolean`; `interface LevelTracker { push(buffer: Float32Array, nowMs: number): MeterLevel | null; readonly last: MeterLevel }`; `createLevelTracker(options: { tickIntervalMs: number; rmsWindowMs?: number }): LevelTracker`.

`push` returns the new `MeterLevel`, or `null` when the change is inside the dead zone and the caller should not re-render.

- [ ] **Step 1: Write the failing test**

Create `src/utils/meterLevel.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  bufferMeanSquare,
  bufferPeakDbfs,
  closeEnough,
  createLevelTracker,
  decayToward,
  DEFAULT_RMS_WINDOW_MS,
  LEVEL_EPSILON_DB,
  meanSquareToDbfs,
  PEAK_DECAY_DB_PER_SEC,
  SILENT_LEVEL,
} from './meterLevel';

/**
 * One full sine cycle across `length` samples. With `length` a power of two the crest lands
 * exactly on a sample (i = length / 4), so the peak is exactly `amplitude` and the mean square
 * is exactly `amplitude ** 2 / 2` — the two values the acceptance criteria name.
 */
function sineBuffer(amplitude: number, length = 1024): Float32Array {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * i) / length);
  }
  return buffer;
}

describe('constants', () => {
  test('are the contract values', () => {
    expect(PEAK_DECAY_DB_PER_SEC).toBe(14);
    expect(DEFAULT_RMS_WINDOW_MS).toBe(300);
    expect(LEVEL_EPSILON_DB).toBe(0.1);
  });

  test('silence is -Infinity, which is legal because a reading is never serialised', () => {
    expect(SILENT_LEVEL).toEqual({
      peakDbfs: -Infinity,
      rmsDbfs: -Infinity,
      heldPeakDbfs: -Infinity,
    });
  });
});

describe('bufferPeakDbfs', () => {
  test('a full-scale sine peaks at 0 dBFS', () => {
    expect(bufferPeakDbfs(sineBuffer(1))).toBeCloseTo(0, 4);
  });

  test('half amplitude peaks at about -6 dBFS', () => {
    expect(bufferPeakDbfs(sineBuffer(0.5))).toBeCloseTo(-6.0206, 3);
  });

  test('a quarter amplitude peaks at about -12 dBFS', () => {
    expect(bufferPeakDbfs(sineBuffer(0.25))).toBeCloseTo(-12.0412, 3);
  });

  test('an all-zero buffer is -Infinity, not 0 dBFS', () => {
    expect(bufferPeakDbfs(new Float32Array(256))).toBe(-Infinity);
  });

  test('measures magnitude, so a negative trough counts', () => {
    const buffer = new Float32Array([0, -1, 0, 0.25]);
    expect(bufferPeakDbfs(buffer)).toBeCloseTo(0, 4);
  });
});

describe('bufferMeanSquare and meanSquareToDbfs', () => {
  test('a full-scale sine has an RMS of about -3 dBFS', () => {
    expect(meanSquareToDbfs(bufferMeanSquare(sineBuffer(1)))).toBeCloseTo(-3.0103, 3);
  });

  test('half amplitude drops the RMS by 6 dB, to about -9 dBFS', () => {
    expect(meanSquareToDbfs(bufferMeanSquare(sineBuffer(0.5)))).toBeCloseTo(-9.0309, 3);
  });

  test('a DC full-scale buffer has an RMS of 0 dBFS, unlike a sine', () => {
    const dc = new Float32Array(256).fill(1);
    expect(meanSquareToDbfs(bufferMeanSquare(dc))).toBeCloseTo(0, 6);
  });

  test('silence is -Infinity', () => {
    expect(meanSquareToDbfs(0)).toBe(-Infinity);
  });
});

describe('decayToward', () => {
  test('falls at 14 dB per second', () => {
    expect(decayToward(0, 0.5)).toBeCloseTo(-7, 10);
    expect(decayToward(-10, 1)).toBeCloseTo(-24, 10);
  });

  test('snaps to -Infinity at the display floor instead of decaying forever', () => {
    expect(decayToward(-59, 1)).toBe(-Infinity);
    expect(decayToward(-60, 0)).toBe(-Infinity);
  });

  test('a negative dt never lifts the value', () => {
    expect(decayToward(-10, -5)).toBeCloseTo(-10, 10);
  });
});

describe('closeEnough', () => {
  test('a sub-epsilon move is close', () => {
    expect(closeEnough(-12, -12.05)).toBe(true);
  });

  test('a supra-epsilon move is not', () => {
    expect(closeEnough(-12, -12.5)).toBe(false);
  });

  test('a silence-boundary crossing is never close, however small it looks', () => {
    expect(closeEnough(-Infinity, -60)).toBe(false);
    expect(closeEnough(-60, -Infinity)).toBe(false);
  });

  test('identical values, including -Infinity, are close', () => {
    expect(closeEnough(-Infinity, -Infinity)).toBe(true);
  });
});

describe('createLevelTracker', () => {
  test('a full-scale sine reads 0 dBFS peak and about -3 dBFS RMS on the first push', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const level = tracker.push(sineBuffer(1), 0);

    expect(level).not.toBeNull();
    expect(level!.peakDbfs).toBeCloseTo(0, 3);
    expect(level!.rmsDbfs).toBeCloseTo(-3.0103, 3);
    expect(level!.heldPeakDbfs).toBeCloseTo(0, 3);
  });

  test('half amplitude reads about -6 dBFS peak', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const level = tracker.push(sineBuffer(0.5), 0);

    expect(level).not.toBeNull();
    expect(level!.peakDbfs).toBeCloseTo(-6.0206, 3);
  });

  test('peak has no smoothing: it drops the instant the signal does', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    tracker.push(sineBuffer(1), 0);
    const quiet = tracker.push(sineBuffer(0.25), 16);

    expect(quiet).not.toBeNull();
    expect(quiet!.peakDbfs).toBeCloseTo(-12.0412, 3);
  });

  test('the held peak decays rather than following the drop', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    tracker.push(sineBuffer(1), 0);
    const later = tracker.push(sineBuffer(0.001), 500);

    expect(later).not.toBeNull();
    // 0 dBFS held, decayed 14 dB/s for 0.5s.
    expect(later!.heldPeakDbfs).toBeCloseTo(-7, 1);
  });

  test('RMS averages in the power domain, so it lags a drop instead of jumping', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 100, rmsWindowMs: 300 });
    tracker.push(sineBuffer(1), 0);
    const second = tracker.push(new Float32Array(1024), 100);

    expect(second).not.toBeNull();
    // Mean of {0.5, 0} = 0.25 mean-square -> -6.02 dBFS, NOT the -Infinity a
    // dB-domain average of {-3.01, -Infinity} would give.
    expect(second!.rmsDbfs).toBeCloseTo(-6.0206, 3);
  });

  test('an unchanged signal is suppressed so it does not force a re-render every tick', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const buffer = sineBuffer(0.25);
    expect(tracker.push(buffer, 0)).not.toBeNull();
    // Same buffer, one tick later: peak identical, RMS window already saturated
    // at the same value, held peak pinned at the live peak.
    expect(tracker.push(buffer, 16.67)).toBeNull();
  });

  test('a clip always emits, even when every field is numerically identical', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const buffer = sineBuffer(1.5);
    expect(tracker.push(buffer, 0)).not.toBeNull();
    expect(tracker.push(buffer, 16.67)).not.toBeNull();
  });

  test('`last` reports the most recent level even when the push was suppressed', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const buffer = sineBuffer(0.25);
    tracker.push(buffer, 0);
    tracker.push(buffer, 16.67);

    expect(tracker.last.peakDbfs).toBeCloseTo(-12.0412, 3);
  });

  test('the ring buffer is at least one slot even for an absurd window', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000, rmsWindowMs: 1 });
    const level = tracker.push(sineBuffer(1), 0);

    expect(level).not.toBeNull();
    expect(level!.rmsDbfs).toBeCloseTo(-3.0103, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/meterLevel.test.ts`
Expected: FAIL with `error: Cannot find module './meterLevel' from '/Users/Pathompong/Sites/Personal/solna/src/utils/meterLevel.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/meterLevel.ts`:

```ts
import { DISPLAY_FLOOR_DBFS, gainToDbfs, toLinearGain } from './gainUnits';

/**
 * The level arithmetic behind every meter, kept free of React, rAF and AnalyserNode so it can be
 * tested by feeding it a known-amplitude buffer — which is exactly what DEV-384's acceptance
 * criteria ask for. `meterAttach.ts` is what joins this to an analyser and a tick source.
 *
 * Ported from the body of murva's `useMeterLevel.ts`; the constants are the DEV-383 contract's.
 */

export interface MeterLevel {
  /** Instantaneous peak for this tick, dBFS. No smoothing at all — attack = release = 0. */
  peakDbfs: number;
  /** Rolling-window RMS, dBFS. Averaged in the power domain, converted to dB once at the end. */
  rmsDbfs: number;
  /** Peak-hold marker, decaying at PEAK_DECAY_DB_PER_SEC. */
  heldPeakDbfs: number;
}

export const SILENT_LEVEL: MeterLevel = {
  peakDbfs: -Infinity,
  rmsDbfs: -Infinity,
  heldPeakDbfs: -Infinity,
};

export const PEAK_DECAY_DB_PER_SEC = 14;

/** Near the classic VU integration time and in the neighbourhood of LUFS-momentary's 400ms. */
export const DEFAULT_RMS_WINDOW_MS = 300;

/**
 * Dead-zone epsilon. A change smaller than this is invisible on any meter, so suppressing the
 * emission avoids a React re-render on every scheduler tick forever — including in silence,
 * where the decay below would otherwise keep producing "new" but imperceptibly different values.
 */
export const LEVEL_EPSILON_DB = 0.1;

/** Largest sample magnitude in the buffer, in dBFS. An all-zero buffer is `-Infinity`. */
export function bufferPeakDbfs(buffer: Float32Array): number {
  let peak = 0;
  for (const sample of buffer) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak > 0 ? gainToDbfs(toLinearGain(peak)) : -Infinity;
}

/** Mean of the squared samples — power, not amplitude. `0` for an empty or silent buffer. */
export function bufferMeanSquare(buffer: Float32Array): number {
  if (buffer.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of buffer) {
    sumSquares += sample * sample;
  }
  return sumSquares / buffer.length;
}

/** Converts averaged power to dBFS with a single log, at the end. */
export function meanSquareToDbfs(meanSquare: number): number {
  return meanSquare > 0 ? gainToDbfs(toLinearGain(Math.sqrt(meanSquare))) : -Infinity;
}

/**
 * Decays `prev` toward silence, snapping straight to `-Infinity` once the decayed value would
 * reach the display floor rather than subtracting forever. An unbounded decay (-140, -5000, …)
 * never converges, so the dead-zone guard below would never see two consecutive ticks close
 * enough to bail out — this floor is what makes convergence possible.
 */
export function decayToward(prev: number, dtSec: number): number {
  const decayed = prev - PEAK_DECAY_DB_PER_SEC * Math.max(0, dtSec);
  return decayed <= DISPLAY_FLOOR_DBFS ? -Infinity : decayed;
}

/**
 * True when `a` and `b` are close enough that the UI would not visibly change — EXCEPT a
 * finite/-Infinity mismatch, which is a silence-boundary crossing and is exactly the
 * semantically meaningful transition the UI must react to.
 */
export function closeEnough(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= LEVEL_EPSILON_DB;
}

/**
 * A fixed-size ring of per-tick mean-square values. `sum` is maintained incrementally (subtract
 * the slot being overwritten, add the new one) so a tick is O(1) rather than re-summing the
 * window. `filledCount` is capped at the ring length so the average is over ticks actually seen
 * rather than diluted by zero-initialised slots while the window warms up.
 */
interface RmsWindowState {
  squares: Float32Array;
  writeIndex: number;
  filledCount: number;
  sum: number;
}

function createRmsWindowState(size: number): RmsWindowState {
  return { squares: new Float32Array(size), writeIndex: 0, filledCount: 0, sum: 0 };
}

/**
 * Writes `meanSquare` into the ring (evicting the oldest slot) and returns the mean power across
 * every slot filled so far. Averaging happens in the POWER domain, never in dB — averaging
 * already-converted dB values reads too low, because dB is a log scale.
 */
function pushRmsWindowSample(win: RmsWindowState, meanSquare: number): number {
  win.sum -= win.squares[win.writeIndex]!;
  win.squares[win.writeIndex] = meanSquare;
  win.sum += meanSquare;
  win.writeIndex = (win.writeIndex + 1) % win.squares.length;
  win.filledCount = Math.min(win.filledCount + 1, win.squares.length);
  return win.sum / win.filledCount;
}

export interface LevelTracker {
  /**
   * Folds one analyser read into the running level. Returns the new level, or `null` when the
   * change sits inside the dead zone and the caller should skip its re-render.
   */
  push(buffer: Float32Array, nowMs: number): MeterLevel | null;
  /** The most recent level, whether or not the corresponding `push` was suppressed. */
  readonly last: MeterLevel;
}

export interface LevelTrackerOptions {
  /** Tick cadence, used to size the RMS ring buffer from `rmsWindowMs`. */
  tickIntervalMs: number;
  rmsWindowMs?: number;
}

export function createLevelTracker(options: LevelTrackerOptions): LevelTracker {
  const rmsWindowMs = options.rmsWindowMs ?? DEFAULT_RMS_WINDOW_MS;
  const windowSamples = Math.max(1, Math.round(rmsWindowMs / options.tickIntervalMs));
  const rmsWindow = createRmsWindowState(windowSamples);

  let heldPeak = -Infinity;
  let heldPeakTime = 0;
  let current: MeterLevel = SILENT_LEVEL;
  let lastEmitted: MeterLevel = SILENT_LEVEL;

  return {
    get last(): MeterLevel {
      return current;
    },
    push(buffer: Float32Array, nowMs: number): MeterLevel | null {
      const peakDbfs = bufferPeakDbfs(buffer);
      const rmsDbfs = meanSquareToDbfs(pushRmsWindowSample(rmsWindow, bufferMeanSquare(buffer)));

      const dtSec = (nowMs - heldPeakTime) / 1000;
      heldPeak = Math.max(decayToward(heldPeak, dtSec), peakDbfs);
      heldPeakTime = nowMs;

      const candidate: MeterLevel = { peakDbfs, rmsDbfs, heldPeakDbfs: heldPeak };
      current = candidate;

      // A clip always emits, even when every field is numerically identical to the last
      // emission: a sustained clip must stay visible rather than being swallowed by the very
      // guard that exists to stop idle re-renders.
      const isClip = peakDbfs > 0;
      const unchanged =
        !isClip &&
        closeEnough(candidate.peakDbfs, lastEmitted.peakDbfs) &&
        closeEnough(candidate.rmsDbfs, lastEmitted.rmsDbfs) &&
        closeEnough(candidate.heldPeakDbfs, lastEmitted.heldPeakDbfs);

      if (unchanged) return null;
      lastEmitted = candidate;
      return candidate;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/meterLevel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/meterLevel.ts src/utils/meterLevel.test.ts
git commit -m "feat(meter): compute peak, windowed RMS and a decaying peak-hold in dBFS

The arithmetic is kept free of React, rAF and AnalyserNode so a known-amplitude
buffer can be fed straight in: a full-scale sine reads 0 dBFS peak and -3.01
dBFS RMS, half amplitude reads -6 dBFS peak. RMS averages in the power domain
and converts once at the end — averaging dB values reads too low.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 5: `meterScheduler.ts` — one rAF loop, tiered rates, visibility pausing

**Files:**
- Create: `src/utils/meterScheduler.ts`
- Test: `src/utils/meterScheduler.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type MeterTier = 'master' | 'track' | 'offscreen'`; `type MeterDomain = 'time' | 'frequency'`; `interface MeterRegistration { id: string; tier: MeterTier; analyser?: AnalyserNode; domain?: MeterDomain; onTick: (buffer: Float32Array) => void }`; `TIER_INTERVAL_MS: Record<MeterTier, number>`; `registerMeter(reg: MeterRegistration): () => void`; `observeVisibility(id: string, element: Element): () => void`; `__resetSchedulerForTests: () => void`, `__tickForTests: (now: number) => void`, `__registrySizeForTests: () => number`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/meterScheduler.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  __registrySizeForTests,
  __resetSchedulerForTests,
  __tickForTests,
  registerMeter,
  TIER_INTERVAL_MS,
} from './meterScheduler';

/** A stand-in AnalyserNode that fills every time-domain read with `value`. */
function fakeAnalyser(value: number, fftSize = 8): AnalyserNode {
  return {
    fftSize,
    frequencyBinCount: fftSize / 2,
    getFloatTimeDomainData: (out: Float32Array) => out.fill(value),
    getFloatFrequencyData: (out: Float32Array) => out.fill(-100),
  } as unknown as AnalyserNode;
}

beforeEach(() => {
  __resetSchedulerForTests();
});

describe('tier intervals', () => {
  test('are the contract values, and offscreen never ticks', () => {
    expect(TIER_INTERVAL_MS.master).toBeCloseTo(1000 / 60, 10);
    expect(TIER_INTERVAL_MS.track).toBeCloseTo(1000 / 30, 10);
    expect(TIER_INTERVAL_MS.offscreen).toBe(Infinity);
  });

  test('murva’s glow tier is not ported', () => {
    expect(Object.keys(TIER_INTERVAL_MS).sort()).toEqual(['master', 'offscreen', 'track']);
  });
});

describe('registerMeter', () => {
  test('adds and removes exactly one registration', () => {
    const unregister = registerMeter({ id: 'a', tier: 'master', onTick: () => {} });
    expect(__registrySizeForTests()).toBe(1);
    unregister();
    expect(__registrySizeForTests()).toBe(0);
  });

  // Every loop below starts at frame 1, not frame 0. A registration is created with
  // `lastTickAt = 0`, so a tick at `now = 0` is zero milliseconds after it and is correctly
  // skipped — the first tick a meter ever gets is one interval in.
  const FRAME_MS = 1000 / 60;

  test('ticks at the master cadence', () => {
    let ticks = 0;
    registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    for (let frame = 1; frame <= 6; frame++) __tickForTests(frame * FRAME_MS);
    expect(ticks).toBe(6);
  });

  test('a track-tier meter ticks half as often as a master-tier one', () => {
    let masterTicks = 0;
    let trackTicks = 0;
    registerMeter({ id: 'm', tier: 'master', onTick: () => { masterTicks += 1; } });
    registerMeter({ id: 't', tier: 'track', onTick: () => { trackTicks += 1; } });

    for (let frame = 1; frame <= 12; frame++) __tickForTests(frame * FRAME_MS);

    expect(masterTicks).toBe(12);
    expect(trackTicks).toBe(6);
  });

  test('an offscreen-tier meter never ticks at all', () => {
    let ticks = 0;
    registerMeter({ id: 'o', tier: 'offscreen', onTick: () => { ticks += 1; } });

    for (let frame = 1; frame <= 120; frame++) __tickForTests(frame * FRAME_MS);
    expect(ticks).toBe(0);
  });

  test('the epsilon absorbs sub-millisecond drift instead of dropping an on-time frame', () => {
    let ticks = 0;
    registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    // The second frame arrives half a millisecond early. Without TICK_EPSILON_MS the strict
    // comparison would treat it as not yet due and this would be 1.
    __tickForTests(FRAME_MS);
    __tickForTests(2 * FRAME_MS - 0.5);
    expect(ticks).toBe(2);
  });

  test('reads the analyser into a reused buffer sized from fftSize', () => {
    const seen: number[][] = [];
    registerMeter({
      id: 'a',
      tier: 'master',
      analyser: fakeAnalyser(0.5, 8),
      onTick: (buffer) => { seen.push([...buffer]); },
    });

    __tickForTests(FRAME_MS);
    expect(seen).toEqual([[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]]);
  });

  test('a frequency-domain registration is sized from frequencyBinCount', () => {
    let length = -1;
    registerMeter({
      id: 'a',
      tier: 'master',
      analyser: fakeAnalyser(0, 8),
      domain: 'frequency',
      onTick: (buffer) => { length = buffer.length; },
    });

    __tickForTests(FRAME_MS);
    expect(length).toBe(4);
  });

  test('a registration with no analyser still ticks, with an empty buffer', () => {
    let length = -1;
    registerMeter({ id: 'a', tier: 'master', onTick: (buffer) => { length = buffer.length; } });

    __tickForTests(FRAME_MS);
    expect(length).toBe(0);
  });

  test('one throwing onTick does not stop the others', () => {
    let good = 0;
    registerMeter({ id: 'bad', tier: 'master', onTick: () => { throw new Error('boom'); } });
    registerMeter({ id: 'good', tier: 'master', onTick: () => { good += 1; } });

    __tickForTests(FRAME_MS);
    __tickForTests(2 * FRAME_MS);
    expect(good).toBe(2);
  });

  test('an unregistered meter stops ticking immediately', () => {
    let ticks = 0;
    const unregister = registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    __tickForTests(FRAME_MS);
    unregister();
    __tickForTests(2 * FRAME_MS);
    expect(ticks).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/meterScheduler.test.ts`
Expected: FAIL with `error: Cannot find module './meterScheduler' from '/Users/Pathompong/Sites/Personal/solna/src/utils/meterScheduler.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/meterScheduler.ts`:

```ts
/**
 * One rAF loop for every meter in the app, ticking each registration at its tier's cadence and
 * skipping any whose observed element is not intersecting.
 *
 * This matters more in solna than in the murva original it is ported from: all four tab views
 * stay mounted (`App.tsx` toggles `block`/`hidden`), so without the tiering and the
 * visibility gate every hidden tab's meters would read their analysers forever.
 *
 * murva's `glow` tier is deliberately not ported — solna has three tiers: `master`, `track`,
 * `offscreen`.
 */

export type MeterTier = 'master' | 'track' | 'offscreen';

export type MeterDomain = 'time' | 'frequency';

export interface MeterRegistration {
  id: string;
  tier: MeterTier;
  /**
   * Analyser to read per tick. Optional: a registration without one still fires `onTick` at its
   * tier's cadence and is handed a zero-length buffer, for consumers that draw from something
   * other than an analyser.
   */
  analyser?: AnalyserNode;
  /** Defaults to `'time'` (`getFloatTimeDomainData`, sized `fftSize`). */
  domain?: MeterDomain;
  onTick: (buffer: Float32Array) => void;
}

export const TIER_INTERVAL_MS: Record<MeterTier, number> = {
  master: 1000 / 60,
  track: 1000 / 30,
  offscreen: Infinity, // never ticks
};

/**
 * Tolerance subtracted from the tier interval before the "is it due" check. `now` values
 * accumulate sub-millisecond floating-point drift across successive frames, so a strict
 * `now - lastTickAt < interval` comparison can treat an on-schedule frame as not-yet-due
 * (observed: 16.666666666666664 < 16.666666666666668). 1ms absorbs that and typical rAF jitter
 * without materially changing the cadence.
 */
const TICK_EPSILON_MS = 1;

interface InternalEntry {
  reg: MeterRegistration;
  buffer: Float32Array<ArrayBuffer>;
  lastTickAt: number;
  visible: boolean;
}

const registry = new Map<string, InternalEntry>();
let rafHandle: number | null = null;
let isAppVisible = true;

function ensureLoopRunning(): void {
  if (rafHandle !== null || typeof requestAnimationFrame !== 'function') return;
  rafHandle = requestAnimationFrame(loop);
}

function loop(now: number): void {
  rafHandle = null;
  if (registry.size === 0) return;
  if (isAppVisible) {
    for (const entry of registry.values()) {
      if (!entry.visible) continue;
      const interval = TIER_INTERVAL_MS[entry.reg.tier];
      if (now - entry.lastTickAt < interval - TICK_EPSILON_MS) continue;
      // Stamp BEFORE the callback: if onTick throws, the entry falls back to its tier cadence
      // rather than being retried at full rAF rate.
      entry.lastTickAt = now;
      try {
        const analyser = entry.reg.analyser;
        if (analyser) {
          if (entry.reg.domain === 'frequency') analyser.getFloatFrequencyData(entry.buffer);
          else analyser.getFloatTimeDomainData(entry.buffer);
        }
        entry.reg.onTick(entry.buffer);
      } catch (error) {
        // One bad consumer must not kill the loop — that would freeze every other meter until
        // the next registerMeter, because ensureLoopRunning below would never run.
        console.warn('[meterScheduler] onTick failed for', entry.reg.id, error);
      }
    }
  }
  ensureLoopRunning();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    isAppVisible = document.visibilityState === 'visible';
  });
}

export function registerMeter(reg: MeterRegistration): () => void {
  const analyser = reg.analyser;
  const bufferSize = analyser
    ? reg.domain === 'frequency'
      ? analyser.frequencyBinCount
      : analyser.fftSize
    : 0;
  registry.set(reg.id, {
    reg,
    buffer: new Float32Array(bufferSize),
    lastTickAt: 0,
    visible: true,
  });
  ensureLoopRunning();
  return () => {
    registry.delete(reg.id);
  };
}

function setTierVisible(id: string, visible: boolean): void {
  const entry = registry.get(id);
  if (entry) entry.visible = visible;
}

interface ElementObservation {
  observer: IntersectionObserver;
  ids: Set<string>;
}

/** One IntersectionObserver per element, shared by every meter registered against it. */
let elementObservers = new WeakMap<Element, ElementObservation>();

/** Mirrors the WeakMap's values so observers can be enumerated (a WeakMap is not iterable). */
const activeObservations = new Set<ElementObservation>();

/**
 * Observes `element`'s visibility and pauses/resumes that registration's ticking accordingly.
 * A tab view hidden by `App.tsx` is `display: none`, which reports as not intersecting — that
 * is what makes hidden tabs stop reading analysers.
 *
 * Observers are shared per element so N meters on one container do not create N observers. The
 * returned disconnect function is load-bearing for garbage collection: `activeObservations`
 * holds strong references, so skipping it retains the element and its observer.
 */
export function observeVisibility(id: string, element: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    return () => {}; // environment without IO support — the meter stays always-visible
  }
  let observation = elementObservers.get(element);
  if (!observation) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const registered = elementObservers.get(entry.target);
          if (!registered) continue;
          for (const registeredId of registered.ids) {
            setTierVisible(registeredId, entry.isIntersecting);
          }
        }
      },
      { threshold: 0 },
    );
    observer.observe(element);
    observation = { observer, ids: new Set([id]) };
    elementObservers.set(element, observation);
    activeObservations.add(observation);
  } else {
    observation.ids.add(id);
  }
  return () => {
    const current = elementObservers.get(element);
    if (!current) return;
    current.ids.delete(id);
    if (current.ids.size === 0) {
      current.observer.disconnect();
      elementObservers.delete(element);
      activeObservations.delete(current);
    }
  };
}

// Test-only escape hatches. Not part of the surface production code uses; the `__` prefix is
// what marks them as such, matching the DEV-383 contract's module surface.
export const __resetSchedulerForTests = (): void => {
  registry.clear();
  if (rafHandle !== null) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  isAppVisible = true;
  // Disconnect every live observer so orphaned callbacks stop firing, then drop both structures
  // so stale disconnect closures (captured from the previous WeakMap) become inert.
  for (const observation of activeObservations) {
    observation.observer.disconnect();
  }
  activeObservations.clear();
  elementObservers = new WeakMap();
};

export const __tickForTests = (now: number): void => {
  loop(now);
};

export const __registrySizeForTests = (): number => registry.size;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/meterScheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the `__`-prefixed exports draw no lint complaint**

Run: `bun run eslint`
Expected: no output at all. If a naming rule fires on `__resetSchedulerForTests`, `__tickForTests` or `__registrySizeForTests`, add a single line disable directly above each, naming the reason (`test-only escape hatch; the prefix is the marker`), per the repo's D5 convention that a remaining warning carries a disable naming its reason rather than a rule relaxed for everybody.

- [ ] **Step 6: Commit**

```bash
git add src/utils/meterScheduler.ts src/utils/meterScheduler.test.ts
git commit -m "feat(meter): add the tiered meter scheduler with a shared rAF loop

One loop for every meter, ticking master at 60Hz, track at 30Hz and offscreen
never, with a 1ms epsilon so float drift cannot drop an on-time frame. This
matters more here than in murva: all four tab views stay mounted, so without
the visibility gate every hidden tab's meters would read analysers forever.
murva's glow tier is deliberately not ported.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 6: `meterAttach.ts` + the `useMeterLevel` hook

**Files:**
- Create: `src/utils/meterAttach.ts`
- Create: `src/components/ui/useMeterLevel.ts`
- Test: `src/utils/meterAttach.test.ts`

**Interfaces:**
- Consumes: `createLevelTracker`, `type MeterLevel`, `SILENT_LEVEL` from `src/utils/meterLevel.ts`; `registerMeter`, `observeVisibility`, `TIER_INTERVAL_MS`, `type MeterTier` from `src/utils/meterScheduler.ts`. In the test only: `freshEngine` from `src/audio/testFakes.ts` and the existing `AudioEngine.getSourceAnalyser(source: string): AnalyserNode | null`.
- Produces: `attachMeter(analyser: AnalyserNode, options: AttachMeterOptions): () => void` where `interface AttachMeterOptions { id: string; tier: MeterTier; rmsWindowMs?: number; visibilityElement?: Element | null; now?: () => number; onLevel: (level: MeterLevel) => void }`; `nextMeterId(prefix: string): string`; and `useMeterLevel(analyser: AnalyserNode | null, options: { tier: MeterTier; visibilityRef?: RefObject<Element | null>; rmsWindowMs?: number }): MeterLevel`, re-exporting `type MeterLevel`.

`attachMeter` exists so the composition the hook performs is testable in a repo with no DOM. The hook takes an `AnalyserNode | null` **parameter** rather than reaching for the engine, so it needs no eslint layering exemption; only the component that fetches the analyser does.

**This is also where per-source metering is proved.** The acceptance criterion "each of synth /
chord / bass / pad / sequencer has its own meter reading, via `getSourceAnalyser(source)` and the
`sourceBuses` map" is a WIRING requirement, and the wiring is exactly this: one analyser per bus,
read through the same `attachMeter` path the master meter uses, at the `track` tier. The tests
below take a real engine (`freshEngine()` from `src/audio/testFakes.ts`), pull an analyser for
each of the five sources, and drive a known-amplitude buffer through one of them to a dBFS
reading. Where those five meters appear on screen, and what they look like, is DEV-389's.

**Two documented differences from the DEV-383 contract's module surface, both additive.** (1) The contract declares `interface MeterLevel` in `src/components/ui/useMeterLevel.ts`; here it is declared in `src/utils/meterLevel.ts` and **re-exported** from the hook module, so `import type { MeterLevel } from '@/components/ui/useMeterLevel'` resolves exactly as the contract says while the type stays reachable from `src/utils/` without a `components/` import (which `src/utils/` must never have). (2) `src/utils/meterAttach.ts` is not in the contract's list at all; it is an internal composition module, and no other plan in the epic depends on it. Neither changes a constant or a signature the contract pins.

- [ ] **Step 1: Write the failing test**

Create `src/utils/meterAttach.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { freshEngine } from '@/audio/testFakes';
import { attachMeter, nextMeterId } from './meterAttach';
import type { MeterLevel } from './meterLevel';
import { __resetSchedulerForTests, __registrySizeForTests, __tickForTests } from './meterScheduler';

/** One full sine cycle; the crest lands exactly on a sample at a power-of-two length. */
function sineBuffer(amplitude: number, length = 1024): Float32Array {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * i) / length);
  }
  return buffer;
}

function fakeAnalyser(samples: Float32Array): AnalyserNode {
  return {
    fftSize: samples.length,
    frequencyBinCount: samples.length / 2,
    getFloatTimeDomainData: (out: Float32Array) => { out.set(samples.subarray(0, out.length)); },
    getFloatFrequencyData: (out: Float32Array) => { out.fill(-100); },
  } as unknown as AnalyserNode;
}

// A registration starts at `lastTickAt = 0`, so a tick at `now = 0` is zero milliseconds after
// it and is correctly skipped. Every test below therefore starts the clock one frame in.
const FRAME_MS = 1000 / 60;
/** One frame of the `track` tier, which is what a per-source meter registers at. */
const TRACK_FRAME_MS = 1000 / 30;

beforeEach(() => {
  __resetSchedulerForTests();
});

describe('nextMeterId', () => {
  test('never repeats, so two meters on one source cannot collide in the registry', () => {
    expect(nextMeterId('master')).not.toBe(nextMeterId('master'));
  });

  test('keeps the prefix so a registry dump is readable', () => {
    expect(nextMeterId('synth').startsWith('synth-')).toBe(true);
  });
});

describe('attachMeter', () => {
  test('a full-scale sine reads 0 dBFS peak and about -3 dBFS RMS', () => {
    const levels: MeterLevel[] = [];
    let clock = FRAME_MS;
    attachMeter(fakeAnalyser(sineBuffer(1)), {
      id: 'a',
      tier: 'master',
      now: () => clock,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(clock);

    expect(levels).toHaveLength(1);
    expect(levels[0]!.peakDbfs).toBeCloseTo(0, 3);
    expect(levels[0]!.rmsDbfs).toBeCloseTo(-3.0103, 3);
  });

  test('half amplitude reads about -6 dBFS peak', () => {
    const levels: MeterLevel[] = [];
    attachMeter(fakeAnalyser(sineBuffer(0.5)), {
      id: 'a',
      tier: 'master',
      now: () => FRAME_MS,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(FRAME_MS);

    expect(levels[0]!.peakDbfs).toBeCloseTo(-6.0206, 3);
  });

  test('a clipping signal reaches the over zone, which a post-limiter tap could not', () => {
    const levels: MeterLevel[] = [];
    attachMeter(fakeAnalyser(sineBuffer(1.5)), {
      id: 'a',
      tier: 'master',
      now: () => FRAME_MS,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(FRAME_MS);

    expect(levels[0]!.peakDbfs).toBeGreaterThan(-1);
  });

  test('a steady signal stops emitting once the dead zone is reached', () => {
    let emissions = 0;
    let clock = FRAME_MS;
    attachMeter(fakeAnalyser(sineBuffer(0.25)), {
      id: 'a',
      tier: 'master',
      now: () => clock,
      onLevel: () => { emissions += 1; },
    });

    for (let frame = 1; frame <= 20; frame++) {
      clock = frame * FRAME_MS;
      __tickForTests(clock);
    }

    // The first tick emits; the RMS window then saturates within its 300ms and everything
    // after that is inside LEVEL_EPSILON_DB.
    expect(emissions).toBeLessThan(20);
    expect(emissions).toBeGreaterThan(0);
  });

  test('the detach function removes the registration', () => {
    const detach = attachMeter(fakeAnalyser(sineBuffer(1)), {
      id: 'a',
      tier: 'master',
      now: () => FRAME_MS,
      onLevel: () => {},
    });

    expect(__registrySizeForTests()).toBe(1);
    detach();
    expect(__registrySizeForTests()).toBe(0);
  });

  test('an offscreen tier attaches but never emits, which is how a hidden tab stops', () => {
    let emissions = 0;
    attachMeter(fakeAnalyser(sineBuffer(1)), {
      id: 'a',
      tier: 'offscreen',
      now: () => FRAME_MS,
      onLevel: () => { emissions += 1; },
    });

    for (let frame = 1; frame <= 60; frame++) __tickForTests(frame * FRAME_MS);

    expect(__registrySizeForTests()).toBe(1);
    expect(emissions).toBe(0);
  });
});

describe('a per-source analyser reads through exactly the same path', () => {
  const SOURCES = ['synth', 'chord', 'bass', 'pad', 'sequencer'] as const;

  test('every source bus hands back its own analyser, and the same one on a second call', () => {
    const { engine } = freshEngine();
    const analysers = SOURCES.map((source) => engine.getSourceAnalyser(source));

    for (const analyser of analysers) expect(analyser).not.toBeNull();
    // Five distinct nodes: a shared one would make every layer read the same mix.
    expect(new Set(analysers).size).toBe(SOURCES.length);
    expect(engine.getSourceAnalyser('synth')).toBe(analysers[0]!);
  });

  test('a source analyser yields a dBFS reading at the track tier', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('bass')!;
    // The fake context's analyser records wiring but produces no samples, so feed it the
    // half-amplitude sine the acceptance criteria name.
    const samples = sineBuffer(0.5, analyser.fftSize);
    (
      analyser as unknown as { getFloatTimeDomainData: (out: Float32Array) => void }
    ).getFloatTimeDomainData = (out) => {
      out.set(samples.subarray(0, out.length));
    };

    const levels: MeterLevel[] = [];
    attachMeter(analyser, {
      id: nextMeterId('bass'),
      tier: 'track',
      now: () => TRACK_FRAME_MS,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(TRACK_FRAME_MS);

    expect(levels).toHaveLength(1);
    expect(levels[0]!.peakDbfs).toBeCloseTo(-6.0206, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/meterAttach.test.ts`
Expected: FAIL with `error: Cannot find module './meterAttach' from '/Users/Pathompong/Sites/Personal/solna/src/utils/meterAttach.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/meterAttach.ts`:

```ts
import { createLevelTracker, type MeterLevel } from './meterLevel';
import {
  observeVisibility,
  registerMeter,
  TIER_INTERVAL_MS,
  type MeterTier,
} from './meterScheduler';

/**
 * Joins a level tracker to an analyser and the shared scheduler. This is the whole body of what
 * `components/ui/useMeterLevel.ts` does, extracted so it can be tested: the repo has no DOM and
 * no testing-library, so a hook's effect never runs under `bun test` — but this does.
 */

export interface AttachMeterOptions {
  /** Registry key. Use `nextMeterId` unless a caller genuinely owns a stable id. */
  id: string;
  tier: MeterTier;
  rmsWindowMs?: number;
  /** When given, ticking pauses while this element is not intersecting. */
  visibilityElement?: Element | null;
  /** Injectable clock, for tests. Defaults to `performance.now`. */
  now?: () => number;
  /** Called only when the level actually changed enough to be worth a redraw. */
  onLevel: (level: MeterLevel) => void;
}

let meterIdCounter = 0;

/** A unique, readable registry key. Two meters on one source must not share an id. */
export function nextMeterId(prefix: string): string {
  meterIdCounter += 1;
  return `${prefix}-${meterIdCounter}`;
}

export function attachMeter(analyser: AnalyserNode, options: AttachMeterOptions): () => void {
  const now = options.now ?? (() => performance.now());
  // The offscreen tier's interval is Infinity, which would size the ring buffer at 0 slots; the
  // tracker clamps to 1, and an offscreen meter never ticks anyway.
  const tickIntervalMs = Number.isFinite(TIER_INTERVAL_MS[options.tier])
    ? TIER_INTERVAL_MS[options.tier]
    : TIER_INTERVAL_MS.track;
  const tracker = createLevelTracker({ tickIntervalMs, rmsWindowMs: options.rmsWindowMs });

  const unregister = registerMeter({
    id: options.id,
    tier: options.tier,
    analyser,
    onTick: (buffer) => {
      const level = tracker.push(buffer, now());
      if (level) options.onLevel(level);
    },
  });

  const unobserve = options.visibilityElement
    ? observeVisibility(options.id, options.visibilityElement)
    : null;

  return () => {
    unregister();
    unobserve?.();
  };
}
```

Create `src/components/ui/useMeterLevel.ts`:

```ts
import { useEffect, useState, type RefObject } from "react";
import { attachMeter, nextMeterId } from "@/utils/meterAttach";
import { SILENT_LEVEL, type MeterLevel } from "@/utils/meterLevel";
import type { MeterTier } from "@/utils/meterScheduler";

export type { MeterLevel };

/**
 * Reads an `AnalyserNode` on the shared meter scheduler and returns dBFS peak/RMS plus a
 * decaying peak-hold.
 *
 * The analyser is a PARAMETER, not something this hook fetches: that keeps the hook out of the
 * layering-rule-3 exemption list in `eslint.config.js` — only the component that calls
 * `audioEngine.getMasterLevelAnalyser()` / `getSourceAnalyser()` needs the exemption.
 *
 * - `options.tier` selects the scheduler's cadence. Passing `'offscreen'` is how a caller
 *   parks a meter that is mounted but should not be reading anything.
 * - `options.visibilityRef` observes that element so the meter pauses when its tab is hidden.
 * - `peakDbfs` has no smoothing in either direction; `rmsDbfs` is averaged over
 *   `options.rmsWindowMs` (default 300ms) in the power domain.
 *
 * No value here goes anywhere near a zustand slice: a store write per tick would re-render every
 * mounted view, and all four tab views stay mounted.
 */
export function useMeterLevel(
  analyser: AnalyserNode | null,
  options: {
    tier: MeterTier;
    visibilityRef?: RefObject<Element | null>;
    rmsWindowMs?: number;
  },
): MeterLevel {
  const [level, setLevel] = useState<MeterLevel>(SILENT_LEVEL);
  const { tier, rmsWindowMs, visibilityRef } = options;

  useEffect(() => {
    setLevel(SILENT_LEVEL);
    if (!analyser) return;

    return attachMeter(analyser, {
      id: nextMeterId(tier),
      tier,
      rmsWindowMs,
      visibilityElement: visibilityRef?.current ?? null,
      onLevel: setLevel,
    });
  }, [analyser, tier, rmsWindowMs, visibilityRef]);

  return level;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/meterAttach.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check the hook**

Run: `bun run lint`
Expected: no output (`tsc --noEmit` clean).

- [ ] **Step 6: Commit**

```bash
git add src/utils/meterAttach.ts src/utils/meterAttach.test.ts src/components/ui/useMeterLevel.ts
git commit -m "feat(meter): add attachMeter and the useMeterLevel hook

attachMeter carries the whole composition the hook performs so it can be tested
in a repo with no DOM: a fake analyser fed a full-scale sine reads 0 dBFS peak
and -3 dBFS RMS through the real scheduler. The hook takes an AnalyserNode as a
parameter rather than reaching for the engine, so it needs no layering
exemption — only the component that fetches the analyser does. That parameter
is also what makes per-source metering wiring rather than a component: the
tests pull an analyser per source bus off a real engine and read one of them at
the track tier through the same attachMeter path the master meter uses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 7: Move the analyser tap ahead of the dynamics, add a level analyser, delete `getAudioLevel`

> **This task also updates `.claude/skills/dsp-audio/SKILL.md`.** That file is what the repo tells
> you to read *before* touching signal routing, and after this task two of its statements are
> false: its chain diagram ends `limiter -> analyser (fftSize 256) -> ctx.destination`, and its
> "Key consequences" list says *"The analyser is post-limiter, so `getAudioLevel()` reflects final
> output"* — an API this task deletes. A routing doc that lies is worse than no routing doc,
> because it is consulted precisely by people who do not already know the answer. DEV-385 also
> edits this file later; that is not a reason to leave it wrong in between, because this branch
> merges on its own and someone may read it before DEV-385 lands.
>
> Add the SKILL.md edit as a step in this task, before the commit step, covering:
> - the diagram gains the second tap — both `analyser` and `levelAnalyser` hang off `masterGain`
>   as observe-only sends, neither with an output of its own;
> - the "serial and fixed" bullet stops claiming the analyser is post-limiter, and names
>   `getMasterLevelAnalyser()` instead of the deleted `getAudioLevel()`;
> - the `masterGain` bullet keeps saying headroom is owned by the compressor and limiter, because
>   at the end of THIS task that is still true — DEV-385 is what makes it false, and it owns that
>   edit. Do not pre-empt it.
>
> Then extend this task's commit step to stage the file.

**Files:**
- Modify: `src/audio/engine.ts:215-218` (add the `levelAnalyser` field), `src/audio/engine.ts:313` (delete `levelBuffer`), `src/audio/engine.ts:670-700` (node creation), `src/audio/engine.ts:776-784` (wiring), `src/audio/engine.ts:2450-2470` (add `getMasterLevelAnalyser`), `src/audio/engine.ts:2496-2510` (delete `getAudioLevel`)
- Modify: `src/audio/engine.test.ts:563-593`
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the engine imports no meter module — the arithmetic lives in `src/utils/`, which `src/audio/` must not need).
- Produces: `AudioEngine.getMasterLevelAnalyser(): AnalyserNode | null`. `getAnalyser()`, `getSourceAnalyser(source: string)`, `getByteFrequencyData` and `getByteTimeDomainData` keep their existing signatures. `getAudioLevel()` no longer exists.

**Read `.claude/skills/dsp-audio/SKILL.md` before starting this task.**

**Note on the tap position, and why this test moves twice.** The issue text says "insert the
analyser between `masterGain` and the compressor". solna's chain is not ordered that way — it is
`eqHigh → compressor → masterGain → limiter → analyser → destination`, so the compressor sits
*upstream* of the fader and there is no point that is both post-fader and pre-compressor. The
change made here is the one the acceptance criterion actually needs: the analysers come **off the
serial path entirely** and hang as observe-only sends from `masterGain`, so the signal path
becomes `masterGain → limiter → destination` and the meter reads post-fader, pre-limiter. The
limiter's −3 dB ceiling no longer clamps what the meter can see, so `over` (≥ −1 dBFS) is
reachable. The compressor upstream still acts (−12 dB, 4:1) until DEV-385 makes both defeatable
and default-off; that is DEV-385's job, and DEV-385 rewires this chain again. Keep this change
minimal for that reason — the wiring assertion below will be edited a second time.

A **dedicated** `levelAnalyser` at `fftSize` 2048 is added rather than raising the existing
`analyser`'s 256: `AudioVisualizer` draws from `analyser.frequencyBinCount` and changing it from
128 to 1024 would silently rescale every bar it draws. 256 samples is ~5ms at 48kHz, so at a
60Hz tick a 256-sample window sees under a third of the timeline and would miss peaks; 2048
samples (~43ms) covers a 60Hz tick with overlap.

- [ ] **Step 1: Write the failing test**

Replace the body of the `'seeds masterGain at unity and inserts a ratio-20 limiter between masterGain and the analyser'` test in `src/audio/engine.test.ts` (currently lines 563-593) with this renamed test:

```ts
  test('taps both analysers off masterGain ahead of the limiter, so `over` is reachable', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;

    // masterGain is the user's master trim and nothing else: engineSync pushes
    // masterVolume with fireImmediately, so any "staging" value seeded here is
    // overwritten before the first frame. The -3 dB limiter is the real ceiling.
    expect(masterGain.gain.value).toBe(1);
    expect(limiter).toBeDefined();
    if (!limiter) return;

    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.knee.value <= 6).toBe(true);
    expect(limiter.attack.value).toBeCloseTo(0.003, 6);
    expect(limiter.release.value <= 0.25).toBe(true);

    // Signal path: compressor -> masterGain -> limiter -> destination. Both
    // analysers hang off masterGain as observe-only sends, POST-fader and
    // PRE-limiter, so a -3 dB limiter can no longer cap what the meter reads
    // and the `over` zone (>= -1 dBFS) is reachable rather than dead code.
    // DEV-385 rewires this chain again; keep the assertion cheap to move.
    expect(compressor._connectTargets).toEqual([masterGain]);
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });

  test('the level analyser has a longer window than the spectrum analyser', () => {
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    // AudioVisualizer draws from `analyser.frequencyBinCount`, so its fftSize
    // is fixed at 256 and the level read gets its own, longer, node instead.
    expect((engine as any).analyser.fftSize).toBe(256);
    expect((engine as any).levelAnalyser.fftSize).toBe(2048);
  });

  test('getMasterLevelAnalyser is null before init and the level node after', () => {
    const engine = makeEngine();
    expect(engine.getMasterLevelAnalyser()).toBeNull();

    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    expect(engine.getMasterLevelAnalyser()).toBe((engine as any).levelAnalyser);
  });

```

> **Ruling (controller, pre-flight): `getAudioLevel()` and `levelBuffer` are NOT deleted in this
> task — the deletion moves to Task 10.** As written, this task removed a method whose two callers
> are not rewritten until Tasks 9 and 10, so Step 5 below expected `bun run lint` to FAIL and
> commits 7, 8 and 9 would each fail `bun run verify`. Three red commits in a bisectable history
> is a worse trade than one method living four commits longer, and the plan's own Global
> Constraints make `bun run verify` the gate. Task 10 removes the last caller and deletes the
> method in the same commit. The `expect(getAudioLevel).toBeUndefined()` test moves there too.
>
> `getAudioLevel()` keeps working meanwhile: it reads `this.analyser`, which still exists and is
> now fed by a send from `masterGain` instead of the limiter. Its reading stays as meaningless as
> it always was, which is why nothing depends on its value.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/engine.test.ts -t "so \`over\` is reachable"`
Expected: FAIL — `expected [ limiter ] to equal [ undefined, undefined, limiter ]` (there is no `levelAnalyser` field and `masterGain` still connects only to the limiter).

- [ ] **Step 3: Write minimal implementation**

In `src/audio/engine.ts`, add the field immediately after line 216 (`private analyser: AnalyserNode | null = null;`):

```ts
  /**
   * Second master analyser, for LEVEL rather than spectrum. Separate from `analyser` because
   * AudioVisualizer draws from that node's 128 frequency bins and changing its fftSize would
   * silently rescale every bar it draws — while a peak read wants a long window: 256 samples is
   * ~5ms at 48kHz, under a third of a 60Hz tick, so short-window peaks would be missed.
   */
  private levelAnalyser: AnalyserNode | null = null;
```

Leave `levelBuffer` (line 313) in place — it belongs to `getAudioLevel()`, which Task 10 deletes.

In `setupMasterChain`, immediately after the existing `this.analyser` block (`this.analyser.smoothingTimeConstant = 0.8;`), add:

```ts
    // Level analyser: long window, no smoothing. `smoothingTimeConstant` only affects frequency
    // reads, but it is pinned at 0 here so the node states what it is for.
    this.levelAnalyser = this.ctx.createAnalyser();
    this.levelAnalyser.fftSize = 2048;
    this.levelAnalyser.smoothingTimeConstant = 0;
```

Replace the final wiring block (currently the four lines ending `this.analyser.connect(this.ctx.destination);`) with:

```ts
    this.eqHighNode.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    // Both analysers are OBSERVE-ONLY sends off masterGain — post-fader, pre-limiter — and
    // connect onward to nothing. Tapping post-limiter, as this chain used to, put a -3 dB
    // ratio-20 compressor between the mix and the meter, so no reading could ever exceed -3
    // dBFS and the `over` zone was dead code. DEV-385 rewires this chain again.
    this.masterGain.connect(this.analyser);
    this.masterGain.connect(this.levelAnalyser);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
```

In `setupMasterChain`'s cleanup block at the top, add `this.levelAnalyser = null;` beside the existing `this.sourceAnalysers.clear();` line, so a rebuilt context does not keep a node from the dead one.

Add the new getter immediately after `getAnalyser()`, leaving `getAudioLevel()` in place below it (Task 10 deletes it):

```ts
  /**
   * Analyser for LEVEL metering — a long-window time-domain tap off masterGain, post-fader and
   * pre-limiter. Callers read it with `getFloatTimeDomainData` and turn samples into dBFS via
   * `src/utils/meterLevel.ts`; the engine deliberately computes no dB itself, so there is one
   * definition of the level maths and it lives where it can be unit-tested.
   *
   * This replaces `getAudioLevel()`, which averaged `getByteFrequencyData` bins. A spectrum
   * average is not a level: it moves with a patch's brightness, not its loudness, and it has no
   * dB meaning at all.
   */
  getMasterLevelAnalyser(): AnalyserNode | null {
    return this.levelAnalyser;
  }
```

Leave `getByteFrequencyData` and `getByteTimeDomainData` exactly as they are — `AudioVisualizer` uses both.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS (all four new tests, and every pre-existing engine test).

- [ ] **Step 5: Confirm `getAudioLevel` has exactly the callers Task 10 expects, and the tree is green**

Run: `grep -rn --include='*.ts' --include='*.tsx' 'getAudioLevel' src`
Expected: exactly four hits — the definition in `src/audio/engine.ts`, the two call sites
(`src/components/ui/VuMeter.tsx`, `src/components/ui/AmbientBackdrop.tsx`), and one stale COMMENT
in `src/components/AudioVisualizer.tsx` that names the method without calling it. Record them for
Task 10, which deletes the method and must clear all four. If any *other* file appears, stop —
Task 10's deletion is scoped to what this step finds.

Then run: `bun run lint`
Expected: PASS. This task adds a node and a getter and rewires three edges; it removes nothing, so
the tree type-checks at this commit and at every commit after it.

- [ ] **Step 6: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "feat(audio): tap the master analysers ahead of the limiter and drop getAudioLevel

The analysers were post-limiter, behind a -3 dB ratio-20 compressor, so no
reading could exceed -3 dBFS and an over zone drawn from one would be dead
code. Both now hang off masterGain as observe-only sends: post-fader,
pre-limiter. A dedicated levelAnalyser at fftSize 2048 carries the level read
so AudioVisualizer's 128-bin spectrum node is untouched. getAudioLevel, which
averaged frequency bins and so measured brightness rather than loudness, stays
until Task 10 removes its last caller — deleting it here would leave three
commits that do not type-check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 8: Re-key `vuMeter.ts` from 0..1 to dBFS, and extract `MeterBar`

**Files:**
- Modify: `src/utils/vuMeter.ts`
- Modify: `src/utils/vuMeter.test.ts`
- Create: `src/components/ui/MeterBar.tsx`
- Test: `src/utils/vuMeter.test.ts`, `src/components/ui/MeterBar.test.tsx`

**Interfaces:**
- Consumes: `dbfsToPercent` from `src/utils/meterScale.ts`; `ZONE_GOOD_MAX`, `ZONE_HOT_MAX`, `type MeterZone`, `classifyZone` from `src/utils/meterZones.ts`.
- Produces: `VU_SEGMENT_COUNT: number` (`10`), `vuSegment(dbfs: number): number`, `isSegmentActive(segment: number, index: number): boolean`, `segmentTone(index: number): 'good' | 'hot' | 'over'`, `zoneFillClass(zone: MeterZone): string`; and `MeterBar` (React component) with `interface MeterBarProps { peakDbfs: number; heldPeakDbfs?: number; className?: string; title?: string }`.

- [ ] **Step 1: Write the failing test**

Replace the whole of `src/utils/vuMeter.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test';
import { isSegmentActive, segmentTone, VU_SEGMENT_COUNT, vuSegment, zoneFillClass } from './vuMeter';

describe('vuSegment', () => {
  test('silence lights no segments', () => {
    expect(vuSegment(-Infinity)).toBe(0);
    expect(vuSegment(-60)).toBe(0);
    expect(vuSegment(-120)).toBe(0);
  });

  test('the scale ceiling lights every segment', () => {
    expect(vuSegment(6)).toBe(VU_SEGMENT_COUNT);
    expect(vuSegment(12)).toBe(VU_SEGMENT_COUNT);
  });

  test('the piecewise knees land where the scale puts them, not on a linear ramp', () => {
    // -48 dBFS is 5% of the track, -24 is 30%, -6 is 72%, 0 is 86%.
    expect(vuSegment(-48)).toBe(1);
    expect(vuSegment(-24)).toBe(3);
    expect(vuSegment(-6)).toBe(7);
    expect(vuSegment(0)).toBe(9);
  });

  test('a linear -60..0 mapping would have put -30 halfway; the piecewise scale does not', () => {
    expect(vuSegment(-30)).toBeLessThan(3);
  });

  test('0 dBFS does not fill the bar, so a clip is still visibly different', () => {
    expect(vuSegment(0)).toBeLessThan(VU_SEGMENT_COUNT);
  });

  test('is monotonic across the range', () => {
    let previous = -1;
    for (let db = -70; db <= 10; db += 0.5) {
      const segment = vuSegment(db);
      expect(segment).toBeGreaterThanOrEqual(previous);
      previous = segment;
    }
  });

  test('NaN reads as silence rather than propagating', () => {
    expect(vuSegment(Number.NaN)).toBe(0);
  });
});

describe('segmentTone', () => {
  test('the low segments are good', () => {
    expect(segmentTone(0)).toBe('good');
    expect(segmentTone(6)).toBe('good');
  });

  test('the segment straddling -6 dBFS is hot', () => {
    expect(segmentTone(7)).toBe('hot');
  });

  test('the top two segments are over, because -1 dBFS sits at 83.7%', () => {
    expect(segmentTone(8)).toBe('over');
    expect(segmentTone(9)).toBe('over');
  });

  test('tones never go backwards as the index rises', () => {
    const rank = { good: 0, hot: 1, over: 2 } as const;
    let previous = -1;
    for (let i = 0; i < VU_SEGMENT_COUNT; i++) {
      const current = rank[segmentTone(i)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('isSegmentActive', () => {
  test('lights exactly the first `segment` indices', () => {
    expect(isSegmentActive(3, 0)).toBe(true);
    expect(isSegmentActive(3, 2)).toBe(true);
    expect(isSegmentActive(3, 3)).toBe(false);
  });

  test('nothing is lit at zero', () => {
    expect(isSegmentActive(0, 0)).toBe(false);
  });

  test('everything is lit at full scale', () => {
    expect(isSegmentActive(VU_SEGMENT_COUNT, VU_SEGMENT_COUNT - 1)).toBe(true);
  });
});

describe('zoneFillClass', () => {
  test('names a theme token per zone and never a raw colour', () => {
    expect(zoneFillClass('tooQuiet')).toBe('bg-success');
    expect(zoneFillClass('good')).toBe('bg-success');
    expect(zoneFillClass('hot')).toBe('bg-warning');
    expect(zoneFillClass('over')).toBe('bg-error');
  });
});
```

Create `src/components/ui/MeterBar.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { MeterBar } from './MeterBar';

describe('MeterBar', () => {
  test('lights nothing at silence', () => {
    const html = renderToString(<MeterBar peakDbfs={-Infinity} />);
    expect(html).not.toContain('bg-success');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('bg-error');
  });

  test('lights the low segments in success green at -24 dBFS', () => {
    const html = renderToString(<MeterBar peakDbfs={-24} />);
    expect(html).toContain('bg-success');
    expect(html).not.toContain('bg-error');
  });

  test('lights the top segments in error red once the reading is over', () => {
    const html = renderToString(<MeterBar peakDbfs={3} />);
    expect(html).toContain('bg-error');
  });

  test('draws the held-peak marker only when it is above the live peak', () => {
    const withHold = renderToString(<MeterBar peakDbfs={-40} heldPeakDbfs={-6} />);
    expect(withHold).toContain('data-meter-hold');

    const withoutHold = renderToString(<MeterBar peakDbfs={-6} heldPeakDbfs={-6} />);
    expect(withoutHold).not.toContain('data-meter-hold');
  });

  test('passes a title through for the tooltip', () => {
    const html = renderToString(<MeterBar peakDbfs={-12} title="Synth: -12.0 dB" />);
    expect(html).toContain('title="Synth: -12.0 dB"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/vuMeter.test.ts src/components/ui/MeterBar.test.tsx`
Expected: FAIL — `vuMeter.test.ts` fails on `expect(vuSegment(-48)).toBe(1)` (the current `vuSegment` multiplies a 0..1 level by 10, so `-48` returns `0`) and on the missing `segmentTone` / `zoneFillClass` exports; `MeterBar.test.tsx` fails with `Cannot find module './MeterBar'`.

- [ ] **Step 3: Write minimal implementation**

Replace the whole of `src/utils/vuMeter.ts` with:

```ts
import { dbfsToPercent } from './meterScale';
import { ZONE_GOOD_MAX, ZONE_HOT_MAX, type MeterZone } from './meterZones';

/**
 * Pure quantisation for the segment meters, kept out of the components so it can be tested
 * without rendering React — this repo has no DOM setup.
 *
 * Everything here is keyed in dBFS. It used to take a 0..1 "level" (a spectrum average) and
 * multiply by ten, so no segment corresponded to any dB and the red segments were a guess.
 */

/** Number of discrete segments a meter draws. */
export const VU_SEGMENT_COUNT = 10;

/**
 * Quantise a dBFS reading to a lit-segment count in 0..VU_SEGMENT_COUNT, through the piecewise
 * scale — so the segments are spaced the way the fill is, and the two can never disagree.
 * NaN reads as silence rather than propagating through Math.round/min/max.
 */
export function vuSegment(dbfs: number): number {
  if (Number.isNaN(dbfs)) return 0;
  const segments = (dbfsToPercent(dbfs) / 100) * VU_SEGMENT_COUNT;
  return Math.max(0, Math.min(VU_SEGMENT_COUNT, Math.round(segments)));
}

/** Whether the 0-based segment at `index` is lit when `segment` are lit. */
export function isSegmentActive(segment: number, index: number): boolean {
  return segment > index;
}

/**
 * The tone a given segment carries, derived from the zone boundaries through the same scale the
 * fill uses rather than from hand-picked indices. A segment is coloured by where its TOP edge
 * sits: index 7's top edge is 80% of the track, `ZONE_GOOD_MAX` (-6 dBFS) is 72%, and
 * `ZONE_HOT_MAX` (-1 dBFS) is 83.7%, so 7 is hot and 8-9 are over.
 *
 * `tooQuiet` gets no tone of its own: a meter reading low is not an error state to colour, it is
 * just a short bar, and giving it a fourth colour would say otherwise.
 */
export function segmentTone(index: number): 'good' | 'hot' | 'over' {
  const topPercent = ((index + 1) / VU_SEGMENT_COUNT) * 100;
  if (topPercent > dbfsToPercent(ZONE_HOT_MAX)) return 'over';
  if (topPercent > dbfsToPercent(ZONE_GOOD_MAX)) return 'hot';
  return 'good';
}

/**
 * Theme token per zone, so a colour is never written as a literal. `tooQuiet` and `good` share
 * the success token for the reason in `segmentTone`. `segmentTone`'s three results are all
 * `MeterZone` members, so `zoneFillClass(segmentTone(i))` is the only place a segment's colour
 * is decided — there is no second ternary anywhere to drift out of step with it.
 */
export function zoneFillClass(zone: MeterZone): string {
  switch (zone) {
    case 'over':
      return 'bg-error';
    case 'hot':
      return 'bg-warning';
    default:
      return 'bg-success';
  }
}
```

Create `src/components/ui/MeterBar.tsx`:

```tsx
/**
 * PROVISIONAL PRESENTATION — DEV-389 replaces this component.
 *
 * Its only job here is to prove the dBFS path draws: that a reading taken from an analyser
 * reaches the screen, lands on the piecewise scale, and changes colour at the zone boundaries.
 * It is a ten-segment bar because that is what `VuMeter` already was, NOT because a ten-segment
 * bar is the considered design — nothing about its size, spacing, orientation, hold marker or
 * label has been designed. Do not copy it into a new surface and do not treat its markup as a
 * contract; DEV-389 ("Design and place the meter and fader UI on the dBFS wiring") settles the
 * visual design once, for every place a meter appears.
 *
 * ONE property must survive that redesign, because it is correctness rather than taste: the fill
 * colour is chosen ONCE from a zone classification — here, per fixed segment index via
 * `zoneFillClass(segmentTone(i))`; for a continuous fill, from the current peak's zone — and is
 * NEVER painted as a gradient across the fill element. murva shipped the gradient version and it
 * put a red tip on the bar at every level, including silence, because a gradient rescales with
 * the element it is painted on and so always reaches its own last stop.
 */
import React from "react";
import {
  isSegmentActive,
  segmentTone,
  VU_SEGMENT_COUNT,
  vuSegment,
  zoneFillClass,
} from "@/utils/vuMeter";
import { dbfsToPercent } from "@/utils/meterScale";

export interface MeterBarProps {
  /** Live peak, dBFS. `-Infinity` is silence. */
  peakDbfs: number;
  /** Decaying peak-hold marker, dBFS. Drawn only when it sits above the live peak. */
  heldPeakDbfs?: number;
  /** Extra classes for the outer element; the caller owns its width. */
  className?: string;
  title?: string;
}

/**
 * The segment bar itself. Purely presentational: it holds no timer, reads no analyser and takes
 * its numbers as props, which is what lets it be asserted with `renderToString`. See the
 * PROVISIONAL note at the top of the file before changing anything about how it looks.
 */
export const MeterBar = React.memo(function MeterBar({
  peakDbfs,
  heldPeakDbfs,
  className = "",
  title,
}: MeterBarProps) {
  const segment = vuSegment(peakDbfs);
  const showHold =
    heldPeakDbfs !== undefined && Number.isFinite(heldPeakDbfs) && heldPeakDbfs > peakDbfs;
  const holdPercent = showHold ? dbfsToPercent(heldPeakDbfs) : 0;

  return (
    <div className={`relative h-2 bg-base-300 rounded-xs overflow-hidden flex gap-0.5 p-0.5 ${className}`} title={title}>
      {Array.from({ length: VU_SEGMENT_COUNT }).map((_, i) => {
        const active = isSegmentActive(segment, i);
        return (
          <div
            key={i}
            className={`flex-1 rounded-xs transition-colors duration-75 ${
              active ? zoneFillClass(segmentTone(i)) : "bg-base-300/50"
            }`}
          />
        );
      })}
      {showHold && (
        <span
          data-meter-hold
          className="absolute top-0 bottom-0 w-px bg-base-content/70"
          style={{ left: `${holdPercent}%` }}
        />
      )}
    </div>
  );
});
```

`MeterBar` derives each segment's fill from `zoneFillClass(segmentTone(i))` — a segment's colour
is a property of its position on the scale, not of the current reading, so it can be computed
once per index and never disagrees with where the fill stops. That is the redesign-surviving
property spelled out in the file header: a colour comes from a zone classification, never from a
gradient painted across the fill. DEV-389 may change every other thing about this component.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/vuMeter.test.ts src/components/ui/MeterBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/vuMeter.ts src/utils/vuMeter.test.ts src/components/ui/MeterBar.tsx src/components/ui/MeterBar.test.tsx
git commit -m "feat(meter): re-key the segment meter from a 0..1 level to dBFS

vuSegment took a spectrum average and multiplied it by ten, so no segment
corresponded to any dB and the red segments were a guess at an index. It now
quantises a dBFS reading through the piecewise scale, and segmentTone derives
each segment's colour from the zone boundaries through that same scale, so the
fill and the colours cannot disagree. MeterBar is extracted as an explicitly
provisional shim that proves the dBFS path draws; DEV-389 replaces it, keeping
only the rule that a fill colour comes from a zone and never from a gradient.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 9: Rewrite `VuMeter` onto the dBFS path

**Files:**
- Modify: `src/components/ui/VuMeter.tsx`
- Test: `src/components/ui/VuMeter.test.tsx` (create)

**Interfaces:**
- Consumes: `useMeterLevel` from `src/components/ui/useMeterLevel.ts`; `MeterBar` from `src/components/ui/MeterBar.tsx`; `formatDb` from `src/utils/gainUnits.ts`; `audioEngine.getMasterLevelAnalyser()` from Task 7.
- Produces: `VuMeter` with the unchanged prop `interface VuMeterProps { isPlaying: boolean }`, so `TransportBar.tsx:162` needs no edit.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/VuMeter.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { VuMeter } from './VuMeter';

// No DOM, so effects never run: what a render proves here is the SILENT initial
// state and the markup around it. The level path itself is covered by
// src/utils/meterAttach.test.ts, which drives the real scheduler.
describe('VuMeter', () => {
  test('renders silent while stopped — no segment is lit', () => {
    const html = renderToString(<VuMeter isPlaying={false} />);
    expect(html).not.toContain('bg-success');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('bg-error');
  });

  test('renders silent on the first frame of playback too', () => {
    const html = renderToString(<VuMeter isPlaying />);
    expect(html).not.toContain('bg-error');
  });

  test('keeps the transport chrome it had: hidden on narrow screens, boxed', () => {
    const html = renderToString(<VuMeter isPlaying={false} />);
    expect(html).toContain('hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box');
  });

  test('titles itself with a dB readout rather than a bare percentage', () => {
    const html = renderToString(<VuMeter isPlaying={false} />);
    expect(html).toContain('title="Master peak: -∞ dB"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/VuMeter.test.tsx`
Expected: FAIL — the current `VuMeter` calls `audioEngine.getAudioLevel()`, which Task 7 deleted, so the test errors before any assertion; and it renders no `title` attribute.

- [ ] **Step 3: Write minimal implementation**

Replace the whole of `src/components/ui/VuMeter.tsx` with:

```tsx
import React, { useMemo } from "react";
import { audioEngine } from "@/audio/engine";
import { formatDb } from "@/utils/gainUnits";
import { MeterBar } from "./MeterBar";
import { useMeterLevel } from "./useMeterLevel";

export interface VuMeterProps {
  /** Whether anything is sounding; the meter parks on the offscreen tier when false. */
  isPlaying: boolean;
}

/**
 * Master output level meter: true dBFS peak with a decaying peak-hold, read from the engine's
 * dedicated level analyser (post-fader, pre-limiter) on the shared meter scheduler.
 *
 * It reads `audioEngine` directly — the layering rule 3 exemption it has always held, alongside
 * AudioVisualizer and AmbientBackdrop. `useMeterLevel` itself takes the analyser as a parameter
 * and imports nothing from `audio/`, so the exemption stops here and the list does not grow.
 *
 * `isPlaying` selects the tier rather than tearing the registration down: `offscreen` never
 * ticks, so a stopped transport does no analyser reads at all, and the level state stays at
 * whatever it last was until the next tick replaces it.
 *
 * Nothing here touches a zustand slice. A store write per tick would re-render all four mounted
 * tab views.
 */
export const VuMeter = React.memo(function VuMeter({ isPlaying }: VuMeterProps) {
  // Resolved on each render rather than in a ref: before the first user click there is no
  // AudioContext and this is null, and the hook re-registers when the node finally appears.
  const analyser = audioEngine.getMasterLevelAnalyser();
  const options = useMemo(
    () => ({ tier: isPlaying ? ("master" as const) : ("offscreen" as const) }),
    [isPlaying],
  );
  const level = useMeterLevel(analyser, options);

  return (
    <div className="hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box">
      <MeterBar
        peakDbfs={level.peakDbfs}
        heldPeakDbfs={level.heldPeakDbfs}
        className="w-14"
        title={`Master peak: ${formatDb(level.peakDbfs)}`}
      />
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/ui/VuMeter.test.tsx && bun test src/components/TransportBar.test.tsx`
Expected: PASS for both — `TransportBar.tsx:162` still passes `isPlaying` and needs no edit.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/VuMeter.tsx src/components/ui/VuMeter.test.tsx
git commit -m "feat(meter): drive the transport VU from true dBFS peak

Reads the engine's dedicated level analyser through useMeterLevel instead of
owning its own rAF loop and averaging frequency bins. isPlaying now selects the
scheduler tier rather than starting and stopping a loop, so a stopped transport
performs no analyser reads at all. The prop is unchanged, so TransportBar is
untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Deferred to DEV-389: per-source meters beside every channel strip

Not a task here. A `SourceMeter` component, its five placements (`SynthView`, `ChordModulePanel`,
`BassModulePanel`, `PadModulePanel`, `SequencerView`) and the `eslint.config.js` exemption they
would need are pulled out of this issue and into **DEV-389 "Design and place the meter and fader
UI on the dBFS wiring"**.

**Why.** Placing a per-source meter in five views before the meter's visual design is settled
means designing it five times — once per surface, each time by whoever happens to be editing that
view, and then re-doing all five when the real design lands. DEV-389 also owns the fader UI those
meters sit beside (it depends on DEV-386), so a strip and its meter get designed together as one
control rather than as a bar bolted onto a fader.

**What stays here.** All of the wiring: `getSourceAnalyser(source)` is reachable and hands back
one analyser per `sourceBuses` entry, `useMeterLevel` takes an `AnalyserNode | null` so a source
analyser is read by exactly the same path as the master one, and Task 6 asserts that a source
analyser yields a dBFS reading at the `track` tier. What DEV-389 adds is a component and a place
to put it, not a new reading.

**What DEV-389 inherits** — the five bus keys, the lazily-created cached analyser, why the meter
belongs on the `ChannelStrip`'s row, the `visibilityRef` requirement that makes "hidden tabs do
not tick" true, and which file the eslint exemption lives in — is written into DEV-389's own
issue description, so it travels with the work rather than living in a plan that is closed by
then. It is not repeated here.

---

### Task 10: Give `AmbientBackdrop` an honest reading

> **Ruling (controller, pre-flight): this task also deletes `getAudioLevel()` and `levelBuffer`.**
> Task 7 originally deleted them, which left Tasks 7-9 unable to type-check because their callers
> live here and in Task 9. The deletion belongs in the commit that removes the LAST caller, which
> is this one. Add these to this task, after the backdrop rewrite and before the commit step:
>
> 1. Delete `getAudioLevel()` from `src/audio/engine.ts` and the `private levelBuffer` field it is
>    the only user of.
> 2. Fix the STALE COMMENT at `src/components/AudioVisualizer.tsx` — it reads *"the same guard
>    `AudioEngine.getAudioLevel` uses for its own buffer"*, naming a method that no longer exists.
>    `tsc` cannot catch a comment, which is why Task 7 Step 5 greps for all four references rather
>    than trusting the compiler. Point it at the guard that survives, or restate the rule without
>    naming a dead method.
> 3. Add to `src/audio/engine.test.ts`:
>
>    ```ts
>    test('getAudioLevel is gone — a spectrum average was never a level', () => {
>      const engine = makeEngine();
>      expect((engine as any).getAudioLevel).toBeUndefined();
>    });
>    ```
>
> 4. Re-run the Task 7 grep and confirm it now returns **zero** hits, then `bun run verify`. This
>    is the commit where the whole branch is green again on every gate.
>
> Stage `src/audio/engine.ts`, `src/audio/engine.test.ts` and
> `src/components/AudioVisualizer.tsx` alongside this task's own files.

**Files:**
- Modify: `src/components/ui/AmbientBackdrop.tsx:111-145`
- Test: `src/components/ui/AmbientBackdrop.test.tsx`

**Interfaces:**
- Consumes: `createLevelTracker` from `src/utils/meterLevel.ts`; `registerMeter` from `src/utils/meterScheduler.ts`; `nextMeterId` from `src/utils/meterAttach.ts`; `dbfsToPercent` from `src/utils/meterScale.ts`; `audioEngine.getMasterLevelAnalyser()` from Task 7.
- Produces: `backdropLevel(rmsDbfs: number): number` — exported from `src/components/ui/AmbientBackdrop.tsx`, mapping a dBFS RMS reading onto the 0..1 the blob geometry already expects.

**The decision, stated.** The backdrop takes **RMS dBFS mapped through `dbfsToPercent` and
divided by 100**, not peak. Peak is right for a meter, where the question is "am I clipping";
the backdrop is answering "how much is going on", which is an energy question, and peak would
make the blobs flicker on every transient. Mapping through `dbfsToPercent` rather than a raw
normalisation is what keeps the backdrop and the meters agreeing about what "loud" looks like —
and the resulting 0..1 keeps the existing `0.35 + level * 0.25` radius and `0.08 + level * 0.22`
alpha arithmetic working unchanged.

The reading is written into a **ref**, updated by a scheduler registration, and read inside the
existing rAF draw loop. It is deliberately not `useMeterLevel`: the backdrop redraws every frame
for its own blob motion, and a `useState` level would re-render the component and restart the
draw effect on every tick.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ui/AmbientBackdrop.test.tsx`:

```tsx
describe('backdropLevel', () => {
  test('silence is zero, so the blobs sit at their resting radius', () => {
    expect(backdropLevel(-Infinity)).toBe(0);
    expect(backdropLevel(-60)).toBe(0);
  });

  test('the scale ceiling is one', () => {
    expect(backdropLevel(6)).toBeCloseTo(1, 10);
    expect(backdropLevel(20)).toBeCloseTo(1, 10);
  });

  test('agrees with the meters about where a reading sits', () => {
    // -24 dBFS is 30% of a meter's track; the backdrop uses the same 0.30.
    expect(backdropLevel(-24)).toBeCloseTo(0.3, 10);
    expect(backdropLevel(-6)).toBeCloseTo(0.72, 10);
  });

  test('stays inside 0..1 so the radius and alpha arithmetic cannot blow up', () => {
    for (let db = -200; db <= 40; db += 1) {
      expect(backdropLevel(db)).toBeGreaterThanOrEqual(0);
      expect(backdropLevel(db)).toBeLessThanOrEqual(1);
    }
  });

  test('NaN reads as silence rather than propagating into a canvas gradient', () => {
    expect(backdropLevel(Number.NaN)).toBe(0);
  });
});
```

Add `backdropLevel` to that file's existing import from `./AmbientBackdrop`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/AmbientBackdrop.test.tsx -t "backdropLevel"`
Expected: FAIL with `TypeError: backdropLevel is not a function` (it is not exported yet), and the file also fails to type-check because `getAudioLevel` no longer exists.

- [ ] **Step 3: Write minimal implementation**

Add these imports at the top of `src/components/ui/AmbientBackdrop.tsx`:

```tsx
import { nextMeterId } from "@/utils/meterAttach";
import { createLevelTracker } from "@/utils/meterLevel";
import { dbfsToPercent } from "@/utils/meterScale";
import { registerMeter, TIER_INTERVAL_MS } from "@/utils/meterScheduler";
```

Add the exported helper above the component:

```tsx
/**
 * Maps an RMS dBFS reading onto the 0..1 the blob geometry expects.
 *
 * RMS, not peak: the backdrop answers "how much is going on", which is an energy question, and a
 * peak reading would make the blobs flicker on every transient. Through `dbfsToPercent` rather
 * than a raw normalisation, so the backdrop and the meters agree about where a given level sits.
 * NaN reads as silence rather than propagating into a canvas gradient, which would throw.
 */
export function backdropLevel(rmsDbfs: number): number {
  if (Number.isNaN(rmsDbfs)) return 0;
  return dbfsToPercent(rmsDbfs) / 100;
}
```

Inside the component, beside the existing refs, add:

```tsx
  // Written by the meter scheduler, read by the draw loop below. A ref, not state: the backdrop
  // redraws every frame for its own blob motion, so a state update per tick would re-render the
  // component and restart the draw effect. Nothing here reaches a zustand slice.
  const levelRef = useRef(0);
```

Add a registration effect immediately before the existing draw effect:

```tsx
  useEffect(() => {
    if (!animate) {
      levelRef.current = 0;
      return;
    }
    const analyser = audioEngine.getMasterLevelAnalyser();
    if (!analyser) return;

    const tracker = createLevelTracker({ tickIntervalMs: TIER_INTERVAL_MS.track });
    const id = nextMeterId("backdrop");
    return registerMeter({
      id,
      tier: "track",
      analyser,
      onTick: (buffer) => {
        const level = tracker.push(buffer, performance.now());
        if (level) levelRef.current = backdropLevel(level.rmsDbfs);
      },
    });
  }, [animate]);
```

In the draw loop, replace the three-line comment and the `getAudioLevel` call (currently lines 129-132) with:

```tsx
      // Fed by the scheduler registration above at the track tier, so the backdrop reads the
      // analyser 30 times a second rather than once per drawn frame. `getAudioLevel` used to
      // live here and averaged frequency bins — that moved with a patch's brightness, not its
      // loudness.
      const level = levelRef.current;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/ui/AmbientBackdrop.test.tsx`
Expected: PASS

- [ ] **Step 5: Confirm nothing still references the deleted getter**

Run: `grep -rn "getAudioLevel" src/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/AmbientBackdrop.tsx src/components/ui/AmbientBackdrop.test.tsx
git commit -m "feat(meter): drive the ambient backdrop from RMS dBFS

RMS rather than peak, because the backdrop answers 'how much is going on' and a
peak reading would flicker on every transient; mapped through dbfsToPercent so
the backdrop and the meters agree about where a level sits. The reading lands
in a ref updated by the scheduler at the track tier, not in state — the draw
loop already runs every frame and a state update per tick would restart it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 11: `meterColor.ts` — the zone → theme-token map DEV-389 and DEV-385 draw from

**Files:**
- Create: `src/utils/meterColor.ts`
- Test: `src/utils/meterColor.test.ts`

**Interfaces:**
- Consumes: `type MeterZone` from `src/utils/meterZones.ts` (`import type` only, so this file has no runtime import at all); `zoneFillClass` from `src/utils/vuMeter.ts` in the test only.
- Produces: `meterZoneClass(zone: MeterZone): string`.

**Why it lands in DEV-384 with no consumer yet.** It is seventeen lines and it is
design-independent: a zone → token mapping is not a layout, a size or a placement, and none of
the questions DEV-389 has to answer change what colour `over` is. Two later issues both need it —
DEV-389's meter and DEV-385's gain-reduction readout — and porting it twice is how two files end
up disagreeing about what `hot` looks like. It ships here, next to the other pure modules, with
the zone constants it is keyed by.

**Port notes.** murva's `meterColorForZone` returns CSS strings
(`"var(--color-success, #22c55e)"`). solna cannot: raw hex is a `check:theme` failure by rule, and
`--color-base-content-30` is not a token that exists here. The port therefore returns **daisyUI
semantic classes**, which is how every other solna component names a role — `bg-base-content/30`
is already the repo's spelling for murva's `--color-base-content-30` (see `Keyboard.tsx`,
`MidiIndicator.tsx`). The function is renamed `meterZoneClass` to say what it returns.

**Its relationship to `vuMeter.ts`'s `zoneFillClass`, which is not a duplicate.**
`zoneFillClass` colours ONE SEGMENT by its fixed position on the scale — `segmentTone` can only
ever hand it `good`, `hot` or `over`, so a lit low segment is green and `tooQuiet` never reaches
it. `meterZoneClass` colours a WHOLE READING by the zone that reading is in, and there
`tooQuiet` is a real answer that must look under-level rather than healthy. They therefore agree
on all three tones both can produce and differ on exactly one case the other cannot receive — and
the test below asserts both halves of that, so the two maps cannot drift apart silently.

- [ ] **Step 1: Write the failing test**

Create `src/utils/meterColor.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { meterZoneClass } from './meterColor';
import type { MeterZone } from './meterZones';
import { zoneFillClass } from './vuMeter';

const ZONES: readonly MeterZone[] = ['tooQuiet', 'good', 'hot', 'over'];

describe('meterZoneClass', () => {
  test('maps every zone to a daisyUI semantic token', () => {
    expect(meterZoneClass('tooQuiet')).toBe('bg-base-content/30');
    expect(meterZoneClass('good')).toBe('bg-success');
    expect(meterZoneClass('hot')).toBe('bg-warning');
    expect(meterZoneClass('over')).toBe('bg-error');
  });

  test('every zone gets a class of its own — no zone falls through to another', () => {
    const classes = ZONES.map((zone) => meterZoneClass(zone));
    for (const cls of classes) expect(cls.length).toBeGreaterThan(0);
    expect(new Set(classes).size).toBe(ZONES.length);
  });

  test('names a role and never a colour, so check:theme has nothing to find', () => {
    for (const zone of ZONES) {
      expect(meterZoneClass(zone)).toMatch(/^bg-(?:base-content\/30|success|warning|error)$/);
    }
  });
});

describe('agreement with the segment map in vuMeter.ts', () => {
  test('the three tones a segment can carry are coloured identically either way', () => {
    for (const zone of ['good', 'hot', 'over'] as const) {
      expect(meterZoneClass(zone)).toBe(zoneFillClass(zone));
    }
  });

  test('tooQuiet is the one deliberate difference, and it is deliberate', () => {
    // A reading in the tooQuiet zone must read as under-level; a lit LOW SEGMENT is just a
    // short bar and stays green. `segmentTone` never returns 'tooQuiet', so nothing is
    // coloured twice by the two rules.
    expect(meterZoneClass('tooQuiet')).toBe('bg-base-content/30');
    expect(zoneFillClass('tooQuiet')).toBe('bg-success');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/meterColor.test.ts`
Expected: FAIL with `error: Cannot find module './meterColor' from '/Users/Pathompong/Sites/Personal/solna/src/utils/meterColor.test.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/meterColor.ts`:

```ts
import type { MeterZone } from './meterZones';

/**
 * The colour a meter zone is drawn in, as a daisyUI semantic class. Ported from murva's
 * `features/audio/components/Meter/meterColor.ts`, which returns CSS custom properties with hex
 * fallbacks; solna names roles as classes instead, because a raw hex fails `check:theme` by rule
 * and `--color-base-content-30` is not a token this repo has. `bg-base-content/30` is the
 * established solna spelling of that same "present but unremarkable" grey.
 *
 * This is the single map for colouring a READING by its zone: DEV-389's meter and DEV-385's
 * gain-reduction readout both draw from it, so `over` cannot mean red in one place and something
 * else in another. `vuMeter.ts`'s `zoneFillClass` is a different question — it colours one
 * SEGMENT by its fixed position on the scale, where `tooQuiet` never arrives — and
 * `meterColor.test.ts` pins the two together on the three tones they share.
 *
 * There is deliberately NO `default` branch: the switch is exhaustive over `MeterZone`, so a
 * fifth zone becomes a compile error here instead of silently inheriting a colour.
 */
export function meterZoneClass(zone: MeterZone): string {
  switch (zone) {
    case 'tooQuiet':
      return 'bg-base-content/30';
    case 'good':
      return 'bg-success';
    case 'hot':
      return 'bg-warning';
    case 'over':
      return 'bg-error';
  }
}
```

- [ ] **Step 4: Run test to verify it passes, and that the theme guard is happy**

Run: `bun test src/utils/meterColor.test.ts && bun run check:theme`
Expected: PASS for both. `check:theme` scans `src/**/*.{ts,tsx}` and its `ALLOWLIST` is empty; a `bg-*` role class matches none of its rules, whereas the hex fallbacks in murva's original would have matched `raw-hex` four times.

- [ ] **Step 5: Commit**

```bash
git add src/utils/meterColor.ts src/utils/meterColor.test.ts
git commit -m "feat(meter): map a meter zone to a theme token in one place

Ported from murva's meterColor.ts, with its CSS var + hex-fallback strings
replaced by daisyUI semantic classes: raw hex fails check:theme by rule, and
--color-base-content-30 is not a token solna has. DEV-389's meter and DEV-385's
gain-reduction readout both draw from this, so porting it twice cannot make
them disagree. A test pins it against vuMeter's per-segment map on the three
tones the two share.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 12: Close the gate

**Files:**
- Modify: `CLAUDE.md` (one paragraph on the metering rule)
- Test: the whole suite, via `bun run verify`

**Interfaces:**
- Consumes: everything from Tasks 1-11.
- Produces: nothing new.

- [ ] **Step 1: Run the full suite**

Run: `bun test`
Expected: PASS, no failures and no skipped-by-error files.

- [ ] **Step 2: Type-check**

Run: `bun run lint`
Expected: no output.

- [ ] **Step 3: Confirm eslint reports nothing at all**

Run: `bun run eslint`
Expected: **no output whatsoever** — no errors AND no warnings. A `react-hooks/exhaustive-deps` warning is a failure of this step: settle it by listing the real dependency, or, if the omission is deliberate, add a line disable that names its reason (the repo's D5 convention). A `complexity` warning is likewise a failure; split the function.

- [ ] **Step 4: Record the rule in CLAUDE.md**

Add this paragraph to `CLAUDE.md`, after the paragraph beginning "**The store→engine bridge**":

```markdown
**A meter reads samples, not a spectrum, and it reads them before the dynamics.** Level is peak
and windowed RMS computed from `getFloatTimeDomainData` and reported in dBFS (`src/utils/`:
`gainUnits.ts`, `meterZones.ts`, `meterScale.ts`, `meterLevel.ts`, `meterColor.ts`). Averaging
`getByteFrequencyData` bins — what `getAudioLevel()` did — measures a patch's brightness, not its
loudness, and yields a 0..1 with no dB meaning, which is why the segments it drove corresponded
to nothing. The master analysers are **observe-only sends off `masterGain`**, post-fader and
pre-limiter: tapped after the limiter, as they were, no reading could exceed the limiter's
threshold and the `over` zone was unreachable by construction. Every meter ticks through
`utils/meterScheduler.ts` — one rAF loop, a tier per registration, and an `IntersectionObserver`
per element. That last part is not an optimisation here: all four tab views stay mounted, so a
meter with no visibility gate reads its analyser forever on a tab nobody is looking at. **No
meter value may enter a zustand slice** — a write per tick re-renders every mounted view — and
the numbers (`-24`/`-6`/`-1` zones, the `0/5/30/100` piecewise scale, 14 dB/s decay, a −60 dBFS
display floor) are an interop contract with murva recorded in
`docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`, not values to re-derive.
```

- [ ] **Step 5: Run the gate**

Run: `bun run verify`
Expected: PASS end to end — `bun test`, `tsc --noEmit`, `eslint .` (silent), `check:keys`, `check:drums`, `check:contrast`, and `vite build`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the metering rule and why the tap sits pre-limiter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Acceptance criteria → tasks

| Acceptance criterion | Task(s) |
|---|---|
| `getAudioLevel()` replaced by peak + windowed RMS from `getFloatTimeDomainData`, in dBFS, with a 14 dB/s decaying peak-hold and a −60 dBFS display floor | 1 (floor, `gainToDbfs`), 4 (peak/RMS/decay), 5 (the `getFloatTimeDomainData` read), 7 (delete `getAudioLevel`) |
| Zone classification `tooQuiet < −24`, `good −24..−6`, `hot −6..−1`, `over ≥ −1` | 2 |
| The meter fill uses the piecewise scale, not a linear one | 3 (`dbfsToPercent`), 8 (`vuSegment`/`segmentTone` drawn through it), 10 (backdrop through the same scale) |
| Each of synth / chord / bass / pad / sequencer has its own reading via `getSourceAnalyser` and `sourceBuses` | 6 — covered as **wiring**: one analyser per `sourceBuses` entry, `useMeterLevel` taking `AnalyserNode \| null` so a source analyser reads by the same path as the master one, and a test driving a source analyser to a dBFS reading at the `track` tier. Only the ON-SCREEN PLACEMENT of those meters moved to DEV-389 (see the deferral note after Task 9), because designing a meter in five views before its design exists means designing it five times. |
| The analyser tap moves ahead of the compressor and limiter, so `over` is reachable | 7 (moved off the serial path to a post-fader/pre-limiter send; the compressor stays upstream until DEV-385 makes it defeatable — stated in the task) |
| Meters on hidden tabs do not tick | 5 (`observeVisibility` + the `offscreen` tier, with the pausing asserted there), 9 (`isPlaying` parks the master meter on `offscreen`). Per-view observation is exercised when DEV-389 mounts a meter inside a view; the mechanism itself is tested in 5. |
| No meter value written into a zustand slice | 4/6 (tracker + hook state are local), 9, 10 (a ref, not state, in the backdrop) — asserted by review, not by a test |
| `bun run verify` green, eslint silent | 12 |
| `vuMeter.test.ts` re-keyed from 0..1 segments to dB | 8 |
| A known-amplitude buffer asserts full-scale sine ≈0 dBFS peak / ≈−3 dBFS RMS, half amplitude ≈−6 dBFS peak | 4 (`createLevelTracker` and the buffer helpers), 6 (the same, through the real scheduler and a fake analyser) |
| A test asserting zone boundaries and the piecewise scale's breakpoints | 2 (boundaries), 3 (breakpoints) |

**Deferred to DEV-389, in full.** (a) The visual design of a meter — size, spacing, orientation,
tick and hold-marker treatment, label. `MeterBar` here is an explicitly provisional shim that
proves the dBFS path draws, and says so in its own header. (b) A `SourceMeter` component and its
five placements beside the channel strips, plus the `eslint.config.js` exemption such a component
needs. Reason for both: DEV-389 also owns the fader UI a meter sits beside (it depends on
DEV-386), and settling a meter's design in one issue is cheaper and more consistent than settling
it five times inside five views. One property is NOT deferred and must survive the redesign: a
fill colour is chosen once from a zone classification, never painted as a gradient across the
fill.

**Task 11 maps to no acceptance criterion, deliberately.** `meterColor.ts` is a hand-off: the
zone → theme-token map DEV-389 and DEV-385 both consume, ported once here because it is
design-independent and porting it twice is how two files come to disagree about what `hot` looks
like.
