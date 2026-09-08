import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { DRUM_KITS } from '@/data/drumKits';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  findDriftedEntries,
  findMissingEntries,
  findOrphanEntries,
  findOutOfToleranceEntries,
} from './levelChecks.ts';

const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

describe('the committed trim table is a lock on today s defaults', () => {
  test('every drum kit and every synth preset has a committed entry', () => {
    const missing = findMissingEntries();
    expect(ids(missing).join(', ')).toBe('');
  });

  test('no committed entry names a kit or preset that no longer exists', () => {
    expect(ids(findOrphanEntries()).join(', ')).toBe('');
  });

  test('no loudness-affecting default has drifted since it was last calibrated', () => {
    // This is the test the issue asks for: it hashes the CURRENT config and compares
    // it to the hash recorded in the table. A retune of a gain, an envelope, a
    // cutoff or an oscillator type fires it; a rename, a colour or a wet send
    // deliberately does not.
    expect(ids(findDriftedEntries()).join(', ')).toBe('');
  });

  test('every committed measurement plus its trim lands within the tolerance band', () => {
    expect(ids(findOutOfToleranceEntries()).join(', ')).toBe('');
  });

  test('runs without rendering or shelling out — it reads the table and hashes data', () => {
    const started = performance.now();
    findDriftedEntries();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

// Ruling 8: an empty table is indistinguishable from "never generated" — nothing
// stamps a marker distinguishing the two — so a collector that only diffs the
// entries PRESENT against the live config would pass vacuously on `{}`. This is
// the guard on the gate itself: run the same collectors against a table with
// nothing in it and prove `findMissingEntries` names every live kit and preset,
// while the other three collectors correctly report nothing (there is nothing
// present to be an orphan, drifted, or out of tolerance).
describe('an empty table fails loudly, and for the right reason (Ruling 8)', () => {
  afterEach(() => {
    // mock.restore() does not undo mock.module() (Bun's own documented caveat) —
    // reapply the real, committed table defensively. Bun 1.3.14 scopes
    // mock.module() to this file (verified in Task 7), not the whole registry,
    // but that scoping is not a documented guarantee.
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS, PRESET_TRIMS }));
  });

  test('findMissingEntries reports every live kit and every live preset, and nothing else misreports it', () => {
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS: {}, PRESET_TRIMS: {} }));

    const missing = ids(findMissingEntries());
    for (const kitName of Object.keys(DRUM_KITS)) expect(missing).toContain(kitName);
    for (const preset of SYNTH_PRESETS) expect(missing).toContain(preset.id);
    expect(missing.length).toBe(Object.keys(DRUM_KITS).length + SYNTH_PRESETS.length);

    // An empty table has no entries to be an orphan, drifted, or out of
    // tolerance — a collector that mis-fired here would be reporting the
    // wrong category, which the brief calls worse than a missing report.
    expect(ids(findOrphanEntries())).toEqual([]);
    expect(ids(findDriftedEntries())).toEqual([]);
    expect(ids(findOutOfToleranceEntries())).toEqual([]);
  });
});
