import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { barDurationSec, STEPS_PER_BAR, stepDurationSec } from '../utils/musicTheory';
import { fakeCtx, makeEngine, type EngineInstance } from './testFakes';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private clockTick and read private clock
   fields, matching engine.test.ts's casting convention. */

// subscribeClock/setMetronomeEnabled start a real setInterval(25ms) on the
// engine instance even though these tests drive the grid by hand via tick().
// Left running, that timer keeps firing (and keeps the process alive) long
// after the test that created it finishes, so every engine this file creates
// is tracked here and stopped in afterEach.
const activeEngines: EngineInstance[] = [];

afterEach(() => {
  for (const engine of activeEngines) {
    (engine as any).stopClockTimer();
  }
  activeEngines.length = 0;
});

/**
 * Reuses the shared fake AudioContext from testFakes.ts — the clock only
 * reads `currentTime` off it, but engine.test.ts's harness is the one and
 * only fake, not forked here.
 */
function clockEngine(bpm = 120) {
  const engine = makeEngine();
  const ctx = fakeCtx();
  (engine as any).ctx = ctx;
  engine.setClockBpm(bpm);
  (engine as any).clockNextStepTime = ctx.currentTime;
  (engine as any).clockStepIndex = 0;
  activeEngines.push(engine);
  const tick = () => (engine as any).clockTick();
  return { engine, ctx, tick };
}

describe('shared clock dispatch', () => {
  test('a listener that throws does not stall the grid', () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { engine, ctx, tick } = clockEngine();
      const good: number[] = [];
      engine.subscribeClock(() => {
        throw new Error('listener blew up');
      });
      engine.subscribeClock((step) => good.push(step));

      tick();
      const firstBatch = good.length;
      expect(firstBatch).toBeGreaterThan(0);
      // Steps must be consecutive: a stall re-dispatches the same index.
      expect(good).toEqual(good.map((_, i) => i));

      ctx.currentTime += 1;
      tick();
      // The grid advanced past the first batch instead of re-throwing step 0.
      expect(good.length).toBeGreaterThan(firstBatch);
      expect(good[good.length - 1]).toBeGreaterThan(good[firstBatch - 1]);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test('a throwing listener does not starve the ones registered after it', () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { engine, tick } = clockEngine();
      const seen: string[] = [];
      engine.subscribeClock(() => seen.push('a'));
      engine.subscribeClock(() => {
        throw new Error('boom');
      });
      engine.subscribeClock(() => seen.push('c'));

      tick();

      expect(seen.filter((s) => s === 'a').length).toBe(seen.filter((s) => s === 'c').length);
      expect(seen.filter((s) => s === 'c').length).toBeGreaterThan(0);
    } finally {
      errors.mockRestore();
    }
  });

  test('the counters have already advanced by the time a throwing listener runs', () => {
    // Pins the ordering half of the fix independently of the try/catch: a
    // per-listener try/catch alone makes a throw invisible to the caller
    // either way, so a test that only checks "did the tick survive" cannot
    // tell "advance before dispatch" apart from "advance after dispatch".
    // This instead inspects the internal counter from inside the listener,
    // before it throws — if the advance moved back to after dispatch, the
    // counter would still read the pre-advance value here.
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { engine, ctx, tick } = clockEngine();
      let stepArg: number | undefined;
      let indexDuringCall: number | undefined;
      engine.subscribeClock((step) => {
        if (indexDuringCall === undefined) {
          stepArg = step;
          indexDuringCall = (engine as any).clockStepIndex;
        }
        throw new Error('boom');
      });

      tick();
      expect(stepArg).toBe(0);
      expect(indexDuringCall).toBe(1);

      // And the grid keeps moving on the next tick instead of re-delivering
      // step 0 forever — the observable symptom of the ordering bug.
      ctx.currentTime += 1;
      tick();
      expect((engine as any).clockStepIndex).toBeGreaterThan(1);
    } finally {
      errors.mockRestore();
    }
  });

  test('step index is monotonic and beat is floor(step / 4)', () => {
    const { engine, ctx, tick } = clockEngine();
    const rows: Array<{ step: number; beat: number; time: number }> = [];
    engine.subscribeClock((step, beat, time) => rows.push({ step, beat, time }));

    tick();
    ctx.currentTime += 0.5;
    tick();

    expect(rows.map((r) => r.step)).toEqual(rows.map((_, i) => i));
    for (const r of rows) expect(r.beat).toBe(Math.floor(r.step / 4));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].time).toBeGreaterThan(rows[i - 1].time);
    }
  });

  test('a bpm change mid-run re-spaces the following steps', () => {
    const { engine, ctx, tick } = clockEngine(120);
    const times: number[] = [];
    engine.subscribeClock((_s, _b, time) => times.push(time));

    tick();
    engine.setClockBpm(240);
    const beforeCount = times.length;

    // Realistic cadence: production ticks every CLOCK_UPDATE_MS (25 ms).
    // 30 ms per tick stays comfortably clear of the 50 ms stall-reanchor
    // threshold, unlike the single 0.5 s jump this test used to simulate —
    // that was a stall by the clock's own definition, not routine re-spacing.
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.03;
      tick();
    }

    const after = times.slice(beforeCount);
    expect(after.length).toBeGreaterThan(1);
    for (let i = 1; i < after.length; i++) {
      expect(after[i] - after[i - 1]).toBeCloseTo(stepDurationSec(240), 9);
    }
  });

  test('setClockBpm clamps out-of-range input instead of producing a 0-length step', () => {
    const { engine } = clockEngine();
    engine.setClockBpm(0);
    expect((engine as any).clockBpm).toBe(20);
    engine.setClockBpm(9999);
    expect((engine as any).clockBpm).toBe(300);
    engine.setClockBpm(Number.NaN);
    expect((engine as any).clockBpm).toBe(120);
  });

  test('a stall re-anchors the schedule instead of bursting every missed step', () => {
    const { engine, ctx, tick } = clockEngine();
    const times: number[] = [];
    engine.subscribeClock((_s, _b, time) => times.push(time));

    tick();
    const beforeCount = times.length;
    ctx.currentTime += 30; // tab backgrounded for 30 s
    tick();

    const burst = times.length - beforeCount;
    // 30 s at 120 bpm is 240 steps; a re-anchor emits only the lookahead window.
    expect(burst).toBeLessThan(10);
    expect(times[times.length - 1]).toBeGreaterThan(ctx.currentTime);
  });

  test('the metronome downbeat lands on STEPS_PER_BAR, not a hardcoded 16', () => {
    const { engine, ctx, tick } = clockEngine();
    const downbeats: number[] = [];
    (engine as any).playMetronomeClick = (isDownbeat: boolean, time: number) => {
      if (isDownbeat) downbeats.push(time);
    };
    engine.setMetronomeEnabled(true);

    // Realistic cadence: matches production's CLOCK_UPDATE_MS exactly, so the
    // grid tracks bpm-accurate spacing instead of repeatedly hitting the
    // stall-reanchor path the old 0.25 s-per-tick version exercised.
    for (let i = 0; i < 200; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    expect(downbeats.length).toBeGreaterThan(1);
    const barSec = barDurationSec(120);
    expect(barSec).toBeCloseTo(stepDurationSec(120) * STEPS_PER_BAR, 12);
    for (let i = 1; i < downbeats.length; i++) {
      expect(downbeats[i] - downbeats[i - 1]).toBeCloseTo(barSec, 6);
    }
  });
});
