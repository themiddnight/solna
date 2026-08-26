import { describe, expect, test } from 'bun:test';
import { VIBE_EFFECT_CHAINS, effectChainById, requireEffectChain } from './vibeEffectChains';

const LIBRARY_IDS = [
  'lofi-tape-room',
  'synthwave-neon-hall',
  'edm-club-drive',
  'ambient-cathedral-wash',
  'boombap-dry-room',
  'zen-temple-air',
];

const COMMON_KEYS = [
  'reverbWet',
  'reverbDecay',
  'delayWet',
  'delayFeedback',
  'compressorThreshold',
  'eqLow',
  'eqMid',
  'eqHigh',
];

const DISTORTION_CHAIN_IDS = ['synthwave-neon-hall', 'edm-club-drive'];

describe('VIBE_EFFECT_CHAINS shape', () => {
  test('holds exactly the six vibe chain ids', () => {
    expect(Object.keys(VIBE_EFFECT_CHAINS).sort()).toEqual([...LIBRARY_IDS].sort());
  });

  test('every chain carries the eight common keys', () => {
    for (const id of LIBRARY_IDS) {
      const chain = VIBE_EFFECT_CHAINS[id];
      for (const key of COMMON_KEYS) {
        expect(key in chain).toBe(true);
      }
    }
  });

  test('exactly synthwave-neon-hall and edm-club-drive carry distortionWet', () => {
    for (const id of LIBRARY_IDS) {
      const chain = VIBE_EFFECT_CHAINS[id];
      expect('distortionWet' in chain).toBe(DISTORTION_CHAIN_IDS.includes(id));
    }
  });
});

describe('effectChainById', () => {
  test('resolves every library id to a chain equal to the table entry', () => {
    for (const id of LIBRARY_IDS) {
      expect(effectChainById(id)).toEqual(VIBE_EFFECT_CHAINS[id]);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(effectChainById('no-such-chain')).toBeUndefined();
    expect(effectChainById('')).toBeUndefined();
  });

  test('returns a fresh copy, so mutating the result cannot reach module state', () => {
    const first = effectChainById('lofi-tape-room')!;
    first.reverbWet = 0;
    first.eqLow = 99;

    const second = effectChainById('lofi-tape-room')!;
    expect(second.reverbWet).toBe(0.35);
    expect(second.eqLow).toBe(3);
    expect(VIBE_EFFECT_CHAINS['lofi-tape-room'].reverbWet).toBe(0.35);
  });

  test('never hands back the same object instance twice', () => {
    const first = effectChainById('zen-temple-air')!;
    const second = effectChainById('zen-temple-air')!;
    expect(first).not.toBe(second);
    expect(first).not.toBe(VIBE_EFFECT_CHAINS['zen-temple-air']);
  });
});

describe('requireEffectChain', () => {
  test('resolves every library id to the same chain as effectChainById', () => {
    for (const id of LIBRARY_IDS) {
      expect(requireEffectChain(id)).toEqual(effectChainById(id)!);
    }
  });

  test('throws for an unknown id', () => {
    expect(() => requireEffectChain('no-such-chain')).toThrow();
    expect(() => requireEffectChain('')).toThrow();
  });
});
