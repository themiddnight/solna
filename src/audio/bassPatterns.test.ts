import { describe, expect, test } from 'bun:test';
import { BASS_PATTERNS, BASS_STYLE_GROUPS, customBassPattern, resolveBassSteps } from './bassPatterns';
import type { BassPattern, BassStepChoice } from './bassPatterns';
import type { ChordItem } from '../types';
import { getMeter } from '../utils/meter';
import type { MeterId } from '../utils/meter';

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
  test('carries the originating grid step so the scheduler can fire it on the matching tick', () => {
    const ev = resolveBassSteps(byId('driving-eighths'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev.map((e) => e.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });
  test('holdSec = holdSteps * 16th duration', () => {
    const ev = resolveBassSteps(byId('driving-eighths'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].holdSec).toBe(0.25);
  });
  test('staccato halves the hold', () => {
    const ev = resolveBassSteps(byId('funk-octaves'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120);
    expect(ev[0].holdSec).toBeCloseTo(0.0625, 5); // 0.125 * 0.5
  });
  test('holdScale multiplies holdSec (loose x2)', () => {
    const ev = resolveBassSteps(byId('driving-eighths'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120, 2);
    expect(ev[0].holdSec).toBe(0.5);
  });
  test('holdScale multiplies holdSec (tight x0.5)', () => {
    const ev = resolveBassSteps(byId('driving-eighths'), [Cmaj7], 0, 2, 'A', 'Natural Minor', 120, 0.5);
    expect(ev[0].holdSec).toBeCloseTo(0.125, 5);
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
    expect(BASS_STYLE_GROUPS.map((g) => g.style)).toEqual([
      'Walking',
      'Grooves',
      'Minimal',
      'Waltz',
      '6/8',
    ]);
    expect(BASS_STYLE_GROUPS.flatMap((g) => g.patterns)).toHaveLength(BASS_PATTERNS.length);
  });
});

const BASS_METERS: [string, MeterId][] = [
  ['classic-walk', '4/4'],
  ['swing-double-approach', '4/4'],
  ['root-fifth-walk', '4/4'],
  ['dilla-sub', '4/4'],
  ['offbeat-sub', '4/4'],
  ['walking-groove', '4/4'],
  ['driving-eighths', '4/4'],
  ['funk-octaves', '4/4'],
  ['reggae-one-drop', '4/4'],
  ['arp-1357', '4/4'],
  ['half-time-legato', '4/4'],
  ['whole-note-root', '4/4'],
  ['waltz-root-fifth', '3/4'],
  ['waltz-walking-three', '3/4'],
  ['six-eight-root-pulse', '6/8'],
  ['afro-six-eight-tumbao', '6/8'],
];

describe('BASS_PATTERNS meter tags', () => {
  test('every pattern is present, in order, with the meter it was written in', () => {
    expect(BASS_PATTERNS.map((p) => [p.id, p.meter])).toEqual(BASS_METERS);
  });

  test("no step falls outside its own pattern's bar", () => {
    for (const p of BASS_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const s of p.steps) {
        expect(s.step, `${p.id} step`).toBeGreaterThanOrEqual(0);
        expect(s.step, `${p.id} step`).toBeLessThan(bar);
      }
    }
  });

  test('no hold rings past its own bar line', () => {
    for (const p of BASS_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const s of p.steps) {
        expect(s.step + (s.holdSteps ?? 1), `${p.id} hold at step ${s.step}`).toBeLessThanOrEqual(bar);
      }
    }
  });

  test('both 3/4 lines put one note on each of the [4,4,4] beats, with their full authored shape', () => {
    expect(byId('waltz-root-fifth').steps).toEqual([
      { step: 0, note: 'root', holdSteps: 3 },
      { step: 4, note: 'fifth', holdSteps: 3, velocity: 0.8 },
      { step: 8, note: 'octave', holdSteps: 3, velocity: 0.75 },
    ]);
    expect(byId('waltz-walking-three').steps).toEqual([
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 4, note: 'third', holdSteps: 4 },
      { step: 8, note: 'approachChromaticBelow', holdSteps: 4, alternate: true },
    ]);
  });
});

describe('the 6/8 bass lines lean on steps 0 and 6, never on 4 and 8', () => {
  const byId = (id: string) => BASS_PATTERNS.find((p) => p.id === id)!;

  test('six-eight-root-pulse is one note per dotted-quarter beat', () => {
    const p = byId('six-eight-root-pulse');
    expect(p.steps.map((s) => s.step)).toEqual([0, 6]);
    expect(p.steps.map((s) => s.holdSteps)).toEqual([6, 6]);
    expect(p.steps.map((s) => s.note)).toEqual(['root', 'fifth']);
  });

  test('afro-six-eight-tumbao pushes off the last eighth of beat two', () => {
    const p = byId('afro-six-eight-tumbao');
    expect(p.steps).toEqual([
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 6, note: 'fifth', holdSteps: 2, velocity: 0.85 },
      { step: 10, note: 'octave', holdSteps: 2, velocity: 0.8 },
    ]);
  });

  test('neither 6/8 line lands on the 3/4 beat set', () => {
    for (const id of ['six-eight-root-pulse', 'afro-six-eight-tumbao']) {
      const steps = byId(id).steps.map((s) => s.step);
      expect(steps, id).not.toContain(4);
      expect(steps, id).not.toContain(8);
    }
  });
});

const FOUR_FOUR: MeterId = '4/4';

describe('customBassPattern — choice grid to BassPattern', () => {
  test('root/third/fifth/seventh map to one 16th step each; octave maps to root + octaveShift', () => {
    const choices: BassStepChoice[] = [
      'root', 'rest', 'third', 'rest', 'fifth', 'rest', 'seventh', 'rest',
      'rest', 'rest', 'rest', 'rest', 'octave', 'rest', 'rest', 'rest',
    ];
    const pattern = customBassPattern(choices, 16, FOUR_FOUR);
    expect(pattern.id).toBe('custom');
    expect(pattern.meter).toBe('4/4');
    expect(pattern.steps).toEqual([
      { step: 0, note: 'root' },
      { step: 2, note: 'third' },
      { step: 4, note: 'fifth' },
      { step: 6, note: 'seventh' },
      { step: 12, note: 'root', octaveShift: 1 },
    ]);
  });

  test('all-rest grid yields no steps', () => {
    const choices: BassStepChoice[] = new Array(16).fill('rest');
    expect(customBassPattern(choices, 16, FOUR_FOUR).steps).toEqual([]);
  });

  test('steps at or past stepsPerBar are ignored', () => {
    const choices: BassStepChoice[] = ['root', 'root', 'root', 'root', 'root'];
    expect(customBassPattern(choices, 4, FOUR_FOUR).steps).toEqual([
      { step: 0, note: 'root' },
      { step: 1, note: 'root' },
      { step: 2, note: 'root' },
      { step: 3, note: 'root' },
    ]);
  });
});

describe('customBassPattern — resolution reuses the existing quality-aware resolver', () => {
  const maj7: ChordItem = {
    id: 't', root: 'C', quality: 'maj7', bars: 1,
    notes: ['C4', 'E4', 'G4', 'B4'],
  };

  test('octave resolves an octave above the bass root', () => {
    const choices: BassStepChoice[] = ['octave', ...new Array<BassStepChoice>(15).fill('rest')];
    const events = resolveBassSteps(
      customBassPattern(choices, 16, FOUR_FOUR),
      [maj7], 0, 2, 'C', 'major', 120,
    );
    expect(events[0].noteName).toBe('C3'); // bass octave 2 → C2, +12 → C3
  });

  test('seventh falls back through the FALLBACK_CHAIN to fifth on a triad', () => {
    const triad: ChordItem = {
      id: 't', root: 'C', quality: 'maj', bars: 1,
      notes: ['C4', 'E4', 'G4'],
    };
    const choices: BassStepChoice[] = ['seventh', ...new Array<BassStepChoice>(15).fill('rest')];
    const events = resolveBassSteps(
      customBassPattern(choices, 16, FOUR_FOUR),
      [triad], 0, 2, 'C', 'major', 120,
    );
    expect(events[0].noteName).toBe('G2'); // C2 + 7 semitones
  });
});
