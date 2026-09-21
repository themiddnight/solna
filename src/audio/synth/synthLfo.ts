import type { LfoParams, LfoRate, LfoWaveform, ModTarget } from '@/types/synth';
import { lfoRateHz, modulationAmount } from '@/utils/synthPatch';
import { random as sharedRandom } from '../rng';

/**
 * The transport- and note-triggered LFO source (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Engine and voice lifecycle"). Standalone by design (plan ruling P2): this
 * module builds and shares the raw modulation SIGNAL and knows nothing about
 * `AudioEngine` or `SynthVoiceManager` — Task 6 owns when a voice's LFO
 * connects/disconnects (voice lifecycle), Task 7 wires
 * `Clock.subscribeTransportOrigin` and BPM into a live `SynthLfoBank`.
 *
 * Review ruling on Task 5's own scope, superseding this file's first draft:
 * **this bank owns connecting its scaled output to the voice's destination
 * `AudioParam`, and owns reconnecting it when a route TARGET changes.** A
 * caller cannot do that reconnection itself without knowing the phase
 * concerns this module deliberately keeps the voice ignorant of (which
 * generator is shared, when it may be rebuilt, when it may not) — Step 4's
 * "reconnect without rebuilding the oscillator" is only implementable from
 * inside here.
 *
 * Two trigger modes, two lifetimes:
 * - `'transport'`: one oscillator/buffer-source and one shared depth/route
 *   "scale gain" per synth channel (`source`), phase-locked to
 *   `setTransportOrigin`'s time and shared by every voice on that channel —
 *   two notes starting at different instants read the same running signal,
 *   so they share one phase. The scale gain fans out: one `.connect()` per
 *   attached voice's own destination `AudioParam` (each voice has its own
 *   filter, its own oscillators, …, even though they share one LFO).
 * - `'note'`: a dedicated generator and scale gain per voice, started at
 *   that voice's own note-on time and rotated to `phaseDegrees` there.
 *
 * `SynthLfoBank.connectVoice` writes the raw generator node into
 * `voice.lfoSource` (`subtractiveVoice.ts`) as an opaque identity — shared
 * for every transport voice on a channel, unique per note voice — which is
 * what lets a caller and a test tell the two lifetimes apart without this
 * module or the voice knowing anything about the other's concepts. The
 * voice's only other obligation is `lfoDestination(target)`, which resolves
 * a `ModRoute`'s target to the real `AudioParam`(s) on ITS OWN graph — this
 * module never reaches into `SubtractiveVoiceNodes` directly.
 *
 * Every scheduled time is caller-supplied audio-clock time, never
 * `ctx.currentTime` read here, and `ctx` is a `BaseAudioContext` — the same
 * discipline `modulation.ts` documents — so this bank behaves identically
 * bound to a realtime or an `OfflineAudioContext`. Consequently a genuine
 * "disconnect once the fade has actually elapsed in real time" cannot use a
 * wall-clock timer (would never fire inside a fast offline render, and would
 * fire at the wrong instant in a realtime one relative to the audio clock).
 * `sweepPendingTeardowns` is this module's alternative: it defers a silenced
 * channel's actual graph-edge severing into a plain data structure and
 * flushes whatever has become due, PURELY as a function of the audio-clock
 * `at` the next call happens to carry — no timer, no clock read, identical
 * under either context type.
 *
 * **An edge's identity is a `VoiceConnection` object, not a field on
 * `VoiceEntry`.** Two review rounds found two variants of the same bug: a
 * pending teardown that reads a voice's CURRENT `scaleGain`/`destination`
 * fields at sweep time can be handed a value that has since been overwritten
 * by an unrelated reconnect (a live target change, a channel revival) racing
 * the same voice — severing the WRONG edge, or throwing trying to sever one
 * that was never there. `VoiceConnection` fixes this by construction:
 * reconnecting a voice never mutates its old connection object, it replaces
 * `VoiceEntry.connection` with a brand new one and leaves the old one exactly
 * as it was. A `PendingTeardown` captures REFERENCES to the connection
 * objects it owns at the moment it is created, so a later reconnect changing
 * `VoiceEntry.connection` cannot retroactively change what the teardown was
 * built to sever. `severed` is the one flag either `disconnectVoice` or
 * `sweepPendingTeardowns` — whichever gets there first — sets on that SAME
 * shared object, so the edge is severed exactly once no matter which of them
 * notices first.
 */

/**
 * What `SynthLfoBank` needs from a voice: an identity to key its own
 * bookkeeping by, the channel it belongs to (`'synth'`, `'chord'`, `'bass'`,
 * …), a slot to record which generator it ended up sharing or owning, and a
 * way to resolve a route's target to this voice's own real destination
 * `AudioParam`(s). `SubtractiveVoice` already has `id`/`source`; adding
 * `lfoSource` and `lfoDestination` there is this task's only change to that
 * file — `lfoDestination` reuses the exact same node lookup ENV2's routing
 * already performs, just exposed for an external caller instead of computed
 * inline.
 */
/**
 * Where one LFO route lands on one voice, and what a unit of the route's own
 * unit is worth once it gets there.
 *
 * A connected modulator SUMS into an `AudioParam` in that PARAM's unit, while
 * a `ModRoute.amount` is in the TARGET's musical unit — semitones, dB, a
 * normalized delta. `unitScale` is the factor between the two, and this bank
 * multiplies `depth * amount` by it when it writes the scale gain. Only the
 * voice can supply it: two of the conversions are linearizations about that
 * voice's own unmodulated value. See `LFO_DESTINATION_SELECTORS` in
 * `subtractiveVoice.ts` for the derivation of each one.
 */
export interface LfoDestination {
  /** Every param the route lands on — `pitch-all` reaches both oscillators and the sub. */
  params: AudioParam[];
  unitScale: number;
}

export interface LfoVoiceHandle {
  readonly id: string;
  readonly source: string;
  lfoSource?: unknown;
  /**
   * The real destination for `target` on this voice's own graph, or `null`
   * if this voice has none right now (e.g. `osc2-pitch` when oscillator 2 is
   * disabled). `pitch-all` resolves to more than one param — every enabled
   * pitched source's `detune` — hence `LfoDestination.params` being a list.
   */
  lfoDestination(target: ModTarget): LfoDestination | null;
}

/**
 * Harmonics used to approximate each periodic waveform as a `PeriodicWave`.
 * An LFO runs at sub-audio rates (typically well under 20 Hz) and is never
 * heard directly — only its effect on a modulated param is — so there is no
 * anti-aliasing reason to reach for the large harmonic counts audio-rate
 * synthesis would need. This is enough terms for square/triangle/sawtooth to
 * read as their named shape once modulating a param, not a fidelity target.
 */
const PERIODIC_WAVE_HARMONICS = 16;

/** Plateau count per sample-and-hold loop: enough to not repeat obviously, small enough to stay cheap. */
const DEFAULT_SAMPLE_HOLD_STEPS = 16;

/** Default tempo a bank assumes before anything calls `setBpm` — matches `Clock`'s own default. */
const DEFAULT_BPM = 120;

/**
 * How long a depth-to-zero (or route-cleared) turn-off takes to reach exact
 * silence. Short enough to read as instantaneous, long enough that the
 * `linearRampToValueAtTime` it uses is genuinely click-free rather than a
 * disguised step. See `updateSource` — this is the fix for the hazard this
 * task's brief names explicitly: `setTargetAtTime(0, …)` alone never reaches
 * zero, so turning a depth down must schedule a ramp that actually lands on
 * 0, never an asymptote a later read could still find non-zero. The actual
 * graph-edge disconnect is deferred past this same instant — see
 * `sweepPendingTeardowns` — so the edges are still live while the ramp is
 * still audibly in flight.
 */
const LFO_DEPTH_FADE_SECONDS = 0.05;

interface HarmonicSeries {
  real: Float32Array;
  imag: Float32Array;
}

type PeriodicLfoWaveform = Exclude<LfoWaveform, 'sample-and-hold'>;

/**
 * The UN-rotated Fourier series for each periodic shape, real Fourier
 * coefficients at index 0 (unused: no DC offset), harmonics 1..N after that.
 * `imag[k]` is this harmonic's `sin(k·x)` weight, `real[k]` its `cos(k·x)`
 * weight — every base table here is a pure sine series (`real` all zero)
 * because each waveform is defined starting at 0 and rising, matching the
 * native `OscillatorType` of the same name. Standard band-limited Fourier
 * series (Wikipedia "Square wave"/"Triangle wave"/"Sawtooth wave"), truncated
 * at `PERIODIC_WAVE_HARMONICS` per the constant's own doc above.
 */
function baseHarmonics(waveform: PeriodicLfoWaveform): HarmonicSeries {
  const real = new Float32Array(PERIODIC_WAVE_HARMONICS + 1);
  const imag = new Float32Array(PERIODIC_WAVE_HARMONICS + 1);
  switch (waveform) {
    case 'sine':
      imag[1] = 1;
      break;
    case 'square':
      for (let k = 1; k <= PERIODIC_WAVE_HARMONICS; k++) {
        if (k % 2 === 1) imag[k] = 4 / (Math.PI * k);
      }
      break;
    case 'sawtooth':
      for (let k = 1; k <= PERIODIC_WAVE_HARMONICS; k++) {
        imag[k] = (2 / (Math.PI * k)) * (k % 2 === 0 ? -1 : 1);
      }
      break;
    case 'triangle':
      for (let k = 1; k <= PERIODIC_WAVE_HARMONICS; k++) {
        if (k % 2 === 1) {
          const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
          imag[k] = (sign * 8) / (Math.PI * Math.PI * k * k);
        }
      }
      break;
  }
  return { real, imag };
}

/**
 * Rotates a harmonic series by `phaseRadians`: standard Fourier phase shift,
 * each harmonic `k` rotated by `k·phaseRadians` since a harmonic completes
 * `k` cycles for every one of the fundamental's. Derived from
 * `cos(k(x+θ)) = cos(kx)cos(kθ) − sin(kx)sin(kθ)` and the equivalent
 * `sin(k(x+θ))` expansion, collected back onto the `(real, imag)` basis.
 */
function rotateHarmonics({ real, imag }: HarmonicSeries, phaseRadians: number): HarmonicSeries {
  const outReal = new Float32Array(real.length);
  const outImag = new Float32Array(imag.length);
  for (let k = 1; k < real.length; k++) {
    const theta = k * phaseRadians;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    outReal[k] = real[k] * cos + imag[k] * sin;
    outImag[k] = -real[k] * sin + imag[k] * cos;
  }
  return { real: outReal, imag: outImag };
}

/** Degrees, any sign or magnitude, folded to the 0..1 fraction of one cycle. */
function phaseFraction(phaseDegrees: number): number {
  return (((phaseDegrees % 360) + 360) % 360) / 360;
}

/**
 * A `PeriodicWave` for `waveform` rotated to start at `phaseDegrees` — the
 * mechanism note-triggered voices use to begin somewhere other than the
 * waveform's natural zero-crossing, since `OscillatorNode` itself has no
 * phase control (`osc.start(at)` always begins its native types at phase 0).
 */
/**
 * Built waves, per context, keyed by the pair that determines them.
 *
 * `createPeriodicWave` is the expensive half — the platform builds a whole
 * band-limited wavetable set behind it — and `startNoteVoice` calls this once
 * per PHYSICAL voice per note-on, which for a 4-note chord on a unison-3
 * note-triggered preset is 12 builds inside one keydown burst. A `PeriodicWave`
 * is immutable and any number of oscillators may read the same one, so the
 * repeats are free.
 *
 * A `WeakMap` on the context, like `noiseBufferCache` in `subtractiveVoice.ts`,
 * because a wave belongs to the context that made it: an offline render must
 * not be handed the live engine's. The inner map is cleared rather than grown
 * without bound, since Phase is a knob and a drag walks many distinct values.
 *
 * NOT replaced by `node.type = waveform` at zero phase, tempting as that looks:
 * `baseHarmonics` truncates at `PERIODIC_WAVE_HARMONICS` while the native types
 * band-limit to Nyquist, so they are the same SHAPE but not the same spectrum.
 * Only `sine` would be exact, and one special case is not worth a modulation
 * that differs by waveform.
 */
const periodicWaveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
const PERIODIC_WAVE_CACHE_MAX = 64;

export function phasePeriodicWave(ctx: BaseAudioContext, waveform: PeriodicLfoWaveform, phaseDegrees: number): PeriodicWave {
  let byKey = periodicWaveCache.get(ctx);
  if (!byKey) {
    byKey = new Map();
    periodicWaveCache.set(ctx, byKey);
  }
  const key = `${waveform}:${phaseDegrees}`;
  const cached = byKey.get(key);
  if (cached) return cached;

  const rotated = rotateHarmonics(baseHarmonics(waveform), (phaseDegrees * Math.PI) / 180);
  const wave = ctx.createPeriodicWave(rotated.real, rotated.imag);
  if (byKey.size >= PERIODIC_WAVE_CACHE_MAX) byKey.clear();
  byKey.set(key, wave);
  return wave;
}

export interface SampleHoldOptions {
  /** Held values per loop before the sequence repeats. Defaults to `DEFAULT_SAMPLE_HOLD_STEPS`. */
  steps?: number;
  /** Injectable so a test can hand back a fixed sequence instead of the shared `random()` seam. */
  random?: () => number;
}

/**
 * A looping mono buffer of `steps` held plateaus, each `periodSeconds` long
 * and independently randomized in -1..1 (matching a periodic waveform's own
 * range, so a route's `modulationAmount` scaling means the same thing for
 * either waveform family). `random` is called exactly once per step, in
 * order — the deterministic hook a test needs to assert "each plateau lasts
 * one LFO period" and "two connections read the same sequence" against a
 * fixed value list.
 */
export function createSampleHoldBuffer(ctx: BaseAudioContext, periodSeconds: number, options: SampleHoldOptions = {}): AudioBuffer {
  const steps = options.steps ?? DEFAULT_SAMPLE_HOLD_STEPS;
  const random = options.random ?? sharedRandom;
  const stepSamples = Math.max(1, Math.round(periodSeconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, stepSamples * steps, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let step = 0; step < steps; step++) {
    const value = random() * 2 - 1;
    data.fill(value, step * stepSamples, (step + 1) * stepSamples);
  }
  return buffer;
}

/** The synced rate in Hz for `rate` at `bpm` — Hz mode ignores `bpm` entirely, by construction. */
function resolveRateHz(rate: LfoRate, bpm: number): number {
  return rate.mode === 'hz' ? rate.hz : lfoRateHz(rate.division, bpm);
}

/**
 * One raw generator: the audible node (oscillator or looping buffer source)
 * plus a way to re-rate it in place, so a live BPM or rate change never
 * rebuilds it — a rebuild restarts phase and clicks (this task's brief,
 * "Decisions already made").
 */
interface Generator {
  node: OscillatorNode | AudioBufferSourceNode;
  setRateHz(hz: number, at: number): void;
}

/**
 * Reference period a sample-and-hold buffer is authored at; its `AudioBuffer
 * SourceNode.playbackRate` is then set to the ACTUAL rate in Hz, since a
 * one-second-per-step buffer sped up by a factor of `hz` holds each step for
 * exactly `1/hz` seconds. That is what lets `setRateHz` re-rate a running
 * sample-and-hold loop the same way it re-rates an oscillator's `frequency`:
 * a single param write, never a buffer rebuild.
 */
const SAMPLE_HOLD_REFERENCE_PERIOD_SECONDS = 1;

function buildGenerator(
  ctx: BaseAudioContext,
  waveform: LfoWaveform,
  rateHz: number,
  phaseDegrees: number,
  startAt: number,
  random: () => number,
): Generator {
  if (waveform === 'sample-and-hold') {
    const buffer = createSampleHoldBuffer(ctx, SAMPLE_HOLD_REFERENCE_PERIOD_SECONDS, { random });
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.playbackRate.value = rateHz;
    const offsetSeconds = phaseFraction(phaseDegrees) * SAMPLE_HOLD_REFERENCE_PERIOD_SECONDS;
    node.start(startAt, offsetSeconds);
    return {
      node,
      setRateHz(hz, at) {
        node.playbackRate.setValueAtTime(hz, at);
      },
    };
  }

  const node = ctx.createOscillator();
  node.setPeriodicWave(phasePeriodicWave(ctx, waveform, phaseDegrees));
  node.frequency.value = rateHz;
  node.start(startAt);
  return {
    node,
    setRateHz(hz, at) {
      node.frequency.setValueAtTime(hz, at);
    },
  };
}

/** The transport-shared generator for one synth channel, plus the params it was built from. */
interface ChannelEntry {
  params: LfoParams;
  generator: Generator;
  scaleGain: GainNode;
}

/**
 * One (scale gain -> destination) edge for one voice, with an identity of
 * its own that survives a later reconnect. `severed` is the single flag
 * either `disconnectVoice` or `sweepPendingTeardowns` — whichever notices
 * the tail has ended first — sets, so this exact edge is torn down exactly
 * once regardless of which of them gets there first. Reconnecting a voice
 * (`reconcileDestination`) never mutates an existing `VoiceConnection`'s
 * `scaleGain`/`destination` in place; it builds a NEW one and replaces
 * `VoiceEntry.connection` with it, leaving the old object — and whatever
 * still references it — exactly as it was.
 */
interface VoiceConnection {
  readonly scaleGain: GainNode;
  readonly destination: LfoDestination | null;
  severed: boolean;
}

/**
 * A single voice's relationship to a channel: which generator (shared or
 * dedicated) it reads, and its current `VoiceConnection`, plus the voice
 * reference itself (needed so a channel-level rebuild — a route-target
 * change, a re-anchor, a revival from silence — can ask the voice for its
 * NEW destination and reconnect it).
 *
 * `generator`/`connection` are both nullable: this is the ONE place a
 * voice's relationship to a channel lives, whether that channel is currently
 * live (both set) or currently SILENT — no route, depth 0, or
 * ramped-to-zero-and-swept (both `null`, `params` still the voice's latest
 * known config). A voice entry is removed from `this.voices` only by
 * `disconnectVoice` — the voice itself going away, not its modulation going
 * quiet — which is what lets a channel revival (`updateSource` turning a
 * silent channel live again) find every voice that ever asked to be on it,
 * connected while live or while silent, and reconnect it in one pass instead
 * of two special cases.
 */
interface VoiceEntry {
  voice: LfoVoiceHandle;
  source: string;
  triggerMode: LfoParams['triggerMode'];
  params: LfoParams;
  generator: Generator | null;
  connection: VoiceConnection | null;
}

/**
 * A channel whose scale has been ramped to zero and generator's stop
 * scheduled, awaiting the graph-edge sever once that instant has actually
 * passed. `connections` is a snapshot of the EXACT `VoiceConnection` objects
 * this teardown owns, captured at creation — never the live `VoiceEntry`
 * list, whose `.connection` field a later reconnect is free to replace.
 */
interface PendingTeardown {
  readyAt: number;
  connections: Array<{ voice: LfoVoiceHandle; connection: VoiceConnection }>;
  generator: Generator;
  scaleGain: GainNode;
}

/**
 * Whether a route/depth pair currently modulates anything at all — `depth`
 * 0 or no route assigned both mean "off", and both are handled identically
 * everywhere in this module (never build/keep a generator for either case).
 */
function isSilent(params: LfoParams): boolean {
  return params.route === null || params.depth === 0;
}

/**
 * What the shared scale gain has to hold for `params` to move `destination`
 * by the amount the route asks for: `depth * route.amount` — the design
 * doc's "LFO output" — converted out of the route's own unit and into the
 * destination param's. The conversion is NOT optional decoration: a route in
 * semitones summed raw into a `detune` is an amount in cents, a hundredth of
 * what was asked for, which is the shape the LFO shipped in and why it was
 * reported as having no audible effect at all.
 */
function scaleValueFor(params: LfoParams, destination: LfoDestination | null): number {
  if (params.route === null || destination === null) return 0;
  return modulationAmount(params.route, params.depth) * destination.unitScale;
}

/** Connects `scaleGain`'s output to every param `destination` names (a no-op for `null`). */
function connectDestination(scaleGain: GainNode, destination: LfoDestination | null): void {
  if (!destination) return;
  for (const param of destination.params) {
    scaleGain.connect(param);
  }
}

/** The precise inverse of `connectDestination` — severs only these edges, leaving any other voice's fan-out from the same `scaleGain` untouched. */
function disconnectDestination(scaleGain: GainNode, destination: LfoDestination | null): void {
  if (!destination) return;
  for (const param of destination.params) {
    scaleGain.disconnect(param);
  }
}

/**
 * The ONLY place `disconnectDestination` is called from. Guards on
 * `connection.severed` so the edge a `VoiceConnection` represents is torn
 * down exactly once no matter which caller gets here first — `disconnectVoice`
 * tearing a voice down while its channel's fade is still pending, and that
 * fade's later `sweepPendingTeardowns`, both reach for the SAME shared
 * object and whichever runs first wins; the other sees `severed` already
 * true and does nothing.
 */
function severConnection(connection: VoiceConnection | null): void {
  if (!connection || connection.severed) return;
  connection.severed = true;
  disconnectDestination(connection.scaleGain, connection.destination);
}

/** Whether two destination values name the exact same param(s), in the same order — `null` only equals `null`. */
function destinationsEqual(a: LfoDestination | null, b: LfoDestination | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.params.length === b.params.length && a.params.every((param, index) => param === b.params[index]);
}

export class SynthLfoBank {
  private bpm = DEFAULT_BPM;
  private transportOrigin = 0;
  private readonly channels = new Map<string, ChannelEntry>();
  private readonly voices = new Map<string, VoiceEntry>();
  private readonly pendingTeardowns = new Map<number, PendingTeardown>();
  /**
   * Keys `pendingTeardowns`. NOT the source: one bus can have more than one
   * retired (generator, scaleGain) pair in flight at once — a depth fade and
   * a transport re-anchor land within the same 50 ms — and a source key made
   * the second `set` silently drop the first, leaving its generator running
   * and its edges connected forever. A pending teardown is a property of the
   * retired pair, not of the bus it used to serve.
   */
  private nextTeardownId = 0;

  private ctx: BaseAudioContext | null;

  constructor(ctx: BaseAudioContext, private readonly random: () => number = sharedRandom) {
    this.ctx = ctx;
  }

  /** Stops and disconnects every generator and edge owned by this bank. */
  dispose(at?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const stopAt = at ?? ctx.currentTime;
    const generators = new Set<Generator>();
    const gains = new Set<GainNode>();

    for (const entry of this.channels.values()) {
      generators.add(entry.generator);
      gains.add(entry.scaleGain);
    }
    for (const entry of this.voices.values()) {
      entry.voice.lfoSource = undefined;
      if (entry.generator) generators.add(entry.generator);
      if (entry.connection) {
        severConnection(entry.connection);
        gains.add(entry.connection.scaleGain);
      }
    }
    for (const pending of this.pendingTeardowns.values()) {
      generators.add(pending.generator);
      gains.add(pending.scaleGain);
      for (const { voice, connection } of pending.connections) {
        voice.lfoSource = undefined;
        severConnection(connection);
      }
    }
    for (const generator of generators) {
      try { generator.node.stop(stopAt); } catch { /* already stopped */ }
      try { generator.node.disconnect(); } catch { /* already disconnected */ }
    }
    for (const gain of gains) {
      try { gain.disconnect(); } catch { /* already disconnected */ }
    }
    this.pendingTeardowns.clear();
    this.voices.clear();
    this.channels.clear();
    this.ctx = null;
  }

  /**
   * The instant every transport-triggered channel's shared generator is
   * phase-locked to — a mid-song re-anchor as much as the very first one.
   * Every channel currently running is stopped and rebuilt at the new
   * origin, and every voice still attached to it is reconnected to the
   * REBUILT generator/scale gain and its own destination(s) — a channel with
   * no attached voices is simply dropped, since the next `connectVoice` for
   * it will build fresh at this origin anyway.
   */
  setTransportOrigin(time: number): void {
    if (!this.ctx) return;
    this.sweepPendingTeardowns(time);
    this.transportOrigin = time;
    for (const [source, entry] of [...this.channels]) {
      entry.generator.node.stop(time);
      this.channels.delete(source);

      // Only PREVIOUSLY-LIVE voices need moving to the rebuilt generator — a
      // dormant one (silenced, its own edge already gone) has nothing to
      // preserve continuity for and is left alone; its own next `connectVoice`
      // or a later channel revival is what reconnects it.
      const attached = this.liveVoicesFor(source);

      // The stop above is booked on the AUDIO clock; disconnecting here would
      // run NOW, and every caller of this method books a lookahead window
      // ahead of itself. Cutting the edge early drops each attached voice's
      // modulation for that whole window — the destination snaps back to its
      // base value and steps again when the rebuilt channel's scale gain is
      // written at `time`, which is a click on every transport start under a
      // transport-mode LFO. Deferring instead leaves the retired pair feeding
      // the same params until `time`, where the oscillator's own stop takes
      // its contribution to zero; the rebuilt gain holds 0 until exactly then
      // (`buildChannelEntry`), so the two sum to a continuous value across the
      // seam. Same rule as the silence path above it, and the same reason
      // offline teardown disconnects nothing (voiceManager rule 3).
      this.pendingTeardowns.set(this.nextTeardownId++, {
        readyAt: time,
        // `connection` is non-null for every entry `liveVoicesFor` returns —
        // `generator` and `connection` are always assigned together.
        connections: attached.map((v) => ({ voice: v.voice, connection: v.connection! })),
        generator: entry.generator,
        scaleGain: entry.scaleGain,
      });

      if (attached.length === 0) continue;

      const rebuilt = this.buildChannelEntry(entry.params);
      this.channels.set(source, rebuilt);
      for (const voiceEntry of attached) {
        voiceEntry.generator = rebuilt.generator;
        voiceEntry.params = rebuilt.params;
        voiceEntry.voice.lfoSource = rebuilt.generator.node;
        this.reconcileDestination(rebuilt.scaleGain, voiceEntry, rebuilt.params, time);
      }
    }
  }

  /**
   * Live tempo change: re-rates every SYNC-mode generator currently running
   * (transport channels and any note-triggered voices) in place, at `at`.
   * Hz-mode generators are untouched, by construction of `resolveRateHz`.
   */
  setBpm(bpm: number, at: number): void {
    if (!this.ctx) return;
    this.sweepPendingTeardowns(at);
    this.bpm = bpm;
    for (const entry of this.channels.values()) {
      if (entry.params.rate.mode === 'sync') {
        entry.generator.setRateHz(resolveRateHz(entry.params.rate, this.bpm), at);
      }
    }
    for (const entry of this.voices.values()) {
      if (entry.triggerMode === 'note' && entry.generator && entry.params.rate.mode === 'sync') {
        entry.generator.setRateHz(resolveRateHz(entry.params.rate, this.bpm), at);
      }
    }
  }

  /**
   * Connects `voice` to the LFO `params` describe, at audio-clock time `at`,
   * INCLUDING wiring the depth/route-scaled output onto `voice`'s own real
   * destination (`voice.lfoDestination(params.route.target)`). Transport mode
   * reuses the channel's already-running shared generator (building it,
   * phase-locked to `transportOrigin`, on the first connect) and simply adds
   * one more fan-out `.connect()` for this voice; note mode always builds its
   * own, started and phase-rotated at `at`. A silent config (`isSilent`)
   * connects nothing, via `markDormant` — `voice.lfoSource` and any prior
   * connection this voice held are both cleared.
   */
  connectVoice(voice: LfoVoiceHandle, params: LfoParams, at: number): void {
    if (!this.ctx) return;
    this.sweepPendingTeardowns(at);

    if (isSilent(params)) {
      this.markDormant(voice, params);
      return;
    }

    if (params.triggerMode === 'transport') {
      let entry = this.channels.get(voice.source);
      if (!entry) {
        entry = this.buildChannelEntry(params);
        this.channels.set(voice.source, entry);
      }
      let voiceEntry = this.voices.get(voice.id);
      if (!voiceEntry) {
        voiceEntry = { voice, source: voice.source, triggerMode: 'transport', params, generator: null, connection: null };
        this.voices.set(voice.id, voiceEntry);
      }
      voiceEntry.generator = entry.generator;
      voiceEntry.params = params;
      this.reconcileDestination(entry.scaleGain, voiceEntry, params, at);
      voice.lfoSource = entry.generator.node;
      return;
    }

    const voiceEntry: VoiceEntry = {
      voice,
      source: voice.source,
      triggerMode: 'note',
      params,
      generator: null,
      connection: null,
    };
    this.startNoteVoice(voiceEntry, params, at);
    this.voices.set(voice.id, voiceEntry);
  }

  /**
   * Builds this voice's OWN generator and scale gain and wires them to its own
   * destination — the note-trigger lifetime, where nothing is shared with
   * anyone. Shared by the first connect and by a later revival, because those
   * are the same act: a voice whose LFO was silent when the note started has
   * no generator either, and turning the depth up has to build one exactly the
   * way a note-on would have.
   */
  private startNoteVoice(voiceEntry: VoiceEntry, params: LfoParams, at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const rateHz = resolveRateHz(params.rate, this.bpm);
    const generator = buildGenerator(ctx, params.waveform, rateHz, params.phaseDegrees, at, this.random);
    const scaleGain = ctx.createGain();
    generator.node.connect(scaleGain);
    const destination = voiceEntry.voice.lfoDestination(params.route!.target);
    scaleGain.gain.value = scaleValueFor(params, destination);
    connectDestination(scaleGain, destination);
    voiceEntry.voice.lfoSource = generator.node;
    voiceEntry.generator = generator;
    voiceEntry.connection = { scaleGain, destination, severed: false };
    voiceEntry.params = params;
  }

  /**
   * One note-triggered voice's half of a live patch edit — the per-voice
   * mirror of `updateSource`'s channel half, and the reason the spec's
   * "continuous controls update sounding voices: … LFO rate/depth" is true
   * for the 24 of 32 factory LFO blocks that are note-triggered rather than
   * only for the 8 that are not.
   *
   * The same four decisions the channel half makes, made per voice: a rate
   * change re-rates the running generator in place, a waveform or phase
   * change rebuilds it (a `PeriodicWave`'s rotation cannot be changed on a
   * running oscillator), a target change re-points the edge, and a depth or
   * amount change rewrites the scale — the last two both through
   * `reconcileDestination`, which is also what converts the amount into the
   * destination's own unit.
   *
   * Silence is the one place it deliberately does NOT mirror the channel
   * half. A channel fades, stops its generator and defers the edge teardown,
   * because a channel outlives the voices on it. A voice does not: its
   * generator and scale gain die with it at `disconnectVoice`, which always
   * comes. So depth 0 here is a linear ramp to EXACT zero on this voice's own
   * scale gain and nothing else — contributing exactly nothing for the rest
   * of the note, with no teardown to schedule and, if the knob comes back up,
   * nothing to rebuild.
   *
   * `next.triggerMode` is not consulted: rate, depth and route mean the same
   * thing in either mode, and a voice that is already sounding keeps the
   * lifetime it was born with — flipping the mode applies to the next note.
   */
  private updateNoteVoice(voiceEntry: VoiceEntry, next: LfoParams, at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const connection = voiceEntry.connection;

    if (isSilent(next)) {
      if (connection) {
        const scale = connection.scaleGain.gain;
        scale.cancelScheduledValues(at);
        scale.setValueAtTime(scale.value, at);
        scale.linearRampToValueAtTime(0, at + LFO_DEPTH_FADE_SECONDS);
      }
      voiceEntry.params = next;
      return;
    }

    if (!voiceEntry.generator || !connection) {
      this.startNoteVoice(voiceEntry, next, at);
      return;
    }

    const previous = voiceEntry.params;
    const rateHz = resolveRateHz(next.rate, this.bpm);
    if (previous.waveform !== next.waveform || previous.phaseDegrees !== next.phaseDegrees) {
      // Stopped, not disconnected: severing the old node's edge to the scale
      // gain NOW would silence it before the `at` its stop is scheduled for.
      // The channel half rebuilds the same way.
      voiceEntry.generator.node.stop(at);
      const generator = buildGenerator(ctx, next.waveform, rateHz, next.phaseDegrees, at, this.random);
      generator.node.connect(connection.scaleGain);
      voiceEntry.generator = generator;
      voiceEntry.voice.lfoSource = generator.node;
    } else if (rateHz !== resolveRateHz(previous.rate, this.bpm)) {
      voiceEntry.generator.setRateHz(rateHz, at);
    }

    this.reconcileDestination(connection.scaleGain, voiceEntry, next, at);
    voiceEntry.params = next;
  }

  /**
   * The whole of a live LFO edit for one bus: every note-triggered voice
   * sounding on it (`updateNoteVoice`, one generator each) AND the
   * transport-triggered CHANNEL shared by the rest (below, one generator for
   * all of them). `previous`/`next` are the bus's whole `LfoParams` before and
   * after the edit. Both halves have to run on every call, because which of
   * the two a voice belongs to was decided at ITS note-on and a bus can be
   * carrying voices of both kinds at once.
   *
   * Everything from here to the end of this method is the CHANNEL half.
   *
   * A waveform or phase change rebuilds the generator (there is no way to
   * re-shape a running oscillator's `PeriodicWave` phase without restarting
   * it); a route-TARGET change reconnects the scale gain from every attached
   * voice's OLD destination to its NEW one. Neither rebuilds or reconnects
   * the other's concern unnecessarily: an oscillator rebuild with the SAME
   * target keeps every existing destination edge untouched, and a
   * target-only change re-points those edges without touching the audible
   * oscillator at all — the decision this task is built to. A rate change
   * re-rates the existing generator in place.
   *
   * Turning `next` silent (`isSilent`) ramps the shared scale to exact 0 via
   * `linearRampToValueAtTime` — never `setTargetAtTime`, which is asymptotic
   * and would leave a residual, non-zero contribution forever — and schedules
   * the generator's stop for once that ramp lands. The actual graph-edge
   * disconnect for every attached voice, and for the generator/scale-gain
   * pair itself, is deferred to `sweepPendingTeardowns` rather than run here:
   * disconnecting now, before the ramp has actually played out in audio time,
   * would cut every attached voice's modulation short of the zero the ramp
   * was scheduled to reach.
   */
  updateSource(source: string, previous: LfoParams, next: LfoParams, at: number): void {
    if (!this.ctx) return;
    this.sweepPendingTeardowns(at);

    // The note-triggered voices on this bus first, and unconditionally: each
    // owns its own generator and scale gain, so none of them is reachable
    // through the channel below — `allVoicesFor` filters them out by
    // construction. Leaving this out is what made a live LFO edit a no-op for
    // three quarters of the factory library.
    for (const voiceEntry of this.noteVoicesFor(source)) {
      this.updateNoteVoice(voiceEntry, next, at);
    }

    const entry = this.channels.get(source);

    // Nothing on this channel to reconfigure: no generator running, and no
    // voice — live or dormant — has ever attached to it. Returning rather
    // than falling through to the rebuild below is what makes this method
    // safe to call on EVERY patch edit, which is how a live LFO knob reaches
    // the graph at all: the rebuild builds a generator, and one built for a
    // channel with nothing attached would run forever modulating nothing.
    // The next `connectVoice` builds fresh at the current origin anyway.
    if (!entry && this.allVoicesFor(source).length === 0) return;

    if (isSilent(next)) {
      if (entry) {
        // Only previously-LIVE voices need a fade-then-teardown; a dormant
        // one is already as silent as it gets.
        const attached = this.liveVoicesFor(source);
        entry.scaleGain.gain.cancelScheduledValues(at);
        entry.scaleGain.gain.setValueAtTime(entry.scaleGain.gain.value, at);
        entry.scaleGain.gain.linearRampToValueAtTime(0, at + LFO_DEPTH_FADE_SECONDS);
        entry.generator.node.stop(at + LFO_DEPTH_FADE_SECONDS);
        this.channels.delete(source);
        this.pendingTeardowns.set(this.nextTeardownId++, {
          readyAt: at + LFO_DEPTH_FADE_SECONDS,
          // A snapshot of the CONNECTION OBJECTS this teardown owns, not the
          // live `VoiceEntry` list — see this file's top doc. `connection`
          // is guaranteed non-null here: `liveVoicesFor` only returns
          // entries whose `generator` is set, and `generator`/`connection`
          // are always assigned together.
          connections: attached.map((v) => ({ voice: v.voice, connection: v.connection! })),
          generator: entry.generator,
          scaleGain: entry.scaleGain,
        });
      }
      return;
    }

    // `isSilent(next)` already returned above when `next.route` is null, so
    // every route read from here on — `reconcileDestination` reads
    // `params.route!.target` — is against a route guaranteed non-null.
    const rateHz = resolveRateHz(next.rate, this.bpm);
    const needsOscillatorRebuild = !entry || entry.params.waveform !== next.waveform || entry.params.phaseDegrees !== next.phaseDegrees;

    if (needsOscillatorRebuild) {
      if (entry) entry.generator.node.stop(at);
      const generator = buildGenerator(this.ctx, next.waveform, rateHz, next.phaseDegrees, this.transportOrigin, this.random);
      const scaleGain = entry?.scaleGain ?? this.ctx.createGain();
      generator.node.connect(scaleGain);
      this.channels.set(source, { params: next, generator, scaleGain });

      // Every voice ever attached to this channel — previously live (its
      // generator now stale) AND dormant (silent since before this channel
      // went live, or since a fade completed) alike — must end up wired to
      // the REBUILT generator/scale gain. Gating this on "did the target
      // change" alone is exactly the bug a prior review round caught: a
      // dormant voice's destination is never wired unless
      // `reconcileDestination` runs unconditionally here.
      for (const voiceEntry of this.allVoicesFor(source)) {
        voiceEntry.generator = generator;
        voiceEntry.params = next;
        voiceEntry.voice.lfoSource = generator.node;
        this.reconcileDestination(scaleGain, voiceEntry, next, at);
      }
      return;
    }

    // The oscillator survives untouched below this point — see this method's
    // own doc and Important #1 of an earlier review round: a target change
    // must reconnect, never rebuild. `reconcileDestination` is a no-op for a
    // voice already correctly wired, so this one loop covers a target
    // change, a rate-only change, and (defensively) a dormant voice found on
    // an otherwise-live channel, without needing to branch on which.
    for (const voiceEntry of this.allVoicesFor(source)) {
      this.reconcileDestination(entry.scaleGain, voiceEntry, next, at);
      voiceEntry.params = next;
    }

    if (rateHz !== resolveRateHz(previous.rate, this.bpm)) {
      entry.generator.setRateHz(rateHz, at);
    }
    this.channels.set(source, { ...entry, params: next });
  }

  /**
   * Removes `voice`'s connection, severing exactly its own destination
   * edge(s) — never another voice's fan-out from the same shared scale gain.
   * A note-triggered voice's generator is dedicated, so it is fully stopped
   * and disconnected here too: nothing else will ever read it. A
   * transport-triggered voice only drops its own edge and bookkeeping entry;
   * the channel's shared generator keeps running for every other voice still
   * on it, and is torn down only by `setTransportOrigin` or by
   * `updateSource` turning the channel silent.
   */
  /**
   * The OFFLINE counterpart of `disconnectVoice`: drop the voice's bookkeeping
   * and stop its dedicated generator ON THE AUDIO CLOCK, touching no edge.
   *
   * Offline, `SynthVoiceManager.scheduleTeardown` runs SYNCHRONOUSLY while the
   * render is still being scheduled — there is no timer to defer it to — so a
   * `disconnect()` here would cut the edge out of the graph before a single
   * sample had been rendered, silencing the modulation for the whole render
   * rather than from the teardown instant. That is rule 3's "no disconnect
   * offline", and it stands.
   *
   * What does NOT follow from it is leaving the generator running. A
   * note-triggered LFO's oscillator is started by `startNoteVoice` and stopped
   * nowhere else, so without this every note's generator free-ran to the end of
   * the render and `this.voices` grew one entry per note ever played — which
   * the three `[...this.voices.values()]` lookups then walked in full.
   * `stop(at)` is scheduled, not immediate, so it removes the cost without
   * moving a sample: `at` is past the voice's own release.
   */
  /**
   * Drops a voice from the bank's books and hands back what it was holding.
   *
   * Shared by the two teardowns so their one difference is their TAIL. Written
   * out twice, the copy immediately drifted: the offline half tested
   * `entry.params.triggerMode` where every other site tests `entry.triggerMode`,
   * and those are different facts — `params` is replaced wholesale by each
   * update while `triggerMode` records what the generator was actually BUILT
   * as, which `updateNoteVoice` deliberately never revisits (see its docblock).
   * A voice switched note -> transport mid-note therefore stopped nothing.
   */
  private forgetVoice(voice: LfoVoiceHandle): VoiceEntry | null {
    const entry = this.voices.get(voice.id);
    voice.lfoSource = undefined;
    if (!entry) return null;
    this.voices.delete(voice.id);
    return entry;
  }

  retireVoiceOffline(voice: LfoVoiceHandle, at: number): void {
    if (!this.ctx) return;
    const entry = this.forgetVoice(voice);
    if (!entry) return;
    if (entry.triggerMode === 'note' && entry.generator) {
      entry.generator.node.stop(at);
    }
  }

  disconnectVoice(voice: LfoVoiceHandle): void {
    if (!this.ctx) return;
    const entry = this.forgetVoice(voice);
    if (!entry) return;
    // `severConnection` sets `connection.severed`, on the SAME object a
    // still-pending channel teardown may also hold a reference to — see
    // this file's top doc. Whichever of the two gets here first wins; the
    // other finds `severed` already true and does nothing.
    severConnection(entry.connection);
    if (entry.triggerMode === 'note' && entry.generator) {
      entry.generator.node.stop();
      entry.generator.node.disconnect();
      entry.connection?.scaleGain.disconnect();
    }
  }

  /**
   * Transitions `voice` to dormant on its channel: any live edge it
   * currently holds is torn down (and, for a note-triggered voice, its
   * dedicated generator is genuinely stopped and disconnected — the same
   * "depth 0 must actually reach silence" contract `updateSource` applies at
   * the channel level), but the `VoiceEntry` itself is KEPT, with
   * `generator`/`connection` set to `null` and `params` recording what this
   * voice last asked for. This is what lets a later `updateSource` revival
   * of this voice's channel find it — via `allVoicesFor` — and reconnect it,
   * whether it went dormant here (an `isSilent` `connectVoice`) or via a
   * channel-wide fade (`updateSource`'s `isSilent` branch, through
   * `sweepPendingTeardowns`). One shape, one revival path, for both origins.
   */
  private markDormant(voice: LfoVoiceHandle, params: LfoParams): void {
    const existing = this.voices.get(voice.id);
    if (existing) {
      severConnection(existing.connection);
      if (existing.triggerMode === 'note' && existing.generator) {
        existing.generator.node.stop();
        existing.generator.node.disconnect();
        existing.connection?.scaleGain.disconnect();
      }
    }
    voice.lfoSource = undefined;
    this.voices.set(voice.id, {
      voice,
      source: voice.source,
      triggerMode: params.triggerMode,
      params,
      generator: null,
      connection: null,
    });
  }

  /**
   * Makes "`voiceEntry` has an edge from `scaleGain` to its OWN current
   * destination for `target`, and no other" true, in one place — the single
   * connection rule every call site above defers to instead of branching on
   * "did the target change" / "was this voice dormant" / "did the generator
   * get rebuilt" separately. A no-op when `voiceEntry` is already correctly
   * wired to this exact `scaleGain`, which is what keeps a plain rate-only
   * `updateSource` call (no reconnection needed at all) cheap and silent.
   *
   * Never mutates the OLD `VoiceConnection` in place — it calls
   * `severConnection` on it (a no-op if some other caller already severed
   * it first) and builds a brand NEW `VoiceConnection` for the new
   * `(scaleGain, destination)` pair. This is what keeps a `PendingTeardown`
   * holding a reference to that old object safe: nothing here can change
   * what it points at after the fact.
   */
  private reconcileDestination(scaleGain: GainNode, voiceEntry: VoiceEntry, params: LfoParams, at: number): void {
    const destination = voiceEntry.voice.lfoDestination(params.route!.target);
    // Written on every pass, BEFORE the already-wired early return: a depth or
    // amount edit changes what the gain must hold without changing which param
    // it reaches, and the conversion into that param's unit is only knowable
    // once `lfoDestination` has resolved it. This is the one place the scale
    // gain is written for a transport channel, which is what keeps "the amount
    // in the route's unit" and "the value on the graph" from ever being two
    // different numbers computed in two different places.
    // Cancel first, then write: this is the one place the scale gain is set, so
    // the write has to be authoritative over whatever is still booked on it.
    // `updateNoteVoice`'s silent branch leaves a `linearRampToValueAtTime(0, at
    // + LFO_DEPTH_FADE_SECONDS)` in flight and does NOT tear the voice down, so
    // a depth that comes back up inside those 50 ms lands here with both the
    // generator and the connection still set. Without the cancel the ramp
    // survives — and since a linear ramp interpolates from the event
    // immediately before it, this `setValueAtTime` becomes its new start: the
    // gain steps up and then slides to exactly 0, with nothing scheduled after,
    // silencing the LFO for the rest of the note while Depth still reads
    // non-zero. The channel half escapes only because its revival builds a
    // fresh GainNode; a note voice reuses this one.
    scaleGain.gain.cancelScheduledValues(at);
    scaleGain.gain.setValueAtTime(scaleValueFor(params, destination), at);
    const current = voiceEntry.connection;
    if (current && !current.severed && current.scaleGain === scaleGain && destinationsEqual(current.destination, destination)) {
      return;
    }
    // Only sever a connection that was actually wired to THIS gain before —
    // `severConnection` itself is safe to call on any connection (or `null`)
    // regardless, but a connection built for a DIFFERENT, already-discarded
    // scale gain is not this reconnect's to sever; whatever teardown (or
    // `disconnectVoice`) owns it does that on its own schedule.
    if (current && current.scaleGain === scaleGain) {
      severConnection(current);
    }
    connectDestination(scaleGain, destination);
    voiceEntry.connection = { scaleGain, destination, severed: false };
  }

  /** Every voice — live or dormant — ever attached to the transport channel `source`. */
  private allVoicesFor(source: string): VoiceEntry[] {
    return [...this.voices.values()].filter((v) => v.source === source && v.triggerMode === 'transport');
  }

  /** Every note-triggered voice on `source` — each with a generator and scale gain of its very own. */
  private noteVoicesFor(source: string): VoiceEntry[] {
    return [...this.voices.values()].filter((v) => v.source === source && v.triggerMode === 'note');
  }

  /** `allVoicesFor`, narrowed to voices currently holding a live generator. */
  private liveVoicesFor(source: string): VoiceEntry[] {
    return this.allVoicesFor(source).filter((v) => v.generator !== null);
  }

  /** Builds a fresh transport-channel generator + scale gain, phase-locked to the current `transportOrigin`. Connects nothing to any destination — the caller fans that out per attached voice. */
  private buildChannelEntry(params: LfoParams): ChannelEntry {
    const ctx = this.ctx;
    if (!ctx) throw new Error('SynthLfoBank is disposed');
    const rateHz = resolveRateHz(params.rate, this.bpm);
    const generator = buildGenerator(ctx, params.waveform, rateHz, params.phaseDegrees, this.transportOrigin, this.random);
    const scaleGain = ctx.createGain();
    // Silent until a voice has resolved its own destination: the route amount
    // means nothing until it has been converted into the unit of the param it
    // will land on, and only the voice knows that conversion. Every caller
    // runs `reconcileDestination` for each attached voice immediately after
    // this returns, and THAT is what writes the real value.
    scaleGain.gain.value = 0;
    generator.node.connect(scaleGain);
    return { params, generator, scaleGain };
  }

  /**
   * Flushes every pending silence-teardown whose `readyAt` has passed `at` —
   * the point in audio-clock time the shared scale's ramp-to-zero, scheduled
   * by `updateSource`, actually lands. Severing these edges only once that
   * instant has genuinely passed is what keeps the ramp click-free: cutting
   * the connection earlier would drop each attached voice's modulation from
   * whatever it held straight to silence, instead of letting the scheduled
   * ramp reach it. Driven purely by the `at`/`time` every public method
   * already receives — no timer, no `ctx.currentTime` read — so it runs
   * identically whether this bank is bound to a realtime or an
   * `OfflineAudioContext`; the only real difference is how often something
   * happens to call in and give it a fresh `at` to sweep against.
   */
  private sweepPendingTeardowns(at: number): void {
    for (const [id, pending] of this.pendingTeardowns) {
      if (pending.readyAt > at) continue;
      for (const { voice, connection } of pending.connections) {
        // `severConnection` is a no-op if `disconnectVoice` already severed
        // this SAME shared object first — see this file's top doc.
        severConnection(connection);
        const voiceEntry = this.voices.get(voice.id);
        // Only transition this voice's LIVE bookkeeping to dormant if it is
        // STILL the one this teardown owns: a channel revival that ran
        // BEFORE this sweep already replaced `voiceEntry.connection` (and
        // `.generator`) with a fresh one via `reconcileDestination`, and
        // that fresh state must not be clobbered back to dormant by a stale
        // sweep for an edge the voice has already moved on from.
        if (voiceEntry && voiceEntry.connection === connection) {
          voiceEntry.voice.lfoSource = undefined;
          voiceEntry.generator = null;
          voiceEntry.connection = null;
        }
      }
      pending.generator.node.disconnect();
      pending.scaleGain.disconnect();
      this.pendingTeardowns.delete(id);
    }
  }
}
