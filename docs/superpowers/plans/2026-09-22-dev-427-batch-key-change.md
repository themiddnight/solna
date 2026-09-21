# DEV-427 Batch Key Change from Arrange — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Change key…" dialog on Arrange that sets or transposes the key of several loops at once (melodies follow, chords optionally harmonized), in one store write, with a single-level Undo toast.

**Architecture:** A pure `changeKeyAcrossLoops` (`src/store/loopKeyChange.ts`) maps PR 1's `changeKey` over the selected loops and returns the pre-change key fields as an undo snapshot. Two store actions (`src/store/loopKeyChangeSlice.ts`) write it in ONE `set()`: non-active loops in `loops[]`, the active loop through its flat fields (the `loopSync` mirror keeps `loops[active]` equal). The UI is a dialog with a colocated hook, plus an undo hook mirroring `useLoopDeleteUndo`.

**Tech Stack:** TypeScript, React, zustand, daisyUI v5, Bun test runner (`bun:test`, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-22-loop-content-and-batch-key-design.md` (PR 2 sections §2.1–§2.7; §0 F11 for the boundary reasoning).

## Global Constraints

- Branch: `feat/dev-427-batch-key-change`, created from the tip of `refactor/dev-424-loop-content` **after the DEV-424 plan is complete**. Never push.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Roots are `ROOTS`-spelled in every stored/computed value; `KEY_OPTIONS`/`formatKeyLabel` spell for display only (R064–R066).
- The undo snapshot is session-only (never persisted, never in a project); single level; loops deleted in between are skipped; a project install dismisses it (loop ids collide across projects).
- The active loop is updated through its flat fields in the same `set()` — never `crossLoopSeam`, never `loadLoop`.
- Components: logic in a colocated `useXxx` hook with a named exported return type; layout-only component; children above root; one value per `useAppStore` selector (R265–R275). No DOM/testing-library; render tests use `renderToString` with props (R257).
- daisyUI classes used (verified against the daisyUI v5 docs): `join`, `join-item`, `btn`, `btn-sm`, `btn-ghost`, `btn-primary`, `checkbox`, `checkbox-sm`, `checkbox-primary`, `select`, `select-sm`, `fieldset`, `fieldset-legend`, `label`, `modal-action`, `toast`, `toast-bottom`, `toast-center`, `alert`, `alert-info`, `alert-soft`.
- No version numbers, file counts or line numbers in docs (R001).
- Gate: `bun run verify` passes; `bun run eslint` prints zero errors AND zero warnings; both Knip scans zero findings.
- Rule ids: next free `R###` after the ones DEV-424 used (re-check with `grep -rhoE "R[0-9]{3}" .claude/rules docs/decisions CLAUDE.md | sort -u | tail -1`). New ADR number: 0033.

## Interfaces from PR 1 (already on the branch)

```ts
// src/store/loop.ts
export type LoopContent = Pick<Loop, LoopFlatKey>;
// src/store/keyChange.ts
export interface KeyChangeOptions { harmonizeChords: boolean }
export interface KeyChangeTarget { root?: string; scaleType?: string }
export function changeKey(content: KeyChangeSource, target: KeyChangeTarget, opts: KeyChangeOptions): Partial<LoopContent>;
// MusicContextSlice
reharmonizedIndicator: boolean;
```

## File map

| File | Change |
|---|---|
| `src/store/loopKeyChange.ts` | **new** — `BatchKeyTarget`, `transposeRoot`, `targetKeyFor`, `changeKeyAcrossLoops`, snapshot types |
| `src/store/loopKeyChangeSlice.ts` | **new** — `applyLoopKeyChange`, `undoLoopKeyChange` |
| `src/store/types.ts` | `LoopSlice` gains the two actions |
| `src/store/loopSlice.ts` | `createLoopSlice` return type omits the two new actions |
| `src/store/store.ts` | spread `createLoopKeyChangeSlice` |
| `src/components/song/useKeyChangeDialog.ts` | **new** — dialog state + pure preview helpers |
| `src/components/song/KeyChangeDialog.tsx` | **new** — layout |
| `src/components/song/useLoopKeyChangeUndo.ts` | **new** — open/apply/undo/toast |
| `src/components/song/LoopUndoToast.tsx` | alert only, `{ message, buttonId, onUndo }` |
| `src/components/song/ArrangeView.tsx` | header button, dialog mount, shared toast container |
| docs | ADR-0033, rules, CLAUDE.md, architecture (Task 7) |

---

### Task 1: Pure batch operation

**Branch:** create it now — `git checkout refactor/dev-424-loop-content && git checkout -b feat/dev-427-batch-key-change`. Confirm DEV-424's `src/store/keyChange.ts` exists.

**Files:**
- Create: `src/store/loopKeyChange.ts`
- Test: `src/store/loopKeyChange.test.ts`

**Interfaces:**
- Produces:

```ts
export type BatchKeyTarget =
  | { mode: 'set'; root: string; scaleType: string }
  | { mode: 'transpose'; semitones: number };
export type KeyChangeField = 'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps';
export interface LoopKeySnapshot { loopId: string; content: Pick<LoopContent, KeyChangeField> }
export function transposeRoot(root: string, semitones: number): string | null;
export function targetKeyFor(loop: Pick<Loop, 'scaleRoot' | 'scaleType'>, target: BatchKeyTarget): { root: string; scaleType: string } | null;
export function changeKeyAcrossLoops(loops: readonly Loop[], ids: readonly string[], target: BatchKeyTarget, opts: KeyChangeOptions): { loops: Loop[]; changed: LoopKeySnapshot[] };
```

- [ ] **Step 1: Write the failing test** — `src/store/loopKeyChange.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createDefaultLoop } from './loopSlice';
import type { Loop } from './types';
import { changeKeyAcrossLoops, targetKeyFor, transposeRoot } from './loopKeyChange';

const loop = (id: string, scaleRoot: string, scaleType = 'Natural Minor'): Loop =>
  ({ ...createDefaultLoop(), id, scaleRoot, scaleType });

describe('transposeRoot', () => {
  test('shifts through ROOTS and wraps both ways', () => {
    expect(transposeRoot('A', 3)).toBe('C');
    expect(transposeRoot('C', -1)).toBe('B');
    expect(transposeRoot('G', 14)).toBe('A');
    expect(transposeRoot('E', 1)).toBe('F');
    expect(transposeRoot('A', 1)).toBe('A#'); // ROOTS spelling, never Bb
  });
  test('an unknown root is null, not a guess', () => {
    expect(transposeRoot('Bb', 1)).toBeNull();
  });
});

describe('targetKeyFor', () => {
  test('set gives every loop the same key', () => {
    expect(targetKeyFor(loop('a', 'E', 'Dorian'), { mode: 'set', root: 'C', scaleType: 'Major' }))
      .toEqual({ root: 'C', scaleType: 'Major' });
  });
  test('transpose moves the root and keeps the loop’s own scale type', () => {
    expect(targetKeyFor(loop('a', 'E', 'Dorian'), { mode: 'transpose', semitones: 2 }))
      .toEqual({ root: 'F#', scaleType: 'Dorian' });
  });
});

describe('changeKeyAcrossLoops', () => {
  const loops = [loop('a', 'A'), loop('b', 'C', 'Major'), loop('c', 'E')];

  test('changes only the selected loops and keeps the others by reference', () => {
    const { loops: next, changed } = changeKeyAcrossLoops(
      loops, ['a', 'c'], { mode: 'set', root: 'D', scaleType: 'Dorian' }, { harmonizeChords: true },
    );
    expect(next[0].scaleRoot).toBe('D');
    expect(next[0].scaleType).toBe('Dorian');
    expect(next[1]).toBe(loops[1]);
    expect(next[2].scaleRoot).toBe('D');
    expect(changed.map((s) => s.loopId)).toEqual(['a', 'c']);
  });

  test('snapshots the pre-change key fields only', () => {
    const { changed } = changeKeyAcrossLoops(loops, ['a'], { mode: 'transpose', semitones: 3 }, { harmonizeChords: true });
    expect(changed[0].content).toEqual({
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      chords: loops[0].chords,
      leadMelodySteps: loops[0].leadMelodySteps,
      fxMelodySteps: loops[0].fxMelodySteps,
    });
  });

  test('unknown ids and loops already in the target key are skipped', () => {
    const { loops: next, changed } = changeKeyAcrossLoops(
      loops, ['b', 'ghost'], { mode: 'set', root: 'C', scaleType: 'Major' }, { harmonizeChords: true },
    );
    expect(next[1]).toBe(loops[1]);
    expect(changed).toEqual([]);
  });

  test('a transpose by a multiple of 12 changes nothing', () => {
    expect(changeKeyAcrossLoops(loops, ['a', 'b', 'c'], { mode: 'transpose', semitones: 12 }, { harmonizeChords: true }).changed)
      .toEqual([]);
  });

  test('harmonizeChords: false leaves every chord list by reference', () => {
    const { loops: next } = changeKeyAcrossLoops(loops, ['a'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: false });
    expect(next[0].chords).toBe(loops[0].chords);
  });

  test('harmonizeChords: true moves the chords with the key', () => {
    const { loops: next } = changeKeyAcrossLoops(loops, ['a'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: true });
    expect(next[0].chords[0].root).not.toBe(loops[0].chords[0].root);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/loopKeyChange.test.ts`
Expected: FAIL — cannot resolve `./loopKeyChange`.

- [ ] **Step 3: Implement `src/store/loopKeyChange.ts`**

```ts
import { ROOTS } from '@/musicCore';
import type { LoopContent } from './loop';
import { changeKey, type KeyChangeOptions } from './keyChange';
import type { Loop } from './types';

/** Set: every selected loop to one key. Transpose: each root shifted, each loop keeps its scale type. */
export type BatchKeyTarget =
  | { mode: 'set'; root: string; scaleType: string }
  | { mode: 'transpose'; semitones: number };

/** Exactly the fields `changeKey` can write — the undo snapshot restores these and nothing else. */
export type KeyChangeField = 'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps';

export interface LoopKeySnapshot {
  loopId: string;
  content: Pick<LoopContent, KeyChangeField>;
}

/** `root` moved by `semitones` through `ROOTS`, ROOTS-spelled; null for a root outside `ROOTS`. */
export function transposeRoot(root: string, semitones: number): string | null {
  const index = (ROOTS as readonly string[]).indexOf(root);
  if (index < 0) return null;
  const shifted = (((index + semitones) % 12) + 12) % 12;
  return ROOTS[shifted];
}

/** The key one loop lands in, or null when its root cannot be read. */
export function targetKeyFor(
  loop: Pick<Loop, 'scaleRoot' | 'scaleType'>,
  target: BatchKeyTarget,
): { root: string; scaleType: string } | null {
  if (target.mode === 'set') return { root: target.root, scaleType: target.scaleType };
  const root = transposeRoot(loop.scaleRoot, target.semitones);
  return root === null ? null : { root, scaleType: loop.scaleType };
}

function snapshotOf(loop: Loop): LoopKeySnapshot {
  return {
    loopId: loop.id,
    content: {
      scaleRoot: loop.scaleRoot,
      scaleType: loop.scaleType,
      chords: loop.chords,
      leadMelodySteps: loop.leadMelodySteps,
      fxMelodySteps: loop.fxMelodySteps,
    },
  };
}

/**
 * `changeKey` over every selected loop. Pure: reads no store and no
 * activeLoopId — the caller decides how the active loop is written. Loops not
 * selected, not found, unreadable or already in their target key keep their
 * object reference and are absent from `changed`, which holds each changed
 * loop's PRE-change key fields (the undo snapshot).
 */
export function changeKeyAcrossLoops(
  loops: readonly Loop[],
  ids: readonly string[],
  target: BatchKeyTarget,
  opts: KeyChangeOptions,
): { loops: Loop[]; changed: LoopKeySnapshot[] } {
  const selected = new Set(ids);
  const changed: LoopKeySnapshot[] = [];
  const next = loops.map((loop) => {
    if (!selected.has(loop.id)) return loop;
    const key = targetKeyFor(loop, target);
    if (!key || (key.root === loop.scaleRoot && key.scaleType === loop.scaleType)) return loop;
    changed.push(snapshotOf(loop));
    return { ...loop, ...changeKey(loop, { root: key.root, scaleType: key.scaleType }, opts) };
  });
  return { loops: next, changed };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/store/loopKeyChange.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/loopKeyChange.ts src/store/loopKeyChange.test.ts
git commit -m "feat(store): add pure changeKeyAcrossLoops with Set and Transpose modes (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Store actions — apply and undo in one write each

**Files:**
- Create: `src/store/loopKeyChangeSlice.ts`
- Modify: `src/store/types.ts` (`LoopSlice`), `src/store/loopSlice.ts` (`createLoopSlice` return type), `src/store/store.ts` (spread the new slice beside `createLoopCopySlice`)
- Test: `src/store/loopKeyChangeSlice.test.ts`

**Interfaces:**
- Consumes: `changeKeyAcrossLoops`, `BatchKeyTarget`, `LoopKeySnapshot` (Task 1); `KeyChangeOptions`.
- Produces on `LoopSlice`:

```ts
export interface LoopKeyChangeUndo { snapshots: LoopKeySnapshot[] }   // exported from loopKeyChange.ts
applyLoopKeyChange: (ids: readonly string[], target: BatchKeyTarget, opts: KeyChangeOptions) => LoopKeyChangeUndo | null;
undoLoopKeyChange: (undo: LoopKeyChangeUndo) => void;
```

- [ ] **Step 1: Write the failing test** — `src/store/loopKeyChangeSlice.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { useAppStore } from './store';
import type { Loop } from './types';

const A = (): Loop => createDefaultLoop(); // active, A Natural Minor
const B = (): Loop => ({ ...createDefaultLoop(), id: 'loop-b', scaleRoot: 'C', scaleType: 'Major' });

const reset = () => {
  const a = A();
  useAppStore.setState({
    loops: [a, B()],
    activeLoopId: a.id,
    ...loopStatePatch(a),
    reharmonizedIndicator: false,
  });
};
beforeEach(reset);
afterEach(reset);

const count = (fn: () => void): number => {
  let n = 0;
  const stop = useAppStore.subscribe(() => { n += 1; });
  fn();
  stop();
  return n;
};

describe('applyLoopKeyChange', () => {
  test('one notification; non-active loops in loops[], active loop through its flat fields', () => {
    let undo = null as ReturnType<ReturnType<typeof useAppStore.getState>['applyLoopKeyChange']>;
    const n = count(() => {
      undo = useAppStore.getState().applyLoopKeyChange(
        ['loop-default-1', 'loop-b'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: true },
      );
    });
    const s = useAppStore.getState();
    expect(n).toBe(1);
    expect(s.scaleRoot).toBe('B');                                   // active, flat
    expect(s.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('D'); // non-active, loops[]
    const active = s.loops.find((l) => l.id === s.activeLoopId)!;
    expect(active.scaleRoot).toBe(s.scaleRoot);
    expect(active.chords).toBe(s.chords);
    expect(s.reharmonizedIndicator).toBe(true);
    expect(undo!.snapshots.map((x) => x.loopId)).toEqual(['loop-default-1', 'loop-b']);
  });

  test('a non-active-only batch leaves the flat fields untouched', () => {
    const before = useAppStore.getState();
    useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'set', root: 'E', scaleType: 'Dorian' }, { harmonizeChords: true });
    const s = useAppStore.getState();
    expect(s.scaleRoot).toBe(before.scaleRoot);
    expect(s.chords).toBe(before.chords);
    expect(s.reharmonizedIndicator).toBe(false);
  });

  test('nothing to change returns null and writes nothing', () => {
    const n = count(() => {
      expect(
        useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'set', root: 'C', scaleType: 'Major' }, { harmonizeChords: true }),
      ).toBeNull();
    });
    expect(n).toBe(0);
  });
});

describe('undoLoopKeyChange', () => {
  test('restores every loop in one notification and clears the badge for the active loop', () => {
    const start = useAppStore.getState();
    const undo = useAppStore.getState().applyLoopKeyChange(
      ['loop-default-1', 'loop-b'], { mode: 'transpose', semitones: 5 }, { harmonizeChords: true },
    )!;
    const n = count(() => useAppStore.getState().undoLoopKeyChange(undo));
    const s = useAppStore.getState();
    expect(n).toBe(1);
    expect(s.scaleRoot).toBe('A');
    expect(s.chords).toBe(start.chords);
    expect(s.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('C');
    expect(s.reharmonizedIndicator).toBe(false);
  });

  test('a loop deleted in between is skipped', () => {
    const undo = useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'transpose', semitones: 1 }, { harmonizeChords: false })!;
    useAppStore.setState({ loops: useAppStore.getState().loops.filter((l) => l.id !== 'loop-b') });
    useAppStore.getState().undoLoopKeyChange(undo);
    expect(useAppStore.getState().loops.map((l) => l.id)).toEqual(['loop-default-1']);
  });

  test('undo leaves fields changeKey never writes alone (a knob moved after the batch survives)', () => {
    const undo = useAppStore.getState().applyLoopKeyChange(['loop-default-1'], { mode: 'transpose', semitones: 1 }, { harmonizeChords: true })!;
    useAppStore.getState().setChordFeel(0.9);
    useAppStore.getState().undoLoopKeyChange(undo);
    expect(useAppStore.getState().chordFeel).toBe(0.9);
  });
});
```

(If `setChordFeel` is named differently, use the chords slice's feel setter — `grep -n "chordFeel" src/store/types.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/loopKeyChangeSlice.test.ts`
Expected: FAIL — `applyLoopKeyChange is not a function`.

- [ ] **Step 3: Implement.** Add to `loopKeyChange.ts`:

```ts
/** A pending batch Undo: session-only, single level, never persisted. */
export interface LoopKeyChangeUndo {
  snapshots: LoopKeySnapshot[];
}
```

Create `src/store/loopKeyChangeSlice.ts`:

```ts
import type { StoreApi } from 'zustand';
import type { LoopContent } from './loop';
import { changeKeyAcrossLoops, type KeyChangeField } from './loopKeyChange';
import type { AppStore, Loop, LoopSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

const KEY_CHANGE_FIELDS: readonly KeyChangeField[] = [
  'scaleRoot', 'scaleType', 'chords', 'leadMelodySteps', 'fxMelodySteps',
];

function keyFieldsOf(loop: Loop): Pick<LoopContent, KeyChangeField> {
  const out: Partial<Pick<LoopContent, KeyChangeField>> = {};
  for (const field of KEY_CHANGE_FIELDS) (out as Record<string, unknown>)[field] = loop[field];
  return out as Pick<LoopContent, KeyChangeField>;
}

/**
 * Batch key change. Each action is ONE set(): non-active loops land in
 * loops[]; the active loop's new key fields ride as flat values in the same
 * partial, so engineSync and the grids follow immediately — the same path a
 * Header key change takes, never crossLoopSeam. loopMirrorPartial builds on
 * partial.loops and rewrites loops[active] from the post-write flat state,
 * which holds the same values, so the two cannot disagree. The next song loop
 * reads loops[] when songMode calls loadLoop at its boundary.
 */
export function createLoopKeyChangeSlice(
  set: Set,
  get: Get,
): Pick<LoopSlice, 'applyLoopKeyChange' | 'undoLoopKeyChange'> {
  return {
    applyLoopKeyChange: (ids, target, opts) => {
      const state = get();
      const { loops, changed } = changeKeyAcrossLoops(state.loops, ids, target, opts);
      if (changed.length === 0) return null;
      const active = changed.some((s) => s.loopId === state.activeLoopId)
        ? loops.find((l) => l.id === state.activeLoopId)
        : undefined;
      if (!active) {
        set({ loops });
      } else {
        const chordsMoved = active.chords !== state.chords;
        set({
          loops,
          ...keyFieldsOf(active),
          ...(chordsMoved ? { reharmonizedIndicator: true } : {}),
        });
      }
      return { snapshots: changed };
    },

    undoLoopKeyChange: (undo) => {
      const state = get();
      const byId = new Map(undo.snapshots.map((s) => [s.loopId, s.content]));
      const loops = state.loops.map((loop) => {
        const content = byId.get(loop.id);
        return content ? { ...loop, ...content } : loop;
      });
      const activeContent = byId.get(state.activeLoopId);
      set(
        activeContent
          ? { loops, ...activeContent, reharmonizedIndicator: false }
          : { loops },
      );
    },
  };
}
```

A snapshot whose loop was deleted finds no match in `state.loops.map` and is skipped. In `types.ts` `LoopSlice` add the two members with docs, importing `BatchKeyTarget`/`LoopKeyChangeUndo` from `./loopKeyChange` and `KeyChangeOptions` from `./keyChange` as types. In `loopSlice.ts` change `Omit<LoopSlice, 'applyLoopCopy'>` to `Omit<LoopSlice, 'applyLoopCopy' | 'applyLoopKeyChange' | 'undoLoopKeyChange'>`. In `store.ts` add `...createLoopKeyChangeSlice(setWithLoopMirror, get),` after `createLoopCopySlice`.

- [ ] **Step 4: Run tests**

Run: `bun test src/store/loopKeyChangeSlice.test.ts src/store/loopKeyChange.test.ts src/store/loopSync.test.ts src/store/loopSlice.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store
git commit -m "feat(store): apply and undo a batch key change in one write each (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: A batch near a song boundary

**Files:**
- Test: `src/store/loadLoop.test.ts` (new `describe` at the end; reuse the file's `resetStore` before/after hooks)

**Interfaces:**
- Consumes: `applyLoopKeyChange` (Task 2); `loadLoop(id, { atBoundary })`.

- [ ] **Step 1: Write the test**

```ts
describe('batch key change around a song boundary', () => {
  const songState = () => ({
    loops: [createDefaultLoop(), { ...createDefaultLoop(), id: 'loop-b', name: 'B' }],
    activeLoopId: 'loop-default-1',
    songLoopIndex: 0,
    sequencerPlayer: 'playing' as const,
    playbackScope: { kind: 'song' as const },
  });

  test('a batch before the advance is what the next loop installs', () => {
    const drop = spyOn(audioEngine, 'dropVoicesScheduledFrom').mockImplementation(() => {});
    const reset = spyOn(audioEngine, 'resetClock').mockImplementation(() => {});
    try {
      useAppStore.setState(songState());
      useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'set', root: 'E', scaleType: 'Dorian' }, { harmonizeChords: true });
      loadLoop('loop-b', { atBoundary: 42.5 });
      const s = useAppStore.getState();
      expect(s.activeLoopId).toBe('loop-b');
      expect([s.scaleRoot, s.scaleType]).toEqual(['E', 'Dorian']);
    } finally {
      drop.mockRestore();
      reset.mockRestore();
    }
  });

  test('a batch after the advance lands on the new active loop through its flat fields', () => {
    const drop = spyOn(audioEngine, 'dropVoicesScheduledFrom').mockImplementation(() => {});
    const reset = spyOn(audioEngine, 'resetClock').mockImplementation(() => {});
    try {
      useAppStore.setState(songState());
      loadLoop('loop-b', { atBoundary: 42.5 });
      useAppStore.getState().applyLoopKeyChange(['loop-b'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: true });
      const s = useAppStore.getState();
      expect(s.scaleRoot).toBe('B');
      expect(s.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('B');
    } finally {
      drop.mockRestore();
      reset.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test src/store/loadLoop.test.ts`
Expected: PASS without code changes (spec §2.3: the boundary write is synchronous). If it fails, stop and report — the premise in spec §0 F11 would be wrong.

- [ ] **Step 3: Commit**

```bash
git add src/store/loadLoop.test.ts
git commit -m "test(store): pin batch key change on both sides of a song boundary (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Dialog hook with pure preview helpers

**Files:**
- Create: `src/components/song/useKeyChangeDialog.ts`
- Test: `src/components/song/useKeyChangeDialog.test.ts`

**Interfaces:**
- Consumes: `BatchKeyTarget`, `targetKeyFor` (Task 1); `loopLabel` (`@/store/loop`); `formatKeyLabel` (`@/utils/noteSpelling`); `KeyChangeOptions`.
- Produces:

```ts
export interface KeyChangePreviewRow { id: string; label: string; from: string; to: string; changes: boolean }
export function keyChangePreview(loops: readonly Loop[], target: BatchKeyTarget): KeyChangePreviewRow[];
export function canApplyKeyChange(rows: readonly KeyChangePreviewRow[], selected: ReadonlySet<string>): boolean;
export const TRANSPOSE_STEPS: readonly number[]; // -11..-1, 1..11
export interface KeyChangeDialogProps {
  loops: readonly Loop[];
  activeLoopId: string;
  onApply: (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => void;
  onClose: () => void;
}
export interface UseKeyChangeDialog {
  mode: 'set' | 'transpose'; setMode: (m: 'set' | 'transpose') => void;
  root: string; setRoot: (r: string) => void;
  scaleType: string; setScaleType: (t: string) => void;
  semitones: number; setSemitones: (n: number) => void;
  harmonizeChords: boolean; setHarmonizeChords: (on: boolean) => void;
  selected: ReadonlySet<string>; toggleLoop: (id: string) => void;
  rows: KeyChangePreviewRow[];
  canApply: boolean;
  apply: () => void;
}
export function useKeyChangeDialog(props: KeyChangeDialogProps): UseKeyChangeDialog;
```

- [ ] **Step 1: Write the failing test** — `src/components/song/useKeyChangeDialog.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createDefaultLoop } from '@/store/loopSlice';
import type { Loop } from '@/store/types';
import { canApplyKeyChange, keyChangePreview, TRANSPOSE_STEPS } from './useKeyChangeDialog';

const loop = (id: string, name: string, scaleRoot: string, scaleType = 'Natural Minor'): Loop =>
  ({ ...createDefaultLoop(), id, name, scaleRoot, scaleType });
const loops = [loop('a', 'Verse', 'A'), loop('b', 'Chorus', 'C', 'Major')];

describe('keyChangePreview', () => {
  test('one row per loop, labelled, with display-spelled old → new keys', () => {
    const rows = keyChangePreview(loops, { mode: 'transpose', semitones: 1 });
    expect(rows.map((r) => r.label)).toEqual(['Verse', 'Chorus']);
    expect(rows.every((r) => r.changes)).toBe(true);
    expect(rows[0].from).not.toBe(rows[0].to);
  });

  test('a loop already in the Set target is marked unchanged', () => {
    const rows = keyChangePreview(loops, { mode: 'set', root: 'C', scaleType: 'Major' });
    expect(rows.find((r) => r.id === 'b')!.changes).toBe(false);
    expect(rows.find((r) => r.id === 'a')!.changes).toBe(true);
  });
});

describe('canApplyKeyChange', () => {
  const rows = keyChangePreview(loops, { mode: 'set', root: 'C', scaleType: 'Major' });
  test('needs at least one selected loop that would change', () => {
    expect(canApplyKeyChange(rows, new Set(['a']))).toBe(true);
    expect(canApplyKeyChange(rows, new Set(['b']))).toBe(false);
    expect(canApplyKeyChange(rows, new Set())).toBe(false);
  });
});

test('TRANSPOSE_STEPS is -11..+11 without 0', () => {
  expect(TRANSPOSE_STEPS.length).toBe(22);
  expect(TRANSPOSE_STEPS).not.toContain(0);
  expect(Math.min(...TRANSPOSE_STEPS)).toBe(-11);
  expect(Math.max(...TRANSPOSE_STEPS)).toBe(11);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/song/useKeyChangeDialog.test.ts`
Expected: FAIL — cannot resolve `./useKeyChangeDialog`.

- [ ] **Step 3: Implement `src/components/song/useKeyChangeDialog.ts`**

```ts
import { useMemo, useState } from 'react';
import { loopLabel } from '@/store/loop';
import type { KeyChangeOptions } from '@/store/keyChange';
import { targetKeyFor, type BatchKeyTarget } from '@/store/loopKeyChange';
import type { Loop } from '@/store/types';
import { formatKeyLabel } from '@/utils/noteSpelling';

export interface KeyChangePreviewRow {
  id: string;
  label: string;
  /** Display-spelled, e.g. "A minor" — never stored or compared. */
  from: string;
  to: string;
  changes: boolean;
}

export const TRANSPOSE_STEPS: readonly number[] = [
  -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
];

/** The old → new key of every loop under `target`; ROOTS comparison, spelled labels. */
export function keyChangePreview(loops: readonly Loop[], target: BatchKeyTarget): KeyChangePreviewRow[] {
  return loops.map((loop) => {
    const key = targetKeyFor(loop, target);
    const changes = key !== null && (key.root !== loop.scaleRoot || key.scaleType !== loop.scaleType);
    const from = formatKeyLabel(loop.scaleRoot, loop.scaleType);
    return {
      id: loop.id,
      label: loopLabel(loop),
      from,
      to: key ? formatKeyLabel(key.root, key.scaleType) : from,
      changes,
    };
  });
}

export function canApplyKeyChange(rows: readonly KeyChangePreviewRow[], selected: ReadonlySet<string>): boolean {
  return rows.some((row) => row.changes && selected.has(row.id));
}

export interface KeyChangeDialogProps {
  loops: readonly Loop[];
  activeLoopId: string;
  onApply: (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => void;
  onClose: () => void;
}

export interface UseKeyChangeDialog {
  mode: 'set' | 'transpose';
  setMode: (mode: 'set' | 'transpose') => void;
  root: string;
  setRoot: (root: string) => void;
  scaleType: string;
  setScaleType: (scaleType: string) => void;
  semitones: number;
  setSemitones: (semitones: number) => void;
  harmonizeChords: boolean;
  setHarmonizeChords: (on: boolean) => void;
  selected: ReadonlySet<string>;
  toggleLoop: (id: string) => void;
  rows: KeyChangePreviewRow[];
  canApply: boolean;
  apply: () => void;
}

/** The dialog's state. Set defaults to the active loop's key; every loop starts ticked; harmonize starts on. */
export function useKeyChangeDialog({ loops, activeLoopId, onApply, onClose }: KeyChangeDialogProps): UseKeyChangeDialog {
  const active = loops.find((loop) => loop.id === activeLoopId) ?? loops[0];
  const [mode, setMode] = useState<'set' | 'transpose'>('set');
  const [root, setRoot] = useState(active.scaleRoot);
  const [scaleType, setScaleType] = useState(active.scaleType);
  const [semitones, setSemitones] = useState(2);
  const [harmonizeChords, setHarmonizeChords] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(loops.map((l) => l.id)));

  const target: BatchKeyTarget = mode === 'set' ? { mode, root, scaleType } : { mode, semitones };
  const rows = useMemo(
    () => keyChangePreview(loops, target),
    // `target` is rebuilt every render; its inputs are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on target's fields, not its identity
    [loops, mode, root, scaleType, semitones],
  );

  const toggleLoop = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canApply = canApplyKeyChange(rows, selected);
  const apply = () => {
    if (!canApply) return;
    onApply([...selected], target, { harmonizeChords });
    onClose();
  };

  return {
    mode, setMode, root, setRoot, scaleType, setScaleType, semitones, setSemitones,
    harmonizeChords, setHarmonizeChords, selected, toggleLoop, rows, canApply, apply,
  };
}
```

(Alternative to the disable comment: build `target` inside `useMemo` keyed on `mode, root, scaleType, semitones` and depend on it — prefer that if it reads cleaner; either way `bun run eslint` must print zero warnings.)

- [ ] **Step 4: Run tests**

Run: `bun test src/components/song/useKeyChangeDialog.test.ts && bun run lint && bun run eslint`
Expected: PASS; zero errors, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/song/useKeyChangeDialog.ts src/components/song/useKeyChangeDialog.test.ts
git commit -m "feat(arrange): key change dialog hook with old-to-new preview (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `KeyChangeDialog` layout

**Files:**
- Create: `src/components/song/KeyChangeDialog.tsx`
- Test: `src/components/song/KeyChangeDialog.test.tsx`

**Interfaces:**
- Consumes: `useKeyChangeDialog`, `KeyChangeDialogProps`, `TRANSPOSE_STEPS` (Task 4); `Modal` (`@/components/ui/Modal`); `KEY_OPTIONS` (`@/utils/noteSpelling`); `SCALES` (`@/data/scales`).
- Produces: `export function KeyChangeDialog(props: KeyChangeDialogProps): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createDefaultLoop } from '@/store/loopSlice';
import { KeyChangeDialog } from './KeyChangeDialog';

const loops = [
  { ...createDefaultLoop(), name: 'Verse' },
  { ...createDefaultLoop(), id: 'loop-b', name: 'Chorus', scaleRoot: 'C', scaleType: 'Major' },
];
const html = renderToString(
  <KeyChangeDialog loops={loops} activeLoopId={loops[0].id} onApply={() => {}} onClose={() => {}} />,
);

describe('KeyChangeDialog', () => {
  test('mode is a joined pair of radio buttons', () => {
    expect(html).toContain('class="join');
    expect(html).toContain('join-item btn btn-sm');
    expect(html).toContain('aria-label="Set key"');
    expect(html).toContain('aria-label="Transpose"');
  });

  test('harmonize chords is a checkbox, on by default', () => {
    expect(html).toContain('id="chk-key-change-harmonize"');
    expect(html).toContain('checkbox checkbox-sm checkbox-primary');
  });

  test('one ticked checkbox per loop with an old → new preview', () => {
    expect(html).toContain('id="chk-key-change-loop-loop-default-1"');
    expect(html).toContain('id="chk-key-change-loop-loop-b"');
    expect(html).toContain('Verse');
    expect(html).toContain('Chorus');
    expect(html).toContain('fieldset-legend');
  });

  test('Apply and Cancel actions', () => {
    expect(html).toContain('id="btn-key-change-apply"');
    expect(html).toContain('id="btn-key-change-cancel"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/song/KeyChangeDialog.test.tsx`
Expected: FAIL — cannot resolve `./KeyChangeDialog`.

- [ ] **Step 3: Implement** (children above root; layout only):

```tsx
import { SCALES } from '@/data/scales';
import { Modal } from '@/components/ui/Modal';
import { KEY_OPTIONS } from '@/utils/noteSpelling';
import {
  TRANSPOSE_STEPS,
  useKeyChangeDialog,
  type KeyChangeDialogProps,
  type KeyChangePreviewRow,
  type UseKeyChangeDialog,
} from './useKeyChangeDialog';

const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-base-content/50';

function ModeToggle({ mode, onChange }: { mode: UseKeyChangeDialog['mode']; onChange: UseKeyChangeDialog['setMode'] }) {
  return (
    <div className="join">
      <input className="join-item btn btn-sm" type="radio" name="key-change-mode" aria-label="Set key"
        checked={mode === 'set'} onChange={() => onChange('set')} />
      <input className="join-item btn btn-sm" type="radio" name="key-change-mode" aria-label="Transpose"
        checked={mode === 'transpose'} onChange={() => onChange('transpose')} />
    </div>
  );
}

function SetKeyFields({ root, scaleType, onRoot, onScale }: {
  root: string; scaleType: string; onRoot: (r: string) => void; onScale: (t: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <select id="select-key-change-root" aria-label="Key" value={root}
        onChange={(e) => onRoot(e.target.value)} className="select select-sm flex-1 text-xs">
        {KEY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select id="select-key-change-scale" aria-label="Scale" value={scaleType}
        onChange={(e) => onScale(e.target.value)} className="select select-sm flex-1 text-xs">
        {Object.keys(SCALES).map((s) => <option key={s} value={s}>{SCALES[s].name}</option>)}
      </select>
    </div>
  );
}

function TransposeField({ semitones, onChange }: { semitones: number; onChange: (n: number) => void }) {
  return (
    <select id="select-key-change-semitones" aria-label="Semitones" value={semitones}
      onChange={(e) => onChange(Number(e.target.value))} className="select select-sm text-xs">
      {TRANSPOSE_STEPS.map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : n} semitones</option>)}
    </select>
  );
}

function LoopChecklist({ rows, selected, onToggle }: {
  rows: KeyChangePreviewRow[]; selected: ReadonlySet<string>; onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Loops</legend>
      {rows.map((row) => (
        <label key={row.id} className="label gap-2 text-xs">
          <input id={`chk-key-change-loop-${row.id}`} type="checkbox" className="checkbox checkbox-sm"
            checked={selected.has(row.id)} onChange={() => onToggle(row.id)} />
          <span className="flex-1 truncate">{row.label}</span>
          <span className="text-base-content/60">{row.changes ? `${row.from} → ${row.to}` : `${row.from} (unchanged)`}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function KeyChangeDialog(props: KeyChangeDialogProps) {
  const d = useKeyChangeDialog(props);
  return (
    <Modal open onClose={props.onClose} title="Change key" size="md" boxClassName="space-y-4">
      <ModeToggle mode={d.mode} onChange={d.setMode} />
      {d.mode === 'set' ? (
        <SetKeyFields root={d.root} scaleType={d.scaleType} onRoot={d.setRoot} onScale={d.setScaleType} />
      ) : (
        <TransposeField semitones={d.semitones} onChange={d.setSemitones} />
      )}
      <label className="label gap-2 text-xs">
        <input id="chk-key-change-harmonize" type="checkbox" className="checkbox checkbox-sm checkbox-primary"
          checked={d.harmonizeChords} onChange={(e) => d.setHarmonizeChords(e.target.checked)} />
        <span className={LABEL}>Harmonize chords</span>
      </label>
      <LoopChecklist rows={d.rows} selected={d.selected} onToggle={d.toggleLoop} />
      <div className="modal-action">
        <button id="btn-key-change-cancel" type="button" className="btn btn-sm btn-ghost" onClick={props.onClose}>Cancel</button>
        <button id="btn-key-change-apply" type="button" className="btn btn-sm btn-primary"
          disabled={!d.canApply} onClick={d.apply}>Apply</button>
      </div>
    </Modal>
  );
}
```

Before writing, open `src/components/song/LoopCopyDialog.tsx`'s `CopyDialogActions` and match its button classes if they differ; run `bun run check:theme` if a colour class is added.

- [ ] **Step 4: Run tests**

Run: `bun test src/components/song/KeyChangeDialog.test.tsx && bun run lint && bun run eslint && bun run check:theme`
Expected: PASS; zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/song/KeyChangeDialog.tsx src/components/song/KeyChangeDialog.test.tsx
git commit -m "feat(arrange): key change dialog layout (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Arrange wiring — button, dialog, undo toast

**Files:**
- Create: `src/components/song/useLoopKeyChangeUndo.ts`
- Modify: `src/components/song/LoopUndoToast.tsx` (alert only; `{ message, buttonId, onUndo }`)
- Modify: `src/components/song/ArrangeView.tsx` (`ArrangeHeader`, the root render, `LOOP_UNDO_MS` export)
- Test: `src/components/song/LoopUndoToast.test.tsx`, `src/components/song/ArrangeView.test.tsx`

**Interfaces:**
- Consumes: `applyLoopKeyChange`, `undoLoopKeyChange`, `LoopKeyChangeUndo` (Task 2); `KeyChangeDialog` (Task 5); `useTimedToast` (`@/components/ui/useTimedToast`).
- Produces:

```ts
export interface UseLoopKeyChangeUndo {
  keyChangeOpen: boolean;
  openKeyChange: () => void;
  closeKeyChange: () => void;
  onApplyKeyChange: (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => void;
  keyChangeUndo: LoopKeyChangeUndo | null;
  onUndoKeyChange: () => void;
}
export function useLoopKeyChangeUndo(): UseLoopKeyChangeUndo;
export function keyChangeToastMessage(undo: LoopKeyChangeUndo): string; // "Key changed on 1 loop" / "… on 3 loops"
```

- [ ] **Step 1: Write the failing tests.** Replace `LoopUndoToast.test.tsx`'s renders with the new props and add a container assertion:

```tsx
const html = renderToString(<LoopUndoToast message="Loop 2 deleted" buttonId="btn-undo-loop-delete" onUndo={() => {}} />);
expect(html).toContain('id="btn-undo-loop-delete"');
expect(html).toContain('Loop 2 deleted');
expect(html).toContain('role="status"');
expect(html).not.toContain('toast toast-bottom'); // the container belongs to ArrangeView now
```

Add to `ArrangeView.test.tsx`:

```tsx
import { keyChangeToastMessage } from './useLoopKeyChangeUndo';

test('the Arrange header offers Change key… beside Add Loop', () => {
  const html = renderToString(<ArrangeView />); // reuse the file's existing render helper if it has one
  expect(html).toContain('id="btn-arrange-change-key"');
  expect(html.indexOf('btn-arrange-change-key')).toBeLessThan(html.indexOf('btn-arrange-add'));
});

test('the key change toast counts loops', () => {
  expect(keyChangeToastMessage({ snapshots: [{ loopId: 'a', content: {} as never }] })).toBe('Key changed on 1 loop');
  expect(keyChangeToastMessage({ snapshots: [1, 2, 3].map((i) => ({ loopId: `l${i}`, content: {} as never })) }))
    .toBe('Key changed on 3 loops');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/song/LoopUndoToast.test.tsx src/components/song/ArrangeView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** `LoopUndoToast.tsx`:

```tsx
/**
 * One timed-Undo alert (loop delete, batch key change). Presentational only:
 * the owner holds the timer and the restore. ArrangeView wraps every pending
 * alert in ONE daisyUI `toast` container so two pending Undos stack instead of
 * overlapping.
 */
export function LoopUndoToast({ message, buttonId, onUndo }: { message: string; buttonId: string; onUndo: () => void }) {
  return (
    <div role="status" className="alert alert-info alert-soft py-1.5 px-3 text-xs gap-3">
      <span>{message}</span>
      <button id={buttonId} type="button" className="btn btn-xs" onClick={onUndo}>Undo</button>
    </div>
  );
}
```

`useLoopKeyChangeUndo.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/store/store';
import type { KeyChangeOptions } from '@/store/keyChange';
import type { BatchKeyTarget, LoopKeyChangeUndo } from '@/store/loopKeyChange';
import { useTimedToast } from '@/components/ui/useTimedToast';
import { LOOP_UNDO_MS } from './ArrangeView';

export interface UseLoopKeyChangeUndo { /* as in Interfaces above */ }

export function keyChangeToastMessage(undo: LoopKeyChangeUndo): string {
  const n = undo.snapshots.length;
  return `Key changed on ${n} loop${n === 1 ? '' : 's'}`;
}

/**
 * Batch key change from Arrange: the dialog's open state, the apply, and a
 * single-level timed Undo — the useLoopDeleteUndo pattern. A new batch replaces
 * a pending Undo; a project install dismisses it (loop ids collide across
 * projects, so an Undo there would write into the wrong loops).
 */
export function useLoopKeyChangeUndo(): UseLoopKeyChangeUndo {
  const [keyChangeOpen, setKeyChangeOpen] = useState(false);
  const { toast, show, dismiss } = useTimedToast<LoopKeyChangeUndo>();

  useEffect(() => useAppStore.subscribe((s) => s.projectInstallCount, dismiss), [dismiss]);

  const onApplyKeyChange = useCallback(
    (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => {
      const undo = useAppStore.getState().applyLoopKeyChange(ids, target, opts);
      if (undo) show(undo, LOOP_UNDO_MS);
    },
    [show],
  );

  const onUndoKeyChange = useCallback(() => {
    if (!toast) return;
    useAppStore.getState().undoLoopKeyChange(toast);
    dismiss();
  }, [toast, dismiss]);

  return {
    keyChangeOpen,
    openKeyChange: () => setKeyChangeOpen(true),
    closeKeyChange: () => setKeyChangeOpen(false),
    onApplyKeyChange,
    keyChangeUndo: toast,
    onUndoKeyChange,
  };
}
```

If importing `LOOP_UNDO_MS` from `ArrangeView` creates a cycle (ArrangeView will import this hook), move `LOOP_UNDO_MS` into `useLoopKeyChangeUndo.ts`'s sibling `src/components/song/loopUndo.ts` (`export const LOOP_UNDO_MS = 5000;`) and import it from both.

`ArrangeView.tsx`:
- `ArrangeHeader` takes `onChangeKey` and renders, before Add Loop:

```tsx
<button id="btn-arrange-change-key" type="button" onClick={onChangeKey} className="btn btn-sm btn-ghost gap-1.5">
  <KeyRound className="w-4 h-4" />
  Change key…
</button>
```

(`KeyRound` from `lucide-react`, which the file already uses for `Plus`; wrap both buttons in a `<div className="flex gap-2">` inside `actions`.)
- In the root: `const keyChange = useLoopKeyChangeUndo();` next to `useLoopCardActions()`; pass `onChangeKey={keyChange.openKeyChange}`.
- Replace the single `LoopUndoToast` block with one container:

```tsx
{(actions.deletedLoop || keyChange.keyChangeUndo) && (
  <div className="toast toast-bottom toast-center z-30 animate-fade-in">
    {actions.deletedLoop && (
      <LoopUndoToast message={`${loopLabel(actions.deletedLoop.loop)} deleted`}
        buttonId="btn-undo-loop-delete" onUndo={actions.onUndoDelete} />
    )}
    {keyChange.keyChangeUndo && (
      <LoopUndoToast message={keyChangeToastMessage(keyChange.keyChangeUndo)}
        buttonId="btn-undo-key-change" onUndo={keyChange.onUndoKeyChange} />
    )}
  </div>
)}
{keyChange.keyChangeOpen && (
  <KeyChangeDialog loops={loops} activeLoopId={activeLoopId}
    onApply={keyChange.onApplyKeyChange} onClose={keyChange.closeKeyChange} />
)}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/components/song && bun run lint && bun run eslint && bun run check:theme`
Expected: PASS; zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/song
git commit -m "feat(arrange): Change key button, dialog and Undo toast (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: ADR-0033, rules and docs

**Files:**
- Create: `docs/decisions/0033-batch-key-change-across-loops.md`
- Modify: `docs/decisions/README.md`, `.claude/rules/loops-and-solo.md`, `CLAUDE.md` (rules-table cell only), `docs/architecture/feature-overview.md`, `docs/architecture/structure/01-ui.md`, `docs/architecture/structure/02-store.md`

- [ ] **Step 1: Next free rule id** — `grep -rhoE "R[0-9]{3}" .claude/rules docs/decisions CLAUDE.md | sort -u | tail -1`; call the next three `Ra`, `Rb`, `Rc`.

- [ ] **Step 2: ADR-0033** (README template): **Status** Accepted — date of merge, DEV-427 (epic DEV-433). **Context:** key changes applied only to the active loop; PR 1 made `changeKey` loop-agnostic. **Decision:** `changeKeyAcrossLoops` + `applyLoopKeyChange`/`undoLoopKeyChange` each one `set()`; active loop through flat fields (no `crossLoopSeam`); Set vs Transpose (Transpose keeps each loop's scale type; roots `ROOTS`-spelled); undo snapshot = the key-change fields only; single-level, session-only, dismissed on project install; loops deleted in between skipped. Rejected: seam or reload the active loop (audible cut for a metadata change); whole-content snapshot (reverts unrelated edits); persisted or multi-level undo (no precedent, loop ids collide across projects). **Consequences:** song playback picks up non-active changes at the next boundary; the Undo toast container is shared. **Rules:** Ra–Rc. Add the index row.

- [ ] **Step 3: `loops-and-solo.md`** — add `src/store/loopKeyChange*.ts` to `paths`; new section "## Batch key change":
  - `- `applyLoopKeyChange` and `undoLoopKeyChange` are one `set()` each: non-active loops in `loops[]`, the active loop through its flat fields — never `crossLoopSeam` or `loadLoop`. <!-- Ra -->`
  - `- The undo snapshot holds only the fields `changeKey` writes (`scaleRoot`, `scaleType`, `chords`, both melody rows); it is session-only and single-level; a loop deleted in between is skipped. <!-- Rb -->`
  - `- A project install dismisses a pending key-change Undo (loop ids collide across projects). <!-- Rc -->`
  - Prohibited: "Seaming or reloading the active loop for a batch key change", "A whole-`LoopContent` undo snapshot", "Keeping a pending key-change Undo across a project install".

- [ ] **Step 4: Other docs.** `CLAUDE.md` rules table, `loops-and-solo.md` Covers cell: add "batch key change". `feature-overview.md` Arrange row: add "change the key of several loops (Set/Transpose) with Undo". `01-ui.md` song folder: `KeyChangeDialog.tsx`, `useKeyChangeDialog.ts`, `useLoopKeyChangeUndo.ts`, the shared toast container. `02-store.md`: `loopKeyChange.ts`, `loopKeyChangeSlice.ts` and the one-write rule. No version numbers, counts or line numbers.

- [ ] **Step 5: Run guards**

Run: `bun test src/architecture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs .claude/rules CLAUDE.md
git commit -m "docs: ADR-0033 batch key change, loops rules and architecture sync (DEV-427)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Completion gate

- [ ] **Step 1: Run the gate**

Run: `bun run verify`
Expected: all tests, static/domain checks, both Knip scans (zero findings) and the production build pass.

- [ ] **Step 2: Run ESLint**

Run: `bun run eslint`
Expected: zero errors and zero warnings. A warning is never ignored: fix it, or add a line-level `eslint-disable-next-line <rule> -- <reason>` naming why the site is a legitimate exception (R264).

- [ ] **Step 3: Fix, re-run both, commit fixes**

```bash
git add -A
git commit -m "chore: satisfy the verify gate for DEV-427

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Skip when nothing changed.) Do not push.
