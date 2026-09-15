import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '@/audio/engine';
import type { BeatParams } from '@/types';
import { beatParamsFromPreset } from './beatPresets';
import { useAppStore } from './store';
import { previewBeatParams, restoreBeatParams } from './beatPreview';

/** One frame of the coalescer's fallback scheduler (16 ms), with slack. */
const FRAME_MS = 40;
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, FRAME_MS));

function paramsWithCutoff(cutoffHz: number): BeatParams {
  const params = beatParamsFromPreset('retro-drive');
  return { ...params, filter: { ...params.filter, cutoff: cutoffHz } };
}

describe('the Beat preview bridge', () => {
  afterEach(async () => {
    // Drain anything a failed expectation left armed, so the next test's
    // first push is a leading edge rather than a trailing one.
    await nextFrame();
  });

  test('repeated previews inside one frame apply only the latest params', async () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      previewBeatParams(paramsWithCutoff(1000));
      previewBeatParams(paramsWithCutoff(2000));
      previewBeatParams(paramsWithCutoff(3000));

      // Leading edge: the first value is not deferred.
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1000]);

      await nextFrame();

      // …and the frame applies the LATEST, never the intermediate 2000.
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1000, 3000]);
    } finally {
      setBeatFilter.mockRestore();
    }
  });

  test('restore is immediate and drops the preview the frame was still holding', async () => {
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    try {
      const committed = paramsWithCutoff(500);
      previewBeatParams(paramsWithCutoff(1000));
      previewBeatParams(paramsWithCutoff(2000));

      restoreBeatParams(committed);
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1000, 500]);

      await nextFrame();

      // A cancel that only cleared the queue would still let 2000 land here.
      expect(setBeatFilter.mock.calls.map((call) => call[0])).toEqual([1000, 500]);
    } finally {
      setBeatFilter.mockRestore();
    }
  });

  test('a preview installs the whole patch — voices and trim, not only the filter', () => {
    const setDrumKit = spyOn(audioEngine, 'setDrumKit').mockClear();
    try {
      const params = paramsWithCutoff(1000);
      previewBeatParams(params);
      expect(setDrumKit).toHaveBeenCalledWith(params.voices, params.outputTrimDb);
    } finally {
      setDrumKit.mockRestore();
    }
  });

  /**
   * The whole point of a preview: it is transient audio, so it must not reach
   * persisted state. A `set()` here would re-serialise the loop on every
   * pointer move and make a cancelled drag undoable-by-nothing.
   */
  test('neither preview nor restore writes the store', async () => {
    let writes = 0;
    const unsubscribe = useAppStore.subscribe(() => { writes += 1; });
    try {
      previewBeatParams(paramsWithCutoff(1000));
      previewBeatParams(paramsWithCutoff(2000));
      await nextFrame();
      restoreBeatParams(paramsWithCutoff(500));
      expect(writes).toBe(0);
    } finally {
      unsubscribe();
    }
  });
});
