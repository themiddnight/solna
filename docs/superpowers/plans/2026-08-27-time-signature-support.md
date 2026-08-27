# Variable Time Signature Support — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the meter *mechanism* — a six-row meter table, transport `meterId` state, bar-relative step derivation through the metronome/arp/sequencer/chord scheduler, accent-group UI grouping, a `meter` tag on all 45 patterns, two adaptation utilities and the persist v4→v5 migration — while leaving 4/4 output byte-identical.

**Architecture:** A new dependency-free `src/utils/meter.ts` owns the closed meter table and every bar-relative derivation. `meterId` lives on the transport slice and reaches the `audioEngine` singleton through exactly one `src/store/engineSync.ts` subscription (never from a component). Everything bar-relative is derived as `stepInBar = clockStepIndex % stepsPerBar` instead of from the module constant `STEPS_PER_BAR`. Pattern libraries stay byte-identical and only gain a meter tag; adaptation is applied at *apply-time* for the drum grid and at *playback-time* for chord/bass rhythms.

**Tech Stack:** Bun (test runner + scripts), Vite + React 18, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API (no Tone.js), `tonal` for theory only, Tailwind v4 + daisyUI v5 (CSS-first, no `tailwind.config.*`).

**Spec:** `docs/superpowers/specs/2026-08-27-time-signature-support-design.md`

**Stage scope:** This plan covers **Stage 1 only** (spec §"Delivery stages"). **Stage 2 — authoring native 3/4 and 6/8 patterns for drums, chord rhythms, bass and any vibes that use them — is explicitly OUT OF SCOPE here.** Stage 1 ships the mechanism with every shipped pattern still tagged `'4/4'`. Do not author new patterns in any task below; if a task tempts you to, stop and re-read the spec's Delivery stages section.

**Acceptance bar for the whole plan:** with the meter left at `4/4`, behaviour and audio output are byte-identical to today, and every existing preset still works. Every task below is written so that its 4/4 path reduces to the exact arithmetic the current code performs.

## Global Constraints

- **Three-layer import boundary, enforced by eslint `no-restricted-imports` (`eslint.config.js`).** `src/audio/` must not import `store/` or `components/`; `src/store/` must not import `components/`; `src/components/` must not import `audio/engine` (only `AudioVisualizer.tsx`, `TransportBar.tsx` and `*.test.ts(x)` are exempt). `src/utils/` is importable from all three — that is why `meter.ts` lives there.
- **Never call an engine setter from a component.** New engine-settable state is added to a slice and wired in `src/store/engineSync.ts` with `fireImmediately: true`, plus a line in `applySliceState()`.
- **No DOM / testing-library setup exists in this repo.** Tests are `bun:test` and **pure-logic**: components export their testable helpers (`resolveInitialTheme`/`persistTheme` from `Header.tsx`, `KEYBOARD_NOTES` from `SynthView.tsx`, `DEFAULT_PADS` from `DrumPads.tsx`) and the test file imports those instead of rendering React. **Every component task in this plan must extract its logic into an exported pure helper and test that helper.** Do not add `@testing-library/*`, jsdom, or `happy-dom`.
- **The one sanctioned exception is `renderToString` from `react-dom/server`**, used only for *markup/theme* assertions on a component's emitted class strings — see `src/components/SequencerView.test.tsx:1-6` and `src/components/TransportBar.test.tsx:1-6`. It is a string render, not a DOM. Never use it to test behaviour; extract a helper for that.
- **Theme rule.** Components name roles, never colours. `scripts/themeTokenGuard.ts` fails on raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`, the `dark:` variant, `rgb()`/`rgba()` literals and dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and must stay empty. There is no `tailwind.config.*` and none may be added.
- **Do not rename any Instant Vibe id.** Ids are persisted in project files and the id↔label drift is intentional (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden").
- **Meter table values, copied verbatim from the spec.** `4/4` → 16 steps, `[4,4,4,4]`; `3/4` → 12, `[4,4,4]`; `6/8` → 12, `[6,6]`; `12/8` → 24, `[6,6,6,6]`; `5/4` → 20, `[4,4,4,4,4]`; `7/8` → 14, `[6,4,4]`. `MAX_STEPS_PER_BAR = 24`.
- **Adaptation rules, copied verbatim from the spec.** Shorter target → **trim** (drop steps at or after `stepsPerBar`; clamp `holdSteps` to the bar end for event-shaped patterns). Longer target → **loop** from step 0 until the bar is filled. **Never stretch or rescale.**
- **Persist.** Key `musibox_project_state_v1`, currently `version: 4` in `src/store/store.ts:282`. This work bumps it to **5**. (`CLAUDE.md` says "version 3" — stale; Task 4 fixes it.)
- **The completion gate is `bun run verify`, PLUS `bun run eslint` run separately** — `verify` does not include eslint, and this work adds a new `src/utils/meter.ts` imported across all three layers.
- **Every task ends with its own commit.** Commit bodies stay in English.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/utils/meter.ts` | The closed `Meter` table and every bar-relative derivation: `getMeter`, `beatIndexAt`, `isBeatBoundary`, `arpStepFor`, `MAX_STEPS_PER_BAR`. Imports nothing. |
| `src/utils/meter.test.ts` | Table invariants + derivation tests, including the 7/8 no-drift regression. |
| `src/utils/patternAdapt.ts` | Array-shaped row ops for `boolean[]` / `number[]` drum rows: `adaptStepRow`, `padStepRow`, and (Task 9) `rotateStepWindow`. |
| `src/utils/patternAdapt.test.ts` | Tests for the above. |
| `src/utils/eventAdapt.ts` | Event-shaped ops for `RhythmHit[]` / `BassStep[]`: `adaptStepEvents`. |
| `src/utils/eventAdapt.test.ts` | Tests for the above, including `holdSteps` clamping. |
| `src/components/meterSelect.ts` | Pure option-model for the transport meter `select` (label + value rows), so the select can be tested without React. |
| `src/components/meterSelect.test.ts` | Tests for the option model. |
| `src/audio/meterRegression.test.ts` | Task 16: the pin that 4/4 output is unchanged. |

**Modified** (headline responsibility change only; exact line ranges are in each task)

`src/utils/musicTheory.ts` (`barDurationSec` gains `stepsPerBar`), `src/utils/playhead.ts` (`BEATS_PER_BAR` becomes a default, beats-per-bar becomes an input), `src/store/types.ts` (+`meterId`/`setMeter`, `PersistedState.meterId`), `src/store/transportSlice.ts` (+state and setter), `src/store/store.ts` (persist v5 + partialize), `src/store/migrate.ts` (+`migrateMeterAndStepWidth`), `src/store/initialState.ts` (step arrays padded to 24), `src/store/engineSync.ts` (+meter subscription), `src/store/instantVibes.ts` (vibes declare a meter; apply sets it), `src/audio/engine.ts` (meter field, `stepInBar` metronome + beat dispatch), `src/audio/playback/chordPlayback.ts` (`arpEventsForStep` gains `stepsPerBar`), `src/audio/playback/arpPlayback.ts` (bar-phased arp step), `src/audio/rhythmPatterns.ts` / `src/audio/bassPatterns.ts` (+`meter` field), `src/audio/data/vibeDrumPatterns.ts` (+`VIBE_DRUM_PATTERN_METERS` sidecar), `src/audio/data/genrePresets.ts` (reshaped to `{ meter, rows }`), `src/components/useSequencerPlayback.ts` (real `stepsPerBar`), `src/components/chord/useChordPlayback.ts` (real `stepsPerBar`, playback-time adaptation), `src/components/SequencerView.tsx` (windowing + accent-group UI), `src/components/TransportBar.tsx` (+meter select), `src/types.ts` (`InstantVibe.meter`), `CLAUDE.md` (persist version fix).

**Two deliberate deviations from the spec, both verified against the code:**

1. The spec says the three non-`GENRE_PRESETS` libraries "are already object-shaped and just gain a field". Verified false for one of them: `VIBE_DRUM_PATTERNS` is `Record<string, Record<string, number[]>>` (`src/audio/data/vibeDrumPatterns.ts:22`) — flat rows, exactly the shape problem `GENRE_PRESETS` has. Reshaping it would ripple into `drumPatternById`'s return type, `InstantVibe.drumPattern` (`src/types.ts:179`), `ORIGINAL_VIBE_DRUM_PATTERNS` (`src/store/instantVibesDrumsFixture.ts:25`) and three golden invariant tests. Task 12 therefore adds a **sidecar** `VIBE_DRUM_PATTERN_METERS: Record<string, MeterId>` instead of reshaping. `RHYTHM_PATTERNS` and `BASS_PATTERNS` genuinely are object-shaped and do just gain a field.
2. The spec lists `src/utils/musicTheory.test.ts:322-323` (`STEPS_PER_BAR === 16`) as a test that "must be updated". It does not need to be. This plan keeps `STEPS_PER_BAR` exported at 16 and redefines it as `getMeter('4/4').stepsPerBar` — it survives only as the **default parameter value** for the handful of functions that already default to it, so the assertion stays true and meaningful.

---

### Task 1: The meter table and its derivations

**Files:**
- Create: `src/utils/meter.ts`
- Create: `src/utils/meter.test.ts`

**Interfaces:**
- Consumes: nothing. This module imports nothing at all, so it is safe to import from `audio/`, `store/` and `components/` alike.
- Produces:
  - `type MeterId = '4/4' | '3/4' | '6/8' | '12/8' | '5/4' | '7/8'`
  - `interface Meter { id: MeterId; label: string; stepsPerBar: number; accentGroups: number[] }`
  - `const METERS: Record<MeterId, Meter>`
  - `const METER_IDS: MeterId[]` (declaration order: `'4/4','3/4','6/8','12/8','5/4','7/8'`)
  - `const DEFAULT_METER_ID: MeterId` (`'4/4'`)
  - `const MAX_STEPS_PER_BAR = 24`
  - `function isMeterId(value: unknown): value is MeterId`
  - `function getMeter(id: string | null | undefined): Meter` — falls back to the 4/4 row for anything unknown
  - `function beatIndexAt(stepInBar: number, accentGroups: number[]): number` — index of the accent group *containing* the step
  - `function isBeatBoundary(stepInBar: number, accentGroups: number[]): boolean` — true only at a group's first step
  - `function arpStepFor(clockStep: number, stepsPerBar: number): number` — bar-phased arp step (identity when `stepsPerBar` is a multiple of 4)

- [ ] **Step 1: Write the failing test**

Create `src/utils/meter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  METERS,
  METER_IDS,
  DEFAULT_METER_ID,
  MAX_STEPS_PER_BAR,
  getMeter,
  isMeterId,
  beatIndexAt,
  isBeatBoundary,
  arpStepFor,
  type MeterId,
} from './meter';

describe('the meter table', () => {
  test('holds exactly the six meters the spec names, in declaration order', () => {
    expect(METER_IDS).toEqual(['4/4', '3/4', '6/8', '12/8', '5/4', '7/8']);
    expect(Object.keys(METERS).sort()).toEqual([...METER_IDS].sort());
  });

  test('every row carries the exact stepsPerBar and accentGroups from the spec', () => {
    expect(METERS['4/4'].stepsPerBar).toBe(16);
    expect(METERS['4/4'].accentGroups).toEqual([4, 4, 4, 4]);
    expect(METERS['3/4'].stepsPerBar).toBe(12);
    expect(METERS['3/4'].accentGroups).toEqual([4, 4, 4]);
    expect(METERS['6/8'].stepsPerBar).toBe(12);
    expect(METERS['6/8'].accentGroups).toEqual([6, 6]);
    expect(METERS['12/8'].stepsPerBar).toBe(24);
    expect(METERS['12/8'].accentGroups).toEqual([6, 6, 6, 6]);
    expect(METERS['5/4'].stepsPerBar).toBe(20);
    expect(METERS['5/4'].accentGroups).toEqual([4, 4, 4, 4, 4]);
    expect(METERS['7/8'].stepsPerBar).toBe(14);
    expect(METERS['7/8'].accentGroups).toEqual([6, 4, 4]);
  });

  test("INVARIANT: every row's accentGroups sums to its stepsPerBar", () => {
    for (const id of METER_IDS) {
      const meter = METERS[id];
      const sum = meter.accentGroups.reduce((a, b) => a + b, 0);
      expect(sum, `${id} accentGroups must sum to stepsPerBar`).toBe(meter.stepsPerBar);
    }
  });

  test('every row is self-consistent: id matches its key, groups are positive integers', () => {
    for (const id of METER_IDS) {
      const meter = METERS[id];
      expect(meter.id).toBe(id);
      expect(meter.label.length).toBeGreaterThan(0);
      expect(meter.accentGroups.length).toBeGreaterThan(0);
      for (const group of meter.accentGroups) {
        expect(Number.isInteger(group)).toBe(true);
        expect(group).toBeGreaterThan(0);
      }
    }
  });

  test('MAX_STEPS_PER_BAR is the widest row and no row exceeds it', () => {
    expect(MAX_STEPS_PER_BAR).toBe(24);
    const widest = Math.max(...METER_IDS.map((id) => METERS[id].stepsPerBar));
    expect(widest).toBe(MAX_STEPS_PER_BAR);
  });

  test('3/4 and 6/8 share a bar length and are told apart only by accentGroups', () => {
    expect(METERS['3/4'].stepsPerBar).toBe(METERS['6/8'].stepsPerBar);
    expect(METERS['3/4'].accentGroups).not.toEqual(METERS['6/8'].accentGroups);
  });
});

describe('getMeter / isMeterId', () => {
  test('resolves every known id to its own row', () => {
    for (const id of METER_IDS) expect(getMeter(id)).toBe(METERS[id]);
  });

  test('falls back to 4/4 for anything unknown, so persisted junk cannot break the clock', () => {
    expect(DEFAULT_METER_ID).toBe('4/4');
    expect(getMeter('9/8')).toBe(METERS['4/4']);
    expect(getMeter('')).toBe(METERS['4/4']);
    expect(getMeter(null)).toBe(METERS['4/4']);
    expect(getMeter(undefined)).toBe(METERS['4/4']);
  });

  test('isMeterId narrows only real ids', () => {
    expect(isMeterId('7/8')).toBe(true);
    expect(isMeterId('9/8')).toBe(false);
    expect(isMeterId(16)).toBe(false);
    expect(isMeterId(null)).toBe(false);
  });
});

describe('beatIndexAt / isBeatBoundary', () => {
  test('4/4 reproduces the current floor(step / 4) and step % 4 === 0 exactly', () => {
    const groups = METERS['4/4'].accentGroups;
    for (let step = 0; step < 16; step++) {
      expect(beatIndexAt(step, groups)).toBe(Math.floor(step / 4));
      expect(isBeatBoundary(step, groups)).toBe(step % 4 === 0);
    }
  });

  test('6/8 groups its twelve steps into two beats of six', () => {
    const groups = METERS['6/8'].accentGroups;
    expect([0, 1, 2, 3, 4, 5].map((s) => beatIndexAt(s, groups))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([6, 7, 8, 9, 10, 11].map((s) => beatIndexAt(s, groups))).toEqual([1, 1, 1, 1, 1, 1]);
    expect([0, 6].every((s) => isBeatBoundary(s, groups))).toBe(true);
    expect([1, 5, 7, 11].some((s) => isBeatBoundary(s, groups))).toBe(false);
  });

  test('7/8 boundaries follow the uneven 3+2+2 grouping', () => {
    const groups = METERS['7/8'].accentGroups;
    const boundaries = Array.from({ length: 14 }, (_, s) => s).filter((s) =>
      isBeatBoundary(s, groups),
    );
    expect(boundaries).toEqual([0, 6, 10]);
    expect(beatIndexAt(5, groups)).toBe(0);
    expect(beatIndexAt(6, groups)).toBe(1);
    expect(beatIndexAt(9, groups)).toBe(1);
    expect(beatIndexAt(10, groups)).toBe(2);
    expect(beatIndexAt(13, groups)).toBe(2);
  });

  test('a step past the last group clamps to the last beat rather than reporting NaN', () => {
    const groups = METERS['3/4'].accentGroups;
    expect(beatIndexAt(12, groups)).toBe(2);
    expect(beatIndexAt(99, groups)).toBe(2);
    expect(beatIndexAt(-1, groups)).toBe(0);
    expect(isBeatBoundary(-1, groups)).toBe(false);
    expect(isBeatBoundary(12, groups)).toBe(false);
  });
});

describe('arpStepFor — the monotonic-counter trap', () => {
  test('is the identity for every meter whose bar is a multiple of four steps', () => {
    for (const stepsPerBar of [16, 12, 24, 20]) {
      for (let step = 0; step < 200; step++) {
        expect(arpStepFor(step, stepsPerBar)).toBe(step);
      }
    }
  });

  test('7/8 lands the same arp phase in every bar instead of drifting', () => {
    const bar = METERS['7/8'].stepsPerBar; // 14
    for (let stepInBar = 0; stepInBar < bar; stepInBar++) {
      const first = arpStepFor(stepInBar, bar);
      for (let barIndex = 1; barIndex < 12; barIndex++) {
        const later = arpStepFor(barIndex * bar + stepInBar, bar);
        expect(later % 4).toBe(first % 4);
        expect(later % 2).toBe(first % 2);
      }
    }
  });

  test('the raw clock step DOES drift in 7/8 — this is the bug being fixed', () => {
    const bar = 14;
    expect(0 % 4).toBe(0);
    expect((1 * bar + 0) % 4).toBe(2); // bar 2 downbeat no longer lands on a quarter
    expect(arpStepFor(1 * bar + 0, bar) % 4).toBe(0); // ...but the phased step does
  });

  test('arpStepFor never goes backwards', () => {
    for (const stepsPerBar of [14, 16, 20]) {
      for (let step = 1; step < 300; step++) {
        expect(arpStepFor(step, stepsPerBar)).toBeGreaterThan(arpStepFor(step - 1, stepsPerBar));
      }
    }
  });
});

describe('type surface', () => {
  test('MeterId is assignable from every table key', () => {
    const ids: MeterId[] = [...METER_IDS];
    expect(ids.length).toBe(6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/meter.test.ts`
Expected: FAIL — `Cannot find module './meter'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/meter.ts`:

```ts
/**
 * The closed meter table and every bar-relative derivation in the app.
 *
 * This module imports NOTHING. That is load-bearing: audio/, store/ and
 * components/ all need it, and the eslint layering rules (eslint.config.js)
 * only permit that for a leaf module under utils/.
 *
 * The 16th-note grid never changes — every meter in scope is an integer number
 * of 16th steps per bar — so meter is a plumbing concern, not a DSP one.
 */

export type MeterId = '4/4' | '3/4' | '6/8' | '12/8' | '5/4' | '7/8';

export interface Meter {
  id: MeterId;
  /** Display string for the transport select. */
  label: string;
  /** Bar length, in 16th steps. */
  stepsPerBar: number;
  /**
   * 16th steps per beat group; MUST sum to stepsPerBar (pinned by meter.test.ts).
   *
   * This replaces a separate `stepsPerBeat` field and is the single source for
   * three things: where the metronome clicks, how many beats the chord playhead
   * counts, and how the sequencer UI draws its beat groupings. 3/4 and 6/8 share
   * a 12-step bar and are distinguished ONLY by this field — which is exactly
   * why bar length alone is not a sufficient pattern tag.
   */
  accentGroups: number[];
}

export const METERS: Record<MeterId, Meter> = {
  '4/4': { id: '4/4', label: '4/4', stepsPerBar: 16, accentGroups: [4, 4, 4, 4] },
  '3/4': { id: '3/4', label: '3/4', stepsPerBar: 12, accentGroups: [4, 4, 4] },
  '6/8': { id: '6/8', label: '6/8', stepsPerBar: 12, accentGroups: [6, 6] },
  '12/8': { id: '12/8', label: '12/8', stepsPerBar: 24, accentGroups: [6, 6, 6, 6] },
  '5/4': { id: '5/4', label: '5/4', stepsPerBar: 20, accentGroups: [4, 4, 4, 4, 4] },
  // 3+2+2, the standard Balkan grouping.
  '7/8': { id: '7/8', label: '7/8', stepsPerBar: 14, accentGroups: [6, 4, 4] },
};

/** Declaration order — the order the transport select lists them in. */
export const METER_IDS: MeterId[] = ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8'];

export const DEFAULT_METER_ID: MeterId = '4/4';

/**
 * The widest bar in the table (the 12/8 row). Sequencer step arrays are always
 * STORED at this width so switching meter is non-destructive to the user's own
 * programming; playback and the UI window the first `stepsPerBar` entries.
 */
export const MAX_STEPS_PER_BAR = 24;

export function isMeterId(value: unknown): value is MeterId {
  return typeof value === 'string' && Object.hasOwn(METERS, value);
}

/**
 * Resolve a meter id. Anything unknown — a persisted id from a future build, a
 * corrupt payload, an empty string — falls back to 4/4 rather than throwing:
 * this value feeds the clock, and a throw there would freeze the transport.
 */
export function getMeter(id: string | null | undefined): Meter {
  return isMeterId(id) ? METERS[id] : METERS[DEFAULT_METER_ID];
}

/**
 * Which accent group contains `stepInBar`. For 4/4 this is exactly
 * `Math.floor(stepInBar / 4)`, which is what the engine currently dispatches as
 * its `beat` argument — so 4/4 output is unchanged by construction.
 *
 * Out-of-range steps clamp instead of returning NaN: a negative step reports
 * beat 0 and an overrun reports the last beat.
 */
export function beatIndexAt(stepInBar: number, accentGroups: number[]): number {
  if (accentGroups.length === 0) return 0;
  if (stepInBar <= 0) return 0;
  let cursor = 0;
  for (let i = 0; i < accentGroups.length; i++) {
    cursor += accentGroups[i];
    if (stepInBar < cursor) return i;
  }
  return accentGroups.length - 1;
}

/**
 * True only on the FIRST step of an accent group — i.e. where the metronome
 * clicks. For 4/4 this is exactly `stepInBar % 4 === 0`.
 */
export function isBeatBoundary(stepInBar: number, accentGroups: number[]): boolean {
  if (stepInBar < 0) return false;
  let cursor = 0;
  for (const group of accentGroups) {
    if (stepInBar === cursor) return true;
    cursor += group;
    if (stepInBar < cursor) return false;
  }
  return false;
}

/**
 * The arpeggiator's rate table (audio/arpSchedule.ts) fires on
 * `step % stepMod` with stepMod in {4, 2, 1, 0.5}, and the engine's
 * `clockStepIndex` is monotonic and never resets. When `stepsPerBar` is NOT a
 * multiple of 4 (7/8 = 14 steps) the arp phase slides against the bar line and
 * never lands the same way twice.
 *
 * `arpStepFor` re-phases the arp at each bar by widening every bar to the next
 * multiple of ARP_PHASE_QUANTUM for phase purposes only. This is DELIBERATE
 * behaviour, not a rounding artefact: in an odd meter the arp restarts its
 * subdivision phase on every downbeat.
 *
 * It is the IDENTITY whenever `stepsPerBar` is already a multiple of 4 — which
 * covers every meter in the table except 7/8 — so 4/4 output is byte-identical.
 */
export const ARP_PHASE_QUANTUM = 4;

export function arpBarPhaseLength(stepsPerBar: number): number {
  return Math.ceil(stepsPerBar / ARP_PHASE_QUANTUM) * ARP_PHASE_QUANTUM;
}

export function arpStepFor(clockStep: number, stepsPerBar: number): number {
  if (stepsPerBar <= 0) return clockStep;
  const barIndex = Math.floor(clockStep / stepsPerBar);
  const stepInBar = clockStep - barIndex * stepsPerBar;
  return barIndex * arpBarPhaseLength(stepsPerBar) + stepInBar;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/meter.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/meter.ts src/utils/meter.test.ts
git commit -m "feat(meter): add the meter table and bar-relative derivations"
```

---

### Task 2: Array-shaped pattern adaptation (drum rows)

**Files:**
- Create: `src/utils/patternAdapt.ts`
- Create: `src/utils/patternAdapt.test.ts`

**Interfaces:**
- Consumes: `MAX_STEPS_PER_BAR` from `src/utils/meter.ts` (Task 1).
- Produces:
  - `function adaptStepRow<T>(row: readonly T[], targetSteps: number): T[]` — trims when the target is shorter, loops from index 0 when longer. Generic so it serves both `boolean[]` (`GENRE_PRESETS`) and `number[]` (`VIBE_DRUM_PATTERNS`).
  - `function adaptStepRows<T>(rows: Record<string, readonly T[]>, targetSteps: number): Record<string, T[]>`
  - `function padStepRow(row: readonly boolean[], width?: number): boolean[]` — pads with `false` to `width` (default `MAX_STEPS_PER_BAR`), truncates anything longer. Used by the v4→v5 migration in Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/utils/patternAdapt.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { adaptStepRow, adaptStepRows, padStepRow } from './patternAdapt';
import { MAX_STEPS_PER_BAR } from './meter';

const FOUR_ON_FLOOR = [
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
];

describe('adaptStepRow — equal length', () => {
  test('a 16-step row targeted at 16 comes back element-for-element equal', () => {
    expect(adaptStepRow(FOUR_ON_FLOOR, 16)).toEqual(FOUR_ON_FLOOR);
  });

  test('returns a fresh array, never the caller-supplied one', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 16);
    expect(out).not.toBe(FOUR_ON_FLOOR);
    out[0] = false;
    expect(FOUR_ON_FLOOR[0]).toBe(true);
  });
});

describe('adaptStepRow — shorter target trims', () => {
  test('four-on-floor trimmed to a 12-step bar keeps kicks at 0, 4, 8 and drops step 12', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 12);
    expect(out.length).toBe(12);
    expect(out.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8]);
  });

  test('never rescales: a trimmed row is a literal prefix of the source', () => {
    const dense = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1];
    expect(adaptStepRow(dense, 14)).toEqual(dense.slice(0, 14));
    expect(adaptStepRow(dense, 12)).toEqual(dense.slice(0, 12));
  });
});

describe('adaptStepRow — longer target loops from step 0', () => {
  test('16 filling 20 takes steps 16-19 from source steps 0-3', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 20);
    expect(out.length).toBe(20);
    expect(out.slice(0, 16)).toEqual(FOUR_ON_FLOOR);
    expect(out.slice(16)).toEqual(FOUR_ON_FLOOR.slice(0, 4));
  });

  test('16 filling 24 wraps once and a half, so every bar sounds identical', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 24);
    expect(out.length).toBe(24);
    for (let i = 0; i < 24; i++) expect(out[i]).toBe(FOUR_ON_FLOOR[i % 16]);
  });

  test('a source shorter than the target wraps repeatedly', () => {
    expect(adaptStepRow([1, 0, 0], 8)).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
  });
});

describe('adaptStepRow — degenerate input', () => {
  test('an empty source yields an empty row rather than looping forever', () => {
    expect(adaptStepRow([], 16)).toEqual([]);
  });

  test('a non-positive target yields an empty row', () => {
    expect(adaptStepRow(FOUR_ON_FLOOR, 0)).toEqual([]);
    expect(adaptStepRow(FOUR_ON_FLOOR, -4)).toEqual([]);
  });
});

describe('adaptStepRows', () => {
  test('adapts every row and preserves the row key set exactly', () => {
    const rows = {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    };
    const out = adaptStepRows(rows, 12);
    expect(Object.keys(out).sort()).toEqual(['kick', 'snare']);
    expect(out.kick.length).toBe(12);
    expect(out.snare.length).toBe(12);
    expect(out.snare.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([4]);
  });

  test('shares no array instance with the input', () => {
    const rows = { kick: [true, false] };
    const out = adaptStepRows(rows, 2);
    expect(out.kick).not.toBe(rows.kick);
  });
});

describe('padStepRow', () => {
  test('pads a legacy 16-length row to 24 with false', () => {
    const out = padStepRow(FOUR_ON_FLOOR);
    expect(out.length).toBe(MAX_STEPS_PER_BAR);
    expect(out.slice(0, 16)).toEqual(FOUR_ON_FLOOR);
    expect(out.slice(16)).toEqual([false, false, false, false, false, false, false, false]);
  });

  test('leaves an already-24-wide row untouched in value', () => {
    const wide = Array.from({ length: 24 }, (_, i) => i % 6 === 0);
    expect(padStepRow(wide)).toEqual(wide);
  });

  test('truncates anything wider than the target', () => {
    const tooWide = Array.from({ length: 32 }, () => true);
    expect(padStepRow(tooWide).length).toBe(24);
  });

  test('coerces non-boolean cells from a corrupt persisted payload', () => {
    const junk = [1, 'x', null, undefined] as unknown as boolean[];
    expect(padStepRow(junk).slice(0, 4)).toEqual([false, false, false, false]);
  });

  test('accepts an explicit width', () => {
    expect(padStepRow([true], 4)).toEqual([true, false, false, false]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/patternAdapt.test.ts`
Expected: FAIL — `Cannot find module './patternAdapt'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/patternAdapt.ts`:

```ts
import { MAX_STEPS_PER_BAR } from './meter';

/**
 * Array-shaped pattern adaptation: the drum rows, which are dense per-step
 * arrays (`boolean[]` in GENRE_PRESETS, `number[]` in VIBE_DRUM_PATTERNS).
 * The event-shaped siblings (RhythmHit[]/BassStep[]) live in eventAdapt.ts.
 *
 * Two rules, and only two (see the spec, "Pattern adaptation"):
 *
 *   - Shorter target -> TRIM. Drop every step at or after `targetSteps`.
 *   - Longer target  -> LOOP. Repeat the source from index 0 until the bar is
 *     full, so every bar plays identically and nothing drifts across bar lines.
 *
 * NEVER stretch or rescale. A four-on-floor kick at 0/4/8/12 trimmed to a
 * 12-step bar must yield 0/4/8 — musically correct. A proportional stretch
 * would yield 0/3/6/9, which is wrong, and rounding a dense hi-hat row onto the
 * 16th grid collapses or duplicates hits.
 */
export function adaptStepRow<T>(row: readonly T[], targetSteps: number): T[] {
  if (targetSteps <= 0 || row.length === 0) return [];
  const out: T[] = new Array(targetSteps);
  for (let i = 0; i < targetSteps; i++) out[i] = row[i % row.length];
  return out;
}

/** `adaptStepRow` across a whole instrument -> row map, preserving the key set. */
export function adaptStepRows<T>(
  rows: Record<string, readonly T[]>,
  targetSteps: number,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [name, row] of Object.entries(rows)) {
    out[name] = adaptStepRow(row, targetSteps);
  }
  return out;
}

/**
 * Widen a stored sequencer row to the persisted step width. Distinct from
 * `adaptStepRow`: padding adds SILENCE, because these are the user's own
 * programming and inventing hits for the extra steps would be a lie. Cells are
 * coerced to booleans so a corrupt persisted payload cannot reach the grid.
 */
export function padStepRow(row: readonly boolean[], width = MAX_STEPS_PER_BAR): boolean[] {
  const out: boolean[] = new Array(width);
  for (let i = 0; i < width; i++) out[i] = row[i] === true;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/patternAdapt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/patternAdapt.ts src/utils/patternAdapt.test.ts
git commit -m "feat(meter): add array-shaped drum-row adaptation utilities"
```

---

### Task 3: Event-shaped pattern adaptation (chord + bass rhythms)

**Files:**
- Create: `src/utils/eventAdapt.ts`
- Create: `src/utils/eventAdapt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (structurally typed on `{ step: number; holdSteps?: number }`, so it needs neither `RhythmHit` nor `BassStep` imported — which keeps `utils/` from depending on `audio/`).
- Produces:
  - `interface StepPositioned { step: number; holdSteps?: number }`
  - `function adaptStepEvents<T extends StepPositioned>(events: readonly T[], sourceSteps: number, targetSteps: number): T[]`

  Semantics: when `targetSteps <= sourceSteps`, keep only events with `step < targetSteps` and clamp each `holdSteps` to `targetSteps - step`; when `targetSteps > sourceSteps`, emit the source events once per repetition (offsetting `step` by `rep * sourceSteps`) until the bar is filled, clamping every `holdSteps` to the bar end. Events with `step` outside `[0, sourceSteps)` are dropped. The output is sorted by `step` ascending, stable within a step.

- [ ] **Step 1: Write the failing test**

Create `src/utils/eventAdapt.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { adaptStepEvents, type StepPositioned } from './eventAdapt';

interface Hit extends StepPositioned {
  step: number;
  holdSteps?: number;
  tag: string;
}

const EIGHTHS: Hit[] = [
  { step: 0, holdSteps: 2, tag: 'a' },
  { step: 4, holdSteps: 2, tag: 'b' },
  { step: 8, holdSteps: 2, tag: 'c' },
  { step: 12, holdSteps: 2, tag: 'd' },
];

describe('adaptStepEvents — equal length', () => {
  test('16 -> 16 returns the same events with the same holds', () => {
    expect(adaptStepEvents(EIGHTHS, 16, 16)).toEqual(EIGHTHS);
  });

  test('returns fresh objects so a caller cannot mutate the library', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 16);
    expect(out[0]).not.toBe(EIGHTHS[0]);
    out[0].tag = 'mutated';
    expect(EIGHTHS[0].tag).toBe('a');
  });
});

describe('adaptStepEvents — shorter target trims and clamps', () => {
  test('16 -> 12 drops the step-12 hit entirely', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 12);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8]);
    expect(out.map((e) => e.tag)).toEqual(['a', 'b', 'c']);
  });

  test('a hold that would ring past the bar end is clamped to the bar end', () => {
    const long: Hit[] = [{ step: 10, holdSteps: 8, tag: 'long' }];
    const out = adaptStepEvents(long, 16, 12);
    expect(out).toEqual([{ step: 10, holdSteps: 2, tag: 'long' }]);
  });

  test('a hold already inside the bar is left alone', () => {
    const short: Hit[] = [{ step: 2, holdSteps: 2, tag: 'short' }];
    expect(adaptStepEvents(short, 16, 12)).toEqual([{ step: 2, holdSteps: 2, tag: 'short' }]);
  });

  test('an absent holdSteps is materialised only when it must be clamped', () => {
    const noHold: Hit[] = [
      { step: 0, tag: 'x' },
      { step: 11, tag: 'y' },
    ];
    const out = adaptStepEvents(noHold, 16, 12);
    expect(out[0].holdSteps).toBeUndefined();
    expect(out[1].holdSteps).toBeUndefined(); // default 1 step already fits 11 -> 12
  });

  test('a default-1 hold on the very last step still fits and stays implicit', () => {
    const edge: Hit[] = [{ step: 11, tag: 'edge' }];
    expect(adaptStepEvents(edge, 16, 12)).toEqual([{ step: 11, tag: 'edge' }]);
  });

  test('every surviving hold ends at or before the bar line', () => {
    const messy: Hit[] = [
      { step: 0, holdSteps: 16, tag: 'p' },
      { step: 6, holdSteps: 9, tag: 'q' },
      { step: 13, holdSteps: 1, tag: 'r' },
    ];
    const out = adaptStepEvents(messy, 16, 12);
    for (const e of out) expect(e.step + (e.holdSteps ?? 1)).toBeLessThanOrEqual(12);
  });
});

describe('adaptStepEvents — longer target loops', () => {
  test('16 -> 20 repeats the source from step 0 into steps 16-19', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 20);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16]);
    expect(out[4].tag).toBe('a');
  });

  test('the looped copy keeps its hold, clamped to the bar end', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 18);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16]);
    expect(out[4].holdSteps).toBe(2);

    const tight = adaptStepEvents(EIGHTHS, 16, 17);
    expect(tight.map((e) => e.step)).toEqual([0, 4, 8, 12, 16]);
    expect(tight[4].holdSteps).toBe(1);
  });

  test('16 -> 24 wraps one and a half times', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 24);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(out.map((e) => e.tag)).toEqual(['a', 'b', 'c', 'd', 'a', 'b']);
  });

  test('a 12-step source filling a 24-step bar repeats exactly twice', () => {
    const waltz: Hit[] = [
      { step: 0, holdSteps: 4, tag: 'one' },
      { step: 4, holdSteps: 4, tag: 'two' },
      { step: 8, holdSteps: 4, tag: 'three' },
    ];
    const out = adaptStepEvents(waltz, 12, 24);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(out.every((e) => e.holdSteps === 4)).toBe(true);
  });
});

describe('adaptStepEvents — degenerate input', () => {
  test('an event outside the source bar is dropped', () => {
    const stray: Hit[] = [
      { step: -1, tag: 'before' },
      { step: 16, tag: 'after' },
      { step: 3, tag: 'inside' },
    ];
    expect(adaptStepEvents(stray, 16, 16).map((e) => e.tag)).toEqual(['inside']);
  });

  test('an empty source or non-positive target yields no events', () => {
    expect(adaptStepEvents([], 16, 12)).toEqual([]);
    expect(adaptStepEvents(EIGHTHS, 16, 0)).toEqual([]);
    expect(adaptStepEvents(EIGHTHS, 0, 12)).toEqual([]);
  });

  test('output is sorted by step ascending', () => {
    const unsorted: Hit[] = [
      { step: 9, tag: 'c' },
      { step: 1, tag: 'a' },
      { step: 5, tag: 'b' },
    ];
    expect(adaptStepEvents(unsorted, 12, 24).map((e) => e.step)).toEqual([1, 5, 9, 13, 17, 21]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/eventAdapt.test.ts`
Expected: FAIL — `Cannot find module './eventAdapt'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/eventAdapt.ts`:

```ts
/**
 * Event-shaped pattern adaptation: the sparse, positioned patterns —
 * `RhythmHit[]` (audio/rhythmPatterns.ts) and `BassStep[]`
 * (audio/bassPatterns.ts). The dense drum-row siblings live in patternAdapt.ts.
 *
 * Structurally typed on `{ step, holdSteps? }` on purpose: utils/ must not
 * import audio/, and both event types already satisfy this shape.
 *
 * Same two rules as the array-shaped side, plus one extra obligation: an event
 * carries a DURATION, so trimming must also clamp `holdSteps` — otherwise a
 * note rings past the bar end and over the next chord.
 */
export interface StepPositioned {
  /** 16th-note position within the bar. */
  step: number;
  /** How many 16th steps the event holds. Absent means 1. */
  holdSteps?: number;
}

const DEFAULT_HOLD_STEPS = 1;

export function adaptStepEvents<T extends StepPositioned>(
  events: readonly T[],
  sourceSteps: number,
  targetSteps: number,
): T[] {
  if (targetSteps <= 0 || sourceSteps <= 0 || events.length === 0) return [];

  const inBar = events.filter((ev) => ev.step >= 0 && ev.step < sourceSteps);
  const repetitions = Math.ceil(targetSteps / sourceSteps);
  const out: T[] = [];

  for (let rep = 0; rep < repetitions; rep++) {
    const offset = rep * sourceSteps;
    for (const ev of inBar) {
      const step = ev.step + offset;
      if (step >= targetSteps) continue;
      const room = targetSteps - step;
      const hold = ev.holdSteps ?? DEFAULT_HOLD_STEPS;
      // Only materialise holdSteps when the clamp actually bites: leaving an
      // implicit hold implicit keeps the adapted event deep-equal to the
      // source in the common 4/4 -> 4/4 case.
      const clamped: T =
        hold > room ? ({ ...ev, step, holdSteps: room } as T) : ({ ...ev, step } as T);
      out.push(clamped);
    }
  }

  return out.sort((a, b) => a.step - b.step);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/eventAdapt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/eventAdapt.ts src/utils/eventAdapt.test.ts
git commit -m "feat(meter): add event-shaped rhythm adaptation with hold clamping"
```

---

### Task 4: Transport `meterId` state and the persist v4 → v5 migration

**Files:**
- Modify: `src/store/types.ts:19-44` (`TransportSlice`) and `:158-189` (`PersistedState`)
- Modify: `src/store/transportSlice.ts:75-105` (the returned slice object)
- Modify: `src/store/initialState.ts:33-79` (`INITIAL_SEQUENCER_TRACKS` — five tracks padded to 24)
- Modify: `src/store/migrate.ts` (append `migrateMeterAndStepWidth`)
- Modify: `src/store/store.ts:99-132` (`partializeAppState`) and `:280-311` (persist config + `migrate` chain)
- Modify: `CLAUDE.md:32` (the stale "version 3")
- Test: `src/store/migrate.test.ts` (append), `src/store/transportSlice.test.ts` (append)

**Interfaces:**
- Consumes: `MeterId`, `DEFAULT_METER_ID`, `isMeterId`, `MAX_STEPS_PER_BAR` from `src/utils/meter.ts` (Task 1); `padStepRow` from `src/utils/patternAdapt.ts` (Task 2).
- Produces:
  - `TransportSlice.meterId: MeterId` (default `'4/4'`) and `TransportSlice.setMeter: (id: MeterId) => void`
  - `PersistedState.meterId: MeterId`
  - `export function migrateMeterAndStepWidth<T extends object>(state: T): T` in `src/store/migrate.ts`
  - persist `version: 5`

The store's exact current persist config, for reference (`src/store/store.ts:280-311`): `name: PERSIST_KEY`, `version: 4`, `storage: createJSONStorage<PersistedState>(() => resolveStorage() ?? memoryStorage)`, `partialize: partializeAppState`, then a `migrate: (persisted, version) => …` that runs `migrateLegacyPresets` unconditionally, `migrateProjectTitleToVibeId` when `version < 4`, `migrateTrackColors` when `version < 3`, and an `arpActive: false` sweep when `version < 2`. The new step is a `version < 5` guard layered **on top**, i.e. applied last, closest to the return.

- [ ] **Step 1: Write the failing migration test**

Append to `src/store/migrate.test.ts` (keep the existing imports; add `migrateMeterAndStepWidth` to the existing import from `./migrate`, and add a `MAX_STEPS_PER_BAR` import from `../utils/meter`):

```ts
describe('migrateMeterAndStepWidth (v4 -> v5)', () => {
  test('defaults meterId to 4/4 when the payload predates meter support', () => {
    const out = migrateMeterAndStepWidth({ bpm: 96 }) as { meterId: string; bpm: number };
    expect(out.meterId).toBe('4/4');
    expect(out.bpm).toBe(96);
  });

  test('keeps an already-valid meterId', () => {
    const out = migrateMeterAndStepWidth({ meterId: '6/8' }) as { meterId: string };
    expect(out.meterId).toBe('6/8');
  });

  test('replaces an unknown meterId rather than letting it reach the clock', () => {
    const out = migrateMeterAndStepWidth({ meterId: '9/8' }) as { meterId: string };
    expect(out.meterId).toBe('4/4');
    const nonString = migrateMeterAndStepWidth({ meterId: 16 }) as { meterId: string };
    expect(nonString.meterId).toBe('4/4');
  });

  test('pads every 16-length track steps array to MAX_STEPS_PER_BAR with false', () => {
    const sixteen = [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ];
    const out = migrateMeterAndStepWidth({
      sequencerTracks: [{ id: 'track-kick', instrument: 'kick', steps: sixteen }],
    }) as { sequencerTracks: Array<{ steps: boolean[] }> };

    expect(MAX_STEPS_PER_BAR).toBe(24);
    expect(out.sequencerTracks[0].steps.length).toBe(24);
    expect(out.sequencerTracks[0].steps.slice(0, 16)).toEqual(sixteen);
    expect(out.sequencerTracks[0].steps.slice(16).every((v) => v === false)).toBe(true);
  });

  test('leaves an already-24-wide payload byte-identical', () => {
    const wide = Array.from({ length: 24 }, (_, i) => i % 5 === 0);
    const out = migrateMeterAndStepWidth({
      sequencerTracks: [{ id: 'track-kick', steps: wide }],
    }) as { sequencerTracks: Array<{ steps: boolean[] }> };
    expect(out.sequencerTracks[0].steps).toEqual(wide);
  });

  test('survives a corrupt tracks payload without throwing', () => {
    expect(() => migrateMeterAndStepWidth({ sequencerTracks: 'nope' })).not.toThrow();
    expect(() => migrateMeterAndStepWidth({ sequencerTracks: [null, 7, { steps: 'x' }] })).not.toThrow();
    const out = migrateMeterAndStepWidth({
      sequencerTracks: [null, { id: 'a', steps: [true] }],
    }) as { sequencerTracks: unknown[] };
    expect(out.sequencerTracks[0]).toBe(null);
    expect((out.sequencerTracks[1] as { steps: boolean[] }).steps.length).toBe(24);
  });

  test('does not mutate the payload it was given', () => {
    const input = { sequencerTracks: [{ id: 'a', steps: [true, false] }] };
    migrateMeterAndStepWidth(input);
    expect(input.sequencerTracks[0].steps.length).toBe(2);
    expect('meterId' in input).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing slice test**

Append to `src/store/transportSlice.test.ts` (add `useAppStore` from `./store` to the imports if it is not already there):

```ts
describe('transport meter', () => {
  test('defaults to 4/4', () => {
    useAppStore.setState({ meterId: '4/4' });
    expect(useAppStore.getState().meterId).toBe('4/4');
  });

  test('setMeter writes the id straight through', () => {
    useAppStore.getState().setMeter('7/8');
    expect(useAppStore.getState().meterId).toBe('7/8');
    useAppStore.getState().setMeter('4/4');
    expect(useAppStore.getState().meterId).toBe('4/4');
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `bun test src/store/migrate.test.ts src/store/transportSlice.test.ts`
Expected: FAIL — `migrateMeterAndStepWidth is not a function` and `setMeter is not a function`.

- [ ] **Step 4: Add `meterId` to the transport slice type**

In `src/store/types.ts`, inside `interface TransportSlice`, add the field next to `bpm` and the setter next to `setBpm`:

```ts
export interface TransportSlice {
  bpm: number;
  /** Active time signature. `STEPS_PER_BAR` is derived from this, not fixed. */
  meterId: MeterId;
  masterVolume: number;
  // ...unchanged...
  setBpm: (bpm: number) => void;
  setMeter: (id: MeterId) => void;
  // ...unchanged...
}
```

Add the import at the top of `src/store/types.ts`, next to the existing `SynthControlTarget` import:

```ts
import type { MeterId } from '../utils/meter';
```

And add `meterId` to `PersistedState`, immediately after `bpm`:

```ts
export interface PersistedState {
  bpm: number;
  meterId: MeterId;
  masterVolume: number;
  // ...unchanged...
}
```

- [ ] **Step 5: Implement the slice state and setter**

In `src/store/transportSlice.ts`, add the import:

```ts
import { DEFAULT_METER_ID } from '../utils/meter';
```

then in the returned object add the field next to `bpm` and the setter next to `setBpm`:

```ts
  return {
    bpm: 120,
    meterId: DEFAULT_METER_ID,
    masterVolume: 0.85,
```

```ts
    setBpm: (bpm) => set({ bpm: clampBpm(bpm) }),
    // No clamping needed: MeterId is a closed union, and getMeter() falls back
    // to 4/4 for anything that slips through from persisted state.
    setMeter: (meterId) => set({ meterId }),
```

- [ ] **Step 6: Implement the migration helper**

Append to `src/store/migrate.ts` (and add the two imports at the top of the file):

```ts
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { padStepRow } from '../utils/patternAdapt';
```

```ts
/**
 * v4 -> v5: meter support.
 *
 * 1. Sequencer step arrays are now ALWAYS stored at MAX_STEPS_PER_BAR (24), so
 *    switching meter windows the user's programming instead of destroying it.
 *    Legacy 16-length rows are padded with silence.
 * 2. `meterId` defaults to '4/4'. An unknown or wrong-typed value is replaced
 *    rather than preserved — it feeds the clock, and getMeter's own fallback
 *    should never have to fire on a payload we already own.
 *
 * Pure and non-mutating, like its three siblings above.
 */
export function migrateMeterAndStepWidth<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) };

  if (!isMeterId(next.meterId)) next.meterId = DEFAULT_METER_ID;

  const tracks = next.sequencerTracks;
  if (Array.isArray(tracks)) {
    next.sequencerTracks = tracks.map((track) => {
      if (!track || typeof track !== 'object') return track;
      const steps = (track as { steps?: unknown }).steps;
      if (!Array.isArray(steps)) return track;
      return { ...(track as object), steps: padStepRow(steps as boolean[]) };
    });
  }

  return next as unknown as T;
}
```

- [ ] **Step 7: Widen `INITIAL_SEQUENCER_TRACKS` to 24 steps**

In `src/store/initialState.ts`, append eight `false` entries to each of the five `steps` arrays (`track-kick` at `:38`, `track-snare` at `:47`, `track-hihat` at `:56`, `track-openhat` at `:65`, `track-clap` at `:74`). The first sixteen entries must not change. For example the kick row becomes:

```ts
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
```

Apply the same eight-`false` suffix to the other four rows verbatim, leaving their leading sixteen values untouched.

- [ ] **Step 8: Wire the migration and bump the persist version**

In `src/store/store.ts`, add `migrateMeterAndStepWidth` to the existing import block from `./migrate`, add `meterId: state.meterId,` to `partializeAppState` immediately after `bpm: state.bpm,`, bump `version: 4` to `version: 5`, and layer the new step into the `migrate` chain so it runs last:

```ts
      migrate: (persisted, version) => {
        const migrated = migrateLegacyPresets(
          (persisted ?? {}) as Partial<PersistedState>
        ) as PersistedState;
        // v3 → v4: the project concept is gone; the vibe bar's highlight is
        // its own persisted field now.
        const deprojected =
          version >= 4 ? migrated : (migrateProjectTitleToVibeId(migrated) as PersistedState);
        // v2 → v3: raw Tailwind track colours become daisyUI semantic tokens.
        const recoloured =
          version >= 3 ? deprojected : (migrateTrackColors(deprojected) as PersistedState);
        // v4 → v5: step arrays widen to MAX_STEPS_PER_BAR and meterId appears.
        // Runs on EVERY older version, so it is applied after the chain above
        // rather than inside the version >= 2 short-circuit below.
        const metered = (payload: PersistedState): PersistedState =>
          version >= 5 ? payload : (migrateMeterAndStepWidth(payload) as PersistedState);
        if (version >= 2) return metered(recoloured);
        // v1 persisted `arpActive: true` from an arpeggiator that never
        // produced a note, while that same flag gated the keyboard's direct
        // trigger — so those sessions came back with a silent keyboard. Clear
        // the flag once on the way to v2; the arp can be switched back on.
        const next = { ...recoloured } as Record<string, unknown>;
        for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
          const params = next[key];
          if (params && typeof params === 'object' && !Array.isArray(params)) {
            next[key] = { ...(params as object), arpActive: false };
          }
        }
        return metered(next as unknown as PersistedState);
      },
```

Also guard the meter in `sanitizePersistedState` (same file, in the block that drops invalid free-form strings around `:248-253`), so a hand-edited v5 payload cannot inject a bad id:

```ts
  if (!isMeterId(sanitized.meterId)) delete sanitized.meterId;
```

with `import { isMeterId } from '../utils/meter';` added to `src/store/store.ts`.

- [ ] **Step 9: Fix the stale persist version in CLAUDE.md**

In `CLAUDE.md:32`, change `**version 3**` to `**version 5**`. That line currently reads "…with `persist` (key `musibox_project_state_v1`, **version 3**, `partialize` + `migrate` in `store.ts`, legacy-key adoption in `migrate.ts`)…" — it was already stale at 4 before this change.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `bun test src/store/migrate.test.ts src/store/transportSlice.test.ts src/store/store.test.ts`
Expected: PASS. If `store.test.ts` asserts a step-array length of 16 anywhere, update that assertion to 24 — the stored width is now `MAX_STEPS_PER_BAR`.

- [ ] **Step 11: Commit**

```bash
git add src/store/types.ts src/store/transportSlice.ts src/store/initialState.ts src/store/migrate.ts src/store/store.ts src/store/migrate.test.ts src/store/transportSlice.test.ts CLAUDE.md
git commit -m "feat(store): add transport meterId and migrate persisted state to v5"
```

---

### Task 5: `barDurationSec` and `BEATS_PER_BAR` take the meter

**Files:**
- Modify: `src/utils/musicTheory.ts:338-369`
- Modify: `src/utils/playhead.ts:1-75`
- Test: `src/utils/musicTheory.test.ts` (append to the `tempo helpers` describe), `src/utils/playhead.test.ts` (append)

**Interfaces:**
- Consumes: `getMeter`, `METERS` from `src/utils/meter.ts` (Task 1).
- Produces:
  - `function barDurationSec(bpm: number, stepsPerBar?: number): number` — `stepsPerBar` defaults to `STEPS_PER_BAR`
  - `const STEPS_PER_BAR: number` — unchanged value 16, now *defined as* `METERS['4/4'].stepsPerBar` and documented as the 4/4 default only
  - `const BEATS_PER_BAR = 4` — unchanged value, now documented as the 4/4 default
  - `interface BeatCounterInput` gains an optional `beatsPerBar?: number`
  - `function resolveBeatCounter(input: BeatCounterInput): BeatCounter` — uses `input.beatsPerBar ?? BEATS_PER_BAR`
  - `function beatsPerBarFor(meterId: string): number` exported from `src/utils/playhead.ts` — `getMeter(meterId).accentGroups.length`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('tempo helpers', …)` block in `src/utils/musicTheory.test.ts`:

```ts
  test('barDurationSec still defaults to a 16-step bar', () => {
    expect(barDurationSec(120)).toBeCloseTo(barDurationSec(120, 16), 12);
  });

  test('barDurationSec scales with the bar length it is given', () => {
    expect(barDurationSec(120, 12)).toBeCloseTo(stepDurationSec(120) * 12, 12);
    expect(barDurationSec(120, 24)).toBeCloseTo(stepDurationSec(120) * 24, 12);
    expect(barDurationSec(120, 14)).toBeCloseTo(stepDurationSec(120) * 14, 12);
  });
```

Append to `src/utils/playhead.test.ts` (add `beatsPerBarFor` to the existing import from `./playhead`):

```ts
describe('beatsPerBarFor', () => {
  test('4/4 keeps the historical four beats per bar', () => {
    expect(beatsPerBarFor('4/4')).toBe(BEATS_PER_BAR);
    expect(beatsPerBarFor('4/4')).toBe(4);
  });

  test('counts accent groups, so 3/4 and 6/8 differ despite equal bar length', () => {
    expect(beatsPerBarFor('3/4')).toBe(3);
    expect(beatsPerBarFor('6/8')).toBe(2);
    expect(beatsPerBarFor('12/8')).toBe(4);
    expect(beatsPerBarFor('5/4')).toBe(5);
    expect(beatsPerBarFor('7/8')).toBe(3);
  });

  test('an unknown id falls back to four', () => {
    expect(beatsPerBarFor('9/8')).toBe(4);
  });
});

describe('resolveBeatCounter with an explicit beatsPerBar', () => {
  test('omitting it preserves the historical four-beat bar exactly', () => {
    expect(resolveBeatCounter({ playheadBeat: 6, chordStartBeat: 0, bars: 2 })).toEqual(
      resolveBeatCounter({ playheadBeat: 6, chordStartBeat: 0, bars: 2, beatsPerBar: 4 }),
    );
  });

  test('a 6/8 chord counts two beats per bar', () => {
    expect(
      resolveBeatCounter({ playheadBeat: 3, chordStartBeat: 0, bars: 2, beatsPerBar: 2 }),
    ).toEqual({ totalBeats: 4, activeBeat: 3 });
  });

  test('a 5/4 chord counts five beats per bar and still wraps', () => {
    expect(
      resolveBeatCounter({ playheadBeat: 7, chordStartBeat: 0, bars: 1, beatsPerBar: 5 }),
    ).toEqual({ totalBeats: 5, activeBeat: 2 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/utils/musicTheory.test.ts src/utils/playhead.test.ts`
Expected: FAIL — `beatsPerBarFor is not exported`, and `barDurationSec(120, 12)` returns the 16-step duration because the second argument is ignored.

- [ ] **Step 3: Implement the `musicTheory.ts` change**

Add the import at the top of `src/utils/musicTheory.ts`:

```ts
import { METERS } from './meter';
```

Replace the `STEPS_PER_BAR` declaration and `barDurationSec` (`src/utils/musicTheory.ts:339-369`) with:

```ts
/**
 * The 4/4 bar length, in 16th steps.
 *
 * This is now only a DEFAULT: the live bar length comes from the transport's
 * meter (`getMeter(meterId).stepsPerBar`). It stays exported and stays 16 so
 * the functions that already accept `stepsPerBar` as a defaulted parameter keep
 * their historical behaviour when a caller has no meter to hand — and so
 * engine.ts's and playbackEngine.ts's re-exports keep resolving.
 *
 * Declared here rather than in audio/engine.ts so barDurationSec can use it
 * without a cycle; utils/meter.ts imports nothing, so this import is safe.
 */
export const STEPS_PER_BAR = METERS['4/4'].stepsPerBar;
```

```ts
/** One bar, in seconds. `stepsPerBar` defaults to the 4/4 bar. */
export function barDurationSec(bpm: number, stepsPerBar: number = STEPS_PER_BAR): number {
  return stepDurationSec(bpm) * stepsPerBar;
}
```

Leave `MIN_BPM`, `MAX_BPM`, `clampBpm` and `stepDurationSec` untouched.

- [ ] **Step 4: Implement the `playhead.ts` change**

In `src/utils/playhead.ts`, add the import and replace the constant's comment, then thread `beatsPerBar` through:

```ts
import type { ChordItem } from '../types';
import { getMeter } from './meter';

/**
 * Beats in a 4/4 bar. Only a DEFAULT — the live count is the active meter's
 * `accentGroups.length`, which is what `beatsPerBarFor` returns.
 */
export const BEATS_PER_BAR = 4;

/** Beats per bar for a meter id. 3/4 -> 3, 6/8 -> 2, 7/8 -> 3. */
export function beatsPerBarFor(meterId: string): number {
  return getMeter(meterId).accentGroups.length;
}
```

Add the optional field to `BeatCounterInput`:

```ts
export interface BeatCounterInput {
  /** Absolute beat index since the transport started; null while stopped. */
  playheadBeat: number | null;
  /** Absolute beat index the current chord was triggered on. */
  chordStartBeat: number;
  /** Bars the current chord spans. */
  bars: number;
  /** Beats in one bar; defaults to the 4/4 count. */
  beatsPerBar?: number;
}
```

and use it in `resolveBeatCounter`:

```ts
export function resolveBeatCounter({
  playheadBeat,
  chordStartBeat,
  bars,
  beatsPerBar = BEATS_PER_BAR,
}: BeatCounterInput): BeatCounter {
  const totalBeats = Math.max(1, bars || 1) * beatsPerBar;
```

The rest of `resolveBeatCounter` and all of `groupBeats` are unchanged — `groupBeats(totalBeats, barLength = BEATS_PER_BAR)` already takes its bar length as a parameter.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/utils/musicTheory.test.ts src/utils/playhead.test.ts`
Expected: PASS, including the pre-existing `STEPS_PER_BAR is 16` and `barDurationSec is one 16-step bar` assertions.

- [ ] **Step 6: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/playhead.ts src/utils/musicTheory.test.ts src/utils/playhead.test.ts
git commit -m "feat(meter): make bar duration and beats-per-bar meter-driven"
```

---

### Task 6: Engine derives `stepInBar`; metronome, beat dispatch and arp re-phase

**Files:**
- Modify: `src/audio/engine.ts:1-2` (imports), `:141-150` (clock fields), `:251-280` (`clockTick`), `:1495-1498` (re-export block)
- Modify: `src/audio/arpSchedule.ts:21-35` (doc only — the signature does not change)
- Modify: `src/audio/playback/arpPlayback.ts:33-52`
- Modify: `src/audio/playback/chordPlayback.ts:171-196` (`arpEventsForStep`)
- Test: `src/audio/clock.test.ts` (append)

**Interfaces:**
- Consumes: `Meter`, `getMeter`, `beatIndexAt`, `isBeatBoundary`, `arpStepFor`, `DEFAULT_METER_ID` from `src/utils/meter.ts` (Task 1); `STEPS_PER_BAR` from `src/utils/musicTheory.ts` (Task 5).
- Produces:
  - `audioEngine.setMeter(meter: Meter): void`
  - `audioEngine.getMeter(): Meter`
  - `arpEventsForStep(notes: string[], params: SynthParams, step: number, stepDur: number, holdScale: number, stepsPerBar?: number): StepEvent[]` — the new sixth parameter defaults to `STEPS_PER_BAR`

The clock's listener signature `(step: number, beat: number, time: number) => void` is **unchanged**: `step` stays the absolute monotonic 16th counter (bar-line detection depends on it), and `beat` stays an absolute beat counter — it is only its *derivation* that becomes meter-aware.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/clock.test.ts`, reusing the file's existing `clockEngine()` harness and `afterEach` teardown. Add `getMeter` to the imports from `../utils/meter`:

```ts
describe('meter-aware clock', () => {
  test('4/4 metronome and beat dispatch are unchanged', () => {
    const { engine, ctx, tick } = clockEngine();
    const clicks: Array<{ step: number; downbeat: boolean }> = [];
    const beats: number[] = [];
    let dispatched = 0;
    (engine as any).playMetronomeClick = (isDownbeat: boolean) => {
      clicks.push({ step: dispatched, downbeat: isDownbeat });
    };
    engine.setMeter(getMeter('4/4'));
    engine.setMetronomeEnabled(true);
    engine.subscribeClock((step, beat) => {
      dispatched = step;
      beats[step] = beat;
    });

    for (let i = 0; i < 120; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    // Historical behaviour: a click every 4 steps, accented every 16.
    for (const c of clicks) {
      expect(c.step % 4).toBe(0);
      expect(c.downbeat).toBe(c.step % 16 === 0);
    }
    // Historical behaviour: beat === Math.floor(step / 4).
    beats.forEach((beat, step) => expect(beat).toBe(Math.floor(step / 4)));
  });

  test('7/8 clicks on the 3+2+2 grouping and accents only the downbeat', () => {
    const { engine, ctx, tick } = clockEngine();
    const clicks: Array<{ step: number; downbeat: boolean }> = [];
    let dispatched = 0;
    (engine as any).playMetronomeClick = (isDownbeat: boolean) => {
      clicks.push({ step: dispatched, downbeat: isDownbeat });
    };
    engine.setMeter(getMeter('7/8'));
    engine.setMetronomeEnabled(true);
    engine.subscribeClock((step) => {
      dispatched = step;
    });

    for (let i = 0; i < 160; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    expect(clicks.length).toBeGreaterThan(6);
    for (const c of clicks) {
      const stepInBar = c.step % 14;
      expect([0, 6, 10]).toContain(stepInBar);
      expect(c.downbeat).toBe(stepInBar === 0);
    }
  });

  test('7/8 downbeats never drift: bar N starts at exactly 14N steps', () => {
    const { engine, ctx, tick } = clockEngine();
    const downbeatSteps: number[] = [];
    let dispatched = 0;
    (engine as any).playMetronomeClick = (isDownbeat: boolean) => {
      if (isDownbeat) downbeatSteps.push(dispatched);
    };
    engine.setMeter(getMeter('7/8'));
    engine.setMetronomeEnabled(true);
    engine.subscribeClock((step) => {
      dispatched = step;
    });

    for (let i = 0; i < 200; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    expect(downbeatSteps.length).toBeGreaterThan(3);
    for (let i = 1; i < downbeatSteps.length; i++) {
      expect(downbeatSteps[i] - downbeatSteps[i - 1]).toBe(14);
    }
  });

  test('6/8 dispatches two beats per twelve-step bar', () => {
    const { engine, ctx, tick } = clockEngine();
    const beats: number[] = [];
    engine.setMeter(getMeter('6/8'));
    engine.subscribeClock((step, beat) => {
      beats[step] = beat;
    });

    for (let i = 0; i < 120; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    beats.forEach((beat, step) => {
      const bar = Math.floor(step / 12);
      const stepInBar = step % 12;
      expect(beat).toBe(bar * 2 + (stepInBar < 6 ? 0 : 1));
    });
  });

  test('the meter defaults to 4/4 before anything sets one', () => {
    const { engine } = clockEngine();
    expect(engine.getMeter().id).toBe('4/4');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/clock.test.ts`
Expected: FAIL — `engine.setMeter is not a function`.

- [ ] **Step 3: Implement the engine changes**

In `src/audio/engine.ts`, extend the existing first import line and add the meter import:

```ts
import { noteFrequency, clampBpm, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import {
  beatIndexAt,
  getMeter,
  isBeatBoundary,
  DEFAULT_METER_ID,
  type Meter,
} from '../utils/meter';
```

Add a field next to the other clock fields (after `clockStepIndex` at `:145`):

```ts
  // Active time signature. The clock itself stays a monotonic 16th counter —
  // only BAR-RELATIVE logic (the metronome, the dispatched beat index) reads
  // this. Set through store/engineSync.ts, never from a component.
  private meter: Meter = getMeter(DEFAULT_METER_ID);
```

Add the accessors next to `setClockBpm` (`:221-223`):

```ts
  setMeter(meter: Meter): void {
    this.meter = meter;
  }

  getMeter(): Meter {
    return this.meter;
  }
```

Replace the metronome and dispatch block inside `clockTick` (`src/audio/engine.ts:268-279`) with:

```ts
      // THE MONOTONIC-COUNTER TRAP: clockStepIndex never resets, so every
      // bar-relative decision must be derived here rather than taken from the
      // absolute step. In 4/4 (stepsPerBar 16, accentGroups [4,4,4,4]) this
      // reduces to exactly the old `step % 4 === 0` / `step % 16 === 0` /
      // `Math.floor(step / 4)` arithmetic — output is byte-identical.
      const stepsPerBar = this.meter.stepsPerBar;
      const barIndex = Math.floor(step / stepsPerBar);
      const stepInBar = step - barIndex * stepsPerBar;
      const beat = barIndex * this.meter.accentGroups.length + beatIndexAt(stepInBar, this.meter.accentGroups);

      if (this.metronomeEnabled && isBeatBoundary(stepInBar, this.meter.accentGroups)) {
        this.playMetronomeClick(stepInBar === 0, time);
      }
      // One listener's failure is isolated: every other subscriber still gets
      // this step. Logged rather than swallowed so the fault is findable.
      this.clockListeners.forEach((fn) => {
        try {
          fn(step, beat, time);
        } catch (err) {
          console.error('[audioEngine] clock listener threw; continuing', err);
        }
      });
```

`STEPS_PER_BAR` stays imported and re-exported at `src/audio/engine.ts:1498` — that re-export is what every `import { STEPS_PER_BAR } from '../engine'` resolves against, and it is still the 4/4 default value used for defaulted parameters. Do not delete it.

- [ ] **Step 4: Re-phase the two arpeggiator call sites**

`src/audio/arpSchedule.ts` keeps its signature; only its doc comment gains a line above `computeArpTriggers`:

```ts
/**
 * `step` must already be BAR-PHASED by `arpStepFor` (utils/meter.ts) at the
 * call site. Passing the raw monotonic clock step makes the arp phase drift
 * across bar lines in any meter whose bar is not a multiple of four steps.
 */
```

In `src/audio/playback/arpPlayback.ts`, add the import and phase the step (the keyboard arp reads the meter off the engine it is already subscribed to — `arpPlayback.ts` is in `audio/`, so this is not a layering violation):

```ts
import { arpStepFor } from '../../utils/meter';
```

```ts
      const stepDur16 = stepDurationSec(bpm);
      const arpStep = arpStepFor(step, audioEngine.getMeter().stepsPerBar);
      for (const t of computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur16)) {
```

In `src/audio/playback/chordPlayback.ts`, add the import and give `arpEventsForStep` the new defaulted parameter:

```ts
import { arpStepFor } from "../../utils/meter";
```

```ts
/**
 * The arpeggiator's take on a chord: instead of the rhythm pattern's hits,
 * `notes` are expanded by arpMode/arpOctaves and walked one note per trigger.
 * `step` is the ABSOLUTE clock step so the arp keeps its stride across bar and
 * chord boundaries rather than restarting on every chord — but it is bar-phased
 * through `arpStepFor` first, which is the identity in 4/4 and stops the arp
 * from sliding against the bar line in an odd meter.
 */
export function arpEventsForStep(
  notes: string[],
  params: SynthParams,
  step: number,
  stepDur: number,
  holdScale: number,
  stepsPerBar: number = STEPS_PER_BAR,
): StepEvent[] {
```

and inside its body replace the `computeArpTriggers(step, …)` call at `:185` with:

```ts
  return computeArpTriggers(arpStepFor(step, stepsPerBar), sequence.length, params.arpRate, stepDur).map(
```

Leave the rest of the function, including the `buildArpSequence(...)` call above it, untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/audio/clock.test.ts src/audio/playback/arpPlayback.test.ts src/audio/playback/chordPlayback.test.ts src/audio/arpeggiator.test.ts`
Expected: PASS, including the pre-existing "the metronome downbeat lands on STEPS_PER_BAR" test.

- [ ] **Step 6: Commit**

```bash
git add src/audio/engine.ts src/audio/arpSchedule.ts src/audio/playback/arpPlayback.ts src/audio/playback/chordPlayback.ts src/audio/clock.test.ts
git commit -m "feat(audio): derive stepInBar from the meter for metronome, beat and arp"
```

---

### Task 7: The store → engine meter subscription

**Files:**
- Modify: `src/store/engineSync.ts:1-6` (imports), `:24-39` (`applySliceState`), `:47-50` (the transport-slice subscription block)
- Test: `src/store/engineSync.test.ts` (append)

**Interfaces:**
- Consumes: `meterId` from `TransportSlice` (Task 4); `audioEngine.setMeter` / `audioEngine.getMeter` (Task 6); `getMeter` from `src/utils/meter.ts` (Task 1).
- Produces: nothing new for later tasks — this is the one and only path meter takes into the engine. Components must never call `audioEngine.setMeter`.

Template being copied — the existing `bpm` subscription at `src/store/engineSync.ts:48`:

```ts
subs.push(useAppStore.subscribe((s) => s.bpm, (bpm) => audioEngine.setClockBpm(bpm), { fireImmediately: true }));
```

- [ ] **Step 1: Write the failing test**

Append to `src/store/engineSync.test.ts` (add `getMeter` to a new import from `../utils/meter`):

```ts
describe('engineSync meter bridge', () => {
  test('fireImmediately pushes the current meter into the engine at startup', () => {
    useAppStore.setState({ meterId: '4/4' });
    const setMeter = spyOn(audioEngine, 'setMeter').mockClear();
    startEngineSync();
    expect(setMeter).toHaveBeenCalledWith(getMeter('4/4'));
  });

  test('a meter change flows one-way into the engine; teardown stops it', () => {
    const setMeter = spyOn(audioEngine, 'setMeter').mockClear();
    startEngineSync();
    useAppStore.getState().setMeter('6/8');
    expect(setMeter).toHaveBeenLastCalledWith(getMeter('6/8'));
    expect(setMeter).toHaveBeenLastCalledWith(
      expect.objectContaining({ stepsPerBar: 12, accentGroups: [6, 6] }),
    );

    stopEngineSync();
    setMeter.mockClear();
    useAppStore.getState().setMeter('3/4');
    expect(setMeter).not.toHaveBeenCalled();
    useAppStore.getState().setMeter('4/4');
  });

  test('applyEngineSnapshot re-applies the meter after the AudioContext exists', () => {
    useAppStore.setState({ meterId: '5/4' });
    const setMeter = spyOn(audioEngine, 'setMeter').mockClear();
    applyEngineSnapshot();
    expect(setMeter).toHaveBeenCalledWith(getMeter('5/4'));
    useAppStore.setState({ meterId: '4/4' });
  });
});
```

Add `applyEngineSnapshot` to the existing `./engineSync` import at the top of the file if it is not already imported.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/engineSync.test.ts`
Expected: FAIL — `setMeter` is never called (no subscription exists yet).

- [ ] **Step 3: Implement the subscription**

In `src/store/engineSync.ts`, add the import:

```ts
import { getMeter } from '../utils/meter';
```

Add a line to `applySliceState()` immediately after the `setClockBpm` line:

```ts
  audioEngine.setClockBpm(s.bpm);
  audioEngine.setMeter(getMeter(s.meterId));
```

And add the subscription to the transport-slice block, immediately after the `bpm` subscription:

```ts
  // transport slice
  subs.push(useAppStore.subscribe((s) => s.bpm, (bpm) => audioEngine.setClockBpm(bpm), { fireImmediately: true }));
  // Meter reaches the engine HERE and nowhere else: the metronome and the
  // dispatched beat index are bar-relative, and layering rule 3 forbids a
  // component calling an engine setter. Subscribed on the id (a primitive), so
  // the subscription fires only on a real change.
  subs.push(useAppStore.subscribe((s) => s.meterId, (id) => audioEngine.setMeter(getMeter(id)), { fireImmediately: true }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/engineSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "feat(store): bridge the transport meter into the engine via engineSync"
```

---

### Task 8: Thread the real `stepsPerBar` into the playback call sites

**Files:**
- Modify: `src/components/useSequencerPlayback.ts:1-12` (imports), `:118-137` (the clock callback)
- Modify: `src/components/chord/useChordPlayback.ts:126-133`, `:204-233`, `:296-330`, `:332-372`, `:483-525`
- Test: `src/components/useSequencerPlayback.test.ts` (append), `src/components/chord/useChordPlayback.test.ts` if present — otherwise the sequencer file alone

**Interfaces:**
- Consumes: `getMeter` from `src/utils/meter.ts` (Task 1); `meterId` from the store (Task 4); `arpEventsForStep`'s new sixth parameter (Task 6); `barDurationSec`'s new second parameter (Task 5).
- Produces:
  - `export function activeStepsPerBar(): number` from `src/components/chord/useChordPlayback.ts` — `getMeter(useAppStore.getState().meterId).stepsPerBar`, read LIVE at call time for the same reason `chordStepAction`'s doc gives for reading player state live.

Signatures being fed (all verified, all already accept the parameter and merely default it):

```ts
// src/components/playerStop.ts
export function isSoftStopBoundary(state: PlayerState, step: number, stepsPerBar: number): boolean
export function armOnBarLine(arming: { armed: boolean }, step: number, stepsPerBar: number): boolean

// src/components/useSequencerPlayback.ts:31
export function sequencerStepAction(state: PlayerState, step: number, arming: SequencerArming, stepsPerBar: number = STEPS_PER_BAR): SequencerStepAction

// src/components/chord/useChordPlayback.ts:247
export function chordStepAction(state: PlayerState, step: number, arming: ChordArming, stepsPerBar: number = STEPS_PER_BAR): ChordStepAction

// src/audio/playback/chordPlayback.ts:120
export function scheduleWholeChord(events: BarInvariantEvent[], params: SynthParams, source: string, startTime: number, stepDur: number, totalBars: number, stepsPerBar: number = STEPS_PER_BAR): void

// src/audio/playback/chordPlayback.ts:147
export function chordPlanPosition(plan: { startStep: number; totalBars: number }, step: number, stepsPerBar: number = STEPS_PER_BAR): { stepInBar: number; isLastBar: boolean; stepsRemaining: number } | null
```

`playerStop.ts` needs **no change**: both of its functions already take `stepsPerBar` as a required parameter.

- [ ] **Step 1: Write the failing test**

Append to `src/components/useSequencerPlayback.test.ts` (the file already declares `const BAR = 16;` at `:7` — keep it and add a second constant):

```ts
const WALTZ_BAR = 12;

describe('sequencer stepper in a non-4/4 meter', () => {
  test('arms on a 12-step bar line, not a 16-step one', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 16, arming, WALTZ_BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
    expect(sequencerStepAction('playing', 24, arming, WALTZ_BAR)).toBe('play');
  });

  test('soft-stops on a 12-step bar line', () => {
    const arming: SequencerArming = { armed: true };
    expect(sequencerStepAction('stopping', 16, arming, WALTZ_BAR)).toBe('play');
    expect(sequencerStepAction('stopping', 24, arming, WALTZ_BAR)).toBe('soft-stop');
  });

  test('an odd 14-step bar still lands every bar line exactly', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 13, arming, 14)).toBe('idle');
    expect(sequencerStepAction('playing', 14, arming, 14)).toBe('play');
    expect(sequencerStepAction('playing', 28, arming, 14)).toBe('play');
  });

  test('the default parameter still means a 16-step bar', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 8, arming)).toBe('idle');
    expect(sequencerStepAction('playing', BAR, arming)).toBe('play');
  });
});
```

- [ ] **Step 2: Run the new test — it is a guard, not a red-first driver**

Run: `bun test src/components/useSequencerPlayback.test.ts`
Expected: PASS on all four cases. `sequencerStepAction` already accepts `stepsPerBar`, so there is no pure-logic seam that can go red here — the defect is at the *call site*, which passes nothing. This test exists to prove the parameter plumbing through `playerStop.ts` is sound before Step 3 starts relying on it; if any case fails, fix `playerStop.ts` before continuing.

- [ ] **Step 3: Fix the hardcoded site in `useSequencerPlayback.ts`**

`src/components/useSequencerPlayback.ts:134` computes `step % STEPS_PER_BAR` from the module constant even though the sibling function already accepts a parameter — this is the real bug site in that file. Add the import:

```ts
import { getMeter } from "../utils/meter";
```

and replace the clock callback body (`:118-137`) with:

```ts
    return subscribePlaybackClock((step, _beat, time) => {
      // Read the meter LIVE, for the same reason the player state is read live
      // below: one clockTick dispatches several steps synchronously and the
      // subscription outlives a React commit, so a captured bar length can be
      // one meter behind.
      const stepsPerBar = getMeter(useAppStore.getState().meterId).stepsPerBar;
      const action = sequencerStepAction(
        useAppStore.getState().sequencerPlayer,
        step,
        armingRef.current,
        stepsPerBar,
      );
      if (action === "idle") return;
      // Soft stop: the Beat player owns no sustained voices — drums are
      // fire-and-forget one-shots — so stopping means stopping the schedule.
      // At most one already-scheduled hit can still sound, no later than
      // CLOCK_LOOKAHEAD (0.1s) after the press. Accepted; see the spec.
      if (action === "soft-stop") {
        hardStop('sequencer');
        return;
      }

      const stepInLoop = step % stepsPerBar;
      setCurrentStep(stepInLoop);
      playStepSounds(stepInLoop, time);
    });
```

`STEPS_PER_BAR` is no longer referenced in this file — remove it from the `../audio/playback/playbackEngine` import block at `:5-10`.

- [ ] **Step 4: Thread `stepsPerBar` through `useChordPlayback.ts`**

Add the import and the live-read helper near the top of `src/components/chord/useChordPlayback.ts` (just below `resetChordArming`):

```ts
import { getMeter } from "../../utils/meter";
```

```ts
/**
 * The active bar length in 16th steps, read LIVE from the store.
 *
 * Exported so the pure-logic tests can reason about it without React, and used
 * everywhere the module previously leaned on the STEPS_PER_BAR default. Live,
 * not captured: the clock subscription outlives a React commit and one
 * clockTick dispatches several steps synchronously.
 */
export function activeStepsPerBar(): number {
  return getMeter(useAppStore.getState().meterId).stepsPerBar;
}
```

Then apply it at each site:

`startChordPlan` (`:132`):

```ts
  const stepsPerBar = activeStepsPerBar();
  const barDur = barDurationSec(s.bpm, stepsPerBar);
```

`emitChordPlanStep` (`:204-233`) — pass the bar length to both arp branches:

```ts
function emitChordPlanStep(
  plan: ChordPlan,
  pos: { stepInBar: number; isLastBar: boolean; stepsRemaining: number },
  step: number,
  time: number,
): void {
  const s = useAppStore.getState();
  const stepDur = stepDurationSec(s.bpm);
  const stepsPerBar = getMeter(s.meterId).stepsPerBar;
  const chordEnd = time + pos.stepsRemaining * stepDur;

  emitStepEvents(
    plan.chordArp
      ? arpEventsForStep(plan.chordNotes, s.chordSynthParams, step, stepDur, feelToHoldScale(s.chordFeel), stepsPerBar)
      : eventsForStep(plan.chordEvents, pos.stepInBar, pos.isLastBar),
    s.chordSynthParams,
    "chord",
    time,
    chordEnd,
  );

  emitStepEvents(
    plan.bassArp
      ? arpEventsForStep(plan.bassNotes, s.bassSynthParams, step, stepDur, feelToHoldScale(s.bassFeel), stepsPerBar)
      : eventsForStep(plan.bassEvents, pos.stepInBar, pos.isLastBar),
    s.bassSynthParams,
    "bass",
    time,
    chordEnd,
  );
}
```

`playChordWithRhythm` (`:310` and `:320-327`):

```ts
      if (isFullHoldRhythm(pattern)) {
        const barDur = barDurationSec(bpm, activeStepsPerBar());
```

```ts
      scheduleWholeChord(
        buildChordEvents(pattern, notes, stepDur, holdScale),
        chordSynthParams,
        "chord",
        startTime,
        stepDur,
        totalBars,
        activeStepsPerBar(),
      );
```

`playBassWithPattern` (`:357`):

```ts
      if (isFullHoldBass(pattern)) {
        const barDur = barDurationSec(bpm, activeStepsPerBar());
```

The clock subscription (`:483-525`) — three sites:

```ts
    return subscribePlaybackClock((step, beat, time) => {
      const arming = armingRef.current;
      // Live store read, not a ref: see chordStepAction's doc comment.
      const playerState = useAppStore.getState().chordsPlayer;
      const stepsPerBar = activeStepsPerBar();
      const action = chordStepAction(playerState, step, arming, stepsPerBar);
```

```ts
        arming.nextBarStep = step + (chord.bars || 1) * stepsPerBar;
```

```ts
      const pos = chordPlanPosition(plan, step, stepsPerBar);
```

`STEPS_PER_BAR` is no longer referenced in this file — remove it from the `../../audio/playback/playbackEngine` import block at `:30-36`.

- [ ] **Step 5: Type-check and run the tests**

Run: `bun run lint`
Expected: no errors (this catches any leftover `STEPS_PER_BAR` reference removed from an import).

Run: `bun test src/components/useSequencerPlayback.test.ts src/components/playerStop.test.ts src/audio/playback/chordPlayback.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/useSequencerPlayback.ts src/components/chord/useChordPlayback.ts src/components/useSequencerPlayback.test.ts
git commit -m "fix(playback): use the active bar length instead of the STEPS_PER_BAR default"
```

---

### Task 9: Sequencer state windowing — store 24, play and edit the first `stepsPerBar`

**Files:**
- Modify: `src/utils/patternAdapt.ts` (add `rotateStepWindow` and `writeStepWindow`)
- Modify: `src/utils/patternAdapt.test.ts` (append)
- Modify: `src/components/SequencerView.tsx:73-105` (`clearAllSteps`, `randomizeSteps`, `shiftSteps`)
- Modify: `src/store/sequencerSlice.ts:21-29` (`applyDrumPattern` writes into the window and preserves the padding)

**Interfaces:**
- Consumes: `MAX_STEPS_PER_BAR` from `src/utils/meter.ts` (Task 1); `adaptStepRow`, `padStepRow` from `src/utils/patternAdapt.ts` (Task 2).
- Produces:
  - `function writeStepWindow(steps: readonly boolean[], stepsPerBar: number, next: readonly boolean[]): boolean[]` — replaces the first `stepsPerBar` entries with `next` (itself windowed/padded to that length) and preserves everything from `stepsPerBar` up to `MAX_STEPS_PER_BAR`
  - `function rotateStepWindow(steps: readonly boolean[], stepsPerBar: number, direction: 'left' | 'right'): boolean[]` — rotates ONLY the visible window; the padding beyond it never moves

`shiftSteps` at `src/components/SequencerView.tsx:91-104` currently rotates the whole `steps` array with `pop()/unshift()` and `shift()/push()`. With arrays stored at 24 that rotates padding into view, so it must become `rotateStepWindow`.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/patternAdapt.test.ts` (add `rotateStepWindow` and `writeStepWindow` to the existing import):

```ts
const WIDE_16_IN_24 = [
  true, false, false, false, true, false, false, false,
  true, false, false, false, true, false, false, false,
  false, false, false, false, false, false, false, false,
];

describe('rotateStepWindow', () => {
  test('rotating right in a 16-step window moves step 15 to step 0 and leaves padding alone', () => {
    const source = [...WIDE_16_IN_24];
    source[15] = true;
    const out = rotateStepWindow(source, 16, 'right');
    expect(out.length).toBe(24);
    expect(out[0]).toBe(true);
    expect(out[1]).toBe(true); // old step 0
    expect(out.slice(16)).toEqual(source.slice(16));
  });

  test('rotating left in a 16-step window moves step 0 to step 15', () => {
    const out = rotateStepWindow(WIDE_16_IN_24, 16, 'left');
    expect(out[15]).toBe(true);
    expect(out[3]).toBe(true); // old step 4
    expect(out.slice(16).every((v) => v === false)).toBe(true);
  });

  test('THE BUG THIS FIXES: padding is never rotated into view', () => {
    // Mark the padding so a whole-array rotation would be visible.
    const marked = [...WIDE_16_IN_24];
    marked[23] = true;
    const out = rotateStepWindow(marked, 16, 'right');
    expect(out[0]).toBe(false); // NOT the padding cell that a naive pop()/unshift() would bring in
    expect(out[23]).toBe(true); // padding stayed exactly where it was
  });

  test('a 12-step window rotates only the first twelve cells', () => {
    const source = Array.from({ length: 24 }, (_, i) => i === 11 || i === 20);
    const out = rotateStepWindow(source, 12, 'right');
    expect(out[0]).toBe(true);
    expect(out[11]).toBe(false);
    expect(out[20]).toBe(true);
  });

  test('a one-cell window is its own rotation', () => {
    const source = Array.from({ length: 24 }, (_, i) => i === 0);
    expect(rotateStepWindow(source, 1, 'right')).toEqual(source);
    expect(rotateStepWindow(source, 1, 'left')).toEqual(source);
  });

  test('returns a fresh array', () => {
    const source = [...WIDE_16_IN_24];
    const out = rotateStepWindow(source, 16, 'left');
    expect(out).not.toBe(source);
    expect(source[15]).toBe(false);
  });
});

describe('writeStepWindow', () => {
  test('overwrites the window and preserves everything past it', () => {
    const source = Array.from({ length: 24 }, (_, i) => i >= 16);
    const out = writeStepWindow(source, 12, [true, true, true, true, true, true, true, true, true, true, true, true]);
    expect(out.length).toBe(24);
    expect(out.slice(0, 12).every((v) => v === true)).toBe(true);
    expect(out.slice(12, 16).every((v) => v === false)).toBe(true);
    expect(out.slice(16).every((v) => v === true)).toBe(true);
  });

  test('a short replacement is padded with silence rather than leaking old hits', () => {
    const source = Array.from({ length: 24 }, () => true);
    const out = writeStepWindow(source, 16, [true, false]);
    expect(out.slice(0, 2)).toEqual([true, false]);
    expect(out.slice(2, 16).every((v) => v === false)).toBe(true);
    expect(out.slice(16).every((v) => v === true)).toBe(true);
  });

  test('a long replacement is truncated to the window', () => {
    const source = Array.from({ length: 24 }, () => false);
    const out = writeStepWindow(source, 4, [true, true, true, true, true, true]);
    expect(out.slice(0, 4).every((v) => v === true)).toBe(true);
    expect(out[4]).toBe(false);
  });

  test('always returns a MAX_STEPS_PER_BAR-wide array even from a short source', () => {
    expect(writeStepWindow([true], 16, [true, true]).length).toBe(MAX_STEPS_PER_BAR);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/patternAdapt.test.ts`
Expected: FAIL — `rotateStepWindow is not a function`.

- [ ] **Step 3: Implement the two window helpers**

Append to `src/utils/patternAdapt.ts`:

```ts
/**
 * Sequencer rows are ALWAYS stored at MAX_STEPS_PER_BAR; only the first
 * `stepsPerBar` cells are played and drawn. Everything past the window is the
 * user's programming for a wider meter and must survive untouched — that is
 * what makes switching meter non-destructive.
 */
export function writeStepWindow(
  steps: readonly boolean[],
  stepsPerBar: number,
  next: readonly boolean[],
): boolean[] {
  const out = padStepRow(steps);
  const width = Math.min(Math.max(0, stepsPerBar), MAX_STEPS_PER_BAR);
  for (let i = 0; i < width; i++) out[i] = next[i] === true;
  return out;
}

/**
 * Rotate ONLY the visible window by one step. Rotating the whole stored array
 * (the historical `pop()/unshift()`) would carry padding cells into view the
 * moment rows became wider than the bar.
 */
export function rotateStepWindow(
  steps: readonly boolean[],
  stepsPerBar: number,
  direction: 'left' | 'right',
): boolean[] {
  const out = padStepRow(steps);
  const width = Math.min(Math.max(0, stepsPerBar), MAX_STEPS_PER_BAR);
  if (width < 2) return out;
  const window = out.slice(0, width);
  if (direction === 'right') {
    window.unshift(window.pop()!);
  } else {
    window.push(window.shift()!);
  }
  for (let i = 0; i < width; i++) out[i] = window[i];
  return out;
}
```

- [ ] **Step 4: Run the util test to verify it passes**

Run: `bun test src/utils/patternAdapt.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helpers in `SequencerView.tsx`**

Add the imports:

```ts
import { getMeter } from "../utils/meter";
import { rotateStepWindow, writeStepWindow } from "../utils/patternAdapt";
```

Read the meter alongside the other store selectors (next to `const tracks = useAppStore((s) => s.sequencerTracks);`):

```ts
  const meter = getMeter(useAppStore((s) => s.meterId));
  const stepsPerBar = meter.stepsPerBar;
```

Replace `clearAllSteps`, `randomizeSteps` and `shiftSteps` (`:73-105`) with:

```ts
  // Clear/randomize/shift all act on the VISIBLE window only. The cells past it
  // are this row's programming for a wider meter; destroying them would make a
  // meter switch lossy, which is exactly what windowing exists to prevent.
  const clearAllSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: writeStepWindow(t.steps, stepsPerBar, new Array(stepsPerBar).fill(false)),
      })),
    );
  };

  const randomizeSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: writeStepWindow(
          t.steps,
          stepsPerBar,
          Array.from({ length: stepsPerBar }, () => Math.random() > 0.75),
        ),
      })),
    );
  };

  const shiftSteps = (direction: "left" | "right") => {
    onChangeTracks(
      tracks.map((t) => ({ ...t, steps: rotateStepWindow(t.steps, stepsPerBar, direction) })),
    );
  };
```

- [ ] **Step 6: Make `applyDrumPattern` window-aware**

In `src/store/sequencerSlice.ts`, add the imports and rewrite `applyDrumPattern` so an incoming pattern lands in the window without wiping the padding:

```ts
import { getMeter } from '../utils/meter';
import { adaptStepRow, writeStepWindow } from '../utils/patternAdapt';
```

```ts
    // Apply-time adaptation (see the spec, "Where adaptation happens differs by
    // target"): the user edits this grid, so an incoming pattern is adapted to
    // the active bar length HERE and materialised into state. Trimming at
    // playback instead would make the UI lie, showing steps that never sound.
    applyDrumPattern: (pattern) =>
      set((state) => {
        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        return {
          sequencerTracks: state.sequencerTracks.map((track) => {
            const row = pattern[track.instrument];
            if (!row) return track;
            return {
              ...track,
              steps: writeStepWindow(track.steps, stepsPerBar, adaptStepRow(row, stepsPerBar)),
            };
          }),
        };
      }),
```

- [ ] **Step 7: Run the tests**

Run: `bun test src/utils/patternAdapt.test.ts src/store/store.test.ts src/store/instantVibesDrums.test.ts`
Expected: PASS. `applyDrumPattern`'s contract is unchanged in 4/4 — a 16-step row into a 16-step window with 24-wide storage reproduces the old `steps: [...pattern[track.instrument]]` result in its first sixteen cells.

- [ ] **Step 8: Commit**

```bash
git add src/utils/patternAdapt.ts src/utils/patternAdapt.test.ts src/components/SequencerView.tsx src/store/sequencerSlice.ts
git commit -m "feat(sequencer): window stored step arrays to the active bar length"
```

---

### Task 10: `SequencerView` UI derives its grid from the meter

**Files:**
- Create: `src/components/sequencerGrid.ts`
- Create: `src/components/sequencerGrid.test.ts`
- Modify: `src/components/SequencerView.tsx:123-135` (the header label), `:289-312` (the step header), `:368-390` (the step buttons)

**Interfaces:**
- Consumes: `Meter`, `beatIndexAt`, `isBeatBoundary` from `src/utils/meter.ts` (Task 1); `stepsPerBar`/`meter` locals added to `SequencerView` in Task 9.
- Produces (all from `src/components/sequencerGrid.ts`, so they are testable without React — the repo has no DOM test setup):
  - `function sequencerTitle(meter: Meter): string` — e.g. `'Drum Sequencer (16-Step · 4/4)'`
  - `interface StepCell { index: number; label: number; isBeatStart: boolean; beatIndex: number; isAltBeatGroup: boolean }`
  - `function stepCells(meter: Meter): StepCell[]` — one entry per step of the bar, in order

`isAltBeatGroup` replaces the hardcoded `Math.floor(stepIdx / 4) % 2 === 0` at `SequencerView.tsx:371`: it is `beatIndex % 2 === 0`, which for 4/4 is exactly the old expression.

- [ ] **Step 1: Write the failing test**

Create `src/components/sequencerGrid.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { sequencerTitle, stepCells } from './sequencerGrid';
import { METERS } from '../utils/meter';

describe('sequencerTitle', () => {
  test('names the bar length and the meter instead of a hardcoded 16', () => {
    expect(sequencerTitle(METERS['4/4'])).toBe('Drum Sequencer (16-Step · 4/4)');
    expect(sequencerTitle(METERS['3/4'])).toBe('Drum Sequencer (12-Step · 3/4)');
    expect(sequencerTitle(METERS['6/8'])).toBe('Drum Sequencer (12-Step · 6/8)');
    expect(sequencerTitle(METERS['12/8'])).toBe('Drum Sequencer (24-Step · 12/8)');
    expect(sequencerTitle(METERS['7/8'])).toBe('Drum Sequencer (14-Step · 7/8)');
  });
});

describe('stepCells', () => {
  test('4/4 reproduces the old Array.from({ length: 16 }) grid exactly', () => {
    const cells = stepCells(METERS['4/4']);
    expect(cells.length).toBe(16);
    cells.forEach((cell, i) => {
      expect(cell.index).toBe(i);
      expect(cell.label).toBe(i + 1);
      expect(cell.isBeatStart).toBe(i % 4 === 0);
      expect(cell.beatIndex).toBe(Math.floor(i / 4));
      expect(cell.isAltBeatGroup).toBe(Math.floor(i / 4) % 2 === 0);
    });
  });

  test('3/4 draws twelve cells in three groups of four', () => {
    const cells = stepCells(METERS['3/4']);
    expect(cells.length).toBe(12);
    expect(cells.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 4, 8]);
    expect(cells[11].beatIndex).toBe(2);
  });

  test('6/8 draws twelve cells in two groups of six — different from 3/4', () => {
    const waltz = stepCells(METERS['3/4']);
    const compound = stepCells(METERS['6/8']);
    expect(compound.length).toBe(waltz.length);
    expect(compound.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 6]);
    expect(compound.map((c) => c.beatIndex)).not.toEqual(waltz.map((c) => c.beatIndex));
  });

  test('7/8 groups 3+2+2 and alternates shading per beat group, not per four steps', () => {
    const cells = stepCells(METERS['7/8']);
    expect(cells.length).toBe(14);
    expect(cells.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 6, 10]);
    expect(cells.map((c) => c.isAltBeatGroup)).toEqual([
      true, true, true, true, true, true,
      false, false, false, false,
      true, true, true, true,
    ]);
  });

  test('labels are always 1-based and contiguous', () => {
    for (const id of ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8'] as const) {
      const cells = stepCells(METERS[id]);
      expect(cells.map((c) => c.label)).toEqual(cells.map((_, i) => i + 1));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/sequencerGrid.test.ts`
Expected: FAIL — `Cannot find module './sequencerGrid'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sequencerGrid.ts`:

```ts
import { beatIndexAt, isBeatBoundary, type Meter } from '../utils/meter';

/**
 * Pure view-model for the sequencer grid, kept out of SequencerView.tsx so it
 * can be tested without rendering React — this repo has no DOM/testing-library
 * setup and every component's testable logic is exported like this.
 */

/** Header label. The old copy said "Drum Sequencer (16-Step)" unconditionally. */
export function sequencerTitle(meter: Meter): string {
  return `Drum Sequencer (${meter.stepsPerBar}-Step · ${meter.label})`;
}

export interface StepCell {
  /** 0-based step index within the bar. */
  index: number;
  /** 1-based number shown in the step header. */
  label: number;
  /** First step of an accent group — the old `i % 4 === 0`. */
  isBeatStart: boolean;
  /** Which accent group this step belongs to. */
  beatIndex: number;
  /** Alternating group shading — the old `Math.floor(stepIdx / 4) % 2 === 0`. */
  isAltBeatGroup: boolean;
}

export function stepCells(meter: Meter): StepCell[] {
  const cells: StepCell[] = [];
  for (let index = 0; index < meter.stepsPerBar; index++) {
    const beatIndex = beatIndexAt(index, meter.accentGroups);
    cells.push({
      index,
      label: index + 1,
      isBeatStart: isBeatBoundary(index, meter.accentGroups),
      beatIndex,
      isAltBeatGroup: beatIndex % 2 === 0,
    });
  }
  return cells;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/sequencerGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Consume the view-model in `SequencerView.tsx`**

Add the import:

```ts
import { sequencerTitle, stepCells } from "./sequencerGrid";
```

Derive the cells once, next to the `meter` / `stepsPerBar` locals added in Task 9:

```ts
  const cells = stepCells(meter);
```

Replace the header label (`:132-134`):

```ts
          <h2 className="font-bold text-sm sm:text-base text-base-content">
            {sequencerTitle(meter)}
          </h2>
```

Replace the step header (`:292-312`) — note the comment above it also stops saying "1-16":

```ts
        {/* Step Indicator Header — one cell per step of the active bar */}
        <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
          {cells.map((cell) => {
            const isCurrent = currentStep === cell.index && isPlaying;
            return (
              <div
                key={cell.index}
                className={`flex-1 text-center tabular-nums text-[10px] py-1 rounded transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-content font-bold shadow-md shadow-primary/50"
                    : cell.isBeatStart
                      ? "text-accent font-bold bg-base-300/40"
                      : "text-base-content/50"
                }`}
              >
                {cell.label}
              </div>
            );
          })}
        </div>
```

Replace the step-button loop (`:368-390`) so it walks the cells rather than the raw stored array (which is 24 wide):

```ts
              {/* Step Buttons — the visible window of this row */}
              <div className="flex-1 flex items-center gap-1.5">
                {cells.map((cell) => {
                  const isActive = track.steps[cell.index] === true;
                  const isCurrent = currentStep === cell.index && isPlaying;

                  return (
                    <button
                      key={cell.index}
                      id={`step-${track.id}-${cell.index}`}
                      onClick={() => toggleStep(track.id, cell.index)}
                      className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
                        isActive
                          ? `${track.color} shadow-md shadow-primary/20 scale-[0.96]`
                          : cell.isAltBeatGroup
                            ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                            : "bg-base-200 hover:bg-base-300 border border-base-300/40"
                      } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
                    >
                      {isActive && (
                        <div className="absolute inset-0 bg-base-content/10 rounded-field animate-pulse" />
                      )}
```

Leave the closing tags of that button and the surrounding markup exactly as they are. **Every class name above is unchanged from the current file** — the theme guard scans for raw palette classes and this task introduces none.

- [ ] **Step 6: Run the tests and the theme guard**

Run: `bun test src/components/sequencerGrid.test.ts src/components/SequencerView.test.tsx && bun run check:theme && bun run lint`
Expected: PASS. `SequencerView.test.tsx` renders the component with `renderToString` and asserts on the emitted class strings — in particular that step numbers keep `tabular-nums` and the downbeat keeps `text-accent`. Both survive the rewrite above; if either assertion fails, a class string was dropped, not a token added.

- [ ] **Step 7: Commit**

```bash
git add src/components/sequencerGrid.ts src/components/sequencerGrid.test.ts src/components/SequencerView.tsx
git commit -m "feat(sequencer): derive the grid header and beat grouping from the meter"
```

---

### Task 11: Reshape `GENRE_PRESETS` to carry a meter

**Files:**
- Modify: `src/audio/data/genrePresets.ts:1-7` (the type and the opening brace) and every one of the 12 entries
- Modify: `src/audio/data/genrePresets.test.ts:4-17` (it iterates the old shape directly)
- Modify: `src/components/SequencerView.tsx:107-121` (`applyGenrePreset`) and `:162` (the dropdown)
- Test: `src/audio/drumKits.test.ts` — **verify it still passes unchanged**

**Interfaces:**
- Consumes: `MeterId` from `src/utils/meter.ts` (Task 1); `adaptStepRow` from `src/utils/patternAdapt.ts` (Task 2); the meter-aware `applyDrumPattern` from Task 9.
- Produces:
  - `interface GenrePreset { meter: MeterId; rows: Record<string, boolean[]> }`
  - `const GENRE_PRESETS: Record<string, GenrePreset>`

**The 12 top-level keys, verified — they must not change** (`drumKits.test.ts:42-46` asserts key-set parity with `GENRE_TO_KIT`, and two of them are quoted string keys):

`Synthwave`, `House`, `Trap`, `"Boom Bap"`, `Cyberpunk`, `DnB`, `Dubstep`, `Techno`, `Funk`, `Rock`, `Reggae`, `"Lo-Fi Hip-Hop"`.

**The 7 row keys, verified:** `kick`, `snare`, `hihat`, `openhat`, `clap`, `tom`, **`bass`**. (The sibling `VIBE_DRUM_PATTERNS` has `crash` in the seventh slot instead of `bass` — the two libraries genuinely differ there. Do not "harmonise" them; the header comment in `vibeDrumPatterns.ts:9-15` explains why they stay separate.)

- [ ] **Step 1: Write the failing test**

Replace the whole body of `src/audio/data/genrePresets.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { GENRE_PRESETS } from './genrePresets';
import { getMeter, isMeterId } from '../../utils/meter';

const GENRES = [
  'Synthwave',
  'House',
  'Trap',
  'Boom Bap',
  'Cyberpunk',
  'DnB',
  'Dubstep',
  'Techno',
  'Funk',
  'Rock',
  'Reggae',
  'Lo-Fi Hip-Hop',
];

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'bass'];

describe('GENRE_PRESETS data sanity', () => {
  test('holds exactly the twelve genre keys, unchanged by the reshape', () => {
    expect(Object.keys(GENRE_PRESETS).sort()).toEqual([...GENRES].sort());
  });

  test('every genre declares a real meter', () => {
    for (const genre of GENRES) {
      expect(isMeterId(GENRE_PRESETS[genre].meter), `${genre} meter`).toBe(true);
    }
  });

  test('Stage 1 ships every genre at 4/4 — authoring other meters is Stage 2', () => {
    for (const genre of GENRES) {
      expect(GENRE_PRESETS[genre].meter, `${genre} must still be 4/4`).toBe('4/4');
    }
  });

  test('every genre defines all seven rows and nothing else', () => {
    for (const genre of GENRES) {
      expect(Object.keys(GENRE_PRESETS[genre].rows).sort()).toEqual([...ROWS].sort());
    }
  });

  test("every row is exactly its own meter's bar length, in booleans", () => {
    for (const genre of GENRES) {
      const preset = GENRE_PRESETS[genre];
      const expected = getMeter(preset.meter).stepsPerBar;
      for (const [instrument, steps] of Object.entries(preset.rows)) {
        expect(steps.length, `${genre}/${instrument} must be ${expected} steps`).toBe(expected);
        expect(
          steps.every((v) => typeof v === 'boolean'),
          `${genre}/${instrument} must be booleans`,
        ).toBe(true);
      }
    }
  });

  test('the rows are byte-identical to the pre-reshape data for a spot-checked genre', () => {
    // Synthwave kick: four on the floor. Pinned so the reshape cannot silently
    // reorder or rewrite a row while moving it under `rows`.
    expect(GENRE_PRESETS.Synthwave.rows.kick).toEqual([
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ]);
    expect(GENRE_PRESETS['Boom Bap'].rows.snare).toEqual([
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false,
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/data/genrePresets.test.ts`
Expected: FAIL — `GENRE_PRESETS.Synthwave.meter` is `undefined` and `.rows` does not exist.

- [ ] **Step 3: Reshape the data**

In `src/audio/data/genrePresets.ts`, replace the header and the declaration line, then wrap each of the 12 entries' seven rows under a `rows` key and give each entry `meter: '4/4'`. The row arrays themselves must be **copied verbatim** — do not retype them.

```ts
import type { MeterId } from '../../utils/meter';

// Genre -> { meter, instrument -> boolean pattern }. Moved verbatim from
// SequencerView.tsx (was lines 23-1560).
//
// One line per row, matching the sibling vibeDrumPatterns.ts: a rhythm is only
// readable as a row. The two libraries stay SEPARATE on purpose — see the note
// at vibeDrumPatterns.ts:9-15.
//
// The `{ meter, rows }` wrapper exists because the flat `Record<string,
// boolean[]>` shape had nowhere to hang metadata, and a pattern's bar length
// alone is not a sufficient tag: 3/4 and 6/8 are both 12 steps and differ only
// in accent grouping.
export interface GenrePreset {
  meter: MeterId;
  rows: Record<string, boolean[]>;
}

export const GENRE_PRESETS: Record<string, GenrePreset> = {
  Synthwave: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, true],
      bass: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    },
  },
  // ...the remaining 11 entries take the identical treatment...
};
```

Apply the same two-line wrapper (`meter: '4/4',` then `rows: {` … `},`) to `House`, `Trap`, `"Boom Bap"`, `Cyberpunk`, `DnB`, `Dubstep`, `Techno`, `Funk`, `Rock`, `Reggae` and `"Lo-Fi Hip-Hop"`, keeping their quoting exactly as it is today.

- [ ] **Step 4: Update the one component consumer**

In `src/components/SequencerView.tsx`, `applyGenrePreset` (`:107-121`) becomes — note it now hands the rows to the store's meter-aware `applyDrumPattern` (Task 9) instead of writing tracks itself, so apply-time adaptation happens in exactly one place:

```ts
  const applyDrumPattern = useAppStore((s) => s.applyDrumPattern);
```

```ts
  const applyGenrePreset = (genre: string) => {
    setSelectedGenre(genre);
    const preset = GENRE_PRESETS[genre];
    if (!preset) return;
    // Apply-time adaptation: applyDrumPattern trims or loops each row to the
    // active bar length and writes it into the window, so what the grid shows
    // is exactly what will sound.
    applyDrumPattern(preset.rows);
  };
```

The dropdown at `:162` (`Object.keys(GENRE_PRESETS).map(...)`) needs **no change** — the top-level keys are untouched.

- [ ] **Step 5: Run the tests**

Run: `bun test src/audio/data/genrePresets.test.ts src/audio/drumKits.test.ts src/components/SequencerView.test.tsx && bun run lint`
Expected: PASS. `drumKits.test.ts:42-46` (`GENRE_TO_KIT and GENRE_PRESETS have identical key sets`) must pass **unchanged** — if it fails, a genre key was renamed or dropped during the reshape; fix the data, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/audio/data/genrePresets.ts src/audio/data/genrePresets.test.ts src/components/SequencerView.tsx
git commit -m "refactor(data): reshape GENRE_PRESETS to carry a meter alongside its rows"
```

---

### Task 12: Tag the other three pattern libraries with their meter

**Files:**
- Modify: `src/audio/rhythmPatterns.ts:28-34` (`RhythmPattern`) and its 15 entries
- Modify: `src/audio/bassPatterns.ts:23-29` (`BassPattern`) and its 12 entries
- Modify: `src/audio/data/vibeDrumPatterns.ts` (append `VIBE_DRUM_PATTERN_METERS` + `drumPatternMeterId`)
- Test: `src/audio/rhythmPatterns.test.ts` (append), `src/audio/bassPatterns.test.ts` (append), `src/audio/data/vibeDrumPatterns.test.ts` (amend the row-length test)

**Interfaces:**
- Consumes: `MeterId`, `getMeter` from `src/utils/meter.ts` (Task 1).
- Produces:
  - `RhythmPattern.meter?: MeterId` and `BassPattern.meter?: MeterId`
  - No new default constant: consumers resolve a pattern's meter with `getMeter(pattern.meter)`, whose fallback is already `DEFAULT_METER_ID` (`'4/4'`) from Task 1.
  - `const VIBE_DRUM_PATTERN_METERS: Record<string, MeterId>` and `function drumPatternMeterId(id: string): MeterId` from `src/audio/data/vibeDrumPatterns.ts`

**Why `meter` is optional on the two interfaces (and a sidecar on the third):**
`RhythmPattern` and `BassPattern` object literals are constructed inline in `src/audio/bassPatterns.test.ts` and `src/audio/playback/chordPlayback.test.ts`; a required field would break those literals for no behavioural gain. Optional + `getMeter`'s 4/4 fallback + an invariant test that every *shipped library entry* declares one explicitly gives the same safety. `VIBE_DRUM_PATTERNS` is `Record<string, Record<string, number[]>>` — flat rows with no object to hang a field on — and reshaping it would ripple into `drumPatternById`'s return type, `InstantVibe.drumPattern` (`src/types.ts:179`), `ORIGINAL_VIBE_DRUM_PATTERNS` (`src/store/instantVibesDrumsFixture.ts:25`) and three golden invariant tests, so it gets a sidecar map keyed by the same library ids.

The 6 vibe library ids, verified: `lofi-half-time-brush`, `synthwave-four-on-floor`, `edm-offbeat-pump`, `ambient-sparse-drift`, `boombap-swung-break`, `zen-bamboo-pulse`.

- [ ] **Step 1: Write the failing tests**

Append to `src/audio/rhythmPatterns.test.ts`:

```ts
describe('RHYTHM_PATTERNS meter tags', () => {
  test('all fifteen patterns exist and every one declares a meter explicitly', () => {
    expect(RHYTHM_PATTERNS.length).toBe(15);
    for (const p of RHYTHM_PATTERNS) {
      expect(p.meter, `${p.id} must declare a meter`).toBeDefined();
      expect(p.meter, `${p.id} is Stage 1, so it must be 4/4`).toBe('4/4');
    }
  });

  test("no hit falls outside its own pattern's bar", () => {
    for (const p of RHYTHM_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const hit of p.hits) {
        expect(hit.step, `${p.id} hit step`).toBeGreaterThanOrEqual(0);
        expect(hit.step, `${p.id} hit step`).toBeLessThan(bar);
      }
    }
  });
});
```

Add `getMeter` to that file's imports (`import { getMeter } from '../utils/meter';`) and make sure `RHYTHM_PATTERNS` is imported.

Append to `src/audio/bassPatterns.test.ts` (same import addition, plus `BASS_PATTERNS`):

```ts
describe('BASS_PATTERNS meter tags', () => {
  test('all twelve patterns exist and every one declares a meter explicitly', () => {
    expect(BASS_PATTERNS.length).toBe(12);
    for (const p of BASS_PATTERNS) {
      expect(p.meter, `${p.id} must declare a meter`).toBeDefined();
      expect(p.meter, `${p.id} is Stage 1, so it must be 4/4`).toBe('4/4');
    }
  });

  test("no step falls outside its own pattern's bar", () => {
    for (const p of BASS_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const s of p.steps) {
        expect(s.step, `${p.id} step`).toBeGreaterThanOrEqual(0);
        expect(s.step, `${p.id} step`).toBeLessThan(bar);
      }
    }
  });
});
```

In `src/audio/data/vibeDrumPatterns.test.ts`, replace the `'every row is exactly 16 steps of literal 0 or 1'` test (`:26-36`) with a version that asserts against the pattern's own declared meter, and add a tag test. Add `VIBE_DRUM_PATTERN_METERS, drumPatternMeterId` to the existing `./vibeDrumPatterns` import and `getMeter` from `../../utils/meter`:

```ts
  test("every row is exactly its own meter's bar length, in literal 0 or 1", () => {
    for (const id of LIBRARY_IDS) {
      const expected = getMeter(drumPatternMeterId(id)).stepsPerBar;
      for (const row of ROWS) {
        const steps = VIBE_DRUM_PATTERNS[id][row];
        expect(steps.length, `${id}/${row}`).toBe(expected);
        for (const cell of steps) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });

  test('every library id has a meter tag, and Stage 1 ships them all at 4/4', () => {
    expect(Object.keys(VIBE_DRUM_PATTERN_METERS).sort()).toEqual([...LIBRARY_IDS].sort());
    for (const id of LIBRARY_IDS) expect(drumPatternMeterId(id)).toBe('4/4');
  });

  test('an unknown id reports the default meter rather than undefined', () => {
    expect(drumPatternMeterId('no-such-pattern')).toBe('4/4');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/rhythmPatterns.test.ts src/audio/bassPatterns.test.ts src/audio/data/vibeDrumPatterns.test.ts`
Expected: FAIL — `p.meter` is `undefined` and `drumPatternMeterId` is not exported.

- [ ] **Step 3: Tag `RHYTHM_PATTERNS`**

In `src/audio/rhythmPatterns.ts`, add the import and the optional field:

```ts
import type { MeterId } from '../utils/meter';
```

```ts
export interface RhythmPattern {
  id: string;
  name: string;
  style: string;
  description?: string;
  /**
   * The meter this pattern was AUTHORED in. Optional so inline test literals
   * stay valid; every shipped entry declares it and an invariant test enforces
   * that. Consumers resolve it with `getMeter(pattern.meter)`, which falls back
   * to 4/4. Adaptation to a different active meter happens at PLAYBACK time
   * (utils/eventAdapt.ts) — the user picks these by id and never edits them, so
   * the library stays pure and needs no migration.
   */
  meter?: MeterId;
  hits: RhythmHit[];
}
```

Then add `meter: '4/4',` to each of the 15 entries, immediately after its `id:` line. The 15 ids, verified in declaration order: `sustained`, `lofiSwing`, `eighthPads`, `offbeatStabs`, `syncopatedPush`, `popBallad8ths`, `tripletBallad`, `fourOnFloor`, `funkSyncopation`, `bossaComping`, `montunoClave`, `offbeatSkank`, `arpRollUp`, `arpDownEighths`, `bassPlusStrum`. Do not touch any `hits` array.

- [ ] **Step 4: Tag `BASS_PATTERNS`**

In `src/audio/bassPatterns.ts`, add the same import and field:

```ts
import type { MeterId } from '../utils/meter';
```

```ts
export interface BassPattern {
  id: string;
  name: string;
  style: string;           // dropdown group, same as RHYTHM_STYLE_GROUPS
  description?: string;
  /** Authored meter; see RhythmPattern.meter. Resolved with getMeter(). */
  meter?: MeterId;
  steps: BassStep[];
}
```

Then add `meter: '4/4',` after each of the 12 entries' `id:` line. The 12 ids, verified in declaration order: `classic-walk`, `swing-double-approach`, `root-fifth-walk`, `dilla-sub`, `offbeat-sub`, `walking-groove`, `driving-eighths`, `funk-octaves`, `reggae-one-drop`, `arp-1357`, `half-time-legato`, `whole-note-root`. Do not touch any `steps` array.

- [ ] **Step 5: Add the vibe-drum meter sidecar**

Append to `src/audio/data/vibeDrumPatterns.ts` (and add `import { DEFAULT_METER_ID, type MeterId } from '../../utils/meter';` at the top — this file currently imports nothing, and utils/meter imports nothing either, so no layering rule is touched):

```ts
/**
 * The meter each authored pattern is written in, keyed by the SAME library ids
 * as VIBE_DRUM_PATTERNS above.
 *
 * A sidecar rather than a field on the pattern, deliberately: VIBE_DRUM_PATTERNS
 * is a flat `id -> row -> number[]` map, and wrapping it in `{ meter, rows }`
 * would change `drumPatternById`'s return type, `InstantVibe.drumPattern`, the
 * ORIGINAL_VIBE_DRUM_PATTERNS golden fixture and three invariant tests — all to
 * carry one string. The invariant test pins the two key sets together.
 */
export const VIBE_DRUM_PATTERN_METERS: Record<string, MeterId> = {
  'lofi-half-time-brush': '4/4',
  'synthwave-four-on-floor': '4/4',
  'edm-offbeat-pump': '4/4',
  'ambient-sparse-drift': '4/4',
  'boombap-swung-break': '4/4',
  'zen-bamboo-pulse': '4/4',
};

/** The meter a library pattern was authored in; 4/4 for anything unknown. */
export function drumPatternMeterId(id: string): MeterId {
  return VIBE_DRUM_PATTERN_METERS[id] ?? DEFAULT_METER_ID;
}
```

`drumPatternById` keeps its exact current signature and deep-copy behaviour — do not change it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/audio/rhythmPatterns.test.ts src/audio/bassPatterns.test.ts src/audio/data/vibeDrumPatterns.test.ts src/store/instantVibesDrums.test.ts src/store/vibeVariation.test.ts && bun run lint`
Expected: PASS. `instantVibesDrums.test.ts:26` and `vibeVariation.test.ts:15` still assert row length 16 against the golden fixture and the decoration output; both stay 16 because every shipped pattern is still 4/4 — leave them alone.

- [ ] **Step 7: Commit**

```bash
git add src/audio/rhythmPatterns.ts src/audio/bassPatterns.ts src/audio/data/vibeDrumPatterns.ts src/audio/rhythmPatterns.test.ts src/audio/bassPatterns.test.ts src/audio/data/vibeDrumPatterns.test.ts
git commit -m "feat(data): tag the rhythm, bass and vibe-drum libraries with their meter"
```

---

### Task 13: Playback-time adaptation for chord and bass rhythms

**Files:**
- Modify: `src/components/chord/useChordPlayback.ts:114-121` (`resolveRhythmPattern` / `resolveBassPattern`), `:126-197` (`startChordPlan`), `:296-330` and `:332-372` (the two preview callbacks)
- Test: `src/components/chord/useChordPlayback.test.ts` (append)

**Interfaces:**
- Consumes: `adaptStepEvents` from `src/utils/eventAdapt.ts` (Task 3); `getMeter` from `src/utils/meter.ts` (Task 1); `RhythmPattern.meter` / `BassPattern.meter` (Task 12); `activeStepsPerBar()` (Task 8).
- Produces (exported from `src/components/chord/useChordPlayback.ts` so they are testable without React):
  - `function adaptRhythmPattern(pattern: RhythmPattern, stepsPerBar: number): RhythmPattern`
  - `function adaptBassPattern(pattern: BassPattern, stepsPerBar: number): BassPattern`

Both return the *same object identity* when no adaptation is needed, which is what keeps 4/4 byte-identical: `isFullHoldRhythm` / `isFullHoldBass` compare `pattern.id`, and the returned object keeps its id either way.

Drum presets adapt at **apply-time** (Task 9's `applyDrumPattern`); chord and bass rhythms adapt **here**, at playback time, because the user picks them by id and never edits them — so the library stays pure, no migration is needed, and changing meter re-adapts automatically.

- [ ] **Step 1: Write the failing test**

Append to `src/components/chord/useChordPlayback.test.ts` — the three `import` lines belong at the **top** of the file with the existing imports, the `describe` blocks at the bottom:

```ts
import { adaptBassPattern, adaptRhythmPattern } from './useChordPlayback';
import type { RhythmPattern } from '../../audio/rhythmPatterns';
import type { BassPattern } from '../../audio/bassPatterns';

const FOUR_ON_FLOOR: RhythmPattern = {
  id: 'test-four',
  name: 'Test Four',
  style: 'Test',
  meter: '4/4',
  hits: [
    { step: 0, type: 'block', holdSteps: 4 },
    { step: 4, type: 'block', holdSteps: 4 },
    { step: 8, type: 'block', holdSteps: 4 },
    { step: 12, type: 'block', holdSteps: 4 },
  ],
};

const WALKING: BassPattern = {
  id: 'test-walk',
  name: 'Test Walk',
  style: 'Test',
  meter: '4/4',
  steps: [
    { step: 0, note: 'root', holdSteps: 4 },
    { step: 4, note: 'third', holdSteps: 4 },
    { step: 8, note: 'fifth', holdSteps: 4 },
    { step: 12, note: 'seventh', holdSteps: 4 },
  ],
};

describe('adaptRhythmPattern', () => {
  test('a 4/4 pattern in a 16-step bar is returned untouched, same identity', () => {
    expect(adaptRhythmPattern(FOUR_ON_FLOOR, 16)).toBe(FOUR_ON_FLOOR);
  });

  test('into a 12-step bar it drops the step-12 hit and keeps its id', () => {
    const out = adaptRhythmPattern(FOUR_ON_FLOOR, 12);
    expect(out.id).toBe('test-four');
    expect(out.hits.map((h) => h.step)).toEqual([0, 4, 8]);
  });

  test('a hold is clamped so nothing rings past the bar line', () => {
    const long: RhythmPattern = {
      ...FOUR_ON_FLOOR,
      hits: [{ step: 8, type: 'block', holdSteps: 8 }],
    };
    expect(adaptRhythmPattern(long, 12).hits[0].holdSteps).toBe(4);
  });

  test('into a 20-step bar it loops from step 0', () => {
    const out = adaptRhythmPattern(FOUR_ON_FLOOR, 20);
    expect(out.hits.map((h) => h.step)).toEqual([0, 4, 8, 12, 16]);
  });

  test('a pattern with no declared meter is treated as 4/4', () => {
    const untagged: RhythmPattern = { ...FOUR_ON_FLOOR, meter: undefined };
    expect(adaptRhythmPattern(untagged, 12).hits.map((h) => h.step)).toEqual([0, 4, 8]);
  });
});

describe('adaptBassPattern', () => {
  test('a 4/4 pattern in a 16-step bar is returned untouched, same identity', () => {
    expect(adaptBassPattern(WALKING, 16)).toBe(WALKING);
  });

  test('into a 12-step bar it drops the step-12 note and keeps its id', () => {
    const out = adaptBassPattern(WALKING, 12);
    expect(out.id).toBe('test-walk');
    expect(out.steps.map((s) => s.step)).toEqual([0, 4, 8]);
    expect(out.steps.map((s) => s.note)).toEqual(['root', 'third', 'fifth']);
  });

  test('into a 24-step bar it loops once and a half', () => {
    const out = adaptBassPattern(WALKING, 24);
    expect(out.steps.map((s) => s.step)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(out.steps[4].note).toBe('root');
  });

  test('every surviving note ends at or before the bar line', () => {
    for (const bar of [12, 14, 20, 24]) {
      for (const s of adaptBassPattern(WALKING, bar).steps) {
        expect(s.step + (s.holdSteps ?? 1)).toBeLessThanOrEqual(bar);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/chord/useChordPlayback.test.ts`
Expected: FAIL — `adaptRhythmPattern is not a function`.

- [ ] **Step 3: Implement the two adapters**

In `src/components/chord/useChordPlayback.ts`, add the import and put both functions immediately below `resolveBassPattern` (`:118-121`):

```ts
import { adaptStepEvents } from "../../utils/eventAdapt";
```

```ts
/**
 * Playback-time adaptation. Chord and bass rhythms are picked by id and never
 * edited by the user, so the library stays byte-identical on disk and a meter
 * change re-adapts on the next chord — no migration, no lossy write-back.
 * (The drum grid is the opposite case: it is user-editable, so preset
 * adaptation there is materialised at APPLY time in the sequencer slice.)
 *
 * Returns the SAME object when no adaptation is needed, so the identity checks
 * and id comparisons downstream (isFullHoldRhythm/isFullHoldBass) are unaffected
 * in 4/4.
 */
export function adaptRhythmPattern(pattern: RhythmPattern, stepsPerBar: number): RhythmPattern {
  const sourceSteps = getMeter(pattern.meter).stepsPerBar;
  if (sourceSteps === stepsPerBar) return pattern;
  return { ...pattern, hits: adaptStepEvents(pattern.hits, sourceSteps, stepsPerBar) };
}

export function adaptBassPattern(pattern: BassPattern, stepsPerBar: number): BassPattern {
  const sourceSteps = getMeter(pattern.meter).stepsPerBar;
  if (sourceSteps === stepsPerBar) return pattern;
  return { ...pattern, steps: adaptStepEvents(pattern.steps, sourceSteps, stepsPerBar) };
}
```

- [ ] **Step 4: Apply them at the three resolution sites**

In `startChordPlan`, the chord branch (`:141-153`) resolves and then adapts. `stepsPerBar` is already in scope from Task 8:

```ts
  let chordEvents: BarInvariantEvent[] = [];
  if (!chordArp) {
    const pattern = adaptRhythmPattern(resolveRhythmPattern(s.chordRhythmId), stepsPerBar);
```

and the bass branch (`:155-158`):

```ts
  let bassEvents: BarInvariantEvent[] = [];
  if (!bassArp) {
    const pattern = adaptBassPattern(resolveBassPattern(s.bassPatternId), stepsPerBar);
```

The rest of both branches is unchanged — `isFullHoldRhythm(pattern)` / `isFullHoldBass(pattern)` still see the pattern's own id, and `buildChordEvents` / `resolveBassSteps` receive the adapted hits.

In the two preview callbacks, adapt the incoming pattern at the top so a preview sounds like playback will:

`playChordWithRhythm` (`:296-330`) — bind an `adapted` local rather than reassigning the parameter, then use it everywhere `pattern` was used:

```ts
      initPlaybackEngine();

      const stepsPerBar = activeStepsPerBar();
      const adapted = adaptRhythmPattern(pattern, stepsPerBar);
```

```ts
      if (isFullHoldRhythm(adapted)) {
        const barDur = barDurationSec(bpm, stepsPerBar);
```

```ts
      scheduleWholeChord(
        buildChordEvents(adapted, notes, stepDur, holdScale),
        chordSynthParams,
        "chord",
        startTime,
        stepDur,
        totalBars,
        stepsPerBar,
      );
```

`playBassWithPattern` (`:332-372`), the same shape:

```ts
      initPlaybackEngine();
      const stepsPerBar = activeStepsPerBar();
      const adapted = adaptBassPattern(pattern, stepsPerBar);
```

```ts
      const resolveWithHold = (holdScale: number) =>
        resolveBassSteps(
          adapted,
          context,
          chordIdx,
          bassOctave,
          scaleRoot,
          scaleType,
          bpm,
          holdScale,
        );

      if (isFullHoldBass(adapted)) {
        const barDur = barDurationSec(bpm, stepsPerBar);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/components/chord/useChordPlayback.test.ts src/audio/playback/chordPlayback.test.ts src/audio/bassPatterns.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chord/useChordPlayback.ts src/components/chord/useChordPlayback.test.ts
git commit -m "feat(playback): adapt chord and bass rhythms to the active meter at playback time"
```

---

### Task 14: The meter `select` in the transport bar

**Files:**
- Create: `src/components/meterSelect.ts`
- Create: `src/components/meterSelect.test.ts`
- Modify: `src/components/TransportBar.tsx:1-22` (imports + store selectors), `:83-109` (insert the select next to the BPM control)
- Test: `src/components/TransportBar.test.tsx` (append)

**Interfaces:**
- Consumes: `METERS`, `METER_IDS`, `isMeterId`, `MeterId` from `src/utils/meter.ts` (Task 1); `meterId` / `setMeter` from the transport slice (Task 4).
- Produces:
  - `interface MeterOption { value: MeterId; label: string; title: string }`
  - `const METER_OPTIONS: MeterOption[]`
  - `function coerceMeterChoice(raw: string, current: MeterId): MeterId` — guards the raw `<select>` value so a stale DOM value can never reach `setMeter`

The select lives in the transport bar rather than the sequencer header (the spec's argued default): meter affects the chord scheduler and the metronome, not only the drums. A **single** select of six options — no separate numerator/denominator inputs.

- [ ] **Step 1: Write the failing test**

Create `src/components/meterSelect.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { METER_OPTIONS, coerceMeterChoice } from './meterSelect';
import { METERS, METER_IDS } from '../utils/meter';

describe('METER_OPTIONS', () => {
  test('offers exactly the six meters, in table order', () => {
    expect(METER_OPTIONS.map((o) => o.value)).toEqual(METER_IDS);
    expect(METER_OPTIONS.length).toBe(6);
  });

  test('labels come from the table, so the select and the metronome cannot disagree', () => {
    for (const option of METER_OPTIONS) {
      expect(option.label).toBe(METERS[option.value].label);
    }
  });

  test('each title spells out the bar length and grouping', () => {
    expect(METER_OPTIONS[0].title).toBe('4/4 — 16 steps per bar, beats of 4+4+4+4');
    const sevenEight = METER_OPTIONS.find((o) => o.value === '7/8')!;
    expect(sevenEight.title).toBe('7/8 — 14 steps per bar, beats of 6+4+4');
    const sixEight = METER_OPTIONS.find((o) => o.value === '6/8')!;
    expect(sixEight.title).toBe('6/8 — 12 steps per bar, beats of 6+6');
  });

  test('3/4 and 6/8 are distinguishable from their titles alone', () => {
    const threeFour = METER_OPTIONS.find((o) => o.value === '3/4')!;
    const sixEight = METER_OPTIONS.find((o) => o.value === '6/8')!;
    expect(threeFour.title).not.toBe(sixEight.title);
  });
});

describe('coerceMeterChoice', () => {
  test('passes through every real id', () => {
    for (const id of METER_IDS) expect(coerceMeterChoice(id, '4/4')).toBe(id);
  });

  test('falls back to the current meter for junk rather than resetting to 4/4', () => {
    expect(coerceMeterChoice('9/8', '5/4')).toBe('5/4');
    expect(coerceMeterChoice('', '7/8')).toBe('7/8');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/meterSelect.test.ts`
Expected: FAIL — `Cannot find module './meterSelect'`.

- [ ] **Step 3: Write the option model**

Create `src/components/meterSelect.ts`:

```ts
import { METERS, METER_IDS, isMeterId, type MeterId } from '../utils/meter';

/**
 * Option model for the transport meter select, kept out of TransportBar.tsx so
 * it can be tested without rendering React (this repo has no DOM test setup).
 */
export interface MeterOption {
  value: MeterId;
  label: string;
  title: string;
}

export const METER_OPTIONS: MeterOption[] = METER_IDS.map((value) => {
  const meter = METERS[value];
  const grouping = meter.accentGroups.join('+');
  return {
    value,
    label: meter.label,
    title: `${meter.label} — ${meter.stepsPerBar} steps per bar, beats of ${grouping}`,
  };
});

/**
 * A `<select>` hands back a raw string. Guard it: an unknown value would reach
 * the clock, and falling back to the CURRENT meter (rather than to 4/4) means a
 * stale DOM value can never silently reset the user's time signature.
 */
export function coerceMeterChoice(raw: string, current: MeterId): MeterId {
  return isMeterId(raw) ? raw : current;
}
```

The `title` strings are built from `accentGroups.join('+')`, so 4/4 reads `4+4+4+4`, 6/8 reads `6+6` and 7/8 reads `6+4+4` — which is what makes 3/4 (`4+4+4`) and 6/8 (`6+6`) distinguishable in the dropdown despite sharing a twelve-step bar.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/meterSelect.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the select in `TransportBar.tsx`**

Add the imports:

```ts
import { METER_OPTIONS, coerceMeterChoice } from "./meterSelect";
```

Add the two store selectors next to the BPM ones (`:17-18`):

```ts
  const meterId = useAppStore((s) => s.meterId);
  const setMeter = useAppStore((s) => s.setMeter);
```

Insert this block immediately after the closing `</div>` of the Tempo BPM Control (i.e. between `:109` and the Metronome Toggle at `:111`). The wrapper copies the BPM control's own container classes and the select classes already proven by `SequencerView.tsx:156-167`, so no new colour or utility class is introduced:

```tsx
        {/* Time Signature */}
        <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-1.5 py-1 rounded-box">
          <span className="text-[10px] text-base-content/50 hidden sm:inline">Meter</span>
          <select
            id="select-transport-meter"
            value={meterId}
            onChange={(e) => setMeter(coerceMeterChoice(e.target.value, meterId))}
            className="select select-xs select-ghost focus:outline-none font-mono font-bold text-primary"
            title="Time signature"
          >
            {METER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.title}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
```

**Do not call `audioEngine.setMeter` from here.** The store→engine bridge in `engineSync.ts` (Task 7) already carries it; a direct call would break layering rule 3 even though `TransportBar.tsx` is on the eslint exemption list for its analyser reads.

- [ ] **Step 6: Add the markup assertion**

Append to `src/components/TransportBar.test.tsx`:

```tsx
describe('transport meter select', () => {
  test('renders one select carrying all six meters on semantic tokens', () => {
    const html = renderToString(<TransportBar />);
    expect(html).toContain('id="select-transport-meter"');
    expect(html).toContain('select select-xs select-ghost');
    for (const label of ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8']) {
      expect(html).toContain(`>${label}</option>`);
    }
  });

  test('the meter control introduces no raw palette classes', () => {
    const html = renderToString(<TransportBar />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
  });
});
```

- [ ] **Step 7: Run the tests and the theme guard**

Run: `bun test src/components/meterSelect.test.ts src/components/TransportBar.test.tsx && bun run check:theme && bun run lint`
Expected: PASS on all.

- [ ] **Step 8: Commit**

```bash
git add src/components/meterSelect.ts src/components/meterSelect.test.ts src/components/TransportBar.tsx src/components/TransportBar.test.tsx
git commit -m "feat(transport): add a six-option time-signature select"
```

---

### Task 15: Instant Vibes declare a meter and set it on apply

**Files:**
- Modify: `src/types.ts:166-215` (`InstantVibe`)
- Modify: `src/store/instantVibes.ts:34-122` (`applyInstantVibeToStore`) and the 6 vibe entries
- Test: `src/store/instantVibes.test.ts` (append)

**Interfaces:**
- Consumes: `MeterId` from `src/utils/meter.ts` (Task 1); `setMeter` from the transport slice (Task 4); the meter-aware `applyDrumPattern` from Task 9.
- Produces: `InstantVibe.meter: MeterId` — **required**, because every vibe is authored in this file and there are no inline `InstantVibe` literals outside it.

**HARD PROJECT RULE — do not rename any vibe id.** The six ids and their drifting labels are: `lofi-chill` → "Lo-Fi Chill", `synthwave-80s` → "Synthwave 80s", `cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden". Ids are persisted in project files; renaming breaks saved projects.

**Ordering is load-bearing.** `store.setMeter(vibe.meter)` must run **before** `store.applyDrumPattern(...)`, because `applyDrumPattern` (Task 9) adapts the incoming rows to whatever meter is active at that moment. Setting the meter afterwards would leave the grid adapted to the previous vibe's meter.

- [ ] **Step 1: Write the failing test**

Append to `src/store/instantVibes.test.ts`:

```ts
describe('vibe meters', () => {
  test('every vibe declares a real meter, and Stage 1 ships them all at 4/4', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(isMeterId(vibe.meter), `${vibe.id} must declare a meter`).toBe(true);
      expect(vibe.meter, `${vibe.id} is Stage 1, so it must be 4/4`).toBe('4/4');
    }
  });

  test('the six vibe ids are unchanged — they are persisted in project files', () => {
    expect(INSTANT_VIBES.map((v) => v.id)).toEqual([
      'lofi-chill',
      'synthwave-80s',
      'cyber-dance',
      'ambient-chill',
      'hiphop-groove',
      'asian-zen',
    ]);
  });

  test('applying a vibe writes its meter into the transport', () => {
    useAppStore.getState().setMeter('7/8');
    applyInstantVibeToStore(INSTANT_VIBES[0]);
    expect(useAppStore.getState().meterId).toBe('4/4');
  });

  test('the meter is set BEFORE the drum grid, so the grid is adapted to it', () => {
    // Order matters: applyDrumPattern adapts to whatever meter is active when
    // it runs. Start from a narrower meter and prove the resulting window is
    // the vibe's 16-step bar, not a 14-step one left over from before.
    useAppStore.getState().setMeter('7/8');
    applyInstantVibeToStore(INSTANT_VIBES[1]);
    const kick = useAppStore.getState().sequencerTracks.find((t) => t.instrument === 'kick')!;
    expect(useAppStore.getState().meterId).toBe('4/4');
    // synthwave-four-on-floor: kicks on 0, 4, 8, 12 — step 12 only survives if
    // the grid was adapted against a 16-step bar.
    expect(kick.steps[12]).toBe(true);
  });
});
```

Add whatever imports the file is missing: `isMeterId` from `../utils/meter`, `useAppStore` from `./store`, and `applyInstantVibeToStore` / `INSTANT_VIBES` from `./instantVibes`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/instantVibes.test.ts`
Expected: FAIL — `vibe.meter` is `undefined`.

- [ ] **Step 3: Add the field to the type**

In `src/types.ts`, add the import and the field to `InstantVibe`, next to `bpm`:

```ts
import type { MeterId } from './utils/meter';
```

```ts
export interface InstantVibe {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  bpm: number;
  /**
   * The time signature this vibe is written in. Applying the vibe sets the
   * transport meter to it, so the vibe always resolves patterns of the right
   * meter. All six current vibes are 4/4; authoring non-4/4 vibes is Stage 2.
   */
  meter: MeterId;
  scaleRoot: string;
  scaleType: string;
```

- [ ] **Step 4: Tag the six vibes**

In `src/store/instantVibes.ts`, add `meter: '4/4',` immediately after each entry's `bpm:` line. The six entries begin at `:125` (`lofi-chill`), `:184` (`synthwave-80s`), `:245` (`cyber-dance`), `:303` (`ambient-chill`), `:361` (`hiphop-groove`) and `:422` (`asian-zen`) — line numbers shift as you edit, so locate each by its `id:` instead. **Change nothing else about any entry, above all not its id.**

- [ ] **Step 5: Set the meter during apply**

In `applyInstantVibeToStore`, section "1. Context & BPM" (`:70-74`), add the meter write there — i.e. before section 2, which calls `applyDrumPattern`:

```ts
  // 1. Context & BPM
  store.setBpm(vibe.bpm);
  // MUST precede applyDrumPattern below: that action adapts the incoming rows
  // to whatever meter is active when it runs, so setting the meter afterwards
  // would leave the grid adapted to the OUTGOING vibe's bar length.
  store.setMeter(vibe.meter);
  store.setScaleRoot(vibe.scaleRoot);
  store.setScaleType(vibe.scaleType);
  store.setSelectedVibeId(vibe.id);
```

Also update the closing comment at `:116-118`, which currently says both hooks arm on `step % STEPS_PER_BAR === 0`:

```ts
  // Restart only what was running. Both playback hooks arm on
  // `step % stepsPerBar === 0` for the ACTIVE meter, which was just set above,
  // so the restart lands on the next bar by construction — no alignment code
  // needed here.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/store/instantVibes.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesChordsFixture.ts src/store/vibeVariation.test.ts src/store/instantVibesProgressions.test.ts src/components/InstantVibesBar.test.tsx && bun run lint`
Expected: PASS. The golden fixtures pin drum rows, chords, effects and progressions — none of which this task touches. A failure there means a vibe entry was edited beyond its new `meter` line.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/instantVibes.test.ts
git commit -m "feat(vibes): declare a meter per vibe and set the transport meter on apply"
```

---

### Task 16: The 4/4-unchanged regression pin, then the full gate

**Files:**
- Create: `src/audio/meterRegression.test.ts`
- Test: everything — this task runs `bun run verify` and `bun run eslint`

**Interfaces:**
- Consumes: every public surface built above — `getMeter`, `beatIndexAt`, `isBeatBoundary`, `arpStepFor`, `MAX_STEPS_PER_BAR` (Task 1); `adaptStepRow` (Task 2); `adaptStepEvents` (Task 3); `barDurationSec` (Task 5); `sequencerStepAction` (Task 8); `stepCells` (Task 10); `GENRE_PRESETS` (Task 11); `RHYTHM_PATTERNS`, `BASS_PATTERNS`, `VIBE_DRUM_PATTERN_METERS` (Task 12); `adaptRhythmPattern`, `adaptBassPattern` (Task 13); `INSTANT_VIBES` (Task 15).
- Produces: nothing consumed downstream. This is the acceptance pin for the whole plan.

- [ ] **Step 1: Write the regression test**

Create `src/audio/meterRegression.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  METERS,
  MAX_STEPS_PER_BAR,
  arpStepFor,
  beatIndexAt,
  getMeter,
  isBeatBoundary,
} from '../utils/meter';
import { barDurationSec, stepDurationSec, STEPS_PER_BAR } from '../utils/musicTheory';
import { BEATS_PER_BAR, beatsPerBarFor } from '../utils/playhead';
import { adaptStepRow } from '../utils/patternAdapt';
import { adaptStepEvents } from '../utils/eventAdapt';
import { stepCells } from '../components/sequencerGrid';
import { GENRE_PRESETS } from './data/genrePresets';
import { VIBE_DRUM_PATTERN_METERS } from './data/vibeDrumPatterns';
import { RHYTHM_PATTERNS } from './rhythmPatterns';
import { BASS_PATTERNS } from './bassPatterns';
import { INSTANT_VIBES } from '../store/instantVibes';

/**
 * THE STAGE 1 ACCEPTANCE PIN.
 *
 * With the meter left at 4/4, every derivation this work introduced must reduce
 * to the exact arithmetic the pre-meter code performed. If a test in this file
 * fails, 4/4 output has changed and the change is a regression regardless of how
 * good it looks in another meter.
 */
describe('4/4 is byte-identical to the pre-meter behaviour', () => {
  const FOUR_FOUR = METERS['4/4'];

  test('the bar is still 16 sixteenth steps', () => {
    expect(FOUR_FOUR.stepsPerBar).toBe(16);
    expect(STEPS_PER_BAR).toBe(16);
    expect(getMeter('4/4').stepsPerBar).toBe(STEPS_PER_BAR);
  });

  test('barDurationSec is unchanged for every transport tempo', () => {
    for (const bpm of [20, 84, 120, 174, 300]) {
      expect(barDurationSec(bpm)).toBeCloseTo(stepDurationSec(bpm) * 16, 12);
      expect(barDurationSec(bpm, FOUR_FOUR.stepsPerBar)).toBeCloseTo(barDurationSec(bpm), 12);
    }
  });

  test('the metronome clicks exactly where step % 4 === 0 used to', () => {
    for (let step = 0; step < 16 * 8; step++) {
      const stepInBar = step % 16;
      expect(isBeatBoundary(stepInBar, FOUR_FOUR.accentGroups)).toBe(step % 4 === 0);
    }
  });

  test('the accented downbeat is exactly where step % 16 === 0 used to be', () => {
    for (let step = 0; step < 16 * 8; step++) {
      const stepInBar = step % 16;
      const accented = isBeatBoundary(stepInBar, FOUR_FOUR.accentGroups) && stepInBar === 0;
      expect(accented).toBe(step % 16 === 0);
    }
  });

  test('the dispatched beat index is exactly Math.floor(step / 4)', () => {
    for (let step = 0; step < 16 * 16; step++) {
      const barIndex = Math.floor(step / 16);
      const stepInBar = step - barIndex * 16;
      const beat = barIndex * FOUR_FOUR.accentGroups.length + beatIndexAt(stepInBar, FOUR_FOUR.accentGroups);
      expect(beat).toBe(Math.floor(step / 4));
    }
  });

  test('the arp phase is the raw clock step — no re-phasing happens in 4/4', () => {
    for (let step = 0; step < 1000; step++) {
      expect(arpStepFor(step, 16)).toBe(step);
    }
  });

  test('beats per bar is still four', () => {
    expect(beatsPerBarFor('4/4')).toBe(BEATS_PER_BAR);
    expect(BEATS_PER_BAR).toBe(4);
  });

  test('the sequencer grid still draws sixteen cells grouped in fours', () => {
    const cells = stepCells(FOUR_FOUR);
    expect(cells.length).toBe(16);
    expect(cells.map((c) => c.isBeatStart)).toEqual(
      Array.from({ length: 16 }, (_, i) => i % 4 === 0),
    );
    expect(cells.map((c) => c.isAltBeatGroup)).toEqual(
      Array.from({ length: 16 }, (_, i) => Math.floor(i / 4) % 2 === 0),
    );
  });

  test('adapting any 16-step row to a 16-step bar is the identity', () => {
    for (const preset of Object.values(GENRE_PRESETS)) {
      for (const row of Object.values(preset.rows)) {
        expect(adaptStepRow(row, 16)).toEqual(row);
      }
    }
  });

  test('adapting any shipped rhythm or bass pattern to a 16-step bar is the identity', () => {
    for (const p of RHYTHM_PATTERNS) {
      expect(adaptStepEvents(p.hits, 16, 16)).toEqual([...p.hits].sort((a, b) => a.step - b.step));
    }
    for (const p of BASS_PATTERNS) {
      expect(adaptStepEvents(p.steps, 16, 16)).toEqual([...p.steps].sort((a, b) => a.step - b.step));
    }
  });
});

describe('every shipped pattern still works and is still 4/4', () => {
  test('all 45 patterns are accounted for and tagged', () => {
    expect(RHYTHM_PATTERNS.length).toBe(15);
    expect(BASS_PATTERNS.length).toBe(12);
    expect(Object.keys(VIBE_DRUM_PATTERN_METERS).length).toBe(6);
    expect(Object.keys(GENRE_PRESETS).length).toBe(12);
    expect(15 + 12 + 6 + 12).toBe(45);
  });

  test('nothing in the shipped libraries declares a non-4/4 meter (Stage 2 territory)', () => {
    for (const p of RHYTHM_PATTERNS) expect(p.meter).toBe('4/4');
    for (const p of BASS_PATTERNS) expect(p.meter).toBe('4/4');
    for (const m of Object.values(VIBE_DRUM_PATTERN_METERS)) expect(m).toBe('4/4');
    for (const preset of Object.values(GENRE_PRESETS)) expect(preset.meter).toBe('4/4');
    for (const vibe of INSTANT_VIBES) expect(vibe.meter).toBe('4/4');
  });

  test('every shipped row fits the widest storable bar', () => {
    for (const preset of Object.values(GENRE_PRESETS)) {
      for (const row of Object.values(preset.rows)) {
        expect(row.length).toBeLessThanOrEqual(MAX_STEPS_PER_BAR);
      }
    }
  });
});
```

- [ ] **Step 2: Run the regression test**

Run: `bun test src/audio/meterRegression.test.ts`
Expected: PASS. Any failure here is a 4/4 regression — fix the production code, never the assertion.

- [ ] **Step 3: Run the whole test suite**

Run: `bun test`
Expected: PASS. Pay particular attention to `src/audio/clock.test.ts`, `src/utils/musicTheory.test.ts`, `src/store/store.test.ts`, `src/store/instantVibes*.test.ts` and `src/store/vibeVariation.test.ts`.

- [ ] **Step 4: Run the completion gate**

Run: `bun run verify`
Expected: PASS — this is `bun test && bun run lint && bun run check:keys && bun run check:drums && bun run build`.

- [ ] **Step 5: Run eslint separately**

Run: `bun run eslint`
Expected: no errors. `verify` does **not** include eslint, and this work added `src/utils/meter.ts` as a new import across all three layers plus new imports in `audio/`, `store/` and `components/` — the layering rules are exactly what this catches.

- [ ] **Step 6: Run the theme guard explicitly**

Run: `bun run check:theme`
Expected: PASS with an empty `ALLOWLIST`. If it fails, fix the class in `TransportBar.tsx` or `SequencerView.tsx` — never re-populate the allowlist.

- [ ] **Step 7: Commit**

```bash
git add src/audio/meterRegression.test.ts
git commit -m "test(meter): pin that 4/4 output is unchanged by meter support"
```

---

## Self-Review

Run after the plan is written, before execution begins.

**1. Spec coverage.**

| Spec section | Covered by |
|---|---|
| The Meter model (table, `MAX_STEPS_PER_BAR`, `accentGroups` invariant) | Task 1 |
| `barDurationSec` takes `stepsPerBar` | Task 5 |
| Metronome from accent-group boundaries | Task 6 |
| `chordPlayback` / `sequencerStepAction` / `chordStepAction` passed the real value | Task 8 |
| `STEPS_PER_BAR` re-exports | Task 5 (kept, redefined as the 4/4 row) + Task 6 (re-export untouched) |
| The monotonic-counter trap / arp re-phasing | Task 1 (`arpStepFor`) + Task 6 (both call sites) |
| Meter reaches the engine through one `engineSync` subscription | Task 7 |
| `meterId` on `TransportSlice` + `setMeter` | Task 4 |
| `SequencerView`'s five hardcoded bars + two grouping expressions | Tasks 9 (clear/randomize/shift) and 10 (label, step header, grouping) |
| `shiftSteps` rotates only the window | Task 9 (`rotateStepWindow`) |
| `BEATS_PER_BAR` becomes `accentGroups.length` | Task 5 (`beatsPerBarFor`) |
| `useSequencerPlayback.ts:134` hardcoded `step % STEPS_PER_BAR` | Task 8 |
| Array-shaped adaptation (trim/loop, never stretch) | Task 2 |
| Event-shaped adaptation + `holdSteps` clamping | Task 3 |
| `lastBarOnly` / `isApproachToken` interaction with the bar boundary | Task 3 (`adaptStepEvents` is field-preserving, so `lastBarOnly` survives) + Task 13 (adaptation runs before `buildChordEvents`, so `eventsForStep`'s `isLastBar` gate is untouched) |
| Apply-time adaptation for drums vs playback-time for chord/bass | Tasks 9 + 11 (apply-time) and 13 (playback-time) |
| Window, don't destroy (`steps` stored at 24) | Tasks 4 (migration + initial state) and 9 (windowing) |
| Persist v4 → v5 | Task 4 |
| Vibes declare a meter; apply sets it; no id renames | Task 15 |
| `GENRE_PRESETS` reshape + its two consumers + `drumKits.test.ts` parity | Task 11 |
| `meter` tag on the other three libraries | Task 12 |
| Meter select in the transport area | Task 14 |
| Theme rule (roles not colours, empty `ALLOWLIST`) | Global Constraints; enforced in Tasks 10, 14, 16 |
| The six existing tests that pin 16 | `musicTheory.test.ts` Task 5 · `clock.test.ts` Task 6 · `vibeDrumPatterns.test.ts` Task 12 · `genrePresets.test.ts` Task 11 · `instantVibesDrums.test.ts` Task 12 (verified: needs no change, it pins the golden fixture) · `useSequencerPlayback.test.ts` Task 8 |
| The five new tests the spec requires | 1 → Task 1 · 2 → Tasks 2+3 · 3 → Tasks 1+6 · 4 → Task 4 · 5 → Task 16 |
| `bun run verify` **plus** `bun run eslint` | Task 16 |

**Deliberately not covered (out of scope, stated in the spec):** multi-bar patterns; Latin 2-bar claves; preset pickers filtering by the active meter (the spec's UI section calls for labelling a pattern's native meter — Task 12 supplies the tag that a Stage 2 picker would read, but no picker UI is built here); authoring native 3/4 and 6/8 content of any kind.

**One spec statement corrected during verification:** the spec's Pattern-adaptation table says the three non-`GENRE_PRESETS` libraries "are already object-shaped and just gain a field". `VIBE_DRUM_PATTERNS` is not — see the File Structure note and Task 12.

**2. Placeholder scan.** No "TBD", no "implement later", no "add appropriate error handling", no "similar to Task N", no test described without its body. Every code step carries real code. The one abbreviation is Task 11 Step 3's `// ...the remaining 11 entries take the identical treatment...`, which names all eleven keys explicitly in the surrounding prose and describes the exact two-line mechanical wrapper — reproducing ~90 verbatim data rows in the plan would be transcription, not instruction, and is the one place where copying from the source file is safer than copying from the plan.

**3. Type-name consistency.** Verified across tasks: `MeterId` / `Meter` / `METERS` / `METER_IDS` / `DEFAULT_METER_ID` / `MAX_STEPS_PER_BAR` (Task 1, used in 4/5/6/7/10/11/12/14/15/16); `getMeter` (1 → 5/6/7/8/9/10/12/16); `beatIndexAt` / `isBeatBoundary` (1 → 6/10/16); `arpStepFor` (1 → 6/16); `adaptStepRow` / `adaptStepRows` / `padStepRow` (2 → 4/9/11/16); `writeStepWindow` / `rotateStepWindow` (9 → 9/11); `adaptStepEvents` (3 → 13/16); `barDurationSec(bpm, stepsPerBar?)` (5 → 8/13/16); `beatsPerBarFor` (5 → 16); `audioEngine.setMeter` / `getMeter()` (6 → 6/7); `arpEventsForStep(..., stepsPerBar?)` (6 → 8); `activeStepsPerBar` (8 → 13); `stepCells` / `sequencerTitle` / `StepCell` (10 → 10/16); `GenrePreset { meter, rows }` (11 → 11/16); `VIBE_DRUM_PATTERN_METERS` / `drumPatternMeterId` (12 → 12/16); `adaptRhythmPattern` / `adaptBassPattern` (13 → 13); `METER_OPTIONS` / `coerceMeterChoice` / `MeterOption` (14 → 14); `InstantVibe.meter` (15 → 15/16); `migrateMeterAndStepWidth` (4 → 4).

Two naming traps deliberately avoided: `getMeter` (the meter-table lookup, in `utils/meter.ts`) and `audioEngine.getMeter()` (the engine's accessor for its own current meter) share a name but never appear in the same scope — `engineSync.ts` calls the former, `arpPlayback.ts` the latter. And `Meter` the type is unrelated to the "VU meter" locals in `TransportBar.tsx` (`vuLevel`, `updateMeter`); Task 14 adds no identifier that collides with them.
