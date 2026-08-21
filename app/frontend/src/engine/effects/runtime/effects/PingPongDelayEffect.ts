import { PingPongDelay } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createPingPongDelayEffect(context: AudioContext, id?: string): AudioEffect {
  const pingPongDelay = new PingPongDelay({ delayTime: 0.25, feedback: 0.3, wet: 1 });

  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  connectToneEffect(inputGain, pingPongDelay, wetGain, dryGain, outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("delayTime", { name: "Delay Time", value: 0.25, min: 0.01, max: 1, unit: "s" });
  parameters.set("feedback", { name: "Feedback", value: 0.3, min: 0, max: 0.95, unit: "" });
  parameters.set("wetLevel", { name: "Wet Level", value: 0.5, min: 0, max: 1, unit: "%" });

  return {
    id: id || `pingpongdelay_${Date.now()}`,
    type: EFFECT_TYPE.PINGPONGDELAY,
    name: "Ping Pong Delay",
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
        case "delayTime":
          pingPongDelay.delayTime.value = v;
          break;
        case "feedback":
          pingPongDelay.feedback.value = v;
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
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 0.5;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      applyWetDry(wetGain, dryGain, 0, context);
    },

    cleanup(): void {
      try {
        pingPongDelay.dispose();
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
