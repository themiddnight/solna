# Export as its own feature — design

**Issue:** DEV-421 "refactor: Export as its own feature".
**Branch:** `refactor/dev-421-export-feature`.
**Status:** Approved design (2026-09-22). This document records it, the facts it was checked
against, and the smaller calls the brief left open (§0, §11).

**User-visible change:** the Header's Export dropdown becomes an Export button that opens an
Export dialog; closing the dialog no longer hides a running export — the button keeps a spinner
and percent and reopens the dialog. Every user-facing string (progress labels, failure notices,
success notice, download-failed notice) and the rendered WAV are unchanged.

---

## 0. Verified facts (checked against the code on this branch)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| F1 | `mixdownSlice.ts` holds `exporting`, `mixdownProgress`, `setMixdownProgress`, `cancelMixdown`, `isMixdownCancelled`, `exportMixdown`, `buildMixdownSnapshot`, `wavFileName`, `MIXDOWN_FAILURE_MESSAGE`, `selectMixdownBusy` and a closure `activeJob` | True | `src/store/mixdownSlice.ts` |
| F2 | Download, the success notice, the download-failed notice, the `downloading` phase and the paint yield live in `Header.tsx` | True | `runMixdownExport`, `MixdownExportDeps`, `MIXDOWN_DOWNLOAD_FAILED_MESSAGE`, `mixdownProgressLabel`, `yieldToBrowserPaint`, `ExportButton` |
| F3 | Two jobs' lifecycles are stitched: the slice clears `mixdownProgress` in its `finally`, then the Header re-sets it to `downloading`; `cancelMixdown` works in the downloading phase only because it also accepts "no active job but progress non-null" | True | `createMixdownSlice` `finally`; `cancelMixdown` guard |
| F4 | `installProject` cancels a running export before swapping content | True | `projectSlice.ts` `installProject` → `ctx.get().cancelMixdown()` |
| F5 | `ProjectMenu` reads `selectMixdownBusy` to append "The export in progress will be cancelled." to the replace confirm | True | `ProjectMenu.tsx` `replaceConfirmMessage`, root `useLiveStore(selectMixdownBusy)` |
| F6 | `renderMixdown(snapshot, onProgress?, signal?)` never throws; it reports `preparing` / `rendering(percent)` / `encoding` and returns `{ok,buffer,blob}` or `{ok:false,reason}` with `MixdownFailureReason` | True | `src/audio/export/renderMixdown.ts` |
| F7 | `MixdownFailureReason` is imported only by `mixdownSlice.ts` outside its file | True | grep; removing that importer without a replacement would make Knip flag the export (R006) |
| F8 | "The store never touches the DOM" is a comment convention (`mixdownSlice.ts`, `projectFileIO.ts` `downloadBlob` docblock), not a rule or ADR | True | grep over `.claude/rules`, `docs/decisions`, `CLAUDE.md` finds nothing |
| F9 | The store layer may import `audio/` and `utils/`; components may import the store but not `audio/engine` | True | `eslint.config.js` store and components blocks; `mixdownSlice.ts` already imports `renderMixdown` and `@/utils/projectFileIO` |
| F10 | No e2e or script references `btn-export*` ids, `exportMixdown` or `buildMixdownSnapshot` | True | grep over the repo |
| F11 | Only one `reportOperationFailure` operation exists for exports: `'mixdown'` (summary "Unexpected failure during mixdown") | True | `src/incidents/operationFailure.ts` `ReportableOperation` |

## 1. Goal

Export becomes a feature with its own store slice, its own job runner and its own UI folder:
one active job, one kind-agnostic phase model, and export kinds as data. Adding MIDI (DEV-428)
or stems (DEV-429) is adding one `ExportKindSpec`; the runner, the slice, the Header and the
dialog do not change. This also closes the mixdown half of audit finding U7 ("Mixdown
orchestration … live in `Header.tsx`").

## 2. Non-goals

- MIDI or stem export (DEV-428 / DEV-429).
- Any change to `src/audio/export/renderMixdown.ts` or its golden (`renderMixdownGolden.*`).
  The file is not edited at all.
- The theme half of U7 (`useTheme` stays in `Header.tsx`).
- The project menu's `.solna` "download a copy" path (`projectSlice` `destination: 'download'`),
  which keeps its component-side download.
- A job queue, concurrent jobs, or export history.

---

## 3. Module layout (file by file)

| File | Change |
|---|---|
| `src/store/mixdownSnapshot.ts` | **New.** `buildMixdownSnapshot(state: AppStore): MixdownSnapshot`, moved verbatim from `mixdownSlice.ts` except it takes the state as an argument (same shape as `playbackPlanSnapshots.ts`, R233). No longer a store action |
| `src/store/exportKinds.ts` | **New.** The kind contract (`ExportKindId`, `ExportKindSpec`, `ExportKindResult`, `ExportSnapshot`, `ExportProgress`, `ExportFailureReason`, `IncidentOperation`), the WAV mixdown kind, the registry `EXPORT_KINDS` + `exportKind(id)`, and the moved `wavFileName` and `MIXDOWN_FAILURE_MESSAGE` |
| `src/store/exportJob.ts` | **New.** The generic runner `runExportJob(deps)`, its injectable `ExportJobDeps`, `ExportJobPhase`, `ExportJob`, `ExportOutcome`, `EXPORT_DOWNLOAD_FAILED_MESSAGE`, `exportSuccessMessage`, `yieldToTask`, `yieldToBrowserPaint` (moved from `Header.tsx`) |
| `src/store/exportSlice.ts` | **New.** `ExportSlice` (`exportJob`, `startExport`, `cancelExport`), `selectExportBusy`, `createExportSlice`. Owns the closure `activeJob` + `AbortController`, snapshot capture and the always-clear `finally` |
| `src/store/mixdownSlice.ts` (+ `.test.ts`) | **Deleted.** Tests move to `mixdownSnapshot.test.ts`, `exportKinds.test.ts`, `exportJob.test.ts`, `exportSlice.test.ts` |
| `src/store/types.ts`, `src/store/store.ts` | `MixdownSlice` → `ExportSlice`; `createMixdownSlice` → `createExportSlice` |
| `src/store/projectSlice.ts` | `installProject` calls `cancelExport()` |
| `src/components/project/ProjectMenu.tsx` | `selectMixdownBusy` → `selectExportBusy` (behaviour unchanged) |
| `src/components/export/useExportDialog.ts` (+ `.test.ts`) | **New.** Pure view helpers (`exportProgressLabel`, `exportStatusView`, `exportTriggerView`, `closesDialogAfter`) and the hook `useExportDialog()` with named return type `UseExportDialog` |
| `src/components/export/ExportDialog.tsx` (+ `.test.tsx`) | **New.** Presentational dialog on `ui/Modal`, explicit props only |
| `src/components/export/ExportButton.tsx` (+ `.test.tsx`) | **New.** The feature's root: calls `useExportDialog()` once, renders the Header trigger and the dialog |
| `src/components/Header.tsx` (+ `.test.tsx`) | Loses `ExportButton`, `runMixdownExport`, `MixdownExportDeps`, `MIXDOWN_DOWNLOAD_FAILED_MESSAGE`, `mixdownProgressLabel`, `yieldToBrowserPaint` and the `Download`/`ChevronDown`-for-export usage; renders `<ExportButton layer={layer} />` from `./export/ExportButton` |
| `src/utils/projectFileIO.ts` | Docblock of `downloadBlob` only: it no longer claims "the store never touches the DOM" |

### 3.1 Where the registry lives, and why

`EXPORT_KINDS` lives in **`src/store/exportKinds.ts`**:

- A kind's `run` needs the renderer (`src/audio/export/`), and the capture it runs on is a store
  concern (`buildMixdownSnapshot` reads `AppStore`, converts dB at the store→audio boundary).
  `src/store/` is the lowest layer that may import both `audio/` and `utils/` (F9).
- `src/audio/` may not import `store/` (R028), so the registry cannot live beside the renderer
  without the kind contract leaking store types downward.
- `src/components/` must not import `audio/engine` (R038); reading the registry from
  `@/store/exportKinds` is an ordinary components→store import, and the dialog reads only `id`
  and `label` from it.
- `src/data/` is factory content that imports nothing at runtime (R020); a spec carrying a `run`
  function that imports the renderer does not belong there.

---

## 4. Types (exact)

### 4.1 `src/store/exportKinds.ts`

```ts
import { renderMixdown, type MixdownFailureReason, type MixdownRenderProgress } from '@/audio/export/renderMixdown';
import type { MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import type { reportOperationFailure } from '@/incidents/operationFailure';

/** Kinds shipped on this build. DEV-428 adds 'midi', DEV-429 'stems'. */
export type ExportKindId = 'mixdown-wav';

/** What a kind reports while it works — the renderer's own phases. */
export type ExportProgress = MixdownRenderProgress;          // preparing | rendering(percent) | encoding
export type ExportFailureReason = MixdownFailureReason;      // empty-arrangement | unsupported-context | cancelled | render-failed(detail)
export type IncidentOperation = Parameters<typeof reportOperationFailure>[0];

/** Captured once, synchronously, in the click's task (before any await). */
export interface ExportSnapshot {
  song: MixdownSnapshot;
  projectName: string | null;
}

export type ExportKindResult =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; reason: ExportFailureReason };

export interface ExportKindSpec {
  id: ExportKindId;
  /** The dialog row. */
  label: string;
  /** Progress wording: `${rendering}… ${percent}%` and `${encoding}…`. */
  progressLabels: { rendering: string; encoding: string };
  /** One sentence per actionable failure; cancellation says nothing. */
  failureMessages: Record<Exclude<ExportFailureReason['kind'], 'cancelled'>, string>;
  /** The incident operation a `render-failed` is reported under. */
  incidentOperation: IncidentOperation;
  /** Renders and names the file. Never downloads, writes a notice or touches the job. */
  run: (
    snapshot: ExportSnapshot,
    onProgress: (progress: ExportProgress) => void,
    signal: AbortSignal,
  ) => Promise<ExportKindResult>;
}
```

The WAV kind:

| Field | Value |
|---|---|
| `id` | `'mixdown-wav'` |
| `label` | `'Export mixdown (WAV)'` (today's dropdown row) |
| `progressLabels` | `{ rendering: 'Rendering mixdown', encoding: 'Encoding WAV' }` |
| `failureMessages` | `MIXDOWN_FAILURE_MESSAGE` (unchanged strings) |
| `incidentOperation` | `'mixdown'` |
| `run` | `renderMixdown(snapshot.song, onProgress, signal)`; on success `{ ok: true, blob, fileName: wavFileName(snapshot.projectName) }`; a failure result is returned as is |

Registry: `const EXPORT_KIND_BY_ID: Record<ExportKindId, ExportKindSpec>` (module-private) is
the one table; `export const EXPORT_KINDS: readonly ExportKindSpec[] = Object.values(EXPORT_KIND_BY_ID)`
(dialog order = insertion order); `export function exportKind(id: ExportKindId): ExportKindSpec`.
A `Record` over the id union makes a declared-but-unregistered kind a compile error.

### 4.2 `src/store/exportJob.ts`

```ts
export type ExportJobPhase = ExportProgress | { phase: 'downloading' } | { phase: 'cancelling' };
/** Session-only; the one piece of export state in the store. */
export type ExportJob = { kind: ExportKindId } & ExportJobPhase;

export type ExportOutcome =
  | { status: 'downloaded'; fileName: string }
  | { status: 'download-failed'; fileName: string }
  | { status: 'failed'; reason: Exclude<ExportFailureReason, { kind: 'cancelled' }> }
  | { status: 'cancelled' }
  | { status: 'ignored' };                 // a start while a job is active

export interface ExportJobDeps {
  kind: ExportKindSpec;
  snapshot: ExportSnapshot;
  signal: AbortSignal;
  /** Publishes a phase for the job; the slice drops it once the job is aborted or superseded. */
  publish: (phase: ExportJobPhase) => void;
  setNotice: (message: string) => void;
  download: (fileName: string, blob: Blob) => void;
  yieldToTask: () => Promise<void>;
  yieldToBrowserPaint: () => Promise<void>;
  reportFailure: (operation: IncidentOperation, detail: string) => void;
}

export const EXPORT_DOWNLOAD_FAILED_MESSAGE =
  'Could not write the file. Check the browser’s download settings.';   // today's MIXDOWN_DOWNLOAD_FAILED_MESSAGE
export function exportSuccessMessage(fileName: string): string;          // `Exported ${fileName}.`
export function runExportJob(deps: ExportJobDeps): Promise<ExportOutcome>;
export function yieldToTask(): Promise<void>;                           // setTimeout(0)
export function yieldToBrowserPaint(): Promise<void>;                   // rAF×2, setTimeout(0) fallback
```

### 4.3 `src/store/exportSlice.ts`

```ts
export interface ExportSlice {
  exportJob: ExportJob | null;
  startExport: (kind: ExportKindId) => Promise<ExportOutcome>;
  cancelExport: () => void;
}
export function selectExportBusy(s: AppStore): boolean;   // s.exportJob !== null
export function createExportSlice(set: Set, get: Get): ExportSlice;
```

`exportJob` is session state: absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`,
never persisted, never version-bumped (R035/R251).

## 5. The job lifecycle

`startExport(kindId)`:

1. If a job is active (closure `activeJob !== null`), return `{ status: 'ignored' }` — no state
   change, no second render.
2. Create `{ controller: new AbortController() }`, set `activeJob`.
3. **Capture in the click's task:** `snapshot = { song: buildMixdownSnapshot(get()), projectName: get().projectName }`.
   A project replacement during the paint yield can never split audio from its name.
4. `set({ exportJob: { kind, phase: 'preparing' } })`.
5. `await runExportJob({...})` with `publish` guarded by `activeJob === job && !signal.aborted`,
   `setNotice` → `set({ projectNotice })`, `download` → `downloadBlob`, the two yields,
   `reportFailure` → `reportOperationFailure(op, new Error(detail), 'degraded')`.
6. `finally`: if `activeJob === job`, clear `activeJob` and `set({ exportJob: null })`. One
   lifecycle from click to download (fixes the stitching in F3).

`runExportJob(deps)` — the steps every kind shares, in order:

1. `await yieldToTask()` so React paints `preparing` before the synchronous scheduling walk.
2. If aborted → `{ status: 'cancelled' }`.
3. `result = await kind.run(snapshot, publish, signal)`; a rejected `run` is treated as
   `{ ok: false, reason: { kind: 'render-failed', detail: <message> } }` (§11 D5).
4. Failure: `cancelled` → `{ status: 'cancelled' }`, no notice. Otherwise
   `setNotice(kind.failureMessages[reason.kind])`; only `render-failed` also calls
   `reportFailure(kind.incidentOperation, reason.detail)`; return `{ status: 'failed', reason }`.
5. Success: if aborted → `cancelled` (§11 D6). Else `publish({ phase: 'downloading' })`, then
   `await yieldToBrowserPaint()`; if aborted now → `cancelled` (no download, no notice).
6. `download(fileName, blob)`; if it throws → `setNotice(EXPORT_DOWNLOAD_FAILED_MESSAGE)`,
   `{ status: 'download-failed', fileName }`, no success notice.
7. `setNotice(exportSuccessMessage(fileName))` only after the download returned;
   `{ status: 'downloaded', fileName }`.

`cancelExport()`: if no active job, no-op. Otherwise abort the controller and
`set({ exportJob: { kind: <current kind>, phase: 'cancelling' } })`. The job stays active (busy)
until the render drains and the `finally` clears it — so a start during `cancelling` is
`ignored`, as the disabled row enforced before. `installProject` calls `cancelExport()` first,
exactly where it called `cancelMixdown()`.

## 6. UI — `src/components/export/`

### 6.1 Pure helpers (in `useExportDialog.ts`)

| Helper | Output |
|---|---|
| `exportProgressLabel(job: ExportJob): string` | `preparing` → `'Preparing arrangement…'`; `rendering` → `` `${spec.progressLabels.rendering}… ${percent}%` `` (`'Rendering mixdown… 35%'`); `encoding` → `` `${spec.progressLabels.encoding}…` `` (`'Encoding WAV…'`); `cancelling` → `'Cancelling…'`; `downloading` → `'Downloading…'` — today's strings exactly |
| `exportStatusView(job: ExportJob \| null): ExportStatusView \| null` | `null` when idle; else `{ label: exportProgressLabel(job), percent: job.phase === 'rendering' ? job.percent : null, canCancel: job.phase !== 'cancelling' }` |
| `exportTriggerView(job: ExportJob \| null): ExportTriggerView` | idle → `{ busy: false, text: 'Export', ariaLabel: 'Export' }`; rendering → `{ busy: true, text: '35%', ariaLabel: 'Rendering mixdown… 35%' }`; other phases → `{ busy: true, text: null, ariaLabel: <progress label> }` |
| `closesDialogAfter(outcome: ExportOutcome): boolean` | `true` only for `'downloaded'` (§11 D3) |

```ts
export interface ExportStatusView { label: string; percent: number | null; canCancel: boolean }
export interface ExportTriggerView { busy: boolean; text: string | null; ariaLabel: string }
export interface UseExportDialog {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  busy: boolean;
  status: ExportStatusView | null;
  trigger: ExportTriggerView;
  start: (kind: ExportKindId) => void;
  cancel: () => void;
}
export function useExportDialog(): UseExportDialog;
```

The hook: `open` in `useState(false)`; `job = useLiveStore((s) => s.exportJob)`,
`busy = useLiveStore(selectExportBusy)`, `startExport`, `cancelExport` — one value per selector
(R274); `useLiveStore` so `renderToString` tests see `setState` (R257). `start(kind)` calls
`startExport(kind)` and closes the dialog when `closesDialogAfter(outcome)`.

### 6.2 `ExportDialog` (presentational)

```ts
export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  kinds: readonly Pick<ExportKindSpec, 'id' | 'label'>[];
  busy: boolean;
  status: ExportStatusView | null;
  onStart: (kind: ExportKindId) => void;
  onCancel: () => void;
}
```

`<Modal open onClose title="Export" size="sm" boxClassName="space-y-4">`, then:

- One row button per kind: `id="btn-export-${kind.id}"` (`btn-export-mixdown-wav`),
  `className="btn btn-sm btn-outline justify-start"`, `disabled={busy}`, text `kind.label`.
- When `status` is non-null, a status block `id="export-status"` `role="status"`
  `aria-live="polite"`: the label; a daisyUI `progress progress-primary w-full` with
  `value={percent} max={100}` while rendering, or an indeterminate `progress w-full` (no `value`)
  otherwise; and, when `canCancel`, `id="btn-cancel-export"` "Cancel export"
  (`btn btn-sm btn-ghost`).
- No stem/MIDI row and no "coming soon" (a control that cannot work on this build is not
  advertised — today's rule).

`onClose` (header ×, Escape, backdrop) only closes. **It never cancels** (Decision A).

### 6.3 `ExportButton` (root, rendered by Header)

`ExportButton({ layer }: { layer: Layer })` calls `useExportDialog()` once (R268), then returns
`null` unless `layer === 'song'`. It renders:

- The trigger `id="btn-export"`, `className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"`,
  `aria-haspopup="dialog"`, `aria-label={trigger.ariaLabel}`, `title={trigger.ariaLabel}`,
  `aria-busy={trigger.busy}`, **never `disabled`**, `onClick={openDialog}`. Idle: `Download`
  icon + `<span className="hidden sm:inline">Export</span>`. Busy: `loading loading-spinner
  loading-sm` + the percent text when `trigger.text` is non-null.
- `<ExportDialog open={open} onClose={closeDialog} kinds={EXPORT_KINDS} … />`.

Header keeps only `<ExportButton layer={layer} />` at today's position (after
`FollowPlayheadToggle`).

## 7. Behaviour matrix (old → new)

| Situation | Before | After |
|---|---|---|
| Start | Dropdown row | Dialog row |
| Progress visible | Trigger label + row label | Dialog status block; trigger spinner + percent |
| Cancel | Inline "Cancel export" beside trigger | "Cancel export" in the dialog |
| Close UI mid-job | Dropdown closes, trigger shows label | Dialog closes, job continues, trigger reopens the dialog |
| Second start while busy | Trigger + row disabled | Row disabled; `startExport` returns `ignored` |
| Cancel during `downloading` | Via "progress non-null" guard | Same job, abort → `cancelled` after paint |
| Project replaced mid-job | `cancelMixdown` | `cancelExport` |
| Success | Toast `Exported x.wav.` | Same toast; dialog closes |
| Failure | Failure toast, incident on `render-failed` | Same; dialog stays open |
| ProjectMenu replace confirm | Mentions cancelling while busy | Same (`selectExportBusy`) |

## 8. Testing plan

No DOM, no testing-library (R266, testing.md). Tests:

- `mixdownSnapshot.test.ts` — the six `buildMixdownSnapshot` tests from `mixdownSlice.test.ts`,
  names kept, called as `buildMixdownSnapshot(useAppStore.getState())`.
- `exportKinds.test.ts` — `wavFileName`; registry (`EXPORT_KINDS` ids unique, `exportKind(id)`
  returns the same object, the WAV row label); the WAV kind's `run` on a real snapshot returns an
  `audio/wav` blob named from the captured `projectName`, and on an empty arrangement returns
  `empty-arrangement` (uses `node-web-audio-api` `OfflineAudioContext` on `globalThis`, as the
  old slice test did).
- `exportJob.test.ts` — `runExportJob` with a fake kind: success order
  (`downloading`, paint, download, success notice), render failure writes the kind's message,
  `render-failed` reports the incident and nothing else does, cancelled writes nothing, abort
  during paint suppresses download and success, download throw → `EXPORT_DOWNLOAD_FAILED_MESSAGE`,
  a rejecting `run` → `render-failed`, abort before run → no `run` call. Ported from the
  `runMixdownExport` describe in `Header.test.tsx`.
- `exportSlice.test.ts` — through the real store with a fake `document` + `URL` object-URL pair
  installed on `globalThis` for `downloadBlob`: phases published and cleared; success downloads
  one `my-song.wav` and writes the success notice; capture before the yield; cancel →
  `cancelling` then `cancelled`, no notice; a second start while busy → `ignored`; `newProject`
  cancels; empty arrangement notice; incident on `render-failed`; `cancelExport` with no job is a
  no-op; `exportJob` absent from `partializeAppState`, starts `null`.
- `useExportDialog.test.ts` — the four pure helpers, every phase.
- `ExportDialog.test.tsx` — `renderToString` with props: idle rows, busy rows disabled,
  rendering status + `progress-primary` + Cancel, cancelling has no Cancel, no stem/"coming soon".
- `ExportButton.test.tsx` — `renderToString` via the store: song layer renders the trigger, loop
  layer renders nothing, busy trigger shows spinner + `35%` and is **not** disabled.
- `Header.test.tsx` — the `ExportButton` and `runMixdownExport` describes leave; the
  subject-before-tabs source-order tests stay; a new source test asserts Header imports
  `ExportButton` from `./export/ExportButton`.
- Must stay green unchanged: every `src/audio/export/*` test including `renderMixdownGolden`;
  `ProjectMenu` tests.

## 9. Rules and ADR (doc sync, same branch)

New rules file `.claude/rules/export.md` (paths: `src/store/export*.ts`,
`src/store/mixdownSnapshot.ts`, `src/components/export/**`, `src/components/Header.tsx`), rules
R291–R295, ADR-0035 "Export as a feature: one job, kinds as data":

- **R291** — Export state is one session-only `exportJob` (`src/store/exportSlice.ts`), never in
  `partializeAppState` or `PROJECT_CONTENT_KEYS`; "is an export busy" is `selectExportBusy` only.
- **R292** — One job at a time: `startExport` while a job is active (including `cancelling`) is a
  no-op returning `{ status: 'ignored' }`; no queue.
- **R293** — An export kind is data: one `ExportKindSpec` in `src/store/exportKinds.ts`; adding a
  kind never edits `exportJob.ts`, `exportSlice.ts`, `Header.tsx` or `src/components/export/`
  beyond the kind table.
- **R294** — The steps every kind shares (capture in the click's task, paint yield, download,
  notices, incident on `render-failed`, clearing the job) live only in
  `startExport`/`runExportJob`; a kind's `run` renders and names its file and does nothing else.
- **R295** — Closing the export dialog never cancels; only `cancelExport` does (the dialog's
  Cancel, or `installProject`). The Header holds only the song-layer `ExportButton` from
  `src/components/export/`.

Also: R031's wording in `playback.md` and `synth-voices.md` and ADR-0021 point at
`store/mixdownSnapshot.ts` (a renamed-file correction, allowed in place); `playback.md`'s
`paths:` swaps `src/store/mixdownSlice.ts` for `src/store/mixdownSnapshot.ts`. `CLAUDE.md` gets
one row in its rules table for `export.md` — no new cross-cutting invariant line (the rules are
feature-local and path-scoped). Architecture docs: `feature-overview.md`,
`structure/01-ui.md`, `structure/02-store.md`, `structure/README.md` (U7 mixdown half marked
fixed).

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Store now touches the DOM through `downloadBlob` | Only via the injected `download` dep; `runExportJob` tests inject a fake; slice tests install a fake `document`; ADR-0035 records the change of convention (F8) |
| R2 | Golden drift | `renderMixdown.ts` is not edited; every store task runs `bun test src/audio/export` |
| R3 | A job leaks `busy` forever if `run` rejects | Runner catches the rejection (D5); slice `finally` clears |
| R4 | Stale progress after cancel/replace overwrites `cancelling` | `publish` guard `activeJob === job && !signal.aborted` |
| R5 | `renderToString` trap hides state in tests | All store reads in the feature go through `useLiveStore`; `ExportDialog` is prop-driven |

## 11. Decisions made in spec

- **D1 Registry in `src/store/exportKinds.ts`** — §3.1.
- **D2 Kind contract reuses the renderer's types.** `ExportProgress = MixdownRenderProgress`,
  `ExportFailureReason = MixdownFailureReason`: the renderer is untouched and its exported types
  keep an importer (F7). A future kind returns the same failure union.
- **D3 The dialog closes itself after a successful download** (the toast reports it). It stays
  open after a failure so the user can retry, and after a cancellation.
- **D4 Per-kind wording lives in the spec** (`progressLabels`, `failureMessages`,
  `incidentOperation`); the three generic labels (`Preparing arrangement…`, `Cancelling…`,
  `Downloading…`) live in the view helper. This is what lets the phase set be kind-agnostic
  while keeping today's strings.
- **D5 A rejecting `run` is a `render-failed`** with the error message as `detail`, so a future
  kind that throws cannot wedge the job.
- **D6 An abort observed after a successful render skips straight to `cancelled`** instead of
  flashing `Downloading…` first. Today's code reached the same outcome one paint later.
- **D7 `buildMixdownSnapshot` stops being a store action** and becomes
  `buildMixdownSnapshot(state)`; nothing outside the export and its tests called it (F10).
- **D8 Element ids.** Trigger `btn-export` and cancel `btn-cancel-export` keep their ids; the
  dialog row is `btn-export-${kind.id}`; the dropdown's `export-menu` and `btn-export-mixdown`
  are gone.
- **D9 The trigger is never disabled.** It is the way back into a running job (Decision A);
  starting twice is prevented by the disabled dialog rows and by R292.
- **D10 `outcome` is a new result type** (`ExportOutcome`) instead of `MixdownResult`: the
  runner returns what happened to the whole job (downloaded, download-failed, failed, cancelled,
  ignored), not what the renderer returned.
- **D11 No layer-change reset of `open`.** The dialog is a native modal, so the layer switcher
  cannot be reached while it is open.

## 12. Acceptance criteria

- `mixdownSlice.ts`, `runMixdownExport`, `MixdownExportDeps`, `mixdownProgressLabel`,
  `selectMixdownBusy`, `exporting`, `mixdownProgress` no longer exist (grep is empty in `src/`).
- Header renders only `<ExportButton layer={layer} />` for export; all export UI is in
  `src/components/export/`.
- Every string in §6.1 and §4 matches today's text; `renderMixdownGolden` passes unchanged.
- `bun run verify` green; `bun run eslint` zero errors and zero warnings; both Knip scans zero
  findings.
