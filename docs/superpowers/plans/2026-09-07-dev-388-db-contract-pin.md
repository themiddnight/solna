# DEV-388: Pin the dB level contract for murva import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `.solna` body say, in its own format definition, that its level keys are dB — with a named unity, range, silence encoding, an interop boundary version defined as the version by which the LAST level key converted, and an explicit warning about the mixed-unit versions below it — and make a test with hard-coded numbers fail the moment solna's copied dB constants drift from murva's.

**Architecture:** Two artefacts, no new runtime behaviour. First, `src/utils/gainContract.test.ts` — a pinning test that imports the copied modules (`gainUnits`, `meterZones`, `meterScale`, DEV-387's `trimMath`) and asserts **literal numbers** against them, every expectation commented with the murva file it mirrors; a formula can drift without a named constant changing, so the taper and the piecewise meter scale are pinned at their breakpoints too. Second, the `PROJECT_FORMAT_VERSION` docblock in `src/store/projectFormat.ts` grows a dB-level-contract section in the existing per-version history style, backed by an exported `DB_LEVELS_FORMAT_VERSION` — **the version at which the LAST level key became dB, not the first** — plus `PROJECT_DB_LEVEL_VERSIONS` (key → the version that converted it) and `PROJECT_DB_LEVEL_KEYS` derived from it, and by a test that reads the source file and fails if the prose stops naming them.

**Tech Stack:** TypeScript, `bun:test`, `node:fs` (source-text assertion only — the precedent is `src/data/dataLayerPurity.test.ts`, which already lints source files through eslint's API from inside a test).

**Spec:** Linear DEV-388; shared contract at `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`

## Global Constraints

- **Decision taken: copy + pinning test, never a shared package.** Two repos, two git roots, ~90 lines of pure arithmetic. Do not plan, propose or start an extraction. Revisit only if a third consumer appears.
- **The pinning test asserts literal numbers.** Never `expect(UNITY_DB).toBe(UNITY_DB)`, never re-derive an expectation from an imported constant, never compute one from another import. Editing a constant must make a hard-coded expectation wrong.
- `UNITY_DB = 0`, `UNITY_GAIN = 1`, `DISPLAY_FLOOR_DBFS = -60`, `DEFAULT_UNITY_POS = 0.75`, fader range `-60 .. +12` dB (`FADER_MAX_DB = 12`).
- `SILENCE_DB = -60` in solna and `-Infinity` in murva. This is contract divergence 2 and is **deliberate**: `JSON.stringify(-Infinity)` is `null` and solna's values cross `JSON.stringify` twice. Pin the divergence, do not "align" it.
- `ZONE_TOO_QUIET_MAX = -24`, `ZONE_GOOD_MAX = -6`, `ZONE_HOT_MAX = -1`.
- `METER_SCALE_CEILING_DBFS = 6`, `METER_TICK_DBFS = [-24, -6, 0]`; scale is piecewise `<=-60 → 0`, `-60..-48 → 0..5`, `-48..-24 → 5..30`, `-24..+6 → 30..100`.
- `TARGET_DBFS = -18`, `TOLERANCE_DB = 3`.
- **This issue touches the body contract only.** Do not bump `PROJECT_FORMAT_VERSION` and do not bump the persist `version`. DEV-386 already bumped both; this issue *names* the numbers DEV-386 landed. The two chains stay separate and the persist migration chain is never used to read a project body.
- **DEV-386 bumps the body format THREE times, one per unit change: 7 → 8 → 9 → 10.** v8 converts `masterVolume`, v9 the five bus faders, v10 `sequencerTracks[].volume`. So **v8 and v9 are mixed-unit versions** — some level keys dB, the rest still linear gain — and the interop boundary is **10**, the version at which the last one converted. `MAX_FADER_GAIN` in `gainUnits.ts` is a DEV-386 addition too and is pinned here (Task 1, Step 2) by its derivation rather than its value.
- **DEV-386 Task 3 Step 8 already writes a "LEVELS IN A PROJECT BODY ARE DECIBELS" block above `PROJECT_FORMAT_VERSION`, and it lands at v8 — when the statement is not yet true.** Task 4 **replaces** that block rather than adding a second one beside it. Leaving both would leave the file asserting the whole contract twice, once correctly and once from the middle of the migration chain.
- **Do not edit `migrateProjectBody`'s existing guards.** A version stamped into persisted data is a contract; this issue documents one, it does not redefine one.
- `bun run verify` is the gate and `bun run eslint` must report **nothing at all** — no errors and no warnings.
- No DOM, no testing-library. `bun:test` only (`.claude/rules/testing.md`).

---

## File Structure

```
src/utils/gainContract.test.ts        CREATE  the pinning test (Tasks 1-2)
src/utils/gainUnits.ts                MODIFY  murva-origin header (Task 3)
src/utils/meterZones.ts               MODIFY  murva-origin header (Task 3)
src/utils/meterScale.ts               MODIFY  murva-origin header (Task 3)
<trimMath path resolved in Task 1>    MODIFY  murva-origin header (Task 3)
src/store/projectFormat.ts            MODIFY  dB level contract docblock + 3 exports (Task 4)
src/store/projectFormat.test.ts       MODIFY  doc-rot test (Task 4)
```

Nothing is created under `src/data/`, `src/audio/` or `src/components/`, so no layering rule is in play. `gainContract.test.ts` lives beside the modules it pins.

**Two values this plan cannot hard-code, and how Task 1 resolves them:**

1. **The interop boundary version.** It is **not** simply "what `PROJECT_FORMAT_VERSION` says at HEAD", and it is **not** "the version dB first landed". It is the version at which the **last** key in `PROJECT_DB_LEVEL_KEYS` became dB. On `main` at the time of writing the file reads `7`; DEV-386 bumps it three times (v8 `masterVolume`, v9 the bus faders, v10 `sequencerTracks[].volume`), so the boundary is **10** and every code block below is written with `10`. Task 1 Step 1 resolves it by reading the head version *and* walking `migrateProjectBody`, and asserting the two agree; **if they disagree, or if either differs from 10, use the resolved number everywhere in Task 4 instead.**
2. **DEV-387's `trimMath` path.** The DEV-383 contract's module surface names only `src/data/trimTable.ts` for DEV-387; the murva original is `src/engine/instruments/shared/calibration/trimMath.ts`. Every code block below imports from `../audio/calibration/trimMath`. Task 1 Step 1 greps the real path; **if it differs, use the grepped path everywhere.**

---

### Task 1: Pin the scalar constants against literal murva values

**Files:**
- Create: `src/utils/gainContract.test.ts`
- Test: `src/utils/gainContract.test.ts`

**Interfaces:**
- Consumes: `UNITY_DB: Decibels`, `UNITY_GAIN: LinearGain`, `SILENCE_DB: Decibels`, `DISPLAY_FLOOR_DBFS: number`, `FADER_MAX_DB: number`, `DEFAULT_UNITY_POS: number`, `MAX_FADER_GAIN: LinearGain`, `dbToGain: (db: Decibels) => LinearGain`, `toDecibels: (value: number) => Decibels` from `src/utils/gainUnits.ts`; `ZONE_TOO_QUIET_MAX: number`, `ZONE_GOOD_MAX: number`, `ZONE_HOT_MAX: number` from `src/utils/meterZones.ts`; `METER_SCALE_CEILING_DBFS: number`, `METER_TICK_DBFS: readonly number[]` from `src/utils/meterScale.ts`; `TARGET_DBFS: Dbfs`, `TOLERANCE_DB: number` from DEV-387's `trimMath`.
- Produces: `src/utils/gainContract.test.ts` with the `describe('pinned murva constants')` block.

- [ ] **Step 1: Resolve the two unknowns before writing anything**

Run, from the repo root:

```bash
git checkout -b feat/dev-388-db-contract-pin
# (a) the HEAD version — the top of the chain, NOT automatically the boundary
grep -n 'export const PROJECT_FORMAT_VERSION' src/store/projectFormat.ts
# (b) the chain itself — which step converts which level key, in order
grep -n 'fromVersion < ' src/store/projectFormatMigrate.ts
grep -n 'masterVolume\|synthVolume\|chordVolume\|bassVolume\|padVolume\|masterSequencerVolume\|sequencerTracks' src/store/projectFormatMigrate.ts
ls src/utils/gainUnits.ts src/utils/meterZones.ts src/utils/meterScale.ts
grep -rln 'TOLERANCE_DB' src/ --include='*.ts'
grep -n 'MAX_FADER_GAIN' src/utils/gainUnits.ts
```

**Why (a) alone is not enough, and why this step exists at all.** The head version is the top of the whole format chain, and level keys are only one of the things that chain carries. DEV-386 converts the seven level keys across three separate versions (v8 `masterVolume`, v9 the five bus faders, v10 `sequencerTracks[].volume`), so **v8 and v9 stamp bodies whose level keys are a MIXTURE of dB and linear gain**. Taking the head number would be right today by coincidence — 10 happens to be both the head and the last conversion — and wrong the moment any later issue bumps the format for a reason that has nothing to do with levels (a new drum voice, a lead reshape). The boundary an importer needs is **the version at which the last level key converted**, so it is read off the migration chain and merely *checked* against the head.

Expected: (a) prints `10`; (b) prints the guard ladder ending at `if (fromVersion < 10) next = upgradeTrackVolumesDbV10(next);`, and the second grep shows `upgradeMasterVolumeDbV8` touching `masterVolume`, `upgradeBusFadersDbV9` the five bus keys, and `upgradeTrackVolumesDbV10` the per-track volumes. **Assert the two agree**: the highest guard that converts a level key must be `10`, and the head version must be `>= 10`. Write the resolved boundary down and substitute it into every `10` in Task 4.

Stop and re-plan, rather than guessing, if any of these hold:

- the highest level-converting guard is **below** the head version → later non-level bumps landed; the boundary is the guard, the head is not, and Task 4's prose must name both.
- the highest level-converting guard is **above** the head version → impossible; the chain and the stamp have desynchronised and that is a bug in DEV-386, not something this plan documents.
- a level key appears in **no** conversion step → DEV-386 is incomplete; a key still in linear gain must not be listed in `PROJECT_DB_LEVEL_KEYS`.

The `ls` lists all three files; the `TOLERANCE_DB` grep prints DEV-387's `trimMath` path (this plan assumes `src/audio/calibration/trimMath.ts`); the last grep prints `MAX_FADER_GAIN`'s definition, which must be a call to `dbToGain`, not a literal. If `gainUnits.ts` is missing, DEV-384 has not landed — stop, this issue is meaningless before it.

- [ ] **Step 2: Write the failing test**

Create `src/utils/gainContract.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_UNITY_POS,
  DISPLAY_FLOOR_DBFS,
  FADER_MAX_DB,
  MAX_FADER_GAIN,
  SILENCE_DB,
  UNITY_DB,
  UNITY_GAIN,
  dbToGain,
  toDecibels,
} from './gainUnits';
import { ZONE_GOOD_MAX, ZONE_HOT_MAX, ZONE_TOO_QUIET_MAX } from './meterZones';
import { METER_SCALE_CEILING_DBFS, METER_TICK_DBFS } from './meterScale';
import { TARGET_DBFS, TOLERANCE_DB } from '../audio/calibration/trimMath';

/**
 * The interop tripwire between solna and murva. These modules are COPIES, by
 * decision: two repos in two git roots, ~90 lines of pure arithmetic, and a
 * shared package would buy synchronisation at the price of a release process
 * and a version matrix in both. The price of the copy is that a constant can
 * move on one side in silence — projects would still import, just at the wrong
 * loudness — so this file is the thing that notices.
 *
 * Every expectation below is a LITERAL, with a comment naming the murva file it
 * mirrors. Never re-import a constant and compare it to itself: the whole value
 * here is that editing a constant makes a hard-coded number wrong, forcing a
 * human to decide whether murva is moving too.
 */
describe('pinned murva constants', () => {
  test('gainUnits scalars match murva src/shared/audio/gainUnits.ts', () => {
    expect(UNITY_DB).toBe(0); // murva gainUnits.ts: UNITY_DB
    expect(UNITY_GAIN).toBe(1); // murva gainUnits.ts: UNITY_GAIN
    expect(DISPLAY_FLOOR_DBFS).toBe(-60); // murva gainUnits.ts: DISPLAY_FLOOR_DBFS
    expect(DEFAULT_UNITY_POS).toBe(0.75); // murva gainUnits.ts: DEFAULT_UNITY_POS
  });

  test('the fader range is -60 .. +12 dB', () => {
    // murva gainUnits.ts: dbToSliderPos/sliderPosTodB default minDb = DISPLAY_FLOOR_DBFS,
    // maxDb = 12. Both ends pinned as literals so widening either is a visible edit.
    expect(DISPLAY_FLOOR_DBFS).toBe(-60);
    expect(FADER_MAX_DB).toBe(12);
  });

  test('MAX_FADER_GAIN stays DERIVED from the murva-owned fader top', () => {
    // The one deliberate inversion of this file's "never re-derive an
    // expectation from an import" rule, and the reason is that MAX_FADER_GAIN
    // is not a murva constant at all: murva's numbers table has no counterpart,
    // it is solna's own (DEV-386) linear ceiling for both engine clamps. Its
    // VALUE therefore cannot drift from murva independently — it can only move
    // if FADER_MAX_DB or dbToGain moves, and both are pinned as literals above,
    // so a second literal here would only fail twice for one cause.
    // What CAN drift in silence is the DERIVATION: replace the call with a
    // literal (a hand-restored 1.5, a rounded 4) and the ceiling detaches from
    // the fader range while FADER_MAX_DB still reads 12 and every literal pin
    // in this file still passes. Faders would show +12 dB and stop responding
    // partway, which is the exact dishonesty DEV-386 removed. So pin the
    // identity, not the number. DEV-386's src/utils/faderTaper.test.ts owns the
    // literal ~3.9810717; that is its pin to keep, not a duplicate to make here.
    expect(MAX_FADER_GAIN).toBe(dbToGain(toDecibels(FADER_MAX_DB)));
  });

  test('SILENCE_DB is a FINITE -60 here and -Infinity in murva (divergence 2)', () => {
    // Deliberate divergence, not drift: solna's levels cross JSON.stringify twice
    // (persist + the .solna body) and JSON.stringify(-Infinity) is null. -60 also
    // coincides with DISPLAY_FLOOR_DBFS, so the fader bottom and the silence value
    // are the same place. Do NOT "align" this with murva's -Infinity.
    expect(SILENCE_DB).toBe(-60);
    expect(Number.isFinite(SILENCE_DB)).toBe(true);
    expect(dbToGain(SILENCE_DB)).toBeCloseTo(0.001, 9); // 10 ** (-60 / 20), inaudible
  });

  test('meterZones boundaries match murva src/shared/audio/meterZones.ts', () => {
    expect(ZONE_TOO_QUIET_MAX).toBe(-24); // murva meterZones.ts: tooQuiet is < -24
    expect(ZONE_GOOD_MAX).toBe(-6); // murva meterZones.ts: good is -24 .. -6
    expect(ZONE_HOT_MAX).toBe(-1); // murva meterZones.ts: hot is -6 .. -1, over is >= -1
  });

  test('meterScale ceiling and ticks match murva src/shared/audio/meterScale.ts', () => {
    expect(METER_SCALE_CEILING_DBFS).toBe(6); // murva meterScale.ts: METER_SCALE_CEILING_DBFS
    expect([...METER_TICK_DBFS]).toEqual([-24, -6, 0]); // murva meterScale.ts: METER_TICK_DBFS
  });

  test('calibration target matches murva calibration/trimMath.ts', () => {
    expect(TARGET_DBFS).toBe(-18); // murva trimMath.ts: TARGET_DBFS
    expect(TOLERANCE_DB).toBe(3); // murva trimMath.ts: TOLERANCE_DB
  });
});
```

- [ ] **Step 3: Run the test and read what it says**

Run: `bun test src/utils/gainContract.test.ts`

Expected: PASS on every assertion if DEV-384/386/387 landed the contract values, since this task adds no implementation — it is a tripwire, not a feature, and a green first run is the correct outcome. If any line fails, e.g. `expect(DEFAULT_UNITY_POS).toBe(0.75)` reporting `Expected: 0.75  Received: 0.8`, **do not edit the expectation**: solna has already drifted from murva and the drift is the finding. Fix the constant in solna, or escalate that murva is moving.

- [ ] **Step 4: Prove the tripwire actually trips**

Run:

```bash
sed -i '' 's/export const DEFAULT_UNITY_POS = 0.75/export const DEFAULT_UNITY_POS = 0.8/' src/utils/gainUnits.ts
bun test src/utils/gainContract.test.ts -t "gainUnits scalars"
git checkout src/utils/gainUnits.ts
```

Expected: the middle command FAILS with `expect(received).toBe(expected)  Expected: 0.75  Received: 0.8`, and the third command restores the file. A pinning test that cannot be made to fail is decoration.

- [ ] **Step 5: Commit**

```bash
git add src/utils/gainContract.test.ts
git commit -m "$(cat <<'EOF'
test(gain): pin the murva dB constants with literal expectations

gainUnits.ts, meterZones.ts, meterScale.ts and trimMath.ts are copies of
murva's, by decision — two repos, two git roots, ~90 lines of arithmetic, and a
shared package costs a release process and a version matrix in both. The price
of the copy is silent drift: a moved constant still imports, just at the wrong
loudness. Every expectation here is a literal with the murva file it mirrors, so
editing a constant makes a hard-coded number wrong instead of nothing at all.

SILENCE_DB is pinned to a finite -60, and the test says why: murva's -Infinity
survives its Zod socket boundary, solna's values cross JSON.stringify twice.

MAX_FADER_GAIN is the one assertion here that is an identity rather than a
literal: it is solna's own constant, not murva's, so what matters is that it
stays dbToGain(FADER_MAX_DB) — a literal ceiling would detach the engine clamp
from the fader range with every other pin in this file still green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 2: Pin the taper and the piecewise meter scale at their breakpoints

**Files:**
- Modify: `src/utils/gainContract.test.ts` (append after the `describe('pinned murva constants')` block)
- Test: `src/utils/gainContract.test.ts`

**Interfaces:**
- Consumes: `dbToSliderPos: (db: number, minDb?: number, maxDb?: number, unityPos?: number) => number`, `sliderPosTodB: (pos: number, minDb?: number, maxDb?: number, unityPos?: number) => Decibels`, `clampForDisplay: (value: number, floor?: number) => number` from `src/utils/gainUnits.ts`; `dbfsToPercent: (dbfs: number) => number` from `src/utils/meterScale.ts`; `classifyZone: (peakDbfs: number) => MeterZone` from `src/utils/meterZones.ts`.
- Produces: the `describe('pinned murva behaviour')` block in the same file.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/gainContract.test.ts`, and extend the two existing import statements to add `clampForDisplay, dbToSliderPos, sliderPosTodB` from `./gainUnits`, `classifyZone` from `./meterZones`, and `dbfsToPercent` from `./meterScale`:

```ts
/**
 * A formula drifts without any named constant changing: the meter scale's
 * interior breakpoints (-48 dBFS, 5%, 30%) are module-private in murva and
 * likely private here too, and the taper's two segments are arithmetic with no
 * constant of their own. So the behaviour is pinned at the points where a
 * reshape shows up, again as literals.
 */
describe('pinned murva behaviour', () => {
  test('dbfsToPercent draws murva meterScale.ts three segments', () => {
    // murva meterScale.ts: <=-60 -> 0, -60..-48 -> 0..5, -48..-24 -> 5..30, -24..+6 -> 30..100
    expect(dbfsToPercent(-60)).toBe(0); // the floor
    expect(dbfsToPercent(-48)).toBeCloseTo(5, 9); // first knee
    expect(dbfsToPercent(-24)).toBeCloseTo(30, 9); // second knee
    expect(dbfsToPercent(0)).toBeCloseTo(86, 9); // digital ceiling, interpolated
    expect(dbfsToPercent(6)).toBe(100); // METER_SCALE_CEILING_DBFS
  });

  test('dbfsToPercent interpolates linearly inside each segment', () => {
    // Midpoints. A single linear -60..0 mapping would put -36 at 40 and -6 at 90;
    // these three numbers are what make the scale piecewise rather than straight.
    expect(dbfsToPercent(-54)).toBeCloseTo(2.5, 9); // half of -60..-48
    expect(dbfsToPercent(-36)).toBeCloseTo(17.5, 9); // half of -48..-24
    expect(dbfsToPercent(-6)).toBeCloseTo(72, 9); // 60% of -24..+6
  });

  test('dbfsToPercent saturates outside the track and survives -Infinity', () => {
    expect(dbfsToPercent(-100)).toBe(0);
    expect(dbfsToPercent(20)).toBe(100);
    expect(dbfsToPercent(-Infinity)).toBe(0); // a transient silent meter reading
    expect(dbfsToPercent(Infinity)).toBe(100);
  });

  test('the taper puts unity at 0.75 and holds murva gainUnits.ts endpoints', () => {
    expect(dbToSliderPos(0)).toBe(0.75); // 0 dB sits at DEFAULT_UNITY_POS
    expect(dbToSliderPos(-60)).toBe(0); // bottom of the fader
    expect(dbToSliderPos(12)).toBe(1); // top of the fader
    expect(dbToSliderPos(-30)).toBeCloseTo(0.375, 9); // half the lower segment
    expect(dbToSliderPos(-6)).toBeCloseTo(0.675, 9); // lower segment, linear in dB
    expect(dbToSliderPos(6)).toBeCloseTo(0.875, 9); // half the upper segment
  });

  test('sliderPosTodB is the taper read backwards', () => {
    expect(sliderPosTodB(0)).toBe(-60);
    expect(sliderPosTodB(0.75)).toBeCloseTo(0, 9);
    expect(sliderPosTodB(1)).toBe(12);
    expect(sliderPosTodB(0.375)).toBeCloseTo(-30, 9);
    expect(sliderPosTodB(0.875)).toBeCloseTo(6, 9);
  });

  test('the taper round-trips at the calibration target and either side of unity', () => {
    for (const db of [-60, -18, -6, 0, 6, 12]) {
      expect(sliderPosTodB(dbToSliderPos(db))).toBeCloseTo(db, 9);
    }
  });

  test('classifyZone splits on murva meterZones.ts boundaries, exclusive at the top', () => {
    expect(classifyZone(-25)).toBe('tooQuiet');
    expect(classifyZone(-24)).toBe('good'); // boundary belongs to the zone above
    expect(classifyZone(-7)).toBe('good');
    expect(classifyZone(-6)).toBe('hot');
    expect(classifyZone(-2)).toBe('hot');
    expect(classifyZone(-1)).toBe('over');
    expect(classifyZone(0)).toBe('over');
  });

  test('clampForDisplay lifts a silent reading to the display floor', () => {
    expect(clampForDisplay(-Infinity)).toBe(-60); // murva gainUnits.ts: clampForDisplay
    expect(clampForDisplay(-90)).toBe(-60);
    expect(clampForDisplay(-12)).toBe(-12);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test src/utils/gainContract.test.ts -t "pinned murva behaviour"`

Expected: PASS. If `dbfsToPercent(0)` reports anything other than ~86, solna's segment table has been reshaped away from murva's — fix `meterScale.ts`, never the expectation.

- [ ] **Step 3: Prove this half trips too**

Run:

```bash
sed -i '' 's/const METER_SCALE_FLOOR_DBFS = -48/const METER_SCALE_FLOOR_DBFS = -45/' src/utils/meterScale.ts
bun test src/utils/gainContract.test.ts -t "three segments"
git checkout src/utils/meterScale.ts
```

Expected: the middle command FAILS on `expect(dbfsToPercent(-48)).toBeCloseTo(5, 9)` — a breakpoint moved with no exported constant changing, which is exactly the case Task 1's scalar assertions cannot see.

- [ ] **Step 4: Commit**

```bash
git add src/utils/gainContract.test.ts
git commit -m "$(cat <<'EOF'
test(gain): pin the taper and meter scale at their breakpoints

The scalar pins in the previous commit cannot see a reshaped formula: the meter
scale's interior breakpoints (-48 dBFS, 5%, 30%) are module-private, and the
taper's two segments are arithmetic with no constant of their own. Pin the
observable behaviour instead — dbfsToPercent at -60/-48/-24/0/+6 and at three
midpoints, dbToSliderPos(0) === 0.75 with both endpoints, and a round trip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 3: Note the murva origin on every copied module

**Files:**
- Modify: `src/utils/gainUnits.ts` (top of file, above the first import or export)
- Modify: `src/utils/meterZones.ts` (top of file)
- Modify: `src/utils/meterScale.ts` (top of file)
- Modify: `src/audio/calibration/trimMath.ts` (top of file — use the path resolved in Task 1 Step 1)
- Test: `src/utils/gainContract.test.ts` (unchanged; it is what the notes point at)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing at runtime — four header comments.

- [ ] **Step 1: Add the header to `src/utils/gainUnits.ts`**

Insert as the first thing in the file, above any import:

```ts
/**
 * KEEP IN SYNC WITH MURVA — see murva `src/shared/audio/gainUnits.ts`.
 *
 * This is a copy, by decision (DEV-388): solna and murva are separate repos in
 * separate git roots, and a shared package would buy synchronisation at the
 * price of a release process, a version matrix and a build step in both, for
 * ~90 lines of pure arithmetic. `src/utils/gainContract.test.ts` is the
 * tripwire: it asserts every constant and both tapers as LITERAL numbers, so
 * editing anything here makes a hard-coded expectation wrong and forces a human
 * to decide whether murva is moving too. Do not satisfy that test by editing
 * its expectation.
 *
 * One value here is deliberately NOT murva's: `SILENCE_DB` is a finite -60,
 * because solna's levels cross JSON.stringify twice (persist and the .solna
 * body) and JSON.stringify(-Infinity) is null. See divergence 2 in
 * docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md.
 */
```

- [ ] **Step 2: Add the header to `src/utils/meterZones.ts`**

Insert as the first thing in the file:

```ts
/**
 * KEEP IN SYNC WITH MURVA — see murva `src/shared/audio/meterZones.ts`.
 *
 * A copy, by decision (DEV-388); `src/utils/gainContract.test.ts` pins these
 * three boundaries as literal numbers and pins `classifyZone`'s exclusive-at-
 * the-top behaviour. Moving a boundary must be a change a human approves in
 * both repos, not one that lands green on this side alone.
 */
```

- [ ] **Step 3: Add the header to `src/utils/meterScale.ts`**

Insert as the first thing in the file:

```ts
/**
 * KEEP IN SYNC WITH MURVA — see murva `src/shared/audio/meterScale.ts`.
 *
 * A copy, by decision (DEV-388). The interior breakpoints are module-private,
 * so `src/utils/gainContract.test.ts` pins the SHAPE through `dbfsToPercent` at
 * -60/-48/-24/0/+6 and at three midpoints — a segment can be reshaped without
 * any exported constant changing, and that is the drift this file is most
 * exposed to.
 */
```

- [ ] **Step 4: Add the header to the `trimMath` module**

Insert as the first thing in the file at the path resolved in Task 1 Step 1:

```ts
/**
 * KEEP IN SYNC WITH MURVA — see murva
 * `src/engine/instruments/shared/calibration/trimMath.ts`.
 *
 * A copy, by decision (DEV-388). `src/utils/gainContract.test.ts` pins
 * TARGET_DBFS to -18 and TOLERANCE_DB to 3 as literals. These two numbers are
 * the loudness a solna project is calibrated to; if they move on one side only,
 * a project still imports into murva and simply plays at the wrong level.
 */
```

- [ ] **Step 5: Verify nothing broke and commit**

Run: `bun test src/utils/gainContract.test.ts && bun run lint && bun run eslint`

Expected: tests PASS, `lint` silent, `eslint` prints **nothing at all**.

```bash
git add src/utils/gainUnits.ts src/utils/meterZones.ts src/utils/meterScale.ts src/audio/calibration/trimMath.ts
git commit -m "$(cat <<'EOF'
docs(gain): note the murva origin of the four copied dB modules

Each copied module now names the murva file it mirrors and points at
gainContract.test.ts, so someone editing a constant meets the reason it is
pinned before they meet the failing test. gainUnits.ts also records the one
deliberate divergence — a finite SILENCE_DB — so it does not read as drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 4: Document the dB level contract with the body's format definition

**Files:**
- Modify: `src/store/projectFormat.ts:10-31` (the `PROJECT_FORMAT_VERSION` docblock and the export beneath it — re-check the line numbers, DEV-386 will have edited this block)
- Modify: `src/store/projectFormat.test.ts` (append a `describe` block; extend the existing import from `./projectFormat`)
- Test: `src/store/projectFormat.test.ts`

**Interfaces:**
- Consumes: `PROJECT_FORMAT_VERSION: number` from `src/store/projectFormat.ts`.
- Produces, in `src/store/projectFormat.ts`: `export const PROJECT_DB_LEVEL_VERSIONS: Readonly<Record<string, number>>` (each level key → the `formatVersion` that converted it), `export const PROJECT_DB_LEVEL_KEYS: readonly string[]` (derived from it, so the key list has one source), and `export const DB_LEVELS_FORMAT_VERSION: number` (the interop boundary — the version at which the LAST key converted, `10` unless Task 1 Step 1 said otherwise).

The contract lives here and not in a loose doc because a loose doc rots on its own schedule; this docblock is already where the format's version history is written, and the three new exports make the boundary, the key list and each key's conversion version things code can read rather than prose a reader has to trust.

**Why a per-key version map and not just a key list.** The defect this task exists to avoid is a boundary that means "where dB started" instead of "where dB finished" — the phrasing that silently widens into a lie every time a level key converts later than the boundary says. A flat key list cannot see that: add a `leadVolume` at v11, list it, and the contract keeps claiming v10 covers everything with nothing failing. The map makes the definition executable — `DB_LEVELS_FORMAT_VERSION` must equal `Math.max(...)` of the map's values — so the v11 key either moves the boundary or turns the suite red. It is one extra `const` and three assertions, not machinery: no lookup is done at runtime, nothing imports it but the test and a future importer.

`DB_LEVELS_FORMAT_VERSION` stays a hand-written literal rather than being *defined* as that `Math.max`. Deriving it would keep it correct and silent — the boundary would move under an importer's feet while the prose beside it still said `v10`. A literal plus an equality assertion forces the human edit, and the doc-rot test then forces the prose to move with it.

- [ ] **Step 1: Write the failing test**

Append to `src/store/projectFormat.test.ts`, and add `DB_LEVELS_FORMAT_VERSION`, `PROJECT_DB_LEVEL_KEYS` and `PROJECT_DB_LEVEL_VERSIONS` to the existing `from './projectFormat'` import, plus `import { readFileSync } from 'node:fs';` at the top:

```ts
/**
 * The dB level contract is prose, and prose rots. It is pinned here the only
 * way prose can be: the test reads projectFormat.ts's own source and asserts
 * the contract block still names the boundary version, the mixed-unit versions
 * below it, the unit, the range, the silence encoding and every key it covers.
 * Reading a source file from a test is
 * established in this repo — src/data/dataLayerPurity.test.ts lints fixture
 * sources through eslint's own API for the same reason.
 */
describe('the dB level contract in the format docblock', () => {
  const source = readFileSync(new URL('./projectFormat.ts', import.meta.url), 'utf8');
  // Anchored on the section's OWN heading line (hence the `m` flag), not on a
  // phrase appearing anywhere in the file. A lazy
  // /\/\*\*[^]*?dB LEVEL CONTRACT[^]*?\*\// matches leftmost-first: it would
  // start at the file's very first docblock and swallow every comment in
  // between, so an assertion like toContain('-60') could be satisfied by
  // unrelated prose several blocks away.
  const block = source.match(/^ \* dB LEVEL CONTRACT[^]*?\*\//m)?.[0] ?? '';

  test('the contract block exists', () => {
    expect(block.length).toBeGreaterThan(0);
  });

  test('the boundary is where the LAST level key became dB, not the first', () => {
    expect(DB_LEVELS_FORMAT_VERSION).toBe(10);
    expect(block).toContain(`v${DB_LEVELS_FORMAT_VERSION}`);
    // THE assertion this whole export exists for. The boundary is the version
    // by which EVERY key finished converting, so it is the maximum of the
    // per-key versions and never one of the earlier ones. Add a level key at
    // v11 and leave the boundary at 10 and this fails — instead of the prose
    // quietly starting to promise dB for a key that is still linear.
    expect(DB_LEVELS_FORMAT_VERSION).toBe(Math.max(...Object.values(PROJECT_DB_LEVEL_VERSIONS)));
    // The boundary is a version this format has actually reached. It may sit
    // BELOW the head — a later bump for a non-level reason does not move it.
    expect(DB_LEVELS_FORMAT_VERSION).toBeLessThanOrEqual(PROJECT_FORMAT_VERSION);
  });

  test('it states the unit, the unity, the range and the silence encoding', () => {
    expect(block).toContain('decibels');
    expect(block).toContain('0 dB is unity');
    expect(block).toContain('-60');
    expect(block).toContain('+12');
    expect(block).toContain('JSON.stringify(-Infinity)');
  });

  test('it warns that v8 and v9 are MIXED-unit and must be rejected', () => {
    // The mixed window is the trap: at v8 a `synthVolume` of 1.0 is unity
    // LINEAR gain, and read as dB it is a plausible-looking +1 dB. Nothing about
    // the value gives it away, so the prose has to name the window explicitly
    // and an importer has to refuse it.
    expect(block).toContain('MIXED');
    for (const version of Object.values(PROJECT_DB_LEVEL_VERSIONS)) {
      if (version < DB_LEVELS_FORMAT_VERSION) expect(block).toContain(`v${version}`);
    }
  });

  test('it names every level key the contract covers, with the version that converted it', () => {
    expect([...PROJECT_DB_LEVEL_KEYS]).toEqual([
      'masterVolume',
      'synthVolume',
      'chordVolume',
      'bassVolume',
      'padVolume',
      'masterSequencerVolume',
      'sequencerTracks[].volume',
    ]);
    // The key list is DERIVED from the version map, so this also pins the map's
    // own key set and its order.
    expect(Object.keys(PROJECT_DB_LEVEL_VERSIONS)).toEqual([...PROJECT_DB_LEVEL_KEYS]);
    expect(PROJECT_DB_LEVEL_VERSIONS).toEqual({
      masterVolume: 8,
      synthVolume: 9,
      chordVolume: 9,
      bassVolume: 9,
      padVolume: 9,
      masterSequencerVolume: 9,
      'sequencerTracks[].volume': 10,
    });
    for (const key of PROJECT_DB_LEVEL_KEYS) {
      expect(block).toContain(key);
    }
  });

  test('every per-loop level key it names is a real per-loop key', () => {
    const perLoop = PROJECT_DB_LEVEL_KEYS.filter(
      (key) => key !== 'masterVolume' && !key.includes('['),
    );
    for (const key of perLoop) {
      expect(LOOP_FLAT_KEYS as readonly string[]).toContain(key);
    }
    expect(PROJECT_CONTENT_KEYS as readonly string[]).toContain('masterVolume');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectFormat.test.ts -t "dB level contract"`

Expected: FAIL at import resolution — `SyntaxError: Export named 'DB_LEVELS_FORMAT_VERSION' not found in module '.../src/store/projectFormat.ts'`.

- [ ] **Step 3: Write the documentation and the two exports**

In `src/store/projectFormat.ts`, append the contract section to the existing `PROJECT_FORMAT_VERSION` docblock (keeping every version paragraph already there, including the v8 / v9 / v10 ones DEV-386 added), and **delete DEV-386 Task 3 Step 8's standalone "LEVELS IN A PROJECT BODY ARE DECIBELS" block** — this section is its finished replacement, and that one states the whole contract from v8, where only `masterVolume` had converted. Then add the three exports directly beneath `export const PROJECT_FORMAT_VERSION`:

```ts
/**
 * … existing v5 / v6 / v7 and DEV-386's v8 / v9 / v10 paragraphs stay exactly
 * as they are …
 *
 * dB LEVEL CONTRACT — the INTEROP BOUNDARY for murva import is v10.
 *
 * A body stamped v10 or later carries EVERY key in PROJECT_DB_LEVEL_KEYS in
 * DECIBELS. A body stamped v7 or lower carries all of them as linear gain
 * (0..1, unity at 1) and must NOT be read as dB. There is no way to tell the
 * two apart by value — 0.85 is a legal linear gain and a legal, very loud, dB
 * reading — so the formatVersion is the only discriminator an importer has,
 * and it must be checked before a level key is touched.
 *
 * v8 AND v9 ARE MIXED-UNIT VERSIONS AND AN IMPORTER MUST REJECT THEM.
 * The unit changed one group at a time, so between the two ends there is a
 * window where the same body carries both units at once:
 *   v8   masterVolume is dB.
 *        synthVolume, chordVolume, bassVolume, padVolume,
 *        masterSequencerVolume and sequencerTracks[].volume are LINEAR.
 *   v9   masterVolume and the five bus faders are dB.
 *        sequencerTracks[].volume is LINEAR.
 *   v10  all seven are dB.
 * Reading a v8 body as if this contract held would take a `synthVolume` of 1.0
 * — unity, linear — and call it +1 dB: a wrong answer that looks entirely
 * reasonable and is silently 1 dB loud, and at the other end a linear 0.1 would
 * read as +0.1 dB instead of -20. Rejecting is the only safe response, because
 * "v8 or v9" does not mean "convert it": solna's own upgrade path is
 * migrateProjectBody, and an importer that reimplements it forks the chain.
 * Bring such a body up to v10 by opening it in solna and saving it.
 *
 * The contract, for every key in PROJECT_DB_LEVEL_KEYS, at v10 or later:
 *   unit     decibels, relative (a fader), NOT dBFS.
 *   unity    0 dB is unity gain — the signal passes at the level it arrived.
 *            Linear gain is 10 ** (db / 20); see src/utils/gainUnits.ts.
 *   range    -60 .. +12 dB inclusive. -60 is the fader bottom, +12 the top.
 *   silence  a FINITE -60, never -Infinity: JSON.stringify(-Infinity) is null,
 *            and a body crosses JSON.stringify on the way to disk. -60 dB is
 *            0.001 linear, inaudible, and coincides with the fader bottom, so
 *            the silence value and the bottom of the range are one place.
 *            -Infinity is legal only in transient meter readings, which are
 *            never serialised.
 * murva reads the same numbers from `src/shared/audio/gainUnits.ts`; the copies
 * are held together by src/utils/gainContract.test.ts, which pins them as
 * literals. This section is itself pinned, by the dB-level-contract tests in
 * projectFormat.test.ts, so it cannot rot away from the exports below.
 */
export const PROJECT_FORMAT_VERSION = 10;

/**
 * Each level key and the formatVersion at which it became decibels. The unit
 * changed one group at a time (DEV-386), so these are not all the same number,
 * and that difference is the whole reason this map exists rather than a bare
 * list: it is what makes "the boundary is the LAST conversion" checkable.
 * Adding a level key means adding its version here.
 */
export const PROJECT_DB_LEVEL_VERSIONS: Readonly<Record<string, number>> = {
  masterVolume: 8,
  synthVolume: 9,
  chordVolume: 9,
  bassVolume: 9,
  padVolume: 9,
  masterSequencerVolume: 9,
  'sequencerTracks[].volume': 10,
};

/**
 * The keys the dB level contract above covers: one on the content root, five
 * flat per-loop keys, and the per-track fader inside each loop's
 * sequencerTracks. Derived from the map above so the roster is written once.
 * Everything else that looks like a level — drum-kit `gain`, `clickLevel`,
 * `reverbSend`, preset `subOscVolume`, vibe pad `volume` — is internal voicing,
 * not a fader, and stays linear (contract divergence 4).
 */
export const PROJECT_DB_LEVEL_KEYS: readonly string[] = Object.keys(PROJECT_DB_LEVEL_VERSIONS);

/**
 * The formatVersion at which the LAST level key became decibels — NOT the one
 * where the first did. "Where dB lands" is the phrasing that produces a v8 here
 * and an importer that reads five linear bus faders as dB; the boundary is the
 * version by which every key in PROJECT_DB_LEVEL_KEYS has converted, so a body
 * at or above it is uniformly dB and one below it is not to be trusted at all.
 * Deliberately a separate constant from PROJECT_FORMAT_VERSION, and deliberately
 * a literal rather than a Math.max over the map: later bumps for reasons that
 * have nothing to do with levels move the head without moving this, and a
 * derived value would move this without anyone updating the prose above.
 * projectFormat.test.ts asserts it equals that maximum.
 */
export const DB_LEVELS_FORMAT_VERSION = 10;
```

Do not change `PROJECT_FORMAT_VERSION`'s value — it is already `10` when DEV-386 has landed; the line above restates it only so the surrounding block reads as it will on disk. Do not touch `migrateProjectBody`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectFormat.test.ts`

Expected: PASS, including the pre-existing blocks in that file.

- [ ] **Step 5: Prove the doc-rot test trips**

Run:

```bash
sed -i '' 's/^ \*   silence  a FINITE -60/ *   silence  a finite floor/' src/store/projectFormat.ts
bun test src/store/projectFormat.test.ts -t "unit, the unity"
git checkout src/store/projectFormat.ts
```

Expected: the middle command FAILS on `expect(block).toContain('-60')` after the sentence stops carrying the number, then the file is restored. Re-apply Step 3 if the checkout reverted it.

- [ ] **Step 5b: Prove the key-to-boundary assertion trips**

This is the one that guards against the defect the contract block exists to prevent, so prove it the same way. Add a level key at a version past the boundary and leave the boundary alone:

```bash
sed -i '' "s/  'sequencerTracks\[\].volume': 10,/  'sequencerTracks[].volume': 10,\n  leadVolume: 11,/" src/store/projectFormat.ts
bun test src/store/projectFormat.test.ts -t "LAST level key"
git checkout src/store/projectFormat.ts
```

Expected: the middle command FAILS on `expect(DB_LEVELS_FORMAT_VERSION).toBe(Math.max(...))` — `Expected: 10  Received: 11` — which is precisely a future key converting after the boundary while the prose still promises v10 covers everything. The key-list test fails alongside it, naming the same edit. Re-apply Step 3 if the checkout reverted it.

- [ ] **Step 6: Commit**

```bash
git add src/store/projectFormat.ts src/store/projectFormat.test.ts
git commit -m "$(cat <<'EOF'
docs(format): pin the dB level contract in the project body

An importer reading `synthVolume: -6` could not tell whether that was dB,
relative to what unity, or what value meant silence. The format's own docblock
now states all four for every level key — unit, unity at 0 dB, the -60..+12
range, and the finite -60 silence encoding JSON.stringify forces.

The boundary is v10, and it is the version where the LAST level key converted,
not the first. DEV-386 changed the unit in three steps (v8 masterVolume, v9 the
bus faders, v10 the per-track volumes), so v8 and v9 stamp bodies that are half
dB and half linear gain. The block names both and says to reject them: a v8
`synthVolume` of 1.0 is unity linear gain, and read as dB it is a plausible,
silently wrong +1.

PROJECT_DB_LEVEL_VERSIONS records the version per key, PROJECT_DB_LEVEL_KEYS is
derived from it, and DB_LEVELS_FORMAT_VERSION is asserted to equal the maximum
of the map — so a level key added at v11 without moving the boundary turns the
suite red instead of widening the promise in silence. A test reads this source
file back and fails if the prose stops naming any of it, the way
dataLayerPurity.test.ts reads fixture sources.

No version is bumped here: DEV-386 landed 7 -> 8 -> 9 -> 10, this commit names
what those numbers mean. It also replaces DEV-386's interim "levels are
decibels" note, which was written at v8 and was not yet true.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 5: Run the gate

**Files:**
- Modify: none expected.
- Test: the whole suite.

**Interfaces:**
- Consumes: `bun run verify`.
- Produces: a green gate.

- [ ] **Step 1: Run the full gate**

Run: `bun run verify`

Expected: PASS — `bun test` green, `tsc --noEmit` silent, `eslint .` printing **nothing at all** (no errors AND no warnings; a warning is a failure here per decision D5), `check:keys`, `check:drums`, `check:contrast` green, and the production build succeeding.

- [ ] **Step 2: Confirm eslint is silent on its own**

Run: `bun run eslint; echo "exit=$?"`

Expected: no output above `exit=0`. If a warning appears, fix it in place rather than relaxing the rule.

- [ ] **Step 3: Confirm the tripwire still trips after everything landed**

Run:

```bash
sed -i '' 's/export const ZONE_GOOD_MAX = -6/export const ZONE_GOOD_MAX = -8/' src/utils/meterZones.ts
bun test src/utils/gainContract.test.ts
git checkout src/utils/meterZones.ts
```

Expected: the middle command FAILS on `expect(ZONE_GOOD_MAX).toBe(-6)` and on the `classifyZone` boundary test, then the file is restored. This is the definition of done for this issue, checked last rather than assumed.

- [ ] **Step 4: Confirm the working tree is clean and push**

```bash
git status --short
git log --oneline main..HEAD
git push -u origin feat/dev-388-db-contract-pin
```

Expected: `git status --short` prints nothing, `git log` shows the four commits from Tasks 1-4, and the push succeeds.

---

## Self-review

**Every acceptance criterion maps to a task:**

| AC | Task |
|---|---|
| The format contract documents unit / unity / range / silence encoding for every level key | Task 4, Step 3 (docblock) + Step 1 (the tests that pin the prose and the key list) |
| The `formatVersion` where dB lands is named as the interop boundary, earlier bodies are linear | Task 4, Step 3 (the `v10` paragraph + `DB_LEVELS_FORMAT_VERSION`), pinned by Step 1's `the boundary is where the LAST level key became dB` and resolved from the migration chain, not the head version, in Task 1 Step 1 |
| The mixed-unit window (v8, v9) is named per key and an importer is told to reject it | Task 4, Step 3 (the MIXED paragraph's per-version key lists), pinned by Step 1's `it warns that v8 and v9 are MIXED-unit` |
| A level key added later cannot silently widen the contract | Task 4, Step 3 (`PROJECT_DB_LEVEL_VERSIONS`, with `PROJECT_DB_LEVEL_KEYS` derived from it), asserted equal to the map's maximum in Step 1 and proved to trip in Step 5b |
| A test fails if solna's dB constants drift from murva: `UNITY_DB`, `DISPLAY_FLOOR_DBFS`, `DEFAULT_UNITY_POS`, fader range, meter ceiling, zone boundaries, calibration target and tolerance | Task 1 (all eight, as literals), proved to trip in Task 1 Step 4 and again in Task 5 Step 3 |
| Meter-scale breakpoints and taper behaviour pinned | Task 2, proved to trip in Task 2 Step 3 |
| `gainUnits.ts` carries a "keep in sync with murva" note pointing at the pinning test | Task 3, Step 1 (and Steps 2-4 do the same for the other three copies) |
| `bun run verify` green, eslint reports nothing | Task 5, Steps 1-2 |

| `MAX_FADER_GAIN` stays tied to the fader range | Task 1, Step 2 (`MAX_FADER_GAIN stays DERIVED from the murva-owned fader top`) |

**No placeholder survives.** The two values this plan genuinely cannot know at authoring time — DEV-386's landed interop boundary and DEV-387's `trimMath` path — are not written as "TBD": every code block carries a concrete, runnable value (`10`, `../audio/calibration/trimMath`), and Task 1 Step 1 resolves both before a line is written. That is a resolution step, not a placeholder.

**And the boundary is resolved by its definition, not by its number.** Task 1 Step 1 does not take the head `PROJECT_FORMAT_VERSION` and call it the boundary: it walks `migrateProjectBody` for the step that converts the last level key and asserts the two agree. Today they do — DEV-386's last bump is also the head — but that is a coincidence of this epic, and a plan that relies on it produces a confident wrong number in the next one. The failure it prevents is not an off-by-one: naming v8 as the boundary tells an importer that five bus faders and every per-track volume are decibels while they are still linear gain, and the resulting values (a `1.0` read as +1 dB, a `0.1` read as +0.1 instead of -20) are wrong in a way nothing downstream can detect.

**`MAX_FADER_GAIN` is pinned by its derivation, not its value, and that is a decision rather than an omission.** It is a DEV-386 addition to `gainUnits.ts` with no counterpart in murva's numbers table, so it cannot drift from murva independently: its value is a function of `FADER_MAX_DB` and `dbToGain`, both already pinned here as literals, and a second literal would only fail twice for one cause. What can drift silently is the derivation — replacing `dbToGain(toDecibels(FADER_MAX_DB))` with a literal detaches both engine clamps from the fader range while every literal in this file still passes, which is how the +12 dB the fader promises stops being reachable. So the identity is asserted instead, with the reason in the test, and DEV-386's `faderTaper.test.ts` keeps the literal `≈ 3.9810717`.

**Numbers agree with the contract file.** `0 / 1 / -60 / 0.75 / +12`, zones `-24 / -6 / -1`, ceiling `+6`, ticks `[-24, -6, 0]`, target `-18` with tolerance `3`, and the four scale segments — all read off the DEV-383 contract's "The numbers" table, none re-derived. `SILENCE_DB = -60` is pinned as the contract's divergence 2, explicitly against murva's `-Infinity`, so the difference is asserted rather than left to be discovered as drift.
