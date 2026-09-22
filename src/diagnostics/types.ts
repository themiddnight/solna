import type { ViewMode } from '@/types';
import type { MixLayerId } from '@/store/focusTrack';
import type { MeterId } from '@/utils/timeSignature';
import type { PlayerState } from '@/store/types';
import type { AudioDiagnosticSnapshot } from '@/audio/diagnostics';

export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export type DiagnosticRenderId =
  | 'ChordView'
  | 'ProgressionPlayhead'
  | 'PlayheadReadout'
  | 'TransportBar';

export interface DiagnosticSampleBase {
  elapsedMs: number;
  route: string;
  visibility: DocumentVisibilityState | 'unavailable';
  viewport: { width: number; height: number; dpr: number };
  navigation: { activeTab: ViewMode; focusTrack: MixLayerId };
  transport: {
    bpm: number;
    meterId: MeterId;
    players: Record<'sequencer' | 'chords' | 'lead' | 'fx', PlayerState>;
  };
  dom: { elements: number; canvases: number };
  audio: AudioDiagnosticSnapshot;
  /** Chromium-only when present. Safari/iOS records null and advertises that in capabilities. */
  heapUsedBytes: number | null;
}

export interface DiagnosticActivity {
  storeWrites: number;
  playheadWrites: number;
  renders: Partial<Record<DiagnosticRenderId, number>>;
  eventLoopLag: { over50: number; over100: number; over250: number; maxMs: number };
  frameGaps: { over50: number; over100: number; over250: number; maxMs: number };
  longTasks: { supported: boolean; count: number; totalMs: number; maxMs: number };
}

interface DiagnosticSample extends DiagnosticSampleBase {
  activity: DiagnosticActivity;
  collectorCostMs: number;
}

export interface DiagnosticSessionV1 {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  id: string;
  startedAt: number;
  endedAt: number | null;
  userAgent: string;
  standalone: boolean;
  capabilities: { longTasks: boolean; heap: boolean };
  samples: DiagnosticSample[];
}
