import { clampBpm, stepDurationSec } from '../utils/musicTheory';
import { beatIndexAt, getMeter, isBeatBoundary, DEFAULT_METER_ID, type Meter } from '../utils/meter';
import type { EngineHooks, MasterRack } from './masterRack';

/**
 * The shared 16th-note lookahead clock and the metronome click. One master grid on the
 * audio timeline that every player subscribes to, kept across stop/start and
 * re-subscription; it runs if and only if at least one player holds a subscription.
 * `listenerCount()` is the one read the engine makes of it, because idle suspend is
 * decided from that and the live voice count together.
 */
export class Clock {
  // Metronome click buffer & state
  private clickBufferHigh: AudioBuffer | null = null;
  private clickBufferLow: AudioBuffer | null = null;
  private metronomeEnabled = false;

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

  /**
   * The context `bind()` stored. `BaseAudioContext`, not `AudioContext`: an offline
   * render binds an `OfflineAudioContext`, which has every node factory this subsystem
   * uses but no `close()`. Null until `init()`/`bindContext` hands one over — which is
   * what keeps every setter here a no-op before init.
   */
  private ctx: BaseAudioContext | null = null;

  /**
   * The rack is the clock's one audio destination — the click plays into the master
   * dry path — and the hooks are how a click and a subscription arm the engine's idle
   * countdown. Neither is read through the engine.
   */
  constructor(
    private readonly masterRack: MasterRack,
    private readonly hooks: EngineHooks,
  ) {}

  /** Binds the context this subsystem builds its nodes and schedules against. */
  bind(ctx: BaseAudioContext): void {
    this.ctx = ctx;
  }

  /** How many players currently hold a clock subscription. */
  listenerCount(): number {
    return this.clockListeners.size;
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
    this.hooks.markActivity();
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
    this.hooks.markActivity();
    return () => {
      this.clockListeners.delete(listener);
      if (this.clockListeners.size === 0) {
        this.stopClockTimer();
        this.hooks.markActivity();
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
    const fallback = this.ctx.currentTime + Clock.CLOCK_REANCHOR_DELAY;
    this.clockNextStepTime =
      atTime !== undefined && atTime > this.ctx.currentTime ? atTime : fallback;
  }

  // The shared clock keeps its grid position across stop/start and
  // re-subscription, so mid-playback view re-renders (param changes, pattern
  // swaps) don't restart the grid and glitch every listener. clockTick's
  // resync branch re-anchors the schedule after idle gaps.
  private ensureClockRunning(): void {
    if (this.clockTimer) return;
    this.clockTimer = setInterval(() => this.clockTick(), Clock.CLOCK_UPDATE_MS);
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
    if (this.clockNextStepTime < this.ctx.currentTime - Clock.CLOCK_STALL_THRESHOLD) {
      this.clockNextStepTime = this.ctx.currentTime + Clock.CLOCK_REANCHOR_DELAY;
    }
    const stepDuration = stepDurationSec(this.clockBpm);
    while (this.clockNextStepTime < this.ctx.currentTime + Clock.CLOCK_LOOKAHEAD) {
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

  createClickBuffers(): void {
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
    if (!this.ctx || !this.masterRack.dryGain) return;
    const buffer = isDownbeat ? this.clickBufferHigh : this.clickBufferLow;
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = isDownbeat ? 0.6 : 0.35;

    source.connect(gain);
    gain.connect(this.masterRack.dryGain);
    const now = time ?? this.ctx.currentTime;
    source.start(now);
    source.onended = () => this.masterRack.release(source, gain);
  }
}
