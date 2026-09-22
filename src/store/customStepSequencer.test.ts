import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { VIBES } from '../data/vibes';
import { applyVibeToStore, resolveVibe } from './vibes';
import type { BassStepChoice } from '@/data/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import { createDefaultLoop } from './loopSlice';
import type { ChordItem } from '../types';

/**
 * Reset every field these tests touch — the four new ones included, since a
 * loop length or a hold left behind by one test would change the cycle the
 * next test's column arithmetic lands in.
 */
function resetCustomFields(): void {
  useAppStore.setState({
    meterId: '4/4',
    chords: createDefaultLoop().chords,
    chordRhythmMode: 'preset',
    bassPatternMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    customChordLoopLength: 1,
    customChordHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
    customBassLoopLength: 1,
    customBassHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
  });
}

/** Three bars: two chords, so 4/4's divisors are 1 and 3 — not the factory's 1, 2, 4. */
const THREE_BAR_CHORDS: ChordItem[] = [
  { id: 'c1', root: 'A', quality: 'min7', bars: 2 },
  { id: 'c2', root: 'F', quality: 'maj7', bars: 1 },
];

describe('custom step sequencer — store defaults', () => {
  beforeEach(resetCustomFields);

  test('both modes default to preset with silent MAX-width grids', () => {
    const s = useAppStore.getState();
    expect(s.chordRhythmMode).toBe('preset');
    expect(s.bassPatternMode).toBe('preset');
    expect(s.customChordRhythm).toEqual(new Array<boolean>(MAX_STEPS_PER_BAR).fill(false));
    expect(s.customBassPattern).toEqual(new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'));
  });

  test('both lanes default to a one-bar cycle with a one-step hold on every slot', () => {
    const s = useAppStore.getState();
    expect(s.customChordLoopLength).toBe(1);
    expect(s.customChordHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
    expect(s.customBassLoopLength).toBe(1);
    expect(s.customBassHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
  });
});

describe('custom step sequencer — setters store verbatim', () => {
  beforeEach(resetCustomFields);

  test('setCustomChordRhythm stores the grid as-is', () => {
    const grid = [...new Array<boolean>(MAX_STEPS_PER_BAR).fill(false)];
    grid[0] = true;
    grid[5] = true;
    useAppStore.getState().setChordRhythmMode('custom');
    useAppStore.getState().setCustomChordRhythm(grid);
    const s = useAppStore.getState();
    expect(s.chordRhythmMode).toBe('custom');
    expect(s.customChordRhythm).toEqual(grid);
    expect(s.customChordRhythm.length).toBe(MAX_STEPS_PER_BAR);
  });

  test('setCustomBassPattern stores the choice grid as-is', () => {
    const choices: BassStepChoice[] = new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest');
    choices[0] = 'root';
    choices[4] = 'fifth';
    choices[12] = 'octave';
    useAppStore.getState().setBassPatternMode('custom');
    useAppStore.getState().setCustomBassPattern(choices);
    const s = useAppStore.getState();
    expect(s.bassPatternMode).toBe('custom');
    expect(s.customBassPattern).toEqual(choices);
  });
});

describe('custom step sequencer — an explicit loop length grows and trims by whole bars', () => {
  beforeEach(resetCustomFields);

  test('growing to two bars doubles both chord arrays and pads holds at one', () => {
    useAppStore.getState().setCustomChordLoopLength(2);
    const after = useAppStore.getState();
    expect(after.customChordLoopLength).toBe(2);
    expect(after.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(after.customChordHoldSteps).toHaveLength(2 * MAX_STEPS_PER_BAR);
    // The new bar is empty and every new slot holds one step — never 0, which
    // would read as a zero-length onset rather than a rest.
    expect(after.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(false);
    expect(after.customChordHoldSteps.every((hold) => hold === 1)).toBe(true);
  });

  test('trimming keeps the leading bars and drops the rest', () => {
    const s = useAppStore.getState();
    s.setCustomChordLoopLength(2);
    // Bar two, offset 0: stored slot MAX_STEPS_PER_BAR in a bar-major row.
    useAppStore.getState().setCustomChordEvent(16, true);
    expect(useAppStore.getState().customChordLoopLength).toBe(2);

    useAppStore.getState().setCustomChordLoopLength(1);
    const after = useAppStore.getState();
    expect(after.customChordLoopLength).toBe(1);
    expect(after.customChordRhythm).toHaveLength(MAX_STEPS_PER_BAR);
    expect(after.customChordHoldSteps).toHaveLength(MAX_STEPS_PER_BAR);
  });

  test('a length that does not divide the progression clamps down to the nearest divisor', () => {
    // Four one-bar chords: the divisors are 1, 2 and 4, so 3 is not a cycle the
    // progression can repeat evenly.
    useAppStore.getState().setCustomChordLoopLength(3);
    expect(useAppStore.getState().customChordLoopLength).toBe(2);
    expect(useAppStore.getState().customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
  });

  test('the two lanes carry independent lengths', () => {
    useAppStore.getState().setCustomChordLoopLength(2);
    useAppStore.getState().setCustomBassLoopLength(4);
    const after = useAppStore.getState();
    expect(after.customChordLoopLength).toBe(2);
    expect(after.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(after.customBassLoopLength).toBe(4);
    expect(after.customBassPattern).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(after.customBassHoldSteps).toHaveLength(4 * MAX_STEPS_PER_BAR);
  });
});

describe('custom step sequencer — events and their lengths', () => {
  beforeEach(resetCustomFields);

  test('setCustomChordEvent writes one onset, and writes it back off again', () => {
    useAppStore.getState().setCustomChordEvent(0, true);
    let after = useAppStore.getState();
    expect(after.customChordRhythm[0]).toBe(true);
    expect(after.customChordHoldSteps[0]).toBe(1);

    useAppStore.getState().setCustomChordEvent(0, false);
    after = useAppStore.getState();
    expect(after.customChordRhythm[0]).toBe(false);
    expect(after.customChordHoldSteps[0]).toBe(1);
  });

  test('setCustomChordEventLength grows the span and deletes the onsets it covers', () => {
    const s = useAppStore.getState();
    s.setCustomChordEvent(0, true);
    s.setCustomChordEvent(4, true);

    useAppStore.getState().setCustomChordEventLength(0, 8);

    const after = useAppStore.getState();
    expect(after.customChordHoldSteps[0]).toBe(8);
    // An explicit edit deletes what it covers — the Lead/FX rule, applied to a
    // lane whose onsets cannot overlap.
    expect(after.customChordRhythm[4]).toBe(false);
    expect(after.customChordHoldSteps[4]).toBe(1);
  });

  test('setCustomChordEventLength clamps at the cycle end', () => {
    useAppStore.getState().setCustomChordEvent(0, true);
    useAppStore.getState().setCustomChordEventLength(0, 99);
    // Four one-bar chords fold onto a one-bar cycle, so the first chord end and
    // the cycle end coincide at step 16.
    expect(useAppStore.getState().customChordHoldSteps[0]).toBe(16);
  });

  test('setCustomChordEventLength on an empty slot is a no-op, not a new onset', () => {
    useAppStore.getState().setCustomChordEventLength(5, 4);
    const after = useAppStore.getState();
    expect(after.customChordRhythm[5]).toBe(false);
    expect(after.customChordHoldSteps[5]).toBe(1);
  });

  test('a multi-bar cycle folds the chord boundaries onto its own length', () => {
    // A two-bar 4/4 cycle is 32 steps; the four one-bar chords fold to 0, 16
    // and 32, so an onset on the folded boundary at 16 may hold to the cycle
    // end rather than being cut at the next chord.
    useAppStore.getState().setCustomChordLoopLength(2);
    useAppStore.getState().setCustomChordEvent(16, true);
    useAppStore.getState().setCustomChordEventLength(16, 99);
    // Column 16 is bar two, offset 0: stored slot MAX_STEPS_PER_BAR.
    expect(useAppStore.getState().customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(16);
  });

  test('setCustomBassEvent writes a token and its length clamps the same way', () => {
    useAppStore.getState().setCustomBassEvent(0, 'seventh');
    let after = useAppStore.getState();
    expect(after.customBassPattern[0]).toBe('seventh');
    expect(after.customBassHoldSteps[0]).toBe(1);

    useAppStore.getState().setCustomBassEventLength(0, 99);
    after = useAppStore.getState();
    expect(after.customBassHoldSteps[0]).toBe(16);
  });

  test('a note tool on an empty column starts a one-step onset', () => {
    useAppStore.getState().setCustomBassEvent(0, 'root');
    let after = useAppStore.getState();
    expect(after.customBassPattern[0]).toBe('root');
    expect(after.customBassHoldSteps[0]).toBe(1);

    // Any other empty column behaves the same way, whatever tool came before.
    useAppStore.getState().setCustomBassEvent(8, 'fifth');
    after = useAppStore.getState();
    expect(after.customBassPattern[8]).toBe('fifth');
    expect(after.customBassHoldSteps[8]).toBe(1);
  });

  test('setCustomBassEvent replaces an onset value rather than stacking a second', () => {
    useAppStore.getState().setCustomBassEvent(0, 'root');
    useAppStore.getState().setCustomBassEvent(0, 'octave');
    expect(useAppStore.getState().customBassPattern[0]).toBe('octave');
  });

  test('setCustomChordEvent on an already-active head keeps its span length', () => {
    // The same trap on the shared event path, seen from the chord lane: the
    // panel never re-fires this write, but a re-fire must not be destructive.
    useAppStore.getState().setCustomChordEvent(0, true);
    useAppStore.getState().setCustomChordEventLength(0, 8);
    useAppStore.getState().setCustomChordEvent(0, true);

    const after = useAppStore.getState();
    expect(after.customChordRhythm[0]).toBe(true);
    expect(after.customChordHoldSteps[0]).toBe(8);
  });

  test('erasing a bass span restores the whole span to rest', () => {
    useAppStore.getState().setCustomBassEvent(0, 'root');
    useAppStore.getState().setCustomBassEventLength(0, 4);
    useAppStore.getState().setCustomBassEvent(0, 'rest');
    const after = useAppStore.getState();
    expect(after.customBassPattern.slice(0, 4)).toEqual(['rest', 'rest', 'rest', 'rest']);
    expect(after.customBassHoldSteps[0]).toBe(1);
  });
});

describe('custom step sequencer — ineffective edits are true store no-ops', () => {
  beforeEach(resetCustomFields);

  const notificationsDuring = (action: () => void): number => {
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1;
    });
    action();
    unsubscribe();
    return notifications;
  };

  test('re-applying the same onset keeps both array identities', () => {
    useAppStore.getState().setCustomBassEvent(0, 'root');
    const values = useAppStore.getState().customBassPattern;
    const holds = useAppStore.getState().customBassHoldSteps;

    const notifications = notificationsDuring(() => {
      useAppStore.getState().setCustomBassEvent(0, 'root');
    });

    expect(useAppStore.getState().customBassPattern).toBe(values);
    expect(useAppStore.getState().customBassHoldSteps).toBe(holds);
    expect(notifications).toBe(0);
  });

  test('erasing an already-empty column keeps both array identities', () => {
    const values = useAppStore.getState().customBassPattern;
    const holds = useAppStore.getState().customBassHoldSteps;

    const notifications = notificationsDuring(() => {
      useAppStore.getState().setCustomBassEvent(3, 'rest');
    });

    expect(useAppStore.getState().customBassPattern).toBe(values);
    expect(useAppStore.getState().customBassHoldSteps).toBe(holds);
    expect(notifications).toBe(0);
  });

  test('resizing an onset to its current length keeps both array identities', () => {
    useAppStore.getState().setCustomChordEvent(0, true);
    const values = useAppStore.getState().customChordRhythm;
    const holds = useAppStore.getState().customChordHoldSteps;

    const notifications = notificationsDuring(() => {
      useAppStore.getState().setCustomChordEventLength(0, 1);
    });

    expect(useAppStore.getState().customChordRhythm).toBe(values);
    expect(useAppStore.getState().customChordHoldSteps).toBe(holds);
    expect(notifications).toBe(0);
  });

  test('a stale event column outside the active cycle writes nothing', () => {
    const notifications = notificationsDuring(() => {
      useAppStore.getState().setCustomChordEvent(16, true);
    });

    expect(useAppStore.getState().customChordRhythm[16]).toBe(false);
    expect(notifications).toBe(0);
  });
});

/**
 * The review finding, one case per branch of the write: a note tool clicked on
 * a slot that already sounds edits the token, never the length.
 */
describe('custom step sequencer — a write on a sounding slot edits the token, not the length', () => {
  beforeEach(resetCustomFields);

  test('re-voicing a bass span keeps its hold instead of collapsing it to one step', () => {
    useAppStore.getState().setCustomBassEvent(0, 'root');
    useAppStore.getState().setCustomBassEventLength(0, 8);
    useAppStore.getState().setCustomBassEvent(0, 'fifth');

    const after = useAppStore.getState();
    expect(after.customBassPattern[0]).toBe('fifth');
    expect(after.customBassHoldSteps[0]).toBe(8);
    // A re-voicing is still one lane: the slots the span covered stay cleared.
    expect(after.customBassPattern.slice(1, 8)).toEqual(new Array<string>(7).fill('rest'));
  });

  test('re-clicking the same bass token changes neither the value nor the hold', () => {
    useAppStore.getState().setCustomBassEvent(0, 'third');
    useAppStore.getState().setCustomBassEventLength(0, 4);
    useAppStore.getState().setCustomBassEvent(0, 'third');

    const after = useAppStore.getState();
    expect(after.customBassPattern[0]).toBe('third');
    expect(after.customBassHoldSteps[0]).toBe(4);
  });

  test('erasing a bass span leaves one step of rest, so the next click is a new onset', () => {
    useAppStore.getState().setCustomBassEvent(0, 'root');
    useAppStore.getState().setCustomBassEventLength(0, 6);
    useAppStore.getState().setCustomBassEvent(0, 'rest');

    let after = useAppStore.getState();
    expect(after.customBassPattern[0]).toBe('rest');
    expect(after.customBassHoldSteps[0]).toBe(1);

    // An erased slot is empty again, so the next note tool starts one step.
    useAppStore.getState().setCustomBassEvent(0, 'octave');
    after = useAppStore.getState();
    expect(after.customBassPattern[0]).toBe('octave');
    expect(after.customBassHoldSteps[0]).toBe(1);
  });
});

describe('custom step sequencer — a progression write re-clamps both lanes', () => {
  beforeEach(resetCustomFields);

  test('a shorter progression lowers the cycle without trimming the dormant bars', () => {
    useAppStore.getState().setChords(THREE_BAR_CHORDS); // three bars
    useAppStore.getState().setCustomChordLoopLength(3);
    expect(useAppStore.getState().customChordRhythm).toHaveLength(3 * MAX_STEPS_PER_BAR);

    // Bar three, offset 0 — a slot the two-bar cycle below cannot reach.
    useAppStore.getState().setCustomChordEvent(32, true);
    expect(useAppStore.getState().customChordRhythm[2 * MAX_STEPS_PER_BAR]).toBe(true);

    // Back to the factory's four-bar progression: 3 is not a divisor of 4, so
    // the cycle lowers to 2 — and the third bar is KEPT, not deleted.
    useAppStore.getState().setChords(createDefaultLoop().chords);

    const after = useAppStore.getState();
    expect(after.customChordLoopLength).toBe(2);
    expect(after.customChordRhythm).toHaveLength(3 * MAX_STEPS_PER_BAR);
    expect(after.customChordRhythm[2 * MAX_STEPS_PER_BAR]).toBe(true);
  });

  test('raising the length again restores the dormant onset', () => {
    useAppStore.getState().setChords(THREE_BAR_CHORDS);
    useAppStore.getState().setCustomChordLoopLength(3);
    useAppStore.getState().setCustomChordEvent(32, true);
    useAppStore.getState().setChords(createDefaultLoop().chords);
    expect(useAppStore.getState().customChordLoopLength).toBe(2);

    useAppStore.getState().setCustomChordLoopLength(4);

    const after = useAppStore.getState();
    expect(after.customChordLoopLength).toBe(4);
    expect(after.customChordRhythm).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(after.customChordRhythm[2 * MAX_STEPS_PER_BAR]).toBe(true);
  });

  test('it clamps the bass lane in the same write', () => {
    useAppStore.getState().setChords(THREE_BAR_CHORDS);
    useAppStore.getState().setCustomBassLoopLength(3);
    useAppStore.getState().setCustomBassEvent(0, 'root');
    useAppStore.getState().setCustomBassEventLength(0, 99);

    useAppStore.getState().setChords(createDefaultLoop().chords);

    const after = useAppStore.getState();
    expect(after.customBassLoopLength).toBe(2);
    // Stored at the 3-bar width, but the hold itself is re-clamped to the next
    // folded chord boundary inside the new two-bar cycle — 16 steps, one bar.
    expect(after.customBassPattern).toHaveLength(3 * MAX_STEPS_PER_BAR);
    expect(after.customBassHoldSteps[0]).toBe(16);
  });
});

describe('custom step sequencer — non-destructive across meter change', () => {
  beforeEach(resetCustomFields);

  test('setMeter leaves both grids untouched (no re-window, no trim)', () => {
    const s = useAppStore.getState();
    const chord = [...new Array<boolean>(MAX_STEPS_PER_BAR).fill(false)];
    chord[18] = true; // a step only visible in 12/8 (24 steps), hidden in 4/4
    const bass: BassStepChoice[] = new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest');
    bass[20] = 'seventh';
    s.setCustomChordRhythm(chord);
    s.setCustomBassPattern(bass);

    s.setMeter('4/4');
    let after = useAppStore.getState();
    expect(after.customChordRhythm[18]).toBe(true); // preserved, not trimmed
    expect(after.customBassPattern[20]).toBe('seventh');
    expect(after.customChordRhythm.length).toBe(MAX_STEPS_PER_BAR);

    s.setMeter('12/8');
    after = useAppStore.getState();
    expect(after.customChordRhythm[18]).toBe(true); // still there when widened back
    expect(after.customBassPattern[20]).toBe('seventh');
  });
});

describe('custom step sequencer — instant vibes reset the mode', () => {
  beforeEach(resetCustomFields);

  test('applyVibeToStore returns both modes to preset', () => {
    const s = useAppStore.getState();
    s.setChordRhythmMode('custom');
    s.setBassPatternMode('custom');
    applyVibeToStore(resolveVibe(VIBES[0]));
    expect(useAppStore.getState().chordRhythmMode).toBe('preset');
    expect(useAppStore.getState().bassPatternMode).toBe('preset');
    expect(useAppStore.getState().customChordLoopLength).toBe(1);
    expect(useAppStore.getState().customBassLoopLength).toBe(1);
  });
});
