/**
 * Chip metadata for the always-mounted Instant Vibes bar.
 *
 * Deliberately duplicates seven fields of INSTANT_VIBES rather than importing
 * it: instantVibes.ts resolves its chords, drum patterns and effect chains at
 * MODULE EVALUATION time, so importing it drags synthPresets.ts,
 * chordProgressions.ts, vibeDrumPatterns.ts and vibeEffectChains.ts into the
 * eagerly-parsed main chunk. The bar renders none of that — it renders a name,
 * an emoji, a BPM and a key — and the full table is only needed once a chip is
 * actually clicked, so it is dynamically imported from the click handler.
 *
 * `vibeChips.test.ts` pins this table field-for-field against INSTANT_VIBES,
 * so the duplication cannot drift.
 *
 * THE IDS ARE PERSISTED IN PROJECT FILES. Four of them do not match their
 * display names, on purpose (docs/design.md §4 item 2). Do not "fix" them.
 */
export interface VibeChip {
  /** Persisted in project files — never rename. */
  id: string;
  name: string;
  emoji: string;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  /** Whether this vibe has a `variation` rule, i.e. whether it shows a dice. */
  hasVariation: boolean;
}

export const VIBE_CHIPS: VibeChip[] = [
  { id: 'lofi-chill',     name: 'Lo-Fi Chill',   emoji: '☕',  bpm: 84,  scaleRoot: 'C', scaleType: 'Major',         hasVariation: true },
  { id: 'synthwave-80s',  name: 'Synthwave 80s', emoji: '🏎️', bpm: 118, scaleRoot: 'A', scaleType: 'Natural Minor', hasVariation: true },
  { id: 'cyber-dance',    name: 'Cyber EDM',     emoji: '⚡',  bpm: 128, scaleRoot: 'F', scaleType: 'Natural Minor', hasVariation: true },
  { id: 'ambient-chill',  name: 'Deep Ambient',  emoji: '🌌', bpm: 72,  scaleRoot: 'D', scaleType: 'Lydian',        hasVariation: true },
  { id: 'hiphop-groove',  name: 'Boom Bap',      emoji: '🎙️', bpm: 92,  scaleRoot: 'E', scaleType: 'Dorian',        hasVariation: true },
  { id: 'asian-zen',      name: 'Zen Garden',    emoji: '🎋', bpm: 78,  scaleRoot: 'G', scaleType: 'Hirajoshi',     hasVariation: true },
  { id: 'lofi-waltz',     name: 'Lo-Fi Waltz',   emoji: '🎠', bpm: 96,  scaleRoot: 'F', scaleType: 'Major',         hasVariation: true },
  { id: 'afro-six-eight', name: 'Afro 6/8',      emoji: '🪘', bpm: 132, scaleRoot: 'D', scaleType: 'Dorian',        hasVariation: true },
];
