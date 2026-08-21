import { Tremolo } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createTremoloEffect(context: AudioContext, id?: string): AudioEffect {
  const tremolo = new Tremolo({
    frequency: 10,
    depth: 0.5,
    spread: 40
  });

  // Start the tremolo LFO immediately
  tremolo.start();

  // Create dry/wet mixing nodes with STEREO configuration using helper
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Tier A pure transform: full wet, no dry path (Depth controls intensity).
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;

  // Connect the network using the helper
  connectToneEffect(inputGain, tremolo, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("frequency", {
    name: "Frequency",
    value: 10,
    min: 0.1,
    max: 20,
    unit: "Hz",
  });
  parameters.set("depth", {
    name: "Depth",
    value: 0.5,
    min: 0,
    max: 1,
    unit: "",
  });
  parameters.set("spread", {
    name: "Spread",
    value: 40,
    min: 0,
    max: 180,
    unit: "°",
  });
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: 1,
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `tremolo_${Date.now()}`,
    type: EFFECT_TYPE.TREMOLO,
    name: "Tremolo",
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
          tremolo.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "depth":
          tremolo.depth.setValueAtTime(v, context.currentTime);
          break;
        case "spread":
          tremolo.spread = v;
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
      tremolo.start();
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 1;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      tremolo.stop();
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        (tremolo as { dispose?: () => void }).dispose?.();
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
