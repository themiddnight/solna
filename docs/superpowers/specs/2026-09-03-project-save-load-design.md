# Project Save / Load — Design

> Named projects stored locally, plus `.solna` file export and import. Every decision here
> came out of a brainstorming session and is settled; the rationale is recorded inline so a
> later reader does not re-derive it. Written 2026-09-03 against `main` (b3dce03). No
> implementation exists yet.

## Goal

Give Solna the project model a desktop program has: the session you are editing is *a*
project, you can name it, save it, open another one, and hand the file to someone else.

Concretely, after this ships a user can:

1. Save the current session as a named project, kept locally on the device.
2. Open a previously saved project, reopen the manager and switch between them.
3. Export a project to a `.solna` file, and import one back — including on another device,
   another browser, or another profile.
4. Close a browser-killed PWA tab and lose nothing, exactly as today.

## Terminology

| Term | Meaning |
| --- | --- |
| **Live session** | The zustand store as it currently is on screen. |
| **Working buffer** | The existing `persist` payload in `localStorage`. Crash protection only. |
| **Project store** | The IndexedDB database holding named projects. |
| **Project** | An envelope (identity + timestamps) plus a content body. |
| **`.solna` file** | One serialized project — envelope + content — as plain JSON. |
| **Current project** | The project the session was last opened from or saved to, by `currentProjectId`. May be absent (an unsaved session). |
| **Dirty** | The live session's content differs from the snapshot taken at the last open or save. |

## Context — what exists today (verified against the code)

- `src/store/store.ts` exports `PERSIST_KEY = 'musibox_project_state_v1'` and configures
  zustand `persist` at **version 8** with `partializeAppState`, a `migrate` chain, a `merge`
  that sanitises the parsed payload, and `onRehydrateStorage`.
- `partializeAppState` persists exactly: `bpm`, `meterId`, `masterVolume`, `metronomeActive`,
  `selectedVibeId`, `controlTarget`, `effects`, `customSynthPresets`,
  `customChordProgressions`, `loops`, `activeLoopId`.
- `src/store/loop.ts` exports `LOOP_FLAT_KEYS`, which is exactly the key set of
  `LoopStatePatch` (`Omit<Loop, 'id' | 'name' | 'repeatCount'>` in `src/store/types.ts`).
  So `Loop` = `LOOP_FLAT_KEYS` + `id` + `name` + `repeatCount?`, with no field left over —
  the rule, not a count, because the count moves with routine work.
- `src/utils/coalescedStorage.ts` buffers writes behind `requestIdleCallback` with
  `IDLE_FLUSH_TIMEOUT_MS = 250` (a `setTimeout` where idle callbacks are missing), and
  `store.ts` flushes it on `pagehide` and on the hidden `visibilitychange`.
  `flushPersistedWrites()` is exported for tests and for read-your-writes callers.
- `resolveStorage()` in `store.ts` probes `localStorage` inside `try`/`catch` (it *throws*,
  it does not merely return null) and falls back to an in-memory `StateStorage`.
- Per-library JSON export/import already exists in
  `src/components/loop/SynthPresetLibrary.tsx` and
  `src/components/loop/ChordPresetLibrary.tsx`: a data-URL `<a download>` for export and a
  hidden `<input type="file" accept=".json">` + `FileReader` for import.
- `src/components/ui/Wordmark.tsx` is a presentational `<span>` (an `h-8 w-8` `<img>` plus
  optional `solna` text). Its only consumer is `src/components/Header.tsx`, which renders
  `<Wordmark textClassName="hidden sm:inline" />` in the brand group — **outside** both the
  `layer === 'loop'` and `layer === 'song'` conditionals further down the header.
- The modal convention in this repo is daisyUI: `<dialog className="modal modal-open">` with
  a `modal-box` and a `<form method="dialog" className="modal-backdrop">` — see
  `src/components/ui/MidiSettingsModal.tsx`.

## The three state zones

A project store is a *third* zone. The working buffer keeps its current role unchanged; it is
explicitly **not** the project store.

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. LIVE SESSION — the zustand store (src/store/store.ts)         │
│    what is on screen; the only thing the audio engine follows    │
└───────┬──────────────────────────────────────┬───────────────────┘
        │ persist(), every set()               │ explicit user action
        │ (crash protection)                   │ Open / Save / Save As
        ▼                                      ▼
┌───────────────────────────────┐   ┌──────────────────────────────┐
│ 2. WORKING BUFFER             │   │ 3. PROJECT STORE             │
│    localStorage               │   │    IndexedDB                 │
│    'musibox_project_state_v1' │   │    named projects            │
│    exactly ONE payload,       │   │    many records, each with   │
│    overwritten continuously   │   │    an envelope + content     │
│    survives a killed tab      │   │    changes only on an        │
│    NOT a project              │   │    explicit user action      │
└───────────────────────────────┘   └───────┬──────────────────────┘
                                            │ export ↕ import
                                            ▼
                                    ┌──────────────────────────────┐
                                    │  `.solna` file — plain JSON  │
                                    │  a serialized project body   │
                                    │  + envelope. Not a 4th zone. │
                                    └──────────────────────────────┘
```

**Why zone 2 stays even though zone 3 exists.** The session is separate from the project —
traditional open / save / save-as, like a desktop program — so in principle "you have unsaved
changes" is the only safety net needed. It is not enough here: on mobile and in an installed
PWA the browser can kill the tab with no prompt, and the page has no way to block it. Without
the working buffer that kill loses real work. Zone 2 is crash protection, nothing else.

**Launch always restores the working buffer.** The app never shows a project list first. The
user lands exactly where they left off, with the current project's identity and dirty state
restored alongside (see the persist migration below).

## File format v1

### Envelope

| Field | Type | Notes |
| --- | --- | --- |
| `formatVersion` | `number` | `1` for this design. |
| `id` | `string` | Stable project identity; survives export and re-import. |
| `name` | `string` | User-facing name. |
| `createdAt` | `number` | Epoch ms, set once when the project is first created. |
| `updatedAt` | `number` | Epoch ms, rewritten on every save. |

**`formatVersion` is deliberately separate from the persist `version`.** The persist version
bumps for internal `localStorage` reshapes that say nothing about the content contract — v6
wrapped flat state into `loops`, v7 renamed the region keys to loop keys, v8 backfilled the
lead window. A future external reader (a murva importer) must not be forced to care about
Solna's private storage refactors. The two numbers move independently, on purpose, and the
persist migration chain must never be reused to read a `.solna` file.

### Content

```
content: {
  bpm: number
  meterId: MeterId
  masterVolume: number
  effects: MasterEffects
  loops: Loop[]        // each: every LOOP_FLAT_KEYS field + id + name + repeatCount
}
```

`loops` is structurally identical to `PersistedState['loops']` — the full `Loop` interface,
which is `LOOP_FLAT_KEYS` plus `id`, `name`, `repeatCount`. Do not invent a parallel loop
shape; import must reuse the same per-field guards `sanitizeLoops` already applies in
`store.ts` (see *Error and edge cases*).

`LOOP_FLAT_KEYS`, for reference — confirm against `src/store/loop.ts`, which is the single
source of truth and must be iterated rather than re-listed in the project code:

```
scaleRoot, scaleType, synthParams, chordSynthParams, bassSynthParams,
chords, chordRhythmId, chordRhythmMode, customChordRhythm, chordFeel, chordOctave,
bassPatternId, bassPatternMode, customBassPattern, bassFeel, bassOctave,
leadMelodySteps, leadLoopLength, leadMelodyView, leadMelodyOctave,
sequencerTracks, soundKit, drumFilterCutoff, drumFilterResonance, drumFilterType,
synthVolume, synthMuted, chordVolume, chordMuted, bassVolume, bassMuted,
masterSequencerVolume, drumMuted
```

The flat top-level copies of these keys in the live store are the working copy of the active
loop, kept in sync by `loopSync`. They are not persisted today and are not in the content
set either; `loops[activeLoopId]` is authoritative.

### Excluded — view / session state

`controlTarget`, `activeLoopId`, `metronomeActive`, `selectedVibeId`.

These describe *how you were looking at the music*, not the music. Which synth the knobs are
pointed at, which loop card is open for editing, whether the click track is on, which vibe
chip was last pressed — none of it changes a rendered bar of audio, and carrying it would
make an imported project yank the recipient's view around. They stay in the working buffer
(and so survive a tab kill) but never travel in a project.

### Excluded — user library, not project content

`customSynthPresets`, `customChordProgressions`.

**A project does not depend on them for correct sound.** `SynthParams` stores every value
inline — `oscType`, all four amp-envelope stages, all four filter-envelope stages, LFO, arp,
octave, cutoff, resonance — and its `preset: string` field is a *provenance label*, not a
pointer that has to be resolved. A chord in `ChordItem` carries `notes: string[]`, concrete
resolved voicings such as `['C4','E4','G4','B4']`. So a project opened on a device with an
empty preset library sounds exactly the same as on the device it was saved on.

These are the user's cross-project library, shared by every project on the device. Bundling
them would mean an import either silently overwrites the recipient's library or silently
duplicates entries into it. Per-library export/import already exists as its own action in
`src/components/loop/SynthPresetLibrary.tsx` and
`src/components/loop/ChordPresetLibrary.tsx`; a user who wants to move a library moves it
there.

### Library provenance is already complete — nothing needs adding

The user's requirement is maximum fidelity between save and open, so it is worth stating
plainly: **the content set is the whole `Loop` object**, every field of the interface at
`src/store/types.ts:239-276` and nothing omitted. Every library reference the app tracks is
therefore already saved:

- the three `SynthParams.preset` name strings — lead (`synthParams`), chord
  (`chordSynthParams`) and bass (`bassSynthParams`);
- `chordRhythmId` + `chordRhythmMode` + `customChordRhythm`;
- `bassPatternId` + `bassPatternMode` + `customBassPattern`;
- `soundKit`.

No new field is required for v1.

**The no-substitution rule extends to `SynthParams.preset`.** It is already specified for
`chordRhythmId` / `bassPatternId` / `soundKit` (see *Error and edge cases*); it holds for
`preset` for the same reason and one more. `preset` holds a preset **name**, not an id —
`applyPreset` at `src/audio/synthPresets.ts:103-104` returns
`{ ...base, ...preset.params, preset: preset.name }`. It is provenance only: nothing resolves
it to produce sound, because every parameter value is already stored inline. A name that no
longer resolves is still a truthful record of what the sound was derived from. Substituting a
different preset would both change the sound and destroy that record — so an unresolvable
`preset` string is kept verbatim, never rewritten and never blanked.

**Known fragility:** because it is a name and not a stable id, renaming a preset in the
library breaks the provenance link. The blast radius is the label only — never audio, since
the params are inline. Accepted for v1.

**What the label means.** `preset` records *the preset last loaded*, not *what this currently
sounds like*: a user can turn knobs afterwards and the label does not follow. A "(modified)"
indicator — computed by comparing the inline params against the library entry of that name —
is a possible future refinement and is explicitly **out of scope for v1**.

### `.solna` is plain JSON with a `.solna` extension

No zip container. Solna has no binary assets — every sound is synthesized from parameters, and
the whole body is numbers, strings and booleans. A zip would add a dependency and a stream
API for zero benefit, and would make the file unreadable in a text editor, which is a real
debugging cost. MIME type `application/json`; the file picker accepts `.solna` (and should
also accept `.json`, since some mobile file providers rewrite unknown extensions).

## Storage design

**Database.** One IndexedDB database for Solna, with two object stores:

| Store | keyPath | Contents |
| --- | --- | --- |
| `projects` | `id` | `{ ...envelope, content }` — the full body. |
| `projectMeta` | `id` | `{ id, name, createdAt, updatedAt, formatVersion }` — only what a list row renders. |

**Why two stores.** IndexedDB reads whole records; there is no partial read of a value. With
one store, rendering the project list would deserialize every project body — for a user with
twenty arrangements that is megabytes of `loops[]` parsed to paint a list of names. The
metadata store keeps opening the list proportional to the number of projects, not to their
size.

Both stores are written in a **single transaction** on every mutation (create, save, rename,
delete) so the two can never diverge. If the transaction aborts, neither is written.

**A read-repair rule:** on opening the database, if a `projectMeta` row exists with no
matching `projects` row (or vice versa), drop the orphan. This is the only place a
consistency scan is allowed; it must not read bodies — a key-only cursor over both stores is
enough.

**IndexedDB can throw.** Exactly like `localStorage`, IndexedDB is unavailable or throws in
Safari private mode, with storage blocked by policy, and in some embedded webviews — and
`indexedDB.open()` can also hang or fire `onerror` asynchronously. Follow the guard
discipline already in `store.ts`: probe inside `try`/`catch`, never read the global in a
default-parameter expression, and treat failure as a normal state, not an exception path.

The failure mode is degraded, never fatal:

- The app runs. The live session and the working buffer are untouched — they are
  `localStorage`, a separate mechanism with its own fallback.
- The Project Manager opens and shows a clear, non-blocking notice that project storage is
  unavailable on this device, with the reason kept generic (private browsing or blocked site
  storage).
- The project **list** is empty and the list section is disabled.
- `Export current session` and `Import` **still work**: both are pure file I/O against the
  live session and do not touch IndexedDB. Import in this state loads the file into the live
  session without adding it to the list, and leaves `currentProjectId` unset — that project
  cannot be saved back on this device.
- `Save` / `Save as new copy` are disabled with a tooltip pointing at export as the way to
  keep the work.

Availability is resolved **once, lazily, on first Project Manager open**, not at module load:
probing at import time costs every launch a database open that most launches never need.

## Lifecycle rules

All actions below live behind the Project Manager modal. Any action that would replace the
live session first runs the **dirty guard** (Discard / Cancel / Save & Continue); `Cancel`
aborts the whole action and leaves the session untouched.

| Action | Behaviour |
| --- | --- |
| **Launch** | Rehydrate the working buffer exactly as today. `currentProjectId` and the dirty baseline come back with it (persist v9), so the dirty badge is correct from the first frame. Never touch IndexedDB, never show a list — the project *name* is resolved lazily from `projectMeta` on the first Project Manager open. |
| **New** | Dirty guard. Stop playback and cut voice tails (below), then reset the content set through `defaultProjectContent()` (see *Dirty detection*), apply the same *reset rules for excluded fields* as Open, and clear both `currentProjectId` and `projectBaselineHash`. No baseline is stored: an untitled session is compared against the default, which is exactly what New just installed, so it starts clean. The tab and layer are not reset — the user stays where they were. |
| **Open** | Dirty guard. Stop playback and cut voice tails (below). Read the body from `projects`, validate it (below), apply the content set to the store in **one** `set()`, apply the *reset rules for excluded fields* (below), set `currentProjectId` to the project's `id`, take a fresh baseline. Close the modal. |
| **Save** | With a `currentProjectId`: write back silently — same `id`, same `createdAt`, `updatedAt = now`, name unchanged; take a fresh baseline. With none: behaves as *Save As* and prompts for a name. |
| **Save as new copy** | Always mints a new `id` and a new `createdAt`, prompts for a name (pre-filled with `"<current name> copy"`), writes a new record, and makes the new project current. Never overwrites the source. |
| **Rename** | Inline on the list row — click the name and edit in place, no separate modal. Commit on Enter or blur, cancel on Escape. Writes both stores; bumps `updatedAt`. Renaming the current project updates the name shown in the modal's session section. Renaming does **not** clear or set dirty: the name is envelope, not content. |
| **Delete** | Confirmation dialog naming the project. Removes from both stores. If it was the current project, clear `currentProjectId` and mark the session dirty (its work is now stored nowhere), but **leave the live session's content exactly as it is** — deleting a stored project must never wipe what is on screen. The session then behaves as an unsaved session: a subsequent `Save` prompts for a name and creates a new record. |
| **Export (row)** | Writes **that stored project's saved snapshot** — read straight from `projects`, no live state involved. Filename from the project name (slugified) plus `.solna`. |
| **Export current session** | Writes **live on-screen state, including unsaved edits**. Builds a project body from the live store; uses `currentProjectId`/`name`/`createdAt` when there is a current project, otherwise mints a fresh `id`, a `createdAt` of now, and prompts for a name. `updatedAt = now`. Does **not** save to IndexedDB and does **not** clear dirty. |
| **Import** | File picker (`.solna`, `.json`). Parse and validate. If a project with the same `id` already exists → the id-conflict dialog (Overwrite / Import as Copy / Cancel), showing both `updatedAt` timestamps so the user can tell which is newer. Non-matching `id` → add to the list. Either way — Overwrite or Copy or new — **import then opens the project**, with the dirty guard applied before anything is written. "Import as Copy" mints a new `id` and appends " (imported)" to the name. Opening after an import goes through the *same* Open path, including the reset rules — it does not have its own. |

The two export actions differ, and the UI must make the difference obvious: a row's `Export`
is *the file as saved*; the bottom `Export current session` is *what you are hearing right
now*. A user with unsaved edits who exports the row gets the older music, and that must not
be a surprise.

### Reset rules for excluded fields

Excluding a field from the file does **not** make it empty when a project is opened — it makes
it retain the *previous session's* value. That is a real hazard, and the answer is not the
same for every excluded field. These rules apply to **Open, New, and import-then-open alike**;
those three lifecycle rows point here rather than restating them, so the three paths can never
drift apart.

| Field | On Open / New / import-then-open | Why |
| --- | --- | --- |
| `selectedVibeId` | **Reset to `null`.** | Carrying it over is actively wrong: the vibe chip would stay lit pointing at whatever was selected before, misrepresenting the project just opened as "this is Boom Bap" when its music came from somewhere else entirely. A project has no vibe unless the user presses a chip after opening it. |
| `activeLoopId` | **Reset to the first loop's id** (`loops[0].id`). | Not stored, so it would otherwise point at a loop id from the previous project — usually not present in the new `loops[]` at all. This matches what rehydration already does: `sanitizePersistedState` in `src/store/store.ts` pins `activeLoopId` to `loops[0].id` whenever the stored value is not a string or names no existing loop, and `merge` then resolves `loops.find(l => l.id === activeId) ?? loops[0]` before calling `loopStatePatch`. Open must use the same resolution, not a second one. |
| `controlTarget` | **Carried over — deliberately not reset.** | Which synth the knobs are pointed at is a user preference with no per-project meaning. Resetting it would yank the view for no reason. Intentional; do not "fix". |
| `metronomeActive` | **Carried over — deliberately not reset.** | Same reasoning: a click-track preference belongs to the person, not the project. Intentional; do not "fix". |

**The flat per-loop keys.** The top-level copies of `LOOP_FLAT_KEYS` in the live store are the
working copy of the active loop. They need no separate reset rule *provided* Open writes them
through the existing `loopStatePatch(activeLoop)` path in the same `set()` that installs
`loops`, exactly as `merge` does. Writing `loops` without that patch would leave the previous
project's sound on screen and in the engine — the single worst carryover in this feature.

**Playback is stopped first.** `sequencerPlayer` / `chordsPlayer` / `leadPlayer`,
`playheadBeat`, `playheadChordIndex`, `playheadChordStartBeat`, `songLoopIndex` and
`playbackScope` are all transient, and a session that is *playing* when a project is opened
would keep playing straight through the swap — new chords, new patterns, mid-bar, against a
playhead measured from the old arrangement. Open and New therefore stop the transport before
touching content — and **cut the voice tails immediately**, not just `hardStopAll()`. A
`hardStopAll()` alone lets the old project's release and reverb tails ring into the new one;
a project switch must be a clean slate.

Match `loadLoop`'s default path in `src/store/loadLoop.ts` exactly, in this order:

1. `store.hardStopAll()` (line 79) — dispatches `stop-all` through `playbackScopeReducer`,
   which is what resets `playbackScope`; never write `SCOPE_NONE` directly (the reducer's
   frozen singletons are reference-compared by `songMode`'s subscription).
2. `audioEngine.stopSource('chord', LOAD_LOOP_RELEASE)` then
   `audioEngine.stopSource('bass', LOAD_LOOP_RELEASE)` (lines 80–81; `LOAD_LOOP_RELEASE` is
   `0.02`, the same clickless release the vibe swap and hard stop use). `loadLoop` cuts only
   these two explicitly — the `'synth'` bus is cut by the playback hooks reacting to the
   stop, per the docblock at the top of that file — and Open/New do the same; reuse the
   exported constant rather than a second literal.
3. Only then the single `setState` that installs the content set and the reset rules.

The ordering is load-bearing: the cuts run **synchronously before** the `setState`, so they
cannot race `engineSync`'s subscriptions, which fire on the state change and would otherwise
re-apply the incoming loop's params while outgoing voices are still queued. `loadLoop` restarts
whichever players were active after its `setState`; Open and New deliberately do **not** — a
freshly opened project starts stopped.

`src/store/` importing `audio/engine` is allowed by the layer rules (`loadLoop.ts` already
does; only `components/` may not). The Project Manager component must still not call the
engine itself — it calls the store action, which does.

**Everything else in `uiSlice` is carried over**, on the same reasoning as `controlTarget`:
`activeTab`, `keyboardMode`, `isInputPanelOpen`, `inputPanelMode` and the MIDI fields are
input and view preferences. They are already transient and already absent from `partialize`.

## Dirty detection

**What is compared.** Only the content set — `bpm`, `meterId`, `masterVolume`, `effects`,
`loops[]`. Nothing else. Switching tabs, switching layer, changing `controlTarget`, selecting
a different loop to edit, toggling the metronome, or pressing a vibe chip without changing the
music never marks the project dirty.

**The baseline.** A fresh baseline is taken on open, on save and on save-as-copy. It is
stored as a **fingerprint string**, not as a second copy of the content:

- The fingerprint is built by serialising the content set through an **explicit ordered key
  list** (the content field order above, and `LOOP_FLAT_KEYS` order within each loop) so it
  is stable regardless of object key insertion order, then hashing that string to a short
  token.
- **An untitled session (`currentProjectId === null`) has no stored baseline.**
  `projectBaselineHash` is `null`, and the comparison target is *derived*: the fingerprint of
  the **fresh default project**. That is the content a brand-new session holds — one
  `createDefaultLoop()` (`src/store/loopSlice.ts`) in `loops`, `bpm: 120`,
  `meterId: DEFAULT_METER_ID` and `masterVolume: 0.85` (the `transportSlice` initial values),
  and `INITIAL_EFFECTS` (`src/store/initialState.ts`). Introduce one
  `defaultProjectContent()` that composes exactly those existing constants; **New must reset
  through the same function**, so a session straight after New is never dirty, and the
  default fingerprint can be computed once and cached for the session.
  *Why measure against the default and not against a baseline seeded at migration time:*
  seeding from whatever content exists after the v8→v9 migration creates a data-loss path.
  A user who upgrades with weeks of unsaved work and then imports a `.solna` file would get
  no dirty-guard prompt (nothing changed since the seed) and the import would silently
  replace their work. Measuring against the default gives the honest answer in every case —
  a fresh user starts at default, so not dirty and no badge; an upgraded user with real work
  is dirty until they Save, which is both true and a one-time nudge to save; Import, Open and
  New always prompt before discarding untitled work.
- Rejected alternative: storing the whole baseline content object. It would double the
  persisted payload — and `persist` runs `partialize` + `JSON.stringify` over the whole
  persisted slice **on every `set()`**, so a second copy of `loops[]` would double that cost
  on every single store write, for a value that is only ever compared.

**The performance constraint — this is the part that will bite.** Dirty detection MUST NOT
run per `set()`. From CLAUDE.md: `persist` re-serialises on every `set()` that touches a
partialized key, and anything driven by a pointer, a clock tick or an animation frame must
not write persisted state directly. A knob drag is 60–120 `set()` calls per second; computing
a fingerprint over the whole project on each one would serialise the entire arrangement
hundreds of times per drag, on the main thread the audio scheduler runs on.

Therefore:

- The check is **debounced into an idle callback**, using the same shape as
  `src/utils/coalescedStorage.ts`: `requestIdleCallback` with a timeout, falling back to
  `setTimeout` where idle callbacks are unavailable (Safari < 16.4 and every non-browser
  runtime), and a `cancel` that matches the scheduler it used — mixing an idle handle with
  `clearTimeout` silently fails to cancel.
- Reuse `WriteScheduler` / `idleWriteScheduler` from `coalescedStorage.ts` rather than
  writing a second scheduler; export the check's scheduler as an injectable parameter so
  tests can drive it synchronously.
- The recomputation is triggered by a `subscribeWithSelector` subscription over the content
  keys only, which sets a "recheck pending" flag and schedules one idle pass. Many `set()`s
  inside one idle window collapse to one fingerprint computation.
- `dirty` itself is a single boolean in the store. It only ever changes value at the end of
  an idle pass, so it re-renders subscribers at most once per idle window.
- Once `dirty` is `true`, the pass may early-out and stop rescheduling until the next
  baseline is taken — the only things that can clear it are a save or an open (which store a
  baseline) and New (which restores the default the untitled comparison already targets).

**Interaction with `pagehide`.** The dirty flag and `currentProjectId` are persisted, so they
must be flushed with everything else. `flushPersistedWrites()` already runs on `pagehide` and
on the hidden `visibilitychange`; the dirty pass must also be forced to run synchronously
just before that flush, or a tab killed mid-window would persist a stale `dirty: false`.

## Persist migration v8 → v9

Required. The working buffer must carry the project identity, or a killed tab comes back not
knowing which project was open and `Save` would silently create a duplicate.

Two new persisted fields, added to `partializeAppState` and to `PersistedState`:

- `currentProjectId: string | null`
- `projectBaselineHash: string | null` — the fingerprint described above; `null` whenever
  `currentProjectId` is `null`.

**v9 does not seed a baseline.** The migration step sets both fields to `null` and nothing
else; it must not fingerprint the migrated content and store it. An untitled session's
comparison target is derived from the default project at check time, never stored — see
*Dirty detection* for why seeding here would be a data-loss path.

Both are short scalars, so adding them to `partialize` costs nothing measurable per `set()`.
The project's `name` is **not** persisted separately; it is read from `projectMeta` when the
Project Manager opens, and held in transient state for the header badge. (If the database is
unavailable, the session section shows "Unnamed project" when a `currentProjectId` is set and
"Unsaved session" when it is not — an acceptable degradation, and
strictly better than persisting a name that can drift from the stored record after a rename
in another tab.)

Follow the existing linear pattern in `src/store/store.ts` / `src/store/migrate.ts`:

1. Bump `version` to `9`.
2. Add a `migrateAddProjectIdentity(payload)` step to `src/store/migrate.ts` that defaults
   both fields to `null`.
3. Wire it into the `migrate` chain as the last step, gated `version >= 9 ? payload : …`,
   composed after the v8 `backfillLeadWindow` step exactly as `windowed` composes after
   `looped`. The chain must stay linear and each step must be a no-op on an already-current
   payload.
4. Extend `sanitizePersistedState` so a non-string `currentProjectId` /
   `projectBaselineHash` is coerced to `null` rather than reaching the store — the same
   discipline every other persisted key already gets.

A v9 payload whose `currentProjectId` names a project that no longer exists in IndexedDB (or
whose database is unavailable) resolves to "unsaved session" on first Project Manager open;
this is a lookup miss, not an error, and must not produce a dialog.

## UI surface

### Entry point: the Wordmark becomes the button

`src/components/ui/Wordmark.tsx` is today a presentational `<span>`, and
`src/components/Header.tsx` is its only consumer. It renders in the brand group, outside both
layer conditionals, so it is present in the `loop` layer and the `song` layer alike — which is
**required**, because a project spans the whole app and Save must not depend on which layer is
showing.

Required changes:

- Wrap the mark in a real `<button type="button">` (not a `div` with `onClick`), so keyboard
  focus, Enter/Space activation and screen-reader semantics come for free.
- `aria-label="Open Project Manager"`.
- A **visible hover and focus affordance** — it has none today, and a clickable logo is not
  self-evident. At minimum a hover background/ring and a `focus-visible` ring using the
  existing theme tokens (see `.claude/rules/theming.md`; no raw colours).
- A **dirty-state dot badge** on the mark: a small dot in a corner of the logo, shown only
  when `dirty` is true, with an accessible label ("Unsaved changes") so it is not colour-only
  information.
- A **tap target of at least 44px** in both dimensions. The mark image is `h-8 w-8` (32px)
  and the "solna" text is `hidden` below the `sm` breakpoint, so on a phone the button is a
  32px square unless padding is added. Pad the button, not the image.
- Keep the `markOnly` / `className` / `textClassName` props working; the button wrapper is
  additive, and `Header.tsx`'s `textClassName="hidden sm:inline"` must keep behaving
  identically (below `sm` the wordmark text costs ~74px, which is exactly what pushes the
  header into a third row on a phone).

This is the **sole entry point to the entire feature**. A mis-hit here is costlier than on any
other button in the header — there is no second path to Save, Open or Export — which is why
the target size and the affordance are requirements, not polish.

### Project Manager modal

daisyUI `<dialog className="modal modal-open">` with a `modal-box` and a
`<form method="dialog" className="modal-backdrop">`, matching
`src/components/ui/MidiSettingsModal.tsx`. Its open flag belongs in `uiSlice` alongside
`isMidiSettingsOpen`, and like every other `uiSlice` field it is **transient** — not in
`partialize`.

Sections, in this order:

1. **Current session** — the project name (or "Unsaved session" when there is no
   `currentProjectId`), the dirty state, and three
   actions: `Save`, `Save as new copy`, `New`.
2. **Import** — a button opening the file picker; a hidden
   `<input type="file" accept=".solna,.json">`, the pattern already used by the preset
   libraries.
3. **Project list** — the stored projects, most recently updated first.
4. **`Export current session`** — at the bottom, visually separated from the list so it is
   not confused with a row's `Export`.

### List row

- **Name**, editable **inline** — click the name and edit in place. No separate rename modal.
- **Relative updated time** ("2 minutes ago", "yesterday"), with the absolute timestamp in a
  `title`.
- An **indicator** on the row whose `id` matches `currentProjectId` ("Current"), so the user
  can see which project the session belongs to without reading the section above.
- An **`Open`** button — the primary action, always visible.
- An **overflow menu** (kebab) holding **`Export`** and **`Delete`**.

Delete lives in the overflow because it is destructive and does not belong next to a
frequently-hit control; `Open` and `Delete` sitting side by side on a phone row is exactly the
mis-tap that loses a project.

### Dialogs to specify

| Dialog | Content |
| --- | --- |
| **Empty state** | Shown in place of the list when no projects are stored. Explains that the current session is not yet a project and points at `Save`. Import stays available. |
| **Save-As name prompt** | Single text field, pre-filled ("Untitled project", or "<name> copy" for save-as-copy), focused and selected on open. Empty or whitespace-only names are rejected inline. Duplicate names are **allowed** — `id` is the identity, and forcing unique names would be a lie about the data model. |
| **Dirty guard** | Three buttons: `Discard`, `Cancel`, `Save & Continue`. `Cancel` is the default/Escape action. `Save & Continue` runs the full Save path (including the name prompt when there is no `currentProjectId`) and only then proceeds; if that save fails, the original action is abandoned. |
| **Delete confirm** | Names the project and states that this cannot be undone. Destructive styling on the confirm button; `Cancel` is the default action. |
| **Import id conflict** | "A project with this id already exists." Shows both names and both `updatedAt` timestamps, labelled *existing* and *in file*. Buttons: `Overwrite`, `Import as Copy`, `Cancel`. |

## Error and edge cases

| Case | Behaviour |
| --- | --- |
| **IndexedDB unavailable** (private mode, blocked storage, embedded webview) | Degraded mode as described in *Storage design*. The app must keep working with the project list unavailable and must never crash. Every database call is wrapped; a rejection resolves to a typed failure result, never an unhandled rejection. |
| **Quota exceeded on write** | `QuotaExceededError` aborts the transaction, so neither store is half-written. Report it plainly ("There is not enough storage space to save this project"), keep the session and its dirty flag exactly as they were, and suggest exporting to a file or deleting an old project. Never clear dirty on a failed save. |
| **Malformed file** | `JSON.parse` failure, a non-object root, or a missing/wrong-typed envelope field → refuse the whole import with a single message. No partial import, and nothing is written to IndexedDB or to the live session. |
| **`formatVersion` newer than supported** | Refuse: "This project was saved by a newer version of Solna." Do not attempt a best-effort read — the point of a version field is that an unknown future shape may mean something different, not merely more. |
| **`formatVersion` older than current** | Run a format migration chain, separate from the persist migration chain and living in its own module. At v1 the chain is empty; the structure exists so that adding v2 does not require inventing it under pressure. |
| **Content fields wrong-typed** | Reuse the sanitisation `store.ts` already applies to a persisted payload — the `sanitizeLoops` / `sanitizeSynthParams` / `sanitizeEffectsValue` / `clampFinite` family. These must be extracted into a module both persist-hydration and project-import call, not duplicated: a wrong-typed value reaching an engine setter is the exact failure they exist to prevent (`bpm: "fast"` → NaN clock, a string volume → `setTargetAtTime(NaN)`). |
| **`loops` empty or all rows dropped** | Fall back to a single `createDefaultLoop()`, matching `sanitizeLoops`'s existing "empty result means no valid loops" contract. A project can never have zero loops. |
| **A loop references an unknown library id** | Do **not** refuse the import — the file is structurally valid and the id is a soft reference. The existing resolution paths already degrade safely: `chordRhythmId` and `bassPatternId` fall back to the first pattern (`?? RHYTHM_PATTERNS[0]` / `?? BASS_PATTERNS[0]` in `src/components/loop/chord/useChordPlayback.ts`); `soundKit` indexes `DRUM_KITS[...]` in `src/store/engineSync.ts` and yields `undefined`, which `engine.setDrumKit(kit?)` merges into the default kit; and the three `SynthParams.preset` name strings are labels nobody resolves. **Keep the unknown id or name string in the stored loop** rather than rewriting it to a default, and never substitute a different library entry — the reference may become valid again when the file is opened on a build (or a device) that has that pattern, preset or kit, and silently rewriting it destroys that record. See *Library provenance* for the full rule. Surface a non-blocking notice after the import listing the unrecognised references. |
| **Two tabs open on the same device** | Last write wins, as it already does for `localStorage` (see the `coalescedStorage` docblock). No cross-tab reconciliation is in scope. The read-repair rule keeps the two object stores consistent; it does not attempt to merge concurrent edits. |
| **Import while the file picker returns a directory or a zero-byte file** | Treated as a malformed file. |

## Testing

Conventions from `.claude/rules/testing.md`: `bun:test`, **no DOM and no testing-library**, and
two styles — pure-logic tests against exported helpers (preferred) and `renderToString`
substring assertions for markup.

Structure the feature so most of it is pure-logic testable:

- **Serialization** — `buildProjectBody(state)` and `applyProjectBody(body)` are pure
  functions over plain objects, tested without a store: round-trip a body and assert every
  content key survives, and assert that each excluded key (`controlTarget`, `activeLoopId`,
  `metronomeActive`, `selectedVibeId`, `customSynthPresets`, `customChordProgressions`) is
  **absent** from the output. That last assertion is the one that catches an accidental
  `...state` spread later.
- **A pinned key-set test.** Assert the content set's loop keys equal `LOOP_FLAT_KEYS` plus
  `id`/`name`/`repeatCount`, imported from `src/store/loop.ts` and `src/store/types.ts` — so
  adding a per-loop field without deciding whether it belongs in a project fails the suite
  rather than silently shipping a project format that drops it.
- **Reset rules** — a pure `applyProjectBody`-level test: open a body while
  `selectedVibeId` is set and an `activeLoopId` from a foreign project is in place, then
  assert `selectedVibeId === null`, `activeLoopId === loops[0].id`, and that `controlTarget`
  and `metronomeActive` are **unchanged**. The last two assertions are the ones that stop a
  later "tidy-up" from resetting them.
- **Provenance preserved** — round-trip a loop whose `SynthParams.preset`, `chordRhythmId`,
  `bassPatternId` and `soundKit` all name entries that do not exist, and assert every string
  comes back byte-identical and no substitution happened.
- **Untitled dirty rule** — with `currentProjectId === null` and `projectBaselineHash === null`:
  a store at `defaultProjectContent()` is not dirty; changing one content field makes it
  dirty; a v8 payload carrying non-default content migrates to v9 with `projectBaselineHash`
  still `null` and reports dirty on the first idle pass (the upgrade-with-unsaved-work case).
- **Voice-tail cut ordering** — spy on `audioEngine.stopSource` and the store's `setState`
  and assert the two `stopSource` calls (`'chord'`, `'bass'`, `LOAD_LOOP_RELEASE`) happen
  before the `setState`, and that no `play()` follows — the ordering `loadLoop` uses.
- **Fingerprint stability** — same content in different key insertion orders yields the same
  fingerprint; changing any content field changes it; changing any excluded field does not.
- **Dirty scheduling** — inject a fake `WriteScheduler` (the `coalescedStorage.ts` pattern)
  and assert that N `set()` calls inside one window produce exactly **one** fingerprint
  computation, using a counting spy. This is the performance constraint, so it needs a test,
  not a comment.
- **Validation** — table-driven cases over malformed bodies: bad JSON, missing envelope
  fields, a future `formatVersion`, wrong-typed `bpm`/`effects`/`loops`, an empty `loops`,
  and an unknown `soundKit`/`bassPatternId`/`chordRhythmId` (which must import successfully
  with the id preserved).
- **Persist migration** — a v8 payload migrates to v9 with both new fields `null`; a v9
  payload is unchanged by the step; the whole chain from v1..v8 still terminates in a v9
  shape. Follow the existing migration tests in `src/store/`.
- **IndexedDB** — put the database behind a small interface and test the project-store logic
  against an in-memory fake. Do not try to run real IndexedDB under `bun:test`. Cover the
  unavailable path explicitly: a failing `open()` must resolve to the degraded state, not
  throw, and no call site may leave an unhandled rejection.
- **Storage assertions** — anything asserting on `localStorage` after a store write must call
  `flushPersistedWrites()` first; storage lags the store by up to one idle window.
- **Markup** — `renderToString` on the Wordmark button asserting the `<button>` element, the
  `aria-label`, and the dirty badge's presence/absence. Mind the zustand `getServerSnapshot`
  trap: a component that must reflect state set by a test has to serve `getState()` for both
  snapshots, the way `src/components/ui/BottomInputDock.tsx` does — otherwise the assertion
  silently tests creation-time state.

## Non-goals

Explicitly **out of scope for v1**:

- **The "resolved rendering" layer for foreign readers.** A future export flavour that
  resolves bass chord-relative tokens to concrete pitches, inlines preset rhythm and bass
  patterns and the drum kit rather than referencing them by id, and expresses positions as
  absolute bar numbers. Deferred until murva import work begins, at which point it becomes
  **format v2**. Deferring costs nothing structurally: that layer is *generated at export
  time from live state*, never stored — so adding it later changes only the exporter and adds
  a version, it does not reshape anything already written to disk or to IndexedDB.
- **The murva importer itself.**
- **Any backend, account, sync or sharing link.** Everything is local to the device.
- **Project templates** / starter projects.
- **Autosave to the project store.** Saving is always an explicit user action; the working
  buffer is what protects unsaved work.
- **Undo/redo, project history, or versioned snapshots.**
- **Cross-tab reconciliation** beyond the existing last-write-wins behaviour.
- **Progression provenance.** Chord progressions have no provenance field, and this is
  deferred by decision rather than overlooked. `Loop.chords` is `ChordItem[]` holding concrete
  resolved voicings (`notes: string[]`), and `Loop` carries no progression-id field — the
  `chordPresetId` / `progressionId` fields in `src/types.ts` belong to the Instant Vibes
  reference tables, not to a loop. So a project records *which chords*, never *which library
  progression they came from*. Adding `chordProgressionId?: string` to `Loop` (plus its own
  persist migration) is a possible separate change; it affects the "based on" label only,
  never audio fidelity, since the voicings are already stored inline.
- **Bundling the user's preset or progression libraries into a project** — per-library export
  already exists, and the rationale for keeping them out is recorded above.
