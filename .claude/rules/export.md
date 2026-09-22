---
paths:
  - "src/store/export*.ts"
  - "src/store/mixdownSnapshot.ts"
  - "src/components/export/**"
  - "src/components/Header.tsx"
---

# Export

The export feature: one session-only job, kinds as data, one runner, one dialog.

## Job and kinds

- Export state is one session-only `exportJob` in `src/store/exportSlice.ts`, never in `partializeAppState` or `PROJECT_CONTENT_KEYS`; "is an export busy" is `selectExportBusy` and nothing else. <!-- R291 -->
- One job at a time: `startExport` while a job is active — `cancelling` and `downloading` included — returns `{ status: 'ignored' }` and changes nothing; there is no queue. <!-- R292 -->
- An export kind is data: one `ExportKindSpec` in `src/store/exportKinds.ts`. Adding a kind adds its id and its spec there and edits nothing in `exportJob.ts`, `exportSlice.ts`, `Header.tsx` or `src/components/export/`. <!-- R293 -->
- The steps every kind shares — capture in the click's task, the paint yields, download, the success/failure notices, the incident on `render-failed`, clearing the job — live only in `startExport` and `runExportJob`; a kind's `run` renders and names its file and does nothing else. <!-- R294 -->

## UI

- Closing the export dialog never cancels; only `cancelExport` does (the dialog's Cancel, or `installProject`). The Header holds only the song-layer `ExportButton` from `src/components/export/`, which is never disabled because it is the way back into a running job. <!-- R295 -->

([ADR-0035](../../docs/decisions/0035-export-feature.md))

## Prohibited

- Export state in a persisted key or a project body, or a second "busy" predicate <!-- R291 -->
- A job queue, a second concurrent job, or a start that interrupts the active one <!-- R292 -->
- Editing the runner, the slice, the Header or the export UI to add a kind <!-- R293 -->
- A kind that downloads, writes a notice, reports an incident or touches `exportJob` <!-- R294 -->
- Cancelling a job when the dialog closes, or export logic in `Header.tsx` <!-- R295 -->
