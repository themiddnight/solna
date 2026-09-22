import { afterEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { createDefaultLoopContent } from './loopDefaults';

const initial = useAppStore.getState();

afterEach(() => {
  useAppStore.setState({
    trackSends: initial.trackSends,
    loops: initial.loops,
    activeLoopId: initial.activeLoopId,
  });
});

describe('trackSends defaults', () => {
  test('every track sends at unity except Beat, dry into delay and distortion; fresh per call', () => {
    const a = createDefaultLoopContent().trackSends;
    const b = createDefaultLoopContent().trackSends;
    const unity = { reverb: 1, delay: 1, distortion: 1 };
    expect(a).toEqual({
      synth: unity, chord: unity, bass: unity, pad: unity, fx: unity,
      sequencer: { reverb: 1, delay: 0, distortion: 0 },
    });
    expect(a).not.toBe(b);
    expect(a.synth).not.toBe(b.synth);
  });
});

describe('setTrackSends', () => {
  test('writes one clamped row and keeps the other five rows by reference', () => {
    const before = useAppStore.getState().trackSends;
    useAppStore.getState().setTrackSends('chord', { reverb: 0.4, delay: 1.5, distortion: -1 });
    const after = useAppStore.getState().trackSends;
    expect(after).not.toBe(before);
    expect(after.chord).toEqual({ reverb: 0.4, delay: 1, distortion: 0 });
    for (const source of ['synth', 'bass', 'pad', 'fx', 'sequencer'] as const) {
      expect(after[source]).toBe(before[source]);
    }
  });

  test('the loop mirror carries the write into the active loop', () => {
    useAppStore.getState().setTrackSends('pad', { reverb: 0.2, delay: 0.3, distortion: 0.4 });
    const s = useAppStore.getState();
    const active = s.loops.find((loop) => loop.id === s.activeLoopId);
    expect(active?.trackSends.pad).toEqual({ reverb: 0.2, delay: 0.3, distortion: 0.4 });
  });

  test('duplicating a loop deep-copies its sends', () => {
    useAppStore.getState().setTrackSends('fx', { reverb: 0.5, delay: 0.5, distortion: 0.5 });
    const sourceId = useAppStore.getState().activeLoopId;
    // duplicateLoop returns null when it auto-activates the clone (the
    // active-loop case here) — read the new activeLoopId instead, the same
    // pattern loopSlice.test.ts uses.
    useAppStore.getState().duplicateLoop(sourceId);
    const copyId = useAppStore.getState().activeLoopId;
    const loops = useAppStore.getState().loops;
    const source = loops.find((loop) => loop.id === sourceId);
    const copy = loops.find((loop) => loop.id === copyId);
    expect(copy?.trackSends).toEqual(source?.trackSends);
    expect(copy?.trackSends).not.toBe(source?.trackSends);
    expect(copy?.trackSends.fx).not.toBe(source?.trackSends.fx);
  });
});
