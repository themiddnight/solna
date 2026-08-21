import { StereoWidener } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, connectToneEffect, applyWetDry } from "./EffectsHelper";

export function createStereoWidenerEffect(context: AudioContext, id?: string): AudioEffect {
  const stereoWidener = new StereoWidener(0.5);

  // Create dry/wet mixing nodes with STEREO configuration using helper
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Create stereo enhancement components for mono-to-stereo conversion
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const leftDelay = context.createDelay(0.1);
  const rightDelay = context.createDelay(0.1);

  // Set initial dry/wet balance
  wetGain.gain.value = 0.5;
  dryGain.gain.value = 0.5;

  // Set subtle delays for stereo width enhancement (Haas effect)
  leftDelay.delayTime.value = 0.001; // 1ms delay on left
  rightDelay.delayTime.value = 0.002; // 2ms delay on right

  // Enhanced stereo routing
  try {
    // Split mono input into stereo channels with slight delays
    inputGain.connect(splitter);
    splitter.connect(leftDelay, 0, 0);
    splitter.connect(rightDelay, 0, 0);

    // Merge delays back to stereo for widener processing
    leftDelay.connect(merger, 0, 0);
    rightDelay.connect(merger, 0, 1);

    // Process through stereo widener
    merger.connect(stereoWidener.input as unknown as AudioNode);
    (stereoWidener.output as unknown as AudioNode).connect(wetGain);

    // Dry path with stereo split
    inputGain.connect(dryGain);

    // Mix dry and wet to output
    dryGain.connect(outputGain);
    wetGain.connect(outputGain);
  } catch (error) {
    console.error("[Effects] Failed to connect StereoWidener with enhancement:", error);
    // Fallback to helper method
    connectToneEffect(inputGain, stereoWidener, wetGain, dryGain, outputGain);
  }

  const parameters = new Map<string, EffectParameter>();
  parameters.set("width", {
    name: "Width",
    value: 0.5,
    min: 0,
    max: 1,
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
    id: id || `stereowidener_${Date.now()}`,
    type: EFFECT_TYPE.STEREOWIDENER,
    name: "Stereo Widener",
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
        case "width":
          stereoWidener.width.setValueAtTime(v, context.currentTime);
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
        (stereoWidener as { dispose?: () => void }).dispose?.();
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
