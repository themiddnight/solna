import { describe, expect, spyOn, test } from 'bun:test';
import { AudioEngine, SESSION_CLOSE_TIMEOUT_MS } from './engine';
import type { HealthMonitorScheduler } from './runtime/healthMonitor';
import { bindFakeCtx, makeEngine } from './testFakes';
import { masterChainCtx } from './engineTestHelpers';

/**
 * The engine surface — what `AudioEngine` itself still owns.
 *
 * `engine.ts` is a composition root: the DSP lives in `masterRack.ts`,
 * `clock.ts`, `drumSynth.ts` and `synth/`, and each one's tests live beside
 * it. The describes that used to sit here were split out by subsystem,
 * because a file's counted lines must stay under 750 and the drum and voice
 * suites alone are larger than that:
 *
 *   - master chain, effect knobs, source buses, analysers, dynamics
 *       -> `masterRack.test.ts`
 *   - voice lifecycle, allocation, release, stop, polyphony
 *       -> `synth/voiceManager.test.ts`
 *   - voice graph, envelope shape, noise, glide, drive
 *       -> `synth/subtractiveVoice.test.ts`, `synth/subtractiveVoice.glide.test.ts`
 *   - LFO bank and modulation primitives
 *       -> `synth/synthLfo.test.ts`, `synth/modulation.test.ts`
 *   - drum voices, kits, aliases, sends, choke groups
 *       -> `drumSynth.test.ts`
 *   - the metallic oscillator bank (hats, ride, bell, crash)
 *       -> `drumMetal.test.ts`
 *   - clock subscription and idle suspend
 *       -> `clock.test.ts`
 *
 * The shared harness those files import — `masterChainCtx`, `recordNodes`,
 * `ACTIVE_SYNTH`, `fakeVoiceContext` — lives in `engineTestHelpers.ts`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('getAudioLevel removal', () => {
  test('getAudioLevel is gone — a spectrum average was never a level', () => {
    const engine = makeEngine();
    expect((engine as any).getAudioLevel).toBeUndefined();
  });
});

describe('facade before initialization', () => {
  test('keeps setters and sound triggers as safe no-ops', () => {
    const engine = makeEngine();

    expect(() => {
      engine.setMasterVolume(0.5);
      engine.setClockBpm(90);
      engine.setMetronomeEnabled(true);
      engine.triggerDrum('kick');
    }).not.toThrow();
    expect(engine.getAudioContext()).toBeNull();
    expect(engine.getAnalyser()).toBeNull();
    expect(engine.isMetronomeEnabled()).toBe(false);
  });
});

describe('source bus state delegation', () => {
  test('forwards the complete atomic source state request to MasterRack', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    const setSourceState = spyOn(rack, 'setSourceState');
    const state = { gain: 0.8, muted: true };

    engine.setSourceState('synth', state, 0, 'settle');

    expect(setSourceState).toHaveBeenCalledWith('synth', state, 0, 'settle');
  });
});

describe('session replacement delegation', () => {
  test('every representative facade family targets only the replacement generation', () => {
    const engine = makeEngine();
    const firstCtx = masterChainCtx();
    const secondCtx = masterChainCtx();
    bindFakeCtx(engine, firstCtx);
    const first = (engine as any).session;
    const oldRack = spyOn(first.masterRack, 'setMasterVolume');
    const oldClock = spyOn(first.clock, 'setMetronomeEnabled');
    const oldDrums = spyOn(first.drumSynth, 'triggerDrum');
    const oldVoices = spyOn(first.synthManager, 'dropScheduledFrom');
    const oldAnalyser = engine.getAnalyser();

    bindFakeCtx(engine, secondCtx);
    const second = (engine as any).session;
    const newRack = spyOn(second.masterRack, 'setMasterVolume');
    const newClock = spyOn(second.clock, 'setMetronomeEnabled');
    const newDrums = spyOn(second.drumSynth, 'triggerDrum');
    const newVoices = spyOn(second.synthManager, 'dropScheduledFrom');

    engine.setMasterVolume(0.4);
    engine.setMetronomeEnabled(true);
    engine.triggerDrum('kick', 0.8, 10);
    engine.dropVoicesScheduledFrom('synth', 10);

    expect(oldRack).not.toHaveBeenCalled();
    expect(oldClock).not.toHaveBeenCalled();
    expect(oldDrums).not.toHaveBeenCalled();
    expect(oldVoices).not.toHaveBeenCalled();
    expect(newRack).toHaveBeenCalledTimes(1);
    expect(newClock).toHaveBeenCalledTimes(1);
    expect(newDrums).toHaveBeenCalledTimes(1);
    expect(newVoices).toHaveBeenCalledTimes(1);
    expect(engine.getAudioContext()).toBe(secondCtx as unknown as BaseAudioContext);
    expect(oldAnalyser).not.toBeNull();
    expect(engine.getAnalyser()).not.toBeNull();
    expect(engine.getAnalyser()).not.toBe(oldAnalyser);
    expect(engine.getAnalyser()).toBe(second.masterRack.getAnalyser());
  });

  for (const outcome of ['resolve', 'reject'] as const) {
    test(`late old realtime close ${outcome} cannot mutate the replacement generation`, async () => {
      let settleClose!: () => void;
      let closeCalls = 0;
      const closeResult = new Promise<void>((resolve, reject) => {
        settleClose = () => outcome === 'resolve' ? resolve() : reject(new Error('late close'));
      });
      const firstCtx = Object.assign(masterChainCtx(), {
        close: () => {
          closeCalls += 1;
          return closeResult;
        },
      });
      const secondCtx = Object.assign(masterChainCtx(), { close: async () => {} });
      const engine = makeEngine();
      bindFakeCtx(engine, firstCtx);
      const first = (engine as any).session;

      bindFakeCtx(engine, secondCtx);
      const second = (engine as any).session;
      const secondRack = spyOn(second.masterRack, 'setMasterVolume');
      expect(closeCalls).toBe(1);
      settleClose();
      await Promise.resolve();
      await Promise.resolve();
      engine.setMasterVolume(0.25);

      expect((engine as any).session).toBe(second);
      expect((engine as any).session).not.toBe(first);
      expect(engine.getAudioContext()).toBe(secondCtx as unknown as BaseAudioContext);
      expect(secondRack).toHaveBeenCalledTimes(1);
    });
  }
});

class EngineHealthScheduler implements HealthMonitorScheduler {
  callback: (() => void) | null = null;
  intervals: number[] = [];
  clears = 0;

  setInterval(callback: () => void, intervalMs: number): unknown {
    this.callback = callback;
    this.intervals.push(intervalMs);
    return callback;
  }

  clearInterval(): void {
    this.callback = null;
    this.clears += 1;
  }

  tick(): void { this.callback?.(); }
}

function realtimeContext(overrides: Record<string, unknown> = {}) {
  return Object.assign(masterChainCtx(), {
    state: 'running' as AudioContextState,
    close: async () => {},
    resume: async () => {},
  }, overrides) as unknown as AudioContext;
}

describe('realtime health integration', () => {
  test('first clock subscriber starts monitoring and last unsubscribe stops it', () => {
    const scheduler = new EngineHealthScheduler();
    const engine = new AudioEngine({ healthScheduler: scheduler });
    engine.bindContext(realtimeContext());

    const first = engine.subscribeClock(() => {});
    const second = engine.subscribeClock(() => {});
    expect(scheduler.intervals).toEqual([1000]);

    first();
    expect(scheduler.clears).toBe(0);
    second();
    second();
    expect(scheduler.clears).toBe(1);
  });

  test('forwards each health phase transition once', () => {
    const scheduler = new EngineHealthScheduler();
    let wallTimeMs = 0;
    const ctx = realtimeContext({ currentTime: 0 });
    const engine = new AudioEngine({
      healthScheduler: scheduler,
      now: () => wallTimeMs,
      isVisible: () => true,
    });
    engine.bindContext(ctx);
    const phases: string[] = [];
    engine.subscribeHealth((snapshot) => phases.push(snapshot.phase));
    const stop = engine.subscribeClock(() => {});

    const tick = (audioTimeSec: number) => {
      wallTimeMs += 1000;
      Object.assign(ctx, { currentTime: audioTimeSec });
      scheduler.tick();
    };
    tick(1);
    tick(1.4);
    tick(1.8);
    tick(2.2);

    expect(phases).toEqual(['healthy', 'suspected', 'unhealthy']);
    stop();
  });
});

describe('realtime session recreation', () => {
  test('disposes old and invokes replacement resume before the first await', async () => {
    const order: string[] = [];
    let settleResume!: () => void;
    const first = realtimeContext({
      close: () => { order.push('old-close'); return Promise.resolve(); },
    });
    const second = realtimeContext({
      resume: () => {
        order.push('new-resume');
        return new Promise<void>((resolve) => { settleResume = resolve; });
      },
    });
    const engine = new AudioEngine({
      createRealtimeContext: () => { order.push('new-construct'); return second; },
    });
    engine.bindContext(first);

    const recovery = engine.recreateRealtimeSession();
    order.push('returned');
    expect(order).toEqual(['old-close', 'new-construct', 'new-resume', 'returned']);
    expect(engine.getAudioContext()).toBe(first);

    settleResume();
    expect(await recovery).toEqual({ ok: true, generation: 2 });
    expect(engine.getAudioContext()).toBe(second);
  });

  test('shares one in-flight recreation and returns analysers from the replacement', async () => {
    const first = realtimeContext();
    const second = realtimeContext();
    let constructions = 0;
    const engine = new AudioEngine({
      createRealtimeContext: () => { constructions += 1; return second; },
    });
    engine.bindContext(first);
    const oldAnalyser = engine.getAnalyser();

    const one = engine.recreateRealtimeSession();
    const two = engine.recreateRealtimeSession();

    expect(one).toBe(two);
    expect(await one).toEqual({ ok: true, generation: 2 });
    expect(constructions).toBe(1);
    expect(engine.getAnalyser()).not.toBe(oldAnalyser);
  });

  test('classifies construct, resume, and graph-build failures', async () => {
    const constructEngine = new AudioEngine({
      createRealtimeContext: () => { throw new Error('construct'); },
    });
    constructEngine.bindContext(realtimeContext());
    expect(await constructEngine.recreateRealtimeSession()).toEqual({
      ok: false, generation: 2, reason: 'construct',
    });

    const resumeEngine = new AudioEngine({
      createRealtimeContext: () => realtimeContext({
        resume: () => Promise.reject(new Error('resume')),
      }),
    });
    resumeEngine.bindContext(realtimeContext());
    expect(await resumeEngine.recreateRealtimeSession()).toEqual({
      ok: false, generation: 2, reason: 'resume',
    });

    const broken = realtimeContext();
    Object.assign(broken, { createGain: () => { throw new Error('build'); } });
    const buildEngine = new AudioEngine({ createRealtimeContext: () => broken });
    buildEngine.bindContext(realtimeContext());
    expect(await buildEngine.recreateRealtimeSession()).toEqual({
      ok: false, generation: 2, reason: 'build',
    });
  });

  for (const resumeFailure of ['throw', 'reject'] as const) {
    for (const closeFailure of ['resolve', 'throw', 'reject'] as const) {
      test(`closes replacement once when resume ${resumeFailure}s and close ${closeFailure}s`, async () => {
        let closeCalls = 0;
        const failedResume = resumeFailure === 'throw'
          ? () => { throw new Error('resume'); }
          : () => Promise.reject(new Error('resume'));
        const close = () => {
          closeCalls += 1;
          if (closeFailure === 'throw') throw new Error('close');
          if (closeFailure === 'reject') return Promise.reject(new Error('close'));
          return Promise.resolve();
        };
        const engine = new AudioEngine({
          createRealtimeContext: () => realtimeContext({ resume: failedResume, close }),
        });
        engine.bindContext(realtimeContext());

        expect(await engine.recreateRealtimeSession()).toEqual({
          ok: false, generation: 2, reason: 'resume',
        });
        expect(closeCalls).toBe(1);
      });
    }
  }
});

describe('realtime session recreation safety', () => {
  test('public bindContext invalidates a pending recovery and closes its stale replacement', async () => {
    let finishResume!: () => void;
    let staleCloseCalls = 0;
    const staleContext = realtimeContext({
      resume: () => new Promise<void>((resolve) => { finishResume = resolve; }),
      close: async () => { staleCloseCalls += 1; },
    });
    const boundContext = realtimeContext();
    const engine = new AudioEngine({ createRealtimeContext: () => staleContext });
    engine.bindContext(realtimeContext());

    const stale = engine.recreateRealtimeSession();
    engine.bindContext(boundContext);
    finishResume();

    expect(await stale).toEqual({ ok: false, generation: 2, reason: 'build' });
    expect(engine.getAudioContext()).toBe(boundContext);
    expect(staleCloseCalls).toBe(1);
  });

  test('clock monitor bookkeeping stays balanced across a recreated generation', async () => {
    const scheduler = new EngineHealthScheduler();
    const engine = new AudioEngine({
      createRealtimeContext: () => realtimeContext(),
      healthScheduler: scheduler,
    });
    engine.bindContext(realtimeContext());
    const unsubscribeOld = engine.subscribeClock(() => {});

    await engine.recreateRealtimeSession();
    const unsubscribeNew = engine.subscribeClock(() => {});
    unsubscribeOld();
    unsubscribeOld();
    expect(scheduler.intervals).toEqual([1000]);
    expect(scheduler.clears).toBe(0);

    unsubscribeNew();
    unsubscribeNew();
    expect(scheduler.clears).toBe(1);
    expect(scheduler.callback).toBeNull();
  });

  test('a never-settling old close cannot delay success beyond the close timeout', async () => {
    const delays: number[] = [];
    const engine = new AudioEngine({
      createRealtimeContext: () => realtimeContext(),
      delay: async (ms) => { delays.push(ms); },
    });
    engine.bindContext(realtimeContext({ close: () => new Promise(() => {}) }));

    expect(await engine.recreateRealtimeSession()).toEqual({ ok: true, generation: 2 });
    expect(delays).toEqual([SESSION_CLOSE_TIMEOUT_MS]);
  });

  test('successful replacement clears unhealthy evidence for the new generation', async () => {
    const scheduler = new EngineHealthScheduler();
    let wallTimeMs = 0;
    const first = realtimeContext({ currentTime: 0 });
    const engine = new AudioEngine({
      createRealtimeContext: () => realtimeContext({ currentTime: 0 }),
      healthScheduler: scheduler,
      now: () => wallTimeMs,
      isVisible: () => true,
    });
    engine.bindContext(first);
    engine.subscribeClock(() => {});
    for (const audioTime of [1, 1.4, 1.8, 2.2]) {
      wallTimeMs += 1000;
      Object.assign(first, { currentTime: audioTime });
      scheduler.tick();
    }
    expect(engine.getDiagnosticSnapshot().health?.phase).toBe('unhealthy');

    await engine.recreateRealtimeSession();

    expect(engine.getDiagnosticSnapshot().health).toEqual({
      phase: 'idle',
      generation: 2,
      suspiciousCount: 0,
      lastRatio: null,
      runtimePolicyId: 'default',
    });
    expect(engine.getRecentAudioHealthSamples()).toEqual([]);
  });
});
