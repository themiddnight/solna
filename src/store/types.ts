import type {
  SynthParams,
  ChordItem,
  SequencerTrack,
  MasterEffects,
  ViewMode,
  CustomChordProgressionItem,
} from '../types';
import type { SynthControlTarget } from '../utils/synthControl';
import type { SynthPresetItem, SynthPresetCategory } from '../audio/synthPresets';

export interface TransportSlice {
  bpm: number;
  masterVolume: number;
  metronomeActive: boolean;
  // Transient (not persisted): mirrors the live transport state.
  isSequencerPlaying: boolean;
  isChordsPlaying: boolean;
  setBpm: (bpm: number) => void;
  setMasterVolume: (volume: number) => void;
  toggleMetronome: () => void;
  toggleSequencerPlay: () => void;
  toggleChordsPlay: () => void;
  toggleMasterPlay: () => void;
  resetClockIfStopped: () => void;
}

export interface MusicContextSlice {
  scaleRoot: string;
  scaleType: string;
  projectTitle: string;
  setScaleRoot: (root: string) => void;
  setScaleType: (type: string) => void;
  applyTemplate: (templateName: string) => void;
}

export interface SynthSlice {
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  controlTarget: SynthControlTarget;
  applySynthPreset: (preset: Partial<SynthParams>) => void;
}

export interface ChordsSlice {
  chords: ChordItem[];
  chordRhythmId: string;
  chordFeel: number;
  chordOctave: number;
  chordMuted: boolean;
  chordVolume: number;
  setChordOctave: (octave: number) => void;
}

export interface BassSlice {
  bassPatternId: string;
  bassFeel: number;
  bassOctave: number;
  bassMuted: boolean;
  bassVolume: number;
}

export interface SequencerSlice {
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  masterSequencerVolume: number;
  applyDrumPattern: (pattern: Record<string, boolean[]>) => void;
}

export interface EffectsSlice {
  effects: MasterEffects;
  setEffects: (effects: MasterEffects) => void;
}

export interface UiSlice {
  // All ui state is transient (not persisted); the active tab comes from the URL query.
  activeTab: ViewMode;
  isAiModalOpen: boolean;
  isProjectModalOpen: boolean;
  setActiveTab: (tab: ViewMode) => void;
  openAiModal: () => void;
  closeAiModal: () => void;
  openProjectsModal: () => void;
  closeProjectsModal: () => void;
}

export interface PresetsSlice {
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
  saveCustomPreset: (
    name: string,
    params: SynthParams,
    category?: SynthPresetCategory,
    description?: string
  ) => SynthPresetItem;
  updateCustomPreset: (id: string, updates: Partial<SynthPresetItem>) => SynthPresetItem[];
  deleteCustomPreset: (id: string) => SynthPresetItem[];
  saveCustomChordProgression: (
    name: string,
    chords: ChordItem[],
    category?: string,
    description?: string,
    roman?: string
  ) => CustomChordProgressionItem;
  deleteCustomChordProgression: (id: string) => CustomChordProgressionItem[];
}

export interface AppStore
  extends TransportSlice,
    MusicContextSlice,
    SynthSlice,
    ChordsSlice,
    BassSlice,
    SequencerSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice {}

// The exact allow-list shape produced by the persist `partialize` config.
export interface PersistedState {
  bpm: number;
  masterVolume: number;
  metronomeActive: boolean;
  scaleRoot: string;
  scaleType: string;
  projectTitle: string;
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  controlTarget: SynthControlTarget;
  chords: ChordItem[];
  chordRhythmId: string;
  chordFeel: number;
  chordOctave: number;
  chordMuted: boolean;
  chordVolume: number;
  bassPatternId: string;
  bassFeel: number;
  bassOctave: number;
  bassMuted: boolean;
  bassVolume: number;
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  masterSequencerVolume: number;
  effects: MasterEffects;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
}
