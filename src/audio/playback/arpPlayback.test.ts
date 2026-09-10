import { describe, expect, test } from 'bun:test';
import { computeArpTriggers, releaseTriggeredTargets } from './arpPlayback';
import type { ArpRate } from './arpPlayback';
import type { SynthControlTarget } from '@/utils/synthControl';

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
  test('releases every bus the arp has triggered on, then forgets them', () => {
    // A hold that spans a focus change leaves sounding voices on MORE THAN
    // ONE bus — Lead's from the ticks before the change, FX's from the ticks
    // after — and a single captured target releases exactly one of them while
    // the other drones.
    const released: [string, number][] = [];
    const triggered = new Set<SynthControlTarget>(['synth', 'fx']);

    releaseTriggeredTargets(triggered, 0.25, (target, releaseTime) => {
      released.push([target, releaseTime]);
    });

    expect(released).toEqual([
      ['synth', 0.25],
      ['fx', 0.25],
    ]);
    expect(triggered.size).toBe(0);
  });

  test('a bus that was focused but never triggered on gets no release', () => {
    // The negative half. A cleanup that released every KNOWN target would pass
    // the test above while releasing buses it never touched — harmless to the
    // ear, but it makes the record a lie and hides a real stranded voice.
    const released: SynthControlTarget[] = [];
    const triggered = new Set<SynthControlTarget>(['synth']);

    releaseTriggeredTargets(triggered, 0.3, (target) => {
      released.push(target);
    });

    expect(released).toEqual(['synth']);
    expect(released).not.toContain('fx');
  });

  test('an empty record releases nothing', () => {
    const released: SynthControlTarget[] = [];
    releaseTriggeredTargets(new Set<SynthControlTarget>(), 0.3, (target) => {
      released.push(target);
    });
    expect(released).toEqual([]);
  });
});
