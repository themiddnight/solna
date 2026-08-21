/**
 * Envelope Follower Audio Worklet Processor (DEV-343)
 *
 * Emits a gain envelope as an audio-rate signal, meant to be connected straight to
 * a GainNode's `gain` AudioParam. Previously this ran on requestAnimationFrame and
 * applied setTargetAtTime, giving ~16 ms resolution — which cannot represent the
 * 5-20 ms attack the ducker advertises. At audio rate the attack is sample-accurate,
 * and it keeps running when the tab is backgrounded and rAF stops.
 *
 * `computeDuckGain` below is a hand-copy of the TypeScript original,
 * `computeDuckGain` in `app/frontend/src/engine/effects/runtime/effects/DuckerEffect.ts`
 * (a worklet cannot import from src/). It inlines that function's two helpers —
 * `toDecibels` (a no-op type brand at runtime) and `dbToGain` (`10 ** (db / 20)`),
 * both from `@/shared/audio/gainUnits` — since those can't be imported here either.
 * An agreement test (added in Task 7) pins the two together — if you change one,
 * change both.
 *
 * With no key signal connected, `process()` doesn't snap the envelope to unity — it
 * treats the missing key as `keyDb = -Infinity` and runs it through the SAME
 * attack/hold/release loop as a connected key, so `computeDuckGain(-Infinity, ...)`'s
 * target of 1 is approached via the release coefficient like any other recovery (DEV-343
 * task 7 fix: a snap produced an audible click on disconnect mid-reduction).
 */

const METER_RATE_HZ = 20;
const RMS_WINDOW_SAMPLES = 128;

function computeDuckGain(keyDb, thresholdDb, amountDb) {
  if (keyDb === -Infinity) return 1;
  const over = keyDb - thresholdDb;
  if (over <= 0) return 1;
  const reductionDb = Math.min(amountDb, over);
  // reductionDb is a RELATIVE attenuation amount -> linear gain.
  return Math.pow(10, -reductionDb / 20);
}

class EnvelopeFollowerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.thresholdDb = -30;
    this.attackMs = 10;
    this.releaseMs = 120;
    this.holdMs = 50;
    this.amount = 1;

    this.envelope = 1;
    this.holdRemaining = 0;
    this.rmsAccumulator = 0;
    this.rmsCount = 0;
    this.lastRms = 0;
    this.samplesSinceMeter = 0;
    this.samplesPerMeter = Math.round(sampleRate / METER_RATE_HZ);

    this.port.onmessage = (event) => {
      const { command, value } = event.data;
      if (command === "setParams" && value) {
        if (typeof value.thresholdDb === "number") this.thresholdDb = value.thresholdDb;
        if (typeof value.attackMs === "number") this.attackMs = value.attackMs;
        if (typeof value.releaseMs === "number") this.releaseMs = value.releaseMs;
        if (typeof value.holdMs === "number") this.holdMs = value.holdMs;
        if (typeof value.amount === "number") this.amount = value.amount;
      }
    };
  }

  process(inputs, outputs) {
    const key = inputs[0] && inputs[0][0];
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;

    // One-pole coefficients, recomputed per block because params can change live.
    const attackCoeff = Math.exp(-1 / ((this.attackMs / 1000) * sampleRate));
    const releaseCoeff = Math.exp(-1 / ((this.releaseMs / 1000) * sampleRate));
    const holdSamples = (this.holdMs / 1000) * sampleRate;

    for (let i = 0; i < out.length; i++) {
      let keyDb;
      if (key) {
        this.rmsAccumulator += key[i] * key[i];
        if (++this.rmsCount >= RMS_WINDOW_SAMPLES) {
          this.lastRms = Math.sqrt(this.rmsAccumulator / this.rmsCount);
          this.rmsAccumulator = 0;
          this.rmsCount = 0;
        }
        keyDb = this.lastRms > 0 ? 20 * Math.log10(this.lastRms) : -Infinity;
      } else {
        // No key signal connected: computeDuckGain(-Infinity, ...) always returns 1, so
        // this samples through the SAME attack/hold/release math below and eases back
        // toward unity via the release coefficient — never snaps. An aux link dropping
        // mid-reduction must not produce an audible step (a disconnect at, say, -12dB is
        // otherwise a ~4x amplitude jump inside a single ~2.7ms render quantum).
        keyDb = -Infinity;
      }

      const target = computeDuckGain(keyDb, this.thresholdDb, this.amount);

      if (target < this.envelope) {
        // Ducking down: attack, and re-arm the hold.
        this.envelope = target + (this.envelope - target) * attackCoeff;
        this.holdRemaining = holdSamples;
      } else if (this.holdRemaining > 0) {
        this.holdRemaining--;
      } else {
        this.envelope = target + (this.envelope - target) * releaseCoeff;
      }

      out[i] = this.envelope;
    }

    // Metering is for the UI only: post at 20 Hz, never per quantum (that would be
    // ~375 messages/second and would cost more than the DSP it reports on). Keeps posting
    // even with no key connected (keyDb reports -Infinity in that case, ignoring whatever
    // `lastRms` was left over from before the key disconnected), so a consumer polling the
    // last message never sees a stale reading survive indefinitely.
    this.samplesSinceMeter += out.length;
    if (this.samplesSinceMeter >= this.samplesPerMeter) {
      this.samplesSinceMeter = 0;
      this.port.postMessage({
        type: "level",
        keyDb: key && this.lastRms > 0 ? 20 * Math.log10(this.lastRms) : -Infinity,
        reduction: this.envelope,
      });
    }

    return true;
  }
}

registerProcessor("envelope-follower-processor", EnvelopeFollowerProcessor);
