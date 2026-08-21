import { Distortion } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createDistortionEffect(context: AudioContext, id?: string): AudioEffect {
  const distortion = new Distortion({
    distortion: 0.4,
    oversample: "none"
  });

  // Create dry/wet mixing nodes with STEREO configuration using helper
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Set initial dry/wet balance
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  // Connect the network using the helper
  connectToneEffect(inputGain, distortion, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("distortion", {
    name: "Distortion",
    value: 0.4,
    min: 0,
    max: 1,
    unit: "",
  });
  parameters.set("oversample", {
    name: "Oversample",
    value: 0,
    min: 0,
    max: 2,
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
    id: id || `distortion_${Date.now()}`,
    type: EFFECT_TYPE.DISTORTION,
    name: "Distortion",
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
        case "distortion":
          distortion.distortion = v;
          break;
        case "oversample": {
          const oversampleModes = ["none", "2x", "4x"];
          const modeIndex = Math.round(v);
          if (modeIndex >= 0 && modeIndex < oversampleModes.length) {
            distortion.oversample = oversampleModes[modeIndex] as "none" | "2x" | "4x";
          }
          break;
        }
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
        (distortion as { dispose?: () => void }).dispose?.();
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
