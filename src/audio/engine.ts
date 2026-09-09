import { SynthParams, MasterEffects, FilterType } from '../types';
import { noteFrequency, clampBpm, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import { MAX_FADER_GAIN } from '../utils/gainUnits';
import {
  beatIndexAt,
  getMeter,
  isBeatBoundary,
  DEFAULT_METER_ID,
  type Meter,
} from '../utils/meter';
import { DEFAULT_VELOCITY, ENV_FLOOR, SILENCE, clampCutoff, clampVelocity } from './constants';
import { random } from './rng';
import { mergeDrumKit } from './drumKits';
import type { DrumKit, DrumType, HatParams, SnareParams } from '@/data/drumKits';
import { DRUM_TYPES } from '@/data/drumKits';
import { clampEffects, clampEffectValue } from './effectLimits';
import { IMPULSE_CACHE_SAMPLE_BUDGET, impulseSampleCount, keysToEvict } from './impulseBudget';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';
import { NEUTRAL_TRIM_GAIN, drumTrimGainFor, synthTrimGainFor } from './trims';

interface SynthVoice {
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
}

/**
 * The TR-808's six inharmonically tuned square oscillators, expressed as
 * ratios of the lowest (205.3 Hz on a real unit). Source:
 * docs/research/2026-09-06-drum-synthesis-hats-and-cymbals.md §1.2.
 * The published design rule is "avoid even multiples": simple ratios sound
 * pitched, not metallic. Never round these toward whole numbers.
 */
export const METAL_RATIOS = [1, 1.483, 1.8, 2.546, 2.63, 3.897] as const;

/**
 * The 808's two parallel band centres, each with its own VCA (§1.2). Exported
 * so a module-scope `const` is not "assigned a value but never used" —
 * `metallicBurst` takes `bandA.freq`/`bandB.freq` as caller-supplied
 * parameters and does not reference these directly, so leaving them
 * unexported is two eslint errors, not a warning, and fails the `verify` gate.
 */
export const METAL_BAND_A_HZ = 7100;
export const METAL_BAND_B_HZ = 3440;

/** The 808's own bank fundamental; hats keep it so `filter` stays the kit axis. */
const METAL_TONE_HAT = 205.3;
/** A larger plate rings lower: §2.5 gives 150–205 Hz for the cymbal. */
const METAL_TONE_CRASH = 165;

const RIDE_PING_Q = 4;      // §2.3 gives Q 3-5 for the defined stick attack
const RIDE_WASH_Q = 0.7;    // §2.3: the wash band is deliberately wide
const RIDE_BODY_Q = 4;      // the 300-600 Hz body band
const RIDE_BODY_LEVEL = 0.2;
const RIDE_WASH_ATTACK = 0.012;  // 8-15 ms bloom
const BELL_Q = 4.8;         // derived from the 808 cowbell's -3 dB points, 794/977 Hz

/**
 * Names callers use that map onto one of the 11 authored drum types. Exported
 * so a test can prove every target is real.
 */
export const DRUM_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  closedhat: 'hihat',
});

/**
 * The four voices dispatched ahead of `triggerDrum`'s switch, not inside it —
 * see that call site's comment for why. The union is the roster and the `Set`
 * is built from it, so a name that is in one and not the other does not
 * compile; `triggerNonSwitchVoice` takes that same union, so a voice can only
 * be listed here once a branch actually handles it.
 *
 * A `Set` also has no prototype chain to fall through: `has('__proto__')` is
 * plainly `false`, where the object map this replaced needed
 * `Object.create(null)` (as `DRUM_ALIASES` still does) to stop
 * `triggerDrum('__proto__', …)` resolving `Object.prototype.__proto__` and
 * throwing inside a method `clockTick` calls on every scheduled step.
 * Hoisted to module scope so it is built once, not per hit.
 */
type NonSwitchVoice = 'hitom' | 'lowtom' | 'ride' | 'bell';
const NON_SWITCH_VOICES: ReadonlySet<string> = new Set<NonSwitchVoice>([
  'hitom', 'lowtom', 'ride', 'bell',
]);
const isNonSwitchVoice = (name: string): name is NonSwitchVoice => NON_SWITCH_VOICES.has(name);

/**
 * The one choke group (spec decision 9): hi-hats, and only hi-hats. A hi-hat is
 * one physical instrument and the closure IS the damping, so a new hat cuts any
 * sounding hat. `ride`, `crash` and `bell` are in NO group — real crashes ring
 * through each other, and a ride struck in time-keeping must overlap itself, so
 * a mono ride would cut every quarter-note ping and destroy the wash.
 *
 * The release belongs to the NEW hit: 20 ms when a closed hat cuts, because
 * nothing loud follows to mask it; 8 ms when an open hat cuts, because its own
 * strike does the masking. Below ~15 ms a gain change clicks
 * (hats-and-cymbals.md §4.2).
 */
const HIHAT_CHOKE_RELEASE = 0.02;
const OPENHAT_CHOKE_RELEASE = 0.008;

/**
 * The hats' highpass resonance. A highpass at Q 4-6 has a resonant bump at the
 * corner, which is the cheapest available approximation of a partial over white
 * noise — hats-and-cymbals.md §5.1 ranks it the highest value-per-line change
 * in that document. 5 is the middle of that band.
 *
 * Hardcoded on purpose (ruling R7): it is one number until a later slice has a
 * reason to make it thirteen. The crash (0.8) and the clap (1.5) keep their own
 * authored values at their call sites.
 */
const HAT_Q = 5;

/**
 * One sounding hat, as the choke group needs to see it.
 *
 * `envs` and `sources` are ARRAYS from the first commit even though slice 3
 * only ever puts one of each in them, and that is deliberate: slice 4 puts the
 * hats on a metallic oscillator bank, so a single hat hit will sound through
 * TWO envelopes — the noise burst's and the bank's — over a noise source and
 * six oscillators. A choke that reached only the first of them would half-work,
 * leave the bank ringing, and give no clue why. Plural before it needs to be is
 * the cheaper half of that trade.
 *
 * `peaks` is parallel to `envs`: the peak gain each envelope was scheduled to
 * hit. It is an UPPER BOUND on the envelope's true value at the choke moment,
 * never the exact value (the true value is somewhere between the peak and the
 * floor, wherever the decay curve has reached) — and that is exactly what
 * makes it a safe `cancelAndHold` fallback: a ramp that starts at-or-above the
 * true value can only ever fall, never re-swell. It exists because
 * `cancelAndHold`'s own fallback, `param.value`, is wrong whenever `now` is in
 * the future — which a sequenced hit always is (`CLOCK_LOOKAHEAD` schedules
 * ~100 ms ahead) — because a real `AudioParam.value` read before the audio
 * clock reaches a scheduled event still reports the node's untouched default
 * (1.0 for a `GainNode`), not the peak the envelope was scheduled to reach.
 *
 * `startAt` is the voice's own scheduled start time, and is what lets
 * `chokeHats` tell "queued but not yet sounding" apart from "sounding": a
 * voice with `startAt` after the new hit's time has not begun yet and must be
 * left alone rather than stopped before it starts.
 */
interface SoundingHat {
  envs: GainNode[];
  peaks: number[];
  sources: AudioScheduledSourceNode[];
  startAt: number;
  stopAt: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

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
  /**
   * instrument -> its persistent track fader, created lazily on first use and
   * cleared with sourceBuses. A GainNode, not a velocity multiplier: a
   * velocity is a per-hit performance attribute, and the 0..1 rule governs
   * the INPUT parameter, not whatever a caller derives from the clamped
   * result — see `hitLevel` in `triggerDrum`. A fader routed through it
   * could not express the +12 dB the range promises, and it could not move
   * an already-sounding tail.
   */
  private drumTrackGains = new Map<string, GainNode>();

  /** Seed levels, kept even before the AudioContext exists so the setter
   *  no-ops safely like every other and applyEngineSnapshot re-applies. */
  private drumTrackLevels = new Map<string, number>();

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

  // Metronome click buffer & state
  private clickBufferHigh: AudioBuffer | null = null;
  private clickBufferLow: AudioBuffer | null = null;
  private metronomeEnabled = false;
  private noiseBuffer: AudioBuffer | null = null;

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

  /**
   * The calibration trim for the CURRENT kit, as a single linear gain — per KIT,
   * not per voice, because a drum kit's voices are not independent (see the
   * comment on `DRUM_TRIMS` in src/data/trimTable.ts). Resolved once in
   * setDrumKit, read once per hit. NEUTRAL_TRIM_GAIN until a kit name arrives or
   * the kit has no committed entry — which is why no existing engine test's
   * absolute peak assertion moves.
   */
  private drumTrimGain: number = NEUTRAL_TRIM_GAIN;

  /**
   * A per-source OVERRIDE of the derived synth trim, as a linear gain, and the
   * only reason this map still exists.
   *
   * The trim itself is no longer pushed: `triggerSynthNoteOn` derives it from
   * `params.preset`, which every caller already holds at the line that reads
   * it, so a source can no longer carry a trim that disagrees with the patch it
   * is playing. That used to be pushed from eleven call sites — four in
   * `applySliceState`, one per synth-params subscription, and three in
   * `presetPreview` purely because all three preview functions share one
   * PREVIEW_SOURCE and a persistent map would otherwise hand an audition the
   * PREVIOUS audition's trim. None of those exist any more, and the staleness
   * they defended against is structurally impossible rather than merely
   * defended: there is no window in which the map and `params.preset` can
   * disagree, because the trim is computed from `params.preset` itself.
   *
   * What remains is the offline calibration harness
   * (`scripts/calibration/renderOffline.ts`), which is the one caller that
   * legitimately needs a trim OTHER than the derived one: it renders each
   * preset UNTRIMMED to measure the level the trim table is then computed
   * from, and a derivation it cannot switch off would make that measurement
   * circular. It sets the override on its own `'calibration'` source. Nothing
   * in the app writes this map, so an entry is only ever the harness saying
   * "ignore the table for this render".
   */
  private presetTrims = new Map<string, number>();

  /**
   * Hat voices that are still sounding, keyed by voice name — so only `hihat`
   * and `openhat` are ever held. The value is a LIST because a live hit and a
   * hit the sequencer has already queued can overlap under one name; see
   * `registerHatVoice` for why replacing instead of appending loses the queued
   * one. Entries are pruned there, so a list holds the one or two voices that
   * can actually be sounding at once.
   *
   * An INSTANCE field, not a module-scope map: testFakes' makeEngine() builds a
   * fresh engine per test against a fresh fake context whose currentTime is
   * always 10, so a shared map would let one test's "sounding" hat be choked by
   * the next test's first hat, on nodes belonging to a dead context.
   */
  private readonly soundingHats = new Map<string, SoundingHat[]>();

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
    source.onended = () => this.release(source, gain);
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

    // Derived here, not pushed ahead of time: `params` is in hand and
    // `params.preset` is the exact key `synthTrimGainFor` wants, so the trim is
    // a pure function of the note being played rather than per-source state a
    // caller had to remember to refresh. `presetTrims` is consulted only as an
    // explicit override and is empty in the app — see that field's docblock.
    const trim = this.presetTrims.get(source) ?? synthTrimGainFor(params.preset);
    const peakGain = velocity * 0.4 * scaleFactor * trim;
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

    // Route through the per-source tap, and from there the bus (both lazily
    // created), to dry/effects. The tap is unity and exists only so a scope
    // can read this layer before its fader — see sourceTaps.
    tremoloGain.connect(this.getSourceTap(source));

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

  /**
   * When a release of `releaseTime` starting at `now` would leave this voice
   * ready to tear down: past the AMP release ramp, plus a slop. The single
   * definition both releaseVoice (which plans it) and stopSource (which
   * compares against a voice's existing plan) read.
   *
   * The amp ramp alone, deliberately — this used to wait for the longer of the
   * amp and filter tails. Past the amp ramp the voice sits at SILENCE, so the
   * filter tail is inaudible and only the polyphony slot is still held: the
   * factory presets ship filterRelease around 0.5 s against a 0.05 s preview
   * stop, which kept ten times more dead voices alive than there was sound to
   * justify and put a fast-clicked preview over maxVoicesPerSource.
   */
  private plannedTeardownAt(releaseTime: number, now: number): number {
    return now + Math.max(0.01, releaseTime) + 0.1;
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
    const teardownAt = this.plannedTeardownAt(releaseTime, now);
    const teardownDelayMs =
      (teardownAt - now + Math.max(0, now - this.ctx.currentTime)) * 1000;

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
      voice.teardownAt = teardownAt;
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
      // A voice already fading toward a teardown no later than the one this
      // stop would plan is already stopping, so re-releasing it changes
      // nothing audible — but releaseVoice re-arms its teardown timer, and a
      // held preview stops its source on every press AND release. Clicking
      // faster than the tail is long therefore kept every dead voice in
      // sourceVoices indefinitely; past maxVoicesPerSource, stealOldestVoice
      // can only steal voices with no release planned — the notes of the
      // chord being pressed right now — so the preview collapsed to its last
      // note and stayed there. A SHORTER stop still falls through and cuts
      // the tail, which is what makes this a skip and not a blanket guard.
      if (
        voice.releaseScheduledAt !== undefined
        && voice.teardownAt !== undefined
        && voice.teardownAt <= this.plannedTeardownAt(releaseTime, now)
      ) continue;
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

  // The pre-fader entry point for a source. Unity, one output (the bus), never
  // touched by setSourceGain/setSourceMuted — those stay on the bus, so mute
  // and fader keep working exactly as before while the tap keeps carrying the
  // patch's own level for the scope to read.
  private getSourceTap(source: string): GainNode {
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
    // Derived from the fader range (MAX_FADER_GAIN is dbToGain(FADER_MAX_DB)),
    // not an independent literal. It used to be 1.5 — +3.5 dB — so a fader
    // that displayed +12 dB stopped responding two-thirds of the way up.
    bus.gain.setTargetAtTime(isMuted ? 0 : Math.max(0, Math.min(MAX_FADER_GAIN, volume)), now, 0.01);
  }

  /**
   * Overrides the derived preset trim for one source, as a LINEAR gain.
   *
   * CALIBRATION HARNESS ONLY. `triggerSynthNoteOn` derives the trim from
   * `params.preset` on its own; the app never calls this, and adding a call
   * from `engineSync` or `presetPreview` would re-create the eleven-call-site
   * push this replaced. The harness needs it because its untrimmed render pass
   * must measure a preset with the table switched OFF (`setPresetTrim(…, 1)`),
   * which no derivation can express. See `presetTrims`.
   */
  setPresetTrim(source: string, trimGain: number): void {
    this.presetTrims.set(source, trimGain);
  }

  private drumTrackGain(instrument: string): GainNode | null {
    if (!this.ctx || !this.drumBusFilter) return null;
    let node = this.drumTrackGains.get(instrument);
    if (!node) {
      node = this.ctx.createGain();
      node.gain.value = this.drumTrackLevels.get(instrument) ?? 1;
      node.connect(this.drumBusFilter);
      this.drumTrackGains.set(instrument, node);
    }
    return node;
  }

  /**
   * Per-track drum level, LINEAR — the store holds it in dB and engineSync
   * converts, exactly like setSourceGain. New setter; no existing signature
   * moved for DEV-386. Ramped, not stepped, for the same click-free reason
   * setSourceGain ramps.
   *
   * Unknown instrument names are IGNORED, deliberately (decision, DEV-386
   * fix round 1): a name outside DRUM_TYPES will never be resolved by
   * triggerDrum's dispatch, so no voice will ever route through a node built
   * for it. Minting one anyway — the earlier behaviour — allocates a GainNode
   * wired to drumBusFilter that lives forever with nothing feeding it, for
   * every typo'd or future non-drum sequencer track instrument. Silently
   * dropping the write (not throwing) matches every other engine setter's
   * fail-safe posture.
   *
   * Keyed by INSTRUMENT, not by trigger source — wireDrumVoice inserts the
   * same node for every path that ends up calling triggerDrum for that
   * voice. A sequencer track's fader therefore also attenuates that
   * instrument's drum-pad hits and any live MIDI trigger for it, not only
   * its own sequencer steps. That is how a channel fader behaves in a real
   * mixer (one fader per strip, not one per source), so it is left as is —
   * but it is easy to miss reading only the sequencer call site, hence this
   * note.
   */
  setDrumTrackGain(instrument: string, gain: number): void {
    if (!DRUM_TYPES.includes(instrument as DrumType)) return;
    this.drumTrackLevels.set(instrument, gain);
    if (!this.ctx) return;
    const node = this.drumTrackGain(instrument);
    if (!node) return;
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(Math.max(0, gain), now, 0.01);
  }

  /**
   * Test-only readers, in the __forTests style the engine already uses.
   * A PURE read: it must never mint the node it is asked about, or a test
   * that reads before anything else touches the instrument would silently
   * construct its own subject and pass regardless of real behaviour.
   */
  __drumTrackGainValueForTests(instrument: string): number | undefined {
    return this.drumTrackGains.get(instrument)?.gain.value;
  }

  __drumTrackGainCountForTests(): number {
    return this.drumTrackGains.size;
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

  setDrumKit(kit?: Partial<DrumKit>, kitName?: string): void {
    this.drumKit = mergeDrumKit(kit);
    this.drumTrimGain = drumTrimGainFor(kitName);
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
   * Dry through the track fader into drumBusFilter, wet through a per-voice
   * send gain into drumSendFilter. `reverbSend` is the kit's authored LEVEL
   * (0.15..0.5 across kits); it used to be tested as a boolean and the send
   * ran at full voice level, so the whole spread was inaudible.
   *
   * The track fader sits BEFORE the wet/dry split: a track fader must move the
   * reverb with the dry signal, or pulling a track down leaves its tail up.
   * The dry path routes THROUGH the node; the wet send's gain is seeded from
   * the same node's current value instead of being routed through it, because
   * the track node is persistent and the send is per-voice — release()
   * disconnects the send's OUTGOING edges, never the incoming edge from a
   * persistent node, so routing the wet would leak one edge per hit forever.
   * Seeding is exact for a one-shot whose whole tail is shorter than the time
   * it takes to move a fader.
   *
   * `voice` is threaded in as a parameter rather than read from a field the
   * caller set first, and every voice builder between here and `triggerDrum`
   * carries it for the same reason. It used to be an `activeDrumVoice` field
   * whose docblock admitted its own invariant was unenforced: any path that
   * reached `drumTone`/`drumNoiseBurst`/`metallicBurst` without going through
   * `triggerDrum` first routed its dry signal onto whichever instrument
   * triggered LAST — wrong fader, no throw, no failing test, and since the
   * field was never cleared the wrong answer was the default rather than an
   * obvious empty one. As a parameter the mistake is not merely unlikely, it
   * does not typecheck: there is no value to inherit and none to forget to set.
   * It must be the ALIAS-RESOLVED name (`triggerDrum` resolves DRUM_ALIASES
   * before its dispatch), because that is the key `drumTrackGains` is keyed by.
   */
  private wireDrumVoice(env: GainNode, reverbSend = 0, voice: string): GainNode | null {
    const track = this.drumTrackGain(voice);
    env.connect(track ?? this.drumBusFilter!);
    if (reverbSend <= 0 || !this.drumSendFilter) return null;
    const send = this.ctx!.createGain();
    send.gain.value = reverbSend * (track ? track.gain.value : 1);
    env.connect(send);
    send.connect(this.drumSendFilter);
    return send;
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
  private release(...nodes: (AudioNode | null | undefined)[]): void {
    for (const node of nodes) {
      if (!node) continue;
      try { node.disconnect(); } catch { /* ignore */ }
    }
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
    reverbSend?: number;
    /** The alias-resolved voice whose track fader this component belongs to. */
    voice: string;
  }): void {
    const osc = this.ctx!.createOscillator();
    if (o.type) osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(o.freqEnd, o.t + (o.pitchTime ?? 0.05));
    }
    const env = this.drumEnv(o.peak, o.decay, o.t);
    osc.connect(env);
    const send = this.wireDrumVoice(env, o.reverbSend, o.voice);
    osc.start(o.t);
    osc.stop(o.stopAt ?? o.t + o.decay + 0.02);
    osc.onended = () => this.release(osc, env, send);
  }

  /**
   * Put a hat voice in the choke group, ALONGSIDE whatever is still live under
   * the same name. THE one registration path — nothing else may write
   * `soundingHats`, so a new hat voice is choked correctly by construction
   * rather than by remembering to add it. This is a convention enforced by
   * review, not by the type system: a second `.set()` elsewhere would compile
   * and pass every test here, and that risk was judged cheaper to accept than
   * any structural fix (e.g. a write-once wrapper) available for it.
   *
   * A LIST per name, not one entry, and that is load-bearing. `chokeHats`
   * deliberately leaves a voice whose `startAt` is still in the future alone —
   * a live pad press must not silence a hit the sequencer has already queued.
   * Replacing the entry here would then DROP that queued voice from the group
   * entirely, and nothing could ever choke it: it would sound at its scheduled
   * time and ring straight through every later hat. (Reachable in normal play:
   * CLOCK_LOOKAHEAD queues a hat ~100 ms ahead, so a pad press lands inside
   * that window often.) Entries already over at the new hit's time are the only
   * ones dropped, which keeps the list at the one or two voices that can
   * actually overlap.
   *
   * `envs` and `peaks` are parallel arrays rather than a single array of
   * `{ env, peak }` pairs — which would make a length mismatch unrepresentable
   * instead of merely caught — deliberately: slice 4's plan is written and
   * committed against this array signature, and widening it here would put
   * this task's convenience ahead of a document another implementer will
   * follow. The throw below is the next-best guard for that choice.
   *
   * `peaks` gets a length check and `sources` does not, and that is not an
   * omission: `peaks` is a silent-failure hazard (an index miss falls back
   * inside `cancelAndHold` to the raw `AudioParam.value`, exactly the
   * Firefox re-swell finding 2 exists to eliminate, with no exception and no
   * failing test); `sources` has no parallel array to drift out of step
   * with — it is just stopped in full, in order, with nothing to compare its
   * length against.
   */
  private registerHatVoice(
    name: string,
    envs: GainNode[],
    peaks: number[],
    sources: AudioScheduledSourceNode[],
    startAt: number,
    stopAt: number,
  ): void {
    if (peaks.length !== envs.length) {
      throw new Error(
        `registerHatVoice('${name}'): ${envs.length} envs but ${peaks.length} peaks — ` +
        'a short peaks array lets chokeHats fall back to the live AudioParam.value ' +
        'instead of the registered peak, silently reinstating the Firefox re-swell ' +
        '(cancelAndHoldAtTime-less choke jumping the gain up before falling) ' +
        'that the peaks array exists to prevent. Pass one peak per envelope.',
      );
    }
    const live = (this.soundingHats.get(name) ?? []).filter((v) => v.stopAt > startAt);
    live.push({ envs, peaks, sources, startAt, stopAt });
    this.soundingHats.set(name, live);
  }

  /**
   * Cut every sounding hat that is actually sounding AT `when` — the new hit's
   * own scheduled time, not necessarily `ctx.currentTime` — over `release`
   * seconds. Three constraints, all non-negotiable (spec decision 9):
   *  - exponentialRampToValueAtTime cannot ramp to 0, so the target is the
   *    shared ENV_FLOOR;
   *  - the ramp starts from the value AT `when`, via cancelAndHold, passing
   *    the voice's registered peak as the fallback for engines with no
   *    cancelAndHoldAtTime (Firefox). Starting from the peak on purpose here
   *    is safe — see the note on `SoundingHat.peaks` — where starting from it
   *    by ACCIDENT (the plain `param.value` fallback, which is wrong whenever
   *    `when` is in the future) is exactly the re-swell this method exists to
   *    prevent;
   *  - every source in `sources` is still stop()ed after the ramp. Today's
   *    single noise source already schedules its own stop() in
   *    `drumNoiseBurst`, so this loop is redundant for it — and it is
   *    deliberately just as redundant for slice 4's oscillator bank: this diff
   *    does NOT put the bank's oscillators into `sources`, because
   *    `metallicBurst` already calls `osc.stop()` itself (`t + longest +
   *    0.02`). (An earlier note here claimed the bank had no stop of its own
   *    and that this loop was load-bearing for it; that was wrong — checked
   *    against the source, not guessed a second time.) The real consequence:
   *    a choked bank's oscillators do NOT stop early. They keep running,
   *    silently, at ENV_FLOOR, until `metallicBurst`'s own schedule ends them
   *    — inaudible, but still allocated for that whole window. Task 5's
   *    question about how many banks can be alive at once has to count these.
   *
   * Every envelope of the voice is ramped and every source stopped, not just
   * the first — see the note on `SoundingHat`.
   *
   * A voice is only choked (and only then removed from the map) when
   * `startAt <= when < stopAt`:
   *  - `stopAt <= when` means it is already over. Ramping a finished envelope
   *    would revive it, so it is left alone — and NOT removed here: a voice
   *    that ends naturally is dropped by the next `registerHatVoice` under its
   *    own name, which prunes everything already over (there are only two
   *    keys, `hihat` and `openhat`, so this is bounded either way);
   *  - `startAt > when` means it has not begun sounding yet — a live pad press
   *    (`when` = real `ctx.currentTime`) must not reach forward in time and
   *    silence a hit the sequencer has already queued but which has not
   *    started, or that hit never sounds at all. It is also left in the map,
   *    unchoked, so a LATER hit whose own `when` reaches its `startAt` still
   *    chokes it correctly — which only holds because `registerHatVoice`
   *    APPENDS under the name rather than replacing.
   */
  private chokeHats(when: number, release: number): void {
    for (const [key, voices] of this.soundingHats) {
      const kept: SoundingHat[] = [];
      for (const voice of voices) {
        if (voice.startAt > when || voice.stopAt <= when) {
          kept.push(voice);
          continue;
        }
        for (let i = 0; i < voice.envs.length; i++) {
          const env = voice.envs[i];
          this.cancelAndHold(env.gain, when, voice.peaks[i]);
          env.gain.exponentialRampToValueAtTime(ENV_FLOOR, when + release);
        }
        for (const source of voice.sources) {
          try {
            source.stop(when + release);
          } catch {
            /* already stopped */
          }
        }
      }
      if (kept.length === voices.length) continue;
      // Deleting or re-setting the CURRENT key mid-iteration is defined
      // behaviour for a Map, and no later key is disturbed.
      if (kept.length === 0) this.soundingHats.delete(key);
      else this.soundingHats.set(key, kept);
    }
  }

  /** A filtered noise drum component (hats, snare snap, clap, crash). */
  private drumNoiseBurst(o: {
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    topCut?: number;
    peak: number;
    decay: number;
    t: number;
    stopPad?: number;
    reverbSend?: number;
    shape?: (gain: AudioParam) => void;
    /** The alias-resolved voice whose track fader this component belongs to. */
    voice: string;
  }): { env: GainNode; noise: AudioBufferSourceNode; stopAt: number } {
    const noise = this.createNoiseNode();
    const filter = this.ctx!.createBiquadFilter();
    filter.type = o.filterType;
    filter.frequency.value = o.freq;
    if (o.q !== undefined) filter.Q.value = o.q;

    // The upper corner. `filterType` is a HIGHPASS for the hats, so without
    // this a lower `freq` passes MORE energy, not less — which is how the two
    // darkest-authored hats in the library became its fullest-sounding ones.
    // Two biquads make the hat a band; one made it a floor.
    let topCutFilter: BiquadFilterNode | undefined;
    if (o.topCut !== undefined) {
      topCutFilter = this.ctx!.createBiquadFilter();
      topCutFilter.type = 'lowpass';
      topCutFilter.frequency.value = o.topCut;
    }

    // Extra levels between the peak and the floor (the clap's micro-bursts)
    // are scheduled by drumEnv itself, before the closing ramp.
    const env = this.drumEnv(o.peak, o.decay, o.t, o.shape);

    noise.connect(filter);
    if (topCutFilter) {
      filter.connect(topCutFilter);
      topCutFilter.connect(env);
    } else {
      filter.connect(env);
    }
    const send = this.wireDrumVoice(env, o.reverbSend, o.voice);
    const stopAt = o.t + o.decay + (o.stopPad ?? 0.01);
    noise.start(o.t, this.noiseStartOffset());
    noise.stop(stopAt);
    noise.onended = () => this.release(noise, filter, topCutFilter, env, send);
    return { env, noise, stopAt };
  }

  /**
   * The two-partial body plus noise shared by `snare` and `rimshot`. `voice`
   * says WHICH of those two is being built: the params alone cannot, since a
   * rimshot is a preset over this same path, and the two have separate track
   * faders.
   */
  private snareVoice(s: SnareParams, v: number, now: number, voice: string): void {
    this.drumTone({
      type: 'triangle', freq: s.bodyFreqStart, freqEnd: s.bodyFreqEnd,
      pitchTime: s.bodyTime, peak: v * s.bodyGain, decay: s.bodyDecay,
      t: now, stopAt: now + s.bodyDecay + 0.05, voice,
    });
    // The second partial: the (0,1) head mode is a PAIR, and every machine
    // that copies it uses two oscillators (research §2.1).
    this.drumTone({
      type: 'triangle', freq: s.bodyFreqStart2, freqEnd: s.bodyFreqEnd2,
      pitchTime: s.bodyTime, peak: v * s.bodyGain2, decay: s.bodyDecay,
      t: now, stopAt: now + s.bodyDecay + 0.05, voice,
    });
    this.drumNoiseBurst({
      filterType: 'highpass', freq: s.noiseFilter, peak: v * s.noiseGain,
      decay: s.noiseDecay, t: now, stopPad: 0.03, reverbSend: s.reverbSend, voice,
    });
  }

  /**
   * The metallic source shared by hihat, openhat, crash and ride: six square
   * oscillators at METAL_RATIOS * `tone`, split into two bandpass bands with
   * an INDEPENDENT envelope each, highpassed and summed.
   *
   * The two decays must differ. The high band dying first while the low band
   * rings on is the falling spectral centroid of a struck plate; one gain
   * envelope over one filter cannot produce it at any cutoff (§1.2).
   *
   * Returns the summed output gain so a hat caller can hand it to the choke
   * group — the noise half and the bank half are one voice and must be cut
   * together.
   */
  private metallicBurst(o: {
    tone: number;
    peak: number;
    t: number;
    highpass: number;
    bandA: { freq: number; q: number; level: number; attack: number; decay: number };
    bandB: { freq: number; q: number; level: number; attack: number; decay: number };
    reverbSend?: number;
    /** The alias-resolved voice whose track fader this bank belongs to. */
    voice: string;
  }): { out: GainNode; stopAt: number } | null {
    if (!this.ctx || o.peak <= 0) return null;
    const ctx = this.ctx;

    const mix = ctx.createGain();
    mix.gain.value = 1 / METAL_RATIOS.length;

    const out = ctx.createGain();
    out.gain.value = o.peak;
    const send = this.wireDrumVoice(out, o.reverbSend, o.voice);

    // Bandpass filters are created before the highpass so the graph reads,
    // in creation order, as "the two bands, then the shared tail" — the
    // shape a caller reading `ctx._filters` back would expect.
    const bands = [o.bandA, o.bandB].map((b) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = b.freq;
      bp.Q.value = b.q;
      const env = ctx.createGain();
      // Per-band AD: a 0 attack starts at the level (hats have no envelope
      // smoother); a non-zero attack is the cymbal bloom of §2.5.
      if (b.attack > 0) {
        env.gain.setValueAtTime(ENV_FLOOR, o.t);
        env.gain.exponentialRampToValueAtTime(Math.max(ENV_FLOOR, b.level), o.t + b.attack);
      } else {
        env.gain.setValueAtTime(Math.max(ENV_FLOOR, b.level), o.t);
      }
      env.gain.exponentialRampToValueAtTime(ENV_FLOOR, o.t + b.attack + Math.max(0.01, b.decay));
      mix.connect(bp);
      bp.connect(env);
      return { bp, env };
    });

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = o.highpass;
    hp.Q.value = 0.7;
    hp.connect(out);
    for (const { env } of bands) env.connect(hp);

    // The single source of truth for when this voice's oscillators actually
    // stop. It schedules `osc.stop()` below AND is returned as `stopAt` so a
    // caller (the hat crossfade) never recomputes this from its own copies of
    // `bandA`/`bandB` — a caller-side recomputation agreed with this only when
    // its own decay multiplier happened to be >= 1, and silently produced an
    // early `stopAt` otherwise, which let `chokeHats` skip a still-ringing
    // voice without either the caller or a test ever seeing the two disagree.
    const longest = Math.max(o.bandA.attack + o.bandA.decay, o.bandB.attack + o.bandB.decay);
    const stopAt = o.t + longest + 0.02;
    const oscs = METAL_RATIOS.map((ratio) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(o.tone * ratio, o.t);
      osc.connect(mix);
      osc.start(o.t);
      osc.stop(stopAt);
      return osc;
    });

    // One teardown, hung off the last oscillator to end — the same onended
    // pattern drumTone and drumNoiseBurst use, so the bank leaks nothing.
    oscs[oscs.length - 1].onended = () => this.release(
      ...oscs, ...bands.flatMap(({ bp, env }) => [bp, env]), mix, hp, out, send,
    );
    return { out, stopAt };
  }

  /**
   * A random read position in the one shared noise buffer. Without it every
   * hat, snare and clap plays byte-identical noise, so hits landing on the same
   * step are perfectly correlated and sum at +6 dB instead of +3.
   */
  private noiseStartOffset(): number {
    return random() * (this.noiseBuffer?.duration ?? 0);
  }

  /**
   * The bodies for `hitom` / `lowtom` / `ride` / `bell` — the four voices
   * `triggerDrum` dispatches ahead of its switch. See `NON_SWITCH_VOICES` for
   * why they sit outside it, and why these internal `if`s count toward this
   * method's complexity rather than `triggerDrum`'s. The parameter is the
   * union itself, so the call site needs no cast and a voice added to the
   * roster without a branch here fails to compile.
   */
  private triggerNonSwitchVoice(voice: NonSwitchVoice, v: number, now: number): void {
    const k = this.drumKit;
    if (voice === 'hitom' || voice === 'lowtom') {
      const t = k[voice];
      this.drumTone({
        freq: t.freqStart, freqEnd: t.freqEnd, pitchTime: t.pitchTime,
        peak: v * t.gain, decay: t.decay, t: now, reverbSend: t.reverbSend, voice,
      });
      return;
    }
    if (voice === 'ride') {
      const r = k.ride;
      const peak = v * r.gain;
      // ping and wash are two COMPONENTS of one voice. The ping is a defined
      // attack; the wash is a bed that must survive the next strike 250 ms
      // later. A crash is the opposite trade - a faster bloom that collapses.
      if (r.metal > 0) {
        this.metallicBurst({
          tone: r.tone, peak: peak * r.metal * r.ping, t: now, voice,
          highpass: r.bodyFilter, reverbSend: r.reverbSend,
          bandA: { freq: r.pingFilter, q: RIDE_PING_Q, level: 1, attack: 0, decay: r.pingDecay },
          bandB: { freq: r.bodyFilter, q: RIDE_BODY_Q, level: RIDE_BODY_LEVEL, attack: 0, decay: r.pingDecay * 1.6 },
        });
        this.metallicBurst({
          tone: r.tone, peak: peak * r.metal * (1 - r.ping), t: now, voice,
          highpass: r.washFilter * 0.5, reverbSend: r.reverbSend,
          bandA: { freq: r.washFilter, q: RIDE_WASH_Q, level: 1, attack: RIDE_WASH_ATTACK, decay: r.washDecay },
          bandB: { freq: METAL_BAND_B_HZ, q: 0.9, level: 0.35, attack: RIDE_WASH_ATTACK, decay: r.washDecay * 0.7 },
        });
      }
      if (r.metal < 1) {
        // The stick, and the noise half of the bed (§2.3's 10% / 5% layers).
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: r.pingFilter, q: RIDE_PING_Q,
          peak: peak * (1 - r.metal) * r.ping, decay: r.pingDecay, t: now, voice,
        });
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: r.washFilter, q: RIDE_WASH_Q,
          peak: peak * (1 - r.metal) * (1 - r.ping), decay: r.washDecay,
          t: now, stopPad: 0.1, reverbSend: r.reverbSend, voice,
        });
      }
      return;
    }
    const b = k.bell;
    // Decision 30: the bell does NOT use the metallic bank. Two squares a
    // detuned fifth apart already beat against each other, and the 808's
    // cowbell is exactly this circuit.
    const bp = this.ctx!.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = b.filter;
    bp.Q.value = BELL_Q;
    const env = this.drumEnv(v * b.gain, b.decay, now);
    bp.connect(env);
    const send = this.wireDrumVoice(env, b.reverbSend, voice);
    const oscs = [b.freq1, b.freq2].map((freq) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(bp);
      osc.start(now);
      osc.stop(now + b.decay + 0.02);
      return osc;
    });
    oscs[1].onended = () => this.release(...oscs, bp, env, send);
  }

  // Drum Synthesizer Trigger
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    if (!this.ctx || !this.dryGain || !this.drumBusFilter) return;
    // wakeIfIdle() marks activity for us on every reachable path — see the
    // comment in triggerSynthNoteOn.
    this.wakeIfIdle();
    const now = time ?? this.ctx.currentTime;
    const k = this.drumKit;
    const name = type.toLowerCase();
    const resolved = DRUM_ALIASES[name] ?? name;
    // The measured trim lands on hitLevel, BEFORE the per-voice authored `gain`,
    // so DRUM_KITS keeps stating what a reviewer tuned by ear. `clampVelocity`
    // bounds only its own argument to 0..1 (see `clampVelocity`'s and
    // `Velocity`'s docs) — the trim multiplies AFTER that clamp, deliberately,
    // so a calibration boost is not silently discarded the way it would be if
    // it landed inside `clampVelocity(...)` instead. That is why hitLevel can
    // exceed 1 and is named for what it now is (a per-hit level), not a velocity.
    // `drumTrimGain` is the same number for every voice in the current kit — see
    // the comment on that field — so it multiplies in directly with no per-voice
    // lookup.
    const hitLevel = clampVelocity(velocity) * this.drumTrimGain;

    // Pulled out of the switch below (not merely refactored into it) because
    // every `case` clause counts toward this method's cyclomatic complexity
    // regardless of how small its body is, where one `if` guarded by a
    // single lookup — however many names it covers — costs exactly one. A
    // second `if`/`else` to pick between voices would spend that saving right
    // back, so membership is one set lookup (which is not a decision point)
    // and the four bodies live behind it in `triggerNonSwitchVoice`, whose
    // internal branches are scoped to that method's own complexity, not this
    // one's. 'ride' and 'crash' would sort adjacently here and 'bell' would
    // sort last (canonical order, decision 1) — only 'crash' has a `case`
    // below.
    if (isNonSwitchVoice(resolved)) {
      this.triggerNonSwitchVoice(resolved, hitLevel, now);
      return;
    }

    switch (resolved) {
      case 'kick': {
        const d = k.kick;
        this.drumTone({
          freq: d.freqStart, freqEnd: d.freqEnd, pitchTime: d.pitchTime,
          peak: hitLevel * d.gain, decay: d.decay, t: now, reverbSend: d.reverbSend,
          voice: resolved,
        });
        if (d.clickFreq && d.clickLevel) {
          // No send: the click is the beater transient and its whole job is to
          // stay dry. A click through a reverb is a slap.
          this.drumTone({
            freq: d.clickFreq, peak: hitLevel * d.clickLevel, decay: d.clickDecay ?? 0.01,
            t: now, stopAt: now + d.decay + 0.02, voice: resolved,
          });
        }
        break;
      }
      case 'snare':
        this.snareVoice(k.snare, hitLevel, now, resolved);
        break;
      case 'rimshot':
        // Decision 31: a rimshot is a PRESET over the snare path, not a third
        // synthesis path - two inharmonic tones with almost no noise.
        this.snareVoice(k.rimshot, hitLevel, now, resolved);
        break;
      case 'clap': {
        const c = k.clap;
        const peak = hitLevel * c.gain;
        // Three DECAYING bursts plus a distinct tail, ~10 ms apart. The old
        // schedule was three plateaus at 1.0, 0.25 and 1.1 - setValueAtTime
        // HOLDS a value, so it was a chopped-noise gate whose loudest event
        // was its last. A real clap's hands do not get louder.
        // The 2 ms window between a completed ramp and the next strike is the
        // inter-burst silence; that is what makes them read as separate hands.
        const floor = Math.max(ENV_FLOOR, peak * 0.05);
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: c.filter, q: 1.5, peak, decay: c.decay,
          t: now, stopPad: 0.02, reverbSend: c.reverbSend, voice: resolved,
          shape: (gain) => {
            gain.exponentialRampToValueAtTime(floor, now + 0.008);
            gain.setValueAtTime(peak * 0.85, now + 0.01);
            gain.exponentialRampToValueAtTime(floor, now + 0.018);
            gain.setValueAtTime(peak * 0.7, now + 0.02);
            gain.exponentialRampToValueAtTime(floor, now + 0.028);
            gain.setValueAtTime(peak * 0.55, now + 0.03);
          },
        });
        break;
      }
      case 'hihat': {
        const h = k.hihat;
        this.chokeHats(now, HIHAT_CHOKE_RELEASE);
        // Closed hat: both bands at the kit's decay, band B low in the mix -
        // a hat taps mostly the high path (§2.1).
        this.triggerHatVoice('hihat', h, hitLevel * h.gain, now, 0.25, 1);
        break;
      }
      // 'hitom' and 'lowtom' would sort here (canonical order, decision 1) —
      // handled above by the NON_SWITCH_VOICES guard instead, which
      // is why neither has a `case` in this switch. See that guard's comment
      // for why.
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely. The old
        // unconditional gain.connect(delayNode) here was a stray with no kit
        // parameter behind it.
        const h = k.openhat;
        this.chokeHats(now, OPENHAT_CHOKE_RELEASE);
        // The low band rings 1.8x longer than the high one (§2.2: 180 ms vs
        // 320 ms). That ratio is the open hat's falling centroid; it is not a
        // longer copy of the closed hat.
        this.triggerHatVoice('openhat', h, hitLevel * h.gain, now, 0.45, 1.8);
        break;
      }
      case 'crash': {
        const cr = k.crash;
        const peak = hitLevel * cr.gain;
        if (cr.metal < 1) {
          this.drumNoiseBurst({
            filterType: 'bandpass', freq: cr.filter, q: 0.8, peak: peak * (1 - cr.metal),
            decay: cr.decay, t: now, stopPad: 0.1, reverbSend: cr.reverbSend,
            voice: resolved,
          });
        }
        if (cr.metal > 0) {
          // The 808's cymbal decay modulates the 3440 Hz path ONLY, and its
          // attack is smoothed - that 8 ms is the difference between a cymbal
          // that bloomed and a burst of noise that switched on (§2.5).
          this.metallicBurst({
            tone: METAL_TONE_CRASH, peak: peak * cr.metal, t: now, voice: resolved,
            highpass: cr.filter * 0.5, reverbSend: cr.reverbSend,
            bandA: {
              freq: METAL_BAND_A_HZ, q: 0.7, level: 1, attack: 0.008,
              decay: Math.min(0.5, Math.max(0.25, cr.decay * 0.35)),
            },
            bandB: { freq: METAL_BAND_B_HZ, q: 0.9, level: 0.8, attack: 0.008, decay: cr.decay },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * One hat hit's metal crossfade: the noise burst (below `metal` 1) and the
   * metallic bank (above `metal` 0), registered as one choke-group voice so
   * `chokeHats` can silence both halves together. `bandBLevel`/`bandBDecayMult`
   * are the closed/open hat's only difference in the bank (§2.1 vs §2.2) —
   * everything else (tone, bandA, highpass corner) is shared.
   */
  private triggerHatVoice(
    voiceName: 'hihat' | 'openhat',
    h: HatParams,
    peak: number,
    now: number,
    bandBLevel: number,
    bandBDecayMult: number,
  ): void {
    const envs: GainNode[] = [];
    const peaks: number[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    let stopAt = now;
    if (h.metal < 1) {
      const hat = this.drumNoiseBurst({
        filterType: 'highpass', freq: h.filter, q: HAT_Q, topCut: h.topCut,
        peak: peak * (1 - h.metal), decay: h.decay, t: now, voice: voiceName,
      });
      envs.push(hat.env);
      peaks.push(peak * (1 - h.metal));
      sources.push(hat.noise);
      stopAt = Math.max(stopAt, hat.stopAt);
    }
    if (h.metal > 0) {
      const bank = this.metallicBurst({
        tone: METAL_TONE_HAT, peak: peak * h.metal, t: now, highpass: h.filter,
        voice: voiceName,
        bandA: { freq: METAL_BAND_A_HZ, q: 1.0, level: 1, attack: 0, decay: h.decay },
        bandB: {
          freq: METAL_BAND_B_HZ, q: 1.2, level: bandBLevel, attack: 0,
          decay: h.decay * bandBDecayMult,
        },
      });
      if (bank) {
        envs.push(bank.out);
        peaks.push(peak * h.metal);
        // Derived from the bank itself, not recomputed here — see the note
        // on `metallicBurst`'s `stopAt`. A local recomputation of
        // `now + h.decay * bandBDecayMult + 0.02` agrees with this only when
        // `bandBDecayMult >= 1`; below 1 it names band B's shorter decay
        // while band A (unmultiplied) is still the bank's true tail.
        stopAt = Math.max(stopAt, bank.stopAt);
      }
    }
    this.registerHatVoice(voiceName, envs, peaks, sources, now, stopAt);
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

  getAudioContext(): AudioContext | null {
    return this.ctx;
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

// Re-exported from utils/musicTheory so the grid constant has one definition
// while every `import { STEPS_PER_BAR } from '../engine'` keeps resolving.
export { STEPS_PER_BAR };

export const audioEngine = new AudioEngine();
