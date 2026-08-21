import { connect, disconnect } from "tone";
import type { AudioEffect, UserChannel } from "./audioEffectTypes";

/** True when `node` is a native Web Audio node (not a Tone.js wrapper). */
function isNativeAudioNode(node: unknown): node is AudioNode {
  return typeof AudioNode !== "undefined" && node instanceof AudioNode;
}

/**
 * Connect two nodes in the effect graph, bridging native Web Audio nodes and
 * Tone.js nodes. Moved here from MixerEngine (DEV-347 Task 1) so the edge-patch
 * helpers below share the mixer's connection bridge.
 */
export function connectNodes(source: unknown, destination: unknown): void {
  if (source == null || destination == null) return;

  // Prefer native connect when both nodes are from the Web Audio API.
  if (isNativeAudioNode(source) && isNativeAudioNode(destination)) {
    try {
      (source as AudioNode).connect(destination as AudioNode);
      return;
    } catch {
      console.warn("[MixerEngine] Native connect failed", source);
    }
  }

  // Fallback to connect for ToneAudioNode bridging (handles Tone <-> native)
  try {
    (connect as (src: unknown, dest: unknown, outputNum?: number, inputNum?: number) => void)(source, destination);
    return;
  } catch (toneError) {
    // Last resort: call connect on source if available
    try {
      (source as { connect?: (dest: unknown) => void }).connect?.(destination);
    } catch (nativeError) {
      console.warn("[MixerEngine] Failed to connect nodes", {
        toneError,
        nativeError,
      });
    }
  }
}

/**
 * Patch a freshly appended effect into the end of the channel's effect chain
 * (DEV-347 Task 1). Touches only the two edges around the new effect:
 * `prev → newEffect.inputNode` and `newEffect.outputNode → toneChannel`, where
 * `prev` is the node that used to feed `toneChannel` — the previous effect's
 * output, or `monoToStereoOutput` when the chain was empty.
 *
 * Caller contract: `addEffectToChannel` has already pushed the new effect onto
 * `channel.effectChain` before calling this.
 */
export function patchEffectIntoChainEnd(channel: UserChannel): void {
  const chain = channel.effectChain;
  const newEffect = chain[chain.length - 1];
  if (newEffect == null) return;

  const prevEffect = chain.length >= 2 ? chain[chain.length - 2] : undefined;
  const source = prevEffect?.outputNode ?? channel.monoToStereoOutput;
  const target = channel.toneChannel;
  if (source == null || target == null) return;

  // Repoint the edge that used to feed toneChannel at the new effect...
  // Target only the chain edge: `source` may carry parallel taps (e.g. the
  // GraphicEQ visualizer's output analyser, GraphicEQVisualizer.tsx), and a
  // bare disconnect() would sever those too. tone's `disconnect` is the
  // inverse of the `connect` bridge in `connectNodes`, so it resolves a Tone
  // destination to its native `.input` and matches the edge actually created.
  disconnect(source, target);
  connectNodes(source, newEffect.inputNode);
  // ...and hang the new effect where the chain used to end.
  connectNodes(newEffect.outputNode, target);
}

/**
 * Patch a removed effect out of the channel's effect chain (DEV-347 Task 1).
 * Touches only the two edges around the removed effect: `prev → next` and the
 * removed effect's own output disconnect, where `prev` is the previous
 * effect's output (or `monoToStereoOutput` when the removed effect was first)
 * and `next` is the following effect's input (or `toneChannel` when the
 * removed effect was last).
 *
 * Caller contract: `removeEffectFromChannel` has already spliced the removed
 * effect out of `channel.effectChain`; `removedIndex` is its original index —
 * after the splice, `chain[removedIndex]` IS the next effect.
 */
export function patchEffectOutOfChain(
  channel: UserChannel,
  removedEffect: AudioEffect,
  removedIndex: number,
): void {
  const chain = channel.effectChain;
  const prevEffect = removedIndex >= 1 ? chain[removedIndex - 1] : undefined;
  const source = prevEffect?.outputNode ?? channel.monoToStereoOutput;
  const nextEffect = removedIndex < chain.length ? chain[removedIndex] : undefined;
  const target = nextEffect?.inputNode ?? channel.toneChannel;
  if (source == null || target == null) return;

  // Rewire around the removed effect BEFORE detaching its nodes, so the chain
  // never has a gap. Sever only the source → removed-effect edge (tone's
  // `disconnect`, matching the bridge in `connectNodes`): `source` may carry
  // parallel visualizer taps that a bare disconnect() would kill. The removed
  // effect's own output is disconnected bare below because it is torn down
  // with the effect.
  disconnect(source, removedEffect.inputNode);
  connectNodes(source, target);
  removedEffect.outputNode.disconnect();
}
