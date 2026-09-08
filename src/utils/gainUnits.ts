/**
 * KEEP IN SYNC WITH MURVA — see murva `src/shared/audio/gainUnits.ts`.
 *
 * This is a copy, by decision (DEV-388): solna and murva are separate repos in
 * separate git roots, and a shared package would buy synchronisation at the
 * price of a release process, a version matrix and a build step in both, for
 * ~90 lines of pure arithmetic. `src/utils/gainContract.test.ts` is the
 * tripwire: it asserts every constant and both tapers as LITERAL numbers, so
 * editing anything here makes a hard-coded expectation wrong and forces a human
 * to decide whether murva is moving too. Do not satisfy that test by editing
 * its expectation.
 *
 * One value here is deliberately NOT murva's: `SILENCE_DB` is a finite -60,
 * because solna's levels cross JSON.stringify twice (persist and the .solna
 * body) and JSON.stringify(-Infinity) is null. See divergence 2 in
 * docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md.
 */

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
 *
 * THE RULE, because three of these four look like "a number 0..1":
 *
 *   A FADER VALUE IS NEVER PASSED INTO A VELOCITY PARAMETER, AND A VELOCITY
 *   IS NEVER WRITTEN TO A GAIN NODE A FADER OWNS.
 *
 * `Decibels` is a RELATIVE level (a fader or a trim; 0 is unity; may be ±).
 * `Dbfs` is an ABSOLUTE reading (a meter; 0 is the ceiling).
 * `LinearGain` is what an AudioParam takes; a fader may exceed 1.
 * `Velocity` is a per-hit PERFORMANCE attribute in 0..1 — MIDI data[2]/127, a
 * pad's strike strength, a step accent. `clampVelocity` clamps it to 0..1, so
 * a fader routed through it cannot even express the +12 dB the range
 * promises; that is how the sequencer fader came to be applied twice and to
 * behave as its own square.
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
 * The fader range's top, in linear gain — `dbToGain(FADER_MAX_DB)`, ≈3.981.
 *
 * It exists so an engine clamp can be DERIVED from the fader range instead of
 * being an independent magic number. `setSourceGain` used to clamp at `1.5`
 * (=+3.5 dB) and `setMasterVolume` at `1` (=0 dB), so a fader that displayed
 * +12 dB stopped responding partway up and the master could not boost at all.
 * Import the constant, never the arithmetic: `src/audio/` speaks linear gain.
 */
export const MAX_FADER_GAIN: LinearGain = dbToGain(toDecibels(FADER_MAX_DB));

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
 * silence: a meter that has never seen a sample should say "-inf", not "NaN dB".
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
