# Vibe Effects from a Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the six Instant Vibes' inline `effects` blocks into a new effect-chain library keyed by id and add `effectChainId` to `InstantVibe`, without changing the sound by a single bit.

**Architecture:** This is phase 4 (the last) of the "Vibe as References" spec and a pure refactor. A new zero-runtime-import module `src/audio/data/vibeEffectChains.ts` holds the six authored effect blocks keyed by a library id, plus an `effectChainById(id)` resolver that returns a **fresh shallow copy** on every call. `src/store/instantVibes.ts` then stops inlining the blocks: each vibe declares `effectChainId: 'x'` and sets `effects: effectChainById('x')!`, exactly mirroring how phase 1 left `progressionId` beside a `resolveProgression(...)`-built `chords`, and phase 3 left `drumPatternId` beside a `drumPatternById(...)`-built `drumPattern`. A before-snapshot fixture (`ORIGINAL_VIBE_EFFECTS`), landed one task *before* the migration, is what proves the sound is byte-identical afterwards.

**Tech Stack:** TypeScript, Bun (`bun test`), Vite + React 18, Zustand store, raw Web Audio API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-vibe-as-references-design.md` (phase 4 of the "Four phases" section; the "Effect chains — 6 entries, one per vibe" paragraph in "Settled decisions"; "Invariants to enforce with tests" items 1 and 4)

## Settled decisions — do not re-open

These are settled by the brief for this phase. Do not offer alternatives while executing.

1. **Resolve in the vibe literal, not at apply time.** The spec sketches changing
   `applyInstantVibeToStore`'s `store.setEffects({ ...store.effects, ...vibe.effects })`
   into `...resolveEffectChain(vibe.effectChainId)`. **Do not do that.** Phases 1 and 3
   both resolved in the literal instead (`chords: resolveProgression(...)`,
   `drumPattern: drumPatternById('x')!`), leaving `applyInstantVibeToStore` untouched.
   This phase does the same: `effectChainId: 'x', effects: effectChainById('x')!`.
   Rationale: that function's `hardStopAll` -> `stopSource('chord', 0.02)` /
   `stopSource('bass', 0.02)` ordering carries two real overlapping-audio bug fixes
   (`d8df714`, `c4a253a`) and is pinned by non-regression tests; leaving it
   byte-identical keeps the refactor trivially provable and consistent with the two
   phases before it.
2. **`InstantVibe` keeps BOTH `effects` and the new `effectChainId`**, exactly as it
   already keeps `chords`/`progressionId` and `drumPattern`/`drumPatternId`.
3. **Effect chains stay `Partial<MasterEffects>`.** `InstantVibe.effects` is declared
   `Partial<MasterEffects>` at `src/types.ts:207`, and only 2 of 6 vibes set
   `distortionWet` while `MasterEffects.distortionWet` is a required field. The
   library's value type must be `Partial<MasterEffects>` and the four vibes that
   omit `distortionWet` must keep omitting it — `applyInstantVibeToStore` spreads over
   `store.effects`, so an omitted key means "inherit", and adding it would be a sound
   change.
4. **`effectChainById` returns a fresh copy.** A shallow copy is sufficient and
   correct here — every value in a chain is a scalar, so there is no nested structure
   to alias. Do NOT claim a deep copy or invent a mechanism about references reaching
   the store; a phase 3 doc comment over-claimed exactly that and had to be corrected
   in a follow-up commit.

## Global Constraints

- `src/types.ts` is a zero-import leaf — it must stay that way.
- Three layers enforced by eslint `no-restricted-imports`: `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/store/` → `src/audio/` **is** allowed. `src/components/` must not import `audio/engine`.
- Tests are pure-logic `bun:test`. No DOM, no testing-library — none may be added.
- `@typescript-eslint/no-unused-vars` is an **error**, not a warning.
- `toMatchObject` is not in bun:test's TypeScript types — `bun run lint` fails on it. Do not use it.
- The test command is `bun test` (a Bun builtin). There is **no `test` script** in package.json, so `bun run test` fails with "Script not found".
- Gate at the end of each task: `bun run verify` (test + lint + check:keys + check:drums + build), plus `bun run eslint` run **separately** — it is NOT part of `verify`. eslint baseline is **6 problems (0 errors, 6 warnings)**; do not add a seventh.
- Do not touch: `applyInstantVibeToStore`'s body, `src/store/vibeVariation.ts`, `src/audio/data/genrePresets.ts`, `src/audio/data/vibeDrumPatterns.ts`, any `variation` data, any `soundKit`, any `drumPattern`/`drumPatternId`.

## File Structure

- **Create** `src/audio/data/vibeEffectChains.ts` — the library: `VIBE_EFFECT_CHAINS: Record<string, Partial<MasterEffects>>` plus `effectChainById(id): Partial<MasterEffects> | undefined`. Imports **only** the `MasterEffects` type from `../../types` (`import type`), so `src/types.ts` stays a zero-import leaf and the eslint `audio/` -> `store/`/`components/` ban cannot be violated.
- **Create** `src/audio/data/vibeEffectChains.test.ts` — shape invariants for the library itself (6 ids, resolver behaviour, common-key coverage, exact `distortionWet` membership).
- **Create** `src/store/instantVibesEffectsFixture.ts` — `ORIGINAL_VIBE_EFFECTS`, a verbatim before-snapshot of what each vibe ships today, keyed by **vibe id**. Imports nothing except the `MasterEffects` type.
- **Create** `src/store/instantVibesEffects.test.ts` — first pins the fixture against today's `INSTANT_VIBES` (task 1), then pins the migrated vibes against the fixture (task 2).
- **Modify** `src/types.ts` — add `effectChainId: string` beside the existing `effects` field on `InstantVibe`, with a doc comment matching the style of the existing `progressionId` / `drumPatternId` comments.
- **Modify** `src/store/instantVibes.ts:162-171, 230-240, 301-311, 369-378, 436-445, 509-518` — replace the six inline `effects: { ... }` blocks with `effectChainId` + an `effectChainById(...)` call, and add the import.

## The six chain ids

| vibe id | chain id |
|---|---|
| `lofi-chill` | `lofi-tape-room` |
| `synthwave-80s` | `synthwave-neon-hall` |
| `cyber-dance` | `edm-club-drive` |
| `ambient-chill` | `ambient-cathedral-wash` |
| `hiphop-groove` | `boombap-dry-room` |
| `asian-zen` | `zen-temple-air` |

## Existing tests checked for this phase

- `src/store/instantVibes.test.ts:48` — `expect(Boolean(vibe.effects)).toBe(true)`.
  **Stays untouched.** `InstantVibe.effects` still exists (decision 2 above) and is
  still populated for every vibe by the migrated code, so this assertion keeps
  passing with no edit.
- `src/store/instantVibes.test.ts:182-242` (`applyInstantVibeToStore transport
  handling`, the `hardStopAll` / `setBpm` / `setEffects` / `play` ordering tests).
  **Stay untouched.** They spy on `useAppStore.getState().setEffects` and assert call
  *order*, not the value passed to it; `applyInstantVibeToStore`'s body is not
  modified by this plan (decision 1 above), so the sequence these tests pin does not
  change.

---

### Task 1: The effect-chain library and the before-snapshot

**Files:**
- Create: `src/audio/data/vibeEffectChains.ts`
- Test: `src/audio/data/vibeEffectChains.test.ts`
- Create: `src/store/instantVibesEffectsFixture.ts`
- Test: `src/store/instantVibesEffects.test.ts`

**Interfaces:**
- Consumes: `MasterEffects` (type only) from `../../types` (library) and `../types`
  (fixture); `INSTANT_VIBES` from `./instantVibes` (fixture test only — the fixture
  module itself imports nothing except the type).
- Produces:
  - `export const VIBE_EFFECT_CHAINS: Record<string, Partial<MasterEffects>>` —
    exactly 6 keys: `lofi-tape-room`, `synthwave-neon-hall`, `edm-club-drive`,
    `ambient-cathedral-wash`, `boombap-dry-room`, `zen-temple-air`.
  - `export function effectChainById(id: string): Partial<MasterEffects> | undefined`
    — returns a fresh shallow copy on every call, `undefined` for an unknown id.
  - `export const ORIGINAL_VIBE_EFFECTS: Record<string, Partial<MasterEffects>>` —
    keyed by vibe id (`lofi-chill`, `synthwave-80s`, `cyber-dance`, `ambient-chill`,
    `hiphop-groove`, `asian-zen`), each value the vibe's effects block as shipped
    today, captured before task 2's migration.

Nothing is wired up in this task — `instantVibes.ts` is not touched, so nothing can
change behaviour yet. Both new modules stand independently; task 2 is what proves
they reproduce today's sound.

- [ ] **Step 1: Write the failing test file for the library**

Create `src/audio/data/vibeEffectChains.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { VIBE_EFFECT_CHAINS, effectChainById } from './vibeEffectChains';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/data/vibeEffectChains.test.ts`
Expected: FAIL — the module `./vibeEffectChains` does not resolve.

- [ ] **Step 3: Create the library module with the six chains**

Create `src/audio/data/vibeEffectChains.ts`. The values are copied verbatim from the
six inline blocks in `src/store/instantVibes.ts` — do not retype or "tidy" a single
number, and preserve each vibe's exact key order and its omission of
`distortionWet` where applicable:

```ts
// The vibe effect-chain library: the six Instant Vibes' authored master-effects
// blocks, keyed by a library id, so a vibe references a mix instead of inlining
// one — the same reference-and-resolve shape CHORD_PROGRESSIONS already gives a
// vibe's chords and VIBE_DRUM_PATTERNS gives a vibe's rhythm.
//
// Library ids here are internal: projects persist the resolved effects object,
// not the id, so these ids are safe to rename (unlike Instant Vibe preset ids).
//
// Every chain is a Partial<MasterEffects> by design, not oversight: only
// synthwave-neon-hall and edm-club-drive carry distortionWet. applyInstantVibeToStore
// spreads a resolved chain over the current store.effects
// (`{ ...store.effects, ...vibe.effects }`), so an omitted key means "inherit
// the current value" — adding distortionWet to a chain that omits it today would be
// a sound change, which this refactor forbids.
//
// Layering: this file lives under src/audio/ and imports only the MasterEffects
// type (type-only, erased at compile time), so the eslint ban on audio/ -> store/
// and audio/ -> components/ cannot be violated here. src/store/ may read it; that
// direction is allowed.

import type { MasterEffects } from '../../types';

export const VIBE_EFFECT_CHAINS: Record<string, Partial<MasterEffects>> = {
  'lofi-tape-room': {
    reverbWet: 0.35,
    reverbDecay: 2.4,
    delayWet: 0.22,
    delayFeedback: 0.28,
    compressorThreshold: -18,
    eqLow: 3,
    eqMid: 1,
    eqHigh: -2,
  },
  'synthwave-neon-hall': {
    reverbWet: 0.48,
    reverbDecay: 3.6,
    delayWet: 0.28,
    delayFeedback: 0.35,
    distortionWet: 0.18,
    compressorThreshold: -15,
    eqLow: 2,
    eqMid: 1,
    eqHigh: 4,
  },
  'edm-club-drive': {
    reverbWet: 0.36,
    reverbDecay: 2.8,
    delayWet: 0.32,
    delayFeedback: 0.42,
    distortionWet: 0.22,
    compressorThreshold: -14,
    eqLow: 3,
    eqMid: 0,
    eqHigh: 4,
  },
  'ambient-cathedral-wash': {
    reverbWet: 0.68,
    reverbDecay: 5.8,
    delayWet: 0.48,
    delayFeedback: 0.58,
    compressorThreshold: -20,
    eqLow: 2,
    eqMid: -1,
    eqHigh: 2,
  },
  'boombap-dry-room': {
    reverbWet: 0.30,
    reverbDecay: 2.0,
    delayWet: 0.20,
    delayFeedback: 0.22,
    compressorThreshold: -16,
    eqLow: 3,
    eqMid: 1,
    eqHigh: 0,
  },
  'zen-temple-air': {
    reverbWet: 0.58,
    reverbDecay: 4.4,
    delayWet: 0.42,
    delayFeedback: 0.46,
    compressorThreshold: -18,
    eqLow: 1,
    eqMid: 0,
    eqHigh: 3,
  },
};

/**
 * Look up an authored effect chain by library id.
 *
 * Returns a FRESH shallow copy on every call — never the module's own object.
 * A shallow copy is sufficient and correct here: every value in a chain is a
 * scalar (number), so there is no nested structure for a copy to alias.
 * `resolveProgression` and `drumPatternById`, the phase 1 and phase 3
 * precedents, also return freshly built objects every call.
 */
export function effectChainById(id: string): Partial<MasterEffects> | undefined {
  const chain = VIBE_EFFECT_CHAINS[id];
  if (!chain) return undefined;
  return { ...chain };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/data/vibeEffectChains.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Write the failing test file for the fixture**

Create `src/store/instantVibesEffects.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_EFFECTS } from './instantVibesEffectsFixture';

const VIBE_IDS = ['lofi-chill', 'synthwave-80s', 'cyber-dance', 'ambient-chill', 'hiphop-groove', 'asian-zen'];

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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `bun test src/store/instantVibesEffects.test.ts`
Expected: FAIL — the module `./instantVibesEffectsFixture` does not resolve.

- [ ] **Step 7: Create the fixture**

Create `src/store/instantVibesEffectsFixture.ts`:

```ts
/**
 * A verbatim snapshot of every Instant Vibe's `effects` block, captured
 * before task 2 of the vibe-effects-from-library plan replaced each vibe's
 * inline block with `effectChainId` + `effectChainById`. Deliberately
 * duplicates the number literals that used to live in `instantVibes.ts` and
 * imports nothing from that file — or from the new library — so this fixture
 * cannot silently track a later change to the data it is meant to be checked
 * against. It is a snapshot, not a re-derivation, and that independence is
 * the whole proof.
 *
 * Keyed by vibe id, not by library chain id: the point of comparison is
 * "what this vibe sounded like before", so the library's own naming must not
 * leak in here.
 */
import type { MasterEffects } from '../types';

export const ORIGINAL_VIBE_EFFECTS: Record<string, Partial<MasterEffects>> = {
  'lofi-chill': {
    reverbWet: 0.35,
    reverbDecay: 2.4,
    delayWet: 0.22,
    delayFeedback: 0.28,
    compressorThreshold: -18,
    eqLow: 3,
    eqMid: 1,
    eqHigh: -2,
  },
  'synthwave-80s': {
    reverbWet: 0.48,
    reverbDecay: 3.6,
    delayWet: 0.28,
    delayFeedback: 0.35,
    distortionWet: 0.18,
    compressorThreshold: -15,
    eqLow: 2,
    eqMid: 1,
    eqHigh: 4,
  },
  'cyber-dance': {
    reverbWet: 0.36,
    reverbDecay: 2.8,
    delayWet: 0.32,
    delayFeedback: 0.42,
    distortionWet: 0.22,
    compressorThreshold: -14,
    eqLow: 3,
    eqMid: 0,
    eqHigh: 4,
  },
  'ambient-chill': {
    reverbWet: 0.68,
    reverbDecay: 5.8,
    delayWet: 0.48,
    delayFeedback: 0.58,
    compressorThreshold: -20,
    eqLow: 2,
    eqMid: -1,
    eqHigh: 2,
  },
  'hiphop-groove': {
    reverbWet: 0.30,
    reverbDecay: 2.0,
    delayWet: 0.20,
    delayFeedback: 0.22,
    compressorThreshold: -16,
    eqLow: 3,
    eqMid: 1,
    eqHigh: 0,
  },
  'asian-zen': {
    reverbWet: 0.58,
    reverbDecay: 4.4,
    delayWet: 0.42,
    delayFeedback: 0.46,
    compressorThreshold: -18,
    eqLow: 1,
    eqMid: 0,
    eqHigh: 3,
  },
};
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test src/store/instantVibesEffects.test.ts`
Expected: PASS — 4 tests, 0 failures. A failure here means a transcription error in
the fixture; fix the fixture, never the vibes.

- [ ] **Step 9: Run the type-checker and the full suite**

Run: `bun test && bun run lint`
Expected: whole suite green, `tsc --noEmit` silent.

- [ ] **Step 10: Run the full gate and eslint separately**

Run: `bun run verify && bun run eslint`
Expected: `verify` green; eslint reports exactly **6 problems (0 errors, 6 warnings)** — the pre-existing complexity baseline, unchanged.

- [ ] **Step 11: Commit**

```bash
git add src/audio/data/vibeEffectChains.ts src/audio/data/vibeEffectChains.test.ts src/store/instantVibesEffectsFixture.ts src/store/instantVibesEffects.test.ts
git commit -m "feat(vibes): add the vibe effect-chain library keyed by id"
```

---

### Task 2: Migrate the vibes onto `effectChainId`

**Files:**
- Modify: `src/types.ts` (the `InstantVibe` interface, at the `effects` field)
- Modify: `src/store/instantVibes.ts:162-171, 230-240, 301-311, 369-378, 436-445, 509-518` (plus the import block at the top)
- Test: `src/store/instantVibesEffects.test.ts` (extend the file created in task 1)

**Interfaces:**
- Consumes: `effectChainById` from `../audio/data/vibeEffectChains` (task 1); `ORIGINAL_VIBE_EFFECTS` from `./instantVibesEffectsFixture` (task 1).
- Produces: `InstantVibe.effectChainId: string` — a library reference into `VIBE_EFFECT_CHAINS`; `effects` stays and is its resolved output, exactly as `chords` is `progressionId`'s and `drumPattern` is `drumPatternId`'s.

**Import direction:** `src/store/instantVibes.ts` must import `effectChainById` from
`../audio/data/vibeEffectChains`. `store/` → `audio/` **is** an allowed direction
under the eslint `no-restricted-imports` layering rule and that file already does it
three times (`../audio/engine`, `../audio/data/chordProgressions`,
`../audio/data/vibeDrumPatterns`).

The task-1 fixture tests (steps 5-8 above) must keep passing untouched — that is the
non-regression proof for this task.

- [ ] **Step 1: Write the failing migration tests**

Add `effectChainById` to `src/store/instantVibesEffects.test.ts`'s imports so the top
of the file reads:

```ts
import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_EFFECTS } from './instantVibesEffectsFixture';
import { effectChainById } from '../audio/data/vibeEffectChains';
```

Then append these two describe blocks at the end of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/instantVibesEffects.test.ts`
Expected: FAIL — `effectChainId` does not exist on `InstantVibe`, so the resolution tests fail (and `bun run lint` would report `Property 'effectChainId' does not exist`).

- [ ] **Step 3: Add `effectChainId` to the `InstantVibe` interface**

In `src/types.ts`, in the `// Master Effects` block of `interface InstantVibe`,
replace:

```ts
  // Master Effects
  effects: Partial<MasterEffects>;
```

with:

```ts
  // Master Effects
  effects: Partial<MasterEffects>;
  /** Library reference into VIBE_EFFECT_CHAINS. `effects` is its resolved output. */
  effectChainId: string;
```

`src/types.ts` stays a zero-import leaf — this adds no import.

- [ ] **Step 4: Import the resolver in `instantVibes.ts`**

In `src/store/instantVibes.ts`, below the existing `vibeDrumPatterns` import, add:

```ts
import { effectChainById } from '../audio/data/vibeEffectChains';
```

- [ ] **Step 5: Replace the `lofi-chill` inline block**

In `src/store/instantVibes.ts` (currently lines 162-171), replace:

```ts
    effects: {
      reverbWet: 0.35,
      reverbDecay: 2.4,
      delayWet: 0.22,
      delayFeedback: 0.28,
      compressorThreshold: -18,
      eqLow: 3,
      eqMid: 1,
      eqHigh: -2,
    },
```

with:

```ts
    effectChainId: 'lofi-tape-room',
    effects: effectChainById('lofi-tape-room')!,
```

- [ ] **Step 6: Replace the `synthwave-80s` inline block**

Replace:

```ts
    effects: {
      reverbWet: 0.48,
      reverbDecay: 3.6,
      delayWet: 0.28,
      delayFeedback: 0.35,
      distortionWet: 0.18,
      compressorThreshold: -15,
      eqLow: 2,
      eqMid: 1,
      eqHigh: 4,
    },
```

with:

```ts
    effectChainId: 'synthwave-neon-hall',
    effects: effectChainById('synthwave-neon-hall')!,
```

- [ ] **Step 7: Replace the `cyber-dance` inline block**

Replace:

```ts
    effects: {
      reverbWet: 0.36,
      reverbDecay: 2.8,
      delayWet: 0.32,
      delayFeedback: 0.42,
      distortionWet: 0.22,
      compressorThreshold: -14,
      eqLow: 3,
      eqMid: 0,
      eqHigh: 4,
    },
```

with:

```ts
    effectChainId: 'edm-club-drive',
    effects: effectChainById('edm-club-drive')!,
```

- [ ] **Step 8: Replace the `ambient-chill` inline block**

Replace:

```ts
    effects: {
      reverbWet: 0.68,
      reverbDecay: 5.8,
      delayWet: 0.48,
      delayFeedback: 0.58,
      compressorThreshold: -20,
      eqLow: 2,
      eqMid: -1,
      eqHigh: 2,
    },
```

with:

```ts
    effectChainId: 'ambient-cathedral-wash',
    effects: effectChainById('ambient-cathedral-wash')!,
```

- [ ] **Step 9: Replace the `hiphop-groove` inline block**

Replace:

```ts
    effects: {
      reverbWet: 0.30,
      reverbDecay: 2.0,
      delayWet: 0.20,
      delayFeedback: 0.22,
      compressorThreshold: -16,
      eqLow: 3,
      eqMid: 1,
      eqHigh: 0,
    },
```

with:

```ts
    effectChainId: 'boombap-dry-room',
    effects: effectChainById('boombap-dry-room')!,
```

- [ ] **Step 10: Replace the `asian-zen` inline block**

Replace:

```ts
    effects: {
      reverbWet: 0.58,
      reverbDecay: 4.4,
      delayWet: 0.42,
      delayFeedback: 0.46,
      compressorThreshold: -18,
      eqLow: 1,
      eqMid: 0,
      eqHigh: 3,
    },
```

with:

```ts
    effectChainId: 'zen-temple-air',
    effects: effectChainById('zen-temple-air')!,
```

- [ ] **Step 11: Confirm no inline effects blocks remain**

Run: `grep -c "reverbWet:" src/store/instantVibes.ts`
Expected: `0`.

- [ ] **Step 12: Run the migration tests to verify they pass**

Run: `bun test src/store/instantVibesEffects.test.ts`
Expected: PASS — 8 tests, 0 failures. The fixture tests from task 1 still pass unchanged, which is the byte-for-byte non-regression proof.

- [ ] **Step 13: Run the whole suite and the type-checker**

Run: `bun test && bun run lint`
Expected: everything green — in particular `instantVibes.test.ts` (including the
`effects` truthiness check at line 48 and the `setEffects`-ordering tests at
182-242), `vibeVariation.test.ts`, `instantVibesProgressions.test.ts` and
`instantVibesDrums.test.ts` pass untouched, and `tsc --noEmit` is silent (no
leftover unused import; `@typescript-eslint/no-unused-vars` is an error).

- [ ] **Step 14: Run the full gate and eslint separately**

Run: `bun run verify && bun run eslint`
Expected: `verify` green; eslint reports exactly **6 problems (0 errors, 6 warnings)** — the pre-existing complexity baseline, no seventh.

- [ ] **Step 15: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/instantVibesEffects.test.ts
git commit -m "refactor(vibes): resolve every vibe's effect chain from a library id"
```

---

## Done when

- `src/store/instantVibes.ts` contains no inline effects numbers; each of the six vibes carries an `effectChainId` and an `effectChainById(...)`-resolved `effects`.
- `bun run verify` is green and `bun run eslint` reports exactly 6 warnings, 0 errors.
- `ORIGINAL_VIBE_EFFECTS` still equals every vibe's live `effects`, so no vibe's mix changed by a single number.
- `applyInstantVibeToStore`, `src/store/vibeVariation.ts`, `src/audio/data/genrePresets.ts`, `src/audio/data/vibeDrumPatterns.ts`, all `variation` data and every `soundKit`/`drumPattern` are byte-identical to their state before this plan.
- This closes phase 4, the last of the "Vibe as References" spec's four phases.
