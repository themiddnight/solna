import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  clampLeadCursor,
  clampLeadLoopLength,
  copyLeadBar,
  leadCursorBar,
  pasteLeadBar,
  isLegacyLeadMelody,
  leadActivePosAt,
  leadCoveringNoteIndex,
  leadSoundingNotes,
  leadStoredIndexAt,
  loopLengthDivisors,
  remapLeadMelodyByScale,
  resizeLeadMelody,
  resolveLeadStepTriggers,
  stepInLoopFor,
  transposeLeadMelodyByRoot,
  upgradeLeadMelodyV1,
  upgradeLeadMelodyToTicks,
  type LeadNote,
} from './leadMelody';
import { buildArpSequence } from './arpeggiator';
import { computeArpTriggers } from './arpSchedule';
import {
  LEAD_TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
  columnsPerBar,
} from '../utils/stepResolution';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

describe('loopLengthDivisors', () => {
  test('lists every positive divisor ascending', () => {
    expect(loopLengthDivisors(4)).toEqual([1, 2, 4]);
    expect(loopLengthDivisors(6)).toEqual([1, 2, 3, 6]);
    expect(loopLengthDivisors(1)).toEqual([1]);
  });
});

describe('clampLeadLoopLength', () => {
  test('returns the current value when it already divides', () => {
    expect(clampLeadLoopLength(2, 4)).toBe(2);
    expect(clampLeadLoopLength(4, 4)).toBe(4);
  });
  test('clamps DOWN to the largest divisor <= current', () => {
    expect(clampLeadLoopLength(3, 4)).toBe(2);
    expect(clampLeadLoopLength(5, 6)).toBe(3);
    expect(clampLeadLoopLength(3, 2)).toBe(2);
  });
  test('a zero/invalid total falls back to 1', () => {
    expect(clampLeadLoopLength(4, 0)).toBe(1);
  });
});

describe('resizeLeadMelody', () => {
  const twoBars = Array.from({ length: 96 }, (_, i) =>
    i < 48 ? [{ note: 'C4', len: 2 }] : [{ note: 'E4', len: 2 }],
  );
  test('pads empty bars when growing', () => {
    const out = resizeLeadMelody([[{ note: 'C4', len: 2 }]], 2, 16, 2);
    expect(out).toHaveLength(96);
    expect(out[0]).toEqual([{ note: 'C4', len: 2 }]);
    expect(out[48]).toEqual([]);
    expect(out[95]).toEqual([]);
  });
  test('trims trailing bars when shrinking', () => {
    const out = resizeLeadMelody(twoBars, 1, 16, 2);
    expect(out).toHaveLength(48);
    expect(out[0]).toEqual([{ note: 'C4', len: 2 }]);
    expect(out[48]).toBeUndefined();
  });

  test('clamps a note that would overhang the new loop end when shrinking', () => {
    const m: LeadNote[][] = [...Array.from({ length: 48 }, () => [] as LeadNote[]), ...Array.from({ length: 48 }, () => [] as LeadNote[])];
    // Column 14 of 4/4 is stored tick 28; 12 ticks is six 16ths.
    m[28] = [{ note: 'C4', len: 12 }];
    const out = resizeLeadMelody(m, 1, 16, 2);
    expect(out).toHaveLength(48);
    expect(out[28]).toEqual([{ note: 'C4', len: 4 }]);
  });

  test('leaves a note that still fits alone', () => {
    const m: LeadNote[][] = Array.from({ length: 48 }, () => [] as LeadNote[]);
    m[16] = [{ note: 'C4', len: 8 }];
    expect(resizeLeadMelody(m, 1, 16, 2)[16]).toEqual([{ note: 'C4', len: 8 }]);
  });

  test('never clamps below one cell, even in a bar other than the first', () => {
    // Bar index 1, last active column of 4/4 (15): activePos = 1*16+15 = 31,
    // loopEndTicks = 2*32 = 64, so the true remaining capacity is 2 ticks —
    // one cell. A formula that forgot the barIndex term (e.g. loopEnd -
    // offset) would wrongly compute 34 here -- this fixture, unlike bar 0,
    // catches that.
    const m: LeadNote[][] = [...Array.from({ length: 48 }, () => [] as LeadNote[]), ...Array.from({ length: 48 }, () => [] as LeadNote[])];
    m[48 + 30] = [{ note: 'C4', len: 99 }];
    expect(resizeLeadMelody(m, 2, 16, 2)[48 + 30]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('a dormant slot the active meter cannot reach survives resize untouched', () => {
    // stepsPerBar 16: stored tick 36 is offset 36 in bar 0, which is >= 32 and
    // so unreachable by the active meter. Shrinking to newLoopLength 1 must
    // NOT rewrite its len -- it is dormant, not overhanging (leadSlice.test.ts's
    // "a meter change never touches the stored melody" invariant).
    const m: LeadNote[][] = Array.from({ length: 48 }, () => [] as LeadNote[]);
    m[36] = [{ note: 'C4', len: 6 }];
    expect(resizeLeadMelody(m, 1, 16, 2)[36]).toEqual([{ note: 'C4', len: 6 }]);
  });
});

describe('stepInLoopFor', () => {
  test('wraps the absolute step into the melody loop', () => {
    expect(stepInLoopFor(0, 32)).toBe(0);
    expect(stepInLoopFor(16, 32)).toBe(16);
    expect(stepInLoopFor(32, 32)).toBe(0);
    expect(stepInLoopFor(33, 32)).toBe(1);
  });
  test('a short 1-bar loop repeats as an ostinato', () => {
    expect(stepInLoopFor(48, 16)).toBe(0);
    expect(stepInLoopFor(50, 16)).toBe(2);
  });
});

const oneBar = (): LeadNote[][] => Array.from({ length: 48 }, () => [] as LeadNote[]);

describe('leadSoundingNotes', () => {
  test('age counts how many ticks ago the note started', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 6 }];
    expect(leadSoundingNotes(m, 0, 16, 2)).toEqual([{ note: 'C4', len: 6, age: 0 }]);
    expect(leadSoundingNotes(m, 1, 16, 2)).toEqual([{ note: 'C4', len: 6, age: 2 }]);
    expect(leadSoundingNotes(m, 2, 16, 2)).toEqual([{ note: 'C4', len: 6, age: 4 }]);
    expect(leadSoundingNotes(m, 3, 16, 2)).toEqual([]);
  });

  test('lists notes starting here before notes still sounding from earlier', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 8 }];
    m[4] = [{ note: 'G4', len: 2 }];
    expect(leadSoundingNotes(m, 2, 16, 2)).toEqual([
      { note: 'G4', len: 2, age: 0 },
      { note: 'C4', len: 8, age: 4 },
    ]);
  });

  test('the lookback stops at column 0 of the loop', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 2 }];
    expect(leadSoundingNotes(m, 0, 16, 2)).toEqual([{ note: 'C4', len: 2, age: 0 }]);
    expect(leadSoundingNotes(m, 1, 16, 2)).toEqual([]);
  });

  test('a note held across the bar line keeps sounding', () => {
    const m = [...oneBar(), ...oneBar()];
    m[30] = [{ note: 'A4', len: 6 }];
    expect(leadSoundingNotes(m, 15, 16, 2)).toEqual([{ note: 'A4', len: 6, age: 0 }]);
    expect(leadSoundingNotes(m, 16, 16, 2)).toEqual([{ note: 'A4', len: 6, age: 2 }]);
    expect(leadSoundingNotes(m, 17, 16, 2)).toEqual([{ note: 'A4', len: 6, age: 4 }]);
  });

  test('the stored width is windowed to the ACTIVE stepsPerBar', () => {
    const m = [...oneBar(), ...oneBar()];
    m[48] = [{ note: 'E4', len: 2 }];
    m[24] = [{ note: 'D4', len: 2 }];
    // stepsPerBar 12: column 12 is bar 1 column 0 -> stored tick 48.
    expect(leadSoundingNotes(m, 12, 12, 2)).toEqual([{ note: 'E4', len: 2, age: 0 }]);
    // stepsPerBar 16: column 12 is bar 0 column 12 -> stored tick 24.
    expect(leadSoundingNotes(m, 12, 16, 2)).toEqual([{ note: 'D4', len: 2, age: 0 }]);
  });

  test('windowed at 24 steps (12/8) the full bar is reachable', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 2 }];
    expect(leadSoundingNotes(m, 0, 24, 2)).toEqual([{ note: 'C4', len: 2, age: 0 }]);
  });

  test('a column past the stored melody resolves to a rest (empty array)', () => {
    const m = [...oneBar(), ...oneBar()];
    m[0] = [{ note: 'C4', len: 2 }];
    expect(leadSoundingNotes(m, 1000, 16, 2)).toEqual([]);
  });
});

const ARP_PARAMS = { arpMode: 'up' as const, arpRate: '16n' as const, arpOctaves: 1 };
const STEP_DUR = 0.125;
/** The fixed 1/16 stride every pre-DEV-375 fixture is expressed at. */
const STRIDE = TICKS_PER_SIXTEENTH;
const TICK_DUR = STEP_DUR / TICKS_PER_SIXTEENTH;
/** A 1-bar 4/4 loop seen from its first column — no invariant-2 cap in play. */
const WHOLE_BAR = { tickInLoop: 0, melodyTicks: 16 * TICKS_PER_SIXTEENTH };

describe('resolveLeadStepTriggers — block mode', () => {
  test('holdSec is (cells - 1 + gate) * cellDurSec', () => {
    const one = [{ note: 'C4', len: 2, age: 0 }];
    const three = [{ note: 'C4', len: 6, age: 0 }];
    expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, TICK_DUR, 0.5, STRIDE, WHOLE_BAR)[0].holdSec).toBe(0.0625);
    expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, WHOLE_BAR)[0].holdSec).toBe(0.125);
    expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR)[0].holdSec).toBeCloseTo(0.10625, 10);
    expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, TICK_DUR, 0.5, STRIDE, WHOLE_BAR)[0].holdSec).toBe(0.3125);
    expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, WHOLE_BAR)[0].holdSec).toBe(0.375);
    expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR)[0].holdSec).toBeCloseTo(0.35625, 10);
  });

  test('at gate 1.0 a note ends exactly where the next step begins (legato)', () => {
    const t = resolveLeadStepTriggers([{ note: 'C4', len: 4, age: 0 }], false, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, WHOLE_BAR);
    expect(t[0].holdSec).toBe(2 * STEP_DUR);
  });

  test('notes with age > 0 emit nothing — their note-off is already scheduled', () => {
    const t = resolveLeadStepTriggers(
      [{ note: 'G4', len: 2, age: 0 }, { note: 'C4', len: 8, age: 4 }],
      false, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR,
    );
    expect(t.map((x) => x.note)).toEqual(['G4']);
  });

  test('a step where every sounding note is held from earlier emits nothing', () => {
    expect(resolveLeadStepTriggers([{ note: 'C4', len: 8, age: 4 }], false, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR)).toEqual([]);
  });
});

/**
 * Invariant 2 ("start + len never crosses the loop end") is enforced on write
 * and on a loop-length change — neither of which fires on a METER change, and
 * a meter change is deliberately non-destructive (leadSlice.test.ts pins that
 * the stored melody is never touched). `len` counts TICKS, so 12/8's
 * 48-tick bar can hold a 40-tick note that becomes illegal the moment 4/4
 * makes the bar 32 ticks long. The cap therefore has to happen at READ time:
 * leadCellKinds already truncates the drawn span to the active columns, and
 * without this the audio would disagree with the grid and ring across the
 * loop seam where the same pitch re-triggers.
 */
describe('resolveLeadStepTriggers — invariant 2 is capped at READ time', () => {
  test('a note left overhanging by a meter change is capped to the loop end', () => {
    // Drawn legally in 12/8 (stepsPerBar 24): 40 ticks at column 0. In 4/4 the
    // loop is 32 ticks, so the note may sound for at most 16 columns.
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 40, age: 0 }],
      false, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, { tickInLoop: 0, melodyTicks: 32 },
    );
    expect(t[0].holdSec).toBe(16 * STEP_DUR);
    // Uncapped it would ring for 20 columns — 1.25 bars, straight over the seam.
    expect(t[0].holdSec).toBeLessThan(20 * STEP_DUR);
  });

  test('the cap is measured from the note START, not from the current step', () => {
    // Same note, seen from tick 16: half the loop is already gone, so the
    // remaining capacity is measured from the note's start tick.
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 40, age: 0 }],
      false, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, { tickInLoop: 16, melodyTicks: 32 },
    );
    expect(t[0].holdSec).toBe(8 * STEP_DUR);
  });

  test('a note that still fits is untouched', () => {
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 8, age: 0 }],
      false, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, { tickInLoop: 0, melodyTicks: 32 },
    );
    expect(t[0].holdSec).toBe(4 * STEP_DUR);
  });

  test('the cap never drops a note below one cell', () => {
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 18, age: 0 }],
      false, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, { tickInLoop: 40, melodyTicks: 32 },
    );
    expect(t[0].holdSec).toBeCloseTo(0.85 * STEP_DUR, 10);
  });
});

describe('resolveLeadStepTriggers — arp mode', () => {
  test('plays a literal note, offset and hold for a simple up arpeggio', () => {
    // buildArpSequence sorts ['C4','E4','G4'] ascending (already sorted) ->
    // ['C4','E4','G4']; computeArpTriggers at step 0/16n picks index 0 with
    // holdSec = max(0.04, 0.85 * 0.125) = 0.10625.
    const sounding = [
      { note: 'C4', len: 2, age: 0 },
      { note: 'E4', len: 2, age: 0 },
      { note: 'G4', len: 2, age: 0 },
    ];
    const t = resolveLeadStepTriggers(sounding, true, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR);
    expect(t).toEqual([{ note: 'C4', timeOffsetSec: 0, holdSec: 0.10625 }]);
  });

  test('all sounding notes feed the arp pool, including age > 0 (asserted by note name)', () => {
    const withHeld = resolveLeadStepTriggers(
      [{ note: 'G4', len: 2, age: 0 }, { note: 'C4', len: 8, age: 4 }],
      true, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR,
    );
    const startsOnly = resolveLeadStepTriggers(
      [{ note: 'G4', len: 2, age: 0 }],
      true, 0, ARP_PARAMS, TICK_DUR, 0.85, STRIDE, WHOLE_BAR,
    );
    // C4 (midi 60) sorts before G4 (midi 67): once the age-2 C4 joins the
    // pool it plays FIRST on step 0 instead of G4 alone.
    expect(withHeld).toEqual([{ note: 'C4', timeOffsetSec: 0, holdSec: 0.10625 }]);
    expect(startsOnly).toEqual([{ note: 'G4', timeOffsetSec: 0, holdSec: 0.10625 }]);
  });

  test('gate does not reach the arp — its hold comes from arpRate', () => {
    const atLowGate = resolveLeadStepTriggers(
      [{ note: 'C4', len: 2, age: 0 }, { note: 'E4', len: 2, age: 0 }],
      true, 0, ARP_PARAMS, TICK_DUR, 0.05, STRIDE, WHOLE_BAR,
    );
    const atFullGate = resolveLeadStepTriggers(
      [{ note: 'C4', len: 2, age: 0 }, { note: 'E4', len: 2, age: 0 }],
      true, 0, ARP_PARAMS, TICK_DUR, 1, STRIDE, WHOLE_BAR,
    );
    expect(atLowGate).toEqual(atFullGate);
  });
});

/**
 * THE no-op guarantee. An old melody is every note ONE CELL long (len:
 * STRIDE ticks) at gate 0.85, and it must produce byte-identical
 * LeadTrigger[] to the pre-DEV-369
 * implementation with the arp both on and off. If this passes, no existing
 * music changes sound — the entire risk budget of this change.
 */
describe('no-op guarantee — an all-len-1 melody at gate 0.85', () => {
  const LEGACY_GATE = 0.85;
  const notes = ['C4', 'E4', 'G4'];
  const sounding = notes.map((note) => ({ note, len: STRIDE, age: 0 }));

  test('block mode matches the retired `LEAD_GATE * stepDurSec` exactly', () => {
    const legacy = notes.map((note) => ({
      note,
      timeOffsetSec: 0,
      holdSec: LEGACY_GATE * STEP_DUR,
    }));
    expect(resolveLeadStepTriggers(sounding, false, 0, ARP_PARAMS, TICK_DUR, LEGACY_GATE, STRIDE, WHOLE_BAR)).toEqual(legacy);
  });

  test('arp ON expands octaves through the arpeggiator (unchanged)', () => {
    // Every other arp test runs at arpOctaves 1, where dropping the argument
    // in resolveLeadStepTriggers would change nothing and break no test. This
    // one runs at 2, so the octave expansion is actually pinned.
    const twoOctaves = { ...ARP_PARAMS, arpOctaves: 2 };
    const pair = ['C4', 'E4'];
    const soundingPair = pair.map((note) => ({ note, len: STRIDE, age: 0 }));
    const sequence = buildArpSequence(pair, ARP_PARAMS.arpMode, 2);
    expect(sequence).toEqual(['C4', 'E4', 'C5', 'E5']);

    for (const arpStep of [0, 1, 2, 3, 5]) {
      const legacy = computeArpTriggers(arpStep, sequence.length, ARP_PARAMS.arpRate, STEP_DUR).map(
        (t) => ({ note: sequence[t.noteIndex], timeOffsetSec: t.timeOffsetSec, holdSec: t.holdSec }),
      );
      expect(
        resolveLeadStepTriggers(soundingPair, true, arpStep, twoOctaves, TICK_DUR, LEGACY_GATE, STRIDE, WHOLE_BAR),
      ).toEqual(legacy);
    }

    // And the octave count is load-bearing: at step 2 the two-octave sequence
    // plays C5 where the one-octave one plays C4.
    expect(
      resolveLeadStepTriggers(soundingPair, true, 2, twoOctaves, TICK_DUR, LEGACY_GATE, STRIDE, WHOLE_BAR)[0].note,
    ).toBe('C5');
    expect(
      resolveLeadStepTriggers(soundingPair, true, 2, ARP_PARAMS, TICK_DUR, LEGACY_GATE, STRIDE, WHOLE_BAR)[0].note,
    ).toBe('C4');
  });

  test('arp mode matches buildArpSequence + computeArpTriggers unchanged', () => {
    for (const arpStep of [0, 1, 2, 3, 4, 7]) {
      const sequence = buildArpSequence(notes, ARP_PARAMS.arpMode, ARP_PARAMS.arpOctaves);
      const legacy = computeArpTriggers(arpStep, sequence.length, ARP_PARAMS.arpRate, STEP_DUR).map(
        (t) => ({ note: sequence[t.noteIndex], timeOffsetSec: t.timeOffsetSec, holdSec: t.holdSec }),
      );
      expect(resolveLeadStepTriggers(sounding, true, arpStep, ARP_PARAMS, TICK_DUR, LEGACY_GATE, STRIDE, WHOLE_BAR)).toEqual(legacy);
    }
  });
});

describe('transposeLeadMelodyByRoot', () => {
  test('transposes every note in every step by the root interval', () => {
    const steps = [
      [{ note: 'A3', len: 1 }, { note: 'C4', len: 1 }],
      [{ note: 'E4', len: 1 }],
      [],
    ];
    expect(transposeLeadMelodyByRoot(steps, 'A', 'C')).toEqual([
      [{ note: 'C3', len: 1 }, { note: 'D#3', len: 1 }],
      [{ note: 'G3', len: 1 }],
      [],
    ]);
  });
});

describe('remapLeadMelodyByScale', () => {
  test('re-maps in-scale degrees on a scale change, leaves out-of-scale unchanged', () => {
    const steps = [
      [{ note: 'A3', len: 1 }, { note: 'F4', len: 1 }, { note: 'C#4', len: 1 }],
      [],
    ];
    // A natural minor → A dorian: F (degree 5) → F#; C#4 is out of scale
    expect(remapLeadMelodyByScale(steps, 'A', 'Natural Minor', 'Dorian')).toEqual([
      [{ note: 'A3', len: 1 }, { note: 'F#4', len: 1 }, { note: 'C#4', len: 1 }],
      [],
    ]);
  });
});

describe('upgradeLeadMelodyV1', () => {
  test('maps every string to a len-1 note, preserving row order', () => {
    expect(upgradeLeadMelodyV1([['C4', 'E4'], [], ['G4']])).toEqual([
      [{ note: 'C4', len: 1 }, { note: 'E4', len: 1 }],
      [],
      [{ note: 'G4', len: 1 }],
    ]);
  });

  test('an empty matrix upgrades to an empty matrix', () => {
    expect(upgradeLeadMelodyV1([])).toEqual([]);
  });
});

describe('isLegacyLeadMelody', () => {
  test('accepts a matrix of strings, including empty rows', () => {
    expect(isLegacyLeadMelody([['C4'], []])).toBe(true);
    expect(isLegacyLeadMelody([])).toBe(true);
  });

  test('rejects the already-upgraded object shape', () => {
    expect(isLegacyLeadMelody([[{ note: 'C4', len: 1 }]])).toBe(false);
  });

  test('rejects non-matrix values', () => {
    expect(isLegacyLeadMelody(undefined)).toBe(false);
    expect(isLegacyLeadMelody('C4')).toBe(false);
    expect(isLegacyLeadMelody(['C4'])).toBe(false);
  });
});

describe('leadStoredIndexAt', () => {
  test('maps a loop column to its stored slot through the per-bar window', () => {
    expect(leadStoredIndexAt(0, 16, 2)).toBe(0);
    expect(leadStoredIndexAt(15, 16, 2)).toBe(30);
    expect(leadStoredIndexAt(16, 16, 2)).toBe(48);
    expect(leadStoredIndexAt(12, 12, 2)).toBe(48);
  });
});

describe('leadActivePosAt', () => {
  test('inverts leadStoredIndexAt for every column the meter can reach', () => {
    for (const stepsPerBar of [12, 16, 24]) {
      for (let step = 0; step < stepsPerBar * 3; step++) {
        expect(leadActivePosAt(leadStoredIndexAt(step, stepsPerBar, 2), stepsPerBar, 2)).toBe(step);
      }
    }
  });

  test('a DORMANT slot has no active position', () => {
    // 4/4 reaches ticks 0-31 of each 48-tick bar; 32-47 are drawn only in a
    // wider meter. Answering with a position anyway yields one past the loop
    // end — the fictitious value resizeLeadMelody was already fixed for.
    expect(leadActivePosAt(36, 16, 2)).toBe(-1);
    expect(leadActivePosAt(48 + 40, 16, 2)).toBe(-1);
    expect(leadActivePosAt(36, 24, 2)).toBe(18);
  });
});

describe('leadCoveringNoteIndex', () => {
  test('returns the START index of a note covering a step in its middle', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 8 }];
    expect(leadCoveringNoteIndex(m, 0, 16, 2, 'C4')).toBe(0);
    expect(leadCoveringNoteIndex(m, 2, 16, 2, 'C4')).toBe(0);
    expect(leadCoveringNoteIndex(m, 3, 16, 2, 'C4')).toBe(0);
  });

  test('returns -1 one column past the note and for an empty column', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 8 }];
    expect(leadCoveringNoteIndex(m, 4, 16, 2, 'C4')).toBe(-1);
    expect(leadCoveringNoteIndex(m, 9, 16, 2, 'C4')).toBe(-1);
  });

  test('is per pitch row — another pitch inside the span is not covered', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 8 }];
    expect(leadCoveringNoteIndex(m, 2, 16, 2, 'G4')).toBe(-1);
  });

  test('finds a note that started in the previous bar', () => {
    const m = [...oneBar(), ...oneBar()];
    m[30] = [{ note: 'A4', len: 6 }];
    expect(leadCoveringNoteIndex(m, 17, 16, 2, 'A4')).toBe(30);
  });
});

describe('lead selection cursor', () => {
  test('clamps into the active window and never lands past the last column', () => {
    expect(clampLeadCursor(-3, 2, 16, 2)).toBe(0);
    expect(clampLeadCursor(99, 2, 16, 2)).toBe(31);
    expect(clampLeadCursor(5, 2, 16, 2)).toBe(5);
  });

  test('a cursor left outside the window by a METER change is pulled back in', () => {
    // 24 columns in 12/8, then the meter drops to 4/4 and the loop is 16 wide.
    expect(clampLeadCursor(20, 1, 16, 2)).toBe(15);
  });

  test('a non-number cursor collapses to the start rather than poisoning the grid', () => {
    expect(clampLeadCursor(Number.NaN, 1, 16, 2)).toBe(0);
    expect(clampLeadCursor(2.6, 1, 16, 2)).toBe(3);
  });

  test('the selected bar is derived from the cursor, never stored beside it', () => {
    expect(leadCursorBar(0, 16, 2)).toBe(0);
    expect(leadCursorBar(15, 16, 2)).toBe(0);
    expect(leadCursorBar(16, 16, 2)).toBe(1);
    expect(leadCursorBar(35, 16, 2)).toBe(2);
  });
});

function emptyMelody(bars: number): LeadNote[][] {
  return Array.from({ length: bars * 48 }, () => [] as LeadNote[]);
}

describe('copyLeadBar', () => {
  test('copies the bar at its FULL stored width, dormant slots included', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 2 }];
    steps[36] = [{ note: 'E4', len: 2 }]; // dormant in 4/4, reachable in 12/8
    const clip = copyLeadBar(steps, 0);
    expect(clip).toHaveLength(48);
    expect(clip[0]).toEqual([{ note: 'C4', len: 2 }]);
    expect(clip[36]).toEqual([{ note: 'E4', len: 2 }]);
  });

  test('the clipboard is a deep copy — editing the grid afterwards must not rewrite it', () => {
    const steps = emptyMelody(1);
    steps[0] = [{ note: 'C4', len: 2 }];
    const clip = copyLeadBar(steps, 0);
    steps[0][0].len = 8;
    expect(clip[0]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('a bar past the end of the melody copies as silence, not undefined rows', () => {
    expect(copyLeadBar(emptyMelody(1), 5).every((row) => row.length === 0)).toBe(true);
  });
});

describe('pasteLeadBar', () => {
  test('overwrites the target bar and leaves every other bar alone', () => {
    const steps = emptyMelody(3);
    steps[0] = [{ note: 'C4', len: 2 }];
    steps[48] = [{ note: 'D4', len: 2 }];
    steps[96] = [{ note: 'E4', len: 2 }];
    const next = pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 3);
    expect(next[0]).toEqual([{ note: 'C4', len: 2 }]);
    expect(next[48]).toEqual([{ note: 'C4', len: 2 }]);
    expect(next[96]).toEqual([{ note: 'E4', len: 2 }]);
  });

  test('pasting a bar over itself changes nothing', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 6 }];
    steps[40] = [{ note: 'G4', len: 2 }];
    expect(pasteLeadBar(steps, 0, copyLeadBar(steps, 0), 16, 2)).toEqual(steps);
  });

  test('a note reaching across the bar line INTO the target is truncated at the line', () => {
    // Without this the paste leaves two notes of one pitch sounding at once,
    // which is exactly what the store's overlap invariant forbids.
    const steps = emptyMelody(2);
    steps[28] = [{ note: 'C4', len: 12 }]; // ticks 28..39, crosses into bar 1 at 32
    const next = pasteLeadBar(steps, 1, copyLeadBar(emptyMelody(1), 0), 16, 2);
    expect(next[28]).toEqual([{ note: 'C4', len: 4 }]);
  });

  test('an OFF-GRID note reaching across the bar line is truncated too', () => {
    // Invariant 1 is a rule about STORAGE, and a paste is an explicit edit:
    // "quiet, not gone" protects a change of VIEW only. Tick 30 is off the
    // grid at 1/8, so gating the truncation on leadActivePosAt left this
    // note whole and put two C4 note-ons on the same instant — invisible at
    // 1/8, audible the moment the loop was opened at 1/32.
    const steps = emptyMelody(2);
    steps[30] = [{ note: 'C4', len: 8 }]; // ticks 30..37, crosses into bar 1 at 32
    const clip = copyLeadBar(emptyMelody(1), 0);
    clip[0] = [{ note: 'C4', len: 4 }];
    const next = pasteLeadBar(steps, 1, clip, 16, 2);
    expect(next[30]).toEqual([{ note: 'C4', len: 2 }]);
    // Read at 1/32, where the survivor would have shown up: one note-on.
    expect(leadSoundingNotes(next, 32, 16, 1).filter((n) => n.note === 'C4')).toEqual([
      { note: 'C4', len: 4, age: 0 },
    ]);
  });

  test('an OFF-GRID pasted note is clamped to the loop end', () => {
    // The milder half of the same defect: masked at read time by
    // leadAudibleLen, but a note whose stored end runs past the loop is
    // still a violation of invariant 2 in STORAGE.
    const steps = emptyMelody(2);
    const clip = copyLeadBar(emptyMelody(1), 0);
    clip[30] = [{ note: 'C4', len: 20 }]; // loop tick 62 of 64, off the 1/8 grid
    const next = pasteLeadBar(steps, 1, clip, 16, 2);
    expect(next[48 + 30]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('a note that stops exactly at the bar line is left alone', () => {
    const steps = emptyMelody(2);
    steps[28] = [{ note: 'C4', len: 4 }];
    const next = pasteLeadBar(steps, 1, copyLeadBar(emptyMelody(1), 0), 16, 2);
    expect(next[28]).toEqual([{ note: 'C4', len: 4 }]);
  });

  test('a pasted note is clamped to the loop end — notes never wrap', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 40 }];
    const next = pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 2);
    expect(next[48]).toEqual([{ note: 'C4', len: 32 }]);
  });

  test('a pasted note SWALLOWS the same pitch in the bars it reaches over', () => {
    const steps = emptyMelody(3);
    steps[0] = [{ note: 'C4', len: 40 }]; // reaches 4 columns into the next bar
    steps[100] = [{ note: 'C4', len: 2 }]; // bar 2, column 34 — under the paste
    steps[104] = [{ note: 'G4', len: 2 }]; // a different pitch survives
    const next = pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 3);
    expect(next[48]).toEqual([{ note: 'C4', len: 40 }]);
    expect(next[100]).toEqual([]);
    expect(next[104]).toEqual([{ note: 'G4', len: 2 }]);
  });

  test('does not mutate the melody it was given', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 2 }];
    const before = JSON.stringify(steps);
    pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 2);
    expect(JSON.stringify(steps)).toBe(before);
  });
});

describe('resizeLeadMelody shares the one dormancy test', () => {
  test('it does not compute a position of its own', () => {
    // Resolution adds a SECOND kind of dormancy (off-grid, not just
    // outside-the-bar). Two copies of the test would drift the moment the
    // second one lands, and the failure mode is silent: a loop-length
    // change clamping an off-grid note's len against a fictitious column.
    const src = readFileSync(new URL('./leadMelody.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function resizeLeadMelody'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    expect(fn).toContain('leadActivePosAt');
    expect(fn).not.toContain('offset >= stepsPerBar');
    expect(fn).not.toContain('barIndex * stepsPerBar + offset');
  });
});

describe('column <-> stored index, at every stride', () => {
  const round = (stepsPerBar: number, stride: number): void => {
    const cols = columnsPerBar(stepsPerBar, stride) * 2; // two bars
    for (let col = 0; col < cols; col++) {
      const stored = leadStoredIndexAt(col, stepsPerBar, stride);
      expect(leadActivePosAt(stored, stepsPerBar, stride)).toBe(col);
    }
  };

  test('round-trips in 4/4 at 1/8, 1/16 and 1/32', () => {
    round(16, 4);
    round(16, 2);
    round(16, 1);
  });

  test('round-trips in 7/8 — the odd meter, at every stride', () => {
    // 28 ticks a bar: 7 columns at 1/8, 14 at 1/16, 28 at 1/32. The row the
    // spec calls out, because 7/8 is the meter whose bar is not a multiple
    // of 4 and the one arpStepFor exists for.
    round(14, 4);
    round(14, 2);
    round(14, 1);
  });

  test('bar 1 starts at the stored width whatever the stride', () => {
    // The stored index is the ONE space that depends on neither meter nor
    // resolution, which is what makes a .solna body portable between them.
    expect(leadStoredIndexAt(columnsPerBar(16, 4), 16, 4)).toBe(LEAD_TICKS_PER_BAR);
    expect(leadStoredIndexAt(columnsPerBar(16, 2), 16, 2)).toBe(LEAD_TICKS_PER_BAR);
    expect(leadStoredIndexAt(columnsPerBar(16, 1), 16, 1)).toBe(LEAD_TICKS_PER_BAR);
  });

  test('a column is stride ticks wide', () => {
    expect(leadStoredIndexAt(1, 16, 1)).toBe(1);
    expect(leadStoredIndexAt(1, 16, 2)).toBe(2);
    expect(leadStoredIndexAt(1, 16, 4)).toBe(4);
  });
});

describe('leadActivePosAt knows both kinds of dormancy', () => {
  test('outside the bar: the meter cannot reach this tick', () => {
    // 4/4 is 32 ticks of a 48-tick stored bar. Tick 32 exists in 12/8 and
    // is unreachable in 4/4 — quiet, not gone, and it comes back.
    expect(leadActivePosAt(32, 16, 2)).toBe(-1);
    expect(leadActivePosAt(32, 24, 2)).toBe(16);
  });

  test('off the grid: the resolution cannot reach this tick', () => {
    // Tick 2 is column 1 at 1/16 and column 2 at 1/32, but at 1/8 (stride
    // 4) only multiples of 4 are reachable.
    expect(leadActivePosAt(2, 16, 4)).toBe(-1);
    expect(leadActivePosAt(2, 16, 2)).toBe(1);
    expect(leadActivePosAt(2, 16, 1)).toBe(2);
    expect(leadActivePosAt(1, 16, 2)).toBe(-1);
    expect(leadActivePosAt(1, 16, 1)).toBe(1);
  });

  test('both apply in the second bar too, not only the first', () => {
    expect(leadActivePosAt(LEAD_TICKS_PER_BAR + 2, 16, 4)).toBe(-1);
    expect(leadActivePosAt(LEAD_TICKS_PER_BAR + 32, 16, 2)).toBe(-1);
    expect(leadActivePosAt(LEAD_TICKS_PER_BAR + 4, 16, 4)).toBe(9);
  });
});

describe('leadSoundingNotes carries age in ticks', () => {
  const melody = (): LeadNote[][] => {
    const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    steps[0] = [{ note: 'C4', len: 8 }]; // a quarter note: 8 ticks, always
    return steps;
  };

  test('a quarter note is still sounding four columns later at 1/16', () => {
    const s = leadSoundingNotes(melody(), 3, 16, 2);
    expect(s).toEqual([{ note: 'C4', len: 8, age: 6 }]);
  });

  test('the same note, the same duration, at 1/8 and at 1/32', () => {
    // age = columnsBack * stride, so the note's audible span is identical
    // at every resolution — only the number of cells it covers changes.
    expect(leadSoundingNotes(melody(), 1, 16, 4)).toEqual([{ note: 'C4', len: 8, age: 4 }]);
    expect(leadSoundingNotes(melody(), 2, 16, 4)).toEqual([]);
    expect(leadSoundingNotes(melody(), 7, 16, 1)).toEqual([{ note: 'C4', len: 8, age: 7 }]);
    expect(leadSoundingNotes(melody(), 8, 16, 1)).toEqual([]);
  });

  test('an off-grid note is never visited, so it is simply silent', () => {
    // No branch anywhere else: the scheduler reads through columns only.
    const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    steps[1] = [{ note: 'C4', len: 1 }];
    expect(leadSoundingNotes(steps, 1, 16, 2)).toEqual([]);
    expect(leadSoundingNotes(steps, 1, 16, 1)).toEqual([{ note: 'C4', len: 1, age: 0 }]);
  });
});

describe('resolveLeadStepTriggers rounds up to whole cells', () => {
  const params = { arpMode: 'up' as const, arpRate: '16n' as const, arpOctaves: 1 };
  const tickDur = 0.125 / TICKS_PER_SIXTEENTH; // 120 bpm 16th, halved
  const hold = (len: number, stride: number): number =>
    resolveLeadStepTriggers(
      [{ note: 'C4', len, age: 0 }],
      false,
      0,
      params,
      tickDur,
      0.85,
      stride,
      { tickInLoop: 0, melodyTicks: 32 },
    )[0].holdSec;

  test('a 1/16 project’s holdSec is byte-identical to before', () => {
    // A one-cell note at stride 2 gives gate * 2 * tickDur, which is
    // exactly the old (1 - 1 + gate) * stepDurSec. This is the bar
    // DEFAULT_LEAD_GATE was chosen to clear, and nothing that exists today
    // may move by a sample.
    expect(hold(2, 2)).toBeCloseTo(0.85 * 0.125, 10);
    expect(hold(8, 2)).toBeCloseTo((4 - 1 + 0.85) * 0.125, 10);
  });

  test('the gate trims the final CELL, not the final tick', () => {
    // (len - 1 + gate) * tickDur instead would make the gate four times
    // less audible at 1/8.
    expect(hold(8, 4)).toBeCloseTo((2 - 1 + 0.85) * 4 * tickDur, 10);
    expect(hold(8, 1)).toBeCloseTo((8 - 1 + 0.85) * 1 * tickDur, 10);
  });

  test('a note authored finer than the grid still sounds for one cell', () => {
    // The ceil and the floor of one cell are what keep a 1/32-authored note
    // audible when the loop is read at 1/8 — never a negative duration.
    expect(hold(1, 4)).toBeCloseTo(0.85 * 4 * tickDur, 10);
    expect(hold(3, 4)).toBeCloseTo(0.85 * 4 * tickDur, 10);
    expect(hold(5, 4)).toBeCloseTo((2 - 1 + 0.85) * 4 * tickDur, 10);
  });

  test('the loop end caps the audible length in ticks', () => {
    const triggers = resolveLeadStepTriggers(
      [{ note: 'C4', len: 64, age: 0 }],
      false,
      0,
      params,
      tickDur,
      1,
      2,
      { tickInLoop: 0, melodyTicks: 32 },
    );
    expect(triggers[0].holdSec).toBeCloseTo(16 * 2 * tickDur, 10);
  });
});

describe('the stored width moves with the melody, not with the sequencer', () => {
  test('resizeLeadMelody pads whole stored bars', () => {
    const one = Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]);
    expect(resizeLeadMelody(one, 2, 16, 2)).toHaveLength(2 * LEAD_TICKS_PER_BAR);
    expect(resizeLeadMelody(one, 2, 16, 2).slice(LEAD_TICKS_PER_BAR)).toEqual(
      Array.from({ length: LEAD_TICKS_PER_BAR }, () => []),
    );
  });

  test('copyLeadBar copies the full stored width, whatever is reachable', () => {
    const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    steps[1] = [{ note: 'C4', len: 1 }]; // off-grid at 1/16, still copied
    expect(copyLeadBar(steps, 0)).toHaveLength(LEAD_TICKS_PER_BAR);
    expect(copyLeadBar(steps, 0)[1]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('the cursor and its bar count columns, not 16ths', () => {
    expect(clampLeadCursor(999, 1, 16, 1)).toBe(31);
    expect(clampLeadCursor(999, 1, 16, 2)).toBe(15);
    expect(clampLeadCursor(999, 1, 16, 4)).toBe(7);
    expect(leadCursorBar(8, 16, 4)).toBe(1);
    expect(leadCursorBar(8, 16, 2)).toBe(0);
  });
});

describe('upgradeLeadMelodyToTicks', () => {
  const oldBar = (): LeadNote[][] =>
    Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]);

  test('slot i becomes tick 2i and the odd ticks are empty', () => {
    const steps = oldBar();
    steps[0] = [{ note: 'C4', len: 1 }];
    steps[3] = [{ note: 'E4', len: 1 }];
    const out = upgradeLeadMelodyToTicks(steps, 1);

    expect(out).toHaveLength(LEAD_TICKS_PER_BAR);
    expect(out[0]).toEqual([{ note: 'C4', len: 2 }]);
    expect(out[1]).toEqual([]);
    expect(out[6]).toEqual([{ note: 'E4', len: 2 }]);
    expect(out[7]).toEqual([]);
  });

  test('every len doubles, because len now counts ticks', () => {
    // A note that was 4 sixteenths long is 8 ticks long. Same music, and
    // the same holdSec once resolveLeadStepTriggers rounds it to cells.
    const steps = oldBar();
    steps[0] = [{ note: 'C4', len: 4 }];
    expect(upgradeLeadMelodyToTicks(steps, 1)[0]).toEqual([{ note: 'C4', len: 8 }]);
  });

  test('a dormant slot the meter could not reach survives the widening', () => {
    // Slot 20 is unreachable in 4/4 and reachable in 12/8. Quiet, not gone
    // — the widening must not be the thing that finally loses it.
    const steps = oldBar();
    steps[20] = [{ note: 'G5', len: 1 }];
    expect(upgradeLeadMelodyToTicks(steps, 1)[40]).toEqual([{ note: 'G5', len: 2 }]);
  });

  test('widens every bar, not just the first', () => {
    const steps = [...oldBar(), ...oldBar()];
    steps[MAX_STEPS_PER_BAR] = [{ note: 'A4', len: 2 }];
    const out = upgradeLeadMelodyToTicks(steps, 2);
    expect(out).toHaveLength(2 * LEAD_TICKS_PER_BAR);
    expect(out[LEAD_TICKS_PER_BAR]).toEqual([{ note: 'A4', len: 4 }]);
  });

  test('a ragged payload is padded rather than dropped', () => {
    expect(upgradeLeadMelodyToTicks([[{ note: 'C4', len: 1 }]], 1)).toHaveLength(
      LEAD_TICKS_PER_BAR,
    );
  });

  test('`bars` pads a melody narrower than the loop', () => {
    // The floor half of the rule: one old bar of data in a two-bar loop
    // still comes back two bars wide, so the loop keeps its shape.
    const steps = oldBar();
    steps[0] = [{ note: 'C4', len: 1 }];
    const out = upgradeLeadMelodyToTicks(steps, 2);
    expect(out).toHaveLength(2 * LEAD_TICKS_PER_BAR);
    expect(out[0]).toEqual([{ note: 'C4', len: 2 }]);
  });

  // setLeadLoopLengthPreserve lowers leadLoopLength WITHOUT resizing the
  // melody on purpose, so a stored melody wider than `bars` is an ordinary
  // persisted state, not a corrupt one. Trusting `bars` over the data
  // re-read old bar 1 at half its beat (2x) or deleted it outright (3x, 4x).
  for (const surplus of [2, 3, 4]) {
    test(`a melody ${surplus}x wider than \`bars\` widens every bar it holds`, () => {
      const steps: LeadNote[][] = [];
      for (let bar = 0; bar < surplus; bar++) {
        const rows = oldBar();
        rows[4] = [{ note: 'C4', len: 4 }];
        steps.push(...rows);
      }
      const out = upgradeLeadMelodyToTicks(steps, 1);

      expect(out).toHaveLength(surplus * LEAD_TICKS_PER_BAR);
      for (let bar = 0; bar < surplus; bar++) {
        expect(out[bar * LEAD_TICKS_PER_BAR + 8]).toEqual([{ note: 'C4', len: 8 }]);
        expect(out[bar * LEAD_TICKS_PER_BAR + 4]).toEqual([]);
      }
    });
  }
});
