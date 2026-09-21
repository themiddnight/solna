# DEV-424 Loop Content and Key Change as a Store Operation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name a loop's content (`LoopContent`), make `createDefaultLoopContent()` the one source of per-loop defaults, and move key change — melodies AND chord harmonize — into one pure store operation `changeKey`, with the auto-reharmonize toggle and badge as session-only store fields.

**Architecture:** `LoopContent = Pick<Loop, LoopFlatKey>` lives beside `LOOP_FLAT_KEYS` in `src/store/loop.ts`. A leaf module `src/store/loopDefaults.ts` builds default content; `store.ts` passes it to the slice factories. `src/store/keyChange.ts` holds the pure `changeKey`; `setScaleRoot`/`setScaleType` apply it to the flat active state in one `set()` (the existing `loopSync` mirror carries it into `loops[]`). The chord-view effect that used to harmonize chords after render is deleted.

**Tech Stack:** TypeScript, React, zustand, Bun test runner (`bun:test`, no DOM), ESLint, Knip.

**Spec:** `docs/superpowers/specs/2026-09-22-loop-content-and-batch-key-design.md` (PR 1 sections §0, §1.1–§1.10).

## Global Constraints

- Branch: `refactor/dev-424-loop-content` (already exists; work directly on it). Never push.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Persisted payload and `.solna` body shapes are unchanged; no version bump, no migration (R035, R214, R219).
- Everything generated/computed/persisted is `ROOTS`-spelled; spelling is display-only (R064).
- `autoReharmonize` and `reharmonizedIndicator` are session-only: never in `partializeAppState`, `PROJECT_CONTENT_KEYS` or `LOOP_FLAT_KEYS`.
- Components: one value per `useAppStore` selector (R274); no DOM or testing-library (testing.md).
- No version numbers, file counts or line numbers in docs (R001).
- Gate: `bun run verify` passes and `bun run eslint` prints zero errors AND zero warnings (R004, R005, R264). Both Knip scans stay at zero findings (R006).
- New rule ids: take the next free `R###` (at time of writing the highest is R278 — re-check with `grep -rhoE "R[0-9]{3}" .claude/rules docs/decisions CLAUDE.md | sort -u | tail -1`). New ADR number: 0032.

## File map

| File | Change |
|---|---|
| `src/store/loop.ts` | `LoopFlatKey`, `LoopContent`; `LOOP_FLAT_KEYS satisfies`; `loopStatePatch` returns `LoopContent` |
| `src/store/types.ts` | delete `LoopStatePatch`; `MusicContextSlice` gains two flags + two actions |
| `src/store/loopCopy.ts`, `src/store/projectFormat.ts` | `LoopStatePatch` → `LoopContent` |
| `src/store/loopDefaults.ts` | **new** — `createDefaultLoopContent()` |
| `src/store/loopSlice.ts` | `createDefaultLoop` = identity + `createDefaultLoopContent()` |
| `src/store/{musicContext,synth,chords,bass}Slice.ts`, `src/store/leadSlice.ts`, `src/store/fxSlice.ts` | take `defaults: LoopContent` |
| `src/store/store.ts` | build defaults once, pass to factories |
| `src/store/keyChange.ts` | **new** — `changeKey`, `harmonizeChordsToKey` |
| `src/store/musicContextSlice.ts` | delete `keyChangePatch`; setters use `changeKey`; new flags |
| `src/store/vibes.ts` | `changeKey(..., { harmonizeChords: false })` + clear indicator |
| `src/store/reharmonizeNav.ts` | **new** — clear indicator on loop switch / project install |
| `src/App.tsx` | mount `useReharmonizeNavClear()` |
| `src/store/loopCopySlice.ts` | clear indicator when a chord-progression copy lands on the active loop |
| `src/components/loop/chord/useChordView.ts` | `useProgressionHarmonize` reads the store; effect deleted |
| `src/components/loop/chord/progressionHarmonize.ts` | **delete** |
| `src/components/loop/ChordView.tsx` | drop the re-export |
| docs | ADR-0032, rules, CLAUDE.md, skill, architecture docs (Task 8) |

---

### Task 1: `LoopContent` bound to `LOOP_FLAT_KEYS`

**Branch:** `refactor/dev-424-loop-content` (already checked out — confirm with `git branch --show-current`).

**Files:**
- Modify: `src/store/loop.ts` (the `LOOP_FLAT_KEYS` declaration, the `import type` line, `loopStatePatch`)
- Modify: `src/store/types.ts` (delete `export type LoopStatePatch = …` and fix the `tempName` docblock that names it)
- Modify: `src/store/loopCopy.ts`, `src/store/projectFormat.ts` (replace every `LoopStatePatch` with `LoopContent`, importing it from `./loop`)
- Test: `src/store/loop.test.ts`

**Interfaces:**
- Produces: `export type LoopFlatKey = (typeof LOOP_FLAT_KEYS)[number];` and `export type LoopContent = Pick<Loop, LoopFlatKey>;` from `src/store/loop.ts`. `loopStatePatch(source: object): LoopContent`.

- [ ] **Step 1: Write the failing test** — append to `src/store/loop.test.ts`:

```ts
import type { Loop } from './types';
import { LOOP_FLAT_KEYS, type LoopContent } from './loop';
import { createDefaultLoop } from './loopSlice';

describe('LoopContent', () => {
  test('every Loop field is either slot identity or listed in LOOP_FLAT_KEYS (compile-time)', () => {
    // `bun run lint` (tsc) fails this assignment if a Loop field is unlisted.
    type Identity = 'id' | 'name' | 'tempName' | 'repeatCount';
    type Unlisted = Exclude<keyof Loop, (typeof LOOP_FLAT_KEYS)[number] | Identity>;
    const everyFieldClassified: [Unlisted] extends [never] ? true : false = true;
    expect(everyFieldClassified).toBe(true);
  });

  test('a default loop is exactly identity plus LOOP_FLAT_KEYS', () => {
    const keys = Object.keys(createDefaultLoop()).sort();
    expect(keys).toEqual([...LOOP_FLAT_KEYS, 'id', 'name', 'tempName', 'repeatCount'].sort());
  });

  test('LoopContent carries no identity field', () => {
    const content: LoopContent = (({ id: _i, name: _n, tempName: _t, repeatCount: _r, ...rest }) => rest)(
      createDefaultLoop(),
    );
    expect('id' in content).toBe(false);
  });
});
```

(Merge imports with the file's existing import block rather than duplicating `describe/test/expect`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run lint`
Expected: FAIL — `Module './loop' has no exported member 'LoopContent'`.

- [ ] **Step 3: Implement** — in `src/store/loop.ts`:

```ts
import type { Loop } from './types';

/** Every per-loop persisted field, in one source of truth. */
export const LOOP_FLAT_KEYS = [
  // …existing list unchanged…
] as const satisfies readonly (keyof Loop)[];

export type LoopFlatKey = (typeof LOOP_FLAT_KEYS)[number];

/**
 * A loop's musical content: every field except its slot identity (`id`,
 * `name`, `tempName`, `repeatCount`). What `loadLoop` writes to the flat
 * slices, what the mirror writes back, and what `changeKey` transforms.
 * loop.test.ts pins at compile time that no `Loop` field is left out.
 */
export type LoopContent = Pick<Loop, LoopFlatKey>;
```

Change `loopStatePatch`'s return type and cast from `LoopStatePatch` to `LoopContent`. In `types.ts` delete the `LoopStatePatch` alias and reword the `tempName` docblock's "never rides in a LoopStatePatch" to "never rides in `LoopContent`". In `loopCopy.ts` and `projectFormat.ts` replace `LoopStatePatch` with `LoopContent` (`import type { LoopContent } from './loop';`), including their comments.

- [ ] **Step 4: Run tests**

Run: `bun run lint && bun test src/store/loop.test.ts src/store/loopCopy.test.ts src/store/projectFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/loop.ts src/store/types.ts src/store/loopCopy.ts src/store/projectFormat.ts src/store/loop.test.ts
git commit -m "refactor(store): name loop content and bind it to LOOP_FLAT_KEYS (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `createDefaultLoopContent()` is the one default source

**Files:**
- Create: `src/store/loopDefaults.ts`
- Modify: `src/store/loopSlice.ts` (`createDefaultLoop`)
- Modify: `src/store/musicContextSlice.ts`, `src/store/synthSlice.ts`, `src/store/chordsSlice.ts`, `src/store/bassSlice.ts`, `src/store/leadSlice.ts` (`createMelodySlice`, `createLeadSlice`), `src/store/fxSlice.ts`, `src/store/store.ts`
- Test: `src/store/store.test.ts`

**Interfaces:**
- Consumes: `LoopContent` (Task 1).
- Produces: `export function createDefaultLoopContent(): LoopContent` in `src/store/loopDefaults.ts`. New factory signatures: `createMusicContextSlice(set, defaults: LoopContent)`, `createSynthSlice(set, defaults)`, `createChordsSlice(set, defaults)`, `createBassSlice(set, defaults)`, `createMelodySlice(track, set, get, defaults)`, `createLeadSlice(set, get, defaults)`, `createFxSlice(set, get, defaults)`.

- [ ] **Step 1: Write the failing test** — in `src/store/store.test.ts`, add:

```ts
import { createDefaultLoopContent } from './loopDefaults';
import { loopStatePatch } from './loop';

describe('one default source (S7)', () => {
  test('the store boots with exactly the default loop content in its flat fields', () => {
    expect(loopStatePatch(useAppStore.getInitialState())).toEqual(createDefaultLoopContent());
  });

  test('each call returns fresh mutable substructure', () => {
    const a = createDefaultLoopContent();
    const b = createDefaultLoopContent();
    expect(a.customChordRhythm).not.toBe(b.customChordRhythm);
    expect(a.leadMelodySteps).not.toBe(b.leadMelodySteps);
    expect(a.beatPattern).not.toBe(b.beatPattern);
  });
});
```

and update the two existing direct factory calls: `createChordsSlice(set)` → `createChordsSlice(set, createDefaultLoopContent())`, `createBassSlice(set)` → `createBassSlice(set, createDefaultLoopContent())`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/store.test.ts`
Expected: FAIL — cannot resolve `./loopDefaults`.

- [ ] **Step 3: Create `src/store/loopDefaults.ts`** by moving the content half of `createDefaultLoop` verbatim:

```ts
import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import {
  defaultFxState,
  defaultPadState,
  defaultTrackArp,
  defaultTrackSynth,
  INITIAL_CHORDS,
} from './initialState';
import { defaultBeatState } from './beatPresets';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import type { LoopContent } from './loop';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION, LEAD_TICKS_PER_BAR } from '../utils/stepResolution';

/**
 * The one place a per-loop default is written (S7). `createDefaultLoop` adds
 * slot identity to it; `store.ts` hands it to every slice factory that owns
 * per-loop fields. A leaf module on purpose: it imports no slice, so it can
 * never join the loopSlice/store cycle loopCopySlice.ts documents.
 * A factory, not a constant: every array and object is fresh per call.
 */
export function createDefaultLoopContent(): LoopContent {
  return {
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    // …every remaining field exactly as createDefaultLoop has it today,
    //   including its comments (synth/arp, chords, custom lanes, bass,
    //   ...defaultPadState(), ...defaultFxState(), lead fields,
    //   ...defaultBeatState(), the DEFAULT_BUS_TRIM_DB volumes and mutes)…
  };
}
```

Then `createDefaultLoop` in `loopSlice.ts` becomes:

```ts
/** The loop every fresh project starts with: slot identity plus default content. */
export function createDefaultLoop(): Loop {
  return {
    id: DEFAULT_LOOP_ID,
    name: '',
    tempName: 'untitled-1',
    repeatCount: 1,
    ...createDefaultLoopContent(),
  };
}
```

Remove now-unused imports from `loopSlice.ts` (ESLint/Knip will flag them).

- [ ] **Step 4: Thread `defaults` through the factories.** Replace each per-loop literal with the matching `defaults` field; leave non-content fields (cursors, clipboards, actions) alone. Concretely:

```ts
// musicContextSlice.ts
export function createMusicContextSlice(set: Set, defaults: LoopContent): MusicContextSlice {
  return {
    scaleRoot: defaults.scaleRoot,
    scaleType: defaults.scaleType,
    selectedVibeId: null,
    // …actions unchanged in this task…
  };
}

// synthSlice.ts
export function createSynthSlice(set: Set, defaults: LoopContent): SynthSlice {
  return {
    synthParams: defaults.synthParams,
    chordSynthParams: defaults.chordSynthParams,
    bassSynthParams: defaults.bassSynthParams,
    synthArpSettings: defaults.synthArpSettings,
    chordArpSettings: defaults.chordArpSettings,
    bassArpSettings: defaults.bassArpSettings,
    synthVolume: defaults.synthVolume,
    synthMuted: defaults.synthMuted,
    // …actions…
  };
}

// chordsSlice.ts
export function createChordsSlice(set: Set, defaults: LoopContent): ChordsSlice {
  return {
    chords: defaults.chords,
    chordRhythmId: defaults.chordRhythmId,
    chordRhythmMode: defaults.chordRhythmMode,
    customChordRhythm: defaults.customChordRhythm,
    customChordLoopLength: defaults.customChordLoopLength,
    customChordHoldSteps: defaults.customChordHoldSteps,
    chordFeel: defaults.chordFeel,
    chordOctave: defaults.chordOctave,
    chordMuted: defaults.chordMuted,
    chordVolume: defaults.chordVolume,
    // …actions…
  };
}

// bassSlice.ts
export function createBassSlice(set: Set, defaults: LoopContent): BassSlice {
  return {
    bassPatternId: defaults.bassPatternId,
    bassPatternMode: defaults.bassPatternMode,
    customBassPattern: defaults.customBassPattern,
    customBassLoopLength: defaults.customBassLoopLength,
    customBassHoldSteps: defaults.customBassHoldSteps,
    bassFeel: defaults.bassFeel,
    bassOctave: defaults.bassOctave,
    bassMuted: defaults.bassMuted,
    bassVolume: defaults.bassVolume,
    // …actions…
  };
}

// leadSlice.ts — createMelodySlice gains a 4th parameter
export function createMelodySlice(track: MelodyTrack, set: Set, get: Get, defaults: LoopContent): Partial<AppStore> {
  const slice: Record<string, unknown> = {
    [track.steps]: defaults[track.steps],
    [track.loopLength]: defaults[track.loopLength],
    [track.stepResolution]: defaults[track.stepResolution],
    [track.view]: defaults[track.view],
    [track.octave]: defaults[track.octave],
    [track.gate]: defaults[track.gate],
    [track.cursor]: 0,
    [track.clipboard]: null,
    // …rest unchanged…
  };
}
export function createLeadSlice(set: Set, get: Get, defaults: LoopContent): LeadSlice {
  return createMelodySlice(melodyTrack('lead'), set, get, defaults) as LeadSlice;
}

// fxSlice.ts
export function createFxSlice(set, get, defaults: LoopContent): FxSlice {
  const melody = createMelodySlice(melodyTrack('fx'), set, get, defaults);
  // …unchanged (its ...defaultFxState() spread stays: the same factory createDefaultLoopContent spreads)…
}
```

If `defaults[track.steps]` does not type-check because a `MelodyTrack` field is typed wider than `LoopFlatKey`, index through `(defaults as Record<string, unknown>)[track.steps]` with a one-line comment — `slice` is already a `Record<string, unknown>`.

Leave `createPadSlice` and `createBeatSlice` unchanged (they spread `defaultPadState()`/`defaultBeatState()`, which `createDefaultLoopContent` spreads too — spec §1.2).

In `store.ts`, inside the creator before `return {`:

```ts
// The one default content (S7): every slice owning per-loop fields reads its
// initial values from it. loops[0] gets its own copy via createDefaultLoop.
const defaults = createDefaultLoopContent();
```

and pass `defaults` to `createMusicContextSlice`, `createSynthSlice`, `createChordsSlice`, `createBassSlice`, `createLeadSlice`, `createFxSlice`.

- [ ] **Step 5: Run tests**

Run: `bun run lint && bun test src/store/store.test.ts src/store/loopSlice.test.ts src/store/leadSlice.test.ts src/store/fxSlice.test.ts src/store/initialState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store
git commit -m "refactor(store): derive slice defaults from createDefaultLoopContent (DEV-424, S7)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pure `changeKey`

**Files:**
- Create: `src/store/keyChange.ts`
- Test: `src/store/keyChange.test.ts`

**Interfaces:**
- Consumes: `LoopContent` (Task 1); `transposeLeadMelodyByRoot`, `remapLeadMelodyByScale` (`src/audio/leadMelody.ts`); `transposeProgression`, `snapProgressionToScale` (`@/utils/musicTheory`); `MELODY_TRACKS` (`./melodyTracks`).
- Produces:

```ts
export type KeyChangeSource = Pick<LoopContent,
  'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps'>;
export interface KeyChangeTarget { root?: string; scaleType?: string }
export interface KeyChangeOptions { harmonizeChords: boolean }
export function harmonizeChordsToKey(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
): ChordItem[] | null;
export function changeKey(content: KeyChangeSource, target: KeyChangeTarget, opts: KeyChangeOptions): Partial<LoopContent>;
```

- [ ] **Step 1: Write the failing test** — `src/store/keyChange.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { ROOTS } from '@/musicCore';
import type { ChordQuality } from '@/musicCore';
import type { ChordItem } from '@/types';
import type { LeadNote } from '../audio/leadMelody';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { createDefaultLoop } from './loopSlice';
import { changeKey, harmonizeChordsToKey, type KeyChangeSource } from './keyChange';

const chord = (id: string, root: string, quality: ChordQuality, extra: Partial<ChordItem> = {}): ChordItem =>
  ({ id, root, quality, bars: 1, ...extra });

// A Natural Minor, i - VI - III - VII (the same fixture ChordView.test used).
const PROGRESSION: ChordItem[] = [
  chord('c1', 'A', 'min'),
  chord('c2', 'F', 'maj'),
  chord('c3', 'C', 'maj'),
  chord('c4', 'G', 'maj'),
];
const A_MINOR = { root: 'A', scaleType: 'Natural Minor' };
const names = (chords: ChordItem[] | null | undefined) =>
  chords == null ? null : chords.map((c) => `${c.root}${c.quality}`);

function melody(notes: LeadNote[]): LeadNote[][] {
  const steps = Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]);
  steps[0] = notes;
  return steps;
}

function source(over: Partial<KeyChangeSource> = {}): KeyChangeSource {
  return {
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    chords: PROGRESSION,
    leadMelodySteps: melody([{ note: 'A3', len: 1 }, { note: 'C4', len: 1 }]),
    fxMelodySteps: melody([{ note: 'E4', len: 1 }]),
    ...over,
  };
}

describe('harmonizeChordsToKey', () => {
  test('a root-only change transposes and does not snap', () => {
    expect(names(harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' })))
      .toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('a scale-only change snaps and does not transpose', () => {
    expect(names(harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR, scaleType: 'Major' })))
      .toEqual(['Amaj', 'Emaj', 'Bmin', 'F#min']);
  });

  test('both changed transposes first, then snaps — the order is pinned', () => {
    const both = harmonizeChordsToKey(PROGRESSION, A_MINOR, { root: 'C', scaleType: 'Major' });
    expect(names(both)).toEqual(['Cmaj', 'Gmaj', 'Dmin', 'Amin']);
    expect(names(both)).not.toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('an unchanged key and an empty chord list both return null', () => {
    expect(harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR })).toBeNull();
    expect(harmonizeChordsToKey([], A_MINOR, { root: 'C', scaleType: 'Major' })).toBeNull();
  });

  test('bars and slash bass survive; every root stays ROOTS-spelled', () => {
    const input = [chord('c1', 'A', 'min', { bars: 2, bassNote: 'E' }), chord('c2', 'F', 'maj')];
    const out = harmonizeChordsToKey(input, A_MINOR, { root: 'C#', scaleType: 'Major' })!;
    expect(out.map((c) => c.bars)).toEqual([2, 1]);
    expect(out[0].bassNote).toBeDefined();
    for (const c of out) expect(ROOTS as readonly string[]).toContain(c.root);
  });
});

describe('changeKey', () => {
  test('melodies follow exactly as before: root transpose under the old type', () => {
    const patch = changeKey(source(), { root: 'C' }, { harmonizeChords: false });
    expect(patch.scaleRoot).toBe('C');
    expect('scaleType' in patch).toBe(false);
    expect(patch.leadMelodySteps![0]).toEqual([{ note: 'C3', len: 1 }, { note: 'D#3', len: 1 }]);
    expect(patch.fxMelodySteps![0]).toEqual([{ note: 'G3', len: 1 }]);
  });

  test('harmonizeChords: false leaves chords out of the patch', () => {
    expect('chords' in changeKey(source(), { root: 'C' }, { harmonizeChords: false })).toBe(false);
  });

  test('harmonizeChords: true transposes then snaps the chords', () => {
    const patch = changeKey(source(), { root: 'C', scaleType: 'Major' }, { harmonizeChords: true });
    expect(names(patch.chords)).toEqual(['Cmaj', 'Gmaj', 'Dmin', 'Amin']);
  });

  test('no chords key for an empty progression or an unchanged key', () => {
    expect('chords' in changeKey(source({ chords: [] }), { root: 'C' }, { harmonizeChords: true })).toBe(false);
    expect('chords' in changeKey(source(), { root: 'A' }, { harmonizeChords: true })).toBe(false);
  });

  test('touches only key, melody and chord fields — bass, pad, drums and mix stay out', () => {
    const patch = changeKey(createDefaultLoop(), { root: 'D', scaleType: 'Dorian' }, { harmonizeChords: true });
    for (const key of Object.keys(patch)) {
      expect(['scaleRoot', 'scaleType', 'chords', 'leadMelodySteps', 'fxMelodySteps']).toContain(key);
    }
  });

  test('works on a non-active loop from loops[] exactly as on flat state', () => {
    // changeKey reads only its argument — a Loop in loops[] and a flat state
    // holding the same content give the same patch; no activeLoopId is read.
    const loop = { ...createDefaultLoop(), id: 'loop-other', ...source() };
    const fromLoop = changeKey(loop, { root: 'E', scaleType: 'Major' }, { harmonizeChords: true });
    const fromFlat = changeKey(source(), { root: 'E', scaleType: 'Major' }, { harmonizeChords: true });
    expect(fromLoop).toEqual(fromFlat);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/keyChange.test.ts`
Expected: FAIL — cannot resolve `./keyChange`.

- [ ] **Step 3: Implement `src/store/keyChange.ts`**

```ts
import type { ChordItem } from '../types';
import { snapProgressionToScale, transposeProgression } from '../utils/musicTheory';
import { remapLeadMelodyByScale, transposeLeadMelodyByRoot } from '../audio/leadMelody';
import type { LoopContent } from './loop';
import { MELODY_TRACKS } from './melodyTracks';

/** The fields a key change reads. The flat AppStore and every Loop satisfy it. */
export type KeyChangeSource = Pick<
  LoopContent,
  'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps'
>;
export interface KeyChangeTarget {
  root?: string;
  scaleType?: string;
}
export interface KeyChangeOptions {
  /** Transpose-then-snap the progression. Off for content already built in the new key (a vibe). */
  harmonizeChords: boolean;
}

/**
 * The chord half of a key change. Transpose-then-snap is the only correct order
 * for a combined change: snapping first would measure the chords against a root
 * they are not yet in. Neither step changes a chord's `bars`, so the custom
 * lanes' boundaries do not move and need no re-clamp. Null when nothing changes.
 */
export function harmonizeChordsToKey(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
): ChordItem[] | null {
  if (chords.length === 0) return null;
  const rootChanged = from.root !== to.root;
  const scaleChanged = from.scaleType !== to.scaleType;
  if (!rootChanged && !scaleChanged) return null;
  let next = chords;
  if (rootChanged) next = transposeProgression(next, from.root, to.root);
  if (scaleChanged) next = snapProgressionToScale(next, to.root, to.scaleType);
  return next;
}

/**
 * The whole write a key change makes to one loop's content, pure, so the active
 * loop (setScaleRoot/setScaleType, a vibe) and any loop in loops[] (batch key
 * change) share it. Melodies: every MELODY_TRACKS row transposed by root under
 * the OLD type, then remapped by scale under the NEW root. Chords: harmonized
 * only when asked. Bass (chord-relative tokens), the pad drone (a scale
 * degree), drums and mix hold no absolute pitch and are never in the result.
 */
export function changeKey(
  content: KeyChangeSource,
  target: KeyChangeTarget,
  opts: KeyChangeOptions,
): Partial<LoopContent> {
  const root = target.root ?? content.scaleRoot;
  const type = target.scaleType ?? content.scaleType;
  const patch: Partial<LoopContent> = {};
  if (target.root !== undefined) patch.scaleRoot = root;
  if (target.scaleType !== undefined) patch.scaleType = type;
  for (const track of MELODY_TRACKS) {
    let steps = content[track.steps];
    if (root !== content.scaleRoot) steps = transposeLeadMelodyByRoot(steps, content.scaleRoot, root);
    if (type !== content.scaleType) steps = remapLeadMelodyByScale(steps, root, content.scaleType, type);
    patch[track.steps] = steps;
  }
  if (opts.harmonizeChords) {
    const chords = harmonizeChordsToKey(
      content.chords,
      { root: content.scaleRoot, scaleType: content.scaleType },
      { root, scaleType: type },
    );
    if (chords) patch.chords = chords;
  }
  return patch;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/store/keyChange.test.ts && bun run lint`
Expected: PASS. (`bun run eslint` may report `changeKey` unused until Task 4 — Knip is only run in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add src/store/keyChange.ts src/store/keyChange.test.ts
git commit -m "feat(store): add pure changeKey for melodies and chord harmonize (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Setters use `changeKey`; session-only toggle and indicator; vibes

**Files:**
- Modify: `src/store/types.ts` (`MusicContextSlice`)
- Modify: `src/store/musicContextSlice.ts` (delete `keyChangePatch`)
- Modify: `src/store/vibes.ts` (`putVibeContext`, the `keyChangePatch` import)
- Test: `src/store/musicContextSlice.test.ts`, `src/store/vibes.test.ts`, `src/store/store.test.ts`

**Interfaces:**
- Consumes: `changeKey` (Task 3).
- Produces on `MusicContextSlice`:

```ts
autoReharmonize: boolean;            // session-only, default true
reharmonizedIndicator: boolean;      // session-only, default false
setAutoReharmonize: (on: boolean) => void;       // OFF also clears the indicator
setReharmonizedIndicator: (on: boolean) => void;
```

- [ ] **Step 1: Write the failing tests.** In `musicContextSlice.test.ts` replace the `keyChangePatch` import with `import { changeKey } from './keyChange';` and re-point any `keyChangePatch(state, { scaleRoot, scaleType })` call at `changeKey(state, { root: scaleRoot, scaleType }, { harmonizeChords: false })`; also delete or re-point any source-scan assertion naming `keyChangePatch`. Then add:

```ts
import type { ChordItem } from '../types';

const PROG: ChordItem[] = [
  { id: 'c1', root: 'A', quality: 'min', bars: 1 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 1 },
];

describe('musicContextSlice — chords follow the key in the same write', () => {
  beforeEach(() => {
    useAppStore.setState({
      scaleRoot: 'A', scaleType: 'Natural Minor', chords: PROG,
      autoReharmonize: true, reharmonizedIndicator: false,
    });
  });

  test('toggle on: one notification carries key, chords, indicator and the loops[] mirror', () => {
    let notifications = 0;
    const stop = useAppStore.subscribe(() => { notifications += 1; });
    useAppStore.getState().setScaleRoot('C');
    stop();
    const s = useAppStore.getState();
    expect(notifications).toBe(1);
    expect(s.chords.map((c) => c.root)).toEqual(['C', 'G#']);
    expect(s.reharmonizedIndicator).toBe(true);
    expect(s.loops.find((l) => l.id === s.activeLoopId)!.chords).toBe(s.chords);
  });

  test('toggle off: chords untouched by reference, indicator stays false', () => {
    useAppStore.getState().setAutoReharmonize(false);
    useAppStore.getState().setScaleRoot('C');
    expect(useAppStore.getState().chords).toBe(PROG);
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
  });

  test('turning the toggle off clears the indicator; turning it on rewrites nothing', () => {
    useAppStore.getState().setScaleRoot('C');
    useAppStore.getState().setAutoReharmonize(false);
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
    const before = useAppStore.getState().chords;
    useAppStore.getState().setAutoReharmonize(true);
    expect(useAppStore.getState().chords).toBe(before);
  });

  test('root then type through the setters equals one combined changeKey', () => {
    const start = useAppStore.getState();
    const combined = changeKey(start, { root: 'C', scaleType: 'Major' }, { harmonizeChords: true });
    useAppStore.getState().setScaleRoot('C');
    useAppStore.getState().setScaleType('Major');
    expect(useAppStore.getState().chords).toEqual(combined.chords!);
  });
});
```

In `store.test.ts` add:

```ts
test('the reharmonize flags are session-only', () => {
  const persisted = partializeAppState(useAppStore.getState()) as Record<string, unknown>;
  expect('autoReharmonize' in persisted).toBe(false);
  expect('reharmonizedIndicator' in persisted).toBe(false);
});
```

(import `partializeAppState` from `./store` if the file does not already.) In `vibes.test.ts` add:

```ts
test('a vibe installs its own chords unharmonized and clears the reharmonized badge', () => {
  const vibe = RESOLVED_VIBES.find((v) => v.scaleRoot !== useAppStore.getState().scaleRoot)!;
  useAppStore.setState({ autoReharmonize: true, reharmonizedIndicator: true });
  applyVibeToStore(vibe);
  const s = useAppStore.getState();
  expect(s.chords.map((c) => `${c.root}${c.quality}`)).toEqual(vibe.chords.map((c) => `${c.root}${c.quality}`));
  expect(s.reharmonizedIndicator).toBe(false);
});
```

(If `ResolvedVibe`'s chord field is named differently, read `ResolvedVibe` in `src/store/vibes.ts` and use its name.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/store/musicContextSlice.test.ts src/store/vibes.test.ts src/store/store.test.ts`
Expected: FAIL — `setAutoReharmonize is not a function` / indicator undefined.

- [ ] **Step 3: Implement.** `types.ts` `MusicContextSlice` gains the four members above, each with a one-line doc ("session-only: never persisted, never in a project"). `musicContextSlice.ts`:

```ts
import type { StoreApi } from 'zustand';
import type { AppStore, MusicContextSlice } from './types';
import type { LoopContent } from './loop';
import { changeKey, type KeyChangeTarget } from './keyChange';

type Set = StoreApi<AppStore>['setState'];

/**
 * A Header key change: changeKey over the active (flat) content, harmonizing
 * chords iff the session toggle is on, in ONE set() — the loopSync mirror
 * carries it into loops[active]. The badge is raised only when the chords
 * actually changed.
 */
function keyChangeWrite(state: AppStore, target: KeyChangeTarget): Partial<AppStore> {
  const patch = changeKey(state, target, { harmonizeChords: state.autoReharmonize });
  return 'chords' in patch ? { ...patch, reharmonizedIndicator: true } : patch;
}

export function createMusicContextSlice(set: Set, defaults: LoopContent): MusicContextSlice {
  return {
    scaleRoot: defaults.scaleRoot,
    scaleType: defaults.scaleType,
    selectedVibeId: null,
    autoReharmonize: true,
    reharmonizedIndicator: false,

    setScaleRoot: (root) => set((state) => keyChangeWrite(state, { root })),
    setScaleType: (scaleType) => set((state) => keyChangeWrite(state, { scaleType })),
    setSelectedVibeId: (selectedVibeId) => set({ selectedVibeId }),
    // Turning it ON rewrites nothing: it applies to FUTURE key changes only.
    // The Re-harmonize button is the deliberate snap.
    setAutoReharmonize: (on) =>
      set(on ? { autoReharmonize: true } : { autoReharmonize: false, reharmonizedIndicator: false }),
    setReharmonizedIndicator: (on) => set({ reharmonizedIndicator: on }),
  };
}
```

Keep the slice docblock, updated to name `changeKey` instead of `keyChangePatch`. In `vibes.ts`:

```ts
import { changeKey } from './keyChange';
// …
  // Every melody track follows the key, root first then scale. The vibe's
  // chords are NOT harmonized: they were built in this key and are written by
  // the vibe's own chord step. The badge clears — those chords were replaced
  // wholesale, not harmonized.
  d.put(changeKey(d.state, { root: vibe.scaleRoot, scaleType: vibe.scaleType }, { harmonizeChords: false }));
  d.put({ reharmonizedIndicator: false });
```

- [ ] **Step 4: Run tests**

Run: `bun test src/store/musicContextSlice.test.ts src/store/vibes.test.ts src/store/vibes.atomic.test.ts src/store/store.test.ts src/store/keyChange.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store
git commit -m "feat(store): key setters harmonize chords via changeKey in one write (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Indicator clears on loop switch, project install and chord copy

**Files:**
- Create: `src/store/reharmonizeNav.ts`
- Modify: `src/App.tsx` (mount beside `useSoloNavClear()`)
- Modify: `src/store/loopCopySlice.ts` (active branch)
- Test: `src/store/reharmonizeNav.test.ts`, `src/store/loopCopySlice.test.ts`

**Interfaces:**
- Consumes: `reharmonizedIndicator`, `setReharmonizedIndicator` (Task 4); `createNavSignature` (`./navSignature`).
- Produces: `export function startReharmonizeNavClear(): () => void`, `export function useReharmonizeNavClear(): void`.

- [ ] **Step 1: Write the failing tests** — `src/store/reharmonizeNav.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { startReharmonizeNavClear } from './reharmonizeNav';

let stop: (() => void) | null = null;
let baseline: { activeLoopId: string; projectInstallCount: number; reharmonizedIndicator: boolean };

beforeEach(() => {
  const s = useAppStore.getState();
  baseline = {
    activeLoopId: s.activeLoopId,
    projectInstallCount: s.projectInstallCount,
    reharmonizedIndicator: s.reharmonizedIndicator,
  };
  stop = startReharmonizeNavClear();
});
afterEach(() => {
  stop?.();
  useAppStore.setState(baseline);
});

describe('reharmonizeNav', () => {
  test('an activeLoopId change clears the badge', () => {
    useAppStore.setState({ reharmonizedIndicator: true });
    useAppStore.setState({ activeLoopId: 'loop-elsewhere' });
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
  });

  test('a project install clears the badge even when the loop id collides', () => {
    useAppStore.setState({ reharmonizedIndicator: true });
    useAppStore.setState({ projectInstallCount: useAppStore.getState().projectInstallCount + 1 });
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
  });

  test('no write when the badge is already off', () => {
    useAppStore.setState({ reharmonizedIndicator: false });
    let writes = 0;
    const unsub = useAppStore.subscribe(() => { writes += 1; });
    useAppStore.setState({ activeLoopId: 'loop-elsewhere' });
    unsub();
    expect(writes).toBe(1); // the navigation itself, nothing more
  });
});
```

In `loopCopySlice.test.ts` add (reuse the file's `resetStore` baseline and fixtures; build a second loop `other` via `{ ...createDefaultLoop(), id: 'loop-src', scaleRoot: 'C', scaleType: 'Major' }` and put both in `loops`):

```ts
test('a key-only copy into the active loop moves the key and leaves chords and melodies alone', () => {
  const active = createDefaultLoop();
  const other = { ...createDefaultLoop(), id: 'loop-src', scaleRoot: 'C', scaleType: 'Major' };
  useAppStore.setState({ loops: [active, other], activeLoopId: active.id, ...loopStatePatch(active), autoReharmonize: true });
  const chordsBefore = useAppStore.getState().chords;
  const leadBefore = useAppStore.getState().leadMelodySteps;
  useAppStore.getState().applyLoopCopy(active.id, other.id, ['key']);
  const s = useAppStore.getState();
  expect(s.scaleRoot).toBe('C');
  expect(s.chords).toEqual(chordsBefore);
  expect(s.leadMelodySteps).toEqual(leadBefore);
});

test('a chord-progression copy into the active loop clears the reharmonized badge', () => {
  const active = createDefaultLoop();
  const other = { ...createDefaultLoop(), id: 'loop-src' };
  useAppStore.setState({ loops: [active, other], activeLoopId: active.id, ...loopStatePatch(active), reharmonizedIndicator: true });
  useAppStore.getState().applyLoopCopy(active.id, other.id, ['chord-progression']);
  expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/store/reharmonizeNav.test.ts src/store/loopCopySlice.test.ts`
Expected: FAIL — module not found; badge still true.

- [ ] **Step 3: Implement `src/store/reharmonizeNav.ts`**

```ts
import React from 'react';
import { shallow } from 'zustand/shallow';
import { useAppStore } from './store';
import type { AppStore } from './types';
import { createNavSignature } from './navSignature';

/**
 * The "Auto-Reharmonized" badge describes the ACTIVE loop's chords. When the
 * active loop changes (select, song advance, delete fallback, undo) or a
 * project is installed (loop ids collide across projects, so activeLoopId
 * alone cannot catch it), the chords on screen were replaced wholesale, not
 * harmonized — the badge clears. One subscription for every writer, the
 * soloNav.ts pattern. It replaces the chord view's old key-delta rule
 * (shouldClearReharmonizeIndicator), which needed a key delta only because an
 * effect could not see who replaced the chords.
 */
const REHARMONIZE_NAV_SOURCES = {
  activeLoopId: (state: AppStore) => state.activeLoopId,
  projectInstallCount: (state: AppStore) => state.projectInstallCount,
};

const { signature } = createNavSignature(REHARMONIZE_NAV_SOURCES);

export function startReharmonizeNavClear(): () => void {
  return useAppStore.subscribe(
    signature,
    () => {
      // Tested first: an unconditional write would re-serialise persist on
      // every loop change for a value that is almost always already false.
      if (useAppStore.getState().reharmonizedIndicator) {
        useAppStore.getState().setReharmonizedIndicator(false);
      }
    },
    { equalityFn: shallow },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useReharmonizeNavClear(): void {
  React.useEffect(() => startReharmonizeNavClear(), []);
}
```

In `App.tsx`, import it and call `useReharmonizeNavClear();` directly after `useVibeNavClear();` with a two-line comment ("The reharmonized badge describes the active loop's chords; it clears on a loop change or project install — see store/reharmonizeNav.ts."). In `loopCopySlice.ts`'s active branch replace `set({ loops });` with:

```ts
      // Chords copied in were replaced wholesale, not harmonized: the badge
      // must not claim otherwise. (A key-only copy moves the key and leaves
      // chords and melodies alone — R144.)
      set(
        selected.includes('chord-progression')
          ? { loops, reharmonizedIndicator: false }
          : { loops },
      );
```

- [ ] **Step 4: Run tests**

Run: `bun test src/store/reharmonizeNav.test.ts src/store/loopCopySlice.test.ts src/store/soloNav.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/reharmonizeNav.ts src/store/reharmonizeNav.test.ts src/store/loopCopySlice.ts src/store/loopCopySlice.test.ts src/App.tsx
git commit -m "feat(store): clear the reharmonized badge when chords are replaced wholesale (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Chord view reads the store; the effect is deleted

**Files:**
- Modify: `src/components/loop/chord/useChordView.ts` (`useProgressionHarmonize`, imports)
- Delete: `src/components/loop/chord/progressionHarmonize.ts`
- Modify: `src/components/loop/ChordView.tsx` (delete the `export { applyKeyScaleChange, shouldClearReharmonizeIndicator } …` line)
- Test: `src/components/loop/ChordView.test.tsx`, `src/components/loop/chord/useChordView.test.ts`

**Interfaces:**
- Consumes: `autoReharmonize`, `reharmonizedIndicator`, `setAutoReharmonize`, `setReharmonizedIndicator` (Task 4).
- Produces: `useProgressionHarmonize(state, saves)` keeps its return shape `{ autoReharmonize, isAutoReharmonizedIndicator, toggleAutoReharmonize, reharmonizeNow, clearReharmonizeBadge }` so `ChordView`, `ProgressionCard` and `ChordPresetLibrary` are unchanged.

- [ ] **Step 1: Write the failing test.** In `ChordView.test.tsx` delete the `import { applyKeyScaleChange, shouldClearReharmonizeIndicator } from './ChordView';` line and the two `describe('applyKeyScaleChange' …)` / `describe('shouldClearReharmonizeIndicator' …)` blocks together with their now-unused `chord`, `PROGRESSION`, `names`, `A_MINOR` helpers (their cases live in `src/store/keyChange.test.ts` since Task 3). Add a source-scan guard (the file already imports `readFileSync`):

```ts
describe('key change harmonize lives in the store', () => {
  test('the chord view no longer harmonizes in an effect', () => {
    const src = readFileSync(new URL('./chord/useChordView.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('applyKeyScaleChange');
    expect(src).not.toContain('useState<boolean>(true)');
    expect(src).toContain('s.autoReharmonize');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/ChordView.test.tsx`
Expected: FAIL — source still contains `applyKeyScaleChange`.

- [ ] **Step 3: Rewrite `useProgressionHarmonize`**:

```ts
/**
 * The progression's harmonize controls. The key change itself — melodies AND
 * chords — is one store write (`changeKey`, store/keyChange.ts); this hook only
 * reads the session toggle and badge and offers the two buttons.
 */
export function useProgressionHarmonize(state: ChordViewState, saves: ProgressionSaves) {
  const { chords, setChords, scaleRoot, scaleType } = state;
  const autoReharmonize = useAppStore((s) => s.autoReharmonize);
  const isAutoReharmonizedIndicator = useAppStore((s) => s.reharmonizedIndicator);
  const setAutoReharmonize = useAppStore((s) => s.setAutoReharmonize);
  const setReharmonizedIndicator = useAppStore((s) => s.setReharmonizedIndicator);

  // Turning this ON must not rewrite the current chords (a snap here would
  // reproduce the scramble this feature exists to remove); the store action
  // only flips the flag, and turning it OFF clears the badge.
  const toggleAutoReharmonize = () => setAutoReharmonize(!autoReharmonize);

  const reharmonizeNow = () => {
    const updated = snapProgressionToScale(chords, scaleRoot, scaleType);
    setChords(updated);
    setReharmonizedIndicator(true);
    saves.setSaveToast(
      `Re-harmonized progression to ${formatKeyLabel(scaleRoot, scaleType)} (Option B)!`,
    );
    setTimeout(() => saves.setSaveToast(null), 3000);
  };

  return {
    autoReharmonize,
    isAutoReharmonizedIndicator,
    toggleAutoReharmonize,
    reharmonizeNow,
    clearReharmonizeBadge: () => setReharmonizedIndicator(false),
  };
}
```

Remove the `applyKeyScaleChange`/`shouldClearReharmonizeIndicator` import and any React hook imports (`useRef`, `useState`, `useEffect`) that become unused. Delete `progressionHarmonize.ts` and the re-export line in `ChordView.tsx`.

- [ ] **Step 4: Run tests**

Run: `bun test src/components/loop/ChordView.test.tsx src/components/loop/chord/useChordView.test.ts src/components/loop/ChordPresetLibrary.test.tsx && bun run lint && bun run eslint`
Expected: PASS; eslint zero errors, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/loop
git commit -m "refactor(chord): read reharmonize state from the store, delete the harmonize effect (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: ADR-0032 and rules

**Files:**
- Create: `docs/decisions/0032-key-change-as-loop-content-operation.md`
- Modify: `docs/decisions/README.md` (index row)
- Modify: `.claude/rules/music-domain.md`, `.claude/rules/melody-tracks.md`, `.claude/rules/loops-and-solo.md`
- Modify: `docs/decisions/0013-melody-tracks-table-and-record-arm.md` (factual rename only: `keyChangePatch` → `changeKey` in `store/keyChange.ts`, if it names the symbol)
- Test: `bun test src/architecture` (any doc/rule-id guard tests that exist) — run `ls src/architecture` first

- [ ] **Step 1: Find the next free rule id.** Run `grep -rhoE "R[0-9]{3}" .claude/rules docs/decisions CLAUDE.md | sort -u | tail -1`. Call it `N`; use `N+1 … N+5` below (written here as R279–R283 assuming `N` = R278).

- [ ] **Step 2: Write ADR-0032** from the README template:
  - **Status:** Accepted — 2026-09-22. DEV-424 (epic DEV-433).
  - **Context:** melodies followed a key change in the store (`keyChangePatch`), chords in a chord-view effect gated by component-local state; a loop that is not active could not have its chords follow, which blocks batch key change (DEV-427); the effect also harmonized chords on a key-only loop copy into the active loop but not into another loop.
  - **Decision:** `LoopContent` bound to `LOOP_FLAT_KEYS`; `createDefaultLoopContent()` single default source; pure `changeKey(content, target, { harmonizeChords })` in `src/store/keyChange.ts`; setters apply it in one `set()`; `autoReharmonize`/`reharmonizedIndicator` session-only store fields; badge clears on wholesale replacement (vibe, loop switch, project install, library apply, chord copy) — the key-delta rule is gone. Rejected: keep the effect and add a second store path (two implementations of one rule); move the active loop into `loops[]` only (large churn, no user gain); persist the toggle (it was never persisted).
  - **Consequences:** key-only loop copy into the active loop no longer harmonizes chords (consistent with R144); a same-key vibe no longer leaves a stale badge; key + chords land in one write.
  - **Rules this implies:** R279–R283 (below).
  - **Sources:** spec `docs/superpowers/specs/2026-09-22-loop-content-and-batch-key-design.md`; this plan.

- [ ] **Step 3: Rules.**
  - `music-domain.md`: add `src/store/keyChange.ts`, `src/store/reharmonizeNav.ts`, `src/store/musicContextSlice.ts` to `paths`. New section "## Key change":
    - `- A key change's chord harmonize runs only in `changeKey` (`store/keyChange.ts`), transpose then snap; never in a component effect. <!-- R279 -->`
    - `- `autoReharmonize` and `reharmonizedIndicator` are session-only store fields (not in `partializeAppState`, `PROJECT_CONTENT_KEYS` or `LOOP_FLAT_KEYS`); turning the toggle on rewrites nothing. <!-- R280 -->`
    - `- The badge clears only where chords are replaced wholesale: a vibe's single write, `applyLoopCopy` with `chord-progression`, library apply, toggle off, and the `reharmonizeNav.ts` subscription (loop change, project install). <!-- R281 -->`
    - link `([ADR-0032](../../docs/decisions/0032-key-change-as-loop-content-operation.md))`; Prohibited: "Harmonizing chords on a key change outside `changeKey`", "Persisting the reharmonize toggle or badge", "A per-writer badge clear on loop change instead of `reharmonizeNav.ts`".
  - `melody-tracks.md` R143 → "`changeKey` (`store/keyChange.ts`) is the whole write for a root/scale change, transposing/remapping every `MELODY_TRACKS` row; a vibe folds it into its single `set()` with `harmonizeChords: false`." tagged ADR-0013 and ADR-0032; update its Prohibited line if it names `keyChangePatch`; add `src/store/keyChange.ts` to `paths`.
  - `loops-and-solo.md`: add `src/store/loop.ts`, `src/store/loopDefaults.ts`, `src/store/loopSync.ts`, `src/store/keyChange.ts` to `paths`; new section "## Loop content":
    - `- `LoopContent` (`store/loop.ts`) is `Pick<Loop, LoopFlatKey>`; a loop is slot identity (`id`, `name`, `tempName`, `repeatCount`) plus content, and `loop.test.ts` fails to compile if a `Loop` field is neither. <!-- R282 -->`
    - `- `createDefaultLoopContent()` (`store/loopDefaults.ts`) is the only place a per-loop default is written; slices read it through their `defaults` parameter. <!-- R283 -->`
    - Prohibited: "A per-loop default literal in a slice", "A `Loop` field outside identity and `LOOP_FLAT_KEYS`".
  - `docs/decisions/README.md`: add the 0032 index row.

- [ ] **Step 4: Run guards**

Run: `ls src/architecture && bun test src/architecture`
Expected: PASS (if a rule-id/ADR guard exists it validates the new ids and links).

- [ ] **Step 5: Commit**

```bash
git add docs/decisions .claude/rules
git commit -m "docs: ADR-0032 key change as a loop-content operation, rules R279-R283 (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Adjust the R-range in the message to the ids actually used.)

---

### Task 8: CLAUDE.md, skill and architecture docs

**Files:**
- Modify: `CLAUDE.md` (rules table "Covers" cells only)
- Modify: `.claude/skills/music-theory/SKILL.md` (the `applyKeyScaleChange` / `autoReharmonize` paragraphs)
- Modify: `docs/architecture/structure/02-store.md`, `docs/architecture/structure/README.md` (S7), `docs/architecture/structure/01-ui.md` (ChordView re-export line), `docs/design.md` (chord-view paragraph only if it names the effect), `docs/architecture/feature-overview.md` (only if it describes auto-reharmonize)

- [ ] **Step 1: Find every stale mention**

Run: `grep -rn "keyChangePatch\|applyKeyScaleChange\|shouldClearReharmonizeIndicator\|LoopStatePatch\|progressionHarmonize" CLAUDE.md .claude docs/architecture docs/design.md src`
Expected: hits only in the docs listed above (none in `src`).

- [ ] **Step 2: Edit.**
  - `CLAUDE.md` rules table: `loops-and-solo.md` → "Loop content and defaults, atomic loop delete + undo, session-only solo, audibility"; `music-domain.md` → append ", key change".
  - `SKILL.md`: replace the effect description with: key change is `changeKey` (`src/store/keyChange.ts`) — melodies always follow; chords transpose (root) then snap (type) when the session toggle `autoReharmonize` is on; a vibe passes `harmonizeChords: false`; `harmonizeChordsToKey` is the chord half.
  - `02-store.md`: key-list paragraph — `LoopContent` is now bound to `LOOP_FLAT_KEYS` at compile time (drop the "not tied at compile time" sentence); schema-duplication item: slice defaults now come from `createDefaultLoopContent()`; add `keyChange.ts` and `reharmonizeNav.ts` where store modules are listed.
  - `structure/README.md` S7 line → append "**Fixed on `refactor/dev-424-loop-content`:** `LoopContent` is bound to `LOOP_FLAT_KEYS` and slice defaults read `createDefaultLoopContent()`; `sanitizeLoops` still validates field by field on purpose and `LOOP_COPY_GROUPS` stays a test-pinned partition."
  - `01-ui.md`: remove the ChordView re-export bullet; note that `useProgressionHarmonize` reads the store.
  - No version numbers, file counts or line numbers.

- [ ] **Step 3: Re-run the grep from Step 1**

Expected: no hits except historical specs/plans under `docs/superpowers/` (leave those).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .claude/skills docs
git commit -m "docs: sync loop content and key change docs, mark S7 (DEV-424)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Completion gate

- [ ] **Step 1: Run the gate**

Run: `bun run verify`
Expected: all tests, static/domain checks, both Knip scans (zero findings) and the build pass.

- [ ] **Step 2: Run ESLint**

Run: `bun run eslint`
Expected: zero errors and zero warnings. Any warning: open the code and fix it, or add a line-level `eslint-disable-next-line <rule> -- <reason>` naming why the site is a legitimate exception (R264). Never relax a rule globally.

- [ ] **Step 3: Fix anything found, re-run both, then commit the fixes**

```bash
git add -A
git commit -m "chore: satisfy the verify gate for DEV-424

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Skip the commit when nothing changed.) Do not push.
