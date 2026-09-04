import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { LeadNote } from '../audio/leadMelody';

function emptyMelody(): LeadNote[][] {
  return Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]);
}

describe('musicContextSlice — setScaleRoot re-maps the lead melody', () => {
  beforeEach(() => {
    const steps = emptyMelody();
    steps[0] = [{ note: 'A3', len: 1 }, { note: 'C4', len: 1 }];
    steps[1] = [{ note: 'E4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
  });

  test('transposes every lead note by the root interval (A → C)', () => {
    useAppStore.getState().setScaleRoot('C');
    const s = useAppStore.getState();
    expect(s.scaleRoot).toBe('C');
    expect(s.leadMelodySteps[0]).toEqual([{ note: 'C3', len: 1 }, { note: 'D#3', len: 1 }]);
    expect(s.leadMelodySteps[1]).toEqual([{ note: 'G3', len: 1 }]);
  });
});

describe('musicContextSlice — setScaleType re-maps the lead melody', () => {
  beforeEach(() => {
    const steps = emptyMelody();
    steps[0] = [{ note: 'A3', len: 1 }, { note: 'F4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
  });

  test('re-maps in-scale degrees (minor → dorian raises degree 5)', () => {
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([
      { note: 'A3', len: 1 },
      { note: 'F#4', len: 1 },
    ]);
  });

  test('leaves out-of-scale notes unchanged on a scale change', () => {
    const steps = emptyMelody();
    steps[0] = [{ note: 'C#4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C#4', len: 1 }]);
  });
});
