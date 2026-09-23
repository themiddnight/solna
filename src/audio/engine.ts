import { type BeatVoices, MasterEffects, BeatFilterType, type TrackSendLevels } from '../types';
import { DEFAULT_METER_ID, getMeter as resolveMeter, type Meter } from '../utils/timeSignature';
import { DEFAULT_VELOCITY } from './constants';
import type { ActiveSynth } from '@/types/synth';
import type { VoiceOwner } from './voiceOwner';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';
import type { SourceBusState } from './masterRack';
import type { VoiceId } from './synth/voiceId';
import type { EngineHooks } from './masterRack';
import { audioLatencySnapshot, type AudioDiagnosticSnapshot } from './diagnostics';
import type { SourceBusApplyMode } from './automation/sourceBusAutomation';
import { AudioSession, type RenderEngineOptions } from './runtime/audioSession';
import { AudioHealthMonitor, type AudioClockEvidence, type AudioHealthSnapshot, type HealthMonitorScheduler } from './runtime/healthMonitor';
import { detectRuntimeProfile, type RuntimeEnvironment, type RuntimeProfile } from './runtime/profile';
import { runtimePolicyFor, type AudioRuntimePolicy } from './runtime/policy';

export const SESSION_CLOSE_TIMEOUT_MS = 1000;

export type AudioRecoveryResult =
  | { ok: true; generation: number }
  | { ok: false; generation: number; reason: 'construct' | 'resume' | 'build' };

function browserRuntimeEnvironment(): RuntimeEnvironment {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const standalone = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return {
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone,
  };
}

function defaultRealtimeContext(): AudioContext {
  const AudioContextClass = window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AudioContextClass();
}

function closeRealtimeContextBestEffort(context: AudioContext): void {
  try {
    void Promise.resolve(context.close()).catch(() => {});
  } catch {
    // A replacement that never became a session still must not leak a close
    // failure outside the recovery result union.
  }
}

export class AudioEngine {
  /**
   * The audio context this engine is bound to. `BaseAudioContext`, not
   * `AudioContext`: an offline render binds an `OfflineAudioContext`, which
   * implements the node factories, `currentTime`, `destination` and — like
   * every `BaseAudioContext` — `state`, `resume()` and `suspend()`. What it
   * does not have is `close()`, and `startRendering()` is the member only it
   * has. Every realtime-only path narrows back through `realtimeCtx()` below
   * rather than assuming the narrower type.
   */
  private session: AudioSession | null = null;
  private nextGeneration = 1;
  private readonly runtimePolicy: AudioRuntimePolicy;
  private readonly healthMonitor: AudioHealthMonitor;
  private readonly createRealtimeContext: () => AudioContext;
  private readonly delay: ((milliseconds: number) => Promise<void>) | null;
  private readonly now: () => number;
  private readonly isVisible: () => boolean;
  private clockSubscriberCount = 0;
  private readonly runtimeProfile: RuntimeProfile;
  private recoveryInFlight: Promise<AudioRecoveryResult> | null = null;
  private recoveryToken = 0;

  constructor(options: {
    createRealtimeContext?: () => AudioContext;
    healthScheduler?: HealthMonitorScheduler;
    runtimeEnvironment?: RuntimeEnvironment;
    now?: () => number;
    isVisible?: () => boolean;
    delay?: (milliseconds: number) => Promise<void>;
  } = {}) {
    this.createRealtimeContext = options.createRealtimeContext ?? defaultRealtimeContext;
    this.delay = options.delay ?? null;
    this.now = options.now ?? (() => performance.now());
    this.isVisible = options.isVisible ??
      (() => globalThis.document?.visibilityState !== 'hidden');
    this.runtimeProfile = detectRuntimeProfile(
      options.runtimeEnvironment ?? browserRuntimeEnvironment(),
    );
    this.runtimePolicy = runtimePolicyFor(this.runtimeProfile);
    this.healthMonitor = new AudioHealthMonitor({
      policy: this.runtimePolicy,
      getContext: () => this.realtimeCtx(),
      now: this.now,
      isVisible: this.isVisible,
      scheduler: options.healthScheduler,
    });
  }

  // Compatibility aliases for the existing subsystem test harness. These are
  // views of the current generation, never independently owned objects.
  private get masterRack() { return this.session?.masterRack ?? null; }
  private get drumSynth() { return this.session?.drumSynth ?? null; }
  private get clock() { return this.session?.clock ?? null; }
  private get synthManager() { return this.session?.synthManager ?? null; }
  private get lfoBank() { return this.session?.lfoBank ?? null; }

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * True only when THIS engine called suspend(). A context the BROWSER
   * suspended (backgrounded tab) is resumed by init()'s existing resume path,
   * and must not be resumed by a stray pointer event that only wakes idle
   * suspends.
   */
  private suspendedForIdle = false;

  /**
   * The idle-suspend seams handed to every subsystem. Declared FIRST, because a
   * later field initialiser captures it by value — and written as arrow
   * properties so the callbacks keep the ENGINE as their receiver, never a
   * subsystem.
   */
  private readonly hooks: EngineHooks = {
    markActivity: () => this.markActivity(),
    wakeIfIdle: () => this.wakeIfIdle(),
    realtimeCtx: () => this.realtimeCtx(),
  };

  // --- delegates to the composed subsystems --------------------------------

  // MasterRack
  setMasterVolume(vol: number): void { this.session?.masterRack.setMasterVolume(vol); }

  setReverbDecay(decay: number): void { this.session?.masterRack.setReverbDecay(decay); }

  setSourceGain(source: string, volume: number, time?: number): void {
    this.session?.masterRack.setSourceGain(source, volume, time);
  }

  setSourceMuted(source: string, muted: boolean, time?: number): void {
    this.session?.masterRack.setSourceMuted(source, muted, time);
  }

  setSourceState(
    source: string,
    state: SourceBusState,
    time?: number,
    mode?: SourceBusApplyMode,
  ): void {
    this.session?.masterRack.setSourceState(source, state, time, mode);
  }

  setSourceSends(
    source: string,
    sends: TrackSendLevels,
    time?: number,
    mode?: SourceBusApplyMode,
  ): void {
    this.session?.masterRack.setSourceSends(source, sends, time, mode);
  }

  updateEffects(raw: Omit<MasterEffects, 'reverbDecay'>): void { this.session?.masterRack.updateEffects(raw); }

  getAnalyser(): AnalyserNode | null { return this.session?.masterRack.getAnalyser() ?? null; }

  getMasterLevelAnalyser(): AnalyserNode | null { return this.session?.masterRack.getMasterLevelAnalyser() ?? null; }

  getSourceAnalyser(source: string): AnalyserNode | null {
    return this.session?.masterRack.getSourceAnalyser(source) ?? null;
  }

  getSourceLevelAnalyser(source: string): AnalyserNode | null {
    return this.session?.masterRack.getSourceLevelAnalyser(source) ?? null;
  }

  /** Render-only: an extra edge off a source bus's output (stems, R307). No-op before a context. */
  connectSourceStem(source: string, target: AudioNode): void {
    this.session?.masterRack.connectSourceStem(source, target);
  }

  getCompressorReduction(): number { return this.session?.masterRack.getCompressorReduction() ?? 0; }

  getLimiterReduction(): number { return this.session?.masterRack.getLimiterReduction() ?? 0; }

  // Clock
  setMetronomeEnabled(enabled: boolean): void { this.session?.clock.setMetronomeEnabled(enabled); }

  isMetronomeEnabled(): boolean { return this.session?.clock.isMetronomeEnabled() ?? false; }

  subscribeClock(listener: (step: number, beat: number, time: number) => void): () => void {
    const session = this.session;
    if (!session) return () => {};
    const unsubscribeClock = session.clock.subscribeClock(listener);
    const monitorsRealtime = session.realtimeCtx() !== null;
    if (monitorsRealtime) {
      this.clockSubscriberCount += 1;
      if (this.clockSubscriberCount === 1) this.healthMonitor.start();
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      unsubscribeClock();
      if (!monitorsRealtime) return;
      this.clockSubscriberCount = Math.max(0, this.clockSubscriberCount - 1);
      if (this.clockSubscriberCount === 0) this.healthMonitor.stop();
    };
  }

  subscribeHealth(listener: (snapshot: AudioHealthSnapshot) => void): () => void {
    return this.healthMonitor.subscribe(listener);
  }

  getRecentAudioHealthSamples(): readonly AudioClockEvidence[] {
    return this.healthMonitor.recentSamples();
  }

  /**
   * The task is store-level work (songMode's loadLoop advance), not an audio
   * setter, so it must never be dropped: with no session there is no clock
   * dispatch in progress, and it defers to a microtask exactly as the clock
   * itself does outside a dispatch.
   */
  scheduleAfterClockStep(task: () => void): void {
    const clock = this.session?.clock;
    if (clock) clock.scheduleAfterCurrentStep(task);
    else queueMicrotask(task);
  }

  /**
   * Tempo reaches TWO subsystems: the 16th grid, and every sync-rated LFO
   * generator currently running. The bank re-rates in place at `currentTime`
   * rather than on the next note, so a tempo change is heard on a held pad.
   */
  setClockBpm(bpm: number): void {
    const session = this.session;
    session?.clock.setClockBpm(bpm);
    if (session) session.lfoBank.setBpm(bpm, session.context.currentTime);
  }

  setMeter(meter: Meter): void { this.session?.clock.setMeter(meter); }

  getMeter(): Meter { return this.session?.clock.getMeter() ?? resolveMeter(DEFAULT_METER_ID); }

  resetClock(atTime?: number): void { this.session?.clock.resetClock(atTime); }

  playMetronomeClick(isDownbeat = false, time?: number): void {
    this.session?.clock.playMetronomeClick(isDownbeat, time);
  }

  // DrumSynth
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    this.session?.drumSynth.triggerDrum(type, velocity, time);
  }

  /**
   * Install a COMPLETE set of Beat voices and the patch's own measured output
   * trim, in dB. Neither argument is optional and neither is a name: the trim
   * travels inside the patch (`BeatParams.outputTrimDb`), so an edited or
   * user-saved Beat stays calibrated where a name-keyed lookup silently gave
   * it somebody else's trim — or none.
   */
  setDrumKit(voices: BeatVoices, outputTrimDb: number): void {
    this.session?.drumSynth.setDrumKit(voices, outputTrimDb);
  }

  setBeatFilter(cutoff: number, resonance: number, type: BeatFilterType, time?: number): void {
    this.session?.drumSynth.setBeatFilter(cutoff, resonance, type, time);
  }

  setDrumTrackGain(instrument: string, gain: number, time?: number): void {
    this.session?.drumSynth.setDrumTrackGain(instrument, gain, time);
  }

  __drumTrackGainValueForTests(instrument: string): number | undefined {
    return this.session?.drumSynth.__drumTrackGainValueForTests(instrument);
  }

  __drumTrackGainCountForTests(): number { return this.session?.drumSynth.__drumTrackGainCountForTests() ?? 0; }

  // SynthVoiceManager
  /**
   * Starts one logical voice at a RESOLVED FREQUENCY and hands back the
   * identity that addresses it.
   *
   * `frequency` is Hz, already resolved by the controller that scheduled this
   * note (DEV-399). The engine takes no key, scale, chord or notation
   * decision, and it never parses a note name: a name is domain vocabulary,
   * and the one place it would be read from here is a
   * `` `${source}:${noteName}` `` voice lookup — the defect `VoiceId` exists to
   * make unrepresentable.
   *
   * The return value is the whole point of this API: three players share every
   * melodic bus (the live keyboard, the arp, the melody-track sequencer), so a
   * source-and-pitch pair names as many voices as happen to be sounding and a
   * note-off resolved that way cuts whichever one it finds. A bridge keeps the
   * ID it was given and releases THAT instance.
   *
   * `null` before the AudioContext exists — the same no-op-before-init
   * contract every setter on this class follows.
   */
  triggerSynthNoteOn(
    frequency: number,
    synth: ActiveSynth,
    velocity = DEFAULT_VELOCITY,
    time: number | undefined,
    source: string,
    scaleFactor: number,
    owner: VoiceOwner,
  ): VoiceId | null {
    const session = this.session;
    if (!session) return null;
    const ctx = session.context;
    // wakeIfIdle() re-arms the idle countdown itself on every reachable path,
    // so there is no second markActivity() here. Every caller reaches this
    // choke point, MIDI input included, which has no gesture path of its own.
    this.hooks.wakeIfIdle();
    return session.synthManager.noteOn({
      source,
      owner,
      frequency,
      velocity,
      at: time ?? ctx.currentTime,
      scaleFactor,
      synth,
    });
  }

  /** Releases exactly the voice `voiceId` names. Unknown or already-released ids are a no-op. */
  triggerSynthNoteOff(voiceId: VoiceId, releaseSeconds = 0.3, time?: number): void {
    const session = this.session;
    if (!session) return;
    session.synthManager.noteOff(voiceId, time ?? session.context.currentTime, releaseSeconds);
  }

  /**
   * Releases what ONE player is holding on ONE bus, leaving every other
   * player's voices sounding — the arp's key-up. A hit that player has already
   * booked a release for is left alone, so a key-up never cancels notes the
   * clock has planned.
   */
  releaseSoundingVoices(source: string, releaseTime: number, owner: VoiceOwner): void {
    const session = this.session;
    if (!session) return;
    session.synthManager.releaseOwner(source, owner, session.context.currentTime, releaseTime);
  }

  /**
   * Silences a whole bus whatever is on it — a project install, a loop load, a
   * vibe swap. Whole-bus reach is deliberately the method with the whole-bus
   * name and can never be reached by omitting an argument to a narrower one.
   */
  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    const session = this.session;
    if (!session) return;
    session.synthManager.stopSource(source, time ?? session.context.currentTime, releaseTime);
  }

  /**
   * `stopSource` narrowed to one player: its sounding voices AND the hits it
   * has booked ahead of the transport. What a melody grid's stop needs, since
   * the grid shares its bus with live input and the arp.
   */
  stopOwnedVoices(
    source: string,
    owner: VoiceOwner,
    releaseTime = 0.1,
    time?: number,
  ): void {
    const session = this.session;
    if (!session) return;
    session.synthManager.stopOwner(source, owner, time ?? session.context.currentTime, releaseTime);
  }

  /**
   * Equal-power polyphony for ONE bus: holds its total level flat as keys are
   * added, on a gain the manager can ramp at any time rather than on the amp
   * envelope, which cannot be re-planned mid-note.
   *
   * `source` is REQUIRED, and that is a scar, not a style. It used to be
   * omittable, and omitting it re-shaped every sounding voice on every bus —
   * a keyboard press quietly ducked the chord, bass and pad layers under a
   * held note. Voices already releasing are skipped by the manager, so
   * sequenced material is never ducked by a key-down.
   */
  applySynthVelocityScale(scale: number, source: string): void {
    const session = this.session;
    if (!session) return;
    session.synthManager.setPolyphonyScale(source, scale, session.context.currentTime);
  }

  dropVoicesScheduledFrom(source: string, time: number): void {
    this.session?.synthManager.dropScheduledFrom(source, time);
  }

  /**
   * Pushes a patch change to every voice sounding on one bus. Only the
   * continuous controls move; envelope timing and unison count take effect on
   * the next note, and a change of voice MODE releases the bus instead.
   */
  updateSynthPatch(previous: ActiveSynth, next: ActiveSynth, source: string): void {
    const session = this.session;
    if (!session) return;
    session.synthManager.updatePatch(source, previous, next, session.context.currentTime);
  }

  /**
   * The bound context, narrowed to a realtime one, or null.
   *
   * This is the ONE place the widened field is narrowed back.
   *
   * The test is `startRendering`, not `resume` or `state`: in the Web Audio
   * spec `state`, `resume()` and `suspend()` are all on `BaseAudioContext` and
   * on `OfflineAudioContext` — only `close()` and `startRendering()` are not
   * shared — so an offline render context PASSES a `'resume' in ctx` check and
   * would then arm the idle timer and reach an argument-less `suspend()` that
   * `OfflineAudioContext` rejects with "1 argument required, but only 0
   * present". `startRendering()` is the offline-only member, so its presence is
   * what answers the question this method actually asks.
   *
   * Duck-typed rather than `instanceof AudioContext`: that global does not
   * exist under `bun test`. `src/audio/testFakes.ts`'s fake context implements
   * neither member, which keeps it on the realtime side — deliberately, because
   * the engine suite's idle-suspend tests drive resume()/suspend() through it.
   */
  private realtimeCtx(): AudioContext | null {
    return this.session?.realtimeCtx() ?? null;
  }

  async init(): Promise<void> {
    if (!this.session) {
      this.invalidatePendingRecovery();
      const ctx = this.createRealtimeContext();
      this.session = AudioSession.create(ctx, {
        ...this.hooks,
        generation: this.nextGeneration++,
      });
      this.healthMonitor.resetGeneration(this.session.generation);
    }

    const ctx = this.realtimeCtx();
    if (ctx?.state === 'suspended') {
      try {
        await ctx.resume();
        this.session?.synthManager.rearmTeardowns();
        // This resume already happened, whoever it was for — a stale true
        // here would make the next wakeIfIdle() redundantly resume() and
        // sweep every voice's teardown again for nothing.
        this.suspendedForIdle = false;
      } catch {
        // browser autoplay policy requires user gesture
      }
    }
    this.markActivity();
  }

  /**
   * Binds an already-constructed context and builds the master chain on it.
   *
   * The seam an offline render comes through: `init()` creates a realtime
   * context and is untouched, while a render engine binds the caller's
   * `OfflineAudioContext` with this. Public rather than private because the
   * module-level `createRenderEngine` is not a member of the class, and
   * `setupMasterChain` stays private — this is the one door to it.
   *
   * A render engine is never stored in the singleton, never reaches
   * engineSync.ts, and never outlives its `startRendering()` call.
   * `options` is render-only; omitted = today's graph (R309).
   */
  bindContext(ctx: BaseAudioContext, options: RenderEngineOptions = {}): void {
    this.invalidatePendingRecovery();
    const previous = this.session;
    this.session = AudioSession.create(
      ctx,
      { ...this.hooks, generation: this.nextGeneration++ },
      undefined,
      options,
    );
    this.healthMonitor.resetGeneration(this.session.generation);
    if (previous) void previous.dispose();
  }

  private invalidatePendingRecovery(): void {
    this.recoveryToken += 1;
    this.recoveryInFlight = null;
  }

  getRuntimeProfile(): RuntimeProfile {
    return { ...this.runtimeProfile };
  }

  recreateRealtimeSession(): Promise<AudioRecoveryResult> {
    if (this.recoveryInFlight) return this.recoveryInFlight;
    const token = ++this.recoveryToken;
    const recovery = this.performRealtimeRecreation(token);
    this.recoveryInFlight = recovery;
    void recovery.finally(() => {
      if (this.recoveryToken === token) this.recoveryInFlight = null;
    });
    return recovery;
  }

  private async performRealtimeRecreation(token: number): Promise<AudioRecoveryResult> {
    const oldSession = this.session;
    const generation = this.nextGeneration++;

    // All three calls below happen in the initiating gesture turn, before the
    // first await: close old, construct replacement, then request resume.
    let oldDisposal: Promise<void>;
    try {
      oldDisposal = (oldSession?.dispose() ?? Promise.resolve()).catch(() => {});
    } catch {
      oldDisposal = Promise.resolve();
    }
    let replacementContext: AudioContext;
    try {
      replacementContext = this.createRealtimeContext();
    } catch {
      return { ok: false, generation, reason: 'construct' };
    }

    let resumed: Promise<void>;
    try {
      resumed = Promise.resolve(replacementContext.resume());
    } catch {
      closeRealtimeContextBestEffort(replacementContext);
      return { ok: false, generation, reason: 'resume' };
    }

    try {
      await resumed;
    } catch {
      closeRealtimeContextBestEffort(replacementContext);
      return { ok: false, generation, reason: 'resume' };
    }
    if (this.recoveryToken !== token) {
      closeRealtimeContextBestEffort(replacementContext);
      return { ok: false, generation, reason: 'build' };
    }

    let replacement: AudioSession;
    try {
      replacement = AudioSession.create(replacementContext, {
        ...this.hooks,
        generation,
      });
    } catch {
      closeRealtimeContextBestEffort(replacementContext);
      return { ok: false, generation, reason: 'build' };
    }
    if (this.recoveryToken !== token) {
      void replacement.dispose();
      return { ok: false, generation, reason: 'build' };
    }

    this.session = replacement;
    this.suspendedForIdle = false;
    this.healthMonitor.resetGeneration(generation);
    await this.waitForOldDisposal(oldDisposal);
    return { ok: true, generation };
  }

  private async waitForOldDisposal(disposal: Promise<void>): Promise<void> {
    if (this.delay) {
      await Promise.race([disposal, this.delay(SESSION_CLOSE_TIMEOUT_MS)]).catch(() => {});
      return;
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, SESSION_CLOSE_TIMEOUT_MS);
      void disposal.finally(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async validateRealtimeClock(): Promise<boolean> {
    const session = this.session;
    const ctx = session?.realtimeCtx() ?? null;
    if (!session || !ctx || ctx.state !== 'running' || !this.isVisible()) return false;
    const wallStart = this.now();
    const audioStart = ctx.currentTime;
    try {
      if (this.delay) await this.delay(this.runtimePolicy.sampleIntervalMs);
      else await new Promise<void>((resolve) => setTimeout(resolve, this.runtimePolicy.sampleIntervalMs));
    } catch {
      return false;
    }
    if (this.session?.generation !== session.generation) return false;
    if (ctx.state !== 'running' || !this.isVisible()) return false;
    const wallElapsedMs = this.now() - wallStart;
    const audioElapsedSec = ctx.currentTime - audioStart;
    if (wallElapsedMs <= 0 || wallElapsedMs > this.runtimePolicy.maxWallGapMs) return false;
    const ratio = audioElapsedSec / (wallElapsedMs / 1000);
    return Number.isFinite(ratio) &&
      ratio >= this.runtimePolicy.minClockRatio &&
      ratio <= this.runtimePolicy.maxClockRatio;
  }

  /**
   * Every voice still live OR still releasing, across every source.
   *
   * Read off the voice manager, which owns allocation now. Load-bearing for
   * idle suspend: a context suspended while a release tail is still in the air
   * freezes that tail rather than finishing it.
   */
  liveVoiceCount(): number {
    return this.session?.synthManager.liveVoiceCount() ?? 0;
  }

  /** A read-only view of audio health for the opt-in local diagnostics recorder. */
  getDiagnosticSnapshot(): AudioDiagnosticSnapshot {
    const session = this.session;
    const ctx = session?.context ?? null;
    const latency = audioLatencySnapshot(ctx);
    return {
      contextState: ctx?.state ?? 'uninitialized',
      currentTimeSec: ctx?.currentTime ?? null,
      ...latency,
      clock: session?.clock.diagnosticSnapshot() ?? {
        listeners: 0,
        dispatches: 0,
        stalls: 0,
        maxStallMs: 0,
      },
      voices: session?.synthManager.diagnosticSnapshot() ?? {
        groups: 0,
        physicalVoices: 0,
        registered: 0,
        bySource: {},
      },
      health: this.healthMonitor.snapshot(),
    };
  }

  /**
   * Restart the idle countdown. Called from every path that produces sound or
   * takes the clock — so the timer only ever reaches zero after genuinely
   * nothing has happened for IDLE_SUSPEND_MS.
   */
  private markActivity(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.session) return;
    this.idleTimer = setTimeout(() => this.maybeSuspendNow(), IDLE_SUSPEND_MS);
  }

  /** Suspend if and only if shouldSuspendWhenIdle agrees. */
  private maybeSuspendNow(): void {
    const ctx = this.realtimeCtx();
    if (!ctx) return;
    const ok = shouldSuspendWhenIdle({
      clockListenerCount: this.session?.clock.listenerCount() ?? 0,
      liveVoiceCount: this.liveVoiceCount(),
      contextState: ctx.state,
    });
    if (!ok) {
      // Something is still running: re-arm rather than giving up for the
      // session, or a single note during the window would disable idle
      // suspend until the next init().
      this.markActivity();
      return;
    }
    try {
      const suspending = Promise.resolve(ctx.suspend());
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
    // An offline render engine has no idle lifecycle. There is nothing to
    // resume, the wall clock plays no part in a render, and arming
    // markActivity's setTimeout here would keep a `bun test` process alive
    // for IDLE_SUSPEND_MS after every render test. triggerDrum and
    // triggerSynthNoteOn both reach this on every event, so the guard is on
    // the hot path for renders, not a rare branch.
    const ctx = this.realtimeCtx();
    if (!ctx) return;
    if (!this.suspendedForIdle) {
      // Nothing of ours to resume, but the gesture is still activity: without
      // this, an ordinary click on a context that was never idle-suspended
      // cleared the countdown and never restarted it, leaving idle suspend
      // disarmed until the next note, clock tick or metronome event.
      this.markActivity();
      return;
    }
    void Promise.resolve(ctx.resume())
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
    this.session?.synthManager.rearmTeardowns();
    this.markActivity();
  }

  getAudioContext(): BaseAudioContext | null {
    return this.session?.context ?? null;
  }

}

// Re-exported from drumSynth so the drum tables keep one definition while every
// `import { DRUM_ALIASES } from '../engine'` keeps resolving.
export { DRUM_ALIASES, METAL_BAND_B_HZ, METAL_RATIOS } from './drumSynth';

export const audioEngine = new AudioEngine();

/**
 * A throwaway engine bound to a caller-supplied context, for offline renders.
 *
 * Replaces the `makeEngine() as any; engine.ctx = ctx; engine.setupMasterChain()`
 * dance scripts/calibration/renderOffline.ts used to perform — the same three
 * steps, through a supported door instead of a cast.
 *
 * The singleton above is deliberately NOT involved: a render must not disturb
 * the session's engine, and the session's engine must not be audible in the
 * render. `options.masterOutput` detaches the master for a stems render; the
 * mixdown passes none.
 */
export function createRenderEngine(ctx: BaseAudioContext, options?: RenderEngineOptions): AudioEngine {
  const engine = new AudioEngine();
  engine.bindContext(ctx, options);
  return engine;
}
