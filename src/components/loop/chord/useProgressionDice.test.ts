import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { mulberry32 } from '@/audio/rng';
import { buildLoopUndoRequest } from '@/components/useLoopUndo';
import { chordsSnapshotOf } from '@/store/chordsSlice';
import { loopStatePatch } from '@/store/loop';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import type { ChordItem } from '@/types';
import {
  ROLL_UNDO_KEY,
  performRoll,
  planRoll,
  restoreRoll,
  rollUndoMessage,
  useProgressionDice,
  type RollOptions,
  type RollUndo,
  type UseProgressionDice,
} from './useProgressionDice';

const KEEP: RollOptions = { chordCount: 'keep', barsPerChord: 1, allowBorrowed: false, use7ths: false };

const reset = () => {
  const loop = createDefaultLoop();
  useAppStore.getState().dismissFeedback(ROLL_UNDO_KEY);
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    meterId: '4/4',
    reharmonizedIndicator: false,
    ...loopStatePatch(loop),
  });
};
beforeEach(reset);
afterEach(reset);

/** The hook's own offer, minus the React lifetime: `useLoopUndo`'s `offer` is exactly this call. */
const offerUndo = (undo: RollUndo) =>
  useAppStore
    .getState()
    .showFeedback(buildLoopUndoRequest(restoreRoll, ROLL_UNDO_KEY, rollUndoMessage, undo));

const pendingUndos = () => useAppStore.getState().feedback.filter((e) => e.key === ROLL_UNDO_KEY);

const lanes = () => {
  const { chords, customChordRhythm, customChordHoldSteps, customChordLoopLength, customBassPattern, customBassHoldSteps, customBassLoopLength } =
    useAppStore.getState();
  return { chords, customChordRhythm, customChordHoldSteps, customChordLoopLength, customBassPattern, customBassHoldSteps, customBassLoopLength };
};

describe('planRoll', () => {
  test('an empty loop rolled with Keep gets four chords of one bar', () => {
    const state = { ...useAppStore.getState(), chords: [] as ChordItem[] };
    const plan = planRoll(state, KEEP, mulberry32(1), 1000);
    expect(plan.chords.map((c) => c.bars)).toEqual([1, 1, 1, 1]);
  });

  test('Keep keeps the count and each chord’s bars; a count overrides both', () => {
    const state = useAppStore.getState();
    const kept = planRoll(state, KEEP, mulberry32(2), 1000);
    expect(kept.chords.map((c) => c.bars)).toEqual(state.chords.map((c) => c.bars));
    const six = planRoll(state, { ...KEEP, chordCount: 6, barsPerChord: 2 }, mulberry32(2), 1000);
    expect(six.chords.map((c) => c.bars)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  test('re-ids with the library-apply pattern and snapshots the state it read', () => {
    const state = useAppStore.getState();
    const plan = planRoll(state, KEEP, mulberry32(3), 1234);
    expect(plan.chords.map((c) => c.id)).toEqual(state.chords.map((_, i) => `roll-chord-1234-${i}`));
    expect(plan.snapshot).toEqual(chordsSnapshotOf(state));
  });
});

describe('performRoll', () => {
  test('writes the chords, clears the badge, then offers an Undo named after the roll', () => {
    const calls: string[] = [];
    const offered: RollUndo[] = [];
    const plan = performRoll(KEEP, mulberry32(4), 1000, () => calls.push('clear'), (undo) => {
      calls.push('offer');
      offered.push(undo);
    });
    expect(calls).toEqual(['clear', 'offer']);
    expect(offered).toEqual([{ snapshot: plan.snapshot, roman: plan.roman }]);
    expect(useAppStore.getState().chords).toEqual(plan.chords);
    expect(rollUndoMessage({ snapshot: plan.snapshot, roman: 'I–V–vi–IV' })).toBe('Randomized I–V–vi–IV');
  });

  test('Undo restores the exact pre-roll chords and custom lanes', () => {
    const before = lanes();
    performRoll({ ...KEEP, chordCount: 3, barsPerChord: 2 }, mulberry32(5), 1000, () => {}, offerUndo);
    expect(lanes()).not.toEqual(before);
    useAppStore.getState().runFeedbackAction(ROLL_UNDO_KEY);
    expect(lanes()).toEqual(before);
  });

  test('two rolls in a row: one pending Undo, and it restores the state before the SECOND roll', () => {
    performRoll(KEEP, mulberry32(6), 1000, () => {}, offerUndo);
    const afterFirst = lanes();
    performRoll({ ...KEEP, chordCount: 6 }, mulberry32(7), 2000, () => {}, offerUndo);
    expect(pendingUndos()).toHaveLength(1);
    useAppStore.getState().runFeedbackAction(ROLL_UNDO_KEY);
    expect(lanes()).toEqual(afterFirst);
  });

  test('Undo after a key change puts nothing back (old-key chords never land in the new key)', () => {
    performRoll(KEEP, mulberry32(8), 1000, () => {}, offerUndo);
    const rolled = useAppStore.getState().chords;
    useAppStore.setState({ scaleRoot: 'D' });
    useAppStore.getState().runFeedbackAction(ROLL_UNDO_KEY);
    expect(useAppStore.getState().chords).toBe(rolled);
  });
});

describe('useProgressionDice', () => {
  let dice: UseProgressionDice | null = null;
  let cleared = 0;
  function Probe() {
    dice = useProgressionDice(false, () => {
      cleared += 1;
    });
    return null;
  }

  test('defaults: Keep, 1 bar, borrowed off, popup closed', () => {
    renderToString(createElement(Probe));
    expect(dice!.chordCount).toBe('keep');
    expect(dice!.barsPerChord).toBe(1);
    expect(dice!.allowBorrowed).toBe(false);
    expect(dice!.optionsOpen).toBe(false);
    expect(dice!.borrowedAvailable).toBe(true);
  });

  test('roll() rolls the live store, clears the badge and raises the Undo snackbar', () => {
    renderToString(createElement(Probe));
    const before = useAppStore.getState().chords;
    cleared = 0;
    dice!.roll();
    const after = useAppStore.getState().chords;
    expect(after).not.toBe(before);
    expect(after.map((c) => c.bars)).toEqual(before.map((c) => c.bars));
    expect(cleared).toBe(1);
    const [entry] = pendingUndos();
    expect(entry.message.startsWith('Randomized ')).toBe(true);
    expect(entry.action?.id).toBe('btn-undo-roll-progression');
  });
});
