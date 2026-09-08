# DEV-385: Master compressor and limiter as explicit FX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two always-on, invisible master dynamics stages into two user-visible, toggleable, default-OFF master FX modules that are genuinely disconnected from the graph when off and show live gain reduction when on.

**Architecture:** `setupMasterChain()` stops hard-wiring `compressor` and `limiter` into the master tail. Both nodes are still created and still seeded with today's values, but a single private `rewireMasterDynamics(compressorOn, limiterOn)` owns every edge below `masterGain` and rebuilds them from the two booleans in `MasterEffects`. Default topology is `eqHigh → masterGain → destination` with **both** DEV-384 analyser taps hanging off `masterGain`, so the meter always reads the pre-dynamics mix. There are two of them and they are not interchangeable: `analyser` is the 128-bin spectrum node `AudioVisualizer` draws, and `levelAnalyser` is the node `getMasterLevelAnalyser()` returns — the one `useMeterLevel` reads for `VuMeter` and `AmbientBackdrop`. **`levelAnalyser` IS the meter**, so every rewire below must re-make both sends or DEV-384's meters read `-∞` forever. State reaches the engine only through `src/store/engineSync.ts`; the per-frame `DynamicsCompressorNode.reduction` readout reaches the UI only through a new `ui/GainReductionMeter` registered with DEV-384's meter scheduler, never through a zustand slice.

**Tech Stack:** TypeScript, raw Web Audio API (`DynamicsCompressorNode`), Zustand + `persist`, React 19, daisyUI v5 theme tokens, `bun:test` with `renderToString`.

**Spec:** Linear DEV-385; shared contract at `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`

## Global Constraints

- `bun run verify` is the gate, and `bun run eslint` must report **nothing at all** — no errors, no warnings.
- Engine setters are called **only** from `src/store/engineSync.ts`. Components never import `audio/engine` unless they are on the eslint exemption list (layering rule 3).
- No meter value and **no gain-reduction readout** may enter a zustand slice — a store write per frame re-renders every mounted view.
- All four tab views stay mounted, so anything per-frame must be pausable; the gain-reduction readout registers with `registerMeter` (`src/utils/meterScheduler.ts`, DEV-384) with **no `analyser`** — the scheduler passes a zero-length buffer and stops ticking on a hidden tab.
- `src/audio/` never imports `src/store/` or `src/components/`. `src/store/` never imports `src/components/`.
- Persist `version` and project `formatVersion` are **separate chains and must never be merged**.
- A version stamped into persisted data is a contract: do not ship a guard before its output is final; keep the transform idempotent.
- No backward compatibility is required. A migration step may be a documented **reset** to defaults — its comment must say it resets.
- Every numeric `MasterEffects` value is clamped by `src/audio/effectLimits.ts` in **both** `updateEffects()` and `sanitizeEffectsValue`. New ranges go in that table, never inline.
- Theming: components name roles, never colours. `bun run check:theme` must pass; `Knob`'s `color` prop is the closed `KnobColor` union (`text-warning` is **not** in it — the dynamics modules use `text-success`).
- Testing: `bun:test` only, no DOM, no testing-library. Rendered assertions are substring checks against `renderToString` output. `useEffect` does **not** run under `renderToString`.

### Numbers this plan pins (seeded from today's engine hardcodes)

| Stage | threshold | knee | ratio | attack | release |
|---|---|---|---|---|---|
| compressor | `-12` | `30` (fixed, not exposed) | `4` | `0.003` | `0.25` |
| limiter | `-3` | `0` (fixed, not exposed) | `20` | `0.003` | `0.15` |

Both `*Enabled` flags default to `false`.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/store/masterDynamics.test.ts` | Pins the new `MasterEffects` fields, their `INITIAL_EFFECTS` defaults and their `EFFECT_LIMITS` ranges. Lives in `store/` because it reads both `store/initialState.ts` and `audio/effectLimits.ts`, and `store/` may import `audio/`. |
| `src/utils/gainReduction.ts` | Pure display maths for a gain-reduction readout: quantise, format, bar percent. No imports. |
| `src/utils/gainReduction.test.ts` | Tests for the above without rendering anything. |
| `src/components/ui/GainReductionMeter.tsx` | The per-frame readout. Reads `audioEngine` directly (layering rule 3 exemption, alongside `VuMeter`) and registers with the shared meter scheduler. |
| `src/components/ui/GainReductionMeter.test.tsx` | `renderToString` markup + token assertions. |

**Modified**

| Path | Change |
|---|---|
| `src/types.ts` | `MasterEffects` gains ten fields: `compressorEnabled`, `compressorRatio`, `compressorAttack`, `compressorRelease`, `limiterEnabled`, `limiterThreshold`, `limiterRatio`, `limiterAttack`, `limiterRelease` (plus the existing `compressorThreshold`). |
| `src/store/initialState.ts` | `INITIAL_EFFECTS` gains the ten defaults; both toggles `false`. |
| `src/audio/effectLimits.ts` | `EffectNumericKey` + `EFFECT_LIMITS` gain the eight new numeric ranges. |
| `src/audio/presetRegistry.test.ts` | The "`MasterEffects` has no unimplemented fields" key list grows to eighteen. |
| `src/store/sanitize.ts` | Coerces the two booleans; stops deleting `compressorRatio` (the name is now real). Carries the written reason the `.solna` `formatVersion` is **not** bumped. |
| `src/store/sanitize.test.ts` | Asserts the boolean coercion and that `compressorRatio` survives. |
| `src/store/migrate.ts` | New `migrateMasterDynamics` — a documented **reset** of all ten dynamics keys. |
| `src/store/migrate.test.ts` | Tests the reset and its idempotence. |
| `src/store/store.ts` | `version: 15` → `16`; one new guarded step at the bottom of the chain. |
| `src/store/store.test.ts` | The `s.effects` expectation accounts for the reset. |
| `src/audio/engine.ts` | New `dynamicsTopology` field and `rewireMasterDynamics` — which owns, and re-makes on every pass, **both** DEV-384 analyser sends (`analyser` and `levelAnalyser`); `setupMasterChain` seeds the bypassed topology and its headroom comment is rewritten; `updateEffects` writes eight params and calls the rewire; two reduction getters. |
| `src/audio/engine.test.ts` | `masterChainCtx`'s fake node learns `disconnect`; the ~line 564 test asserts the new default (bypassed) wiring; new tests for engaged wiring, limiter-only wiring, no-orphan toggling, **the meter tap surviving a toggle cycle**, and the reduction getters. Every wiring assertion names `levelAnalyser` explicitly — an assertion written as `[analyser, ctx.destination]` passes while the meter is dead. |
| `src/store/engineSync.ts` | `EFFECT_KEYS_EXCEPT_DECAY` gains the nine new comparison keys and is exported for pinning. |
| `src/store/engineSync.test.ts` | Pins the full key list. |
| `src/components/fxDescriptors.ts` | Three new descriptors: ratio, attack, release. |
| `src/components/fxDescriptors.test.ts` | Tests for them. |
| `src/components/song/EffectsRackView.tsx` | New "Master Dynamics" section with two modules (badges 5 and 6). |
| `src/components/song/EffectsRackView.test.tsx` | Asserts the two new toggles, the knobs and the tokens. |
| `eslint.config.js` | `src/components/ui/GainReductionMeter.tsx` joins the layering-rule-3 exemption list. |
| `.claude/skills/dsp-audio/SKILL.md` | The signal-graph diagram and the `masterGain` bullet describe the new tail. |

---

## Assumption about DEV-384 (verified in Task 1, Step 2)

At the time of writing, `docs/superpowers/plans/2026-09-07-dev-384-dbfs-metering.md` **does not exist**. This plan is written against the post-DEV-384 state the epic contract describes:

> `EQ → compressor → masterGain → analyser(send) → limiter → destination`, with the analyser tapped off `masterGain` (post-fader, pre-dynamics) and having **no onward output** of its own.

**DEV-384 as shipped taps TWO analysers there, not one**, and this plan is written against that:

| Field | `fftSize` | Who reads it | Is it the meter? |
|---|---|---|---|
| `analyser` | 256 (128 bins) | `AudioVisualizer` | No — spectrum only |
| `levelAnalyser` | 2048 | `getMasterLevelAnalyser()` → `useMeterLevel` → `VuMeter`, `AmbientBackdrop` | **Yes** |

DEV-384 Task 7 wires `masterGain._connectTargets === [analyser, levelAnalyser, limiter]`, and both
sends have **no onward output**. The two are not interchangeable: reconnecting only `analyser`
after a `masterGain.disconnect()` leaves the spectrum drawing and every dBFS meter reading `-∞`
forever, with no error thrown and no node missing. That failure is silent by construction, which
is why every assertion in Task 4 names `levelAnalyser` and why Task 4 carries a dedicated
meter-survives-a-rewire test.

Task 1, Step 2 re-verifies that against the real code before anything changes. If either tap is elsewhere, stop and reconcile before continuing — the whole point of this issue is that the meter stays ahead of both dynamics stages.

**What this issue adds on top of DEV-384:** the compressor moves from *before* `masterGain` to *after* it, so that both stages sit downstream of the meter tap. That is required by the acceptance criteria ("the meter taps ahead of both"). It is not a sound change today because both stages default off; when a user engages one, post-fader is also the correct place for an output safety net — pulling the master fader down should reduce how hard the net works, not leave it clamping a signal nobody is sending.

---

### Task 1: Branch, verify the DEV-384 baseline, and land the state contract

**Files:**
- Modify: `src/types.ts:190-204`
- Modify: `src/store/initialState.ts:305-323`
- Modify: `src/audio/effectLimits.ts:14-41`
- Modify: `src/audio/presetRegistry.test.ts:235-244`
- Test: `src/store/masterDynamics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MasterEffects` with `compressorEnabled: boolean`, `compressorThreshold: number`, `compressorRatio: number`, `compressorAttack: number`, `compressorRelease: number`, `limiterEnabled: boolean`, `limiterThreshold: number`, `limiterRatio: number`, `limiterAttack: number`, `limiterRelease: number`; `INITIAL_EFFECTS` carrying all ten; `EffectNumericKey` widened by eight names; `EFFECT_LIMITS` entries for those eight.

- [ ] **Step 1: Create the branch**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git checkout -b feat/dev-385-master-dynamics-fx
```

- [ ] **Step 2: Verify the DEV-384 wiring assumption against the real code**
```bash
cd /Users/Pathompong/Sites/Personal/solna
sed -n '665,705p' src/audio/engine.ts
grep -n "eqHighNode.connect\|compressor.connect\|masterGain.connect\|limiter.connect\|analyser.connect\|levelAnalyser" src/audio/engine.ts
grep -c "getMasterLevelAnalyser" src/audio/engine.ts
```
Expected: a serial tail ending at `ctx.destination`, and **both** analysers fed from `masterGain`
with no `.connect(...)` of their own — that is, the second grep must contain all four of:

```
this.masterGain.connect(this.analyser);
this.masterGain.connect(this.levelAnalyser);
this.masterGain.connect(this.limiter);
this.limiter.connect(this.ctx.destination);
```

and **no** `this.analyser.connect(` and **no** `this.levelAnalyser.connect(` line at all. The third
grep must be non-zero: `getMasterLevelAnalyser()` is what `useMeterLevel` calls, so its absence
means DEV-384 has not landed.

Two distinct stop conditions, and they fail differently:
- If you see `limiter.connect(this.analyser)` and `analyser.connect(this.ctx.destination)`, DEV-384 has **not** landed — stop and run DEV-384 first; this plan's Task 4 assumes both taps already sit on `masterGain`.
- If `analyser` is tapped off `masterGain` but there is **no `levelAnalyser`**, DEV-384 landed in a shape this plan was not written against. Stop and reconcile: Task 4 re-makes a tap it can only re-make if it knows the field's name, and the meter it feeds fails silently rather than loudly.

- [ ] **Step 3: Write the failing test**
Create `src/store/masterDynamics.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { EFFECT_LIMITS, clampEffectValue } from '../audio/effectLimits';
import { INITIAL_EFFECTS } from './initialState';

/**
 * The DEV-385 state contract. The compressor and limiter are explicit master FX
 * now: their parameters are stored, clamped and default OFF. Their seeded values
 * deliberately equal the engine's historical hardcodes, so switching a module on
 * reproduces exactly what the app used to do behind the user's back.
 */
describe('master dynamics defaults', () => {
  test('both stages default OFF', () => {
    expect(INITIAL_EFFECTS.compressorEnabled).toBe(false);
    expect(INITIAL_EFFECTS.limiterEnabled).toBe(false);
  });

  test('the compressor is seeded with the engine\'s historical values', () => {
    expect(INITIAL_EFFECTS.compressorThreshold).toBe(-12);
    expect(INITIAL_EFFECTS.compressorRatio).toBe(4);
    expect(INITIAL_EFFECTS.compressorAttack).toBeCloseTo(0.003, 6);
    expect(INITIAL_EFFECTS.compressorRelease).toBeCloseTo(0.25, 6);
  });

  test('the limiter is seeded with the engine\'s historical values', () => {
    expect(INITIAL_EFFECTS.limiterThreshold).toBe(-3);
    expect(INITIAL_EFFECTS.limiterRatio).toBe(20);
    expect(INITIAL_EFFECTS.limiterAttack).toBeCloseTo(0.003, 6);
    expect(INITIAL_EFFECTS.limiterRelease).toBeCloseTo(0.15, 6);
  });
});

describe('master dynamics clamping', () => {
  test('every new numeric field has a range, and its fallback is the factory default', () => {
    const keys = [
      'compressorThreshold',
      'compressorRatio',
      'compressorAttack',
      'compressorRelease',
      'limiterThreshold',
      'limiterRatio',
      'limiterAttack',
      'limiterRelease',
    ] as const;
    for (const key of keys) {
      expect(EFFECT_LIMITS[key]).toBeDefined();
      expect(EFFECT_LIMITS[key].fallback).toBe(INITIAL_EFFECTS[key]);
    }
  });

  test('ratio and attack/release ranges match what a DynamicsCompressorNode will accept', () => {
    // Web Audio's own AudioParam ranges: ratio 1..20, attack/release 0..1.
    // Clamping to the node's range means a clamped value is always a legal write.
    expect(EFFECT_LIMITS.compressorRatio).toEqual({ min: 1, max: 20, fallback: 4 });
    expect(EFFECT_LIMITS.limiterRatio).toEqual({ min: 1, max: 20, fallback: 20 });
    expect(clampEffectValue('compressorAttack', 5)).toBe(1);
    expect(clampEffectValue('limiterRelease', -3)).toBe(0);
  });

  test('a non-finite persisted value becomes the factory default, not NaN', () => {
    expect(clampEffectValue('limiterThreshold', Number.NaN)).toBe(-3);
    expect(clampEffectValue('compressorRatio', 'loud')).toBe(4);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**
Run: `bun test src/store/masterDynamics.test.ts`
Expected: FAIL — `expect(INITIAL_EFFECTS.compressorEnabled).toBe(false)` receives `undefined`, and `expect(EFFECT_LIMITS[key]).toBeDefined()` receives `undefined` for `compressorRatio`.

- [ ] **Step 5: Add the fields to `MasterEffects`**
In `src/types.ts`, replace the `MasterEffects` interface body:
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

  /**
   * The two master dynamics stages (DEV-385). They are REQUIRED booleans named
   * `*Enabled`, not the optional `*Bypass?` the parallel sends use, for three
   * reasons that are all load-bearing:
   *
   *  1. `*Bypass?` reads absent-as-active. These default OFF, so an optional
   *     flag could not express the default without every payload carrying it.
   *  2. `*Bypass` means "force the wet send to 0" (see engine.updateEffects). A
   *     series stage cannot be bypassed that way — wet 0 on a compressor is
   *     silence, not passthrough — so these drive a real graph rewire instead,
   *     and a different name keeps that difference visible at the call site.
   *  3. `compressorBypass` is a DEAD legacy key that sanitizeEffectsValue
   *     deletes from old payloads. Reusing the name would make the sanitizer
   *     delete the live field.
   *
   * knee is deliberately NOT here: it stays a fixed engine constant (30 for the
   * compressor, 0 for the limiter — the hard knee is what makes the limiter a
   * limiter), so the stored surface is only what the UI actually offers.
   */
  compressorEnabled: boolean;
  compressorThreshold: number;
  compressorRatio: number;
  /** Seconds. */
  compressorAttack: number;
  /** Seconds. */
  compressorRelease: number;
  limiterEnabled: boolean;
  limiterThreshold: number;
  limiterRatio: number;
  /** Seconds. */
  limiterAttack: number;
  /** Seconds. */
  limiterRelease: number;
}
```

- [ ] **Step 6: Add the defaults to `INITIAL_EFFECTS`**
In `src/store/initialState.ts`, replace the `INITIAL_EFFECTS` block and the comment above it:
```ts
// seeds every wet send and EQ gain at zero; these values reach the graph via
// applyEngineSnapshot() on the first user click and are clamped through
// audio/effectLimits.ts on the way in.
//
// NOTE: reverbDecay (2.0) deliberately equals the engine's setupMasterChain
// hardcode so the default sound is unchanged now that the knob is live.
//
// The ten dynamics values equal the engine's historical hardcodes for a
// different reason: both stages default OFF (DEV-385), so these numbers are
// never heard until a user switches a module on — and when they do, they get
// exactly the compression the app used to apply invisibly. Change one and you
// change what "on" means, not what the app sounds like out of the box.
export const INITIAL_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 2.0,
  delayWet: 0.2,
  delayFeedback: 0.35,
  distortionWet: 0.1,
  eqLow: 2,
  eqMid: 0,
  eqHigh: 3,
  compressorEnabled: false,
  compressorThreshold: -12,
  compressorRatio: 4,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  limiterEnabled: false,
  limiterThreshold: -3,
  limiterRatio: 20,
  limiterAttack: 0.003,
  limiterRelease: 0.15,
};
```

- [ ] **Step 7: Add the ranges to `EFFECT_LIMITS`**
In `src/audio/effectLimits.ts`, replace the `EffectNumericKey` union:
```ts
export type EffectNumericKey =
  | 'reverbWet'
  | 'reverbDecay'
  | 'delayWet'
  | 'delayFeedback'
  | 'distortionWet'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'compressorThreshold'
  | 'compressorRatio'
  | 'compressorAttack'
  | 'compressorRelease'
  | 'limiterThreshold'
  | 'limiterRatio'
  | 'limiterAttack'
  | 'limiterRelease';
```
and append to the `EFFECT_LIMITS` record, after the existing `compressorThreshold` line:
```ts
  // The four-per-stage dynamics ranges are the Web Audio AudioParam ranges for
  // DynamicsCompressorNode, not UI ranges: clamping to what the node itself
  // accepts means a clamped value is always a legal write, and the knobs are
  // free to offer a narrower, more musical span on top (see EffectsRackView).
  compressorRatio: { min: 1, max: 20, fallback: 4 },
  compressorAttack: { min: 0, max: 1, fallback: 0.003 },
  compressorRelease: { min: 0, max: 1, fallback: 0.25 },
  limiterThreshold: { min: -60, max: 0, fallback: -3 },
  limiterRatio: { min: 1, max: 20, fallback: 20 },
  limiterAttack: { min: 0, max: 1, fallback: 0.003 },
  limiterRelease: { min: 0, max: 1, fallback: 0.15 },
```

- [ ] **Step 8: Update the implemented-fields guard**
In `src/audio/presetRegistry.test.ts`, replace the assertion inside `'the factory effects object is exactly the implemented set'`:
```ts
    expect(Object.keys(INITIAL_EFFECTS).sort()).toEqual([
      'compressorAttack', 'compressorEnabled', 'compressorRatio', 'compressorRelease',
      'compressorThreshold', 'delayFeedback', 'delayWet', 'distortionWet',
      'eqHigh', 'eqLow', 'eqMid',
      'limiterAttack', 'limiterEnabled', 'limiterRatio', 'limiterRelease',
      'limiterThreshold', 'reverbDecay', 'reverbWet',
    ]);
```

- [ ] **Step 9: Run tests to verify they pass**
Run: `bun test src/store/masterDynamics.test.ts src/audio/presetRegistry.test.ts && bun run lint`
Expected: PASS, and `tsc --noEmit` clean (the only full `MasterEffects` literal in the repo is `INITIAL_EFFECTS`; every other consumer takes `Partial<MasterEffects>`).

- [ ] **Step 10: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/types.ts src/store/initialState.ts src/audio/effectLimits.ts \
  src/audio/presetRegistry.test.ts src/store/masterDynamics.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): give the master compressor and limiter stored, clamped state

Both stages become explicit master FX with an Enabled flag and four
parameters each, seeded with the engine's historical hardcodes and
defaulting OFF. State only — nothing reads it yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 2: Sanitize the new fields, and decide the `.solna` `formatVersion`

**Files:**
- Modify: `src/store/sanitize.ts:78-109`
- Test: `src/store/sanitize.test.ts`

**Interfaces:**
- Consumes: `MasterEffects` (Task 1), `EFFECT_LIMITS` (Task 1).
- Produces: `sanitizeEffectsValue` output guaranteed to carry `compressorEnabled: boolean` and `limiterEnabled: boolean`, and to preserve `compressorRatio`.

**Decision — the project `formatVersion` is NOT bumped, and this is where the reason lives.**
`effects` is in `PROJECT_CONTENT_KEYS`, so a `.solna` body does carry it. But `projectFile.ts` runs every loaded body through `sanitizeEffectsValue`, and after this task that pass turns an absent `compressorEnabled` into `false` and an absent `compressorRatio` into its `EFFECT_LIMITS` fallback of `4` — which is *exactly* the object a body saved today would carry. An old body and a new body therefore sanitize to the same value. Bumping `formatVersion` would stamp a contract change that produces nothing different, and would put a no-op step into a chain whose steps are supposed to mean something. The persist `version` **does** move (Task 3) for a reason this path cannot cover: it must also destroy a stale `compressorRatio` that older sanitize passes used to delete.

- [ ] **Step 1: Write the failing test**
Append to `src/store/sanitize.test.ts`, inside the existing top-level `describe` that holds `'sanitizeEffectsValue clones the shared default instead of returning it'` (or as a new sibling `describe` at the end of the file):
```ts
describe('sanitizeEffectsValue and the master dynamics fields', () => {
  test('a body with no dynamics keys sanitizes to both stages OFF', () => {
    const out = sanitizeEffectsValue({ reverbWet: 0.3 }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(false);
    expect(out.limiterEnabled).toBe(false);
  });

  test('a truthy-but-not-true persisted flag does not switch a stage on', () => {
    // Persisted JSON is untrusted input: only an exact `true` engages a stage,
    // so a string, a 1 or an object can never silently insert a dynamics node.
    const out = sanitizeEffectsValue({
      compressorEnabled: 'yes',
      limiterEnabled: 1,
    }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(false);
    expect(out.limiterEnabled).toBe(false);
  });

  test('an explicit true survives', () => {
    const out = sanitizeEffectsValue({
      compressorEnabled: true,
      limiterEnabled: true,
    }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(true);
    expect(out.limiterEnabled).toBe(true);
  });

  test('compressorRatio is a real field now and is no longer stripped', () => {
    const out = sanitizeEffectsValue({ compressorRatio: 6 }) as Record<string, unknown>;
    expect(out.compressorRatio).toBe(6);
  });

  test('compressorRatio is still clamped into the node range', () => {
    const out = sanitizeEffectsValue({ compressorRatio: 99 }) as Record<string, unknown>;
    expect(out.compressorRatio).toBe(20);
  });

  test('compressorBypass stays dead and is still stripped', () => {
    const out = sanitizeEffectsValue({ compressorBypass: true }) as Record<string, unknown>;
    expect('compressorBypass' in out).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test src/store/sanitize.test.ts -t "master dynamics fields"`
Expected: FAIL — `expect(out.compressorEnabled).toBe(false)` receives `undefined`, and `expect(out.compressorRatio).toBe(6)` receives `undefined` (the key is deleted by the legacy strip list).

- [ ] **Step 3: Write the implementation**
In `src/store/sanitize.ts`, replace the two trailing blocks of `sanitizeEffectsValue` (the numeric clamp block stays exactly as it is; only what follows it changes):
```ts
  if (result && typeof result === 'object') {
    // The two dynamics toggles are the only BOOLEAN fields with a meaningful
    // default, so they are coerced rather than clamped, and only an exact
    // `true` engages a stage — persisted JSON is untrusted input and a
    // truthy string must never insert a node into the master chain.
    //
    // This is also why DEV-385 does NOT bump the project `formatVersion`.
    // `effects` IS in PROJECT_CONTENT_KEYS, but a .solna body saved before
    // DEV-385 carries neither key, `undefined === true` is `false`, and that
    // is exactly the new default — so an old body sanitizes to the same
    // object a new one would. A bump would stamp a contract change that
    // produces nothing different. The persist `version` DOES move (v16), for
    // a reason this path cannot cover: it must also wipe a stale
    // `compressorRatio` that older sanitize passes used to delete.
    const flags = result as Record<string, unknown>;
    flags.compressorEnabled = flags.compressorEnabled === true;
    flags.limiterEnabled = flags.limiterEnabled === true;
  }

  if (result && typeof result === 'object') {
    // Fields removed from MasterEffects must not resurrect from old payloads.
    // `compressorRatio` has LEFT this list: DEV-385 makes the name real.
    // `compressorBypass` stays dead — DEV-385 deliberately spells the toggle
    // `compressorEnabled` instead, so this delete is still correct.
    const fx = result as Record<string, unknown>;
    for (const key of ['chorusRate', 'chorusDepth', 'chorusWet', 'compressorBypass', 'delayTime', 'distortionDrive']) {
      delete fx[key];
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test src/store/sanitize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/store/sanitize.ts src/store/sanitize.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): sanitize the master dynamics fields

Only an exact `true` engages a stage, and compressorRatio leaves the
legacy strip list now that the name is real. Records why the .solna
formatVersion is deliberately not bumped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 3: Persist migration v15 → v16 (a documented reset)

**Files:**
- Modify: `src/store/migrate.ts` (append at end of file)
- Modify: `src/store/store.ts:287` and `src/store/store.ts:292-355`
- Modify: `src/store/store.test.ts:810-816`
- Test: `src/store/migrate.test.ts`

**Interfaces:**
- Consumes: `MasterEffects` (Task 1).
- Produces: `export function migrateMasterDynamics<T extends object>(state: T): T` in `src/store/migrate.ts`; persist `version: 16`.

- [ ] **Step 1: Write the failing test**
Append to `src/store/migrate.test.ts`:
```ts
describe('migrateMasterDynamics (v15 -> v16)', () => {
  test('RESETS every dynamics key, including a persisted compressorThreshold', () => {
    const out = migrateMasterDynamics({
      effects: { reverbWet: 0.4, compressorThreshold: -30 },
    }) as { effects: Record<string, unknown> };

    // The reset is the point: until v16 the only dynamics key a payload could
    // carry described a stage that was always on and PRE-fader. Re-reading it
    // into a stage that is now off and post-fader keeps a number for its own
    // sake, so the step throws it away.
    expect(out.effects.compressorThreshold).toBe(-12);
    expect(out.effects.compressorEnabled).toBe(false);
    expect(out.effects.limiterEnabled).toBe(false);
    expect(out.effects.limiterThreshold).toBe(-3);
    expect(out.effects.limiterRatio).toBe(20);

    // Non-dynamics effects are untouched.
    expect(out.effects.reverbWet).toBe(0.4);
  });

  test('drops a stale compressorRatio rather than adopting it', () => {
    const out = migrateMasterDynamics({
      effects: { compressorRatio: 12 },
    }) as { effects: Record<string, unknown> };
    expect(out.effects.compressorRatio).toBe(4);
  });

  test('is idempotent', () => {
    const once = migrateMasterDynamics({ effects: { reverbWet: 0.4 } });
    const twice = migrateMasterDynamics(once);
    expect(twice).toEqual(once);
  });

  test('a payload with no effects object survives untouched', () => {
    expect(migrateMasterDynamics({ bpm: 90 })).toEqual({ bpm: 90 });
    expect(migrateMasterDynamics({ effects: null })).toEqual({ effects: null });
  });
});
```
Add `migrateMasterDynamics` to the existing `import { ... } from './migrate';` line at the top of `src/store/migrate.test.ts`.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test src/store/migrate.test.ts -t "migrateMasterDynamics"`
Expected: FAIL — `SyntaxError`/`ReferenceError`: `migrateMasterDynamics` is not exported by `./migrate`.

- [ ] **Step 3: Write the migration step**
Append to `src/store/migrate.ts`:
```ts
/**
 * v15 -> v16: the master compressor and limiter become explicit, toggleable
 * master FX and DEFAULT OFF (DEV-385).
 *
 * This step RESETS every dynamics key on `effects` to the factory values. It
 * converts nothing, and that is deliberate:
 *
 *  - No backward compatibility is required (see the DEV-383 epic contract).
 *  - Until v16 the only dynamics key a payload could carry was
 *    `compressorThreshold`, and it described a stage that was always on and
 *    PRE-fader. The stage is now off and post-fader, so the old number no
 *    longer describes anything the user chose.
 *  - `compressorRatio` used to be a dead name that sanitizeEffectsValue
 *    DELETED from old payloads. v16 makes the name real, so a value written
 *    by the code that once used it must not survive into the live field.
 *
 * The ten values are written out as literals rather than spread from
 * INITIAL_EFFECTS on purpose: a migration's output is a contract stamped into
 * persisted data, so it must be frozen at the commit that ships the guard. If
 * the factory defaults later change, this step must keep producing v16's
 * values and a NEW step must carry the difference.
 *
 * Idempotent: it writes the same ten values every time it runs.
 */
export function migrateMasterDynamics<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) };
  const effects = next.effects;
  if (effects && typeof effects === 'object' && !Array.isArray(effects)) {
    next.effects = {
      ...(effects as Record<string, unknown>),
      compressorEnabled: false,
      compressorThreshold: -12,
      compressorRatio: 4,
      compressorAttack: 0.003,
      compressorRelease: 0.25,
      limiterEnabled: false,
      limiterThreshold: -3,
      limiterRatio: 20,
      limiterAttack: 0.003,
      limiterRelease: 0.15,
    };
  }
  return next as unknown as T;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test src/store/migrate.test.ts -t "migrateMasterDynamics"`
Expected: PASS

- [ ] **Step 5: Wire the step into the persist chain and bump the version**
In `src/store/store.ts`, change `version: 15,` to `version: 16,`, add `migrateMasterDynamics` to the existing `import { ... } from './migrate';` line, and append below the `if (version < 15)` line inside `migrate`:
```ts
        // v15 -> v16 (the master compressor and limiter become explicit FX,
        // default OFF). The step RESETS every dynamics key rather than
        // converting one — see migrateMasterDynamics' docblock for why, and
        // note it is idempotent, so re-running it is always safe.
        if (version < 16) next = migrateMasterDynamics(next) as PersistedState;
```

- [ ] **Step 6: Update the hydration expectation in `store.test.ts`**
In `src/store/store.test.ts`, replace the line `expect(s.effects).toEqual({ ...INITIAL_EFFECTS, ...partialEffects });`:
```ts
    // The v15 -> v16 step runs over this version-1 payload and RESETS every
    // dynamics key, so a persisted compressorThreshold does NOT survive it.
    // Spelling the ten values here rather than trusting INITIAL_EFFECTS keeps
    // the migration's frozen output visible next to the sanitized result.
    expect(s.effects).toEqual({
      ...INITIAL_EFFECTS,
      ...partialEffects,
      compressorEnabled: false,
      compressorThreshold: -12,
      compressorRatio: 4,
      compressorAttack: 0.003,
      compressorRelease: 0.25,
      limiterEnabled: false,
      limiterThreshold: -3,
      limiterRatio: 20,
      limiterAttack: 0.003,
      limiterRelease: 0.15,
    });
```

- [ ] **Step 7: Run the store suites**
Run: `bun test src/store/store.test.ts src/store/migrate.test.ts src/store/sanitize.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/store/migrate.ts src/store/migrate.test.ts src/store/store.ts src/store/store.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): persist v16 resets the master dynamics keys

A documented reset, not a conversion: the old compressorThreshold
described an always-on pre-fader stage that no longer exists, and a
stale compressorRatio must not survive the name becoming real.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 4: The engine — bypass by rewiring, not by neutralising

**Files:**
- Modify: `src/audio/engine.ts:216-218` (new private field), `:669-700` (headroom comment), `:776-784` (wiring), `:2414-2443` (`updateEffects`), plus a new private method after `setupMasterChain`
- Test: `src/audio/engine.test.ts:15-24` (fake node gains `disconnect`), `:563-590` (the master-chain test)

**Interfaces:**
- Consumes: `MasterEffects` (Task 1), `clampEffects` (Task 1).
- Produces: private `AudioEngine.rewireMasterDynamics(compressorOn: boolean, limiterOn: boolean): void` and private field `dynamicsTopology: string`; `updateEffects` now also writes eight dynamics params and applies the topology.

**Why this is a rewire and not a wet/dry bypass.** The parallel sends (`reverbBypass`, `delayBypass`, `distortionBypass`, `eqBypass`) are bypassed by forcing their send gain to `0`, because a send is *added* to a dry path that always passes. A compressor sits **in series**: forcing anything about it to zero yields silence, not passthrough. A dry/wet crossfade around it would restore passthrough but would leave the node connected and processing, which the acceptance criteria explicitly reject ("BYPASSED IN THE GRAPH … the signal path is `EQ → masterGain → destination`"). So the bypass is a real reconnect: `rewireMasterDynamics` drops every outgoing edge of `masterGain`, `compressor` and `limiter`, then rebuilds exactly the edges the requested topology needs — **including both of DEV-384's observe-only analyser sends**, which `masterGain.disconnect()` takes with it and which have no output of their own to restore them. The nodes themselves are created once and never re-created, so a rewire can never orphan one — there is nothing to orphan.

**Known and accepted:** switching a stage while it is actively reducing gain can click, because the sample stream jumps from the reduced output to the raw one. It is a discrete user action on a safety net, the jump is zero while the net is idle, and the alternative — muting `masterGain`, rewiring on a timer, unmuting — would make the topology change unobservable synchronously and force every graph test onto timers. Documented in the code, not worked around.

- [ ] **Step 1: Teach the test fake to forget its edges**
In `src/audio/engine.test.ts`, replace the `mk` helper inside `masterChainCtx` (lines 16-24):
```ts
  const mk = (type: string) => {
    const n = fakeNode();
    (n as any)._connectTargets = [] as unknown[];
    (n as any).connect = (target: unknown) => {
      (n as any)._connectTargets.push(target);
    };
    // rewireMasterDynamics calls disconnect() with no argument and then
    // re-makes exactly the edges the topology needs, so the fake has to forget
    // its outgoing edges too. fakeNode's inherited disconnect clears
    // `connectedTo`, which this override does not use — without this, a
    // "bypassed" assertion would read every edge the graph has EVER had.
    (n as any).disconnect = () => {
      (n as any)._connectTargets.length = 0;
    };
    (n as any)._type = type;
    return n;
  };
```

- [ ] **Step 2: Write the failing tests**
In `src/audio/engine.test.ts`, add this helper immediately after `masterChainCtx`'s closing brace:
```ts
/**
 * A full effects payload minus reverbDecay, which updateEffects deliberately
 * refuses (it is owned by setReverbDecay). Built by deletion rather than by
 * spelling every key so the tests never drift from INITIAL_EFFECTS, and
 * without the excess-property error a literal spread would raise.
 */
function fxWith(overrides: Partial<MasterEffects>): Omit<MasterEffects, 'reverbDecay'> {
  const next = { ...INITIAL_EFFECTS, ...overrides } as Record<string, unknown>;
  delete next.reverbDecay;
  return next as unknown as Omit<MasterEffects, 'reverbDecay'>;
}
```
Add to the imports at the top of `src/audio/engine.test.ts`:
```ts
import { INITIAL_EFFECTS } from '../store/initialState';
import type { MasterEffects } from '../types';
```
Then replace the whole DEV-384 test `test('taps both analysers off masterGain ahead of the limiter, so \`over\` is reachable', ...)` — DEV-384 Task 7 renamed the original `'seeds masterGain at unity and inserts a ratio-20 limiter…'` test into that — with these six tests.

**Read this before writing them.** `masterGain` carries **two** observe-only sends after DEV-384,
in this order: `analyser` (spectrum, `AudioVisualizer`) then `levelAnalyser` (level,
`getMasterLevelAnalyser()` → every dBFS meter). Every `masterGain._connectTargets` assertion below
therefore begins `[analyser, levelAnalyser, …]`. Writing it as `[analyser, ctx.destination]` is not
a smaller version of the same assertion — it is a test that **passes green while the meter reads
`-∞`**, because a dropped send throws nothing and removes no node. Each test also asserts
`levelAnalyser._connectTargets` is empty, which is what pins it as observe-only and catches anyone
putting it in series.

```ts
  test('both dynamics stages default OFF, so masterGain reaches the destination directly', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;
    const eqHigh = (engine as any).eqHighNode;

    // masterGain is the user's master trim and nothing else: engineSync pushes
    // masterVolume with fireImmediately, so any "staging" value seeded here is
    // overwritten before the first frame.
    expect(masterGain.gain.value).toBe(1);

    // NOTHING owns headroom by default, and that is the intended state
    // (DEV-385): both stages exist as nodes but neither is in the path, so the
    // mix reaches the destination exactly as the user made it.
    expect(eqHigh._connectTargets).toEqual([masterGain]);
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination]);
    expect(compressor._connectTargets).toEqual([]);
    expect(limiter._connectTargets).toEqual([]);
    // BOTH taps are SENDS with no onward output (DEV-384), so each reads the
    // post-fader, pre-dynamics mix and feeds nothing. levelAnalyser is the one
    // getMasterLevelAnalyser() returns — it IS the meter, and asserting only
    // `analyser` here would leave this test green with every meter at -inf.
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // The nodes are still seeded with the app's historical values, so
    // switching a stage on reproduces what the app used to do invisibly.
    expect(compressor.threshold.value).toBe(-12);
    expect(compressor.knee.value).toBe(30);
    expect(compressor.ratio.value).toBe(4);
    expect(compressor.attack.value).toBeCloseTo(0.003, 6);
    expect(compressor.release.value).toBeCloseTo(0.25, 6);
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.attack.value).toBeCloseTo(0.003, 6);
    expect(limiter.release.value).toBeCloseTo(0.15, 6);
  });

  test('engaging both stages inserts compressor then limiter AFTER the meter tap', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: true }));

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;

    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, compressor]);
    expect(compressor._connectTargets).toEqual([limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    // NEITHER tap moved, and neither is in series: an honest meter still reads
    // the mix the user made, not the squashed output. DEV-384 put both here and
    // DEV-385 must not undo either.
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });

  test('the limiter alone sits directly after masterGain, with no idle compressor in the path', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: true }));

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;

    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    expect(compressor._connectTargets).toEqual([]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });

  test('toggling the stages on and off again leaves no orphaned nodes', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const compressorBefore = (engine as any).compressor;
    const limiterBefore = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: true }));
    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false }));
    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: false }));

    // Node IDENTITY is stable across every rewire: a rewire reconnects, it
    // never rebuilds. A rebuilt node would leave the old one alive, still fed
    // by whatever pointed at it — the orphan this test exists to forbid.
    expect((engine as any).compressor).toBe(compressorBefore);
    expect((engine as any).limiter).toBe(limiterBefore);

    // Back to the default topology, with no leftover edge from the round trip.
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination]);
    expect(compressorBefore._connectTargets).toEqual([]);
    expect(limiterBefore._connectTargets).toEqual([]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // Every edge below the fader, collected: exactly the two taps and the output.
    const edges = [masterGain, compressorBefore, limiterBefore, analyser, levelAnalyser].flatMap(
      (n: any) => n._connectTargets as unknown[],
    );
    expect(edges).toEqual([analyser, levelAnalyser, ctx.destination]);
  });

  test('a full toggle cycle never drops the meter tap', () => {
    // This test exists because a rewire that drops the meter's tap is
    // otherwise INVISIBLE. rewireMasterDynamics calls masterGain.disconnect(),
    // which takes both observe-only sends with it; forgetting to re-make
    // levelAnalyser throws nothing, orphans nothing, and leaves the audio path
    // audibly perfect — the only symptom is VuMeter and AmbientBackdrop pinned
    // at -inf, which no graph assertion above would notice if it named only
    // `analyser`. A cross-plan review caught exactly that defect in this plan,
    // so the guard is a test rather than a comment.
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const levelAnalyser = (engine as any).levelAnalyser;
    const taps = () => masterGain._connectTargets as unknown[];

    // Seeded topology: the tap is there before anything is toggled.
    expect(taps()).toContain(levelAnalyser);

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false }));
    expect(taps()).toContain(levelAnalyser);
    // Still a SEND after the rewire — in the tap list, not spliced into series.
    expect(levelAnalyser._connectTargets).toEqual([]);

    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: false }));
    expect(taps()).toContain(levelAnalyser);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // getMasterLevelAnalyser() still hands out that same live node, so the
    // meter reads the node the graph is actually feeding.
    expect(engine.getMasterLevelAnalyser()).toBe(levelAnalyser);
  });

  test('an engaged stage receives its stored parameters', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    engine.updateEffects(
      fxWith({
        compressorEnabled: true,
        compressorThreshold: -20,
        compressorRatio: 8,
        limiterEnabled: true,
        limiterThreshold: -6,
      }),
    );

    const compressor = (engine as any).compressor;
    const limiter = (engine as any).limiter;
    // fakeParam records setTargetAtTime calls as { v, t, tc }; asserting on the
    // recorded VALUES rather than on an index keeps the test free of both
    // ordering assumptions and index-signature typing.
    const values = (param: { targets: { v: number }[] }) => param.targets.map((e) => e.v);

    expect(values(compressor.threshold)).toContain(-20);
    expect(values(compressor.ratio)).toContain(8);
    expect(values(compressor.attack)).toContain(0.003);
    expect(values(compressor.release)).toContain(0.25);
    expect(values(limiter.threshold)).toContain(-6);
    expect(values(limiter.ratio)).toContain(20);
  });
```

- [ ] **Step 3: Run tests to verify they fail**
Run: `bun test src/audio/engine.test.ts -t "master chain"`
Expected: FAIL — `expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination])` receives `[analyser, levelAnalyser, limiter]` (DEV-384's shipped wiring), and `expect(compressor._connectTargets).toEqual([])` receives `[masterGain]`. The new `'a full toggle cycle never drops the meter tap'` test fails at its first `updateEffects`, because nothing rewires yet.

If instead the first failure is `receives [undefined, ...]`, `levelAnalyser` is not a field on the engine and DEV-384 has not landed in the shape Task 1 Step 2 required — go back and reconcile rather than deleting the assertion.

- [ ] **Step 4: Add the topology field**
In `src/audio/engine.ts`, immediately below `private limiter: DynamicsCompressorNode | null = null;` (line 218):
```ts
  /**
   * Which master dynamics stages are currently WIRED IN, as a short code:
   * '' (neither), 'c', 'l' or 'cl'. rewireMasterDynamics compares against it
   * so a repeated updateEffects — and there is one per effects change — does
   * not tear the master tail down and rebuild it for nothing.
   *
   * Seeded to the sentinel 'unbuilt', which no toggle combination can produce,
   * so setupMasterChain's own seeding call always runs.
   */
  private dynamicsTopology = 'unbuilt';
```

- [ ] **Step 5: Rewrite the headroom comment and the master-tail wiring**
In `src/audio/engine.ts`, replace the comment block above `this.masterGain = this.ctx.createGain();` (lines 669-674):
```ts
    // Master output & analyser. masterGain is the USER's master trim and
    // nothing else: engineSync subscribes masterVolume with fireImmediately,
    // so it is overwritten before the first frame — a "staging ceiling" seeded
    // here would be a comment describing a value that never applies.
    //
    // NOTHING OWNS HEADROOM BY DEFAULT, and that is the intended state as of
    // DEV-385. The compressor and limiter below are still created and still
    // seeded with the values they used to apply unconditionally, but they are
    // no longer wired in: both are explicit, toggleable master FX that default
    // OFF, so a fresh session sends the mix to the destination exactly as the
    // user made it and the meter reports that mix honestly. A user who wants a
    // safety net switches one on in the Effects view; the app no longer
    // gain-stages on their behalf without telling them.
```
Then replace the tail-wiring block **together with `setupMasterChain`'s own closing brace** — that is, everything from `this.eqHighNode.connect(this.compressor);` through the `}` that ends the method (immediately above `private makeDistortionCurve`). Post-DEV-384 that is exactly these six lines plus the brace, and **all six go**, the two analyser sends included — `rewireMasterDynamics` re-makes them, and leaving them here would mean two builders for the same edges:
```ts
    this.eqHighNode.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.masterGain.connect(this.levelAnalyser);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
```
Leave `setupMasterChain`'s cleanup block at the top of the method alone — DEV-384's `this.levelAnalyser = null;` line lives there and must stay. The replacement below supplies the closing brace itself and then opens the new method, so do not leave the old one behind:
```ts
    this.eqHighNode.connect(this.masterGain);

    // Everything below masterGain is owned by rewireMasterDynamics — including
    // BOTH analyser taps, which it re-makes on every pass. Seeding through it
    // rather than around it means the graph has exactly one builder, so the
    // first updateEffects can never find a topology it did not construct.
    this.dynamicsTopology = 'unbuilt';
    this.rewireMasterDynamics(false, false);
  }

  /**
   * Rebuilds the master tail below masterGain for the requested pair of
   * dynamics stages.
   *
   * A series stage cannot be bypassed the way the parallel SENDS are. Reverb,
   * delay and distortion bypass by forcing their send gain to 0 (see
   * updateEffects) because a send is ADDED to a dry path that always passes.
   * A compressor is in the path: forcing anything about it to zero gives
   * silence, not passthrough. A dry/wet crossfade around it would restore
   * passthrough but would leave the node connected and processing, which is
   * precisely the invisible, unavoidable staging DEV-385 exists to remove. So
   * the bypass is a real reconnect.
   *
   * The three nodes are created ONCE in setupMasterChain and never re-created,
   * so a rewire cannot orphan one: it drops every outgoing edge of the three,
   * then re-makes exactly the edges the topology needs.
   *
   * THE TWO ANALYSER SENDS ARE PART OF THAT. masterGain.disconnect() drops
   * both of DEV-384's observe-only taps along with the audio edge, and neither
   * has an output of its own to put it back. `analyser` is the 128-bin
   * spectrum node AudioVisualizer draws; `levelAnalyser` is the node
   * getMasterLevelAnalyser() hands to useMeterLevel — it IS the meter behind
   * VuMeter and AmbientBackdrop. Re-making only the first is a silent failure:
   * no throw, no orphan, audio unchanged, every dBFS reading -inf forever.
   *
   * NOTE — switching a stage while it is actively reducing gain can click: the
   * sample stream jumps from the reduced output to the raw one. Accepted, not
   * worked around. It is a discrete user action on a safety net, the jump is
   * zero whenever the net is idle (which is the common case), and the fix —
   * mute masterGain, rewire on a timer, unmute — would make the topology
   * change unobservable synchronously and put every graph test on a timer.
   */
  private rewireMasterDynamics(compressorOn: boolean, limiterOn: boolean): void {
    if (
      !this.ctx ||
      !this.masterGain ||
      !this.compressor ||
      !this.limiter ||
      !this.analyser ||
      !this.levelAnalyser
    ) {
      return;
    }

    const topology = `${compressorOn ? 'c' : ''}${limiterOn ? 'l' : ''}`;
    if (topology === this.dynamicsTopology) return;

    this.masterGain.disconnect();
    this.compressor.disconnect();
    this.limiter.disconnect();

    // BOTH observe-only taps are re-made FIRST and unconditionally, in the
    // order DEV-384 wired them. Each hangs off masterGain with no onward
    // output, so the disconnect above just dropped both and nothing else would
    // put either back — and both must stay AHEAD of the two stages, or they
    // would report post-squash audio instead of the mix the user made.
    // levelAnalyser is not optional decoration: it is the node
    // getMasterLevelAnalyser() returns, so dropping it silently kills VuMeter
    // and AmbientBackdrop while leaving the audio path perfect.
    this.masterGain.connect(this.analyser);
    this.masterGain.connect(this.levelAnalyser);

    const stages: DynamicsCompressorNode[] = [];
    if (compressorOn) stages.push(this.compressor);
    if (limiterOn) stages.push(this.limiter);

    let node: AudioNode = this.masterGain;
    for (const stage of stages) {
      node.connect(stage);
      node = stage;
    }
    node.connect(this.ctx.destination);

    this.dynamicsTopology = topology;
  }
```

- [ ] **Step 6: Apply the parameters and the topology in `updateEffects`**
In `src/audio/engine.ts`, replace the `if (this.compressor) { … }` block inside `updateEffects` with:
```ts
    // Both dynamics stages are max-ratio-or-not DynamicsCompressorNodes; the
    // "limiter" is a max-ratio compressor with a HARD KNEE, which is the
    // standard Web Audio stand-in for a dedicated limiter (the API has none).
    // knee is not stored state: 30 and 0 are set once in setupMasterChain,
    // because a soft-kneed limiter stops being a limiter.
    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(fx.compressorThreshold, this.ctx.currentTime, 0.05);
      this.compressor.ratio.setTargetAtTime(fx.compressorRatio, this.ctx.currentTime, 0.05);
      this.compressor.attack.setTargetAtTime(fx.compressorAttack, this.ctx.currentTime, 0.05);
      this.compressor.release.setTargetAtTime(fx.compressorRelease, this.ctx.currentTime, 0.05);
    }

    if (this.limiter) {
      this.limiter.threshold.setTargetAtTime(fx.limiterThreshold, this.ctx.currentTime, 0.05);
      this.limiter.ratio.setTargetAtTime(fx.limiterRatio, this.ctx.currentTime, 0.05);
      this.limiter.attack.setTargetAtTime(fx.limiterAttack, this.ctx.currentTime, 0.05);
      this.limiter.release.setTargetAtTime(fx.limiterRelease, this.ctx.currentTime, 0.05);
    }

    // Parameters first, topology second: a stage that is about to be inserted
    // should already hold its own settings when the signal reaches it.
    this.rewireMasterDynamics(fx.compressorEnabled, fx.limiterEnabled);
```

- [ ] **Step 7: Run tests to verify they pass**
Run: `bun test src/audio/engine.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): bypass the master dynamics by rewiring, not by neutralising

Both stages default off and are genuinely out of the graph: the chain is
eqHigh -> masterGain -> destination with the meter tapped off masterGain,
ahead of both. Nodes are built once and only reconnected, so a toggle
cycle can leave no orphan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 5: Make the store→engine subscription see the new keys

**Files:**
- Modify: `src/store/engineSync.ts:38-54`
- Test: `src/store/engineSync.test.ts`

**Interfaces:**
- Consumes: `MasterEffects` (Task 1), `updateEffects` (Task 4).
- Produces: `export const EFFECT_KEYS_EXCEPT_DECAY` (was module-private) covering all twenty-one comparison keys.

- [ ] **Step 1: Write the failing test**
Append to `src/store/engineSync.test.ts`:
```ts
describe('EFFECT_KEYS_EXCEPT_DECAY', () => {
  test('covers every MasterEffects field except reverbDecay', () => {
    // The effects subscription compares on this list. A field missing from it
    // is a knob the engine never hears — the subscription's equalityFn calls
    // the two objects equal and the listener never runs. Pinned as a literal
    // because the optional *Bypass keys are absent from INITIAL_EFFECTS and so
    // cannot be derived from it.
    expect([...EFFECT_KEYS_EXCEPT_DECAY].sort()).toEqual([
      'compressorAttack',
      'compressorEnabled',
      'compressorRatio',
      'compressorRelease',
      'compressorThreshold',
      'delayBypass',
      'delayFeedback',
      'delayWet',
      'distortionBypass',
      'distortionWet',
      'eqBypass',
      'eqHigh',
      'eqLow',
      'eqMid',
      'limiterAttack',
      'limiterEnabled',
      'limiterRatio',
      'limiterRelease',
      'limiterThreshold',
      'reverbBypass',
      'reverbWet',
    ]);
  });
});
```
Add `EFFECT_KEYS_EXCEPT_DECAY` to the existing `import { ... } from './engineSync';` line at the top of `src/store/engineSync.test.ts`.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test src/store/engineSync.test.ts -t "EFFECT_KEYS_EXCEPT_DECAY"`
Expected: FAIL — `EFFECT_KEYS_EXCEPT_DECAY` is not exported (import is `undefined`, spread throws `TypeError: undefined is not iterable`).

- [ ] **Step 3: Export and extend the key list**
In `src/store/engineSync.ts`, replace the `EFFECT_KEYS_EXCEPT_DECAY` declaration and its comment:
```ts
/**
 * Every MasterEffects field EXCEPT reverbDecay, which has its own debounced
 * subscription below. Comparing on this list keeps a decay drag from also
 * re-running updateEffects' AudioParam writes for nothing.
 *
 * Exported so engineSync.test.ts can pin it: a field added to MasterEffects
 * and forgotten HERE is a knob the engine never hears — the equalityFn calls
 * the two objects equal and the listener simply does not run, with no error.
 */
export const EFFECT_KEYS_EXCEPT_DECAY = [
  'reverbWet',
  'reverbBypass',
  'delayWet',
  'delayFeedback',
  'delayBypass',
  'distortionWet',
  'distortionBypass',
  'eqLow',
  'eqMid',
  'eqHigh',
  'eqBypass',
  'compressorEnabled',
  'compressorThreshold',
  'compressorRatio',
  'compressorAttack',
  'compressorRelease',
  'limiterEnabled',
  'limiterThreshold',
  'limiterRatio',
  'limiterAttack',
  'limiterRelease',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test src/store/engineSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): let the effects subscription see the dynamics fields

EFFECT_KEYS_EXCEPT_DECAY drives the subscription's equality check, so a
field missing from it is a knob the engine never hears. Exported and
pinned so the next omission fails a test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 6: Gain-reduction readings — engine getters and pure display maths

**Files:**
- Create: `src/utils/gainReduction.ts`
- Create: `src/utils/gainReduction.test.ts`
- Modify: `src/audio/engine.ts` (two getters beside `getAnalyser`)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: the `compressor` / `limiter` fields (Task 4).
- Produces: `audioEngine.getCompressorReduction(): number`, `audioEngine.getLimiterReduction(): number`; `REDUCTION_METER_FLOOR_DB`, `REDUCTION_STEP_DB`, `quantiseReduction(reductionDb: number): number`, `formatReduction(reductionDb: number): string`, `reductionPercent(reductionDb: number): number` from `src/utils/gainReduction.ts`.

- [ ] **Step 1: Write the failing test for the pure maths**
Create `src/utils/gainReduction.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import {
  REDUCTION_METER_FLOOR_DB,
  REDUCTION_STEP_DB,
  formatReduction,
  quantiseReduction,
  reductionPercent,
} from './gainReduction';

describe('quantiseReduction', () => {
  test('rounds AWAY from zero onto the step, so the readout never flatters the mix', () => {
    expect(REDUCTION_STEP_DB).toBe(0.5);
    expect(quantiseReduction(-4.3)).toBe(-4.5);
    expect(quantiseReduction(-4.5)).toBe(-4.5);
    expect(quantiseReduction(-0.1)).toBe(-0.5);
  });

  test('a stage that is doing nothing reads exactly zero', () => {
    expect(quantiseReduction(0)).toBe(0);
    // DynamicsCompressorNode.reduction is never positive; a positive reading
    // is a broken or absent node, and 0 is the honest answer for that.
    expect(quantiseReduction(2)).toBe(0);
    expect(quantiseReduction(Number.NaN)).toBe(0);
    expect(quantiseReduction(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('formatReduction', () => {
  test('always one decimal and always a dB suffix', () => {
    expect(formatReduction(0)).toBe('0.0 dB');
    expect(formatReduction(-4.3)).toBe('-4.5 dB');
    expect(formatReduction(-12)).toBe('-12.0 dB');
  });
});

describe('reductionPercent', () => {
  test('fills the bar in proportion to the floor and pins there', () => {
    expect(REDUCTION_METER_FLOOR_DB).toBe(-12);
    expect(reductionPercent(0)).toBe(0);
    expect(reductionPercent(-6)).toBe(50);
    expect(reductionPercent(-12)).toBe(100);
    expect(reductionPercent(-30)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test src/utils/gainReduction.test.ts`
Expected: FAIL — `Cannot find module './gainReduction'`.

- [ ] **Step 3: Write the pure module**
Create `src/utils/gainReduction.ts`:
```ts
/**
 * Display maths for a master dynamics stage's gain reduction.
 *
 * `DynamicsCompressorNode.reduction` is a NEGATIVE number of dB: 0 means the
 * stage is passing the signal untouched, -6 means six dB of squash. These
 * helpers are pure — no imports, no globals — so the readout can be tested
 * without a DOM, the same shape as utils/vuMeter.ts.
 */

/** Full scale of the reduction bar, in dB. Past this the bar simply pins. */
export const REDUCTION_METER_FLOOR_DB = -12;

/**
 * Quantisation step, in dB. The readout re-renders only when the reading
 * crosses one — the same discipline VuMeter's segment count follows, and the
 * reason a per-frame value can drive React state at all.
 */
export const REDUCTION_STEP_DB = 0.5;

/**
 * Snaps a raw reading onto the step, rounding AWAY from zero so the readout
 * never under-reports how hard the stage is working. A positive or non-finite
 * reading — a broken node, or no node at all — becomes 0.
 */
export function quantiseReduction(reductionDb: number): number {
  if (!Number.isFinite(reductionDb) || reductionDb >= 0) return 0;
  return Math.floor(reductionDb / REDUCTION_STEP_DB) * REDUCTION_STEP_DB;
}

/** `0` -> `'0.0 dB'`, `-4.3` -> `'-4.5 dB'`. */
export function formatReduction(reductionDb: number): string {
  return `${quantiseReduction(reductionDb).toFixed(1)} dB`;
}

/** 0..100 percent of the bar, pinned at REDUCTION_METER_FLOOR_DB. */
export function reductionPercent(reductionDb: number): number {
  const pct = (quantiseReduction(reductionDb) / REDUCTION_METER_FLOOR_DB) * 100;
  return Math.max(0, Math.min(100, pct));
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test src/utils/gainReduction.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the engine getters**
Append inside the `describe('master chain', …)` block in `src/audio/engine.test.ts`:
```ts
  test('reports each stage\'s live gain reduction, and 0 before the context exists', () => {
    const engine = makeEngine();

    // Every getter must survive the pre-init state: no AudioContext means no
    // nodes, and the readout has to render 0 rather than throw.
    expect(engine.getCompressorReduction()).toBe(0);
    expect(engine.getLimiterReduction()).toBe(0);

    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    (engine as any).compressor.reduction = -4.25;
    (engine as any).limiter.reduction = -0.5;

    expect(engine.getCompressorReduction()).toBe(-4.25);
    expect(engine.getLimiterReduction()).toBe(-0.5);
  });
```

- [ ] **Step 6: Run test to verify it fails**
Run: `bun test src/audio/engine.test.ts -t "live gain reduction"`
Expected: FAIL — `TypeError: engine.getCompressorReduction is not a function`.

- [ ] **Step 7: Add the getters**
In `src/audio/engine.ts`, immediately after `getAnalyser()`:
```ts
  /**
   * Live gain reduction of each master dynamics stage, in dB — always <= 0,
   * where 0 means the stage is passing the signal untouched.
   *
   * Read per frame by components/ui/GainReductionMeter through the shared
   * meter scheduler, and NEVER through the store: a store write per animation
   * frame would re-render every mounted view, and all four views stay mounted.
   *
   * A disengaged stage is disconnected (rewireMasterDynamics), so its
   * `reduction` sits at 0 and the readout reads as "doing nothing", which is
   * exactly true. Returns 0 before init(), when there is no node at all.
   */
  getCompressorReduction(): number {
    return this.compressor?.reduction ?? 0;
  }

  /** The limiter's live gain reduction in dB; see getCompressorReduction. */
  getLimiterReduction(): number {
    return this.limiter?.reduction ?? 0;
  }
```

- [ ] **Step 8: Run tests to verify they pass**
Run: `bun test src/audio/engine.test.ts src/utils/gainReduction.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/audio/engine.ts src/audio/engine.test.ts src/utils/gainReduction.ts src/utils/gainReduction.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): expose master dynamics gain reduction

Two engine getters and the pure display maths behind a readout. Both
return 0 before init and 0 for a disengaged stage, which is the honest
answer in each case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 7: The `GainReductionMeter` component

**Files:**
- Create: `src/components/ui/GainReductionMeter.tsx`
- Create: `src/components/ui/GainReductionMeter.test.tsx`
- Modify: `eslint.config.js:255-265`

**Interfaces:**
- Consumes: `audioEngine.getCompressorReduction()` / `getLimiterReduction()` (Task 6); `formatReduction`, `quantiseReduction`, `reductionPercent` (Task 6); `registerMeter` and `MeterRegistration` from `src/utils/meterScheduler.ts` (DEV-384).
- Produces: `export interface GainReductionMeterProps { stage: 'compressor' | 'limiter'; active: boolean }` and `export const GainReductionMeter`.

- [ ] **Step 1: Write the failing test**
Create `src/components/ui/GainReductionMeter.test.tsx`:
```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { GainReductionMeter } from './GainReductionMeter';

/**
 * renderToString runs no effects, so every render here is the pre-tick state:
 * the label, a 0.0 dB reading and an empty bar. That is the correct thing to
 * pin — the per-frame path is the scheduler's contract, not this component's.
 */
describe('GainReductionMeter', () => {
  test('renders the label, a zero reading and an empty bar', () => {
    const html = renderToString(<GainReductionMeter stage="compressor" active={false} />);
    expect(html).toContain('Gain Reduction');
    expect(html).toContain('0.0 dB');
    expect(html).toContain('h-full rounded-full bg-success');
    expect(html).toContain('width:0%');
  });

  test('an engaged stage tints the reading, a bypassed one dims it', () => {
    const on = renderToString(<GainReductionMeter stage="limiter" active />);
    const off = renderToString(<GainReductionMeter stage="limiter" active={false} />);
    expect(on).toContain('font-mono text-success');
    expect(off).toContain('font-mono text-base-content/40');
  });

  test('names roles, never colours', () => {
    const html = renderToString(<GainReductionMeter stage="compressor" active />);
    expect(html).not.toContain('dark:');
    for (const legacy of ['emerald-', 'green-', 'amber-', 'slate-', '#']) {
      expect(html).not.toContain(legacy);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test src/components/ui/GainReductionMeter.test.tsx`
Expected: FAIL — `Cannot find module './GainReductionMeter'`.

- [ ] **Step 3: Write the component**
Create `src/components/ui/GainReductionMeter.tsx`:
```tsx
import React from 'react';
import { audioEngine } from '@/audio/engine';
import { registerMeter } from '@/utils/meterScheduler';
import { formatReduction, quantiseReduction, reductionPercent } from '@/utils/gainReduction';

export interface GainReductionMeterProps {
  /** Which master dynamics stage to read. */
  stage: 'compressor' | 'limiter';
  /**
   * False while the stage is bypassed. The meter then registers nothing and
   * reads a flat 0 dB — which is also what the engine would report, since a
   * bypassed stage is disconnected from the graph.
   */
  active: boolean;
}

/**
 * The gain-reduction readout for one master dynamics stage: what the safety
 * net is actually doing, in dB, so "on" is visible rather than a claim.
 *
 * Reads audioEngine directly (layering rule 3 exemption, alongside
 * AudioVisualizer / VuMeter / AmbientBackdrop). The value must NOT enter a
 * zustand slice: all four tab views stay mounted, so a store write per frame
 * would re-render every one of them.
 *
 * Ticking is delegated to the shared meter scheduler with NO analyser — the
 * scheduler hands back a zero-length buffer, throttles to the 'master' tier
 * and stops ticking on a hidden tab, which is what keeps this readout from
 * burning a frame budget in a view nobody is looking at.
 *
 * State commits only when the QUANTISED reading moves (0.5 dB), so a stage
 * hovering around one value re-renders two <span>s occasionally instead of
 * sixty times a second.
 */
export const GainReductionMeter = React.memo(function GainReductionMeter({
  stage,
  active,
}: GainReductionMeterProps) {
  const [reduction, setReduction] = React.useState(0);
  const lastRef = React.useRef(0);

  React.useEffect(() => {
    if (!active) {
      lastRef.current = 0;
      setReduction(0);
      return;
    }
    return registerMeter({
      id: `gain-reduction-${stage}`,
      tier: 'master',
      onTick: () => {
        const raw =
          stage === 'compressor'
            ? audioEngine.getCompressorReduction()
            : audioEngine.getLimiterReduction();
        const next = quantiseReduction(raw);
        if (next !== lastRef.current) {
          lastRef.current = next;
          setReduction(next);
        }
      },
    });
  }, [active, stage]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-base-content/60">
        <span>Gain Reduction</span>
        <span className={active ? 'font-mono text-success' : 'font-mono text-base-content/40'}>
          {formatReduction(reduction)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-base-300">
        <div
          className="h-full rounded-full bg-success transition-[width] duration-75"
          style={{ width: `${reductionPercent(reduction)}%` }}
        />
      </div>
    </div>
  );
});
```

- [ ] **Step 4: Add the eslint layering exemption**
In `eslint.config.js`, replace the final exemption block's `files` array:
```js
  {
    files: [
      'src/components/AudioVisualizer.tsx',
      'src/components/ui/AmbientBackdrop.tsx',
      'src/components/ui/VuMeter.tsx',
      // Reads audioEngine's DynamicsCompressorNode.reduction once a frame
      // through the shared meter scheduler. Routing that through the store
      // would be a store write per frame and a re-render of every subscriber —
      // the same reason the three above are exempt.
      'src/components/ui/GainReductionMeter.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
```

- [ ] **Step 5: Run tests and eslint to verify they pass**
Run: `bun test src/components/ui/GainReductionMeter.test.tsx && bun run eslint && bun run check:theme`
Expected: PASS, eslint prints nothing at all, theme guard green.

- [ ] **Step 6: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/components/ui/GainReductionMeter.tsx src/components/ui/GainReductionMeter.test.tsx eslint.config.js
git commit -m "$(cat <<'EOF'
feat(fx): add the gain-reduction readout

One dB readout and bar per master dynamics stage, ticked by the shared
meter scheduler with no analyser so it stops on a hidden tab. The value
never enters a slice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 8: The two Master Dynamics modules in the Effects view

**Files:**
- Modify: `src/components/fxDescriptors.ts` (append)
- Modify: `src/components/fxDescriptors.test.ts` (append)
- Modify: `src/components/song/EffectsRackView.tsx` (imports; new section between "FX Chain" and "Monitor")
- Test: `src/components/song/EffectsRackView.test.tsx`

**Interfaces:**
- Consumes: `MasterEffects` fields (Task 1), `GainReductionMeter` (Task 7), `Knob`, `PowerToggle`, `ModuleHeader`, `SECTION_HEADER`.
- Produces: `compressorRatioDescriptor(ratio: number): string`, `dynamicsAttackDescriptor(seconds: number): string`, `dynamicsReleaseDescriptor(seconds: number): string`; toggles `btn-enable-compressor` / `btn-enable-limiter`; knob ids `slider-comp-threshold`, `slider-comp-ratio`, `slider-comp-attack`, `slider-comp-release`, `slider-limiter-threshold`, `slider-limiter-ratio`, `slider-limiter-attack`, `slider-limiter-release`.

- [ ] **Step 1: Write the failing descriptor test**
Append to `src/components/fxDescriptors.test.ts`:
```ts
describe('compressorRatioDescriptor', () => {
  test('names the character across the 1:1 - 20:1 range', () => {
    expect(compressorRatioDescriptor(1)).toBe('Gentle');
    expect(compressorRatioDescriptor(2.9)).toBe('Gentle');
    expect(compressorRatioDescriptor(3)).toBe('Firm');
    expect(compressorRatioDescriptor(7.9)).toBe('Firm');
    expect(compressorRatioDescriptor(8)).toBe('Squash');
    expect(compressorRatioDescriptor(20)).toBe('Squash');
  });
});

describe('dynamicsAttackDescriptor', () => {
  test('names the attack in the range the knobs offer, in seconds', () => {
    expect(dynamicsAttackDescriptor(0.001)).toBe('Snap');
    expect(dynamicsAttackDescriptor(0.009)).toBe('Snap');
    expect(dynamicsAttackDescriptor(0.01)).toBe('Quick');
    expect(dynamicsAttackDescriptor(0.049)).toBe('Quick');
    expect(dynamicsAttackDescriptor(0.05)).toBe('Relaxed');
    expect(dynamicsAttackDescriptor(0.2)).toBe('Relaxed');
  });
});

describe('dynamicsReleaseDescriptor', () => {
  test('names the release in the range the knobs offer, in seconds', () => {
    expect(dynamicsReleaseDescriptor(0.02)).toBe('Tight');
    expect(dynamicsReleaseDescriptor(0.099)).toBe('Tight');
    expect(dynamicsReleaseDescriptor(0.1)).toBe('Natural');
    expect(dynamicsReleaseDescriptor(0.399)).toBe('Natural');
    expect(dynamicsReleaseDescriptor(0.4)).toBe('Slow');
    expect(dynamicsReleaseDescriptor(1)).toBe('Slow');
  });
});
```
Extend the import at the top of `src/components/fxDescriptors.test.ts` to:
```ts
import {
  compressorRatioDescriptor,
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  dynamicsAttackDescriptor,
  dynamicsReleaseDescriptor,
  reverbDecayDescriptor,
} from './fxDescriptors';
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test src/components/fxDescriptors.test.ts -t "compressorRatioDescriptor"`
Expected: FAIL — `TypeError: compressorRatioDescriptor is not a function`.

- [ ] **Step 3: Write the descriptors**
Append to `src/components/fxDescriptors.ts`:
```ts
/**
 * Compressor ratio, 1:1 - 20:1. A ratio number says nothing about what you
 * will hear until you already know compressors, which is exactly the case a
 * descriptor is for. The limiter's ratio deliberately has NO descriptor: at
 * 4:1 and above with a hard knee it is a limiter at every setting, so a word
 * would be noise.
 */
export function compressorRatioDescriptor(ratio: number): string {
  if (ratio < 3) return 'Gentle';
  if (ratio < 8) return 'Firm';
  return 'Squash';
}

/** Attack for either dynamics stage, in SECONDS (the knobs read out in ms). */
export function dynamicsAttackDescriptor(seconds: number): string {
  if (seconds < 0.01) return 'Snap';
  if (seconds < 0.05) return 'Quick';
  return 'Relaxed';
}

/** Release for either dynamics stage, in SECONDS (the knobs read out in ms). */
export function dynamicsReleaseDescriptor(seconds: number): string {
  if (seconds < 0.1) return 'Tight';
  if (seconds < 0.4) return 'Natural';
  return 'Slow';
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test src/components/fxDescriptors.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing view test**
Append to `src/components/song/EffectsRackView.test.tsx`, inside the existing `describe('EffectsRackView theming', …)` so it reuses the single `html` render:
```tsx
  test('the master dynamics modules render, with a power toggle each', () => {
    expect(html).toContain('Master Dynamics');
    expect(html).toContain('Master Compressor');
    expect(html).toContain('Brickwall Limiter');
    expect(html).toContain('btn-enable-compressor');
    expect(html).toContain('btn-enable-limiter');
  });

  test('both stages default OFF, so both cards render dimmed', () => {
    // The rack's own idiom for a disengaged unit. Two of them prove the
    // default is off without reaching into the store.
    expect(html.split('border-base-300 opacity-60').length - 1).toBeGreaterThanOrEqual(2);
  });

  test('every dynamics parameter has a knob', () => {
    for (const id of [
      'slider-comp-threshold',
      'slider-comp-ratio',
      'slider-comp-attack',
      'slider-comp-release',
      'slider-limiter-threshold',
      'slider-limiter-ratio',
      'slider-limiter-attack',
      'slider-limiter-release',
    ]) {
      expect(html).toContain(id);
    }
  });

  test('each stage carries a gain-reduction readout', () => {
    expect(html.split('Gain Reduction').length - 1).toBe(2);
    expect(html).toContain('0.0 dB');
  });
```

- [ ] **Step 6: Run test to verify it fails**
Run: `bun test src/components/song/EffectsRackView.test.tsx -t "master dynamics modules"`
Expected: FAIL — `expect(html).toContain('Master Dynamics')` finds nothing.

- [ ] **Step 7: Add the section to `EffectsRackView`**
In `src/components/song/EffectsRackView.tsx`, replace the two import blocks at the top:
```tsx
import { Waves, Activity, Sparkles, Sliders, Gauge, ShieldCheck } from "lucide-react";
```
and
```tsx
import {
  compressorRatioDescriptor,
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  dynamicsAttackDescriptor,
  dynamicsReleaseDescriptor,
  reverbDecayDescriptor,
} from "../fxDescriptors";
import { GainReductionMeter } from "../ui/GainReductionMeter";
```
Then insert this whole `<section>` between the closing `</section>` of "FX Chain" and the opening `<section>` of "Monitor":
```tsx
      <section className="space-y-2">
        <h3 className={`${SECTION_HEADER} px-1`}>
          Master Dynamics
        </h3>
        <p className="px-1 text-[11px] text-base-content/60">
          Both stages sit after the master fader and after the meter, and both start off — the
          level you see is the mix you made. Switch one on for a safety net over an arrangement
          you did not gain-stage by hand.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {/* 5. Master Compressor */}
          <div
            className={`card bg-panel border shadow-md transition-all ${
              effects.compressorEnabled
                ? "border-success/40 ring-1 ring-success/20"
                : "border-base-300 opacity-60"
            }`}
          >
            <div className="card-body p-3 sm:p-4 space-y-3">
              <ModuleHeader
                badge={5}
                icon={<Gauge className="w-3.5 h-3.5 text-success" />}
                title="Master Compressor"
                right={
                  <PowerToggle
                    id="btn-enable-compressor"
                    on={effects.compressorEnabled}
                    onToggle={() =>
                      updateFx({ compressorEnabled: !effects.compressorEnabled })
                    }
                    name="Master Compressor"
                    tone="accent"
                    size="xs"
                    iconOnly
                  />
                }
              />

              <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
                <Knob
                  id="slider-comp-threshold"
                  label="Threshold"
                  color="text-success"
                  value={effects.compressorThreshold}
                  min={-48}
                  max={0}
                  step={1}
                  disabled={!effects.compressorEnabled}
                  format={(v) => `${v}dB`}
                  onChange={(v) => updateFx({ compressorThreshold: v })}
                />
                <Knob
                  id="slider-comp-ratio"
                  label="Ratio"
                  color="text-success"
                  value={effects.compressorRatio}
                  min={1}
                  max={20}
                  step={0.5}
                  disabled={!effects.compressorEnabled}
                  descriptor={compressorRatioDescriptor(effects.compressorRatio)}
                  format={(v) => `${v.toFixed(1)}:1`}
                  onChange={(v) => updateFx({ compressorRatio: v })}
                />
                <Knob
                  id="slider-comp-attack"
                  label="Attack"
                  color="text-success"
                  value={effects.compressorAttack}
                  min={0.001}
                  max={0.2}
                  step={0.001}
                  disabled={!effects.compressorEnabled}
                  descriptor={dynamicsAttackDescriptor(effects.compressorAttack)}
                  format={(v) => `${(v * 1000).toFixed(0)}ms`}
                  onChange={(v) => updateFx({ compressorAttack: v })}
                />
                <Knob
                  id="slider-comp-release"
                  label="Release"
                  color="text-success"
                  value={effects.compressorRelease}
                  min={0.02}
                  max={1}
                  step={0.01}
                  disabled={!effects.compressorEnabled}
                  descriptor={dynamicsReleaseDescriptor(effects.compressorRelease)}
                  format={(v) => `${(v * 1000).toFixed(0)}ms`}
                  onChange={(v) => updateFx({ compressorRelease: v })}
                />
              </div>

              <GainReductionMeter stage="compressor" active={effects.compressorEnabled} />
            </div>
          </div>

          {/* 6. Brickwall Limiter */}
          <div
            className={`card bg-panel border shadow-md transition-all ${
              effects.limiterEnabled
                ? "border-success/40 ring-1 ring-success/20"
                : "border-base-300 opacity-60"
            }`}
          >
            <div className="card-body p-3 sm:p-4 space-y-3">
              <ModuleHeader
                badge={6}
                icon={<ShieldCheck className="w-3.5 h-3.5 text-success" />}
                title="Brickwall Limiter"
                right={
                  <PowerToggle
                    id="btn-enable-limiter"
                    on={effects.limiterEnabled}
                    onToggle={() => updateFx({ limiterEnabled: !effects.limiterEnabled })}
                    name="Brickwall Limiter"
                    tone="accent"
                    size="xs"
                    iconOnly
                  />
                }
              />

              <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
                <Knob
                  id="slider-limiter-threshold"
                  label="Ceiling"
                  color="text-success"
                  value={effects.limiterThreshold}
                  min={-24}
                  max={0}
                  step={0.5}
                  disabled={!effects.limiterEnabled}
                  format={(v) => `${v.toFixed(1)}dB`}
                  onChange={(v) => updateFx({ limiterThreshold: v })}
                />
                <Knob
                  id="slider-limiter-ratio"
                  label="Ratio"
                  color="text-success"
                  value={effects.limiterRatio}
                  min={4}
                  max={20}
                  step={1}
                  disabled={!effects.limiterEnabled}
                  format={(v) => `${v.toFixed(0)}:1`}
                  onChange={(v) => updateFx({ limiterRatio: v })}
                />
                <Knob
                  id="slider-limiter-attack"
                  label="Attack"
                  color="text-success"
                  value={effects.limiterAttack}
                  min={0.001}
                  max={0.05}
                  step={0.001}
                  disabled={!effects.limiterEnabled}
                  descriptor={dynamicsAttackDescriptor(effects.limiterAttack)}
                  format={(v) => `${(v * 1000).toFixed(0)}ms`}
                  onChange={(v) => updateFx({ limiterAttack: v })}
                />
                <Knob
                  id="slider-limiter-release"
                  label="Release"
                  color="text-success"
                  value={effects.limiterRelease}
                  min={0.02}
                  max={0.5}
                  step={0.01}
                  disabled={!effects.limiterEnabled}
                  descriptor={dynamicsReleaseDescriptor(effects.limiterRelease)}
                  format={(v) => `${(v * 1000).toFixed(0)}ms`}
                  onChange={(v) => updateFx({ limiterRelease: v })}
                />
              </div>

              <GainReductionMeter stage="limiter" active={effects.limiterEnabled} />
            </div>
          </div>
        </div>
      </section>
```

- [ ] **Step 8: Run tests, the theme guard and eslint**
Run: `bun test src/components/song/EffectsRackView.test.tsx src/components/fxDescriptors.test.ts && bun run check:theme && bun run eslint`
Expected: PASS; theme guard green; eslint prints nothing at all.

If the run instead dies at import with a `ReferenceError` for `IntersectionObserver` or `requestAnimationFrame`, the cause is `src/utils/meterScheduler.ts` touching a browser global at MODULE scope — `EffectsRackView.test.tsx` renders at module scope, so it is the first test to pull the scheduler into a bun process. The fix belongs in the scheduler, not here: move the global access inside `registerMeter` / `observeVisibility`, where it already has to be lazy for the singleton to be resettable by `__resetSchedulerForTests`.

- [ ] **Step 9: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add src/components/fxDescriptors.ts src/components/fxDescriptors.test.ts \
  src/components/song/EffectsRackView.tsx src/components/song/EffectsRackView.test.tsx
git commit -m "$(cat <<'EOF'
feat(fx): surface the master compressor and limiter in the Effects view

Two toggleable modules, off by default, with threshold/ratio/attack/
release and a live gain-reduction readout each.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 9: Update the DSP skill's signal graph, then run the gate

**Files:**
- Modify: `.claude/skills/dsp-audio/SKILL.md` (the "Signal graph" block and the `masterGain` bullet)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new — this task is documentation plus the completion gate.

- [ ] **Step 1: Update the signal-graph diagram**
In `.claude/skills/dsp-audio/SKILL.md`, replace the last five lines of the graph block (from `-> eqLow(lowshelf 250Hz)` through `-> ctx.destination`) with:
```
                           -> eqLow(lowshelf 250Hz)
                              -> eqMid(peaking 1.5kHz Q1)
                                 -> eqHigh(highshelf 4kHz)
                                    -> masterGain (user master trim, setMasterVolume)
                                       |-> analyser (fftSize 256)    [TAP: no output]
                                       |-> levelAnalyser (fftSize 2048) [TAP: no output]
                                       -> [compressor?] -> [limiter?] -> ctx.destination
```
Two taps, not one: `analyser` is the spectrum node `AudioVisualizer` draws, `levelAnalyser` is the
one `getMasterLevelAnalyser()` returns and every dBFS meter reads.

- [ ] **Step 2: Replace the two stale bullets under "Key consequences"**
In the same file, replace the bullet beginning `EQ → compressor → masterGain → limiter → analyser is **serial and fixed**` and the bullet beginning `` `masterGain` is the user's master trim only ``:
```
- EQ → masterGain is serial and fixed. TWO analysers are TAPS off `masterGain` — post-fader,
  pre-dynamics, each with no onward output — so a reading reflects the mix the user made, not
  the post-squash output. `analyser` (fftSize 256) is the spectrum node `AudioVisualizer` draws;
  `levelAnalyser` (fftSize 2048) is what `getMasterLevelAnalyser()` returns and `useMeterLevel`
  reads for `VuMeter` and `AmbientBackdrop`. They are NOT interchangeable, and because the tap
  ends both dynamics stages' reach, the `over` zone (≥ −1 dBFS) is reachable.
- `masterGain` is the user's master trim only (`setMasterVolume()`, clamped 0..1, seeded at
  unity). **Nothing owns headroom by default.** The master compressor and limiter are explicit,
  toggleable master FX (`compressorEnabled` / `limiterEnabled` in `MasterEffects`) and both
  default OFF; when off they are genuinely disconnected, not neutralised. The "limiter" is a
  max-ratio compressor with a hard knee — the standard Web Audio stand-in, since the API has no
  dedicated limiter.
- A SERIES stage cannot use the `*Bypass` mechanism: bypass flags force a wet/send gain to 0,
  which for a compressor is silence rather than passthrough. `rewireMasterDynamics` reconnects
  the master tail instead. The three nodes are built once and never re-created, so a rewire can
  never orphan one; it re-makes BOTH analyser taps first and unconditionally, because
  `masterGain.disconnect()` drops both and neither has an output that would put it back.
  Forgetting `levelAnalyser` there throws nothing and orphans nothing — it just pins every meter
  at −∞, which is why `engine.test.ts` asserts the tap survives a full toggle cycle.
```

- [ ] **Step 3: Run the full gate**
Run: `bun run verify`
Expected: PASS — `bun test` green, `tsc --noEmit` clean, `eslint .` prints **nothing at all** (no errors and no warnings), `check:keys` / `check:drums` / `check:contrast` green, `vite build` succeeds.

- [ ] **Step 4: Confirm eslint is silent, explicitly**
Run: `bun run eslint 2>&1 | tee /tmp/dev385-eslint.txt; wc -c /tmp/dev385-eslint.txt`
Expected: byte count `0`. Any output at all — including a warning — is a failure of decision D5 and must be fixed, not tolerated.

- [ ] **Step 5: Commit**
```bash
cd /Users/Pathompong/Sites/Personal/solna
git add .claude/skills/dsp-audio/SKILL.md
git commit -m "$(cat <<'EOF'
docs(dsp): describe the master tail after DEV-385

Nothing owns headroom by default; the analyser is a pre-dynamics tap and
the two stages are toggleable inserts reconnected by rewireMasterDynamics.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Acceptance criteria → tasks

| Acceptance criterion | Task |
|---|---|
| Each is a user-visible, toggleable module in the Effects view alongside the existing master effects | Task 8 |
| Both default to OFF for a new project | Task 1 (`INITIAL_EFFECTS`), Task 3 (migration resets to off), Task 4 (default topology), Task 8 (dimmed cards) |
| When off, BYPASSED IN THE GRAPH — path is `EQ → masterGain → destination` | Task 4 |
| The meter taps ahead of both, reading the pre-dynamics mix; DEV-384 not undone | Task 1 Step 2 (verify BOTH taps exist and `getMasterLevelAnalyser` is present), Task 4 (both taps re-made first and unconditionally; `[analyser, levelAnalyser, …]` asserted in four wiring tests, plus a dedicated `'a full toggle cycle never drops the meter tap'` test) |
| `over` (≥ −1 dBFS) stays reachable at the tap | Task 4 — with both stages default-off the path to the tap is `EQ → masterGain` with no dynamics at all, so nothing caps the reading (this is the issue that actually delivers it; under DEV-384 alone the always-on 4:1 compressor still sat upstream of `masterGain`) |
| Gain-reduction readout in dB from `DynamicsCompressorNode.reduction` when engaged | Task 6 (getters + maths), Task 7 (component), Task 8 (placement) |
| Parameters exposed, seeded with today's values | Task 1 (defaults), Task 4 (params written to the nodes), Task 8 (knobs) |

## Definition of done → tasks

| Definition of done | Task |
|---|---|
| `bun run verify` green | Task 9 |
| `engine.test.ts` ~564 updated to assert the new DEFAULT (bypassed) wiring | Task 4 Step 2, first test |
| NEW test for the engaged wiring | Task 4 Step 2, second and third tests |
| Test that enable/disable reconnects correctly with NO ORPHANED NODES | Task 4 Step 2, fourth test |
| Test that a toggle cycle does not drop DEV-384's `levelAnalyser` tap | Task 4 Step 2, fifth test — added because a dropped tap is silent: no throw, no orphan, audio unchanged, meters at −∞ |
| Persist `version` bumped with a migration step whose comment says it resets | Task 3 |
| New state in the effects slice; engine reached only through `engineSync.ts` | Task 1, Task 5 |
| Bypass reconnection explained rather than inventing a second mechanism | Task 4 preamble + `rewireMasterDynamics` docblock |
| The limiter comment (max-ratio compressor stand-in) kept | Task 4 Step 6 and Task 9 Step 2 |
| Readout registers with the meter scheduler, no `analyser`, never in a slice | Task 7 |
| Headroom comment at `engine.ts` ~670-674 updated to say nothing owns headroom by default | Task 4 Step 5 |
| Project `formatVersion` decision stated | Task 2 preamble + the comment it lands in `sanitize.ts` — **not bumped**, because an old body sanitizes to the same object a new one would |
| eslint reports nothing | Task 9 Steps 3-4 |

## Not covered by a task, and why

Nothing in the issue is left uncovered. Two things are deliberately **out** of scope and named so a reviewer does not read them as gaps:

1. **`knee` is not stored state.** The acceptance criteria list threshold, ratio, attack and release; knee stays a fixed engine constant (30 / 0) because a soft-kneed limiter stops being a limiter. Adding it later is one field, one `EFFECT_LIMITS` row and one knob.
2. **The click when a stage is toggled mid-reduction is accepted, not fixed.** Reasoned in `rewireMasterDynamics`' docblock: the jump is zero whenever the net is idle, and the mute-rewire-unmute fix would make the topology change unobservable synchronously and put every graph test on a timer.
