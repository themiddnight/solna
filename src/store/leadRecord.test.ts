import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { startLeadRecordBridge } from './leadRecord';
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
  test('a played note is written at the cursor, and the cursor stays put', () => {
    // The cursor belongs to the user; the arrow keys move it. A recorder that
    // walked it forward on its own would fight them for it.
    useAppStore.getState().setLeadCursor(4);

    down('C4');
    up('C4');

    expect(at(4)).toEqual(['C4']);
    expect(cursor()).toBe(4);
  });

  test('notes played together land together, because nothing moves between them', () => {
    down('C4');
    down('E4');
    down('G4');
    up('C4');
    up('E4');
    up('G4');

    expect(at(0)).toEqual(['C4', 'E4', 'G4']);
    expect(cursor()).toBe(0);
  });

  test('a key repeat writes nothing new — drawing over a note already there is a no-op', () => {
    down('C4');
    down('C4');
    down('C4');

    expect(at(0)).toEqual(['C4']);
  });

  test('releases are ignored entirely', () => {
    up('C4');
    expect(at(0)).toEqual([]);
    expect(cursor()).toBe(0);
  });

  test('nothing is captured while disarmed', () => {
    useAppStore.setState({ leadRecording: false });

    down('C4');

    expect(at(0)).toEqual([]);
  });

  test('nothing is captured while the transport plays — that is DEV-374', () => {
    useAppStore.setState({ leadPlayer: 'playing' });

    down('C4');

    expect(at(0)).toEqual([]);
  });

  test('a note the grid cannot show is declined and leaves the melody alone', () => {
    useAppStore.setState({ leadMelodyView: 'scale-locked' });

    down('C#4');

    expect(at(0)).toEqual([]);
  });

  test('unsubscribing stops capture', () => {
    stop?.();
    stop = null;

    down('C4');

    expect(at(0)).toEqual([]);
  });
});
