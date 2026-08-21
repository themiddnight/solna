import { BitCrusher } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createBitCrusherEffect(context: AudioContext, id?: string): AudioEffect {
  let bitCrusher = new BitCrusher(8);

  // Create dry/wet mixing nodes with STEREO configuration using helper
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Set initial dry/wet balance
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  // Connect the network using the helper
  connectToneEffect(inputGain, bitCrusher, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("bits", {
    name: "Bits",
    value: 8,
    min: 1,
    max: 16,
    unit: "",
  });
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: 0.5,
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `bitcrusher_${Date.now()}`,
    type: EFFECT_TYPE.BITCRUSHER,
    name: "BitCrusher",
    enabled: true,
    parameters,
    inputNode: inputGain,
    outputNode: outputGain,
    wetGainNode: wetGain,
    dryGainNode: dryGain,
    bypass: false,

    process(input: AudioNode): AudioNode {
      input.connect(this.inputNode);
      return this.outputNode;
    },

    setParameter(name: string, value: number): void {
      const param = this.parameters.get(name);
      if (!param) return;
      const v = Math.max(param.min, Math.min(param.max, value));
      param.value = v;
      switch (name) {
        case "bits":
          // BitCrusher bits needs recreation - disconnect old, create new
          try {
            const toneNode = bitCrusher as unknown as { input?: AudioNode; output?: { disconnect: () => void }; dispose?: () => void };
            toneNode.output?.disconnect();
            inputGain.disconnect(toneNode.input!);
            toneNode.dispose?.();

            // Create new BitCrusher with new bits value
            bitCrusher = new BitCrusher(Math.round(v));

            // Reconnect using the helper
            connectToneEffect(inputGain, bitCrusher, wetGain, dryGain, outputGain);
          } catch (error) {
            console.warn('[BitCrusher] Failed to update bits parameter:', error);
          }
          break;
        case "wetLevel":
          applyWetDry(wetGain, dryGain, v, context);
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    enable(): void {
      this.enabled = true;
      // Restore wet/dry balance
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 0.5;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      // Bypass: full dry, no wet signal
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        (bitCrusher as { dispose?: () => void }).dispose?.();
        inputGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
