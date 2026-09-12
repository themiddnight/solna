# Export Mixdown — Design

> Give Solna an **Export** action in the global header (song layer only) that renders the whole
> arrangement — every loop in order, at its own dwell length — through the full master chain, to a
> 16-bit / 44.1 kHz stereo WAV, and downloads it. The menu is built with room for a second row
> ("Export stem tracks") that v1 does not ship.
>
> Every decision here came out of a brainstorming session and is settled; rationale is inline.
> Written 2026-09-12 against `main` (`e3253ca`). No implementation exists yet. This is a design
> document only.

**Status:** implemented — see `docs/superpowers/plans/2026-09-12-export-mixdown.md`, which records the two deviations this design's text does not carry.

## Goal

A user arranges a song in Solna and wants the file. Today the only way out of the app is a `.solna`
project body — the app's *internal* format, not something a listener can play. After this ships:

1. **Export ▾** appears in the header on the song layer, beside the follow-playhead toggle.
2. Its one row, **Export mixdown (WAV)**, renders the entire song offline and downloads a `.wav`.
3. The render is the *whole* master chain — source buses with their gains and mutes, the master EQ,
   the reverb/delay/distortion sends, the compressor, the limiter and master volume — so the file
   sounds like the app, not like a dry sum of voices.
4. The file's length is the arrangement's length: each loop dwells
   `max(loopLengthSteps, stepsPerBar) × max(1, repeatCount)` steps, loops in list order, plus a tail.

**The render is offline and pre-computed, not a realtime capture.** That is the decision the rest of
this document exists to serve, and the reason the design is mostly about *moving pure functions*
rather than about audio: an offline render has to know every event before it starts, so every
"what happens at this step" decision has to be a function of state rather than a side effect of a
running clock.

## What changes

| From | To |
| --- | --- |
| No way to get audio out of Solna | **Export mixdown (WAV)** renders the song offline and downloads it |
| `AudioEngine.ctx` is `AudioContext \| null` and `init()` is the only way to bind a context | `ctx` widens to `BaseAudioContext \| null` and a **render seam** (`createRenderEngine(ctx)`) binds a fresh engine to a caller-supplied context |
| Song-structure and step-decision logic lives in `src/store/` and `src/components/` hooks | The pure half **moves down** to `src/utils/` and `src/audio/` |
| `encodeWav` exists only in `scripts/calibration/` | A `Blob`-returning `encodeWav` lives in `src/utils/`, usable by the app and by the harness |
| A calibration-only `mulberry32` in `scripts/calibration/seededRandom.ts` | A seeded PRNG in `src/audio/`, so a render can be made deterministic |

## Format: WAV only

**16-bit PCM, 44100 Hz, stereo.** No AAC, MP3 or Opus in v1, and no settings dialog.

- **WAV is the only format that needs no encoder.** `OfflineAudioContext.startRendering()` returns
  an `AudioBuffer` of `Float32Array` channels; a 44-byte header and a clamp is the entire
  conversion. Every compressed format means shipping or fetching an encoder (WASM for Opus/MP3, the
  platform `MediaRecorder` for AAC — which is realtime-only and therefore incompatible with the
  offline approach below).
- **16-bit is not a shortcut.** The quantization floor is about −96 dBFS while a Solna mix sits near
  −18 dBFS, so the encoding contributes nothing measurable — the same argument
  `scripts/calibration/encodeWav.ts` already records for its own use.
- **44.1 kHz is the app's working rate.** The engine's context is created by the browser and its
  `sampleRate` is what every impulse response, noise buffer and delay length is built from;
  resampling for export would be one more thing to get wrong for no gain.
- **Stereo, always.** The master chain is stereo end to end (convolver, delay, the analyser taps),
  and the offline context is constructed with 2 channels.

The file name follows the project name, reusing `projectFileName`/`slugifyProjectName`
(`src/utils/projectFileIO.ts:6`, `:11`), with a `.wav` extension.

## Approach: offline pre-compute

The renderer creates a **fresh `OfflineAudioContext(2, totalSamples, 44100)`**, schedules every
event with an explicit audio-clock `time`, calls `startRendering()`, and encodes the resulting
`AudioBuffer`.

This is the only approach that works, and the alternative is worth naming so it is not re-litigated:
a **realtime capture** (tap `masterGain` with a `MediaStreamDestination`, drive the existing clock,
record as it plays) needs the song to play in real time — a four-minute export blocks the tab for
four minutes, cannot be cancelled cleanly, and cannot be unit-tested without a clock. Worse, its
output is whatever happened to be audible: a tab switch that suspends the context, a focus change
that reroutes the arp, or the user touching a knob mid-export all land in the file.

Pre-computing inverts all three: the render is faster than real time (the browser runs the graph as
fast as it can), it is deterministic given a seeded RNG, and it is a pure function of a snapshot, so
a test can render one bar and assert on the samples.

**Consequences the rest of this design carries:**

- **Nothing can be read from the store during the render.** The renderer works from a plain
  serialisable `MixdownSnapshot` captured before it starts. The store can change underneath an
  export; the file must not.
- **Every event must be computable ahead of its step.** This is why the pure step-decision logic
  moves out of the React hooks (see *Moving pure functions*): today that logic reads `useAppStore`
  and audio-clock time directly, and neither exists inside the renderer.
- **A seed must be installed for the duration.** Reverb impulses, noise buffers and the arp's
  `'random'` note order all route through `random()` (`src/audio/rng.ts:32`), and a render must be
  reproducible.

## The engine seam

`src/audio/engine.ts` currently hardcodes the realtime context:

- `private ctx: AudioContext | null = null` (`src/audio/engine.ts:221`).
- `init()` (`:484`) picks `window.AudioContext || webkitAudioContext` (`:486`) and calls
  `this.setupMasterChain()` (`:488`).
- The class is **unexported** — only `export const audioEngine = new AudioEngine()` (`:3129`) — so
  there is no supported way to obtain a second instance.

Three changes, in order of how much they matter:

1. **Widen the field type.** `private ctx: BaseAudioContext | null = null`. `BaseAudioContext` is
   what `setupMasterChain()` and every node factory actually need; `AudioContext` is only needed by
   `resume()`, `close()` and `state`. Those stay in realtime-only paths and keep a real
   `AudioContext` because that is where the field is narrowed — an `OfflineAudioContext` has no
   `resume()`/`close()` at all, and a render never calls `init()`.

2. **Add a first-class render seam**, mirroring what the calibration harness already proves works:

   ```ts
   export function createRenderEngine(ctx: BaseAudioContext): AudioEngine
   ```

   A factory that constructs an `AudioEngine`, binds `ctx` to it, and calls `setupMasterChain()`
   — the same three steps `scripts/calibration/renderOffline.ts:185-186` performs today via
   `makeEngine() as any` then `engine.ctx = ctx`. The factory replaces that cast, and the harness
   is switched to use it (which is what retires `testFakes.ts`'s `as any` comment for this caller —
   `makeEngine` keeps its other users).

3. **Export the class** so the factory's return type can be named. `AudioEngine` becomes an exported
   class and `audioEngine` stays exactly as it is; no singleton behaviour changes.

**`init()` is untouched.** It remains the only thing that creates a realtime `AudioContext`, it
remains idempotent, and it remains the only path that resumes a suspended context. A render engine
is never stored in the singleton, never reaches `engineSync.ts`, and never outlives its
`startRendering()` call.

## Moving pure functions to their correct layer

Every function below is pure — no store read, no DOM, no clock — but lives in `src/store/` or in a
`src/components/` hook, where the renderer cannot reach it without violating the layering rules
(`src/audio/**` may not import `store/**` or `components/**`, enforced by `no-restricted-imports`
in `eslint.config.js`; note that the ban has **no** `allowTypeImports`, unlike the `src/data/**`
block, so not even a type may cross).

These are **moves, not copies.** A copy is the failure mode this section exists to prevent: two
implementations of "how long is this loop" is exactly the shape that silently drifts, and the
renderer would be the copy no test exercises.

| Function | From | To |
| --- | --- | --- |
| `loopBars` | `src/store/loop.ts:64` | `src/utils/songStructure.ts` (new) |
| `loopLengthSteps` | `src/store/songMode.ts:14` | `src/utils/songStructure.ts` (new) |
| `songAdvanceDecision` | `src/store/songMode.ts:60` | `src/utils/songStructure.ts` (new) |
| `sequencerStepEvents` | `src/components/useSequencerPlayback.ts:52` | `src/audio/` |
| `leadScheduleHits`, `leadDispatchTicks` | `src/components/loop/lead/useLeadPlayback.ts:90`, `:52` | `src/audio/leadMelody.ts` |
| `resolvePlaybackRhythmPattern`, `resolvePlaybackBassPattern`, `adaptRhythmPattern`, `adaptBassPattern`, `isFullHoldRhythm`, `isFullHoldBass` | `src/components/loop/chord/useChordPlayback.ts:181`, `:193`, `:216`, `:222`, `:150`, `:159` | `src/audio/chordRhythms.ts` |
| `armPad` (pure half) | `src/components/loop/chord/useChordPlayback.ts:239` (local, unexported) | `src/audio/playback/padPlayback.ts` |

### `src/utils/songStructure.ts`

An isolated, store-free module: the structural parameter types are declared **there**, not imported
from `src/store/types.ts`. That keeps the move to a plain relocation and does not widen the one
recorded `utils/ → store/` inversion (`localFileSave.ts`, `driveBrowser.ts`), which exists for a
constant that cannot be duplicated and would not be justified by a type. `Loop` is structurally
assignable to the declared type, so no caller changes.

Types and constants travel with the functions they belong to: `SongAdvance`, `SONG_HOLD` and
`SONG_END` move with `songAdvanceDecision` because they are its return contract. `enterSongIndex`
**stays** in `src/store/songMode.ts` — it is pure, but the renderer walks loops from index 0 to the
end and never computes a song entry index, so moving it would be churn in a file that has no other
reason to change.

**One new function belongs here, and it is the point of the module.** Today the dwell rule lives
inside `songAdvanceDecision` as three lines of arithmetic (`:69-77`):

```
effectiveLength = max(loopLengthSteps(loop.chords, stepsPerBar), stepsPerBar)   // a chordless loop is a silent bar, not a dead end
totalSteps      = effectiveLength * max(1, loop.repeatCount ?? 1)
```

The renderer must apply **exactly** this rule or the file will not match what the app plays. Lift it
into an exported `loopDwellSteps(loop, stepsPerBar)` in `songStructure.ts` and have
`songAdvanceDecision` call it, so there is one expression of the rule and the offline render and
the live arrangement cannot disagree. **The obvious simplification — `loopLengthSteps × repeatCount`
— is wrong** for a chordless loop, whose `loopLengthSteps` is `0`: the app dwells it one bar and
the naive form schedules nothing.

### Importer updates (the ~7 sites)

`loopBars` is imported by, and each import line changes to `@/utils/songStructure`:

- `src/components/song/SortableLoopCard.tsx:21`
- `src/components/song/ArrangeView.tsx:20` (which also imports `loopLabel` from the same module —
  `loopLabel` **stays** in `src/store/loop.ts`, so this becomes a second import line, not a moved one)
- `src/components/song/LoopCopyDialog.tsx:3`
- `src/components/loop/lead/LeadMelodyGrid.tsx:9`
- `src/components/loop/chord/useChordPlayback.ts:61`

Plus the two test files that import the moved symbols and move with them:
`src/store/loop.test.ts:14` and `src/store/songMode.test.ts:12` (the latter imports all three of
`loopLengthSteps`, `songAdvanceDecision` and `SONG_*`).

`src/store/songMode.ts` drops its own `loopBars` import (`:7`) and instead imports the three
functions from `../utils/songStructure`. Nothing else in it changes.

> Correcting the dispatch: this list is **six files, not seven**. `melodyGrid.ts` was named but does
> not import any of these symbols — it imports `leadStoredIndexAt` from `@/audio/leadMelody` and
> `LeadMelodyView` from `@/store/types`. `src/store/songMode.ts` is the current *home* of two of
> the three functions, so it is a caller of the new module rather than a site importing the old
> one.

### `src/audio/chordRhythms.ts` and `src/utils/patternAdapt.ts`

`src/utils/patternAdapt.ts` and `src/utils/eventAdapt.ts` already exist and hold *step-row* adapters
(`adaptStepRow`, `writeStepWindow`, `adaptStepEvents`). `adaptRhythmPattern`/`adaptBassPattern` are
a different thing — they adapt a *pattern object* to a meter — and they go to
`src/audio/chordRhythms.ts`, which already owns `customRhythmPattern` and the rhythm catalogue. Do
not fold them into `patternAdapt.ts` on the strength of the shared word "adapt".

### The pad extraction

`armPad` (`useChordPlayback.ts:239`) is a local, unexported function that reads six things off the
store — `padMode`, `padDroneDegree`, `scaleRoot`, `scaleType`, `padSynthParams` and `chords` — and
then arms a drone. The pure helpers it needs already exist in `src/audio/playback/padPlayback.ts`
(`resolveDroneNotes:33`, `shouldArmPad:96`, `padHoldSec:112`); what is missing is the *decision*
layer around them.

Extract that decision half into `src/audio/playback/padPlayback.ts` as a function whose six store
reads become **parameters** — the hook passes `get()`-derived values, the renderer passes snapshot
values. The trigger call itself (`triggerSynthNoteOn` on the pad bus at an explicit time) stays out
of the extracted function for the same reason the melody functions are pure: a function that
touches the engine cannot be called by a test that has no engine.

One naming hazard to record: `padHoldSec`'s second parameter is already named `loopBars`
(`src/audio/playback/padPlayback.ts:115`). When `loopBars` becomes an import in that file, the
parameter must be renamed, or a reader will believe the parameter is the function.

## The offline renderer — `src/audio/export/renderMixdown.ts`

A new module in its own `export/` folder. It imports **only** from `src/data/`, `src/utils/` and
`src/audio/`, and its public entry point is:

```ts
export async function renderMixdown(snapshot: MixdownSnapshot): Promise<AudioBuffer>
```

### The snapshot

`MixdownSnapshot` is declared in `src/audio/` (not imported from `src/store/`, which the layering
rule forbids) and is **plain-serialisable** — no `Blob`, no `FileSystemFileHandle`, no functions.
It carries everything the render reads:

- transport and meter: `bpm`, `stepsPerBar` (resolved from `meterId` before it crosses the seam)
- the arrangement: `loops` (id, `chords`, `repeatCount`, and the per-loop content the players need)
- the mixer: `masterVolume`, the source-bus gains/mutes (the `SOURCE_BUSES` roster,
  `src/store/sourceBuses.ts:22`), per-drum-track faders, the drum kit selection
- the effects block: the master `effects` object, plus `reverbDecay`
- the synth/bass/pad/lead/FX params the event builders take

It is built in the store slice from `buildProjectContent` (`src/store/projectFormat.ts:201`) — the
same content set a `.solna` body carries — plus the mix and bus fields that a project body
deliberately excludes. Building the snapshot from the *content* function rather than from raw state
is what keeps "what is exported" and "what is saved" from drifting into two different ideas of the
song.

### Timeline construction

```
stepDur    = stepDurationSec(bpm)            // utils/musicTheory.ts:488, the 16th-note duration
tickDur    = stepDur / TICKS_PER_SIXTEENTH   // utils/stepResolution.ts, for the melody tracks

t = 0
for each loop in arrangement order:
  dwell = loopDwellSteps(loop, stepsPerBar)
  for rep in 0 .. max(1, loop.repeatCount) - 1:
    for step in 0 .. dwell - 1:
      stepTime = t  →  events for this step
      t += stepDur
totalSteps  = t / stepDur
totalSamples = ceil(totalSteps * stepDur * 44100) + tailSamples
```

Every loop restart is a **loop start** (`isLoopStart = step === 0`), which is what arms the pad and
resets the per-loop read position — the same boundary the live arrangement has, so nothing needs to
be special-cased for "the first loop".

Per step, the renderer calls the moved pure functions and schedules their output with explicit
times:

| Material | Pure source | Scheduled as |
| --- | --- | --- |
| Drums | `sequencerStepEvents` | `triggerDrum(voice, velocity, time)` (`engine.ts:2642`, takes an explicit `time`) |
| Chord | `buildChordEvents` + `eventsForStep` (`src/audio/playback/chordPlayback.ts:35`, `:70`) | `triggerSynthNoteOn` / `triggerSynthNoteOff` on the `chord` bus |
| Bass | `resolveBassSteps` (`src/audio/bassPatterns.ts:69`) | same, on the `bass` bus |
| Lead / FX | `leadScheduleHits`, `leadSoundingNotes`, `resolveLeadStepTriggers` (`src/audio/leadMelody.ts:142`, `:333`) | same, on each track's own engine source |
| Pad | extracted `armPad` half + `resolveDroneNotes` / `shouldArmPad` / `padHoldSec` | a long `triggerSynthNoteOn` (and its off) on the `pad` bus |

`sequencerStepEvents` moving to `src/audio/` is clean because its parameter types —
`SequencerTrack`, `SynthParams` — already come from the top-level `src/types.ts`, not from
`src/store/types.ts` (the component imports them from `../types` today).

### Master state

Before scheduling, the renderer applies the snapshot through the engine's **existing public
setters** — the same ones `src/store/engineSync.ts` calls, in the same order — so the offline graph
is configured by the same code path a live session uses rather than by a parallel one:

- `updateEffects(effects)` (`engine.ts:2931`) for the EQ, the three sends, the compressor and the
  limiter, plus `setReverbDecay` (`:2916`)
- `setMasterVolume` (`:2980`)
- `setSourceGain` / `setSourceMuted` per bus (`:1803`, `:1794`) — both take an optional `time`, and
  the render passes `0` so the bus state is settled before the first event
- `setDrumTrackGain` (`:1868`), `setDrumKit` (`:2137`) and `updateSynthParams` (`:2073`) per source

The render deliberately does **not** do what the calibration harness does. That harness zeroes the
three sends and forces the dynamics off (`renderOffline.ts` docblock, and `rewireMasterDynamics`
at `engine.ts:972`) because it measures the *dry voice* for a trim table. An export is the
opposite: it must sound exactly like the app.

### Determinism

The renderer installs a seeded generator through `setRandomSource` (`src/audio/rng.ts:41`) for the
duration of the render and restores it in a `finally`, exactly as
`scripts/calibration/renderOffline.ts:222-226` does today — reverb impulse noise, noise-voice
buffers and the arp's `'random'` note order all read from it.

**Two things are needed that do not exist yet:**

1. **`mulberry32` must be ported into `src/`.** It lives only in
   `scripts/calibration/seededRandom.ts:11`, and `src/` cannot import from `scripts/`. It goes
   beside the seam in `src/audio/rng.ts` (with the calibration copy left where it is, or switched to
   re-export — a script may import from `src/`, as `renderOffline.ts` already does for
   `@/audio/rng`).
2. **`rng.ts`'s docblock must be corrected.** It currently states that "no production code path
   installs a replacement; only tests and the calibration harness call `setRandomSource`." The
   mixdown renderer *is* a production path that installs one. The docblock is a claim the file makes
   about itself and it must say what is now true — the renderer is a third caller, its replacement
   is scoped to the render, and it is restored on every exit path.

The seed value is a constant (an integer, exported so a test can name it). A render is reproducible
for a given seed; two exports of the same song produce byte-identical files.

### What is not rendered: the arp

**The arpeggiator's live-input hook is not part of the render.** `src/audio/playback/arpPlayback.ts`
arpeggiates notes a *player is holding* — it subscribes to the shared clock, reads a ref of held
keys and releases on key-up. There are no held keys in an offline render, and the clock does not
run.

But `SynthParams.arpActive` is **arrangement material**, not only a live gesture: it is what decides
whether a chord, bass or lead pattern plays as a block or as an arpeggio. So the renderer uses the
**math** — `computeArpTriggers` (`src/audio/arpSchedule.ts:40`) — for chord/bass/lead material
whose `arpActive` is set, driven from the same pure step functions, and never calls the hook. The
distinction to hold on to: `arpSchedule.ts` is pure scheduling arithmetic, `arpPlayback.ts` is a
React hook around it, and only the first belongs in the renderer.

## WAV encoder — `src/utils/encodeWav.ts`

`scripts/calibration/encodeWav.ts` is ported to `src/utils/encodeWav.ts`, **pure and unchanged in
what it computes**: a 44-byte RIFF/WAVE header (PCM, 16-bit, N channels, a given sample rate),
little-endian samples, clamping to ±1 with the asymmetric scale factors the calibration tests
already pin.

The one change is the return type. The calibration function returns `Uint8Array`
(`scripts/calibration/encodeWav.ts:16`) because the harness writes it to a file with
`writeFileSync`. The new one returns a **`Blob`** — which is what the download path and
`ProjectSaveResult.destination: 'download'` want — and the calibration harness calls it and adapts
(`new Uint8Array(await blob.arrayBuffer())`) rather than keeping a second implementation. Its
existing assertions (`encodeWav.test.ts`: header fields, channel validation, that an empty channel
array and mismatched channel lengths both throw) move with it; the harness's file-write path keeps
one test that it can still write a decodable file.

`src/utils/` is the right home: it is above `data/`, reachable from both `src/audio/` and
`src/components/`, and free of DOM events — the function does not download anything, it only
encodes.

## Store slice — `src/store/mixdownSlice.ts`

```ts
export type MixdownResult =
  | { ok: true; destination: 'download'; blob: Blob; fileName: string }
  | { ok: false; reason: MixdownFailureReason };

export interface MixdownSlice {
  exporting: boolean;
  exportMixdown: () => Promise<MixdownResult>;
}
```

This follows `ProjectSaveResult` (`src/store/projectSlice.ts:50`) exactly, including its
`destination: 'download'` variant: **the store decides and the component writes.** The store never
touches `document`, never creates a URL, never clicks an anchor — it returns the `Blob` and the
name, and the header's click handler performs the download. That split is what makes the whole
export testable without a DOM, and it is already how the local-save fallback works
(`projectSlice.ts:279`).

- The snapshot is built from `buildProjectContent(get())` (`projectFormat.ts:201`) plus the mix and
  bus fields, then passed to `renderMixdown`.
- `exporting` is set true on entry and false in a `finally`, so a failure cannot leave the button
  stuck in a loading state.
- **The renderer never throws.** `renderMixdown` catches at its own boundary and returns a failed
  result; the slice maps it to a `projectNotice` sentence and to `{ ok: false }`. A thrown exception
  crossing into a click handler is an unhandled rejection with no message for the user, which is the
  one outcome an export must not have.
- The slice is registered in `src/store/store.ts` alongside the others
  (`createMixdownSlice(setWithLoopMirror, get)`), and its state is **session-only**: `exporting` is
  absent from `partializeAppState` and the snapshot is never persisted. Nothing here changes
  `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`.

## UI — `src/components/Header.tsx`

A new `ExportButton` component in `Header.tsx`, rendered next to `FollowPlayheadToggle`
(`Header.tsx:222`) and gated by the same rule.

- **`layer === 'song'` only**, and it takes `layer` as a **prop** rather than deriving it, for the
  exact reason `FollowPlayheadToggle` and `ProjectNameLabel` do: `Header` derives `layer` from
  `activeTab` (`Header.tsx:281-282`) through a plain `useAppStore` selector, which under
  `renderToString` serves the store's *creation-time* state — so a rendered `<Header />` in a test
  can never reach the song layer. Passing the prop is what makes "appears on the song layer only"
  an assertable statement.
- It reads the store through **`useLiveStore`** (`src/components/ui/useLiveStore.ts`), not a bare
  `useAppStore` selector, for the same trap: `useLiveStore` serves `getState()` for both snapshots,
  so a test's `setState()` before the render actually lands.
- **Button**: the label `Export` with a chevron, opening a popup menu. Markup follows the existing
  daisyUI dropdown in `ProjectMenu.tsx:351-360` — a `dropdown` wrapper whose `dropdown-content` panel
  carries `tabIndex={0}` (daisyUI holds the panel open on `:focus-within`, so a non-focusable panel
  closes the instant a pointer lands inside it; that container is not an interactive control, hence
  the recorded `jsx-a11y/no-noninteractive-tabindex` disable). The `details`/`summary` variant in
  `Header.tsx:404` is the other in-repo precedent.
- **The menu has one item in v1**: `Export mixdown (WAV)`, `id="btn-export-mixdown"`. Its handler
  awaits `exportMixdown()` and, on `ok: true`, calls `downloadBlob`.
- **The future stem item is out of scope.** The menu is *shaped* to take it — one row per export
  kind, each row owning its own action — and nothing else is built for it. No disabled row, no
  "coming soon": a control that can never work on this build must not be advertised, which is the
  same rule the Drive rows follow when `VITE_GOOGLE_CLIENT_ID` is unset.
- **While `exporting`**, the trigger is disabled and the item shows a progress label, so a second
  click cannot start a second render of the same song.

**`downloadBlob`** is a new helper in `src/utils/projectFileIO.ts`, parallel to `downloadTextFile`
(`:20`) and sharing its shape: an injectable `Document` and an injectable `createObjectURL`/
`revokeObjectURL` pair, the URL revoked in a `finally`, and storage/DOM access inside the guard
discipline the file already follows. It takes `(fileName, blob, doc?, url?)`.

**The completion/failure surface is `projectNotice`** — the existing toast
(`src/components/project/ProjectNotice.tsx`), which is already the only surface for "a download that
could not be written". Success writes a short notice naming the file; failure writes the reason.
Adding a second toast component for this would give the app two places a project-level message can
appear, which the project-notice docblock explicitly argues against.

`check:theme` applies: the new markup uses role-based tokens and must pass the guard suite.

## Data flow

```
Header: ExportButton click
  └─ exportMixdown()                                   [store/mixdownSlice.ts]
       ├─ exporting ← true
       ├─ buildProjectContent(get()) + mix fields      [store/projectFormat.ts, store/sourceBuses.ts]
       │    → MixdownSnapshot                          [src/audio/, plain-serialisable]
       ├─ renderMixdown(snapshot)                      [src/audio/export/renderMixdown.ts]
       │    ├─ new OfflineAudioContext(2, totalSamples, 44100)
       │    ├─ createRenderEngine(ctx)                 [src/audio/engine.ts]
       │    ├─ apply effects / buses / drum kit / params from the snapshot
       │    ├─ setRandomSource(mulberry32(SEED))  … restored in finally
       │    ├─ walk loops × dwell × steps, calling the moved pure functions
       │    │    and triggerDrum / triggerSynthNoteOn / triggerSynthNoteOff at explicit times
       │    ├─ startRendering() → AudioBuffer
       │    └─ encodeWav(buffer.getChannelData(0..1), 44100) → Blob   [src/utils/encodeWav.ts]
       ├─ exporting ← false (finally)
       └─ { ok: true, destination: 'download', blob, fileName }
  └─ downloadBlob(fileName, blob)                      [src/utils/projectFileIO.ts]
  └─ setProjectNotice('…')  on failure
```

Note what is not in the flow: the realtime `audioEngine` singleton, the shared clock, the transport,
and the store's live state after the snapshot is taken. An export is a side effect on a file, not on
the session — the song keeps playing, or stays stopped, exactly as it was.

## Error and edge cases

| Case | Behaviour |
| --- | --- |
| **The render throws anywhere** | Caught inside `renderMixdown`; returns a failed result. The slice sets `projectNotice` and `exporting ← false` in a `finally`. Nothing is thrown at the click handler. |
| **`OfflineAudioContext` is unavailable** | The action fails with a notice. Treat it as a capability probe, like the File System Access API path: a degraded state, not an exception path. |
| **The arrangement is empty of loops** | `totalSamples` would be the tail alone. Render nothing and fail with a notice rather than downloading a silent file — a zero-length WAV reads as a broken export. |
| **A loop with no chords** | Dwells `stepsPerBar` (`loopDwellSteps`), matching live playback. It is a silent bar in the file, not a skipped loop. |
| **`repeatCount` absent or 0** | `max(1, repeatCount ?? 1)` — one pass, the same floor `songAdvanceDecision` applies. |
| **A very long song** | `totalSamples` is bounded by the arrangement; a 10-minute stereo 44.1 kHz buffer is about 106 MB of `Float32Array` plus the encoded 16-bit copy. Acceptable, and worth a note rather than a limit — the browser will fail the allocation loudly if it must. |
| **Memory of the encoded blob** | Revoked in `downloadBlob`'s `finally`, so a repeated export does not accumulate object URLs. |
| **A knob moved mid-export** | Ignored. The snapshot was taken before the render started. |
| **Two exports back to back** | The second is blocked by `exporting` until the first resolves. |
| **The tab is backgrounded mid-export** | Offline rendering does not depend on the realtime context's state, so it continues. This is one of the reasons the offline approach was chosen. |
| **Non-finite values in the mix** | The snapshot comes from sanitised store state, and `encodeWav` throws on a channel-length mismatch; a non-finite sample would clamp to ±1 rather than corrupting the header. |

## Testing

Conventions unchanged (`.claude/rules/testing.md`: `bun:test`, no DOM, pure-logic helpers plus
`renderToString`). Added:

- **`encodeWav` round-trip** — moved from `scripts/calibration/encodeWav.test.ts` and adapted to the
  `Blob` return: header fields (RIFF/WAVE, PCM, 2 channels, 44100, 16 bits), byte length, channel
  validation, and a decode of the produced bytes back to the input samples. An empty channel array
  and mismatched channel lengths both throw, as they do today.
- **Renderer smoke test** — a one-loop, one-bar arrangement: assert the returned `AudioBuffer` has
  the expected `length` (`totalSteps × stepDur × 44100` plus the tail) and `numberOfChannels === 2`,
  and that at least one sample is non-zero. **A non-silent assertion is the one that matters**: a
  renderer that schedules nothing returns a perfectly well-formed, correctly sized, silent buffer,
  and every length assertion passes.
- **Determinism** — two renders of the same snapshot with the same seed produce identical samples;
  and the RNG is restored to the default after a render, including after a render that throws (assert
  `random` is no longer the seeded stream).
- **`loopDwellSteps`** — property-style cases over `{ no chords, repeatCount 0/1/3, multiple chords }`
  proving the renderer's length rule and `songAdvanceDecision`'s boundary rule agree at every
  boundary. This is the test that stops the two from drifting, and it is the reason the rule was
  lifted into one function.
- **Moved-function importers** — every moved symbol's existing test follows it to its new home, and
  each of the six importer files builds against the new path. `bun run lint` (tsc) is what proves the
  move is complete: a leftover `import { loopBars } from '@/store/loop'` fails the type check, and a
  duplicated re-export would be visible in review.
- **Slice** — `exportMixdown` against an injected renderer (a stub returning a tiny buffer): a
  success result carries a `Blob`, the file name and `destination: 'download'`; a failed render sets
  `projectNotice`; `exporting` is false afterwards on both paths. The slice is tested with **no
  renderer running**, which is the payoff of keeping the snapshot plain-serialisable.
- **Header** — `renderToString` with `layer="song"` asserts the trigger renders and the menu opens
  with the one item; with `layer="loop"` asserts it renders `null`. The item's click wiring is
  asserted through the store action being called (a spy on the injected action), not through a real
  download — nothing in the suite touches `document`.
- **`bun run verify` is the gate** — test, `lint` (tsc), `eslint`, `check:keys`, `check:drums`,
  `check:contrast`, `check:levels`, `build`. The two that this change can plausibly break are:
  - **`eslint` (import layering)** — `renderMixdown.ts` must import nothing from
    `store/**` or `components/**` (no `allowTypeImports` exemption exists for `src/audio/**`), and
    the new `src/utils/songStructure.ts` must not reach into `store/`. `eslint` currently reports
    nothing at all, and that is the state to keep.
  - **`check:levels`** — it asserts the calibration trim table still matches today's kit and preset
    defaults. Moving `encodeWav` and switching the harness to the `src/utils/` copy must not change
    a single byte of what the harness writes, or the hash moves and the gate fails. That is a
    feature: it proves the port is byte-faithful.

## Known limitations

- **The render is not bit-identical to realtime under voice-stealing.** `activeVoices` is keyed
  `` `${source}:${noteName}` `` and holds one voice per key, so two players sounding the same note on
  one bus cut each other short in both worlds — but the *teardown* path is wall-clock. A voice's
  node teardown is armed with `setTimeout` (`engine.ts:1534`, and the comment at `:88-95` records why:
  the timer is wall-clock while the envelope runs on the audio clock). In an offline render the
  audio clock advances as fast as the CPU allows while the wall clock does not, so a teardown that
  fires "at the right time" in realtime can fire late in a render. This is **acceptable, and
  deliberately not fixed here**: teardown runs *after* the amp envelope has already reached 0, so
  the audio has already decayed — what a late teardown leaks is a disconnected node, not a sound.
  Fixing it properly means moving voice teardown onto the audio clock, which is engine surgery with
  realtime consequences and belongs in its own spec.
- **An export is a snapshot, not a mix session.** There is no per-export level trim, no normalisation,
  no dither, and no way to audition the result before it downloads. The master chain is the master
  chain.
- **Voice order is not guaranteed to match realtime.** Where two events land at exactly the same
  time on one bus, the order they were scheduled is the order they were walked — which follows the
  arrangement's step order, not the order a live clock happened to dispatch them.
- **The arp as a live gesture is absent**, deliberately: there is no player holding keys in a render.
  Arp *material* (`arpActive`) is rendered; the live hook is not.
- **A long export is a long blocking-style render.** The browser runs the graph off the main thread
  where it can, but the event scheduling walk itself is synchronous and proportional to the number of
  steps. There is no chunked/yielding render in v1.

## Non-goals

- **Any format other than 16-bit/44.1 kHz stereo WAV** — no AAC, MP3, Opus, no sample-rate choice, no
  bit-depth choice, no export settings dialog.
- **Export stem tracks.** The menu is shaped to take the row; the row, the per-bus render, and the
  multi-file download are all out of scope.
- **Realtime capture / "record what I hear"** — the approach this design rejects (see *Approach*).
- **Normalisation, limiting beyond the existing limiter, LUFS targeting or dither.** The file is the
  master chain's output.
- **Persisting export settings**, or remembering a last-used file name/location. The snapshot is
  session state.
- **Server-side or background rendering**, a render queue, or exporting without downloading (no
  File System Access write path in v1 — the local Save path already owns that API).
- **Video/score export, per-loop export, or an export range** ("export bars 17–32").
- **Changing what a project body contains.** The `.solna` content set, `PROJECT_FORMAT_VERSION` and
  `PERSIST_VERSION` are all untouched; the snapshot is built *from* the content set and adds to it
  only in memory.

## Verified against `main` (`e3253ca`)

Every path, symbol and line reference above was read at design time. Corrections to the original
dispatch, recorded so a reader knows what was checked:

| Claim | Verified result |
| --- | --- |
| `ProjectSaveResult` in `src/store/projectSave.ts` | **That file does not exist.** The type is `src/store/projectSlice.ts:50`; the `destination: 'download'` variant is at `:279`. |
| `loopBars` move affects ~7 importers incl. `melodyGrid.ts` | **Six files**, and `melodyGrid.ts` is **not** one of them — it imports `leadStoredIndexAt` from `@/audio/leadMelody`. |
| Render length is `loopLengthSteps × repeatCount` | **Wrong for a chordless loop** — the app dwells it `stepsPerBar`. Lifted to `loopDwellSteps` (see *`src/utils/songStructure.ts`*). |
| `encodeWav(channels, sampleRate): Blob` | The calibration original returns `Uint8Array` (`scripts/calibration/encodeWav.ts:16`). The change of return type is a decision, stated above. |
| `mulberry32` reachable from `setRandomSource` | It is **calibration-only** (`scripts/calibration/seededRandom.ts:11`) and must be ported into `src/audio/`. The `rng.ts` docblock's "no production code path installs a replacement" claim also needs correcting. |
| `armPad` in `useChordPlayback.ts` | Confirmed at `:239`, local and unexported. |
| `resolveBassSteps` to move | Already in `src/audio/bassPatterns.ts:69` — nothing to move. |
| Engine: `private ctx` / `init()` / `setupMasterChain` | `:221` / `:484` (context at `:486`, `setupMasterChain()` at `:488`) / `:770` (private). `audioEngine` at `:3129`. |
| `scripts/calibration/renderOffline.ts` proves the seam | `engine.ctx = ctx` at `:186`, via `makeEngine() as any` at `:185`; seeded at `:222-226`. |
| `Header.tsx` gets `layer` | It derives `layer` from `activeTab` at `:281-282` and takes no prop; `FollowPlayheadToggle` at `:222` is the prop-taking precedent the new control follows. |
