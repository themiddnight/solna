# DEV-391 Music-Domain Architecture — Epic Implementation Plan

> **For agentic workers:** This document is an **epic-level roadmap**, not a single executable bite-sized plan. Per the writing-plans skill's Scope Check, DEV-391 already decomposes into 8 independently-shippable subsystems (the epic + 7 children below), each with its own `bun run verify` gate. Use this document to pick the next child in sequence, then run **superpowers:writing-plans** again scoped to that one child to produce its actual bite-sized TDD task list before touching code. Do not attempt to execute this document directly with subagent-driven-development.

**Goal:** Give Solna one authoritative music-domain architecture — musical intent has a single source of truth, Tonal.js is confined behind a Music Core boundary, playback flows from intent → pure plans → runtime controllers, and the Web Audio engine knows nothing about keys, scales or chords.

**Architecture (target end state):** `authored catalogs (src/data/) → Music Core + Tonal adapter → store/application (persisted intent) → pure playback planners (snapshot in, playable events out) → runtime controllers (clock, scheduling, store subscription) → audio engine (opaque voice identity + resolved pitch/timing only)`. UI never calls the engine directly; the engine never imports Tonal, scale/chord catalogs, spelling or reharmonization code.

**Tech Stack:** Bun, Vite, React, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API (no Tone.js), `tonal` (theory only, to be confined to an adapter), `bun test`, ESLint `no-restricted-imports`/`no-restricted-syntax`/`no-restricted-globals` for layering.

**Spec:**
- Epic: [DEV-391](https://linear.app/pathompong-thitithan/issue/DEV-391/epic-music-domain-architecture-tonal-boundary-derived-state-and)
- Foundation (done): [DEV-380](https://linear.app/pathompong-thitithan/issue/DEV-380/music-theory-rework-derive-chord-qualities-and-enharmonic-spelling) — derived chord qualities, canonical-sharp identity vs. key-aware display spelling. **This contract must not regress in any child below.**

## Global Constraints

- `bun run verify` (eslint zero-warning baseline, both Knip scans, all tests, production build) must pass at the end of **every** child issue — not just at epic close.
- **No migration chains**: any persisted-shape change (chord data, project format) is handled by validating at the read boundary (`sanitizePersistedState`, `sanitizeContent`) and defaulting on the spot — never a version-gated `if (version < N)` chain. See CLAUDE.md "no migration chains" note.
- **Canonical sharp vs. display spelling stays split** (DEV-380): everything generated/computed/persisted stays ROOTS-spelled; `src/utils/noteSpelling.ts` spells for display only. No child may collapse this back into one representation.
- Layering: `src/data/` imports nothing at runtime; `src/audio/` never imports `store/`/`components/`; `src/store/` never imports `components/`; `src/components/` must not import `audio/engine` (existing analyser exceptions unchanged). This epic adds a new axis (Tonal-import confinement) on top of this, it does not replace it.
- Always-mounted views: no per-frame store writes, no high-frequency playback state in a slice. Any runtime-controller work (DEV-397) must keep obeying this.
- Branch naming: `<type>/<issue-code>-<slug>`, one branch per child issue per the repo's Git conventions.

---

## Sequencing

Recommended order, derived from what each child's own acceptance criteria actually depends on (not just Linear's numeric order):

| # | Issue | Why it goes here |
|---|-------|-------------------|
| 1 | **DEV-395** — contract & dependency gates | Defines the diagrams, terms and ESLint/architecture-test guards every later child must satisfy. Explicitly "changes boundaries and guards, not musical behaviour" — zero risk, must land first. |
| 2 | **DEV-394** — Music Core + Tonal adapter + quality registry | Everything else "uses Music Core's public API, never Tonal directly" per the epic's dependency-direction rule. The chord-quality registry it introduces is a direct input to DEV-393 and DEV-392. |
| 3 | **DEV-392** — centralize pitch/note parsing/scale lookup | Consumes the Music Core API from DEV-394; without it there is no canonical API to point lead-recording/melody-grid/bass/keyboard call sites at. |
| 4 | **DEV-393** — fix reharmonization classification | Needs DEV-394's quality registry to "state or derive each quality's reharmonization behaviour" — can't be done against an ad-hoc quality list. |
| 5 | **DEV-396** — chord notes strictly derived + persistence normalization | Needs correct, registry-backed derivation (DEV-394) and correct reharmonization (DEV-393) before it can make "notes" a pure derived value everywhere without also re-litigating what a snapped chord's quality should be. |
| 6 | **DEV-397** — pure playback planners | Needs DEV-396's guarantee that chord notes never disagree with root/quality — a planner that reads `chord.notes` today would otherwise plan against untrustworthy data. |
| 7 | **DEV-399** — narrow the engine contract | Explicitly "follows the pure planner/controller seam" from DEV-397 in its own description — cannot be attempted before planners exist to feed it resolved events. |
| 8 | **DEV-398** — notation surfaces + Roman validation | Depends only on DEV-394 (Music Core existing). It touches disjoint UI files (`SortableLoopCard.tsx`, `musicTheory.ts`'s Roman helper, `chordProgressions.ts` data/tests) with no shared state with 396/397/399, so **it can run as a parallel track** once DEV-394 lands, if you want to split work across two lanes. |

If run strictly serially: **395 → 394 → 392 → 393 → 396 → 397 → 399 → 398**. If splitting into two lanes after 394: Lane A = 392 → 393 → 396 → 397 → 399, Lane B = 398 (parallel).

---

## Per-child detail

### 1. DEV-395 — Define the music-domain architecture contract and dependency gates

**Goal:** Make the dependency direction, runtime flow and data ownership explicit and mechanically enforced, before any implementation code moves.

**Current state:** The repo already has one layering axis documented and enforced in `eslint.config.js`/CLAUDE.md: `data → audio → store → components`, via `no-restricted-imports`, `no-restricted-globals`, `no-restricted-syntax`. It says nothing about who may import `tonal`, whether a planner may read the Zustand singleton, or which musical values are authoritative — that's the gap this issue closes.

**Gap vs. target:** No formal separation yet between (a) compile-time import rules, (b) runtime command/event flow, (c) persisted-vs-derived data ownership. No ESLint rule confining `tonal` imports to an adapter (survey found 6 direct production `tonal` imports today: `noteSpelling.ts:1`, `musicTheory.ts:3`, `arpeggiator.ts:1`, `bassPatterns.ts:1`, `padPlayback.ts:1`, `midiInput.ts:1` — these are exactly the imports DEV-394 must consolidate, but the *rule* forbidding new ones outside the adapter is this issue's job).

**A detailed plan for this child needs to cover:**
- Three diagrams/matrices: compile-time dependency graph, runtime command→event flow, persisted-vs-derived ownership table.
- Named responsibilities for: authored catalogs, Music Core, Tonal adapter, application/store, playback planners, playback controllers, audio engine/DSP, UI.
- An ESLint restriction (or `dependencyLayers`-style test, matching the existing `src/data/dataLayerPurity.test.ts` pattern) that fails on a new `tonal` import outside the future adapter path — written now even though the adapter file doesn't exist yet, so DEV-394 has a red test to turn green.
- CLAUDE.md updates recording the new rule as *durable rule text*, not file counts (per the repo's own "don't record version numbers" convention).
- Confirmation that existing analyser exceptions (`AudioVisualizer.tsx`, `VuMeter.tsx`, etc.) remain compatible and are called out explicitly as pre-existing, intentional exceptions.

---

### 2. DEV-394 — Introduce Music Core and a single Tonal adapter

**Goal:** One public Music Core API; one Tonal import boundary; one canonical chord-quality registry (app token ↔ Tonal alias ↔ display suffix ↔ picker label/group ↔ reharmonization policy).

**Current state (survey):**
- 6 production `tonal` imports to consolidate: `src/utils/noteSpelling.ts:1`, `src/utils/musicTheory.ts:3`, `src/audio/arpeggiator.ts:1`, `src/audio/bassPatterns.ts:1`, `src/audio/playback/padPlayback.ts:1`, `src/store/midiInput.ts:1`.
- Quality vocabulary is already split three ways: `TONAL_CHORD_ALIASES` (`musicTheory.ts:512–516`, e.g. `{ min9: 'm9', min6: 'm6', minmaj7: 'mMaj7' }`), display-suffix labels (`musicTheory.ts:520–541`, includes `minmaj7: 'mM7'`, `maj7#5: 'maj7#5'`), and the chord-picker's own option groups (`SortableChordCard.tsx:58–95`).
- **Confirmed drift** (proves the registry is needed): `SortableChordCard.tsx:58–95`'s `QUALITY_GROUPS` is **missing `minmaj7` and `maj7#5`**, even though `resolveDegreeQuality`/the degree resolver can emit both. A progression whose degree naturally resolves to one of these plays correctly but cannot be edited in the picker.
- `ChordItem['quality']` (`src/types.ts:137–143`) is currently just `string` — there is no dedicated union type yet to derive from a registry.

**A detailed plan for this child needs to cover:**
- Design the registry shape (one entry per quality: app token, Tonal alias if different, display suffix, picker label/group, reharmonization-policy tag for DEV-393).
- Derive the `ChordQuality` TypeScript type, `TONAL_CHORD_ALIASES`, the display-label map, and `SortableChordCard.tsx`'s `QUALITY_GROUPS` all from one source, closing the `minmaj7`/`maj7#5` gap as a side effect.
- Define the Music Core public API surface (what it exposes vs. what stays adapter-private) and move the 6 listed `tonal` imports behind it one by one.
- Add the "every registered quality resolves through `Chord.getChord`; unknown fails explicitly" boundary check — today `generateBlockChordNotes` (`musicTheory.ts:577,580`) silently falls back to root `'C'` / quality `'maj'` on failure, which this issue's AC forbids for in-registry values.
- Keep DEV-380's canonical-sharp/display-spelling split untouched — this issue moves *where* Tonal is called, not *what* it returns.

---

### 3. DEV-392 — Centralize canonical pitch, note parsing, scale lookup, and failure policy

**Goal:** One canonical Music Core API for parsing, comparing, transposing and formatting pitch; no more local regex/semitone reimplementations; no silent fallback to C/Major/A440 on genuinely invalid input.

**Current state (survey) — duplicated parsing logic:**

| Location | What it does |
|---|---|
| `src/components/loop/lead/melodyGrid.ts:61` | `/^([A-G]#?)(-?\d+)$/.exec(note)` to sort/highlight lead-grid rows |
| `src/utils/musicTheory.ts:388` | `/^([A-Ga-g][#b]?)(-?\d+)?$/` inside the transpose helper |
| `src/components/ui/Keyboard.tsx:72` | `ROOTS[pitch % 12]` + manual octave arithmetic for scale-locked/chromatic key construction |
| `src/audio/bassPatterns.ts:28,32` | `noteName.replace(/[0-9-]/g, '')` to strip octave; `Note.midi()` with fallback chain |

**Current state — scale fallback duplication:** `src/audio/bassPatterns.ts:103` hardcodes the Major interval array `[0, 2, 4, 5, 7, 9, 11]` as a fallback when `SCALES[scaleType]` is undefined — a second, uncoordinated copy of what `src/data/scales.ts` already states.

**Current state — silent invalid-input fallbacks to fix:**
- `musicTheory.ts:497` `noteFrequency`: `if (midi == null) return 440;`
- `musicTheory.ts:577,580,583` `generateBlockChordNotes`: falls back to root `'C'`, quality `'maj'`, and `Note.midi(...) ?? Note.midi('C'+octave) ?? 60`.
- `bassPatterns.ts:33`: same triple-fallback pattern (`Note.midi(...) ?? Note.midi('C'+octave) ?? 60`).

**A detailed plan for this child needs to cover:**
- Music Core functions for: parse, pitch-class extract, octave extract, MIDI convert, canonical-sharp convert, compare, octave-transpose — built once DEV-394's adapter exists.
- Migrate the four call sites above (lead grid, transpose helper, keyboard, bass) to the new API; delete the local regexes.
- Replace `bassPatterns.ts:103`'s hardcoded Major array with a call through the single scale resolver (which must itself live behind Music Core, not duplicate `src/data/scales.ts`).
- Decide and implement the "valid-domain functions never silently default" policy: an out-of-range but *well-formed* input should throw or return a typed failure, while only the *import/project sanitize boundary* (`sanitize.ts`, `projectFile.ts`) may repair legacy garbage into a recorded default. This directly conflicts with today's `noteFrequency`/`generateBlockChordNotes` behavior, so those call sites need explicit review of what currently relies on the silent 440 Hz / C / maj fallback.
- A source guard or lint rule (building on DEV-395's gate) that fails if a new local note-regex pattern is reintroduced.
- Regression coverage: enharmonics, negative octaves, octave-boundary spellings, malformed input — per the issue's own DoD.

---

### 4. DEV-393 — Correct reharmonization and chord-classification semantics

**Goal:** `snapProgressionToScale` classifies/preserves chord qualities via explicit policy (ideally the DEV-394 registry), not token substrings.

**Current state (survey) — the exact defect, `src/utils/musicTheory.ts:405–439`:**
```ts
// line 424 — dispatch by substring
const diatonic = getDiatonicChordForDegree(
  bestDegree, root, scaleType,
  chord.quality.includes('7') || chord.quality.includes('9')
);
// line 428–430 — only these four survive the seventh branch
if (chord.quality === 'maj9' || chord.quality === 'min9' || chord.quality === '7sus4' || chord.quality === 'sus4') {
  targetQuality = chord.quality;
}
// line 437 — notes always re-derived from targetQuality, overwriting whatever was stored
notes: generateBlockChordNotes(targetQuality, diatonic.root, octave)
```
The epic's own issue text gives the worked example: **`add9` enters the seventh branch (it contains the digit `9`) but is not in the four-item preservation list, so it silently becomes a diatonic seventh** instead of staying `add9`. *(One codebase-survey pass characterized `add9` as skipping the seventh branch entirely — that reading contradicts both the issue's own text and a literal reading of `'add9'.includes('9')`. Treat the issue's own example as authoritative and re-confirm against the live source line before writing tests, since this is exactly the kind of substring trap the issue is about.)* `minMaj7` and `maj7#5` both contain `'7'`, enter the branch, and are likewise not preserved — same silent downgrade.

**A detailed plan for this child needs to cover:**
- Replace the `includes('7')`/`includes('9')` dispatch with lookups against DEV-394's quality registry (each quality states its own reharmonization behavior: triad / seventh / sixth / added-tone / extension / suspended / diminished-half-diminished / altered).
- Explicit regression fixtures for every quality named in the AC: `add9`, `maj9`, `min9`, `7sus4`, `sus4`, `minMaj7`, `maj7#5`.
- Document the nearest-degree root-snapping tie policy (unchanged behavior, but currently undocumented).
- Re-run/diff existing factory progressions through the corrected function and review every fixture whose output changes — the issue explicitly requires each change to be "reviewed," not silently accepted as a snapshot update.
- Preserve canonical-sharp identity throughout; this issue changes *quality classification*, not spelling.

---

### 5. DEV-396 — Make chord notes derived and normalize every persistence boundary

**Goal:** `ChordItem.notes` can never disagree with root/quality across live playback, bass resolution, preview, UI and offline render.

**Current state (survey):**
- Type: `src/types.ts:137–143` — `ChordItem { id, root, quality, bars, notes: string[], bassNote?: string | null }`. `notes` is a fully independent, arbitrary `string[]`.
- **Derivation exists** in `musicTheory.ts:443–445` (`deriveChordNotes`) and `musicTheory.ts:577–591` (`generateBlockChordNotes`, used by `snapProgressionToScale` at `musicTheory.ts:437` and by `resolveProgression` in `src/audio/chordProgressions.ts:38`).
- **But several consumers read the stored array directly instead of deriving:** `src/audio/playback/chordPlayback.ts:326` (`playChordLegato` iterates `chord.notes`), `src/audio/bassPatterns.ts:94` (`resolveBassSteps` indexes `chord.notes[TONE_INDEX[t]]`), `src/audio/export/renderMixdown.ts:464,498` (passes `loop.chords` straight into `resolveBassSteps` with no re-derivation), and `SortableChordCard.tsx` (renders `chord.notes.map()`).
- **Hand-authored notes that get immediately discarded:** `src/store/initialState.ts`'s `INITIAL_CHORDS` literally writes out `notes: ['A3','C4','E4','G4']` etc. for each default chord, and both `src/store/chordsSlice.ts:31` and `src/store/loopSlice.ts:41` immediately re-derive via `INITIAL_CHORDS.map(chord => deriveChordNotes(chord, 4))` — the authored arrays are dead on arrival, exactly as the issue describes.
- **Sanitizer accepts anything:** `src/store/sanitize.ts:379–390`'s `isChordItem()` validates `notes` with `isStringArray(value.notes)` only — any string array of any length/content passes. `sanitizeLoops()` (`sanitize.ts:559`) and `projectFile.ts`'s `sanitizeContent()` (`projectFile.ts:60–71`) both rely on this validator with no re-derivation step. `store.ts:192–233`'s `sanitizePersistedState()` explicitly defers chord content validation to `sanitizeContent()` — so a project loaded via the persist path is not guaranteed consistent notes either.

**A detailed plan for this child needs to cover:**
- Decide the authoritative persisted shape: does `ChordItem` keep a `notes` field at all (re-derived on every read/ingress) or does persistence drop it entirely and every consumer calls Music Core's derivation with root+quality+octave? The issue's AC ("explicitly separated... persisted chord shape... from any resolved chord-note representation") suggests the latter — this is the single biggest design decision in the epic and should be resolved before writing tests.
- If `notes` is dropped from the persisted shape: update `types.ts`, `initialState.ts` (delete the now-pointless hand-authored arrays), `chordsSlice.ts`/`loopSlice.ts` (delete the redundant re-derive-after-init step), `isChordItem()` in `sanitize.ts` (stop validating `notes`), and every direct reader (`chordPlayback.ts:326`, `bassPatterns.ts:94`, `renderMixdown.ts:464,498`, `SortableChordCard.tsx`) to call the shared derivation instead.
- Per the repo's "no migration chains" policy: this is a persisted-shape change, so it must land as a **validate-at-ingress** change (old bodies with a stray `notes` array are read and the field is ignored/stripped), never a version-gated migration step.
- Tests that install deliberately contradictory `notes` (e.g. wrong length for the quality) through every ingress path (project file import, persisted `localStorage`, custom-preset import) and assert every consumer resolves to the same, correctly-derived pitches regardless.
- Live/offline equivalence test: chord and bass output from `useChordPlayback.ts` vs. `renderMixdown.ts` must match once both go through the same derivation call.
- CLAUDE.md documentation of the final chord-notes ownership rule (per this issue's own DoD).

---

### 6. DEV-397 — Separate pure playback planning from runtime controllers

**Goal:** Chord/bass/pad/melody playback expressed as deterministic plans from immutable snapshots; runtime controllers own clocks/side effects/store subscription.

**Current state (survey) — today's bridges already mix concerns in one function:**

| Track | Bridge | Store read | Musical resolution | Engine call |
|---|---|---|---|---|
| Chord + Bass | `src/components/loop/chord/useChordPlayback.ts:70–300` | `useAppStore.getState()` live | `resolvePlaybackRhythmCycle` (:235), `buildChordEvents` (:260), `resolveBassSteps` (:259) | `playbackNoteOn` (:267, :299) |
| Pad (drone) | called from `useChordPlayback.ts:180–195` | via chord hook | `resolveDroneNotes` + `applyPadVoicing` (`padPlayback.ts:33–76`) | `playFullHoldChord` / `playbackNoteOn` |
| Melody (Lead + FX) | `src/components/loop/lead/useLeadPlayback.ts:50–180` | `useAppStore()` live | `leadScheduleHits`, `leadSoundingNotes`, `resolveLeadStepTriggers` (`src/audio/leadMelody.ts`) | `playbackNoteOn` / `playbackNoteOff` |
| Drums | `src/components/useSequencerPlayback.ts:70–142` | `useAppStore.getState()` live | none (pure rhythm) | `fireBeatStepEvents` → `triggerPad` (:61) |

**Encouraging finding — live/offline already share resolution functions, just not through a clean seam:** `useLeadPlayback.ts` and `renderMixdown.ts:850–900` call the *same* `leadScheduleHits`/`leadSoundingNotes`/`resolveLeadStepTriggers`. `useChordPlayback.ts` and `renderMixdown.ts:420–562` call the *same* `resolvePlaybackRhythmCycle`/`buildChordEvents`/`eventsForCycleStep`/`resolveBassSteps`. Drums share `beatStepEvents` (`src/audio/beatSteps.ts:36–54`) too. This means the "pure function" halves largely already exist — the work is extracting them from the store-reading/engine-calling bridge functions they're currently interleaved with, not inventing new resolution logic from scratch.

**A detailed plan for this child needs to cover:**
- Define the "playback snapshot" type (durable intent only, no Zustand singleton reference) that a planner takes as input.
- For each of the four lanes, split the existing bridge (`useChordPlayback.ts`, `useLeadPlayback.ts`, `useSequencerPlayback.ts`, the pad path) into: a pure planner (already mostly identified above) + a thin controller that does the store subscription/clock/`playbackNoteOn` calls.
- This can land **lane-by-lane** per the issue's own AC ("migration can land lane-by-lane") — drums is the simplest (already has no musical resolution) and is a good first slice to prove the seam; chord+bass is the most entangled (pad depends on it) and should probably go last within this child.
- Preserve the always-mounted-views rule: no planner output or controller state may leak into a slice at playback-tick frequency.
- Live/offline equivalence tests per lane, covering representative meters, loop lengths, chord boundaries and approach tones (per this issue's DoD).

---

### 7. DEV-399 — Narrow the audio-engine contract to resolved playable events

**Goal:** The engine takes only opaque voice identity + resolved pitch/timing; it imports no Tonal/scale/chord/spelling/reharmonization module.

**Current state (survey) — the engine's note-on contract still takes a note *name*, not a resolved frequency:**
```ts
// src/audio/engine.ts:187–211
triggerSynthNoteOn(
  noteName: string,   // ← still a string, not a resolved frequency
  synth: ActiveSynth,
  velocity = DEFAULT_VELOCITY,
  time: number | undefined,
  source: string,
  scaleFactor: number,
  owner: VoiceOwner,
): VoiceId | null
```
Frequency conversion happens *inside* the engine, at `src/audio/synth/subtractiveVoice.ts:1118` (`const baseFrequency = noteFrequency(event.noteName)`), importing `noteFrequency` from `src/utils/musicTheory.ts`.

**Current state — 7 files under `src/audio/` import Tonal or music-domain modules today, all of which this issue must clear:**

| File | Import |
|---|---|
| `src/audio/arpeggiator.ts:1` | `import { Note, transpose } from 'tonal'` |
| `src/audio/bassPatterns.ts:1–2` | `import { Note } from 'tonal'`; `SCALES` from `src/data/scales.ts` |
| `src/audio/chordProgressions.ts:1` | `deriveChordNotes`, `getDiatonicChordForDegree` from `musicTheory` |
| `src/audio/playback/chordPlayback.ts:8–13` | `deriveChordNotes`, `getDiatonicChordForDegree`, `shiftNoteOctave`, … from `musicTheory` |
| `src/audio/playback/padPlayback.ts:1–2` | `transpose` from `'tonal'`; `getDiatonicChordForDegree` |
| `src/audio/synth/subtractiveVoice.ts:1093` | `noteFrequency` from `musicTheory` |
| `src/audio/leadMelody.ts:1` | `remapNoteByScaleDegree`, `rootSemitone`, `transposeNoteBySemitones` |

By contrast, `src/audio/beatSteps.ts:36–54` is already clean — pure rhythm, reads only `BEAT_VOICE_IDS`/pattern rows/mute state, no music-domain import at all. It's the model to match.

**A detailed plan for this child needs to cover:**
- New note-on contract: opaque voice/note identity for ownership+release, separate from a pre-resolved frequency (and any other DSP-needed numbers) — computed once by DEV-397's planners/controllers, not inside `subtractiveVoice.ts`.
- Move frequency conversion (`noteFrequency`) to the boundary *before* the engine, so `subtractiveVoice.ts` stops importing `musicTheory`.
- `arpeggiator.ts`, `bassPatterns.ts`, `chordProgressions.ts`, `chordPlayback.ts`, `padPlayback.ts`, `leadMelody.ts` are all candidates to either move out of `src/audio/` into the planner layer from DEV-397, or to have their music-domain pieces extracted so only DSP-facing code remains under `src/audio/`. This issue and DEV-397 are tightly coupled — expect this child's real work to be "finish what 397 started" for the files 397 didn't already fully hollow out.
- A dependency guard (extending DEV-395's ESLint gate) that fails if `src/audio/` gains a new Tonal/scale/chord/spelling import.
- Regression coverage: voice ownership, polyphony, note-off identity, glide, scheduled-tail behavior unchanged; live and offline audio tests pass with no fixture pitch changes (per this issue's DoD) — this is a pure refactor of *where* resolution happens, not a sound change.

---

### 8. DEV-398 — Route every notation surface through Music Core and validate authored notation

**Goal:** Every contextual chord/note/key label uses the same key-aware display API; factory Roman summaries are mechanically checked against the progressions they describe.

**Current state (survey) — spelling compliance per surface:**

| Surface | File:line | Compliant? |
|---|---|---|
| Song loop card (Arrange) | `SortableLoopCard.tsx:342` | **No** — `` `${chord.root}${formatChordQuality(chord.quality)}` `` renders raw canonical-sharp root directly. (Line 696 in the same file *does* use `getTonicSpelling()`, but only for the key label, not the chord.) |
| Playback indicator | `PlayheadReadout.tsx:40–41` | Yes — `formatChordLabel(now.root, now.quality, spellingKey)` |
| Chord editor/picker | `SortableChordCard.tsx:209,215` | Yes — `spellChordRoot(...)` / `spellNoteInKey(...)` |
| Progression picker | `ProgressionCard.tsx:143,149` | Yes — `formatChordLabel(...)` |
| Preset library | `ChordPresetLibrary.tsx:210,279` | Partial — line 210 passes key context; line 279's `formatChordLabel` call is missing `scaleRoot`, so it likely falls back to canonical spelling in that one code path. |
| Keyboard chord labels | `Keyboard.tsx:342` | Yes — `formatChordLabel(chordRoot, quality, { scaleRoot, scaleType })` |

This confirms the issue's own claim precisely: the Song loop card is the one surface out of compliance, plus one partial gap in the preset library.

**Current state — Roman numerals:**
- The only hardcoded Roman-numeral array in the codebase is `musicTheory.ts:294`: `const ROMAN_NUMERALS = ['I','II','III','IV','V','VI','VII','VIII'];`, used inline inside (an unnamed helper near) `getDiatonicChordForDegree` (~line 275). No standalone `romanFromDegree(...)`-style export exists — building one is new work, not a refactor of something that already exists elsewhere.
- Factory `roman` summaries live on the progression interface at `src/data/chordProgressions.ts:48` (`roman: string`), authored by hand per entry (e.g. `'I – V – vi – IV'`, `'IVmaj7 – V7 – iiim7 – vim7'`). The only current check is `src/audio/chordProgressions.test.ts:15`: `expect(p.roman.length).toBeGreaterThan(0)` — presence only, no correctness check against the actual steps/qualities.

**A detailed plan for this child needs to cover:**
- Fix `SortableLoopCard.tsx:342` to call the same `formatChordLabel`/spelling helper the other five surfaces already use; fix `ChordPresetLibrary.tsx:279`'s missing `scaleRoot`.
- Add a surface-matrix test (flat/sharp/modal/pentatonic/Harmonic-Minor keys) asserting all six surfaces above agree on spelling for the same chord+key — this is the regression guard once the Song loop card is fixed.
- Design and implement a Music-Core/Tonal-backed Roman-numeral operation to replace the local `ROMAN_NUMERALS` array at `musicTheory.ts:294`, respecting the project's **contextual** Roman convention (not a blind major-scale-relative Tonal rendering, since modal/pentatonic scales differ semantically).
- Build the validator that checks every factory `roman` string in `chordProgressions.ts` against its steps' actual degree + explicit/derived quality + `referenceScale`, replacing the length-only check in `chordProgressions.test.ts:15`. Every existing factory progression must pass this new validator — expect to find and fix any pre-existing authored/actual mismatches as part of this work.
- Explicitly do *not* rewrite user-authored free-form names/annotations as if they were derived notation (per this issue's own AC) — the validator applies to the structured `roman` field only.
- This child can proceed in parallel with 396/397/399 once DEV-394 exists, since none of its files overlap with the chord-derivation/playback/engine work.

---

## Cross-cutting risks

- **DEV-380 regression risk:** every child touches code adjacent to chord quality or spelling. Re-run DEV-380's characterization tests after each child, not just at epic close — canonical-sharp identity and key-aware display spelling are easy to accidentally re-merge (e.g. while "simplifying" `ChordItem` in DEV-396).
- **No-migration-chains discipline:** DEV-396 is the child most likely to tempt a version-gated migration (it changes what `notes` means). Resolve it as ingress-time validation/defaulting only.
- **Live/offline equivalence:** DEV-397 and DEV-399 both explicitly require live playback and `renderMixdown.ts` to stay behaviorally identical. Since the survey found they *already* share resolution functions in several lanes, the main risk is accidentally forking that shared logic while extracting planners — write the equivalence test *before* splitting each lane, not after.
- **Always-mounted-views constraint:** any new playback-controller state introduced in DEV-397 must stay local to the subtree, never promoted into a slice, per the project's high-frequency-state rule.
- **Verify gate per child:** `bun run verify` (eslint zero-warning baseline + both Knip scans + full test suite + production build) must pass at the end of each of the 8 children — treat a child as unshippable, not "mostly done," if it doesn't.
- **Ordering dependency risk:** DEV-393 and DEV-396 both depend on DEV-394's chord-quality registry design. If DEV-394's registry shape is designed too narrowly (e.g., no place to encode reharmonization policy), DEV-393 will need to extend it — budget for that possibility rather than treating DEV-394 as fully frozen once merged.

---

## Recommendation

Start with **DEV-395**. It has no dependencies, is explicitly behavior-preserving ("no audible, persisted or user-visible behaviour changes"), and produces the ESLint/architecture-test gates every later child needs to prove it hasn't violated the boundary it's supposed to be building.

Once you confirm you want to proceed with DEV-395, the next step is to invoke **superpowers:writing-plans** again, scoped only to DEV-395, to produce its actual bite-sized TDD task list (file-by-file steps, failing tests first, etc.) — not the whole epic. Say the word and that plan gets written next.
