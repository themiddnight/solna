import type {
  SynthParams,
  ChordItem,
  SequencerTrack,
  MasterEffects,
  ViewMode,
  CustomChordProgressionItem,
  FilterType,
  KeyboardMode,
  InputPanelMode,
} from '../types';
import type { SynthControlTarget } from '../utils/synthControl';
import type { MeterId } from '../utils/meter';
import type { SynthPresetItem, SynthPresetCategory } from '../audio/synthPresets';
import type { BassStepChoice } from '../audio/bassPatterns';

/** A player is `stopping` between a soft stop and the bar line that ends it. */
export type PlayerState = 'stopped' | 'playing' | 'stopping';

export type PlayerModule = 'sequencer' | 'chords' | 'lead';

export interface TransportSlice {
  bpm: number;
  /** Active time signature; the sequencer bar length is derived from this, not fixed. */
  meterId: MeterId;
  masterVolume: number;
  metronomeActive: boolean;
  // Transient (not persisted): mirrors the live transport state.
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  leadPlayer: PlayerState;
  // Transient playhead (not persisted): `playheadBeat` is the absolute beat
  // index since the shared clock was reset, so every consumer measures from the
  // same origin; the chord fields say which chord the Chords player is sounding
  // and the beat it began on.
  playheadBeat: number | null;
  playheadChordIndex: number | null;
  playheadChordStartBeat: number;
  setPlayheadBeat: (beat: number | null) => void;
  setPlayheadChord: (chordIndex: number | null, startBeat?: number) => void;
  /** Transient song-mode cursor: index into loops[] currently sounding, null = loop mode. */
  songLoopIndex: number | null;
  /** Transient audition loop id: when set, plays only this loop in isolated loop mode inside the song layer. */
  auditionLoopId: string | null;
  setSongLoopIndex: (index: number | null) => void;
  setAuditionLoopId: (id: string | null) => void;
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

export type LeadMelodyView = 'scale-locked' | 'chromatic';

export interface LeadSlice {
  /** Absolute note names per step, stored at a fixed MAX_STEPS_PER_BAR per bar. */
  leadMelodySteps: string[][];
  /** Loop length in bars; must divide Σ ChordItem.bars. */
  leadLoopLength: number;
  /** Transient view mode; not persisted. */
  leadMelodyView: LeadMelodyView;
  /** Transient lowest octave of the visible window; not persisted. */
  leadMelodyOctave: number;
  setLeadMelodySteps: (steps: string[][]) => void;
  setLeadLoopLength: (bars: number) => void;
  /** Like setLeadLoopLength but never resizes/trims the melody grid. */
  setLeadLoopLengthPreserve: (bars: number) => void;
  setLeadMelodyView: (view: LeadMelodyView) => void;
  setLeadMelodyOctave: (octave: number) => void;
  toggleLeadNote: (stepIndex: number, note: string) => void;
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
  // The bottom input dock's open state and active tab. Session-only by design:
  // an input-surface preference, not composition data (see partializeAppState).
  isInputPanelOpen: boolean;
  inputPanelMode: InputPanelMode;
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
  setIsInputPanelOpen: (open: boolean) => void;
  setInputPanelMode: (mode: InputPanelMode) => void;
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

/** A full per-loop musical snapshot: identity + the 31 per-loop fields. */
export interface Loop {
  id: string;
  name: string; // auto-named "Loop N"; ids are the stable handle
  repeatCount?: number; // default 1, number of times this loop plays before advancing in song mode
  scaleRoot: string;
  scaleType: string;
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  bassFeel: number;
  bassOctave: number;
  leadMelodySteps: string[][];
  leadLoopLength: number;
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  synthVolume: number;
  synthMuted: boolean;
  chordVolume: number;
  chordMuted: boolean;
  bassVolume: number;
  bassMuted: boolean;
  masterSequencerVolume: number;
  drumMuted: boolean;
}

/** The 31 per-loop fields, without identity — what loadLoop writes to the flat slices. */
export type LoopStatePatch = Omit<Loop, 'id' | 'name' | 'repeatCount'>;

/** The per-loop mixer: the 8 volume/mute fields edited on each Arrange card. */
export type LoopMixPatch = Pick<
  Loop,
  | 'synthVolume'
  | 'synthMuted'
  | 'chordVolume'
  | 'chordMuted'
  | 'bassVolume'
  | 'bassMuted'
  | 'masterSequencerVolume'
  | 'drumMuted'
>;

export interface LoopSlice {
  /** The arrangement, in list (playback) order. Always ≥ 1 element. */
  loops: Loop[];
  /** Id of the loop currently being edited. */
  activeLoopId: string;
  addLoop: () => string;
  duplicateLoop: (id: string) => string | null;
  deleteLoop: (id: string) => string | null;
  reorderLoops: (id: string, direction: -1 | 1) => void;
  reorderLoopsArray: (loops: Loop[]) => void;
  setLoopName: (id: string, name: string) => void;
  setLoopRepeatCount: (id: string, repeatCount: number) => void;
  setActiveLoop: (id: string) => void;
  /** Edit a loop's 8 mixer fields in place; mirrors to the flat slices when active. */
  setLoopMix: (id: string, patch: Partial<LoopMixPatch>) => void;
}

export interface AppStore
  extends TransportSlice,
    MusicContextSlice,
    SynthSlice,
    ChordsSlice,
    BassSlice,
    LeadSlice,
    SequencerSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice,
    LoopSlice {}

// The exact allow-list shape produced by the persist `partialize` config.
// Per-loop fields live inside `loops`; the nine global fields stay
// top-level. `loops` ∪ {the nine globals} reconstructs today's single
// persisted snapshot exactly.
export interface PersistedState {
  bpm: number;
  meterId: MeterId;
  masterVolume: number;
  metronomeActive: boolean;
  selectedVibeId: string | null;
  controlTarget: SynthControlTarget;
  effects: MasterEffects;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
  loops: Loop[];
  activeLoopId: string;
}
