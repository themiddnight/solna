---
name: companion-patterns
description: Use this skill when extending, modifying, or managing the AI Band Companion (virtual backup musicians) rhythm engines and configuration schemas in murva — adding or adjusting bass/chord/beat generators, companion control keys, or the pattern libraries (broken/strum/beat). Triggers on requests like "add a companion drum part", "extend the broken-pattern library", "add a companion control", or "change how companions generate bass/chords". For research-grounded genre spec authoring use the archived `music-theory-companion` skill instead.
---

# Skill: Companion Patterns (Managing & Extending AI Companions)

A specialized skill for extending, modifying, and managing **AI Band Companion** (virtual backup musicians) rhythm engines and configuration schemas in murva.

---

## 1. Key Workspace File Mappings

Future AI agents and developers modifying the companion system should refer to the following codebase touchpoints:

| Scope | File Path |
|---|---|
| **Shared Types Schema** | [companion.ts](../../../shared/src/types/companion.ts) |
| **Algorithmic Note Generators** | [companion-generators.ts](../../../shared/src/constants/companion-generators.ts) |
| **Fill Library & Selector** | `shared/src/constants/companion-fills.ts` (`FILL_LIBRARY`, `selectFill`, `VOICE_NOTE`, `hashSeed`) |
| **Patterns & Defaults** | [companion-patterns.ts](../../../shared/src/constants/companion-patterns.ts) — `COMP_PATTERNS`, `applyVoicingStyle`, `generateBlockChordNotes`, `generateWaterfallNotes`, `generateTravisNotes`, `generateStrumNotes`, `STRUM_PATTERNS` |
| **Genre Presets & Profiles** | `shared/src/constants/companion-genres.ts` — `GENRE_PRESETS` (id/label/emoji/icon), `GENRE_INTENSITY_PROFILES`, `getGenreProfile`, `getGenreProgressionFlavor` |
| **Companion Settings Lock Enum** | `shared/src/validation/schemas.ts` — `COMPANION_SETTINGS_CONTROL_KEYS` Zod enum; every new per-companion control key must be added here or clients get "Invalid data format" |
| **Realtime Scheduler Clock** | [CompanionScheduler.ts](../../../app/backend/src/domains/perform-room/application/CompanionScheduler.ts) — contains the exhaustive style/broken switch; both must have a case for every new `ChordPlayingStyle`/`BrokenChordPattern` value |
| **Chord Progression Engine** | `shared/src/music/chordProgressionEngine.ts` (shared, used by BE) |
| **Shared Chord-Symbol Layer** | `shared/src/music/chordSymbol.ts` (`buildChordSymbol`, `resolveManualChordSymbol`) + `shared/src/music/chordModifiers.ts` (`ChordModifierType`) |
| **Frontend UI Settings Popup** | [CompanionSettingsPopup.tsx](../../../app/frontend/src/features/rooms/perform/components/CompanionSettingsPopup.tsx) |
| **Manual Progression Editor** | `app/frontend/src/features/rooms/perform/components/stage/ManualProgressionEditor.tsx` + `ManualProgressionEditorModal.tsx` |

> **Harmony vs voicing.** Chord identity (progression, chord length, harmonic flavor) is **room-global** state, not `CompanionConfig` — see `docs/companion/DEVELOPMENT.md` §2.5 and RULES BR-18 / TR-19. When you touch *which chord plays* (new flavor, manual-step shape, borrowed catalog), go through the **shared chord-symbol layer** so the engine and the FE labels stay in lockstep. The workflow below is for *voicing/rhythm* styles, which correctly stay per-companion.

---

## 2. Standard Workflow for Adding Musical Features

**Current style vocabulary (as of June 2026):**
- Bass: `root-only`, `root-fifth`, `walking`, `bossa`, `octave`, `pedal-eighths`, `sustained`, `arpeggio`, `anticipation`, `reggae`, `808`
- Beat grooves: `basic`, `hiphop`, `funk`, `jazz`, `reggae`, `latin`, `rock`, `dance`, `bossa`, `trap`, `shuffle`, `boom-bap` (plus timing aliases `normal`/`half-time`/`double-time`)
- Bass modifiers: `octaveJumps` (none/low/high), `anticipationAmount` (0/0.5/1), `enclosure` (boolean), `twoFeel` (boolean), `slide` (boolean — synth-engine-only portamento; sets `NoteEvent.glideMs`)
- Beat modifiers: `snareVoice` (snare/rim/clap), `hatRoll` (none/triplet/32nd), `ghostSnareDensity` (none/low/high), `percussionLayer` (none/tambourine/cowbell — gated by `drumParts.others`; claves/D#5 is reserved for `snareVoice: 'rim'` and is NOT a valid `percussionLayer` value)
- Chord `style` (ChordPlayingStyle): `block` | `broken` | `strum`
- Chord comping (`chordPlayStyle`): `block`, `charleston`, `offbeat`, `bossa`, `skank`, `syncopated-push`, `pulse`, `pop-push`, `montuno`
- Chord voicings (`voicingStyle`): `standard`, `drop2`, `rootless`, `power`, `shell`, `quartal`, `spread`
- Broken patterns (`brokenPattern`): `arpeggio`, `alberti`, `broken-octave`, `root-fifth-octave`, `oom-pah`, `stride`, `waterfall`, `travis`
- Strum patterns (`strumPattern`): `down`, `down-up`, `island`, `folk`; `strumSpeed` (ms 5–120)
- Chord modifiers: `rolledChord` (boolean — +12 ms per ascending note), `chordAnticipation` (boolean — last hit 0.5 QN earlier)
- Genres (`CompanionGenrePreset`): `pop`, `hip-hop`, `rnb`, `lofi`, `bossa-nova`, `jazz`, `rock`, `house`, `latin`

Follow this exact step-by-step workflow when adding a new companion style (e.g. `rock` or `reggae` drum groove, syncopated walking bass):

1. **Extend Type Schema**:
   * Add the new style identifier to the `BassStyle` or `BeatStyle` types inside [companion.ts](../../../shared/src/types/companion.ts).
2. **Implement Rhythmic Calculations**:
   * Open [companion-generators.ts](../../../shared/src/constants/companion-generators.ts) and add the note placement logic.
   * Ensure Hi-hat subdivisions and drum triggers scale correctly using density grids, and bass step sizes scale with `timingMultiplier`.
3. **Always Build the Shared Package**:
   * Run the build command to generate new type declaration `.d.ts` and bundle files before editing frontend or backend features:
     ```bash
     bun run --cwd shared build
     ```
4. **Integrate into UI form dropdowns**:
   * Open [CompanionSettingsPopup.tsx](../../../app/frontend/src/features/rooms/perform/components/CompanionSettingsPopup.tsx) and expose the new options in `STYLE_OPTIONS` or `TIMING_OPTIONS`.
5. **Verify with Unit and E2E Tests**:
   * Run shared tests to verify note placement mathematical calculations:
     ```bash
     bun test shared/src/constants/__tests__/companion-patterns.test.ts
     ```

---

## 2a. Chord-Specific Extension Checklist

When adding a new **chord** companion style (comping rhythm, voicing, broken pattern, strum pattern, or chord modifier):

1. **Type schema** — add to the appropriate union in `shared/src/types/companion.ts` (`ChordPlayStyle`, `VoicingStyle`, `BrokenChordPattern`, `StrumPattern`, or a new field on `CompanionConfig`).
2. **Generator** — implement in `shared/src/constants/companion-patterns.ts`:
   - New `chordPlayStyle` → add entry to `COMP_PATTERNS`.
   - New `voicingStyle` → add branch in `applyVoicingStyle`.
   - New `brokenPattern` → add a new generator function (see `generateWaterfallNotes`/`generateTravisNotes` as examples) **and** a case in the scheduler's exhaustive broken switch.
   - New `style: 'strum'` style extension (new `strumPattern`) → add to `STRUM_PATTERNS`.
3. **Shared build** — `bun run --cwd shared build`.
4. **Scheduler** — add case to the exhaustive `style`/`brokenPattern` switch in `CompanionScheduler.ts` so TypeScript's `_exhaustive: never` catch holds.
5. **Cache key** — add to `makeGeneratedNoteCacheKey` in `CompanionScheduler.ts`.
6. **Backend validator** — add to `validateCompanionUpdates` (+ any `VALID_*` sets such as `VALID_PROGRESSION_FLAVORS`) in the perform-room companion handler.
7. **`COMPANION_SETTINGS_CONTROL_KEYS` Zod enum** — add the new `controlKey` string to the array in `shared/src/validation/schemas.ts`. Missing this → "Invalid data format" on lock acquire (see memory: companion-control-validation-two-places).
8. **Genres** — update `GENRE_INTENSITY_PROFILES` in `companion-genres.ts` if any genre preset should use the new value.
9. **UI** — expose in `CompanionPresetControls.tsx` / `CompanionSettingsPopup.tsx`.
10. **Docs** — update `docs/companion/DEVELOPMENT.md` (§2.12–2.17 for chord vocabulary) and this SKILL.md vocabulary list.

**Determinism note:** `generateBlockChordNotes`, `generateWaterfallNotes`, `generateTravisNotes`, `generateStrumNotes` are all deterministic (no Math.random). `humanizeNote` (±8 ms / ±8% velocity) is applied by the scheduler unconditionally after generation, so recordings replay identically.

---

## 3. Guiding Musical Principles

* **Dynamic Metric Accents**: Use `getMetricAccentRatio` to give downbeats heavier accent velocities (e.g., 1.0 on beat 0, 0.9 on secondary downbeats, 0.75 on weak integer beats). This adds natural humanized feel to computer-generated beats.
* **Cohesive Groove Subdivision**: When a companion is set to `half-time`, double the step duration and halve the frequency. Conversely, for `double-time`, halve the duration and double the frequency. Keep bass and drum timing coordinated to produce tight backing rhythm.
* **Cache Key Integrity**: Never skip updating the cache key formula in `CompanionScheduler.ts` when adding new parameters. Forgetting this will cause parameters to be ignored by the backend caching system. `drumParts` is an example of a parameter that **must** be in the cache key — omitting it would cause stale notes to be served after a toggle.

---

## 4. Drum Kit (`drumParts`) and Fill Library

Beat-role companions support per-part enable/disable via `CompanionConfig.drumParts?: Record<DrumPart, boolean>` (7 parts: `kick`, `snare`, `toms`, `hat`, `crash`, `ride`, `others`).

**Default = minimal** (`DEFAULT_DRUM_PARTS`): `kick/snare/hat` on; `toms/ride/crash/others` off. Philosophy: companion = backup musician holding the groove; color is opt-in.

**Kit UI (Round 2):** The flat 7-chip UI is replaced by segmented role selectors in the advanced accordion. Beat/timekeeper = Hi-hat | Ride | Off (exclusive `hat`/`ride` pair); Backbeat = Snare | Toms | Off (exclusive `snare`/`toms` pair); Kick / Crash / Others remain on/off chips. This is a pure presentation layer — no schema change; every toggle still sends a full 7-key record.

**Key points when extending beat companions:**
- Call `resolveDrumParts(cc.drumParts)` before passing to generators — it fills in missing keys for legacy companions.
- Every new drum note (in `generateBeatNotes` or `CompanionScheduler`) must go through the `drum()` helper, which calls `classifyDrumPart(note)` and skips notes whose part is disabled.
- If you add a new part or note pitch, update `DRUM_PART_BY_NOTE` in `companion-generators.ts` to classify it; unclassified notes fall through to `'others'`.
- `ride` is generated in `generateBeatNotes` (per-genre pattern, 4/4 only); the steady phrase-head `crash` is generated in `CompanionScheduler.processTick` and gated by `parts.crash`.
- New drum voices added in the bass/beat pattern library: `clap` (D#2/GM39 → `snare` part), `claves` (D#5/GM75 → `snare` part, for `snareVoice: 'rim'`), `tambourine` (F#3/GM54 → `others` part), `cowbell` (G#3/GM56 → `others` part). `openhat` (A#2/GM46) was always classified but is now populated by `reggae` and `dance` grooves.
- The `percussionLayer` modifier emits `tambourine` or `cowbell` on off-beats; it is gated by `drumParts.others`. Claves (D#5) is reserved for the `snareVoice: 'rim'` backbeat and is NOT a valid `percussionLayer` value.
- Full schema, validation contract, and recording behavior: `docs/companion/DEVELOPMENT.md` §5.

**Fill library (`shared/src/constants/companion-fills.ts`):**
- `FILL_LIBRARY` — exported array of `FillPattern` objects (small 1–2 beat and large 4-beat pools).
- `selectFill({ companionId, fillIndex, style, big })` — deterministic pick via FNV-1a hash of `"companionId:fillIndex"`. Same fill bar resolves identically on every scheduler tick and on replay (recording-safe). Reduces immediate repeats (best-effort): consecutive fills usually differ — the selector skips the previous bar's raw selection; an occasional repeat (~3%) can still occur and is musically benign.
- `VOICE_NOTE: Record<DrumVoice, string>` — maps fill voices (`kick | snare | tomHigh | tomMid | tomLow | crash`) to GM note names.
- **Fills are decoupled from the Backbeat selector.** They voice from the whole kit regardless of which Backbeat option is chosen (Snare backbeat + tom fills coexist). Fills are gated only by `drumFillIntervalBars > 0`.
- The steady phrase-head crash remains gated by `parts.crash` — independent of fills.
- Valid fill interval values: `{0, 4, 8, 12, 16}` bars (`VALID_DRUM_FILL_INTERVALS`); 0 = off.

---
*For a complete walkthrough and code examples, read: [docs/companion/DEVELOPMENT.md](../../../docs/companion/DEVELOPMENT.md)*
