import type {
  AdsrParams,
  EnginePatch,
  ModRoute,
  ModTarget,
  NoiseColor,
  OscillatorParams,
  SubtractiveParams,
} from '@/types/synth';
import { noteFrequency } from '@/utils/musicTheory';
import { dbToGain, GAIN_PER_DB_AT_UNITY, semitonesToRatio } from '@/utils/synthPatch';
import { random } from '../rng';
import type { VoiceOwner } from '../voiceOwner';
import { driveCurve } from './driveCurve';
import {
  CENTS_PER_SEMITONE,
  envelopeValueAt,
  releaseScheduledParam,
  releaseScheduledParamTo,
  scheduleAdsr,
  schedulePitchEnvelope,
  type AutomationParam,
  type EnvelopeLevels,
  type EnvelopeTiming,
} from './modulation';
import { createNoiseBuffer } from './noise';
import type { LfoDestination } from './synthLfo';

/**
 * One sounding subtractive voice: graph construction, the ENV2 modulation
 * router, live parameter updates and node teardown (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Engine and voice lifecycle").
 *
 * ```
 * osc1 -> osc1Gain  \
 * osc2 -> osc2Gain   \
 * sub  -> subGain     >-- drive -> filter -> ampGain -> tremoloGain -> panner -> destination
 * noise-> noiseGain  /      (ENV1 is here ^)   (ENV2 amplitude is here ^)
 * ```
 *
 * Three rules this file exists to keep:
 *
 * 1. **Amplitude modulation multiplies on its own node.** ENV2's `amplitude`
 *    route and (later) the LFO's both land on `tremoloGain`, a unity gain in
 *    SERIES after the amp envelope — never on `ampGain.gain`. Web Audio SUMS
 *    a connected node with a param's own automation, so a modulator on the
 *    amp envelope's param would stop the release ever reaching silence and
 *    would invert phase on the downswing. This repo has shipped exactly that
 *    bug; see the dsp-audio skill's note on the legacy LFO volume target.
 * 2. **`detune` is reserved for modulation.** Every static tuning input —
 *    octave, semitone, fine cents, the unison spread — is folded into
 *    `frequency` as a ratio, so an oscillator's `detune` is 0 whenever
 *    nothing is modulating it. That is what lets ENV2's pitch contour be
 *    scheduled there against a base of 0 and lets a later LFO connection sum
 *    into the same param without either one having to know the other's offset.
 * 3. **It runs unchanged offline.** `ctx` is a `BaseAudioContext` and every
 *    scheduled time comes from the caller — this module never reads
 *    `ctx.currentTime`. The offline mixdown render binds the same code to an
 *    `OfflineAudioContext`.
 *
 * `src/audio/` may not import `src/store/` or `src/components/`: a voice is
 * handed a complete `EnginePatch` and knows nothing about where it came from.
 */

/** Where a voice's output goes. One field today; a group so a new tap is not a signature change. */
export interface SubtractiveVoiceDestinations {
  output: AudioNode;
}

/**
 * A note-on, as the voice needs it. `unisonIndex` names WHICH member of a
 * unison stack this voice is — the voice manager creates one voice per member
 * — and defaults to 0, which is the only legal index when `unisonVoices` is 1.
 * `scaleFactor` multiplies every envelope SEGMENT TIME — attack, decay and
 * release, on both envelopes — so a value below 1 makes a shorter envelope,
 * not a quieter one.
 *
 * It does NOT mean what the legacy engine's argument of the same name meant.
 * There, `scaleFactor` multiplied the amp envelope's PEAK GAIN (`peakGain =
 * velocity * 0.4 * scaleFactor * trim`), which is how equal-power polyphony
 * reached a voice. A caller carried over from that engine would make a chord
 * quieter here by making it shorter. Level belongs to `velocity` and to
 * `common.outputGainDb`; polyphony ducking belongs to the manager's own
 * `setPolyphonyScale`.
 *
 * Nothing varies it today — every caller passes 1, `SynthVoiceNoteOn` defaults
 * it, and the sequenced-note shortening it was built for is not wired up. It
 * stays because the timing knob is the one a melody grid will want and because
 * removing a parameter is not a reason to re-derive the envelope math; a
 * reader should not infer from a call site that it is load-bearing.
 */
export interface SubtractiveVoiceEvent {
  source: string;
  owner: VoiceOwner;
  noteName: string;
  velocity: number;
  at: number;
  unisonIndex?: number;
  scaleFactor?: number;
}

/**
 * A per-oscillator-slot node pair, as a TUPLE: the patch has exactly two
 * oscillator slots, so the length is part of the contract rather than
 * something a reader has to check.
 */
export type OscillatorSlots<T> = [T | null, T | null];

/**
 * The voice's nodes, grouped.
 *
 * `oscillators`/`oscillatorGains` are SLOT-INDEXED and always length 2, with
 * `null` where that slot is disabled — a disabled source creates no node at
 * all, and a slot index is how every `ModTarget` names an oscillator
 * (`osc1-pitch`, `osc2-level`), so a dense array would silently re-point a
 * route at the wrong oscillator the moment slot 1 was the only one enabled.
 */
export interface SubtractiveVoiceNodes {
  oscillators: OscillatorSlots<OscillatorNode>;
  oscillatorGains: OscillatorSlots<GainNode>;
  sub: OscillatorNode | null;
  subGain: GainNode | null;
  noise: AudioBufferSourceNode | null;
  noiseGain: GainNode | null;
  drive: WaveShaperNode;
  filter: BiquadFilterNode;
  ampGain: GainNode;
  tremoloGain: GainNode;
  /** Equal-power polyphony's own gain — see `setPolyphonyScale`. */
  polyGain: GainNode;
  panner: StereoPannerNode;
}

export interface SubtractiveVoice {
  readonly id: string;
  readonly source: string;
  readonly owner: VoiceOwner;
  /**
   * The note this voice is sounding NOW, which is not always the note that
   * built it: `glideTo` rewrites it, so a Mono voice carried across a legato
   * phrase reports the pitch in the air rather than the one it was born on.
   */
  readonly noteName: string;
  readonly startedAt: number;
  readonly nodes: SubtractiveVoiceNodes;
  /**
   * Opaque slot `SynthLfoBank` (`synthLfo.ts`) writes an identity into when it
   * connects this voice's LFO — the raw shared generator for a transport
   * trigger, a dedicated one for a note trigger. This voice never reads or
   * interprets it: mutable and untyped beyond `unknown` on purpose, so
   * `subtractiveVoice.ts` stays ignorant of transport/trigger concepts and
   * the bank stays the only place `===` on this field means anything
   * ("do two voices share one phase-locked LFO source").
   */
  lfoSource?: unknown;
  /**
   * The real destination(s) for a `ModTarget` on THIS voice's own graph AND
   * the conversion into their unit, or `null` if this voice has none right
   * now (a disabled oscillator slot has no `detune`/`gain` to modulate).
   * `SynthLfoBank` (`synthLfo.ts`) is the only caller — it resolves an
   * `LfoParams.route.target` through this rather than reaching into `nodes`
   * itself, so this file stays the one place that knows a target's node
   * mapping (the same mapping ENV2's `scheduleModEnvelope` above already
   * encodes for its own routes) AND the one place that knows what a route
   * amount is worth once it lands there — see `LfoDestination.unitScale`.
   */
  lfoDestination(target: ModTarget): LfoDestination | null;
  /**
   * Starts ENV1's release to silence at `at`, and walks every ENV2 destination
   * back to base. `at` may be in the FUTURE — every release anchor is computed
   * from the envelope rather than read off the param, so a note-off booked
   * ahead of time lands on the value the param will actually hold.
   *
   * Calling it a SECOND time shortens the tail rather than restarting it,
   * which is what a steal, a loop load or a vibe swap landing on a release
   * needs. The anchor is always the value the param will hold at the release
   * time being scheduled: the release already in flight if that release has
   * begun by then (its own start instant included), otherwise the note envelope
   * — a second release can be scheduled EARLIER than the first, and strictly
   * before the first one's start the param is still on the note envelope. Anchoring at the note envelope's
   * sustain during a running release would snap the gain back to full and fade
   * it over the shorter time; anchoring on a future release's held value
   * during an attack would step it up. Both are clicks.
   */
  release(at: number, seconds: number): void;
  /** Applies the continuous controls that differ between two patches to this sounding voice. */
  update(previous: EnginePatch<'subtractive'>, next: EnginePatch<'subtractive'>, at: number): void;
  /**
   * Ramps the polyphony gain to `scale` over `POLYPHONY_RAMP_SECONDS` from
   * `at`. A RAMP, not a step: this fires while the voice is sounding — another
   * key just went down or came up — and a gain step under a held note is a
   * click. Linear, because the ramp is short enough that the curve is
   * inaudible and linear can reach zero, which an exponential ramp cannot.
   *
   * Idempotent in effect: re-applying the scale the voice already carries
   * schedules a ramp to the same value. The manager does not de-duplicate,
   * because a cancel-and-compare would cost more than the write it saves.
   *
   * A scale landing INSIDE the previous ramp — a third key inside a chord's
   * attack, which is 15 ms — continues that ramp from where it had got to at
   * `at`, computed rather than read off the param. See the implementation for
   * the two different wrong answers `gain.value` gives.
   */
  setPolyphonyScale(scale: number, at: number): void;
  /**
   * Retunes every pitched source — both oscillator slots and the sub — to
   * `noteName`, exponentially in Hz over `seconds`; `seconds` of 0 moves the
   * pitch on the instant. A key-tracked cutoff follows, unless ENV2 owns it.
   *
   * No envelope is touched: this is the legato half of Mono voice mode, where
   * an overlapping note bends the sounding voice instead of starting a new
   * one. A RETRIGGER is a new voice, never a glide.
   *
   * `at` may be in the FUTURE, and a glide booked while another is still in
   * flight anchors on the value the running ramp WILL hold at `at` — computed
   * from the ramp, never read off `param.value`, for the same reason
   * `release` computes its own anchors.
   */
  glideTo(noteName: string, at: number, seconds: number): void;
  /**
   * Schedules every source to stop at the audio-clock time `at`, and touches
   * no edge of the graph. Idempotent. This is the half of teardown that can be
   * booked ahead, and it is the ONLY half an `OfflineAudioContext` render may
   * use — see `teardown` below.
   */
  stopSources(at: number): void;
  /**
   * Disconnects every node. Idempotent, and deliberately takes NO time: a
   * `disconnect()` cannot be scheduled, it happens the instant it is called.
   * Call it once the release tail has actually elapsed in wall time, never at
   * the audio-clock instant the tail is due to end.
   */
  disconnect(): void;
  /**
   * `stopSources(at)` followed by `disconnect()`, for the one case where both
   * are safe together: the voice's tail has ALREADY finished.
   *
   * **Precondition: `at` is now or in the past.** With `at` in the future this
   * schedules the stop correctly and then cuts the graph immediately, so
   * `release(t, r); teardown(t + r)` written synchronously silences the voice
   * on the spot instead of after its release — the same scar the flat engine
   * this replaced carried in its own release path, where the disconnect was
   * deferred to a wall-clock timer sized to the tail. A caller with a
   * future time wants `stopSources(at)` now and `disconnect()` later; a caller
   * rendering offline wants `stopSources(at)` and NO disconnect at all,
   * because an offline context may render slower than wall time and the
   * throwaway context is discarded whole when the render ends.
   */
  teardown(at: number): void;
}

/**
 * The note key tracking is measured from: C4, the same reference the rest of
 * the app treats as middle C. At `keyTrack` 1 the cutoff follows the note
 * exactly (an octave up doubles it); at 0 it does not move.
 */
const KEY_TRACK_REFERENCE_HZ = 261.6255653;

/** Below 20 Hz the filter is doing nothing audible and an eventual ramp through 0 is illegal. */
const MIN_CUTOFF_HZ = 20;

/** Above the top of hearing there is nothing left to filter, whatever the sample rate allows. */
const MAX_CUTOFF_HZ = 20_000;

/**
 * How close to Nyquist a cutoff may sit. A biquad's coefficients degenerate as
 * the cutoff approaches Nyquist, so the ceiling is a fraction of the sample
 * rate rather than exactly half of it. At 44.1 kHz this is 21.6 kHz — above
 * `MAX_CUTOFF_HZ`, so it binds only at the reduced rates an offline render or
 * a test can use.
 */
const NYQUIST_FRACTION = 0.49;

/**
 * The `Q` values the unitless 0..1 `resonance` control maps onto,
 * geometrically. `MIN_Q` is Butterworth — the flattest passband, which is what
 * "no resonance" has to mean — and `MAX_Q` is a strong, still-stable peak.
 * Calibration, chosen by ear against the legacy engine's `filterResonance`
 * range; from this commit on they are the mapping, not a starting guess.
 */
const MIN_Q = 0.7071;
/**
 * How long a polyphony re-balance takes. Short enough to read as instant when
 * a key goes down, long enough that the step is not a click. It is a ramp on a
 * gain the envelope never touches, so it can overlap an attack without
 * disturbing it.
 */
const POLYPHONY_RAMP_SECONDS = 0.015;

const MAX_Q = 18;

/**
 * A voice needs an identity that outlives the note name that made it (two
 * voices can sound the same note on the same bus). Module-scope counter rather
 * than a random id: it is deterministic, which an offline render wants, and
 * uniqueness within one page load is all an id is asked for here.
 */
let nextVoiceSerial = 0;

/**
 * Noise buffers, cached per context AND per color. A buffer belongs to the
 * context that created it, so the outer key is the context — a `WeakMap`, so a
 * closed context's buffers are collectable with it. Generating one per voice
 * would fill `sampleRate * 2` floats on every note-on.
 */
const noiseBufferCache = new WeakMap<BaseAudioContext, Map<NoiseColor, AudioBuffer>>();

function noiseBufferFor(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  let byColor = noiseBufferCache.get(ctx);
  if (!byColor) {
    byColor = new Map();
    noiseBufferCache.set(ctx, byColor);
  }
  const cached = byColor.get(color);
  if (cached) return cached;
  const buffer = createNoiseBuffer(ctx, color, random);
  byColor.set(color, buffer);
  return buffer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The cutoff ceiling at this sample rate: the audible top, or Nyquist's neighbourhood if lower. */
function maxCutoffFor(sampleRate: number): number {
  return Math.max(MIN_CUTOFF_HZ, Math.min(MAX_CUTOFF_HZ, sampleRate * NYQUIST_FRACTION));
}

function clampCutoffHz(hz: number, sampleRate: number): number {
  return clamp(hz, MIN_CUTOFF_HZ, maxCutoffFor(sampleRate));
}

/**
 * The cutoff key tracking puts this voice's filter at for a given note, BEFORE
 * the Nyquist clamp — ENV2 measures its contour from the unclamped value, so
 * the clamp is the caller's to apply. One function rather than the same
 * `Math.pow` in three places: construction, a live cutoff change and a glide
 * must all land on the same number or a glide would step the filter.
 */
function keyTrackedCutoff(cutoffHz: number, keyTrack: number, frequency: number): number {
  return cutoffHz * Math.pow(frequency / KEY_TRACK_REFERENCE_HZ, clamp(keyTrack, 0, 1));
}

/**
 * Oversampling is ON only when the stage is actually saturating.
 * `WaveShaperNode` oversampling runs the signal through implementation-defined
 * up- and downsampling filters, so a '2x' shaper colours what passes through
 * it even when its curve is the identity — which would make the drive knob's
 * neutral position audible, the one thing `driveCurve` exists to prevent. At
 * 0 dB and below the curve is the identity and 'none' keeps the stage
 * genuinely transparent; above it, aliasing is the real risk and '2x' earns
 * its cost.
 */
function driveOversample(driveDb: number): OverSampleType {
  return driveDb > 0 ? '2x' : 'none';
}

function resonanceToQ(resonance: number): number {
  return MIN_Q * Math.pow(MAX_Q / MIN_Q, clamp(resonance, 0, 1));
}

function timingOf(envelope: AdsrParams, scaleFactor: number): EnvelopeTiming {
  return {
    attackSeconds: envelope.attack * scaleFactor,
    decaySeconds: envelope.decay * scaleFactor,
    sustain: clamp(envelope.sustain, 0, 1),
    releaseSeconds: envelope.release * scaleFactor,
  };
}

/**
 * Where this unison member sits in the stack, as -1..1: the lowest/leftmost
 * member is -1, the highest/rightmost is 1, and a stack of ONE is 0. That last
 * case is the reason this is a function and not an interpolation written
 * inline — a single voice must be dead centre and dead in tune whatever
 * `unisonDetuneCents` and `stereoWidth` say, and `(i / (count - 1))` divides
 * by zero there.
 */
function unisonSpread(index: number, count: number): number {
  if (count <= 1) return 0;
  return (clamp(index, 0, count - 1) / (count - 1)) * 2 - 1;
}

/** Total semitones an oscillator slot is tuned by, static inputs only. */
function staticSemitones(osc: OscillatorParams, unisonCents: number): number {
  return osc.octave * 12 + osc.semitone + (osc.fineCents + unisonCents) / 100;
}

/**
 * Each pitched source's frequency as a RATIO of the voice's note frequency.
 * Held rather than recomputed because a glide has to move every source
 * together: multiplying the new note by these is the only way the sub stays an
 * octave down and slot 2 stays a fifth up through a bend, and reading a ratio
 * back off a param mid-ramp would read a value that is still moving.
 */
interface SourceRatios {
  oscillators: [number, number];
  sub: number;
}

function sourceRatios(synth: SubtractiveParams, unisonCents: number): SourceRatios {
  return {
    oscillators: [
      semitonesToRatio(staticSemitones(synth.oscillators[0], unisonCents)),
      semitonesToRatio(staticSemitones(synth.oscillators[1], unisonCents)),
    ],
    sub: semitonesToRatio(synth.utility.subOctave * 12),
  };
}

/**
 * Every ENV2 route amount, summed per destination. Summing here rather than
 * scheduling each route separately is what makes two routes onto one
 * destination correct: both share ENV2's single contour, so `pitch-all` +12
 * alongside `osc2-pitch` -5 is one envelope to +7 semitones on slot 2 — two
 * envelopes on the same `AudioParam` would have the later `setValueAtTime`
 * overwrite the earlier one's anchor instead of adding to it.
 */
interface RouteAmounts {
  oscSemitones: [number, number];
  /**
   * `pitch-all`'s share only. The sub is a PITCHED source with no slot of its
   * own — no `sub-pitch` target exists — so `osc1-pitch`/`osc2-pitch` name an
   * oscillator and never reach it, while `pitch-all` means every pitched
   * source in the voice and must.
   */
  subSemitones: number;
  oscDb: [number, number];
  cutoffSemitones: number;
  resonanceDelta: number;
  amplitudeDb: number;
  pan: number;
}

function sumRouteAmounts(routes: ModRoute[]): RouteAmounts {
  const amounts: RouteAmounts = {
    oscSemitones: [0, 0],
    subSemitones: 0,
    oscDb: [0, 0],
    cutoffSemitones: 0,
    resonanceDelta: 0,
    amplitudeDb: 0,
    pan: 0,
  };
  for (const route of routes) {
    switch (route.target) {
      case 'pitch-all':
        amounts.oscSemitones[0] += route.amount;
        amounts.oscSemitones[1] += route.amount;
        amounts.subSemitones += route.amount;
        break;
      case 'osc1-pitch':
        amounts.oscSemitones[0] += route.amount;
        break;
      case 'osc2-pitch':
        amounts.oscSemitones[1] += route.amount;
        break;
      case 'osc1-level':
        amounts.oscDb[0] += route.amount;
        break;
      case 'osc2-level':
        amounts.oscDb[1] += route.amount;
        break;
      case 'filter-cutoff':
        amounts.cutoffSemitones += route.amount;
        break;
      case 'filter-resonance':
        amounts.resonanceDelta += route.amount;
        break;
      case 'amplitude':
        amounts.amplitudeDb += route.amount;
        break;
      case 'pan':
        amounts.pan += route.amount;
        break;
    }
  }
  return amounts;
}

/**
 * An ENV2 destination, the unmodulated value its release walks back to, and
 * the two levels its contour runs between. The levels are kept because a
 * release may be SCHEDULED AHEAD: the value the param holds at that future
 * instant has to be computed from the envelope (`envelopeValueAt`), never read
 * off `param.value`, which reports the value now.
 */
interface ModDestination {
  param: AutomationParam;
  levels: EnvelopeLevels;
}

/**
 * What the live-update and glide paths measure from. Some of it is fixed at
 * construction (`amounts`, `unisonCents`, `spread`, `sampleRate`) and some of
 * it is REWRITTEN as the voice is retuned: `baseFrequency` follows a glide,
 * `ratios` and `filter` follow a live patch update. Holding the current values
 * here is what lets a knob moved after a glide tune from the note in the air
 * rather than from the note that built the voice. `amounts` is here only to
 * tell which destinations ENV2 owns, and which an update or a glide must
 * therefore leave alone.
 */
interface VoiceTuning {
  amounts: RouteAmounts;
  unisonCents: number;
  spread: number;
  baseFrequency: number;
  ratios: SourceRatios;
  filter: { cutoffHz: number; keyTrack: number };
  sampleRate: number;
}

/** The fixed tail every source feeds, plus the unmodulated values ENV2 measures from. */
interface VoiceTail {
  drive: WaveShaperNode;
  filter: BiquadFilterNode;
  ampGain: GainNode;
  tremoloGain: GainNode;
  polyGain: GainNode;
  panner: StereoPannerNode;
  /** The key-tracked cutoff BEFORE clamping — what a routed cutoff is derived from. */
  unclampedCutoff: number;
  baseCutoff: number;
  baseQ: number;
}

/**
 * Builds drive -> filter -> amp -> tremolo -> poly -> pan -> destination, tail
 * first so every source built afterwards has something to connect to.
 */
function buildTail(
  ctx: BaseAudioContext,
  synth: SubtractiveParams,
  baseFrequency: number,
  panPosition: number,
  destinations: SubtractiveVoiceDestinations,
): VoiceTail {
  const panner = ctx.createStereoPanner();
  panner.pan.value = panPosition;
  panner.connect(destinations.output);

  // Equal-power polyphony, on a node of its OWN. It has to be separable from
  // both of its neighbours: the amp envelope above it cannot be re-planned
  // mid-note without a click, and `tremoloGain` carries whatever contour ENV2's
  // amplitude route and the LFO have scheduled, so a `setValueAtTime` there
  // would re-anchor that contour and collapse the modulation. Unity until the
  // manager says otherwise, and always created — a voice that had to grow one
  // mid-note could not do it silently, the same reason `tremoloGain` is
  // unconditional.
  const polyGain = ctx.createGain();
  polyGain.gain.value = 1;
  polyGain.connect(panner);

  const tremoloGain = ctx.createGain();
  // Unity and always created, even with no amplitude route: this is the node
  // an LFO's amplitude target attaches to, and a voice that had to grow one
  // mid-note could not do it without a click.
  tremoloGain.gain.value = 1;
  tremoloGain.connect(polyGain);

  const ampGain = ctx.createGain();
  // Silent until ENV1 says otherwise. A `GainNode` starts at unity, so a voice
  // scheduled ahead of time would pass its sources at full level between
  // construction and its own note-on instant.
  ampGain.gain.value = 0;
  ampGain.connect(tremoloGain);

  const filter = ctx.createBiquadFilter();
  filter.type = synth.filter.type;
  const unclampedCutoff = keyTrackedCutoff(synth.filter.cutoffHz, synth.filter.keyTrack, baseFrequency);
  const baseCutoff = clampCutoffHz(unclampedCutoff, ctx.sampleRate);
  const baseQ = resonanceToQ(synth.filter.resonance);
  filter.frequency.value = baseCutoff;
  filter.Q.value = baseQ;
  filter.connect(ampGain);

  const drive = ctx.createWaveShaper();
  drive.curve = driveCurve(synth.filter.driveDb);
  drive.oversample = driveOversample(synth.filter.driveDb);
  drive.connect(filter);

  return { drive, filter, ampGain, tremoloGain, polyGain, panner, unclampedCutoff, baseCutoff, baseQ };
}

/** Every source node this patch enables, already started and wired into `drive`. */
interface VoiceSources {
  oscillators: OscillatorSlots<OscillatorNode>;
  oscillatorGains: OscillatorSlots<GainNode>;
  sub: OscillatorNode | null;
  subGain: GainNode | null;
  noise: AudioBufferSourceNode | null;
  noiseGain: GainNode | null;
  /** Flat list for teardown — the one place that does not care which source is which. */
  started: (OscillatorNode | AudioBufferSourceNode)[];
}

function buildSources(
  ctx: BaseAudioContext,
  synth: SubtractiveParams,
  drive: AudioNode,
  baseFrequency: number,
  ratios: SourceRatios,
  at: number,
): VoiceSources {
  const started: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const oscillators: OscillatorSlots<OscillatorNode> = [null, null];
  const oscillatorGains: OscillatorSlots<GainNode> = [null, null];

  for (const slot of [0, 1] as const) {
    const params = synth.oscillators[slot];
    if (!params.enabled) continue;
    const osc = ctx.createOscillator();
    osc.type = params.waveform;
    osc.frequency.value = baseFrequency * ratios.oscillators[slot];
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(params.levelDb);
    osc.connect(gain);
    gain.connect(drive);
    osc.start(at);
    started.push(osc);
    oscillators[slot] = osc;
    oscillatorGains[slot] = gain;
  }

  let sub: OscillatorNode | null = null;
  let subGain: GainNode | null = null;
  if (synth.utility.subEnabled) {
    sub = ctx.createOscillator();
    // The sub has no waveform choice by design — it is a sine, one or two
    // octaves down, and exists to add weight rather than character.
    sub.type = 'sine';
    sub.frequency.value = baseFrequency * ratios.sub;
    subGain = ctx.createGain();
    subGain.gain.value = dbToGain(synth.utility.subLevelDb);
    sub.connect(subGain);
    subGain.connect(drive);
    sub.start(at);
    started.push(sub);
  }

  let noise: AudioBufferSourceNode | null = null;
  let noiseGain: GainNode | null = null;
  if (synth.utility.noiseEnabled) {
    noise = ctx.createBufferSource();
    noise.buffer = noiseBufferFor(ctx, synth.utility.noiseColor);
    // The buffer is two seconds; a pad's release is longer than that.
    noise.loop = true;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = dbToGain(synth.utility.noiseLevelDb);
    noise.connect(noiseGain);
    noiseGain.connect(drive);
    noise.start(at);
    started.push(noise);
  }

  return { oscillators, oscillatorGains, sub, subGain, noise, noiseGain, started };
}

/**
 * The ENV2 router: one contour, converted into each destination's own unit,
 * scheduled against that destination's own unmodulated base. Returns the
 * destinations so `release` can walk every one of them back to that base.
 *
 * A route amount of 0 schedules NOTHING — an envelope from a value to itself
 * is automation a later live update would then have to fight, for no audible
 * gain.
 */
function scheduleModEnvelope(
  nodes: SubtractiveVoiceNodes,
  synth: SubtractiveParams,
  amounts: RouteAmounts,
  tail: VoiceTail,
  timing: EnvelopeTiming,
  panPosition: number,
  sampleRate: number,
  at: number,
): ModDestination[] {
  const destinations: ModDestination[] = [];

  for (const slot of [0, 1] as const) {
    const osc = nodes.oscillators[slot];
    const semitones = amounts.oscSemitones[slot];
    if (!osc || semitones === 0) continue;
    schedulePitchEnvelope(osc.detune, timing, semitones, at);
    destinations.push({ param: osc.detune, levels: { base: 0, peak: semitones * CENTS_PER_SEMITONE } });
  }

  // The sub rides the same contour on its OWN `detune` — its static octave is
  // folded into `frequency` exactly as an oscillator's tuning is (this file's
  // rule 2), so a glide writing `sub.frequency` and this writing `sub.detune`
  // compose instead of overwriting each other.
  if (nodes.sub && amounts.subSemitones !== 0) {
    schedulePitchEnvelope(nodes.sub.detune, timing, amounts.subSemitones, at);
    destinations.push({
      param: nodes.sub.detune,
      levels: { base: 0, peak: amounts.subSemitones * CENTS_PER_SEMITONE },
    });
  }

  for (const slot of [0, 1] as const) {
    const gain = nodes.oscillatorGains[slot];
    const db = amounts.oscDb[slot];
    if (!gain || db === 0) continue;
    const levels = {
      base: dbToGain(synth.oscillators[slot].levelDb),
      peak: dbToGain(synth.oscillators[slot].levelDb + db),
    };
    scheduleAdsr(gain.gain, timing, levels, at);
    destinations.push({ param: gain.gain, levels });
  }

  if (amounts.cutoffSemitones !== 0) {
    // Semitone RATIO space, not Hz: +12 doubles the cutoff wherever it sits.
    // The CLAMP is applied to the routed result as well as to the base — a
    // route that lands past Nyquist has to stop at the ceiling rather than
    // degenerate the filter's coefficients.
    const peak = clampCutoffHz(tail.unclampedCutoff * semitonesToRatio(amounts.cutoffSemitones), sampleRate);
    scheduleAdsr(tail.filter.frequency, timing, { base: tail.baseCutoff, peak }, at);
    destinations.push({ param: tail.filter.frequency, levels: { base: tail.baseCutoff, peak } });
  }

  if (amounts.resonanceDelta !== 0) {
    const peak = resonanceToQ(synth.filter.resonance + amounts.resonanceDelta);
    scheduleAdsr(tail.filter.Q, timing, { base: tail.baseQ, peak }, at);
    destinations.push({ param: tail.filter.Q, levels: { base: tail.baseQ, peak } });
  }

  if (amounts.amplitudeDb !== 0) {
    // On the SERIES gain, never on `ampGain.gain` — see this module's rule 1.
    // Base 1 (unity), so "no modulation" is "no change", not "no sound".
    const levels = { base: 1, peak: dbToGain(amounts.amplitudeDb) };
    scheduleAdsr(tail.tremoloGain.gain, timing, levels, at);
    destinations.push({ param: tail.tremoloGain.gain, levels });
  }

  if (amounts.pan !== 0) {
    const peak = clamp(panPosition + amounts.pan, -1, 1);
    scheduleAdsr(tail.panner.pan, timing, { base: panPosition, peak }, at);
    destinations.push({ param: tail.panner.pan, levels: { base: panPosition, peak } });
  }

  return destinations;
}

/**
 * A continuous modulator connected to an `AudioParam` SUMS into that param in
 * the param's OWN unit. A `ModRoute.amount` is not in that unit — it is in the
 * target's musical unit: semitones for pitch and cutoff, dB for levels and
 * amplitude, a normalized 0..1 delta for resonance (`src/types/synth.ts`). So
 * every destination carries the factor that turns one of the route's units
 * into one of the param's, and `SynthLfoBank` multiplies `depth * amount` by
 * it before it ever reaches the graph.
 *
 * Without this the LFO is not merely mistuned, it is INAUDIBLE at the two
 * targets people reach for first: 12 semitones arrived as 12 cents on a
 * `detune` (an eighth of a semitone) and as 12 hertz on a cutoff of a
 * thousand. ENV2 has always converted — `scheduleModEnvelope` writes
 * `semitones * CENTS_PER_SEMITONE` and `dbToGain(...)` — because it computes absolute
 * endpoints rather than connecting a signal; the LFO connects, and nothing
 * converted for it.
 *
 * Two of the four conversions are exact and two are linearizations about the
 * voice's unmodulated value, because their unit is logarithmic and a summed
 * offset cannot be:
 *
 * - semitones -> cents is exactly `CENTS_PER_SEMITONE`, which is why a cutoff
 *   route goes to the filter's `detune` (cents, MULTIPLYING its frequency)
 *   rather than to `frequency` (hertz, where a semitone has no fixed size).
 * - pan is already in the param's unit.
 * - dB -> linear gain uses the slope of `10^(x/20)` at the unmodulated gain.
 *   Exact at the center, and within a few percent over the +-3 dB the factory
 *   tremolos use; a route deeper than about +-8.7 dB would take the gain
 *   through zero and invert phase, which is a depth limit for the patch
 *   validator rather than something to disguise here with a clamp that would
 *   silently mean a different depth than the number on the knob.
 * - normalized resonance -> Q uses the slope of `resonanceToQ` at the
 *   patch's own resonance, the same exponential the static value is built
 *   from, so a route's delta means the same fraction of the Q range wherever
 *   the knob is sitting.
 */

/** d/dx of `10^(x/20)` at x = 0 — the linear gain one dB is worth at unity. */

/** d/dr of `resonanceToQ` at resonance r, which is `resonanceToQ(r) * ln(MAX_Q/MIN_Q)`. */
function qPerResonanceUnit(resonance: number): number {
  return resonanceToQ(resonance) * Math.log(MAX_Q / MIN_Q);
}

/**
 * The single-param half of `lfoDestinationFor`'s target->node mapping — every
 * target except `pitch-all`, which fans out to three params and is handled
 * there instead. A lookup table rather than a second `switch` keeps
 * `lfoDestinationFor` itself under the complexity limit a 9-case switch
 * would otherwise trip.
 */
const LFO_DESTINATION_SELECTORS: Record<
  Exclude<ModTarget, 'pitch-all'>,
  (nodes: SubtractiveVoiceNodes, synth: SubtractiveParams) => LfoDestination | null
> = {
  'osc1-pitch': (nodes) => pitchDestination(nodes.oscillators[0]),
  'osc2-pitch': (nodes) => pitchDestination(nodes.oscillators[1]),
  'osc1-level': (nodes, synth) => levelDestination(nodes.oscillatorGains[0], synth.oscillators[0].levelDb),
  'osc2-level': (nodes, synth) => levelDestination(nodes.oscillatorGains[1], synth.oscillators[1].levelDb),
  // `detune`, not `frequency`: see this table's doc — a semitone is a ratio.
  'filter-cutoff': (nodes) => ({ params: [nodes.filter.detune], unitScale: CENTS_PER_SEMITONE }),
  'filter-resonance': (nodes, synth) => ({ params: [nodes.filter.Q], unitScale: qPerResonanceUnit(synth.filter.resonance) }),
  // The SERIES gain, base unity — never `ampGain.gain`; see this module's rule 1.
  amplitude: (nodes) => ({ params: [nodes.tremoloGain.gain], unitScale: GAIN_PER_DB_AT_UNITY }),
  pan: (nodes) => ({ params: [nodes.panner.pan], unitScale: 1 }),
};

function pitchDestination(osc: OscillatorNode | null): LfoDestination | null {
  return osc ? { params: [osc.detune], unitScale: CENTS_PER_SEMITONE } : null;
}

function levelDestination(gain: GainNode | null, levelDb: number): LfoDestination | null {
  return gain ? { params: [gain.gain], unitScale: dbToGain(levelDb) * GAIN_PER_DB_AT_UNITY } : null;
}

/**
 * The params an LFO route reaches on THIS voice, plus the factor that converts
 * the route's amount into their unit.
 *
 * `synth` must be the patch the voice is playing NOW, not the one it was built
 * with. Two of these unitScales are read out of the PATCH rather than the graph
 * — `qPerResonanceUnit(resonance)` and `dbToGain(levelDb)`, each a
 * linearization about the value the param actually holds — so pinned to the
 * construction-time patch, a live Resonance sweep moved the static Q while the
 * LFO kept converting its route at the note-on resonance: the modulation stayed
 * sized for a Q the filter no longer had until the next note.
 */
function lfoDestinationFor(nodes: SubtractiveVoiceNodes, synth: SubtractiveParams, target: ModTarget): LfoDestination | null {
  if (target === 'pitch-all') {
    const params = [nodes.oscillators[0]?.detune, nodes.oscillators[1]?.detune, nodes.sub?.detune].filter(
      (param): param is AudioParam => param != null,
    );
    return params.length > 0 ? { params, unitScale: CENTS_PER_SEMITONE } : null;
  }
  return LFO_DESTINATION_SELECTORS[target](nodes, synth);
}

/** A pitch ramp in flight: where it started, where it ends, and between which instants. */
interface PitchRamp {
  from: number;
  to: number;
  startAt: number;
  endAt: number;
}

/** The two halves of the graph, gathered into the shape the voice exposes. */
function collectNodes(sources: VoiceSources, tail: VoiceTail): SubtractiveVoiceNodes {
  return {
    oscillators: sources.oscillators,
    oscillatorGains: sources.oscillatorGains,
    sub: sources.sub,
    subGain: sources.subGain,
    noise: sources.noise,
    noiseGain: sources.noiseGain,
    drive: tail.drive,
    filter: tail.filter,
    ampGain: tail.ampGain,
    tremoloGain: tail.tremoloGain,
    polyGain: tail.polyGain,
    panner: tail.panner,
  };
}

/** Every edge this voice owns, cut. Never scheduled — see `disconnect` on the interface. */
function disconnectGraph(sources: VoiceSources, tail: VoiceTail): void {
  for (const node of sources.started) {
    node.disconnect();
  }
  for (const gain of [...sources.oscillatorGains, sources.subGain, sources.noiseGain]) {
    gain?.disconnect();
  }
  tail.drive.disconnect();
  tail.filter.disconnect();
  tail.ampGain.disconnect();
  tail.tremoloGain.disconnect();
  tail.polyGain.disconnect();
  tail.panner.disconnect();
}

/**
 * A release already scheduled. Held so a second release can anchor on the ramp
 * this one is walking down; every field is what was WRITTEN, never what a
 * param currently reads, because a release can be booked ahead of time.
 */
interface ReleaseInFlight {
  at: number;
  ampSeconds: number;
  ampHeld: number;
  modSeconds: number;
  modHeld: number[];
}

/**
 * Where a linear ramp from `from` to `to` sits at `time`. Every release ramp
 * here is linear (`releaseScheduledParamTo` uses `linearRampToValueAtTime`).
 *
 * `createVoiceRelease` reaches the `time <= startAt` guard at exactly one
 * instant — `time === startAt`, where a release landing on the moment another
 * one begins must read what that release wrote there. It can never reach it
 * with `time < startAt`, because it decides which anchor applies BEFORE calling
 * rather than relying on this to answer for an instant the ramp does not cover.
 * The `seconds <= 0` check is tested first on purpose: an instantaneous release
 * is AT its base from the moment it is written, not at its held value.
 */
function linearValueAt(from: number, to: number, startAt: number, seconds: number, time: number): number {
  if (seconds <= 0 || time >= startAt + seconds) return to;
  if (time <= startAt) return from;
  return from + (to - from) * ((time - startAt) / seconds);
}

/**
 * ENV1's release plus every ENV2 destination's walk back to base, as one
 * closure over the release currently in flight — see `release` on the
 * interface for why a second call must not re-anchor at sustain.
 */
function createVoiceRelease(
  ampParam: AutomationParam,
  ampTiming: EnvelopeTiming,
  ampLevels: EnvelopeLevels,
  modDestinations: ModDestination[],
  modTiming: EnvelopeTiming,
  modReleaseCap: number,
  startedAt: number,
): (releaseAt: number, seconds: number) => void {
  let inFlight: ReleaseInFlight | null = null;
  return (releaseAt: number, seconds: number): void => {
    // THE rule, and the only one: an anchor is the value the param will hold at
    // the release time being scheduled. A release already in flight answers that
    // question from its own start ONWARDS — strictly before that instant the
    // param is still walking the note envelope, and the release's held value
    // belongs to a moment that has not arrived. That case is reachable and is
    // not an edge: a sequencer books a note-off ahead, then a loop load or a
    // vibe swap calls `stopSource` at the current time, which is EARLIER.
    // Reading the future release's anchor there steps the gain UP before fading
    // it, if the note is still in attack or decay. The earlier release
    // supersedes the later one outright — its `cancelScheduledValues` wipes it
    // from the param — so `inFlight` below records the one that survives.
    //
    // `>=`, not `>`: AT that instant the release in flight has written its own
    // `setValueAtTime(held, at)`, so `held` is exactly what the param reads —
    // by this rule and by what `cancelScheduledValues` leaves behind there. The
    // two comparisons only differ once the release in flight was itself chained
    // off an earlier one, because a release anchored directly on the envelope
    // holds the envelope's own value and either branch returns it.
    const prior = inFlight !== null && releaseAt >= inFlight.at ? inFlight : null;
    const ampHeld = prior
      ? linearValueAt(prior.ampHeld, ampLevels.base, prior.at, prior.ampSeconds, releaseAt)
      : envelopeValueAt(ampTiming, ampLevels, startedAt, releaseAt);
    // Where the curve this release interrupts began — the note-on, or the
    // release already in flight. It is the SAME answer for the amp and for
    // every ENV2 destination, because `prior` is one decision about which
    // contour is running, not a per-param one. `releaseScheduledParamTo` needs
    // it to re-draw the segment its own `cancelScheduledValues` erases; see
    // that function's docblock.
    const contourStartedAt = prior ? prior.at : startedAt;
    releaseScheduledParam(ampParam, releaseAt, seconds, ampHeld, contourStartedAt);
    // ENV2's release is its own, but never longer than the amp's: past the
    // moment ENV1 reaches silence the voice is inaudible and about to be torn
    // down, and a modulation ramp still running then would be cut mid-flight.
    const modSeconds = Math.min(modReleaseCap, Math.max(0, seconds));
    const modHeld = modDestinations.map(({ param, levels }, index) => {
      const held = prior
        ? linearValueAt(prior.modHeld[index], levels.base, prior.at, prior.modSeconds, releaseAt)
        : envelopeValueAt(modTiming, levels, startedAt, releaseAt);
      releaseScheduledParamTo(param, releaseAt, modSeconds, levels.base, held, contourStartedAt);
      return held;
    });
    inFlight = { at: releaseAt, ampSeconds: Math.max(0, seconds), ampHeld, modSeconds, modHeld };
  };
}

/** The glide half of a voice: the note it is sounding, and how to bend it to another. */
interface VoiceGlide {
  readonly noteName: string;
  glideTo(noteName: string, at: number, seconds: number): void;
  /**
   * Re-applies one pitched source's STATIC tuning after `tuning.ratios` has
   * changed, preserving any glide still in flight. A plain `setValueAtTime`
   * here would be overtaken by the running ramp's own endpoint, which still
   * carries the old ratio — so a knob moved mid-bend would do nothing at all
   * from the moment the glide landed.
   */
  retuneOscillator(slot: 0 | 1, at: number): void;
  retuneSub(at: number): void;
  /** The same for the filter, which follows the note only when key tracking is on. */
  retuneCutoff(at: number): void;
}

/**
 * Holds the ramp currently in flight AS A RAMP rather than reading a param
 * back: a glide booked while another is still running has to anchor on the
 * value the running ramp WILL hold at that instant, and `param.value` is the
 * value NOW. A voice that has never glided holds a zero-length ramp at its own
 * note, so there is no special case for the first glide.
 *
 * It writes `tuning.baseFrequency` as it goes, which is what makes a knob
 * moved after a glide tune from the note in the air.
 */
function createVoiceGlide(
  nodes: SubtractiveVoiceNodes,
  tuning: VoiceTuning,
  startNoteName: string,
  startAt: number,
): VoiceGlide {
  let currentNoteName = startNoteName;
  let ramp: PitchRamp = {
    from: tuning.baseFrequency,
    to: tuning.baseFrequency,
    startAt,
    endAt: startAt,
  };

  function frequencyAt(time: number): number {
    if (time >= ramp.endAt) return ramp.to;
    if (time <= ramp.startAt) return ramp.from;
    const progress = (time - ramp.startAt) / (ramp.endAt - ramp.startAt);
    return ramp.from * Math.pow(ramp.to / ramp.from, progress);
  }

  /**
   * Writes one param the whole of the CURRENT ramp, in that param's own unit:
   * from where the ramp is at `at` to where it is going, over what is left of
   * it. Three cases, one expression:
   *
   * - No glide in flight (`ramp.endAt` already past) — the destination value is
   *   written on the instant, which is what a knob change on a still voice is.
   * - A glide running — it is re-written from where it has got to, so a knob
   *   moved mid-bend lands NOW and the bend still arrives, at the new tuning.
   * - A glide booked AHEAD (`ramp.startAt` still in the future) — the new value
   *   is held flat until the glide is actually due, so a knob turn does not
   *   drag the pitch move earlier than the note it belongs to.
   *
   * Exponential rather than linear because a ramp linear in Hz is not linear in
   * PITCH: it rushes the bottom of its own interval and crawls the top, heard
   * as the glide arriving early. A ramp of no duration is written as a plain
   * `setValueAtTime` — the platform's behaviour for a zero-length exponential
   * ramp is not worth relying on.
   */
  function follow(param: AudioParam, valueFor: (frequency: number) => number, at: number): void {
    const value = valueFor(frequencyAt(at));
    const target = valueFor(ramp.to);
    const startAt = Math.max(at, ramp.startAt);
    const endAt = Math.max(at, ramp.endAt);
    param.cancelScheduledValues(at);
    if (endAt <= startAt) {
      param.setValueAtTime(target, at);
      return;
    }
    param.setValueAtTime(value, at);
    if (startAt > at) param.setValueAtTime(value, startAt);
    param.exponentialRampToValueAtTime(target, endAt);
  }

  const oscillatorValue = (slot: 0 | 1) => (frequency: number) =>
    frequency * tuning.ratios.oscillators[slot];
  const subValue = (frequency: number): number => frequency * tuning.ratios.sub;
  const cutoffValue = (frequency: number): number =>
    clampCutoffHz(keyTrackedCutoff(tuning.filter.cutoffHz, tuning.filter.keyTrack, frequency), tuning.sampleRate);

  /** A cutoff ENV2 owns carries a contour measured from its own base — never re-anchor it. */
  const cutoffIsOurs = (): boolean => tuning.amounts.cutoffSemitones === 0;

  function retuneOscillator(slot: 0 | 1, at: number): void {
    const osc = nodes.oscillators[slot];
    if (osc) follow(osc.frequency, oscillatorValue(slot), at);
  }

  function retuneSub(at: number): void {
    if (nodes.sub) follow(nodes.sub.frequency, subValue, at);
  }

  return {
    get noteName(): string {
      return currentNoteName;
    },
    glideTo(noteName: string, at: number, seconds: number): void {
      ramp = { from: frequencyAt(at), to: noteFrequency(noteName), startAt: at, endAt: at + Math.max(0, seconds) };
      tuning.baseFrequency = ramp.to;
      currentNoteName = noteName;
      retuneOscillator(0, at);
      retuneOscillator(1, at);
      retuneSub(at);
      // Only a key-tracked cutoff follows the NOTE; an untracked one is not
      // part of the glide at all and must not gain automation from it.
      if (tuning.filter.keyTrack > 0 && cutoffIsOurs()) follow(nodes.filter.frequency, cutoffValue, at);
    },
    retuneOscillator,
    retuneSub,
    retuneCutoff(at: number): void {
      if (!cutoffIsOurs()) return;
      if (tuning.filter.keyTrack > 0) {
        follow(nodes.filter.frequency, cutoffValue, at);
        return;
      }
      nodes.filter.frequency.setValueAtTime(cutoffValue(tuning.baseFrequency), at);
    },
  };
}

export function createSubtractiveVoice(
  ctx: BaseAudioContext,
  patch: EnginePatch<'subtractive'>,
  event: SubtractiveVoiceEvent,
  destinations: SubtractiveVoiceDestinations,
): SubtractiveVoice {
  const { common, synth } = patch;
  const { at, scaleFactor = 1 } = event;
  const unisonCount = Math.max(1, Math.round(common.unisonVoices));
  const spread = unisonSpread(event.unisonIndex ?? 0, unisonCount);
  const unisonCents = spread * common.unisonDetuneCents;
  const panPosition = clamp(spread * clamp(common.stereoWidth, 0, 1), -1, 1);
  const baseFrequency = noteFrequency(event.noteName);
  const amounts = sumRouteAmounts(synth.env2Routes);
  let currentSynth = synth; // What is playing NOW; see `lfoDestinationFor`.

  const tail = buildTail(ctx, synth, baseFrequency, panPosition, destinations);
  const ratios = sourceRatios(synth, unisonCents);
  const sources = buildSources(ctx, synth, tail.drive, baseFrequency, ratios, at);
  const nodes = collectNodes(sources, tail);

  // ENV1: permanently wired to amplitude, and the only envelope that reaches
  // silence. Velocity sensitivity is a blend, so `velocityToAmplitude` 0 makes
  // a soft note as loud as a hard one rather than making velocity meaningless.
  const velocity = clamp(event.velocity, 0, 1);
  const velocityGain = 1 - clamp(common.velocityToAmplitude, 0, 1) * (1 - velocity);
  // Equal power across the unison stack: N voices at 1/sqrt(N) sum to the same
  // power as one at unity, so raising Voices does not raise the track's level.
  const ampLevels: EnvelopeLevels = {
    base: 0,
    peak: (velocityGain * dbToGain(common.outputGainDb)) / Math.sqrt(unisonCount),
  };
  const ampTiming = timingOf(synth.ampEnvelope, scaleFactor);
  scheduleAdsr(tail.ampGain.gain, ampTiming, ampLevels, at);

  const modTiming = timingOf(synth.modEnvelope, scaleFactor);
  const modDestinations = scheduleModEnvelope(nodes, synth, amounts, tail, modTiming, panPosition, ctx.sampleRate, at);

  const tuning: VoiceTuning = {
    amounts,
    unisonCents,
    spread,
    baseFrequency,
    ratios,
    filter: { cutoffHz: synth.filter.cutoffHz, keyTrack: synth.filter.keyTrack },
    sampleRate: ctx.sampleRate,
  };
  const glide = createVoiceGlide(nodes, tuning, event.noteName, at);
  // Every anchor is COMPUTED, never read off `param.value` — a sequenced
  // note-off is booked ahead of time, and `.value` reports the value now.
  const release = createVoiceRelease(
    tail.ampGain.gain,
    ampTiming,
    ampLevels,
    modDestinations,
    modTiming,
    synth.modEnvelope.release * scaleFactor,
    at,
  );
  nextVoiceSerial += 1;
  let stopped = false;
  let disconnected = false;
  /**
   * The polyphony ramp last WRITTEN — the same "what was written, never what a
   * param reads" rule `ReleaseInFlight` carries, and for the same reason: the
   * next scale has to anchor on where this ramp will be at ITS time, which is
   * not a question `polyGain.gain.value` can answer (see `setPolyphonyScale`).
   *
   * Seeded at the unity `buildTail` gives the node, over zero seconds: a voice
   * that has never been scaled is at unity for all time, and `seconds: 0` is
   * also what says nothing has been scheduled for a cancel to erase.
   */
  let polyRamp = { from: 1, to: 1, at, seconds: 0 };

  // Declared as closures rather than object-literal methods so `teardown` can
  // call them without `this` — a caller that destructures a method off the
  // voice would otherwise get a function that throws.
  function stopSources(stopAt: number): void {
    if (stopped) return;
    stopped = true;
    // A stop time earlier than the note-on would ask a source to stop before
    // it starts; the spec stops it at its start time, and saying so here keeps
    // the recorded stop time honest.
    const when = Math.max(stopAt, at);
    for (const node of sources.started) {
      node.stop(when);
    }
  }

  function disconnect(): void {
    if (disconnected) return;
    disconnected = true;
    disconnectGraph(sources, tail);
  }

  return {
    id: `subtractive-${nextVoiceSerial}`,
    source: event.source,
    owner: event.owner,
    get noteName(): string {
      return glide.noteName;
    },
    startedAt: at,
    nodes,

    release,

    update(previous: EnginePatch<'subtractive'>, next: EnginePatch<'subtractive'>, updateAt: number): void {
      updateVoice(nodes, tuning, glide, previous, next, updateAt);
      currentSynth = next.synth;
    },

    setPolyphonyScale(scale: number, scaleAt: number): void {
      const target = Math.max(0, scale);
      const gain = tail.polyGain.gain;
      // COMPUTED, never read off `gain.value` — this file's rule, stated at
      // `createVoiceRelease` above and broken here until it was measured.
      // `value` is the param's [[current value]]: its intrinsic value at the
      // START of the current render quantum, which is two different wrong
      // answers. At a `scaleAt` in the future it is the value NOW, so a third
      // key inside a chord's 15 ms re-balance re-anchored at the level the
      // first two left and stepped the sounding voices UP. At `scaleAt ===
      // currentTime` it is one render quantum stale — up to 2.9 ms of a 15 ms
      // ramp, which is a fifth of the duck, in the same wrong direction.
      const anchor = linearValueAt(polyRamp.from, polyRamp.to, polyRamp.at, polyRamp.seconds, scaleAt);
      gain.cancelScheduledValues(scaleAt);
      // Re-draw the segment the cancel erased, exactly as
      // `releaseScheduledParamTo` does: `cancelScheduledValues` removes every
      // event at time >= `scaleAt` and a ramp is anchored only by its END
      // event, so cancelling inside a ramp removes the ramp WHOLE — including
      // the part before `scaleAt` that has not been rendered yet. Skipped when
      // the previous ramp had no duration to be interrupted mid-way, which is
      // every voice's first scale: nothing was scheduled, so nothing was lost.
      if (polyRamp.seconds > 0 && scaleAt > polyRamp.at) gain.linearRampToValueAtTime(anchor, scaleAt);
      gain.setValueAtTime(anchor, scaleAt);
      gain.linearRampToValueAtTime(target, scaleAt + POLYPHONY_RAMP_SECONDS);
      polyRamp = { from: anchor, to: target, at: scaleAt, seconds: POLYPHONY_RAMP_SECONDS };
    },

    glideTo: glide.glideTo,

    // `currentSynth`, never the note-on `synth` — see `lfoDestinationFor`.
    lfoDestination: (target: ModTarget): LfoDestination | null =>
      lfoDestinationFor(nodes, currentSynth, target),

    stopSources,
    disconnect,

    teardown(teardownAt: number): void {
      stopSources(teardownAt);
      disconnect();
    },
  };
}

/**
 * The continuous controls a SOUNDING voice follows: tuning, waveform, source
 * levels, filter, drive and pan (design doc, "Continuous controls update
 * sounding voices"). Envelope timing, unison count, enabled state and the
 * route list are deliberately NOT here — they shape a voice at construction,
 * and applying them mid-note would mean creating or destroying nodes under a
 * sounding envelope.
 *
 * A destination ENV2 owns is skipped rather than written: a `setValueAtTime`
 * on a param carrying a scheduled contour re-anchors that contour at the new
 * value, which is heard as the modulation collapsing the moment an unrelated
 * knob moves.
 */
function updateVoice(
  nodes: SubtractiveVoiceNodes,
  tuning: VoiceTuning,
  glide: VoiceGlide,
  previous: EnginePatch<'subtractive'>,
  next: EnginePatch<'subtractive'>,
  at: number,
): void {
  updateOscillators(nodes, tuning, glide, previous.synth, next.synth, at);
  updateUtility(nodes, tuning, glide, previous.synth, next.synth, at);
  updateFilter(nodes, tuning, glide, previous.synth, next.synth, at);
  if (next.common.stereoWidth !== previous.common.stereoWidth && tuning.amounts.pan === 0) {
    nodes.panner.pan.setValueAtTime(clamp(tuning.spread * clamp(next.common.stereoWidth, 0, 1), -1, 1), at);
  }
}

function updateOscillators(
  nodes: SubtractiveVoiceNodes,
  tuning: VoiceTuning,
  glide: VoiceGlide,
  before: SubtractiveParams,
  after: SubtractiveParams,
  at: number,
): void {
  for (const slot of [0, 1] as const) {
    const osc = nodes.oscillators[slot];
    const gain = nodes.oscillatorGains[slot];
    if (!osc || !gain) continue;
    const was = before.oscillators[slot];
    const is = after.oscillators[slot];
    if (is.waveform !== was.waveform) {
      osc.type = is.waveform;
    }
    const semitones = staticSemitones(is, tuning.unisonCents);
    if (semitones !== staticSemitones(was, tuning.unisonCents)) {
      tuning.ratios.oscillators[slot] = semitonesToRatio(semitones);
      glide.retuneOscillator(slot, at);
    }
    if (is.levelDb !== was.levelDb && tuning.amounts.oscDb[slot] === 0) {
      gain.gain.setValueAtTime(dbToGain(is.levelDb), at);
    }
  }
}

function updateUtility(
  nodes: SubtractiveVoiceNodes,
  tuning: VoiceTuning,
  glide: VoiceGlide,
  before: SubtractiveParams,
  after: SubtractiveParams,
  at: number,
): void {
  if (nodes.sub && after.utility.subOctave !== before.utility.subOctave) {
    tuning.ratios.sub = semitonesToRatio(after.utility.subOctave * 12);
    glide.retuneSub(at);
  }
  if (nodes.subGain && after.utility.subLevelDb !== before.utility.subLevelDb) {
    nodes.subGain.gain.setValueAtTime(dbToGain(after.utility.subLevelDb), at);
  }
  // Noise COLOR is missing from this list on purpose: an `AudioBufferSourceNode`
  // that has started cannot be given a new buffer, so a color change takes
  // effect on the next note rather than silencing this one.
  if (nodes.noiseGain && after.utility.noiseLevelDb !== before.utility.noiseLevelDb) {
    nodes.noiseGain.gain.setValueAtTime(dbToGain(after.utility.noiseLevelDb), at);
  }
}

function updateFilter(
  nodes: SubtractiveVoiceNodes,
  tuning: VoiceTuning,
  glide: VoiceGlide,
  before: SubtractiveParams,
  after: SubtractiveParams,
  at: number,
): void {
  if (after.filter.type !== before.filter.type) {
    nodes.filter.type = after.filter.type;
  }
  const cutoffMoved =
    after.filter.cutoffHz !== before.filter.cutoffHz || after.filter.keyTrack !== before.filter.keyTrack;
  if (cutoffMoved) {
    // Recorded even when ENV2 owns the param and the write below is skipped: a
    // later glide reads these two to work out where key tracking puts the
    // cutoff, and a stale pair would bend the filter to the old knob position.
    tuning.filter = { cutoffHz: after.filter.cutoffHz, keyTrack: after.filter.keyTrack };
  }
  if (cutoffMoved) glide.retuneCutoff(at);
  if (after.filter.resonance !== before.filter.resonance && tuning.amounts.resonanceDelta === 0) {
    nodes.filter.Q.setValueAtTime(resonanceToQ(after.filter.resonance), at);
  }
  if (after.filter.driveDb !== before.filter.driveDb) {
    nodes.drive.curve = driveCurve(after.filter.driveDb);
    nodes.drive.oversample = driveOversample(after.filter.driveDb);
  }
}
