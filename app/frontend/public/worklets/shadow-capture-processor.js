/**
 * Shadow Capture Audio Worklet Processor
 *
 * This runs on the Audio Thread (separate from main thread) for
 * optimal real-time performance without audio glitches.
 *
 * It maintains a circular buffer of the last 30 seconds of audio
 * and responds to commands from the main thread.
 */

const BUFFER_DURATION_SECONDS = 30;
const CHANNELS = 2;

class ShadowCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Initialize ring buffer - size will be set when we know the sample rate
    this.bufferSize = 0;
    this.leftChannel = null;
    this.rightChannel = null;
    this.writeIndex = 0;
    this.recordedSamples = 0;
    this.isCapturing = false;
    this.sampleRate = sampleRate; // Global variable in AudioWorklet scope

    // Initialize buffer
    this.initializeBuffer();

    // Handle messages from main thread
    this.port.onmessage = (event) => {
      const { command, data } = event.data;

      switch (command) {
        case "start":
          this.isCapturing = true;
          this.port.postMessage({ type: "started" });
          break;

        case "stop":
          this.isCapturing = false;
          this.port.postMessage({ type: "stopped" });
          break;

        case "clear":
          this.clearBuffer();
          this.port.postMessage({ type: "cleared" });
          break;

        case "getBuffer":
          this.sendBuffer();
          break;

        case "getDuration":
          this.port.postMessage({
            type: "duration",
            duration: this.recordedSamples / this.sampleRate,
          });
          break;
      }
    };
  }

  initializeBuffer() {
    this.bufferSize = Math.floor(this.sampleRate * BUFFER_DURATION_SECONDS);
    this.leftChannel = new Float32Array(this.bufferSize);
    this.rightChannel = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.recordedSamples = 0;
  }

  clearBuffer() {
    this.writeIndex = 0;
    this.recordedSamples = 0;
    // No need to zero arrays, they'll be overwritten
  }

  sendBuffer() {
    if (this.recordedSamples === 0) {
      this.port.postMessage({
        type: "buffer",
        left: null,
        right: null,
        samples: 0,
      });
      return;
    }

    // Create output arrays
    const leftOutput = new Float32Array(this.recordedSamples);
    const rightOutput = new Float32Array(this.recordedSamples);

    // Read from the buffer in correct order
    // If buffer is full, we start reading from writeIndex (oldest)
    // If buffer is not full, we start from 0
    let readIndex =
      this.recordedSamples < this.bufferSize ? 0 : this.writeIndex;

    for (let i = 0; i < this.recordedSamples; i++) {
      leftOutput[i] = this.leftChannel[readIndex];
      rightOutput[i] = this.rightChannel[readIndex];
      readIndex = (readIndex + 1) % this.bufferSize;
    }

    // Transfer the arrays to main thread (transferable for performance)
    this.port.postMessage(
      {
        type: "buffer",
        left: leftOutput.buffer,
        right: rightOutput.buffer,
        samples: this.recordedSamples,
        sampleRate: this.sampleRate,
      },
      [leftOutput.buffer, rightOutput.buffer]
    );
  }

  process(inputs, outputs, parameters) {
    // Get the first input (stereo)
    const input = inputs[0];

    if (!input || input.length === 0 || !this.isCapturing) {
      return true; // Keep processor alive
    }

    const leftInput = input[0] || new Float32Array(128);
    const rightInput = input[1] || input[0] || new Float32Array(128);
    const len = leftInput.length;

    // Write to ring buffer
    for (let i = 0; i < len; i++) {
      this.leftChannel[this.writeIndex] = leftInput[i];
      this.rightChannel[this.writeIndex] = rightInput[i];

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    this.recordedSamples = Math.min(
      this.recordedSamples + len,
      this.bufferSize
    );

    // Periodically send duration update (every ~1 second worth of samples)
    // 128 samples per process call, ~344 calls per second at 44.1kHz
    // Send every 344 calls = ~1 second
    if (this.recordedSamples % this.sampleRate < 128) {
      this.port.postMessage({
        type: "duration",
        duration: this.recordedSamples / this.sampleRate,
      });
    }

    return true; // Keep processor alive
  }
}

registerProcessor("shadow-capture-processor", ShadowCaptureProcessor);
