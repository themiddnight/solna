# DEV-387: Level calibration harness and trim table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~40 by-ear drum-kit gains and 29 by-ear preset levels with one committed, measured trim table so every drum **kit** and every synth preset lands within ±3 dB of −18 dBFS at max velocity, and a millisecond-scale lock test notices when a loudness-affecting default moves without a re-run. **Corrected post-implementation:** this line originally said "every drum voice" — the per-voice model the branch measured and rejected (Trap Beat: kick −13.7, snare −19.7, hihat −47.5, ride −45.9 dBFS, a 33.8 dB span that IS the kit's identity; per-voice normalisation wanted +29.5 dB on that hihat and would have flattened all 13 kits). Drum trims are per KIT; see the DEV-383 contract doc's `DRUM_TRIMS` note and the DEV-387 ledger's Task 11 entry.

**Architecture:** A manual `bun run calibration:generate` drives the **real** `AudioEngine` — reached through the `testFakes.ts` `(engine as any).ctx = …` seam — against a `node-web-audio-api` `OfflineAudioContext`, encodes the render to a temp WAV, and measures short-term LUFS with system `ffmpeg -af ebur128`. It writes `src/data/trimTable.ts`, a generated `src/data/` leaf of literals. At runtime `src/audio/trims.ts` turns each entry's `trimDb` into a linear gain that `triggerDrum` multiplies into velocity and `triggerSynthNoteOn` multiplies into `peakGain`; the authored numbers in `src/data/drumKits.ts` and `src/data/synthPresets.ts` are never rewritten. In CI only the committed table, a hash-drift lock test and a `check:levels` reporter run — no native addon, no ffmpeg, no rendering.

**Tech Stack:** Bun test runner + scripts, raw Web Audio API, `node-web-audio-api@2.2.0` (devDependency, generator-only), system `ffmpeg` from `PATH` (`-af ebur128`), `node:crypto` SHA-256 for config fingerprints.

**Spec:** Linear DEV-387; shared contract at `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`

## Global Constraints

- **Prerequisite: DEV-384 must have landed.** This plan consumes `src/utils/gainUnits.ts` (`toDbfs`, `toDecibels`, `dbToGain`, `FADER_MAX_DB`, types `Dbfs`/`Decibels`/`LinearGain`). That file does not exist on `main` today; do not start Task 3 before it does.
- `TARGET_DBFS = -18` (contract, `trimMath.ts` row). Never re-derived, never re-argued.
- `TOLERANCE_DB = 3` (contract, `trimMath.ts` row). The ±3 dB band in the AC is this constant.
- `FADER_MAX_DB = +12` (contract, `gainUnits.ts` row). Reused as the generator's review flag threshold: a voice needing more than the fader itself can give is a voicing problem, not a trim.
- `src/data/trimTable.ts` surface, as corrected after Task 11 ran for real: `interface TrimEntry { measuredDbfs: number; trimDb: number; configHash: string }`, `DRUM_TRIMS: Record<string, TrimEntry>` (kit name -> entry, the whole kit — **not** kit → voice as originally planned; see the contract doc's DRUM_TRIMS note and the DEV-387 ledger's Task 11 entry for why), `PRESET_TRIMS: Record<string, TrimEntry>` (preset id, unchanged — per-preset normalisation fits presets). Plain `number`, not branded — that is what keeps the leaf import-free.
- **No Zod branding** (contract divergence 1). `trimMath.ts` ports from murva with the Zod dropped and the `Decibels`/`Dbfs` naming distinction kept.
- **D-383-2 is taken:** `node-web-audio-api`, not Playwright. One devDependency, generator-only. No dev-only vite page.
- **`src/data/` files are independent leaves**: no runtime import (not even a sibling), no `new`, no impure global (`Math`, `Date`, `crypto`), no declared function. `src/data/dataLayerPurity.test.ts` lints this through eslint's own API.
- **`src/audio/` may import `src/data/` and `src/utils/`** (layering rule 2); it may never import `store/` or `components/`. `src/audio/trims.ts` therefore reads the table directly.
- **Engine setters are called only from `src/store/engineSync.ts`**, never from a component (layering rule 3). The one exception this plan uses is `src/audio/playback/presetPreview.ts`, which is itself in `src/audio/`.
- **The `../../` import ban is an `error`** (decision D2, global `no-restricted-syntax`). Files under `scripts/calibration/` must reach `src/` through the `@/` alias, which Bun resolves from `tsconfig.strict.json`'s `paths` (verified). Single-level `../` is fine.
- **`bun run eslint` must report nothing at all** — no errors and no warnings. `complexity` is `warn 20`; `triggerDrum` is already tuned against that ceiling, so new branching goes in a private helper, the way `triggerNonSwitchVoice` does.
- **The generator never runs in CI.** `bun test` must not load `node-web-audio-api` and must not spawn `ffmpeg`. Render-driving files are named `*.smoke.ts`, which Bun's test globs (`*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`) do not match.
- **EBU R128's 3-second gate:** `ebur128`'s short-term (`S:`) reading is a rolling 3 s window; ffmpeg reports a fixed ~−120.7 LUFS sentinel for every frame until 3 s has accumulated, whatever the real level. Every calibration pattern renders ≥ 4 s, and the sentinel is filtered **on value** (`> -100 LUFS`), never on the frame's `t:` timestamp — ffmpeg's frames land at 0.0999792, 0.1999792, … 2.99998, never on an exact boundary, so a `t >= 3` cutoff clips early.
- **"No valid LUFS readings" is not always a duration bug** — it can mean the voice is genuinely silent. Confirm the voice sounds in the app before assuming a harness bug.
- **Measurement uses the MEDIAN** of valid short-term readings, not the mean, so one anomalous frame cannot skew a committed default.
- **Authored numbers stay authored.** No task rewrites a `gain`, `clickLevel`, `bodyGain` or `noiseGain` in `src/data/drumKits.ts`, and no task rewrites a preset's `params`. A retune's diff must stay readable.
- Branch: `feat/dev-387-level-calibration`. Conventional commits.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/utils/trimMath.ts` | `TARGET_DBFS`, `TOLERANCE_DB`, `computeTrimDb`, `isWithinTolerance`. Ported from murva minus Zod. Lives in `src/utils/` so `bun run lint` type-checks it and DEV-388 can pin it; imported only by `scripts/`, so it never enters the vite bundle. |
| `src/data/trimTable.ts` | **GENERATED.** The committed table: `TrimEntry`, `DRUM_TRIMS`, `PRESET_TRIMS`. Literals only. |
| `src/audio/trims.ts` | Runtime application side. **Corrected post-implementation** (this row named a function that was never shipped): the real export is `drumTrimGainFor(kitName): number` — ONE linear gain for the whole kit, not a per-voice map — plus `synthTrimGainFor(presetName)` and `NEUTRAL_TRIM_GAIN`. Converts a table `trimDb` to a linear multiplier via `dbToGain`. |
| `scripts/calibration/ffmpegPath.ts` | `resolveFfmpegPath(binary?)` — locate system ffmpeg on `PATH`, or throw an install instruction. |
| `scripts/calibration/parseEbur128Output.ts` | `parseEbur128Output(stderr)` — every valid short-term LUFS reading, sentinel filtered on value. Ported verbatim from murva. |
| `scripts/calibration/measureLoudness.ts` | `medianShortTermLufs(stderr, label)` (pure) + `measureLoudness(wavPath)` (spawns ffmpeg). Ported from murva. |
| `scripts/calibration/encodeWav.ts` | `encodeWav(channels, sampleRate)` — 16-bit PCM WAV bytes from rendered `Float32Array` channels. |
| `scripts/calibration/renderOffline.ts` | The render harness. Drives the real engine against a `node-web-audio-api` `OfflineAudioContext`; exports the two pattern constants sets, `renderDrumVoice`, `renderPreset`. |
| `scripts/calibration/renderOffline.smoke.ts` | Manual proof the harness produces non-silent audio. Kept out of `bun test` by its name. |
| `scripts/calibration/loudnessConfig.ts` | `hashLoudnessConfig`, `drumLoudnessConfig`, `presetLoudnessConfig`, and the two exclusion lists. Uses `node:crypto`; never bundled. |
| `scripts/calibration/writeTrimTable.ts` | `TRIM_TABLE_PATH`, `renderTrimTableSource(drums, presets)`, `writeTrimTable(drums, presets)`. |
| `scripts/calibration/generateTrimTable.ts` | The batch orchestrator behind `bun run calibration:generate`. |
| `scripts/calibration/levelChecks.ts` | `LevelFinding` plus `findMissingEntries`, `findOrphanEntries`, `findDriftedEntries`, `findOutOfToleranceEntries`. One implementation behind both front doors. |
| `scripts/calibration/trimTable.lock.test.ts` | The fast lock test (`bun test`). Four cases over the four collectors. |
| `scripts/calibration/verifyApplied.smoke.ts` | Manual re-render of three representative voices **with the trim applied**, asserting each lands within ±3 dB of −18 dBFS. |
| `scripts/check-levels.ts` | House-style `check:*` reporter over the same collectors. Milliseconds; never renders, never spawns ffmpeg. |
| `scripts/calibration/README.md` | When to re-run, what a flagged entry means, the recorded pitfalls. |

**Test files created**

`src/utils/trimMath.test.ts`, `scripts/calibration/ffmpegPath.test.ts`, `scripts/calibration/parseEbur128Output.test.ts`, `scripts/calibration/measureLoudness.test.ts`, `scripts/calibration/encodeWav.test.ts`, `scripts/calibration/loudnessConfig.test.ts`, `scripts/calibration/writeTrimTable.test.ts`, `scripts/calibration/trimTable.lock.test.ts`, `src/audio/trims.test.ts`.

**Modified**

| Path | Change |
|---|---|
| `package.json:6-18` | Add `calibration:generate`, `calibration:smoke`, `check:levels`; add `check:levels` to `verify`. |
| `package.json:38-45` | Add `node-web-audio-api` devDependency. |
| `src/audio/engine.ts:348` | Add `drumTrimGains` and `presetTrims` private fields next to `drumKit`. |
| `src/audio/engine.ts:998` | `peakGain` picks up the per-source preset trim. |
| `src/audio/engine.ts:1668-1670` | `setDrumKit` takes an optional `kitName` and resolves the kit's trim once. **Superseded by the kit-level redesign (Task 11 follow-up): `DRUM_TRIMS` is keyed by kit name, not kit+voice, and `setDrumKit` resolves a single `drumTrimGain: number`, not a per-voice map.** |
| `src/audio/engine.ts:2143-2147` | `triggerDrum` multiplies the trim into velocity. **Superseded: the private `drumTrim` helper this row describes no longer exists — a single-field read costs `triggerDrum` no `??`, so there is nothing left to isolate into a helper. `hitLevel = clampVelocity(velocity) * this.drumTrimGain` directly.** |
| `src/audio/engine.ts` (new method near `setSourceGain`, ~1424) | `setPresetTrim(source, trimGain)`. |
| `src/store/engineSync.ts:93` | `setDrumKit(DRUM_KITS[s.soundKit], s.soundKit)`. |
| `src/store/engineSync.ts:100-103` | Four `setPresetTrim` calls in `applySliceState`. |
| `src/store/engineSync.ts:146` | `setDrumKit(DRUM_KITS[kit], kit)`. |
| `src/store/engineSync.ts:207-216` | The `synthSources` loop also pushes `setPresetTrim`. |
| `src/audio/playback/presetPreview.ts:192-204` | `previewSynthPreset` sets the preview bus's preset trim before triggering. |

---

## Design decisions, stated once

**Which ffmpeg.** System `ffmpeg` on `PATH`, not murva's `@ffmpeg-installer/ffmpeg`. D-383-2 already commits to exactly one new devDependency (`node-web-audio-api`); `@ffmpeg-installer` would add a second one that ships platform binaries for a script that runs manually, on a machine that already has ffmpeg 9.0.1. The generator probes once at startup and exits with an install instruction if it is absent — a clear error, not a silent skip.

**Where the trim is applied.** Two places, both multiplicative, neither touching authored data.

- Drums, AS ORIGINALLY PLANNED (superseded — see below): `setDrumKit(kit, kitName)` resolves `DRUM_TRIMS[kitName]` into a `Record<string, number>` of linear gains **once per kit change**, and `triggerDrum` multiplies that into `clampVelocity(velocity)` **before** the per-voice `gain`. The lookup is one map read on the hot path; the `??` fallback lives in a private `drumTrim` helper so it costs `triggerDrum` no cyclomatic complexity.
- **Drums, AS SHIPPED (kit-level redesign, after Task 11 ran the generator for real):** a drum kit's voices are not independent — a trap hihat sitting tens of dB below its kick is the kit's own design, and normalising each voice to a common target would have flattened that gap across all 13 kits (37 voices flagged past the fader's own ±12 dB range). `DRUM_TRIMS` is `Record<string, TrimEntry>` keyed by kit name, one entry per kit, measured from a fixed reference backbeat (`DRUM_KIT_BAR` in `renderOffline.ts`) rendered and measured as a whole rather than averaged from per-voice numbers. `setDrumKit(kit, kitName)` resolves ONE linear gain (`drumTrimGainFor`) into the private field `drumTrimGain: number`, and `triggerDrum` multiplies that directly into `clampVelocity(velocity)` — no per-voice lookup, no `drumTrim` helper (removed; a single field read needs no `??`). `drumLoudnessHash(kitName)` fingerprints every voice of the merged kit together, so retuning any one voice fires the lock test for the whole kit. Decision and reasoning recorded in the shared contract doc (`…-dev-383-gain-staging-contract.md`) and on Linear DEV-387; `PRESET_TRIMS` is untouched by this — synth presets ARE independent instruments and the per-preset model fits them.
- Synth: a per-source `setPresetTrim(source, trimGain)` setter, wired in `engineSync.ts` from each source's `params.preset`, multiplied into `peakGain` in `triggerSynthNoteOn`. `PRESET_TRIMS` is keyed by preset **id** (contract), but the engine only ever sees `params.preset`, which `applyPreset` sets to the preset's **name** — so `synthTrimGainFor` resolves name → id over the factory library in `src/audio/trims.ts`. A user preset whose name is not a factory name gets `NEUTRAL_TRIM_GAIN`; a user preset that reuses a factory name gets that factory patch's trim, which is a bounded, documented imprecision and the reason Task 7 also lands a uniqueness assertion on factory names.

Resolving through a setter rather than reading `params.preset` inside `triggerSynthNoteOn` also keeps the default explicitly neutral: `freshEngine()` never calls `setPresetTrim` or `setDrumKit`, so no existing engine test's absolute peak assertion moves.

**What the trim is not.** It is a measured default staging for the shipped patch, not live auto-gain. A user who turns the cutoff knob keeps the patch's trim. Live measurement-driven trim is out of scope for this issue.

**What the config hash covers, per entry.** The rule: **a field is in the hash if changing it changes the K-weighted energy of the rendered, dry voice.** `ebur128` is K-weighted, so pitch and filter fields are spectral gain and are in — a kick at 35 Hz and one at 60 Hz genuinely measure several dB apart.

- **Drum voice:** every field of the *merged* voice params object (`KickParams`, `SnareParams`, `HatParams`, `ClapParams`, `TomParams`, `RideParams`, `BellParams`), hashed together with the kit name and voice name so an entry cannot be copy-pasted between kits. **Excluded: `reverbSend`.** It only feeds the drum reverb send, and the calibration render zeroes `reverbGain`, so it cannot move a measurement. That is the one field a reviewer would otherwise expect and it is excluded on purpose: firing the lock test on a wet-send retune would train people to regenerate without thinking.
- **Not hashed at all: `DRUM_KITS[name].reference`.** It is a `DrumKitReference` documentation field, read by nothing in `triggerDrum`.
- **Synth preset:** the *resolved* full `SynthParams` (base defaults + the preset's partial) minus five fields. **Excluded: `preset`** (a display name, not a signal), and **`arpActive` / `arpMode` / `arpRate` / `arpOctaves`** — the arpeggiator is a scheduler above the engine, it never runs in the calibration pattern, and it cannot change what one triggered note sounds like. Everything else is in, including `lfoRate`/`lfoDepth`/`lfoTarget` (the `'volume'` target is literally a tremolo gain) and `octave` (pitch, therefore K-weighted energy). Hashing the *resolved* params rather than the partial is deliberate: a change to the base defaults also changes what a partial preset renders as, and should fire.

**The render patterns, stated concretely.**

- **Drum voice:** sample rate 44100, mono→stereo master chain, total render **5.0 s**. Nine hits at velocity **1.0**, the first at **t = 0.25 s**, every **0.5 s** thereafter (last at 4.25 s) — the 8th-note grid at 120 BPM. One fixed pattern for all eleven voices, deliberately: uniformity is what makes the trims comparable across kits, which is the whole point of the issue. The consequence, stated rather than hidden: a crash or ride with a 1.2–2.5 s wash stacks four to five overlapping tails at this density, so its measurement runs hot relative to a single isolated hit and its trim pulls it a little quieter than one hit alone would need. The alternative — a per-voice interval — would make each voice's number mean something different and the ±3 dB band meaningless across the roster.
- **Synth preset:** total render **6.5 s**. Four notes on **`'C3'`** (the preset's own `octave` shifts it, exactly as a player hears it) at velocity **1.0**, note-on at **t = 0.25, 1.75, 3.25, 4.75 s**, each note-off **1.3 s** after its note-on. The 1.5 s spacing with a 1.3 s gate serves both families from one pattern: a pad with attack up to ~1.0 s reaches sustain inside the gate, and a pluck whose envelope is over in 200 ms still puts four attacks inside every 3 s short-term window instead of one attack followed by 6 s of silence.

Both fill well past the 3 s EBU gate, which is the constraint that sets the durations.

---

### Task 1: ffmpeg discovery and the devDependency

**Files:**
- Create: `scripts/calibration/ffmpegPath.ts`
- Test: `scripts/calibration/ffmpegPath.test.ts`
- Modify: `package.json:38-45`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveFfmpegPath(binary?: string): string` — an absolute path to the executable, or throws.

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/ffmpegPath.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolveFfmpegPath } from './ffmpegPath.ts';

describe('resolveFfmpegPath', () => {
  test('throws an install instruction when the binary is not on PATH', () => {
    expect(() => resolveFfmpegPath('solna-definitely-not-a-real-binary')).toThrow(
      /solna-definitely-not-a-real-binary is not on PATH/,
    );
  });

  test('the thrown message names the install command, not just the failure', () => {
    expect(() => resolveFfmpegPath('solna-definitely-not-a-real-binary')).toThrow(
      /brew install ffmpeg/,
    );
  });

  test('resolves a binary that is always present to an absolute path', () => {
    // `sh` is on PATH on every POSIX machine this repo is developed on, so the
    // positive case is provable without asserting that ffmpeg itself is installed —
    // which would make `bun test` red on a machine that only ever reads the
    // committed table, exactly the machine this harness is designed not to burden.
    expect(resolveFfmpegPath('sh')).toMatch(/^\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/ffmpegPath.test.ts`
Expected: FAIL with `error: Cannot find module './ffmpegPath.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/calibration/ffmpegPath.ts`:

```ts
/**
 * Locates the ffmpeg the calibration harness measures with.
 *
 * solna uses the SYSTEM ffmpeg on PATH rather than murva's
 * `@ffmpeg-installer/ffmpeg`. D-383-2 commits this epic to exactly one new
 * devDependency (`node-web-audio-api`); a second one shipping platform
 * binaries, for a script that runs manually on a machine that already has
 * ffmpeg, is footprint for nothing. The cost is that "not installed" must be a
 * clear error rather than an impossibility — which is this file.
 */
import { spawnSync } from 'node:child_process';

export function resolveFfmpegPath(binary = 'ffmpeg'): string {
  const found = spawnSync('/usr/bin/which', [binary], { encoding: 'utf8' });
  const path = found.stdout?.trim() ?? '';
  if (found.status !== 0 || path.length === 0) {
    throw new Error(
      `${binary} is not on PATH. The calibration harness measures loudness with ` +
        `ffmpeg's ebur128 filter; install it with \`brew install ffmpeg\` (macOS) or ` +
        `\`apt install ffmpeg\` (Debian/Ubuntu) and re-run. ` +
        `Nothing in \`bun run verify\` needs it — only \`bun run calibration:generate\`.`,
    );
  }
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/calibration/ffmpegPath.test.ts`
Expected: PASS, 3 pass 0 fail

- [ ] **Step 5: Add the render devDependency**

Run: `bun add --dev node-web-audio-api@2.2.0`
Expected: `package.json` gains `"node-web-audio-api": "2.2.0"` (exact pin, not a caret range) under `devDependencies`, `bun.lock` updates. The pin is deliberate: this is the only dependency whose version can silently move a committed measured number, since the trim table is literally its render output — a caret would let a routine `bun install` regenerate different numbers than the ones a past commit measured.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/dev-387-level-calibration
git add scripts/calibration/ffmpegPath.ts scripts/calibration/ffmpegPath.test.ts package.json bun.lock
git commit -m "feat(calibration): locate system ffmpeg, add the offline render devDependency"
```

---

### Task 2: Port `parseEbur128Output`

**Files:**
- Create: `scripts/calibration/parseEbur128Output.ts`
- Test: `scripts/calibration/parseEbur128Output.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseEbur128Output(stderr: string): { shortTermLufs: number[] }`

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/parseEbur128Output.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { parseEbur128Output } from './parseEbur128Output.ts';

// Real ffmpeg `-af ebur128` output, verified against an actual run: `M:` precedes
// `S:` on every line, and every `S:` reading before t=3s is the ~-120.7 LUFS
// "gate not open yet" sentinel (EBU R128's 3-second short-term window).
const SAMPLE_FFMPEG_STDERR = `
[Parsed_ebur128_0 @ 0x7f9] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 1.09998    TARGET:-23 LUFS    M: -15.4 S:-120.7     I: -15.4 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 2.99998    TARGET:-23 LUFS    M: -24.5 S: -18.2     I: -18.3 LUFS       LRA:  20.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 3.09998    TARGET:-23 LUFS    M: -17.2 S: -18.2     I: -18.3 LUFS       LRA:  20.1 LU
[Parsed_ebur128_0 @ 0x7f9] t: 3.19998    TARGET:-23 LUFS    M: -15.7 S: -18.1     I: -18.2 LUFS       LRA:  20.1 LU
[Parsed_ebur128_0 @ 0x7f9] Summary:

  Integrated loudness:
    I:         -18.1 LUFS
    Threshold: -28.2 LUFS
`;

describe('parseEbur128Output', () => {
  test('extracts every valid short-term (S:) reading, in order, once the 3s gate opens', () => {
    expect(parseEbur128Output(SAMPLE_FFMPEG_STDERR).shortTermLufs).toEqual([-18.2, -18.2, -18.1]);
  });

  test('drops every reading before the gate opens (the -120.7 sentinel)', () => {
    const { shortTermLufs } = parseEbur128Output(SAMPLE_FFMPEG_STDERR);
    expect(shortTermLufs.every((value) => value > -100)).toBe(true);
  });

  test('filters on VALUE, not on the t: timestamp — a 2.99998 frame past the gate is kept', () => {
    // ffmpeg's frames never land on an exact 3.0 boundary, so a `t >= 3` cutoff
    // would discard this reading. Keeping it is the whole point of the value gate.
    expect(parseEbur128Output(SAMPLE_FFMPEG_STDERR).shortTermLufs[0]).toBe(-18.2);
  });

  test('returns an empty array for a clip shorter than the gate, not a bogus sentinel reading', () => {
    const shortClip = `
[Parsed_ebur128_0 @ 0x7f9] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 1.99998    TARGET:-23 LUFS    M: -15.4 S:-120.7     I: -15.4 LUFS       LRA:   0.0 LU
`;
    expect(parseEbur128Output(shortClip).shortTermLufs).toEqual([]);
  });

  test('returns an empty array for output with no ebur128 frame lines, rather than throwing', () => {
    expect(parseEbur128Output('no relevant output here').shortTermLufs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/parseEbur128Output.test.ts`
Expected: FAIL with `error: Cannot find module './parseEbur128Output.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/calibration/parseEbur128Output.ts` (ported from murva `app/frontend/scripts/calibration/parseEbur128Output.ts`; no changes beyond import paths — there are none):

```ts
// Real ffmpeg per-frame lines look like:
//   t: 3.09998    TARGET:-23 LUFS    M: -17.2 S: -18.2     I: -18.3 LUFS       LRA:  20.1 LU
// M: (momentary) always precedes S: (short-term) — a hand-written fixture that
// assumed the opposite order previously let this parser ship broken against real
// ffmpeg output.
const SHORT_TERM_LINE = /S:\s*(-?\d+(?:\.\d+)?)/;

/**
 * EBU R128 short-term loudness is a rolling 3-second window: ffmpeg reports a fixed
 * sentinel (-120.7 LUFS, "gate not open yet") for every frame until 3s of audio has
 * accumulated, regardless of actual signal level. Filtering on VALUE (not the frame's
 * `t:` timestamp) is robust to ffmpeg's frame quantization — frames land at 0.0999792,
 * 0.1999792, ..., 2.99998, never exactly on a 0.1s boundary, so a `t >= 3` cutoff
 * clips early. A clip shorter than 3s never clears this floor and produces zero valid
 * readings: a real finding (widen the pattern), not a value to interpolate around.
 */
const SHORT_TERM_GATE_SENTINEL_FLOOR_LUFS = -100;

/**
 * Parses ffmpeg's `-af ebur128` stderr, extracting every valid short-term (S:, 3s
 * window) LUFS reading — chosen over integrated (I:, whole-clip) so a calibration
 * pattern's transient attack is not averaged away.
 */
export function parseEbur128Output(stderr: string): { shortTermLufs: number[] } {
  const shortTermLufs: number[] = [];
  for (const line of stderr.split('\n')) {
    const match = SHORT_TERM_LINE.exec(line);
    const captured = match?.[1];
    if (captured === undefined) continue;
    const value = Number.parseFloat(captured);
    if (value > SHORT_TERM_GATE_SENTINEL_FLOOR_LUFS) shortTermLufs.push(value);
  }
  return { shortTermLufs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/calibration/parseEbur128Output.test.ts`
Expected: PASS, 5 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/calibration/parseEbur128Output.ts scripts/calibration/parseEbur128Output.test.ts
git commit -m "feat(calibration): port murva's ebur128 short-term parser"
```

---

### Task 3: Port `trimMath`

**Files:**
- Create: `src/utils/trimMath.ts`
- Test: `src/utils/trimMath.test.ts`

**Interfaces:**
- Consumes: `src/utils/gainUnits.ts` — `toDbfs`, `toDecibels`, types `Dbfs`, `Decibels` (DEV-384).
- Produces: `TARGET_DBFS: Dbfs`, `TOLERANCE_DB: number`, `computeTrimDb(measuredDbfs, targetDbfs?): Decibels`, `isWithinTolerance(measuredDbfs, appliedTrimDb, targetDbfs?): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/trimMath.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { toDbfs, toDecibels } from '@/utils/gainUnits';
import { TARGET_DBFS, TOLERANCE_DB, computeTrimDb, isWithinTolerance } from '@/utils/trimMath';

describe('the contract constants', () => {
  test('TARGET_DBFS is -18, the value the shared contract states', () => {
    expect(TARGET_DBFS).toBe(-18);
  });

  test('TOLERANCE_DB is 3, the value the shared contract states', () => {
    expect(TOLERANCE_DB).toBe(3);
  });
});

describe('computeTrimDb', () => {
  test('a voice measured 6 dB under target needs +6 dB', () => {
    expect(computeTrimDb(toDbfs(-24))).toBe(6);
  });

  test('a voice measured 6 dB over target needs -6 dB', () => {
    expect(computeTrimDb(toDbfs(-12))).toBe(-6);
  });

  test('a voice already at target needs nothing', () => {
    expect(computeTrimDb(toDbfs(-18))).toBe(0);
  });

  test('an explicit target overrides TARGET_DBFS', () => {
    expect(computeTrimDb(toDbfs(-24), toDbfs(-20))).toBe(4);
  });
});

describe('isWithinTolerance', () => {
  test('measured plus its own computed trim always lands, by construction', () => {
    const measured = toDbfs(-31.4);
    expect(isWithinTolerance(measured, computeTrimDb(measured))).toBe(true);
  });

  test('exactly TOLERANCE_DB away is inside the band, not outside it', () => {
    expect(isWithinTolerance(toDbfs(-21), toDecibels(0))).toBe(true);
  });

  test('a hair past TOLERANCE_DB is outside the band', () => {
    expect(isWithinTolerance(toDbfs(-21.01), toDecibels(0))).toBe(false);
  });

  test('a trim that overshoots is caught, not just an undershoot', () => {
    expect(isWithinTolerance(toDbfs(-18), toDecibels(4))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/trimMath.test.ts`
Expected: FAIL with `error: Cannot find module '@/utils/trimMath'`

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/trimMath.ts`:

```ts
/**
 * The calibration target and the arithmetic around it. Ported from murva's
 * `src/engine/instruments/shared/calibration/trimMath.ts` with the Zod branding
 * dropped (shared-contract divergence 1) and the Decibels/Dbfs naming kept: a
 * measurement is ABSOLUTE (Dbfs, 0 = ceiling), a trim is RELATIVE (Decibels,
 * 0 = unity).
 *
 * Lives in src/utils/ so `bun run lint` type-checks it and DEV-388 can pin it.
 * Only `scripts/calibration/` imports it, so it never enters the vite bundle.
 */
import { toDbfs, toDecibels, type Dbfs, type Decibels } from '@/utils/gainUnits';

/** The reference level every voice is calibrated toward. Shared contract, `trimMath.ts` row. */
export const TARGET_DBFS: Dbfs = toDbfs(-18);

/** The acceptance band, verbatim from the shared contract. This file hits it, it does not redefine it. */
export const TOLERANCE_DB = 3;

export function computeTrimDb(measuredDbfs: Dbfs, targetDbfs: Dbfs = TARGET_DBFS): Decibels {
  return toDecibels(targetDbfs - measuredDbfs);
}

export function isWithinTolerance(
  measuredDbfs: Dbfs,
  appliedTrimDb: Decibels,
  targetDbfs: Dbfs = TARGET_DBFS,
): boolean {
  const resultingDbfs = measuredDbfs + appliedTrimDb;
  return Math.abs(resultingDbfs - targetDbfs) <= TOLERANCE_DB;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/trimMath.test.ts`
Expected: PASS, 10 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/utils/trimMath.ts src/utils/trimMath.test.ts
git commit -m "feat(calibration): port trimMath — target -18 dBFS, tolerance 3 dB"
```

---

### Task 4: `measureLoudness`

**Files:**
- Create: `scripts/calibration/measureLoudness.ts`
- Test: `scripts/calibration/measureLoudness.test.ts`

**Interfaces:**
- Consumes: `parseEbur128Output` (Task 2), `resolveFfmpegPath` (Task 1), `toDbfs` from `@/utils/gainUnits`.
- Produces: `medianShortTermLufs(stderr: string, label: string): number` (pure), `measureLoudness(wavPath: string): Promise<Dbfs>`.

The split is what makes this testable without ffmpeg: the median selection and the empty-readings error are pure and covered; the `spawn` wrapper is three lines with nothing to get wrong that the smoke run in Task 8 will not catch.

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/measureLoudness.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { medianShortTermLufs } from './measureLoudness.ts';

const frame = (short: number) =>
  `[Parsed_ebur128_0 @ 0x7f9] t: 3.09998  TARGET:-23 LUFS  M: -17.2 S: ${short}  I: -18.3 LUFS  LRA: 20.1 LU`;

describe('medianShortTermLufs', () => {
  test('returns the median of an odd number of readings', () => {
    const stderr = [frame(-20), frame(-14), frame(-17)].join('\n');
    expect(medianShortTermLufs(stderr, 'kick')).toBe(-17);
  });

  test('takes the MEDIAN, so one anomalous frame cannot skew a committed default', () => {
    // The mean of these five is -21.6; the median is -18. A single wild frame is
    // exactly what a mean would let through into a shipped number.
    const stderr = [frame(-18), frame(-18.2), frame(-17.9), frame(-18.1), frame(-36)].join('\n');
    expect(medianShortTermLufs(stderr, 'kick')).toBe(-18.1);
  });

  test('throws a message naming the label and the 3s gate when there are no valid readings', () => {
    expect(() => medianShortTermLufs(frame(-120.7), 'Trap Beat/crash')).toThrow(
      /Trap Beat\/crash.*EBU R128 3s short-term gate/s,
    );
  });

  test('the no-readings message also names genuine silence, not only a duration bug', () => {
    expect(() => medianShortTermLufs('', 'Trap Beat/crash')).toThrow(/genuinely silent/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/measureLoudness.test.ts`
Expected: FAIL with `error: Cannot find module './measureLoudness.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/calibration/measureLoudness.ts`:

```ts
/**
 * Ported from murva's `scripts/calibration/measureLoudness.ts`. Two changes and
 * no others: ffmpeg comes from PATH (see ffmpegPath.ts) rather than
 * `@ffmpeg-installer/ffmpeg`, and the pure median selection is split out so it
 * can be tested without spawning anything.
 */
import { spawn } from 'node:child_process';
import { toDbfs, type Dbfs } from '@/utils/gainUnits';
import { resolveFfmpegPath } from './ffmpegPath.ts';
import { parseEbur128Output } from './parseEbur128Output.ts';

/**
 * A single representative short-term LUFS reading: the MEDIAN of every valid `S:`
 * sample. Median, not mean, so one anomalous frame cannot skew a committed default.
 */
export function medianShortTermLufs(stderr: string, label: string): number {
  const { shortTermLufs } = parseEbur128Output(stderr);
  if (shortTermLufs.length === 0) {
    throw new Error(
      `No valid short-term LUFS readings for ${label}. Either the rendered clip is ` +
        `shorter than the EBU R128 3s short-term gate — widen the calibration pattern's ` +
        `duration — or the voice is genuinely silent, which is a bug in the voice, not ` +
        `in this harness. Play it in the app before assuming the harness is wrong.`,
    );
  }
  const sorted = [...shortTermLufs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === undefined) throw new Error(`Unreachable: empty LUFS sample for ${label}`);
  return median;
}

export async function measureLoudness(wavPath: string, label = wavPath): Promise<Dbfs> {
  const ffmpeg = resolveFfmpegPath();
  const stderr = await new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-i', wavPath, '-af', 'ebur128', '-f', 'null', '-']);
    let output = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', reject);
  });
  return toDbfs(medianShortTermLufs(stderr, label));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/calibration/measureLoudness.test.ts`
Expected: PASS, 4 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/calibration/measureLoudness.ts scripts/calibration/measureLoudness.test.ts
git commit -m "feat(calibration): measure short-term LUFS via ffmpeg's ebur128, median of valid frames"
```

---

### Task 5: WAV encoding

**Files:**
- Create: `scripts/calibration/encodeWav.ts`
- Test: `scripts/calibration/encodeWav.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array`

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/encodeWav.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { encodeWav } from './encodeWav.ts';

const ascii = (bytes: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...bytes.slice(from, from + len));

describe('encodeWav', () => {
  test('writes the RIFF/WAVE/fmt /data chunk ids ffmpeg looks for', () => {
    const wav = encodeWav([new Float32Array(4)], 44100);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
  });

  test('declares the channel count and sample rate it was given', () => {
    const view = new DataView(encodeWav([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  test('is 44 header bytes plus two bytes per sample per channel', () => {
    expect(encodeWav([new Float32Array(100), new Float32Array(100)], 44100).length).toBe(44 + 400);
  });

  test('interleaves channels, so a hard-left signal is not written into both', () => {
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([0, 0]);
    const view = new DataView(encodeWav([left, right], 44100).buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
  });

  test('clamps out-of-range samples instead of wrapping them to the opposite polarity', () => {
    const view = new DataView(encodeWav([new Float32Array([2, -2])], 44100).buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/encodeWav.test.ts`
Expected: FAIL with `error: Cannot find module './encodeWav.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/calibration/encodeWav.ts`:

```ts
/**
 * Rendered `AudioBuffer` channels -> a 16-bit PCM WAV, because ffmpeg reads files
 * and `OfflineAudioContext.startRendering()` returns Float32 channel data.
 *
 * 16-bit is deliberate and not a shortcut: the quantization floor is about
 * -96 dBFS and every calibration measurement sits near -18 dBFS, so the encoding
 * contributes nothing measurable to a number that is reported to 0.1 dB.
 */
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  const dataBytes = frameCount * channelCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, channelCount * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]?.[frame] ?? 0;
      // Clamp, never wrap: a sample past +1 wrapping to -32768 would turn an
      // over-hot voice into a measurement that reads plausible.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/calibration/encodeWav.test.ts`
Expected: PASS, 5 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/calibration/encodeWav.ts scripts/calibration/encodeWav.test.ts
git commit -m "feat(calibration): encode rendered channels as 16-bit PCM WAV"
```

---

### Task 6: The generated table's shape and its writer

**Files:**
- Create: `src/data/trimTable.ts` (empty maps; the generator fills it in Task 11)
- Create: `scripts/calibration/writeTrimTable.ts`
- Test: `scripts/calibration/writeTrimTable.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TrimEntry`, `DRUM_TRIMS`, `PRESET_TRIMS` (in `src/data/trimTable.ts`, exactly the shared-contract surface); `TRIM_TABLE_PATH`, `renderTrimTableSource(drums, presets): string`, `writeTrimTable(drums, presets): void` (in `scripts/calibration/writeTrimTable.ts`).

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/writeTrimTable.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { renderTrimTableSource } from './writeTrimTable.ts';

const DRUMS = {
  'Retro Drive': { kick: { measuredDbfs: -12.4, trimDb: -5.6, configHash: 'aaa' } },
};
const PRESETS = { 'factory-cosmic-lead': { measuredDbfs: -24.1, trimDb: 6.1, configHash: 'bbb' } };

describe('renderTrimTableSource', () => {
  test('marks the file generated and names the command that regenerates it', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    expect(source).toContain('GENERATED FILE — do not hand-edit');
    expect(source).toContain('bun run calibration:generate');
  });

  test('emits the contract surface verbatim', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    expect(source).toContain('export interface TrimEntry {');
    expect(source).toContain('export const DRUM_TRIMS: Record<string, Record<string, TrimEntry>> = {');
    expect(source).toContain('export const PRESET_TRIMS: Record<string, TrimEntry> = {');
  });

  test('emits every entry with its measurement alongside its trim, so a diff shows what moved and why', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    expect(source).toContain('measuredDbfs: -12.4, trimDb: -5.6, configHash: "aaa"');
    expect(source).toContain('measuredDbfs: -24.1, trimDb: 6.1, configHash: "bbb"');
  });

  test('holds nothing src/data/ forbids: no import, no new, no function, no impure global', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    // The line-start anchors keep prose in the header comment from matching.
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\bnew /);
    expect(source).not.toMatch(/^(export )?function /m);
    expect(source).not.toMatch(/\b(Math|Date|crypto)\./);
  });

  test('sorts kits, voices and presets, so a re-run reorders nothing and the diff stays readable', () => {
    const source = renderTrimTableSource(
      { Zed: { kick: DRUMS['Retro Drive'].kick }, Alpha: { snare: DRUMS['Retro Drive'].kick } },
      { 'z-preset': PRESETS['factory-cosmic-lead'], 'a-preset': PRESETS['factory-cosmic-lead'] },
    );
    expect(source.indexOf('"Alpha"')).toBeLessThan(source.indexOf('"Zed"'));
    expect(source.indexOf('"a-preset"')).toBeLessThan(source.indexOf('"z-preset"'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/writeTrimTable.test.ts`
Expected: FAIL with `error: Cannot find module './writeTrimTable.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/calibration/writeTrimTable.ts`:

```ts
/**
 * Emits `src/data/trimTable.ts`. The output is a src/data/ LEAF, so it may hold
 * literals and type declarations and nothing else — no import (not even a sibling),
 * no `new`, no impure global, no declared function. `src/data/dataLayerPurity.test.ts`
 * lints that through eslint's own API, which is why this writer emits plain `number`
 * fields rather than `toDbfs(...)` calls the way murva's does.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GeneratedTrimEntry {
  measuredDbfs: number;
  trimDb: number;
  configHash: string;
}

export const TRIM_TABLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/data/trimTable.ts',
);

const round = (value: number) => Number(value.toFixed(2));

function entryLiteral(entry: GeneratedTrimEntry): string {
  return `{ measuredDbfs: ${round(entry.measuredDbfs)}, trimDb: ${round(entry.trimDb)}, configHash: ${JSON.stringify(entry.configHash)} }`;
}

export function renderTrimTableSource(
  drums: Record<string, Record<string, GeneratedTrimEntry>>,
  presets: Record<string, GeneratedTrimEntry>,
): string {
  const drumBody = Object.keys(drums)
    .sort()
    .map((kit) => {
      const voices = drums[kit] ?? {};
      const rows = Object.keys(voices)
        .sort()
        .map((voice) => `    ${JSON.stringify(voice)}: ${entryLiteral(voices[voice]!)},`)
        .join('\n');
      return `  ${JSON.stringify(kit)}: {\n${rows}\n  },`;
    })
    .join('\n');

  const presetBody = Object.keys(presets)
    .sort()
    .map((id) => `  ${JSON.stringify(id)}: ${entryLiteral(presets[id]!)},`)
    .join('\n');

  return `/**
 * GENERATED FILE — do not hand-edit.
 * Generator: scripts/calibration/generateTrimTable.ts, via \`bun run calibration:generate\`.
 * See scripts/calibration/README.md for when to re-run and what a flagged entry means.
 *
 * One measured trim per drum-kit voice and per synth preset. \`measuredDbfs\` is what
 * the uncalibrated voice rendered at; \`trimDb\` is TARGET_DBFS (-18) minus it;
 * \`configHash\` fingerprints exactly the loudness-affecting config, so
 * \`bun run check:levels\` can tell a retune from a re-run.
 */
export interface TrimEntry {
  /** The uncalibrated render's short-term LUFS median, in dBFS. */
  measuredDbfs: number;
  /** TARGET_DBFS - measuredDbfs. Applied as a linear gain by src/audio/trims.ts. */
  trimDb: number;
  /** sha256 over the loudness-affecting config, per scripts/calibration/loudnessConfig.ts. */
  configHash: string;
}

/** Kit name -> voice name -> entry. */
export const DRUM_TRIMS: Record<string, Record<string, TrimEntry>> = {
${drumBody}
};

/** Synth preset id -> entry. */
export const PRESET_TRIMS: Record<string, TrimEntry> = {
${presetBody}
};
`;
}

export function writeTrimTable(
  drums: Record<string, Record<string, GeneratedTrimEntry>>,
  presets: Record<string, GeneratedTrimEntry>,
): void {
  writeFileSync(TRIM_TABLE_PATH, renderTrimTableSource(drums, presets));
}
```

- [ ] **Step 4: Land the empty table**

Run: `bun -e 'const m = await import("./scripts/calibration/writeTrimTable.ts"); m.writeTrimTable({}, {});'`
Expected: `src/data/trimTable.ts` exists with `DRUM_TRIMS` and `PRESET_TRIMS` both `{}`. This is the neutral state the engine reads until Task 11 fills it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test scripts/calibration/writeTrimTable.test.ts src/data/dataLayerPurity.test.ts && bun run eslint src/data/trimTable.ts`
Expected: PASS, 6 pass 0 fail on the writer, the purity suite still green, and eslint printing nothing for the generated leaf.

- [ ] **Step 6: Commit**

```bash
git add scripts/calibration/writeTrimTable.ts scripts/calibration/writeTrimTable.test.ts src/data/trimTable.ts
git commit -m "feat(calibration): emit the trim table as a pure src/data/ leaf"
```

---

### Task 7: Apply the trim in the engine

Landing the application side **before** the render harness is deliberate: Task 8's `renderOffline.ts` drives the calibrated path through `setDrumKit(kit, kitName)` and `setPresetTrim`, so those must exist first. With the table still empty (Task 6 landed it with `{}`), every lookup returns `NEUTRAL_TRIM_GAIN` and nothing audible changes yet — this task adds the wiring, Task 11 adds the numbers.

**Files:**
- Create: `src/audio/trims.ts`
- Test: `src/audio/trims.test.ts`
- Modify: `src/audio/engine.ts:348`, `src/audio/engine.ts:998`, `src/audio/engine.ts:1668-1670`, `src/audio/engine.ts:2143-2147`, and a new method after `setSourceGain` (~`src/audio/engine.ts:1424`)
- Modify: `src/store/engineSync.ts:93`, `:100-103`, `:146`, `:207-216`
- Modify: `src/audio/playback/presetPreview.ts:192-204`

**Interfaces:**
- Consumes: `DRUM_TRIMS`, `PRESET_TRIMS` from `@/data/trimTable` (Task 6); `dbToGain`, `toDecibels` from `@/utils/gainUnits`; `SYNTH_PRESETS` from `@/data/synthPresets`.
- Produces: `NEUTRAL_TRIM_GAIN: number` (`1`), `drumTrimGainsFor(kitName: string | undefined): Record<string, number>`, `synthTrimGainFor(presetName: string | undefined): number`; engine `setDrumKit(kit?: Partial<DrumKit>, kitName?: string): void` and `setPresetTrim(source: string, trimGain: number): void`.

- [ ] **Step 1: Write the failing test**

Create `src/audio/trims.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { NEUTRAL_TRIM_GAIN, drumTrimGainsFor, synthTrimGainFor } from '@/audio/trims';

describe('drumTrimGainsFor', () => {
  test('an unknown kit yields an empty map, so every voice falls back to neutral', () => {
    expect(drumTrimGainsFor('No Such Kit')).toEqual({});
  });

  test('an undefined kit name yields an empty map rather than throwing', () => {
    expect(drumTrimGainsFor(undefined)).toEqual({});
  });

  test('every committed kit/voice entry becomes a positive finite gain', () => {
    for (const kitName of Object.keys(DRUM_TRIMS)) {
      const gains = drumTrimGainsFor(kitName);
      for (const voice of Object.keys(DRUM_TRIMS[kitName] ?? {})) {
        expect(Number.isFinite(gains[voice])).toBe(true);
        expect(gains[voice]!).toBeGreaterThan(0);
      }
    }
  });
});

describe('synthTrimGainFor', () => {
  test('an unknown preset name is neutral — an uncalibrated patch must not be trimmed', () => {
    expect(synthTrimGainFor('A Name No Factory Preset Has')).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('an undefined preset name is neutral rather than a throw', () => {
    expect(synthTrimGainFor(undefined)).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('NEUTRAL_TRIM_GAIN is unity', () => {
    expect(NEUTRAL_TRIM_GAIN).toBe(1);
  });

  test('every committed preset id is resolvable from the name applyPreset writes', () => {
    // applyPreset sets `params.preset` to the preset NAME, and the table is keyed by
    // id (shared contract), so the name -> id resolution is the load-bearing step.
    for (const id of Object.keys(PRESET_TRIMS)) {
      const preset = SYNTH_PRESETS.find((p) => p.id === id);
      expect(preset).toBeDefined();
      expect(synthTrimGainFor(preset!.name)).toBeGreaterThan(0);
    }
  });

  test('factory preset names are unique, which is what makes name -> id sound', () => {
    const names = SYNTH_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/audio/trims.test.ts`
Expected: FAIL with `error: Cannot find module '@/audio/trims'`

- [ ] **Step 3: Write `src/audio/trims.ts`**

```ts
/**
 * The application side of the calibration table. Layering rule 2 lets src/audio/
 * read src/data/, which is what keeps this one hop and puts no lookup in the
 * store.
 *
 * It never rewrites an authored number. `DRUM_KITS`'s `gain`/`clickLevel`/
 * `bodyGain`/`noiseGain` and every preset's params stay exactly as authored, so the
 * diff of a retune stays readable; the measured trim multiplies on top.
 */
import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { dbToGain, toDecibels } from '@/utils/gainUnits';

/** Unity. What an uncalibrated voice gets — never a guess, never a clamp. */
export const NEUTRAL_TRIM_GAIN = 1;

/**
 * Resolved once per kit change, not per hit: `triggerDrum` is on the hot path and
 * an eleven-key object is cheaper to read than a nested lookup plus a dB conversion.
 */
export function drumTrimGainsFor(kitName: string | undefined): Record<string, number> {
  const voices = kitName === undefined ? undefined : DRUM_TRIMS[kitName];
  if (!voices) return {};
  const gains: Record<string, number> = {};
  for (const voice of Object.keys(voices)) {
    gains[voice] = dbToGain(toDecibels(voices[voice]!.trimDb));
  }
  return gains;
}

/**
 * `PRESET_TRIMS` is keyed by preset ID (shared contract), but the engine only ever
 * sees `params.preset`, which `applyPreset` sets to the preset NAME. This index is
 * that bridge, built once at module load over the factory library only.
 *
 * Consequence, bounded and deliberate: a USER preset whose name happens to match a
 * factory patch's name inherits that patch's trim. A user preset with any other
 * name gets NEUTRAL_TRIM_GAIN, which is the correct answer for a patch nobody
 * measured. `src/audio/trims.test.ts` asserts factory names are unique, which is
 * what makes the index single-valued.
 */
const TRIM_GAIN_BY_PRESET_NAME: Record<string, number> = Object.fromEntries(
  SYNTH_PRESETS.flatMap((preset) => {
    const entry = PRESET_TRIMS[preset.id];
    return entry ? [[preset.name, dbToGain(toDecibels(entry.trimDb))] as const] : [];
  }),
);

export function synthTrimGainFor(presetName: string | undefined): number {
  if (presetName === undefined) return NEUTRAL_TRIM_GAIN;
  return TRIM_GAIN_BY_PRESET_NAME[presetName] ?? NEUTRAL_TRIM_GAIN;
}
```

- [ ] **Step 4: Add the engine fields and the two setters**

In `src/audio/engine.ts`, replace line 348 (`private drumKit: DrumKit = mergeDrumKit();`) with:

```ts
  private drumKit: DrumKit = mergeDrumKit();

  /**
   * Per-voice calibration trims for the CURRENT kit, as linear gains. Resolved once
   * in setDrumKit, read once per hit. Empty until a kit name arrives, so every
   * lookup falls back to unity — which is why no existing engine test's absolute
   * peak assertion moves.
   */
  private drumTrimGains: Record<string, number> = {};

  /** Per-source preset trims as linear gains. Absent = unity, same reasoning. */
  private presetTrims = new Map<string, number>();
```

Replace `setDrumKit` at lines 1668-1670 with:

```ts
  setDrumKit(kit?: Partial<DrumKit>, kitName?: string): void {
    this.drumKit = mergeDrumKit(kit);
    this.drumTrimGains = drumTrimGainsFor(kitName);
  }
```

Add after `setSourceGain` (which ends at `src/audio/engine.ts:1423`):

```ts
  /**
   * The measured calibration trim for whatever preset this source is playing, as a
   * LINEAR gain. Set from engineSync (layering rule 3) and by presetPreview for its
   * own bus. 1 is neutral; a source that was never told stays neutral.
   */
  setPresetTrim(source: string, trimGain: number): void {
    this.presetTrims.set(source, trimGain);
  }
```

Add the private drum helper immediately above `triggerDrum` (before line 2138):

```ts
  /**
   * A private method so its `??` costs `triggerDrum` no cyclomatic complexity —
   * the same reason `triggerNonSwitchVoice` exists. `complexity` is `warn 20` and
   * triggerDrum is already tuned against that ceiling.
   */
  private drumTrim(voice: string): number {
    return this.drumTrimGains[voice] ?? NEUTRAL_TRIM_GAIN;
  }
```

And add the import at the top of `src/audio/engine.ts`, next to the other `@/`-aliased imports:

```ts
import { NEUTRAL_TRIM_GAIN, drumTrimGainsFor } from './trims';
```

- [ ] **Step 5: Multiply the trim into the two velocities**

In `triggerDrum`, delete line 2144 (`const v = clampVelocity(velocity);`) and re-add it **after** `const resolved = DRUM_ALIASES[name] ?? name;` (line 2147), so lines 2144-2148 read:

```ts
    const k = this.drumKit;
    const name = type.toLowerCase();
    const resolved = DRUM_ALIASES[name] ?? name;
    // The measured trim lands on velocity, BEFORE the per-voice authored `gain`,
    // so DRUM_KITS keeps stating what a reviewer tuned by ear.
    const v = clampVelocity(velocity) * this.drumTrim(resolved);
```

At `src/audio/engine.ts:998`, replace:

```ts
    const peakGain = velocity * 0.4 * scaleFactor;
```

with:

```ts
    const peakGain = velocity * 0.4 * scaleFactor * (this.presetTrims.get(source) ?? NEUTRAL_TRIM_GAIN);
```

- [ ] **Step 6: Wire it from engineSync and presetPreview**

In `src/store/engineSync.ts`, add to the existing `@/audio/...` imports:

```ts
import { synthTrimGainFor } from '@/audio/trims';
```

Line 93 becomes:

```ts
  audioEngine.setDrumKit(DRUM_KITS[s.soundKit], s.soundKit);
```

Lines 100-103 become:

```ts
  audioEngine.setPresetTrim('synth', synthTrimGainFor(s.synthParams.preset));
  audioEngine.updateSynthParams(s.synthParams, 'synth');
  audioEngine.setPresetTrim('chord', synthTrimGainFor(s.chordSynthParams.preset));
  audioEngine.updateSynthParams(s.chordSynthParams, 'chord');
  audioEngine.setPresetTrim('bass', synthTrimGainFor(s.bassSynthParams.preset));
  audioEngine.updateSynthParams(s.bassSynthParams, 'bass');
  audioEngine.setPresetTrim('pad', synthTrimGainFor(s.padSynthParams.preset));
  audioEngine.updateSynthParams(s.padSynthParams, 'pad');
```

Line 146 becomes:

```ts
  subs.push(useAppStore.subscribe((s) => s.soundKit, (kit) => audioEngine.setDrumKit(DRUM_KITS[kit], kit), { fireImmediately: true }));
```

Inside the `synthSources` loop (lines 208-215), the subscriber body becomes:

```ts
        (params, prevParams) => {
          // Direct, never debounced: a trim is a scalar the next voice reads, not a
          // re-target of live voices, so it must be current before the frame that
          // pushes the params.
          audioEngine.setPresetTrim(source, synthTrimGainFor(params.preset));
          if (params === prevParams) audioEngine.updateSynthParams(params, source);
          else paramFrames.push(source, () => audioEngine.updateSynthParams(params, source));
        },
```

In `src/audio/playback/presetPreview.ts`, add `import { synthTrimGainFor } from '@/audio/trims';` and, inside `previewSynthPreset` immediately before line 203's `triggerSynthNoteOn`:

```ts
  // An audition at the wrong level is exactly what calibration is for, and the
  // preview bus is a source like any other — so it gets the trim too. This is an
  // audio-layer file calling an audio-layer setter, which layering rule 3 permits.
  audioEngine.setPresetTrim(PREVIEW_SOURCE, synthTrimGainFor(testParams.preset));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/audio/trims.test.ts src/audio/engine.test.ts src/store/engineSync.test.ts`
Expected: PASS on all three. `src/audio/engine.test.ts` must be **unchanged** — `freshEngine()` calls neither `setDrumKit` nor `setPresetTrim`, so every trim is unity and no existing peak assertion moves. If any engine assertion did move, that is a signal the neutral default leaked; fix the default rather than the assertion.

Two of the `trims.test.ts` cases — "every committed kit/voice entry becomes a positive finite gain" and "every committed preset id is resolvable" — iterate the table, which is still `{}` at this point and so pass **vacuously**. That is the correct state for them here, and it is why Task 11 re-runs this file after the table is filled: only then do they assert anything.

- [ ] **Step 8: Commit**

```bash
git add src/audio/trims.ts src/audio/trims.test.ts src/audio/engine.ts src/store/engineSync.ts src/audio/playback/presetPreview.ts
git commit -m "feat(calibration): apply a measured trim to drum velocity and synth peak gain"
```

---

### Task 8: The offline render harness

This is the actual new capability in the issue: every existing `check:*` script reasons about *numbers in tables*, and this is the first solna script that needs real rendered audio.

**Files:**
- Create: `scripts/calibration/renderOffline.ts`
- Create: `scripts/calibration/renderOffline.smoke.ts`
- Modify: `package.json:6-18` (add `calibration:smoke`)

**Interfaces:**
- Consumes: `encodeWav` (Task 5); `synthTrimGainFor` and the engine's `setDrumKit(kit, kitName)` / `setPresetTrim(source, trimGain)` (Task 7); `makeEngine` from `@/audio/testFakes`; `DRUM_KITS`, `DrumType` from `@/data/drumKits`; `SynthPresetItem` from `@/data/synthPresets`; `applyPreset` from `@/audio/presetRegistry`; `INITIAL_SYNTH_PARAMS` from `@/store/initialState`.
- Produces: `CALIBRATION_SAMPLE_RATE`, `DRUM_RENDER_SECONDS`, `DRUM_FIRST_HIT_S`, `DRUM_HIT_INTERVAL_S`, `DRUM_HIT_COUNT`, `SYNTH_RENDER_SECONDS`, `SYNTH_FIRST_NOTE_S`, `SYNTH_NOTE_INTERVAL_S`, `SYNTH_NOTE_GATE_S`, `SYNTH_NOTE_COUNT`, `SYNTH_CALIBRATION_NOTE`, `CALIBRATION_VELOCITY`, `renderDrumVoice(kitName, voice, applyTrim?): Promise<Uint8Array>`, `renderPreset(preset, applyTrim?): Promise<Uint8Array>`.

The optional `applyTrim` flag is what makes Task 12's verification possible without a second harness. It is a **boolean routed through the engine's own trim path**, not a gain the caller multiplies into velocity: `triggerDrum` runs `clampVelocity`, which caps at 1, so a caller folding a boost into velocity would silently lose it and measure the untrimmed voice while believing it measured the trimmed one.

- [ ] **Step 1: Write the failing smoke script**

Create `scripts/calibration/renderOffline.smoke.ts`. It is deliberately **not** named `*.test.ts`: Bun's test globs are `*.test.*`, `*.spec.*`, `*_test.*` and `*_spec.*`, so this file stays out of `bun test` and the native addon stays off the CI critical path (shared contract, D-383-2).

```ts
/**
 * Manual proof that the render harness produces real, non-silent audio through the
 * real engine. NOT a `bun test` file, on purpose: it loads `node-web-audio-api`, a
 * native addon the shared contract keeps off the `bun test` critical path.
 *
 * Run: bun run calibration:smoke
 */
import { CALIBRATION_SAMPLE_RATE, DRUM_RENDER_SECONDS, renderDrumVoice, renderPreset } from './renderOffline.ts';
import { SYNTH_PRESETS } from '@/data/synthPresets';

let failures = 0;

function report(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!pass) failures += 1;
}

function peakOf(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let peak = 0;
  for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)) / 32768);
  }
  return peak;
}

const kickWav = await renderDrumVoice('Retro Drive', 'kick');
report(
  'a rendered kick is 5.0 s of stereo 16-bit audio',
  kickWav.byteLength === 44 + CALIBRATION_SAMPLE_RATE * DRUM_RENDER_SECONDS * 2 * 2,
  `${kickWav.byteLength} bytes`,
);
report('a rendered kick is not silent', peakOf(kickWav) > 0.01, `peak ${peakOf(kickWav).toFixed(3)}`);

const crashWav = await renderDrumVoice('Trap Beat', 'crash');
report('a rendered crash is not silent', peakOf(crashWav) > 0.01, `peak ${peakOf(crashWav).toFixed(3)}`);

const pad = SYNTH_PRESETS.find((p) => p.category === 'Pad');
if (!pad) throw new Error('Unreachable: SYNTH_PRESETS ships at least one Pad patch');
const padWav = await renderPreset(pad);
report(`a rendered pad preset (${pad.name}) is not silent`, peakOf(padWav) > 0.01, `peak ${peakOf(padWav).toFixed(3)}`);

const pluck = SYNTH_PRESETS.find((p) => p.category === 'Pluck');
if (!pluck) throw new Error('Unreachable: SYNTH_PRESETS ships at least one Pluck patch');
const pluckWav = await renderPreset(pluck);
report(`a rendered pluck preset (${pluck.name}) is not silent`, peakOf(pluckWav) > 0.01, `peak ${peakOf(pluckWav).toFixed(3)}`);

// The kit must actually reach the engine. A `setDrumKit` that silently no-opped
// would render thirteen identical kicks and produce thirteen identical trims that
// all looked plausible — the exact failure this harness exists to catch.
const otherKick = await renderDrumVoice('808 Vintage', 'kick');
report(
  'two kits render the same voice at different peaks',
  Math.abs(peakOf(otherKick) - peakOf(kickWav)) > 0.005,
  `Retro Drive ${peakOf(kickWav).toFixed(3)} vs 808 Vintage ${peakOf(otherKick).toFixed(3)}`,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the smoke script to verify it fails**

Run: `bun scripts/calibration/renderOffline.smoke.ts`
Expected: FAIL with `error: Cannot find module './renderOffline.ts'`

- [ ] **Step 3: Write the harness**

Create `scripts/calibration/renderOffline.ts`:

```ts
/**
 * The render half of the calibration harness. It drives the REAL AudioEngine — the
 * same `triggerDrum` / `triggerSynthNoteOn` a player hits — against a
 * `node-web-audio-api` OfflineAudioContext, through the injection seam
 * `src/audio/testFakes.ts` already establishes: the engine class is not exported,
 * so a fresh instance comes from the singleton's constructor and its private `ctx`
 * is assigned directly. Measuring anything else would measure a model of the
 * engine rather than the engine.
 *
 * Two departures from a live session, both deliberate:
 *  - the three parallel sends (reverb, delay, distortion) are zeroed, so the
 *    measurement is the DRY voice. A wet tail's level is a user setting; a voice's
 *    level is not. This is also why `reverbSend` is excluded from the config hash.
 *  - master volume sits at unity. The EQ, compressor and limiter stay in circuit
 *    because they are the fixed serial chain every voice actually leaves through;
 *    at the -18 dBFS target neither dynamics stage meaningfully engages.
 */
import { OfflineAudioContext } from 'node-web-audio-api';
import { makeEngine } from '@/audio/testFakes';
import { applyPreset } from '@/audio/presetRegistry';
import { synthTrimGainFor } from '@/audio/trims';
import { DRUM_KITS, type DrumType } from '@/data/drumKits';
import type { SynthPresetItem } from '@/data/synthPresets';
import { INITIAL_SYNTH_PARAMS } from '@/store/initialState';
import { encodeWav } from './encodeWav.ts';

export const CALIBRATION_SAMPLE_RATE = 44100;
export const CALIBRATION_CHANNELS = 2;
/** Max velocity — the AC calibrates "at max velocity", not at DEFAULT_VELOCITY. */
export const CALIBRATION_VELOCITY = 1;

/** Every pattern clears the EBU R128 3s short-term gate with room to spare. */
export const DRUM_RENDER_SECONDS = 5;
export const DRUM_FIRST_HIT_S = 0.25;
/** The 8th-note grid at 120 BPM. One interval for all eleven voices: uniformity is
 *  what makes the trims comparable across kits, which is the point of the issue. */
export const DRUM_HIT_INTERVAL_S = 0.5;
export const DRUM_HIT_COUNT = 9;

export const SYNTH_RENDER_SECONDS = 6.5;
export const SYNTH_FIRST_NOTE_S = 0.25;
export const SYNTH_NOTE_INTERVAL_S = 1.5;
/** Long enough that a pad with attack up to ~1.0 s reaches sustain inside the gate. */
export const SYNTH_NOTE_GATE_S = 1.3;
export const SYNTH_NOTE_COUNT = 4;
/** The preset's own `octave` shifts this, exactly as a player hears it. */
export const SYNTH_CALIBRATION_NOTE = 'C3';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; this script reaches its private ctx, master chain and send gains the
   same way src/audio/testFakes.ts does, and for the same reason. */

interface Harness {
  engine: any;
  ctx: any;
}

function createHarness(seconds: number): Harness {
  const ctx = new OfflineAudioContext(
    CALIBRATION_CHANNELS,
    Math.round(CALIBRATION_SAMPLE_RATE * seconds),
    CALIBRATION_SAMPLE_RATE,
  );
  const engine = makeEngine() as any;
  engine.ctx = ctx;
  engine.setupMasterChain();
  // Dry only. Zeroing the send gains is one line each and beats building a whole
  // neutral MasterEffects literal that would then need maintaining alongside the
  // real one.
  for (const send of ['reverbGain', 'delayGain', 'distortionGain']) {
    if (engine[send]) engine[send].gain.value = 0;
  }
  engine.setMasterVolume(1);
  return { engine, ctx };
}

async function renderToWav(ctx: any): Promise<Uint8Array> {
  const buffer = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  return encodeWav(channels, CALIBRATION_SAMPLE_RATE);
}

/**
 * `applyTrim` routes through the engine's OWN trim path — `setDrumKit`'s kit-name
 * argument — rather than folding a gain into velocity. `triggerDrum` runs
 * `clampVelocity`, which caps at 1, so a caller multiplying a boost into velocity
 * would silently lose it and measure the untrimmed voice believing otherwise.
 *
 * The generator renders with `applyTrim` false (uncalibrated, which is what a trim
 * is computed FROM); `verifyApplied.smoke.ts` renders with it true, to prove the
 * applied result lands inside the tolerance band.
 */
export async function renderDrumVoice(
  kitName: string,
  voice: DrumType,
  applyTrim = false,
): Promise<Uint8Array> {
  const kit = DRUM_KITS[kitName];
  if (!kit) throw new Error(`No such drum kit: ${kitName}`);
  const { engine, ctx } = createHarness(DRUM_RENDER_SECONDS);
  // Withholding the name is what makes the render uncalibrated: setDrumKit
  // resolves trims from the name, and an unnamed kit resolves to none.
  engine.setDrumKit(kit, applyTrim ? kitName : undefined);
  for (let hit = 0; hit < DRUM_HIT_COUNT; hit += 1) {
    engine.triggerDrum(voice, CALIBRATION_VELOCITY, DRUM_FIRST_HIT_S + hit * DRUM_HIT_INTERVAL_S);
  }
  return renderToWav(ctx);
}

export async function renderPreset(preset: SynthPresetItem, applyTrim = false): Promise<Uint8Array> {
  const params = applyPreset(INITIAL_SYNTH_PARAMS, preset);
  const { engine, ctx } = createHarness(SYNTH_RENDER_SECONDS);
  engine.setPresetTrim('calibration', applyTrim ? synthTrimGainFor(preset.name) : 1);
  for (let note = 0; note < SYNTH_NOTE_COUNT; note += 1) {
    const at = SYNTH_FIRST_NOTE_S + note * SYNTH_NOTE_INTERVAL_S;
    engine.triggerSynthNoteOn(SYNTH_CALIBRATION_NOTE, params, CALIBRATION_VELOCITY, at, 'calibration');
    engine.triggerSynthNoteOff(SYNTH_CALIBRATION_NOTE, params.release, at + SYNTH_NOTE_GATE_S, 'calibration');
  }
  return renderToWav(ctx);
}
```

- [ ] **Step 4: Add the smoke script entry**

In `package.json`, inside the `"scripts"` block, after `"check:contrast"`:

```json
    "calibration:smoke": "bun scripts/calibration/renderOffline.smoke.ts",
```

- [ ] **Step 5: Run the smoke script to verify it passes**

Run: `bun run calibration:smoke`
Expected: PASS on all six lines, ending `All checks passed.` If any voice reports `peak 0.000`, do not widen the pattern first — play that voice in the app (`bun run dev`) and confirm it sounds, because a genuinely silent voice is a bug in the voice, not in the harness.

- [ ] **Step 6: Commit**

```bash
git add scripts/calibration/renderOffline.ts scripts/calibration/renderOffline.smoke.ts package.json
git commit -m "feat(calibration): render real engine voices through an offline context"
```

---

### Task 9: The loudness-config fingerprint

**Files:**
- Create: `scripts/calibration/loudnessConfig.ts`
- Test: `scripts/calibration/loudnessConfig.test.ts`

**Interfaces:**
- Consumes: `DRUM_KITS`, `DRUM_TYPES`, `DrumType` from `@/data/drumKits`; `mergeDrumKit` from `@/audio/drumKits`; `SYNTH_PRESETS`, `SynthPresetItem` from `@/data/synthPresets`; `applyPreset` from `@/audio/presetRegistry`; `INITIAL_SYNTH_PARAMS` from `@/store/initialState`.
- Produces: `DRUM_HASH_EXCLUDED`, `SYNTH_HASH_EXCLUDED`, `hashLoudnessConfig(input: unknown): string`, `drumLoudnessHash(kitName: string, voice: DrumType): string`, `presetLoudnessHash(preset: SynthPresetItem): string`.

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/loudnessConfig.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import {
  DRUM_HASH_EXCLUDED,
  SYNTH_HASH_EXCLUDED,
  drumLoudnessHash,
  hashLoudnessConfig,
  presetLoudnessHash,
} from './loudnessConfig.ts';

describe('hashLoudnessConfig', () => {
  test('is stable across key order — a reformat must not fire the lock test', () => {
    expect(hashLoudnessConfig({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashLoudnessConfig({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  test('changes when any hashed value changes', () => {
    expect(hashLoudnessConfig({ gain: 0.9 })).not.toBe(hashLoudnessConfig({ gain: 0.91 }));
  });
});

describe('the drum hash', () => {
  test('excludes reverbSend and nothing else', () => {
    expect(DRUM_HASH_EXCLUDED).toEqual(['reverbSend']);
  });

  test('two kits with different kick gains hash differently', () => {
    expect(drumLoudnessHash('Retro Drive', 'kick')).not.toBe(drumLoudnessHash('808 Vintage', 'kick'));
  });

  test('the kit name is inside the hash, so an entry cannot be copy-pasted between kits', () => {
    // Even were two kits' merged kick params identical, their hashes must differ.
    const a = hashLoudnessConfig({ kit: 'A', voice: 'kick', params: { gain: 0.9 } });
    const b = hashLoudnessConfig({ kit: 'B', voice: 'kick', params: { gain: 0.9 } });
    expect(a).not.toBe(b);
  });

  test('is stable across repeated calls', () => {
    expect(drumLoudnessHash('Warehouse', 'snare')).toBe(drumLoudnessHash('Warehouse', 'snare'));
  });
});

describe('the synth hash', () => {
  test('excludes the display name and the four arpeggiator fields, and nothing else', () => {
    expect(SYNTH_HASH_EXCLUDED).toEqual(['preset', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves']);
  });

  test('an arpeggiator-only difference does not change the hash', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    const arped = { ...base, params: { ...base.params, arpActive: true, arpOctaves: 3 } };
    expect(presetLoudnessHash(arped)).toBe(presetLoudnessHash(base));
  });

  test('a rename does not change the hash', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    expect(presetLoudnessHash({ ...base, name: 'Renamed' })).toBe(presetLoudnessHash(base));
  });

  test('a filter cutoff change DOES change the hash — ebur128 is K-weighted, so spectrum is level', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    const brighter = { ...base, params: { ...base.params, filterCutoff: 9000 } };
    expect(presetLoudnessHash(brighter)).not.toBe(presetLoudnessHash(base));
  });

  test('every factory preset produces a distinct hash', () => {
    const hashes = SYNTH_PRESETS.map((preset) => presetLoudnessHash(preset));
    expect(new Set(hashes).size).toBe(SYNTH_PRESETS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/loudnessConfig.test.ts`
Expected: FAIL with `error: Cannot find module './loudnessConfig.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/calibration/loudnessConfig.ts`:

```ts
/**
 * What "this entry is still calibrated" means, in one place.
 *
 * The rule: a field is in the hash if changing it changes the K-weighted energy of
 * the rendered, DRY voice. `ebur128` is K-weighted, so pitch and filter fields are
 * spectral gain — a kick at 35 Hz and one at 60 Hz genuinely measure several dB
 * apart, and excluding them would let a real level change ship unmeasured.
 *
 * The two exclusion lists below are the whole argument, and they are short on
 * purpose: an over-broad hash fires on cosmetic edits and trains people to
 * regenerate without thinking, which is the failure mode this test exists to
 * prevent.
 *
 * Lives in scripts/ because it needs `node:crypto`; nothing in the bundle may.
 */
import { createHash } from 'node:crypto';
import { mergeDrumKit } from '@/audio/drumKits';
import { applyPreset } from '@/audio/presetRegistry';
import { DRUM_KITS, type DrumType } from '@/data/drumKits';
import type { SynthPresetItem } from '@/data/synthPresets';
import { INITIAL_SYNTH_PARAMS } from '@/store/initialState';

/**
 * `reverbSend` only feeds the drum reverb send, and the calibration render zeroes
 * `reverbGain` — so it cannot move a measurement and must not fire the lock test.
 * `DRUM_KITS[name].reference` is not here because it is not part of a voice's
 * params at all: it lives on the DRUM_KITS entry type, deliberately off `DrumKit`,
 * and `triggerDrum` never reads it.
 */
export const DRUM_HASH_EXCLUDED = ['reverbSend'] as const;

/**
 * `preset` is a display name. The four arp fields drive a SCHEDULER above the
 * engine: the calibration pattern triggers notes directly, the arpeggiator never
 * runs, and it cannot change what one triggered note sounds like. Everything else
 * in SynthParams is in — including lfoTarget/lfoRate/lfoDepth (the 'volume' target
 * is literally a tremolo gain) and octave (pitch, therefore K-weighted energy).
 */
export const SYNTH_HASH_EXCLUDED = ['preset', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves'] as const;

/** Recursively sort object keys so the digest is order-independent: a reformat of
 *  a data table must not read as a retune. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(JSON.stringify(value));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function hashLoudnessConfig(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function omit(source: Record<string, unknown>, excluded: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!excluded.includes(key)) kept[key] = source[key];
  }
  return kept;
}

export function drumLoudnessHash(kitName: string, voice: DrumType): string {
  const partial = DRUM_KITS[kitName];
  if (!partial) throw new Error(`No such drum kit: ${kitName}`);
  // The MERGED params, not the partial: a change to DEFAULT_DRUM_KIT changes what
  // a partial kit actually renders as, and must fire.
  const params = mergeDrumKit(partial)[voice] as unknown as Record<string, unknown>;
  return hashLoudnessConfig({ kit: kitName, voice, params: omit(params, DRUM_HASH_EXCLUDED) });
}

export function presetLoudnessHash(preset: SynthPresetItem): string {
  // The RESOLVED params, for the same reason: a change to INITIAL_SYNTH_PARAMS
  // changes what a partial preset renders as.
  const params = applyPreset(INITIAL_SYNTH_PARAMS, preset) as unknown as Record<string, unknown>;
  return hashLoudnessConfig({ preset: preset.id, params: omit(params, SYNTH_HASH_EXCLUDED) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/calibration/loudnessConfig.test.ts`
Expected: PASS, 11 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/calibration/loudnessConfig.ts scripts/calibration/loudnessConfig.test.ts
git commit -m "feat(calibration): fingerprint exactly the loudness-affecting config"
```

---

### Task 10: The batch generator

**Files:**
- Create: `scripts/calibration/generateTrimTable.ts`
- Modify: `package.json:6-18` (add `calibration:generate`)

**Interfaces:**
- Consumes: `renderDrumVoice`, `renderPreset` (Task 8); `measureLoudness` (Task 4); `computeTrimDb`, `TARGET_DBFS` (Task 3); `drumLoudnessHash`, `presetLoudnessHash` (Task 9); `writeTrimTable`, `TRIM_TABLE_PATH`, `GeneratedTrimEntry` (Task 6); `FADER_MAX_DB` from `@/utils/gainUnits`.
- Produces: the `bun run calibration:generate` command. No exported symbols.

- [ ] **Step 1: Write the generator**

Create `scripts/calibration/generateTrimTable.ts`:

```ts
/**
 * Batch calibration orchestrator. For every drum-kit voice (13 kits x 11 voices)
 * and every synth preset: render the pattern through the offline harness, measure
 * short-term LUFS, compute the trim, hash the loudness-relevant config, and write
 * the result into the committed `src/data/trimTable.ts`.
 *
 * MANUAL / ON-DEMAND ONLY. It never runs in CI: rendering plus ffmpeg is minutes,
 * where the lock test that guards its output is milliseconds. See README.md.
 *
 * Run: bun run calibration:generate
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { FADER_MAX_DB } from '@/utils/gainUnits';
import { TARGET_DBFS, computeTrimDb } from '@/utils/trimMath';
import { resolveFfmpegPath } from './ffmpegPath.ts';
import { drumLoudnessHash, presetLoudnessHash } from './loudnessConfig.ts';
import { measureLoudness } from './measureLoudness.ts';
import { renderDrumVoice, renderPreset } from './renderOffline.ts';
import { TRIM_TABLE_PATH, writeTrimTable, type GeneratedTrimEntry } from './writeTrimTable.ts';

/**
 * A trim bigger than the fader itself can give is a voicing problem, not a trim.
 * Flagged for a human, never auto-clamped: clamping would silently break the
 * ±3 dB guarantee the lock test then asserts from these same numbers.
 */
const REVIEW_LIMIT_DB = FADER_MAX_DB;

// Fail fast and loudly rather than 140 renders into a run.
resolveFfmpegPath();

const tmpDir = mkdtempSync(join(tmpdir(), 'solna-calibration-'));
const drums: Record<string, Record<string, GeneratedTrimEntry>> = {};
const presets: Record<string, GeneratedTrimEntry> = {};
const flagged: string[] = [];
const failed: string[] = [];

const kitNames = Object.keys(DRUM_KITS);
const total = kitNames.length * DRUM_TYPES.length + SYNTH_PRESETS.length;
let done = 0;

async function measureWav(bytes: Uint8Array, slug: string, label: string) {
  const wavPath = join(tmpDir, `${slug}.wav`);
  writeFileSync(wavPath, bytes);
  return measureLoudness(wavPath, label);
}

function flagIfOutOfRange(label: string, trimDb: number) {
  if (Math.abs(trimDb) > REVIEW_LIMIT_DB) {
    flagged.push(`${label}: needs ${trimDb.toFixed(1)} dB, past the +/-${REVIEW_LIMIT_DB} dB fader range`);
  }
}

console.log(`Calibrating ${total} voices toward ${TARGET_DBFS} dBFS...`);

for (const kitName of kitNames) {
  for (const voice of DRUM_TYPES) {
    done += 1;
    const label = `${kitName}/${voice}`;
    process.stdout.write(`[${done}/${total}] ${label}... `);
    // One voice's failure must not abort a run that already cost minutes; it is
    // reported at the end alongside the out-of-range flags instead.
    try {
      const measuredDbfs = await measureWav(
        await renderDrumVoice(kitName, voice),
        `${kitName}-${voice}`.replace(/\W+/g, '-'),
        label,
      );
      const trimDb = computeTrimDb(measuredDbfs);
      flagIfOutOfRange(label, trimDb);
      drums[kitName] ??= {};
      drums[kitName]![voice] = {
        measuredDbfs,
        trimDb,
        configHash: drumLoudnessHash(kitName, voice),
      };
      console.log(`${measuredDbfs.toFixed(1)} dBFS -> trim ${trimDb.toFixed(1)} dB`);
      // Written after every voice, so an interrupted run loses at most the
      // in-flight one rather than the whole batch.
      writeTrimTable(drums, presets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAILED: ${message}`);
      failed.push(`${label}: ${message}`);
    }
  }
}

for (const preset of SYNTH_PRESETS) {
  done += 1;
  process.stdout.write(`[${done}/${total}] ${preset.id}... `);
  try {
    const measuredDbfs = await measureWav(await renderPreset(preset), preset.id, preset.id);
    const trimDb = computeTrimDb(measuredDbfs);
    flagIfOutOfRange(preset.id, trimDb);
    presets[preset.id] = { measuredDbfs, trimDb, configHash: presetLoudnessHash(preset) };
    console.log(`${measuredDbfs.toFixed(1)} dBFS -> trim ${trimDb.toFixed(1)} dB`);
    writeTrimTable(drums, presets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAILED: ${message}`);
    failed.push(`${preset.id}: ${message}`);
  }
}

if (flagged.length > 0) {
  console.error(`\n${flagged.length} entry(ies) need a human decision (NOT auto-clamped):`);
  for (const line of flagged) console.error(`  - ${line}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length} entry(ies) failed to render or measure (no entry written):`);
  for (const line of failed) console.error(`  - ${line}`);
}

console.log(`\nWrote ${Object.keys(presets).length} preset and ${kitNames.length} kit blocks to ${TRIM_TABLE_PATH}`);
console.log('Review the diff before committing — see scripts/calibration/README.md.');
```

- [ ] **Step 2: Add the script entry**

In `package.json`, inside `"scripts"`, immediately before `"calibration:smoke"`:

```json
    "calibration:generate": "bun scripts/calibration/generateTrimTable.ts",
```

- [ ] **Step 3: Verify the generator type-checks and lints**

Run: `bun run eslint scripts/calibration/generateTrimTable.ts && bun test scripts/calibration/`
Expected: eslint prints nothing; the calibration unit tests all pass. The generator is not run here — that is Task 11.

- [ ] **Step 4: Commit**

```bash
git add scripts/calibration/generateTrimTable.ts package.json
git commit -m "feat(calibration): add the manual calibration:generate orchestrator"
```

---

### Task 11: Run the generator and review the diff

This task is not verifiable by assertion alone. Its deliverable is a reviewed generated file, and the review step is a human's.

**Files:**
- Modify: `src/data/trimTable.ts` (regenerated, ~172 entries)

**Interfaces:**
- Consumes: `bun run calibration:generate` (Task 10).
- Produces: the populated `DRUM_TRIMS` and `PRESET_TRIMS` every later task asserts against.

- [ ] **Step 1: Run the generator**

Run: `bun run calibration:generate`
Expected: 143 drum lines plus 29 preset lines, each printing `<measured> dBFS -> trim <trim> dB`. Several minutes. A run that ends with no `FAILED` lines and no flagged entries is the clean case.

- [ ] **Step 2: Investigate every failure, before anything else**

For each `FAILED: No valid short-term LUFS readings` line: play that voice in the app (`bun run dev`) before touching the harness. The murva harness recorded this exact trap — a "no readings" failure is not always a duration bug; it can mean the voice is genuinely silent in production. Only if the voice sounds in the app is the pattern the suspect, and then the fix is a wider `DRUM_RENDER_SECONDS` / `SYNTH_RENDER_SECONDS` in `renderOffline.ts`, never a lower sentinel floor in `parseEbur128Output.ts`.

- [ ] **Step 3: Investigate every flagged entry**

For each `needs X dB, past the +/-12 dB fader range` line: decide whether it is a genuine outlier — a voice authored far off everything else, which is a real product decision and possibly its own follow-up issue — or a harness artefact. Do not ship a flagged run unreviewed and do not clamp the number to make the line go away.

- [ ] **Step 4: Human review of the diff**

Run: `git diff --stat src/data/trimTable.ts && git diff src/data/trimTable.ts | head -80`
Confirm by eye, and record the answers in the commit body:
1. Every one of the 13 kits has all 11 voices, and all 29 presets are present.
2. `measuredDbfs + trimDb === -18` for every spot-checked entry — the arithmetic is the whole guarantee.
3. The spread of `measuredDbfs` across kits is the finding the issue predicted. Note the loudest and quietest entries and their gap; a >6 dB spread is the thing this issue exists to fix, and seeing it confirms the harness is measuring rather than reporting a constant.
4. No two entries share a `configHash`.

- [ ] **Step 5: Re-run the table-iterating tests, now that they assert something**

Run: `bun test src/audio/trims.test.ts`
Expected: PASS, 6 pass 0 fail. Two of these cases passed vacuously in Task 7 against an empty table; with 172 entries committed they now walk every one, proving each `trimDb` converts to a positive finite gain and every committed preset id resolves from the name `applyPreset` writes.

- [ ] **Step 6: By-ear spot check**

Run: `bun run dev`, then in the app switch between three kits at the extremes of the measured spread and play the same pattern. Confirm they now sit at comparable levels and that nothing has become inaudible or clipped.

- [ ] **Step 7: Commit**

```bash
git add src/data/trimTable.ts
git commit -m "feat(calibration): commit the measured trim table

Generated by bun run calibration:generate.
Measured spread before trim: <loudest entry> to <quietest entry>.
Flagged entries: <none, or the list and the decision taken for each>."
```

---

### Task 12: The lock test and `check:levels`

**Files:**
- Create: `scripts/calibration/levelChecks.ts`
- Create: `scripts/calibration/trimTable.lock.test.ts`
- Create: `scripts/check-levels.ts`
- Create: `scripts/calibration/verifyApplied.smoke.ts`
- Modify: `package.json:6-18` (add `check:levels`, add it to `verify`)

**Interfaces:**
- Consumes: `DRUM_TRIMS`, `PRESET_TRIMS` (Task 11); `drumLoudnessHash`, `presetLoudnessHash` (Task 9); `isWithinTolerance`, `TOLERANCE_DB`, `TARGET_DBFS` (Task 3); `renderDrumVoice`, `renderPreset` (Task 8); `measureLoudness` (Task 4); `drumTrimGainsFor`, `synthTrimGainFor` (Task 7).
- Produces: `LevelFinding`, `findMissingEntries()`, `findOrphanEntries()`, `findDriftedEntries()`, `findOutOfToleranceEntries()`, all `(): LevelFinding[]`.

One implementation, two front doors: the `bun test` lock test and the house-style `check:levels` reporter both call the same four collectors, so they can never disagree.

- [ ] **Step 1: Write the failing test**

Create `scripts/calibration/trimTable.lock.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  findDriftedEntries,
  findMissingEntries,
  findOrphanEntries,
  findOutOfToleranceEntries,
} from './levelChecks.ts';

const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

describe('the committed trim table is a lock on today s defaults', () => {
  test('every drum-kit voice and every synth preset has a committed entry', () => {
    const missing = findMissingEntries();
    expect(ids(missing).join(', ')).toBe('');
  });

  test('no committed entry names a kit, voice or preset that no longer exists', () => {
    expect(ids(findOrphanEntries()).join(', ')).toBe('');
  });

  test('no loudness-affecting default has drifted since it was last calibrated', () => {
    // This is the test the issue asks for: it hashes the CURRENT config and compares
    // it to the hash recorded in the table. A retune of a gain, an envelope, a
    // cutoff or an oscillator type fires it; a rename, a colour or a wet send
    // deliberately does not.
    expect(ids(findDriftedEntries()).join(', ')).toBe('');
  });

  test('every committed measurement plus its trim lands within the tolerance band', () => {
    expect(ids(findOutOfToleranceEntries()).join(', ')).toBe('');
  });

  test('runs without rendering or shelling out — it reads the table and hashes data', () => {
    const started = performance.now();
    findDriftedEntries();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/calibration/trimTable.lock.test.ts`
Expected: FAIL with `error: Cannot find module './levelChecks.ts'`

- [ ] **Step 3: Write `scripts/calibration/levelChecks.ts`**

```ts
/**
 * The four questions `check:levels` and the lock test both ask. One
 * implementation, two front doors, so they can never disagree.
 *
 * Every one of them reads the COMMITTED table and recomputes hashes from current
 * data. None renders audio and none spawns ffmpeg: this must stay milliseconds,
 * because it is on the `bun run verify` critical path and the generator that
 * produced the table is not.
 */
import { DRUM_KITS, DRUM_TYPES, type DrumType } from '@/data/drumKits';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { toDbfs, toDecibels } from '@/utils/gainUnits';
import { isWithinTolerance } from '@/utils/trimMath';
import { drumLoudnessHash, presetLoudnessHash } from './loudnessConfig.ts';

export interface LevelFinding {
  id: string;
  detail: string;
}

const REGENERATE = 'run `bun run calibration:generate`';

export function findMissingEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  for (const kitName of Object.keys(DRUM_KITS)) {
    for (const voice of DRUM_TYPES) {
      if (!DRUM_TRIMS[kitName]?.[voice]) {
        findings.push({ id: `${kitName}/${voice}`, detail: `no committed entry — ${REGENERATE}` });
      }
    }
  }
  for (const preset of SYNTH_PRESETS) {
    if (!PRESET_TRIMS[preset.id]) {
      findings.push({ id: preset.id, detail: `no committed entry — ${REGENERATE}` });
    }
  }
  return findings;
}

export function findOrphanEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  const voices = new Set<string>(DRUM_TYPES);
  for (const kitName of Object.keys(DRUM_TRIMS)) {
    if (!DRUM_KITS[kitName]) {
      findings.push({ id: kitName, detail: `entry for a kit that no longer exists — ${REGENERATE}` });
      continue;
    }
    for (const voice of Object.keys(DRUM_TRIMS[kitName] ?? {})) {
      if (!voices.has(voice)) {
        findings.push({ id: `${kitName}/${voice}`, detail: `entry for a voice no kit plays — ${REGENERATE}` });
      }
    }
  }
  const presetIds = new Set(SYNTH_PRESETS.map((preset) => preset.id));
  for (const id of Object.keys(PRESET_TRIMS)) {
    if (!presetIds.has(id)) {
      findings.push({ id, detail: `entry for a preset that no longer exists — ${REGENERATE}` });
    }
  }
  return findings;
}

export function findDriftedEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  for (const kitName of Object.keys(DRUM_KITS)) {
    for (const voice of DRUM_TYPES) {
      const entry = DRUM_TRIMS[kitName]?.[voice];
      if (!entry) continue; // findMissingEntries owns this case
      if (drumLoudnessHash(kitName, voice as DrumType) !== entry.configHash) {
        findings.push({
          id: `${kitName}/${voice}`,
          detail: `a loudness-affecting param changed since it was calibrated — ${REGENERATE}`,
        });
      }
    }
  }
  for (const preset of SYNTH_PRESETS) {
    const entry = PRESET_TRIMS[preset.id];
    if (!entry) continue;
    if (presetLoudnessHash(preset) !== entry.configHash) {
      findings.push({
        id: preset.id,
        detail: `a loudness-affecting param changed since it was calibrated — ${REGENERATE}`,
      });
    }
  }
  return findings;
}

export function findOutOfToleranceEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  const check = (id: string, entry: { measuredDbfs: number; trimDb: number }) => {
    if (!isWithinTolerance(toDbfs(entry.measuredDbfs), toDecibels(entry.trimDb))) {
      findings.push({
        id,
        detail: `${entry.measuredDbfs.toFixed(1)} dBFS + ${entry.trimDb.toFixed(1)} dB lands outside the band`,
      });
    }
  };
  for (const kitName of Object.keys(DRUM_TRIMS)) {
    for (const [voice, entry] of Object.entries(DRUM_TRIMS[kitName] ?? {})) {
      check(`${kitName}/${voice}`, entry);
    }
  }
  for (const [id, entry] of Object.entries(PRESET_TRIMS)) check(id, entry);
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/calibration/trimTable.lock.test.ts`
Expected: PASS, 5 pass 0 fail, in well under a second.

- [ ] **Step 5: Prove the lock test actually fires**

Temporarily change one authored number — in `src/data/drumKits.ts`, the `'Retro Drive'` kick's `gain` — then run: `bun test scripts/calibration/trimTable.lock.test.ts -t "drifted"`
Expected: FAIL with `expected "" to be "Retro Drive/kick"`. Then revert the edit and re-run; expected PASS. A lock test that has never been seen red is not a lock.

Do the same for a field that must NOT fire: temporarily change that kick's `reverbSend`, run the same command, and confirm it still PASSES. That is the over-broad-hash guard doing its job.

- [ ] **Step 6: Write `scripts/check-levels.ts`**

```ts
/**
 * Verifies the committed calibration trim table still describes today's defaults:
 *  1. every drum-kit voice and every synth preset has an entry;
 *  2. no entry names a kit, voice or preset that no longer exists;
 *  3. no entry's loudness-affecting config has drifted since it was calibrated;
 *  4. every entry's measured + trim lands within TOLERANCE_DB of TARGET_DBFS.
 *
 * Reads the table and hashes data. It NEVER renders audio and never spawns ffmpeg:
 * that is `bun run calibration:generate`, which is manual and takes minutes.
 *
 * Run with: bun scripts/check-levels.ts
 * Exit code 1 if any check fails.
 */
import { TARGET_DBFS, TOLERANCE_DB } from '../src/utils/trimMath.ts';
import {
  findDriftedEntries,
  findMissingEntries,
  findOrphanEntries,
  findOutOfToleranceEntries,
  type LevelFinding,
} from './calibration/levelChecks.ts';

let failures = 0;

function report(label: string, findings: LevelFinding[]) {
  const pass = findings.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (pass) return;
  failures += 1;
  for (const finding of findings) console.log(`        ${finding.id}: ${finding.detail}`);
}

console.log(`Calibration target ${TARGET_DBFS} dBFS, tolerance +/-${TOLERANCE_DB} dB.\n`);
report('every voice and preset has a committed entry', findMissingEntries());
report('no entry outlives the kit, voice or preset it names', findOrphanEntries());
report('no loudness-affecting default has drifted since calibration', findDriftedEntries());
report('every committed measurement + trim lands within tolerance', findOutOfToleranceEntries());

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 7: Wire `check:levels` into the gate**

In `package.json`, add after `"check:contrast"`:

```json
    "check:levels": "bun scripts/check-levels.ts",
```

and replace the `"verify"` line with:

```json
    "verify": "bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run check:contrast && bun run check:levels && bun run build"
```

Run: `time bun run check:levels`
Expected: four PASS lines, `All checks passed.`, exit 0, in well under a second.

- [ ] **Step 8: Write the applied-level verification smoke**

Create `scripts/calibration/verifyApplied.smoke.ts`. Not a `bun test` file, for the same reason as `renderOffline.smoke.ts` — it renders.

```ts
/**
 * Proves the AC end to end rather than by arithmetic: re-renders representative
 * voices WITH the committed trim applied and measures them again, asserting each
 * lands within TOLERANCE_DB of TARGET_DBFS.
 *
 * `check:levels` asserts the same guarantee from the recorded numbers in
 * milliseconds; this is the occasional confirmation that those numbers describe
 * real audio. Manual: it renders and shells out to ffmpeg.
 *
 * Run: bun run calibration:verify
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { TARGET_DBFS, TOLERANCE_DB } from '@/utils/trimMath';
import { measureLoudness } from './measureLoudness.ts';
import { renderDrumVoice, renderPreset } from './renderOffline.ts';

const SAMPLE: [string, 'kick' | 'snare' | 'crash'][] = [
  ['Retro Drive', 'kick'],
  ['808 Vintage', 'snare'],
  ['Trap Beat', 'crash'],
];

const tmpDir = mkdtempSync(join(tmpdir(), 'solna-verify-'));
let failures = 0;

function report(label: string, measured: number) {
  const pass = Math.abs(measured - TARGET_DBFS) <= TOLERANCE_DB;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}  (${measured.toFixed(1)} dBFS, target ${TARGET_DBFS} +/-${TOLERANCE_DB})`);
  if (!pass) failures += 1;
}

for (const [kitName, voice] of SAMPLE) {
  const wav = await renderDrumVoice(kitName, voice, true);
  const path = join(tmpDir, `${kitName}-${voice}`.replace(/\W+/g, '-') + '.wav');
  writeFileSync(path, wav);
  report(`${kitName}/${voice} with its trim applied`, await measureLoudness(path, `${kitName}/${voice}`));
}

for (const id of ['factory-cosmic-lead']) {
  const preset = SYNTH_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`No such preset: ${id}`);
  const wav = await renderPreset(preset, true);
  const path = join(tmpDir, `${id}.wav`);
  writeFileSync(path, wav);
  report(`${id} with its trim applied`, await measureLoudness(path, id));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

Add to `package.json` `"scripts"`, after `"calibration:smoke"`:

```json
    "calibration:verify": "bun scripts/calibration/verifyApplied.smoke.ts",
```

- [ ] **Step 9: Run the applied verification**

Run: `bun run calibration:verify`
Expected: four PASS lines, each measured value within 3 dB of −18, ending `All checks passed.` This is the direct evidence for the "applying the table lands every voice within ±3 dB of −18 dBFS" criterion.

- [ ] **Step 10: Commit**

```bash
git add scripts/calibration/levelChecks.ts scripts/calibration/trimTable.lock.test.ts scripts/calibration/verifyApplied.smoke.ts scripts/check-levels.ts package.json
git commit -m "feat(calibration): lock the trim table and add check:levels to the verify gate"
```

---

### Task 13: The harness README

> **Superseded, kept for history.** The step below still shows the ORIGINAL README draft (172 entries, a per-voice drum pattern) written before the kit-level redesign (see the DEV-387 ledger, Task 11). The actually-shipped README is `scripts/calibration/README.md` on disk — read that, not this block, for current behaviour. This block is left in place, unedited, as the record of what was planned and why it changed.

**Files:**
- Create: `scripts/calibration/README.md`

**Interfaces:**
- Consumes: every command the earlier tasks added.
- Produces: no code.

- [ ] **Step 1: Write the README**

Create `scripts/calibration/README.md`:

```markdown
# Calibration harness (DEV-387)

Regenerates `src/data/trimTable.ts` — the committed, measured trim every drum-kit
voice and every synth preset ships with, so all of them land within 3 dB of
−18 dBFS at max velocity instead of wherever they happened to be tuned by ear.

The table does **not** rewrite `src/data/drumKits.ts` or `src/data/synthPresets.ts`.
Those numbers stay as authored, so the diff of a retune is still readable; the
measured trim multiplies on top, in `src/audio/trims.ts`.

## When to re-run

- A drum-kit voice's `gain`, envelope, pitch or filter changed.
- A synth preset's params changed, or `INITIAL_SYNTH_PARAMS` / `DEFAULT_DRUM_KIT` did.
- A kit, a voice or a preset was added or removed.
- `bun run check:levels` failed — it means one of the above happened without a re-run.

You do **not** need to re-run for a rename, a colour, a description, a `provenance`,
a `reference`, an arpeggiator default, or a `reverbSend`. Those are excluded from the
config hash on purpose: an over-broad hash fires on cosmetic edits and trains people
to regenerate without thinking. See `loudnessConfig.ts` for the exact field lists and
the reasoning.

## How to re-run

1. `bun run calibration:generate`. 172 entries; expect several minutes — each is a
   real `OfflineAudioContext` render plus an ffmpeg pass. The table is written after
   every entry, so an interrupted run loses at most the in-flight one.
2. Investigate every `FAILED` line **before** touching the harness (see pitfalls).
3. Investigate every flagged entry — a trim past ±12 dB, the fader's own range.
   It is either a genuine outlier (a real product decision, possibly its own issue)
   or a harness artefact. Do not ship a flagged run unreviewed, and never clamp the
   number to make the line go away: `check:levels` asserts the ±3 dB guarantee from
   these same numbers, so a clamp would break it silently.
4. `git diff src/data/trimTable.ts` — confirm only the expected entries moved.
5. `bun run calibration:verify` — re-renders four representative voices with the
   trim applied and measures them again. This is the end-to-end proof; `check:levels`
   only proves the recorded arithmetic.
6. By-ear A/B a few changed voices in `bun run dev`.
7. `bun run verify`, then commit.

## What runs where

| Command | Renders? | ffmpeg? | Cost | In `verify`? |
|---|---|---|---|---|
| `bun run calibration:generate` | yes, 172x | yes | minutes | **never** |
| `bun run calibration:smoke` | yes, 6x | no | seconds | no |
| `bun run calibration:verify` | yes, 4x | yes | seconds | no |
| `bun run check:levels` | no | no | milliseconds | **yes** |
| `bun test scripts/calibration/trimTable.lock.test.ts` | no | no | milliseconds | yes |

The generator is manual and on-demand. CI sees only the committed table, the lock
test and `check:levels` — no native addon and no ffmpeg on the `bun test` critical
path (shared contract, D-383-2). The render-driving files are named `*.smoke.ts`
rather than `*.test.ts` precisely so Bun's test globs never pick them up; renaming
one to `.test.ts` would put the native addon back on that path.

## Architecture

Two stages.

1. **Render** — `renderOffline.ts` drives the **real** `AudioEngine` against a
   `node-web-audio-api` `OfflineAudioContext`, through the seam `src/audio/testFakes.ts`
   already establishes (`makeEngine()`, then assign the private `ctx`). Measuring a
   model of the engine instead of the engine would measure the model. The three
   parallel sends are zeroed so the measurement is the dry voice; the EQ, compressor
   and limiter stay in circuit because they are the fixed serial chain every voice
   actually leaves through.
2. **Measure** — `measureLoudness.ts` shells out to `ffmpeg -af ebur128 -f null -`
   and takes the **median** of every valid short-term (`S:`) reading. Median, not
   mean, so one anomalous frame cannot skew a committed default. ffmpeg comes from
   `PATH`, not a bundled installer package: this epic commits to exactly one new
   devDependency and the harness is manual.

## Patterns

- **Drum voice:** 5.0 s, nine hits at velocity 1.0, first at 0.25 s, every 0.5 s
  (the 8th-note grid at 120 BPM). One interval for all eleven voices, deliberately:
  uniformity is what makes trims comparable across kits, which is the point. The
  cost, stated rather than hidden: a crash or ride with a 1.2–2.5 s wash stacks
  several tails at this density, so its trim runs a little quieter than one isolated
  hit would need. A per-voice interval would make every voice's number mean something
  different and the ±3 dB band meaningless across the roster.
- **Synth preset:** 6.5 s, four notes on `C3` at velocity 1.0, note-on every 1.5 s
  with a 1.3 s gate. One pattern serves both families: a pad with attack up to ~1.0 s
  reaches sustain inside the gate, and a pluck still puts four attacks inside every
  3 s window instead of one attack and six seconds of silence.

Both are sized by the EBU gate below, not by taste.

## Known pitfalls

- **EBU R128's 3-second gate.** `ebur128`'s short-term (`S:`) reading is a rolling
  3-second window: ffmpeg reports a fixed ~−120.7 LUFS sentinel for **every** frame
  until 3 s has accumulated, whatever the actual level. A pattern shorter than 3 s
  produces zero valid readings, full stop — which is why every pattern renders for at
  least ~4 s. The sentinel is filtered **on value** (`> -100 LUFS`), never on the
  frame's `t:` timestamp: ffmpeg's frames land at 0.0999792, 0.1999792, … 2.99998,
  never on an exact boundary, so a `t >= 3` cutoff clips early.
- **"No valid LUFS readings" is not always a duration bug.** It can mean the voice is
  genuinely silent in production, not just in the harness. Before assuming a harness
  bug, run `bun run dev` and confirm the voice sounds in the app. murva learned this
  the expensive way on three drum machines that turned out to be 404ing their samples.
- **`PRESET_TRIMS` is keyed by preset id, but the engine only sees `params.preset`,**
  which `applyPreset` sets to the preset **name**. `src/audio/trims.ts` bridges that
  with an index built over the factory library. A user preset that reuses a factory
  patch's name inherits that patch's trim — bounded, documented, and the reason
  `src/audio/trims.test.ts` asserts factory names are unique.
- **A trim is a default, not live auto-gain.** Turn a preset's cutoff knob and the
  patch keeps its measured trim. That is intentional; live measurement-driven trim is
  a different feature.
```

- [ ] **Step 2: Verify the README's commands all exist**

Run: `bun run --silent 2>&1 | grep -E "calibration:(generate|smoke|verify)|check:levels"`
Expected: all four script names listed.

- [ ] **Step 3: Commit**

```bash
git add scripts/calibration/README.md
git commit -m "docs(calibration): document when to re-run and what a flagged entry means"
```

---

### Task 14: Full gate

**Files:**
- Modify: none expected. Any file this task touches is a fix the gate found.

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch.

- [ ] **Step 1: Run the gate**

Run: `bun run verify`
Expected: PASS end to end — `bun test` green (including `scripts/calibration/trimTable.lock.test.ts` and `src/data/dataLayerPurity.test.ts`), `tsc --noEmit` clean, `check:keys` / `check:drums` / `check:contrast` / `check:levels` all `All checks passed.`, and the vite build succeeding.

- [ ] **Step 2: Confirm eslint reports NOTHING**

Run: `bun run eslint 2>&1 | tee /dev/stderr | wc -l`
Expected: `0`. Not "no errors" — **no output at all**, no warnings either. That is the state the repo is in and the state to keep it in (decision D5). **Superseded:** the private `drumTrim` helper this step names was deleted in the kit-level redesign — `triggerDrum` now reads a single field (`this.drumTrimGain`) with no `??`, so there is nothing left to isolate into a helper. A `complexity` warning on `triggerDrum` now means some OTHER branching went inline; look for what actually grew, not this helper.

- [ ] **Step 3: Confirm the generator is not on the CI path**

Run: `bun test 2>&1 | grep -ci "node-web-audio-api\|ebur128\|ffmpeg"`
Expected: `0`. If a render-driving file was renamed to `*.test.ts`, this is where it shows.

- [ ] **Step 4: Confirm the authored numbers are untouched**

Run: `git diff main --stat -- src/data/drumKits.ts src/data/synthPresets.ts`
Expected: no output. The whole point is that a retune's diff stays readable, which it does not if the calibration rewrote what a reviewer tuned by ear.

- [ ] **Step 5: Commit any fixes and push**

```bash
git add -A
git commit -m "chore(calibration): settle the verify gate"
git push -u origin feat/dev-387-level-calibration
```

---

## Self-review

**Every acceptance criterion maps to a task.**

| AC | Tasks |
|---|---|
| A `bun run calibration:generate` script that renders each drum-kit voice and each synth preset, measures it, and writes a committed generated trim table | Tasks 1, 2, 4, 5, 8 (the pieces), Task 10 (the orchestrator and the script entry), Task 11 (the run and the commit) |
| The table holds one measured trim (dB) per drum-kit voice and per synth preset, with the measured dBFS recorded alongside | Task 6 (`TrimEntry` carries `measuredDbfs` beside `trimDb`; the writer test asserts both appear on the emitted line), Task 11 |
| Applying the table lands every voice within ±3 dB of −18 dBFS at max velocity | Task 7 (the application path), Task 12 step 4 (`findOutOfToleranceEntries` from the recorded numbers) and Task 12 step 9 (`calibration:verify`, a real re-render and re-measure — the direct evidence) |
| A fast lock test fails when a loudness-affecting default changed without a re-run, hashing each entry's loudness-relevant config against the recorded hash | Task 9 (the hash and its exclusion lists), Task 12 steps 1-5 — including step 5, which proves the test fires red on a `gain` change and stays green on a `reverbSend` change |
| A `check:levels` entry added to the `verify` gate alongside `check:keys` and `check:drums` | Task 12 step 7, confirmed by Task 14 step 1 |
| The generator is manual/on-demand only and NEVER runs in CI | Task 8 (the `*.smoke.ts` naming convention and why), Task 10 (the generator is a script, not a test), Task 13 (the "what runs where" table), Task 14 step 3 (an assertion that `bun test` never loads the addon or ffmpeg) |
| DoD: `bun run verify` green including `check:levels` | Task 14 steps 1-2 |
| DoD: the generated table committed and its diff reviewable | Task 6 (sorted, deterministic output so a re-run reorders nothing), Task 11 step 4 (the human review, four named things to confirm) |
| DoD: `scripts/calibration/README.md` documenting when to re-run and what a flagged entry means | Task 13 |

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "write tests for the above", no "similar to Task N". Every code step carries runnable code, repeated rather than cross-referenced. The one deliberate blank is Task 11's commit body, where the measured spread and the flagged-entry decisions are values the run produces and a human records — that is the review artefact, not a placeholder.

**Name agreement.** `TrimEntry` / `DRUM_TRIMS` / `PRESET_TRIMS` match the shared contract's declared surface exactly — **corrected post-implementation:** this originally claimed "including `DRUM_TRIMS` being kit→voice", which was true of the plan as written but is no longer true of what shipped or of the contract doc, which now states the opposite (kit name → one `TrimEntry`, whole kit) after the kit-level redesign in Task 11. `PRESET_TRIMS` is unchanged, keyed by preset id. `TARGET_DBFS = -18` and `TOLERANCE_DB = 3` match the contract's `trimMath.ts` row; `FADER_MAX_DB` is consumed, never redefined. `resolveFfmpegPath`, `parseEbur128Output`, `medianShortTermLufs`, `measureLoudness`, `encodeWav`, `renderDrumVoice`, `renderPreset`, `hashLoudnessConfig`, `drumLoudnessHash`, `presetLoudnessHash`, `renderTrimTableSource`, `writeTrimTable`, `TRIM_TABLE_PATH`, `GeneratedTrimEntry`, `NEUTRAL_TRIM_GAIN`, `drumTrimGainsFor`, `synthTrimGainFor`, `LevelFinding` and the four `find*` collectors are each defined in exactly one task and consumed under the same name everywhere after it. `setPresetTrim` and `setDrumKit(kit, kitName)` are defined in Task 7 and called by Task 8's `renderOffline.ts`, which is why the engine-application task is ordered before the render harness rather than after it. The one forward reference that remains is intentional and stated where it occurs: Task 6 lands `src/data/trimTable.ts` with empty maps so Task 7 has something to import, and Task 11 fills it.
