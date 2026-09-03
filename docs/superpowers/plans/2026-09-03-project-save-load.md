# Project Save / Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named projects stored locally in IndexedDB, opened and saved from a Project Manager behind the header wordmark, plus `.solna` file export and import — without changing what the `localStorage` working buffer does today.

**Architecture:** A pure format layer (`projectFormat` / `projectFile` / `projectFingerprint`) turns the live store's content set into a project body and back, with the reset rules baked into one function. A `ProjectStore` wraps IndexedDB behind a small backend interface (in-memory fake for tests) and resolves every call to a typed result, never a rejection. A `projectSlice` owns identity, list and the lifecycle actions and writes content through `loopStatePatch` in one `set()`; a separate idle-debounced dirty tracker owns the `dirty` boolean. The UI is a wordmark button, a daisyUI modal and a pure flow reducer that sequences the dirty guard, the name prompt and the import-conflict dialog.

**Tech Stack:** Bun (tests + scripts), Vite + React 19, zustand 5 (`persist` + `subscribeWithSelector`), raw IndexedDB (no new dependency), daisyUI 5 + Tailwind 4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-03-project-save-load-design.md`

## Global Constraints

- Runtime is Bun. Run one file with `bun test <file>`; the completion gate is `bun run verify` (test + lint + check:keys + check:drums + build). `bun run eslint` is **not** in the gate — every task that adds or removes an import runs it explicitly (`package.json` `scripts`).
- Layering (`eslint.config.js` `no-restricted-imports`): `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; components never import `audio/engine`. Nothing in this plan adds engine state, so `src/store/engineSync.ts` is not touched — the content set only writes keys `engineSync` already subscribes to.
- `persist` re-serialises on every `set()` that touches a partialized key (`src/store/store.ts:414-441`); the write is coalesced by `src/utils/coalescedStorage.ts`. Dirty detection is idle-debounced through `WriteScheduler` / `idleWriteScheduler` (`src/utils/coalescedStorage.ts:17-37`), never per-`set()`.
- Persist `version` is `8` at `src/store/store.ts:439`; this plan bumps it to `9` with `migrateAddProjectIdentity` composed last in the chain (`src/store/store.ts:444-478`).
- Format constants copied from the spec: `formatVersion: 1`; file extension `.solna`; MIME `application/json`; file picker `accept=".solna,.json"`; content set = `bpm`, `meterId`, `masterVolume`, `effects`, `loops`; excluded = `controlTarget`, `activeLoopId`, `metronomeActive`, `selectedVibeId`, `customSynthPresets`, `customChordProgressions`.
- Reset rules on Open / New / import-then-open: `selectedVibeId → null`; `activeLoopId → loops[0].id`; `controlTarget` and `metronomeActive` carried over; transport stopped first via `playbackScopeReducer({ type: 'stop-all' })` — which is exactly what `hardStopAll` at `src/store/transportSlice.ts:148-152` dispatches.
- Persisted additions: `currentProjectId: string | null`, `projectBaselineHash: string | null`. Everything else new is transient. The Project Manager open flag lives in `uiSlice` next to `isMidiSettingsOpen` (`src/store/uiSlice.ts:49`).
- Copy strings copied from the spec: `"Open Project Manager"`, `"Unsaved changes"`, `"Unsaved session"`, `"Unnamed project"`, `"Untitled project"`, `"<name> copy"`, `"<name> (imported)"`, `"Current"`, `"Discard"` / `"Cancel"` / `"Save & Continue"`, `"Overwrite"` / `"Import as Copy"` / `"Cancel"`, `"There is not enough storage space to save this project"`, `"This project was saved by a newer version of Solna."`, `"A project with this id already exists."`, `"Export current session"`.
- Tests are `bun:test`, no DOM, no testing-library (`.claude/rules/testing.md`). Components that must reflect test-set store state read it through a `useSyncExternalStore` hook that serves `getState()` for both snapshots, as `src/components/ui/BottomInputDock.tsx:22-30` does.
- Theming (`.claude/rules/theming.md`): role tokens only, no raw colours, no `dark:`; `scripts/themeTokenGuard.ts` runs inside `bun test`. Every daisyUI class below was checked against the v5 docs (`modal`, `modal-box`, `modal-action`, `modal-backdrop`, `dropdown`, `dropdown-end`, `dropdown-content`, `menu`, `indicator`, `indicator-item`, `status`, `status-warning`, `status-sm`, `tooltip` + `data-tip`, `badge`, `btn-ghost`, `btn-error`, `btn-primary`, `input`).

---

## Scope decision

One plan, one branch, thirteen tasks. The subsystems (format, storage, slice, UI) are not independently shippable: the storage module without a slice is dead code, the slice without the format layer cannot build a body, and the UI is the only entry point. Splitting would produce plans that each leave the suite green but ship nothing a user can touch. Tasks are ordered so every task leaves `bun run verify` green and each one can be reviewed and rejected on its own.

## File Structure

**Dependency decision: raw IndexedDB, no `idb` package.** The whole surface is one database, two object stores, five operations, and one key-only cursor; that is ~150 lines of promise wrappers, and the test seam (an in-memory backend behind an interface) is required regardless of which client library is used. Adding `idb` would grow the bundle and the lockfile for nothing the interface does not already give.

Created:

| Path | Responsibility |
| --- | --- |
| `src/store/sanitize.ts` | The persisted-payload guards extracted verbatim from `store.ts` (`sanitizeLoops`, `sanitizeSynthParams`, `sanitizeEffectsValue`, `clampFinite`, and the small `as*`/`is*` helpers) so persist-hydration and project import call one implementation. |
| `src/store/projectFormat.ts` | Format v1 types (`ProjectEnvelope`, `ProjectContent`, `ProjectBody`, `ProjectMeta`), `PROJECT_FORMAT_VERSION`, the pinned key lists, `buildProjectContent`, `applyProjectContent` (the reset rules), `factoryProjectContent`, `newProjectId`. |
| `src/store/projectFormatMigrate.ts` | The `.solna` format migration chain — empty at v1, separate from the persist chain. |
| `src/store/projectFile.ts` | `serializeProject` / `parseProjectFile` (JSON + envelope validation + content sanitisation + unknown-reference warnings). |
| `src/store/projectFingerprint.ts` | `canonicalContent` + `fingerprintContent` (ordered-key serialisation, FNV-1a hash). |
| `src/store/projectStore.ts` | `ProjectStoreBackend` interface, `ProjectStoreResult`, `createProjectStore` (lazy open, degraded mode, typed failures, read-repair), `createMemoryBackend`. |
| `src/store/projectStoreIdb.ts` | `openIndexedDbBackend` — the only file that touches the `indexedDB` global. |
| `src/store/projectSlice.ts` | `ProjectSlice` state + lifecycle actions (new/open/save/saveAs/rename/delete/import/export). |
| `src/store/projectDirty.ts` | `createDirtyTracker` — idle-debounced fingerprint pass that owns the `dirty` boolean. |
| `src/utils/projectFile.ts` | Browser file plumbing: `downloadTextFile`, `readFileAsText`, `slugifyProjectName`, `projectFileName`. |
| `src/utils/relativeTime.ts` | `formatRelativeTime` for list rows. |
| `src/components/ui/useLiveStore.ts` | The `useSyncExternalStore` hook from `BottomInputDock.tsx` lifted into a shared file so the new components are testable under `renderToString`. |
| `src/components/project/projectManagerFlow.ts` | Pure flow helpers: which dialog an action needs (dirty guard, name prompt, import conflict), name defaults and validation. |
| `src/components/project/ProjectDialogs.tsx` | `NamePromptDialog`, `DirtyGuardDialog`, `DeleteConfirmDialog`, `ImportConflictDialog`. |
| `src/components/project/ProjectList.tsx` | The stored-project list: rows with inline rename, relative time, `Current` badge, `Open`, kebab with `Export` / `Delete`, and the empty state. |
| `src/components/project/ProjectManagerModal.tsx` | The modal: session section, import, list, `Export current session`, notices; drives the flow. |

Modified:

| Path | Change |
| --- | --- |
| `src/store/store.ts` | Import the sanitisers from `sanitize.ts`; persist `version: 9`; partialize the two new keys; sanitise them; compose `migrateAddProjectIdentity`; create the `ProjectStore` + slice; create the dirty tracker; run it before the `pagehide` flush. |
| `src/store/migrate.ts` | `migrateAddProjectIdentity`. |
| `src/store/loop.ts` | `resolveActiveLoop` (the `merge` resolution, shared with Open). |
| `src/store/types.ts` | `ProjectSlice` in `AppStore`; two new `PersistedState` keys; `isProjectManagerOpen` in `UiSlice`. |
| `src/store/uiSlice.ts` | `isProjectManagerOpen` + setter. |
| `src/components/ui/Wordmark.tsx` | Becomes a `<button>` with hover/focus affordance, 44px target and dirty badge. |
| `src/components/Header.tsx` | Passes `dirty` and the open handler to `Wordmark`. |
| `src/App.tsx` | Mounts `ProjectManagerModal` next to `MidiSettingsModal`. |

---

### Task 1: Extract the persisted-payload sanitisers into `src/store/sanitize.ts`

The spec (*Error and edge cases*, "Content fields wrong-typed") requires persist-hydration and project import to call **one** sanitiser family. Today it is private to `store.ts`. This task moves it, unchanged, and adds the shared `resolveActiveLoop` helper the spec's reset rule for `activeLoopId` points at.

**Files:**
- Create: `src/store/sanitize.ts`
- Create: `src/store/sanitize.test.ts`
- Modify: `src/store/store.ts:171-343` (the block from `const OSC_TYPES` through the end of `sanitizeLoops`) and `src/store/store.ts:485-501` (`merge`)
- Modify: `src/store/loop.ts` (append `resolveActiveLoop`)
- Test: `src/store/loop.test.ts` (append)

**Interfaces:**
- Consumes: `INITIAL_EFFECTS`, `INITIAL_SYNTH_PARAMS` (`src/store/initialState.ts`), `EFFECT_LIMITS` / `clampEffectValue` (`src/audio/effectLimits.ts`), `createDefaultLoop` (`src/store/loopSlice.ts`), `LEAD_OCTAVE_MIN` / `LEAD_OCTAVE_MAX` (`src/store/leadSlice.ts`).
- Produces (all exported from `src/store/sanitize.ts`, bodies byte-identical to the ones in `store.ts` today):
  - `sanitizeSynthParams(value: unknown): SynthParams`
  - `sanitizeEffectsValue(effects: unknown): unknown`
  - `sanitizeLoops(value: unknown): Loop[] | undefined`
  - `clampFinite(value: unknown, min: number, max: number, fallback: number): number`
  - `asBoolean(value: unknown): boolean`, `asString(value: unknown, fallback: string): string`, `asArray<T>(value: unknown, fallback: T[]): T[]`
  - `isPatternMode`, `asPatternMode`, `asFilterType`, `isPositiveInteger`, `asPositiveInteger`, `isStringMatrix`, `FILTER_TYPES`
  - `resolveActiveLoop(loops: readonly Loop[], activeId: string | null | undefined): Loop` from `src/store/loop.ts`.

- [ ] **Step 1: Write the failing tests**

`src/store/sanitize.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { clampFinite, sanitizeEffectsValue, sanitizeLoops, sanitizeSynthParams } from './sanitize';
import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { createDefaultLoop } from './loopSlice';

describe('sanitize (shared by persist hydration and project import)', () => {
  test('clampFinite rejects NaN, strings and out-of-range numbers', () => {
    expect(clampFinite('fast', 20, 300, 120)).toBe(120);
    expect(clampFinite(Number.NaN, 20, 300, 120)).toBe(120);
    expect(clampFinite(999, 20, 300, 120)).toBe(300);
    expect(clampFinite(90, 20, 300, 120)).toBe(90);
  });

  test('sanitizeSynthParams keeps a valid value and falls back per field', () => {
    const out = sanitizeSynthParams({ ...INITIAL_SYNTH_PARAMS, cutoff: 'loud', oscType: 'sawtooth' });
    expect(out.cutoff).toBe(INITIAL_SYNTH_PARAMS.cutoff);
    expect(out.oscType).toBe('sawtooth');
  });

  test('sanitizeEffectsValue clones the shared default instead of returning it', () => {
    const out = sanitizeEffectsValue('nope');
    expect(out).toEqual(INITIAL_EFFECTS);
    expect(out).not.toBe(INITIAL_EFFECTS);
  });

  test('sanitizeLoops drops non-object rows and returns undefined when nothing survives', () => {
    expect(sanitizeLoops([null, 7, 'x'])).toBeUndefined();
    expect(sanitizeLoops('loops')).toBeUndefined();
  });

  test('sanitizeLoops keeps an unknown soundKit / pattern id verbatim', () => {
    const loop = { ...createDefaultLoop(), soundKit: 'Kit From The Future', bassPatternId: 'bp-ghost' };
    const [out] = sanitizeLoops([loop]) ?? [];
    expect(out.soundKit).toBe('Kit From The Future');
    expect(out.bassPatternId).toBe('bp-ghost');
  });
});
```

Append to `src/store/loop.test.ts`:

```ts
import { resolveActiveLoop } from './loop';

describe('resolveActiveLoop', () => {
  const loops = [
    { ...createDefaultLoop(), id: 'a' },
    { ...createDefaultLoop(), id: 'b' },
  ];
  test('returns the loop named by activeId when it exists', () => {
    expect(resolveActiveLoop(loops, 'b').id).toBe('b');
  });
  test('falls back to loops[0] for a foreign id, null or undefined', () => {
    expect(resolveActiveLoop(loops, 'zzz').id).toBe('a');
    expect(resolveActiveLoop(loops, null).id).toBe('a');
    expect(resolveActiveLoop(loops, undefined).id).toBe('a');
  });
});
```

(`loop.test.ts` already imports `describe`/`expect`/`test`; add `import { createDefaultLoop } from './loopSlice';` if it is not there yet.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/sanitize.test.ts src/store/loop.test.ts`
Expected: FAIL — `Cannot find module './sanitize'` and `resolveActiveLoop is not a function`.

- [ ] **Step 3: Create `src/store/sanitize.ts` by moving the code**

Cut `src/store/store.ts:171-343` — everything from `const OSC_TYPES = new Set([...])` through the closing brace of `function sanitizeLoops` — into the new file, keeping the doc comments, and export every function and `FILTER_TYPES`. The file header:

```ts
import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
import type { SynthParams, ChordItem, SequencerTrack, FilterType } from '../types';
import type { BassStepChoice } from '../audio/bassPatterns';
import { createDefaultLoop } from './loopSlice';
import { LEAD_OCTAVE_MAX, LEAD_OCTAVE_MIN } from './leadSlice';
import type { Loop } from './types';

// Type-guards for a parsed persisted payload AND for a parsed `.solna` file.
// Wrong-typed values survive JSON.parse and would flow straight into engine
// setters (`bpm: "fast"` -> NaN clock, a string volume -> setTargetAtTime(NaN)),
// so both readers go through this one module — see projectFile.ts.
const OSC_TYPES = new Set(['sawtooth', 'square', 'sine', 'triangle']);
export const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);
// ... (moved bodies, each prefixed with `export`)
```

In `store.ts`, replace the removed block with:

```ts
import {
  sanitizeSynthParams,
  sanitizeEffectsValue,
  sanitizeLoops,
  clampFinite,
  asBoolean,
  asString,
  isPatternMode,
  asFilterType,
  isPositiveInteger,
  isStringMatrix,
} from './sanitize';
```

and delete the now-unused imports (`INITIAL_EFFECTS`, `INITIAL_SYNTH_PARAMS`, `EFFECT_LIMITS`, `clampEffectValue`, `EffectNumericKey`, `SynthParams`, `ChordItem`, `SequencerTrack`, `FilterType`, `BassStepChoice`, `LEAD_OCTAVE_MAX`, `LEAD_OCTAVE_MIN`) — keep `createDefaultLoop` only if `store.ts` still references it after the move (it does not; `sanitizeLoops` was the only caller). `sanitizePersistedState` stays in `store.ts` untouched.

- [ ] **Step 4: Add `resolveActiveLoop` to `src/store/loop.ts` and use it in `merge`**

Append to `src/store/loop.ts`:

```ts
/**
 * The loop the flat slices should show: `activeId` when it names a loop, else
 * the first one. This is the resolution persist `merge` uses on rehydrate and
 * the resolution project Open uses — one function so the two can never drift.
 */
export function resolveActiveLoop(loops: readonly Loop[], activeId: string | null | undefined): Loop {
  return loops.find((l) => l.id === activeId) ?? loops[0];
}
```

In `store.ts` `merge` (`src/store/store.ts:494-500`), replace

```ts
          const activeId =
            typeof sanitized.activeLoopId === 'string' ? sanitized.activeLoopId : loops[0].id;
          const active = loops.find((l) => l.id === activeId) ?? loops[0];
```

with

```ts
          const active = resolveActiveLoop(
            loops,
            typeof sanitized.activeLoopId === 'string' ? sanitized.activeLoopId : null,
          );
```

and extend the existing import: `import { loopStatePatch, resolveActiveLoop } from './loop';`.

- [ ] **Step 5: Run the tests and the type-check**

Run: `bun test src/store/sanitize.test.ts src/store/loop.test.ts src/store/store.test.ts && bun run lint && bun run eslint`
Expected: PASS, no unused-import errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/sanitize.ts src/store/sanitize.test.ts src/store/store.ts src/store/loop.ts src/store/loop.test.ts
git commit -m "refactor(store): extract the persisted-payload sanitisers into their own module"
```

---

### Task 2: Project format v1 — types, content builder, reset rules

**Files:**
- Create: `src/store/projectFormat.ts`
- Create: `src/store/projectFormat.test.ts`

**Interfaces:**
- Consumes: `LOOP_FLAT_KEYS`, `loopStatePatch`, `resolveActiveLoop` (`src/store/loop.ts`), `createDefaultLoop` (`src/store/loopSlice.ts`), `INITIAL_EFFECTS` (`src/store/initialState.ts`), `DEFAULT_METER_ID` (`src/utils/meter.ts`), `Loop` (`src/store/types.ts`).
- Produces:
  - `PROJECT_FORMAT_VERSION = 1`
  - `interface ProjectEnvelope { formatVersion: number; id: string; name: string; createdAt: number; updatedAt: number }`
  - `type ProjectMeta = ProjectEnvelope`
  - `interface ProjectContent { bpm: number; meterId: MeterId; masterVolume: number; effects: MasterEffects; loops: Loop[] }`
  - `interface ProjectBody extends ProjectEnvelope { content: ProjectContent }`
  - `PROJECT_CONTENT_KEYS = ['bpm', 'meterId', 'masterVolume', 'effects', 'loops'] as const`
  - `PROJECT_LOOP_KEYS = ['id', 'name', 'repeatCount', ...LOOP_FLAT_KEYS] as const`
  - `type ProjectContentSource = Pick<AppStore, 'bpm' | 'meterId' | 'masterVolume' | 'effects' | 'loops'>`
  - `buildProjectContent(state: ProjectContentSource): ProjectContent`
  - `type ProjectOpenPatch = ProjectContent & LoopStatePatch & { activeLoopId: string; selectedVibeId: null }`
  - `applyProjectContent(content: ProjectContent): ProjectOpenPatch`
  - `factoryProjectContent(): ProjectContent`
  - `newProjectId(): string`
  - `makeEnvelope(name: string, now: number): ProjectEnvelope` (new id, `createdAt = updatedAt = now`)

- [ ] **Step 1: Write the failing tests**

`src/store/projectFormat.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  PROJECT_CONTENT_KEYS,
  PROJECT_LOOP_KEYS,
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
} from './projectFormat';
import { LOOP_FLAT_KEYS } from './loop';
import { createDefaultLoop } from './loopSlice';
import { INITIAL_EFFECTS } from './initialState';
import type { Loop } from './types';

// A Loop literal typed against the interface: adding a field to `Loop`
// without listing it in PROJECT_LOOP_KEYS fails the pinned test below.
const loopA: Loop = { ...createDefaultLoop(), id: 'loop-a', name: 'A' };
const loopB: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'B', bpm: undefined } as Loop;

const liveState = {
  bpm: 97,
  meterId: '6/8' as const,
  masterVolume: 0.6,
  effects: { ...INITIAL_EFFECTS, reverbWet: 0.4 },
  loops: [loopA, loopB],
  // excluded keys, present on purpose
  controlTarget: 'bass',
  activeLoopId: 'loop-b',
  metronomeActive: true,
  selectedVibeId: 'cyber-dance',
  customSynthPresets: [{ id: 'p' }],
  customChordProgressions: [{ id: 'c' }],
};

describe('buildProjectContent', () => {
  test('carries every content key and nothing else', () => {
    const content = buildProjectContent(liveState as never);
    expect(Object.keys(content).sort()).toEqual([...PROJECT_CONTENT_KEYS].sort());
    expect(content.bpm).toBe(97);
    expect(content.loops).toHaveLength(2);
  });

  test('excluded keys are ABSENT from the output (catches a stray ...state spread)', () => {
    const content = buildProjectContent(liveState as never) as Record<string, unknown>;
    for (const key of [
      'controlTarget',
      'activeLoopId',
      'metronomeActive',
      'selectedVibeId',
      'customSynthPresets',
      'customChordProgressions',
    ]) {
      expect(key in content).toBe(false);
    }
  });
});

describe('pinned key sets', () => {
  test('the per-loop content keys are exactly LOOP_FLAT_KEYS + id + name + repeatCount', () => {
    expect([...PROJECT_LOOP_KEYS].sort()).toEqual(
      [...LOOP_FLAT_KEYS, 'id', 'name', 'repeatCount'].sort(),
    );
    // Every key of a real Loop is listed, and every listed key is on a real Loop.
    const keysOnLoop = Object.keys(createDefaultLoop()).sort();
    expect(keysOnLoop).toEqual([...PROJECT_LOOP_KEYS].sort());
  });
});

describe('applyProjectContent (the reset rules)', () => {
  test('resets selectedVibeId and points activeLoopId at loops[0]', () => {
    const patch = applyProjectContent(buildProjectContent(liveState as never));
    expect(patch.selectedVibeId).toBeNull();
    expect(patch.activeLoopId).toBe('loop-a');
  });

  test('installs loops[0] into the flat per-loop keys in the same patch', () => {
    const patch = applyProjectContent(buildProjectContent(liveState as never)) as Record<string, unknown>;
    for (const key of LOOP_FLAT_KEYS) {
      expect(patch[key]).toEqual((loopA as unknown as Record<string, unknown>)[key]);
    }
  });

  test('never touches controlTarget or metronomeActive', () => {
    const patch = applyProjectContent(buildProjectContent(liveState as never)) as Record<string, unknown>;
    expect('controlTarget' in patch).toBe(false);
    expect('metronomeActive' in patch).toBe(false);
  });
});

describe('provenance is preserved verbatim', () => {
  test('unknown preset names, pattern ids and kit names round-trip byte-identical', () => {
    const ghost: Loop = {
      ...createDefaultLoop(),
      id: 'g',
      synthParams: { ...createDefaultLoop().synthParams, preset: 'Ghost Lead' },
      chordSynthParams: { ...createDefaultLoop().chordSynthParams, preset: 'Ghost Pad' },
      bassSynthParams: { ...createDefaultLoop().bassSynthParams, preset: 'Ghost Bass' },
      chordRhythmId: 'rhythm-that-does-not-exist',
      bassPatternId: 'bass-that-does-not-exist',
      soundKit: 'Kit From The Future',
    };
    const content = buildProjectContent({ ...liveState, loops: [ghost] } as never);
    const patch = applyProjectContent(content);
    expect(patch.synthParams.preset).toBe('Ghost Lead');
    expect(patch.chordSynthParams.preset).toBe('Ghost Pad');
    expect(patch.bassSynthParams.preset).toBe('Ghost Bass');
    expect(patch.chordRhythmId).toBe('rhythm-that-does-not-exist');
    expect(patch.bassPatternId).toBe('bass-that-does-not-exist');
    expect(patch.soundKit).toBe('Kit From The Future');
  });
});

describe('factoryProjectContent / makeEnvelope', () => {
  test('factory content is the store defaults with one default loop', () => {
    const c = factoryProjectContent();
    expect(c.bpm).toBe(120);
    expect(c.meterId).toBe('4/4');
    expect(c.masterVolume).toBe(0.85);
    expect(c.effects).toEqual(INITIAL_EFFECTS);
    expect(c.effects).not.toBe(INITIAL_EFFECTS);
    expect(c.loops).toHaveLength(1);
  });

  test('makeEnvelope mints a fresh id per call and stamps both timestamps', () => {
    const a = makeEnvelope('One', 1000);
    const b = makeEnvelope('One', 1000);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ formatVersion: 1, name: 'One', createdAt: 1000, updatedAt: 1000 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectFormat.test.ts`
Expected: FAIL — `Cannot find module './projectFormat'`.

- [ ] **Step 3: Write `src/store/projectFormat.ts`**

```ts
import type { MasterEffects } from '../types';
import type { MeterId } from '../utils/meter';
import { DEFAULT_METER_ID } from '../utils/meter';
import { INITIAL_EFFECTS } from './initialState';
import { LOOP_FLAT_KEYS, loopStatePatch, resolveActiveLoop } from './loop';
import { createDefaultLoop } from './loopSlice';
import type { AppStore, Loop, LoopStatePatch } from './types';

/**
 * The `.solna` / IndexedDB format version. Deliberately separate from the
 * persist `version` in store.ts: that one bumps for private localStorage
 * reshapes, this one only when the content contract changes. The persist
 * migration chain must never be used to read a project body.
 */
export const PROJECT_FORMAT_VERSION = 1;

export interface ProjectEnvelope {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** What a list row renders — the envelope and nothing else. */
export type ProjectMeta = ProjectEnvelope;

export interface ProjectContent {
  bpm: number;
  meterId: MeterId;
  masterVolume: number;
  effects: MasterEffects;
  loops: Loop[];
}

export interface ProjectBody extends ProjectEnvelope {
  content: ProjectContent;
}

/** The content set, in file order. The fingerprint serialises in this order. */
export const PROJECT_CONTENT_KEYS = ['bpm', 'meterId', 'masterVolume', 'effects', 'loops'] as const;

/**
 * Every field of a Loop, in fingerprint order. Derived from LOOP_FLAT_KEYS so
 * a new per-loop field is picked up automatically — and pinned by a test so
 * adding one is a conscious decision about whether it belongs in a project.
 */
export const PROJECT_LOOP_KEYS = ['id', 'name', 'repeatCount', ...LOOP_FLAT_KEYS] as const;

export type ProjectContentSource = Pick<AppStore, 'bpm' | 'meterId' | 'masterVolume' | 'effects' | 'loops'>;

/**
 * Picks the content set off the live store. Explicit property list, never a
 * spread: the excluded view/session/library keys must not leak into a file.
 */
export function buildProjectContent(state: ProjectContentSource): ProjectContent {
  return {
    bpm: state.bpm,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    effects: state.effects,
    loops: state.loops,
  };
}

export type ProjectOpenPatch = ProjectContent &
  LoopStatePatch & { activeLoopId: string; selectedVibeId: null };

/**
 * The single store patch that installs a project. Encodes the reset rules:
 * `selectedVibeId` -> null (a project has no vibe until a chip is pressed),
 * `activeLoopId` -> loops[0] through the same resolution persist `merge`
 * uses, and the flat per-loop keys written through loopStatePatch in the SAME
 * patch — writing `loops` without them would leave the previous project's
 * sound on screen and in the engine. `controlTarget` and `metronomeActive`
 * are deliberately absent: they are user preferences, not project state.
 */
export function applyProjectContent(content: ProjectContent): ProjectOpenPatch {
  const active = resolveActiveLoop(content.loops, null);
  return {
    ...content,
    ...loopStatePatch(active),
    activeLoopId: active.id,
    selectedVibeId: null,
  };
}

/** The content of a brand-new project: store defaults plus one default loop. */
export function factoryProjectContent(): ProjectContent {
  return {
    bpm: 120,
    meterId: DEFAULT_METER_ID,
    masterVolume: 0.85,
    effects: { ...INITIAL_EFFECTS },
    loops: [createDefaultLoop()],
  };
}

/** Same style as newLoopId / presetsSlice ids: unique per device, no crypto needed. */
export function newProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export function makeEnvelope(name: string, now: number): ProjectEnvelope {
  return { formatVersion: PROJECT_FORMAT_VERSION, id: newProjectId(), name, createdAt: now, updatedAt: now };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectFormat.test.ts && bun run lint`
Expected: PASS. (`loopB`'s `bpm: undefined` cast is there only to prove the pinned test uses a real `Loop` literal; if `tsc` rejects the excess property, drop that field from the literal — the test does not depend on it.)

- [ ] **Step 5: Commit**

```bash
git add src/store/projectFormat.ts src/store/projectFormat.test.ts
git commit -m "feat(project): define the v1 project format and the open reset rules"
```

---

### Task 3: `.solna` serialisation, validation and the format migration chain

**Files:**
- Create: `src/store/projectFormatMigrate.ts`
- Create: `src/store/projectFile.ts`
- Create: `src/store/projectFile.test.ts`

**Interfaces:**
- Consumes: Task 2 types; `sanitizeLoops`, `sanitizeEffectsValue`, `clampFinite` (`src/store/sanitize.ts`); `isMeterId`, `DEFAULT_METER_ID` (`src/utils/meter.ts`); `createDefaultLoop`; `RHYTHM_PATTERNS` (`src/audio/rhythmPatterns.ts:68`), `BASS_PATTERNS` (`src/audio/bassPatterns.ts:175`), `DRUM_KITS` (`src/audio/drumKits.ts:72`), `FACTORY_SYNTH_PRESETS`-style tables are **not** consulted for `preset` (labels only — spec *Library provenance*).
- Produces:
  - `migrateProjectBody(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown>` (`projectFormatMigrate.ts`) — identity at v1.
  - `serializeProject(body: ProjectBody): string`
  - `type ProjectParseResult = { ok: true; body: ProjectBody; warnings: string[] } | { ok: false; error: 'malformed' | 'newer-version'; message: string }`
  - `parseProjectFile(text: string): ProjectParseResult`
  - `unknownLibraryReferences(content: ProjectContent): string[]`
  - `PROJECT_FILE_MIME = 'application/json'`, `PROJECT_FILE_EXTENSION = '.solna'`, `PROJECT_FILE_ACCEPT = '.solna,.json'`

- [ ] **Step 1: Write the failing tests**

`src/store/projectFile.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { parseProjectFile, serializeProject, unknownLibraryReferences } from './projectFile';
import { migrateProjectBody } from './projectFormatMigrate';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { LOOP_FLAT_KEYS } from './loop';

const body = { ...makeEnvelope('Round Trip', 1_700_000_000_000), content: factoryProjectContent() };

describe('serializeProject / parseProjectFile round trip', () => {
  test('every envelope field and every content key survives', () => {
    const result = parseProjectFile(serializeProject(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.id).toBe(body.id);
    expect(result.body.name).toBe('Round Trip');
    expect(result.body.createdAt).toBe(body.createdAt);
    expect(result.body.updatedAt).toBe(body.updatedAt);
    expect(result.body.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(result.body.content.bpm).toBe(120);
    expect(result.body.content.loops).toHaveLength(1);
    for (const key of LOOP_FLAT_KEYS) {
      expect(result.body.content.loops[0][key]).toEqual(body.content.loops[0][key]);
    }
    expect(result.warnings).toEqual([]);
  });

  test('the file is plain JSON a text editor can read', () => {
    expect(JSON.parse(serializeProject(body)).content.bpm).toBe(120);
  });
});

describe('parseProjectFile rejections (table-driven)', () => {
  const cases: Array<[string, string, 'malformed' | 'newer-version']> = [
    ['bad JSON', '{ not json', 'malformed'],
    ['empty file', '', 'malformed'],
    ['array root', '[]', 'malformed'],
    ['null root', 'null', 'malformed'],
    ['missing id', JSON.stringify({ ...body, id: undefined }), 'malformed'],
    ['numeric name', JSON.stringify({ ...body, name: 7 }), 'malformed'],
    ['string createdAt', JSON.stringify({ ...body, createdAt: 'yesterday' }), 'malformed'],
    ['missing content', JSON.stringify({ ...body, content: undefined }), 'malformed'],
    ['formatVersion missing', JSON.stringify({ ...body, formatVersion: undefined }), 'malformed'],
    ['formatVersion from the future', JSON.stringify({ ...body, formatVersion: PROJECT_FORMAT_VERSION + 1 }), 'newer-version'],
  ];
  for (const [label, text, error] of cases) {
    test(label, () => {
      const result = parseProjectFile(text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(error);
      expect(result.message.length).toBeGreaterThan(0);
    });
  }

  test('the newer-version message is the spec copy', () => {
    const result = parseProjectFile(JSON.stringify({ ...body, formatVersion: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('This project was saved by a newer version of Solna.');
  });
});

describe('parseProjectFile sanitises wrong-typed content instead of refusing', () => {
  test('bpm string, effects string, loops string all fall back', () => {
    const text = JSON.stringify({ ...body, content: { bpm: 'fast', effects: 'wet', loops: 'many' } });
    const result = parseProjectFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.bpm).toBe(120);
    expect(result.body.content.masterVolume).toBe(0.85);
    expect(result.body.content.meterId).toBe('4/4');
    expect(result.body.content.effects.reverbWet).toBeTypeOf('number');
    expect(result.body.content.loops).toHaveLength(1);
  });

  test('an empty loops array becomes one default loop', () => {
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [] } }));
    expect(result.ok && result.body.content.loops).toHaveLength(1);
  });

  test('unknown soundKit / bassPatternId / chordRhythmId import successfully, verbatim, with a warning', () => {
    const loop = {
      ...createDefaultLoop(),
      soundKit: 'Kit From The Future',
      bassPatternId: 'bp-ghost',
      chordRhythmId: 'cr-ghost',
    };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.loops[0].soundKit).toBe('Kit From The Future');
    expect(result.body.content.loops[0].bassPatternId).toBe('bp-ghost');
    expect(result.body.content.loops[0].chordRhythmId).toBe('cr-ghost');
    expect(result.warnings).toHaveLength(3);
  });
});

describe('unknownLibraryReferences', () => {
  test('is empty for factory content and lists each unknown id once', () => {
    expect(unknownLibraryReferences(factoryProjectContent())).toEqual([]);
    const content = factoryProjectContent();
    content.loops = [
      { ...createDefaultLoop(), id: 'x', soundKit: 'Nope' },
      { ...createDefaultLoop(), id: 'y', soundKit: 'Nope' },
    ];
    expect(unknownLibraryReferences(content)).toEqual(['drum kit "Nope"']);
  });
});

describe('migrateProjectBody', () => {
  test('is the identity at v1 and does not mutate its input', () => {
    const raw = { formatVersion: 1, id: 'a' };
    const out = migrateProjectBody(raw, 1);
    expect(out).toEqual(raw);
    expect(out).not.toBe(raw);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectFile.test.ts`
Expected: FAIL — `Cannot find module './projectFile'`.

- [ ] **Step 3: Write `src/store/projectFormatMigrate.ts`**

```ts
/**
 * The `.solna` format migration chain. Separate from the persist chain in
 * store.ts on purpose (see projectFormat.ts): a project file is an external
 * contract, the persist payload is private. Empty at v1 — the structure exists
 * so adding v2 does not mean inventing it under pressure.
 *
 * Each step must be pure and a no-op on an already-current payload. Add steps
 * as `if (fromVersion < 2) next = addSomething(next);` in version order.
 */
export function migrateProjectBody(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  void fromVersion; // no steps yet
  return { ...raw };
}
```

- [ ] **Step 4: Write `src/store/projectFile.ts`**

```ts
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { DRUM_KITS } from '../audio/drumKits';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import type { MasterEffects } from '../types';
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { createDefaultLoop } from './loopSlice';
import { PROJECT_FORMAT_VERSION, type ProjectBody, type ProjectContent } from './projectFormat';
import { migrateProjectBody } from './projectFormatMigrate';
import { clampFinite, sanitizeEffectsValue, sanitizeLoops } from './sanitize';

export const PROJECT_FILE_MIME = 'application/json';
export const PROJECT_FILE_EXTENSION = '.solna';
/** `.json` too: some mobile file providers rewrite an unknown extension. */
export const PROJECT_FILE_ACCEPT = '.solna,.json';

export const NEWER_VERSION_MESSAGE = 'This project was saved by a newer version of Solna.';
export const MALFORMED_MESSAGE = 'This file is not a Solna project.';

export type ProjectParseResult =
  | { ok: true; body: ProjectBody; warnings: string[] }
  | { ok: false; error: 'malformed' | 'newer-version'; message: string };

/** Plain JSON, pretty-printed so the file stays readable in a text editor. */
export function serializeProject(body: ProjectBody): string {
  return JSON.stringify(body, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const malformed = (): ProjectParseResult => ({ ok: false, error: 'malformed', message: MALFORMED_MESSAGE });

/**
 * Content goes through the SAME guards persist hydration uses (sanitize.ts):
 * a wrong-typed field falls back, an empty or invalid loops array becomes one
 * default loop, and unknown library ids are kept verbatim.
 */
function sanitizeContent(raw: unknown): ProjectContent {
  const c = isPlainObject(raw) ? raw : {};
  return {
    bpm: clampFinite(c.bpm, 20, 300, 120),
    meterId: isMeterId(c.meterId) ? c.meterId : DEFAULT_METER_ID,
    masterVolume: clampFinite(c.masterVolume, 0, 1, 0.85),
    effects: sanitizeEffectsValue(c.effects) as MasterEffects,
    loops: sanitizeLoops(c.loops) ?? [createDefaultLoop()],
  };
}

/**
 * Soft references a loop carries by id or name. The file is still valid when
 * one is unknown — the resolution paths already degrade (RHYTHM_PATTERNS[0],
 * BASS_PATTERNS[0], the default kit) — so this only names them for a notice.
 * SynthParams.preset is a label nobody resolves and is not checked.
 */
export function unknownLibraryReferences(content: ProjectContent): string[] {
  const rhythmIds = new Set(RHYTHM_PATTERNS.map((p) => p.id));
  const bassIds = new Set(BASS_PATTERNS.map((p) => p.id));
  const found = new Set<string>();
  for (const loop of content.loops) {
    if (!rhythmIds.has(loop.chordRhythmId)) found.add(`chord rhythm "${loop.chordRhythmId}"`);
    if (!bassIds.has(loop.bassPatternId)) found.add(`bass pattern "${loop.bassPatternId}"`);
    if (!(loop.soundKit in DRUM_KITS)) found.add(`drum kit "${loop.soundKit}"`);
  }
  return [...found];
}

/**
 * Whole-file validation. Envelope problems refuse the import outright; a
 * newer formatVersion is refused without a best-effort read; an older one runs
 * the format migration chain; content is sanitised, never refused.
 */
export function parseProjectFile(text: string): ProjectParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed();
  }
  if (!isPlainObject(parsed)) return malformed();
  if (!isFiniteNumber(parsed.formatVersion) || !Number.isInteger(parsed.formatVersion) || parsed.formatVersion < 1) {
    return malformed();
  }
  if (parsed.formatVersion > PROJECT_FORMAT_VERSION) {
    return { ok: false, error: 'newer-version', message: NEWER_VERSION_MESSAGE };
  }
  const raw = parsed.formatVersion < PROJECT_FORMAT_VERSION
    ? migrateProjectBody(parsed, parsed.formatVersion)
    : parsed;

  if (typeof raw.id !== 'string' || raw.id.length === 0) return malformed();
  if (typeof raw.name !== 'string') return malformed();
  if (!isFiniteNumber(raw.createdAt) || !isFiniteNumber(raw.updatedAt)) return malformed();
  if (!isPlainObject(raw.content)) return malformed();

  const content = sanitizeContent(raw.content);
  return {
    ok: true,
    body: {
      formatVersion: PROJECT_FORMAT_VERSION,
      id: raw.id,
      name: raw.name,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      content,
    },
    warnings: unknownLibraryReferences(content),
  };
}
```

Check the id field names against the tables before relying on them: `RHYTHM_PATTERNS` rows carry `id` (`src/audio/rhythmPatterns.ts:70`), `BASS_PATTERNS` rows carry `id` (`src/audio/bassPatterns.ts:30`), `DRUM_KITS` is a `Record<string, Partial<DrumKit>>` keyed by kit name (`src/audio/drumKits.ts:72`).

- [ ] **Step 5: Run the tests, type-check and eslint (new imports from `audio/`)**

Run: `bun test src/store/projectFile.test.ts && bun run lint && bun run eslint`
Expected: PASS. `store/` importing `audio/` tables is allowed by the layering rules (only `audio/` → `store/` is forbidden).

- [ ] **Step 6: Commit**

```bash
git add src/store/projectFormatMigrate.ts src/store/projectFile.ts src/store/projectFile.test.ts
git commit -m "feat(project): serialise, validate and migrate .solna files"
```

---

### Task 4: Content fingerprint for dirty detection

**Files:**
- Create: `src/store/projectFingerprint.ts`
- Create: `src/store/projectFingerprint.test.ts`

**Interfaces:**
- Consumes: `PROJECT_CONTENT_KEYS`, `PROJECT_LOOP_KEYS`, `ProjectContent` (Task 2).
- Produces:
  - `canonicalContent(content: ProjectContent): string` — ordered-key serialisation.
  - `fingerprintContent(content: ProjectContent): string` — short hex token.
  - `defaultContentFingerprint(): string` — the fingerprint of `factoryProjectContent()` (memoised); the comparison target for an **untitled** session.
  - `isContentDirty(content: ProjectContent, currentProjectId: string | null, projectBaselineHash: string | null, fingerprint?: (c: ProjectContent) => string): boolean` — the one dirty rule, shared by the slice (Task 7) and the tracker (Task 8).

**The dirty rule.** With a `currentProjectId`, the target is `projectBaselineHash` (taken on open / save). With none — an untitled session — the target is `defaultContentFingerprint()`, and `projectBaselineHash` stays `null`. A saved id with a `null` baseline cannot be produced by any action here and is treated as dirty (conservative). *Why not seed a baseline from whatever is on screen:* a seeded baseline lets Import silently replace unsaved pre-upgrade work, because the session looks clean and the dirty guard never fires.

- [ ] **Step 1: Write the failing test**

`src/store/projectFingerprint.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { canonicalContent, defaultContentFingerprint, fingerprintContent, isContentDirty } from './projectFingerprint';
import { factoryProjectContent } from './projectFormat';
import { createDefaultLoop } from './loopSlice';

/** Rebuilds an object with its keys in reverse insertion order, recursively. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      out[key] = reversedKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

describe('fingerprintContent', () => {
  test('is stable across key insertion order, including nested objects', () => {
    const a = factoryProjectContent();
    const b = reversedKeys(a);
    expect(Object.keys(b)[0]).not.toBe(Object.keys(a)[0]); // the reorder really happened
    expect(fingerprintContent(a)).toBe(fingerprintContent(b));
    expect(canonicalContent(a)).toBe(canonicalContent(b));
  });

  test('changes when any content field changes', () => {
    const base = factoryProjectContent();
    const baseline = fingerprintContent(base);
    expect(fingerprintContent({ ...base, bpm: 121 })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, meterId: '3/4' })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, masterVolume: 0.5 })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, effects: { ...base.effects, reverbWet: 0.99 } })).not.toBe(baseline);
    const loop = { ...createDefaultLoop(), chordFeel: 0.77 };
    expect(fingerprintContent({ ...base, loops: [loop] })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, loops: [createDefaultLoop(), createDefaultLoop()] })).not.toBe(baseline);
  });

  test('ignores keys outside the content set even when they are present', () => {
    const base = factoryProjectContent();
    const withExtras = { ...base, selectedVibeId: 'cyber-dance', controlTarget: 'bass', activeLoopId: 'zzz' };
    expect(fingerprintContent(withExtras as never)).toBe(fingerprintContent(base));
  });

  test('is a short token, not a copy of the content', () => {
    expect(fingerprintContent(factoryProjectContent()).length).toBeLessThan(32);
  });
});

describe('defaultContentFingerprint / isContentDirty', () => {
  test('the default fingerprint is the fingerprint of the factory content, and is stable across calls', () => {
    expect(defaultContentFingerprint()).toBe(fingerprintContent(factoryProjectContent()));
    expect(defaultContentFingerprint()).toBe(defaultContentFingerprint());
  });

  test('an untitled session is clean only while it equals the default project', () => {
    const base = factoryProjectContent();
    expect(isContentDirty(base, null, null)).toBe(false);
    expect(isContentDirty({ ...base, bpm: 121 }, null, null)).toBe(true);
    expect(isContentDirty({ ...base, loops: [createDefaultLoop(), createDefaultLoop()] }, null, null)).toBe(true);
  });

  test('an untitled session ignores any stray baseline hash', () => {
    const base = factoryProjectContent();
    expect(isContentDirty(base, null, 'stale-hash')).toBe(false);
  });

  test('a saved project compares against its baseline', () => {
    const base = factoryProjectContent();
    const changed = { ...base, bpm: 121 };
    expect(isContentDirty(changed, 'p-1', fingerprintContent(changed))).toBe(false);
    expect(isContentDirty(changed, 'p-1', fingerprintContent(base))).toBe(true);
  });

  test('a saved project with no baseline is treated as dirty', () => {
    expect(isContentDirty(factoryProjectContent(), 'p-1', null)).toBe(true);
  });

  test('the injected fingerprint is used for the content, so a spy can count computations', () => {
    let calls = 0;
    isContentDirty(factoryProjectContent(), 'p-1', 'x', (c) => { calls++; return fingerprintContent(c); });
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectFingerprint.test.ts`
Expected: FAIL — `Cannot find module './projectFingerprint'`.

- [ ] **Step 3: Write `src/store/projectFingerprint.ts`**

```ts
import { PROJECT_CONTENT_KEYS, PROJECT_LOOP_KEYS, factoryProjectContent, type ProjectContent } from './projectFormat';

/** JSON with object keys sorted at every level, so insertion order cannot leak in. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/**
 * The content set serialised through the explicit key orders in
 * projectFormat.ts — PROJECT_CONTENT_KEYS at the top level and
 * PROJECT_LOOP_KEYS inside each loop — with every nested object sorted. Keys
 * outside the content set are never read, so excluded state cannot dirty it.
 */
export function canonicalContent(content: ProjectContent): string {
  const source = content as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of PROJECT_CONTENT_KEYS) {
    if (key === 'loops') {
      const loops = content.loops.map((loop) => {
        const row = loop as unknown as Record<string, unknown>;
        return PROJECT_LOOP_KEYS.map((k) => stableStringify(row[k])).join(',');
      });
      parts.push(`[${loops.join('|')}]`);
    } else {
      parts.push(stableStringify(source[key]));
    }
  }
  return parts.join(';');
}

/** FNV-1a 32-bit over the canonical string, plus its length, as hex. */
export function fingerprintContent(content: ProjectContent): string {
  const text = canonicalContent(content);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}

let defaultFingerprint: string | null = null;

/**
 * The fingerprint of a brand-new project — the comparison target for an
 * untitled session. factoryProjectContent() is the same values the slices
 * start from (transportSlice bpm/meter/masterVolume, effectsSlice
 * INITIAL_EFFECTS, loopSlice [createDefaultLoop()]), so a fresh launch is
 * clean by construction. Computed once; the factory content never changes.
 */
export function defaultContentFingerprint(): string {
  defaultFingerprint ??= fingerprintContent(factoryProjectContent());
  return defaultFingerprint;
}

/**
 * The one dirty rule. Untitled session (no currentProjectId): dirty when the
 * content differs from the default project — the baseline hash is ignored and
 * stays null. Saved project: dirty when the content differs from the baseline
 * taken on open / save; a missing baseline is treated as dirty, never clean.
 *
 * Never seed a baseline from whatever is on screen: that made an untitled
 * session look clean, so Import could silently replace unsaved work because
 * the dirty guard never fired.
 */
export function isContentDirty(
  content: ProjectContent,
  currentProjectId: string | null,
  projectBaselineHash: string | null,
  fingerprint: (c: ProjectContent) => string = fingerprintContent,
): boolean {
  const hash = fingerprint(content);
  if (currentProjectId === null) return hash !== defaultContentFingerprint();
  if (projectBaselineHash === null) return true;
  return hash !== projectBaselineHash;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectFingerprint.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectFingerprint.ts src/store/projectFingerprint.test.ts
git commit -m "feat(project): fingerprint the content set and define the dirty rule"
```

---

### Task 5: The project store — IndexedDB behind a testable backend

**Files:**
- Create: `src/store/projectStore.ts`
- Create: `src/store/projectStoreIdb.ts`
- Create: `src/store/projectStore.test.ts`

**Interfaces:**
- Consumes: `ProjectBody`, `ProjectMeta` (Task 2).
- Produces (`src/store/projectStore.ts`):
  - `interface ProjectStoreBackend { listMeta(): Promise<ProjectMeta[]>; getBody(id: string): Promise<ProjectBody | undefined>; put(body: ProjectBody): Promise<void>; remove(id: string): Promise<void>; repairOrphans(): Promise<void> }`
  - `type ProjectStoreStatus = 'unknown' | 'ready' | 'unavailable'`
  - `type ProjectStoreError = 'unavailable' | 'quota' | 'not-found' | 'failed'`
  - `type ProjectStoreResult<T> = { ok: true; value: T } | { ok: false; error: ProjectStoreError; message: string }`
  - `interface ProjectStore { status(): ProjectStoreStatus; list(): Promise<ProjectStoreResult<ProjectMeta[]>>; get(id: string): Promise<ProjectStoreResult<ProjectBody>>; put(body: ProjectBody): Promise<ProjectStoreResult<ProjectMeta>>; remove(id: string): Promise<ProjectStoreResult<null>> }`
  - `createProjectStore(openBackend: () => Promise<ProjectStoreBackend>): ProjectStore`
  - `createMemoryBackend(seed?: ProjectBody[]): ProjectStoreBackend & { bodies: Map<string, ProjectBody>; metas: Map<string, ProjectMeta> }`
  - `QUOTA_MESSAGE = 'There is not enough storage space to save this project'`, `UNAVAILABLE_MESSAGE = 'Project storage is unavailable on this device (private browsing or blocked site storage).'`
- Produces (`src/store/projectStoreIdb.ts`): `openIndexedDbBackend(dbName = PROJECT_DB_NAME): Promise<ProjectStoreBackend>`, `PROJECT_DB_NAME = 'solna-projects'`, `PROJECT_DB_VERSION = 1`.

- [ ] **Step 1: Write the failing tests**

`src/store/projectStore.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore, QUOTA_MESSAGE } from './projectStore';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';

const body = (name: string, now = 1000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });

describe('createProjectStore against the in-memory backend', () => {
  test('put then list returns metadata only, most recently updated first', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    await store.put(body('Old', 1000));
    await store.put(body('New', 2000));
    const list = await store.list();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((m) => m.name)).toEqual(['New', 'Old']);
    expect('content' in list.value[0]).toBe(false);
    expect(store.status()).toBe('ready');
  });

  test('get returns the full body and not-found for a missing id', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    const b = body('One');
    await store.put(b);
    const hit = await store.get(b.id);
    expect(hit.ok && hit.value.content.bpm).toBe(120);
    const miss = await store.get('nope');
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.error).toBe('not-found');
  });

  test('remove deletes both records', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    const b = body('Gone');
    await store.put(b);
    await store.remove(b.id);
    expect(backend.bodies.has(b.id)).toBe(false);
    expect(backend.metas.has(b.id)).toBe(false);
  });

  test('a failing open resolves to the degraded state and never throws', async () => {
    const store = createProjectStore(async () => {
      throw new Error('SecurityError: IndexedDB is blocked');
    });
    const list = await store.list();
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error).toBe('unavailable');
    expect(store.status()).toBe('unavailable');
    const put = await store.put(body('X'));
    expect(put.ok).toBe(false);
    if (!put.ok) expect(put.error).toBe('unavailable');
  });

  test('open is attempted once — a second call reuses the outcome', async () => {
    let opens = 0;
    const store = createProjectStore(async () => {
      opens++;
      return createMemoryBackend();
    });
    await store.list();
    await store.list();
    await store.put(body('Y'));
    expect(opens).toBe(1);
  });

  test('QuotaExceededError on put becomes the quota result with the spec message', async () => {
    const backend = createMemoryBackend();
    backend.put = async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.put(body('Big'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('quota');
      expect(result.message).toBe(QUOTA_MESSAGE);
    }
  });

  test('any other backend throw becomes a failed result, not a rejection', async () => {
    const backend = createMemoryBackend();
    backend.getBody = async () => {
      throw new Error('boom');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.get('x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('failed');
  });

  test('read-repair drops an orphaned meta row on first open, without reading bodies', async () => {
    const backend = createMemoryBackend();
    const orphan = body('Orphan');
    backend.metas.set(orphan.id, { ...orphan, content: undefined } as never);
    const store = createProjectStore(async () => backend);
    const list = await store.list();
    expect(list.ok && list.value).toEqual([]);
    expect(backend.metas.has(orphan.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectStore.test.ts`
Expected: FAIL — `Cannot find module './projectStore'`.

- [ ] **Step 3: Write `src/store/projectStore.ts`**

```ts
import type { ProjectBody, ProjectMeta } from './projectFormat';

export interface ProjectStoreBackend {
  /** Metadata only — must not deserialise bodies. */
  listMeta(): Promise<ProjectMeta[]>;
  getBody(id: string): Promise<ProjectBody | undefined>;
  /** Writes `projects` and `projectMeta` in ONE transaction. */
  put(body: ProjectBody): Promise<void>;
  /** Removes from both stores in ONE transaction. */
  remove(id: string): Promise<void>;
  /** Drops any row present in one store but not the other. Key-only. */
  repairOrphans(): Promise<void>;
}

export type ProjectStoreStatus = 'unknown' | 'ready' | 'unavailable';
export type ProjectStoreError = 'unavailable' | 'quota' | 'not-found' | 'failed';
export type ProjectStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectStoreError; message: string };

export const QUOTA_MESSAGE = 'There is not enough storage space to save this project';
export const UNAVAILABLE_MESSAGE =
  'Project storage is unavailable on this device (private browsing or blocked site storage).';
export const NOT_FOUND_MESSAGE = 'That project is no longer stored on this device.';
export const FAILED_MESSAGE = 'Project storage failed. Export the session to keep your work.';

export interface ProjectStore {
  status(): ProjectStoreStatus;
  list(): Promise<ProjectStoreResult<ProjectMeta[]>>;
  get(id: string): Promise<ProjectStoreResult<ProjectBody>>;
  put(body: ProjectBody): Promise<ProjectStoreResult<ProjectMeta>>;
  remove(id: string): Promise<ProjectStoreResult<null>>;
}

export function toMeta(body: ProjectBody): ProjectMeta {
  return {
    formatVersion: body.formatVersion,
    id: body.id,
    name: body.name,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
  };
}

function isQuotaError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'QuotaExceededError';
}

/**
 * Wraps a backend so every call resolves to a typed result — an `open()` that
 * throws or rejects is a normal state ('unavailable'), not an exception path,
 * mirroring resolveStorage() in store.ts. Availability is resolved ONCE,
 * lazily, on the first call: probing at module load would cost every launch a
 * database open that most launches never need.
 */
export function createProjectStore(openBackend: () => Promise<ProjectStoreBackend>): ProjectStore {
  let status: ProjectStoreStatus = 'unknown';
  let opening: Promise<ProjectStoreBackend | null> | null = null;

  const open = (): Promise<ProjectStoreBackend | null> => {
    opening ??= (async () => {
      try {
        const backend = await openBackend();
        await backend.repairOrphans();
        status = 'ready';
        return backend;
      } catch {
        status = 'unavailable';
        return null;
      }
    })();
    return opening;
  };

  const run = async <T>(op: (backend: ProjectStoreBackend) => Promise<ProjectStoreResult<T>>) => {
    const backend = await open();
    if (!backend) return { ok: false as const, error: 'unavailable' as const, message: UNAVAILABLE_MESSAGE };
    try {
      return await op(backend);
    } catch (err) {
      if (isQuotaError(err)) return { ok: false as const, error: 'quota' as const, message: QUOTA_MESSAGE };
      return { ok: false as const, error: 'failed' as const, message: FAILED_MESSAGE };
    }
  };

  return {
    status: () => status,
    list: () =>
      run(async (b) => {
        const metas = await b.listMeta();
        metas.sort((x, y) => y.updatedAt - x.updatedAt);
        return { ok: true, value: metas };
      }),
    get: (id) =>
      run(async (b) => {
        const body = await b.getBody(id);
        return body
          ? { ok: true, value: body }
          : { ok: false, error: 'not-found', message: NOT_FOUND_MESSAGE };
      }),
    put: (body) =>
      run(async (b) => {
        await b.put(body);
        return { ok: true, value: toMeta(body) };
      }),
    remove: (id) =>
      run(async (b) => {
        await b.remove(id);
        return { ok: true, value: null };
      }),
  };
}

/** Test double and the shape the IndexedDB backend must match. */
export function createMemoryBackend(seed: ProjectBody[] = []) {
  const bodies = new Map<string, ProjectBody>(seed.map((b) => [b.id, b]));
  const metas = new Map<string, ProjectMeta>(seed.map((b) => [b.id, toMeta(b)]));
  const backend: ProjectStoreBackend & { bodies: typeof bodies; metas: typeof metas } = {
    bodies,
    metas,
    listMeta: async () => [...metas.values()],
    getBody: async (id) => bodies.get(id),
    put: async (body) => {
      bodies.set(body.id, structuredClone(body));
      metas.set(body.id, toMeta(body));
    },
    remove: async (id) => {
      bodies.delete(id);
      metas.delete(id);
    },
    repairOrphans: async () => {
      for (const id of [...metas.keys()]) if (!bodies.has(id)) metas.delete(id);
      for (const id of [...bodies.keys()]) if (!metas.has(id)) bodies.delete(id);
    },
  };
  return backend;
}
```

- [ ] **Step 4: Write `src/store/projectStoreIdb.ts`**

Not unit-tested (the spec forbids running real IndexedDB under `bun:test`); it is exercised through the in-browser check in Task 13. The `indexedDB` global is read **inside** the function body, never in a default parameter.

```ts
import type { ProjectStoreBackend } from './projectStore';
import type { ProjectBody, ProjectMeta } from './projectFormat';
import { toMeta } from './projectStore';

export const PROJECT_DB_NAME = 'solna-projects';
export const PROJECT_DB_VERSION = 1;
const BODIES = 'projects';
const METAS = 'projectMeta';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/**
 * Opens (and on first use creates) the two-store database. Rejects — instead
 * of throwing synchronously — when `indexedDB` is missing, blocked or errors
 * on open; createProjectStore turns that rejection into the degraded state.
 * A stuck open (some webviews never fire any event) is bounded by a timeout so
 * the Project Manager cannot hang forever.
 */
export function openIndexedDbBackend(dbName = PROJECT_DB_NAME): Promise<ProjectStoreBackend> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('indexedDB missing');
      request = indexedDB.open(dbName, PROJECT_DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => reject(new Error('indexedDB open timed out')), 3000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(METAS)) db.createObjectStore(METAS, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error('indexedDB open failed'));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('indexedDB open blocked'));
    };
  }).then((db): ProjectStoreBackend => ({
    listMeta: async () => {
      const tx = db.transaction(METAS, 'readonly');
      const rows = await requestToPromise(tx.objectStore(METAS).getAll() as IDBRequest<ProjectMeta[]>);
      return rows;
    },
    getBody: async (id) => {
      const tx = db.transaction(BODIES, 'readonly');
      return requestToPromise(tx.objectStore(BODIES).get(id) as IDBRequest<ProjectBody | undefined>);
    },
    put: async (body) => {
      const tx = db.transaction([BODIES, METAS], 'readwrite');
      tx.objectStore(BODIES).put(body);
      tx.objectStore(METAS).put(toMeta(body));
      await transactionDone(tx);
    },
    remove: async (id) => {
      const tx = db.transaction([BODIES, METAS], 'readwrite');
      tx.objectStore(BODIES).delete(id);
      tx.objectStore(METAS).delete(id);
      await transactionDone(tx);
    },
    repairOrphans: async () => {
      // Key-only: getAllKeys never deserialises a body.
      const tx = db.transaction([BODIES, METAS], 'readwrite');
      const bodyKeys = new Set(await requestToPromise(tx.objectStore(BODIES).getAllKeys()));
      const metaKeys = new Set(await requestToPromise(tx.objectStore(METAS).getAllKeys()));
      for (const key of metaKeys) if (!bodyKeys.has(key)) tx.objectStore(METAS).delete(key);
      for (const key of bodyKeys) if (!metaKeys.has(key)) tx.objectStore(BODIES).delete(key);
      await transactionDone(tx);
    },
  }));
}
```

- [ ] **Step 5: Run the tests, type-check and eslint**

Run: `bun test src/store/projectStore.test.ts && bun run lint && bun run eslint`
Expected: PASS. (`DOMException` exists in Bun; `IDB*` types come from the `DOM` lib in `tsconfig.strict.json:7`.)

- [ ] **Step 6: Commit**

```bash
git add src/store/projectStore.ts src/store/projectStoreIdb.ts src/store/projectStore.test.ts
git commit -m "feat(project): add the IndexedDB project store with a degraded mode and an in-memory fake"
```

---

### Task 6: Persist migration v8 → v9 (project identity in the working buffer)

**Files:**
- Modify: `src/store/migrate.ts` (append after `backfillLeadWindow`, line 215+)
- Modify: `src/store/types.ts:322-335` (`PersistedState`)
- Modify: `src/store/store.ts:146-160` (`partializeAppState`), `:383-411` (`sanitizePersistedState`), `:439` (`version`), `:466-469` (chain)
- Test: `src/store/migrate.test.ts` (append), `src/store/store.test.ts` (append)

**Interfaces:**
- Produces: `migrateAddProjectIdentity<T extends object>(state: T): T` — defaults `currentProjectId` and `projectBaselineHash` to `null` when absent; two new `PersistedState` keys `currentProjectId: string | null`, `projectBaselineHash: string | null`.
- **The migration must not seed a baseline.** A migrated session is untitled, and an untitled session is compared against the default project (`isContentDirty`, Task 4) — so pre-upgrade work that differs from the defaults is dirty from the first idle pass and the dirty guard protects it. Seeding a baseline from the on-screen content would make that work look clean and let Import replace it silently.
- Note: the store fields themselves arrive with the slice in Task 7. Until then `partializeAppState` reads `state.currentProjectId ?? null` — tsc will reject that before Task 7 lands, so this task **adds the two fields to `AppStore`** via a minimal `ProjectIdentityState` interface that Task 7's `ProjectSlice` then extends.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/migrate.test.ts` (add `migrateAddProjectIdentity` to the import list at the top):

```ts
describe('migrateAddProjectIdentity (v8 -> v9)', () => {
  test('a v8 payload gains both fields as null', () => {
    const out = migrateAddProjectIdentity({ bpm: 120, loops: [] }) as Record<string, unknown>;
    expect(out.currentProjectId).toBeNull();
    expect(out.projectBaselineHash).toBeNull();
    expect(out.bpm).toBe(120);
  });

  test('a v9 payload is unchanged by the step', () => {
    const input = { bpm: 90, currentProjectId: 'p-1', projectBaselineHash: 'abc' };
    expect(migrateAddProjectIdentity(input)).toEqual(input);
  });

  test('does not mutate the payload it was given', () => {
    const input = { bpm: 90 } as Record<string, unknown>;
    migrateAddProjectIdentity(input);
    expect('currentProjectId' in input).toBe(false);
  });
});
```

Append to `src/store/store.test.ts` (inside the file's existing fake-storage harness, using `getStore()` and `fakeLocalStorage` exactly as the `'loop wrap migration wiring (v5 -> v6)'` block at `src/store/store.test.ts:965` does):

```ts
describe('project identity migration wiring (v8 -> v9)', () => {
  test('a version-8 payload hydrates with a null project id and baseline', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 8, state: { bpm: 111 } })
    );
    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(111);
    expect(s.currentProjectId).toBeNull();
    expect(s.projectBaselineHash).toBeNull();
  });

  test('a version-1 payload still terminates in the v9 shape', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem('musibox_project_state_v1', JSON.stringify({ version: 1, state: { bpm: 100 } }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().currentProjectId).toBeNull();
    flushPersistedWrites();
    expect(JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}').version).toBe(9);
  });

  test('a wrong-typed currentProjectId / projectBaselineHash is coerced to null', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 9, state: { currentProjectId: 42, projectBaselineHash: { x: 1 } } })
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(useAppStore.getState().projectBaselineHash).toBeNull();
  });

  test('the two identity fields are persisted and nothing transient rides along', async () => {
    const { useAppStore, flushPersistedWrites, partializeAppState } = await getStore();
    useAppStore.setState({ currentProjectId: 'p-9', projectBaselineHash: 'h' });
    flushPersistedWrites();
    const stored = JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}');
    expect(stored.state.currentProjectId).toBe('p-9');
    expect(stored.state.projectBaselineHash).toBe('h');
    expect('dirty' in partializeAppState(useAppStore.getState())).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/migrate.test.ts src/store/store.test.ts`
Expected: FAIL — `migrateAddProjectIdentity` is not exported; `currentProjectId` undefined.

- [ ] **Step 3: Add the migration step**

Append to `src/store/migrate.ts`:

```ts
/**
 * v8 -> v9: the working buffer carries the project identity (which stored
 * project the session belongs to) and the dirty baseline fingerprint, so a
 * killed tab comes back knowing which project was open. Both default to null.
 */
export function migrateAddProjectIdentity<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) };
  if (!('currentProjectId' in next)) next.currentProjectId = null;
  if (!('projectBaselineHash' in next)) next.projectBaselineHash = null;
  return next as unknown as T;
}
```

- [ ] **Step 4: Extend the types**

In `src/store/types.ts`, before `export interface AppStore`, add:

```ts
/** Persisted project identity — extended by ProjectSlice in projectSlice.ts. */
export interface ProjectIdentityState {
  currentProjectId: string | null;
  projectBaselineHash: string | null;
}
```

Add `ProjectIdentityState` to the `AppStore extends` list, and append to `PersistedState`:

```ts
  currentProjectId: string | null;
  projectBaselineHash: string | null;
```

- [ ] **Step 5: Wire `store.ts`**

1. `partializeAppState` (`src/store/store.ts:146`): append
   ```ts
       currentProjectId: state.currentProjectId,
       projectBaselineHash: state.projectBaselineHash,
   ```
2. `sanitizePersistedState`, just before `return sanitized as unknown as Partial<AppStore>;`:
   ```ts
     if (typeof sanitized.currentProjectId !== 'string') sanitized.currentProjectId = null;
     if (typeof sanitized.projectBaselineHash !== 'string') sanitized.projectBaselineHash = null;
   ```
3. `version: 8` → `version: 9`.
4. In the `migrate` chain, after the `windowed` definition (`src/store/store.ts:466-468`), add
   ```ts
           // v8 → v9 (project identity). Runs LAST; a no-op on a v9 payload.
           const identified = (payload: PersistedState): PersistedState =>
             version >= 9 ? payload : (migrateAddProjectIdentity(windowed(payload)) as PersistedState);
   ```
   and change both `return windowed(...)` lines to `return identified(...)` (keep their inner arguments: `identified(wrapped(metered(recoloured)))` and `identified(wrapped(metered(next as unknown as PersistedState)))`).
5. Add `migrateAddProjectIdentity` to the `./migrate` import.
6. Until Task 7 replaces it, give the store creator the two fields so `AppStore` is satisfied: inside the `subscribeWithSelector((set, get, api) => { ... return { ... } })` object add `currentProjectId: null, projectBaselineHash: null,` as the last two entries.

- [ ] **Step 6: Run the tests, type-check and eslint**

Run: `bun test src/store/migrate.test.ts src/store/store.test.ts && bun run lint && bun run eslint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/migrate.ts src/store/migrate.test.ts src/store/types.ts src/store/store.ts src/store/store.test.ts
git commit -m "feat(store): persist the current project identity (v9)"
```

---

### Task 7: The project slice — lifecycle actions

**Files:**
- Create: `src/store/projectSlice.ts`
- Create: `src/store/projectSlice.test.ts`
- Modify: `src/store/types.ts` (`UiSlice`, `AppStore`), `src/store/uiSlice.ts:49,75`, `src/store/store.ts` (slice creation; remove the two placeholder fields from Task 6)

**Interfaces:**
- Consumes: Task 2 (`buildProjectContent`, `applyProjectContent`, `factoryProjectContent`, `makeEnvelope`, `newProjectId`, `PROJECT_FORMAT_VERSION`), Task 4 (`fingerprintContent`, `isContentDirty`), Task 5 (`ProjectStore`, `ProjectStoreResult`, `toMeta`), `hardStopAll` (`src/store/transportSlice.ts:148`), `audioEngine.stopSource` (`src/audio/engine.ts`; `store/` importing `../audio/engine` is permitted — `src/store/loadLoop.ts:1` already does).
- **Voice tails are cut on every session swap**, in the exact order `src/store/loadLoop.ts:79-83` uses: `hardStopAll()` → `audioEngine.stopSource('chord', 0.02)` → `audioEngine.stopSource('bass', 0.02)` → the content `set()`. A state-only swap would leave the previous project's queued chord/bass voices ringing over the new one (the React-batching reason documented in `loadLoop.ts:19-27`), and cutting after the `set()` would race `engineSync`'s subscriptions, which fire synchronously on that write.
- Produces (`src/store/projectSlice.ts`):

```ts
export interface ProjectSlice extends ProjectIdentityState {
  dirty: boolean;                          // transient; owned by projectDirty.ts
  currentProjectName: string | null;       // transient; resolved from projectMeta
  projectStoreStatus: ProjectStoreStatus;  // transient
  projectList: ProjectMeta[];              // transient
  projectNotice: string | null;            // transient, non-blocking notice text
  setProjectNotice: (notice: string | null) => void;
  refreshProjects: () => Promise<void>;
  newProject: () => void;
  openProject: (id: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  saveProject: () => Promise<ProjectStoreResult<ProjectMeta>>;
  saveProjectAs: (name: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  renameProject: (id: string, name: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  deleteProject: (id: string) => Promise<ProjectStoreResult<null>>;
  importProject: (body: ProjectBody, mode: 'new' | 'overwrite' | 'copy') => Promise<ProjectStoreResult<ProjectMeta | null>>;
  exportStoredProject: (id: string) => Promise<ProjectStoreResult<ProjectBody>>;
  buildSessionExport: (name: string, now: number) => ProjectBody;
}
export function createProjectSlice(set: Set, get: Get, projectStore: ProjectStore, now: () => number = Date.now): ProjectSlice
```
- `UiSlice` gains `isProjectManagerOpen: boolean` and `setIsProjectManagerOpen: (open: boolean) => void`.

- [ ] **Step 1: Write the failing tests**

`src/store/projectSlice.test.ts` — built against a **real** store instance so `hardStopAll`, `loopStatePatch` mirroring and `set()` semantics are exercised, but with the in-memory backend. Follow the `store.test.ts` harness for the fake `localStorage` / `window` globals (`src/store/store.test.ts:117-131`).

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { fingerprintContent } from './projectFingerprint';
import { createDefaultLoop } from './loopSlice';
import type { AppStore } from './types';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

let storeModule: Promise<typeof import('./store')>;
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  storeModule = import(`./store?bust=${Date.now()}`);
});

/** A fresh slice bound to the live store but to ITS OWN memory backend. */
async function sliceWithBackend(seed: ProjectBody[] = []) {
  const { useAppStore } = await storeModule;
  const { createProjectSlice } = await import('./projectSlice');
  const backend = createMemoryBackend(seed);
  const store = createProjectStore(async () => backend);
  const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
  useAppStore.setState({ ...slice, currentProjectId: null, projectBaselineHash: null, dirty: false });
  return { useAppStore, backend, slice: useAppStore.getState() as AppStore };
}

const stored = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm, loops: [{ ...createDefaultLoop(), id: `loop-${name}` }] },
});

/** The engine seam: stopSource no-ops before init(), so the spy only records. */
let stopSource: ReturnType<typeof spyOn>;
beforeEach(async () => {
  const { useAppStore } = await storeModule;
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped', selectedVibeId: null });
  stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
});
afterEach(() => {
  stopSource.mockRestore();
});

describe('openProject', () => {
  test('stops the transport, installs content in one set(), applies the reset rules and takes a baseline', async () => {
    const p = stored('Alpha', 77);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    useAppStore.setState({ sequencerPlayer: 'playing', selectedVibeId: 'cyber-dance', controlTarget: 'bass', metronomeActive: true, activeLoopId: 'foreign' });
    let writes = 0;
    const unsub = useAppStore.subscribe((s, prev) => { if (s.bpm !== prev.bpm || s.loops !== prev.loops) writes++; });
    const result = await slice.openProject(p.id);
    unsub();
    expect(result.ok).toBe(true);
    const s = useAppStore.getState();
    expect(writes).toBe(1);
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope.kind).toBe('none');
    expect(s.bpm).toBe(77);
    expect(s.activeLoopId).toBe('loop-Alpha');
    expect(s.scaleRoot).toBe(p.content.loops[0].scaleRoot);
    expect(s.selectedVibeId).toBeNull();
    expect(s.controlTarget).toBe('bass');
    expect(s.metronomeActive).toBe(true);
    expect(s.currentProjectId).toBe(p.id);
    expect(s.currentProjectName).toBe('Alpha');
    expect(s.projectBaselineHash).toBe(fingerprintContent(p.content));
    expect(s.dirty).toBe(false);
  });

  test('cuts the chord and bass voices BEFORE the state swap, like loadLoop', async () => {
    const p = stored('Cut', 78);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    const order: string[] = [];
    stopSource.mockImplementation((source: string, release: number) => { order.push(`${source}@${release}`); });
    const unsub = useAppStore.subscribe((s, prev) => { if (s.bpm !== prev.bpm) order.push('set'); });
    await slice.openProject(p.id);
    unsub();
    expect(order).toEqual(['chord@0.02', 'bass@0.02', 'set']);
  });

  test('a missing id is a not-found result, leaves the session untouched and cuts nothing', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 133 });
    const result = await slice.openProject('ghost');
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().bpm).toBe(133);
    expect(stopSource).not.toHaveBeenCalled();
  });
});

describe('newProject', () => {
  test('resets content to factory, clears the id, keeps the tab and preferences', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 140, currentProjectId: 'x', currentProjectName: 'X', activeTab: 'effects', selectedVibeId: 'asian-zen', sequencerPlayer: 'playing' });
    slice.newProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(120);
    expect(s.loops).toHaveLength(1);
    expect(s.activeLoopId).toBe(s.loops[0].id);
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBeNull();
    expect(s.selectedVibeId).toBeNull();
    expect(s.activeTab).toBe('effects');
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.dirty).toBe(false);
    // Untitled: no baseline — the tracker compares against the default project.
    expect(s.projectBaselineHash).toBeNull();
  });

  test('cuts the chord and bass voices before the reset, like Open', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    const order: string[] = [];
    stopSource.mockImplementation((source: string) => { order.push(source); });
    const unsub = useAppStore.subscribe((s, prev) => { if (s.loops !== prev.loops) order.push('set'); });
    useAppStore.setState({ bpm: 140 });
    slice.newProject();
    unsub();
    expect(order).toEqual(['chord', 'bass', 'set']);
  });
});

describe('saveProject / saveProjectAs', () => {
  test('saveProjectAs mints a record, makes it current and clears dirty', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 99, dirty: true });
    const result = await slice.saveProjectAs('Fresh');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(backend.bodies.get(result.value.id)?.content.bpm).toBe(99);
    expect(result.value).toMatchObject({ name: 'Fresh', createdAt: 5_000, updatedAt: 5_000 });
    const s = useAppStore.getState();
    expect(s.currentProjectId).toBe(result.value.id);
    expect(s.currentProjectName).toBe('Fresh');
    expect(s.dirty).toBe(false);
    expect(s.projectList[0].id).toBe(result.value.id);
  });

  test('saveProject writes back silently: same id, same createdAt, new updatedAt', async () => {
    const p = stored('Keep', 80);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 81, dirty: true });
    const result = await slice.saveProject();
    expect(result.ok).toBe(true);
    const saved = backend.bodies.get(p.id);
    expect(saved?.content.bpm).toBe(81);
    expect(saved?.createdAt).toBe(1_000);
    expect(saved?.updatedAt).toBe(5_000);
    expect(saved?.name).toBe('Keep');
    expect(useAppStore.getState().dirty).toBe(false);
  });

  test('saveProject without a current project refuses with not-found (the UI prompts for a name)', async () => {
    const { slice } = await sliceWithBackend();
    const result = await slice.saveProject();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not-found');
  });

  test('a failed save never clears dirty', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    backend.put = async () => { throw new DOMException('q', 'QuotaExceededError'); };
    useAppStore.setState({ dirty: true });
    const result = await slice.saveProjectAs('Too Big');
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().dirty).toBe(true);
    expect(useAppStore.getState().currentProjectId).toBeNull();
  });

  test('saveProjectAs from an open project never overwrites the source', async () => {
    const p = stored('Source', 70);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 71 });
    const result = await slice.saveProjectAs('Source copy');
    expect(result.ok && result.value.id).not.toBe(p.id);
    expect(backend.bodies.get(p.id)?.content.bpm).toBe(70);
  });
});

describe('renameProject', () => {
  test('bumps updatedAt, updates the list and the current name, and does not touch dirty', async () => {
    const p = stored('Before', 60);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ dirty: true });
    const result = await slice.renameProject(p.id, 'After');
    expect(result.ok).toBe(true);
    expect(backend.bodies.get(p.id)?.name).toBe('After');
    expect(backend.metas.get(p.id)?.updatedAt).toBe(5_000);
    const s = useAppStore.getState();
    expect(s.currentProjectName).toBe('After');
    expect(s.projectList.find((m) => m.id === p.id)?.name).toBe('After');
    expect(s.dirty).toBe(true);
  });
});

describe('deleteProject', () => {
  test('deleting the current project clears the id, marks dirty and leaves content on screen', async () => {
    const p = stored('Doomed', 66);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    const result = await slice.deleteProject(p.id);
    expect(result.ok).toBe(true);
    expect(backend.bodies.has(p.id)).toBe(false);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(66);
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBeNull();
    expect(s.projectBaselineHash).toBeNull();
    expect(s.dirty).toBe(true);
  });

  test('deleting another project leaves the current one alone', async () => {
    const a = stored('A', 61);
    const b = stored('B', 62);
    const { useAppStore, slice } = await sliceWithBackend([a, b]);
    await slice.openProject(a.id);
    await slice.deleteProject(b.id);
    expect(useAppStore.getState().currentProjectId).toBe(a.id);
    expect(useAppStore.getState().dirty).toBe(false);
  });
});

describe('importProject', () => {
  test('new id: stored, then opened through the Open path', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    useAppStore.setState({ selectedVibeId: 'lofi-chill' });
    const file = stored('Imported', 55);
    const result = await slice.importProject(file, 'new');
    expect(result.ok).toBe(true);
    expect(backend.bodies.has(file.id)).toBe(true);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(55);
    expect(s.selectedVibeId).toBeNull();
    expect(s.currentProjectId).toBe(file.id);
  });

  test('overwrite replaces the stored record with the file', async () => {
    const existing = stored('Old', 50);
    const { backend, slice } = await sliceWithBackend([existing]);
    const file = { ...existing, name: 'From File', updatedAt: 9_000, content: { ...existing.content, bpm: 51 } };
    await slice.importProject(file, 'overwrite');
    expect(backend.bodies.get(existing.id)?.content.bpm).toBe(51);
    expect(backend.bodies.get(existing.id)?.name).toBe('From File');
  });

  test('copy mints a new id, appends " (imported)" and leaves the existing record alone', async () => {
    const existing = stored('Twin', 50);
    const { useAppStore, backend, slice } = await sliceWithBackend([existing]);
    const result = await slice.importProject({ ...existing, content: { ...existing.content, bpm: 52 } }, 'copy');
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;
    expect(result.value.id).not.toBe(existing.id);
    expect(result.value.name).toBe('Twin (imported)');
    expect(backend.bodies.get(existing.id)?.content.bpm).toBe(50);
    expect(useAppStore.getState().currentProjectId).toBe(result.value.id);
  });

  test('with storage unavailable the file still opens, with no current project', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const store = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
    useAppStore.setState({ ...slice, currentProjectId: 'stale' });
    const result = await useAppStore.getState().importProject(stored('Loose', 44), 'new');
    expect(result.ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(44);
    expect(s.currentProjectId).toBeNull();
    expect(s.projectBaselineHash).toBeNull();
    // Stored nowhere and different from the default project: unsaved work.
    expect(s.dirty).toBe(true);
    expect(s.projectStoreStatus).toBe('unavailable');
  });
});

describe('export', () => {
  test('exportStoredProject returns the saved snapshot, not live state', async () => {
    const p = stored('Snap', 40);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 41 });
    const result = await slice.exportStoredProject(p.id);
    expect(result.ok && result.value.content.bpm).toBe(40);
  });

  test('buildSessionExport returns live state with the current identity and does not touch dirty', async () => {
    const p = stored('Live', 40);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 41, dirty: true });
    const body = useAppStore.getState().buildSessionExport('ignored when current', 7_000);
    expect(body.id).toBe(p.id);
    expect(body.name).toBe('Live');
    expect(body.createdAt).toBe(1_000);
    expect(body.updatedAt).toBe(7_000);
    expect(body.content.bpm).toBe(41);
    expect(useAppStore.getState().dirty).toBe(true);
  });

  test('buildSessionExport with no current project mints a fresh id and uses the given name', async () => {
    const { useAppStore } = await sliceWithBackend();
    const body = useAppStore.getState().buildSessionExport('Loose Session', 7_000);
    expect(body.id.startsWith('project-')).toBe(true);
    expect(body).toMatchObject({ name: 'Loose Session', createdAt: 7_000, updatedAt: 7_000 });
  });
});

describe('refreshProjects', () => {
  test('resolves the current name from the list, and a stale id becomes an unsaved session', async () => {
    const p = stored('Named', 30);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    useAppStore.setState({ currentProjectId: p.id, currentProjectName: null });
    await slice.refreshProjects();
    expect(useAppStore.getState().currentProjectName).toBe('Named');
    expect(useAppStore.getState().projectStoreStatus).toBe('ready');
    useAppStore.setState({ currentProjectId: 'stale-id' });
    await slice.refreshProjects();
    expect(useAppStore.getState().currentProjectId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectSlice.test.ts`
Expected: FAIL — `Cannot find module './projectSlice'`.

- [ ] **Step 3: Add the modal flag to `uiSlice`**

`src/store/types.ts` `UiSlice`: add `isProjectManagerOpen: boolean;` after `isMidiSettingsOpen` and `setIsProjectManagerOpen: (open: boolean) => void;` after `setIsMidiSettingsOpen`. In `src/store/uiSlice.ts` add `isProjectManagerOpen: false,` after line 49 and `setIsProjectManagerOpen: (isProjectManagerOpen) => set({ isProjectManagerOpen }),` after line 75. Both are transient — `partializeAppState` is not touched.

- [ ] **Step 4: Write `src/store/projectSlice.ts`**

```ts
import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import type { AppStore, ProjectIdentityState } from './types';
import {
  PROJECT_FORMAT_VERSION,
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
  newProjectId,
  type ProjectBody,
  type ProjectContent,
  type ProjectMeta,
} from './projectFormat';
import { fingerprintContent, isContentDirty } from './projectFingerprint';
import { toMeta, type ProjectStore, type ProjectStoreResult, type ProjectStoreStatus } from './projectStore';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export interface ProjectSlice extends ProjectIdentityState {
  /** Transient. Owned by the dirty tracker (projectDirty.ts); actions here only reset it. */
  dirty: boolean;
  /** Transient; resolved from projectMeta on refresh. Null = unsaved session or lookup miss. */
  currentProjectName: string | null;
  projectStoreStatus: ProjectStoreStatus;
  projectList: ProjectMeta[];
  /** A non-blocking notice for the modal (unknown references, quota, unavailable). */
  projectNotice: string | null;
  setProjectNotice: (notice: string | null) => void;
  refreshProjects: () => Promise<void>;
  newProject: () => void;
  openProject: (id: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  saveProject: () => Promise<ProjectStoreResult<ProjectMeta>>;
  saveProjectAs: (name: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  renameProject: (id: string, name: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  deleteProject: (id: string) => Promise<ProjectStoreResult<null>>;
  importProject: (body: ProjectBody, mode: 'new' | 'overwrite' | 'copy') => Promise<ProjectStoreResult<ProjectMeta | null>>;
  exportStoredProject: (id: string) => Promise<ProjectStoreResult<ProjectBody>>;
  buildSessionExport: (name: string, now: number) => ProjectBody;
}

export const IMPORTED_SUFFIX = ' (imported)';

/**
 * Same instant-but-clickless release loadLoop uses (LOAD_LOOP_RELEASE in
 * loadLoop.ts). Not imported from there: loadLoop imports the store module,
 * and this slice is part of building it.
 */
export const INSTALL_RELEASE = 0.02;

/**
 * Lifecycle actions. Every path that replaces the live session goes through
 * `install`, in loadLoop's order: hardStopAll (dispatches the reducer's
 * 'stop-all', whose frozen singleton songMode compares by reference) → cut the
 * chord and bass voices → ONE set() carrying the content, the reset rules, the
 * flat per-loop patch and the identity. The cut happens BEFORE the set():
 * engineSync's subscriptions fire synchronously on that write, and a cut after
 * it would race them and let the old project's queued voices ring over the
 * new one. Drums are one-shots; one already-scheduled hit may still land.
 *
 * Baseline: a saved project gets the fingerprint of what was installed; an
 * untitled session (New, or an import with storage unavailable) keeps a null
 * baseline and its dirty flag comes from the default-project comparison
 * (isContentDirty). The dirty guard is the UI's job — by the time an action
 * here runs, the user has already chosen Discard or saved.
 */
export function createProjectSlice(set: Set, get: Get, projectStore: ProjectStore, now: () => number = Date.now): ProjectSlice {
  const install = (content: ProjectContent, identity: { id: string | null; name: string | null }): void => {
    get().hardStopAll();
    audioEngine.stopSource('chord', INSTALL_RELEASE);
    audioEngine.stopSource('bass', INSTALL_RELEASE);
    const saved = identity.id !== null;
    set({
      ...applyProjectContent(content),
      currentProjectId: identity.id,
      currentProjectName: identity.name,
      projectBaselineHash: saved ? fingerprintContent(content) : null,
      dirty: saved ? false : isContentDirty(content, null, null),
    });
  };

  const currentBody = (name: string, at: number): ProjectBody => {
    const s = get();
    const content = buildProjectContent(s);
    const existing = s.currentProjectId ? s.projectList.find((m) => m.id === s.currentProjectId) : undefined;
    if (existing) {
      return { ...existing, name: existing.name, updatedAt: at, content };
    }
    return { ...makeEnvelope(name, at), content };
  };

  const upsertList = (meta: ProjectMeta): void =>
    set((s) => ({
      projectList: [meta, ...s.projectList.filter((m) => m.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt),
    }));

  const write = async (body: ProjectBody, makeCurrent: boolean): Promise<ProjectStoreResult<ProjectMeta>> => {
    const result = await projectStore.put(body);
    set({ projectStoreStatus: projectStore.status() });
    if (!result.ok) return result; // a failed save never clears dirty
    upsertList(result.value);
    if (makeCurrent) {
      set({
        currentProjectId: body.id,
        currentProjectName: body.name,
        projectBaselineHash: fingerprintContent(body.content),
        dirty: false,
      });
    }
    return result;
  };

  return {
    currentProjectId: null,
    projectBaselineHash: null,
    dirty: false,
    currentProjectName: null,
    projectStoreStatus: 'unknown',
    projectList: [],
    projectNotice: null,

    setProjectNotice: (projectNotice) => set({ projectNotice }),

    refreshProjects: async () => {
      const result = await projectStore.list();
      const status = projectStore.status();
      if (!result.ok) {
        // Unavailable: keep the id (Export current session still uses it) but
        // there is no name to show — the UI renders "Unnamed project".
        set({ projectStoreStatus: status, projectList: [] });
        return;
      }
      const { currentProjectId } = get();
      const current = currentProjectId ? result.value.find((m) => m.id === currentProjectId) : undefined;
      set({
        projectStoreStatus: status,
        projectList: result.value,
        // A stored id that names no project is a lookup miss, not an error:
        // the session is simply unsaved now.
        currentProjectId: current ? currentProjectId : null,
        currentProjectName: current ? current.name : null,
      });
    },

    newProject: () => install(factoryProjectContent(), { id: null, name: null }),

    openProject: async (id) => {
      const result = await projectStore.get(id);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok) return result;
      install(result.value.content, { id: result.value.id, name: result.value.name });
      return { ok: true, value: toMeta(result.value) };
    },

    saveProject: async () => {
      const s = get();
      if (!s.currentProjectId || !s.projectList.some((m) => m.id === s.currentProjectId)) {
        return { ok: false, error: 'not-found', message: 'This session is not a saved project yet.' };
      }
      return write(currentBody('', now()), true);
    },

    saveProjectAs: async (name) => {
      const body: ProjectBody = { ...makeEnvelope(name, now()), content: buildProjectContent(get()) };
      return write(body, true);
    },

    renameProject: async (id, name) => {
      const existing = await projectStore.get(id);
      if (!existing.ok) return existing;
      const renamed: ProjectBody = { ...existing.value, name, updatedAt: now() };
      const result = await projectStore.put(renamed);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok) return result;
      upsertList(result.value);
      if (get().currentProjectId === id) set({ currentProjectName: name });
      return result;
    },

    deleteProject: async (id) => {
      const result = await projectStore.remove(id);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok) return result;
      set((s) => ({
        projectList: s.projectList.filter((m) => m.id !== id),
        // The session's work is now stored nowhere — but stays on screen.
        ...(s.currentProjectId === id
          ? { currentProjectId: null, currentProjectName: null, projectBaselineHash: null, dirty: true }
          : {}),
      }));
      return result;
    },

    importProject: async (body, mode) => {
      const at = now();
      const toStore: ProjectBody =
        mode === 'copy'
          ? { ...body, id: newProjectId(), name: `${body.name}${IMPORTED_SUFFIX}`, createdAt: at, updatedAt: at }
          : { ...body, formatVersion: PROJECT_FORMAT_VERSION };
      const result = await projectStore.put(toStore);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok && result.error !== 'unavailable') return result;
      if (result.ok) upsertList(result.value);
      // Storage unavailable: the file still opens, but it is nobody's project.
      install(toStore.content, result.ok ? { id: toStore.id, name: toStore.name } : { id: null, name: null });
      return { ok: true, value: result.ok ? result.value : null };
    },

    exportStoredProject: async (id) => {
      const result = await projectStore.get(id);
      set({ projectStoreStatus: projectStore.status() });
      return result;
    },

    buildSessionExport: (name, at) => currentBody(name, at),
  };
}
```

- [ ] **Step 5: Wire the slice into `store.ts`**

In `src/store/store.ts`:

```ts
import { createProjectSlice } from './projectSlice';
import { createProjectStore } from './projectStore';
import { openIndexedDbBackend } from './projectStoreIdb';

/** One project store per tab; opened lazily on the first Project Manager call. */
export const projectStore = createProjectStore(openIndexedDbBackend);
```

Inside the creator, replace the two placeholder fields from Task 6 with `...createProjectSlice(setWithLoopMirror, get, projectStore),` as the last spread. Remove `ProjectIdentityState` from `AppStore`'s extends list in `types.ts` and add `ProjectSlice` (imported as a type from `./projectSlice`) — `ProjectSlice` already extends `ProjectIdentityState`.

- [ ] **Step 6: Run the tests, type-check and eslint**

Run: `bun test src/store/projectSlice.test.ts src/store/store.test.ts src/store/uiSlice.test.ts && bun run lint && bun run eslint`
Expected: PASS (eslint must accept `store/projectSlice.ts` importing `../audio/engine` — only `audio/` → `store/` and `components/` → `audio/engine` are restricted). If `store.test.ts`'s `'store defaults'` test enumerates keys, add the seven new slice fields to its expectation.

- [ ] **Step 7: Commit**

```bash
git add src/store/projectSlice.ts src/store/projectSlice.test.ts src/store/types.ts src/store/uiSlice.ts src/store/store.ts src/store/store.test.ts
git commit -m "feat(project): add the project slice with open, save, rename, delete, import and export"
```

---

### Task 8: Idle-debounced dirty tracking

**Files:**
- Create: `src/store/projectDirty.ts`
- Create: `src/store/projectDirty.test.ts`
- Modify: `src/store/store.ts:121-135` (`pagehide` / `visibilitychange` block) and the store tail.

**Interfaces:**
- Consumes: `WriteScheduler`, `idleWriteScheduler` (`src/utils/coalescedStorage.ts:17-37`), `buildProjectContent` (Task 2), `isContentDirty` (Task 4 — the tracker never decides the rule itself), the store api type.
- **Rule reminder (Task 4):** untitled session → compared against `defaultContentFingerprint()`, `projectBaselineHash` stays `null`; saved project → compared against `projectBaselineHash`. The tracker never seeds a baseline: a seeded baseline once let Import silently replace unsaved pre-upgrade work because the dirty guard never fired.
- Produces:
  - `interface DirtyTrackerApi { getState(): AppStore; setState(partial: Partial<AppStore>): void; subscribe: typeof useAppStore.subscribe }`
  - `createDirtyTracker(api: DirtyTrackerApi, options?: { scheduler?: WriteScheduler; fingerprint?: (content: ProjectContent) => string }): { runNow(): void; stop(): void }`
  - `export const dirtyTracker` from `store.ts`, and `flushBeforeHide()` which runs the pass synchronously before `flushPersistedWrites()`.

- [ ] **Step 1: Write the failing test**

`src/store/projectDirty.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { WriteScheduler } from '../utils/coalescedStorage';
import { createDirtyTracker } from './projectDirty';
import { buildProjectContent, factoryProjectContent } from './projectFormat';
import { fingerprintContent } from './projectFingerprint';
import { createDefaultLoop } from './loopSlice';
import type { AppStore } from './types';

/** A scheduler the test drives by hand — the coalescedStorage.test.ts pattern. */
function manualScheduler() {
  const queued = new Map<number, () => void>();
  let next = 1;
  const scheduler: WriteScheduler = {
    schedule: (flush) => { const h = next++; queued.set(h, flush); return h; },
    cancel: (h) => { queued.delete(h); },
  };
  const run = () => { const jobs = [...queued.values()]; queued.clear(); jobs.forEach((j) => j()); };
  return { scheduler, run, size: () => queued.size };
}

/** A minimal store carrying only what the tracker reads and writes. */
function makeStore(identity: { currentProjectId: string | null; projectBaselineHash: string | null }) {
  const content = factoryProjectContent();
  return create<Partial<AppStore>>()(
    subscribeWithSelector(() => ({
      ...content,
      controlTarget: 'lead',
      selectedVibeId: null,
      dirty: false,
      ...identity,
    })),
  ) as unknown as Parameters<typeof createDirtyTracker>[0];
}

const SAVED = { currentProjectId: 'p-1', projectBaselineHash: fingerprintContent(factoryProjectContent()) };
const UNTITLED = { currentProjectId: null, projectBaselineHash: null };

describe('createDirtyTracker', () => {
  test('N content writes inside one idle window cost exactly ONE fingerprint computation', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    let computations = 0;
    createDirtyTracker(store, { scheduler: sched.scheduler, fingerprint: (c) => { computations++; return fingerprintContent(c); } });
    for (let i = 0; i < 50; i++) store.setState({ bpm: 100 + i });
    expect(computations).toBe(0);
    expect(sched.size()).toBe(1);
    sched.run();
    expect(computations).toBe(1);
    expect(store.getState().dirty).toBe(true);
  });

  test('excluded keys never schedule a pass', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ controlTarget: 'bass', selectedVibeId: 'cyber-dance' });
    expect(sched.size()).toBe(0);
    expect(store.getState().dirty).toBe(false);
  });

  test('a change that lands back on the baseline stays clean', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    store.setState({ bpm: 120 });
    sched.run();
    expect(store.getState().dirty).toBe(false);
  });

  test('once dirty, further writes schedule nothing until a new baseline is taken', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
    store.setState({ bpm: 122 });
    expect(sched.size()).toBe(0);
    // A save takes a fresh baseline and clears dirty; tracking resumes.
    store.setState({ projectBaselineHash: fingerprintContent(buildProjectContent(store.getState() as AppStore)), dirty: false });
    store.setState({ bpm: 123 });
    expect(sched.size()).toBe(1);
  });

  test('a fresh default untitled session is not dirty, and no baseline is ever seeded', () => {
    const store = makeStore(UNTITLED);
    const sched = manualScheduler();
    const tracker = createDirtyTracker(store, { scheduler: sched.scheduler });
    tracker.runNow();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().projectBaselineHash).toBeNull();
  });

  test('an untitled session becomes dirty on ANY content change from the default project', () => {
    for (const change of [
      { bpm: 121 },
      { meterId: '3/4' as const },
      { masterVolume: 0.5 },
      { effects: { ...factoryProjectContent().effects, reverbWet: 0.9 } },
      { loops: [{ ...createDefaultLoop(), chordFeel: 0.9 }] },
    ]) {
      const store = makeStore(UNTITLED);
      const sched = manualScheduler();
      createDirtyTracker(store, { scheduler: sched.scheduler });
      store.setState(change as Partial<AppStore>);
      sched.run();
      expect(store.getState().dirty).toBe(true);
      expect(store.getState().projectBaselineHash).toBeNull();
    }
  });

  test('a migrated pre-upgrade session that differs from the defaults is dirty on the first pass (so the guard fires before Import)', () => {
    const store = makeStore(UNTITLED);
    store.setState({ bpm: 96 }); // "old work" already on screen before the tracker exists
    const sched = manualScheduler();
    const tracker = createDirtyTracker(store, { scheduler: sched.scheduler });
    tracker.runNow();
    expect(store.getState().dirty).toBe(true);
  });

  test('opening a project (id + baseline set, dirty cleared) makes the session clean until it changes', () => {
    const store = makeStore(UNTITLED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 96 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
    // What projectSlice.install writes for a saved project:
    const opened = { ...factoryProjectContent(), bpm: 77 };
    store.setState({ ...opened, currentProjectId: 'p-2', projectBaselineHash: fingerprintContent(opened), dirty: false });
    sched.run();
    expect(store.getState().dirty).toBe(false);
    store.setState({ bpm: 78 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
  });

  test('New (reset to default, id and baseline null, dirty false) is clean until it changes', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
    // What projectSlice.newProject writes:
    store.setState({ ...factoryProjectContent(), currentProjectId: null, projectBaselineHash: null, dirty: false });
    sched.run();
    expect(store.getState().dirty).toBe(false);
    store.setState({ bpm: 122 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
  });

  test('runNow runs the pending pass synchronously and cancels the scheduled one', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    const tracker = createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    tracker.runNow();
    expect(store.getState().dirty).toBe(true);
    expect(sched.size()).toBe(0);
  });

  test('stop unsubscribes', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler }).stop();
    store.setState({ bpm: 121 });
    expect(sched.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectDirty.test.ts`
Expected: FAIL — `Cannot find module './projectDirty'`.

- [ ] **Step 3: Write `src/store/projectDirty.ts`**

```ts
import { shallow } from 'zustand/shallow';
import { idleWriteScheduler, type WriteScheduler } from '../utils/coalescedStorage';
import { buildProjectContent, type ProjectContent } from './projectFormat';
import { fingerprintContent, isContentDirty } from './projectFingerprint';
import type { AppStore } from './types';

export interface DirtyTrackerApi {
  getState(): AppStore;
  setState(partial: Partial<AppStore>): void;
  subscribe<U>(
    selector: (state: AppStore) => U,
    listener: (next: U, prev: U) => void,
    options?: { equalityFn?: (a: U, b: U) => boolean },
  ): () => void;
}

export interface DirtyTracker {
  /** Run the pending pass now (pagehide), cancelling the scheduled one. */
  runNow(): void;
  stop(): void;
}

type ContentRefs = [number, string, number, AppStore['effects'], AppStore['loops'], string | null, string | null];

/**
 * Owns the `dirty` boolean. MUST NOT run per set(): a knob drag is 60-120
 * set() calls a second, and fingerprinting the whole arrangement on each one
 * would serialise it hundreds of times per drag on the audio scheduler's
 * thread. So: a subscribeWithSelector subscription over the content keys (by
 * reference) marks a pass pending and schedules ONE idle callback through the
 * same scheduler coalescedStorage uses; many set()s in a window collapse to
 * one computation; `dirty` changes at most once per window. Once dirty, the
 * pass early-outs until a save / open / New clears it.
 *
 * The rule itself lives in isContentDirty (projectFingerprint.ts): a saved
 * project compares against its baseline, an untitled session against the
 * default project. The tracker NEVER seeds a baseline from what is on screen —
 * that made a migrated session look clean, so Import could silently replace
 * unsaved pre-upgrade work because the dirty guard never fired.
 */
export function createDirtyTracker(
  api: DirtyTrackerApi,
  options: { scheduler?: WriteScheduler; fingerprint?: (content: ProjectContent) => string } = {},
): DirtyTracker {
  const scheduler = options.scheduler ?? idleWriteScheduler;
  const fingerprint = options.fingerprint ?? fingerprintContent;
  let handle: number | null = null;

  const cancel = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const pass = (): void => {
    handle = null;
    const state = api.getState();
    if (state.dirty) return;
    if (isContentDirty(buildProjectContent(state), state.currentProjectId, state.projectBaselineHash, fingerprint)) {
      api.setState({ dirty: true });
    }
  };

  const unsubscribe = api.subscribe(
    (s): ContentRefs => [s.bpm, s.meterId, s.masterVolume, s.effects, s.loops, s.projectBaselineHash, s.currentProjectId],
    () => {
      if (api.getState().dirty) return;
      if (handle === null) handle = scheduler.schedule(pass);
    },
    { equalityFn: shallow },
  );

  return {
    runNow: () => {
      cancel();
      pass();
    },
    stop: () => {
      cancel();
      unsubscribe();
    },
  };
}
```

- [ ] **Step 4: Wire it into `store.ts`**

After `export const useAppStore = create<AppStore>()(...)` add:

```ts
import { createDirtyTracker } from './projectDirty';

/** Idle-debounced dirty detection — see projectDirty.ts. Started once per tab. */
export const dirtyTracker = createDirtyTracker(useAppStore);
```

Then change the `pagehide` block (`src/store/store.ts:121-135`). Because `dirtyTracker` is defined after the store while the listeners are registered above it, move the listener registration **below** the tracker and make both events call one function:

```ts
/**
 * A tab killed mid-window would persist a stale `dirty: false`: the dirty
 * pass is forced synchronously first, then the buffered write goes out.
 */
export function flushBeforeHide(): void {
  dirtyTracker.runNow();
  flushPersistedWrites();
}

try {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flushBeforeHide);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushBeforeHide();
    });
  }
} catch {
  // ignore — a restricted embedding context may deny even addEventListener
}
```

Append to `src/store/store.test.ts`:

```ts
describe('flushBeforeHide', () => {
  test('runs the dirty pass before the persisted flush, so storage never carries a stale dirty:false', async () => {
    const { useAppStore, flushBeforeHide } = await getStore();
    useAppStore.getState().newProject();
    useAppStore.setState({ bpm: 133 });
    expect(useAppStore.getState().dirty).toBe(false); // not yet — idle-debounced
    flushBeforeHide();
    expect(useAppStore.getState().dirty).toBe(true);
    const stored = JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}');
    // Untitled after New: the baseline stays null; dirty came from the default-project comparison.
    expect(stored.state.projectBaselineHash).toBeNull();
    expect(stored.state.currentProjectId).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests, type-check and eslint**

Run: `bun test src/store/projectDirty.test.ts src/store/store.test.ts && bun run lint && bun run eslint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/projectDirty.ts src/store/projectDirty.test.ts src/store/store.ts src/store/store.test.ts
git commit -m "feat(project): detect unsaved changes in an idle pass, flushed before pagehide"
```

---

### Task 9: The Wordmark becomes the Project Manager button

**Files:**
- Modify: `src/components/ui/Wordmark.tsx` (whole file, 46 lines)
- Modify: `src/components/Header.tsx:14,231`
- Create: `src/components/ui/Wordmark.test.tsx`

**Interfaces:**
- Produces: `Wordmark` props gain `onClick?: () => void` and `dirty?: boolean`; `markOnly` / `className` / `textClassName` keep their meaning. The root element is a `<button type="button" aria-label="Open Project Manager">`.
- Consumes (Header): `s.dirty`, `s.setIsProjectManagerOpen` from the store.

- [ ] **Step 1: Write the failing test**

`src/components/ui/Wordmark.test.tsx` (props-driven, so the `getServerSnapshot` trap does not apply):

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  test('is a real button with the accessible label and a 44px target', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-label="Open Project Manager"');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html).toContain('h-8 w-8'); // the mark image is unchanged; padding lives on the button
  });

  test('shows a hover and focus-visible affordance from theme tokens', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain('hover:bg-base-200');
    expect(html).toContain('focus-visible:outline-primary');
  });

  test('renders the dirty badge only when dirty', () => {
    expect(renderToString(<Wordmark />)).not.toContain('Unsaved changes');
    const html = renderToString(<Wordmark dirty />);
    expect(html).toContain('indicator-item status status-warning status-sm');
    expect(html).toContain('aria-label="Unsaved changes"');
  });

  test('keeps the text props working', () => {
    expect(renderToString(<Wordmark textClassName="hidden sm:inline" />)).toContain('leading-none hidden sm:inline');
    expect(renderToString(<Wordmark markOnly />)).not.toContain('solna</span>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/ui/Wordmark.test.tsx`
Expected: FAIL — no `<button`, no badge.

- [ ] **Step 3: Rewrite `src/components/ui/Wordmark.tsx`**

```tsx
import React from "react";

interface WordmarkProps {
  /** Hide the "Solna" text and show the logo mark only. */
  markOnly?: boolean;
  className?: string;
  /**
   * Extra classes on the wordmark TEXT only. `markOnly` drops the text from the
   * DOM outright, which a media query cannot undo — this is the hook a caller
   * uses to hide it at one width and show it at another (the navbar passes
   * `hidden sm:inline`, which is what keeps its phone layout down to two rows).
   */
  textClassName?: string;
  /** Opens the Project Manager. The wordmark is the feature's only entry point. */
  onClick?: () => void;
  /** Unsaved changes: shows the corner dot on the mark. */
  dirty?: boolean;
}

/**
 * Brand wordmark AND the Project Manager button. A real <button> so keyboard
 * focus, Enter/Space and screen-reader semantics come for free. The mark image
 * stays 32px; the 44px tap target comes from the button's min size — below
 * `sm` the text is hidden and this is the whole target, so it is a
 * requirement, not polish. Typography mirrors murva's Wordmark.
 */
export const Wordmark: React.FC<WordmarkProps> = ({
  markOnly = false,
  className = "",
  textClassName = "",
  onClick,
  dirty = false,
}) => {
  return (
    <button
      type="button"
      aria-label="Open Project Manager"
      onClick={onClick}
      className={`inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5 rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      <span className="indicator">
        {dirty && (
          <span
            role="status"
            aria-label="Unsaved changes"
            className="indicator-item status status-warning status-sm"
          />
        )}
        <img
          src="/assets/favicon.svg"
          alt=""
          className="h-8 w-8"
          draggable={false}
        />
      </span>
      {!markOnly && (
        <span
          className={`text-2xl font-normal text-primary leading-none ${textClassName}`}
          style={{ letterSpacing: "0.08em" }}
        >
          solna
        </span>
      )}
    </button>
  );
};
```

(`alt=""` — the button already carries the accessible name; a second "Solna logo" label would be read twice.)

- [ ] **Step 4: Wire the Header**

In `src/components/Header.tsx`, next to the other selectors around line 168, add:

```tsx
  const dirty = useAppStore((s) => s.dirty);
  const setIsProjectManagerOpen = useAppStore((s) => s.setIsProjectManagerOpen);
```

and change line 231 to:

```tsx
        <Wordmark textClassName="hidden sm:inline" dirty={dirty} onClick={() => setIsProjectManagerOpen(true)} />
```

- [ ] **Step 5: Run the tests, the theme guard and the type-check**

Run: `bun test src/components/ui/Wordmark.test.tsx src/components/Header.test.tsx scripts/themeTokenGuard.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Wordmark.tsx src/components/ui/Wordmark.test.tsx src/components/Header.tsx
git commit -m "feat(ui): make the wordmark the Project Manager button with an unsaved badge"
```

---

### Task 10: File plumbing, relative time and the shared live-store hook

**Files:**
- Create: `src/utils/projectFile.ts`, `src/utils/projectFile.test.ts`
- Create: `src/utils/relativeTime.ts`, `src/utils/relativeTime.test.ts`
- Create: `src/components/ui/useLiveStore.ts`

**Interfaces:**
- Produces:
  - `slugifyProjectName(name: string): string` — lowercase, `[^a-z0-9]+` → `-`, trimmed, `'project'` when empty.
  - `projectFileName(name: string): string` → `${slug}.solna`
  - `downloadTextFile(fileName: string, text: string, mime: string, doc?: Document, url?: { createObjectURL(b: Blob): string; revokeObjectURL(u: string): void }): void`
  - `readFileAsText(file: Pick<File, 'text' | 'size'>): Promise<string>` — resolves `''` for a zero-byte file (which `parseProjectFile` then reports as malformed).
  - `formatRelativeTime(timestamp: number, now: number): string`
  - `useLiveStore<T>(selector: (state: AppStore) => T): T`

- [ ] **Step 1: Write the failing tests**

`src/utils/projectFile.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { downloadTextFile, projectFileName, readFileAsText, slugifyProjectName } from './projectFile';

describe('slugifyProjectName / projectFileName', () => {
  test('slugifies and appends .solna', () => {
    expect(slugifyProjectName('  Neon Highway 1984!  ')).toBe('neon-highway-1984');
    expect(slugifyProjectName('***')).toBe('project');
    expect(projectFileName('My Song')).toBe('my-song.solna');
  });
});

describe('downloadTextFile', () => {
  test('creates an anchor with the object URL and download name, clicks it, and revokes the URL', () => {
    const clicks: string[] = [];
    let revoked: string | null = null;
    const anchor = { href: '', download: '', click: () => clicks.push(anchor.href), remove: () => {} };
    const doc = { createElement: () => anchor, body: { appendChild: () => {} } } as unknown as Document;
    const url = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u: string) => { revoked = u; } };
    downloadTextFile('x.solna', '{}', 'application/json', doc, url);
    expect(anchor.download).toBe('x.solna');
    expect(clicks).toEqual(['blob:fake']);
    expect(revoked).toBe('blob:fake');
  });
});

describe('readFileAsText', () => {
  test('reads text and treats a zero-byte file as empty', async () => {
    expect(await readFileAsText({ size: 2, text: async () => '{}' })).toBe('{}');
    expect(await readFileAsText({ size: 0, text: async () => 'ignored' })).toBe('');
  });
});
```

`src/utils/relativeTime.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { formatRelativeTime } from './relativeTime';

const NOW = 1_700_000_000_000;
const s = 1000, m = 60 * s, h = 60 * m, d = 24 * h;

describe('formatRelativeTime', () => {
  test('buckets', () => {
    expect(formatRelativeTime(NOW - 5 * s, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 1 * m, NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(NOW - 2 * m, NOW)).toBe('2 minutes ago');
    expect(formatRelativeTime(NOW - 3 * h, NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(NOW - 30 * h, NOW)).toBe('yesterday');
    expect(formatRelativeTime(NOW - 5 * d, NOW)).toBe('5 days ago');
  });
  test('older than 30 days falls back to a date', () => {
    expect(formatRelativeTime(NOW - 45 * d, NOW)).toBe(new Date(NOW - 45 * d).toLocaleDateString());
  });
  test('a timestamp in the future reads as just now', () => {
    expect(formatRelativeTime(NOW + 5 * m, NOW)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/utils/projectFile.test.ts src/utils/relativeTime.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/utils/projectFile.ts`**

```ts
/**
 * Browser-side file I/O for `.solna` files. A Blob URL instead of the data
 * URL the preset libraries use: a project with many loops is far bigger than a
 * preset list, and data URLs have per-browser length limits.
 */
export function slugifyProjectName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project';
}

export function projectFileName(name: string): string {
  return `${slugifyProjectName(name)}.solna`;
}

interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export function downloadTextFile(
  fileName: string,
  text: string,
  mime: string,
  doc?: Document,
  url?: ObjectUrlApi,
): void {
  const d = doc ?? document;
  const u = url ?? URL;
  const href = u.createObjectURL(new Blob([text], { type: mime }));
  const anchor = d.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  d.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  u.revokeObjectURL(href);
}

/** A directory or a zero-byte pick reads as '' and is then reported as malformed. */
export async function readFileAsText(file: Pick<File, 'text' | 'size'>): Promise<string> {
  if (file.size === 0) return '';
  try {
    return await file.text();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Write `src/utils/relativeTime.ts`**

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 minutes ago" / "yesterday" for list rows; the absolute time goes in a title. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) {
    const n = Math.floor(diff / MINUTE);
    return `${n} minute${n === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return new Date(timestamp).toLocaleDateString();
}
```

- [ ] **Step 5: Write `src/components/ui/useLiveStore.ts`**

```ts
import { useSyncExternalStore } from 'react';
import { useAppStore } from '../../store/store';
import type { AppStore } from '../../store/types';

/**
 * Reads the store through useSyncExternalStore with getState() served for
 * BOTH snapshots. zustand's own hook serves getInitialState() as the server
 * snapshot, so under renderToString a plain useAppStore(selector) renders
 * creation-time values and a test's setState() has no effect — see
 * .claude/rules/testing.md and BottomInputDock.tsx.
 */
export function useLiveStore<T>(selector: (state: AppStore) => T): T {
  return useSyncExternalStore(
    useAppStore.subscribe,
    () => selector(useAppStore.getState()),
    () => selector(useAppStore.getState()),
  );
}
```

(`BottomInputDock.tsx` keeps its private copy; replacing it is optional and not part of this plan.)

- [ ] **Step 6: Run the tests, type-check and eslint**

Run: `bun test src/utils/projectFile.test.ts src/utils/relativeTime.test.ts && bun run lint && bun run eslint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/projectFile.ts src/utils/projectFile.test.ts src/utils/relativeTime.ts src/utils/relativeTime.test.ts src/components/ui/useLiveStore.ts
git commit -m "feat(project): add .solna file plumbing, relative timestamps and a live-store hook"
```

---

### Task 11: Project Manager flow — pure dialog sequencing

The modal has four dialogs that chain (dirty guard → name prompt → action; import → conflict → dirty guard → action). Keeping "which dialog comes next" in pure functions makes the sequencing testable without a DOM and keeps the modal component to rendering and dispatch.

**Files:**
- Create: `src/components/project/projectManagerFlow.ts`
- Create: `src/components/project/projectManagerFlow.test.ts`

**Interfaces:**
- Consumes: `ProjectBody`, `ProjectMeta` (Task 2), `ProjectStoreStatus` (Task 5).
- Produces:

```ts
export type ImportMode = 'new' | 'overwrite' | 'copy';
export type PendingAction =
  | { kind: 'open'; id: string }
  | { kind: 'new' }
  | { kind: 'import'; body: ProjectBody; mode: ImportMode };
export type NamePurpose = 'save' | 'save-copy' | 'export-session';
export type FlowDialog =
  | { kind: 'none' }
  | { kind: 'dirty-guard'; next: PendingAction }
  | { kind: 'name-prompt'; purpose: NamePurpose; initial: string; then: PendingAction | null }
  | { kind: 'delete-confirm'; project: ProjectMeta }
  | { kind: 'import-conflict'; body: ProjectBody; existing: ProjectMeta };
export const NO_DIALOG: FlowDialog;
export function guardAction(dirty: boolean, action: PendingAction): FlowDialog;
export function importDialog(body: ProjectBody, list: readonly ProjectMeta[], dirty: boolean): FlowDialog;
export function saveDialog(currentProjectId: string | null, then: PendingAction | null): FlowDialog; // 'none' = save directly
export function nameDefault(purpose: NamePurpose, currentName: string | null): string;
export function isValidProjectName(name: string): boolean;
export function sessionLabel(currentProjectId: string | null, currentProjectName: string | null): string;
export function storageDisabled(status: ProjectStoreStatus): boolean;
```

- [ ] **Step 1: Write the failing test**

`src/components/project/projectManagerFlow.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  guardAction,
  importDialog,
  isValidProjectName,
  nameDefault,
  saveDialog,
  sessionLabel,
  storageDisabled,
} from './projectManagerFlow';
import { factoryProjectContent, makeEnvelope } from '../../store/projectFormat';

const body = { ...makeEnvelope('File', 2000), content: factoryProjectContent() };

describe('guardAction', () => {
  test('a clean session runs the action; a dirty one shows the guard first', () => {
    expect(guardAction(false, { kind: 'new' })).toEqual({ kind: 'none' });
    expect(guardAction(true, { kind: 'open', id: 'p' })).toEqual({ kind: 'dirty-guard', next: { kind: 'open', id: 'p' } });
  });
});

describe('importDialog', () => {
  test('a matching id shows the conflict dialog before anything else', () => {
    const existing = { ...makeEnvelope('Mine', 1000), id: body.id };
    expect(importDialog(body, [existing], true)).toEqual({ kind: 'import-conflict', body, existing });
  });
  test('a new id goes straight to the guarded import', () => {
    expect(importDialog(body, [], true)).toEqual({ kind: 'dirty-guard', next: { kind: 'import', body, mode: 'new' } });
    expect(importDialog(body, [], false)).toEqual({ kind: 'none' });
  });
});

describe('saveDialog', () => {
  test('no current project prompts for a name, carrying the follow-up action', () => {
    expect(saveDialog(null, { kind: 'new' })).toEqual({
      kind: 'name-prompt', purpose: 'save', initial: 'Untitled project', then: { kind: 'new' },
    });
    expect(saveDialog('p-1', null)).toEqual({ kind: 'none' });
  });
});

describe('nameDefault / isValidProjectName / sessionLabel / storageDisabled', () => {
  test('defaults per purpose', () => {
    expect(nameDefault('save', null)).toBe('Untitled project');
    expect(nameDefault('save-copy', 'Alpha')).toBe('Alpha copy');
    expect(nameDefault('save-copy', null)).toBe('Untitled project copy');
    expect(nameDefault('export-session', 'Alpha')).toBe('Alpha');
    expect(nameDefault('export-session', null)).toBe('Untitled project');
  });
  test('empty or whitespace names are rejected; duplicates are not a concern here', () => {
    expect(isValidProjectName('')).toBe(false);
    expect(isValidProjectName('   ')).toBe(false);
    expect(isValidProjectName(' a ')).toBe(true);
  });
  test('session label', () => {
    expect(sessionLabel(null, null)).toBe('Unsaved session');
    expect(sessionLabel('p', 'Alpha')).toBe('Alpha');
    expect(sessionLabel('p', null)).toBe('Unnamed project');
  });
  test('storage is disabled only when known unavailable', () => {
    expect(storageDisabled('unavailable')).toBe(true);
    expect(storageDisabled('ready')).toBe(false);
    expect(storageDisabled('unknown')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/project/projectManagerFlow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/project/projectManagerFlow.ts`**

```ts
import type { ProjectBody, ProjectMeta } from '../../store/projectFormat';
import type { ProjectStoreStatus } from '../../store/projectStore';

export type ImportMode = 'new' | 'overwrite' | 'copy';

export type PendingAction =
  | { kind: 'open'; id: string }
  | { kind: 'new' }
  | { kind: 'import'; body: ProjectBody; mode: ImportMode };

export type NamePurpose = 'save' | 'save-copy' | 'export-session';

export type FlowDialog =
  | { kind: 'none' }
  | { kind: 'dirty-guard'; next: PendingAction }
  | { kind: 'name-prompt'; purpose: NamePurpose; initial: string; then: PendingAction | null }
  | { kind: 'delete-confirm'; project: ProjectMeta }
  | { kind: 'import-conflict'; body: ProjectBody; existing: ProjectMeta };

export const NO_DIALOG: FlowDialog = { kind: 'none' };
export const UNTITLED = 'Untitled project';

/** Any action that replaces the live session runs the dirty guard first. */
export function guardAction(dirty: boolean, action: PendingAction): FlowDialog {
  return dirty ? { kind: 'dirty-guard', next: action } : NO_DIALOG;
}

/** Same id already stored -> conflict dialog; otherwise a guarded import-as-new. */
export function importDialog(body: ProjectBody, list: readonly ProjectMeta[], dirty: boolean): FlowDialog {
  const existing = list.find((m) => m.id === body.id);
  if (existing) return { kind: 'import-conflict', body, existing };
  return guardAction(dirty, { kind: 'import', body, mode: 'new' });
}

/** Save with no current project behaves as Save As: prompt, then continue with `then`. */
export function saveDialog(currentProjectId: string | null, then: PendingAction | null): FlowDialog {
  if (currentProjectId) return NO_DIALOG;
  return { kind: 'name-prompt', purpose: 'save', initial: UNTITLED, then };
}

export function nameDefault(purpose: NamePurpose, currentName: string | null): string {
  const base = currentName ?? UNTITLED;
  return purpose === 'save-copy' ? `${base} copy` : purpose === 'save' ? UNTITLED : base;
}

/** Empty or whitespace-only is rejected; duplicates are allowed (id is the identity). */
export function isValidProjectName(name: string): boolean {
  return name.trim().length > 0;
}

export function sessionLabel(currentProjectId: string | null, currentProjectName: string | null): string {
  if (!currentProjectId) return 'Unsaved session';
  return currentProjectName ?? 'Unnamed project';
}

export function storageDisabled(status: ProjectStoreStatus): boolean {
  return status === 'unavailable';
}
```

- [ ] **Step 4: Run the test, type-check and eslint**

Run: `bun test src/components/project/projectManagerFlow.test.ts && bun run lint && bun run eslint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/project/projectManagerFlow.ts src/components/project/projectManagerFlow.test.ts
git commit -m "feat(project): sequence the Project Manager dialogs in pure helpers"
```

---

### Task 12: Project Manager modal, list rows and dialogs

**Files:**
- Create: `src/components/project/ProjectDialogs.tsx`
- Create: `src/components/project/ProjectList.tsx`
- Create: `src/components/project/ProjectManagerModal.tsx`
- Create: `src/components/project/ProjectManagerModal.test.tsx`
- Create: `src/components/project/ProjectList.test.tsx`
- Modify: `src/App.tsx:9,183`

**Interfaces:**
- Consumes: Tasks 7, 10, 11; `parseProjectFile`, `serializeProject`, `PROJECT_FILE_ACCEPT`, `PROJECT_FILE_MIME` (Task 3); `SECTION_HEADER` (`src/components/ui/fieldClasses.ts:65`); `lucide-react` icons `Download`, `Upload`, `MoreVertical`, `Trash2`, `FolderOpen`, `Save`, `Copy`, `FilePlus`, `X`.
- Produces: `ProjectManagerModal: React.FC`, `ProjectList: React.FC<ProjectListProps>`, and the four dialogs:

```ts
interface NamePromptDialogProps { title: string; initial: string; confirmLabel: string; onConfirm(name: string): void; onCancel(): void }
interface DirtyGuardDialogProps { onDiscard(): void; onCancel(): void; onSaveAndContinue(): void }
interface DeleteConfirmDialogProps { name: string; onConfirm(): void; onCancel(): void }
interface ImportConflictDialogProps { existing: ProjectMeta; incoming: ProjectMeta; onOverwrite(): void; onCopy(): void; onCancel(): void }
interface ProjectListProps { projects: ProjectMeta[]; currentProjectId: string | null; now: number; disabled: boolean; onOpen(id: string): void; onRename(id: string, name: string): void; onExport(id: string): void; onDelete(project: ProjectMeta): void }
```

- [ ] **Step 1: Write the failing markup tests**

`src/components/project/ProjectList.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProjectList } from './ProjectList';
import { makeEnvelope } from '../../store/projectFormat';

const noop = () => {};
const NOW = 1_700_000_000_000;
const a = { ...makeEnvelope('Alpha', NOW - 120_000), id: 'a' };
const b = { ...makeEnvelope('Beta', NOW - 90_000_000), id: 'b' };

describe('ProjectList', () => {
  test('empty state points at Save and never renders a row', () => {
    const html = renderToString(<ProjectList projects={[]} currentProjectId={null} now={NOW} disabled={false} onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html).toContain('not yet a project');
    expect(html).not.toContain('btn btn-sm btn-primary');
  });

  test('a row shows the name, the relative time with an absolute title, Open, and a kebab with Export and Delete', () => {
    const html = renderToString(<ProjectList projects={[a, b]} currentProjectId="a" now={NOW} disabled={false} onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html).toContain('Alpha');
    expect(html).toContain('2 minutes ago');
    expect(html).toContain(`title="${new Date(a.updatedAt).toLocaleString()}"`);
    expect(html).toContain('badge badge-sm badge-primary');
    expect(html).toContain('>Current<');
    expect(html).toContain('dropdown dropdown-end');
    expect(html).toContain('dropdown-content menu');
    expect(html).toContain('>Export<');
    expect(html).toContain('>Delete<');
    expect(html).toContain('aria-label="More actions for Alpha"');
  });

  test('the Current badge is only on the matching row', () => {
    const html = renderToString(<ProjectList projects={[a, b]} currentProjectId="b" now={NOW} disabled={false} onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html.split('>Current<').length - 1).toBe(1);
  });
});
```

`src/components/project/ProjectManagerModal.test.tsx` (store-driven — the component reads through `useLiveStore`, so `setState` before `renderToString` is honoured):

```tsx
import { beforeAll, describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';

let ProjectManagerModal: React.FC;
let useAppStore: typeof import('../../store/store').useAppStore;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  ({ useAppStore } = await import('../../store/store'));
  ({ ProjectManagerModal } = await import('./ProjectManagerModal'));
});

describe('ProjectManagerModal', () => {
  test('renders nothing while closed', () => {
    useAppStore.setState({ isProjectManagerOpen: false });
    expect(renderToString(<ProjectManagerModal />)).toBe('');
  });

  test('an unsaved session shows the label, Save, Save as new copy, New, Import and Export current session', () => {
    useAppStore.setState({ isProjectManagerOpen: true, currentProjectId: null, currentProjectName: null, dirty: false, projectStoreStatus: 'ready', projectList: [] });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('<dialog class="modal modal-open"');
    expect(html).toContain('Unsaved session');
    expect(html).toContain('>Save<');
    expect(html).toContain('>Save as new copy<');
    expect(html).toContain('>New<');
    expect(html).toContain('accept=".solna,.json"');
    expect(html).toContain('>Export current session<');
    expect(html).toContain('<form method="dialog" class="modal-backdrop"');
  });

  test('a dirty named project shows the name and the unsaved marker', () => {
    useAppStore.setState({ isProjectManagerOpen: true, currentProjectId: 'p', currentProjectName: 'Alpha', dirty: true, projectStoreStatus: 'ready' });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('Alpha');
    expect(html).toContain('Unsaved changes');
  });

  test('storage unavailable: notice shown, Save disabled with a tooltip, list disabled, import and export still enabled', () => {
    useAppStore.setState({ isProjectManagerOpen: true, currentProjectId: 'p', currentProjectName: null, projectStoreStatus: 'unavailable', projectList: [] });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('Unnamed project');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Project storage is unavailable');
    expect(html).toContain('data-tip="Export the session to keep your work"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('id="project-import-button" disabled');
    expect(html).not.toContain('id="project-export-session" disabled');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/project/ProjectList.test.tsx src/components/project/ProjectManagerModal.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/components/project/ProjectDialogs.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import type { ProjectMeta } from '../../store/projectFormat';
import { isValidProjectName } from './projectManagerFlow';

/** Shared shell: a daisyUI modal stacked above the manager (MidiSettingsModal pattern). */
const Shell: React.FC<{ title: string; onCancel: () => void; children: React.ReactNode }> = ({ title, onCancel, children }) => (
  <dialog className="modal modal-open" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
    <div className="modal-box max-w-md bg-base-100 border border-base-300 shadow-2xl space-y-4">
      <h3 className="font-bold text-lg">{title}</h3>
      {children}
    </div>
    <form method="dialog" className="modal-backdrop">
      <button type="button" onClick={onCancel}>close</button>
    </form>
  </dialog>
);

export const NamePromptDialog: React.FC<{
  title: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}> = ({ title, initial, confirmLabel, onConfirm, onCancel }) => {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const valid = isValidProjectName(name);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (valid) onConfirm(name.trim());
  };
  return (
    <Shell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          aria-invalid={!valid}
          className={`input w-full ${valid ? '' : 'input-error'}`}
        />
        {!valid && <p className="text-xs text-error">A name is required.</p>}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>{confirmLabel}</button>
        </div>
      </form>
    </Shell>
  );
};

export const DirtyGuardDialog: React.FC<{
  onDiscard: () => void;
  onCancel: () => void;
  onSaveAndContinue: () => void;
}> = ({ onDiscard, onCancel, onSaveAndContinue }) => (
  <Shell title="Unsaved changes" onCancel={onCancel}>
    <p className="text-sm">This session has unsaved changes. Save them before continuing?</p>
    <div className="modal-action">
      <button type="button" className="btn btn-ghost text-error" onClick={onDiscard}>Discard</button>
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={onSaveAndContinue}>Save &amp; Continue</button>
    </div>
  </Shell>
);

export const DeleteConfirmDialog: React.FC<{ name: string; onConfirm: () => void; onCancel: () => void }> = ({ name, onConfirm, onCancel }) => (
  <Shell title="Delete project" onCancel={onCancel}>
    <p className="text-sm">Delete <strong>{name}</strong>? This cannot be undone.</p>
    <div className="modal-action">
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn btn-error" onClick={onConfirm}>Delete</button>
    </div>
  </Shell>
);

export const ImportConflictDialog: React.FC<{
  existing: ProjectMeta;
  incoming: ProjectMeta;
  onOverwrite: () => void;
  onCopy: () => void;
  onCancel: () => void;
}> = ({ existing, incoming, onOverwrite, onCopy, onCancel }) => (
  <Shell title="Import project" onCancel={onCancel}>
    <p className="text-sm">A project with this id already exists.</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="opacity-60">existing</dt>
      <dd>{existing.name} — {new Date(existing.updatedAt).toLocaleString()}</dd>
      <dt className="opacity-60">in file</dt>
      <dd>{incoming.name} — {new Date(incoming.updatedAt).toLocaleString()}</dd>
    </dl>
    <div className="modal-action">
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn" onClick={onCopy}>Import as Copy</button>
      <button type="button" className="btn btn-error" onClick={onOverwrite}>Overwrite</button>
    </div>
  </Shell>
);
```

- [ ] **Step 4: Write `src/components/project/ProjectList.tsx`**

```tsx
import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { ProjectMeta } from '../../store/projectFormat';
import { formatRelativeTime } from '../../utils/relativeTime';
import { isValidProjectName } from './projectManagerFlow';

export interface ProjectListProps {
  projects: ProjectMeta[];
  currentProjectId: string | null;
  now: number;
  disabled: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onExport: (id: string) => void;
  onDelete: (project: ProjectMeta) => void;
}

/** Click the name to rename in place. Enter/blur commit, Escape cancels. */
const InlineName: React.FC<{ name: string; disabled: boolean; onCommit: (name: string) => void }> = ({ name, disabled, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (isValidProjectName(next) && next !== name) onCommit(next);
    else setDraft(name);
  };
  if (!editing) {
    return (
      <button
        type="button"
        className="text-left font-semibold truncate hover:underline disabled:no-underline"
        title="Click to rename"
        disabled={disabled}
        onClick={() => { setDraft(name); setEditing(true); }}
      >
        {name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      aria-label="Project name"
      className="input input-sm w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(name); setEditing(false); }
      }}
    />
  );
};

export const ProjectList: React.FC<ProjectListProps> = ({ projects, currentProjectId, now, disabled, onOpen, onRename, onExport, onDelete }) => {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-base-content/70 rounded-box border border-dashed border-base-300 p-4">
        The current session is not yet a project. Use <strong>Save</strong> above to keep it on this device, or import a <code>.solna</code> file.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-base-300 rounded-box border border-base-300">
      {projects.map((p) => (
        <li key={p.id} className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <InlineName name={p.name} disabled={disabled} onCommit={(name) => onRename(p.id, name)} />
              {p.id === currentProjectId && <span className="badge badge-sm badge-primary">Current</span>}
            </div>
            <time className="text-xs text-base-content/60" dateTime={new Date(p.updatedAt).toISOString()} title={new Date(p.updatedAt).toLocaleString()}>
              {formatRelativeTime(p.updatedAt, now)}
            </time>
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={disabled} onClick={() => onOpen(p.id)}>Open</button>
          <div className="dropdown dropdown-end">
            <button type="button" tabIndex={0} className="btn btn-sm btn-ghost btn-square" aria-label={`More actions for ${p.name}`} disabled={disabled}>
              <MoreVertical className="w-4 h-4" />
            </button>
            <ul tabIndex={-1} className="dropdown-content menu bg-base-100 rounded-box z-10 w-40 p-2 shadow-sm border border-base-300">
              <li><button type="button" onClick={() => onExport(p.id)}>Export</button></li>
              <li><button type="button" className="text-error" onClick={() => onDelete(p)}>Delete</button></li>
            </ul>
          </div>
        </li>
      ))}
    </ul>
  );
};
```

- [ ] **Step 5: Write `src/components/project/ProjectManagerModal.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Download, FilePlus, Save, Upload, X } from 'lucide-react';
import { useLiveStore } from '../ui/useLiveStore';
import { SECTION_HEADER } from '../ui/fieldClasses';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject } from '../../store/projectFile';
import type { ProjectBody } from '../../store/projectFormat';
import { downloadTextFile, projectFileName, readFileAsText } from '../../utils/projectFile';
import { ProjectList } from './ProjectList';
import { DeleteConfirmDialog, DirtyGuardDialog, ImportConflictDialog, NamePromptDialog } from './ProjectDialogs';
import {
  NO_DIALOG,
  guardAction,
  importDialog,
  nameDefault,
  saveDialog,
  sessionLabel,
  storageDisabled,
  type FlowDialog,
  type PendingAction,
} from './projectManagerFlow';

const EXPORT_TIP = 'Export the session to keep your work';

export const ProjectManagerModal: React.FC = () => {
  const isOpen = useLiveStore((s) => s.isProjectManagerOpen);
  const setIsOpen = useLiveStore((s) => s.setIsProjectManagerOpen);
  const currentProjectId = useLiveStore((s) => s.currentProjectId);
  const currentProjectName = useLiveStore((s) => s.currentProjectName);
  const dirty = useLiveStore((s) => s.dirty);
  const status = useLiveStore((s) => s.projectStoreStatus);
  const projectList = useLiveStore((s) => s.projectList);
  const notice = useLiveStore((s) => s.projectNotice);
  const setNotice = useLiveStore((s) => s.setProjectNotice);
  const refreshProjects = useLiveStore((s) => s.refreshProjects);
  const newProject = useLiveStore((s) => s.newProject);
  const openProject = useLiveStore((s) => s.openProject);
  const saveProject = useLiveStore((s) => s.saveProject);
  const saveProjectAs = useLiveStore((s) => s.saveProjectAs);
  const renameProject = useLiveStore((s) => s.renameProject);
  const deleteProject = useLiveStore((s) => s.deleteProject);
  const importProject = useLiveStore((s) => s.importProject);
  const exportStoredProject = useLiveStore((s) => s.exportStoredProject);
  const buildSessionExport = useLiveStore((s) => s.buildSessionExport);

  const [dialog, setDialog] = useState<FlowDialog>(NO_DIALOG);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Availability and the current name are resolved lazily, on first open.
  useEffect(() => {
    if (isOpen) void refreshProjects();
  }, [isOpen, refreshProjects]);

  if (!isOpen) return null;

  const disabled = storageDisabled(status);
  const close = () => { setDialog(NO_DIALOG); setIsOpen(false); };
  const report = (message: string | null) => setNotice(message);

  const runAction = async (action: PendingAction) => {
    setDialog(NO_DIALOG);
    if (action.kind === 'new') { newProject(); return; }
    if (action.kind === 'open') {
      const r = await openProject(action.id);
      if (r.ok) close(); else report(r.message);
      return;
    }
    const r = await importProject(action.body, action.mode);
    if (!r.ok) { report(r.message); return; }
    const warnings = parseProjectFile(serializeProject(action.body));
    report(warnings.ok && warnings.warnings.length > 0 ? `Imported with unrecognised references: ${warnings.warnings.join(', ')}` : null);
    close();
  };

  /** The full Save path: prompt for a name when there is no current project. */
  const save = async (then: PendingAction | null) => {
    const next = saveDialog(currentProjectId, then);
    if (next.kind !== 'none') { setDialog(next); return; }
    const r = await saveProject();
    if (!r.ok) { report(r.message); setDialog(NO_DIALOG); return; } // the original action is abandoned
    report(null);
    if (then) await runAction(then); else setDialog(NO_DIALOG);
  };

  const requestAction = (action: PendingAction) => {
    const next = guardAction(dirty, action);
    if (next.kind === 'none') void runAction(action); else setDialog(next);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseProjectFile(await readFileAsText(file));
    if (!parsed.ok) { report(parsed.message); return; }
    const next = importDialog(parsed.body, projectList, dirty);
    if (next.kind === 'none') void runAction({ kind: 'import', body: parsed.body, mode: 'new' }); else setDialog(next);
  };

  const download = (body: ProjectBody) => downloadTextFile(projectFileName(body.name), serializeProject(body), PROJECT_FILE_MIME);

  const exportRow = async (id: string) => {
    const r = await exportStoredProject(id);
    if (r.ok) download(r.value); else report(r.message);
  };

  const exportSession = () => {
    if (currentProjectId) { download(buildSessionExport('', Date.now())); return; }
    setDialog({ kind: 'name-prompt', purpose: 'export-session', initial: nameDefault('export-session', currentProjectName), then: null });
  };

  const onNameConfirmed = async (name: string) => {
    if (dialog.kind !== 'name-prompt') return;
    const { purpose, then } = dialog;
    if (purpose === 'export-session') { download(buildSessionExport(name, Date.now())); setDialog(NO_DIALOG); return; }
    const r = await saveProjectAs(name);
    if (!r.ok) { report(r.message); setDialog(NO_DIALOG); return; }
    report(null);
    if (then) await runAction(then); else setDialog(NO_DIALOG);
  };

  return (
    <>
      <dialog className="modal modal-open" onCancel={(e) => { e.preventDefault(); close(); }}>
        <div className="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Projects</h2>
            <button type="button" className="btn btn-sm btn-ghost btn-square" aria-label="Close" onClick={close}><X className="w-4 h-4" /></button>
          </div>

          {disabled && (
            <div role="alert" className="alert alert-warning text-sm">
              Project storage is unavailable on this device (private browsing or blocked site storage). Export still works.
            </div>
          )}
          {notice && (
            <div role="status" className="alert text-sm">
              <span className="flex-1">{notice}</span>
              <button type="button" className="btn btn-xs btn-ghost" onClick={() => report(null)}>Dismiss</button>
            </div>
          )}

          <section className="space-y-2">
            <h3 className={SECTION_HEADER}>Current session</h3>
            <p className="font-semibold">
              {sessionLabel(currentProjectId, currentProjectName)}
              {dirty && <span className="ml-2 badge badge-sm badge-warning">Unsaved changes</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <div className={disabled ? 'tooltip' : ''} data-tip={disabled ? EXPORT_TIP : undefined}>
                <button type="button" className="btn btn-sm btn-primary gap-1" disabled={disabled} onClick={() => void save(null)}><Save className="w-4 h-4" />Save</button>
              </div>
              <div className={disabled ? 'tooltip' : ''} data-tip={disabled ? EXPORT_TIP : undefined}>
                <button type="button" className="btn btn-sm gap-1" disabled={disabled} onClick={() => setDialog({ kind: 'name-prompt', purpose: 'save-copy', initial: nameDefault('save-copy', currentProjectName), then: null })}>Save as new copy</button>
              </div>
              <button type="button" className="btn btn-sm gap-1" onClick={() => requestAction({ kind: 'new' })}><FilePlus className="w-4 h-4" />New</button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className={SECTION_HEADER}>Import</h3>
            <button id="project-import-button" type="button" className="btn btn-sm gap-1" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4" />Import .solna file</button>
            <input ref={fileInputRef} type="file" accept={PROJECT_FILE_ACCEPT} className="hidden" onChange={(e) => void onImportFile(e)} />
          </section>

          <section className="space-y-2">
            <h3 className={SECTION_HEADER}>Projects on this device</h3>
            <ProjectList
              projects={projectList}
              currentProjectId={currentProjectId}
              now={Date.now()}
              disabled={disabled}
              onOpen={(id) => requestAction({ kind: 'open', id })}
              onRename={(id, name) => void renameProject(id, name).then((r) => { if (!r.ok) report(r.message); })}
              onExport={(id) => void exportRow(id)}
              onDelete={(project) => setDialog({ kind: 'delete-confirm', project })}
            />
          </section>

          <section className="border-t border-base-300 pt-4">
            <p className="text-xs text-base-content/60 mb-2">Writes what you are hearing right now, including unsaved edits. A row's Export writes the file as last saved.</p>
            <button id="project-export-session" type="button" className="btn btn-sm btn-outline gap-1" onClick={exportSession}><Download className="w-4 h-4" />Export current session</button>
          </section>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={close}>close</button>
        </form>
      </dialog>

      {dialog.kind === 'dirty-guard' && (
        <DirtyGuardDialog
          onDiscard={() => void runAction(dialog.next)}
          onCancel={() => setDialog(NO_DIALOG)}
          onSaveAndContinue={() => void save(dialog.next)}
        />
      )}
      {dialog.kind === 'name-prompt' && (
        <NamePromptDialog
          title={dialog.purpose === 'export-session' ? 'Export current session' : dialog.purpose === 'save-copy' ? 'Save as new copy' : 'Save project'}
          initial={dialog.initial}
          confirmLabel={dialog.purpose === 'export-session' ? 'Export' : 'Save'}
          onConfirm={(name) => void onNameConfirmed(name)}
          onCancel={() => setDialog(NO_DIALOG)}
        />
      )}
      {dialog.kind === 'delete-confirm' && (
        <DeleteConfirmDialog
          name={dialog.project.name}
          onConfirm={() => void deleteProject(dialog.project.id).then((r) => { setDialog(NO_DIALOG); if (!r.ok) report(r.message); })}
          onCancel={() => setDialog(NO_DIALOG)}
        />
      )}
      {dialog.kind === 'import-conflict' && (
        <ImportConflictDialog
          existing={dialog.existing}
          incoming={dialog.body}
          onOverwrite={() => { const next = guardAction(dirty, { kind: 'import', body: dialog.body, mode: 'overwrite' }); next.kind === 'none' ? void runAction({ kind: 'import', body: dialog.body, mode: 'overwrite' }) : setDialog(next); }}
          onCopy={() => { const next = guardAction(dirty, { kind: 'import', body: dialog.body, mode: 'copy' }); next.kind === 'none' ? void runAction({ kind: 'import', body: dialog.body, mode: 'copy' }) : setDialog(next); }}
          onCancel={() => setDialog(NO_DIALOG)}
        />
      )}
    </>
  );
};
```

Two notes for the implementer: (1) the import warnings are recomputed by re-parsing the body — that is deliberate, so the notice text has one source (`unknownLibraryReferences` in `projectFile.ts`); if eslint flags the ternary-statement in the conflict handlers, rewrite them as `if`/`else`. (2) `save(then)` must never be called when `disabled` — the buttons are disabled, and the dirty guard's `Save & Continue` reaches `saveProject()` which resolves `unavailable` and abandons the action, which matches the spec ("if that save fails, the original action is abandoned").

- [ ] **Step 6: Mount the modal in `src/App.tsx`**

Add `import { ProjectManagerModal } from './components/project/ProjectManagerModal';` after line 9 and render `<ProjectManagerModal />` immediately after `<MidiSettingsModal />` (line 183).

- [ ] **Step 7: Run the markup tests, the theme guard, the type-check and eslint**

Run: `bun test src/components/project scripts/themeTokenGuard.test.ts && bun run lint && bun run eslint`
Expected: PASS. If a substring assertion fails on attribute order, adjust the assertion to the actual rendered string — the assertions pin classes, not attribute order.

- [ ] **Step 8: Commit**

```bash
git add src/components/project src/App.tsx
git commit -m "feat(project): add the Project Manager modal with open, save, import, export and delete"
```

---

### Task 13: Integration — the gate, eslint, and an in-browser pass

**Files:**
- No new files. Fixes only, wherever the gate points.

- [ ] **Step 1: Run the gate and eslint**

Run: `bun run verify && bun run eslint`
Expected: every test passes, `tsc` is clean, `check:keys` and `check:drums` pass, the build succeeds, eslint reports no errors (the `complexity` rule is `warn` — fix any warning it raises on `ProjectManagerModal` by extracting the conflict-dialog handlers into a small `importWithMode(mode)` closure).

- [ ] **Step 2: In-browser pass (`bun run dev`, then open `http://localhost:3000`)**

Check each line and fix anything that does not hold:

1. The wordmark is a button; Tab reaches it, Enter opens the manager; hover shows a background; the tap target is at least 44px tall at a phone width.
2. Turn a knob, wait a beat: the dot appears on the mark; open the manager: "Unsaved changes" is shown.
3. Save → name prompt pre-filled "Untitled project", focused and selected; empty name rejected inline; save → dot clears, row appears, "Current" badge on it.
4. Turn a knob, click Open on the row while playback runs: the dirty guard appears; Cancel leaves everything; Discard stops playback and reloads the saved sound; the vibe chip is unlit afterwards; `controlTarget` and the metronome are unchanged.
5. Rename inline: Enter commits, Escape cancels, "updated" time bumps, the session name updates, dirty is unchanged.
6. Delete the current project: the confirm names it; after confirming, the music stays on screen, the label is "Unsaved session", the dot is on.
7. Row Export downloads `<slug>.solna` with the **saved** bpm; Export current session downloads the **live** bpm and does not clear the dot.
8. Import the row's file back: the id-conflict dialog shows both timestamps; Import as Copy creates "<name> (imported)" and opens it; Overwrite replaces it.
9. Edit a `.solna` in a text editor to `"formatVersion": 2` and import: refused with the newer-version message. Set `"soundKit": "Nope"`: imports, plays with the default kit, notice lists `drum kit "Nope"`.
10. Reload the tab mid-edit: the dot is still on and the same project name shows after opening the manager (persist v9 + `flushBeforeHide`).
11. DevTools → Application → IndexedDB → `solna-projects`: two stores, `projectMeta` rows carry no `content`.
12. Safari private window (or DevTools "block storage"): the app runs, the manager shows the unavailable notice, Save is disabled with the tooltip, Import opens a file into the session with "Unsaved session" shown, Export works.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(project): integration fixes from the verify gate and the in-browser pass"
```

(Skip if there is nothing to commit.)

---

## Self-review

**Spec coverage** — every section of the spec maps to a task:

| Spec section | Task |
| --- | --- |
| File format v1 — envelope, content, exclusions, provenance, `.solna` is JSON | 2, 3 |
| Storage design — two stores, one transaction, read-repair (key-only), IndexedDB can throw, lazy availability, degraded mode | 5 (backend), 7 (`importProject` when unavailable), 12 (notice, disabled Save + tooltip, Import/Export still on) |
| Lifecycle: Launch | 6 (identity persisted), 7 (`refreshProjects` resolves the name lazily; stale id → unsaved session, no dialog) |
| Lifecycle: New / Open / Save / Save as new copy / Rename / Delete / Export (row) / Export current session / Import | 7 (actions), 11 (dialog sequencing), 12 (UI) |
| Reset rules for excluded fields; flat per-loop keys in the same `set()`; playback stopped first | 2 (`applyProjectContent`), 7 (`install` → `hardStopAll` then one `set()`) |
| Dirty detection — content-only comparison, fingerprint baseline (saved) / default-project target (untitled), idle-debounced, one boolean, early-out when dirty, `pagehide` sync | 4 (`isContentDirty`), 7 (`install` / `newProject` / `deleteProject` keep the baseline null for untitled), 8 |
| Reset rules — playback stopped first **and** chord/bass voice tails cut before the swap, in `loadLoop`'s order | 7 (`install`, with the ordered-spy tests) |
| Persist migration v8 → v9 — `migrateAddProjectIdentity`, chain composition, sanitisation, name not persisted | 6 |
| UI: Wordmark button, aria-label, hover/focus affordance, dirty dot with label, 44px target, props preserved | 9 |
| UI: modal sections in order, list row (inline rename, relative time + title, Current, Open, kebab with Export/Delete), the five dialogs | 12 |
| Error and edge cases — unavailable, quota (dirty kept), malformed, newer version, older version chain, wrong-typed content, empty loops, unknown library ids kept + notice, two tabs (no work), directory / zero-byte file | 3 (parse + migrate chain), 5 (quota), 7 (failed save keeps dirty), 10 (`readFileAsText` zero-byte → `''`), 12 (notice) |
| Testing notes — serialization round-trip + absence, pinned key set, reset rules, provenance, fingerprint stability, dirty scheduling with a counting spy, table-driven validation, persist migration, in-memory IndexedDB fake + unavailable path, `flushPersistedWrites` before storage asserts, Wordmark markup | 2, 3, 4, 5, 6, 8, 9 (each test is in the task) |
| Non-goals | not implemented, by design |

**Placeholder scan** — no "TBD"/"TODO"/"similar to Task N"; every code step has its code; every referenced symbol is defined in a task or cited with `path:line`.

**Decisions revised after review** — (1) no seeded baseline: untitled sessions compare against `defaultContentFingerprint()`; `projectBaselineHash` is `null` for them and the v9 migration leaves it `null`. (2) `install` cuts chord and bass voices via `audioEngine.stopSource` between `hardStopAll()` and the `set()`, exactly as `loadLoop.ts:79-83`.

**Type consistency** — `isContentDirty(content, currentProjectId, projectBaselineHash, fingerprint?)` is defined in Task 4 and called with that argument order in Tasks 7 and 8; `ProjectStoreResult<T>` shape (`ok`/`value` vs `ok`/`error`/`message`) is the same in Tasks 5, 7, 11, 12; `applyProjectContent` returns `ProjectOpenPatch` used by `install` in Task 7; `createProjectSlice(set, get, projectStore, now)` matches its use in `store.ts` and both test files; `buildSessionExport(name, now)` takes two arguments everywhere; `importProject(body, mode)` returns `ProjectStoreResult<ProjectMeta | null>` and Task 12 only reads `ok`/`message`; `FlowDialog` variants in Task 11 match every `setDialog` call in Task 12; `useLiveStore` (Task 10) is what Task 12 imports.
