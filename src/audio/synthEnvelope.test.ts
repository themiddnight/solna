import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { SynthParams } from '../types';
import { fakeParam, freshEngine, makeEngine } from './testFakes';
import { dbToGain, toDecibels } from '../utils/gainUnits';
import { NEUTRAL_TRIM_GAIN, synthTrimGainFor } from './trims';
import { SYNTH, trimTestParams } from './engineTestHelpers';

/**
 * Synth voice envelope shape: amp/filter ramps and floors, LFO, noise and scaling.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('live polyphony equal-power scaling', () => {
  test('applySynthVelocityScale re-scales every live voice and skips released ones', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('G4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('G4', SYNTH.release, undefined, 'synth');

    engine.applySynthVelocityScale(0.5, 'synth');

    const voices = (engine as any).synthVoices.activeVoices;
    const c4 = voices.get('synth:C4');
    const g4 = voices.get('synth:G4');
    const reScaledSustain = 0.8 * 0.4 * SYNTH.sustain * 0.5;

    expect(c4.envelopeScale).toBe(0.5);
    expect(c4.gains[0].gain.targets).toHaveLength(1);
    expect(c4.gains[0].gain.targets[0].v).toBeCloseTo(reScaledSustain, 5);
    expect(c4.gains[0].gain.targets[0].tc).toBe(0.01);
    expect(c4.gains[0].gain.cancels).toContain(t0);

    // The released voice keeps its own release ramp; no re-scale target.
    expect(g4.gains[0].gain.targets).toHaveLength(0);
  });

  test('a voice triggered with a scaleFactor re-scales relative to it', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 1.0, undefined, 'synth', 0.5, 'live');
    const c4 = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(c4.envelopeScale).toBe(0.5);

    engine.applySynthVelocityScale(0.25, 'synth');
    expect(c4.gains[0].gain.targets).toHaveLength(1);
    expect(c4.gains[0].gain.targets[0].v).toBeCloseTo(
      1.0 * 0.4 * SYNTH.sustain * 0.25,
      5,
    );
  });

  test('a re-scale that matches the current scale leaves voices untouched', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.applySynthVelocityScale(1, 'synth');

    const c4 = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(c4.gains[0].gain.targets).toHaveLength(0);
  });

  test('rescales only the named source — a keyboard press leaves chord voices alone', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('A3', SYNTH, 0.8, undefined, 'chord', 1, 'live');

    engine.applySynthVelocityScale(0.5, 'synth');

    const voices = (engine as any).synthVoices.activeVoices;
    const lead = voices.get('synth:C4');
    const chord = voices.get('chord:A3');

    expect(lead.envelopeScale).toBe(0.5);
    expect(lead.gains[0].gain.targets).toHaveLength(1);

    // The chord voice is on a bus nobody pressed a key on: no re-scale at all.
    // Asserted on the RECORDED events, not on a computed value — fakeParam's
    // valueAt() refuses a timeline containing setTargetAtTime and this path
    // uses it.
    expect(chord.envelopeScale).toBe(1);
    expect(chord.gains[0].gain.targets).toHaveLength(0);
  });
});

describe('noise source', () => {
  const NOISY: SynthParams = { ...SYNTH, noiseVolume: 0.25 };

  test('a preset with noiseVolume 0 creates no noise source at all', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(ctx._bufferSources).toHaveLength(0);
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.noise).toBeUndefined();
    expect(voice.noiseGain).toBeUndefined();
  });

  test('a preset with noiseVolume > 0 gets a looped noise source at that level', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(ctx._bufferSources).toHaveLength(1);
    // Without loop the noise would run out mid-note: the buffer is 2 s while
    // this preset's decay + release already exceed that.
    expect(ctx._bufferSources[0].loop).toBe(true);

    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.noiseGain.gain.value).toBe(0.25);
  });

  test('the noise level scales with noiseVolume rather than being a fixed amount', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0.4 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', { ...SYNTH, noiseVolume: 0.02 }, 0.8, ctx.currentTime, 'synth', 1, 'live');

    const loud = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const quiet = (engine as any).synthVoices.activeVoices.get('synth:E4');
    expect(loud.noiseGain.gain.value).toBe(0.4);
    expect(quiet.noiseGain.gain.value).toBe(0.02);
  });

  test('noise runs into the filter, not past it, so the VCF envelope shapes it', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    // Noise is a third source alongside osc1/oscSub, so it belongs upstream of
    // the filter. Wired to the VCA instead it would still have the right level
    // but would ignore filterCutoff, filterEnvAmount and the filter envelope
    // entirely — a permanently open hiss layer on every noisy preset.
    expect(voice.noise.connectedTo).toEqual([voice.noiseGain]);
    expect(voice.noiseGain.connectedTo).toEqual([voice.filter]);
    expect(voice.oscs[0].connectedTo).toEqual([voice.filter]);
  });

  test('a noise source added live is wired into the filter too', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.3 }, 'synth');

    expect(voice.noiseGain.connectedTo).toEqual([voice.filter]);
  });

  test('gains[0] and gains[1] stay the main and sub gains when noise is present', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');

    // Positional: releaseVoice ramps gains[0] and updateSynthParams writes
    // subOscVolume into gains[1]. Creating the noise gain must not shift them.
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.gains[0]).toBe(ctx._gains[0]);
    expect(voice.gains[1]).toBe(ctx._gains[1]);
    expect(voice.gains[1].gain.value).toBe(SYNTH.subOscVolume);
    expect(voice.noiseGain).not.toBe(voice.gains[0]);
    expect(voice.noiseGain).not.toBe(voice.gains[1]);
  });

  test('turning the noise knob up reaches a sounding voice that started silent', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.noise).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.3 }, 'synth');

    expect(voice.noise).toBeDefined();
    expect(voice.noise.loop).toBe(true);
    expect(voice.noiseGain.gain.targets.at(-1)?.v).toBe(0.3);
  });

  test('turning the noise knob down to zero silences it on a sounding voice', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...NOISY, noiseVolume: 0 }, 'synth');

    expect(voice.noiseGain.gain.targets.at(-1)?.v).toBe(0);
  });

  test('releasing a noisy voice stops and disconnects its noise source', async () => {
    const { engine, ctx } = freshEngine();
    // Tiny filterRelease as well as a tiny release: the teardown timeout waits
    // max(releaseTime, filterRelease) + 0.1 s, and SYNTH's 0.5 s filter release
    // would outlast the test.
    engine.triggerSynthNoteOn('C4', { ...NOISY, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const stopped = spyOn(voice.noise, 'stop');
    const disconnected = spyOn(voice.noise, 'disconnect');

    engine.triggerSynthNoteOff('C4', 0.01, undefined, 'synth');
    await new Promise((r) => setTimeout(r, 200));

    // A looping buffer source that is never stopped keeps running forever.
    expect(stopped).toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalled();
  });
});

describe('release discontinuity', () => {
  // A 16th at 120 bpm rings for 0.125 s, well inside SYNTH's 0.4 s decay — so
  // when the release starts, the envelope has NOT reached its sustain level
  // yet. Every chord and bass pattern hit is scheduled this way, which makes
  // this the app's most common note-off by far.
  const HELD = 0.125;

  /**
   * How far the curve jumps across `t`, as a ratio >= 1. Exactly 1 means the
   * automation is continuous there; anything above it is a step the DAC has to
   * render in a single sample.
   */
  function stepRatio(param: { valueAt(t: number): number }, t: number): number {
    const before = param.valueAt(t - 1e-6);
    const after = param.valueAt(t + 1e-6);
    return Math.max(after / before, before / after);
  }

  test('a pre-scheduled amp release starts from the level the envelope actually has', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const releaseAt = t0 + HELD;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, releaseAt, 'chord');

    // A step here is a click: the amp jumps in a single sample.
    expect(stepRatio(ctx._gains[0].gain, releaseAt)).toBeLessThan(1.02);
  });

  test('a pre-scheduled filter release starts from the cutoff the envelope actually has', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const releaseAt = t0 + HELD;

    // filterEnvAmount 1200 over a 0.4 s filter decay: the cutoff is still
    // falling from its 3600 Hz peak when the release begins.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, releaseAt, 'chord');

    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    expect(stepRatio(voice.filter.frequency, releaseAt)).toBeLessThan(1.02);
  });

  // Regression: a full-bar Sustained chord. Its note-off sits SECONDS past the
  // end of the decay, so cancelAndHoldAtTime has nothing to cancel and leaves
  // no anchor — the release ramp then starts back at the decay's end and fades
  // the chord out across its whole length instead of holding it.
  test('a release scheduled past the decay holds the sustain level until it starts', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const HELD_CHORD: SynthParams = { ...SYNTH, attack: 0.005, decay: 0.01, sustain: 1, release: 0.01 };
    const peak = 0.8 * 0.4;

    engine.triggerSynthNoteOn('C4', HELD_CHORD, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', HELD_CHORD.release, t0 + 2.7, 'chord');

    const vca = ctx._gains[0].gain;
    expect(vca.valueAt(t0 + 0.5)).toBeCloseTo(peak, 4);
    expect(vca.valueAt(t0 + 2.6)).toBeCloseTo(peak, 4);
    expect(vca.valueAt(t0 + 2.72)).toBeLessThan(0.001);
  });

  test('an immediate release is continuous too', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Note-off with no time: the release starts at currentTime, mid-attack.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(stepRatio(ctx._gains[0].gain, t0)).toBeLessThan(1.02);
  });
});

describe('release without cancelAndHoldAtTime (Firefox)', () => {
  // Firefox implements no cancelAndHoldAtTime, so the engine falls back to
  // naming a start value. These pin the fallback estimates, which are the
  // pre-fix behaviour: the fix must not make this path worse than it was.
  test('a release scheduled ahead falls back to the stored sustain level', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;
    const releaseAt = t0 + 0.125;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, releaseAt, 'chord');

    // gain.value reports the value at currentTime — still the 0.0001 envelope
    // floor — so reading it here would cut the note dead instead of fading it.
    const vca = ctx._gains[0].gain;
    expect(vca.valueAt(releaseAt)).toBeCloseTo(0.8 * 0.4 * SYNTH.sustain, 5);
  });

  test('a release inside the envelope falls back to the live value', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    // Released 0.1 s in, while the 0.42 s attack+decay is still running: the
    // exact value is unknowable without cancelAndHoldAtTime, so `.value` is
    // the best estimate available.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 0.1, 'chord', 1, 'live');
    const vca = ctx._gains[0].gain;
    vca.value = 0.05;

    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(vca.valueAt(t0)).toBeCloseTo(0.05, 5);
  });

  test('a release past the decay anchors at the exact sustain level, browser or not', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    // Past attack+decay the value IS the sustain level, so no estimate is
    // needed and Firefox gets the same exact anchor as everyone else.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord', 1, 'live');
    const vca = ctx._gains[0].gain;
    vca.value = 0.05;

    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(vca.valueAt(t0)).toBeCloseTo(0.8 * 0.4 * SYNTH.sustain, 5);
  });

  test('the filter release falls back to the live cutoff', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    voice.filter.frequency.value = 3000;

    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.125, 'chord');

    expect(voice.filter.frequency.valueAt(t0 + 0.125)).toBeCloseTo(3000, 5);
  });
});

describe('live Sustain', () => {
  // A held pad is the case where this matters: the note rings for bars, so
  // "next note" is seconds away and the knob reads as dead.
  const PAD: SynthParams = { ...SYNTH, attack: 0.01, decay: 0.05, sustain: 0.5, release: 1.2 };
  const peak = 0.8 * 0.4;

  test('turning Sustain up lifts a note that is already ringing', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 1 }, 'chord');

    expect(vca.targets.at(-1)?.v).toBeCloseTo(peak, 5);
  });

  test('turning Sustain down lowers it, and the stored level follows', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 0.25 }, 'chord');

    expect(vca.targets.at(-1)?.v).toBeCloseTo(peak * 0.25, 5);
    // releaseVoice reads sustainLevel for its fallback, and
    // applySynthVelocityScale rebalances against it.
    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    expect(voice.sustainLevel).toBeCloseTo(peak * 0.25, 5);
  });

  test('a param change that leaves Sustain alone never touches the amp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, filterCutoff: 800 }, 'chord');

    // Gliding the amp on every cutoff tweak would cut short the attack of a
    // percussive stab.
    expect(vca.targets).toEqual([]);
  });

  test('an equal-power velocity rebalance survives a later param change', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    // A held key, so applySynthVelocityScale's equal-power rebalance applies
    // (it skips voices with a planned release).
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'synth', 1, 'live');
    engine.applySynthVelocityScale(0.5, 'synth');

    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const rebalanced = voice.sustainLevel;
    engine.updateSynthParams(PAD, 'synth');

    // Recomputing sustain from an unscaled peak would undo the rebalance and
    // make every held note jump back to full level on any knob move.
    expect(voice.sustainLevel).toBeCloseTo(rebalanced, 6);
  });

  test('a voice already fading keeps its release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0 - 2, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 - 1, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 1 }, 'chord');

    expect(vca.targets).toEqual([]);
  });
});

describe('envelope-safe rebalancing', () => {
  test('a velocity rebalance during the attack holds the real curve value, not the floor', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Attack is 0.02 s; rebalance 0.01 s in, halfway up the ramp.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'live');
    ctx.currentTime = t0 + 0.01;
    engine.applySynthVelocityScale(0.5, 'synth');

    const gain = (engine as any).synthVoices.activeVoices.get('synth:C4').gains[0].gain;
    const anchor = gain.events.find((e: any) => e.t === t0 + 0.01);
    expect(anchor).toBeTruthy();
    // cancelScheduledValues would revert to the 0.0001 note-on floor and the
    // rebalance would then glide up from silence: an audible click.
    expect(anchor.v).toBeGreaterThan(0.0001);
  });

  test('the rebalance shares the exact voice-selection helper updateSynthParams uses', () => {
    // Both call sites must agree on "is this voice live and re-shapeable?" —
    // updateSynthParams already iterates sourceVoices (not activeVoices) with a
    // comment explaining that a same-note retrigger evicts a still-sounding
    // voice from activeVoices; applySynthVelocityScale drifting to its own
    // selection logic (even one that happens to behave identically today,
    // since it also skips any voice with a scheduled release) is exactly how
    // the two silently diverge again the next time either one changes.
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');

    expect(typeof (engine as any).synthVoices.reshapeableVoices).toBe('function');
    const spy = spyOn((engine as any).synthVoices, 'reshapeableVoices');
    engine.applySynthVelocityScale(0.5, 'synth');
    expect(spy).toHaveBeenCalled();
  });
});

describe('cancelAndHold fallback (Firefox)', () => {
  test('the fallback reads the value BEFORE the cancel reverts it', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const param = fakeParam({ cancelAndHold: false });
    param.setValueAtTime(0.9, ctx.currentTime - 1);
    param.value = 0.9;

    // The shared fake's cancelScheduledValues only trims `events`; it does not
    // model the spec's live reversion of `.value` (no fake AudioParam getter
    // recomputes it from the automation curve). Wrapping it here — inside the
    // test, not the shared harness — reproduces that one effect so the test
    // actually depends on cancelAndHold's read-before-cancel ordering rather
    // than passing regardless of it.
    const cancelScheduledValues = param.cancelScheduledValues.bind(param);
    param.cancelScheduledValues = (t: number) => {
      cancelScheduledValues(t);
      param.value = 0.0001;
    };

    (engine as any).masterRack.cancelAndHold(param, ctx.currentTime);

    // Reading param.value AFTER cancelling would anchor the hold at the
    // reverted 0.0001 instead of the real pre-cancel value.
    expect(param.events.at(-1)!.v).toBe(0.9);
  });
});

describe('envelope end markers', () => {
  test('a sub-millisecond attack marks the end of the CLAMPED ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    // synthPresets ships attack: 0.002, below the 0.005 floor the ramp uses.
    const fast = { ...SYNTH, attack: 0.002, decay: 0.4, filterAttack: 0.002, filterDecay: 0.4 };

    engine.triggerSynthNoteOn('C4', fast, 0.8, t0, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    // The ramp ends at t0 + max(0.005, 0.002) + 0.4; a marker computed from the
    // raw 0.002 lands 3 ms early and sends releaseVoice down the wrong branch.
    expect(voice.ampEnvEndsAt).toBeCloseTo(t0 + 0.005 + 0.4, 9);
    expect(voice.filterEnvEndsAt).toBeCloseTo(t0 + 0.01 + 0.4, 9);
  });
});

describe('noise source initial level', () => {
  test('adding noise to a live voice starts from an explicit floor, not a denormal', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0 }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.noiseGain).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.4 }, 'synth');

    expect(voice.noiseGain).toBeTruthy();
    // Number.MIN_VALUE (5e-324) is a denormal used only to slip past the
    // `level <= 0` guard; the initial level is now a named parameter.
    expect(voice.noiseGain.gain.value).toBe(0.0001);
    expect(voice.noiseGain.gain.targets.at(-1)!.v).toBe(0.4);
  });
});

describe('LFO routing', () => {
  const TREM: SynthParams = { ...SYNTH, lfoDepth: 0.4, lfoRate: 5, lfoTarget: 'volume' };

  test('a volume LFO modulates a SERIES gain, never the VCA param itself', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    // Connecting the LFO to gainNode.gain SUMS with the envelope: the release
    // ramp never reaches silence and the sum inverts phase on the downswing.
    expect(voice.lfoGain.connectedTo).not.toContain(voice.gains[0].gain);
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });

  test('the tremolo gain sits between the VCA and the source tap', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const tap = (engine as any).masterRack.sourceTaps.get('synth');

    expect(voice.gains[0].connectedTo).toEqual([voice.tremoloGain]);
    expect(voice.tremoloGain.connectedTo).toContain(tap);
    // Unity so the envelope passes through untouched when depth is 0.
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('a voice with no LFO still routes through the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    // Always present, so switching a live voice onto tremolo is a reconnect of
    // the LFO alone and never a rewire of the voice's own output.
    expect(voice.tremoloGain).toBeTruthy();
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('cutoff and pitch targets are unchanged', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const cut = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(cut.lfoGain.connectedTo).toContain(cut.filter.frequency);
    expect(cut.lfoGain.gain.value).toBeCloseTo(0.5 * 1500, 9);

    engine.triggerSynthNoteOn('E4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth', 1, 'live');
    const pit = (engine as any).synthVoices.activeVoices.get('synth:E4');
    expect(pit.lfoGain.connectedTo).toContain(pit.oscs[0].detune);
    expect(pit.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);
  });

  test('switching a live voice from cutoff to volume moves the LFO to the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 1500, 9);

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfoTarget).toBe('volume');
    expect(voice.lfoGain.connectedTo).toEqual([voice.tremoloGain.gain]);
    // Pinned at the moment of the switch, not after a settle: a
    // setTargetAtTime glide here would modulate tremoloGain.gain by the
    // STALE cutoff scale (750) for ~5 time constants — a gain blast and
    // exactly the phase inversion this task exists to remove.
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 0.2, 9);
  });

  test('switching a live voice from pitch to volume also lands at the tremolo scale instantly', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfoTarget).toBe('volume');
    expect(voice.lfoGain.connectedTo).toEqual([voice.tremoloGain.gain]);
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 0.2, 9);
  });

  test('a depth change with the target UNCHANGED still glides, not jumps', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.2, lfoTarget: 'cutoff' }, 'synth');

    // Same target: an instant jump here would click, so this path must keep
    // using setTargetAtTime rather than connectLfoTo's instant setValueAtTime.
    expect(voice.lfoGain.gain.targets.at(-1)!.v).toBeCloseTo(0.2 * 1500, 9);
  });

  test('depth above 1 still clamps the tremolo scale so the trough stays positive', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 3, lfoTarget: 'volume' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    // Math.min(1, params.lfoDepth) clamps the MULTIPLIER to 1 before scaling
    // by 0.2, so a depth of 3 (or any out-of-range value > 1) still yields
    // exactly 0.2 — never more. That keeps the tremolo gain's trough at
    // 1 - 0.2 = 0.8, always positive, however large the depth gets.
    expect(voice.lfoGain.gain.value).toBe(0.2);
  });

  test('an LFO added to a live voice that started without one is wired, not dropped', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live'); // lfoDepth 0
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(voice.lfo).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.3, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfo).toBeTruthy();
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });
});

describe('LFO teardown at depth zero', () => {
  test('dropping depth to zero stops and disconnects the oscillator', async () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const lfo = voice.lfo;
    const lfoGain = voice.lfoGain;
    expect(lfo).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0 }, 'synth');

    // setTargetAtTime is asymptotic and never reaches exactly 0, so the node
    // must actually be removed once the ramp is inaudible (~5 time constants).
    expect(lfoGain.gain.targets.at(-1)!.v).toBe(0);
    await new Promise((r) => setTimeout(r, 220));
    expect(voice.lfo).toBeUndefined();
    expect(voice.lfoGain).toBeUndefined();
    expect(lfoGain.connectedTo).toHaveLength(0);
  });

  test('depth back up before the teardown lands keeps the same oscillator', async () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const lfo = voice.lfo;

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0 }, 'synth');
    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 'synth');
    await new Promise((r) => setTimeout(r, 220));

    expect(voice.lfo).toBe(lfo);
  });
});

describe('reshapeableVoices reuses one scratch array', () => {
  const visits = (v: any) => v.filter.Q.cancels.length;

  test('each call visits its own source exactly once, and no other', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    const t0 = ctx.currentTime;

    e.synthVoices.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    e.synthVoices.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');

    const a = e.synthVoices.activeVoices.get('chord:C4');
    const b = e.synthVoices.activeVoices.get('chord:E4');
    const bass = e.synthVoices.activeVoices.get('bass:C2');
    const base = [visits(a), visits(b), visits(bass)];

    // Each call ticks the clock forward, as real knob-drag calls would: a
    // second cancelAndHold at the SAME timestamp hits the fake's "refuses a
    // timeline with setTargetAtTime" guard and takes its throwing branch,
    // which would double-count a visit and mask what this test checks.
    ctx.currentTime += 0.01;
    engine.updateSynthParams(SYNTH, 'chord');
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 1, base[1] + 1, base[2]]);

    // A call over a DIFFERENT source must not re-visit the first source's
    // voices — exactly what an uncleared scratch array would do.
    ctx.currentTime += 0.01;
    engine.updateSynthParams(SYNTH, 'bass');
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 1, base[1] + 1, base[2] + 1]);

    // And the all-sources call visits each voice exactly once more.
    ctx.currentTime += 0.01;
    engine.updateSynthParams(SYNTH);
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 2, base[1] + 2, base[2] + 2]);
  });

  test('two successive calls over the same voice set schedule identical automation', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    e.synthVoices.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord', 1, 'live');
    const voice = e.synthVoices.activeVoices.get('chord:C4');

    engine.updateSynthParams(SYNTH, 'chord');
    engine.updateSynthParams(SYNTH, 'chord');

    const targets = voice.filter.frequency.targets;
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets.at(-1)).toEqual(targets.at(-2));
  });
});

describe('dropVoicesScheduledFrom', () => {
  const LONG = { ...SYNTH, release: 2.0 };

  test('drops only what has not started by the boundary', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const T = t0 + 0.075;

    engine.triggerSynthNoteOn('C4', LONG, 0.8, t0 - 0.05, 'chord', 1, 'live'); // sounding
    engine.triggerSynthNoteOn('E4', LONG, 0.8, t0 + 0.03, 'chord', 1, 'live'); // before T
    engine.triggerSynthNoteOn('G4', LONG, 0.8, t0 + 0.09, 'chord', 1, 'live'); // past T
    // Exactly ON the boundary belongs to the OUTGOING loop's schedule; the
    // incoming loop's own note at T is emitted by the new scheduler.
    engine.triggerSynthNoteOn('A4', LONG, 0.8, T, 'chord', 1, 'live');

    engine.dropVoicesScheduledFrom('chord', T);

    const left = [...((engine as any).synthVoices.sourceVoices.get('chord') as Set<any>)]
      .map((v) => v.noteName)
      .sort();
    expect(left).toEqual(['C4', 'E4']);
  });

  test('a surviving voice keeps its own envelope — no forced release', () => {
    // This is the whole point against stopSource: the outgoing loop's tail must
    // ring across the seam with the release its preset asks for, not the 20 ms
    // HARD_STOP_RELEASE a user Stop uses.
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', LONG, 0.8, t0, 'chord', 1, 'live');
    const voice = [...((engine as any).synthVoices.sourceVoices.get('chord') as Set<any>)][0];
    const rampsBefore = voice.gains[0].gain.ramps.length;

    engine.dropVoicesScheduledFrom('chord', t0 + 0.075);

    expect(voice.releaseScheduledAt).toBeUndefined();
    expect(voice.gains[0].gain.ramps.length).toBe(rampsBefore);
  });

  test('an unknown source and a missing context are no-ops', () => {
    const { engine, ctx } = freshEngine();
    expect(() => engine.dropVoicesScheduledFrom('nope', ctx.currentTime)).not.toThrow();
    const bare = makeEngine();
    expect(() => bare.dropVoicesScheduledFrom('chord', 0)).not.toThrow();
  });
});

// DEV-387 must-fix 2: nothing else in the suite asserts the measured trim
// actually reaches a rendered peak — moving it inside `clampVelocity(...)`
// left the shipped suite green at 253/253. These mock the table (still empty
// in src/data/trimTable.ts at Task 7) so the assertion holds today AND once
// Task 11 fills it, rather than depending on any specific committed number.
describe('calibration trim reaches the rendered peak (DEV-387)', () => {
  afterEach(() => {
    // mock.restore() does not undo mock.module() (Bun's own documented
    // caveat) — reapply the shipped, still-empty shape defensively. Bun
    // 1.3.14 scopes mock.module() to this file, verified empirically, but
    // that scoping is not a documented guarantee, so this reset stays in
    // case a later Bun version widens it back to the whole module registry.
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS: {}, PRESET_TRIMS: {} }));
  });

  test('a +6 dB kit trim scales EVERY voice in the kit, by exactly that many dB', () => {
    // DEV-387: DRUM_TRIMS is keyed by kit name, one entry per kit — see the
    // comment on it in src/data/trimTable.ts. A kit's voices are not
    // independent, so the trim is not "only its named voice" anymore; it is
    // the whole kit, uniformly, which is what this test now proves.
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {
        'Retro Drive': { measuredDbfs: -24, trimDb: 6, configHash: 'x' },
      },
      PRESET_TRIMS: {},
    }));

    const { engine: trimmed, ctx: trimmedCtx } = freshEngine();
    trimmed.setDrumKit(undefined, 'Retro Drive');
    const { engine: plain, ctx: plainCtx } = freshEngine();
    plain.setDrumKit(undefined, 'No Such Kit');

    const kickBefore = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('kick', 1.0);
    plain.triggerDrum('kick', 1.0);
    const trimmedKickPeak = trimmedCtx._gains[kickBefore.trimmed].gain.events[0].v;
    const plainKickPeak = plainCtx._gains[kickBefore.plain].gain.events[0].v;
    // This is the case the brief calls load-bearing: clampVelocity(1) is 1,
    // so a boost that lands INSIDE the clamp is discarded and this ratio
    // would silently read 1 instead of dbToGain(6).
    expect(trimmedKickPeak / plainKickPeak).toBeCloseTo(dbToGain(toDecibels(6)), 6);
    expect(trimmedKickPeak).toBeGreaterThan(plainKickPeak);

    // A DIFFERENT voice in the SAME kit gets the identical scale factor — the
    // kit's own internal kick/snare balance is preserved, not closed.
    const snareBefore = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('snare', 1.0);
    plain.triggerDrum('snare', 1.0);
    const trimmedSnarePeak = trimmedCtx._gains[snareBefore.trimmed].gain.events[0].v;
    const plainSnarePeak = plainCtx._gains[snareBefore.plain].gain.events[0].v;
    expect(trimmedSnarePeak / plainSnarePeak).toBeCloseTo(dbToGain(toDecibels(6)), 6);
  });

  test('a -6 dB trim attenuates by the same law regardless of which voice fires, and a kit with no entry stays neutral', () => {
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {
        'Retro Drive': { measuredDbfs: -12, trimDb: -6, configHash: 'x' },
      },
      PRESET_TRIMS: {},
    }));

    const { engine: trimmed, ctx: trimmedCtx } = freshEngine();
    trimmed.setDrumKit(undefined, 'Retro Drive');
    const { engine: plain, ctx: plainCtx } = freshEngine();
    // No kit name at all — the untrimmed default, same as freshEngine() ships.
    plain.setDrumKit();

    const before = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('snare', 1.0);
    plain.triggerDrum('snare', 1.0);
    const trimmedPeak = trimmedCtx._gains[before.trimmed].gain.events[0].v;
    const plainPeak = plainCtx._gains[before.plain].gain.events[0].v;
    expect(trimmedPeak / plainPeak).toBeCloseTo(dbToGain(toDecibels(-6)), 6);
    expect(trimmedPeak).toBeLessThan(plainPeak);
  });

  test('a voice\'s peak gain carries its own preset\'s calibration trim, derived from params.preset', () => {
    // The trim is no longer pushed ahead of the note: triggerSynthNoteOn reads
    // `params.preset` and looks the trim up itself, so a source can never be
    // playing one patch at another patch's level. Two triggers on the SAME
    // source, differing only in `preset`, must therefore differ in peak by
    // exactly the table's ratio — which the old per-source map could not
    // express at all, since the second trigger would have inherited the first
    // patch's entry until something remembered to overwrite it.
    const { engine, ctx } = freshEngine();
    const base = trimTestParams('Cosmic Lead');
    const trimmed = synthTrimGainFor('Cosmic Lead');
    expect(trimmed).not.toBe(NEUTRAL_TRIM_GAIN);

    const aBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('C4', base, 0.5, undefined, 'synth', 1, 'live');
    const aPeak = ctx._gains[aBefore].gain.ramps[0].v;

    // A name no factory preset has: neutral, on the same source, immediately
    // after a trimmed note on it.
    const bBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('E4', trimTestParams('A Name No Factory Preset Has'), 0.5, undefined, 'synth', 1, 'live');
    const bPeak = ctx._gains[bBefore].gain.ramps[0].v;

    expect(aPeak / bPeak).toBeCloseTo(trimmed, 6);
  });

  test('setPresetTrim overrides the derived trim for one source (calibration harness only)', () => {
    // 'Test' is not a factory preset name, so the derived trim is neutral on
    // both sources and the whole ratio below is the override's doing.
    const { engine, ctx } = freshEngine();
    const params = trimTestParams('Test');

    engine.setPresetTrim('synth', 2);
    const synthBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('C4', params, 0.5, undefined, 'synth', 1, 'live');
    const synthPeak = ctx._gains[synthBefore].gain.ramps[0].v;

    // 'bass' was never told about a trim, so it stays neutral even though the
    // engine now carries a non-neutral entry for 'synth' in the same map.
    const bassBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('C4', params, 0.5, undefined, 'bass', 1, 'live');
    const bassPeak = ctx._gains[bassBefore].gain.ramps[0].v;

    expect(synthPeak / bassPeak).toBeCloseTo(2, 6);
  });
});
