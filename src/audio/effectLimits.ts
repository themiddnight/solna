import type { MasterEffects } from '../types';

/**
 * The single source of truth for every numeric MasterEffects range.
 *
 * Two places need it and used to disagree: engine.updateEffects wrote raw
 * values onto AudioParams, and store.sanitizePersistedState clamped only two
 * fields. A persisted project with delayFeedback >= 1 is a runaway feedback
 * loop into the limiter — the audible failure that motivated this table.
 *
 * `fallback` is what a non-finite or non-numeric persisted value becomes; it
 * equals INITIAL_EFFECTS for every key.
 */
export type EffectNumericKey =
  | 'reverbWet'
  | 'reverbDecay'
  | 'delayWet'
  | 'delayFeedback'
  | 'distortionWet'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'compressorThreshold';

export const EFFECT_LIMITS: Record<
  EffectNumericKey,
  { min: number; max: number; fallback: number }
> = {
  reverbWet: { min: 0, max: 1, fallback: 0.25 },
  // Decay is the impulse's DURATION in seconds (see engine.buildImpulseResponse).
  // 10 s is far past the UI knob's 6 s ceiling but keeps an imported project
  // usable instead of silently retuned.
  reverbDecay: { min: 0.1, max: 10, fallback: 2.0 },
  delayWet: { min: 0, max: 1, fallback: 0.2 },
  // 0.95 rather than 1: at 1 the feedback loop never decays.
  delayFeedback: { min: 0, max: 0.95, fallback: 0.35 },
  distortionWet: { min: 0, max: 1, fallback: 0.1 },
  eqLow: { min: -24, max: 24, fallback: 2 },
  eqMid: { min: -24, max: 24, fallback: 0 },
  eqHigh: { min: -24, max: 24, fallback: 3 },
  compressorThreshold: { min: -60, max: 0, fallback: -12 },
};

export function clampEffectValue(key: EffectNumericKey, value: unknown): number {
  const { min, max, fallback } = EFFECT_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** A copy of `fx` with every numeric field inside its range. Booleans pass through. */
export function clampEffects(fx: MasterEffects): MasterEffects {
  const out = { ...fx };
  for (const key of Object.keys(EFFECT_LIMITS) as EffectNumericKey[]) {
    out[key] = clampEffectValue(key, fx[key]);
  }
  return out;
}
