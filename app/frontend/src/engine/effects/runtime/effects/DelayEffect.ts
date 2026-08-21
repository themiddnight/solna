import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { applyWetDry } from "./EffectsHelper";

export function createDelayEffect(context: AudioContext, id?: string): AudioEffect {
  const inputGain = context.createGain();
  const delayNode = context.createDelay(1.0);
  const feedbackGain = context.createGain();
  const wetGain = context.createGain();
  const dryGain = context.createGain();
  const outputGain = context.createGain();

  // Set initial values
  delayNode.delayTime.value = 0.25;
  feedbackGain.gain.value = 0.3;
  wetGain.gain.value = 0.3;
  dryGain.gain.value = 0.7;

  // Connect delay network
  inputGain.connect(delayNode);
  inputGain.connect(dryGain);
  delayNode.connect(feedbackGain);
  feedbackGain.connect(delayNode);
  delayNode.connect(wetGain);
  wetGain.connect(outputGain);
  dryGain.connect(outputGain);

  const inputNode = inputGain;
  const outputNode = outputGain;

  const parameters = new Map<string, EffectParameter>();
  parameters.set("delayTime", {
    name: "Delay Time",
    value: delayNode.delayTime.value,
    min: 0.01,
    max: 1.0,
    unit: "s",
  });
  parameters.set("feedback", {
    name: "Feedback",
    value: feedbackGain.gain.value,
    min: 0,
    max: 0.95,
    unit: "%",
  });
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: wetGain.gain.value,
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `delay_${Date.now()}`,
    type: EFFECT_TYPE.DELAY,
    name: "Delay",
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
        case "delayTime":
          delayNode.delayTime.setValueAtTime(v, context.currentTime);
          break;
        case "feedback":
          feedbackGain.gain.setValueAtTime(v, context.currentTime);
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
        inputGain.disconnect();
        delayNode.disconnect();
        feedbackGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
