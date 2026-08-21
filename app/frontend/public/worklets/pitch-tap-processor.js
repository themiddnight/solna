/**
 * Pitch Tap Audio Worklet Processor (DEV-343)
 *
 * Runs on the audio thread and does two things the main thread cannot do well:
 *   1. paces pitch detection at a fixed rate, independent of the display refresh
 *      (requestAnimationFrame is 60 Hz on one machine, 120 Hz on another, and 0 Hz
 *      in a background tab);
 *   2. gates on RMS, so a silent channel posts nothing and costs nothing.
 *
 * It deliberately does NO filtering or pitch detection. Filtering lives in
 * TypeScript (engine/effects/pitch/decimation.ts) where it is unit-tested, and AMDF
 * stays on the main thread: every worklet in a context shares ONE audio thread with
 * a ~2.7 ms deadline per quantum, so a 0.93 ms detector stacked a few times over
 * would turn UI jank into audible dropouts.
 */

const SOURCE_WINDOW = 1536; // 512 decimated samples x 3
const DETECT_RATE_HZ = 25;

class PitchTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.window = new Float32Array(SOURCE_WINDOW);
    this.writeIndex = 0;
    this.samplesSincePost = 0;
    this.samplesPerPost = Math.round(sampleRate / DETECT_RATE_HZ);
    this.gate = 0.008;

    this.port.onmessage = (event) => {
      const { command, value } = event.data;
      if (command === "setGate" && typeof value === "number") {
        this.gate = value;
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.window[this.writeIndex] = channel[i];
      this.writeIndex = (this.writeIndex + 1) % SOURCE_WINDOW;
    }

    this.samplesSincePost += channel.length;
    if (this.samplesSincePost < this.samplesPerPost) return true;
    this.samplesSincePost = 0;

    // Gate on RMS before allocating/unrolling; order-independent sum of squares
    // on the raw ring buffer directly. Silent channels skip the allocation cost.
    let sum = 0;
    for (let i = 0; i < SOURCE_WINDOW; i++) sum += this.window[i] * this.window[i];
    if (Math.sqrt(sum / SOURCE_WINDOW) < this.gate) {
      this.port.postMessage({ type: "silent" });
      return true;
    }

    // Unroll the ring into chronological order before posting; AMDF needs a
    // contiguous window, and a wrapped one reads as a discontinuity.
    const frame = new Float32Array(SOURCE_WINDOW);
    for (let i = 0; i < SOURCE_WINDOW; i++) {
      frame[i] = this.window[(this.writeIndex + i) % SOURCE_WINDOW];
    }

    this.port.postMessage({ type: "frame", samples: frame }, [frame.buffer]);
    return true;
  }
}

registerProcessor("pitch-tap-processor", PitchTapProcessor);
