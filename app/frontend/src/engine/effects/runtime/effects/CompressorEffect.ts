import { Compressor } from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { applyWetDry } from "./EffectsHelper";
import { dbToGain, gainToDbfs, toDecibels, toLinearGain } from "@/shared/audio/gainUnits";

export function createCompressorEffect(context: AudioContext, id?: string): AudioEffect {
  const compressor = new Compressor({
    threshold: -12, // was -24 — DEV-313, see compressor/config.ts for rationale
    ratio: 4,
    attack: 0.003,
    release: 0.25,
    knee: 6, // was Tone's default 30 — DEV-313, see compressor/config.ts for rationale
  });

  // Create dry/wet mixing nodes
  const inputGain = context.createGain();
  const wetGain = context.createGain();
  const dryGain = context.createGain();
  const outputGain = context.createGain();
  const makeupGain = context.createGain();
  makeupGain.gain.value = 1; // 0 dB
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const levelBuffer = new Float32Array(analyser.fftSize);

  // Set initial dry/wet balance (100% wet for compressor)
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;

  // Connect the network
  inputGain.connect(compressor.input);
  inputGain.connect(dryGain);
  inputGain.connect(analyser); // tap (does not alter the path)
  (compressor.output as AudioNode).connect(makeupGain);
  makeupGain.connect(wetGain);
  wetGain.connect(outputGain);
  dryGain.connect(outputGain);

  const inputNode = inputGain;
  const outputNode = outputGain;

  const parameters = new Map<string, EffectParameter>();
  parameters.set("threshold", {
    name: "Threshold",
    value: compressor.threshold.value as number,
    min: -100,
    max: 0,
    unit: "dB",
  });
  parameters.set("ratio", {
    name: "Ratio",
    value: compressor.ratio.value as number,
    min: 1,
    max: 20,
    unit: ":1",
  });
  parameters.set("attack", {
    name: "Attack",
    value: compressor.attack.value as number,
    min: 0,
    max: 1,
    unit: "s",
  });
  parameters.set("release", {
    name: "Release",
    value: compressor.release.value as number,
    min: 0,
    max: 1,
    unit: "s",
  });
  parameters.set("knee", {
    name: "Knee",
    value: compressor.knee.value as number,
    min: 0,
    max: 40,
    unit: "dB",
  });
  parameters.set("makeupGain", {
    name: "Makeup Gain",
    value: 0,
    min: 0,
    max: 24,
    unit: "dB",
  });
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: 1, // Compressor is typically 100% wet
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `compressor_${Date.now()}`,
    type: EFFECT_TYPE.COMPRESSOR,
    name: "Compressor",
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
        case "threshold":
          compressor.threshold.setValueAtTime(v, context.currentTime);
          break;
        case "ratio":
          compressor.ratio.setValueAtTime(v, context.currentTime);
          break;
        case "attack":
          compressor.attack.setValueAtTime(v, context.currentTime);
          break;
        case "release":
          compressor.release.setValueAtTime(v, context.currentTime);
          break;
        case "knee":
          compressor.knee.setValueAtTime(v, context.currentTime);
          break;
        case "makeupGain":
          makeupGain.gain.setValueAtTime(dbToGain(toDecibels(v)), context.currentTime);
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
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 1;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      applyWetDry(wetGain, dryGain, 0, context);
    },

    getReduction(): number {
      return compressor.reduction;
    },

    getInputLevelDb(): number {
      analyser.getFloatTimeDomainData(levelBuffer);
      let sum = 0;
      for (const sample of levelBuffer) sum += sample * sample;
      const rms = Math.sqrt(sum / levelBuffer.length);
      return rms > 0 ? gainToDbfs(toLinearGain(rms)) : -Infinity;
    },

    cleanup(): void {
      try {
        (compressor as { dispose?: () => void }).dispose?.();
        inputGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
        makeupGain.disconnect();
        analyser.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
