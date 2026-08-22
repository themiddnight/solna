import { describe, expect, test } from 'bun:test';
import { BASS_PATTERNS, BASS_STYLE_GROUPS, resolveBassSteps } from './bassPatterns';
import type { BassPattern } from './bassPatterns';
import type { ChordItem } from '../types';

const Cmaj7: ChordItem = { id: 'c1', root: 'C', quality: 'maj7', bars: 1, notes: ['C4', 'E4', 'G4', 'B4'] };
const F7: ChordItem = { id: 'c2', root: 'F', quality: '7', bars: 1, notes: ['F4', 'A4', 'C5', 'Eb5'] };
const Cmaj: ChordItem = { id: 'c3', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] };

const names = (events: { noteName: string }[]) => events.map((e) => e.noteName);
function byId(id: string): BassPattern {
  const p = BASS_PATTERNS.find((p) => p.id === id);
  if (!p) throw new Error(`missing pattern ${id}`);
  return p;
}

describe('chord tones', () => {
  test('arp-1357 on Cmaj7 resolves root/3rd/5th/7th at the bass octave', () => {
    const ev = resolveBassSteps(byId('arp-1357'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(names(ev)).toEqual(['C2', 'E2', 'G2', 'B2']);
  });
  test('7th falls back to 5th on a triad', () => {
    const ev = resolveBassSteps(byId('arp-1357'), [Cmaj], 0, 2, 'A', 'Natural Minor', 120);
    expect(names(ev)).toEqual(['C2', 'E2', 'G2', 'G2']);
  });
  test('octave token is bass root + 12 semitones', () => {
    const ev = resolveBassSteps(byId('funk-octaves'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev.map((e) => e.noteName)).toContain('C3');
  });
});

describe('approach tokens target the NEXT chord (with wrap)', () => {
  test('classic-walk bar 0 approaches the next root from above', () => {
    // next chord F7 → F2 (41); above = 42 = F#2
    const ev = resolveBassSteps(byId('classic-walk'), [Cmaj7, F7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[3].noteName).toBe('F#2');
  });
  test('classic-walk bar 1 flips below (alternate on odd bars) and wraps to chord 0', () => {
    // chordIndex 1 = F7, next wraps to Cmaj7 → C2 (36); below = 35 = B1
    const ev = resolveBassSteps(byId('classic-walk'), [Cmaj7, F7], 1, 2, 'A', 'Natural Minor', 120);
    expect(ev[3].noteName).toBe('B1');
  });
  test('approachFifthOfNext is +7 semitones from the next bass root', () => {
    const ev = resolveBassSteps(byId('root-fifth-walk'), [Cmaj7, F7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[3].noteName).toBe('C3'); // F2 (41) + 7 = 48
  });
  test('approachDiatonicUp steps to the next scale degree above the target', () => {
    // target F (pc 5); A Natural Minor degrees: A9 B11 C0 D2 E4 F5 G7 → first above 5 = 7 (G)
    const p: BassPattern = { id: 't', name: 't', style: 'Walking', steps: [{ step: 12, note: 'approachDiatonicUp' }] };
    const ev = resolveBassSteps(p, [Cmaj7, F7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].noteName).toBe('G2');
  });
  test('wrap: last chord approaches the first chord', () => {
    const ev = resolveBassSteps(byId('root-fifth-walk'), [Cmaj7, F7], 1, 2, 'A', 'Natural Minor', 120);
    expect(ev[3].noteName).toBe('G2'); // C2 (36) + 7 = 43
  });
  test('resolved events carry the originating token (post-alternation) so multi-bar scheduling can skip approaches until the last bar', () => {
    const ev0 = resolveBassSteps(byId('classic-walk'), [Cmaj7, F7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev0.map((e) => e.token)).toEqual(['root', 'third', 'fifth', 'approachChromaticAbove']);
    const ev1 = resolveBassSteps(byId('classic-walk'), [Cmaj7, F7], 1, 2, 'A', 'Natural Minor', 120);
    expect(ev1[3].token).toBe('approachChromaticBelow'); // alternate flips on odd chordIndex
    expect(ev1[3].token.startsWith('approach')).toBe(true);
  });
});

describe('bassNote override', () => {
  test('bassNote override replaces the root token', () => {
    const overridden = { ...Cmaj7, bassNote: 'E4' };
    const ev = resolveBassSteps(byId('arp-1357'), [overridden], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].noteName).toBe('E2');
  });
  test('bassNote override changes the approach target', () => {
    const overridden = { ...F7, bassNote: 'A4' };
    const ev = resolveBassSteps(byId('classic-walk'), [Cmaj7, overridden], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[3].noteName).toBe('A#2'); // next bass root A2 (45) + 1
  });
});

describe('timing, hold, staccato, velocity, rest, octaveShift (bpm 120 → 16th = 0.125 s)', () => {
  test('timeOffsetSec = step * 16th duration', () => {
    const ev = resolveBassSteps(byId('driving-eighths'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev.map((e) => e.timeOffsetSec)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  });
  test('holdSec = holdSteps * 16th duration', () => {
    const ev = resolveBassSteps(byId('driving-eighths'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].holdSec).toBe(0.25);
  });
  test('staccato halves the hold', () => {
    const ev = resolveBassSteps(byId('funk-octaves'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].holdSec).toBeCloseTo(0.0625, 5); // 0.125 * 0.5
  });
  test('velocity defaults to 0.8 and scales by step.velocity', () => {
    const p: BassPattern = { id: 'v', name: 'v', style: 'Walking', steps: [{ step: 0, note: 'root', velocity: 0.5 }, { step: 4, note: 'root' }] };
    const ev = resolveBassSteps(p, [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].velocity).toBe(0.4);
    expect(ev[1].velocity).toBe(0.8);
  });
  test('rest steps emit no event', () => {
    const p: BassPattern = { id: 'r', name: 'r', style: 'Walking', steps: [{ step: 0, note: 'root' }, { step: 4, note: 'rest' }] };
    const ev = resolveBassSteps(p, [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev).toHaveLength(1);
  });
  test('octaveShift transposes by 12 semitones', () => {
    const p: BassPattern = { id: 'o', name: 'o', style: 'Walking', steps: [{ step: 0, note: 'root', octaveShift: -1 }] };
    const ev = resolveBassSteps(p, [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].noteName).toBe('C1');
  });
});

describe('BASS_STYLE_GROUPS', () => {
  test('groups patterns by style in dropdown order', () => {
    expect(BASS_STYLE_GROUPS.map((g) => g.style)).toEqual(['Walking', 'Grooves', 'Minimal']);
    expect(BASS_STYLE_GROUPS.flatMap((g) => g.patterns)).toHaveLength(BASS_PATTERNS.length);
  });
});
