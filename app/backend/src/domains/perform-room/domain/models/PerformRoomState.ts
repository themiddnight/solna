import type { BaseRoomState } from '../../../../shared/domain/room-state/BaseRoomState';
import type {
  CompanionBarsPerChord,
  CompanionChordProgression,
  CompanionConfig,
  CompanionGenrePreset,
  CompanionIntensityStep,
  CompanionProgressionFlavor,
  ElementOccupancy,
} from '@jam-band/shared';

export type InstrumentCategory = 'synth' | 'drums' | 'sampler' | 'effects';

export interface SynthState {
  [key: string]: unknown;
  oscillatorType?: 'sine' | 'square' | 'sawtooth' | 'triangle';
  filterType?: 'lowpass' | 'highpass' | 'bandpass';
  filterFrequency?: number;
  filterResonance?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  volume?: number;
  detune?: number;
  portamento?: number;
}

export interface UserPerformState {
  userId: string;
  username: string;
  currentInstrument: string;
  currentCategory: InstrumentCategory;
  synthParams?: Partial<SynthState>;
  /**
   * Non-synth instrument pre-gain (DEV-301) — sibling to `synthParams` above, for
   * the 4 non-synth engines' `InstrumentParamsState { volume }`. Kept as a generic
   * bag (not a typed interface) the same way `ArrangeRoomState.instrumentParamsStates`
   * mirrors `synthStates`' genericness — the backend never needs the frontend-only
   * `InstrumentParamsState` shape, it just relays whatever the client sends.
   */
  instrumentParams?: Record<string, unknown>;
  effectChains: Record<string, unknown>;
  sequencerState?: {
    beats: unknown[];
    selectedBeat?: number;
    editMode?: boolean;
  };
  isInstrumentPracticing?: boolean;
  /** COLL-31: arpeggiator state so new peers receive it on join */
  arpeggioState?: {
    arpeggioSpeed: number; // ms delay between notes (0 = no arpeggio)
    mode: string;         // keyboard mode (e.g. 'simple-chord', 'hybrid')
    chordVoicing?: number;
  };
  isPlaying: boolean;
  lastNoteTimestamp?: number;
}

export interface RecordingStates {
  isAudioRecording: boolean;
  isSessionRecording: boolean;
  shadowCaptureStates: Record<string, boolean>;
}

export interface PerformRoomState extends BaseRoomState {
  roomType: 'perform';
  userStates: Map<string, UserPerformState>;
  recordingStates: RecordingStates;
  broadcastStates: Record<string, { username: string; isActive: boolean }>;
  voiceStates: Record<string, { isMuted: boolean }>;
  roomScale?: { rootNote: string; scale: 'major' | 'minor' };
  timeSignature: { numerator: number; denominator: number };
  companions: CompanionConfig[];
  companionChordLength: CompanionBarsPerChord;
  companionChordProgression: CompanionChordProgression;
  /** Room-global harmonic color applied to all companions in Auto mode (DEV-202). */
  companionProgressionFlavor: CompanionProgressionFlavor;
  /** Room-global Companion dropdown selection, synced even before companions exist. */
  companionSelectedGenrePreset?: CompanionGenrePreset;
  companionSelectedIntensity?: CompanionIntensityStep;
  companionOverrideInstruments?: boolean;
  /**
   * Element occupancy (DEV-350 M4 Task 24) — additive, room-agnostic presence-badge store
   * (`RoomOccupancyService`, `OCCUPANCY_EVENTS`), mirroring `ArrangeRoomState.occupancy`
   * (DEV-350 M2 Task 7). Replaces the old FE-only companion volume/settings/progression
   * lock broadcasts (`perform:companion_*_lock`), which had no BE Redis persistence.
   */
  occupancy: Map<string, ElementOccupancy>;
}
