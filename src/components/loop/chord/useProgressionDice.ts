import { useEffect, useMemo, useState } from 'react';
import { chordsSnapshotOf } from '@/store/chordsSlice';
import { useAppStore } from '@/store/store';
import type { ChordsSnapshot } from '@/store/types';
import type { ChordItem } from '@/types';
import { getBorrowedChords } from '@/utils/musicTheory';
import { useLoopUndo } from '@/components/useLoopUndo';
import {
  generateProgression,
  resolveBars,
  type RollBarsPerChord,
  type RollChordCount,
} from './markovProgression';

/** The Undo snackbar's feedback key, which is also its button's DOM id. */
export const ROLL_UNDO_KEY = 'btn-undo-roll-progression';
/** The info toast a roll raises when no other progression fits the key. */
export const ROLL_UNCHANGED_KEY = 'roll-progression-unchanged';

export interface RollOptions {
  chordCount: RollChordCount;
  barsPerChord: RollBarsPerChord;
  allowBorrowed: boolean;
  /** Quick Add's 7ths toggle (`use7thsInQuickAdd`); borrowed chords ignore it. */
  use7ths: boolean;
}

/** The Undo offer's payload: what to put back, and the roll it names. */
export interface RollUndo {
  snapshot: ChordsSnapshot;
  roman: string;
}

export interface RollPlan {
  /** Re-idded `roll-chord-<now>-<i>`, the library-apply pattern. */
  chords: ChordItem[];
  roman: string;
  /** Taken BEFORE the write, from the same state the roll read. */
  snapshot: ChordsSnapshot;
}

type RollSource = Parameters<typeof chordsSnapshotOf>[0];

/**
 * The roll, pure: generate from `state`'s key and chords, re-id the result,
 * and snapshot what it will replace. No store, no clock, no randomness of
 * its own — `rng` and `now` come in.
 */
export function planRoll(state: RollSource, options: RollOptions, rng: () => number, now: number): RollPlan {
  const generated = generateProgression(
    {
      scaleRoot: state.scaleRoot,
      scaleType: state.scaleType,
      use7ths: options.use7ths,
      allowBorrowed: options.allowBorrowed,
      bars: resolveBars(options.chordCount, options.barsPerChord, state.chords),
      current: state.chords,
    },
    rng,
  );
  return {
    chords: generated.chords.map((c, i) => ({ ...c, id: `roll-chord-${now}-${i}` })),
    roman: generated.roman,
    snapshot: chordsSnapshotOf(state),
  };
}

/** Module-level, per `useLoopUndo`'s stability contract. */
export const restoreRoll = (undo: RollUndo): void =>
  useAppStore.getState().restoreChordsSnapshot(undo.snapshot);

/** Module-level, per `useLoopUndo`'s stability contract. */
export const rollUndoMessage = (undo: RollUndo): string => `Randomized ${undo.roman}`;

/** Would writing `next` leave the progression exactly as it is (roots, qualities and bars)? */
function sameProgression(next: readonly ChordItem[], current: readonly ChordItem[]): boolean {
  return (
    next.length === current.length &&
    next.every((c, i) => c.root === current[i].root && c.quality === current[i].quality && c.bars === current[i].bars)
  );
}

/**
 * One roll against the live store, through the library-apply path (R362):
 * `setChords` with fresh ids, then `clearReharmonizeBadge()`, then the Undo
 * offer. Outside React so a test drives it without a render. When the
 * generator's fallback could only return the current progression (a
 * one-chord tonic loop in Lydian Augmented or Whole Tone without borrowed
 * chords), it writes nothing, offers no Undo, raises an info toast and
 * returns null.
 */
export function performRoll(
  options: RollOptions,
  rng: () => number,
  now: number,
  clearReharmonizeBadge: () => void,
  offer: (undo: RollUndo) => void,
): RollPlan | null {
  const store = useAppStore.getState();
  const plan = planRoll(store, options, rng, now);
  if (sameProgression(plan.chords, store.chords)) {
    store.showFeedback({ key: ROLL_UNCHANGED_KEY, message: 'No other progression fits this key', tone: 'info' });
    return null;
  }
  store.setChords(plan.chords);
  clearReharmonizeBadge();
  offer({ snapshot: plan.snapshot, roman: plan.roman });
  return plan;
}

/**
 * Dismisses a pending roll Undo once the active loop, key, scale or meter
 * changes: `restoreChordsSnapshot` would refuse it then (R363), so the button
 * would do nothing. A plain store subscription, testable outside React;
 * returns the unsubscribe.
 */
export function subscribeRollUndoDismissOnContextChange(): () => void {
  return useAppStore.subscribe(
    (s) => `${s.activeLoopId}|${s.scaleRoot}|${s.scaleType}|${s.meterId}`,
    () => useAppStore.getState().dismissFeedback(ROLL_UNDO_KEY),
  );
}

export interface UseProgressionDice {
  chordCount: RollChordCount;
  setChordCount: (count: RollChordCount) => void;
  barsPerChord: RollBarsPerChord;
  setBarsPerChord: (bars: RollBarsPerChord) => void;
  allowBorrowed: boolean;
  setAllowBorrowed: (allow: boolean) => void;
  /** False when the scale's borrowed list is empty; the toggle is then disabled. */
  borrowedAvailable: boolean;
  optionsOpen: boolean;
  toggleOptions: () => void;
  closeOptions: () => void;
  /** Rolls with the current options. */
  roll: () => void;
  /** The popup's own Random: closes it, then rolls. */
  rollFromOptions: () => void;
}

/**
 * The Roll dice's state and action. The options are local state: they last
 * the session because views stay mounted (R014), reset on a layout switch
 * (R316) and a reload, and are never persisted. `use7ths` is Quick Add's
 * toggle, local to `useProgressionEditor`, hence a parameter.
 */
export function useProgressionDice(use7ths: boolean, clearReharmonizeBadge: () => void): UseProgressionDice {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const [chordCount, setChordCount] = useState<RollChordCount>('keep');
  const [barsPerChord, setBarsPerChord] = useState<RollBarsPerChord>(1);
  const [allowBorrowed, setAllowBorrowed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const borrowedAvailable = useMemo(
    () => getBorrowedChords(scaleRoot, scaleType).length > 0,
    [scaleRoot, scaleType],
  );
  const { offer } = useLoopUndo(restoreRoll, ROLL_UNDO_KEY, rollUndoMessage);
  useEffect(subscribeRollUndoDismissOnContextChange, []);

  const roll = () => {
    const options = { chordCount, barsPerChord, allowBorrowed: allowBorrowed && borrowedAvailable, use7ths };
    performRoll(options, Math.random, Date.now(), clearReharmonizeBadge, offer);
  };

  return {
    chordCount,
    setChordCount,
    barsPerChord,
    setBarsPerChord,
    allowBorrowed,
    setAllowBorrowed,
    borrowedAvailable,
    optionsOpen,
    toggleOptions: () => setOptionsOpen((open) => !open),
    closeOptions: () => setOptionsOpen(false),
    roll,
    rollFromOptions: () => {
      setOptionsOpen(false);
      roll();
    },
  };
}
