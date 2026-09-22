import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { useAppStore } from './store';
import type { Loop } from './types';

const A = (): Loop => createDefaultLoop(); // active, A Natural Minor
const B = (): Loop => ({ ...createDefaultLoop(), id: 'loop-b', scaleRoot: 'C', scaleType: 'Major' });

const reset = () => {
  const a = A();
  useAppStore.setState({
    loops: [a, B()],
    activeLoopId: a.id,
    ...loopStatePatch(a),
    reharmonizedIndicator: false,
  });
};
beforeEach(reset);
afterEach(reset);

const count = (fn: () => void): number => {
  let n = 0;
  const stop = useAppStore.subscribe(() => { n += 1; });
  fn();
  stop();
  return n;
};

describe('applyLoopKeyChange', () => {
  test('one notification; non-active loops in loops[], active loop through its flat fields', () => {
    let undo = null as ReturnType<ReturnType<typeof useAppStore.getState>['applyLoopKeyChange']>;
    const n = count(() => {
      undo = useAppStore.getState().applyLoopKeyChange(
        ['loop-default-1', 'loop-b'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: true },
      );
    });
    const s = useAppStore.getState();
    expect(n).toBe(1);
    expect(s.scaleRoot).toBe('B');                                   // active, flat
    expect(s.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('D'); // non-active, loops[]
    const active = s.loops.find((l) => l.id === s.activeLoopId)!;
    expect(active.scaleRoot).toBe(s.scaleRoot);
    expect(active.chords).toBe(s.chords);
    expect(s.reharmonizedIndicator).toBe(true);
    expect(undo!.snapshots.map((x) => x.loopId)).toEqual(['loop-default-1', 'loop-b']);
  });

  test('a non-active-only batch leaves the flat fields untouched', () => {
    const before = useAppStore.getState();
    useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'set', root: 'E', scaleType: 'Dorian' }, { harmonizeChords: true });
    const s = useAppStore.getState();
    expect(s.scaleRoot).toBe(before.scaleRoot);
    expect(s.chords).toBe(before.chords);
    expect(s.reharmonizedIndicator).toBe(false);
  });

  test('nothing to change returns null and writes nothing', () => {
    const n = count(() => {
      expect(
        useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'set', root: 'C', scaleType: 'Major' }, { harmonizeChords: true }),
      ).toBeNull();
    });
    expect(n).toBe(0);
  });
});

describe('undoLoopKeyChange', () => {
  test('restores every loop in one notification and clears the badge for the active loop', () => {
    const start = useAppStore.getState();
    const undo = useAppStore.getState().applyLoopKeyChange(
      ['loop-default-1', 'loop-b'], { mode: 'transpose', semitones: 5 }, { harmonizeChords: true },
    )!;
    const n = count(() => useAppStore.getState().undoLoopKeyChange(undo));
    const s = useAppStore.getState();
    expect(n).toBe(1);
    expect(s.scaleRoot).toBe('A');
    expect(s.chords).toBe(start.chords);
    expect(s.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('C');
    expect(s.reharmonizedIndicator).toBe(false);
  });

  test('a loop deleted in between is skipped', () => {
    const undo = useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'transpose', semitones: 1 }, { harmonizeChords: false })!;
    useAppStore.setState({ loops: useAppStore.getState().loops.filter((l) => l.id !== 'loop-b') });
    useAppStore.getState().undoLoopKeyChange(undo);
    expect(useAppStore.getState().loops.map((l) => l.id)).toEqual(['loop-default-1']);
  });

  test('undo leaves fields changeKey never writes alone (a knob moved after the batch survives)', () => {
    const undo = useAppStore.getState().applyLoopKeyChange(['loop-default-1'], { mode: 'transpose', semitones: 1 }, { harmonizeChords: true })!;
    useAppStore.getState().setChordFeel(0.9);
    useAppStore.getState().undoLoopKeyChange(undo);
    expect(useAppStore.getState().chordFeel).toBe(0.9);
  });
});
