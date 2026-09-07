import { describe, expect, test } from 'bun:test';
import { mergeDrumKit } from './drumKits';
import { DEFAULT_DRUM_KIT, DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';

describe('mergeDrumKit', () => {
  test('no argument returns the defaults', () => {
    expect(mergeDrumKit()).toEqual(DEFAULT_DRUM_KIT);
  });

  test('a partial override keeps the sibling params of the same drum', () => {
    // The merge is one level deep PER DRUM TYPE and every DrumKit value is a
    // flat number, so there is no third level to lose.
    const merged = mergeDrumKit({ kick: { ...DEFAULT_DRUM_KIT.kick, gain: 0.1 } });
    expect(merged.kick.gain).toBe(0.1);
    expect(merged.kick.freqStart).toBe(DEFAULT_DRUM_KIT.kick.freqStart);
    expect(merged.snare).toEqual(DEFAULT_DRUM_KIT.snare);
  });

  test('never mutates DEFAULT_DRUM_KIT', () => {
    const before = JSON.stringify(DEFAULT_DRUM_KIT);
    const merged = mergeDrumKit(DRUM_KITS['Trap Beat']);
    merged.kick.gain = 99;
    expect(JSON.stringify(DEFAULT_DRUM_KIT)).toBe(before);
  });

  test('every kit merges to a complete DrumKit', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const kit = mergeDrumKit(partial);
      for (const type of DRUM_TYPES) {
        expect(kit[type], `${name}/${type}`).toBeTruthy();
      }
      expect(Number.isFinite(kit.snare.reverbSend)).toBe(true);
      expect(Number.isFinite(kit.clap.reverbSend)).toBe(true);
      expect(Number.isFinite(kit.crash.reverbSend)).toBe(true);
    }
  });
});

/**
 * Slice 1, spec decisions 13 and 14. These are rules over MERGED entries,
 * not over the literals: mergeDrumKit spreads DEFAULT_DRUM_KIT under each
 * partial, so a kit that omits `kick.pitchTime` still has to satisfy them.
 */
describe('kick tuning rules', () => {
  const merged: [string, ReturnType<typeof mergeDrumKit>][] = [
    ['DEFAULT_DRUM_KIT', mergeDrumKit()],
    ...Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as [string, ReturnType<typeof mergeDrumKit>],
    ),
  ];

  test('the pitch sweep is over before a tenth of the note has passed', () => {
    // The TR-808's sweep is over in ~6 ms; the operational rule puts anything
    // above pitchTime / decay > 0.3 in the "smeared, usually a mistake" band.
    for (const [name, kit] of merged) {
      expect(kit.kick.pitchTime, `${name}.kick.pitchTime`).toBeLessThanOrEqual(0.1 * kit.kick.decay + 1e-12);
    }
  });

  test('a kick that rings longer than half a second ends on a note', () => {
    // A 600 ms tail has a pitch whether or not we chose one; choosing one is
    // how it stops fighting the bass.
    const NOTE_HZ = [36.71, 41.2, 43.65, 46.25, 49.0, 55.0, 65.41];
    for (const [name, kit] of merged) {
      if (kit.kick.decay < 0.5) continue;
      expect(NOTE_HZ, `${name}.kick.freqEnd`).toContain(kit.kick.freqEnd);
    }
  });

  test('the default kit has no click, so a kit can omit one', () => {
    // mergeDrumKit is a one-level spread: a kit cannot DELETE a key the
    // default defines. If the default clicks, the 808 kits cannot not-click.
    expect(DEFAULT_DRUM_KIT.kick.clickFreq).toBeUndefined();
    expect(DEFAULT_DRUM_KIT.kick.clickLevel).toBeUndefined();
    expect(DEFAULT_DRUM_KIT.kick.clickDecay).toBeUndefined();
  });

  test('exactly the three referent-clickless kits have no click', () => {
    // 808 and trap-808 kits omit it because the machine has no separate click
    // path; Warm Riddim because a felt-muffled reggae kick has no beater snap.
    const clickless = Object.entries(DRUM_KITS)
      .filter(([, p]) => p.kick?.clickFreq === undefined)
      .map(([n]) => n)
      .sort();
    expect(clickless).toEqual(['808 Vintage', 'Trap Beat', 'Warm Riddim']);
  });

  test('every kit that has a click has all three of its parameters', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      if (partial.kick?.clickFreq === undefined) continue;
      expect(partial.kick.clickLevel, `${name}.kick.clickLevel`).toBeGreaterThan(0);
      expect(partial.kick.clickDecay, `${name}.kick.clickDecay`).toBeGreaterThan(0);
    }
  });
});

describe('snare tuning rules', () => {
  const merged: [string, ReturnType<typeof mergeDrumKit>][] = [
    ['DEFAULT_DRUM_KIT', mergeDrumKit()],
    ...Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as [string, ReturnType<typeof mergeDrumKit>],
    ),
  ];

  test('the body pitch settles inside 30 ms', () => {
    // bodyTime was a copy-pasted 0.08 in all thirteen entries and nothing
    // checked it.
    for (const [name, kit] of merged) {
      expect(kit.snare.bodyTime, `${name}.snare.bodyTime`).toBeGreaterThanOrEqual(0.01);
      expect(kit.snare.bodyTime, `${name}.snare.bodyTime`).toBeLessThanOrEqual(0.03);
    }
  });

  test('the body barely bends', () => {
    // A snare's tonal component is the head's (0,1) mode - fixed partials.
    // DEFAULT swept 220 -> 90 over 80 ms, which is a tom.
    for (const [name, kit] of merged) {
      expect(kit.snare.bodyFreqEnd, `${name}.snare.bodyFreqEnd`).toBeGreaterThanOrEqual(
        0.85 * kit.snare.bodyFreqStart,
      );
    }
  });

  test('noise:body is the genre axis and spans 0.7 to 2.8', () => {
    // Trap ~2.8, gated 80s ~1.4, acoustic and 808 ~0.9, lo-fi ~0.7. Genre
    // lives in the gain ratio, not in the frequency. Measured span before
    // this task: 0.87 - 2.00.
    //
    // Slice 4 task 3 moved Warm Riddim's snare off its 900 Hz cross-stick and
    // onto an ordinary body/noise balance, which handed this axis' LOW edge
    // to a different kit: Warm Riddim was the 0.700 floor before this task
    // (noiseGain 0.42 / bodyGain 0.6); it is now 1.000 (0.5/0.5), and Lo-Fi
    // Vinyl (0.3/0.42 = 0.714) is the new floor. The span narrowed 4.05 ->
    // 3.97 accordingly, still clear of the 3.5 floor below. A future retune
    // of Lo-Fi Vinyl's snare gains is now the one standing on this edge.
    const ratios = merged.map(([name, kit]) => [name, kit.snare.noiseGain / kit.snare.bodyGain] as const);
    for (const [name, r] of ratios) {
      expect(r, `${name} noise:body`).toBeGreaterThanOrEqual(0.7);
      expect(r, `${name} noise:body`).toBeLessThanOrEqual(2.84);
    }
    const values = ratios.map(([, r]) => r);
    expect(Math.max(...values) / Math.min(...values)).toBeGreaterThanOrEqual(3.5);
  });

  test('every kit\'s second snare partial and rimshot are actually audible', () => {
    // Strictly greater than zero, and that is not decoration: check:drums'
    // spread('snare.bodyGain2', ...) asserts max >= factor * min, so one kit
    // at exactly 0 makes the requirement 0 and the check passes vacuously for
    // any factor — and a silent second partial passes every count-only test
    // too, because drumEnv's Math.max(ENV_FLOOR, peak) still schedules a node
    // that ramps to ENV_FLOOR and looks like a normal voice.
    for (const [name, kit] of merged) {
      expect(kit.snare.bodyGain2, `${name}.snare.bodyGain2`).toBeGreaterThan(0);
      expect(kit.rimshot.bodyGain2, `${name}.rimshot.bodyGain2`).toBeGreaterThan(0);
    }
  });
});

describe('hat tuning rules', () => {
  const kits = Object.entries(DRUM_KITS).map(
    ([name, partial]) => [name, mergeDrumKit(partial)] as const,
  );

  test('the closed-hat decay range is wide enough to carry character', () => {
    // All 13 closed hats lived in 0.030-0.060 s. The 808's own closed hat is
    // 0.050 s and loose acoustic hats ring much longer; the widened range is
    // 0.020-0.110 s and is the single largest free win on the busiest row.
    const decays = kits.map(([, k]) => k.hihat.decay);
    for (const [name, k] of kits) {
      expect(k.hihat.decay, `${name}.hihat.decay`).toBeGreaterThanOrEqual(0.02);
      expect(k.hihat.decay, `${name}.hihat.decay`).toBeLessThanOrEqual(0.11);
    }
    expect(Math.max(...decays) / Math.min(...decays)).toBeGreaterThanOrEqual(3.0);
  });

  test('every open hat rings longer than its own closed hat', () => {
    // The closure IS the damping: an open hat that decays faster than the
    // closed hat of the same kit is a data error, not a character.
    for (const [name, k] of kits) {
      expect(k.openhat.decay, `${name}.openhat.decay`).toBeGreaterThan(k.hihat.decay);
    }
  });

  test('every open hat sits below its own closed hat in cutoff', () => {
    // Defensible and deliberate: the open hat keeps more body.
    for (const [name, k] of kits) {
      expect(k.openhat.filter, `${name}.openhat.filter`).toBeLessThanOrEqual(k.hihat.filter);
    }
  });

  test('no archetype group shares a hat any more — metal was the last axis', () => {
    // Task 4 put the 12 kits onto five hat archetypes sharing a filter/decay/
    // gain block (one highpass over white noise only buys ~2.5 distinguishable
    // characters). Task 5's topCut column (decision 26) split three of those
    // four shared groups — 808 Vintage/Warm Riddim, Acoustic Studio/Retro
    // Drive and Lo-Fi Vinyl/Tight Pocket each shared filter/decay/gain but
    // were authored distinct topCut values. Only Velocity Breaks and
    // Warehouse were also authored the same topCut, so that pair was the one
    // surviving group — until slice 4 task 2's `metal` (0.30 vs 0.80 here)
    // gave them a second axis neither topCut nor filter/decay/gain touches,
    // splitting the last pair. Nothing else pins WHICH kit is in WHICH
    // group, so a future retune could silently re-merge one with no signal.
    // Pinned the same way the clickless-kit trio is pinned above: an exact
    // list, derived from the merged table, not from the plan.
    const bySignature = new Map<string, string[]>();
    for (const [name, k] of kits) {
      const signature = JSON.stringify([k.hihat, k.openhat]);
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), name]);
    }
    const sharedGroups = [...bySignature.values()]
      .filter((names) => names.length > 1)
      .map((names) => [...names].sort())
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(sharedGroups).toEqual([]);
  });
});

describe('tom and crash tuning rules', () => {
  const merged: [string, ReturnType<typeof mergeDrumKit>][] = [
    ['DEFAULT_DRUM_KIT', mergeDrumKit()],
    ...Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as [string, ReturnType<typeof mergeDrumKit>],
    ),
  ];

  test('every low tom sweeps 4 to 6 semitones, not an octave', () => {
    // The depth of the sweep is the main reason a tom reads as a small kick.
    // Measured before this task: 1.64 to 2.15. Decision 32 renamed `tom` to
    // `lowtom` unchanged, so this rule now names that voice.
    for (const [name, kit] of merged) {
      expect(kit.lowtom.freqStart / kit.lowtom.freqEnd, `${name} lowtom sweep`).toBeCloseTo(1.35, 1);
      expect(kit.lowtom.freqStart / kit.lowtom.freqEnd, `${name} lowtom sweep`).toBeLessThanOrEqual(1.37);
      expect(kit.lowtom.freqStart / kit.lowtom.freqEnd, `${name} lowtom sweep`).toBeGreaterThanOrEqual(1.33);
    }
  });

  test('every hi tom keeps the same shallow sweep as its low tom', () => {
    // Decision 32: hitom takes the "same shallow 1.35 freqStart/freqEnd" as
    // lowtom, by construction — this pins that derivation rather than letting
    // it drift once a kit is retuned. Same bounds as the low tom's sweep test
    // above: two voices treated identically in the engine get tested
    // identically, not a looser `toBeCloseTo` for one of them.
    for (const [name, kit] of merged) {
      expect(kit.hitom.freqStart / kit.hitom.freqEnd, `${name} hitom sweep`).toBeCloseTo(1.35, 1);
      expect(kit.hitom.freqStart / kit.hitom.freqEnd, `${name} hitom sweep`).toBeLessThanOrEqual(1.37);
      expect(kit.hitom.freqStart / kit.hitom.freqEnd, `${name} hitom sweep`).toBeGreaterThanOrEqual(1.33);
    }
  });

  test('every low tom settles its pitch inside the 0.08-0.14 s band', () => {
    for (const [name, kit] of merged) {
      expect(kit.lowtom.pitchTime, `${name}.lowtom.pitchTime`).toBeGreaterThanOrEqual(0.08);
      expect(kit.lowtom.pitchTime, `${name}.lowtom.pitchTime`).toBeLessThanOrEqual(0.14);
    }
  });

  test('hitom.pitchTime stays about 0.7x its own lowtom.pitchTime', () => {
    // Task 4's derived ratio, pinned here rather than left to drift: measured
    // 0.667-0.750 across all thirteen kits. Unpinned, this is not
    // theoretical - setting a kit's hitom.pitchTime to 0.10x its lowtom's
    // leaves check:drums at exit 0 and `bun test` at 0 fail, because
    // check-drum-kit-separation.ts's withinKit() only asks whether two
    // voices are far APART, and this ratio is a two-sided band on a single
    // derived value, not a one-sided floor - the wrong shape for that check.
    for (const [name, kit] of merged) {
      const ratio = kit.hitom.pitchTime / kit.lowtom.pitchTime;
      // Both bounds are INCLUSIVE on purpose: Dusty Break sits at exactly 0.75,
      // with no margin at all. Switching either to a strict inequality, or
      // nudging that kit's pitchTime by a rounding step, turns this red - so
      // widen the band deliberately rather than discovering it in a diff.
      expect(ratio, `${name} hitom/lowtom pitchTime ratio`).toBeGreaterThanOrEqual(2 / 3);
      expect(ratio, `${name} hitom/lowtom pitchTime ratio`).toBeLessThanOrEqual(0.75);
    }
  });

  test('lowtom.decay stays about 1.9x its own hitom.decay', () => {
    // Task 4's other derived ratio, pinned for the same reason: measured
    // 1.818-2.000 across all thirteen kits, and equally unpinned before this.
    for (const [name, kit] of merged) {
      const ratio = kit.lowtom.decay / kit.hitom.decay;
      // Inclusive on purpose, and three kits depend on it: Velocity Breaks,
      // Warehouse and Tight Pocket all sit at exactly 2.0. Same warning as the
      // pitchTime band above - a strict inequality here fails three kits at once.
      expect(ratio, `${name} lowtom/hitom decay ratio`).toBeGreaterThanOrEqual(1.818);
      expect(ratio, `${name} lowtom/hitom decay ratio`).toBeLessThanOrEqual(2.0);
    }
  });

  test('the low tom sits below the snare body and above the kick', () => {
    // The descending ladder a listener recognises as a fill: snare body,
    // hi tom, low tom, kick. With one tom this was a three-step check;
    // decision 32 adds the fourth step (hitom, checked separately below) in
    // slice 4.
    for (const [name, kit] of merged) {
      expect(kit.lowtom.freqEnd, `${name} lowtom vs snare`).toBeLessThan(kit.snare.bodyFreqEnd);
      expect(kit.lowtom.freqEnd, `${name} lowtom vs kick`).toBeGreaterThan(kit.kick.freqEnd);
    }
  });

  test('the hi tom sits above the low tom and never above the snare cap', () => {
    // The guard decision 32 calls load-bearing: without it the hi tom sits on
    // the same note as the snare body and a fill turns to mud.
    for (const [name, kit] of merged) {
      expect(kit.hitom.freqEnd, `${name} hitom vs lowtom`).toBeGreaterThan(kit.lowtom.freqEnd);
      expect(kit.hitom.freqEnd, `${name} hitom vs snare cap`)
        .toBeLessThanOrEqual(0.85 * kit.snare.bodyFreqEnd);
    }
  });

  test('crash decays span the difference between a fade and a ring', () => {
    // 0.85 s is a crash that has been faded, not one that rang; the 808
    // cymbal is famously long and Acoustic Studio owns the ceiling.
    const decays = Object.values(DRUM_KITS).map((p) => mergeDrumKit(p).crash.decay);
    expect(Math.max(...decays) / Math.min(...decays)).toBeGreaterThanOrEqual(2.4);
    expect(Math.max(...decays)).toBeGreaterThanOrEqual(1.8);
  });
});

describe('reverb send tuning rules', () => {
  test('every kit sends its kick, its low tom and its hi tom to the reverb, and Warehouse sends the most kick', () => {
    const sends = Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as const,
    );
    for (const [name, kit] of sends) {
      // Strictly greater than zero, and that is not decoration: check:drums'
      // spread() asserts max >= factor * min, so one kit at exactly 0 makes the
      // requirement 0 and the check passes vacuously for any factor.
      expect(kit.kick.reverbSend, `${name}.kick`).toBeGreaterThan(0);
      expect(kit.lowtom.reverbSend, `${name}.lowtom`).toBeGreaterThan(0);
      // Same drummer, same room (decision 32): the two toms always match.
      expect(kit.hitom.reverbSend, `${name}.hitom`).toBe(kit.lowtom.reverbSend);
    }
    const wettestKick = sends.reduce((a, b) =>
      b[1].kick.reverbSend > a[1].kick.reverbSend ? b : a,
    );
    // decision 25: the kick send is what makes Warehouse ≠ Club Standard.
    expect(wettestKick[0]).toBe('Warehouse');
  });
});

describe('hat topCut', () => {
  test('every kit\'s hats are a band, not an inversion: topCut sits above filter', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const kit = mergeDrumKit(partial);
      for (const voice of ['hihat', 'openhat'] as const) {
        // 1.5x, not merely ">": a lowpass a hair above a highpass leaves a
        // notch, not a hat. The margin is what keeps the voice audible.
        expect(kit[voice].topCut, `${name}.${voice}`).toBeGreaterThan(kit[voice].filter * 1.5);
      }
    }
  });
});
