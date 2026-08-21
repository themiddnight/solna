import type { Scale, ChordTrack } from '@jam-band/shared';
import type {
  Track,
  Region,
  ArrangeTimeSignature,
  TimeMarker,
  EffectChainState
} from './ArrangeRoomState';

export interface ProjectMetadata {
  name: string;
  createdAt: string;
  modifiedAt: string;
}

export interface ProjectSettings {
  bpm: number;
  timeSignature: ArrangeTimeSignature;
  gridDivision: number;
  loop: {
    enabled: boolean;
    start: number;
    end: number;
  };
  isMetronomeEnabled: boolean;
  snapToGrid: boolean;
  /**
   * Master channel fader, dB (DEV-323, schema v6). Optional only so a v5 file still parses on
   * the way through the version gate; `deserializeProjectData` fills the unity default.
   */
  masterVolume?: number;
}

export interface ScaleSettings {
  rootNote: string;
  scale: Scale;
}

export interface ProjectData {
  version: number;
  metadata: ProjectMetadata;
  project: ProjectSettings;
  scale?: ScaleSettings;
  tracks: Track[];
  regions: Region[];
  effectChains: Record<string, EffectChainState>;
  synthStates: Record<string, Record<string, unknown>>;
  // DEV-301: non-synth instrument pre-gain state, mirrors `synthStates`' generic shape.
  // Optional for backward-compat — projects saved before this field existed have no key
  // in project.json.
  instrumentParamsStates?: Record<string, Record<string, unknown>>;
  markers: TimeMarker[];
  // DEV-279 P1: optional for backward-compat — projects saved before this field existed
  // have no chordTrack in project.json; deserializeProjectData restores it as { blocks: [] }.
  chordTrack?: ChordTrack;
}
