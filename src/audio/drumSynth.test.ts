import { describe, expect, test } from 'bun:test';
/* eslint-disable max-lines -- lifecycle contracts belong beside the existing subsystem ownership fixtures. */
import { DRUM_ALIASES, METAL_BAND_B_HZ } from './engine';
import { BEAT_VOICE_IDS, DEFAULT_BEAT_VOICES } from '@/data/beatPresets';
import { bindFakeCtx, fakeNode, freshEngine, makeEngine } from './testFakes';
import { masterChainCtx, recordNodes } from './engineTestHelpers';

/**
 * The drum voices: their envelopes, kits, aliases, sends and choke groups.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('drum reverb sends', () => {
  function drumEngine() {
    const { engine, ctx } = freshEngine();
    const reverbNode = fakeNode();
    (engine as any).masterRack.reverbNode = reverbNode;
    return { engine, ctx, reverbNode, sendFilter: (engine as any).masterRack.drumSendFilter };
  }

  test('the kit reverbSend is a real level, not a boolean', () => {
    const { engine, ctx } = drumEngine();
    const voices = (engine as any).drumSynth.drumKit;
    engine.setDrumKit({ ...voices, snare: { ...voices.snare, reverbSend: 0.15 } }, 0);
    const before = ctx._gains.length;

    engine.triggerDrum('snare', 1.0);

    // drumKits authors 0.15..0.5 across kits; sending at full voice level makes
    // that 3.3x spread inaudible.
    const sends = ctx._gains.slice(before).filter((g) => g.gain.value === 0.15);
    expect(sends).toHaveLength(1);
  });

  test('sends are filtered: they feed drumSendFilter, never the convolver directly', () => {
    const { engine, ctx, reverbNode, sendFilter } = drumEngine();
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    const created = ctx._gains.slice(before);
    expect(created.some((g) => g.connectedTo.includes(sendFilter))).toBe(true);
    expect(created.some((g) => g.connectedTo.includes(reverbNode))).toBe(false);
  });

  test('the Beat gate sits before the convolver, so mute preserves an existing reverb tail', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const sendLanes = (engine as any).masterRack.drumSendFilterLanes;
    const sendGate = (engine as any).masterRack.drumSendGate;
    const reverb = (engine as any).masterRack.reverbNode;

    // A gate downstream of the convolver would erase its existing tail. A
    // direct filter -> convolver edge would let newly-triggered muted hits
    // leak into it. The only topology satisfying both source-mute semantics
    // is filter -> gate -> Beat reverb send (DEV-423) -> convolver. The filter
    // is a three-lane bank, so every LANE must land on the gate; none skip it.
    expect(sendGate).toBeDefined();
    if (!sendGate) return;
    expect(sendLanes).toHaveLength(3);
    for (const lane of sendLanes) expect(lane.gain._connectTargets).toEqual([sendGate]);
    const beatFeed = (engine as any).masterRack.sourceSendNodes.get('sequencer').reverb;
    expect([sendGate._connectTargets, beatFeed._connectTargets]).toEqual([[beatFeed], [reverb]]);
  });

  test('the Beat source mute and fader govern new drum reverb input', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const dryBus = (engine as any).masterRack.sourceBuses.get('sequencer');
    const sendGate = (engine as any).masterRack.drumSendGate;
    expect(sendGate).toBeDefined();
    if (!sendGate) return;

    engine.setSourceGain('sequencer', 0.25);
    expect(dryBus.gain.targets.at(-1)!.v).toBe(0.25);
    expect(sendGate.gain.targets.at(-1)!.v).toBe(0.25);

    engine.setSourceMuted('sequencer', true);
    expect(dryBus.gain.targets.at(-1)!.v).toBe(0);
    expect(sendGate.gain.targets.at(-1)!.v).toBe(0);

    // Moving the fader while muted must not reopen either branch. Unmuting
    // restores the newly-stored level to both in the same operation.
    engine.setSourceGain('sequencer', 0.6);
    expect(dryBus.gain.targets.at(-1)!.v).toBe(0);
    expect(sendGate.gain.targets.at(-1)!.v).toBe(0);
    engine.setSourceMuted('sequencer', false);
    expect(dryBus.gain.targets.at(-1)!.v).toBe(0.6);
    expect(sendGate.gain.targets.at(-1)!.v).toBe(0.6);

    const drumTargets = sendGate.gain.targets.length;
    engine.setSourceMuted('bass', true);
    expect(sendGate.gain.targets).toHaveLength(drumTargets);
  });

  test('a Beat mute set before graph creation is a safe no-op', () => {
    const engine = makeEngine();
    engine.setSourceGain('sequencer', 0.4);
    engine.setSourceMuted('sequencer', true);

    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    expect((engine as any).masterRack.sourceBuses.get('sequencer').gain.value).toBe(1);
    expect((engine as any).masterRack.drumSendGate.gain.value).toBe(1);
  });

  test('a kit with reverbSend 0 creates no send node at all', () => {
    const { engine, ctx } = drumEngine();
    const voices = (engine as any).drumSynth.drumKit;
    engine.setDrumKit({ ...voices, clap: { ...voices.clap, reverbSend: 0 } }, 0);
    // Pre-warm the per-track fader so the count below reflects only what THIS
    // hit creates — DEV-386's track gain node is created lazily on first use.
    (engine as any).drumSynth.drumTrackGain('clap');
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    expect(ctx._gains.slice(before)).toHaveLength(1); // the envelope only
  });

  test('setBeatFilter keeps the send filter in lockstep with the drum bus filter', () => {
    const { engine } = drumEngine();
    engine.setBeatFilter(800, 4, 'highpass');

    const busLanes = (engine as any).masterRack.drumBusFilterLanes;
    const sendLanes = (engine as any).masterRack.drumSendFilterLanes;
    // Lane for lane, in the same order: the two banks are built by one helper,
    // so they cannot drift the way six hand-written assignments could.
    expect(sendLanes.map((l: any) => l.type)).toEqual(busLanes.map((l: any) => l.type));
    for (let i = 0; i < busLanes.length; i += 1) {
      expect(sendLanes[i].filter.frequency.targets.at(-1))
        .toEqual(busLanes[i].filter.frequency.targets.at(-1));
      expect(sendLanes[i].filter.Q.targets.at(-1)).toEqual(busLanes[i].filter.Q.targets.at(-1));
      // ...and the same lane is opening on both paths.
      expect(sendLanes[i].gain.gain.linearRamps.at(-1))
        .toEqual(busLanes[i].gain.gain.linearRamps.at(-1));
    }
    const openSend = sendLanes.find((l: any) => l.type === 'highpass');
    expect(openSend.gain.gain.linearRamps.at(-1).v).toBe(1);
  });
});

describe("drum voice details", () => {
  test('every drum envelope floors at the same 0.0001', () => {
    const { engine, ctx } = freshEngine();
    for (const type of BEAT_VOICE_IDS) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      for (const g of ctx._gains.slice(before)) {
        // The clap's inter-burst ramps land above the floor on purpose: each
        // burst decays and the next hand re-strikes. What must be identical
        // across every voice is where the envelope ENDS. Send gains have no
        // ramps at all.
        if (g.gain.ramps.length === 0) continue;
        expect(g.gain.ramps.at(-1)!.v).toBe(0.0001);
      }
    }
  });

  test('the clap ghost burst scales with velocity', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumSynth.drumKit.clap.gain;

    let before = ctx._gains.length;
    engine.triggerDrum('clap', 1.0);
    const loud = ctx._gains[before].gain.events.map((e: any) => e.v);

    before = ctx._gains.length;
    engine.triggerDrum('clap', 0.2);
    const soft = ctx._gains[before].gain.events.map((e: any) => e.v);

    // Every scheduled level must scale with velocity; the ghost used to be a
    // hardcoded 0.1, which at velocity 0.2 is LOUDER than the hit itself.
    expect(loud[0]).toBeCloseTo(1.0 * gain, 9);
    expect(soft[0]).toBeCloseTo(0.2 * gain, 9);
    for (let i = 0; i < soft.length - 1; i++) {
      expect(soft[i]).toBeLessThan(loud[i]);
    }
  });

  test('the clap is three decaying bursts, not three rising plateaus', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumSynth.drumKit.clap.gain;
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    const evs = ctx._gains[before].gain.events as { kind: string; v: number; t: number }[];
    const t0 = evs[0].t;

    // A real clap is several hands landing within ~30 ms, and the hands do
    // not get louder. The old schedule ended on peak * 1.1.
    const strikes = evs.filter((e) => e.kind === 'set');
    expect(strikes.map((e) => Number((e.v / gain).toFixed(2)))).toEqual([1.0, 0.85, 0.7, 0.55]);
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].v, `strike ${i}`).toBeLessThan(strikes[i - 1].v);
    }

    // Each burst DECAYS: every strike is followed by a ramp downward before
    // the next strike, with a gap. A plateau on noise is a gate, and reads as
    // "noise chopped", not as hands.
    const burstRamps = evs.filter((e) => e.kind === 'exp' && e.v > 0.0001);
    expect(burstRamps).toHaveLength(3);
    for (const r of burstRamps) expect(r.v).toBeCloseTo(gain * 0.05, 9);
    expect(burstRamps.map((e) => Number((e.t - t0).toFixed(3)))).toEqual([0.008, 0.018, 0.028]);
    expect(strikes.map((e) => Number((e.t - t0).toFixed(3)))).toEqual([0, 0.01, 0.02, 0.03]);
  });

  test('the open hat has no voice-level delay tap (the bus path is masterRack.sendGates.test.ts)', () => {
    const { engine, ctx } = freshEngine();
    const delayNode = fakeNode();
    (engine as any).masterRack.delayNode = delayNode;
    const before = ctx._gains.length;

    engine.triggerDrum('openhat', 1.0);

    // Voice level only. The Beat bus reaches the delay only through its own
    // send node (DEV-423); masterRack.sendGates.test.ts pins that.
    for (const g of ctx._gains.slice(before)) {
      expect(g.connectedTo).not.toContain(delayNode);
    }
  });

  test('drum noise is looped and starts at a random offset', () => {
    const { engine, ctx } = freshEngine();
    const offsets: number[] = [];
    const before = ctx._bufferSources.length;
    for (let i = 0; i < 8; i++) engine.triggerDrum('hihat', 1.0);

    for (const src of ctx._bufferSources.slice(before)) {
      expect(src.loop).toBe(true);
      offsets.push((src as any)._startArgs?.[1] ?? 0);
    }
    // Identical offsets mean every hat reads the same bytes of the one shared
    // buffer, so simultaneous hits sum coherently (+6 dB instead of +3).
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  test('velocity is clamped to 0..1', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumSynth.drumKit.kick.gain;

    let before = ctx._gains.length;
    engine.triggerDrum('kick', 5);
    expect(ctx._gains[before].gain.events[0].v).toBeCloseTo(gain, 9);

    before = ctx._gains.length;
    engine.triggerDrum('kick', -2);
    expect(ctx._gains[before].gain.events[0].v).toBe(0.0001);
  });
});

describe("the kit reverb send reaches each voice body", () => {

  test('the kick body feeds the reverb send at the kit level; the click does not', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit.kick = {
      freqStart: 150, freqEnd: 40, pitchTime: 0.02, decay: 0.4, gain: 1,
      clickFreq: 1100, clickLevel: 0.35, clickDecay: 0.008, reverbSend: 0.45,
    };
    const sendFilter = (engine as any).masterRack.drumSendFilter;
    const before = ctx._gains.length;
    const made = recordNodes(ctx);

    engine.triggerDrum('kick', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    // Exactly one: the body. A click through a reverb is a slap, and the click
    // is a transient whose whole job is to stay dry.
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.45, 9);
    // drumTone's osc.connect(env) is a shared edge across every toned voice
    // (kick, tom, both snare/rimshot partials); made.osc[0] is the kick body,
    // created before the click.
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
  });

  test('the low tom feeds the reverb send at the kit level', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit.lowtom = {
      freqStart: 200, freqEnd: 110, pitchTime: 0.3, decay: 0.6, gain: 0.78, reverbSend: 0.5,
    };
    const sendFilter = (engine as any).masterRack.drumSendFilter;
    const before = ctx._gains.length;
    const made = recordNodes(ctx);

    engine.triggerDrum('lowtom', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.5, 9);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
  });

  test('the hi tom feeds the reverb send at the kit level', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit.hitom = {
      freqStart: 400, freqEnd: 220, pitchTime: 0.1, decay: 0.3, gain: 0.78, reverbSend: 0.5,
    };
    const sendFilter = (engine as any).masterRack.drumSendFilter;
    const before = ctx._gains.length;
    const made = recordNodes(ctx);

    engine.triggerDrum('hitom', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.5, 9);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
  });
});

describe("a hat is a band, and its topCut", () => {

  test('a hat is a BAND: the highpass runs into a lowpass at the kit topCut', () => {
    const { engine, ctx } = freshEngine();
    // metal: 0 isolates the noise path this test targets — the bank has its
    // own tests in "metal crossfades the hat between bank and noise".
    (engine as any).drumSynth.drumKit.hihat = { filter: 3600, topCut: 7500, decay: 0.038, gain: 0.22, metal: 0 };
    const filtersBefore = ctx._filters.length;
    const noiseBefore = ctx._bufferSources.length;
    const gainsBefore = ctx._gains.length;

    engine.triggerDrum('hihat', 1.0);

    const made = ctx._filters.slice(filtersBefore);
    const noise = ctx._bufferSources[noiseBefore];
    const env = ctx._gains[gainsBefore];
    expect(made).toHaveLength(2);
    expect(made[0].type).toBe('highpass');
    expect(made[0].frequency.value).toBe(3600);
    expect(made[1].type).toBe('lowpass');
    expect(made[1].frequency.value).toBe(7500);
    // The full chain, every link: noise -> highpass -> lowpass -> envelope.
    // Pinning only the head (highpass -> lowpass) leaves a lowpass that is
    // created, correctly typed, correctly tuned, and fed by the highpass,
    // with its output going nowhere -- silently identical to no topCut at
    // all. Without the second biquad a LOWER corner passes MORE energy,
    // which is how the darkest authored hat became the fullest-sounding one.
    expect(noise.connectedTo).toContain(made[0]);
    expect(made[0].connectedTo).toContain(made[1]);
    expect(made[1].connectedTo).toContain(env);
  });

  test('the open hat gets its own topCut', () => {
    const { engine, ctx } = freshEngine();
    // metal: 0 isolates the noise path this test targets — the bank has its
    // own tests in "metal crossfades the hat between bank and noise".
    (engine as any).drumSynth.drumKit.openhat = { filter: 3200, topCut: 7000, decay: 0.24, gain: 0.26, metal: 0 };
    const filtersBefore = ctx._filters.length;
    const noiseBefore = ctx._bufferSources.length;
    const gainsBefore = ctx._gains.length;

    engine.triggerDrum('openhat', 1.0);

    const made = ctx._filters.slice(filtersBefore);
    const noise = ctx._bufferSources[noiseBefore];
    const env = ctx._gains[gainsBefore];
    expect(made).toHaveLength(2);
    expect(made[0].type).toBe('highpass');
    expect(made[0].frequency.value).toBe(3200);
    expect(made[1].type).toBe('lowpass');
    expect(made[1].frequency.value).toBe(7000);
    // Same parity as the hihat test above: two voices that get the same
    // treatment in the engine get the same treatment here, full chain
    // included, or the weaker test becomes the hole.
    expect(noise.connectedTo).toContain(made[0]);
    expect(made[0].connectedTo).toContain(made[1]);
    expect(made[1].connectedTo).toContain(env);
  });

  test('the crash and the clap get no topCut — only the hats are a band', () => {
    const { engine, ctx } = freshEngine();

    // DEFAULT_BEAT_VOICES.crash.metal is 0.55, so a crash hit runs BOTH the
    // noise burst (1 bandpass) and the metallic bank (2 bandpass + 1
    // highpass) — 4 filters total, none of them a lowpass. That absence,
    // not the count, is what "no topCut" asserts; the count is pinned too so
    // a silently-dropped bank branch cannot make this pass for the wrong
    // reason.
    let before = ctx._filters.length;
    engine.triggerDrum('crash', 1.0);
    const crashFilters = ctx._filters.slice(before);
    expect(crashFilters).toHaveLength(4);
    expect(crashFilters.map((f) => f.type)).toEqual(['bandpass', 'bandpass', 'bandpass', 'highpass']);

    before = ctx._filters.length;
    engine.triggerDrum('clap', 1.0);
    expect(ctx._filters.slice(before)).toHaveLength(1);
  });

  test('both hats run a resonant highpass; the crash and the clap keep their own Q', () => {
    const { engine, ctx } = freshEngine();

    let before = ctx._filters.length;
    engine.triggerDrum('hihat', 1.0);
    // The resonant bump at the corner is the cheapest approximation of a
    // partial that white noise through one biquad can produce. 5 is the middle
    // of the sourced 4-6 band.
    expect(ctx._filters[before].Q.value).toBe(5);

    before = ctx._filters.length;
    engine.triggerDrum('openhat', 1.0);
    expect(ctx._filters[before].Q.value).toBe(5);

    // Asserted so a later edit cannot sweep the other noise voices along with
    // the hats: these two are authored values with their own reasons.
    before = ctx._filters.length;
    engine.triggerDrum('crash', 1.0);
    expect(ctx._filters[before].Q.value).toBe(0.8);

    before = ctx._filters.length;
    engine.triggerDrum('clap', 1.0);
    expect(ctx._filters[before].Q.value).toBe(1.5);
  });
});

describe('snare pair and rimshot', () => {
  test('a snare schedules TWO body oscillators plus its noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    // Pre-warm the per-track fader so `made.gain`'s order is the two body
    // envelopes only — DEV-386's track gain node is created lazily on first
    // use and would otherwise land between them.
    (engine as any).drumSynth.drumTrackGain('snare');
    const made = recordNodes(ctx);
    engine.triggerDrum('snare', 1);
    expect(made.osc).toHaveLength(2);
    expect(made.osc.map((o) => o.type)).toEqual(['triangle', 'triangle']);
    // Read off the installed patch rather than written out as two numbers:
    // what this pins is that each oscillator starts on ITS OWN field, which a
    // literal would stop doing the moment the default patch is re-voiced.
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([
      DEFAULT_BEAT_VOICES.snare.bodyFreqStart,
      DEFAULT_BEAT_VOICES.snare.bodyFreqStart2,
    ]);
    expect(made.osc.map((o) => o.frequency.ramps[0].v)).toEqual([
      DEFAULT_BEAT_VOICES.snare.bodyFreqEnd,
      DEFAULT_BEAT_VOICES.snare.bodyFreqEnd2,
    ]);
    expect(made.noise).toHaveLength(1);
    // Pin the SECOND partial's own gain (0.3, not 0.5 = bodyGain and not 0 —
    // an inert second partial still schedules a node that ramps to ENV_FLOOR
    // and would otherwise pass every count-only check above) and pin that
    // each oscillator reaches its OWN envelope: drumTone's osc.connect(env)
    // is a shared edge across every toned voice, and a node built but never
    // connected passes every value/count check that does not read `connectedTo`.
    expect(made.gain[0].gain.events[0].v).toBe(DEFAULT_BEAT_VOICES.snare.bodyGain);
    expect(made.gain[1].gain.events[0].v).toBe(DEFAULT_BEAT_VOICES.snare.bodyGain2);
    expect(DEFAULT_BEAT_VOICES.snare.bodyGain).not.toBe(DEFAULT_BEAT_VOICES.snare.bodyGain2);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
    expect(made.osc[1].connectedTo).toEqual([made.gain[1]]);
  });

  test('rimshot runs the same path off its own params, with almost no noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    // Pre-warm for the same reason the snare test above does.
    (engine as any).drumSynth.drumTrackGain('rimshot');
    const made = recordNodes(ctx);
    engine.triggerDrum('rimshot', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([
      DEFAULT_BEAT_VOICES.rimshot.bodyFreqStart,
      DEFAULT_BEAT_VOICES.rimshot.bodyFreqStart2,
    ]);
    const noiseEnv = made.gain.find(
      (g) => g.gain.events[0]?.v === DEFAULT_BEAT_VOICES.rimshot.noiseGain,
    );
    expect(noiseEnv).toBeDefined();
    // Same two pins as the snare test, off rimshot's own params: the two body
    // partials take their OWN gains, not 0/0 and not each other's.
    expect(made.gain[0].gain.events[0].v).toBe(DEFAULT_BEAT_VOICES.rimshot.bodyGain);
    expect(made.gain[1].gain.events[0].v).toBe(DEFAULT_BEAT_VOICES.rimshot.bodyGain2);
    expect(DEFAULT_BEAT_VOICES.rimshot.bodyGain).not.toBe(DEFAULT_BEAT_VOICES.rimshot.bodyGain2);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
    expect(made.osc[1].connectedTo).toEqual([made.gain[1]]);
  });
});

describe("drum aliases and unknown types", () => {
  test('closedhat resolves to its canonical voice', () => {
    const { engine, ctx } = freshEngine();
    // Both names resolve to the same instrument, so pre-warm its track fader
    // once: otherwise the FIRST iteration alone creates DEV-386's lazily-built
    // gain node and its count would not equal the second's.
    (engine as any).drumSynth.drumTrackGain('hihat');
    const counts: Record<string, number> = {};
    for (const type of ['hihat', 'closedhat']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      counts[type] = ctx._gains.length - before;
    }
    expect(counts.closedhat).toBe(counts.hihat);
  });

  test('hitom and lowtom are two different pitched voices', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    const made = recordNodes(ctx);
    engine.triggerDrum('lowtom', 1);
    engine.triggerDrum('hitom', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([
      DEFAULT_BEAT_VOICES.lowtom.freqStart,
      DEFAULT_BEAT_VOICES.hitom.freqStart,
    ]);
    expect(made.osc.map((o) => o.frequency.ramps[0].v)).toEqual([
      DEFAULT_BEAT_VOICES.lowtom.freqEnd,
      DEFAULT_BEAT_VOICES.hitom.freqEnd,
    ]);
  });

  test('a plain "tom" is no longer a recognized type, and "ride" is no longer aliased to crash: both stale aliases are gone', () => {
    // Decision 4 / task 5: triggerDrum resolves DRUM_ALIASES[name] ?? name
    // BEFORE the switch. If 'lowtom' still mapped to 'tom', case 'lowtom'
    // would be dead code; if 'ride' still mapped to 'crash', case 'ride'
    // would be dead code and every ride step would silently keep playing a
    // crash, with no error and no other failing test.
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('tom', 1.0);
    expect(ctx._gains.length).toBe(before);
    expect(DRUM_ALIASES.lowtom).toBeUndefined();
    expect(DRUM_ALIASES.ride).toBeUndefined();
    expect(DRUM_ALIASES).toEqual({ closedhat: 'hihat' });
  });

  test('DRUM_ALIASES is exactly { closedhat: hihat }', () => {
    // Not a style assertion. triggerDrum resolves DRUM_ALIASES[name] ?? name
    // BEFORE its switch, so a resurrected `lowtom: 'tom'` or `ride: 'crash'`
    // makes case 'lowtom' / case 'ride' unreachable dead code and every step on
    // those rows plays the wrong voice - with no error and no other failing
    // test, because the "every target is a real drum type" test still passes.
    expect({ ...DRUM_ALIASES }).toEqual({ closedhat: 'hihat' });
  });

  test('every drum type reaches its own case, with no alias in the way', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    for (const type of BEAT_VOICE_IDS) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      expect(ctx._gains.length, `${type} produced no audio`).toBeGreaterThan(before);
    }
    expect(BEAT_VOICE_IDS).toHaveLength(11);
  });

  // The counts-only test above would still pass if closedhat silently
  // misrouted to another single-envelope voice (e.g. lowtom), so these assert a
  // KIT PARAMETER that differs between the alias's real target and the most
  // plausible wrong one.
  test('closedhat resolves to hihat specifically, not openhat', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('closedhat', 1.0);
    // metal < 1 means the noise burst's envelope is always the FIRST gain
    // node this hit creates (the bank, if any, is wired after it) — pin by
    // that position rather than by "last", which the bank's own envelopes
    // now occupy.
    const env = ctx._gains[before];
    const hihatNoisePeak = DEFAULT_BEAT_VOICES.hihat.gain * (1 - DEFAULT_BEAT_VOICES.hihat.metal);
    const openhatNoisePeak = DEFAULT_BEAT_VOICES.openhat.gain * (1 - DEFAULT_BEAT_VOICES.openhat.metal);
    expect(env.gain.value).toBeCloseTo(hihatNoisePeak, 9);
    expect(env.gain.value).not.toBeCloseTo(openhatNoisePeak, 9);
  });

  test('lowtom resolves to its own low-tom voice, not kick', () => {
    const { engine, ctx } = freshEngine();
    const filter = (engine as any).masterRack.drumBusFilter;
    const before = ctx._gains.length;

    engine.triggerDrum('lowtom', 1.0);

    // The tom now also feeds the reverb send, so a plain index no longer
    // names the envelope reliably — select it by what it is connected to.
    // DEV-386 interposes the per-track fader between the envelope and
    // `filter`, so identify it via that persistent node rather than `filter`
    // directly.
    const track = (engine as any).drumSynth.drumTrackGain('lowtom');
    const env = ctx._gains.slice(before).find((g) => g.connectedTo.includes(track))!;
    expect(env).toBeDefined();
    expect(track.connectedTo).toContain(filter);
    expect(env.gain.value).toBeCloseTo(DEFAULT_BEAT_VOICES.lowtom.gain, 9);
    expect(env.gain.value).not.toBeCloseTo(DEFAULT_BEAT_VOICES.kick.gain, 9);
  });
});

describe("stale and hostile drum types are inert", () => {

  test('the type is case-insensitive', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('KICK', 1.0);
    expect(ctx._gains.length).toBeGreaterThan(before);
  });

  test('an unknown type is a silent no-op, not a throw', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    expect(() => engine.triggerDrum('cowbell', 1.0)).not.toThrow();
    expect(ctx._gains.length).toBe(before);
  });

  test('a type of "__proto__" is a silent no-op, not a throw', () => {
    // The non-switch dispatch (hitom/lowtom/ride/bell) is looked up on a
    // module-scope object, exactly like DRUM_ALIASES. If it were a plain
    // object literal instead of Object.create(null), this name would resolve
    // through the prototype chain to Object.prototype's own '__proto__'
    // accessor instead of `undefined`, and calling it as a handler would
    // throw inside triggerDrum — which clockTick calls on every scheduled
    // step, so that throw would stop the transport.
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    expect(() => engine.triggerDrum('__proto__', 1.0)).not.toThrow();
    expect(ctx._gains.length).toBe(before);
  });

  test('ride sends to the reverb bus at its own reverbSend level, not crash\'s', () => {
    const { engine, ctx } = freshEngine();
    const sendFilter = (engine as any).masterRack.drumSendFilter;
    const before = ctx._gains.length;
    engine.triggerDrum('ride', 1.0);
    // ride's metal>0 branch wires two metallicBurst sends and its metal<1
    // branch wires one noise-wash send, all at the SAME reverbSend LEVEL —
    // select every send gain by what it is connected to, not by position,
    // and require every one of them to carry ride's own value, not crash's
    // (removing reverbSend from all three call sites would leave this empty).
    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends.length).toBeGreaterThan(0);
    for (const send of sends) {
      expect(send.gain.value).toBeCloseTo(DEFAULT_BEAT_VOICES.ride.reverbSend, 9);
      expect(send.gain.value).not.toBeCloseTo(DEFAULT_BEAT_VOICES.crash.reverbSend, 9);
    }
  });

  test('every DRUM_ALIASES target is a real drum type', () => {
    const { engine, ctx } = freshEngine();
    for (const target of Object.values(DRUM_ALIASES)) {
      const before = ctx._gains.length;
      engine.triggerDrum(target, 1.0);
      expect(ctx._gains.length).toBeGreaterThan(before);
    }
  });
});

describe("the ride's bands and wash", () => {
  test('a ride schedules a ping band, a body band and a long wash', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const centres = made.biquad.filter((b) => b.type === 'bandpass').map((b) => b.frequency.value);
    expect(centres).toContain(DEFAULT_BEAT_VOICES.ride.pingFilter);  // ping
    expect(centres).toContain(DEFAULT_BEAT_VOICES.ride.bodyFilter);  // body
    expect(centres).toContain(DEFAULT_BEAT_VOICES.ride.washFilter);  // wash
    // The wash outlives the ping by more than an order of magnitude: that bed
    // surviving the next strike is what makes it a ride and not a crash.
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    expect(Math.max(...ends) - 10).toBeGreaterThan(1.5);
    // The PING's own tail: `pingDecay` after the strike at t=10.
    expect(ends).toContain(10 + DEFAULT_BEAT_VOICES.ride.pingDecay);
  });

  test("the metallic wash bands' own decay scales with washDecay, not a value borrowed from elsewhere", () => {
    // Task 5's hole: the test above takes Math.max across EVERY gain node the
    // hit creates, so collapsing ONLY the two metallic wash bands
    // (metallicBurst's bandA/bandB in the r.metal>0 branch, engine.ts's ride
    // wash call) to some other decay - crash.decay, say - while leaving the
    // metal<1 noise-burst wash untouched (DEFAULT_BEAT_VOICES's ride.metal=0.5
    // fires both branches) still produces a long tail from that OTHER branch,
    // and the aggregate max stays green - decision 33's central case, a ride
    // that is really a re-filtered crash, survives undetected. Vary washDecay
    // between two triggers and require each band's OWN envelope end to move
    // by the amount its formula says it should (proportional for band A,
    // 0.7x that for band B) - a value borrowed from a fixed/foreign field
    // would not move at all when washDecay does.
    function washBandEnds(washDecay: number) {
      const { engine, ctx } = freshEngine();
      const kit = { ...DEFAULT_BEAT_VOICES, ride: { ...DEFAULT_BEAT_VOICES.ride, washDecay } };
      (engine as any).drumSynth.drumKit = kit;
      const made = recordNodes(ctx);
      engine.triggerDrum('ride', 1);
      const bandA = made.biquad.find((b) => b.frequency.value === kit.ride.washFilter)!;
      const bandB = made.biquad.find((b) => b.frequency.value === METAL_BAND_B_HZ)!;
      const envA = bandA.connectedTo[0] as { gain: { ramps: { t: number }[] } };
      const envB = bandB.connectedTo[0] as { gain: { ramps: { t: number }[] } };
      return { a: envA.gain.ramps.at(-1)!.t, b: envB.gain.ramps.at(-1)!.t };
    }
    const short = washBandEnds(1.0);
    const long = washBandEnds(3.0);
    expect(long.a - short.a).toBeCloseTo(2.0, 9);
    expect(long.b - short.b).toBeCloseTo(1.4, 9);
  });

  test('a bell is two squares a detuned fifth apart through one bandpass', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    const made = recordNodes(ctx);
    engine.triggerDrum('bell', 1);
    expect(made.osc).toHaveLength(2);
    expect(made.osc.map((o) => o.type)).toEqual(['square', 'square']);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([800, 540]);
    const bp = made.biquad.filter((b) => b.type === 'bandpass');
    expect(bp).toHaveLength(1);
    expect(bp[0].frequency.value).toBe(880);
    expect(bp[0].Q.value).toBe(4.8);
    expect(made.noise).toHaveLength(0);   // the bell does not use the bank or noise
  });
});

describe("the bell voice", () => {

  test('ride\'s ping and wash component gains follow `ping`, not its inverse', () => {
    // metal: 1 isolates the two metallicBurst calls (the metal<1 noise-burst
    // branch does not fire), and an asymmetric ping (0.8, not 0.5) means the
    // two component gains are NOT interchangeable — pinning ping to either
    // extreme, or swapping it for (1 - ping) at all four call sites, produces
    // a wrong pair of numbers here, not just a wrong node COUNT or TIMING.
    const { engine, ctx } = freshEngine();
    const kit = { ...DEFAULT_BEAT_VOICES, ride: { ...DEFAULT_BEAT_VOICES.ride, ping: 0.8, metal: 1 } };
    (engine as any).drumSynth.drumKit = kit;
    // Pre-warm the track fader so it does not land in `made.gain` as a third
    // unautomated node below.
    (engine as any).drumSynth.drumTrackGain('ride');
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const r = kit.ride;
    const peak = 1 * r.gain;

    // `out.gain.value` is a direct assignment inside metallicBurst — never
    // touched by setValueAtTime/exponentialRampToValueAtTime — so it is the
    // only gain-with-no-automation whose value is neither `mix`'s constant
    // 1/METAL_RATIOS.length nor the reverb `send`'s constant reverbSend.
    const unautomated = made.gain.filter((g) => g.gain.events.length === 0 && g.gain.ramps.length === 0);
    const outs = unautomated.filter((g) => (
      Math.abs(g.gain.value - 1 / 6) > 1e-9 && Math.abs(g.gain.value - r.reverbSend) > 1e-9
    ));
    expect(outs).toHaveLength(2);
    const [pingOut, washOut] = outs;
    expect(pingOut.gain.value).toBeCloseTo(peak * r.metal * r.ping, 9);
    expect(washOut.gain.value).toBeCloseTo(peak * r.metal * (1 - r.ping), 9);
  });

  test('a ride pinned at ping=1 builds no wash component at all — decision 33 forbids it', () => {
    // metallicBurst itself no-ops on peak <= 0 (`if (o.peak <= 0) return null`),
    // so a wash peak of `metal * (1 - ping)` = 0 means the wash call never
    // builds a node in the first place, not a node built and then zeroed.
    const { engine, ctx } = freshEngine();
    const kit = { ...DEFAULT_BEAT_VOICES, ride: { ...DEFAULT_BEAT_VOICES.ride, ping: 1, metal: 1 } };
    (engine as any).drumSynth.drumKit = kit;
    // Pre-warm for the same reason the ping=0.8 test above does.
    (engine as any).drumSynth.drumTrackGain('ride');
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const r = kit.ride;
    const peak = 1 * r.gain;
    const unautomated = made.gain.filter((g) => g.gain.events.length === 0 && g.gain.ramps.length === 0);
    const outs = unautomated.filter((g) => (
      Math.abs(g.gain.value - 1 / 6) > 1e-9 && Math.abs(g.gain.value - r.reverbSend) > 1e-9
    ));
    expect(outs).toHaveLength(1);
    expect(outs[0].gain.value).toBeCloseTo(peak * r.metal, 9);
  });

  test('a bell wires both squares through its bandpass, its envelope, and out to the dry bus and the reverb send', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = DEFAULT_BEAT_VOICES;
    const dryBus = (engine as any).masterRack.drumBusFilter;
    const sendBus = (engine as any).masterRack.drumSendFilter;
    const made = recordNodes(ctx);
    engine.triggerDrum('bell', 1);
    const bp = made.biquad.find((b) => b.type === 'bandpass');
    expect(bp, 'bandpass must exist').toBeDefined();
    for (const osc of made.osc) {
      expect(osc.connectedTo, 'each square must feed the bandpass').toContain(bp);
    }
    // The envelope is whichever gain the bandpass feeds — the bell has no
    // `mix`/`out` pair (it does not use the metallic bank), so this is
    // unambiguous.
    const env = made.gain.find((g) => bp!.connectedTo.includes(g));
    expect(env, 'bandpass must feed an envelope gain').toBeDefined();
    // DEV-386 interposes the per-track fader between the envelope and the
    // dry bus, so the envelope now feeds THAT persistent node rather than
    // `dryBus` directly — confirm both hops.
    const track = (engine as any).drumSynth.drumTrackGain('bell');
    expect(env!.connectedTo, 'the envelope must feed the track fader').toContain(track);
    expect(track.connectedTo, 'the track fader must feed the dry bus').toContain(dryBus);
    const send = env!.connectedTo.find((n: unknown) => n !== track);
    expect(send, 'the envelope must also feed a reverb-send gain').toBeDefined();
    expect((send as { connectedTo: unknown[] }).connectedTo, 'the send must reach the shared reverb-send bus')
      .toContain(sendBus);
  });
});

describe("the hi-hat choke group", () => {
  test('a closed hat cuts a sounding open hat over 20 ms, from the value at the cut', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('openhat', 1.0, t0);
    // drumEnv creates the env gain first; wireDrumVoice's send gain (if any)
    // comes after it, so the first new gain is always the envelope.
    const openEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.05);

    // The ramp must start from the value AT the cut, not from the peak, or the
    // choke re-swells the voice. cancelAndHold is what holds that value.
    expect(openEnv.cancels).toContain(t0 + 0.05);
    // The discriminating assertion: a mutant that holds at the PEAK instead of
    // the value at the cut (e.g. cancelScheduledValues + setValueAtTime(param
    // .value, now) instead of cancelAndHold) leaves this suite green unless
    // something reads the held value back. t0 + 0.05 sits inside the open
    // hat's decay (0.35 s) but well after its attack, so the true envelope
    // value there is strictly below the peak (0.4) — a re-swelling choke would
    // instead show the peak itself at this instant.
    const peak = DEFAULT_BEAT_VOICES.openhat.gain;
    expect(openEnv.valueAt(t0 + 0.05)).toBeLessThan(peak);
    // It cannot ramp to 0 — exponentialRampToValueAtTime rejects a zero target
    // — so it lands on the shared ENV_FLOOR, 20 ms later.
    const last = openEnv.events[openEnv.events.length - 1];
    expect(last.kind).toBe('exp');
    expect(last.v).toBe(0.0001);
    expect(last.t).toBeCloseTo(t0 + 0.07, 9);
  });

  test('an open hat cuts a sounding closed hat over 8 ms — its own strike masks it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('hihat', 1.0, t0);
    const closedEnv = ctx._gains[before].gain;

    engine.triggerDrum('openhat', 1.0, t0 + 0.01);

    expect(closedEnv.cancels).toContain(t0 + 0.01);
    const last = closedEnv.events[closedEnv.events.length - 1];
    expect(last.v).toBe(0.0001);
    expect(last.t).toBeCloseTo(t0 + 0.018, 9);
  });

  test('the crash is in no choke group — real crashes ring through each other', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('crash', 1.0, t0);
    const crashEnv = ctx._gains[before].gain;

    engine.triggerDrum('crash', 1.0, t0 + 0.05);
    engine.triggerDrum('hihat', 1.0, t0 + 0.1);

    // `ride` aliases to `crash` today (DRUM_ALIASES), so this covers the ride
    // too: a ride struck in time-keeping must overlap itself.
    expect(crashEnv.cancels).toEqual([]);
  });

  test('a hat that has already finished is not reached by a later choke', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    // DEFAULT_BEAT_VOICES.hihat.decay is 0.05 and the default stopPad is 0.01, so
    // this voice is over at t0 + 0.06.
    engine.triggerDrum('hihat', 1.0, t0);
    const deadEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.5);

    expect(deadEnv.cancels).toEqual([]);
  });

  // The next four tests reach `registerHatVoice`/`chokeHats` directly through
  // a cast, the way testFakes.ts's own header note describes tests reaching
  // any other private engine field: it isolates the choke-group mechanics
  // from a particular kit's numbers, which is what makes the fallback and
  // array-contract assertions below exact rather than approximate.

  test('the cancelAndHold fallback is the registered peak, not the raw AudioParam value (Firefox path)', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const now = ctx.currentTime;
    // A freshly created gain param defaults to .value = 1 — the same shape a
    // real AudioParam has when its scheduled setValueAtTime has not yet been
    // reached by the audio clock, which is the ordinary case for a sequenced
    // hit (CLOCK_LOOKAHEAD schedules ~100 ms ahead). Falling back to that
    // default instead of the registered peak (0.4 here) would hold the choke
    // near unity gain — the re-swell-and-click Fix 2 exists to prevent.
    const env = ctx.createGain();
    const source = ctx.createBufferSource();
    (engine as any).drumSynth.registerHatVoice('hihat', [env], [0.4], [source], now, now + 1);

    (engine as any).drumSynth.chokeHats(now + 0.05, 0.02);

    const held = env.gain.events[0];
    expect(held.v).toBe(0.4);
    expect(held.v).not.toBe(1);
  });
});

describe("chokeHats teardown and the queued-hit rules", () => {

  test('dispose stops every tracked source and forgets the bound context idempotently', () => {
    const { engine, ctx } = freshEngine();
    const drumSynth = (engine as any).drumSynth;
    const sourceA = ctx.createBufferSource();
    const sourceB = ctx.createBufferSource();
    drumSynth.registerHatVoice(
      'hihat',
      [ctx.createGain()],
      [0.4],
      [sourceA, sourceB],
      ctx.currentTime,
      ctx.currentTime + 1,
    );

    drumSynth.dispose(ctx.currentTime);
    drumSynth.dispose(ctx.currentTime);

    expect(sourceA._stopArgs).toEqual([ctx.currentTime]);
    expect(sourceB._stopArgs).toEqual([ctx.currentTime]);
    expect(drumSynth.soundingHats.size).toBe(0);
    expect(drumSynth.ctx).toBeNull();
  });

  test('chokeHats still stops every source, even though a single noise source already schedules its own stop', () => {
    // `drumNoiseBurst` calls `noise.stop(stopAt)` itself, so this loop is
    // redundant for today's only source — and slice 4 deliberately keeps it
    // that way for the oscillator bank too: `metallicBurst` schedules its own
    // `osc.stop()`, and its oscillators are never added to `sources` (see the
    // corrected comment on `chokeHats`). This loop is pinned anyway because
    // `sources` is not always just today's one noise buffer — a future source
    // type without its own stop() would silently ring on without it.
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    const env = ctx.createGain();
    const source = ctx.createBufferSource();
    (engine as any).drumSynth.registerHatVoice('hihat', [env], [0.4], [source], now, now + 1);

    (engine as any).drumSynth.chokeHats(now + 0.05, 0.02);

    expect(source._stopArgs).toEqual([now + 0.07]);
  });

  test('chokeHats ramps every envelope and stops every source of a voice, not just the first', () => {
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    const envs = [ctx.createGain(), ctx.createGain()];
    const sources = [ctx.createBufferSource(), ctx.createBufferSource(), ctx.createBufferSource()];
    (engine as any).drumSynth.registerHatVoice('hihat', envs, [0.3, 0.5], sources, now, now + 1);

    (engine as any).drumSynth.chokeHats(now + 0.05, 0.02);

    for (const env of envs) {
      expect(env.gain.cancels).toContain(now + 0.05);
      const last = env.gain.events[env.gain.events.length - 1];
      expect(last.kind).toBe('exp');
      expect(last.v).toBe(0.0001);
    }
    for (const source of sources) {
      expect(source._stopArgs).toEqual([now + 0.07]);
    }
  });

  test('registerHatVoice throws when peaks and envs have different lengths', () => {
    // Today's two call sites always pass one peak per envelope, so this can't
    // fire yet — it exists for slice 4's metallic bank, whose two envelopes
    // make a one-character mismatch easy to introduce. Left unchecked, a short
    // peaks array degrades silently: chokeHats falls back to the live
    // AudioParam.value instead of the registered peak, reinstating the
    // Firefox re-swell finding 2 was written to eliminate, with no exception
    // and no failing test.
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    const envs = [ctx.createGain(), ctx.createGain()];
    const source = ctx.createBufferSource();
    expect(() => {
      (engine as any).drumSynth.registerHatVoice('hihat', envs, [0.4], [source], now, now + 1);
    }).toThrow(/2 envs but 1 peaks/);
  });

  test('a live hit does not evict the queued hit it is not allowed to choke', () => {
    // The regression this exists for: chokeHats deliberately SKIPS a voice
    // whose startAt is still in the future (a live pad press must not silence
    // a hit the sequencer has already queued). If registerHatVoice then
    // REPLACED the entry under that name, the queued voice would be dropped
    // from the group entirely and could never be choked — it would sound at
    // its scheduled time and ring straight through every later hat.
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    // The sequencer queues a hat 0.1 s ahead (CLOCK_LOOKAHEAD's shape).
    const queuedEnv = ctx.createGain();
    (engine as any).drumSynth.registerHatVoice('hihat', [queuedEnv], [0.4], [], now + 0.1, now + 0.4);
    // A live pad press lands NOW, inside that window.
    const liveEnv = ctx.createGain();
    (engine as any).drumSynth.chokeHats(now, 0.02);
    (engine as any).drumSynth.registerHatVoice('hihat', [liveEnv], [0.4], [], now, now + 0.05);

    // The queued voice was neither choked nor forgotten.
    expect(queuedEnv.gain.cancels).toEqual([]);
    expect((engine as any).drumSynth.soundingHats.get('hihat')).toHaveLength(2);

    // A later hat, once the queued one is really sounding, cuts it.
    (engine as any).drumSynth.chokeHats(now + 0.2, 0.02);
    expect(queuedEnv.gain.cancels).toContain(now + 0.2);
  });

  test('a sequenced pair scheduled ahead of the real clock still chokes each other', () => {
    // Both hits are scheduled ahead (as a sequencer always schedules), so the
    // choke must be evaluated at the NEW hit's own scheduled time, not at
    // ctx.currentTime — which never advances in this harness and stays well
    // behind both.
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('openhat', 1.0, t0 + 0.2);
    const openEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.25);

    expect(openEnv.cancels).toContain(t0 + 0.25);
  });

  test('a live press does not choke a voice the sequencer has queued but which has not started', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    // The sequencer has already queued an open hat 100 ms ahead of the real
    // clock (a step in the lookahead window).
    engine.triggerDrum('openhat', 1.0, t0 + 0.1);
    const queuedEnv = ctx._gains[before].gain;

    // A live pad press lands at the real "now" — before the queued hat's own
    // start time. It must not reach forward and silence a hit that has not
    // begun, or that hit never sounds at all.
    engine.triggerDrum('hihat', 1.0, t0);

    expect(queuedEnv.cancels).toEqual([]);
  });
});

describe('per-track drum gain', () => {
  test('a track gain node sits between the voice envelope and the drum bus', () => {
    const { engine } = freshEngine();
    engine.setDrumTrackGain('kick', 0.5);
    engine.triggerDrum('kick', 0.8, 0);
    // The node exists, is cached per instrument, and carries the level the
    // setter was given — not the velocity the trigger was given.
    expect(engine.__drumTrackGainValueForTests('kick')).toBeCloseTo(0.5, 8);
  });

  test('an unset instrument plays at unity, not silence', () => {
    const { engine } = freshEngine();
    engine.triggerDrum('snare', 0.8, 0);
    expect(engine.__drumTrackGainValueForTests('snare')).toBeCloseTo(1, 8);
  });

  test('the setter accepts a gain above 1 — a fader may boost, a velocity may not', () => {
    const { engine } = freshEngine();
    engine.setDrumTrackGain('hihat', 3.9810717);
    expect(engine.__drumTrackGainValueForTests('hihat')).toBeGreaterThan(1);
  });

  test('the node is reused across hits rather than rebuilt per voice', () => {
    const { engine } = freshEngine();
    engine.setDrumTrackGain('clap', 0.25);
    engine.triggerDrum('clap', 0.8, 0);
    engine.triggerDrum('clap', 0.8, 0.5);
    expect(engine.__drumTrackGainCountForTests()).toBe(1);
  });

  test('an unknown instrument is ignored, not minted as an orphan node', () => {
    // Decision, DEV-386 fix round 1: a name outside BEAT_VOICE_IDS will never be
    // resolved by triggerDrum's dispatch, so a node built for it would live
    // forever with nothing feeding it. See setDrumTrackGain's own comment.
    const { engine } = freshEngine();
    engine.setDrumTrackGain('cowbell-typo', 0.5);
    // Read via the count, not the value reader: __drumTrackGainValueForTests
    // itself calls the lazy accessor and would create a node as a side
    // effect of asking — the setter's own no-op is what this pins.
    expect(engine.__drumTrackGainCountForTests()).toBe(0);
  });

  test('the reverb send is seeded from the track fader × the kit reverbSend, not reverbSend alone', () => {
    // Must-fix 2 (DEV-386 fix round 1): dropping the `* track.gain.value`
    // factor from the send seed in wireDrumVoice is the exact regression this
    // guards — the whole reason the track fader sits ahead of the wet/dry
    // split is that pulling a track down must move its reverb tail with it.
    const { engine, ctx } = freshEngine();
    const sendFilter = (engine as any).masterRack.drumSendFilter;
    const kit = (engine as any).drumSynth.drumKit;
    engine.setDrumTrackGain('kick', 0.5);
    const before = ctx._gains.length;
    engine.triggerDrum('kick', 0.8, 0);
    const send = ctx._gains.slice(before).find((g) => g.connectedTo.includes(sendFilter));
    expect(send, 'kick send gain').toBeDefined();
    expect(send!.gain.value).toBeCloseTo(kit.kick.reverbSend * 0.5, 9);
    // Sanity: the factor is doing real work — a pulled-down track's send is
    // measurably quieter than the kit's raw authored reverbSend.
    expect(send!.gain.value).toBeLessThan(kit.kick.reverbSend);
  });

  test('the persistent track node carries exactly one outgoing edge, and repeated hits never add more', () => {
    // Must-fix 3 (DEV-386 fix round 1): the persistent per-track node must
    // connect to drumBusFilter once and only once, forever — the wet send is
    // deliberately NOT routed through it (seeded instead), because a second
    // edge here (e.g. `track.connect(send)`) would never be severed by
    // release(), which only disconnects the send's own outgoing edges.
    const { engine } = freshEngine();
    const filter = (engine as any).masterRack.drumBusFilter;
    engine.triggerDrum('kick', 0.8, 0);
    const track = (engine as any).drumSynth.drumTrackGain('kick');
    expect(track.connectedTo).toEqual([filter]);
    for (let i = 0; i < 50; i += 1) engine.triggerDrum('kick', 0.8, i * 0.05);
    expect(track.connectedTo).toEqual([filter]);
  });
});
