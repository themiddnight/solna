# DEV-428 MIDI Export (Standard MIDI File) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Export dialog gains "Export MIDI (.mid)", which downloads `<slug>.mid`: a format-1 SMF (PPQ 480) with a conductor track and one track per lane (Chord, Bass, Pad, Lead, FX, Beat), built from the pure song timeline with no `AudioContext`.

**Architecture:** Bottom-up. Task 1 moves `yieldPreservingRandomStream` from `renderMixdown.ts` to `rng.ts` so the MIDI module never has a runtime edge to the renderer (and through it the engine). Task 2 adds the song-agnostic SMF byte writer and a test-only parser. Tasks 3–5 build `renderMidi.ts`: pure lane tables and mappers, then the conductor/lane file builder, then the async walk with progress, cancel and seeding. Task 6 registers the `'midi'` kind. Tasks 7–8 sync rules/ADR/docs and run the gate.

**Tech Stack:** TypeScript, Bun test runner (`bun:test`), ESLint flat config + typescript-eslint, Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-22-dev-428-midi-export-design.md` — binding. Read §4 (types), §5 (the file), §6 (channels, GM map), §7 (mute), §8 (runtime) and §10 (tests) before any task. Where this plan corrects the spec it says so under "Spec corrections".

## Global Constraints

- Branch `feat/dev-428-midi-export` (checked out). Never push, never commit on `main`, never switch branches.
- One commit per task. Conventional message with `(DEV-428)`, ending with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **WAV output is byte-identical.** `renderMixdownGolden.test.ts`, `renderMixdownGolden.wav.sha256` and `renderMixdownGolden.calls.json` are never edited; never run with `GOLDEN_UPDATE=1`. `renderMixdown.ts` changes only in Task 1 (the move) and nowhere else.
- `renderMidi.ts` and `smfWriter.ts` never import the engine at runtime: no `../engine`, no `beatAdapter`/`drumSynth`/`masterRack`, and only `import type` from `./renderMixdown`. Task 3 makes ESLint enforce it.
- Music theory only via `@/musicCore` (`noteMidi`), never `tonal` (R029). The timeline is not changed: no Hz or MIDI number is added to `TimelineEvent`, nothing converts Hz → MIDI (R176, R051, R064).
- Nothing in `src/store/exportJob.ts`, `src/store/exportSlice.ts`, `src/components/Header.tsx`, `src/components/export/*.tsx|ts` (non-test), `src/audio/playback/plan/**` or `src/store/mixdownSnapshot.ts` changes (R293).
- Strings verbatim from spec §8: `'Export MIDI (.mid)'`, `'Building MIDI'`, `'Writing MIDI file'`, and the three `MIDI_FAILURE_MESSAGE` sentences (the dash in `'There is nothing to export — …'` is `—`).
- Gates: `bun run verify` is the completion gate (R004). `bun run eslint` prints zero errors and zero warnings — never ignore or call a warning pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>` for a legitimate exception; never relax a rule globally (R005, R264). Both Knip scans zero findings (R006): **export a symbol only if another file (a test counts for `check:dead-code`) imports it**; run `bun run check:dead-code && bun run check:dead-code:production` before every commit from Task 2 on.
- `max-lines-per-function` 100 (applies to `describe` callbacks — split them), `complexity` warns at 20 (a warning fails). `../../` imports banned: `@/…` across folders, `./` within one.
- R001: no counts, versions or line numbers in any doc you write. A rule change updates its `.claude/rules/*.md` file and its ADR in the same commit.
- Large files (`renderMixdown.ts`, `songTimeline.ts`, `eslint.config.js`, structure docs): Serena `find_symbol` / `grep -n` + line ranges, never a whole-file dump.

## Spec corrections (found while verifying the spec against the code)

1. **§3 "`renderMixdown.ts` … otherwise untouched" vs the earlier "byte-unchanged file" rule.** The DEV-420/421 branches kept `renderMixdown.ts` *source* byte-unchanged; the move edits it (one import, two functions removed). Nothing pins the source: the golden reads only its own `.sha256`/`.calls.json` files and pins the rendered WAV bytes and engine call log. A verbatim move keeps the render identical (same generator swap around the same `setTimeout(0)` at the same step), so the golden is the proof. The move is kept; the source-level constraint is retired for this branch and ADR-0036 records it.
2. **§8 snippet order.** `MIDI_EXPORT` references `MIDI_FAILURE_MESSAGE` in an object literal evaluated at module load; declared in the spec's order it is a TDZ `ReferenceError`. Declare `MIDI_FAILURE_MESSAGE` first.
3. **§10 "Dialog: the existing row-per-kind tests pick up the second row without edits".** False: `ExportDialog.test.tsx` "advertises no kind this build cannot export" asserts `not.toContain('MIDI')`, and `exportKinds.test.ts` "ships exactly the WAV mixdown" pins a one-row table. Both are updated in Task 6 (test files only; no component change).
4. **§10 "`smfTestReader.ts` … Knip-ignored like `mixdownFixture.ts`".** `mixdownFixture.ts` is ignored by the `*Fixture` glob in `knip.json`; `smfTestReader` matches no glob, so `check:dead-code:production` would report it as an unused file. Task 2 adds it to the `knip.json` test-helper glob.
5. **§9 R5 "type-only imports" is unenforced.** No ESLint block stops `src/audio/export/*` from importing the engine today. Task 3 adds one for the two MIDI files (`@typescript-eslint/no-restricted-imports`, `allowTypeImports` for `./renderMixdown`).
6. **§10 solo test.** "solo state in the store changes nothing (via `buildMixdownSnapshot`)" needs the store; it lives in `src/store/exportKinds.test.ts` (Task 6), not in the audio-layer `renderMidi.test.ts`.

## File map

| File | Task | Change |
|---|---|---|
| `src/audio/rng.ts`, `src/audio/rng.test.ts` | 1 | receives `yieldPreservingRandomStream` + private `yieldToMainThread`; docblock caller count |
| `src/audio/export/renderMixdown.ts` | 1 | imports the helper from `../rng`; the two functions removed |
| `src/audio/export/renderMixdownRngIsolation.test.ts` | 1 | import path only |
| `src/audio/export/smfWriter.ts` (+ `.test.ts`) | 2 | **new** — `SmfEvent`, `SmfTrack`, `SmfFile`, `writeVlq`, `encodeSmf` |
| `src/audio/export/smfTestReader.ts` | 2 | **new, test-only** — `readSmf` |
| `knip.json` | 2 | `smfTestReader` joins the test-helper exclude glob |
| `src/audio/export/renderMidi.ts` (+ `renderMidi.test.ts`, `renderMidi.file.test.ts`, `renderMidi.render.test.ts`) | 3, 4, 5 | **new** |
| `eslint.config.js` | 3 | new block: MIDI files never import the engine |
| `src/incidents/operationFailure.ts` | 6 | `ReportableOperation` gains `'midi-export'` |
| `src/store/exportKinds.ts`, `exportKinds.test.ts` | 6 | `'midi'` kind |
| `src/components/export/ExportDialog.test.tsx` | 6 | MIDI row assertions (test only) |
| `.claude/rules/export.md`, `.claude/rules/playback.md`, `docs/decisions/0036-midi-export-from-song-timeline.md`, `docs/decisions/README.md`, `CLAUDE.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,02-store,03-audio,04-domain-and-dependencies}.md` | 7 | doc sync |

---

### Task 1: Move `yieldPreservingRandomStream` to `rng.ts`

**Files:**
- Modify: `src/audio/rng.ts`, `src/audio/rng.test.ts`, `src/audio/export/renderMixdown.ts`, `src/audio/export/renderMixdownRngIsolation.test.ts`

**Interfaces:**
- Produces: `yieldPreservingRandomStream(): Promise<void>` exported from `src/audio/rng.ts` (same body, same docblock). `yieldToMainThread` stays module-private in `rng.ts`.

- [ ] **Step 1: Failing test.** In `src/audio/rng.test.ts` add:

```ts
test('yieldPreservingRandomStream is the rng seam: restores the caller\'s source after the yield', async () => {
  const values = await withSeededRandom(7, async () => {
    const first = random();
    await yieldPreservingRandomStream();
    return [first, random()];
  });
  const expected = await withSeededRandom(7, () => [random(), random()]);
  expect(values).toEqual(expected);
});
```
(import `yieldPreservingRandomStream` from `./rng`).

- [ ] **Step 2:** `bun test src/audio/rng.test.ts` → FAIL (`yieldPreservingRandomStream` is not exported from `./rng`).
- [ ] **Step 3: Move verbatim.** Cut `yieldToMainThread` and `yieldPreservingRandomStream` (with its whole docblock) out of `renderMixdown.ts` and paste them at the end of `rng.ts`, bodies unchanged; inside `rng.ts` call `getRandomSource`/`setRandomSource` directly. Edit the moved docblock only where it is now wrong: "Exported for `renderMixdownRngIsolation.test.ts`" → "Used by both offline exports (`export/renderMixdown.ts`, `export/renderMidi.ts`) and driven directly by `export/renderMixdownRngIsolation.test.ts`"; `store/mixdownSlice.ts` → `store/exportSlice.ts`. In `renderMixdown.ts`: extend the existing import to `import { MIXDOWN_SEED, getRandomSource, setRandomSource, withSeededRandom, yieldPreservingRandomStream } from '../rng';` and drop `getRandomSource`/`setRandomSource` from it if nothing else in the file uses them (`grep -n "getRandomSource\|setRandomSource" src/audio/export/renderMixdown.ts`). No other line of `renderMixdown.ts` changes. In `renderMixdownRngIsolation.test.ts` merge the import into the existing `../rng` line and delete the `./renderMixdown` import. In the `rng.ts` top docblock, the caller paragraph ("THREE callers install a replacement: …") gains "and, since DEV-428, the MIDI export in `src/audio/export/renderMidi.ts`" and "THREE" → "FOUR".
- [ ] **Step 4:** Run `bun test src/audio/rng.test.ts src/audio/export` → PASS, golden included. `git status --short src/audio/export/renderMixdownGolden*` → empty. `bun run eslint` → zero/zero.
- [ ] **Step 5: Commit**

```bash
git add src/audio/rng.ts src/audio/rng.test.ts src/audio/export/renderMixdown.ts src/audio/export/renderMixdownRngIsolation.test.ts
git commit -m "refactor(audio): move yieldPreservingRandomStream to rng.ts (DEV-428)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SMF byte writer `smfWriter.ts` and the test-only reader

**Files:**
- Create: `src/audio/export/smfWriter.ts`, `src/audio/export/smfWriter.test.ts`, `src/audio/export/smfTestReader.ts`
- Modify: `knip.json`

**Interfaces:**
- Produces (`smfWriter.ts`, exactly spec §4.1):

```ts
export type SmfEvent =
  | { tick: number; kind: 'noteOn'; channel: number; note: number; velocity: number } // wire channel 0..15
  | { tick: number; kind: 'noteOff'; channel: number; note: number }                  // 0x8n, release velocity 64
  | { tick: number; kind: 'meta'; type: number; data: Uint8Array };                   // FF type len(VLQ) data
export interface SmfTrack { events: SmfEvent[]; endTick: number } // absolute ticks, any order
export interface SmfFile { ppq: number; tracks: SmfTrack[] }     // always format 1
export function writeVlq(value: number): number[];
export function encodeSmf(file: SmfFile): Uint8Array;
```
- Produces (`smfTestReader.ts`, test-only): `readSmf(bytes: Uint8Array): ReadSmf` with
  `interface ReadSmf { format: number; ppq: number; tracks: ReadTrack[] }`,
  `interface ReadTrack { name: string | null; metas: { tick: number; type: number; data: Uint8Array }[]; notes: ReadNote[]; endTick: number }`,
  `interface ReadNote { channel: number; note: number; velocity: number; startTick: number; endTick: number }`.
  It parses chunks, delta VLQs and statuses `8n`/`9n` (a `9n` with velocity 0 counts as note-off)/`FF`; throws on running status or an unknown status; pairs note-on/off FIFO per `(channel, note)`; `name` is the first `FF 03` decoded with `TextDecoder`; `endTick` is the `FF 2F` tick. Export only `readSmf` and the types a test imports.

Load-bearing writer details:

```ts
export function writeVlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new RangeError(`VLQ out of range: ${value}`);
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}
```
- `MThd`: `4D 54 68 64`, length `00 00 00 06`, format `00 01`, `u16(tracks.length)`, `u16(ppq)`.
- Each track: `4D 54 72 6B`, `u32(body length)`, body. Events stably sorted by `(tick, rank)` with rank meta 0 < noteOff 1 < noteOn 2; each written as `writeVlq(delta)` + full status byte (**no running status**): noteOn `0x90|ch, note, vel`; noteOff `0x80|ch, note, 0x40`; meta `0xFF, type, ...writeVlq(data.length), ...data`. Last: `writeVlq(eotTick − lastTick), FF 2F 00` with `eotTick = max(endTick, last event tick)`.
- Validation throws `RangeError`: tick not a non-negative integer, channel ∉ 0..15, note ∉ 0..127, noteOn velocity ∉ 1..127, meta type ∉ 0..127, ppq ∉ 1..0x7FFF.
- Keep `encodeSmf` under `complexity` 20: split `encodeEvent(event): number[]`, `validateEvent(event)`, `encodeTrack(track): number[]`.

- [ ] **Step 1: Failing tests** in `smfWriter.test.ts`:
  - `describe('writeVlq')` → test `'encodes the spec table'`: `[0,[0x00]]`, `[127,[0x7f]]`, `[128,[0x81,0x00]]`, `[480,[0x83,0x60]]`, `[8192,[0xc0,0x00]]`, `[0x3fff,[0xff,0x7f]]`, `[0x4000,[0x81,0x80,0x00]]`, `[0x0fffffff,[0xff,0xff,0xff,0x7f]]`; test `'throws outside 0..0x0FFFFFFF'` for `-1`, `0x10000000`, `1.5`.
  - `describe('encodeSmf')` → test `'a two-track file encodes to the golden bytes'` with this input (track 1's events deliberately out of order):

```ts
const file: SmfFile = { ppq: 480, tracks: [
  { endTick: 0, events: [{ tick: 0, kind: 'meta', type: 0x51, data: new Uint8Array([0x07, 0xa1, 0x20]) }] },
  { endTick: 1920, events: [
    { tick: 0, kind: 'noteOn', channel: 0, note: 60, velocity: 100 },
    { tick: 0, kind: 'meta', type: 0x03, data: new Uint8Array([0x41]) },
    { tick: 480, kind: 'noteOn', channel: 0, note: 62, velocity: 90 },
    { tick: 480, kind: 'noteOff', channel: 0, note: 60 },
    { tick: 960, kind: 'noteOff', channel: 0, note: 62 },
  ] },
] };
const GOLDEN = [
  '4D546864 00000006 0001 0002 01E0',
  '4D54726B 0000000B', '00 FF 51 03 07 A1 20', '00 FF 2F 00',
  '4D54726B 0000001C', '00 FF 03 01 41', '00 90 3C 64', '83 60 80 3C 40',
  '00 90 3E 5A', '83 60 80 3E 40', '87 40 FF 2F 00',
].join(' ').replace(/\s+/g, '');
expect(hex(encodeSmf(file))).toBe(GOLDEN); // hex = uppercase, no separators
```
  This one golden pins: header fields, both `MTrk` lengths, meta before note-on at tick 0, note-off before note-on at tick 480, repeated `90` status (no running status), release velocity `40`, EOT at `endTick` 1920 (delta `87 40`).
  - test `'EOT lands on the last event when endTick is earlier'`: one track, noteOn 0 / noteOff 480, `endTick: 0` → bytes end `83 60 80 3C 40 00 FF 2F 00`.
  - test `'throws instead of writing a corrupt file'`: `RangeError` for channel 16, note 128, noteOn velocity 0, velocity 128, tick −1.
  - test `'the test reader parses what the writer wrote'` (import `readSmf` from `./smfTestReader`): the golden file reads back as `format 1`, `ppq 480`, track 1 `name 'A'`, notes `[{channel:0,note:60,velocity:100,startTick:0,endTick:480},{channel:0,note:62,velocity:90,startTick:480,endTick:960}]`, `endTick 1920`.
- [ ] **Step 2:** `bun test src/audio/export/smfWriter.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `smfWriter.ts` (file docblock: pure SMF format-1 encoder; knows the file format, nothing about songs; a thrown writer is a `render-failed`, never a corrupt file) and `smfTestReader.ts` (docblock: test-only, excluded from the production Knip graph). In `knip.json` change `"!src/**/{engineTestHelpers,testFakes,*Fixture,*Fixtures}.{ts,tsx}!"` to `"!src/**/{engineTestHelpers,testFakes,smfTestReader,*Fixture,*Fixtures}.{ts,tsx}!"`.
- [ ] **Step 4:** `bun test src/audio/export/smfWriter.test.ts` → PASS. `bun run eslint`, `bun run check:dead-code`, `bun run check:dead-code:production` → clean. (`writeVlq` is imported by its test, so it may stay exported.)
- [ ] **Step 5: Commit** — `git add src/audio/export/smfWriter.ts src/audio/export/smfWriter.test.ts src/audio/export/smfTestReader.ts knip.json` and `git commit -m "feat(export): SMF format-1 byte writer (DEV-428)" ` + blank line + trailer.

---

### Task 3: MIDI lane tables, mappers and the no-engine lint guard

**Files:**
- Create: `src/audio/export/renderMidi.ts` (tables + pure mappers only), `src/audio/export/renderMidi.test.ts`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: `SongTrack`, `TimelineEvent` (types) from `../playback/plan/songTimeline`; `MixdownSnapshot` (type), `songTrackVoice` from `../playback/plan/songSnapshot`; `BeatVoiceId` from `@/types`; `MeterId` from `@/utils/meter`.
- Produces (spec §4.2):

```ts
export const MIDI_PPQ = 480;
const GM_DRUM_CHANNEL = 9; // GM channel 10, zero-based on the wire
export type MidiLane = SongTrack | 'beat';
export const MIDI_LANES: readonly { lane: MidiLane; name: string; channel: number }[] = [
  { lane: 'chord', name: 'Chord', channel: 0 }, { lane: 'bass', name: 'Bass', channel: 1 },
  { lane: 'pad', name: 'Pad', channel: 2 }, { lane: 'lead', name: 'Lead', channel: 3 },
  { lane: 'fx', name: 'FX', channel: 4 }, { lane: 'beat', name: 'Beat', channel: GM_DRUM_CHANNEL },
];
export const GM_DRUM_NOTE: Readonly<Record<BeatVoiceId, number>> = {
  kick: 36, snare: 38, rimshot: 37, clap: 39, hihat: 42, openhat: 46,
  hitom: 48, lowtom: 45, ride: 51, crash: 49, bell: 56, // bell = 808 cowbell (spec F16)
};
export const MIDI_TIME_SIGNATURE: Readonly<Record<MeterId, { numerator: number; denominatorPow2: number; clocksPerClick: number }>> = {
  '4/4': { numerator: 4, denominatorPow2: 2, clocksPerClick: 24 },
  '3/4': { numerator: 3, denominatorPow2: 2, clocksPerClick: 24 },
  '5/4': { numerator: 5, denominatorPow2: 2, clocksPerClick: 24 },
  '6/8': { numerator: 6, denominatorPow2: 3, clocksPerClick: 36 },
  '12/8': { numerator: 12, denominatorPow2: 3, clocksPerClick: 36 },
  '7/8': { numerator: 7, denominatorPow2: 3, clocksPerClick: 12 },
};
export interface MidiNote { lane: MidiLane; channel: number; note: number; velocity: number; startTick: number; endTick: number }
export function secondsToTicks(sec: number, bpm: number): number;   // Math.round(sec * bpm / 60 * MIDI_PPQ)
export function midiVelocity(v: number): number | null;             // v <= 0 → null; else clamp(round(v*127), 1, 127)
export function eventAudible(snapshot: MixdownSnapshot, e: TimelineEvent): boolean;
export function resolveNoteOverlaps(notes: MidiNote[]): MidiNote[];
```
- `eventAudible`: `const loop = snapshot.loops[e.loopIndex]`; source = `songTrackVoice(loop, e.track).source` for a note, `'sequencer'` for a drum; bus row `loop.buses.find(b => b.source === source)`; missing row → audible; else `!row.muted && row.gain > 0`; a drum additionally needs `(loop.beatVoiceGains.find(g => g.voice === e.voice)?.gain ?? 1) > 0`. The song-level `snapshot.buses` is never read (spec §7, F9).
- `resolveNoteOverlaps`: group by `(channel, note)`, sort each group by `startTick` (stable), then walk: same `startTick` as the kept previous → merge into it (`velocity = max`, `endTick = max`); `startTick < previous.endTick` → `previous.endTick = startTick`, keep the new note. Return a new array of new objects (input untouched), ordered by `(startTick, channel, note)`.
- Do not export `GM_DRUM_CHANNEL` unless a test imports it.

- [ ] **Step 1: Failing tests** in `renderMidi.test.ts` (use `mixdownSnapshot`/`mixdownLoop` from `./mixdownFixture`; construct `TimelineEvent` literals directly):
  - `'MIDI_LANES covers every SongTrack and beat once, in SongTrack order then Beat'` — lanes `['chord','bass','pad','lead','fx','beat']`, names `['Chord','Bass','Pad','Lead','FX','Beat']`, channels `[0,1,2,3,4,9]`.
  - `'GM_DRUM_NOTE is the spec map'` — `toEqual` the 11-entry object above; keys equal `BEAT_VOICE_IDS` (from `@/data/beatPresets`) as a set.
  - `'MIDI_TIME_SIGNATURE has a row for every meter'` — keys equal `METER_IDS`; `'7/8'` clocks 12, `'6/8'`/`'12/8'` 36, others 24.
  - `'secondsToTicks: a 16th is 120 ticks, a 1/32 is 60'` — `secondsToTicks(0.125, 120) === 120`, `(0.0625, 120) === 60`, `(stepDurationSec(97) * 37, 97) === 37 * 120` (import `stepDurationSec` from `@/utils/musicTheory`).
  - `'midiVelocity is linear and clamped'` — `0.8→102`, `0.9→114`, `1→127`, `1.2→127`, `0.001→1`, `0→null`, `-0.5→null`.
  - `'eventAudible follows the event loop bus row'` — a note on `'lead'` is dropped when that loop's `'synth'` row is muted, and when its gain is 0; kept when only the song-level `snapshot.buses` `'synth'` row is muted; a second loop with the row unmuted keeps its own events.
  - `'eventAudible drops a drum on a muted sequencer bus or a zero voice gain only'` — `'sequencer'` muted → false; `beatVoiceGains` kick 0 → kick false, snare true.
  - `'resolveNoteOverlaps merges a same-tick duplicate'` — two notes ch0/60 at 0 (vel 80, end 240) and (vel 100, end 480) → one `{velocity:100, endTick:480}`.
  - `'resolveNoteOverlaps cuts the earlier note at a later start'` — ch0/60 0..480 and 240..720 → `[0..240, 240..720]`.
  - `'resolveNoteOverlaps leaves other pitches and channels alone'` — ch0/60 0..480 with ch0/64 0..480 and ch1/60 0..480 unchanged; input array not mutated.
- [ ] **Step 2:** `bun test src/audio/export/renderMidi.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** the tables and mappers in `renderMidi.ts` with a file docblock stating: built from the song timeline only (R296); imports only types from `./renderMixdown`; never the engine.
- [ ] **Step 4: Lint guard.** In `eslint.config.js`, directly after the `src/audio/playback/plan/**` block, add:

```js
  {
    // DEV-428: the MIDI export runs where OfflineAudioContext does not exist.
    // renderMixdown.ts imports createRenderEngine, so only its TYPES may be
    // imported here; the engine and its DSP neighbours never. The base rule
    // is off because the TS-aware variant (needed for allowTypeImports) only
    // runs without it; the src/audio/** bans are restated because this block
    // REPLACES that one for these files (flat config, last match wins).
    files: ['src/audio/export/renderMidi.ts', 'src/audio/export/smfWriter.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
            {
              group: ['../engine', '**/engine', '**/audio/engine', '**/beatAdapter', '**/drumSynth', '**/masterRack', '**/synth/**'],
              message: 'the MIDI export builds no audio: no engine import (DEV-428, R296).',
            },
            {
              group: ['./renderMixdown', '**/export/renderMixdown'],
              allowTypeImports: true,
              message: 'renderMixdown.ts pulls in the engine: import its types only (DEV-428).',
            },
          ],
        },
      ],
    },
  },
```
  **Probe:** temporarily add `import { renderMixdown } from './renderMixdown'; void renderMixdown;` and, separately, `import '../engine';` to `renderMidi.ts`; `bunx eslint src/audio/export/renderMidi.ts` must report an error for each; then remove both and confirm `import type { MixdownFailureReason } from './renderMixdown';` is accepted. Also confirm the `tonal` ban still fires with a temporary `import 'tonal';`. Remove every probe line.
- [ ] **Step 5:** `bun test src/audio/export/renderMidi.test.ts` → PASS; `bun run eslint`, both Knip scans → clean.
- [ ] **Step 6: Commit** — `git add src/audio/export/renderMidi.ts src/audio/export/renderMidi.test.ts eslint.config.js`; message `feat(export): MIDI lane, drum and meter tables and note mappers (DEV-428)` + trailer.

---

### Task 4: The file builder `songMidiFile`

**Files:**
- Modify: `src/audio/export/renderMidi.ts`
- Create: `src/audio/export/renderMidi.file.test.ts`

**Interfaces:**
- Consumes: `SmfFile`, `SmfEvent`, `SmfTrack` (types) from `./smfWriter`; `planArrangement` from `../playback/plan/songTimeline`; Task 3's tables.
- Produces: `export function songMidiFile(snapshot: MixdownSnapshot, notes: MidiNote[], title: string): SmfFile;`
  - Track 0 (conductor), all at tick 0: `FF 03` UTF-8 `title` (`new TextEncoder().encode`), `FF 58 04 nn dd cc 08` from `MIDI_TIME_SIGNATURE[snapshot.meterId]`, `FF 51 03` 24-bit big-endian `Math.round(60_000_000 / snapshot.bpm)`; `endTick = songEndTick`.
  - `songEndTick = planArrangement(snapshot).totalSteps * MIDI_PPQ / 4`.
  - Tracks 1..6 in `MIDI_LANES` order, **always all six**: `FF 03` lane name at tick 0, then a `noteOn`/`noteOff` pair per `MidiNote` whose `lane` matches, on the lane's channel; `endTick = max(songEndTick, last noteOff)`.
  - `notes` are taken as given (overlaps already resolved by the caller).

- [ ] **Step 1: Failing tests** in `renderMidi.file.test.ts` (encode with `encodeSmf`, parse with `readSmf`; helper `midi(snapshot, notes, title)`):
  - `'seven tracks named title then the six lanes'` — `readSmf(...).tracks.map(t => t.name)` equals `['My Song','Chord','Bass','Pad','Lead','FX','Beat']`, `format 1`, `ppq 480`, with `notes = []` (empty lanes still written).
  - `'a UTF-8 title round-trips'` — title `'เพลง'` reads back as `'เพลง'`.
  - `'tempo is round(6e7 / bpm) µs per quarter'` — at bpm 120 the `0x51` meta data is `[0x07,0xa1,0x20]`; at bpm 90 `[0x0a,0x2c,0x2b]`.
  - `'one time signature per meter'` — for every `METER_IDS` entry (snapshot with that `meterId` and the matching `getMeter(id).stepsPerBar`), the `0x58` data is `[4,2,24,8]` 4/4, `[3,2,24,8]` 3/4, `[6,3,36,8]` 6/8, `[12,3,36,8]` 12/8, `[5,2,24,8]` 5/4, `[7,3,12,8]` 7/8.
  - `'a lane note lands on its lane track and channel'` — one `MidiNote` per lane; Beat's is on channel 9 in track 6; each track holds only its own lane's note.
  - `'every track ends at the song end or the last note-off'` — default fixture (one 4/4 bar) → conductor `endTick` 1920; a Bass note ending at 2000 → Bass track `endTick` 2000, others 1920.
- [ ] **Step 2:** `bun test src/audio/export/renderMidi.file.test.ts` → FAIL (`songMidiFile` not exported).
- [ ] **Step 3:** Implement with small helpers (`conductorTrack`, `laneTrack`, `metaText`, `u24`) to stay under `complexity`/`max-lines-per-function`.
- [ ] **Step 4:** Test → PASS; `bun run eslint`, both Knip scans → clean.
- [ ] **Step 5: Commit** — `git add src/audio/export/renderMidi.ts src/audio/export/renderMidi.file.test.ts`; message `feat(export): conductor and lane tracks for the MIDI file (DEV-428)` + trailer.

---

### Task 5: `renderMidi` — the seeded timeline walk, progress and cancel

**Files:**
- Modify: `src/audio/export/renderMidi.ts`
- Create: `src/audio/export/renderMidi.render.test.ts`

**Interfaces:**
- Consumes: `walkSongTimeline`, `planArrangement` from `../playback/plan/songTimeline`; `withSeededRandom`, `MIXDOWN_SEED`, `yieldPreservingRandomStream` from `../rng`; `noteMidi` from `@/musicCore`; `encodeSmf` from `./smfWriter`; `import type { MixdownFailureReason, MixdownProgressReporter } from './renderMixdown'`.
- Produces:

```ts
export function renderMidi(
  snapshot: MixdownSnapshot, title: string,
  onProgress?: MixdownProgressReporter, signal?: AbortSignal,
): Promise<{ ok: true; blob: Blob } | { ok: false; reason: MixdownFailureReason }>;
```
  (Name the result type `MidiRenderResult`; export it only if another file imports it.)

Flow (spec §8), split across `renderMidi` → `collectMidiNotes` → `midiNoteFor` so each stays under the limits:
1. A local `safeReport` wraps `onProgress` in `try/catch` (a progress observer never fails the export — same rule as the WAV renderer's private `safeProgressReporter`).
2. `signal?.aborted` → `cancelled`; `snapshot.loops.length === 0` → `empty-arrangement`; `report({ phase: 'preparing' })`.
3. `const plan = planArrangement(snapshot)`; `await withSeededRandom(MIXDOWN_SEED, () => collectMidiNotes(...))`. Walk items one by one: `pass` → ignore; `note`/`drum` → `midiNoteFor` (skip if `!eventAudible`; note number `noteMidi(e.noteName)` for notes, `GM_DRUM_NOTE[e.voice]` for drums, drop if `null` or outside 0..127; `midiVelocity` null → drop; `startTick = secondsToTicks(startSec|timeSec, bpm)`; notes `endTick = max(startTick + 1, secondsToTicks(endSec, bpm))`, drums `startTick + MIDI_PPQ / 4`; channel from `MIDI_LANES`); `stepEnd` (its `step` is the absolute 0-based step) → count, and every `MIDI_YIELD_INTERVAL_STEPS = 200` steps: `report({ phase: 'rendering', percent: Math.floor(100 * (item.step + 1) / plan.totalSteps) })`, `await yieldPreservingRandomStream()`, return cancelled if `signal?.aborted`.
4. `report({ phase: 'encoding' })`; `await new Promise<void>((r) => setTimeout(r, 0))`; abort check; `encodeSmf(songMidiFile(snapshot, resolveNoteOverlaps(notes), title))`; `new Blob([bytes], { type: 'audio/midi' })`.
5. Whole body in `try/catch` → `{ kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) }`; never throws.
Docblock: arp `'random'` notes are deterministic per export but may differ from the WAV's, because the WAV interleaves engine draws on the same seeded stream (spec §9 R2, ADR-0036).

- [ ] **Step 1: Failing tests** in `renderMidi.render.test.ts` (fixtures from `./mixdownFixture`; `bytesOf(blob) = new Uint8Array(await blob.arrayBuffer())`; `parsedNotes(result)` = every track's notes from `readSmf`, sorted by `(channel, startTick, note)`):
  - `describe('renderMidi equivalence')`:
    - `'the MIDI notes are the audible timeline events, nothing else'` — for the default fixture plus a snapshot with a Lead bar (`leadMelodySteps` = `mixdownMelodyBar('E4')` with `bar[1] = [{ note: 'G4', len: 1 }]` added, `leadStepResolution: '1/32'`) and a two-loop snapshot whose second loop has `buses` `'bass'` muted: expected = `withSeededRandom(MIXDOWN_SEED, () => buildSongTimeline(snapshot)).events`, filtered by `eventAudible`, mapped with `noteMidi`/`GM_DRUM_NOTE`/`midiVelocity`/`secondsToTicks` (a drum = one 16th), passed through `resolveNoteOverlaps`, sorted the same way; `toEqual` the parsed notes (compare `channel, note, velocity, startTick, endTick`).
    - `'on-grid events land on step multiples'` — default fixture: every drum and Bass note `startTick % 120 === 0`; the 1/32 Lead fixture: every Lead `startTick % 60 === 0`, and the G4 (67) note on channel 3 starts at tick 60 exactly.
    - `'a muted loop bus drops that lane only in that loop'` — two loops, loop 2 `'bass'` muted: channel-1 notes all start before loop 2's first tick (`16 * 120`), other channels have notes in both loops.
    - `'a bus at gain 0 and a muted drum voice drop their notes'` — `'chord'` row gain 0 → no channel-0 notes; `beatVoiceGains` kick 0 → no note 36 on channel 9, other drum notes present.
    - `'an unparseable note name is dropped, not sent as 440 Hz'` — Lead bar `mixdownMelodyBar('H9')` (confirm first that `noteMidi('H9')` is `null`) → no channel-3 notes and `ok: true`.
  - `describe('renderMidi runtime')`:
    - `'two exports of a random-arp song are byte-identical'` — `chordArpSettings: { active: true, mode: 'random', rate: '16n', octaves: 2 }`, `repeatCount: 4`; bytes equal.
    - `'runs with no OfflineAudioContext or AudioContext'` — save and delete both from `globalThis`, render the default fixture → `ok: true`, `blob.type === 'audio/midi'`; restore in `finally`.
    - `'reports preparing, rendering, encoding in order'` — `repeatCount: 20` (320 steps): phases deduplicated equal `['preparing','rendering','encoding']`; the first rendering percent is `Math.floor(100 * 200 / 320)` = `62`.
    - `'an aborted signal before start returns cancelled'`; `'aborting at the first yield returns cancelled'` — abort inside the progress callback on the first `'rendering'`.
    - `'an empty arrangement is reported, not encoded'` — `loops: []` → `{ ok: false, reason: { kind: 'empty-arrangement' } }`.
    - `'a throwing progress observer does not fail the export'` — `onProgress` throws → `ok: true`.
    - `'the seeded stream is restored afterwards'` — after the render, `getRandomSource()` is the pre-render source.
- [ ] **Step 2:** `bun test src/audio/export/renderMidi.render.test.ts` → FAIL.
- [ ] **Step 3:** Implement per the flow above.
- [ ] **Step 4:** `bun test src/audio/export` → PASS (golden unchanged); `bun run eslint`, both Knip scans → clean.
- [ ] **Step 5: Commit** — `git add src/audio/export/renderMidi.ts src/audio/export/renderMidi.render.test.ts`; message `feat(export): render the song timeline to a Standard MIDI File (DEV-428)` + trailer.

---

### Task 6: Register the `'midi'` export kind

**Files:**
- Modify: `src/incidents/operationFailure.ts`, `src/store/exportKinds.ts`, `src/store/exportKinds.test.ts`, `src/components/export/ExportDialog.test.tsx`

**Interfaces:**
- Consumes: `renderMidi` from `@/audio/export/renderMidi`; `slugifyProjectName`.
- Produces: `ExportKindId = 'mixdown-wav' | 'midi'`; `export const MIDI_FAILURE_MESSAGE` (declared **before** `MIDI_EXPORT`, same `Record` type as `MIXDOWN_FAILURE_MESSAGE`); `export function midiFileName(projectName: string | null): string` → `` `${slugifyProjectName(projectName ?? '')}.mid` ``; `MIDI_EXPORT: ExportKindSpec` exactly as spec §8 (label `'Export MIDI (.mid)'`, progress labels `'Building MIDI'`/`'Writing MIDI file'`, `incidentOperation: 'midi-export'`, `run` renders `snapshot.song` titled `snapshot.projectName ?? 'Solna'`); `EXPORT_KIND_BY_ID` gains `midi: MIDI_EXPORT` after `'mixdown-wav'`. `ReportableOperation` gains `'midi-export'`. The header comment "DEV-428 adds MIDI, DEV-429 stems" → "DEV-429 adds stems".

- [ ] **Step 1: Failing tests.**
  - `exportKinds.test.ts`: test `'midiFileName slugs the project name'` (`'My Song'→'my-song.mid'`, `''`/`'!!!'`/`null` → `'project.mid'`); rename `'ships exactly the WAV mixdown, …'` to `'ships the WAV mixdown then MIDI, in dialog order'` expecting `[['mixdown-wav','Export mixdown (WAV)'],['midi','Export MIDI (.mid)']]`; test `'the MIDI kind wording and incident operation'` (progress labels, `failureMessages` `toBe(MIDI_FAILURE_MESSAGE)` and `toEqual` the three spec sentences, `incidentOperation 'midi-export'`); `describe('the MIDI kind run')`: `'renders the captured song as audio/midi named from the project'` (`fileName 'my-song.mid'`, `blob.type 'audio/midi'`, first 4 bytes `MThd`), `'an empty arrangement is returned as reported'`, `'an already-aborted signal returns cancelled'`, and `'solo changes nothing'` — `bytes` of a run with `useAppStore.getState().toggleSoloTrack('lead')` applied before `buildMixdownSnapshot` equal the bytes with no solo; `clearSoloTracks()` in `finally`.
  - `ExportDialog.test.tsx`: in `'idle: one enabled row per kind and no status'` add `expect(html).toContain('<button id="btn-export-midi" type="button" class="btn btn-sm btn-outline justify-start">Export MIDI (.mid)</button>')`; in the busy test assert `id="btn-export-midi"` row is `disabled=""`; in `'advertises no kind this build cannot export'` delete only the `not.toContain('MIDI')` line (stems and "coming soon" assertions stay).
- [ ] **Step 2:** `bun test src/store/exportKinds.test.ts src/components/export` → FAIL.
- [ ] **Step 3:** Implement the `exportKinds.ts` and `operationFailure.ts` changes. No other source file changes.
- [ ] **Step 4:** `bun test src/store src/components/export src/incidents` → PASS. Acceptance: `git diff --stat main -- src/store/exportJob.ts src/store/exportSlice.ts src/components/Header.tsx src/components/export/*.tsx src/components/export/useExportDialog.ts src/store/mixdownSnapshot.ts src/audio/playback/plan` prints nothing (only `ExportDialog.test.tsx` changed under `src/components/export/`). `bun run eslint`, both Knip scans → clean.
- [ ] **Step 5: Commit** — `git add src/incidents/operationFailure.ts src/store/exportKinds.ts src/store/exportKinds.test.ts src/components/export/ExportDialog.test.tsx`; message `feat(export): MIDI export kind in the Export dialog (DEV-428)` + trailer.

---

### Task 7: Rules R296–R300, ADR-0036 and architecture docs

**Files:**
- Create: `docs/decisions/0036-midi-export-from-song-timeline.md`
- Modify: `.claude/rules/export.md`, `.claude/rules/playback.md`, `docs/decisions/README.md`, `CLAUDE.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/README.md`, `docs/architecture/structure/02-store.md`, `docs/architecture/structure/03-audio.md`, `docs/architecture/structure/04-domain-and-dependencies.md`

**Interfaces:** Consumes the code of Tasks 1–6 (confirm each identifier you cite with `grep`). First run `grep -rhoE "R[0-9]{3}" CLAUDE.md .claude/rules docs/decisions | sort -u | tail -1` → must print `R295`; if higher, renumber from the next free id everywhere in this task. `ls docs/decisions` must show no `0036-*`; if one exists, take the next number.

- [ ] **Step 1: `.claude/rules/export.md`.** Add `"src/audio/export/renderMidi.ts"` and `"src/audio/export/smfWriter.ts"` to `paths:`. Add a section `## MIDI` with R296–R300 worded exactly as spec §11, each ending `<!-- R29x -->`, followed by `([ADR-0036](../../docs/decisions/0036-midi-export-from-song-timeline.md))`. Add five `## Prohibited` lines:
  - A lane planner call, or a re-derived arp, rhythm, strum or hold, in `renderMidi.ts` <!-- R296 -->
  - Exporting a muted or zero-gain lane or drum voice, or letting solo reach the MIDI <!-- R297 -->
  - A MIDI number or Hz on `TimelineEvent`, or a Hz → MIDI conversion <!-- R298 -->
  - The GM map, meter table or lane table in `src/data/`, or as a non-`Record` table <!-- R299 -->
  - Two sounding instances of one pitch on one channel, or a note-on before a note-off at one tick <!-- R300 -->
- [ ] **Step 2: `.claude/rules/playback.md`.** R287's line gains, after its first clause: "`renderMidi.ts` likewise consumes `walkSongTimeline` and calls no lane planner (ADR-0036)". Its Prohibited line becomes "A lane planner call or engine-independent event decision inside `renderMixdown.ts` or `renderMidi.ts`". Update ADR-0034's "Rules this implies" R287 line identically only if it quotes the rule text (check with `grep -n R287 docs/decisions/0034-*.md`).
- [ ] **Step 3: ADR-0036** from the template in `docs/decisions/README.md`: title `# ADR-0036: MIDI export from the song timeline`; Status `Accepted — 2026-09-22. DEV-428`.
  - **Context:** DEV-420 made the timeline pure and DEV-421 made kinds data; a MIDI file needs no `AudioContext`; `yieldPreservingRandomStream` sat in `renderMixdown.ts` beside `createRenderEngine`.
  - **Decision:** spec §12 items 1–15, one line each; the `rng.ts` move (and that it retires the DEV-420/421 "`renderMixdown.ts` source byte-unchanged" working constraint — the WAV golden, which pins output bytes, is the invariant and passed unchanged); the ESLint block that bans engine imports and allows only type imports from `renderMixdown.ts`; `smfTestReader.ts` excluded from the production Knip graph; R287 widened to `renderMidi.ts`.
  - **Rejected alternatives:** the "Rejected" line of each spec section (§3 `src/utils/smf.ts`; §5.1 omit empty tracks, format 0, PPQ 96; §5.3 emit overlapping notes; §5.4 `FF 59` for Major/Minor only; §6 GM programs, `src/data/drumGmNotes.ts`; §7 ignore mute, mute flags only), plus "import `yieldPreservingRandomStream` from `renderMixdown.ts`" (a runtime edge to the engine).
  - **Consequences:** a GM drum map now exists (ADR-0016's external MIDI input stays focus-agnostic; lifting the map is a R276 move when a second reader appears); arp `'random'` notes may differ from the WAV's (R2); key changes are not in the file.
  - **Rules this implies:** R296–R300, identical to `export.md`; R287 widened.
  - **Sources:** the spec, this plan, Linear DEV-428.
- [ ] **Step 4: Index and CLAUDE.md.** `docs/decisions/README.md`: add the 0036 row after 0035 in the table's format — `| [0036](0036-midi-export-from-song-timeline.md) | MIDI export from the song timeline | A format-1 SMF built from `walkSongTimeline`: one track per lane, GM drums on channel 10, mute honoured and solo never, note numbers from `noteMidi`. |`. `CLAUDE.md`: the `export.md` rules-table row gains "; MIDI export (lanes, channels, GM map)". No other `CLAUDE.md` change: no new cross-cutting invariant line, no version numbers.
- [ ] **Step 5: Architecture docs** (no line numbers or counts in new text, R001):
  - `feature-overview.md`: row 10 → `| 10 | Export (mixdown WAV, MIDI) | Header Export button (song layer) → Export dialog | Offline render of the song to WAV, or the song timeline to a Standard MIDI File; one job at a time, kinds as data (`store/exportKinds.ts`) |`; the `audio/export/` module row → `Offline mixdown and MIDI export` / `renderMixdown`, `renderMidi`; the diagram node `Export["export/renderMixdown<br/>(OfflineAudioContext)"]` gains a sibling `Midi["export/renderMidi<br/>(no AudioContext)"]` with `Snapshots --> Midi` (no engine edge).
  - `structure/03-audio.md`: §1.1 `rng.ts` row adds `yieldPreservingRandomStream`; §1.5 table adds `export/renderMidi.ts` (Song timeline → SMF: lane/GM/meter tables, audibility, overlap rule, seeded walk (§4)), `export/smfWriter.ts` (Pure SMF format-1 byte encoder), `export/smfTestReader.ts` (Test-only SMF parser; excluded from the production Knip graph); §4 gains a subsection "MIDI (`export/renderMidi.ts`)": seeded walk of `walkSongTimeline` with no engine, `eventAudible` per loop bus row, `noteMidi` at the boundary, `resolveNoteOverlaps`, `songMidiFile` → `encodeSmf`, yields via `rng.ts`'s `yieldPreservingRandomStream`.
  - `structure/02-store.md`: the `exportKinds` mention says it registers two kinds, `mixdown-wav` and `midi` (incident operations `mixdown`, `midi-export`).
  - `structure/04-domain-and-dependencies.md`: the ESLint block table gains a row for the new block (`renderMidi.ts`, `smfWriter.ts` | block 1 + engine/DSP modules; `./renderMixdown` type-only | —), with no line range; the Knip paragraph's exclude glob gains `smfTestReader`.
  - `structure/README.md`: the `Exp["export/renderMixdown"]` node → `Exp["export/renderMixdown · renderMidi"]`. Audit-finding mark: `grep -n "MIDI\|export\|Export" docs/architecture/structure/README.md` and mark a finding **Fixed on `feat/dev-428-midi-export`** only if one names missing MIDI export or the renderer↔rng coupling; at the time of planning none does (U7 is already marked), so expect no mark.
- [ ] **Step 6: Verify** — `grep -rhoE "R29[6-9]|R300" .claude/rules/export.md docs/decisions/0036-midi-export-from-song-timeline.md | sort | uniq -c` shows each id in both files; `grep -rn "yieldPreservingRandomStream" docs/architecture` cites `rng.ts`, never `renderMixdown.ts`; `grep -nE "[0-9]+\.[0-9]+\.[0-9]+" docs/decisions/0036-*.md` prints nothing.
- [ ] **Step 7: Commit** — `git add .claude/rules docs/decisions CLAUDE.md docs/architecture`; message `docs: ADR-0036 MIDI export, export rules R296-R300 (DEV-428)` + trailer.

---

### Task 8: Completion gate

**Files:** none new; fix only what the gate reports.

- [ ] **Step 1: Acceptance checks (spec §13).** `git diff --stat main -- src/store/exportJob.ts src/store/exportSlice.ts src/components/Header.tsx src/components/export/ExportDialog.tsx src/components/export/ExportButton.tsx src/components/export/useExportDialog.ts src/audio/export/renderMixdownGolden.test.ts src/audio/export/renderMixdownGolden.wav.sha256 src/audio/export/renderMixdownGolden.calls.json` → nothing. `git diff main -- src/audio/export/renderMixdown.ts` shows only Task 1's import change and removed functions. `grep -rn "from '\.\./engine'\|from '\./renderMixdown'" src/audio/export/renderMidi.ts src/audio/export/smfWriter.ts` → at most one line, and it is `import type`.
- [ ] **Step 2:** `bun run verify` → PASS (all tests including the golden, static/domain checks, both Knip scans zero, build).
- [ ] **Step 3:** `bun run eslint` → zero errors, zero warnings. Open every warning's code and fix it or add a reasoned line-level disable (R264).
- [ ] **Step 4: Commit gate fixes** only if something changed: `git add -A && git commit -m "chore(export): gate fixes for DEV-428"` + trailer.
- [ ] **Step 5: Report** `git log --oneline main..HEAD`, the verify and eslint result lines, and any Knip-driven `export` removals. Moving DEV-428 to Testing in Linear is the main session's job; do not push.
