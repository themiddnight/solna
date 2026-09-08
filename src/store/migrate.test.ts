import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  LEGACY_CHORD_PROGRESSIONS_KEY,
  LEGACY_PERSIST_KEY,
  LEGACY_SYNTH_PRESETS_KEY,
  migrateLegacyPresets,
  removeLegacyKeys,
} from './migrate';

/**
 * DEV-388 deleted the 15-step `if (version < N)` persist migration chain
 * (store.ts's PERSIST_VERSION docblock has the full reasoning) and the step
 * functions this file used to unit-test directly: migrateProjectTitleToVibeId,
 * migrateTrackColors, migrateMeterAndStepWidth, wrapFlatStateIntoLoop,
 * renameRegionKeysToLoop, backfillLeadWindow, migrateAddProjectIdentity,
 * migrateLeadNoteLength, migrateLeadStepResolution, migratePadLayer,
 * migrateDrumTracks, migrateDrumVoices, migrateMasterDynamics,
 * migrateMasterVolumeToDb, migrateBusFadersToDb, migrateTrackVolumesToDb.
 * migrate.ts now exports only the legacy-preset adoption this file tests
 * below (still called directly from store.ts's `migrate` and `merge`, never
 * from a chain).
 *
 * The replacement rule — validation instead of migration, an in-range value
 * survives regardless of what version wrote it, an invalid one becomes its
 * default — is pinned end-to-end (through the real `persist`/`merge` wiring,
 * which is where `sanitizePersistedState` actually lives) in store.test.ts's
 * "persisted payload sanitization" and the rewritten migration-wiring
 * describes there, not here: migrate.ts itself no longer contains anything
 * version-shaped to unit-test.
 */

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(name: string): string | null {
    return this.data.get(name) ?? null;
  }
  setItem(name: string, value: string): void {
    this.data.set(name, value);
  }
  removeItem(name: string): void {
    this.data.delete(name);
  }
  clear(): void {
    this.data.clear();
  }
}

const fakeLocalStorage = new FakeLocalStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, configurable: true });
});

afterEach(() => {
  fakeLocalStorage.clear();
});

describe('migrateLegacyPresets', () => {
  test('adopts both legacy keys when the target arrays are empty', () => {
    fakeLocalStorage.setItem(LEGACY_SYNTH_PRESETS_KEY, JSON.stringify([{ id: 's1' }]));
    fakeLocalStorage.setItem(LEGACY_CHORD_PROGRESSIONS_KEY, JSON.stringify([{ id: 'c1' }]));

    const result = migrateLegacyPresets({ customSynthPresets: [], customChordProgressions: [] });
    expect(result.customSynthPresets).toEqual([{ id: 's1' }] as never);
    expect(result.customChordProgressions).toEqual([{ id: 'c1' }] as never);
  });

  test('already-persisted presets win over the legacy keys', () => {
    fakeLocalStorage.setItem(LEGACY_SYNTH_PRESETS_KEY, JSON.stringify([{ id: 'legacy' }]));

    const result = migrateLegacyPresets({ customSynthPresets: [{ id: 'kept' }] as never });
    expect(result.customSynthPresets).toEqual([{ id: 'kept' }] as never);
  });

  test('corrupt JSON in a legacy key is ignored, not thrown', () => {
    fakeLocalStorage.setItem(LEGACY_SYNTH_PRESETS_KEY, '{not json');

    const result = migrateLegacyPresets({} as { customSynthPresets?: never[] });
    expect(result.customSynthPresets).toBeUndefined();
  });

  test('a non-array legacy value is ignored', () => {
    fakeLocalStorage.setItem(LEGACY_CHORD_PROGRESSIONS_KEY, JSON.stringify({ not: 'an array' }));

    const result = migrateLegacyPresets({} as { customChordProgressions?: never[] });
    expect(result.customChordProgressions).toBeUndefined();
  });

  test('no legacy keys stored leaves the state untouched', () => {
    const input = { customSynthPresets: [], customChordProgressions: [] };
    expect(migrateLegacyPresets(input)).toEqual(input);
  });
});

describe('removeLegacyKeys', () => {
  test('removes all three legacy keys', () => {
    fakeLocalStorage.setItem(LEGACY_SYNTH_PRESETS_KEY, '[]');
    fakeLocalStorage.setItem(LEGACY_CHORD_PROGRESSIONS_KEY, '[]');
    fakeLocalStorage.setItem(LEGACY_PERSIST_KEY, '{}');

    removeLegacyKeys();

    expect(fakeLocalStorage.getItem(LEGACY_SYNTH_PRESETS_KEY)).toBeNull();
    expect(fakeLocalStorage.getItem(LEGACY_CHORD_PROGRESSIONS_KEY)).toBeNull();
    expect(fakeLocalStorage.getItem(LEGACY_PERSIST_KEY)).toBeNull();
  });
});
