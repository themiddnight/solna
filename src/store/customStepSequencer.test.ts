import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { applyInstantVibeToStore, INSTANT_VIBES } from './instantVibes';
import type { BassStepChoice } from '../audio/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

/** Reset the four new fields to their factory defaults so tests never leak. */
function resetCustomFields(): void {
  useAppStore.setState({
    chordRhythmMode: 'preset',
    bassPatternMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
  });
}

describe('custom step sequencer — store defaults', () => {
  beforeEach(resetCustomFields);

  test('both modes default to preset with silent MAX-width grids', () => {
    const s = useAppStore.getState();
    expect(s.chordRhythmMode).toBe('preset');
    expect(s.bassPatternMode).toBe('preset');
    expect(s.customChordRhythm).toEqual(new Array<boolean>(MAX_STEPS_PER_BAR).fill(false));
    expect(s.customBassPattern).toEqual(new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'));
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

  test('applyInstantVibeToStore returns both modes to preset', () => {
    const s = useAppStore.getState();
    s.setChordRhythmMode('custom');
    s.setBassPatternMode('custom');
    applyInstantVibeToStore(INSTANT_VIBES[0]);
    expect(useAppStore.getState().chordRhythmMode).toBe('preset');
    expect(useAppStore.getState().bassPatternMode).toBe('preset');
  });
});
