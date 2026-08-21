import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";

import { APP_MAX_POLYPHONY, AUDIO_CONFIG, getOptimalAudioConfig } from "./audioConfig";
import { getOutputRouter } from "./outputRouter";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import { DEFAULT_MASTER_VOLUME_DB } from "@/shared/audio/masterVolume";

/** How long context creation is willing to wait for the output sink to be applied. */
const OUTPUT_SINK_APPLY_TIMEOUT_MS = 2000;

/**
 * Applies the chosen output sink to a freshly created context, bounded in time.
 *
 * Applying must happen before the context is handed out (otherwise the first notes
 * play on the old device), but must never be able to block context creation forever:
 * `setSinkId` is a platform call and a hung promise would take the whole audio engine
 * with it. Rejections are non-fatal by design — audio keeps playing on the default.
 */
const applyOutputSinkWithinBudget = async (context: AudioContext): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, OUTPUT_SINK_APPLY_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      getOutputRouter().applyToContext(context).catch(console.warn),
      budget,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// Audio Node Pool for efficient node reuse
/* eslint-disable @typescript-eslint/member-ordering */
class AudioNodePool {
  private gainNodes: GainNode[] = [];
  private analyserNodes: AnalyserNode[] = [];
  private bufferSourceNodes: AudioBufferSourceNode[] = [];
  private readonly context: AudioContext;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(context: AudioContext) {
    this.context = context;
    this.startCleanupTimer();
  }

  // Get a reusable gain node
  getGainNode(): GainNode {
    if (this.gainNodes.length > 0) {
      return this.gainNodes.pop()!;
    }
    return this.context.createGain();
  }

  // Return gain node to pool
  releaseGainNode(node: GainNode): void {
    if (this.gainNodes.length < AUDIO_CONFIG.NODE_POOL.maxGainNodes) {
      // Reset node properties
      node.gain.value = 1;
      node.disconnect();
      this.gainNodes.push(node);
    }
  }

  // Get a reusable oscillator (note: oscillators can only be used once)
  getOscillator(): OscillatorNode {
    return this.context.createOscillator();
  }

  // Get a reusable analyser node
  getAnalyserNode(): AnalyserNode {
    if (this.analyserNodes.length > 0) {
      return this.analyserNodes.pop()!;
    }
    return this.context.createAnalyser();
  }

  // Return analyser node to pool
  releaseAnalyserNode(node: AnalyserNode): void {
    if (this.analyserNodes.length < AUDIO_CONFIG.NODE_POOL.maxAnalyserNodes) {
      node.disconnect();
      this.analyserNodes.push(node);
    }
  }

  // Get a reusable buffer source node
  getBufferSourceNode(): AudioBufferSourceNode {
    if (this.bufferSourceNodes.length > 0) {
      return this.bufferSourceNodes.pop()!;
    }
    return this.context.createBufferSource();
  }

  // Return buffer source node to pool (note: buffer sources can only be used once)
  releaseBufferSourceNode(node: AudioBufferSourceNode): void {
    // Buffer sources cannot be reused, but we track them for cleanup
    node.disconnect();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      // Keep pool sizes reasonable
      const config = AUDIO_CONFIG.NODE_POOL;
      if (this.gainNodes.length > config.maxGainNodes) {
        this.gainNodes.splice(config.maxGainNodes);
      }
      if (this.analyserNodes.length > config.maxAnalyserNodes) {
        this.analyserNodes.splice(config.maxAnalyserNodes);
      }
    }, AUDIO_CONFIG.NODE_POOL.cleanupInterval);
  }

  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // Disconnect all pooled nodes
    [...this.gainNodes, ...this.analyserNodes].forEach((node) =>
      node.disconnect(),
    );
    this.gainNodes = [];
    this.analyserNodes = [];
    this.bufferSourceNodes = [];
  }
}

/**
 * One entry in the master insert chain (DEV-323). Structural on purpose: the bus wires nodes
 * and must not depend on the effects runtime's `AudioEffect` — `engine/audio` sits below
 * `engine/effects`, and an import the other way would invert that.
 */
export interface MasterInsertNode {
  readonly inputNode: AudioNode;
  readonly outputNode: AudioNode;
}

// Master Audio Bus for routing and metronome output.
//
// SIGNAL CHAIN (owned once, wired in constructor, never rewired outside this class):
//   instruments ──▶ masterSum ──▶ [master inserts] ──▶ masterGain ──▶ masterOut ──▶ outputGain ──▶ destination
//                                                            │            │
//                                                            │            └─▶ capture taps (additive)
//                                                            │                getMasterTap() for recording /
//                                                            │                shadow / broadcast / mixdown
//                                                            └─▶ meter tap
//                                                                useMasterMeter connects here
//
// `masterSum` is where channels land (getMasterInput()) and `[master inserts]` is the Arrange
// master effect chain (DEV-323), empty by default. Inserts sit BEFORE the fader, the way a DAW
// master strip does — the fader is clean output trim, not the thing driving a compressor. They
// are also before the tap, so they are printed: they are part of the mix.
//
// There is deliberately NO limiter or any other corrective processing here (DEV-322): murva
// measures level honestly and never fixes it automatically. What the meter reads is what
// leaves the bus. `outputGain` is a reserved unity stage POST-tap — anything that must be
// heard but never printed into a recording/export belongs there, and nothing else does.
//
// RULE: external code connects additively from getMasterTap() and disconnects ITS OWN node
// only (targeted single-argument disconnect). Never call bare masterGain.disconnect() —
// that drops every tap and the output chain. To render silently, use divertOutputToCapture().
class MasterAudioBus {
  private readonly masterSum: GainNode; // unity — where every channel lands, pre-inserts
  private readonly masterGain: GainNode;
  private readonly masterOut: GainNode; // unity — the capture tap point
  private readonly outputGain: GainNode; // unity, reserved post-tap stage (never printed)
  private readonly metronomeBus: GainNode; // Separate bus for metronome (bypasses master for recording)
  private readonly context: AudioContext;
  /** Current master insert chain, in order. Empty means masterSum wires straight to the fader. */
  private masterInserts: readonly MasterInsertNode[] = [];

  constructor(context: AudioContext) {
    this.context = context;

    // --- masterSum (unity; the channel-facing input, ahead of the inserts) ---
    this.masterSum = context.createGain();
    this.masterSum.gain.value = 1.0;
    this.masterSum.channelCount = 2;
    this.masterSum.channelCountMode = 'explicit';
    this.masterSum.channelInterpretation = 'speakers';

    // --- masterGain (the master fader) ---
    this.masterGain = context.createGain();
    this.masterGain.gain.value = dbToGain(toDecibels(DEFAULT_MASTER_VOLUME_DB));

    // CRITICAL: Configure for stereo output to preserve stereo effects (e.g., PingPongDelay)
    this.masterGain.channelCount = 2;
    this.masterGain.channelCountMode = 'explicit';
    this.masterGain.channelInterpretation = 'speakers';

    // --- masterOut (unity tap point) ---
    this.masterOut = context.createGain();
    this.masterOut.gain.value = 1.0;
    // Preserve stereo through the chain — a mono-collapsing node here would undo
    // the explicit stereo config on masterGain and break PingPongDelay et al.
    this.masterOut.channelCount = 2;
    this.masterOut.channelCountMode = 'explicit';
    this.masterOut.channelInterpretation = 'speakers';

    // --- outputGain (unity, post-tap) ---
    this.outputGain = context.createGain();
    this.outputGain.gain.value = 1.0;
    this.outputGain.channelCount = 2;
    this.outputGain.channelCountMode = 'explicit';
    this.outputGain.channelInterpretation = 'speakers';

    // Wire the chain: masterSum → masterGain → masterOut → outputGain → destination.
    // The masterSum → masterGain hop is what `setMasterInserts` re-routes; everything from the
    // fader onwards is owned here and never rewired from outside.
    this.masterSum.connect(this.masterGain);
    this.masterGain.connect(this.masterOut);
    this.masterOut.connect(this.outputGain);
    this.outputGain.connect(context.destination);

    // --- metronome bus (separate — bypasses master entirely, never recorded) ---
    this.metronomeBus = context.createGain();
    this.metronomeBus.gain.value = 1.0;
    this.metronomeBus.connect(context.destination);
  }

  // Get the master gain node for routing (the fader — used by meter taps).
  getMasterGain(): GainNode {
    return this.masterGain;
  }

  /**
   * Where channels connect (DEV-323) — ahead of the master inserts and the fader.
   *
   * Distinct from `getMasterGain()`, which stays the fader so the meter keeps reading the
   * post-fader signal. Before the master channel existed the two were the same node, and
   * connecting to the fader directly would now bypass every master insert.
   */
  getMasterInput(): GainNode {
    return this.masterSum;
  }

  /**
   * Replace the master insert chain (DEV-323).
   *
   * Rebuilds `masterSum → …inserts… → masterGain` from scratch each time rather than splicing:
   * an insert added one at a time otherwise leaves the previous last-node → fader connection
   * in place, and that stale edge is a dry path around the new insert — the exact bug
   * `rebuildChannelChain` documents for per-channel chains.
   *
   * Only the `masterSum` hop is touched. The fader, the tap and the output stage keep their
   * wiring, so a capture in flight is unaffected.
   */
  setMasterInserts(inserts: readonly MasterInsertNode[]): void {
    try { this.masterSum.disconnect(); } catch { /* nothing attached yet */ }
    for (const insert of this.masterInserts) {
      try { insert.outputNode.disconnect(); } catch { /* was not wired */ }
    }

    this.masterInserts = inserts;
    let current: AudioNode = this.masterSum;
    for (const insert of inserts) {
      try {
        current.connect(insert.inputNode);
        current = insert.outputNode;
      } catch (error) {
        console.warn('[MasterAudioBus] Failed to wire a master insert; skipping it', error);
      }
    }
    current.connect(this.masterGain);
  }

  /**
   * The post-fader, pre-output tap point. Capture hooks (recording, shadow, broadcast,
   * mixdown) connect additively from here and disconnect THEIR OWN node only. Never call
   * bare `.disconnect()` on the returned node — that drops the speaker path too.
   */
  getMasterTap(): GainNode {
    return this.masterOut;
  }

  /**
   * The reserved post-tap stage (DEV-322), as an input for signal that must be *heard* but
   * never *printed*: it sits after `masterOut`, so nothing connected here reaches a recording,
   * export, mixdown or broadcast. Remote voice in Arrange lands here (DEV-325).
   *
   * It also survives `divertOutputToCapture` — during a silent-render mixdown the master is
   * detached from this stage, but this stage stays wired to the speakers, so voice keeps
   * playing while the export runs.
   */
  getPostTapInput(): GainNode {
    return this.outputGain;
  }

  /**
   * Silent-render mode: detach the speaker path and send master output to `captureNode`
   * only. Arrange mixdown uses this so an export does not play out loud. Additive taps
   * (recording / shadow / broadcast) are untouched. Pair with `restoreOutputToSpeakers`.
   */
  divertOutputToCapture(captureNode: AudioNode): void {
    try {
      this.masterOut.disconnect(this.outputGain);
    } catch {
      // Already diverted — nothing to detach.
    }
    this.masterOut.connect(captureNode);
  }

  /** Undo `divertOutputToCapture`: drop the capture node, restore the speaker path. */
  restoreOutputToSpeakers(captureNode: AudioNode): void {
    try {
      this.masterOut.disconnect(captureNode);
    } catch {
      // Never diverted to this node — restoring the speaker path below is still correct.
    }
    this.masterOut.connect(this.outputGain);
  }

  // Route an audio node through the master bus (lands ahead of the inserts and the fader).
  routeToMaster(sourceNode: AudioNode): void {
    sourceNode.connect(this.masterSum);
  }

  // Route an audio node through the metronome bus (bypasses recording/broadcast)
  routeToMetronome(sourceNode: AudioNode): void {
    sourceNode.connect(this.metronomeBus);
  }

  // Get the metronome bus gain node
  getMetronomeBus(): GainNode {
    return this.metronomeBus;
  }

  // Set master volume
  setMasterVolume(volume: number): void {
    this.masterGain.gain.setValueAtTime(volume, this.context.currentTime);
  }

  cleanup(): void {
    this.masterGain.disconnect();
    this.masterOut.disconnect();
    this.outputGain.disconnect();
    this.metronomeBus.disconnect();
  }
}

// Audio Context Management for separated contexts
/* eslint-disable @typescript-eslint/member-ordering */
export class AudioContextManager {
  private static instrumentContext: AudioContext | null = null;
  private static webrtcContext: AudioContext | null = null;
  private static instrumentNodePool: AudioNodePool | null = null;
  private static masterBus: MasterAudioBus | null = null;
  private static performanceMonitorInterval: ReturnType<typeof setInterval> | null = null;
  // Lock to prevent concurrent AudioContext creation (Safari race condition fix)
  private static instrumentContextCreationPromise: Promise<AudioContext> | null = null;

  // Get or create instrument audio context
  static async getInstrumentContext(): Promise<AudioContext> {
    // Return existing context if valid
    if (this.instrumentContext && this.instrumentContext.state !== "closed") {
      if (this.instrumentContext.state === "suspended") {
        this.instrumentContext.resume().catch(console.warn);
      }
      return this.instrumentContext;
    }

    // If creation is already in progress, wait for it (prevents race condition)
    if (this.instrumentContextCreationPromise) {
      return this.instrumentContextCreationPromise;
    }

    // Start creation with lock
    this.instrumentContextCreationPromise = this.createInstrumentContext();
    try {
      const context = await this.instrumentContextCreationPromise;
      return context;
    } finally {
      this.instrumentContextCreationPromise = null;
    }
  }

  // Internal method to actually create the context
  private static async createInstrumentContext(): Promise<AudioContext> {
    // Double-check in case another call completed while we were waiting
    if (this.instrumentContext && this.instrumentContext.state !== "closed") {
      return this.instrumentContext;
    }

    const config = getOptimalAudioConfig();

    // Use Safari-compatible audio context creation for Safari browsers
    const { isSafari } = getWebRTCCapabilities();

    if (isSafari) {
      // Import Safari compatibility utility
      const { createWebKitCompatibleAudioContext } = await import(
        "@/shared/utils/webkitCompat"
      );
      this.instrumentContext = await createWebKitCompatibleAudioContext();
    } else {
      this.instrumentContext = new AudioContext(
        config.INSTRUMENT_AUDIO_CONTEXT,
      );
    }

    // Initialize node pool and master bus
    this.instrumentNodePool = new AudioNodePool(this.instrumentContext);
    if (config.MASTER_BUS.enabled) {
      this.masterBus = new MasterAudioBus(this.instrumentContext);
    }

    // Re-apply the user's chosen output device. Contexts get rebuilt (Safari path
    // above, and after a close), and without this the choice silently reverts to
    // the system default. Failures are non-fatal: audio still plays on the default.
    //
    // Awaited, not fire-and-forget: callers start playing as soon as this resolves,
    // and a context handed out before its sink is applied plays its first notes on
    // the wrong device and then audibly jumps mid-sound. Bounded by a timeout so a
    // `setSinkId` that never settles cannot wedge context creation — the apply is
    // then simply late, which is the pre-existing behaviour, not a hang.
    await applyOutputSinkWithinBudget(this.instrumentContext);

    // Log actual vs requested sample rate so users can diagnose mismatches
    const actualSr = this.instrumentContext.sampleRate;
    if (actualSr !== config.INSTRUMENT_AUDIO_CONTEXT.sampleRate) {
      console.warn(
        `🎵 Instrument AudioContext: requested ${config.INSTRUMENT_AUDIO_CONTEXT.sampleRate} Hz, got ${actualSr} Hz (browser follows system audio device setting)`,
      );
    }

    // Add performance monitoring
    this.setupPerformanceMonitoring();

    // Ensure Tone.js uses this context for all Tone nodes
    try {
      const ToneModule = await import("tone");
      const toneCtx = ToneModule.getContext();
      if (toneCtx.rawContext !== this.instrumentContext) {
        ToneModule.setContext(this.instrumentContext);
      }
      // Apply Tone timing preferences
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
      if (ToneModule.getContext) {
        const ctx = ToneModule.getContext();
        ctx.lookAhead = config.TONE_CONTEXT.lookAhead;
        // updateInterval is a valid property on Tone's internal context
        (ctx as unknown as Record<string, number>).updateInterval = config.TONE_CONTEXT.updateInterval;
      }
    } catch {
      // Tone not available or failed to set context; ignore
    }

    if (this.instrumentContext.state === "suspended") {
      this.instrumentContext.resume().catch(console.warn);
    }

    return this.instrumentContext;
  }

  // Get the audio node pool for efficient node reuse
  static getNodePool(): AudioNodePool | null {
    return this.instrumentNodePool;
  }

  // Get the master audio bus for routing
  static getMasterBus(): MasterAudioBus | null {
    return this.masterBus;
  }

  // Get or create WebRTC audio context
  static async getWebRTCContext(): Promise<AudioContext> {
    if (!this.webrtcContext || this.webrtcContext.state === "closed") {
      const config = getOptimalAudioConfig();

      // Use Safari-compatible audio context creation for Safari browsers
      const { isSafari } = getWebRTCCapabilities();

      if (isSafari) {
        // Import Safari compatibility utility
        const { createWebKitCompatibleAudioContext } = await import(
          "@/shared/utils/webkitCompat"
        );
        this.webrtcContext = await createWebKitCompatibleAudioContext();
      } else {
        this.webrtcContext = new AudioContext(config.WEBRTC_AUDIO_CONTEXT);
      }

      const actualSr = this.webrtcContext.sampleRate;
      if (actualSr !== config.WEBRTC_AUDIO_CONTEXT.sampleRate) {
        console.warn(
          `🎤 WebRTC AudioContext: requested ${config.WEBRTC_AUDIO_CONTEXT.sampleRate} Hz, got ${actualSr} Hz (browser follows system audio device setting)`,
        );
      }

      // Warn if sample rates don't match
      if (
        this.instrumentContext &&
        this.instrumentContext.sampleRate !== this.webrtcContext.sampleRate
      ) {
        console.warn(
          `⚠️ Sample rate mismatch! Instrument: ${this.instrumentContext.sampleRate}Hz, WebRTC: ${this.webrtcContext.sampleRate}Hz`,
        );
      }

      // Keep Tone context on instrument context; do not switch to WebRTC context to avoid breaking music engine
    }

    if (this.webrtcContext.state === "suspended") {
      this.webrtcContext.resume().catch(console.warn);
    }

    return this.webrtcContext;
  }

  // Get application-wide polyphony limit
  static getMaxPolyphony(): number {
    return APP_MAX_POLYPHONY;
  }

  // Setup performance monitoring for audio contexts
  private static setupPerformanceMonitoring() {
    if (!this.instrumentContext || this.performanceMonitorInterval) {
      return;
    }

    // Monitor CPU usage and adjust buffer size if needed
    this.performanceMonitorInterval = setInterval(() => {
      if (
        this.instrumentContext &&
        this.instrumentContext.state === "running" &&
        this.webrtcContext
      ) {
        const baseLatency = this.instrumentContext.baseLatency;
        const outputLatency = this.instrumentContext.outputLatency;
        const totalLatency = baseLatency + outputLatency;

        // Monitor for high latency
        if (totalLatency > 0.05) {
          // 50ms
          console.warn(
            `🚨 High audio latency detected: ${(totalLatency * 1000).toFixed(1)}ms`,
          );
        }

        // Monitor WebRTC context specifically
        // NOTE: This measures Web Audio API context latency (browser audio processing overhead),
        // NOT the actual WebRTC network round-trip time. For network latency, see the
        // useRTCLatencyMeasurement hook which measures actual peer connection RTT.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
        if (this.webrtcContext && this.webrtcContext.state === "running") {
          const webrtcLatency =
            this.webrtcContext.baseLatency + this.webrtcContext.outputLatency;
          if (webrtcLatency > 0.05) {
            // Increased threshold to 50ms to reduce false warnings
            console.warn(
              `🎤 Web Audio API context latency: ${(webrtcLatency * 1000).toFixed(1)}ms (this is browser audio processing, not network latency)`,
            );
          }
        }
      }
    }, 5000); // Check every 5 seconds
  }

  private static clearPerformanceMonitoring(): void {
    if (this.performanceMonitorInterval) {
      clearInterval(this.performanceMonitorInterval);
      this.performanceMonitorInterval = null;
    }
  }

  // Cleanup contexts
  static async cleanup() {
    this.clearPerformanceMonitoring();

    // Cleanup node pool and master bus
    if (this.instrumentNodePool) {
      this.instrumentNodePool.cleanup();
      this.instrumentNodePool = null;
    }
    if (this.masterBus) {
      this.masterBus.cleanup();
      this.masterBus = null;
    }

    if (this.instrumentContext) {
      await this.instrumentContext.close();
      this.instrumentContext = null;
    }
    if (this.webrtcContext) {
      await this.webrtcContext.close();
      this.webrtcContext = null;
    }
  }

  // Suspend instrument context to reduce CPU when not needed
  static async suspendInstrumentContext() {
    if (this.instrumentContext && this.instrumentContext.state === "running") {
      await this.instrumentContext.suspend();
    }
  }

  // Resume instrument context
  static async resumeInstrumentContext() {
    if (
      this.instrumentContext &&
      this.instrumentContext.state === "suspended"
    ) {
      await this.instrumentContext.resume();
    }
  }

  // Cleanup WebRTC context specifically
  static async cleanupWebRTC() {
    if (this.webrtcContext) {
      await this.webrtcContext.close();
      this.webrtcContext = null;
    }
  }
}
