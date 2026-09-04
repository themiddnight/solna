import { describe, expect, test } from 'bun:test';
import {
  createLeadPaintController,
  createLeadPaintHandlers,
  leadPaintClickIsKeyboard,
  leadPaintKey,
  type LeadPaintCommit,
} from './leadPaint';

function collector(): { commits: LeadPaintCommit[]; ctl: ReturnType<typeof createLeadPaintController> } {
  const commits: LeadPaintCommit[] = [];
  // Identity resolver: in these tests a column IS its stored index.
  return { commits, ctl: createLeadPaintController((c) => commits.push(c), (col) => col) };
}

describe('leadPaintKey', () => {
  test('separates cells that differ only by step or only by note', () => {
    expect(leadPaintKey(4, 'C4')).not.toBe(leadPaintKey(5, 'C4'));
    expect(leadPaintKey(4, 'C4')).not.toBe(leadPaintKey(4, 'C#4'));
  });
});

describe('leadPaintClickIsKeyboard', () => {
  // A click produced by Enter/Space on a button carries detail 0; a real
  // mouse click carries 1 or more. That is the whole discriminator: the
  // pointer session handles mouse clicks, so only keyboard ones may toggle.
  test('detail 0 is a keyboard activation, anything higher is a pointer', () => {
    expect(leadPaintClickIsKeyboard(0)).toBe(true);
    expect(leadPaintClickIsKeyboard(1)).toBe(false);
    expect(leadPaintClickIsKeyboard(2)).toBe(false);
  });
});

describe('createLeadPaintController', () => {
  test('a gesture started on an EMPTY cell draws, and commits that first cell at once', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    expect(commits).toEqual([{ stepIndex: 4, note: 'C4', mode: 'draw' }]);
  });

  test('a gesture started on a COVERED cell erases', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', true);
    expect(commits).toEqual([{ stepIndex: 4, note: 'C4', mode: 'erase' }]);
  });

  test('the mode is fixed at pointer-down — later cells never flip it', () => {
    // Without this, sweeping over a filled cell mid-draw would start erasing
    // and the stroke would eat what it just painted.
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.visit(1, 5, 5, 'C4');
    ctl.visit(1, 6, 6, 'D4');
    expect(commits.map((c) => c.mode)).toEqual(['draw', 'draw', 'draw']);
    expect(commits.map((c) => c.stepIndex)).toEqual([4, 5, 6]);
  });

  test('re-entering a cell in the same gesture commits nothing more', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.visit(1, 5, 5, 'C4');
    ctl.visit(1, 4, 4, 'C4');
    ctl.visit(1, 5, 5, 'C4');
    expect(commits).toHaveLength(2);
  });

  test('a visit with no gesture open commits nothing', () => {
    const { commits, ctl } = collector();
    ctl.visit(1, 4, 4, 'C4');
    expect(commits).toHaveLength(0);
    expect(ctl.isActive()).toBe(false);
  });

  test('a second pointer cannot steer the gesture the first one started', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.visit(2, 5, 5, 'C4');
    expect(commits).toHaveLength(1);
  });

  test('end closes the gesture, and stray visits after it do nothing', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.end(1);
    expect(ctl.isActive()).toBe(false);
    ctl.visit(1, 5, 5, 'C4');
    expect(commits).toHaveLength(1);
  });

  test("another pointer's end leaves the gesture running", () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.end(2);
    expect(ctl.isActive()).toBe(true);
    ctl.visit(1, 5, 5, 'C4');
    expect(commits).toHaveLength(2);
  });

  test('a fast sweep FILLS the columns the pointer skipped over', () => {
    // A mouse moving faster than one cell per pointer event only reports the
    // cells it happened to land on; without this the stroke comes out as a
    // dotted line with silent gaps between the notes.
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.visit(1, 8, 8, 'C4');
    expect(commits.map((c) => c.stepIndex)).toEqual([4, 5, 6, 7, 8]);
  });

  test('a fast sweep BACKWARDS fills the gap too', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 8, 8, 'C4', false);
    ctl.visit(1, 5, 5, 'C4');
    expect(commits.map((c) => c.stepIndex)).toEqual([8, 7, 6, 5]);
  });

  test('the gap is filled through the RESOLVER, not by assuming column == stored index', () => {
    // Stored indices are bar-major at a fixed width, so column 24 of a 4/4
    // loop is stored index 96 — interpolating raw indices would write into
    // dormant slots the grid never shows.
    const commits: LeadPaintCommit[] = [];
    const ctl = createLeadPaintController((c) => commits.push(c), (col) => col * 10);
    ctl.begin(1, 40, 4, 'C4', false);
    ctl.visit(1, 70, 7, 'C4');
    expect(commits.map((c) => c.stepIndex)).toEqual([40, 50, 60, 70]);
  });

  test('a jump to ANOTHER row fills nothing — a diagonal sweep is not a run of notes', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.visit(1, 8, 8, 'D4');
    expect(commits).toEqual([
      { stepIndex: 4, note: 'C4', mode: 'draw' },
      { stepIndex: 8, note: 'D4', mode: 'draw' },
    ]);
  });

  test('a new gesture may repaint a cell the previous one already touched', () => {
    const { commits, ctl } = collector();
    ctl.begin(1, 4, 4, 'C4', false);
    ctl.end(1);
    ctl.begin(1, 4, 4, 'C4', true);
    expect(commits).toEqual([
      { stepIndex: 4, note: 'C4', mode: 'draw' },
      { stepIndex: 4, note: 'C4', mode: 'erase' },
    ]);
  });
});

describe('createLeadPaintHandlers', () => {
  function harness() {
    const commits: LeadPaintCommit[] = [];
    const toggled: Array<[number, string]> = [];
    const ctl = createLeadPaintController((c) => commits.push(c), (col) => col);
    const h = createLeadPaintHandlers(ctl, (stepIndex, note) => toggled.push([stepIndex, note]));
    return { commits, toggled, h };
  }

  test('a primary-button press starts the stroke', () => {
    const { commits, h } = harness();
    h.onCellPointerDown({ pointerId: 1, button: 0 }, 4, 4, 'C4', false);
    expect(commits).toEqual([{ stepIndex: 4, note: 'C4', mode: 'draw' }]);
  });

  test('a non-primary button does NOT paint — a right-click must not draw notes', () => {
    const { commits, h } = harness();
    h.onCellPointerDown({ pointerId: 1, button: 2 }, 4, 4, 'C4', false);
    expect(commits).toHaveLength(0);
  });

  test('entering a cell mid-stroke paints it', () => {
    const { commits, h } = harness();
    h.onCellPointerDown({ pointerId: 1, button: 0 }, 4, 4, 'C4', false);
    h.onCellPointerEnter({ pointerId: 1 }, 5, 5, 'C4');
    expect(commits).toHaveLength(2);
  });

  test('entering a cell with no stroke open paints nothing — hovering is not drawing', () => {
    const { commits, h } = harness();
    h.onCellPointerEnter({ pointerId: 1 }, 5, 5, 'C4');
    expect(commits).toHaveLength(0);
  });

  test('a KEYBOARD click still toggles, so the grid stays operable without a pointer', () => {
    const { toggled, h } = harness();
    h.onCellClick({ detail: 0 }, 7, 'G4');
    expect(toggled).toEqual([[7, 'G4']]);
  });

  test('a MOUSE click toggles nothing — the pointer stroke already committed it', () => {
    // Both firing would paint the cell on pointerdown and immediately undo it
    // on the click that follows.
    const { toggled, h } = harness();
    h.onCellClick({ detail: 1 }, 7, 'G4');
    expect(toggled).toHaveLength(0);
  });
});
