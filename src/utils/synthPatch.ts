import type { ActiveSynth, ModRoute, ModTarget, NoteDivision } from '@/types/synth';

/**
 * Canonical pure math over an engine patch's plain numeric fields (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Subtractive patch contract"). Deliberately independent of
 * `src/utils/gainUnits.ts` — that module is a branded fader/meter contract
 * kept byte-for-byte in sync with murva; a synth patch level is a plain
 * unbranded number and needs its own floor (see `SYNTH_GAIN_FLOOR_DB`
 * below), so this file does not import it.
 *
 * Pure math only: no store, no engine, no React, per the layering rules for
 * `src/utils/`.
 */

/**
 * A patch's stored gain never reaches `-Infinity` — "enabled" state is what
 * represents silence, not the dB value itself (design doc, oscillator
 * params). This is the floor both directions of the conversion clamp to:
 * `gainToDb` never returns lower than this, and it is low enough that
 * `dbToGain` of it is inaudible.
 */
export const SYNTH_GAIN_FLOOR_DB = -96;

/**
 * Whether a level in dB is a SOUND rather than this model's spelling of silence.
 *
 * The patch never stores `-Infinity`, so a source at the floor is off and its
 * `enabled`/`subEnabled` flag is part of the level coordinate rather than a
 * second parameter beside it. One predicate so the rule has one definition:
 * written inline it was already spelled twice, on two different field pairs,
 * with a twenty-line docblock over only one of them.
 */
export function audibleAtDb(levelDb: number): boolean {
  return levelDb > SYNTH_GAIN_FLOOR_DB;
}

/** Linear gain from a relative dB value. 0 dB is unity. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Relative dB from a linear gain, floored at `SYNTH_GAIN_FLOOR_DB` rather
 * than returning `-Infinity` (or `NaN`) at or below zero gain.
 */
export function gainToDb(gain: number): number {
  if (gain <= 0) {
    return SYNTH_GAIN_FLOOR_DB;
  }
  const db = 20 * Math.log10(gain);
  return db < SYNTH_GAIN_FLOOR_DB ? SYNTH_GAIN_FLOOR_DB : db;
}

/** Frequency ratio for a signed semitone offset. +12 is one octave up (ratio 2). */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** The two oscillator level fields `oscillatorBalance`/`writeOscillatorBalance` operate on. */
export interface OscillatorLevelPair {
  osc1Db: number;
  osc2Db: number;
}

/**
 * Reads the equal-power balance of a level pair: the fraction of the pair's
 * combined power (`gain^2`) carried by oscillator 2. 0 is fully osc1, 1 is
 * fully osc2, 0.5 is equal power. Both silent reads as centered — there is
 * no balance to recover from zero power.
 */
export function oscillatorBalance(pair: OscillatorLevelPair): number {
  const power1 = dbToGain(pair.osc1Db) ** 2;
  const power2 = dbToGain(pair.osc2Db) ** 2;
  const totalPower = power1 + power2;
  if (totalPower <= 0) {
    return 0.5;
  }
  return power2 / totalPower;
}

/**
 * Writes an equal-power balance by redistributing the pair's existing
 * combined power between the two oscillators, so combined power is
 * preserved across the write — this crossfades, it never changes overall
 * loudness. `balance` is clamped to 0..1; an out-of-range value silently
 * clamps to the nearest end rather than producing an invalid patch.
 */
export function writeOscillatorBalance(pair: OscillatorLevelPair, balance: number): OscillatorLevelPair {
  const clamped = Math.max(0, Math.min(1, balance));
  const power1 = dbToGain(pair.osc1Db) ** 2;
  const power2 = dbToGain(pair.osc2Db) ** 2;
  const totalPower = power1 + power2;
  const nextPower2 = clamped * totalPower;
  const nextPower1 = totalPower - nextPower2;
  return {
    osc1Db: gainToDb(Math.sqrt(nextPower1)),
    osc2Db: gainToDb(Math.sqrt(nextPower2)),
  };
}

const BEATS_PER_WHOLE_NOTE = 4;

/** Duration multiplier for a division's modifier: dotted lengthens by half, triplet shortens by a third. */
function modifierFactor(modifier: NoteDivision['modifier']): number {
  switch (modifier) {
    case 'dotted':
      return 1.5;
    case 'triplet':
      return 2 / 3;
    case 'straight':
      return 1;
  }
}

/** The LFO's synced rate in Hz for a given division at a given tempo. */
export function lfoRateHz(division: NoteDivision, bpm: number): number {
  const baseDurationBeats = BEATS_PER_WHOLE_NOTE / division.value;
  const durationBeats = baseDurationBeats * modifierFactor(division.modifier);
  const secondsPerBeat = 60 / bpm;
  const durationSeconds = durationBeats * secondsPerBeat;
  return 1 / durationSeconds;
}

/**
 * A route's effective modulation amount at a given depth (0..1): `depth *
 * route.amount`, per the design doc's "LFO output is depth * route.amount".
 * `pan`'s unit is bounded -1..1, so it is the one target family clamped
 * here; every other family's unit (semitones, dB, normalized delta) is
 * unbounded and passes the signed scaled value through untouched.
 */
export function modulationAmount(route: ModRoute, depth: number): number {
  const scaled = route.amount * depth;
  return route.target === 'pan' ? Math.max(-1, Math.min(1, scaled)) : scaled;
}

/**
 * The amp envelope's release, in seconds — the value a note-off has to be
 * given so a voice fades over its own tail rather than a caller's guess.
 *
 * It exists because every playback bridge needs it and
 * `synth.patch.synth.ampEnvelope.release` reads like a typo at a call site.
 * ENV1 is permanently wired to amplitude (see `SubtractiveParams`), so this is
 * the release of the voice, not of one modulation route among several.
 */
export function synthReleaseSeconds(synth: ActiveSynth): number {
  return synth.patch.synth.ampEnvelope.release;
}

/**
 * The slope of `10^(x/20)` at unity gain — one dB expressed as a linear delta
 * about 1.0. A dB-unit modulation route is summed into a gain whose scheduled
 * base is 1, so the summed value is `1 + amount * depth * GAIN_PER_DB_AT_UNITY`.
 */
export const GAIN_PER_DB_AT_UNITY = Math.LN10 / 20;

/**
 * Per-unit bounds for a modulation route's amount — the ONE statement of this
 * range, read by the patch validator (`sanitizeSynth.ts`) and by the Pro
 * amount knob (`proControls.tsx`) alike.
 *
 * These are the bounds for a route in general; an LFO route carries a second,
 * TIGHTER dB bound — see `LFO_DB_ROUTE_LIMIT` below.
 *
 * Stated here rather than beside either reader because two copies is how the
 * knob came to offer -48 dB while the validator accepted -96: a stored route
 * the knob could not represent rendered pinned at its own minimum, reporting an
 * `aria-valuenow` below its own `aria-valuemin`, and snapped the patch on first
 * touch.
 */
export const MOD_ROUTE_RANGES = {
  semitones: { min: -48, max: 48, step: 1 },
  db: { min: SYNTH_GAIN_FLOOR_DB, max: 12, step: 0.5 },
  normalized: { min: -1, max: 1, step: 0.01 },
  pan: { min: -1, max: 1, step: 0.01 },
} as const satisfies Record<ModRoute['unit'], { min: number; max: number; step: number }>;

/**
 * The deepest a dB route may go when an LFO drives it: ~8.686 dB.
 *
 * `subtractiveVoice.ts` states this as the validator's job — "a route deeper
 * than about +-8.7 dB would take the gain through zero and invert phase, which
 * is a depth limit for the patch validator rather than something to disguise
 * here with a clamp that would silently mean a different depth than the number
 * on the knob" — and `1 / GAIN_PER_DB_AT_UNITY` is that limit exactly. At it
 * the summed gain sweeps 0..2: full tremolo that touches silence and never
 * goes negative. Past it the trough is below zero and the voice inverts phase
 * for part of every cycle.
 *
 * LFO ROUTES ONLY. An ENV2 route shares the `ModRoute` shape but not the
 * arithmetic — it is scheduled as an explicit base-to-peak envelope on the
 * param rather than summed bipolar into a gain based at 1, so it has no trough
 * to take through zero. Capping both is what clamped `factory-fm-tine-piano`'s
 * legitimate +10 dB ENV2 route.
 */
export const LFO_DB_ROUTE_LIMIT = 1 / GAIN_PER_DB_AT_UNITY;

/**
 * A fresh route for a target, at the modest default amount its unit family
 * calls modest.
 *
 * Not zero. A route whose amount is zero is assigned and silent, so choosing a
 * destination would appear to do nothing at all and the obvious next move —
 * turning the amount up — is the one the user has no reason to make. These are
 * audible but not violent: an octave of pitch, 6 dB of level, a fifth of the
 * resonance range, half of one side of the stereo field.
 */
export function defaultRouteFor(target: ModTarget): ModRoute {
  switch (target) {
    case 'pitch-all':
    case 'osc1-pitch':
    case 'osc2-pitch':
    case 'filter-cutoff':
      return { target, unit: 'semitones', amount: 12 };
    case 'osc1-level':
    case 'osc2-level':
    case 'amplitude':
      return { target, unit: 'db', amount: -6 };
    case 'filter-resonance':
      return { target, unit: 'normalized', amount: 0.2 };
    case 'pan':
      return { target, unit: 'pan', amount: 0.5 };
  }
}
