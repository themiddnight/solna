import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { audioEngine } from '@/audio/engine';
import { beatParamsFromPreset } from '@/store/beatPresets';
import type { BeatParams } from '@/types';
import { createBeatParamDraftMachine, useBeatParamDraft } from './useBeatParamDraft';

/**
 * `previewBeatParams`/`restoreBeatParams` (Task 6) are a frame-coalesced
 * bridge onto `audioEngine`, so — same as `beatPreview.test.ts` — we assert
 * on the engine call it makes rather than mocking the bridge module. One
 * frame of its fallback scheduler (16 ms), with slack.
 */
const FRAME_MS = 40;
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, FRAME_MS));

function paramsWithCutoff(cutoffHz: number): BeatParams {
  const params = beatParamsFromPreset('retro-drive');
  return { ...params, filter: { ...params.filter, cutoff: cutoffHz } };
}

describe('createBeatParamDraftMachine', () => {
  afterEach(async () => {
    // Drain anything a failed expectation left armed, so the next test's
    // first push is a leading edge rather than a trailing one.
    await nextFrame();
  });

  test('update previews the draft but does not commit until commit() is called', () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      const committed = paramsWithCutoff(500);
      const commits: BeatParams[] = [];
      const machine = createBeatParamDraftMachine(committed, 'loop-1');

      machine.update((p) => ({ ...p, filter: { ...p.filter, cutoff: 1200 } }));

      // Leading edge: the preview reaches the engine on the same tick.
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1200]);
      expect(commits.length).toBe(0);
      expect(machine.getDraft().filter.cutoff).toBe(1200);

      machine.commit((params) => commits.push(params));

      expect(commits.length).toBe(1);
      expect(commits[0].filter.cutoff).toBe(1200);
    } finally {
      setBeatFilter.mockRestore();
    }
  });

  test('cancel discards the draft, restores the committed params, and never commits', async () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      const committed = paramsWithCutoff(500);
      let commitCount = 0;
      const machine = createBeatParamDraftMachine(committed, 'loop-1');

      machine.update((p) => ({ ...p, filter: { ...p.filter, cutoff: 1200 } }));
      machine.cancel();

      // 1200 previewed, then the restore lands 500 immediately.
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1200, 500]);
      expect(machine.getDraft().filter.cutoff).toBe(500);

      machine.commit(() => { commitCount += 1; });
      // commit() after cancel() commits the (now-restored) draft — cancel
      // does not itself lock the machine, it only discards THIS gesture's
      // value. The prior gesture never reached commitParams.
      expect(commitCount).toBe(1);
    } finally {
      setBeatFilter.mockRestore();
    }
  });

  test('a committed-prop change replaces the draft when no gesture is active', () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      const first = paramsWithCutoff(500);
      const second = paramsWithCutoff(900);
      const machine = createBeatParamDraftMachine(first, 'loop-1');

      // No gesture open: sync adopts the new committed params immediately.
      machine.sync(second, 'loop-1');
      expect(machine.getDraft().filter.cutoff).toBe(900);
      // Adopting a committed prop is not a preview.
      expect(setBeatFilter).not.toHaveBeenCalled();
    } finally {
      setBeatFilter.mockRestore();
    }
  });

  test('a committed-prop change during an open gesture does NOT clobber the live draft', () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      const first = paramsWithCutoff(500);
      const second = paramsWithCutoff(900);
      const machine = createBeatParamDraftMachine(first, 'loop-1');

      machine.update((p) => ({ ...p, filter: { ...p.filter, cutoff: 1200 } }));
      // A committed value arrives (e.g. another surface writes the store)
      // while this gesture is still dragging.
      machine.sync(second, 'loop-1');

      expect(machine.getDraft().filter.cutoff).toBe(1200);
    } finally {
      setBeatFilter.mockRestore();
    }
  });

  test('an active-loop change cancels an open gesture rather than committing it', () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      const loopOneParams = paramsWithCutoff(500);
      const loopTwoParams = paramsWithCutoff(700);
      let commitCount = 0;
      const machine = createBeatParamDraftMachine(loopOneParams, 'loop-1');

      machine.update((p) => ({ ...p, filter: { ...p.filter, cutoff: 1200 } }));
      // The user switches loops mid-drag.
      machine.sync(loopTwoParams, 'loop-2');

      // The abandoned 1200 preview is dropped and the ARRIVING loop's sound
      // is what the engine is left holding — not loop 1's 500. By the time
      // this render runs, `engineSync` has already installed loop 2's patch,
      // so restoring loop 1's would silently strand the engine a loop behind.
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1200, 700]);
      expect(machine.getDraft().filter.cutoff).toBe(700);

      machine.commit(() => { commitCount += 1; });
      // The abandoned gesture never reached commitParams — the count below
      // is from a FRESH commit call, not the mid-drag one.
      expect(commitCount).toBe(1);
    } finally {
      setBeatFilter.mockRestore();
    }
  });
});

/**
 * Thin React-level smoke test: confirms `useBeatParamDraft` is a live wrapper
 * over `createBeatParamDraftMachine` (calls `sync` every render, exposes the
 * same draft/update/commit/cancel shape) — one render pass is all
 * `renderToString` can give us (see `.claude/rules/testing.md`), so anything
 * that needs a SECOND render observing a prop change is covered by the
 * machine tests above instead, against the exact functions the hook calls.
 */
describe('useBeatParamDraft (React wiring)', () => {
  test('returns the committed params as the initial draft with no gesture open', () => {
    const committed = paramsWithCutoff(500);
    let captured: ReturnType<typeof useBeatParamDraft> | null = null;
    function Probe() {
      captured = useBeatParamDraft(committed, 'loop-1', () => {});
      return null;
    }
    renderToString(<Probe />);
    expect(captured!.draft).toEqual(committed);
  });
});
