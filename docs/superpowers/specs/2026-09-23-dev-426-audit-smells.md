# DEV-426 — audit smells: fix / waive decision

**Approved by the user on 2026-09-23: do all 8 FIX rows; the WAIVE rows stay waived.**

Checked against `feat/dev-431-mobile-layout` @3a8a9431 (tip of the DEV-433 stack).
Sources: "Organic-growth smells" in `docs/architecture/structure/README.md`, the Deferred
section of `docs/superpowers/plans/2026-09-21-structure-audit-fixes.md`.

## Already closed by the stack — nothing to do

| id | item | closed by |
|---|---|---|
| S7 | per-loop field list written in 5+ places | DEV-424 (`LoopContent` + `LOOP_FLAT_KEYS`) |
| U7 mixdown | mixdown orchestration in `Header.tsx` | DEV-421 (export is its own feature) |
| U7 theme | theme lived in `Header.tsx` | DEV-430 (`components/header/useTheme.ts`) |
| A5 hook | React hook inside `src/audio/` | DEV-422 (`startArpClock` + wrapper, eslint ban) |
| U4/A3 | controllers mounted in grids | DEV-422 (`PlaybackHost`) |

## Proposed FIX

| id | item (today's path) | effort | risk | why |
|---|---|---|---|---|
| A8a | `engine.getByteFrequencyData` / `getByteTimeDomainData` (`src/audio/engine.ts`) have no caller — `AudioVisualizer` and `masterRack` call the analyser node directly | S | none | real dead code; Knip can't see class methods |
| A8b | `private isInitialized` in `src/audio/engine.ts` is written, never read | S | none | dead field |
| A8c | `export { KEYBOARD_NOTES } from "../ui/Keyboard"` in `src/components/loop/SoundView.tsx` — re-export with no importer | S | none | dead re-export; also removes a `../` hop |
| A8d | toast timers: `useTimedToast.ts` exists but only `InstantVibesBar` uses it; `ChordPresetLibrary`, `SynthPresetLibrary`, `synthPresetBrowser`, `useChordView` still hand-roll one | M | low | one timer implementation, each site keeps its own copy of the bug otherwise |
| D4a | `src/utils/meter.ts` is time signature, while `meterLevel`/`meterScale` are level meters | S | low | rename the time-signature one (e.g. `timeSignature.ts`); mechanical, import-only churn |
| D4b | `src/utils/musicTheory.ts` (645 lines) mixes theory and timing | M | low | split timing helpers out; the file is the one people grep first |
| A6 | `src/audio/leadMelody.ts` (548 lines) builds no audio and is imported by `store/types.ts` | M | low | move to its own home (`musicCore/` or `utils/`); it is the clearest layering smell left |
| FLAKE | `src/audio/export/renderMixdown.test.ts` "reports real render-timeline progress" asserts max step ≤ 2%; fails under parallel load (hit twice this epic) | S | none | make the assertion load-independent (assert monotonic + reaches 100, or raise the cap with a comment) — a gate that fails on a busy machine trains people to ignore it |

## Proposed WAIVE (leave, with a reason recorded)

| id | item | why waive |
|---|---|---|
| A7/U | large files: `masterRack.ts` (1384), `SortableLoopCard.tsx` (886), `PresetLibrary.tsx` (798), `useInputDeck.ts` (816) | all under the 750-line *code* cap as eslint counts it, all cohesive; splitting them is a day of churn with real regression risk and no feature asking for it. Revisit when a feature touches one. |
| D5 | duplicate preset-lookup filenames across `audio/`, `store/`, `utils/` (`beatPresets`, `presetsSlice`, `synthPresets`, `synthPresetInstall`, `presetLibrary`, `vibeSynthPresets`) | the names are already distinct per layer; a rename sweep touches many imports for a navigation nicety |
| D6-D8 | `src/types.ts` (443 lines) holds runtime code (`isSongLayer`, `layerForTab`, the `*_IDS`/`*_TABS` consts) and is the most-imported file | the runtime bits are tiny, pure and genuinely shared; moving them splits one obvious import into several. Waive unless the file grows. |
| D-imports | 507 `../` imports remain despite the `@/` rule | eslint only bans `../../`; single-`../` inside a folder is legal and readable. A blanket sweep is pure churn. |
| A8e | stale comments | no list of concrete sites left; DEV-432's doc-drift pass covers what remains |

## Notes

- Nothing here changes behaviour; every FIX row keeps `bun run verify` green and both Knip scans at zero.
- If you want a smaller cut: the S-effort rows (A8a-c, D4a, FLAKE) are half an hour and carry no risk.
