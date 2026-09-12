import { SynthParams, MasterEffects, FilterType } from '../types';
import { STEPS_PER_BAR } from '../utils/musicTheory';
import type { Meter } from '../utils/meter';
import { DEFAULT_VELOCITY } from './constants';
import type { DrumKit } from '@/data/drumKits';
import type { VoiceOwner } from './voiceOwner';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';
import { MasterRack } from './masterRack';
import { SynthVoices } from './synthVoices';
import { DrumSynth } from './drumSynth';
import { Clock } from './clock';
import type { EngineHooks } from './masterRack';

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
  private ctx: BaseAudioContext | null = null;
  private isInitialized = false;

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

  /**
   * The composed subsystems, built in dependency order: the master rack owns the
   * context-bound node graph the other three connect into, so it is constructed
   * first and handed to each of them.
   */
  private readonly masterRack = new MasterRack();
  private readonly synthVoices = new SynthVoices(this.masterRack, this.hooks);
  private readonly drumSynth = new DrumSynth(this.masterRack, this.hooks);
  private readonly clock = new Clock(this.masterRack, this.hooks);

  // --- delegates to the composed subsystems --------------------------------

  // MasterRack
  setMasterVolume(vol: number): void { this.masterRack.setMasterVolume(vol); }

  setReverbDecay(decay: number): void { this.masterRack.setReverbDecay(decay); }

  setSourceGain(source: string, volume: number, time?: number): void {
    this.masterRack.setSourceGain(source, volume, time);
  }

  setSourceMuted(source: string, muted: boolean, time?: number): void {
    this.masterRack.setSourceMuted(source, muted, time);
  }

  updateEffects(raw: Omit<MasterEffects, 'reverbDecay'>): void { this.masterRack.updateEffects(raw); }

  getAnalyser(): AnalyserNode | null { return this.masterRack.getAnalyser(); }

  getMasterLevelAnalyser(): AnalyserNode | null { return this.masterRack.getMasterLevelAnalyser(); }

  getSourceAnalyser(source: string): AnalyserNode | null {
    return this.masterRack.getSourceAnalyser(source);
  }

  getSourceLevelAnalyser(source: string): AnalyserNode | null {
    return this.masterRack.getSourceLevelAnalyser(source);
  }

  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void {
    this.masterRack.getByteFrequencyData(array);
  }

  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void {
    this.masterRack.getByteTimeDomainData(array);
  }

  getCompressorReduction(): number { return this.masterRack.getCompressorReduction(); }

  getLimiterReduction(): number { return this.masterRack.getLimiterReduction(); }

  // Clock
  setMetronomeEnabled(enabled: boolean): void { this.clock.setMetronomeEnabled(enabled); }

  isMetronomeEnabled(): boolean { return this.clock.isMetronomeEnabled(); }

  subscribeClock(listener: (step: number, beat: number, time: number) => void): () => void {
    return this.clock.subscribeClock(listener);
  }

  setClockBpm(bpm: number): void { this.clock.setClockBpm(bpm); }

  setMeter(meter: Meter): void { this.clock.setMeter(meter); }

  getMeter(): Meter { return this.clock.getMeter(); }

  resetClock(atTime?: number): void { this.clock.resetClock(atTime); }

  playMetronomeClick(isDownbeat = false, time?: number): void {
    this.clock.playMetronomeClick(isDownbeat, time);
  }

  // DrumSynth
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    this.drumSynth.triggerDrum(type, velocity, time);
  }

  setDrumKit(kit?: Partial<DrumKit>, kitName?: string): void {
    this.drumSynth.setDrumKit(kit, kitName);
  }

  setDrumFilter(cutoff: number, resonance: number, type: FilterType, time?: number): void {
    this.drumSynth.setDrumFilter(cutoff, resonance, type, time);
  }

  setDrumTrackGain(instrument: string, gain: number): void {
    this.drumSynth.setDrumTrackGain(instrument, gain);
  }

  __drumTrackGainValueForTests(instrument: string): number | undefined {
    return this.drumSynth.__drumTrackGainValueForTests(instrument);
  }

  __drumTrackGainCountForTests(): number { return this.drumSynth.__drumTrackGainCountForTests(); }

  // SynthVoices
  triggerSynthNoteOn(
    noteName: string,
    params: SynthParams,
    velocity = DEFAULT_VELOCITY,
    time: number | undefined,
    source: string,
    scaleFactor: number,
    owner: VoiceOwner,
  ): void {
    this.synthVoices.triggerSynthNoteOn(noteName, params, velocity, time, source, scaleFactor, owner);
  }

  triggerSynthNoteOff(noteName: string, releaseTime = 0.3, time?: number, source = 'synth', pinRelease = false): void {
    this.synthVoices.triggerSynthNoteOff(noteName, releaseTime, time, source, pinRelease);
  }

  releaseSoundingVoices(source: string, releaseTime: number, owner: VoiceOwner): void {
    this.synthVoices.releaseSoundingVoices(source, releaseTime, owner);
  }

  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    this.synthVoices.stopSource(source, releaseTime, time);
  }

  stopOwnedVoices(
    source: string,
    owner: VoiceOwner,
    releaseTime = 0.1,
    time?: number,
  ): void {
    this.synthVoices.stopOwnedVoices(source, owner, releaseTime, time);
  }

  dropVoicesScheduledFrom(source: string, time: number): void {
    this.synthVoices.dropVoicesScheduledFrom(source, time);
  }

  applySynthVelocityScale(scale: number, source: string): void {
    this.synthVoices.applySynthVelocityScale(scale, source);
  }

  updateSynthParams(params: SynthParams, source?: string): void {
    this.synthVoices.updateSynthParams(params, source);
  }

  setPresetTrim(source: string, trimGain: number): void {
    this.synthVoices.setPresetTrim(source, trimGain);
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
    const ctx = this.ctx;
    if (!ctx || 'startRendering' in ctx) return null;
    return ctx as AudioContext;
  }

  async init(): Promise<void> {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.bindSubsystems();
      this.masterRack.setupMasterChain();
      this.clock.createClickBuffers();
    }

    const ctx = this.realtimeCtx();
    if (ctx?.state === 'suspended') {
      try {
        await ctx.resume();
        this.synthVoices.rearmVoiceTeardowns();
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
   */
  bindContext(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.bindSubsystems();
    this.masterRack.setupMasterChain();
  }

  /**
   * Hands the engine's context to every subsystem at once. Each subsystem keeps
   * its OWN reference and may not read the engine's, so they are bound together —
   * from `init()` and from `bindContext()` — never one at a time.
   */
  private bindSubsystems(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.masterRack.bind(ctx);
    this.synthVoices.bind(ctx);
    this.drumSynth.bind(ctx);
    this.clock.bind(ctx);
  }

  /** Every voice still live OR still releasing, across every source. */
  private liveVoiceCount(): number {
    let count = 0;
    for (const voices of this.synthVoices.sourceVoices.values()) count += voices.size;
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
    const ctx = this.realtimeCtx();
    if (!ctx) return;
    const ok = shouldSuspendWhenIdle({
      clockListenerCount: this.clock.listenerCount(),
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
    this.synthVoices.rearmVoiceTeardowns();
    this.markActivity();
  }

  getAudioContext(): BaseAudioContext | null {
    return this.ctx;
  }

}

// Re-exported from utils/musicTheory so the grid constant has one definition
// while every `import { STEPS_PER_BAR } from '../engine'` keeps resolving.
export { STEPS_PER_BAR };

// Re-exported from drumSynth so the drum tables keep one definition while every
// `import { DRUM_ALIASES } from '../engine'` keeps resolving.
export { DRUM_ALIASES, METAL_BAND_A_HZ, METAL_BAND_B_HZ, METAL_RATIOS } from './drumSynth';

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
 * render.
 */
export function createRenderEngine(ctx: BaseAudioContext): AudioEngine {
  const engine = new AudioEngine();
  engine.bindContext(ctx);
  return engine;
}
