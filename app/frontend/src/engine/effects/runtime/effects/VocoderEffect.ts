import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode } from "./EffectsHelper";
import { VocoderCarrier } from "../../pitch/VocoderCarrier";
import { PitchDetector } from "../../pitch/PitchDetector";
import {
  VOCODER_FREQ_LOW,
  VOCODER_FREQ_HIGH,
  DEFAULT_SCALE_MASK,
  DEFAULT_KEY_ROOT,
} from "../../pitch/pitchConstants";
import { diatonicDegreeFreq, droneCarrierFreq, followCarrierFreq } from "../../pitch/pitchMath";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import {
  VOCODER_OUTPUT_GAIN_MIN_DB,
  VOCODER_OUTPUT_GAIN_MAX_DB,
  DEFAULT_VOCODER_OUTPUT_GAIN_DB,
} from "@/shared/audio/vocoderGain";
import { EnvelopeFollowerWorklet } from "./envelopeFollowerWorklet";

/**
 * Supersaw channel vocoder, ported from the voice-dsp POC (vocoderStudio) after ear-tuning.
 * Replaces the shipped robotic-but-unintelligible vocoder and fixes the DC-leak bug (the
 * carrier leaking during silence). Every intelligibility lever from the consult is here:
 *   - SUPERSAW carrier (VocoderCarrier): detuned unison so no filterbank band falls between
 *     harmonics — the cause of hollow, unintelligible vowels with a single thin oscillator.
 *   - Per-band osc/noise crossfade + HF tilt: high bands use a NOISE carrier so s/sh/t
 *     consonants come through, and a per-band makeup gain rising with frequency compensates
 *     the saw's 1/n rolloff that otherwise starves consonant bands.
 *   - ODD-257 rectifier curve: the DC-leak fix (see makeVocoderRectifierCurve).
 *   - Input-RMS silence gate: unvoiced noise is only injected while there IS input energy,
 *     so gaps and Stop are truly silent (detector-null alone also happens during silence).
 *   - Sibilance passthrough: a high-passed copy of the dry voice mixed in for cheap "s".
 *   - Diatonic Voices: `degrees` bitmask stacks scale degrees on the base note.
 */

const CARRIER_MODE = { DRONE: 0, FOLLOW: 1 } as const;

const GAIN_RAMP_TIME = 0.02;
/** Input RMS below this reads as silence — gates unvoiced noise so gaps don't hiss. */
const SILENCE_RMS = 0.008;

/**
 * Full-wave rectifier curve for the envelope follower, length 257 (ODD).
 *
 * THE DC-LEAK FIX: an odd length makes the midpoint sample (index 128) land exactly on
 * input=0, so `curve[128] === 0` and silence maps to EXACT zero. An even-length curve (the
 * shipped 256) has no sample at exact zero — silence interpolates between two samples to
 * ~0.004 DC, which keeps every band VCA slightly open, so the carrier leaks audibly during
 * silence and after Stop. Exported so the regression test can assert length/midpoint.
 */
export function makeVocoderRectifierCurve(): Float32Array {
  const curve = new Float32Array(257);
  for (let i = 0; i < 257; i++) curve[i] = Math.abs(i / 128 - 1);
  return curve;
}

/**
 * Voices bitmask -> enabled diatonic scale degrees. This bit->degree convention is mirrored
 * by the frontend Voices buttons (a later config task):
 *   bit 1 (1) -> degree 1 (root), bit 2 (2) -> degree 3, bit 4 (4) -> degree 5, bit 8 (8) -> degree 8 (octave).
 * Exported for the config layer + tests.
 */
export function degreesFromMask(mask: number): number[] {
  const degrees: number[] = [];
  if ((mask & 1) !== 0) degrees.push(1);
  if ((mask & 2) !== 0) degrees.push(3);
  if ((mask & 4) !== 0) degrees.push(5);
  if ((mask & 8) !== 0) degrees.push(8);
  return degrees;
}

/** Band center frequencies from LOW..HIGH inclusive: log-spaced, or mel-spaced (denser in the speech-formant range). */
function bandFreqs(count: number, mel: boolean): number[] {
  const out: number[] = [];
  if (count < 2) {
    out.push(VOCODER_FREQ_LOW);
    return out;
  }
  if (mel) {
    const toMel = (f: number): number => 2595 * Math.log10(1 + f / 700);
    const fromMel = (m: number): number => 700 * (10 ** (m / 2595) - 1);
    const m0 = toMel(VOCODER_FREQ_LOW);
    const m1 = toMel(VOCODER_FREQ_HIGH);
    for (let i = 0; i < count; i++) out.push(fromMel(m0 + ((m1 - m0) * i) / (count - 1)));
  } else {
    const ratio = VOCODER_FREQ_HIGH / VOCODER_FREQ_LOW;
    for (let i = 0; i < count; i++) out.push(VOCODER_FREQ_LOW * ratio ** (i / (count - 1)));
  }
  return out;
}

interface Band {
  freq: number;
  modBP: BiquadFilterNode;
  rect: WaveShaperNode;
  envLP: BiquadFilterNode;
  oscBP: BiquadFilterNode;
  noiseBP: BiquadFilterNode;
  gOsc: GainNode;
  gNoise: GainNode;
  vca: GainNode;
}

/** Reject NaN/Infinity/<=0 before they reach VocoderCarrier.setFrequencies (no guard there). */
function isValidCarrierFreq(freq: number): boolean {
  return Number.isFinite(freq) && freq > 0;
}

/**
 * Channel vocoder. `inputNode` receives the modulator (voice). A supersaw carrier
 * (drone/follow, plus diatonic Voices) is generated internally; per band the modulator
 * envelope multiplies the carrier band via a VCA (gain.value=0 + envelope connected to .gain).
 */

/** Extra test-only accessor beyond the AudioEffect contract, so unit tests can assert the
 *  init-time makeup gain (DEV-309) without depending on the mocked AudioParam's `.value`
 *  staying in sync with scheduled ramps (jsdom's mock doesn't). Declared as its own interface
 *  (rather than widening AudioEffect itself) so production call sites — which only see
 *  AudioEffect — are unaffected. */
interface VocoderTestAccessor {
  getMakeupGainValueForTest?: () => number;
}

export function createVocoderEffect(context: AudioContext, id?: string): AudioEffect & VocoderTestAccessor {
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;
  inputGain.connect(dryGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);

  // SUPERSAW carrier (main + octave-up layer, detuned unison). Owner-locked defaults live
  // inside VocoderCarrier; the param handlers below drive its setters.
  const carrier = new VocoderCarrier(context);

  // Noise carrier: white noise -> per-band bandpass, crossfaded against the saw for consonants.
  const noiseBuf = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseGain = createStereoGainNode(context);
  noise.connect(noiseGain);
  noise.start();

  // Sibilance passthrough: HP(dry voice) -> gain -> output (cheap "s" that survives vocoding).
  const sibHP = context.createBiquadFilter();
  sibHP.type = "highpass";
  sibHP.frequency.value = 5000;
  const sibGain = createStereoGainNode(context);
  sibGain.gain.value = 0.3;
  inputGain.connect(sibHP);
  sibHP.connect(sibGain);
  sibGain.connect(outputGain);

  const rectifierCurve = makeVocoderRectifierCurve();

  // Tunable state (defaults = owner's ear-tuned values from the POC session, 2026-07-11).
  let bandCount = 16;
  let bandQ = 8;
  let isMelSpacing = false;
  let noiseCrossHz = 8000;
  let noiseHighAmount = 0;
  let uvNoiseAmount = 0.2;
  let envHz = 50;
  let tiltDbOct = 4; // per-band makeup rising with freq (saw energy falls 1/n -> consonants starve)
  let carrierMode = CARRIER_MODE.FOLLOW as number;
  let degreeMask = 1; // which scale degrees stack on the base note (see degreesFromMask)
  let keyRoot = DEFAULT_KEY_ROOT;
  let scaleMask = DEFAULT_SCALE_MASK;

  let isVoiced = true;
  let isSilent = true; // input-level gate: silence != unvoiced (both give the detector null)
  let lastCarrierFreq = 0;
  let bands: Band[] = [];

  // Detector construction is deferred behind PitchDetector.register(context) — see
  // PitchDetector's class JSDoc. `detector` starts null and is filled in once registration
  // resolves (the async block below, after applyCarrier() is defined); `isDisposed` lets
  // cleanup() invalidate a still-pending registration so a worklet node is never
  // constructed/connected/started after teardown (the same acquired-across-teardown class as
  // the mic leaks in FAILURE_PATTERNS.md). Kept as a small object (mirroring AutotuneEffect's
  // `state` convention) rather than another loose `let`, since two flags need to stay in sync
  // across the synchronous call sites and the async resolution closure.
  const detectorState: { detector: PitchDetector | null; isDisposed: boolean; isEnabled: boolean } = {
    detector: null,
    isDisposed: false,
    // Mirrors the AudioEffect's `enabled` field (starts true) so the deferred detector
    // construction below can re-derive "should detection be running" at resolution time
    // instead of trusting whatever was true when the async IIFE was created — a disable()
    // that runs while registration is still pending must not be silently undone once the
    // detector is finally constructed.
    isEnabled: true,
  };

  // Makeup gain on the vocoder wet sum only (sibilance passthrough joins after it).
  const makeupGain = createStereoGainNode(context);
  makeupGain.gain.value = dbToGain(toDecibels(DEFAULT_VOCODER_OUTPUT_GAIN_DB)); // was: = 8 (DEV-309)
  makeupGain.connect(wetGain);

  // Base note (sung note in follow, tonic in drone) -> the enabled diatonic degrees.
  const carrierFreqsFor = (base: number): number[] => {
    const degrees = degreesFromMask(degreeMask);
    if (degrees.length === 0) return [];
    return degrees.map((d) => diatonicDegreeFreq(base, scaleMask, d)).filter(isValidCarrierFreq);
  };

  const noiseWeight = (freq: number): number => {
    const lo = noiseCrossHz / 2;
    const hi = noiseCrossHz;
    if (freq <= lo) return 0;
    if (freq >= hi) return 1;
    const t = (freq - lo) / (hi - lo);
    return t * t * (3 - 2 * t); // smoothstep
  };

  const applyCarrierMix = (): void => {
    const now = context.currentTime;
    for (const b of bands) {
      const freqW = noiseWeight(b.freq) * noiseHighAmount;
      // Unvoiced boost ONLY while there is input energy — detector null alone also happens
      // during silence, which must not hiss.
      const uvW = !isVoiced && !isSilent ? uvNoiseAmount : 0;
      const nMix = Math.min(1, freqW + uvW);
      // Tilt: per-band makeup rising with freq (dB/oct ref 500 Hz) so consonant bands aren't
      // starved by the saw's 1/n rolloff.
      const tilt = dbToGain(toDecibels(tiltDbOct * Math.log2(b.freq / 500)));
      b.gNoise.gain.setTargetAtTime(nMix * tilt, now, GAIN_RAMP_TIME);
      b.gOsc.gain.setTargetAtTime((1 - nMix) * tilt, now, GAIN_RAMP_TIME);
    }
  };

  const teardownBands = (): void => {
    for (const b of bands) {
      try {
        inputGain.disconnect(b.modBP);
        carrier.output.disconnect(b.oscBP);
        noiseGain.disconnect(b.noiseBP);
      } catch {
        /* ignore */
      }
      for (const n of [b.modBP, b.rect, b.envLP, b.oscBP, b.noiseBP, b.gOsc, b.gNoise, b.vca]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
    bands = [];
  };

  const buildBands = (): void => {
    teardownBands();
    for (const freq of bandFreqs(bandCount, isMelSpacing)) {
      // Modulator analysis: bandpass -> full-wave rectify -> lowpass = amplitude envelope.
      const modBP = context.createBiquadFilter();
      modBP.type = "bandpass";
      modBP.frequency.value = freq;
      modBP.Q.value = bandQ;
      const rect = context.createWaveShaper();
      rect.curve = rectifierCurve;
      const envLP = context.createBiquadFilter();
      envLP.type = "lowpass";
      envLP.frequency.value = envHz;
      inputGain.connect(modBP);
      modBP.connect(rect);
      rect.connect(envLP);

      // Carrier bands: saw and noise each bandpassed, crossfaded by gOsc/gNoise.
      const oscBP = context.createBiquadFilter();
      oscBP.type = "bandpass";
      oscBP.frequency.value = freq;
      oscBP.Q.value = bandQ;
      const noiseBP = context.createBiquadFilter();
      noiseBP.type = "bandpass";
      noiseBP.frequency.value = freq;
      noiseBP.Q.value = bandQ;
      carrier.output.connect(oscBP);
      noiseGain.connect(noiseBP);

      const gOsc = context.createGain();
      const gNoise = context.createGain();
      gOsc.gain.value = 1;
      gNoise.gain.value = 0;
      oscBP.connect(gOsc);
      noiseBP.connect(gNoise);

      const vca = context.createGain();
      vca.gain.value = 0;
      gOsc.connect(vca);
      gNoise.connect(vca);
      envLP.connect(vca.gain); // audio-rate multiply
      vca.connect(makeupGain);

      bands.push({ freq, modBP, rect, envLP, oscBP, noiseBP, gOsc, gNoise, vca });
    }
    applyCarrierMix();
  };

  const applyCarrier = (): void => {
    if (carrierMode === CARRIER_MODE.DRONE) {
      detectorState.detector?.stop();
      carrier.setFrequencies(carrierFreqsFor(droneCarrierFreq(keyRoot)));
    } else {
      // Follow: seed from the tonic so there's sound before the first detection.
      lastCarrierFreq = 0;
      carrier.setFrequencies(carrierFreqsFor(droneCarrierFreq(keyRoot)));
      detectorState.detector?.start();
    }
  };

  // isDisposed is checked immediately after the await so a cleanup() that ran while
  // registration was in flight is respected — the detector is never constructed/connected/
  // started once torn down. carrierMode AND isEnabled are both re-read here (not captured at
  // module-init time), so a setParameter("carrierMode", ...) or disable() that ran while
  // registration was pending is honored, matching applyCarrier()'s own DRONE/FOLLOW branch
  // (detector?.start()/stop() were no-ops there while detectorState.detector was still null).
  void (async () => {
    await PitchDetector.register(context);
    if (detectorState.isDisposed) return;
    const detector = new PitchDetector(context, (freq) => {
      isVoiced = freq !== null && freq > 0;
      if (carrierMode === CARRIER_MODE.FOLLOW && isVoiced && freq !== null) {
        const cf = followCarrierFreq(freq, scaleMask);
        if (isValidCarrierFreq(cf)) {
          // Dead-band on the BASE note (degrees are derived from it) so the carrier isn't
          // re-targeted every frame by sub-~7-cent wobble.
          if (!(lastCarrierFreq > 0 && Math.abs(Math.log2(cf / lastCarrierFreq)) < 0.006)) {
            lastCarrierFreq = cf;
            carrier.setFrequencies(carrierFreqsFor(cf));
          }
        }
      }
      applyCarrierMix(); // update unvoiced noise mix
    });
    detectorState.detector = detector;
    inputGain.connect(detector.input);
    if (carrierMode === CARRIER_MODE.FOLLOW && detectorState.isEnabled) {
      detector.start();
    }
  })().catch((error: unknown) => {
    // A swallowed rejection here (register() rejecting — addModule() failing to fetch the
    // module) would leave the follow-mode carrier permanently untracked: no detector is
    // ever constructed, so the carrier never re-targets to the sung note. Logged to match
    // this codebase's established `console.error("[Module] message:", error)` convention
    // (see DuckerEffect.ts / VocoderExtEffect.ts's identical registration-failure logging).
    console.error("[VocoderEffect] Failed to load the pitch-tap worklet — carrier pitch-tracking stays disabled:", error);
  });

  buildBands();
  applyCarrier();

  // Input level watcher -> `silent` flag (gates unvoiced noise so it doesn't hiss in gaps).
  // DEV-343 task 7: previously an rAF loop read `inputGain`'s RMS via an AnalyserNode. It
  // now reads the same RMS via the envelope-follower worklet's ~20Hz {type:"level"}
  // metering message instead — NOT its audio-rate dB-reduction-curve output, which has
  // the wrong polarity for a binary silence gate (a quiet key means *unity* on that
  // curve, the opposite of "gated closed" — see DuckerEffect.ts's computeDuckGain and
  // VocoderExtEffect.ts's identically-shaped carrier-presence gate, which this mirrors).
  // The real win is that the worklet keeps posting metering messages in a backgrounded
  // tab, where rAF stops.
  const followerState: { follower: EnvelopeFollowerWorklet | null; isDisposed: boolean } = {
    follower: null,
    isDisposed: false,
  };

  // Silent sink for the follower's audio-rate output — see VocoderExtEffect.ts's
  // identical comment: an AudioWorkletNode with no live output connection is never
  // pulled by the render graph, so process() (and therefore the metering message this
  // watcher relies on) would never run. Gain 0 means it never contributes audibly.
  const followerSink = createStereoGainNode(context);
  followerSink.gain.value = 0;
  followerSink.connect(outputGain);

  void (async () => {
    await EnvelopeFollowerWorklet.register(context);
    if (followerState.isDisposed) return;
    const follower = new EnvelopeFollowerWorklet(context, (keyDb) => {
      const isSilentBefore = isSilent;
      // dbToGain(db) === 10**(db/20) is the exact inverse of the RMS -> dB conversion the
      // old rAF watcher did locally (20*log10(rms)) — reused here so this stays
      // numerically identical to the pre-DEV-343 computation.
      isSilent = dbToGain(toDecibels(keyDb)) < SILENCE_RMS;
      if (isSilent !== isSilentBefore) applyCarrierMix();
    });
    followerState.follower = follower;
    follower.output.connect(followerSink);
    inputGain.connect(follower.input);
  })().catch(() => undefined);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("carrierMode", { name: "Carrier base", value: carrierMode, min: 0, max: 1, step: 1 });
  parameters.set("degrees", { name: "Voices", value: degreeMask, min: 0, max: 15, step: 1 });
  parameters.set("carrierWave", { name: "Carrier wave", value: 0, min: 0, max: 1, step: 1 });
  parameters.set("unison", { name: "Unison voices", value: 3, min: 1, max: 7, step: 1 });
  parameters.set("spreadCents", { name: "Detune", value: 16, min: 0, max: 60, step: 2, unit: "¢" });
  parameters.set("octaveMix", { name: "Octave layer", value: 0.5, min: 0, max: 1, step: 0.05 });
  parameters.set("bandQ", { name: "Band Q", value: bandQ, min: 2, max: 12, step: 0.5 });
  parameters.set("bandCount", { name: "Band count", value: bandCount, min: 12, max: 32, step: 2 });
  parameters.set("melSpacing", { name: "Band spacing", value: 0, min: 0, max: 1, step: 1 });
  parameters.set("noiseCrossHz", { name: "Noise crossover", value: noiseCrossHz, min: 1000, max: 8000, step: 100, unit: "Hz" });
  parameters.set("noiseHighAmount", { name: "Noise HF", value: noiseHighAmount, min: 0, max: 1, step: 0.05 });
  parameters.set("uvNoiseAmount", { name: "Unvoiced noise", value: uvNoiseAmount, min: 0, max: 1, step: 0.05 });
  parameters.set("sibilancePassthrough", { name: "Sibilance", value: 0.3, min: 0, max: 1, step: 0.05 });
  parameters.set("sibilanceHz", { name: "Sibilance cutoff", value: 5000, min: 2000, max: 9000, step: 250, unit: "Hz" });
  parameters.set("envHz", { name: "Envelope speed", value: envHz, min: 8, max: 120, step: 2, unit: "Hz" });
  parameters.set("tiltDbOct", { name: "HF tilt", value: tiltDbOct, min: 0, max: 6, step: 0.5, unit: "dB/oct" });
  parameters.set("outputGain", {
    name: "Output gain",
    value: DEFAULT_VOCODER_OUTPUT_GAIN_DB,
    min: VOCODER_OUTPUT_GAIN_MIN_DB,
    max: VOCODER_OUTPUT_GAIN_MAX_DB,
    step: 0.5,
    unit: "dB", // was "×" (DEV-309)
  });
  parameters.set("wetLevel", { name: "Wet", value: 1, min: 0, max: 1, unit: "%" });
  parameters.set("keyRoot", { name: "Key root", value: keyRoot, min: 0, max: 11, step: 1 });
  parameters.set("scaleMask", { name: "Scale mask", value: scaleMask, min: 0, max: 4095, step: 1 });

  return {
    id: id ?? `vocoder_${Date.now()}`,
    type: EFFECT_TYPE.VOCODER,
    name: "Vocoder",
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
        case "carrierMode":
          carrierMode = Math.round(v);
          applyCarrier();
          applyCarrierMix();
          break;
        case "degrees":
          degreeMask = Math.round(v);
          applyCarrier(); // rebuild carrier note set (re-seeds the follow base too)
          break;
        case "carrierWave":
          carrier.setWave(Math.round(v) >= 1 ? "square" : "sawtooth");
          break;
        case "unison":
          carrier.setUnison(Math.round(v));
          break;
        case "spreadCents":
          carrier.setSpread(Math.round(v));
          break;
        case "octaveMix":
          carrier.setOctaveMix(v);
          break;
        case "bandQ":
          bandQ = v;
          for (const b of bands) {
            b.modBP.Q.setTargetAtTime(v, context.currentTime, GAIN_RAMP_TIME);
            b.oscBP.Q.setTargetAtTime(v, context.currentTime, GAIN_RAMP_TIME);
            b.noiseBP.Q.setTargetAtTime(v, context.currentTime, GAIN_RAMP_TIME);
          }
          break;
        case "bandCount":
          bandCount = Math.round(v);
          buildBands();
          break;
        case "melSpacing":
          isMelSpacing = Math.round(v) >= 1;
          buildBands();
          break;
        case "noiseCrossHz":
          noiseCrossHz = v;
          applyCarrierMix();
          break;
        case "noiseHighAmount":
          noiseHighAmount = v;
          applyCarrierMix();
          break;
        case "uvNoiseAmount":
          uvNoiseAmount = v;
          applyCarrierMix();
          break;
        case "sibilancePassthrough":
          sibGain.gain.setTargetAtTime(v, context.currentTime, GAIN_RAMP_TIME);
          break;
        case "sibilanceHz":
          sibHP.frequency.setTargetAtTime(v, context.currentTime, GAIN_RAMP_TIME);
          break;
        case "envHz":
          envHz = v;
          for (const b of bands) b.envLP.frequency.setTargetAtTime(v, context.currentTime, GAIN_RAMP_TIME);
          break;
        case "tiltDbOct":
          tiltDbOct = v;
          applyCarrierMix();
          break;
        case "outputGain":
          makeupGain.gain.setTargetAtTime(dbToGain(toDecibels(v)), context.currentTime, GAIN_RAMP_TIME);
          break;
        case "wetLevel":
          wetGain.gain.setValueAtTime(v, context.currentTime);
          dryGain.gain.setValueAtTime(1 - v, context.currentTime);
          break;
        case "keyRoot":
          keyRoot = Math.round(v);
          applyCarrier();
          break;
        case "scaleMask":
          scaleMask = Math.round(v);
          applyCarrier();
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    getMakeupGainValueForTest(): number {
      return makeupGain.gain.value;
    },

    enable(): void {
      this.enabled = true;
      detectorState.isEnabled = true;
      const wet = this.parameters.get("wetLevel")?.value ?? 1;
      wetGain.gain.setValueAtTime(wet, context.currentTime);
      dryGain.gain.setValueAtTime(1 - wet, context.currentTime);
      applyCarrier();
    },

    disable(): void {
      // detectorState.detector may still be null while registration is pending — nothing to
      // stop yet in that case. detectorState.isEnabled = false below ensures the pending
      // construction (see the async block above applyCarrier()) won't start it once it resolves.
      detectorState.detector?.stop();
      detectorState.isEnabled = false;
      this.enabled = false;
      wetGain.gain.setValueAtTime(0, context.currentTime);
      dryGain.gain.setValueAtTime(1, context.currentTime);
    },

    cleanup(): void {
      detectorState.isDisposed = true;
      followerState.isDisposed = true;
      followerState.follower?.dispose();
      try {
        detectorState.detector?.dispose();
        teardownBands();
        carrier.dispose();
        noise.stop();
        noiseGain.disconnect();
        makeupGain.disconnect();
        followerSink.disconnect();
        sibHP.disconnect();
        sibGain.disconnect();
        inputGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
