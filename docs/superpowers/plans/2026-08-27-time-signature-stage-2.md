# Variable Time Signature Support — Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the time-signature feature — fix the two latent bar-length traps Stage 1 left inert, make every preset picker show each pattern's native meter and label the ones that differ from the active meter, and author the native 3/4 and 6/8 material (six chord rhythms, four bass patterns, two sequencer genre presets, two vibe drum patterns and two Instant Vibes) that lets those two meters play without falling back on trimmed 4/4 content.

**Architecture:** Stage 1 already shipped the whole mechanism — `src/utils/meter.ts` (the six-row table plus `getMeter`/`beatIndexAt`/`isBeatBoundary`/`arpStepFor`), transport `meterId` + `setMeter`, `stepInBar` plumbing, the meter-derived sequencer grid, the two adaptation utilities (`utils/patternAdapt.ts` for dense drum rows, `utils/eventAdapt.ts` for `RhythmHit[]`/`BassStep[]`), a `meter` tag on all 45 shipped patterns, and persist v5. Stage 2 adds no new mechanism. It (a) replaces two hard-coded `16`s with the active `stepsPerBar`, (b) adds pure label helpers to the existing `src/components/meterSelect.ts` and wires them into the three pattern `<select>`s, and (c) appends new rows to the four existing pattern libraries and two entries to `INSTANT_VIBES`, all tagged `'3/4'` or `'6/8'`.

**Tech Stack:** Bun (test runner + scripts), Vite + React 18, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API (no Tone.js), `tonal` for theory only, Tailwind v4 + daisyUI v5 (CSS-first, no `tailwind.config.*`).

**Spec:** `docs/superpowers/specs/2026-08-27-time-signature-support-design.md` (§UI defines bucket A; §"Delivery stages" defines Stage 2 as "author native 3/4 and 6/8 patterns (drums, chord rhythms, bass) and any vibes that use them").

**Stage 1 plan (context only, do not re-execute):** `docs/superpowers/plans/2026-08-27-time-signature-support.md`

**Branch:** all work happens on `feat/time-signature-support`, which is where Stage 1's code lives. `main` was deliberately reset to the spec + Stage 1 plan docs only.

**Delivery order and why:** C (the two traps) first — cheap, and it prevents bucket B from silently inheriting broken arithmetic. Then A (labelling) — it makes bucket B's gaps visible in the UI while B is being authored. Then B (the content).

---

## Global Constraints

- **Three-layer import boundary, enforced by eslint `no-restricted-imports` (`eslint.config.js`).** `src/audio/` must not import `store/` or `components/`; `src/store/` must not import `components/`; `src/components/` must not import `audio/engine` (only `AudioVisualizer.tsx`, `TransportBar.tsx` and `*.test.ts(x)` are exempt). `src/utils/` is importable from all three — that is why `meter.ts`, `patternAdapt.ts` and `eventAdapt.ts` live there.
- **Never call an engine setter from a component.** New engine-settable state is added to a slice and wired in `src/store/engineSync.ts`. No task in this plan adds engine-settable state, so no task touches `engineSync.ts`.
- **No DOM / testing-library setup exists.** Tests are `bun:test` and **pure-logic**: components export their testable helpers and the test imports those instead of rendering React. Do not add `@testing-library/*`, jsdom or `happy-dom`.
- **The one sanctioned exception is `renderToString` from `react-dom/server`**, used only for markup/class-string assertions — see `src/components/SequencerView.test.tsx:1-6` and `src/components/ChordView.test.tsx:1-7`, both of which already do exactly this. Never use it to test behaviour; extract a helper for that.
- **Theme rule.** Components name roles, never colours. `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`, the `dark:` variant, `rgb()`/`rgba()` literals and dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). `ALLOWLIST` is empty and must stay empty. There is no `tailwind.config.*`. daisyUI v5 — look classes up rather than recalling them, and prefer reusing class strings already present in the file being edited. **No task in this plan adds a single new CSS class**; bucket A changes option *text*, not styling.
- **Do not rename any Instant Vibe id.** Ids are persisted in project files and the id↔label drift is intentional (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden"). Bucket B *adds* two ids and renames none.
- **Meter table values, verbatim from `src/utils/meter.ts`.** `4/4` → 16 steps, `[4,4,4,4]`; `3/4` → 12, `[4,4,4]`; `6/8` → 12, `[6,6]`; `12/8` → 24, `[6,6,6,6]`; `5/4` → 20, `[4,4,4,4,4]`; `7/8` → 14, `[6,4,4]`. `MAX_STEPS_PER_BAR = 24`.
- **Adaptation rules, verbatim from the spec.** Shorter target → **trim** (drop steps at or after `stepsPerBar`; clamp `holdSteps` to the bar end for event-shaped patterns). Longer target → **loop** from step 0 until the bar is filled. **Never stretch or rescale.**
- **4/4 must stay byte-identical.** `src/audio/meterRegression.test.ts` is the acceptance pin. Every task's 4/4 path must reduce to the arithmetic the current code performs; new patterns are **appended** to their libraries so the existing 4/4 entries keep their order.
- **12/8, 5/4 and 7/8 get no authored content.** They keep working via trim/loop of 4/4 material. Do not author for them in any task.
- **The completion gate is `bun run verify`, PLUS `bun run eslint` run separately** — `verify` (test + lint + check:keys + check:drums + build) does not include eslint. `bun run check:theme` is inside `verify` via the test suite; run it explicitly if you touch markup.
- **Every task ends with its own commit.** Commit bodies stay in English.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| *(none)* | Stage 2 adds no new modules. Every change extends a file Stage 1 already created or that predates it. This is deliberate: the mechanism is done, and a new module here would be a second place for the same concept to live. |

**Modified**

| File | Change | Task |
|---|---|---|
| `src/components/chord/useChordPlayback.ts` | `isFullHoldRhythm`/`isFullHoldBass` take `stepsPerBar`; both exported for testing | 1 |
| `src/components/chord/useChordPlayback.test.ts` | tests for the two now-exported predicates | 1 |
| `src/store/vibeVariation.ts` | `DRUM_DENSITY_METER` tag, `densityRowFor`, `eligibleDensities`/`rollDecoration` take `stepsPerBar` | 2 |
| `src/store/vibeVariation.test.ts` | density-adaptation tests; the two inline collision re-implementations call `eligibleDensities` instead | 2, 13, 14 |
| `src/components/meterSelect.ts` | `isMeterMismatch`, `patternMeterLabel`, `patternOptionLabel`, `patternMeterTitle` | 3 |
| `src/components/meterSelect.test.ts` | tests for the four helpers | 3 |
| `src/components/SequencerView.tsx` | genre `<option>`s carry the preset's meter | 4 |
| `src/components/SequencerView.test.tsx` | markup assertion for the labelled options | 4 |
| `src/components/ChordView.tsx` | chord-rhythm and bass-pattern `<option>`s carry the pattern's meter | 5 |
| `src/components/ChordView.test.tsx` | markup assertions for both selects | 5 |
| `src/audio/meterRegression.test.ts` | the 4/4 acceptance pin becomes an explicit id-set pin per library | 6 |
| `src/audio/rhythmPatterns.ts` | +3 patterns `'3/4'` (Task 6), +3 patterns `'6/8'` (Task 8) | 6, 8 |
| `src/audio/rhythmPatterns.test.ts` | explicit id→meter map replacing the "all 4/4" assertion | 6, 8 |
| `src/audio/bassPatterns.ts` | +2 patterns `'3/4'` (Task 7), +2 patterns `'6/8'` (Task 9) | 7, 9 |
| `src/audio/bassPatterns.test.ts` | explicit id→meter map; `BASS_STYLE_GROUPS` style order | 7, 9 |
| `src/audio/data/genrePresets.ts` | +`Waltz` (3/4) and +`Afro 6/8` (6/8) | 10 |
| `src/audio/data/genrePresets.test.ts` | `GENRES` list + explicit genre→meter map | 10 |
| `src/audio/drumKits.ts` | `GENRE_TO_KIT` gains the two new genre keys | 10 |
| `src/audio/data/vibeDrumPatterns.ts` | +`waltz-brush-three` (3/4) and +`afro-six-eight-bell` (6/8), both in `VIBE_DRUM_PATTERN_METERS` too | 11 |
| `src/audio/data/vibeDrumPatterns.test.ts` | `LIBRARY_IDS` + explicit id→meter map | 11 |
| `src/store/instantVibes.ts` | +`lofi-waltz` (3/4), +`afro-six-eight` (6/8) | 12, 13 |
| `src/store/instantVibes.test.ts` | count 6→7→8; the preset matrix gains two rows | 12, 13 |
| `src/store/instantVibesChordsFixture.ts` | golden chords for the two new vibes | 12, 13 |
| `src/store/instantVibesDrumsFixture.ts` | golden 7×12 drum cells for the two new vibes | 12, 13 |
| `src/store/instantVibesEffectsFixture.ts` | golden effect blocks for the two new vibes | 12, 13 |
| `src/store/instantVibesDrums.test.ts` | row length becomes meter-derived; new vibe↔pattern meter-agreement invariant | 12 |

**Two decisions locked before any task starts, so no task re-opens them:**

1. **Pickers label, they do not filter.** Every pattern stays listed and selectable in every meter; the ones whose native meter differs from the active meter are labelled. No default filtering, no hiding, no filter toggle. (Spec §UI: *"A pattern whose meter differs stays selectable — the user keeps the freedom to run a 4/4 pattern in 6/8 and hear what happens — but is labelled so the result is not surprising."*)
2. **`DRUM_DENSITIES` gets a meter tag and is adapted at draw time** rather than `collidesWithKick` being made meter-aware. Justification in Task 2.

**Pickers surveyed, and what happens to each:**

| Picker | Location | Change? |
|---|---|---|
| Sequencer genre preset | `src/components/SequencerView.tsx:154-165`, options from `Object.keys(GENRE_PRESETS)` | **Yes** — Task 4 |
| Chord rhythm pattern | `src/components/ChordView.tsx:745-761`, `optgroup`s from `RHYTHM_STYLE_GROUPS` | **Yes** — Task 5 |
| Bass pattern | `src/components/ChordView.tsx:1122-1138`, `optgroup`s from `BASS_STYLE_GROUPS` | **Yes** — Task 5 |
| Transport meter select | `src/components/TransportBar.tsx`, options from `METER_OPTIONS` (`src/components/meterSelect.ts`) | No — it *is* the meter control |
| Sound-kit select | `src/components/SequencerView.tsx:171-182`, `Object.keys(DRUM_KITS)` | No — kits are timbre, not rhythm; they have no meter |
| `PresetLibrary` drawer | `src/components/ui/PresetLibrary.tsx` (generic; used by `SynthPresetLibrary.tsx` and `ChordPresetLibrary.tsx`) | No — its entries are synth presets and chord progressions. Neither carries a `meter` field and neither is a rhythm. Verified by reading `PresetLibraryEntry` (`id`/`name`/`category`/`description`/`isFactory`). |
| Instant Vibe chips | `src/components/InstantVibesBar.tsx` | No — a vibe *sets* the meter on apply (`instantVibes.ts:75`); it is never adapted, so there is nothing to warn about |

**Why the tags exist but have no consumers today (verified by grep on this branch):** `GenrePreset.meter` (`src/audio/data/genrePresets.ts:15`), `VIBE_DRUM_PATTERN_METERS` and `drumPatternMeterId` (`src/audio/data/vibeDrumPatterns.ts:112,122`) are referenced only from test files. `RhythmPattern.meter` and `BassPattern.meter` **are** consumed in production at `src/components/chord/useChordPlayback.ts:149,155`, and `InstantVibe.meter` at `src/store/instantVibes.ts:75` — leave those three call sites alone.

---

## Bucket C — the two latent traps

### Task 1: Full-hold classification must use the active bar, not 16

**Files:**
- Modify: `src/components/chord/useChordPlayback.ts:110-127` (the two predicates), `:182` and `:210` (the call sites)
- Test: `src/components/chord/useChordPlayback.test.ts`

**Interfaces:**
- Consumes: `RhythmPattern` (`src/audio/rhythmPatterns.ts:29-44`, fields `id`, `name`, `style`, `description?`, `meter?: MeterId`, `hits: RhythmHit[]`); `RhythmHit` (`:10-27`, fields `step`, `type: 'block' | 'strum'`, `velocity?`, `holdSteps?`, `direction?`, `spreadMs?`, `note?`, `octaveShift?`); `BassPattern` (`src/audio/bassPatterns.ts:24-32`, fields `id`, `name`, `style`, `description?`, `meter?: MeterId`, `steps: BassStep[]`); `BassStep` (`:14-22`, fields `step`, `note: BassNoteToken`, `holdSteps?`, `velocity?`, `octaveShift?`, `staccato?`, `alternate?`); `activeStepsPerBar(): number` (`useChordPlayback.ts:84`).
- Produces:
  - `export function isFullHoldRhythm(pattern: RhythmPattern, stepsPerBar: number): boolean`
  - `export function isFullHoldBass(pattern: BassPattern, stepsPerBar: number): boolean`

**Why this matters.** Both predicates are currently `holdSteps >= 16`. They are inert today because each short-circuits on `pattern.id` first and only `sustained` (`rhythmPatterns.ts:70-76`, one hit with `holdSteps: 16`) and `whole-note-root` (`bassPatterns.ts:282-289`, one step with `holdSteps: 16`) reach the second clause at all. But in 12/8 the bar is 24 steps, so a 16-step hold would be classified as a full-bar hold at two thirds of a bar — the voice would be handed to `playFullHoldChord` / a one-shot `playbackNoteOn` sized to the whole chord rather than being emitted as a per-step event. Both call sites already have `stepsPerBar` in hand: it is computed at `:169` (`const stepsPerBar = activeStepsPerBar();`) and used at `:170`, `:180` and `:196` before either predicate runs. Verified.

- [ ] **Step 1: Write the failing test**

Append to `src/components/chord/useChordPlayback.test.ts` (it already imports `adaptBassPattern, adaptRhythmPattern` from `./useChordPlayback` at line 9 — extend that import):

```ts
describe('isFullHoldRhythm / isFullHoldBass measure the hold against the ACTIVE bar', () => {
  const oneHitAt = (holdSteps: number): RhythmPattern => ({
    id: 'probe-rhythm',
    name: 'Probe',
    style: 'Test',
    meter: '4/4',
    hits: [{ step: 0, type: 'block', velocity: 1, holdSteps }],
  });

  const oneStepAt = (holdSteps: number): BassPattern => ({
    id: 'probe-bass',
    name: 'Probe',
    style: 'Test',
    meter: '4/4',
    steps: [{ step: 0, note: 'root', holdSteps }],
  });

  test('a 16-step hold is a full hold in a 16-step bar — the 4/4 behaviour, unchanged', () => {
    expect(isFullHoldRhythm(oneHitAt(16), 16)).toBe(true);
    expect(isFullHoldBass(oneStepAt(16), 16)).toBe(true);
  });

  test('a 16-step hold is NOT a full hold in a 24-step 12/8 bar — it covers two thirds of it', () => {
    expect(isFullHoldRhythm(oneHitAt(16), 24)).toBe(false);
    expect(isFullHoldBass(oneStepAt(16), 24)).toBe(false);
  });

  test('a 12-step hold IS a full hold in a 12-step 3/4 or 6/8 bar', () => {
    expect(isFullHoldRhythm(oneHitAt(12), 12)).toBe(true);
    expect(isFullHoldBass(oneStepAt(12), 12)).toBe(true);
  });

  test('a hold longer than the bar still counts — adaptStepEvents clamps it, this only classifies', () => {
    expect(isFullHoldRhythm(oneHitAt(16), 12)).toBe(true);
    expect(isFullHoldBass(oneStepAt(16), 12)).toBe(true);
  });

  test('the two id short-circuits survive: they are full holds in every meter', () => {
    const sustained = RHYTHM_PATTERNS.find((p) => p.id === 'sustained')!;
    const wholeNote = BASS_PATTERNS.find((p) => p.id === 'whole-note-root')!;
    for (const stepsPerBar of [12, 14, 16, 20, 24]) {
      expect(isFullHoldRhythm(sustained, stepsPerBar)).toBe(true);
      expect(isFullHoldBass(wholeNote, stepsPerBar)).toBe(true);
    }
  });

  test('a multi-hit pattern is never a full hold, whatever its holds are', () => {
    const twoHits: RhythmPattern = {
      id: 'probe-two',
      name: 'Probe Two',
      style: 'Test',
      meter: '4/4',
      hits: [
        { step: 0, type: 'block', velocity: 1, holdSteps: 16 },
        { step: 8, type: 'block', velocity: 1, holdSteps: 16 },
      ],
    };
    expect(isFullHoldRhythm(twoHits, 16)).toBe(false);
  });
});
```

Add the imports this block needs at the top of the file:

```ts
import {
  adaptBassPattern,
  adaptRhythmPattern,
  isFullHoldBass,
  isFullHoldRhythm,
} from './useChordPlayback';
import { RHYTHM_PATTERNS, type RhythmPattern } from '../../audio/rhythmPatterns';
import { BASS_PATTERNS, type BassPattern } from '../../audio/bassPatterns';
```

(The file already type-imports `RhythmPattern` and `BassPattern` at lines 10-11; replace those two type-only lines with the value imports above rather than duplicating them.)

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/components/chord/useChordPlayback.test.ts`
Expected: FAIL — `isFullHoldRhythm` and `isFullHoldBass` are not exported (`SyntaxError: export 'isFullHoldRhythm' not found in './useChordPlayback'`).

- [ ] **Step 3: Make the predicates meter-aware and export them**

Replace `src/components/chord/useChordPlayback.ts:110-127` with:

```ts
/**
 * Patterns that hold one voice across the whole chord instead of re-striking.
 *
 * `stepsPerBar` is the ACTIVE bar length, not the constant 16: in 12/8 a bar is
 * 24 steps, and a 16-step hold there covers two thirds of a bar, not all of it.
 * Exported so the pure-logic tests can reach them without React.
 */
export function isFullHoldRhythm(pattern: RhythmPattern, stepsPerBar: number): boolean {
  return (
    pattern.id === "sustained" ||
    (pattern.hits.length === 1 &&
      pattern.hits[0].step === 0 &&
      (pattern.hits[0].holdSteps ?? 1) >= stepsPerBar)
  );
}

export function isFullHoldBass(pattern: BassPattern, stepsPerBar: number): boolean {
  return (
    pattern.id === "whole-note-root" ||
    (pattern.steps.length === 1 &&
      pattern.steps[0].step === 0 &&
      (pattern.steps[0].holdSteps ?? 1) >= stepsPerBar)
  );
}
```

- [ ] **Step 4: Pass `stepsPerBar` at both call sites**

At `src/components/chord/useChordPlayback.ts:182`:

```ts
    if (isFullHoldRhythm(pattern, stepsPerBar)) {
```

At `src/components/chord/useChordPlayback.ts:210`:

```ts
    if (isFullHoldBass(pattern, stepsPerBar)) {
```

`stepsPerBar` is already in scope at both — it is bound at `:169`. Do not add a second `activeStepsPerBar()` call.

- [ ] **Step 5: Run the test and see it pass**

Run: `bun test src/components/chord/useChordPlayback.test.ts`
Expected: PASS, all tests including the pre-existing arming and adaptation blocks.

- [ ] **Step 6: Run the full gate**

Run: `bun run verify`
Expected: PASS. In particular `src/audio/meterRegression.test.ts` must still be green — the 4/4 path is `>= 16` before and after.

- [ ] **Step 7: Commit**

```bash
git add src/components/chord/useChordPlayback.ts src/components/chord/useChordPlayback.test.ts
git commit -m "fix(chords): measure a full-bar hold against the active bar, not 16

isFullHoldRhythm and isFullHoldBass compared holdSteps against a literal 16.
Inert today because both short-circuit on pattern.id and only 'sustained' and
'whole-note-root' reach the second clause, but wrong for 12/8, whose bar is 24
steps: a 16-step hold there covers two thirds of a bar and would still have been
handed to the one-shot full-hold path. Both call sites already had stepsPerBar
in scope. 4/4 is unchanged: stepsPerBar is 16."
```

---

### Task 2: The drum-density catalogue declares its meter and is adapted at draw time

**Files:**
- Modify: `src/store/vibeVariation.ts:12-30` (the catalogue), `:87-89` (`collidesWithKick`), `:104-111` (`eligibleDensities`), `:113-140` (`rollDecoration`), `:182` (the call from `resolveVibeVariation`)
- Test: `src/store/vibeVariation.test.ts`

**Interfaces:**
- Consumes: `DensityName` (`src/types.ts:133-136`, the closed 15-name union); `adaptStepRow<T>(row: readonly T[], targetSteps: number): T[]` (`src/utils/patternAdapt.ts:19`); `getMeter(id: string | null | undefined): Meter` and `type MeterId` (`src/utils/meter.ts:63,12`); `InstantVibe.meter: MeterId` (`src/types.ts:181`).
- Produces:
  - `export const DRUM_DENSITY_METER: MeterId` (`'4/4'`)
  - `export function densityRowFor(name: DensityName, stepsPerBar: number): number[]`
  - `export function eligibleDensities(layer: DecorationLayer, candidates: DensityName[], kick: number[], stepsPerBar: number): DensityName[]` — **signature change: a fourth parameter**

**Why tag-and-adapt rather than a meter-aware `collidesWithKick`.** Making only the comparison meter-aware is a half fix. It would silence the length mismatch in `collidesWithKick(row, kick)` but leave `rollDecoration` writing a 16-element row into a vibe whose other six rows are 12 (`vibeVariation.ts:135`, `drumPattern[layer] = [...DRUM_DENSITIES[density]]`). The rerolled `InstantVibe` would then be internally inconsistent — rows of two different bar lengths in one pattern — and nothing states or checks that invariant. It happens not to *sound* wrong today only because `applyDrumPattern` (`src/store/sequencerSlice.ts:27-40`) re-adapts every row individually on its way into the store; that is downstream luck, not a contract. Tagging the catalogue and adapting at the point of use fixes the comparison and the write with the single rule the rest of the feature already uses (`adaptStepRow`), and it makes the "these rows are 4/4" fact explicit instead of implied by their length.

The rejected third option — authoring 3/4 and 6/8 density rows — is worse here: `DensityName` is a closed, UI-facing union (the reroll toast prints the name, `vibeVariation.ts:222-226`), so per-meter rows would either multiply the union or make one name mean different things in different meters.

**What adaptation does to the catalogue, measured.** Every row is 16 steps, so in a 12-step bar `adaptStepRow` trims to the first 12. Three rows lose all their hits and become indistinguishable from `off`: `pickup` (its only hit is at step 14), `fillTail` (13 and 15) and — trivially — `off` itself. That is a real authoring hazard for buckets B's vibes and Step 4 below pins it, so a later author cannot list a silently-dead candidate and think they gave the dice a choice.

- [ ] **Step 1: Write the failing test**

Append to `src/store/vibeVariation.test.ts`:

```ts
describe('DRUM_DENSITIES is a 4/4 catalogue, adapted to the vibe it decorates', () => {
  test('the catalogue declares the meter its rows were authored in', () => {
    expect(DRUM_DENSITY_METER).toBe('4/4');
    for (const row of Object.values(DRUM_DENSITIES)) {
      expect(row.length).toBe(getMeter(DRUM_DENSITY_METER).stepsPerBar);
    }
  });

  test('densityRowFor is the identity in 4/4 — the byte-identical path', () => {
    for (const name of Object.keys(DRUM_DENSITIES) as DensityName[]) {
      expect(densityRowFor(name, 16)).toEqual(DRUM_DENSITIES[name]);
      // A copy, never the module's own array: a drawn row flows into store state.
      expect(densityRowFor(name, 16)).not.toBe(DRUM_DENSITIES[name]);
    }
  });

  test('densityRowFor trims to a shorter bar and loops into a longer one', () => {
    expect(densityRowFor('quarters', 12)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(densityRowFor('eighths', 12)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(densityRowFor('downbeat', 24)).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test('THE TRAP: pickup and fillTail lose every hit in a 12-step bar', () => {
    // Both are authored as end-of-bar figures (steps 14, and 13+15). Trimmed to
    // 12 they are silent, i.e. a duplicate of `off`. A 3/4 or 6/8 vibe that
    // lists either as a candidate has a smaller real pool than it looks.
    expect(densityRowFor('pickup', 12).some((s) => s === 1)).toBe(false);
    expect(densityRowFor('fillTail', 12).some((s) => s === 1)).toBe(false);
    // ...but they are alive in the 16-step bar they were written for.
    expect(densityRowFor('pickup', 16).some((s) => s === 1)).toBe(true);
    expect(densityRowFor('fillTail', 16).some((s) => s === 1)).toBe(true);
  });

  test('eligibleDensities compares the ADAPTED row against the kick', () => {
    // A 3/4 kick on beat one only. `quarters` adapted to 12 hits step 0 too.
    const kick = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(eligibleDensities('tom', ['off', 'quarters', 'midBar'], kick, 12)).toEqual([
      'off',
      'midBar',
    ]);
    // hihat and crash are exempt from the filter and keep every candidate.
    expect(eligibleDensities('hihat', ['off', 'quarters', 'midBar'], kick, 12)).toEqual([
      'off',
      'quarters',
      'midBar',
    ]);
  });

  test('in 4/4 eligibleDensities returns exactly what it returned before', () => {
    const kick = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]; // boombap-swung-break
    expect(eligibleDensities('openhat', ['off', 'pickup', 'and2and4'], kick, 16)).toEqual([
      'off',
      'pickup',
    ]);
  });
});
```

Extend that file's imports (currently `createDraw, DECORATION_ORDER, DRUM_DENSITIES, LAYER_LABELS` at line 3 and `eligibleDensities, resolveVibeVariation` further down):

```ts
import {
  createDraw,
  DECORATION_ORDER,
  DRUM_DENSITIES,
  DRUM_DENSITY_METER,
  densityRowFor,
  LAYER_LABELS,
} from './vibeVariation';
import { getMeter } from '../utils/meter';
import type { DensityName } from '../types';
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/store/vibeVariation.test.ts`
Expected: FAIL — `DRUM_DENSITY_METER` and `densityRowFor` are not exported, and `eligibleDensities` takes three arguments.

- [ ] **Step 3: Tag the catalogue and add the adapter**

In `src/store/vibeVariation.ts`, add to the imports at the top:

```ts
import { getMeter, type MeterId } from '../utils/meter';
import { adaptStepRow } from '../utils/patternAdapt';
```

Immediately after the `DRUM_DENSITIES` literal (after `:30`), add:

```ts
/**
 * The meter every row above was authored in. Explicit rather than implied by
 * the row length: 3/4 and 6/8 are both 12 steps and differ only in accent
 * grouping, so a bare length is not a sufficient tag anywhere in this codebase.
 */
export const DRUM_DENSITY_METER: MeterId = '4/4';

/**
 * A catalogue row adapted to the bar it is about to decorate, using the same
 * trim/loop rule as every other pattern in the app (utils/patternAdapt.ts).
 * Always a fresh array: the drawn row flows into a vibe and then into store
 * state, and the catalogue must stay authoritative and immutable.
 *
 * BEWARE: `pickup` (step 14) and `fillTail` (steps 13, 15) are end-of-bar
 * figures and trim to silence in any bar shorter than 15 steps — i.e. they
 * become a duplicate of `off` in 3/4, 6/8 and 7/8. An invariant test pins that,
 * and no vibe should list them as a candidate in those meters.
 */
export function densityRowFor(name: DensityName, stepsPerBar: number): number[] {
  return adaptStepRow(DRUM_DENSITIES[name], stepsPerBar);
}
```

`DensityName` is already imported at `:1`; `adaptStepRow` returns a new array, so `densityRowFor` needs no extra copy.

- [ ] **Step 4: Thread `stepsPerBar` through the filter and the draw**

Replace `eligibleDensities` (`:104-111`):

```ts
export function eligibleDensities(
  layer: DecorationLayer,
  candidates: DensityName[],
  kick: number[],
  stepsPerBar: number,
): DensityName[] {
  if (!COLLISION_FILTERED.includes(layer)) return candidates;
  return candidates.filter((name) => !collidesWithKick(densityRowFor(name, stepsPerBar), kick));
}
```

Change `rollDecoration`'s signature and its two uses of the catalogue (`:113-140`):

```ts
function rollDecoration(
  authored: Record<string, number[]>,
  rule: DrumDecorationRule,
  draw: VibeDraw,
  stepsPerBar: number,
): { drumPattern: Record<string, number[]>; drums: VariationSummary['drums'] } {
```

inside the loop, replace the `eligible` line and the write:

```ts
    const eligible = eligibleDensities(layer, candidates, kick, stepsPerBar);
```

```ts
    // Adapted to the vibe's own bar, so every row of the returned pattern has
    // the same length. densityRowFor already returns a fresh array.
    drumPattern[layer] = densityRowFor(density, stepsPerBar);
```

And in `resolveVibeVariation`, replace `:182`:

```ts
  const stepsPerBar = getMeter(vibe.meter).stepsPerBar;
  const { drumPattern, drums } = rollDecoration(
    vibe.drumPattern,
    rule.drumDecoration,
    draw,
    stepsPerBar,
  );
```

- [ ] **Step 5: Point the two inline collision re-implementations at the real function**

`src/store/vibeVariation.test.ts` re-implements the collision rule inline in two tests (`'after the kick-collision filter, openhat and tom still have a candidate'` and `'the filter removes exactly one candidate across all authored data'`), which is exactly how a test drifts from the code it guards. Replace both bodies so they call `eligibleDensities`:

```ts
  test('after the kick-collision filter, openhat and tom still have a candidate', () => {
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      const kick = v.drumPattern.kick;
      const stepsPerBar = getMeter(v.meter).stepsPerBar;
      for (const layer of layers) {
        if (!COLLISION_FILTERED.includes(layer)) continue;
        const survivors = eligibleDensities(layer, densities[layer]!, kick, stepsPerBar);
        expect(survivors.length, `${v.id}/${layer}`).toBeGreaterThan(0);
      }
    }
  });

  // Pins the one measured cost of the collision filter, so a later kick edit
  // that quietly empties more of the pool shows up as a failing count.
  test('the filter removes exactly one candidate across all authored data', () => {
    let removed = 0;
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      const kick = v.drumPattern.kick;
      const stepsPerBar = getMeter(v.meter).stepsPerBar;
      for (const layer of layers) {
        if (!COLLISION_FILTERED.includes(layer)) continue;
        removed +=
          densities[layer]!.length -
          eligibleDensities(layer, densities[layer]!, kick, stepsPerBar).length;
      }
    }
    // hiphop-groove's kick hits step 6, which is `and2and4`'s first hit.
    expect(removed).toBe(1);
  });
```

- [ ] **Step 6: Add the no-silent-candidate invariant**

Still in `src/store/vibeVariation.test.ts`, append:

```ts
  test('no vibe lists a candidate that is silent in that vibe\'s own meter', () => {
    // `off` is the deliberate silent member of every pool. Any OTHER candidate
    // that adapts to an all-zero row is a duplicate of `off` — the pool looks
    // bigger than it is and the dice has fewer real outcomes than authored.
    for (const v of INSTANT_VIBES) {
      const stepsPerBar = getMeter(v.meter).stepsPerBar;
      for (const [layer, candidates] of Object.entries(v.variation!.drumDecoration.densities)) {
        for (const name of candidates as DensityName[]) {
          if (name === 'off') continue;
          const sounds = densityRowFor(name, stepsPerBar).some((s) => s === 1);
          expect(sounds, `${v.id}/${layer}/${name} is silent in ${v.meter}`).toBe(true);
        }
      }
    }
  });
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `bun test src/store/vibeVariation.test.ts`
Expected: PASS. All six vibes are 4/4 at this point, so every adapted row is the identity and `removed` is still `1`.

- [ ] **Step 8: Run the full gate**

Run: `bun run verify` then `bun run eslint`
Expected: PASS both. `eslint` matters here because `vibeVariation.ts` gained two `utils/` imports; `store/ → utils/` is an allowed direction.

- [ ] **Step 9: Commit**

```bash
git add src/store/vibeVariation.ts src/store/vibeVariation.test.ts
git commit -m "fix(vibes): tag the drum-density catalogue 4/4 and adapt it per vibe

DRUM_DENSITIES rows are 16-step 4/4 figures, but nothing said so and nothing
adapted them. rollDecoration wrote a 16-element row straight into a vibe's
drumPattern and eligibleDensities compared it against that vibe's kick, so the
moment a 3/4 or 6/8 vibe exists the rerolled pattern holds rows of two different
bar lengths and the comparison runs past the end of the kick.

Tag the catalogue with DRUM_DENSITY_METER, add densityRowFor() built on the
existing adaptStepRow trim/loop rule, and thread the vibe's own stepsPerBar
through eligibleDensities and rollDecoration. Adapting to 16 is the identity, so
the six 4/4 vibes are byte-identical.

Also pins the trap this exposes: pickup and fillTail are end-of-bar figures and
trim to silence in any bar shorter than 15 steps, making them duplicates of
'off'. A new invariant test rejects any vibe that lists a silent candidate.

The two tests that re-implemented the collision rule inline now call
eligibleDensities, so they cannot drift from it again."
```

---

## Bucket A — pickers show the native meter and label the mismatches

### Task 3: The pattern-meter label helpers

**Files:**
- Modify: `src/components/meterSelect.ts` (append; it currently holds `MeterOption`, `METER_OPTIONS` and `coerceMeterChoice`)
- Test: `src/components/meterSelect.test.ts`

**Interfaces:**
- Consumes: `METERS`, `METER_IDS`, `getMeter`, `isMeterId`, `type MeterId`, `type Meter` from `src/utils/meter.ts`. `meterSelect.ts` already imports the first four; add `getMeter`.
- Produces:
  - `export function isMeterMismatch(patternMeter: MeterId | undefined, activeMeter: MeterId): boolean`
  - `export function patternMeterLabel(patternMeter: MeterId | undefined, activeMeter: MeterId): string`
  - `export function patternOptionLabel(name: string, patternMeter: MeterId | undefined, activeMeter: MeterId): string`
  - `export function patternMeterTitle(name: string, patternMeter: MeterId | undefined, activeMeter: MeterId): string`

**Design notes.**
- These live in `meterSelect.ts` rather than a new file because that module already exists for exactly this job — "pure option-model for a meter-bearing `<select>`, kept out of the component so it can be tested without React" — and it already imports nothing but `utils/meter`.
- The label is appended to the option **text**, not expressed with a class. `<option>` cannot be reliably styled across browsers, and this repo's theme guard would rather it were not tried.
- `patternMeter` is typed `MeterId | undefined` because `RhythmPattern.meter` and `BassPattern.meter` are optional (`rhythmPatterns.ts:42`, `bassPatterns.ts:30`) so inline test literals stay valid. `getMeter(undefined)` resolves to the 4/4 row, which is exactly what playback does, so an untagged pattern is labelled `4/4`.
- **Three cases, not two.** A mismatch is trimmed (source bar longer), looped (source bar shorter) **or re-grouped** (same bar length, different accent groups). The third case is 3/4 ↔ 6/8 — both 12 steps — and it is the whole reason `accentGroups` exists. The title text must say so.

- [ ] **Step 1: Write the failing test**

Append to `src/components/meterSelect.test.ts`:

```ts
describe('isMeterMismatch', () => {
  test('a pattern in the active meter is not a mismatch', () => {
    expect(isMeterMismatch('4/4', '4/4')).toBe(false);
    expect(isMeterMismatch('6/8', '6/8')).toBe(false);
  });

  test('3/4 and 6/8 are a mismatch despite sharing a bar length', () => {
    expect(isMeterMismatch('3/4', '6/8')).toBe(true);
    expect(isMeterMismatch('6/8', '3/4')).toBe(true);
  });

  test('an untagged pattern is treated as 4/4, exactly as playback treats it', () => {
    expect(isMeterMismatch(undefined, '4/4')).toBe(false);
    expect(isMeterMismatch(undefined, '3/4')).toBe(true);
  });
});

describe('patternMeterLabel', () => {
  test('shows just the meter when it matches', () => {
    expect(patternMeterLabel('4/4', '4/4')).toBe('4/4');
    expect(patternMeterLabel('3/4', '3/4')).toBe('3/4');
  });

  test('shows native → active when it differs', () => {
    expect(patternMeterLabel('4/4', '6/8')).toBe('4/4 → 6/8');
    expect(patternMeterLabel('3/4', '6/8')).toBe('3/4 → 6/8');
  });
});

describe('patternOptionLabel', () => {
  test('appends the meter to the pattern name with a middot', () => {
    expect(patternOptionLabel('Sustained', '4/4', '4/4')).toBe('Sustained · 4/4');
  });

  test('a differing pattern stays listed and says what it will become', () => {
    expect(patternOptionLabel('Sustained', '4/4', '3/4')).toBe('Sustained · 4/4 → 3/4');
  });
});

describe('patternMeterTitle', () => {
  test('a matching pattern says so plainly', () => {
    expect(patternMeterTitle('Waltz', '3/4', '3/4')).toBe(
      'Waltz — written in 3/4, the active meter',
    );
  });

  test('a longer source bar is trimmed', () => {
    expect(patternMeterTitle('Rock', '4/4', '3/4')).toBe(
      'Rock — written in 4/4; trimmed to fill a 3/4 bar of 12 steps',
    );
  });

  test('a shorter source bar is looped', () => {
    expect(patternMeterTitle('Waltz', '3/4', '5/4')).toBe(
      'Waltz — written in 3/4; looped to fill a 5/4 bar of 20 steps',
    );
  });

  test('THE 3/4 vs 6/8 CASE: same bar length, re-grouped rather than resized', () => {
    expect(patternMeterTitle('Waltz', '3/4', '6/8')).toBe(
      'Waltz — written in 3/4; same 12-step bar, re-grouped as 6+6',
    );
    expect(patternMeterTitle('Afro', '6/8', '3/4')).toBe(
      'Afro — written in 6/8; same 12-step bar, re-grouped as 4+4+4',
    );
  });
});
```

Extend that file's import from `./meterSelect` with the four new names.

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/components/meterSelect.test.ts`
Expected: FAIL — none of the four helpers is exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/components/meterSelect.ts` (and add `getMeter` to its existing import from `../utils/meter`):

```ts
/**
 * A pattern's meter tag against the active transport meter.
 *
 * `patternMeter` is optional because RhythmPattern.meter and BassPattern.meter
 * are — inline test literals omit it. `getMeter` resolves undefined to the 4/4
 * row, which is exactly what playback does, so an untagged pattern reads as 4/4
 * here and sounds as 4/4 there.
 */
export function isMeterMismatch(
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): boolean {
  return getMeter(patternMeter).id !== getMeter(activeMeter).id;
}

/** `'4/4'` when it matches the active meter, `'4/4 → 6/8'` when it does not. */
export function patternMeterLabel(
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): string {
  const native = getMeter(patternMeter);
  const active = getMeter(activeMeter);
  return native.id === active.id ? native.label : `${native.label} → ${active.label}`;
}

/**
 * The visible `<option>` text. Every pattern stays listed and selectable in
 * every meter — the user keeps the freedom to run a 4/4 pattern in 6/8 — and the
 * label is what stops the result being a surprise.
 */
export function patternOptionLabel(
  name: string,
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): string {
  return `${name} · ${patternMeterLabel(patternMeter, activeMeter)}`;
}

/**
 * The `<option title>` explaining what adaptation will actually do. THREE cases,
 * not two: a longer source bar is trimmed, a shorter one is looped, and a source
 * bar of the SAME length in a different meter is neither — it is re-grouped.
 * 3/4 and 6/8 are both 12 steps and differ only in accentGroups, which is the
 * whole reason bar length alone is not a sufficient tag.
 */
export function patternMeterTitle(
  name: string,
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): string {
  const native = getMeter(patternMeter);
  const active = getMeter(activeMeter);
  if (native.id === active.id) {
    return `${name} — written in ${native.label}, the active meter`;
  }
  if (native.stepsPerBar === active.stepsPerBar) {
    return `${name} — written in ${native.label}; same ${native.stepsPerBar}-step bar, re-grouped as ${active.accentGroups.join('+')}`;
  }
  const verb = native.stepsPerBar > active.stepsPerBar ? 'trimmed' : 'looped';
  return `${name} — written in ${native.label}; ${verb} to fill a ${active.label} bar of ${active.stepsPerBar} steps`;
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/components/meterSelect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/meterSelect.ts src/components/meterSelect.test.ts
git commit -m "feat(ui): pure helpers that label a pattern's native meter

Four helpers on the existing meterSelect option-model module: isMeterMismatch,
patternMeterLabel, patternOptionLabel and patternMeterTitle. They express the
spec's rule that a differing pattern stays selectable but is labelled, and they
distinguish all THREE adaptation cases — trimmed, looped, and same-length
re-grouped, which is the 3/4 vs 6/8 case that bar length alone cannot see.

No consumers yet; the three pickers follow."
```

---

### Task 4: The sequencer genre dropdown shows each preset's meter

**Files:**
- Modify: `src/components/SequencerView.tsx:154-165` (the genre `<select>`)
- Test: `src/components/SequencerView.test.tsx`

**Interfaces:**
- Consumes: `patternOptionLabel(name, patternMeter, activeMeter)` and `patternMeterTitle(name, patternMeter, activeMeter)` from Task 3; `GENRE_PRESETS: Record<string, GenrePreset>` where `GenrePreset = { meter: MeterId; rows: Record<string, boolean[]> }` (`src/audio/data/genrePresets.ts:14-19`); the `meter: Meter` already bound at `SequencerView.tsx:36`.
- Produces: nothing importable. The `<option value>` is unchanged — still the raw genre key — so `applyGenrePreset` and `GENRE_TO_KIT` are untouched.

- [ ] **Step 1: Write the failing test**

Append to `src/components/SequencerView.test.tsx`:

```ts
describe('SequencerView genre options carry their meter', () => {
  test('in 4/4 every genre is labelled with its own meter', () => {
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<SequencerView />);
    expect(html).toContain('Synthwave · 4/4');
    expect(html).toContain('Boom Bap · 4/4');
    // The value is still the bare genre key, so applyGenrePreset is unaffected.
    expect(html).toContain('value="Synthwave"');
  });

  test('in 3/4 a 4/4 genre is still listed, labelled with what it becomes', () => {
    useAppStore.setState({ meterId: '3/4' });
    const html = renderToString(<SequencerView />);
    expect(html).toContain('Synthwave · 4/4 → 3/4');
    expect(html).toContain('trimmed to fill a 3/4 bar of 12 steps');
    // Nothing is hidden: all twelve 4/4 genres remain in the list.
    expect(html).toContain('value="Reggae"');
    useAppStore.setState({ meterId: '4/4' });
  });
});
```

Add `import { useAppStore } from '../store/store';` to that file.

**Note for the implementer:** `renderToString` reads the live store, and the existing `const html = renderToString(<SequencerView />)` at the top of the file is evaluated at describe-time in the default 4/4 state. Set the meter back to `'4/4'` at the end of the second test (as written above) so test ordering cannot leak.

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/components/SequencerView.test.tsx`
Expected: FAIL — the rendered options are bare genre names (`>Synthwave<`), so `'Synthwave · 4/4'` is not found.

- [ ] **Step 3: Label the options**

In `src/components/SequencerView.tsx`, add to the imports:

```ts
import { patternMeterTitle, patternOptionLabel } from "./meterSelect";
```

Replace the option loop at `:160-164`:

```tsx
              {Object.entries(GENRE_PRESETS).map(([g, preset]) => (
                <option
                  key={g}
                  value={g}
                  title={patternMeterTitle(g, preset.meter, meter.id)}
                >
                  {patternOptionLabel(g, preset.meter, meter.id)}
                </option>
              ))}
```

`meter` is already bound at `:36` (`const meter = getMeter(useAppStore((s) => s.meterId));`), so no new store subscription is needed.

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/components/SequencerView.test.tsx`
Expected: PASS, including the pre-existing theming assertions — no class string changed.

- [ ] **Step 5: Run the theme guard and the gate**

Run: `bun run check:theme && bun run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SequencerView.tsx src/components/SequencerView.test.tsx
git commit -m "feat(sequencer): label each genre preset with its native meter

The genre dropdown now reads 'Synthwave · 4/4' in 4/4 and 'Synthwave · 4/4 →
3/4' when the transport is in 3/4, with a title spelling out whether the rows
will be trimmed, looped or re-grouped. Every genre stays listed and selectable;
GenrePreset.meter had no production consumer before this."
```

---

### Task 5: The chord-rhythm and bass-pattern selects show each pattern's meter

**Files:**
- Modify: `src/components/ChordView.tsx:745-761` (chord rhythm select), `:1122-1138` (bass pattern select)
- Test: `src/components/ChordView.test.tsx`

**Interfaces:**
- Consumes: `patternOptionLabel`, `patternMeterTitle` (Task 3); `RHYTHM_STYLE_GROUPS: { style: string; patterns: RhythmPattern[] }[]` and `BASS_STYLE_GROUPS: { style: string; patterns: BassPattern[] }[]` (built by `groupByStyle`, `src/audio/groupByStyle.ts:6`), both already imported by `ChordView.tsx` at `:54` and `:58`.
- Produces: nothing importable. `<option value>` stays the pattern id, so `setChordRhythmId` / `setBassPatternId` are untouched.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ChordView.test.tsx`:

```ts
describe('ChordView pattern selects carry each pattern\'s meter', () => {
  test('in 4/4 both selects label every pattern with its own meter', () => {
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<ChordView />);
    expect(html).toContain('Sustained · 4/4');
    expect(html).toContain('Whole-Note Root · 4/4');
    expect(html).toContain('value="sustained"');
    expect(html).toContain('value="whole-note-root"');
  });

  test('in 6/8 a 4/4 pattern stays selectable and says it will be trimmed', () => {
    useAppStore.setState({ meterId: '6/8' });
    const html = renderToString(<ChordView />);
    expect(html).toContain('Sustained · 4/4 → 6/8');
    expect(html).toContain('Whole-Note Root · 4/4 → 6/8');
    expect(html).toContain('trimmed to fill a 6/8 bar of 12 steps');
    // Nothing is filtered out of either list.
    expect(html).toContain('value="lofiSwing"');
    expect(html).toContain('value="dilla-sub"');
    useAppStore.setState({ meterId: '4/4' });
  });
});
```

Add `import { useAppStore } from '../store/store';` to that file.

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/components/ChordView.test.tsx`
Expected: FAIL — the options render bare `{p.name}`.

- [ ] **Step 3: Label both selects**

In `src/components/ChordView.tsx`, add to the imports:

```ts
import { patternMeterTitle, patternOptionLabel } from './meterSelect';
```

and read the active meter next to the existing `rhythmId` subscription at `:176`:

```ts
  const meterId = useAppStore((s) => s.meterId);
```

Replace the chord-rhythm option loop (`:752-760`):

```tsx
                {RHYTHM_STYLE_GROUPS.map((group) => (
                  <optgroup key={group.style} label={group.style}>
                    {group.patterns.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        title={patternMeterTitle(p.name, p.meter, meterId)}
                      >
                        {patternOptionLabel(p.name, p.meter, meterId)}
                      </option>
                    ))}
                  </optgroup>
                ))}
```

Replace the bass-pattern option loop (`:1129-1137`):

```tsx
                {BASS_STYLE_GROUPS.map((group) => (
                  <optgroup key={group.style} label={group.style}>
                    {group.patterns.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        title={patternMeterTitle(p.name, p.meter, meterId)}
                      >
                        {patternOptionLabel(p.name, p.meter, meterId)}
                      </option>
                    ))}
                  </optgroup>
                ))}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/components/ChordView.test.tsx`
Expected: PASS, including the pre-existing preview-button and theming assertions.

- [ ] **Step 5: Run the theme guard and the gate**

Run: `bun run check:theme && bun run verify && bun run eslint`
Expected: PASS. This is the last bucket-A task, so this is the point at which the whole labelling change is green.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChordView.tsx src/components/ChordView.test.tsx
git commit -m "feat(chords): label chord-rhythm and bass options with their meter

Both selects now read 'Sustained · 4/4' in 4/4 and 'Sustained · 4/4 → 6/8'
elsewhere, with a title saying whether the hits will be trimmed, looped or
re-grouped. Every pattern stays listed and selectable in every meter, per the
spec: the user keeps the freedom to run a 4/4 pattern in 6/8, the label just
stops the result being a surprise.

Completes the labelling half of the spec's UI section."
```

---

## Bucket B — native 3/4 and 6/8 content

**Musical brief for every task in this bucket.**

- **3/4** is `accentGroups: [4, 4, 4]` — twelve 16th steps, three quarter-note beats at steps **0, 4, 8**. The eighth notes fall at 0, 2, 4, 6, 8, 10. Idiom: strong-weak-weak; oom-pah-pah; the jazz-waltz push on the "and of 2" (step 6).
- **6/8** is `accentGroups: [6, 6]` — also twelve 16th steps, but **two** dotted-quarter beats at steps **0 and 6**. Its six eighth notes fall at the same steps 0, 2, 4, 6, 8, 10, with each beat subdividing into three of them (0-2-4 and 6-8-10). Idiom: accents in twos with an internal triplet feel; the Afro-Cuban 6/8 bell; the last eighth of each beat (steps 4 and 10) as the characteristic push.
- **The two meters are the same length.** A pattern that merely fills twelve steps does not choose between them; only *where the accents land* does. So every pattern below is checked against one question: **would this read as the other meter?** A 3/4 pattern must put weight on 0/4/8; a 6/8 pattern must put weight on 0/6 and lean on 4/10. Steps 0, 2, 6, 8, 10 alone are ambiguous — an unaccented six-eighth row is the same set in both — which is exactly why `accentGroups` exists and why velocity and the kick/snare skeleton do the discriminating.
- **Never author for 12/8, 5/4 or 7/8.** They stay served by trim/loop of 4/4 material.
- **Append, never insert.** New entries go at the end of their library so the existing 4/4 entries keep their index and order, which several tests rely on.

### Task 6: Three native 3/4 chord rhythms, and the acceptance pin opens up

**Files:**
- Modify: `src/audio/rhythmPatterns.ts` (append three entries to `RHYTHM_PATTERNS`, `:68-267`)
- Test: `src/audio/rhythmPatterns.test.ts:45-63`, `src/audio/meterRegression.test.ts:109-132`

**Interfaces:**
- Consumes: `RhythmPattern`, `RhythmHit`, and the two local constructors `block(step, velocity = 1, holdSteps = 1)` (`rhythmPatterns.ts:46-51`) and `strum(step, direction, velocity = 1, holdSteps = 2, spreadMs = 30)` (`:53-66`).
- Produces: three new ids in `RHYTHM_PATTERNS` — `waltzOompah`, `jazzWaltzComp`, `waltzArpRoll` — all `meter: '3/4'`, all `style: 'Waltz'` (a new `RHYTHM_STYLE_GROUPS` group, appended last).

**The material.**

| id | onsets (steps) | why it is 3/4 and not 6/8 |
|---|---|---|
| `waltzOompah` | 0 (bass note, octave down), 4, 8 | The literal three-beat waltz: one low "oom" on beat 1, two chord "pahs" on beats 2 and 3. Onsets 0/4/8 are the [4,4,4] beat set; in [6,6] step 4 is mid-beat and step 8 is mid-beat, so this cannot read as 6/8. |
| `jazzWaltzComp` | 0, 6, 10 | The jazz-waltz anticipation: beat 1, the "and of 2", the "and of 3". Step 6 is a *weak* offbeat in 3/4 — in 6/8 it would be the beat-2 downbeat, so the velocity shape (0.85, 0.7, 0.6, descending away from beat 1) is what keeps it 3/4. |
| `waltzArpRoll` | 0, 4, 8, all upward strums | Harp/celeste rolls on the three beats; the same [4,4,4] beat set as `waltzOompah` but a different articulation, so a vibe's dice has a real choice within the meter. |

- [ ] **Step 1: Write the failing test**

Replace the `describe('RHYTHM_PATTERNS meter tags', ...)` block at `src/audio/rhythmPatterns.test.ts:45-63` with:

```ts
/**
 * Every shipped pattern id and the meter it is authored in, written out rather
 * than derived, so adding or retagging a pattern is a visible diff here.
 */
const RHYTHM_METERS: [string, MeterId][] = [
  ['sustained', '4/4'],
  ['lofiSwing', '4/4'],
  ['eighthPads', '4/4'],
  ['offbeatStabs', '4/4'],
  ['syncopatedPush', '4/4'],
  ['popBallad8ths', '4/4'],
  ['tripletBallad', '4/4'],
  ['fourOnFloor', '4/4'],
  ['funkSyncopation', '4/4'],
  ['bossaComping', '4/4'],
  ['montunoClave', '4/4'],
  ['offbeatSkank', '4/4'],
  ['arpRollUp', '4/4'],
  ['arpDownEighths', '4/4'],
  ['bassPlusStrum', '4/4'],
  ['waltzOompah', '3/4'],
  ['jazzWaltzComp', '3/4'],
  ['waltzArpRoll', '3/4'],
];

describe('RHYTHM_PATTERNS meter tags', () => {
  test('every pattern is present, in order, with the meter it was written in', () => {
    expect(RHYTHM_PATTERNS.map((p) => [p.id, p.meter])).toEqual(RHYTHM_METERS);
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

  test('no hold rings past its own bar line', () => {
    for (const p of RHYTHM_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const hit of p.hits) {
        expect(hit.step + (hit.holdSteps ?? 1), `${p.id} hold at step ${hit.step}`).toBeLessThanOrEqual(bar);
      }
    }
  });

  test('the three 3/4 patterns accent the [4,4,4] beat set, not [6,6]', () => {
    const onsets = (id: string) =>
      RHYTHM_PATTERNS.find((p) => p.id === id)!.hits.map((h) => h.step);
    expect(onsets('waltzOompah')).toEqual([0, 4, 8]);
    expect(onsets('waltzArpRoll')).toEqual([0, 4, 8]);
    expect(onsets('jazzWaltzComp')).toEqual([0, 6, 10]);
    // The jazz waltz leans away from beat one; if step 6 were the loudest hit
    // this would read as a 6/8 downbeat instead of a 3/4 anticipation.
    const jazz = RHYTHM_PATTERNS.find((p) => p.id === 'jazzWaltzComp')!;
    expect(jazz.hits[0].velocity!).toBeGreaterThan(jazz.hits[1].velocity!);
    expect(jazz.hits[1].velocity!).toBeGreaterThan(jazz.hits[2].velocity!);
  });
});
```

Add `import type { MeterId } from '../utils/meter';` to the file (it already imports `getMeter` at `:3`).

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/audio/rhythmPatterns.test.ts`
Expected: FAIL — the received array stops at `bassPlusStrum`; the three waltz ids are missing.

- [ ] **Step 3: Author the three patterns**

Append inside `RHYTHM_PATTERNS`, after the `bassPlusStrum` entry (`rhythmPatterns.ts:266`) and before the closing `];`:

```ts
  // --- 3/4, accentGroups [4,4,4]: three quarter-note beats at steps 0, 4, 8 ---
  {
    id: 'waltzOompah',
    meter: '3/4',
    name: 'Waltz Oom-Pah-Pah',
    style: 'Waltz',
    description: 'Low root on beat 1, chord on beats 2 and 3 — the literal waltz',
    hits: [
      { step: 0, type: 'block', note: 0, octaveShift: -1, velocity: 0.9, holdSteps: 4 },
      block(4, 0.7, 3),
      block(8, 0.65, 3),
    ],
  },
  {
    id: 'jazzWaltzComp',
    meter: '3/4',
    name: 'Jazz Waltz Comp',
    style: 'Waltz',
    description: 'Beat 1 then the and-of-2 and and-of-3 — the jazz waltz anticipation',
    hits: [block(0, 0.85, 2), block(6, 0.7, 2), block(10, 0.6, 2)],
  },
  {
    id: 'waltzArpRoll',
    meter: '3/4',
    name: 'Waltz Harp Roll',
    style: 'Waltz',
    description: 'Upward roll on each of the three beats',
    hits: [
      strum(0, 'up', 0.9, 3, 40),
      strum(4, 'up', 0.75, 3, 40),
      strum(8, 'up', 0.8, 3, 40),
    ],
  },
```

- [ ] **Step 4: Open the Stage-1 4/4 fence in the acceptance pin**

`src/audio/meterRegression.test.ts` currently asserts that *nothing* declares a non-4/4 meter, which was correct for Stage 1 and is now the thing Stage 2 changes. Replace the whole second `describe` block (`:109-132`) with an explicit 4/4 id-set pin — a strictly stronger guarantee, and one that later tasks never have to touch again because they only ever *add* non-4/4 entries:

```ts
describe('the 4/4 libraries Stage 1 shipped are untouched', () => {
  const FOUR_FOUR_RHYTHM_IDS = [
    'sustained', 'lofiSwing', 'eighthPads', 'offbeatStabs', 'syncopatedPush',
    'popBallad8ths', 'tripletBallad', 'fourOnFloor', 'funkSyncopation',
    'bossaComping', 'montunoClave', 'offbeatSkank', 'arpRollUp',
    'arpDownEighths', 'bassPlusStrum',
  ];
  const FOUR_FOUR_BASS_IDS = [
    'classic-walk', 'swing-double-approach', 'root-fifth-walk', 'dilla-sub',
    'offbeat-sub', 'walking-groove', 'driving-eighths', 'funk-octaves',
    'reggae-one-drop', 'arp-1357', 'half-time-legato', 'whole-note-root',
  ];
  const FOUR_FOUR_DRUM_PATTERN_IDS = [
    'lofi-half-time-brush', 'synthwave-four-on-floor', 'edm-offbeat-pump',
    'ambient-sparse-drift', 'boombap-swung-break', 'zen-bamboo-pulse',
  ];
  const FOUR_FOUR_GENRES = [
    'Synthwave', 'House', 'Trap', 'Boom Bap', 'Cyberpunk', 'DnB', 'Dubstep',
    'Techno', 'Funk', 'Rock', 'Reggae', 'Lo-Fi Hip-Hop',
  ];
  const FOUR_FOUR_VIBE_IDS = [
    'lofi-chill', 'synthwave-80s', 'cyber-dance', 'ambient-chill',
    'hiphop-groove', 'asian-zen',
  ];

  test('the 45 patterns Stage 1 shipped are still there, still 4/4, still in order', () => {
    expect(RHYTHM_PATTERNS.filter((p) => p.meter === '4/4').map((p) => p.id))
      .toEqual(FOUR_FOUR_RHYTHM_IDS);
    expect(BASS_PATTERNS.filter((p) => p.meter === '4/4').map((p) => p.id))
      .toEqual(FOUR_FOUR_BASS_IDS);
    expect(
      Object.entries(VIBE_DRUM_PATTERN_METERS).filter(([, m]) => m === '4/4').map(([id]) => id),
    ).toEqual(FOUR_FOUR_DRUM_PATTERN_IDS);
    expect(
      Object.entries(GENRE_PRESETS).filter(([, p]) => p.meter === '4/4').map(([g]) => g),
    ).toEqual(FOUR_FOUR_GENRES);
    expect(INSTANT_VIBES.filter((v) => v.meter === '4/4').map((v) => v.id))
      .toEqual(FOUR_FOUR_VIBE_IDS);
  });

  test('every non-4/4 pattern Stage 2 adds is 3/4 or 6/8 — nothing else is authored', () => {
    // 12/8, 5/4 and 7/8 stay served by trim/loop of 4/4 material, by decision.
    const authored: (MeterId | undefined)[] = [
      ...RHYTHM_PATTERNS.map((p) => p.meter),
      ...BASS_PATTERNS.map((p) => p.meter),
      ...Object.values(VIBE_DRUM_PATTERN_METERS),
      ...Object.values(GENRE_PRESETS).map((p) => p.meter),
      ...INSTANT_VIBES.map((v) => v.meter),
    ];
    for (const m of authored) {
      expect(['4/4', '3/4', '6/8']).toContain(m);
    }
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

Then scope the two identity tests in the first `describe` to 4/4 only — they assert that adapting to a 16-step bar is a no-op, which is true of 4/4 sources and false of a 12-step source (which would loop). At `:91-97`:

```ts
  test('adapting any 4/4 row to a 16-step bar is the identity', () => {
    for (const preset of Object.values(GENRE_PRESETS)) {
      if (preset.meter !== '4/4') continue;
      for (const row of Object.values(preset.rows)) {
        expect(adaptStepRow(row, 16)).toEqual(row);
      }
    }
  });
```

and at `:99-106`:

```ts
  test('adapting any shipped 4/4 rhythm or bass pattern to a 16-step bar is the identity', () => {
    for (const p of RHYTHM_PATTERNS) {
      if (p.meter !== '4/4') continue;
      expect(adaptStepEvents(p.hits, 16, 16)).toEqual([...p.hits].sort((a, b) => a.step - b.step));
    }
    for (const p of BASS_PATTERNS) {
      if (p.meter !== '4/4') continue;
      expect(adaptStepEvents(p.steps, 16, 16)).toEqual([...p.steps].sort((a, b) => a.step - b.step));
    }
  });
```

Add `import type { MeterId } from '../utils/meter';` to the file's existing `utils/meter` import.

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun test src/audio/rhythmPatterns.test.ts src/audio/meterRegression.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full gate**

Run: `bun run verify`
Expected: PASS. Nothing consumes the new patterns yet, so no other suite should move.

- [ ] **Step 7: Commit**

```bash
git add src/audio/rhythmPatterns.ts src/audio/rhythmPatterns.test.ts src/audio/meterRegression.test.ts
git commit -m "feat(chords): author three native 3/4 chord rhythms

waltzOompah (low root on 1, chord on 2 and 3), jazzWaltzComp (1, and-of-2,
and-of-3, velocities descending away from beat one) and waltzArpRoll (upward
rolls on the three beats). All tagged 3/4 and grouped under a new 'Waltz' style,
appended so the fifteen 4/4 entries keep their order.

The meter-tag test becomes an explicit id-to-meter list, and meterRegression's
Stage-1 'nothing is non-4/4' fence becomes an id-set pin on the 45 patterns
Stage 1 shipped plus a guard that Stage 2 authors only 3/4 and 6/8. That is a
deliberate, reviewed change of intent, not a test bent to fit: the assertion it
replaces was written to expire at Stage 2."
```

---

### Task 7: Two native 3/4 bass patterns

**Files:**
- Modify: `src/audio/bassPatterns.ts` (append two entries to `BASS_PATTERNS`, `:143-290`)
- Test: `src/audio/bassPatterns.test.ts:123-149`

**Interfaces:**
- Consumes: `BassPattern`, `BassStep`, `BassNoteToken` (`'root' | 'third' | 'fifth' | 'seventh' | 'octave' | 'approachChromaticAbove' | 'approachChromaticBelow' | 'approachDiatonicUp' | 'approachFifthOfNext' | 'rest'`, `bassPatterns.ts:8-12`); `BASS_STYLE_GROUPS = groupByStyle(BASS_PATTERNS)` (`:292`).
- Produces: two new ids — `waltz-root-fifth`, `waltz-walking-three` — both `meter: '3/4'`, both `style: 'Waltz'`.

**The material.**

| id | steps | reasoning |
|---|---|---|
| `waltz-root-fifth` | 0 `root` hold 3, 4 `fifth` hold 3, 8 `octave` hold 3 | The rising waltz bass. One note per beat on the [4,4,4] set, each filling its beat and stopping short of the next so beats stay articulated. |
| `waltz-walking-three` | 0 `root` hold 4, 4 `third` hold 4, 8 `approachChromaticBelow` hold 4 `alternate` | The jazz-waltz walking line: three quarter notes, the third leading chromatically into the next chord's root. `alternate: true` flips above/below on odd `chordIndex`, matching `classic-walk`'s convention. The hold of 4 at step 8 ends exactly on the bar line (8 + 4 = 12). |

Note the approach-token contract from the music-theory skill: `approach*` targets the **next** chord's root, not the current one (`isApproachToken`, `bassPatterns.ts:139`), and `useChordPlayback.ts:191` gates it to the last bar via `lastBarOnly`. Both hold here because the pattern is one bar.

- [ ] **Step 1: Write the failing test**

Replace `describe('BASS_STYLE_GROUPS', ...)` and `describe('BASS_PATTERNS meter tags', ...)` at `src/audio/bassPatterns.test.ts:123-149` with:

```ts
describe('BASS_STYLE_GROUPS', () => {
  test('groups patterns by style in dropdown order', () => {
    expect(BASS_STYLE_GROUPS.map((g) => g.style)).toEqual([
      'Walking',
      'Grooves',
      'Minimal',
      'Waltz',
    ]);
    expect(BASS_STYLE_GROUPS.flatMap((g) => g.patterns)).toHaveLength(BASS_PATTERNS.length);
  });
});

const BASS_METERS: [string, MeterId][] = [
  ['classic-walk', '4/4'],
  ['swing-double-approach', '4/4'],
  ['root-fifth-walk', '4/4'],
  ['dilla-sub', '4/4'],
  ['offbeat-sub', '4/4'],
  ['walking-groove', '4/4'],
  ['driving-eighths', '4/4'],
  ['funk-octaves', '4/4'],
  ['reggae-one-drop', '4/4'],
  ['arp-1357', '4/4'],
  ['half-time-legato', '4/4'],
  ['whole-note-root', '4/4'],
  ['waltz-root-fifth', '3/4'],
  ['waltz-walking-three', '3/4'],
];

describe('BASS_PATTERNS meter tags', () => {
  test('every pattern is present, in order, with the meter it was written in', () => {
    expect(BASS_PATTERNS.map((p) => [p.id, p.meter])).toEqual(BASS_METERS);
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

  test('no hold rings past its own bar line', () => {
    for (const p of BASS_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const s of p.steps) {
        expect(s.step + (s.holdSteps ?? 1), `${p.id} hold at step ${s.step}`).toBeLessThanOrEqual(bar);
      }
    }
  });

  test('both 3/4 lines put one note on each of the [4,4,4] beats', () => {
    for (const id of ['waltz-root-fifth', 'waltz-walking-three']) {
      const p = BASS_PATTERNS.find((x) => x.id === id)!;
      expect(p.steps.map((s) => s.step), id).toEqual([0, 4, 8]);
    }
  });
});
```

Add `import type { MeterId } from '../utils/meter';` (the file already imports `getMeter` at `:5`).

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: FAIL — `BASS_STYLE_GROUPS` has no `'Waltz'` group and the id list stops at `whole-note-root`.

- [ ] **Step 3: Author the two patterns**

Append inside `BASS_PATTERNS`, after the `whole-note-root` entry (`bassPatterns.ts:289`) and before the closing `];`:

```ts
  // --- 3/4, accentGroups [4,4,4]: one note per beat at steps 0, 4, 8 ---
  {
    id: 'waltz-root-fifth',
    meter: '3/4',
    name: 'Waltz Root–5th',
    style: 'Waltz',
    description: 'Rising root, 5th, octave — one note on each of the three beats',
    steps: [
      { step: 0, note: 'root', holdSteps: 3 },
      { step: 4, note: 'fifth', holdSteps: 3, velocity: 0.8 },
      { step: 8, note: 'octave', holdSteps: 3, velocity: 0.75 },
    ],
  },
  {
    id: 'waltz-walking-three',
    meter: '3/4',
    name: 'Waltz Walking Three',
    style: 'Waltz',
    description: 'Jazz-waltz quarter notes: root, 3rd, chromatic approach to the next root',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 4, note: 'third', holdSteps: 4 },
      { step: 8, note: 'approachChromaticBelow', holdSteps: 4, alternate: true },
    ],
  },
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `bun run verify`
Expected: PASS. `meterRegression`'s 4/4 id-set pin still holds because the two entries were appended.

- [ ] **Step 6: Commit**

```bash
git add src/audio/bassPatterns.ts src/audio/bassPatterns.test.ts
git commit -m "feat(bass): author two native 3/4 bass patterns

waltz-root-fifth walks root/5th/octave one note per beat; waltz-walking-three is
the jazz-waltz line ending on a chromatic approach into the next chord's root,
alternating above/below per chord like classic-walk. Both tagged 3/4 under a new
'Waltz' style, appended so the twelve 4/4 entries keep their order.

BASS_STYLE_GROUPS' pinned style order gains 'Waltz' at the end."
```

---

### Task 8: Three native 6/8 chord rhythms

**Files:**
- Modify: `src/audio/rhythmPatterns.ts` (append three entries)
- Test: `src/audio/rhythmPatterns.test.ts` (extend `RHYTHM_METERS` and add a 6/8 block)

**Interfaces:**
- Consumes: `RhythmPattern`, `RhythmHit`, `block`, `strum` — as Task 6.
- Produces: three new ids — `compoundEighthPads`, `afroBellComp`, `sixEightBallad` — all `meter: '6/8'`, all `style: '6/8'` (a new group, appended after `'Waltz'`).

**The material.**

| id | onsets (steps) | why it is 6/8 and not 3/4 |
|---|---|---|
| `compoundEighthPads` | 0, 2, 4, 6, 8, 10 | The six eighths — a step set that is *identical* in 3/4 and 6/8, so the velocities are the meter: accents of 0.95 at step 0 and 0.85 at step 6 (the two dotted-quarter beats) with 0.7 everywhere else. In 3/4 the accents would fall at 0, 4 and 8. This pattern is deliberately the demonstration case for why `accentGroups` exists. |
| `afroBellComp` | 0, 4, 6, 10 | The one-bar Afro-Cuban 6/8 bell cell, `X . X X . X` over the six eighths (eighth positions 0, 2, 3, 5). Steps 4 and 10 are the *last* eighth of each dotted-quarter beat — the compound push. In 3/4 that set reads as beat 1, beat 2, and-of-2, and-of-3, which is nobody's waltz. |
| `sixEightBallad` | 0 hold 6, 6 hold 6 | One sustained chord per dotted-quarter beat. Two events of exactly six steps each is the [6,6] grouping stated as plainly as it can be; a 3/4 equivalent would be three events of four. |

- [ ] **Step 1: Write the failing test**

In `src/audio/rhythmPatterns.test.ts`, extend `RHYTHM_METERS` with three rows after `['waltzArpRoll', '3/4']`:

```ts
  ['compoundEighthPads', '6/8'],
  ['afroBellComp', '6/8'],
  ['sixEightBallad', '6/8'],
```

and append a new describe block:

```ts
describe('the 6/8 chord rhythms group in twos, not threes', () => {
  const byId = (id: string) => RHYTHM_PATTERNS.find((p) => p.id === id)!;

  test('compoundEighthPads plays all six eighths but accents only the two beats', () => {
    const p = byId('compoundEighthPads');
    expect(p.hits.map((h) => h.step)).toEqual([0, 2, 4, 6, 8, 10]);
    // The step set alone is meter-blind — 3/4 has the same six eighths. The
    // accents are what make it 6/8: loud at 0 and 6, not at 0, 4 and 8.
    const accented = p.hits.filter((h) => h.velocity! >= 0.85).map((h) => h.step);
    expect(accented).toEqual([0, 6]);
  });

  test('afroBellComp is the one-bar 6/8 bell cell', () => {
    expect(byId('afroBellComp').hits.map((h) => h.step)).toEqual([0, 4, 6, 10]);
  });

  test('sixEightBallad is exactly one held chord per dotted-quarter beat', () => {
    const p = byId('sixEightBallad');
    expect(p.hits.map((h) => h.step)).toEqual([0, 6]);
    expect(p.hits.map((h) => h.holdSteps)).toEqual([6, 6]);
  });

  test('no 6/8 pattern accents the 3/4 beat set, and no 3/4 pattern accents the 6/8 one', () => {
    const strongOnsets = (id: string) =>
      byId(id).hits.filter((h) => (h.velocity ?? 1) >= 0.85).map((h) => h.step);
    for (const id of ['compoundEighthPads', 'afroBellComp', 'sixEightBallad']) {
      expect(strongOnsets(id), id).not.toEqual([0, 4, 8]);
    }
    for (const id of ['waltzOompah', 'waltzArpRoll']) {
      expect(strongOnsets(id), id).not.toEqual([0, 6]);
    }
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/audio/rhythmPatterns.test.ts`
Expected: FAIL — the three 6/8 ids are missing from `RHYTHM_PATTERNS`.

- [ ] **Step 3: Author the three patterns**

Append inside `RHYTHM_PATTERNS`, after `waltzArpRoll`:

```ts
  // --- 6/8, accentGroups [6,6]: TWO dotted-quarter beats at steps 0 and 6 ---
  // Same twelve steps as 3/4 above; the difference is entirely where the weight
  // lands. Nothing below may accent 0/4/8, or it reads as a waltz.
  {
    id: 'compoundEighthPads',
    meter: '6/8',
    name: '6/8 Compound Pads',
    style: '6/8',
    description: 'All six eighths, accented in twos of three — the compound pulse',
    hits: [
      block(0, 0.95, 2),
      block(2, 0.7, 2),
      block(4, 0.7, 2),
      block(6, 0.85, 2),
      block(8, 0.7, 2),
      block(10, 0.7, 2),
    ],
  },
  {
    id: 'afroBellComp',
    meter: '6/8',
    name: 'Afro 6/8 Bell Comp',
    style: '6/8',
    description: 'Chord stabs on the Afro-Cuban 6/8 bell cell',
    hits: [block(0, 0.9, 2), block(4, 0.7, 1.5), block(6, 0.85, 2), block(10, 0.7, 2)],
  },
  {
    id: 'sixEightBallad',
    meter: '6/8',
    name: '6/8 Ballad',
    style: '6/8',
    description: 'One held chord per dotted-quarter beat',
    hits: [block(0, 0.9, 6), block(6, 0.8, 6)],
  },
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/audio/rhythmPatterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio/rhythmPatterns.ts src/audio/rhythmPatterns.test.ts
git commit -m "feat(chords): author three native 6/8 chord rhythms

compoundEighthPads plays the six eighths and accents only steps 0 and 6, which
is the whole point: 3/4 and 6/8 share a twelve-step bar and the same six eighth
positions, so the accent is the meter. afroBellComp is the one-bar Afro-Cuban
bell cell (0, 4, 6, 10 — the last eighth of each beat is the push). sixEightBallad
is one six-step held chord per dotted-quarter beat.

A test pins that no 6/8 pattern accents the 3/4 beat set and no 3/4 pattern
accents the 6/8 one, so the two libraries cannot quietly converge."
```

---

### Task 9: Two native 6/8 bass patterns

**Files:**
- Modify: `src/audio/bassPatterns.ts` (append two entries)
- Test: `src/audio/bassPatterns.test.ts` (extend `BASS_METERS`, `BASS_STYLE_GROUPS` order, add a 6/8 block)

**Interfaces:**
- Consumes: `BassPattern`, `BassStep`, `BassNoteToken` — as Task 7.
- Produces: two new ids — `six-eight-root-pulse`, `afro-six-eight-tumbao` — both `meter: '6/8'`, both `style: '6/8'`.

**The material.**

| id | steps | reasoning |
|---|---|---|
| `six-eight-root-pulse` | 0 `root` hold 6, 6 `fifth` hold 6 | One note per dotted-quarter beat, each filling its beat exactly. The bass equivalent of `sixEightBallad`, and the plainest possible statement of [6,6]. |
| `afro-six-eight-tumbao` | 0 `root` hold 4, 6 `fifth` hold 2 (vel 0.85), 10 `octave` hold 2 (vel 0.8) | The compound tumbao shape: beat 1, beat 2, and the last eighth of beat 2 pushing into the next bar. Onsets 0/6/10 match the `Afro 6/8` sequencer preset's `bass` row (Task 10), so the two libraries agree about what this groove is. |

- [ ] **Step 1: Write the failing test**

In `src/audio/bassPatterns.test.ts`, extend `BASS_STYLE_GROUPS`' pinned order and `BASS_METERS`:

```ts
    expect(BASS_STYLE_GROUPS.map((g) => g.style)).toEqual([
      'Walking',
      'Grooves',
      'Minimal',
      'Waltz',
      '6/8',
    ]);
```

```ts
  ['six-eight-root-pulse', '6/8'],
  ['afro-six-eight-tumbao', '6/8'],
```

and append:

```ts
describe('the 6/8 bass lines lean on steps 0 and 6, never on 4 and 8', () => {
  const byId = (id: string) => BASS_PATTERNS.find((p) => p.id === id)!;

  test('six-eight-root-pulse is one note per dotted-quarter beat', () => {
    const p = byId('six-eight-root-pulse');
    expect(p.steps.map((s) => s.step)).toEqual([0, 6]);
    expect(p.steps.map((s) => s.holdSteps)).toEqual([6, 6]);
    expect(p.steps.map((s) => s.note)).toEqual(['root', 'fifth']);
  });

  test('afro-six-eight-tumbao pushes off the last eighth of beat two', () => {
    const p = byId('afro-six-eight-tumbao');
    expect(p.steps.map((s) => s.step)).toEqual([0, 6, 10]);
    expect(p.steps.map((s) => s.note)).toEqual(['root', 'fifth', 'octave']);
  });

  test('neither 6/8 line lands on the 3/4 beat set', () => {
    for (const id of ['six-eight-root-pulse', 'afro-six-eight-tumbao']) {
      const steps = byId(id).steps.map((s) => s.step);
      expect(steps, id).not.toContain(4);
      expect(steps, id).not.toContain(8);
    }
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: FAIL — no `'6/8'` style group, and both ids are missing.

- [ ] **Step 3: Author the two patterns**

Append inside `BASS_PATTERNS`, after `waltz-walking-three`:

```ts
  // --- 6/8, accentGroups [6,6]: TWO dotted-quarter beats at steps 0 and 6 ---
  {
    id: 'six-eight-root-pulse',
    meter: '6/8',
    name: '6/8 Root Pulse',
    style: '6/8',
    description: 'Root then 5th, one held note per dotted-quarter beat',
    steps: [
      { step: 0, note: 'root', holdSteps: 6 },
      { step: 6, note: 'fifth', holdSteps: 6 },
    ],
  },
  {
    id: 'afro-six-eight-tumbao',
    meter: '6/8',
    name: 'Afro 6/8 Tumbao',
    style: '6/8',
    description: 'Both beats plus an octave push on the last eighth of beat 2',
    steps: [
      { step: 0, note: 'root', holdSteps: 4 },
      { step: 6, note: 'fifth', holdSteps: 2, velocity: 0.85 },
      { step: 10, note: 'octave', holdSteps: 2, velocity: 0.8 },
    ],
  },
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio/bassPatterns.ts src/audio/bassPatterns.test.ts
git commit -m "feat(bass): author two native 6/8 bass patterns

six-eight-root-pulse holds one note per dotted-quarter beat; afro-six-eight-tumbao
adds the octave push on the last eighth of beat two, matching the onsets of the
Afro 6/8 sequencer preset's bass row. Neither touches steps 4 or 8, so neither
can read as a waltz. Both tagged 6/8 under a new '6/8' style, appended."
```

---

### Task 10: Two native sequencer genre presets — `Waltz` (3/4) and `Afro 6/8` (6/8)

**Files:**
- Modify: `src/audio/data/genrePresets.ts` (append two entries to `GENRE_PRESETS`), `src/audio/drumKits.ts:183-196` (`GENRE_TO_KIT`)
- Test: `src/audio/data/genrePresets.test.ts`

**Interfaces:**
- Consumes: `GenrePreset { meter: MeterId; rows: Record<string, boolean[]> }` (`genrePresets.ts:14-17`); the seven required row keys `kick`, `snare`, `hihat`, `openhat`, `clap`, `tom`, `bass` (pinned by `genrePresets.test.ts`); `GENRE_TO_KIT: Record<string, string>` and the twelve kit names in `DRUM_KITS` (`drumKits.ts:73-181`).
- Produces: two new `GENRE_PRESETS` keys — `'Waltz'` (3/4) and `'Afro 6/8'` (6/8) — and the matching `GENRE_TO_KIT` entries `'Waltz': 'Acoustic Studio'` and `'Afro 6/8': 'Warm Riddim'`, both of which are existing kit names.

**Why `GENRE_TO_KIT` must change in the same commit.** `src/audio/drumKits.test.ts` asserts `Object.keys(GENRE_TO_KIT).sort()` equals `Object.keys(GENRE_PRESETS).sort()` — a one-sided edit makes `SequencerView.tsx:60` fall through to `?? selectedGenre` and select no kit at all. Verified on this branch.

**The rows.** Twelve booleans each, one line per row, matching the file's existing style.

`Waltz`, 3/4, beats at 0/4/8 — the oom-pah-pah skeleton:

| row | steps | reasoning |
|---|---|---|
| kick | 0 | The "oom". One kick per bar is what makes a waltz a waltz. |
| snare | 4, 8 | The two "pahs" on beats 2 and 3. This is the pattern's meter signature: a 6/8 reading would need weight at 6. |
| hihat | 0, 2, 4, 6, 8, 10 | The six eighths. |
| openhat | 10 | The and-of-3 lift into the next bar. |
| clap | 8 | Reinforces beat 3 only, so the two "pahs" are not identical. |
| tom | 11 | Last-16th pickup. |
| bass | 0, 8 | Root on 1 and 3 — the standard waltz bass placement. |

`Afro 6/8`, 6/8, beats at 0/6 — the compound skeleton:

| row | steps | reasoning |
|---|---|---|
| kick | 0, 6 | The two dotted-quarter beats. In 3/4 this would be beat 1 and the and-of-2, which no waltz kick does — this row alone settles the meter. |
| snare | 4, 10 | The last eighth of each beat: the characteristic Afro 6/8 push. Asymmetric under [4,4,4], so it cannot read as a 3/4 backbeat. |
| hihat | 0, 2, 4, 6, 8, 10 | The six eighths, i.e. the triplet subdivision of the two beats. |
| openhat | 8 | Middle eighth of beat 2 — internal motion without doubling the kick. |
| clap | 4, 10 | Doubles the snare, the convention every other preset in this file follows. |
| tom | 11 | Last-16th pickup. |
| bass | 0, 6, 10 | Both beats plus the push, matching `afro-six-eight-tumbao` from Task 9. |

- [ ] **Step 1: Write the failing test**

In `src/audio/data/genrePresets.test.ts`, extend the `GENRES` literal with the two new keys and **replace** the test `'Stage 1 ships every genre at 4/4 — authoring other meters is Stage 2'` with an explicit map. That test was written to expire at Stage 2; deleting it is the point of this task, not a workaround.

```ts
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
  'Waltz',
  'Afro 6/8',
];

const GENRE_METERS: Record<string, string> = {
  Synthwave: '4/4',
  House: '4/4',
  Trap: '4/4',
  'Boom Bap': '4/4',
  Cyberpunk: '4/4',
  DnB: '4/4',
  Dubstep: '4/4',
  Techno: '4/4',
  Funk: '4/4',
  Rock: '4/4',
  Reggae: '4/4',
  'Lo-Fi Hip-Hop': '4/4',
  Waltz: '3/4',
  'Afro 6/8': '6/8',
};
```

```ts
  test('every genre carries the meter it was authored in', () => {
    for (const genre of GENRES) {
      expect(GENRE_PRESETS[genre].meter, genre).toBe(GENRE_METERS[genre]);
    }
  });
```

and append:

```ts
describe('the two non-4/4 genres state their meter through their accents', () => {
  const on = (genre: string, row: string) =>
    GENRE_PRESETS[genre].rows[row].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  test('Waltz is oom-pah-pah on the [4,4,4] beat set', () => {
    expect(on('Waltz', 'kick')).toEqual([0]);
    expect(on('Waltz', 'snare')).toEqual([4, 8]);
    expect(on('Waltz', 'bass')).toEqual([0, 8]);
  });

  test('Afro 6/8 kicks the two dotted-quarter beats and pushes off 4 and 10', () => {
    expect(on('Afro 6/8', 'kick')).toEqual([0, 6]);
    expect(on('Afro 6/8', 'snare')).toEqual([4, 10]);
    expect(on('Afro 6/8', 'bass')).toEqual([0, 6, 10]);
  });

  test('the two twelve-step genres are not the same pattern under two names', () => {
    // Both bars are twelve steps. If the kicks ever matched, one of them would
    // be mislabelled — bar length cannot tell 3/4 from 6/8.
    expect(on('Waltz', 'kick')).not.toEqual(on('Afro 6/8', 'kick'));
    expect(on('Waltz', 'snare')).not.toEqual(on('Afro 6/8', 'snare'));
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/audio/data/genrePresets.test.ts src/audio/drumKits.test.ts`
Expected: FAIL — `GENRE_PRESETS.Waltz` is undefined, and `drumKits.test.ts`'s key-set parity test fails once the presets land, so both are red for the right reasons.

- [ ] **Step 3: Author the two presets**

Append inside `GENRE_PRESETS`, after the `"Lo-Fi Hip-Hop"` entry (`genrePresets.ts:163`) and before the closing `};`:

```ts
  // --- 3/4, accentGroups [4,4,4]: twelve steps, beats at 0, 4, 8 ---
  Waltz: {
    meter: '3/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, false, false, false, false, false, true, false, false, false],
    },
  },
  // --- 6/8, accentGroups [6,6]: twelve steps, but only TWO beats, at 0 and 6 ---
  // Same bar length as Waltz above and deliberately unmistakable for it: the
  // kick sits on 0 and 6 rather than 0 alone, and the snare pushes off the last
  // eighth of each beat (4 and 10) rather than landing on beats 2 and 3.
  'Afro 6/8': {
    meter: '6/8',
    rows: {
      kick: [true, false, false, false, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, true, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, true, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, false, false, false, true, false, false, false, true, false],
    },
  },
```

- [ ] **Step 4: Map both genres to a kit**

In `src/audio/drumKits.ts`, append to `GENRE_TO_KIT` (`:183-196`):

```ts
  'Waltz': 'Acoustic Studio',
  'Afro 6/8': 'Warm Riddim',
```

Both names already exist in `DRUM_KITS` (`:154` and `:163`). No new kit is added, so `bun run check:drums` (the audible-separation invariant) is unaffected.

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun test src/audio/data/genrePresets.test.ts src/audio/drumKits.test.ts src/audio/meterRegression.test.ts`
Expected: PASS. `meterRegression`'s 4/4 genre list still matches because the two entries were appended.

- [ ] **Step 6: Check the picker in the new meters**

Run: `bun test src/components/SequencerView.test.tsx`
Expected: PASS — and note that Task 4's labelling now has real content to label: in 3/4 the dropdown reads `Waltz · 3/4` alongside `Synthwave · 4/4 → 3/4`.

- [ ] **Step 7: Run the full gate**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/audio/data/genrePresets.ts src/audio/data/genrePresets.test.ts src/audio/drumKits.ts
git commit -m "feat(sequencer): author Waltz (3/4) and Afro 6/8 genre presets

Two twelve-step presets that are deliberately unmistakable for each other:
Waltz kicks step 0 alone with snares on beats 2 and 3 (steps 4 and 8); Afro 6/8
kicks both dotted-quarter beats (0 and 6) and pushes the snare off the last
eighth of each (4 and 10). Bar length cannot tell the two meters apart — only
the accents can — and a test pins that their kick and snare rows never match.

GENRE_TO_KIT gains both keys (Acoustic Studio, Warm Riddim, both existing kits);
drumKits.test.ts pins that key set against GENRE_PRESETS, so a one-sided edit
would make the genre select no kit at all.

genrePresets.test.ts's 'Stage 1 ships every genre at 4/4' assertion is replaced
by an explicit genre-to-meter map. That assertion was written to expire here."
```

---

### Task 11: Two native vibe drum patterns

**Files:**
- Modify: `src/audio/data/vibeDrumPatterns.ts` (`VIBE_DRUM_PATTERNS` `:23-78` and `VIBE_DRUM_PATTERN_METERS` `:112-119`)
- Test: `src/audio/data/vibeDrumPatterns.test.ts`

**Interfaces:**
- Consumes: `VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>>`; the seven required row keys `kick`, `snare`, `hihat`, `openhat`, `clap`, `tom`, `crash` (note: `crash` here, `bass` in `GENRE_PRESETS` — the two libraries are deliberately separate, see the note at `vibeDrumPatterns.ts:9-15`); cells must be literal `0` or `1`.
- Produces: `'waltz-brush-three'` (3/4) and `'afro-six-eight-bell'` (6/8), each with a matching `VIBE_DRUM_PATTERN_METERS` entry.

**The rows.** Twelve cells each.

`waltz-brush-three`, 3/4 — the jazz-waltz brush kit behind `lofi-waltz` (Task 12):

| row | steps | reasoning |
|---|---|---|
| kick | 0 | Beat 1 only. **Every openhat/tom density candidate the vibe lists must avoid step 0** — see Task 12. |
| snare | 4 | Beat 2 brush accent; beat 3 is left to the clap so the two weak beats differ. |
| hihat | 0, 2, 4, 6, 8, 10 | The six eighths. |
| openhat | 10 | And-of-3 lift. |
| clap | 8 | Beat 3. |
| tom | 11 | Last-16th pickup. |
| crash | 0 | Downbeat, as every other entry in this library does. |

`afro-six-eight-bell`, 6/8 — behind `afro-six-eight` (Task 13):

| row | steps | reasoning |
|---|---|---|
| kick | 0, 6 | The two dotted-quarter beats. Constrains the vibe's density pools hard: see Task 13. |
| snare | 4, 10 | The compound push. |
| hihat | 0, 2, 4, 6, 8, 10 | The six eighths — the triplet subdivision that makes the bell cell legible. Kept as a steady pulse rather than the bell cell itself, so it does not collide with the kick and snare on every stroke. |
| openhat | 8 | Middle eighth of beat 2. |
| clap | 4, 10 | Doubles the snare. |
| tom | 2 | Middle eighth of beat 1 — a conga-ish accent that deliberately avoids the kick's 0 and 6. |
| crash | 0 | Downbeat. |

- [ ] **Step 1: Write the failing test**

In `src/audio/data/vibeDrumPatterns.test.ts`, extend `LIBRARY_IDS` and replace the test `'every library id has a meter tag, and Stage 1 ships them all at 4/4'` with an explicit map:

```ts
const LIBRARY_IDS = [
  'lofi-half-time-brush',
  'synthwave-four-on-floor',
  'edm-offbeat-pump',
  'ambient-sparse-drift',
  'boombap-swung-break',
  'zen-bamboo-pulse',
  'waltz-brush-three',
  'afro-six-eight-bell',
];

const LIBRARY_METERS: Record<string, string> = {
  'lofi-half-time-brush': '4/4',
  'synthwave-four-on-floor': '4/4',
  'edm-offbeat-pump': '4/4',
  'ambient-sparse-drift': '4/4',
  'boombap-swung-break': '4/4',
  'zen-bamboo-pulse': '4/4',
  'waltz-brush-three': '3/4',
  'afro-six-eight-bell': '6/8',
};
```

```ts
  test('every library id has the meter it was authored in', () => {
    expect(Object.keys(VIBE_DRUM_PATTERN_METERS).sort()).toEqual([...LIBRARY_IDS].sort());
    for (const id of LIBRARY_IDS) {
      expect(drumPatternMeterId(id), id).toBe(LIBRARY_METERS[id]);
    }
  });
```

Also update `'holds exactly the six vibe pattern ids'` to `'holds exactly the eight vibe pattern ids'` (the body already compares against `LIBRARY_IDS`, so only the title changes). The row-length test at `:27-38` already derives its expectation from `drumPatternMeterId`, so it needs no change — it will require twelve cells for the two new entries automatically. Append:

```ts
describe('the two twelve-step patterns are distinguishable meters, not one pattern twice', () => {
  const on = (id: string, row: string) =>
    VIBE_DRUM_PATTERNS[id][row].map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);

  test('waltz-brush-three is 3/4: one kick, weak beats at 4 and 8', () => {
    expect(on('waltz-brush-three', 'kick')).toEqual([0]);
    expect(on('waltz-brush-three', 'snare')).toEqual([4]);
    expect(on('waltz-brush-three', 'clap')).toEqual([8]);
  });

  test('afro-six-eight-bell is 6/8: kicks on both beats, snare on the pushes', () => {
    expect(on('afro-six-eight-bell', 'kick')).toEqual([0, 6]);
    expect(on('afro-six-eight-bell', 'snare')).toEqual([4, 10]);
  });

  test('their kicks differ, which is the only thing telling the two meters apart', () => {
    expect(on('waltz-brush-three', 'kick')).not.toEqual(on('afro-six-eight-bell', 'kick'));
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/audio/data/vibeDrumPatterns.test.ts`
Expected: FAIL — both ids missing from `VIBE_DRUM_PATTERNS` and `VIBE_DRUM_PATTERN_METERS`.

- [ ] **Step 3: Author the two patterns**

Append inside `VIBE_DRUM_PATTERNS`, after `'zen-bamboo-pulse'` (`vibeDrumPatterns.ts:77`):

```ts
  // --- 3/4, accentGroups [4,4,4]: beats at 0, 4, 8 ---
  'waltz-brush-three': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // --- 6/8, accentGroups [6,6]: only TWO beats, at 0 and 6 ---
  'afro-six-eight-bell': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    tom:     [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
```

Append to `VIBE_DRUM_PATTERN_METERS` (`:112-119`):

```ts
  'waltz-brush-three': '3/4',
  'afro-six-eight-bell': '6/8',
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/audio/data/vibeDrumPatterns.test.ts src/audio/meterRegression.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `bun run verify`
Expected: PASS. No vibe references either pattern yet, so `instantVibesDrums.test.ts` (keyed by vibe id) is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/audio/data/vibeDrumPatterns.ts src/audio/data/vibeDrumPatterns.test.ts
git commit -m "feat(vibes): author waltz-brush-three (3/4) and afro-six-eight-bell (6/8)

Two twelve-step vibe drum patterns for the two vibes that follow. The waltz kicks
step 0 alone with the weak beats at 4 and 8; the Afro pattern kicks both
dotted-quarter beats (0 and 6) and snares the push eighths (4 and 10). Their kick
rows are what tells the two meters apart, and a test pins that they differ.

VIBE_DRUM_PATTERN_METERS gains both ids; the row-length test already derives its
expectation from drumPatternMeterId, so it demands twelve cells automatically."
```

---

### Task 12: The `lofi-waltz` Instant Vibe (3/4)

**Files:**
- Modify: `src/store/instantVibes.ts` (append to `INSTANT_VIBES`, `:128-496`)
- Modify: `src/store/instantVibesChordsFixture.ts`, `src/store/instantVibesDrumsFixture.ts`, `src/store/instantVibesEffectsFixture.ts`
- Test: `src/store/instantVibes.test.ts:11` and `:112`, `src/store/instantVibesDrums.test.ts:21-31`

**Interfaces:**
- Consumes: `InstantVibe` (`src/types.ts:170-232`); `VibeVariation` (`:154-168`); `resolveProgression(progression, root, scaleType, octave)` and `progressionById(id)` (`src/audio/data/chordProgressions.ts`); `drumPatternById(id): Record<string, number[]> | undefined` (`src/audio/data/vibeDrumPatterns.ts:92`); `requireEffectChain(id)` (`src/audio/data/vibeEffectChains.ts`); `presetById(id)` (`src/audio/synthPresets.ts`); `densityRowFor` / `eligibleDensities` from Task 2.
- Produces: `INSTANT_VIBES` entry with `id: 'lofi-waltz'`; entries in all three golden fixtures keyed by that id.

**The vibe, decided from the survey (`bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts lofi`).**

| field | value | why |
|---|---|---|
| `id` / `name` | `'lofi-waltz'` / `'Lo-Fi Waltz'` | New id, no collision with the six existing ids. |
| `meter` | `'3/4'` | Applying the vibe calls `store.setMeter(vibe.meter)` at `instantVibes.ts:75`, before `applyDrumPattern` — that ordering is already pinned by a test and must not be disturbed. |
| `bpm` / `bpmRange` | `96` / `[88, 104]` | Quarter-note tempo (a step is a 16th, `stepDurationSec = 60 / bpm / 4`), so 96 is a moderate waltz. Inside the `50 < bpm < 180` assertion at `instantVibes.test.ts:15`. |
| `variation.genre` | `'lofi'` | Genre here means "which progressions may this vibe draw", not a marketing label. `VibeGenre` is a closed union (`types.ts:11`) and adding a member needs four coordinated edits plus four new progressions — out of scope, and unnecessary: a lo-fi jazz waltz sits squarely inside this pool. |
| `scaleType` | `'Major'` | **Not a choice.** It must equal `VIBE_GENRE_SCALES['lofi']`, and an invariant test recomputes it. |
| `scaleRoot` / `keyPool` | `'F'` / `['C', 'D', 'F', 'G', 'A']` | Pool contains the vibe's own root (pinned by the dice-landing test) and has five members. |
| `progressionId` | `'lofi-rainy-window'` | vim9 – IVmaj7 – ii9 – V7. Four steps, which `instantVibes.test.ts:28` requires. Already in the lofi pool, so its chord qualities are already exercised. |
| `progressionIds` | the **full** computed genre-and-scale-length filter, verbatim | Not a taste call — a subset fails `'progressionIds equals the full genre-and-scale-length filter'`. |
| `chordRhythmId` / `rhythmIds` | `'waltzOompah'` / all three 3/4 rhythms | Every member is 3/4, so the dice cannot reroll the vibe out of its own meter. |
| `bassPatternId` / `bassPatternIds` | `'waltz-root-fifth'` / both 3/4 lines | Two members — the authored minimum, matching `ambient-chill` and `asian-zen`. |
| `drumPatternId` | `'waltz-brush-three'` | Written twice (id and `drumPatternById(id)!`); a typo in the second makes `!` return `undefined` and `Object.entries` throw at apply time. |
| presets | lead `factory-fm-tine-piano`, comp `factory-mellow-epiano`, bass `bass-warm-tri` | Bass must be `category: 'Bass'` — `bass-warm-tri` is. Lead and comp are judged by ear; this trio is deliberately not a copy of `lofi-chill`'s. |
| `effectChainId` | `'lofi-tape-room'` | `requireEffectChain` throws on an unknown id, unlike the `!` used for the other two resolvers. |
| `soundKit` | `'Lo-Fi Vinyl'` | An existing `DRUM_KITS` key. |

**The density pools, verified against the kick.** `waltz-brush-three`'s kick hits step 0 only. Adapting each 16-step catalogue row to 12 steps gives these onsets (computed, not guessed):

| candidate | adapted onsets | verdict |
|---|---|---|
| `off` | — | the deliberate silent member of every pool |
| `quarters` | 0, 4, 8 | collides with the kick → **not eligible for openhat/tom**; fine for hihat, which is exempt, and it is the ideal waltz hat |
| `eighths` | 0, 2, 4, 6, 8, 10 | collides → hihat only |
| `lofi16ths` | 0, 2, 4, 6, 7, 8, 10 | collides → hihat only |
| `and2and4` | 6 | no collision → openhat |
| `offbeat8ths` | 2, 6, 10 | no collision, and it is exactly the three offbeat eighths of 3/4 → openhat |
| `midBar` | 6 | no collision → tom |
| `lateFill` | 7 | no collision → tom |
| `downbeat` | 0 | collides; crash is exempt so it stays usable there |
| `pickup`, `fillTail` | *(none)* | **silent in a twelve-step bar** — must not be listed, and Task 2's invariant rejects them |

Result: **zero candidates are removed by the collision filter**, so `vibeVariation.test.ts`'s global `expect(removed).toBe(1)` stays at 1.

- [ ] **Step 1: Write the failing test**

In `src/store/instantVibes.test.ts`, change the count at `:11` and the describe title:

```ts
    expect(INSTANT_VIBES.length).toBe(7);
```

and append a row to the pinned preset matrix at `:112`:

```ts
      { id: 'lofi-waltz', synthPresetId: 'factory-fm-tine-piano', chordPresetId: 'factory-mellow-epiano', bassPresetId: 'bass-warm-tri' },
```

In `src/store/instantVibesDrums.test.ts`, make the row length meter-derived and add the agreement invariant. Replace the test at `:21-31`:

```ts
  test("every captured pattern is seven rows of its vibe's own bar length, in 0/1", () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const expected = getMeter(vibe.meter).stepsPerBar;
      const pattern = ORIGINAL_VIBE_DRUM_PATTERNS[id];
      expect(Object.keys(pattern).sort()).toEqual([...ROWS].sort());
      for (const row of ROWS) {
        expect(pattern[row].length, `${id}/${row}`).toBe(expected);
        for (const cell of pattern[row]) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });

  test("a vibe's meter and its drum pattern's meter agree", () => {
    // They are declared in two different files. If they drift, the vibe applies
    // a bar of one length into a transport set to another, and applyDrumPattern
    // silently trims or loops the difference.
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(drumPatternMeterId(vibe.drumPatternId), id).toBe(vibe.meter);
    }
  });
```

Extend that file's imports with `getMeter` from `'../utils/meter'` and `drumPatternMeterId` from `'../audio/data/vibeDrumPatterns'`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/store/`
Expected: FAIL in at least four places, each naming `lofi-waltz` or the count — `instantVibes.test.ts` (length 6 ≠ 7), `instantVibesProgressions.test.ts` (fixture key set ≠ `VIBE_IDS`), `instantVibesDrums.test.ts` (same), `instantVibesEffects.test.ts` (same). That fan-out is the point of deriving those fixtures' id lists from `INSTANT_VIBES`.

- [ ] **Step 3: Author the vibe**

Append inside `INSTANT_VIBES`, after the `asian-zen` entry (`instantVibes.ts:495`):

```ts
  {
    id: 'lofi-waltz',
    name: 'Lo-Fi Waltz',
    tagline: 'Dusty three-four turns with jazz keys and a brushed kit',
    emoji: '🎠',
    bpm: 96,
    meter: '3/4',
    scaleRoot: 'F',
    scaleType: 'Major',
    progressionId: 'lofi-rainy-window',

    // Beat: brushed three-four, one kick per bar
    soundKit: 'Lo-Fi Vinyl',
    drumFilterCutoff: 6800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'waltz-brush-three',
    drumPattern: drumPatternById('waltz-brush-three')!,

    // Chords: FM tines comping the literal oom-pah-pah
    chords: resolveProgression(progressionById('lofi-rainy-window')!, 'F', 'Major', 4),
    chordRhythmId: 'waltzOompah',
    chordFeel: 0.72, // Loose, brushed
    chordOctave: 4,
    chordPresetId: 'factory-mellow-epiano',

    // Bass: rising root-5th-octave, one note per beat
    bassPatternId: 'waltz-root-fifth',
    bassFeel: 0.68,
    bassOctave: 2,
    bassPresetId: 'bass-warm-tri',

    // Main Synth: FM tine piano
    synthPresetId: 'factory-fm-tine-piano',

    effectChainId: 'lofi-tape-room',
    effects: requireEffectChain('lofi-tape-room'),

    // lofi-waltz
    variation: {
      genre: 'lofi',
      keyPool: ['C', 'D', 'F', 'G', 'A'],
      bpmRange: [88, 104],
      progressionIds: ['jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop', 'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround'],
      rhythmIds: ['waltzOompah', 'jazzWaltzComp', 'waltzArpRoll'],
      bassPatternIds: ['waltz-root-fifth', 'waltz-walking-three'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          // hihat and crash are exempt from the kick-collision filter, so they
          // may sit on step 0. The other two may not: this kick is step 0 only.
          hihat: ['quarters', 'eighths', 'lofi16ths'],
          openhat: ['off', 'and2and4', 'offbeat8ths'],
          tom: ['off', 'midBar', 'lateFill'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
```

Before committing, re-derive `progressionIds` rather than trusting the literal above:

```bash
bun -e "
const {CHORD_PROGRESSIONS}=await import('./src/audio/data/chordProgressions.ts');
const {SCALES}=await import('./src/utils/musicTheory.ts');
console.log(JSON.stringify(CHORD_PROGRESSIONS
  .filter(p=>p.genres.includes('lofi') && p.minScaleLength<=SCALES['Major'].intervals.length)
  .map(p=>p.id)));
"
```

- [ ] **Step 4: Add the three golden fixture entries**

`src/store/instantVibesChordsFixture.ts` — `lofi-rainy-window` resolved in F Major at octave 4 is `Dmin9 – A#maj7 – Gmin9 – C7`, one bar each (verified with `resolveProgression`). The fixture's ids are its own; only root/quality/bars/notes are compared (`instantVibesProgressions.test.ts:10`). Append:

```ts
  'lofi-waltz': [
    snapshotChord('lw1', 'D', 'min9', 1, 4),
    snapshotChord('lw2', 'A#', 'maj7', 1, 4),
    snapshotChord('lw3', 'G', 'min9', 1, 4),
    snapshotChord('lw4', 'C', '7', 1, 4),
  ],
```

`src/store/instantVibesDrumsFixture.ts` — hand-copied, never imported from the library. Append:

```ts
  'lofi-waltz': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
```

`src/store/instantVibesEffectsFixture.ts` — the `lofi-tape-room` chain, key for key including which keys it omits (no `distortionWet`). Append:

```ts
  'lofi-waltz': {
    reverbWet: 0.35,
    reverbDecay: 2.4,
    delayWet: 0.22,
    delayFeedback: 0.28,
    compressorThreshold: -18,
    eqLow: 3,
    eqMid: 1,
    eqHigh: -2,
  },
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun test src/store/`
Expected: PASS. Watch three results specifically:
- `vibeVariation.test.ts` `'the filter removes exactly one candidate across all authored data'` still expects `1` — the new pools were chosen so nothing is filtered. If it reports 2 or more, a candidate collides with step 0 and the pool, not the number, is wrong.
- `vibeVariation.test.ts` `'no vibe lists a candidate that is silent in that vibe's own meter'` (Task 2) — this is what catches `pickup`/`fillTail` if anyone adds them here.
- `instantVibesDrums.test.ts` now requires twelve cells for this vibe and four hundred and eighty for the rest.

- [ ] **Step 6: Run the full gate**

Run: `bun run verify` then `bun run eslint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/instantVibes.ts src/store/instantVibes.test.ts src/store/instantVibesChordsFixture.ts src/store/instantVibesDrumsFixture.ts src/store/instantVibesEffectsFixture.ts src/store/instantVibesDrums.test.ts
git commit -m "feat(vibes): add the Lo-Fi Waltz vibe, the first non-4/4 vibe

A 3/4 lo-fi jazz waltz in F Major at 96 BPM, resolved entirely from library ids:
lofi-rainy-window, waltzOompah, waltz-root-fifth, waltz-brush-three,
lofi-tape-room, and the fm-tine/mellow-epiano/warm-tri voices. Its variation pool
lists only 3/4 rhythms and bass lines, so the dice cannot reroll it out of its own
meter, and progressionIds is the full computed lofi filter rather than a curated
subset.

The density candidates were chosen against the kick (step 0 only): quarters,
eighths and lofi16ths all hit step 0 and are therefore hihat-only, while openhat
and tom draw from off/and2and4/offbeat8ths and off/midBar/lateFill. pickup and
fillTail are excluded because they trim to silence in a twelve-step bar. Nothing
is removed by the collision filter, so its global count stays at one.

Deliberate, reviewed test changes: INSTANT_VIBES.length 6 -> 7, one row added to
the pinned preset matrix, and instantVibesDrums.test.ts's hard-coded 16-step row
length becomes each vibe's own bar length. All three golden fixtures gain a
hand-copied entry, as they must — they are snapshots, not re-derivations. A new
invariant pins that a vibe's meter and its drum pattern's meter agree."
```

---

### Task 13: The `afro-six-eight` Instant Vibe (6/8)

**Files:**
- Modify: `src/store/instantVibes.ts` (append to `INSTANT_VIBES`)
- Modify: `src/store/instantVibesChordsFixture.ts`, `src/store/instantVibesDrumsFixture.ts`, `src/store/instantVibesEffectsFixture.ts`
- Test: `src/store/instantVibes.test.ts:11` and the preset matrix

**Interfaces:**
- Consumes: exactly the same set as Task 12.
- Produces: `INSTANT_VIBES` entry with `id: 'afro-six-eight'`; entries in all three golden fixtures.

**The vibe, decided from the survey (`bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts boombap`).**

| field | value | why |
|---|---|---|
| `id` / `name` | `'afro-six-eight'` / `'Afro 6/8'` | New id, no collision. |
| `meter` | `'6/8'` | |
| `bpm` / `bpmRange` | `132` / `[126, 138]` | Quarter-note tempo, so a dotted quarter (six 16th steps) is 88 — the middle of the Afro 6/8 band. Inside `50 < bpm < 180`. |
| `variation.genre` | `'boombap'` | Chosen for its **progression pool**, not its label: boombap's anchor scale is Dorian, which is the modal home of Afro-Cuban 6/8 vamps. `VibeGenre` is closed and a new member needs four coordinated edits plus four new progressions; nothing here justifies that. |
| `scaleType` | `'Dorian'` | Fixed by `VIBE_GENRE_SCALES['boombap']`; an invariant test recomputes it. |
| `scaleRoot` / `keyPool` | `'D'` / `['C', 'D', 'E', 'F', 'G']` | D Dorian is the canonical modal vamp key. |
| `progressionId` | `'cine-dorian-voyage'` | i7 – IV7 – i7 – IV7, four steps — a two-chord modal vamp, exactly what a 6/8 groove wants. Four steps satisfies `instantVibes.test.ts:28`. |
| `progressionIds` | the full computed boombap filter, verbatim | Includes `boombap-dusty-ii-v`, which has three steps — legal in the *pool* (only a vibe's own `progressionId` must have four) and the pool is the full filter by rule. |
| `chordRhythmId` / `rhythmIds` | `'afroBellComp'` / all three 6/8 rhythms | All 6/8. |
| `bassPatternId` / `bassPatternIds` | `'afro-six-eight-tumbao'` / both 6/8 lines | Two members. |
| `drumPatternId` | `'afro-six-eight-bell'` | |
| presets | lead `factory-glocken-bell`, comp `factory-fm-tine-piano`, bass `bass-round-pluck` | Bell for the lead is the honest choice for a bell-driven groove; `bass-round-pluck` is `category: 'Bass'`. |
| `effectChainId` | `'boombap-dry-room'` | |
| `soundKit` | `'Acoustic Studio'` | An existing `DRUM_KITS` key; hand-percussion-adjacent. |

**The density pools, verified against the kick.** `afro-six-eight-bell`'s kick hits steps 0 **and 6**, which is a far harder constraint than the waltz's single hit. Adapted onsets in a twelve-step bar:

| candidate | adapted onsets | verdict |
|---|---|---|
| `off` | — | the silent member |
| `backbeat` | 4 | no collision → openhat |
| `lateFill` | 7 | no collision → openhat, tom |
| `eighths` | 0, 2, 4, 6, 8, 10 | collides → hihat only (exempt), and it is the compound pulse |
| `sixteenths` | 0…11 | collides → hihat only |
| `lofi16ths` | 0, 2, 4, 6, 7, 8, 10 | collides → hihat only |
| `downbeat` | 0 | collides; crash is exempt so it stays usable there |
| `and2and4`, `midBar`, `offbeat8ths` | 6 / 6 / 2, 6, 10 | all hit step 6 → **not eligible** for openhat or tom |
| `halves`, `quarters`, `swung16ths` | contain 0 | not eligible |
| `pickup`, `fillTail` | *(none)* | silent in twelve steps — must not be listed |

That leaves `{off, backbeat, lateFill}` as the entire eligible set for the two filtered layers. This is a genuine limitation of a 4/4 density catalogue in a compound meter and it is stated rather than papered over. Both pools still have two or more members, so `pickDistinct` keeps rerolling. Again **zero** candidates are filtered, so the global count stays at 1.

- [ ] **Step 1: Write the failing test**

In `src/store/instantVibes.test.ts`:

```ts
    expect(INSTANT_VIBES.length).toBe(8);
```

and append to the pinned preset matrix:

```ts
      { id: 'afro-six-eight', synthPresetId: 'factory-glocken-bell', chordPresetId: 'factory-fm-tine-piano', bassPresetId: 'bass-round-pluck' },
```

Append a meter-coverage test to the same file so the pair of new vibes is pinned as a pair:

```ts
describe('vibe meters', () => {
  test('every vibe declares a meter and the shipped set covers 4/4, 3/4 and 6/8', () => {
    expect(INSTANT_VIBES.map((v) => [v.id, v.meter])).toEqual([
      ['lofi-chill', '4/4'],
      ['synthwave-80s', '4/4'],
      ['cyber-dance', '4/4'],
      ['ambient-chill', '4/4'],
      ['hiphop-groove', '4/4'],
      ['asian-zen', '4/4'],
      ['lofi-waltz', '3/4'],
      ['afro-six-eight', '6/8'],
    ]);
  });

  test("each vibe's rhythm and bass pools stay inside its own meter", () => {
    // A vibe whose dice can land on a 4/4 pattern would silently adapt it every
    // reroll. Nothing forbids that at the type level; this is the guard.
    for (const v of INSTANT_VIBES) {
      for (const id of v.variation!.rhythmIds) {
        expect(RHYTHM_PATTERNS.find((p) => p.id === id)!.meter, `${v.id}/${id}`).toBe(v.meter);
      }
      for (const id of v.variation!.bassPatternIds) {
        expect(BASS_PATTERNS.find((p) => p.id === id)!.meter, `${v.id}/${id}`).toBe(v.meter);
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/store/`
Expected: FAIL — length 7 ≠ 8, the matrix is one row short, and the three fixture key-set tests name `afro-six-eight`.

- [ ] **Step 3: Author the vibe**

Append inside `INSTANT_VIBES`, after the `lofi-waltz` entry:

```ts
  {
    id: 'afro-six-eight',
    name: 'Afro 6/8',
    tagline: 'Compound bell groove, modal Dorian vamp, two beats to the bar',
    emoji: '🪘',
    bpm: 132,
    meter: '6/8',
    scaleRoot: 'D',
    scaleType: 'Dorian',
    progressionId: 'cine-dorian-voyage',

    // Beat: two dotted-quarter beats, snare pushing off the last eighth of each
    soundKit: 'Acoustic Studio',
    drumFilterCutoff: 9000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'afro-six-eight-bell',
    drumPattern: drumPatternById('afro-six-eight-bell')!,

    // Chords: tines on the one-bar 6/8 bell cell
    chords: resolveProgression(progressionById('cine-dorian-voyage')!, 'D', 'Dorian', 4),
    chordRhythmId: 'afroBellComp',
    chordFeel: 0.55,
    chordOctave: 4,
    chordPresetId: 'factory-fm-tine-piano',

    // Bass: both beats plus the octave push on the last eighth of beat two
    bassPatternId: 'afro-six-eight-tumbao',
    bassFeel: 0.5,
    bassOctave: 2,
    bassPresetId: 'bass-round-pluck',

    // Main Synth: bell lead, the voice the groove is named for
    synthPresetId: 'factory-glocken-bell',

    effectChainId: 'boombap-dry-room',
    effects: requireEffectChain('boombap-dry-room'),

    // afro-six-eight
    variation: {
      genre: 'boombap',
      keyPool: ['C', 'D', 'E', 'F', 'G'],
      bpmRange: [126, 138],
      progressionIds: ['cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig', 'boombap-head-nod', 'boombap-soul-piano'],
      rhythmIds: ['afroBellComp', 'compoundEighthPads', 'sixEightBallad'],
      bassPatternIds: ['afro-six-eight-tumbao', 'six-eight-root-pulse'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          // This kick hits BOTH 0 and 6, so every catalogue row that touches
          // either is ineligible for openhat and tom once adapted to twelve
          // steps. What survives is off / backbeat (step 4) / lateFill (step 7).
          // hihat and crash are exempt from the filter.
          hihat: ['eighths', 'sixteenths', 'lofi16ths'],
          openhat: ['off', 'backbeat', 'lateFill'],
          tom: ['off', 'lateFill'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
```

Re-derive `progressionIds` before committing:

```bash
bun -e "
const {CHORD_PROGRESSIONS}=await import('./src/audio/data/chordProgressions.ts');
const {SCALES}=await import('./src/utils/musicTheory.ts');
console.log(JSON.stringify(CHORD_PROGRESSIONS
  .filter(p=>p.genres.includes('boombap') && p.minScaleLength<=SCALES['Dorian'].intervals.length)
  .map(p=>p.id)));
"
```

- [ ] **Step 4: Add the three golden fixture entries**

`src/store/instantVibesChordsFixture.ts` — `cine-dorian-voyage` in D Dorian at octave 4 is `Dmin7 – G7 – Dmin7 – G7`, one bar each (verified with `resolveProgression`):

```ts
  'afro-six-eight': [
    snapshotChord('af1', 'D', 'min7', 1, 4),
    snapshotChord('af2', 'G', '7', 1, 4),
    snapshotChord('af3', 'D', 'min7', 1, 4),
    snapshotChord('af4', 'G', '7', 1, 4),
  ],
```

`src/store/instantVibesDrumsFixture.ts`:

```ts
  'afro-six-eight': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    tom:     [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
```

`src/store/instantVibesEffectsFixture.ts` — the `boombap-dry-room` chain, key for key (no `distortionWet`):

```ts
  'afro-six-eight': {
    reverbWet: 0.3,
    reverbDecay: 2,
    delayWet: 0.2,
    delayFeedback: 0.22,
    compressorThreshold: -16,
    eqLow: 3,
    eqMid: 1,
    eqHigh: 0,
  },
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun test src/store/`
Expected: PASS. Re-check the same three results as in Task 12 — the global filter count must still be `1`, no listed candidate may be silent in 6/8, and every drum row must be twelve cells.

- [ ] **Step 6: Run the full gate**

Run: `bun run verify` then `bun run eslint`
Expected: PASS.

- [ ] **Step 7: Sanity-check the whole feature by hand**

Run: `bun run dev`, then in the browser:
1. Click **Lo-Fi Waltz** — the transport meter select must jump to `3/4`, the sequencer header must read `Drum Sequencer (12-Step · 3/4)`, and the grid must show twelve cells grouped 4+4+4.
2. Click **Afro 6/8** — meter `6/8`, still twelve cells, but grouped 6+6 (the alternating shading and the accented step numbers move).
3. With the meter on `6/8`, open the chord-pattern select: `Afro 6/8 Bell Comp · 6/8` sits alongside `Sustained · 4/4 → 6/8`, and both are selectable.
4. Switch back to a 4/4 vibe and confirm the sequencer grid returns to sixteen cells with the user's own programming intact — the rows are stored at twenty-four and only windowed.

This is a manual check, not a test; note anything surprising in the PR description rather than "fixing" it here.

- [ ] **Step 8: Commit**

```bash
git add src/store/instantVibes.ts src/store/instantVibes.test.ts src/store/instantVibesChordsFixture.ts src/store/instantVibesDrumsFixture.ts src/store/instantVibesEffectsFixture.ts
git commit -m "feat(vibes): add the Afro 6/8 vibe and complete Stage 2

A 6/8 compound groove in D Dorian at 132 BPM (dotted quarter 88), resolved from
cine-dorian-voyage, afroBellComp, afro-six-eight-tumbao, afro-six-eight-bell and
boombap-dry-room. Genre 'boombap' is chosen for its progression pool, not its
label: boombap's anchor scale is Dorian, the modal home of Afro-Cuban 6/8, and
VibeGenre is a closed union that a new member would cost four coordinated edits
and four new progressions to extend.

Its kick hits both dotted-quarter beats, which makes the 4/4 density catalogue
bite hard: adapted to twelve steps, every row except off, backbeat and lateFill
either collides with the kick or is silent. Both filtered pools are drawn from
exactly that set, which is a real limitation of a 4/4 catalogue in a compound
meter and is documented in place rather than hidden. Nothing is removed by the
collision filter, so its global count stays at one.

Deliberate, reviewed test changes: INSTANT_VIBES.length 7 -> 8, one row added to
the pinned preset matrix, and two new invariants — the full id-to-meter list for
all eight vibes, and a guard that a vibe's rhythm and bass pools stay inside its
own meter so the dice can never reroll it into an adapted pattern."
```

---

## Self-Review

**1. Spec coverage.** Walked §UI and §"Delivery stages" of `docs/superpowers/specs/2026-08-27-time-signature-support-design.md` against the tasks:

| Spec requirement | Task |
|---|---|
| §UI "Preset pickers show each pattern's native meter" | 3, 4, 5 |
| §UI "…and can filter by the active meter" | **Deliberately not built.** The user's decision, recorded in File Structure, is label-only: every pattern stays listed. A filter would be a second control for a problem the label already solves, and the spec's own next sentence ("stays selectable… but is labelled") is the requirement that matters. |
| §UI "A pattern whose meter differs stays selectable but is labelled" | 3 (`patternOptionLabel`, `patternMeterTitle`), 4, 5 |
| §UI "the sequencer header must stop saying 16-Step" | Already done in Stage 1 (`sequencerTitle`, `src/components/sequencerGrid.ts`). No task needed; verified on this branch. |
| §"Delivery stages" Stage 2: "author native 3/4 and 6/8 patterns (drums, chord rhythms, bass)" | 6–11 — 6 chord rhythms, 4 bass patterns, 2 genre presets, 2 vibe drum patterns = 14 authored patterns |
| §"Delivery stages" Stage 2: "and any vibes that use them" | 12, 13 |
| §Vibes "Do not rename any vibe id" | Global Constraints; no task renames one |
| §"Risks" 4/4 must stay byte-identical | Global Constraints + Task 6's rewritten acceptance pin; every authoring task appends |
| Buckets C1, C2 (not in the spec — carried from Stage 1's final review) | 1, 2 |

No gap found. 12/8, 5/4 and 7/8 receive no authored content by explicit decision, and Task 6's second test pins that.

**2. Placeholder scan.** Searched for "TBD", "TODO", "similar to Task", "appropriate", "etc.", "and so on", "fill in". None present. Every drum row is written as its literal twelve-element array; every `RhythmHit[]` and `BassStep[]` is written as literal objects with real step indices; both fixture chord lists are the actual `resolveProgression` output (computed, not guessed); both effect blocks are the actual chain values; both `progressionIds` lists are the actual computed filter, and each has a re-derivation command attached in case the library moves under the implementer.

**3. Type-name consistency across tasks.** Checked each name where it crosses a task boundary:
- `isFullHoldRhythm(pattern: RhythmPattern, stepsPerBar: number)` / `isFullHoldBass(pattern: BassPattern, stepsPerBar: number)` — Task 1 only, same order in the definition, both call sites and the test.
- `densityRowFor(name: DensityName, stepsPerBar: number): number[]` and `eligibleDensities(layer, candidates, kick, stepsPerBar)` — defined in Task 2, used with the same four-argument order in Tasks 2, 12 and 13.
- `DRUM_DENSITY_METER` — Task 2 only.
- `patternOptionLabel(name, patternMeter, activeMeter)` and `patternMeterTitle(name, patternMeter, activeMeter)` — same three-argument order in Task 3's definition and both consumers (Tasks 4, 5). `isMeterMismatch` and `patternMeterLabel` are defined and tested in Task 3 and used internally by the other two.
- Pattern ids appear identically wherever they recur: `waltzOompah` / `jazzWaltzComp` / `waltzArpRoll` (6 → 12), `waltz-root-fifth` / `waltz-walking-three` (7 → 12), `compoundEighthPads` / `afroBellComp` / `sixEightBallad` (8 → 13), `six-eight-root-pulse` / `afro-six-eight-tumbao` (9 → 13), `waltz-brush-three` / `afro-six-eight-bell` (11 → 12, 13), `'Waltz'` / `'Afro 6/8'` (10, and `GENRE_TO_KIT` in the same task).
- Style strings: rhythms and bass patterns both use `'Waltz'` and `'6/8'`, and the `BASS_STYLE_GROUPS` order pin is updated in the task that introduces each (7 adds `'Waltz'`, 9 adds `'6/8'`).
- `MeterId` is imported as a type in every test file that names one (`rhythmPatterns.test.ts`, `bassPatterns.test.ts`, `meterRegression.test.ts`); `genrePresets.test.ts` and `vibeDrumPatterns.test.ts` use `Record<string, string>` maps and compare against the string, matching how those files already assert.

**4. Tests that change deliberately, collected in one place** so a reviewer can check the list rather than hunt for it:

| Test | Change | Task | Why it is not a test bent to fit |
|---|---|---|---|
| `meterRegression.test.ts` "nothing declares a non-4/4 meter (Stage 2 territory)" | replaced by an id-set pin on the 45 Stage-1 patterns + a 3/4-or-6/8-only guard | 6 | The assertion's own comment says it is Stage 2 territory; it was written to expire here, and what replaces it is strictly stronger (id-for-id, in order). |
| `meterRegression.test.ts` two `adaptStepRow`/`adaptStepEvents` identity tests | scoped to `meter === '4/4'` | 6 | "Adapting to 16 is the identity" is only true of 4/4 sources. Applying it to a 12-step source would assert that looping is a no-op, which is false. |
| `rhythmPatterns.test.ts` / `bassPatterns.test.ts` "…must be 4/4" | explicit id→meter list | 6, 7, 8, 9 | Same expiry; the replacement names every id so a retag is a visible diff. |
| `bassPatterns.test.ts` `BASS_STYLE_GROUPS` order | `+'Waltz'`, `+'6/8'` | 7, 9 | Groups are first-appearance ordered and the new patterns are appended, so the existing three keep their positions. |
| `genrePresets.test.ts` `GENRES` + "Stage 1 ships every genre at 4/4" | list grows to 14; the 4/4 assertion becomes a genre→meter map | 10 | Same expiry. |
| `vibeDrumPatterns.test.ts` `LIBRARY_IDS` + "Stage 1 ships them all at 4/4" | list grows to 8; explicit id→meter map | 11 | Same expiry. The row-length test needs no change — it already derives from `drumPatternMeterId`. |
| `instantVibes.test.ts:11` count | 6 → 7 → 8 | 12, 13 | Adding vibes is the deliverable. The count is meant to fail so nobody adds one by accident. |
| `instantVibes.test.ts:112` preset matrix | +2 rows | 12, 13 | Same. |
| `instantVibesDrums.test.ts:26` row length `16` | each vibe's own `stepsPerBar` | 12 | The literal 16 was correct while every vibe was 4/4 and is wrong the moment one is not; deriving it from the vibe's meter is the same assertion, correctly parameterised. |
| `instantVibesChordsFixture.ts`, `instantVibesDrumsFixture.ts`, `instantVibesEffectsFixture.ts` | +1 hand-copied entry each, per vibe | 12, 13 | These fail *by design* for a new vibe — their id lists derive from `INSTANT_VIBES`. Adding an entry is the sanctioned response; making a fixture read the vibe table is not, and no task does. |
| `vibeVariation.test.ts` two inline collision re-implementations | call `eligibleDensities` | 2 | They duplicated the production rule and would have silently diverged from it once the fourth parameter existed. |
| `vibeVariation.test.ts` `expect(removed).toBe(1)` | **unchanged** | — | Both new vibes' filtered pools were chosen so nothing collides. If this number moves during Task 12 or 13, the pool is wrong, not the number. |

**Total shipped after Stage 2:** 21 chord rhythms (15 × 4/4, 3 × 3/4, 3 × 6/8), 16 bass patterns (12 / 2 / 2), 14 sequencer genre presets (12 / 1 / 1), 8 vibe drum patterns (6 / 1 / 1) and 8 Instant Vibes (6 / 1 / 1).
