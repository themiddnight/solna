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
import { clampEffects, clampEffectValue } from './effectLimits';
import { IMPULSE_CACHE_SAMPLE_BUDGET, impulseSampleCount, keysToEvict } from './impulseBudget';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';

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
  // When an amp release ramp was last STARTED for this voice. Distinct from
  // releaseScheduledAt, which triggerSynthNoteOff overwrites BEFORE calling
  // releaseVoice: this one is the previous release as seen from inside
  // releaseVoice, which is what tells a second release that the voice is
  // already fading and must not be re-anchored to its sustain level.
  ampReleaseAt?: number;
  // The release time this voice was ACTUALLY released with. A pending release
  // re-planned by updateSynthParams must reuse it, not the current patch's —
  // the bass mono-kill uses 0.05 s and the same-note dedup 0.3 s, and stretching
  // either to a pad's 2 s release lets a "stopped" note ring under the new one.
  releaseTime?: number;
  // Node teardown is a timer sized to the release tail. Re-planning a release
  // that has not started must replace that timer, not add a second one.
  teardownTimer?: ReturnType<typeof setTimeout>;
  // Wall-clock backstop for a note-off that never arrives (window blur while
  // a key is held, a MIDI device unplugged mid-note, a touch interrupted by
  // the OS — see useInputDeck.ts, Keyboard.tsx and midiInput.ts). Cleared in
  // teardownVoiceNodes alongside lfoTeardownTimer so a normal release cannot
  // let this fire a second time.
  lifetimeGuardTimer?: ReturnType<typeof setTimeout>;
  /**
   * AUDIO-clock time this voice's nodes should be torn down.
   *
   * teardownTimer is a wall-clock setTimeout while the envelope it waits on
   * runs on the audio clock. When the context is suspended, currentTime
   * freezes and the timer keeps counting, so teardown fires before the release
   * ramp has run and the note is gone on resume. rearmVoiceTeardowns() uses
   * this to re-derive the delay from the audio clock after a resume.
   */
  teardownAt?: number;
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
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True only when THIS engine called suspend(). A context the BROWSER
   * suspended (backgrounded tab) is resumed by init()'s existing resume path,
   * and must not be resumed by a stray pointer event that only wakes idle
   * suspends.
   */
  private suspendedForIdle = false;
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

  // Ceiling on how long a voice can sit in activeVoices without a note-off,
  // in real wall-clock ms (not audio-clock seconds — this must keep counting
  // even if ctx.currentTime stalls). An instance field, not a module
  // constant, so a test can shrink it instead of waiting out 30 real seconds.
  private maxVoiceLifetimeMs = 30_000;

  // Generous per-source ceiling. Bounds worst-case node count from a fast
  // arp with a long release, where dozens of voices can otherwise pile up
  // faster than maxVoiceLifetimeMs alone drains them.
  private maxVoicesPerSource = 24;

  // Per-source buses: one gain bus per source string ('synth', 'chord', 'bass', ...).
  // Voice gains connect here instead of straight to dry/effects, so a whole layer
  // (e.g. bass) can be muted or leveled with one click-free ramp.
  private sourceBuses = new Map<string, GainNode>();
  // One analyser per source bus, for per-layer scopes (the Synth view's
  // oscilloscope follows its Target selector). Cleared with sourceBuses in
  // setupMasterChain — an AnalyserNode belongs to the context that made it.
  private sourceAnalysers = new Map<string, AnalyserNode>();
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
        this.rearmVoiceTeardowns();
        // This resume already happened, whoever it was for — a stale true
        // here would make the next wakeIfIdle() redundantly resume() and
        // sweep every voice's teardown again for nothing.
        this.suspendedForIdle = false;
      } catch {
        // browser autoplay policy requires user gesture
      }
    }
    this.markActivity();
    this.isInitialized = true;
  }

  /**
   * Arms or disarms the CLICK. It does not start, stop or hold the clock.
   *
   * It used to do all three, which made the toggle a second transport: the
   * grid's playhead ran, the lead recorder quantised against it and the
   * context never went idle, from a control that only claims to add a click
   * to music that is already playing. The click is emitted from clockTick,
   * and clockTick only runs while a player holds a subscription, so "clicks
   * only while something plays" now falls out of the wiring instead of
   * needing a guard of its own.
   */
  setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
    this.markActivity();
  }

  isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
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
    this.markActivity();
    return () => {
      this.clockListeners.delete(listener);
      if (this.clockListeners.size === 0) {
        this.stopClockTimer();
        this.markActivity();
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
   *
   * `atTime` anchors that step 0 on the audio clock instead of the default
   * CLOCK_REANCHOR_DELAY ahead of now. A restart that must continue an
   * ALREADY-RUNNING grid — the song-mode loop advance — has to pass the
   * boundary step's own time: steps are dispatched from up to CLOCK_LOOKAHEAD
   * ahead, so a fixed `now + 0.05` puts the new loop's downbeat off the grid by
   * `0.05 - (how far ahead the boundary was scheduled)`, which is 25-42 ms
   * EARLY across the usual tempos and reads as a stumble at the seam.
   *
   * An `atTime` the audio clock has already passed (a stalled tick) is ignored
   * in favour of the default: scheduling behind `currentTime` would make
   * clockTick burst every step in between.
   */
  resetClock(atTime?: number): void {
    this.clockStepIndex = 0;
    if (!this.ctx) {
      this.clockNextStepTime = 0;
      return;
    }
    const fallback = this.ctx.currentTime + AudioEngine.CLOCK_REANCHOR_DELAY;
    this.clockNextStepTime =
      atTime !== undefined && atTime > this.ctx.currentTime ? atTime : fallback;
  }

  /** Every voice still live OR still releasing, across every source. */
  private liveVoiceCount(): number {
    let count = 0;
    for (const voices of this.sourceVoices.values()) count += voices.size;
    return count;
  }

  /**
   * Restart the idle countdown. Called from every path that produces sound or
   * takes the clock — so the timer only ever reaches zero after genuinely
   * nothing has happened for IDLE_SUSPEND_MS.
   */
  private markActivity(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.ctx) return;
    this.idleTimer = setTimeout(() => this.maybeSuspendNow(), IDLE_SUSPEND_MS);
  }

  /** Suspend if and only if shouldSuspendWhenIdle agrees. */
  private maybeSuspendNow(): void {
    if (!this.ctx) return;
    const ok = shouldSuspendWhenIdle({
      clockListenerCount: this.clockListeners.size,
      liveVoiceCount: this.liveVoiceCount(),
      contextState: this.ctx.state,
    });
    if (!ok) {
      // Something is still running: re-arm rather than giving up for the
      // session, or a single note during the window would disable idle
      // suspend until the next init().
      this.markActivity();
      return;
    }
    try {
      const suspending = Promise.resolve(this.ctx.suspend());
      // Set true only once suspend() has actually been issued without
      // throwing synchronously — otherwise wakeIfIdle would believe there is
      // a suspend of ITS OWN to resume that never actually started.
      this.suspendedForIdle = true;
      void suspending.catch(() => {
        this.suspendedForIdle = false;
      });
    } catch {
      this.suspendedForIdle = false;
    }
  }

  /**
   * Wake from an idle suspend. Wired to pointerdown/keydown in App.tsx rather
   * than to the note-on itself: resuming a suspended context is asynchronous,
   * so doing it at note-on time would make the first note late. By the time a
   * pointer has travelled from press to a knob or a key, the context is back.
   *
   * Safe before init() and safe to call on every pointer event.
   */
  wakeIfIdle(): void {
    if (!this.ctx) return;
    if (!this.suspendedForIdle) {
      // Nothing of ours to resume, but the gesture is still activity: without
      // this, an ordinary click on a context that was never idle-suspended
      // cleared the countdown and never restarted it, leaving idle suspend
      // disarmed until the next note, clock tick or metronome event.
      this.markActivity();
      return;
    }
    void Promise.resolve(this.ctx.resume())
      .then(() => {
        this.suspendedForIdle = false;
      })
      .catch(() => {
        // Left true so the NEXT gesture retries resume() instead of
        // silently giving up on a rejection that may not be permanent.
      });
    // Re-arm synchronously too: currentTime is still frozen at this exact
    // instant — it only starts advancing once resume() actually takes
    // effect, not when it is merely called — so this is not a race with the
    // .then() above. It protects a fake context that resolves resume() on a
    // microtask, and a real one that may take a frame, from either letting a
    // stale wall-clock timer fire first.
    this.rearmVoiceTeardowns();
    this.markActivity();
  }

  /**
   * Re-derive every pending teardown delay from the audio clock.
   *
   * While the context is suspended, currentTime freezes and the wall-clock
   * teardown timers keep counting, so on resume they are due immediately and
   * a note in the middle of a 2 s release is torn down mid-ramp. Called on
   * every resume — this engine's idle wake AND init()'s existing resume path,
   * which covers a browser-initiated backgrounded-tab suspend.
   */
  private rearmVoiceTeardowns(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voices of this.sourceVoices.values()) {
      for (const voice of voices) {
        if (voice.teardownTimer === undefined || voice.teardownAt === undefined) continue;
        clearTimeout(voice.teardownTimer);
        voice.teardownTimer = setTimeout(
          () => this.finishVoiceTeardown(voice),
          Math.max(0, voice.teardownAt - now) * 1000,
        );
      }
    }
  }

  /** The body the teardown timer runs — shared by releaseVoice and the re-arm. */
  private finishVoiceTeardown(voice: SynthVoice): void {
    const voiceKey = `${voice.source}:${voice.noteName}`;
    // Only delete the map entry if this voice is still the current one — a
    // same-note retrigger overwrites the entry before this timeout fires. The
    // voice's own nodes are always torn down regardless.
    if (this.activeVoices.get(voiceKey) === voice) {
      this.activeVoices.delete(voiceKey);
    }
    this.sourceVoices.get(voice.source)?.delete(voice);
    this.teardownVoiceNodes(voice);
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
    this.sourceAnalysers.clear();
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

    // Drum bus filter — routed through the sequencer source bus for volume and mute control
    this.drumBusFilter = this.ctx.createBiquadFilter();
    this.drumBusFilter.type = this.drumFilterType;
    this.drumBusFilter.frequency.value = this.drumFilterCutoff;
    this.drumBusFilter.Q.value = this.drumFilterResonance;
    this.drumBusFilter.connect(this.getSourceBus('sequencer'));

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
    const buffer = this.buildImpulseResponse(quantisedDecay, AudioEngine.REVERB_CURVE);
    const samples = impulseSampleCount(this.ctx?.sampleRate ?? 44100, quantisedDecay);
    this.impulseCache.set(quantisedDecay, { buffer, samples });

    const entries = Array.from(this.impulseCache, ([key, value]) => ({ key, samples: value.samples }));
    for (const key of keysToEvict(entries, this.impulseCacheSampleBudget)) {
      this.impulseCache.delete(key);
    }
    return buffer;
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
    source.onended = () => {
      try { source.disconnect(); } catch { /* ignore */ }
      try { gain.disconnect(); } catch { /* ignore */ }
    };
  }

  // Bass is monophonic like a real bass: kill any other sounding bass voice
  // BEFORE creating the new one.
  //
  // Iterates sourceVoices.get('bass') — the set that already holds exactly
  // the bass voices — rather than snapshotting the WHOLE activeVoices map on
  // every bass note-on and filtering it down by key prefix. During an arp
  // that map holds every chord, lead and preview voice too.
  //
  // The identity guard restores the old semantics exactly: activeVoices kept
  // only the LATEST voice per key, so a superseded same-note voice was never
  // visited. sourceVoices keeps every live-or-releasing voice, so without
  // this check a superseded voice would send a second, duplicate note-off
  // for the same note name — which triggerSynthNoteOff resolves against the
  // CURRENT voice, releasing it twice.
  //
  // The set is snapshotted with Array.from for the same reason the map used
  // to be: triggerSynthNoteOff reaches releaseVoice, and a future change
  // there that deletes from sourceVoices synchronously must not invalidate
  // this iteration. The copy is now over ~1-2 bass voices, not ~50.
  //
  // Pass `time` so a live previous voice's release ramp starts exactly when
  // the new note starts (not immediately); the release timeout already
  // accounts for the future `time` in its delay math.
  private killPreviousBassVoice(time?: number): void {
    if (!this.ctx) return;
    const killAt = time ?? this.ctx.currentTime;
    const bassVoices = this.sourceVoices.get('bass');
    if (!bassVoices) return;
    for (const tracked of Array.from(bassVoices)) {
      if (this.activeVoices.get(`bass:${tracked.noteName}`) !== tracked) continue;
      // A voice whose release has already STARTED is on its way out;
      // killing it again only resets its teardown timer and re-runs the
      // ramps. A release still ahead on the clock is a different case and
      // must be cut short here, or a long scheduled note would ring
      // through the new one and break monophony.
      if (tracked.releaseScheduledAt !== undefined && tracked.releaseScheduledAt <= killAt) continue;
      this.triggerSynthNoteOff(tracked.noteName, 0.05, time, 'bass', true);
    }
  }

  triggerSynthNoteOn(noteName: string, params: SynthParams, velocity = DEFAULT_VELOCITY, time?: number, source = 'synth', scaleFactor = 1): void {
    if (!this.ctx || !this.dryGain) return;
    // wakeIfIdle() re-arms the idle countdown itself on every reachable path
    // (see its body) — a second explicit markActivity() call here was a
    // redundant clearTimeout+setTimeout pair on every single note-on. Every
    // caller reaches this choke point, including MIDI input, which triggers
    // notes directly with no init()/gesture path of its own.
    this.wakeIfIdle();
    const freq = noteFrequency(noteName, params.octave);
    const now = time ?? this.ctx.currentTime;

    if (source === 'bass') this.killPreviousBassVoice(time);

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

    // Backstop: force this voice through the normal release path after
    // maxVoiceLifetimeMs of wall-clock time if nothing ever releases it. The
    // two `this.activeVoices.get(...) !== voice` / releaseScheduledAt checks
    // make this a no-op on every voice that was released normally — see
    // teardownVoiceNodes, which clears this timer on every real teardown path.
    const voiceKey = `${source}:${noteName}`;
    voice.lifetimeGuardTimer = setTimeout(() => {
      if (this.activeVoices.get(voiceKey) !== voice) return;
      if (voice.releaseScheduledAt !== undefined) return;
      if (!this.ctx) return;
      const releasedAt = this.ctx.currentTime;
      // Same requirement as stealOldestVoice below: releaseVoice() does not
      // set releaseScheduledAt itself, and this voice is still in
      // sourceVoices. Leaving it undefined would keep it reshapeable through
      // its 0.05 s release tail, so a knob move or new note-on landing in
      // that window re-targets it toward sustain right as teardown stops the
      // oscillator — an audible click on a voice that is meant to be dying.
      voice.releaseScheduledAt = releasedAt;
      voice.releaseTime = 0.05;
      this.releaseVoice(voice, 0.05, releasedAt);
    }, this.maxVoiceLifetimeMs);

    if (voicesOfSource.size > this.maxVoicesPerSource) {
      this.stealOldestVoice(voicesOfSource, voice, now);
    }
  }

  // Steals the oldest already-started, not-yet-releasing voice of a source
  // once its count exceeds maxVoicesPerSource. `startTime > now` is excluded
  // — stealing a voice scheduled ahead would cancel a planned envelope, the
  // same hazard releaseVoice's own comments describe for reshapeableVoices.
  private stealOldestVoice(voicesOfSource: Set<SynthVoice>, incoming: SynthVoice, now: number): void {
    let oldest: SynthVoice | undefined;
    for (const tracked of voicesOfSource) {
      if (tracked === incoming) continue;
      if (tracked.startTime > now) continue;
      if (tracked.releaseScheduledAt !== undefined) continue;
      if (!oldest || tracked.startTime < oldest.startTime) oldest = tracked;
    }
    if (!oldest) return;
    // releaseVoice() does not set releaseScheduledAt on its own — only
    // triggerSynthNoteOff and the hard-silence paths do. Set it here, or the
    // `releaseScheduledAt !== undefined` guard above never excludes the voice
    // this loop just stole, and the same voice gets re-stolen on every
    // note-on over the cap while newer voices run unbounded.
    oldest.releaseScheduledAt = now;
    oldest.releaseTime = 0.02;
    this.releaseVoice(oldest, 0.02, now);
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
    if (voice.lifetimeGuardTimer !== undefined) clearTimeout(voice.lifetimeGuardTimer);
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
    // A voice can be released twice: the bass mono-kill runs over every tracked
    // bass voice on every note-on, and updateSynthParams re-plans a pending
    // release. The second release must hold whatever the FIRST release ramp
    // left behind — never the sustain level. Anchoring a voice that has already
    // faded lifts its gain from SILENCE back to sustain in a single sample,
    // which is an audible click on every note, and one that scales with the
    // Sustain knob. `<` not `<=`: updateSynthParams re-plans a release AT its
    // own scheduled time, and that re-plan does still need the anchor.
    const alreadyFading = voice.ampReleaseAt !== undefined && voice.ampReleaseAt < now;
    // Computed up front (outside the try below) because a throw partway
    // through AudioParam scheduling must never leave the voice without a
    // teardown timer — these values are pure arithmetic and cannot throw,
    // so the `finally` block can always use them to schedule teardown.
    const filterRelease = Math.max(0.01, voice.filterRelease);
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
      const ampFallback = alreadyFading || now <= this.ctx.currentTime + 0.01
        ? Math.max(ENV_FLOOR, mainGain.gain.value)
        : Math.max(ENV_FLOOR, voice.sustainLevel);
      this.cancelAndHold(mainGain.gain, now, ampFallback);
      // cancelAndHoldAtTime inserts NO hold point when nothing is scheduled at
      // or after `now` — verified against an OfflineAudioContext render. The
      // ramp below would then start from the end of the DECAY instead of from
      // `now`, fading a held chord out across its whole length. Past the decay
      // the value is exactly the sustain level, so anchor it there; inside the
      // envelope cancelAndHold already left an exact hold point.
      if (!alreadyFading && now >= voice.ampEnvEndsAt) {
        mainGain.gain.setValueAtTime(Math.max(ENV_FLOOR, voice.sustainLevel), now);
      }
      mainGain.gain.exponentialRampToValueAtTime(SILENCE, now + Math.max(0.01, releaseTime));

      // VCF envelope release: ramp filter back to base cutoff
      this.cancelAndHold(voice.filter.frequency, now, clampCutoff(voice.filter.frequency.value));
      if (!alreadyFading && now >= voice.filterEnvEndsAt) {
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
      voice.ampReleaseAt = now;
      // Recorded on the AUDIO clock as well as armed on the wall clock:
      // rearmVoiceTeardowns() re-derives the delay from this after any resume,
      // because currentTime freezes while the context is suspended and the
      // wall-clock timer does not.
      voice.teardownAt = now + Math.max(releaseTime, filterRelease) + 0.1;
      if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
      voice.teardownTimer = setTimeout(() => this.finishVoiceTeardown(voice), teardownDelayMs);
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
  /**
   * Drops a source's voices that have NOT started sounding by `time`, and
   * leaves every voice that has alone — envelope, release tail and all.
   *
   * The seamless half of `stopSource`. A song-mode loop advance must not touch
   * what is already ringing (that is the outgoing loop's tail, and cutting it
   * is exactly the seam the user hears), but it must still drop the outgoing
   * loop's notes that the 0.1 s lookahead has already queued PAST the boundary
   * — those would sound over the incoming loop.
   */
  dropVoicesScheduledFrom(source: string, time: number): void {
    if (!this.ctx) return;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (voice.startTime >= time) this.silenceVoiceNow(voice, time);
    }
  }

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
   * Reused output buffer for reshapeableVoices. Instance-scoped so the
   * fake-context engines the test harness builds never share one, and
   * cleared-and-refilled per call rather than reallocated: this runs on
   * every updateSynthParams and every equal-power rebalance, i.e. at
   * knob-drag and note-on rate. Bounded by concurrent voice count, which the
   * voice-lifetime guard and stealOldestVoice already cap, so it never grows
   * past a small, stable size.
   */
  private readonly reshapeScratch: SynthVoice[] = [];

  /**
   * Every tracked voice of `source` (or all sources) that can be re-shaped
   * right now: it has started, and it is not already fading.
   *
   * Iterates sourceVoices, not activeVoices: activeVoices only keeps the
   * LATEST voice per note, so a still-sounding voice that a same-note retrigger
   * evicted would be skipped and left at the old level.
   *
   * Returns the shared scratch buffer, not a fresh array. Both call sites
   * consume it in one synchronous for...of and neither is re-entered from
   * inside that loop, so reuse is safe as long as no caller retains the
   * result past that loop — the readonly return type keeps it that way.
   */
  private reshapeableVoices(source?: string): readonly SynthVoice[] {
    const out = this.reshapeScratch;
    out.length = 0;
    if (!this.ctx) return out;
    const now = this.ctx.currentTime;
    if (source !== undefined) {
      this.collectReshapeable(this.sourceVoices.get(source), now, out);
    } else {
      for (const set of this.sourceVoices.values()) {
        this.collectReshapeable(set, now, out);
      }
    }
    return out;
  }

  /** Appends one source set's reshapeable voices to `out`. */
  private collectReshapeable(
    set: Set<SynthVoice> | undefined,
    now: number,
    out: SynthVoice[],
  ): void {
    if (!set) return;
    for (const voice of set) {
      // Voices scheduled ahead keep the envelopes they were planned with;
      // re-targeting them cancels their scheduled ramps, release included.
      if (voice.startTime > now) continue;
      // A voice already in its release tail keeps the ramp it was given.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt <= now) continue;
      out.push(voice);
    }
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
  private wireDrumVoice(env: GainNode, reverbSend = 0): GainNode | null {
    env.connect(this.drumBusFilter!);
    if (reverbSend <= 0 || !this.drumSendFilter) return null;
    const send = this.ctx!.createGain();
    send.gain.value = reverbSend;
    env.connect(send);
    send.connect(this.drumSendFilter);
    return send;
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
    const send = this.wireDrumVoice(env);
    osc.start(o.t);
    osc.stop(o.stopAt ?? o.t + o.decay + 0.02);
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* ignore */ }
      try { env.disconnect(); } catch { /* ignore */ }
      if (send) try { send.disconnect(); } catch { /* ignore */ }
    };
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
    const send = this.wireDrumVoice(env, o.reverbSend);
    noise.start(o.t, this.noiseStartOffset());
    noise.stop(o.t + o.decay + (o.stopPad ?? 0.01));
    noise.onended = () => {
      try { noise.disconnect(); } catch { /* ignore */ }
      try { filter.disconnect(); } catch { /* ignore */ }
      try { env.disconnect(); } catch { /* ignore */ }
      if (send) try { send.disconnect(); } catch { /* ignore */ }
    };
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
    // wakeIfIdle() marks activity for us on every reachable path — see the
    // comment in triggerSynthNoteOn.
    this.wakeIfIdle();
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

  /**
   * Analyser tapping one source layer's bus — after the VCA and tremolo,
   * before the parallel sends and the master chain. That is deliberately a
   * different picture from `getAnalyser()`, which sits post-limiter and so
   * shows the finished mix: a per-layer scope is what lets the Synth view
   * show the patch being edited rather than everything at once.
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
      this.getSourceBus(source).connect(analyser);
      this.sourceAnalysers.set(source, analyser);
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
