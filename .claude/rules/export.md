---
paths:
  - "src/store/export*.ts"
  - "src/store/mixdownSnapshot.ts"
  - "src/components/export/**"
  - "src/components/Header.tsx"
  - "src/components/header/headerTools.ts"
  - "src/audio/export/renderMidi.ts"
  - "src/audio/export/smfWriter.ts"
  - "src/audio/export/renderStems.ts"
  - "src/audio/export/zipStore.ts"
---

# Export

The export feature: one session-only job, kinds as data, one runner, one dialog; MIDI and dry stems.

## Job and kinds

- Export state is one session-only `exportJob` in `src/store/exportSlice.ts`, never in `partializeAppState` or `PROJECT_CONTENT_KEYS`; "is an export busy" is `selectExportBusy` and nothing else. <!-- R291 -->
- One job at a time: `startExport` while a job is active — `cancelling` and `downloading` included — returns `{ status: 'ignored' }` and changes nothing; there is no queue. <!-- R292 -->
- An export kind is data: one `ExportKindSpec` in `src/store/exportKinds.ts`. Adding a kind adds its id and its spec there and edits nothing in `exportJob.ts`, `exportSlice.ts`, `Header.tsx`, `header/headerTools.ts` or `src/components/export/`. <!-- R293 -->
- The steps every kind shares — capture in the click's task, the paint yields, download, the success/failure notices, the incident on `render-failed`, clearing the job — live only in `startExport` and `runExportJob`; a kind's `run` renders and names its file and does nothing else. <!-- R294 -->

## UI

- Closing the export dialog never cancels; only `cancelExport` does (the dialog's Cancel, or `installProject`). The Header's tool list (`header/headerTools.ts`) holds only the song-layer `ExportButton` from `src/components/export/`, which is never disabled because it is the way back into a running job. <!-- R295 -->

([ADR-0035](../../docs/decisions/0035-export-feature.md))

## MIDI

- MIDI export is built only from `walkSongTimeline`; `renderMidi.ts` calls no lane planner (`planArrangement` only sizes the walk) and re-derives no arp, rhythm, strum or hold. <!-- R296 -->
- A timeline event is exported iff the WAV makes it audible by routing: its loop's bus row is unmuted with gain > 0 (drums: and the voice's `beatVoiceGains` > 0). Solo never reaches it. <!-- R297 -->
- A MIDI note number comes from `noteMidi` (`@/musicCore`) applied to the timeline's ROOTS name in `renderMidi.ts`; `TimelineEvent` never carries Hz or a note number, and nothing converts Hz to MIDI. <!-- R298 -->
- `GM_DRUM_NOTE` and `MIDI_TIME_SIGNATURE` are `Record`s over `BeatVoiceId` and `MeterId`; they and `MIDI_LANES` live beside the MIDI builder, not in `src/data/`. <!-- R299 -->
- On one channel and pitch at most one note sounds: a same-tick duplicate merges, a later start cuts the earlier note; note-offs precede note-ons at equal ticks. <!-- R300 -->

([ADR-0036](../../docs/decisions/0036-midi-export-from-song-timeline.md))

## Stems

- A stem is its source bus's output, after the fader, mute and (Beat) drum filter bank and voice faders, tapped by `connectSourceStem`; it contains no send, no Beat per-voice reverb feed, no master-rack stage (EQ, compressor, limiter, reverb, delay, distortion, master gain), and no solo. <!-- R307 -->
- Stems are one offline render: a `STEM_CHANNELS`-channel context, stem *i* on channels `2i`/`2i+1`, the master rack's output detached, with the mixdown's seed, walk, sample rate, bit depth and length. <!-- R308 -->
- Stem wiring is opt-in: `createRenderEngine(ctx)` without options and `renderMixdown` keep the call sequence the golden records; the golden is never re-recorded for stems. <!-- R309 -->
- A stem is written iff a walk event targets its bus; mute never decides it; none at all is `empty-arrangement`. No normalisation; samples clamp at ±1. <!-- R310 -->
- Stems download as one store-only ZIP from `zipStore.ts` (method 0, CRC-32, no ZIP64, throws past 32-bit limits), `<slug>-stems.zip` with `<slug>-<track>.wav` in `STEM_TRACKS` order; no npm ZIP dependency. <!-- R311 -->

([ADR-0038](../../docs/decisions/0038-dry-stems.md))

## Prohibited

- Export state in a persisted key or a project body, or a second "busy" predicate <!-- R291 -->
- A job queue, a second concurrent job, or a start that interrupts the active one <!-- R292 -->
- Editing the runner, the slice, the Header or the export UI to add a kind <!-- R293 -->
- A kind that downloads, writes a notice, reports an incident or touches `exportJob` <!-- R294 -->
- Cancelling a job when the dialog closes, or export logic in `Header.tsx` or `header/headerTools.ts` <!-- R295 -->
- A lane planner call, or a re-derived arp, rhythm, strum or hold, in `renderMidi.ts` <!-- R296 -->
- Exporting a muted or zero-gain lane or drum voice, or letting solo reach the MIDI <!-- R297 -->
- A MIDI number or Hz on `TimelineEvent`, or a Hz → MIDI conversion <!-- R298 -->
- The GM map, meter table or lane table in `src/data/`, or as a non-`Record` table <!-- R299 -->
- Two sounding instances of one pitch on one channel, or a note-on before a note-off at one tick <!-- R300 -->
- A stem tapped anywhere but the bus output, or one carrying a send, a master stage or solo <!-- R307 -->
- One render per bus, or a stem render with its own seed or length <!-- R308 -->
- A stem-driven change to the mixdown's calls, graph or golden files <!-- R309 -->
- Skipping a stem by audibility or by sample content, or normalising a stem <!-- R310 -->
- Several downloads, a compressing or third-party ZIP writer <!-- R311 -->
