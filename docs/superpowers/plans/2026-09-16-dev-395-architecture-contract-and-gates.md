# DEV-395: Music-Domain Architecture Contract and Dependency Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Solna's music-domain dependency direction, runtime flow and data ownership explicit and mechanically enforced — write the contract document, add the ESLint gate that confines `tonal` imports to today's known call sites, prove that gate with positive+negative fixtures, and fold the durable rule into CLAUDE.md. No audible, persisted or user-visible behaviour changes; no directory move.

**Architecture:** This issue does not create Music Core, the Tonal adapter, playback planners or playback controllers — none of those exist as separate modules yet (that is DEV-394/397's job). It defines their contract in a doc, and it extends the *existing* `eslint.config.js` layering pattern (`no-restricted-imports` with a `patterns`/`paths` allowlist, following the exact `TAPER_CONVERSION_BAN`/`VolumeFader.tsx` precedent already in that file) with one new, mechanically-enforced axis: **no new file may import `tonal` outside the six files that already do**, until DEV-394 collapses that allowlist down to the adapter's own file(s).

**Tech Stack:** Bun (`bun test`, `bun run eslint`, `bun run verify`), ESLint flat config (`eslint.config.js`), `eslint` package's programmatic `ESLint#lintText` API (already used by `src/data/dataLayerPurity.test.ts`), Markdown documentation.

**Spec:** This plan implements Linear issue DEV-395 (child of epic DEV-391). Cross-reference:
- `docs/superpowers/plans/2026-09-16-dev-391-music-domain-architecture-epic-plan.md` — epic roadmap, section "1. DEV-395" has the codebase survey this plan is built from.
- `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md` — decision D5 (new rules land `warn` then flip to `error` in the phase that fixes the offending code) and the "ESLint rule matrix" section this plan's new row extends.
- `eslint.config.js` (repo root) — the file every code task in this plan edits. Read in full before starting; its own comments document the "a `no-restricted-imports`/`no-restricted-syntax`/`no-restricted-globals` block REPLACES the whole rule for every file it matches, it does not merge across config objects" trap, which every task below must respect.
- `src/data/dataLayerPurity.test.ts` — the exact test pattern (`ESLint#lintText` against a synthetic, non-existent file path, filtering messages by rule id, asserting severity) this plan's new test file follows.

## Global Constraints

- **No musical behaviour changes.** This issue only adds documentation and ESLint/test gates. No file under `src/audio/`, `src/store/`, `src/components/`, or `src/data/` changes its runtime behaviour.
- **`bun run verify` must pass at the end of the plan** (per DEV-395's own Definition of Done) — this runs `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run check:contrast && bun run check:levels && bun run check:dead-code && bun run check:dead-code:production && bun run build` (see `package.json`'s `verify` script).
- **`no-restricted-imports` (and its TS-aware/`no-restricted-syntax`/`no-restricted-globals` siblings) REPLACE, not merge, per matching file.** Every new block added below must either spread in the arrays it would otherwise silently drop (mirroring `TAPER_CONVERSION_BAN`/`GLOBAL_RESTRICTED_SYNTAX`'s existing spread pattern) or be placed so a later, more specific block only narrows what an earlier general block already set.
- **CLAUDE.md's own rule applies to this task**: do not record file counts or version numbers in CLAUDE.md — write the durable rule, not a number that will go stale (e.g. do not write "6 files import tonal"; write "the current allowlisted call sites").
- **Do not touch the analyser-exception list.** `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`, `ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx` and their existing `no-restricted-imports: 'off'` block (the last block in `eslint.config.js`) must not be edited by any task in this plan. Task 3's verification step explicitly re-reads that block to confirm it is byte-for-byte unchanged.
- Branch naming: this plan assumes work happens on `refactor/dev-395-architecture-contract-and-gates` (already checked out).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` | Create (Task 1) | The actual architecture contract: three diagrams/matrices, canonical terms, per-layer responsibilities, the "not moved yet, but gated" note. This is the durable reference doc; this plan file is the task list that produces it. |
| `src/architecture/dependencyLayers.test.ts` | Create (Task 2) | The new cross-cutting architecture test. Lives outside `src/data/`, `src/audio/`, `src/store/`, `src/components/` on purpose: the tonal-confinement axis spans all four of those folders, so it does not belong to any one of their existing per-folder test files (`dataLayerPurity.test.ts` only proves the `src/data/` bans). This is a new, narrowly-scoped sibling to that file, not a replacement for it. |
| `eslint.config.js` | Modify (Task 2) | Add `TONAL_IMPORT_BAN` and thread it through every existing `no-restricted-imports` block, with per-file carve-outs for the six current importers, exactly mirroring the existing `TAPER_CONVERSION_BAN`/`VolumeFader.tsx` structure. |
| `CLAUDE.md` | Modify (Task 3) | Add the durable rule paragraph recording the Tonal-confinement axis and pointing at the contract doc, immediately after the existing four-layers section. |

---

### Task 1: Write the music-domain architecture contract document

**Files:**
- Create: `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`

**Interfaces:**
- Consumes: nothing (pure documentation task).
- Produces: the canonical terms (`musical intent`, `derived representation`, `playable event`, `runtime state`, `display spelling`) and the six current `tonal` importer paths that Task 2's ESLint allowlist and test fixtures must match **exactly** — copy the list verbatim from this document into Task 2, do not re-derive it.

This is a documentation-only task: no code, no `bun test` cycle. Its "definition of done" is a self-review checklist instead of a red/green test.

- [ ] **Step 1: Confirm today's six `tonal` importers are still exactly these six**

Run:
```bash
grep -rn "from 'tonal'" src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
```
Expected output (if this list has drifted since this plan was written, stop and update every list in this plan — including Task 2's allowlist and fixtures — to match the new grep output before continuing):
```
src/utils/noteSpelling.ts:1:import { Note, Scale } from 'tonal';
src/utils/musicTheory.ts:1:import { Chord, Interval, Note, Scale, transpose } from 'tonal';
src/audio/arpeggiator.ts:1:import { Note, transpose } from 'tonal';
src/audio/bassPatterns.ts:1:import { Note } from 'tonal';
src/audio/playback/padPlayback.ts:1:import { transpose } from 'tonal';
src/store/midiInput.ts:1:import { Note } from 'tonal';
```

- [ ] **Step 2: Write the contract document**

Create `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` with exactly this content:

````markdown
# Music-Domain Architecture Contract

**Context:** This document is the deliverable of [DEV-395](https://linear.app/pathompong-thitithan/issue/DEV-395), the first child of epic [DEV-391](https://linear.app/pathompong-thitithan/issue/DEV-391/epic-music-domain-architecture-tonal-boundary-derived-state-and) (music-domain architecture). It must not regress [DEV-380](https://linear.app/pathompong-thitithan/issue/DEV-380/music-theory-rework-derive-chord-qualities-and-enharmonic-spelling)'s contract: canonical-sharp identity is what every generated/computed/persisted note name uses, and key-aware display spelling (`src/utils/noteSpelling.ts`) is applied only where a value is rendered, never where it is stored, compared or used as a lookup key.

This document separates three concerns the repo's existing `data → audio → store → components` layering rule (CLAUDE.md, enforced in `eslint.config.js`) currently conflates: **compile-time dependency direction**, **runtime command/event flow**, and **persisted-vs-derived data ownership**. It also names the two music-domain concepts that do not exist as code yet — Music Core / the Tonal adapter (DEV-394), and playback planners / playback controllers (DEV-397) — and states their contract now, so later children build to a spec instead of inventing one mid-implementation.

**This issue changes boundaries and guards only.** No audible, persisted or user-visible behaviour changes. Music Core, the Tonal adapter, playback planners and playback controllers are **not created by this issue** — they are documented here and partially gated (see "Gated but not yet moved" below) so DEV-394/396/397/399 build inside a contract that already exists.

## Canonical terms

- **Musical intent** — a persisted, user-authored decision about what should play: a chord's root and quality, a key/scale choice, a note's pitch and timing in the lead/FX grid, a Beat pattern's grid, a Beat patch's `beatParams`. Lives in `src/store/` slices and `src/data/` authored catalogs. Never itself shaped like an engine call (no `AudioContext` time, no resolved frequency, no voice id).
- **Derived representation** — a value computed *from* musical intent by a pure function, never itself an independent source of truth even when it happens to be stored. Example: a chord's per-degree quality (`resolveDegreeQuality`), a chord's spelled display label. `ChordItem.notes` is a **known exception that is not yet compliant** — it is currently stored as an independent `string[]` that can disagree with `root`/`quality` (DEV-396 closes this gap); until then, treat any code that reads `chord.notes` directly as reading a value that is supposed to be a derived representation but is not mechanically guaranteed to be one.
- **Playable event** — a fully resolved, timestamped instruction ready for the audio engine: pitch already resolved to a frequency or canonical note name, timing already resolved to an `AudioContext` time, voice ownership (`VoiceOwner`) already assigned. The sole output type of a playback planner (see below). No playable event may name a scale, a key, a chord quality, or a Tonal.js type.
- **Runtime state** — a transient value that exists only while the app is running and is never persisted: the shared 16th-clock's current step, which voices are currently sounding, `soloTracks`, `recordingTrack`, meter readings. May live in a slice's non-persisted field (excluded from `partializeAppState`/`PROJECT_CONTENT_KEYS`) or entirely outside the store, in planner/controller-local state.
- **Display spelling** — the key-aware enharmonic respelling `src/utils/noteSpelling.ts` applies to an otherwise canonical-sharp note name, at the exact point a value is rendered to a person (a chip, a heading, a tooltip, a picker option label) and nowhere else (DEV-380). A planner or controller that computes display spelling for anything other than a UI-bound label is a contract violation, because a playable event must never carry one.

## 1. Compile-time dependency graph

This extends the existing enforced layering (CLAUDE.md "Four layers, enforced by eslint"; unchanged by this issue) with the Music Core / Tonal adapter axis, and the not-yet-existing planner/controller split.

```
src/data/ (authored catalogs)
    |  (imports nothing at runtime, not even a sibling — unchanged)
    v
Music Core                              <- NEW CONCEPT (DEV-394), does not exist as a module yet
  +-- Tonal adapter (the ONLY code       <- NEW CONCEPT (DEV-394), does not exist as a module yet
  |     allowed to `import ... from 'tonal'`
  |     once DEV-394 lands)
    |  (Music Core's public API only — never `tonal` directly, from anywhere outside the adapter)
    v
src/store/ (application state: musical intent + runtime state)
    |
    +---------------------------------------------+
    v                                              v
playback planners                        src/audio/ (engine/DSP)
  <- NEW CONCEPT (DEV-397), pure                (never imports store/ or components/;
     functions: snapshot of musical               may import data/; today may still import
     intent in, playable events out.              Tonal/musicTheory directly — DEV-399
     MUST NOT read the store, the engine,          narrows this once planners exist)
     `AudioContext`, or the wall clock.
    |
    v
playback controllers
  <- NEW CONCEPT (DEV-397), own the store
     subscription, the shared 16th clock
     (`subscribeClock`/`stopClockTimer`),
     and the hand-off into src/audio/'s
     engine calls (`playbackNoteOn` etc.)
    |
    v
src/audio/ (engine/DSP) — receives playable events only, once DEV-399 lands

src/components/ (UI)
  -> may read src/store/ (musical intent, runtime state, derived representations)
  -> must not import audio/engine (existing exceptions: AudioVisualizer.tsx,
     ui/VuMeter.tsx, ui/AmbientBackdrop.tsx, ui/GainReductionMeter.tsx,
     ui/SourceMeter.tsx — read-only analyser consumers, unchanged and untouched
     by this issue; see "Confirming the analyser exceptions" below)
  -> never imports `tonal` directly, never imports a playback planner or
     controller's internals — a component dispatches a store action; it does
     not call a planner
```

**Gated but not yet moved.** Music Core, the Tonal adapter, playback planners and playback controllers are concepts, not directories, as of this issue. What DEV-395 gates today is the one boundary that is already mechanically checkable without those modules existing: **no file outside the current, explicit allowlist of six call sites may `import ... from 'tonal'`.** The allowlist (verified against `grep -rn "from 'tonal'" src` at the time this document was written) is:

- `src/utils/noteSpelling.ts`
- `src/utils/musicTheory.ts`
- `src/audio/arpeggiator.ts`
- `src/audio/bassPatterns.ts`
- `src/audio/playback/padPlayback.ts`
- `src/store/midiInput.ts`

This list is deliberately **today's importers, not the future adapter's file path** — the adapter does not exist yet, so allowlisting a path nothing occupies would enforce nothing. DEV-394 replaces this allowlist with the adapter's own file(s) as part of consolidating these six call sites; from that point on, the six paths above are no longer allowlisted directly, only the adapter is. The enforcement mechanism (an ESLint `no-restricted-imports` rule with a `paths` ban plus per-file carve-outs) does not change — only the file list it names does.

The planner/store and planner/engine boundaries in the diagram above are **not** ESLint-enforceable yet, because a planner is not yet a distinct file — today's bridge functions (`src/components/loop/chord/useChordPlayback.ts`, `src/components/loop/lead/useLeadPlayback.ts`, `src/components/useSequencerPlayback.ts`) legitimately read the store *and* call the engine in the same function, because they are both the planner and the controller until DEV-397 splits them. Banning a store read from those files today would break working code with no replacement to move it to. DEV-397 is where this boundary becomes a file boundary and therefore an ESLint boundary.

## 2. Runtime command/event flow

**Target end state** (after DEV-394/396/397/399 land):

```
UI event (keypress, knob drag, pattern-grid edit)
  -> store action: writes musical intent into a slice
       -> playback planner: pure fn(immutable snapshot of musical intent) -> playable event[]
            -> playback controller: owns the store subscription + the shared 16th clock;
               schedules each playable event at its resolved AudioContext time
                 -> src/audio/ engine: opaque voice id + resolved pitch/timing only
  -> UI read: a component selector reads musical intent / a derived representation from the
     store and re-renders; display spelling is applied here, at render, never earlier
```

**Today's actual flow** (unchanged by this issue — recorded here so the target above is legible as a diff, not a fiction):

```
UI event -> store action (musical intent)
  -> bridge function (e.g. useChordPlayback.ts, useLeadPlayback.ts,
     useSequencerPlayback.ts) — reads useAppStore.getState() directly, resolves
     musical intent into events (planner's job) AND owns the clock subscription
     and calls the engine (controller's job), interleaved in the same function
       -> src/audio/ engine
```

The two flows use the *same* resolution functions in most lanes already (e.g. `useLeadPlayback.ts` and `renderMixdown.ts` both call `leadScheduleHits`/`leadSoundingNotes`/`resolveLeadStepTriggers`; `useChordPlayback.ts` and `renderMixdown.ts` both call `resolvePlaybackRhythmCycle`/`buildChordEvents`/`resolveBassSteps`) — DEV-397's job is to extract the pure half of each bridge into its own file, not to write new resolution logic.

## 3. Persisted-vs-derived data ownership

| Value | Authoritative source | Derived from | Computed today in | Persisted? | Target owner once DEV-391 lands |
|---|---|---|---|---|---|
| Chord root, quality | `ChordItem.root`/`.quality` | — (authored/edited directly) | `src/store/chordsSlice.ts` et al. | Yes (project content) | Music Core-typed musical intent, unchanged ownership |
| Chord notes | **Not yet compliant** — stored as independent `string[]` | Should be root+quality (DEV-396) | `deriveChordNotes`/`generateBlockChordNotes` (`musicTheory.ts`), but several consumers read `chord.notes` directly instead (`chordPlayback.ts`, `bassPatterns.ts`, `renderMixdown.ts`, `SortableChordCard.tsx`) | Yes today (DEV-396 may drop this from the persisted shape) | Derived representation, computed by Music Core, never independently stored |
| Scale/key choice | `musicContext` slice | `src/data/scales.ts` (authored) | n/a (direct read) | Yes | Musical intent, unchanged |
| Per-degree chord quality | Derived, never persisted | `resolveDegreeQuality` (`musicTheory.ts`) | `musicTheory.ts` | No | Derived representation via Music Core |
| Display-spelled note/chord label | Derived, never persisted | `noteSpelling.ts` functions, keyed by the canonical-sharp value + active key | Wherever a label renders (`formatChordLabel`, `getTonicSpelling`, etc.) | No | Derived representation via Music Core's Tonal adapter, applied at render only |
| Lead/FX note pitch + tick position | `leadMelodySteps`/`fxMelodySteps` | — (authored/edited directly, at tick resolution) | `src/store/` melody slices | Yes | Musical intent, unchanged |
| Beat pattern grid | `beatPattern` | — (authored/edited directly) | `src/store/beatSlice.ts` | Yes | Musical intent (rhythm, not pitch — no Tonal involvement), unchanged |
| Beat sound patch | `beatParams` | — (authored/edited directly) | `src/store/beatSlice.ts` | Yes | Musical intent, unchanged |
| Resolved playback event (note-on time, resolved frequency, voice owner) | Not yet a distinct value | Chord/lead/bass/beat musical intent, resolved by today's bridge functions | Interleaved inside `useChordPlayback.ts`/`useLeadPlayback.ts`/`useSequencerPlayback.ts`/`renderMixdown.ts` | No (never persisted, never should be) | Playable event, produced by a playback planner (DEV-397) |
| Shared 16th-clock step, sounding-voice bookkeeping, `soloTracks`, `recordingTrack` | n/a | n/a | `src/audio/clock.ts`, `SynthVoiceManager`, ui slice | No (session-only; `soloTracks` explicitly excluded from `partializeAppState`/`PROJECT_CONTENT_KEYS`) | Runtime state, unchanged |

## 4. Named layer responsibilities

- **Authored catalogs (`src/data/`)** — literal tables only (synth/Beat presets, drum grids, chord progressions, chord rhythms, bass patterns, effect chains, scales). Imports nothing at runtime, not even a sibling in `src/data/`. Already fully enforced (`eslint.config.js`'s `src/data/**` block; proven by `src/data/dataLayerPurity.test.ts`). Unaffected by this issue.
- **Music Core (future, DEV-394)** — the one public API every other music-domain reader calls for parsing, comparing, transposing, formatting pitch, resolving chord qualities, and applying display spelling. Exposes typed results; a genuinely invalid input is a typed failure or a thrown error, never a silent fallback to a default root/quality/frequency (per DEV-392's AC). Does not read the store, the engine, or `AudioContext`.
- **Tonal adapter (future, DEV-394)** — the only code in the whole app permitted to `import ... from 'tonal'`, once it exists. Confined behind Music Core's API; nothing outside the adapter names a Tonal type or function. Until DEV-394 lands, this issue's ESLint gate stands in for the adapter boundary by allowlisting today's six call sites directly (see "Gated but not yet moved" above).
- **Application/store (`src/store/`)** — one Zustand store composed of slices; owns musical intent and non-playback-tick runtime state (`soloTracks`, `recordingTrack`, etc.). Never imports `components/` (existing layering rule 2, unchanged). Calls Music Core for anything Tonal-shaped; never calls a playback planner directly from a component-facing action (a planner is invoked by a controller, not by a store action).
- **Playback planners (future, DEV-397)** — pure functions. Input: an immutable snapshot of musical intent (never the live Zustand singleton, never `useAppStore.getState()`). Output: playable events. Must not read the store, the audio engine, `AudioContext`, or the wall clock (`Date.now()`, `performance.now()`), and must not apply display spelling (a planner's output is for the engine, not for a person to read).
- **Playback controllers (future, DEV-397)** — own the store subscription, the shared 16th-clock lifecycle (`subscribeClock`/`stopClockTimer` — "the clock runs iff a player holds a subscription", CLAUDE.md), and the hand-off of a planner's playable events into `src/audio/`'s engine calls. This is where side effects, `AudioContext` time, and the live store singleton are allowed to meet the planner's pure output.
- **Audio engine/DSP (`src/audio/`)** — raw Web Audio API DSP plus the `audioEngine` singleton. Never imports `store/` or `components/` (existing layering rule 1, unchanged). May import `data/`. Once DEV-399 lands, takes only opaque voice identity and already-resolved pitch/timing — no Tonal, scale, chord, spelling or reharmonization import. Today, several files under `src/audio/` still import Tonal or `musicTheory` directly (the six-importer allowlist above includes three of them); that is the pre-DEV-399 state this issue documents and partially gates, not a defect this issue fixes.
- **UI (`src/components/`)** — dumb views. Must not import `audio/engine` (existing layering rule 3; the read-only analyser exceptions below are unchanged). Reads musical intent, derived representations and runtime state from the store via selectors; applies no music-domain logic of its own; never imports `tonal` and never will, at any point in the epic.

## Confirming the analyser exceptions remain compatible

The five files exempted from layering rule 3 (`src/components/AudioVisualizer.tsx`, `src/components/ui/VuMeter.tsx`, `src/components/ui/AmbientBackdrop.tsx`, `src/components/ui/GainReductionMeter.tsx`, `src/components/ui/SourceMeter.tsx`) read a Web Audio analyser node once per animation frame through the shared meter scheduler (`src/utils/meterScheduler.ts`) and never write to a store slice. None of them import `tonal`, none of them are a playback planner or controller, and nothing in this document's contract changes what they do or how they are exempted — they remain read-only analyser consumers, gated by the same `eslint.config.js` block (the file's final block, `no-restricted-imports: 'off'` for those five paths plus test files) that exempts them today. This issue does not touch that block.
````

- [ ] **Step 3: Self-review the document**

Re-read the file just written and confirm:
- It names both DEV-391 and DEV-380 (search for both strings — both must appear).
- It contains no version numbers or file counts that will go stale (e.g. it says "the current allowlisted call sites", never "6 files").
- The six-path allowlist matches Step 1's grep output exactly.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
git commit -m "$(cat <<'EOF'
docs: add the music-domain architecture contract (DEV-395)

Names three separate concerns the existing data/audio/store/components
layering rule conflates -- compile-time dependencies, runtime flow, and
persisted-vs-derived data ownership -- and defines Music Core, the Tonal
adapter, playback planners and playback controllers before any of them
exist as code, so DEV-394/396/397/399 build to a spec instead of one
invented mid-implementation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

### Task 2: Gate `tonal` imports to the current allowlist, with a failing-then-passing test

**Files:**
- Create: `src/architecture/dependencyLayers.test.ts`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: the six-path allowlist from Task 1 (`src/utils/noteSpelling.ts`, `src/utils/musicTheory.ts`, `src/audio/arpeggiator.ts`, `src/audio/bassPatterns.ts`, `src/audio/playback/padPlayback.ts`, `src/store/midiInput.ts`).
- Produces: a new `TONAL_IMPORT_BAN` constant in `eslint.config.js`, wired into every existing `no-restricted-imports` block per the replace-not-merge rule; a passing test file proving both directions (allowed for the six, forbidden everywhere else) survive that wiring, plus regression fixtures proving the pre-existing layering-1/2 bans still fire on the three carved-out `src/audio/`/`src/store/` files.

This task follows red-green: write the test first (it fails, because no rule bans `tonal` yet), then edit `eslint.config.js` (it passes).

- [ ] **Step 1: Write the failing test file**

Create `src/architecture/dependencyLayers.test.ts`:

```ts
/**
 * The committed proof that DEV-395's `tonal`-confinement gate is armed.
 *
 * `src/data/dataLayerPurity.test.ts` proves the src/data/ bans; this file is
 * its sibling for the one new axis DEV-395 adds, which spans src/utils/,
 * src/audio/ and src/store/ at once and therefore does not belong inside any
 * single folder's own test. See
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
 * for the contract this test enforces and the allowlist rationale.
 *
 * The allowlist below is deliberately EXACT and LITERAL — six file paths,
 * copied from the contract doc, not a glob and not "anything under src/audio/
 * that already imports tonal". DEV-394 shrinks this list to the Tonal
 * adapter's own file(s); until then, a new tonal import anywhere else is a
 * red gate a reviewer sees, not a silent pass.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

/** Rule ids this file's assertions care about; everything else is noise. */
const GUARDED = new Set(['no-restricted-imports']);

async function guardedMessages(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const TONAL_IMPORT = "import { Note } from 'tonal';\nexport const N = Note;\n";

describe('tonal import confinement (DEV-395)', () => {
  test('a new src/audio/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/audio/newDspHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the allowlisted src/audio/arpeggiator.ts may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/audio/arpeggiator.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('src/audio/arpeggiator.ts is still banned from importing store/ (layering rule 1 survives the carve-out)', async () => {
    expect(
      await guardedMessages(
        "import { useAppStore } from '@/store/store';\nexport const S = useAppStore;\n",
        'src/audio/arpeggiator.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/store/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/store/newSlice.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the allowlisted src/store/midiInput.ts may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/store/midiInput.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('src/store/midiInput.ts is still banned from importing components/ (layering rule 2 survives the carve-out)', async () => {
    expect(
      await guardedMessages(
        "import { Keyboard } from '@/components/ui/Keyboard';\nexport const K = Keyboard;\n",
        'src/store/midiInput.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the allowlisted src/utils/noteSpelling.ts may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/utils/noteSpelling.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('a new src/utils/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/utils/someOtherHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/components/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/components/loop/SomeView.tsx'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('VolumeFader.tsx importing tonal is still an error (its taper-ban carve-out does not exempt it from this one)', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/components/ui/VolumeFader.tsx'),
    ).toContainEqual(err('no-restricted-imports'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/architecture/dependencyLayers.test.ts`

Expected: the first test (`a new src/audio/ file importing tonal is an error`) and every other "...is an error" test **FAIL** (no `no-restricted-imports` message is produced yet, because no rule bans `tonal` anywhere). The "may still import tonal" tests pass vacuously. This confirms the gate does not exist yet.

- [ ] **Step 3: Add `TONAL_IMPORT_BAN` and wire it into every existing block**

Open `eslint.config.js`. Add the new constant immediately after `TAPER_CONVERSION_BAN`'s declaration (after line 37, before the `GLOBAL_RESTRICTED_GLOBALS` comment block):

```js
// DEV-395: confines `tonal` to the current, explicit allowlist of production
// call sites until DEV-394 consolidates them behind a single Music Core /
// Tonal adapter — see
// docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md.
// `paths` (not `patterns`) is used because this bans one exact bare package
// specifier, not a glob over path shapes — there is no `tonal/subpath` in use
// anywhere in this repo to accidentally miss or over-match.
// Same replace-not-merge trap as TAPER_CONVERSION_BAN: this is spread into
// every block that already owns a `no-restricted-imports` entry for a folder
// none of today's six importers live in, and each of the six gets its own
// carve-out block (mirroring VolumeFader.tsx's existing carve-out) that keeps
// every OTHER ban for that file but omits this one.
const TONAL_IMPORT_BAN = {
  name: 'tonal',
  message:
    "DEV-395: 'tonal' is confined to today's allowlisted call sites until DEV-394 builds the Music Core/Tonal adapter — see docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md.",
};
```

- [ ] **Step 4: Wire the audio/** block and add its carve-out**

Find the "Layering rule 1: audio/ never imports store/ or components/" block (currently lines 150–165) and replace it with:

```js
  {
    // Layering rule 1: audio/ never imports store/ or components/.
    // DEV-395 excludes today's three tonal-importing files here (they keep
    // every other ban via their own carve-out block right below) and adds
    // the tonal ban for every other file under src/audio/.
    files: ['src/audio/**/*.{ts,tsx}'],
    ignores: [
      'src/audio/arpeggiator.ts',
      'src/audio/bassPatterns.ts',
      'src/audio/playback/padPlayback.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // DEV-395 carve-out: today's three tonal-importing files under src/audio/.
    // Same layering-rule-1 bans as the block above, minus the tonal ban —
    // DEV-394 removes this block entirely once these files no longer import
    // tonal directly.
    files: [
      'src/audio/arpeggiator.ts',
      'src/audio/bassPatterns.ts',
      'src/audio/playback/padPlayback.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
```

- [ ] **Step 5: Wire the store/** block and add its carve-out**

Find the "Layering rule 2: store/ must not import components/" block (currently lines 218–232) and replace it with:

```js
  {
    // Layering rule 2: store/ must not import components/.
    // DEV-395 excludes src/store/midiInput.ts here (it keeps the components
    // ban via its own carve-out block right below) and adds the tonal ban
    // for every other file under src/store/.
    files: ['src/store/**/*.{ts,tsx}'],
    ignores: ['src/store/midiInput.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            { group: ['**/components/**'], message: 'store/ must not import components/ (layering rule 2)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // DEV-395 carve-out: today's one tonal-importing file under src/store/.
    // Same layering-rule-2 ban as the block above, minus the tonal ban —
    // DEV-394 removes this block once this file no longer imports tonal
    // directly.
    files: ['src/store/midiInput.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/components/**'], message: 'store/ must not import components/ (layering rule 2)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
```

- [ ] **Step 6: Wire the components/** block and the VolumeFader.tsx block**

Find the "Layering rule 3" block (currently lines 233–259, `files: ['src/components/**/*.{ts,tsx}']`, `ignores: ['src/components/ui/VolumeFader.tsx']`). None of today's six tonal importers live under `src/components/`, so no new carve-out is needed here — just add the tonal ban:

```js
  {
    // Layering rule 3: components are dumb views — no direct audio/engine.
    // ... (existing comment block unchanged) ...
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/VolumeFader.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            { group: ['**/audio/engine'], message: 'components must not import audio/engine (layering rule 3)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
```

Then find the "VolumeFader.tsx: the one exception to the taper ban above" block (currently lines 260–275) and add the tonal ban there too, since VolumeFader.tsx is not one of the six allowlisted files and must stay banned like everything else:

```js
  {
    // VolumeFader.tsx: the one exception to the taper ban above, and the
    // reason it needs its own block rather than an `ignores` entry with no
    // replacement — it must keep layering rule 3's audio/engine ban and
    // DEV-395's tonal ban.
    files: ['src/components/ui/VolumeFader.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            { group: ['**/audio/engine'], message: 'components must not import audio/engine (layering rule 3)' },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 7: Wire the catch-all block and add its carve-out**

Find the "Everything else that can import `gainUnits`..." block (currently lines 276–291) and replace it with:

```js
  {
    // Everything else that can import `gainUnits` but is not already covered
    // by one of the layering blocks above (which each carry their own copy
    // of TAPER_CONVERSION_BAN) or by src/data/ (banned from importing any
    // value at all, taper functions and tonal alike, by its own block below).
    // DEV-395 excludes the two remaining tonal-importing files here (they
    // keep the taper ban via their own carve-out block right below) and adds
    // the tonal ban for every other file this block reaches.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/audio/**/*.{ts,tsx}',
      'src/store/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/data/**/*.{ts,tsx}',
      'src/utils/noteSpelling.ts',
      'src/utils/musicTheory.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { paths: [TONAL_IMPORT_BAN], patterns: [TAPER_CONVERSION_BAN] }],
    },
  },
  {
    // DEV-395 carve-out: the two remaining tonal-importing files, both under
    // src/utils/. Same taper ban as the block above, minus the tonal ban —
    // DEV-394 removes this block once these files no longer import tonal
    // directly.
    files: ['src/utils/noteSpelling.ts', 'src/utils/musicTheory.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TAPER_CONVERSION_BAN] }],
    },
  },
```

Leave the `src/data/**` block (its own `@typescript-eslint/no-restricted-imports` bans every value import, `tonal` included) and the final analyser-exceptions block completely untouched.

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test src/architecture/dependencyLayers.test.ts`

Expected: all 10 tests **PASS**.

- [ ] **Step 9: Run the full ESLint suite to confirm no unrelated regressions**

Run: `bun run eslint`

Expected: zero errors, zero warnings (this repo's existing zero-finding baseline — see CLAUDE.md's "Commands" section). If any of today's six allowlisted files now reports a `no-restricted-imports` error for anything other than `tonal`, re-check that Step 4/5/7's carve-out blocks restated every ban the general block already had (this is the exact mistake CLAUDE.md's `no-restricted-imports` comments warn about).

- [ ] **Step 10: Run `bun test` to confirm no other suite broke**

Run: `bun test`

Expected: full suite passes, including `src/data/dataLayerPurity.test.ts` (unaffected — its block was not touched) and the six files' own existing tests (`src/audio/arpeggiator.test.ts`, `src/audio/bassPatterns.test.ts`, `src/store/midiInput.ts`'s tests if any, etc. — none of them import from `eslint.config.js`, so this step is a sanity check, not an expected-change check).

- [ ] **Step 11: Commit**

```bash
git add eslint.config.js src/architecture/dependencyLayers.test.ts
git commit -m "$(cat <<'EOF'
feat(lint): confine tonal imports to today's allowlisted call sites (DEV-395)

Adds a no-restricted-imports ban on the bare `tonal` specifier everywhere
except the six files that already import it, mirroring the existing
TAPER_CONVERSION_BAN/VolumeFader.tsx carve-out pattern. DEV-394 will shrink
this allowlist to the Tonal adapter's own file(s) once it exists; until
then, a new tonal import anywhere else is a red gate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

### Task 3: Record the durable rule in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the contract doc's path (Task 1) and the six-path allowlist (Task 1/2).
- Produces: nothing consumed by later tasks — this is the last content task.

- [ ] **Step 1: Insert the new paragraph after the four-layers section**

In `CLAUDE.md`, find the end of point 4 in the "Four layers, enforced by eslint" list — the sentence ending `...this one has drifted behind it before, so add to both or the allowlist quietly grows without anyone reading it.` (immediately before the `src/utils/ stays outside the chain...` paragraph). Insert this new paragraph directly after it:

```markdown

**A fifth axis sits on top of the four layers: Tonal.js is confined to an explicit allowlist,
not yet a directory.** `tonal` may be imported only from the paths `eslint.config.js`'s
`TONAL_IMPORT_BAN` carve-outs name — today that is `src/utils/noteSpelling.ts`,
`src/utils/musicTheory.ts`, `src/audio/arpeggiator.ts`, `src/audio/bassPatterns.ts`,
`src/audio/playback/padPlayback.ts` and `src/store/midiInput.ts`, enforced with the same
replace-not-merge `no-restricted-imports` pattern as the four layers above (see
`TAPER_CONVERSION_BAN` and its carve-outs for the mechanism this reuses). The allowlist names
today's importers, not a future adapter path, because Music Core and its Tonal adapter
(DEV-394) do not exist as modules yet — allowlisting a path nothing occupies would enforce
nothing. A **musical intent** (a persisted, user-authored decision — a chord's root/quality, a
key, a note's pitch and timing) is not the same thing as a **derived representation** (a value a
pure function computes from musical intent, such as a resolved chord quality or a display-spelled
label) or a **playable event** (a fully resolved, timestamped instruction — pitch and timing
already resolved, voice ownership already assigned — that is the sole input the audio engine may
take once DEV-399 narrows its contract); the full contract, including the compile-time,
runtime-flow and data-ownership diagrams, lives in
`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`. `src/data/`'s
own block already forbids every value import including `tonal`, so it carries no separate
carve-out. The analyser exceptions two paragraphs up (`AudioVisualizer.tsx`, `ui/VuMeter.tsx`,
`ui/AmbientBackdrop.tsx`, `ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx`) are unrelated to this
axis and unchanged by it.
```

- [ ] **Step 2: Self-review for the "no version numbers/file counts" rule**

Re-read the inserted paragraph and confirm it names the six paths as an explicit list (needed — this is the literal allowlist, not a volatile derived count) but never states "6 files" or any other count as a fact to remember; the paragraph should read correctly even if a future reader is only skimming for the *rule*, not the current census.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: record the tonal-confinement rule in CLAUDE.md (DEV-395)

Points at the new architecture contract doc and states the durable rule
(an explicit allowlist, not yet a directory) rather than a file count that
will go stale the moment DEV-394 moves these imports behind the adapter.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

### Task 4: Full verification gate

**Files:** none (verification only).

**Interfaces:**
- Consumes: the complete state of the branch after Tasks 1–3.
- Produces: the DEV-395 Definition of Done's `bun run verify` pass.

- [ ] **Step 1: Run the full verification gate**

Run: `bun run verify`

Expected: passes end to end (`bun test`, `bun run lint`, `bun run eslint`, `bun run check:keys`, `bun run check:drums`, `bun run check:contrast`, `bun run check:levels`, `bun run check:dead-code`, `bun run check:dead-code:production`, `bun run build`).

If `check:dead-code` or `check:dead-code:production` (Knip) flags `src/architecture/dependencyLayers.test.ts`: check `knip.json`'s `project` glob (`src/**/*.{ts,tsx}!` with `!src/**/*.test.{ts,tsx}!` excluding test files) — a `*.test.ts` file under `src/architecture/` should already match that exclusion the same way every other `*.test.ts` file does, so this is expected to be a non-issue; if Knip still flags it, the fix is to confirm the glob syntax matches Knip's actual exclusion semantics (test with `bun run check:dead-code` in isolation) rather than adding a new Knip exception.

If `bun run build` fails: it means one of Task 2's new blocks introduced a genuine `no-restricted-imports` violation somewhere in `src/` that was previously unbanned and now fires on real, existing code (not a fixture) — this would mean the six-path allowlist in Task 1/2 has drifted from the actual current importers. Re-run Task 1 Step 1's grep, compare against the allowlist used in every block from Task 2, and correct any mismatch.

- [ ] **Step 2: If any fix was needed, commit it**

Only if Step 1 required a code change:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: correct the tonal-import allowlist to match src/ (DEV-395)

bun run verify caught a mismatch between eslint.config.js's carve-out
list and the actual current tonal importers.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

If Step 1 passed cleanly with no fix needed, there is nothing to commit — the plan is complete as of Task 3's commit.

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** Task 1 covers the three diagrams/matrices, canonical terms and per-layer responsibilities AC. Task 2 covers the ESLint restriction + positive/negative fixture test AC. Task 3 covers the CLAUDE.md durable-rule AC. Task 4 covers the `bun run verify` DoD line. The DoD line "Architecture documentation names DEV-391 and DEV-380 as context" is satisfied by the contract document's own "Context" paragraph (Task 1, Step 2). The analyser-exception compatibility AC is satisfied by the contract document's dedicated "Confirming the analyser exceptions remain compatible" section and by this plan's Global Constraints explicitly forbidding editing that block.
- **Independently shippable seam:** this plan is the whole of DEV-395 and requires no directory-wide move — every edit in Task 2 is additive/wired-in, and no existing file changes location.
- **What this plan deliberately does NOT do:** it does not create `Music Core`, a Tonal adapter directory, a planner directory, or a controller directory — those remain DEV-394/397 work, named only in the contract document's prose. It does not retrofit ESLint-API tests for the pre-existing layering rules 1–3 (`src/audio/` → `store/`/`components/`, `src/store/` → `components/`, `src/components/` → `audio/engine`) beyond the two regression fixtures Task 2 adds for the specific files its own carve-outs touch (`arpeggiator.ts`, `midiInput.ts`) — those three older rules have run clean under `bun run eslint` since they landed and closing that pre-existing test gap for the other files they cover is a separate, non-blocking cleanup, not part of this issue's AC.
</content>
```
