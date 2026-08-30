import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

function emptyMelody(): string[][] {
  return Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]);
}

describe('musicContextSlice — setScaleRoot re-maps the lead melody', () => {
  beforeEach(() => {
    const steps = emptyMelody();
    steps[0] = ['A3', 'C4'];
    steps[1] = ['E4'];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
  });

  test('transposes every lead note by the root interval (A → C)', () => {
    useAppStore.getState().setScaleRoot('C');
    const s = useAppStore.getState();
    expect(s.scaleRoot).toBe('C');
    expect(s.leadMelodySteps[0]).toEqual(['C3', 'D#3']);
    expect(s.leadMelodySteps[1]).toEqual(['G3']);
  });
});

describe('musicContextSlice — setScaleType re-maps the lead melody', () => {
  beforeEach(() => {
    const steps = emptyMelody();
    steps[0] = ['A3', 'F4'];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
  });

  test('re-maps in-scale degrees (minor → dorian raises degree 5)', () => {
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['A3', 'F#4']);
  });

  test('leaves out-of-scale notes unchanged on a scale change', () => {
    const steps = emptyMelody();
    steps[0] = ['C#4'];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['C#4']);
  });
});
