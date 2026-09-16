import { type BeatVoices, MasterEffects, FilterType } from '../types';
import { noteFrequency, STEPS_PER_BAR } from '../utils/musicTheory';
import type { Meter } from '../utils/meter';
import { DEFAULT_VELOCITY } from './constants';
import type { ActiveSynth } from '@/types/synth';
import type { VoiceOwner } from './voiceOwner';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';
import { MasterRack } from './masterRack';
import { DrumSynth } from './drumSynth';
import { Clock } from './clock';
import { SynthVoiceManager } from './synth/voiceManager';
import { SynthLfoBank } from './synth/synthLfo';
import type { VoiceId } from './synth/voiceId';
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
  private readonly drumSynth = new DrumSynth(this.masterRack, this.hooks);
  private readonly clock = new Clock(this.masterRack, this.hooks);

  /**
   * The synth, and the LFO bank its voices join. Both are context-bound and
   * therefore null until `init()` or `bindContext()` — the same "setters
   * no-op before the first user click" contract every other engine method
   * follows, which is why `triggerSynthNoteOn` returns `null` rather than
   * throwing.
   */
  private synthManager: SynthVoiceManager | null = null;
  private lfoBank: SynthLfoBank | null = null;
  /** The clock subscription that phase-locks transport LFOs; dropped on rebind. */
  private stopTransportOriginSync: (() => void) | null = null;

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

  scheduleAfterClockStep(task: () => void): void { this.clock.scheduleAfterCurrentStep(task); }

  /**
   * Tempo reaches TWO subsystems: the 16th grid, and every sync-rated LFO
   * generator currently running. The bank re-rates in place at `currentTime`
   * rather than on the next note, so a tempo change is heard on a held pad.
   */
  setClockBpm(bpm: number): void {
    this.clock.setClockBpm(bpm);
    if (this.ctx) this.lfoBank?.setBpm(bpm, this.ctx.currentTime);
  }

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

  /**
   * Install a COMPLETE set of Beat voices and the patch's own measured output
   * trim, in dB. Neither argument is optional and neither is a name: the trim
   * travels inside the patch (`BeatParams.outputTrimDb`), so an edited or
   * user-saved Beat stays calibrated where a name-keyed lookup silently gave
   * it somebody else's trim — or none.
   */
  setDrumKit(voices: BeatVoices, outputTrimDb: number): void {
    this.drumSynth.setDrumKit(voices, outputTrimDb);
  }

  setBeatFilter(cutoff: number, resonance: number, type: FilterType, time?: number): void {
    this.drumSynth.setBeatFilter(cutoff, resonance, type, time);
  }

  setDrumTrackGain(instrument: string, gain: number, time?: number): void {
    this.drumSynth.setDrumTrackGain(instrument, gain, time);
  }

  __drumTrackGainValueForTests(instrument: string): number | undefined {
    return this.drumSynth.__drumTrackGainValueForTests(instrument);
  }

  __drumTrackGainCountForTests(): number { return this.drumSynth.__drumTrackGainCountForTests(); }

  // SynthVoiceManager
  /**
   * Starts one logical voice and hands back the identity that addresses it.
   *
   * The return value is the whole point of this API: three players share every
   * melodic bus (the live keyboard, the arp, the melody-track sequencer), so a
   * `` `${source}:${noteName}` `` lookup names as many voices as happen to be
   * sounding that note and a note-off resolved that way cuts whichever one it
   * finds. A bridge keeps the ID it was given and releases THAT instance.
   *
   * `null` before the AudioContext exists — the same no-op-before-init
   * contract every setter on this class follows.
   */
  triggerSynthNoteOn(
    noteName: string,
    synth: ActiveSynth,
    velocity = DEFAULT_VELOCITY,
    time: number | undefined,
    source: string,
    scaleFactor: number,
    owner: VoiceOwner,
  ): VoiceId | null {
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return null;
    // wakeIfIdle() re-arms the idle countdown itself on every reachable path,
    // so there is no second markActivity() here. Every caller reaches this
    // choke point, MIDI input included, which has no gesture path of its own.
    this.hooks.wakeIfIdle();
    return this.synthManager.noteOn({
      source,
      owner,
      // DEV-399, stage 1: resolved ONCE here rather than once per unison voice
      // inside the voice itself. Task 2 moves this out to the callers and this
      // import goes with it.
      frequency: noteFrequency(noteName),
      velocity,
      at: time ?? ctx.currentTime,
      scaleFactor,
      synth,
    });
  }

  /** Releases exactly the voice `voiceId` names. Unknown or already-released ids are a no-op. */
  triggerSynthNoteOff(voiceId: VoiceId, releaseSeconds = 0.3, time?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return;
    this.synthManager.noteOff(voiceId, time ?? ctx.currentTime, releaseSeconds);
  }

  /**
   * Releases what ONE player is holding on ONE bus, leaving every other
   * player's voices sounding — the arp's key-up. A hit that player has already
   * booked a release for is left alone, so a key-up never cancels notes the
   * clock has planned.
   */
  releaseSoundingVoices(source: string, releaseTime: number, owner: VoiceOwner): void {
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return;
    this.synthManager.releaseOwner(source, owner, ctx.currentTime, releaseTime);
  }

  /**
   * Silences a whole bus whatever is on it — a project install, a loop load, a
   * vibe swap. Whole-bus reach is deliberately the method with the whole-bus
   * name and can never be reached by omitting an argument to a narrower one.
   */
  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return;
    this.synthManager.stopSource(source, time ?? ctx.currentTime, releaseTime);
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
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return;
    this.synthManager.stopOwner(source, owner, time ?? ctx.currentTime, releaseTime);
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
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return;
    this.synthManager.setPolyphonyScale(source, scale, ctx.currentTime);
  }

  dropVoicesScheduledFrom(source: string, time: number): void {
    this.synthManager?.dropScheduledFrom(source, time);
  }

  /**
   * Pushes a patch change to every voice sounding on one bus. Only the
   * continuous controls move; envelope timing and unison count take effect on
   * the next note, and a change of voice MODE releases the bus instead.
   */
  updateSynthPatch(previous: ActiveSynth, next: ActiveSynth, source: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return;
    this.synthManager.updatePatch(source, previous, next, ctx.currentTime);
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
        this.synthManager?.rearmTeardowns();
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
    this.drumSynth.bind(ctx);
    this.clock.bind(ctx);
    this.bindSynth(ctx);
  }

  /**
   * Builds the synth and its LFO bank on `ctx`, and wires the one edge Task 5
   * deliberately left open: the clock's transport origin.
   *
   * A transport-triggered LFO is ONE phase-locked generator per bus, and the
   * instant it locks to has to be the instant the grid anchors step 0 to —
   * `Clock.resetClock` publishes exactly that resolved time, never a separate
   * read of `currentTime`, so the LFO and the grid cannot drift apart by the
   * width of a re-anchor.
   *
   * Idempotent across a rebind: the previous subscription is dropped first, or
   * a re-bound engine would hold a listener writing into a bank whose context
   * is gone.
   */
  private bindSynth(ctx: BaseAudioContext): void {
    this.stopTransportOriginSync?.();
    const lfoBank = new SynthLfoBank(ctx);
    this.lfoBank = lfoBank;
    this.synthManager = new SynthVoiceManager({
      ctx,
      // Null until the master chain exists, which is what makes a note-on
      // before the first user click a no-op rather than a throw:
      // getSourceTap() raises without dryGain.
      destinationsFor: (source) =>
        this.masterRack.dryGain ? { output: this.masterRack.getSourceTap(source) } : null,
      lfoBank,
    });
    this.stopTransportOriginSync = this.clock.subscribeTransportOrigin((time) => {
      lfoBank.setTransportOrigin(time);
    });
  }

  /**
   * Every voice still live OR still releasing, across every source.
   *
   * Read off the voice manager, which owns allocation now. Load-bearing for
   * idle suspend: a context suspended while a release tail is still in the air
   * freezes that tail rather than finishing it.
   */
  liveVoiceCount(): number {
    return this.synthManager?.liveVoiceCount() ?? 0;
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
    this.synthManager?.rearmTeardowns();
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
 * render.
 */
export function createRenderEngine(ctx: BaseAudioContext): AudioEngine {
  const engine = new AudioEngine();
  engine.bindContext(ctx);
  return engine;
}
