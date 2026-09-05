import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore, partializeAppState } from './store';
import { loadLoop } from './loadLoop';
import { getMeter } from '../utils/meter';
import {
  DEFAULT_LEAD_STEP_RESOLUTION,
  LEAD_TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
} from '../utils/stepResolution';
import { DEFAULT_LEAD_GATE, leadStoredIndexAt, type LeadNote } from '../audio/leadMelody';

// The melody stores 1/32 TICKS, so a stored index is not a grid column and a
// one-cell note is not len 1. Both are spelled out here rather than as bare
// numbers, because every fixture below is authored at the 1/16 grid.
const CELL = TICKS_PER_SIXTEENTH;

function resetLead(): void {
  useAppStore.setState({
    meterId: '4/4',
    leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    leadCursor: 0,
    leadBarClipboard: null,
    leadRecording: false,
    leadPlayer: 'stopped',
    // Every other lead field is reset here; leaving this one out let a
    // resolution set in one describe leak into the next, which is an
    // order-dependence trap even while no test relies on it.
    leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    scaleRoot: 'C',
    scaleType: 'Major',
  });
}

describe('lead slice — defaults', () => {
  beforeEach(resetLead);
  test('starts with a silent 1-bar melody, scale-locked view, octave 3', () => {
    const s = useAppStore.getState();
    expect(s.leadLoopLength).toBe(1);
    expect(s.leadMelodyView).toBe('scale-locked');
    expect(s.leadMelodyOctave).toBe(3);
    expect(s.leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
    expect(s.leadMelodySteps.every((row) => row.length === 0)).toBe(true);
  });
});

describe('lead slice — toggleLeadNote', () => {
  beforeEach(resetLead);
  test('adds a note to an empty step and removes it on a second toggle', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
    s.toggleLeadNote(0, 'E4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([
      { note: 'C4', len: CELL },
      { note: 'E4', len: CELL },
    ]);
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'E4', len: CELL }]);
  });
});

describe('lead slice — LeadNote shape', () => {
  beforeEach(resetLead);
  test('toggleLeadNote creates a one-cell note object, not a bare string', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('toggling the same note again removes it', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('a second note on the same step appends without disturbing the first', () => {
    useAppStore.getState().toggleLeadNote(6, 'C4'); // column 3 -> stored tick 6
    useAppStore.getState().toggleLeadNote(6, 'G4');
    expect(useAppStore.getState().leadMelodySteps[6]).toEqual([
      { note: 'C4', len: CELL },
      { note: 'G4', len: CELL },
    ]);
  });
});

describe('lead slice — setLeadLoopLength resizes by whole bars', () => {
  beforeEach(resetLead);
  test('growing pads empty bars; shrinking trims trailing bars', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2); // grow → 96 ticks, bar 0 keeps C4, bar 1 padded empty
    const grown = useAppStore.getState();
    expect(grown.leadLoopLength).toBe(2);
    expect(grown.leadMelodySteps).toHaveLength(96);
    expect(grown.leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
    expect(grown.leadMelodySteps[48]).toEqual([]);

    grown.toggleLeadNote(48, 'E4'); // bar 1 tick 0
    useAppStore.getState().setLeadLoopLength(1); // shrink → 48 ticks, bar 1 dropped
    const shrunk = useAppStore.getState();
    expect(shrunk.leadLoopLength).toBe(1);
    expect(shrunk.leadMelodySteps).toHaveLength(48);
    expect(shrunk.leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('setLeadLoopLengthPreserve lowers the loop length without trimming the grid', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2); // grow to 96 ticks
    useAppStore.getState().toggleLeadNote(48, 'E4'); // bar 1 tick 0
    useAppStore.getState().setLeadLoopLengthPreserve(1);
    const clamped = useAppStore.getState();
    expect(clamped.leadLoopLength).toBe(1);
    // The drawn bar-1 note survives dormant and returns if the length is raised.
    expect(clamped.leadMelodySteps).toHaveLength(96);
    expect(clamped.leadMelodySteps[48]).toEqual([{ note: 'E4', len: CELL }]);
    useAppStore.getState().setLeadLoopLength(2);
    const restored = useAppStore.getState();
    expect(restored.leadMelodySteps[48]).toEqual([{ note: 'E4', len: CELL }]);
  });

  test('setLeadNoteLength refuses a DORMANT slot rather than clamping against a fictitious position', () => {
    // 4/4 cannot reach tick 36 of a 48-tick bar, so there is no loop-end to
    // measure invariant 2 against. Unreachable from today's callers (the grid
    // renders active columns only), but the melody must survive untouched —
    // the same rule resizeLeadMelody follows.
    useAppStore.getState().toggleLeadNote(36, 'G4');
    const before = useAppStore.getState().leadMelodySteps;
    useAppStore.getState().setLeadNoteLength(36, 'G4', 8);
    expect(useAppStore.getState().leadMelodySteps).toBe(before);
    expect(useAppStore.getState().leadMelodySteps[36]).toEqual([{ note: 'G4', len: CELL }]);
  });

  test('toggling a DORMANT slot toggles it in place, not through another bar', () => {
    useAppStore.getState().toggleLeadNote(36, 'G4');
    expect(useAppStore.getState().leadMelodySteps[36]).toEqual([{ note: 'G4', len: CELL }]);
    useAppStore.getState().toggleLeadNote(36, 'G4');
    expect(useAppStore.getState().leadMelodySteps[36]).toEqual([]);
  });

  test('a meter change never touches the stored melody (non-destructive)', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(36, 'G4'); // tick 36 visible in 12/8 (48), hidden in 4/4 (32)
    s.setMeter('4/4');
    expect(useAppStore.getState().leadMelodySteps[36]).toEqual([{ note: 'G4', len: CELL }]);
    expect(useAppStore.getState().leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
    s.setMeter('12/8');
    expect(useAppStore.getState().leadMelodySteps[36]).toEqual([{ note: 'G4', len: CELL }]);
  });
});

describe('lead slice — persistence', () => {
  beforeEach(resetLead);
  test('leadMelodySteps and leadLoopLength are persisted inside the active loop', () => {
    // v6: per-loop fields persist inside loops[activeLoopId], kept fresh by
    // the live-write sync-back folded into the store's own set() (loopSync).
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2);
    const persisted = partializeAppState(useAppStore.getState());
    const loop = persisted.loops.find((r) => r.id === persisted.activeLoopId)!;
    expect(loop.leadMelodySteps).toEqual(useAppStore.getState().leadMelodySteps);
    expect(loop.leadLoopLength).toBe(2);
  });

  test('the octave window and view mode persist inside the active loop', () => {
    const s = useAppStore.getState();
    s.setLeadMelodyOctave(5);
    s.setLeadMelodyView('chromatic');
    const persisted = partializeAppState(useAppStore.getState());
    const loop = persisted.loops.find((r) => r.id === persisted.activeLoopId)!;
    expect(loop.leadMelodyOctave).toBe(5);
    expect(loop.leadMelodyView).toBe('chromatic');
  });

  test('each loop keeps its own octave window across a loop switch', () => {
    const first = useAppStore.getState().activeLoopId;
    useAppStore.getState().setLeadMelodyOctave(2);
    const second = useAppStore.getState().addLoop();
    loadLoop(second);
    useAppStore.getState().setLeadMelodyOctave(5);
    useAppStore.getState().setLeadMelodyView('chromatic');

    loadLoop(first);
    expect(useAppStore.getState().leadMelodyOctave).toBe(2);
    expect(useAppStore.getState().leadMelodyView).toBe('scale-locked');

    loadLoop(second);
    expect(useAppStore.getState().leadMelodyOctave).toBe(5);
    expect(useAppStore.getState().leadMelodyView).toBe('chromatic');
  });

  test('leadPlayer stays transient, and no per-loop lead field leaks top-level', () => {
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('leadPlayer' in persisted).toBe(false);
    expect('leadMelodyView' in persisted).toBe(false);
    expect('leadMelodyOctave' in persisted).toBe(false);
  });
});

describe('lead slice — leadGate', () => {
  beforeEach(() => {
    resetLead();
    useAppStore.setState({ leadGate: DEFAULT_LEAD_GATE });
  });

  test('defaults to DEFAULT_LEAD_GATE, which is exactly the retired fixed gate', () => {
    expect(DEFAULT_LEAD_GATE).toBe(0.85);
    expect(useAppStore.getState().leadGate).toBe(0.85);
  });

  test('clamps to the 0.05 floor so a note can never be silent', () => {
    useAppStore.getState().setLeadGate(0);
    expect(useAppStore.getState().leadGate).toBe(0.05);
    useAppStore.getState().setLeadGate(-3);
    expect(useAppStore.getState().leadGate).toBe(0.05);
  });

  test('clamps to the 1.0 ceiling so a note never overlaps the next step', () => {
    useAppStore.getState().setLeadGate(1.4);
    expect(useAppStore.getState().leadGate).toBe(1);
  });

  test('keeps a value inside the range and rejects a non-finite one', () => {
    useAppStore.getState().setLeadGate(0.5);
    expect(useAppStore.getState().leadGate).toBe(0.5);
    useAppStore.getState().setLeadGate(Number.NaN);
    expect(useAppStore.getState().leadGate).toBe(DEFAULT_LEAD_GATE);
  });
});

describe('setLeadNoteLength — invariant 1: same-row overlap swallows', () => {
  beforeEach(resetLead);

  test('extending over a note on the same pitch row removes the covered note', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.toggleLeadNote(4, 'C4'); // column 2 -> stored tick 4
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 * CELL }]);
    expect(melody[4]).toEqual([]);
  });

  test('a note on a DIFFERENT pitch row inside the span survives', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.toggleLeadNote(4, 'G4'); // column 2 -> stored tick 4
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 * CELL }]);
    expect(melody[4]).toEqual([{ note: 'G4', len: CELL }]);
  });

  test('the swallow walks TICKS — an off-grid note of the same pitch is eaten too', () => {
    // Tick 3 is odd, so the 1/16 grid cannot reach it and only a
    // 1/32-authored melody can put a note there. A swallow that walked
    // CELLS would leave it alive underneath the longer note, and two C4s
    // would sound on the same span the moment the loop is read at 1/32 —
    // exactly what invariant 1 exists to forbid. "Quiet, not gone" protects
    // a change of VIEW; it never protects stored content from an explicit
    // edit, and dragging a note over something IS an explicit edit.
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    useAppStore.setState({
      leadMelodySteps: useAppStore.getState().leadMelodySteps.map((r, i) => {
        if (i === 3) return [{ note: 'C4', len: 1 }];
        if (i === 5) return [{ note: 'G4', len: 1 }];
        return r;
      }),
    });
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 * CELL }]);
    expect(melody[3]).toEqual([]);
    // Still per pitch row: another pitch on an off-grid tick is untouched.
    expect(melody[5]).toEqual([{ note: 'G4', len: 1 }]);
  });

  test('shrinking a note leaves the steps it no longer covers empty', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().setLeadNoteLength(0, 'C4', CELL);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: CELL }]);
    expect(melody[2]).toEqual([]);
    expect(melody[6]).toEqual([]);
  });
});

describe('setLeadNoteLength — invariant 2: never crosses the loop end', () => {
  beforeEach(resetLead);

  test('a length that would overhang is clamped on write', () => {
    // 4/4, 1 bar: the loop ends at tick 32, so a note at tick 28 (column 14)
    // caps at 4 ticks — two cells.
    useAppStore.getState().toggleLeadNote(28, 'C4');
    useAppStore.getState().setLeadNoteLength(28, 'C4', 6 * CELL);
    expect(useAppStore.getState().leadMelodySteps[28]).toEqual([{ note: 'C4', len: 2 * CELL }]);
  });

  test('the last column of the loop caps at one cell', () => {
    useAppStore.getState().toggleLeadNote(30, 'C4');
    useAppStore.getState().setLeadNoteLength(30, 'C4', 9 * CELL);
    expect(useAppStore.getState().leadMelodySteps[30]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('a two-bar loop lets a note cross the bar line', () => {
    useAppStore.setState({ leadLoopLength: 2 });
    useAppStore.getState().toggleLeadNote(30, 'C4');
    useAppStore.getState().setLeadNoteLength(30, 'C4', 4 * CELL);
    expect(useAppStore.getState().leadMelodySteps[30]).toEqual([{ note: 'C4', len: 4 * CELL }]);
  });
});

describe('setLeadNoteLength — invariant 3: len is an integer >= 1', () => {
  beforeEach(resetLead);

  test('zero and negative lengths clamp to ONE CELL, not one tick', () => {
    // "The editor writes whole cells" — a setter that could floor to a
    // single tick would let the drag handle create a note a fraction of a
    // cell long, which the grid could then neither draw nor resize.
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 0);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
    useAppStore.getState().setLeadNoteLength(0, 'C4', -5);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('a fractional length rounds', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 2.6);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 3 }]);
  });

  test('a step/note pair that names no drawn note is a no-op', () => {
    const before = useAppStore.getState().leadMelodySteps;
    useAppStore.getState().setLeadNoteLength(4, 'A4', 3);
    expect(useAppStore.getState().leadMelodySteps).toBe(before);
  });

  test('a non-finite length rejects, leaving the note one cell long', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', Number.NaN);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
  });
});

describe('toggleLeadNote — a click on a covered cell removes the covering note', () => {
  beforeEach(resetLead);

  test('clicking the MIDDLE of a long note removes it entirely', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().toggleLeadNote(4, 'C4'); // column 2, mid-span

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([]);
    expect(melody[4]).toEqual([]);
  });

  test('clicking the START step of a long note removes it entirely', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('clicking the LAST cell of a long note removes it entirely', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().toggleLeadNote(6, 'C4'); // column 3, the last cell
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('a covered click leaves notes in OTHER pitch rows untouched', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().toggleLeadNote(4, 'G4');
    useAppStore.getState().toggleLeadNote(4, 'C4');

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([]);
    expect(melody[4]).toEqual([{ note: 'G4', len: CELL }]);
  });

  test('clicking an UNCOVERED cell still creates a one-cell note', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().toggleLeadNote(8, 'C4'); // column 4, just past the span

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 * CELL }]);
    expect(melody[8]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('a note held across the bar line is removed from its start index', () => {
    useAppStore.setState({ leadLoopLength: 2 });
    useAppStore.getState().toggleLeadNote(30, 'C4');
    useAppStore.getState().setLeadNoteLength(30, 'C4', 4 * CELL);
    // Loop column 17 is bar 1 column 1 -> stored 50, but the note lives at 30.
    useAppStore.getState().toggleLeadNote(50, 'C4');
    expect(useAppStore.getState().leadMelodySteps[30]).toEqual([]);
  });
});

describe('lead slice — paintLeadNote', () => {
  beforeEach(resetLead);

  test("draw adds a note; erase on the same cell takes it away", () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
    useAppStore.getState().paintLeadNote(0, 'C4', 'erase');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('draw is IDEMPOTENT — a stroke that crosses its own note leaves one note, not two', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().paintLeadNote(0, 'C4', 'draw');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('erase on an empty cell is a no-op, so a stroke over a gap does not toggle notes on', () => {
    useAppStore.getState().paintLeadNote(5, 'C4', 'erase');
    expect(useAppStore.getState().leadMelodySteps[5]).toEqual([]);
  });

  test('draw over the BODY of a long note adds nothing — that step already sounds it', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().paintLeadNote(4, 'C4', 'draw');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 4 * CELL }]);
    expect(useAppStore.getState().leadMelodySteps[4]).toEqual([]);
  });

  test('erase over the body of a long note removes the WHOLE note, from where it starts', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().paintLeadNote(4, 'C4', 'erase');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('a long note in another row is untouched by a stroke through its steps', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4 * CELL);
    useAppStore.getState().paintLeadNote(4, 'E4', 'draw');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 4 * CELL }]);
    expect(useAppStore.getState().leadMelodySteps[4]).toEqual([{ note: 'E4', len: CELL }]);
  });

  test('toggleLeadNote still flips, and is the same code path as paint', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'toggle');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
    useAppStore.getState().paintLeadNote(0, 'C4', 'toggle');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });
});

describe('lead slice — selection cursor and bar clipboard', () => {
  beforeEach(resetLead);

  test('the cursor starts at the first column and clamps to the loop on write', () => {
    expect(useAppStore.getState().leadCursor).toBe(0);
    useAppStore.getState().setLeadCursor(99);
    expect(useAppStore.getState().leadCursor).toBe(15); // 1 bar of 4/4
    useAppStore.getState().setLeadCursor(-4);
    expect(useAppStore.getState().leadCursor).toBe(0);
  });

  test('a shorter loop pulls the cursor back inside it', () => {
    useAppStore.getState().setLeadLoopLength(2);
    useAppStore.getState().setLeadCursor(30);
    expect(useAppStore.getState().leadCursor).toBe(30);
    useAppStore.getState().setLeadLoopLength(1);
    useAppStore.getState().setLeadCursor(30);
    expect(useAppStore.getState().leadCursor).toBe(15);
  });

  test('copy then paste duplicates the selected bar into another one', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().setLeadLoopLength(2);
    useAppStore.getState().setLeadCursor(0);
    useAppStore.getState().copySelectedLeadBar();
    useAppStore.getState().setLeadCursor(16); // bar 1
    useAppStore.getState().pasteIntoSelectedLeadBar();
    expect(useAppStore.getState().leadMelodySteps[48]).toEqual([{ note: 'C4', len: CELL }]);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('the clipboard survives edits made between the copy and the paste', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().setLeadLoopLength(2);
    useAppStore.getState().copySelectedLeadBar();
    useAppStore.getState().paintLeadNote(0, 'C4', 'erase');
    useAppStore.getState().setLeadCursor(16);
    useAppStore.getState().pasteIntoSelectedLeadBar();
    expect(useAppStore.getState().leadMelodySteps[48]).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('pasting with nothing copied leaves the melody untouched', () => {
    const s = useAppStore.getState();
    s.paintLeadNote(0, 'C4', 'draw');
    const before = useAppStore.getState().leadMelodySteps;
    useAppStore.getState().pasteIntoSelectedLeadBar();
    expect(useAppStore.getState().leadMelodySteps).toBe(before);
  });

  test('the cursor selects the bar it sits in, not only a bar it starts', () => {
    const s = useAppStore.getState();
    s.setLeadLoopLength(2);
    useAppStore.getState().paintLeadNote(48, 'E4', 'draw'); // bar 1, tick 0
    useAppStore.getState().setLeadCursor(20); // mid bar 1
    useAppStore.getState().copySelectedLeadBar();
    useAppStore.getState().setLeadCursor(0);
    useAppStore.getState().pasteIntoSelectedLeadBar();
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'E4', len: CELL }]);
  });

  test('neither the cursor nor the clipboard is persisted — they are session state', () => {
    useAppStore.getState().setLeadCursor(5);
    useAppStore.getState().copySelectedLeadBar();
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<
      string,
      unknown
    >;
    expect('leadCursor' in persisted).toBe(false);
    expect('leadBarClipboard' in persisted).toBe(false);
  });
});

describe('lead slice — step entry', () => {
  beforeEach(resetLead);

  // A grid COLUMN, through the one conversion — the melody stores ticks.
  const at = (col: number): LeadNote[] => {
    const state = useAppStore.getState();
    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    return state.leadMelodySteps[leadStoredIndexAt(col, stepsPerBar, TICKS_PER_SIXTEENTH)];
  };
  const arm = (): void => useAppStore.getState().setLeadRecording(true);

  test('arming is off by default and toggles', () => {
    expect(useAppStore.getState().leadRecording).toBe(false);
    arm();
    expect(useAppStore.getState().leadRecording).toBe(true);
  });

  test('arming is NOT persisted — a reload must never come back recording', () => {
    arm();
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('leadRecording' in persisted).toBe(false);
  });

  test('a recorded note lands at the cursor and reports that it wrote', () => {
    arm();
    useAppStore.getState().setLeadCursor(5);

    expect(useAppStore.getState().recordLeadNote('C4')).toBe(true);
    expect(at(5)).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('recording declines while disarmed', () => {
    expect(useAppStore.getState().recordLeadNote('C4')).toBe(false);
    expect(at(0)).toEqual([]);
  });

  test('a column argument overrides the cursor — that is the live write head', () => {
    arm();
    useAppStore.getState().setLeadCursor(2);

    expect(useAppStore.getState().recordLeadNote('C4', 9)).toBe(true);

    expect(at(9)).toEqual([{ note: 'C4', len: CELL }]);
    expect(at(2)).toEqual([]);
    // The cursor is still the user's. The write head is a different thing.
    expect(useAppStore.getState().leadCursor).toBe(2);
  });

  test('a column past the loop end is clamped, never written out of bounds', () => {
    arm();
    expect(useAppStore.getState().recordLeadNote('C4', 999)).toBe(true);
    // 1-bar loop in 4/4 → columns 0..15.
    expect(at(15)).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('the transport playing no longer refuses the write — that is DEV-374', () => {
    arm();
    useAppStore.setState({ leadPlayer: 'playing' });

    expect(useAppStore.getState().recordLeadNote('C4', 4)).toBe(true);
    expect(at(4)).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('a note already at the cursor is a no-op, never a delete', () => {
    // 'draw', not 'toggle'. A performer repeating a note expects nothing to
    // happen, not the note they just played to disappear.
    arm();
    expect(useAppStore.getState().recordLeadNote('C4')).toBe(true);
    // ...and it SAYS it did nothing. The live recorder registers a held note
    // per `true`, so a second press answered `true` would hold a row that
    // never received the pitch, and its note-off would lengthen nothing.
    expect(useAppStore.getState().recordLeadNote('C4')).toBe(false);

    expect(at(0)).toEqual([{ note: 'C4', len: CELL }]);
  });

  test('several notes at one cursor build a chord', () => {
    arm();
    for (const note of ['C4', 'E4', 'G4']) useAppStore.getState().recordLeadNote(note);

    expect(at(0).map((n) => n.note).sort()).toEqual(['C4', 'E4', 'G4']);
  });

  test('scale-locked view refuses a note the grid has no row for', () => {
    // C# is not in C major, so there is no row to draw it on. Storing it
    // would leave a note that plays but cannot be seen or erased.
    arm();
    expect(useAppStore.getState().recordLeadNote('C#4')).toBe(false);
    expect(at(0)).toEqual([]);
  });

  test('chromatic view accepts that same note', () => {
    arm();
    useAppStore.setState({ leadMelodyView: 'chromatic' });

    expect(useAppStore.getState().recordLeadNote('C#4')).toBe(true);
    expect(at(0)).toEqual([{ note: 'C#4', len: CELL }]);
  });

  test('a note above the window drags the window up rather than vanishing', () => {
    arm();
    // Window at 3 shows octaves 3-4; C6 needs the lowest octave at 5.
    expect(useAppStore.getState().recordLeadNote('C6')).toBe(true);
    expect(useAppStore.getState().leadMelodyOctave).toBe(5);
    expect(at(0)).toEqual([{ note: 'C6', len: CELL }]);
  });

  test('a note no legal window can show is refused, and moves nothing', () => {
    arm();
    expect(useAppStore.getState().recordLeadNote('C9')).toBe(false);
    expect(useAppStore.getState().leadMelodyOctave).toBe(3);
    expect(at(0)).toEqual([]);
  });
});

describe('leadStepResolution', () => {
  beforeEach(resetLead);

  test('defaults to 1/16 — what every existing project is authored at', () => {
    expect(useAppStore.getState().leadStepResolution).toBe('1/16');
  });

  test('the setter takes the three ids and refuses anything else', () => {
    useAppStore.getState().setLeadStepResolution('1/32');
    expect(useAppStore.getState().leadStepResolution).toBe('1/32');
    useAppStore.getState().setLeadStepResolution('1/8');
    expect(useAppStore.getState().leadStepResolution).toBe('1/8');
    // Never throws — this value feeds the scheduler.
    useAppStore.getState().setLeadStepResolution('1/12' as never);
    expect(useAppStore.getState().leadStepResolution).toBe('1/16');
  });

  test('changing resolution writes nothing to the melody', () => {
    // The same invariant a meter change already keeps. Snapping every len
    // to a whole cell at the moment of the switch would RATCHET: a 5-tick
    // note becomes 6 at 1/16, then 8 at 1/8, and coming back to 1/32 gives
    // 8 rather than 5. Flipping the control three times would lengthen
    // music nobody asked to lengthen, unrecoverably.
    useAppStore.setState({ leadStepResolution: '1/32' });
    useAppStore.getState().paintLeadNote(0, 'C4', 'draw');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 5);
    const before = JSON.stringify(useAppStore.getState().leadMelodySteps);

    useAppStore.getState().setLeadStepResolution('1/8');
    expect(JSON.stringify(useAppStore.getState().leadMelodySteps)).toBe(before);
    useAppStore.getState().setLeadStepResolution('1/32');
    expect(JSON.stringify(useAppStore.getState().leadMelodySteps)).toBe(before);
  });

  test('a drawn note is one CELL long, whatever the resolution', () => {
    // len is ticks; the editor writes whole cells. Same music, different
    // number written down.
    useAppStore.setState({ leadStepResolution: '1/8' });
    useAppStore.getState().paintLeadNote(0, 'C4', 'draw');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 4 }]);

    useAppStore.setState({
      leadStepResolution: '1/32',
      leadMelodySteps: useAppStore.getState().leadMelodySteps.map(() => []),
    });
    useAppStore.getState().paintLeadNote(0, 'D4', 'draw');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'D4', len: 1 }]);
  });
});
