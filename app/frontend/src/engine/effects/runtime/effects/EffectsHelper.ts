/**
 * Creates a GainNode with stereo configuration to preserve stereo signals throughout the audio chain.
 */
export function createStereoGainNode(context: AudioContext): GainNode {
  const gain = context.createGain();
  gain.channelCount = 2;
  gain.channelCountMode = "explicit";
  gain.channelInterpretation = "speakers";
  return gain;
}

/** Pure equal-power dry/wet law. wet ∈ [0,1]: 0 = full dry, 1 = full wet.
 *  Equal power (sin/cos) keeps perceived loudness constant across the sweep
 *  and matches Tone's own CrossFade — unlike a linear wet/(1-wet) sum, which
 *  bumps the midpoint ~+3 dB for correlated signals. */
export function equalPowerGains(wet: number): { wet: number; dry: number } {
  const t = Math.max(0, Math.min(1, wet));
  return {
    wet: Math.sin((t * Math.PI) / 2),
    dry: Math.cos((t * Math.PI) / 2),
  };
}

/** Sole dry/wet mixer for every effect wrapper. Sets wetGain/dryGain to the
 *  equal-power split for `wet`. Tone effects stay fully wet internally
 *  (.wet = 1) so this wrapper owns the entire blend. */
export function applyWetDry(
  wetGain: GainNode,
  dryGain: GainNode,
  wet: number,
  context: AudioContext,
): void {
  const g = equalPowerGains(wet);
  const now = context.currentTime;
  wetGain.gain.setValueAtTime(g.wet, now);
  dryGain.gain.setValueAtTime(g.dry, now);
}

/**
 * Connects Tone.js effects safely to native Web Audio nodes, handling different Tone.js versions.
 */
export function connectToneEffect(
  inputGain: GainNode,
  toneEffect: unknown,
  wetGain: GainNode,
  dryGain: GainNode,
  outputGain: GainNode
): void {
  try {
    // Connect dry path
    inputGain.connect(dryGain);
    dryGain.connect(outputGain);

    const effect = toneEffect as {
      input?: { input?: AudioNode; connect?: (dest: AudioNode) => void };
      output?: { output?: AudioNode; connect?: (dest: AudioNode) => void };
    };

    // Connect wet path through Tone effect
    if (effect.input?.input) {
      // Newer Tone.js structure
      inputGain.connect(effect.input.input);
      const outputNode = effect.output?.output;
      if (outputNode && typeof (outputNode as unknown as Record<string, unknown>).connect === 'function') {
        (outputNode as unknown as { connect: (dest: AudioNode) => void }).connect(wetGain);
      }
    } else if (effect.input && effect.output) {
      // Older structure or direct nodes
      inputGain.connect(effect.input as unknown as AudioNode);
      effect.output.connect?.(wetGain);
    } else {
      throw new Error("Cannot determine Tone.js input/output structure");
    }

    wetGain.connect(outputGain);
  } catch {
    // Fallback: bypass Tone effect
    inputGain.connect(dryGain);
    dryGain.connect(outputGain);
  }
}
