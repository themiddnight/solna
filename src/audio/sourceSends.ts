/**
 * Per-source send nodes into the three shared master effects (DEV-423).
 *
 * Every source bus owns three `GainNode`s, one per effect, fed from the bus
 * OUTPUT — so fader, mute and solo (all written to the bus gain) apply to the
 * sends too. `MasterRack` owns the nodes and the graph; this module only
 * builds and automates them, which keeps the node code out of `masterRack.ts`.
 * It holds no state.
 */
import { SEND_EFFECTS, type SendEffect, type TrackSendLevels } from '../types';
import { applySourceBusAutomation, type SourceBusApplyMode } from './automation/sourceBusAutomation';

export type SourceSendNodes = Record<SendEffect, GainNode>;

function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/** Clamp each level to 0..1; a non-finite level becomes 0. */
export function clampSendLevels(sends: TrackSendLevels): TrackSendLevels {
  return {
    reverb: clampLevel(sends.reverb),
    delay: clampLevel(sends.delay),
    distortion: clampLevel(sends.distortion),
  };
}

/**
 * Three GainNodes seeded at `seed`, or 0 for a source that has been told no
 * level yet. Silent until told, on the "every wet send is seeded at ZERO"
 * precedent in `setupMasterChain`: the store's defaults arrive through
 * `applyEngineSnapshot` live and `applyMasterState` offline, so the audio
 * layer never repeats them.
 */
export function createSourceSendNodes(
  ctx: BaseAudioContext,
  seed: TrackSendLevels | undefined,
): SourceSendNodes {
  const node = (effect: SendEffect): GainNode => {
    const gain = ctx.createGain();
    gain.gain.value = seed?.[effect] ?? 0;
    return gain;
  };
  return { reverb: node('reverb'), delay: node('delay'), distortion: node('distortion') };
}

/** Automate all three nodes to `sends` at `at`, with the bus's own time constant and modes. */
export function applySourceSendLevels(
  nodes: SourceSendNodes,
  sends: TrackSendLevels,
  at: number,
  mode: SourceBusApplyMode,
  now: number,
): void {
  for (const effect of SEND_EFFECTS) {
    applySourceBusAutomation(nodes[effect].gain, sends[effect], at, mode, now);
  }
}
