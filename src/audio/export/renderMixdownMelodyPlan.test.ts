import { describe, expect, test } from 'bun:test';
import { mixdownLoop, mixdownMelodyBar } from './mixdownFixture';
import { mixdownLeadTrack, mixdownFxTrack } from './renderMixdown';
import { melodyPlanSnapshot } from '@/store/playbackPlanSnapshots';
import { planMelodyStep } from '../playback/plan/melodyPlan';
import { stepDurationSec } from '@/utils/musicTheory';
import { TICKS_PER_SIXTEENTH } from '@/utils/stepResolution';
import type { AppStore } from '@/store/types';

/**
 * DEV-397 Task 14's convergence proof: the offline renderer's melody
 * transcription is deleted, and both the live controller and the offline
 * renderer now schedule a melody track through the SAME `planMelodyStep`.
 * This file is split out of `renderMixdown.test.ts` only because that file
 * already sits at the repo's `max-lines` ceiling — the tests belong to the
 * same suite in every other sense and load the renderer's own fixtures.
 */

/** Both melody tracks, deliberately diverging on every field the renderer
 * could swap between them (Task 13: Lead is irregular in four columns).
 * `offline` calls the renderer's own `mixdownLeadTrack`/`mixdownFxTrack`
 * directly, so a swap inside either builder fails this test, not just a
 * hand-copy of it. */
function pairMelodySnapshots() {
  const loop = mixdownLoop({
    leadMelodySteps: mixdownMelodyBar('C4'), leadLoopLength: 2, leadStepResolution: '1/8', leadGate: 0.85,
    synthArpSettings: { active: true, mode: 'up', rate: '8n', octaves: 2 },
    fxMelodySteps: mixdownMelodyBar('G4'), fxLoopLength: 1, fxStepResolution: '1/16', fxGate: 0.4,
    fxArpSettings: { active: true, mode: 'down', rate: '16n', octaves: 1 },
  });
  const state = {
    leadMelodySteps: loop.leadMelodySteps, leadLoopLength: loop.leadLoopLength,
    leadStepResolution: loop.leadStepResolution, leadGate: loop.leadGate, synthArpSettings: loop.synthArpSettings,
    fxMelodySteps: loop.fxMelodySteps, fxLoopLength: loop.fxLoopLength,
    fxStepResolution: loop.fxStepResolution, fxGate: loop.fxGate, fxArpSettings: loop.fxArpSettings,
  } as unknown as AppStore;
  return [
    { name: 'lead' as const, live: melodyPlanSnapshot(state, 'lead'), offline: mixdownLeadTrack(loop) },
    { name: 'fx' as const, live: melodyPlanSnapshot(state, 'fx'), offline: mixdownFxTrack(loop) },
  ];
}

describe('live and offline melody planning are the same computation', () => {
  for (const { name, live, offline } of pairMelodySnapshots()) {
    test(`${name}: offline track matches the store's own snapshot`, () => {
      const { steps, loopLength, stepResolution, gate, arp } = offline;
      expect({ steps, loopLength, stepResolution, gate, arp }).toEqual(live);
    });

    for (const [meterId, spb] of [['4/4', 16], ['3/4', 12], ['12/8', 24]] as const) {
      test(`${name} ${meterId}: every step of the loop plans identically`, () => {
        const tickDurSec = stepDurationSec(120) / TICKS_PER_SIXTEENTH;
        for (let step = 0; step < spb * live.loopLength; step += 1) {
          const ctx = { stepInLoop: step, stepsPerBar: spb, tickDurSec };
          expect(planMelodyStep(offline, ctx), `step ${step}`).toEqual(planMelodyStep(live, ctx));
        }
      });
    }
  }

  test('a note left overhanging by a METER change is capped, not rung over the seam', () => {
    // 40 ticks is legal in 12/8 (48 to the bar) and eight too long in 4/4.
    const long = mixdownMelodyBar('C4').map((row, i) => (i === 0 ? [{ note: 'C4', len: 40 }] : row));
    const tickDurSec = stepDurationSec(120) / TICKS_PER_SIXTEENTH;
    const track = {
      steps: long, loopLength: 1, stepResolution: '1/16' as const, gate: 0.85,
      arp: { active: false, mode: 'up' as const, rate: '16n' as const, octaves: 1 },
    };
    const wide = planMelodyStep(track, { stepInLoop: 0, stepsPerBar: 24, tickDurSec })[0];
    const narrow = planMelodyStep(track, { stepInLoop: 0, stepsPerBar: 16, tickDurSec })[0];
    expect(narrow.holdSec).toBeLessThan(wide.holdSec);
  });
});
