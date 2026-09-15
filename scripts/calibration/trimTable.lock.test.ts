import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { TARGET_DBFS } from './trimMath';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  findDriftedEntries,
  findMissingEntries,
  findOrphanEntries,
  findOutOfToleranceEntries,
} from './levelChecks.ts';

const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

describe('the committed trim table is a lock on today s defaults', () => {
  test('every beat preset and every synth preset has a committed entry', () => {
    const missing = findMissingEntries();
    expect(ids(missing).join(', ')).toBe('');
  });

  test('no committed entry names a beat or synth preset that no longer exists', () => {
    expect(ids(findOrphanEntries()).join(', ')).toBe('');
  });

  test('no loudness-affecting default has drifted since it was last calibrated', () => {
    // This is the test the issue asks for: it hashes the CURRENT config and compares
    // it to the hash recorded in the table. A retune of a gain, an envelope, a
    // cutoff or an oscillator type fires it; a rename, a colour or a wet send
    // deliberately does not.
    expect(ids(findDriftedEntries()).join(', ')).toBe('');
  });

  test('every committed measurement plus the gain that is actually applied lands within the tolerance band', () => {
    // Both halves read the gain off the LIVE patch: `patch.outputTrimDb` for a
    // beat preset, `patch.common.outputGainDb` for a synth one.
    expect(ids(findOutOfToleranceEntries()).join(', ')).toBe('');
  });

  test('runs without rendering or shelling out — it reads the table and hashes data', () => {
    const started = performance.now();
    findDriftedEntries();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

/**
 * `trimDb` is ADVISORY for a preset, and this is the assertion that keeps it
 * honest.
 *
 * Nothing applies it: the engine reads `patch.common.outputGainDb`, and
 * `findOutOfToleranceEntries` combines `measuredDbfs` with that. What the
 * table's `trimDb` is FOR is the regenerate-and-review loop — it is the
 * recommendation a human copies into the patch, and it is only useful if it
 * still means `TARGET_DBFS - measuredDbfs`. A second copy of a number with
 * nothing reading it is exactly where a stale value hides, so the derivation
 * is pinned here rather than trusted.
 *
 * The beat half is deliberately included: its `trimDb` is the number a human
 * copies into `patch.outputTrimDb`, and the same identity must hold for the same
 * reason. The describe below is what checks the copy actually landed.
 *
 * Placed ABOVE the two `mock.module` describes on purpose: this one reads the
 * imported bindings directly rather than through `levelChecks`, and a swapped
 * module leaks into them. Moving it below makes the count assertion fail, which
 * is the right failure mode but a confusing one to debug from scratch.
 */
describe('the committed trimDb is still TARGET minus the measurement', () => {
  test('every entry, both halves — a trim that drifted from its own measurement is a stale number', () => {
    const entries = [...Object.entries(DRUM_TRIMS), ...Object.entries(PRESET_TRIMS)];
    // Ruling 8 again, in the small: this walks the COMMITTED entries, so on an
    // empty table it would iterate nothing and pass having checked nothing —
    // the same vacuity the empty-table guard below exists for. `findMissing`
    // owns "the table is empty"; what this needs is only that it did not
    // silently become a no-op. One live kit and one live preset is the floor.
    expect(entries.length).toBeGreaterThanOrEqual(BEAT_PRESETS.length + SYNTH_PRESETS.length);

    const offenders: string[] = [];
    for (const [id, entry] of entries) {
      // Both fields are written rounded to 2 dp by the generator, so the
      // identity holds to within one rounding step in each, not exactly.
      if (Math.abs(entry.trimDb - (TARGET_DBFS - entry.measuredDbfs)) > 0.02) {
        offenders.push(`${id}: ${entry.trimDb} != ${TARGET_DBFS} - ${entry.measuredDbfs}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The embedded trim is what runtime audio actually applies (`patch.outputTrimDb`),
 * and this table is the measurement it came from. Two copies of one number, so
 * the only thing keeping them honest is an assertion that they are equal: a
 * regenerated table whose new `trimDb` was never copied across would otherwise
 * ship a patch calibrated to a measurement that no longer exists.
 *
 * The roster assertions come first and are not decoration. An empty or
 * half-populated `BEAT_PRESETS` would make the loop below iterate nothing and
 * pass having compared nothing — the same vacuity Ruling 8 exists for, one level
 * down.
 */
describe('every factory patch embeds the trim this table measured', () => {
  test('the roster is the full thirteen, so the comparison below cannot be vacuous', () => {
    expect(BEAT_PRESETS.length).toBe(13);
    expect(Object.keys(DRUM_TRIMS).length).toBe(BEAT_PRESETS.length);
  });

  test('embedded outputTrimDb equals the committed trimDb, preset for preset', () => {
    const offenders: string[] = [];
    for (const preset of BEAT_PRESETS) {
      const entry = DRUM_TRIMS[preset.id];
      if (!entry) {
        offenders.push(`${preset.id}: no committed entry`);
        continue;
      }
      if (preset.patch.outputTrimDb !== entry.trimDb) {
        offenders.push(`${preset.id}: embeds ${preset.patch.outputTrimDb}, table says ${entry.trimDb}`);
      }
    }
    expect(offenders).toEqual([]);
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

  test('findMissingEntries reports every live beat preset and every live synth preset, and nothing else misreports it', () => {
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS: {}, PRESET_TRIMS: {} }));

    const missing = ids(findMissingEntries());
    for (const preset of BEAT_PRESETS) expect(missing).toContain(preset.id);
    for (const preset of SYNTH_PRESETS) expect(missing).toContain(preset.id);
    expect(missing.length).toBe(BEAT_PRESETS.length + SYNTH_PRESETS.length);

    // An empty table has no entries to be an orphan, drifted, or out of
    // tolerance — a collector that mis-fired here would be reporting the
    // wrong category, which the brief calls worse than a missing report.
    expect(ids(findOrphanEntries())).toEqual([]);
    expect(ids(findDriftedEntries())).toEqual([]);
    expect(ids(findOutOfToleranceEntries())).toEqual([]);
  });
});

/**
 * A preset's applied gain is no longer in this table — it is
 * `patch.common.outputGainDb`, inside the patch a user can edit and save. The
 * committed entry records only what the NEUTRALISED render measured, so the
 * tolerance question is "does the live patch's own gain land that measurement
 * on target", and a collector still reading the table's `trimDb` would answer
 * a question nobody asks any more.
 *
 * Both fixtures below set `trimDb` to the value that would make a trimDb-based
 * check give the OPPOSITE answer, so neither can pass by accident.
 */
describe('the preset tolerance check reads the live patch, not the table', () => {
  const preset = SYNTH_PRESETS[0];
  if (!preset) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
  const outputGainDb = preset.patch.common.outputGainDb;

  afterEach(() => {
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS, PRESET_TRIMS }));
  });

  test('a measurement the live output gain lands on target passes, whatever trimDb says', () => {
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {},
      PRESET_TRIMS: {
        [preset.id]: { measuredDbfs: -18 - outputGainDb, trimDb: 999, configHash: 'x' },
      },
    }));
    expect(ids(findOutOfToleranceEntries())).toEqual([]);
  });

  test('a measurement the live output gain leaves 30 dB low fails, even with a perfect trimDb', () => {
    const measuredDbfs = -18 - outputGainDb - 30;
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {},
      PRESET_TRIMS: {
        // -18 - measuredDbfs: exactly what a trimDb-based check would accept.
        [preset.id]: { measuredDbfs, trimDb: -18 - measuredDbfs, configHash: 'x' },
      },
    }));
    expect(ids(findOutOfToleranceEntries())).toEqual([preset.id]);
  });
});
