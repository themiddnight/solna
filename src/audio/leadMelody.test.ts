import { describe, expect, test } from 'bun:test';
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
  type LeadNote,
} from './leadMelody';
import { buildArpSequence } from './arpeggiator';
import { computeArpTriggers } from './arpSchedule';

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
  const twoBars = Array.from({ length: 48 }, (_, i) =>
    i < 24 ? [{ note: 'C4', len: 1 }] : [{ note: 'E4', len: 1 }],
  );
  test('pads empty bars when growing', () => {
    const out = resizeLeadMelody([[{ note: 'C4', len: 1 }]], 2, 16);
    expect(out).toHaveLength(48);
    expect(out[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(out[24]).toEqual([]);
    expect(out[47]).toEqual([]);
  });
  test('trims trailing bars when shrinking', () => {
    const out = resizeLeadMelody(twoBars, 1, 16);
    expect(out).toHaveLength(24);
    expect(out[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(out[24]).toBeUndefined();
  });

  test('clamps a note that would overhang the new loop end when shrinking', () => {
    const m: LeadNote[][] = [...Array.from({ length: 24 }, () => [] as LeadNote[]), ...Array.from({ length: 24 }, () => [] as LeadNote[])];
    m[14] = [{ note: 'C4', len: 6 }];
    const out = resizeLeadMelody(m, 1, 16);
    expect(out).toHaveLength(24);
    expect(out[14]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('leaves a note that still fits alone', () => {
    const m: LeadNote[][] = Array.from({ length: 24 }, () => [] as LeadNote[]);
    m[8] = [{ note: 'C4', len: 4 }];
    expect(resizeLeadMelody(m, 1, 16)[8]).toEqual([{ note: 'C4', len: 4 }]);
  });

  test('never clamps below 1, even in a bar other than the first', () => {
    // Bar index 1, last active offset of 4/4 (15): activePos = 1*16+15 = 31,
    // loopEnd = 2*16 = 32, so the true remaining capacity is 1 step. A
    // formula that forgot the barIndex term (e.g. loopEnd - offset) would
    // wrongly compute 17 here instead of 1 -- this fixture, unlike bar 0,
    // catches that.
    const m: LeadNote[][] = [...Array.from({ length: 24 }, () => [] as LeadNote[]), ...Array.from({ length: 24 }, () => [] as LeadNote[])];
    m[24 + 15] = [{ note: 'C4', len: 99 }];
    expect(resizeLeadMelody(m, 2, 16)[24 + 15]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('a dormant slot the active meter cannot reach survives resize untouched', () => {
    // stepsPerBar 16: stored slot 18 is offset 18 in bar 0, which is >= 16 and
    // so unreachable by the active meter. Shrinking to newLoopLength 1 must
    // NOT rewrite its len -- it is dormant, not overhanging (leadSlice.test.ts's
    // "a meter change never touches the stored melody" invariant).
    const m: LeadNote[][] = Array.from({ length: 24 }, () => [] as LeadNote[]);
    m[18] = [{ note: 'C4', len: 3 }];
    expect(resizeLeadMelody(m, 1, 16)[18]).toEqual([{ note: 'C4', len: 3 }]);
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

const oneBar = (): LeadNote[][] => Array.from({ length: 24 }, () => [] as LeadNote[]);

describe('leadSoundingNotes', () => {
  test('age counts how many steps ago the note started', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 3 }];
    expect(leadSoundingNotes(m, 0, 16)).toEqual([{ note: 'C4', len: 3, age: 0 }]);
    expect(leadSoundingNotes(m, 1, 16)).toEqual([{ note: 'C4', len: 3, age: 1 }]);
    expect(leadSoundingNotes(m, 2, 16)).toEqual([{ note: 'C4', len: 3, age: 2 }]);
    expect(leadSoundingNotes(m, 3, 16)).toEqual([]);
  });

  test('lists notes starting here before notes still sounding from earlier', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 4 }];
    m[2] = [{ note: 'G4', len: 1 }];
    expect(leadSoundingNotes(m, 2, 16)).toEqual([
      { note: 'G4', len: 1, age: 0 },
      { note: 'C4', len: 4, age: 2 },
    ]);
  });

  test('the lookback stops at step 0 of the loop', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 1 }];
    expect(leadSoundingNotes(m, 0, 16)).toEqual([{ note: 'C4', len: 1, age: 0 }]);
    expect(leadSoundingNotes(m, 1, 16)).toEqual([]);
  });

  test('a note held across the bar line keeps sounding', () => {
    const m = [...oneBar(), ...oneBar()];
    m[15] = [{ note: 'A4', len: 3 }];
    expect(leadSoundingNotes(m, 15, 16)).toEqual([{ note: 'A4', len: 3, age: 0 }]);
    expect(leadSoundingNotes(m, 16, 16)).toEqual([{ note: 'A4', len: 3, age: 1 }]);
    expect(leadSoundingNotes(m, 17, 16)).toEqual([{ note: 'A4', len: 3, age: 2 }]);
  });

  test('the stored width is windowed to the ACTIVE stepsPerBar', () => {
    const m = [...oneBar(), ...oneBar()];
    m[24] = [{ note: 'E4', len: 1 }];
    m[12] = [{ note: 'D4', len: 1 }];
    // stepsPerBar 12: loop step 12 is bar 1 step 0 -> stored 24.
    expect(leadSoundingNotes(m, 12, 12)).toEqual([{ note: 'E4', len: 1, age: 0 }]);
    // stepsPerBar 16: loop step 12 is bar 0 step 12 -> stored 12.
    expect(leadSoundingNotes(m, 12, 16)).toEqual([{ note: 'D4', len: 1, age: 0 }]);
  });

  test('windowed at 24 steps (12/8) the full bar is reachable', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 1 }];
    expect(leadSoundingNotes(m, 0, 24)).toEqual([{ note: 'C4', len: 1, age: 0 }]);
  });

  test('a step past the stored melody resolves to a rest (empty array)', () => {
    const m = [...oneBar(), ...oneBar()];
    m[0] = [{ note: 'C4', len: 1 }];
    expect(leadSoundingNotes(m, 1000, 16)).toEqual([]);
  });
});

const ARP_PARAMS = { arpMode: 'up' as const, arpRate: '16n' as const, arpOctaves: 1 };
const STEP_DUR = 0.125;
/** A 1-bar 4/4 loop seen from its first step — no invariant-2 cap in play. */
const WHOLE_BAR = { stepInLoop: 0, melodyLength: 16 };

describe('resolveLeadStepTriggers — block mode', () => {
  test('holdSec is (len - 1 + gate) * stepDurSec', () => {
    const one = [{ note: 'C4', len: 1, age: 0 }];
    const three = [{ note: 'C4', len: 3, age: 0 }];
    expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, STEP_DUR, 0.5, WHOLE_BAR)[0].holdSec).toBe(0.0625);
    expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, STEP_DUR, 1, WHOLE_BAR)[0].holdSec).toBe(0.125);
    expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR)[0].holdSec).toBeCloseTo(0.10625, 10);
    expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, STEP_DUR, 0.5, WHOLE_BAR)[0].holdSec).toBe(0.3125);
    expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, STEP_DUR, 1, WHOLE_BAR)[0].holdSec).toBe(0.375);
    expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR)[0].holdSec).toBeCloseTo(0.35625, 10);
  });

  test('at gate 1.0 a note ends exactly where the next step begins (legato)', () => {
    const t = resolveLeadStepTriggers([{ note: 'C4', len: 2, age: 0 }], false, 0, ARP_PARAMS, STEP_DUR, 1, WHOLE_BAR);
    expect(t[0].holdSec).toBe(2 * STEP_DUR);
  });

  test('notes with age > 0 emit nothing — their note-off is already scheduled', () => {
    const t = resolveLeadStepTriggers(
      [{ note: 'G4', len: 1, age: 0 }, { note: 'C4', len: 4, age: 2 }],
      false, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR,
    );
    expect(t.map((x) => x.note)).toEqual(['G4']);
  });

  test('a step where every sounding note is held from earlier emits nothing', () => {
    expect(resolveLeadStepTriggers([{ note: 'C4', len: 4, age: 2 }], false, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR)).toEqual([]);
  });
});

/**
 * Invariant 2 ("start + len never crosses the loop end") is enforced on write
 * and on a loop-length change — neither of which fires on a METER change, and
 * a meter change is deliberately non-destructive (leadSlice.test.ts pins that
 * the stored melody is never touched). `len` counts ACTIVE steps, so 12/8's
 * 24-step bar can hold a len-20 note that becomes illegal the moment 4/4
 * makes the bar 16 steps long. The cap therefore has to happen at READ time:
 * leadCellKinds already truncates the drawn span to the active columns, and
 * without this the audio would disagree with the grid and ring across the
 * loop seam where the same pitch re-triggers.
 */
describe('resolveLeadStepTriggers — invariant 2 is capped at READ time', () => {
  test('a note left overhanging by a meter change is capped to the loop end', () => {
    // Drawn legally in 12/8 (stepsPerBar 24): len 20 at column 0. In 4/4 the
    // loop is 16 active steps, so the note may sound for at most 16.
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 20, age: 0 }],
      false, 0, ARP_PARAMS, STEP_DUR, 1, { stepInLoop: 0, melodyLength: 16 },
    );
    expect(t[0].holdSec).toBe(16 * STEP_DUR);
    // Uncapped it would ring for 20 steps — 1.25 bars, straight over the seam.
    expect(t[0].holdSec).toBeLessThan(20 * STEP_DUR);
  });

  test('the cap is measured from the note START, not from the current step', () => {
    // Same note, seen from step 8 with age 8: 8 steps of it are already gone,
    // so the remaining capacity is still measured from step 0.
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 20, age: 0 }],
      false, 0, ARP_PARAMS, STEP_DUR, 1, { stepInLoop: 8, melodyLength: 16 },
    );
    expect(t[0].holdSec).toBe(8 * STEP_DUR);
  });

  test('a note that still fits is untouched', () => {
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 4, age: 0 }],
      false, 0, ARP_PARAMS, STEP_DUR, 1, { stepInLoop: 0, melodyLength: 16 },
    );
    expect(t[0].holdSec).toBe(4 * STEP_DUR);
  });

  test('the cap never drops a note below one step', () => {
    const t = resolveLeadStepTriggers(
      [{ note: 'C4', len: 9, age: 0 }],
      false, 0, ARP_PARAMS, STEP_DUR, 0.85, { stepInLoop: 20, melodyLength: 16 },
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
      { note: 'C4', len: 1, age: 0 },
      { note: 'E4', len: 1, age: 0 },
      { note: 'G4', len: 1, age: 0 },
    ];
    const t = resolveLeadStepTriggers(sounding, true, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR);
    expect(t).toEqual([{ note: 'C4', timeOffsetSec: 0, holdSec: 0.10625 }]);
  });

  test('all sounding notes feed the arp pool, including age > 0 (asserted by note name)', () => {
    const withHeld = resolveLeadStepTriggers(
      [{ note: 'G4', len: 1, age: 0 }, { note: 'C4', len: 4, age: 2 }],
      true, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR,
    );
    const startsOnly = resolveLeadStepTriggers(
      [{ note: 'G4', len: 1, age: 0 }],
      true, 0, ARP_PARAMS, STEP_DUR, 0.85, WHOLE_BAR,
    );
    // C4 (midi 60) sorts before G4 (midi 67): once the age-2 C4 joins the
    // pool it plays FIRST on step 0 instead of G4 alone.
    expect(withHeld).toEqual([{ note: 'C4', timeOffsetSec: 0, holdSec: 0.10625 }]);
    expect(startsOnly).toEqual([{ note: 'G4', timeOffsetSec: 0, holdSec: 0.10625 }]);
  });

  test('gate does not reach the arp — its hold comes from arpRate', () => {
    const atLowGate = resolveLeadStepTriggers(
      [{ note: 'C4', len: 1, age: 0 }, { note: 'E4', len: 1, age: 0 }],
      true, 0, ARP_PARAMS, STEP_DUR, 0.05, WHOLE_BAR,
    );
    const atFullGate = resolveLeadStepTriggers(
      [{ note: 'C4', len: 1, age: 0 }, { note: 'E4', len: 1, age: 0 }],
      true, 0, ARP_PARAMS, STEP_DUR, 1, WHOLE_BAR,
    );
    expect(atLowGate).toEqual(atFullGate);
  });
});

/**
 * THE no-op guarantee. An old melody is every note len: 1 at gate 0.85, and
 * it must produce byte-identical LeadTrigger[] to the pre-DEV-369
 * implementation with the arp both on and off. If this passes, no existing
 * music changes sound — the entire risk budget of this change.
 */
describe('no-op guarantee — an all-len-1 melody at gate 0.85', () => {
  const LEGACY_GATE = 0.85;
  const notes = ['C4', 'E4', 'G4'];
  const sounding = notes.map((note) => ({ note, len: 1, age: 0 }));

  test('block mode matches the retired `LEAD_GATE * stepDurSec` exactly', () => {
    const legacy = notes.map((note) => ({
      note,
      timeOffsetSec: 0,
      holdSec: LEGACY_GATE * STEP_DUR,
    }));
    expect(resolveLeadStepTriggers(sounding, false, 0, ARP_PARAMS, STEP_DUR, LEGACY_GATE, WHOLE_BAR)).toEqual(legacy);
  });

  test('arp ON expands octaves through the arpeggiator (unchanged)', () => {
    // Every other arp test runs at arpOctaves 1, where dropping the argument
    // in resolveLeadStepTriggers would change nothing and break no test. This
    // one runs at 2, so the octave expansion is actually pinned.
    const twoOctaves = { ...ARP_PARAMS, arpOctaves: 2 };
    const pair = ['C4', 'E4'];
    const soundingPair = pair.map((note) => ({ note, len: 1, age: 0 }));
    const sequence = buildArpSequence(pair, ARP_PARAMS.arpMode, 2);
    expect(sequence).toEqual(['C4', 'E4', 'C5', 'E5']);

    for (const arpStep of [0, 1, 2, 3, 5]) {
      const legacy = computeArpTriggers(arpStep, sequence.length, ARP_PARAMS.arpRate, STEP_DUR).map(
        (t) => ({ note: sequence[t.noteIndex], timeOffsetSec: t.timeOffsetSec, holdSec: t.holdSec }),
      );
      expect(
        resolveLeadStepTriggers(soundingPair, true, arpStep, twoOctaves, STEP_DUR, LEGACY_GATE, WHOLE_BAR),
      ).toEqual(legacy);
    }

    // And the octave count is load-bearing: at step 2 the two-octave sequence
    // plays C5 where the one-octave one plays C4.
    expect(
      resolveLeadStepTriggers(soundingPair, true, 2, twoOctaves, STEP_DUR, LEGACY_GATE, WHOLE_BAR)[0].note,
    ).toBe('C5');
    expect(
      resolveLeadStepTriggers(soundingPair, true, 2, ARP_PARAMS, STEP_DUR, LEGACY_GATE, WHOLE_BAR)[0].note,
    ).toBe('C4');
  });

  test('arp mode matches buildArpSequence + computeArpTriggers unchanged', () => {
    for (const arpStep of [0, 1, 2, 3, 4, 7]) {
      const sequence = buildArpSequence(notes, ARP_PARAMS.arpMode, ARP_PARAMS.arpOctaves);
      const legacy = computeArpTriggers(arpStep, sequence.length, ARP_PARAMS.arpRate, STEP_DUR).map(
        (t) => ({ note: sequence[t.noteIndex], timeOffsetSec: t.timeOffsetSec, holdSec: t.holdSec }),
      );
      expect(resolveLeadStepTriggers(sounding, true, arpStep, ARP_PARAMS, STEP_DUR, LEGACY_GATE, WHOLE_BAR)).toEqual(legacy);
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
  test('maps a loop step to its stored slot through the per-bar window', () => {
    expect(leadStoredIndexAt(0, 16)).toBe(0);
    expect(leadStoredIndexAt(15, 16)).toBe(15);
    expect(leadStoredIndexAt(16, 16)).toBe(24);
    expect(leadStoredIndexAt(12, 12)).toBe(24);
  });
});

describe('leadActivePosAt', () => {
  test('inverts leadStoredIndexAt for every step the meter can reach', () => {
    for (const stepsPerBar of [12, 16, 24]) {
      for (let step = 0; step < stepsPerBar * 3; step++) {
        expect(leadActivePosAt(leadStoredIndexAt(step, stepsPerBar), stepsPerBar)).toBe(step);
      }
    }
  });

  test('a DORMANT slot has no active position', () => {
    // 4/4 reaches offsets 0-15 of each 24-slot bar; 16-23 are drawn only in a
    // wider meter. Answering with a position anyway yields one past the loop
    // end — the fictitious value resizeLeadMelody was already fixed for.
    expect(leadActivePosAt(18, 16)).toBe(-1);
    expect(leadActivePosAt(24 + 20, 16)).toBe(-1);
    expect(leadActivePosAt(18, 24)).toBe(18);
  });
});

describe('leadCoveringNoteIndex', () => {
  test('returns the START index of a note covering a step in its middle', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 4 }];
    expect(leadCoveringNoteIndex(m, 0, 16, 'C4')).toBe(0);
    expect(leadCoveringNoteIndex(m, 2, 16, 'C4')).toBe(0);
    expect(leadCoveringNoteIndex(m, 3, 16, 'C4')).toBe(0);
  });

  test('returns -1 one step past the note and for an empty step', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 4 }];
    expect(leadCoveringNoteIndex(m, 4, 16, 'C4')).toBe(-1);
    expect(leadCoveringNoteIndex(m, 9, 16, 'C4')).toBe(-1);
  });

  test('is per pitch row — another pitch inside the span is not covered', () => {
    const m = oneBar();
    m[0] = [{ note: 'C4', len: 4 }];
    expect(leadCoveringNoteIndex(m, 2, 16, 'G4')).toBe(-1);
  });

  test('finds a note that started in the previous bar', () => {
    const m = [...oneBar(), ...oneBar()];
    m[15] = [{ note: 'A4', len: 3 }];
    expect(leadCoveringNoteIndex(m, 17, 16, 'A4')).toBe(15);
  });
});

describe('lead selection cursor', () => {
  test('clamps into the active window and never lands past the last column', () => {
    expect(clampLeadCursor(-3, 2, 16)).toBe(0);
    expect(clampLeadCursor(99, 2, 16)).toBe(31);
    expect(clampLeadCursor(5, 2, 16)).toBe(5);
  });

  test('a cursor left outside the window by a METER change is pulled back in', () => {
    // 24 columns in 12/8, then the meter drops to 4/4 and the loop is 16 wide.
    expect(clampLeadCursor(20, 1, 16)).toBe(15);
  });

  test('a non-number cursor collapses to the start rather than poisoning the grid', () => {
    expect(clampLeadCursor(Number.NaN, 1, 16)).toBe(0);
    expect(clampLeadCursor(2.6, 1, 16)).toBe(3);
  });

  test('the selected bar is derived from the cursor, never stored beside it', () => {
    expect(leadCursorBar(0, 16)).toBe(0);
    expect(leadCursorBar(15, 16)).toBe(0);
    expect(leadCursorBar(16, 16)).toBe(1);
    expect(leadCursorBar(35, 16)).toBe(2);
  });
});

function emptyMelody(bars: number): LeadNote[][] {
  return Array.from({ length: bars * 24 }, () => [] as LeadNote[]);
}

describe('copyLeadBar', () => {
  test('copies the bar at its FULL stored width, dormant slots included', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 1 }];
    steps[18] = [{ note: 'E4', len: 1 }]; // dormant in 4/4, reachable in 12/8
    const clip = copyLeadBar(steps, 0);
    expect(clip).toHaveLength(24);
    expect(clip[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(clip[18]).toEqual([{ note: 'E4', len: 1 }]);
  });

  test('the clipboard is a deep copy — editing the grid afterwards must not rewrite it', () => {
    const steps = emptyMelody(1);
    steps[0] = [{ note: 'C4', len: 1 }];
    const clip = copyLeadBar(steps, 0);
    steps[0][0].len = 8;
    expect(clip[0]).toEqual([{ note: 'C4', len: 1 }]);
  });

  test('a bar past the end of the melody copies as silence, not undefined rows', () => {
    expect(copyLeadBar(emptyMelody(1), 5).every((row) => row.length === 0)).toBe(true);
  });
});

describe('pasteLeadBar', () => {
  test('overwrites the target bar and leaves every other bar alone', () => {
    const steps = emptyMelody(3);
    steps[0] = [{ note: 'C4', len: 1 }];
    steps[24] = [{ note: 'D4', len: 1 }];
    steps[48] = [{ note: 'E4', len: 1 }];
    const next = pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 3);
    expect(next[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(next[24]).toEqual([{ note: 'C4', len: 1 }]);
    expect(next[48]).toEqual([{ note: 'E4', len: 1 }]);
  });

  test('pasting a bar over itself changes nothing', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 3 }];
    steps[20] = [{ note: 'G4', len: 1 }];
    expect(pasteLeadBar(steps, 0, copyLeadBar(steps, 0), 16, 2)).toEqual(steps);
  });

  test('a note reaching across the bar line INTO the target is truncated at the line', () => {
    // Without this the paste leaves two notes of one pitch sounding at once,
    // which is exactly what the store's overlap invariant forbids.
    const steps = emptyMelody(2);
    steps[14] = [{ note: 'C4', len: 6 }]; // active 14..19, crosses into bar 1 at 16
    const next = pasteLeadBar(steps, 1, copyLeadBar(emptyMelody(1), 0), 16, 2);
    expect(next[14]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('a note that stops exactly at the bar line is left alone', () => {
    const steps = emptyMelody(2);
    steps[14] = [{ note: 'C4', len: 2 }];
    const next = pasteLeadBar(steps, 1, copyLeadBar(emptyMelody(1), 0), 16, 2);
    expect(next[14]).toEqual([{ note: 'C4', len: 2 }]);
  });

  test('a pasted note is clamped to the loop end — notes never wrap', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 20 }];
    const next = pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 2);
    expect(next[24]).toEqual([{ note: 'C4', len: 16 }]);
  });

  test('a pasted note SWALLOWS the same pitch in the bars it reaches over', () => {
    const steps = emptyMelody(3);
    steps[0] = [{ note: 'C4', len: 20 }]; // reaches 4 steps into the next bar
    steps[50] = [{ note: 'C4', len: 1 }]; // bar 2, active 34 — under the paste
    steps[52] = [{ note: 'G4', len: 1 }]; // a different pitch survives
    const next = pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 3);
    expect(next[24]).toEqual([{ note: 'C4', len: 20 }]);
    expect(next[50]).toEqual([]);
    expect(next[52]).toEqual([{ note: 'G4', len: 1 }]);
  });

  test('does not mutate the melody it was given', () => {
    const steps = emptyMelody(2);
    steps[0] = [{ note: 'C4', len: 1 }];
    const before = JSON.stringify(steps);
    pasteLeadBar(steps, 1, copyLeadBar(steps, 0), 16, 2);
    expect(JSON.stringify(steps)).toBe(before);
  });
});
