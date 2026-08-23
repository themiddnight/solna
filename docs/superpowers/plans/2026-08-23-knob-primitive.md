# Knob Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the project's first shared primitive: a `Knob` component (pure math in `src/utils/knob.ts`, controlled inline-SVG component in `src/components/ui/Knob.tsx`) with pointer-drag (dual-axis with axis commit, Shift fine control), keyboard/ARIA (`role="slider"`), three indicator modes (`progress` / `none` / `full`), and an optional detent tick — then migrate the VCF Filter panel in `SynthView.tsx` (3 sliders: cutoff, resonance, env) to it.

**Architecture:** All value math lives in pure, unit-tested functions in `src/utils/knob.ts` operating in a normalized "t" space (t ∈ [0,1] maps linearly onto the 270° knob sweep; value↔t mapping is linear or log). The React component `Knob` renders an inline `<svg viewBox="0 0 100 100">` (border ring + progress arc / thin ring / full ring per `indicator`, optional detent tick, rotating needle, center dot, label/value row) and translates pointer/keyboard input back through those pure functions. Controlled-only: `value`/`onChange`. No new dependencies, no hidden input, no motion library.

**Tech Stack:** React 18 + TypeScript (`tsc --noEmit` via `bun run lint`), Tailwind v4 (arbitrary-value classes only, no config edits), bun (`bun test`), express + Vite dev server on port 3000 (`bun run dev`).

**Spec:** docs/superpowers/specs/2026-08-23-knob-primitive-design.md

## Global Constraints

- No new dependencies — pure TS + React + existing Tailwind utilities only.
- `bun test` runs unit tests (repo convention: `bun:test` describe/test style, co-located `src/utils/*.test.ts`). `bun run lint` = `tsc --noEmit`. `tsconfig` is non-strict (`strict: false`), so unused destructured props do NOT fail the build.
- Dev server: `bun run dev` → http://localhost:3000 (express + Vite middleware; the synth tab is `?tab=synth`).
- Tailwind v4 arbitrary-value classes (`text-[#877dca]`, `bg-[#252B48]`) — no config changes.
- `Knob` is controlled-only (no uncontrolled mode, no hidden input). No scroll-wheel adjustment, no double-click reset (YAGNI per spec §4.4).
- One commit per task, on a new branch `feat/knob-primitive` (created in Task 1 step 1).
- Fixed conventions (do not re-litigate): `aria-label` = the `label` prop (no separate aria prop in `KnobProps`); drag axis commit threshold 3 px; drag "right = increase, up = increase"; progress arc uses butt caps so the arc tip lands exactly on the needle; the static indicator notch sits at the 3 o'clock position (from the Figma border reference); no rotation CSS transition (CSS transitions do not animate the SVG `transform` attribute and per-frame tweening during a pointer drag adds lag — spec §5's "CSS transition พอ" is permissive, not prescriptive).
- Indicator/detent conventions (spec §3/§5, fixed): `indicator` default `'progress'` (dark 270° ring + accent arc tracking the needle); `'none'` = thin uniform full ring (`#252B48`, 2 px) and NO arc; `'full'` = full-circle static thick ring (`currentColor`, 10 px — the same stroke as the progress arc), no dasharray. The `detent` tick is a short radial line on the ring at `angleForT(valueToT(detent, ...))`, drawn only when the value is inside `[min, max]` (inclusive) and INDEPENDENT of `indicator`; it is visual only — it never snaps the value. Tick style (spec leaves it open): slate-400 `#94a3b8`, 3 px, round caps, spanning r=36 → r=49 so it reads on both the dark ring and the accent arc.
- The Figma border SVG is reference material only (downloaded to `/tmp/knob-border.svg`, never committed).

## Spec coverage map

| Spec section                                                                                                        | Task                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------- |
| §3 API (KnobProps incl. `indicator`/`detent`, knob.ts pure functions incl. `detentAngle`)                           | 1, 2, 3             |
| §4.1 drag (capture, axis pick, 200 px range, Shift ÷10)                                                             | 4                   |
| §4.2 mapping (linear/log, 270° arc, angleForT)                                                                      | 1                   |
| §4.3 keyboard/ARIA (role=slider, arrows, PageUp/Down, Home/End, focus ring, disabled)                               | 5                   |
| §5 rendering (ring + notch + indicator modes + progress arc invariant + detent tick + needle + sizes + label/value) | 3 (verified in 4/5) |
| §6 testing (bun test on pure functions incl. `detentAngle`; tsc + browser for component)                            | 1, 2, 3–6           |
| §7 migration (Filter panel: cutoff log, resonance/env linear; defaults keep panel identical)                        | 6                   |

---

### Task 1: Pure knob math — constants, clamp, snap, mapping, angle, dash, drag, detent (TDD)

**Files**

- Create `src/utils/knob.ts` (implementation)
- Create `src/utils/knob.test.ts` (tests)

**Interfaces**

Consumes: nothing (new module).

Produces — `src/utils/knob.ts` must export exactly these (JSDoc above each, matching the `musicTheory.ts` convention):

```ts
export type KnobScale = "linear" | "log";
export type KnobSize = "xs" | "sm" | "md" | "lg" | "xl";
export type KnobIndicator = "progress" | "none" | "full";
export const MIN_ANGLE_DEG = -135; // needle angle at t=0 (7:30)
export const SWEEP_DEG = 270; // full rotation sweep
export const DRAG_RANGE_PX = 200; // full range per 200px drag
export const FINE_DRAG_DIVISOR = 10; // Shift = ÷10
export const AXIS_PICK_THRESHOLD_PX = 3; // axis-commit threshold
export const PROGRESS_ARC_UNITS = 75; // 270/360 × pathLength 100
export const SIZE_PX: Record<KnobSize, number>; // xs:22 sm:36 md:48 lg:60 xl:72

export function clamp(value: number, min: number, max: number): number;
export function snapToStep(value: number, min: number, step?: number): number;
export function valueToT(
  value: number,
  min: number,
  max: number,
  scale: KnobScale,
): number;
export function tToValue(
  t: number,
  min: number,
  max: number,
  scale: KnobScale,
): number;
export function angleForT(t: number): number; // MIN_ANGLE_DEG + t * SWEEP_DEG
export function detentAngle(
  detent: number,
  min: number,
  max: number,
  scale: KnobScale,
): number | null;
export function progressDash(t: number): number; // t * PROGRESS_ARC_UNITS
export function dragDeltaT(deltaPx: number, fine: boolean): number; // (deltaPx/DRAG_RANGE_PX) / (fine ? FINE_DRAG_DIVISOR : 1)
```

(`KeyDir` + `nextKeyValue` arrive in Task 2.)

Behavior (from spec §4.2/§5, implement exactly):

- log mapping: `value = min * (max/min)^t`, inverse `t = ln(value/min) / ln(max/min)`; if `min <= 0`, BOTH `valueToT` and `tToValue` fall back to linear.
- `snapToStep` quantizes relative to `min` (`min + round((v-min)/step)*step`); no-op when `step` is undefined/0/negative.
- Both mappers clamp their input (`value` into `[min,max]`, `t` into `[0,1]`); guard `max <= min` → t = 0.
- `detentAngle` = `angleForT(valueToT(detent, min, max, scale))`; returns `null` when `detent` is outside `[min, max]` (inclusive bounds — a detent exactly at min or max IS drawn).

Steps:

- [ ] 1. Create the feature branch and commit this plan document first (the repo tracks `docs/superpowers/plans/` — see `2026-08-22-bass-module.md`):

  ```bash
  git checkout -b feat/knob-primitive
  git add docs/superpowers/plans/2026-08-23-knob-primitive.md
  git commit -m "docs: add knob primitive implementation plan

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

- [ ] 2. Write `src/utils/knob.test.ts` — the FULL failing test file (bun style, matching `musicTheory.test.ts` — `import { describe, expect, test } from 'bun:test'`):

```ts
import { describe, expect, test } from "bun:test";
import {
  MIN_ANGLE_DEG,
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  SWEEP_DEG,
  angleForT,
  clamp,
  detentAngle,
  dragDeltaT,
  progressDash,
  snapToStep,
  tToValue,
  valueToT,
} from "./knob";

describe("clamp", () => {
  test("clamps below min", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  test("clamps above max", () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });

  test("returns in-range values unchanged", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("snapToStep", () => {
  test("rounds to the nearest multiple of step", () => {
    expect(snapToStep(17, 0, 10)).toBe(20);
    expect(snapToStep(13, 0, 10)).toBe(10);
  });

  test("measures from min, not from zero", () => {
    expect(snapToStep(12, 5, 2)).toBe(13);
  });

  test("is a no-op without a step (undefined or 0)", () => {
    expect(snapToStep(17, 0)).toBe(17);
    expect(snapToStep(17, 0, 0)).toBe(17);
  });
});

describe("linear valueToT / tToValue", () => {
  test("maps endpoints", () => {
    expect(valueToT(0, 0, 1, "linear")).toBe(0);
    expect(valueToT(1, 0, 1, "linear")).toBe(1);
    expect(tToValue(0, 0, 1, "linear")).toBe(0);
    expect(tToValue(1, 0, 1, "linear")).toBe(1);
  });

  test("roundtrips value → t → value", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(tToValue(valueToT(v, 0, 1, "linear"), 0, 1, "linear")).toBeCloseTo(
        v,
        10,
      );
    }
  });

  test("clamps out-of-range values", () => {
    expect(valueToT(-100, 0, 1, "linear")).toBe(0);
    expect(valueToT(100, 0, 1, "linear")).toBe(1);
  });
});

describe("log valueToT / tToValue", () => {
  const min = 50;
  const max = 12000;

  test("maps endpoints logarithmically", () => {
    expect(valueToT(50, min, max, "log")).toBe(0);
    expect(valueToT(12000, min, max, "log")).toBe(1);
    expect(tToValue(0, min, max, "log")).toBe(50);
    expect(tToValue(1, min, max, "log")).toBe(12000);
  });

  test("t = 0.5 lands on the geometric mean", () => {
    expect(tToValue(0.5, min, max, "log")).toBeCloseTo(Math.sqrt(min * max), 6);
  });

  test("roundtrips value → t → value", () => {
    for (const v of [50, 100, 1000, 5000, 12000]) {
      expect(
        tToValue(valueToT(v, min, max, "log"), min, max, "log"),
      ).toBeCloseTo(v, 6);
    }
  });

  test("equal frequency ratios span equal t distances (log spacing)", () => {
    const low = valueToT(200, min, max, "log") - valueToT(100, min, max, "log");
    const high =
      valueToT(12000, min, max, "log") - valueToT(6000, min, max, "log");
    expect(low).toBeCloseTo(high, 10);
  });
});

describe("log mapping falls back to linear when min <= 0", () => {
  test("min = 0 behaves linearly", () => {
    expect(valueToT(0.5, 0, 1, "log")).toBe(0.5);
    expect(tToValue(0.25, 0, 1, "log")).toBe(0.25);
  });

  test("negative min behaves linearly", () => {
    expect(valueToT(-5, -10, 10, "log")).toBe(0.25);
    expect(tToValue(0.75, -10, 10, "log")).toBe(5);
  });
});

describe("angleForT", () => {
  test("maps t to the 270° sweep (0 → 7:30, 0.5 → 12 o’clock, 1 → 4:30)", () => {
    expect(angleForT(0)).toBe(-135);
    expect(angleForT(0.5)).toBe(0);
    expect(angleForT(1)).toBe(135);
  });

  test("sweep span equals SWEEP_DEG", () => {
    expect(angleForT(1) - angleForT(0)).toBe(SWEEP_DEG);
  });
});

describe("progressDash", () => {
  test("maps t to arc units on a pathLength=100 circle", () => {
    expect(progressDash(0)).toBe(0);
    expect(progressDash(0.5)).toBe(37.5);
    expect(progressDash(1)).toBe(PROGRESS_ARC_UNITS);
  });

  test("needle angle and arc length derive from the same t (invariant)", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const arcTipAngle =
        MIN_ANGLE_DEG + (progressDash(t) / PROGRESS_ARC_UNITS) * SWEEP_DEG;
      expect(arcTipAngle).toBe(angleForT(t));
    }
  });
});

describe("detentAngle", () => {
  test("returns the needle angle for an in-range detent", () => {
    expect(detentAngle(0, 0, 1, "linear")).toBe(angleForT(0));
    expect(detentAngle(0.5, 0, 1, "linear")).toBe(angleForT(0.5));
    expect(detentAngle(1, 0, 1, "linear")).toBe(angleForT(1));
  });

  test("returns null for detents below min or above max", () => {
    expect(detentAngle(-0.1, 0, 1, "linear")).toBeNull();
    expect(detentAngle(1.1, 0, 1, "linear")).toBeNull();
    expect(detentAngle(49, 50, 12000, "log")).toBeNull();
    expect(detentAngle(12001, 50, 12000, "log")).toBeNull();
  });

  test("maps log detents through the log curve (geometric mean → 12 o’clock)", () => {
    const mid = Math.sqrt(50 * 12000);
    expect(detentAngle(mid, 50, 12000, "log")).toBeCloseTo(angleForT(0.5), 9);
  });

  test("boundary detents at exactly min/max are drawn (inclusive bounds)", () => {
    expect(detentAngle(50, 50, 12000, "log")).toBe(-135);
    expect(detentAngle(12000, 50, 12000, "log")).toBe(135);
  });
});

describe("dragDeltaT", () => {
  test("full range per DRAG_RANGE_PX", () => {
    expect(dragDeltaT(DRAG_RANGE_PX, false)).toBe(1);
    expect(dragDeltaT(100, false)).toBe(0.5);
  });

  test("shift divides sensitivity by FINE_DRAG_DIVISOR", () => {
    expect(dragDeltaT(100, true)).toBe(0.05);
  });
});

describe("SIZE_PX", () => {
  test("exposes the five Figma sizes", () => {
    expect(SIZE_PX).toEqual({ xs: 22, sm: 36, md: 48, lg: 60, xl: 72 });
  });
});
```

- [ ] 3. Run it — EXPECTED FAIL (module `./knob` does not exist yet):
  ```bash
  bun test src/utils/knob.test.ts
  ```
- [ ] 4. Write `src/utils/knob.ts` (full implementation):

```ts
/**
 * Pure math helpers for the Knob component.
 * Everything is expressed in "t" space: t ∈ [0, 1] maps linearly onto the
 * knob sweep (0 = min at 7:30, 1 = max at 4:30, 0.5 = 12 o'clock).
 */

export type KnobScale = "linear" | "log";
export type KnobSize = "xs" | "sm" | "md" | "lg" | "xl";
export type KnobIndicator = "progress" | "none" | "full";

/** Needle angle (degrees) when t = 0 → the 7:30 position. */
export const MIN_ANGLE_DEG = -135;
/** Full rotation sweep in degrees (7:30 → 4:30 through 12 o'clock). */
export const SWEEP_DEG = 270;
/** Pointer drag distance (px) that covers the full range. */
export const DRAG_RANGE_PX = 200;
/** Shift+drag divides drag sensitivity by this factor (fine control). */
export const FINE_DRAG_DIVISOR = 10;
/** Accumulated |delta| (px) before the drag axis is committed (anti-jitter). */
export const AXIS_PICK_THRESHOLD_PX = 3;
/** Progress arc length at t=1 on a pathLength=100 circle: 270/360 × 100. */
export const PROGRESS_ARC_UNITS = 75;
/** Pixel footprint per size, from the Figma design. */
export const SIZE_PX: Record<KnobSize, number> = {
  xs: 22,
  sm: 36,
  md: 48,
  lg: 60,
  xl: 72,
};

/**
 * Clamps value into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Quantizes value to the nearest multiple of step, measured from min.
 * No-op when step is undefined, 0, or negative.
 */
export function snapToStep(value: number, min: number, step?: number): number {
  if (!step || step <= 0) return value;
  return min + Math.round((value - min) / step) * step;
}

/**
 * Maps a value in [min, max] to t ∈ [0, 1].
 * log: t = ln(value/min) / ln(max/min); falls back to linear when min <= 0.
 */
export function valueToT(
  value: number,
  min: number,
  max: number,
  scale: KnobScale,
): number {
  if (max <= min) return 0;
  const v = clamp(value, min, max);
  if (scale === "log" && min > 0) {
    return Math.log(v / min) / Math.log(max / min);
  }
  return (v - min) / (max - min);
}

/**
 * Maps t ∈ [0, 1] back to a value in [min, max].
 * log: value = min · (max/min)^t; falls back to linear when min <= 0.
 */
export function tToValue(
  t: number,
  min: number,
  max: number,
  scale: KnobScale,
): number {
  const tt = clamp(t, 0, 1);
  if (scale === "log" && min > 0) {
    return min * Math.pow(max / min, tt);
  }
  return min + tt * (max - min);
}

/**
 * Needle rotation angle (degrees) for t: MIN_ANGLE_DEG + t · SWEEP_DEG.
 * t=0 → −135° (7:30), t=0.5 → 0° (12 o'clock), t=1 → +135° (4:30).
 */
export function angleForT(t: number): number {
  return MIN_ANGLE_DEG + t * SWEEP_DEG;
}

/**
 * Needle angle (degrees) of a detent value — i.e. angleForT(valueToT(...)) —
 * or null when the detent lies outside [min, max] (no tick drawn).
 * Visual only: this never snaps values.
 */
export function detentAngle(
  detent: number,
  min: number,
  max: number,
  scale: KnobScale,
): number | null {
  if (detent < min || detent > max) return null;
  return angleForT(valueToT(detent, min, max, scale));
}

/**
 * Progress arc length in pathLength=100 units for t (0 → 0, 1 → 75).
 * Shares t with angleForT, so the arc tip always points at the needle.
 */
export function progressDash(t: number): number {
  return t * PROGRESS_ARC_UNITS;
}

/**
 * t-space delta for a pointer drag: deltaPx / DRAG_RANGE_PX, further divided
 * by FINE_DRAG_DIVISOR when fine (Shift held).
 */
export function dragDeltaT(deltaPx: number, fine: boolean): number {
  const base = deltaPx / DRAG_RANGE_PX;
  return fine ? base / FINE_DRAG_DIVISOR : base;
}
```

- [ ] 5. Run the test again — EXPECTED PASS:
  ```bash
  bun test src/utils/knob.test.ts
  ```
- [ ] 6. Typecheck + full suite sanity:
  ```bash
  bun run lint
  bun test
  ```
- [ ] 7. Commit:

  ```bash
  git add src/utils/knob.ts src/utils/knob.test.ts
  git commit -m "feat: add knob math utilities (clamp, snap, mapping, angle, dash, drag, detent)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

### Task 2: Keyboard step navigation — `KeyDir` + `nextKeyValue` (TDD)

**Files**

- Modify `src/utils/knob.test.ts` (add tests)
- Modify `src/utils/knob.ts` (add exports)

**Interfaces**

Consumes: existing `clamp`, `snapToStep` from the same module.

Produces (added to `src/utils/knob.ts`):

```ts
export type KeyDir = "inc" | "dec" | "page-inc" | "page-dec" | "min" | "max";
export function nextKeyValue(
  value: number,
  min: number,
  max: number,
  step: number | undefined,
  dir: KeyDir,
): number;
```

Behavior (spec §4.3, exactly): inc/dec = ±1 step (continuous step → 1% of range); page = ±10 steps (or 10% of range if continuous); min/max = the bounds exactly (returned as-is, no snap — so Home/End always reach the bounds even when the range is not a multiple of `step`). Other results are snapped (when stepped) then clamped to `[min, max]`.

Steps:

- [ ] 1. Append to `src/utils/knob.test.ts` — update the import to include `nextKeyValue` and append this describe block at the end of the file:

```ts
import {
  MIN_ANGLE_DEG,
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  SWEEP_DEG,
  angleForT,
  clamp,
  detentAngle,
  dragDeltaT,
  nextKeyValue,
  progressDash,
  snapToStep,
  tToValue,
  valueToT,
} from "./knob";
```

```ts
describe("nextKeyValue", () => {
  test("inc/dec move by one step", () => {
    expect(nextKeyValue(0, 0, 1, 0.1, "inc")).toBe(0.1);
    expect(nextKeyValue(0.5, 0, 1, 0.1, "dec")).toBe(0.4);
  });

  test("continuous step moves by 1% of the range", () => {
    expect(nextKeyValue(0.5, 0, 1, undefined, "inc")).toBeCloseTo(0.51, 10);
    expect(nextKeyValue(0.5, 0, 1, undefined, "dec")).toBeCloseTo(0.49, 10);
  });

  test("page keys move by 10 steps", () => {
    expect(nextKeyValue(0, 0, 1, 0.01, "page-inc")).toBe(0.1);
    expect(nextKeyValue(0.5, 0, 1, 0.01, "page-dec")).toBe(0.4);
  });

  test("continuous page moves by 10% of the range", () => {
    expect(nextKeyValue(0.25, 0, 1, undefined, "page-inc")).toBeCloseTo(
      0.35,
      10,
    );
  });

  test("Home/End jump to the bounds exactly, even off the step grid", () => {
    expect(nextKeyValue(0.5, 0, 1, 0.3, "min")).toBe(0);
    expect(nextKeyValue(0.5, 0, 1, 0.3, "max")).toBe(1);
  });

  test("clamps at the bounds", () => {
    expect(nextKeyValue(0.99, 0, 1, 0.1, "inc")).toBe(1);
    expect(nextKeyValue(0.01, 0, 1, 0.1, "dec")).toBe(0);
  });

  test("snaps stepped results onto the min-anchored grid", () => {
    expect(nextKeyValue(50, 50, 12000, 10, "inc")).toBe(60);
    expect(nextKeyValue(12000, 50, 12000, 10, "dec")).toBe(11990);
  });

  test("continuous ranges with non-zero min use 1% of the range", () => {
    expect(nextKeyValue(0.5, -1, 1, undefined, "inc")).toBeCloseTo(0.52, 10);
  });
});
```

- [ ] 2. Run — EXPECTED FAIL (`nextKeyValue` is not exported from `./knob`):
  ```bash
  bun test src/utils/knob.test.ts
  ```
- [ ] 3. Append to the end of `src/utils/knob.ts`:

```ts
export type KeyDir = "inc" | "dec" | "page-inc" | "page-dec" | "min" | "max";

/**
 * Next value for keyboard navigation.
 * inc/dec: ±1 step (continuous → 1% of range); page: ±10 steps (or 10% of
 * range when continuous); min/max: the bounds exactly. Stepped results are
 * snapped to the min-anchored grid, then clamped to [min, max].
 */
export function nextKeyValue(
  value: number,
  min: number,
  max: number,
  step: number | undefined,
  dir: KeyDir,
): number {
  const hasStep = typeof step === "number" && step > 0;
  const singleStep = hasStep ? (step as number) : (max - min) * 0.01;
  const pageStep = hasStep ? (step as number) * 10 : (max - min) * 0.1;
  let next = value;
  switch (dir) {
    case "inc":
      next = value + singleStep;
      break;
    case "dec":
      next = value - singleStep;
      break;
    case "page-inc":
      next = value + pageStep;
      break;
    case "page-dec":
      next = value - pageStep;
      break;
    case "min":
      return min;
    case "max":
      return max;
  }
  return clamp(snapToStep(next, min, step), min, max);
}
```

- [ ] 4. Run — EXPECTED PASS:
  ```bash
  bun test src/utils/knob.test.ts
  ```
- [ ] 5. Typecheck + full suite sanity:
  ```bash
  bun run lint
  bun test
  ```
- [ ] 6. Commit:

  ```bash
  git add src/utils/knob.ts src/utils/knob.test.ts
  git commit -m "feat: add keyboard step navigation for knobs (nextKeyValue)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

### Task 3: `Knob` component — static render (ring modes, detent tick, needle, label row)

**Files**

- Create `src/components/ui/Knob.tsx` (directory does not exist yet — create it)
- Temporarily modify `src/components/SynthView.tsx` (demo mount for browser verification; removed before commit)

**Interfaces**

Consumes from `../../utils/knob`: `PROGRESS_ARC_UNITS`, `SIZE_PX`, `angleForT`, `clamp`, `detentAngle`, `progressDash`, `tToValue`, `valueToT` and types `KnobIndicator`, `KnobScale`, `KnobSize`. (`KeyDir`/`nextKeyValue` and the drag helpers are consumed starting Task 5/4.)

Produces — `src/components/ui/Knob.tsx`:

```ts
export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number; // default 0
  max?: number; // default 1
  step?: number; // default: continuous (no snap)
  scale?: KnobScale; // default 'linear'
  size?: KnobSize; // default 'md'
  label?: string;
  format?: (v: number) => string; // default String(v)
  indicator?: KnobIndicator; // default 'progress' — arc follows the needle
  detent?: number; // tick angle; undefined = no tick (visual only, never snaps)
  disabled?: boolean;
  id?: string;
  className?: string;
}
export const Knob: (props: KnobProps) => JSX.Element;
```

Rendering reference — Figma border SVG (`curl -sL -o /tmp/knob-border.svg "https://www.figma.com/api/mcp/asset/54376c1a-bedb-4259-9ab6-bea27b0b8299.svg"`, viewBox 50×50, NEVER committed, reference only). Its notch layout, adopted 1:1:

- **Ring arc**: from the 7 o'clock position (14,44) up over the top (25,3) to the 5 o'clock position (36,44), round caps, white 50% (we render it dark `#252B48` to match the app's card borders on the `#12152A` panel face). Spec §4.2 defines the sweep as exactly 270° (7:30→4:30), which we follow — the Figma's 240° arc endpoints are only a visual reference. The Figma ring stroke is the default 1 (→ 2 in 100-space): that thin ring is what `indicator="none"` uses.
- **Indicator notch**: exactly ONE static tick line at the 3 o'clock position, from just inside the ring (41,25.5) to the ring's outer edge (47,25.5) — doubled into 100-space as `x1="82" y1="51" x2="94" y2="51"`. Rendered in ALL indicator modes.
- **Progress arc**: partial arc in `#877DCA`, thick stroke (5/50 = 10/100); in our build the progress arc must use butt caps (NOT round) so the dash end lands exactly on the needle tip (round caps would extend the visible arc ~6.5° past the needle, breaking the spec §5 invariant).
- The knob face itself is transparent (shows the panel background); no fill circle.

Indicator/detent render rules (spec §3/§5, exactly):

- `indicator="progress"` (default): dark 270° ring (dasharray `75 25`, round caps) + progress arc (`currentColor`, dash = `progressDash(t)`, butt caps).
- `indicator="none"`: NO progress arc; a single thin uniform FULL circle, `stroke="#252B48"` `strokeWidth="2"` (the Figma ring thickness). Used for balance/pan knobs, e.g. `<Knob indicator="none" detent={0} min={-1} max={1}>`.
- `indicator="full"`: a full-circle static thick ring, `stroke="currentColor"` `strokeWidth="10"` (same stroke as the progress arc), no dasharray, no rotate — the value is not drawn onto it.
- Detent tick: drawn whenever `detentAngle(detent, min, max, scale)` is non-null, INDEPENDENT of `indicator`: a short radial line on the ring at that angle, from r=36 to r=49, `stroke="#94a3b8"` (slate-400 — visible against both the dark ring and the accent arc), `strokeWidth="3"`, round caps. Visual only — it never snaps the value. Implemented as a rotated group around (50,50) so the angle needs no trig in the component.

Steps:

- [ ] 1. Create the directory and the component:
  ```bash
  mkdir -p src/components/ui
  ```
  Write `src/components/ui/Knob.tsx` (static render only — pointer handlers arrive in Task 4, keyboard/ARIA in Task 5; the props are typed up front but only rendered/consumed where used; `tsconfig` is non-strict so unused destructured props do not fail `bun run lint`):

```tsx
import React from "react";
import {
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  angleForT,
  clamp,
  detentAngle,
  progressDash,
  tToValue,
  valueToT,
} from "../../utils/knob";
import type { KnobIndicator, KnobScale, KnobSize } from "../../utils/knob";

export type { KnobIndicator, KnobScale, KnobSize };

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: KnobScale;
  size?: KnobSize;
  label?: string;
  format?: (v: number) => string;
  indicator?: KnobIndicator;
  detent?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Shared rotary knob primitive. Controlled-only (value/onChange).
 * Static render: ring per `indicator` ('progress' arc / 'none' thin ring /
 * 'full' static ring) + optional detent tick + rotating needle + center dot
 * + label/value row. Pointer drag (Task 4) and keyboard/ARIA (Task 5) are
 * layered on top. The needle and the progress-arc tip are both derived from
 * the same t, so they always point in the same direction (spec §5).
 */
export const Knob = ({
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  scale = "linear",
  size = "md",
  label,
  format = String,
  indicator = "progress",
  detent,
  disabled = false,
  id,
  className,
}: KnobProps) => {
  const pixelSize = SIZE_PX[size];
  const t = clamp(valueToT(value, min, max, scale), 0, 1);
  const angle = angleForT(t);
  const dash = progressDash(t);
  const display = format(value);
  const detentAngleDeg =
    detent !== undefined ? detentAngle(detent, min, max, scale) : null;

  return (
    <div className={className}>
      {label !== undefined && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400 font-medium">{label}</span>
          <span className="font-mono text-indigo-300">{display}</span>
        </div>
      )}
      <svg
        id={id}
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 100 100"
        className={`block text-[#877dca] touch-none select-none rounded-full ${
          disabled ? "opacity-40" : "cursor-pointer"
        }`}
      >
        {/* indicator="progress": dark 270° ring (same thickness as the arc,
            spec §5) + progress arc from min (−135°) to the current angle. */}
        {indicator === "progress" && (
          <>
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="#252B48"
              strokeWidth="10"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${PROGRESS_ARC_UNITS} ${100 - PROGRESS_ARC_UNITS}`}
              transform="rotate(-135 50 50)"
            />
            {/* Butt caps keep the arc tip exactly on the needle. */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              pathLength={100}
              strokeDasharray={`${dash} ${100 - dash}`}
              transform="rotate(-135 50 50)"
            />
          </>
        )}
        {/* indicator="none": thin uniform full ring, no arc (pan/balance). */}
        {indicator === "none" && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#252B48"
            strokeWidth="2"
          />
        )}
        {/* indicator="full": full-circle static thick ring, no dasharray. */}
        {indicator === "full" && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
          />
        )}
        {/* Static indicator notch at 3 o'clock, per the Figma border reference. */}
        <line
          x1="82"
          y1="51"
          x2="94"
          y2="51"
          stroke="#252B48"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Detent tick — short radial line on the ring at the detent angle;
            drawn only when the detent is inside [min, max]; visual only. */}
        {detentAngleDeg !== null && (
          <g transform={`rotate(${detentAngleDeg} 50 50)`}>
            <line
              x1="50"
              y1="14"
              x2="50"
              y2="1"
              stroke="#94a3b8"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        )}
        {/* Needle — rotates around the knob center; same t as the arc tip. */}
        <g transform={`rotate(${angle} 50 50)`}>
          <rect
            x="46"
            y="16"
            width="8"
            height="36"
            rx="4"
            fill="currentColor"
          />
          <circle cx="50" cy="50" r="10" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
};
```

- [ ] 2. Typecheck:
  ```bash
  bun run lint
  ```
  Expected: no errors (only the new file; the rest of the repo must stay clean too).
- [ ] 3. Add a temporary demo mount to `src/components/SynthView.tsx` for browser verification. Add the import right after the existing `import { SynthPresetLibrary } from "./SynthPresetLibrary";` line (this file uses double quotes):
  ```tsx
  import { Knob } from "./ui/Knob";
  ```
  Insert this block directly after the opening `<div className="p-4 max-w-7xl mx-auto space-y-4">` line:
  ```tsx
  {
    /* TEMP demo mount — remove before commit */
  }
  <div className="flex flex-wrap items-end gap-6 bg-[#0B0D19] p-3 rounded-lg border border-[#252B48]">
    <Knob value={0} label="Min" />
    <Knob value={0.5} label="Mid" />
    <Knob value={1} label="Max" />
    <Knob value={0} label="Pan" indicator="none" detent={0} min={-1} max={1} />
    <Knob value={0.5} label="Full" indicator="full" />
    <Knob value={0.4} label="Detent" detent={0.4} />
    <Knob value={0.25} label="Tiny" size="xs" />
    <Knob value={0.75} label="Big Disabled" size="xl" disabled />
  </div>;
  ```
- [ ] 4. Browser check:
  ```bash
  # Terminal 1 — start the dev server
  bun run dev
  # Terminal 2 — open the synth tab
  open "http://localhost:3000/?tab=synth"
  ```
  Look for, at the top of the page:
  - "Min" (needle at 7:30, no visible progress arc), "Mid" (needle at 12 o'clock, arc half-swept), "Max" (needle at 4:30, full arc) — default `'progress'` mode: dark `#252B48` ring, needle/arc/center dot in the `#877dca` purple, arc tip exactly at the needle.
  - "Pan" (`indicator="none"`): thin uniform FULL ring (2 px), NO progress arc, and a slate-400 detent tick at 12 o'clock (detent 0 = center of the −1..1 range); label row shows "Pan" / "0".
  - "Full" (`indicator="full"`): a complete thick accent-colored ring (no arc, no dash gap).
  - "Detent" (progress mode, `detent={0.4}`): progress arc PLUS a slate-400 tick exactly under the needle (value === detent → same angle).
  - "Tiny" (22 px, xs), "Big Disabled" (72 px, xl, 40% opacity, `cursor-not-allowed`).
  - Static 3 o'clock notch present on every knob, all modes.
  - Label row above each knob: left label `text-slate-400`, right value `font-mono text-indigo-300`.
  - DevTools → Elements: `<svg viewBox="0 0 100 100" width="48" height="48">` for the default `md` size; `width`/`height` change with `size` (22/36/48/60/72).
- [ ] 5. Remove the TEMP demo block from `SynthView.tsx` (keep the `import { Knob } from "./ui/Knob";` line — Task 6 uses it for the real migration). Re-run:
  ```bash
  bun run lint
  ```
- [ ] 6. Commit:

  ```bash
  git add src/components/ui/Knob.tsx
  git commit -m "feat: add Knob primitive static render (ring modes, detent tick, needle, label)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

### Task 4: Pointer drag interaction on `Knob`

**Files**

- Modify `src/components/ui/Knob.tsx`
- Temporarily modify `src/components/SynthView.tsx` (demo mount; removed before commit)

**Interfaces**

Consumes (new imports from `../../utils/knob`): `AXIS_PICK_THRESHOLD_PX`, `DRAG_RANGE_PX`, `FINE_DRAG_DIVISOR`, `dragDeltaT`, `snapToStep` (plus the Task 3 imports, incl. `detentAngle`). Behavior, exactly per spec §4.1:

- `pointerdown` → `e.preventDefault()` + `setPointerCapture(e.pointerId)` (drag continues outside the element) → snapshot `{ axis: null, startT, startX, startY }` in a ref (survives re-renders mid-gesture; `startT` is computed from the CURRENT `value` at gesture start, so the drag never drifts even with controlled updates).
- Axis commit: while `axis === null`, require |dx| or |dy| ≥ `AXIS_PICK_THRESHOLD_PX`; the axis with the larger accumulated distance wins and STICKS for the whole gesture (spec §4.1 "ยึดแกนนั้นจนจบ gesture").
- Per move: `delta = axis === 'x' ? dx : -dy` (right = increase, up = increase); `t = clamp(startT + dragDeltaT(delta, e.shiftKey), 0, 1)` — `e.shiftKey` is read live, so Shift can be pressed/released mid-gesture; `onChange(snapToStep(tToValue(t, min, max, scale), min, step))`.
- `pointerup`/`pointercancel` → clear the ref.
- The detent tick is a fixed-angle decoration: dragging never snaps to it, and it does not move with the needle.

Steps:

- [ ] 1. Rewrite `src/components/ui/Knob.tsx` with the full listing below (static render + drag; keyboard/ARIA arrive in Task 5):

```tsx
import React, { useRef } from "react";
import {
  AXIS_PICK_THRESHOLD_PX,
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  angleForT,
  clamp,
  detentAngle,
  dragDeltaT,
  progressDash,
  snapToStep,
  tToValue,
  valueToT,
} from "../../utils/knob";
import type { KnobIndicator, KnobScale, KnobSize } from "../../utils/knob";

export type { KnobIndicator, KnobScale, KnobSize };

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: KnobScale;
  size?: KnobSize;
  label?: string;
  format?: (v: number) => string;
  indicator?: KnobIndicator;
  detent?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Per-gesture drag state (a ref — survives re-renders mid-drag). */
interface GestureState {
  axis: "x" | "y" | null;
  startT: number;
  startX: number;
  startY: number;
}

/**
 * Shared rotary knob primitive. Controlled-only (value/onChange).
 * Drag: pointer capture; the axis with the larger accumulated delta wins
 * (past AXIS_PICK_THRESHOLD_PX) and sticks for the whole gesture. Right/up
 * increase, left/down decrease; Shift divides sensitivity by 10. Ring per
 * `indicator` + optional fixed detent tick (visual only). The needle and the
 * progress-arc tip are derived from the same t (spec §5 invariant).
 */
export const Knob = ({
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  scale = "linear",
  size = "md",
  label,
  format = String,
  indicator = "progress",
  detent,
  disabled = false,
  id,
  className,
}: KnobProps) => {
  const gestureRef = useRef<GestureState | null>(null);
  const pixelSize = SIZE_PX[size];
  const t = clamp(valueToT(value, min, max, scale), 0, 1);
  const angle = angleForT(t);
  const dash = progressDash(t);
  const display = format(value);
  const detentAngleDeg =
    detent !== undefined ? detentAngle(detent, min, max, scale) : null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = {
      axis: null,
      startT: clamp(valueToT(value, min, max, scale), 0, 1),
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (disabled || !gesture) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.axis === null) {
      if (
        Math.abs(dx) < AXIS_PICK_THRESHOLD_PX &&
        Math.abs(dy) < AXIS_PICK_THRESHOLD_PX
      ) {
        return;
      }
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    const delta = gesture.axis === "x" ? dx : -dy;
    const nextT = clamp(gesture.startT + dragDeltaT(delta, e.shiftKey), 0, 1);
    onChange(snapToStep(tToValue(nextT, min, max, scale), min, step));
  };

  const endGesture = () => {
    gestureRef.current = null;
  };

  return (
    <div className={className}>
      {label !== undefined && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400 font-medium">{label}</span>
          <span className="font-mono text-indigo-300">{display}</span>
        </div>
      )}
      <svg
        id={id}
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 100 100"
        className={`block text-[#877dca] touch-none select-none rounded-full ${
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        {/* indicator="progress": dark 270° ring (same thickness as the arc,
            spec §5) + progress arc from min (−135°) to the current angle. */}
        {indicator === "progress" && (
          <>
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="#252B48"
              strokeWidth="10"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${PROGRESS_ARC_UNITS} ${100 - PROGRESS_ARC_UNITS}`}
              transform="rotate(-135 50 50)"
            />
            {/* Butt caps keep the arc tip exactly on the needle. */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              pathLength={100}
              strokeDasharray={`${dash} ${100 - dash}`}
              transform="rotate(-135 50 50)"
            />
          </>
        )}
        {/* indicator="none": thin uniform full ring, no arc (pan/balance). */}
        {indicator === "none" && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#252B48"
            strokeWidth="2"
          />
        )}
        {/* indicator="full": full-circle static thick ring, no dasharray. */}
        {indicator === "full" && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
          />
        )}
        {/* Static indicator notch at 3 o'clock, per the Figma border reference. */}
        <line
          x1="82"
          y1="51"
          x2="94"
          y2="51"
          stroke="#252B48"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Detent tick — short radial line on the ring at the detent angle;
            drawn only when the detent is inside [min, max]; visual only. */}
        {detentAngleDeg !== null && (
          <g transform={`rotate(${detentAngleDeg} 50 50)`}>
            <line
              x1="50"
              y1="14"
              x2="50"
              y2="1"
              stroke="#94a3b8"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        )}
        {/* Needle — rotates around the knob center; same t as the arc tip. */}
        <g transform={`rotate(${angle} 50 50)`}>
          <rect
            x="46"
            y="16"
            width="8"
            height="36"
            rx="4"
            fill="currentColor"
          />
          <circle cx="50" cy="50" r="10" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
};
```

- [ ] 2. Typecheck:
  ```bash
  bun run lint
  ```
- [ ] 3. Re-add the temporary demo mount to `src/components/SynthView.tsx` (same import already present; insert right after the opening `<div className="p-4 max-w-7xl mx-auto space-y-4">` line):
  ```tsx
  {
    /* TEMP demo mount — remove before commit */
  }
  <div className="flex flex-wrap items-end gap-6 bg-[#0B0D19] p-3 rounded-lg border border-[#252B48]">
    <Knob value={0} label="Min" />
    <Knob value={0.5} label="Mid" />
    <Knob value={1} label="Max" />
    <Knob value={0} label="Pan" indicator="none" detent={0} min={-1} max={1} />
    <Knob value={0.5} label="Full" indicator="full" />
    <Knob value={0.4} label="Detent" detent={0.4} />
    <Knob value={0.25} label="Tiny" size="xs" />
    <Knob value={0.75} label="Big Disabled" size="xl" disabled />
  </div>;
  ```
- [ ] 4. Browser check (dev server: `bun run dev`; open `http://localhost:3000/?tab=synth`):
  - Drag the "Mid" knob right → value rises above 0.5; drag left → falls below; drag up → rises; drag down → falls. The value label, needle, and arc tip all update together (arc tip stays exactly on the needle — the spec §5 invariant).
  - Jitter test: press down on a knob and wiggle less than 3 px → value does NOT change; then commit to a dominant direction and the OTHER axis is ignored for the rest of that gesture (drag right, then curve the pointer straight up — the value keeps following x).
  - Shift+drag → roughly 10× finer changes than plain drag.
  - Drag ~200 px from one end → value clamps at the bound (label shows 0 or 1); dragging back in the other direction returns from where the gesture started (no jump).
  - Drag beyond the browser window edge — the knob keeps tracking (pointer capture works).
  - Drag the "Detent" knob — the slate-400 tick STAYS at its fixed angle while the needle/arc move away from it (the tick never snaps the value; it is a fixed decoration).
  - Drag "Pan" — the value clamps in [−1, 1]; at 0 the needle sits at 12 o'clock and the tick is under it.
  - Disabled knob: press-and-drag does nothing.
- [ ] 5. Remove the TEMP demo block (keep the import). Re-run:
  ```bash
  bun run lint
  ```
- [ ] 6. Commit:

  ```bash
  git add src/components/ui/Knob.tsx
  git commit -m "feat: add pointer drag interaction to Knob (axis pick, fine control)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

### Task 5: Keyboard + ARIA on `Knob`

**Files**

- Modify `src/components/ui/Knob.tsx`
- Temporarily modify `src/components/SynthView.tsx` (demo mount; removed before commit)

**Interfaces**

Consumes (new import): `nextKeyValue` + type `KeyDir` from `../../utils/knob` (plus the Task 3/4 imports, incl. `detentAngle`/`KnobIndicator`). Behavior, exactly per spec §4.3:

- `role="slider"`, `aria-valuemin={min}`, `aria-valuemax={max}`, `aria-valuenow={display}` (the formatted value string), `aria-disabled={disabled}`.
- `aria-label` = the `label` prop (convention fixed in Global Constraints — no separate aria prop; all production usages pass `label`).
- `tabIndex={disabled ? -1 : 0}` (disabled knobs leave the tab order).
- `onKeyDown` mapping: ArrowUp/ArrowRight → `'inc'`, ArrowDown/ArrowLeft → `'dec'`, PageUp → `'page-inc'`, PageDown → `'page-dec'`, Home → `'min'`, End → `'max'`; unhandled keys return without `preventDefault`; handled keys call `e.preventDefault()` (stops page scroll on PageUp/PageDown) then `onChange(nextKeyValue(value, min, max, step, dir))`.
- Focus ring: `focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400/70` on the svg (Tailwind v4 — no config change).
- `disabled` blocks both pointer and keyboard handlers.
- No interaction conflict: the window-level piano-keyboard listener in `SynthView` maps QWERTY `e.code` values only, so arrow/page/home/end keys on a focused knob never trigger piano notes (no extra wiring needed).

Steps:

- [ ] 1. Rewrite `src/components/ui/Knob.tsx` with the full listing below (Task 4 code + keyboard/ARIA):

```tsx
import React, { useRef } from "react";
import {
  AXIS_PICK_THRESHOLD_PX,
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  angleForT,
  clamp,
  detentAngle,
  dragDeltaT,
  nextKeyValue,
  progressDash,
  snapToStep,
  tToValue,
  valueToT,
} from "../../utils/knob";
import type {
  KeyDir,
  KnobIndicator,
  KnobScale,
  KnobSize,
} from "../../utils/knob";

export type { KnobIndicator, KnobScale, KnobSize };

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: KnobScale;
  size?: KnobSize;
  label?: string;
  format?: (v: number) => string;
  indicator?: KnobIndicator;
  detent?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Per-gesture drag state (a ref — survives re-renders mid-drag). */
interface GestureState {
  axis: "x" | "y" | null;
  startT: number;
  startX: number;
  startY: number;
}

/**
 * Shared rotary knob primitive. Controlled-only (value/onChange).
 * Drag: pointer capture; the axis with the larger accumulated delta wins
 * (past AXIS_PICK_THRESHOLD_PX) and sticks for the whole gesture. Right/up
 * increase, left/down decrease; Shift divides sensitivity by 10.
 * Keyboard: role="slider" with arrows/page/Home/End (spec §4.3). Ring per
 * `indicator` + optional fixed detent tick (visual only). The needle and the
 * progress-arc tip are derived from the same t (spec §5 invariant).
 */
export const Knob = ({
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  scale = "linear",
  size = "md",
  label,
  format = String,
  indicator = "progress",
  detent,
  disabled = false,
  id,
  className,
}: KnobProps) => {
  const gestureRef = useRef<GestureState | null>(null);
  const pixelSize = SIZE_PX[size];
  const t = clamp(valueToT(value, min, max, scale), 0, 1);
  const angle = angleForT(t);
  const dash = progressDash(t);
  const display = format(value);
  const detentAngleDeg =
    detent !== undefined ? detentAngle(detent, min, max, scale) : null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = {
      axis: null,
      startT: clamp(valueToT(value, min, max, scale), 0, 1),
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (disabled || !gesture) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.axis === null) {
      if (
        Math.abs(dx) < AXIS_PICK_THRESHOLD_PX &&
        Math.abs(dy) < AXIS_PICK_THRESHOLD_PX
      ) {
        return;
      }
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    const delta = gesture.axis === "x" ? dx : -dy;
    const nextT = clamp(gesture.startT + dragDeltaT(delta, e.shiftKey), 0, 1);
    onChange(snapToStep(tToValue(nextT, min, max, scale), min, step));
  };

  const endGesture = () => {
    gestureRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    let dir: KeyDir | null = null;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        dir = "inc";
        break;
      case "ArrowDown":
      case "ArrowLeft":
        dir = "dec";
        break;
      case "PageUp":
        dir = "page-inc";
        break;
      case "PageDown":
        dir = "page-dec";
        break;
      case "Home":
        dir = "min";
        break;
      case "End":
        dir = "max";
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(nextKeyValue(value, min, max, step, dir));
  };

  return (
    <div className={className}>
      {label !== undefined && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400 font-medium">{label}</span>
          <span className="font-mono text-indigo-300">{display}</span>
        </div>
      )}
      <svg
        id={id}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={display}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 100 100"
        className={`block text-[#877dca] touch-none select-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400/70 ${
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onKeyDown={handleKeyDown}
      >
        {/* indicator="progress": dark 270° ring (same thickness as the arc,
            spec §5) + progress arc from min (−135°) to the current angle. */}
        {indicator === "progress" && (
          <>
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="#252B48"
              strokeWidth="10"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${PROGRESS_ARC_UNITS} ${100 - PROGRESS_ARC_UNITS}`}
              transform="rotate(-135 50 50)"
            />
            {/* Butt caps keep the arc tip exactly on the needle. */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              pathLength={100}
              strokeDasharray={`${dash} ${100 - dash}`}
              transform="rotate(-135 50 50)"
            />
          </>
        )}
        {/* indicator="none": thin uniform full ring, no arc (pan/balance). */}
        {indicator === "none" && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#252B48"
            strokeWidth="2"
          />
        )}
        {/* indicator="full": full-circle static thick ring, no dasharray. */}
        {indicator === "full" && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
          />
        )}
        {/* Static indicator notch at 3 o'clock, per the Figma border reference. */}
        <line
          x1="82"
          y1="51"
          x2="94"
          y2="51"
          stroke="#252B48"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Detent tick — short radial line on the ring at the detent angle;
            drawn only when the detent is inside [min, max]; visual only. */}
        {detentAngleDeg !== null && (
          <g transform={`rotate(${detentAngleDeg} 50 50)`}>
            <line
              x1="50"
              y1="14"
              x2="50"
              y2="1"
              stroke="#94a3b8"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        )}
        {/* Needle — rotates around the knob center; same t as the arc tip. */}
        <g transform={`rotate(${angle} 50 50)`}>
          <rect
            x="46"
            y="16"
            width="8"
            height="36"
            rx="4"
            fill="currentColor"
          />
          <circle cx="50" cy="50" r="10" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
};
```

- [ ] 2. Typecheck:
  ```bash
  bun run lint
  ```
- [ ] 3. Re-add the temporary demo mount to `src/components/SynthView.tsx` (same import already present; insert right after the opening `<div className="p-4 max-w-7xl mx-auto space-y-4">` line):
  ```tsx
  {
    /* TEMP demo mount — remove before commit */
  }
  <div className="flex flex-wrap items-end gap-6 bg-[#0B0D19] p-3 rounded-lg border border-[#252B48]">
    <Knob value={0} label="Min" />
    <Knob value={0.5} label="Mid" />
    <Knob value={1} label="Max" />
    <Knob value={0} label="Pan" indicator="none" detent={0} min={-1} max={1} />
    <Knob value={0.5} label="Full" indicator="full" />
    <Knob value={0.4} label="Detent" detent={0.4} />
    <Knob value={0.25} label="Tiny" size="xs" />
    <Knob value={0.75} label="Big Disabled" size="xl" disabled />
  </div>;
  ```
- [ ] 4. Browser check (dev server: `bun run dev`; open `http://localhost:3000/?tab=synth`):
  - Tab repeatedly — the focus ring (`focus-visible` indigo outline) appears on each knob; the disabled knob is skipped. Note: focus lands on other page controls first — keep Tab-pressing until a knob rings; or click a knob once, then Tab/Shift+Tab moves between knobs.
  - With the "Mid" knob focused: ArrowUp and ArrowRight each increase the value by 1% of range (0.5 → 0.51 → 0.52…); ArrowDown/ArrowLeft decrease; PageUp/PageDown jump ±10% of range; Home → value shows 0 and needle at 7:30; End → value shows 1 and needle at 4:30.
  - With the "Pan" knob focused: arrows move by 1% of the 2-unit range (0.02); Home/End clamp at −1 and 1 — the detent tick never snaps the value (End lands at 1, not 0).
  - PageUp/PageDown do NOT scroll the page (preventDefault works).
  - Arrow keys on a focused knob do NOT play piano notes (the QWERTY piano listener ignores non-letter codes).
  - DevTools → Elements, select a knob svg: `role="slider"`, `aria-label` = its label, `aria-valuemin="0"`, `aria-valuemax="1"`, `aria-valuenow` = the formatted value, `tabindex="0"`; the disabled knob has `aria-disabled="true"` and `tabindex="-1"`.
  - The keyboard updates the value label, needle, and arc tip together (same invariant as drag).
- [ ] 5. Remove the TEMP demo block (keep the import). Re-run:
  ```bash
  bun run lint
  ```
- [ ] 6. Commit:

  ```bash
  git add src/components/ui/Knob.tsx
  git commit -m "feat: add keyboard + ARIA support to Knob (slider semantics)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

### Task 6: Migrate the VCF Filter panel in `SynthView.tsx`

**Files**

- Modify `src/components/SynthView.tsx` (import + replace the 3 filter sliders)

**Interfaces**

Consumes: `Knob` from `./ui/Knob` (import already present since Task 3). Produces: the same three DOM ids (`slider-filter-cutoff`, `slider-filter-resonance`, `slider-filter-env`) on the new knobs — verified: no other file references these ids, so renaming risk is zero.

Migration decisions (from the current file, lines 670-740, and spec §7):

- `filter-cutoff`: current `min={50}` is already > 0, so `scale="log"` is valid as-is — NO min change needed (spec §3's "min > 0 for log" holds with 50; the "use 20 as min" branch from the task brief does NOT apply — min 50 is intentional and preserved).
- `filter-resonance`: linear, min 0.1 / max 20 / step 0.1.
- `filter-env`: linear, min 0 / max 6000 / step 50.
- Value formats preserved exactly: `Math.round(v) Hz` (cutoff), `v.toFixed(1)` (resonance), `+Math.round(v) Hz` (env).
- NO `indicator` or `detent` props are passed — the `'progress'` default with no detent renders exactly what Tasks 3-5 verified, so the Filter panel behavior is unchanged by the new props (spec §7: defaults keep the panel identical).
- Known visual change, intended per spec §5: the Knob renders its own label row, so the value color changes from the panel's `text-pink-300` to the Knob's `font-mono text-indigo-300`; the left label gains `font-medium`. The layout (flex row, text-xs, mb-1) is identical to the sliders it replaces.
- The knobs are left-aligned within the panel; the label row spans the panel width exactly like the old slider label rows — the panel keeps its shape.

Steps:

- [ ] 1. Add the import to `src/components/SynthView.tsx` right after the existing `import { SynthPresetLibrary } from "./SynthPresetLibrary";` line (if it is not already there from Tasks 3-5):
  ```tsx
  import { Knob } from "./ui/Knob";
  ```
- [ ] 2. Replace the three filter slider blocks. The current code (verbatim, from the "2. VCF Filter" panel):

```tsx
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Cutoff Frequency</span>
              <span className="font-mono text-pink-300">
                {Math.round(params.filterCutoff)} Hz
              </span>
            </div>
            <input
              id="slider-filter-cutoff"
              type="range"
              min={50}
              max={12000}
              step={10}
              value={params.filterCutoff}
              onChange={(e) =>
                onChangeParams({
                  ...params,
                  filterCutoff: parseFloat(e.target.value),
                })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-pink-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Resonance (Q)</span>
              <span className="font-mono text-pink-300">
                {params.filterResonance.toFixed(1)}
              </span>
            </div>
            <input
              id="slider-filter-resonance"
              type="range"
              min={0.1}
              max={20}
              step={0.1}
              value={params.filterResonance}
              onChange={(e) =>
                onChangeParams({
                  ...params,
                  filterResonance: parseFloat(e.target.value),
                })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-pink-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Env Mod Depth</span>
              <span className="font-mono text-pink-300">
                +{Math.round(params.filterEnvAmount)} Hz
              </span>
            </div>
            <input
              id="slider-filter-env"
              type="range"
              min={0}
              max={6000}
              step={50}
              value={params.filterEnvAmount}
              onChange={(e) =>
                onChangeParams({
                  ...params,
                  filterEnvAmount: parseFloat(e.target.value),
                })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-pink-500"
            />
          </div>
```

Replace all three with:

```tsx
          <Knob
            id="slider-filter-cutoff"
            label="Cutoff Frequency"
            value={params.filterCutoff}
            min={50}
            max={12000}
            step={10}
            scale="log"
            format={(v) => `${Math.round(v)} Hz`}
            onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
          />

          <Knob
            id="slider-filter-resonance"
            label="Resonance (Q)"
            value={params.filterResonance}
            min={0.1}
            max={20}
            step={0.1}
            scale="linear"
            format={(v) => v.toFixed(1)}
            onChange={(v) => onChangeParams({ ...params, filterResonance: v })}
          />

          <Knob
            id="slider-filter-env"
            label="Env Mod Depth"
            value={params.filterEnvAmount}
            min={0}
            max={6000}
            step={50}
            scale="linear"
            format={(v) => `+${Math.round(v)} Hz`}
            onChange={(v) => onChangeParams({ ...params, filterEnvAmount: v })}
          />
```

- [ ] 3. Typecheck + full suite:
  ```bash
  bun run lint
  bun test
  ```
- [ ] 4. Browser verification (dev server: `bun run dev`; open `http://localhost:3000/?tab=synth`):
  - The "2. VCF Filter" panel shows three knobs (Cutoff Frequency, Resonance (Q), Env Mod Depth) with the panel's three other controls (Filter Type buttons) unchanged. Panel layout intact; knob label rows align with the rest of the panel.
  - DevTools console — the ids are preserved:
    ```js
    document.getElementById("slider-filter-cutoff") !== null &&
      document.getElementById("slider-filter-resonance") !== null &&
      document.getElementById("slider-filter-env") !== null;
    // → true
    ```
  - Values display exactly like before: cutoff shows e.g. `500 Hz` (preset-dependent), resonance `1.0`, env `+0 Hz`.
  - Log mapping demo (spec §7): drag the cutoff knob from its min by ~100 px → the value reads ≈ 775 Hz (the geometric mean of 50 and 12000), NOT ~6000 Hz — i.e. low frequencies change slowly per pixel and high frequencies fast. Then drag to the max — the needle hits 4:30 and the value clamps at 12000 Hz.
  - Keyboard on a filter knob: ArrowUp on cutoff +10 Hz (step 10), PageUp +100 Hz, Home → 50 Hz, End → 12000 Hz; resonance arrows move 0.1.
  - Drag + Shift-drag on all three knobs; values clamp at min/max; the arc tip tracks the needle throughout.
  - Audition: click a piano key, then drag cutoff/resonance — the sound changes accordingly (audio engine already receives `params` via the store; no engine change needed).
  - Switch the Control destination to Chord/Bass — the filter knobs reflect the chord/bass params (the panel is channel-routed via `params`/`onChangeParams`; knob values are fully controlled, so no action needed, just a visual sanity check).
  - Load a preset from the dropdown — the filter knobs jump to the preset's values (controlled update path verified).
- [ ] 5. Commit:

  ```bash
  git add src/components/SynthView.tsx
  git commit -m "feat: migrate VCF Filter sliders to the Knob primitive

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

## Completion checklist

- [ ] `bun test` green (knob.test.ts covers: clamp, snap, linear/log mapping + fallback, angleForT, detentAngle (in-range / out-of-range null / log case / inclusive bounds), progressDash + invariant, dragDeltaT, SIZE_PX, nextKeyValue).
- [ ] `bun run lint` green.
- [ ] `git log --oneline` shows exactly 7 commits on `feat/knob-primitive` (1 plan-doc commit + 6 task commits, one per task).
- [ ] No TEMP demo mount remains in `SynthView.tsx`; `/tmp/knob-border.svg` is not in the repo (`git status` clean).
- [ ] Filter panel knobs verified in the browser per Task 6 step 4.
