import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore, partializeAppState } from './store';
import { startRegionSync } from './regionSync';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

function resetLead(): void {
  useAppStore.setState({
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
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
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['C4']);
    s.toggleLeadNote(0, 'E4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['C4', 'E4']);
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['E4']);
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
    expect(grown.leadMelodySteps[0]).toEqual(['C4']);
    expect(grown.leadMelodySteps[24]).toEqual([]);

    grown.toggleLeadNote(24, 'E4'); // bar 1 step 0
    useAppStore.getState().setLeadLoopLength(1); // shrink → 24 slots, bar 1 dropped
    const shrunk = useAppStore.getState();
    expect(shrunk.leadLoopLength).toBe(1);
    expect(shrunk.leadMelodySteps).toHaveLength(24);
    expect(shrunk.leadMelodySteps[0]).toEqual(['C4']);
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
    expect(clamped.leadMelodySteps[24]).toEqual(['E4']);
    useAppStore.getState().setLeadLoopLength(2);
    const restored = useAppStore.getState();
    expect(restored.leadMelodySteps[24]).toEqual(['E4']);
  });

  test('a meter change never touches the stored melody (non-destructive)', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(18, 'G4'); // step 18 visible in 12/8 (24), hidden in 4/4
    s.setMeter('4/4');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual(['G4']);
    expect(useAppStore.getState().leadMelodySteps).toHaveLength(MAX_STEPS_PER_BAR);
    s.setMeter('12/8');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual(['G4']);
  });
});

describe('lead slice — persistence', () => {
  beforeEach(resetLead);
  test('leadMelodySteps and leadLoopLength are persisted inside the active region', () => {
    // v6: per-region fields persist inside regions[activeRegionId], kept fresh
    // by the live-write sync-back (regionSync). Start it here so the edits to
    // the flat slices reach the persisted region copy, as they do in the app.
    const stop = startRegionSync();
    try {
      const s = useAppStore.getState();
      s.toggleLeadNote(0, 'C4');
      s.setLeadLoopLength(2);
      const persisted = partializeAppState(useAppStore.getState());
      const region = persisted.regions.find((r) => r.id === persisted.activeRegionId)!;
      expect(region.leadMelodySteps).toEqual(useAppStore.getState().leadMelodySteps);
      expect(region.leadLoopLength).toBe(2);
    } finally {
      stop();
    }
  });

  test('leadMelodyView, leadMelodyOctave and leadPlayer are transient', () => {
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('leadMelodyView' in persisted).toBe(false);
    expect('leadMelodyOctave' in persisted).toBe(false);
    expect('leadPlayer' in persisted).toBe(false);
  });
});
