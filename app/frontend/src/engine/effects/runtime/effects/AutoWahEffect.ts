import { AutoWah } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createAutoWahEffect(context: AudioContext, id?: string): AudioEffect {
  const autoWah = new AutoWah({
    baseFrequency: 100,
    octaves: 6,
    sensitivity: 0,
    Q: 2
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
  connectToneEffect(inputGain, autoWah, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("baseFrequency", {
    name: "Base Frequency",
    value: 100,
    min: 50,
    max: 1000,
    unit: "Hz",
  });
  parameters.set("octaves", {
    name: "Octaves",
    value: 6,
    min: 1,
    max: 8,
    unit: "",
  });
  parameters.set("sensitivity", {
    name: "Sensitivity",
    value: 0,
    min: -40,
    max: 0,
    unit: "dB",
  });
  parameters.set("Q", {
    name: "Q",
    value: 2,
    min: 0.1,
    max: 30,
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
    id: id || `autowah_${Date.now()}`,
    type: EFFECT_TYPE.AUTOWAH,
    name: "AutoWah",
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
        case "baseFrequency":
          autoWah.baseFrequency = v;
          break;
        case "octaves":
          autoWah.octaves = v;
          break;
        case "sensitivity":
          autoWah.sensitivity = v;
          break;
        case "Q":
          autoWah.Q.setValueAtTime(v, context.currentTime);
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
        (autoWah as { dispose?: () => void }).dispose?.();
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
