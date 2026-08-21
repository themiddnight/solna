import { Reverb } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createReverbEffect(context: AudioContext, id?: string): AudioEffect {
  const reverb = new Reverb({ decay: 2, wet: 1 }); // fully wet — wrapper owns dry/wet

  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  connectToneEffect(inputGain, reverb, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("roomSize", { name: "Room Size", value: 0.7, min: 0, max: 1, unit: "" });
  parameters.set("decayTime", { name: "Decay Time", value: 2, min: 0.1, max: 10, unit: "s" });
  parameters.set("preDelay", { name: "Pre-Delay", value: 0.01, min: 0, max: 0.1, unit: "s" });
  parameters.set("wetLevel", { name: "Wet Level", value: 0.5, min: 0, max: 1, unit: "%" });

  return {
    id: id || `reverb_${Date.now()}`,
    type: EFFECT_TYPE.REVERB,
    name: "Reverb",
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
        case "wetLevel":
          applyWetDry(wetGain, dryGain, v, context);
          break;
        case "decayTime":
          reverb.decay = v;
          break;
        case "roomSize": {
          const currentDecay = this.parameters.get("decayTime")?.value ?? 2;
          reverb.decay = currentDecay * (0.5 + v * 1.5);
          break;
        }
        case "preDelay":
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    enable(): void {
      this.enabled = true;
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 0.5;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        (reverb as { dispose?: () => void }).dispose?.();
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
