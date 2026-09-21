# Source-Bus Startup Transient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every muted source silent from sample zero during playback restart and offline mixdown while preserving click-free interactive changes.

**Architecture:** Add one atomic source-bus state operation with explicit `settle` and `transition` modes. Keep the existing fader and mute delegates for interactive edits, but route initialization, fully-stopped restart, and offline time zero through the atomic settle path.

**Tech Stack:** TypeScript, Web Audio API, React/Zustand bridge, Bun tests, `OfflineAudioContext` test fakes.

**Spec:** `docs/superpowers/specs/2026-09-20-audio-runtime-recovery-and-incident-reporting-design.md`

## Global Constraints

- `src/audio/` must not import `src/store/` or `src/components/`.
- A muted source at audio time zero must be zero before an event at time zero renders.
- `settle` is immediate; `transition` remains click-free.
- Lead, FX, Chord, Bass, Pad, and Beat share the same source-bus contract.
- No browser-specific branch is allowed until a shared conformance test proves one is required.
- Every task follows red-green-refactor and ends with a focused commit.

---

## File map

| File | Responsibility |
|---|---|
| `src/audio/automation/sourceBusAutomation.ts` | Apply immediate or click-free gain automation to one `AudioParam` |
| `src/audio/automation/sourceBusAutomation.test.ts` | Pin exact Web Audio calls for both modes and fallback behavior |
| `src/audio/masterRack.ts` | Own atomic `{ gain, muted }` state and apply it to source nodes |
| `src/audio/masterRack.test.ts` | Prove atomic state never exposes an intermediate audible value |
| `src/audio/engine.ts` | Delegate the atomic operation through the stable facade |
| `src/store/engineSync.ts` | Settle all buses during initial snapshot and fully-stopped restart |
| `src/store/engineSync.test.ts` | Pin store-to-engine ordering and one atomic write per bus |
| `src/audio/export/renderMixdown.ts` | Settle pass zero; transition later pass boundaries atomically |
| `src/audio/export/renderMixdown.test.ts` | Render muted sources at time zero and assert silence |

### Task 1: Define the source-bus automation primitive

**Files:**
- Create: `src/audio/automation/sourceBusAutomation.ts`
- Create: `src/audio/automation/sourceBusAutomation.test.ts`

**Interfaces:**
- Produces: `SourceBusApplyMode = 'settle' | 'transition'`
- Produces: `applySourceBusAutomation(param, targetGain, at, mode): void`
- Consumes: only the `AudioParam` methods declared by `SourceBusAutomationParam`

- [ ] **Step 1: Write failing tests for immediate settlement and transition**

Use a recording fake and assert the exact calls:

```ts
expect(callsFor('settle')).toEqual([
  ['cancelScheduledValues', 0],
  ['setValueAtTime', 0, 0],
]);

expect(callsFor('transition')).toEqual([
  ['cancelAndHoldAtTime', 4],
  ['setTargetAtTime', 0, 4, SOURCE_BUS_TIME_CONSTANT_SEC],
]);
```

Add a third test where `cancelAndHoldAtTime` throws and expect
`cancelScheduledValues(at)` followed by `setValueAtTime(param.value, at)` before
`setTargetAtTime`.

- [ ] **Step 2: Run the new test and verify red**

Run: `bun test src/audio/automation/sourceBusAutomation.test.ts`

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Implement the minimal primitive**

```ts
export const SOURCE_BUS_TIME_CONSTANT_SEC = 0.01;
export type SourceBusApplyMode = 'settle' | 'transition';

export interface SourceBusAutomationParam {
  value: number;
  cancelScheduledValues(at: number): void;
  cancelAndHoldAtTime(at: number): void;
  setValueAtTime(value: number, at: number): void;
  setTargetAtTime(value: number, at: number, constant: number): void;
}

export function applySourceBusAutomation(
  param: SourceBusAutomationParam,
  targetGain: number,
  at: number,
  mode: SourceBusApplyMode,
): void {
  if (mode === 'settle') {
    param.cancelScheduledValues(at);
    param.setValueAtTime(targetGain, at);
    return;
  }
  try {
    param.cancelAndHoldAtTime(at);
  } catch {
    const held = param.value;
    param.cancelScheduledValues(at);
    param.setValueAtTime(held, at);
  }
  param.setTargetAtTime(targetGain, at, SOURCE_BUS_TIME_CONSTANT_SEC);
}
```

- [ ] **Step 4: Run the focused test and verify green**

Run: `bun test src/audio/automation/sourceBusAutomation.test.ts`

Expected: all source-bus automation tests pass.

- [ ] **Step 5: Commit the primitive**

```bash
git add src/audio/automation/sourceBusAutomation.ts src/audio/automation/sourceBusAutomation.test.ts
git commit -m "fix(audio): define deterministic source bus automation"
```

### Task 2: Make source-bus state atomic in `MasterRack`

**Files:**
- Modify: `src/audio/masterRack.ts:841-909`
- Modify: `src/audio/masterRack.test.ts`
- Modify: `src/audio/engine.ts:50-90`
- Modify: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `SourceBusApplyMode`, `applySourceBusAutomation`
- Produces: `SourceBusState = { gain: number; muted: boolean }`
- Produces: `AudioEngine.setSourceState(source, state, time?, mode?): void`
- Preserves: `setSourceGain` and `setSourceMuted` as transition-mode delegates

- [ ] **Step 1: Add failing MasterRack and facade tests**

Cover these cases:

```ts
rack.setSourceState('synth', { gain: 0.8, muted: true }, 0, 'settle');
expect(synthBus.gain.calls).toEqual([
  ['cancelScheduledValues', 0],
  ['setValueAtTime', 0, 0],
]);
```

Assert that one call updates both remembered fields, that a later
`setSourceMuted('synth', false)` targets `0.8`, and that the engine facade forwards all
four arguments unchanged.

- [ ] **Step 2: Run focused tests and verify red**

Run: `bun test src/audio/masterRack.test.ts src/audio/engine.test.ts`

Expected: FAIL because `setSourceState` does not exist.

- [ ] **Step 3: Implement atomic state application**

Add the public type and method:

```ts
export interface SourceBusState {
  gain: number;
  muted: boolean;
}

setSourceState(
  source: string,
  state: SourceBusState,
  time?: number,
  mode: SourceBusApplyMode = 'transition',
): void {
  const gain = Math.max(0, Math.min(MAX_FADER_GAIN, state.gain));
  this.sourceGains.set(source, gain);
  this.sourceMuted.set(source, state.muted);
  if (!this.ctx) return;
  const at = Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime);
  this.applySourceLevel(source, state.muted ? 0 : gain, at, mode);
}
```

Replace `rampSourceLevel` with `applySourceLevel`, using
`applySourceBusAutomation(node.gain, targetGain, at, mode)`. Rewrite existing setters
to call `setSourceState` with the other remembered field and `transition` mode. Add the
matching one-line `AudioEngine` delegate.

- [ ] **Step 4: Run focused tests and verify green**

Run: `bun test src/audio/automation/sourceBusAutomation.test.ts src/audio/masterRack.test.ts src/audio/engine.test.ts`

Expected: all pass; existing interactive ramp assertions remain unchanged except for
the intentional cancel-and-hold sequence.

- [ ] **Step 5: Commit atomic source state**

```bash
git add src/audio/automation src/audio/masterRack.ts src/audio/masterRack.test.ts src/audio/engine.ts src/audio/engine.test.ts
git commit -m "fix(audio): apply source bus state atomically"
```

### Task 3: Settle live playback before the first scheduled step

**Files:**
- Modify: `src/store/engineSync.ts:130-230,396-430`
- Modify: `src/store/engineSync.test.ts`

**Interfaces:**
- Consumes: `audioEngine.setSourceState(source, state, time?, mode?)`
- Produces: private `pushSourceState(state, bus, mode, time?): void`
- Preserves: future song-boundary writes use `sourceTransitionTime()`

- [ ] **Step 1: Add failing bridge tests**

Assert that `applyEngineSnapshot()` emits one
`setSourceState(source, state, undefined, 'settle')` per
`SOURCE_BUSES` row and emits no paired `setSourceGain`/`setSourceMuted` calls. Add a
fully-stopped-to-playing test asserting all buses are settled before `resetClock()`.
Add an interactive fader/mute test asserting a single atomic transition with the
latest `{ gain, muted }` value.

- [ ] **Step 2: Run the bridge test and verify red**

Run: `bun test src/store/engineSync.test.ts`

Expected: FAIL because the bridge still sends separate gain and mute writes.

- [ ] **Step 3: Replace paired bus subscriptions with one atomic selector**

Use a shallow-compared tuple or object per bus:

```ts
function sourceState(s: AppStore, bus: SourceBus) {
  return {
    gain: faderDbToGain(bus.selectLevelDb(s)),
    muted: !busAudible(s, bus),
  };
}
```

`applySliceState()` calls `setSourceState(source, state, undefined, 'settle')`. Each live subscription calls
one transition at `sourceTransitionTime()`. In the transport subscription, when
`flags !== 0 && prevFlags === 0`, settle every current bus before `resetClock()` so
the first step cannot observe a ramp left by a stopped-session edit.

- [ ] **Step 4: Run store and transport regression tests**

Run: `bun test src/store/engineSync.test.ts src/store/transportSlice.test.ts src/store/loadLoop.test.ts`

Expected: all pass and call ordering is snapshot/settle before clock reset.

- [ ] **Step 5: Commit live wiring**

```bash
git add src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "fix(playback): settle source buses before restart"
```

### Task 4: Settle offline time zero and prove sample silence

**Files:**
- Modify: `src/audio/export/renderMixdown.ts:462-492`
- Modify: `src/audio/export/renderMixdown.test.ts`

**Interfaces:**
- Consumes: `AudioEngine.setSourceState`
- Preserves: later pass boundaries remain click-free transitions

- [ ] **Step 1: Add a failing time-zero render regression**

Build a one-loop snapshot whose Lead grid strikes at step zero while the `synth` bus
is muted. Render it and assert that the maximum absolute sample in the first 100 ms is
zero. Parameterize the same contract for `synth`, `fx`, `chord`, `bass`, `pad`, and
`sequencer`; use a source-appropriate event fixture for each bus.

- [ ] **Step 2: Run the render test and verify red on Chromium**

Run: `bun test src/audio/export/renderMixdown.test.ts -t "muted source is silent from sample zero"`

Expected: FAIL with non-zero opening samples before settlement is fixed.

- [ ] **Step 3: Apply loop audio state atomically**

Replace paired calls in `applyMasterState` and `applyLoopAudioState`:

```ts
engine.setSourceState(
  bus.source,
  { gain: bus.gain, muted: bus.muted },
  state.time,
  state.time === 0 ? 'settle' : 'transition',
);
```

The arrangement-wide snapshot also uses `settle` at zero. Do not skip muted note
planning as a substitute; downstream silence remains an engine invariant.

- [ ] **Step 4: Run focused audio/export suites**

Run: `bun test src/audio/export/renderMixdown.test.ts src/audio/masterRack.test.ts src/store/engineSync.test.ts`

Expected: all pass, including deterministic render assertions.

- [ ] **Step 5: Run the completion gate**

Run: `bun run verify`

Expected: tests, typecheck, ESLint, domain checks, dead-code scans, and production build pass.

- [ ] **Step 6: Commit the offline contract**

```bash
git add src/audio/export/renderMixdown.ts src/audio/export/renderMixdown.test.ts
git commit -m "fix(mixdown): silence muted buses from sample zero"
```

### Task 5: Record cross-browser acceptance evidence

**Files:**
- Create: `docs/testing/audio-runtime-acceptance.md`

**Interfaces:**
- Consumes: the shared startup-silence contract from Tasks 1-4
- Produces: a repeatable manual matrix used again by the recovery plan

- [ ] **Step 1: Write the exact manual script**

Document these cases for Chrome macOS and Safari macOS: play a loud Lead loop, hard
stop, select a muted-Lead loop with a step-zero note, play, and repeat ten times;
repeat with an empty Lead grid; export the muted fixture and inspect/listen at time
zero. Record browser build, OS, result, and whether any other source leaks.

- [ ] **Step 2: Run the matrix and record results**

Expected: no audible transient in either browser and no non-zero opening samples in
the exported fixture.

- [ ] **Step 3: Commit acceptance documentation**

```bash
git add docs/testing/audio-runtime-acceptance.md
git commit -m "docs: add audio runtime acceptance matrix"
```
