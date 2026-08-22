# Bass Module (Chord View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bass module to the Chord View that plays a deterministic pattern-based bass line (walking/groove/minimal presets) over the same chord progression, with its own preset/octave/pattern controls, per-chord bass note overrides, and per-layer (chord/bass) mute.

**Architecture:** A pure resolver (`resolveBassSteps`) in a new `src/audio/bassPatterns.ts` converts a 16-step pattern + chord progression into time-aligned note events, which ChordView schedules through the existing `AudioEngine` with a new `'bass'` source. The engine gains lazy per-source gain buses (`sourceBuses`) so chord/bass mute is a ~10 ms gain ramp at the bus level, while scheduling always runs for both layers. Bass voices are monophonic: each new bass note kills the previous bass voice.

**Tech Stack:** React 18, TypeScript, Vite, Tonal, Web Audio API, bun:test

**Spec:** docs/superpowers/specs/2026-08-22-bass-module-design.md

## Global Constraints

- Note-name convention: chord notes are `'C4'` style (Tonal `Note.midi`-parseable, embedded octave); `SynthParams.octave` stays 0 — the resolver embeds `bassOctave` into the note names it produces (same idiom as `generateBlockChordNotes`).
- Mute is engine-bus-only: the playback loop always schedules both chord and bass layers and never reads mute state; muting covers the whole layer including tails/effects and un-muting mid-chord is instant (no clicks).
- No new synth engine: extend `AudioEngine` with per-source buses (spec Approach A); no new synth parameters; the drum path is untouched and does not pass through the source buses.
- `ProjectState` is **not** extended — chord/bass module settings stay session-local (persist is a separate follow-up).
- No new dependencies: only existing Tonal + Web Audio API + `bun:test` (bun already installed; `bun.lock` exists). Audio scheduling code is verified by lint + manual dev-server listening; only the pure resolver gets unit tests.

---

## Task 1: `bassPatterns.ts` — types, resolver, factory patterns, style groups + bun:test setup (TDD)

**Files**
- Modify `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/package.json` — add `"test": "bun test"` to `scripts`.
- Create `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/audio/bassPatterns.ts`
- Create `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/audio/bassPatterns.test.ts`

**Interfaces**
- Consumes: `ChordItem` (`src/types.ts`), `SCALES`, `rootSemitone`, `sixteenthNoteMs` (`src/utils/musicTheory.ts`), Tonal `Note`.
- Produces:
  - `BassNoteToken`, `BassStep` (adds `alternate?: boolean` — see note below), `BassPattern`, `ResolvedBassEvent`
  - `resolveBassSteps(pattern: BassPattern, chords: ChordItem[], chordIndex: number, octave: number, scaleRoot: string, scaleType: string, bpm: number): ResolvedBassEvent[]`
  - `BASS_PATTERNS: BassPattern[]`, `BASS_STYLE_GROUPS: { style: string; patterns: BassPattern[] }[]` (self-grouping IIFE, same as `RHYTHM_STYLE_GROUPS`)

> Spec deviation (resolved per review): the spec's "above/below สลับตาม `chordIndex % 2`" cannot be expressed in the factory pattern data with only the four named approach tokens. Add `alternate?: boolean` to `BassStep`; when set on an `approachChromaticAbove/Below` step, the resolver flips to the other direction on odd `chordIndex`. `classic-walk` sets it on its approach step. Deterministic and covered by tests below.

- [ ] **Test 1a — write failing test file** `src/audio/bassPatterns.test.ts` (run with `bun test src/audio/bassPatterns.test.ts`):

```ts
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
```

- [ ] **Test 1b — run `bun test src/audio/bassPatterns.test.ts`** and confirm it fails (module `./bassPatterns` does not exist yet).
- [ ] **Impl 1a — create `src/audio/bassPatterns.ts`**:

```ts
import { Note } from 'tonal';
import type { ChordItem } from '../types';
import { SCALES, rootSemitone, sixteenthNoteMs } from '../utils/musicTheory';

export type BassNoteToken =
  | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
  | 'approachChromaticAbove' | 'approachChromaticBelow'
  | 'approachDiatonicUp' | 'approachFifthOfNext'
  | 'rest';

export interface BassStep {
  step: number;            // 16th-note position in the bar (0–15)
  note: BassNoteToken;
  holdSteps?: number;      // 16th steps to hold (default 1)
  velocity?: number;       // accent 0–1
  octaveShift?: number;    // per-step octave shift
  staccato?: boolean;      // true = hold cut to 50%
  alternate?: boolean;     // flip approachChromaticAbove/Below on odd chordIndex
}

export interface BassPattern {
  id: string;
  name: string;
  style: string;           // dropdown group, same as RHYTHM_STYLE_GROUPS
  description?: string;
  steps: BassStep[];
}

export interface ResolvedBassEvent {
  noteName: string;        // 'C2' style, octave embedded
  timeOffsetSec: number;
  holdSec: number;
  velocity: number;
}

const TONE_INDEX: Record<'third' | 'fifth' | 'seventh', number> = { third: 1, fifth: 2, seventh: 3 };
const FALLBACK_CHAIN: Record<'third' | 'fifth' | 'seventh', ('third' | 'fifth' | 'seventh')[]> = {
  seventh: ['seventh', 'fifth', 'third'],
  fifth: ['fifth', 'third'],
  third: ['third'],
};

function pitchClass(noteName: string): string {
  return noteName.replace(/[0-9-]/g, '');
}

function midiAtOctave(pc: string, octave: number): number {
  return Note.midi(`${pc}${octave}`) ?? Note.midi(`C${octave}`) ?? 60;
}

export function resolveBassSteps(
  pattern: BassPattern,
  chords: ChordItem[],
  chordIndex: number,
  octave: number,
  scaleRoot: string,
  scaleType: string,
  bpm: number
): ResolvedBassEvent[] {
  if (chords.length === 0) return [];
  const chord = chords[chordIndex % chords.length];
  const nextChord = chords[(chordIndex + 1) % chords.length];

  // bassRoot = bassNote override (octave stripped, re-placed at bass octave) or chord.root
  const bassRootMidi = midiAtOctave(pitchClass(chord.bassNote ?? chord.root), octave);
  const nextRootMidi = midiAtOctave(pitchClass(nextChord.bassNote ?? nextChord.root), octave);

  const stepDur = sixteenthNoteMs(bpm) / 1000;

  // Fallback: seventh → fifth → third → root
  const toneMidi = (token: 'third' | 'fifth' | 'seventh'): number => {
    for (const t of FALLBACK_CHAIN[token]) {
      const note = chord.notes[TONE_INDEX[t]];
      if (note) return midiAtOctave(pitchClass(note), octave);
    }
    return bassRootMidi;
  };

  // First scale degree (rootSemitone + intervals) above the target pitch class; wraps to next octave
  const diatonicStepAbove = (targetPc: number): number => {
    const rootPc = rootSemitone(scaleRoot);
    const intervals = SCALES[scaleType]?.intervals ?? [0, 2, 4, 5, 7, 9, 11];
    for (const ivl of intervals) {
      const deg = (rootPc + ivl) % 12;
      if (deg > targetPc) return deg;
    }
    return ((rootPc + intervals[0]) % 12) + 12;
  };

  const events: ResolvedBassEvent[] = [];
  for (const step of pattern.steps) {
    if (step.note === 'rest') continue;

    // Deterministic above/below alternation: odd bars flip the direction
    let token = step.note;
    if (step.alternate && chordIndex % 2 === 1) {
      if (token === 'approachChromaticAbove') token = 'approachChromaticBelow';
      else if (token === 'approachChromaticBelow') token = 'approachChromaticAbove';
    }

    const targetPc = nextRootMidi % 12;
    let midi: number;
    switch (token) {
      case 'root': midi = bassRootMidi; break;
      case 'third': case 'fifth': case 'seventh': midi = toneMidi(token); break;
      case 'octave': midi = bassRootMidi + 12; break;
      case 'approachChromaticAbove': midi = nextRootMidi + 1; break;
      case 'approachChromaticBelow': midi = nextRootMidi - 1; break;
      case 'approachFifthOfNext': midi = nextRootMidi + 7; break;
      case 'approachDiatonicUp': midi = nextRootMidi - targetPc + diatonicStepAbove(targetPc); break;
      default: continue;
    }
    midi += 12 * (step.octaveShift ?? 0);

    const holdSec = (step.holdSteps ?? 1) * stepDur * (step.staccato ? 0.5 : 1);
    events.push({
      noteName: Note.fromMidi(midi) ?? 'C2',
      timeOffsetSec: step.step * stepDur,
      holdSec,
      velocity: 0.8 * (step.velocity ?? 1), // mirror the engine's default velocity
    });
  }
  return events;
}
```

- [ ] **Impl 1b — append the factory patterns and style groups to `bassPatterns.ts`**:

```ts
export const BASS_PATTERNS: BassPattern[] = [
  {
    id: 'classic-walk',
    name: 'Classic Walk',
    style: 'Walking',
    description: 'Root, 3rd, 5th, then chromatic approach to the next root (alternates above/below per bar)',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'third' },
      { step: 8, note: 'fifth' },
      { step: 12, note: 'approachChromaticAbove', alternate: true },
    ],
  },
  {
    id: 'swing-double-approach',
    name: 'Swing Double Approach',
    style: 'Walking',
    description: 'Root, 5th, then two chromatic approaches into the next root',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'fifth' },
      { step: 8, note: 'approachChromaticBelow' },
      { step: 12, note: 'approachChromaticBelow' },
    ],
  },
  {
    id: 'root-fifth-walk',
    name: 'Root–5th Walk',
    style: 'Walking',
    description: 'Root, 5th, root, then the 5th of the next chord (dominant approach)',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'fifth' },
      { step: 8, note: 'root' },
      { step: 12, note: 'approachFifthOfNext' },
    ],
  },
  {
    id: 'driving-eighths',
    name: 'Driving 8ths',
    style: 'Grooves',
    description: 'Straight 8th notes on the root (rock/punk drive)',
    steps: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, note: 'root' as const, holdSteps: 2 })),
  },
  {
    id: 'funk-octaves',
    name: 'Funk Octaves',
    style: 'Grooves',
    description: 'Syncopated root/octave pops with staccato',
    steps: [
      { step: 0, note: 'root', staccato: true },
      { step: 3, note: 'root', staccato: true },
      { step: 6, note: 'octave', staccato: true },
      { step: 8, note: 'root' },
      { step: 11, note: 'octave', staccato: true },
      { step: 14, note: 'root', staccato: true },
    ],
  },
  {
    id: 'reggae-one-drop',
    name: 'Reggae One-Drop',
    style: 'Grooves',
    description: 'Root–5th–octave on offbeats, staccato, downbeat left open',
    steps: [
      { step: 2, note: 'root', staccato: true },
      { step: 6, note: 'fifth', staccato: true },
      { step: 10, note: 'root', staccato: true },
      { step: 14, note: 'octave', staccato: true },
    ],
  },
  {
    id: 'arp-1357',
    name: 'Arp 1-3-5-7',
    style: 'Grooves',
    description: 'Quarter-note arpeggio; 7th falls back to 5th on triads',
    steps: [
      { step: 0, note: 'root' },
      { step: 4, note: 'third' },
      { step: 8, note: 'fifth' },
      { step: 12, note: 'seventh' },
    ],
  },
  {
    id: 'half-time-legato',
    name: 'Half-Time Legato',
    style: 'Minimal',
    description: 'Root held 2 beats, 5th held 2 beats',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 8, note: 'fifth', holdSteps: 4 },
    ],
  },
  {
    id: 'whole-note-root',
    name: 'Whole-Note Root',
    style: 'Minimal',
    description: 'Root held the full bar',
    steps: [{ step: 0, note: 'root', holdSteps: 16 }],
  },
];

export const BASS_STYLE_GROUPS: { style: string; patterns: BassPattern[] }[] = (() => {
  const byStyle = new Map<string, BassPattern[]>();
  for (const p of BASS_PATTERNS) {
    const list = byStyle.get(p.style);
    if (list) list.push(p);
    else byStyle.set(p.style, [p]);
  }
  return Array.from(byStyle, ([style, patterns]) => ({ style, patterns }));
})();
```

- [ ] **Test 1c — run `bun test src/audio/bassPatterns.test.ts`** — all tests pass.
- [ ] **Verify 1d — run `npm run lint`** (`tsc --noEmit`) — clean.
- [ ] **Commit 1e** — `git add package.json src/audio/bassPatterns.ts src/audio/bassPatterns.test.ts; git commit -m "feat: bass pattern types, deterministic resolver, and factory patterns with bun:test suite"`.

---

## Task 2: `bassPresets.ts` — `FACTORY_BASS_PRESETS`

**Files**
- Create `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/audio/bassPresets.ts`

**Interfaces**
- Consumes: `SynthPresetItem` (`src/audio/synthPresets.ts`).
- Produces: `FACTORY_BASS_PRESETS: SynthPresetItem[]` — the exact 5 param objects from spec section 4, all with `octave: 0`.

> Spec deviation (fixed): the spec's code block omits `category`, but `SynthPresetItem.category` is a required union (`'Lead' | 'Bass' | ...`). Add `category: 'Bass'` (and `isFactory: true`, matching `FACTORY_PRESETS`) to each item.

- [ ] **Impl 2a — create `src/audio/bassPresets.ts`** (values verbatim from the spec; only `category`/`isFactory` added):

```ts
import type { SynthPresetItem } from './synthPresets';

export const FACTORY_BASS_PRESETS: SynthPresetItem[] = [
  {
    id: 'bass-deep-sine', name: 'Deep Sine Sub', category: 'Bass', isFactory: true,
    params: { oscType: 'sine', subOscVolume: 0.9, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 220, filterResonance: 1, filterEnvAmount: 0,
      attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.6,
      filterAttack: 0.01, filterDecay: 0.1, filterSustain: 1, filterRelease: 0.3,
      lfoRate: 4, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Deep Sine Sub' },
  },
  {
    id: 'bass-round-pluck', name: 'Round Pluck', category: 'Bass', isFactory: true,
    params: { oscType: 'triangle', subOscVolume: 0.4, noiseVolume: 0, detune: 4,
      filterType: 'lowpass', filterCutoff: 400, filterResonance: 4, filterEnvAmount: 900,
      attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.25,
      filterAttack: 0.005, filterDecay: 0.3, filterSustain: 0.1, filterRelease: 0.3,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Round Pluck' },
  },
  {
    id: 'bass-punchy-square', name: 'Punchy Square', category: 'Bass', isFactory: true,
    params: { oscType: 'square', subOscVolume: 0.6, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 500, filterResonance: 2, filterEnvAmount: 300,
      attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.15,
      filterAttack: 0.005, filterDecay: 0.15, filterSustain: 0.2, filterRelease: 0.2,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Punchy Square' },
  },
  {
    id: 'bass-saw-growl', name: 'Saw Growl', category: 'Bass', isFactory: true,
    params: { oscType: 'sawtooth', subOscVolume: 0.5, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 700, filterResonance: 6, filterEnvAmount: 500,
      attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3,
      filterAttack: 0.01, filterDecay: 0.25, filterSustain: 0.3, filterRelease: 0.3,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Saw Growl' },
  },
  {
    id: 'bass-warm-tri', name: 'Warm Triangle', category: 'Bass', isFactory: true,
    params: { oscType: 'triangle', subOscVolume: 0.3, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 350, filterResonance: 1, filterEnvAmount: 0,
      attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.5,
      filterAttack: 0.03, filterDecay: 0.3, filterSustain: 1, filterRelease: 0.4,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Warm Triangle' },
  },
];
```

- [ ] **Verify 2b — `npm run lint`** — clean.
- [ ] **Commit 2c** — `git add src/audio/bassPresets.ts; git commit -m "feat: dedicated bass factory presets (5 research-tuned sounds)"`.

---

## Task 3: `engine.ts` — per-source buses, `setSourceMuted`, bass mono

**Files**
- Modify `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/audio/engine.ts`

**Interfaces**
- Consumes: existing `triggerSynthNoteOn`, `triggerSynthNoteOff`, `updateSynthParams`, `setupMasterChain` (signatures unchanged).
- Produces: `setSourceMuted(source: string, muted: boolean): void`; private `getSourceBus(source: string): GainNode`; private `sourceBuses: Map<string, GainNode>`.

**Invariants:** buses are created lazily after master-chain setup (first trigger of a source); mutes survive `updateEffects`/`updateSynthParams` (bus gains are only touched by `setSourceMuted`); the drum path never touches the buses.

- [ ] **Impl 3a — add the `sourceBuses` field** right after the `activeVoices` declaration (engine.ts ~line 31):

```ts
  // Active voices tracking
  private activeVoices = new Map<string, { oscs: OscillatorNode[]; gains: GainNode[]; filter: BiquadFilterNode; filterCutoff: number; filterRelease: number; lfo?: OscillatorNode; lfoGain?: GainNode; lfoTarget?: SynthParams['lfoTarget']; sustainLevel: number; source: string }>();

  // Per-source buses: one gain bus per source string ('synth', 'chord', 'bass', ...).
  // Voice gains connect here instead of straight to dry/effects, so a whole layer
  // (e.g. bass) can be muted with one click-free ramp.
  private sourceBuses = new Map<string, GainNode>();
```

- [ ] **Impl 3b — in `triggerSynthNoteOn`, insert the bass mono kill before the existing same-note stop** (the existing two lines stay untouched):

```ts
    // Bass is monophonic like a real bass: kill any other sounding bass voice
    // BEFORE creating the new one. Keys are snapshotted because
    // triggerSynthNoteOff deletes map entries while we iterate.
    if (source === 'bass') {
      for (const key of Array.from(this.activeVoices.keys())) {
        if (key.startsWith('bass:')) this.triggerSynthNoteOff(key.slice(5), 0.05, undefined, 'bass');
      }
    }

    // Stop existing voice if note is already sounding
    this.triggerSynthNoteOff(noteName, 0.3, undefined, source);
```

- [ ] **Impl 3c — in `triggerSynthNoteOn`, route the voice through its source bus** (replace the route block):

```ts
    // Route to dry, reverb, delay, distortion
    gainNode.connect(this.dryGain);
    if (this.delayNode) gainNode.connect(this.delayNode);
    if (this.reverbNode) gainNode.connect(this.reverbNode);
    if (this.distortionNode) gainNode.connect(this.distortionNode);
```
→
```ts
    // Route through the per-source bus (lazily created) to dry/effects
    gainNode.connect(this.getSourceBus(source));
```

- [ ] **Impl 3d — add `getSourceBus` and `setSourceMuted` after `triggerSynthNoteOff` (engine.ts ~line 416)**:

```ts
  // Lazily create (and cache) the gain bus for a source, wired like the old
  // per-voice routing: dry + conditionally delay/reverb/distortion.
  private getSourceBus(source: string): GainNode {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    let bus = this.sourceBuses.get(source);
    if (!bus) {
      bus = this.ctx.createGain();
      bus.gain.value = 1;
      bus.connect(this.dryGain);
      if (this.delayNode) bus.connect(this.delayNode);
      if (this.reverbNode) bus.connect(this.reverbNode);
      if (this.distortionNode) bus.connect(this.distortionNode);
      this.sourceBuses.set(source, bus);
    }
    return bus;
  }

  // Mute/unmute an entire source layer on its bus: ~10 ms ramp (click-free),
  // instantly cuts tails/effects, and survives across effect/param updates.
  setSourceMuted(source: string, muted: boolean): void {
    const bus = this.sourceBuses.get(source);
    if (!bus || !this.ctx) return;
    const now = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(muted ? 0 : 1, now, 0.01);
  }
```

- [ ] **Verify 3e — `npm run lint`** — clean.
- [ ] **Verify 3f — manual dev-server check:** `npm run dev` (tsx server.ts → http://localhost:3000). Open Chords tab, press play on a progression, then:
  - toggle `btn-mute-bass` mid-play → bass cuts instantly including any tail, no click; toggling back mid-note → bass returns immediately at full level.
  - toggle `btn-mute-chord` mid-play → chord layer cuts while bass keeps playing (buttons from Task 5; until then verify via a temporary `audioEngine.setSourceMuted('bass', true)` call in devtools console if the UI is not wired yet — the bus behavior is what matters here).
  - switch bass pattern/preset while playing → new line takes over on the next bar; no overlapping bass voices are audible (mono).
- [ ] **Commit 3g** — `git add src/audio/engine.ts; git commit -m "feat: per-source audio buses with click-free layer mute and monophonic bass"`.

---

## Task 4: `types.ts` + `App.tsx` — state, mute effect, props

**Files**
- Modify `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/types.ts`
- Modify `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/App.tsx`

**Interfaces**
- Produces: `ChordItem.bassNote?: string | null`; App state `bassSynthParams` (`FACTORY_BASS_PRESETS[0].params`), `bassPatternId` (`BASS_PATTERNS[0].id`), `bassOctave` (2), `chordMuted`/`bassMuted` (false); props to ChordView: `bassSynthParams`/`onChangeBassSynthParams`, `bassPatternId`/`onChangeBassPatternId`, `bassOctave`/`onChangeBassOctave`, `chordMuted`/`onToggleChordMuted`, `bassMuted`/`onToggleBassMuted`.

- [ ] **Impl 4a — `src/types.ts`, add the override to `ChordItem`** (types.ts line 55-61):

```ts
export interface ChordItem {
  id: string;
  root: string;
  quality: string;
  bars: number;
  notes: string[];
  bassNote?: string | null; // bass override note name ('E4'); null/absent = auto root
}
```

  Note: `deriveChordNotes` spreads `{...chord, notes: ...}` so `bassNote` automatically survives chord-octave changes and re-harmonization.

- [ ] **Impl 4b — `src/App.tsx`, add imports** (after line 12 `import { audioEngine } from './audio/engine';`):

```ts
import { FACTORY_BASS_PRESETS } from './audio/bassPresets';
import { BASS_PATTERNS } from './audio/bassPatterns';
```

- [ ] **Impl 4c — `src/App.tsx`, add the 5 state declarations** (right after line 197 `const [chordOctave, setChordOctave] = useState<number>(4);`):

```ts
  // Bass module: own preset/pattern/octave plus per-layer mutes (session-local, not persisted)
  const [bassSynthParams, setBassSynthParams] = useState<SynthParams>(FACTORY_BASS_PRESETS[0].params);
  const [bassPatternId, setBassPatternId] = useState<string>(BASS_PATTERNS[0].id);
  const [bassOctave, setBassOctave] = useState<number>(2);
  const [chordMuted, setChordMuted] = useState<boolean>(false);
  const [bassMuted, setBassMuted] = useState<boolean>(false);
```

- [ ] **Impl 4d — `src/App.tsx`, add the mute effect** (right after the `updateSynthParams` effect closing at line 206):

```ts
  // Per-layer mutes live on the engine's source buses: scheduling keeps running,
  // the bus gain decides audibility (instant, click-free).
  useEffect(() => {
    audioEngine.setSourceMuted('chord', chordMuted);
    audioEngine.setSourceMuted('bass', bassMuted);
  }, [chordMuted, bassMuted]);
```

- [ ] **Impl 4e — `src/App.tsx`, pass the new props to ChordView** (after line 364 `onChangeMasterChordVelocity={setMasterChordVelocity}`):

```tsx
            bassSynthParams={bassSynthParams}
            onChangeBassSynthParams={setBassSynthParams}
            bassPatternId={bassPatternId}
            onChangeBassPatternId={setBassPatternId}
            bassOctave={bassOctave}
            onChangeBassOctave={setBassOctave}
            chordMuted={chordMuted}
            onToggleChordMuted={() => setChordMuted((prev) => !prev)}
            bassMuted={bassMuted}
            onToggleBassMuted={() => setBassMuted((prev) => !prev)}
```

- [ ] **Verify 4f — `npm run lint`** — clean.
- [ ] **Commit 4g** — `git add src/types.ts src/App.tsx; git commit -m "feat: chord/bass layer state, mute wiring, and bass module props in App"`.

---

## Task 5: `ChordView.tsx` — mute buttons, bass module panel, per-chord bass override

**Files**
- Modify `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/components/ChordView.tsx`

**Interfaces**
- Consumes (new props, exact names from Task 4): `bassSynthParams`, `onChangeBassSynthParams`, `bassPatternId`, `onChangeBassPatternId`, `bassOctave`, `onChangeBassOctave`, `chordMuted`, `onToggleChordMuted`, `bassMuted`, `onToggleBassMuted`.
- Produces: mute buttons `#btn-mute-chord` / `#btn-mute-bass`; Bass Module panel; per-chord `Bass` select writing `chord.bassNote` via `updateChord(chord.id, { bassNote: value || null })`.

- [ ] **Impl 5a — extend imports** (line 2 lucide import and the audio imports):

```ts
import { Music, Play, Square, Sparkles, Plus, Trash2, ArrowRight, Library, Bookmark, Check, Link2, Volume2, VolumeX } from 'lucide-react';
```
```ts
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { BASS_PATTERNS, BASS_STYLE_GROUPS, BassPattern } from '../audio/bassPatterns';
```

- [ ] **Impl 5b — extend `ChordViewProps`** (after line 31 `onChangeChordOctave`):

```ts
  bassSynthParams: SynthParams;
  onChangeBassSynthParams: (params: SynthParams) => void;
  bassPatternId: string;
  onChangeBassPatternId: (id: string) => void;
  bassOctave: number;
  onChangeBassOctave: (octave: number) => void;
  chordMuted: boolean;
  onToggleChordMuted: () => void;
  bassMuted: boolean;
  onToggleBassMuted: () => void;
```

- [ ] **Impl 5c — add the bass preset-id local state and derived pattern** (after line 419 `const [isAutoReharmonizedIndicator, setIsAutoReharmonizedIndicator] = useState<boolean>(false);`):

```ts
  const [selectedBassPresetId, setSelectedBassPresetId] = useState<string>(FACTORY_BASS_PRESETS[0].id);
  const bassPattern = BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];
```

- [ ] **Impl 5d — mute toggle buttons** inserted right after the Follow Main Synth button (after line 637 `</button>`); chord uses indigo accent, bass uses emerald (per spec), both switch to rose + `VolumeX` when muted:

```tsx
          {/* Per-layer mute toggles (engine source buses — tails cut instantly) */}
          <button
            id="btn-mute-chord"
            onClick={onToggleChordMuted}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              chordMuted
                ? 'bg-rose-600/30 border-rose-500/50 text-rose-200'
                : 'bg-[#0B0D19] border-[#2D355A] text-slate-400'
            }`}
            title="Mute the chord layer on its engine bus (instant, includes tails)"
          >
            {chordMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-indigo-300" />
            )}
            <span>Chord: {chordMuted ? 'OFF' : 'ON'}</span>
          </button>

          <button
            id="btn-mute-bass"
            onClick={onToggleBassMuted}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              bassMuted
                ? 'bg-rose-600/30 border-rose-500/50 text-rose-200'
                : 'bg-[#0B0D19] border-[#2D355A] text-slate-400'
            }`}
            title="Mute the bass layer on its engine bus (instant, includes tails)"
          >
            {bassMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
            )}
            <span>Bass: {bassMuted ? 'OFF' : 'ON'}</span>
          </button>
```

- [ ] **Impl 5e — Bass Module panel** inserted between the Active Chord Progression card close and the library drawer comment (between line 902 `</div>` and line 904 `{/* Full Chord Preset Library Sidebar Drawer */}`):

```tsx
      {/* Bass Module Panel */}
      <div className="mt-4 bg-[#12152A] border border-[#252B48] rounded-xl p-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-emerald-300">Bass Module</h3>
          <p className="text-[10px] text-slate-500">
            Bass line follows the same chord progression loop; pattern steps are 16th notes.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Bass Preset</label>
            <select
              id="select-bass-sound-preset"
              value={selectedBassPresetId}
              onChange={(e) => {
                const preset = FACTORY_BASS_PRESETS.find((p) => p.id === e.target.value);
                if (!preset) return;
                setSelectedBassPresetId(preset.id);
                onChangeBassSynthParams({ ...bassSynthParams, ...preset.params });
              }}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Bass sound preset (dedicated bass factory presets)"
            >
              {FACTORY_BASS_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Bass Octave</label>
            <select
              id="select-bass-octave"
              value={bassOctave}
              onChange={(e) => onChangeBassOctave(parseInt(e.target.value, 10))}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Register for the bass line (embedded in the note names)"
            >
              {[1, 2, 3, 4].map((o) => (
                <option key={o} value={o}>Oct {o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Bass Pattern</label>
            <select
              id="select-bass-rhythm-pattern"
              value={bassPatternId}
              onChange={(e) => onChangeBassPatternId(e.target.value)}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Bass pattern (16th-note grid, deterministic)"
            >
              {BASS_STYLE_GROUPS.map((group) => (
                <optgroup key={group.style} label={group.style}>
                  {group.patterns.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>
```

- [ ] **Impl 5f — per-chord bass override select** inside each chord block's edit controls, after the Quality div (insert between line 896 `</div>` and line 897, the grid's closing tag); options derive from `chord.notes[1..3]` with `Auto` (value `''`) mapping to `null`:

```tsx
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 block mb-0.5">Bass</label>
                    <select
                      id={`select-chord-bass-${chord.id}`}
                      value={chord.bassNote ?? ''}
                      onChange={(e) => updateChord(chord.id, { bassNote: e.target.value || null })}
                      className="w-full bg-[#12152A] border border-[#2D355A] text-slate-200 text-xs rounded p-1"
                      title="Bass note override for this chord (slash chord / inversion). Auto = chord root."
                    >
                      <option value="">Auto</option>
                      {chord.notes.slice(1, 4).map((n, i) => (
                        <option key={`${n}-${i}`} value={n}>
                          {['3rd', '5th', '7th'][i]} ({n})
                        </option>
                      ))}
                    </select>
                  </div>
```

- [ ] **Verify 5g — `npm run lint`** — clean.
- [ ] **Verify 5h — manual dev-server check:** `npm run dev` → http://localhost:3000, Chords tab. Mute buttons show correct ON/OFF + rose OFF state; Bass Module panel renders preset/octave/pattern selects with optgroups (Walking/Grooves/Minimal); each chord block has a `Bass` select showing `Auto`/3rd/5th/7th derived from its notes (only what exists — a triad shows no 7th option); changing Root/Quality re-derives notes and the options update; changing chord octave keeps the selected override (bassNote survives `deriveChordNotes`).
- [ ] **Commit 5i** — `git add src/components/ChordView.tsx; git commit -m "feat: chord view bass module UI — layer mutes, bass panel, per-chord bass override"`.

---

## Task 6: `ChordView.tsx` — bass scheduling (clock loop + pad click)

**Files**
- Modify `/Users/Pathompong/Sites/Personal/murva-from-googlestudio/src/components/ChordView.tsx`

**Interfaces**
- Consumes: `resolveBassSteps` from `../audio/bassPatterns` (signature identical to Task 1); `audioEngine.triggerSynthNoteOn/Off` with `source = 'bass'`.
- Produces: `playBassWithPattern(chord: ChordItem, startTime: number, pattern: BassPattern)` — schedules the full resolved bass line at `startTime`; called from `subscribeClock` and the chord pad onClick. Mute state is never read here (engine bus handles it).

- [ ] **Impl 6a — import `resolveBassSteps`** (extend the bassPatterns import added in 5a):

```ts
import { BASS_PATTERNS, BASS_STYLE_GROUPS, BassPattern, resolveBassSteps } from '../audio/bassPatterns';
```

- [ ] **Impl 6b — add the `playBassWithPattern` callback** right after `playChordWithRhythm` (after line 409, its closing `}, [bpm, chordSynthParams, chordOctave, masterChordVelocity])`):

```ts
  const playBassWithPattern = useCallback(
    (chord: ChordItem, startTime: number, pattern: BassPattern) => {
      audioEngine.init();
      const chordIdx = Math.max(0, chords.indexOf(chord));
      const events = resolveBassSteps(pattern, chords, chordIdx, bassOctave, scaleRoot, scaleType, bpm);
      for (const ev of events) {
        audioEngine.triggerSynthNoteOn(ev.noteName, bassSynthParams, ev.velocity, startTime + ev.timeOffsetSec, 'bass');
        audioEngine.triggerSynthNoteOff(ev.noteName, bassSynthParams.release, startTime + ev.timeOffsetSec + ev.holdSec, 'bass');
      }
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams]
  );
```

- [ ] **Impl 6c — schedule bass in `subscribeClock`** (line 442, right after `playChordWithRhythm(chord, time, rhythmPattern);`):

```tsx
      playChordWithRhythm(chord, time, rhythmPattern);
      playBassWithPattern(chord, time, bassPattern);
```

  and add the new deps to that effect (line 448): `}, [isPlaying, chords, playChordWithRhythm, playBassWithPattern, rhythmPattern, bassPattern]);`

- [ ] **Impl 6d — schedule bass on chord pad click** (line 826, right after `playChordWithRhythm(chord, now, rhythmPattern);`):

```tsx
  playChordWithRhythm(chord, now, rhythmPattern);
  playBassWithPattern(chord, now, bassPattern);
```

- [ ] **Verify 6e — `npm run lint`** — clean.
- [ ] **Verify 6f — manual dev-server check:** `npm run dev` → http://localhost:3000, Chords tab, press play. Listen for:
  - Classic Walk: root→3rd→5th→chromatic lead-in; the approach flips above/below every bar; the last chord's approach leads into the first chord (wrap).
  - Switching patterns mid-play (Driving 8ths, Funk Octaves, Reggae One-Drop, Half-Time Legato, Whole-Note Root) → new line takes over on the next bar; bass never overlaps itself (mono).
  - Changing bass octave 1–4 shifts the whole line's register; changing preset changes the timbre (Deep Sine Sub = subby, Punchy Square = aggressive).
  - Per-chord `Bass` override (e.g. 5th on the first chord) → that bar's root token and the *approach into that chord* both target the override note.
  - Chord pad click → chord + its bass line play together; with `btn-mute-bass` ON the pad still "plays" but the bass layer stays silent; unmuting brings it back mid-note instantly.
  - Mute toggles while playing cut each layer's tails instantly with no click.
- [ ] **Commit 6g** — `git add src/components/ChordView.tsx; git commit -m "feat: schedule pattern-based bass line in chord playback loop and pad triggers"`.

---

## Self-Review Checklist (verify before finishing)

- [ ] Spec §1 data model: `BassNoteToken`/`BassStep`/`BassPattern`/`ResolvedBassEvent` all defined; `alternate` documented as the review resolution for `chordIndex % 2`.
- [ ] Spec §1 resolver: `bassNote ?? root`; root/third/fifth/seventh/octave mapping; fallback chain; all four approach tokens target next chord with last→first wrap; `approachDiatonicUp` uses `SCALES[scaleType].intervals` + `rootSemitone`; octave embedded via `Note.fromMidi`; `octaveShift`; timing/hold/staccato/velocity rules — all implemented and pinned by Task 1 tests.
- [ ] Spec §1 factory patterns: all 9 patterns with the exact 16-step grids; `BASS_STYLE_GROUPS` IIFE mirrors `RHYTHM_STYLE_GROUPS`.
- [ ] Spec §2 engine: 5 changes all present (sourceBuses, lazy `getSourceBus` wired to dry/delay/reverb/distortion, `setSourceMuted` ~10 ms ramp, bass mono before new voice creation with snapshot iteration, no new synth params, `updateSynthParams` untouched, drums untouched).
- [ ] Spec §3 state/data flow: `ChordItem.bassNote?`; 5 App states + mute effect + props; ProjectState not extended.
- [ ] Spec §3 playback: scheduling in `subscribeClock` and pad click; mute is bus-only (loop never reads mute state).
- [ ] Spec §4 presets: 5 exact param objects, `octave: 0` (only `category`/`isFactory` added, noted as a fix).
- [ ] Spec §5 UI: mute buttons (ids `btn-mute-chord`/`btn-mute-bass`, `Volume2`/`VolumeX`, chord=indigo, bass=emerald, ON/OFF labels), bass panel below progression (preset/octave/pattern selects), per-chord override select (Auto + 3rd/5th/7th from `chord.notes`).
- [ ] Spec §6 testing: `bun:test` resolver unit tests, `npm run lint` in every task, manual dev-server listen checks per task; audio scheduling code intentionally not unit-tested (stated in Task 1).
- [ ] Spec §7 files table: every row maps to a task (bassPatterns.ts, bassPatterns.test.ts, bassPresets.ts, engine.ts, types.ts, App.tsx, ChordView.tsx, package.json).
- [ ] Spec §8 out of scope: no generative bass, no persistence, no bass volume slider, no step editor, no per-layer EQ — none introduced.
- [ ] No placeholders: every code block is complete and runnable; no TBD/TODO.
- [ ] Type consistency: `resolveBassSteps` signature identical in Tasks 1 and 6; prop names identical across Tasks 4/5/6 (`bassPatternId`/`onChangeBassPatternId`, `bassSynthParams`/`onChangeBassSynthParams`, `bassOctave`/`onChangeBassOctave`, `chordMuted`/`onToggleChordMuted`, `bassMuted`/`onToggleBassMuted`, `chord.bassNote`).
