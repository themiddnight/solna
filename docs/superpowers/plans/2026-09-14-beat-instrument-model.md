# Beat Instrument Model and Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kit-name-only drum state with a complete per-loop Beat Params, Pattern, and Mix model plus a responsive Pro-depth editor and reusable user presets.

**Architecture:** Factory Beat presets are complete immutable patches with stable IDs. The store owns three sibling per-loop values (`beatParams`, `beatPattern`, `beatMix`), while an audio adapter feeds the existing drum DSP; UI gestures preview transiently and commit once. Both project readers accept the legacy shape, but only the new shape is written.

**Tech Stack:** Bun, TypeScript, React, Zustand, Vite, Tailwind CSS v4, daisyUI, Web Audio API.

**Spec:** `docs/superpowers/specs/2026-09-14-beat-instrument-model-design.md`

## Global Constraints

- Beat has one detailed editor; there is no Simple mode or multi-parameter macro layer.
- Canonical loop state is exactly `beatParams`, `beatPattern`, and `beatMix`; legacy Beat fields must be absent at completion.
- The voice roster and order remain `kick snare rimshot clap hihat openhat hitom lowtom ride crash bell`.
- Every Beat parameter is required and finite; a disabled kick click is `clickLevel: 0`.
- `outputTrimDb` is persisted calibration metadata and is not user-editable.
- Pointer dragging previews without persisted writes and commits exactly once on pointerup; cancel writes nothing.
- Below `lg` the editor is a one-open accordion with a three-column knob grid; `lg` and above show all Primary rows.
- Factory content remains a pure `src/data/` leaf. Components do not import `audio/engine`.
- Old input is accepted at the sanitizer boundary, but new writes never contain old fields.
- Every task finishes with its targeted tests green; final completion requires `bun run verify` with no new ESLint output.

---

### Task 1: Complete Beat Types and Factory Preset Catalog

**Files:**
- Modify: `src/types.ts`
- Create: `src/data/beatPresets.ts`
- Create: `src/data/beatPresets.test.ts`
- Create: `src/store/beatPresets.ts`
- Create: `src/store/beatPresets.test.ts`
- Modify: `src/data/trimTable.ts`
- Modify: `scripts/calibration/loudnessConfig.ts`
- Modify: `scripts/calibration/renderOffline.ts`
- Modify: `scripts/calibration/levelChecks.ts`
- Modify: `scripts/calibration/generateTrimTable.ts`
- Modify: `scripts/calibration/writeTrimTable.ts`
- Modify: `scripts/calibration/loudnessConfig.test.ts`
- Modify: `scripts/calibration/trimTable.lock.test.ts`
- Modify: `scripts/calibration/writeTrimTable.test.ts`
- Modify: `scripts/calibration/renderOffline.smoke.ts`
- Modify: `scripts/calibration/verifyApplied.smoke.ts`

**Interfaces:**
- Produces in `src/types.ts`: `BeatVoiceId`, complete voice parameter interfaces, `BeatVoices`, `BeatFilterParams`, `BeatPatch`, `BeatParams`, `BeatPattern`, `BeatVoiceMix`, `BeatMix`, `BeatPreset`, and `FactoryBeatPreset` with required reference metadata.
- Produces in `src/data/beatPresets.ts`: `BEAT_VOICE_IDS`, `BEAT_PRESETS`, and `DEFAULT_BEAT_PRESET_ID`.
- Produces in `src/store/beatPresets.ts`: `beatPresetById(id: string): FactoryBeatPreset | undefined`, `beatParamsFromPreset(id: string): BeatParams`, and `defaultBeatState(): { beatParams; beatPattern; beatMix }`.
- Consumes: the existing 13 `DRUM_KITS` values and `DRUM_TRIMS` only as migration source material.

- [ ] **Step 1: Write catalog tests that require stable IDs and complete patches**

```ts
expect(BEAT_PRESETS.map((preset) => preset.id)).toEqual([
  'retro-drive', 'club-standard', 'trap-beat', '808-vintage', 'chrome-pulse',
  'velocity-breaks', 'sub-weight', 'warehouse', 'tight-pocket',
  'acoustic-studio', 'warm-riddim', 'lo-fi-vinyl', 'dusty-break',
]);
for (const preset of BEAT_PRESETS) {
  expect(Object.keys(preset.patch.voices)).toEqual([...BEAT_VOICE_IDS]);
  expect(Number.isFinite(preset.patch.outputTrimDb)).toBe(true);
  expect(preset.patch.voices.kick.clickLevel).toBeGreaterThanOrEqual(0);
}
```

- [ ] **Step 2: Run the new tests and verify the imports fail**

Run: `bun test src/data/beatPresets.test.ts src/store/beatPresets.test.ts`

Expected: FAIL because the catalog and resolver modules do not exist.

- [ ] **Step 3: Define the complete model and migrate all 13 factory literals**

```ts
export interface BeatParams extends BeatPatch {
  basePresetId: string | null;
}

export interface BeatPreset {
  id: string;
  name: string;
  origin: 'factory' | 'user';
  patch: BeatPatch;
}

export const BEAT_VOICE_IDS = [
  'kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat',
  'hitom', 'lowtom', 'ride', 'crash', 'bell',
] as const;
```

Copy each resolved legacy kit into one complete `BeatPreset`; use the current default bus filter,
the measured trim for that kit, and explicit click defaults where the old partial omitted them.
Type factory entries as `FactoryBeatPreset` and keep the existing required reference metadata on
each one. Do not import a sibling data module; `beatPresets.ts` may import Beat types with
`import type` from `src/types.ts`.

- [ ] **Step 4: Add resolver functions and calibration consumers**

```ts
export function beatParamsFromPreset(id: string): BeatParams {
  const preset = beatPresetById(id) ?? beatPresetById(DEFAULT_BEAT_PRESET_ID)!;
  return structuredClone({ basePresetId: preset.id, ...preset.patch });
}
```

Make the calibration scripts enumerate `BEAT_PRESETS` by stable ID. Keep `DRUM_TRIMS` as the
generated calibration evidence table, re-key it to stable Beat preset IDs, and embed the same
value in every factory patch's `outputTrimDb`; `beatPresets.ts` must not import `trimTable.ts`
because every `src/data/` file is an independent leaf. Update the lock test to compare each
embedded value with its measured table value and to reject an empty or incomplete roster. Runtime
audio reads only `BeatParams.outputTrimDb`; it never looks up `DRUM_TRIMS`.

- [ ] **Step 5: Run catalog and calibration gates**

Run: `bun test src/data/beatPresets.test.ts src/store/beatPresets.test.ts scripts/calibration`

Run: `bun run check:drums && bun run check:levels`

Expected: PASS; the 13 presets remain audibly separated and calibrated.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/data/beatPresets.ts src/data/beatPresets.test.ts src/store/beatPresets.ts src/store/beatPresets.test.ts src/data/trimTable.ts scripts/calibration/loudnessConfig.ts scripts/calibration/loudnessConfig.test.ts scripts/calibration/renderOffline.ts scripts/calibration/renderOffline.smoke.ts scripts/calibration/levelChecks.ts scripts/calibration/generateTrimTable.ts scripts/calibration/writeTrimTable.ts scripts/calibration/writeTrimTable.test.ts scripts/calibration/trimTable.lock.test.ts scripts/calibration/verifyApplied.smoke.ts
git commit -m "feat(data): define complete beat presets"
```

### Task 2: Beat Validation and Legacy Conversion

**Files:**
- Create: `src/store/sanitizeBeat.ts`
- Create: `src/store/sanitizeBeat.test.ts`
- Modify: `src/store/sanitize.ts`
- Modify: `src/store/sanitize.test.ts`

**Interfaces:**
- Consumes: Task 1 Beat types and `beatParamsFromPreset`.
- Produces: `sanitizeBeatParams(value, fallback, knownPresetIds)`, `sanitizeBeatPattern(value, fallback)`, `sanitizeBeatMix(value, fallback)`.
- Produces: `readBeatState(record, fallback): { beatParams; beatPattern; beatMix }`.

- [ ] **Step 1: Write failing per-field and legacy conversion tests**

```ts
const legacy = {
  soundKit: 'Club Standard',
  drumFilterCutoff: 2400,
  drumFilterResonance: 1.5,
  drumFilterType: 'bandpass',
  masterSequencerVolume: -4,
  drumMuted: true,
  sequencerTracks: [{ instrument: 'kick', steps, volume: -2, muted: false }],
};
const out = readBeatState(legacy, defaultBeatState());
expect(out.beatParams.basePresetId).toBe('club-standard');
expect(out.beatParams.filter.cutoff).toBe(2400);
expect(out.beatPattern.rows.kick).toEqual(steps);
expect(out.beatMix.voices.kick.levelDb).toBe(-2);
```

Also assert that one invalid nested frequency falls back without replacing valid sibling values,
unknown voices are dropped, missing rows are silent, missing mix entries are unity/unmuted, and an
unresolved base ID becomes `null` without changing a valid complete patch.

- [ ] **Step 2: Run the tests and verify the reader is missing**

Run: `bun test src/store/sanitizeBeat.test.ts src/store/sanitize.test.ts`

Expected: FAIL because the Beat sanitizers do not exist.

- [ ] **Step 3: Implement explicit sanitizers for every heterogeneous voice**

```ts
export function sanitizeBeatParams(
  value: unknown,
  fallback: BeatParams,
  knownPresetIds: ReadonlySet<string>,
): BeatParams {
  const row = asRecord(value);
  return {
    basePresetId: typeof row.basePresetId === 'string' && knownPresetIds.has(row.basePresetId)
      ? row.basePresetId
      : null,
    outputTrimDb: clampFinite(row.outputTrimDb, -24, 24, fallback.outputTrimDb),
    filter: sanitizeBeatFilter(row.filter, fallback.filter),
    voices: sanitizeBeatVoices(row.voices, fallback.voices),
  };
}
```

Spell each voice field and range explicitly; do not iterate heterogeneous params with casts. Reuse
the existing fixed-width pattern helpers and dB validators. `knownPresetIds` contains factory IDs
plus already-sanitized user-preset IDs when reading app persistence; project-file parsing supplies
factory IDs only. This preserves a valid user base on app reload while a project imported without
that app-level preset safely becomes `basePresetId: null`.

- [ ] **Step 4: Implement new-shape-first reading with legacy fallback**

`readBeatState` uses the new shape when all three top-level Beat keys are present; otherwise it
maps legacy kit names to stable IDs and splits `sequencerTracks` into Pattern and Mix. It must not
return legacy keys or mutate the input.

- [ ] **Step 5: Run sanitizer tests**

Run: `bun test src/store/sanitizeBeat.test.ts src/store/sanitize.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/sanitizeBeat.ts src/store/sanitizeBeat.test.ts src/store/sanitize.ts src/store/sanitize.test.ts
git commit -m "feat(store): validate beat state and legacy input"
```

### Task 3: Add Beat Store State and Actions

**Files:**
- Create: `src/store/beatSlice.ts`
- Create: `src/store/beatSlice.test.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/store.ts`
- Modify: `src/store/initialState.ts`
- Modify: `src/store/loopSlice.ts`
- Modify: `src/store/loop.ts`
- Modify: `src/store/loopSync.ts`
- Modify: `src/store/projectFormat.ts`
- Modify: `src/store/projectFile.ts`
- Modify: `src/store/initialState.test.ts`
- Modify: `src/store/loop.test.ts`
- Modify: `src/store/loopSlice.test.ts`
- Modify: `src/store/loopSync.test.ts`
- Modify: `src/store/projectFormat.test.ts`
- Modify: `src/store/projectFile.test.ts`

**Interfaces:**
- Consumes: Task 1 model/resolver and Task 2 reader.
- Produces: `BeatSlice` state/actions and per-loop `beatParams`, `beatPattern`, `beatMix`.
- Produces: `setBeatPreset`, `setBeatParams`, `updateBeatVoice`, `resetBeatVoice`, `resetBeatParams`, `replaceBeatPattern`, `setBeatVoiceLevel`, `toggleBeatVoiceMuted`, `setBeatLevel`, `toggleBeatMuted`.

- [ ] **Step 1: Write failing slice tests for immutable, scoped updates**

```ts
state.updateBeatVoice('kick', { decay: 0.7 });
expect(next.beatParams.voices.kick.decay).toBe(0.7);
expect(next.beatParams.voices.snare).toBe(previous.beatParams.voices.snare);

state.replaceBeatPattern({ kick: [true, false] });
expect(next.beatPattern.rows.kick.slice(0, 4)).toEqual([true, false, true, false]);
expect(next.beatPattern.rows.snare.every((hit) => !hit)).toBe(true);
```

Pin preset replacement, voice/all reset, meter-window preservation, per-voice mix, and one loop
mirror notification per committed action.

- [ ] **Step 2: Run targeted store tests and verify type/action failures**

Run: `bun test src/store/beatSlice.test.ts src/store/loop.test.ts src/store/projectFormat.test.ts`

Expected: FAIL on missing Beat fields and actions.

- [ ] **Step 3: Implement `BeatSlice` and fresh-loop defaults**

```ts
export interface BeatSlice {
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
  setBeatParams(params: BeatParams): void;
  updateBeatVoice<T extends BeatVoiceId>(voice: T, patch: Partial<BeatVoices[T]>): void;
  // remaining actions listed in Interfaces
}
```

Use immutable updates at the narrowest nested object. Create fresh arrays/objects for each loop;
never share a factory patch or silent row by reference.

- [ ] **Step 4: Add the three fields to loop/project contracts**

Add them to `Loop`, `LoopStatePatch`, `LOOP_FLAT_KEYS`, default-loop creation, project fingerprinting,
and project sanitization. Bump `PROJECT_FORMAT_VERSION` because the content contract changes. Keep
the legacy flat fields temporarily only until Task 9 so existing consumers compile; mark the bridge
with a deletion comment naming Task 9.

- [ ] **Step 5: Run the store/project suite**

Run: `bun test src/store/beatSlice.test.ts src/store/loop.test.ts src/store/loopSlice.test.ts src/store/projectFormat.test.ts src/store/projectFile.test.ts`

Expected: PASS with both read shapes accepted.

- [ ] **Step 6: Commit**

```bash
git add src/store/beatSlice.ts src/store/beatSlice.test.ts src/store/types.ts src/store/store.ts src/store/initialState.ts src/store/initialState.test.ts src/store/loopSlice.ts src/store/loopSlice.test.ts src/store/loop.ts src/store/loop.test.ts src/store/loopSync.ts src/store/loopSync.test.ts src/store/projectFormat.ts src/store/projectFormat.test.ts src/store/projectFile.ts src/store/projectFile.test.ts
git commit -m "feat(store): add per-loop beat instrument state"
```

### Task 4: Cut Pattern Editing and Playback Over to Beat Pattern/Mix

**Files:**
- Create: `src/audio/beatSteps.ts`
- Create: `src/audio/beatSteps.test.ts`
- Modify: `src/components/loop/SequencerView.tsx`
- Modify: `src/components/loop/SequencerView.test.tsx`
- Modify: `src/components/loop/sequencer/SequencerGrid.tsx`
- Modify: `src/components/loop/sequencer/TrackRow.tsx`
- Modify: `src/components/loop/sequencer/TrackRow.test.tsx`
- Modify: `src/components/useSequencerPlayback.ts`
- Modify: `src/components/useSequencerPlayback.test.ts`
- Modify: `src/store/loopCopy.ts`
- Modify: `src/store/loopCopy.test.ts`
- Delete: `src/audio/sequencerSteps.ts`
- Delete: `src/audio/sequencerSteps.test.ts`

**Interfaces:**
- Consumes: `BeatPattern`, `BeatMix`, `BEAT_VOICE_IDS`, and Task 3 actions.
- Produces: `beatStepEvents(pattern, mix, stepIndex): { voice: BeatVoiceId }[]`.
- Produces: Pattern UI props keyed by `voiceId`, `steps`, and `BeatVoiceMix`, with labels/colors derived from one registry.

- [ ] **Step 1: Write failing pure playback and component tests**

```ts
expect(beatStepEvents(pattern, mix, 0)).toEqual([{ voice: 'kick' }]);
mix.voices.kick.muted = true;
expect(beatStepEvents(pattern, mix, 0)).toEqual([]);
```

Assert that TrackRow receives no persisted `id`, `name`, `color`, or combined `SequencerTrack`, and
that Beat Pattern copy contains only `beatPattern` while Mix owns `beatMix`.

- [ ] **Step 2: Run tests and verify old-shape assumptions fail**

Run: `bun test src/audio/beatSteps.test.ts src/components/loop/SequencerView.test.tsx src/components/loop/sequencer/TrackRow.test.tsx src/store/loopCopy.test.ts`

Expected: FAIL until the new Pattern/Mix interfaces are wired.

- [ ] **Step 3: Refactor grid editing to voice-keyed state**

Replace track-array rewrites with `toggleBeatStep`, `replaceBeatPattern`, per-voice mix actions, and
pure toolbar transforms over `BeatPattern.rows`. Preserve active-meter windowing and dormant wider-
meter cells. Keep the grid's intentional horizontal scroll behavior unchanged.

- [ ] **Step 4: Replace sequencer event generation**

`beatStepEvents` iterates `BEAT_VOICE_IDS`, skips muted voices and inactive cells, and can emit only
drum voices. Remove the latent synth/bass branch. `useSequencerPlayback` triggers returned voices
through the existing drum playback bridge.

- [ ] **Step 5: Update copy groups and tests**

Rename `drums-sound`/`drums-pattern` to `beat-sound`/`beat-pattern`. `beat-sound` owns
`beatParams`, `beat-pattern` owns `beatPattern`, and `mix` owns `beatMix`; remove the old special-case
that copied steps while suppressing track volume/mute.

- [ ] **Step 6: Run Pattern, playback, and copy tests**

Run: `bun test src/audio/beatSteps.test.ts src/components/useSequencerPlayback.test.ts src/components/loop/SequencerView.test.tsx src/components/loop/sequencer/TrackRow.test.tsx src/store/loopCopy.test.ts src/store/loopCopySlice.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/audio/beatSteps.ts src/audio/beatSteps.test.ts src/audio/sequencerSteps.ts src/audio/sequencerSteps.test.ts src/components/loop/SequencerView.tsx src/components/loop/SequencerView.test.tsx src/components/loop/sequencer/SequencerGrid.tsx src/components/loop/sequencer/TrackRow.tsx src/components/loop/sequencer/TrackRow.test.tsx src/components/useSequencerPlayback.ts src/components/useSequencerPlayback.test.ts src/store/loopCopy.ts src/store/loopCopy.test.ts src/store/loopCopySlice.test.ts
git commit -m "refactor(beat): separate pattern data from mix"
```

### Task 5: User Beat Presets, Vibes, and Grid References

**Files:**
- Modify: `src/store/presetsSlice.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/store.ts`
- Modify: `src/store/store.test.ts`
- Modify: `src/data/vibes.ts`
- Modify: `src/data/vibes.test.ts`
- Modify: `src/data/drumGrids.ts`
- Modify: `src/data/drumGrids.test.ts`
- Modify: `src/store/vibes.ts`
- Modify: `src/store/vibes.test.ts`
- Modify: `src/store/projectFile.ts`
- Modify: `src/store/projectFile.test.ts`

**Interfaces:**
- Consumes: `BeatPreset`, `BeatPatch`, `beatParamsFromPreset`, and Task 3 preset action.
- Produces: `customBeatPresets`, `saveCustomBeatPreset(name, params): BeatPreset`, and `deleteCustomBeatPreset(id): BeatPreset[]`.
- Changes: `VibeSpec.soundKit` and `DrumGrid.kit` become stable `beatPresetId` references.

- [ ] **Step 1: Write failing preset persistence and lifecycle tests**

```ts
const saved = state.saveCustomBeatPreset('My Beat', state.beatParams);
expect(saved.origin).toBe('user');
expect(saved.patch).toEqual(patchOf(state.beatParams));
expect(partializeAppState(useAppStore.getState()).customBeatPresets).toContainEqual(saved);
expect(buildProjectContent(useAppStore.getState())).not.toHaveProperty('customBeatPresets');
```

Also assert deletion leaves every loop's complete `beatParams` unchanged and persisted custom Beat
presets are sanitized before entering the store.

- [ ] **Step 2: Run preset and store tests**

Run: `bun test src/store/store.test.ts src/store/beatSlice.test.ts`

Expected: FAIL on missing custom Beat preset state/actions.

- [ ] **Step 3: Implement the app-level user library**

Mirror the Synth library boundary: include `customBeatPresets` in `PersistedState`, partialization,
and persisted-input sanitization, but exclude it from `PROJECT_CONTENT_KEYS`. Save a deep-cloned
`BeatPatch`, generate an ID with the existing user-preset convention, and apply the saved preset as
the current base without changing its sound. Sanitize the custom preset library first, then pass
its valid IDs together with factory IDs into Task 2's loop sanitizer so user-based loops retain
their base across an app reload.

- [ ] **Step 4: Replace name references in vibes and grids**

Use stable IDs such as `retro-drive` and `club-standard`. Applying a vibe calls `setBeatPreset` and
`replaceBeatPattern` independently. A grid's `beatPresetId` remains provenance only; choosing a grid
must not change Beat Params.

- [ ] **Step 5: Update missing-resource and reference validation**

Project parsing validates `beatParams.basePresetId` only as optional provenance: an unknown ID does
not reject a complete patch. Vibe and grid tests remain strict because shipped factory data must
reference an existing factory preset.

- [ ] **Step 6: Run preset, vibe, grid, and project tests**

Run: `bun test src/store/store.test.ts src/store/vibes.test.ts src/data/vibes.test.ts src/data/drumGrids.test.ts src/store/projectFile.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/presetsSlice.ts src/store/types.ts src/store/store.ts src/store/store.test.ts src/store/beatSlice.test.ts src/store/vibes.ts src/store/vibes.test.ts src/store/projectFile.ts src/store/projectFile.test.ts src/data/vibes.ts src/data/vibes.test.ts src/data/drumGrids.ts src/data/drumGrids.test.ts
git commit -m "feat(beat): add reusable beat presets"
```

### Task 6: Live Audio, Bus Sync, and Per-Loop Mixdown

**Files:**
- Create: `src/audio/beatAdapter.ts`
- Create: `src/audio/beatAdapter.test.ts`
- Create: `src/store/beatPreview.ts`
- Create: `src/store/beatPreview.test.ts`
- Modify: `src/audio/drumSynth.ts`
- Modify: `src/audio/drumSynth.test.ts`
- Modify: `src/audio/engine.ts`
- Modify: `src/audio/engine.test.ts`
- Modify: `src/store/sourceBuses.ts`
- Modify: `src/store/fxBus.test.ts`
- Modify: `src/store/engineSync.ts`
- Modify: `src/store/engineSync.test.ts`
- Modify: `src/store/mixdownSlice.ts`
- Modify: `src/store/mixdownSlice.test.ts`
- Modify: `src/audio/export/renderMixdown.ts`
- Modify: `src/audio/export/renderMixdown.test.ts`

**Interfaces:**
- Produces: `applyBeatParams(engine, params, time?)` and frame-coalesced `previewBeatParams(params)` / `restoreBeatParams(params)`.
- Changes: `setDrumKit(voices, outputTrimDb)` accepts complete voices and an explicit trim instead of a kit name.
- Produces: `SOURCE_BUSES` rows with `selectLevelDb(state)` and `selectMuted(state)` readers, allowing the sequencer row to read nested `beatMix` while melodic rows retain their flat fields.

- [ ] **Step 1: Write failing adapter, preview, and engine-sync tests**

```ts
applyBeatParams(engine, params, 4);
expect(engine.setDrumKit).toHaveBeenCalledWith(params.voices, params.outputTrimDb);
expect(engine.setDrumFilter).toHaveBeenCalledWith(
  params.filter.cutoff, params.filter.resonance, params.filter.type, 4,
);
```

Assert repeated previews within one animation frame apply only the latest Beat Params, restore is
immediate, committed store updates reach the engine, and Beat bus gain/mute read `beatMix`.

- [ ] **Step 2: Write a failing two-loop mixdown regression**

Construct two loops whose kick decay/frequency and `outputTrimDb` differ. Assert the offline engine
receives each loop's Beat Params before that loop's first scheduled hit, rather than one active-loop
patch for the whole arrangement.

- [ ] **Step 3: Run targeted audio tests**

Run: `bun test src/audio/beatAdapter.test.ts src/store/beatPreview.test.ts src/store/engineSync.test.ts src/audio/export/renderMixdown.test.ts`

Expected: FAIL on the missing adapter and current one-kit mixdown behavior.

- [ ] **Step 4: Implement explicit trim and Beat application**

```ts
export function applyBeatParams(engine: AudioEngine, params: BeatParams, time?: number): void {
  engine.setDrumKit(params.voices, params.outputTrimDb);
  engine.setDrumFilter(params.filter.cutoff, params.filter.resonance, params.filter.type, time);
}
```

Convert trim dB once inside the drum engine setter. Remove drum-name trim lookup from the hot path.
Keep synth preset trim behavior unchanged.

- [ ] **Step 5: Wire committed and transient live state**

Engine bootstrap and subscriptions apply `beatParams`; Beat Mix drives the sequencer bus and every
voice gain/mute. Calculate each engine voice gain as `muted ? 0 : faderDbToGain(levelDb)`, so pads,
Preview, live playback, and export share the same audible mix; `beatStepEvents` also skips muted
scheduled hits to avoid building silent voices. Replace `SOURCE_BUSES`' flat field-name columns
with typed selector functions so the six-bus roster remains single-source. The preview bridge owns
one `createFrameCoalescer`, never writes Zustand, and is the only non-test component-facing route
to transient Beat audio.

- [ ] **Step 6: Carry Beat state through mixdown**

Replace `drumKit`, `drumKitName`, `drumFilter`, `drumTracks`, and `sequencerParams` snapshot fields
with `beatParams`, `beatPattern`, and `beatMix`. At each pass boundary apply that loop's Beat Params
before calling `beatStepEvents`; convert Beat Mix dB at the store-to-audio boundary.

- [ ] **Step 7: Run live/export audio tests**

Run: `bun test src/audio/beatAdapter.test.ts src/audio/drumSynth.test.ts src/audio/engine.test.ts src/store/beatPreview.test.ts src/store/fxBus.test.ts src/store/engineSync.test.ts src/store/mixdownSlice.test.ts src/audio/export/renderMixdown.test.ts`

Expected: PASS, including different Beat patches across arrangement loops.

- [ ] **Step 8: Commit**

```bash
git add src/audio/beatAdapter.ts src/audio/beatAdapter.test.ts src/audio/drumSynth.ts src/audio/drumSynth.test.ts src/audio/engine.ts src/audio/engine.test.ts src/store/beatPreview.ts src/store/beatPreview.test.ts src/store/engineSync.ts src/store/engineSync.test.ts src/store/sourceBuses.ts src/store/fxBus.test.ts src/store/mixdownSlice.ts src/store/mixdownSlice.test.ts src/audio/export/renderMixdown.ts src/audio/export/renderMixdown.test.ts
git commit -m "feat(audio): sync and export per-loop beat patches"
```

### Task 7: Commit-Aware Knob Gestures

**Files:**
- Modify: `src/components/ui/Knob.tsx`
- Modify: `src/components/ui/Knob.test.tsx`
- Create: `src/components/loop/beat/useBeatParamDraft.ts`
- Create: `src/components/loop/beat/useBeatParamDraft.test.tsx`

**Interfaces:**
- Produces: optional `KnobProps.onCommit(value)` and `KnobProps.onCancel()` callbacks.
- Produces: `useBeatParamDraft(committedParams, activeLoopId, commitParams)` returning draft params, update, commit, and cancel handlers.
- Consumes: Task 6 preview/restore functions.

- [ ] **Step 1: Write failing pointer and keyboard gesture tests**

Assert multiple pointer moves call `onChange` repeatedly but `onCommit` exactly once on pointerup;
pointercancel and lost capture call `onCancel` once and never commit; arrows call change then commit
once per keypress; a pointerup followed by lost capture does not emit a second terminal callback.

- [ ] **Step 2: Run Knob tests**

Run: `bun test src/components/ui/Knob.test.tsx`

Expected: FAIL because commit/cancel props do not exist.

- [ ] **Step 3: Implement a single terminal gesture path**

Track the latest dragged value in `GestureState`. `finishGesture('commit')` clears the ref before
calling callbacks; cancel/lost-capture sees the cleared ref and does nothing. Existing Knob callers
without the optional props retain current behavior.

- [ ] **Step 4: Write and implement Beat draft-hook tests**

```ts
draft.update((p) => ({ ...p, filter: { ...p.filter, cutoff: 1200 } }));
expect(previewBeatParams).toHaveBeenCalled();
expect(commitParams).not.toHaveBeenCalled();
draft.commit();
expect(commitParams).toHaveBeenCalledTimes(1);
```

Also test cancel, active-loop change cancellation, and committed-prop replacement when no gesture
is active.

- [ ] **Step 5: Run gesture tests**

Run: `bun test src/components/ui/Knob.test.tsx src/components/loop/beat/useBeatParamDraft.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Knob.tsx src/components/ui/Knob.test.tsx src/components/loop/beat/useBeatParamDraft.ts src/components/loop/beat/useBeatParamDraft.test.tsx
git commit -m "feat(ui): add commit-aware knob gestures"
```

### Task 8: Responsive Beat Sound Editor

**Files:**
- Create: `src/components/loop/beat/beatControlSchema.ts`
- Create: `src/components/loop/beat/beatControlSchema.test.ts`
- Create: `src/components/loop/beat/BeatPresetToolbar.tsx`
- Create: `src/components/loop/beat/BeatFilterPanel.tsx`
- Create: `src/components/loop/beat/BeatVoiceRow.tsx`
- Create: `src/components/loop/beat/BeatVoiceList.tsx`
- Create: `src/components/loop/beat/BeatSoundSection.tsx`
- Create: `src/components/loop/beat/BeatSoundSection.test.tsx`
- Modify: `src/components/loop/SoundView.tsx`
- Modify: `src/components/loop/SoundView.test.tsx`
- Modify: `src/components/loop/ModulePasteButton.tsx`

**Interfaces:**
- Consumes: Beat store actions, custom Beat presets, Task 6 preview, and Task 7 draft hook.
- Produces: the only Beat Sound UI and an exhaustive `BEAT_CONTROL_SCHEMA` keyed by voice.

- [ ] **Step 1: Write failing schema exhaustiveness tests**

For every voice, compare Primary plus More keys against that voice's `BeatVoices` keys except hidden
calibration (which is not a voice field). Assert no duplicate parameter key, exact unit/range/scale,
and these disclosure rules: clap/hats/toms/crash have empty More arrays; kick/snare/rimshot/ride/bell
have non-empty More arrays.

- [ ] **Step 2: Write failing responsive render tests**

Assert one Beat section, no Simple/Pro toggle, filter before voices, Kick initially expanded, separate
Preview and accordion controls, `lg:` full-row classes, base three-column knob classes, Quick Save,
Reset Voice, Reset All, and `beat-sound` paste wiring.

- [ ] **Step 3: Run UI tests**

Run: `bun test src/components/loop/beat src/components/loop/SoundView.test.tsx`

Expected: FAIL because the Beat editor does not exist.

- [ ] **Step 4: Implement the direct control schema**

Each descriptor names exactly one stored numeric key plus label, min, max, step, scale, formatter,
and Primary/More placement. Use Hz, ms/s, percent, and balance descriptors from the spec. Do not put
functions or UI metadata in `src/data/beatPresets.ts`.

- [ ] **Step 5: Implement toolbar and filter**

The selector combines factory and user presets by stable ID. Quick Save reuses the existing popover
primitive and makes the saved preset the new base. Missing bases display `Custom patch`; source-
dependent resets are disabled. Reset All never changes Beat Pattern or Mix.

- [ ] **Step 6: Implement rows and responsive disclosure**

Below `lg`, keep `openVoice: BeatVoiceId` local to `BeatVoiceList`, allow exactly one open row, and
render its controls in `grid-cols-3`. At `lg`, show every Primary row and place More underneath its
owner. Preview uses the drum playback bridge; a row reset changes only that voice. Preserve the open
voice across loop changes and Sound/Pattern hiding.

- [ ] **Step 7: Replace `DrumSoundCard` and run UI tests**

Remove the old kit/filter card from `SoundView`; mount `BeatSoundSection` whenever focus is Beat.

Run: `bun test src/components/loop/beat src/components/loop/SoundView.test.tsx src/components/loop/SequencerView.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/loop/beat/beatControlSchema.ts src/components/loop/beat/beatControlSchema.test.ts src/components/loop/beat/BeatPresetToolbar.tsx src/components/loop/beat/BeatFilterPanel.tsx src/components/loop/beat/BeatVoiceRow.tsx src/components/loop/beat/BeatVoiceList.tsx src/components/loop/beat/BeatSoundSection.tsx src/components/loop/beat/BeatSoundSection.test.tsx src/components/loop/SoundView.tsx src/components/loop/SoundView.test.tsx src/components/loop/ModulePasteButton.tsx
git commit -m "feat(sound): add responsive beat parameter editor"
```

### Task 9: Remove Legacy Canonical State and Close the Gates

**Files:**
- Create: `src/store/beatLegacyBoundary.test.ts`
- Delete: `src/store/sequencerSlice.ts`
- Delete: `src/data/drumKits.ts`
- Delete: `src/data/drumKits.test.ts`
- Delete: `src/audio/drumKits.ts`
- Delete: `src/audio/drumKits.test.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/initialState.ts`
- Modify: `src/store/loop.ts`
- Modify: `src/store/loopSlice.ts`
- Modify: `src/store/store.ts`
- Modify: `src/store/sanitize.ts`
- Modify: `src/store/projectFormat.ts`
- Modify: `src/store/projectFile.ts`
- Modify: `src/store/initialState.test.ts`
- Modify: `src/store/loop.test.ts`
- Modify: `src/store/loadLoop.test.ts`
- Modify: `src/store/fxLoopState.test.ts`
- Modify: `src/store/levelMigration.test.ts`
- Modify: `src/store/projectFile.test.ts`
- Modify: `src/store/projectFormat.test.ts`
- Modify: `src/store/projectSlice.test.ts`
- Modify: `src/store/store.test.ts`
- Modify: `src/audio/engine.render.test.ts`
- Modify: `src/audio/masterRack.test.ts`
- Modify: `src/audio/export/mixdownFixture.ts`
- Modify: `src/components/loop/SoundMixer.tsx`
- Modify: `src/components/loop/SoundMixer.test.tsx`
- Modify: `src/components/mixLayers.ts`
- Modify: `src/utils/gainUnits.ts`
- Modify: `scripts/check-drum-kit-separation.ts`
- Modify: `scripts/report-drum-diff.ts`
- Modify: `scripts/check-contrast.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: every preceding task.
- Produces: one canonical Beat model with legacy names confined to read fixtures and `readBeatState`.

- [ ] **Step 1: Add a source guard for forbidden canonical fields**

In `beatLegacyBoundary.test.ts`, walk `src/` TypeScript sources and permit `soundKit`,
`drumFilterCutoff`, `drumFilterResonance`, `drumFilterType`, `masterSequencerVolume`, `drumMuted`,
and `sequencerTracks` only inside `sanitizeBeat.ts`, `sanitizeBeat.test.ts`, and the guard test
itself. Assert
`LOOP_FLAT_KEYS` contains all three Beat keys and none of the legacy keys. Keep the test's allowlist
literal and exact so adding another compatibility reader fails review visibly.

- [ ] **Step 2: Run the guard and verify it reports remaining production references**

Run: `bun test src/store/beatLegacyBoundary.test.ts src/store/initialState.test.ts src/store/loop.test.ts`

Expected: FAIL and print each remaining production source path from the explicit scan.

- [ ] **Step 3: Delete compatibility state and old catalogs**

Remove legacy fields/actions/interfaces/defaults from live store and loop types. Keep only the raw-
input property reads inside `readBeatState`. Update the drum separation, contrast, and diff scripts
to the Beat catalog/voice roster; preserve their non-vacuous roster and parameter assertions.

- [ ] **Step 4: Update documentation and fixtures**

Update `CLAUDE.md` architecture rules to name Beat Params/Pattern/Mix, explicit output trim, direct
controls, and legacy-read-only conversion. Convert fixtures to the new shape except tests whose
subject is legacy input.

- [ ] **Step 5: Run focused regression suites**

Run: `bun test src/data/beatPresets.test.ts src/store/sanitizeBeat.test.ts src/store/beatSlice.test.ts src/store/loop.test.ts src/store/projectFile.test.ts src/store/loopCopy.test.ts src/store/vibes.test.ts src/store/engineSync.test.ts src/audio/export/renderMixdown.test.ts src/components/loop/beat`

Expected: PASS.

- [ ] **Step 6: Run repository gates**

Run: `bun run check:theme && bun run check:keys && bun run check:drums && bun run check:contrast && bun run check:levels`

Expected: every gate PASS with the full Beat roster and factory preset catalog.

Run: `bun run verify`

Expected: tests, typecheck, all custom gates, and production build PASS; the ESLint step prints no
warnings or errors.

- [ ] **Step 7: Commit**

```bash
git add src/store/beatLegacyBoundary.test.ts src/store/sequencerSlice.ts src/store/types.ts src/store/initialState.ts src/store/initialState.test.ts src/store/loop.ts src/store/loop.test.ts src/store/loopSlice.ts src/store/store.ts src/store/store.test.ts src/store/sanitize.ts src/store/projectFormat.ts src/store/projectFormat.test.ts src/store/projectFile.ts src/store/projectFile.test.ts src/store/loadLoop.test.ts src/store/fxLoopState.test.ts src/store/levelMigration.test.ts src/store/projectSlice.test.ts src/data/drumKits.ts src/data/drumKits.test.ts src/audio/drumKits.ts src/audio/drumKits.test.ts src/audio/engine.render.test.ts src/audio/masterRack.test.ts src/audio/export/mixdownFixture.ts src/components/loop/SoundMixer.tsx src/components/loop/SoundMixer.test.tsx src/components/mixLayers.ts src/utils/gainUnits.ts scripts/check-drum-kit-separation.ts scripts/report-drum-diff.ts scripts/check-contrast.ts CLAUDE.md
git commit -m "refactor(beat): remove legacy drum state"
```
