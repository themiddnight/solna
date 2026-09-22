# DEV-422 PlaybackHost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `PlaybackHost` component, rendered once in `App.tsx`, mounts every transport-driven playback controller, so no lane sounds because a grid is mounted; the last React hook leaves `src/audio/` behind an ESLint ban. Nothing audible or visible changes.

**Architecture:** One lane moves per task, and every commit mounts each controller exactly once. Task 1 creates `components/playback/PlaybackHost.tsx` with the Beat controller alone and renders it **between** the `<LoopPage />` and `<SongPage />` wrappers, so the clock-listener order stays lead, fx, chord (still in the grids), then sequencer (host), then `ArrangeView`. Task 2 splits `useChordPlayback.ts` into a clock half (`playback/useChordClockPlayback.ts`, into the host ahead of the sequencer) and an audition half (`loop/chord/useChordAudition.ts`), and moves the playing-chord highlight onto a new `components/playingChord.ts` pub/sub. Task 3 moves Lead/FX into the host at the top of its hook order and moves the host to its final place, before `<LoopPage />`. Task 4 turns the arp's hook body into `startArpClock` in `audio/`, adds the React wrapper in `components/playback/`, adds the `react`/`react-dom` ban on `src/audio/` and runs the full gate. Task 5 is ADR-0039, R312–R314 and the doc sync.

**Tech Stack:** TypeScript, React (`useSyncExternalStore`, `React.memo`), zustand, raw Web Audio API behind `audio/playback/playbackEngine`, Bun test runner (`bun:test`, `renderToString`), ESLint flat config (`ESLint#lintText` for rule tests), Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-22-dev-422-playback-host-design.md` — binding. Read §0 (verified facts F1–F22), §3 (target layout), §4 (host), §5 (chord split, `playingChord`, listener order, arp), §7 (tests) and §8 (docs) before any task. Where this plan departs from the spec it says so under "Spec corrections".

## Global Constraints

- Branch `refactor/dev-422-playback-host` (checked out). Never push, never commit on `main`, never switch branches.
- One commit per task. Conventional message with the suffix `(DEV-422)`, body ending with a blank line and exactly `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Spec header: "**User-visible change:** none. Every lane sounds, highlights and stops exactly as today; the golden WAV and `bun run verify` are unchanged."
- **Golden is frozen.** Never run anything with `GOLDEN_UPDATE=1`. After every task `git diff --stat 9ccfe260 -- src/audio/export/renderMixdownGolden*` prints nothing and `bun test src/audio/export/renderMixdownGolden.test.ts` passes.
- **Exactly-once mounting in every commit (spec K2).** A task that adds a controller to the host removes its grid/view call in the same commit. No commit leaves a lane mounted twice or not at all.
- **Clock-listener order in every commit (spec §5.3).** Today it is lead playback, lead publisher, fx playback, fx publisher, chord, sequencer, then `ArrangeView`. Every intermediate commit keeps that order (this is why the lanes move sequencer → chord → lead/fx, see "Spec corrections" 1).
- Spec §2: "No planner, engine, clock or `playbackEngine` contract change; no new engine setter." "No change to what a controller schedules or when." "`useInputDeck` and `usePlayheadSync` stay where they are."
- Spec §5.1: controller bodies move **verbatim**; only imports, the `ChordPlaybackState` split, `showChord`/`clearChordUi` and the return value change.
- Moved files use `@/…` imports across folders (the `../../` specifier is banned by `GLOBAL_RESTRICTED_SYNTAX`; `components/playback/` is one level deeper than `components/`, so every `../x` in a moved file must become `@/x`).
- Gates per task: `bun run lint` clean; `bun run eslint` prints **zero errors and zero warnings** — never ignore a warning or call it pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>`; never relax a rule globally (R005, R264); `bun test` green; `bun run check:dead-code` and `bun run check:dead-code:production` zero findings.
- Size caps (`eslint.config.js`): `max-lines` 750 code lines per file; `max-lines-per-function` 100 (skips blanks and comments); `complexity` warns at 20 (a warning fails the gate). `useChordViewState` is near the function cap — Task 2 adds five code lines and removes one.
- R001: no counts, versions or line numbers in any doc you write (plan-internal line references are for the implementer only).
- Large files (`useChordPlayback.ts`, `useChordView.ts`, `useInputDeck.ts`, `eslint.config.js`, structure docs): Serena `find_symbol` / `grep -n` + line ranges, never a whole-file dump.

## Spec corrections (found while verifying the spec against the code)

1. **Lane order and the host's interim position.** The spec (§4) renders the host before `<LoopPage />`. Moving the sequencer first with the host there would make the Beat listener subscribe *before* lead/fx/chord in the intermediate commits. So: Task 1 renders `<PlaybackHost />` between the `<LoopPage />` and `<SongPage />` wrapper `div`s (order lead, fx, chord, **sequencer**, Arrange — unchanged). Task 2 adds the chord clock ahead of the sequencer in the host (lead, fx, **chord, sequencer**, Arrange — unchanged). Task 3 adds lead/fx at the top of the host and moves the host to the spec's final position before `<LoopPage />` (**lead, lead-pub, fx, fx-pub, chord, sequencer**, Arrange — unchanged). No other clock subscriber lives under `LoopPage` (`grep -rln subscribePlaybackClock src/components` → only the controllers, `usePlayheadSync` (a `Workspace` hook, whose effects run after every child's) and `song/ArrangeView.tsx`).
2. **`appChildMemo.test.tsx` cannot take the host as a `CASES` row.** That loop asserts `outer.length > 0`, and `PlaybackHost` renders `''`. Task 1 adds a separate test in that file asserting only the `React.memo` wrapper.
3. **`playingChord.set(null)` always notifies.** Spec §5.2 says `set` is a no-op "when index and chordId both equal the current value". Applied to `null → null` too, it would break last-writer-wins in two cases the old `setActiveChordId(null)` in `clearChordUi` covered: a card held while the chord player is stopped and `chords` changes (the clock effect re-runs its stopped branch), and a stop that lands before the first chord armed. Resolution: the content-equal no-op applies to two non-null values; `set(null)` always notifies. Cost is nil — `useSyncExternalStore` bails out on the same `null` snapshot and `setActiveChordId(null)` on an already-null state bails out too. The only remaining no-op is a non-null re-publish with the same index and id, which happens only for a one-chord progression, where the held card and the playing card are the same card (identical highlight). `playingChord.test.ts` pins both behaviours.
4. **Composition test mechanics (§7).** "Called only there" is counted over non-test files under `src/` with comments stripped (docblocks name the controllers) and the declaration `function useX(` excluded by a lookbehind. `useArpPlayback` gets the same guard, pinned to `useInputDeck.ts` (Task 4).
5. **ESLint-ban test file.** `src/audio/export/renderMidi.ts` is linted by `@typescript-eslint/no-restricted-imports` (its block turns the base rule off), so the test filters on both rule ids. It lives in a new `src/architecture/audioReactBan.test.ts` rather than in `dependencyLayers.test.ts`, whose `GUARDED` set holds only the base id.
6. **`startArpClock` gets a direct test.** It is a plain function now, so `src/audio/playback/startArpClock.test.ts` (new) checks subscribe-once, unsubscribe-on-cleanup and the latest-ref release with `spyOn(audioEngine, …)`. `arpPlayback.test.ts` changes only in one comment.

## File map

| File | Task | Change |
|---|---|---|
| `src/components/playback/PlaybackHost.tsx` (+ `PlaybackHost.test.tsx`) | 1, 2, 3, 4 | **new** in 1; one call added per lane in 2, 3; arp guard test in 4 |
| `src/components/useSequencerPlayback.ts` (+ `.test.ts`), `src/components/sequencerStartup.test.ts` | 1 | `git mv` → `src/components/playback/`, imports to `@/…` |
| `src/components/loop/sequencer/SequencerGrid.tsx` | 1 | drop import + call; docblock points at the host |
| `src/App.tsx` | 1, 3 | render `<PlaybackHost />` (interim in 1, final in 3); comment by `usePlayheadSync()` |
| `src/components/appChildMemo.test.tsx` | 1 | host memo assertion |
| `src/components/playbackStep.wiring.test.ts`, `src/architecture/schedulingFocusIndependence.test.ts` | 1, 2, 3 | paths follow the moves |
| `src/audio/playback/drumPlayback.ts`, `src/components/useInputDeck.ts` | 1 (4) | comments/path |
| `src/components/playingChord.ts` (+ `.test.ts`) | 2 | **new** pub/sub |
| `src/components/playback/useChordClockPlayback.ts` (+ `.test.ts`) | 2 | `git mv` from `loop/chord/useChordPlayback.ts` (+ test), audition half removed, `void` hook |
| `src/components/loop/chord/useChordAudition.ts` | 2 | **new** — the two previews |
| `src/components/loop/chord/useChordView.ts`, `ProgressionCard.tsx`, `src/components/loop/ChordView.tsx`, `ChordView.test.tsx`, `chord/useChordView.test.ts` | 2 | consume audition + `playingChord`; local `activeChordId`; `isPlaying` selector |
| `src/components/playbackStep.ts`, `src/audio/playback/playbackEngine.ts`, `src/store/loadLoop.ts`, `src/data/chordRhythms.ts`, `src/audio/playback/plan/chordEvents.test.ts` | 2 | comments only |
| `src/components/loop/lead/useLeadPlayback.ts`, `useLeadStepPublisher.ts` (+ tests) | 3 | `git mv` → `src/components/playback/` |
| `src/components/loop/lead/LeadMelodyGrid.tsx` | 3 | drop imports + calls; comments |
| `src/audio/playback/arpPlayback.ts` (+ comment in `.test.ts`) | 4 | `useArpPlayback` → `startArpClock`; no `react` |
| `src/components/playback/useArpPlayback.ts`, `src/audio/playback/startArpClock.test.ts`, `src/architecture/audioReactBan.test.ts` | 4 | **new** |
| `eslint.config.js` | 4 | `REACT_IMPORT_BAN` spread into the four `src/audio/` blocks |
| `docs/decisions/0039-playback-host.md`, `docs/decisions/README.md`, `0001`, `0002`, `0027`, `CLAUDE.md`, `.claude/rules/{playback,components,boundaries-and-gates}.md`, `docs/architecture/**` | 5 | doc sync |

---

### Task 1: `PlaybackHost` with the Beat controller

**Files:**
- Create: `src/components/playback/PlaybackHost.tsx`, `src/components/playback/PlaybackHost.test.tsx`
- Move: `src/components/useSequencerPlayback.ts` → `src/components/playback/useSequencerPlayback.ts`; `src/components/useSequencerPlayback.test.ts` → `src/components/playback/useSequencerPlayback.test.ts`; `src/components/sequencerStartup.test.ts` → `src/components/playback/sequencerStartup.test.ts`
- Modify: `src/components/loop/sequencer/SequencerGrid.tsx` (import `:3`, docblock `:21-39`, call `:50`), `src/App.tsx` (import block, `usePlayheadSync()` comment, `<main>`), `src/components/appChildMemo.test.tsx`, `src/components/playbackStep.wiring.test.ts` (`:115`), `src/architecture/schedulingFocusIndependence.test.ts` (`:37`), `src/audio/playback/drumPlayback.ts` (`:5`), `src/components/useInputDeck.ts` (`:285`)

**Interfaces:**
- Consumes: `useSequencerPlayback(): void` (unchanged body).
- Produces: `export const PlaybackHost: React.MemoExoticComponent<() => null>` at `@/components/playback/PlaybackHost`; `@/components/playback/useSequencerPlayback` exporting `SequencerArming`, `SequencerStepAction`, `sequencerStepAction`, `fireBeatStepEvents`, `useSequencerPlayback` (names unchanged). The test's `HOST_CALLS` / `CONTROLLERS` arrays, which Tasks 2 and 3 extend.

- [ ] **Step 1: Write the failing test** — create `src/components/playback/PlaybackHost.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PlaybackHost } from './PlaybackHost';

const ROOT = process.cwd();
const HOST_FILE = 'src/components/playback/PlaybackHost.tsx';

/**
 * The host's controller calls, in clock-listener order (spec §5.3): every
 * controller subscribes inside an effect, so hook order inside the host is
 * the order its listeners register on Play.
 */
const HOST_CALLS = [
  'useSequencerPlayback()',
] as const;

/** Every transport controller: each is called in the host and nowhere else. */
const CONTROLLERS = ['useSequencerPlayback'] as const;

/** Docblocks name the controllers; only code may count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Files (repo-relative) calling `name(`, with the call count; declarations excluded. */
function callSites(name: string): Array<{ file: string; count: number }> {
  const call = new RegExp(String.raw`(?<!function )\b${name}\s*\(`, 'g');
  return sourceFiles(join(ROOT, 'src'))
    .map((path) => ({
      file: relative(ROOT, path),
      count: (stripComments(readFileSync(path, 'utf8')).match(call) ?? []).length,
    }))
    .filter((site) => site.count > 0);
}

describe('PlaybackHost', () => {
  test('renders nothing and runs every controller body with no grid in the tree', () => {
    expect(renderToString(createElement(PlaybackHost))).toBe('');
  });

  test('calls its controllers in clock-listener order', () => {
    const host = stripComments(readFileSync(join(ROOT, HOST_FILE), 'utf8'));
    const positions = HOST_CALLS.map((call) => host.indexOf(call));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  for (const name of CONTROLLERS) {
    test(`${name} is called only by the host (no view re-mounts it)`, () => {
      const expected = HOST_CALLS.filter((call) => call.startsWith(`${name}(`)).length;
      expect(callSites(name)).toEqual([{ file: HOST_FILE, count: expected }]);
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/playback/PlaybackHost.test.tsx`
Expected: FAIL — `Cannot find module './PlaybackHost'`.

- [ ] **Step 3: Move the Beat controller and its tests**

```bash
mkdir -p src/components/playback
git mv src/components/useSequencerPlayback.ts src/components/playback/useSequencerPlayback.ts
git mv src/components/useSequencerPlayback.test.ts src/components/playback/useSequencerPlayback.test.ts
git mv src/components/sequencerStartup.test.ts src/components/playback/sequencerStartup.test.ts
```

In `src/components/playback/useSequencerPlayback.ts` replace the import lines 2-11 with (same symbols, `@/` paths):

```ts
import { useAppStore } from "@/store/store";
import { publishStepAt, resetStep } from "@/components/playbackStep";
import { ensureDrumEngine, triggerPad } from "@/audio/playback/drumPlayback";
import { planBeatStep, type BeatStepEvent } from "@/audio/playback/plan/beatPlan";
import { STEPS_PER_BAR } from "@/utils/musicTheory";
import { subscribePlaybackClock } from "@/audio/playback/playbackEngine";
import { getMeter } from "@/utils/meter";
import { armOnBarLine, isSoftStopBoundary } from "@/components/playerStop";
import { beatPlanSnapshot } from "@/store/playbackPlanSnapshots";
import type { PlayerState } from "@/store/types";
```

In the docblock above `export function useSequencerPlayback` (the `// Real-time sequencer stepper hook.` comment), append one line: `// Mounted once, by PlaybackHost (this folder) — never by a grid.`

In `src/components/playback/useSequencerPlayback.test.ts`: lines 93-95 become `import { audioEngine } from '@/audio/engine';`, `import { DEFAULT_VELOCITY } from '@/audio/constants';`, `import { useAppStore } from '@/store/store';`; the three `join(process.cwd(), 'src/components/useSequencerPlayback.ts')` (`:77, :143, :162`) become `'src/components/playback/useSequencerPlayback.ts'`.

In `src/components/playback/sequencerStartup.test.ts` lines 2-5 become:

```ts
import { audioEngine } from '@/audio/engine';
import { freshEngine } from '@/audio/testFakes';
import { planBeatStep } from '@/audio/playback/plan/beatPlan';
import { defaultBeatState } from '@/store/beatPresets';
```

- [ ] **Step 4: Create `src/components/playback/PlaybackHost.tsx`**

```tsx
import React from 'react';
import { useSequencerPlayback } from './useSequencerPlayback';

/**
 * The one mount of every transport-driven playback controller (DEV-422).
 *
 * A lane sounds because THIS component is mounted, never because its grid
 * is: the views stay mounted to keep their UI state, and audio no longer
 * depends on them. Rendered once, in `Workspace` (`App.tsx`), as JSX rather
 * than hook calls there, so hook order stays local and the element's tree
 * position fixes the clock-listener order.
 *
 * Hook order IS listener order. Every controller subscribes the shared clock
 * inside an effect gated on its player, so on Play the listeners register in
 * this order; `PlaybackHost.test.tsx` pins it. Never call one of these hooks
 * from a view — a second call is a second scheduler and every event fires
 * twice.
 *
 * `React.memo` so a `Workspace` re-render does not re-run the controllers'
 * selectors; each controller re-renders the host on its own store reads.
 */
export const PlaybackHost = React.memo(function PlaybackHost(): null {
  useSequencerPlayback();
  return null;
});
```

- [ ] **Step 5: Remove the grid's call** — in `src/components/loop/sequencer/SequencerGrid.tsx`:
  - delete line 3 `import { useSequencerPlayback } from '@/components/useSequencerPlayback';`
  - delete line 50 `  useSequencerPlayback();`
  - in the docblock, replace the paragraph `` * `useSequencerPlayback` must be mounted EXACTLY once (it subscribes the clock`` / `` * and owns the soft stop); SequencerView renders this child exactly once.`` with:

```
 * The Beat lane's controller is NOT mounted here: `useSequencerPlayback` lives
 * in `PlaybackHost` (components/playback/), mounted once in App.tsx, so the
 * lane sounds whether or not this grid is mounted.
```

  - replace the docblock's last sentence `` `useSequencerPlayback` `` / `` * above is unaffected — it schedules the Beat audio unconditionally, whatever `` / `` * segment is focused.`` with `` * The Beat audio is unaffected: `useSequencerPlayback`, in `PlaybackHost`, `` / `` * schedules it unconditionally, whatever segment is focused.``

- [ ] **Step 6: Render the host** — in `src/App.tsx`:
  - after `import { SongPage } from './components/song/SongPage';` add `import { PlaybackHost } from './components/playback/PlaybackHost';`
  - replace `  // Shared clock -> store playhead, so every tab can show the beat position.` with:

```tsx
  // Shared clock -> store playhead, so every tab can show the beat position.
  // The lane controllers are NOT hooks here: they live in <PlaybackHost />
  // below, whose tree position fixes their clock-listener order.
```

  - in `<main …>`, between the `<LoopPage />` wrapper `</div>` and the `<SongPage />` wrapper `<div …>`, insert:

```tsx
        {/* Every transport controller, mounted once (DEV-422). Here, after the
            Loop page, while the Lead/FX/Chord controllers are still mounted by
            their views, so the clock-listener order is unchanged. */}
        <PlaybackHost />
```

- [ ] **Step 7: Memo assertion** — in `src/components/appChildMemo.test.tsx` add `import { PlaybackHost } from './playback/PlaybackHost';` after the `SongPage` import, and after the `describe('App-level children are memoized, …')` block add:

```tsx
describe('PlaybackHost is memoized', () => {
  // Not a CASES row: that loop asserts non-empty markup, and the host renders
  // nothing by design.
  test('PlaybackHost is a React.memo wrapper', () => {
    expect(typeof memoInner(PlaybackHost)).toBe('function');
  });
});
```

- [ ] **Step 8: Paths and comments that follow the move**
  - `src/components/playbackStep.wiring.test.ts:115` → `file: 'src/components/playback/useSequencerPlayback.ts',`
  - `src/architecture/schedulingFocusIndependence.test.ts:37` → `'src/components/playback/useSequencerPlayback.ts',`
  - `src/audio/playback/drumPlayback.ts:5` → `(components/playback/useSequencerPlayback.ts)` in place of `(useSequencerPlayback.ts)`
  - `src/components/useInputDeck.ts:285` → `` Same pattern as `components/playback/useSequencerPlayback.ts`. ``
  - Verify: `grep -rn "components/useSequencerPlayback\|'./useSequencerPlayback'\|\"./useSequencerPlayback\"" src` → hits only inside `src/components/playback/`.

- [ ] **Step 9: Run the tests and gates**

Run: `bun test src/components/playback src/components/appChildMemo.test.tsx src/components/playbackStep.wiring.test.ts src/architecture/schedulingFocusIndependence.test.ts`
Expected: PASS (the `useSequencerPlayback is called only by the host` test sees exactly `[{ file: 'src/components/playback/PlaybackHost.tsx', count: 1 }]`).
Then: `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production` → all green, zero ESLint warnings; `git diff --stat 9ccfe260 -- src/audio/export/renderMixdownGolden*` → empty.

- [ ] **Step 10: Commit**

```bash
git add -A src/components/playback src/components/useSequencerPlayback.ts src/components/useSequencerPlayback.test.ts \
  src/components/sequencerStartup.test.ts src/components/loop/sequencer/SequencerGrid.tsx src/App.tsx \
  src/components/appChildMemo.test.tsx src/components/playbackStep.wiring.test.ts \
  src/architecture/schedulingFocusIndependence.test.ts src/audio/playback/drumPlayback.ts src/components/useInputDeck.ts
git commit -m "refactor(playback): add PlaybackHost and move the Beat controller into it (DEV-422)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Split the chord controller; `playingChord` pub/sub

**Files:**
- Create: `src/components/playingChord.ts`, `src/components/playingChord.test.ts`, `src/components/loop/chord/useChordAudition.ts`
- Move: `src/components/loop/chord/useChordPlayback.ts` → `src/components/playback/useChordClockPlayback.ts`; `src/components/loop/chord/useChordPlayback.test.ts` → `src/components/playback/useChordClockPlayback.test.ts`
- Modify: `src/components/playback/PlaybackHost.tsx`, `PlaybackHost.test.tsx`; `src/components/loop/chord/useChordView.ts` (`:12, :76, :133-137, :347-348, :411`); `src/components/loop/chord/ProgressionCard.tsx` (imports, `:272, :283`); `src/components/loop/ChordView.tsx` (`:179`); `src/components/loop/ChordView.test.tsx` (`:2`, `:73-86`); `src/components/loop/chord/useChordView.test.ts` (`:32`); `src/components/playbackStep.wiring.test.ts` (`:49, :178`); `src/architecture/schedulingFocusIndependence.test.ts` (`:11, :40, :74`); comments in `src/components/playbackStep.ts:227`, `src/audio/playback/playbackEngine.ts:7`, `src/store/loadLoop.ts:193`, `src/data/chordRhythms.ts:5`, `src/audio/playback/plan/chordEvents.test.ts:131`

**Interfaces:**
- Consumes: `PlaybackHost` and its test arrays (Task 1).
- Produces:
  - `@/components/playingChord`: `export interface PlayingChordPublisher { get(): PlayingChord | null; set(value: PlayingChord | null): void; subscribe(listener: (value: PlayingChord | null) => void): () => void }` where `PlayingChord = { index: number; chordId: string }` (module-private); `export function createPlayingChordPublisher(): PlayingChordPublisher`; `export const playingChord: PlayingChordPublisher`; `export function usePlayingChord(): { index: number; chordId: string } | null`.
  - `@/components/playback/useChordClockPlayback`: `export function useChordClockPlayback(): void`, plus the unchanged exports `ChordArming`, `createChordArming`, `resetChordArming`, `rewindChordOnClockReset`, `activeStepsPerBar`, `ChordStepAction`, `chordStepAction`.
  - `@/components/loop/chord/useChordAudition`: `export interface UseChordAudition { playChordWithRhythm(chord: ChordItem, startTime: number, cycle: PlaybackPatternCycle<RhythmPattern>): void; playBassWithPattern(chord: ChordItem, startTime: number, cycle: PlaybackPatternCycle<BassPattern>, chordContext?: ChordItem[]): void }`; `export function useChordAudition(): UseChordAudition`.
  - `ChordViewState` loses `playback`, gains `audition: UseChordAudition`, `isPlaying: boolean`, `activeChordId: string | null`, `setActiveChordId: (id: string | null) => void`.

- [ ] **Step 1: Write the failing pub/sub test** — create `src/components/playingChord.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createPlayingChordPublisher, playingChord, usePlayingChord } from './playingChord';

describe('playing chord publisher', () => {
  test('get returns what set recorded, and starts empty', () => {
    const p = createPlayingChordPublisher();
    expect(p.get()).toBeNull();
    p.set({ index: 2, chordId: 'c-2' });
    expect(p.get()).toEqual({ index: 2, chordId: 'c-2' });
  });

  test('notifies once per change, and a same-content chord is a no-op', () => {
    const p = createPlayingChordPublisher();
    const seen: Array<{ index: number; chordId: string } | null> = [];
    p.subscribe((value) => seen.push(value));
    p.set({ index: 0, chordId: 'a' });
    p.set({ index: 0, chordId: 'a' }); // a new object, same content
    p.set({ index: 1, chordId: 'b' });
    p.set({ index: 1, chordId: 'a' }); // id alone differs
    expect(seen).toEqual([
      { index: 0, chordId: 'a' },
      { index: 1, chordId: 'b' },
      { index: 1, chordId: 'a' },
    ]);
  });

  test('a clear always notifies, even when nothing is playing', () => {
    // The chord view resets its held-card highlight on every notify; the old
    // clearChordUi nulled that id on every call, so a clear must reach it.
    const p = createPlayingChordPublisher();
    let notified = 0;
    p.subscribe(() => { notified++; });
    p.set(null);
    p.set(null);
    expect(notified).toBe(2);
    expect(p.get()).toBeNull();
  });

  test('unsubscribe stops notifications', () => {
    const p = createPlayingChordPublisher();
    let notified = 0;
    const off = p.subscribe(() => { notified++; });
    off();
    p.set({ index: 0, chordId: 'a' });
    expect(notified).toBe(0);
  });

  test('usePlayingChord renders the published value under renderToString', () => {
    playingChord.set({ index: 3, chordId: 'x' });
    const Probe = () => {
      const value = usePlayingChord();
      return createElement('span', null, value ? `${value.index}:${value.chordId}` : 'none');
    };
    expect(renderToString(createElement(Probe))).toContain('3:x');
    playingChord.set(null);
    expect(renderToString(createElement(Probe))).toContain('none');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/playingChord.test.ts`
Expected: FAIL — `Cannot find module './playingChord'`.

- [ ] **Step 3: Create `src/components/playingChord.ts`**

```ts
import { useSyncExternalStore } from 'react';

/**
 * The chord the Chords player is sounding, published OUTSIDE the store
 * (DEV-422, R313).
 *
 * Written by the chord clock controller in `PlaybackHost`, read by the
 * progression cards — two areas, so it lives here beside `playbackStep.ts` and
 * `playheadBeat.ts`, the same shape as the latter. Never a slice: it changes
 * on every chord, and a slice write re-renders every mounted view (R016).
 */
interface PlayingChord {
  index: number;
  chordId: string;
}

export interface PlayingChordPublisher {
  get(): PlayingChord | null;
  /**
   * Records `value` and notifies. A chord with the same index and id as the
   * current one is a no-op with no notify; `null` (a clear) always notifies,
   * because the chord view resets its held-card highlight on every notify.
   */
  set(value: PlayingChord | null): void;
  subscribe(listener: (value: PlayingChord | null) => void): () => void;
}

export function createPlayingChordPublisher(): PlayingChordPublisher {
  let current: PlayingChord | null = null;
  const listeners = new Set<(value: PlayingChord | null) => void>();
  return {
    get: () => current,
    set(value) {
      if (
        value !== null && current !== null
        && value.index === current.index && value.chordId === current.chordId
      ) return;
      current = value;
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The app's one playing chord, written by `useChordClockPlayback`. */
export const playingChord: PlayingChordPublisher = createPlayingChordPublisher();

const subscribeAdapter = (onChange: () => void) => playingChord.subscribe(() => onChange());

/**
 * The live playing chord. `getServerSnapshot` serves the same live value, so a
 * `renderToString` test sees what was published rather than a creation-time copy.
 */
export function usePlayingChord(): PlayingChord | null {
  return useSyncExternalStore(subscribeAdapter, playingChord.get, playingChord.get);
}
```

Run: `bun test src/components/playingChord.test.ts` → PASS (5 tests).

- [ ] **Step 4: Extend the host test (failing)** — in `src/components/playback/PlaybackHost.test.tsx` set:

```ts
const HOST_CALLS = [
  'useChordClockPlayback()',
  'useSequencerPlayback()',
] as const;

const CONTROLLERS = ['useChordClockPlayback', 'useSequencerPlayback'] as const;
```

Run: `bun test src/components/playback/PlaybackHost.test.tsx`
Expected: FAIL — `calls its controllers in clock-listener order` (index -1) and `useChordClockPlayback is called only by the host` (`[]`).

- [ ] **Step 5: Move the chord file and its test**

```bash
git mv src/components/loop/chord/useChordPlayback.ts src/components/playback/useChordClockPlayback.ts
git mv src/components/loop/chord/useChordPlayback.test.ts src/components/playback/useChordClockPlayback.test.ts
```

- [ ] **Step 6: Create `src/components/loop/chord/useChordAudition.ts`** — the two preview hooks move here with **bodies verbatim** (the `useCallback` bodies at old `useChordPlayback.ts:306-346` and `:365-428`, including their docblocks at `:287-299` and `:349-355`); only the parameter destructuring becomes narrow selectors:

```ts
import { useCallback } from 'react';
import { useAppStore } from '@/store/store';
import { playFullHoldChord, scheduleWholeChord } from '@/audio/playback/chordPlayback';
import { buildChordEvents } from '@/audio/playback/plan/chordEvents';
import type { RhythmPattern } from '@/data/chordRhythms';
import {
  cycleHoldScale,
  fullHoldDuration,
  isFullHoldBassCycle,
  isFullHoldRhythmCycle,
} from '@/audio/chordRhythms';
import type { PlaybackPatternCycle } from '@/audio/chordRhythms';
import { isApproachToken, resolveBassSteps } from '@/audio/bassPatterns';
import type { BassPattern } from '@/data/bassPatterns';
import { generateBlockChordNotes, stepDurationSec, barDurationSec } from '@/utils/musicTheory';
import { initPlaybackEngine, playbackNoteOff, playbackNoteOn } from '@/audio/playback/playbackEngine';
import type { ChordItem } from '@/types';
import { synthReleaseSeconds } from '@/utils/synthPatch';
import { activeStepsPerBar } from '@/components/playback/useChordClockPlayback';

/**
 * The chord view's audition players (DEV-422): the timer-driven pattern
 * previews, split from the transport controller, which now lives in
 * `PlaybackHost`. Nothing here subscribes the clock.
 */
export interface UseChordAudition {
  playChordWithRhythm(
    chord: ChordItem,
    startTime: number,
    cycle: PlaybackPatternCycle<RhythmPattern>,
  ): void;
  playBassWithPattern(
    chord: ChordItem,
    startTime: number,
    cycle: PlaybackPatternCycle<BassPattern>,
    chordContext?: ChordItem[],
  ): void;
}

/* <old docblock :287-299, verbatim> */
function useChordPatternPreview() {
  const bpm = useAppStore((s) => s.bpm);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const chordFeel = useAppStore((s) => s.chordFeel);
  return useCallback(
    (chord: ChordItem, startTime: number, cycle: PlaybackPatternCycle<RhythmPattern>) => {
      // … old body :308-343, verbatim …
    },
    [bpm, chordSynthParams, chordOctave, chordFeel],
  );
}

/* <old docblock :349-355, verbatim> */
function useBassPatternPreview() {
  const chords = useAppStore((s) => s.chords);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const bpm = useAppStore((s) => s.bpm);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const bassFeel = useAppStore((s) => s.bassFeel);
  return useCallback(
    (
      chord: ChordItem,
      startTime: number,
      cycle: PlaybackPatternCycle<BassPattern>,
      chordContext?: ChordItem[],
    ) => {
      // … old body :372-425, verbatim …
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams, bassFeel],
  );
}

export function useChordAudition(): UseChordAudition {
  const playChordWithRhythm = useChordPatternPreview();
  const playBassWithPattern = useBassPatternPreview();
  return { playChordWithRhythm, playBassWithPattern };
}
```

(The `/* <…> */` and `// … verbatim …` markers stand for code copied byte-for-byte from the named old lines; paste the real text, do not leave the markers.)

- [ ] **Step 7: Cut the audition half out of `src/components/playback/useChordClockPlayback.ts`**
  - Delete old lines `:287-429` (`useChordPatternPreview`, `useBassPatternPreview` and their docblocks).
  - Delete `interface ChordPlaybackState` and `useChordPlaybackState` (old `:253-285`), keeping the `// Master playback loop hook. Moved here …` comment above them, re-worded to: `// The transport half of the Chords player (DEV-422): mounted once, by PlaybackHost. Reads the store, reaches the engine only through the audio-layer bridge in playbackEngine.ts (layering rule 3).`
  - Replace `export function useChordPlayback() { … }` (old `:667-709`) with:

```ts
/**
 * The Chords player's clock controller: arms a chord on each bar line, emits
 * chord, bass and pad, soft-stops on the bar line and hard-stops all three
 * sources. The playing chord goes out through `playingChord` (R313), the
 * step through `playbackStep`, the transport readout through
 * `setPlayheadChord`.
 */
export function useChordClockPlayback(): void {
  const chords = useAppStore((s) => s.chords);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  // padSynthParams is deliberately NOT subscribed here: only `.release` is
  // ever read, and only at the soft-stop, which reads it live from getState()
  // exactly as armPad does. Subscribing would re-render this hook on every
  // frame of a pad knob drag for a value nothing renders.
  const playerState = useAppStore((s) => s.chordsPlayer);
  const isPlaying = playerState !== 'stopped';

  const scheduler = useChordScheduler();
  const releasesRef = useChordReleases(
    synthReleaseSeconds(chordSynthParams),
    synthReleaseSeconds(bassSynthParams),
  );

  // Both subscriptions clear the same three pieces of chord UI — the beat
  // markers, the highlighted card, and the transport's chord readout.
  const clearChordUi = useCallback(() => {
    playingChord.set(null);
    resetStep('chords');
    useAppStore.getState().setPlayheadChord(null);
  }, []);

  const showChord = useCallback((index: number, chord: ChordItem) => {
    playingChord.set({ index, chordId: chord.id });
  }, []);

  useChordStopHandler(scheduler, clearChordUi);
  useChordClock({
    scheduler,
    releasesRef,
    isPlaying,
    chords,
    clearChordUi,
    showChord,
  });
}
```

  - Replace the import block (old `:1-51`) with exactly what the remaining code uses:

```ts
import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store/store";
import { emitStepEvents, playFullHoldChord } from "@/audio/playback/chordPlayback";
import { chordPlanPosition } from "@/audio/playback/plan/chordEvents";
import { STEPS_PER_BAR, stepDurationSec } from "@/utils/musicTheory";
import {
  ACCOMPANIMENT_SOURCES,
  HARD_STOP_RELEASE,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopOwnedVoices,
  subscribePlaybackClock,
} from "@/audio/playback/playbackEngine";
import type { AccompanimentSource } from "@/audio/playback/playbackEngine";
import { getMeter } from "@/utils/meter";
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from "@/components/playerStop";
import type { PlayerState } from "@/store/types";
import type { ChordItem } from "@/types";
import { synthReleaseSeconds } from "@/utils/synthPatch";
import { publishStepAt, resetStep } from "@/components/playbackStep";
import { playingChord } from "@/components/playingChord";
import { planPadArm } from "@/audio/playback/plan/padPlan";
import {
  planChordArm,
  planChordStep,
  type ArmedChordPlan,
} from "@/audio/playback/plan/chordPlan";
import { chordPlanSnapshot, padPlanSnapshot } from "@/store/playbackPlanSnapshots";
```

  Everything else (`ChordArming` … `chordStepAction`, `useChordScheduler`, `useChordReleases`, `ChordSchedulerRefs`, `useChordStopHandler`, `useChordClock` with its two `exhaustive-deps` disables) is untouched. `bun run lint` (noUnusedLocals) flags any import left over.

- [ ] **Step 8: Mount it in the host** — `src/components/playback/PlaybackHost.tsx`: add `import { useChordClockPlayback } from './useChordClockPlayback';` and make the body

```tsx
export const PlaybackHost = React.memo(function PlaybackHost(): null {
  useChordClockPlayback();
  useSequencerPlayback();
  return null;
});
```

- [ ] **Step 9: The chord view consumes the two halves** — `src/components/loop/chord/useChordView.ts`:
  - line 12 `import { useChordPlayback } from './useChordPlayback';` → `import { useChordAudition } from './useChordAudition';` and add `import { playingChord } from '@/components/playingChord';`
  - line 76 `  const playback = useChordPlayback();` →

```ts
  const audition = useChordAudition();
  const isPlaying = useAppStore((s) => s.chordsPlayer !== 'stopped');
  // A held card's highlight. The clock's chord arrives through `playingChord`;
  // the two are last-writer-wins, as they were when both wrote one id, so a
  // publish (a new chord, or a clear) drops the held card's id.
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  useEffect(() => playingChord.subscribe(() => setActiveChordId(null)), []);
```

  - in the returned object (`:133-137`) replace `playback,` with `audition, isPlaying, activeChordId, setActiveChordId,`
  - `useHeldChordPreview` (`:347-348`): `const { chordOctave, chordSynthParams, playback } = state;` + `const { setActiveChordId } = playback;` → `const { chordOctave, chordSynthParams, setActiveChordId } = state;`
  - `usePatternPreviews` (`:411`): `state.playback` → `state.audition`
- `src/components/loop/ChordView.tsx:179`: `isPlaying={state.playback.isPlaying}` → `isPlaying={state.isPlaying}`
- `src/components/loop/chord/ProgressionCard.tsx`: add `import { usePlayingChord } from '@/components/playingChord';` to the imports; in `SortableProgression` replace `  const { playingIndex, activeChordId } = state.playback;` with

```tsx
  const { activeChordId } = state;
  const playing = usePlayingChord();
```

  and the highlight line (`:283`) with

```tsx
            const isActive =
              (playing !== null && (playing.index === idx || playing.chordId === chord.id))
              || activeChordId === chord.id;
```

- [ ] **Step 10: Tests and comments that follow the split**
  - `src/components/playback/useChordClockPlayback.test.ts`: import from `'./useChordClockPlayback'`; the three `'src/components/loop/chord/useChordPlayback.ts'` paths → `'src/components/playback/useChordClockPlayback.ts'`; the three `describe('useChordPlayback …'` titles → `describe('useChordClockPlayback …'`. Assertions unchanged (the file still has two `playbackStopOwnedVoices(` and `planChordStep(plan, {`).
  - `src/components/loop/ChordView.test.tsx`: delete `describe('ChordView playback wiring', …)` (`:73-86`; its "exactly one chord scheduler" guarantee is now `PlaybackHost.test.tsx`'s `useChordClockPlayback is called only by the host`) and the now-unused `import { readFileSync } from 'node:fs';` (`:2`).
  - `src/components/loop/chord/useChordView.test.ts:32`: `` `useAppStore`, `useChordPlayback` and several `useMemo`s `` → `` `useAppStore`, `useChordAudition` and several `useMemo`s ``.
  - `src/components/playbackStep.wiring.test.ts:49` and `:178`: `'src/components/loop/chord/useChordPlayback.ts'` → `'src/components/playback/useChordClockPlayback.ts'`.
  - `src/architecture/schedulingFocusIndependence.test.ts`: `:40` → `'src/components/playback/useChordClockPlayback.ts',`; comments `:11` and `:74` `useChordPlayback` → `useChordClockPlayback`.
  - Comments only: `src/components/playbackStep.ts:227` `chord-bass playback` → `` `useChordClockPlayback` ``; `src/audio/playback/playbackEngine.ts:7` `(useChordPlayback, useSequencerPlayback)` → `(useChordClockPlayback, useSequencerPlayback — mounted by PlaybackHost)`; `src/store/loadLoop.ts:193` `useChordPlayback's` → `useChordClockPlayback's`; `src/data/chordRhythms.ts:5` `(useChordPlayback is its one consumer)` → `(the chord playback and audition hooks are its consumers)`; `src/audio/playback/plan/chordEvents.test.ts:131` `useChordPlayback.test.ts` → `useChordClockPlayback.test.ts`.
  - Verify: `grep -rn "useChordPlayback" src` → no hits.

- [ ] **Step 11: Run the tests and gates**

Run: `bun test src/components/playback src/components/playingChord.test.ts src/components/loop src/components/playbackStep.wiring.test.ts src/architecture`
Expected: PASS.
Then: `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production` → green, zero warnings (watch `max-lines-per-function` on `useChordViewState` and `complexity` on the `chords.map` callback in `SortableProgression`); golden diff empty.

- [ ] **Step 12: Commit**

```bash
git add -A src/components/playback src/components/playingChord.ts src/components/playingChord.test.ts \
  src/components/loop/chord src/components/loop/ChordView.tsx src/components/loop/ChordView.test.tsx \
  src/components/playbackStep.wiring.test.ts src/architecture/schedulingFocusIndependence.test.ts \
  src/components/playbackStep.ts src/audio/playback/playbackEngine.ts src/store/loadLoop.ts \
  src/data/chordRhythms.ts src/audio/playback/plan/chordEvents.test.ts
git commit -m "refactor(playback): split the chord controller into clock and audition halves (DEV-422)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Lead and FX controllers into the host; host at its final position

**Files:**
- Move: `src/components/loop/lead/useLeadPlayback.ts` (+ `.test.ts`), `src/components/loop/lead/useLeadStepPublisher.ts` (+ `.test.ts`) → `src/components/playback/`
- Modify: `src/components/playback/PlaybackHost.tsx`, `PlaybackHost.test.tsx`; `src/components/loop/lead/LeadMelodyGrid.tsx` (`:10-11`, `:187-203`, `:242-252`); `src/App.tsx` (`<main>`); `src/components/playbackStep.wiring.test.ts` (`:99`); `src/architecture/schedulingFocusIndependence.test.ts` (`:38-39`)

**Interfaces:**
- Consumes: host + test arrays (Tasks 1–2).
- Produces: `@/components/playback/useLeadPlayback` (`LeadArming`, `LeadStepAction`, `leadStepAction`, `useLeadPlayback(trackId: MelodyTrackId): { isPlaying: boolean }`), `@/components/playback/useLeadStepPublisher` (`leadMarkerPublishes`, `useLeadStepPublisher(trackId: MelodyTrackId): void`) — names unchanged. Final host body (spec §4).

- [ ] **Step 1: Extend the host test (failing)** — `src/components/playback/PlaybackHost.test.tsx`:

```ts
const HOST_CALLS = [
  "useLeadPlayback('lead')",
  "useLeadStepPublisher('lead')",
  "useLeadPlayback('fx')",
  "useLeadStepPublisher('fx')",
  'useChordClockPlayback()',
  'useSequencerPlayback()',
] as const;

const CONTROLLERS = [
  'useLeadPlayback',
  'useLeadStepPublisher',
  'useChordClockPlayback',
  'useSequencerPlayback',
] as const;
```

Run: `bun test src/components/playback/PlaybackHost.test.tsx`
Expected: FAIL — order test (index -1) and the two lead "called only by the host" tests (sites are `LeadMelodyGrid.tsx`).

- [ ] **Step 2: Move the files**

```bash
git mv src/components/loop/lead/useLeadPlayback.ts src/components/playback/useLeadPlayback.ts
git mv src/components/loop/lead/useLeadPlayback.test.ts src/components/playback/useLeadPlayback.test.ts
git mv src/components/loop/lead/useLeadStepPublisher.ts src/components/playback/useLeadStepPublisher.ts
git mv src/components/loop/lead/useLeadStepPublisher.test.ts src/components/playback/useLeadStepPublisher.test.ts
```

  Both sources already import only `@/…` paths. In the tests: `useLeadPlayback.test.ts` `:30, :40` and `useLeadStepPublisher.test.ts:106` paths `src/components/loop/lead/…` → `src/components/playback/…`. In `useLeadStepPublisher.ts`, replace the docblock lines `:63-65`

```
 * Mounted beside useLeadPlayback in LeadMelodyGrid, which renders once per
 * melody track. The cost of a second grid is one more clock listener, not one
 * more timer.
```

  with

```
 * Mounted beside useLeadPlayback in PlaybackHost, once per melody track. The
 * cost of the second track is one more clock listener, not one more timer.
```

- [ ] **Step 3: Final host body** — `src/components/playback/PlaybackHost.tsx`: add `import { useLeadPlayback } from './useLeadPlayback';` and `import { useLeadStepPublisher } from './useLeadStepPublisher';`, body:

```tsx
export const PlaybackHost = React.memo(function PlaybackHost(): null {
  // Two hooks per melody track, two gates, on purpose: useLeadPlayback
  // schedules NOTES while the track's player plays; useLeadStepPublisher moves
  // the MARKER, which for a Rec-armed track also follows somebody else's clock.
  useLeadPlayback('lead');
  useLeadStepPublisher('lead');
  useLeadPlayback('fx');
  useLeadStepPublisher('fx');
  useChordClockPlayback();
  useSequencerPlayback();
  return null;
});
```

- [ ] **Step 4: Remove the grid's calls** — `src/components/loop/lead/LeadMelodyGrid.tsx`:
  - delete imports `:10-11` (`useLeadPlayback`, `useLeadStepPublisher`)
  - delete the comment `:242-250` and the two calls `:251-252` at the top of `LeadMelodyGrid`
  - replace the free comment block `:187-203` (from `// Mounted here, not in the view that renders it: the step used to arrive as` to `// and nothing else. … than this whole body.`, i.e. everything above the `` `trackId` is REQUIRED `` paragraph) with:

```tsx
// The marker's step subscription is mounted here, not in the view that renders
// it: the step used to arrive as a prop, so all 174 JSX nodes of the
// then-1208-line synth view reconciled 8x/sec to move one translateX.
// LeadMelodyGrid is mounted once PER TRACK (PatternView.tsx, the Lead and FX
// segments).
//
// The track's controllers are NOT mounted here. useLeadPlayback (notes, hard
// stop) and useLeadStepPublisher (the marker's step, including the Rec-armed
// write head) live in PlaybackHost (components/playback/), once per track, so
// the lane sounds whether or not this grid is mounted. useLeadMarkerColumn
// reads the publisher's gate from inside LeadMarker, so the published step
// re-renders one div rather than this whole body.
//
```

  (the `` // `trackId` is REQUIRED … `` paragraph after it stays as is).

- [ ] **Step 5: Host to its final position** — `src/App.tsx` `<main>`: delete the interim `{/* Every transport controller, mounted once … */}` comment and `<PlaybackHost />` between the two wrappers, and insert before the `<LoopPage />` wrapper `div`:

```tsx
        {/* Every transport controller, mounted once (DEV-422, R312): a lane
            sounds because this is mounted, never because its grid is. Before
            the pages, so its hook order is the clock-listener order. */}
        <PlaybackHost />
```

- [ ] **Step 6: Paths in the wiring guards**
  - `src/components/playbackStep.wiring.test.ts:99` → `file: 'src/components/playback/useLeadStepPublisher.ts',`
  - `src/architecture/schedulingFocusIndependence.test.ts:38-39` → `'src/components/playback/useLeadStepPublisher.ts',` and `'src/components/playback/useLeadPlayback.ts',`
  - Verify: `grep -rn "loop/lead/useLeadPlayback\|loop/lead/useLeadStepPublisher\|'./useLeadPlayback'\|'./useLeadStepPublisher'" src` → hits only inside `src/components/playback/`.

- [ ] **Step 7: Run the tests and gates**

Run: `bun test src/components/playback src/components/loop/lead src/components/playbackStep.wiring.test.ts src/architecture src/App.test.tsx`
Expected: PASS (the host test sees the six calls in order, and `useLeadPlayback`/`useLeadStepPublisher` each at `[{ file: HOST_FILE, count: 2 }]`).
Then: `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production` → green, zero warnings; golden diff empty. Also `grep -rnE "use(LeadPlayback|LeadStepPublisher|ChordClockPlayback|SequencerPlayback)\(" src/components/loop src/components/song` → comments only.

- [ ] **Step 8: Commit**

```bash
git add -A src/components/playback src/components/loop/lead src/App.tsx \
  src/components/playbackStep.wiring.test.ts src/architecture/schedulingFocusIndependence.test.ts
git commit -m "refactor(playback): move the Lead and FX controllers into PlaybackHost (DEV-422)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The arp hook leaves `src/audio/`; ban `react` there; full gate

**Files:**
- Create: `src/components/playback/useArpPlayback.ts`, `src/audio/playback/startArpClock.test.ts`, `src/architecture/audioReactBan.test.ts`
- Modify: `src/audio/playback/arpPlayback.ts` (`:1`, `:13-14`, `:139-219`), `src/audio/playback/arpPlayback.test.ts` (`:121` comment), `src/components/useInputDeck.ts` (`:4`), `eslint.config.js` (new const near `TONAL_SCOPED_PACKAGE_BAN`; blocks at `src/audio/**`, `src/audio/playback/plan/**`, `renderMidi.ts`/`smfWriter.ts`, engine runtime), `src/components/playback/PlaybackHost.test.tsx`

**Interfaces:**
- Consumes: `ArpStateRef`, `computeArpTick`, `releaseTriggeredTargets` (same file, unchanged).
- Produces: `export function startArpClock(stateRef: ArpStateRef): () => void` in `@/audio/playback/arpPlayback`; `export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void` in `@/components/playback/useArpPlayback`; `REACT_IMPORT_BAN` in `eslint.config.js`.

- [ ] **Step 1: Write the failing tests**

`src/architecture/audioReactBan.test.ts`:

```ts
/**
 * R314 (DEV-422): src/audio/ imports neither react nor react-dom. The ban is
 * spread into each of the four src/audio/ import blocks, because every block
 * that sets the rule REPLACES the broader one — one file per block here.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

/** renderMidi.ts's block uses the TS-aware rule id, so both are guarded. */
const GUARDED = new Set(['no-restricted-imports', '@typescript-eslint/no-restricted-imports']);

async function importErrors(source: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => GUARDED.has(m.ruleId ?? '') && m.severity === 2).length;
}

const REACT = "import { useEffect } from 'react';\nexport const E = useEffect;\n";
const REACT_DOM = "import { createPortal } from 'react-dom';\nexport const P = createPortal;\n";
const REACT_DOM_SERVER = "import { renderToString } from 'react-dom/server';\nexport const R = renderToString;\n";

describe('src/audio/ imports no react (R314)', () => {
  for (const filePath of [
    'src/audio/playback/x.ts',
    'src/audio/playback/plan/x.ts',
    'src/audio/export/renderMidi.ts',
    'src/audio/masterRack.ts',
  ]) {
    test(`react is an error at ${filePath}`, async () => {
      expect(await importErrors(REACT, filePath)).toBeGreaterThan(0);
    });
  }

  test('react-dom and its subpaths are errors too', async () => {
    expect(await importErrors(REACT_DOM, 'src/audio/playback/x.ts')).toBeGreaterThan(0);
    expect(await importErrors(REACT_DOM_SERVER, 'src/audio/playback/x.ts')).toBeGreaterThan(0);
  });

  test('a component-layer controller may import react', async () => {
    expect(await importErrors(REACT, 'src/components/playback/x.ts')).toBe(0);
  });
});
```

`src/audio/playback/startArpClock.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../engine';
import { startArpClock, type ArpStateRef } from './arpPlayback';
import { TRACK_ARP_DEFAULTS } from '@/store/initialState';
import { useAppStore } from '@/store/store';
import type { SynthControlTarget } from '@/utils/synthControl';

function arpRef(): ArpStateRef {
  return {
    current: {
      heldTargets: new Map(),
      synth: useAppStore.getState().synthParams,
      arp: { ...TRACK_ARP_DEFAULTS.synth, active: true },
      target: 'synth',
      triggeredTargets: new Set<SynthControlTarget>(),
      bpm: 120,
    },
  };
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

describe('startArpClock', () => {
  test('subscribes the clock once and unsubscribes on cleanup', () => {
    let unsubscribed = 0;
    const subscribe = spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => { unsubscribed++; });
    spies.push(subscribe, spyOn(audioEngine, 'getAudioContext').mockImplementation(() => null));
    const stop = startArpClock(arpRef());
    expect(subscribe).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribed).toBe(1);
  });

  test('cleanup releases the buses on the LATEST ref, not the one it started with', () => {
    const released: Array<[string, string]> = [];
    spies.push(
      spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => {}),
      spyOn(audioEngine, 'getAudioContext').mockImplementation(() => ({}) as BaseAudioContext),
      spyOn(audioEngine, 'releaseSoundingVoices').mockImplementation((target, _time, owner) => {
        released.push([target, owner]);
      }),
    );
    const ref = arpRef();
    const stop = startArpClock(ref);
    ref.current = { ...ref.current, triggeredTargets: new Set<SynthControlTarget>(['synth', 'fx']) };
    stop();
    expect(new Set(released.map(([target]) => target))).toEqual(new Set(['synth', 'fx']));
    expect(released.every(([, owner]) => owner === 'arp')).toBe(true);
  });
});
```

In `src/components/playback/PlaybackHost.test.tsx` add, after the `describe('PlaybackHost', …)` block:

```ts
describe('the arp controller', () => {
  // Not a transport controller: it follows held keys, so it stays mounted by
  // the input deck (spec §5.4) — and only there.
  test('useArpPlayback is called only by useInputDeck', () => {
    expect(callSites('useArpPlayback')).toEqual([{ file: 'src/components/useInputDeck.ts', count: 1 }]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/architecture/audioReactBan.test.ts src/audio/playback/startArpClock.test.ts src/components/playback/PlaybackHost.test.tsx`
Expected: FAIL — the four `react is an error at …` tests and the `react-dom` test (0 errors), and `startArpClock.test.ts` (`startArpClock` is not exported). The component-layer test and the arp call-site guard already pass (`arpPlayback.ts` declares the hook, it does not call it); the guard stays as a regression pin.

- [ ] **Step 3: `startArpClock`** — in `src/audio/playback/arpPlayback.ts`:
  - delete line 1 `import { useEffect } from 'react';`
  - line 13-14 comment → `// The rate table and trigger math live in audio/arpSchedule.ts so the chord` / `// scheduler can share them without pulling the arp clock into its module.`
  - in the docblock above the hook (`:139-159`), replace its first sentence (`` * Arpeggiator clock subscriber, moved from SoundView 281-405 with the 4 rate `` / `` * branches collapsed into computeArpTriggers. ``) with `` * Arpeggiator clock subscriber: subscribes the shared clock and returns the `` / `` * cleanup; the React wrapper is `components/playback/useArpPlayback.ts` (R314). ``, and in its second paragraph `effect's dependency array` → `wrapper's dependency array`. The rest of the docblock stays.
  - replace `export function useArpPlayback(…) { useEffect(() => { … }, [active, stateRef]); }` (`:160-219`) with the same body as a plain function:

```ts
export function startArpClock(stateRef: ArpStateRef): () => void {
  const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
    const { heldTargets, synth, arp, target, bpm } = stateRef.current;

    if (!arp.active) return;
    // Focus is on the drum track: the melodic keyboard has nothing to play,
    // so the arp has nothing to arpeggiate.
    if (target === null) return;

    const { sequence, triggers } = computeArpTick(
      stateRef.current.triggeredTargets,
      target,
      heldTargets,
      arp,
      bpm,
      step,
      audioEngine.getMeter().stepsPerBar,
    );

    const releaseSeconds = synthReleaseSeconds(synth);
    for (const t of triggers) {
      const note = sequence[t.noteIndex];
      const at = time + t.timeOffsetSec;
      // The ID is held only long enough to book this hit's own note-off.
      // Nothing outlives the tick: a key-up releases through
      // `releaseTriggeredTargets` below, which is owner-scoped and reaches
      // whatever the arp still has sounding on the bus.
      const voiceId = audioEngine.triggerSynthNoteOn(noteFrequency(note), synth, 0.9, at, target, 1, 'arp');
      if (voiceId) audioEngine.triggerSynthNoteOff(voiceId, releaseSeconds, at + t.holdSec);
    }
  });

  return () => {
    unsubscribe();
    // Read release/targets off the ref, NOT from arguments: having them in the
    // wrapper's dependency array made every Release-knob pointer move tear the
    // subscription down and run this cleanup, cutting every held arp note
    // mid-drag.
    //
    // Release EVERY bus this clock has triggered on, not whichever one is
    // current at cleanup time. A focus change mid-hold leaves sounding
    // voices on more than one bus, and one captured target releases only
    // one of them — the same stranded-voice failure reached by a different
    // route. `triggeredTargets` is written at trigger time, so a bus that
    // was never actually played is never released.
    if (audioEngine.getAudioContext()) {
      // Reading the LATEST ref at cleanup time is the whole point; copying it
      // at start would restore the stale-target bug.
      const { triggeredTargets, synth } = stateRef.current;
      releaseTriggeredTargets(triggeredTargets, synthReleaseSeconds(synth), (target, releaseTime, owner) => {
        audioEngine.releaseSoundingVoices(target, releaseTime, owner);
      });
    }
  };
}
```

  (The `eslint-disable-next-line react-hooks/exhaustive-deps` disappears with the hook, spec §5.4.)
  - `src/audio/playback/arpPlayback.test.ts:121`: `the clock callback in useArpPlayback is not` → `the clock callback in startArpClock is not`.

- [ ] **Step 4: The React wrapper** — create `src/components/playback/useArpPlayback.ts`:

```ts
import { useEffect } from 'react';
import { startArpClock, type ArpStateRef } from '@/audio/playback/arpPlayback';

/**
 * The arp's React half (DEV-422, R314): holds `startArpClock`'s subscription
 * while `active`. The body stays in `src/audio/` because it calls the engine
 * directly, which a component may not (R038).
 *
 * Mounted by the input deck, not by `PlaybackHost`: the arp follows held keys,
 * not the transport. `stateRef` is a stable ref; `startArpClock` reads it live
 * on every tick and again at cleanup.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void {
  useEffect(() => (active ? startArpClock(stateRef) : undefined), [active, stateRef]);
}
```

  `src/components/useInputDeck.ts:4` → `import { releaseTriggeredTargets, type ArpStateRef } from '../audio/playback/arpPlayback';` plus a new line `import { useArpPlayback } from '@/components/playback/useArpPlayback';`. The call at `:726` is unchanged.

- [ ] **Step 5: The ESLint ban** — in `eslint.config.js`, after `TONAL_SCOPED_PACKAGE_BAN`, add:

```js
// DEV-422 (R314): src/audio/ is plain TypeScript over Web Audio — no React.
// A hook that drives an audio clock keeps its body in audio/ as a plain
// function (startArpClock) and its React wrapper in components/playback/.
// Spread into all four src/audio/ blocks that set the import rule, because
// each REPLACES the broader one (see TAPER_CONVERSION_BAN).
const REACT_IMPORT_BAN = {
  paths: [
    { name: 'react', message: 'src/audio/ imports no react (R314): put the hook in src/components/playback/.' },
    { name: 'react-dom', message: 'src/audio/ imports no react-dom (R314).' },
  ],
  patterns: [
    { group: ['react-dom/*'], message: 'src/audio/ imports no react-dom (R314).' },
  ],
};
```

  In each of the four blocks — `files: ['src/audio/**/*.{ts,tsx}']`, `files: ['src/audio/playback/plan/**/*.{ts,tsx}']`, `files: ['src/audio/export/renderMidi.ts', 'src/audio/export/smfWriter.ts']` (inside `@typescript-eslint/no-restricted-imports`), and `files: ['src/audio/engine.ts', 'src/audio/synth/**/*.{ts,tsx}', …]` — change `paths: [TONAL_IMPORT_BAN],` to `paths: [TONAL_IMPORT_BAN, ...REACT_IMPORT_BAN.paths],` and add `...REACT_IMPORT_BAN.patterns,` as the last entry of that block's `patterns` array. Verify: `grep -n "REACT_IMPORT_BAN" eslint.config.js` → the declaration plus eight uses.

- [ ] **Step 6: Run the tests**

Run: `bun test src/architecture/audioReactBan.test.ts src/audio/playback src/components/playback`
Expected: PASS. Also `grep -rln "from ['\"]react" src/audio` → no output.

- [ ] **Step 7: Full completion gate**

Run: `bun run verify`
Expected: green — all tests, `lint`, `eslint` with zero errors and zero warnings, `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans at zero findings, the build. Also: `git diff --stat 9ccfe260 -- src/audio/export/renderMixdownGolden*` → empty; `git diff 9ccfe260 -- package.json` → empty.

Manual pass (spec §10), `bun run dev`: play/stop each lane from each tab, soft stop lands on the bar line, the chord card highlight follows the progression and a held card lights until the next chord, the Rec-armed lead marker moves, the arp plays and releases on key-up and on focus change.

- [ ] **Step 8: Commit**

```bash
git add src/audio/playback/arpPlayback.ts src/audio/playback/arpPlayback.test.ts src/audio/playback/startArpClock.test.ts \
  src/components/playback/useArpPlayback.ts src/components/playback/PlaybackHost.test.tsx src/components/useInputDeck.ts \
  src/architecture/audioReactBan.test.ts eslint.config.js
git commit -m "refactor(audio): move the arp hook out of src/audio and ban react there (DEV-422)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ADR-0039, rules R312–R314, R040 inverted, doc sync

**Files:**
- Create: `docs/decisions/0039-playback-host.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/0001-always-mounted-views.md`, `docs/decisions/0002-four-layer-import-architecture.md`, `docs/decisions/0027-planned-then-performed-playback.md`, `CLAUDE.md`, `.claude/rules/playback.md`, `.claude/rules/components.md`, `.claude/rules/boundaries-and-gates.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,01-ui,03-audio,04-domain-and-dependencies}.md`

**Interfaces:**
- Consumes: every name from Tasks 1–4 — `PlaybackHost`, `useChordClockPlayback`, `useChordAudition`, `playingChord`/`usePlayingChord`, `useLeadPlayback`, `useLeadStepPublisher`, `useSequencerPlayback`, `useArpPlayback`, `startArpClock`, `REACT_IMPORT_BAN`.
- Produces: rules R312–R314 (next free after R311), ADR-0039. No code.

Rule texts (used verbatim below):
- **R040** — Transport controllers are mounted once, in `PlaybackHost`: a lane sounds because the host is mounted, never because its grid is.
- **R312** — `PlaybackHost` (`components/playback/PlaybackHost.tsx`) is the only mount of the transport controllers (`useLeadPlayback`, `useLeadStepPublisher`, `useChordClockPlayback`, `useSequencerPlayback`), each called there in clock-listener order; a view never calls one.
- **R313** — The playing chord travels through `components/playingChord.ts`, never a slice; the chord view's held-card id is local state reset on every publish.
- **R314** — `src/audio/` imports neither `react` nor `react-dom` (`REACT_IMPORT_BAN` in every `src/audio/` import block); a React wrapper over an audio clock lives in `components/playback/`.

- [ ] **Step 1: ADR-0039.** Create `docs/decisions/0039-playback-host.md` with the template's sections (see ADR-0038 for shape): `# ADR-0039: PlaybackHost — transport controllers out of the grids`, `**Status:** Accepted — 2026-09-22. DEV-422`, `## Context`, `## Decision`, `## Rejected alternatives`, `## Consequences`, `## Rules this implies`, `## Sources`. Content:
  - **Context:** structure audit U4/A3 — each lane sounded only because its grid was mounted (R040), so `components/` views were not dumb about audio; A5 — `arpPlayback.ts` was the one `src/audio/` file importing `react`; the always-mounted rule (ADR-0001) doubled as the reason audio kept playing.
  - **Decision:** spec §3–§5, one bullet each: `components/playback/` holds the controllers used by no single view; `PlaybackHost` returns `null`, `React.memo`, rendered once before `<LoopPage />`, hook order = clock-listener order (lead, lead publisher, fx, fx publisher, chord, sequencer), then `ArrangeView`; `useLeadStepPublisher` moves too (store + clock in, pub/sub out); the chord controller split into `useChordClockPlayback` (host) and `useChordAudition` (chord view); the playing chord on `components/playingChord.ts` (content-equal no-op, a clear always notifies), the held-card id local to the view and reset on every publish (last-writer-wins preserved); the arp body is `startArpClock` in `audio/`, its wrapper `components/playback/useArpPlayback.ts`, still mounted by the input deck (held-key driven); `REACT_IMPORT_BAN` on all four `src/audio/` blocks; the host is tested by a `renderToString` smoke and a source composition test.
  - **Rejected alternatives:** keep the controllers in the grids (R040 stays true, views stay audio-aware); a store slice for the playing chord (a per-chord write re-renders every mounted view, R016); moving the arp into the host (it follows held keys, not the transport); a `playbackEngine` bridge per arp engine call (four bridges for one plain function); `mock.module` spies to observe subscriptions (process-wide in Bun, leaks across files); adding `happy-dom` for one test.
  - **Consequences:** R040 inverted; R014/R015 keep their rule, with a new reason — views stay mounted for their UI state (scroll, drag, meter history, local state); audio no longer depends on mounting, so unmounting a view is a UI change, not a silence. `SortableProgression` re-renders on a chord change instead of the whole `ChordView` body. The golden and `bun run verify` did not change.
  - **Supersedes in part ADR-0001** (its R040 and the "a lane sounds because its grid is mounted" reasoning) and **amends ADR-0002** (R039's controller list) and **ADR-0027** (R230's controller file names).
  - **Rules this implies:** R040 (inverted), R312, R313, R314 — texts above.
  - **Sources:** DEV-422; `docs/superpowers/specs/2026-09-22-dev-422-playback-host-design.md`; `docs/superpowers/plans/2026-09-22-dev-422-playback-host.md`; ADR-0001, ADR-0002, ADR-0027.
  Add the index row to `docs/decisions/README.md` after the 0038 row:
  `| [0039](0039-playback-host.md) | PlaybackHost — transport controllers out of the grids | One memoized PlaybackHost mounts every transport controller in clock-listener order; the chord controller split into clock and audition halves, the playing chord on a pub/sub; no react under src/audio/. |`

- [ ] **Step 2: ADR-0001, ADR-0002, ADR-0027 in place.**
  - ADR-0001: Context's last sentence (`and the live playback controllers that make a lane sound are mounted inside the grids that show it.`) gains ` (Superseded by ADR-0039: they are mounted once, in PlaybackHost.)`; the Decision paragraph `The live playback controllers — … one more reason every view stays mounted.` is prefixed `**Superseded by [ADR-0039](0039-playback-host.md).**`; the Consequence bullet `Unmounting a grid silences its lane, …` is suffixed ` — superseded by ADR-0039: unmounting a view no longer silences anything, but it still loses the view's UI state.`; `## Rules this implies` R040 → the new R040 text with ` (inverted by ADR-0039)`.
  - ADR-0002: the Decision paragraph naming the controllers (`The controllers — useChordPlayback, …`) and its "a lane sounds because its grid is mounted" clause → the controllers are `components/playback/*` (`useChordClockPlayback`, `useLeadPlayback`, `useLeadStepPublisher`, `useSequencerPlayback`, `useArpPlayback`), `useInputDeck`, `usePlayheadSync` and the pub/subs, mounted by `PlaybackHost` (ADR-0039); R039's list in `## Rules this implies` likewise.
  - ADR-0027 (`:39`, `:113`): `useChordPlayback.ts` → `useChordClockPlayback.ts` (both occurrences).

- [ ] **Step 3: `.claude/rules/playback.md`.**
  - `paths:` add `  - "src/components/playback/**"` and `  - "src/components/playingChord.ts"` after `"src/components/playheadBeat.ts"`.
  - R017 bullet: `` `src/components/playbackStep.ts` and `playheadBeat.ts` `` → `` `src/components/playbackStep.ts`, `playheadBeat.ts` and `playingChord.ts` ``.
  - R039 bullet → `` - The controllers in `components/playback/` (`useChordClockPlayback`, `useLeadPlayback`, `useLeadStepPublisher`, `useSequencerPlayback`, `useArpPlayback`), `useInputDeck`, `usePlayheadSync` and the pub/subs live in `components/` and reach audio via `audio/playback/playbackEngine`, never `audio/engine`. <!-- R039 --> ``
  - R230 bullet: `(`useChordPlayback.ts`, `useLeadPlayback.ts`)` → `(`useChordClockPlayback.ts`, `useLeadPlayback.ts`)`.
  - After the R039 paragraph's `([ADR-0002](…))` add:

```markdown
## PlaybackHost

- Transport controllers are mounted once, in `PlaybackHost`: a lane sounds because the host is mounted, never because its grid is. <!-- R040 -->
- `PlaybackHost` (`components/playback/PlaybackHost.tsx`) is the only mount of the transport controllers (`useLeadPlayback`, `useLeadStepPublisher`, `useChordClockPlayback`, `useSequencerPlayback`), each called there in clock-listener order; a view never calls one. <!-- R312 -->
- The playing chord travels through `components/playingChord.ts`, never a slice; the chord view's held-card id is local state reset on every publish. <!-- R313 -->

([ADR-0039](../../docs/decisions/0039-playback-host.md))
```

  - `## Prohibited` gains:

```markdown
- A lane that sounds because its grid is mounted <!-- R040 -->
- A view calling a transport controller, or a controller mounted anywhere but `PlaybackHost` <!-- R312 -->
- The playing chord in a slice, or the clock writing the view's held-card state <!-- R313 -->
```

- [ ] **Step 4: `boundaries-and-gates.md` and `components.md`.**
  - `boundaries-and-gates.md` `## Import bans`, after the R179 paragraph's ADR link add `` - `src/audio/` imports neither `react` nor `react-dom` (`REACT_IMPORT_BAN` in every `src/audio/` import block); a React wrapper over an audio clock lives in `components/playback/`. <!-- R314 --> ([ADR-0039](../../docs/decisions/0039-playback-host.md)) ``; `## Prohibited` gains `` - A `react` or `react-dom` import under `src/audio/` <!-- R314 --> ``.
  - `components.md` `## Placement`, after the R276 bullet add `` - A transport controller is not a view's colocated hook: it lives in `components/playback/` and is mounted by `PlaybackHost` (R312, `playback.md`). ``

- [ ] **Step 5: CLAUDE.md.**
  - `### Everything stays mounted`: the R014 bullet gains, before its marker, ` Views stay mounted to keep their UI state (scroll, drag, meter history, local state).`; R015 bullet → `` - Audio never stops when switching tabs: it does not depend on mounting at all (R040). <!-- R015 --> ``; the R040 bullet → `` - Transport controllers are mounted once, in `PlaybackHost`: **a lane sounds because the host is mounted, never because its grid is**. <!-- R040 --> ``; the `Why:` line → `` Why: `docs/decisions/0001-always-mounted-views.md`, `docs/decisions/0039-playback-host.md`. ``
  - Layer map: `src/components/` row rule → `` Views, plus the live playback controllers in `components/playback/` (mounted once by `PlaybackHost`); must not import `audio/engine`. <!-- R038 --> ``; `src/audio/` row gains `` No `react`/`react-dom`. <!-- R314 --> `` and its ADR column gains `, [0039](docs/decisions/0039-playback-host.md)`.
  - Rules table, `playback.md` row → "Clock, store→engine bridge, `PlaybackHost`, planned-then-performed playback, song timeline, snapshots, pub/subs".

- [ ] **Step 6: Architecture docs** (audit snapshots: update names/paths and the facts that changed, add no line numbers — R001).
  - `docs/architecture/feature-overview.md`: the `components/` row → "React views **and**, in `components/playback/`, the transport controller hooks mounted by `PlaybackHost` (`useChordClockPlayback`, `useLeadPlayback`, `useSequencerPlayback`) plus `useInputDeck`"; the sequence diagram participant → `Controller hook (components/playback/: useChordClockPlayback / useLeadPlayback)`; any "mounted inside the grids" wording → "mounted by `PlaybackHost`".
  - `structure/README.md`: the mermaid `Ctrls` node → `"Controller hooks mounted by PlaybackHost<br/>useChordClockPlayback · useLeadPlayback · useLeadStepPublisher · useSequencerPlayback<br/>useInputDeck · usePlayheadSync · playbackStep + playheadBeat + playingChord"` (keep its tail as is); the U4/A3 row's status → **Fixed (DEV-422)**; the A5 row → its hook half **Fixed (DEV-422)** (`startArpClock` in `audio/`, wrapper in `components/playback/`, `REACT_IMPORT_BAN`); the large-files bullet drops the `useChordPlayback.ts` mention if present.
  - `structure/01-ui.md`: the component-graph mermaid — the LeadMelodyGrid hooks node drops `useLeadPlayback · useLeadStepPublisher`, the `useChordView → chord/useChordPlayback` node → `chord/useChordView → chord/useChordAudition`, the `SG -. hook .-> USP` edge removed, and a `PlaybackHost` node under `App` with edges to the four controllers; the clock-subscriber prose and the controllers list → `components/playback/` paths; the file-size table row for `useChordPlayback.ts` → `playback/useChordClockPlayback.ts` with its current `wc -l`; the "mount point for `useChordPlayback`" / "`SequencerGrid` calls `useSequencerPlayback()`" / "`LeadMelodyGrid` calls `useLeadPlayback`" paragraph → "every transport controller is mounted by `PlaybackHost` in `App.tsx`; no grid mounts one"; the `useArpPlayback` bullet → the hook is `components/playback/useArpPlayback.ts` over `audio/playback/arpPlayback.ts`'s `startArpClock`; "Playback hooks are scattered" bullet → **Fixed (DEV-422)**: all in `components/playback/`.
  - `structure/03-audio.md`: the `arpPlayback.ts` module row → "`startArpClock` (plain function: clock subscription + latest-ref release, owner `'arp'`), `computeArpTick`, `releaseTriggeredTargets`; no React (R314)"; the `chordRhythms` consumers line `useChordPlayback` → `useChordAudition`, `useChordClockPlayback`; the clock-subscribers paragraph and the lane table → `components/playback/` names (`useArpPlayback` wraps `startArpClock`; the arp row's controller cell → `startArpClock` (`audio/playback/`) via `useArpPlayback` (`components/playback/`)); the two sequence-diagram participants `useChordPlayback` → `useChordClockPlayback`, `useArpPlayback` → `startArpClock`; the `stepInLoop` bullet path → `playback/useSequencerPlayback.ts`.
  - `structure/04-domain-and-dependencies.md`: the clock-subscriber file list → `components/playback/{useSequencerPlayback,useLeadPlayback,useLeadStepPublisher,useChordClockPlayback}.ts`; the large-files table row → `src/components/playback/useChordClockPlayback.ts` with its current `wc -l`; item "Playback controllers live in `components/`" → names the new paths and adds "mounted by `PlaybackHost` (DEV-422)".
  - Verify: `grep -rn "useChordPlayback" src .claude CLAUDE.md docs/architecture docs/decisions` → hits only in ADR-0039's history sentences (none elsewhere; spec §10); `grep -rn "grid is mounted" CLAUDE.md .claude docs/decisions docs/architecture` → only superseded/historical wording.

- [ ] **Step 7: Completion gate.** `bun run verify` → green (docs-only change; this proves nothing regressed since Task 4). Golden diff against `9ccfe260` empty.

- [ ] **Step 8: Commit**

```bash
git add docs/decisions/0039-playback-host.md docs/decisions/README.md docs/decisions/0001-always-mounted-views.md \
  docs/decisions/0002-four-layer-import-architecture.md docs/decisions/0027-planned-then-performed-playback.md \
  CLAUDE.md .claude/rules/playback.md .claude/rules/components.md .claude/rules/boundaries-and-gates.md \
  docs/architecture/feature-overview.md docs/architecture/structure/README.md docs/architecture/structure/01-ui.md \
  docs/architecture/structure/03-audio.md docs/architecture/structure/04-domain-and-dependencies.md
git commit -m "docs: ADR-0039 PlaybackHost, rules R312-R314 (DEV-422)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §0 facts F1–F22 | Verified against `9ccfe260`; departures under "Spec corrections" |
| §3 target layout, §3.1 publisher moves | Tasks 1 (folder, sequencer), 2 (chord halves, `playingChord`), 3 (lead + publisher), 4 (arp wrapper) |
| §4 host, JSX in `Workspace`, `memo`, `appChildMemo` | Task 1 (interim position, correction 1–2), Task 3 (final position) |
| §5.1 chord split, narrow selectors, `isPlaying` in the view | Task 2 |
| §5.2 `playingChord`, last-writer-wins highlight | Task 2 (correction 3) |
| §5.3 listener order | Global Constraints; order preserved per commit (correction 1); composition test in Tasks 1–3 |
| §5.4 arp `startArpClock` + wrapper | Task 4 (correction 6) |
| §6 file-by-file incl. comments-only list | Tasks 1–4 (each comment lands with the move it follows) |
| §7 tests (moved tests, `playingChord.test.ts`, host smoke + composition, ESLint ban, golden unchanged) | Tasks 1–4 (corrections 4–5) |
| §8 ADR-0039, R040 inverted, R014/R015 reason, R039 list, R312–R314, architecture docs | Task 5 |
| §9 risks K1–K6 | K1 Task 2 (sync `set` at the old call sites); K2/K3 exactly-once + order per commit, composition test; K4 bodies unchanged; K5 Task 4 verbatim body + `startArpClock.test.ts`; K6 `readFileSync` throws on a stale path |
| §10 acceptance | Task 3 (no controller call under `loop/`/`song/`), Task 4 (ban test, verify, manual pass), Task 5 (`useChordPlayback` grep) |
