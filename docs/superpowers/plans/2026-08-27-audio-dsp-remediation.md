# Audio / DSP Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a catalogued set of correctness defects in Solna's audio layer — transport clock fault-isolation, effect-parameter safety, synth envelope/LFO correctness, drum voice routing, playback scheduling — without splitting the `AudioEngine` class.

**Architecture:** Bottom-up. Task 1 introduces the shared constants and duration helpers that every later task imports, then each task fixes one coherent area of `src/audio/engine.ts` (clock → effects → envelopes → LFO → drums), then the playback layer, then the type/dead-code sweep. Every fix is driven by a `bun:test` test written first, reusing the fake-AudioContext harness already in `src/audio/engine.test.ts` (`fakeParam` / `fakeNode` / `fakeCtx` / `freshEngine`) — **do not invent a second harness**.

**Tech Stack:** Bun (test runner + scripts), Vite + React 18, raw Web Audio API (no Tone.js), Zustand with `persist` + `subscribeWithSelector`, `tonal` for music theory only.

**Spec:** This document is self-contained. Supporting context: `/Users/Pathompong/Sites/Personal/solna/CLAUDE.md`, `.claude/skills/dsp-audio/SKILL.md`, `docs/design.md`.

## Global Constraints

- Runtime is **Bun**. The completion gate is `bun run verify` = `bun test && bun run lint && bun run check:keys && bun run check:drums && bun run build`. It does **not** include `bun run eslint` — run `bun run eslint` separately in every task that adds, removes or moves an import.
- **Three-layer import rule, enforced by eslint `no-restricted-imports`** (`eslint.config.js:18-67`): `src/audio/**` must not import `**/store/**` or `**/components/**`; `src/store/**` must not import `**/components/**`; `src/components/**` must not import `**/audio/engine`. Exempt: `src/components/AudioVisualizer.tsx`, `src/components/TransportBar.tsx`, `**/*.test.ts`, `**/*.test.tsx`.
- **Never call an engine setter from a component.** New engine-settable state goes into a store slice and is wired in `src/store/engineSync.ts`, mirrored in `applySliceState()` (engineSync.ts:24-39) so `applyEngineSnapshot()` re-applies it after the AudioContext exists.
- Tests are `bun:test`, **pure-logic**. There is no DOM and no testing-library. Components export their testable helpers; test files import those.
- **Do NOT rename Instant Vibe ids.** Ids intentionally drift from labels (`cyber-dance` → "Cyber EDM" etc.) and are persisted in project files.
- No `tailwind.config.*` may be added. No raw hex / Tailwind palette classes / `dark:` variant anywhere (`scripts/themeTokenGuard.ts` fails the build).
- eslint has `complexity: ['warn', 20]` (`eslint.config.js:11`). `triggerDrum` is currently 26 and warns.
- **One commit per task**, conventional-commit style, message in English.
- **INTENT: correctness over preserving the current sound.** Tasks 4, 7 and 8 deliberately change how the app sounds. Each says so explicitly and requires re-running `bun run check:drums` plus a manual A/B.

## Out of Scope — and why

1. **Splitting `AudioEngine` into `MasterChain` / `VoiceManager` collaborators.** `VoiceManager` would touch `getSourceBus`, `dryGain`, `noiseBuffer` and the master chain's lifetime on nearly every method; separating them means threading a shared graph handle that is recreated on every `init()`, risking exactly the "voice connected to a dead node from the previous context" class of bug that `setupMasterChain()`'s `this.sourceBuses.clear()` (engine.ts:210) exists to prevent. `engine.test.ts` pins voice *behaviour*, not wiring identity, so the refactor would be unguarded. Revisit only after this plan has shipped and stayed quiet.
2. **Per-voice drum filters.** Task 8 routes drum reverb sends through a second shared filter (`drumSendFilter`) that mirrors `drumBusFilter`. A true per-voice filter would be needed to make each voice's send independently filtered, but that trades away live drum-filter sweeps on ringing tails — which is the entire reason the shared node exists (`engine.test.ts:453-477` pins it). The shared mirror gets the same audible result at one extra node.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/audio/constants.ts` | Audio-domain scalar constants + tiny pure clamps: `DEFAULT_VELOCITY`, `ENV_FLOOR`, `SILENCE`, `clampCutoff`, `clampVelocity`. Imports nothing. |
| `src/audio/effectLimits.ts` | The single `EFFECT_LIMITS` table and `clampEffects()`, shared by `engine.updateEffects` and `store.sanitizePersistedState` so the two cannot drift. Imports only `src/types.ts`. |
| `src/audio/groupByStyle.ts` | `groupByStyle<T extends { style: string }>(items)` — the IIFE duplicated in `bassPatterns.ts` and `rhythmPatterns.ts`. |
| `src/audio/clock.test.ts` | The clock's first test suite. |
| `src/audio/drumKits.test.ts` | `mergeDrumKit` behaviour + the `GENRE_PRESETS` / `GENRE_TO_KIT` key-set invariant. |
| `src/audio/bassPresets.test.ts` | Every bass preset is `category: 'Bass'` (required by `InstantVibe.bassPresetId`, types.ts:195). |
| `src/store/transportSlice.test.ts` | `setBpm` clamping. |

**Modified files** (in first-touched order)

`src/utils/musicTheory.ts`, `src/audio/engine.ts`, `src/store/transportSlice.ts`, `src/store/store.ts`, `src/audio/engine.test.ts`, `src/audio/playback/{chordPlayback,arpPlayback,presetPreview,drumPlayback}.ts`, `src/store/engineSync.ts`, `src/types.ts`, `src/audio/{arpeggiator,arpSchedule,bassPatterns,bassPresets,synthPresets,rhythmPatterns,drumKits}.ts`, `src/store/initialState.ts`, `src/components/{SynthView,SimpleSynthPanel}.tsx`, `src/components/chord/useChordPlayback.ts`, `src/audio/data/genrePresets.ts`, `.claude/skills/dsp-audio/SKILL.md`.

---

### Task 1: Shared timing constants and duration helpers

**Why:** `sixteenthNoteMs(bpm) / 1000` is written at 8 call sites and `stepDur * STEPS_PER_BAR` at 4. `STEPS_PER_BAR` lives in `engine.ts:1161`, so a duration helper in `musicTheory.ts` cannot reach it without a cycle (engine.ts:2 already imports musicTheory). Move the constant down to the leaf and re-export it from `engine.ts` so all existing import paths keep working. The magic velocity `0.8` is repeated as "the engine's default" at four sites.

**No sound change.** Pure extraction.

**Files:**
- Modify: `src/utils/musicTheory.ts:334-336` (add constants + helpers after `sixteenthNoteMs`)
- Create: `src/audio/constants.ts`
- Modify: `src/audio/engine.ts:1-3` (imports), `:191` (clockTick), `:381` (`triggerSynthNoteOn` default), `:874` (`triggerDrum` default), `:1161` (re-export)
- Modify: `src/audio/bassPatterns.ts:3,71,127`
- Modify: `src/audio/playback/chordPlayback.ts:12,44,209,244,295`
- Modify: `src/audio/playback/arpPlayback.ts:5,41`
- Modify: `src/components/chord/useChordPlayback.ts:27,130,131,210,304,309,341,356`
- Test: `src/utils/musicTheory.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/utils/musicTheory.ts`: `export const STEPS_PER_BAR = 16`, `export const MIN_BPM = 20`, `export const MAX_BPM = 300`, `export function clampBpm(bpm: number): number`, `export function stepDurationSec(bpm: number): number`, `export function barDurationSec(bpm: number): number`
  - `src/audio/constants.ts`: `export const DEFAULT_VELOCITY = 0.8`, `export const ENV_FLOOR = 0.0001`, `export const SILENCE = 0.00001`, `export function clampCutoff(hz: number): number`, `export function clampVelocity(v: number): number`
  - `src/audio/engine.ts` keeps `export const STEPS_PER_BAR` as a re-export, so `chordPlayback.ts:1`, `playbackEngine.ts:1`, `useSequencerPlayback.ts:6` and `useChordPlayback.ts:30` are untouched.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/musicTheory.test.ts` (add `MAX_BPM`, `MIN_BPM`, `STEPS_PER_BAR`, `barDurationSec`, `clampBpm`, `sixteenthNoteMs`, `stepDurationSec` to the existing `from './musicTheory'` import list at lines 4-17):

```ts
describe('tempo helpers', () => {
  test('stepDurationSec is sixteenthNoteMs in seconds', () => {
    for (const bpm of [20, 90, 120, 174, 300]) {
      expect(stepDurationSec(bpm)).toBeCloseTo(sixteenthNoteMs(bpm) / 1000, 12);
    }
  });

  test('barDurationSec is one 16-step bar', () => {
    expect(barDurationSec(120)).toBeCloseTo(stepDurationSec(120) * STEPS_PER_BAR, 12);
    expect(barDurationSec(120)).toBeCloseTo(2, 12); // 4 beats at 120 bpm
  });

  test('STEPS_PER_BAR is 16 and is the value engine.ts re-exports', () => {
    expect(STEPS_PER_BAR).toBe(16);
  });

  test('clampBpm holds the transport range and rejects non-finite input', () => {
    expect(clampBpm(0)).toBe(MIN_BPM);
    expect(clampBpm(19.9)).toBe(MIN_BPM);
    expect(clampBpm(301)).toBe(MAX_BPM);
    expect(clampBpm(128)).toBe(128);
    expect(clampBpm(Number.NaN)).toBe(120);
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(MAX_BPM);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: FAIL — `stepDurationSec`/`barDurationSec`/`clampBpm`/`MIN_BPM`/`MAX_BPM`/`STEPS_PER_BAR` are not exported from `./musicTheory`.

- [ ] **Step 3: Add the helpers to `src/utils/musicTheory.ts`**

Insert immediately after `sixteenthNoteMs` (currently ends at line 336):

```ts
/**
 * The shared grid resolution. Declared here rather than in audio/engine.ts so
 * barDurationSec can use it without a cycle — engine.ts already imports this
 * module. engine.ts re-exports it, so every existing `from '../engine'` import
 * of STEPS_PER_BAR keeps working.
 */
export const STEPS_PER_BAR = 16;

/** Transport tempo bounds. The engine clock and the store clamp to the same pair. */
export const MIN_BPM = 20;
export const MAX_BPM = 300;

/**
 * A bpm the clock can actually use. The BPM input is `type="number"`, so an
 * empty field yields 0 — an unclamped 0 makes every listener compute a step
 * duration from a 1-bpm floor and land its note-offs minutes away (stuck notes).
 */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** One 16th-note step, in seconds. */
export function stepDurationSec(bpm: number): number {
  return sixteenthNoteMs(bpm) / 1000;
}

/** One STEPS_PER_BAR bar, in seconds. */
export function barDurationSec(bpm: number): number {
  return stepDurationSec(bpm) * STEPS_PER_BAR;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS

- [ ] **Step 5: Create `src/audio/constants.ts`**

```ts
/**
 * Audio-domain scalars shared across the engine and the playback layer.
 * Imports nothing — this file must stay a leaf so audio/, store/ and the
 * invariant scripts can all pull from it.
 */

/** The velocity the engine assumes when a caller does not name one. */
export const DEFAULT_VELOCITY = 0.8;

/**
 * The floor every exponential envelope ramp aims for. exponentialRampToValueAtTime
 * cannot reach 0, so a floor is mandatory; one shared value keeps voices from
 * ending 20 dB apart purely because a call site typed an extra zero.
 */
export const ENV_FLOOR = 0.0001;

/** The lower floor used for a full release — quieter than ENV_FLOOR by 20 dB. */
export const SILENCE = 0.00001;

/** BiquadFilter cutoff bounds: below 20 Hz or above 20 kHz is inaudible and
 *  an exponential ramp through 0 is illegal. */
export function clampCutoff(hz: number): number {
  return Math.min(20000, Math.max(20, hz));
}

/** Velocity is a 0..1 scalar; a caller passing 3 would blow past the limiter. */
export function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VELOCITY;
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 6: Rewire `src/audio/engine.ts`**

Change the import at line 2 and add line 3:

```ts
import { noteFrequency, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import { DEFAULT_VELOCITY } from './constants';
```

(`sixteenthNoteMs` is no longer used in engine.ts.)

Line 191 becomes:

```ts
    const stepDuration = stepDurationSec(this.clockBpm);
```

Line 381 signature default: `velocity = DEFAULT_VELOCITY`.
Line 874 signature default: `velocity = DEFAULT_VELOCITY`.

Replace line 1161 with the re-export:

```ts
// Re-exported from utils/musicTheory so the grid constant has one definition
// while every `import { STEPS_PER_BAR } from '../engine'` keeps resolving.
export { STEPS_PER_BAR };
```

- [ ] **Step 7: Replace the remaining duplicated duration math**

| File:line | Before | After |
|---|---|---|
| `bassPatterns.ts:3` | `import { SCALES, rootSemitone, sixteenthNoteMs } from '../utils/musicTheory';` | `import { SCALES, rootSemitone, stepDurationSec } from '../utils/musicTheory';` |
| `bassPatterns.ts:71` | `const stepDur = sixteenthNoteMs(bpm) / 1000;` | `const stepDur = stepDurationSec(bpm);` |
| `bassPatterns.ts:127` | `velocity: 0.8 * (step.velocity ?? 1), // mirror the engine's default velocity` | `velocity: DEFAULT_VELOCITY * (step.velocity ?? 1),` (add `import { DEFAULT_VELOCITY } from './constants';`) |
| `chordPlayback.ts:12` | `sixteenthNoteMs,` inside the musicTheory import | `barDurationSec,` |
| `chordPlayback.ts:44` | `(hit.velocity ?? 0.8) * ...` | `(hit.velocity ?? DEFAULT_VELOCITY) * ...` |
| `chordPlayback.ts:209` | `0.8 * equalPowerVelocityScale(notes.length),` | `DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),` |
| `chordPlayback.ts:244` | `0.8 * equalPowerVelocityScale(chord.notes.length),` | `DEFAULT_VELOCITY * equalPowerVelocityScale(chord.notes.length),` |
| `chordPlayback.ts:295` | `return (sixteenthNoteMs(bpm) / 1000) * STEPS_PER_BAR;` | `return barDurationSec(bpm);` |
| `arpPlayback.ts:5` | `import { sixteenthNoteMs } from '../../utils/musicTheory';` | `import { stepDurationSec } from '../../utils/musicTheory';` |
| `arpPlayback.ts:41` | `const stepDur16 = sixteenthNoteMs(bpm) / 1000;` | `const stepDur16 = stepDurationSec(bpm);` |
| `useChordPlayback.ts:130,210,304,341` | `const stepDur = sixteenthNoteMs(s.bpm) / 1000;` (and the `bpm` variants) | `const stepDur = stepDurationSec(...)` |
| `useChordPlayback.ts:131,309,356` | `const barDur = stepDur * STEPS_PER_BAR;` | `const barDur = barDurationSec(...)` — use the same bpm expression the neighbouring `stepDur` line uses |

Add `DEFAULT_VELOCITY` to `chordPlayback.ts`'s imports: `import { DEFAULT_VELOCITY } from "../constants";`
Update `useChordPlayback.ts:27` and `:30` so `sixteenthNoteMs` / `STEPS_PER_BAR` are replaced by `stepDurationSec` / `barDurationSec` from `../../utils/musicTheory` (leave the `STEPS_PER_BAR` import if it is still used at `:250` and `:509` — it is).

- [ ] **Step 8: Run the full gate**

Run: `bun test && bun run lint && bun run eslint`
Expected: PASS, 693+ tests. If `bun run eslint` reports an unused `sixteenthNoteMs` import anywhere, delete it.

- [ ] **Step 9: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts src/audio/constants.ts src/audio/engine.ts src/audio/bassPatterns.ts src/audio/playback/chordPlayback.ts src/audio/playback/arpPlayback.ts src/components/chord/useChordPlayback.ts
git commit -m "refactor(audio): extract shared tempo constants and duration helpers"
```

---

### Task 2: Clock robustness — fault-isolated listeners, counters before dispatch, BPM clamp

**Why:** `clockTick` (engine.ts:185-202) dispatches to listeners at line 198 with no `try/catch`, and advances `clockNextStepTime` / `clockStepIndex` at lines 199-200 **after** the dispatch. One throwing listener therefore freezes the whole transport forever: the same step is re-dispatched, and re-thrown, every 25 ms. Line 196 also hardcodes `step % 16` where `STEPS_PER_BAR` now exists. Separately, `transportSlice.setBpm` (transportSlice.ts:88) writes the raw value while `engine.setClockBpm` (engine.ts:156) clamps — so an empty BPM input puts `0` in the store, every playback hook computes its step duration from it, and note-offs land minutes away.

There are currently **zero** tests for the clock.

**No sound change** beyond removing stuck notes and dead transports.

**Files:**
- Modify: `src/audio/engine.ts:155-157` (`setClockBpm`), `:185-202` (`clockTick`)
- Modify: `src/store/transportSlice.ts:88`
- Create: `src/audio/clock.test.ts`
- Create: `src/store/transportSlice.test.ts`

**Interfaces:**
- Consumes: `clampBpm`, `stepDurationSec`, `STEPS_PER_BAR` from `src/utils/musicTheory` (Task 1).
- Produces: no new exports. `clockTick` keeps its private signature `(): void`; tests reach it through `(engine as any).clockTick()`.

- [ ] **Step 1: Write the failing clock test**

Create `src/audio/clock.test.ts`:

```ts
import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from './engine';
import { STEPS_PER_BAR, stepDurationSec } from '../utils/musicTheory';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private clockTick and read private clock
   fields, matching engine.test.ts's casting convention. */
type EngineInstance = typeof audioEngine;
const makeEngine = () => new (audioEngine.constructor as any)() as EngineInstance;

/**
 * The clock only needs `currentTime` off the context, so this is deliberately
 * smaller than engine.test.ts's fakeCtx — driving clockTick() by hand instead
 * of through setInterval keeps the suite synchronous and deterministic.
 */
function clockEngine(bpm = 120) {
  const engine = makeEngine();
  const ctx = { currentTime: 10 };
  (engine as any).ctx = ctx;
  engine.setClockBpm(bpm);
  (engine as any).clockNextStepTime = ctx.currentTime;
  (engine as any).clockStepIndex = 0;
  const tick = () => (engine as any).clockTick();
  return { engine, ctx, tick };
}

describe('shared clock dispatch', () => {
  test('a listener that throws does not stall the grid', () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { engine, ctx, tick } = clockEngine();
      const good: number[] = [];
      engine.subscribeClock(() => {
        throw new Error('listener blew up');
      });
      engine.subscribeClock((step) => good.push(step));

      tick();
      const firstBatch = good.length;
      expect(firstBatch).toBeGreaterThan(0);
      // Steps must be consecutive: a stall re-dispatches the same index.
      expect(good).toEqual(good.map((_, i) => i));

      ctx.currentTime += 1;
      tick();
      // The grid advanced past the first batch instead of re-throwing step 0.
      expect(good.length).toBeGreaterThan(firstBatch);
      expect(good[good.length - 1]).toBeGreaterThan(good[firstBatch - 1]);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test('a throwing listener does not starve the ones registered after it', () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { engine, tick } = clockEngine();
      const seen: string[] = [];
      engine.subscribeClock(() => seen.push('a'));
      engine.subscribeClock(() => {
        throw new Error('boom');
      });
      engine.subscribeClock(() => seen.push('c'));

      tick();

      expect(seen.filter((s) => s === 'a').length).toBe(seen.filter((s) => s === 'c').length);
      expect(seen.filter((s) => s === 'c').length).toBeGreaterThan(0);
    } finally {
      errors.mockRestore();
    }
  });

  test('step index is monotonic and beat is floor(step / 4)', () => {
    const { engine, ctx, tick } = clockEngine();
    const rows: Array<{ step: number; beat: number; time: number }> = [];
    engine.subscribeClock((step, beat, time) => rows.push({ step, beat, time }));

    tick();
    ctx.currentTime += 0.5;
    tick();

    expect(rows.map((r) => r.step)).toEqual(rows.map((_, i) => i));
    for (const r of rows) expect(r.beat).toBe(Math.floor(r.step / 4));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].time).toBeGreaterThan(rows[i - 1].time);
    }
  });

  test('a bpm change mid-run re-spaces the following steps', () => {
    const { engine, ctx, tick } = clockEngine(120);
    const times: number[] = [];
    engine.subscribeClock((_s, _b, time) => times.push(time));

    tick();
    const beforeCount = times.length;
    engine.setClockBpm(240);
    ctx.currentTime += 0.5;
    tick();

    const after = times.slice(beforeCount);
    expect(after.length).toBeGreaterThan(1);
    for (let i = 1; i < after.length; i++) {
      expect(after[i] - after[i - 1]).toBeCloseTo(stepDurationSec(240), 9);
    }
  });

  test('setClockBpm clamps out-of-range input instead of producing a 0-length step', () => {
    const { engine } = clockEngine();
    engine.setClockBpm(0);
    expect((engine as any).clockBpm).toBe(20);
    engine.setClockBpm(9999);
    expect((engine as any).clockBpm).toBe(300);
    engine.setClockBpm(Number.NaN);
    expect((engine as any).clockBpm).toBe(120);
  });

  test('a stall re-anchors the schedule instead of bursting every missed step', () => {
    const { engine, ctx, tick } = clockEngine();
    const times: number[] = [];
    engine.subscribeClock((_s, _b, time) => times.push(time));

    tick();
    const beforeCount = times.length;
    ctx.currentTime += 30; // tab backgrounded for 30 s
    tick();

    const burst = times.length - beforeCount;
    // 30 s at 120 bpm is 240 steps; a re-anchor emits only the lookahead window.
    expect(burst).toBeLessThan(10);
    expect(times[times.length - 1]).toBeGreaterThan(ctx.currentTime);
  });

  test('the metronome downbeat lands on STEPS_PER_BAR, not a hardcoded 16', () => {
    const { engine, ctx, tick } = clockEngine();
    const downbeats: number[] = [];
    (engine as any).playMetronomeClick = (isDownbeat: boolean, time: number) => {
      if (isDownbeat) downbeats.push(time);
    };
    engine.setMetronomeEnabled(true);

    for (let i = 0; i < 40; i++) {
      tick();
      ctx.currentTime += 0.25;
    }

    expect(downbeats.length).toBeGreaterThan(1);
    const barSec = stepDurationSec(120) * STEPS_PER_BAR;
    for (let i = 1; i < downbeats.length; i++) {
      expect(downbeats[i] - downbeats[i - 1]).toBeCloseTo(barSec, 6);
    }
    (engine as any).stopClockTimer();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/clock.test.ts`
Expected: FAIL — the throwing-listener tests hang/throw out of `clockTick`, and `setClockBpm(NaN)` leaves `clockBpm` as `NaN`.

- [ ] **Step 3: Fix `clockTick` and `setClockBpm`**

Replace `setClockBpm` (engine.ts:155-157):

```ts
  setClockBpm(bpm: number): void {
    this.clockBpm = clampBpm(bpm);
  }
```

Replace `clockTick` (engine.ts:185-202):

```ts
  private clockTick(): void {
    if (!this.ctx) return;
    // Resync after stalls or initial start instead of bursting missed steps
    if (this.clockNextStepTime < this.ctx.currentTime - 0.05) {
      this.clockNextStepTime = this.ctx.currentTime + AudioEngine.CLOCK_REANCHOR_DELAY;
    }
    const stepDuration = stepDurationSec(this.clockBpm);
    while (this.clockNextStepTime < this.ctx.currentTime + AudioEngine.CLOCK_LOOKAHEAD) {
      const time = this.clockNextStepTime;
      const step = this.clockStepIndex;
      // Advance BEFORE dispatching. A listener that throws must not leave the
      // grid parked on the step it threw on — the 25 ms interval would then
      // re-dispatch and re-throw the same step forever and the whole transport
      // would be frozen, not just the broken listener.
      this.clockNextStepTime += stepDuration;
      this.clockStepIndex++;

      if (this.metronomeEnabled && step % 4 === 0) {
        this.playMetronomeClick(step % STEPS_PER_BAR === 0, time);
      }
      // One listener's failure is isolated: every other subscriber still gets
      // this step. Logged rather than swallowed so the fault is findable.
      this.clockListeners.forEach((fn) => {
        try {
          fn(step, Math.floor(step / 4), time);
        } catch (err) {
          console.error('[audioEngine] clock listener threw; continuing', err);
        }
      });
    }
  }
```

Add `clampBpm` to the musicTheory import on engine.ts:2:

```ts
import { noteFrequency, clampBpm, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/audio/clock.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing store test**

Create `src/store/transportSlice.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { MAX_BPM, MIN_BPM } from '../utils/musicTheory';

describe('setBpm clamping', () => {
  test('an empty BPM input (0) cannot reach the store', () => {
    // The BPM field is `type="number"`; clearing it yields 0. Unclamped, every
    // playback hook derives its step duration from the raw store bpm and
    // schedules note-offs minutes away — the note-drone bug.
    useAppStore.getState().setBpm(0);
    expect(useAppStore.getState().bpm).toBe(MIN_BPM);
  });

  test('clamps to the same range the engine clock uses', () => {
    useAppStore.getState().setBpm(9999);
    expect(useAppStore.getState().bpm).toBe(MAX_BPM);
    useAppStore.getState().setBpm(128);
    expect(useAppStore.getState().bpm).toBe(128);
    useAppStore.getState().setBpm(Number.NaN);
    expect(useAppStore.getState().bpm).toBe(120);
    useAppStore.getState().setBpm(120);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test src/store/transportSlice.test.ts`
Expected: FAIL — `bpm` is `0`, not `20`.

- [ ] **Step 7: Clamp in the slice**

`src/store/transportSlice.ts` — add the import at the top:

```ts
import { clampBpm } from '../utils/musicTheory';
```

Replace line 88:

```ts
    // Clamped with the same bounds engine.setClockBpm uses. The store is the
    // value every playback hook reads for its own step math, so an unclamped 0
    // from a cleared number input would drone notes even though the engine
    // clock itself is safe.
    setBpm: (bpm) => set({ bpm: clampBpm(bpm) }),
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test src/store/transportSlice.test.ts && bun test src/store/`
Expected: PASS

- [ ] **Step 9: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/engine.ts src/audio/clock.test.ts src/store/transportSlice.ts src/store/transportSlice.test.ts
git commit -m "fix(audio): isolate clock listener faults and clamp bpm in the store"
```

---

### Task 3: Effect parameter clamping and honest master staging

**Why:** `updateEffects` (engine.ts:1091-1116) applies every value straight onto an `AudioParam`. `sanitizePersistedState` (store.ts:218-227) clamps only `reverbDecay` and `compressorThreshold`, so a persisted or imported project with `delayFeedback >= 1` produces runaway feedback into the limiter. Separately, `setupMasterChain` sets `masterGain.gain.value = 0.6` with a comment calling it a "-4.4 dB staging ceiling" (engine.ts:212-216) — but `engineSync.ts:49` pushes `masterVolume` (default `0.85`, transportSlice.ts:76) with `fireImmediately`, so `0.6` never holds for even one render. The comment is a lie about the running system.

**Decision on the staging gain:** delete the false `0.6` and its comment; seed `masterGain` at `1.0` and document that `setMasterVolume` is the only master trim and the `-3 dB` ratio-20 limiter (engine.ts:234-239) is the ceiling. The alternative — inserting a *real* fixed `0.6` staging gain after `masterGain` — would make the whole app 4.4 dB quieter for zero correctness gain, since the compressor and limiter already own the safety net. Correctness here means removing the misleading dead value, not honouring it.

**No sound change.** `0.6` never took effect, so seeding `1.0` is inaudible.

**Files:**
- Create: `src/audio/effectLimits.ts`
- Modify: `src/audio/engine.ts:212-216` (masterGain), `:1091-1116` (`updateEffects`)
- Modify: `src/store/store.ts:218-227` (sanitize)
- Modify: `src/audio/engine.test.ts:628-654` (the `0.6` assertion)
- Modify: `.claude/skills/dsp-audio/SKILL.md` (the signal-graph block, line 61, and the "Key consequences" bullet at line 73)

**Interfaces:**
- Consumes: `src/types.ts`'s `MasterEffects`.
- Produces: `src/audio/effectLimits.ts`
  - `export const EFFECT_LIMITS: Record<EffectNumericKey, { min: number; max: number; fallback: number }>`
  - `export type EffectNumericKey = 'reverbWet' | 'reverbDecay' | 'delayWet' | 'delayFeedback' | 'distortionWet' | 'eqLow' | 'eqMid' | 'eqHigh' | 'compressorThreshold'`
  - `export function clampEffectValue(key: EffectNumericKey, value: unknown): number`
  - `export function clampEffects(fx: MasterEffects): MasterEffects`

- [ ] **Step 1: Write the failing test**

Append to `src/audio/engine.test.ts`, inside the existing `describe('live effect knobs', ...)` block (it ends at line 742):

```ts
  test('updateEffects clamps every numeric field before it reaches an AudioParam', () => {
    const { engine, ctx } = freshEngine();
    const delayFeedbackGain = fakeNode();
    const delayGain = fakeNode();
    const reverbGain = fakeNode();
    const eqLowNode = fakeNode();
    (engine as any).delayFeedbackGain = delayFeedbackGain;
    (engine as any).delayGain = delayGain;
    (engine as any).reverbGain = reverbGain;
    (engine as any).eqLowNode = eqLowNode;

    engine.updateEffects({
      ...INITIAL_EFFECTS,
      // A persisted or imported project can carry anything.
      delayFeedback: 1.4,   // >= 1 is a runaway feedback loop
      reverbWet: 12,
      delayWet: -3,
      eqLow: 400,
    });

    expect(delayFeedbackGain.gain.targets.at(-1)!.v).toBe(0.95);
    expect(reverbGain.gain.targets.at(-1)!.v).toBe(1);
    expect(delayGain.gain.targets.at(-1)!.v).toBe(0);
    expect(eqLowNode.gain.targets.at(-1)!.v).toBe(24);
    expect(ctx.currentTime).toBe(10);
  });

  test('a non-finite persisted value falls back instead of writing NaN to a param', () => {
    const { engine } = freshEngine();
    const reverbGain = fakeNode();
    (engine as any).reverbGain = reverbGain;

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbWet: Number.NaN });

    expect(Number.isFinite(reverbGain.gain.targets.at(-1)!.v)).toBe(true);
    expect(reverbGain.gain.targets.at(-1)!.v).toBe(0.25);
  });

  test('bypass still wins over the clamped value', () => {
    const { engine } = freshEngine();
    const reverbGain = fakeNode();
    (engine as any).reverbGain = reverbGain;

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbWet: 12, reverbBypass: true });

    expect(reverbGain.gain.targets.at(-1)!.v).toBe(0);
  });
```

And replace the `masterGain` assertion at `engine.test.ts:628-654`. Change the test name and the first expectation:

```ts
  test('seeds masterGain at unity and inserts a ratio-20 limiter between masterGain and the analyser', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const compressor = (engine as any).compressor;

    // masterGain is the user's master trim and nothing else: engineSync pushes
    // masterVolume with fireImmediately, so any "staging" value seeded here is
    // overwritten before the first frame. The -3 dB limiter is the real ceiling.
    expect(masterGain.gain.value).toBe(1);
    expect(limiter).toBeDefined();
    if (!limiter) return;
    // ... rest of the assertions unchanged (lines 643-653)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/engine.test.ts`
Expected: FAIL — `delayFeedbackGain.gain.targets.at(-1).v` is `1.4`, and `masterGain.gain.value` is `0.6`.

- [ ] **Step 3: Create `src/audio/effectLimits.ts`**

```ts
import type { MasterEffects } from '../types';

/**
 * The single source of truth for every numeric MasterEffects range.
 *
 * Two places need it and used to disagree: engine.updateEffects wrote raw
 * values onto AudioParams, and store.sanitizePersistedState clamped only two
 * fields. A persisted project with delayFeedback >= 1 is a runaway feedback
 * loop into the limiter — the audible failure that motivated this table.
 *
 * `fallback` is what a non-finite or non-numeric persisted value becomes; it
 * equals INITIAL_EFFECTS for every key.
 */
export type EffectNumericKey =
  | 'reverbWet'
  | 'reverbDecay'
  | 'delayWet'
  | 'delayFeedback'
  | 'distortionWet'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'compressorThreshold';

export const EFFECT_LIMITS: Record<
  EffectNumericKey,
  { min: number; max: number; fallback: number }
> = {
  reverbWet: { min: 0, max: 1, fallback: 0.25 },
  // Decay is the impulse's DURATION in seconds (see engine.buildImpulseResponse).
  // 10 s is far past the UI knob's 6 s ceiling but keeps an imported project
  // usable instead of silently retuned.
  reverbDecay: { min: 0.1, max: 10, fallback: 2.0 },
  delayWet: { min: 0, max: 1, fallback: 0.2 },
  // 0.95 rather than 1: at 1 the feedback loop never decays.
  delayFeedback: { min: 0, max: 0.95, fallback: 0.35 },
  distortionWet: { min: 0, max: 1, fallback: 0.1 },
  eqLow: { min: -24, max: 24, fallback: 2 },
  eqMid: { min: -24, max: 24, fallback: 0 },
  eqHigh: { min: -24, max: 24, fallback: 3 },
  compressorThreshold: { min: -60, max: 0, fallback: -12 },
};

export function clampEffectValue(key: EffectNumericKey, value: unknown): number {
  const { min, max, fallback } = EFFECT_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** A copy of `fx` with every numeric field inside its range. Booleans pass through. */
export function clampEffects(fx: MasterEffects): MasterEffects {
  const out = { ...fx };
  for (const key of Object.keys(EFFECT_LIMITS) as EffectNumericKey[]) {
    out[key] = clampEffectValue(key, fx[key]);
  }
  return out;
}
```

- [ ] **Step 4: Apply it in `updateEffects` and drop the false staging value**

`src/audio/engine.ts` — add to the imports:

```ts
import { clampEffects } from './effectLimits';
```

Replace lines 1091-1099 (the head of `updateEffects`):

```ts
  updateEffects(raw: MasterEffects): void {
    if (!this.ctx) return;
    // Clamp before anything touches an AudioParam. A persisted or imported
    // project is untrusted input: delayFeedback >= 1 is a runaway loop and a
    // non-finite value writes NaN into the graph, which silences it permanently.
    const fx = clampEffects(raw);
    const reverbWet = fx.reverbBypass ? 0 : fx.reverbWet;
    const delayWet = fx.delayBypass ? 0 : fx.delayWet;
    const delayFeedback = fx.delayBypass ? 0 : fx.delayFeedback;
    const distortionWet = fx.distortionBypass ? 0 : fx.distortionWet;
    const eqLow = fx.eqBypass ? 0 : fx.eqLow;
    const eqMid = fx.eqBypass ? 0 : fx.eqMid;
    const eqHigh = fx.eqBypass ? 0 : fx.eqHigh;
```

Lines 1100-1116 are unchanged (they already read from `fx`).

Replace lines 212-216:

```ts
    // Master output & analyser. masterGain is the USER's master trim and
    // nothing else: engineSync subscribes masterVolume with fireImmediately,
    // so it is overwritten before the first frame — a "staging ceiling" seeded
    // here would be a comment describing a value that never applies. Headroom
    // is owned by the compressor (-12 dB, 4:1) and the limiter (-3 dB, 20:1).
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
```

- [ ] **Step 5: Extend `sanitizePersistedState` to use the same table**

`src/store/store.ts` — add the import:

```ts
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
```

Replace lines 218-227 (the `// Task 14:` block):

```ts
  // Every numeric MasterEffects field is clamped through the SAME table the
  // engine uses (audio/effectLimits.ts), so the two can no longer drift — the
  // old code clamped only reverbDecay and compressorThreshold and let a
  // persisted delayFeedback of 1.2 through to a runaway feedback loop.
  // The ternary above can hand back the SHARED INITIAL_EFFECTS constant —
  // clone before writing so the module constant is never mutated.
  const fxClamped = sanitized.effects as Record<string, unknown> | undefined;
  if (fxClamped && typeof fxClamped === 'object') {
    if (sanitized.effects === INITIAL_EFFECTS) sanitized.effects = { ...INITIAL_EFFECTS };
    const fxWritable = sanitized.effects as Record<string, unknown>;
    for (const key of Object.keys(EFFECT_LIMITS) as EffectNumericKey[]) {
      fxWritable[key] = clampEffectValue(key, fxWritable[key]);
    }
  }
```

- [ ] **Step 6: Run the tests**

Run: `bun test src/audio/engine.test.ts src/store/store.test.ts`
Expected: PASS. If a `store.test.ts` case asserted the old `reverbDecay` floor of `0.5`, update it to `0.1` and note in the test that the floor moved because decay is now a duration.

- [ ] **Step 7: Update the skill doc**

`.claude/skills/dsp-audio/SKILL.md`:
- Line 61 of the signal graph: change `-> masterGain (0.6 staging ceiling)` to `-> masterGain (user master trim, setMasterVolume)`.
- Line 73 bullet: replace `- \`masterGain = 0.6\` is deliberate headroom; \`setMasterVolume()\` clamps to 0..1.` with:
  `- \`masterGain\` is the user's master trim only (\`setMasterVolume()\`, clamped 0..1, seeded at unity). Headroom is the compressor (-12 dB, 4:1) and the limiter (-3 dB, 20:1); there is no separate staging gain.`
- Add a bullet under "Key consequences": `- Every numeric \`MasterEffects\` value is clamped by \`src/audio/effectLimits.ts\` in BOTH \`updateEffects()\` and \`store.sanitizePersistedState\`. Add a new effect's range there, not inline.`
- Update the "Adding a new effect" recipe (SKILL.md:106-119) with a new step between 1 and 2: `1b. \`src/audio/effectLimits.ts\`: add the field's \`{ min, max, fallback }\` to \`EFFECT_LIMITS\`.`

- [ ] **Step 8: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/effectLimits.ts src/audio/engine.ts src/audio/engine.test.ts src/store/store.ts .claude/skills/dsp-audio/SKILL.md
git commit -m "fix(audio): clamp every master effect value through one shared table"
```

---

### Task 4: Reverb decay is a duration, with a quantised impulse cache

**Why:** `buildImpulseResponse(duration, decay)` (engine.ts:325-339) uses `decay` as the **exponent** in `Math.pow(n / length, decay)`. `updateEffects` calls it as `this.buildImpulseResponse(2.0, fx.reverbDecay)` (engine.ts:1102), pinning the duration at 2.0 s and feeding the user's knob into the curve shape. The UI knob (`EffectsRackView.tsx:75-85`) is labelled `${v.toFixed(1)}s` over `0.5..6.0` — so the control is inverted (a *higher* "decay" makes a *steeper*, hence *shorter*-sounding tail) and hard-capped at 2 s of actual tail. Second problem: the IR is rebuilt synchronously on the main thread for every distinct value, so one knob drag runs ~55 rebuilds of `2 × 88200` `Math.random()` + `Math.pow()` calls and swaps `convolver.buffer` mid-tail — clicks plus a dropped-frame stutter.

**THIS CHANGES THE SOUND.** Reverb tails become correct and much longer: the Decay knob at 6.0 now produces a 6-second impulse instead of a 2-second one shaped by a `pow(x, 6)` curve. Every project's reverb will sound bigger. That is the intended fix.

**Files:**
- Modify: `src/audio/engine.ts:51-55` (fields), `:204-311` (`setupMasterChain` — cache invalidation + the initial IR), `:325-339` (`buildImpulseResponse`), `:1101-1104` (`updateEffects`)
- Modify: `src/audio/engine.test.ts:711-730` (the existing rebuild test asserts `toHaveBeenCalledWith(2.0, 4.5)`)

**Interfaces:**
- Consumes: `EFFECT_LIMITS.reverbDecay` (Task 3) — the `0.1..10` bound.
- Produces: private `quantiseDecay(decay: number): number` and `getImpulseResponse(decay: number): AudioBuffer` on `AudioEngine`; `buildImpulseResponse(durationSec: number, curve: number)` keeps its two-number signature but the **argument order at the call site is now `(decay, 2.0)`**.

- [ ] **Step 1: Write the failing test**

Replace the existing test at `src/audio/engine.test.ts:711-730` and add three more inside `describe('live effect knobs', ...)`:

```ts
  test('reverbDecay is the impulse DURATION, with the curve exponent fixed', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });

    // (durationSec, curveExponent) — the UI knob reads "4.5s", so 4.5 must be
    // the length of the tail, not the steepness of it.
    expect(buildSpy).toHaveBeenCalledWith(4.5, 2.0);
  });

  test('unchanged decay does not rebuild the impulse', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 2.0 });
    expect(buildSpy).not.toHaveBeenCalled(); // equals the impulse setupMasterChain built
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  test('a knob drag quantises to 0.1 s and reuses cached impulses', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    // A real drag emits dozens of intermediate values. Quantising to the knob's
    // own 0.1 step collapses them; revisiting a value must hit the cache.
    for (const d of [3.0, 3.04, 3.02, 3.1, 3.14, 3.0, 3.1]) {
      engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: d });
    }

    expect(buildSpy).toHaveBeenCalledTimes(2); // 3.0 and 3.1 only
    expect(buildSpy.mock.calls.map((c) => c[0])).toEqual([3.0, 3.1]);
  });

  test('an out-of-range decay is clamped before it becomes a buffer length', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: -5 });
    expect(buildSpy).toHaveBeenCalledWith(0.1, 2.0);
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 900 });
    expect(buildSpy).toHaveBeenLastCalledWith(10, 2.0);
  });
```

Also add, to `describe('master chain', ...)`:

```ts
  test('rebuilding the master chain drops impulses built against the dead context', () => {
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();
    (engine as any).impulseCache.set(9.9, {} as AudioBuffer);

    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    // An AudioBuffer belongs to the context that created it; reusing one from
    // the previous context is the same class of bug sourceBuses.clear() prevents.
    expect((engine as any).impulseCache.has(9.9)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/engine.test.ts -t "reverb"`
Expected: FAIL — `toHaveBeenCalledWith(4.5, 2.0)` sees `(2.0, 4.5)`; `impulseCache` is undefined.

- [ ] **Step 3: Add the cache fields and rename the builder's parameters**

`src/audio/engine.ts` — replace the field block at lines 51-55:

```ts
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  // Last decay applied to the convolver, already quantised. Guards against
  // re-randomizing the reverb tail on every updateEffects call.
  private reverbDecay = 2.0;
  // Impulse responses keyed by quantised decay. Building one is
  // sampleRate * decay * 2 channels of Math.random() + Math.pow() on the main
  // thread; a single knob drag emits ~55 distinct values, so without this a
  // drag drops frames AND swaps convolver.buffer mid-tail (audible clicks).
  // Cleared in setupMasterChain: an AudioBuffer belongs to its context.
  private impulseCache = new Map<number, AudioBuffer>();
```

Replace `buildImpulseResponse` (lines 325-339):

```ts
  /**
   * A synthesized reverb impulse: `durationSec` of decaying noise shaped by
   * `curve`.
   *
   * `curve` is the exponent in pow(n / length, curve) and is NOT the user's
   * Decay knob — it stays fixed at 2.0. The knob is `durationSec`. Feeding the
   * knob into the exponent (as this used to be called) inverts the control: a
   * higher value steepens the envelope, so a "6.0 s" setting sounded SHORTER
   * than a "1.0 s" one, and the real tail was pinned at 2 s either way.
   */
  private buildImpulseResponse(durationSec: number, curve: number): AudioBuffer {
    if (!this.ctx) return new AudioBuffer({ length: 1, numberOfChannels: 2, sampleRate: 44100 });
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = length - i;
      left[i] = (Math.random() * 2 - 1) * Math.pow(n / length, curve);
      right[i] = (Math.random() * 2 - 1) * Math.pow(n / length, curve);
    }
    return impulse;
  }

  /** The knob's own resolution (EffectsRackView's Decay step is 0.1). */
  private quantiseDecay(decay: number): number {
    const { min, max } = EFFECT_LIMITS.reverbDecay;
    const clamped = Number.isFinite(decay) ? Math.min(max, Math.max(min, decay)) : 2.0;
    return Math.round(clamped * 10) / 10;
  }

  /** Cached impulse for a quantised decay, built on first use. */
  private getImpulseResponse(quantisedDecay: number): AudioBuffer {
    const cached = this.impulseCache.get(quantisedDecay);
    if (cached) return cached;
    const built = this.buildImpulseResponse(quantisedDecay, AudioEngine.REVERB_CURVE);
    this.impulseCache.set(quantisedDecay, built);
    return built;
  }
```

Add the class constant next to the other statics (engine.ts:101-103):

```ts
  private static readonly REVERB_CURVE = 2.0; // impulse envelope exponent; not user-facing
```

Add the import for `EFFECT_LIMITS` on the `effectLimits` import line added in Task 3:

```ts
import { EFFECT_LIMITS, clampEffects } from './effectLimits';
```

- [ ] **Step 4: Wire it into `setupMasterChain` and `updateEffects`**

In `setupMasterChain`, right after `this.sourceBuses.clear();` (engine.ts:210) add:

```ts
    // An AudioBuffer belongs to the context that created it, so impulses built
    // against the previous context must not survive into the new graph.
    this.impulseCache.clear();
    this.reverbDecay = 2.0;
```

Replace line 292:

```ts
    this.reverbNode.buffer = this.getImpulseResponse(2.0);
```

Replace lines 1101-1104 of `updateEffects`:

```ts
    const nextDecay = this.quantiseDecay(fx.reverbDecay);
    if (this.reverbNode && nextDecay !== this.reverbDecay) {
      this.reverbNode.buffer = this.getImpulseResponse(nextDecay);
      this.reverbDecay = nextDecay;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS

- [ ] **Step 6: Update the skill doc**

`.claude/skills/dsp-audio/SKILL.md`, replace the last "Key consequences" bullet (lines 74-76) with:

```
- Bypass flags are applied in `updateEffects()` by forcing the wet/gain value to 0, not by
  rewiring. `reverbDecay` is the impulse **duration in seconds** (the curve exponent is a fixed
  2.0); changes are quantised to 0.1 s and the built `AudioBuffer`s are cached in
  `impulseCache`, which `setupMasterChain()` clears because a buffer belongs to its context.
```

- [ ] **Step 7: Listen**

Run: `bun run dev`, open the Effects tab, play a chord loop and sweep the Reverb Decay knob from 0.5 to 6.0. Confirm: the tail gets *longer* as the number rises, there are no clicks mid-sweep, and the UI stays responsive. Note in the commit body that the default 2.0 s sound is unchanged (the exponent used to be 2.0 by coincidence at that value).

- [ ] **Step 8: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/engine.ts src/audio/engine.test.ts .claude/skills/dsp-audio/SKILL.md
git commit -m "fix(audio): treat reverbDecay as impulse duration and cache built impulses

The Decay knob is labelled in seconds but was passed as the pow() exponent
while the duration stayed pinned at 2.0 s, so the control was inverted and
capped. Decay is now the duration with a fixed 2.0 curve. This makes reverb
tails longer and is an intended change in sound."
```

---

### Task 5: Synth envelope correctness — cancel ordering, voice selection, envelope markers

**Why:** Six separate defects in the note-on / live-update path, all cheap and all in the same neighbourhood:

1. `applySynthVelocityScale` (engine.ts:645-647) does `gain.cancelScheduledValues(now)` then reads `gain.value`. Per spec, `cancelScheduledValues` **deletes** the in-flight ramp, so the value reverts to the last surviving event — `0.0001` for a voice still in its attack. It then anchors the rebalance there: exactly the click the file's own `cancelAndHold` helper (engine.ts:721-728) exists to prevent.
2. `applySynthVelocityScale` (engine.ts:635) iterates `activeVoices`, but `updateSynthParams` (engine.ts:794-796) deliberately iterates `sourceVoices` with a comment explaining that `activeVoices` misses a still-sounding voice evicted by a same-note retrigger. The two must agree.
3. `cancelAndHold` (engine.ts:721-727) evaluates `fallbackValue ?? param.value` **after** `cancelScheduledValues(now)`, so the Firefox path reads the post-revert value — the fallback is exactly the case where the value matters.
4. `ampEnvEndsAt` / `filterEnvEndsAt` (engine.ts:496-497) are computed from the raw `params.attack` / `params.filterAttack`, while the ramps at lines 427 and 437 use `Math.max(0.01, …)` / `Math.max(0.005, …)`. `INITIAL_SYNTH_PARAMS` has `attack: 0.02`, but `synthPresets.ts` ships patches with `attack: 0.002`, so the marker lands *before* the ramp really ends and `releaseVoice`'s `now >= voice.ampEnvEndsAt` branch (engine.ts:559) takes the wrong path — anchoring at the sustain level while the attack ramp is still climbing.
5. The same-note dedup (engine.ts:404) calls `triggerSynthNoteOff(noteName, 0.3, undefined, source)` without forwarding `time`, so a *scheduled* repeat cuts the previous voice at `currentTime` instead of at `time` — a gap of up to the 100 ms lookahead. The bass path one block above (engine.ts:394) does forward it.
6. `Math.min(20000, Math.max(20, …))` is written at engine.ts:425, 426, 566, 568, 570, and the filter sustain-cutoff formula is duplicated at engine.ts:426 and 786-789. `createNoiseNodes(Number.MIN_VALUE, …)` (engine.ts:1068) passes a denormal purely to slip past its own `level <= 0` guard. Lines 606-611 contain the same 3-line comment twice.

**No intended sound change** — every fix removes a click or a wrong-branch, none retunes anything.

**Files:**
- Modify: `src/audio/engine.ts:404`, `:418-438`, `:496-497`, `:566-570`, `:606-616`, `:632-650`, `:721-728`, `:781-796`, `:1044-1073`
- Modify: `src/audio/engine.test.ts` (new cases)

**Interfaces:**
- Consumes: `clampCutoff`, `ENV_FLOOR`, `SILENCE` from `src/audio/constants` (Task 1).
- Produces on `AudioEngine`:
  - `private filterEnvLevels(params: SynthParams): { peak: number; sustain: number }`
  - `private reshapeableVoices(source?: string): SynthVoice[]` — every tracked voice of the source that has started and is not already fading.
  - `createNoiseNodes(level, target, startAt)` gains an explicit `initialLevel` parameter: `private createNoiseNodes(level: number, target: AudioNode, startAt: number, initialLevel = level)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/audio/engine.test.ts`:

```ts
describe('envelope-safe rebalancing', () => {
  test('a velocity rebalance during the attack holds the real curve value, not the floor', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Attack is 0.02 s; rebalance 0.01 s in, halfway up the ramp.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth');
    ctx.currentTime = t0 + 0.01;
    (engine as any).applySynthVelocityScale(0.5);

    const gain = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    const anchor = gain.events.find((e: any) => e.t === t0 + 0.01);
    expect(anchor).toBeTruthy();
    // cancelScheduledValues would revert to the 0.0001 note-on floor and the
    // rebalance would then glide up from silence: an audible click.
    expect(anchor.v).toBeGreaterThan(0.0001);
  });

  test('a rebalance reaches a sounding voice a same-note retrigger evicted from the dedup map', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Two hits of the same note; the first is still sounding but its release is
    // planned, so activeVoices now points at the second voice only.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');

    const tracked = Array.from((engine as any).sourceVoices.get('chord')) as any[];
    expect(tracked).toHaveLength(2);

    (engine as any).applySynthVelocityScale(0.5);

    // updateSynthParams already iterates sourceVoices for exactly this reason;
    // the rebalance must use the same set or one layer stays at the old level.
    const rescaled = tracked.filter((v) => v.envelopeScale === 0.5);
    expect(rescaled.length).toBeGreaterThan(0);
  });
});

describe('cancelAndHold fallback (Firefox)', () => {
  test('the fallback reads the value BEFORE the cancel reverts it', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const param = fakeParam({ cancelAndHold: false });
    param.setValueAtTime(0.9, ctx.currentTime - 1);
    param.value = 0.9;

    (engine as any).cancelAndHold(param, ctx.currentTime);

    // cancelScheduledValues drops events at/after `now` and can move .value;
    // capturing it first is the whole point of the fallback.
    expect(param.events.at(-1)!.v).toBe(0.9);
  });
});

describe('envelope end markers', () => {
  test('a sub-millisecond attack marks the end of the CLAMPED ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    // synthPresets ships attack: 0.002, below the 0.005 floor the ramp uses.
    const fast = { ...SYNTH, attack: 0.002, decay: 0.4, filterAttack: 0.002, filterDecay: 0.4 };

    engine.triggerSynthNoteOn('C4', fast, 0.8, t0, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // The ramp ends at t0 + max(0.005, 0.002) + 0.4; a marker computed from the
    // raw 0.002 lands 3 ms early and sends releaseVoice down the wrong branch.
    expect(voice.ampEnvEndsAt).toBeCloseTo(t0 + 0.005 + 0.4, 9);
    expect(voice.filterEnvEndsAt).toBeCloseTo(t0 + 0.01 + 0.4, 9);
  });
});

describe('scheduled same-note dedup', () => {
  test('a scheduled repeat cuts the previous voice at the new note start, not at currentTime', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth');
    const first = (engine as any).activeVoices.get('synth:C4');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'synth');

    // The bass path at engine.ts:394 forwards `time`; this one did not, so the
    // old voice was cut up to a full 100 ms lookahead before the new one began.
    expect(first.releaseScheduledAt).toBe(t0 + 0.5);
  });
});

describe('noise source initial level', () => {
  test('adding noise to a live voice starts from an explicit floor, not a denormal', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0 }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noiseGain).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.4 }, 'synth');

    expect(voice.noiseGain).toBeTruthy();
    // Number.MIN_VALUE (5e-324) is a denormal used only to slip past the
    // `level <= 0` guard; the initial level is now a named parameter.
    expect(voice.noiseGain.gain.value).toBe(0.0001);
    expect(voice.noiseGain.gain.targets.at(-1)!.v).toBe(0.4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/audio/engine.test.ts`
Expected: FAIL on all five new describes.

- [ ] **Step 3: Fix `cancelAndHold` (engine.ts:721-728)**

```ts
  private cancelAndHold(param: AudioParam, now: number, fallbackValue?: number): void {
    // Read the value BEFORE cancelling: cancelScheduledValues deletes the
    // in-flight ramp, so param.value reverts to the last surviving event and
    // the fallback would anchor at the wrong level — usually the note-on floor.
    const held = fallbackValue ?? param.value;
    try {
      param.cancelAndHoldAtTime(now);
    } catch {
      param.cancelScheduledValues(now);
      param.setValueAtTime(held, now);
    }
  }
```

- [ ] **Step 4: Add the shared filter/voice helpers**

Insert after `cancelAndHold`:

```ts
  /**
   * The VCF envelope's two levels. Written once here because note-on
   * (triggerSynthNoteOn) and the live knob path (updateSynthParams) must agree
   * on the sustain cutoff — a release anchors to it, so a drifted copy makes
   * the filter jump at note-off.
   */
  private filterEnvLevels(params: SynthParams): { peak: number; sustain: number } {
    return {
      peak: clampCutoff(params.filterCutoff + params.filterEnvAmount),
      sustain: clampCutoff(params.filterCutoff + params.filterEnvAmount * params.filterSustain),
    };
  }

  /**
   * Every tracked voice of `source` (or all sources) that can be re-shaped
   * right now: it has started, and it is not already fading.
   *
   * Iterates sourceVoices, not activeVoices: activeVoices only keeps the
   * LATEST voice per note, so a still-sounding voice that a same-note retrigger
   * evicted would be skipped and left at the old level.
   */
  private reshapeableVoices(source?: string): SynthVoice[] {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    const sets = source
      ? [this.sourceVoices.get(source) ?? new Set<SynthVoice>()]
      : Array.from(this.sourceVoices.values());
    const out: SynthVoice[] = [];
    for (const set of sets) {
      for (const voice of set) {
        // Voices scheduled ahead keep the envelopes they were planned with;
        // re-targeting them cancels their scheduled ramps, release included.
        if (voice.startTime > now) continue;
        // A voice already in its release tail keeps the ramp it was given.
        if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt <= now) continue;
        out.push(voice);
      }
    }
    return out;
  }
```

Add to the constants import on engine.ts:3:

```ts
import { DEFAULT_VELOCITY, ENV_FLOOR, SILENCE, clampCutoff } from './constants';
```

- [ ] **Step 5: Use the helpers in `triggerSynthNoteOn` (engine.ts:418-438, 496-497)**

Replace lines 424-438:

```ts
    // Filter Envelope (VCF ADSR). The ramps use a floored attack, so the
    // "envelope has reached sustain" marker below must use the SAME floored
    // value — synthPresets ships attack: 0.002, under both floors, and a marker
    // computed from the raw value lands before the ramp ends, sending a release
    // inside that window down releaseVoice's past-the-envelope branch.
    const attack = Math.max(0.005, params.attack);
    const filterAttack = Math.max(0.01, params.filterAttack);
    const { peak: filterPeak, sustain: filterSustainLevel } = this.filterEnvLevels(params);
    filter.frequency.exponentialRampToValueAtTime(filterPeak, now + filterAttack);
    filter.frequency.exponentialRampToValueAtTime(filterSustainLevel, now + filterAttack + params.filterDecay);

    // Amplitude Envelope
    const gainNode = this.ctx.createGain();
    const subGain = this.ctx.createGain();
    subGain.gain.value = params.subOscVolume;

    const peakGain = velocity * 0.4 * scaleFactor;
    gainNode.gain.setValueAtTime(ENV_FLOOR, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), now + attack);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(ENV_FLOOR, peakGain * params.sustain), now + attack + params.decay);
```

Replace lines 496-497 inside the `voice` literal:

```ts
      ampEnvEndsAt: now + attack + params.decay,
      filterEnvEndsAt: now + filterAttack + params.filterDecay,
```

Replace line 404 (the dedup):

```ts
      this.triggerSynthNoteOff(noteName, 0.3, time, source);
```

- [ ] **Step 6: Use `clampCutoff` / `ENV_FLOOR` / `SILENCE` in `releaseVoice` (engine.ts:549-570)**

- Line 549-551: `Math.max(0.0001, …)` → `Math.max(ENV_FLOOR, …)` (both branches).
- Line 560: `Math.max(0.0001, voice.sustainLevel)` → `Math.max(ENV_FLOOR, voice.sustainLevel)`.
- Line 562: `exponentialRampToValueAtTime(0.00001, …)` → `exponentialRampToValueAtTime(SILENCE, …)`.
- Line 566: `Math.max(20, voice.filter.frequency.value)` → `clampCutoff(voice.filter.frequency.value)`.
- Line 568: `Math.max(20, voice.filterSustainCutoff)` → `clampCutoff(voice.filterSustainCutoff)`.
- Line 570: `Math.max(20, voice.filterCutoff)` → `clampCutoff(voice.filterCutoff)`.

- [ ] **Step 7: Delete the duplicated comment and fix `applySynthVelocityScale`**

Delete lines 609-611 (the verbatim repeat of lines 606-608).

Replace `applySynthVelocityScale`'s body (engine.ts:632-650):

```ts
  applySynthVelocityScale(scale: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.reshapeableVoices()) {
      if (voice.releaseScheduledAt !== undefined) continue;
      const factor = scale / voice.envelopeScale;
      if (Math.abs(factor - 1) < 0.001) continue;

      voice.envelopeScale = scale;
      voice.sustainLevel *= factor;
      // peakGain must track the rebalance too: updateSynthParams recomputes
      // the sustain level from it, and an unscaled peak would undo this.
      voice.peakGain *= factor;
      const gain = voice.gains[0].gain;
      // cancelAndHold, not cancelScheduledValues: a voice mid-attack has only
      // the note-on floor as a surviving event, so cancelling would drop the
      // rebalance to 0.0001 and glide back up — a click on every added note.
      this.cancelAndHold(gain.value !== undefined ? gain : gain, now);
      gain.setTargetAtTime(Math.max(ENV_FLOOR, voice.sustainLevel), now, 0.01);
    }
  }
```

> Simplify that penultimate line to `this.cancelAndHold(gain, now);` — the ternary above is a typo guard, not intended code.

- [ ] **Step 8: Use `reshapeableVoices` and `filterEnvLevels` in `updateSynthParams`**

Replace engine.ts:781-805 down to the start of the loop body:

```ts
  updateSynthParams(params: SynthParams, source?: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = 0.03; // smoothing time constant in seconds

    const sustainCutoff = this.filterEnvLevels(params).sustain;

    for (const voice of this.reshapeableVoices(source)) {
      const osc = voice.oscs[0];
```

(The three `continue` guards at lines 800-805 and the `voices` computation at 794-796 are now inside `reshapeableVoices`; delete them.)

Line 842: `Math.max(0.0001, nextSustain)` → `Math.max(ENV_FLOOR, nextSustain)`.

- [ ] **Step 9: Make the noise initial level explicit**

Replace `createNoiseNodes`'s signature and body head (engine.ts:1044-1049):

```ts
  private createNoiseNodes(
    level: number,
    target: AudioNode,
    startAt: number,
    initialLevel: number = level,
  ): Pick<SynthVoice, 'noise' | 'noiseGain'> {
    if (!this.ctx || level <= 0) return {};
    const noise = this.createNoiseNode();
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = initialLevel;
```

(`noise.loop = true` moves into `createNoiseNode` in Task 8; leave it here for now.)

Replace line 1068:

```ts
      // Ramp up from silence so adding the source mid-note doesn't click. The
      // level is ENV_FLOOR rather than Number.MIN_VALUE: the old denormal was
      // there only to slip past the `level <= 0` guard, which is now expressed
      // by passing the real level and a separate starting level.
      Object.assign(voice, this.createNoiseNodes(level, voice.filter, now, ENV_FLOOR));
```

- [ ] **Step 10: Run the tests**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS, including all pre-existing cases (especially `describe('release discontinuity')` and `describe('live Sustain')`).

- [ ] **Step 11: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "fix(audio): hold envelope values on cancel and align voice-selection sets"
```

---

### Task 6: Releasing a voice that has not started yet

**Why:** For a voice with `startTime > now` — routine, since the clock schedules 100 ms ahead — the amp gain's only scheduled event is `setValueAtTime(ENV_FLOOR, startTime)`. `releaseVoice` calls `this.cancelAndHold(mainGain.gain, now, ampFallback)` at engine.ts:552; per spec (and per the harness's `cancelAndHoldAtTime` model at engine.test.ts:47-59, verified against an OfflineAudioContext) **no hold point is inserted when nothing is scheduled at or after `now`** — but here the note-on event IS at `startTime > now`, so the hold *does* land, at the interpolated value. The real failure is upstream of that: `stopSource` (engine.ts:616-625) has **no `startTime` guard at all** and releases future voices exactly like sounding ones, and `releaseSoundingVoices` (engine.ts:665-669) releases a future voice that has no release of its own. In both cases the oscillators still `start(startTime)` afterwards, so the voice sounds *after* its release ramp has already finished — the ramp target `SILENCE` is reached at `now + releaseTime`, long before the note begins, and the GainNode then holds whatever the last event left. Hard-silencing is the only correct treatment for a voice that will never be heard.

Second defect: `updateSynthParams` re-plans a pending release with `params.release` (engine.ts:852), but the voice never stored the release time it was actually released with. The bass mono-kill releases with `0.05` (engine.ts:394) and the same-note dedup with `0.3` (engine.ts:404); a pad patch with `release: 2` silently re-arms both to 2 s, which breaks bass monophony — the "killed" voice keeps ringing for two seconds under the new note.

**Sound change:** yes, and intended — a pop at roughly 3× peak gain disappears from every pattern stop, and bass monophony stops leaking.

**Files:**
- Modify: `src/audio/engine.ts:5-38` (`SynthVoice`), `:515-526`, `:530-604` (`releaseVoice`), `:616-625` (`stopSource`), `:660-670`, `:851-853`
- Modify: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `reshapeableVoices`, `ENV_FLOOR`, `SILENCE` (Task 5).
- Produces:
  - `SynthVoice` gains `releaseTime?: number` — the release actually used, so a re-plan reuses it instead of the current patch's.
  - `private silenceVoiceNow(voice: SynthVoice, now: number): void` — hard-stops a voice that has not started.

- [ ] **Step 1: Write the failing tests**

Append to `src/audio/engine.test.ts`:

```ts
describe('releasing a voice that has not started', () => {
  test('stopSource hard-silences a future voice instead of ramping it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord');
    const voice = (engine as any).activeVoices.get('chord:C4');
    const vca = voice.gains[0].gain;

    engine.stopSource('chord', 0.1);

    // A release RAMP on a voice whose oscillators start at t0 + 0.1 finishes
    // before the note begins; the node then holds its last value and the hit
    // sounds at full level. Hard silence is the only correct treatment.
    expect(vca.events.at(-1)!.v).toBe(0);
    expect(vca.events.at(-1)!.t).toBe(t0);
    expect(vca.ramps).toHaveLength(0);
  });

  test('a future voice is torn down, not left tracked', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord');
    engine.stopSource('chord', 0.1);

    expect((engine as any).sourceVoices.get('chord').size).toBe(0);
    expect((engine as any).activeVoices.has('chord:C4')).toBe(false);
  });

  test('a sounding voice still gets its release ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord');
    const vca = (engine as any).activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.stopSource('chord', 0.1);

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 0.1 });
  });

  test('releaseSoundingVoices hard-silences a future voice with no release of its own', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth');
    const vca = (engine as any).activeVoices.get('synth:C4').gains[0].gain;

    engine.releaseSoundingVoices('synth', 0.1);

    expect(vca.ramps).toHaveLength(0);
    expect(vca.events.at(-1)!.v).toBe(0);
  });

  test('releaseSoundingVoices still leaves a future voice that already has a release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'synth');
    const vca = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    const before = vca.events.length;

    engine.releaseSoundingVoices('synth', 0.1);

    expect(vca.events.length).toBe(before);
  });
});

describe('re-planning a pending release', () => {
  test('a bass mono-kill keeps its 0.05 s release when the patch says 2 s', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const pad = { ...SYNTH, release: 2 };

    engine.triggerSynthNoteOn('C2', pad, 0.8, t0 - 1, 'bass');
    const first = (engine as any).activeVoices.get('bass:C2');
    // The new bass note releases the old one with the mono-kill's 0.05 s.
    engine.triggerSynthNoteOn('E2', pad, 0.8, t0 + 1, 'bass');
    expect(first.releaseTime).toBe(0.05);

    first.gains[0].gain.ramps.length = 0;
    engine.updateSynthParams(pad, 'bass');

    // Re-arming from params.release would stretch the kill to 2 s and let the
    // "stopped" note ring under the new one — bass monophony leaks.
    const ramp = first.gains[0].gain.ramps.at(-1);
    if (ramp) expect(ramp.t).toBeCloseTo(t0 + 1 + 0.05, 9);
  });

  test('a note released with the patch release re-arms with the NEW patch release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');
    const vca = (engine as any).activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    // The pre-existing behaviour (engine.test.ts:275) must survive: a note-off
    // taken from params.release tracks the knob.
    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 4 + 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "has not started"`
Expected: FAIL — a ramp is recorded instead of a hard zero.

- [ ] **Step 3: Extend `SynthVoice`**

Add after `releaseScheduledAt?: number;` (engine.ts:34):

```ts
  // The release time this voice was ACTUALLY released with. A pending release
  // re-planned by updateSynthParams must reuse it, not the current patch's —
  // the bass mono-kill uses 0.05 s and the same-note dedup 0.3 s, and stretching
  // either to a pad's 2 s release lets a "stopped" note ring under the new one.
  releaseTime?: number;
```

- [ ] **Step 4: Record `releaseTime` and add `silenceVoiceNow`**

In `triggerSynthNoteOff` (engine.ts:524), before `this.releaseVoice(...)`:

```ts
    voice.releaseScheduledAt = now;
    voice.releaseTime = releaseTime;
    this.releaseVoice(voice, releaseTime, now);
```

Insert after `releaseVoice` (engine.ts:604):

```ts
  /**
   * Hard-silences a voice whose oscillators have not started yet.
   *
   * A release RAMP is wrong here: the ramp runs from `now` and finishes before
   * `voice.startTime`, at which point the oscillators start anyway and the amp
   * gain holds whatever value the ramp left. Worse, cancelling the note-on
   * floor event can leave the GainNode at its intrinsic 1.0, so the "released"
   * voice sounds at roughly 3x peakGain — an audible pop on every pattern stop.
   */
  private silenceVoiceNow(voice: SynthVoice, now: number): void {
    if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
    const voiceKey = `${voice.source}:${voice.noteName}`;
    try {
      voice.gains[0].gain.cancelScheduledValues(now);
      voice.gains[0].gain.setValueAtTime(0, now);
    } catch { /* ignore */ }
    if (this.activeVoices.get(voiceKey) === voice) this.activeVoices.delete(voiceKey);
    this.sourceVoices.get(voice.source)?.delete(voice);
    voice.oscs.forEach((osc) => {
      try { osc.stop(now); osc.disconnect(); } catch { /* ignore */ }
    });
    voice.gains.forEach((g) => {
      try { g.disconnect(); } catch { /* ignore */ }
    });
    try { voice.filter.disconnect(); } catch { /* ignore */ }
    if (voice.lfo) { try { voice.lfo.stop(now); voice.lfo.disconnect(); } catch { /* ignore */ } }
    if (voice.lfoGain) { try { voice.lfoGain.disconnect(); } catch { /* ignore */ } }
    if (voice.noise) { try { voice.noise.stop(now); voice.noise.disconnect(); } catch { /* ignore */ } }
    if (voice.noiseGain) { try { voice.noiseGain.disconnect(); } catch { /* ignore */ } }
  }
```

- [ ] **Step 5: Guard `stopSource` and `releaseSoundingVoices`**

Replace `stopSource`'s loop (engine.ts:621-624):

```ts
    for (const voice of Array.from(voices)) {
      if (voice.startTime > now) {
        this.silenceVoiceNow(voice, now);
        continue;
      }
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
```

Replace `releaseSoundingVoices`'s loop (engine.ts:665-669):

```ts
    for (const voice of Array.from(voices)) {
      if (voice.startTime > now) {
        // A future hit that already owns a release keeps it: this is the arp
        // key-release path, which must not cancel notes the clock has planned.
        if (voice.releaseScheduledAt !== undefined) continue;
        // A future hit with no release of its own would drone forever, and a
        // ramp cannot silence a voice that starts after the ramp ends.
        this.silenceVoiceNow(voice, now);
        continue;
      }
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
```

- [ ] **Step 6: Re-plan from the stored release time**

Replace engine.ts:845-853 (the tail of the `updateSynthParams` loop body):

```ts
      // A voice sounding now whose note-off sits ahead on the clock (a
      // sustained chord, a whole-note bass) has its release ramp already
      // planned — and the cancelAndHold above just wiped the filter half of it.
      // Re-plan with the release the voice was ACTUALLY released with, falling
      // back to the patch's for a voice released before releaseTime was tracked.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt > now) {
        this.releaseVoice(voice, voice.releaseTime ?? params.release, voice.releaseScheduledAt);
      }
```

> Note the interaction with the existing test at engine.test.ts:275 ("re-arms a release ramp that has not started with the new release time"). That test releases with `SYNTH.release` (0.5) and expects the re-arm at `t0 + 4 + 2` after setting `release: 2`. With `releaseTime` stored, the re-arm would use 0.5 and the test would fail. **Resolution:** `triggerSynthNoteOff` is the *patch* release path, so it must record `undefined` rather than the value when the caller passed the patch's own release. Implement this by having `triggerSynthNoteOff` store the release only when it differs from a patch release — which it cannot know. Instead, mark the two internal kill paths explicitly:

Change the two internal calls to record the intent directly rather than through `triggerSynthNoteOff`. Add an optional 5th parameter:

```ts
  triggerSynthNoteOff(noteName: string, releaseTime = 0.3, time?: number, source = 'synth', pinRelease = false): void {
    if (!this.ctx) return;
    const voice = this.activeVoices.get(`${source}:${noteName}`);
    if (!voice) return;

    const now = time ?? this.ctx.currentTime;
    voice.releaseScheduledAt = now;
    // `pinRelease` marks a release the ENGINE chose (bass mono-kill 0.05 s,
    // same-note dedup 0.3 s). Those must survive a live Release-knob change;
    // a normal note-off leaves releaseTime unset so the knob still reaches it.
    voice.releaseTime = pinRelease ? releaseTime : undefined;
    this.releaseVoice(voice, releaseTime, now);
  }
```

Then engine.ts:394 becomes `this.triggerSynthNoteOff(key.slice(5), 0.05, time, 'bass', true);` and engine.ts:404 becomes `this.triggerSynthNoteOff(noteName, 0.3, time, source, true);`. `stopSource` / `releaseSoundingVoices` set `voice.releaseTime = releaseTime` directly (both are engine-chosen). Both new tests and engine.test.ts:275 then pass.

- [ ] **Step 7: Run the tests**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS — including `describe('source stop (preview release)')` at line 381 and `describe('releaseSoundingVoices')` at line 518. If `engine.test.ts:571` ("stopSource still kills a scheduled voice, so pattern previews stop dead") asserted a ramp, update it to assert the hard-silence and the teardown, quoting the reason in a comment.

- [ ] **Step 8: Listen**

Run `bun run dev`. Start the chord player, then hit hard-stop repeatedly. Confirm the pop on stop is gone. Switch a bass patch to a long release (Release knob to max) and play fast bass notes — confirm only one bass note sounds at a time.

- [ ] **Step 9: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "fix(audio): hard-silence not-yet-started voices and pin engine-chosen releases

A release ramp on a voice whose oscillators start later finishes before the
note begins, leaving the VCA at its intrinsic value: an audible pop at ~3x
peak gain on every pattern stop. Also stops a long patch release from
stretching the bass mono-kill and breaking monophony."
```

---

### Task 7: LFO — tremolo through a series VCA, and a real teardown at depth zero

**Why:** When `lfoTarget` is `'volume'`, `triggerSynthNoteOn` connects the LFO gain **straight to `gainNode.gain`** (engine.ts:457-459), and `updateVoiceLfo` does the same on a live voice (engine.ts:763). A connected node's signal is **summed** with the param's automation, not multiplied by it. Two consequences: the release's `exponentialRampToValueAtTime(SILENCE, …)` never reaches silence — the voice keeps oscillating at up to `lfoDepth * 0.2` for the whole release tail — and on the LFO's downswing the sum goes negative, inverting phase. `synthPresets.ts` ships "Vintage Brass" (`lfoTarget: 'volume'`, `lfoDepth: 0.15`, synthPresets.ts:268-294), so this is reachable from the preset library.

Second defect: dropping `lfoDepth` to 0 only does `lfoGain.gain.setTargetAtTime(0, now, tc)` (engine.ts:734-736). `setTargetAtTime` is asymptotic and never reaches exactly 0, and the oscillator is never stopped or disconnected — so a voice that has had its LFO turned off still carries a running oscillator and a residual modulation for the rest of its life.

There is currently **zero** test coverage of the LFO.

**Sound change:** yes, and intended. Tremolo becomes a true multiply (correct depth, no phase inversion) and a `'volume'`-LFO voice now actually goes silent on release.

**Files:**
- Modify: `src/audio/engine.ts:5-38` (`SynthVoice`), `:440-462`, `:471-511`, `:573-600` (teardown), `:732-776` (`updateVoiceLfo`)
- Modify: `src/audio/engine.test.ts`
- Modify: `.claude/skills/dsp-audio/SKILL.md` (signal graph, lines 42-65)

**Interfaces:**
- Consumes: `silenceVoiceNow` teardown conventions (Task 6).
- Produces:
  - `SynthVoice` gains `tremoloGain: GainNode` — **always** created, fixed at `gain.value = 1`, sitting between the VCA and the per-source bus. Always present so `updateVoiceLfo` can switch a live voice onto tremolo without rewiring the voice's output.
  - `private connectLfoTo(voice: SynthVoice, target: SynthParams['lfoTarget']): void`
  - `private teardownVoiceLfo(voice: SynthVoice, now: number, tc: number): void`
  - `SynthVoice.gains` stays positional (`[0]` main VCA, `[1]` sub) — `tremoloGain` is a separate field, not appended, because `engine.test.ts:805` pins that ordering.

- [ ] **Step 1: Write the failing tests**

Append to `src/audio/engine.test.ts`:

```ts
describe('LFO routing', () => {
  const TREM: SynthParams = { ...SYNTH, lfoDepth: 0.4, lfoRate: 5, lfoTarget: 'volume' };

  test('a volume LFO modulates a SERIES gain, never the VCA param itself', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Connecting the LFO to gainNode.gain SUMS with the envelope: the release
    // ramp never reaches silence and the sum inverts phase on the downswing.
    expect(voice.lfoGain.connectedTo).not.toContain(voice.gains[0].gain);
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });

  test('the tremolo gain sits between the VCA and the source bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const bus = (engine as any).sourceBuses.get('synth');

    expect(voice.gains[0].connectedTo).toEqual([voice.tremoloGain]);
    expect(voice.tremoloGain.connectedTo).toContain(bus);
    // Unity so the envelope passes through untouched when depth is 0.
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('a voice with no LFO still routes through the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Always present, so switching a live voice onto tremolo is a reconnect of
    // the LFO alone and never a rewire of the voice's own output.
    expect(voice.tremoloGain).toBeTruthy();
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('cutoff and pitch targets are unchanged', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const cut = (engine as any).activeVoices.get('synth:C4');
    expect(cut.lfoGain.connectedTo).toContain(cut.filter.frequency);
    expect(cut.lfoGain.gain.value).toBeCloseTo(0.5 * 1500, 9);

    engine.triggerSynthNoteOn('E4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth');
    const pit = (engine as any).activeVoices.get('synth:E4');
    expect(pit.lfoGain.connectedTo).toContain(pit.oscs[0].detune);
    expect(pit.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);
  });

  test('switching a live voice from cutoff to volume moves the LFO to the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfoTarget).toBe('volume');
    expect(voice.lfoGain.connectedTo).toEqual([voice.tremoloGain.gain]);
  });

  test('an LFO added to a live voice that started without one is wired, not dropped', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth'); // lfoDepth 0
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.lfo).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.3, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfo).toBeTruthy();
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });
});

describe('LFO teardown at depth zero', () => {
  test('dropping depth to zero stops and disconnects the oscillator', async () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const lfo = voice.lfo;
    const lfoGain = voice.lfoGain;
    expect(lfo).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0 }, 'synth');

    // setTargetAtTime is asymptotic and never reaches exactly 0, so the node
    // must actually be removed once the ramp is inaudible (~5 time constants).
    expect(lfoGain.gain.targets.at(-1)!.v).toBe(0);
    await new Promise((r) => setTimeout(r, 220));
    expect(voice.lfo).toBeUndefined();
    expect(voice.lfoGain).toBeUndefined();
    expect(lfoGain.connectedTo).toHaveLength(0);
  });

  test('depth back up before the teardown lands keeps the same oscillator', async () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const lfo = voice.lfo;

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0 }, 'synth');
    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 'synth');
    await new Promise((r) => setTimeout(r, 220));

    expect(voice.lfo).toBe(lfo);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "LFO"`
Expected: FAIL — `voice.tremoloGain` is undefined.

- [ ] **Step 3: Add the `tremoloGain` field**

In `SynthVoice` (engine.ts:5-38), add after `lfoTarget?: SynthParams['lfoTarget'];`:

```ts
  // A unity gain in SERIES between the VCA and the source bus, existing purely
  // so a 'volume' LFO can multiply the amp envelope instead of summing into it.
  // Always created: a connected node's signal is added to a param's automation,
  // so wiring the LFO straight to gains[0].gain made the release never reach
  // silence and inverted phase on the downswing. Kept out of `gains` because
  // gains[0]/gains[1] are positional (main VCA / sub level).
  tremoloGain: GainNode;
  // Pending teardown for an LFO whose depth just went to zero.
  lfoTeardownTimer?: ReturnType<typeof setTimeout>;
```

- [ ] **Step 4: Create and wire the tremolo gain in `triggerSynthNoteOn`**

Replace the LFO block (engine.ts:440-462):

```ts
    // Tremolo VCA: envelope -> tremoloGain -> bus. The LFO drives THIS node's
    // gain, so amp envelope and tremolo multiply. Unity when unused.
    const tremoloGain = this.ctx.createGain();
    tremoloGain.gain.value = 1;

    // LFO
    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;
    if (params.lfoDepth > 0) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      lfoGain = this.ctx.createGain();
      lfoGain.gain.value = AudioEngine.lfoDepthFor(params);
      lfo.connect(lfoGain);

      if (params.lfoTarget === 'cutoff') {
        lfoGain.connect(filter.frequency);
      } else if (params.lfoTarget === 'pitch') {
        lfoGain.connect(osc1.detune);
      } else {
        lfoGain.connect(tremoloGain.gain);
      }
      lfo.start(now);
    }
```

Replace the routing lines (engine.ts:476-479):

```ts
    filter.connect(gainNode);
    gainNode.connect(tremoloGain);

    // Route through the per-source bus (lazily created) to dry/effects
    tremoloGain.connect(this.getSourceBus(source));
```

Add `tremoloGain,` to the `voice` object literal (engine.ts:484-504), next to `lfoGain,`.

Add the depth table as a static, next to `REVERB_CURVE`:

```ts
  /**
   * LFO amount per target, in the target param's own units: Hz for cutoff,
   * cents for pitch, and a unitless 0..1 multiplier deviation for tremolo.
   * 0.2 keeps the tremolo VCA in 0.8..1.2 so it never goes negative.
   */
  private static lfoDepthFor(params: SynthParams): number {
    if (params.lfoTarget === 'cutoff') return params.lfoDepth * 1500;
    if (params.lfoTarget === 'pitch') return params.lfoDepth * 50;
    return Math.min(1, params.lfoDepth) * 0.2;
  }
```

- [ ] **Step 5: Rewrite `updateVoiceLfo` (engine.ts:732-776)**

```ts
  private connectLfoTo(voice: SynthVoice, target: SynthParams['lfoTarget']): void {
    if (!voice.lfoGain) return;
    try { voice.lfoGain.disconnect(); } catch { /* ignore */ }
    if (target === 'cutoff') {
      voice.lfoGain.connect(voice.filter.frequency);
    } else if (target === 'pitch') {
      voice.lfoGain.connect(voice.oscs[0].detune);
    } else {
      voice.lfoGain.connect(voice.tremoloGain.gain);
    }
    voice.lfoTarget = target;
  }

  /**
   * Removes an LFO whose depth has gone to zero, once the fade is inaudible.
   * setTargetAtTime is asymptotic — it never reaches exactly 0 — so without
   * this a "switched off" LFO keeps a running oscillator and a residual
   * modulation for the rest of the voice's life.
   */
  private teardownVoiceLfo(voice: SynthVoice, now: number, tc: number): void {
    if (!voice.lfoGain || voice.lfoTeardownTimer !== undefined) return;
    this.cancelAndHold(voice.lfoGain.gain, now);
    voice.lfoGain.gain.setTargetAtTime(0, now, tc);
    voice.lfoTeardownTimer = setTimeout(() => {
      voice.lfoTeardownTimer = undefined;
      if (voice.lfo) { try { voice.lfo.stop(); voice.lfo.disconnect(); } catch { /* ignore */ } }
      if (voice.lfoGain) { try { voice.lfoGain.disconnect(); } catch { /* ignore */ } }
      voice.lfo = undefined;
      voice.lfoGain = undefined;
      voice.lfoTarget = undefined;
    }, tc * 5 * 1000); // 5 time constants ~= -43 dB
  }

  // Re-points a live voice's LFO at the current params, creating the LFO nodes
  // on the spot if the depth knob has just come up off zero.
  private updateVoiceLfo(voice: SynthVoice, params: SynthParams, now: number, tc: number): void {
    if (!this.ctx) return;
    if (params.lfoDepth <= 0) {
      this.teardownVoiceLfo(voice, now, tc);
      return;
    }

    // The knob came back up before the teardown landed: keep the same nodes.
    if (voice.lfoTeardownTimer !== undefined) {
      clearTimeout(voice.lfoTeardownTimer);
      voice.lfoTeardownTimer = undefined;
    }

    if (!voice.lfo || !voice.lfoGain) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfo.start(now);
      voice.lfo = lfo;
      voice.lfoGain = lfoGain;
      voice.lfoTarget = undefined; // force the connect below
    }

    if (voice.lfoTarget !== params.lfoTarget) {
      this.connectLfoTo(voice, params.lfoTarget);
    }

    voice.lfo.frequency.setTargetAtTime(params.lfoRate, now, tc);
    voice.lfoGain.gain.setTargetAtTime(AudioEngine.lfoDepthFor(params), now, tc);
  }
```

- [ ] **Step 6: Tear the tremolo gain down with the voice**

In `releaseVoice`'s teardown timeout (engine.ts:591-593), after the `lfoGain` disconnect, add:

```ts
        try { voice.tremoloGain.disconnect(); } catch { /* ignore */ }
        if (voice.lfoTeardownTimer !== undefined) clearTimeout(voice.lfoTeardownTimer);
```

Add the same two lines to `silenceVoiceNow` (Task 6), after its `lfoGain` disconnect.

- [ ] **Step 7: Run the tests**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS. Note `engine.test.ts:781` ("noise runs into the filter, not past it") and `:805` (gains ordering) are unaffected — `tremoloGain` is neither in `gains` nor upstream of the filter.

- [ ] **Step 8: Update the skill doc**

`.claude/skills/dsp-audio/SKILL.md`, replace the first line of the signal graph (line 43):

```
synth/chord/bass voice: osc1 + subOsc (+ noise) -> BiquadFilter (VCF) -> GainNode (VCA)
                                                      -> tremoloGain (unity; a 'volume' LFO
                                                         drives THIS gain, never the VCA param)
```

Add to "Voices and per-source buses":

```
- The LFO's `'volume'` target drives a **series** `tremoloGain` between the VCA and the bus.
  Connecting a node to `gains[0].gain` would SUM with the amp envelope: the release would never
  reach silence and the sum would invert phase on the downswing. Depth 0 stops and disconnects
  the LFO after ~5 time constants; `setTargetAtTime(0, …)` alone never reaches zero.
```

- [ ] **Step 9: Listen**

Run `bun run dev`, load the "Vintage Brass" preset from the synth preset library, hold a chord and release it. Confirm the note goes fully silent (no residual wobble in the tail) and the tremolo is smooth rather than gargling.

- [ ] **Step 10: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/engine.ts src/audio/engine.test.ts .claude/skills/dsp-audio/SKILL.md
git commit -m "fix(audio): route tremolo through a series VCA and tear down a zero-depth LFO

Connecting the LFO gain to gains[0].gain summed with the amp envelope, so a
'volume'-LFO voice never reached silence on release and inverted phase on the
downswing. Vintage Brass ships that target, so this changes its sound."
```

---

### Task 8: `triggerDrum` refactor and the drum bugs it exposes

**Why:** `triggerDrum` (engine.ts:874-1035) is a 162-line switch with eslint complexity 26 (the threshold is 20, so it already warns). Its seven near-identical arms hide six real defects:

1. **Per-kit `reverbSend` is used as a boolean.** engine.ts:931, 993, 1027 all test `s.reverbSend > 0` and then connect the voice gain to the convolver at **full level**. `drumKits.ts` authors values from `0.15` to `0.5` — a 3.3× spread that currently does nothing.
2. **The wet sends tap upstream of `drumBusFilter`.** Closing the drum filter still leaves a bright reverb tail, because the send is taken from the per-voice gain (engine.ts:931, 993, 1027) while the dry path goes through the filter.
3. **`openhat` alone taps `delayNode`** unconditionally (engine.ts:970), contradicting the documented "drums bypass delay and distortion entirely" (SKILL.md:72). No kit parameter drives it; it is a stray.
4. **The snare body ramps to `0.001`** (engine.ts:915) where every other drum uses `0.0001` — a 20 dB louder tail end on one component of one drum.
5. **The clap's second micro-burst is a hardcoded `0.1`** (engine.ts:986) instead of velocity-scaled, so at low velocity the ghost burst is *louder* than the hit.
6. **One shared noise buffer, always started at offset 0** (engine.ts:1075-1089). Every hat, snare and clap is byte-identical noise, so simultaneous hits are perfectly correlated and sum coherently at +6 dB instead of +3. Fixing this makes a *non-looping* source able to run past the buffer's end, so all drum noise becomes looping — which also fixes the crash, whose "Acoustic Studio" decay of 1.7 s plus a 0.1 s pad already reaches 1.8 s of a 2.0 s buffer (engine.ts:1029, drumKits.ts:161).
7. **`velocity` is never clamped** (engine.ts:874).

**Post-filter sends without per-voice filters:** add one shared `drumSendFilter` created in `setupMasterChain()`, mirroring `drumBusFilter`'s cutoff/resonance/type and feeding `reverbNode`. Each voice's send gain feeds it. This gets filtered sends *and* keeps live drum-filter sweeps audible on ringing tails, which per-voice filters would lose (see "Out of Scope").

**THIS CHANGES THE SOUND.** Snare/clap/crash reverb levels drop to their authored values, the drum filter now shapes the reverb feed, the open hat loses its delay tail, the snare body decays 20 dB further, low-velocity claps stop ghosting, and simultaneous noise drums stop summing coherently. `bun run check:drums` must still pass.

**Files:**
- Modify: `src/audio/engine.ts:69-72` (drum filter fields), `:262-267` (`setupMasterChain`), `:861-871` (`setDrumFilter`), `:874-1035` (`triggerDrum`), `:1044-1053` (`createNoiseNodes`), `:1075-1089` (`createNoiseNode`)
- Modify: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `ENV_FLOOR`, `DEFAULT_VELOCITY`, `clampVelocity` from `src/audio/constants` (Task 1).
- Produces on `AudioEngine`:
  - `private drumSendFilter: BiquadFilterNode | null`
  - `private drumEnv(peak: number, decay: number, t: number): GainNode`
  - `private wireDrumVoice(env: GainNode, reverbSend?: number): void`
  - `private drumTone(o: { type?: OscillatorType; freq: number; freqEnd?: number; pitchTime?: number; peak: number; decay: number; t: number; stopAt?: number; reverbSend?: number }): void`
  - `private drumNoiseBurst(o: { filterType: BiquadFilterType; freq: number; q?: number; peak: number; decay: number; t: number; stopPad?: number; reverbSend?: number; shape?: (gain: AudioParam) => void }): void`
  - `private noiseStartOffset(): number`
  - `export const DRUM_ALIASES: Record<string, string>` from `src/audio/engine.ts`
  - `createNoiseNode()` now always sets `loop = true`; `createNoiseNodes` drops its own `noise.loop = true` line.

- [ ] **Step 1: Write the failing tests**

Append to `src/audio/engine.test.ts`. Extend `freshEngine` to give drums a filter — add these two lines inside `freshEngine` (after line 196):

```ts
  (engine as any).drumBusFilter = fakeNode(opts);
  (engine as any).drumSendFilter = fakeNode(opts);
```

Then:

```ts
describe('drum reverb sends', () => {
  function drumEngine() {
    const { engine, ctx } = freshEngine();
    const reverbNode = fakeNode();
    (engine as any).reverbNode = reverbNode;
    return { engine, ctx, reverbNode, sendFilter: (engine as any).drumSendFilter };
  }

  test('the kit reverbSend is a real level, not a boolean', () => {
    const { engine, ctx } = drumEngine();
    engine.setDrumKit({ snare: { ...(engine as any).drumKit.snare, reverbSend: 0.15 } });
    const before = ctx._gains.length;

    engine.triggerDrum('snare', 1.0);

    // drumKits authors 0.15..0.5 across kits; sending at full voice level makes
    // that 3.3x spread inaudible.
    const sends = ctx._gains.slice(before).filter((g) => g.gain.value === 0.15);
    expect(sends).toHaveLength(1);
  });

  test('sends are filtered: they feed drumSendFilter, never the convolver directly', () => {
    const { engine, ctx, reverbNode, sendFilter } = drumEngine();
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    const created = ctx._gains.slice(before);
    expect(created.some((g) => g.connectedTo.includes(sendFilter))).toBe(true);
    expect(created.some((g) => g.connectedTo.includes(reverbNode))).toBe(false);
  });

  test('a kit with reverbSend 0 creates no send node at all', () => {
    const { engine, ctx } = drumEngine();
    engine.setDrumKit({ clap: { ...(engine as any).drumKit.clap, reverbSend: 0 } });
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    expect(ctx._gains.slice(before)).toHaveLength(1); // the envelope only
  });

  test('setDrumFilter keeps the send filter in lockstep with the drum bus filter', () => {
    const { engine } = drumEngine();
    engine.setDrumFilter(800, 4, 'highpass');

    const bus = (engine as any).drumBusFilter;
    const send = (engine as any).drumSendFilter;
    expect(send.frequency.targets.at(-1)).toEqual(bus.frequency.targets.at(-1));
    expect(send.Q.targets.at(-1)).toEqual(bus.Q.targets.at(-1));
    expect(send.type).toBe('highpass');
  });
});

describe('drum voice details', () => {
  test('every drum envelope floors at the same 0.0001', () => {
    const { engine, ctx } = freshEngine();
    for (const type of ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      for (const g of ctx._gains.slice(before)) {
        for (const ramp of g.gain.ramps) expect(ramp.v).toBe(0.0001);
      }
    }
  });

  test('the clap ghost burst scales with velocity', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumKit.clap.gain;

    let before = ctx._gains.length;
    engine.triggerDrum('clap', 1.0);
    const loud = ctx._gains[before].gain.events.map((e: any) => e.v);

    before = ctx._gains.length;
    engine.triggerDrum('clap', 0.2);
    const soft = ctx._gains[before].gain.events.map((e: any) => e.v);

    // Every scheduled level must scale with velocity; the ghost used to be a
    // hardcoded 0.1, which at velocity 0.2 is LOUDER than the hit itself.
    expect(loud[0]).toBeCloseTo(1.0 * gain, 9);
    expect(soft[0]).toBeCloseTo(0.2 * gain, 9);
    for (let i = 0; i < soft.length - 1; i++) {
      expect(soft[i]).toBeLessThan(loud[i]);
    }
  });

  test('the open hat does not tap the delay', () => {
    const { engine, ctx } = freshEngine();
    const delayNode = fakeNode();
    (engine as any).delayNode = delayNode;
    const before = ctx._gains.length;

    engine.triggerDrum('openhat', 1.0);

    // Drums bypass delay and distortion entirely (dsp-audio SKILL.md).
    for (const g of ctx._gains.slice(before)) {
      expect(g.connectedTo).not.toContain(delayNode);
    }
  });

  test('drum noise is looped and starts at a random offset', () => {
    const { engine, ctx } = freshEngine();
    const offsets: number[] = [];
    const before = ctx._bufferSources.length;
    for (let i = 0; i < 8; i++) engine.triggerDrum('hihat', 1.0);

    for (const src of ctx._bufferSources.slice(before)) {
      expect(src.loop).toBe(true);
      offsets.push((src as any)._startArgs?.[1] ?? 0);
    }
    // Identical offsets mean every hat reads the same bytes of the one shared
    // buffer, so simultaneous hits sum coherently (+6 dB instead of +3).
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  test('velocity is clamped to 0..1', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumKit.kick.gain;

    let before = ctx._gains.length;
    engine.triggerDrum('kick', 5);
    expect(ctx._gains[before].gain.events[0].v).toBeCloseTo(gain, 9);

    before = ctx._gains.length;
    engine.triggerDrum('kick', -2);
    expect(ctx._gains[before].gain.events[0].v).toBe(0.0001);
  });
});

describe('drum aliases and unknown types', () => {
  test('closedhat, lowtom and ride resolve to their canonical voices', () => {
    const { engine, ctx } = freshEngine();
    const counts: Record<string, number> = {};
    for (const type of ['hihat', 'closedhat', 'tom', 'lowtom', 'crash', 'ride']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      counts[type] = ctx._gains.length - before;
    }
    expect(counts.closedhat).toBe(counts.hihat);
    expect(counts.lowtom).toBe(counts.tom);
    expect(counts.ride).toBe(counts.crash);
  });

  test('the type is case-insensitive', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('KICK', 1.0);
    expect(ctx._gains.length).toBeGreaterThan(before);
  });

  test('an unknown type is a silent no-op, not a throw', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    expect(() => engine.triggerDrum('cowbell', 1.0)).not.toThrow();
    expect(ctx._gains.length).toBe(before);
  });

  test('every DRUM_ALIASES target is a real drum type', () => {
    const { engine, ctx } = freshEngine();
    for (const target of Object.values(DRUM_ALIASES)) {
      const before = ctx._gains.length;
      engine.triggerDrum(target, 1.0);
      expect(ctx._gains.length).toBeGreaterThan(before);
    }
  });
});
```

Add `DRUM_ALIASES` to the `from './engine'` import at engine.test.ts:2.

Record `start` arguments in the harness so the offset test can read them — replace `fakeBufferSource` (engine.test.ts:130-132):

```ts
function fakeBufferSource(opts: FakeOpts = {}) {
  const node = { ...fakeNode(opts), buffer: null as unknown, loop: false, _startArgs: [] as number[] };
  node.start = (...args: number[]) => {
    node._startArgs = args;
  };
  return node;
}
```

And give the fake buffer a `duration` so `noiseStartOffset()` is non-zero in tests — in `fakeCtx`'s `createBuffer` (engine.test.ts:150-153):

```ts
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      sampleRate,
      // Real AudioBuffers expose duration; noiseStartOffset reads it to pick a
      // random start, so the fake must too or every offset would be 0.
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "drum"`
Expected: FAIL — `drumSendFilter` and `DRUM_ALIASES` do not exist.

- [ ] **Step 3: Add `drumSendFilter`**

engine.ts — add after `private drumBusFilter` (line 69):

```ts
  // A mirror of drumBusFilter used only for the drum reverb sends. The dry
  // path and the send path must be filtered identically, but drumBusFilter is
  // ONE shared node, so a per-voice send cannot be tapped downstream of it
  // without a per-voice filter copy — which would lose the live filter sweeps
  // on ringing tails that the shared node exists to provide. A second shared
  // filter fed by the per-voice send gains gets both.
  private drumSendFilter: BiquadFilterNode | null = null;
```

In `setupMasterChain`, replace lines 262-267:

```ts
    // Drum bus filter — open by default (12 kHz reads as bypass for drum content)
    this.drumBusFilter = this.ctx.createBiquadFilter();
    this.drumBusFilter.type = this.drumFilterType;
    this.drumBusFilter.frequency.value = this.drumFilterCutoff;
    this.drumBusFilter.Q.value = this.drumFilterResonance;
    this.drumBusFilter.connect(this.dryGain);

    // Same settings, wired to the reverb send only.
    this.drumSendFilter = this.ctx.createBiquadFilter();
    this.drumSendFilter.type = this.drumFilterType;
    this.drumSendFilter.frequency.value = this.drumFilterCutoff;
    this.drumSendFilter.Q.value = this.drumFilterResonance;
```

The reverb node is created later in `setupMasterChain` (line 291), so wire the send filter to it right after `this.reverbNode.connect(this.reverbGain);` (line 296):

```ts
    if (this.drumSendFilter) this.drumSendFilter.connect(this.reverbNode);
```

Replace `setDrumFilter`'s body (engine.ts:862-871):

```ts
  setDrumFilter(cutoff: number, resonance: number, type: FilterType): void {
    this.drumFilterCutoff = cutoff;
    this.drumFilterResonance = resonance;
    this.drumFilterType = type;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const node of [this.drumBusFilter, this.drumSendFilter]) {
      if (!node) continue;
      node.frequency.setTargetAtTime(cutoff, now, 0.03);
      node.Q.setTargetAtTime(resonance, now, 0.03);
      node.type = type;
    }
  }
```

- [ ] **Step 4: Add the drum helpers**

Insert immediately before `triggerDrum` (engine.ts:873):

```ts
  /** One drum envelope: peak at `t`, exponential to the shared floor by `t + decay`. */
  private drumEnv(peak: number, decay: number, t: number): GainNode {
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(Math.max(ENV_FLOOR, peak), t);
    gain.gain.exponentialRampToValueAtTime(ENV_FLOOR, t + Math.max(0.01, decay));
    return gain;
  }

  /**
   * Dry through drumBusFilter, wet through a per-voice send gain into
   * drumSendFilter. `reverbSend` is the kit's authored LEVEL (0.15..0.5 across
   * kits); it used to be tested as a boolean and the send ran at full voice
   * level, so the whole spread was inaudible.
   */
  private wireDrumVoice(env: GainNode, reverbSend = 0): void {
    env.connect(this.drumBusFilter!);
    if (reverbSend <= 0 || !this.drumSendFilter) return;
    const send = this.ctx!.createGain();
    send.gain.value = reverbSend;
    env.connect(send);
    send.connect(this.drumSendFilter);
  }

  /** A pitched drum component (kick body, kick click, snare body, tom). */
  private drumTone(o: {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    pitchTime?: number;
    peak: number;
    decay: number;
    t: number;
    stopAt?: number;
    reverbSend?: number;
  }): void {
    const osc = this.ctx!.createOscillator();
    if (o.type) osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(o.freqEnd, o.t + (o.pitchTime ?? 0.05));
    }
    const env = this.drumEnv(o.peak, o.decay, o.t);
    osc.connect(env);
    this.wireDrumVoice(env, o.reverbSend);
    osc.start(o.t);
    osc.stop(o.stopAt ?? o.t + o.decay + 0.02);
  }

  /** A filtered noise drum component (hats, snare snap, clap, crash). */
  private drumNoiseBurst(o: {
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    peak: number;
    decay: number;
    t: number;
    stopPad?: number;
    reverbSend?: number;
    shape?: (gain: AudioParam) => void;
  }): void {
    const noise = this.createNoiseNode();
    const filter = this.ctx!.createBiquadFilter();
    filter.type = o.filterType;
    filter.frequency.value = o.freq;
    if (o.q !== undefined) filter.Q.value = o.q;

    const env = this.drumEnv(o.peak, o.decay, o.t);
    // Extra levels between the peak and the floor (the clap's micro-bursts).
    // Web Audio orders the timeline by time, not by insertion order, so
    // scheduling them after the closing ramp is correct.
    o.shape?.(env.gain);

    noise.connect(filter);
    filter.connect(env);
    this.wireDrumVoice(env, o.reverbSend);
    noise.start(o.t, this.noiseStartOffset());
    noise.stop(o.t + o.decay + (o.stopPad ?? 0.01));
  }

  /**
   * A random read position in the one shared noise buffer. Without it every
   * hat, snare and clap plays byte-identical noise, so hits landing on the same
   * step are perfectly correlated and sum at +6 dB instead of +3.
   */
  private noiseStartOffset(): number {
    return Math.random() * (this.noiseBuffer?.duration ?? 0);
  }
```

- [ ] **Step 5: Rewrite `triggerDrum`**

Add above the class (next to the `SynthVoice` type):

```ts
/**
 * Names callers use that map onto one of the 7 authored drum types. Exported
 * so a test can prove every target is real.
 */
export const DRUM_ALIASES: Record<string, string> = {
  closedhat: 'hihat',
  lowtom: 'tom',
  ride: 'crash',
};
```

Replace engine.ts:873-1035 entirely:

```ts
  // Drum Synthesizer Trigger
  triggerDrum(type: string, velocity = DEFAULT_VELOCITY, time?: number): void {
    if (!this.ctx || !this.dryGain || !this.drumBusFilter) return;
    const now = time ?? this.ctx.currentTime;
    const v = clampVelocity(velocity);
    const k = this.drumKit;
    const name = type.toLowerCase();

    switch (DRUM_ALIASES[name] ?? name) {
      case 'kick': {
        const d = k.kick;
        this.drumTone({
          freq: d.freqStart, freqEnd: d.freqEnd, pitchTime: d.pitchTime,
          peak: v * d.gain, decay: d.decay, t: now,
        });
        if (d.clickFreq && d.clickLevel) {
          this.drumTone({
            freq: d.clickFreq, peak: v * d.clickLevel, decay: d.clickDecay ?? 0.01,
            t: now, stopAt: now + d.decay + 0.02,
          });
        }
        break;
      }
      case 'snare': {
        const s = k.snare;
        this.drumTone({
          type: 'triangle', freq: s.bodyFreqStart, freqEnd: s.bodyFreqEnd,
          pitchTime: s.bodyTime, peak: v * s.bodyGain, decay: s.bodyDecay,
          t: now, stopAt: now + s.bodyDecay + 0.05,
        });
        this.drumNoiseBurst({
          filterType: 'highpass', freq: s.noiseFilter, peak: v * s.noiseGain,
          decay: s.noiseDecay, t: now, stopPad: 0.03, reverbSend: s.reverbSend,
        });
        break;
      }
      case 'hihat': {
        const h = k.hihat;
        this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, peak: v * h.gain, decay: h.decay, t: now,
        });
        break;
      }
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely. The old
        // unconditional gain.connect(delayNode) here was a stray with no kit
        // parameter behind it.
        const h = k.openhat;
        this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, peak: v * h.gain, decay: h.decay, t: now,
        });
        break;
      }
      case 'clap': {
        const c = k.clap;
        const peak = v * c.gain;
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: c.filter, q: 1.5, peak, decay: c.decay,
          t: now, stopPad: 0.02, reverbSend: c.reverbSend,
          // 3 quick micro-bursts for realistic clap texture. Both scale with
          // velocity: the second used to be a hardcoded 0.1, which at low
          // velocity made the ghost louder than the hit.
          shape: (gain) => {
            gain.setValueAtTime(peak * 0.25, now + 0.012);
            gain.setValueAtTime(peak * 1.1, now + 0.024);
          },
        });
        break;
      }
      case 'tom': {
        const t = k.tom;
        this.drumTone({
          freq: t.freqStart, freqEnd: t.freqEnd, pitchTime: t.pitchTime,
          peak: v * t.gain, decay: t.decay, t: now,
        });
        break;
      }
      case 'crash': {
        const cr = k.crash;
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: cr.filter, q: 0.8, peak: v * cr.gain,
          decay: cr.decay, t: now, stopPad: 0.1, reverbSend: cr.reverbSend,
        });
        break;
      }
      default:
        break;
    }
  }
```

Add `clampVelocity` to the constants import on engine.ts:3.

- [ ] **Step 6: Make all drum noise looping**

Replace `createNoiseNode` (engine.ts:1075-1089):

```ts
  private createNoiseNode(): AudioBufferSourceNode {
    if (!this.ctx) return {} as AudioBufferSourceNode;
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== this.ctx.sampleRate) {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    // Always looped. The buffer is 2 s; a pad's release runs longer, and now
    // that drum voices start at a RANDOM offset a one-shot could reach the end
    // mid-decay (the crash already used 1.8 s of the 2 s from offset 0).
    noise.loop = true;
    return noise;
  }
```

Delete the now-redundant `noise.loop = true;` from `createNoiseNodes` (engine.ts:1047) and update its comment to point at `createNoiseNode`.

- [ ] **Step 7: Run the tests**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS, including `describe('drum bus filter')` at line 453 and `describe('noise source')` at line 744.

- [ ] **Step 8: Verify complexity dropped**

Run: `bun run eslint`
Expected: no `complexity` warning for `triggerDrum`. If one remains, the switch arms are still doing too much — move the per-arm parameter picking into a small lookup rather than re-inflating the arms.

- [ ] **Step 9: Re-run the drum invariant and A/B the sound**

Run: `bun run check:drums`
Expected: every `PASS`, exit 0. (The refactor touches no kit data, so all 84 override checks and every spread check must be unchanged.)

Then `bun run dev`, Sequencer tab:
- **Snare/clap/crash:** switch between "Warehouse" (`reverbSend` 0.5 on crash) and "Trap Beat" (0.15 on snare) and confirm the reverb amount now differs audibly between kits.
- **Drum filter:** with a crash ringing, sweep the Drum Filter cutoff down and confirm the reverb tail darkens with it.
- **Clap:** set a clap step's velocity low and confirm the ghost no longer jumps out.
- **Open hat:** with the master Delay wet up, confirm the open hat no longer echoes while the other drums do not.

- [ ] **Step 10: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "refactor(audio): extract drum voice helpers and fix the bugs they exposed

reverbSend was tested as a boolean so every kit sent at full level; sends were
tapped upstream of the drum filter; openhat tapped the delay; the snare body
floored 20 dB high; the clap ghost was a hardcoded 0.1; and every noise drum
read the same bytes of one shared buffer. All of these change the sound."
```

---

### Task 9: Playback layer — scheduling, subscriptions and preview lifetimes

**Why:** Six independent defects above the engine.

1. **Inverted note-off on a strummed chord's last step.** `emitStepEvents` (chordPlayback.ts:100-109) computes `start = time + ev.timeOffset` (up to `(n-1) * 30 ms` for a strum) but the note-off as `Math.min(start + ev.hold, chordEnd)`. At 200 BPM a step is 0.075 s, so on a chord's last step the clamped off can land *before* the on — `triggerSynthNoteOff` then schedules a release ramp in the past.
2. **The arp subscription is torn down by the Release knob.** `useArpPlayback` (arpPlayback.ts:24, 55) lists `release` and `controlTarget` in the effect's dependency array, and the cleanup calls `releaseSoundingVoices(controlTarget, release)` — so *dragging* the Release knob unsubscribes and resubscribes on every pointer move, cutting every held arp note. Both values are already mirrored in `stateRef.current` (arpPlayback.ts:15).
3. **Previews leak.** `presetPreview.ts` schedules with `setTimeout` at wall-clock offsets (lines 26, 31, 52, 69) and returns nothing, so leaving the panel mid-audition leaves notes ringing with no way to stop them. They also fire on the default `'synth'` source, so any stop would cut the user's own held keys.
4. **`previewSynthNote` (presetPreview.ts:10) is dead.** `grep -rn previewSynthNote src` matches only its own declaration.
5. **`startPatternLoop` drifts.** It re-arms `setTimeout(barSeconds * 1000)` from the wall clock (chordPlayback.ts:263) and plays at `getNow()`, so every late timer permanently shifts the loop off the audio grid.
6. **`drumPlayback.triggerPad` calls `audioEngine.init()` per hit** (drumPlayback.ts:8). `useSequencerPlayback.ts:100` calls it from inside the clock callback, so `init()` runs ~8×/second during playback.
7. **`engineSync`'s `effects` and `synthParams` subscriptions key on object identity** (engineSync.ts:73, 76-78), so any action that respreads the object re-runs `updateEffects` / `updateSynthParams` — the latter re-targets every live voice — with no value change. The drum-filter subscription (engineSync.ts:61-70) already shows the encoded-primitive pattern to copy.

**No intended sound change.** Every fix removes an artefact.

**Files:**
- Modify: `src/audio/playback/chordPlayback.ts:93-110`, `:254-271`
- Modify: `src/audio/playback/arpPlayback.ts:24-56`
- Modify: `src/audio/playback/presetPreview.ts` (whole file)
- Modify: `src/audio/playback/drumPlayback.ts`
- Modify: `src/store/engineSync.ts:72-78`
- Modify: `src/components/ChordPresetLibrary.tsx:174`, `src/components/SynthPresetLibrary.tsx:138`, `src/components/SequencerView.tsx:336`
- Modify: `src/audio/playback/chordPlayback.test.ts`
- Modify: `src/store/engineSync.test.ts`

**Interfaces:**
- Consumes: `barDurationSec` (Task 1).
- Produces:
  - `presetPreview.ts`: `export type PreviewHandle = () => void;` and all three preview functions return one. `previewSynthNote` is deleted. A module-level `PREVIEW_SOURCE = 'preview'` constant is the source string for every preview.
  - `drumPlayback.ts`: `export function ensureDrumEngine(): void` — the hoisted `audioEngine.init()`.
  - `arpPlayback.ts`: `useArpPlayback(stateRef, active)` — `release` and `controlTarget` are dropped from the signature; both come off `stateRef.current`.

- [ ] **Step 1: Write the failing chordPlayback tests**

Append to `src/audio/playback/chordPlayback.test.ts`, inside `describe('emitStepEvents note-off clamping', ...)` (it starts at line 182):

```ts
  test('a strummed note on a chord last step never gets an off before its on', () => {
    const calls: Array<{ kind: 'on' | 'off'; note: string; time: number }> = [];
    const spyOn_ = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(
      (note, _p, _v, time) => { calls.push({ kind: 'on', note, time: time ?? 0 }); },
    );
    const spyOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockImplementation(
      (note, _r, time) => { calls.push({ kind: 'off', note, time: time ?? 0 }); },
    );
    try {
      // 200 BPM: one 16th is 0.075 s. A 4-note strum spreads 3 * 30 ms = 0.09 s,
      // so the last note's start is already past the chord's own end.
      const time = 10;
      const chordEnd = 10.075;
      emitStepEvents(
        [0, 1, 2, 3].map((i) => ({
          noteName: `N${i}`, velocity: 0.8, timeOffset: i * 0.03, hold: 0.2,
        })),
        SYNTH,
        'chord',
        time,
        chordEnd,
      );

      for (const note of ['N0', 'N1', 'N2', 'N3']) {
        const on = calls.find((c) => c.kind === 'on' && c.note === note)!;
        const off = calls.find((c) => c.kind === 'off' && c.note === note)!;
        expect(off.time).toBeGreaterThan(on.time);
      }
    } finally {
      spyOn_.mockRestore();
      spyOff.mockRestore();
    }
  });
```

Add `spyOn` to the `bun:test` import and `audioEngine` from `'../engine'` if the file does not already have them.

And for the loop drift, append a new describe:

```ts
describe('startPatternLoop grid alignment', () => {
  test('a late timer does not shift the loop off the audio grid', () => {
    const timers = fakeTimers(); // the helper already used at chordPlayback.test.ts:109
    try {
      let now = 10;
      const plays: number[] = [];
      const stop = startPatternLoop((time) => plays.push(time), 1.0, () => now);

      // The timer fires 40 ms late twice. Re-arming from the wall clock would
      // accumulate that lag; the loop must stay on 10, 11, 12.
      now += 1.04;
      timers.fire();
      now += 1.04;
      timers.fire();

      expect(plays).toEqual([10, 11, 12]);
      stop();
    } finally {
      timers.restore();
    }
  });

  test('a stall past a whole bar re-anchors instead of scheduling in the past', () => {
    const timers = fakeTimers();
    try {
      let now = 10;
      const plays: number[] = [];
      const stop = startPatternLoop((time) => plays.push(time), 1.0, () => now);

      now += 30; // tab backgrounded
      timers.fire();

      // Scheduling at 11 while the clock reads 40 would fire the whole bar at once.
      expect(plays.at(-1)!).toBeGreaterThanOrEqual(30);
      stop();
    } finally {
      timers.restore();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/audio/playback/chordPlayback.test.ts`
Expected: FAIL — the strum off lands at 10.075 while the on is at 10.09; the drift test yields `[10, 11.04, 12.08]`.

- [ ] **Step 3: Fix `emitStepEvents`**

Replace chordPlayback.ts:100-109:

```ts
  for (const ev of events) {
    const start = time + ev.timeOffset;
    audioEngine.triggerSynthNoteOn(ev.noteName, params, ev.velocity, start, source);
    // The clamp to chordEnd stops a long feel hold from overlapping the next
    // chord — but a strum's later notes start up to (n-1)*30 ms after `time`,
    // and on a chord's LAST step at high bpm (200 bpm = 0.075 s/step) that
    // start is already past chordEnd. Floor the gate at 10 ms so the note-off
    // can never precede its own note-on.
    const off = Math.max(start + 0.01, Math.min(start + ev.hold, chordEnd));
    audioEngine.triggerSynthNoteOff(ev.noteName, params.release, off, source);
  }
```

- [ ] **Step 4: Fix `startPatternLoop`**

Replace chordPlayback.ts:254-271:

```ts
export function startPatternLoop(
  play: (time: number) => void,
  barSeconds: number,
  getNow: () => number,
): () => void {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  // The next bar's position on the AUDIO clock. Re-arming the timer from the
  // wall clock alone lets every late callback shift the loop permanently off
  // the grid; correcting the sleep against this keeps it anchored.
  let nextTime = getNow();

  const tick = () => {
    const now = getNow();
    // A stall (backgrounded tab) can leave nextTime in the past; scheduling
    // there fires the whole bar at once, so re-anchor like the engine clock does.
    if (nextTime < now) nextTime = now;
    play(nextTime);
    nextTime += barSeconds;
    timerId = globalThis.setTimeout(tick, Math.max(0, (nextTime - getNow()) * 1000));
  };
  tick();

  return () => {
    if (timerId !== undefined) globalThis.clearTimeout(timerId);
    timerId = undefined;
  };
}
```

- [ ] **Step 5: Run the chordPlayback tests**

Run: `bun test src/audio/playback/chordPlayback.test.ts`
Expected: PASS, including the pre-existing loop test at line 109 (which expects `[10, 11, 12]` with an exactly-on-time clock — unchanged by this).

- [ ] **Step 6: Fix the arp subscription**

Replace `src/audio/playback/arpPlayback.ts:24-56`:

```ts
/**
 * Arpeggiator clock subscriber. `stateRef` mirrors the view's live arp state
 * (held notes, params, control target, bpm).
 *
 * `release` and `controlTarget` are read from the ref, NOT from props: having
 * them in the dependency array made every Release-knob pointer move tear the
 * subscription down and run the cleanup, which calls releaseSoundingVoices and
 * cut every held arp note mid-drag.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
      const { activeNotes, params, controlTarget: target, bpm } = stateRef.current;

      if (!params.arpActive) return;
      if (activeNotes.size === 0) return;

      const sequence = buildArpSequence(activeNotes, params.arpMode, params.arpOctaves);
      if (sequence.length === 0) return;

      const stepDur16 = stepDurationSec(bpm);
      for (const t of computeArpTriggers(step, sequence.length, params.arpRate, stepDur16)) {
        const note = sequence[t.noteIndex];
        audioEngine.triggerSynthNoteOn(note, params, 0.9, time + t.timeOffsetSec, target);
        audioEngine.triggerSynthNoteOff(note, params.release, time + t.timeOffsetSec + t.holdSec, target);
      }
    });

    return () => {
      unsubscribe();
      if (audioEngine.getAudioContext()) {
        const { controlTarget, params } = stateRef.current;
        audioEngine.releaseSoundingVoices(controlTarget, params.release);
      }
    };
  }, [active, stateRef]);
}
```

(The `params.arpMode` / `params.arpOctaves` / `params.arpRate` reads drop their `??` defaults because Task 10 makes those fields required. If Task 10 has not run yet, keep the `??` for now and remove them there.)

Update the call site. Run `grep -rn "useArpPlayback" src` and change it to `useArpPlayback(arpStateRef, arpEnabled)` — dropping the two extra arguments.

- [ ] **Step 7: Rewrite `presetPreview.ts`**

```ts
import { audioEngine } from '../engine';
import type { SynthParams, ChordItem } from '../../types';
import type { SynthPresetItem } from '../synthPresets';

/**
 * One-shot previews for library entries (synth patches, chord templates,
 * sequencer rows). Components reach the engine only through these wrappers
 * (layering rule 3).
 */

/**
 * Auditions run on their own source bus. The default 'synth' bus carries the
 * user's held keyboard notes, so a disposer firing there would cut them.
 */
const PREVIEW_SOURCE = 'preview';

/** Stops whatever the preview scheduled. Always safe to call more than once. */
export type PreviewHandle = () => void;

const NOOP: PreviewHandle = () => undefined;

function stopPreview(): void {
  audioEngine.stopSource(PREVIEW_SOURCE, 0.05);
}

/**
 * Chord progression audition: a quick strum through every chord in sequence.
 *
 * Scheduled on the AUDIO clock rather than with setTimeout at wall-clock
 * offsets, and returns a disposer — previously, leaving the panel mid-audition
 * left every remaining chord queued in a timer with no way to cancel it.
 */
export function previewChordProgression(chords: ChordItem[], params: SynthParams): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const chordDuration = 0.5;
  stopPreview();
  chords.forEach((chord, chordIdx) => {
    const start = ctx.currentTime + chordIdx * chordDuration;
    for (const n of chord.notes) {
      audioEngine.triggerSynthNoteOn(n, params, 0.75, start, PREVIEW_SOURCE);
      audioEngine.triggerSynthNoteOff(n, 0.3, start + chordDuration * 0.85, PREVIEW_SOURCE);
    }
  });
  return stopPreview;
}

/** Synth preset audition: C4 with the preset merged over the current params. */
export function previewSynthPreset(
  preset: SynthPresetItem,
  currentParams: SynthParams,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const testParams = applyPreset(currentParams, preset);
  stopPreview();
  const start = ctx.currentTime;
  audioEngine.triggerSynthNoteOn('C4', testParams, 0.85, start, PREVIEW_SOURCE);
  audioEngine.triggerSynthNoteOff('C4', testParams.release || 0.4, start + 0.45, PREVIEW_SOURCE);
  return stopPreview;
}

/** Sequencer track audition (synth/bass rows): one note with a 0.5 s gate. */
export function previewSequencerNote(
  note: string,
  params: SynthParams,
  velocity = DEFAULT_VELOCITY,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  stopPreview();
  const start = ctx.currentTime;
  audioEngine.triggerSynthNoteOn(note, params, velocity, start, PREVIEW_SOURCE);
  audioEngine.triggerSynthNoteOff(note, 0.3, start + 0.5, PREVIEW_SOURCE);
  return stopPreview;
}
```

Add the imports `import { DEFAULT_VELOCITY } from '../constants';` and `import { applyPreset } from '../synthPresets';` (`applyPreset` is created in Task 11 — until then, keep the inline `{ ...currentParams, ...preset.params, preset: preset.name }` spread and swap it there).

`previewSynthNote` is deleted. Confirm first: `grep -rn "previewSynthNote" src` must return only the declaration.

- [ ] **Step 8: Dispose the preview handles at the call sites**

In each of the three components, store the handle in a ref and dispose it on unmount and before starting a new one.

`src/components/ChordPresetLibrary.tsx` — near the existing `auditioningName` state:

```tsx
  const previewRef = useRef<PreviewHandle | null>(null);
  useEffect(() => () => previewRef.current?.(), []);
```

and replace line 174:

```tsx
    previewRef.current?.();
    previewRef.current = previewChordProgression(chordsToPlay, synthParams);
```

Do the same in `src/components/SynthPresetLibrary.tsx:138` (`previewSynthPreset`) and `src/components/SequencerView.tsx:336` (`previewSequencerNote`). Import `PreviewHandle` as a type from `'../audio/playback/presetPreview'`.

- [ ] **Step 9: Hoist the drum `init()`**

Replace `src/audio/playback/drumPlayback.ts`:

```ts
import { audioEngine } from '../engine';

/**
 * `init()` is idempotent but not free — and triggerPad is called from inside
 * the sequencer's clock callback (useSequencerPlayback.ts:100), i.e. ~8x per
 * second during playback. Callers that fire on a user gesture call this once;
 * the per-step path does not call it at all.
 */
export function ensureDrumEngine(): void {
  audioEngine.init();
}

/**
 * Unified drum trigger for pads, sequencer steps, and previews. `time` is the
 * audio-clock time for scheduled hits (sequencer); undefined plays immediately.
 * Assumes the AudioContext already exists — call ensureDrumEngine() on the
 * gesture that starts playback, not per hit.
 */
export function triggerPad(instrument: string, volume: number, time?: number): void {
  audioEngine.triggerDrum(instrument, volume, time);
}
```

Then:
- `src/components/DrumPads.tsx:33` — call `ensureDrumEngine()` at the top of the `triggerPad` callback (a pad press is a user gesture, so this is the correct place for it).
- `src/components/SequencerView.tsx:338` — call `ensureDrumEngine()` immediately before `triggerPad(track.instrument, 0.8)`.
- `src/components/useSequencerPlayback.ts` — call `ensureDrumEngine()` once inside the `useEffect` that sets up the clock subscription, **before** `subscribePlaybackClock(...)` (around line 115), not inside the callback.

- [ ] **Step 10: Write the failing engineSync test**

Append to `src/store/engineSync.test.ts`:

```ts
  test('a respread effects object with unchanged values does not re-run updateEffects', () => {
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});
    startEngineSync();
    updateEffects.mockClear();

    // Any action that rebuilds the object without changing a value.
    useAppStore.setState((s) => ({ effects: { ...s.effects } }));

    expect(updateEffects).not.toHaveBeenCalled();
    updateEffects.mockRestore();
  });

  test('a real effects change still reaches the engine', () => {
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});
    startEngineSync();
    updateEffects.mockClear();

    useAppStore.setState((s) => ({ effects: { ...s.effects, reverbWet: 0.5 } }));

    expect(updateEffects).toHaveBeenCalledTimes(1);
    expect(updateEffects.mock.calls[0][0].reverbWet).toBe(0.5);
    updateEffects.mockRestore();
  });

  test('a respread synthParams object does not re-target live voices', () => {
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockImplementation(() => {});
    startEngineSync();
    updateSynthParams.mockClear();

    useAppStore.setState((s) => ({ synthParams: { ...s.synthParams } }));

    // updateSynthParams re-shapes every live voice; re-running it for no value
    // change cancels and re-plans their ramps for nothing.
    expect(updateSynthParams).not.toHaveBeenCalled();
    updateSynthParams.mockRestore();
  });
```

- [ ] **Step 11: Run it to verify it fails**

Run: `bun test src/store/engineSync.test.ts`
Expected: FAIL — both respread cases call through.

- [ ] **Step 12: Encode the two object subscriptions**

Replace `src/store/engineSync.ts:72-78`:

```ts
  // effects + synth params: subscribed as an encoded primitive so the
  // subscription fires only on a real VALUE change. Keying on object identity
  // re-ran updateEffects / updateSynthParams for any action that merely
  // respread the object — and updateSynthParams re-targets every live voice,
  // cancelling and re-planning their ramps for nothing. Same pattern as the
  // drum-filter subscription above.
  subs.push(
    useAppStore.subscribe(
      (s) => JSON.stringify(s.effects),
      () => audioEngine.updateEffects(useAppStore.getState().effects),
      { fireImmediately: true },
    ),
  );

  const synthSources = [
    ['synthParams', 'synth'],
    ['chordSynthParams', 'chord'],
    ['bassSynthParams', 'bass'],
  ] as const;
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => JSON.stringify(s[field]),
        () => audioEngine.updateSynthParams(useAppStore.getState()[field], source),
        { fireImmediately: true },
      ),
    );
  }
```

> `JSON.stringify` is stable here because both objects are plain literals built from a fixed set of keys (`INITIAL_EFFECTS`, `INITIAL_SYNTH_PARAMS`) and every writer spreads from those, so key order does not vary.

- [ ] **Step 13: Run the tests**

Run: `bun test src/store/engineSync.test.ts src/audio/`
Expected: PASS

- [ ] **Step 14: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/playback src/store/engineSync.ts src/store/engineSync.test.ts src/components/ChordPresetLibrary.tsx src/components/SynthPresetLibrary.tsx src/components/SequencerView.tsx src/components/DrumPads.tsx src/components/useSequencerPlayback.ts
git commit -m "fix(playback): keep note-offs after note-ons, anchor loops to the audio clock

Also stops the Release knob tearing down the arp subscription, gives previews
a disposer on their own bus, hoists the per-step audioEngine.init(), and keys
the effects/synthParams subscriptions on values instead of object identity."
```

---

### Task 10: Type contracts — dead `MasterEffects` fields, required arp fields, one `ArpMode`/`ArpRate`

**Why:** Three type-level lies in `src/types.ts`.

1. `MasterEffects` still declares `delayTime`, `chorusWet`, `chorusRate`, `chorusDepth` (types.ts:96-99). Nothing implements them — `store.ts:234` actively *deletes* them during migrate, and `dsp-audio/SKILL.md:121-123` warns not to wire UI to them. A declared-but-unimplemented field is an invitation to wire exactly that UI.
2. The four `arp*` fields are optional (types.ts:42-45) but are always set by `INITIAL_SYNTH_PARAMS` (initialState.ts:26-29) and always sanitized by `sanitizeSynthParams` (store.ts:160-175, which iterates `Object.entries(INITIAL_SYNTH_PARAMS)` and so covers all four). The optionality costs `?? 'up'` / `?? '16n'` / `?? 1` / `?? false` at **13** read sites.
3. `types.ts:43-44` inlines the same `'up' | 'down' | 'updown' | 'random'` and `'4n' | '8n' | '16n' | '32n'` unions that `arpeggiator.ts:3` and `arpSchedule.ts:1` export as named types, with no link between them. `types.ts` must stay a leaf (its own header comment, types.ts:1-7, says so), so the unions move **into** `types.ts` and the audio modules re-export them.

**No sound change.** Types and defaulting only.

**Files:**
- Modify: `src/types.ts:42-45`, `:89-107`
- Modify: `src/audio/arpeggiator.ts:1-3`, `src/audio/arpSchedule.ts:1`
- Modify: `src/components/SynthView.tsx:317,1267,1290,1314`
- Modify: `src/components/SimpleSynthPanel.tsx:225,241,250`
- Modify: `src/audio/playback/arpPlayback.ts` (already handled in Task 9 — verify the `??` are gone)
- Modify: `src/audio/playback/chordPlayback.ts:178,179,183`
- Modify: `src/components/chord/useChordPlayback.ts:136,137`
- Modify: `src/store/store.ts:234` (keep the delete list)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/types.ts`: `export type ArpMode = 'up' | 'down' | 'updown' | 'random'`, `export type ArpRate = '4n' | '8n' | '16n' | '32n'`; `SynthParams.arpActive: boolean`, `.arpMode: ArpMode`, `.arpRate: ArpRate`, `.arpOctaves: number` (all required); `MasterEffects` loses `delayTime`, `chorusWet`, `chorusRate`, `chorusDepth`.
  - `src/audio/arpeggiator.ts`: `export type { ArpMode } from '../types';`
  - `src/audio/arpSchedule.ts`: `export type { ArpRate } from '../types';`

- [ ] **Step 1: Write the failing test**

Append to `src/audio/synthPresets.test.ts` (or create `src/types.contract.test.ts` if that file's imports do not suit):

```ts
import { INITIAL_SYNTH_PARAMS, INITIAL_EFFECTS } from '../store/initialState';
import type { ArpMode, ArpRate } from '../types';

describe('SynthParams arp contract', () => {
  test('every arp field is present on the factory defaults', () => {
    // The fields are declared required, so nothing downstream may need a `??`.
    expect(typeof INITIAL_SYNTH_PARAMS.arpActive).toBe('boolean');
    expect(typeof INITIAL_SYNTH_PARAMS.arpMode).toBe('string');
    expect(typeof INITIAL_SYNTH_PARAMS.arpRate).toBe('string');
    expect(typeof INITIAL_SYNTH_PARAMS.arpOctaves).toBe('number');
  });

  test('ArpMode and ArpRate have exactly one definition, re-exported by the audio modules', async () => {
    const arpeggiator = await import('../audio/arpeggiator');
    const arpSchedule = await import('../audio/arpSchedule');
    // Types erase at runtime, so this pins the RE-EXPORT surface instead: both
    // modules must still expose the names the rest of the app imports.
    expect(Object.keys(arpeggiator)).toContain('buildArpSequence');
    expect(Object.keys(arpSchedule)).toContain('computeArpTriggers');
    const mode: ArpMode = 'updown';
    const rate: ArpRate = '32n';
    expect(arpeggiator.buildArpSequence(['C4', 'E4'], mode, 1).length).toBe(2);
    expect(arpSchedule.computeArpTriggers(0, 2, rate, 0.25).length).toBe(2);
  });
});

describe('MasterEffects has no unimplemented fields', () => {
  test('the factory effects object is exactly the implemented set', () => {
    // A declared-but-unimplemented field is an invitation to wire UI to it;
    // store.ts's migrate already strips these from old payloads.
    expect(Object.keys(INITIAL_EFFECTS).sort()).toEqual([
      'compressorThreshold', 'delayFeedback', 'delayWet', 'distortionWet',
      'eqHigh', 'eqLow', 'eqMid', 'reverbDecay', 'reverbWet',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/synthPresets.test.ts`
Expected: FAIL — `ArpMode`/`ArpRate` are not exported from `../types`.

- [ ] **Step 3: Update `src/types.ts`**

Insert above `SynthParams` (after line 19):

```ts
/**
 * Arpeggiator order and rate. Declared here rather than in audio/arpeggiator.ts
 * and audio/arpSchedule.ts because SynthParams needs them and this file imports
 * nothing (it must stay a leaf). Both audio modules re-export them, so their
 * existing import paths keep working — the point is that there is one definition
 * instead of an inline copy here and a named copy there that could drift.
 */
export type ArpMode = 'up' | 'down' | 'updown' | 'random';
export type ArpRate = '4n' | '8n' | '16n' | '32n';
```

Replace lines 42-45:

```ts
  // Required, not optional: INITIAL_SYNTH_PARAMS always sets all four and
  // sanitizeSynthParams always restores them, so the `?? 'up'` / `?? '16n'` /
  // `?? 1` / `?? false` that used to sit at 13 read sites were dead defaults
  // hiding the real contract.
  arpActive: boolean;
  arpMode: ArpMode;
  arpRate: ArpRate;
  arpOctaves: number;
```

Replace `MasterEffects` (lines 89-107):

```ts
export interface MasterEffects {
  reverbWet: number;
  reverbDecay: number;
  reverbBypass?: boolean;
  delayWet: number;
  delayFeedback: number;
  delayBypass?: boolean;
  distortionWet: number;
  distortionBypass?: boolean;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqBypass?: boolean;
  compressorThreshold: number;
}
```

(`delayTime`, `chorusWet`, `chorusRate`, `chorusDepth` removed. **Leave `store.ts:234`'s delete list intact** — old persisted payloads still carry them.)

- [ ] **Step 4: Re-export from the audio modules**

`src/audio/arpeggiator.ts` — replace line 3:

```ts
export type { ArpMode } from '../types';
import type { ArpMode } from '../types';
```

`src/audio/arpSchedule.ts` — replace line 1:

```ts
export type { ArpRate } from '../types';
import type { ArpRate } from '../types';
```

- [ ] **Step 5: Delete the 13 dead defaults**

| File:line | Before | After |
|---|---|---|
| `SynthView.tsx:317` | `keyboardParams.arpActive ?? false,` | `keyboardParams.arpActive,` |
| `SynthView.tsx:1267` | `(params.arpMode ?? "up") === m` | `params.arpMode === m` |
| `SynthView.tsx:1290` | `(params.arpRate ?? "16n") === r` | `params.arpRate === r` |
| `SynthView.tsx:1314` | `(params.arpOctaves ?? 1) === oct` | `params.arpOctaves === oct` |
| `SimpleSynthPanel.tsx:225` | `(params.arpRate ?? "16n") === r` | `params.arpRate === r` |
| `SimpleSynthPanel.tsx:241` | `{params.arpMode ?? "up"}` | `{params.arpMode}` |
| `SimpleSynthPanel.tsx:250` | `(params.arpMode ?? "up") === m` | `params.arpMode === m` |
| `arpPlayback.ts:36,37,42` | `params.arpMode ?? 'up'` etc. | plain reads (done in Task 9) |
| `chordPlayback.ts:178,179,183` | `params.arpMode ?? "up"` etc. | plain reads |
| `useChordPlayback.ts:136,137` | `?? 'up'` / `?? 1` (verify exact text) | plain reads |

Verify none remain: `grep -rn "arpMode ??\|arpRate ??\|arpOctaves ??\|arpActive ??" src` must return nothing.

- [ ] **Step 6: Run the type-check and tests**

Run: `bun run lint && bun test`
Expected: PASS. `tsc` will surface any remaining site that treated an arp field as possibly-undefined, and any site still reading `effects.delayTime` / `chorusWet` — there should be none, but fix whatever it finds by deleting the read.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/types.ts src/audio src/components src/store
git commit -m "refactor(types): drop unimplemented MasterEffects fields and require the arp params"
```

---

### Task 11: Dead code, DRY and the missing test coverage

**Why:** A sweep of nine small items, each with real evidence, plus the three coverage gaps.

1. `bassPatterns.ts:275-283` and `rhythmPatterns.ts:242-250` are the same group-by-`style` IIFE character for character.
2. Every bass preset carries `params.preset` equal to its own name (`bassPresets.ts:10,18,26,34,42`); no `FACTORY_PRESETS` entry does, and all three merge sites overwrite it (`SynthView.tsx:445`, `presetPreview.ts:49`, `store/instantVibes.ts:32`). Those three sites are the same three-line spread.
3. `SynthPresetItem.author` (synthPresets.ts:88) is never written or read — `grep -rn "author" src` matches only the declaration.
4. **`createdAt` (synthPresets.ts:87) is KEPT.** It is written at `presetsSlice.ts:31,56` and read nowhere in `src/`, but it is *persisted user data* inside `customSynthPresets`. Removing the write would silently strip the only chronology existing saved presets have, for a field that costs one number. Documented, not deleted.
5. `GENRE_TO_KIT` (drumKits.ts:183-196) and `GENRE_PRESETS` (`genrePresets.ts`) must have identical key sets — `SequencerView.tsx:159` builds the dropdown from `Object.keys(GENRE_PRESETS)` and `:50` looks the choice up in `GENRE_TO_KIT`. **They currently match (12 keys each);** the test is a guard against a future one-sided edit, not a bug fix.
6. `initialState.ts:88-101` and `setupMasterChain` are two sources of truth for effect defaults and already disagree: `distortionWet` 0.1 vs 0.0 (engine.ts:286), `eqLow` 2 vs 0 (engine.ts:245), `eqHigh` 3 vs 0 (engine.ts:256). Harmless only because `applyEngineSnapshot()` overwrites on the first click.
7. `arpeggiator.ts:23` `octaves ?? 1` is unreachable — the parameter is non-optional and both call sites (`arpPlayback.ts:37`, `chordPlayback.ts:179`) already default it (and after Task 10 the field is required).
8. `drumKits.ts:181` has a stray `};;` and `rhythmPatterns.ts:239` a stray `];`.
9. **Coverage:** there is no `drumKits.test.ts` and no test that every bass preset is `category: 'Bass'` (required by `InstantVibe.bassPresetId`, types.ts:195), nor for `setSourceGain`/`setSourceMuted` ramps and `setMasterVolume` clamping.

> **Correction to the brief:** `mergeDrumKit` is **not** shallow in a harmful way. `{ ...DEFAULT_DRUM_KIT.kick, ...partial?.kick }` (drumKits.ts:199-207) merges *within* each drum type, and every `DrumKit` value is a flat number (drumKits.ts:21,34,49), so `mergeDrumKit({ kick: { gain: 1 } })` **keeps** `freqStart`. Nothing to deepen. The test below pins that behaviour so it stays true.

**No sound change**, except item 6, which only makes the pre-click node values consistent — every one is overwritten by `applyEngineSnapshot()` on the first user gesture.

**Files:**
- Create: `src/audio/groupByStyle.ts`, `src/audio/drumKits.test.ts`, `src/audio/bassPresets.test.ts`
- Modify: `src/audio/bassPatterns.ts:275-283`, `src/audio/rhythmPatterns.ts:239,242-250`
- Modify: `src/audio/bassPresets.ts` (drop `preset` from all five), `src/audio/synthPresets.ts:81-90` (drop `author`, add `applyPreset`)
- Modify: `src/components/SynthView.tsx:442-447`, `src/audio/playback/presetPreview.ts`, `src/store/instantVibes.ts:29-33`
- Modify: `src/audio/drumKits.ts:181`
- Modify: `src/audio/arpeggiator.ts:23`
- Modify: `src/audio/engine.ts:245,251,256,286,294` (uniform zero seeding)
- Modify: `src/store/initialState.ts:87-101` (comment)
- Modify: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `PREVIEW_SOURCE` / `PreviewHandle` (Task 9).
- Produces:
  - `src/audio/groupByStyle.ts`: `export function groupByStyle<T extends { style: string }>(items: readonly T[]): { style: string; patterns: T[] }[]`
  - `src/audio/synthPresets.ts`: `export function applyPreset(base: SynthParams, preset: SynthPresetItem): SynthParams`
  - `SynthPresetItem` loses `author`; keeps `createdAt`.

- [ ] **Step 1: Write the failing tests**

Create `src/audio/drumKits.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_DRUM_KIT, DRUM_KITS, GENRE_TO_KIT, mergeDrumKit } from './drumKits';
import { GENRE_PRESETS } from './data/genrePresets';

const DRUM_TYPES = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'] as const;

describe('mergeDrumKit', () => {
  test('no argument returns the defaults', () => {
    expect(mergeDrumKit()).toEqual(DEFAULT_DRUM_KIT);
  });

  test('a partial override keeps the sibling params of the same drum', () => {
    // The merge is one level deep PER DRUM TYPE and every DrumKit value is a
    // flat number, so there is no third level to lose.
    const merged = mergeDrumKit({ kick: { ...DEFAULT_DRUM_KIT.kick, gain: 0.1 } });
    expect(merged.kick.gain).toBe(0.1);
    expect(merged.kick.freqStart).toBe(DEFAULT_DRUM_KIT.kick.freqStart);
    expect(merged.snare).toEqual(DEFAULT_DRUM_KIT.snare);
  });

  test('never mutates DEFAULT_DRUM_KIT', () => {
    const before = JSON.stringify(DEFAULT_DRUM_KIT);
    const merged = mergeDrumKit(DRUM_KITS['Trap Beat']);
    merged.kick.gain = 99;
    expect(JSON.stringify(DEFAULT_DRUM_KIT)).toBe(before);
  });

  test('every kit merges to a complete DrumKit', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const kit = mergeDrumKit(partial);
      for (const type of DRUM_TYPES) {
        expect(kit[type], `${name}/${type}`).toBeTruthy();
      }
      expect(Number.isFinite(kit.snare.reverbSend)).toBe(true);
      expect(Number.isFinite(kit.clap.reverbSend)).toBe(true);
      expect(Number.isFinite(kit.crash.reverbSend)).toBe(true);
    }
  });
});

describe('genre → kit mapping', () => {
  test('GENRE_TO_KIT and GENRE_PRESETS have identical key sets', () => {
    // SequencerView builds the dropdown from Object.keys(GENRE_PRESETS) and
    // looks the choice up in GENRE_TO_KIT; a one-sided edit makes a genre
    // silently fall through to `?? selectedGenre` and select no kit at all.
    expect(Object.keys(GENRE_TO_KIT).sort()).toEqual(Object.keys(GENRE_PRESETS).sort());
  });

  test('every GENRE_TO_KIT value names a real kit', () => {
    for (const [genre, kit] of Object.entries(GENRE_TO_KIT)) {
      expect(DRUM_KITS[kit], `${genre} -> ${kit}`).toBeTruthy();
    }
  });
});
```

Create `src/audio/bassPresets.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import { ALL_FACTORY_PRESETS } from './synthPresets';

describe('bass presets', () => {
  test('every bass preset is category Bass', () => {
    // InstantVibe.bassPresetId is documented (types.ts:195) as having to
    // resolve to category 'Bass'; a mis-categorised preset makes a vibe load a
    // lead patch onto the bass bus.
    for (const p of FACTORY_BASS_PRESETS) {
      expect(p.category, p.name).toBe('Bass');
    }
    expect(FACTORY_BASS_PRESETS.length).toBe(5);
  });

  test('ids are unique across the whole factory library', () => {
    const ids = ALL_FACTORY_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no preset pins its own name into params.preset', () => {
    // Every merge site overwrites it with the preset's name anyway; carrying a
    // copy in the data means two places to keep in sync for zero effect.
    for (const p of ALL_FACTORY_PRESETS) {
      expect(p.params.preset, p.name).toBeUndefined();
    }
  });
});
```

Append to `src/audio/engine.test.ts`:

```ts
describe('source bus level control', () => {
  test('setSourceGain ramps instead of stepping, and clamps to 0..1.5', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'chord');
    const bus = (engine as any).sourceBuses.get('chord');

    engine.setSourceGain('chord', 0.4);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0.4, t: ctx.currentTime, tc: 0.01 });

    engine.setSourceGain('chord', 99);
    expect(bus.gain.targets.at(-1)!.v).toBe(1.5);
    engine.setSourceGain('chord', -5);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });

  test('setSourceMuted ramps to 0 and back to the stored gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass');
    const bus = (engine as any).sourceBuses.get('bass');
    engine.setSourceGain('bass', 0.6);

    engine.setSourceMuted('bass', true);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
    expect(bus.gain.targets.at(-1)!.tc).toBe(0.01); // click-free

    engine.setSourceMuted('bass', false);
    expect(bus.gain.targets.at(-1)!.v).toBe(0.6);
  });

  test('a gain set while muted does not un-mute the bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass');
    const bus = (engine as any).sourceBuses.get('bass');

    engine.setSourceMuted('bass', true);
    engine.setSourceGain('bass', 0.9);

    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });
});

describe('master volume', () => {
  test('clamps to 0..1', () => {
    const { engine, ctx } = freshEngine();
    const masterGain = fakeNode();
    (engine as any).masterGain = masterGain;

    engine.setMasterVolume(2);
    expect(masterGain.gain.targets.at(-1)).toEqual({ v: 1, t: ctx.currentTime, tc: 0.05 });
    engine.setMasterVolume(-1);
    expect(masterGain.gain.targets.at(-1)!.v).toBe(0);
    engine.setMasterVolume(0.7);
    expect(masterGain.gain.targets.at(-1)!.v).toBe(0.7);
  });
});

describe('master chain effect defaults', () => {
  test('every wet send and EQ gain is seeded at zero', () => {
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    // The audible defaults live in INITIAL_EFFECTS and arrive via
    // applyEngineSnapshot on the first click; seeding anything else here is a
    // second source of truth that already disagreed (distortionWet 0.1 vs 0.0,
    // eqLow 2 vs 0, eqHigh 3 vs 0).
    for (const field of ['reverbGain', 'delayGain', 'distortionGain']) {
      expect((engine as any)[field].gain.value, field).toBe(0);
    }
    for (const field of ['eqLowNode', 'eqMidNode', 'eqHighNode']) {
      expect((engine as any)[field].gain.value, field).toBe(0);
    }
  });
});
```

> `masterChainCtx` is defined inside `describe('master chain')` (engine.test.ts:586). Move it to module scope, above `describe('master chain')`, so the new describe can use it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/`
Expected: FAIL — `drumKits.test.ts` and `bassPresets.test.ts` do not exist; `params.preset` is set on the bass presets; the master-chain seeds are non-zero.

- [ ] **Step 3: Extract `groupByStyle`**

Create `src/audio/groupByStyle.ts`:

```ts
/**
 * Groups pattern rows by their `style` for the style-grouped select UIs,
 * preserving first-appearance order. Extracted because bassPatterns.ts and
 * rhythmPatterns.ts carried this same IIFE character for character.
 */
export function groupByStyle<T extends { style: string }>(
  items: readonly T[],
): { style: string; patterns: T[] }[] {
  const byStyle = new Map<string, T[]>();
  for (const item of items) {
    const list = byStyle.get(item.style);
    if (list) list.push(item);
    else byStyle.set(item.style, [item]);
  }
  return Array.from(byStyle, ([style, patterns]) => ({ style, patterns }));
}
```

Replace `bassPatterns.ts:275-283`:

```ts
export const BASS_STYLE_GROUPS = groupByStyle(BASS_PATTERNS);
```

Replace `rhythmPatterns.ts:241-250` (keep the leading comment):

```ts
// Patterns grouped by style, computed once at module load for the style-grouped select UI.
export const RHYTHM_STYLE_GROUPS = groupByStyle(RHYTHM_PATTERNS);
```

Add `import { groupByStyle } from './groupByStyle';` to both.

Fix the strays: `drumKits.ts:181` `};;` → `};`, and `rhythmPatterns.ts:239` `},];` → `},\n];`.

- [ ] **Step 4: Add `applyPreset` and drop `author` / the pinned `preset` values**

`src/audio/synthPresets.ts` — replace lines 81-90:

```ts
export interface SynthPresetItem {
  id: string;
  name: string;
  category: SynthPresetCategory;
  params: Partial<SynthParams>;
  isFactory?: boolean;
  /**
   * Written by presetsSlice on save. Nothing in src/ reads it today, but it is
   * persisted user data inside `customSynthPresets` — dropping the write would
   * silently strip the only chronology existing saved presets have, for the
   * cost of one number. Kept deliberately.
   */
  createdAt?: number;
  description?: string;
}

/**
 * Load a preset over a base patch. The three call sites (SynthView's preset
 * picker, the audition preview, and instantVibes' library resolver) all wrote
 * this same three-line spread, and all three overwrite `params.preset` with the
 * preset's name — which is why no preset needs to carry its own name in params.
 */
export function applyPreset(base: SynthParams, preset: SynthPresetItem): SynthParams {
  return { ...base, ...preset.params, preset: preset.name };
}
```

`src/audio/bassPresets.ts` — delete `preset: '<Name>'` from all five `params` objects (lines 10, 18, 26, 34, 42), leaving the trailing `octave: 0 }`.

Replace the three merge sites with `applyPreset`:
- `SynthView.tsx:442-447` → `onChangeParams(applyPreset(params, preset));`
- `presetPreview.ts` (Task 9's `previewSynthPreset`) → `const testParams = applyPreset(currentParams, preset);`
- `store/instantVibes.ts:29-33` → `return applyPreset(INITIAL_SYNTH_PARAMS, preset);`

Verify `author` is gone: `grep -rn "author" src` must return nothing.

- [ ] **Step 5: Seed the master chain effects uniformly**

`src/audio/engine.ts` — the EQ gains at lines 245, 251, 256 are already `0`. Change:
- Line 286: `this.distortionGain.gain.value = 0.0;` → keep, but add the comment below.
- Line 275: `this.delayGain.gain.value = 0.2;` → `0;`
- Line 294: `this.reverbGain.gain.value = 0.25;` → `0;`

Add above the delay block (line 269):

```ts
    // Every wet send and EQ gain is seeded at ZERO. The audible defaults are
    // INITIAL_EFFECTS and arrive through applyEngineSnapshot() on the first
    // user click; seeding a second set here was a second source of truth that
    // already disagreed with initialState.ts (distortionWet 0.1 vs 0.0, eqLow
    // 2 vs 0, eqHigh 3 vs 0) and was silently overwritten anyway.
```

`src/store/initialState.ts` — replace the comment at lines 87-90:

```ts
// The ONLY source of truth for the audible effect defaults. setupMasterChain()
// seeds every wet send and EQ gain at zero; these values reach the graph via
// applyEngineSnapshot() on the first user click and are clamped through
// audio/effectLimits.ts on the way in.
```

- [ ] **Step 6: Drop the unreachable `??`**

`src/audio/arpeggiator.ts:23`:

```ts
  // `octaves` is a required number (SynthParams.arpOctaves); only the clamp is
  // load-bearing — a 0 or negative value would produce an empty sequence.
  const octCount = Math.max(1, octaves);
```

- [ ] **Step 7: Run the tests**

Run: `bun test src/audio/ src/store/`
Expected: PASS. If `instantVibes.test.ts` asserted a `params.preset` value coming from a bass preset's own data, it still passes — `applyPreset` sets it from `preset.name`, which is the same string.

- [ ] **Step 8: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio src/store src/components/SynthView.tsx
git commit -m "refactor(audio): remove dead fields, share groupByStyle/applyPreset, add coverage

Adds drumKits and bassPresets test suites, pins the GENRE_PRESETS/GENRE_TO_KIT
key sets, and covers setSourceGain/setSourceMuted/setMasterVolume."
```

---

### Task 12: Reformat `genrePresets.ts` to one line per 16-step row

**Why:** `src/audio/data/genrePresets.ts` is 1540 lines for 1344 booleans (12 genres × 7 instruments × 16 steps) — one boolean per line. Its sibling `src/audio/data/vibeDrumPatterns.ts` writes identical 16-step grids as single-line `[1,0,0,0,…]` arrays in 98 lines, where the pattern is actually *readable* as a rhythm. This is a formatting change only.

**The deliberate decision NOT to merge the two libraries (recorded at `vibeDrumPatterns.ts:9-15`) stands.** This task reformats one file; it does not unify them.

**No data change and no sound change.** The task includes a step that proves it.

**Files:**
- Modify: `src/audio/data/genrePresets.ts`
- Test: `src/audio/data/genrePresets.test.ts` (already exists and asserts 16 steps of booleans everywhere)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `GENRE_PRESETS`'s type and value are byte-for-byte identical after parsing.

- [ ] **Step 1: Snapshot the parsed data BEFORE touching the file**

```bash
cd /Users/Pathompong/Sites/Personal/solna
bun -e "import {GENRE_PRESETS} from './src/audio/data/genrePresets.ts'; console.log(JSON.stringify(GENRE_PRESETS))" \
  > /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/genre-before.json
wc -c /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/genre-before.json
```

Expected: a non-empty JSON file. **Do not proceed without it** — it is the only proof the reformat is data-preserving.

- [ ] **Step 2: Reformat mechanically**

Write and run a one-off script (in the scratchpad, not the repo) that re-emits the module from the parsed data, so no row can be mistyped by hand:

```bash
cat > /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/reformat.ts <<'EOF'
import { GENRE_PRESETS } from '/Users/Pathompong/Sites/Personal/solna/src/audio/data/genrePresets.ts';

const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

const body = Object.entries(GENRE_PRESETS)
  .map(([genre, instruments]) => {
    const rows = Object.entries(instruments)
      .map(([inst, steps]) => `    ${key(inst)}: [${steps.join(', ')}],`)
      .join('\n');
    return `  ${key(genre)}: {\n${rows}\n  },`;
  })
  .join('\n');

const out = `// Genre -> instrument -> 16-step boolean pattern. Moved verbatim from
// SequencerView.tsx (was lines 23-1560).
//
// One line per 16-step row, matching the sibling vibeDrumPatterns.ts: a rhythm
// is only readable as a row. The two libraries stay SEPARATE on purpose — see
// the note at vibeDrumPatterns.ts:9-15.
export const GENRE_PRESETS: Record<string, Record<string, boolean[]>> = {
${body}
};
`;

await Bun.write('/Users/Pathompong/Sites/Personal/solna/src/audio/data/genrePresets.ts', out);
EOF
bun run /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/reformat.ts
wc -l src/audio/data/genrePresets.ts
```

Expected: roughly 95-100 lines, down from 1540.

- [ ] **Step 3: Prove the data is unchanged**

```bash
bun -e "import {GENRE_PRESETS} from './src/audio/data/genrePresets.ts'; console.log(JSON.stringify(GENRE_PRESETS))" \
  > /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/genre-after.json
diff /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/genre-before.json \
     /private/tmp/claude-501/-Users-Pathompong-Sites-Personal-solna/f7fddddd-4b61-4117-b3fe-c459f20a8205/scratchpad/genre-after.json \
  && echo "IDENTICAL"
```

Expected: `IDENTICAL`, exit 0. **If `diff` reports anything, `git checkout src/audio/data/genrePresets.ts` and stop** — the reformat is not safe and must be investigated.

- [ ] **Step 4: Run the existing data-sanity test**

Run: `bun test src/audio/data/genrePresets.test.ts`
Expected: PASS — every genre defines a 16-step boolean pattern for every instrument.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run verify && bun run eslint
git add src/audio/data/genrePresets.ts
git commit -m "style(data): write genre drum patterns one row per line

Regenerated from the parsed value; JSON.stringify of GENRE_PRESETS is
byte-identical before and after. 1540 lines -> ~98. The decision to keep
GENRE_PRESETS and VIBE_DRUM_PATTERNS separate (vibeDrumPatterns.ts:9-15) stands."
```

---

## Self-Review

**1. Finding coverage.** Every item in the brief maps to a task:

| Group | Finding | Task |
|---|---|---|
| A | listener try/catch + counters before dispatch | 2 |
| A | `step % 16` → `STEPS_PER_BAR` | 2 (constant from 1) |
| A | `setBpm` clamp | 2 |
| A | clock test suite | 2 |
| B | reverb decay is a duration | 4 |
| B | clamp `updateEffects` + `sanitizePersistedState`, one table | 3 |
| B | quantise + cache the impulse | 4 |
| B | `masterGain = 0.6` honesty + SKILL.md | 3 |
| C | `cancelAndHold` in `applySynthVelocityScale` | 5 |
| C | iterate `sourceVoices` in both, shared predicate | 5 |
| C | future-voice hard silence, `stopSource` guard | 6 |
| C | stored `releaseTime` | 6 |
| C | env-ends-at from the clamped attack | 5 |
| C | `cancelAndHold` reads `param.value` first | 5 |
| C | dedup forwards `time` | 5 |
| C | `filterEnvLevels` + `clampCutoff` | 5 |
| C | `Number.MIN_VALUE` → explicit initial level | 5 |
| C | duplicated comment | 5 |
| D | tremolo series VCA + live target switch + SKILL.md | 7 |
| D | depth-zero stop + disconnect | 7 |
| D | LFO tests | 7 |
| E | all nine drum items + refactor | 8 |
| F | strum note-off ordering | 9 |
| F | arp deps / ref cleanup | 9 |
| F | preview disposers, audio-clock scheduling, dead `previewSynthNote` | 9 |
| F | `startPatternLoop` drift | 9 |
| F | hoisted `drumPlayback` init | 9 |
| F | engineSync object identity | 9 |
| G | `MasterEffects` legacy fields | 10 |
| G | required arp fields | 10 |
| G | one `ArpMode`/`ArpRate` | 10 |
| G | `stepDurationSec`/`barDurationSec` | 1 |
| G | `DEFAULT_VELOCITY` | 1 |
| G | `groupByStyle` | 11 |
| G | bass preset `params.preset` + `applyPreset` | 11 |
| G | `author` removed, `createdAt` kept with reason | 11 |
| G | `GENRE_TO_KIT` key-set test | 11 |
| G | uniform master-chain effect seeding | 11 |
| G | `octaves ?? 1` | 11 |
| G | `};;` and `];` strays | 11 |
| G | `genrePresets.ts` reformat | 12 |
| H | `drumKits.test.ts` | 11 |
| H | bass presets are `category: 'Bass'` | 11 |
| H | `setSourceGain`/`setSourceMuted`/`setMasterVolume`/aliases/fall-through | 8, 11 |

**2. Findings that the code contradicts** — both are corrected inline, with the correction marked in the task that owns them:

- **`GENRE_TO_KIT` has 12 keys and `GENRE_PRESETS` has 12, not 10.** `'Boom Bap'` (`genrePresets.ts:388`) and `'Lo-Fi Hip-Hop'` (`:1412`) are quoted keys, which is why a scan missed them. Verified: `bun -e "…"` prints `presets 12 / kits 12 / missing []`. Task 11 keeps the test as a *guard*, not a fix.
- **`mergeDrumKit` does not drop sibling params.** `{ ...DEFAULT_DRUM_KIT.kick, ...partial?.kick }` (drumKits.ts:199-207) merges within each drum type, and every `DrumKit` value is a flat number, so `{ kick: { gain: 1 } }` keeps `freqStart`. There is nothing to deepen. Task 11 pins the existing behaviour instead.

Two smaller corrections, folded in silently: the arp `??` defaulting is at **13** sites, not 12 (`SimpleSynthPanel.tsx:241` was missed), and `buildArpSequence` has **two** callers that already default `octaves`, not one.

**3. Type and name consistency.** Checked across tasks:
- `STEPS_PER_BAR` is defined in `utils/musicTheory.ts` (Task 1) and re-exported from `audio/engine.ts`, so `chordPlayback.ts:1`, `playbackEngine.ts:1`, `useSequencerPlayback.ts:6` and `useChordPlayback.ts:30` are never edited.
- `ENV_FLOOR` / `SILENCE` / `clampCutoff` / `clampVelocity` / `DEFAULT_VELOCITY` all come from `audio/constants.ts` (Task 1) and are used with those exact names in Tasks 5, 6 and 8.
- `reshapeableVoices` (Task 5) is the single voice-selection predicate used by both `applySynthVelocityScale` and `updateSynthParams`; `silenceVoiceNow` (Task 6) is the only hard-stop path, called from `stopSource` and `releaseSoundingVoices`.
- `tremoloGain` is a `SynthVoice` field, **not** appended to `gains` — `engine.test.ts:805` pins `gains[0]`/`gains[1]` as main/sub.
- `applyPreset(base, preset)` (Task 11) is consumed by `presetPreview.previewSynthPreset` (Task 9). Task 9 notes to keep the inline spread until Task 11 lands, since the tasks may be executed out of order.
- `drumSendFilter` is created in `setupMasterChain`, updated in `setDrumFilter`, and consumed by `wireDrumVoice` — all in Task 8.
- Task 3 creates `effectLimits.ts`; Task 4 imports `EFFECT_LIMITS.reverbDecay` from it. Task 4 must run after Task 3.

**4. Ordering dependencies.** 1 → 2, 1 → 5/6/8, 3 → 4, 5 → 6 → 7 (all three edit `SynthVoice` and `releaseVoice`), 8 depends on 1's constants, 9 is independent of 5-8 but Task 10 removes the `??` it leaves behind, 11 depends on 9 for `previewSynthPreset`, 12 is fully independent.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-27-audio-dsp-remediation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

