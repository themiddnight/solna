import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { renderMixdown, type MixdownRenderProgress } from './renderMixdown';
import { mixdownLoop, mixdownSnapshot } from './mixdownFixture';

/**
 * Task 3 (perf/audio-engine-fixes): `scheduleArrangement` now yields
 * periodically and checks the abort signal mid-walk, instead of running the
 * whole arrangement synchronously and checking cancellation only before
 * scheduling starts and after `startRendering()` finishes. Split out of
 * `renderMixdown.test.ts` only because that file already sits at the repo's
 * `max-lines` ceiling — same convention as `renderMixdownMelodyPlan.test.ts`.
 */
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('renderMixdown: cancellation mid-scheduling-walk', () => {
  test('an abort during scheduling (before rendering starts) is honored without completing the walk', async () => {
    const controller = new AbortController();
    const phases: string[] = [];
    // repeatCount 40 pushes dwellSteps to 640 (16 steps/bar * 40), comfortably
    // past SCHEDULE_YIELD_INTERVAL_STEPS (200) so the walk crosses at least
    // one yield/abort checkpoint before it could possibly finish.
    const snapshot = mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 40 })] });
    const onProgress = (progress: MixdownRenderProgress) => {
      phases.push(progress.phase);
      if (progress.phase === 'preparing') controller.abort();
    };

    const result = await renderMixdown(snapshot, onProgress, controller.signal);

    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
    expect(phases).not.toContain('rendering');
  });
});
