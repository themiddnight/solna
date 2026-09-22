# Dry stems export per track — design

**Issue:** DEV-429 "Dry stems export per track".
**Branch:** `feat/dev-429-dry-stems` (stacked on `feat/dev-423-per-track-sends`).
**Status:** Draft for review (2026-09-22). Every open question is decided here with one rejected
alternative; §13 lists the decisions one per line for a quick veto.

**User-visible change:** the Export dialog gains a third row, "Export stems (WAV, .zip)". It
downloads `<project-slug>-stems.zip`, holding one stereo 16-bit 44.1 kHz WAV per track that has
content — `<slug>-chord.wav`, `-bass`, `-pad`, `-lead`, `-fx`, `-beat` — each the track's bus
after its fader and mute, with no sends and no master processing, sample-aligned with the
mixdown WAV. The WAV and MIDI exports are unchanged.

---

## 0. Verified facts (checked against the code on this branch, @02a4aebd)

| # | Claim | Evidence |
|---|---|---|
| F1 | Every synth voice enters its track through a unity pre-fader tap: voice → `getSourceTap(source)` → `getSourceBus(source)` | `runtime/audioSession.ts:44-47` (`destinationsFor` → `getSourceTap`); `masterRack.ts:995-1004` |
| F2 | The source bus is the fader+mute point; its outputs are `dryGain` plus its three send nodes (delay, reverb — not for Beat —, distortion), all taken after the fader | `masterRack.ts:957-983` (`getSourceBus`), R303 |
| F3 | Fader and mute are one automation on the bus gain (`applySourceLevel`): `setValueAtTime` at time 0 (`'settle'`), `setTargetAtTime` with τ = 10 ms at every later pass boundary (`'transition'`), so a mute after the first pass approaches 0 and never reaches it exactly; the Beat bus additionally drives `drumSendGate` | `masterRack.ts:1008-1036`; `automation/sourceBusAutomation.ts:51-63` |
| F4 | Beat: drum envelope → per-voice `drumTrackGain` → `drumBusFilter` bank → `getSourceTap('sequencer')` → Beat bus. So the per-voice faders and the three-lane filter bank are upstream of the Beat bus | `drumSynth.ts:224-231, 393-400`; `masterRack.ts:582` |
| F5 | Beat's per-voice `reverbSend` is a parallel path: envelope → send gain → `drumSendFilter` → `drumSendGate` → `send[sequencer].reverb` → convolver. It never passes through the Beat bus | `drumSynth.ts:396-400`; `masterRack.ts:589-597, 645`; R304, R305 |
| F6 | `dryGain`, `delayGain`, `reverbGain`, `distortionGain` → EQ (or around it when `eqBypass`) → `masterGain` → compressor/limiter → `ctx.destination`. The one edge to the destination is made in `rewireMasterDynamics` | `masterRack.ts:770-783` (`rewireEq`), `:738` |
| F7 | An observe-only edge off a bus already exists (`getSourceLevelAnalyser`: `getSourceBus(source).connect(analyser)`) — a precedent for a non-gate bus edge. R303 governs bus→**gate** edges only | `masterRack.ts:1340-1353`; `synth-voices.md` R303 |
| F8 | The render engine is `createRenderEngine(ctx)` → `bindContext` → `AudioSession.create` → `masterRack.bind(ctx)` then `setupMasterChain()`. There is no way today to send the master anywhere but `ctx.destination` | `engine.ts:476-485, 751-755`; `audioSession.ts:34-54` |
| F9 | `renderMixdown` = guards → `planArrangement` → 2-ch `OfflineAudioContext` (body + tail `max(2, reverbDecay + 1)` s) → **inside `withSeededRandom(MIXDOWN_SEED)`**: `createRenderEngine`, `applyMasterState`, `scheduleArrangement` → progress checkpoints → `startRendering` → encode | `renderMixdown.ts:313-384`, seed block `:349-353` |
| F10 | Per-loop bus gain/mute/sends, Beat params and drum voice gains are applied at every pass boundary during the walk (`applyLoopAudioState`) | `renderMixdown.ts:138-182, 208-233` |
| F11 | The event → bus mapping is `songTrackVoice(loop, track).source` (`chord`, `bass`, `pad`, `lead`→`synth`, `fx`); drums → `'sequencer'` | `plan/songSnapshot.ts:260-273`; `renderMixdown.ts:189-199`; `renderMidi.ts:100-111` |
| F12 | The snapshot carries the raw mute flag, never solo | `store/mixdownSnapshot.ts:56-58`; ADR-0036 F8 |
| F13 | `snapshot.buses` / `loop.buses` hold exactly the six `SOURCE_BUSES` in order `synth, chord, bass, pad, fx, sequencer`; `src/audio/` may not import that table (store) | `store/sourceBuses.ts:44-75`; `store/mixdownSnapshot.ts:33, 59` |
| F14 | `encodeWavBytes(channels, sampleRate)` exists beside `encodeWav`: 16-bit PCM, samples clamped to ±1 | `utils/encodeWav.ts:1-17, 32, 70, 84` |
| F15 | A kind is one `ExportKindSpec`; `ExportKindId` is `'mixdown-wav' \| 'midi'` with the comment "DEV-429 adds stems"; the dialog row id is `btn-export-${kind.id}` | `store/exportKinds.ts:21-22, 113-117`; `components/export/ExportDialog.tsx:22` |
| F16 | The runner downloads with `downloadBlob(fileName, blob)` and reports `render-failed` under `kind.incidentOperation` | `store/exportSlice.ts:81`; `store/exportJob.ts:94` |
| F17 | `ReportableOperation` is `'boot' \| 'mixdown' \| 'midi-export' \| 'project-load' \| 'project-save'` | `incidents/operationFailure.ts:8` |
| F18 | The golden test spies `AudioEngine.prototype` methods, hashes the rendered WAV and compares a call log; neither file may change | `renderMixdownGolden.test.ts:1-40`, `.wav.sha256`, `.calls.json` |
| F19 | Tests render for real through `node-web-audio-api`'s `OfflineAudioContext` | `renderMixdown.test.ts:2, 46`; `package.json` |
| F20 | `masterGain` is created at 1.0 and `setMasterVolume` targets the snapshot value | `masterRack.ts:517-518, 1228-1238` |
| F21 | ADR-0037 item 13 already fixed the stem tap point: "dry, tapped at the bus after its fader; sends are ignored for the stem output" | `docs/decisions/0037-per-track-sends.md:56` |
| F22 | Test-only readers are Knip-ignored by name pattern (`smfTestReader`) | `knip.json:15` |

---

## 1. Goal

One WAV per track bus, rendered from the song timeline (DEV-420) through the shared live/offline
engine (ADR-0021), delivered as one ZIP through the export feature (DEV-421), so a user can mix
the song in a DAW.

## 2. Non-goals

- Wet stems (a stem with its sends, or per-track effect returns). Per-track FX changes.
- A stem of the master effect returns, or of the master bus.
- Normalisation, dithering, 24-bit or float output, other sample rates.
- ZIP compression, ZIP64, a streaming/`showSaveFilePicker` writer.

---

## 3. What a stem is (controller decision 1, made concrete)

**A stem is the source bus's output**: everything upstream of the bus gain, times the bus gain.

| In the stem | Not in the stem |
|---|---|
| Every voice routed to that bus (F1), with its patch, velocity, polyphony gain | Its three sends (delay, reverb, distortion) and every effect they feed (F2) |
| The bus fader and mute, **per loop**, exactly as the mixdown automates them (F3, F10) | EQ, compressor, limiter, master gain (F6) |
| Beat: the per-voice track faders (`beatVoiceGains`) and the drum filter bank (F4) | Beat: the per-voice `reverbSend` path (F5) — it is a send |
| | Solo — the snapshot never carries it (F12) |

Tap point = the bus node's output, i.e. the same node `getSourceLevelAnalyser` observes (F7) and
the same point ADR-0037 item 13 named (F21). No new node is inserted into the live graph.

### 3.1 Silent tracks — skip only an **empty** track

**Rule:** a stem is written iff at least one `note`/`drum` item of the song walk targets its bus
(F11). A track with content is written even when it is muted in every loop (its file is then
near-silent); a track with no content anywhere is omitted from the ZIP. If no track has content,
the export fails with `empty-arrangement`.

Why this rule is clean: no voice ever feeds a bus that no event reaches, so every node upstream of
it (for Beat: the idle voice faders and filter bank, whose state starts at zero) carries exact
zeros and its output is exactly 0.0 for every sample — skipping it loses nothing, provably. Content is also what the
walk already tells the renderer for free (§5.3), before encoding.

*Rejected:* skip when the track is inaudible (R297's `eventAudible`, the MIDI rule). Not clean for
audio: a note triggered in a pass where the bus is muted still has a release tail that sounds once
the next pass unmutes the bus (F10), so "no audible event" can still be non-silent audio.
*Also rejected:* skip when every rendered sample is 0. A mute at a later pass is `setTargetAtTime`
(F3): the bus approaches 0 and does not reach it, so a muted-with-content stem is tiny but non-zero, and the
rule would depend on float underflow. *Also rejected:* always write six files — a store-only ZIP
pays full size for silence (≈ 10.6 MB per minute per stem).

---

## 4. Routing — the stem tap

```
synth voice ─► sourceTap[src] (unity) ─► sourceBus[src]  (fader × mute, per-pass automation)
                                          │
                                          ├─► dryGain ─► EQ ─► masterGain ─► comp/limiter ─► masterOutput
                                          │                                                  (stems: a detached
                                          │                                                   sink, never the
                                          │                                                   destination)
                                          ├─► send[src].delay / .reverb / .distortion ─► gates ─► effects ─► EQ …
                                          │
                                          └─► stemTap[i]: GainNode gain 1, channelCount 2,
                                                 channelCountMode 'explicit', interpretation 'speakers'
                                               ─► ChannelSplitter(2) ─► ChannelMerger(12) inputs 2i, 2i+1
                                               ─► ctx.destination (12 ch, 'discrete')

drum env ─► drumTrackGain[voice] ─► drumBusFilter bank ─► sourceTap[sequencer] ─► sourceBus[sequencer] ─► (as above)
drum env ─► per-voice reverbSend ─► drumSendFilter bank ─► drumSendGate ─► send[sequencer].reverb ─► convolver
                                                                                  (never reaches the stem)
```

- **`stemTap` forces stereo.** A bus's channel count follows its inputs (`'max'`); a mono voice
  yields a mono bus, which the mixdown's stereo destination up-mixes to L = R. The explicit
  2-channel `'speakers'` tap performs that same up-mix, so a stem's L/R equals the bus's
  contribution to the mixdown's L/R.
- **Engine additions (render-only, opt-in):**
  - `createRenderEngine(ctx, options?: RenderEngineOptions)` with
    `RenderEngineOptions = { masterOutput?: AudioNode }`, threaded `bindContext(ctx, options)` →
    `AudioSession.create(ctx, hooks, factories, options)` → `masterRack.bind(ctx, options.masterOutput)`.
    `rewireMasterDynamics` connects its last stage to `this.masterOutput ?? this.ctx.destination`
    (`masterRack.ts:738`). Omitted options = today's behaviour, byte for byte; the realtime
    singleton never passes one.
  - `AudioEngine.connectSourceStem(source: string, target: AudioNode): void` →
    `MasterRack.connectSourceStem` → `this.getSourceBus(source).connect(target)`. Like
    `getSourceLevelAnalyser`, an extra bus edge with no gate involved, so R303/R304 hold.
- **The master is detached, not deleted.** It is still built identically (the seeded reverb
  impulse is drawn inside `setupMasterChain`, F9), so the RNG stream is unchanged; its output goes
  to an unconnected `GainNode`, so nothing of it reaches the file.

---

## 5. Render algorithm

### 5.1 Approach: one render, twelve channels (controller decision 3)

**Chosen — (b) one offline render with split outputs.** One `OfflineAudioContext(12, length,
44100)`; stem *i* (in `STEM_TRACKS` order) on channels `2i`, `2i+1` via the tap in §4.

| Criterion | (b) one 12-ch render — chosen | (a) six renders, one bus each |
|---|---|---|
| Sample alignment | By construction: one graph, one clock | By determinism of six identical graphs |
| RNG determinism | One `withSeededRandom(MIXDOWN_SEED)` build + walk, the same calls as the mixdown | Same, repeated six times |
| CPU | 1× the mixdown (+ 6 taps) | 6× the mixdown, including six reverb impulses |
| Peak memory | 12-ch float32 (≈ 127 MB/min of song) + encoded WAVs (≈ 63.5 MB/min) | 2-ch float32 (≈ 21 MB/min) + encoded WAVs |
| Progress / abort | One sweep; abort at schedule yields, after render, between encodes | Six sweeps to stitch; abort also between renders |
| Golden | Untouched (opt-in engine options, §7) | Untouched (same opt-ins needed: the tap and the detached master) |

Both need the same two engine opt-ins, so the choice is CPU against memory. Every export pays
(a)'s 6× CPU; (b)'s memory is ≈ 190 MB per minute of song at peak (≈ 0.6 GB for a 3-minute song),
which a desktop tab holds. A song long enough to fail allocation fails `new OfflineAudioContext`
or `startRendering`, which the renderer's `try` turns into `render-failed` (§8) — never a corrupt
file. *Rejected:* (a) — six times the wait on every export to save memory only on very long songs;
it stays the recorded fallback in ADR-0038 if field incidents under `'stems-export'` show
allocation failures.

**Post-review correction:** the ≈ 190 MB/min peak above counts the 12-ch float buffer and the six
encoded WAVs but omits `new Blob(encodeZipStore(entries, modified))`, which copies that same WAV
payload again in a browser and stays alive alongside `entries` until `renderStems` returns. The
true peak is nearer 254 MB/min (≈ 0.76 GB for a 3-minute song): 127 MB/min (buffer) + 63.5 MB/min
(WAVs in `entries`) + 63.5 MB/min (the `Blob`'s own copy). See ADR-0038 Consequences.

### 5.2 Shared body, extracted without changing the mixdown

`renderMixdown.ts` gains one exported function; `renderMixdown` keeps its signature, result and
call order and becomes guards-and-encode around it:

```ts
export interface SongRenderLayout {
  channels: number;
  /** Stems: the master rack's last stage connects to an unconnected sink instead of the destination. */
  detachMaster?: boolean;
  /** Runs inside the seeded block after applyMasterState, before the walk. Must not draw from the RNG. */
  wire?: (engine: AudioEngine, ctx: OfflineAudioContext) => void;
}
export type SongBufferResult =
  | { ok: true; buffer: AudioBuffer; sourcesWithEvents: ReadonlySet<string> }
  | { ok: false; reason: MixdownFailureReason };
export function renderSongBuffer(
  snapshot: MixdownSnapshot, layout: SongRenderLayout,
  report: MixdownProgressReporter, signal?: AbortSignal,
): Promise<SongBufferResult>;
```

`renderSongBuffer` is today's `renderMixdown` from the `aborted` guard through
`report({ phase: 'rendering', percent: 100 })`, the `setTimeout(0)` yield and the abort check —
same order, same seed block. The only additions: `layout.channels` instead of
`MIXDOWN_CHANNELS`; when `detachMaster`, `const sink = ctx.createGain()` (never connected) is
passed as `createRenderEngine(ctx, { masterOutput: sink })`; `layout.wire?.(engine, ctx)` after
`applyMasterState`; and `scheduleArrangement` adds `songTrackVoice(...).source` / `'sequencer'`
to a `Set` for every performed item (no RNG, no engine call). `renderMixdown` passes
`{ channels: 2 }` and then does exactly today's encoding tail. The whole body stays in one `try`.

`wire` runs **after** `applyMasterState` so the six buses are created in the mixdown's order
(`applyMasterState` builds them in `snapshot.buses` order through `setSourceState`); the tap only
adds edges to existing nodes.

### 5.3 `renderStems` (`src/audio/export/renderStems.ts`, new)

```ts
/** Zip order and file suffix per engine source; a store test asserts it covers SOURCE_BUSES once (F13). */
export const STEM_TRACKS: readonly { source: string; name: string }[] = [
  { source: 'chord', name: 'chord' }, { source: 'bass', name: 'bass' }, { source: 'pad', name: 'pad' },
  { source: 'synth', name: 'lead' }, { source: 'fx', name: 'fx' }, { source: 'sequencer', name: 'beat' },
];
export const STEM_CHANNELS = STEM_TRACKS.length * 2; // 12

export type StemsRenderResult =
  | { ok: true; buffer: AudioBuffer; blob: Blob; entries: readonly string[] }
  | { ok: false; reason: MixdownFailureReason };

export function renderStems(
  snapshot: MixdownSnapshot, baseName: string, modified: Date,
  onProgress?: MixdownProgressReporter, signal?: AbortSignal,
): Promise<StemsRenderResult>; // never throws
```

1. `renderSongBuffer(snapshot, { channels: 12, detachMaster: true, wire }, report, signal)` where
   `wire` sets `ctx.destination.channelInterpretation = 'discrete'`, builds one
   `ChannelMerger(12)` → destination, and per track *i* a `stemTap` → `ChannelSplitter(2)` →
   merger inputs `2i`/`2i+1`, then `engine.connectSourceStem(source, stemTap)`.
   A failed result is returned as is.
2. `kept = STEM_TRACKS.filter(t => sourcesWithEvents.has(t.source))`; empty → `empty-arrangement`.
3. `report({ phase: 'encoding' })`; for each kept track: `setTimeout(0)` yield, abort check
   (→ `cancelled`), `encodeWavBytes([ch 2i, ch 2i+1], MIXDOWN_SAMPLE_RATE)`, entry name
   `${baseName}-${name}.wav`.
4. `encodeZipStore(entries, modified)` → `new Blob(chunks, { type: 'application/zip' })`.
5. Any throw → `{ kind: 'render-failed', detail }`, as `renderMixdown` does.

Same sample rate (44 100), bit depth (16) and length (body + tail) as the mixdown WAV, so a stem
dropped at 0:00 in a DAW lines up with the mixdown sample for sample (controller decision 4).

### 5.4 Level and clipping

No normalisation. A stem carries its bus gain, which can reach +12 dB (`MAX_FADER_GAIN`), and none
of the master's limiter or master gain. `encodeWavBytes` clamps each sample to ±1 (F14), so a stem
whose bus exceeds 0 dBFS **hard-clips in the file** even when the mixdown (default limiter on) does
not. Accepted and documented in ADR-0038: the stem is the bus signal, and the fix — pulling the
fader down — is the user's mix decision. No warning notice (the runner has no per-kind warning
channel, R294).

---

## 6. ZIP format (controller decision 2)

`src/audio/export/zipStore.ts`, new. One consumer (the stems kind), so it stays with the feature
(R276), like `smfWriter.ts`. *Rejected:* `src/utils/zip.ts` — lift it when a second layer needs it.
No npm dependency.

```ts
export interface ZipEntry { name: string; data: Uint8Array<ArrayBuffer> }
export function crc32(bytes: Uint8Array, seed?: number): number;             // unsigned 32-bit
export function dosDateTime(date: Date): { date: number; time: number };      // local time
export function encodeZipStore(entries: readonly ZipEntry[], modified: Date): Uint8Array<ArrayBuffer>[];
```

- **CRC-32:** IEEE 802.3, reflected polynomial `0xEDB88320`, init `0xFFFFFFFF`, final XOR
  `0xFFFFFFFF`, a 256-entry table built once at module load. `seed` lets a caller continue a CRC.
- **Per entry, a local file header** (30 bytes + name), all little-endian: signature
  `0x04034b50`; version needed `10`; flags `0x0800` (UTF-8 name — names are `TextEncoder` bytes);
  method `0` (stored); DOS time, DOS date; CRC-32; compressed size = uncompressed size =
  `data.byteLength`; name length; extra length `0`. Then the name, then the data **by reference**
  (the returned chunk list holds the WAV's own `Uint8Array`, no copy). No data descriptor.
- **Central directory**, one 46-byte + name record per entry: signature `0x02014b50`; version made
  by `20` (host 0, MS-DOS); version needed `10`; same flags, method, time, date, CRC, sizes, name
  length; extra/comment length `0`; disk `0`; internal attrs `0`; external attrs `0`; local header
  offset.
- **End of central directory**, 22 bytes: `0x06054b50`; disk numbers `0`, `0`; entries on disk and
  total = count; CD size; CD offset; comment length `0`.
- **DOS time/date:** `time = h << 11 | m << 5 | floor(s / 2)`, `date = (y − 1980) << 9 | month << 5 |
  day`, from the `Date`'s local fields; years before 1980 clamp to 1980-01-01 00:00:00, after 2107
  to 2107-12-31 23:59:58. The kind passes `new Date()` (export time); tests pass a fixed date.
- **Limits (no ZIP64):** throws `RangeError` when count > 65 535, any size or offset, the CD size
  or the CD offset > `0xFFFFFFFF`. A throw inside `renderStems` is `render-failed` (§8). At
  ≈ 63.5 MB per minute for six stems this is a ≈ 67-minute song — memory fails well before.
- **Names:** `${slug}-${track}.wav`; the slug (`slugifyProjectName`) is `[a-z0-9-]` and falls back to
  `project`, so names are ASCII, unique and path-free.

Order in the archive = `STEM_TRACKS` order (chord, bass, pad, lead, fx, beat) — the MIDI lane
order, so a user importing both sees the same track order.

---

## 7. The golden mixdown stays byte-identical

- `renderMixdownGolden.test.ts`, `.wav.sha256` and `.calls.json` are not edited and not re-recorded.
- `renderMixdown` keeps its call sequence: `createRenderEngine(ctx)` gets no options (so
  `rewireMasterDynamics` connects to `ctx.destination` as today), `layout.wire` is absent, and
  the event-source `Set` performs no engine call and draws no random number.
- The extraction of `renderSongBuffer` is its own commit, verified by the golden before the stems
  code lands (the golden localises any drift to the first differing call, F18).

---

## 8. Kind registration, dialog, errors, abort

`src/store/exportKinds.ts` — `ExportKindId` becomes `'mixdown-wav' | 'midi' | 'stems'` (the "DEV-429
adds stems" comment goes), and:

```ts
export const STEMS_FAILURE_MESSAGE: Record<Exclude<ExportFailureReason['kind'], 'cancelled'>, string> = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops or no notes.',
  'unsupported-context': 'This browser cannot render audio offline, so the stems could not be written.',
  'render-failed': 'The stems could not be rendered. Your project is unchanged; try again.',
};
export function stemsFileName(projectName: string | null): string; // `${slugifyProjectName(projectName ?? '')}-stems.zip`

const STEMS_EXPORT: ExportKindSpec = {
  id: 'stems',
  label: 'Export stems (WAV, .zip)',
  progressLabels: { rendering: 'Rendering stems', encoding: 'Encoding stems' },
  failureMessages: STEMS_FAILURE_MESSAGE,
  incidentOperation: 'stems-export',
  run: async (snapshot, onProgress, signal) => {
    const baseName = slugifyProjectName(snapshot.projectName ?? '');
    const rendered = await renderStems(snapshot.song, baseName, new Date(), onProgress, signal);
    if (!rendered.ok) return rendered;
    return { ok: true, blob: rendered.blob, fileName: stemsFileName(snapshot.projectName) };
  },
};
```

`EXPORT_KIND_BY_ID` gains `stems: STEMS_EXPORT` after `midi`, so the dialog lists it third as
`btn-export-stems`. `src/incidents/operationFailure.ts` `ReportableOperation` gains
`'stems-export'`. Nothing in `exportJob.ts`, `exportSlice.ts`, `Header.tsx` or
`src/components/export/` changes (R293): the runner already downloads one `Blob` with
`downloadBlob` (F16) — the ZIP is that one Blob, which is why one archive and not six downloads.

| Case | Result |
|---|---|
| Cancel before start / during a schedule yield / after `startRendering` / between stem encodes | `cancelled`, no notice, no file (the runner's existing handling) |
| Cancel during `startRendering` | Honoured when it returns — an offline render cannot be interrupted; same as the mixdown |
| No loops | `empty-arrangement` (the `renderSongBuffer` guard) |
| Loops, but no event on any bus | `empty-arrangement`, stems sentence covers "no notes" |
| No `OfflineAudioContext` | `unsupported-context` |
| Context allocation / render / encode / ZIP limit throws | `render-failed` + incident under `'stems-export'` |
| Project name null or unsluggable | `project-stems.zip` with `project-<track>.wav` |
| Track muted in every loop but with content | Written (near-silent), per §3.1 |
| Arp `'random'` | Same notes as the mixdown: same seed, same build, same walk (§5.1) |
| Beat filter type change between loops | In the Beat stem, exactly as in the mixdown (filter bank is upstream of the bus, F4) |

---

## 9. Placement and layers

| File | Change |
|---|---|
| `src/audio/export/renderMixdown.ts` | Extract `renderSongBuffer` + `SongRenderLayout`; source `Set` in `scheduleArrangement` |
| `src/audio/export/renderStems.ts` | **New.** `STEM_TRACKS`, `STEM_CHANNELS`, `renderStems` |
| `src/audio/export/zipStore.ts` | **New.** `crc32`, `dosDateTime`, `encodeZipStore` |
| `src/audio/engine.ts`, `runtime/audioSession.ts`, `masterRack.ts` | `RenderEngineOptions.masterOutput`; `connectSourceStem` |
| `src/store/exportKinds.ts`, `src/incidents/operationFailure.ts` | §8 |
| Tests | `zipStore.test.ts`, test-only `zipTestReader.ts`, `renderStems.test.ts`, `exportKinds.test.ts` rows |

`renderStems.ts` imports only `src/audio/`, `src/utils/` — no store (R028). It calls no lane planner
(R287) and consumes the walk only through `renderSongBuffer` (R288). `zipTestReader.ts` is added to
the `knip.json:15` ignore pattern beside `smfTestReader`.

---

## 10. Testing strategy

**`zipStore.test.ts`**
- CRC vectors: `""` → `0x00000000`, `"123456789"` → `0xCBF43926`, `"The quick brown fox jumps over
  the lazy dog"` → `0x414FA339`; `crc32(b, crc32(a))` equals `crc32(a ++ b)`.
- `dosDateTime(new Date(2026, 8, 22, 12, 34, 56))` → time `0x645C`, date `0x5D36`; 1979 and 2108 clamp.
- Golden bytes: one entry `a.txt` = `"hi"` at that date encodes to a literal hex string (30 + 5 + 2
  local, 46 + 5 central, 22 EOCD = 110 bytes) — every field of §6 at its offset.
- Payload by reference: the chunk list contains the entry's own `Uint8Array` instance.
- Throws `RangeError` for 65 536 entries; the size/offset guard is tested through a helper taking
  plain numbers (no 4 GiB allocation).
- Round trip with `zipTestReader.ts` (test-only, ~60 lines: EOCD → central directory → local
  headers; checks signatures, method 0, sizes, offsets and recomputes the CRC) on three entries of
  random bytes: names, order and bytes come back identical.
- One-off during implementation (not in the gate): the archive of a real stems export passes
  `unzip -t` and opens in macOS Archive Utility.

**`renderStems.test.ts`** (real rendering through `node-web-audio-api`, fixtures from `mixdownFixture.ts`)
- **Sum ≈ pre-master mix:** a fixture with every track sounding, all sends 0, `reverbWet`,
  `delayWet`, `distortionWet` 0, `eqBypass` true, compressor and limiter off, `masterVolume` 1
  (F20: no master ramp): for every sample and channel,
  `|mixdown − Σ stems| ≤ 1e-5` (float summation order only).
- **Same notes as the mixdown:** spy the golden's `METHODS` on `AudioEngine.prototype` for a
  mixdown and a stems render of the golden fixture (arp `'random'` included) — the two call logs
  are equal.
- **Dry means dry:** changing any track's sends, any master effect (EQ, reverb, delay, distortion,
  compressor, limiter) or `masterVolume` leaves every stem's samples bit-identical.
- **Beat:** changing a voice's `reverbSend` leaves the Beat stem bit-identical; changing the Beat
  filter cutoff changes it; a drum voice gain of 0 removes that voice.
- **Mute/fader:** a bus muted in loop 2 of 3 is ≈ 0 (≤ 1e-4 from 100 ms = 10 τ after the boundary) in loop 2's span of its
  stem and unchanged elsewhere; solo in the store changes nothing (via `buildMixdownSnapshot`).
- **Silent rule:** a song with no pad content yields five entries without `-pad`; a muted-everywhere
  lead with content is present; no content at all → `empty-arrangement`.
- Shape: each stem stereo, `length` equals the mixdown's; entry names and order; blob type
  `application/zip`.
- Cancel before start and at the first schedule yield → `cancelled`; progress `preparing →
  rendering… → encoding`; a thrown `encodeZipStore` → `render-failed`.

**Golden:** `renderMixdownGolden.test.ts` passes with its three files unchanged
(`git diff --stat main -- src/audio/export/renderMixdownGolden*` is empty for this branch's commits).

**`exportKinds.test.ts`:** `stemsFileName('My Song')` → `my-song-stems.zip`, null →
`project-stems.zip`; `EXPORT_KINDS` order `['mixdown-wav', 'midi', 'stems']`; `STEM_TRACKS`
sources equal `SOURCE_BUSES` sources as a set, each once. **Dialog:** existing row-per-kind tests
cover the third row without edits.

---

## 11. Rules, ADR and doc sync (same branch)

**ADR-0038 "Dry stems: one render, bus taps, one ZIP"** — §3 tap point and the silent rule, §5.1
(b) chosen with (a) as the recorded fallback, §5.4 clipping, §6 format, the widening of R287.

**Rules R307–R311** in `.claude/rules/export.md` (new `## Stems` section; add
`src/audio/export/renderStems.ts` and `src/audio/export/zipStore.ts` to `paths:`), each with a
`## Prohibited` line:

- **R307** — A stem is its source bus's output, after the fader, mute and (Beat) drum filter bank
  and voice faders, tapped by `connectSourceStem`; it contains no send, no Beat per-voice reverb
  feed, no master-rack stage (EQ, compressor, limiter, reverb, delay, distortion, master gain), and
  no solo. *Prohibited:* a stem tapped anywhere but the bus output, or one carrying a send, a master
  stage or solo.
- **R308** — Stems are one offline render: a `STEM_CHANNELS`-channel context, stem *i* on channels
  `2i`/`2i+1`, the master rack's output detached, with the mixdown's seed, walk, sample rate, bit
  depth and length. *Prohibited:* one render per bus, or a stem render with its own seed or length.
- **R309** — Stem wiring is opt-in: `createRenderEngine(ctx)` without options and `renderMixdown`
  keep the call sequence the golden records; the golden is never re-recorded for stems.
  *Prohibited:* a stem-driven change to the mixdown's calls, graph or golden files.
- **R310** — A stem is written iff a walk event targets its bus; mute never decides it; none at all
  is `empty-arrangement`. No normalisation; samples clamp at ±1. *Prohibited:* skipping by
  audibility or by sample content, or normalising a stem.
- **R311** — Stems download as one store-only ZIP from `zipStore.ts` (method 0, CRC-32, no ZIP64,
  throws past 32-bit limits), `<slug>-stems.zip` with `<slug>-<track>.wav` in `STEM_TRACKS` order;
  no npm ZIP dependency. *Prohibited:* several downloads, a compressing or third-party ZIP writer.

Also: `playback.md` R287's sentence and its Prohibited line gain "`renderStems.ts` likewise" (a
scope widening recorded in ADR-0038); `synth-voices.md` gets a pointer after R303 — "the
render-only stem edge off a bus is R307 (`export.md`); it feeds no gate" (no rule change);
`CLAUDE.md` rules-table row for `export.md` gains "; stems (dry bus taps, one ZIP)";
`docs/architecture/feature-overview.md` export row; `structure/03-audio.md` (`renderStems.ts`,
`zipStore.ts`, `renderSongBuffer`, `connectSourceStem`, `RenderEngineOptions`);
`structure/02-store.md` (three kinds); ADR-0037 is not edited (item 13 is fulfilled as written).

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | The `renderSongBuffer` extraction drifts the mixdown | Own commit; golden hash + call log must pass unchanged (§7) |
| K2 | Memory on long songs (≈ 254 MB/min peak, §5.1 correction) | Allocation failure is `render-failed` + incident; (a) is the recorded fallback |
| K3 | A browser's `OfflineAudioContext` rejects 12 channels | The spec requires ≥ 32; a throw is `render-failed`, reported under `'stems-export'` |
| K4 | A mono bus fills only the left stem channel | `stemTap` is explicit 2-ch `'speakers'` (§4); the sum test would fail on R ≠ mix |
| K5 | Stems clip where the mixdown did not | Documented (§5.4); faders are the user's mix |

---

## 13. Decisions for user review

1. Stem = bus output after fader/mute (per loop); Beat includes voice faders and filter bank; no sends, no Beat per-voice reverb, no master rack, no solo.
2. One 12-channel offline render with a stereo tap per bus; master built but detached. Six renders rejected (6× CPU).
3. Same seed, walk, 44.1 kHz, 16-bit, length as the mixdown; sample-aligned with it.
4. Skip a track only when no walk event targets its bus; muted-with-content is written; nothing at all → `empty-arrangement`.
5. No normalisation; hard clip at ±1 in the encoder, documented.
6. One `<slug>-stems.zip`, entries `<slug>-{chord,bass,pad,lead,fx,beat}.wav` in that order.
7. In-house store-only ZIP (`zipStore.ts`, CRC-32, UTF-8 flag, DOS time = export time, no ZIP64).
8. Kind `stems`, label "Export stems (WAV, .zip)", incident `'stems-export'`, MIME `application/zip`.
9. Engine opt-ins: `createRenderEngine(ctx, { masterOutput })`, `connectSourceStem`; the mixdown passes neither.
10. ADR-0038, rules R307–R311, R287 widened.

## 14. Acceptance criteria

- The Export dialog shows "Export stems (WAV, .zip)"; it downloads one `<slug>-stems.zip` whose
  WAVs open in a DAW, line up with the mixdown WAV at 0:00, and sum (with neutral master and zero
  sends) to the mixdown.
- A track with no content has no file; a muted track with content has one.
- `exportJob.ts`, `exportSlice.ts`, `Header.tsx`, `src/components/export/` and the three golden
  files are unchanged; `renderMixdownGolden` passes.
- No new dependency in `package.json`.
- `bun run verify` green; `bun run eslint` zero errors, zero warnings; both Knip scans zero.
