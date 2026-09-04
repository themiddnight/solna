import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { resetLeadRecordBridge, startLeadRecordBridge } from './leadRecord';
import { emitNoteInput, resetNoteInputListeners } from '../audio/playback/noteInputBus';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { LeadNote } from '../audio/leadMelody';

let stop: (() => void) | null = null;

beforeEach(() => {
  useAppStore.setState({
    meterId: '4/4',
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadMelodyView: 'chromatic',
    leadMelodyOctave: 3,
    leadCursor: 0,
    leadRecording: true,
    leadPlayer: 'stopped',
    scaleRoot: 'C',
    scaleType: 'Major',
  });
  resetLeadRecordBridge();
  stop = startLeadRecordBridge();
});

afterEach(() => {
  stop?.();
  stop = null;
  resetNoteInputListeners();
});

const down = (note: string): void => emitNoteInput({ kind: 'on', note, velocity: 1 });
const up = (note: string): void => emitNoteInput({ kind: 'off', note, velocity: 0 });
const cursor = (): number => useAppStore.getState().leadCursor;
const at = (col: number): string[] =>
  useAppStore.getState().leadMelodySteps[col].map((n) => n.note).sort();

describe('leadRecord bridge', () => {
  test('a played note is written at the cursor and the cursor waits for the release', () => {
    down('C4');
    expect(at(0)).toEqual(['C4']);
    expect(cursor()).toBe(0);

    up('C4');
    expect(cursor()).toBe(1);
  });

  test('a held chord lands in ONE column, and advances once', () => {
    // The reason the advance hangs off the last release rather than the press.
    down('C4');
    down('E4');
    down('G4');
    up('E4');
    up('C4');

    expect(cursor()).toBe(0);

    up('G4');

    expect(at(0)).toEqual(['C4', 'E4', 'G4']);
    expect(cursor()).toBe(1);
  });

  test('successive notes fill successive columns', () => {
    for (const note of ['C4', 'D4', 'E4']) {
      down(note);
      up(note);
    }

    expect([at(0), at(1), at(2)]).toEqual([['C4'], ['D4'], ['E4']]);
    expect(cursor()).toBe(3);
  });

  test('a key repeat does not write twice or advance twice', () => {
    down('C4');
    down('C4');
    down('C4');
    up('C4');

    expect(at(0)).toEqual(['C4']);
    expect(cursor()).toBe(1);
  });

  test('a declined note does not burn a column', () => {
    // Scale-locked has no row for C#, so nothing is written — and a wrong
    // note must not silently eat a step of the bar.
    useAppStore.setState({ leadMelodyView: 'scale-locked' });

    down('C#4');
    up('C#4');

    expect(at(0)).toEqual([]);
    expect(cursor()).toBe(0);
  });

  test('nothing is captured while disarmed', () => {
    useAppStore.setState({ leadRecording: false });

    down('C4');
    up('C4');

    expect(at(0)).toEqual([]);
    expect(cursor()).toBe(0);
  });

  test('disarming mid-hold drops the keys, so the release cannot move the cursor', () => {
    down('C4');
    useAppStore.setState({ leadRecording: false });
    up('C4');
    useAppStore.setState({ leadRecording: true });

    expect(cursor()).toBe(0);
  });

  test('a release with no matching press advances nothing', () => {
    // What arrives when recording is armed with a key already down.
    up('C4');
    expect(cursor()).toBe(0);
  });

  test('the cursor wraps at the loop end', () => {
    useAppStore.getState().setLeadCursor(15);

    down('C4');
    up('C4');

    expect(at(15)).toEqual(['C4']);
    expect(cursor()).toBe(0);
  });

  test('unsubscribing stops capture', () => {
    stop?.();
    stop = null;

    down('C4');
    up('C4');

    expect(at(0)).toEqual([]);
  });
});
