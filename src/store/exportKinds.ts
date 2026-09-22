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
import { renderMidi } from '@/audio/export/renderMidi';
import { renderStems } from '@/audio/export/renderStems';
import type { MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import type { reportOperationFailure } from '@/incidents/operationFailure';
import { slugifyProjectName } from '@/utils/projectFileIO';

/** Kinds shipped on this build. */
export type ExportKindId = 'mixdown-wav' | 'midi' | 'stems';

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

/** One sentence per failure, in the same voice as `MIXDOWN_FAILURE_MESSAGE`. */
export const MIDI_FAILURE_MESSAGE: Record<Exclude<ExportFailureReason['kind'], 'cancelled'>, string> = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
  'unsupported-context': 'This browser cannot write the MIDI file.', // unreachable; the Record demands it
  'render-failed': 'The MIDI file could not be written. Your project is unchanged; try again.',
};

/** The file name a MIDI export downloads: the project's slug, with a `.mid` extension. */
export function midiFileName(projectName: string | null): string {
  return `${slugifyProjectName(projectName ?? '')}.mid`;
}

const MIDI_EXPORT: ExportKindSpec = {
  id: 'midi',
  label: 'Export MIDI (.mid)',
  progressLabels: { rendering: 'Building MIDI', encoding: 'Writing MIDI file' },
  failureMessages: MIDI_FAILURE_MESSAGE,
  incidentOperation: 'midi-export',
  run: async (snapshot, onProgress, signal) => {
    const title = snapshot.projectName?.trim() ? snapshot.projectName : 'Solna';
    const rendered = await renderMidi(snapshot.song, title, onProgress, signal);
    if (!rendered.ok) return rendered;
    return { ok: true, blob: rendered.blob, fileName: midiFileName(snapshot.projectName) };
  },
};

/** One sentence per failure, in the same voice as `MIXDOWN_FAILURE_MESSAGE`. */
export const STEMS_FAILURE_MESSAGE: Record<Exclude<ExportFailureReason['kind'], 'cancelled'>, string> = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops or no notes.',
  'unsupported-context': 'This browser cannot render audio offline, so the stems could not be written.',
  'render-failed': 'The stems could not be rendered. Your project is unchanged; try again.',
};

/** The file name a stems export downloads: the project's slug, `-stems.zip`. */
export function stemsFileName(projectName: string | null): string {
  return `${slugifyProjectName(projectName ?? '')}-stems.zip`;
}

/** One ZIP of dry per-track WAVs (ADR-0038): one Blob, so the runner downloads it unchanged (R293). */
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

/** The one table. A `Record` over the id union: a declared, unregistered kind is a compile error. */
const EXPORT_KIND_BY_ID: Record<ExportKindId, ExportKindSpec> = {
  'mixdown-wav': MIXDOWN_WAV_EXPORT,
  midi: MIDI_EXPORT,
  stems: STEMS_EXPORT,
};

/** Every kind, in dialog order (insertion order of the table above). */
export const EXPORT_KINDS: readonly ExportKindSpec[] = Object.values(EXPORT_KIND_BY_ID);

export function exportKind(id: ExportKindId): ExportKindSpec {
  return EXPORT_KIND_BY_ID[id];
}
