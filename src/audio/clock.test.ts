import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { barDurationSec, STEPS_PER_BAR, stepDurationSec } from '../utils/musicTheory';
import { getMeter } from '../utils/meter';
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

describe('meter-aware clock', () => {
  test('4/4 metronome and beat dispatch are unchanged', () => {
    const { engine, ctx, tick } = clockEngine();
    const clicks: Array<{ step: number; downbeat: boolean }> = [];
    const beats: number[] = [];
    let dispatched = 0;
    (engine as any).playMetronomeClick = (isDownbeat: boolean) => {
      clicks.push({ step: dispatched, downbeat: isDownbeat });
    };
    engine.setMeter(getMeter('4/4'));
    engine.setMetronomeEnabled(true);
    engine.subscribeClock((step, beat) => {
      dispatched = step;
      beats[step] = beat;
    });

    for (let i = 0; i < 120; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    // Historical behaviour: a click on every 4th step, accented every 16th.
    // Constraining only the clicks that DID fire (`c.step % 4 === 0`) is
    // one-sided: regressing isBeatBoundary to `stepInBar === 0` would keep
    // every one of those checks green while three-quarters of the metronome
    // silently disappeared. Assert the complete, exhaustive click set instead.
    const maxStep = beats.length - 1;
    const expectedClickSteps = Array.from({ length: Math.floor(maxStep / 4) + 1 }, (_, i) => i * 4);
    expect(clicks.length).toBeGreaterThan(5);
    expect(clicks.map((c) => c.step)).toEqual(expectedClickSteps);
    for (const c of clicks) {
      expect(c.downbeat).toBe(c.step % 16 === 0);
    }
    // Historical behaviour: beat === Math.floor(step / 4).
    beats.forEach((beat, step) => expect(beat).toBe(Math.floor(step / 4)));
  });

  test('7/8 clicks on the 3+2+2 grouping and accents only the downbeat', () => {
    const { engine, ctx, tick } = clockEngine();
    const clicks: Array<{ step: number; downbeat: boolean }> = [];
    let dispatched = 0;
    (engine as any).playMetronomeClick = (isDownbeat: boolean) => {
      clicks.push({ step: dispatched, downbeat: isDownbeat });
    };
    engine.setMeter(getMeter('7/8'));
    engine.setMetronomeEnabled(true);
    engine.subscribeClock((step) => {
      dispatched = step;
    });

    for (let i = 0; i < 160; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    expect(clicks.length).toBeGreaterThan(6);
    for (const c of clicks) {
      const stepInBar = c.step % 14;
      expect([0, 6, 10]).toContain(stepInBar);
      expect(c.downbeat).toBe(stepInBar === 0);
    }
  });

  test('7/8 downbeats never drift: bar N starts at exactly 14N steps', () => {
    const { engine, ctx, tick } = clockEngine();
    const downbeatSteps: number[] = [];
    let dispatched = 0;
    (engine as any).playMetronomeClick = (isDownbeat: boolean) => {
      if (isDownbeat) downbeatSteps.push(dispatched);
    };
    engine.setMeter(getMeter('7/8'));
    engine.setMetronomeEnabled(true);
    engine.subscribeClock((step) => {
      dispatched = step;
    });

    // 200 ticks (the brief's original count) only covers ~2.9 bars of 14
    // steps at the default 120 bpm, so at most 3 downbeats are ever dispatched
    // and `toBeGreaterThan(3)` can never pass. 260 ticks covers ~4.6 bars.
    for (let i = 0; i < 260; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    expect(downbeatSteps.length).toBeGreaterThan(3);
    for (let i = 1; i < downbeatSteps.length; i++) {
      expect(downbeatSteps[i] - downbeatSteps[i - 1]).toBe(14);
    }
  });

  test('6/8 dispatches two beats per twelve-step bar', () => {
    const { engine, ctx, tick } = clockEngine();
    const beats: number[] = [];
    engine.setMeter(getMeter('6/8'));
    engine.subscribeClock((step, beat) => {
      beats[step] = beat;
    });

    for (let i = 0; i < 120; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    beats.forEach((beat, step) => {
      const bar = Math.floor(step / 12);
      const stepInBar = step % 12;
      expect(beat).toBe(bar * 2 + (stepInBar < 6 ? 0 : 1));
    });
  });

  test('the meter defaults to 4/4 before anything sets one', () => {
    const { engine } = clockEngine();
    expect(engine.getMeter().id).toBe('4/4');
  });
});

describe('resetClock anchoring', () => {
  test('with no argument it re-anchors CLOCK_REANCHOR_DELAY ahead of now', () => {
    const { engine, ctx } = clockEngine();
    engine.resetClock();
    expect((engine as any).clockStepIndex).toBe(0);
    expect((engine as any).clockNextStepTime).toBeCloseTo(ctx.currentTime + 0.05, 6);
  });

  test('an explicit future anchor puts step 0 exactly there', () => {
    const { engine, ctx } = clockEngine();
    const target = ctx.currentTime + 0.075;
    engine.resetClock(target);
    expect((engine as any).clockStepIndex).toBe(0);
    expect((engine as any).clockNextStepTime).toBe(target);
  });

  test('an anchor already in the past falls back rather than scheduling behind', () => {
    // A stalled tick (backgrounded tab, GC pause) can hand back a boundary
    // time the audio clock has already passed. Scheduling there would make
    // clockTick burst every step between then and now.
    const { engine, ctx } = clockEngine();
    engine.resetClock(ctx.currentTime - 0.2);
    expect((engine as any).clockNextStepTime).toBeCloseTo(ctx.currentTime + 0.05, 6);
  });
});

describe('song boundary alignment', () => {
  /**
   * Drives the real clock to a loop boundary and re-anchors from inside the
   * dispatch, the way songMode's advance does through loadLoop. Returns how
   * far the new loop's step 0 lands from where the grid wanted it, in ms.
   */
  function boundaryErrorMs(bpm: number, anchorToBoundary: boolean): number {
    const { engine, ctx, tick } = clockEngine(bpm);
    const seen: Array<{ step: number; time: number }> = [];
    let want: number | null = null;
    engine.subscribeClock((step, _beat, time) => {
      seen.push({ step, time });
      if (step === 64 && want === null) {
        want = time;
        engine.resetClock(anchorToBoundary ? time : undefined);
      }
    });
    for (let i = 0; i < 900; i++) {
      tick();
      ctx.currentTime += 0.025;
    }
    const landed = seen.find((s, i) => i > 0 && s.step === 0 && seen[i - 1].step !== 0);
    if (want === null || !landed) throw new Error('boundary never reached');
    return (landed.time - want) * 1000;
  }

  test('anchoring on the boundary step lands the new loop exactly on the grid', () => {
    for (const bpm of [90, 120, 140]) {
      expect(boundaryErrorMs(bpm, true)).toBeCloseTo(0, 6);
    }
  });

  test('the default anchor lands it EARLY — the glitch this alignment fixes', () => {
    // Pins the defect so the fix cannot silently regress: the fixed 50 ms
    // re-anchor ignores how far ahead the boundary step was scheduled, so the
    // new loop's downbeat arrives early by (lookahead remaining - 50 ms).
    for (const bpm of [90, 120, 140]) {
      const err = boundaryErrorMs(bpm, false);
      expect(err).toBeLessThan(-20);
      expect(err).toBeGreaterThan(-50);
    }
  });
});

/**
 * The metronome is a CLICK, not a transport.
 *
 * It used to be both: setMetronomeEnabled started the shared clock, and
 * subscribeClock's disposer refused to stop the timer while the metronome was
 * on. That made a second, invisible transport — the grid's playhead ran, the
 * lead recorder quantised against it, and the context never went idle, all
 * from a toggle that only claims to add a click to music that is already
 * playing. These pin that the toggle no longer moves time.
 */
describe('the metronome does not run the clock', () => {
  test('enabling it starts no timer', () => {
    const { engine } = clockEngine();
    engine.setMetronomeEnabled(true);
    expect((engine as any).clockTimer).toBeNull();
  });

  test('the last subscriber leaving stops the clock even with it enabled', () => {
    const { engine } = clockEngine();
    engine.setMetronomeEnabled(true);
    const unsubscribe = engine.subscribeClock(() => {});
    expect((engine as any).clockTimer).not.toBeNull();
    unsubscribe();
    expect((engine as any).clockTimer).toBeNull();
  });

  test('it still clicks on the beat while a player holds the clock', () => {
    const { engine, ctx, tick } = clockEngine();
    const clicks: number[] = [];
    (engine as any).playMetronomeClick = (_down: boolean, time: number) => clicks.push(time);
    engine.setMetronomeEnabled(true);
    engine.subscribeClock(() => {});

    for (let i = 0; i < 40; i++) {
      tick();
      ctx.currentTime += 0.025;
    }
    expect(clicks.length).toBeGreaterThan(1);
  });
});
