/**
 * Runtime barrel — Web-Audio effect runtime + mixer.
 *
 * Room-agnostic capability: creates/pools effect instances (Tone.js-backed)
 * and manages the per-app singleton mixer (user channels, aux buses, master
 * section). See `model/` for the effect-type contract these operate on.
 */

// Runtime-only effect model types (the canonical EffectType/EFFECT_TYPE
// contract lives in ../model — re-exported at the top-level ../index.ts)
export type {
  AudioEffect,
  AuxBus,
  EffectParameter,
  MasterSection,
  UserChannel,
} from "./audioEffectTypes";

// Effect instance factory (pooling)
export { EffectsFactory } from "./EffectsFactory";

// Mixer engine + global singleton accessors
export { MixerEngine, getOrCreateGlobalMixer, getGlobalMixer, resetGlobalMixer } from "./MixerEngine";

// Snake↔camel effect-parameter name bridge
export { EFFECT_PARAMETER_NAME_MAP, normalizeEffectParameterName } from "./effectParameterMapping";
