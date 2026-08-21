import type { AudioEffect, EffectType } from "./audioEffectTypes";
import type { EffectInstanceState } from "@/shared/types";
import { EffectsFactory } from "./EffectsFactory";
import { EFFECT_PARAMETER_NAME_MAP, normalizeEffectParameterName } from "./effectParameterMapping";

/**
 * Turn serialized effect state into live `AudioEffect` instances.
 *
 * Extracted from `MixerEngine` when the master chain (DEV-323) made it the second caller and
 * pushed the file past the TR-20 line cap. Both callers need the identical sequence — sort by
 * order, resolve the type, instantiate, map and apply each parameter name, honour bypass — and
 * they differ only in where the finished nodes are wired, which stays with the caller.
 *
 * The parameter-name mapping is the part worth not duplicating: a serialized name goes through
 * `normalizeEffectParameterName` and then a per-effect-type alias table, and a second copy that
 * drifted would apply some parameters to the wrong control on one chain but not the other.
 */
export function buildEffectChain(
  effects: EffectInstanceState[],
  resolveEffectType: (type: string) => EffectType | null,
  /** Used only in warnings, to say which chain a bad effect came from. */
  chainLabel: string,
): AudioEffect[] {
  const built: AudioEffect[] = [];

  for (const effectState of [...effects].sort((a, b) => a.order - b.order)) {
    const effectType = resolveEffectType(effectState.type);
    if (effectType == null) {
      console.warn(`[MixerEngine] Unknown effect type on ${chainLabel}:`, effectState.type);
      continue;
    }

    const effect = EffectsFactory.createEffect(effectType, effectState.id);
    if (!effect) {
      console.warn(`[MixerEngine] Failed to instantiate ${effectState.type} on ${chainLabel}`);
      continue;
    }

    for (const parameter of effectState.parameters) {
      try {
        const normalizedName = normalizeEffectParameterName(parameter.name);
        const mappedName =
          EFFECT_PARAMETER_NAME_MAP[effectState.type]?.[normalizedName] ?? parameter.name;
        effect.setParameter(mappedName, parameter.value);
      } catch (error) {
        console.warn(
          `[MixerEngine] Failed to set ${parameter.name} on ${effectState.id} (${chainLabel}):`,
          error,
        );
      }
    }

    if (effectState.bypassed) effect.disable();
    else effect.enable();

    built.push(effect);
  }

  return built;
}
