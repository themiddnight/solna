# Focus Track — Plan 0: Preview Length

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the melody grid's fixed `holdSec: 0.22` preview gate with a musical length derived from BPM and the note's own tick length. That is the whole of this plan — the FX default patch it used to also change is **dropped**, for the reasons under "Deliberately not in this plan".

**Architecture:** All of the arithmetic lands in one exported pure function, `leadPreviewHoldSec(bpm, stride, lenTicks?)`, in `src/components/loop/lead/melodyGrid.ts` — the module that already holds the grid's pure helpers and already imports `leadNoteCells`/`TICKS_PER_SIXTEENTH`. `LeadMelodyGrid.tsx` calls it at the two surfaces that preview (the row label, with no length; a keyboard cell activation that ADDS a note, with that note's length), so `previewSequencerNote`'s own `holdSec = 0.5` default and its other caller — `SequencerView`'s drum/synth row preview — are untouched by construction. Nothing in `src/store/` moves.

**Tech Stack:** Bun (test runner + scripts), TypeScript, React 19 + Vite, Zustand, raw Web Audio API, `tonal` for theory only.

**Spec:** `docs/superpowers/specs/2026-09-10-focus-track-design.md` — this plan implements **only** its `## Scope` item **"0. Preview length"**, i.e. the `## Preview length` section. The spec's `## FX default patch — dropped` section is a record of a change that is not being made and produces no task here. Nothing that reads or writes `focusTrack` is in scope; that is Plan 1.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`bun run verify` is the completion gate.** Run it before claiming any work done. It is `bun test` + `bun run lint` + `bun run eslint` + `check:keys` + `check:drums` + `check:contrast` + `check:levels` + `build`.
- **`bun run eslint` must report nothing at all — no errors and no warnings.** That is the state to keep it in. A new `react-hooks/exhaustive-deps` or `complexity` warning is a failure of this gate, not an acceptable warning; if one is genuinely justified, it carries a line disable naming its reason.
- **`src/components/` must not import `audio/engine`.** Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`, `ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx` and test files are exempt, and `eslint.config.js` is the list that binds. Components reach the engine through `src/audio/playback/presetPreview.ts` and nothing else. **Never call engine setters from a component** — state goes in a slice and is wired in `src/store/engineSync.ts`.
- **`src/data/` imports nothing at runtime, not even a sibling in `src/data/`.** It reads no impure global (`Math`, `Date`, `crypto`, …), declares no function, constructs no object with `new`, and holds no module-scope `let`/`var`; it may declare types and `import type` from anywhere. `src/data/dataLayerPurity.test.ts` enforces this through eslint's own API. **This plan adds nothing to `src/data/`, edits no table there, and reads nothing from it** — every file it touches is under `src/components/loop/lead/`.
- **The four layers:** `data/` (leaf) → `audio/` (never imports `store/` or `components/`) → `store/` (never imports `components/`) → `components/` (dumb views). `src/utils/` sits outside the chain, above `data/`.
- **Feature work never lands as a commit made directly on `main`.** Branch names are `<type>/<issue-code>-<name>`, with the issue code omitted entirely when the work has no issue. This plan has no Linear issue, so the branch is **`fix/preview-length`**.
- **Conventional commits**, and every commit message ends with the trailer line:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Testing:** `bun:test`. There is **no DOM and no testing-library in this repo and none may be added.** Prefer exported pure helpers tested directly over rendered components; where markup is the behaviour, `renderToString` from `react-dom/server` returns a string and assertions are substring checks.
- **The zustand + `renderToString` trap:** zustand wires `getServerSnapshot` to `selector(api.getInitialState())`, captured once at store creation, so `useAppStore.setState(...)` before a `renderToString` has **no effect** and nothing in `bun run verify` catches it. No task in this plan asserts on rendered markup for exactly that reason.
- **House comment style:** a comment states the *rule* and the failure it prevents, not the number. Do not record version numbers, file counts or line numbers in `CLAUDE.md`.
- **Do not touch `CLAUDE.md` in this plan.** The spec's rule is that CLAUDE.md edits go with the plan that falsifies them; Plan 0 falsifies no sentence in it (the FX-recorder sentence belongs to Plan 3, the solo paragraph to Plan 1).

### Domain facts, verified — do not re-derive

- `previewSequencerNote(note, params, velocity, { holdSec = 0.5, releaseSec = 0.3 })` lives at `src/audio/playback/presetPreview.ts:229-244` and has **two** callers: `src/components/loop/SequencerView.tsx:84` (row preview, passes no options — keeps the 0.5 s default) and `src/components/loop/lead/LeadMelodyGrid.tsx:567` (passes `holdSec: 0.22`). **Do not change the default and do not break the `SequencerView` caller.**
- `previewSequencerNote` runs on `PREVIEW_SOURCE = 'preview'`, deliberately off `noteInputBus`, so a preview never reaches the lead recorder and its release cannot cut a held key. **Preserve that** — this plan changes only the length passed in.
- **A melody length is in TICKS, not 16ths.** `TICKS_PER_SIXTEENTH = 2` (`src/utils/stepResolution.ts:20`), so one tick is `stepDurationSec(bpm) / TICKS_PER_SIXTEENTH` — this is exactly what `src/components/loop/lead/useLeadPlayback.ts:165` computes as `tickDur`. **Tick duration depends on BPM only; the meter's `stepsPerBar` does not enter it.** The stride enters only through `leadNoteCells(len, stride)`, which rounds a tick length to whole drawn CELLS — the one copy of "what sounds is what is drawn" (`src/utils/stepResolution.ts:102-105`, and `src/audio/leadMelody.ts:358`'s `holdSec: (cells - 1 + gate) * stride * tickDurSec`).
- **One beat is `60 / bpm` seconds, i.e. `4 * stepDurationSec(bpm)`** — the spec states this literally and it has no meter dependency.
- Today **only the row label previews** (`LeadMelodyGrid.tsx:729`, `onClick={() => previewNote(note)}`). Pointer clicks on a cell go through the paint controller; `createLeadPaintHandlers`' `onCellClick` (`src/components/loop/lead/leadPaint.ts:148-151`) fires **only for keyboard-originated clicks**, gated by the exported `leadPaintClickIsKeyboard(e.detail)`.
- A toggled-in note is written with **`len: stride`** (`src/store/leadSlice.ts:182`), i.e. exactly one drawn cell.
- **The FX track does NOT default to "Noise Riser FX", whatever the spec's first draft said.** `fxSynthParams` is `INITIAL_SYNTH_PARAMS` — the Lead patch, `'Cosmic Lead'`, `attack: 0.02` — in *both* places that build a fresh FX track: `src/store/fxSlice.ts:25` and `src/store/initialState.ts:466` (`defaultFxState()`). There is no `FX_DEFAULT_PRESET_ID` in the codebase. **This plan changes none of that** (see "Deliberately not in this plan" below).
- **A slow-attack FX patch arrives through `applyVibeToStore`, and it arrives every time.** All eight `VIBES` set an `fxPresetId` and all three ids they draw from are slow: `factory-noise-riser-fx` 1.2 s (×4), `factory-cyber-drone` 0.8 s (×3), `factory-laser-fx` 0.3 s (×1) — every one past the old fixed 0.22 s gate. **That is what makes this plan worth shipping on its own:** the silent preview is not an unusual-default edge case, it fires for every vibe, and the length fix closes it for all eight without touching a curated table.

### Deliberately not in this plan — record, do not "fix"

- **A new FX default patch — `FX_DEFAULT_PRESET_ID` / `INITIAL_FX_SYNTH_PARAMS`.** This plan carried that task until the premise under it was checked and found false. The spec's `## FX default patch` was written to move FX off "Noise Riser FX"; FX was never on it. The factory default is `INITIAL_SYNTH_PARAMS` — `'Cosmic Lead'`, `attack: 0.02`, an oscillator patch — in `src/store/fxSlice.ts:25` and `src/store/initialState.ts:466`, so it **already clears** the constraint the spec wanted to impose (`attack` ≤ 0.1 s, oscillator not noise) by a factor of five. There was nothing to fix. The real exposure is `applyVibeToStore` (see the domain fact above), and vibes are curated content a bug fix does not retune. Whether FX should ship sounding *different from Lead* is a separate taste question — a real one — and it does not ride along with a preview fix.
  **Restorable without re-deriving the analysis**, if that taste question is ever answered yes: the pick was **`factory-glocken-bell` — "Glocken Bell", `attack: 0.002`, `oscType: 'sine'`, `noiseVolume: 0.0`** (`src/data/synthPresets.ts`), the widest margin in the library and maximally unlike the Lead default's sawtooth. It has to come from another category because **no FX-category preset passes the attack bar** — `factory-laser-fx` 0.3 s, `factory-cyber-drone` 0.8 s, `factory-noise-riser-fx` 1.2 s. The shape is the Pad precedent: an id constant plus a `presetById`-resolved params constant in `src/store/initialState.ts`, consumed by both places that build a fresh FX track, with the constraint pinned by test rather than by preset name so a library retune cannot silently reintroduce it.
- **Re-voicing any vibe's `fxPresetId`** — all eight lines in `src/data/vibes.ts` (`grep -n "fxPresetId" src/data/vibes.ts` lists them). A vibe's FX voice is authored, curated content — the lo-fi tape-hiss riser under the turnaround is deliberate — and the spec explicitly says "Risers stay available as presets and lose nothing". Re-voicing vibes is a taste decision no spec here authorizes, it moves the Instant Vibes golden fixtures, and it belongs to a vibes retune with its own listening pass.
- **A pointer preview on a cell that already holds a note.** The spec's cell rule says "clicking a cell that holds a note sounds that note's own `len`". No such pointer gesture exists: pointer-down on a covered cell begins a paint/erase stroke, and a stroke visits one new cell per `pointermove`, each `beginPreview()` cutting the previous — a drag would machine-gun the preview bus. Task 3 wires the cell branch at the keyboard activation that *adds* a note, which is discrete, non-destructive, and is literally "hear what you drew" (`presetPreview.ts:218-227`). Adding a pointer audition means giving the paint controller an audio callback and a stroke-start guard; that is its own change.

---

## Task 1: The pure preview-length helper

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts:1` (import line) and append the new function at the end of the file
- Test: `src/components/loop/lead/melodyGrid.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `stepDurationSec(bpm: number): number` from `@/utils/musicTheory`; `TICKS_PER_SIXTEENTH: number` and `leadNoteCells(len: number, stride: number): number` from `@/utils/stepResolution` (both already imported by `melodyGrid.ts`).
- Produces: `export function leadPreviewHoldSec(bpm: number, stride: number, lenTicks?: number): number` from `src/components/loop/lead/melodyGrid.ts`. Tasks 2 and 3 import it by that exact name and call it with that exact argument order.

- [ ] **Step 1: Create the branch off `main`**

```bash
git checkout main
git pull --ff-only
git checkout -b fix/preview-length
```

- [ ] **Step 2: Write the failing test**

Append to `src/components/loop/lead/melodyGrid.test.ts`. If `stepDurationSec`, `TICKS_PER_SIXTEENTH` or `leadNoteCells` are not already imported at the top of that file, add these import lines there:

```ts
import { stepDurationSec } from '@/utils/musicTheory';
import { TICKS_PER_SIXTEENTH, leadNoteCells } from '@/utils/stepResolution';
```

and add `leadPreviewHoldSec` to the existing `from './melodyGrid'` import. Then append:

```ts
describe('leadPreviewHoldSec', () => {
  test('a row-label preview is one beat at the current bpm', () => {
    expect(leadPreviewHoldSec(120, 2)).toBeCloseTo(0.5, 10);
    expect(leadPreviewHoldSec(60, 2)).toBeCloseTo(1, 10);
    expect(leadPreviewHoldSec(140, 4)).toBeCloseTo(60 / 140, 10);
  });

  test('one beat is four 16ths, and the stride does not enter it', () => {
    for (const stride of [1, 2, 4]) {
      expect(leadPreviewHoldSec(96, stride)).toBeCloseTo(4 * stepDurationSec(96), 10);
    }
  });

  test('a cell preview lasts the CELLS the note draws, not its raw ticks', () => {
    // 120 bpm: a 16th is 0.125 s, so a tick is 0.0625 s.
    // 2 ticks at stride 2 draws one cell -> 2 ticks -> 0.125 s.
    expect(leadPreviewHoldSec(120, 2, 2)).toBeCloseTo(0.125, 10);
    // 3 ticks at stride 2 still draws TWO cells (ceil) -> 4 ticks -> 0.25 s.
    expect(leadPreviewHoldSec(120, 2, 3)).toBeCloseTo(0.25, 10);
    // 8 ticks at stride 4 draws two cells -> 8 ticks -> 0.5 s.
    expect(leadPreviewHoldSec(120, 4, 8)).toBeCloseTo(0.5, 10);
  });

  test('a cell preview is leadNoteCells driven, so it agrees with what is drawn', () => {
    const tickDur = stepDurationSec(100) / TICKS_PER_SIXTEENTH;
    expect(leadPreviewHoldSec(100, 2, 5)).toBeCloseTo(leadNoteCells(5, 2) * 2 * tickDur, 10);
  });

  test('a zero-length note still sounds the one cell it draws', () => {
    expect(leadPreviewHoldSec(120, 2, 0)).toBeCloseTo(0.125, 10);
  });

  test('a non-positive or non-finite bpm answers 0 rather than Infinity', () => {
    // A note-off scheduled at start + Infinity never fires: a drone on the
    // preview bus with no handle able to stop it.
    expect(leadPreviewHoldSec(0, 2)).toBe(0);
    expect(leadPreviewHoldSec(-120, 2, 4)).toBe(0);
    expect(leadPreviewHoldSec(Number.NaN, 2)).toBe(0);
    expect(leadPreviewHoldSec(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/components/loop/lead/melodyGrid.test.ts -t "leadPreviewHoldSec"`
Expected: FAIL. The import fails first — an error naming `leadPreviewHoldSec` as not exported from `./melodyGrid` (bun reports `SyntaxError: Export named 'leadPreviewHoldSec' not found in module '.../melodyGrid.ts'`).

- [ ] **Step 4: Add `stepDurationSec` to `melodyGrid.ts`'s musicTheory import**

`src/components/loop/lead/melodyGrid.ts:1` currently reads:

```ts
import { getScaleNotesInOctave, isNoteInScale, ROOTS } from '@/utils/musicTheory';
```

Replace it with:

```ts
import { getScaleNotesInOctave, isNoteInScale, ROOTS, stepDurationSec } from '@/utils/musicTheory';
```

- [ ] **Step 5: Append the implementation to `melodyGrid.ts`**

Add at the end of `src/components/loop/lead/melodyGrid.ts`:

```ts
/**
 * How long a melody-grid preview holds, in seconds.
 *
 * Two lengths, both musical, replacing the fixed 0.22 s gate this grid used to
 * pass: that constant was silent for any patch whose attack exceeded it, so the
 * only way to pick a safe value was to measure it against the slowest patch in
 * the library — a hidden dependency on the preset table, re-broken by every
 * preset added. Measured, before this: the 1.2 s attack of the riser four of
 * the eight vibes put on the FX track was still around -67 dBFS when note-off
 * cancelled it, so that grid's first note made no sound at all and nothing on
 * screen explained why. Every vibe hands FX a patch slower than 0.22 s, so
 * that was the common case, not an edge one.
 *
 * - No `lenTicks` — a ROW-LABEL preview, which asks "what pitch is this row"
 *   and nothing more. One beat, `60 / bpm`, i.e. four 16ths: the shortest
 *   length that is a musical unit rather than an arbitrary one, and one that
 *   gets longer at slower tempos, which is the direction that helps.
 * - With `lenTicks` — a CELL's own length, rounded to whole cells through the
 *   active stride by leadNoteCells. That is the same expression the scheduler's
 *   holdSec and the renderer's span already share, so a preview lasts exactly
 *   what the grid draws and what playback will sound.
 *
 * This does not make every patch audible at every tempo, and is not meant to: a
 * 1.2 s attack still only reaches part-way through a 0.43 s beat at 140 BPM.
 * The point is that the length is a stated musical rule a reader can predict
 * rather than a constant that happened to work for the patches someone tried.
 *
 * A bpm that is not a positive finite number would make `60 / bpm` Infinity or
 * NaN, and a note-off scheduled at Infinity never fires — a drone on the
 * preview bus that the returned handle cannot cut either, since it stops the
 * source rather than the schedule. Store bpm is sanitized, so this answers 0
 * instead of throwing: a preview that does not sound is a bug a user can
 * report, a preview that never stops is one they cannot escape.
 */
export function leadPreviewHoldSec(bpm: number, stride: number, lenTicks?: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  const sixteenthSec = stepDurationSec(bpm);
  if (lenTicks === undefined) return 4 * sixteenthSec;
  return leadNoteCells(lenTicks, stride) * stride * (sixteenthSec / TICKS_PER_SIXTEENTH);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test src/components/loop/lead/melodyGrid.test.ts`
Expected: PASS — the whole file, including the pre-existing `describe`s.

- [ ] **Step 7: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: `tsc --noEmit` silent, eslint silent — no errors and no warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts
git commit -m "feat(lead): a melody preview length that is musical, not a constant

leadPreviewHoldSec answers one beat for a row-label preview and the note's
own drawn cells for a cell preview. Pure and tested on its own; the call
sites follow.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The row-label preview stops using `0.22`

**Files:**
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx:561-573` (`previewNote`) and its import block near line 20
- Test: `src/audio/playback/presetPreview.test.ts` (append one regression test pinning the other caller's default)

**Interfaces:**
- Consumes: `leadPreviewHoldSec(bpm: number, stride: number, lenTicks?: number): number` from `./melodyGrid` (Task 1); `previewSequencerNote(note: string, params: SynthParams, velocity?: number, opts?: { holdSec?: number; releaseSec?: number }): PreviewHandle` from `@/audio/playback/presetPreview`.
- Produces: `previewNote(note: string, lenTicks?: number): void` — a `useCallback` local to `LeadMelodyGrid`, with `stride` and `synthParams` as its deps. Task 3 passes it down as a prop.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/playback/presetPreview.test.ts`, inside the existing `describe('previewSequencerNote', …)` block if there is one, otherwise as a new top-level `describe`:

```ts
describe('previewSequencerNote default gate', () => {
  // SequencerView's row preview passes no options at all, so this default IS
  // that surface's behaviour. The melody grid used to reach in and shorten it
  // to 0.22 s at its own call site; it now passes a musical length instead,
  // and this pins the default so a future edit there cannot drift the drum
  // rows with it.
  test('holds 0.5 s when the caller states no length', () => {
    const handle = previewSequencerNote('C4', SYNTH, 0.8);
    const on = noteOnCalls();
    const off = noteOffCalls();
    expect(off[0].time - on[0].time).toBeCloseTo(0.5, 10);
    handle();
  });
});
```

**Before running it, open `src/audio/playback/presetPreview.test.ts` and match the local harness.** That file already drives `previewSequencerNote` at lines 68, 114, 336, 353 and 432 through `freshEngine()`/`fakeCtx()` from `src/audio/testFakes.ts`; reuse whatever accessor those tests use to read the engine's `triggerSynthNoteOn`/`triggerSynthNoteOff` arguments in place of the `noteOnCalls()`/`noteOffCalls()` placeholders above, and reuse the file's existing `SYNTH` fixture. Do not add a new fake. If the file already asserts the 0.5 s default somewhere, skip this step and say so in the commit body instead of duplicating it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/presetPreview.test.ts -t "default gate"`
Expected: FAIL — `error: Cannot find name 'noteOnCalls'` (or the equivalent once the harness names are substituted, in which case this test may pass immediately; that is fine, note it and move to Step 3).

- [ ] **Step 3: Make it pass by wiring the harness**

Substitute the file's real accessors for `noteOnCalls()`/`noteOffCalls()`. Run: `bun test src/audio/playback/presetPreview.test.ts`
Expected: PASS.

- [ ] **Step 4: Rewrite `previewNote` in `LeadMelodyGrid.tsx`**

Add `leadPreviewHoldSec` to the existing `from './melodyGrid'` import near the top of `src/components/loop/lead/LeadMelodyGrid.tsx`. Then replace the block at lines 561-573:

```tsx
  // previewSequencerNote, not synthPlaybackNoteOn: hearing a cell you clicked
  // is not performing a note, so the note-input bus must not see it — and it
  // runs on the 'preview' bus, so its release cannot cut a key the player is
  // holding at the same pitch. It calls audioEngine.init() itself.
  const previewNote = useCallback(
    (note: string) => {
      previewSequencerNote(note, synthParams, undefined, {
        holdSec: 0.22,
        releaseSec: synthParams.release,
      });
    },
    [synthParams],
  );
```

with:

```tsx
  // previewSequencerNote, not synthPlaybackNoteOn: hearing a cell you clicked
  // is not performing a note, so the note-input bus must not see it — and it
  // runs on the 'preview' bus, so its release cannot cut a key the player is
  // holding at the same pitch. It calls audioEngine.init() itself.
  //
  // The length comes from leadPreviewHoldSec, not from a constant: a fixed gate
  // is silent for any patch whose attack outruns it, so its only safe value is
  // a measurement against the slowest patch in the library — a hidden
  // dependency on the preset table. `lenTicks` omitted means a row label, which
  // sounds one beat; passed, it means a cell, which sounds what it draws.
  //
  // bpm is read off getState() rather than subscribed to. This grid already
  // re-renders once per 16th to move the playhead, and a preview is a click:
  // the value at click time is the only one that can matter, and a subscription
  // here would add a re-render of every mounted melody grid per tempo change
  // for a value nothing renders.
  const previewNote = useCallback(
    (note: string, lenTicks?: number) => {
      previewSequencerNote(note, synthParams, undefined, {
        holdSec: leadPreviewHoldSec(useAppStore.getState().bpm, stride, lenTicks),
        releaseSec: synthParams.release,
      });
    },
    [synthParams, stride],
  );
```

- [ ] **Step 5: Verify the `0.22` literal is gone and the other caller is untouched**

Run:

```bash
grep -rn "0\.22" src/components/loop/lead/LeadMelodyGrid.tsx; grep -n "previewSequencerNote" src/components/loop/SequencerView.tsx
```

Expected: the first `grep` prints nothing (exit 1); the second still prints the `SequencerView.tsx:84` call with no options object.

- [ ] **Step 6: Run the grid's own suite, the preview suite and the gates**

Run: `bun test src/components/loop/lead/ src/audio/playback/presetPreview.test.ts && bun run lint && bun run eslint`
Expected: all PASS; `tsc --noEmit` silent; eslint silent, no warnings. If `react-hooks/exhaustive-deps` warns about the new `stride` dep, the dep list above already names it — re-check you copied it.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/lead/LeadMelodyGrid.tsx src/audio/playback/presetPreview.test.ts
git commit -m "fix(lead): a row-label preview sounds one beat, not 0.22 s

The fixed gate was silent for any patch whose attack exceeded it, and the
only way to pick a safe value was to measure it against the slowest patch in
the library. previewSequencerNote's own 0.5 s default is unchanged, so
SequencerView's row preview is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: A cell you draw with the keyboard sounds its own length

**Files:**
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx` — the `LeadMelodyCells` props interface (around lines 168-185), the cell `onClick` (around lines 270-272), and the `<LeadMelodyCells … />` call site (around lines 740-755) where `stride={stride}` is already passed
- Test: `src/components/loop/lead/leadPaint.test.ts` (append) — the decision under test is "which click may audition", which is `leadPaint.ts`'s existing subject

**Interfaces:**
- Consumes: `previewNote(note: string, lenTicks?: number): void` (Task 2); `leadPaintClickIsKeyboard(detail: number): boolean` exported from `./leadPaint` at `src/components/loop/lead/leadPaint.ts:39`; `stride: number` and `kind` (`'none' | 'start' | …`), both already in scope inside the cell loop.
- Produces: a new required prop on `LeadMelodyCells`: `onPreview: (note: string, lenTicks: number) => void`. **Required, no default** — the same rule `LeadMelodyGrid`'s own `trackId` follows: a default would let a call site that forgot the prop render a silently mute grid that no test distinguishes from a working one.

- [ ] **Step 1: Write the failing test**

Append to `src/components/loop/lead/leadPaint.test.ts`:

```ts
describe('which cell activation may audition', () => {
  // The audition rides leadPaintClickIsKeyboard rather than a second copy of
  // `detail === 0`. A pointer click never reaches onCellClick — it is a paint
  // stroke, which visits one new cell per pointermove and whose every
  // beginPreview() cuts the one before it, so auditioning there would
  // machine-gun the preview bus for the length of a drag.
  test('only a keyboard activation is eligible', () => {
    expect(leadPaintClickIsKeyboard(0)).toBe(true);
    expect(leadPaintClickIsKeyboard(1)).toBe(false);
    expect(leadPaintClickIsKeyboard(2)).toBe(false);
  });

  // A toggle that ADDS writes `len: stride` (leadSlice), i.e. exactly one
  // drawn cell — so the length an audition should sound after an add is one
  // cell's worth of ticks, and leadPreviewHoldSec turns that into seconds.
  test('an added note is one cell long, which is the length an audition sounds', () => {
    for (const stride of [1, 2, 4]) {
      expect(leadNoteCells(stride, stride)).toBe(1);
    }
  });
});
```

Add these imports at the top of `src/components/loop/lead/leadPaint.test.ts` if not already present (`leadPaintClickIsKeyboard` is already imported at line 5):

```ts
import { leadNoteCells } from '@/utils/stepResolution';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/loop/lead/leadPaint.test.ts -t "which cell activation"`
Expected: FAIL — `error: Cannot find name 'leadNoteCells'` until the import is added; with the import added it PASSES (both assertions are about behaviour that already holds). That is intentional: this pair is the *contract* the wiring in Step 3 depends on, and it is what turns red if `leadSlice`'s toggle length or the keyboard-click rule ever moves. Add the import, confirm green, then continue.

- [ ] **Step 3: Add the `onPreview` prop to `LeadMelodyCells`**

In `src/components/loop/lead/LeadMelodyGrid.tsx`, add to the `LeadMelodyCells` props interface (the block around lines 168-185 that already declares `stride: number;`):

```ts
  /**
   * Audition a note the user just drew with the keyboard. Required, with no
   * default: a default would make a call site that forgot the prop render a
   * grid that draws correctly and never makes a sound — internally consistent,
   * visually plausible, and caught by no test.
   */
  onPreview: (note: string, lenTicks: number) => void;
```

and destructure `onPreview` alongside `stride` in the component's parameter list.

- [ ] **Step 4: Audition on the keyboard activation that adds a note**

Replace the cell button's `onClick` at `src/components/loop/lead/LeadMelodyGrid.tsx:272`:

```tsx
                  onClick={(e) => paint.onCellClick(e, idx, note)}
```

with:

```tsx
                  onClick={(e) => {
                    paint.onCellClick(e, idx, note);
                    // Only the ADD half auditions, and only from the keyboard.
                    // onCellClick toggles, so `kind === 'none'` before the
                    // click is exactly the case where the cell holds a note
                    // after it — "hear what you drew". The erase half stays
                    // silent: auditioning a note as it is removed says the
                    // opposite of what just happened. Pointer clicks never
                    // reach here at all (leadPaintClickIsKeyboard), so a paint
                    // drag cannot machine-gun the shared preview bus.
                    if (leadPaintClickIsKeyboard(e.detail) && kind === 'none') {
                      // A toggled-in note is written with `len: stride`
                      // (leadSlice) — one drawn cell — so that is the length
                      // the audition sounds.
                      onPreview(note, stride);
                    }
                  }}
```

Add `leadPaintClickIsKeyboard` to the existing `from './leadPaint'` import in `LeadMelodyGrid.tsx`; if that file imports nothing from `./leadPaint` yet, add:

```ts
import { leadPaintClickIsKeyboard } from './leadPaint';
```

- [ ] **Step 5: Pass `previewNote` down at the `LeadMelodyCells` call site**

At the `<LeadMelodyCells … />` element in `LeadMelodyGrid` (the one that already passes `stride={stride}` around line 749), add:

```tsx
                  onPreview={previewNote}
```

`previewNote` is a `useCallback` with deps `[synthParams, stride]`, so it is stable between renders that change neither — which is what `LeadMelodyCells`' memoization comment requires of every prop it takes.

- [ ] **Step 6: Run the suites and the gates**

Run: `bun test src/components/loop/lead/ && bun run lint && bun run eslint`
Expected: all PASS; `tsc --noEmit` silent — in particular, `onPreview` being required means `tsc` would have flagged the call site had Step 5 been skipped; eslint silent, no warnings.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/leadPaint.test.ts
git commit -m "feat(lead): a keyboard-drawn cell auditions at its own length

The add half of the keyboard toggle only, at len: stride — one drawn cell.
Pointer strokes stay silent: a drag visits a cell per pointermove and each
beginPreview cuts the last, so auditioning there would machine-gun the
shared preview bus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The gate, and no stale prose left behind

**Files:**
- Modify: none expected. This task is verification plus a documentation sweep that touches a file only if the sweep finds a false sentence.

**Interfaces:**
- Consumes: everything Tasks 1-3 produced.
- Produces: a green `bun run verify` on `fix/preview-length`.

- [ ] **Step 1: Sweep for prose the change falsifies**

Run:

```bash
grep -rn "0\.22" docs/ CLAUDE.md .claude/ 2>/dev/null | grep -iv "delay\|distortion\|reverb\|drum\|alpha\|L 0\.23"
grep -rn "Noise Riser" docs/ CLAUDE.md .claude/ 2>/dev/null
```

Expected: nothing but the design spec `docs/superpowers/specs/2026-09-10-focus-track-design.md` and this plan, both of which are the record of the decision and stay as written. **Do not edit the spec.** If the first grep turns up a sentence elsewhere asserting the fixed 0.22 s gate, rewrite it to state the new rule — a false comment is worse than no comment. A "Noise Riser" hit is only false if it calls the riser the FX **default**; the spec and this plan both name it as what a vibe applies, which is true and stays. `CLAUDE.md` should have no hit either way: its FX paragraph names the recorder and the engine limits, not the preview length or the default patch.

- [ ] **Step 2: Confirm nothing outside the five intended files moved**

Run: `git diff --stat main...HEAD`
Expected exactly these paths, and no others:

```
src/audio/playback/presetPreview.test.ts
src/components/loop/lead/LeadMelodyGrid.tsx
src/components/loop/lead/leadPaint.test.ts
src/components/loop/lead/melodyGrid.ts
src/components/loop/lead/melodyGrid.test.ts
```

In particular `src/data/` must be untouched — a vibe's FX voice is curated content this plan does not retune; `src/store/` must be untouched — the FX default patch is not changing here; and `src/audio/playback/presetPreview.ts` must be untouched — its 0.5 s default serves `SequencerView` and this plan never changes it.

- [ ] **Step 3: Run the completion gate**

Run: `bun run verify`
Expected: PASS end to end — `bun test`, `tsc --noEmit` silent, `eslint .` reporting **nothing at all** (no errors and no warnings), `check:keys`, `check:drums`, `check:contrast`, `check:levels`, and `build`.

- [ ] **Step 4: If `bun run verify` failed, fix and re-run — do not commit past it**

Read the first failure only and fix that one. Common shapes for this change: an eslint `react-hooks/exhaustive-deps` warning on `previewNote` (the dep list is `[synthParams, stride]` — re-check Task 2 Step 4 was copied exactly); a `tsc` error at the `<LeadMelodyCells />` call site (the `onPreview` prop is required — Task 3 Step 5). Re-run `bun run verify` after each fix.

- [ ] **Step 5: Commit any fixes from Step 4**

```bash
git add -A
git commit -m "fix(lead): close the verify gate for the preview-length change

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If Step 4 required no fixes, skip this step — there is nothing to commit.

---

## Self-review

**1. Spec coverage — every Plan 0 requirement has a task.**

| Spec requirement (`## Preview length`) | Task |
|---|---|
| Replace the `0.22` constant with a musical length | Tasks 1 + 2 |
| Row-label preview = one beat, `60 / bpm` = 4 × `stepDurationSec(bpm)` | Task 1 Steps 2/5, Task 2 Step 4 |
| Cell preview = the note's own `len`, ticks converted through the active stride | Task 1 (`leadNoteCells(lenTicks, stride) * stride * tickDur`), wired in Task 3 |
| `previewSequencerNote`'s own `holdSec = 0.5` default unchanged, other callers unaffected | Task 2 Steps 1-3 and 5 (regression test + grep), Task 4 Step 2 |
| The `0.22` literal is deleted (`## What gets deleted`) | Task 2 Step 5 |
| `bun run verify` is the gate, per plan | Task 4 Step 3 |

The spec's `## FX default patch` requirements appear in no row because that section is now `## FX default patch — dropped` and asks for no change; see "Deliberately not in this plan".

**Gap, stated rather than papered over:** the spec's cell rule says "clicking a cell that **holds** a note". Task 3 wires the *add* half of the keyboard toggle — the cell holds a note the instant after the click — because no pointer gesture in this grid clicks a filled cell without erasing it, and auditioning inside a paint stroke would machine-gun the shared preview bus. The helper's `lenTicks` branch is fully general and directly tested, so a later pointer audition is a call-site change with no new arithmetic. This is recorded under "Deliberately not in this plan".

**2. Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Every code step carries the literal code. The one step that defers to the file it edits — Task 2 Step 1's `noteOnCalls()`/`noteOffCalls()` — says so explicitly, names the exact lines of the existing harness to copy from (`presetPreview.test.ts` lines 68/114/336/353/432, `freshEngine()`/`fakeCtx()` from `src/audio/testFakes.ts`), and carries an explicit escape if the assertion already exists.

**3. Type consistency.** `leadPreviewHoldSec(bpm: number, stride: number, lenTicks?: number): number` is defined in Task 1 and called with that exact name and argument order in Task 2 Step 4. `previewNote(note: string, lenTicks?: number): void` is produced in Task 2 and consumed in Task 3 Step 5 as `onPreview`, whose prop type `(note: string, lenTicks: number) => void` is assignable from it (the required `lenTicks` is narrower than the optional one, which is the correct direction). `leadPaintClickIsKeyboard(detail: number): boolean` and `leadNoteCells(len: number, stride: number): number` are pre-existing exports, cited with their real signatures.
