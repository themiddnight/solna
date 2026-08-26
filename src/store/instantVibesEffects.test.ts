import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_EFFECTS } from './instantVibesEffectsFixture';
import { effectChainById } from '../audio/data/vibeEffectChains';

const VIBE_IDS = INSTANT_VIBES.map((v) => v.id);

describe('ORIGINAL_VIBE_EFFECTS fixture', () => {
  test('captures exactly the six vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_EFFECTS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the effects block every vibe in INSTANT_VIBES ships', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe).toBeDefined();
      expect(vibe.effects).toEqual(ORIGINAL_VIBE_EFFECTS[id]);
    }
  });

  test('every captured chain carries the eight common keys', () => {
    const commonKeys = [
      'reverbWet',
      'reverbDecay',
      'delayWet',
      'delayFeedback',
      'compressorThreshold',
      'eqLow',
      'eqMid',
      'eqHigh',
    ];
    for (const id of VIBE_IDS) {
      const chain = ORIGINAL_VIBE_EFFECTS[id];
      for (const key of commonKeys) {
        expect(key in chain).toBe(true);
      }
    }
  });

  test('exactly synthwave-80s and cyber-dance carry distortionWet', () => {
    const distortionVibeIds = ['synthwave-80s', 'cyber-dance'];
    for (const id of VIBE_IDS) {
      expect('distortionWet' in ORIGINAL_VIBE_EFFECTS[id]).toBe(distortionVibeIds.includes(id));
    }
  });
});

describe('InstantVibe.effectChainId reproduces the fixture exactly', () => {
  test('every vibe has an effectChainId that resolves to a real library chain', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(typeof vibe.effectChainId).toBe('string');
      expect(vibe.effectChainId.length).toBeGreaterThan(0);
      expect(effectChainById(vibe.effectChainId)).toBeDefined();
    }
  });

  test('resolving effectChainId reproduces the captured chain byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(effectChainById(vibe.effectChainId)).toEqual(ORIGINAL_VIBE_EFFECTS[id]);
    }
  });

  test('vibe.effects is itself the resolved library chain, not a separate literal', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe.effects).toEqual(effectChainById(vibe.effectChainId)!);
    }
  });

  test('the six vibes map onto six distinct library ids', () => {
    const referenced = INSTANT_VIBES.map((v) => v.effectChainId);
    expect(new Set(referenced).size).toBe(6);
    expect([...referenced].sort()).toEqual([
      'ambient-cathedral-wash',
      'boombap-dry-room',
      'edm-club-drive',
      'lofi-tape-room',
      'synthwave-neon-hall',
      'zen-temple-air',
    ]);
  });
});

describe('a vibe does not share an object instance with the library', () => {
  test('mutating a vibe effects field cannot rewrite VIBE_EFFECT_CHAINS', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const fresh = effectChainById(vibe.effectChainId)!;
      expect(vibe.effects).not.toBe(fresh);
    }
  });
});
