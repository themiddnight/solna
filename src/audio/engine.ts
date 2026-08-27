import { SynthParams, MasterEffects, FilterType } from '../types';
import { noteFrequency, clampBpm, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import {
  beatIndexAt,
  getMeter,
  isBeatBoundary,
  DEFAULT_METER_ID,
  type Meter,
} from '../utils/meter';
import { DEFAULT_VELOCITY, ENV_FLOOR, SILENCE, clampCutoff, clampVelocity } from './constants';
import { mergeDrumKit, type DrumKit } from './drumKits';
import { clampEffects } from './effectLimits';

type SynthVoice = {
  oscs: OscillatorNode[];
  gains: GainNode[];
  filter: BiquadFilterNode;
  filterCutoff: number;
  filterRelease: number;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  lfoTarget?: SynthParams['lfoTarget'];
  // A unity gain in SERIES between the VCA and the source bus, existing purely
  // so a 'volume' LFO can multiply the amp envelope instead of summing into it.
  // Always created: a connected node's signal is added to a param's automation,
  // so wiring the LFO straight to gains[0].gain made the release never reach
  // silence and inverted phase on the downswing. Kept out of `gains` because
  // gains[0]/gains[1] are positional (main VCA / sub level).
  tremoloGain: GainNode;
  // Pending teardown for an LFO whose depth just went to zero.
  lfoTeardownTimer?: ReturnType<typeof setTimeout>;
  // Third source alongside osc1/oscSub, created only when noiseVolume > 0.
  // Tracked separately from `oscs` because an AudioBufferSourceNode is not an
  // OscillatorNode, and separately from `gains` because gains[0]/gains[1] are
  // positional (main VCA / sub level).
  noise?: AudioBufferSourceNode;
  noiseGain?: GainNode;
  sustainLevel: number;
  // The amp envelope's peak, kept so a live Sustain change can recompute the
  // sustain level (sustainLevel alone can't be divided back out).
  peakGain: number;
  // When each envelope reaches its sustain segment. Past these points the
  // value is exactly sustainLevel / filterSustainCutoff, which is what lets
  // releaseVoice anchor a release that lands beyond all scheduled automation.
  ampEnvEndsAt: number;
  filterEnvEndsAt: number;
  filterSustainCutoff: number;
  envelopeScale: number;
  source: string;
  noteName: string;
  startTime: number;
  releaseScheduledAt?: number;
  // The release time this voice was ACTUALLY released with. A pending release
  // re-planned by updateSynthParams must reuse it, not the current patch's —
  // the bass mono-kill uses 0.05 s and the same-note dedup 0.3 s, and stretching
  // either to a pad's 2 s release lets a "stopped" note ring under the new one.
  releaseTime?: number;
  // Node teardown is a timer sized to the release tail. Re-planning a release
  // that has not started must replace that timer, not add a second one.
  teardownTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Names callers use that map onto one of the 7 authored drum types. Exported
 * so a test can prove every target is real.
 */
export const DRUM_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  closedhat: 'hihat',
  lowtom: 'tom',
  ride: 'crash',
});

class AudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  // Master bus nodes
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  // Effect nodes
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  // Last decay applied to the convolver, already quantised. Guards against
  // re-randomizing the reverb tail on every updateEffects call.
  private reverbDecay = 2.0;
  // Impulse responses keyed by quantised decay, bounded to
  // IMPULSE_CACHE_MAX entries (LRU eviction): the 0.1 s quantum over the
  // 0.1-10 s clamp range is up to 100 distinct decays, and a 10 s stereo
  // buffer at 44.1 kHz is ~3.5 MB, so an unbounded cache could pin ~350 MB
  // of AudioBuffer for the AudioContext's lifetime after a full-range sweep.
  // Building one is sampleRate * decay * 2 channels of Math.random() +
  // Math.pow() on the main thread; a single knob drag emits ~55 distinct
  // values, so this cache skips the rebuild once a value has been seen.
  // Swap and rebuild share one gate (nextDecay !== this.reverbDecay in
  // updateEffects), so a monotonic sweep still swaps convolver.buffer once
  // per 0.1 s step crossed — this cache skips the expensive rebuild, not the
  // swap itself. Cleared in setupMasterChain: an AudioBuffer belongs to its
  // context.
  private impulseCache = new Map<number, AudioBuffer>();
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayGain: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;
  private distortionGain: GainNode | null = null;
  private eqLowNode: BiquadFilterNode | null = null;
  private eqMidNode: BiquadFilterNode | null = null;
  private eqHighNode: BiquadFilterNode | null = null;
  private dryGain: GainNode | null = null;
  // Drum bus filter: all drum voices route through this single filter
  // (SequencerView "Drum Filter" card controls cutoff/resonance/type). The
  // param fields survive the AudioContext chain being (re)built, so values
  // set before init() apply to the filter node created later.
  private drumBusFilter: BiquadFilterNode | null = null;
  // A mirror of drumBusFilter used only for the drum reverb sends. The dry
  // path and the send path must be filtered identically, but drumBusFilter is
  // ONE shared node, so a per-voice send cannot be tapped downstream of it
  // without a per-voice filter copy — which would lose the live filter sweeps
  // on ringing tails that the shared node exists to provide. A second shared
  // filter fed by the per-voice send gains gets both.
  private drumSendFilter: BiquadFilterNode | null = null;
  private drumFilterCutoff = 12000;
  private drumFilterResonance = 0.7;
  private drumFilterType: FilterType = 'lowpass';

  // Active voices tracking. activeVoices keys `${source}:${noteName}` and only
  // keeps the LATEST voice per key; sourceVoices keeps every live or still-
  // scheduled voice per source so a whole layer can be silenced at once.
  private activeVoices = new Map<string, SynthVoice>();
  private sourceVoices = new Map<string, Set<SynthVoice>>();

  // Per-source buses: one gain bus per source string ('synth', 'chord', 'bass', ...).
  // Voice gains connect here instead of straight to dry/effects, so a whole layer
  // (e.g. bass) can be muted or leveled with one click-free ramp.
  private sourceBuses = new Map<string, GainNode>();
  private sourceMuted = new Map<string, boolean>();
  private sourceGains = new Map<string, number>();

  // Metronome click buffer & state
  private clickBufferHigh: AudioBuffer | null = null;
  private clickBufferLow: AudioBuffer | null = null;
  private metronomeEnabled = false;
  private noiseBuffer: AudioBuffer | null = null;
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null;

  // Shared lookahead clock (Tone.js-style): one master 16th-note grid on the
  // audio timeline that every player subscribes to, so they cannot drift apart.
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private clockBpm = 120;
  private clockStepIndex = 0; // monotonic 16th-step counter while the clock runs
  private clockNextStepTime = 0; // audio-clock seconds of the next step to schedule
  // Active time signature. The clock itself stays a monotonic 16th counter —
  // only BAR-RELATIVE logic (the metronome, the dispatched beat index) reads
  // this. Set through store/engineSync.ts, never from a component.
  private meter: Meter = getMeter(DEFAULT_METER_ID);
  private clockListeners = new Set<(step: number, beat: number, time: number) => void>();
  private static readonly CLOCK_LOOKAHEAD = 0.1; // schedule events this far ahead
  private static readonly CLOCK_REANCHOR_DELAY = 0.05; // gap used to re-anchor the schedule after resets and stalls
  private static readonly CLOCK_UPDATE_MS = 25;
  // A stall is any gap bigger than the CLOCK_UPDATE_MS cadence itself: under
  // normal ticking, clockNextStepTime never falls behind currentTime by more
  // than the lookahead window, so a lag past one interval means a tick was
  // missed (backgrounded tab, GC pause) and the schedule should re-anchor
  // rather than let the while loop below burst every step it missed.
  private static readonly CLOCK_STALL_THRESHOLD = 0.05; // seconds
  private static readonly REVERB_CURVE = 2.0; // impulse envelope exponent; not user-facing

  /**
   * LFO amount per target, in the target param's own units: Hz for cutoff,
   * cents for pitch, and a unitless 0..1 multiplier deviation for tremolo.
   * 0.2 keeps the tremolo VCA in 0.8..1.2 so it never goes negative.
   */
  private static lfoDepthFor(params: SynthParams): number {
    if (params.lfoTarget === 'cutoff') return params.lfoDepth * 1500;
    if (params.lfoTarget === 'pitch') return params.lfoDepth * 50;
    return Math.min(1, params.lfoDepth) * 0.2;
  }
  private static readonly IMPULSE_CACHE_MAX = 8; // LRU cap; real use revisits a handful of decays

  private drumKit: DrumKit = mergeDrumKit();

  async init(): Promise<void> {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.setupMasterChain();
      this.createClickBuffers();
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // browser autoplay policy requires user gesture
      }
    }
    this.isInitialized = true;
  }

  /**
   * Subscribe to the shared 16th-note clock. The listener receives the exact
   * audio-clock time each step should sound, so callers can schedule
   * sample-accurately. Once started the clock runs continuously; re-subscribing
   * never restarts the grid, so live changes stay glitch-free.
   */
  setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
    if (enabled) {
      this.ensureClockRunning();
    } else if (this.clockListeners.size === 0) {
      this.stopClockTimer();
    }
  }

  isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  subscribeClock(listener: (step: number, beat: number, time: number) => void): () => void {
    this.clockListeners.add(listener);
    this.ensureClockRunning();
    return () => {
      this.clockListeners.delete(listener);
      if (this.clockListeners.size === 0 && !this.metronomeEnabled) {
        this.stopClockTimer();
      }
    };
  }

  setClockBpm(bpm: number): void {
    this.clockBpm = clampBpm(bpm);
  }

  setMeter(meter: Meter): void {
    this.meter = meter;
  }

  getMeter(): Meter {
    return this.meter;
  }

  /**
   * Restart the shared grid at step 0. Called when the transport starts from
   * a fully stopped state, so Play All begins at beat 1 instead of resuming
   * mid-grid wherever the previous session stopped.
   */
  resetClock(): void {
    this.clockStepIndex = 0;
    this.clockNextStepTime = this.ctx ? this.ctx.currentTime + AudioEngine.CLOCK_REANCHOR_DELAY : 0;
  }

  // The shared clock keeps its grid position across stop/start and
  // re-subscription, so mid-playback view re-renders (param changes, pattern
  // swaps) don't restart the grid and glitch every listener. clockTick's
  // resync branch re-anchors the schedule after idle gaps.
  private ensureClockRunning(): void {
    if (this.clockTimer) return;
    this.clockTimer = setInterval(() => this.clockTick(), AudioEngine.CLOCK_UPDATE_MS);
  }

  private stopClockTimer(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private clockTick(): void {
    if (!this.ctx) return;
    // Resync after stalls or initial start instead of bursting missed steps
    if (this.clockNextStepTime < this.ctx.currentTime - AudioEngine.CLOCK_STALL_THRESHOLD) {
      this.clockNextStepTime = this.ctx.currentTime + AudioEngine.CLOCK_REANCHOR_DELAY;
    }
    const stepDuration = stepDurationSec(this.clockBpm);
    while (this.clockNextStepTime < this.ctx.currentTime + AudioEngine.CLOCK_LOOKAHEAD) {
      const time = this.clockNextStepTime;
      const step = this.clockStepIndex;
      // Advance BEFORE dispatching. A listener that throws must not leave the
      // grid parked on the step it threw on — the 25 ms interval would then
      // re-dispatch and re-throw the same step forever and the whole transport
      // would be frozen, not just the broken listener.
      this.clockNextStepTime += stepDuration;
      this.clockStepIndex++;

      // THE MONOTONIC-COUNTER TRAP: clockStepIndex never resets, so every
      // bar-relative decision must be derived here rather than taken from the
      // absolute step. In 4/4 (stepsPerBar 16, accentGroups [4,4,4,4]) this
      // reduces to exactly the old `step % 4 === 0` / `step % 16 === 0` /
      // `Math.floor(step / 4)` arithmetic — output is byte-identical.
      const stepsPerBar = this.meter.stepsPerBar;
      const barIndex = Math.floor(step / stepsPerBar);
      const stepInBar = step - barIndex * stepsPerBar;
      const beat = barIndex * this.meter.accentGroups.length + beatIndexAt(stepInBar, this.meter.accentGroups);

      // One listener's failure is isolated: every other subscriber still gets
      // this step. Logged rather than swallowed so the fault is findable.
      // Dispatched BEFORE the metronome click so both fire against the same
      // step/beat pair for this iteration — the two are otherwise independent
      // side effects (each schedules against the audio-clock `time`, not JS
      // call order), so this ordering has no audible effect.
      this.clockListeners.forEach((fn) => {
        try {
          fn(step, beat, time);
        } catch (err) {
          console.error('[audioEngine] clock listener threw; continuing', err);
        }
      });

      if (this.metronomeEnabled && isBeatBoundary(stepInBar, this.meter.accentGroups)) {
        this.playMetronomeClick(stepInBar === 0, time);
      }
    }
  }

  private setupMasterChain(): void {
    if (!this.ctx) return;

    // The master chain is (re)built on every AudioContext (re)creation; any
    // per-source buses from the previous context are wired into dead nodes, so
    // drop them — they are lazily recreated against the new context on demand.
    this.sourceBuses.clear();

    // An AudioBuffer belongs to the context that created it, so impulses built
    // against the previous context must not survive into the new graph.
    this.impulseCache.clear();
    this.reverbDecay = 2.0;

    // Master output & analyser. masterGain is the USER's master trim and
    // nothing else: engineSync subscribes masterVolume with fireImmediately,
    // so it is overwritten before the first frame — a "staging ceiling" seeded
    // here would be a comment describing a value that never applies. Headroom
    // is owned by the compressor (-12 dB, 4:1) and the limiter (-3 dB, 20:1).
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    // Master Compressor
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Master limiter — mostly-idle safety net (Web Audio has no dedicated
    // limiter; a max-ratio compressor with a hard-ish knee is the standard
    // stand-in). Only catches overs above −3 dB; staging above should keep
    // its gain reduction near zero.
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

    // Drum bus filter — open by default (12 kHz reads as bypass for drum content)
    this.drumBusFilter = this.ctx.createBiquadFilter();
    this.drumBusFilter.type = this.drumFilterType;
    this.drumBusFilter.frequency.value = this.drumFilterCutoff;
    this.drumBusFilter.Q.value = this.drumFilterResonance;
    this.drumBusFilter.connect(this.dryGain);

    // Same settings, wired to the reverb send only.
    this.drumSendFilter = this.ctx.createBiquadFilter();
    this.drumSendFilter.type = this.drumFilterType;
    this.drumSendFilter.frequency.value = this.drumFilterCutoff;
    this.drumSendFilter.Q.value = this.drumFilterResonance;

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
    this.drumSendFilter.connect(this.reverbNode);

    // Connect effects back to EQ chain
    this.dryGain.connect(this.eqLowNode);
    this.delayGain.connect(this.eqLowNode);
    this.reverbGain.connect(this.eqLowNode);
    this.distortionGain.connect(this.eqLowNode);

    this.eqLowNode.connect(this.eqMidNode);
    this.eqMidNode.connect(this.eqHighNode);
    this.eqHighNode.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
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
      left[i] = (Math.random() * 2 - 1) * Math.pow(n / length, curve);
      right[i] = (Math.random() * 2 - 1) * Math.pow(n / length, curve);
    }
    return impulse;
  }

  /** The knob's own resolution (EffectsRackView's Decay step is 0.1). */
  /**
   * The knob's own resolution (EffectsRackView's Decay step is 0.1).
   *
   * Only caller is updateEffects, which already ran `fx` through
   * clampEffects — so `decay` here is always finite and within
   * EFFECT_LIMITS.reverbDecay. Re-clamping here would be a second source of
   * truth for the same bound; this only quantises.
   */
  private quantiseDecay(decay: number): number {
    return Math.round(decay * 10) / 10;
  }

  /** Cached impulse for a quantised decay, built on first use. */
  /**
   * Cached impulse for a quantised decay, built on first use. Bounded to
   * IMPULSE_CACHE_MAX entries with LRU eviction — see the field comment on
   * `impulseCache` for why an unbounded cache is not acceptable here.
   */
  private getImpulseResponse(quantisedDecay: number): AudioBuffer {
    const cached = this.impulseCache.get(quantisedDecay);
    if (cached) {
      // Re-inserting moves the key to the end of the Map's iteration order,
      // which this cache uses as its LRU recency order.
      this.impulseCache.delete(quantisedDecay);
      this.impulseCache.set(quantisedDecay, cached);
      return cached;
    }
    const built = this.buildImpulseResponse(quantisedDecay, AudioEngine.REVERB_CURVE);
    this.impulseCache.set(quantisedDecay, built);
    if (this.impulseCache.size > AudioEngine.IMPULSE_CACHE_MAX) {
      const oldestKey = this.impulseCache.keys().next().value;
      if (oldestKey !== undefined) this.impulseCache.delete(oldestKey);
    }
    return built;
  }

  private createClickBuffers(): void {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    
    // High click (downbeat)
    const lenHigh = Math.floor(sr * 0.03);
    const bufHigh = this.ctx.createBuffer(1, lenHigh, sr);
    const dataHigh = bufHigh.getChannelData(0);
    for (let i = 0; i < lenHigh; i++) {
      dataHigh[i] = Math.sin((2 * Math.PI * 1800 * i) / sr) * Math.exp(-i / (sr * 0.005));
    }
    this.clickBufferHigh = bufHigh;

    // Low click
    const lenLow = Math.floor(sr * 0.03);
    const bufLow = this.ctx.createBuffer(1, lenLow, sr);
    const dataLow = bufLow.getChannelData(0);
    for (let i = 0; i < lenLow; i++) {
      dataLow[i] = Math.sin((2 * Math.PI * 1000 * i) / sr) * Math.exp(-i / (sr * 0.005));
    }
    this.clickBufferLow = bufLow;
  }

  playMetronomeClick(isDownbeat = false, time?: number): void {
    if (!this.ctx || !this.dryGain) return;
    const buffer = isDownbeat ? this.clickBufferHigh : this.clickBufferLow;
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = isDownbeat ? 0.6 : 0.35;

    source.connect(gain);
    gain.connect(this.dryGain);
    const now = time ?? this.ctx.currentTime;
    source.start(now);
  }

  // Synthesizer Note On
  triggerSynthNoteOn(noteName: string, params: SynthParams, velocity = DEFAULT_VELOCITY, time?: number, source = 'synth', scaleFactor = 1): void {
    if (!this.ctx || !this.dryGain) return;
    const freq = noteFrequency(noteName, params.octave);
    const now = time ?? this.ctx.currentTime;

    // Bass is monophonic like a real bass: kill any other sounding bass voice
    // BEFORE creating the new one. Keys are snapshotted because
    // triggerSynthNoteOff deletes map entries while we iterate.
    // Pass `time` so a live previous voice's release ramp starts exactly when the
    // new note starts (not immediately); the release timeout already accounts for
    // the future `time` in its delay math.
    if (source === 'bass') {
      for (const key of Array.from(this.activeVoices.keys())) {
        if (key.startsWith('bass:')) this.triggerSynthNoteOff(key.slice(5), 0.05, time, 'bass', true);
      }
    }

    // Stop an existing live voice of the same note. Skipped when the existing
    // voice already has its release planned (pre-scheduled pattern hits or the
    // bass mono kill above): re-releasing at scheduling time would truncate
    // its envelope.
    const existing = this.activeVoices.get(`${source}:${noteName}`);
    if (!existing?.releaseScheduledAt) {
      this.triggerSynthNoteOff(noteName, 0.3, time, source, true);
    }

    // Primary Oscillator
    const osc1 = this.ctx.createOscillator();
    osc1.type = params.oscType;
    osc1.frequency.setValueAtTime(freq, now);
    osc1.detune.setValueAtTime(params.detune, now);

    // Sub Oscillator
    const oscSub = this.ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(freq / 2, now);

    // Filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = params.filterType;
    filter.frequency.setValueAtTime(params.filterCutoff, now);
    filter.Q.setValueAtTime(params.filterResonance, now);

    // Filter Envelope (VCF ADSR). The ramps use a floored attack, so the
    // "envelope has reached sustain" marker below must use the SAME floored
    // value — synthPresets ships attack: 0.002, under both floors, and a marker
    // computed from the raw value lands before the ramp ends, sending a release
    // inside that window down releaseVoice's past-the-envelope branch.
    const attack = Math.max(0.005, params.attack);
    const filterAttack = Math.max(0.01, params.filterAttack);
    const { peak: filterPeak, sustain: filterSustainLevel } = this.filterEnvLevels(params);
    filter.frequency.exponentialRampToValueAtTime(filterPeak, now + filterAttack);
    filter.frequency.exponentialRampToValueAtTime(filterSustainLevel, now + filterAttack + params.filterDecay);

    // Amplitude Envelope
    const gainNode = this.ctx.createGain();
    const subGain = this.ctx.createGain();
    subGain.gain.value = params.subOscVolume;

    const peakGain = velocity * 0.4 * scaleFactor;
    gainNode.gain.setValueAtTime(ENV_FLOOR, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), now + attack);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(ENV_FLOOR, peakGain * params.sustain), now + attack + params.decay);

    // Tremolo VCA: envelope -> tremoloGain -> bus. The LFO drives THIS node's
    // gain, so amp envelope and tremolo multiply. Unity when unused.
    const tremoloGain = this.ctx.createGain();
    tremoloGain.gain.value = 1;

    // LFO
    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;
    if (params.lfoDepth > 0) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      lfoGain = this.ctx.createGain();
      lfoGain.gain.value = AudioEngine.lfoDepthFor(params);
      lfo.connect(lfoGain);

      if (params.lfoTarget === 'cutoff') {
        lfoGain.connect(filter.frequency);
      } else if (params.lfoTarget === 'pitch') {
        lfoGain.connect(osc1.detune);
      } else {
        lfoGain.connect(tremoloGain.gain);
      }
      lfo.start(now);
    }

    // Noise source — a third source alongside osc1/oscSub, feeding the same VCF
    // and VCA so the filter and amp envelopes shape it like any other source.
    // Created only when the preset asks for it (same lazy pattern as the LFO;
    // updateSynthParams adds one to a live voice if the knob comes up), and
    // created after the amp envelope so gains[0]/gains[1] stay main/sub.
    const noiseNodes = this.createNoiseNodes(params.noiseVolume, filter, now);

    // Connect nodes
    osc1.connect(filter);
    oscSub.connect(subGain);
    subGain.connect(filter);

    filter.connect(gainNode);
    gainNode.connect(tremoloGain);

    // Route through the per-source bus (lazily created) to dry/effects
    tremoloGain.connect(this.getSourceBus(source));

    osc1.start(now);
    oscSub.start(now);

    const voice: SynthVoice = {
      ...noiseNodes,
      oscs: [osc1, oscSub],
      gains: [gainNode, subGain],
      filter,
      filterCutoff: params.filterCutoff,
      filterRelease: params.filterRelease,
      lfo,
      lfoGain,
      lfoTarget: params.lfoTarget,
      tremoloGain,
      sustainLevel: peakGain * params.sustain,
      peakGain,
      ampEnvEndsAt: now + attack + params.decay,
      filterEnvEndsAt: now + filterAttack + params.filterDecay,
      filterSustainCutoff: filterSustainLevel,
      envelopeScale: scaleFactor,
      source,
      noteName,
      startTime: now,
      releaseScheduledAt: undefined,
    };
    this.activeVoices.set(`${source}:${noteName}`, voice);
    let voicesOfSource = this.sourceVoices.get(source);
    if (!voicesOfSource) {
      voicesOfSource = new Set();
      this.sourceVoices.set(source, voicesOfSource);
    }
    voicesOfSource.add(voice);
  }

  // Synthesizer Note Off
  triggerSynthNoteOff(noteName: string, releaseTime = 0.3, time?: number, source = 'synth', pinRelease = false): void {
    if (!this.ctx) return;
    const voice = this.activeVoices.get(`${source}:${noteName}`);
    if (!voice) return;

    const now = time ?? this.ctx.currentTime;
    // All voices stay tracked until teardown so live param updates can reach
    // sounding (or still-scheduled) voices; the same-note dedup in
    // triggerSynthNoteOn skips voices whose release is already planned here.
    voice.releaseScheduledAt = now;
    // `pinRelease` marks a release the ENGINE chose (bass mono-kill 0.05 s,
    // same-note dedup 0.3 s). Those must survive a live Release-knob change;
    // a normal note-off leaves releaseTime unset so the knob still reaches it.
    voice.releaseTime = pinRelease ? releaseTime : undefined;
    this.releaseVoice(voice, releaseTime, now);
  }

  // Shared node-teardown sequence for a voice that is being fully torn down —
  // used both by releaseVoice's delayed timeout (nodes stopped with no time
  // argument, since the release tail has already finished by the time it
  // fires) and by the hard-silence paths (stopSource/releaseSoundingVoices on
  // a future voice, and a live stopSource) which stop everything AT `when`.
  // Each node is wrapped in its own try/catch so one already-stopped node
  // can't prevent the rest of the voice from being torn down.
  private teardownVoiceNodes(voice: SynthVoice, when?: number): void {
    if (voice.lfoTeardownTimer !== undefined) clearTimeout(voice.lfoTeardownTimer);
    voice.oscs.forEach((osc) => {
      try {
        if (when !== undefined) osc.stop(when); else osc.stop();
        osc.disconnect();
      } catch { /* ignore */ }
    });
    voice.gains.forEach((g) => {
      try { g.disconnect(); } catch { /* ignore */ }
    });
    try { voice.filter.disconnect(); } catch { /* ignore */ }
    try { voice.tremoloGain.disconnect(); } catch { /* ignore */ }
    if (voice.lfo) {
      try {
        if (when !== undefined) voice.lfo.stop(when); else voice.lfo.stop();
        voice.lfo.disconnect();
      } catch { /* ignore */ }
    }
    if (voice.lfoGain) {
      try { voice.lfoGain.disconnect(); } catch { /* ignore */ }
    }
    if (voice.noise) {
      try {
        if (when !== undefined) voice.noise.stop(when); else voice.noise.stop();
        voice.noise.disconnect();
      } catch { /* ignore */ }
    }
    if (voice.noiseGain) {
      try { voice.noiseGain.disconnect(); } catch { /* ignore */ }
    }
  }

  // Silences one voice: cancels its envelopes, ramps amp/filter down, and
  // tears the nodes down after the release tail.
  private releaseVoice(voice: SynthVoice, releaseTime: number, now: number): void {
    if (!this.ctx) return;
    const mainGain = voice.gains[0];
    // Computed up front (outside the try below) because a throw partway
    // through AudioParam scheduling must never leave the voice without a
    // teardown timer — these values are pure arithmetic and cannot throw,
    // so the `finally` block can always use them to schedule teardown.
    const filterRelease = Math.max(0.01, voice.filterRelease);
    const voiceKey = `${voice.source}:${voice.noteName}`;
    const teardownDelayMs =
      (Math.max(releaseTime, filterRelease) + Math.max(0, now - this.ctx.currentTime) + 0.1) * 1000;

    try {
      // The release has to begin at the value the envelope ACTUALLY has at
      // `now`. cancelAndHoldAtTime truncates the running attack/decay ramp
      // there and keeps its interpolated value, so the fade continues from
      // where the note was. Naming a start value instead makes the param jump
      // in a single sample — and every pattern hit is released while still
      // decaying (a 16th at 120 bpm lasts 0.125 s against a 0.4 s decay), so
      // that jump was ~4 dB on the amp and 1.5x on the cutoff: an audible
      // click on every note. The fallback values below keep the old
      // approximation for engines without cancelAndHoldAtTime.
      // Fallbacks reproduce the pre-cancelAndHold approximation exactly: a
      // release scheduled ahead can't read `.value` (it reports the value at
      // currentTime, still the envelope floor), so it estimates the sustain
      // level; an immediate release reads the live value.
      const ampFallback = now > this.ctx.currentTime + 0.01
        ? Math.max(ENV_FLOOR, voice.sustainLevel)
        : Math.max(ENV_FLOOR, mainGain.gain.value);
      this.cancelAndHold(mainGain.gain, now, ampFallback);
      // cancelAndHoldAtTime inserts NO hold point when nothing is scheduled at
      // or after `now` — verified against an OfflineAudioContext render. The
      // ramp below would then start from the end of the DECAY instead of from
      // `now`, fading a held chord out across its whole length. Past the decay
      // the value is exactly the sustain level, so anchor it there; inside the
      // envelope cancelAndHold already left an exact hold point.
      if (now >= voice.ampEnvEndsAt) {
        mainGain.gain.setValueAtTime(Math.max(ENV_FLOOR, voice.sustainLevel), now);
      }
      mainGain.gain.exponentialRampToValueAtTime(SILENCE, now + Math.max(0.01, releaseTime));

      // VCF envelope release: ramp filter back to base cutoff
      this.cancelAndHold(voice.filter.frequency, now, clampCutoff(voice.filter.frequency.value));
      if (now >= voice.filterEnvEndsAt) {
        voice.filter.frequency.setValueAtTime(clampCutoff(voice.filterSustainCutoff), now);
      }
      voice.filter.frequency.exponentialRampToValueAtTime(clampCutoff(voice.filterCutoff), now + filterRelease);
    } catch {
      // ignore — scheduling failed partway through, but the voice still gets
      // torn down below via the `finally` so it can never hang forever.
    } finally {
      // The old timer is cleared and the replacement is scheduled together,
      // right here, so a throw above can never leave the voice with no
      // teardown timer at all (it would otherwise stay in `activeVoices`/
      // `sourceVoices` forever and the same-note dedup at the top of
      // `triggerSynthNoteOn` would refuse to release it again).
      if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
      voice.teardownTimer = setTimeout(() => {
        // Only delete the map entry if this voice is still the current one —
        // a same-note retrigger overwrites the entry before this timeout
        // fires. The voice's own nodes are always torn down regardless.
        if (this.activeVoices.get(voiceKey) === voice) {
          this.activeVoices.delete(voiceKey);
        }
        this.sourceVoices.get(voice.source)?.delete(voice);
        this.teardownVoiceNodes(voice);
      }, teardownDelayMs);
    }
  }

  /**
   * Hard-silences a voice whose oscillators have not started yet.
   *
   * A release RAMP is wrong here: the ramp runs from `now` and finishes before
   * `voice.startTime`, at which point the oscillators start anyway and the amp
   * gain holds whatever value the ramp left. Worse, cancelling the note-on
   * floor event can leave the GainNode at its intrinsic 1.0, so the "released"
   * voice sounds at roughly 3x peakGain — an audible pop on every pattern stop.
   */
  private silenceVoiceNow(voice: SynthVoice, now: number): void {
    if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
    const voiceKey = `${voice.source}:${voice.noteName}`;
    try {
      voice.gains[0].gain.cancelScheduledValues(now);
      voice.gains[0].gain.setValueAtTime(0, now);
    } catch { /* ignore */ }
    if (this.activeVoices.get(voiceKey) === voice) this.activeVoices.delete(voiceKey);
    this.sourceVoices.get(voice.source)?.delete(voice);
    this.teardownVoiceNodes(voice, now);
  }

  // Immediately silences every voice of a source — sounding ones and hits
  // still scheduled in the future. Releasing a held preview stops the whole
  // pattern, not just the last scheduled hit.
  //
  // `time` anchors the release in the AudioContext's timeline so a soft stop
  // can be scheduled exactly on a bar line instead of relying on a timer.
  // releaseVoice already handles a `now` in the future.
  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    if (!this.ctx) return;
    const now = time ?? this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (voice.startTime > now) {
        this.silenceVoiceNow(voice, now);
        continue;
      }
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
  }

  /**
   * Re-balances every still-sounding voice for equal-power polyphony (held
   * notes get quieter as more join). Voices with a planned release — pattern
   * hits — keep their envelopes; envelopeScale makes repeated calls relative.
   */
  applySynthVelocityScale(scale: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.reshapeableVoices()) {
      if (voice.releaseScheduledAt !== undefined) continue;
      const factor = scale / voice.envelopeScale;
      if (Math.abs(factor - 1) < 0.001) continue;

      voice.envelopeScale = scale;
      voice.sustainLevel *= factor;
      // peakGain must track the rebalance too: updateSynthParams recomputes
      // the sustain level from it, and an unscaled peak would undo this.
      voice.peakGain *= factor;
      const gain = voice.gains[0].gain;
      // cancelAndHold, not cancelScheduledValues: a voice mid-attack has only
      // the note-on floor as a surviving event, so cancelling would drop the
      // rebalance to 0.0001 and glide back up — a click on every added note.
      this.cancelAndHold(gain, now);
      gain.setTargetAtTime(Math.max(ENV_FLOOR, voice.sustainLevel), now, 0.01);
    }
  }

  /**
   * Releases only the voices of a source that have actually started. Unlike
   * stopSource this leaves future-scheduled hits alone, so releasing a held
   * key in arp mode no longer cancels the envelopes of notes the clock has
   * already scheduled (which cancelled their attack and made them inaudible).
   * A future voice without a release of its own is still released, otherwise
   * it would drone forever.
   */
  releaseSoundingVoices(source: string, releaseTime = 0.1): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (voice.startTime > now) {
        // A future hit that already owns a release keeps it: this is the arp
        // key-release path, which must not cancel notes the clock has planned.
        if (voice.releaseScheduledAt !== undefined) continue;
        // A future hit with no release of its own would drone forever, and a
        // ramp cannot silence a voice that starts after the ramp ends.
        this.silenceVoiceNow(voice, now);
        continue;
      }
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
  }

  // Lazily create (and cache) the gain bus for a source, wired like the old
  // per-voice routing: dry + conditionally delay/reverb/distortion.
  private getSourceBus(source: string): GainNode {
    if (!this.ctx) throw new Error('AudioContext not initialized');
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

  // Mute/unmute an entire source layer on its bus: ~10 ms ramp (click-free),
  // instantly cuts tails/effects, and survives across effect/param updates.
  setSourceMuted(source: string, muted: boolean): void {
    this.sourceMuted.set(source, muted);
    if (!this.ctx) return;
    const bus = this.sourceBuses.get(source) ?? this.getSourceBus(source);
    const now = this.ctx.currentTime;
    const targetGain = muted ? 0 : (this.sourceGains.get(source) ?? 1);
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(targetGain, now, 0.01);
  }

  // Set gain/volume for an entire source layer (e.g. chord, bass, synth)
  setSourceGain(source: string, volume: number): void {
    this.sourceGains.set(source, volume);
    if (!this.ctx) return;
    const bus = this.sourceBuses.get(source) ?? this.getSourceBus(source);
    const now = this.ctx.currentTime;
    const isMuted = this.sourceMuted.get(source);
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(isMuted ? 0 : Math.max(0, Math.min(1.5, volume)), now, 0.01);
  }

  /**
   * Truncate `param`'s automation at `now`, keeping the value the curve has
   * there so the next ramp starts without a step.
   *
   * `fallbackValue` is for engines with no cancelAndHoldAtTime: `param.value`
   * reads the value at *currentTime*, which is simply wrong when `now` is in
   * the future, so a caller scheduling ahead passes its best estimate.
   */
  private cancelAndHold(param: AudioParam, now: number, fallbackValue?: number): void {
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
   * The VCF envelope's two levels. Written once here because note-on
   * (triggerSynthNoteOn) and the live knob path (updateSynthParams) must agree
   * on the sustain cutoff — a release anchors to it, so a drifted copy makes
   * the filter jump at note-off.
   */
  private filterEnvLevels(params: SynthParams): { peak: number; sustain: number } {
    return {
      peak: clampCutoff(params.filterCutoff + params.filterEnvAmount),
      sustain: clampCutoff(params.filterCutoff + params.filterEnvAmount * params.filterSustain),
    };
  }

  /**
   * Every tracked voice of `source` (or all sources) that can be re-shaped
   * right now: it has started, and it is not already fading.
   *
   * Iterates sourceVoices, not activeVoices: activeVoices only keeps the
   * LATEST voice per note, so a still-sounding voice that a same-note retrigger
   * evicted would be skipped and left at the old level.
   */
  private reshapeableVoices(source?: string): SynthVoice[] {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    const sets = source
      ? [this.sourceVoices.get(source) ?? new Set<SynthVoice>()]
      : Array.from(this.sourceVoices.values());
    const out: SynthVoice[] = [];
    for (const set of sets) {
      for (const voice of set) {
        // Voices scheduled ahead keep the envelopes they were planned with;
        // re-targeting them cancels their scheduled ramps, release included.
        if (voice.startTime > now) continue;
        // A voice already in its release tail keeps the ramp it was given.
        if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt <= now) continue;
        out.push(voice);
      }
    }
    return out;
  }

  // Points a voice's (already-created) LFO gain at the given target and
  // scale, disconnecting it from wherever it was previously wired. The scale
  // is set with setValueAtTime, landing INSTANTLY rather than gliding: at the
  // moment of the switch `lfoGain.gain` still holds the OLD target's
  // magnitude (e.g. 750 for cutoff, 25 for pitch), and a setTargetAtTime
  // glide into the new scale would modulate the NEW target at that stale
  // magnitude for ~5 time constants — a gain blast (and the very phase
  // inversion this task removes) on a switch into 'volume', and an audible
  // blip on a switch into 'cutoff'/'pitch'.
  private connectLfoTo(voice: SynthVoice, target: SynthParams['lfoTarget'], scale: number, now: number): void {
    if (!voice.lfoGain) return;
    try { voice.lfoGain.disconnect(); } catch { /* ignore */ }
    try {
      voice.lfoGain.gain.cancelScheduledValues(now);
      voice.lfoGain.gain.setValueAtTime(scale, now);
    } catch { /* ignore */ }
    if (target === 'cutoff') {
      voice.lfoGain.connect(voice.filter.frequency);
    } else if (target === 'pitch') {
      voice.lfoGain.connect(voice.oscs[0].detune);
    } else {
      voice.lfoGain.connect(voice.tremoloGain.gain);
    }
    voice.lfoTarget = target;
  }

  /**
   * Removes an LFO whose depth has gone to zero, once the fade is inaudible.
   * setTargetAtTime is asymptotic — it never reaches exactly 0 — so without
   * this a "switched off" LFO keeps a running oscillator and a residual
   * modulation for the rest of the voice's life.
   */
  private teardownVoiceLfo(voice: SynthVoice, now: number, tc: number): void {
    if (!voice.lfoGain || voice.lfoTeardownTimer !== undefined) return;
    this.cancelAndHold(voice.lfoGain.gain, now);
    voice.lfoGain.gain.setTargetAtTime(0, now, tc);
    voice.lfoTeardownTimer = setTimeout(() => {
      voice.lfoTeardownTimer = undefined;
      if (voice.lfo) { try { voice.lfo.stop(); voice.lfo.disconnect(); } catch { /* ignore */ } }
      if (voice.lfoGain) { try { voice.lfoGain.disconnect(); } catch { /* ignore */ } }
      voice.lfo = undefined;
      voice.lfoGain = undefined;
      voice.lfoTarget = undefined;
    }, tc * 5 * 1000); // 5 time constants ~= -43 dB
  }

  // Re-points a live voice's LFO at the current params, creating the LFO nodes
  // on the spot if the depth knob has just come up off zero.
  private updateVoiceLfo(voice: SynthVoice, params: SynthParams, now: number, tc: number): void {
    if (!this.ctx) return;
    if (params.lfoDepth <= 0) {
      this.teardownVoiceLfo(voice, now, tc);
      return;
    }

    // The knob came back up before the teardown landed: keep the same nodes.
    if (voice.lfoTeardownTimer !== undefined) {
      clearTimeout(voice.lfoTeardownTimer);
      voice.lfoTeardownTimer = undefined;
    }

    if (!voice.lfo || !voice.lfoGain) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfo.start(now);
      voice.lfo = lfo;
      voice.lfoGain = lfoGain;
      voice.lfoTarget = undefined; // force the connect below
    }

    const depth = AudioEngine.lfoDepthFor(params);
    if (voice.lfoTarget !== params.lfoTarget) {
      // Target switch: land at the new scale instantly (see connectLfoTo).
      this.connectLfoTo(voice, params.lfoTarget, depth, now);
    } else {
      // Same target, only the depth knob moved: a glide is musically right
      // here, and an instant jump would click.
      voice.lfoGain.gain.setTargetAtTime(depth, now, tc);
    }

    voice.lfo.frequency.setTargetAtTime(params.lfoRate, now, tc);
  }

  // Live-update every sounding voice so knob tweaks are audible immediately
  // instead of only on the next note. ADSR timing values still apply to the
  // next note (standard synth behavior); release cutoff stays in sync.
  updateSynthParams(params: SynthParams, source?: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = 0.03; // smoothing time constant in seconds

    const sustainCutoff = this.filterEnvLevels(params).sustain;

    for (const voice of this.reshapeableVoices(source)) {
      const osc = voice.oscs[0];

      osc.type = params.oscType;
      this.cancelAndHold(osc.detune, now);
      osc.detune.setTargetAtTime(params.detune, now, tc);

      voice.filter.type = params.filterType;
      this.cancelAndHold(voice.filter.frequency, now);
      voice.filter.frequency.setTargetAtTime(sustainCutoff, now, tc);
      this.cancelAndHold(voice.filter.Q, now);
      voice.filter.Q.setTargetAtTime(params.filterResonance, now, tc);

      const subGain = voice.gains[1];
      this.cancelAndHold(subGain.gain, now);
      subGain.gain.setTargetAtTime(params.subOscVolume, now, tc);

      this.updateVoiceNoise(voice, params.noiseVolume, now, tc);

      // Keep the note-off filter release ramp in sync with the new cutoff
      voice.filterCutoff = params.filterCutoff;
      voice.filterRelease = params.filterRelease;
      // The setTargetAtTime above drives the cutoff to sustainCutoff from here
      // on, so that is what a later release must anchor to.
      voice.filterSustainCutoff = sustainCutoff;
      voice.filterEnvEndsAt = Math.min(voice.filterEnvEndsAt, now);

      this.updateVoiceLfo(voice, params, now, tc);

      // Amp Sustain is a LEVEL, not a time: on a held pad the next note is
      // bars away, so applying it only at note-on makes the knob read as
      // dead. Retarget only when it actually moved — gliding the amp on every
      // cutoff tweak would cut short the attack of a percussive stab.
      const nextSustain = voice.peakGain * params.sustain;
      if (Math.abs(nextSustain - voice.sustainLevel) > 1e-6) {
        voice.sustainLevel = nextSustain;
        this.cancelAndHold(voice.gains[0].gain, now);
        voice.gains[0].gain.setTargetAtTime(Math.max(ENV_FLOOR, nextSustain), now, tc);
      }

      // A voice sounding now whose note-off sits ahead on the clock (a
      // sustained chord, a whole-note bass) has its release ramp already
      // planned with the OLD release time and cutoff — and the cancelAndHold
      // above just wiped the filter half of it. Re-plan it: nothing has faded
      // yet, so re-arming is silent, and the Release knob reaches the note
      // that is ringing instead of only the next one. Re-plan with the
      // release the voice was ACTUALLY released with when the engine chose it
      // (bass mono-kill, same-note dedup), so a pad's long release can't
      // stretch a kill and break monophony; fall back to the patch's release
      // for a normal note-off, which must still track a live Release-knob
      // change.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt > now) {
        this.releaseVoice(voice, voice.releaseTime ?? params.release, voice.releaseScheduledAt);
      }
    }
  }

  setDrumKit(kit?: Partial<DrumKit>): void {
    this.drumKit = mergeDrumKit(kit);
  }

  /** Live drum-bus filter control (SequencerView "Drum Filter" card). */
  setDrumFilter(cutoff: number, resonance: number, type: FilterType): void {
    this.drumFilterCutoff = cutoff;
    this.drumFilterResonance = resonance;
    this.drumFilterType = type;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const node of [this.drumBusFilter, this.drumSendFilter]) {
      if (!node) continue;
      node.frequency.setTargetAtTime(cutoff, now, 0.03);
      node.Q.setTargetAtTime(resonance, now, 0.03);
      node.type = type;
    }
  }

  /**
   * One drum envelope: peak at `t`, an optional shape hook for extra levels
   * (the clap's micro-bursts) scheduled BEFORE the closing ramp so callers
   * that read back the automation in call order see it in chronological
   * order too, then exponential decay to the shared floor by `t + decay`.
   */
  private drumEnv(peak: number, decay: number, t: number, shape?: (gain: AudioParam) => void): GainNode {
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(Math.max(ENV_FLOOR, peak), t);
    shape?.(gain.gain);
    gain.gain.exponentialRampToValueAtTime(ENV_FLOOR, t + Math.max(0.01, decay));
    return gain;
  }

  /**
   * Dry through drumBusFilter, wet through a per-voice send gain into
   * drumSendFilter. `reverbSend` is the kit's authored LEVEL (0.15..0.5 across
   * kits); it used to be tested as a boolean and the send ran at full voice
   * level, so the whole spread was inaudible.
   */
  private wireDrumVoice(env: GainNode, reverbSend = 0): void {
    env.connect(this.drumBusFilter!);
    if (reverbSend <= 0 || !this.drumSendFilter) return;
    const send = this.ctx!.createGain();
    send.gain.value = reverbSend;
    env.connect(send);
    send.connect(this.drumSendFilter);
  }

  /** A pitched drum component (kick body, kick click, snare body, tom). */
  private drumTone(o: {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    pitchTime?: number;
    peak: number;
    decay: number;
    t: number;
    stopAt?: number;
  }): void {
    const osc = this.ctx!.createOscillator();
    if (o.type) osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(o.freqEnd, o.t + (o.pitchTime ?? 0.05));
    }
    const env = this.drumEnv(o.peak, o.decay, o.t);
    osc.connect(env);
    this.wireDrumVoice(env);
    osc.start(o.t);
    osc.stop(o.stopAt ?? o.t + o.decay + 0.02);
  }

  /** A filtered noise drum component (hats, snare snap, clap, crash). */
  private drumNoiseBurst(o: {
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    peak: number;
    decay: number;
    t: number;
    stopPad?: number;
    reverbSend?: number;
    shape?: (gain: AudioParam) => void;
  }): void {
    const noise = this.createNoiseNode();
    const filter = this.ctx!.createBiquadFilter();
    filter.type = o.filterType;
    filter.frequency.value = o.freq;
    if (o.q !== undefined) filter.Q.value = o.q;

    // Extra levels between the peak and the floor (the clap's micro-bursts)
    // are scheduled by drumEnv itself, before the closing ramp.
    const env = this.drumEnv(o.peak, o.decay, o.t, o.shape);

    noise.connect(filter);
    filter.connect(env);
    this.wireDrumVoice(env, o.reverbSend);
    noise.start(o.t, this.noiseStartOffset());
    noise.stop(o.t + o.decay + (o.stopPad ?? 0.01));
  }

  /**
   * A random read position in the one shared noise buffer. Without it every
   * hat, snare and clap plays byte-identical noise, so hits landing on the same
   * step are perfectly correlated and sum at +6 dB instead of +3.
   */
  private noiseStartOffset(): number {
    return Math.random() * (this.noiseBuffer?.duration ?? 0);
  }

  // Drum Synthesizer Trigger
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    if (!this.ctx || !this.dryGain || !this.drumBusFilter) return;
    const now = time ?? this.ctx.currentTime;
    const v = clampVelocity(velocity);
    const k = this.drumKit;
    const name = type.toLowerCase();

    switch (DRUM_ALIASES[name] ?? name) {
      case 'kick': {
        const d = k.kick;
        this.drumTone({
          freq: d.freqStart, freqEnd: d.freqEnd, pitchTime: d.pitchTime,
          peak: v * d.gain, decay: d.decay, t: now,
        });
        if (d.clickFreq && d.clickLevel) {
          this.drumTone({
            freq: d.clickFreq, peak: v * d.clickLevel, decay: d.clickDecay ?? 0.01,
            t: now, stopAt: now + d.decay + 0.02,
          });
        }
        break;
      }
      case 'snare': {
        const s = k.snare;
        this.drumTone({
          type: 'triangle', freq: s.bodyFreqStart, freqEnd: s.bodyFreqEnd,
          pitchTime: s.bodyTime, peak: v * s.bodyGain, decay: s.bodyDecay,
          t: now, stopAt: now + s.bodyDecay + 0.05,
        });
        this.drumNoiseBurst({
          filterType: 'highpass', freq: s.noiseFilter, peak: v * s.noiseGain,
          decay: s.noiseDecay, t: now, stopPad: 0.03, reverbSend: s.reverbSend,
        });
        break;
      }
      case 'hihat': {
        const h = k.hihat;
        this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, peak: v * h.gain, decay: h.decay, t: now,
        });
        break;
      }
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely. The old
        // unconditional gain.connect(delayNode) here was a stray with no kit
        // parameter behind it.
        const h = k.openhat;
        this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, peak: v * h.gain, decay: h.decay, t: now,
        });
        break;
      }
      case 'clap': {
        const c = k.clap;
        const peak = v * c.gain;
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: c.filter, q: 1.5, peak, decay: c.decay,
          t: now, stopPad: 0.02, reverbSend: c.reverbSend,
          // 3 quick micro-bursts for realistic clap texture. Both scale with
          // velocity: the second used to be a hardcoded 0.1, which at low
          // velocity made the ghost louder than the hit.
          shape: (gain) => {
            gain.setValueAtTime(peak * 0.25, now + 0.012);
            gain.setValueAtTime(peak * 1.1, now + 0.024);
          },
        });
        break;
      }
      case 'tom': {
        const t = k.tom;
        this.drumTone({
          freq: t.freqStart, freqEnd: t.freqEnd, pitchTime: t.pitchTime,
          peak: v * t.gain, decay: t.decay, t: now,
        });
        break;
      }
      case 'crash': {
        const cr = k.crash;
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: cr.filter, q: 0.8, peak: v * cr.gain,
          decay: cr.decay, t: now, stopPad: 0.1, reverbSend: cr.reverbSend,
        });
        break;
      }
      default:
        break;
    }
  }

  // Builds, wires and starts the noise source used by both the note-on path and
  // the live knob path, returning the fields to merge into the voice — or an
  // empty object when the preset asks for no noise, so callers branch on nothing.
  // `target` is the voice's filter: noise is a source alongside osc1/oscSub, so
  // the VCF and its envelope shape it like any other source.
  // `loop` matters: createNoiseNode's buffer is 2 s and a pad's release runs
  // longer, so an unlooped source would fall silent mid-note.
  private createNoiseNodes(
    level: number,
    target: AudioNode,
    startAt: number,
    initialLevel: number = level,
  ): Pick<SynthVoice, 'noise' | 'noiseGain'> {
    if (!this.ctx || level <= 0) return {};
    // createNoiseNode always returns a looped source now.
    const noise = this.createNoiseNode();
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = initialLevel;
    noise.connect(noiseGain);
    noiseGain.connect(target);
    noise.start(startAt);
    return { noise, noiseGain };
  }

  // Tracks the noise knob on a voice that is already sounding, adding the
  // source to a voice that started silent — the same lazy shape the LFO uses,
  // so turning the knob up is audible on the current note, not only the next.
  private updateVoiceNoise(voice: SynthVoice, level: number, now: number, tc: number): void {
    if (level <= 0) {
      if (!voice.noiseGain) return;
      this.cancelAndHold(voice.noiseGain.gain, now);
      voice.noiseGain.gain.setTargetAtTime(0, now, tc);
      return;
    }
    if (!voice.noiseGain) {
      // Ramp up from silence so adding the source mid-note doesn't click. The
      // level is ENV_FLOOR rather than Number.MIN_VALUE: the old denormal was
      // there only to slip past the `level <= 0` guard, which is now expressed
      // by passing the real level and a separate starting level.
      Object.assign(voice, this.createNoiseNodes(level, voice.filter, now, ENV_FLOOR));
      if (!voice.noiseGain) return;
    }
    this.cancelAndHold(voice.noiseGain.gain, now);
    voice.noiseGain.gain.setTargetAtTime(level, now, tc);
  }

  private createNoiseNode(): AudioBufferSourceNode {
    if (!this.ctx) return {} as AudioBufferSourceNode;
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== this.ctx.sampleRate) {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
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

  updateEffects(raw: MasterEffects): void {
    if (!this.ctx) return;
    // Clamp before anything touches an AudioParam. A persisted or imported
    // project is untrusted input: delayFeedback >= 1 is a runaway loop and a
    // non-finite value writes NaN into the graph, which silences it permanently.
    const fx = clampEffects(raw);
    const reverbWet = fx.reverbBypass ? 0 : fx.reverbWet;
    const delayWet = fx.delayBypass ? 0 : fx.delayWet;
    const delayFeedback = fx.delayBypass ? 0 : fx.delayFeedback;
    const distortionWet = fx.distortionBypass ? 0 : fx.distortionWet;
    const eqLow = fx.eqBypass ? 0 : fx.eqLow;
    const eqMid = fx.eqBypass ? 0 : fx.eqMid;
    const eqHigh = fx.eqBypass ? 0 : fx.eqHigh;

    const nextDecay = this.quantiseDecay(fx.reverbDecay);
    if (this.reverbNode && nextDecay !== this.reverbDecay) {
      this.reverbNode.buffer = this.getImpulseResponse(nextDecay);
      this.reverbDecay = nextDecay;
    }
    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(fx.compressorThreshold, this.ctx.currentTime, 0.05);
    }

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
      this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, vol)), this.ctx.currentTime, 0.05);
    }
  }

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
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

  getAudioLevel(): number {
    if (!this.analyser) return 0;
    const binCount = this.analyser.frequencyBinCount;
    if (!this.levelBuffer || this.levelBuffer.length !== binCount) {
      this.levelBuffer = new Uint8Array(binCount);
    }
    const data = this.levelBuffer;
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (data.length * 255);
  }

}

// Re-exported from utils/musicTheory so the grid constant has one definition
// while every `import { STEPS_PER_BAR } from '../engine'` keeps resolving.
export { STEPS_PER_BAR };

export const audioEngine = new AudioEngine();
