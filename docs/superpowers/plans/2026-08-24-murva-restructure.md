# murva Codebase Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the three giant view files (ChordView 2106 / SequencerView 2004 / SynthView 1703 lines), delete dead weight, make the reverbDecay/compressorThreshold knobs actually drive the engine, and enforce the `components/ → store/ → audio/` layering with ESLint — with identical UI and identical default sound.

**Architecture:** Tidy First ordering — pure code/data moves first (genre presets, chord progression templates, dead-weight removal, store-wrapper deletion, instantVibes move), then per-view playback logic extracted into `audio/playback/*` modules each with its own hook (`useChordPlayback` / `useSequencerPlayback` / `useArpPlayback`) so the per-view clock subscriptions keep their exact timing, then engineSync rebuilt on Zustand `subscribeWithSelector`, then UI extractions (generic PresetLibrary, ChannelStrip, QuickSavePopover, Keyboard, Slider, SortableChordCard), then ESLint-enforced layering, then final metrics. Every task ends green (`bun test` + `tsc --noEmit`) and committed.

**Tech Stack:** React 18 + TypeScript 5.7 + Vite 6 + Zustand 5 (subscribeWithSelector middleware) + Tailwind 4 + Web Audio + dnd-kit + lucide-react. Tests: `bun test` (colocated `*.test.ts(x)`). Type check: `tsc --noEmit`. New devDeps in Task 17: eslint, typescript-eslint, eslint-plugin-import.

**Spec:** `docs/superpowers/specs/2026-08-24-murva-restructure-design.md`

## Global Constraints

- UI looks identical; sound at default values is identical (defaults change in Task 14 ONLY to match the engine's existing hardcodes).
- Every task ends with `bun test` AND `tsc --noEmit` green, then a commit.
- Commit style: conventional (`refactor:` / `feat:` / `fix:` / `chore:`); stage files BY NAME; message ends with the trailer `Co-Authored-By: Claude <noreply@anthropic.com>` via HEREDOC.
- Per-view clock subscriptions MUST be preserved 1:1 — pure code moves, not rewrites (except Task 10's arp parameterization, which is proven behavior-equivalent by test).
- Final layer rules (enforced by ESLint in Task 17): `audio/` never imports `store/` or `components/`; store→engine only through `engineSync`; components are dumb views (no direct `audioEngine` / `subscribeClock`); components may read `audio/data` read-only.
- Metrics: baseline recorded in Task 1, after-numbers recorded in Task 18, both in `docs/superpowers/metrics-baseline.md`.
- OUT OF SCOPE (from spec §8): drum-pattern 3-way unification (GENRE_PRESETS / instantVibes.drumPattern / GENRE_TO_KIT), FSD/feature-first rename, event bus, signals/Jotai, shadcn/Radix, barrel files, React Compiler, moving DSP to a Worker.

## File Structure Map

New files:

- `src/audio/data/genrePresets.ts` — `GENRE_PRESETS` data (pure)
- `src/audio/data/chordProgressions.ts` — `ProgressionTemplate` + `CHORD_PROGRESSION_TEMPLATES` (pure)
- `src/audio/playback/chordPlayback.ts` — chord helpers + `useChordPlayback`
- `src/audio/playback/sequencerPlayback.ts` — `playStepSounds` + `useSequencerPlayback`
- `src/audio/playback/arpPlayback.ts` — `computeArpTriggers` + `useArpPlayback`
- `src/audio/playback/drumPlayback.ts` — unified `triggerPad`
- `src/audio/playback/presetPreview.ts` — library preview engine calls (Task 15)
- `src/store/instantVibes.ts` (moved from `src/audio/instantVibes.ts`)
- `src/store/engineSync.test.ts`
- `src/components/ui/PresetLibrary.tsx`, `src/components/ui/ChannelStrip.tsx`, `src/components/ui/QuickSavePopover.tsx`, `src/components/ui/Keyboard.tsx`, `src/components/ui/Slider.tsx`
- `src/components/chord/SortableChordCard.tsx`
- `src/audio/data/genrePresets.test.ts`, `src/audio/data/chordProgressions.test.ts`, `src/audio/playback/chordPlayback.test.ts`, `src/audio/playback/arpPlayback.test.ts`
- `eslint.config.js`, `docs/superpowers/metrics-baseline.md`

Modified (heaviest first): `src/components/ChordView.tsx`, `src/components/SynthView.tsx`, `src/components/SequencerView.tsx`, `src/store/engineSync.ts`, `src/store/store.ts`, `src/store/transportSlice.ts`, `src/store/types.ts`, `src/store/synthSlice.ts`, `src/store/presetsSlice.ts`, `src/store/initialState.ts`, `src/audio/engine.ts`, `src/audio/synthPresets.ts`, `src/audio/instantVibes.ts` (→ moved), `src/utils/musicTheory.ts`, `src/types.ts`, `src/components/ChordPresetLibrary.tsx`, `src/components/SynthPresetLibrary.tsx`, `src/components/DrumPads.tsx`, `src/components/SimpleSynthPanel.tsx`, `src/components/TransportBar.tsx`, `src/components/InstantVibesBar.tsx`, `src/utils/keyboard.ts`, plus the tests.

---

### Task 1: Record baseline metrics

**Files:**
- Create: `docs/superpowers/metrics-baseline.md`

**Interfaces:**
- Consumes: nothing
- Produces: the baseline numbers that Task 18 compares against

- [ ] **Step 1: Run jscpd duplication scan**

Run: `npx --yes jscpd src --min-lines 5 2>&1 | tail -8`
Expected: a "Found X clones" summary with a duplication percentage; record the percentage. (jscpd is not in package.json — npx fetches it; this does not modify package.json.)

- [ ] **Step 2: Count total LOC**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && wc -l $(find src -type f \( -name "*.ts" -o -name "*.tsx" \)) | tail -1`
Expected: total line count (baseline is 17742 as of the plan date — record the actual number).

- [ ] **Step 3: Write the baseline file**

Create `docs/superpowers/metrics-baseline.md`:

```markdown
# murva restructure — metrics

## Baseline (recorded before Task 2, 2026-08-24)
- Duplication % (jscpd, min-lines 5): <RECORD HERE>
- Total LOC (src, .ts + .tsx): <RECORD HERE>
- files-touched-per-feature (git log): recorded in Task 18

## After (recorded in Task 18)
- Duplication %: <TBD>
- Total LOC: <TBD>
- files-touched-per-feature: <TBD>
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/metrics-baseline.md
git commit -m "$(cat <<'EOF'
chore: record pre-restructure metrics baseline

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract `GENRE_PRESETS` to `src/audio/data/genrePresets.ts`

Pure data move (SequencerView.tsx:23–1560).

**Files:**
- Create: `src/audio/data/genrePresets.ts`
- Test: `src/audio/data/genrePresets.test.ts`
- Modify: `src/components/SequencerView.tsx` (delete lines 23–1560; adjust import)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const GENRE_PRESETS: Record<string, Record<string, boolean[]>>` — the exact array/object moved verbatim from SequencerView.tsx:23–1560
- Consumed by: SequencerView `applyGenrePreset` (line ~1703), genre dropdown rendering (line ~1738 area)

- [ ] **Step 1: Create the data module**

Create `src/audio/data/genrePresets.ts`:

```ts
// Genre → instrument → 16-step boolean pattern. Moved verbatim from
// SequencerView.tsx (was lines 23–1560).
export const GENRE_PRESETS: Record<string, Record<string, boolean[]>> = {
  // <paste the ENTIRE object literal from SequencerView.tsx lines 23–1560 here, verbatim>
};
```

- [ ] **Step 2: Delete the constant from SequencerView and update the import**

In `src/components/SequencerView.tsx`: delete the entire `const GENRE_PRESETS: ... = { ... };` block (lines 23–1560). Add this import to the existing import block (alphabetically near the `../audio/...` imports):

```ts
import { GENRE_PRESETS } from "../audio/data/genrePresets";
```

- [ ] **Step 3: Write the data sanity test**

Create `src/audio/data/genrePresets.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { GENRE_PRESETS } from './genrePresets';

describe('GENRE_PRESETS data sanity', () => {
  test('every genre defines a 16-step boolean pattern for every instrument', () => {
    const genres = Object.keys(GENRE_PRESETS);
    expect(genres.length).toBeGreaterThan(0);
    for (const genre of genres) {
      const instruments = GENRE_PRESETS[genre];
      expect(Object.keys(instruments).length).toBeGreaterThan(0);
      for (const [instrument, steps] of Object.entries(instruments)) {
        expect(steps.length, `${genre}/${instrument} must be 16 steps`).toBe(16);
        expect(steps.every((v) => typeof v === 'boolean'), `${genre}/${instrument} must be booleans`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 4: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all tests pass (including the new one), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/audio/data/genrePresets.ts src/audio/data/genrePresets.test.ts src/components/SequencerView.tsx
git commit -m "$(cat <<'EOF'
refactor: extract GENRE_PRESETS into audio/data/genrePresets

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Extract `CHORD_PROGRESSION_TEMPLATES` + `ProgressionTemplate` to `src/audio/data/chordProgressions.ts`

Pure data/type move (ChordView.tsx:94–421). This breaks the import cycle ChordView ↔ ChordPresetLibrary (ChordView.tsx:83–88 imports from `./ChordPresetLibrary`, and ChordPresetLibrary.tsx:20–23 imports `ProgressionTemplate, CHORD_PROGRESSION_TEMPLATES` from `./ChordView`).

**Files:**
- Create: `src/audio/data/chordProgressions.ts`
- Test: `src/audio/data/chordProgressions.test.ts`
- Modify: `src/components/ChordView.tsx:94-421` (delete), `src/components/ChordPresetLibrary.tsx:20-23` (import change)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface ProgressionTemplate` — verbatim from ChordView.tsx:94–109 (fields: `name: string; category: <7-literal union>; roman: string; description: string; relativeChords: Array<{ interval: number; quality: string; bars: number }>`)
  - `export const CHORD_PROGRESSION_TEMPLATES: ProgressionTemplate[]` — verbatim from ChordView.tsx:111–421
- Consumed by: ChordView (line 1171 uses `CHORD_PROGRESSION_TEMPLATES.length`), ChordPresetLibrary (category filter + template list)

- [ ] **Step 1: Create the data module**

Create `src/audio/data/chordProgressions.ts`:

```ts
// Chord progression templates + their type. Moved verbatim from ChordView.tsx
// (was lines 94–421). Lives in audio/data so ChordView and ChordPresetLibrary
// can both import it without the ChordView <-> ChordPresetLibrary cycle.

export interface ProgressionTemplate {
  name: string;
  category:
    | "Pop & EDM"
    | "Jazz & Neo-Soul"
    | "Lofi & R&B"
    | "Rock & Blues"
    | "Anime & J-Pop"
    | "Cinematic & Modal"
    | "Classical & Baroque";
  roman: string;
  description: string;
  // Semitone intervals relative to the chosen key's root (0 = Key root)
  // along with chord quality for key transposition
  relativeChords: Array<{ interval: number; quality: string; bars: number }>;
}

export const CHORD_PROGRESSION_TEMPLATES: ProgressionTemplate[] = [
  // <paste the ENTIRE array literal from ChordView.tsx lines 111–421 here, verbatim>
];
```

- [ ] **Step 2: Delete from ChordView and update its imports**

In `src/components/ChordView.tsx`: delete lines 94–421 (the `ProgressionTemplate` interface and `CHORD_PROGRESSION_TEMPLATES` constant — they sit between the `SELECT_BASE`/`LABEL_BASE` constants and the first helper). Add to the import block:

```ts
import {
  ProgressionTemplate,
  CHORD_PROGRESSION_TEMPLATES,
} from "../audio/data/chordProgressions";
```

- [ ] **Step 3: Update ChordPresetLibrary import**

In `src/components/ChordPresetLibrary.tsx`, replace lines 20–23:

```ts
import {
  ProgressionTemplate,
  CHORD_PROGRESSION_TEMPLATES,
} from './ChordView';
```

with:

```ts
import {
  ProgressionTemplate,
  CHORD_PROGRESSION_TEMPLATES,
} from '../audio/data/chordProgressions';
```

- [ ] **Step 4: Write the data sanity test**

Create `src/audio/data/chordProgressions.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { CHORD_PROGRESSION_TEMPLATES } from './chordProgressions';

describe('CHORD_PROGRESSION_TEMPLATES data sanity', () => {
  test('every template has name, roman, description, and valid relativeChords', () => {
    expect(CHORD_PROGRESSION_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of CHORD_PROGRESSION_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.roman.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.relativeChords.length).toBeGreaterThan(0);
      for (const rc of t.relativeChords) {
        expect(rc.interval).toBeGreaterThanOrEqual(0);
        expect(rc.interval).toBeLessThan(12);
        expect(rc.bars).toBeGreaterThan(0);
        expect(typeof rc.quality).toBe('string');
      }
    }
  });
});
```

- [ ] **Step 5: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green (ChordView.test's `CHORD_PROGRESSION_TEMPLATES`-based tests, if any, still pass via the re-exported location).

- [ ] **Step 6: Commit**

```bash
git add src/audio/data/chordProgressions.ts src/audio/data/chordProgressions.test.ts src/components/ChordView.tsx src/components/ChordPresetLibrary.tsx
git commit -m "$(cat <<'EOF'
refactor: extract chord progression templates into audio/data

Breaks the ChordView <-> ChordPresetLibrary import cycle.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dead-weight removal — types, actions, utils (part 1)

All symbols below were verified to have no live readers (grep across `src/`); every removal chain below ends green in one task.

**Files:**
- Modify: `src/types.ts` (dead fields), `src/store/types.ts` (`applySynthPreset`), `src/store/synthSlice.ts:21-23`, `src/store/store.ts:140-143`, `src/utils/musicTheory.ts:112-122,277-279`, `src/utils/musicTheory.test.ts:37-53`, `src/components/ChordView.tsx:72`, `src/audio/instantVibes.ts` (6 lines), `src/store/store.test.ts:436`
- Test: `src/utils/musicTheory.test.ts`, `src/store/store.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: no new exports; removes `applySynthPreset`, `quarterNoteMs`, `isChordDiatonic`, `portamento`, `solo`, `velocities`, `delayTime`, `distortionDrive`, `chorusRate`, `chorusDepth`, `chorusWet`, `compressorRatio`, `compressorBypass` from their files
- Note: `delayTime` in `src/audio/engine.test.ts:420` (`n.delayTime = fakeParam()`) is the Web Audio `DelayNode.delayTime` AudioParam, NOT the `MasterEffects` field — leave it. `engine.ts:250` (`this.delayNode.delayTime.value = 0.25`) is the same — leave it.

- [ ] **Step 1: Remove dead fields from `src/types.ts`**

Delete exactly these lines from `MasterEffects` / `SynthParams` / `SequencerTrack` (keep everything else, including `reverbDecay`, `compressorThreshold`, `reverbBypass`, `delayBypass`, `distortionBypass`, `eqBypass`):
- `portamento?: number;` (SynthParams, line 30)
- `solo?: boolean;` (SequencerTrack, line 56)
- `velocities?: number[];` (SequencerTrack, line 58)
- `delayTime: string;` (MasterEffects, line 85)
- `distortionDrive?: number;` (line 88)
- `chorusRate?: number;` (line 91), `chorusDepth?: number;` (line 92), `chorusWet?: number;` (line 93)
- `compressorRatio?: number;` (line 99), `compressorBypass?: boolean;` (line 100)

- [ ] **Step 2: Remove `applySynthPreset`**

- `src/store/types.ts:44` — delete the `applySynthPreset: (preset: Partial<SynthParams>) => void;` line from `SynthSlice`.
- `src/store/synthSlice.ts:21-23` — delete the `applySynthPreset` action (the comment line above it too: `// Mirrors handleApplySynthPreset in App.tsx (shallow merge into synthParams).`).
- `src/store/store.test.ts:436` — delete the `'applySynthPreset',` line from the `excludedKeys` array.

- [ ] **Step 3: Remove the `portamento` special case from sanitize**

In `src/store/store.ts`, delete lines 140–143 (the comment `// \`portamento\` is optional, so it has no factory default to key off above.` and the two `if (typeof raw.portamento ...` lines).

- [ ] **Step 4: Inline `quarterNoteMs` into `sixteenthNoteMs`**

In `src/utils/musicTheory.ts`:
- Delete `quarterNoteMs` (lines 277–279).
- Replace `sixteenthNoteMs` (lines 286–288) with:

```ts
export function sixteenthNoteMs(bpm: number): number {
  return ((60 / Math.max(1, bpm)) * 1000) / 4;
}
```

(That is exactly `quarterNoteMs(bpm) / 4` with quarterNoteMs's body inlined — verified identical.)
- In `src/components/ChordView.tsx:72`, remove `quarterNoteMs,` from the `../utils/musicTheory` import (verified: the only occurrence in the file).

- [ ] **Step 5: Inline `isChordDiatonic` into `getBorrowedChords`**

In `src/utils/musicTheory.ts`:
- Delete the `isChordDiatonic` function (lines 112–122).
- In `getBorrowedChords`, replace the filter (currently around line 215):

```ts
  // Borrowed chords must stay chromatic: drop anything the active scale
  // already contains (strictly diatonic) or that the in-scale palette
  // renders with the same root and quality.
  const isDiatonic = (chordRoot: string, quality: string): boolean => {
    const notes = generateBlockChordNotes(quality, chordRoot);
    return notes.length > 0 && notes.every((n) => isNoteInScale(n, root, scaleType));
  };
  return candidates.filter(
    (c) => !isDiatonic(c.root, c.quality) && !isInScalePaletteChord(c.root, c.quality, root, scaleType),
  );
```

(Behavior identical: `isChordDiatonic`'s body was exactly `generateBlockChordNotes(...).every(isNoteInScale)`.)

- [ ] **Step 6: Delete the `isChordDiatonic` test block**

In `src/utils/musicTheory.test.ts`, delete the entire `describe('isChordDiatonic', ...)` block (lines 37–53: the describe line, its four `test(...)` calls, and the closing `});`) and remove `isChordDiatonic,` from the import at line 9.

- [ ] **Step 7: Remove the 6 `delayTime` lines from `src/audio/instantVibes.ts`**

Delete exactly these lines (each is a `delayTime: '8n'` / `'16n'` / `'4n'` entry inside a vibe's `effects` object): 234, 347, 454, 557, 663, 763. Also delete `delayTime: '8n',` from `INITIAL_EFFECTS` in `src/store/initialState.ts:92` (an excess-property error otherwise). `tsc` will confirm no other `MasterEffects`-typed object sets `delayTime`.

- [ ] **Step 8: Verify**

Run: `bun test && tsc --noEmit`
Expected: all green. If tsc flags any residual reference to a removed symbol, delete that reference too (grep first: `grep -rn "quarterNoteMs\|isChordDiatonic\|delayTime\|portamento\|chorusRate\|compressorRatio\|applySynthPreset" src/` should only show the engine.test.ts / engine.ts DelayNode hits for delayTime).

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store/types.ts src/store/synthSlice.ts src/store/store.ts src/store/store.test.ts src/utils/musicTheory.ts src/utils/musicTheory.test.ts src/components/ChordView.tsx src/audio/instantVibes.ts src/store/initialState.ts
git commit -m "$(cat <<'EOF'
refactor: remove dead synth/effects/track fields and unused helpers

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Dead-weight removal — UI level + sanitize strip list (part 2)

**Files:**
- Modify: `src/components/DrumPads.tsx:7-16,45`, `src/components/ChordView.tsx:1300-1302`, `src/components/SequencerView.tsx`, `src/components/SynthView.tsx`, `src/store/store.ts` (`sanitizePersistedState`)
- Test: `src/store/store.test.ts` (existing hydrate tests must stay green)

**Interfaces:**
- Consumes: nothing (Task 4's field removals)
- Produces: `sanitizePersistedState` now strips the removed effect fields on rehydrate; `DrumPads` no longer exports `DEFAULT_PADS`

- [ ] **Step 1: Remove `DEFAULT_PADS` state + dead `groups` useMemo from DrumPads**

In `src/components/DrumPads.tsx`:
- Rename `DEFAULT_PADS` to a module-level constant and drop the state wrapper — replace lines 7–20:

```ts
const PADS: DrumPad[] = [
  // <paste the 8 pad entries from lines 7–16 verbatim>
];

export const DrumPads: React.FC = React.memo(() => {
  const [activePadId, setActivePadId] = useState<string | null>(null);
```

- Delete line 45 (`const groups = useMemo(...)` — verified unused: the grid renders `pads.map` directly).
- Remove `useMemo` from the React import at line 1 if no other usage remains (grep the file).
- Replace the two `pads` state references (`pads.find`, `pads.map`) — they now read the module constant; delete `useState<DrumPad[]>(DEFAULT_PADS)`.

- [ ] **Step 2: Delete the dead comments in ChordView**

In `src/components/ChordView.tsx`, delete the two comment blocks at lines 1300–1302:

```tsx
      {/* Visual Scale Degrees Strip (DELETED) */}

      {/* Quick Access Top Progression Presets Strip (DELETED) */}
```

- [ ] **Step 3: Prune unused lucide imports**

`tsc` does not flag unused imports (no `noUnusedLocals`), so check by grep. For each icon name in the lucide import block of `ChordView.tsx` (lines 7–19), `SynthView.tsx` (lines 7–17), and `SequencerView.tsx` (lines 4–16), run `grep -c "<IconName" <file>` (plus the raw name for non-JSX usage); delete import entries with zero occurrences. Known-zero candidates to verify first: `Music`, `ArrowRight`, `GripVertical`, `ChevronLeft`, `ChevronRight`, `Square` in ChordView; `Zap`, `Sliders` in SynthView; `Grid`, `RotateCcw` in SequencerView. Remove each confirmed-unused name from the import list (keep the ones that match).

- [ ] **Step 4: Strip removed effect fields in `sanitizePersistedState`**

In `src/store/store.ts`, inside `sanitizePersistedState`, right after the `sanitized.effects = ...` assignment (currently lines 177–184), add:

```ts
  // Fields removed from MasterEffects (Task 4) must not resurrect from old
  // persisted payloads.
  const fx = sanitized.effects as Record<string, unknown> | undefined;
  if (fx && typeof fx === 'object') {
    for (const key of ['chorusRate', 'chorusDepth', 'chorusWet', 'compressorRatio', 'compressorBypass', 'delayTime', 'distortionDrive']) {
      delete fx[key];
    }
  }
```

- [ ] **Step 5: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green — the existing store.test hydrate/migration tests prove the sanitize change is safe (deleting absent keys from the default `INITIAL_EFFECTS` is a no-op).

- [ ] **Step 6: Commit**

```bash
git add src/components/DrumPads.tsx src/components/ChordView.tsx src/components/SequencerView.tsx src/components/SynthView.tsx src/store/store.ts
git commit -m "$(cat <<'EOF'
refactor: drop dead pad state, dead comments, and strip removed effect fields

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Delete store-wrapper layers in `audio/synthPresets.ts` and `ChordPresetLibrary.tsx`

Removes the last `audio/` → `store/` imports and the `store`-reaching wrapper functions. Verified callers: only components + `synthPresets.test.ts`.

**Files:**
- Modify: `src/audio/synthPresets.ts:2,734-756`, `src/components/ChordPresetLibrary.tsx:29-47`, `src/store/presetsSlice.ts:39-46`, `src/store/types.ts:118`, `src/components/ChordView.tsx:47,85-88,635,951,959`, `src/components/SynthView.tsx:33-34,153,495`, `src/components/SynthPresetLibrary.tsx:24-25,39,96,113,155`, `src/audio/synthPresets.test.ts`, `src/store/store.test.ts:444`
- Test: `src/audio/synthPresets.test.ts`

**Interfaces:**
- Consumes: Task 4 (types clean)
- Produces: `audio/synthPresets.ts` no longer exports `getCustomPresets`, `saveCustomPreset`, `updateCustomPreset`, `deleteCustomPreset`; `ChordPresetLibrary.tsx` no longer exports `getCustomChordProgressions`, `saveCustomChordProgression`, `deleteCustomChordProgression`; store actions `saveCustomPreset`, `deleteCustomPreset`, `saveCustomChordProgression`, `deleteCustomChordProgression` (same signatures as in `src/store/types.ts`) are now called directly by components
- Consumed by: Task 15 (the libraries become thin generic wrappers)

- [ ] **Step 1: Delete the wrappers and the store import from `src/audio/synthPresets.ts`**

- Delete line 2 (`import { useAppStore } from '../store/store';`) — verify no other `useAppStore` usage remains in the file after this step.
- Delete lines 734–756 (`getCustomPresets`, `saveCustomPreset`, `updateCustomPreset`, `deleteCustomPreset`). Keep `ALL_FACTORY_PRESETS` (758) and everything after it.

- [ ] **Step 2: Delete `updateCustomPreset` from the store**

- `src/store/presetsSlice.ts:39-46` — delete the `updateCustomPreset` action.
- `src/store/types.ts:118` — delete the `updateCustomPreset: (id: string, updates: Partial<SynthPresetItem>) => SynthPresetItem[];` line from `PresetsSlice`.
- `src/store/store.test.ts:444` — delete the `'updateCustomPreset',` line from `excludedKeys`.

- [ ] **Step 3: Delete the chord wrappers from `ChordPresetLibrary.tsx`**

Delete lines 29–47 (`getCustomChordProgressions`, `saveCustomChordProgression`, `deleteCustomChordProgression`). Keep the `export type { CustomChordProgressionItem };` re-export at line 27 (still used by ChordView — see Step 5). Also verify the file's `useAppStore` import is still used by the component itself (it selects `customChordProgressions` — keep the import).

- [ ] **Step 4: Rewrite the wrapper tests in `src/audio/synthPresets.test.ts`**

- From the import block: remove `getCustomPresets, saveCustomPreset, updateCustomPreset, deleteCustomPreset` from the `./synthPresets` import (lines 8–12), and remove the three imports from `'../components/ChordPresetLibrary'` (lines 18–22).
- Replace the whole `describe('custom preset helpers (store-backed wrappers)', ...)` block (lines 88–126) — the `getCustomPresets` and `saveCustomPreset` tests plus the `updateCustomPreset` case — with:

```ts
describe('custom preset store actions', () => {
  test('saveCustomPreset writes through the store and strips the preset label', () => {
    const saved = useAppStore.getState().saveCustomPreset('My Patch', INITIAL_SYNTH_PARAMS, 'Lead');
    expect(saved.name).toBe('My Patch');
    expect(saved.params.preset).toBeUndefined();
    expect(useAppStore.getState().customSynthPresets[0].id).toBe(saved.id);
  });

  test('deleteCustomPreset removes the preset and returns the new list', () => {
    const saved = useAppStore.getState().saveCustomPreset('My Patch', INITIAL_SYNTH_PARAMS);
    expect(useAppStore.getState().deleteCustomPreset(saved.id)).toEqual([]);
    expect(useAppStore.getState().customSynthPresets).toEqual([]);
  });
});
```

- Replace the whole `describe('custom chord progression helpers (store-backed wrappers)', ...)` block (lines 128–178) — keep every test but route through the store. Concretely: `getCustomChordProgressions()` → `useAppStore.getState().customChordProgressions`, `saveCustomChordProgression(name, chords, cat, desc, roman)` → `useAppStore.getState().saveCustomChordProgression(name, chords, cat, desc, roman)`, `deleteCustomChordProgression(id)` → `useAppStore.getState().deleteCustomChordProgression(id)`.

- [ ] **Step 5: Update ChordView call sites**

In `src/components/ChordView.tsx`:
- Line 47: remove `getCustomPresets,` from the `../audio/synthPresets` import.
- Line 635: replace `const customPresets = getCustomPresets();` with `const customPresets = useAppStore((s) => s.customSynthPresets);`.
- Lines 85–88: replace the `./ChordPresetLibrary` import block with `import { ChordPresetLibrary } from "./ChordPresetLibrary";` and add `CustomChordProgressionItem` to the `../types` import at line 42.
- Line 951 (`const saved = saveCustomChordProgression(...)`): replace with `const saved = useAppStore.getState().saveCustomChordProgression(...)` (same arguments).
- Line 959 (`setCustomProgressions(getCustomChordProgressions())`): replace with `setCustomProgressions(useAppStore.getState().customChordProgressions)`.

- [ ] **Step 6: Update SynthView + SynthPresetLibrary call sites**

`src/components/SynthView.tsx`:
- Lines 33–34: remove `getCustomPresets,` and `saveCustomPreset,` from the `../audio/synthPresets` import.
- Line 153: replace `setCustomPresets(getCustomPresets());` with `setCustomPresets(useAppStore.getState().customSynthPresets);`.
- Line 495: replace `const saved = saveCustomPreset(quickSaveName, params, quickSaveCategory);` with `const saved = useAppStore.getState().saveCustomPreset(quickSaveName, params, quickSaveCategory);`.

`src/components/SynthPresetLibrary.tsx`:
- Lines 24–25: remove `saveCustomPreset,` and `deleteCustomPreset,` from the `../audio/synthPresets` import.
- After the existing `const customPresets = useAppStore((s) => s.customSynthPresets);` (line 39), add:
  `const savePreset = useAppStore((s) => s.saveCustomPreset);` and `const deletePreset = useAppStore((s) => s.deleteCustomPreset);`
- Line 96: `saveCustomPreset(...)` → `savePreset(...)`; line 113: `deleteCustomPreset(id)` → `deletePreset(id)`; line 155: `saveCustomPreset(...)` → `savePreset(...)`.

- [ ] **Step 7: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green. Then confirm no `audio/` file imports `store/` anymore:

Run: `grep -rn "from '../store" src/audio/`
Expected: no matches (only `src/store/instantVibes.ts` — moved in Task 7 — will still not exist yet).

- [ ] **Step 8: Commit**

```bash
git add src/audio/synthPresets.ts src/audio/synthPresets.test.ts src/components/ChordPresetLibrary.tsx src/components/ChordView.tsx src/components/SynthView.tsx src/components/SynthPresetLibrary.tsx src/store/presetsSlice.ts src/store/types.ts src/store/store.test.ts
git commit -m "$(cat <<'EOF'
refactor: drop store-wrapper layers, call presets slice directly

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Move `instantVibes.ts` to `store/` with setters only

**Files:**
- Modify (move): `src/audio/instantVibes.ts` → `src/store/instantVibes.ts`
- Modify (move): `src/audio/instantVibes.test.ts` → `src/store/instantVibes.test.ts`
- Modify: `src/components/InstantVibesBar.tsx:3`, `src/components/InstantVibesBar.test.tsx:2`, `src/store/engineSync.ts` (`applyEngineSnapshot` → full snapshot)
- Test: `src/store/instantVibes.test.ts`, `src/store/engineSync.test.ts` is added in Task 12 — until then the extended snapshot is covered by the existing store tests + manual reasoning

**Interfaces:**
- Consumes: Task 4 (delayTime lines already gone), Task 6 (store import layering clean)
- Produces:
  - `src/store/instantVibes.ts` exports (same names as before): `interface InstantVibe`, `export function applyInstantVibeToStore(vibe: InstantVibe): void` (setters only — NO engine calls), `export const INSTANT_VIBES: InstantVibe[]`
  - `applyEngineSnapshot(): void` now pushes the FULL audio-relevant snapshot into the engine (13 setters)
- Consumed by: InstantVibesBar, InstantVibesBar.test, instantVibes.test

- [ ] **Step 1: Move the file and strip engine calls**

Create `src/store/instantVibes.ts` from `src/audio/instantVibes.ts`:
- Move the entire file verbatim, except:
  - Delete the `import { audioEngine } from './engine';` line (was line 4).
  - In `applyInstantVibeToStore`, delete the whole section 7 (was lines 117–131): the comment `// 7. Audio Engine initialization & clock sync (in browser environment)` and the `if (typeof window !== 'undefined') { ... }` block.
  - Fix the relative imports: `'../types'` stays (store/ → src/types via `../types`), `'../utils/musicTheory'` stays, `'../store/store'` → `'./store'`, `'../store/initialState'` → `'./initialState'`.
- Delete `src/audio/instantVibes.ts`.

Why this is behavior-preserving: the vibe's state changes now flow through engineSync's subscriptions (which fire on every state change; pre-init they no-op like today), and the engine is initialized by the app's first-click handler (App.tsx:66) which runs after React handlers in the same click; `applyEngineSnapshot` (Step 2) re-applies everything post-init. Today `applyInstantVibeToStore` called `audioEngine.init()` itself — the first click is exactly the user gesture that starts the engine.

- [ ] **Step 2: Extend `applyEngineSnapshot` to the full snapshot**

In `src/store/engineSync.ts`, replace the `applyEngineSnapshot` body (lines 74–78) with:

```ts
/**
 * Push the full persisted audio-relevant snapshot into the engine. Called once
 * from the app's first-user-interaction handler, right after `audioEngine.init()`:
 * every engine setter below is a no-op before the AudioContext exists
 * (engine.ts guards on this.ctx), so the values hydrated from storage or set
 * by pre-init actions (e.g. instant vibes) must be re-applied once the engine
 * is live. Live changes keep flowing through the engineSync subscriptions —
 * this only covers the one-shot post-init gap.
 */
export function applyEngineSnapshot(): void {
  const s = useAppStore.getState();
  audioEngine.setClockBpm(s.bpm);
  audioEngine.setMasterVolume(s.masterVolume);
  audioEngine.setMetronomeEnabled(s.metronomeActive);
  audioEngine.setSourceGain('chord', s.chordVolume);
  audioEngine.setSourceGain('bass', s.bassVolume);
  audioEngine.setSourceMuted('chord', s.chordMuted);
  audioEngine.setSourceMuted('bass', s.bassMuted);
  audioEngine.setDrumKit(DRUM_KITS[s.soundKit]);
  audioEngine.setDrumFilter(s.drumFilterCutoff, s.drumFilterResonance, s.drumFilterType);
  audioEngine.updateEffects(s.effects);
  audioEngine.updateSynthParams(s.synthParams, 'synth');
  audioEngine.updateSynthParams(s.chordSynthParams, 'chord');
  audioEngine.updateSynthParams(s.bassSynthParams, 'bass');
}
```

(`DRUM_KITS` is already imported in engineSync.ts.)

- [ ] **Step 3: Move the test file and update importers**

- Move `src/audio/instantVibes.test.ts` → `src/store/instantVibes.test.ts`; its relative import `from './instantVibes'` still resolves.
- `src/components/InstantVibesBar.tsx:3`: `from '../audio/instantVibes'` → `from '../store/instantVibes'`.
- `src/components/InstantVibesBar.test.tsx:2`: same change.

- [ ] **Step 4: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green (the moved test still passes — it asserts store state, which is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/store/instantVibes.ts src/store/instantVibes.test.ts src/audio/instantVibes.ts src/audio/instantVibes.test.ts src/components/InstantVibesBar.tsx src/components/InstantVibesBar.test.tsx src/store/engineSync.ts
git commit -m "$(cat <<'EOF'
refactor: move instantVibes to store/, drop engine calls from it

Engine state now re-applies through the full post-init engine snapshot.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extract chord playback into `src/audio/playback/chordPlayback.ts` + `useChordPlayback`

Pure move of the chord scheduling helpers and the master playback loop from `ChordView.tsx`. The clock subscription, the `armedRef`/`chordIndexRef`/`nextBarStepRef`/`playFnsRef` machinery, and both `useCallback` closures move VERBATIM — only their home changes. `audioEngine` references move out of the view.

**Files:**
- Create: `src/audio/playback/chordPlayback.ts`
- Test: `src/audio/playback/chordPlayback.test.ts` (helper tests moved from ChordView.test.tsx)
- Modify: `src/components/ChordView.tsx` (delete moved ranges; wire the hook), `src/components/ChordView.test.tsx` (move helper-test imports)

**Interfaces:**
- Consumes: Task 3 (data modules), Task 6 (store wrappers gone)
- Produces (all in `src/audio/playback/chordPlayback.ts`):
  - `export interface BarInvariantEvent { noteName: string; velocity: number; timeOffset: number; hold: number; lastBarOnly?: boolean }` (moved verbatim from ChordView; it currently sits just above `const SELECT_BASE`, ~line 84)
  - `export type PreviewEngine = Pick<typeof audioEngine, "triggerSynthNoteOn" | "triggerSynthNoteOff" | "stopSource">`
  - `export function buildChordEvents(pattern: RhythmPattern, notes: string[], stepDur: number, holdScale: number): BarInvariantEvent[]` — verbatim from ChordView 432–461
  - `export function playFullHoldChord(notes: string[], params: SynthParams, startTime: number, holdSec: number): void` — verbatim from 464–485
  - `export function scheduleBarInvariantEvents(events: BarInvariantEvent[], params: SynthParams, source: string, startTime: number, barDur: number, totalBars: number): void` — verbatim from 488–520
  - `export function playChordLegato(chord: ChordItem, params: SynthParams, engine: PreviewEngine): void` — verbatim from 534–549
  - `export function startPatternLoop(play: (time: number) => void, barSeconds: number, getNow: () => number): () => void` — verbatim from 554–571
  - `export function previewChordForScale(scaleRoot: string, scaleType: string, octave?: number): ChordItem` — verbatim from 575–591
  - `export function previewBarSeconds(bpm: number): number` — verbatim from 594–596
  - `export function useChordPlayback(): { playChordWithRhythm: (chord: ChordItem, startTime: number, pattern: RhythmPattern) => void; playBassWithPattern: (chord: ChordItem, startTime: number, pattern: BassPattern, chordContext?: ChordItem[]) => void; playingIndex: number | null; setPlayingIndex: (i: number | null) => void; activeChordId: string | null; setActiveChordId: (id: string | null) => void }`
- Consumed by: ChordView (call sites 1104, 1139 keep calling `playChordWithRhythm` / `playBassWithPattern`, now destructured from the hook), ChordView.test → chordPlayback.test

- [ ] **Step 1: Create `src/audio/playback/chordPlayback.ts` with the 7 stateless helpers**

Create the file. Imports:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine, STEPS_PER_BAR } from '../engine';
import { equalPowerVelocityScale, feelToHoldScale, fullHoldDuration } from '../rhythmPatterns';
import type { RhythmPattern } from '../rhythmPatterns';
import { isApproachToken, resolveBassSteps } from '../bassPatterns';
import type { BassPattern } from '../bassPatterns';
import { deriveChordNotes, generateBlockChordNotes, getDiatonicChordForDegree, shiftNoteOctave, sixteenthNoteMs } from '../../utils/musicTheory';
import { useAppStore } from '../../store/store';
import type { ChordItem, SynthParams } from '../../types';
```

Then paste, in this order and verbatim (same bodies, same comments):
1. `interface BarInvariantEvent` + `export type PreviewEngine` (ChordView ~84–93 and 524–528)
2. `buildChordEvents` (432–461)
3. `playFullHoldChord` (464–485)
4. `scheduleBarInvariantEvents` (488–520)
5. `playChordLegato` (534–549)
6. `startPatternLoop` (554–571)
7. `previewChordForScale` (575–591)
8. `previewBarSeconds` (594–596)

- [ ] **Step 2: Add `playChordWithRhythm`, `playBassWithPattern`, and the hook**

Append to the same file, verbatim from ChordView (deps arrays identical):

```ts
// --- Master playback loop (moved from ChordView 645-773, 832-870) ---

function useChordPlaybackState() {
  const chords = useAppStore((s) => s.chords);
  const bpm = useAppStore((s) => s.bpm);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const isPlaying = useAppStore((s) => s.isChordsPlaying);
  return { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, rhythmId, bassPatternId, isPlaying };
}
```

Then `playChordWithRhythm` and `playBassWithPattern` exactly as they are in ChordView 645–685 and 687–773 (same bodies, same `useCallback` deps), with these substitutions:
- Inside `playChordWithRhythm` and `playBassWithPattern`, `chords`, `bpm`, `chordSynthParams`, `chordOctave`, `chordFeel`, `bassSynthParams`, `bassOctave`, `scaleRoot`, `scaleType` come from `useChordPlaybackState()` (they were closure variables before — the closure content is identical).

Then the hook (ChordView 832–870 verbatim, same refs, same effect deps):

```ts
export function useChordPlayback() {
  const state = useChordPlaybackState();
  const { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, rhythmId, bassPatternId, isPlaying } = state;

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);

  const rhythmPattern = RHYTHM_PATTERNS.find((p) => p.id === rhythmId) ?? RHYTHM_PATTERNS[0];
  const bassPattern = BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];

  const playChordWithRhythm = useCallback(
    (chord: ChordItem, startTime: number, pattern: RhythmPattern) => {
      // <body verbatim from ChordView 645-685, using the closure values above>
    },
    [bpm, chordSynthParams, chordOctave, chordFeel],
  );

  const playBassWithPattern = useCallback(
    (chord: ChordItem, startTime: number, pattern: BassPattern, chordContext?: ChordItem[]) => {
      // <body verbatim from ChordView 687-773, using the closure values above>
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams, bassFeel],
  );

  const armedRef = useRef(false);
  const chordIndexRef = useRef(0);
  const nextBarStepRef = useRef(0);

  const playFnsRef = useRef({ playChordWithRhythm, playBassWithPattern });
  useEffect(() => {
    playFnsRef.current = { playChordWithRhythm, playBassWithPattern };
  });

  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      armedRef.current = false;
      setPlayingIndex(null);
      setActiveChordId(null);
      return;
    }

    return audioEngine.subscribeClock((step, _beat, time) => {
      // <body verbatim from ChordView 853-869: armedRef bar-alignment, chordIndexRef
      //   advance, playFnsRef.current.playChordWithRhythm / playBassWithPattern,
      //   setPlayingIndex, setActiveChordId, nextBarStepRef>
    });
  }, [isPlaying, chords, rhythmPattern, bassPattern]);

  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId };
}
```

Add the imports the bodies need: `import { RHYTHM_PATTERNS } from '../rhythmPatterns';` and `import { BASS_PATTERNS } from '../bassPatterns';`. (ChordView currently computes `rhythmPattern`/`bassPattern` with the same find-else-first logic — moving it into the hook is identical.)

- [ ] **Step 3: Remove the moved code from ChordView and wire the hook**

In `src/components/ChordView.tsx`:
- Delete: `BarInvariantEvent` + `PreviewEngine` type block (~84–93, 522–528), `buildChordEvents` (432–461), `playFullHoldChord` (464–485), `scheduleBarInvariantEvents` (488–520), `playChordLegato` (534–549), `startPatternLoop` (554–571), `previewChordForScale` (575–591), `previewBarSeconds` (594–596), `playChordWithRhythm` (645–685), `playBassWithPattern` (687–773), the `armedRef`/`chordIndexRef`/`nextBarStepRef`/`playFnsRef` + the `rhythmPattern`/`bassPattern` useMemos + the clock subscription effect (820–870 — keep `handleChordVolumeChange`/`handleBassVolumeChange` at 825–831).
- Replace the local state lines 632–633:
  ```ts
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  ```
  with:
  ```ts
  const { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId } = useChordPlayback();
  ```
- Add to imports: `import { useChordPlayback } from "../audio/playback/chordPlayback";`
- Remove now-unused imports (verify by grep): `useCallback`, `useRef` (if unused after), `audioEngine, STEPS_PER_BAR` (keep `STEPS_PER_BAR` only if still used elsewhere in the view — grep it; the preview handlers at 1104/1139 call `previewBarSeconds`/`startPatternLoop`-adjacent code which stays view-side), `equalPowerVelocityScale, feelToHoldScale, fullHoldDuration` from rhythmPatterns (the view's `handleChordPatternPreviewMouseDown/Up` may still use `startPatternLoop` + `previewBarSeconds` + `previewChordForScale` — those now come from the new module; keep whichever identifiers the remaining view code still references), `isApproachToken, resolveBassSteps` from bassPatterns, `deriveChordNotes, getDiatonicChordForDegree, shiftNoteOctave` from musicTheory, `RHYTHM_PATTERNS`/`BASS_PATTERNS` (if the view no longer computes them).
- The preview handlers (around 1104 and 1139) keep their bodies; they now resolve `playChordWithRhythm` / `playBassWithPattern` from the hook's return, and any `startPatternLoop` / `previewChordForScale` / `previewBarSeconds` calls now come from the new module import.

- [ ] **Step 4: Move the helper tests to `src/audio/playback/chordPlayback.test.ts`**

- Create `src/audio/playback/chordPlayback.test.ts`. Move into it: the `SYNTH` fixture, the imports (`buildChordEvents, playChordLegato, playFullHoldChord, scheduleBarInvariantEvents, startPatternLoop, previewChordForScale, previewBarSeconds`, `equalPowerVelocityScale`, `RhythmPattern`, `ChordItem`, `SynthParams` — paths adjusted to `'../../..'`), and EVERY describe block that tests one of the 7 helpers from `ChordView.test.tsx` (locate them by searching ChordView.test.tsx for each helper name; move those describes verbatim).
- In `src/components/ChordView.test.tsx`: delete the moved describes and their imports (keep `ChordView` + `renderToString` + the render test; keep `audioEngine` import ONLY if the remaining render test still spies on it — if not, drop it).

- [ ] **Step 5: Verify**

Run: `bun test && tsc --noEmit`
Expected: all green. The moved helper tests passing proves the code moved intact; ChordView.test render test proves the view still composes.

- [ ] **Step 6: Commit**

```bash
git add src/audio/playback/chordPlayback.ts src/audio/playback/chordPlayback.test.ts src/components/ChordView.tsx src/components/ChordView.test.tsx
git commit -m "$(cat <<'EOF'
refactor: move chord playback logic into audio/playback with useChordPlayback

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Extract sequencer playback into `src/audio/playback/sequencerPlayback.ts` + `useSequencerPlayback`

Pure move (SequencerView 1592–1650 minus the setDrumFilter effect at 1584–1590, which stays for now and is removed in Task 12).

**Files:**
- Create: `src/audio/playback/sequencerPlayback.ts`
- Modify: `src/components/SequencerView.tsx:1592-1650` (delete, wire hook)

**Interfaces:**
- Consumes: nothing new
- Produces (in `src/audio/playback/sequencerPlayback.ts`):
  - `export function useSequencerPlayback(): { currentStep: number; setCurrentStep: (step: number) => void }`
- Consumed by: SequencerView (highlight logic at 1891/1973 reads `currentStep`)

- [ ] **Step 1: Create the module**

Create `src/audio/playback/sequencerPlayback.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '../engine';
import { sixteenthNoteMs } from '../../utils/musicTheory';
import { useAppStore } from '../../store/store';

export function useSequencerPlayback(): { currentStep: number; setCurrentStep: (step: number) => void } {
  const tracks = useAppStore((s) => s.sequencerTracks);
  const synthParams = useAppStore((s) => s.synthParams);
  const masterSequencerVolume = useAppStore((s) => s.masterSequencerVolume);
  const bpm = useAppStore((s) => s.bpm);
  const isPlaying = useAppStore((s) => s.isSequencerPlaying);

  const [currentStep, setCurrentStep] = useState<number>(0);

  // Real-time playback stepper — driven by the shared audio-clock scheduler
  const armedRef = useRef(false);
  const stepDurationMs = sixteenthNoteMs(bpm);

  const playStepSounds = useCallback(
    (stepIndex: number, time: number) => {
      // <body verbatim from SequencerView 1602-1631>
    },
    [tracks, synthParams, masterSequencerVolume, stepDurationMs],
  );

  useEffect(() => {
    // <body verbatim from SequencerView 1633-1650, using armedRef/playStepSounds/setCurrentStep>
  }, [isPlaying, playStepSounds]);

  return { currentStep, setCurrentStep };
}
```

(Paste the two bodies verbatim — they reference only `tracks`, `synthParams`, `masterSequencerVolume`, `stepDurationMs`, `armedRef`, `audioEngine`, `setCurrentStep`, `STEPS_PER_BAR`; `STEPS_PER_BAR` needs `import { STEPS_PER_BAR } from '../engine';` added.)

- [ ] **Step 2: Wire SequencerView**

In `src/components/SequencerView.tsx`:
- Delete lines 1592–1650: `const [currentStep, setCurrentStep] = useState<number>(0);`, `const armedRef = useRef(false);`, `const stepDurationMs = sixteenthNoteMs(bpm);`, `playStepSounds`, and the clock-subscription effect (1633–1650). Keep the `useEffect` at 1584–1590 (setDrumFilter) and the `selectedGenre` effect at 1595–1597.
- Add: `const { currentStep, setCurrentStep } = useSequencerPlayback();` and `import { useSequencerPlayback } from "../audio/playback/sequencerPlayback";`
- Prune imports verified unused by grep: `useCallback`, `useRef`, `sixteenthNoteMs` (still used if the view renders per-step timing — check), `STEPS_PER_BAR` (still used in the JSX highlight loop at 1891 — keep if so). Keep `audioEngine` (setDrumFilter effect still uses it until Task 12).

- [ ] **Step 3: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/audio/playback/sequencerPlayback.ts src/components/SequencerView.tsx
git commit -m "$(cat <<'EOF'
refactor: move sequencer step playback into audio/playback with useSequencerPlayback

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Extract arp playback into `src/audio/playback/arpPlayback.ts` + `useArpPlayback` (parameterized)

BEHAVIOR-CHANGING (by construction, not by sound): the 4-branch clock subscriber (SynthView 281–405) collapses into one loop driven by a rate table. A new pure function `computeArpTriggers` is proven equivalent to the original 4 branches by an exhaustive test over steps 0–63.

**Files:**
- Create: `src/audio/playback/arpPlayback.ts`
- Test: `src/audio/playback/arpPlayback.test.ts`
- Modify: `src/components/SynthView.tsx:281-405` (replace effect with hook call)

**Interfaces:**
- Consumes: nothing new
- Produces (in `src/audio/playback/arpPlayback.ts`):
  - `export type ArpRate = '4n' | '8n' | '16n' | '32n'`
  - `export interface ArpTrigger { noteIndex: number; timeOffsetSec: number; holdSec: number }`
  - `export function computeArpTriggers(step: number, seqLen: number, rate: ArpRate, stepDur16: number): ArpTrigger[]`
  - `export interface ArpStateRef { current: { activeNotes: Set<string>; params: SynthParams; controlTarget: SynthControlTarget; bpm: number } }`
  - `export function useArpPlayback(stateRef: ArpStateRef, active: boolean, release: number, controlTarget: SynthControlTarget): void`
- Consumed by: SynthView

- [ ] **Step 1: Write the failing equivalence test**

Create `src/audio/playback/arpPlayback.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { computeArpTriggers } from './arpPlayback';
import type { ArpRate } from './arpPlayback';

// Reference implementation: the original 4-branch subscriber logic from
// SynthView.tsx 281-405, transcribed 1:1 into pure form.
function referenceTriggers(step: number, seqLen: number, rate: ArpRate, stepDur16: number) {
  const out: Array<{ noteIndex: number; timeOffsetSec: number; holdSec: number }> = [];
  if (rate === '4n') {
    if (step % 4 !== 0) return out;
    const index = Math.floor(step / 4) % seqLen;
    const stepDurSec = stepDur16 * 4;
    out.push({ noteIndex: index, timeOffsetSec: 0, holdSec: Math.max(0.04, stepDurSec * 0.85) });
  } else if (rate === '8n') {
    if (step % 2 !== 0) return out;
    const index = Math.floor(step / 2) % seqLen;
    const stepDurSec = stepDur16 * 2;
    out.push({ noteIndex: index, timeOffsetSec: 0, holdSec: Math.max(0.04, stepDurSec * 0.85) });
  } else if (rate === '32n') {
    const subDurSec = stepDur16 / 2;
    const holdSec = Math.max(0.03, subDurSec * 0.85);
    out.push({ noteIndex: (step * 2) % seqLen, timeOffsetSec: 0, holdSec });
    out.push({ noteIndex: (step * 2 + 1) % seqLen, timeOffsetSec: subDurSec, holdSec });
  } else {
    const index = step % seqLen;
    out.push({ noteIndex: index, timeOffsetSec: 0, holdSec: Math.max(0.04, stepDur16 * 0.85) });
  }
  return out;
}

describe('computeArpTriggers', () => {
  test('matches the original 4-branch behavior for every step and rate', () => {
    const rates: ArpRate[] = ['4n', '8n', '16n', '32n'];
    for (let step = 0; step < 64; step++) {
      for (const rate of rates) {
        expect(computeArpTriggers(step, 5, rate, 0.25)).toEqual(referenceTriggers(step, 5, rate, 0.25));
      }
    }
  });

  test('indexes wrap at the sequence length and step 0 always fires', () => {
    expect(computeArpTriggers(0, 3, '16n', 0.25)).toEqual([{ noteIndex: 0, timeOffsetSec: 0, holdSec: Math.max(0.04, 0.25 * 0.85) }]);
    expect(computeArpTriggers(4, 3, '16n', 0.25)[0].noteIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test src/audio/playback/arpPlayback.test.ts`
Expected: FAIL — `computeArpTriggers` not exported.

- [ ] **Step 3: Implement `arpPlayback.ts`**

Create `src/audio/playback/arpPlayback.ts`:

```ts
import { useEffect } from 'react';
import { audioEngine } from '../engine';
import { buildArpSequence } from '../arpeggiator';
import { sixteenthNoteMs } from '../../utils/musicTheory';
import type { SynthParams } from '../../types';
import type { SynthControlTarget } from '../../utils/synthControl';

export type ArpRate = '4n' | '8n' | '16n' | '32n';

export interface ArpTrigger {
  noteIndex: number;
  timeOffsetSec: number;
  holdSec: number;
}

export interface ArpStateRef {
  current: { activeNotes: Set<string>; params: SynthParams; controlTarget: SynthControlTarget; bpm: number };
}

// One row per arpRate. stepMod: fire every N sixteenth steps (1 = every step,
// so the modulo always passes). notes: note count per trigger. holdFloor/holdFactor
// reproduce each original branch's hold math exactly (32n uses the half-step
// duration and a 0.03 floor; the others use the full step and 0.04).
const ARP_RATE_CFG: Record<ArpRate, { stepMod: number; notes: number; holdFloor: number; holdFactor: number }> = {
  '4n': { stepMod: 4, notes: 1, holdFloor: 0.04, holdFactor: 4 * 0.85 },
  '8n': { stepMod: 2, notes: 1, holdFloor: 0.04, holdFactor: 2 * 0.85 },
  '16n': { stepMod: 1, notes: 1, holdFloor: 0.04, holdFactor: 1 * 0.85 },
  '32n': { stepMod: 0.5, notes: 2, holdFloor: 0.03, holdFactor: 0.5 * 0.85 },
};

export function computeArpTriggers(step: number, seqLen: number, rate: ArpRate, stepDur16: number): ArpTrigger[] {
  const cfg = ARP_RATE_CFG[rate];
  if (step % cfg.stepMod !== 0) return [];
  const subDur = cfg.notes === 2 ? stepDur16 / 2 : stepDur16;
  const triggers: ArpTrigger[] = [];
  for (let i = 0; i < cfg.notes; i++) {
    const noteIndex = cfg.notes === 2 ? (step * 2 + i) % seqLen : Math.floor(step / cfg.stepMod) % seqLen;
    triggers.push({
      noteIndex,
      timeOffsetSec: cfg.notes === 2 ? i * subDur : 0,
      holdSec: Math.max(cfg.holdFloor, cfg.holdFactor * stepDur16),
    });
  }
  return triggers;
}

/**
 * Arpeggiator clock subscriber, moved from SynthView 281-405 with the 4 rate
 * branches collapsed into computeArpTriggers. `stateRef` mirrors the view's
 * live arp state (held notes, params, control target, bpm) exactly like the
 * original arpStateRef. Teardown releases sounding voices, as before.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean, release: number, controlTarget: SynthControlTarget): void {
  useEffect(() => {
    if (!active) return;

    const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
      const { activeNotes, params, controlTarget: target, bpm } = stateRef.current;

      if (!params.arpActive) return;
      if (activeNotes.size === 0) return;

      const sequence = buildArpSequence(
        activeNotes,
        params.arpMode ?? 'up',
        params.arpOctaves ?? 1,
      );
      if (sequence.length === 0) return;

      const stepDur16 = sixteenthNoteMs(bpm) / 1000;
      for (const t of computeArpTriggers(step, sequence.length, params.arpRate ?? '16n', stepDur16)) {
        const note = sequence[t.noteIndex];
        audioEngine.triggerSynthNoteOn(note, params, 0.9, time + t.timeOffsetSec, target);
        audioEngine.triggerSynthNoteOff(note, params.release, time + t.timeOffsetSec + t.holdSec, target);
      }
    });

    return () => {
      unsubscribe();
      if (audioEngine.getAudioContext()) {
        audioEngine.releaseSoundingVoices(controlTarget, release);
      }
    };
  }, [active, controlTarget, release]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test src/audio/playback/arpPlayback.test.ts`
Expected: PASS (the exhaustive 0–63 × 4-rate sweep proves behavior equivalence).

- [ ] **Step 5: Wire SynthView**

In `src/components/SynthView.tsx`:
- Replace the entire effect at 281–405 with one line, placed where the effect was:

```ts
  useArpPlayback(arpStateRef, params.arpActive ?? false, params.release, controlTarget);
```

- The view keeps `arpStateRef` (lines 211–218) and its update effect — the hook reads `stateRef.current` exactly as the old subscriber did.
- Add `import { useArpPlayback } from "../audio/playback/arpPlayback";`
- Remove `audioEngine` from the view's imports ONLY if nothing else in SynthView uses it after this task (check `grep -n "audioEngine" src/components/SynthView.tsx`; the keyboard note handlers trigger via store actions, so it may now be unused — if any usage remains, keep the import).

- [ ] **Step 6: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/audio/playback/arpPlayback.ts src/audio/playback/arpPlayback.test.ts src/components/SynthView.tsx
git commit -m "$(cat <<'EOF'
refactor: collapse the 4-branch arp subscriber into a parameterized loop

Proven behavior-equivalent by an exhaustive step/rate sweep test.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Extract `triggerPad` into `src/audio/playback/drumPlayback.ts`

Deviation from the spec's module table: "SynthView preview" is listed as a third triggerPad path, but the current SynthView has no `triggerDrum` call (verified by grep) — only two real paths exist: DrumPads:22–27 and SequencerView's `playStepSounds` drum branch (1621–1625). The unified function covers both.

**Files:**
- Create: `src/audio/playback/drumPlayback.ts`
- Modify: `src/components/DrumPads.tsx:22-27`, `src/components/SequencerView.tsx` (drum branch of `playStepSounds` — inside `sequencerPlayback.ts` after Task 9)

**Interfaces:**
- Consumes: Task 9 (playStepSounds now lives in sequencerPlayback.ts)
- Produces (in `src/audio/playback/drumPlayback.ts`):
  - `export function triggerPad(instrument: string, volume: number, time?: number): void` — calls `audioEngine.init()` then `audioEngine.triggerDrum(instrument, volume, time)`
- Consumed by: DrumPads, sequencerPlayback.ts, and (later) any library previews

- [ ] **Step 1: Create the module**

Create `src/audio/playback/drumPlayback.ts`:

```ts
import { audioEngine } from '../engine';

/**
 * Unified drum trigger for pads, sequencer steps, and previews. `time` is the
 * audio-clock time for scheduled hits (sequencer); undefined plays immediately.
 */
export function triggerPad(instrument: string, volume: number, time?: number): void {
  audioEngine.init();
  audioEngine.triggerDrum(instrument, volume, time);
}
```

- [ ] **Step 2: Wire DrumPads**

In `src/components/DrumPads.tsx`, replace the `triggerPad` callback body (lines 22–27) so the audio call goes through the new module, keeping the view-local highlight logic:

```ts
  const triggerPad = useCallback((pad: DrumPad) => {
    triggerDrumPad(pad.note, pad.volume);
    setActivePadId(pad.id);
    setTimeout(() => setActivePadId(null), 150);
  }, []);
```

Add `import { triggerPad as triggerDrumPad } from "../audio/playback/drumPlayback";` and remove the `import { audioEngine } from '../audio/engine';` line (verify no other engine usage in DrumPads).

- [ ] **Step 3: Wire the sequencer's drum branch**

In `src/audio/playback/sequencerPlayback.ts`, inside `playStepSounds`, replace the else-branch:

```ts
          } else {
            audioEngine.triggerDrum(
              track.instrument,
              masterSequencerVolume,
              time,
            );
          }
```

with:

```ts
          } else {
            triggerPad(track.instrument, masterSequencerVolume, time);
          }
```

Add `import { triggerPad } from './drumPlayback';`. The synth/bass branch keeps calling `audioEngine.triggerSynthNoteOn/Off` directly (it schedules voices; `audioEngine` import stays).

- [ ] **Step 4: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green (DrumPads.test and engine tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/drumPlayback.ts src/components/DrumPads.tsx src/audio/playback/sequencerPlayback.ts
git commit -m "$(cat <<'EOF'
refactor: unify drum pad/step triggering behind audio/playback triggerPad

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Rebuild `engineSync` on `subscribeWithSelector` + remove remaining direct engine calls

The store already composes the `subscribeWithSelector` middleware (store.ts:206), so `useAppStore.subscribe(selector, listener, { fireImmediately: true })` is available. The old hook subscribed via React selectors + `useEffect`; the new one uses one subscription per engine-settable value, starts immediately, and tears down via unsubscribes. Also removes the last direct engine calls: `transportSlice` (init/resetClock), `SequencerView`'s setDrumFilter effect, `SimpleSynthPanel`'s `audioEngine.init()`.

**Files:**
- Create: `src/store/engineSync.test.ts`
- Modify: `src/store/engineSync.ts` (full rewrite of the hook + keep extended `applyEngineSnapshot`), `src/store/transportSlice.ts`, `src/store/types.ts` (remove `resetClockIfStopped`), `src/store/store.test.ts:428` (excludedKeys), `src/components/SequencerView.tsx:1584-1590`, `src/components/SimpleSynthPanel.tsx:186`

**Interfaces:**
- Consumes: Task 7's extended `applyEngineSnapshot`
- Produces (in `src/store/engineSync.ts`):
  - `export function startEngineSync(): () => void` — idempotent; returns a `stop()` function
  - `export function stopEngineSync(): void`
  - `export function useEngineSync(): void` — `useEffect(() => startEngineSync(), [])`
  - `export function applyEngineSnapshot(): void` — unchanged from Task 7
- Consumed by: App.tsx:50 (`useEngineSync()` — unchanged call site), engineSync.test.ts

- [ ] **Step 1: Write the failing bootstrap test**

Create `src/store/engineSync.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { startEngineSync, stopEngineSync } from './engineSync';

afterEach(() => {
  stopEngineSync();
});

describe('engineSync', () => {
  test('fireImmediately bootstrap pushes the current state into the engine', () => {
    const setMasterVolume = spyOn(audioEngine, 'setMasterVolume').mockClear();
    const setClockBpm = spyOn(audioEngine, 'setClockBpm').mockClear();
    startEngineSync();
    expect(setMasterVolume).toHaveBeenCalledWith(useAppStore.getState().masterVolume);
    expect(setClockBpm).toHaveBeenCalledWith(useAppStore.getState().bpm);
  });

  test('store mutations flow one-way into the engine; teardown stops them', () => {
    const setClockBpm = spyOn(audioEngine, 'setClockBpm').mockClear();
    startEngineSync();
    useAppStore.getState().setBpm(130);
    expect(setClockBpm).toHaveBeenLastCalledWith(130);
    stopEngineSync();
    setClockBpm.mockClear();
    useAppStore.getState().setBpm(140);
    expect(setClockBpm).not.toHaveBeenCalled();
  });

  test('transport flags init + resetClock only on the fully-stopped -> playing transition', () => {
    const init = spyOn(audioEngine, 'init').mockClear();
    const resetClock = spyOn(audioEngine, 'resetClock').mockClear();
    startEngineSync();
    // stopped -> sequencer playing
    useAppStore.getState().toggleSequencerPlay();
    expect(init).toHaveBeenCalled();
    expect(resetClock).toHaveBeenCalled();
    init.mockClear();
    resetClock.mockClear();
    // playing -> stopped
    useAppStore.getState().toggleSequencerPlay();
    expect(init).not.toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
    // start sequencer while chords already playing -> no reset
    useAppStore.getState().toggleChordsPlay();
    init.mockClear();
    resetClock.mockClear();
    useAppStore.getState().toggleSequencerPlay();
    expect(init).not.toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test src/store/engineSync.test.ts`
Expected: FAIL — `startEngineSync` not exported.

- [ ] **Step 3: Rewrite `engineSync.ts`**

Replace the whole file body with:

```ts
import { useEffect } from 'react';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS } from '../audio/drumKits';
import { useAppStore } from './store';
import type { FilterType } from '../types';

/**
 * One-way bridge from the Zustand store into the audioEngine singleton,
 * rebuilt on Zustand's subscribeWithSelector middleware: one subscription per
 * engine-settable value with `fireImmediately` bootstrap, so the engine always
 * receives the current value the moment the bridge starts (setters no-op
 * before init — engine.ts guards on this.ctx — and applyEngineSnapshot
 * re-applies everything after the AudioContext exists).
 *
 * startEngineSync is idempotent; the returned stop() (and stopEngineSync)
 * unsubscribe every subscription. useEngineSync mounts it at the app root.
 */
type Stop = () => void;

let syncStarted = false;
let stopCurrent: Stop | null = null;

function applySliceState(): void {
  const s = useAppStore.getState();
  audioEngine.setClockBpm(s.bpm);
  audioEngine.setMasterVolume(s.masterVolume);
  audioEngine.setMetronomeEnabled(s.metronomeActive);
  audioEngine.setSourceGain('chord', s.chordVolume);
  audioEngine.setSourceGain('bass', s.bassVolume);
  audioEngine.setSourceMuted('chord', s.chordMuted);
  audioEngine.setSourceMuted('bass', s.bassMuted);
  audioEngine.setDrumKit(DRUM_KITS[s.soundKit]);
  audioEngine.setDrumFilter(s.drumFilterCutoff, s.drumFilterResonance, s.drumFilterType);
  audioEngine.updateEffects(s.effects);
  audioEngine.updateSynthParams(s.synthParams, 'synth');
  audioEngine.updateSynthParams(s.chordSynthParams, 'chord');
  audioEngine.updateSynthParams(s.bassSynthParams, 'bass');
}

export function startEngineSync(): Stop {
  if (syncStarted) return () => undefined;
  syncStarted = true;

  const subs: Array<() => void> = [];

  // transport slice
  subs.push(useAppStore.subscribe((s) => s.bpm, (bpm) => audioEngine.setClockBpm(bpm), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.masterVolume, (v) => audioEngine.setMasterVolume(v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.metronomeActive, (v) => audioEngine.setMetronomeEnabled(v), { fireImmediately: true }));

  // chords + bass buses
  subs.push(useAppStore.subscribe((s) => s.chordVolume, (v) => audioEngine.setSourceGain('chord', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassVolume, (v) => audioEngine.setSourceGain('bass', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.chordMuted, (v) => audioEngine.setSourceMuted('chord', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassMuted, (v) => audioEngine.setSourceMuted('bass', v), { fireImmediately: true }));

  // sequencer slice: kit + drum-bus filter (encoded as one primitive so the
  // subscription fires only when a filter value actually changes)
  subs.push(useAppStore.subscribe((s) => s.soundKit, (kit) => audioEngine.setDrumKit(DRUM_KITS[kit]), { fireImmediately: true }));
  subs.push(
    useAppStore.subscribe(
      (s) => `${s.drumFilterCutoff}|${s.drumFilterResonance}|${s.drumFilterType}`,
      (key) => {
        const [cutoff, resonance, type] = key.split('|');
        audioEngine.setDrumFilter(parseFloat(cutoff), parseFloat(resonance), type as FilterType);
      },
      { fireImmediately: true },
    ),
  );

  // effects slice
  subs.push(useAppStore.subscribe((s) => s.effects, (fx) => audioEngine.updateEffects(fx), { fireImmediately: true }));

  // synth slice
  subs.push(useAppStore.subscribe((s) => s.synthParams, (p) => audioEngine.updateSynthParams(p, 'synth'), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.chordSynthParams, (p) => audioEngine.updateSynthParams(p, 'chord'), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassSynthParams, (p) => audioEngine.updateSynthParams(p, 'bass'), { fireImmediately: true }));

  // Transport play flags: starting any view from a fully-stopped state must
  // init the engine and restart the shared grid (the semantics of the old
  // toggleSequencerPlay/toggleChordsPlay/toggleMasterPlay init()+resetClock
  // calls). Encoded 1/2/3 so the subscription fires only on real transitions.
  subs.push(
    useAppStore.subscribe(
      (s) => (s.isSequencerPlaying ? 1 : 0) + (s.isChordsPlaying ? 2 : 0),
      (flags, prevFlags) => {
        if (flags !== 0 && prevFlags === 0) {
          audioEngine.init();
          audioEngine.resetClock();
        }
      },
    ),
  );

  stopCurrent = () => {
    for (const unsub of subs) unsub();
    subs.length = 0;
    syncStarted = false;
    stopCurrent = null;
  };
  return stopCurrent;
}

export function stopEngineSync(): void {
  stopCurrent?.();
}

export function useEngineSync(): void {
  useEffect(() => startEngineSync(), []);
}

/**
 * Push the full audio-relevant snapshot into the engine. Called once from the
 * app's first-user-interaction handler right after `audioEngine.init()` —
 * every engine setter is a no-op before the AudioContext exists, so the values
 * hydrated from storage or set by pre-init actions (e.g. instant vibes) are
 * re-applied once the engine is live.
 */
export function applyEngineSnapshot(): void {
  applySliceState();
}
```

- [ ] **Step 4: Strip direct engine calls from `transportSlice`**

Rewrite `src/store/transportSlice.ts` to pure state actions (no `audioEngine`):

```ts
import type { StoreApi } from 'zustand';
import type { AppStore, TransportSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Transport slice. `isSequencerPlaying` / `isChordsPlaying` are transient
 * (excluded from persistence); everything else persists.
 *
 * Engine side-effects (init/resetClock on the fully-stopped -> playing
 * transition) are handled by engineSync's transport-flags subscription.
 */
export function createTransportSlice(set: Set, get: Get): TransportSlice {
  return {
    bpm: 120,
    masterVolume: 0.85,
    metronomeActive: false,
    isSequencerPlaying: false,
    isChordsPlaying: false,

    setBpm: (bpm) => set({ bpm }),
    setMasterVolume: (masterVolume) => set({ masterVolume }),

    toggleMetronome: () => set((state) => ({ metronomeActive: !state.metronomeActive })),

    toggleSequencerPlay: () => set((state) => ({ isSequencerPlaying: !state.isSequencerPlaying })),

    toggleChordsPlay: () => set((state) => ({ isChordsPlaying: !state.isChordsPlaying })),

    toggleMasterPlay: () => {
      const { isSequencerPlaying, isChordsPlaying } = get();
      if (isSequencerPlaying || isChordsPlaying) {
        set({ isSequencerPlaying: false, isChordsPlaying: false });
      } else {
        set({ isSequencerPlaying: true, isChordsPlaying: true });
      }
    },
  };
}
```

Needed adjustments to keep this exact: the body above is the complete final file — `toggleMasterPlay` reads both flags via the slice's `get` helper, so this file needs no `useAppStore` import. Also:
- `src/store/types.ts`: delete `resetClockIfStopped: () => void;` from `TransportSlice` (line 26).
- `src/store/store.test.ts:428`: delete `'resetClockIfStopped',` from `excludedKeys`.
- `src/components/TransportBar.tsx` calls `resetClockIfStopped`? Verify with `grep -rn "resetClockIfStopped" src/` — if the TransportBar play button calls it, replace that call with nothing (the engineSync subscription covers the semantics) and delete the call.

- [ ] **Step 5: Remove SequencerView's direct drum-filter effect**

In `src/components/SequencerView.tsx`, delete the `useEffect` at 1584–1590 (`audioEngine.setDrumFilter(...)`) — engineSync's drum-filter subscription (Step 3) now owns it. Remove `audioEngine` from the view's imports if no other usage remains (`grep -n "audioEngine" src/components/SequencerView.tsx`).

- [ ] **Step 6: Remove SimpleSynthPanel's direct `audioEngine.init()`**

In `src/components/SimpleSynthPanel.tsx:186`, delete the `audioEngine.init();` line inside the Auto-Arp toggle handler (the app's first-click handler inits the engine on the same click; the arp subscriber in useArpPlayback subscribes after init in that first click). Remove the `import { audioEngine } from "../audio/engine";` line if nothing else uses it (grep the file).

- [ ] **Step 7: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green, including the new engineSync.test.ts (3 tests) and the existing store.test transport tests. Then confirm components no longer call the engine directly:

Run: `grep -rn "audioEngine" src/components/ | grep -v "\.test\." | grep -v "AudioVisualizer\|TransportBar"`
Expected: no matches. (AudioVisualizer.tsx and TransportBar.tsx keep read-only analyser access — `getAnalyser()`/`getAudioLevel()` — which is visualization, not state mutation; the ESLint config in Task 17 allow-lists exactly these two files.)

- [ ] **Step 8: Commit**

```bash
git add src/store/engineSync.ts src/store/engineSync.test.ts src/store/transportSlice.ts src/store/types.ts src/store/store.test.ts src/components/SequencerView.tsx src/components/SimpleSynthPanel.tsx
git commit -m "$(cat <<'EOF'
refactor: rebuild engineSync on subscribeWithSelector, remove direct engine calls

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Selector sweep (multi-field selectors → atomic / `useShallow`)

Spec §5: every multi-field selector must be atomic or use `useShallow`, because Zustand 5 crashes when a selector returns a fresh reference. Verified at plan time: `grep -rn "useAppStore((s) => ({" src/` returns nothing — the codebase already uses atomic per-field selectors. This task is an audit + guard, not a rewrite.

**Files:**
- Modify: any file the audit flags (expected: none)
- Test: `src/store/store.test.ts` (unchanged unless the audit finds something)

**Interfaces:**
- Consumes: nothing
- Produces: verified guarantee that no multi-field selector returns a fresh reference; the canonical fix pattern below for future work

- [ ] **Step 1: Audit**

Run: `grep -rn "useAppStore((s) => ({" src/ && grep -rn "useShallow" src/`
Expected: no output from the first grep (no object-returning selectors), no `useShallow` usage yet. If the first grep DOES find hits, fix each one (Step 2); otherwise skip to Step 3.

- [ ] **Step 2: Fix any hits with the canonical pattern**

For each hit `useAppStore((s) => ({ a: s.a, b: s.b }))`, either split into two atomic selectors or use shallow equality:

```ts
import { useShallow } from 'zustand/react/shallow';

const { a, b } = useAppStore(useShallow((s) => ({ a: s.a, b: s.b })));
```

- [ ] **Step 3: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green.

- [ ] **Step 4: Commit (only if Step 2 changed files; otherwise commit nothing — report "no-op audit")**

```bash
git add <files changed, by name>
git commit -m "$(cat <<'EOF'
refactor: make multi-field store selectors shallow-stable

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Make `reverbDecay` and `compressorThreshold` actually drive the engine

BEHAVIOR-CHANGING (intended, per spec §4): the Decay knob (EffectsRackView:73–83) and the stored `compressorThreshold` become live. Defaults change ONLY to match the engine's existing hardcoded values (convolver decay 2.0, compressor threshold −12), so the default sound is byte-identical to today; persisted values now take effect, clamped on rehydrate.

**Files:**
- Modify: `src/audio/engine.ts` (fields near 33; `updateEffects` 936–954), `src/store/initialState.ts:90,98`, `src/store/store.ts` (`sanitizePersistedState` clamps)
- Test: `src/audio/engine.test.ts`, `src/store/store.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `updateEffects(fx: MasterEffects)` now also: rebuilds the convolver impulse (`buildImpulseResponse(2.0, fx.reverbDecay)`) ONLY when `fx.reverbDecay` differs from the last applied decay (tracked in a new private field `reverbDecay`), and sets `compressor.threshold` via `setTargetAtTime(fx.compressorThreshold, ctx.currentTime, 0.05)`
  - `INITIAL_EFFECTS` → `reverbDecay: 2.0`, `compressorThreshold: -12`
  - `sanitizePersistedState` clamps `reverbDecay` to [0.5, 6.0] (the knob's min/max) and `compressorThreshold` to [-60, 0]

- [ ] **Step 1: Write the failing engine tests**

Append to `src/audio/engine.test.ts`, following the file's existing fake-ctx setup (the file already builds a faked AudioContext — reuse that fixture; access private members the way the file's existing tests do):

```ts
test('updateEffects rebuilds the convolver impulse only when reverbDecay changes', () => {
  const engine = <the file's existing engine-under-test fixture>;
  const buildSpy = spyOn(engine as unknown as { buildImpulseResponse: () => AudioBuffer }, 'buildImpulseResponse').mockClear();
  engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 2.0 });
  expect(buildSpy).not.toHaveBeenCalled(); // default == the impulse built at setupMasterChain
  engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
  expect(buildSpy).toHaveBeenCalledWith(2.0, 4.5);
  engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
  expect(buildSpy).toHaveBeenCalledTimes(1); // unchanged decay -> no rebuild
});

test('updateEffects sets the compressor threshold from the effects value', () => {
  const engine = <the same fixture>;
  engine.updateEffects({ ...INITIAL_EFFECTS, compressorThreshold: -20 });
  expect(<engine's compressor threshold AudioParam value, accessed as the file accesses private members>).toBe(-20);
});
```

(Add `import { INITIAL_EFFECTS } from '../store/initialState';` if not already imported; the second test's assertion depends on how the file's fake AudioParam records `setTargetAtTime` — if the fake records target values, assert on the recorded target instead.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test src/audio/engine.test.ts`
Expected: the two new tests FAIL (impulse not rebuilt; threshold untouched).

- [ ] **Step 3: Implement the engine changes**

In `src/audio/engine.ts`:
- Add a field next to `reverbGain` (line 33):

```ts
  // Last decay applied to the convolver impulse; guards against re-randomizing
  // the reverb tail on every updateEffects call.
  private reverbDecay = 2.0;
```

- Keep `setupMasterChain` line 271 exactly as is (`this.reverbNode.buffer = this.buildImpulseResponse(2.0, 2.0);`) — it matches the guard's initial value, so the default never triggers a rebuild.
- In `updateEffects` (936–954), insert before the gain setters:

```ts
    if (this.reverbNode && fx.reverbDecay !== this.reverbDecay) {
      this.reverbNode.buffer = this.buildImpulseResponse(2.0, fx.reverbDecay);
      this.reverbDecay = fx.reverbDecay;
    }
    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(fx.compressorThreshold, this.ctx.currentTime, 0.05);
    }
```

- [ ] **Step 4: Change the defaults to match the engine hardcodes**

In `src/store/initialState.ts`: `reverbDecay: 2.4` → `reverbDecay: 2.0` (line 90) and `compressorThreshold: -16` → `compressorThreshold: -12` (line 98). Add a comment above `INITIAL_EFFECTS`:

```ts
// NOTE: reverbDecay (2.0) and compressorThreshold (-12) deliberately equal the
// engine's setupMasterChain hardcodes so the default sound is unchanged now
// that these knobs are live (Task 14). Persisted values from older sessions
// take effect and are clamped in sanitizePersistedState.
```

- [ ] **Step 5: Clamp both on rehydrate**

In `src/store/store.ts`, inside `sanitizePersistedState`, insert after the effects plain-object check (the `sanitized.effects = ... : INITIAL_EFFECTS` ternary at lines 177–184):

```ts
  const fxClamped = sanitized.effects as Record<string, unknown> | undefined;
  if (fxClamped && typeof fxClamped === 'object') {
    fxClamped.reverbDecay = clampFinite(fxClamped.reverbDecay, 0.5, 6.0, 2.0);
    fxClamped.compressorThreshold = clampFinite(fxClamped.compressorThreshold, -60, 0, -12);
  }
```

- [ ] **Step 6: Add the rehydrate clamp test**

Append to `src/store/store.test.ts`, following the existing "legacy preset migration" describe's seeding mechanics exactly (seed `fakeLocalStorage` with the persist key BEFORE `getStore()`; `PERSIST_KEY` is `'murva_project_state_v1'`):

```ts
test('sanitize clamps reverbDecay and compressorThreshold on rehydrate', async () => {
  const seed = {
    bpm: 120,
    masterVolume: 0.85,
    effects: { ...INITIAL_EFFECTS, reverbDecay: 99, compressorThreshold: -0.5 },
  };
  fakeLocalStorage.setItem('murva_project_state_v1', JSON.stringify(seed));
  const store = await getStore();
  const fx = store.useAppStore.getState().effects;
  expect(fx.reverbDecay).toBe(6.0);
  expect(fx.compressorThreshold).toBe(-60);
  fakeLocalStorage.clear();
});
```

- [ ] **Step 7: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green — including the 2 new engine tests, the new store test, and every existing engine/effects test (defaults equal the old hardcodes, so no existing expectation changes).

- [ ] **Step 8: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts src/store/initialState.ts src/store/store.ts src/store/store.test.ts
git commit -m "$(cat <<'EOF'
fix: wire reverbDecay and compressorThreshold into the engine

Defaults equal the previous hardcodes so the default sound is unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Generic `components/ui/PresetLibrary.tsx` + chord/synth configs

Replaces ChordPresetLibrary (642 lines) and SynthPresetLibrary (511 lines) with one config-driven component. Both existing components keep their file paths, export names, and prop interfaces (so ChordView/SynthView call sites are untouched except for the store-call changes already made in Task 6), but their bodies shrink to a config + a `<PresetLibrary .../>` render. Every behavior of the two originals must be ported — the executor reads both originals side by side and maps each behavior onto the generic (or extends the generic with one optional prop, listed in Step 3).

**Files:**
- Create: `src/components/ui/PresetLibrary.tsx`, `src/audio/playback/presetPreview.ts`
- Modify: `src/components/ChordPresetLibrary.tsx` (rewrite as thin wrapper), `src/components/SynthPresetLibrary.tsx` (rewrite as thin wrapper)
- Test: existing test surface (ChordView.test render test, synthPresets.test data tests) must stay green; no new tests required beyond those

**Interfaces:**
- Consumes: Task 6 (store actions), Task 11's `triggerPad` (unused here), `audio/synthPresets` data exports (`SYNTH_CATEGORIES`, `getAllSynthPresets`, `getPresetsGroupedByCategory`, `getCategoryMeta`, `SynthPresetItem`, `SynthPresetCategory`), `audio/data/chordProgressions` (templates)
- Produces:
  - `src/components/ui/PresetLibrary.tsx`:
    - `export interface PresetLibraryEntry { id: string; name: string; category: string; description: string; isFactory?: boolean }`
    - `export interface PresetCategory { id: string; label: string; badgeClass: string; description: string }`
    - `export interface PresetSaveDraft { name: string; category: string; description: string; roman?: string }`
    - `export interface PresetLibraryProps<T extends PresetLibraryEntry>` — `{ isOpen: boolean; onClose: () => void; title: string; entries: T[]; categories: PresetCategory[]; save: { heading: string; buttonLabel: string; withCategory: boolean; withDescription: boolean; withRoman: boolean; defaultCategory: string }; subtitle?: (entry: T) => string; renderEntryActions?: (entry: T) => React.ReactNode; renderHeaderActions?: React.ReactNode; onSelect: (entry: T) => void; onDelete?: (id: string) => void; onSave: (draft: PresetSaveDraft) => void }`
    - `export function PresetLibrary<T extends PresetLibraryEntry>(props: PresetLibraryProps<T>): React.ReactElement | null`
  - `src/audio/playback/presetPreview.ts`: `export function previewSynthNote(note: string, params: SynthParams, velocity?: number, source?: string): void` — the engine-touching preview bodies from both libraries move here verbatim (components must not import `audio/engine` once Task 17 lands)
  - `ChordPresetLibrary.tsx` keeps exporting: `ChordPresetLibrary` (same props as today: `currentChords, scaleRoot, scaleType, autoReharmonize, synthParams, onApplyChords, isOpen, onClose`), `export type { CustomChordProgressionItem }`
  - `SynthPresetLibrary.tsx` keeps exporting `SynthPresetLibrary` (same props: `currentParams, onSelectPreset, isOpen, onClose`)

- [ ] **Step 1: Create `presetPreview.ts`**

Create `src/audio/playback/presetPreview.ts`:

```ts
import { audioEngine } from '../engine';
import type { SynthParams } from '../../types';

/**
 * One-shot preview for library entries (synth patches and chord templates).
 * Bodies moved verbatim from ChordPresetLibrary.tsx / SynthPresetLibrary.tsx
 * so the components themselves never touch audio/engine (layering rule 3).
 */
export function previewSynthNote(note: string, params: SynthParams, velocity = 0.8, source = 'synth'): void {
  audioEngine.init();
  audioEngine.triggerSynthNoteOn(note, params, velocity, undefined, source);
}
```

Then move each library's preview trigger into this file as an exported function, keeping its EXACT original body (open both originals, find the preview call sites — chord library plays a preview chord; synth library may preview the selected patch — copy each body, replacing `audioEngine` usages that must stay in the component with a call into this module). The wrappers in Step 3 call these exports.

- [ ] **Step 2: Create the generic component**

Create `src/components/ui/PresetLibrary.tsx` with the full body below (search input, category chips with counts, grouped list, per-entry Select/Delete + optional extra actions, save form with configurable fields, saved-toast):

```tsx
import React, { useMemo, useState } from 'react';
import { Bookmark, Check, Plus, Search, Trash2, X } from 'lucide-react';

export interface PresetLibraryEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  isFactory?: boolean;
}

export interface PresetCategory {
  id: string;
  label: string;
  badgeClass: string;
  description: string;
}

export interface PresetSaveDraft {
  name: string;
  category: string;
  description: string;
  roman?: string;
}

export interface PresetLibraryProps<T extends PresetLibraryEntry> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  entries: T[];                      // merged: custom first, factory after
  categories: PresetCategory[];      // chips; 'All' is prepended by the component
  save: {
    heading: string;
    buttonLabel: string;
    withCategory: boolean;
    withDescription: boolean;
    withRoman: boolean;
    defaultCategory: string;
  };
  subtitle?: (entry: T) => string;   // e.g. roman numerals for chord templates
  renderEntryActions?: (entry: T) => React.ReactNode; // extra per-entry buttons (e.g. preview)
  renderHeaderActions?: React.ReactNode; // extra header-row content (e.g. export/import buttons)
  onSelect: (entry: T) => void;
  onDelete?: (id: string) => void;
  onSave: (draft: PresetSaveDraft) => void;
}

export function PresetLibrary<T extends PresetLibraryEntry>({
  isOpen, onClose, title, entries, categories, save, subtitle, renderEntryActions, renderHeaderActions, onSelect, onDelete, onSave,
}: PresetLibraryProps<T>) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [showSave, setShowSave] = useState(false);
  const [draft, setDraft] = useState<PresetSaveDraft>({ name: '', category: save.defaultCategory, description: '', roman: '' });
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (category === 'All' || e.category === category) &&
          (query.trim() === '' ||
            e.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            e.description.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [entries, category, query],
  );

  if (!isOpen) return null;
  const chips = [{ id: 'All', label: 'All', badgeClass: 'bg-indigo-600 text-white', description: '' }, ...categories];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-[#252B48] pb-2 mb-3">
          <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-indigo-400" /> {title}
          </span>
          <div className="flex items-center gap-2">
            {renderHeaderActions}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => { setDraft({ name: '', category: save.defaultCategory, description: '', roman: '' }); setShowSave(true); }}
            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Save New
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase transition-all cursor-pointer ${
                category === c.id ? c.badgeClass : 'bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">No presets match.</p>}
        {filtered.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-3 py-2 mb-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-200 truncate">{entry.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{subtitle ? subtitle(entry) : entry.description}</div>
            </div>
            {renderEntryActions?.(entry)}
            <button
              onClick={() => onSelect(entry)}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-md cursor-pointer"
            >
              <Check className="w-3 h-3" /> Select
            </button>
            {!entry.isFactory && onDelete && (
              <button onClick={() => onDelete(entry.id)} className="text-slate-400 hover:text-red-400 cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}

        {showSave && (
          <div className="mt-3 bg-[#0B0D19] border border-indigo-500/40 rounded-lg p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSave(draft);
                setSavedMsg(`Saved "${draft.name}"`);
                setShowSave(false);
                window.setTimeout(() => setSavedMsg(null), 2000);
              }}
            >
              <input
                required value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Name..." autoFocus
                className="w-full bg-[#171B36] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 mb-2"
              />
              {save.withCategory && (
                <select
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className="w-full bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 mb-2 cursor-pointer"
                >
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              )}
              {save.withRoman && (
                <input
                  value={draft.roman ?? ''}
                  onChange={(e) => setDraft({ ...draft, roman: e.target.value })}
                  placeholder="Roman numerals (optional)"
                  className="w-full bg-[#171B36] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 mb-2"
                />
              )}
              {save.withDescription && (
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Description (optional)"
                  className="w-full bg-[#171B36] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 mb-2"
                />
              )}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowSave(false)}
                  className="bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#252B48] cursor-pointer">
                  Cancel
                </button>
                <button type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer">
                  {save.buttonLabel}
                </button>
              </div>
            </form>
          </div>
        )}
        {savedMsg && <p className="mt-2 text-[10px] text-emerald-400">{savedMsg}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Port `ChordPresetLibrary.tsx` onto the generic**

Rewrite `src/components/ChordPresetLibrary.tsx` so it keeps its exported API but delegates. This is a PORT: the original 642-line file is the source of truth for every behavior. Skeleton with the pinned structure:

```tsx
import React from 'react';
import { useAppStore } from '../store/store';
import { CHORD_PROGRESSION_TEMPLATES } from '../audio/data/chordProgressions';
import type { ProgressionTemplate } from '../audio/data/chordProgressions';
import { PresetLibrary } from './ui/PresetLibrary';
import type { PresetLibraryEntry, PresetCategory, PresetSaveDraft } from './ui/PresetLibrary';
import type { ChordItem, SynthParams, CustomChordProgressionItem } from '../types';
import { previewSynthNote } from '../audio/playback/presetPreview';

export type { CustomChordProgressionItem };

// Wrapper entries: factory templates and custom progressions both render through
// the generic; the template pointer is what the onSelect handler transposes.
interface ChordLibraryEntry extends PresetLibraryEntry {
  template?: ProgressionTemplate; // factory templates carry their source
  chords?: ChordItem[];           // custom progressions carry their chords
}

interface ChordPresetLibraryProps {
  currentChords: ChordItem[];
  scaleRoot: string;
  scaleType: string;
  autoReharmonize: boolean;
  synthParams: SynthParams;
  onApplyChords: (chords: ChordItem[]) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const ChordPresetLibrary: React.FC<ChordPresetLibraryProps> = ({
  currentChords, scaleRoot, scaleType, autoReharmonize, synthParams, onApplyChords, isOpen, onClose,
}) => {
  const customProgressions = useAppStore((s) => s.customChordProgressions);
  const saveProgression = useAppStore((s) => s.saveCustomChordProgression);
  const deleteProgression = useAppStore((s) => s.deleteCustomChordProgression);

  const entries: ChordLibraryEntry[] = [
    ...customProgressions.map((p) => ({
      id: p.id, name: p.name, category: p.category, description: p.description, isFactory: false, chords: p.chords,
    })),
    ...CHORD_PROGRESSION_TEMPLATES.map((t) => ({
      id: `factory-${t.name}`, name: t.name, category: t.category, description: t.description, isFactory: true, template: t,
    })),
  ];

  const applyEntry = (entry: ChordLibraryEntry) => {
    if (entry.template) {
      // PORT the original template-apply body verbatim: transpose
      // entry.template.relativeChords against scaleRoot (honoring
      // autoReharmonize) and call onApplyChords(transposed).
    } else if (entry.chords) {
      onApplyChords(entry.chords);
    }
  };

  return (
    <PresetLibrary
      isOpen={isOpen}
      onClose={onClose}
      title="Chord Progression Library"
      entries={entries}
      categories={CHORD_CATEGORIES} // the original file's category chip list, rebuilt as PresetCategory[]
      subtitle={(e) => (e.template ? e.template.roman : e.description)}
      save={{
        heading: 'Save Custom Chord Progression to Browser:',
        buttonLabel: 'Save Progression',
        withCategory: true,
        withDescription: true,
        withRoman: true,
        defaultCategory: <first category id from the original>,
      }}
      renderEntryActions={(e) =>
        e.template ? (
          // PORT the original Play-button preview handler (uses previewSynthNote
          // from presetPreview.ts; the original engine calls are already gone)
          <button onClick={...} className={...}><Play className={...} /></button>
        ) : null
      }
      onSelect={applyEntry}
      onDelete={deleteProgression}
      onSave={(draft) => saveProgression(draft.name, currentChords, draft.category, draft.description, draft.roman)}
    />
  );
};
```

Porting checklist (each item maps to the original file's code — copy the bodies, do not rewrite):

- Category filter + search: handled by the generic's internal state — delete the original's `selectedCategory`/`searchQuery` state and map them to the generic's `categories` prop + search input.
- Preview play: the original's Play-button handler moves into `renderEntryActions` (calls `previewSynthNote` from `presetPreview.ts` — the original's `audioEngine` calls are replaced by this module, so delete the `audioEngine` import).
- Save modal: the original's save form (name + roman + description + category) maps to the `save` config; the submit handler becomes `onSave` → `saveProgression(draft.name, currentChords, draft.category, draft.description, draft.roman)`.
- Delete custom progressions: `onDelete` → `deleteProgression`.
- Export/import JSON buttons (if present in the original): port via the generic's `renderHeaderActions` prop, keeping the handlers in the wrapper.
- `autoReharmonize` interplay (the original reharmonizes the current chords against the template before applying): port that logic into `applyEntry` above.

The wrapper's final shape is: props interface (unchanged from today) + `useAppStore` selectors + entries/categories memo + a `<PresetLibrary ... />` render. Its exported names are unchanged.

- [ ] **Step 4: Port `SynthPresetLibrary.tsx` onto the generic**

Same procedure with the synth library: entries = `getAllSynthPresets(customPresets)` (custom first), categories = `getPresetsGroupedByCategory`'s order + `getCategoryMeta`, save form (name + category + description) → `onSave` calling `savePreset` with the current params (`currentParams`, minus the `preset` label — the store action already strips it), select → `onSelectPreset`, delete → `deletePreset`, preview → `renderEntryActions` via `presetPreview.ts`, chips with counts → `categories` labels (the original shows `Label (count)` — compute counts in the wrapper and bake them into the `label` strings). Export/import buttons, if present in the original, port via the optional `renderHeaderActions` prop from Step 3. Delete the `audioEngine` import.

- [ ] **Step 5: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green. Then eyeball each view in the browser (`bun run dev`): open the chord library and the synth library; verify search, category chips, apply/select, save, delete, preview all behave as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/PresetLibrary.tsx src/audio/playback/presetPreview.ts src/components/ChordPresetLibrary.tsx src/components/SynthPresetLibrary.tsx
git commit -m "$(cat <<'EOF'
refactor: replace the two preset libraries with a generic PresetLibrary

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Extract `ChannelStrip`, `QuickSavePopover`, `Keyboard`, `Slider`, `SortableChordCard`

Pure UI moves — identical JSX, new homes. The line ranges are from the plan-date code; if a range drifts during earlier tasks, locate by the anchor strings given.

**Files:**
- Create: `src/components/ui/ChannelStrip.tsx`, `src/components/ui/QuickSavePopover.tsx`, `src/components/ui/Keyboard.tsx`, `src/components/ui/Slider.tsx`, `src/components/chord/SortableChordCard.tsx`
- Modify: `src/components/ChordView.tsx`, `src/components/SynthView.tsx`, `src/components/TransportBar.tsx`, `src/components/DrumPads.tsx`, `src/components/SequencerView.tsx`, `src/utils/keyboard.ts`, `src/utils/keyboard.test.ts` (moves to `src/components/ui/Keyboard.test.ts`)

**Interfaces:**
- Produces:
  - `src/components/ui/ChannelStrip.tsx`: `export const ChannelStrip: React.FC<{ idPrefix: string; label: string; muted: boolean; volume: number; accentClass: string; onToggleMute: () => void; onVolumeChange: (v: number) => void }>` — mute button + volume slider + % readout; the panel body matches the original ChordView blocks (labels use the `LABEL_BASE` classes)
  - `src/components/ui/QuickSavePopover.tsx`: `export const QuickSavePopover: React.FC<{ open: boolean; onClose: () => void; heading: string; placeholder: string; saveLabel: string; name: string; onNameChange: (name: string) => void; onSubmit: () => void; categories?: { id: string; label: string }[]; category?: string; onCategoryChange?: (category: string) => void }>`
  - `src/components/ui/Keyboard.tsx`: `export { clampKeyboardOctave, getScaleLockedKeyboardNotes, getScaleLockedKeyboardNotesFlat }`, `export interface ScaleKeyboardNote`, `export function ScaleLockedKey(...)`, `export function ScaleLockedKeyboard(...)`, `export function ChromaticKeyboard(...)`, `export function getChromaticKeyboardNotes(octaveOffset: number)` — all moved verbatim; `KEYBOARD_NOTES`, `BLACK_KEY_WIDTH_PX`, `WHITE_KEY_STRIDE_PX`, `getBlackKeyLeftPx` move as module-internal helpers; imports `shortcutLabel` from `../../utils/keyboard`
  - `src/components/ui/Slider.tsx`: `export function Slider(props: { id?: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; className?: string; title?: string })` — renders `<input type="range">` with the same classes
  - `src/components/chord/SortableChordCard.tsx`: `export { SortableChordCard }`, `export interface SortableChordCardProps` (exactly the interface at ChordView 1891–1929: `chord, idx, totalChords, startBar, isActive, rhythmPattern, bassPattern, bpm, updateChord, removeChord, handleMoveChord, setActiveChordId, chordOctave, handleCardPreviewMouseDown, handleCardPreviewMouseUp`)
- Consumed by: ChordView, SynthView, TransportBar, DrumPads, SequencerView

- [ ] **Step 1: Extract `Slider`**

Create `src/components/ui/Slider.tsx`:

```tsx
interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  title?: string;
}

export function Slider({ id, value, min, max, step = 1, onChange, className = 'w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500', title }: SliderProps) {
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={className}
      title={title}
    />
  );
}
```

Then swap all seven raw `<input type="range">` blocks, preserving each one's exact min/max/step/value/onChange/className/title:
- `src/components/TransportBar.tsx:236` (master volume, `className="w-14 sm:w-16 h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"`)
- `src/components/DrumPads.tsx:83` (pad volume)
- `src/components/ChordView.tsx:1446` (chord feel), `:1470` (chord layer volume), `:1837` and `:1860` (per-card synth sliders)
- `src/components/SequencerView.tsx:1738`

Each swap: replace the `<input ... />` with `<Slider ... />` carrying the identical props (drop the `type="range"`/`onChange={(e) => ...parseFloat(e.target.value)...}` boilerplate — Slider owns it) and add the import. Note: `:1470` (chord layer volume) is replaced by `ChannelStrip` in Step 2 — do that swap there instead and skip it here.

- [ ] **Step 2: Extract `ChannelStrip` and swap the chord/bass panels**

Create `src/components/ui/ChannelStrip.tsx` with the body matching the original ChordView panels (classes verbatim from the block at 1461–1485 and its bass twin; labels use the `LABEL_BASE` classes): mute toggle (`VolumeX`/`Volume2` from lucide), label line `{label} ({Math.round(volume * 100)}%)`, the `bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs h-[30px]` row, the `Slider` component (from `./Slider`, Step 1) with `min 0 / max 1.5 / step 0.05`, id `slider-${idPrefix}-layer-volume`, `title={`${label} Gain: ${(volume * 100).toFixed(0)}%`}`, and the `%` readout span. Use `accentClass` on the icon only. Imports: `import React from 'react';`, `import { Volume2, VolumeX } from 'lucide-react';`, `import { Slider } from './Slider';`.

In `src/components/ChordView.tsx`: the block at 1461–1485 (`slider-chord-layer-volume`, label `Chord Level`) and its bass twin (find it by searching `slider-bass-layer-volume` / `Bass Level` — it lives a few lines below and mirrors this block) become:

```tsx
<ChannelStrip
  idPrefix="chord"
  label="Chord Level"
  muted={chordMuted}
  volume={chordVolume}
  accentClass="text-indigo-400"
  onToggleMute={toggleChordMuted}
  onVolumeChange={handleChordVolumeChange}
/>
```
and the bass twin with `idPrefix="bass"`, `label="Bass Level"`, `muted={bassMuted}`, `volume={bassVolume}`, `onToggleMute={toggleBassMuted}`, `onVolumeChange={handleBassVolumeChange}` (preserve the original icon accent class of the bass panel). If the original panels wrap these rows in additional containers or add extra controls (e.g. a preview button), port those into ChannelStrip as optional props and pass them from both call sites.

- [ ] **Step 3: Extract `QuickSavePopover` and swap both call sites**

Create `src/components/ui/QuickSavePopover.tsx` with the body from the plan's design (heading row with Bookmark icon, form with name input + optional category select + Save/Cancel buttons; classes exactly as in ChordView 1264–1298 / SynthView 837–884).

In `src/components/ChordView.tsx`, replace the block at 1264–1298 with:

```tsx
<QuickSavePopover
  open={isQuickSaving}
  onClose={() => setIsQuickSaving(false)}
  heading="Save Custom Chord Progression to Browser:"
  placeholder="Progression Name..."
  saveLabel="Save Progression"
  name={quickSaveName}
  onNameChange={setQuickSaveName}
  onSubmit={handleQuickSaveSubmit}
/>
```

In `src/components/SynthView.tsx`, replace the block at 837–884 with:

```tsx
<QuickSavePopover
  open={isQuickSaving}
  onClose={() => setIsQuickSaving(false)}
  heading="Save Custom Preset to LocalStorage:"
  placeholder="Preset Name..."
  saveLabel="Save Patch"
  name={quickSaveName}
  onNameChange={setQuickSaveName}
  categories={SYNTH_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
  category={quickSaveCategory}
  onCategoryChange={(v) => setQuickSaveCategory(v as SynthPresetCategory)}
  onSubmit={handleQuickSaveSubmit}
/>
```

Remove the now-unused `Bookmark` lucide import from both views if nothing else uses it.

- [ ] **Step 4: Extract `Keyboard`**

Create `src/components/ui/Keyboard.tsx`:
- Move verbatim from `src/components/SynthView.tsx`: `ScaleLockedKey` (1509–1546), `ScaleLockedKeyboard` (1550–1587), `ChromaticKeyboard` (1589–1687), `getChromaticKeyboardNotes` (1688–1703), and the module constants `BLACK_KEY_WIDTH_PX`, `KEYBOARD_NOTES`, `WHITE_KEY_STRIDE_PX`, `getBlackKeyLeftPx` (wherever they sit near 1509–1703).
- Move verbatim from `src/utils/keyboard.ts`: `ScaleKeyboardNote` (63–73), `clampKeyboardOctave` (27–62), `getScaleLockedKeyboardNotes` (75–107), `getScaleLockedKeyboardNotesFlat` (108–136). `isTypingTarget` and `shortcutLabel` STAY in `utils/keyboard.ts` (DrumPads and the key labels use them; Keyboard.tsx imports `shortcutLabel` from `../../utils/keyboard`).
- Export everything the view needs: `clampKeyboardOctave`, `getScaleLockedKeyboardNotes`, `getScaleLockedKeyboardNotesFlat`, `getChromaticKeyboardNotes`, `ScaleLockedKeyboard`, `ChromaticKeyboard`, `ScaleKeyboardNote` (type).
- Move `src/utils/keyboard.test.ts` → `src/components/ui/Keyboard.test.ts`, changing the import to `from './Keyboard'` (the tests cover exactly the three mapping functions — they still pass).
- In `src/components/SynthView.tsx`: delete the moved code (1509–1703); update imports at lines 44–45 and 58–59 — `getScaleLockedKeyboardNotes` / `getScaleLockedKeyboardNotesFlat` / `clampKeyboardOctave` / `getChromaticKeyboardNotes` now come from `./ui/Keyboard`; keep `isTypingTarget, shortcutLabel` from `../utils/keyboard`.

- [ ] **Step 5: Extract `SortableChordCard`**

Create `src/components/chord/SortableChordCard.tsx`:
- Move the `SortableChordCardProps` interface and the `SortableChordCard` component verbatim from `src/components/ChordView.tsx:1891-2106` (the whole file is the dnd-kit card: `useSortable`, `CSS.Transform`, `rectSortingStrategy`-style markup, key labels, preview handlers).
- Move with it its imports: `useSortable` from `@dnd-kit/sortable`, `CSS` from `@dnd-kit/utilities`, `Volume2`, `GripVertical` (or whatever lucide icons the card uses), `ChordItem` / `RhythmPattern` / `BassPattern` types.
- In `src/components/ChordView.tsx`: delete 1891–2106, add `import { SortableChordCard } from "./chord/SortableChordCard";`, and export nothing else new (the card was module-private; export it only from the new file). Prune ChordView imports that only the card used (grep each).

- [ ] **Step 6: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit`
Expected: all green, including the moved `Keyboard.test.ts`. Then `bun run dev` and spot-check: TransportBar master slider, DrumPads pad volume, ChordView feel/volume sliders + quick-save popover (chord), SynthView quick-save popover + keyboard (both modes), chord card drag/reorder/preview.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/ChannelStrip.tsx src/components/ui/QuickSavePopover.tsx src/components/ui/Keyboard.tsx src/components/ui/Slider.tsx src/components/chord/SortableChordCard.tsx src/components/ChordView.tsx src/components/SynthView.tsx src/components/TransportBar.tsx src/components/DrumPads.tsx src/components/SequencerView.tsx src/utils/keyboard.ts src/utils/keyboard.test.ts src/components/ui/Keyboard.test.ts
git commit -m "$(cat <<'EOF'
refactor: extract shared UI pieces into components/ui and components/chord

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Add ESLint and enforce the layering rules

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (devDeps + script)

**Interfaces:**
- Consumes: the final layer state produced by Tasks 6–16
- Produces: `eslint` script + enforced rules:
  1. `src/audio/**` must not import `store/` or `components/` (error)
  2. `src/store/**` must not import `components/` (error); store→engine only through `engineSync` is already structural (only engineSync.ts imports `audio/engine` from store)
  3. `src/components/**` must not import `audio/engine` (error), with sanctioned exceptions: `AudioVisualizer.tsx` + `TransportBar.tsx` (read-only analyser reads) and all `*.test.ts(x)`
  4. `complexity` warn-only at threshold 20

- [ ] **Step 1: Install devDeps**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun add -d eslint typescript-eslint eslint-plugin-import`
Expected: package.json gains the three devDeps.

- [ ] **Step 2: Write `eslint.config.js`**

Create `eslint.config.js`:

```js
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      complexity: ['warn', 20],
    },
  },
  {
    // Layering rule 1: audio/ never imports store/ or components/.
    files: ['src/audio/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
          ],
        },
      ],
    },
  },
  {
    // Layering rule 2: store/ must not import components/.
    files: ['src/store/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/components/**'], message: 'store/ must not import components/ (layering rule 2)' },
          ],
        },
      ],
    },
  },
  {
    // Layering rule 3: components are dumb views — no direct audio/engine.
    // Exceptions: the two read-only analyser views (AudioVisualizer,
    // TransportBar level meter) and test files.
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/audio/engine'], message: 'components must not import audio/engine (layering rule 3)' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/components/AudioVisualizer.tsx',
      'src/components/TransportBar.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'import/no-restricted-imports': 'off' },
  },
);
```

- [ ] **Step 3: Add the npm script**

In `package.json` scripts, add `"eslint": "eslint ."` (keep the existing `"lint": "tsc --noEmit"`).

- [ ] **Step 4: Run it and fix what it finds**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && npx eslint .`
Expected: zero errors. If it flags a violation (e.g. an `audio/` file still importing store, or a component importing `audio/engine`), fix the import per the layering rule — the earlier tasks should have removed all of these; if one remains, it indicates a missed cleanup, fix it the same way the earlier task would have (move the code into the audio layer or the store action).
Expected: warnings allowed (complexity warnings are warn-only).

- [ ] **Step 5: Verify**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit && npx eslint .`
Expected: all three green (eslint may print complexity warnings — that is OK).

- [ ] **Step 6: Commit**

```bash
git add package.json eslint.config.js
git commit -m "$(cat <<'EOF'
chore: enforce module layering with ESLint import rules

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Record final metrics

**Files:**
- Modify: `docs/superpowers/metrics-baseline.md`

**Interfaces:**
- Consumes: Task 1's baseline file
- Produces: after-numbers in the same file

- [ ] **Step 1: Re-run the measurements**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && npx --yes jscpd src --min-lines 5 2>&1 | tail -8` and `wc -l $(find src -type f \( -name "*.ts" -o -name "*.tsx" \)) | tail -1`

- [ ] **Step 2: Record files-touched-per-feature**

Run: `git log --oneline --no-merges | head -30` and summarize per commit/task: `git show --stat --format="%s" <sha> | tail -1` for each; record the average file count per feature commit into the metrics file.

- [ ] **Step 3: Fill in the "After" section**

In `docs/superpowers/metrics-baseline.md`, replace the three `<TBD>` placeholders under `## After` with the measured numbers.

- [ ] **Step 4: Final verification**

Run: `cd /Users/Pathompong/Sites/Personal/murva-from-googlestudio && bun test && tsc --noEmit && npx eslint .`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/metrics-baseline.md
git commit -m "$(cat <<'EOF'
chore: record post-restructure metrics

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```
