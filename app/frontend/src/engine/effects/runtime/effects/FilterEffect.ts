import { Filter } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { applyWetDry, connectToneEffect } from "./EffectsHelper";

export function createFilterEffect(context: AudioContext, id?: string): AudioEffect {
  const filter = new Filter({ type: "lowpass", frequency: 1000, Q: 1 });

  // Create dry/wet mixing nodes
  const inputGain = context.createGain();
  const wetGain = context.createGain();
  const dryGain = context.createGain();
  const outputGain = context.createGain();

  // Set initial dry/wet balance (100% wet for filter)
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;

  // Connect the network using Tone-aware helper to avoid context mismatches
  connectToneEffect(inputGain, filter, wetGain, dryGain, outputGain);

  const inputNode = inputGain;
  const outputNode = outputGain;

  const parameters = new Map<string, EffectParameter>();
  parameters.set("frequency", {
    name: "Frequency",
    value: filter.frequency.value as number,
    min: 20,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("Q", {
    name: "Resonance",
    value: filter.Q.value as number,
    min: 0.1,
    max: 30,
    unit: "Q",
  });
  parameters.set("type", {
    name: "Type",
    value: 0, // 0=lowpass, 1=highpass, 2=bandpass
    min: 0,
    max: 2,
    unit: "",
  });
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: 1, // Filter is typically 100% wet
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `filter_${Date.now()}`,
    type: EFFECT_TYPE.FILTER,
    name: "Filter",
    enabled: true,
    parameters,
    inputNode,
    outputNode,
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
          filter.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "Q":
          filter.Q.setValueAtTime(v, context.currentTime);
          break;
        case "type": {
          const types = ["lowpass", "highpass", "bandpass"];
          const typeIndex = Math.round(v);
          if (typeIndex >= 0 && typeIndex < types.length) {
            filter.type = types[typeIndex] as BiquadFilterType;
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
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 1;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        (filter as { dispose?: () => void }).dispose?.();
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
