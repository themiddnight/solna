import { SynthParams, MasterEffects } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  // Master bus nodes
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  // Effect nodes
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayGain: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;
  private distortionGain: GainNode | null = null;
  private eqLowNode: BiquadFilterNode | null = null;
  private eqMidNode: BiquadFilterNode | null = null;
  private eqHighNode: BiquadFilterNode | null = null;
  private dryGain: GainNode | null = null;

  // Active voices tracking
  private activeVoices = new Map<string, { oscs: OscillatorNode[]; gains: GainNode[]; filter: BiquadFilterNode; filterCutoff: number; filterRelease: number; lfo?: OscillatorNode; lfoGain?: GainNode; lfoTarget?: SynthParams['lfoTarget']; sustainLevel: number; source: string }>();

  // Metronome click buffer
  private clickBufferHigh: AudioBuffer | null = null;
  private clickBufferLow: AudioBuffer | null = null;

  // Shared lookahead clock (Tone.js-style): one master 16th-note grid on the
  // audio timeline that every player subscribes to, so they cannot drift apart.
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private clockBpm = 120;
  private clockStepIndex = 0; // monotonic 16th-step counter while the clock runs
  private clockNextStepTime = 0; // audio-clock seconds of the next step to schedule
  private clockListeners = new Set<(step: number, beat: number, time: number) => void>();
  private static readonly CLOCK_LOOKAHEAD = 0.1; // schedule events this far ahead
  private static readonly CLOCK_UPDATE_MS = 25;

  async init(): Promise<void> {
    if (this.isInitialized && this.ctx && this.ctx.state === 'running') return;

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.setupMasterChain();
    this.createClickBuffers();
    this.isInitialized = true;
  }

  /**
   * Subscribe to the shared 16th-note clock. The listener receives the exact
   * audio-clock time each step should sound, so callers can schedule
   * sample-accurately. Once started the clock runs continuously; re-subscribing
   * never restarts the grid, so live changes stay glitch-free.
   */
  subscribeClock(listener: (step: number, beat: number, time: number) => void): () => void {
    this.clockListeners.add(listener);
    this.ensureClockRunning();
    return () => {
      this.clockListeners.delete(listener);
      if (this.clockListeners.size === 0) {
        this.stopClockTimer();
      }
    };
  }

  setClockBpm(bpm: number): void {
    this.clockBpm = Math.max(20, Math.min(300, bpm));
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
    // Resync after long stalls (tab slept, context created late) instead of bursting missed steps
    if (this.clockNextStepTime < this.ctx.currentTime - 0.5) {
      this.clockNextStepTime = this.ctx.currentTime + 0.05;
    }
    const stepDuration = 60 / this.clockBpm / 4;
    while (this.clockNextStepTime < this.ctx.currentTime + AudioEngine.CLOCK_LOOKAHEAD) {
      const time = this.clockNextStepTime;
      const step = this.clockStepIndex;
      this.clockListeners.forEach((fn) => fn(step, Math.floor(step / 4), time));
      this.clockNextStepTime += stepDuration;
      this.clockStepIndex++;
    }
  }

  private setupMasterChain(): void {
    if (!this.ctx) return;

    // Master Output & Analyser
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

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
    (this.distortionNode as any).curve = this.makeDistortionCurve(20);
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
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  private makeDistortionCurve(amount = 20): Float32Array {
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

  playMetronomeClick(isDownbeat = false): void {
    if (!this.ctx || !this.dryGain) return;
    const buffer = isDownbeat ? this.clickBufferHigh : this.clickBufferLow;
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = isDownbeat ? 0.6 : 0.35;

    source.connect(gain);
    gain.connect(this.dryGain);
    source.start();
  }

  // Track-aware Note Trigger with full duration, synth params, and panning
  triggerTrackNote(
    trackId: string,
    noteName: string,
    params: SynthParams,
    velocity = 0.8,
    trackVolume = 1.0,
    durationSec = 0.4,
    pan = 0,
    time?: number
  ): void {
    if (!this.ctx || !this.dryGain) return;
    const freq = this.noteToFrequency(noteName, params.octave);
    const now = time ?? this.ctx.currentTime;

    try {
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

      const peakGain = Math.max(0.001, velocity * trackVolume * 0.45);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(peakGain, now + Math.max(0.005, params.attack));
      gainNode.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, peakGain * params.sustain),
        now + params.attack + params.decay
      );

      // Schedule release at note end
      const releaseStart = now + Math.max(0.05, durationSec);
      gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), releaseStart);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, releaseStart + Math.max(0.05, params.release));

      // VCF envelope release: ramp filter back to base cutoff
      filter.frequency.cancelScheduledValues(releaseStart);
      filter.frequency.setValueAtTime(Math.max(20, filter.frequency.value), releaseStart);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, params.filterCutoff), releaseStart + Math.max(0.01, params.filterRelease));

      // Stereo Panner (if available)
      let outNode: AudioNode = gainNode;
      if (this.ctx.createStereoPanner && pan !== 0) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
        gainNode.connect(panner);
        outNode = panner;
      }

      // Connect nodes
      osc1.connect(filter);
      oscSub.connect(subGain);
      subGain.connect(filter);
      filter.connect(gainNode);

      // Route to master chain
      outNode.connect(this.dryGain);
      if (this.delayNode) outNode.connect(this.delayNode);
      if (this.reverbNode) outNode.connect(this.reverbNode);

      osc1.start(now);
      oscSub.start(now);

      const stopTime = releaseStart + Math.max(0.05, params.release, params.filterRelease) + 0.05;
      osc1.stop(stopTime);
      oscSub.stop(stopTime);

      setTimeout(() => {
        try {
          osc1.disconnect();
          oscSub.disconnect();
          filter.disconnect();
          gainNode.disconnect();
        } catch {
          // ignore
        }
      }, (stopTime - this.ctx.currentTime + 0.1) * 1000);
    } catch (err) {
      console.error('Track note error:', err);
    }
  }

  // Synthesizer Note On
  triggerSynthNoteOn(noteName: string, params: SynthParams, velocity = 0.8, time?: number, source = 'synth'): void {
    if (!this.ctx || !this.dryGain) return;
    const freq = this.noteToFrequency(noteName, params.octave);
    const now = time ?? this.ctx.currentTime;

    // Stop existing voice if note is already sounding
    this.triggerSynthNoteOff(noteName, 0.3, undefined, source);

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

    const peakGain = velocity * 0.4;
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

    // Connect nodes
    osc1.connect(filter);
    oscSub.connect(subGain);
    subGain.connect(filter);

    filter.connect(gainNode);

    // Route to dry, reverb, delay, distortion
    gainNode.connect(this.dryGain);
    if (this.delayNode) gainNode.connect(this.delayNode);
    if (this.reverbNode) gainNode.connect(this.reverbNode);
    if (this.distortionNode) gainNode.connect(this.distortionNode);

    osc1.start(now);
    oscSub.start(now);

    this.activeVoices.set(`${source}:${noteName}`, {
      oscs: [osc1, oscSub],
      gains: [gainNode, subGain],
      filter,
      filterCutoff: params.filterCutoff,
      filterRelease: params.filterRelease,
      lfo,
      lfoGain,
      lfoTarget: params.lfoTarget,
      sustainLevel: peakGain * params.sustain,
      source,
    });
  }

  // Synthesizer Note Off
  triggerSynthNoteOff(noteName: string, releaseTime = 0.3, time?: number, source = 'synth'): void {
    if (!this.ctx) return;
    const voiceKey = `${source}:${noteName}`;
    const voice = this.activeVoices.get(voiceKey);
    if (!voice) return;

    const now = time ?? this.ctx.currentTime;
    const mainGain = voice.gains[0];

    try {
      mainGain.gain.cancelScheduledValues(now);
      // A release scheduled in the future can't read `.value` (the voice hasn't
      // sounded yet); fall back to the stored sustain level for a smooth tail.
      const releaseFrom = now > this.ctx.currentTime + 0.01
        ? Math.max(0.0001, voice.sustainLevel)
        : Math.max(0.0001, mainGain.gain.value);
      mainGain.gain.setValueAtTime(releaseFrom, now);
      mainGain.gain.exponentialRampToValueAtTime(0.00001, now + Math.max(0.01, releaseTime));

      // VCF envelope release: ramp filter back to base cutoff
      const filterRelease = Math.max(0.01, voice.filterRelease);
      voice.filter.frequency.cancelScheduledValues(now);
      voice.filter.frequency.setValueAtTime(Math.max(20, voice.filter.frequency.value), now);
      voice.filter.frequency.exponentialRampToValueAtTime(Math.max(20, voice.filterCutoff), now + filterRelease);

      setTimeout(() => {
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
      }, (Math.max(releaseTime, filterRelease) + Math.max(0, now - this.ctx.currentTime) + 0.1) * 1000);
    } catch {
      // ignore
    }

    this.activeVoices.delete(voiceKey);
  }

  private cancelAndHold(param: AudioParam, now: number): void {
    try {
      param.cancelAndHoldAtTime(now);
    } catch {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
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

    for (const voice of this.activeVoices.values()) {
      if (source && voice.source !== source) continue;
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

      // Keep the note-off filter release ramp in sync with the new cutoff
      voice.filterCutoff = params.filterCutoff;
      voice.filterRelease = params.filterRelease;

      if (params.lfoDepth > 0) {
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
            lfoGain.connect(osc.detune);
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
      } else if (voice.lfoGain) {
        voice.lfoGain.gain.setTargetAtTime(0, now, tc);
      }
    }
  }

  // Drum Synthesizer Trigger
  triggerDrum(type: string, velocity = 0.8, time?: number): void {
    if (!this.ctx || !this.dryGain) return;
    const now = time ?? this.ctx.currentTime;

    switch (type.toLowerCase()) {
      case 'kick': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);
        gain.gain.setValueAtTime(velocity * 0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.dryGain);
        osc.start(now);
        osc.stop(now + 0.36);
        break;
      }
      case 'snare': {
        // Body
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.08);
        oscGain.gain.setValueAtTime(velocity * 0.5, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(oscGain);
        oscGain.connect(this.dryGain);

        // Noise snap
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1000;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(velocity * 0.6, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.dryGain);
        if (this.reverbNode) noiseGain.connect(this.reverbNode);

        osc.start(now);
        noise.start(now);
        osc.stop(now + 0.2);
        noise.stop(now + 0.25);
        break;
      }
      case 'hihat':
      case 'closedhat': {
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7500;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(velocity * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.dryGain);
        noise.start(now);
        noise.stop(now + 0.06);
        break;
      }
      case 'openhat': {
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 6500;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(velocity * 0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.dryGain);
        if (this.delayNode) gain.connect(this.delayNode);
        noise.start(now);
        noise.stop(now + 0.36);
        break;
      }
      case 'clap': {
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 1.5;
        const gain = this.ctx.createGain();

        // 3 quick micro-bursts for realistic clap texture
        gain.gain.setValueAtTime(velocity * 0.5, now);
        gain.gain.setValueAtTime(0.1, now + 0.012);
        gain.gain.setValueAtTime(velocity * 0.55, now + 0.024);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.dryGain);
        if (this.reverbNode) gain.connect(this.reverbNode);
        noise.start(now);
        noise.stop(now + 0.22);
        break;
      }
      case 'tom':
      case 'lowtom': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(65, now + 0.2);
        gain.gain.setValueAtTime(velocity * 0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        osc.connect(gain);
        gain.connect(this.dryGain);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      }
      case 'crash':
      case 'ride': {
        const noise = this.createNoiseNode();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 5500;
        filter.Q.value = 0.8;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(velocity * 0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.dryGain);
        if (this.reverbNode) gain.connect(this.reverbNode);
        noise.start(now);
        noise.stop(now + 1.0);
        break;
      }
      default:
        break;
    }
  }

  private createNoiseNode(): AudioBufferSourceNode {
    if (!this.ctx) return {} as AudioBufferSourceNode;
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    return noise;
  }

  updateEffects(fx: MasterEffects): void {
    if (!this.ctx) return;
    if (this.reverbGain) this.reverbGain.gain.setTargetAtTime(fx.reverbWet, this.ctx.currentTime, 0.05);
    if (this.delayGain) this.delayGain.gain.setTargetAtTime(fx.delayWet, this.ctx.currentTime, 0.05);
    if (this.delayFeedbackGain) this.delayFeedbackGain.gain.setTargetAtTime(fx.delayFeedback, this.ctx.currentTime, 0.05);
    if (this.distortionGain) this.distortionGain.gain.setTargetAtTime(fx.distortionWet, this.ctx.currentTime, 0.05);
    if (this.eqLowNode) this.eqLowNode.gain.setTargetAtTime(fx.eqLow, this.ctx.currentTime, 0.05);
    if (this.eqMidNode) this.eqMidNode.gain.setTargetAtTime(fx.eqMid, this.ctx.currentTime, 0.05);
    if (this.eqHighNode) this.eqHighNode.gain.setTargetAtTime(fx.eqHigh, this.ctx.currentTime, 0.05);
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

  getByteFrequencyData(array: Uint8Array): void {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(array as any);
    }
  }

  getByteTimeDomainData(array: Uint8Array): void {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(array as any);
    }
  }

  getAudioLevel(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (data.length * 255);
  }

  private noteToFrequency(note: string, octaveOffset = 0): number {
    const noteMap: Record<string, number> = {
      C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
      'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
    };

    const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)?$/);
    if (!match) return 440;

    const noteName = match[1].toUpperCase();
    const octave = (match[2] ? parseInt(match[2], 10) : 4) + octaveOffset;
    const semitones = (noteMap[noteName] ?? 9) + (octave - 4) * 12;
    return 440 * Math.pow(2, (semitones - 9) / 12);
  }
}

export const audioEngine = new AudioEngine();
