import { describe, expect, test, beforeEach } from 'bun:test';
import { useAppStore } from './store';
import {
  DEFAULT_LEAD_STEP_RESOLUTION,
  LEAD_TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
  strideFor,
} from '@/utils/stepResolution';

import { getMeter } from '@/utils/meter';
import type { LeadNote } from '@/audio/leadMelody';

const empty = (): LeadNote[][] => Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);

// One cell at the default resolution. Read from the source rather than
// hard-coded: this repo's TICKS_PER_SIXTEENTH is 2, not the 6 the brief's
// illustrative example assumed for a differently-configured repo.
const stride = strideFor(DEFAULT_LEAD_STEP_RESOLUTION);

describe('the fx melody slice', () => {
  beforeEach(() => {
    useAppStore.setState({
      fxMelodySteps: empty(),
      leadMelodySteps: empty(),
      fxLoopLength: 1,
      leadLoopLength: 1,
      fxCursor: 0,
      leadCursor: 0,
      meterId: '4/4',
      // Reset explicitly: this store is a shared singleton across test files
      // in one bun test process, so a resolution change made by another
      // suite (e.g. leadSlice.test.ts) would otherwise leak in here.
      leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
      fxStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    });
  });

  test('painting an FX note writes fxMelodySteps and leaves the lead alone', () => {
    useAppStore.getState().paintFxNote(0, 'C4', 'draw');
    const s = useAppStore.getState();
    expect(s.fxMelodySteps[0]).toEqual([{ note: 'C4', len: stride }]);
    expect(s.leadMelodySteps[0]).toEqual([]);
  });

  test('painting a lead note leaves the FX track alone', () => {
    useAppStore.getState().paintLeadNote(0, 'C4', 'draw');
    const s = useAppStore.getState();
    expect(s.leadMelodySteps[0]).toEqual([{ note: 'C4', len: stride }]);
    expect(s.fxMelodySteps[0]).toEqual([]);
  });

  test("'draw' never removes and 'erase' never adds, on fx as on lead", () => {
    const store = useAppStore.getState();
    store.paintFxNote(0, 'C4', 'draw');
    store.paintFxNote(0, 'C4', 'draw');
    expect(useAppStore.getState().fxMelodySteps[0]).toHaveLength(1);
    store.paintFxNote(0, 'D4', 'erase');
    expect(useAppStore.getState().fxMelodySteps[0]).toHaveLength(1);
    store.paintFxNote(0, 'C4', 'erase');
    expect(useAppStore.getState().fxMelodySteps[0]).toHaveLength(0);
  });

  test('setFxLoopLength resizes the fx melody and not the lead one', () => {
    useAppStore.getState().setFxLoopLength(2);
    const s = useAppStore.getState();
    expect(s.fxMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR * 2);
    expect(s.leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
  });

  test('the two cursors are independent', () => {
    useAppStore.getState().setFxCursor(3);
    const s = useAppStore.getState();
    expect(s.fxCursor).toBe(3);
    expect(s.leadCursor).toBe(0);
  });

  test('the two clipboards are independent', () => {
    useAppStore.getState().paintFxNote(0, 'C4', 'draw');
    useAppStore.getState().copySelectedFxBar();
    const s = useAppStore.getState();
    expect(s.fxBarClipboard?.[0]).toEqual([{ note: 'C4', len: stride }]);
    expect(s.leadBarClipboard).toBeNull();
  });

  /**
   * Invariant 2 — start + len never crosses the LOOP end — is enforced by the
   * shared factory, so it holds on fx by construction. Asserted anyway: this is
   * the invariant that lets the reader stop its scan at step 0, and a
   * parameterisation bug that measured fx's length against the LEAD's loop
   * length would produce exactly this failure and nothing else.
   */
  test('an fx note length is clamped against the fx loop, not the lead one', () => {
    useAppStore.setState({ fxLoopLength: 1, leadLoopLength: 4 });
    useAppStore.getState().paintFxNote(0, 'C4', 'draw');
    useAppStore.getState().setFxNoteLength(0, 'C4', 9999);
    // 1 bar, from tick 0: stepsPerBar × TICKS_PER_SIXTEENTH ticks.
    const maxLen = getMeter('4/4').stepsPerBar * TICKS_PER_SIXTEENTH;
    expect(useAppStore.getState().fxMelodySteps[0]).toEqual([{ note: 'C4', len: maxLen }]);
  });
});
