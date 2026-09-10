import { describe, expect, test } from 'bun:test';
import { computeArpTick, computeArpTriggers, releaseTriggeredTargets } from './arpPlayback';
import type { ArpRate } from './arpPlayback';
import type { HeldNoteTargets } from './heldNotes';
import type { SynthControlTarget } from '@/utils/synthControl';
import { INITIAL_SYNTH_PARAMS } from '@/store/initialState';

// Reference implementation: the original 4-branch subscriber logic from
// SoundView.tsx 281-405, transcribed 1:1 into pure form.
function referenceTriggers(step: number, seqLen: number, rate: ArpRate, stepDur16: number) {
  const out: Array<{ noteIndex: number; timeOffsetSec: number; holdSec: number }> = [];
  if (rate === '4n') {
    if (step % 4 !== 0) return out;
    const index = Math.floor(step / 4) % seqLen;
    const stepDurSec = stepDur16 * 4;
    out.push({ noteIndex: index, timeOffsetSec: 0, holdSec: Math.max(0.04, stepDurSec * 0.85) });
  } else if (rate === '8n') {
    if (step % 2 !== 0) return out;
    const index = Math.floor(step / 2) % seqLen;
    const stepDurSec = stepDur16 * 2;
    out.push({ noteIndex: index, timeOffsetSec: 0, holdSec: Math.max(0.04, stepDurSec * 0.85) });
  } else if (rate === '32n') {
    const subDurSec = stepDur16 / 2;
    const holdSec = Math.max(0.03, subDurSec * 0.85);
    out.push({ noteIndex: (step * 2) % seqLen, timeOffsetSec: 0, holdSec });
    out.push({ noteIndex: (step * 2 + 1) % seqLen, timeOffsetSec: subDurSec, holdSec });
  } else {
    const index = step % seqLen;
    out.push({ noteIndex: index, timeOffsetSec: 0, holdSec: Math.max(0.04, stepDur16 * 0.85) });
  }
  return out;
}

describe('computeArpTriggers', () => {
  test('matches the original 4-branch behavior for every step and rate', () => {
    const rates: ArpRate[] = ['4n', '8n', '16n', '32n'];
    for (let step = 0; step < 64; step++) {
      for (const rate of rates) {
        expect(computeArpTriggers(step, 5, rate, 0.25)).toEqual(referenceTriggers(step, 5, rate, 0.25));
      }
    }
  });

  test('indexes wrap at the sequence length and step 0 always fires', () => {
    expect(computeArpTriggers(0, 3, '16n', 0.25)).toEqual([{ noteIndex: 0, timeOffsetSec: 0, holdSec: Math.max(0.04, 0.25 * 0.85) }]);
    expect(computeArpTriggers(4, 3, '16n', 0.25)[0].noteIndex).toBe(1);
  });

  test('hold-floor branches bind at tiny step durations', () => {
    // stepDur16 = 0.01s: 4n would compute 0.01*4*0.85 = 0.034s (< 0.04 floor)
    // and 32n computes subDur = 0.005s -> 0.005*0.85 = 0.00425s (< 0.03 floor).
    // The reference transcription produces the same floored values.
    expect(computeArpTriggers(4, 5, '4n', 0.01)[0].holdSec).toBe(0.04);
    expect(computeArpTriggers(0, 5, '32n', 0.01)[0].holdSec).toBe(0.03);
  });
});

describe('releaseTriggeredTargets', () => {
  // `releaseTriggeredTargets` only receives `triggered` — the recorded set —
  // so assertions must be on the CALLS it makes, not on some second channel a
  // wrong implementation could still satisfy: a call count, per-member
  // coverage with no duplicates, and the releaseTime argument forwarded
  // verbatim, which the old positive-only test never checked.
  test('an empty set calls release zero times', () => {
    const calls: Array<[SynthControlTarget, number]> = [];
    releaseTriggeredTargets(new Set<SynthControlTarget>(), 0.3, (target, releaseTime) => {
      calls.push([target, releaseTime]);
    });
    expect(calls.length).toBe(0);
  });

  test('a two-member set calls release exactly twice, once per member, with no duplicates', () => {
    // A hold that spans a focus change leaves sounding voices on MORE THAN
    // ONE bus — Lead's from the ticks before the change, FX's from the ticks
    // after — and a single captured target releases exactly one of them while
    // the other drones.
    const calls: Array<[SynthControlTarget, number]> = [];
    const triggered = new Set<SynthControlTarget>(['synth', 'fx']);

    releaseTriggeredTargets(triggered, 0.25, (target, releaseTime) => {
      calls.push([target, releaseTime]);
    });

    expect(calls.length).toBe(2);
    expect(new Set(calls.map(([target]) => target))).toEqual(new Set(['synth', 'fx']));
    expect(triggered.size).toBe(0);
  });

  test('the releaseTime argument is forwarded verbatim to every call', () => {
    const releaseTimes: number[] = [];
    const triggered = new Set<SynthControlTarget>(['synth', 'fx']);

    releaseTriggeredTargets(triggered, 0.4567, (_target, releaseTime) => {
      releaseTimes.push(releaseTime);
    });

    expect(releaseTimes).toEqual([0.4567, 0.4567]);
  });
});

describe('computeArpTick', () => {
  // `useEffect` does not run under `renderToString` and this repo bans
  // DOM/testing-library, so the clock callback in useArpPlayback is not
  // reachable from a test — `computeArpTick` is the record-then-trigger step
  // pulled out of it so both halves are.
  function heldWith(target: SynthControlTarget, ...notes: string[]): HeldNoteTargets {
    const held: HeldNoteTargets = new Map();
    for (const note of notes) held.set(note, target);
    return held;
  }

  test('a firing tick records the target as triggered and returns its triggers', () => {
    const triggered = new Set<SynthControlTarget>();
    const params = { ...INITIAL_SYNTH_PARAMS, arpActive: true };
    const result = computeArpTick(triggered, 'synth', heldWith('synth', 'C4'), params, 120, 0, 16);

    expect(result.triggers.length).toBeGreaterThan(0);
    expect(result.sequence).toEqual(['C4']);
    expect(triggered.has('synth')).toBe(true);
  });

  test('with notes held on TWO buses, only the target bus is sequenced and recorded', () => {
    // A hold spanning a focus change can leave notes on more than one bus —
    // computeArpTick must sequence and record only the one it was called
    // for, never the other bus's notes leaking into this tick's trigger set.
    const triggered = new Set<SynthControlTarget>();
    const params = { ...INITIAL_SYNTH_PARAMS, arpActive: true };
    const held: HeldNoteTargets = new Map([
      ['C4', 'synth' as SynthControlTarget],
      ['E4', 'fx' as SynthControlTarget],
    ]);
    const result = computeArpTick(triggered, 'fx', held, params, 120, 0, 16);

    expect(result.triggers.length).toBeGreaterThan(0);
    expect(result.sequence).toEqual(['E4']);
    expect(triggered.has('fx')).toBe(true);
    expect(triggered.has('synth')).toBe(false);
    expect(triggered.size).toBe(1);
  });

  test('the arp being off records nothing and triggers nothing', () => {
    const triggered = new Set<SynthControlTarget>();
    const params = { ...INITIAL_SYNTH_PARAMS, arpActive: false };
    const result = computeArpTick(triggered, 'synth', heldWith('synth', 'C4'), params, 120, 0, 16);

    expect(result.triggers).toEqual([]);
    expect(triggered.size).toBe(0);
  });

  test('nothing held on the target bus records nothing and triggers nothing', () => {
    const triggered = new Set<SynthControlTarget>();
    const params = { ...INITIAL_SYNTH_PARAMS, arpActive: true };
    const result = computeArpTick(triggered, 'synth', new Map(), params, 120, 0, 16);

    expect(result.triggers).toEqual([]);
    expect(triggered.size).toBe(0);
  });

  test('a step the rate does not fire on records nothing', () => {
    const triggered = new Set<SynthControlTarget>();
    const params = { ...INITIAL_SYNTH_PARAMS, arpActive: true, arpRate: '4n' as const };
    // Step 1 is not a multiple of 4, so '4n' does not fire here.
    const result = computeArpTick(triggered, 'synth', heldWith('synth', 'C4'), params, 120, 1, 16);

    expect(result.triggers).toEqual([]);
    expect(triggered.size).toBe(0);
  });
});
