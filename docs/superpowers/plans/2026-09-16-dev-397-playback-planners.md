# DEV-397: Separate Pure Playback Planning From Runtime Controllers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Express chord, bass, pad and melody playback as deterministic PLANNERS — pure functions
over an immutable, lane-specific snapshot that return resolved playable events — leaving the
clock subscription, arming state, scheduling and every engine call to runtime CONTROLLERS, with
live playback and the offline mixdown calling the same planner.

**Architecture:** A new leaf folder `src/audio/playback/plan/` holds one planner module per lane
(`padPlan.ts`, `chordPlan.ts` for the chord+bass pair, `melodyPlan.ts`). Each exports a **snapshot
type** naming exactly the durable intent that lane reads, and one or two **pure planning
functions** over it. There are deliberately **four lane-specific snapshots, not one unified
`PlaybackSnapshot`**: every lane has its own arm-time/emit-time store-read split (chord/bass arm a
cycle once per chord but read synth params, feel and arp settings live on every step; pad is
arm-time only; melody is emit-time only), and a single snapshot built once per run would freeze
the emit-time half and silently kill the live-tweak behaviour the ACs require preserving. The
snapshot is therefore **arm-time immutable**, and everything read live is passed to the planner as
an explicit per-step context argument by the controller.

Snapshots are BUILT in two places and CONSUMED in one: `src/store/playbackPlanSnapshots.ts`
(store layer, takes an `AppStore` value as an argument — it never calls `useAppStore.getState()`
itself, so no module outside a controller touches the zustand singleton) and
`src/audio/export/renderMixdown.ts` (audio layer, builds the same shapes from a `MixdownLoop`).
Both feed the identical planner, which is what makes live/offline equivalence a deep-equality
assertion on two snapshots rather than a hand-transcribed comparison of two schedulers.

Migration is **lane-by-lane in three phases** — pad (Tasks 1-4), chord+bass (Tasks 5-11), melody
(Tasks 12-14) — each ending with both call sites (live and offline) on the new planner and the
phase's equivalence test green, so the branch is shippable at the end of any phase. Most of the
musical logic already exists and is already pure (`buildChordEvents`, `eventsForCycleStep`,
`resolveBassSteps`, `resolvePadArm`, `leadScheduleHits`, `leadSoundingNotes`,
`resolveLeadStepTriggers`); this plan relocates the *orchestration* around them behind an explicit
signature and deletes the one genuine duplication (melody's offline transcription). It is not a
rewrite of any DSP or music-theory code, and no scheduling number changes.

**Tech Stack:** TypeScript, Bun test runner, Zustand (store layer only), raw Web Audio API,
ESLint flat config (the purity gate).

**Spec:** `work/dev397-playback-survey.md` (the exploration pass that surveyed the current
playback architecture lane by lane) plus the Linear issue DEV-397 AC/DoD, reproduced in the AC
mapping at the end of this plan. The epic context is
`docs/superpowers/plans/2026-09-16-dev-391-music-domain-architecture-epic-plan.md`; DEV-399
("narrow the audio-engine contract to resolved playable events") consumes this plan's output
types and depends on it landing first.

## Global Constraints

- **Layering (CLAUDE.md's four layers).** `src/audio/` never imports `store/` or `components/`;
  `src/store/` never imports `components/`; `src/components/` must not import `audio/engine`.
  Planners live in `src/audio/playback/plan/` and may import `src/data/`, `src/utils/`,
  `src/musicCore/` and sibling `src/audio/` modules — nothing else.
- **`../../` is an ESLint error.** Use the `@/` alias for anything outside the planner's own
  folder or its immediate parent (`../chordPlayback` is fine; `../../chordRhythms` is not).
- **Planners make zero engine calls, zero `AudioContext` reads and zero wall-clock/global
  reads.** No `audioEngine`, no `ctx.currentTime`, no `Date`, `performance`, `Math.random`,
  `setTimeout`, `globalThis`, `window`. Every scheduled time is an argument. Task 2 makes this an
  ESLint block scoped to the folder, with `src/architecture/playbackPlannerPurity.test.ts`
  proving the block is armed.
- **Never call engine setters from a component**; the store→engine bridge stays
  `src/store/engineSync.ts`. Controllers reach the engine only through
  `src/audio/playback/playbackEngine.ts` and `src/audio/playback/chordPlayback.ts`'s emitters,
  exactly as they do today.
- **Do not touch `src/audio/clock.ts`.** "The shared 16th clock runs if and only if a player holds
  a subscription" — each controller keeps its own independent `subscribePlaybackClock` call, and
  no planner is clock-aware.
- **High-frequency playback position stays out of every store slice.** The current step, the
  progression step and any per-tick plan state stay in refs/locals and in
  `src/components/playbackStep.ts`'s publisher. No task may move a playhead, a step index or a
  plan into a slice.
- **No migration chains.** This is a runtime/type refactor: no persisted shape changes, no
  `PERSIST_VERSION` bump, no `PROJECT_FORMAT_VERSION` bump, no version-gated branch.
- **`src/data/` is not touched by this plan.**
- **Knip has a zero-finding baseline in BOTH graphs.** Export only what a *production* module
  imports: an exported type or function whose only consumer is a test file is an unused
  production export and fails `bun run check:dead-code:production`. Where a type is only ever
  named inside its own module, declare it unexported and let callers pass object literals.
- **Tests are `bun:test`, no DOM and no testing-library** (`.claude/rules/testing.md`). Planner
  tests construct plain input objects — no `AudioContext`, no React, no zustand singleton.
- **`bun run verify` is the completion gate for the FINAL task only.** Intermediate tasks are
  judged by the test files they name. The pad planner (Tasks 1-2) and the chord/bass planners
  (Tasks 5-10) each exist with no production consumer for a window before their own wiring task
  lands — Task 1 confirmed `check:dead-code:production` goes red on `padPlan.ts` immediately and
  stays red until Task 3 wires the live consumer; the same applies to every pure-planner-only task
  in every phase. This is expected and resolves at that phase's wiring task, not only "between
  Task 5 and Task 10" — do not treat it as a regression signal in ANY phase's pure-planner task.
- **Planner function signature convention (set by Task 1's review, binding for every later
  task):** a planner's second parameter is always a single object, never a bare positional
  scalar — `plan<Lane>(snapshot, context)`, where `context` carries whatever per-call values the
  snapshot doesn't (an index, live synth/feel/arp params, a step number). This keeps adding a new
  per-call value an additive change to `context`'s shape rather than a signature change. Pad's
  `chordIndex` is `{ chordIndex: number }`, not a bare number, even though it has only one field
  today. **This convention was added after Tasks 5-14's task text below was drafted.** Every code
  snippet in Tasks 5-14 below showing `planChordLane(snapshot, chordNotes, totalBars)`,
  `planBassLane(snapshot, chordIndex, totalBars)`, `planChordArm(snapshot, chordIndex,
  startProgressionStep)`, `planMelodyStep(snapshot, stepInLoop, stepsPerBar, tickDurSec)` or any
  other bare-positional-argument call is STALE — the convention, not the stale snippet, is
  authoritative. Every one of these functions takes `(snapshot, context: { ...fields })` — e.g.
  `planChordLane(snapshot, { chordNotes, totalBars })`, `planBassLane(snapshot, { chordIndex,
  totalBars })`, `planChordArm(snapshot, { chordIndex, startProgressionStep })`,
  `planMelodyStep(snapshot, { stepInLoop, stepsPerBar, tickDurSec })`. Implementers of Tasks
  6-14 must use the object form throughout, including at every call site the stale snippets show
  as positional (test files, other planners calling these, live/offline wiring) — do not
  propagate the positional form because a code block in this document still shows it.
  (Confirmed by Tasks 5-11's execution: every one of them needed this correction and applied it
  cleanly once told — the same applies to Task 12's `planMelodyStep` and its two consumers,
  Tasks 13-14.)
- **Planner output-type naming convention (set by Task 1's review, binding for every later
  task):** a small (2-3 field) output shape that mirrors an already-wrapped pure function's own
  return type may stay an inline/anonymous type, as pad's `{ notes, holdSec } | null` does
  (mirroring `resolvePadArm`'s own return). A planner whose output DEV-399 is expected to consume
  directly, or whose shape has more than a couple of fields (chord/bass's full-hold descriptor,
  melody's trigger list), must export a named type once it has a real production consumer — not
  before, per the Knip constraint above.
- **No timing or sound change is intended.** Two convergences of a pre-existing live/offline
  divergence ARE intended and are each called out with a test at the task that lands them:
  chord-duration flooring (Task 7) and melody hold/offset arithmetic staying bit-identical
  (Task 14). **A third suspected divergence — the arp hold scale — turned out, per Task 11's
  trace, not to be a real behavioral difference at all** (see the amended finding #2 below); no
  test can or needs to pin it.

---

## Explore-before-planning findings (verified against current `refactor/dev-397-playback-planners`)

- `src/audio/playback/chordPlayback.ts` (451 lines) already exports the pure core:
  `BarInvariantEvent` (l.24), `StepEvent` (l.34, `Omit<BarInvariantEvent, 'step'|'lastBarOnly'>`),
  `buildChordEvents` (l.37), `eventsForCycleStep` (l.101), `chordPlanPosition` (l.211),
  `arpEventsForStep` (l.236). The engine-touching emitters in the same file —
  `emitStepEvents` (l.118), `playFullHoldChord` (l.273), `scheduleWholeChord` (l.167) — stay
  exactly where they are; they are the controller's tools, not the planner's.
- `src/components/loop/chord/useChordPlayback.ts` (918 lines) holds the chord/bass orchestration:
  `ChordPlan` (l.136), `armPad` (l.176), `PlanLaneContext` (l.207), `PlanLane` (l.219),
  `resolveChordLane` (l.230), `resolveBassLane` (l.265), `startChordPlan` (l.329),
  `emitChordPlanStep` (l.391), `useChordClock` (l.764). `resolveChordLane`/`resolveBassLane`
  **call the engine inside the full-hold branch** (l.249 `playFullHoldChord`, l.296
  `playbackNoteOn`) — that is the single structural obstacle to purity in this lane, and the
  planner returns a full-hold DESCRIPTOR instead.
- `src/audio/playback/padPlayback.ts` (174 lines) is already pure end to end: `resolveDroneNotes`,
  `applyPadVoicing`, `shouldArmPad`, `padHoldsAcrossLoop`, `padHoldSec`, `PadArmInput` (l.140),
  `resolvePadArm` (l.156). Both call sites already use it — live `armPad` (useChordPlayback l.176)
  and offline (renderMixdown l.789). Pad's work is therefore the snapshot seam only.
- `src/audio/leadMelody.ts` (548 lines) exports the melody core: `LeadTrigger` (l.23),
  `LeadNote` (l.40), `LeadSounding` (l.45), `leadSoundingNotes` (l.143),
  `resolveLeadStepTriggers` (l.311), `leadScheduleHits` (l.533). The **orchestration of those
  three is duplicated**: `useLeadPlayback.ts` l.121-149 and `renderMixdown.ts`'s
  `scheduleMelodyStep` l.653-687 are the same loop written twice. This is the one real
  duplication DEV-397 removes.
- `src/audio/export/renderMixdown.ts` (969 lines): `LoopVoices` (l.~330-357), `buildLoopVoices`
  (l.508), `renderChordEventsAt` (l.370), `renderBassEventsAt` (l.385), `resolveLoopCycles`
  (l.409), `bassEventsForChord` (l.450), `fullHoldBassNote` (l.488), `scheduleArrangement`
  (l.690), `MixdownMelodyTrack` (l.105), `mixdownLeadTrack`/`mixdownFxTrack` (l.117/l.129).
  `LoopVoices`, `renderChordEventsAt`, `renderBassEventsAt` and `buildLoopVoices` are referenced
  from `renderMixdown.ts` and `renderMixdown.test.ts` only (verified by grep) — nothing else
  imports them, so reshaping them is a two-file change.
- Three pre-existing live/offline divergences, all currently invisible because they need an
  uncommon combination:
  1. **Chord durations.** Live builds `s.chords.map((c) => c.bars * stepsPerBar)`
     (useChordPlayback l.345); offline uses `Math.max(1, chord.bars || 1) * stepsPerBar`
     (renderMixdown l.419-421). A `bars: 0` chord folds custom-lane boundaries differently.
  2. **Arp hold scale — NOT a real divergence (amended after Task 11's trace).** Live used
     `feelToHoldScale(s.chordFeel)` (useChordPlayback l.405); offline used `voices.chordHoldScale`,
     i.e. `cycleHoldScale(cycle.custom, loop.chordFeel)` (renderMixdown l.748). This LOOKS like a
     divergence because `cycleHoldScale` clamps a CUSTOM lane's scale to `<= 1`
     (chordRhythms.ts l.141-144) while `feelToHoldScale` does not — but `arpEventsForStep`
     (chordPlayback.ts) applies its OWN `Math.min(1, holdScale)` clamp to the one field either
     value reaches (`hold`), so the two forms are bit-identical downstream at every feel value.
     Live and offline have always produced the same arp hold; this was never audible. `Task 11`
     chose `feelToHoldScale` for the shared planner because it states the actual rule ("feel may
     only tighten a span the USER DREW, and an arp has none") directly, not because it changes
     behavior.
  3. **Total bars.** Live `chord.bars || 1` (l.338); offline `Math.max(1, chord.bars || 1)`.
     Same family as (1).
  All three converge on ONE planner in this plan; (1) and (3) adopt the floored form, (2) adopts
  the live form.
- `src/components/loop/chord/useChordPlayback.test.ts` (273 lines) tests only the exported arming
  helpers plus two source-scan assertions about `HARD_STOP_RELEASE` and
  `playbackStopOwnedVoices` (l.250-272) — it names neither `startChordPlan` nor
  `emitChordPlanStep`, so this plan does not disturb it. Do not break the
  `playbackStopOwnedVoices` occurrence count of 2.
- `src/audio/export/mixdownFixture.ts` exports `mixdownLoop(over: Partial<MixdownLoop> = {})`,
  `mixdownSnapshot`, `mixdownMelodyBar(note)`, `beatPatternFixture` and friends; it is excluded
  from Knip's project graph by the `*Fixture` pattern in `knip.json`. Every equivalence test in
  this plan builds on `mixdownLoop(...)` rather than hand-writing a `MixdownLoop`.
- `eslint.config.js` (560 lines) defines `TONAL_IMPORT_BAN`, `TONAL_SCOPED_PACKAGE_BAN`,
  `TAPER_CONVERSION_BAN`, `GLOBAL_RESTRICTED_SYNTAX`, `GLOBAL_RESTRICTED_GLOBALS`,
  `AUDIO_RANDOM_BAN_SYNTAX`. The `src/audio/**` import block is at l.216 and the `Math.random`
  block at l.255. **Flat config REPLACES a rule rather than merging it**, so a narrower block must
  spread the broader lists back in — the `src/data/` block at l.430 is the worked example, and its
  comments at l.462 and l.473 say so explicitly.

---

## Task 1: The pure pad planner

**Files:**
- Create: `src/audio/playback/plan/padPlan.ts`
- Create: `src/audio/playback/plan/padPlan.test.ts`

**Interfaces:**
- Consumes: `resolvePadArm(input: PadArmInput)` and `padHoldsAcrossLoop(mode: PadMode)` from
  `src/audio/playback/padPlayback.ts`; `loopBars(chords)` from `@/utils/songStructure`;
  `barDurationSec(bpm, stepsPerBar)` from `@/utils/musicTheory`.
- Produces: `PadPlanSnapshot` (exported; built by Task 3 in the store layer and by Task 4 in the
  renderer) and
  `planPadArm(snapshot: PadPlanSnapshot, chordIndex: number): { notes: string[]; holdSec: number } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/audio/playback/plan/padPlan.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { planPadArm, type PadPlanSnapshot } from './padPlan';
import { generateBlockChordNotes } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';

/** Two two-bar chords: four bars to the loop, so drone and pad holds differ. */
const CHORDS: ChordItem[] = [
  { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
];

/** 120 bpm at 16 steps/bar: one step is 0.125 s and one bar is 2 s. */
function snapshot(over: Partial<PadPlanSnapshot> = {}): PadPlanSnapshot {
  return {
    mode: 'pad',
    chords: CHORDS,
    degree: 0,
    intervals: [1, 5],
    padOctave: 3,
    voicing: 'triad',
    scaleRoot: 'C',
    scaleType: 'major',
    bpm: 120,
    stepsPerBar: 16,
    ...over,
  };
}

describe('planPadArm', () => {
  test('pad mode arms every chord and holds for that chord alone', () => {
    const arm = planPadArm(snapshot(), 1);
    expect(arm?.notes).toEqual(generateBlockChordNotes('maj', 'F', 3));
    expect(arm?.holdSec).toBe(4); // 2 bars x 2 s
  });

  test('drone mode arms only at the top of a loop pass, and holds the whole pass', () => {
    const drone = snapshot({ mode: 'drone' });
    expect(planPadArm(drone, 1)).toBeNull();
    const arm = planPadArm(drone, 0);
    // The drone's intervals are FIXED — degree 0 of C major is C, so 1P + 5P.
    expect(arm?.notes).toEqual(['C3', 'G3']);
    expect(arm?.holdSec).toBe(8); // 4 loop bars x 2 s, not the chord's 2
  });

  test('a drone with no intervals arms nothing', () => {
    expect(planPadArm(snapshot({ mode: 'drone', intervals: [] }), 0)).toBeNull();
  });

  test('a chord index outside the progression arms nothing', () => {
    expect(planPadArm(snapshot(), 9)).toBeNull();
  });

  test('is a plain function of its inputs: two calls with the same snapshot agree', () => {
    expect(planPadArm(snapshot(), 0)).toEqual(planPadArm(snapshot(), 0));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/plan/padPlan.test.ts`
Expected: FAIL — `Cannot find module './padPlan'`.

- [ ] **Step 3: Write the implementation**

Create `src/audio/playback/plan/padPlan.ts`:

```typescript
import type { ChordItem, PadInterval, PadMode, PadVoicing } from '@/types';
import { barDurationSec } from '@/utils/musicTheory';
import { loopBars } from '@/utils/songStructure';
import { padHoldsAcrossLoop, resolvePadArm } from '../padPlayback';

/**
 * Everything the pad lane reads, captured when a chord is ARMED.
 *
 * Pad is the one lane with no emit-time half at all: an arm is a single
 * note-on/note-off pair, so there is no per-step context to pass and no live
 * read to preserve. The synth patch is deliberately absent — it is the
 * CONTROLLER's, read at the moment it triggers, which is what keeps a pad knob
 * audible on the next arm without the planner knowing an engine exists.
 */
export interface PadPlanSnapshot {
  mode: PadMode;
  /** The whole progression: a drone's hold is the loop's bars, not the chord's. */
  chords: readonly ChordItem[];
  degree: number;
  intervals: readonly PadInterval[];
  padOctave: number;
  voicing: PadVoicing;
  scaleRoot: string;
  scaleType: string;
  bpm: number;
  stepsPerBar: number;
}

/**
 * The pad's arm for the chord at `chordIndex`, or null when nothing should
 * sound.
 *
 * `isLoopStart` is derived here rather than passed: the caller already knows
 * the chord's index inside the progression, and "index 0" is the only thing
 * `shouldArmPad` ever meant by the top of a pass. `loopBars` is still paid for
 * by drone mode only — pad mode arms on EVERY chord and must not walk the
 * progression to learn a number it will not read.
 */
export function planPadArm(
  snapshot: PadPlanSnapshot,
  chordIndex: number,
): { notes: string[]; holdSec: number } | null {
  const chord = snapshot.chords[chordIndex];
  if (!chord) return null;
  return resolvePadArm({
    mode: snapshot.mode,
    isLoopStart: chordIndex === 0,
    chord,
    degree: snapshot.degree,
    intervals: snapshot.intervals,
    padOctave: snapshot.padOctave,
    voicing: snapshot.voicing,
    scaleRoot: snapshot.scaleRoot,
    scaleType: snapshot.scaleType,
    barDur: barDurationSec(snapshot.bpm, snapshot.stepsPerBar),
    loopBarCount: padHoldsAcrossLoop(snapshot.mode) ? loopBars(snapshot.chords) : 0,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/plan/padPlan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/plan/padPlan.ts src/audio/playback/plan/padPlan.test.ts
git commit -m "refactor(playback): add the pure pad planner"
```

---

## Task 2: Arm the planner purity gate in ESLint, and prove it is armed

**Files:**
- Modify: `eslint.config.js` (insert a new block immediately after the `src/audio/**`
  `Math.random` block that currently ends at line 272)
- Create: `src/architecture/playbackPlannerPurity.test.ts`

**Interfaces:**
- Consumes: the existing config constants `TONAL_IMPORT_BAN`, `TONAL_SCOPED_PACKAGE_BAN`,
  `TAPER_CONVERSION_BAN`, `GLOBAL_RESTRICTED_SYNTAX`, `GLOBAL_RESTRICTED_GLOBALS`,
  `AUDIO_RANDOM_BAN_SYNTAX`, all declared at the top of `eslint.config.js`.
- Produces: nothing importable — a gate every later task in this plan is written against.

- [ ] **Step 1: Write the failing test**

Create `src/architecture/playbackPlannerPurity.test.ts`:

```typescript
/**
 * The committed proof that DEV-397's planner purity block is armed.
 *
 * "A planner performs no store writes, engine calls, AudioContext reads or
 * wall-clock/global reads" is an argument that rests entirely on a config file,
 * and a config file is exactly what an ESLint upgrade loosens silently. Same
 * idiom as src/data/dataLayerPurity.test.ts and notePatternGuard.test.ts:
 * severity is asserted too, because `bun run verify` tolerates warnings and a
 * block that landed at 'warn' would enforce nothing.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

const PLANNER = 'src/audio/playback/plan/__purityFixture__.ts';
/** A file under src/audio/ that is NOT a planner, to prove the block is scoped. */
const NEIGHBOUR = 'src/audio/playback/chordPlayback.ts';

async function messagesFor(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null)
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const ENGINE_IMPORT = "import { audioEngine } from '@/audio/engine';\nexport const e = audioEngine;\n";
const STORE_IMPORT = "import { useAppStore } from '@/store/store';\nexport const s = useAppStore;\n";
const CLOCK_READ = 'export const now = Date.now();\n';
const TIMER = 'export const t = () => setTimeout(() => {}, 0);\n';

describe('playback planner purity guard (DEV-397)', () => {
  test('importing the engine from a planner is an error', async () => {
    expect(await messagesFor(ENGINE_IMPORT, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-imports',
      severity: 2,
    });
  });

  test('importing the store from a planner is an error', async () => {
    expect(await messagesFor(STORE_IMPORT, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-imports',
      severity: 2,
    });
  });

  test('reading the wall clock from a planner is an error', async () => {
    expect(await messagesFor(CLOCK_READ, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-globals',
      severity: 2,
    });
  });

  test('arming a timer from a planner is an error', async () => {
    expect(await messagesFor(TIMER, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-globals',
      severity: 2,
    });
  });

  test('the block is SCOPED: the engine import is fine in its playback neighbour', async () => {
    const messages = await messagesFor(ENGINE_IMPORT, NEIGHBOUR);
    expect(messages).not.toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  test('the wider audio bans still apply inside the planner folder', async () => {
    // The narrower block REPLACES the broader rule rather than merging with it,
    // so every list it overrides has to be spread back in. These two prove it.
    expect(await messagesFor("import { note } from 'tonal';\nexport const n = note;\n", PLANNER))
      .toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
    expect(await messagesFor('export const r = Math.random();\n', PLANNER))
      .toContainEqual({ ruleId: 'no-restricted-syntax', severity: 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/architecture/playbackPlannerPurity.test.ts`
Expected: FAIL — the planner folder has no block of its own yet, so the engine import, `Date.now`
and `setTimeout` all lint clean.

- [ ] **Step 3: Write the implementation**

In `eslint.config.js`, insert this config object immediately after the `src/audio/**`
`Math.random` block (the one whose `files` is at line 255 and whose closing `},` is at line 272),
so it wins for planner files:

```javascript
  {
    // DEV-397: src/audio/playback/plan/ holds PURE PLANNERS. A planner takes an
    // immutable snapshot plus an explicit per-step context and returns resolved
    // playable events; it may not read the store, touch the engine or an
    // AudioContext, read a wall clock, arm a timer, or reach any other ambient
    // global. Every scheduled time is an argument, which is what lets the live
    // controllers and the offline renderer share one implementation and what
    // makes a planner testable with no DOM, no zustand and no AudioContext.
    //
    // Landed directly at 'error' per D5: the folder is new, so the rule starts
    // with nothing to phase in a 'warn' for.
    //
    // Both lists below REPLACE the broader src/audio/** entries rather than
    // merging with them (flat config semantics — see the src/data/ block's own
    // comments), so the audio-wide bans are spread back in. Leaving either
    // spread out would silently un-ban `tonal` and `Math.random` in exactly the
    // folder that must be the most deterministic code in the app.
    //
    // `Math` itself is NOT banned: planners legitimately use Math.max/floor.
    // Math.random is covered by AUDIO_RANDOM_BAN_SYNTAX below.
    files: ['src/audio/playback/plan/**/*.{ts,tsx}'],
    ignores: ['src/audio/playback/plan/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
            {
              group: ['**/audio/engine', '**/audio/engine/**', '**/playback/playbackEngine'],
              message: 'a planner returns events; the controller calls the engine (DEV-397).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'crypto', 'fetch', 'process', 'globalThis', 'window', 'document',
          'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'requestAnimationFrame',
        ].map((name) => ({
          name,
          message: 'a planner is deterministic: no wall clock, no timers, no ambient globals (DEV-397).',
        })),
        ...GLOBAL_RESTRICTED_GLOBALS,
      ],
      'no-restricted-syntax': ['error', ...GLOBAL_RESTRICTED_SYNTAX, ...AUDIO_RANDOM_BAN_SYNTAX],
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/architecture/playbackPlannerPurity.test.ts`
Expected: PASS (6 tests).

Run: `bun run eslint`
Expected: clean — `padPlan.ts` from Task 1 imports only `@/types`, `@/utils/*` and `../padPlayback`
and reaches no banned global.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js src/architecture/playbackPlannerPurity.test.ts
git commit -m "chore(eslint): ban the store, the engine and ambient globals in src/audio/playback/plan"
```

---

## Task 3: Build the pad snapshot from the store, and route the live pad arm through the planner

**Files:**
- Create: `src/store/playbackPlanSnapshots.ts`
- Create: `src/store/playbackPlanSnapshots.test.ts`
- Modify: `src/components/loop/chord/useChordPlayback.ts` (`armPad` at l.176 and its call site at
  l.845)

**Interfaces:**
- Consumes: `PadPlanSnapshot`, `planPadArm` (Task 1); `AppStore` from `@/store/types`;
  `getMeter` from `@/utils/meter`.
- Produces: `padPlanSnapshot(s: AppStore): PadPlanSnapshot` — the store-layer builder every live
  controller uses. It takes the state as an ARGUMENT and never calls `useAppStore.getState()`
  itself, so the zustand singleton stays inside the controller.

- [ ] **Step 1: Write the failing test**

Create `src/store/playbackPlanSnapshots.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { padPlanSnapshot } from './playbackPlanSnapshots';
import type { AppStore } from './types';
import type { ChordItem } from '@/types';

const CHORDS: ChordItem[] = [{ id: 'c1', root: 'C', quality: 'maj', bars: 2 }];

/**
 * A partial store cast to AppStore: the builder reads a fixed, named set of
 * fields, and pinning that set is the whole point — a snapshot that quietly
 * grew a field would otherwise be invisible here.
 */
const STATE = {
  padMode: 'drone',
  chords: CHORDS,
  padDroneDegree: 2,
  padDroneIntervals: [1, 5, 8],
  padOctave: 4,
  padVoicing: 'open5',
  scaleRoot: 'D',
  scaleType: 'minor',
  bpm: 96,
  meterId: '12/8',
} as unknown as AppStore;

describe('padPlanSnapshot', () => {
  test('names every pad field the planner reads, and resolves the meter to stepsPerBar', () => {
    expect(padPlanSnapshot(STATE)).toEqual({
      mode: 'drone',
      chords: CHORDS,
      degree: 2,
      intervals: [1, 5, 8],
      padOctave: 4,
      voicing: 'open5',
      scaleRoot: 'D',
      scaleType: 'minor',
      bpm: 96,
      stepsPerBar: 24, // 12/8
    });
  });

  test('carries no synth patch: the patch is the controller\'s, read when it triggers', () => {
    expect(Object.keys(padPlanSnapshot(STATE))).not.toContain('padSynthParams');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/playbackPlanSnapshots.test.ts`
Expected: FAIL — `Cannot find module './playbackPlanSnapshots'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/playbackPlanSnapshots.ts`:

```typescript
import type { PadPlanSnapshot } from '@/audio/playback/plan/padPlan';
import { getMeter } from '@/utils/meter';
import type { AppStore } from './types';

/**
 * The live half of DEV-397's planner seam: one builder per lane, turning app
 * state into the immutable snapshot that lane's planner reads.
 *
 * Every builder takes the state as an ARGUMENT. Nothing here calls
 * `useAppStore.getState()`, so the singleton stays in the controller that owns
 * the clock subscription and a planner can never acquire a store read by
 * importing a "convenience" wrapper. The offline renderer builds the same
 * shapes from its own snapshot (`src/audio/export/renderMixdown.ts`), which is
 * why live/offline equivalence is a deep-equality assertion on two snapshots.
 *
 * What is NOT here is as deliberate as what is: no synth patch, no arp
 * settings that a lane reads live, no feel. Those are EMIT-time reads passed to
 * the planner per step by the controller, which is what keeps a knob tweak
 * audible on the very next hit instead of on the next chord.
 */
export function padPlanSnapshot(s: AppStore): PadPlanSnapshot {
  return {
    mode: s.padMode,
    chords: s.chords,
    degree: s.padDroneDegree,
    intervals: s.padDroneIntervals,
    padOctave: s.padOctave,
    voicing: s.padVoicing,
    scaleRoot: s.scaleRoot,
    scaleType: s.scaleType,
    bpm: s.bpm,
    stepsPerBar: getMeter(s.meterId).stepsPerBar,
  };
}
```

Then in `src/components/loop/chord/useChordPlayback.ts`, replace the whole `armPad` function
(l.176-198) with:

```typescript
/**
 * Strikes the pad's voicing and schedules its release.
 *
 * The DECISION is `planPadArm`'s and is pure; this function is the controller
 * half — one store read, one engine call. The pad has no rhythm pattern, so one
 * arm is one note-on/note-off pair and there is no per-step emission: ChordPlan
 * and emitChordPlanStep stay untouched by it.
 */
function armPad(chordIndex: number, time: number): void {
  const s = useAppStore.getState();
  const arm = planPadArm(padPlanSnapshot(s), chordIndex);
  if (!arm) return;
  playFullHoldChord(arm.notes, s.padSynthParams, time, arm.holdSec, 'pad');
}
```

Update the import at l.52 and add the store-layer one:

```typescript
import { planPadArm } from "@/audio/playback/plan/padPlan";
import { padPlanSnapshot } from "@/store/playbackPlanSnapshots";
```

Delete the now-unused `padHoldsAcrossLoop`/`resolvePadArm` import (l.52) and the `loopBars` import
(l.53) — `tsc` and `eslint` flag both if anything else in the file still needs them.

Update the call site at l.845 from `armPad(chord, index === 0, time);` to:

```typescript
        armPad(index, time);
```

(`index` is already `arming.chordIndex % liveChords.length`, so `index === 0` — the old
`isLoopStart` argument — is exactly what `planPadArm` now derives.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/playbackPlanSnapshots.test.ts src/components/loop/chord/useChordPlayback.test.ts src/audio/playback/plan/padPlan.test.ts`
Expected: PASS.

Run: `bun run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/playbackPlanSnapshots.ts src/store/playbackPlanSnapshots.test.ts src/components/loop/chord/useChordPlayback.ts
git commit -m "refactor(playback): the live pad arm goes through the pad planner"
```

---

## Task 4: Route the offline pad arm through the same planner, and prove the two snapshots agree

**Files:**
- Modify: `src/audio/export/renderMixdown.ts` (the pad block at l.784-808)
- Modify: `src/audio/export/renderMixdown.test.ts`

**Interfaces:**
- Consumes: `PadPlanSnapshot`, `planPadArm` (Task 1); `padPlanSnapshot` (Task 3, in the test
  only — a test file is exempt from the import-layering bans, production code in `src/audio/` is
  not).
- Produces: `padSnapshotForLoop(loop: MixdownLoop, bpm: number, stepsPerBar: number): PadPlanSnapshot`,
  exported from `renderMixdown.ts` for the equivalence test and used by `scheduleArrangement`.

- [ ] **Step 1: Write the failing test**

Add to `src/audio/export/renderMixdown.test.ts` (and extend its import from `./renderMixdown` with
`padSnapshotForLoop`, and add `import { padPlanSnapshot } from '@/store/playbackPlanSnapshots';`
plus `import { planPadArm } from '../playback/plan/padPlan';` and
`import type { AppStore } from '@/store/types';`):

```typescript
describe('live and offline build the same pad snapshot', () => {
  const chords = [
    { id: 'c1', root: 'C', quality: 'maj' as const, bars: 2 },
    { id: 'c2', root: 'A', quality: 'min' as const, bars: 2 },
  ];
  const loop = mixdownLoop({
    chords,
    padMode: 'drone',
    padOctave: 4,
    padVoicing: 'triad',
    padDroneDegree: 1,
    padDroneIntervals: [1, 5, 8],
    scaleRoot: 'C',
    scaleType: 'major',
  });
  const state = {
    padMode: loop.padMode,
    chords: loop.chords,
    padDroneDegree: loop.padDroneDegree,
    padDroneIntervals: loop.padDroneIntervals,
    padOctave: loop.padOctave,
    padVoicing: loop.padVoicing,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    bpm: 120,
    meterId: '4/4',
  } as unknown as AppStore;

  test('the offline snapshot deep-equals the store snapshot', () => {
    expect(padSnapshotForLoop(loop, 120, 16)).toEqual(padPlanSnapshot(state));
  });

  test('and therefore both plan the same arm at every chord', () => {
    for (const index of [0, 1, 2]) {
      expect(planPadArm(padSnapshotForLoop(loop, 120, 16), index)).toEqual(
        planPadArm(padPlanSnapshot(state), index),
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/export/renderMixdown.test.ts`
Expected: FAIL — `padSnapshotForLoop` is not exported from `./renderMixdown`.

- [ ] **Step 3: Write the implementation**

In `src/audio/export/renderMixdown.ts`, replace the `resolvePadArm` import (l.39) with:

```typescript
import { planPadArm, type PadPlanSnapshot } from '../playback/plan/padPlan';
```

Add, next to the other per-loop builders (beside `resolveLoopCycles`):

```typescript
/**
 * The pad lane's snapshot for one loop — the offline twin of
 * `padPlanSnapshot` (src/store/playbackPlanSnapshots.ts). Both feed the same
 * `planPadArm`, so an export and a live session can only disagree about the pad
 * if these two builders disagree, which renderMixdown.test.ts pins directly.
 */
export function padSnapshotForLoop(
  loop: MixdownLoop,
  bpm: number,
  stepsPerBar: number,
): PadPlanSnapshot {
  return {
    mode: loop.padMode,
    chords: loop.chords,
    degree: loop.padDroneDegree,
    intervals: loop.padDroneIntervals,
    padOctave: loop.padOctave,
    voicing: loop.padVoicing,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    bpm,
    stepsPerBar,
  };
}
```

Replace the pad block inside `scheduleArrangement` (l.784-808) with:

```typescript
        // Pad, through the SAME planner the live hook arms with. `chordIndex`
        // carries what `isLoopStart` used to: the pad block only runs at
        // `stepsIntoChord === 0`, and chord 0 starts at step 0 of the pass, so
        // `chordIndex === 0` there is exactly the old `stepInPass === 0`.
        if (stepsIntoChord === 0) {
          const arm = planPadArm(padSnapshot, chordIndex);
          if (arm) {
            playFullHoldChord(arm.notes, loop.padSynthParams, time, arm.holdSec, 'pad', engine);
          }
        }
```

and hoist the snapshot once per pass, beside `leadTrack`/`fxTrack` (l.712-713):

```typescript
    const padSnapshot = padSnapshotForLoop(loop, snapshot.bpm, stepsPerBar);
```

`isLoopStart` (l.724) is now unused unless something else in the walk reads it — delete the
binding if `tsc` flags it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/export/renderMixdown.test.ts`
Expected: PASS, including the pre-existing render suites (the pad's notes and holds are unchanged:
`loopBars(chords)` and `passSteps / stepsPerBar` are the same number for any loop with at least one
chord, and the pad block never runs for a chordless loop).

- [ ] **Step 5: Commit**

```bash
git add src/audio/export/renderMixdown.ts src/audio/export/renderMixdown.test.ts
git commit -m "refactor(playback): the offline pad arm goes through the pad planner"
```

---

## Task 5: The pure chord-lane planner

**Files:**
- Create: `src/audio/playback/plan/chordPlan.ts`
- Create: `src/audio/playback/plan/chordPlan.test.ts`

**Interfaces:**
- Consumes: `resolvePlaybackRhythmCycle`, `cycleHoldScale`, `fullHoldDuration`,
  `isFullHoldRhythmCycle` from `@/audio/chordRhythms`; `buildChordEvents` and `BarInvariantEvent`
  from `../chordPlayback`; `barDurationSec`, `stepDurationSec` from `@/utils/musicTheory`.
- Produces: `ChordPlanSnapshot` (exported — Task 9's store builder and Task 10's renderer build
  it) and `planChordLane(snapshot, chordNotes, totalBars)` returning
  `{ cycleSteps: number; events: BarInvariantEvent[]; fullHold: { notes: string[]; holdSec: number } | null }`.
  The full-hold DESCRIPTOR replacing today's inline `playFullHoldChord` call is the whole point of
  this task.

- [ ] **Step 1: Write the failing test**

Create `src/audio/playback/plan/chordPlan.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { planChordLane, type ChordPlanSnapshot } from './chordPlan';
import { buildChordEvents } from '../chordPlayback';
import { resolvePlaybackRhythmCycle } from '@/audio/chordRhythms';
import { generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';

const CHORDS: ChordItem[] = [
  { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
];
/** Two two-bar chords at 16 steps/bar. */
const DURATIONS = [32, 32];
const NOTES = generateBlockChordNotes('maj', 'C', 4);

function snapshot(over: Partial<ChordPlanSnapshot> = {}): ChordPlanSnapshot {
  return {
    chords: CHORDS,
    bpm: 120,
    meterId: '4/4',
    stepsPerBar: 16,
    chordOctave: 4,
    bassOctave: 2,
    scaleRoot: 'C',
    scaleType: 'major',
    chordRhythmMode: 'preset',
    chordRhythmId: 'fourOnFloor',
    customChordRhythm: [],
    customChordHoldSteps: [],
    customChordLoopLength: 1,
    chordFeel: 0.5,
    bassPatternMode: 'preset',
    bassPatternId: 'classic-walk',
    customBassPattern: [],
    customBassHoldSteps: [],
    customBassLoopLength: 1,
    bassFeel: 0.5,
    chordArpActive: false,
    bassArpActive: false,
    ...over,
  };
}

describe('planChordLane', () => {
  test('a per-step preset returns the events buildChordEvents builds, and no full hold', () => {
    const cycle = resolvePlaybackRhythmCycle('preset', 'fourOnFloor', [], [], 1, 16, '4/4', DURATIONS);
    const lane = planChordLane(snapshot(), NOTES, 2);
    expect(lane.fullHold).toBeNull();
    expect(lane.cycleSteps).toBe(cycle.cycleSteps);
    // chordFeel 0.5 -> feelToHoldScale(0.5) === 1, and a preset cycle is not custom.
    expect(lane.events).toEqual(buildChordEvents(cycle.pattern, NOTES, stepDurationSec(120), 1));
  });

  test('a full-hold PRESET returns a descriptor instead of scheduling anything', () => {
    const lane = planChordLane(snapshot({ chordRhythmId: 'sustained' }), NOTES, 2);
    expect(lane.events).toEqual([]);
    // 2 bars x 2 s at 120 bpm / 16 spb, hold scale 1.
    expect(lane.fullHold).toEqual({ notes: NOTES, holdSec: 4 });
  });

  test('an active arp replaces the lane: no cycle is resolved and no event is built', () => {
    const lane = planChordLane(snapshot({ chordArpActive: true, chordRhythmId: 'sustained' }), NOTES, 2);
    expect(lane).toEqual({ cycleSteps: 16, events: [], fullHold: null });
  });

  test('the lane is a plain function of its inputs: two calls agree', () => {
    expect(planChordLane(snapshot(), NOTES, 2)).toEqual(planChordLane(snapshot(), NOTES, 2));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: FAIL — `Cannot find module './chordPlan'`.

- [ ] **Step 3: Write the implementation**

Create `src/audio/playback/plan/chordPlan.ts`:

```typescript
import type { BassStepChoice } from '@/data/bassPatterns';
import type { ChordItem } from '@/types';
import type { MeterId } from '@/utils/meter';
import { barDurationSec, stepDurationSec } from '@/utils/musicTheory';
import {
  cycleHoldScale,
  fullHoldDuration,
  isFullHoldRhythmCycle,
  resolvePlaybackRhythmCycle,
} from '@/audio/chordRhythms';
import { buildChordEvents, type BarInvariantEvent } from '../chordPlayback';

/**
 * Everything the chord and bass lanes read when a chord is ARMED.
 *
 * Arm-time, and only arm-time. The synth patches, the two Arp SETTINGS objects
 * and both feel values are read LIVE by the controller on every step and handed
 * to `planChordStep` instead — that split is what makes a knob tweak audible on
 * the very next hit rather than on the next chord, and folding them in here
 * would silently take that away. What IS captured is the arp's ACTIVE flag:
 * flipping Arp mid-chord must not stack an arpeggio on top of a chord already
 * sounding, so the pattern/arp choice is fixed for the plan's whole life.
 *
 * One snapshot serves both lanes because they are armed together, from one read
 * of the loop state — but their CYCLES stay independent (a two-bar chord cycle
 * under a three-bar bass cycle is normal), which is why each lane resolves and
 * carries its own `cycleSteps`.
 */
export interface ChordPlanSnapshot {
  chords: readonly ChordItem[];
  bpm: number;
  meterId: MeterId;
  stepsPerBar: number;
  chordOctave: number;
  bassOctave: number;
  scaleRoot: string;
  scaleType: string;
  chordRhythmMode: 'preset' | 'custom';
  chordRhythmId: string;
  customChordRhythm: boolean[];
  customChordHoldSteps: number[];
  customChordLoopLength: number;
  chordFeel: number;
  bassPatternMode: 'preset' | 'custom';
  bassPatternId: string;
  customBassPattern: BassStepChoice[];
  customBassHoldSteps: number[];
  customBassLoopLength: number;
  bassFeel: number;
  chordArpActive: boolean;
  bassArpActive: boolean;
}

/**
 * The progression's durations in ACTIVE-meter columns — what a custom lane
 * folds its chord boundaries onto.
 *
 * Floored at one bar per chord. The live hook used `c.bars * stepsPerBar` and
 * the renderer `Math.max(1, c.bars || 1) * stepsPerBar`; one planner cannot
 * have both, and the floored form is the one that agrees with `totalBars`
 * (`chord.bars || 1`) everywhere else — a `bars: 0` chord would otherwise fold
 * a zero-width boundary the rest of the code says is one bar wide.
 */
function chordDurations(snapshot: ChordPlanSnapshot): number[] {
  return snapshot.chords.map((c) => Math.max(1, c.bars || 1) * snapshot.stepsPerBar);
}

/** One armed lane: the cycle it repeats over, its events, and its full hold if it has one. */
interface ChordLanePlan {
  cycleSteps: number;
  events: BarInvariantEvent[];
  /**
   * A PRESET full-hold lane: strike these notes once, at the chord's first
   * step, and hold them this long. A descriptor rather than an engine call,
   * because a function that touches the engine cannot be called by a test with
   * no engine — and cannot be shared with the offline renderer either.
   */
  fullHold: { notes: string[]; holdSec: number } | null;
}

/**
 * The chord lane of a plan.
 *
 * An active arp replaces the lane outright: no cycle is resolved, and the
 * reported width is the one bar the arp's stride is measured against. A
 * full-hold cycle is PRESET-only (`isFullHoldRhythmCycle`), so a custom span
 * covering its whole cycle stays a span — it strikes, releases at the seam and
 * strikes again, which is the length the user drew.
 */
export function planChordLane(
  snapshot: ChordPlanSnapshot,
  chordNotes: string[],
  totalBars: number,
): ChordLanePlan {
  if (snapshot.chordArpActive) {
    return { cycleSteps: snapshot.stepsPerBar, events: [], fullHold: null };
  }
  const cycle = resolvePlaybackRhythmCycle(
    snapshot.chordRhythmMode,
    snapshot.chordRhythmId,
    snapshot.customChordRhythm,
    snapshot.customChordHoldSteps,
    snapshot.customChordLoopLength,
    snapshot.stepsPerBar,
    snapshot.meterId,
    chordDurations(snapshot),
  );
  // Feel may only TIGHTEN a span the user drew, so the cycle's own custom flag
  // picks the scale; a preset keeps the whole loose range.
  const holdScale = cycleHoldScale(cycle.custom, snapshot.chordFeel);
  if (isFullHoldRhythmCycle(cycle)) {
    return {
      cycleSteps: cycle.cycleSteps,
      events: [],
      fullHold: {
        notes: chordNotes,
        holdSec: fullHoldDuration(
          totalBars,
          barDurationSec(snapshot.bpm, snapshot.stepsPerBar),
          holdScale,
        ),
      },
    };
  }
  return {
    cycleSteps: cycle.cycleSteps,
    events: buildChordEvents(cycle.pattern, chordNotes, stepDurationSec(snapshot.bpm), holdScale),
    fullHold: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/plan/chordPlan.ts src/audio/playback/plan/chordPlan.test.ts
git commit -m "refactor(playback): add the pure chord-lane planner"
```

---

## Task 6: The pure bass-lane planner

**Files:**
- Modify: `src/audio/playback/plan/chordPlan.ts`
- Modify: `src/audio/playback/plan/chordPlan.test.ts`

**Interfaces:**
- Consumes: `resolvePlaybackBassCycle`, `isFullHoldBassCycle` from `@/audio/chordRhythms`;
  `resolveBassSteps(pattern, chords, chordIndex, octave, scaleRoot, scaleType, bpm, holdScale)`
  and `isApproachToken` from `@/audio/bassPatterns`; `ChordPlanSnapshot` (Task 5).
- Produces: `planBassLane(snapshot, chordIndex, totalBars)` returning
  `{ cycleSteps: number; events: BarInvariantEvent[]; fullHold: { noteName: string; velocity: number; holdSec: number } | null }`.
  The full hold is a single note (bass is monophonic), not a chord — a different descriptor from
  the chord lane's on purpose.

- [ ] **Step 1: Write the failing test**

Add to `src/audio/playback/plan/chordPlan.test.ts` (extend the import from `./chordPlan` with
`planBassLane`, and add `import { isApproachToken, resolveBassSteps } from '@/audio/bassPatterns';`
and `import { resolvePlaybackBassCycle } from '@/audio/chordRhythms';`):

```typescript
describe('planBassLane', () => {
  test('a per-step preset wraps resolveBassSteps, flagging approach tones as last-bar-only', () => {
    const cycle = resolvePlaybackBassCycle('preset', 'classic-walk', [], [], 1, 16, '4/4', DURATIONS);
    const lane = planBassLane(snapshot(), 0, 2);
    const expected = resolveBassSteps(cycle.pattern, CHORDS, 0, 2, 'C', 'major', 120, 1).map((ev) => ({
      step: ev.step,
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: 0,
      hold: ev.holdSec,
      lastBarOnly: isApproachToken(ev.token),
    }));
    expect(lane.fullHold).toBeNull();
    expect(lane.cycleSteps).toBe(cycle.cycleSteps);
    expect(lane.events).toEqual(expected);
  });

  test('a full-hold PRESET returns one note and a hold, and no events', () => {
    const lane = planBassLane(snapshot({ bassPatternId: 'whole-note-root' }), 0, 2);
    expect(lane.events).toEqual([]);
    // The ROOT is resolved at hold scale 1; only the DURATION carries the feel.
    const cycle = resolvePlaybackBassCycle('preset', 'whole-note-root', [], [], 1, 16, '4/4', DURATIONS);
    const root = resolveBassSteps(cycle.pattern, CHORDS, 0, 2, 'C', 'major', 120, 1)[0];
    expect(lane.fullHold).toEqual({
      noteName: root.noteName,
      velocity: root.velocity,
      holdSec: 4,
    });
  });

  test('an active bass arp replaces the lane', () => {
    expect(planBassLane(snapshot({ bassArpActive: true, bassPatternId: 'whole-note-root' }), 0, 2)).toEqual({
      cycleSteps: 16,
      events: [],
      fullHold: null,
    });
  });

  test('the second chord resolves its OWN approach tones, so the index is load-bearing', () => {
    const first = planBassLane(snapshot(), 0, 2).events.map((e) => e.noteName);
    const second = planBassLane(snapshot(), 1, 2).events.map((e) => e.noteName);
    expect(second).not.toEqual(first);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: FAIL — `planBassLane` is not exported from `./chordPlan`.

- [ ] **Step 3: Write the implementation**

Add to `src/audio/playback/plan/chordPlan.ts` (extending its imports):

```typescript
import { isFullHoldBassCycle, resolvePlaybackBassCycle } from '@/audio/chordRhythms';
import { isApproachToken, resolveBassSteps } from '@/audio/bassPatterns';
```

```typescript
/** The bass lane's twin of ChordLanePlan. Bass is monophonic: one held note, not a voicing. */
interface BassLanePlan {
  cycleSteps: number;
  events: BarInvariantEvent[];
  fullHold: { noteName: string; velocity: number; holdSec: number } | null;
}

/**
 * The bass lane of a plan, over its own cycle, hold scale and tone resolution.
 *
 * The chord INDEX matters, not the chord object: `resolveBassSteps` walks
 * `chords[(i + 1) % length]` for its approach tones, which is what makes the
 * last chord lead back into the first at the loop seam.
 *
 * A full hold resolves its root at hold scale 1 and carries the feel in the
 * DURATION only, so the note-off and the hold it is paired with are measured
 * the same way.
 */
export function planBassLane(
  snapshot: ChordPlanSnapshot,
  chordIndex: number,
  totalBars: number,
): BassLanePlan {
  if (snapshot.bassArpActive) {
    return { cycleSteps: snapshot.stepsPerBar, events: [], fullHold: null };
  }
  const cycle = resolvePlaybackBassCycle(
    snapshot.bassPatternMode,
    snapshot.bassPatternId,
    snapshot.customBassPattern,
    snapshot.customBassHoldSteps,
    snapshot.customBassLoopLength,
    snapshot.stepsPerBar,
    snapshot.meterId,
    chordDurations(snapshot),
  );
  const stepsAtHold = (holdScale: number) =>
    resolveBassSteps(
      cycle.pattern,
      snapshot.chords,
      chordIndex,
      snapshot.bassOctave,
      snapshot.scaleRoot,
      snapshot.scaleType,
      snapshot.bpm,
      holdScale,
    );
  const holdSec = () =>
    fullHoldDuration(
      totalBars,
      barDurationSec(snapshot.bpm, snapshot.stepsPerBar),
      cycleHoldScale(cycle.custom, snapshot.bassFeel),
    );

  if (isFullHoldBassCycle(cycle)) {
    const root = stepsAtHold(1)[0];
    return {
      cycleSteps: cycle.cycleSteps,
      events: [],
      fullHold: root
        ? { noteName: root.noteName, velocity: root.velocity, holdSec: holdSec() }
        : null,
    };
  }
  return {
    cycleSteps: cycle.cycleSteps,
    events: stepsAtHold(cycleHoldScale(cycle.custom, snapshot.bassFeel)).map((ev) => ({
      step: ev.step,
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: 0,
      hold: ev.holdSec,
      // Approach tones lead into the NEXT chord, so they belong to the last bar.
      lastBarOnly: isApproachToken(ev.token),
    })),
    fullHold: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/plan/chordPlan.ts src/audio/playback/plan/chordPlan.test.ts
git commit -m "refactor(playback): add the pure bass-lane planner"
```

---

## Task 7: `planChordArm` — the pure replacement for `startChordPlan`'s decision half

**Files:**
- Modify: `src/audio/playback/plan/chordPlan.ts`
- Modify: `src/audio/playback/plan/chordPlan.test.ts`

**Interfaces:**
- Consumes: `planChordLane` (Task 5), `planBassLane` (Task 6); `generateBlockChordNotes(quality,
  root, octave)` from `@/utils/musicTheory`.
- Produces: `ArmedChordPlan` (exported — the live controller's ref type and the renderer's
  per-chord array element) and
  `planChordArm(snapshot: ChordPlanSnapshot, chordIndex: number, startProgressionStep: number): ArmedChordPlan`.
  `ArmedChordPlan` is today's `ChordPlan` (useChordPlayback l.136) plus `chordFullHold` and
  `bassFullHold`.

- [ ] **Step 1: Write the failing test**

Add to `src/audio/playback/plan/chordPlan.test.ts` (extend the `./chordPlan` import with
`planChordArm`):

```typescript
describe('planChordArm', () => {
  test('carries both lanes, both note sets and both cycle widths off ONE snapshot', () => {
    const snap = snapshot();
    const plan = planChordArm(snap, 1, 32);
    expect(plan.startProgressionStep).toBe(32);
    expect(plan.totalBars).toBe(2);
    expect(plan.chordNotes).toEqual(generateBlockChordNotes('maj', 'F', 4));
    expect(plan.bassNotes).toEqual(generateBlockChordNotes('maj', 'F', 2));
    expect(plan.chordArp).toBe(false);
    expect(plan.bassArp).toBe(false);
    expect(plan.chordEvents).toEqual(planChordLane(snap, plan.chordNotes, 2).events);
    expect(plan.bassEvents).toEqual(planBassLane(snap, 1, 2).events);
    expect(plan.chordCycleSteps).toBe(planChordLane(snap, plan.chordNotes, 2).cycleSteps);
    expect(plan.bassCycleSteps).toBe(planBassLane(snap, 1, 2).cycleSteps);
  });

  test('a full-hold pair arrives as two descriptors, and nothing is scheduled', () => {
    const plan = planChordArm(
      snapshot({ chordRhythmId: 'sustained', bassPatternId: 'whole-note-root' }),
      0,
      0,
    );
    expect(plan.chordFullHold).toEqual({ notes: plan.chordNotes, holdSec: 4 });
    expect(plan.bassFullHold?.holdSec).toBe(4);
    expect(plan.chordEvents).toEqual([]);
    expect(plan.bassEvents).toEqual([]);
  });

  test('a malformed bars: 0 chord is one bar, in the plan AND in the folded boundaries', () => {
    const malformed = snapshot({
      chords: [
        { id: 'c1', root: 'C', quality: 'maj', bars: 0 },
        { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
      ],
    });
    // The live hook floored totalBars but NOT the durations it folded custom
    // boundaries onto; the renderer floored both. One planner, one answer.
    expect(planChordArm(malformed, 0, 0).totalBars).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: FAIL — `planChordArm` is not exported from `./chordPlan`.

- [ ] **Step 3: Write the implementation**

Add to `src/audio/playback/plan/chordPlan.ts` (extending its `@/utils/musicTheory` import with
`generateBlockChordNotes`):

```typescript
/**
 * A chord's playback shape, resolved once when the chord is armed and then
 * emitted one clock step at a time by the controller.
 *
 * Holding the events here rather than pushing them onto the audio clock upfront
 * is what keeps nothing scheduled further ahead than the clock's own lookahead
 * — which is what lets a knob tweak reach the next hit rather than the next
 * chord.
 *
 * The two `*FullHold` fields are the plan's only INSTRUCTIONS rather than
 * events: strike them once at the chord's first step. They exist because a
 * full-hold lane is a single long voice the patch can re-shape live, so it
 * needs no per-step work — and because the resolver that decides it must stay
 * callable from a test with no engine.
 */
export interface ArmedChordPlan {
  /**
   * The progression step this chord was armed on — measured from the run's
   * origin, so `chordPlanPosition` needs no second origin. Plans tile a run:
   * each is armed exactly one chord after the last.
   */
  startProgressionStep: number;
  totalBars: number;
  chordNotes: string[];
  bassNotes: string[];
  chordArp: boolean;
  bassArp: boolean;
  chordEvents: BarInvariantEvent[];
  bassEvents: BarInvariantEvent[];
  /**
   * The two lanes' cycle widths in 16th columns, resolved when the plan was
   * armed and carried for its whole life. A clock tick must never resolve one:
   * a mid-chord resize would re-phase a pattern that is already sounding.
   */
  chordCycleSteps: number;
  bassCycleSteps: number;
  chordFullHold: { notes: string[]; holdSec: number } | null;
  bassFullHold: { noteName: string; velocity: number; holdSec: number } | null;
}

/**
 * Arms the chord at `chordIndex`: its notes, both lanes' events and both lanes'
 * full holds, from ONE snapshot of the loop state.
 *
 * Pure. The controller does the two things this cannot: it fires the full holds
 * on the engine, and it keeps the arming state `startProgressionStep` is
 * measured from.
 */
export function planChordArm(
  snapshot: ChordPlanSnapshot,
  chordIndex: number,
  startProgressionStep: number,
): ArmedChordPlan {
  const chord = snapshot.chords[chordIndex];
  const totalBars = Math.max(1, chord.bars || 1);
  const chordNotes = generateBlockChordNotes(chord.quality, chord.root, snapshot.chordOctave);
  const bassNotes = generateBlockChordNotes(chord.quality, chord.root, snapshot.bassOctave);
  const chordLane = planChordLane(snapshot, chordNotes, totalBars);
  const bassLane = planBassLane(snapshot, chordIndex, totalBars);

  return {
    startProgressionStep,
    totalBars,
    chordNotes,
    bassNotes,
    // Off the Arp fields, never off the patch: Arp is performance state, so a
    // preset load must not re-arm the arpeggiator.
    chordArp: snapshot.chordArpActive,
    bassArp: snapshot.bassArpActive,
    chordEvents: chordLane.events,
    bassEvents: bassLane.events,
    chordCycleSteps: chordLane.cycleSteps,
    bassCycleSteps: bassLane.cycleSteps,
    chordFullHold: chordLane.fullHold,
    bassFullHold: bassLane.fullHold,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/plan/chordPlan.ts src/audio/playback/plan/chordPlan.test.ts
git commit -m "refactor(playback): add planChordArm, the pure chord+bass arm"
```

---

## Task 8: `planChordStep` — the pure emit-phase decision

**Files:**
- Modify: `src/audio/playback/plan/chordPlan.ts`
- Modify: `src/audio/playback/plan/chordPlan.test.ts`

**Interfaces:**
- Consumes: `ArmedChordPlan` (Task 7); `arpEventsForStep`, `eventsForCycleStep` and `StepEvent`
  from `../chordPlayback`; `feelToHoldScale` from `@/audio/chordRhythms`.
- Produces:
  `planChordStep(plan: ArmedChordPlan, ctx: { progressionStep: number; step: number; isLastBar: boolean; stepsPerBar: number; stepDurSec: number; chordArp: ArpSettings; bassArp: ArpSettings; chordFeel: number; bassFeel: number }): { chord: StepEvent[]; bass: StepEvent[] }`.
  The context is the EMIT-time half of the seam: everything in it is read live by the controller
  on the step it is called for. The `ctx` type stays inline (callers pass object literals) so no
  type is exported without a production importer.

- [ ] **Step 1: Write the failing test**

Add to `src/audio/playback/plan/chordPlan.test.ts` (extend the `./chordPlan` import with
`planChordStep`, and add `import { arpEventsForStep, eventsForCycleStep } from '../chordPlayback';`
and `import { TRACK_ARP_DEFAULTS } from '@/store/initialState';`):

```typescript
describe('planChordStep', () => {
  const ARP_OFF = { ...TRACK_ARP_DEFAULTS, active: false };
  const ARP_ON = { ...TRACK_ARP_DEFAULTS, active: true };

  function ctx(over: Record<string, unknown> = {}) {
    return {
      progressionStep: 0,
      step: 0,
      isLastBar: true,
      stepsPerBar: 16,
      stepDurSec: stepDurationSec(120),
      chordArp: ARP_OFF,
      bassArp: ARP_OFF,
      chordFeel: 0.5,
      bassFeel: 0.5,
      ...over,
    };
  }

  test('folds each lane onto its OWN cycle width, from one progression-relative step', () => {
    const plan = planChordArm(snapshot(), 0, 0);
    for (const step of [0, 4, 15, 16, 20, 31]) {
      const events = planChordStep(plan, ctx({ progressionStep: step, step }));
      expect(events.chord, `chord ${step}`).toEqual(
        eventsForCycleStep(plan.chordEvents, step, plan.chordCycleSteps, true),
      );
      expect(events.bass, `bass ${step}`).toEqual(
        eventsForCycleStep(plan.bassEvents, step, plan.bassCycleSteps, true),
      );
    }
  });

  test('withholds a last-bar-only approach tone until the chord\'s final bar', () => {
    const plan = planChordArm(snapshot(), 0, 0);
    const approach = plan.bassEvents.find((e) => e.lastBarOnly);
    if (!approach) return; // classic-walk without an approach token: nothing to prove
    expect(planChordStep(plan, ctx({ progressionStep: approach.step, step: approach.step, isLastBar: false })).bass)
      .toEqual([]);
    expect(planChordStep(plan, ctx({ progressionStep: approach.step, step: approach.step, isLastBar: true })).bass)
      .not.toEqual([]);
  });

  test('an armed arp lane reads the ABSOLUTE step and the LIVE feel, never the cycle', () => {
    const plan = planChordArm(snapshot({ chordArpActive: true }), 0, 0);
    const events = planChordStep(plan, ctx({ progressionStep: 3, step: 19, chordArp: ARP_ON, chordFeel: 0.9 }));
    expect(events.chord).toEqual(
      arpEventsForStep(plan.chordNotes, ARP_ON, 19, stepDurationSec(120), feelToHoldScale(0.9), 16),
    );
  });
});
```

Add `import { feelToHoldScale } from '@/audio/chordRhythms';` to the test file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: FAIL — `planChordStep` is not exported from `./chordPlan`.

- [ ] **Step 3: Write the implementation**

Add to `src/audio/playback/plan/chordPlan.ts` (extending its imports with `feelToHoldScale` from
`@/audio/chordRhythms`, `arpEventsForStep`, `eventsForCycleStep` and `type StepEvent` from
`../chordPlayback`, and `type ArpSettings` from `@/types/synth`):

```typescript
/**
 * The events this step's chord and bass lanes fire — the decision only. The
 * controller turns them into note-ons.
 *
 * The context is the EMIT-time half of the seam and every field in it is read
 * LIVE by the caller on this very step: the two Arp settings objects and the
 * two feel values. That is what makes a timbre or feel tweak audible on the
 * next hit instead of the next chord, and it is why they are arguments rather
 * than snapshot fields.
 *
 * `progressionStep` is folded onto each lane's OWN cycle width, so a two-bar
 * chord cycle and a three-bar bass cycle advance independently from one number.
 * Both folds are `eventsForCycleStep`'s — a second copy of the seam rule here
 * is exactly how a preview and the transport come to disagree about where a
 * cycle starts. `step` stays ABSOLUTE for the arp, which keeps its stride
 * across chords and bar lines rather than restarting on every one.
 *
 * The arp's hold scale is `feelToHoldScale`, NOT `cycleHoldScale`: "feel may
 * only tighten" is a rule about a span the USER DREW, and an arp has none. The
 * offline renderer used the clamped form and so held arp notes shorter than the
 * live player on a custom lane; Task 11 pins that they now agree.
 */
export function planChordStep(
  plan: ArmedChordPlan,
  ctx: {
    progressionStep: number;
    step: number;
    isLastBar: boolean;
    stepsPerBar: number;
    stepDurSec: number;
    chordArp: ArpSettings;
    bassArp: ArpSettings;
    chordFeel: number;
    bassFeel: number;
  },
): { chord: StepEvent[]; bass: StepEvent[] } {
  return {
    chord: plan.chordArp
      ? arpEventsForStep(
          plan.chordNotes,
          ctx.chordArp,
          ctx.step,
          ctx.stepDurSec,
          feelToHoldScale(ctx.chordFeel),
          ctx.stepsPerBar,
        )
      : eventsForCycleStep(plan.chordEvents, ctx.progressionStep, plan.chordCycleSteps, ctx.isLastBar),
    bass: plan.bassArp
      ? arpEventsForStep(
          plan.bassNotes,
          ctx.bassArp,
          ctx.step,
          ctx.stepDurSec,
          feelToHoldScale(ctx.bassFeel),
          ctx.stepsPerBar,
        )
      : eventsForCycleStep(plan.bassEvents, ctx.progressionStep, plan.bassCycleSteps, ctx.isLastBar),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/plan/chordPlan.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/plan/chordPlan.ts src/audio/playback/plan/chordPlan.test.ts
git commit -m "refactor(playback): add planChordStep, the pure emit-phase decision"
```

---

## Task 9: Route live chord/bass scheduling through the planners

**Files:**
- Modify: `src/store/playbackPlanSnapshots.ts`
- Modify: `src/store/playbackPlanSnapshots.test.ts`
- Modify: `src/components/loop/chord/useChordPlayback.ts` (delete `ChordPlan` l.136-163,
  `PlanLaneContext` l.207-216, `PlanLane` l.218-222, `resolveChordLane` l.230-262,
  `resolveBassLane` l.265-317; rewrite `startChordPlan` l.329-373 and `emitChordPlanStep`
  l.391-422; update the call site at l.844 and `ChordSchedulerRefs`' plan ref type)

**Interfaces:**
- Consumes: `planChordArm`, `planChordStep`, `ArmedChordPlan`, `ChordPlanSnapshot` (Tasks 5-8);
  `chordPlanPosition`, `emitStepEvents`, `playFullHoldChord` from
  `@/audio/playback/chordPlayback`; `playbackNoteOn`, `playbackNoteOff` from
  `@/audio/playback/playbackEngine`.
- Produces: `chordPlanSnapshot(s: AppStore): ChordPlanSnapshot` in the store layer. The
  controller's plan ref becomes `ArmedChordPlan | null`; the local `ChordPlan` type is gone.

- [ ] **Step 1: Write the failing test**

Add to `src/store/playbackPlanSnapshots.test.ts` (extending its imports with `chordPlanSnapshot`):

```typescript
describe('chordPlanSnapshot', () => {
  const STATE = {
    chords: CHORDS,
    bpm: 132,
    meterId: '3/4',
    chordOctave: 4,
    bassOctave: 2,
    scaleRoot: 'A',
    scaleType: 'minor',
    chordRhythmMode: 'custom',
    chordRhythmId: 'fourOnFloor',
    customChordRhythm: [true, false],
    customChordHoldSteps: [4, 0],
    customChordLoopLength: 2,
    chordFeel: 0.7,
    bassPatternMode: 'preset',
    bassPatternId: 'classic-walk',
    customBassPattern: [],
    customBassHoldSteps: [],
    customBassLoopLength: 1,
    bassFeel: 0.3,
    chordArpSettings: { active: true, mode: 'up', rate: '1/8', octaves: 2 },
    bassArpSettings: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
  } as unknown as AppStore;

  test('captures the ARM-time half only, with the arp reduced to its active flag', () => {
    const snap = chordPlanSnapshot(STATE);
    expect(snap.stepsPerBar).toBe(12); // 3/4
    expect(snap.chordArpActive).toBe(true);
    expect(snap.bassArpActive).toBe(false);
    expect(snap.chordFeel).toBe(0.7);
    expect(snap.bassFeel).toBe(0.3);
  });

  test('carries no synth patch and no arp SETTINGS object: those are read live per step', () => {
    const keys = Object.keys(chordPlanSnapshot(STATE));
    expect(keys).not.toContain('chordSynthParams');
    expect(keys).not.toContain('bassSynthParams');
    expect(keys).not.toContain('chordArpSettings');
    expect(keys).not.toContain('bassArpSettings');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/playbackPlanSnapshots.test.ts`
Expected: FAIL — `chordPlanSnapshot` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/store/playbackPlanSnapshots.ts`:

```typescript
import type { ChordPlanSnapshot } from '@/audio/playback/plan/chordPlan';
```

```typescript
/**
 * The chord+bass lanes' ARM-time snapshot. Both lanes are armed together off
 * one read of the loop state, so one snapshot serves both — but each lane
 * resolves its own cycle from it, because their widths are independent.
 *
 * Arp arrives as a boolean, not as the settings object: the arp/pattern CHOICE
 * is fixed when the chord is armed (flipping Arp mid-chord must not stack an
 * arpeggio on a chord already sounding), while the arp's mode, rate and octaves
 * are read live on every step and handed to `planChordStep`.
 */
export function chordPlanSnapshot(s: AppStore): ChordPlanSnapshot {
  return {
    chords: s.chords,
    bpm: s.bpm,
    meterId: s.meterId,
    stepsPerBar: getMeter(s.meterId).stepsPerBar,
    chordOctave: s.chordOctave,
    bassOctave: s.bassOctave,
    scaleRoot: s.scaleRoot,
    scaleType: s.scaleType,
    chordRhythmMode: s.chordRhythmMode,
    chordRhythmId: s.chordRhythmId,
    customChordRhythm: s.customChordRhythm,
    customChordHoldSteps: s.customChordHoldSteps,
    customChordLoopLength: s.customChordLoopLength,
    chordFeel: s.chordFeel,
    bassPatternMode: s.bassPatternMode,
    bassPatternId: s.bassPatternId,
    customBassPattern: s.customBassPattern,
    customBassHoldSteps: s.customBassHoldSteps,
    customBassLoopLength: s.customBassLoopLength,
    bassFeel: s.bassFeel,
    chordArpActive: s.chordArpSettings.active,
    bassArpActive: s.bassArpSettings.active,
  };
}
```

In `src/components/loop/chord/useChordPlayback.ts`:

1. Delete `ChordPlan` (l.136-163), `PlanLaneContext` (l.207-216), `PlanLane` (l.218-222),
   `resolveChordLane` (l.230-262) and `resolveBassLane` (l.265-317).
2. Replace `startChordPlan` (l.329-373) with:

```typescript
/**
 * Arms a chord: the pure plan, plus the one-shot voices of the full-hold
 * patterns.
 *
 * The DECISION is `planChordArm`'s — one read of the loop state per plan, with
 * neither lane's cycle re-read on a clock tick. What is left here is the
 * controller's half: the store read, the engine init, and firing the two full
 * holds (single long voices that `updateSynthPatch` can already re-shape live,
 * so they need no per-step work).
 */
function startChordPlan(
  chordIndex: number,
  startProgressionStep: number,
  time: number,
): ArmedChordPlan {
  initPlaybackEngine();
  const s = useAppStore.getState();
  const plan = planChordArm(chordPlanSnapshot(s), chordIndex, startProgressionStep);

  if (plan.chordFullHold) {
    playFullHoldChord(
      plan.chordFullHold.notes,
      s.chordSynthParams,
      time,
      plan.chordFullHold.holdSec,
      "chord",
    );
  }
  if (plan.bassFullHold) {
    const voiceId = playbackNoteOn(
      plan.bassFullHold.noteName,
      s.bassSynthParams,
      plan.bassFullHold.velocity,
      time,
      "bass",
    );
    playbackNoteOff(
      voiceId,
      synthReleaseSeconds(s.bassSynthParams),
      time + plan.bassFullHold.holdSec,
    );
  }
  return plan;
}
```

3. Replace `emitChordPlanStep` (l.391-422) with:

```typescript
/**
 * Fires the chord and bass voices that land on this clock step. The events are
 * `planChordStep`'s; the patches are read from the store at call time, so every
 * timbre knob is heard on the very next hit.
 */
function emitChordPlanStep(
  plan: ArmedChordPlan,
  progressionStep: number,
  pos: { isLastBar: boolean; stepsRemaining: number },
  step: number,
  time: number,
): void {
  const s = useAppStore.getState();
  const stepDur = stepDurationSec(s.bpm);
  const chordEnd = time + pos.stepsRemaining * stepDur;
  const events = planChordStep(plan, {
    progressionStep,
    step,
    isLastBar: pos.isLastBar,
    stepsPerBar: getMeter(s.meterId).stepsPerBar,
    stepDurSec: stepDur,
    chordArp: s.chordArpSettings,
    bassArp: s.bassArpSettings,
    chordFeel: s.chordFeel,
    bassFeel: s.bassFeel,
  });

  emitStepEvents(events.chord, s.chordSynthParams, "chord", time, chordEnd);
  emitStepEvents(events.bass, s.bassSynthParams, "bass", time, chordEnd);
}
```

4. Add the imports:

```typescript
import {
  planChordArm,
  planChordStep,
  type ArmedChordPlan,
} from "@/audio/playback/plan/chordPlan";
import { chordPlanSnapshot, padPlanSnapshot } from "@/store/playbackPlanSnapshots";
```

and delete the now-unused ones (`buildChordEvents`, `cycleHoldScale`, `fullHoldDuration`,
`isFullHoldBassCycle`, `isFullHoldRhythmCycle`, `resolvePlaybackBassCycle`,
`resolvePlaybackRhythmCycle`, `isApproachToken`, `resolveBassSteps`, `arpEventsForStep`,
`eventsForCycleStep`, `feelToHoldScale`, `AppStore`, `MeterId`, `BarInvariantEvent` …) — keep
whichever the preview hooks further down the file still use; `tsc` and `eslint` name every
leftover. `playFullHoldChord`, `scheduleWholeChord` and `buildChordEvents` in particular are still
needed by `useChordPatternPreview`/`useBassPatternPreview`.

5. Change the plan ref's type in `ChordSchedulerRefs` from `ChordPlan | null` to
   `ArmedChordPlan | null`, and the call site at l.844 to:

```typescript
        planRef.current = startChordPlan(index, progressionStep, time);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/playbackPlanSnapshots.test.ts src/components/loop/chord/useChordPlayback.test.ts src/audio/playback/plan/chordPlan.test.ts`
Expected: PASS. In particular `useChordPlayback.test.ts`'s source-scan test must still find
exactly two `playbackStopOwnedVoices(` calls.

Run: `bun run lint && bun run eslint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/playbackPlanSnapshots.ts src/store/playbackPlanSnapshots.test.ts src/components/loop/chord/useChordPlayback.ts
git commit -m "refactor(playback): live chord/bass scheduling goes through the planners"
```

---

## Task 10: Route offline chord/bass rendering through the same planners

**Files:**
- Modify: `src/audio/export/renderMixdown.ts` (`LoopVoices` l.~330-357, `renderChordEventsAt`
  l.370, `renderBassEventsAt` l.385, `resolveLoopCycles` l.409, `bassEventsForChord` l.450,
  `fullHoldBassNote` l.488, `buildLoopVoices` l.508, the chord/bass block of `scheduleArrangement`
  l.735-782)
- Modify: `src/audio/export/renderMixdown.test.ts` (the `buildLoopVoices` and "offline rendering
  consumes the resolved cycles" suites at l.128-341 read the old `LoopVoices` shape)

**Interfaces:**
- Consumes: `planChordArm`, `planChordStep`, `ArmedChordPlan`, `ChordPlanSnapshot` (Tasks 5-8).
- Produces: `chordSnapshotForLoop(loop: MixdownLoop, meterId: MeterId, bpm: number, stepsPerBar: number): ChordPlanSnapshot`
  (exported, for Task 11's equivalence test) and a reshaped
  `LoopVoices = { chordsByBar: number[]; chordStartStep: number[]; plans: ArmedChordPlan[] }`.
  `renderChordEventsAt`, `renderBassEventsAt`, `resolveLoopCycles`, `bassEventsForChord` and
  `fullHoldBassNote` are DELETED — the planner subsumes all five, and leaving an unused export
  behind fails `check:dead-code:production`.

- [ ] **Step 1: Write the failing test**

Rewrite the two suites in `src/audio/export/renderMixdown.test.ts` that read the old shape. In
`describe('buildLoopVoices')`, replace the per-chord array assertions with plan assertions:

```typescript
  test('maps every bar of a pass to the chord that covers it', () => {
    const loop = mixdownLoop({
      chords: [
        { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
        { id: 'c2', root: 'F', quality: 'maj', bars: 1 },
      ],
    });
    const voices = buildLoopVoices(loop, '4/4', 120, 16);
    expect(voices.chordsByBar).toEqual([0, 0, 1]);
    expect(voices.chordStartStep).toEqual([0, 32]);
    expect(voices.plans).toHaveLength(2);
    expect(voices.plans[1].startProgressionStep).toBe(32);
  });

  test('a full-hold rhythm produces no per-step events, only a hold', () => {
    const voices = buildLoopVoices(mixdownLoop({ chordRhythmId: 'sustained' }), '4/4', 120, 16);
    expect(voices.plans[0].chordEvents).toEqual([]);
    expect(voices.plans[0].chordFullHold?.holdSec).toBeGreaterThan(0);
  });

  test('a one-hit rhythm produces per-step events and no hold', () => {
    const voices = buildLoopVoices(mixdownLoop({ chordRhythmId: 'fourOnFloor' }), '4/4', 120, 16);
    expect(voices.plans[0].chordEvents.length).toBeGreaterThan(0);
    expect(voices.plans[0].chordFullHold).toBeNull();
  });
```

In `describe('offline rendering consumes the resolved cycles')`, replace every
`voices.chordCycleSteps` / `voices.bassCycleSteps` / `voices.chordEvents[i]` read with
`voices.plans[i].chordCycleSteps` / `voices.plans[i].bassCycleSteps` /
`voices.plans[i].chordEvents`, and replace the `renderChordEventsAt`/`renderBassEventsAt` calls in
the "render and live produce identical Chord/Bass events at every step" test with `planChordStep`:

```typescript
    const offline = (step: number) =>
      planChordStep(voices.plans[chordIndexAt(step)], {
        progressionStep: step,
        step,
        isLastBar: true,
        stepsPerBar: 16,
        stepDurSec: STEP_DUR,
        chordArp: loop.chordArpSettings,
        bassArp: loop.bassArpSettings,
        chordFeel: loop.chordFeel,
        bassFeel: loop.bassFeel,
      });

    for (const step of [0, 15, 16, 20, 31, 32, 47]) {
      expect(offline(step).chord, `chord ${step}`).toEqual(liveChord(step));
      expect(offline(step).bass, `bass ${step}`).toEqual(liveBass(step));
    }
```

(Keep the file's existing `liveChord`/`liveBass` helpers exactly as they are — they reconstruct the
events from the raw primitives, which is what makes this an independent check rather than a
tautology.) Update the `./renderMixdown` import to drop `renderBassEventsAt`/`renderChordEventsAt`
and add `chordSnapshotForLoop`; add `import { planChordStep } from '../playback/plan/chordPlan';`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/export/renderMixdown.test.ts`
Expected: FAIL — `voices.plans` is undefined and `chordSnapshotForLoop` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/audio/export/renderMixdown.ts`:

1. Replace the `LoopVoices` interface with:

```typescript
/**
 * One loop's chord/bass material, pre-resolved per chord: the SAME
 * `ArmedChordPlan` the live scheduler arms, one per chord, built once per pass
 * instead of on a clock tick.
 */
export interface LoopVoices {
  /** Pass bar -> the index of the chord covering it. */
  chordsByBar: number[];
  /** Per chord: the pass-relative step it starts on. */
  chordStartStep: number[];
  /** Per chord: its armed plan. */
  plans: ArmedChordPlan[];
}
```

2. Delete `renderChordEventsAt`, `renderBassEventsAt`, `resolveLoopCycles`, `bassEventsForChord`
   and `fullHoldBassNote` outright.

3. Add the snapshot builder beside `padSnapshotForLoop`:

```typescript
/**
 * The chord+bass ARM-time snapshot for one loop — the offline twin of
 * `chordPlanSnapshot` (src/store/playbackPlanSnapshots.ts).
 *
 * `src/audio/` may not reach into the store, so every field arrives on the
 * MixdownLoop; the names match the store's on purpose, so the two builders read
 * as the same list and an equivalence test is a deep-equality assertion.
 */
export function chordSnapshotForLoop(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): ChordPlanSnapshot {
  return {
    chords: loop.chords,
    bpm,
    meterId,
    stepsPerBar,
    chordOctave: loop.chordOctave,
    bassOctave: loop.bassOctave,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    chordRhythmMode: loop.chordRhythmMode,
    chordRhythmId: loop.chordRhythmId,
    customChordRhythm: loop.customChordRhythm,
    customChordHoldSteps: loop.customChordHoldSteps,
    customChordLoopLength: loop.customChordLoopLength,
    chordFeel: loop.chordFeel,
    bassPatternMode: loop.bassPatternMode,
    bassPatternId: loop.bassPatternId,
    customBassPattern: loop.customBassPattern,
    customBassHoldSteps: loop.customBassHoldSteps,
    customBassLoopLength: loop.customBassLoopLength,
    bassFeel: loop.bassFeel,
    chordArpActive: loop.chordArpSettings.active,
    bassArpActive: loop.bassArpSettings.active,
  };
}
```

4. Replace `buildLoopVoices` with:

```typescript
export function buildLoopVoices(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): LoopVoices {
  const snapshot = chordSnapshotForLoop(loop, meterId, bpm, stepsPerBar);
  const chordsByBar: number[] = [];
  const chordStartStep: number[] = [];
  const plans: ArmedChordPlan[] = [];

  let barCursor = 0;
  for (let i = 0; i < loop.chords.length; i += 1) {
    const bars = Math.max(1, loop.chords[i].bars || 1);
    const startStep = barCursor * stepsPerBar;
    chordStartStep.push(startStep);
    for (let b = 0; b < bars; b += 1) chordsByBar.push(i);
    barCursor += bars;
    // A pass restarts the progression, so a pass-relative step IS the
    // progression-relative step live playback measures from its run origin —
    // which is why the same `startProgressionStep` works for both.
    plans.push(planChordArm(snapshot, i, startStep));
  }
  return { chordsByBar, chordStartStep, plans };
}
```

5. Replace the chord/bass block of `scheduleArrangement` (l.735-782, everything between
   `if (!chordless) {` and the pad block) with:

```typescript
      if (!chordless) {
        const chordIndex = voices.chordsByBar[barInPass];
        const plan = voices.plans[chordIndex];
        const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
        const chordSteps = plan.totalBars * stepsPerBar;
        const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
        const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === plan.totalBars - 1;

        // The full holds arm once, on the chord's own first step. Both lanes
        // report empty events when they hold, so the per-step emit below is a
        // no-op for them rather than a branch.
        if (stepsIntoChord === 0 && plan.chordFullHold) {
          playFullHoldChord(
            plan.chordFullHold.notes,
            loop.chordSynthParams,
            time,
            plan.chordFullHold.holdSec,
            'chord',
            engine,
          );
        }
        if (stepsIntoChord === 0 && plan.bassFullHold) {
          const voiceId = engine.triggerSynthNoteOn(
            plan.bassFullHold.noteName, loop.bassSynthParams, plan.bassFullHold.velocity,
            time, 'bass', 1, 'sequencer',
          );
          if (voiceId) {
            engine.triggerSynthNoteOff(
              voiceId,
              synthReleaseSeconds(loop.bassSynthParams),
              time + plan.bassFullHold.holdSec,
            );
          }
        }

        // The SAME step decision the live scheduler makes, at the same
        // progression-relative step.
        const events = planChordStep(plan, {
          progressionStep: stepInPass,
          step,
          isLastBar,
          stepsPerBar,
          stepDurSec: stepDur,
          chordArp: loop.chordArpSettings,
          bassArp: loop.bassArpSettings,
          chordFeel: loop.chordFeel,
          bassFeel: loop.bassFeel,
        });
        emitStepEvents(events.chord, loop.chordSynthParams, 'chord', time, chordEnd, engine);
        emitStepEvents(events.bass, loop.bassSynthParams, 'bass', time, chordEnd, engine);
```

(keeping the pad block from Task 4 and the closing `}` that follows it).

6. Update imports: add `planChordArm`, `planChordStep`, `type ArmedChordPlan`,
   `type ChordPlanSnapshot` from `../playback/plan/chordPlan`; drop the now-unused
   `buildChordEvents`, `eventsForCycleStep`, `cycleHoldScale`, `fullHoldDuration`,
   `isFullHoldBassCycle`, `isFullHoldRhythmCycle`, `resolvePlaybackBassCycle`,
   `resolvePlaybackRhythmCycle`, `isApproachToken`, `resolveBassSteps`,
   `generateBlockChordNotes`, `barDurationSec`, `BarInvariantEvent`, `StepEvent`,
   `PlaybackPatternCycle`, `RhythmPattern`, `BassPattern` — whichever `tsc` reports as unused.
   `arpEventsForStep` and `emitStepEvents` stay (`emitStepEvents` is still called here;
   `arpEventsForStep` is now reached only through the planner, so drop it if `tsc` says so).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/export/renderMixdown.test.ts`
Expected: PASS, including the full `renderMixdown: the rendered buffer` and
`renderMixdown: determinism` suites — a byte-identical render is the strongest available check
that no scheduling number moved.

Run: `bun run lint && bun run check:dead-code:production`
Expected: clean (the five deleted helpers were the only unused-export risk).

- [ ] **Step 5: Commit**

```bash
git add src/audio/export/renderMixdown.ts src/audio/export/renderMixdown.test.ts
git commit -m "refactor(playback): offline chord/bass rendering goes through the planners"
```

---

## Task 11: Prove live/offline chord+bass equivalence, and land the arp hold-scale convergence

**Files:**
- Modify: `src/audio/export/renderMixdown.test.ts`

**Interfaces:**
- Consumes: `chordPlanSnapshot` (Task 9), `chordSnapshotForLoop` (Task 10), `planChordArm`,
  `planChordStep` (Tasks 7-8).
- Produces: nothing importable — the DoD's "live/offline equivalence tests cover representative
  meters, loop lengths, chord boundaries and approach tones".

- [ ] **Step 1: Write the failing test**

Add to `src/audio/export/renderMixdown.test.ts`:

```typescript
describe('live and offline chord+bass planning are the same computation', () => {
  const CHORDS = [
    { id: 'c1', root: 'C', quality: 'maj' as const, bars: 2 },
    { id: 'c2', root: 'A', quality: 'min' as const, bars: 1 },
    { id: 'c3', root: 'F', quality: 'maj' as const, bars: 1 },
  ];

  /** One loop and one store state built from the SAME values, lane config by lane config. */
  function pair(over: Partial<MixdownLoop>, meterId: MeterId, stepsPerBar: number) {
    const loop = mixdownLoop({ chords: CHORDS, ...over });
    const state = {
      chords: loop.chords,
      bpm: 120,
      meterId,
      chordOctave: loop.chordOctave,
      bassOctave: loop.bassOctave,
      scaleRoot: loop.scaleRoot,
      scaleType: loop.scaleType,
      chordRhythmMode: loop.chordRhythmMode,
      chordRhythmId: loop.chordRhythmId,
      customChordRhythm: loop.customChordRhythm,
      customChordHoldSteps: loop.customChordHoldSteps,
      customChordLoopLength: loop.customChordLoopLength,
      chordFeel: loop.chordFeel,
      bassPatternMode: loop.bassPatternMode,
      bassPatternId: loop.bassPatternId,
      customBassPattern: loop.customBassPattern,
      customBassHoldSteps: loop.customBassHoldSteps,
      customBassLoopLength: loop.customBassLoopLength,
      bassFeel: loop.bassFeel,
      chordArpSettings: loop.chordArpSettings,
      bassArpSettings: loop.bassArpSettings,
    } as unknown as AppStore;
    return {
      loop,
      live: chordPlanSnapshot(state),
      offline: chordSnapshotForLoop(loop, meterId, 120, stepsPerBar),
    };
  }

  const CASES: { name: string; over: Partial<MixdownLoop>; meterId: MeterId; spb: number }[] = [
    { name: '4/4 presets', over: {}, meterId: '4/4', spb: 16 },
    { name: '3/4 presets', over: {}, meterId: '3/4', spb: 12 },
    { name: '12/8 presets', over: {}, meterId: '12/8', spb: 24 },
    { name: '7/8 walking bass', over: { bassPatternId: 'classic-walk' }, meterId: '7/8', spb: 14 },
    {
      name: 'a two-bar custom chord lane under a one-bar bass preset',
      over: {
        chordRhythmMode: 'custom',
        customChordLoopLength: 2,
        bassPatternId: 'classic-walk',
      },
      meterId: '4/4',
      spb: 16,
    },
    {
      name: 'both lanes full hold',
      over: { chordRhythmId: 'sustained', bassPatternId: 'whole-note-root' },
      meterId: '4/4',
      spb: 16,
    },
  ];

  for (const { name, over, meterId, spb } of CASES) {
    test(`${name}: the two snapshots are identical`, () => {
      const { live, offline } = pair(over, meterId, spb);
      expect(offline).toEqual(live);
    });

    test(`${name}: every chord's plan and every step's events are identical`, () => {
      const { loop, live, offline } = pair(over, meterId, spb);
      let startStep = 0;
      for (let i = 0; i < CHORDS.length; i += 1) {
        const bars = Math.max(1, CHORDS[i].bars || 1);
        const livePlan = planChordArm(live, i, startStep);
        const offlinePlan = planChordArm(offline, i, startStep);
        expect(offlinePlan, `plan ${i}`).toEqual(livePlan);

        // Every step of the chord, so a chord boundary, a cycle seam and the
        // last bar (where approach tones fire) are all covered.
        for (let s = 0; s < bars * spb; s += 1) {
          const step = startStep + s;
          const isLastBar = Math.floor(s / spb) === bars - 1;
          const ctx = {
            progressionStep: step,
            step,
            isLastBar,
            stepsPerBar: spb,
            stepDurSec: stepDurationSec(120),
            chordArp: loop.chordArpSettings,
            bassArp: loop.bassArpSettings,
            chordFeel: loop.chordFeel,
            bassFeel: loop.bassFeel,
          };
          expect(planChordStep(offlinePlan, ctx), `step ${step}`).toEqual(
            planChordStep(livePlan, ctx),
          );
        }
        startStep += bars * spb;
      }
    });
  }

  test('an approach tone fires on the last bar of its chord and nowhere else', () => {
    const { live } = pair({ bassPatternMode: 'preset', bassPatternId: 'classic-walk' }, '4/4', 16);
    const plan = planChordArm(live, 0, 0);
    const approach = plan.bassEvents.filter((e) => e.lastBarOnly);
    expect(approach.length).toBeGreaterThan(0);
    for (const ev of approach) {
      const base = {
        progressionStep: ev.step,
        step: ev.step,
        stepsPerBar: 16,
        stepDurSec: stepDurationSec(120),
        chordArp: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
        bassArp: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
        chordFeel: 0.5,
        bassFeel: 0.5,
      } as Parameters<typeof planChordStep>[1];
      expect(planChordStep(plan, { ...base, isLastBar: false }).bass).toEqual([]);
      expect(planChordStep(plan, { ...base, isLastBar: true }).bass.length).toBeGreaterThan(0);
    }
  });

  test('an ARP over a CUSTOM lane holds the same length live and offline', () => {
    // The convergence this plan lands: the renderer used to scale arp holds by
    // cycleHoldScale, which clamps a CUSTOM lane to <= 1, while the live player
    // used feelToHoldScale unclamped. "Feel may only tighten" is a rule about a
    // span the USER DREW; an arp has none, so the live form wins.
    const { live, offline } = pair(
      {
        chordRhythmMode: 'custom',
        customChordLoopLength: 2,
        chordFeel: 0.9,
        chordArpSettings: { active: true, mode: 'up', rate: '1/8', octaves: 2 },
      },
      '4/4',
      16,
    );
    const ctx = {
      progressionStep: 0,
      step: 0,
      isLastBar: true,
      stepsPerBar: 16,
      stepDurSec: stepDurationSec(120),
      chordArp: { active: true, mode: 'up', rate: '1/8', octaves: 2 },
      bassArp: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
      chordFeel: 0.9,
      bassFeel: 0.5,
    } as Parameters<typeof planChordStep>[1];
    expect(planChordStep(planChordArm(offline, 0, 0), ctx).chord).toEqual(
      planChordStep(planChordArm(live, 0, 0), ctx).chord,
    );
  });
});
```

Add `import { chordPlanSnapshot } from '@/store/playbackPlanSnapshots';`,
`import { planChordArm, planChordStep } from '../playback/plan/chordPlan';`,
`import type { AppStore } from '@/store/types';` and `import type { MeterId } from '@/utils/meter';`
to the test file if Task 10 has not already added them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/export/renderMixdown.test.ts -t "the same computation"`
Expected: FAIL at first authoring if any snapshot field is spelled differently on the two sides —
that is exactly the class of bug this suite exists to catch. If both builders were written
correctly in Tasks 9-10, the suite passes on the first run; in that case state so explicitly
rather than weakening a test to force a red, and verify the suite is not vacuous by temporarily
changing one field in `chordSnapshotForLoop` (e.g. `bassOctave: loop.chordOctave`) and confirming
the suite goes red before reverting.

- [ ] **Step 3: Fix whatever the comparison reports**

Any inequality is a real divergence between the two builders (or a field one of them forgot).
Fix the BUILDER, never the assertion.

- [ ] **Step 4: Run the whole suite**

Run: `bun test src/audio/export/renderMixdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/export/renderMixdown.test.ts
git commit -m "test(playback): live/offline chord+bass equivalence across meters and boundaries"
```

---

## Task 12: The pure melody planner

**Files:**
- Create: `src/audio/playback/plan/melodyPlan.ts`
- Create: `src/audio/playback/plan/melodyPlan.test.ts`

**Interfaces:**
- Consumes: `leadScheduleHits(clockStep, stride, columns, arpActive, tickDurSec)`,
  `leadSoundingNotes(steps, columnInLoop, stepsPerBar, stride)`,
  `resolveLeadStepTriggers(sounding, arp, arpStep, tickDurSec, gate, stride, loop)` and
  `type LeadNote` from `@/audio/leadMelody`; `TICKS_PER_SIXTEENTH`, `columnsPerBar`, `strideFor`,
  `type LeadStepResolutionId` from `@/utils/stepResolution`; `arpStepFor` from `@/utils/meter`.
- Produces: `MelodyPlanSnapshot` (exported; Task 13's store builder and Task 14's
  `MixdownMelodyTrack` both are it) and
  `planMelodyStep(snapshot, stepInLoop, stepsPerBar, tickDurSec): { note: string; startOffsetSec: number; holdSec: number }[]`
  — one call replacing the three-call chain both call sites write out by hand today.

- [ ] **Step 1: Write the failing test**

Create `src/audio/playback/plan/melodyPlan.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { planMelodyStep, type MelodyPlanSnapshot } from './melodyPlan';
import {
  leadScheduleHits,
  leadSoundingNotes,
  resolveLeadStepTriggers,
  type LeadNote,
} from '@/audio/leadMelody';
import { LEAD_TICKS_PER_BAR, TICKS_PER_SIXTEENTH, strideFor } from '@/utils/stepResolution';
import { arpStepFor } from '@/utils/meter';
import { stepDurationSec } from '@/utils/musicTheory';

const ARP_OFF = { active: false, mode: 'up', rate: '1/8', octaves: 1 } as MelodyPlanSnapshot['arp'];
const TICK_DUR = stepDurationSec(120) / TICKS_PER_SIXTEENTH;

/** One stored bar with a quarter note at tick 0 and an eighth at tick 4. */
function bar(): LeadNote[][] {
  const rows: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
  rows[0] = [{ note: 'C4', len: 4 * TICKS_PER_SIXTEENTH }];
  rows[4] = [{ note: 'E4', len: 2 * TICKS_PER_SIXTEENTH }];
  return rows;
}

function snapshot(over: Partial<MelodyPlanSnapshot> = {}): MelodyPlanSnapshot {
  return { steps: bar(), loopLength: 1, stepResolution: '1/16', gate: 0.85, arp: ARP_OFF, ...over };
}

describe('planMelodyStep', () => {
  test('is exactly the three-function chain both call sites write by hand', () => {
    const snap = snapshot();
    const stride = strideFor(snap.stepResolution);
    for (const step of [0, 1, 4, 7, 15]) {
      const expected: { note: string; startOffsetSec: number; holdSec: number }[] = [];
      for (const hit of leadScheduleHits(step, stride, 16, false, TICK_DUR)) {
        const sounding = leadSoundingNotes(snap.steps, hit.column, 16, stride);
        for (const trigger of resolveLeadStepTriggers(
          sounding, snap.arp, arpStepFor(step, 16), TICK_DUR, snap.gate, stride,
          { tickInLoop: hit.column * stride, melodyTicks: 16 * TICKS_PER_SIXTEENTH },
        )) {
          expected.push({
            note: trigger.note,
            startOffsetSec: hit.offsetSec + trigger.timeOffsetSec,
            holdSec: trigger.holdSec,
          });
        }
      }
      expect(planMelodyStep(snap, step, 16, TICK_DUR), `step ${step}`).toEqual(expected);
    }
  });

  test('only a note that STARTS on this column fires, with the gate on its final cell', () => {
    const planned = planMelodyStep(snapshot(), 0, 16, TICK_DUR);
    expect(planned.map((p) => p.note)).toEqual(['C4']);
    // 4 cells at 1/16: (4 - 1 + 0.85) x stride x tickDur.
    expect(planned[0].holdSec).toBeCloseTo((4 - 1 + 0.85) * TICKS_PER_SIXTEENTH * TICK_DUR, 10);
    expect(planMelodyStep(snapshot(), 1, 16, TICK_DUR)).toEqual([]);
  });

  test('a coarser resolution makes an off-grid note DORMANT, not transposed onto the grid', () => {
    const rows = bar();
    // Tick 2 is off the 1/8 grid (stride 4) but on the 1/16 grid (stride 2).
    rows[2] = [{ note: 'G4', len: TICKS_PER_SIXTEENTH }];
    const at = (stepResolution: MelodyPlanSnapshot['stepResolution'], step: number) =>
      planMelodyStep(snapshot({ steps: rows, stepResolution }), step, 16, TICK_DUR).map((p) => p.note);
    expect(at('1/16', 1)).toEqual(['G4']);
    expect(at('1/8', 0)).toEqual(['C4']);
    expect(at('1/8', 1)).toEqual([]);
  });

  test('1/32 dispatches two columns from one clock step, at two offsets', () => {
    const rows = bar();
    rows[1] = [{ note: 'A4', len: 1 }];
    const planned = planMelodyStep(
      snapshot({ steps: rows, stepResolution: '1/32' }),
      0, 16, TICK_DUR,
    );
    expect(planned.map((p) => p.note)).toEqual(['C4', 'A4']);
    expect(planned[0].startOffsetSec).toBe(0);
    expect(planned[1].startOffsetSec).toBeCloseTo(TICK_DUR, 10);
  });

  test('is a plain function of its inputs: two calls agree', () => {
    expect(planMelodyStep(snapshot(), 0, 16, TICK_DUR)).toEqual(
      planMelodyStep(snapshot(), 0, 16, TICK_DUR),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/plan/melodyPlan.test.ts`
Expected: FAIL — `Cannot find module './melodyPlan'`.

- [ ] **Step 3: Write the implementation**

Create `src/audio/playback/plan/melodyPlan.ts`:

```typescript
import type { ArpSettings } from '@/types/synth';
import {
  leadScheduleHits,
  leadSoundingNotes,
  resolveLeadStepTriggers,
  type LeadNote,
} from '@/audio/leadMelody';
import { arpStepFor } from '@/utils/meter';
import {
  TICKS_PER_SIXTEENTH,
  columnsPerBar,
  strideFor,
  type LeadStepResolutionId,
} from '@/utils/stepResolution';

/**
 * One melody track's material, as the planner reads it.
 *
 * `steps` is the RAW stored matrix at LEAD_TICKS_PER_BAR — never strided at
 * snapshot time. Striding it here would bake one resolution into the snapshot
 * and silently drop every note the current grid cannot draw, which is the exact
 * opposite of the non-destructive scheme: a dormant slot is quiet, not gone.
 *
 * Melody is the one lane with no arm-time half at all — the controller rebuilds
 * this every dispatch out of live state, which is what lets a note drawn mid-bar
 * sound on the next step. The patch and the bus stay out of it: they are the
 * controller's, and `MixdownMelodyTrack` extends this type with exactly those
 * two fields.
 *
 * `MELODY_TRACKS` is what makes one planner serve both Lead and FX: no field
 * here names a track, so nothing in this file can hardcode `'lead'`.
 */
export interface MelodyPlanSnapshot {
  steps: readonly LeadNote[][];
  /** The MELODY loop's own length in bars, not the chord loop's. */
  loopLength: number;
  stepResolution: LeadStepResolutionId;
  gate: number;
  /** Beside the patch, never inside it — Arp is performance state. */
  arp: ArpSettings;
}

/** One resolved note-on/note-off pair, relative to the dispatch's own time. */
interface PlannedMelodyNote {
  note: string;
  /** Seconds AFTER the dispatch's time: the on-grid tick offset plus the arp's own. */
  startOffsetSec: number;
  holdSec: number;
}

/**
 * Everything one clock dispatch of a melody track sounds.
 *
 * The three decisions stay exactly where they were and keep their own names —
 * `leadScheduleHits` decides which columns fire and when, `leadSoundingNotes`
 * decides what is held there, `resolveLeadStepTriggers` decides what sounds and
 * for how long. What this function adds is the ONE composition of them, so the
 * live hook and the offline renderer stop transcribing the same loop twice.
 *
 * `stepInLoop` is the LOOP-relative clock step (the live clock resets to 0 at a
 * loop boundary; the renderer passes its pass-relative step), and `tickDurSec`
 * is one tick at the current bpm. Neither is read from a clock here: every time
 * is an argument, which is what makes live and offline the same computation.
 */
export function planMelodyStep(
  snapshot: MelodyPlanSnapshot,
  stepInLoop: number,
  stepsPerBar: number,
  tickDurSec: number,
): PlannedMelodyNote[] {
  const stride = strideFor(snapshot.stepResolution);
  const columns = snapshot.loopLength * columnsPerBar(stepsPerBar, stride);
  const melodyTicks = snapshot.loopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
  // Bar-phased, the identity in 4/4: this stops the arp sliding against the bar
  // line in an odd meter.
  const arpStep = arpStepFor(stepInLoop, stepsPerBar);

  const planned: PlannedMelodyNote[] = [];
  for (const hit of leadScheduleHits(stepInLoop, stride, columns, snapshot.arp.active, tickDurSec)) {
    const sounding = leadSoundingNotes(snapshot.steps, hit.column, stepsPerBar, stride);
    const triggers = resolveLeadStepTriggers(
      sounding,
      snapshot.arp,
      arpStep,
      tickDurSec,
      snapshot.gate,
      stride,
      // The ACTIVE window in TICKS, so a note left overhanging by a METER
      // change is capped at read time instead of ringing over the loop seam.
      { tickInLoop: hit.column * stride, melodyTicks },
    );
    for (const trigger of triggers) {
      planned.push({
        note: trigger.note,
        startOffsetSec: hit.offsetSec + trigger.timeOffsetSec,
        holdSec: trigger.holdSec,
      });
    }
  }
  return planned;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/plan/melodyPlan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/plan/melodyPlan.ts src/audio/playback/plan/melodyPlan.test.ts
git commit -m "refactor(playback): add the pure melody planner"
```

---

## Task 13: Route live melody playback through the planner

**Files:**
- Modify: `src/store/playbackPlanSnapshots.ts`
- Modify: `src/store/playbackPlanSnapshots.test.ts`
- Modify: `src/components/loop/lead/useLeadPlayback.ts` (the clock callback, l.94-150)

**Interfaces:**
- Consumes: `MelodyPlanSnapshot`, `planMelodyStep` (Task 12); `melodyTrack(trackId)` and
  `MelodyTrackId` from `@/store/melodyTracks`.
- Produces: `melodyPlanSnapshot(s: AppStore, trackId: MelodyTrackId): MelodyPlanSnapshot`.

- [ ] **Step 1: Write the failing test**

Add to `src/store/playbackPlanSnapshots.test.ts` (extending its imports with
`melodyPlanSnapshot`):

```typescript
describe('melodyPlanSnapshot', () => {
  const LEAD_STEPS = [[{ note: 'C4', len: 8 }]];
  const FX_STEPS = [[{ note: 'G5', len: 4 }]];
  const STATE = {
    leadMelodySteps: LEAD_STEPS,
    leadLoopLength: 2,
    leadStepResolution: '1/8',
    leadGate: 0.5,
    synthArpSettings: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
    fxMelodySteps: FX_STEPS,
    fxLoopLength: 4,
    fxStepResolution: '1/32',
    fxGate: 0.9,
    fxArpSettings: { active: true, mode: 'down', rate: '1/16', octaves: 2 },
  } as unknown as AppStore;

  test('reads the LEAD row of MELODY_TRACKS', () => {
    expect(melodyPlanSnapshot(STATE, 'lead')).toEqual({
      steps: LEAD_STEPS,
      loopLength: 2,
      stepResolution: '1/8',
      gate: 0.5,
      arp: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
    });
  });

  test('reads the FX row — one builder, two tracks, no hardcoded `lead`', () => {
    expect(melodyPlanSnapshot(STATE, 'fx')).toEqual({
      steps: FX_STEPS,
      loopLength: 4,
      stepResolution: '1/32',
      gate: 0.9,
      arp: { active: true, mode: 'down', rate: '1/16', octaves: 2 },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/playbackPlanSnapshots.test.ts`
Expected: FAIL — `melodyPlanSnapshot` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/store/playbackPlanSnapshots.ts`:

```typescript
import type { MelodyPlanSnapshot } from '@/audio/playback/plan/melodyPlan';
import { melodyTrack, type MelodyTrackId } from './melodyTracks';
```

```typescript
/**
 * One melody track's snapshot, read through `MELODY_TRACKS` so Lead and FX are
 * one implementation with two rows. Built per DISPATCH, not per arm: melody has
 * no arm-time half, and rebuilding it each tick is what lets a note drawn while
 * the loop runs sound on the next step.
 */
export function melodyPlanSnapshot(s: AppStore, trackId: MelodyTrackId): MelodyPlanSnapshot {
  const track = melodyTrack(trackId);
  return {
    steps: s[track.steps],
    loopLength: s[track.loopLength],
    stepResolution: s[track.stepResolution],
    gate: s[track.gate],
    arp: s[track.arpSettings],
  };
}
```

In `src/components/loop/lead/useLeadPlayback.ts`, replace the body of the clock callback from
`const arpStep = ...` (l.115) to the end of the `for (const hit of hits)` loop (l.149) with:

```typescript
      // ONE call, not the three-function chain written out here and again in
      // the renderer: the grid's "which pitches are held", the arp's "when to
      // strike them" and the gate's "how long" are all planMelodyStep's, and
      // this hook keeps only the clock, the store read and the engine.
      for (const planned of planMelodyStep(
        melodyPlanSnapshot(s, trackId),
        step,
        stepsPerBar,
        tickDur,
      )) {
        const start = time + planned.startOffsetSec;
        // The ID this hit started, released at the end of its own hold: a
        // melody grid shares its bus with the live keyboard and the arp, so a
        // release by note name would cut whichever of the three the engine
        // found first.
        const voiceId = playbackNoteOn(
          planned.note,
          params,
          DEFAULT_VELOCITY,
          start,
          track.engineSource,
        );
        playbackNoteOff(voiceId, releaseSeconds, start + planned.holdSec);
      }
```

Delete the now-unused locals above it (`stride`, `columns`, `melodyTicks`, `arpStep`, `hits`) and
the `arp` local if nothing else reads it — `leadStepAction` needs `stepsPerBar`, `tickDur` and
`params`/`releaseSeconds` stay. Update the imports: drop
`leadScheduleHits`/`leadSoundingNotes`/`resolveLeadStepTriggers` from `@/audio/leadMelody`, drop
`arpStepFor` and the `columnsPerBar`/`strideFor` imports if unused, and add:

```typescript
import { planMelodyStep } from '@/audio/playback/plan/melodyPlan';
import { melodyPlanSnapshot } from '@/store/playbackPlanSnapshots';
```

`TICKS_PER_SIXTEENTH` stays — `tickDur` is still computed here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/playbackPlanSnapshots.test.ts src/audio/playback/plan/melodyPlan.test.ts && bun run lint`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/playbackPlanSnapshots.ts src/store/playbackPlanSnapshots.test.ts src/components/loop/lead/useLeadPlayback.ts
git commit -m "refactor(playback): live melody playback goes through the melody planner"
```

---

## Task 14: Delete the offline melody transcription, and prove the two paths agree

**Files:**
- Modify: `src/audio/export/renderMixdown.ts` (`MixdownMelodyTrack` l.105-115 and
  `scheduleMelodyStep` l.653-687)
- Modify: `src/audio/export/renderMixdown.test.ts`

**Interfaces:**
- Consumes: `MelodyPlanSnapshot`, `planMelodyStep` (Task 12); `melodyPlanSnapshot` (Task 13, in
  the test only).
- Produces: `MixdownMelodyTrack extends MelodyPlanSnapshot { params: ActiveSynth; source: string }`
  — the renderer's melody track IS the planner snapshot plus its output binding, so
  `planMelodyStep(track, …)` takes it directly.

- [ ] **Step 1: Write the failing test**

Add to `src/audio/export/renderMixdown.test.ts`:

```typescript
describe('live and offline melody planning are the same computation', () => {
  const steps = mixdownMelodyBar('C4');
  const loop = mixdownLoop({
    leadMelodySteps: steps,
    leadLoopLength: 1,
    leadStepResolution: '1/16',
    leadGate: 0.85,
  });
  const state = {
    leadMelodySteps: loop.leadMelodySteps,
    leadLoopLength: loop.leadLoopLength,
    leadStepResolution: loop.leadStepResolution,
    leadGate: loop.leadGate,
    synthArpSettings: loop.synthArpSettings,
  } as unknown as AppStore;

  /** The renderer's own track shape, built exactly as mixdownLeadTrack builds it. */
  const track = {
    steps: loop.leadMelodySteps,
    loopLength: loop.leadLoopLength,
    stepResolution: loop.leadStepResolution,
    gate: loop.leadGate,
    arp: loop.synthArpSettings,
  };

  for (const [meterId, spb] of [['4/4', 16], ['3/4', 12], ['12/8', 24]] as const) {
    test(`${meterId}: every step of the loop plans identically`, () => {
      const tickDur = stepDurationSec(120) / TICKS_PER_SIXTEENTH;
      for (let step = 0; step < spb; step += 1) {
        expect(planMelodyStep(track, step, spb, tickDur), `step ${step}`).toEqual(
          planMelodyStep(melodyPlanSnapshot(state, 'lead'), step, spb, tickDur),
        );
      }
    });
  }

  test('a note left overhanging by a METER change is capped, not rung over the seam', () => {
    // 40 ticks is legal in 12/8 (48 ticks to the bar) and eight too long in 4/4.
    const long = mixdownMelodyBar('C4').map((row, i) => (i === 0 ? [{ note: 'C4', len: 40 }] : row));
    const tickDur = stepDurationSec(120) / TICKS_PER_SIXTEENTH;
    const wide = planMelodyStep({ ...track, steps: long }, 0, 24, tickDur)[0];
    const narrow = planMelodyStep({ ...track, steps: long }, 0, 16, tickDur)[0];
    expect(narrow.holdSec).toBeLessThan(wide.holdSec);
  });
});
```

Add `import { planMelodyStep } from '../playback/plan/melodyPlan';`,
`import { melodyPlanSnapshot } from '@/store/playbackPlanSnapshots';` and
`import { TICKS_PER_SIXTEENTH } from '@/utils/stepResolution';` to the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/export/renderMixdown.test.ts -t "melody planning"`
Expected: FAIL — `melodyPlanSnapshot`'s `MelodyPlanSnapshot` and the renderer's hand-built track
are not yet the same type, so the file does not type-check under `bun run lint`; the test itself
fails only once one of the two paths is wrong. As in Task 11, if it passes on the first run, prove
it is not vacuous by temporarily changing `leadGate` on one side and confirming a red.

- [ ] **Step 3: Write the implementation**

In `src/audio/export/renderMixdown.ts`:

```typescript
import { planMelodyStep, type MelodyPlanSnapshot } from '../playback/plan/melodyPlan';
```

```typescript
/**
 * One melody track as the renderer holds it: the planner's snapshot plus the
 * two things the planner must not know about — the patch to play it with and
 * the bus to play it on.
 */
interface MixdownMelodyTrack extends MelodyPlanSnapshot {
  params: ActiveSynth;
  source: string;
}
```

(`mixdownLeadTrack`/`mixdownFxTrack` keep their bodies verbatim: they already return exactly these
seven fields.)

Replace `scheduleMelodyStep` (l.653-687) with:

```typescript
/**
 * One melody track's material at one PASS-RELATIVE step, at an explicit
 * absolute time.
 *
 * This used to be a transcription of the live hook's clock callback — the same
 * three-function chain written twice, free to diverge. Both now call
 * `planMelodyStep`; what is left here is the render's half: the time, the patch
 * and the engine.
 */
function scheduleMelodyStep(
  engine: AudioEngine,
  track: MixdownMelodyTrack,
  stepInPass: number,
  stepsPerBar: number,
  tickDur: number,
  time: number,
): void {
  for (const planned of planMelodyStep(track, stepInPass, stepsPerBar, tickDur)) {
    const start = time + planned.startOffsetSec;
    const voiceId = engine.triggerSynthNoteOn(
      planned.note, track.params, DEFAULT_VELOCITY, start, track.source, 1, 'sequencer',
    );
    if (voiceId) {
      engine.triggerSynthNoteOff(
        voiceId,
        synthReleaseSeconds(track.params),
        start + planned.holdSec,
      );
    }
  }
}
```

Drop the now-unused `leadScheduleHits`/`leadSoundingNotes`/`resolveLeadStepTriggers`/`LeadTrigger`
imports, and `arpStepFor`/`columnsPerBar`/`strideFor` if nothing else in the file uses them
(`TICKS_PER_SIXTEENTH` is still used for `tickDur` in `scheduleArrangement`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/export/renderMixdown.test.ts`
Expected: PASS, including `renderMixdown: determinism` (byte-identical renders) and
`renderMixdown: every melodic source plays its own patch`.

Run: `bun run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/audio/export/renderMixdown.ts src/audio/export/renderMixdown.test.ts
git commit -m "refactor(playback): offline melody rendering goes through the melody planner"
```

---

## Task 15: Document the planner/controller seam in CLAUDE.md, and run the full verification gate

**Files:**
- Modify: `CLAUDE.md` (Architecture section, after the "The store→engine bridge" paragraph)
- Modify: `.claude/rules/testing.md` (one sentence on planner tests, beside the existing "Where a
  data/audio test lives" note)

**Interfaces:**
- Consumes: everything Tasks 1-14 produced.
- Produces: the written rule a future change is reviewed against, and a green
  `bun run verify`.

- [ ] **Step 1: Write the CLAUDE.md paragraph**

Insert after the "**The store→engine bridge** is `src/store/engineSync.ts` …" paragraph:

```markdown
**Playback is PLANNED, then PERFORMED, and the planner half is pure.**
`src/audio/playback/plan/` holds one planner per lane — `padPlan.ts`, `chordPlan.ts` (chord and
bass, armed together) and `melodyPlan.ts` (Lead and FX, one implementation through
`MELODY_TRACKS`). A planner takes an immutable snapshot plus an explicit per-step context and
returns RESOLVED PLAYABLE EVENTS — note identity, timing, hold, velocity — and it reads no store,
calls no engine setter, opens no `AudioContext`, reads no wall clock and arms no timer. That is an
ESLint block scoped to the folder, not a convention: `src/architecture/playbackPlannerPurity.test.ts`
is the committed proof that the block is armed, and it asserts SEVERITY, because `verify` tolerates
warnings. Everything else — the clock subscription, the arming state, the full-hold strikes, the
note-ons — is the CONTROLLER's (`useChordPlayback.ts`, `useLeadPlayback.ts`, and
`renderMixdown.ts` offline).

**There are FOUR snapshots, not one, and that is forced rather than chosen.** Every lane has its
own arm-time/emit-time split: chord and bass fix their cycle, their notes and the arp's ACTIVE
flag when a chord is armed, but read both synth patches, both Arp SETTINGS objects and both feel
values live on every step — which is exactly what makes a knob tweak audible on the next hit
instead of the next chord. Pad is arm-time only; melody is emit-time only. One unified
`PlaybackSnapshot` would freeze the emit-time half of three lanes to kill one type. So the
SNAPSHOT is arm-time immutable and the CONTEXT is the live read, passed in per step.

**The snapshot is built in two places and the planner is called from both.**
`src/store/playbackPlanSnapshots.ts` builds the live ones — taking `AppStore` as an ARGUMENT, never
calling `useAppStore.getState()` itself, so the singleton never leaves the controller — and
`src/audio/export/renderMixdown.ts` builds the offline twins from a `MixdownLoop`. Live/offline
equivalence is therefore a deep-equality assertion on two snapshots plus one on the planner's
output, not a comparison of two schedulers; the melody lane's hand-transcribed offline copy is
gone, which is what that duplication used to cost. A new lane field belongs in BOTH builders or in
neither.
```

- [ ] **Step 2: Add the testing-rules sentence**

In `.claude/rules/testing.md`, under "Where a data/audio test lives", add:

```markdown
A test of a planner (`src/audio/playback/plan/`) needs no DOM, no zustand singleton and no
`AudioContext` — construct the snapshot as a plain object and assert on the returned events. If a
planner test reaches for any of those three, the planner has grown a dependency the ESLint block
in `eslint.config.js` is supposed to forbid; fix the planner, not the test.
```

- [ ] **Step 3: Run the full gate**

Run: `bun run verify`
Expected: PASS end to end — all tests, `bun run lint`, `bun run eslint` (zero errors AND zero
warnings), `check:theme`, `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip
scans at their zero-finding baseline, and the production build.

If Knip reports an unused export, it is a planner export with no production consumer: stop
exporting it (make it module-local) rather than adding it to a Knip ignore list.

- [ ] **Step 4: Confirm the DoD by hand**

- `bun test src/audio/playback/plan/` — every planner suite green with no DOM, no store, no
  AudioContext imported anywhere in the folder's tests.
- `bun test src/audio/export/renderMixdown.test.ts` — the equivalence suites from Tasks 4, 11 and
  14, plus the byte-identical determinism renders.
- `grep -rn "useAppStore" src/audio/` — no hits (the layering ban already guarantees it; this is
  the five-second confirmation that no snapshot builder drifted into the audio layer).
- `grep -rn "playbackStep\|soloTracks" src/audio/playback/plan/` — no hits: no playback position
  reached a slice or a planner.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .claude/rules/testing.md
git commit -m "docs: record the playback planner/controller seam and its purity gate"
```

---

## Self-Review

**Spec coverage — the issue's Acceptance Criteria:**

- *"A playback snapshot contains all durable intent needed by planners without exposing the
  Zustand singleton."* → Tasks 1 (`PadPlanSnapshot`), 5 (`ChordPlanSnapshot`), 12
  (`MelodyPlanSnapshot`); Tasks 3/9/13 build them in `src/store/playbackPlanSnapshots.ts` from an
  `AppStore` ARGUMENT, with the singleton read staying in the controller.
- *"Pure planners accept explicit snapshot/context inputs and return resolved playable events with
  note identity, timing, hold, velocity, owner/source and other required scheduling metadata."* →
  Tasks 1, 5-8, 12. Note the deliberate boundary: `owner` (`'sequencer'`) and `source`
  (`'chord'`/`'bass'`/`'pad'`/the melody track's bus) are supplied by the CONTROLLER at the engine
  call, exactly as CLAUDE.md requires ("the owner is chosen by the bridges in
  `src/audio/playback/` and no file in `src/components/` names one"); the planner's events carry
  note identity, timing, hold and velocity. DEV-399 is where the engine contract narrows to these
  types, and this split is what it will consume.
- *"Planners perform no store writes, engine calls, AudioContext reads or wall-clock/global
  reads."* → Task 2 (ESLint block + `playbackPlannerPurity.test.ts`), enforced for every later
  task.
- *"Runtime controllers own store subscription, lookahead-clock coordination, scheduling/
  cancellation and handoff to the engine."* → Tasks 3, 9, 13 keep every `subscribePlaybackClock`,
  every arming ref and every engine call in the controllers; `src/audio/clock.ts` is untouched.
- *"Chord, bass, pad and melody planners preserve their independent cycle and seam rules."* →
  Task 5 (preset-only full hold, custom span stays a span), Task 6 (independent bass cycle,
  approach-tone `lastBarOnly`, full hold resolved at scale 1), Task 8 (per-lane fold of one
  progression-relative step), Task 12 (resolution stride, two kinds of dormancy, meter-overhang
  cap). Tests: Tasks 5-8, 11, 12, 14.
- *"Live playback and offline mixdown reuse the same planning logic wherever their semantics are
  the same."* → Tasks 4, 10, 14; proven by Tasks 4, 11, 14.
- *"High-frequency playback position remains outside persisted/global store state."* → Global
  Constraints; no task adds a slice field, and Task 15 step 4 greps for it.
- *"Migration can land lane-by-lane without a simultaneous rewrite."* → three phases, each ending
  with both call sites migrated and an equivalence test green (Tasks 4, 11, 14).

**Definition of Done:**

- *"Deterministic planner tests require no DOM, Zustand singleton or AudioContext."* → Tasks 1, 5,
  6, 7, 8, 12 — every one constructs plain objects.
- *"Live/offline equivalence tests cover representative meters, loop lengths, chord boundaries and
  approach tones."* → Task 11 (4/4, 3/4, 12/8, 7/8; preset and two-bar custom cycles; every step
  of every chord, so both boundaries and the last bar; an explicit approach-tone test) and Task 14
  (4/4, 3/4, 12/8 for melody, plus the meter-overhang cap).
- *"Existing playback timing characterization passes."* → Tasks 10 and 14 both require
  `renderMixdown.test.ts` green, including the byte-identical determinism renders; Task 9 requires
  `useChordPlayback.test.ts` green including its two source-scan assertions.
- *"`bun run verify` passes."* → Task 15.

**Placeholder scan:** no "TBD", no "similar to Task N", no "add error handling"; every code step
carries the actual code, and the two places where an assertion depends on library content
(`classic-walk`'s approach tokens in Task 8, the arp fixtures) reconstruct the expectation from
the same primitives rather than hard-coding a number nobody verified.

**Type consistency:** `PadPlanSnapshot`/`planPadArm` (Tasks 1, 3, 4);
`ChordPlanSnapshot`/`planChordLane`/`planBassLane`/`ArmedChordPlan`/`planChordArm`/`planChordStep`
(Tasks 5-11); `MelodyPlanSnapshot`/`planMelodyStep` (Tasks 12-14);
`padPlanSnapshot`/`chordPlanSnapshot`/`melodyPlanSnapshot` (Tasks 3, 9, 13);
`padSnapshotForLoop`/`chordSnapshotForLoop` (Tasks 4, 10). Every name is spelled the same way at
its definition and at every later use. `LoopVoices` changes shape exactly once (Task 10) and its
only two consumers change in that same task.
