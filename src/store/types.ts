import type {
  SynthParams,
  ChordItem,
  SequencerTrack,
  MasterEffects,
  ViewMode,
  CustomChordProgressionItem,
  FilterType,
} from '../types';
import type { SynthControlTarget } from '../utils/synthControl';
import type { SynthPresetItem, SynthPresetCategory } from '../audio/synthPresets';

/** A player is `stopping` between a soft stop and the bar line that ends it. */
export type PlayerState = 'stopped' | 'playing' | 'stopping';

export type PlayerModule = 'sequencer' | 'chords';

export interface TransportSlice {
  bpm: number;
  masterVolume: number;
  metronomeActive: boolean;
  // Transient (not persisted): mirrors the live transport state.
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  setBpm: (bpm: number) => void;
  setMasterVolume: (volume: number) => void;
  toggleMetronome: () => void;
  play: (module: PlayerModule) => void;
  softStop: (module: PlayerModule) => void;
  hardStop: (module: PlayerModule) => void;
  playAll: () => void;
  softStopAll: () => void;
  hardStopAll: () => void;
}

export interface MusicContextSlice {
  scaleRoot: string;
  scaleType: string;
  projectTitle: string;
  setScaleRoot: (root: string) => void;
  setScaleType: (type: string) => void;
  setProjectTitle: (title: string) => void;
  applyTemplate: (templateName: string) => void;
}

export interface SynthSlice {
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  controlTarget: SynthControlTarget;
  setSynthParams: (params: SynthParams) => void;
  setChordSynthParams: (params: SynthParams) => void;
  setBassSynthParams: (params: SynthParams) => void;
  setControlTarget: (target: SynthControlTarget) => void;
}

export interface ChordsSlice {
  chords: ChordItem[];
  chordRhythmId: string;
  chordFeel: number;
  chordOctave: number;
  chordMuted: boolean;
  chordVolume: number;
  setChords: (chords: ChordItem[]) => void;
  setChordRhythmId: (rhythmId: string) => void;
  setChordFeel: (feel: number) => void;
  setChordOctave: (octave: number) => void;
  setChordVolume: (volume: number) => void;
  toggleChordMuted: () => void;
}

export interface BassSlice {
  bassPatternId: string;
  bassFeel: number;
  bassOctave: number;
  bassMuted: boolean;
  bassVolume: number;
  setBassPatternId: (patternId: string) => void;
  setBassFeel: (feel: number) => void;
  setBassOctave: (octave: number) => void;
  setBassVolume: (volume: number) => void;
  toggleBassMuted: () => void;
}

export interface SequencerSlice {
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  masterSequencerVolume: number;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  applyDrumPattern: (pattern: Record<string, boolean[]>) => void;
  setSequencerTracks: (tracks: SequencerTrack[]) => void;
  setSoundKit: (kit: string) => void;
  setMasterSequencerVolume: (volume: number) => void;
  setDrumFilterCutoff: (cutoff: number) => void;
  setDrumFilterResonance: (resonance: number) => void;
  setDrumFilterType: (type: FilterType) => void;
}

export interface EffectsSlice {
  effects: MasterEffects;
  setEffects: (effects: MasterEffects) => void;
}

export interface UiSlice {
  // All ui state is transient (not persisted); the active tab comes from the URL query.
  activeTab: ViewMode;
  isProjectModalOpen: boolean;
  setActiveTab: (tab: ViewMode) => void;
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
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  effects: MasterEffects;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
}
