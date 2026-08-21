/**
 * effectsArchitecture.ts — Barrel file for backward compatibility.
 *
 * The implementation has been split into two focused modules:
 *  - EffectsFactory.ts  — Creates and manages audio effect instances
 *  - MixerEngine.ts     — Manages user channels, aux buses, master section + singleton helpers
 *
 * All existing import sites can continue using this path without change.
 */

export { EFFECT_TYPE } from "./audioEffectTypes";
export type {
  EffectType,
  AudioEffect,
  AuxBus,
  EffectParameter,
  MasterSection,
  UserChannel,
} from "./audioEffectTypes";

export { EffectsFactory } from "./EffectsFactory";
export type { VoiceRouting } from "./voiceVolumeController";
export {
  MixerEngine,
  getOrCreateGlobalMixer,
  getGlobalMixer,
  resetGlobalMixer,
  MIXER_VOLUME_MIN_DB,
  MIXER_VOLUME_MAX_DB,
} from "./MixerEngine";
