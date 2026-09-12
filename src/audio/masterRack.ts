import { MasterEffects, FilterType } from '../types';
import { MAX_FADER_GAIN } from '../utils/gainUnits';
import { random } from './rng';
import { clampEffects, clampEffectValue } from './effectLimits';
import { IMPULSE_CACHE_SAMPLE_BUDGET, impulseSampleCount, keysToEvict } from './impulseBudget';

/**
 * The engine services a subsystem may call back into. Handed to every subsystem's
 * constructor rather than reached for through the engine, so a subsystem holds exactly
 * the seams it uses and no reference to the whole engine.
 *
 * `markActivity`/`wakeIfIdle` are the idle-suspend lifecycle: the engine is the one place
 * that sees the clock's listener count and the voice count together, so only it decides
 * when the context may be suspended. `realtimeCtx` narrows the widened context back to a
 * real `AudioContext` (null for an offline render) — the same one door `AudioEngine` uses.
 */
export interface EngineHooks {
  markActivity(): void;
  wakeIfIdle(): void;
  realtimeCtx(): AudioContext | null;
}

/**
 * The master signal graph: the fixed EQ -> masterGain tail, the two master analysers,
 * the parallel delay/reverb/distortion sends, the per-source buses and taps, the drum
 * bus/send filters and the drum track faders. It owns every node `setupMasterChain`
 * builds and clears its node maps there, because a node belongs to its context.
 *
 * It also hosts the two node/param utilities a sibling needs but owns no state of its
 * own: `release()` (disconnect a group of nodes, ignoring the already-dead ones) and
 * `cancelAndHold()` (a `cancelAndHoldAtTime` with a Firefox fallback).
 */
export class MasterRack {
  // Master bus nodes
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  /**
   * Second master analyser, for LEVEL rather than spectrum. Separate from `analyser` because
   * AudioVisualizer draws from that node's 128 frequency bins and changing its fftSize would
   * silently rescale every bar it draws — while a peak read wants a long window: 256 samples is
   * ~5ms at 48kHz, under a third of a 60Hz tick, so short-window peaks would be missed.
   */
  private levelAnalyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  /**
   * Which master dynamics stages are currently WIRED IN, as a short code:
   * '' (neither), 'c', 'l' or 'cl'. rewireMasterDynamics compares against it
   * so a repeated updateEffects — and there is one per effects change — does
   * not tear the master tail down and rebuild it for nothing.
   *
   * Seeded to the sentinel 'unbuilt', which no toggle combination can produce,
   * so setupMasterChain's own seeding call always runs.
   */
  private dynamicsTopology = 'unbuilt';

  // Effect nodes
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  // Last decay applied to the convolver, already quantised. Guards against
  // re-randomizing the reverb tail on every setReverbDecay call.
  private reverbDecay = 2.0;

  // Impulse responses keyed by quantised decay, bounded by TOTAL SAMPLES
  // (see audio/impulseBudget.ts) rather than by entry count. The 0.1 s quantum
  // over the 0.1-10 s clamp range is up to 100 distinct decays, and a 10 s
  // stereo buffer at 48 kHz is ~3.84 MB — an 8-ENTRY cap therefore allowed
  // ~30 MB of pinned AudioBuffer, while eight short impulses cost ~150 KB. The
  // cap was measuring the wrong thing.
  //
  // Building one is sampleRate * decay * 2 channels of Math.random() +
  // Math.pow() on the main thread, so this cache skips the rebuild once a
  // value has been seen. Swap and rebuild share one gate
  // (nextDecay !== this.reverbDecay in setReverbDecay, which owns the decay
  // path so a knob drag's transient values never reach updateEffects), so a
  // monotonic sweep
  // still swaps convolver.buffer once per 0.1 s step crossed — this cache
  // skips the expensive rebuild, not the swap itself. `samples` is recorded at
  // build time from the decay rather than read off the AudioBuffer, so the
  // accounting does not depend on AudioBuffer.length. Cleared in
  // setupMasterChain: an AudioBuffer belongs to its context.
  private impulseCache = new Map<number, { buffer: AudioBuffer; samples: number }>();
  /** Overridable for tests; production always uses the module default. */
  private impulseCacheSampleBudget = IMPULSE_CACHE_SAMPLE_BUDGET;

  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayGain: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;
  private distortionGain: GainNode | null = null;
  private eqLowNode: BiquadFilterNode | null = null;
  private eqMidNode: BiquadFilterNode | null = null;
  private eqHighNode: BiquadFilterNode | null = null;
  dryGain: GainNode | null = null;
  // Drum bus filter: all drum voices route through this single filter
  // (SequencerView "Drum Filter" card controls cutoff/resonance/type). The
  // param fields survive the AudioContext chain being (re)built, so values
  // set before init() apply to the filter node created later.
  drumBusFilter: BiquadFilterNode | null = null;

  // A mirror of drumBusFilter used only for the drum reverb sends. The dry
  // path and the send path must be filtered identically, but drumBusFilter is
  // ONE shared node, so a per-voice send cannot be tapped downstream of it
  // without a per-voice filter copy — which would lose the live filter sweeps
  // on ringing tails that the shared node exists to provide. A second shared
  // filter fed by the per-voice send gains gets both.
  drumSendFilter: BiquadFilterNode | null = null;
  /**
   * The Beat source fader/mute for authored drum reverb sends. Drum sends do
   * not use getSourceBus('sequencer'): that bus fans out to the dry path and
   * the generic master effects, while these sends must reach only reverb.
   * Mirroring the sequencer bus here keeps the authored send on that same
   * source control without putting a gate after the convolver, where muting
   * Beat would incorrectly erase a tail that was already ringing.
   */
  private drumSendGate: GainNode | null = null;
  drumFilterCutoff = 12000;
  drumFilterResonance = 0.7;
  drumFilterType: FilterType = 'lowpass';

  // Per-source buses: one gain bus per source string ('synth', 'chord', 'bass', ...).
  // Voice gains connect here instead of straight to dry/effects, so a whole layer
  // (e.g. bass) can be muted or leveled with one click-free ramp.
  private sourceBuses = new Map<string, GainNode>();
  /**
   * instrument -> its persistent track fader, created lazily on first use and
   * cleared with sourceBuses. A GainNode, not a velocity multiplier: a
   * velocity is a per-hit performance attribute, and the 0..1 rule governs
   * the INPUT parameter, not whatever a caller derives from the clamped
   * result — see `hitLevel` in `triggerDrum`. A fader routed through it
   * could not express the +12 dB the range promises, and it could not move
   * an already-sounding tail.
   */
  drumTrackGains = new Map<string, GainNode>();

  // One analyser per source TAP, for per-layer scopes (the Synth view's
  // oscilloscope follows its Target selector). Cleared with sourceBuses in
  // setupMasterChain — an AnalyserNode belongs to the context that made it.
  private sourceAnalysers = new Map<string, AnalyserNode>();

  // One analyser per source BUS, for the per-layer meters on the Sound mixer.
  // Separate from sourceAnalysers because it reads a different POINT (after
  // the bus gain, so fader/mute/solo are in it) for a different QUESTION —
  // "how much of this layer is in the mix?" rather than "how hard is this
  // patch driving?" — and is configured for level rather than for a trace.
  // Cleared with sourceBuses, for the same reason they are.
  private sourceLevelAnalysers = new Map<string, AnalyserNode>();

  /** Unity pass-through in front of each source bus, so a per-layer scope can
   *  read the layer PRE-fader. Everything that used to connect straight to
   *  getSourceBus() connects here instead; the tap's only output is the bus,
   *  so it changes no gain and no routing. It exists because the scope has to
   *  answer "how hard is this patch driving?", and a post-fader tap answers
   *  "how much of it is in the mix?" — with the buses starting at −6 dB, a
   *  patch at full scale painted a half-height trace and pulling a fader
   *  shrank the wave of a patch that had not changed. Cleared with
   *  sourceBuses: a tap from a dead context feeds a dead bus. */
  private sourceTaps = new Map<string, GainNode>();
  private sourceMuted = new Map<string, boolean>();
  private sourceGains = new Map<string, number>();

  noiseBuffer: AudioBuffer | null = null;

  private static readonly REVERB_CURVE = 2.0; // impulse envelope exponent; not user-facing

  /**
   * The context `bind()` stored. `BaseAudioContext`, not `AudioContext`: an offline
   * render binds an `OfflineAudioContext`, which has every node factory this subsystem
   * uses but no `close()`. Null until `init()`/`bindContext` hands one over — which is
   * what keeps every setter here a no-op before init.
   */
  private ctx: BaseAudioContext | null = null;

  /** Binds the context this subsystem builds its nodes and schedules against. */
  bind(ctx: BaseAudioContext): void {
    this.ctx = ctx;
  }

  setupMasterChain(): void {
    if (!this.ctx) return;

    // NOTE: this cleanup is currently UNREACHABLE, and that is a deliberate
    // keep, not an oversight. init() only calls setupMasterChain inside
    // `if (!this.ctx)` and nothing anywhere calls ctx.close(), so the context
    // is created exactly once per page load and this method runs exactly once
    // — these three clears have never executed in production.
    //
    // They stay because they are the correct behaviour the day the context IS
    // recreated: per-source buses from a dead context are wired into dead
    // nodes, and an AudioBuffer belongs to the context that created it, so
    // impulses built against the old one must not survive into the new graph.
    // Do NOT write new code that relies on these running.
    this.sourceBuses.clear();
    this.sourceTaps.clear();
    this.drumTrackGains.clear();
    this.sourceAnalysers.clear();
    this.sourceLevelAnalysers.clear();
    this.levelAnalyser = null;
    this.impulseCache.clear();
    this.reverbDecay = 2.0;

    // Master output & analyser. masterGain is the USER's master trim and
    // nothing else: engineSync subscribes masterVolume with fireImmediately,
    // so it is overwritten before the first frame — a "staging ceiling" seeded
    // here would be a comment describing a value that never applies.
    //
    // BOTH DYNAMICS STAGES ARE EXPLICIT, TOGGLEABLE MASTER FX — neither is
    // wired in unconditionally the way the pre-DEV-385 compressor was, and
    // neither sits between the meter tap and the reading. The compressor
    // defaults OFF. The limiter defaults ON as of DEV-383, because the five
    // source buses now start at −6 dB and the measured sum still peaks above
    // 0 dBFS on the densest presets; at its −3 dB threshold it catches those
    // occasional overs and does nothing at all the rest of the time, so the
    // meter still reports the mix the user made. A user who wants the raw sum
    // switches it off in the Effects view.
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    // Level analyser: long window, no smoothing. `smoothingTimeConstant` only affects frequency
    // reads, but it is pinned at 0 here so the node states what it is for.
    this.levelAnalyser = this.ctx.createAnalyser();
    this.levelAnalyser.fftSize = 2048;
    this.levelAnalyser.smoothingTimeConstant = 0;

    // Master Compressor
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Master limiter — an opt-in, mostly-idle safety net (Web Audio has no
    // dedicated limiter; a max-ratio compressor with a hard knee is the
    // standard stand-in). These are SEED VALUES OF A STAGE THAT DEFAULTS ON as
    // of DEV-383 — it is wired into the path on a fresh session, and only the
    // user switching it off in the Effects view takes it back out. It catches
    // overs above −3 dB, and the DEV-383 bus staging above should keep its gain
    // reduction near zero. updateEffects overwrites all four of these from
    // stored state; knee is the one that stays, because a soft-kneed limiter
    // stops being a limiter.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    // 3-Band EQ
    this.eqLowNode = this.ctx.createBiquadFilter();
    this.eqLowNode.type = 'lowshelf';
    this.eqLowNode.frequency.value = 250;
    this.eqLowNode.gain.value = 0;

    this.eqMidNode = this.ctx.createBiquadFilter();
    this.eqMidNode.type = 'peaking';
    this.eqMidNode.frequency.value = 1500;
    this.eqMidNode.Q.value = 1;
    this.eqMidNode.gain.value = 0;

    this.eqHighNode = this.ctx.createBiquadFilter();
    this.eqHighNode.type = 'highshelf';
    this.eqHighNode.frequency.value = 4000;
    this.eqHighNode.gain.value = 0;

    // Dry bus
    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1.0;

    // Drum bus filter — routed through the sequencer source bus for volume and mute control
    this.drumBusFilter = this.ctx.createBiquadFilter();
    this.drumBusFilter.type = this.drumFilterType;
    this.drumBusFilter.frequency.value = this.drumFilterCutoff;
    this.drumBusFilter.Q.value = this.drumFilterResonance;
    this.drumBusFilter.connect(this.getSourceTap('sequencer'));

    // Same settings, wired to the reverb send only.
    this.drumSendFilter = this.ctx.createBiquadFilter();
    this.drumSendFilter.type = this.drumFilterType;
    this.drumSendFilter.frequency.value = this.drumFilterCutoff;
    this.drumSendFilter.Q.value = this.drumFilterResonance;
    this.drumSendGate = this.ctx.createGain();
    // getSourceTap('sequencer') above has already created and seeded the dry
    // bus from sourceGains/sourceMuted. Copy that exact source level so a
    // pre-init snapshot starts both branches in the same state.
    this.drumSendGate.gain.value = this.getSourceBus('sequencer').gain.value;

    // Every wet send and EQ gain is seeded at ZERO. The audible defaults are
    // INITIAL_EFFECTS and arrive through applyEngineSnapshot() on the first
    // user click; seeding a second set here was a second source of truth that
    // already disagreed with initialState.ts (distortionWet 0.1 vs 0.0, eqLow
    // 2 vs 0, eqHigh 3 vs 0) and was silently overwritten anyway.

    // Delay
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.25;
    this.delayFeedbackGain = this.ctx.createGain();
    this.delayFeedbackGain.gain.value = 0.35;
    this.delayGain = this.ctx.createGain();
    this.delayGain.gain.value = 0;

    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayGain);

    // Distortion
    this.distortionNode = this.ctx.createWaveShaper();
    this.distortionNode.curve = this.makeDistortionCurve(20);
    this.distortionNode.oversample = '4x';
    this.distortionGain = this.ctx.createGain();
    this.distortionGain.gain.value = 0.0;

    this.distortionNode.connect(this.distortionGain);

    // Reverb (synthesized impulse response)
    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = this.getImpulseResponse(2.0);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0;

    this.reverbNode.connect(this.reverbGain);
    // Gate BEFORE the convolver: mute blocks new drum input while the reverb
    // tail already inside the shared processor keeps decaying naturally.
    this.drumSendFilter.connect(this.drumSendGate);
    this.drumSendGate.connect(this.reverbNode);

    // Connect effects back to EQ chain
    this.dryGain.connect(this.eqLowNode);
    this.delayGain.connect(this.eqLowNode);
    this.reverbGain.connect(this.eqLowNode);
    this.distortionGain.connect(this.eqLowNode);

    this.eqLowNode.connect(this.eqMidNode);
    this.eqMidNode.connect(this.eqHighNode);
    this.eqHighNode.connect(this.masterGain);

    // Everything below masterGain is owned by rewireMasterDynamics — including
    // BOTH analyser taps, which it re-makes on every pass. Seeding through it
    // rather than around it means the graph has exactly one builder, so the
    // first updateEffects can never find a topology it did not construct.
    this.dynamicsTopology = 'unbuilt';
    this.rewireMasterDynamics(false, false);
  }

  /**
   * Rebuilds the master tail below masterGain for the requested pair of
   * dynamics stages.
   *
   * A series stage cannot be bypassed the way the parallel SENDS are. Reverb,
   * delay and distortion bypass by forcing their send gain to 0 (see
   * updateEffects) because a send is ADDED to a dry path that always passes.
   * A compressor is in the path: forcing anything about it to zero gives
   * silence, not passthrough. A dry/wet crossfade around it would restore
   * passthrough but would leave the node connected and processing, which is
   * precisely the invisible, unavoidable staging DEV-385 exists to remove. So
   * the bypass is a real reconnect.
   *
   * The three nodes are created ONCE in setupMasterChain and never re-created,
   * so a rewire cannot orphan one: it drops every outgoing edge of the three,
   * then re-makes exactly the edges the topology needs.
   *
   * THE TWO ANALYSER SENDS ARE PART OF THAT. masterGain.disconnect() drops
   * both of DEV-384's observe-only taps along with the audio edge, and neither
   * has an output of its own to put it back. `analyser` is the 128-bin
   * spectrum node AudioVisualizer draws; `levelAnalyser` is the node
   * getMasterLevelAnalyser() hands to useMeterLevel — it IS the meter behind
   * VuMeter and AmbientBackdrop. Re-making only the first is a silent failure:
   * no throw, no orphan, audio unchanged, every dBFS reading -inf forever.
   *
   * NOTE — switching a stage while it is actively reducing gain can click: the
   * sample stream jumps from the reduced output to the raw one. Accepted, not
   * worked around. It is a discrete user action on a safety net, the jump is
   * zero whenever the net is idle (which is the common case), and the fix —
   * mute masterGain, rewire on a timer, unmute — would make the topology
   * change unobservable synchronously and put every graph test on a timer.
   */
  private rewireMasterDynamics(compressorOn: boolean, limiterOn: boolean): void {
    if (
      !this.ctx ||
      !this.masterGain ||
      !this.compressor ||
      !this.limiter ||
      !this.analyser ||
      !this.levelAnalyser
    ) {
      return;
    }

    const topology = `${compressorOn ? 'c' : ''}${limiterOn ? 'l' : ''}`;
    if (topology === this.dynamicsTopology) return;

    this.masterGain.disconnect();
    this.compressor.disconnect();
    this.limiter.disconnect();

    // BOTH observe-only taps are re-made FIRST and unconditionally, in the
    // order DEV-384 wired them. Each hangs off masterGain with no onward
    // output, so the disconnect above just dropped both and nothing else would
    // put either back — and both must stay AHEAD of the two stages, or they
    // would report post-squash audio instead of the mix the user made.
    // levelAnalyser is not optional decoration: it is the node
    // getMasterLevelAnalyser() returns, so dropping it silently kills VuMeter
    // and AmbientBackdrop while leaving the audio path perfect.
    this.masterGain.connect(this.analyser);
    this.masterGain.connect(this.levelAnalyser);

    const stages: DynamicsCompressorNode[] = [];
    if (compressorOn) stages.push(this.compressor);
    if (limiterOn) stages.push(this.limiter);

    let node: AudioNode = this.masterGain;
    for (const stage of stages) {
      node.connect(stage);
      node = stage;
    }
    node.connect(this.ctx.destination);

    this.dynamicsTopology = topology;
  }

  private makeDistortionCurve(amount = 20): Float32Array<ArrayBuffer> {
    const k = typeof amount === 'number' ? amount : 50;
    const nSamples = 44100;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    for (let i = 0; i < nSamples; ++i) {
      const x = (i * 2) / nSamples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  /**
   * A synthesized reverb impulse: `durationSec` of decaying noise shaped by
   * `curve`.
   *
   * `curve` is the exponent in pow(n / length, curve) and is NOT the user's
   * Decay knob — it stays fixed at 2.0. The knob is `durationSec`. Feeding the
   * knob into the exponent (as this used to be called) inverts the control: a
   * higher value steepens the envelope, so a "6.0 s" setting sounded SHORTER
   * than a "1.0 s" one, and the real tail was pinned at 2 s either way.
   */
  private buildImpulseResponse(durationSec: number, curve: number): AudioBuffer {
    if (!this.ctx) return new AudioBuffer({ length: 1, numberOfChannels: 2, sampleRate: 44100 });
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = length - i;
      left[i] = (random() * 2 - 1) * Math.pow(n / length, curve);
      right[i] = (random() * 2 - 1) * Math.pow(n / length, curve);
    }
    return impulse;
  }

  /** The knob's own resolution (EffectsRackView's Decay step is 0.1). */
  /**
   * The knob's own resolution (EffectsRackView's Decay step is 0.1).
   *
   * Only caller is setReverbDecay, which already ran `decay` through
   * clampEffectValue — so it is always finite and within
   * EFFECT_LIMITS.reverbDecay. Re-clamping here would be a second source of
   * truth for the same bound; this only quantises.
   */
  private quantiseDecay(decay: number): number {
    return Math.round(decay * 10) / 10;
  }

  /**
   * Cached impulse for a quantised decay, built on first use. Bounded by a
   * total-sample budget with LRU eviction — see `audio/impulseBudget.ts` for
   * the policy and the field comment on `impulseCache` for why bytes, not
   * entries, is the right unit here.
   */
  private getImpulseResponse(quantisedDecay: number): AudioBuffer {
    const cached = this.impulseCache.get(quantisedDecay);
    if (cached) {
      // Re-inserting moves the key to the end of the Map's iteration order,
      // which this cache uses as its LRU recency order.
      this.impulseCache.delete(quantisedDecay);
      this.impulseCache.set(quantisedDecay, cached);
      return cached.buffer;
    }
    const buffer = this.buildImpulseResponse(quantisedDecay, MasterRack.REVERB_CURVE);
    const samples = impulseSampleCount(this.ctx?.sampleRate ?? 44100, quantisedDecay);
    this.impulseCache.set(quantisedDecay, { buffer, samples });

    const entries = Array.from(this.impulseCache, ([key, value]) => ({ key, samples: value.samples }));
    for (const key of keysToEvict(entries, this.impulseCacheSampleBudget)) {
      this.impulseCache.delete(key);
    }
    return buffer;
  }

  // Lazily create (and cache) the gain bus for a source, wired like the old
  // per-voice routing: dry + conditionally delay/reverb/distortion.
  getSourceBus(source: string): GainNode {
    if (!this.ctx || !this.dryGain) throw new Error('AudioContext not initialized');
    let bus = this.sourceBuses.get(source);
    if (!bus) {
      bus = this.ctx.createGain();
      const baseGain = this.sourceGains.get(source) ?? 1;
      bus.gain.value = this.sourceMuted.get(source) ? 0 : baseGain;
      bus.connect(this.dryGain);
      if (this.delayNode) bus.connect(this.delayNode);
      if (this.reverbNode) bus.connect(this.reverbNode);
      if (this.distortionNode) bus.connect(this.distortionNode);
      this.sourceBuses.set(source, bus);
    }
    return bus;
  }

  // The pre-fader entry point for a source. Unity, one output (the bus), never
  // touched by setSourceGain/setSourceMuted — those stay on the bus, so mute
  // and fader keep working exactly as before while the tap keeps carrying the
  // patch's own level for the scope to read.
  getSourceTap(source: string): GainNode {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    let tap = this.sourceTaps.get(source);
    if (!tap) {
      tap = this.ctx.createGain();
      tap.gain.value = 1;
      tap.connect(this.getSourceBus(source));
      this.sourceTaps.set(source, tap);
    }
    return tap;
  }

  /** Apply one click-free source level to every branch that source owns. */
  private rampSourceLevel(source: string, targetGain: number, now: number): void {
    const bus = this.sourceBuses.get(source) ?? this.getSourceBus(source);
    const nodes = source === 'sequencer' && this.drumSendGate
      ? [bus, this.drumSendGate]
      : [bus];
    for (const node of nodes) {
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(targetGain, now, 0.01);
    }
  }

  // Mute/unmute an entire source layer with a ~10 ms click-free ramp. The
  // source stops feeding every downstream branch; effect tails already inside
  // the shared processors remain free to decay.
  setSourceMuted(source: string, muted: boolean, time?: number): void {
    this.sourceMuted.set(source, muted);
    if (!this.ctx) return;
    const now = Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime);
    const targetGain = muted ? 0 : (this.sourceGains.get(source) ?? 1);
    this.rampSourceLevel(source, targetGain, now);
  }

  // Set gain/volume for an entire source layer (e.g. chord, bass, synth)
  setSourceGain(source: string, volume: number, time?: number): void {
    this.sourceGains.set(source, volume);
    if (!this.ctx) return;
    const now = Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime);
    const isMuted = this.sourceMuted.get(source);
    // Derived from the fader range (MAX_FADER_GAIN is dbToGain(FADER_MAX_DB)),
    // not an independent literal. It used to be 1.5 — +3.5 dB — so a fader
    // that displayed +12 dB stopped responding two-thirds of the way up.
    this.rampSourceLevel(
      source,
      isMuted ? 0 : Math.max(0, Math.min(MAX_FADER_GAIN, volume)),
      now,
    );
  }

  /**
   * Truncate `param`'s automation at `now`, keeping the value the curve has
   * there so the next ramp starts without a step.
   *
   * `fallbackValue` is for engines with no cancelAndHoldAtTime: `param.value`
   * reads the value at *currentTime*, which is simply wrong when `now` is in
   * the future, so a caller scheduling ahead passes its best estimate.
   */
  cancelAndHold(param: AudioParam, now: number, fallbackValue?: number): void {
    // Read the value BEFORE cancelling: cancelScheduledValues deletes the
    // in-flight ramp, so param.value reverts to the last surviving event and
    // the fallback would anchor at the wrong level — usually the note-on floor.
    const held = fallbackValue ?? param.value;
    try {
      param.cancelAndHoldAtTime(now);
    } catch {
      param.cancelScheduledValues(now);
      param.setValueAtTime(held, now);
    }
  }

  /**
   * THE teardown for a finished one-shot voice: disconnect every node it
   * built, each in its own try/catch so one already-disposed node cannot
   * strand the rest of the graph. `null`/`undefined` entries are skipped, so
   * an optional node (a reverb `send`, a top-cut filter) is passed
   * unconditionally rather than guarded at each call site.
   *
   * Written once because the failure mode of the hand-copied
   * `try { x.disconnect(); } catch {}` block it replaces — omitting one node
   * from the list — is a silent graph leak: nothing throws, nothing sounds
   * wrong, and no test can see it. It only disconnects; a caller that must
   * also stop a source, clear a map entry or null a field keeps that inline.
   */
  release(...nodes: (AudioNode | null | undefined)[]): void {
    for (const node of nodes) {
      if (!node) continue;
      try { node.disconnect(); } catch { /* ignore */ }
    }
  }

  createNoiseNode(): AudioBufferSourceNode {
    if (!this.ctx) return {} as AudioBufferSourceNode;
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== this.ctx.sampleRate) {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    // Always looped. The buffer is 2 s; a pad's release runs longer, and now
    // that drum voices start at a RANDOM offset a one-shot could reach the end
    // mid-decay (the crash already used 1.8 s of the 2 s from offset 0).
    noise.loop = true;
    return noise;
  }

  /**
   * Structural half of the reverb control, split out of updateEffects so the
   * store bridge can commit it on gesture end.
   *
   * Assigning ConvolverNode.buffer is not a pointer swap: Blink rebuilds the
   * partitioned-FFT reverb and takes the graph lock, and a miss in
   * impulseCache additionally builds sampleRate * decay * 2 channels of
   * Float32Array on the main thread. quantiseDecay's 0.1 s step equals the
   * Decay knob's own step, so an unthrottled drag missed the cache on every
   * pointer frame — see engineSync's REVERB_DECAY_COMMIT_MS.
   *
   * The audible WET amount (reverbGain) is unaffected and stays continuous.
   */
  setReverbDecay(decay: number): void {
    if (!this.ctx || !this.reverbNode) return;
    // Clamped here, not by the caller: updateEffects used to clamp the whole
    // effects object before this ran, and a persisted or imported project is
    // untrusted input (a non-finite decay becomes a NaN buffer length).
    const nextDecay = this.quantiseDecay(clampEffectValue('reverbDecay', decay));
    if (nextDecay === this.reverbDecay) return;
    this.reverbNode.buffer = this.getImpulseResponse(nextDecay);
    this.reverbDecay = nextDecay;
  }

  // `reverbDecay` is intentionally absent: it is the structural half of the
  // reverb control, owned by setReverbDecay above, and this narrower type
  // makes a caller that still has it (persisted state, a store slice) unable
  // to silently drop it here instead of routing it to its real setter.
  updateEffects(raw: Omit<MasterEffects, 'reverbDecay'>): void {
    if (!this.ctx) return;
    // Clamp before anything touches an AudioParam. A persisted or imported
    // project is untrusted input: delayFeedback >= 1 is a runaway loop and a
    // non-finite value writes NaN into the graph, which silences it permanently.
    // reverbDecay is filled in from the engine's own tracked value only to
    // satisfy clampEffects' MasterEffects parameter — the clamped result is
    // never read back out of `fx` below.
    const fx = clampEffects({ ...raw, reverbDecay: this.reverbDecay });
    const reverbWet = fx.reverbBypass ? 0 : fx.reverbWet;
    const delayWet = fx.delayBypass ? 0 : fx.delayWet;
    const delayFeedback = fx.delayBypass ? 0 : fx.delayFeedback;
    const distortionWet = fx.distortionBypass ? 0 : fx.distortionWet;
    const eqLow = fx.eqBypass ? 0 : fx.eqLow;
    const eqMid = fx.eqBypass ? 0 : fx.eqMid;
    const eqHigh = fx.eqBypass ? 0 : fx.eqHigh;

    // Both dynamics stages are max-ratio-or-not DynamicsCompressorNodes; the
    // "limiter" is a max-ratio compressor with a HARD KNEE, which is the
    // standard Web Audio stand-in for a dedicated limiter (the API has none).
    // knee is not stored state: 30 and 0 are set once in setupMasterChain,
    // because a soft-kneed limiter stops being a limiter.
    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(fx.compressorThreshold, this.ctx.currentTime, 0.05);
      this.compressor.ratio.setTargetAtTime(fx.compressorRatio, this.ctx.currentTime, 0.05);
      this.compressor.attack.setTargetAtTime(fx.compressorAttack, this.ctx.currentTime, 0.05);
      this.compressor.release.setTargetAtTime(fx.compressorRelease, this.ctx.currentTime, 0.05);
    }

    if (this.limiter) {
      this.limiter.threshold.setTargetAtTime(fx.limiterThreshold, this.ctx.currentTime, 0.05);
      this.limiter.ratio.setTargetAtTime(fx.limiterRatio, this.ctx.currentTime, 0.05);
      this.limiter.attack.setTargetAtTime(fx.limiterAttack, this.ctx.currentTime, 0.05);
      this.limiter.release.setTargetAtTime(fx.limiterRelease, this.ctx.currentTime, 0.05);
    }

    // Parameters first, topology second: a stage that is about to be inserted
    // should already hold its own settings when the signal reaches it.
    this.rewireMasterDynamics(fx.compressorEnabled, fx.limiterEnabled);

    if (this.reverbGain) this.reverbGain.gain.setTargetAtTime(reverbWet, this.ctx.currentTime, 0.05);
    if (this.delayGain) this.delayGain.gain.setTargetAtTime(delayWet, this.ctx.currentTime, 0.05);
    if (this.delayFeedbackGain) this.delayFeedbackGain.gain.setTargetAtTime(delayFeedback, this.ctx.currentTime, 0.05);
    if (this.distortionGain) this.distortionGain.gain.setTargetAtTime(distortionWet, this.ctx.currentTime, 0.05);
    if (this.eqLowNode) this.eqLowNode.gain.setTargetAtTime(eqLow, this.ctx.currentTime, 0.05);
    if (this.eqMidNode) this.eqMidNode.gain.setTargetAtTime(eqMid, this.ctx.currentTime, 0.05);
    if (this.eqHighNode) this.eqHighNode.gain.setTargetAtTime(eqHigh, this.ctx.currentTime, 0.05);
  }

  setMasterVolume(vol: number): void {
    if (this.masterGain && this.ctx) {
      // The ceiling is DERIVED from the fader range (MAX_FADER_GAIN is
      // dbToGain(FADER_MAX_DB)), never an independent literal: it used to be
      // `1`, which is 0 dB, so a fader that displayed +12 dB silently stopped
      // responding at unity. A derived ceiling cannot drift from the control.
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(MAX_FADER_GAIN, vol)),
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Live gain reduction of each master dynamics stage, in dB — always <= 0,
   * where 0 means the stage is passing the signal untouched.
   *
   * Read per frame by components/ui/GainReductionMeter through the shared
   * meter scheduler, and NEVER through the store: a store write per animation
   * frame would re-render every mounted view, and all four views stay mounted.
   *
   * A disengaged stage is disconnected (rewireMasterDynamics), so its
   * `reduction` sits at 0 and the readout reads as "doing nothing", which is
   * exactly true. Returns 0 before init(), when there is no node at all.
   */
  getCompressorReduction(): number {
    return this.compressor?.reduction ?? 0;
  }

  /** The limiter's live gain reduction in dB; see getCompressorReduction. */
  getLimiterReduction(): number {
    return this.limiter?.reduction ?? 0;
  }

  /**
   * Analyser for LEVEL metering — a long-window time-domain tap off masterGain, post-fader and
   * PRE-DYNAMICS: it sits ahead of both the compressor and the limiter, neither of which is even
   * in the path unless the user switches it on (DEV-385). Callers read it with `getFloatTimeDomainData` and turn samples into dBFS via
   * `src/utils/meterLevel.ts`; the engine deliberately computes no dB itself, so there is one
   * definition of the level maths and it lives where it can be unit-tested.
   *
   * A spectrum average is not a level: it moves with a patch's brightness, not its loudness, and
   * it has no dB meaning at all.
   */
  getMasterLevelAnalyser(): AnalyserNode | null {
    return this.levelAnalyser;
  }

  /**
   * Analyser tapping one source layer's PRE-FADER tap — after the VCA and
   * tremolo, before the layer's own bus gain, the parallel sends and the
   * master chain. That is deliberately a different picture from
   * `getAnalyser()`, which is an observe-only send off `masterGain` —
   * post-fader, pre-dynamics — and so shows every layer summed with the effect
   * returns: a per-layer scope is what lets the Synth view show the patch
   * being edited rather than everything at once.
   *
   * Pre-fader is the half that is easy to get wrong. The scope reads a raw
   * −1..+1 waveform with no scaling of any kind, so its full height IS full
   * scale; tapping after the bus gain made "full scale" mean "full scale after
   * a −6 dB default trim", which painted a half-height trace for a patch that
   * was in fact as loud as it can be, and shrank the wave whenever a fader
   * moved even though the patch had not changed. The fader belongs to the
   * mix, and the mix is what the master VU meter reads.
   *
   * Created on demand and kept, so repeated calls hand back the same node.
   * A larger fftSize than the master analyser's 256 buys a smoother trace,
   * which matters on a scope only a few dozen pixels tall.
   */
  getSourceAnalyser(source: string): AnalyserNode | null {
    if (!this.ctx) return null;
    let analyser = this.sourceAnalysers.get(source);
    if (!analyser) {
      analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      // Observe-only: the bus keeps its own path to the sends and the dry
      // gain, so the analyser needs no output of its own.
      this.getSourceTap(source).connect(analyser);
      this.sourceAnalysers.set(source, analyser);
    }
    return analyser;
  }

  /**
   * Analyser for one source layer's LEVEL — an observe-only send off that
   * layer's BUS, so it is POST-fader. It is the per-channel counterpart of
   * `getMasterLevelAnalyser()` and reads the same way: `getFloatTimeDomainData`
   * into `src/utils/meterLevel.ts`, with no dB computed here.
   *
   * Post-fader is the whole point, and it is the half that is easy to get
   * wrong. A mixer meter sits beside a fader and has to answer "how much of
   * this layer is in the mix?" — a pre-fader reading would not move when the
   * fader did, which next to a fader reads as a broken meter. It also gets
   * mute and solo for free: `setSourceGain` and `setSourceMuted` both write
   * this same bus gain, and engineSync routes solo through `setSourceMuted`,
   * so a silenced layer meters silent without src/components/ computing any
   * audibility of its own (which it may not do — it cannot import this file).
   *
   * Do NOT merge this with `getSourceAnalyser()`. That one is deliberately
   * PRE-fader because the Synth view's scope must show the patch being edited
   * at its own level; two questions, two tap points, two nodes.
   *
   * Configured like `levelAnalyser`: a long window for a stable RMS, and no
   * smoothing — inert on time-domain reads, and written so the two level taps
   * are visibly the same reading taken in two places.
   */
  getSourceLevelAnalyser(source: string): AnalyserNode | null {
    if (!this.ctx) return null;
    let analyser = this.sourceLevelAnalysers.get(source);
    if (!analyser) {
      analyser = this.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      // Observe-only: the bus keeps its own paths to the dry gain and the
      // sends, so the analyser needs no output of its own.
      this.getSourceBus(source).connect(analyser);
      this.sourceLevelAnalysers.set(source, analyser);
    }
    return analyser;
  }

  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(array);
    }
  }

  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(array);
    }
  }
}
