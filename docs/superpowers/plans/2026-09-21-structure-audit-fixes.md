# Structure Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness and performance findings of the structure audit that the user selected (A1, D1, S5, S3/A2, S4, U5, S6+U8, S8, U6, S2), then bring `CLAUDE.md`, the `dsp-audio` skill and the audit pages back in line with the code.

**Architecture:** Each fix is a small, test-first change inside the existing layering. No new layers or libraries. Two new modules: a playhead-beat pub/sub beside `playbackStep.ts` (`src/components/playheadBeat.ts`), and a de-duplicating persist storage (`src/store/persistStorage.ts`). A few slice actions gain pure `…Patch(state, arg)` helpers so that `applyVibeToStore` can make one atomic write.

**Tech Stack:** Bun (test runner), TypeScript, React 18, zustand 5 (`persist` + `subscribeWithSelector`), raw Web Audio.

**Spec:** `docs/architecture/structure/README.md` (findings table) and its detail pages `01-ui.md` … `04-domain-and-dependencies.md`. The user's scope decisions in the dispatching request are binding. They are restated per task below.

## Global Constraints

- Branch: `fix/structure-audit-bugs`, created off `main`. Feature work never lands as a commit made directly on `main`.
- Completion gate: `bun run verify`. It must pass after every task, not only at the end. ESLint and both Knip scans have a **zero-finding** baseline.
- Follow the layering in `CLAUDE.md`:
  - `src/store/` never imports `src/components/`.
  - `src/audio/` never imports `store/` or `components/`.
  - `src/data/` holds no runtime imports.
  - `tonal` may be imported only by `src/musicCore/tonalAdapter.ts`.
- No migration chains and no version-gated branches. A new persisted key is validated in `sanitizePersistedState` (`src/store/store.ts`). Do not bump `PERSIST_VERSION`.
- Nothing driven by a pointer, a clock tick or an animation frame may write persisted state directly.
- Everything generated, computed or persisted is `ROOTS`-spelled (sharp). Spelled names are display-only.
- Tests are `bun:test`. There is no DOM and no testing-library, and none may be added. Under `renderToString`, a plain `useAppStore(selector)` renders the store's **creation-time** state. Use `useLiveStore` or pure helpers (`.claude/rules/testing.md`).
- Docs: record rules, not counts or version numbers (`CLAUDE.md` header).
- Commit per task. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Finding verification (done against `main` @ 67008707 before planning)

Every cited location was re-read in current source. **No finding was dropped.**

| Code | Status | Notes |
|---|---|---|
| A1 | Confirmed | `masterRack.ts:552` feeds the dry drum bank into `getSourceTap('sequencer')` → `getSourceBus('sequencer')`. `:922-925` connects every bus to the delay, reverb and distortion send gates. Three places claim the opposite: `drumSynth.ts:915-917`, `SKILL.md:124` and the comment in `drumSynth.test.ts:224`. The test body (`:218-230`) is true only at voice level. `masterRack.ts:251-253` is already correct. |
| A1 (skill) | Confirmed | `SKILL.md:177` says "'bass' is forced monophonic", but mono is per patch (`voiceManager.ts:382` `common.voiceMode === 'mono'`). `SKILL.md:18` and `:113` name `ui/AmbientBackdrop.tsx`, which no longer exists (it was removed in a29a25c6). |
| D1 | Confirmed | `src/types.ts:107` has 3 members (Beat bus filter). `src/types/synth.ts:54` has 4, including `notch` (synth filter). Both are live with different importers. |
| S5 | Confirmed (static trace) | At `midiInput.ts:266`, `midiToFlatName` is `Note.fromMidi` (`tonalAdapter.ts:38-39`), which gives `Db4` for MIDI 61. The name travels through `synthPlaybackNoteOn` → note-input bus → `leadRecord.ts:227` → `recordMelodyNote` → `paintMelodyNote`, which stores it verbatim (`leadSlice.ts:195`). `midiToFlatName` has no other production caller except `noteSpelling.ts:25` (display). |
| S3/A2 | Confirmed | `midiInput.ts:157` calls `audioEngine.updateSynthPatch` after `s.setSynthParams(next)`. The `engineSync.ts:385-399` subscription then pushes the same patch through `paramFrames`. That push is leading-edge and synchronous, so the direct call buys no latency. |
| S4 | Confirmed | `musicContextSlice.ts:19-34` rewrites only `leadMelodySteps`. Other key-change paths: `applyVibeToStore` calls `setScaleRoot` and `setScaleType` (`vibes.ts:142-143`), so it inherits the asymmetry. Loop-copy's `key` group (`loopCopy.ts:143`) copies the key and transposes **neither** melody, which is symmetric and documented (`impliesKeyCopy`), so it is not changed. Project install and loop switch load stored, self-consistent state, so no transform is needed and none is changed. |
| U5 | Confirmed | `usePlayheadSync.ts:42-46` writes `setPlayheadBeat` once per beat. Readers: `PlayheadReadout.tsx:15`, `useChordView.ts:59` (→ `ProgressionCard`) and `diagnostics/browserRecorder.ts:87`. |
| S6 | Confirmed | `loopSlice.ts:187-193` sets `activeLoopId` without the flat fields, and `ArrangeView.tsx:283-284` must call `loadLoop`. `setActiveLoop` (`loopSlice.ts:271`) has no production caller. Only tests use it: `loopSlice`, `soloNav`, `vibeNav` and `loopSync`. |
| U8 | Confirmed | The delete button at `SortableLoopCard.tsx:564-573` has no confirm and no undo. The existing toast timer pattern is `useVibeFeedback` + `scheduleTimeout` (`InstantVibesBar.tsx:28-107`). |
| S8 | Confirmed | `applyVibeToStore` (`vibes.ts:138-258`) makes about 35 separate setter calls, each its own `set()`. |
| U6 | Confirmed | Pads are `useState(DEFAULT_PADS)` (`useInputDeck.ts:614`). The comment at `DrumPadGrid.tsx:24-29` speaks of "the persisted pad list". |
| S2 | Confirmed | zustand 5.0.15 `persist` runs `partialize` + `storage.setItem` on every `set` (`node_modules/zustand/esm/middleware.mjs:357-374`). `createJSONStorage` stringifies before the coalescer (`store.ts:146`, `:318`). Partialize holds seven keys, three of them user libraries. |

**Decision recorded in S6 (user may overturn):** today, deleting the *active* loop while the song runs goes through `loadLoop(fallback)`. That hard-stops and restarts the players. After this plan, `deleteLoop` writes the fallback's fields atomically in its own `set()`, which is the same shape as `projectSlice.reconcileActiveLoop`, and nothing hard-stops.

- A loop-scoped audition of the deleted loop still stops, through the existing `stopPatch`.
- A running song keeps running on the fallback.
- The deleted loop's already-queued voices (≤ one 0.1 s lookahead plus release tails) ring out instead of being cut.

This is the only audible behaviour change in the plan. See the reply to the user.

## File map and parallelism

| Task | Finding | Files touched (primary) | Overlaps |
|---|---|---|---|
| 1 | A1 | `audio/drumSynth.ts` (comment), `audio/drumSynth.test.ts`, `audio/masterRack.sendGates.test.ts`, `.claude/skills/dsp-audio/SKILL.md` | Task 2 (`drumSynth.ts`: import line versus comment, different hunks) |
| 2 | D1 | `types.ts`, `types/synth.ts` (no change), `audio/drumSynth.ts`, `audio/masterRack.ts`, `audio/engine.ts`, `data/vibes.ts`, `store/sanitizeBeat.ts`, `components/loop/beat/BeatFilterPanel.tsx`, new `types.test.ts` or `types/filterType.test.ts` | Task 1 (drumSynth) |
| 3 | S5 | `store/midiInput.ts`, `store/midiInput.test.ts` | Task 4 (same files) |
| 4 | S3/A2 | `store/midiInput.ts`, `store/midiInput.test.ts` | Task 3 |
| 5 | S4 | `store/musicContextSlice.ts`, `store/musicContextSlice.test.ts` | Task 8 consumes its export |
| 6 | U5 | new `components/playheadBeat.ts` + test, `components/usePlayheadSync.ts`, `components/PlayheadReadout.tsx`, `components/loop/chord/useChordView.ts`, `diagnostics/browserRecorder.ts`, `store/transportSlice.ts`, `store/types.ts`, `store/store.test.ts`, `store/projectAutosave.test.ts` | `store/types.ts` / `store/store.test.ts` with Tasks 7, 9, 10 |
| 7 | S6 + U8 | `store/loopSlice.ts`, `store/types.ts`, `store/loopSlice.test.ts`, `store/{soloNav,vibeNav,loopSync}.test.ts`, `components/song/ArrangeView.tsx`, new `components/ui/useTimedToast.ts` + test, new `components/song/LoopUndoToast.tsx` + test, `components/InstantVibesBar.tsx` | `loopSlice.ts` with Task 8; `store/types.ts` |
| 8 | S8 | `store/vibes.ts`, `store/vibes.test.ts`, `store/beatSlice.ts`, `store/chordsSlice.ts`, `store/loopSlice.ts`, `store/padSlice.ts` (read only), `store/musicContextSlice.ts` (import only) | depends on Task 5; `loopSlice.ts` with Task 7 |
| 9 | U6 | `store/uiSlice.ts`, `store/types.ts`, `store/store.ts`, `store/store.test.ts`, `components/ui/Slider.tsx`, `components/ui/DrumPadGrid.tsx`, `components/useInputDeck.ts`, new `components/drumPadVelocity.ts` + test | `store.ts` with Task 10 |
| 10 | S2 | new `store/persistStorage.ts` + test, `store/store.ts`, `store/store.test.ts` | `store.ts` with Task 9 |
| 11 | Docs | `CLAUDE.md`, `docs/architecture/structure/*.md`, `docs/architecture/feature-overview.md` | runs last |

**Can run in parallel (disjoint files):**

- Wave A: {1 → 2} ∥ {3 → 4} ∥ {5} ∥ {6}.
- Wave B: {7} ∥ {9}.
  - 7 and 9 share only `store/types.ts`, in different interfaces (`LoopSlice` versus `UiSlice`/`PersistedState`). Merge with care or run them sequentially.
- Then 8, which needs 5 and should land after 7 (`loopSlice.ts`).
- Then 10, which is risky persistence and shares `store.ts` and `store.test.ts` with 9.
- Then 11.

**Must be sequential:** 1 → 2 (same file). 3 → 4 (same files). 5 → 8. 7 → 8 (same file). 9 → 10 (same files). Everything → 11.

Execution order in this document is the safe serial order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11.

---

### Task 0: Branch

- [ ] **Step 1:** `git switch main && git pull --ff-only && git switch -c fix/structure-audit-bugs`
- [ ] **Step 2:** Run `bun run verify` and confirm the baseline is green before touching anything. If it is not green, stop and report.

---

### Task 1: A1 — correct the "drums bypass delay/distortion" claims (routing unchanged)

> **REVISED (2026-09-21, user decision).** The routing test proved the audit premise false: drums do NOT
> reach master delay/distortion today — only because `setupMasterChain` creates the `sequencer` source bus
> (`masterRack.ts:~552`) before the send gates (`:~572`), so `getSourceBus`'s `if (this.delaySendGate)`
> guards skip. The existing comments/skill claim ("drums bypass delay and distortion") is therefore correct.
> New scope for this task: keep the audible behaviour, but make it **explicit** — the Beat/`sequencer` bus
> must never connect to the generic delay/reverb/distortion send gates regardless of construction order
> (e.g. a named exclusion in `getSourceBus`, or equivalent), live and offline (`createRenderEngine`). Add a
> test that fails if the Beat bus reaches those gates even when gates exist before the bus is created.
> Per-voice drum reverb (`reverbSend` → `drumSendGate`) stays unchanged. Still fix the stale skill claims
> (bass "forced monophonic"; deleted `AmbientBackdrop.tsx`). Per-track FX is deferred (see Deferred).

**Files:**
- Modify: `src/audio/drumSynth.ts:915-917` (comment only)
- Modify: `src/audio/drumSynth.test.ts:218-230` (test name and comment)
- Test: `src/audio/masterRack.sendGates.test.ts` (add one test)
- Modify: `.claude/skills/dsp-audio/SKILL.md` at `:18`, `:113`, `:124-127`, `:177`

**Interfaces:** none. Behaviour is unchanged.

- [ ] **Step 1: Write the positive routing test** (it pins what the docs will now say). Add it inside the existing `describe` that holds `'every source bus connects to the send gates…'` in `masterRack.sendGates.test.ts`:

```ts
test('the Beat dry bank reaches delay and distortion through the sequencer source bus', () => {
  const engine = makeEngine();
  const ctx = masterChainCtx();
  bindFakeCtx(engine, ctx);
  const rack = (engine as any).masterRack;
  rack.setupMasterChain();

  // setupMasterChain builds the dry drum bank on getSourceTap('sequencer').
  const tap = rack.getSourceTap('sequencer');
  const bus = rack.getSourceBus('sequencer');
  expect(tap._connectTargets).toContain(bus);
  expect(bus._connectTargets).toContain(rack.delaySendGate);
  expect(bus._connectTargets).toContain(rack.distortionSendGate);
  expect(bus._connectTargets).toContain(rack.reverbSendGate);
});
```

- [ ] **Step 2: Run it.** `bun test src/audio/masterRack.sendGates.test.ts -t "Beat dry bank"`. Expected: **PASS**. This is a characterisation test of kept behaviour, so a FAIL means the audit was wrong: stop and report. If `_connectTargets` is not recorded on the tap node, use the same fake field the neighbouring test uses.

- [ ] **Step 3: Fix the comments.**
  - `drumSynth.ts:915-917` becomes: `// No voice-level delay tap. Delay and distortion reach drums only through the sequencer source bus (masterRack getSourceBus), like every other source; the old unconditional gain.connect(delayNode) here was a stray with no kit parameter behind it.`
  - In `drumSynth.test.ts:218`, rename the test to `'the open hat has no voice-level delay tap (the bus path is masterRack.sendGates.test.ts)'` and replace the `// Drums bypass …` line with `// Voice level only: the Beat bus still feeds the delay send via the sequencer source bus.`

- [ ] **Step 4: Fix the skill.**
  - `SKILL.md:124-127`: replace the first sentence with: "Drums reach delay and distortion like every other source: the dry bank `drumBusFilter` feeds `getSourceTap('sequencer')`, and that source bus fans out to `dryGain`, `delaySendGate`, `reverbSendGate` and `distortionSendGate`. There is no per-voice delay tap." Keep the reverb-send sentence that follows.
  - `SKILL.md:177`: change it to: "Mono is per PATCH, not per bus: `common.voiceMode === 'mono'` sends a note-on down the mono path (one shared group per source). Any bus, `'bass'` included, is poly when its patch says so."
  - `SKILL.md:18` and `:113`: delete `ui/AmbientBackdrop.tsx` / `AmbientBackdrop` from both lists (`:113` then reads "reads for `VuMeter`").

- [ ] **Step 5: Verify.** Run `bun test src/audio/drumSynth.test.ts src/audio/masterRack.sendGates.test.ts`, then `bun run verify`.

- [ ] **Step 6: Commit.**
```bash
git add src/audio/drumSynth.ts src/audio/drumSynth.test.ts src/audio/masterRack.sendGates.test.ts .claude/skills/dsp-audio/SKILL.md
git commit -m "docs(audio): drums reach delay and distortion via the sequencer bus; fix stale dsp-audio claims"
```

---

### Task 2: D1 — one `FilterType` owner, Beat filter derives its narrower union

**Decision:** `src/types/synth.ts` keeps `FilterType` (4 members). It is the general biquad response set the synth panel offers. The Beat bus filter is a genuinely narrower contract, because its bank has exactly three fixed lanes (`BEAT_FILTER_TYPES`, `masterRack.ts:68`). So `src/types.ts` stops declaring its own union and exports `BeatFilterType = Exclude<FilterType, 'notch'>`, derived from the owner. There is then one name per meaning and no collision. This is what the `ArpSettings` paragraph in `CLAUDE.md` already claims.

**Files:**
- Modify: `src/types.ts:107` (replace the declaration) and `:344` (`BeatFilterParams.type`)
- Modify, changing `FilterType` → `BeatFilterType` in import and use:
  - `src/audio/drumSynth.ts:1,316`
  - `src/audio/masterRack.ts:1,56,68,261`
  - `src/audio/engine.ts:1,254`
  - `src/data/vibes.ts:28,127`
  - `src/store/sanitizeBeat.ts:38,128`
  - `src/components/loop/beat/BeatFilterPanel.tsx:4,6,7,42`
- Unchanged: `types/synth.ts`, `sanitizeSynth.ts`, `FilterTypeIcon.tsx`, `FilterPanel.tsx`, `subtractiveSignal.test.ts` (already on the synth owner)
- Test: create `src/types.filterType.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { BeatFilterType } from './types';
import type { FilterType } from './types/synth';

describe('FilterType has one owner', () => {
  test('src/types.ts declares no FilterType of its own', () => {
    const src = readFileSync(new URL('./types.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/export type FilterType\b/);
  });
  test('the Beat filter set is the synth set minus notch', () => {
    const beat: BeatFilterType[] = ['lowpass', 'bandpass', 'highpass'];
    const all: FilterType[] = [...beat, 'notch'];
    // @ts-expect-error notch is not a Beat filter response
    const bad: BeatFilterType = 'notch';
    expect(all).toHaveLength(4);
    void bad;
  });
});
```

- [ ] **Step 2: Run it.** `bun test src/types.filterType.test.ts`. Expected: FAIL on the source-scan test. `bun run lint` also fails, because `BeatFilterType` does not exist yet.

- [ ] **Step 3: Implement.** In `src/types.ts`, add `import type { FilterType } from './types/synth';` and replace line 107 with:

```ts
/** The Beat bus filter's responses: one fixed lane per member (masterRack BEAT_FILTER_TYPES), so no notch. */
export type BeatFilterType = Exclude<FilterType, 'notch'>;
```

Then set `BeatFilterParams.type: BeatFilterType;` and rename every importer listed above. Do not re-export `FilterType` from `types.ts`.

- [ ] **Step 4: Verify.** Run `bun test src/types.filterType.test.ts && bun run lint && bun run eslint`, then `bun run verify`. `check:dead-code` must stay at zero.

- [ ] **Step 5: Commit.** `git commit -m "refactor(types): single FilterType owner; Beat bus filter derives BeatFilterType"` (with the trailer).

---

### Task 3: S5 — MIDI note names are ROOTS (sharp) spelled

**Files:**
- Modify: `src/store/midiInput.ts:1,266`
- Test: `src/store/midiInput.test.ts` (new describe block)

**Interfaces:** Consumes `startMelodyRecordBridges(deps)` from `src/store/leadRecord.ts` (test only).

- [ ] **Step 1: Write the failing test, which drives the record path rather than the helper.** Append to `midiInput.test.ts`. Also import `startMelodyRecordBridges` from `./leadRecord`, `LEAD_TICKS_PER_BAR` from `../utils/stepResolution` and `type LeadNote` from `../audio/leadMelody`.

```ts
describe('a MIDI-recorded black key is stored sharp-spelled (ROOTS identity)', () => {
  test('MIDI 61 records as C#4 in leadMelodySteps, never Db4', () => {
    const prev = useAppStore.getState();
    useAppStore.setState({
      meterId: '4/4',
      leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
      leadLoopLength: 1,
      leadMelodyView: 'chromatic',
      leadMelodyOctave: 3,
      leadCursor: 0,
      recordingTrack: 'lead',
      leadPlayer: 'stopped', chordsPlayer: 'stopped', sequencerPlayer: 'stopped', fxPlayer: 'stopped',
      metronomeActive: false,
    });
    const stop = startMelodyRecordBridges({ inputStep: () => null, startClock: () => () => {} });
    const input = connect('dev-record-sharp');

    noteOn(input, 61);
    input.onmidimessage?.({ data: [0x80, 61, 0], target: input });

    const stored = useAppStore.getState().leadMelodySteps.flat().map((n) => n.note);
    expect(stored).toEqual(['C#4']);
    stop();
    resetNoteInputListeners();
    useAppStore.setState({
      recordingTrack: null,
      leadMelodySteps: prev.leadMelodySteps,
      leadMelodyOctave: prev.leadMelodyOctave,
      leadCursor: prev.leadCursor,
    });
  });

  test('the note-input bus announces the sharp name too', () => {
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    const input = connect('dev-bus-sharp');
    noteOn(input, 70); // A#4 / Bb4
    expect(events[0]?.note).toBe('A#4');
    resetNoteInputListeners();
  });
});
```

- [ ] **Step 2: Run it.** `bun test src/store/midiInput.test.ts -t "sharp"`. Expected: FAIL with `['Db4']` and `'Bb4'`.

- [ ] **Step 3: Implement.** In `midiInput.ts`, change `import { midiToFlatName }` to `import { midiToSharpName }`, and change line 266 to `const noteName = midiToSharpName(data1);`. Update the comment above the note-on branch with one line: `// Sharp-spelled: this name becomes a stored lead note when Rec is armed, and persisted names are ROOTS-spelled.`

- [ ] **Step 4: Verify.** Run `bun test src/store/midiInput.test.ts src/store/leadRecord.test.ts`, then `bun run verify`. Knip must not flag `midiToFlatName`, because `noteSpelling.ts` still uses it.

- [ ] **Step 5: Commit.** `git commit -m "fix(midi): spell incoming MIDI notes sharp so recorded notes keep ROOTS identity"`

---

### Task 4: S3/A2 — MIDI CC reaches the engine only through engineSync

**Why engineSync alone is enough:** `engineSync`'s patch subscription pushes through `paramFrames`, a frame coalescer whose first push per key is **synchronous** (leading edge). So a CC edit reaches `updateSynthPatch` in the same tick as the store write. The direct call only duplicated it. `startMidiInputBridge` is itself started from `startEngineSync`, so the subscription always exists before a CC can arrive. This is the same argument the file already makes for `masterVolume`.

**Files:**
- Modify: `src/store/midiInput.ts`
  - `:140-158`: `writeLeadSynth` drops the engine call.
  - Remove the `audioEngine` import if it becomes unused.
  - Update the comment blocks at `:92-104` and `:121-139`.
- Modify: `src/store/midiInput.test.ts`
  - The describe `'MIDI CC pushes the five synth-param branches straight to the engine'` (`:460-512`) and the coalescing tests (`:515+`) currently spy on the direct call.

- [ ] **Step 1: Write the failing test.** Add it to `midiInput.test.ts`, importing `startEngineSync` and `stopEngineSync` from `./engineSync`:

```ts
describe('a CC edit reaches the engine exactly once, through engineSync', () => {
  test('filterCutoff (CC 74): one updateSynthPatch for synth, same tick', () => {
    startEngineSync();
    __flushCcFramesForTests();
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockImplementation(() => {});
    const input = connect('dev-cc-single-path');

    input.onmidimessage?.({ data: [0xb0, 74, 64], target: input });

    const calls = updateSynthPatch.mock.calls.filter(([, , source]) => source === 'synth');
    expect(calls).toHaveLength(1);
    expect(nextPatch(calls[0]).patch.synth.filter.cutoffHz).toBe(Math.round(20 * Math.pow(1000, 64 / 127)));
    updateSynthPatch.mockRestore();
    stopEngineSync();
  });
});
```

- [ ] **Step 2: Run it.** `bun test src/store/midiInput.test.ts -t "exactly once"`. Expected: FAIL with 2 calls.

- [ ] **Step 3: Implement.** In `writeLeadSynth`, delete `audioEngine.updateSynthPatch(previous, next, 'synth');` and drop the now-unneeded `previous` local if nothing else reads it. Rewrite its docblock to: "Writes one CC-mapped control into the Lead patch. The store write is the whole job: engineSync's patch subscription pushes it to the engine on the same tick (its frame coalescer is leading-edge), diffing against what it last APPLIED." Update the two file comments that mention "its direct `audioEngine.updateSynthPatch` call".

- [ ] **Step 4: Update the existing CC tests.** They asserted the direct call without engineSync running.
  - In the `'…straight to the engine'` describe, retitle it `'MIDI CC writes the five synth-param branches into the Lead patch'`. Assert the **store** value, which the tests already check, and `expect(updateSynthPatch).not.toHaveBeenCalled()` while engineSync is not started.
  - In the coalescing describe, switch the synth-target tests to count store writes. Use `useAppStore.subscribe((s) => s.synthParams, …)`, or wrap them in `startEngineSync()`/`stopEngineSync()` and keep counting `updateSynthPatch` calls, whichever keeps each assertion's meaning ("once immediately, once more at frame rate").

- [ ] **Step 5: Verify.** Run `bun test src/store/midiInput.test.ts src/store/engineSync.test.ts`, then `bun run verify`.

- [ ] **Step 6: Commit.** `git commit -m "perf(midi): CC patch edits reach the engine once, via engineSync"`

---

### Task 5: S4 — a key change moves every melody track (table-driven)

**Files:**
- Modify: `src/store/musicContextSlice.ts`
- Test: `src/store/musicContextSlice.test.ts`

**Interfaces:**
- Produces, exported from `musicContextSlice.ts` and consumed by Task 8:

```ts
export function keyChangePatch(
  state: Pick<AppStore, 'scaleRoot' | 'scaleType' | MelodyTrack['steps']>,
  next: { scaleRoot?: string; scaleType?: string },
): Partial<AppStore>;
```

It returns `{ scaleRoot?, scaleType?, leadMelodySteps, fxMelodySteps }`. The root is applied first (transpose under the old type). The type is then applied (remap under the new root). This is exactly the sequence `setScaleRoot` then `setScaleType` produces today.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
describe('musicContextSlice — every melody track follows the key (MELODY_TRACKS)', () => {
  beforeEach(() => {
    const lead = emptyMelody();
    lead[0] = [{ note: 'A3', len: 1 }];
    const fx = emptyMelody();
    fx[0] = [{ note: 'C4', len: 1 }];
    fx[1] = [{ note: 'F4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: lead, fxMelodySteps: fx });
  });

  test('setScaleRoot transposes FX exactly as it transposes Lead', () => {
    useAppStore.getState().setScaleRoot('C');
    const s = useAppStore.getState();
    expect(s.leadMelodySteps[0]).toEqual([{ note: 'C3', len: 1 }]);
    expect(s.fxMelodySteps[0]).toEqual([{ note: 'D#3', len: 1 }]);
  });

  test('setScaleType remaps FX exactly as it remaps Lead', () => {
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().fxMelodySteps[1]).toEqual([{ note: 'F#4', len: 1 }]);
  });

  test('keyChangePatch writes one steps field per MELODY_TRACKS row and nothing else', () => {
    const patch = keyChangePatch(useAppStore.getState(), { scaleRoot: 'C' });
    const stepKeys = MELODY_TRACKS.map((t) => t.steps).sort();
    expect(Object.keys(patch).sort()).toEqual(['scaleRoot', ...stepKeys].sort());
  });

  test('source scan: no hand-written melody field in the slice', () => {
    const src = readFileSync(new URL('./musicContextSlice.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/leadMelodySteps|fxMelodySteps/);
  });
});
```

Imports: `readFileSync` from `node:fs`, `keyChangePatch` from `./musicContextSlice`, `MELODY_TRACKS` from `./melodyTracks`.

The expected literals are copied from the existing lead tests in the same file: `C4 → D#3` for A→C at `:23`, and `F4 → F#4` for minor→Dorian at `:38`. FX must produce exactly what Lead produces for the same input.

- [ ] **Step 2: Run it.** `bun test src/store/musicContextSlice.test.ts`. Expected: the FX tests and the source scan FAIL.

- [ ] **Step 3: Implement.**

```ts
export function keyChangePatch(state, next): Partial<AppStore> {
  const root = next.scaleRoot ?? state.scaleRoot;
  const type = next.scaleType ?? state.scaleType;
  const patch: Record<string, unknown> = {};
  if (next.scaleRoot !== undefined) patch.scaleRoot = root;
  if (next.scaleType !== undefined) patch.scaleType = type;
  for (const track of MELODY_TRACKS) {
    let steps = state[track.steps];
    if (root !== state.scaleRoot) steps = transposeLeadMelodyByRoot(steps, state.scaleRoot, root);
    if (type !== state.scaleType) steps = remapLeadMelodyByScale(steps, root, state.scaleType, type);
    patch[track.steps] = steps;
  }
  return patch as Partial<AppStore>;
}
// actions:
setScaleRoot: (scaleRoot) => set((state) => keyChangePatch(state, { scaleRoot })),
setScaleType: (scaleType) => set((state) => keyChangePatch(state, { scaleType })),
```

Keep the call-for-call behaviour of today's `setScaleType`, which calls `remapLeadMelodyByScale(steps, state.scaleRoot, state.scaleType, scaleType)`. When only the type changes, `root === state.scaleRoot`. Extend the slice docblock with one sentence: every melody track in `MELODY_TRACKS` follows a key change, and the loop-copy `key` group deliberately transposes none (see `impliesKeyCopy`).

- [ ] **Step 4: Verify.** Run `bun test src/store/musicContextSlice.test.ts src/store/vibes.test.ts src/store/loopCopy*.test.ts`, then `bun run verify`.

- [ ] **Step 5: Commit.** `git commit -m "fix(store): key/scale changes transpose FX with Lead, driven by MELODY_TRACKS"`

---

### Task 6: U5 — `playheadBeat` leaves the store for a local pub/sub

**Files:**
- Create: `src/components/playheadBeat.ts`, `src/components/playheadBeat.test.ts`
- Modify:
  - `src/components/usePlayheadSync.ts`
  - `src/components/PlayheadReadout.tsx:15`
  - `src/components/loop/chord/useChordView.ts:59,84,136` (and the `:546` comment)
  - `src/diagnostics/browserRecorder.ts:87`
- Modify: `src/store/transportSlice.ts:271,279`; `src/store/types.ts:52-59` (remove `playheadBeat` and `setPlayheadBeat`, keep `playheadChord*`)
- Modify tests: `src/store/store.test.ts:361,364` (remove from `NON_PERSISTED_KEYS`), `src/store/projectAutosave.test.ts:101` (swap `playheadBeat: 3` for another non-content key, e.g. `playheadChordIndex: 3`)

**Interfaces (produced):**

```ts
// src/components/playheadBeat.ts
export interface PlayheadBeatPublisher {
  get(): number | null;
  set(beat: number | null): void;          // no-op + no notify when unchanged
  subscribe(listener: (beat: number | null) => void): () => void;
}
export function createPlayheadBeatPublisher(): PlayheadBeatPublisher;
export const playheadBeat: PlayheadBeatPublisher;           // app singleton
export function usePlayheadBeat(): number | null;           // useSyncExternalStore, getSnapshot served for server too
```

- [ ] **Step 1: Write the failing tests** (`playheadBeat.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createPlayheadBeatPublisher, playheadBeat, usePlayheadBeat } from './playheadBeat';

describe('playhead beat publisher', () => {
  test('notifies on change only', () => {
    const p = createPlayheadBeatPublisher();
    const seen: Array<number | null> = [];
    const off = p.subscribe((b) => seen.push(b));
    p.set(0); p.set(0); p.set(1); p.set(null);
    off(); p.set(2);
    expect(seen).toEqual([0, 1, null]);
    expect(p.get()).toBe(2);
  });

  test('usePlayheadBeat renders the live value under renderToString', () => {
    playheadBeat.set(7);
    const Probe = () => createElement('span', null, String(usePlayheadBeat()));
    expect(renderToString(createElement(Probe))).toContain('7');
    playheadBeat.set(null);
  });

  test('the store no longer carries the playhead beat', () => {
    const types = readFileSync(new URL('../store/types.ts', import.meta.url), 'utf8');
    expect(types).not.toMatch(/\bplayheadBeat\b|setPlayheadBeat/);
  });
});
```

- [ ] **Step 2: Run it.** `bun test src/components/playheadBeat.test.ts`. Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement the publisher.**
  - Use a `Set` of listeners and a `current` value. `set` returns early when `Object.is(current, beat)`.
  - `usePlayheadBeat` = `useSyncExternalStore(playheadBeat.subscribe-adapter, playheadBeat.get, playheadBeat.get)`. The adapter is `(cb) => playheadBeat.subscribe(() => cb())`.
  - Write a docblock that cites the `CLAUDE.md` rule: high-frequency state stays local, and `playbackStep.ts` is the precedent.

- [ ] **Step 4: Rewire.**
  - `usePlayheadSync`: replace `setPlayheadBeat(x)` with `playheadBeat.set(x)`. Keep `setPlayheadChord(null)` on stop.
  - `PlayheadReadout`: `const playheadBeatValue = usePlayheadBeat();`
  - `useChordView`: same. Its memo comments about "playheadBeat churn" stay accurate, but now the only subtree that re-renders is the chord view, not every mounted view.
  - `browserRecorder.ts:87`: `subscribePlayhead: (listener) => playheadBeat.subscribe(listener)`. Check the listener signature `createDiagnosticRecorder` expects. If it expects `(beat, prev)`, pass the previous value from a closure.
  - Delete `playheadBeat` and `setPlayheadBeat` from `transportSlice.ts` and `store/types.ts`. Update the comment at `types.ts:52`.

- [ ] **Step 5: Verify.** Run `bun test src/components src/store/store.test.ts src/store/projectAutosave.test.ts src/utils/playhead.test.ts src/diagnostics`, then `bun run verify`. `utils/playhead.ts` keeps its `playheadBeat` *parameter* name, which is a plain argument and is fine.

- [ ] **Step 6: Commit.** `git commit -m "perf(ui): publish the playhead beat through a local pub/sub instead of the store"`

---

### Task 7: S6 + U8 — `deleteLoop` is atomic on its own; Undo toast restores the loop

> **User decision (2026-09-21, corrected after review):** deleting the active loop while the transport runs never stops it, and the switch is as clean as a song-advance seam. The original note said only "already-queued voices (≤0.1 s + release tail)" would ring out; that premise was wrong: a full-hold chord, bass or per-chord pad has its note-off booked at the end of its chord (several bars away), and a drone holds for the whole pass, and nothing reset the clock, so the fallback entered mid-progression and `songAdvanceDecision` could fire after a partial pass. The corrected behaviour: `deleteLoopLive` (`store/loadLoop.ts`) wraps `deleteLoop`'s single atomic write in `crossLoopSeam`, the same helper `loadLoop`'s `atBoundary` path uses. Its mid-pass branch cuts every accompaniment bus (`chord`, `bass`, `pad`) and the melody grids' sequencer-owned voices at `LOAD_LOOP_RELEASE`, then resets the clock so the fallback starts at step 0. Undo (`undoLoopDelete`) never stops the transport either: it re-inserts the loop and, if it was active, re-activates it through the same seam (or through `loadLoop`'s ordinary switch when nothing plays).

**Files:**
- Modify: `src/store/loopSlice.ts:156-194` (`removeLoop`), `:209`, `:271` (delete `setActiveLoop`). Add a `restoreLoop` action.
- Modify: `src/store/types.ts:733,745` (`LoopSlice`)
- Modify tests:
  - `src/store/loopSlice.test.ts:264-340,368-420`
  - `src/store/soloNav.test.ts:176`, `src/store/vibeNav.test.ts:33`, `src/store/loopSync.test.ts:125`: replace `setActiveLoop(x)` with `useAppStore.setState({ activeLoopId: x })`. That is exactly the bare write those tests meant.
  - `src/components/song/ArrangeView.test.tsx:240-246`
- Create: `src/components/ui/useTimedToast.ts` + `useTimedToast.test.ts`. This is the toast timer extracted from `InstantVibesBar.tsx:28-35,72-107`.
- Create: `src/components/song/LoopUndoToast.tsx` + `LoopUndoToast.test.tsx`
- Modify: `src/components/song/ArrangeView.tsx:281-287` (and render the toast), `src/components/InstantVibesBar.tsx` (consume `useTimedToast`)
- Also update the `store/vibeNav.ts:9` and `store/soloNav.ts:32` docblocks that list `setActiveLoop`.

**Interfaces (produced):**

```ts
// store/types.ts
export interface DeletedLoop { loop: Loop; index: number; wasActive: boolean }
// LoopSlice
deleteLoop: (id: string) => DeletedLoop | null;   // null = nothing deleted (last loop / unknown id)
restoreLoop: (deleted: DeletedLoop) => void;      // re-inserts at clamp(index); never activates
// components/ui/useTimedToast.ts
export function useTimedToast<T>(): { toast: T | null; show: (t: T, ms: number) => void; dismiss: () => void };
export function scheduleTimeout(ref: MutableRefObject<ReturnType<typeof setTimeout> | null>, fn: () => void, ms: number): void;
```

**Behaviour:**
- `deleteLoop` of the active loop writes, in **one** `set()`: `loops`, `activeLoopId: fallback`, `...loopStatePatch(fallbackLoop)`, `songLoopIndex` and the existing `stopPatch`. `loopMirrorPartial` already skips the mirror when `activeLoopId` changes, so the flat fields cannot be written back into the wrong loop.
- Undo: `restoreLoop(deleted)`, then, if `deleted.wasActive`, `loadLoop(deleted.loop.id)` from the component. `loadLoop` is the sanctioned atomic switch, and `restoreLoop` alone leaves consistent state.
- The toast lasts 5000 ms. The loop snapshot comes from `loops[]`, which the mirror keeps current, so edits made to the active loop just before deletion are kept.

- [ ] **Step 1: Write the failing store tests** (`loopSlice.test.ts`; replace the `:264` test and add the others):

```ts
test('deleteLoop of the active loop loads the fallback loop’s fields in the same write', () => {
  const h = makeSlice();
  const first = h.state.loops[0];
  h.state.addLoop(); // loop 2 active
  const second = h.state.loops[1];
  const deleted = h.state.deleteLoop(second.id);
  expect(deleted).toEqual({ loop: second, index: 1, wasActive: true });
  expect(h.state.activeLoopId).toBe(first.id);
  expect(h.state.scaleRoot).toBe(first.scaleRoot);
  expect(h.state.chords).toEqual(first.chords);
  expect(h.state.leadMelodySteps).toEqual(first.leadMelodySteps);
});

test('restoreLoop puts the loop back at its index and does not activate it', () => {
  const h = makeSlice();
  h.state.addLoop(); h.state.addLoop();
  const ids = h.state.loops.map((l) => l.id);
  const active = h.state.activeLoopId;
  const deleted = h.state.deleteLoop(ids[0])!;
  h.state.restoreLoop(deleted);
  expect(h.state.loops.map((l) => l.id)).toEqual(ids);
  expect(h.state.activeLoopId).toBe(active);
});

test('setActiveLoop is gone — no bare activeLoopId writer remains', () => {
  expect('setActiveLoop' in makeSlice().state).toBe(false);
});
```

Change `:269-289` and `:306-340` to read `.wasActive` / `?.loop.id` instead of the returned id or `null`. A non-active delete now returns `{ …, wasActive: false }`, not `null`.

Add a real-store test (in `ArrangeView.test.tsx` next to `:240`, or in `loopSync.test.ts`). It subscribes to `useAppStore` and asserts that deleting the active loop notifies **once**, with `activeLoopId` and `scaleRoot` both already equal to the fallback's in that single notification.

- [ ] **Step 2: Run them.** `bun test src/store/loopSlice.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the store.**
  - In `removeLoop`'s active branch: `const fallbackLoop = loops.find((l) => l.id === fallback)!; set({ loops, activeLoopId: fallback, ...loopStatePatch(fallbackLoop), songLoopIndex: …, ...stopPatch });`
  - Return `{ loop: state.loops[index], index, wasActive }`.
  - The non-active branch returns the same shape with `wasActive: false`.
  - `restoreLoop`: `set((s) => { if (s.loops.some((l) => l.id === d.loop.id)) return {}; const i = Math.min(d.index, s.loops.length); const loops = [...s.loops.slice(0, i), d.loop, ...s.loops.slice(i)]; return { loops, songLoopIndex: songCursor(loops, s.activeLoopId, s.songLoopIndex) }; })`
  - Import `loopStatePatch` from `./loop`. It is already a sibling, so no new cycle is created.
  - Update the `removeLoop` docblock.

- [ ] **Step 4: Write the failing UI tests.**
  - `useTimedToast.test.ts` tests `scheduleTimeout` as a pure helper: a second schedule clears the first timer. Use a fake `setTimeout` as in `masterRack.sendGates.test.ts`'s `withFakeTimer`.
  - `LoopUndoToast.test.tsx`: `renderToString(<LoopUndoToast label="Loop 2" onUndo={() => {}} />)` contains `id="btn-undo-loop-delete"`, the text `Loop 2 deleted` and `role="status"`. The component is presentational, with props only and no store read, so the renderToString trap does not apply.

- [ ] **Step 5: Implement the UI.**
  - Move `scheduleTimeout` and the toast half of `useVibeFeedback` into `useTimedToast.ts`, keeping the unmount cleanup. `InstantVibesBar` uses it (behaviour identical; the spin timer keeps using `scheduleTimeout`).
  - `LoopUndoToast` markup: a daisyUI `toast toast-bottom toast-center` with an `alert` and a `btn btn-xs` Undo button. Look up the daisyUI v5 toast/alert docs before writing classes (user memory rule). Use theme tokens only, because `ArrangeView.test.tsx:67` forbids raw colour literals.
  - `ArrangeView.onDelete`: `const deleted = deleteLoop(id); if (deleted) show(deleted, LOOP_UNDO_MS);`, with **no** `loadLoop` call.
  - `onUndo`: `restoreLoop(toast); if (toast.wasActive) loadLoop(toast.loop.id); dismiss();`
  - Label via `loopLabel(deleted.loop)`.

- [ ] **Step 6: Verify.** Run `bun test src/store src/components/song src/components/ui/useTimedToast.test.ts src/components/InstantVibesBar.test.tsx`, then `bun run verify`.

- [ ] **Step 7: Commit.** `git commit -m "fix(loops): deleteLoop loads its fallback atomically; add Undo toast for loop delete"`

---

### Task 8: S8 — `applyVibeToStore` writes the vibe in one atomic patch

**Depends on:** Task 5 (`keyChangePatch`) and Task 7 (`loopSlice.ts`).

**Shape after the change (three writes, down from about 38):**
1. `hardStopAll()`, unchanged.
2. `audioEngine.stopSource(...)` for each accompaniment source, unchanged. It must still happen **before** the new content lands, which it does.
3. **One** content write: `useAppStore.setState((s) => withMirror(s, vibeContentPatch(s, vibe, resolved)))`.
4. `commitRestartAfterStop(...)`, unchanged. It is already one `set()`.

engineSync's subscriptions fire once, on the final state. The meter therefore reaches the engine together with the new grid, which is correct because both are read on the next bar. No engine call in `vibes.ts` sits between content setters today, so no ordering is lost.

**Files:**
- Modify: `src/store/vibes.ts:138-230`
- Modify, extracting pure patch builders and making each action call its builder so behaviour stays identical:
  - `src/store/beatSlice.ts`: `beatPresetPatch(state, presetId)`, `beatFilterPatch(state, patch)`, `replaceBeatPatternPatch(state, rows)`
  - `src/store/chordsSlice.ts`: `chordsPatch(state, chords)`
  - `src/store/loopSlice.ts`: `loopTempNamePatch(state, id, name)`, returning `{}` for a blank name
- Test: `src/store/vibes.test.ts`

**Interfaces (produced):**

```ts
// vibes.ts (exported for tests)
export function vibeContentPatch(state: AppStore, vibe: ResolvedVibe, voices: {
  chord: ActiveSynth; bass: ActiveSynth; synth: ActiveSynth; fx: ActiveSynth;
  pad: (NonNullable<ResolvedVibe['pad']> & { params: ActiveSynth }) | null;
}): Partial<AppStore>;
```

It is implemented by threading a draft: `let draft = state; const out = {}; const put = (p) => { Object.assign(out, p); draft = { ...draft, ...p }; };`.

Calls happen in today's order, so each builder sees the effects of the ones before it:
1. bpm: `clampBpm`
2. `meterId`
3. `keyChangePatch(draft, { scaleRoot, scaleType })`
4. `selectedVibeId`
5. `loopTempNamePatch`
6. `beatPresetPatch`
7. `replaceBeatPatternPatch`, which reads `draft.meterId`
8. `beatFilterPatch`, if any
9. `chordsPatch`
10. chord scalars
11. bass scalars
12. pad fields when a pad is set, using `normalizePadIntervals` and the dB conversion
13. `padMuted: !pad`, stated directly rather than as a toggle
14. synth/fx patches and cloned Arp settings
15. `effects: { ...draft.effects, ...vibe.effects }`

`withMirror(s, p)` = `({ ...p, ...(loopMirrorPartial(s, p) ?? {}) })`, which keeps `loops[]` in sync exactly as the slice `set` does. `loopMirrorPartial` builds on `p.loops` when the patch carries `loops`, which the temp-name write does.

- [ ] **Step 1: Write the failing tests** (`vibes.test.ts`):

```ts
test('applying a vibe notifies content subscribers exactly once', () => {
  let notified = 0;
  const off = useAppStore.subscribe((s) => s.chords, () => { notified++; });
  const offKey = useAppStore.subscribe((s) => s.scaleRoot, () => { notified += 100; });
  applyVibeToStore(VIBES[1]);
  off(); offKey();
  expect(notified).toBe(101); // one chords change + one key change, each in the single write
});

test('the one write keeps loops[] mirrored', () => {
  applyVibeToStore(VIBES[0]);
  const s = useAppStore.getState();
  const active = s.loops.find((l) => l.id === s.activeLoopId)!;
  expect(active.chords).toEqual(s.chords);
  expect(active.scaleRoot).toBe(s.scaleRoot);
  expect(active.tempName).toBe(VIBES[0].name);
});

test('a vibe applied over a loop whose melodies differ transposes Lead and FX alike', () => {
  // seed lead+fx with the same note, apply a vibe in a different key, expect equal results
});
```

Write the third test concretely, reusing the fixture style of Task 5, and pick a vibe whose key differs from the seeded one. Also keep the existing golden-fixture tests: they are the regression net that the final state is unchanged, so do not edit their expectations.

A count that can pass vacuously: first make sure the chosen `VIBES[1]` differs from the store's current chords and key, or reset the store first.

- [ ] **Step 2: Run them.** `bun test src/store/vibes.test.ts`. Expected: the notify-count test FAILS, because the key currently changes twice.

- [ ] **Step 3: Extract the patch builders.** Replace each action body with `set((s) => xPatch(s, arg))`. Run `bun test src/store` and expect it to be green, since this step is a pure refactor.

- [ ] **Step 4: Rewrite `applyVibeToStore` steps 1–6** onto `vibeContentPatch`. Keep every existing ordering comment, moving each next to its `put(...)` line. The "MUST precede replaceBeatPattern" and "filter AFTER the preset" rules still hold inside the draft. Remove the live `useAppStore.getState().padMuted` read.

- [ ] **Step 5: Verify.** Run `bun test src/store/vibes.test.ts src/store/vibeVariation.test.ts src/components/InstantVibesBar.test.tsx src/store`, then `bun run verify`. Load the `instant-vibes` skill if a golden fixture moves. A moved fixture means a behaviour change, and that is a bug in this task.

- [ ] **Step 6: Commit.** `git commit -m "perf(vibes): apply a vibe's content in one atomic store write"`

---

### Task 9: U6 — drum-pad velocity is persisted UI state

**Design:**
- The store holds only overrides: `drumPadVelocities: Partial<Record<BeatVoiceId, number>>` in the ui slice, persisted.
- Pad ids equal Beat voice ids, so the store validates keys against `BEAT_VOICE_IDS` (`@/data/beatPresets`) and never imports `components/`.
- `DEFAULT_PADS` stays the source of defaults.
- The slider drag is a pointer gesture, so it previews through local state and commits once on release (global constraint).

**Files:**
- Modify: `src/store/types.ts` (`UiSlice` gets `drumPadVelocities` and `setDrumPadVelocity(id: BeatVoiceId, v: number)`; `PersistedState` gets `drumPadVelocities`)
- Modify: `src/store/uiSlice.ts`, `src/store/store.ts` (`partializeAppState`, `sanitizePersistedState`)
- Create: `src/components/drumPadVelocity.ts` (pure `padsWithVelocities(defaults, overrides, draft)`) + test
- Modify: `src/components/ui/Slider.tsx` (add optional `onCommit(value)`, fired from `onPointerUp` and `onKeyUp` using `e.currentTarget.value`)
- Modify: `src/components/ui/DrumPadGrid.tsx` (add `onPadVolumeCommit` prop; fix the `:24-29` comment)
- Modify: `src/components/useInputDeck.ts:613-650`
- Tests: `src/store/store.test.ts` (`PERSISTED_KEYS` gets `'drumPadVelocities'`, plus sanitize tests), `src/components/ui/DrumPadGrid.test.tsx`, `src/components/ui/Slider` test if one exists

- [ ] **Step 1: Write the failing tests.**

```ts
// store.test.ts — sanitize
test('drumPadVelocities keeps only Beat voice ids with finite 0..1 values', () => {
  const out = sanitizePersistedState({
    drumPadVelocities: { kick: 0.5, snare: 2, bogus: 0.3, hihat: 'x', clap: 0 },
  });
  expect(out.drumPadVelocities).toEqual({ kick: 0.5, clap: 0 });
});
test('a non-object drumPadVelocities is dropped, leaving the default', () => {
  expect(sanitizePersistedState({ drumPadVelocities: [1] })).not.toHaveProperty('drumPadVelocities');
});
// uiSlice via real store
test('setDrumPadVelocity clamps and persists', () => {
  useAppStore.getState().setDrumPadVelocity('kick', 1.4);
  expect(useAppStore.getState().drumPadVelocities.kick).toBe(1);
  expect(partializeAppState(useAppStore.getState())).toHaveProperty('drumPadVelocities');
});
// drumPadVelocity.test.ts
test('overrides then draft win over DEFAULT_PADS volume, per pad id', () => {
  const pads = padsWithVelocities(DEFAULT_PADS, { kick: 0.4 }, { snare: 0.2 });
  expect(pads.find((p) => p.id === 'kick')!.volume).toBe(0.4);
  expect(pads.find((p) => p.id === 'snare')!.volume).toBe(0.2);
  expect(pads.find((p) => p.id === 'hihat')!.volume).toBe(0.75);
});
```

Add a Slider test: `renderToString(<Slider … onCommit={fn} />)` cannot fire events. Instead, export the pure `commitValue(e)` parser if needed, or skip the Slider test and rely on the `DrumPadGrid` prop wiring test, a source-level check that the `onCommit={…onPadVolumeCommit…}` wiring exists.

- [ ] **Step 2: Run them.** `bun test src/store/store.test.ts src/components/drumPadVelocity.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the store side.**
  - `uiSlice`: `drumPadVelocities: {}` and `setDrumPadVelocity: (id, v) => set((s) => ({ drumPadVelocities: { ...s.drumPadVelocities, [id]: Math.min(1, Math.max(0, v)) } }))`.
  - `partializeAppState`: add the key.
  - `sanitizePersistedState`: read `input.drumPadVelocities`. If it is a plain non-array object, keep entries whose key is in `BEAT_VOICE_IDS` and whose value is a finite number in [0, 1]. Otherwise `delete sanitized.drumPadVelocities`.
  - Add a comment that this is validation and not a migration, per the no-migration-chains rule.

- [ ] **Step 4: Implement the UI side.**
  - `useDrumPads`:
    ```ts
    const overrides = useAppStore((s) => s.drumPadVelocities);
    const [draft, setDraft] = useState<Record<string, number>>({});
    const pads = useMemo(() => padsWithVelocities(DEFAULT_PADS, overrides, draft), [overrides, draft]);
    ```
  - `onPadVolumeChange` updates the draft.
  - `onPadVolumeCommit(id, v)` calls `setDrumPadVelocity(id as BeatVoiceId, v)` and removes `id` from the draft.
  - Everything is exposed through the memoized `InputDeckDrumProps` (extend that type).
  - Rewrite the comment at `DrumPadGrid.tsx:24-29` so it is true: velocity overrides persist per pad in the ui slice (`drumPadVelocities`), keyed by pad id (the Beat voice id). `DEFAULT_PADS.volume` is the default a pad falls back to.

- [ ] **Step 5: Verify.** Run `bun test src/store/store.test.ts src/components/ui/DrumPadGrid.test.tsx src/components/useInputDeck.test.tsx src/components/drumPadVelocity.test.ts`, then `bun run check:keys`, then `bun run verify`.

- [ ] **Step 6: Commit.** `git commit -m "feat(pads): persist drum-pad velocity in the ui slice, committed on release"`

---

### Task 10: S2 — persist serialises only when a persisted key changed

**Design:** replace `createJSONStorage(() => persistStorage)` with a `PersistStorage<PersistedState>` that receives the **object** zustand hands it (`{ state, version }`).
- It skips the write when `version` and every top-level value of `state` are `Object.is`-equal to the last object it wrote under that name.
- Otherwise it `JSON.stringify`s and calls the coalesced `StateStorage.setItem`, exactly as today.
- `getItem` parses exactly as zustand's `createJSONStorage` does (sync path; the coalesced storage is sync).
- `removeItem` forgets the remembered value.
- The first write after boot always happens, because nothing is remembered yet. That preserves the `onRehydrateStorage` → `setState({})` legacy-adoption write.
- The remaining per-`set()` cost is zustand's own `partialize({...get()})`: a shallow spread plus seven property reads, with no serialisation.

This relies on immutable updates of persisted values. Every writer of the three libraries replaces arrays (`presetsSlice.ts`), and a test pins it.

**Files:**
- Create: `src/store/persistStorage.ts`, `src/store/persistStorage.test.ts`
- Modify: `src/store/store.ts:139-156` (storage wiring and its comment), `:318` (`storage:` option)
- Test: `src/store/store.test.ts`

**Interfaces (produced):**

```ts
export function createDedupedJsonStorage<S extends object>(
  storage: StateStorage,
  opts?: { stringify?: (v: unknown) => string },
): PersistStorage<S>;
```

- [ ] **Step 1: Write the failing unit tests** (`persistStorage.test.ts`):

```ts
const raw = () => { const m = new Map<string, string>(); let writes = 0;
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { writes++; m.set(k, v); },
           removeItem: (k: string) => { m.delete(k); }, writes: () => writes }; };

test('an unchanged partialized object is not serialised or written', () => {
  const r = raw(); let stringified = 0;
  const s = createDedupedJsonStorage<{ a: number[]; b: boolean }>(r, { stringify: (v) => { stringified++; return JSON.stringify(v); } });
  const a = [1];
  s.setItem('k', { state: { a, b: true }, version: 1 });
  s.setItem('k', { state: { a, b: true }, version: 1 });   // fresh wrapper, same values
  expect(stringified).toBe(1); expect(r.writes()).toBe(1);
});
test('a changed reference, a changed key set or a changed version writes', () => { /* three cases, each +1 */ });
test('removeItem forgets the last write so the next setItem writes', () => { /* … */ });
test('getItem round-trips what setItem wrote', () => { /* … */ });
```

Fill in the three stubbed tests with concrete assertions in the same style. Each is 4–6 lines.

- [ ] **Step 2: Write the failing store-level test** (`store.test.ts`, using the file's `getStore()` harness):

```ts
test('a set() that touches no persisted key does no persist serialisation', async () => {
  const { useAppStore } = await getStore();
  useAppStore.setState({ metronomeActive: !useAppStore.getState().metronomeActive }); // prime: one real write
  const spy = spyOn(JSON, 'stringify');
  useAppStore.setState({ playheadChordIndex: 2 });          // non-persisted
  useAppStore.getState().triggerMidiActivity();             // non-persisted, per-MIDI-message
  const persistCalls = spy.mock.calls.filter(([v]) => v && typeof v === 'object' && 'state' in v && 'version' in v);
  expect(persistCalls).toHaveLength(0);
  spy.mockRestore();
});
test('a persisted-key change still reaches storage after flushPersistedWrites()', async () => {
  // toggle metronome, flushPersistedWrites(), read localStorage key, expect metronomeActive flipped
});
```

Keep every existing persist test unchanged. They are the proof that `flushPersistedWrites()` and hydration semantics hold.

- [ ] **Step 3: Run them.** `bun test src/store/persistStorage.test.ts src/store/store.test.ts`. Expected: FAIL (the module is missing, and the spy sees one persist stringify per `set`).

- [ ] **Step 4: Implement.** Write `persistStorage.ts`, importing the types `PersistStorage`, `StateStorage` and `StorageValue` from `zustand/middleware`. In `store.ts`, set `storage: createDedupedJsonStorage<PersistedState>(persistStorage)`. Update the comment above `persistStorage` ("The coalescer sits BELOW …") to describe the three layers: dedupe → stringify → coalesce. `flushPersistedWrites` is unchanged.

- [ ] **Step 5: Verify.** Run `bun test src/store src/utils/coalescedStorage.test.ts`, then `bun run verify`. Then do a manual check in a real browser with `bun run dev`:
  - Toggle the metronome and reload. It should persist.
  - Play for a few bars with DevTools → Application → Local Storage open. The value must not be rewritten on each beat.

- [ ] **Step 6: Commit.** `git commit -m "perf(store): skip persist serialisation when no persisted key changed"`

---

### Task 11: Docs — CLAUDE.md, audit pages and feature overview reflect the code

Docs only, with no source changes. State rules and lists, never counts or versions.

**Files:** `CLAUDE.md`, `docs/architecture/structure/README.md`, `01-ui.md`, `02-store.md`, `03-audio.md`, `04-domain-and-dependencies.md`, `docs/architecture/feature-overview.md`.

- [ ] **Step 1: Fix these `CLAUDE.md` statements the audit found wrong.** Re-read each cited source line first.
  1. **Slice roster** (layer 3): list every slice `store.ts` composes: transport, musicContext, synth, chords, bass, pad, lead, fx, beat, effects, ui, presets, loop, loopCopy, project, mixdown, drive. Phrase it as "the slices `store.ts` composes (the list there binds)". Add: "plus one separate vanilla store, `audioRecovery.ts`, for audio-recovery state, kept outside the persisted app store."
  2. **IndexedDB**: replace "Bodies and metadata live in separate object stores … every write touches both in one transaction" with: one object store (`project`) holding one fixed slot key. The version upgrade drops the old two-store layout (`projectStoreIdb.ts`). There is no library listing to keep cheap.
  3. **Store → engine bridge**: qualify "engineSync is the bridge". State these rules:
     - Components never call engine setters.
     - Persistent audio state reaches the engine through `engineSync`.
     - A small set of store modules call `audioEngine` directly, for **cuts, previews and lifecycle**, and each must say why in its docblock. Name them by role: loop switch `loadLoop`, vibe swap `vibes`, project install `projectSlice`, previews (`synthPatchPreview`, `effectsPreview`, `beatPreview`, `synthPresetInstall`), runtime/incident plumbing (`audioRecovery`, `incidentReporter`, `sourceBuses`).
     - After Task 4, MIDI CC is **not** in that list.
     - Verify the list with `grep -ln "audioEngine" src/store/*.ts | grep -v test` at edit time.
  4. **Layer 4 "dumb views"**: say that `src/components/` also hosts the live playback **controllers** (`useChordPlayback`, `useLeadPlayback`, `useSequencerPlayback`, `useInputDeck`, `usePlayheadSync`) and the step and playhead pub/subs. They reach audio through `audio/playback/playbackEngine`, never `audio/engine`, and a lane sounds because its grid is mounted.
  5. **Meter exemption**: add that the `eslint.config.js` block for the four analyser files turns `no-restricted-imports` **off entirely**. It therefore also lifts the tonal and taper bans for those files, and a reviewer must keep them free of such imports by hand. In the tonal paragraph, drop the phrase that says the analyser exemption is "unrelated" to the tonal axis.
  6. **`persist` paragraph**: rewrite it for Task 10. zustand still runs `partialize` on every `set()`, but `store/persistStorage.ts` serialises only when a persisted top-level value changed by reference. The coalescer still buffers the write, and `flushPersistedWrites()` is unchanged. The pointer-driven rule stays.
  7. **High-frequency state**: add `playheadBeat` (Task 6) next to the playback step as a local pub/sub example. Mention that `midiActivityTimestamp` is still a slice key written per MIDI message and is now cheap because of Task 10. That is a known, accepted exception (audit S2/5a-6).
  8. **Drum pads**: `DEFAULT_PADS` follows the canonical order but omits `bell` (`PADLESS_VOICES`). Pad velocity overrides persist as `drumPadVelocities` (Task 9).
  9. **ArpSettings paragraph**: after Task 2, the "no colliding names" claim is true. Add one clause: `BeatFilterType` derives from the synth `FilterType`.
  10. Also fix the other `CLAUDE.md` claims listed in `04-domain-and-dependencies.md` §5.1:
      - `dependencyLayers.test.ts` "proves" the four layers: soften this to what the test actually checks. Read §3 of that page, then the test.
      - `trimTable.ts`: add "a generated calibration artefact in `src/data/`, read by no runtime code".

- [ ] **Step 2: Update the audit pages.**
  - `README.md`: add a "Status" column (or a "Fixed on `fix/structure-audit-bugs`" marker) to the findings tables for A1, D1, S5, S3/A2, S4, U5, S6, U8 (Undo, no confirm), S8, U6, S2.
    - Fix the mermaid "8 modules that call audioEngine directly" node, which is a count, and the "17 slices" label.
    - Mark the deferred items unchanged.
  - Detail pages: at each fixed finding, add a one-line "Fixed:" note with the new behaviour and file. Delete the stale sentences:
    - 02-store §4: "two-step contracts".
    - 01-ui 5a #9 and #10.
    - 03-audio F1, F2, F5 bass/AmbientBackdrop.
    - 04 §5.1 #1.
- [ ] **Step 3: Update `feature-overview.md`.**
  - Fix the rows 01-ui 5a #1–#6 lists: export in the Header song dropdown, transport in the bottom bar, dock contents, the Master EQ and Monitor, Diagnostics DEV-only, the recovery branch of `IncidentDialog`.
  - Fix the diagram edges from 03-audio F2–F4 (MIDI split; controllers in `components/`; controllers pass note names to `playbackEngine`).
  - Fix 04 §5.2 #6–#9 (utils is not pure; diagnostics reads the store and engine; missing edges; `data/` has `import type` edges).
  - Add the loop-delete Undo and pad-velocity persistence to the feature inventory.
- [ ] **Step 4: Verify.** Run `bun run verify`. Docs do not affect it, but the gate is the rule. Then `grep -n "AmbientBackdrop\|separate object stores\|forced monophonic" CLAUDE.md .claude/skills docs/architecture` must return nothing.
- [ ] **Step 5: Commit.** `git commit -m "docs: align CLAUDE.md, dsp skill and structure audit with the fixed code"`

---

## Deferred (out of scope; audit codes for traceability)

- **Per-track FX** (user decision 2026-09-21): drums become an ordinary track with sends like the others; decide then whether per-voice `reverbSend` becomes a voice-level send into the track's reverb or is removed. Its own design/plan.

- Refactors and smells:
  - God `MasterRack` (A7).
  - Misplaced music logic in `audio/` root and duplicate preset lookups (A6, D5).
  - Mixdown and theme in `Header.tsx` (U7).
  - The per-loop schema written 5+ times (S7).
  - Large files.
  - Naming (D4, D6-D8).
  - The five header components.
  - The three draft-gesture hooks.
  - Migrating the other five toast copies onto `useTimedToast`. Task 7 extracts it and moves only `InstantVibesBar`.
- Runtime cycles `sanitize` ↔ `leadSlice` and `store` → `loopCopySlice` → `loadLoop` → `store` (D-cyc).
- Layering blocks for `utils/`, `diagnostics/` and `routing/` (D3).
- The planner → engine import via `chordPlayback` (A4). The React hook in `audio/` and the missing drum planner (A5).
- Moving the playback controllers out of `components/` (U4/A3). Task 11 only documents where they live.
- Dead code not naturally removed by a fix:
  - The unused analyser byte-read methods.
  - `isInitialized`.
  - The `KEYBOARD_NOTES` re-export.
  - The test-only actions `setMidiMappings`, `setCustomChordRhythm`, `setCustomBassPattern` and `buildMixdownSnapshot`.
- `midiMappings` not persisted (02-store 5b #13). Session state surviving project install (5b #12).
- A confirm dialog for loop delete. The user chose Undo.
- The MIDI bridge lifecycle (started at mount, never torn down; 02-store 5b #4). The `sourceTransition` ambient global (5b #5).

## Self-review checklist (run before handing off)

- Spec coverage:
  - User items 1–11 map to tasks 3, 5, 1, 7, 9, 8, 2, 10, 6, 4 and 11.
  - The skill's stale claims are covered in Task 1.
  - The S4 extra paths (vibes, loop copy, project load) are covered in the verification table and Task 8.
- Names are consistent across tasks:
  - `keyChangePatch` (Task 5 → 8)
  - `DeletedLoop` / `restoreLoop` (Task 7)
  - `playheadBeat` / `usePlayheadBeat` (Task 6)
  - `drumPadVelocities` / `setDrumPadVelocity` (Task 9)
  - `createDedupedJsonStorage` (Task 10)
  - `BeatFilterType` (Task 2 → 11)
- Expected literals in Task 5 are copied from the existing lead tests; FX must match Lead for the same input.
