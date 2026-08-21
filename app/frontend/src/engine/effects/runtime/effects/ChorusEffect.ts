import { Chorus } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createChorusEffect(context: AudioContext, id?: string): AudioEffect {
  const chorus = new Chorus({
    frequency: 1.5,
    delayTime: 3.5,
    depth: 0.7,
    spread: 180
  });

  // Create dry/wet mixing nodes with STEREO configuration using helper
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Set initial dry/wet balance
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  // Connect using helper
  connectToneEffect(inputGain, chorus, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("frequency", {
    name: "Frequency",
    value: 1.5,
    min: 0.01,
    max: 20,
    unit: "Hz",
  });
  parameters.set("delayTime", {
    name: "Delay Time",
    value: 3.5,
    min: 1,
    max: 20,
    unit: "ms",
  });
  parameters.set("depth", {
    name: "Depth",
    value: 0.7,
    min: 0,
    max: 1,
    unit: "",
  });
  parameters.set("spread", {
    name: "Spread",
    value: 180,
    min: 0,
    max: 180,
    unit: "°",
  });
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: 0.5,
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `chorus_${Date.now()}`,
    type: EFFECT_TYPE.CHORUS,
    name: "Chorus",
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
          chorus.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "delayTime":
          chorus.delayTime = v;
          break;
        case "depth":
          chorus.depth = v;
          break;
        case "spread":
          chorus.spread = v;
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
      chorus.start();
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 0.5;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      chorus.stop();
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        (chorus as { dispose?: () => void }).dispose?.();
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
