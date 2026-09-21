# Incident Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production diagnostics panel with privacy-safe incident capture, recovery/report surfaces, and an explicit public GitHub reporting flow for detected and user-reported bugs.

**Architecture:** A central incident subsystem accepts sanitized structured producers, fingerprints and persists only the latest incident, and exposes an external store to UI surfaces. Audio recovery is the first rich producer; the existing Error Boundary, global runtime errors, and a manual Report a Bug command share the same schema and reporting tools.

**Tech Stack:** TypeScript, React, IndexedDB, Web Share/Clipboard APIs, GitHub issue forms, Bun tests.

**Spec:** `docs/superpowers/specs/2026-09-20-audio-runtime-recovery-and-incident-reporting-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-20-audio-session-health-recovery.md`

## Global Constraints

- No telemetry, background upload, bundled GitHub token, OAuth flow, or automatic issue creation.
- Reporting always requires an explicit user action and states that GitHub content is public.
- Reports contain no project names, paths, notes, chords, patterns, presets, imported content, Drive data, tokens, arbitrary store snapshots, or stable user identifiers.
- Production records at most the 300 health samples already owned by the playback health monitor; it adds no rAF loop or second sampling timer.
- Expected cancellation, validation, authentication, and ordinary network outcomes never produce crash prompts.
- The development diagnostics panel is not reachable or bundled into production navigation.

---

## File map

| File | Responsibility |
|---|---|
| `src/incidents/types.ts` | Versioned public incident schema and severity/kind vocabulary |
| `src/incidents/sanitize.ts` | Error/runtime sanitization and schema validation |
| `src/incidents/fingerprint.ts` | Stable non-cryptographic duplicate fingerprint |
| `src/incidents/recorder.ts` | Build/freeze one bounded incident from safe inputs |
| `src/incidents/storage.ts` | One-slot IndexedDB with memory fallback |
| `src/incidents/incidentStore.ts` | External store for current incident and dialog state |
| `src/incidents/exportIncident.ts` | Copy/share/download sanitized JSON |
| `src/incidents/githubReport.ts` | Prefilled public issue URL and summary body |
| `src/incidents/globalCapture.ts` | Filtered `error`/`unhandledrejection` producers |
| `src/components/ui/IncidentDialog.tsx` | Preview, recover/reload, report, copy/share/download actions |
| `src/components/ErrorBoundary.tsx` | Fatal render incident producer and full-page report action |
| `src/store/audioRecovery.ts` | Freeze audio evidence before hard stop and append recovery outcomes |
| `src/components/project/ProjectMenu.tsx` | Manual Report a Bug; diagnostics only in development |
| `.github/ISSUE_TEMPLATE/bug-report.yml` | Structured public issue form |

### Task 1: Define a closed, privacy-safe incident schema

**Files:**
- Create: `src/incidents/types.ts`
- Create: `src/incidents/sanitize.ts`
- Create: `src/incidents/sanitize.test.ts`
- Create: `src/incidents/fingerprint.ts`
- Create: `src/incidents/fingerprint.test.ts`

**Interfaces:**
- Produces: `IncidentReportV1`, `IncidentKind`, `IncidentSeverity`, `SanitizedError`
- Produces: `RecoveryAttempt`
- Produces: `sanitizeError(error): SanitizedError`
- Produces: `isIncidentReportV1(value): value is IncidentReportV1`
- Produces: `incidentFingerprint(input): string`

- [ ] **Step 1: Write failing schema, redaction, and fingerprint tests**

Assert accepted kinds `audio-health`, `render-crash`, `unhandled-error`,
`operation-failure`, and `manual`; severities `fatal`, `interrupted`, `degraded`.
Pass an error containing URL query/hash, local path text, and nested objects; expect only
name, bounded message, bounded sanitized stack, and component stack. Serialize a report
with sentinel project/token/note values in the raw test input and assert none survive.
Equivalent safe inputs must produce the same fingerprint; changed kind/top stack frame
must change it.

- [ ] **Step 2: Run tests and verify red**

Run: `bun test src/incidents/sanitize.test.ts src/incidents/fingerprint.test.ts`

- [ ] **Step 3: Implement the explicit schema**

```ts
export const INCIDENT_SCHEMA_VERSION = 1 as const;
export type IncidentKind =
  | 'audio-health' | 'render-crash' | 'unhandled-error'
  | 'operation-failure' | 'manual';
export type IncidentSeverity = 'fatal' | 'interrupted' | 'degraded';

export interface IncidentReportV1 {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  occurredAt: number;
  buildId: string;
  summary: string;
  runtime: RuntimeProfile;
  error: SanitizedError | null;
  audio: { generation: number; samples: readonly AudioClockEvidence[] } | null;
  recoveryAttempts: readonly RecoveryAttempt[];
}

export interface RecoveryAttempt {
  startedAfterIncidentMs: number;
  generation: number;
  result: 'recovered' | 'construct-failed' | 'resume-failed' | 'build-failed' | 'validate-failed';
}
```

Do not accept a raw Zustand state parameter anywhere in `src/incidents/`. Implement a
small FNV-1a-style hash over kind, sanitized error name, first stack frame, runtime
engine/platform, and build id; it is a duplicate key, not a security primitive.

- [ ] **Step 4: Run focused tests and verify green**

Run: `bun test src/incidents/sanitize.test.ts src/incidents/fingerprint.test.ts`

- [ ] **Step 5: Commit the privacy boundary**

```bash
git add src/incidents/types.ts src/incidents/sanitize.ts src/incidents/sanitize.test.ts src/incidents/fingerprint.ts src/incidents/fingerprint.test.ts
git commit -m "feat(incidents): define privacy-safe report schema"
```

### Task 2: Build and persist one bounded incident

**Files:**
- Create: `src/incidents/recorder.ts`
- Create: `src/incidents/recorder.test.ts`
- Create: `src/incidents/storage.ts`
- Create: `src/incidents/storage.test.ts`

**Interfaces:**
- Produces: `createIncidentRecorder(dependencies)`
- Produces: `freezeAudioIncident(input): IncidentReportV1`
- Produces: `appendRecoveryAttempt(id, attempt): IncidentReportV1 | null`
- Produces: `IncidentStore.load/save/clear`

- [ ] **Step 1: Write failing recorder tests**

Feed 301 audio health samples and assert the frozen report contains the latest 300 in
order. Assert freezing clones input, a recovery attempt appends only to the matching
incident id, a second incident replaces the first, and manual/non-audio incidents have
`audio: null`. Assert the recorder never schedules a timer.

- [ ] **Step 2: Write failing storage tests**

Cover one-slot save/load/replace/clear, invalid schema recovery as `null`, IndexedDB
open/write rejection falling back to an in-memory latest incident, and clone isolation.

- [ ] **Step 3: Run tests and verify red**

Run: `bun test src/incidents/recorder.test.ts src/incidents/storage.test.ts`

- [ ] **Step 4: Implement recorder and storage**

Use database `solna-incidents`, object store `incident`, key `latest`. Persist only when
an incident freezes or a recovery result appends; there is no periodic flush. Reuse the
guarded one-slot patterns from `src/diagnostics/storage.ts`, but type the backend to
`IncidentReportV1` and continue in memory on every storage failure.

- [ ] **Step 5: Run focused tests and verify green**

Run the command from Step 3.

- [ ] **Step 6: Commit bounded recording**

```bash
git add src/incidents/recorder.ts src/incidents/recorder.test.ts src/incidents/storage.ts src/incidents/storage.test.ts
git commit -m "feat(incidents): persist the latest bounded incident"
```

### Task 3: Add explicit export and GitHub report construction

**Files:**
- Create: `src/incidents/exportIncident.ts`
- Create: `src/incidents/exportIncident.test.ts`
- Create: `src/incidents/githubReport.ts`
- Create: `src/incidents/githubReport.test.ts`

**Interfaces:**
- Produces: `exportIncident(report, action, dependencies): Promise<'shared' | 'copied' | 'downloaded'>`
- Produces: `githubIssueUrl(report): string`
- Constant: `SOLNA_ISSUES_URL = 'https://github.com/themiddnight/solna/issues/new'`

- [ ] **Step 1: Write failing export tests**

Assert file-capable Web Share wins, clipboard is used when explicitly requested and
available, download is the fallback, filenames contain date and fingerprint but no
project data, and every route serializes the validated schema only.

- [ ] **Step 2: Write failing GitHub URL tests**

Parse the result with `new URL`. Assert pathname `/themiddnight/solna/issues/new`,
template `bug-report.yml`, a bounded title containing kind/fingerprint, and a body with
runtime/build/recovery summary but no raw samples, stack, project content, or token.

- [ ] **Step 3: Run tests and verify red**

Run: `bun test src/incidents/exportIncident.test.ts src/incidents/githubReport.test.ts`

- [ ] **Step 4: Implement export/report helpers**

Use `action: 'share' | 'copy' | 'download'` to preserve the user's chosen action. Use
`navigator.canShare({ files })` before file sharing, guarded Clipboard API for copy,
and existing `downloadTextFile` for fallback. Construct the GitHub URL with
`URLSearchParams`; keep raw JSON out of the URL and explain that the user attaches it
separately.

- [ ] **Step 5: Run focused tests and verify green**

Run the command from Step 3.

- [ ] **Step 6: Commit report helpers**

```bash
git add src/incidents/exportIncident.ts src/incidents/exportIncident.test.ts src/incidents/githubReport.ts src/incidents/githubReport.test.ts
git commit -m "feat(incidents): prepare explicit GitHub reports"
```

### Task 4: Add the incident external store and audio producer

**Files:**
- Create: `src/incidents/incidentStore.ts`
- Create: `src/incidents/incidentStore.test.ts`
- Modify: `src/store/audioRecovery.ts`
- Modify: `src/store/audioRecovery.test.ts`

**Interfaces:**
- Produces: `incidentStore.subscribe/getState`
- Produces: `publishIncident`, `hydrateLatestIncident`, `openIncident`, `dismissIncident`, `clearIncident`
- Consumes: `audioEngine.getRecentHealthSamples()` and recovery generation/status

- [ ] **Step 1: Write failing store tests**

Assert publish stores and opens one incident, dismiss hides without deleting evidence,
open restores it, clear removes memory and persistence, and publishing a newer incident
replaces the slot. `hydrateLatestIncident` restores the latest report closed so the
Transport affordance can reopen it without an unsolicited modal after reload. Subscriber
notifications occur once per real state transition.

- [ ] **Step 2: Extend recovery tests for evidence ordering**

On confirmed unhealthy, expect `freezeAudioIncident` before `hardStopAll`. On every
recovery success/failure, expect one appended attempt with relative timing, generation,
and sanitized reason. Repeated health notifications must not replace the frozen report.

- [ ] **Step 3: Run tests and verify red**

Run: `bun test src/incidents/incidentStore.test.ts src/store/audioRecovery.test.ts`

- [ ] **Step 4: Implement store and producer wiring**

The external state is `{ current: IncidentReportV1 | null; open: boolean; storage:
'ready' | 'memory' }`. Keep recovery mechanics in `src/store/audioRecovery.ts`; it sends
safe fields to the recorder and never exposes the Zustand project state to incidents.

- [ ] **Step 5: Run focused tests and verify green**

Run the command from Step 3.

- [ ] **Step 6: Commit audio incident wiring**

```bash
git add src/incidents/incidentStore.ts src/incidents/incidentStore.test.ts src/store/audioRecovery.ts src/store/audioRecovery.test.ts
git commit -m "feat(incidents): capture audio recovery evidence"
```

### Task 5: Present recovery and reporting through one incident dialog

**Files:**
- Create: `src/components/ui/IncidentDialog.tsx`
- Create: `src/components/ui/IncidentDialog.test.tsx`
- Modify: `src/components/ui/AudioRecoveryModal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/TransportBar.tsx`
- Modify: `src/components/TransportBar.test.tsx`

**Interfaces:**
- Consumes: incident store, audio recovery store, export helpers, GitHub URL helper
- Preserves: Recover Audio as primary action for `audio-health`

- [ ] **Step 1: Write failing dialog tests**

Audio incident: project-safe copy, Recover primary, Report on GitHub secondary, Not Now,
and public-attachment disclosure. Failed recovery: Retry and Reload. Generic interrupted
incident: Report and Close. Copy/Share/Download call the correct helper; GitHub action
opens `_blank` with `noopener,noreferrer`. Dismiss keeps the Transport warning; clear
removes it.

- [ ] **Step 2: Run UI tests and verify red**

Run: `bun test src/components/ui/IncidentDialog.test.tsx src/components/TransportBar.test.tsx src/App.test.tsx`

- [ ] **Step 3: Implement the unified dialog**

Compose the existing recovery actions rather than moving engine calls into components.
Show a concise safe preview: kind, fingerprint, runtime, build, relative duration,
sample count, and recovery results. Never render raw JSON or stack by default. Mount one
dialog in `Workspace` and keep the Transport warning as the reopen affordance.

- [ ] **Step 4: Run UI tests and verify green**

Run the command from Step 2.

- [ ] **Step 5: Commit the incident UI**

```bash
git add src/components/ui/IncidentDialog.tsx src/components/ui/IncidentDialog.test.tsx src/components/ui/AudioRecoveryModal.tsx src/App.tsx src/App.test.tsx src/components/TransportBar.tsx src/components/TransportBar.test.tsx
git commit -m "feat(incidents): add recovery and reporting dialog"
```

### Task 6: Capture render/global failures and manual reports

**Files:**
- Create: `src/incidents/globalCapture.ts`
- Create: `src/incidents/globalCapture.test.ts`
- Modify: `src/components/ErrorBoundary.tsx`
- Modify: `src/components/ErrorBoundary.test.tsx`
- Modify: `src/components/project/ProjectMenu.tsx`
- Modify: `src/components/project/ProjectMenu.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: `installGlobalIncidentCapture(targets, report): () => void`
- Adds: `ErrorBoundaryProps.onIncident?: (input: RenderIncidentInput) => void`
- Adds menu action: `report-bug`

- [ ] **Step 1: Write failing global-capture tests**

Dispatch an `error` event and an `unhandledrejection`; assert one sanitized incident each.
Assert `AbortError`, known user cancellation, and duplicate error objects are ignored.
Cleanup must remove both listeners.

- [ ] **Step 2: Write failing Error Boundary and menu tests**

Assert `componentDidCatch` publishes a fatal render incident before the fallback offers
Report/Retry/Refresh. Assert Project → Report a Bug creates and opens a `manual/degraded`
incident with no audio samples unless the engine already has bounded health evidence.

- [ ] **Step 3: Run focused tests and verify red**

Run: `bun test src/incidents/globalCapture.test.ts src/components/ErrorBoundary.test.tsx src/components/project/ProjectMenu.test.tsx src/App.test.tsx`

- [ ] **Step 4: Implement producers**

Install global listeners once at the app root. Filter by typed predicates rather than
message substrings except for explicitly enumerated browser cancellation names. Add a
Report button to the fatal fallback. Manual reports capture runtime/build/current route
category only; they never read project content.

- [ ] **Step 5: Run focused tests and verify green**

Run the command from Step 3.

- [ ] **Step 6: Commit general producers**

```bash
git add src/incidents/globalCapture.ts src/incidents/globalCapture.test.ts src/components/ErrorBoundary.tsx src/components/ErrorBoundary.test.tsx src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(incidents): report detected and manual bugs"
```

### Task 7: Report unexpected critical operation failures

**Files:**
- Create: `src/incidents/operationFailure.ts`
- Create: `src/incidents/operationFailure.test.ts`
- Modify: `src/store/mixdownSlice.ts`
- Modify: `src/store/mixdownSlice.test.ts`
- Modify: `src/store/projectSlice.ts`
- Modify: `src/store/projectSlice.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: `reportOperationFailure(operation, error, severity): void`
- Reports: unexpected boot throws, mixdown `render-failed`, and project-store `failed`
- Excludes: cancellation, malformed import, unavailable/private storage, quota, auth denial, and network failure

- [ ] **Step 1: Write failing classification tests**

Assert `render-failed`, an exception escaping project boot, and project storage's generic
`failed` result create `operation-failure` incidents. Assert mixdown cancellation,
empty arrangement, unsupported context, malformed input, `unavailable`, `quota`, Drive
auth denial, and typed network outcomes do not. The incident summary names only the
operation category (`boot`, `mixdown`, `project-load`, `project-save`) and never a
project/file name.

- [ ] **Step 2: Run focused tests and verify red**

Run: `bun test src/incidents/operationFailure.test.ts src/store/mixdownSlice.test.ts src/store/projectSlice.test.ts src/App.test.tsx`

- [ ] **Step 3: Implement and wire the explicit allow-list**

```ts
export type ReportableOperation = 'boot' | 'mixdown' | 'project-load' | 'project-save';

export function reportOperationFailure(
  operation: ReportableOperation,
  error: unknown,
  severity: 'fatal' | 'interrupted' | 'degraded',
): void;
```

Call it only at the named terminal failure branches. Preserve every existing user-facing
notice/result; reporting is additional evidence, not a replacement for operational UI.
Do not add a catch-all subscription to project notices.

- [ ] **Step 4: Run focused tests and verify green**

Run the command from Step 2.

- [ ] **Step 5: Commit operation producers**

```bash
git add src/incidents/operationFailure.ts src/incidents/operationFailure.test.ts src/store/mixdownSlice.ts src/store/mixdownSlice.test.ts src/store/projectSlice.ts src/store/projectSlice.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat(incidents): report critical operation failures"
```

### Task 8: Remove production diagnostics UI and preserve developer tooling

**Files:**
- Modify: `src/components/project/ProjectMenu.tsx`
- Modify: `src/components/project/ProjectMenu.test.tsx`

**Interfaces:**
- Production tools rows: `Report a Bug` only
- Development tools rows: `Report a Bug`, `Diagnostics`

- [ ] **Step 1: Add failing environment-gating tests**

Extract a pure `toolsRows({ development: boolean })`. Assert production returns only
`report-bug`, development additionally returns `diagnostics`, and production render
never constructs or imports the panel loader.

- [ ] **Step 2: Run the menu test and verify red**

Run: `bun test src/components/project/ProjectMenu.test.tsx`

- [ ] **Step 3: Gate the lazy import and menu action**

Use a compile-time `import.meta.env.DEV` guard around the dynamic import and render.
Keep long-session Start/Stop diagnostics unchanged for maintainers. Remove production
access to recovery/export of old diagnostic sessions; incident storage is the only
production report surface.

- [ ] **Step 4: Run menu tests and production build**

Run: `bun test src/components/project/ProjectMenu.test.tsx && bun run build`

Expected: production menu has no Diagnostics row, and the production manifest/output
contains no `DiagnosticPanel` chunk.

- [ ] **Step 5: Commit production gating**

```bash
git add src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx
git commit -m "refactor(diagnostics): keep recorder tooling development-only"
```

### Task 9: Add the public GitHub issue form

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug-report.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `docs/reporting-bugs.md`

**Interfaces:**
- Consumes: query parameters generated by `githubIssueUrl`
- Documents: public visibility, optional JSON attachment, redaction scope, fingerprint use

- [ ] **Step 1: Add the issue form**

Require description, reproduction steps, expected/actual behavior, browser/device, and
Solna build. Include optional incident fingerprint, recovery result, and diagnostic
attachment fields. State beside the attachment field that issues are public and users
must review files before upload. Disable blank issues only if the config still provides
the manual bug-report form as a visible contact link.

- [ ] **Step 2: Add contributor/user documentation**

Document automatic versus manual incidents, exactly what is collected/excluded, how to
copy/share/download, how maintainers use fingerprints for duplicates, and why Solna
does not auto-submit.

- [ ] **Step 3: Validate YAML and links**

Run:

```bash
ruby -e "require 'yaml'; ARGV.each { |path| YAML.load_file(path) }" \
  .github/ISSUE_TEMPLATE/bug-report.yml .github/ISSUE_TEMPLATE/config.yml
```

Expected: exit 0. Open the generated URL from `githubReport.test.ts` and verify it selects
`bug-report.yml`.

- [ ] **Step 4: Commit public reporting files**

```bash
git add .github/ISSUE_TEMPLATE/bug-report.yml .github/ISSUE_TEMPLATE/config.yml docs/reporting-bugs.md
git commit -m "docs: add public incident reporting workflow"
```

### Task 10: Complete verification and privacy audit

**Files:**
- Modify: `docs/testing/audio-runtime-acceptance.md`
- Modify: `docs/reporting-bugs.md` only for findings from verification

**Interfaces:**
- Verifies: all automatic/manual producer, recovery, privacy, storage, export, and production-gating contracts

- [ ] **Step 1: Run all incident and recovery suites**

Run: `bun test src/incidents src/store/audioRecovery.test.ts src/components/ui/IncidentDialog.test.tsx src/components/ErrorBoundary.test.tsx src/components/project/ProjectMenu.test.tsx`

- [ ] **Step 2: Run a forbidden-field source/schema audit**

Search production incident code for imports from project-format/content modules and for
forbidden field names. Expected: no project body/store snapshot dependency in
`src/incidents/`; allow forbidden names only inside negative privacy tests and docs.

- [ ] **Step 3: Run the completion gate**

Run: `bun run verify`

Expected: all tests, typecheck, ESLint, domain checks, dead-code scans, and production build pass.

- [ ] **Step 4: Exercise manual browser flows**

On desktop and iPhone: trigger an audio incident fixture, recover, dismiss/reopen, copy
or share JSON, open the prefilled GitHub form, and inspect the attachment for forbidden
content. Trigger a development Error Boundary fixture and a manual report. Confirm
production has Report a Bug but no Diagnostics entry.

- [ ] **Step 5: Record results and commit**

```bash
git add docs/testing/audio-runtime-acceptance.md docs/reporting-bugs.md
git commit -m "test: verify incident reporting and privacy"
```
