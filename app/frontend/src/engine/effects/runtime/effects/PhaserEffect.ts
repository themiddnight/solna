import { Phaser } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createPhaserEffect(context: AudioContext, id?: string): AudioEffect {
  const phaser = new Phaser({
    frequency: 0.5,
    octaves: 3,
    baseFrequency: 350,
    stages: 4,
    Q: 10
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
  connectToneEffect(inputGain, phaser, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("frequency", {
    name: "Frequency",
    value: 0.5,
    min: 0.01,
    max: 10,
    unit: "Hz",
  });
  parameters.set("octaves", {
    name: "Octaves",
    value: 3,
    min: 0.5,
    max: 8,
    unit: "",
  });
  parameters.set("baseFrequency", {
    name: "Base Frequency",
    value: 350,
    min: 50,
    max: 2000,
    unit: "Hz",
  });
  parameters.set("stages", {
    name: "Stages",
    value: 4,
    min: 2,
    max: 8,
    unit: "",
  });
  parameters.set("Q", {
    name: "Q",
    value: 10,
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
    id: id || `phaser_${Date.now()}`,
    type: EFFECT_TYPE.PHASER,
    name: "Phaser",
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
        case "frequency":
          phaser.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "octaves":
          phaser.octaves = v;
          break;
        case "baseFrequency":
          phaser.baseFrequency = v;
          break;
        case "stages":
          // Phaser stages is read-only, store value for reference
          break;
        case "Q":
          phaser.Q.setValueAtTime(v, context.currentTime);
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
        (phaser as { dispose?: () => void }).dispose?.();
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
