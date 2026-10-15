import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { renderMixdown } from './renderMixdown';
import type { MixdownRenderProgress } from './renderResult';
import { mixdownLoop, mixdownSnapshot } from './mixdownFixture';

/**
 * An abort while the render is being prepared is honoured before rendering
 * starts. The walk is performed in windows (ADR-0061), so only the first
 * window is performed before `startRendering()`; the check after it is what
 * catches this abort. Split out of `renderMixdown.test.ts` only because that
 * file already sits at the repo's `max-lines` ceiling — same convention as
 * `renderMixdownMelodyPlan.test.ts`.
 */
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('renderMixdown: cancellation mid-scheduling-walk', () => {
  test('an abort during scheduling (before rendering starts) is honored without completing the walk', async () => {
    const controller = new AbortController();
    const phases: string[] = [];
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
