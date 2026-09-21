import { afterEach, describe, expect, test } from 'bun:test';
import { noteFrequency } from '../utils/musicTheory';
import { ACTIVE_SYNTH } from './engineTestHelpers';
import type { AudioDiagnosticSnapshot } from './diagnostics';
import { audioEngine } from './engine';
import { bindFakeCtx, fakeCtx, freshEngine, makeEngine, type EngineInstance } from './testFakes';

/* eslint-disable @typescript-eslint/no-explicit-any -- these tests drive the private clock tick
   to prove the public diagnostic snapshot observes it without changing its output. */

const activeEngines: EngineInstance[] = [];

afterEach(() => {
  for (const engine of activeEngines) (engine as any).clock.stopClockTimer();
  activeEngines.length = 0;
});

describe('audio engine diagnostic snapshot', () => {
  test('accepts a bounded runtime health snapshot without requiring engine integration', () => {
    const snapshot: AudioDiagnosticSnapshot = {
      ...makeEngine().getDiagnosticSnapshot(),
      health: {
        phase: 'healthy',
        lastRatio: 1,
        suspiciousCount: 0,
        generation: 2,
        runtimePolicyId: 'ios-webkit',
      },
    };

    expect(snapshot.health).toEqual({
      phase: 'healthy',
      lastRatio: 1,
      suspiciousCount: 0,
      generation: 2,
      runtimePolicyId: 'ios-webkit',
    });
  });

  test('reports an inert engine without initializing audio', () => {
    const engine = makeEngine();

    expect(engine.getDiagnosticSnapshot()).toEqual({
      contextState: 'uninitialized',
      currentTimeSec: null,
      baseLatencySec: null,
      outputLatencySec: null,
      clock: { listeners: 0, dispatches: 0, stalls: 0, maxStallMs: 0 },
      voices: { groups: 0, physicalVoices: 0, registered: 0, bySource: {} },
      health: {
        phase: 'idle',
        lastRatio: null,
        suspiciousCount: 0,
        generation: 0,
        runtimePolicyId: 'default',
      },
    });
  });

  test('validates realtime clock advancement against the runtime policy cadence', async () => {
    let ctx: ReturnType<typeof fakeCtx> | null = null;
    const engine = new (audioEngine.constructor as any)({
      delay: async (ms: number) => {
        expect(ms).toBe(1000);
        if (ctx) ctx.currentTime += 1;
      },
      now: (() => {
        let wall = 0;
        return () => (wall += 1000);
      })(),
      isVisible: () => true,
    }) as EngineInstance;
    ctx = fakeCtx();
    Object.assign(ctx, { state: 'running' });
    bindFakeCtx(engine, ctx);

    expect(await engine.validateRealtimeClock()).toBe(true);

    const frozen = fakeCtx();
    Object.assign(frozen, { state: 'running' });
    bindFakeCtx(engine, frozen);
    expect(await engine.validateRealtimeClock()).toBe(false);
  });

  test('counts logical groups, physical voices, registrations, and source ownership', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn(noteFrequency('C4'), ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live');
    engine.triggerSynthNoteOn(noteFrequency('C3'), ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'sequencer');

    expect(engine.getDiagnosticSnapshot().voices).toEqual({
      groups: 2,
      physicalVoices: 2,
      registered: 2,
      bySource: { synth: 1, bass: 1 },
    });
  });

  test('observes clock dispatch and stalls without changing listener output', () => {
    const engine = makeEngine();
    const ctx = fakeCtx();
    bindFakeCtx(engine, ctx);
    activeEngines.push(engine);
    const received: number[] = [];
    const unsubscribe = engine.subscribeClock((step) => received.push(step));
    (engine as any).clock.clockNextStepTime = ctx.currentTime - 0.2;

    const before = engine.getDiagnosticSnapshot();
    (engine as any).clock.clockTick();
    const after = engine.getDiagnosticSnapshot();
    const afterAgain = engine.getDiagnosticSnapshot();

    expect(before.clock).toEqual({ listeners: 1, dispatches: 0, stalls: 0, maxStallMs: 0 });
    expect(received).toEqual([0]);
    expect({ ...after.clock, maxStallMs: 0 }).toEqual({
      listeners: 1,
      dispatches: 1,
      stalls: 1,
      maxStallMs: 0,
    });
    expect(after.clock.maxStallMs).toBeCloseTo(200);
    expect(afterAgain).toEqual(after);
    unsubscribe();
  });
});
