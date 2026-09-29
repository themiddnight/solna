import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { ChordItem } from '@/types';
import { MAX_STEPS_PER_BAR } from '@/utils/timeSignature';
import { chordsSnapshotOf } from './chordsSlice';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { useAppStore } from './store';
import type { ChordsSnapshot } from './types';

const reset = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    meterId: '4/4',
    ...loopStatePatch(loop),
  });
};
beforeEach(reset);
afterEach(reset);

const count = (fn: () => void): number => {
  let n = 0;
  const stop = useAppStore.subscribe(() => {
    n += 1;
  });
  fn();
  stop();
  return n;
};

const ROLLED: ChordItem[] = [
  { id: 'r0', root: 'C', quality: 'maj', bars: 2 },
  { id: 'r1', root: 'G', quality: 'maj', bars: 1 },
];

/** Overwrites all seven restorable fields with values no snapshot of the default loop holds. */
function scribble(): void {
  useAppStore.setState({
    chords: ROLLED,
    customChordRhythm: new Array<boolean>(3 * MAX_STEPS_PER_BAR).fill(true),
    customChordHoldSteps: new Array<number>(3 * MAX_STEPS_PER_BAR).fill(2),
    customChordLoopLength: 3,
    customBassPattern: new Array<BassStepChoice>(3 * MAX_STEPS_PER_BAR).fill('root'),
    customBassHoldSteps: new Array<number>(3 * MAX_STEPS_PER_BAR).fill(2),
    customBassLoopLength: 3,
  });
}

const RESTORED_KEYS = [
  'chords',
  'customChordRhythm',
  'customChordHoldSteps',
  'customChordLoopLength',
  'customBassPattern',
  'customBassHoldSteps',
  'customBassLoopLength',
] as const;

function restorable(snapshot: ChordsSnapshot | ReturnType<typeof useAppStore.getState>) {
  return Object.fromEntries(RESTORED_KEYS.map((key) => [key, snapshot[key]]));
}

describe('chordsSnapshotOf', () => {
  test('captures the loop, key, scale, meter, chords and the six custom-lane fields', () => {
    const s = useAppStore.getState();
    const snapshot = chordsSnapshotOf(s);
    expect(snapshot.loopId).toBe(s.activeLoopId);
    expect(snapshot.scaleRoot).toBe(s.scaleRoot);
    expect(snapshot.scaleType).toBe(s.scaleType);
    expect(snapshot.meterId).toBe(s.meterId);
    expect(restorable(snapshot)).toEqual(restorable(s));
  });
});

describe('restoreChordsSnapshot', () => {
  test('puts all seven fields back exactly, in one notification', () => {
    const snapshot = chordsSnapshotOf(useAppStore.getState());
    scribble();
    const n = count(() => useAppStore.getState().restoreChordsSnapshot(snapshot));
    expect(n).toBe(1);
    expect(restorable(useAppStore.getState())).toEqual(restorable(snapshot));
  });

  test('mirrors the restore into the active loop in loops[]', () => {
    const snapshot = chordsSnapshotOf(useAppStore.getState());
    scribble();
    useAppStore.getState().restoreChordsSnapshot(snapshot);
    const s = useAppStore.getState();
    expect(s.loops.find((l) => l.id === s.activeLoopId)?.chords).toBe(snapshot.chords);
  });

  test('is a no-op, with no notification, once the active loop changed', () => {
    const snapshot = { ...chordsSnapshotOf(useAppStore.getState()), loopId: 'loop-elsewhere' };
    scribble();
    const n = count(() => useAppStore.getState().restoreChordsSnapshot(snapshot));
    expect(n).toBe(0);
    expect(useAppStore.getState().chords).toBe(ROLLED);
  });

  // Addition to the spec: old-key chords must not land in a new key, and holds
  // clamped against one bar length must not land under another.
  test('is a no-op once the key root, scale type or meter changed', () => {
    const snapshot = chordsSnapshotOf(useAppStore.getState());
    const changes = [{ scaleRoot: 'D' }, { scaleType: 'Dorian' }, { meterId: '3/4' as const }];
    for (const change of changes) {
      reset();
      scribble();
      useAppStore.setState(change);
      const n = count(() => useAppStore.getState().restoreChordsSnapshot(snapshot));
      expect(n).toBe(0);
      expect(useAppStore.getState().chords).toBe(ROLLED);
    }
  });
});
