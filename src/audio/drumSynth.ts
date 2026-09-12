import { FilterType } from '../types';
import { DEFAULT_VELOCITY, ENV_FLOOR, clampVelocity } from './constants';
import { random } from './rng';
import { mergeDrumKit } from './drumKits';
import { type DrumKit, type DrumType, type HatParams, type SnareParams, DRUM_TYPES } from '@/data/drumKits';
import { NEUTRAL_TRIM_GAIN, drumTrimGainFor } from './trims';
import type { EngineHooks, MasterRack } from './masterRack';

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

/**
 * Every drum voice: the eleven authored types, the hat choke group, the metallic
 * oscillator bank, the kit lookup and the per-track faders. It connects into the master
 * rack's sequencer tap and reverb send, and owns none of those nodes.
 */
export class DrumSynth {
  /** Seed levels, kept even before the AudioContext exists so the setter
   *  no-ops safely like every other and applyEngineSnapshot re-applies. */
  private drumTrackLevels = new Map<string, number>();

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

  /**
   * The context `bind()` stored. `BaseAudioContext`, not `AudioContext`: an offline
   * render binds an `OfflineAudioContext`, which has every node factory this subsystem
   * uses but no `close()`. Null until `init()`/`bindContext` hands one over — which is
   * what keeps every setter here a no-op before init.
   */
  private ctx: BaseAudioContext | null = null;

  /**
   * The rack supplies every destination a drum voice connects to — the sequencer tap,
   * the drum bus filter, the per-track faders, the reverb send and the noise buffer —
   * and the hooks arm the engine's idle countdown on every hit.
   */
  constructor(
    private readonly masterRack: MasterRack,
    private readonly hooks: EngineHooks,
  ) {}

  /** Binds the context this subsystem builds its nodes and schedules against. */
  bind(ctx: BaseAudioContext): void {
    this.ctx = ctx;
  }

  private drumTrackGain(instrument: string): GainNode | null {
    if (!this.ctx || !this.masterRack.drumBusFilter) return null;
    let node = this.masterRack.drumTrackGains.get(instrument);
    if (!node) {
      node = this.ctx.createGain();
      node.gain.value = this.drumTrackLevels.get(instrument) ?? 1;
      node.connect(this.masterRack.drumBusFilter);
      this.masterRack.drumTrackGains.set(instrument, node);
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
    return this.masterRack.drumTrackGains.get(instrument)?.gain.value;
  }

  __drumTrackGainCountForTests(): number {
    return this.masterRack.drumTrackGains.size;
  }

  setDrumKit(kit?: Partial<DrumKit>, kitName?: string): void {
    this.drumKit = mergeDrumKit(kit);
    this.drumTrimGain = drumTrimGainFor(kitName);
  }

  /** Live drum-bus filter control (SequencerView "Drum Filter" card). */
  setDrumFilter(cutoff: number, resonance: number, type: FilterType, time?: number): void {
    this.masterRack.drumFilterCutoff = cutoff;
    this.masterRack.drumFilterResonance = resonance;
    this.masterRack.drumFilterType = type;
    if (!this.ctx) return;
    const now = Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime);
    for (const node of [this.masterRack.drumBusFilter, this.masterRack.drumSendFilter]) {
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
    env.connect(track ?? this.masterRack.drumBusFilter!);
    if (reverbSend <= 0 || !this.masterRack.drumSendFilter) return null;
    const send = this.ctx!.createGain();
    send.gain.value = reverbSend * (track ? track.gain.value : 1);
    env.connect(send);
    send.connect(this.masterRack.drumSendFilter);
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
    osc.onended = () => this.masterRack.release(osc, env, send);
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
          this.masterRack.cancelAndHold(env.gain, when, voice.peaks[i]);
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
    const noise = this.masterRack.createNoiseNode();
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
    noise.onended = () => this.masterRack.release(noise, filter, topCutFilter, env, send);
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
    oscs[oscs.length - 1].onended = () => this.masterRack.release(
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
    return random() * (this.masterRack.noiseBuffer?.duration ?? 0);
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
    oscs[1].onended = () => this.masterRack.release(...oscs, bp, env, send);
  }

  // Drum Synthesizer Trigger
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    if (!this.ctx || !this.masterRack.dryGain || !this.masterRack.drumBusFilter) return;
    // wakeIfIdle() marks activity for us on every reachable path — see the
    // comment in triggerSynthNoteOn.
    this.hooks.wakeIfIdle();
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
}
