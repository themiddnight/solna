import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '@/audio/engine';
import type { SourceBusId } from '@/store/sourceBuses';
import type { TrackSendLevels } from '@/types';
import { createTrackSendsDraftMachine } from './useTrackSendsDraft';

const COMMITTED: TrackSendLevels = { reverb: 1, delay: 0.5, distortion: 0 };

function withPreviewSpy(body: (calls: unknown[][]) => void): void {
  const setSourceSends = spyOn(audioEngine, 'setSourceSends').mockImplementation(() => {});
  try {
    body(setSourceSends.mock.calls);
  } finally {
    setSourceSends.mockRestore();
  }
}

describe('createTrackSendsDraftMachine', () => {
  test('onChange drafts and previews that track, and writes nothing', () => {
    withPreviewSpy((calls) => {
      const writes: [SourceBusId, TrackSendLevels][] = [];
      const machine = createTrackSendsDraftMachine(COMMITTED, 'chord');
      machine.onChange('delay', 0.8);
      expect(machine.getDraft()).toEqual({ reverb: 1, delay: 0.8, distortion: 0 });
      expect(calls).toEqual([['chord', { reverb: 1, delay: 0.8, distortion: 0 }]]);
      expect(writes).toEqual([]);
    });
  });

  test('commit writes the draft once, on release', () => {
    withPreviewSpy(() => {
      const writes: [SourceBusId, TrackSendLevels][] = [];
      const write = (source: SourceBusId, sends: TrackSendLevels) => writes.push([source, sends]);
      const machine = createTrackSendsDraftMachine(COMMITTED, 'chord');
      machine.onChange('reverb', 0.25);
      machine.onChange('reverb', 0.3);
      machine.commit(write);
      machine.commit(write);
      expect(writes).toEqual([['chord', { reverb: 0.3, delay: 0.5, distortion: 0 }]]);
    });
  });

  test('a release with no move writes nothing', () => {
    withPreviewSpy(() => {
      const writes: unknown[] = [];
      const machine = createTrackSendsDraftMachine(COMMITTED, 'bass');
      machine.commit((source, sends) => writes.push([source, sends]));
      expect(writes).toEqual([]);
    });
  });

  test('cancel reverts the draft and previews the committed row back', () => {
    withPreviewSpy((calls) => {
      const machine = createTrackSendsDraftMachine(COMMITTED, 'pad');
      machine.onChange('distortion', 0.9);
      machine.cancel();
      expect(machine.getDraft()).toEqual(COMMITTED);
      expect(calls.at(-1)).toEqual(['pad', COMMITTED]);
    });
  });

  test('cancelIfDragging previews only when a gesture is open (unmount mid-drag)', () => {
    withPreviewSpy((calls) => {
      const machine = createTrackSendsDraftMachine(COMMITTED, 'fx');
      machine.cancelIfDragging();
      expect(calls).toEqual([]);
      machine.onChange('reverb', 0.1);
      machine.cancelIfDragging();
      expect(calls.at(-1)).toEqual(['fx', COMMITTED]);
    });
  });

  test('a mid-drag re-render with the same committed row keeps the draft', () => {
    withPreviewSpy(() => {
      const machine = createTrackSendsDraftMachine(COMMITTED, 'synth');
      machine.onChange('delay', 0.1);
      machine.sync(COMMITTED);
      expect(machine.getDraft().delay).toBe(0.1);
    });
  });

  test('a committed row that changes mid-drag (song seam) drops the gesture: nothing stale is written', () => {
    withPreviewSpy((calls) => {
      const writes: [SourceBusId, TrackSendLevels][] = [];
      const write = (source: SourceBusId, sends: TrackSendLevels) => writes.push([source, sends]);
      const machine = createTrackSendsDraftMachine(COMMITTED, 'chord');
      machine.onChange('delay', 0.8);
      const nextLoop: TrackSendLevels = { reverb: 0.2, delay: 0.1, distortion: 0.6 };
      machine.sync(nextLoop);
      // engineSync already pushed the new loop's row; the drop previews nothing.
      expect(calls).toEqual([['chord', { reverb: 1, delay: 0.8, distortion: 0 }]]);
      expect(machine.getDraft()).toBe(nextLoop);
      machine.commit(write);
      expect(writes).toEqual([]);
    });
  });

  test('a move after the drop starts a fresh gesture from the new loop row', () => {
    withPreviewSpy(() => {
      const writes: [SourceBusId, TrackSendLevels][] = [];
      const machine = createTrackSendsDraftMachine(COMMITTED, 'chord');
      machine.onChange('delay', 0.8);
      machine.sync({ reverb: 0.2, delay: 0.1, distortion: 0.6 });
      machine.onChange('delay', 0.9);
      machine.commit((source, sends) => writes.push([source, sends]));
      expect(writes).toEqual([['chord', { reverb: 0.2, delay: 0.9, distortion: 0.6 }]]);
    });
  });
});
