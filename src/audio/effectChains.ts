// Lookups over EFFECT_CHAINS. Both build their return value per call.

import type { MasterEffects } from '../types';
import { EFFECT_CHAINS } from '@/data/effectChains';

/**
 * Look up an authored effect chain by library id. Module-private on purpose:
 * the fallible signature is exactly the hazard `requireEffectChain` below
 * exists to close, so nothing outside this file may reach it.
 *
 * Returns a FRESH shallow copy on every call — never the module's own object.
 * A shallow copy is sufficient and correct here: every value in a chain is a
 * scalar (number), so there is no nested structure for a copy to alias.
 * `resolveProgression` and `drumGridById` follow the same rule and also
 * return freshly built objects every call.
 */
function effectChainById(id: string): Partial<MasterEffects> | undefined {
  const chain = EFFECT_CHAINS[id];
  if (!chain) return undefined;
  return { ...chain };
}

/**
 * Same lookup as `effectChainById`, but throws on an unknown id instead of
 * returning `undefined`. Vibe authoring sites want this: spreading an
 * `undefined` chain over `store.effects` (`{ ...store.effects, ...undefined }`)
 * is a legal no-op, so a mistyped id would silently apply no effects change
 * instead of failing loudly the way an unknown drum-pattern or synth-preset id
 * already does.
 */
export function requireEffectChain(id: string): Partial<MasterEffects> {
  const chain = effectChainById(id);
  if (!chain) {
    throw new Error(`Unknown vibe effect chain id: ${id}`);
  }
  return chain;
}
