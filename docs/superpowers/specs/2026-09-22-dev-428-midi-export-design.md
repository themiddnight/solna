# MIDI export (Standard MIDI File) — design

**Issue:** DEV-428 "feat: MIDI export (Standard MIDI File)".
**Branch:** `feat/dev-428-midi-export`.
**Status:** Draft for review (2026-09-22). Every open question from the brief is decided here with
a recommendation and one rejected alternative; §12 lists them one per line for a quick veto.

**User-visible change:** the Export dialog gains a second row, "Export MIDI (.mid)". It downloads
`<project-slug>.mid`: a format-1 Standard MIDI File with a conductor track and one track per lane
(Chord, Bass, Pad, Lead, FX, Beat). The WAV export is unchanged.

---

## 0. Verified facts (checked against the code on this branch)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| F1 | The song timeline yields performed events, not intent: arp, chord rhythm, strum spread, feel and full holds are already resolved | True | `plan/songTimeline.ts` `walkChordStep` calls `planChordStep` (arp + rhythm) and `stepNoteWindow` (`timeOffset` = strum), `walkMelodyStep` calls `planMelodyStep` (Lead/FX arp, gate) |
| F2 | Timeline events are in **seconds**, notes carry a ROOTS-spelled `noteName`, drums carry `voice` and no end | True | `TimelineEvent` in `songTimeline.ts`: note `{track, loopIndex, noteName, velocity, startSec, endSec}`, drum `{loopIndex, voice, velocity, timeSec}` |
| F3 | Tempo and meter are song-wide, not per loop | True | `MixdownSnapshot.bpm`, `.meterId`, `.stepsPerBar`; `MixdownLoop` has neither |
| F4 | Key is per loop and can change at a pass boundary; scale types include modes, pentatonics, Blues and Hirajoshi | True | `MixdownLoop.scaleRoot/scaleType`; `src/data/scales.ts` |
| F5 | Velocities are linear 0..1 (`DEFAULT_VELOCITY` 0.8, `ARP_VELOCITY` 0.9, full holds scaled by `equalPowerVelocityScale`) | True | `audio/constants.ts`, `plan/chordEvents.ts`; `midiInput.ts` maps the other way as `velocity / 127` |
| F6 | The grid is 16ths (`stepsPerBar` 12..24), Lead/FX store at 1/32 (`TICKS_PER_SIXTEENTH` = 2); arp rates are `4n 8n 16n 32n`, no triplets; strum and feel add arbitrary sub-step offsets in seconds | True | `utils/meter.ts` `METERS`, `utils/stepResolution.ts`, `types/synth.ts` `ArpSettings.rate`, `chordEvents.ts` `timeOffset` |
| F7 | BPM is quarter-note BPM in every meter (a 16th is `60/bpm/4` s, 6/8 is 12 sixteenths) | True | `stepDurationSec` → `sixteenthNoteMs(bpm)`; `METERS['6/8'].stepsPerBar = 12` |
| F8 | The WAV honours **mute, never solo**: solo is session-only and never enters the snapshot | True | `store/mixdownSnapshot.ts` ("The raw mute flag, NOT isTrackAudible"); `walkStep` comment; R161 |
| F9 | In the WAV, a lane's audibility in a pass is decided by **that loop's** bus row: `applyLoopAudioState` sets every source at each pass start, overriding the song-level `snapshot.buses` set at t=0 | True | `renderMixdown.ts` `applyMasterState` then `planLoopAudioAutomation` / `applyLoopAudioState` (first pass at time 0, `'settle'`) |
| F10 | Per-voice drum mute is applied inside `planBeatStep`; per-voice level arrives as `beatVoiceGains` with mute folded in as 0 | True | `plan/beatPlan.ts`, `mixdownSnapshot.ts`, R162 |
| F11 | Note name → MIDI number exists in Music Core: `noteMidi(name): number \| null` | True | `musicCore/tonalAdapter.ts`, re-exported by `@/musicCore`; `noteFrequency` is built on it and falls back to 440 Hz for `null` |
| F12 | A new kind is one `ExportKindSpec`; `ExportProgress`/`ExportFailureReason` reuse the renderer's types; `failureMessages` is a `Record` over every non-cancelled reason, `unsupported-context` included | True | `store/exportKinds.ts`, R293/R294 |
| F13 | `reportOperationFailure` accepts only `'boot' \| 'mixdown' \| 'project-load' \| 'project-save'` | True | `incidents/operationFailure.ts` `ReportableOperation` |
| F14 | `yieldPreservingRandomStream` lives in `renderMixdown.ts`, which imports `createRenderEngine` from `../engine` | True | `renderMixdown.ts` lines 30, 99 — a MIDI module importing it would pull the engine module into its graph |
| F15 | No GM drum map exists. ADR-0016 records that external MIDI input is not focus-aware because the app "does not have" one; a `src/data/drumGmNotes.ts` was designed in the focus-track spec (2026-09-10) but never built | True | grep `GM`; `docs/decisions/0016-*.md` |
| F16 | `bell` is an 808 cowbell circuit, not a ride bell | True | `audio/drumSynth.ts` ("cowbell is exactly this circuit") |
| F17 | `slugifyProjectName` keeps `[a-z0-9-]` only, falls back to `project` | True | `utils/projectFileIO.ts` |

---

## 1. Goal

Export the arrangement as a Standard MIDI File built from the pure song timeline (DEV-420),
registered as an export kind (DEV-421). No `AudioContext`, no engine: the MIDI kind runs where
`OfflineAudioContext` does not exist.

## 2. Non-goals

- MIDI import. Synth patches, FX, bus levels or pan as CC, program change or SysEx.
- Key-signature, marker or lyric meta events (§5.4).
- Making arp `'random'` notes equal the WAV's (§9, Risk R2).
- A focus-aware external MIDI input (ADR-0016's open item) — the GM map added here could serve it
  later, but that is a separate issue.

---

## 3. Module layout

| File | Change |
|---|---|
| `src/audio/export/smfWriter.ts` | **New.** Pure SMF byte encoder: types `SmfFile`/`SmfTrack`/`SmfEvent`, `encodeSmf(file): Uint8Array`, `writeVlq`. Knows the file format, nothing about songs |
| `src/audio/export/renderMidi.ts` | **New.** Song → SMF: `MIDI_PPQ`, `MIDI_LANES`, `GM_DRUM_NOTE`, `MIDI_TIME_SIGNATURE`, `midiVelocity`, `secondsToTicks`, `eventAudible`, `resolveNoteOverlaps`, `songMidiFile`, and the async `renderMidi(song, title, onProgress, signal)` |
| `src/audio/rng.ts` | Receives `yieldPreservingRandomStream` (+ private `yieldToMainThread`) moved verbatim from `renderMixdown.ts` (F14), so `renderMidi.ts` never imports the renderer or the engine. Its docblock's caller count is updated |
| `src/audio/export/renderMixdown.ts` | Imports `yieldPreservingRandomStream` from `../rng`; otherwise untouched |
| `src/audio/export/renderMixdownRngIsolation.test.ts` | Import path only |
| `src/store/exportKinds.ts` | `ExportKindId` gains `'midi'`; adds `MIDI_FAILURE_MESSAGE`, `midiFileName`, `MIDI_EXPORT` spec; one row in `EXPORT_KIND_BY_ID` after `'mixdown-wav'` |
| `src/incidents/operationFailure.ts` | `ReportableOperation` gains `'midi-export'` |
| Tests | `smfWriter.test.ts`, `renderMidi.test.ts`, a test-only `smfTestReader.ts` beside them (§10), `exportKinds.test.ts` rows |

Nothing in `exportJob.ts`, `exportSlice.ts`, `Header.tsx`, `src/components/export/`, `plan/` or
`mixdownSnapshot.ts` changes (R293). The snapshot the job captures (`buildMixdownSnapshot`) is
already what MIDI needs.

**Placement.** The writer and the lane tables are used by one feature, so they stay with it
(R276) in `src/audio/export/`, beside the other renderer and one import away from the timeline
(`audio/` may import `plan/`; the store may import `audio/export/`, ADR-0035).
*Rejected:* `src/utils/smf.ts` — one consumer; lift it the day a second one (stems metadata,
MIDI input) appears.

---

## 4. Types (exact)

### 4.1 `smfWriter.ts`

```ts
export type SmfEvent =
  | { tick: number; kind: 'noteOn'; channel: number; note: number; velocity: number } // channel = wire 0..15
  | { tick: number; kind: 'noteOff'; channel: number; note: number }                  // written 0x8n, release vel 64
  | { tick: number; kind: 'meta'; type: number; data: Uint8Array };                   // FF type len data

export interface SmfTrack { events: SmfEvent[]; endTick: number } // absolute ticks, any order
export interface SmfFile { ppq: number; tracks: SmfTrack[] }     // always format 1

export function writeVlq(value: number): number[];               // 0..0x0FFFFFFF, throws outside
export function encodeSmf(file: SmfFile): Uint8Array;
```

`encodeSmf` writes `MThd` (length 6, format 1, `tracks.length`, `ppq`), then one `MTrk` per track:
events stably sorted by `(tick, rank)` with rank meta 0 < noteOff 1 < noteOn 2, delta-time VLQs,
**no running status**, and `FF 2F 00` at `max(endTick, last event tick)`. It throws on a value
out of range (channel, note, velocity 1..127, negative tick) — a thrown writer is a
`render-failed` (§8), never a silently corrupt file.

### 4.2 `renderMidi.ts`

```ts
export const MIDI_PPQ = 480;

export type MidiLane = SongTrack | 'beat';
/** Track order, track name and wire channel; a test asserts it covers every SongTrack plus 'beat' once. */
export const MIDI_LANES: readonly { lane: MidiLane; name: string; channel: number }[];
/** GM percussion key per Beat voice (§6). Record<BeatVoiceId, number>. */
export const GM_DRUM_NOTE: Readonly<Record<BeatVoiceId, number>>;
/** FF 58 fields per meter. Record<MeterId, …>: no meter string is parsed. */
export const MIDI_TIME_SIGNATURE: Readonly<Record<MeterId, { numerator: number; denominatorPow2: number; clocksPerClick: number }>>;

export interface MidiNote { lane: MidiLane; channel: number; note: number; velocity: number; startTick: number; endTick: number }

export function secondsToTicks(sec: number, bpm: number): number; // Math.round(sec * bpm / 60 * MIDI_PPQ)
export function midiVelocity(v: number): number | null;            // null if v <= 0, else clamp(round(v*127), 1, 127)
export function eventAudible(snapshot: MixdownSnapshot, e: TimelineEvent): boolean; // §7
export function resolveNoteOverlaps(notes: MidiNote[]): MidiNote[];                 // §5.3
export function songMidiFile(snapshot: MixdownSnapshot, notes: MidiNote[], title: string): SmfFile;

export type MidiRenderResult = { ok: true; blob: Blob } | { ok: false; reason: MixdownFailureReason };
export function renderMidi(
  snapshot: MixdownSnapshot, title: string,
  onProgress?: MixdownProgressReporter, signal?: AbortSignal,
): Promise<MidiRenderResult>;
```

`MixdownFailureReason` and `MixdownProgressReporter` are imported **as types** from
`./renderMixdown` (erased; no runtime edge to the engine). `renderMidi` never throws: a caught
error is `{ kind: 'render-failed', detail }`, exactly like `renderMixdown`.

---

## 5. The file

### 5.1 Layout — format 1, PPQ 480

| Track | Content |
|---|---|
| 0 conductor | `FF 03` title, `FF 58` time signature, `FF 51` tempo — all at tick 0; EOT at song end |
| 1..6 lanes | `FF 03` lane name at tick 0, then the lane's notes on its channel; EOT at `max(song end, last note-off)` |

Song end = `totalSteps × MIDI_PPQ / 4` (a step is a 16th, F7). Every lane track is always
written, even when empty, so track N is always the same lane and channel in every file.
*Rejected:* omitting empty tracks — the track↔lane mapping would shift with content, and a DAW
template built on one export would misroute the next.

**Format 1** because a DAW imports it as named per-lane tracks with a shared tempo map.
*Rejected:* format 0 (one track, channels only) — the importer must split it and the lane names
are lost.

**PPQ 480.** A 16th is 120 ticks, the Lead/FX 1/32 cell 60, a triplet 16th 80 — every grid
position the app can emit (F6) is an exact integer; a tick is 1.04 ms at 120 BPM, so strum and
feel offsets round by at most ~0.5 ms. *Rejected:* 96 — the 1/32 cell is
12 ticks and strum offsets quantise to ~5 ms at 120 BPM, audibly flamming a strum.

### 5.2 Tempo, meter, title

- `FF 51 03 tt tt tt` with `Math.round(60_000_000 / bpm)` µs per quarter (BPM is quarter-note
  BPM in every meter, F7). One tempo event: tempo is song-wide (F3).
- `FF 58 04 nn dd cc 08` from `MIDI_TIME_SIGNATURE[meterId]`: `4/4 3/4 5/4` → cc 24;
  `6/8 12/8` → cc 36 (dotted-quarter click, matching `accentGroups` of 6); `7/8` → cc 12
  (eighth click; its groups are irregular). One event: meter is song-wide.
- Title `FF 03` = the project name, or `Solna` when null, UTF-8 encoded (`TextEncoder`).
  `FF 03` has no declared charset; UTF-8 round-trips in every DAW that reads it as bytes, and a
  Thai name is then garbled only in a DAW that assumes Latin-1 — never a broken file.

### 5.3 Notes

- **Performed, not intent.** Every `note` and `drum` item of `walkSongTimeline` becomes at most
  one `MidiNote`; nothing re-derives an arp, a chord rhythm, a strum or a hold (F1). This is the
  same walk the WAV performs, so the MIDI and the audio cannot disagree about what plays when.
- **Timing.** `startTick = secondsToTicks(startSec)`, `endTick = max(startTick + 1,
  secondsToTicks(endSec))`. The timeline's `endSec` is the gate/hold-clipped note-off
  (`stepNoteWindow`, melody `holdSec`, full-hold `holdSec`); the synth release tail is a patch
  property and is not added. A drum lasts one 16th (`MIDI_PPQ / 4` ticks): drums have no end in
  the timeline (F2), GM percussion ignores note length, and a step-long note reads correctly in a
  piano roll.
- **Velocity.** `midiVelocity(v) = clamp(round(v × 127), 1, 127)`; `v ≤ 0` drops the note (it is
  silent in the WAV, and a note-on at velocity 0 is a note-off in MIDI). Linear, because the
  engine's velocity is linear 0..1 and `midiInput` already maps `velocity / 127` inbound (F5), so
  a note played in and exported out round-trips. 0.8 → 102, 0.9 → 114.
- **Overlap on one channel and pitch** (`resolveNoteOverlaps`, per `(channel, note)`, sorted by
  start): two notes starting on the same tick merge into one (max velocity, max end); a note
  starting before the previous one ends cuts the previous one at the new start. Result: no
  channel ever has two sounding instances of one pitch, and at equal ticks the note-off is
  written first (§4.1 rank). *Rejected:* emitting both and letting the receiver pair note-offs —
  DAWs pair them FIFO or LIFO inconsistently, so the same file would import with different
  lengths in different hosts.

### 5.4 Key changes — no key-signature meta

Solna's keys include Dorian, Mixolydian, Lydian, Phrygian, pentatonics, Blues and Hirajoshi (F4):
`FF 59` can only say "n sharps/flats, major/minor", so for most scales it would be a guess, and
choosing sharps vs flats is a spelling decision, which is display-only (R064) and not something
Music Core offers as an identity. Notes are pitch numbers, so nothing is lost musically.
*Rejected:* one `FF 59` per pass for Major/Natural Minor only — a file that carries a key for
some loops and silently not others misleads more than one that carries none.

---

## 6. Channels and the GM drum map

| Track | Lane | Name | Channel (1-based / wire) |
|---|---|---|---|
| 1 | `chord` | Chord | 1 / 0 |
| 2 | `bass` | Bass | 2 / 1 |
| 3 | `pad` | Pad | 3 / 2 |
| 4 | `lead` | Lead | 4 / 3 |
| 5 | `fx` | FX | 5 / 4 |
| 6 | `beat` | Beat | 10 / 9 (`GM_DRUM_CHANNEL = 9 // GM channel 10, zero-based on the wire`) |

Lane order is `SongTrack`'s declaration order, then Beat. No program change: a GM program would
claim a sound mapping the app does not have (patches are out of scope); the DAW assigns
instruments. *Rejected:* a fixed GM program per lane (e.g. Bass → 34) — it pretends a patch
export and is wrong for most loops.

`GM_DRUM_NOTE` (channel 10), a `Record<BeatVoiceId, number>` so a new Beat voice is a compile
error (R103 order):

| kick | snare | rimshot | clap | hihat | openhat | hitom | lowtom | ride | crash | bell |
|---|---|---|---|---|---|---|---|---|---|---|
| 36 | 38 | 37 | 39 | 42 | 46 | 48 | 45 | 51 | 49 | 56 |

`bell` is Cowbell 56, not Ride Bell 53, because the voice is an 808 cowbell circuit (F16); toms
48/45 follow the never-built focus-track table (F15).

**Layer.** The map lives in `renderMidi.ts`, not `src/data/`. `data/` holds factory content only
(R021) and registries stay with the code that reads them (R027); a GM key table is a format
constant with one reader. *Rejected:* `src/data/drumGmNotes.ts` as the focus-track spec proposed —
it is not factory content, and moving it later (when MIDI input needs it) is a lift to a shared
location per R276, not a reason to pre-place it.

---

## 7. Which events are exported — mute yes, solo never

A timeline event is exported iff the WAV would make it audible **by routing** (`eventAudible`):

- note: the event's loop bus row for `songTrackVoice(loop, track).source` has `!muted && gain > 0`;
- drum: the loop's `'sequencer'` bus row passes the same test **and** the voice's
  `beatVoiceGains` entry has `gain > 0` (per-voice mute is folded into it, and already skips hits
  inside `planBeatStep`, F10).

The loop's own bus row decides, per pass — that is what the WAV does (F9); the song-level
`snapshot.buses` is not consulted. A missing row cannot occur (`buildMixdownSnapshot` maps all of
`SOURCE_BUSES`) and is treated as audible. Solo never reaches the snapshot (F8), so it cannot
reach the MIDI. Levels do not scale velocity: mix is out of scope like patches.

*Rejected:* export every lane with content regardless of mute — the WAV and the MIDI of one
project would then disagree about which parts exist, and mute is arrangement intent that the
mixdown deliberately exports. *Also rejected:* mute flags only — a fader pulled to the bottom
(`faderDbToGain` → exactly 0) is silent in the WAV, and the rule "the MIDI holds what the WAV
plays" would then have an exception.

---

## 8. Runtime: progress, cancel, the kind

`renderMidi(snapshot, title, onProgress, signal)`:

1. Aborted → `cancelled`. `loops.length === 0` → `empty-arrangement`. `report({phase:'preparing'})`.
2. Inside `withSeededRandom(MIXDOWN_SEED, …)`: consume `walkSongTimeline(snapshot, planArrangement(snapshot))`
   item by item; for `note`/`drum` apply `eventAudible`, `noteMidi` / `GM_DRUM_NOTE`,
   `midiVelocity`, `secondsToTicks`; on every 200th `stepEnd` report
   `{phase:'rendering', percent: floor(100·step/totalSteps)}`, `await yieldPreservingRandomStream()`,
   and return `cancelled` if aborted. Seeding makes two exports byte-identical (arp `'random'`);
   the yield keeps a long song cancellable and the seeded stream isolated from live playback.
3. `report({phase:'encoding'})`, one `setTimeout(0)` yield, abort check, then
   `resolveNoteOverlaps` → `songMidiFile` → `encodeSmf` → `new Blob([bytes], { type: 'audio/midi' })`.

**Note numbers (R176, R051, R064).** The timeline stays one playable-event shape with a
ROOTS-spelled name. Each consumer encodes it at its own boundary: the WAV performer calls
`noteFrequency` (Hz, R176), the MIDI builder calls `noteMidi` from `@/musicCore` (R029). Neither
Hz nor a note number is ever added to `TimelineEvent`, and nothing converts Hz → MIDI. A name for
which `noteMidi` returns `null`, or a number outside 0..127, drops that note: the WAV's 440 Hz
fallback is a live-audio safety net, not musical intent. Sanitized content cannot produce one; a
test pins the drop.

**The kind** (`exportKinds.ts`):

```ts
const MIDI_EXPORT: ExportKindSpec = {
  id: 'midi',
  label: 'Export MIDI (.mid)',
  progressLabels: { rendering: 'Building MIDI', encoding: 'Writing MIDI file' },
  failureMessages: MIDI_FAILURE_MESSAGE,
  incidentOperation: 'midi-export',
  run: async (snapshot, onProgress, signal) => {
    const rendered = await renderMidi(snapshot.song, snapshot.projectName ?? 'Solna', onProgress, signal);
    if (!rendered.ok) return rendered;
    return { ok: true, blob: rendered.blob, fileName: midiFileName(snapshot.projectName) };
  },
};
export const MIDI_FAILURE_MESSAGE = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
  'unsupported-context': 'This browser cannot write the MIDI file.',        // unreachable; the Record demands it
  'render-failed': 'The MIDI file could not be written. Your project is unchanged; try again.',
};
export function midiFileName(projectName: string | null): string; // `${slugifyProjectName(projectName ?? '')}.mid`
```

The dialog lists it second (table order), as `btn-export-midi`; one job at a time still holds
(R292), so the MIDI row is disabled while a WAV renders and vice versa. Download, notices,
incident and job clearing are the runner's (R294). `.mid` over `.midi`: the extension every DAW's
file filter lists first. MIME `audio/midi` (the de-facto type browsers map `.mid` to).

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Moving `yieldPreservingRandomStream` drifts the WAV | Verbatim move; `renderMixdownGolden` and the RNG-isolation test run unchanged |
| R2 | Arp `'random'` lanes: MIDI notes differ from the WAV's, because the WAV interleaves engine draws (noise offsets, S&H buffers) with the arp's on one seeded stream (DEV-420 F8) | Documented in ADR-0036 and the kind's docblock; the MIDI is deterministic on its own. Matching would need simulating the engine's draws — rejected |
| R3 | Tick rounding shifts a grid note by one tick | Grid positions are exact multiples (§5.1); a test asserts every on-grid event of the fixture lands on `step × 120` |
| R4 | A timeline change silently changes the MIDI | Parse-back equivalence test against `buildSongTimeline` (§10) — it fails on a divergence, not on a planner change |
| R5 | `renderMidi.ts` pulls in the engine | Type-only imports from `renderMixdown.ts` (the `rng.ts` move removes the one runtime need); a test asserts the export runs with no `OfflineAudioContext`/`AudioContext` on `globalThis` |

---

## 10. Testing plan

- **`smfWriter.test.ts` — golden bytes.** `writeVlq` table (0 → `00`, 127 → `7F`, 128 → `81 00`,
  8192 → `C0 00`, 0x0FFFFFFF → `FF FF FF 7F`, throws above). A two-track hand-built `SmfFile`
  encodes to a literal hex string: `MThd` fields, `MTrk` lengths, delta VLQs, sort rank at equal
  ticks, no running status, EOT placement. Throws on channel 16, note 128, velocity 0.
- **`smfTestReader.ts` (test-only).** ~60-line parser: chunks → tracks → absolute-tick events;
  pairs note-on/off per `(channel, note)`. Test code only (Knip-ignored like `mixdownFixture.ts`).
- **`renderMidi.test.ts` — parse-back** on `mixdownFixture` songs:
  - 7 tracks; names `[title, Chord, Bass, Pad, Lead, FX, Beat]`; each lane's notes on its channel,
    Beat on wire 9; conductor tempo `round(6e7/bpm)`; `FF 58` for each of the six `METER_IDS`.
  - **Equivalence:** seeded `buildSongTimeline(snapshot)` filtered by `eventAudible`, mapped
    through `noteMidi`/`GM_DRUM_NOTE`/`midiVelocity`/`secondsToTicks`, equals the parsed notes
    (after the same overlap rule) — the MIDI is the timeline, nothing else.
  - On-grid events land on `step × 120`; Lead 1/32 notes on multiples of 60.
  - Mute: a muted loop bus drops that lane only in that loop's passes; a bus at gain 0 drops it; a
    muted drum voice drops that voice; solo state in the store changes nothing (via
    `buildMixdownSnapshot`).
  - Overlap: same-tick duplicate merges (max velocity); later start cuts the earlier; note-off
    precedes note-on at the shared tick.
  - Velocity: 0.8 → 102, 1.2 → 127, 0.001 → 1, 0 → dropped. Unparseable name → dropped.
  - Determinism: two exports of a random-arp fixture are byte-identical.
  - Runs with no `OfflineAudioContext` on `globalThis`. Cancel: an aborted signal before start and
    at the first yield returns `cancelled`; progress reports `preparing → rendering… → encoding`.
- **`exportKinds.test.ts`:** `midiFileName` (`My Song` → `my-song.mid`, null → `project.mid`),
  blob type `audio/midi`, `EXPORT_KINDS` order `['mixdown-wav', 'midi']`.
- **Dialog:** the existing row-per-kind tests pick up the second row without edits (R293); if a
  test asserted a single row, it is updated to iterate `EXPORT_KINDS`.

---

## 11. Rules, ADR and doc sync (same branch)

ADR-0036 "MIDI export from the song timeline". Rules R296–R300 in `.claude/rules/export.md`
(add `src/audio/export/renderMidi.ts` and `src/audio/export/smfWriter.ts` to its `paths:`):

- **R296** — MIDI export is built only from `walkSongTimeline`; `renderMidi.ts` calls no lane
  planner and re-derives no arp, rhythm, strum or hold.
- **R297** — A timeline event is exported iff the WAV makes it audible by routing: its loop's bus
  row is unmuted with gain > 0 (drums: and the voice's `beatVoiceGains` > 0). Solo never reaches it.
- **R298** — A MIDI note number comes from `noteMidi` (`@/musicCore`) applied to the timeline's
  ROOTS name in `renderMidi.ts`; `TimelineEvent` never carries Hz or a note number, and nothing
  converts Hz to MIDI.
- **R299** — `GM_DRUM_NOTE` and `MIDI_TIME_SIGNATURE` are `Record`s over `BeatVoiceId` and
  `MeterId`; they and `MIDI_LANES` live beside the MIDI builder, not in `src/data/`.
- **R300** — On one channel and pitch at most one note sounds: a same-tick duplicate merges, a
  later start cuts the earlier note; note-offs precede note-ons at equal ticks.

Also: `playback.md` R287's sentence gains "`renderMidi.ts` likewise" (a scope widening — ADR-0036
records it); `rng.ts` docblock caller count; `CLAUDE.md` rules-table row for `export.md` gains
"MIDI export (lanes, channels, GM map)" — no new cross-cutting invariant line;
`docs/architecture/feature-overview.md` export row; `structure/03-audio.md` §1.5 table and §4
(`renderMidi.ts`, `smfWriter.ts`, the `rng.ts` move); `structure/02-store.md` (`exportKinds` has
two kinds). ADR-0016 is not edited; ADR-0036 notes that a GM map now exists and external MIDI
input stays focus-agnostic.

---

## 12. Decisions for user review

1. SMF **format 1**: conductor track (title, tempo, time signature) + one track per lane, all six always written.
2. **PPQ 480** (16th = 120, 1/32 = 60, strum ≤ ~1 ms); one tempo and one time signature, both song-wide.
3. **No key-signature meta** — Solna's modal/exotic scales have no honest `FF 59`; spelling is display-only.
4. Channels: Chord 1, Bass 2, Pad 3, Lead 4, FX 5, Beat 10; **no program change**.
5. GM drum map: kick 36, snare 38, rimshot 37, clap 39, hihat 42, openhat 46, hitom 48, lowtom 45, ride 51, crash 49, **bell 56 (cowbell)**; lives in `renderMidi.ts`, not `src/data/`.
6. Export the **performed** timeline events (arp, rhythm, strum, feel resolved); drums last one 16th.
7. Velocity **linear** `round(v·127)` clamped 1..127; `v ≤ 0` dropped.
8. Note-off = the timeline's clipped `endSec` (no synth release); same-pitch overlap: merge same-tick, cut the earlier.
9. **Honour mute (loop bus, gain 0, drum voice) like the WAV; solo never** — per loop, per pass.
10. Note numbers from `noteMidi` at the MIDI boundary; timeline unchanged; unparseable names dropped.
11. Writer `src/audio/export/smfWriter.ts` + builder `src/audio/export/renderMidi.ts`; `yieldPreservingRandomStream` moves to `rng.ts`.
12. Seeded with `MIXDOWN_SEED` for byte-identical re-exports; arp `'random'` notes may differ from the WAV's (accepted).
13. File `<slug>.mid`, MIME `audio/midi`, label "Export MIDI (.mid)", incident operation `'midi-export'`.
14. Tests: golden bytes for the writer, parse-back + timeline equivalence for the song; no committed hash of a whole-song `.mid`.
15. Conductor title = project name (UTF-8) or `Solna`.

## 13. Acceptance criteria

- The Export dialog shows "Export MIDI (.mid)"; it downloads `<slug>.mid`, which a DAW opens as
  seven tracks with the song's tempo and meter.
- `exportJob.ts`, `exportSlice.ts`, `Header.tsx` and `src/components/export/` are unchanged.
- `renderMixdownGolden` passes unchanged.
- `bun run verify` green; `bun run eslint` zero errors, zero warnings; both Knip scans zero.
