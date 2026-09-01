import { describe, expect, test } from 'bun:test';
import { VIBE_CHIPS } from './vibeChips';
import { INSTANT_VIBES } from './instantVibes';

describe('VIBE_CHIPS mirrors INSTANT_VIBES exactly', () => {
  test('same length and same ids in the same order', () => {
    expect(VIBE_CHIPS.map((c) => c.id)).toEqual(INSTANT_VIBES.map((v) => v.id));
  });

  test('every rendered field matches the full table field-for-field', () => {
    expect(VIBE_CHIPS).toEqual(
      INSTANT_VIBES.map((v) => ({
        id: v.id,
        name: v.name,
        emoji: v.emoji,
        bpm: v.bpm,
        scaleRoot: v.scaleRoot,
        scaleType: v.scaleType,
        hasVariation: Boolean(v.variation),
      })),
    );
  });

  test('the four deliberately drifting id/label pairs are reproduced verbatim', () => {
    // docs/design.md §4 item 2 — ids are persisted in project files. This is
    // NOT a bug to fix; it is pinned so the chip table cannot "correct" it.
    const byId = new Map(VIBE_CHIPS.map((c) => [c.id, c.name]));
    expect(byId.get('cyber-dance')).toBe('Cyber EDM');
    expect(byId.get('ambient-chill')).toBe('Deep Ambient');
    expect(byId.get('hiphop-groove')).toBe('Boom Bap');
    expect(byId.get('asian-zen')).toBe('Zen Garden');
  });

  test('chip ids are unique', () => {
    expect(new Set(VIBE_CHIPS.map((c) => c.id)).size).toBe(VIBE_CHIPS.length);
  });
});
