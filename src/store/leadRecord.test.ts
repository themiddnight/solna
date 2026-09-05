import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { startLeadRecordBridge, leadClockActive } from './leadRecord';
import { emitNoteInput, resetNoteInputListeners } from '../audio/playback/noteInputBus';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { LeadNote } from '../audio/leadMelody';

let stop: (() => void) | null = null;
// The live clock, faked: the real one needs an AudioContext, and there is
// none in this suite. `liveStep` null means "no running clock".
let liveStep: number | null = null;
let clockRuns = 0;

const deps = {
  inputStep: (): number | null => liveStep,
  startClock: (): (() => void) => {
    clockRuns++;
    return () => {
      clockRuns--;
    };
  },
};

beforeEach(() => {
  liveStep = null;
  clockRuns = 0;
  useAppStore.setState({
    meterId: '4/4',
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadMelodyView: 'chromatic',
    leadMelodyOctave: 3,
    leadCursor: 0,
    leadRecording: true,
    leadPlayer: 'stopped',
    chordsPlayer: 'stopped',
    sequencerPlayer: 'stopped',
    metronomeActive: false,
    scaleRoot: 'C',
    scaleType: 'Major',
  });
  stop = startLeadRecordBridge(deps);
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
const lenAt = (col: number, note: string): number | undefined =>
  useAppStore.getState().leadMelodySteps[col].find((n) => n.note === note)?.len;

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

describe('leadRecord bridge — live capture', () => {
  const play = (): void => {
    useAppStore.setState({ leadPlayer: 'playing' });
  };

  test('while music plays, the note lands on the clock column, not the cursor', () => {
    useAppStore.getState().setLeadCursor(2);
    play();
    liveStep = 9;

    down('C4');

    expect(at(9)).toEqual(['C4']);
    expect(at(2)).toEqual([]);
    // The playhead is the write head; the cursor stays where it was put.
    expect(cursor()).toBe(2);
  });

  test('a held note is extended to the number of steps it was held for', () => {
    play();
    liveStep = 4;
    down('C4');
    liveStep = 8;
    up('C4');

    expect(lenAt(4, 'C4')).toBe(4);
  });

  test('a note still down when the transport stops must not later extend anything', () => {
    play();
    liveStep = 4;
    down('C4');

    useAppStore.setState({ leadPlayer: 'stopped' });

    liveStep = 40;
    up('C4');

    expect(lenAt(4, 'C4')).toBe(1);
  });

  test('a tap stays one step long', () => {
    play();
    liveStep = 4;
    down('C4');
    up('C4');

    expect(lenAt(4, 'C4')).toBe(1);
  });

  test('a key repeat cannot re-date the note-on that is still held', () => {
    play();
    liveStep = 4;
    down('C4');
    liveStep = 6;
    down('C4');
    liveStep = 8;
    up('C4');

    expect(lenAt(4, 'C4')).toBe(4);
  });

  test('disarming Rec mid-hold must not still lengthen the note', () => {
    play();
    liveStep = 4;
    down('C4');

    useAppStore.setState({ leadRecording: false });
    liveStep = 8;
    up('C4');

    expect(lenAt(4, 'C4')).toBe(1);
  });

  test('the clock step wraps into the loop before it becomes a column', () => {
    play();
    liveStep = 37; // 16-column loop: 37 % 16 = 5.

    down('C4');

    expect(at(5)).toEqual(['C4']);
  });

  test('with the clock running but no anchors yet, the cursor is still the write head', () => {
    // liveStep stays null: two anchors have not arrived, so there is nothing
    // to quantise against and the DEV-370 behaviour stands rather than the
    // note being dropped.
    play();
    useAppStore.getState().setLeadCursor(3);

    down('C4');

    expect(at(3)).toEqual(['C4']);
  });

  test('the anchor collector runs exactly while there is music to play along to', () => {
    expect(clockRuns).toBe(0);
    play();
    expect(clockRuns).toBe(1);
    useAppStore.setState({ leadPlayer: 'stopped' });
    expect(clockRuns).toBe(0);

    // Drums alone count: the user is plainly playing along to something, and
    // the old leadPlayer guard called that "stopped".
    useAppStore.setState({ sequencerPlayer: 'playing' });
    expect(clockRuns).toBe(1);
    useAppStore.setState({ sequencerPlayer: 'stopped' });
    expect(clockRuns).toBe(0);

    // So does the metronome — it is the same clock, and it is what a player
    // counts against when nothing else is running.
    useAppStore.setState({ metronomeActive: true });
    expect(clockRuns).toBe(1);
  });

  test('unsubscribing stops the anchor collector too', () => {
    play();
    expect(clockRuns).toBe(1);
    stop?.();
    stop = null;
    expect(clockRuns).toBe(0);
  });
});

describe('leadClockActive', () => {
  type ClockState = Parameters<typeof leadClockActive>[0];
  const clockState = (patch: Partial<ClockState>): ClockState => ({
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    metronomeActive: false,
    ...patch,
  });

  test('is false only when nothing at all is running', () => {
    expect(leadClockActive(clockState({}))).toBe(false);
  });

  test('any single running player is enough', () => {
    expect(leadClockActive(clockState({ leadPlayer: 'playing' }))).toBe(true);
    expect(leadClockActive(clockState({ chordsPlayer: 'playing' }))).toBe(true);
    expect(leadClockActive(clockState({ sequencerPlayer: 'playing' }))).toBe(true);
    expect(leadClockActive(clockState({ metronomeActive: true }))).toBe(true);
  });

  test('a player still stopping still owns the clock', () => {
    expect(leadClockActive(clockState({ leadPlayer: 'stopping' }))).toBe(true);
  });
});
