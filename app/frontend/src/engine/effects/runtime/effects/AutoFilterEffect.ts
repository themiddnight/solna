import { AutoFilter } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { applyWetDry, connectToneEffect } from "./EffectsHelper";

export function createAutoFilterEffect(context: AudioContext, id?: string): AudioEffect {
  const autoFilter = new AutoFilter(1, 400, 2.6);

  // Create dry/wet mixing nodes
  const inputGain = context.createGain();
  const wetGain = context.createGain();
  const dryGain = context.createGain();
  const outputGain = context.createGain();

  // Set initial dry/wet balance
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  // Connect the network using helper
  connectToneEffect(inputGain, autoFilter, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("frequency", {
    name: "Frequency",
    value: 1,
    min: 1,
    max: 20,
    unit: "Hz",
  });
  parameters.set("baseFrequency", {
    name: "Base Frequency",
    value: 400,
    min: 50,
    max: 2000,
    unit: "Hz",
  });
  parameters.set("octaves", {
    name: "Octaves",
    value: 2.6,
    min: 0.5,
    max: 8,
    unit: "",
  });
  parameters.set("type", {
    name: "Filter Type",
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
    id: id || `autofilter_${Date.now()}`,
    type: EFFECT_TYPE.AUTOFILTER,
    name: "AutoFilter",
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
          autoFilter.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "baseFrequency":
          autoFilter.baseFrequency = v;
          break;
        case "octaves":
          autoFilter.octaves = v;
          break;
        case "type": {
          const types = ["lowpass", "highpass", "bandpass"];
          const typeIndex = Math.round(v);
          if (typeIndex >= 0 && typeIndex < types.length) {
            autoFilter.filter.type = types[typeIndex] as BiquadFilterType;
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
      autoFilter.start();
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 0.5;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      autoFilter.stop();
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        (autoFilter as { dispose?: () => void }).dispose?.();
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
