import type {
  SynthParams,
  ChordItem,
  SequencerTrack,
  MasterEffects,
  ViewMode,
  CustomChordProgressionItem,
  FilterType,
  KeyboardMode,
} from '../types';
import type { SynthControlTarget } from '../utils/synthControl';
import type { MeterId } from '../utils/meter';
import type { SynthPresetItem, SynthPresetCategory } from '../audio/synthPresets';
import type { BassStepChoice } from '../audio/bassPatterns';

/** A player is `stopping` between a soft stop and the bar line that ends it. */
export type PlayerState = 'stopped' | 'playing' | 'stopping';

export type PlayerModule = 'sequencer' | 'chords';

export interface TransportSlice {
  bpm: number;
  /** Active time signature; the sequencer bar length is derived from this, not fixed. */
  meterId: MeterId;
  masterVolume: number;
  metronomeActive: boolean;
  // Transient (not persisted): mirrors the live transport state.
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  // Transient playhead (not persisted): `playheadBeat` is the absolute beat
  // index since the shared clock was reset, so every consumer measures from the
  // same origin; the chord fields say which chord the Chords player is sounding
  // and the beat it began on.
  playheadBeat: number | null;
  playheadChordIndex: number | null;
  playheadChordStartBeat: number;
  setPlayheadBeat: (beat: number | null) => void;
  setPlayheadChord: (chordIndex: number | null, startBeat?: number) => void;
  setBpm: (bpm: number) => void;
  setMeter: (id: MeterId) => void;
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
  selectedVibeId: string | null;
  setScaleRoot: (root: string) => void;
  setScaleType: (type: string) => void;
  setSelectedVibeId: (id: string | null) => void;
}

export interface SynthSlice {
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  controlTarget: SynthControlTarget;
  synthVolume: number;
  synthMuted: boolean;
  setSynthParams: (params: SynthParams) => void;
  setChordSynthParams: (params: SynthParams) => void;
  setBassSynthParams: (params: SynthParams) => void;
  setControlTarget: (target: SynthControlTarget) => void;
  setSynthVolume: (volume: number) => void;
  toggleSynthMuted: () => void;
}

export interface ChordsSlice {
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  setChordRhythmMode: (mode: 'preset' | 'custom') => void;
  setCustomChordRhythm: (steps: boolean[]) => void;
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
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  setBassPatternMode: (mode: 'preset' | 'custom') => void;
  setCustomBassPattern: (steps: BassStepChoice[]) => void;
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
  drumMuted: boolean;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  applyDrumPattern: (pattern: Record<string, boolean[]>) => void;
  setSequencerTracks: (tracks: SequencerTrack[]) => void;
  setSoundKit: (kit: string) => void;
  setMasterSequencerVolume: (volume: number) => void;
  toggleDrumMuted: () => void;
  setDrumFilterCutoff: (cutoff: number) => void;
  setDrumFilterResonance: (resonance: number) => void;
  setDrumFilterType: (type: FilterType) => void;
}

export interface MidiMapping {
  id: string;
  type: 'cc' | 'note';
  ccNumber?: number;
  targetKey: string;
  targetLabel: string;
  enabled: boolean;
}

export const DEFAULT_MIDI_MAPPINGS: MidiMapping[] = [
  { id: 'm-vol', type: 'cc', ccNumber: 7, targetKey: 'masterVolume', targetLabel: 'Master Volume', enabled: true },
  { id: 'm-cutoff', type: 'cc', ccNumber: 74, targetKey: 'filterCutoff', targetLabel: 'Filter Cutoff', enabled: true },
  { id: 'm-res', type: 'cc', ccNumber: 71, targetKey: 'filterResonance', targetLabel: 'Filter Resonance', enabled: true },
  { id: 'm-osc', type: 'cc', ccNumber: 16, targetKey: 'oscType', targetLabel: 'Oscillator Type', enabled: true },
  { id: 'm-atk', type: 'cc', ccNumber: 73, targetKey: 'attack', targetLabel: 'Attack Time', enabled: true },
  { id: 'm-rel', type: 'cc', ccNumber: 72, targetKey: 'release', targetLabel: 'Release Time', enabled: true },
  { id: 'm-notes', type: 'note', targetKey: 'notes', targetLabel: 'Keyboard Notes (Note On/Off)', enabled: true },
];

export interface EffectsSlice {
  effects: MasterEffects;
  setEffects: (effects: MasterEffects) => void;
}

export interface UiSlice {
  // All ui state is transient (not persisted); the active tab comes from the URL query.
  activeTab: ViewMode;
  // The synth keyboard's input mode. Transient by design: an input
  // preference, not composition data, so it does not travel with saved
  // projects (see partializeAppState in store.ts).
  keyboardMode: KeyboardMode;
  midiActivityTimestamp: number | null;
  midiMappings: MidiMapping[];
  isMidiSettingsOpen: boolean;
  midiLearnTargetId: string | null;
  selectedMidiInputId: string;
  setActiveTab: (tab: ViewMode) => void;
  setKeyboardMode: (mode: KeyboardMode) => void;
  triggerMidiActivity: () => void;
  setMidiMappings: (mappings: MidiMapping[]) => void;
  updateMidiMapping: (id: string, updates: Partial<MidiMapping>) => void;
  addMidiMapping: (mapping: MidiMapping) => void;
  removeMidiMapping: (id: string) => void;
  resetMidiMappings: () => void;
  setIsMidiSettingsOpen: (open: boolean) => void;
  setMidiLearnTargetId: (id: string | null) => void;
  setSelectedMidiInputId: (id: string) => void;
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
  meterId: MeterId;
  masterVolume: number;
  metronomeActive: boolean;
  scaleRoot: string;
  scaleType: string;
  selectedVibeId: string | null;
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  controlTarget: SynthControlTarget;
  synthVolume: number;
  synthMuted: boolean;
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  chordFeel: number;
  chordOctave: number;
  chordMuted: boolean;
  chordVolume: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  bassFeel: number;
  bassOctave: number;
  bassMuted: boolean;
  bassVolume: number;
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  masterSequencerVolume: number;
  drumMuted: boolean;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  effects: MasterEffects;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
}
