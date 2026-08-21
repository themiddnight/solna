import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode } from "./EffectsHelper";

export function createGraphicEQEffect(context: AudioContext, id?: string): AudioEffect {
  // Create 5-band parametric EQ with low/high cut filters
  const lowCutFilter = context.createBiquadFilter();
  lowCutFilter.type = "highpass";
  lowCutFilter.frequency.value = 20;
  lowCutFilter.Q.value = 0.707; // Butterworth response

  const band1 = context.createBiquadFilter();
  band1.type = "peaking";
  band1.frequency.value = 100;
  band1.Q.value = 1;
  band1.gain.value = 0;

  const band2 = context.createBiquadFilter();
  band2.type = "peaking";
  band2.frequency.value = 500;
  band2.Q.value = 1;
  band2.gain.value = 0;

  const band3 = context.createBiquadFilter();
  band3.type = "peaking";
  band3.frequency.value = 2000;
  band3.Q.value = 1;
  band3.gain.value = 0;

  const band4 = context.createBiquadFilter();
  band4.type = "peaking";
  band4.frequency.value = 5000;
  band4.Q.value = 1;
  band4.gain.value = 0;

  const band5 = context.createBiquadFilter();
  band5.type = "peaking";
  band5.frequency.value = 10000;
  band5.Q.value = 1;
  band5.gain.value = 0;

  const highCutFilter = context.createBiquadFilter();
  highCutFilter.type = "lowpass";
  highCutFilter.frequency.value = 20000;
  highCutFilter.Q.value = 0.707; // Butterworth response

  // Create input/output nodes with dry/wet for bypass
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Set initial gains (100% wet, 0% dry for normal operation)
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;

  // Chain all filters together (wet path)
  inputGain.connect(lowCutFilter);
  lowCutFilter.connect(band1);
  band1.connect(band2);
  band2.connect(band3);
  band3.connect(band4);
  band4.connect(band5);
  band5.connect(highCutFilter);
  highCutFilter.connect(wetGain);

  // Dry path (for bypass)
  inputGain.connect(dryGain);

  // Mix wet and dry to output
  wetGain.connect(outputGain);
  dryGain.connect(outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("lowCut", {
    name: "Low Cut",
    value: 20,
    min: 20,
    max: 500,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("lowCutQ", {
    name: "Low Cut Q",
    value: 0.707,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p1Freq", {
    name: "P1 Freq",
    value: 100,
    min: 20,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("p2Freq", {
    name: "P2 Freq",
    value: 500,
    min: 20,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("p3Freq", {
    name: "P3 Freq",
    value: 2000,
    min: 20,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("p4Freq", {
    name: "P4 Freq",
    value: 5000,
    min: 20,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("p5Freq", {
    name: "P5 Freq",
    value: 10000,
    min: 20,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("highCut", {
    name: "High Cut",
    value: 20000,
    min: 1000,
    max: 20000,
    unit: "Hz",
    curve: "logarithmic",
  });
  parameters.set("highCutQ", {
    name: "High Cut Q",
    value: 0.707,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p1Q", {
    name: "P1 Q",
    value: 1,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p2Q", {
    name: "P2 Q",
    value: 1,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p3Q", {
    name: "P3 Q",
    value: 1,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p4Q", {
    name: "P4 Q",
    value: 1,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p5Q", {
    name: "P5 Q",
    value: 1,
    min: 0.1,
    max: 10,
    unit: "",
  });
  parameters.set("p1Vol", {
    name: "P1 Vol",
    value: 0,
    min: -24,
    max: 24,
    unit: "dB",
  });
  parameters.set("p2Vol", {
    name: "P2 Vol",
    value: 0,
    min: -24,
    max: 24,
    unit: "dB",
  });
  parameters.set("p3Vol", {
    name: "P3 Vol",
    value: 0,
    min: -24,
    max: 24,
    unit: "dB",
  });
  parameters.set("p4Vol", {
    name: "P4 Vol",
    value: 0,
    min: -24,
    max: 24,
    unit: "dB",
  });
  parameters.set("p5Vol", {
    name: "P5 Vol",
    value: 0,
    min: -24,
    max: 24,
    unit: "dB",
  });

  return {
    id: id || `graphiceq_${Date.now()}`,
    type: EFFECT_TYPE.GRAPHICEQ,
    name: "Graphic EQ",
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
        case "lowCut":
          lowCutFilter.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "lowCutQ":
          lowCutFilter.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p1Freq":
          band1.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "p2Freq":
          band2.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "p3Freq":
          band3.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "p4Freq":
          band4.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "p5Freq":
          band5.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "highCut":
          highCutFilter.frequency.setValueAtTime(v, context.currentTime);
          break;
        case "highCutQ":
          highCutFilter.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p1Q":
          band1.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p2Q":
          band2.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p3Q":
          band3.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p4Q":
          band4.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p5Q":
          band5.Q.setValueAtTime(v, context.currentTime);
          break;
        case "p1Vol":
          band1.gain.setValueAtTime(v, context.currentTime);
          break;
        case "p2Vol":
          band2.gain.setValueAtTime(v, context.currentTime);
          break;
        case "p3Vol":
          band3.gain.setValueAtTime(v, context.currentTime);
          break;
        case "p4Vol":
          band4.gain.setValueAtTime(v, context.currentTime);
          break;
        case "p5Vol":
          band5.gain.setValueAtTime(v, context.currentTime);
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    enable(): void {
      this.enabled = true;
      wetGain.gain.setValueAtTime(1, context.currentTime);
      dryGain.gain.setValueAtTime(0, context.currentTime);
    },

    disable(): void {
      this.enabled = false;
      wetGain.gain.setValueAtTime(0, context.currentTime);
      dryGain.gain.setValueAtTime(1, context.currentTime);
    },

    cleanup(): void {
      try {
        inputGain.disconnect();
        lowCutFilter.disconnect();
        band1.disconnect();
        band2.disconnect();
        band3.disconnect();
        band4.disconnect();
        band5.disconnect();
        highCutFilter.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
