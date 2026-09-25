/**
 * The generic entry contract for the three id-keyed comp libraries, the rules
 * every row shares whatever it plays: a non-empty id, name, description and
 * dropdown group, and no id or name used twice. Each library's own test keeps
 * its specific shape rules (meter, bar length, degree qualities); this file is
 * only what a contributor adding a row to any of them must satisfy.
 */
import { describe, expect, test } from 'bun:test';
import { BASS_PATTERNS } from './bassPatterns';
import { CHORD_PROGRESSIONS } from './chordProgressions';
import { CHORD_RHYTHMS } from './chordRhythms';

interface LibraryEntry {
  id: string;
  name: string;
  description?: string;
  /** The dropdown or library chip the entry is listed under. */
  group: string;
}

const LIBRARIES: Record<string, LibraryEntry[]> = {
  CHORD_PROGRESSIONS: CHORD_PROGRESSIONS.map((e) => ({ ...e, group: e.category })),
  CHORD_RHYTHMS: CHORD_RHYTHMS.map((e) => ({ ...e, group: e.style })),
  BASS_PATTERNS: BASS_PATTERNS.map((e) => ({ ...e, group: e.style })),
};

for (const [table, entries] of Object.entries(LIBRARIES)) {
  describe(`${table} entries`, () => {
    test('every entry has a non-empty id, name, description and group', () => {
      for (const entry of entries) {
        expect(entry.id.trim(), 'id').not.toBe('');
        expect(entry.name.trim(), `${entry.id} name`).not.toBe('');
        expect(entry.description?.trim() ?? '', `${entry.id} description`).not.toBe('');
        expect(entry.group.trim(), `${entry.id} group`).not.toBe('');
      }
    });

    test('no id and no name is used twice', () => {
      const ids = entries.map((entry) => entry.id);
      const names = entries.map((entry) => entry.name);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
      expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
    });
  });
}
