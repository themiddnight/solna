import { SynthParams, MasterEffects, FilterType } from '../types';
import { noteFrequency, clampBpm, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import { DEFAULT_VELOCITY } from './constants';
import { mergeDrumKit, type DrumKit } from './drumKits';

type SynthVoice = {
  oscs: OscillatorNode[];
  gains: GainNode[];
  filter: BiquadFilterNode;
  filterCutoff: number;
  filterRelease: number;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  lfoTarget?: SynthParams['lfoTarget'];
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
  // Node teardown is a timer sized to the release tail. Re-planning a release
  // that has not started must replace that timer, not add a second one.
  teardownTimer?: ReturnType<typeof setTimeout>;
};

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
  // Last decay applied to the convolver impulse; guards against re-randomizing
  // the reverb tail on every updateEffects call.
  private reverbDecay = 2.0;
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

      if (this.metronomeEnabled && step % 4 === 0) {
        this.playMetronomeClick(step % STEPS_PER_BAR === 0, time);
      }
      // One listener's failure is isolated: every other subscriber still gets
      // this step. Logged rather than swallowed so the fault is findable.
      this.clockListeners.forEach((fn) => {
        try {
          fn(step, Math.floor(step / 4), time);
        } catch (err) {
          console.error('[audioEngine] clock listener threw; continuing', err);
        }
      });
    }
  }

  private setupMasterChain(): void {
    if (!this.ctx) return;

    // The master chain is (re)built on every AudioContext (re)creation; any
    // per-source buses from the previous context are wired into dead nodes, so
    // drop them — they are lazily recreated against the new context on demand.
    this.sourceBuses.clear();

    // Master Output & Analyser. 0.6 = deliberate −4.4 dB staging ceiling so
    // the densest voicings peak around −6 dBFS before the compressor instead
    // of clipping the destination.
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.6;

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

    // Delay
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.25;
    this.delayFeedbackGain = this.ctx.createGain();
    this.delayFeedbackGain.gain.value = 0.35;
    this.delayGain = this.ctx.createGain();
    this.delayGain.gain.value = 0.2;

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
    this.reverbNode.buffer = this.buildImpulseResponse(2.0, 2.0);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.25;

    this.reverbNode.connect(this.reverbGain);

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

  private buildImpulseResponse(duration: number, decay: number): AudioBuffer {
    if (!this.ctx) return new AudioBuffer({ length: 1, numberOfChannels: 2, sampleRate: 44100 });
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = length - i;
      left[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
      right[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
    }
    return impulse;
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
        if (key.startsWith('bass:')) this.triggerSynthNoteOff(key.slice(5), 0.05, time, 'bass');
      }
    }

    // Stop an existing live voice of the same note. Skipped when the existing
    // voice already has its release planned (pre-scheduled pattern hits or the
    // bass mono kill above): re-releasing at scheduling time would truncate
    // its envelope.
    const existing = this.activeVoices.get(`${source}:${noteName}`);
    if (!existing?.releaseScheduledAt) {
      this.triggerSynthNoteOff(noteName, 0.3, undefined, source);
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

    // Filter Envelope (VCF ADSR)
    const filterPeak = Math.min(20000, Math.max(20, params.filterCutoff + params.filterEnvAmount));
    const filterSustainLevel = Math.min(20000, Math.max(20, params.filterCutoff + params.filterEnvAmount * params.filterSustain));
    filter.frequency.exponentialRampToValueAtTime(filterPeak, now + Math.max(0.01, params.filterAttack));
    filter.frequency.exponentialRampToValueAtTime(filterSustainLevel, now + params.filterAttack + params.filterDecay);

    // Amplitude Envelope
    const gainNode = this.ctx.createGain();
    const subGain = this.ctx.createGain();
    subGain.gain.value = params.subOscVolume;

    const peakGain = velocity * 0.4 * scaleFactor;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), now + Math.max(0.005, params.attack));
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain * params.sustain), now + params.attack + params.decay);

    // LFO
    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;
    if (params.lfoDepth > 0) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      lfoGain = this.ctx.createGain();

      if (params.lfoTarget === 'cutoff') {
        lfoGain.gain.value = params.lfoDepth * 1500;
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
      } else if (params.lfoTarget === 'pitch') {
        lfoGain.gain.value = params.lfoDepth * 50;
        lfo.connect(lfoGain);
        lfoGain.connect(osc1.detune);
      } else {
        lfoGain.gain.value = params.lfoDepth * 0.2;
        lfo.connect(lfoGain);
        lfoGain.connect(gainNode.gain);
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

    // Route through the per-source bus (lazily created) to dry/effects
    gainNode.connect(this.getSourceBus(source));

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
      sustainLevel: peakGain * params.sustain,
      peakGain,
      ampEnvEndsAt: now + params.attack + params.decay,
      filterEnvEndsAt: now + params.filterAttack + params.filterDecay,
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
  triggerSynthNoteOff(noteName: string, releaseTime = 0.3, time?: number, source = 'synth'): void {
    if (!this.ctx) return;
    const voice = this.activeVoices.get(`${source}:${noteName}`);
    if (!voice) return;

    const now = time ?? this.ctx.currentTime;
    // All voices stay tracked until teardown so live param updates can reach
    // sounding (or still-scheduled) voices; the same-note dedup in
    // triggerSynthNoteOn skips voices whose release is already planned here.
    voice.releaseScheduledAt = now;
    this.releaseVoice(voice, releaseTime, now);
  }

  // Silences one voice: cancels its envelopes, ramps amp/filter down, and
  // tears the nodes down after the release tail.
  private releaseVoice(voice: SynthVoice, releaseTime: number, now: number): void {
    if (!this.ctx) return;
    const mainGain = voice.gains[0];
    if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);

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
        ? Math.max(0.0001, voice.sustainLevel)
        : Math.max(0.0001, mainGain.gain.value);
      this.cancelAndHold(mainGain.gain, now, ampFallback);
      // cancelAndHoldAtTime inserts NO hold point when nothing is scheduled at
      // or after `now` — verified against an OfflineAudioContext render. The
      // ramp below would then start from the end of the DECAY instead of from
      // `now`, fading a held chord out across its whole length. Past the decay
      // the value is exactly the sustain level, so anchor it there; inside the
      // envelope cancelAndHold already left an exact hold point.
      if (now >= voice.ampEnvEndsAt) {
        mainGain.gain.setValueAtTime(Math.max(0.0001, voice.sustainLevel), now);
      }
      mainGain.gain.exponentialRampToValueAtTime(0.00001, now + Math.max(0.01, releaseTime));

      // VCF envelope release: ramp filter back to base cutoff
      const filterRelease = Math.max(0.01, voice.filterRelease);
      this.cancelAndHold(voice.filter.frequency, now, Math.max(20, voice.filter.frequency.value));
      if (now >= voice.filterEnvEndsAt) {
        voice.filter.frequency.setValueAtTime(Math.max(20, voice.filterSustainCutoff), now);
      }
      voice.filter.frequency.exponentialRampToValueAtTime(Math.max(20, voice.filterCutoff), now + filterRelease);

      const voiceKey = `${voice.source}:${voice.noteName}`;
      voice.teardownTimer = setTimeout(() => {
        // Only delete the map entry if this voice is still the current one —
        // a same-note retrigger overwrites the entry before this timeout
        // fires. The voice's own nodes are always torn down regardless.
        if (this.activeVoices.get(voiceKey) === voice) {
          this.activeVoices.delete(voiceKey);
        }
        this.sourceVoices.get(voice.source)?.delete(voice);
        voice.oscs.forEach((osc) => {
          try { osc.stop(); osc.disconnect(); } catch { /* ignore */ }
        });
        voice.gains.forEach((g) => {
          try { g.disconnect(); } catch { /* ignore */ }
        });
        try { voice.filter.disconnect(); } catch { /* ignore */ }
        if (voice.lfo) {
          try { voice.lfo.stop(); voice.lfo.disconnect(); } catch { /* ignore */ }
        }
        if (voice.lfoGain) {
          try { voice.lfoGain.disconnect(); } catch { /* ignore */ }
        }
        if (voice.noise) {
          try { voice.noise.stop(); voice.noise.disconnect(); } catch { /* ignore */ }
        }
        if (voice.noiseGain) {
          try { voice.noiseGain.disconnect(); } catch { /* ignore */ }
        }
      }, (Math.max(releaseTime, filterRelease) + Math.max(0, now - this.ctx.currentTime) + 0.1) * 1000);
    } catch {
      // ignore
    }
  }

  // Immediately silences every voice of a source — sounding ones and hits
  // still scheduled in the future. Releasing a held preview stops the whole
  // pattern, not just the last scheduled hit.
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
      voice.releaseScheduledAt = now;
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
    for (const voice of this.activeVoices.values()) {
      if (voice.releaseScheduledAt !== undefined) continue;
      const factor = scale / voice.envelopeScale;
      if (Math.abs(factor - 1) < 0.001) continue;

      voice.envelopeScale = scale;
      voice.sustainLevel *= factor;
      // peakGain must track the rebalance too: updateSynthParams recomputes
      // the sustain level from it, and an unscaled peak would undo this.
      voice.peakGain *= factor;
      const gain = voice.gains[0].gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(0.0001, gain.value), now);
      gain.setTargetAtTime(Math.max(0.0001, voice.sustainLevel), now, 0.01);
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
      if (voice.startTime > now && voice.releaseScheduledAt !== undefined) continue;
      voice.releaseScheduledAt = now;
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
    try {
      param.cancelAndHoldAtTime(now);
    } catch {
      param.cancelScheduledValues(now);
      param.setValueAtTime(fallbackValue ?? param.value, now);
    }
  }

  // Re-points a live voice's LFO at the current params, creating the LFO nodes
  // on the spot if the depth knob has just come up off zero.
  private updateVoiceLfo(voice: SynthVoice, params: SynthParams, now: number, tc: number): void {
    if (!this.ctx) return;
    if (params.lfoDepth <= 0) {
      voice.lfoGain?.gain.setTargetAtTime(0, now, tc);
      return;
    }

    let lfo = voice.lfo;
    let lfoGain = voice.lfoGain;
    if (!lfo || !lfoGain) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfo.start(now);
      voice.lfo = lfo;
      voice.lfoGain = lfoGain;
    }

    if (voice.lfoTarget !== params.lfoTarget) {
      try {
        lfoGain.disconnect();
      } catch {
        // ignore
      }
      if (params.lfoTarget === 'cutoff') {
        lfoGain.connect(voice.filter.frequency);
      } else if (params.lfoTarget === 'pitch') {
        lfoGain.connect(voice.oscs[0].detune);
      } else {
        lfoGain.connect(voice.gains[0].gain);
      }
      voice.lfoTarget = params.lfoTarget;
    }

    lfo.frequency.setTargetAtTime(params.lfoRate, now, tc);
    const depth =
      params.lfoTarget === 'cutoff'
        ? params.lfoDepth * 1500
        : params.lfoTarget === 'pitch'
          ? params.lfoDepth * 50
          : params.lfoDepth * 0.2;
    lfoGain.gain.setTargetAtTime(depth, now, tc);
  }

  // Live-update every sounding voice so knob tweaks are audible immediately
  // instead of only on the next note. ADSR timing values still apply to the
  // next note (standard synth behavior); release cutoff stays in sync.
  updateSynthParams(params: SynthParams, source?: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = 0.03; // smoothing time constant in seconds

    const sustainCutoff = Math.min(
      20000,
      Math.max(20, params.filterCutoff + params.filterEnvAmount * params.filterSustain)
    );

    // Iterate every tracked voice of the source (or all of them), not just
    // the dedup map's latest-per-note entries: a sounding voice that a later
    // same-note hit replaced in activeVoices must still be re-shaped live.
    const voices = source
      ? this.sourceVoices.get(source) ?? new Set<SynthVoice>()
      : new Set<SynthVoice>(Array.from(this.sourceVoices.values()).flatMap((set) => Array.from(set)));
    for (const voice of voices) {
      // Only re-shape voices that are sounding right now. Voices scheduled
      // ahead keep the envelopes they were planned with (their next trigger
      // already uses the latest params); re-targeting them here would cancel
      // their scheduled ramps, release ramps included.
      if (voice.startTime > this.ctx.currentTime) continue;
      // A voice already in its release tail keeps the ramp it was scheduled
      // with; re-targeting its filter mid-release would cancel the fade.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt <= this.ctx.currentTime) continue;
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
        voice.gains[0].gain.setTargetAtTime(Math.max(0.0001, nextSustain), now, tc);
      }

      // A voice sounding now whose note-off sits ahead on the clock (a
      // sustained chord, a whole-note bass) has its release ramp already
      // planned with the OLD release time and cutoff — and the cancelAndHold
      // above just wiped the filter half of it. Re-plan it: nothing has faded
      // yet, so re-arming is silent, and the Release knob reaches the note
      // that is ringing instead of only the next one.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt > now) {
        this.releaseVoice(voice, params.release, voice.releaseScheduledAt);
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
    if (!this.ctx || !this.drumBusFilter) return;
    const now = this.ctx.currentTime;
    this.drumBusFilter.frequency.setTargetAtTime(cutoff, now, 0.03);
    this.drumBusFilter.Q.setTargetAtTime(resonance, now, 0.03);
    this.drumBusFilter.type = type;
  }

  // Drum Synthesizer Trigger
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    if (!this.ctx || !this.dryGain || !this.drumBusFilter) return;
    const now = time ?? this.ctx.currentTime;
    const k = this.drumKit;

    switch (type.toLowerCase()) {
      case 'kick': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(k.kick.freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(k.kick.freqEnd, now + k.kick.pitchTime);
        gain.gain.setValueAtTime(velocity * k.kick.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + k.kick.decay);

        osc.connect(gain);
        gain.connect(this.drumBusFilter);
        osc.start(now);
        osc.stop(now + k.kick.decay + 0.02);

        if (k.kick.clickFreq && k.kick.clickLevel) {
          const clickOsc = this.ctx.createOscillator();
          const clickGain = this.ctx.createGain();
          clickOsc.frequency.setValueAtTime(k.kick.clickFreq, now);
          clickGain.gain.setValueAtTime(velocity * k.kick.clickLevel, now);
          clickGain.gain.exponentialRampToValueAtTime(0.0001, now + (k.kick.clickDecay ?? 0.01));
          clickOsc.connect(clickGain);
          clickGain.connect(this.drumBusFilter);
          clickOsc.start(now);
          clickOsc.stop(now + k.kick.decay + 0.02);
        }
        break;
      }
      case 'snare': {
        const s = k.snare;
        // Body
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(s.bodyFreqStart, now);
        osc.frequency.exponentialRampToValueAtTime(s.bodyFreqEnd, now + s.bodyTime);
        oscGain.gain.setValueAtTime(velocity * s.bodyGain, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + s.bodyDecay);
        osc.connect(oscGain);
        oscGain.connect(this.drumBusFilter);

        // Noise snap
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = s.noiseFilter;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(velocity * s.noiseGain, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + s.noiseDecay);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.drumBusFilter);
        if (this.reverbNode && s.reverbSend > 0) noiseGain.connect(this.reverbNode);

        osc.start(now);
        noise.start(now);
        osc.stop(now + s.bodyDecay + 0.05);
        noise.stop(now + s.noiseDecay + 0.03);
        break;
      }
      case 'hihat':
      case 'closedhat': {
        const h = k.hihat;
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = h.filter;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(velocity * h.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + h.decay);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.drumBusFilter);
        noise.start(now);
        noise.stop(now + h.decay + 0.01);
        break;
      }
      case 'openhat': {
        const h = k.openhat;
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = h.filter;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(velocity * h.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + h.decay);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.drumBusFilter);
        if (this.delayNode) gain.connect(this.delayNode);
        noise.start(now);
        noise.stop(now + h.decay + 0.01);
        break;
      }
      case 'clap': {
        const c = k.clap;
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = c.filter;
        filter.Q.value = 1.5;
        const gain = this.ctx.createGain();

        // 3 quick micro-bursts for realistic clap texture
        gain.gain.setValueAtTime(velocity * c.gain, now);
        gain.gain.setValueAtTime(0.1, now + 0.012);
        gain.gain.setValueAtTime(velocity * c.gain * 1.1, now + 0.024);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + c.decay);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.drumBusFilter);
        if (this.reverbNode && c.reverbSend > 0) gain.connect(this.reverbNode);
        noise.start(now);
        noise.stop(now + c.decay + 0.02);
        break;
      }
      case 'tom':
      case 'lowtom': {
        const t = k.tom;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(t.freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(t.freqEnd, now + t.pitchTime);
        gain.gain.setValueAtTime(velocity * t.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t.decay);
        osc.connect(gain);
        gain.connect(this.drumBusFilter);
        osc.start(now);
        osc.stop(now + t.decay + 0.02);
        break;
      }
      case 'crash':
      case 'ride': {
        const cr = k.crash;
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = cr.filter;
        filter.Q.value = 0.8;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(velocity * cr.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + cr.decay);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.drumBusFilter);
        if (this.reverbNode && cr.reverbSend > 0) gain.connect(this.reverbNode);
        noise.start(now);
        noise.stop(now + cr.decay + 0.1);
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
  private createNoiseNodes(level: number, target: AudioNode, startAt: number): Pick<SynthVoice, 'noise' | 'noiseGain'> {
    if (!this.ctx || level <= 0) return {};
    const noise = this.createNoiseNode();
    noise.loop = true;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = level;
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
      // Ramp up from silence so adding the source mid-note doesn't click.
      Object.assign(voice, this.createNoiseNodes(Number.MIN_VALUE, voice.filter, now));
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
    return noise;
  }

  updateEffects(fx: MasterEffects): void {
    if (!this.ctx) return;
    const reverbWet = fx.reverbBypass ? 0 : fx.reverbWet;
    const delayWet = fx.delayBypass ? 0 : fx.delayWet;
    const delayFeedback = fx.delayBypass ? 0 : fx.delayFeedback;
    const distortionWet = fx.distortionBypass ? 0 : fx.distortionWet;
    const eqLow = fx.eqBypass ? 0 : fx.eqLow;
    const eqMid = fx.eqBypass ? 0 : fx.eqMid;
    const eqHigh = fx.eqBypass ? 0 : fx.eqHigh;

    if (this.reverbNode && fx.reverbDecay !== this.reverbDecay) {
      this.reverbNode.buffer = this.buildImpulseResponse(2.0, fx.reverbDecay);
      this.reverbDecay = fx.reverbDecay;
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
