import { describe, expect, test } from 'bun:test';
import { VIBES } from '../data/vibes';
import { resolveVibe, VIBE_IDS } from './vibes';
import { ORIGINAL_VIBE_EFFECTS } from './instantVibesEffectsFixture';
import { requireEffectChain } from '../audio/effectChains';

describe('ORIGINAL_VIBE_EFFECTS fixture', () => {
  test('captures exactly the eight vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_EFFECTS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the effects block every vibe resolves to', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(spec).toBeDefined();
      expect(resolveVibe(spec).effects).toEqual(ORIGINAL_VIBE_EFFECTS[id]);
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

  test('exactly synthwave-80s and cyber-edm carry distortionWet', () => {
    const distortionVibeIds = ['synthwave-80s', 'cyber-edm'];
    for (const id of VIBE_IDS) {
      expect('distortionWet' in ORIGINAL_VIBE_EFFECTS[id]).toBe(distortionVibeIds.includes(id));
    }
  });
});

describe('ResolvedVibe.effectChainId reproduces the fixture exactly', () => {
  test('every vibe has an effectChainId that resolves to a real library chain', () => {
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      expect(typeof vibe.effectChainId).toBe('string');
      expect(vibe.effectChainId.length).toBeGreaterThan(0);
      expect(() => requireEffectChain(vibe.effectChainId)).not.toThrow();
    }
  });

  test('resolving effectChainId reproduces the captured chain byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      expect(requireEffectChain(vibe.effectChainId)).toEqual(ORIGINAL_VIBE_EFFECTS[id]);
    }
  });

  test('the eight vibes draw from six distinct library ids — lofi-waltz reuses lofi-chill\'s chain and afro-six-eight reuses boom-bap\'s', () => {
    const referenced = VIBES.map((v) => v.effectChainId);
    expect(new Set(referenced).size).toBe(6);
    expect([...referenced].sort()).toEqual([
      'ambient-cathedral-wash',
      'boombap-dry-room',
      'boombap-dry-room',
      'edm-club-drive',
      'lofi-tape-room',
      'lofi-tape-room',
      'synthwave-neon-hall',
      'zen-temple-air',
    ]);
  });
});

describe('a vibe does not share an object instance with the library', () => {
  test('mutating a resolved effects field cannot rewrite EFFECT_CHAINS', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(resolveVibe(spec).effects).not.toBe(requireEffectChain(spec.effectChainId));
    }
  });
});
