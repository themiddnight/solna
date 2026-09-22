# DEV-420 Pure Song-Level Event Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `walkSongTimeline` / `buildSongTimeline` in `src/audio/playback/plan/songTimeline.ts` turns an arrangement snapshot into timed Chord/Bass/Pad/Lead/FX/drum events, and the offline mixdown renders by performing exactly those walk items. The WAV stays byte-identical.

**Architecture:** First a golden (WAV sha256 + engine-call log) is recorded on the untouched code. Then the pure half of `chordPlayback.ts` moves into `plan/chordEvents.ts` (closes audit A4, guarded by an import-graph test), drums get a planner (`plan/beatPlan.ts`, used live and offline), the snapshot types and arrangement planning move out of `export/renderMixdown.ts` into `plan/`, the walk is added, and finally `scheduleArrangement` becomes a loop that performs walk items one at a time (never collecting first — spec §6/F8).

**Tech Stack:** TypeScript, Bun test runner (`bun:test`), `node-web-audio-api` `OfflineAudioContext` in tests, raw Web Audio engine, ESLint flat config, Knip.

**Spec:** `docs/superpowers/specs/2026-09-22-dev-420-song-event-timeline-design.md` — binding. Read §0 (F8), §4, §5 and §6 before any task that touches the walk or the renderer.

## Global Constraints

- Branch: `refactor/dev-420-song-event-timeline` (already checked out; HEAD has the spec commit). Never push. Never commit on `main`.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Golden rule.** Task 1 commits `src/audio/export/renderMixdownGolden.test.ts`, `renderMixdownGolden.wav.sha256` and `renderMixdownGolden.calls.json`, recorded on the pre-refactor code. No later task edits any of those three files. Every later task runs `bun test src/audio/export/renderMixdownGolden.test.ts` and it must pass with the golden files byte-unchanged. **Never run with `GOLDEN_UPDATE=1` after Task 1.** A golden failure means the refactor changed behaviour: fix the code, never the golden (spec §11 R2 is the only exception and needs the user).
- **User-visible change: none.** The rendered WAV of any arrangement is byte-identical before and after (spec, header).
- Float expressions are copied token for token (spec §4.4, §11 R1): `startSec = time + ev.timeOffset`; `endSec = Math.max(startSec + 0.01, Math.min(startSec + ev.hold, chordEnd))`; Lead/FX `start = time + note.startOffsetSec`, `end = start + note.holdSec`; full holds `end = time + holdSec`; `fullHoldVelocity(n) = DEFAULT_VELOCITY * equalPowerVelocityScale(n)`.
- The walk's per-step emit order is part of the contract (R288): drums → chord full hold → bass full hold → chord step notes → bass step notes → pad → lead → FX, then `stepEnd`. The `pass` marker is yielded BEFORE `buildLoopVoices` for that pass.
- The renderer consumes `walkSongTimeline` incrementally, performing each item before resuming the walk; never collect the timeline before performing it (R288, spec §6/§12 D1).
- All new `plan/` files obey the planner purity ESLint block (R227): no store, no engine module (`@/audio/engine`, `playbackEngine`), no `AudioContext`, no wall clock, no timer, no `Math.random`. `../../` imports are banned repo-wide: inside `plan/` import other audio modules as `@/audio/<module>`.
- Note names are `ROOTS`-spelled (R064); events carry note names, never Hz — only the performer calls `noteFrequency` (R176).
- `mixdownLeadTrack`/`mixdownFxTrack` return `MelodyPlanSnapshot`; `songTrackVoice` is the one offline table of patch field + bus per track (Lead: `synthParams` / `'synth'`).
- `planBeatStep` returns a fresh array (no module-level scratch) and decides drum velocity (`DEFAULT_VELOCITY`) (spec §12 D4, D5).
- No renames of `MixdownSnapshot` / `MixdownLoop` (D2). No re-export shims anywhere: every importer of a moved symbol switches to its new module (D10, R006).
- `planLoopAudioAutomation` stays in `renderMixdown.ts` (D9).
- Gates: `bun run verify` is the completion gate (R004). `bun run eslint` prints **zero errors AND zero warnings** — never ignore a warning, never call one pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>` only for a legitimate exception; never relax a rule globally (R005, R264). Both Knip scans (`check:dead-code`, `check:dead-code:production`) report zero findings (R006).
- ESLint `max-lines-per-function` is 100 (skipping blanks/comments) and applies to tests too, including a `describe` callback: split large suites into several `describe` blocks. `max-lines` per file is 750. `complexity` warns at 20 — a warning is a failure here, so split functions (the walk is split into generator helpers joined with `yield*`).
- Every exported symbol needs an importer in another file (tests count for `check:dead-code`); do not export a type no second file names (R236). If Knip flags a type the spec lists as exported (e.g. `ArrangementPass`, `LoopVoices`, `MixdownBusState`) and no second file genuinely names it, drop the `export` and say so in your report — R236 and the zero-finding baseline win over the spec's export list; never add a contrived import to silence Knip.
- Components keep logic in colocated hooks; component tests use `renderToString` only (R257, R265+). This plan touches no component body.
- R001: no counts, versions or line numbers in any doc you write. A rule change updates its `.claude/rules/*.md` file AND its ADR in the same commit.
- Files over ~500 lines (`renderMixdown.ts`, `renderMixdown.test.ts`, `chordPlayback.ts`, `chordPlayback.test.ts`): inspect with Serena `get_symbols_overview`/`find_symbol` or read line ranges; do not dump whole files.
- Moved tests keep their exact names (spec §11 R6).

## File map

| File | Task | Change |
|---|---|---|
| `src/audio/export/renderMixdownGolden.test.ts` + `.wav.sha256` + `.calls.json` | 1 | **new**, never edited again |
| `src/audio/playback/plan/chordEvents.ts` (+ `.test.ts`) | 2 | **new** — pure chord helpers moved from `chordPlayback.ts`, plus `stepNoteWindow`, `fullHoldVelocity` |
| `src/audio/playback/chordPlayback.ts` (+ `.test.ts`) | 2 | loses moved symbols; emitters use the two helpers |
| `src/audio/playback/plan/chordPlan.ts` (+ `.test.ts`) | 2 | imports `./chordEvents` (A4 fix) |
| `src/architecture/playbackPlannerImportGraph.test.ts` | 2 | **new** — R289 graph guard |
| `src/components/loop/chord/useChordPlayback.ts`, `src/audio/export/renderMixdown.test.ts` | 2 | import paths only |
| `src/audio/playback/plan/beatPlan.ts` (+ `.test.ts`) | 3 | **new** — `planBeatStep` |
| `src/audio/beatSteps.ts`, `src/audio/beatSteps.test.ts` | 3 | **deleted** (tests move to `beatPlan.test.ts`) |
| `src/store/playbackPlanSnapshots.ts` | 3 | `beatPlanSnapshot` |
| `src/components/useSequencerPlayback.ts` (+ `.test.ts`), `src/components/sequencerStartup.test.ts` | 3 | use `planBeatStep`; `event.velocity` |
| `src/audio/playback/plan/songSnapshot.ts` | 4 | **new** — snapshot types + adapters moved from `renderMixdown.ts`, `beatSnapshotForLoop`, `songTrackVoice` |
| `src/audio/playback/plan/songTimeline.ts` (+ `.test.ts`) | 4, 5 | **new** — Task 4: `SongTrack`, moved `planArrangement`/`buildLoopVoices`; Task 5: walk/build |
| `src/audio/export/renderMixdown.ts` | 2–4, 6 | Task 6: perform loop |
| `src/audio/export/mixdownFixture.ts`, `src/store/mixdownSlice.ts`, `renderMixdown*.test.ts` | 4 | import paths; melody test simplifies |
| docs (ADR-0034, rules, architecture, CLAUDE.md, skill) | 7 | sync |

Order rationale: golden first (proof), then the A4 split (smallest, unblocks a pure `plan/`), then the Beat planner (needed by the walk), then pure moves of snapshot + arrangement code (combined, because `songTrackVoice` needs `SongTrack` and the renderer needs `songTrackVoice` once melody snapshots drop `params`), then the walk (tested standalone), then the renderer switches to it, then docs. Every commit leaves `bun run verify` green.

---

### Task 1: Golden recorded on the pre-refactor code

**Goal:** Pin today's rendered WAV and engine-call sequence before any production change (spec §9.1, acceptance 1).

**Files:**
- Create: `src/audio/export/renderMixdownGolden.test.ts`
- Create (generated): `src/audio/export/renderMixdownGolden.wav.sha256`, `src/audio/export/renderMixdownGolden.calls.json`

**Interfaces:**
- Consumes (all stable across the whole branch — the file must never need an edit): `renderMixdown` from `./renderMixdown`; `AudioEngine` from `../engine`; `mixdownLoop`, `mixdownSnapshot`, `mixdownMelodyBar`, `beatPatternFixture`, `beatMixFixture`, `FACTORY_EFFECTS` from `./mixdownFixture`; `SUBTRACTIVE_INIT` from `@/utils/synthPresets`; types from `@/types`, `@/types/synth`.
- **Do not import `MixdownSnapshot`/`MixdownLoop` from `./renderMixdown`** — they move in Task 4 and the file must stay untouched. Derive the types: `type Snapshot = Parameters<typeof renderMixdown>[0]; type Loop = Snapshot['loops'][number];`
- Produces: the three golden files.

- [ ] **Step 1: Write the test file**

```ts
/**
 * DEV-420 golden: recorded on the pre-refactor renderer and never edited by a
 * later commit of the branch. The WAV hash proves byte-identity (RNG
 * interleaving, graph wiring); the call log localises a failure to the first
 * differing engine call. Re-record only with GOLDEN_UPDATE=1, and only in a
 * commit that changes nothing else (see the DEV-420 spec, risk R2).
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from '../engine';
import { renderMixdown } from './renderMixdown';
import {
  beatMixFixture,
  beatPatternFixture,
  FACTORY_EFFECTS,
  mixdownLoop,
  mixdownMelodyBar,
  mixdownSnapshot,
} from './mixdownFixture';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';
import type { ActiveSynth, ArpSettings, SubtractiveParams } from '@/types/synth';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

type Snapshot = Parameters<typeof renderMixdown>[0];
type Loop = Snapshot['loops'][number];

const DIR = join(process.cwd(), 'src/audio/export');
const HASH_FILE = join(DIR, 'renderMixdownGolden.wav.sha256');
const CALLS_FILE = join(DIR, 'renderMixdownGolden.calls.json');
const UPDATE = process.env.GOLDEN_UPDATE === '1';
const METHODS = [
  'triggerSynthNoteOn',
  'triggerSynthNoteOff',
  'triggerDrum',
  'setSourceState',
  'setDrumKit',
  'setDrumTrackGain',
] as const;

function randomArp(): ArpSettings {
  return { active: true, mode: 'random', rate: '16n', octaves: 2 };
}

function subtractive(edit: (patch: SubtractiveParams) => void): ActiveSynth {
  const synth = structuredClone(SUBTRACTIVE_INIT);
  edit(synth.patch);
  return synth;
}

function beatPattern(hits: Partial<Record<BeatVoiceId, number[]>>): BeatPattern {
  const pattern = beatPatternFixture();
  for (const voice of Object.keys(pattern.rows) as BeatVoiceId[]) {
    pattern.rows[voice] = pattern.rows[voice].map(() => false);
  }
  for (const [voice, steps] of Object.entries(hits) as [BeatVoiceId, number[]][]) {
    for (const step of steps) pattern.rows[voice][step] = true;
  }
  return pattern;
}

function mutedMix(voice: BeatVoiceId): BeatMix {
  const mix = structuredClone(beatMixFixture());
  mix.voices[voice] = { ...mix.voices[voice], muted: true };
  return mix;
}

/** Loop A: random arps on chord, bass and Lead; noisy chord patch; S&H LFO on Lead. */
function loopA(): Loop {
  return mixdownLoop({
    id: 'golden-a',
    repeatCount: 2,
    chords: [
      { id: 'a1', root: 'C', quality: 'maj', bars: 1 },
      { id: 'a2', root: 'A', quality: 'min', bars: 1 },
    ],
    chordRhythmId: 'fourOnFloor',
    chordArpSettings: randomArp(),
    chordSynthParams: subtractive((p) => {
      p.utility = { ...p.utility, noiseEnabled: true, noiseLevelDb: -18 };
    }),
    bassPatternId: 'driving-eighths',
    bassArpSettings: randomArp(),
    padMode: 'pad',
    leadMelodySteps: mixdownMelodyBar('E4'),
    synthArpSettings: randomArp(),
    synthParams: subtractive((p) => {
      p.lfo = {
        ...p.lfo,
        waveform: 'sample-and-hold',
        depth: 0.5,
        route: { target: 'filter-cutoff', unit: 'semitones', amount: 12 },
      };
    }),
    beatPattern: beatPattern({ kick: [0, 8], snare: [4, 12], hihat: [2, 6, 10, 14] }),
  });
}

/** Loop B: full-hold chord and bass, pad drone, FX melody, one Beat voice muted. */
function loopB(): Loop {
  return mixdownLoop({
    id: 'golden-b',
    chords: [{ id: 'b1', root: 'F', quality: 'maj', bars: 1 }],
    chordRhythmId: 'sustained',
    bassPatternId: 'whole-note-root',
    padMode: 'drone',
    fxMelodySteps: mixdownMelodyBar('G5'),
    beatPattern: beatPattern({ kick: [0], snare: [8], hihat: [0, 4, 8, 12] }),
    beatMix: mutedMix('snare'),
  });
}

/** Loop C: chordless, Lead only, drums. */
function loopC(): Loop {
  return mixdownLoop({
    id: 'golden-c',
    chords: [],
    leadMelodySteps: mixdownMelodyBar('C5'),
    beatPattern: beatPattern({ kick: [0, 4, 8, 12] }),
  });
}

function goldenSnapshot(): Snapshot {
  return mixdownSnapshot({
    effects: { ...FACTORY_EFFECTS, reverbDecay: 2.6, delayWet: 0.3 },
    loops: [loopA(), loopB(), loopC()],
  });
}

/** Every object-valued loop field, labelled `loop<i>.<field>` by reference. */
function objectLabels(snapshot: Snapshot): Map<unknown, string> {
  const labels = new Map<unknown, string>();
  snapshot.loops.forEach((loop, i) => {
    for (const [field, value] of Object.entries(loop)) {
      if (typeof value === 'object' && value !== null && !labels.has(value)) {
        labels.set(value, `loop${i}.${field}`);
      }
    }
  });
  return labels;
}

type Method = (...args: unknown[]) => unknown;

async function renderWithCallLog(snapshot: Snapshot) {
  const proto = AudioEngine.prototype as unknown as Record<(typeof METHODS)[number], Method>;
  const labels = objectLabels(snapshot);
  const log: unknown[][] = [];
  const spies = METHODS.map((method) => {
    const original = proto[method];
    return spyOn(proto, method).mockImplementation(function (this: unknown, ...args: unknown[]) {
      const out = original.apply(this, args);
      log.push([method, ...args.map((a) => labels.get(a) ?? a), out ?? null]);
      return out;
    });
  });
  try {
    const result = await renderMixdown(snapshot);
    // JSON round-trip: the comparison is against a JSON file, so normalise
    // undefined → null and -0 → 0 exactly as the file stores them.
    return { result, log: JSON.parse(JSON.stringify(log)) as unknown[][] };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

async function sha256(blob: Blob): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(new Uint8Array(await blob.arrayBuffer()));
  return hasher.digest('hex');
}

function readGolden(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — record it with GOLDEN_UPDATE=1 on the pre-refactor code`);
  }
  return readFileSync(file, 'utf8');
}

describe('renderMixdown golden (DEV-420)', () => {
  test('golden: the fixture renders to the recorded WAV sha256', async () => {
    const result = await renderMixdown(goldenSnapshot());
    if (!result.ok) throw new Error(`render failed: ${JSON.stringify(result.reason)}`);
    const hash = await sha256(result.blob);
    if (UPDATE) writeFileSync(HASH_FILE, `${hash}\n`);
    expect(hash).toBe(readGolden(HASH_FILE).trim());
  }, 60_000);

  test('golden: the fixture makes the recorded engine-call sequence', async () => {
    const { result, log } = await renderWithCallLog(goldenSnapshot());
    expect(result.ok).toBe(true);
    if (UPDATE) {
      writeFileSync(CALLS_FILE, `[\n${log.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`);
    }
    expect(log).toEqual(JSON.parse(readGolden(CALLS_FILE)) as unknown[][]);
  }, 60_000);
});
```

If `tsc` rejects a fixture value (e.g. a field name in `SubtractiveParams`/`UtilitySourceParams`/`LfoParams`, or a quality id), fix the value to the real type — keep every feature the spec's §9.1 table lists. `quality: 'min'` and the rhythm/pattern ids above exist today (`src/data/chordRhythms.ts`, `src/data/bassPatterns.ts`). `PadMode` is `'pad' | 'drone'` (the spec's "pad chord mode" is `'pad'`).

- [ ] **Step 2: Run without the variable to see it fail**

Run: `bun test src/audio/export/renderMixdownGolden.test.ts`
Expected: FAIL — "renderMixdownGolden.wav.sha256 is missing — record it with GOLDEN_UPDATE=1".

- [ ] **Step 3: Record**

Run: `GOLDEN_UPDATE=1 bun test src/audio/export/renderMixdownGolden.test.ts`
Expected: PASS; both golden files written.

- [ ] **Step 4: Confirm the fixture reaches what it must**

Check `renderMixdownGolden.calls.json` (use `grep -c`, don't open whole): it contains `triggerDrum` calls for `"snare"` and `"hihat"` (noise-offset draws), `triggerSynthNoteOn` calls labelled `"loop0.chordSynthParams"` (noise-enabled patch), `"loop0.synthParams"` (S&H LFO), `"loop0.padSynthParams"`, `"loop1.chordSynthParams"`, `"loop1.bassSynthParams"`, `"loop1.fxSynthParams"`, `"loop2.synthParams"`, and never a `triggerDrum` for `"snare"` between loop1's first and last calls (muted). If any is missing, fix the fixture and re-record (still Task 1).

```bash
for s in '"snare"' '"hihat"' loop0.chordSynthParams loop0.synthParams loop0.padSynthParams loop1.chordSynthParams loop1.bassSynthParams loop1.fxSynthParams loop2.synthParams; do printf '%s ' "$s"; grep -c -- "$s" src/audio/export/renderMixdownGolden.calls.json; done
```

- [ ] **Step 5: Confirm it is stable in compare mode, alone and in the full suite**

Run: `bun test src/audio/export/renderMixdownGolden.test.ts && bun test src/audio/export/renderMixdownGolden.test.ts`
Expected: PASS twice, `git status` shows no change to the golden files after the second run.
Run: `bun test`
Expected: all green (the golden also passes when other render tests share the process).

- [ ] **Step 6: Gate and commit**

Run: `bun run eslint && bun run lint && bun run check:dead-code`
Expected: zero errors, zero warnings, zero findings.

```bash
git add src/audio/export/renderMixdownGolden.test.ts src/audio/export/renderMixdownGolden.wav.sha256 src/audio/export/renderMixdownGolden.calls.json
git commit -m "test: DEV-420 mixdown golden recorded on the pre-refactor renderer

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Record this commit's sha in your report: Task 8 diffs the golden files against it.

---

### Task 2: A4 — pure chord helpers in `plan/chordEvents.ts` + import-graph guard

**Goal:** No planner reaches the engine singleton at runtime; a Bun test proves it transitively (spec §3, §4.4, §8; R289).

**Files:**
- Create: `src/audio/playback/plan/chordEvents.ts`, `src/audio/playback/plan/chordEvents.test.ts`, `src/architecture/playbackPlannerImportGraph.test.ts`
- Modify: `src/audio/playback/chordPlayback.ts`, `src/audio/playback/chordPlayback.test.ts`, `src/audio/playback/plan/chordPlan.ts`, `src/audio/playback/plan/chordPlan.test.ts`, `src/components/loop/chord/useChordPlayback.ts`, `src/audio/export/renderMixdown.test.ts`

**Interfaces:**
- Produces (`plan/chordEvents.ts`):
  - moved verbatim from `chordPlayback.ts` (with their docblocks): `export interface BarInvariantEvent`, `export type StepEvent`, `export function buildChordEvents`, `function phaseEventsForStep` (private), `export function eventsForCycleStep`, `export function chordPlanPosition`, `const ARP_VELOCITY` (private), `export function arpEventsForStep`.
  - new: `export function stepNoteWindow(time: number, ev: StepEvent, chordEnd: number): { startSec: number; endSec: number }` and `export function fullHoldVelocity(noteCount: number): number`.
- `chordPlayback.ts` keeps everything else (`emitStepEvents`, `scheduleWholeChord`, `playFullHoldChord`, `PreviewEngine`, `playChordLegato`, `startPatternLoop`, preview helpers) and imports what it needs from `./plan/chordEvents`. **No re-export.**

- [ ] **Step 1: Write the import-graph test (it fails today — `chordPlan.ts` imports `../chordPlayback`)**

`src/architecture/playbackPlannerImportGraph.test.ts`:

```ts
/**
 * R289: no runtime import path from src/audio/playback/plan/ reaches the audio
 * engine singleton or playbackEngine. The planner ESLint block is per-file and
 * cannot see transitive edges — audit A4 existed under an armed block — so this
 * walks the graph. Type-only imports are erased at runtime and cannot
 * instantiate a singleton; Bun.Transpiler.scanImports drops them.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const PLAN_DIR = join(SRC, 'audio/playback/plan');
const ENGINE = join(SRC, 'audio/engine.ts');
const FORBIDDEN = new Set([ENGINE, join(SRC, 'audio/playback/playbackEngine.ts')]);
const TS = new Bun.Transpiler({ loader: 'ts' });
const TSX = new Bun.Transpiler({ loader: 'tsx' });
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** A resolved source file, or null for a bare package / non-TS asset (a leaf). */
function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;
  if (/\.tsx?$/.test(base) && existsSync(base)) return base;
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (existsSync(base + suffix)) return base + suffix;
  }
  return null;
}

/** Breadth-first runtime reachability; each reached file maps to its importer. */
function reach(starts: string[]): Map<string, string | null> {
  const parent = new Map<string, string | null>(starts.map((s) => [s, null]));
  const queue = [...starts];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const transpiler = file.endsWith('.tsx') ? TSX : TS;
    for (const { path } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(file, path);
      if (target === null || parent.has(target)) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  return parent;
}

function chain(parent: Map<string, string | null>, file: string): string {
  const out: string[] = [];
  for (let f: string | null = file; f !== null; f = parent.get(f) ?? null) out.unshift(relative(ROOT, f));
  return out.join(' -> ');
}

function plannerFiles(): string[] {
  return readdirSync(PLAN_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(PLAN_DIR, name));
}

describe('playback planner runtime import graph (R289)', () => {
  test('no planner reaches audio/engine or playbackEngine at runtime', () => {
    const parent = reach(plannerFiles());
    const offending = [...parent.keys()].filter((f) => FORBIDDEN.has(f)).map((f) => chain(parent, f));
    expect(offending).toEqual([]);
  });

  test('positive control: the walker does reach the engine from chordPlayback.ts', () => {
    const parent = reach([join(SRC, 'audio/playback/chordPlayback.ts')]);
    expect(parent.has(ENGINE)).toBe(true);
  });

  test('the walker starts from at least the known planners', () => {
    const names = plannerFiles().map((f) => relative(PLAN_DIR, f));
    expect(names).toEqual(expect.arrayContaining(['chordPlan.ts', 'padPlan.ts', 'melodyPlan.ts']));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/architecture/playbackPlannerImportGraph.test.ts`
Expected: first test FAILS, printing a chain like `src/audio/playback/plan/chordPlan.ts -> src/audio/playback/chordPlayback.ts -> src/audio/engine.ts`; positive control PASSES.

- [ ] **Step 3: Write the helper tests in `plan/chordEvents.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { fullHoldVelocity, stepNoteWindow, type StepEvent } from './chordEvents';
import { playFullHoldChord } from '../chordPlayback';
import type { AudioEngine } from '@/audio/engine';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';

describe('stepNoteWindow', () => {
  const ev = (timeOffset: number, hold: number): StepEvent => ({ noteName: 'C4', velocity: 0.8, timeOffset, hold });

  test('stepNoteWindow clamps to chordEnd', () => {
    expect(stepNoteWindow(2, ev(0.03, 1), 2.5)).toEqual({ startSec: 2 + 0.03, endSec: 2.5 });
    expect(stepNoteWindow(2, ev(0.03, 0.1), 2.5)).toEqual({ startSec: 2 + 0.03, endSec: 2 + 0.03 + 0.1 });
  });

  test('stepNoteWindow floors the gate at 10 ms', () => {
    const start = 2 + 0.2;
    expect(stepNoteWindow(2, ev(0.2, 1), 2.1)).toEqual({ startSec: start, endSec: start + 0.01 });
  });
});

describe('fullHoldVelocity', () => {
  test("fullHoldVelocity matches playFullHoldChord's velocity for 1–6 notes", () => {
    const notes = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5'];
    for (let n = 1; n <= notes.length; n += 1) {
      const velocities: number[] = [];
      const fake = {
        triggerSynthNoteOn: (_hz: number, _synth: unknown, velocity: number) => {
          velocities.push(velocity);
          return null;
        },
        triggerSynthNoteOff: () => {},
      } as unknown as AudioEngine;
      playFullHoldChord(notes.slice(0, n), structuredClone(SUBTRACTIVE_INIT), 0, 1, 'chord', fake);
      expect(velocities).toEqual(new Array<number>(n).fill(fullHoldVelocity(n)));
    }
  });
});
```

Then **move** (cut/paste, names unchanged) from `chordPlayback.test.ts` into `chordEvents.test.ts` every `describe`/`test` that exercises only moved symbols: at least `eventsForCycleStep folds a progression step onto the cycle it is given`, `chordPlanPosition measures a step from the run origin`, `arpEventsForStep`, `buildChordEvents`, `eventsForCycleStep output is unchanged by the single-pass rewrite`; also `a plan folds each chord and bass cycle by its own resolved width` if it calls only moved symbols (check). Suites that mix moved and emitter symbols stay in `chordPlayback.test.ts` with their imports split between `./chordPlayback` and `./plan/chordEvents`. Carry any helper/fixture the moved tests need.

- [ ] **Step 4: Create `plan/chordEvents.ts`**

Move verbatim the symbols listed under Interfaces, with their docblocks and comments, from `chordPlayback.ts`. Imports: rewrite each one the moved code needs in `@/`-aliased form (`@/audio/chordRhythms`, `@/audio/arpeggiator`, `@/audio/arpSchedule`, `@/audio/constants`, `@/utils/meter`, `@/utils/musicTheory` for `STEPS_PER_BAR` and any musicTheory helper, `@/data/chordRhythms` type, `@/types`, `@/types/synth`). Never import `@/audio/engine` (F4: `STEPS_PER_BAR` lives in `@/utils/musicTheory`). Add:

```ts
/**
 * Start and clipped note-off of one step event. The clamp to chordEnd stops a
 * long feel hold from overlapping the next chord; the 10 ms floor keeps a
 * strum's late note-off from preceding its own note-on at high bpm. One rule
 * for live (emitStepEvents) and offline (the song timeline). The expressions
 * are kept token for token — reordering them changes a double and the WAV.
 */
export function stepNoteWindow(
  time: number,
  ev: StepEvent,
  chordEnd: number,
): { startSec: number; endSec: number } {
  const startSec = time + ev.timeOffset;
  const endSec = Math.max(startSec + 0.01, Math.min(startSec + ev.hold, chordEnd));
  return { startSec, endSec };
}

/** The per-note velocity of a full-hold strike of `noteCount` notes (chord and pad holds). */
export function fullHoldVelocity(noteCount: number): number {
  return DEFAULT_VELOCITY * equalPowerVelocityScale(noteCount);
}
```

- [ ] **Step 5: Slim `chordPlayback.ts`**

Delete the moved symbols; import `BarInvariantEvent`, `StepEvent`, `stepNoteWindow`, `fullHoldVelocity` and whatever else the remaining code uses from `./plan/chordEvents`; drop now-unused imports. Rewrite the two emitters so every double is unchanged:

```ts
// emitStepEvents loop body
for (const ev of events) {
  const { startSec: start, endSec: off } = stepNoteWindow(time, ev, chordEnd);
  const voiceId = engine.triggerSynthNoteOn(noteFrequency(ev.noteName), synth, ev.velocity, start, source, 1, "sequencer");
  // Released by the ID this hit started, never by name: … (keep existing comment)
  if (voiceId) engine.triggerSynthNoteOff(voiceId, releaseSeconds, off);
}
```

Move the clamp/floor explanation comment onto `stepNoteWindow` (Step 4 already carries it) and leave a one-line pointer in `emitStepEvents`. In `playFullHoldChord` replace the inline velocity expression with `fullHoldVelocity(notes.length)`.

- [ ] **Step 6: Switch every importer**

- `plan/chordPlan.ts`: `from '../chordPlayback'` → `from './chordEvents'` (this is the A4 fix).
- `plan/chordPlan.test.ts`: `arpEventsForStep, buildChordEvents, eventsForCycleStep` from `./chordEvents`.
- `src/components/loop/chord/useChordPlayback.ts`: moved symbols (e.g. `chordPlanPosition`) from `@/audio/playback/plan/chordEvents`; engine-touching ones stay on `@/audio/playback/chordPlayback`.
- `src/audio/export/renderMixdown.test.ts`: `buildChordEvents, eventsForCycleStep` from `../playback/plan/chordEvents`.
- Find any other importer: `grep -rnE "from ['\"][^'\"]*chordPlayback['\"]" src scripts` and check each named import. (`useChordView.ts`, `ChordView.test.tsx`, `padPlayback.ts`, `playbackEngine.ts`, `loadLoop.ts` import no moved symbol today — confirm, change nothing if so.)

- [ ] **Step 7: Verify**

Run: `bun test src/architecture/playbackPlannerImportGraph.test.ts src/audio/playback src/components/loop src/audio/export/renderMixdownGolden.test.ts src/architecture/playbackPlannerPurity.test.ts`
Expected: all PASS (graph test now green, golden unchanged).
Run: `bun run verify && bun run eslint`
Expected: green; eslint zero errors, zero warnings; Knip zero findings.

- [ ] **Step 8: Commit**

```bash
git add -A src/audio/playback src/architecture/playbackPlannerImportGraph.test.ts src/components/loop/chord/useChordPlayback.ts src/audio/export/renderMixdown.test.ts
git commit -m "refactor(playback): move pure chord helpers into plan/chordEvents (A4)

chordPlan.ts no longer reaches the engine singleton through chordPlayback.ts.
stepNoteWindow and fullHoldVelocity hold the step clamp and the full-hold
velocity for live and offline. A Bun import-graph test with a positive
control guards the transitive edge the per-file ESLint block cannot see.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Drum planner `planBeatStep` and live wiring (A5, drum half)

**Goal:** Drums are planned in `plan/beatPlan.ts` for the live stepper and the offline renderer; the planner decides velocity (spec §7; R290).

**Files:**
- Create: `src/audio/playback/plan/beatPlan.ts`, `src/audio/playback/plan/beatPlan.test.ts`
- Delete: `src/audio/beatSteps.ts`, `src/audio/beatSteps.test.ts`
- Modify: `src/store/playbackPlanSnapshots.ts`, `src/components/useSequencerPlayback.ts`, `src/components/useSequencerPlayback.test.ts`, `src/components/sequencerStartup.test.ts`, `src/audio/export/renderMixdown.ts`

**Interfaces:**
- Produces:
  ```ts
  // plan/beatPlan.ts
  export interface BeatPlanSnapshot { pattern: BeatPattern; mix: BeatMix }
  export interface BeatStepEvent { voice: BeatVoiceId; velocity: number }
  export function planBeatStep(snapshot: BeatPlanSnapshot, context: { stepInBar: number }): BeatStepEvent[];
  // store/playbackPlanSnapshots.ts
  export function beatPlanSnapshot(s: AppStore): BeatPlanSnapshot; // { pattern: s.beatPattern, mix: s.beatMix }
  // components/useSequencerPlayback.ts (signature changes only in its element type)
  export function fireBeatStepEvents(events: readonly BeatStepEvent[], time: number): void;
  ```

- [ ] **Step 1: Write `plan/beatPlan.test.ts`**

Move the existing cases from `src/audio/beatSteps.test.ts` (keep their test names; rename the `describe('beatStepEvents')` to `describe('planBeatStep')`, call `planBeatStep({ pattern, mix }, { stepInBar })`, and compare against `{ voice, velocity: DEFAULT_VELOCITY }` objects where they compared `{ voice }`). Then add the spec's cases, those not already covered:

```ts
import { describe, expect, test } from 'bun:test';
import { planBeatStep, type BeatPlanSnapshot } from './beatPlan';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { DEFAULT_VELOCITY } from '@/audio/constants';
import { beatMixFixture, beatPatternFixture } from '@/audio/export/mixdownFixture';
import type { BeatVoiceId } from '@/types';

function snapshotWith(hits: BeatVoiceId[], step: number, muted: BeatVoiceId[] = []): BeatPlanSnapshot {
  const pattern = structuredClone(beatPatternFixture());
  for (const voice of BEAT_VOICE_IDS) pattern.rows[voice] = pattern.rows[voice].map(() => false);
  for (const voice of hits) pattern.rows[voice][step] = true;
  const mix = structuredClone(beatMixFixture());
  for (const voice of muted) mix.voices[voice] = { ...mix.voices[voice], muted: true };
  return { pattern, mix };
}

describe('planBeatStep: selection', () => {
  test('voices come back in BEAT_VOICE_IDS order', () => {
    const reversed = [...BEAT_VOICE_IDS].reverse();
    const events = planBeatStep(snapshotWith(reversed, 3), { stepInBar: 3 });
    expect(events.map((e) => e.voice)).toEqual([...BEAT_VOICE_IDS]);
  });

  test('a muted voice is skipped; solo is not a planner input', () => {
    const events = planBeatStep(snapshotWith(['kick', 'snare'], 0, ['snare']), { stepInBar: 0 });
    expect(events.map((e) => e.voice)).toEqual(['kick']);
    // BeatPlanSnapshot has exactly the two fields: no solo can reach the planner.
    expect(Object.keys(snapshotWith([], 0)).sort()).toEqual(['mix', 'pattern']);
  });

  test('a step past the stored row is silent, not an error', () => {
    const snap = snapshotWith(['kick'], 0);
    expect(planBeatStep(snap, { stepInBar: snap.pattern.rows.kick.length + 5 })).toEqual([]);
  });

  test('a missing row or mix entry is silent, not a throw', () => {
    const snap = snapshotWith(['kick', 'snare'], 0);
    delete (snap.pattern.rows as Partial<Record<BeatVoiceId, boolean[]>>).kick;
    delete (snap.mix.voices as Partial<Record<BeatVoiceId, unknown>>).snare;
    expect(planBeatStep(snap, { stepInBar: 0 }).map((e) => e.voice)).toEqual(['snare']);
  });
});

describe('planBeatStep: output', () => {
  test('every event carries DEFAULT_VELOCITY', () => {
    const events = planBeatStep(snapshotWith([...BEAT_VOICE_IDS], 1), { stepInBar: 1 });
    expect(events.length).toBe(BEAT_VOICE_IDS.length);
    for (const e of events) expect(e.velocity).toBe(DEFAULT_VELOCITY);
  });

  test('two calls return distinct arrays', () => {
    const snap = snapshotWith(['kick'], 0);
    const a = planBeatStep(snap, { stepInBar: 0 });
    const b = planBeatStep(snap, { stepInBar: 0 });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
```

(`beatMixFixture().voices[voice]` — if the mix-voice type makes the spread/delete casts fail `tsc`, adjust the casts, not the behaviour.)

- [ ] **Step 2: Run to see it fail**

Run: `bun test src/audio/playback/plan/beatPlan.test.ts`
Expected: FAIL — cannot resolve `./beatPlan`.

- [ ] **Step 3: Create `plan/beatPlan.ts`**

Move the `beatStepEvents` docblocks (event docblock and function docblock, minus the scratch-buffer paragraphs, which no longer apply) and the loop body with both optional chains and their comment:

```ts
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { DEFAULT_VELOCITY } from '@/audio/constants';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';

/** The Beat lane's plan input: the stored pattern and the per-voice mix. Built per step, live
 *  (`beatPlanSnapshot`) or per loop, offline (`beatSnapshotForLoop`). */
export interface BeatPlanSnapshot {
  pattern: BeatPattern;
  mix: BeatMix;
}

/** (moved docblock: a Beat event names a drum voice and nothing else …) */
export interface BeatStepEvent {
  voice: BeatVoiceId;
  velocity: number;
}

/** (moved docblock: stored-row indexing, silent past the row, ONE of the two mute layers …)
 *  Returns a fresh array: a timeline retains events. */
export function planBeatStep(snapshot: BeatPlanSnapshot, context: { stepInBar: number }): BeatStepEvent[] {
  const events: BeatStepEvent[] = [];
  for (const voice of BEAT_VOICE_IDS) {
    // (moved comment: optional on BOTH halves …)
    if (snapshot.mix.voices[voice]?.muted) continue;
    if (!snapshot.pattern.rows[voice]?.[context.stepInBar]) continue;
    events.push({ voice, velocity: DEFAULT_VELOCITY });
  }
  return events;
}
```

Write the docblocks out in full from the moved text (the `(moved …)` markers above name what to carry; do not leave them as literal text).

- [ ] **Step 4: Store twin**

In `src/store/playbackPlanSnapshots.ts` add `import type { BeatPlanSnapshot } from '@/audio/playback/plan/beatPlan';` and:

```ts
/**
 * The Beat lane's plan snapshot from live store state. R234 twin of the
 * offline `beatSnapshotForLoop`: a new Beat field goes in both or neither.
 */
export function beatPlanSnapshot(s: AppStore): BeatPlanSnapshot {
  return { pattern: s.beatPattern, mix: s.beatMix };
}
```

- [ ] **Step 5: Live wiring**

`src/components/useSequencerPlayback.ts`:
- imports: drop `beatStepEvents`/`@/audio/beatSteps` and `DEFAULT_VELOCITY`; add `import { planBeatStep, type BeatStepEvent } from "@/audio/playback/plan/beatPlan";` and `import { beatPlanSnapshot } from "../store/playbackPlanSnapshots";`.
- `fireBeatStepEvents` body: `triggerPad(event.voice, event.velocity, time);`. Update its docblock: velocity is decided by `planBeatStep` (fixed `DEFAULT_VELOCITY`), the Beat fader still reaches drums only via the sequencer source bus; replace the `beatStepEvents` mention with `planBeatStep`.
- clock callback: `fireBeatStepEvents(planBeatStep(beatPlanSnapshot(live), { stepInBar: stepInLoop }), time);`

- [ ] **Step 6: Offline call site (temporary, replaced in Task 6)**

`src/audio/export/renderMixdown.ts`, inside `scheduleArrangement`: replace the `beatStepEvents` loop with

```ts
for (const event of planBeatStep({ pattern: loop.beatPattern, mix: loop.beatMix }, { stepInBar })) {
  engine.triggerDrum(event.voice, event.velocity, time);
}
```

and swap the import to `import { planBeatStep } from '../playback/plan/beatPlan';`. Keep the surrounding comment, naming `planBeatStep`.

- [ ] **Step 7: Update the tests that construct events or pin the source text**

These edits are required by the new event shape; they keep each test's intent (spec §9.3 lists these files as "import paths only" — the added `velocity` field makes that impossible; this is a recorded deviation).

- `src/components/useSequencerPlayback.test.ts`:
  - event literals gain the field: `fireBeatStepEvents([{ voice: 'kick', velocity: DEFAULT_VELOCITY }], 1)`, and `[{ voice: 'kick', velocity: DEFAULT_VELOCITY }, { voice: 'hihat', velocity: DEFAULT_VELOCITY }]`.
  - in `the source no longer threads the Beat bus fader into a velocity argument`: replace `expect(source).toContain('DEFAULT_VELOCITY');` with `expect(source).toContain('triggerPad(event.voice, event.velocity, time)');` (the other assertions stay).
  - in `it reads beatPattern/beatMix live off the store and fires the voices they name`: expected string becomes `'fireBeatStepEvents(planBeatStep(beatPlanSnapshot(live), { stepInBar: stepInLoop }), time)'`.
  - add, in the same `describe` as the fader test:
    ```ts
    test("fireBeatStepEvents passes each event's velocity", () => {
      const drumSpy = spyOn(audioEngine, 'triggerDrum').mockImplementation(() => {});
      fireBeatStepEvents([{ voice: 'kick', velocity: 0.42 }], 3);
      expect(drumSpy).toHaveBeenCalledWith('kick', 0.42, 3);
    });
    ```
- `src/components/sequencerStartup.test.ts`: import `planBeatStep` from `'../audio/playback/plan/beatPlan'`; the call becomes `fireBeatStepEvents(planBeatStep({ pattern: beat.beatPattern, mix: beat.beatMix }, { stepInBar: step % 16 }), time);`.
- `git rm src/audio/beatSteps.ts src/audio/beatSteps.test.ts` (after Step 1 moved its cases).
- `grep -rn "beatSteps\|beatStepEvents" src scripts .claude/skills` must return nothing under `src/` and `scripts/` (docs/skill are Task 7).

- [ ] **Step 8: Verify**

Run: `bun test src/audio/playback/plan src/components/useSequencerPlayback.test.ts src/components/sequencerStartup.test.ts src/audio/export src/architecture`
Expected: all PASS, golden unchanged.
Run: `bun run verify && bun run eslint`
Expected: green; zero warnings; Knip zero findings.

- [ ] **Step 9: Commit**

```bash
git add -A src/audio/playback/plan/beatPlan.ts src/audio/playback/plan/beatPlan.test.ts src/audio/beatSteps.ts src/audio/beatSteps.test.ts src/store/playbackPlanSnapshots.ts src/components/useSequencerPlayback.ts src/components/useSequencerPlayback.test.ts src/components/sequencerStartup.test.ts src/audio/export/renderMixdown.ts
git commit -m "refactor(beat): plan drums with planBeatStep in plan/beatPlan

beatSteps.ts becomes a pure planner with an R235 snapshot and context,
returning a fresh array and deciding drum velocity. The live stepper
and the offline renderer both call it; beatPlanSnapshot is the store twin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Move snapshot types and arrangement planning into `plan/`

**Goal:** `plan/` never imports `export/`: the snapshot types, snapshot→lane adapters and arrangement planning live in `plan/songSnapshot.ts` and `plan/songTimeline.ts`; melody snapshots drop `params`/`source` and `songTrackVoice` supplies them (spec §3, §4.2, §12 D3). Pure moves apart from that.

**Files:**
- Create: `src/audio/playback/plan/songSnapshot.ts`, `src/audio/playback/plan/songTimeline.ts`, `src/audio/playback/plan/songTimeline.test.ts`
- Modify: `src/audio/export/renderMixdown.ts`, `src/audio/export/mixdownFixture.ts`, `src/store/mixdownSlice.ts`, `src/audio/export/renderMixdown.test.ts`, `src/audio/export/renderMixdown.sourceBus.test.ts`, `src/audio/export/renderMixdownMelodyPlan.test.ts`

**Interfaces:**
- Produces (`plan/songSnapshot.ts`):
  - moved verbatim with docblocks: `export interface MixdownBusState`, `export interface MixdownBeatVoiceGain` (now exported — `renderMixdown.ts`'s `LoopAudioAutomation` names them), `export interface MixdownLoop`, `export interface MixdownSnapshot`, `export function chordSnapshotForLoop(loop, meterId, bpm, stepsPerBar): ChordPlanSnapshot`, `export function padSnapshotForLoop(loop, bpm, stepsPerBar): PadPlanSnapshot`.
  - changed: `export function mixdownLeadTrack(loop: MixdownLoop): MelodyPlanSnapshot` and `mixdownFxTrack` — same bodies minus `params` and `source`. `MixdownMelodyTrack` is deleted.
  - new:
    ```ts
    export function beatSnapshotForLoop(loop: MixdownLoop): BeatPlanSnapshot; // { pattern: loop.beatPattern, mix: loop.beatMix }
    export function songTrackVoice(loop: MixdownLoop, track: SongTrack): { params: ActiveSynth; source: string };
    ```
- Produces (`plan/songTimeline.ts`, this task):
  ```ts
  export type SongTrack = 'chord' | 'bass' | 'pad' | 'lead' | 'fx';
  export interface ArrangementPass { loopIndex: number; startStep: number; passSteps: number; dwellSteps: number } // moved, now exported
  export interface ArrangementPlan { totalSteps: number; passes: ArrangementPass[] }                              // moved
  export interface LoopVoices { chordsByBar: number[]; chordStartStep: number[]; plans: ArmedChordPlan[] }        // moved
  export function planArrangement(snapshot: MixdownSnapshot): ArrangementPlan;                                    // moved
  export function buildLoopVoices(loop: MixdownLoop, meterId: MeterId, bpm: number, stepsPerBar: number): LoopVoices; // moved
  ```
- `songSnapshot.ts` imports `SongTrack` with `import type` from `./songTimeline`; `songTimeline.ts` imports runtime values from `./songSnapshot` (no runtime cycle).
- `renderMixdown.ts` keeps: `MIXDOWN_SAMPLE_RATE`, channels/tail/yield constants, `yieldToMainThread`, `yieldPreservingRandomStream`, `MixdownFailureReason`, `MixdownRenderResult`, `LoopAudioAutomation`, `planLoopAudioAutomation`, `applyMasterState`, `applyLoopAudioState`, `scheduleMelodyStep`, `scheduleArrangement`, progress/cancel plumbing, `renderMixdown`.

- [ ] **Step 1: Write the failing equivalence test for the Beat snapshot**

In `src/audio/export/renderMixdown.test.ts`, beside `live and offline build the same pad snapshot`:

```ts
describe('live and offline build the same beat snapshot', () => {
  const pattern = structuredClone(beatPatternFixture());
  pattern.rows.snare[4] = true;
  pattern.rows.hihat[6] = true;
  const mix = structuredClone(beatMixFixture());
  mix.voices.hihat = { ...mix.voices.hihat, muted: true };
  const loop = mixdownLoop({ beatPattern: pattern, beatMix: mix });
  const state = { beatPattern: loop.beatPattern, beatMix: loop.beatMix } as unknown as AppStore;

  test('the offline snapshot deep-equals the store snapshot', () => {
    expect(beatSnapshotForLoop(loop)).toEqual(beatPlanSnapshot(state));
  });

  test('and therefore both plan the same events at every stepInBar', () => {
    for (let stepInBar = 0; stepInBar < MAX_STEPS_PER_BAR; stepInBar += 1) {
      expect(planBeatStep(beatSnapshotForLoop(loop), { stepInBar }), `step ${stepInBar}`).toEqual(
        planBeatStep(beatPlanSnapshot(state), { stepInBar }),
      );
    }
  });
});
```

Imports: `beatSnapshotForLoop` from `'../playback/plan/songSnapshot'`, `beatPlanSnapshot` from `'@/store/playbackPlanSnapshots'`, `planBeatStep` from `'../playback/plan/beatPlan'`.

Run: `bun test src/audio/export/renderMixdown.test.ts -t "beat snapshot"` → FAIL (module missing).

- [ ] **Step 2: Create `plan/songSnapshot.ts`**

Move the listed symbols verbatim (docblocks included; the `MixdownLoop` docblock's "this module" wording is updated to say the offline snapshot lives in `plan/` so neither the renderer nor the timeline imports the store). Adjust the moved `mixdownLeadTrack`/`mixdownFxTrack` docblock: the planner snapshot only; patch and bus come from `songTrackVoice`. Add:

```ts
/** The Beat lane's snapshot for one loop. R234 twin of the store's `beatPlanSnapshot`. */
export function beatSnapshotForLoop(loop: MixdownLoop): BeatPlanSnapshot {
  return { pattern: loop.beatPattern, mix: loop.beatMix };
}

/**
 * The patch and source bus a track's notes play on. The one place Lead's
 * irregular names (`synthParams`, bus `'synth'`) are spelled for the offline
 * path — the store's `MELODY_TRACKS` table encodes the same irregularity but
 * audio/ may not import the store.
 */
export function songTrackVoice(loop: MixdownLoop, track: SongTrack): { params: ActiveSynth; source: string } {
  switch (track) {
    case 'chord':
      return { params: loop.chordSynthParams, source: 'chord' };
    case 'bass':
      return { params: loop.bassSynthParams, source: 'bass' };
    case 'pad':
      return { params: loop.padSynthParams, source: 'pad' };
    case 'lead':
      return { params: loop.synthParams, source: 'synth' };
    case 'fx':
      return { params: loop.fxSynthParams, source: 'fx' };
  }
}
```

Imports use `@/` or `./` forms only (e.g. `import type { LeadNote } from '@/audio/leadMelody'`, `import type { ChordPlanSnapshot } from './chordPlan'`, `import type { PadPlanSnapshot } from './padPlan'`, `import type { MelodyPlanSnapshot } from './melodyPlan'`, `import type { BeatPlanSnapshot } from './beatPlan'`, `import type { SongTrack } from './songTimeline'`).

- [ ] **Step 3: Create `plan/songTimeline.ts` (moves only for now)**

Module docblock: the pure song timeline — arrangement planning here, the walk added in the next commit. Move `ArrangementPass` (add `export`), `ArrangementPlan`, `planArrangement`, `LoopVoices`, `buildLoopVoices` verbatim with docblocks; declare `export type SongTrack = 'chord' | 'bass' | 'pad' | 'lead' | 'fx';` with a one-line docblock. Imports: `loopDwellSteps`, `loopEffectiveLengthSteps` from `@/utils/songStructure`; `planChordArm`, `type ArmedChordPlan` from `./chordPlan`; `chordSnapshotForLoop`, `type MixdownLoop`, `type MixdownSnapshot` from `./songSnapshot`; `type MeterId` from `@/utils/meter`.

- [ ] **Step 4: Move the arrangement tests**

Create `src/audio/playback/plan/songTimeline.test.ts` and move, names unchanged, from `renderMixdown.test.ts`: the whole `describe('planArrangement')` **except** `positions every loop's Beat patch on its arrangement boundary` (it asserts `planLoopAudioAutomation`, which stays in the renderer — leave that test in `renderMixdown.test.ts` under a new `describe('planLoopAudioAutomation')`), and the whole `describe('buildLoopVoices')`. Carry their helpers/imports; fixtures come from `@/audio/export/mixdownFixture`. Split any `describe` that would exceed 100 lines.

- [ ] **Step 5: Rewire `renderMixdown.ts`**

- Delete the moved declarations; import `type MixdownSnapshot`, `type MixdownLoop`, `type MixdownBusState`, `type MixdownBeatVoiceGain`, `mixdownLeadTrack`, `mixdownFxTrack`, `padSnapshotForLoop`, `songTrackVoice` from `'../playback/plan/songSnapshot'`, and `planArrangement`, `buildLoopVoices`, `type ArrangementPlan` from `'../playback/plan/songTimeline'`. Drop imports that become unused (`planChordArm`, `ArmedChordPlan`, `ChordPlanSnapshot`, `PadPlanSnapshot`, `MelodyPlanSnapshot`, `loopDwellSteps`, … — let `tsc`/ESLint tell you).
- `scheduleMelodyStep` takes the track id so patch/bus come from the table (same call, same doubles):

```ts
function scheduleMelodyStep(
  engine: AudioEngine,
  loop: MixdownLoop,
  trackId: 'lead' | 'fx',
  track: MelodyPlanSnapshot,
  stepInPass: number,
  stepsPerBar: number,
  tickDur: number,
  time: number,
): void {
  const { params, source } = songTrackVoice(loop, trackId);
  const planned = planMelodyStep(track, { stepInLoop: stepInPass, stepsPerBar, tickDurSec: tickDur });
  for (const note of planned) {
    const start = time + note.startOffsetSec;
    const voiceId = engine.triggerSynthNoteOn(
      noteFrequency(note.note), params, DEFAULT_VELOCITY, start, source, 1, 'sequencer',
    );
    if (voiceId) {
      engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(params), start + note.holdSec);
    }
  }
}
```

  and the two calls become `scheduleMelodyStep(engine, loop, 'lead', leadTrack, …)` / `(engine, loop, 'fx', fxTrack, …)`. (Keep `MelodyPlanSnapshot` imported as a type for this; the whole function goes in Task 6.)
- Update the module docblock paragraph that says `MixdownLoop` "below" names the fields — it now lives in `plan/songSnapshot.ts`.

- [ ] **Step 6: Switch every other importer (no shims)**

- `src/audio/export/mixdownFixture.ts`: `import type { MixdownLoop, MixdownSnapshot } from '../playback/plan/songSnapshot';`
- `src/store/mixdownSlice.ts`: `renderMixdown`, `MixdownFailureReason`, `MixdownRenderProgress` stay on `'../audio/export/renderMixdown'`; `MixdownLoop`, `MixdownSnapshot` from `'../audio/playback/plan/songSnapshot'`.
- `src/audio/export/renderMixdown.sourceBus.test.ts`: `type MixdownLoop` from `'../playback/plan/songSnapshot'`.
- `src/audio/export/renderMixdown.test.ts`: `chordSnapshotForLoop`, `padSnapshotForLoop`, `type MixdownLoop` from `'../playback/plan/songSnapshot'`; `buildLoopVoices`, `planArrangement` from `'../playback/plan/songTimeline'` (for tests that stayed); remove imports only the moved tests used.
- `src/audio/export/renderMixdownMelodyPlan.test.ts`: import `mixdownLeadTrack, mixdownFxTrack` from `'../playback/plan/songSnapshot'`; the first test's body becomes `expect(offline).toEqual(live);` (the `params`/`source` strip goes away). Update the docblock sentence that says the file tests "the renderer's own" builders → the offline snapshot builders.
- `grep -rnE "from ['\"][^'\"]*renderMixdown['\"]" src scripts` — every remaining import names only symbols still in `renderMixdown.ts`.

- [ ] **Step 7: Verify**

Run: `bun test src/audio/export src/audio/playback src/store/mixdownSlice.test.ts src/architecture`
Expected: all PASS, including `live and offline build the same beat snapshot`, the moved `planArrangement`/`buildLoopVoices` tests, and the golden.
Run: `bun run verify && bun run eslint`
Expected: green; zero warnings; Knip zero findings (no leftover export in `renderMixdown.ts` that only the moved code used).

- [ ] **Step 8: Commit**

```bash
git add -A src/audio/playback/plan src/audio/export src/store/mixdownSlice.ts
git commit -m "refactor(mixdown): move snapshot types and arrangement planning into plan/

MixdownSnapshot/MixdownLoop, the snapshot-to-lane adapters, planArrangement
and buildLoopVoices move out of export/renderMixdown.ts so plan/ never
imports export/. Melody snapshots drop params/source; songTrackVoice is
the one offline table of patch and bus per track. beatSnapshotForLoop is
the offline twin of beatPlanSnapshot.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `walkSongTimeline` / `buildSongTimeline`

**Goal:** The pure walk (spec §5) and its drained, stably sorted form, fully unit-tested. The renderer does not use it yet (Task 6), so the golden cannot move in this task.

**Files:**
- Modify: `src/audio/playback/plan/songTimeline.ts`, `src/audio/playback/plan/songTimeline.test.ts`

**Interfaces:**
- Consumes: `planBeatStep` (`./beatPlan`), `planChordStep` (`./chordPlan`), `planPadArm` (`./padPlan`), `planMelodyStep` + `type MelodyPlanSnapshot` (`./melodyPlan`), `stepNoteWindow`, `fullHoldVelocity` (`./chordEvents`), `mixdownLeadTrack`, `mixdownFxTrack`, `padSnapshotForLoop`, `beatSnapshotForLoop` (`./songSnapshot`), `DEFAULT_VELOCITY` (`@/audio/constants`), `stepDurationSec` (`@/utils/musicTheory`), `TICKS_PER_SIXTEENTH` (`@/utils/stepResolution`), `type BeatVoiceId` (`@/types`).
- Produces (exact, spec §4.1):
  ```ts
  export type TimelineEvent =
    | { kind: 'note'; track: SongTrack; loopIndex: number; noteName: string; velocity: number; startSec: number; endSec: number }
    | { kind: 'drum'; loopIndex: number; voice: BeatVoiceId; velocity: number; timeSec: number };
  export type SongWalkItem =
    | TimelineEvent
    | { kind: 'pass'; passIndex: number; pass: ArrangementPass }
    | { kind: 'stepEnd'; step: number };
  export interface SongTimeline { totalSteps: number; passes: ArrangementPass[]; events: TimelineEvent[] }
  export function timelineEventTime(e: TimelineEvent): number; // note → startSec, drum → timeSec
  export function walkSongTimeline(snapshot: MixdownSnapshot, plan: ArrangementPlan): Generator<SongWalkItem, void, undefined>;
  export function buildSongTimeline(snapshot: MixdownSnapshot): SongTimeline;
  ```
  Keep the field docblocks from spec §4.1 (`noteName` ROOTS-spelled, never Hz; `startSec` absolute seconds; `endSec` already clipped; `events` sorted, ties keep emit order).

- [ ] **Step 1: Write the failing tests**

Append to `songTimeline.test.ts` (several `describe`s, each under 100 lines):

```ts
import { withSeededRandom } from '@/audio/rng';
import { pitchClassOfNote, ROOTS } from '@/musicCore';
import { stepDurationSec } from '@/utils/musicTheory';
import {
  beatMixFixture, beatPatternFixture, mixdownLoop, mixdownMelodyBar, mixdownSnapshot,
} from '@/audio/export/mixdownFixture';
import { planBeatStep } from './beatPlan';
import { fullHoldVelocity } from './chordEvents';
import { beatSnapshotForLoop } from './songSnapshot';
import {
  buildLoopVoices, buildSongTimeline, planArrangement, timelineEventTime, walkSongTimeline,
  type SongTimeline, type SongWalkItem, type TimelineEvent,
} from './songTimeline';

const STEP = stepDurationSec(120);

function walk(snapshot: ReturnType<typeof mixdownSnapshot>): SongWalkItem[] {
  return [...walkSongTimeline(snapshot, planArrangement(snapshot))];
}
function eventsOf(items: SongWalkItem[]): TimelineEvent[] {
  return items.filter((i): i is TimelineEvent => i.kind === 'note' || i.kind === 'drum');
}
function laneOf(e: TimelineEvent): string {
  return e.kind === 'drum' ? 'drum' : e.track;
}
function busySnapshot() {
  return mixdownSnapshot({
    loops: [
      mixdownLoop({ chordRhythmId: 'fourOnFloor', padMode: 'pad', leadMelodySteps: mixdownMelodyBar('E4') }),
      mixdownLoop({ id: 'loop-2', fxMelodySteps: mixdownMelodyBar('G4') }),
    ],
  });
}

describe('buildSongTimeline: order', () => {
  test('buildSongTimeline events are time-sorted and equal times keep emit order', () => {
    const snap = busySnapshot();
    const { events } = buildSongTimeline(snap);
    for (let i = 1; i < events.length; i += 1) {
      expect(timelineEventTime(events[i])).toBeGreaterThanOrEqual(timelineEventTime(events[i - 1]));
    }
    const atZero = (list: TimelineEvent[]) => list.filter((e) => timelineEventTime(e) === 0).map(laneOf);
    expect(atZero(events)).toEqual(atZero(eventsOf(walk(snap))));
    expect(atZero(events)[0]).toBe('drum');
  });

  test('buildSongTimeline equals the drained walk, stably sorted', () => {
    const snap = busySnapshot();
    const plan = planArrangement(snap);
    const expected = eventsOf(walk(snap))
      .map((e, i) => ({ e, i }))
      .sort((a, b) => timelineEventTime(a.e) - timelineEventTime(b.e) || a.i - b.i)
      .map(({ e }) => e);
    const built: SongTimeline = buildSongTimeline(snap);
    expect(built).toEqual({ totalSteps: plan.totalSteps, passes: plan.passes, events: expected });
  });

  test('the walk yields a pass marker before any event of that pass and a stepEnd after every step', () => {
    const snap = busySnapshot();
    const plan = planArrangement(snap);
    const items = walk(snap);
    expect(items[0]).toEqual({ kind: 'pass', passIndex: 0, pass: plan.passes[0] });
    let pass = -1;
    const stepEnds: number[] = [];
    for (const item of items) {
      if (item.kind === 'pass') pass = item.passIndex;
      else if (item.kind === 'stepEnd') stepEnds.push(item.step);
      else expect(item.loopIndex).toBe(plan.passes[pass].loopIndex);
    }
    expect(stepEnds).toEqual(Array.from({ length: plan.totalSteps }, (_, i) => i));
  });
});

describe('buildSongTimeline: holds and windows', () => {
  test('a full-hold chord is one note per tone spanning holdSec at fullHoldVelocity', () => {
    const loop = mixdownLoop({ chordRhythmId: 'sustained' });
    const hold = buildLoopVoices(loop, '4/4', 120, 16).plans[0].chordFullHold;
    if (!hold) throw new Error('fixture must full-hold');
    const chord = buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.filter(
      (e) => e.kind === 'note' && e.track === 'chord',
    );
    expect(chord).toEqual(
      hold.notes.map((noteName) => ({
        kind: 'note', track: 'chord', loopIndex: 0, noteName,
        velocity: fullHoldVelocity(hold.notes.length), startSec: 0, endSec: 0 + hold.holdSec,
      })),
    );
  });

  test("a full-hold bass is one note carrying the plan's velocity", () => {
    const loop = mixdownLoop({ bassPatternId: 'whole-note-root' });
    const hold = buildLoopVoices(loop, '4/4', 120, 16).plans[0].bassFullHold;
    if (!hold) throw new Error('fixture must full-hold');
    const bass = buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.filter(
      (e) => e.kind === 'note' && e.track === 'bass',
    );
    expect(bass).toEqual([{
      kind: 'note', track: 'bass', loopIndex: 0, noteName: hold.noteName,
      velocity: hold.velocity, startSec: 0, endSec: 0 + hold.holdSec,
    }]);
  });

  test('step notes end at min(start + hold, chordEnd), floored 10 ms past their start', () => {
    const snap = mixdownSnapshot({ bpm: 200, loops: [mixdownLoop({ chordRhythmId: 'fourOnFloor' })] });
    const chordEnd = 16 * stepDurationSec(200); // one one-bar chord, pass starts at 0
    const notes = buildSongTimeline(snap).events.filter((e) => e.kind === 'note' && e.track === 'chord');
    expect(notes.length).toBeGreaterThan(0);
    for (const e of notes) {
      if (e.kind !== 'note') continue;
      expect(e.endSec).toBeGreaterThanOrEqual(e.startSec + 0.01);
      expect(e.endSec <= chordEnd || e.endSec === e.startSec + 0.01).toBe(true);
    }
  });
});

describe('buildSongTimeline: lanes', () => {
  test('drum events are planBeatStep at each stepInBar; a muted voice never appears', () => {
    const pattern = structuredClone(beatPatternFixture());
    pattern.rows.snare[4] = true;
    pattern.rows.hihat[2] = true;
    const mix = structuredClone(beatMixFixture());
    mix.voices.snare = { ...mix.voices.snare, muted: true };
    const loop = mixdownLoop({ beatPattern: pattern, beatMix: mix });
    const drums = buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.filter((e) => e.kind === 'drum');
    const expected = Array.from({ length: 16 }, (_, step) =>
      planBeatStep(beatSnapshotForLoop(loop), { stepInBar: step }).map((ev) => ({
        kind: 'drum', loopIndex: 0, voice: ev.voice, velocity: ev.velocity, timeSec: step * STEP,
      })),
    ).flat();
    expect(drums).toEqual(expected);
    expect(drums.some((e) => e.kind === 'drum' && e.voice === 'snare')).toBe(false);
  });

  test('a chordless loop yields drums and melody only', () => {
    const loop = mixdownLoop({ chords: [], leadMelodySteps: mixdownMelodyBar('C5') });
    const lanes = new Set(buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.map(laneOf));
    expect([...lanes].sort()).toEqual(['drum', 'lead']);
  });

  test('every noteName is ROOTS-spelled', () => {
    const loop = mixdownLoop({
      scaleRoot: 'D#', scaleType: 'minor',
      chords: [{ id: 'c1', root: 'D#', quality: 'min', bars: 1 }],
      chordRhythmId: 'fourOnFloor', padMode: 'pad', leadMelodySteps: mixdownMelodyBar('A#4'),
    });
    const roots: readonly string[] = ROOTS;
    for (const e of buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events) {
      if (e.kind === 'note') expect(roots).toContain(pitchClassOfNote(e.noteName));
    }
  });
});

describe('buildSongTimeline: repeats and determinism', () => {
  test('repeat 2 replays repeat 1 shifted by passSteps × stepDur', () => {
    const loop = mixdownLoop({ repeatCount: 2, chordRhythmId: 'fourOnFloor', leadMelodySteps: mixdownMelodyBar('E4') });
    const snap = mixdownSnapshot({ loops: [loop] });
    const { passSteps } = planArrangement(snap).passes[0];
    const shift = passSteps * STEP;
    const events = eventsOf(walk(snap));
    const first = events.filter((e) => timelineEventTime(e) < shift);
    const second = events.filter((e) => timelineEventTime(e) >= shift);
    expect(second.length).toBe(first.length);
    second.forEach((e, i) => {
      const a = first[i];
      expect(laneOf(e)).toBe(laneOf(a));
      expect(timelineEventTime(e)).toBeCloseTo(timelineEventTime(a) + shift, 9);
      if (e.kind === 'note' && a.kind === 'note') {
        expect([e.noteName, e.velocity]).toEqual([a.noteName, a.velocity]);
        expect(e.endSec).toBeCloseTo(a.endSec + shift, 9);
      }
    });
  });

  test('two builds under the same seed are deep-equal', async () => {
    const random = { active: true, mode: 'random', rate: '16n', octaves: 2 } as const;
    const snap = mixdownSnapshot({
      loops: [mixdownLoop({ chordRhythmId: 'fourOnFloor', chordArpSettings: { ...random } })],
    });
    const a = await withSeededRandom(7, () => buildSongTimeline(snap));
    const b = await withSeededRandom(7, () => buildSongTimeline(snap));
    expect(a).toEqual(b);
  });
});
```

The `'repeat 2'` test compares by the walk's emit order within each repeat (no sort), which is identical per repeat because nothing in the fixture draws random. If a lint or type rule objects to a literal shape above, fix the typing, keep the assertion.

- [ ] **Step 2: Run to see it fail**

Run: `bun test src/audio/playback/plan/songTimeline.test.ts`
Expected: FAIL — `walkSongTimeline`/`buildSongTimeline`/`timelineEventTime` not exported.

- [ ] **Step 3: Implement the walk**

In `songTimeline.ts`, below the moved code. Split into generator helpers joined with `yield*` so each function stays under `complexity` 20 and 100 lines; generators stay lazy through `yield*`, which is what preserves the RNG draw order (spec §5/§6 — a planner call must run only when the consumer asks for the next item). The body is today's `scheduleArrangement` (in `renderMixdown.ts`, read it by symbol) with each `engine.*` call replaced by a `yield`; carry its explanatory comments (pass-relative steps, chordless guard, full holds arm once, pad `chordIndex` note, melody guard note).

```ts
/** Per-pass state, built AFTER the pass marker is yielded — in today's order. */
interface PassWalk {
  loop: MixdownLoop;
  pass: ArrangementPass;
  voices: LoopVoices;
  chordless: boolean;
  lead: MelodyPlanSnapshot;
  fx: MelodyPlanSnapshot;
  pad: PadPlanSnapshot;
  beat: BeatPlanSnapshot;
  stepDur: number;
  tickDur: number;
  stepsPerBar: number;
}

function note(
  track: SongTrack, loopIndex: number, noteName: string, velocity: number, startSec: number, endSec: number,
): TimelineEvent {
  return { kind: 'note', track, loopIndex, noteName, velocity, startSec, endSec };
}

export function timelineEventTime(e: TimelineEvent): number {
  return e.kind === 'note' ? e.startSec : e.timeSec;
}

export function* walkSongTimeline(
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
): Generator<SongWalkItem, void, undefined> {
  for (let passIndex = 0; passIndex < plan.passes.length; passIndex += 1) {
    const pass = plan.passes[passIndex];
    // BEFORE any planning of this pass: the renderer applies the pass's audio
    // automation on this item, and buildLoopVoices must run after it.
    yield { kind: 'pass', passIndex, pass };
    yield* walkPass(snapshot, pass);
  }
}

function* walkPass(snapshot: MixdownSnapshot, pass: ArrangementPass): Generator<SongWalkItem, void, undefined> {
  const { bpm, meterId, stepsPerBar } = snapshot;
  const loop = snapshot.loops[pass.loopIndex];
  const stepDur = stepDurationSec(bpm);
  const w: PassWalk = {
    loop,
    pass,
    voices: buildLoopVoices(loop, meterId, bpm, stepsPerBar),
    chordless: loop.chords.length === 0,
    lead: mixdownLeadTrack(loop),
    fx: mixdownFxTrack(loop),
    pad: padSnapshotForLoop(loop, bpm, stepsPerBar),
    beat: beatSnapshotForLoop(loop),
    stepDur,
    tickDur: stepDur / TICKS_PER_SIXTEENTH,
    stepsPerBar,
  };
  for (let i = 0; i < pass.dwellSteps; i += 1) {
    const stepInPass = i % pass.passSteps;
    const step = pass.startStep + i;
    const time = step * stepDur;
    yield* walkStep(w, stepInPass, step, time);
    yield { kind: 'stepEnd', step };
  }
}

function* walkStep(w: PassWalk, stepInPass: number, step: number, time: number): Generator<SongWalkItem, void, undefined> {
  const { loopIndex } = w.pass;
  const stepInBar = stepInPass % w.stepsPerBar;
  for (const ev of planBeatStep(w.beat, { stepInBar })) {
    yield { kind: 'drum', loopIndex, voice: ev.voice, velocity: ev.velocity, timeSec: time };
  }
  if (!w.chordless) yield* walkChordStep(w, stepInPass, step, time);
  yield* walkMelodyStep(w, 'lead', w.lead, stepInPass, time);
  yield* walkMelodyStep(w, 'fx', w.fx, stepInPass, time);
}

function* walkChordStep(w: PassWalk, stepInPass: number, step: number, time: number): Generator<SongWalkItem, void, undefined> {
  const { loop, voices, stepsPerBar, stepDur } = w;
  const { loopIndex } = w.pass;
  const barInPass = Math.floor(stepInPass / stepsPerBar);
  const chordIndex = voices.chordsByBar[barInPass];
  const plan = voices.plans[chordIndex];
  const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
  const chordSteps = plan.totalBars * stepsPerBar;
  const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
  const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === plan.totalBars - 1;

  if (stepsIntoChord === 0 && plan.chordFullHold) {
    const { notes, holdSec } = plan.chordFullHold;
    for (const n of notes) yield note('chord', loopIndex, n, fullHoldVelocity(notes.length), time, time + holdSec);
  }
  if (stepsIntoChord === 0 && plan.bassFullHold) {
    const { noteName, velocity, holdSec } = plan.bassFullHold;
    yield note('bass', loopIndex, noteName, velocity, time, time + holdSec);
  }
  const events = planChordStep(plan, {
    progressionStep: stepInPass,
    step,
    isLastBar,
    stepsPerBar,
    stepDurSec: stepDur,
    chordArp: loop.chordArpSettings,
    bassArp: loop.bassArpSettings,
    chordFeel: loop.chordFeel,
    bassFeel: loop.bassFeel,
  });
  for (const ev of events.chord) {
    const { startSec, endSec } = stepNoteWindow(time, ev, chordEnd);
    yield note('chord', loopIndex, ev.noteName, ev.velocity, startSec, endSec);
  }
  for (const ev of events.bass) {
    const { startSec, endSec } = stepNoteWindow(time, ev, chordEnd);
    yield note('bass', loopIndex, ev.noteName, ev.velocity, startSec, endSec);
  }
  if (stepsIntoChord === 0) {
    const arm = planPadArm(w.pad, { chordIndex });
    if (arm) {
      for (const n of arm.notes) yield note('pad', loopIndex, n, fullHoldVelocity(arm.notes.length), time, time + arm.holdSec);
    }
  }
}

function* walkMelodyStep(
  w: PassWalk, track: 'lead' | 'fx', melody: MelodyPlanSnapshot, stepInPass: number, time: number,
): Generator<SongWalkItem, void, undefined> {
  const planned = planMelodyStep(melody, { stepInLoop: stepInPass, stepsPerBar: w.stepsPerBar, tickDurSec: w.tickDur });
  for (const n of planned) {
    const start = time + n.startOffsetSec;
    yield note(track, w.pass.loopIndex, n.note, DEFAULT_VELOCITY, start, start + n.holdSec);
  }
}

/**
 * The whole song as sorted events: the same walk the renderer performs,
 * drained. Reads the shared random() seam for arp 'random' mode, like
 * planChordStep; it does not seed (the caller does, as renderMixdown does).
 */
export function buildSongTimeline(snapshot: MixdownSnapshot): SongTimeline {
  const plan = planArrangement(snapshot);
  const events: TimelineEvent[] = [];
  for (const item of walkSongTimeline(snapshot, plan)) {
    if (item.kind === 'note' || item.kind === 'drum') events.push(item);
  }
  // Array.prototype.sort is stable: equal times keep emit order.
  events.sort((a, b) => timelineEventTime(a) - timelineEventTime(b));
  return { totalSteps: plan.totalSteps, passes: plan.passes, events };
}
```

Check against today's `scheduleArrangement` line by line: the old code computes `stepInBar`/`barInPass` in the step loop; computing them inside the helpers is the same arithmetic on the same values. The old per-pass order is `applyLoopAudioState` → `buildLoopVoices` → `chordless` → `mixdownLeadTrack` → `mixdownFxTrack` → `padSnapshotForLoop`; keep `buildLoopVoices` first in the object literal (property initialisers evaluate in source order). Add the module docblock paragraph on laziness/RNG (spec §5, §6 "Why the draw order is identical", F8) at `walkSongTimeline`. `R235`: the walk is not a `plan<Lane>*` function; its positional parameters are fine.

- [ ] **Step 4: Run the tests**

Run: `bun test src/audio/playback/plan/songTimeline.test.ts`
Expected: all PASS.

- [ ] **Step 5: Verify**

Run: `bun run verify && bun run eslint`
Expected: green; zero warnings (watch `complexity` on `walkChordStep`; split further if it warns); Knip zero findings (`SongTimeline`, `SongWalkItem`, `TimelineEvent`, `timelineEventTime`, `walkSongTimeline`, `buildSongTimeline` are all imported by the test). The golden still passes (untouched renderer).

- [ ] **Step 6: Commit**

```bash
git add src/audio/playback/plan/songTimeline.ts src/audio/playback/plan/songTimeline.test.ts
git commit -m "feat(playback): pure song timeline walk and buildSongTimeline

walkSongTimeline yields today's scheduleArrangement engine calls as
events, lazily, with a pass marker before each pass is planned and a
stepEnd after each step. buildSongTimeline drains it and stably sorts
by time. Every planner call stays where it is, so the RNG draw order can
be preserved when the renderer performs the walk.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `renderMixdown` performs the walk

**Goal:** `scheduleArrangement` applies pass automation and performs walk items one by one; the renderer calls no planner (spec §4.3, §6; R287, R288; acceptance 3). The golden is the proof.

**Files:**
- Modify: `src/audio/export/renderMixdown.ts`, `src/audio/playback/chordPlayback.ts` (comments only)

**Interfaces:**
- Consumes: `walkSongTimeline`, `planArrangement`, `type ArrangementPlan`, `type SongWalkItem`, `type TimelineEvent` from `'../playback/plan/songTimeline'`; `songTrackVoice`, snapshot types from `'../playback/plan/songSnapshot'`.
- Produces (module-private): `function performTimelineEvent(engine: AudioEngine, snapshot: MixdownSnapshot, e: TimelineEvent): void`; `async function scheduleArrangement(engine: AudioEngine, snapshot: MixdownSnapshot, plan: ArrangementPlan, walk: Generator<SongWalkItem, void, undefined>, signal?: AbortSignal): Promise<{ cancelled: boolean }>` — `plan` stays a parameter because `planLoopAudioAutomation(snapshot, plan)` needs it (spec §6 "plan passed alongside, as today").

- [ ] **Step 1: Replace the performer and the loop**

```ts
/**
 * Plays one walk event exactly as the pre-timeline renderer did: the same
 * engine call, the same arguments. Patch and bus come from songTrackVoice;
 * the release is computed at perform time from the patch.
 */
function performTimelineEvent(engine: AudioEngine, snapshot: MixdownSnapshot, e: TimelineEvent): void {
  if (e.kind === 'drum') {
    engine.triggerDrum(e.voice, e.velocity, e.timeSec);
    return;
  }
  const { params, source } = songTrackVoice(snapshot.loops[e.loopIndex], e.track);
  const voiceId = engine.triggerSynthNoteOn(
    noteFrequency(e.noteName), params, e.velocity, e.startSec, source, 1, 'sequencer',
  );
  if (voiceId) engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(params), e.endSec);
}

/**
 * Performs the song walk item by item. Never collect the walk first (R288):
 * the planners (arp 'random') and the engine (drum noise offsets, lazy noise
 * and sample-and-hold buffers) draw from one seeded stream, and only
 * performing each item before resuming the walk keeps today's interleaving —
 * and so the WAV — unchanged.
 */
async function scheduleArrangement(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
  walk: Generator<SongWalkItem, void, undefined>,
  signal?: AbortSignal,
): Promise<{ cancelled: boolean }> {
  const loopAutomation = planLoopAudioAutomation(snapshot, plan);
  let stepsSinceYield = 0;
  for (let next = walk.next(); !next.done; next = walk.next()) {
    const item = next.value;
    if (item.kind === 'pass') {
      applyLoopAudioState(engine, loopAutomation[item.passIndex]);
    } else if (item.kind === 'stepEnd') {
      stepsSinceYield += 1;
      if (stepsSinceYield >= SCHEDULE_YIELD_INTERVAL_STEPS) {
        stepsSinceYield = 0;
        await yieldPreservingRandomStream();
        if (signal?.aborted) return { cancelled: true };
      }
    } else {
      performTimelineEvent(engine, snapshot, item);
    }
  }
  return { cancelled: false };
}
```

In `renderMixdown`, the seeded block becomes:

```ts
const scheduleResult = await withSeededRandom(MIXDOWN_SEED, async () => {
  const engine = createRenderEngine(ctx);
  applyMasterState(engine, snapshot);
  return scheduleArrangement(engine, snapshot, plan, walkSongTimeline(snapshot, plan), signal);
});
```

(`plan` is the `planArrangement(snapshot)` already computed above it to size the context; keep that line and its comment.)

- [ ] **Step 2: Delete what the renderer no longer uses**

Remove `scheduleMelodyStep` and the imports it and the old loop needed: `emitStepEvents`, `playFullHoldChord`, `planPadArm`, `planChordStep`, `planMelodyStep`, `planBeatStep`, `buildLoopVoices`, `mixdownLeadTrack`, `mixdownFxTrack`, `padSnapshotForLoop`, `DEFAULT_VELOCITY`, `TICKS_PER_SIXTEENTH`, `MelodyPlanSnapshot`, and any other now-unused import. Keep `stepDurationSec` (context sizing, automation), `noteFrequency`, `synthReleaseSeconds`. Check acceptance 3:

```bash
grep -nE "from '\.\./playback/(chordPlayback|plan/(beatPlan|chordPlan|padPlan|melodyPlan|chordEvents))'" src/audio/export/renderMixdown.ts   # must print nothing
grep -n "songTimeline'" src/audio/export/renderMixdown.ts   # imports only walkSongTimeline, planArrangement and types
```

Rewrite the module docblock's first paragraph: the renderer binds a throwaway engine, applies master state, and performs `walkSongTimeline` item by item (the timeline is where the arrangement becomes events, R287); keep the offline-clock bullets.

- [ ] **Step 3: Stale comments in `chordPlayback.ts`**

`emitStepEvents`'s `engine` parameter docblock says the offline renderer passes its render engine — no longer true (the renderer performs timeline events and the shared rule is `stepNoteWindow`). Reword it: the parameter lets tests pass a fake engine; the clamp is shared with the song timeline through `stepNoteWindow`. Same for `playFullHoldChord`'s comment if it mentions the renderer. Do not remove the parameters (tests use them).

- [ ] **Step 4: Verify — the golden is the proof**

Run: `bun test src/audio/export/renderMixdownGolden.test.ts`
Expected: both tests PASS with the golden files unchanged. If the call-log test fails, the first differing entry names the call; compare it with the emit-order contract and the float expressions in Global Constraints — fix the code, never the golden.
Run: `bun test src/audio/export src/audio/playback src/architecture src/store/mixdownSlice.test.ts`
Expected: all PASS (`renderMixdown.test.ts`, `.sourceBus`, `Cancellation`, `RngIsolation`, `MelodyPlan`).
Run: `bun run verify && bun run eslint`
Expected: green; zero warnings; Knip zero findings.

- [ ] **Step 5: Commit**

```bash
git add src/audio/export/renderMixdown.ts src/audio/playback/chordPlayback.ts
git commit -m "refactor(mixdown): render by performing the song timeline walk

scheduleArrangement now applies pass automation and performs walk items
one at a time, resuming the walk only after each item is played, so the
planner and engine RNG draws keep their order. The renderer imports no
per-lane planner; the DEV-420 golden passes byte-identical.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: ADR-0034, rules and docs

**Goal:** Docs match the code (spec §10, acceptance 7). R001 throughout: no counts, versions or line numbers.

**Files:**
- Create: `docs/decisions/0034-pure-song-event-timeline.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/0027-planned-then-performed-playback.md`, `docs/decisions/0015-session-only-track-solo.md`, `.claude/rules/playback.md`, `.claude/rules/beat.md`, `docs/architecture/structure/README.md`, `docs/architecture/structure/03-audio.md`, `docs/architecture/structure/01-ui.md`, `docs/architecture/feature-overview.md`, `.claude/skills/dsp-audio/SKILL.md`, `CLAUDE.md`

- [ ] **Step 1: Confirm ids are free**

Run: `grep -rhoE "R[0-9]{3}" .claude/rules docs/decisions CLAUDE.md | sort -u | tail -1; ls docs/decisions | tail -2`
Expected: highest rule `R286`, highest ADR `0033`. If not, use the next free ids and say so in the report.

- [ ] **Step 2: ADR-0034**

Follow the template in `docs/decisions/README.md` (and the shape of `0033-batch-key-change-across-loops.md`). Content:
- Context: audit A4 (a planner reached the engine singleton through `chordPlayback.ts`), the drum half of A5 (no drum planner), `renderMixdown.ts` interleaving planning with rendering; DEV-428/DEV-429 need one source of "what plays when".
- Decision: `plan/songTimeline.ts` (`walkSongTimeline`, `buildSongTimeline`, `TimelineEvent`), `plan/songSnapshot.ts` (moved snapshot + adapters, `songTrackVoice`, `beatSnapshotForLoop`), `plan/chordEvents.ts` (A4), `plan/beatPlan.ts` (`planBeatStep`), the import-graph test; the renderer performs walk items incrementally.
- Why incremental (spec F8 and §6): list the engine draw sites (drum noise offset, lazy master noise buffer, subtractive noise buffer per colour, sample-and-hold LFO buffer) and the planner draw (arp `'random'`); collect-then-perform reorders them.
- Rejected alternatives: collect-then-perform; a dedicated arp RNG stream (audible change); a sequence field on events; an ESLint rule for the graph (none is transitive); extending the config-asserting purity test.
- Known limit (spec §11 R3): `buildSongTimeline` run outside a render draws arp `'random'` notes from a different stream than the WAV; the fix belongs to DEV-428.
- Proof: the golden (WAV sha256 + engine-call log) recorded before the refactor.
- "Rules this implies": R287, R288, R289, R290 (text as in Step 4), and "Amends ADR-0027: R227, R229, R230, R231, R234".

Add the index row in `docs/decisions/README.md` after 0033: `| [0034](0034-pure-song-event-timeline.md) | Pure song event timeline | walkSongTimeline/buildSongTimeline turn a snapshot into timed events; the mixdown performs the walk incrementally (RNG order); pure chord helpers and planBeatStep in plan/; an import-graph test keeps planners off the engine. |`

- [ ] **Step 3: ADR-0027 and ADR-0015 notes**

- ADR-0027: add an "Amended by [ADR-0034](0034-pure-song-event-timeline.md)" note near the top naming R227, R229, R230, R231, R234, and update those rules' text in its "Rules this implies" list to match Step 4.
- ADR-0015: R162's text names `audio/beatSteps.ts`; change it to `planBeatStep` (`audio/playback/plan/beatPlan.ts`) with "(path updated by ADR-0034)".

- [ ] **Step 4: `.claude/rules/playback.md`**

In "Planned, then performed", add (tags `(R###, ADR-0034)` in the file's existing style):
- **R287** — `buildSongTimeline`/`walkSongTimeline` in `plan/songTimeline.ts` is the one place an arrangement becomes timed events; `renderMixdown.ts` only applies pass automation and performs walk items, and calls no planner.
- **R288** — The renderer consumes `walkSongTimeline` incrementally, performing each item before resuming the walk; never collect the timeline before performing it. The walk's per-step emit order (drums, chord hold, bass hold, chord, bass, pad, lead, FX) is part of the contract.
- **R289** — No runtime import path from `src/audio/playback/plan/` reaches `audio/engine` or `playbackEngine`; `src/architecture/playbackPlannerImportGraph.test.ts` walks the graph.
- **R290** — Drums are planned by `planBeatStep` (`plan/beatPlan.ts`) for both the live stepper and the timeline; no caller decides drum voices or velocity itself.

Amend:
- **R227** — planner list gains `chordEvents.ts`, `beatPlan.ts`, `songSnapshot.ts`, `songTimeline.ts` (list them by name, no count); replace "the engine-touching exports of `../chordPlayback` are banned only by convention" with a pointer to R289.
- **R229** — a planner never imports `chordPlayback.ts` at all; gated by R289.
- **R230** — offline, full-hold strikes and note-ons are performed by `renderMixdown.ts` from walk items.
- **R231** — the per-lane snapshot list gains Beat (`BeatPlanSnapshot`); drop the number ("Four") — name the lanes instead.
- **R234** — the offline builder is `plan/songSnapshot.ts`; the store builder is `playbackPlanSnapshots.ts`.

`## Prohibited` gains one line each:
- `A planner call or engine-independent event decision inside renderMixdown.ts <!-- R287 -->`
- `Collecting the song walk into an array before performing it, or reordering its per-step emit order <!-- R288 -->`
- `A runtime import from plan/ that reaches audio/engine or playbackEngine <!-- R289 -->`
- `Deciding drum voices or velocity outside planBeatStep <!-- R290 -->`

and edit the existing R229 Prohibited line to "A planner importing `chordPlayback.ts`".

- [ ] **Step 5: `.claude/rules/beat.md`**

R162: `audio/beatSteps.ts` skips a muted voice's scheduled hits → `planBeatStep` (`audio/playback/plan/beatPlan.ts`) skips a muted voice's scheduled hits. (Its ADR is ADR-0015, updated in Step 3.)

- [ ] **Step 6: Architecture docs**

- `docs/architecture/structure/README.md`: A4 row → **Fixed.** (pure chord helpers in `plan/chordEvents.ts`; `src/architecture/playbackPlannerImportGraph.test.ts` guards the transitive edge). A5 row → **Partly fixed.** (drums planned in `plan/beatPlan.ts`; the React hook in `arpPlayback.ts` remains, deferred); its file column replaces `beatSteps.ts` with `plan/beatPlan.ts`. The "Deferred work" bullet drops A4 and keeps "A5 (hook half)". The mermaid node's `beatSteps` goes.
- `docs/architecture/structure/03-audio.md`: delete the `beatSteps.ts` row; drop `beatSteps` from the root-level logic list and the pure-module list near the end; the `plan/` row lists `padPlan`, `chordPlan`, `melodyPlan`, `chordEvents`, `beatPlan`, `songSnapshot`, `songTimeline`; the drums row of the controller table names `planBeatStep` (`plan/beatPlan.ts`) and drops the "**not** in `plan/`" note and the line-number reference (R001); §4 (offline render) describes: `planArrangement` sizes the context, `walkSongTimeline` yields pass markers, events and step ends, `scheduleArrangement` applies pass automation and performs each item before resuming the walk (RNG order, ADR-0034), `buildSongTimeline` is the drained, sorted form for DEV-428/429.
- `docs/architecture/structure/01-ui.md`: the `SequencerView` row's `audio/beatSteps` → `plan/beatPlan` (`planBeatStep`).
- `docs/architecture/feature-overview.md`: `audio/` row drops `beatSteps`; `audio/playback/` row lists `plan/{padPlan,chordPlan,melodyPlan,chordEvents,beatPlan,songSnapshot,songTimeline}`; the sentence saying the same planners drive `renderMixdown` says they drive it through the song timeline.
- `.claude/skills/dsp-audio/SKILL.md`: `audio/beatSteps.ts` → `audio/playback/plan/beatPlan.ts` (`planBeatStep`); if it describes the offline render walk, name `walkSongTimeline`.
- `CLAUDE.md`: the `playback.md` row in the rules table becomes `Clock, store→engine bridge, planned-then-performed playback, song timeline, snapshots, pub/subs`. No new cross-cutting line.

- [ ] **Step 7: Sweep and verify**

Run: `grep -rn "beatSteps\|beatStepEvents\|MixdownMelodyTrack" docs .claude CLAUDE.md src scripts | grep -v "docs/superpowers/"`
Expected: nothing (historical plans/specs under `docs/superpowers/` are left as written).
Run: `bun run verify && bun run eslint`
Expected: green; zero warnings.

- [ ] **Step 8: Commit**

```bash
git add docs/decisions .claude/rules/playback.md .claude/rules/beat.md docs/architecture .claude/skills/dsp-audio/SKILL.md CLAUDE.md
git commit -m "docs: ADR-0034 song event timeline, playback rules R287-R290 (DEV-420)

Records the incremental walk and why, the A4 import-graph guard and the
Beat planner; amends R227/R229/R230/R231/R234 and R162; marks audit A4
fixed and A5 partly fixed; syncs the architecture docs and the skill.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Completion gate and acceptance check

**Goal:** Prove spec §13 at branch head. No code change expected; if a check fails, fix it in a commit named for the fix.

- [ ] **Step 1: Golden byte-unchanged since Task 1**

```bash
T1=$(git log --format=%H --diff-filter=A -- src/audio/export/renderMixdownGolden.test.ts | tail -1)
git diff --exit-code "$T1" HEAD -- src/audio/export/renderMixdownGolden.test.ts src/audio/export/renderMixdownGolden.wav.sha256 src/audio/export/renderMixdownGolden.calls.json && echo UNCHANGED
git show --stat --format=%s "$T1"   # only the three golden files
```
Expected: `UNCHANGED`; the Task 1 commit touches exactly the three files.

- [ ] **Step 2: No test silently dropped (spec §11 R6)**

```bash
BASE=28822045
PAT="(test|describe)\\((['\"\`])[^'\"\`]+"
git grep -h -oE "$PAT" "$BASE" -- 'src/*.test.ts' 'src/*.test.tsx' | sort -u > /tmp/dev420-before.txt
git grep -h -oE "$PAT" HEAD -- 'src/*.test.ts' 'src/*.test.tsx' | sort -u > /tmp/dev420-after.txt
comm -23 /tmp/dev420-before.txt /tmp/dev420-after.txt
```
Expected: only `describe('beatStepEvents'` (renamed to `planBeatStep` in Task 3). Anything else is a dropped test — restore it.

- [ ] **Step 3: Structural acceptance**

```bash
ls src/audio/playback/plan/{chordEvents,beatPlan,songSnapshot,songTimeline}.ts
test ! -e src/audio/beatSteps.ts && echo "beatSteps gone"
grep -nE "chordPlayback|plan/(beatPlan|chordPlan|padPlan|melodyPlan|chordEvents)" src/audio/export/renderMixdown.ts   # nothing
grep -n "planBeatStep" src/components/useSequencerPlayback.ts
```

- [ ] **Step 4: Full gate**

Run: `bun run verify && bun run eslint`
Expected: every test passes (golden, graph test with its positive control, all §9.2 tests, all §9.3 files); `tsc` clean; ESLint zero errors and zero warnings; both Knip scans zero findings; build succeeds.

Report the golden commit sha, the `comm` output and the gate result. Do not push.
