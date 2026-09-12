import { describe, expect, test } from 'bun:test';
import { ENV_FLOOR } from './constants';
import { METAL_RATIOS } from './engine';
import { DEFAULT_DRUM_KIT } from '@/data/drumKits';
import { freshEngine } from './testFakes';
import { recordNodes } from './engineTestHelpers';

/**
 * The drum synth metal oscillator bank: the hats, ride, bell and crash metal path.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('metallic oscillator bank', () => {
  test('METAL_RATIOS are the 808 inharmonic set and contain no even multiple', () => {
    expect([...METAL_RATIOS]).toEqual([1, 1.483, 1.8, 2.546, 2.63, 3.897]);
    // The margin is thin: 3.897 clears this 0.09 threshold by only 0.013
    // (|3.897 - 4| = 0.103); the next closest is 1.8, at 0.110. A future edit
    // to either the threshold or a ratio must be made with that margin in view.
    for (const r of METAL_RATIOS) {
      // The fundamental itself (ratio 1) is definitionally a whole number and
      // is not what "avoid even multiples" targets — the rule guards the
      // other five partials against landing on a simple harmonic of it.
      if (r === 1) continue;
      expect(Math.abs(r - Math.round(r))).toBeGreaterThan(0.09);
    }
  });

  test('six squares at tone * ratio, split into two independently enveloped bands', () => {
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).drumSynth.metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1.0, level: 1.0, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });

    expect(made.osc).toHaveLength(6);
    expect(made.osc.map((o) => o.type)).toEqual(Array(6).fill('square'));
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 200 * r),
    );

    // Two bandpasses plus one highpass.
    expect(made.biquad.map((b) => b.type)).toEqual(['bandpass', 'bandpass', 'highpass']);
    expect(made.biquad.map((b) => b.frequency.value)).toEqual([7100, 3440, 7000]);
    expect(made.biquad.map((b) => b.Q.value)).toEqual([1, 1.2, 0.7]);

    // The band envelopes must END at different times: that difference is the
    // falling spectral centroid, and a single envelope cannot fake it.
    const bandEnds = made.gain
      .map((g) => g.gain.ramps.at(-1)?.t)
      .filter((t): t is number => t !== undefined);
    expect(bandEnds).toContain(10.05);
    expect(bandEnds).toContain(10.2);
  });

  test('peak and the mix trim are enforced, not just typed', () => {
    // out.gain.value = peak and mix.gain.value = 1/6 are both load-bearing:
    // task 2 balances the bank against the noise burst through `peak`, so an
    // unenforced value would let that balance silently do nothing.
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).drumSynth.metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.37, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });
    const [mix, out] = made.gain;
    expect(out.gain.value).toBe(0.37);
    expect(mix.gain.value).toBeCloseTo(1 / METAL_RATIOS.length);
  });

  test('every link in the signal path is wired: osc -> mix -> bandpass -> envelope -> highpass -> out -> drum bus', () => {
    // Cutting any ONE of these connections must fail here. A node that is
    // created, typed and tuned correctly but reaches nothing is inaudible —
    // this is the same hole slice 3 shipped in the hat's lowpass (created,
    // never connected) and nearly again in the hat's Q, and it stayed green
    // because nothing read a node's actual `connect()` targets back.
    const { engine, ctx } = freshEngine();
    // metallicBurst is called directly, not through triggerDrum, so it names
    // its own voice in the options object — the routing is a parameter now,
    // not a field triggerDrum had to have set first. Its track fader is
    // pre-warmed so it does not land in `made.gain`.
    (engine as any).drumSynth.drumTrackGain('metallic-bank-test-voice');
    const made = recordNodes(ctx);
    (engine as any).drumSynth.metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1.0, level: 1.0, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });

    // made.gain creation order: mix, out, bandA's envelope, bandB's envelope
    // (no reverbSend here, so wireDrumVoice creates no extra send gain).
    // made.biquad creation order: bandA's bandpass, bandB's bandpass, highpass.
    const [mix, out, envA, envB] = made.gain;
    const [bpA, bpB, hp] = made.biquad;

    // Every one of the six oscillators reaches the mix, and only the mix.
    // A total node count (the ceiling test) cannot see one oscillator
    // created and started but never connected — six nodes still exist, the
    // count is unchanged, and the bank quietly plays five partials instead
    // of six. This checks each oscillator's actual connection target, not
    // the count of oscillators.
    for (const osc of made.osc) expect(osc.connectedTo).toEqual([mix]);
    expect(made.osc.filter((o) => o.connectedTo.includes(mix))).toHaveLength(6);

    // The mix feeds BOTH bandpasses — the shared source both bands filter
    // independently — and each bandpass feeds only its own envelope.
    expect(mix.connectedTo).toEqual([bpA, bpB]);
    expect(bpA.connectedTo).toEqual([envA]);
    expect(bpB.connectedTo).toEqual([envB]);

    // Both band envelopes converge on the shared highpass...
    expect(envA.connectedTo).toEqual([hp]);
    expect(envB.connectedTo).toEqual([hp]);

    // ...which reaches the output gain...
    expect(hp.connectedTo).toEqual([out]);

    // ...which reaches onward, through wireDrumVoice, to the drum bus — via
    // the pre-warmed per-track fader DEV-386 interposes ahead of it.
    const track = (engine as any).drumSynth.drumTrackGain('metallic-bank-test-voice');
    expect(out.connectedTo).toEqual([track]);
    expect(track.connectedTo).toContain((engine as any).masterRack.drumBusFilter);
  });

  test('every node the bank creates is disconnected by onended', () => {
    const { engine, ctx } = freshEngine();
    // See the previous test's comment on why an explicit name is used.
    (engine as any).drumSynth.drumTrackGain('metallic-bank-test-voice');
    const made = recordNodes(ctx);
    (engine as any).drumSynth.metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });
    const all = [...made.osc, ...made.gain, ...made.biquad];
    expect(all.some((n) => n.connectedTo.length > 0)).toBe(true);
    for (const osc of made.osc) osc.onended?.();
    expect(all.filter((n) => n.connectedTo.length > 0)).toEqual([]);
  });

  test('one bank hit stays under the node ceiling', () => {
    const { engine, ctx } = freshEngine();
    // See the first bank test's comment on why an explicit name is used; the
    // ceiling counts THIS hit's nodes.
    (engine as any).drumSynth.drumTrackGain('metallic-bank-test-voice');
    const made = recordNodes(ctx);
    (engine as any).drumSynth.metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 205.3, peak: 0.4, t: 10, highpass: 7000, reverbSend: 0.3,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.05 },
    });
    const total = made.osc.length + made.gain.length + made.biquad.length + made.noise.length;
    // Measured: 6 osc + 1 mix + 2 bandpass + 2 band envelopes + 1 highpass +
    // 1 out = 13, plus 1 reverb send = 14 as asserted here. A mixed hat shares
    // that one send rather than adding a second, so it is the bank's 13 plus
    // drumNoiseBurst's hihat path — 1 noise + 2 biquad (filter + topCut) +
    // 1 gain = 4 — for 17 nodes, not the 16 an earlier draft derived from a
    // 3-node noise path measured before topCut existed. At
    // 16ths and 140 BPM that is 9.3 hits/s per hat track, so this ceiling is
    // the thing standing between a third band and a crackle.
    expect(total).toBeLessThanOrEqual(14);
  });
});

describe("metal crossfades the hat between bank and noise", () => {
  test('a mid-metal hat creates both halves, scaled by the crossfade', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0.75 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc).toHaveLength(6);           // the bank
    expect(made.noise).toHaveLength(1);         // the noise layer survives
    const levels = made.gain.map((g) => g.gain.value ?? 0);
    expect(levels).toContain(0.4 * 0.75);       // bank at metal
    const noiseEnv = made.gain.find((g) => g.gain.events[0]?.v === 0.4 * 0.25);
    expect(noiseEnv).toBeDefined();             // noise at 1 - metal
  });

  test('metal 0 creates no oscillator and metal 1 creates no noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0 },
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc).toHaveLength(0);
    expect(made.noise).toHaveLength(1);
    made.osc.length = 0; made.noise.length = 0;
    engine.triggerDrum('openhat', 1);
    expect(made.osc).toHaveLength(6);
    expect(made.noise).toHaveLength(0);
  });
});

describe("the hat band across the metal crossfade", () => {

  test('the open hat rings longer in its LOW band than the closed hat does', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('openhat', 1);
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    // band A at decay, band B at 1.8x decay: the low band outlives the high one.
    expect(ends).toContain(10 + 0.3);
    expect(ends).toContain(10 + 0.54);
  });

  test('the closed hat does NOT stretch or relevel its low band the way the open hat does', () => {
    // Symmetric counterpart to the open-hat test above. Swapping the closed
    // hat's own (bandBLevel, bandBDecayMult) call args for the open hat's —
    // (0.25, 1) -> (0.45, 1.8) — stayed green with only the open hat pinned;
    // two voices given the same treatment in triggerHatVoice must be given
    // the same treatment here, or the unpinned one is the hole.
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    expect(ends).toContain(10 + 0.05);
    expect(ends).not.toContain(10 + 0.05 * 1.8);
    // Both bands have attack 0, so each envelope's peak is set directly via
    // .value: band B's level is 0.25 here, never the open hat's 0.45.
    const levels = made.gain.map((g) => g.gain.value);
    expect(levels).toContain(0.25);
    expect(levels).not.toContain(0.45);
  });

  test('the hat bank uses METAL_TONE_HAT (205.3), not the crash tone', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 205.3 * r),
    );
  });

  test('a closed hat chokes BOTH halves of a ringing open hat, and only those halves', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0.5 },
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 0.5 },
    };
    // Pre-warm the openhat track fader so it does not land in `made.gain`.
    (engine as any).drumSynth.drumTrackGain('openhat');
    const made = recordNodes(ctx);
    engine.triggerDrum('openhat', 1);
    const openGains = [...made.gain];
    // noise env + the bank's mix/out/envA/envB = 5 gains for 0 < metal < 1.
    expect(openGains).toHaveLength(5);

    const chokeAt = 10.1;
    const release = 0.02; // HIHAT_CHOKE_RELEASE
    ctx.currentTime = chokeAt;
    engine.triggerDrum('hihat', 1);

    // A vacuous version of this assertion (any ramp at or after chokeAt)
    // would also be satisfied by the band envelopes' own natural decay ramps
    // at 10.3 and 10.54 — neither of which is a choke. The actual signature
    // of a choke is an 'exp' event landing at EXACTLY chokeAt + release with
    // value ENV_FLOOR: assert that precisely, and only on the two gains
    // `registerHatVoice` actually holds (the noise env and the bank's
    // `out`) — `mix`/envA/envB are internal to `metallicBurst` and were
    // never registered, so they must NOT show it.
    const chokedExactly = (g: (typeof openGains)[number]) => g.gain.events.some(
      (e: { kind: string; t: number; v: number }) =>
        e.kind === 'exp' && e.t === chokeAt + release && e.v === ENV_FLOOR,
    );
    expect(openGains.filter(chokedExactly)).toHaveLength(2);
  });
});

describe("the hat bank's envelope parity and stopAt", () => {

  test('metal 0 registers exactly one envelope — the parity guard does not fire (pure noise)', () => {
    const { engine } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0 },
    };
    expect(() => engine.triggerDrum('hihat', 1)).not.toThrow();
    const voice = (engine as any).drumSynth.soundingHats.get('hihat').at(-1);
    expect(voice.envs).toHaveLength(1);
    expect(voice.peaks).toHaveLength(1);
  });

  test('metal 1 registers exactly one envelope — the parity guard does not fire (pure bank)', () => {
    const { engine } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    expect(() => engine.triggerDrum('openhat', 1)).not.toThrow();
    const voice = (engine as any).drumSynth.soundingHats.get('openhat').at(-1);
    expect(voice.envs).toHaveLength(1);
    expect(voice.peaks).toHaveLength(1);
  });

  test("stopAt is derived from the bank's own schedule, not recomputed from bandBDecayMult", () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const now = ctx.currentTime;
    // bandBDecayMult 0.5 (below 1): band B decays FASTER than band A, so the
    // bank's true tail is band A's unmultiplied 0.3s. A caller-side
    // recomputation of `now + h.decay * bandBDecayMult + 0.02` would instead
    // land on band B's shorter 0.17s and understate the tail by 0.13s,
    // letting chokeHats silently skip a still-ringing voice in that window.
    (engine as any).drumSynth.triggerHatVoice(
      'hihat', (engine as any).drumSynth.drumKit.hihat, 0.4, now, 0.25, 0.5,
    );
    const voice = (engine as any).drumSynth.soundingHats.get('hihat').at(-1);
    expect(voice.stopAt).toBeCloseTo(now + 0.3 + 0.02, 9);
  });
});

describe("the crash's metal crossfade is pinned end to end", () => {
  test('every link in the crash bank path is wired, using the crash tone, corner, attack and send', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      crash: { filter: 6000, decay: 1.0, gain: 0.5, reverbSend: 0.4, metal: 0.6 },
    };
    // Pre-warm the crash track fader so `made.gain`'s creation order below
    // is unchanged by DEV-386's lazily-built per-track node.
    (engine as any).drumSynth.drumTrackGain('crash');
    const made = recordNodes(ctx);
    engine.triggerDrum('crash', 1);

    const peak = 1 * 0.5;
    // made.gain creation order: noise env, noise send, then metallicBurst's
    // mix, out, its own send, band A env, band B env (both sends exist
    // because reverbSend > 0 here).
    const [noiseEnv, noiseSend, mix, out, bankSend, envA, envB] = made.gain;
    // made.biquad creation order: the noise burst's bandpass, then the
    // bank's band A bandpass, band B bandpass, highpass.
    const [, bpA, bpB, hp] = made.biquad;

    // --- The crossfade actually gates and scales BOTH halves ---
    expect(noiseEnv.gain.value).toBeCloseTo(peak * (1 - 0.6), 9);
    expect(out.gain.value).toBeCloseTo(peak * 0.6, 9);

    // --- The bank uses the crash's OWN tone (165), not the hat's (205.3) ---
    expect(made.osc).toHaveLength(6);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 165 * r),
    );

    // --- The highpass corner is filter * 0.5, not filter ---
    expect(hp.type).toBe('highpass');
    expect(hp.frequency.value).toBe(3000);

    // --- Both bands bloom over 8ms (attack 0.008), not switch on instantly ---
    // attack > 0 schedules THREE events: floor, then the ramp to level at
    // t + attack, then the ramp to floor at t + attack + decay. attack = 0
    // would collapse this to two events, with the second landing at `t`.
    for (const env of [envA, envB]) {
      expect(env.gain.events).toHaveLength(3);
      expect(env.gain.events[1].t).toBeCloseTo(10.008, 9);
    }

    // --- The bank wires its OWN reverb send — the same unpinned-connection
    // hole this branch has now shipped three times (a node built, typed and
    // tuned correctly, whose output reaches nothing) ---
    expect(bankSend.gain.value).toBeCloseTo(0.4, 9);
    expect(noiseSend.gain.value).toBeCloseTo(0.4, 9);

    // --- The full chain, tail included ---
    for (const osc of made.osc) expect(osc.connectedTo).toEqual([mix]);
    expect(mix.connectedTo).toEqual([bpA, bpB]);
    expect(bpA.connectedTo).toEqual([envA]);
    expect(bpB.connectedTo).toEqual([envB]);
    expect(envA.connectedTo).toEqual([hp]);
    expect(envB.connectedTo).toEqual([hp]);
    expect(hp.connectedTo).toEqual([out]);
    // Both the bank's `out` and the noise burst's envelope route through the
    // same pre-warmed per-track fader (DEV-386) ahead of the drum bus.
    const track = (engine as any).drumSynth.drumTrackGain('crash');
    expect(out.connectedTo).toEqual([track, bankSend]);
    expect(bankSend.connectedTo).toEqual([(engine as any).masterRack.drumSendFilter]);
    expect(noiseEnv.connectedTo).toEqual([track, noiseSend]);
    expect(noiseSend.connectedTo).toEqual([(engine as any).masterRack.drumSendFilter]);
    expect(track.connectedTo).toContain((engine as any).masterRack.drumBusFilter);
  });

  test('crash metal 0 runs no bank; crash metal 1 runs no noise — metal actually gates the branch', () => {
    const { engine: e0, ctx: c0 } = freshEngine();
    (e0 as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      crash: { filter: 6000, decay: 1.0, gain: 0.5, reverbSend: 0.4, metal: 0 },
    };
    const made0 = recordNodes(c0);
    e0.triggerDrum('crash', 1);
    expect(made0.osc).toHaveLength(0);
    expect(made0.noise).toHaveLength(1);
    expect(made0.biquad).toHaveLength(1); // the noise bandpass only

    const { engine: e1, ctx: c1 } = freshEngine();
    (e1 as any).drumSynth.drumKit = {
      ...DEFAULT_DRUM_KIT,
      crash: { filter: 6000, decay: 1.0, gain: 0.5, reverbSend: 0.4, metal: 1 },
    };
    const made1 = recordNodes(c1);
    e1.triggerDrum('crash', 1);
    expect(made1.osc).toHaveLength(6);
    expect(made1.noise).toHaveLength(0);
    expect(made1.biquad).toHaveLength(3); // band A, band B, highpass only
  });
});
