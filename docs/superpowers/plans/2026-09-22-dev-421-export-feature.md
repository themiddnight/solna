# DEV-421 Export as Its Own Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export becomes a feature: an `exportSlice` with one session-only `exportJob`, a generic job runner that owns capture → render → download → notices for every kind, export kinds as data (`EXPORT_KINDS`, WAV mixdown first), and an `ExportDialog` in `src/components/export/` opened by a Header `Export` button that shows spinner + percent while a job runs.

**Architecture:** Store first, UI second. Task 1 moves the snapshot builder and the WAV-specific bits out of `mixdownSlice.ts` into `mixdownSnapshot.ts` and the kind registry `exportKinds.ts`. Task 2 adds the pure, dependency-injected runner `runExportJob` (absorbing the Header's `runMixdownExport`). Task 3 swaps `mixdownSlice` for `exportSlice` everywhere and rewires the old Header dropdown minimally. Tasks 4–5 build `src/components/export/` and reduce Header to one `<ExportButton>`. Tasks 6–7 sync rules/ADR/docs and run the gate.

**Tech Stack:** TypeScript, React 19 + Vite, zustand, daisyUI v5 + Tailwind, Bun test runner (`bun:test`, `renderToString` only — no DOM), `node-web-audio-api` `OfflineAudioContext` in store tests, ESLint flat config, Knip.

**Spec:** `docs/superpowers/specs/2026-09-22-dev-421-export-feature-design.md` — binding. Read §4 (types), §5 (lifecycle), §6 (UI) and §11 (decisions) before any task.

## Global Constraints

- Branch: `refactor/dev-421-export-feature` (already checked out). Never push. Never commit on `main`. Never switch branches.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **`src/audio/export/renderMixdown.ts` is not edited, at all.** Every store task runs `bun test src/audio/export` and the golden (`renderMixdownGolden.test.ts`) must pass with its files byte-unchanged. Never run with `GOLDEN_UPDATE=1`.
- **Strings are preserved verbatim** (spec §4, §6.1): `'Preparing arrangement…'`, `` `Rendering mixdown… ${percent}%` ``, `'Encoding WAV…'`, `'Cancelling…'`, `'Downloading…'`, `'Export mixdown (WAV)'`, `'Cancel export'`, `` `Exported ${fileName}.` ``, `'Could not write the file. Check the browser’s download settings.'` (typographic apostrophe `’`), and the three `MIXDOWN_FAILURE_MESSAGE` sentences. The ellipsis is the single character `…`.
- One job at a time (R292): `startExport` while a job is active — including `cancelling` and `downloading` — returns `{ status: 'ignored' }` and changes nothing.
- `exportJob` is session-only: never in `partializeAppState` or `PROJECT_CONTENT_KEYS` (R035, R251). Do not touch the persist `version`.
- Closing the dialog never cancels a job (spec Decision A, R295).
- Layer rules: `src/store/` never imports `src/components/` (R032); `src/components/` never imports `audio/engine` (R038); the export UI imports only `@/store/*` and `@/components/*`, never `@/audio/*`.
- Components: logic in the colocated hook `useExportDialog` with a named exported return type (R265, R266); hook called once at the root `ExportButton` (R268); child components defined above the root (R267); one value per store selector, via `useLiveStore` (R274, R257). No testing-library, no DOM (testing.md).
- No re-export shims. Every importer of a moved symbol switches to its new module; Knip flags pass-through exports (R006).
- Gates: `bun run verify` is the completion gate (R004). `bun run eslint` prints **zero errors AND zero warnings** — never ignore a warning, never call one pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>` only for a legitimate exception; never relax a rule globally (R005, R264). Both Knip scans report zero findings (R006) — checked in Task 7; intermediate tasks may leave a Knip finding only where this plan says so.
- ESLint `max-lines-per-function` is 100 (blank lines/comments skipped) and applies to test `describe` callbacks: keep each `describe` under it by splitting. `complexity` warns at 20 and a warning is a failure.
- `../../` imports are banned; use `@/…` across folders and `./` within a folder.
- R001: no counts, versions or line numbers in any doc you write. A rule change updates its `.claude/rules/*.md` file AND its ADR in the same commit.
- Large files (`Header.tsx`, `Header.test.tsx`, `ProjectMenu.tsx`, `projectSlice.ts`, `store.ts`, `types.ts`): use Serena `find_symbol` / `get_symbols_overview` or `grep -n` + line ranges; do not dump whole files.
- daisyUI classes used here (`btn`, `btn-outline`, `btn-ghost`, `progress`, `progress-primary`, `loading loading-spinner`, `modal-*`) are v5 classes; if you add any other class, check it in the daisyUI v5 docs first.

## File map

| File | Task | Change |
|---|---|---|
| `src/store/mixdownSnapshot.ts` (+ `.test.ts`) | 1 | **new** — `buildMixdownSnapshot(state)` moved from `mixdownSlice.ts` |
| `src/store/exportKinds.ts` (+ `.test.ts`) | 1 | **new** — kind contract, WAV kind, `EXPORT_KINDS`, `exportKind`, `wavFileName`, `MIXDOWN_FAILURE_MESSAGE` |
| `src/store/mixdownSlice.ts`, `mixdownSlice.test.ts` | 1, 3 | 1: imports the moved symbols; 3: **deleted** |
| `src/store/exportJob.ts` (+ `.test.ts`) | 2 | **new** — `runExportJob`, deps, outcome, phase/job types, messages, yields |
| `src/store/exportSlice.ts` (+ `.test.ts`) | 3 | **new** — `exportJob`, `startExport`, `cancelExport`, `selectExportBusy` |
| `src/store/types.ts`, `src/store/store.ts` | 3 | `MixdownSlice` → `ExportSlice` |
| `src/store/projectSlice.ts` | 3 | `cancelMixdown()` → `cancelExport()` |
| `src/components/project/ProjectMenu.tsx` | 3 | `selectMixdownBusy` → `selectExportBusy` |
| `src/utils/projectFileIO.ts` | 3 | `downloadBlob` docblock sentence only |
| `src/components/Header.tsx` (+ `.test.tsx`) | 3, 5 | 3: interim rewire of the dropdown to `startExport`; 5: export code removed, renders `<ExportButton>` from `./export/ExportButton` |
| `src/components/export/useExportDialog.ts` (+ `.test.ts`) | 4, 5 | 4: pure helpers + types; 5: the hook |
| `src/components/export/ExportDialog.tsx` (+ `.test.tsx`) | 4 | **new** |
| `src/components/export/ExportButton.tsx` (+ `.test.tsx`) | 5 | **new** — feature root |
| `.claude/rules/export.md`, `docs/decisions/0035-export-feature.md`, `docs/decisions/README.md`, `CLAUDE.md`, `.claude/rules/playback.md`, `.claude/rules/synth-voices.md`, `docs/decisions/0021-shared-live-and-offline-render.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,01-ui,02-store}.md` | 6 | doc sync |

---

### Task 1: `mixdownSnapshot.ts` and the kind registry `exportKinds.ts`

**Files:**
- Create: `src/store/mixdownSnapshot.ts`, `src/store/mixdownSnapshot.test.ts`
- Create: `src/store/exportKinds.ts`, `src/store/exportKinds.test.ts`
- Modify: `src/store/mixdownSlice.ts`, `src/store/mixdownSlice.test.ts`

**Interfaces:**
- Consumes: `renderMixdown`, `MixdownFailureReason`, `MixdownRenderProgress` from `@/audio/export/renderMixdown`; `MixdownSnapshot`, `MixdownLoop` from `@/audio/playback/plan/songSnapshot`; `reportOperationFailure` (type only) from `@/incidents/operationFailure`; `slugifyProjectName` from `@/utils/projectFileIO`.
- Produces:
  - `buildMixdownSnapshot(state: AppStore): MixdownSnapshot` (`src/store/mixdownSnapshot.ts`)
  - From `src/store/exportKinds.ts`: `type ExportKindId = 'mixdown-wav'`; `type ExportProgress = MixdownRenderProgress`; `type ExportFailureReason = MixdownFailureReason`; `type IncidentOperation = Parameters<typeof reportOperationFailure>[0]`; `interface ExportSnapshot { song: MixdownSnapshot; projectName: string | null }`; `type ExportKindResult = { ok: true; blob: Blob; fileName: string } | { ok: false; reason: ExportFailureReason }`; `interface ExportKindSpec { id; label; progressLabels: { rendering: string; encoding: string }; failureMessages: Record<Exclude<ExportFailureReason['kind'], 'cancelled'>, string>; incidentOperation: IncidentOperation; run(snapshot, onProgress, signal): Promise<ExportKindResult> }`; `const EXPORT_KINDS: readonly ExportKindSpec[]`; `function exportKind(id: ExportKindId): ExportKindSpec`; `function wavFileName(projectName: string | null): string`; `const MIXDOWN_FAILURE_MESSAGE`.

- [ ] **Step 1: Move the snapshot tests.** Create `src/store/mixdownSnapshot.test.ts` holding the whole `describe('buildMixdownSnapshot', …)` block cut from `src/store/mixdownSlice.test.ts` (six tests, names unchanged). In it, replace every `useAppStore.getState().buildMixdownSnapshot()` with `buildMixdownSnapshot(useAppStore.getState())`. Header of the new file:

```ts
import { describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { SOURCE_BUSES } from './sourceBuses';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { buildMixdownSnapshot } from './mixdownSnapshot';
```

Delete the `describe('buildMixdownSnapshot', …)` and `describe('wavFileName', …)` blocks from `mixdownSlice.test.ts`, drop its now-unused `SOURCE_BUSES` / `BEAT_VOICE_IDS` imports, and change its import to `import { MIXDOWN_FAILURE_MESSAGE } from './exportKinds';`.

- [ ] **Step 2: Write the registry tests.** Create `src/store/exportKinds.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { buildMixdownSnapshot } from './mixdownSnapshot';
import { EXPORT_KINDS, MIXDOWN_FAILURE_MESSAGE, exportKind, wavFileName } from './exportKinds';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('wavFileName', () => {
  test('slugs the project name and swaps the extension', () => {
    expect(wavFileName('My Song')).toBe('my-song.wav');
    expect(wavFileName('')).toBe('project.wav');
    expect(wavFileName('!!!')).toBe('project.wav');
    expect(wavFileName(null)).toBe('project.wav');
  });
});

describe('export kind registry', () => {
  test('ids are unique and each resolves to its own spec', () => {
    const ids = EXPORT_KINDS.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of EXPORT_KINDS) expect(exportKind(kind.id)).toBe(kind);
  });

  test('ships exactly the WAV mixdown, labelled as the old menu row was', () => {
    expect(EXPORT_KINDS.map((kind) => [kind.id, kind.label])).toEqual([
      ['mixdown-wav', 'Export mixdown (WAV)'],
    ]);
  });

  test('the WAV kind keeps the mixdown wording and incident operation', () => {
    const wav = exportKind('mixdown-wav');
    expect(wav.progressLabels).toEqual({ rendering: 'Rendering mixdown', encoding: 'Encoding WAV' });
    expect(wav.failureMessages).toBe(MIXDOWN_FAILURE_MESSAGE);
    expect(wav.incidentOperation).toBe('mixdown');
  });

  test('the failure sentences are unchanged', () => {
    expect(MIXDOWN_FAILURE_MESSAGE).toEqual({
      'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
      'unsupported-context': 'This browser cannot render audio offline, so the mixdown could not be written.',
      'render-failed': 'The mixdown could not be rendered. Your project is unchanged; try again.',
    });
  });
});

describe('the WAV kind run', () => {
  test('renders the captured song and names the file from the captured project name', async () => {
    const snapshot = { song: buildMixdownSnapshot(useAppStore.getState()), projectName: 'My Song' };
    const phases: string[] = [];
    const result = await exportKind('mixdown-wav').run(
      snapshot,
      (progress) => phases.push(progress.phase),
      new AbortController().signal,
    );
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    expect(result.fileName).toBe('my-song.wav');
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBeGreaterThan(44);
    expect(phases).toContain('rendering');
    expect(phases).toContain('encoding');
  });

  test('an empty arrangement is returned as the renderer reported it', async () => {
    const song = { ...buildMixdownSnapshot(useAppStore.getState()), loops: [] };
    const result = await exportKind('mixdown-wav').run(
      { song, projectName: null },
      () => {},
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('an already-aborted signal returns cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await exportKind('mixdown-wav').run(
      { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
      () => {},
      controller.signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });
});
```

- [ ] **Step 3: Run both new tests to verify they fail**

Run: `bun test src/store/mixdownSnapshot.test.ts src/store/exportKinds.test.ts`
Expected: FAIL — `Cannot find module './mixdownSnapshot'` / `'./exportKinds'`.

- [ ] **Step 4: Create `src/store/mixdownSnapshot.ts`.** Move the private `buildMixdownSnapshot(get)` function from `mixdownSlice.ts` **with its whole docblock and every inline comment**, changing only the signature and first line:

```ts
/**
 * The arrangement snapshot every export kind renders from.
 * Takes the state as an argument, like `playbackPlanSnapshots.ts` (R233).
 */
import type { MixdownLoop, MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { getMeter } from '@/utils/meter';
import { buildProjectContent } from './projectFormat';
import { faderDbToGain } from './levelUnits';
import { SOURCE_BUSES } from './sourceBuses';
import type { AppStore } from './types';

// (moved docblock here)
export function buildMixdownSnapshot(s: AppStore): MixdownSnapshot {
  const content = buildProjectContent(s);
  // … body unchanged from mixdownSlice.ts (everything after `const s = get();`) …
}
```

- [ ] **Step 5: Create `src/store/exportKinds.ts`:**

```ts
/**
 * Export kinds as data (R293). Each kind renders and names one file; the steps
 * every kind shares — capture, yields, download, notices, incident, clearing
 * the job — belong to `exportSlice.ts` / `exportJob.ts` (R294), never to a kind.
 *
 * The registry lives in the store because a kind's `run` needs the renderer
 * (`src/audio/export/`) and runs on a store-built snapshot: `src/store/` is the
 * lowest layer allowed to import both, and components read it without
 * touching `audio/engine` (ADR-0035).
 */
import {
  renderMixdown,
  type MixdownFailureReason,
  type MixdownRenderProgress,
} from '@/audio/export/renderMixdown';
import type { MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import type { reportOperationFailure } from '@/incidents/operationFailure';
import { slugifyProjectName } from '@/utils/projectFileIO';

/** Kinds shipped on this build. DEV-428 adds MIDI, DEV-429 stems. */
export type ExportKindId = 'mixdown-wav';

/** A kind reports the renderer's phases: preparing, rendering(percent), encoding. */
export type ExportProgress = MixdownRenderProgress;
export type ExportFailureReason = MixdownFailureReason;
export type IncidentOperation = Parameters<typeof reportOperationFailure>[0];

/** Captured once, synchronously, in the click's task — before any await. */
export interface ExportSnapshot {
  song: MixdownSnapshot;
  projectName: string | null;
}

export type ExportKindResult =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; reason: ExportFailureReason };

export interface ExportKindSpec {
  id: ExportKindId;
  /** The dialog row's text. */
  label: string;
  /** `${rendering}… ${percent}%` and `${encoding}…`. */
  progressLabels: { rendering: string; encoding: string };
  /** One sentence per actionable failure; cancellation is deliberate and says nothing. */
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

/**
 * One sentence per failure, in the same voice as `SAVE_FAILED_MESSAGE`: what
 * happened, and what the user can do about it. A `Record` over the reason's
 * `kind`, so a new actionable failure is a compile error here instead of an
 * empty toast.
 */
export const MIXDOWN_FAILURE_MESSAGE: Record<Exclude<ExportFailureReason['kind'], 'cancelled'>, string> = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
  'unsupported-context': 'This browser cannot render audio offline, so the mixdown could not be written.',
  'render-failed': 'The mixdown could not be rendered. Your project is unchanged; try again.',
};

/** The file name a WAV export downloads: the project's slug, with a `.wav` extension. */
export function wavFileName(projectName: string | null): string {
  return `${slugifyProjectName(projectName ?? '')}.wav`;
}

const MIXDOWN_WAV_EXPORT: ExportKindSpec = {
  id: 'mixdown-wav',
  label: 'Export mixdown (WAV)',
  progressLabels: { rendering: 'Rendering mixdown', encoding: 'Encoding WAV' },
  failureMessages: MIXDOWN_FAILURE_MESSAGE,
  incidentOperation: 'mixdown',
  run: async (snapshot, onProgress, signal) => {
    const rendered = await renderMixdown(snapshot.song, onProgress, signal);
    if (!rendered.ok) return rendered;
    return { ok: true, blob: rendered.blob, fileName: wavFileName(snapshot.projectName) };
  },
};

/** The one table. A `Record` over the id union: a declared, unregistered kind is a compile error. */
const EXPORT_KIND_BY_ID: Record<ExportKindId, ExportKindSpec> = {
  'mixdown-wav': MIXDOWN_WAV_EXPORT,
};

/** Every kind, in dialog order (insertion order of the table above). */
export const EXPORT_KINDS: readonly ExportKindSpec[] = Object.values(EXPORT_KIND_BY_ID);

export function exportKind(id: ExportKindId): ExportKindSpec {
  return EXPORT_KIND_BY_ID[id];
}
```

- [ ] **Step 6: Point `mixdownSlice.ts` at the moved code.** In `src/store/mixdownSlice.ts`: delete the private `buildMixdownSnapshot` function, `MIXDOWN_FAILURE_MESSAGE`, `wavFileName`, and the imports only they used (`MixdownLoop`, `BEAT_VOICE_IDS`, `getMeter`, `slugifyProjectName`, `buildProjectContent`, `faderDbToGain`, `SOURCE_BUSES`). Add:

```ts
import { MIXDOWN_FAILURE_MESSAGE, wavFileName } from './exportKinds';
import { buildMixdownSnapshot } from './mixdownSnapshot';
```

Change the two call sites: the slice action becomes `buildMixdownSnapshot: () => buildMixdownSnapshot(get()),` and inside `exportMixdown` `const snapshot = buildMixdownSnapshot(get());`. The `MixdownSnapshot` type import stays (the `MixdownSlice` interface names it).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/store/mixdownSnapshot.test.ts src/store/exportKinds.test.ts src/store/mixdownSlice.test.ts src/components/Header.test.tsx src/audio/export`
Expected: PASS, golden unchanged.

- [ ] **Step 8: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no errors, zero warnings.

- [ ] **Step 9: Commit**

```bash
git add src/store/mixdownSnapshot.ts src/store/mixdownSnapshot.test.ts src/store/exportKinds.ts src/store/exportKinds.test.ts src/store/mixdownSlice.ts src/store/mixdownSlice.test.ts
git commit -m "refactor(export): export kind registry and standalone mixdown snapshot

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The generic job runner `runExportJob`

**Files:**
- Create: `src/store/exportJob.ts`, `src/store/exportJob.test.ts`

**Interfaces:**
- Consumes (Task 1): `ExportKindId`, `ExportKindSpec`, `ExportKindResult`, `ExportSnapshot`, `ExportProgress`, `ExportFailureReason`, `IncidentOperation` from `./exportKinds`.
- Produces (from `src/store/exportJob.ts`):

```ts
export type ExportJobPhase = ExportProgress | { phase: 'downloading' } | { phase: 'cancelling' };
export type ExportJob = { kind: ExportKindId } & ExportJobPhase;
export type ExportOutcome =
  | { status: 'downloaded'; fileName: string }
  | { status: 'download-failed'; fileName: string }
  | { status: 'failed'; reason: Exclude<ExportFailureReason, { kind: 'cancelled' }> }
  | { status: 'cancelled' }
  | { status: 'ignored' };
export interface ExportJobDeps { kind; snapshot; signal; publish; setNotice; download; yieldToTask; yieldToBrowserPaint; reportFailure }
export const EXPORT_DOWNLOAD_FAILED_MESSAGE: string;
export function exportSuccessMessage(fileName: string): string;
export function runExportJob(deps: ExportJobDeps): Promise<ExportOutcome>;
export function yieldToTask(): Promise<void>;
export function yieldToBrowserPaint(): Promise<void>;
```

- [ ] **Step 1: Write the failing tests.** Create `src/store/exportJob.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import type { ExportKindSpec } from './exportKinds';
import {
  EXPORT_DOWNLOAD_FAILED_MESSAGE,
  exportSuccessMessage,
  runExportJob,
  type ExportJobDeps,
} from './exportJob';

const WAV = new Blob(['wav'], { type: 'audio/wav' });

function fakeKind(run: ExportKindSpec['run']): ExportKindSpec {
  return {
    id: 'mixdown-wav',
    label: 'Fake',
    progressLabels: { rendering: 'Rendering fake', encoding: 'Encoding fake' },
    failureMessages: {
      'empty-arrangement': 'empty',
      'unsupported-context': 'unsupported',
      'render-failed': 'failed',
    },
    incidentOperation: 'mixdown',
    run,
  };
}

const okRun: ExportKindSpec['run'] = async (_snapshot, onProgress) => {
  onProgress({ phase: 'rendering', percent: 100 });
  return { ok: true, blob: WAV, fileName: 'my-song.wav' };
};

interface Harness {
  deps: ExportJobDeps;
  events: string[];
  notices: string[];
  incidents: [string, string][];
  controller: AbortController;
}

function harness(kind: ExportKindSpec, overrides: Partial<ExportJobDeps> = {}): Harness {
  const events: string[] = [];
  const notices: string[] = [];
  const incidents: [string, string][] = [];
  const controller = new AbortController();
  const deps: ExportJobDeps = {
    kind,
    snapshot: { song: {} as MixdownSnapshot, projectName: 'My Song' },
    signal: controller.signal,
    publish: (p) => events.push(p.phase === 'rendering' ? `rendering ${p.percent}` : p.phase),
    setNotice: (message) => notices.push(message),
    download: (fileName) => events.push(`download ${fileName}`),
    yieldToTask: async () => {
      events.push('task');
    },
    yieldToBrowserPaint: async () => {
      events.push('paint');
    },
    reportFailure: (operation, detail) => incidents.push([operation, detail]),
    ...overrides,
  };
  return { deps, events, notices, incidents, controller };
}

describe('runExportJob — success and delivery', () => {
  test('yields, renders, paints Downloading, downloads, then says so', async () => {
    const h = harness(fakeKind(okRun));
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'downloaded', fileName: 'my-song.wav' });
    expect(h.events).toEqual(['task', 'rendering 100', 'downloading', 'paint', 'download my-song.wav']);
    expect(h.notices).toEqual(['Exported my-song.wav.']);
  });

  // The download is the one step that can throw AFTER a full render — a
  // blocked download, a sandboxed frame. Silent here, the user waits out a
  // render, gets no file and is told nothing.
  test('a download that throws is reported, and claims no success', async () => {
    const h = harness(fakeKind(okRun), {
      download: () => {
        throw new Error('blocked');
      },
    });
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'download-failed', fileName: 'my-song.wav' });
    expect(h.notices).toEqual([EXPORT_DOWNLOAD_FAILED_MESSAGE]);
  });

  test('the messages keep their wording', () => {
    expect(exportSuccessMessage('a.wav')).toBe('Exported a.wav.');
    expect(EXPORT_DOWNLOAD_FAILED_MESSAGE).toBe('Could not write the file. Check the browser’s download settings.');
  });
});

describe('runExportJob — failures', () => {
  test('a render failure writes the kind\'s sentence and downloads nothing', async () => {
    const h = harness(fakeKind(async () => ({ ok: false, reason: { kind: 'empty-arrangement' } })));
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'failed', reason: { kind: 'empty-arrangement' } });
    expect(h.notices).toEqual(['empty']);
    expect(h.events).toEqual(['task']);
    expect(h.incidents).toEqual([]);
  });

  test('only render-failed is reported as an incident', async () => {
    const h = harness(fakeKind(async () => ({ ok: false, reason: { kind: 'render-failed', detail: 'boom' } })));
    await runExportJob(h.deps);
    expect(h.notices).toEqual(['failed']);
    expect(h.incidents).toEqual([['mixdown', 'boom']]);
  });

  test('a kind that rejects is a render-failed, never a stuck job', async () => {
    const h = harness(fakeKind(async () => {
      throw new Error('kaput');
    }));
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'failed', reason: { kind: 'render-failed', detail: 'kaput' } });
    expect(h.incidents).toEqual([['mixdown', 'kaput']]);
  });
});

describe('runExportJob — cancellation', () => {
  test('a cancelled render writes nothing', async () => {
    const h = harness(fakeKind(async () => ({ ok: false, reason: { kind: 'cancelled' } })));
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(h.notices).toEqual([]);
    expect(h.incidents).toEqual([]);
  });

  test('an abort before the render starts never runs the kind', async () => {
    let ran = false;
    const h = harness(fakeKind(async (...args) => {
      ran = true;
      return okRun(...args);
    }));
    h.controller.abort();
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(ran).toBe(false);
  });

  test('an abort after a successful render skips Downloading entirely', async () => {
    let controller: AbortController | null = null;
    const h = harness(fakeKind(async (...args) => {
      controller?.abort();
      return okRun(...args);
    }));
    controller = h.controller;
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(h.events).not.toContain('downloading');
    expect(h.notices).toEqual([]);
  });

  test('an abort during the paint suppresses download and success', async () => {
    const h = harness(fakeKind(okRun));
    h.deps.yieldToBrowserPaint = async () => {
      h.controller.abort();
    };
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(h.events).not.toContain('download my-song.wav');
    expect(h.notices).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/exportJob.test.ts`
Expected: FAIL — `Cannot find module './exportJob'`.

- [ ] **Step 3: Implement `src/store/exportJob.ts`:**

```ts
/**
 * The steps every export kind shares (R294): paint the pending state, run the
 * kind, report its failure, hand the file to the browser, say so.
 *
 * Every effect is an injected dependency, so the whole job is testable with
 * no DOM, no store and no renderer. `exportSlice.ts` supplies the real ones
 * and owns what is left: the single active job, snapshot capture in the
 * click's task, and clearing the job afterwards.
 */
import type {
  ExportFailureReason,
  ExportKindId,
  ExportKindResult,
  ExportKindSpec,
  ExportProgress,
  ExportSnapshot,
  IncidentOperation,
} from './exportKinds';

export type ExportJobPhase = ExportProgress | { phase: 'downloading' } | { phase: 'cancelling' };

/** The one piece of export state in the store; session-only (R291). */
export type ExportJob = { kind: ExportKindId } & ExportJobPhase;

/** What happened to the whole job — not what the renderer returned. */
export type ExportOutcome =
  | { status: 'downloaded'; fileName: string }
  | { status: 'download-failed'; fileName: string }
  | { status: 'failed'; reason: Exclude<ExportFailureReason, { kind: 'cancelled' }> }
  | { status: 'cancelled' }
  | { status: 'ignored' };

export interface ExportJobDeps {
  kind: ExportKindSpec;
  snapshot: ExportSnapshot;
  signal: AbortSignal;
  /** Publishes a phase; the slice drops it once the job is aborted or superseded. */
  publish: (phase: ExportJobPhase) => void;
  setNotice: (message: string) => void;
  download: (fileName: string, blob: Blob) => void;
  yieldToTask: () => Promise<void>;
  yieldToBrowserPaint: () => Promise<void>;
  reportFailure: (operation: IncidentOperation, detail: string) => void;
}

/**
 * What a download that threw reads as. The same sentence — and the same
 * reasoning — as `ProjectMenu`'s `downloadCopy`: the anchor/blob path can
 * throw in a restricted embedding, and downloading is best-effort.
 */
export const EXPORT_DOWNLOAD_FAILED_MESSAGE =
  'Could not write the file. Check the browser’s download settings.';

export function exportSuccessMessage(fileName: string): string {
  return `Exported ${fileName}.`;
}

/** Put the render in the next task so React can paint the pending state first. */
export function yieldToTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Let React commit the delivery phase for one visible frame before download. */
export function yieldToBrowserPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return yieldToTask();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** A kind that rejects is a render failure, so no kind can wedge the job. */
async function runKind(deps: ExportJobDeps): Promise<ExportKindResult> {
  try {
    return await deps.kind.run(deps.snapshot, deps.publish, deps.signal);
  } catch (err) {
    return {
      ok: false,
      reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * The failure notice is written here, once: a caller that ignored the outcome
 * would otherwise leave the user with a button that did nothing. Only an
 * exception inside the render is a defect worth an incident; an empty
 * arrangement or an unsupported browser is an expected outcome.
 */
function reportKindFailure(deps: ExportJobDeps, reason: ExportFailureReason): ExportOutcome {
  if (reason.kind === 'cancelled') return { status: 'cancelled' };
  deps.setNotice(deps.kind.failureMessages[reason.kind]);
  if (reason.kind === 'render-failed') deps.reportFailure(deps.kind.incidentOperation, reason.detail);
  return { status: 'failed', reason };
}

/**
 * The success notice is written only after the download has actually
 * returned; a download that throws is reported instead, because on that path
 * the user has waited out a full render and has no file.
 */
async function deliver(deps: ExportJobDeps, blob: Blob, fileName: string): Promise<ExportOutcome> {
  if (deps.signal.aborted) return { status: 'cancelled' };
  deps.publish({ phase: 'downloading' });
  await deps.yieldToBrowserPaint();
  if (deps.signal.aborted) return { status: 'cancelled' };
  try {
    deps.download(fileName, blob);
  } catch {
    deps.setNotice(EXPORT_DOWNLOAD_FAILED_MESSAGE);
    return { status: 'download-failed', fileName };
  }
  deps.setNotice(exportSuccessMessage(fileName));
  return { status: 'downloaded', fileName };
}

export async function runExportJob(deps: ExportJobDeps): Promise<ExportOutcome> {
  await deps.yieldToTask();
  if (deps.signal.aborted) return { status: 'cancelled' };
  const result = await runKind(deps);
  if (!result.ok) return reportKindFailure(deps, result.reason);
  return deliver(deps, result.blob, result.fileName);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/exportJob.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no errors, zero warnings. (Knip is not run here: `yieldToTask`/`yieldToBrowserPaint`/`runExportJob` gain their production importer in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/store/exportJob.ts src/store/exportJob.test.ts
git commit -m "feat(export): generic export job runner with injectable effects

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `exportSlice` replaces `mixdownSlice`

**Files:**
- Create: `src/store/exportSlice.ts`, `src/store/exportSlice.test.ts`
- Delete: `src/store/mixdownSlice.ts`, `src/store/mixdownSlice.test.ts`
- Modify: `src/store/types.ts` (the `MixdownSlice` import and the `AppStore` `extends` list), `src/store/store.ts` (the `createMixdownSlice` import and spread), `src/store/projectSlice.ts` (`installProject`), `src/components/project/ProjectMenu.tsx` (import + root selector), `src/utils/projectFileIO.ts` (`downloadBlob` docblock), `src/components/Header.tsx` (`ExportButton` and its helpers), `src/components/Header.test.tsx` (`ExportButton` / `runMixdownExport` describes and the import line)

**Interfaces:**
- Consumes: Task 1 (`exportKind`, `ExportKindId`, `buildMixdownSnapshot`), Task 2 (`runExportJob`, `yieldToTask`, `yieldToBrowserPaint`, `ExportJob`, `ExportJobPhase`, `ExportOutcome`); `downloadBlob` from `@/utils/projectFileIO`; `reportOperationFailure` from `@/incidents/operationFailure`.
- Produces (from `src/store/exportSlice.ts`):

```ts
export interface ExportSlice {
  exportJob: ExportJob | null;
  startExport: (kind: ExportKindId) => Promise<ExportOutcome>;
  cancelExport: () => void;
}
export function selectExportBusy(s: AppStore): boolean;
export function createExportSlice(set: Set, get: Get): ExportSlice;
```

- [ ] **Step 1: Write the failing slice tests.** Create `src/store/exportSlice.test.ts` (it replaces every `exportMixdown` / session / incident test of `mixdownSlice.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { setOperationFailureSink } from '@/incidents/operationFailure';
import { MIXDOWN_FAILURE_MESSAGE } from './exportKinds';
import { selectExportBusy } from './exportSlice';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

/**
 * `downloadBlob` drives an `<a download>` through `document` and the object-URL
 * pair. The suite has no DOM, so a minimal fake records which file names were
 * "clicked" — the store now owns the download (ADR-0035).
 */
interface FakeDownloads {
  names: string[];
  restore: () => void;
}

function installFakeDownloads(): FakeDownloads {
  const names: string[] = [];
  const g = globalThis as { document?: unknown };
  const previousDocument = g.document;
  const { createObjectURL, revokeObjectURL } = URL;
  g.document = {
    body: { appendChild: () => {} },
    createElement: () => {
      const anchor = { href: '', download: '', click: () => names.push(anchor.download), remove: () => {} };
      return anchor;
    },
  };
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  return {
    names,
    restore: () => {
      if (previousDocument === undefined) delete g.document;
      else g.document = previousDocument;
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    },
  };
}

const initial = useAppStore.getState();
let downloads: FakeDownloads;

beforeEach(() => {
  downloads = installFakeDownloads();
});

afterEach(() => {
  downloads.restore();
  useAppStore.setState({
    projectNotice: initial.projectNotice,
    loops: initial.loops,
    projectName: initial.projectName,
    exportJob: null,
  });
});

describe('startExport — a successful job', () => {
  test('publishes every phase, then clears the job', async () => {
    const phases: unknown[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.exportJob !== null) phases.push(state.exportJob);
    });
    try {
      await useAppStore.getState().startExport('mixdown-wav');
    } finally {
      unsubscribe();
    }
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'preparing' });
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'rendering', percent: 100 });
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'encoding' });
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'downloading' });
    expect(useAppStore.getState().exportJob).toBeNull();
    expect(selectExportBusy(useAppStore.getState())).toBe(false);
  });

  test('downloads one WAV named after the project and says so', async () => {
    useAppStore.setState({ projectName: 'My Song' });
    const outcome = await useAppStore.getState().startExport('mixdown-wav');
    expect(outcome).toEqual({ status: 'downloaded', fileName: 'my-song.wav' });
    expect(downloads.names).toEqual(['my-song.wav']);
    expect(useAppStore.getState().projectNotice).toBe('Exported my-song.wav.');
  });

  test('captures the arrangement and file name before yielding to the browser', async () => {
    useAppStore.setState({ projectName: 'First Project' });
    const pending = useAppStore.getState().startExport('mixdown-wav');
    // A project replacement can land while the preparing state paints. The
    // export must remain one coherent capture.
    useAppStore.setState({ loops: [], projectName: 'Second Project' });
    expect(await pending).toEqual({ status: 'downloaded', fileName: 'first-project.wav' });
  });

  test('a second start while a job runs is ignored', async () => {
    useAppStore.setState({ projectName: 'My Song' });
    const first = useAppStore.getState().startExport('mixdown-wav');
    expect(await useAppStore.getState().startExport('mixdown-wav')).toEqual({ status: 'ignored' });
    await first;
    expect(downloads.names).toEqual(['my-song.wav']);
  });
});

describe('startExport — cancellation', () => {
  test('cancel marks the job cancelling and ends it silently', async () => {
    useAppStore.setState({ projectNotice: null });
    const pending = useAppStore.getState().startExport('mixdown-wav');
    useAppStore.getState().cancelExport();
    expect(useAppStore.getState().exportJob).toEqual({ kind: 'mixdown-wav', phase: 'cancelling' });
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(useAppStore.getState().projectNotice).toBeNull();
    expect(downloads.names).toEqual([]);
    expect(useAppStore.getState().exportJob).toBeNull();
  });

  test('a start while cancelling drains is ignored', async () => {
    const pending = useAppStore.getState().startExport('mixdown-wav');
    useAppStore.getState().cancelExport();
    expect(await useAppStore.getState().startExport('mixdown-wav')).toEqual({ status: 'ignored' });
    await pending;
  });

  test('cancelExport with no job is a no-op', () => {
    useAppStore.getState().cancelExport();
    expect(useAppStore.getState().exportJob).toBeNull();
  });

  test('replacing the project cancels the export before installing new content', async () => {
    const pending = useAppStore.getState().startExport('mixdown-wav');
    void useAppStore.getState().newProject();
    expect(useAppStore.getState().exportJob).toEqual({ kind: 'mixdown-wav', phase: 'cancelling' });
    expect(await pending).toEqual({ status: 'cancelled' });
  });
});

describe('startExport — failures', () => {
  afterEach(() => setOperationFailureSink(null));

  test('an empty arrangement fails with a notice, and the job is cleared anyway', async () => {
    useAppStore.setState({ loops: [] });
    const outcome = await useAppStore.getState().startExport('mixdown-wav');
    expect(outcome).toEqual({ status: 'failed', reason: { kind: 'empty-arrangement' } });
    expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['empty-arrangement']);
    expect(useAppStore.getState().exportJob).toBeNull();
  });

  test('reports a render-failed as an incident but not an empty arrangement', async () => {
    const incidents: string[] = [];
    setOperationFailureSink((input) => incidents.push(input.summary));
    const original = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
    try {
      useAppStore.setState({ loops: [] });
      await useAppStore.getState().startExport('mixdown-wav');
      expect(incidents).toEqual([]);

      useAppStore.setState({ loops: initial.loops });
      (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = class {
        constructor() {
          throw new Error('boom');
        }
      };
      const outcome = await useAppStore.getState().startExport('mixdown-wav');
      expect(outcome.status === 'failed' && outcome.reason.kind).toBe('render-failed');
      expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['render-failed']);
      expect(incidents).toEqual(['Unexpected failure during mixdown']);
    } finally {
      (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = original;
    }
  });
});

describe('the export job is session state', () => {
  test('it is absent from the persisted shape', async () => {
    const { partializeAppState } = await import('./store');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('exportJob' in persisted).toBe(false);
  });

  test('it starts null', () => {
    expect(initial.exportJob).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/exportSlice.test.ts`
Expected: FAIL — `Cannot find module './exportSlice'`.

- [ ] **Step 3: Implement `src/store/exportSlice.ts`:**

```ts
/**
 * The export slice: one session-only job (R291, R292).
 *
 * `exportJob` is SESSION state — absent from `partializeAppState` and
 * `PROJECT_CONTENT_KEYS`, never persisted, never a version bump. The closure
 * `activeJob` is the single-job lock: it is set before the first await and
 * cleared in the `finally`, so one lifecycle runs from click to download.
 */
import type { StoreApi } from 'zustand';
import { reportOperationFailure } from '@/incidents/operationFailure';
import { downloadBlob } from '@/utils/projectFileIO';
import { exportKind, type ExportKindId, type ExportSnapshot } from './exportKinds';
import {
  runExportJob,
  yieldToBrowserPaint,
  yieldToTask,
  type ExportJob,
  type ExportJobPhase,
  type ExportOutcome,
} from './exportJob';
import { buildMixdownSnapshot } from './mixdownSnapshot';
import type { AppStore } from './types';

export interface ExportSlice {
  exportJob: ExportJob | null;
  startExport: (kind: ExportKindId) => Promise<ExportOutcome>;
  cancelExport: () => void;
}

/**
 * Whether an export is running, cancelling or downloading. One predicate so
 * the Header trigger, the dialog and the project menu's replace guard cannot
 * derive "busy" differently.
 */
export function selectExportBusy(s: AppStore): boolean {
  return s.exportJob !== null;
}

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export function createExportSlice(set: Set, get: Get): ExportSlice {
  let activeJob: { controller: AbortController } | null = null;

  return {
    exportJob: null,

    cancelExport: () => {
      const current = get().exportJob;
      if (activeJob === null || current === null) return;
      activeJob.controller.abort();
      set({ exportJob: { kind: current.kind, phase: 'cancelling' } });
    },

    startExport: async (kindId) => {
      if (activeJob !== null) return { status: 'ignored' };
      // Capture content and identity in the click's task, before any await:
      // the paint yield must never let a project replacement split the audio
      // from its name.
      const state = get();
      const snapshot: ExportSnapshot = { song: buildMixdownSnapshot(state), projectName: state.projectName };
      const job = { controller: new AbortController() };
      activeJob = job;
      set({ exportJob: { kind: kindId, phase: 'preparing' } });
      const publish = (phase: ExportJobPhase) => {
        if (activeJob === job && !job.controller.signal.aborted) {
          set({ exportJob: { kind: kindId, ...phase } });
        }
      };
      try {
        return await runExportJob({
          kind: exportKind(kindId),
          snapshot,
          signal: job.controller.signal,
          publish,
          setNotice: (projectNotice) => set({ projectNotice }),
          download: downloadBlob,
          yieldToTask,
          yieldToBrowserPaint,
          reportFailure: (operation, detail) => reportOperationFailure(operation, new Error(detail), 'degraded'),
        });
      } finally {
        if (activeJob === job) {
          activeJob = null;
          set({ exportJob: null });
        }
      }
    },
  };
}
```

- [ ] **Step 4: Wire the slice into the store.**
  - `src/store/types.ts`: replace `import type { MixdownSlice } from './mixdownSlice';` with `import type { ExportSlice } from './exportSlice';` and `MixdownSlice` with `ExportSlice` in the `AppStore` `extends` list.
  - `src/store/store.ts`: replace `import { createMixdownSlice } from './mixdownSlice';` with `import { createExportSlice } from './exportSlice';` and `...createMixdownSlice(setWithLoopMirror, get),` with `...createExportSlice(setWithLoopMirror, get),`.
  - `src/store/projectSlice.ts` `installProject`: `ctx.get().cancelMixdown();` → `ctx.get().cancelExport();` (keep the comment above it).
  - `src/components/project/ProjectMenu.tsx`: `import { selectMixdownBusy } from '@/store/mixdownSlice';` → `import { selectExportBusy } from '@/store/exportSlice';` and `useLiveStore(selectMixdownBusy)` → `useLiveStore(selectExportBusy)`.
  - `src/utils/projectFileIO.ts` `downloadBlob` docblock: replace the sentence "`doc` and `url` are injectable for exactly the reason `downloadTextFile`'s are: the store never touches the DOM, so the component does, and the component's helper is then testable with no DOM at all." with "`doc` and `url` are injectable for exactly the reason `downloadTextFile`'s are: every caller — the project menu's `.solna` copy and the export job (`store/exportSlice.ts`, which injects it into `runExportJob` as its `download` dependency) — stays testable with no DOM at all."
  - Delete `src/store/mixdownSlice.ts` and `src/store/mixdownSlice.test.ts` (`git rm`).

- [ ] **Step 5: Rewire the old Header dropdown (interim; Task 5 replaces it).** In `src/components/Header.tsx`:
  - Delete `MixdownExportDeps`, `MIXDOWN_DOWNLOAD_FAILED_MESSAGE`, `runMixdownExport`, `yieldToBrowserPaint` (all now in `store/exportJob.ts`), and the `downloadBlob` import.
  - Replace the `mixdownSlice` import with:

```tsx
import { selectExportBusy } from "@/store/exportSlice";
import type { ExportJob } from "@/store/exportJob";
```

  - `mixdownProgressLabel` takes the job (body otherwise unchanged):

```tsx
function mixdownProgressLabel(progress: ExportJob | null): string {
  if (!progress || progress.phase === 'preparing') return 'Preparing arrangement…';
  if (progress.phase === 'rendering') return `Rendering mixdown… ${progress.percent}%`;
  if (progress.phase === 'encoding') return 'Encoding WAV…';
  if (progress.phase === 'cancelling') return 'Cancelling…';
  return 'Downloading…';
}
```

  - In `ExportButton`, replace the seven store reads with:

```tsx
  const busy = useLiveStore(selectExportBusy);
  const exportJob = useLiveStore((s) => s.exportJob);
  const startExport = useLiveStore((s) => s.startExport);
  const cancelExport = useLiveStore((s) => s.cancelExport);
  if (layer !== 'song') return null;
  const progressLabel = mixdownProgressLabel(exportJob);
```

  the row's `onClick` with `onClick={() => { void startExport('mixdown-wav'); }}`, `mixdownProgress?.phase !== 'cancelling'` with `exportJob?.phase !== 'cancelling'`, and the cancel button's `onClick={cancelMixdown}` with `onClick={cancelExport}`. Everything else in the JSX stays.

- [ ] **Step 6: Update `src/components/Header.test.tsx`.**
  - Import line: drop `MIXDOWN_DOWNLOAD_FAILED_MESSAGE` and `runMixdownExport`.
  - Delete the whole `describe('runMixdownExport', …)` block (ported to `exportJob.test.ts` in Task 2).
  - In `describe('ExportButton (song layer only)', …)`: remove `const initial = …exporting`; the `afterEach` becomes `useAppStore.setState({ exportJob: null });`; the three `setState` calls become `{ exportJob: { kind: 'mixdown-wav', phase: 'rendering', percent: 35 } }`, `{ exportJob: { kind: 'mixdown-wav', phase: 'cancelling' } }` and `{ exportJob: { kind: 'mixdown-wav', phase: 'downloading' } }`. Assertions unchanged.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/store/exportSlice.test.ts src/store/exportJob.test.ts src/store/exportKinds.test.ts src/store/mixdownSnapshot.test.ts src/components/Header.test.tsx src/components/project src/store/projectSlice.test.ts src/audio/export`
Expected: PASS, golden unchanged.

- [ ] **Step 8: Grep for leftovers, type-check and lint**

Run: `grep -rn "mixdownSlice\|MixdownSlice\|selectMixdownBusy\|exportMixdown\|mixdownProgress\|cancelMixdown\|isMixdownCancelled\|setMixdownProgress\|runMixdownExport\|MIXDOWN_DOWNLOAD_FAILED_MESSAGE" src scripts; bun run lint && bun run eslint`
Expected: grep prints nothing; lint clean; eslint zero errors, zero warnings.

- [ ] **Step 9: Commit**

```bash
git add -A src/store src/components/Header.tsx src/components/Header.test.tsx src/components/project/ProjectMenu.tsx src/utils/projectFileIO.ts
git commit -m "refactor(export): exportSlice with one session-only job replaces mixdownSlice

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: View helpers and the presentational `ExportDialog`

**Files:**
- Create: `src/components/export/useExportDialog.ts` (helpers and types only in this task), `src/components/export/useExportDialog.test.ts`
- Create: `src/components/export/ExportDialog.tsx`, `src/components/export/ExportDialog.test.tsx`

**Interfaces:**
- Consumes: `ExportJob`, `ExportOutcome` from `@/store/exportJob`; `exportKind`, `ExportKindId`, `ExportKindSpec` from `@/store/exportKinds`; `Modal` from `@/components/ui/Modal`.
- Produces (from `useExportDialog.ts`):

```ts
export interface ExportStatusView { label: string; percent: number | null; canCancel: boolean }
export interface ExportTriggerView { busy: boolean; text: string | null; ariaLabel: string }
export function exportProgressLabel(job: ExportJob): string;
export function exportStatusView(job: ExportJob | null): ExportStatusView | null;
export function exportTriggerView(job: ExportJob | null): ExportTriggerView;
export function closesDialogAfter(outcome: ExportOutcome): boolean;
```

  and from `ExportDialog.tsx`: `interface ExportDialogProps { open; onClose; kinds: readonly Pick<ExportKindSpec, 'id' | 'label'>[]; busy; status: ExportStatusView | null; onStart: (kind: ExportKindId) => void; onCancel: () => void }`, `function ExportDialog(props: ExportDialogProps)`.

- [ ] **Step 1: Write the helper tests.** Create `src/components/export/useExportDialog.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ExportJob } from '@/store/exportJob';
import {
  closesDialogAfter,
  exportProgressLabel,
  exportStatusView,
  exportTriggerView,
} from './useExportDialog';

const job = (phase: ExportJob): ExportJob => phase;

describe('exportProgressLabel keeps every existing string', () => {
  test.each([
    [job({ kind: 'mixdown-wav', phase: 'preparing' }), 'Preparing arrangement…'],
    [job({ kind: 'mixdown-wav', phase: 'rendering', percent: 35 }), 'Rendering mixdown… 35%'],
    [job({ kind: 'mixdown-wav', phase: 'encoding' }), 'Encoding WAV…'],
    [job({ kind: 'mixdown-wav', phase: 'cancelling' }), 'Cancelling…'],
    [job({ kind: 'mixdown-wav', phase: 'downloading' }), 'Downloading…'],
  ])('%o → %s', (input, label) => {
    expect(exportProgressLabel(input)).toBe(label);
  });
});

describe('exportStatusView', () => {
  test('idle has no status', () => {
    expect(exportStatusView(null)).toBeNull();
  });

  test('rendering carries its percent and can be cancelled', () => {
    expect(exportStatusView({ kind: 'mixdown-wav', phase: 'rendering', percent: 35 })).toEqual({
      label: 'Rendering mixdown… 35%',
      percent: 35,
      canCancel: true,
    });
  });

  test('other phases are indeterminate', () => {
    expect(exportStatusView({ kind: 'mixdown-wav', phase: 'downloading' })?.percent).toBeNull();
  });

  test('cancelling cannot be cancelled twice', () => {
    expect(exportStatusView({ kind: 'mixdown-wav', phase: 'cancelling' })?.canCancel).toBe(false);
  });
});

describe('exportTriggerView', () => {
  test('idle reads Export', () => {
    expect(exportTriggerView(null)).toEqual({ busy: false, text: 'Export', ariaLabel: 'Export' });
  });

  test('rendering shows the percent and names the phase for assistive tech', () => {
    expect(exportTriggerView({ kind: 'mixdown-wav', phase: 'rendering', percent: 35 })).toEqual({
      busy: true,
      text: '35%',
      ariaLabel: 'Rendering mixdown… 35%',
    });
  });

  test('other busy phases show only the spinner', () => {
    expect(exportTriggerView({ kind: 'mixdown-wav', phase: 'encoding' })).toEqual({
      busy: true,
      text: null,
      ariaLabel: 'Encoding WAV…',
    });
  });
});

describe('closesDialogAfter', () => {
  test('only a finished download closes the dialog', () => {
    expect(closesDialogAfter({ status: 'downloaded', fileName: 'a.wav' })).toBe(true);
    expect(closesDialogAfter({ status: 'download-failed', fileName: 'a.wav' })).toBe(false);
    expect(closesDialogAfter({ status: 'failed', reason: { kind: 'empty-arrangement' } })).toBe(false);
    expect(closesDialogAfter({ status: 'cancelled' })).toBe(false);
    expect(closesDialogAfter({ status: 'ignored' })).toBe(false);
  });
});
```

- [ ] **Step 2: Write the dialog tests.** Create `src/components/export/ExportDialog.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { EXPORT_KINDS } from '@/store/exportKinds';
import { ExportDialog } from './ExportDialog';
import type { ExportStatusView } from './useExportDialog';

function render(busy: boolean, status: ExportStatusView | null): string {
  return renderToString(
    <ExportDialog open onClose={() => {}} kinds={EXPORT_KINDS} busy={busy} status={status}
      onStart={() => {}} onCancel={() => {}} />,
  );
}

describe('ExportDialog', () => {
  test('idle: one enabled row per kind and no status', () => {
    const html = render(false, null);
    expect(html).toContain('Export</h3>');
    expect(html).toContain('<button id="btn-export-mixdown-wav" type="button" class="btn btn-sm btn-outline justify-start">Export mixdown (WAV)</button>');
    expect(html).not.toContain('id="export-status"');
  });

  test('busy: rows are disabled and the status is live', () => {
    const html = render(true, { label: 'Rendering mixdown… 35%', percent: 35, canCancel: true });
    expect(html).toContain('<button id="btn-export-mixdown-wav" type="button" class="btn btn-sm btn-outline justify-start" disabled="">');
    expect(html).toContain('id="export-status" role="status" aria-live="polite"');
    expect(html).toContain('Rendering mixdown… 35%');
    expect(html).toContain('class="progress progress-primary w-full" value="35" max="100"');
    expect(html).toContain('id="btn-cancel-export"');
    expect(html).toContain('Cancel export');
  });

  test('an indeterminate phase has a progress bar without a value', () => {
    const html = render(true, { label: 'Downloading…', percent: null, canCancel: true });
    expect(html).toContain('<progress class="progress w-full"');
    expect(html).not.toContain('value="');
  });

  test('while cancellation drains there is no second Cancel', () => {
    const html = render(true, { label: 'Cancelling…', percent: null, canCancel: false });
    expect(html).toContain('Cancelling…');
    expect(html).not.toContain('id="btn-cancel-export"');
  });

  test('advertises no kind this build cannot export', () => {
    const html = render(false, null);
    expect(html).not.toContain('stem');
    expect(html).not.toContain('Stem');
    expect(html).not.toContain('MIDI');
    expect(html).not.toContain('coming soon');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/components/export`
Expected: FAIL — `Cannot find module './useExportDialog'` / `'./ExportDialog'`.

- [ ] **Step 4: Implement the helpers.** Create `src/components/export/useExportDialog.ts` (the hook itself is added in Task 5):

```ts
/**
 * The export dialog's logic (R265): pure view helpers here, the hook in
 * Task 5. Kind-specific wording comes from the kind's spec; the three generic
 * phases are worded here once.
 */
import type { ExportJob, ExportOutcome } from '@/store/exportJob';
import { exportKind } from '@/store/exportKinds';

export interface ExportStatusView {
  label: string;
  /** Rendering only; `null` renders an indeterminate bar. */
  percent: number | null;
  canCancel: boolean;
}

export interface ExportTriggerView {
  busy: boolean;
  /** Visible text: 'Export' idle, the percent while rendering, none otherwise. */
  text: string | null;
  ariaLabel: string;
}

export function exportProgressLabel(job: ExportJob): string {
  switch (job.phase) {
    case 'preparing':
      return 'Preparing arrangement…';
    case 'rendering':
      return `${exportKind(job.kind).progressLabels.rendering}… ${job.percent}%`;
    case 'encoding':
      return `${exportKind(job.kind).progressLabels.encoding}…`;
    case 'cancelling':
      return 'Cancelling…';
    case 'downloading':
      return 'Downloading…';
  }
}

export function exportStatusView(job: ExportJob | null): ExportStatusView | null {
  if (job === null) return null;
  return {
    label: exportProgressLabel(job),
    percent: job.phase === 'rendering' ? job.percent : null,
    canCancel: job.phase !== 'cancelling',
  };
}

export function exportTriggerView(job: ExportJob | null): ExportTriggerView {
  if (job === null) return { busy: false, text: 'Export', ariaLabel: 'Export' };
  return {
    busy: true,
    text: job.phase === 'rendering' ? `${job.percent}%` : null,
    ariaLabel: exportProgressLabel(job),
  };
}

/** The toast reports a finished download; any other ending keeps the dialog open. */
export function closesDialogAfter(outcome: ExportOutcome): boolean {
  return outcome.status === 'downloaded';
}
```

- [ ] **Step 5: Implement the dialog.** Create `src/components/export/ExportDialog.tsx`:

```tsx
import { Modal } from '@/components/ui/Modal';
import type { ExportKindId, ExportKindSpec } from '@/store/exportKinds';
import type { ExportStatusView } from './useExportDialog';

export interface ExportDialogProps {
  open: boolean;
  /** Only closes. Closing never cancels a running job (R295). */
  onClose: () => void;
  kinds: readonly Pick<ExportKindSpec, 'id' | 'label'>[];
  busy: boolean;
  status: ExportStatusView | null;
  onStart: (kind: ExportKindId) => void;
  onCancel: () => void;
}

function ExportKindRows({ kinds, busy, onStart }: {
  kinds: ExportDialogProps['kinds']; busy: boolean; onStart: ExportDialogProps['onStart'];
}) {
  return (
    <div className="flex flex-col gap-2">
      {kinds.map((kind) => (
        <button key={kind.id} id={`btn-export-${kind.id}`} type="button"
          className="btn btn-sm btn-outline justify-start" disabled={busy} onClick={() => onStart(kind.id)}>
          {kind.label}
        </button>
      ))}
    </div>
  );
}

function ExportStatus({ status, onCancel }: { status: ExportStatusView; onCancel: () => void }) {
  return (
    <div id="export-status" role="status" aria-live="polite" className="space-y-2">
      <p className="text-xs font-semibold">{status.label}</p>
      {status.percent === null ? (
        <progress className="progress w-full" aria-label={status.label} />
      ) : (
        <progress className="progress progress-primary w-full" value={status.percent} max={100} aria-label={status.label} />
      )}
      {status.canCancel && (
        <button id="btn-cancel-export" type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel export
        </button>
      )}
    </div>
  );
}

export function ExportDialog({ open, onClose, kinds, busy, status, onStart, onCancel }: ExportDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Export" size="sm" boxClassName="space-y-4">
      <ExportKindRows kinds={kinds} busy={busy} onStart={onStart} />
      {status && <ExportStatus status={status} onCancel={onCancel} />}
    </Modal>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/components/export`
Expected: PASS. If a markup substring differs only by React's attribute serialization (e.g. attribute order), fix the component so its JSX attribute order matches the test, not the reverse — the test pins the element's exact opening tag on purpose.

- [ ] **Step 7: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no errors, zero warnings. (Knip's production scan would still flag `ExportDialog.tsx` as unused until Task 5; do not run it here.)

- [ ] **Step 8: Commit**

```bash
git add src/components/export
git commit -m "feat(export): export dialog and its view helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `useExportDialog`, `ExportButton`, and Header reduced to one button

**Files:**
- Modify: `src/components/export/useExportDialog.ts` (add the hook)
- Create: `src/components/export/ExportButton.tsx`, `src/components/export/ExportButton.test.tsx`
- Modify: `src/components/Header.tsx` (remove `ExportButton`, `mixdownProgressLabel` and the export imports; import the new root), `src/components/Header.test.tsx` (remove the `ExportButton` describe and import; add a source test)

**Interfaces:**
- Consumes: Task 4 helpers; `selectExportBusy` from `@/store/exportSlice`; `useLiveStore` from `@/components/ui/useLiveStore`; `EXPORT_KINDS`, `ExportKindId` from `@/store/exportKinds`; `Layer` from `@/types`.
- Produces:

```ts
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
export function ExportButton({ layer }: { layer: Layer }): JSX.Element | null;   // src/components/export/ExportButton.tsx
```

- [ ] **Step 1: Write the failing root tests.** Create `src/components/export/ExportButton.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { ExportButton } from './ExportButton';

describe('ExportButton (song layer only)', () => {
  afterEach(() => {
    useAppStore.setState({ exportJob: null });
  });

  test('the song layer shows the Export trigger and its dialog', () => {
    const html = renderToString(<ExportButton layer="song" />);
    expect(html).toContain('id="btn-export"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Export"');
    expect(html).toContain('id="btn-export-mixdown-wav"');
    expect(html).toContain('Export mixdown (WAV)');
  });

  test('the loop layer renders nothing — an export is an arrangement action', () => {
    expect(renderToString(<ExportButton layer="loop" />)).toBe('');
  });

  test('a running job shows spinner and percent, and the trigger stays clickable', () => {
    useAppStore.setState({ exportJob: { kind: 'mixdown-wav', phase: 'rendering', percent: 35 } });
    const html = renderToString(<ExportButton layer="song" />);
    expect(html).toContain('loading loading-spinner loading-sm');
    expect(html).toContain('>35%<');
    expect(html).toContain('aria-label="Rendering mixdown… 35%"');
    expect(html).toMatch(/<button id="btn-export"[^>]*aria-busy="true"/);
    expect(html).not.toMatch(/<button id="btn-export"[^>]*disabled/);
    // Reopening shows the job: status and Cancel are in the dialog.
    expect(html).toContain('id="export-status"');
    expect(html).toContain('id="btn-cancel-export"');
  });

  test('a busy job disables the dialog rows', () => {
    useAppStore.setState({ exportJob: { kind: 'mixdown-wav', phase: 'downloading' } });
    const html = renderToString(<ExportButton layer="song" />);
    expect(html).toMatch(/<button id="btn-export-mixdown-wav"[^>]*disabled=""/);
    expect(html).toContain('Downloading…');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/export/ExportButton.test.tsx`
Expected: FAIL — `Cannot find module './ExportButton'`.

- [ ] **Step 3: Add the hook** to the end of `src/components/export/useExportDialog.ts`, with these imports added at the top:

```ts
import { useCallback, useState } from 'react';
import { useLiveStore } from '@/components/ui/useLiveStore';
import type { ExportKindId } from '@/store/exportKinds';
import { selectExportBusy } from '@/store/exportSlice';
```

(merge `ExportKindId` into the existing `@/store/exportKinds` import rather than importing the module twice), and:

```ts
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

/**
 * Called once, at `ExportButton` (R268). `open` is local UI state; the job is
 * the store's, so closing the dialog leaves it running and the trigger is the
 * way back in (R295). Reads go through `useLiveStore` so `renderToString`
 * tests see `setState` (R257).
 */
export function useExportDialog(): UseExportDialog {
  const [open, setOpen] = useState(false);
  const job = useLiveStore((s) => s.exportJob);
  const busy = useLiveStore(selectExportBusy);
  const startExport = useLiveStore((s) => s.startExport);
  const cancel = useLiveStore((s) => s.cancelExport);
  const openDialog = useCallback(() => setOpen(true), []);
  // Stable: `Modal` re-binds its native `close` listener whenever onClose changes.
  const closeDialog = useCallback(() => setOpen(false), []);
  const start = useCallback(
    (kind: ExportKindId) => {
      void startExport(kind).then((outcome) => {
        if (closesDialogAfter(outcome)) setOpen(false);
      });
    },
    [startExport],
  );
  return {
    open,
    openDialog,
    closeDialog,
    busy,
    status: exportStatusView(job),
    trigger: exportTriggerView(job),
    start,
    cancel,
  };
}
```

Update the file's top docblock to drop "the hook in Task 5".

- [ ] **Step 4: Create `src/components/export/ExportButton.tsx`:**

```tsx
import { Download } from 'lucide-react';
import type { Layer } from '@/types';
import { EXPORT_KINDS } from '@/store/exportKinds';
import { ExportDialog } from './ExportDialog';
import { useExportDialog, type ExportTriggerView } from './useExportDialog';

/**
 * Never disabled: while a job runs it is the way back into the dialog, where
 * the user can watch or cancel. Starting twice is prevented by the dialog's
 * disabled rows and by `startExport` itself (R292).
 */
function ExportTrigger({ trigger, onOpen }: { trigger: ExportTriggerView; onOpen: () => void }) {
  return (
    <button id="btn-export" type="button" className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"
      aria-haspopup="dialog" aria-label={trigger.ariaLabel} title={trigger.ariaLabel}
      aria-busy={trigger.busy} onClick={onOpen}>
      {trigger.busy ? (
        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      {trigger.text !== null && (
        <span className={trigger.busy ? 'tabular-nums' : 'hidden sm:inline'}>{trigger.text}</span>
      )}
    </button>
  );
}

/**
 * The export feature's root, rendered by the Header on the song layer only.
 * Takes `layer` as a prop for the reason the Header's other song-layer
 * controls do: under `renderToString` a rendered `<Header />` can never reach
 * the song layer, so the prop is what makes "song layer only" assertable.
 */
export function ExportButton({ layer }: { layer: Layer }) {
  const d = useExportDialog();
  if (layer !== 'song') return null;
  return (
    <>
      <ExportTrigger trigger={d.trigger} onOpen={d.openDialog} />
      <ExportDialog open={d.open} onClose={d.closeDialog} kinds={EXPORT_KINDS} busy={d.busy}
        status={d.status} onStart={d.start} onCancel={d.cancel} />
    </>
  );
}
```

- [ ] **Step 5: Run the root tests to verify they pass**

Run: `bun test src/components/export`
Expected: PASS.

- [ ] **Step 6: Write the failing Header source test.** In `src/components/Header.test.tsx`, delete the whole `describe('ExportButton (song layer only)', …)` block, remove `ExportButton` from the `./Header` import, and add:

```tsx
describe('export lives in its own feature folder', () => {
  const src = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');

  test('Header renders the export root from src/components/export/', () => {
    expect(src).toMatch(/import \{ ExportButton \} from ["']\.\/export\/ExportButton["']/);
    expect(src).toContain('<ExportButton layer={layer} />');
  });

  test('Header holds no export logic of its own', () => {
    for (const symbol of ['startExport', 'cancelExport', 'exportJob', 'downloadBlob', 'mixdownProgressLabel', 'export-menu']) {
      expect(src).not.toContain(symbol);
    }
  });
});
```

Run: `bun test src/components/Header.test.tsx`
Expected: FAIL — the import regex does not match and `startExport` is still present.

- [ ] **Step 7: Reduce the Header.** In `src/components/Header.tsx`: delete `mixdownProgressLabel` and the whole `ExportButton` function with its docblock; delete the `selectExportBusy` and `ExportJob` imports; remove `Download` (and `ChevronDown` only if nothing else in the file uses it — check with `grep -n ChevronDown src/components/Header.tsx`) from the `lucide-react` import; add `import { ExportButton } from "./export/ExportButton";` beside the other local component imports. The existing `<ExportButton layer={layer} />` line and its comment in `Header` stay where they are.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/components src/store/exportSlice.test.ts`
Expected: PASS.

- [ ] **Step 9: Type-check, lint and dead-code**

Run: `bun run lint && bun run eslint && bun run check:dead-code && bun run check:dead-code:production`
Expected: all clean — zero warnings, zero Knip findings. If Knip flags an export that has no importer outside its file, drop the `export` keyword (do not add a contrived import) and say so in your report.

- [ ] **Step 10: Commit**

```bash
git add src/components/export src/components/Header.tsx src/components/Header.test.tsx
git commit -m "refactor(export): Header opens the export dialog; export UI in its own folder

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rules, ADR-0035 and architecture docs

**Files:**
- Create: `.claude/rules/export.md`, `docs/decisions/0035-export-feature.md`
- Modify: `docs/decisions/README.md` (index row), `CLAUDE.md` (rules table row), `.claude/rules/playback.md` (`paths:` entry + R031 wording), `.claude/rules/synth-voices.md` (R031 wording), `docs/decisions/0021-shared-live-and-offline-render.md` (renamed-file correction), `docs/architecture/feature-overview.md`, `docs/architecture/structure/01-ui.md`, `docs/architecture/structure/02-store.md`, `docs/architecture/structure/README.md`

**Interfaces:**
- Consumes: the code from Tasks 1–5 (read it to confirm every identifier you cite exists).
- Produces: rules R291–R295 (first confirm the highest id in use: `grep -rhoE "R[0-9]{3}" CLAUDE.md .claude/rules docs/decisions | sort -u | tail -1` must print `R290`; if it prints higher, renumber from the next free id everywhere in this task).

- [ ] **Step 1: Create `.claude/rules/export.md`:**

```markdown
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
```

- [ ] **Step 2: Create `docs/decisions/0035-export-feature.md`** following the template in `docs/decisions/README.md`:
  - Title `# ADR-0035: Export as a feature — one job, kinds as data`; Status `Accepted — 2026-09-22. DEV-421`.
  - **Context:** the export flow was split across `store/mixdownSlice.ts` (render, failure notice, incident) and `Header.tsx` (`runMixdownExport`: downloading phase, paint yield, download, success and download-failed notices, `mixdownProgressLabel`); two lifecycles were stitched (the slice cleared progress, the Header re-set it to downloading; cancel worked in the download phase only through a "progress non-null" guard); audit U7 named the Header orchestration; MIDI (DEV-428) and stems (DEV-429) would each have repeated it.
  - **Decision:** `exportSlice` with one session-only `exportJob` and a kind-agnostic phase set; `startExport(kind)`/`cancelExport()`; single active job; `runExportJob` owns the shared steps with every effect injected; kinds are `ExportKindSpec` entries in `EXPORT_KINDS` in `src/store/exportKinds.ts` — with the layering reason (store is the lowest layer that may import both the renderer and the store-built snapshot; audio may not import the store; components may import the store but not the engine; data imports nothing); the kind contract reuses the renderer's `MixdownRenderProgress`/`MixdownFailureReason`; `buildMixdownSnapshot(state)` in `store/mixdownSnapshot.ts`; UI in `src/components/export/` (`ExportDialog` on `ui/Modal`, `useExportDialog`, `ExportButton`); closing the dialog never cancels (the trigger shows spinner + percent and reopens it); the dialog closes itself after a successful download. **The store now performs the download** through the injected `download` dependency — this ends, for exports only, the earlier comment-level convention "the store decides, the component writes" (never a rule or ADR); the `.solna` copy in the project menu keeps its component-side download.
  - **Rejected alternatives:** registry in `src/audio/export/` (audio may not import the store's snapshot builder or `AppStore`); registry in `src/data/` (imports nothing at runtime; a `run` needs the renderer); keeping download in a component (every kind's UI would repeat it, and the job's lifecycle would stay split across layers); closing the dialog cancels the job (rejected by the user: an export is long-running and the user may keep working); a job queue (no use case; a second start is a no-op).
  - **Consequences:** a new kind is one spec; the Header and dialog never change for it; one lifecycle from click to download; `renderMixdown.ts` untouched; a store test of the slice needs a fake `document` for `downloadBlob`.
  - **Rules this implies:** R291–R295, one line each, identical to `export.md`.
  - **Sources:** `docs/superpowers/specs/2026-09-22-dev-421-export-feature-design.md`, `docs/superpowers/plans/2026-09-22-dev-421-export-feature.md`, Linear DEV-421.

- [ ] **Step 3: Index and cross-links.**
  - `docs/decisions/README.md`: add the row `| [0035](0035-export-feature.md) | Export as a feature — one job, kinds as data | One session-only `exportJob`, `startExport`/`cancelExport`, a shared runner that owns capture, download and notices, `ExportKindSpec` entries in `EXPORT_KINDS`, and an `ExportDialog` the Header only opens; closing it never cancels. |` after the 0034 row.
  - `CLAUDE.md` rules table: add `| `export.md` | The export job: one session-only job, kinds as data, the shared runner, the dialog and the Header trigger |` after the `playback.md` row. No other `CLAUDE.md` change.
  - `.claude/rules/playback.md`: in `paths:` replace `"src/store/mixdownSlice.ts"` with `"src/store/mixdownSnapshot.ts"`; in the R031 line replace `store/mixdownSlice.ts` with `store/mixdownSnapshot.ts`.
  - `.claude/rules/synth-voices.md` R031 line and `docs/decisions/0021-shared-live-and-offline-render.md` (both mentions): `store/mixdownSlice.ts` → `store/mixdownSnapshot.ts` (a renamed-file correction, allowed in place by the ADR README).

- [ ] **Step 4: Architecture docs.** Find every stale mention with `grep -n "ixdown\|ExportButton\|Export" docs/architecture/feature-overview.md docs/architecture/structure/*.md` and update:
  - `feature-overview.md`: row 10 → `| 10 | Export (mixdown WAV) | Header Export button (song layer) → Export dialog | Offline render of the song to WAV; one job at a time, kinds as data (`store/exportKinds.ts`) |`; the slices list `mixdown` → `export`; `playbackPlanSnapshots · mixdownSlice` → `playbackPlanSnapshots · mixdownSnapshot` (both diagrams).
  - `structure/01-ui.md`: the tree node `EXP["ExportButton — mixdown WAV<br/>(song layer)"]` → `EXP["export/ExportButton → ExportDialog<br/>(song layer)"]`; the feature row 19 → `Export dialog (kinds, progress, cancel) | Header Export button (song layer) → dialog | src/components/export/`; the `Header` store-access row loses `mixdownProgress`, `selectMixdownBusy`, `exportMixdown`, `cancelMixdown`, `setMixdownProgress`, `store/mixdownSlice` and gains a new row for `ExportButton` (`export/`): reads `exportJob`, `selectExportBusy`; calls `startExport`, `cancelExport`; the `ProjectMenu` row `selectMixdownBusy` → `selectExportBusy`; under "Components doing too much", append to the `Header.tsx` bullet: "**Mixdown half fixed on `refactor/dev-421-export-feature`:** export is its own feature in `src/components/export/` + `store/export*.ts`; theme persistence and project-name editing remain." Fix the "Mixdown export is not in the project menu" note only if it now reads wrong. Use no line numbers for new text (R001).
  - `structure/02-store.md`: the slice list `mixdown` → `export`; the `MixdownSlice` interface pointer → `ExportSlice` (`exportSlice.ts`), no line number; the `mixdown` table row → `| **export** `exportSlice.ts` | `exportJob` | `startExport`, `cancelExport` | all content via `buildMixdownSnapshot` (`mixdownSnapshot.ts`) | project `projectNotice` |`; the `project` row: `cancelMixdown` → `cancelExport`; memory-only zone: `drive/project/mixdown status` → `drive/project status, exportJob`; the paragraph about `buildMixdownSnapshot` as a store action → it is now a plain function of the state in `mixdownSnapshot.ts`.
  - `structure/README.md`: the `Snap["playbackPlanSnapshots · mixdownSlice"]` node → `mixdownSnapshot`; in the "Misplaced logic" smell, after "Mixdown orchestration and the theme live in `Header.tsx`." add "**Mixdown half of U7 fixed on `refactor/dev-421-export-feature`:** export is its own feature (`store/exportSlice.ts`, `store/exportJob.ts`, `store/exportKinds.ts`, `components/export/`); the theme still lives in `Header.tsx`."

- [ ] **Step 5: Verify the doc sync**

Run: `grep -rn "mixdownSlice\|selectMixdownBusy\|cancelMixdown\|exportMixdown\|runMixdownExport" CLAUDE.md .claude docs/decisions docs/architecture; grep -rhoE "R29[1-5]" .claude/rules/export.md docs/decisions/0035-export-feature.md | sort | uniq -c`
Expected: the first grep prints nothing (historical specs/plans under `docs/superpowers/` are left as written); the second shows each of R291–R295 in both files.

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/export.md .claude/rules/playback.md .claude/rules/synth-voices.md docs/decisions CLAUDE.md docs/architecture
git commit -m "docs: ADR-0035 export feature, export rules R291-R295 (DEV-421)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Completion gate and acceptance check

**Files:** none new; fix only what the gate reports.

- [ ] **Step 1: Acceptance greps (spec §12)**

Run: `grep -rn "mixdownSlice\|runMixdownExport\|MixdownExportDeps\|mixdownProgressLabel\|selectMixdownBusy\|mixdownProgress\|\bexporting:" src scripts; git diff --stat main -- src/audio/export/renderMixdown.ts src/audio/export/renderMixdownGolden.*`
Expected: both print nothing.

- [ ] **Step 2: Full gate**

Run: `bun run verify`
Expected: PASS — all tests (golden included), static/domain checks, both Knip scans with zero findings, production build.

- [ ] **Step 3: Lint with zero warnings**

Run: `bun run eslint`
Expected: `0 errors, 0 warnings` (no output beyond the summary). Open the code at every warning and fix it or add a reasoned line-level disable (R264); never relax a rule.

- [ ] **Step 4: Commit any gate fixes** (skip if nothing changed)

```bash
git add -A
git commit -m "chore(export): gate fixes for DEV-421

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Report** — the commit list (`git log --oneline main..HEAD`), the `bun run verify` and `bun run eslint` result lines, and any Knip-driven `export` removals. Moving DEV-421 to Testing in Linear is the main session's job, not the implementer's; do not push.
