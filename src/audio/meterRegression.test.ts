import { describe, expect, test } from 'bun:test';
import {
  METERS,
  MAX_STEPS_PER_BAR,
  arpStepFor,
  beatIndexAt,
  getMeter,
  isBeatBoundary,
} from '../utils/meter';
import type { MeterId } from '../utils/meter';
import { barDurationSec, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import { BEATS_PER_BAR, beatsPerBarFor } from '../utils/playhead';
import { adaptStepRow } from '../utils/patternAdapt';
import { adaptStepEvents } from '../utils/eventAdapt';
import { stepCells } from '../components/sequencerGrid';
import { GENRE_PRESETS } from './data/genrePresets';
import { VIBE_DRUM_PATTERN_METERS } from './data/vibeDrumPatterns';
import { RHYTHM_PATTERNS } from './rhythmPatterns';
import { BASS_PATTERNS } from './bassPatterns';
import { INSTANT_VIBES } from '../store/instantVibes';

/**
 * THE STAGE 1 ACCEPTANCE PIN.
 *
 * With the meter left at 4/4, every derivation this work introduced must reduce
 * to the exact arithmetic the pre-meter code performed. If a test in this file
 * fails, 4/4 output has changed and the change is a regression regardless of how
 * good it looks in another meter.
 */
describe('4/4 is byte-identical to the pre-meter behaviour', () => {
  const FOUR_FOUR = METERS['4/4'];

  test('the bar is still 16 sixteenth steps', () => {
    expect(FOUR_FOUR.stepsPerBar).toBe(16);
    expect(STEPS_PER_BAR).toBe(16);
    expect(getMeter('4/4').stepsPerBar).toBe(STEPS_PER_BAR);
  });

  test('barDurationSec is unchanged for every transport tempo', () => {
    for (const bpm of [20, 84, 120, 174, 300]) {
      expect(barDurationSec(bpm)).toBeCloseTo(stepDurationSec(bpm) * 16, 12);
      expect(barDurationSec(bpm, FOUR_FOUR.stepsPerBar)).toBeCloseTo(barDurationSec(bpm), 12);
    }
  });

  test('the metronome clicks exactly where step % 4 === 0 used to', () => {
    for (let step = 0; step < 16 * 8; step++) {
      const stepInBar = step % 16;
      expect(isBeatBoundary(stepInBar, FOUR_FOUR.accentGroups)).toBe(step % 4 === 0);
    }
  });

  test('the accented downbeat is exactly where step % 16 === 0 used to be', () => {
    for (let step = 0; step < 16 * 8; step++) {
      const stepInBar = step % 16;
      const accented = isBeatBoundary(stepInBar, FOUR_FOUR.accentGroups) && stepInBar === 0;
      expect(accented).toBe(step % 16 === 0);
    }
  });

  test('the dispatched beat index is exactly Math.floor(step / 4)', () => {
    for (let step = 0; step < 16 * 16; step++) {
      const barIndex = Math.floor(step / 16);
      const stepInBar = step - barIndex * 16;
      const beat = barIndex * FOUR_FOUR.accentGroups.length + beatIndexAt(stepInBar, FOUR_FOUR.accentGroups);
      expect(beat).toBe(Math.floor(step / 4));
    }
  });

  test('the arp phase is the raw clock step — no re-phasing happens in 4/4', () => {
    for (let step = 0; step < 1000; step++) {
      expect(arpStepFor(step, 16)).toBe(step);
    }
  });

  test('beats per bar is still four', () => {
    expect(beatsPerBarFor('4/4')).toBe(BEATS_PER_BAR);
    expect(BEATS_PER_BAR).toBe(4);
  });

  test('the sequencer grid still draws sixteen cells grouped in fours', () => {
    const cells = stepCells(FOUR_FOUR);
    expect(cells.length).toBe(16);
    expect(cells.map((c) => c.isBeatStart)).toEqual(
      Array.from({ length: 16 }, (_, i) => i % 4 === 0),
    );
    expect(cells.map((c) => c.isAltBeatGroup)).toEqual(
      Array.from({ length: 16 }, (_, i) => Math.floor(i / 4) % 2 === 0),
    );
  });

  test('adapting any 4/4 row to a 16-step bar is the identity', () => {
    for (const preset of Object.values(GENRE_PRESETS)) {
      if (preset.meter !== '4/4') continue;
      for (const row of Object.values(preset.rows)) {
        expect(adaptStepRow(row, 16)).toEqual(row);
      }
    }
  });

  test('adapting any shipped 4/4 rhythm or bass pattern to a 16-step bar is the identity', () => {
    for (const p of RHYTHM_PATTERNS) {
      if (p.meter !== '4/4') continue;
      expect(adaptStepEvents(p.hits, 16, 16)).toEqual([...p.hits].sort((a, b) => a.step - b.step));
    }
    for (const p of BASS_PATTERNS) {
      if (p.meter !== '4/4') continue;
      expect(adaptStepEvents(p.steps, 16, 16)).toEqual([...p.steps].sort((a, b) => a.step - b.step));
    }
  });
});

describe('the 4/4 libraries Stage 1 shipped are untouched', () => {
  const FOUR_FOUR_RHYTHM_IDS = [
    'sustained', 'lofiSwing', 'eighthPads', 'offbeatStabs', 'syncopatedPush',
    'popBallad8ths', 'tripletBallad', 'fourOnFloor', 'funkSyncopation',
    'bossaComping', 'montunoClave', 'offbeatSkank', 'arpRollUp',
    'arpDownEighths', 'bassPlusStrum',
  ];
  const FOUR_FOUR_BASS_IDS = [
    'classic-walk', 'swing-double-approach', 'root-fifth-walk', 'dilla-sub',
    'offbeat-sub', 'walking-groove', 'driving-eighths', 'funk-octaves',
    'reggae-one-drop', 'arp-1357', 'half-time-legato', 'whole-note-root',
  ];
  const FOUR_FOUR_DRUM_PATTERN_IDS = [
    'lofi-half-time-brush', 'synthwave-four-on-floor', 'edm-offbeat-pump',
    'ambient-sparse-drift', 'boombap-swung-break', 'zen-bamboo-pulse',
  ];
  const FOUR_FOUR_GENRES = [
    'Synthwave', 'House', 'Trap', 'Boom Bap', 'Cyberpunk', 'DnB', 'Dubstep',
    'Techno', 'Funk', 'Rock', 'Reggae', 'Lo-Fi Hip-Hop',
  ];
  const FOUR_FOUR_VIBE_IDS = [
    'lofi-chill', 'synthwave-80s', 'cyber-dance', 'ambient-chill',
    'hiphop-groove', 'asian-zen',
  ];

  test('the 45 patterns Stage 1 shipped are still there, still 4/4, still in order', () => {
    expect(RHYTHM_PATTERNS.filter((p) => p.meter === '4/4').map((p) => p.id))
      .toEqual(FOUR_FOUR_RHYTHM_IDS);
    expect(BASS_PATTERNS.filter((p) => p.meter === '4/4').map((p) => p.id))
      .toEqual(FOUR_FOUR_BASS_IDS);
    expect(
      Object.entries(VIBE_DRUM_PATTERN_METERS).filter(([, m]) => m === '4/4').map(([id]) => id),
    ).toEqual(FOUR_FOUR_DRUM_PATTERN_IDS);
    expect(
      Object.entries(GENRE_PRESETS).filter(([, p]) => p.meter === '4/4').map(([g]) => g),
    ).toEqual(FOUR_FOUR_GENRES);
    expect(INSTANT_VIBES.filter((v) => v.meter === '4/4').map((v) => v.id))
      .toEqual(FOUR_FOUR_VIBE_IDS);
  });

  test('every non-4/4 pattern Stage 2 adds is 3/4 or 6/8 — nothing else is authored', () => {
    // 12/8, 5/4 and 7/8 stay served by trim/loop of 4/4 material, by decision.
    const authored: (MeterId | undefined)[] = [
      ...RHYTHM_PATTERNS.map((p) => p.meter),
      ...BASS_PATTERNS.map((p) => p.meter),
      ...Object.values(VIBE_DRUM_PATTERN_METERS),
      ...Object.values(GENRE_PRESETS).map((p) => p.meter),
      ...INSTANT_VIBES.map((v) => v.meter),
    ];
    for (const m of authored) {
      expect(['4/4', '3/4', '6/8']).toContain(m);
    }
  });

  test('every shipped row fits the widest storable bar', () => {
    for (const preset of Object.values(GENRE_PRESETS)) {
      for (const row of Object.values(preset.rows)) {
        expect(row.length).toBeLessThanOrEqual(MAX_STEPS_PER_BAR);
      }
    }
  });
});
