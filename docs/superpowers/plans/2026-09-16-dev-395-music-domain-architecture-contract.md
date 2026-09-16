# Music-Domain Architecture Contract

**Context:** This document is the deliverable of [DEV-395](https://linear.app/pathompong-thitithan/issue/DEV-395), the first child of epic [DEV-391](https://linear.app/pathompong-thitithan/issue/DEV-391/epic-music-domain-architecture-tonal-boundary-derived-state-and) (music-domain architecture). It must not regress [DEV-380](https://linear.app/pathompong-thitithan/issue/DEV-380/music-theory-rework-derive-chord-qualities-and-enharmonic-spelling)'s contract: canonical-sharp identity is what every generated/computed/persisted note name uses, and key-aware display spelling (`src/utils/noteSpelling.ts`) is applied only where a value is rendered, never where it is stored, compared or used as a lookup key.

This document separates three concerns the repo's existing `data → audio → store → components` layering rule (CLAUDE.md, enforced in `eslint.config.js`) currently conflates: **compile-time dependency direction**, **runtime command/event flow**, and **persisted-vs-derived data ownership**. It also names two music-domain concepts this contract governs — Music Core / the Tonal adapter (`src/musicCore/`, DEV-394, now implemented) and playback planners / playback controllers (DEV-397, still concepts, not yet code) — and states their contract, so later children build to a spec instead of inventing one mid-implementation.

**This issue changes boundaries and guards only.** No audible, persisted or user-visible behaviour changes. Music Core and the Tonal adapter were **not created by this issue (DEV-395)** — they were documented here first and then implemented by DEV-394 (see "Gated and moved" below). Playback planners and playback controllers remain concepts, not code, so that DEV-397/399 can build them inside a contract that already exists.

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
Music Core (src/musicCore/)             <- DEV-394, implemented
  +-- Tonal adapter (src/musicCore/tonalAdapter.ts —
  |     the ONLY file in production code allowed to
  |     `import ... from 'tonal'`)
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

**Gated and moved (DEV-394).** Music Core and its Tonal adapter now exist as real modules:
`src/musicCore/index.ts` is the public API, `src/musicCore/tonalAdapter.ts` is the one production
file in the whole app permitted to `import ... from 'tonal'`, and `src/musicCore/chordQuality.ts`
owns the chord-quality registry (app token, Tonal alias, display suffix, picker label/group,
reharmonization category) that `ChordItem['quality']`'s type, the chord picker's options,
`formatChordQuality`/`formatChordLabel` and chord-note resolution all derive from. The six files
DEV-395 allowlisted directly (`src/utils/noteSpelling.ts`, `src/utils/musicTheory.ts`,
`src/audio/arpeggiator.ts`, `src/audio/bassPatterns.ts`, `src/audio/playback/padPlayback.ts`,
`src/store/midiInput.ts`) no longer import `tonal` at all — each calls `@/musicCore` instead, and
each keeps its own pre-existing public exports unchanged. The enforcement mechanism (an ESLint
`no-restricted-imports` rule with a `paths` ban plus a carve-out) is unchanged; only the carve-out
target moved, from the six files to `src/musicCore/tonalAdapter.ts` alone.

The gate covers non-test files under `src/` only — the config's final block exempts
`**/*.test.{ts,tsx}` from every import ban, which is how `scales.test.ts`, `src/musicCore/tonalAdapter.test.ts`
and `noteSpelling.test.ts` deliberately pin behavior against tonal, and `scripts/` sits outside
the gate's `src/**` scope entirely.

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
- **Music Core (`src/musicCore/`, DEV-394)** — the one public API (`src/musicCore/index.ts`) every other music-domain reader calls for pitch/interval operations and chord-quality resolution. `resolveChordNotes` throws on a genuinely unregistered chord quality rather than silently falling back to a default (DEV-392 will extend this "no silent fallback" stance to pitch parsing more broadly). ESLint-enforced (`eslint.config.js`'s `src/musicCore/**` block) to import nothing from `src/store/`, `src/components/`, `src/audio/`, or `src/utils/` — the dependency runs audio → Music Core and utils → Music Core, never the reverse (`src/utils/noteSpelling.ts` and `src/utils/musicTheory.ts` already import `@/musicCore`, so the utils/ ban closes a real cycle risk rather than a hypothetical one — this matters directly to DEV-392, the next child issue, which centralizes pitch/note-parsing/scale-lookup work inside Music Core).
- **Tonal adapter (`src/musicCore/tonalAdapter.ts`, DEV-394)** — the only file in the whole app permitted to `import ... from 'tonal'`. Confined behind Music Core's public barrel; nothing outside this one file names a Tonal type or function, and nothing outside `src/musicCore/` imports this file directly (see "Gated and moved" above).
- **Application/store (`src/store/`)** — one Zustand store composed of slices; owns musical intent and non-playback-tick runtime state (`soloTracks`, `recordingTrack`, etc.). Never imports `components/` (existing layering rule 2, unchanged). Calls Music Core for anything Tonal-shaped; never calls a playback planner directly from a component-facing action (a planner is invoked by a controller, not by a store action).
- **Playback planners (future, DEV-397)** — pure functions. Input: an immutable snapshot of musical intent (never the live Zustand singleton, never `useAppStore.getState()`). Output: playable events. Must not read the store, the audio engine, `AudioContext`, or the wall clock (`Date.now()`, `performance.now()`), and must not apply display spelling (a planner's output is for the engine, not for a person to read).
- **Playback controllers (future, DEV-397)** — own the store subscription, the shared 16th-clock lifecycle (`subscribeClock`/`stopClockTimer` — "the clock runs iff a player holds a subscription", CLAUDE.md), and the hand-off of a planner's playable events into `src/audio/`'s engine calls. This is where side effects, `AudioContext` time, and the live store singleton are allowed to meet the planner's pure output.
- **Audio engine/DSP (`src/audio/`)** — raw Web Audio API DSP plus the `audioEngine` singleton. Never imports `store/` or `components/` (existing layering rule 1, unchanged). May import `data/`. Once DEV-399 lands, takes only opaque voice identity and already-resolved pitch/timing — no Tonal, scale, chord, spelling or reharmonization import. Today, several files under `src/audio/` (`arpeggiator.ts`, `bassPatterns.ts`, `playback/padPlayback.ts`, and others via `musicTheory.ts`) still resolve pitch/chord logic inline rather than receiving pre-resolved playable events; none of them import `tonal` directly any more (DEV-394 routed them through `@/musicCore` instead), but that inline resolution is the pre-DEV-399 state this issue documents and partially gates, not a defect this issue fixes.
- **UI (`src/components/`)** — dumb views. Must not import `audio/engine` (existing layering rule 3; the read-only analyser exceptions below are unchanged). Reads musical intent, derived representations and runtime state from the store via selectors; applies no music-domain logic of its own; never imports `tonal` and never will, at any point in the epic.

## Confirming the analyser exceptions remain compatible

The five files exempted from layering rule 3 (`src/components/AudioVisualizer.tsx`, `src/components/ui/VuMeter.tsx`, `src/components/ui/AmbientBackdrop.tsx`, `src/components/ui/GainReductionMeter.tsx`, `src/components/ui/SourceMeter.tsx`) read a Web Audio analyser node once per animation frame through the shared meter scheduler (`src/utils/meterScheduler.ts`) and never write to a store slice. None of them import `tonal`, none of them are a playback planner or controller, and nothing in this document's contract changes what they do or how they are exempted — they remain read-only analyser consumers, gated by the same `eslint.config.js` block (the file's final block, `no-restricted-imports: 'off'` for those five paths plus test files) that exempts them today. This issue does not touch that block.
