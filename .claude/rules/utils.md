---
paths:
  - "src/utils/**"
---

# Utils

How `src/utils/` is organised and what may go there. Its place in the layer map is ADR-0004.

## Grouped by topic, one theme per file

- A `utils/` file is named for one theme (`gainUnits.ts`, `stepResolution.ts`, `noteSpelling.ts`); no `helpers.ts`, `misc.ts`, `common.ts` or `utils.ts` junk drawer. <!-- R277 -->
- A file whose contents span two themes is split, on the change that next substantially edits it. Both known cases are cleared (DEV-426): timing left `musicTheory.ts` for `tempo.ts`, and the time-signature table is `timeSignature.ts`, no longer a sibling name of the level-meter files `meterLevel.ts`/`meterScale.ts`/`meterZones.ts`. <!-- R278 -->

```
✅ gainUnits.ts   stepResolution.ts   noteSpelling.ts     (the file names its theme)
❌ helpers.ts     misc.ts             audioUtils.ts       (no theme → junk drawer)
```

([ADR-0031](../../docs/decisions/0031-component-hook-store-selector-and-placement-conventions.md))

## Layering (existing rules, restated for this folder)

- `utils/` may hold music-domain helpers; it sits outside the chain above `data/`, may read `data/` at runtime, and `data/` reads it only via `import type`. <!-- R058 -->
- It may import `@/musicCore`, never the reverse. <!-- R059 -->
- Pitch, interval and chord-quality operations go through Music Core; only `src/musicCore/tonalAdapter.ts` imports `tonal`. <!-- R044 -->
- No `utils/` file reads store state, subscribes or names a slice; the only store import is the MIME-constant inversion in `localFileSave.ts` and `driveBrowser.ts`. <!-- R060 -->

([ADR-0004](../../docs/decisions/0004-utils-placement-and-store-constant-inversion.md))

## Placement

- Code used by one feature or area stays with it; code used by two or more is lifted to the shared location its layer already has. `utils/` is the shared location for helpers several layers need, not a default home for code one area uses. <!-- R276 -->
- Remaining after DEV-426 (structure audit A6/D5, waived there with a reason): lookup tables in the `src/audio/` root that build no audio (`chordProgressions.ts`, `groupByStyle.ts`), and preset lookups spread across three layers (`store/beatPresets.ts`' `beatPresetById`, `utils/synthPresets.ts`' `presetById`, `audio/chordProgressions.ts`). The lane planning that was the largest of them is now `audio/playback/leadMelody.ts`.

([ADR-0031](../../docs/decisions/0031-component-hook-store-selector-and-placement-conventions.md))

## Prohibited

- A theme-less filename (`helpers.ts`, `misc.ts`, `common.ts`, `utils.ts`) <!-- R277 -->
- Adding a second theme to an existing file instead of splitting it <!-- R278 -->
- A runtime import of `utils/` from `src/data/` <!-- R058 -->
- Importing `utils/` from `src/musicCore/` <!-- R059 -->
- Importing `tonal` from `utils/` <!-- R044 -->
- A `utils/` file that reads store state, subscribes or names a slice <!-- R060 -->
- Parking one-area code in `utils/` <!-- R276 -->
