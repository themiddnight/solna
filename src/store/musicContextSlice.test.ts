import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { LeadNote } from '../audio/leadMelody';
import { readFileSync } from 'node:fs';
import { keyChangePatch } from './musicContextSlice';
import { MELODY_TRACKS } from './melodyTracks';

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

describe('musicContextSlice — every melody track follows the key (MELODY_TRACKS)', () => {
  beforeEach(() => {
    const lead = emptyMelody();
    lead[0] = [{ note: 'A3', len: 1 }];
    const fx = emptyMelody();
    fx[0] = [{ note: 'C4', len: 1 }];
    fx[1] = [{ note: 'F4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: lead, fxMelodySteps: fx });
  });

  test('setScaleRoot transposes FX exactly as it transposes Lead', () => {
    useAppStore.getState().setScaleRoot('C');
    const s = useAppStore.getState();
    expect(s.leadMelodySteps[0]).toEqual([{ note: 'C3', len: 1 }]);
    expect(s.fxMelodySteps[0]).toEqual([{ note: 'D#3', len: 1 }]);
  });

  test('setScaleType remaps FX exactly as it remaps Lead', () => {
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().fxMelodySteps[1]).toEqual([{ note: 'F#4', len: 1 }]);
  });

  test('keyChangePatch writes one steps field per MELODY_TRACKS row and nothing else', () => {
    const patch = keyChangePatch(useAppStore.getState(), { scaleRoot: 'C' });
    const stepKeys = MELODY_TRACKS.map((t) => t.steps).sort();
    expect(Object.keys(patch).sort()).toEqual(['scaleRoot', ...stepKeys].sort());
  });

  test('source scan: no hand-written melody field in the slice', () => {
    const src = readFileSync(new URL('./musicContextSlice.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/leadMelodySteps|fxMelodySteps/);
  });
});
