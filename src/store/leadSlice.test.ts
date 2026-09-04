import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore, partializeAppState } from './store';
import { loadLoop } from './loadLoop';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';

function resetLead(): void {
  useAppStore.setState({
    meterId: '4/4',
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
  });
}

describe('lead slice — defaults', () => {
  beforeEach(resetLead);
  test('starts with a silent 1-bar melody, scale-locked view, octave 3', () => {
    const s = useAppStore.getState();
    expect(s.leadLoopLength).toBe(1);
    expect(s.leadMelodyView).toBe('scale-locked');
    expect(s.leadMelodyOctave).toBe(3);
    expect(s.leadMelodySteps).toHaveLength(MAX_STEPS_PER_BAR);
    expect(s.leadMelodySteps.every((row) => row.length === 0)).toBe(true);
  });
});

describe('lead slice — toggleLeadNote', () => {
  beforeEach(resetLead);
  test('adds a note to an empty step and removes it on a second toggle', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
    s.toggleLeadNote(0, 'E4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([
      { note: 'C4', len: 1 },
      { note: 'E4', len: 1 },
    ]);
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'E4', len: 1 }]);
  });
});

describe('lead slice — LeadNote shape', () => {
  beforeEach(resetLead);
  test('toggleLeadNote creates a one-step note object, not a bare string', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('toggling the same note again removes it', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('a second note on the same step appends without disturbing the first', () => {
    useAppStore.getState().toggleLeadNote(3, 'C4');
    useAppStore.getState().toggleLeadNote(3, 'G4');
    expect(useAppStore.getState().leadMelodySteps[3]).toEqual([
      { note: 'C4', len: 1 },
      { note: 'G4', len: 1 },
    ]);
  });
});

describe('lead slice — setLeadLoopLength resizes by whole bars', () => {
  beforeEach(resetLead);
  test('growing pads empty bars; shrinking trims trailing bars', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2); // grow → 48 slots, bar 0 keeps C4, bar 1 padded empty
    const grown = useAppStore.getState();
    expect(grown.leadLoopLength).toBe(2);
    expect(grown.leadMelodySteps).toHaveLength(48);
    expect(grown.leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(grown.leadMelodySteps[24]).toEqual([]);

    grown.toggleLeadNote(24, 'E4'); // bar 1 step 0
    useAppStore.getState().setLeadLoopLength(1); // shrink → 24 slots, bar 1 dropped
    const shrunk = useAppStore.getState();
    expect(shrunk.leadLoopLength).toBe(1);
    expect(shrunk.leadMelodySteps).toHaveLength(24);
    expect(shrunk.leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('setLeadLoopLengthPreserve lowers the loop length without trimming the grid', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2); // grow to 48 slots
    useAppStore.getState().toggleLeadNote(24, 'E4'); // bar 1 step 0
    useAppStore.getState().setLeadLoopLengthPreserve(1);
    const clamped = useAppStore.getState();
    expect(clamped.leadLoopLength).toBe(1);
    // The drawn bar-1 note survives dormant and returns if the length is raised.
    expect(clamped.leadMelodySteps).toHaveLength(48);
    expect(clamped.leadMelodySteps[24]).toEqual([{ note: 'E4', len: 1 }]);
    useAppStore.getState().setLeadLoopLength(2);
    const restored = useAppStore.getState();
    expect(restored.leadMelodySteps[24]).toEqual([{ note: 'E4', len: 1 }]);
  });

  test('setLeadNoteLength refuses a DORMANT slot rather than clamping against a fictitious position', () => {
    // 4/4 cannot reach offset 18 of a 24-slot bar, so there is no loop-end to
    // measure invariant 2 against. Unreachable from today's callers (the grid
    // renders active columns only), but the melody must survive untouched —
    // the same rule resizeLeadMelody follows.
    useAppStore.getState().toggleLeadNote(18, 'G4');
    const before = useAppStore.getState().leadMelodySteps;
    useAppStore.getState().setLeadNoteLength(18, 'G4', 4);
    expect(useAppStore.getState().leadMelodySteps).toBe(before);
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual([{ note: 'G4', len: 1 }]);
  });

  test('toggling a DORMANT slot toggles it in place, not through another bar', () => {
    useAppStore.getState().toggleLeadNote(18, 'G4');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual([{ note: 'G4', len: 1 }]);
    useAppStore.getState().toggleLeadNote(18, 'G4');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual([]);
  });

  test('a meter change never touches the stored melody (non-destructive)', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(18, 'G4'); // step 18 visible in 12/8 (24), hidden in 4/4
    s.setMeter('4/4');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual([{ note: 'G4', len: 1 }]);
    expect(useAppStore.getState().leadMelodySteps).toHaveLength(MAX_STEPS_PER_BAR);
    s.setMeter('12/8');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual([{ note: 'G4', len: 1 }]);
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
    s.toggleLeadNote(2, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 }]);
    expect(melody[2]).toEqual([]);
  });

  test('a note on a DIFFERENT pitch row inside the span survives', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.toggleLeadNote(2, 'G4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 }]);
    expect(melody[2]).toEqual([{ note: 'G4', len: 1 }]);
  });

  test('shrinking a note leaves the steps it no longer covers empty', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
    useAppStore.getState().setLeadNoteLength(0, 'C4', 1);

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(melody[1]).toEqual([]);
    expect(melody[3]).toEqual([]);
  });
});

describe('setLeadNoteLength — invariant 2: never crosses the loop end', () => {
  beforeEach(resetLead);

  test('a length that would overhang is clamped on write', () => {
    // 4/4, 1 bar: the loop ends at active step 16, so a note at step 14 caps at 2.
    useAppStore.getState().toggleLeadNote(14, 'C4');
    useAppStore.getState().setLeadNoteLength(14, 'C4', 6);
    expect(useAppStore.getState().leadMelodySteps[14]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('the last step of the loop caps at 1', () => {
    useAppStore.getState().toggleLeadNote(15, 'C4');
    useAppStore.getState().setLeadNoteLength(15, 'C4', 9);
    expect(useAppStore.getState().leadMelodySteps[15]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('a two-bar loop lets a note cross the bar line', () => {
    useAppStore.setState({ leadLoopLength: 2 });
    useAppStore.getState().toggleLeadNote(15, 'C4');
    useAppStore.getState().setLeadNoteLength(15, 'C4', 4);
    expect(useAppStore.getState().leadMelodySteps[15]).toEqual([{ note: 'C4', len: 4 }]);
  });
});

describe('setLeadNoteLength — invariant 3: len is an integer >= 1', () => {
  beforeEach(resetLead);

  test('zero and negative lengths clamp to 1', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 0);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
    useAppStore.getState().setLeadNoteLength(0, 'C4', -5);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
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

  test('a non-finite length rejects, leaving the note at length 1', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', Number.NaN);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
  });
});

describe('toggleLeadNote — a click on a covered cell removes the covering note', () => {
  beforeEach(resetLead);

  test('clicking the MIDDLE of a long note removes it entirely', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
    useAppStore.getState().toggleLeadNote(2, 'C4');

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([]);
    expect(melody[2]).toEqual([]);
  });

  test('clicking the START step of a long note removes it entirely', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('clicking the LAST step of a long note removes it entirely', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
    useAppStore.getState().toggleLeadNote(3, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
  });

  test('a covered click leaves notes in OTHER pitch rows untouched', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
    useAppStore.getState().toggleLeadNote(2, 'G4');
    useAppStore.getState().toggleLeadNote(2, 'C4');

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([]);
    expect(melody[2]).toEqual([{ note: 'G4', len: 1 }]);
  });

  test('clicking an UNCOVERED cell still creates a one-step note', () => {
    useAppStore.getState().toggleLeadNote(0, 'C4');
    useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
    useAppStore.getState().toggleLeadNote(4, 'C4');

    const melody = useAppStore.getState().leadMelodySteps;
    expect(melody[0]).toEqual([{ note: 'C4', len: 4 }]);
    expect(melody[4]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('a note held across the bar line is removed from its start index', () => {
    useAppStore.setState({ leadLoopLength: 2 });
    useAppStore.getState().toggleLeadNote(15, 'C4');
    useAppStore.getState().setLeadNoteLength(15, 'C4', 4);
    // Loop step 17 is bar 1 step 1 -> stored 25, but the note lives at 15.
    useAppStore.getState().toggleLeadNote(25, 'C4');
    expect(useAppStore.getState().leadMelodySteps[15]).toEqual([]);
  });
});
