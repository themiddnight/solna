# ADR-0035: Export as a feature — one job, kinds as data

**Status:** Accepted — 2026-09-22. DEV-421

## Context

The export flow was split across `store/mixdownSlice.ts` (render, failure notice, incident) and
`Header.tsx` (`runMixdownExport`: downloading phase, paint yield, download, success and
download-failed notices, `mixdownProgressLabel`). Two lifecycles were stitched together: the
slice cleared progress when the render finished, and the Header re-set it to `downloading`; cancel
worked in the download phase only through a "progress non-null" guard. The structure audit (U7)
named the Header orchestration as misplaced logic. MIDI export (DEV-428) and stems export
(DEV-429) would each have repeated the same split.

## Decision

`exportSlice` holds one session-only `exportJob` and a kind-agnostic phase set; `startExport(kind)`
and `cancelExport()` are its only actions, with a single active job. `runExportJob` owns every step
shared by every kind — capture, paint yields, download, success/failure notices, the incident on
`render-failed`, clearing the job — with every effect injected. Kinds are `ExportKindSpec` entries
in `EXPORT_KINDS` in `src/store/exportKinds.ts`. The store is the lowest layer that may import both
the renderer and the store-built snapshot: `audio/` may not import `store/`, `components/` may
import the store but not the engine, and `data/` imports nothing. The kind contract reuses the
renderer's `MixdownRenderProgress`/`MixdownFailureReason`; `buildMixdownSnapshot(state)` moved to
`store/mixdownSnapshot.ts` as a plain function. The UI lives in `src/components/export/`
(`ExportDialog` on `ui/Modal`, `useExportDialog`, `ExportButton`). Closing the dialog never cancels
the job — the trigger shows a spinner and percent and reopens the dialog; the dialog closes itself
after a successful download.

**The store now performs the download** through the injected `download` dependency. This ends,
for exports only, the earlier comment-level convention "the store decides, the component writes"
— that convention was never a rule or an ADR. The `.solna` copy in the project menu keeps its
component-side download.

**Rejected alternatives:**
- A registry in `src/audio/export/` — audio may not import the store's snapshot builder or
  `AppStore`.
- A registry in `src/data/` — `data/` imports nothing at runtime, and a kind's `run` needs the
  renderer.
- Keeping the download in a component — every kind's UI would repeat it, and the job's lifecycle
  would stay split across layers.
- Closing the dialog cancels the job — rejected by the user: an export is long-running and the
  user may keep working while it renders.
- A job queue — there is no use case; a second start while a job is active is simply a no-op.

## Consequences

A new export kind is one `ExportKindSpec`; the Header and the dialog never change for it. There is
one lifecycle from click to download instead of two stitched together. `audio/export/renderMixdown.ts`
is untouched. A store test of the slice needs a fake `document` for `downloadBlob`.

## Rules this implies

- **R291** — Export state is one session-only `exportJob` in `src/store/exportSlice.ts`, never in `partializeAppState` or `PROJECT_CONTENT_KEYS`; "is an export busy" is `selectExportBusy` and nothing else.
- **R292** — One job at a time: `startExport` while a job is active — `cancelling` and `downloading` included — returns `{ status: 'ignored' }` and changes nothing; there is no queue.
- **R293** — An export kind is data: one `ExportKindSpec` in `src/store/exportKinds.ts`. Adding a kind adds its id and its spec there and edits nothing in `exportJob.ts`, `exportSlice.ts`, `Header.tsx`, `header/headerTools.ts` or `src/components/export/`.
- **R294** — The steps every kind shares — capture in the click's task, the paint yields, download, the success/failure notices, the incident on `render-failed`, clearing the job — live only in `startExport` and `runExportJob`; a kind's `run` renders and names its file and does nothing else.
- **R295** — Closing the export dialog never cancels; only `cancelExport` does (the dialog's Cancel, or `installProject`). The Header's tool list (`header/headerTools.ts`) holds only the song-layer `ExportButton` from `src/components/export/`, which is never disabled because it is the way back into a running job.

## Sources

`docs/superpowers/specs/2026-09-22-dev-421-export-feature-design.md`,
`docs/superpowers/plans/2026-09-22-dev-421-export-feature.md`, Linear DEV-421.
