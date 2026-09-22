import { describe, expect, test } from 'bun:test';
import { planMelodyStep, type MelodyPlanSnapshot } from './melodyPlan';
import {
  leadScheduleHits,
  leadSoundingNotes,
  resolveLeadStepTriggers,
  type LeadNote,
} from '@/audio/playback/leadMelody';
import { LEAD_TICKS_PER_BAR, TICKS_PER_SIXTEENTH, strideFor } from '@/utils/stepResolution';
import { arpStepFor } from '@/utils/timeSignature';
import { stepDurationSec } from '@/utils/tempo';

const ARP_OFF = { active: false, mode: 'up', rate: '8n', octaves: 1 } as MelodyPlanSnapshot['arp'];
const TICK_DUR = stepDurationSec(120) / TICKS_PER_SIXTEENTH;

/** One stored bar with a quarter note at tick 0 and an eighth at tick 4. */
function bar(): LeadNote[][] {
  const rows: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
  rows[0] = [{ note: 'C4', len: 4 * TICKS_PER_SIXTEENTH }];
  rows[4] = [{ note: 'E4', len: 2 * TICKS_PER_SIXTEENTH }];
  return rows;
}

function snapshot(over: Partial<MelodyPlanSnapshot> = {}): MelodyPlanSnapshot {
  return { steps: bar(), loopLength: 1, stepResolution: '1/16', gate: 0.85, arp: ARP_OFF, ...over };
}

describe('planMelodyStep', () => {
  test('is exactly the three-function chain both call sites write by hand', () => {
    const snap = snapshot();
    const stride = strideFor(snap.stepResolution);
    for (const step of [0, 1, 4, 7, 15]) {
      const expected: { note: string; startOffsetSec: number; holdSec: number }[] = [];
      for (const hit of leadScheduleHits(step, stride, 16, false, TICK_DUR)) {
        const sounding = leadSoundingNotes(snap.steps, hit.column, 16, stride);
        for (const trigger of resolveLeadStepTriggers(
          sounding, snap.arp, arpStepFor(step, 16), TICK_DUR, snap.gate, stride,
          { tickInLoop: hit.column * stride, melodyTicks: 16 * TICKS_PER_SIXTEENTH },
        )) {
          expected.push({
            note: trigger.note,
            startOffsetSec: hit.offsetSec + trigger.timeOffsetSec,
            holdSec: trigger.holdSec,
          });
        }
      }
      expect(
        planMelodyStep(snap, { stepInLoop: step, stepsPerBar: 16, tickDurSec: TICK_DUR }),
        `step ${step}`,
      ).toEqual(expected);
    }
  });

  test('only a note that STARTS on this column fires, with the gate on its final cell', () => {
    const planned = planMelodyStep(snapshot(), { stepInLoop: 0, stepsPerBar: 16, tickDurSec: TICK_DUR });
    expect(planned.map((p) => p.note)).toEqual(['C4']);
    // 4 cells at 1/16: (4 - 1 + 0.85) x stride x tickDur.
    expect(planned[0].holdSec).toBeCloseTo((4 - 1 + 0.85) * TICKS_PER_SIXTEENTH * TICK_DUR, 10);
    expect(
      planMelodyStep(snapshot(), { stepInLoop: 1, stepsPerBar: 16, tickDurSec: TICK_DUR }),
    ).toEqual([]);
  });

  test('a coarser resolution makes an off-grid note DORMANT, not transposed onto the grid', () => {
    const rows = bar();
    // Tick 2 is off the 1/8 grid (stride 4) but on the 1/16 grid (stride 2).
    rows[2] = [{ note: 'G4', len: TICKS_PER_SIXTEENTH }];
    const at = (stepResolution: MelodyPlanSnapshot['stepResolution'], step: number) =>
      planMelodyStep(snapshot({ steps: rows, stepResolution }), {
        stepInLoop: step,
        stepsPerBar: 16,
        tickDurSec: TICK_DUR,
      }).map((p) => p.note);
    expect(at('1/16', 1)).toEqual(['G4']);
    expect(at('1/8', 0)).toEqual(['C4']);
    expect(at('1/8', 1)).toEqual([]);
  });

  test('1/32 dispatches two columns from one clock step, at two offsets', () => {
    const rows = bar();
    rows[1] = [{ note: 'A4', len: 1 }];
    const planned = planMelodyStep(snapshot({ steps: rows, stepResolution: '1/32' }), {
      stepInLoop: 0,
      stepsPerBar: 16,
      tickDurSec: TICK_DUR,
    });
    expect(planned.map((p) => p.note)).toEqual(['C4', 'A4']);
    expect(planned[0].startOffsetSec).toBe(0);
    expect(planned[1].startOffsetSec).toBeCloseTo(TICK_DUR, 10);
  });

  test('is a plain function of its inputs: two calls agree', () => {
    const ctx = { stepInLoop: 0, stepsPerBar: 16, tickDurSec: TICK_DUR };
    expect(planMelodyStep(snapshot(), ctx)).toEqual(planMelodyStep(snapshot(), ctx));
  });

  test('arp on: sounding notes across ages feed the arp sequence, not just age-0 notes', () => {
    const arpOn: MelodyPlanSnapshot['arp'] = { active: true, mode: 'up', rate: '16n', octaves: 1 };
    const snap = snapshot({ arp: arpOn });
    const stride = strideFor(snap.stepResolution);
    for (const step of [0, 1, 2, 3]) {
      const expected: { note: string; startOffsetSec: number; holdSec: number }[] = [];
      for (const hit of leadScheduleHits(step, stride, 16, true, TICK_DUR)) {
        const sounding = leadSoundingNotes(snap.steps, hit.column, 16, stride);
        for (const trigger of resolveLeadStepTriggers(
          sounding, snap.arp, arpStepFor(step, 16), TICK_DUR, snap.gate, stride,
          { tickInLoop: hit.column * stride, melodyTicks: 16 * TICKS_PER_SIXTEENTH },
        )) {
          expected.push({
            note: trigger.note,
            startOffsetSec: hit.offsetSec + trigger.timeOffsetSec,
            holdSec: trigger.holdSec,
          });
        }
      }
      expect(
        planMelodyStep(snap, { stepInLoop: step, stepsPerBar: 16, tickDurSec: TICK_DUR }),
        `arp step ${step}`,
      ).toEqual(expected);
    }
  });

  test('a 2-bar loop reads the second bar, not a repeat of the first (loopLength is honored)', () => {
    const rows = Array.from({ length: 2 * LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]);
    rows[LEAD_TICKS_PER_BAR] = [{ note: 'G3', len: 4 * TICKS_PER_SIXTEENTH }];
    const snap = snapshot({ steps: rows, loopLength: 2 });
    // Column 16 (step 16) is the first column of bar 2 at 1/16 (stride 2, 16 cols/bar).
    const planned = planMelodyStep(snap, { stepInLoop: 16, stepsPerBar: 16, tickDurSec: TICK_DUR });
    expect(planned.map((p) => p.note)).toEqual(['G3']);
  });
});
