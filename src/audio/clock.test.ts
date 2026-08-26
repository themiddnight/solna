import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from './engine';
import { STEPS_PER_BAR, stepDurationSec } from '../utils/musicTheory';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private clockTick and read private clock
   fields, matching engine.test.ts's casting convention. */
type EngineInstance = typeof audioEngine;
const makeEngine = () => new (audioEngine.constructor as any)() as EngineInstance;

/**
 * The clock only needs `currentTime` off the context, so this is deliberately
 * smaller than engine.test.ts's fakeCtx — driving clockTick() by hand instead
 * of through setInterval keeps the suite synchronous and deterministic.
 */
function clockEngine(bpm = 120) {
  const engine = makeEngine();
  const ctx = { currentTime: 10 };
  (engine as any).ctx = ctx;
  engine.setClockBpm(bpm);
  (engine as any).clockNextStepTime = ctx.currentTime;
  (engine as any).clockStepIndex = 0;
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
    const beforeCount = times.length;
    engine.setClockBpm(240);
    ctx.currentTime += 0.5;
    tick();

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

    for (let i = 0; i < 40; i++) {
      tick();
      ctx.currentTime += 0.25;
    }

    expect(downbeats.length).toBeGreaterThan(1);
    const barSec = stepDurationSec(120) * STEPS_PER_BAR;
    for (let i = 1; i < downbeats.length; i++) {
      expect(downbeats[i] - downbeats[i - 1]).toBeCloseTo(barSec, 6);
    }
    (engine as any).stopClockTimer();
  });
});
