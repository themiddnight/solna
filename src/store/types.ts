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
  PadInterval,
  PadMode,
  PadVoicing,
} from '../types';
import type { MeterId } from '../utils/meter';
import type { SynthPresetItem, SynthPresetCategory } from '../data/synthPresets';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { LeadNote } from '../audio/leadMelody';
import type { LoopCopyGroupId } from './loopCopy';
import type { LeadStepResolutionId } from '../utils/stepResolution';
import type { MelodyTrackId } from './melodyTracks';
import type { PlaybackScope } from './playbackScope';
import type { ProjectSlice } from './projectSlice';
import type { SoloTrack } from './trackAudibility';
import type { MixLayerId } from './focusTrack';

/** A player is `stopping` between a soft stop and the bar line that ends it. */
export type PlayerState = 'stopped' | 'playing' | 'stopping';

export type PlayerModule = 'sequencer' | 'chords' | 'lead' | 'fx';

export interface TransportSlice {
  bpm: number;
  /** Active time signature; the sequencer bar length is derived from this, not fixed. */
  meterId: MeterId;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. Converted to a
   *  linear gain at the store->engine boundary in engineSync.ts, never here. */
  masterVolume: number;
  metronomeActive: boolean;
  // Transient (not persisted): mirrors the live transport state.
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  leadPlayer: PlayerState;
  fxPlayer: PlayerState;
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
  setSongLoopIndex: (index: number | null) => void;
  /**
   * Transient (never persisted): the single source of truth for playback MODE.
   * `songLoopIndex` beside it is a pure CURSOR — never read its null-ness as a
   * mode. See src/store/playbackScope.ts.
   */
  playbackScope: PlaybackScope;
  /** A loop card's play/stop button and the Loop layer's master Play: play
   *  this loop alone (scope `loop`), or stop it. Not the track solo. */
  soloLoop: (loopId: string) => void;
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
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  synthVolume: number;
  synthMuted: boolean;
  setSynthParams: (params: SynthParams) => void;
  setChordSynthParams: (params: SynthParams) => void;
  setBassSynthParams: (params: SynthParams) => void;
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
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
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
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  bassVolume: number;
  setBassPatternId: (patternId: string) => void;
  setBassFeel: (feel: number) => void;
  setBassOctave: (octave: number) => void;
  setBassVolume: (volume: number) => void;
  toggleBassMuted: () => void;
}

/**
 * The pad/drone layer's per-loop state, declared once: the live slice (below)
 * and the stored `Loop` are the same eight fields, and `defaultPadState()` in
 * initialState.ts builds exactly them. Listing them a third time is how one
 * copy quietly drifts from the others.
 */
export interface PadState {
  padSynthParams: SynthParams;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  padVolume: number;
  padMuted: boolean;
}

export interface PadSlice extends PadState {
  setPadSynthParams: (params: SynthParams) => void;
  setPadMode: (mode: PadMode) => void;
  setPadOctave: (octave: number) => void;
  setPadVoicing: (voicing: PadVoicing) => void;
  setPadDroneDegree: (degree: number) => void;
  setPadDroneIntervals: (intervals: readonly PadInterval[]) => void;
  togglePadDroneInterval: (interval: PadInterval) => void;
  setPadVolume: (volume: number) => void;
  togglePadMuted: () => void;
}

export type LeadMelodyView = 'scale-locked' | 'chromatic';

/**
 * How one note write should behave. A click toggles; a drag-to-paint stroke
 * commits to one direction at pointer-down and keeps it for every cell it
 * crosses. Declared in the store because the store owns the write — the grid
 * narrows it to the two directions a stroke can take.
 */
export type LeadNotePaintMode = 'draw' | 'erase' | 'toggle';

export interface LeadSlice {
  /**
   * Notes per bar, stored at a fixed LEAD_TICKS_PER_BAR per bar and windowed
   * to the active meter AND resolution. The index is the TICK a note STARTS
   * on — not a 16th and not a visible column.
   */
  leadMelodySteps: LeadNote[][];
  /** Loop length in bars; must divide Σ ChordItem.bars. */
  leadLoopLength: number;
  /**
   * How fine this loop's melody grid is. Per loop, not global: a global
   * flip would silence off-grid notes in every loop at once, so refining
   * one melody would mute another the user was not looking at.
   */
  leadStepResolution: LeadStepResolutionId;
  /** Scale-locked or chromatic rows; persisted per loop. */
  leadMelodyView: LeadMelodyView;
  /** Lowest octave of the visible window; persisted per loop. */
  leadMelodyOctave: number;
  /** Fraction of a note's FINAL step that sounds, 0.05-1.0; per loop. */
  leadGate: number;
  setLeadMelodySteps: (steps: LeadNote[][]) => void;
  setLeadLoopLength: (bars: number) => void;
  /** Like setLeadLoopLength but never resizes/trims the melody grid. */
  setLeadLoopLengthPreserve: (bars: number) => void;
  setLeadStepResolution: (id: LeadStepResolutionId) => void;
  setLeadMelodyView: (view: LeadMelodyView) => void;
  setLeadMelodyOctave: (octave: number) => void;
  setLeadGate: (gate: number) => void;
  /** The selected COLUMN. The selected bar is derived, never stored beside it. */
  leadCursor: number;
  /** One copied bar at its full stored width, or null before the first copy. */
  leadBarClipboard: LeadNote[][] | null;
  setLeadCursor: (cursor: number) => void;
  copySelectedLeadBar: () => void;
  pasteIntoSelectedLeadBar: () => void;
  /**
   * Write a PERFORMED note at the given column, or at the cursor if omitted.
   * The column is clamped to the live loop window either way; the cursor is
   * never moved. Declines unless `recordingTrack` names this track, or if the
   * note is anything the grid cannot show — out-of-scale in scale-locked
   * view, or an octave no legal
   * window reaches. Follows the octave window when possible, so a recorded
   * note is never invisible.
   *
   * Returns whether it actually wrote, which is NOT the same as "was armed
   * and legal": a column already covered by this pitch is a deliberate no-op
   * and reports false, so a caller tracking held notes does not hold a row
   * that never received one.
   */
  recordLeadNote: (note: string, column?: number) => boolean;
  toggleLeadNote: (stepIndex: number, note: string) => void;
  /**
   * Add or remove one drawn note. `'toggle'` is the click; `'draw'`/`'erase'`
   * are the two directions a drag-to-paint stroke can take, and are no-ops
   * when the cell is already in the state the stroke wants.
   */
  paintLeadNote: (stepIndex: number, note: string, mode: LeadNotePaintMode) => void;
  /**
   * Set a drawn note's length. `stepIndex` is the STORED index and `len`
   * counts TICKS — the same unit LeadNote.len is in, so a caller working in
   * visible cells must multiply by the active stride first (LeadMelodyGrid
   * and useLeadNoteResize both do). The one place the three length invariants
   * are enforced.
   */
  setLeadNoteLength: (stepIndex: number, note: string, len: number) => void;
}

/**
 * The FX track's melody-editing state, mirroring LeadSlice's eight non-recording
 * fields and thirteen actions exactly: `createFxSlice` (fxSlice.ts) is the
 * other call site of the same `createMelodySlice` factory `createLeadSlice`
 * calls. `recordFxNote` is the fourteenth action the factory builds, and there is no
 * `fxRecording` beside it: the armed track is one scalar in the ui slice
 * (`recordingTrack`), so both tracks' record actions ask the same value which
 * track it names.
 */
export interface FxSlice {
  /** Notes per bar, stored at a fixed LEAD_TICKS_PER_BAR per bar and windowed
   *  to the active meter AND resolution. The index is the TICK a note STARTS
   *  on — not a 16th and not a visible column. */
  fxMelodySteps: LeadNote[][];
  /** Loop length in bars; must divide Σ ChordItem.bars. */
  fxLoopLength: number;
  /** How fine this loop's melody grid is. Per loop, not global — see
   *  LeadSlice.leadStepResolution. */
  fxStepResolution: LeadStepResolutionId;
  /** Scale-locked or chromatic rows; persisted per loop. */
  fxMelodyView: LeadMelodyView;
  /** Lowest octave of the visible window; persisted per loop. */
  fxMelodyOctave: number;
  /** Fraction of a note's FINAL step that sounds, 0.05-1.0; per loop. */
  fxGate: number;
  setFxMelodySteps: (steps: LeadNote[][]) => void;
  setFxLoopLength: (bars: number) => void;
  /** Like setFxLoopLength but never resizes/trims the melody grid. */
  setFxLoopLengthPreserve: (bars: number) => void;
  setFxStepResolution: (id: LeadStepResolutionId) => void;
  setFxMelodyView: (view: LeadMelodyView) => void;
  setFxMelodyOctave: (octave: number) => void;
  setFxGate: (gate: number) => void;
  /** The selected COLUMN. The selected bar is derived, never stored beside it. */
  fxCursor: number;
  /** One copied bar at its full stored width, or null before the first copy. */
  fxBarClipboard: LeadNote[][] | null;
  setFxCursor: (cursor: number) => void;
  copySelectedFxBar: () => void;
  pasteIntoSelectedFxBar: () => void;
  toggleFxNote: (stepIndex: number, note: string) => void;
  /** Add or remove one drawn note — see LeadSlice.paintLeadNote. */
  paintFxNote: (stepIndex: number, note: string, mode: LeadNotePaintMode) => void;
  /** Set a drawn note's length — see LeadSlice.setLeadNoteLength. */
  setFxNoteLength: (stepIndex: number, note: string, len: number) => void;
  /** Write a PERFORMED note — see LeadSlice.recordLeadNote. Declines unless
   *  `recordingTrack === 'fx'`. */
  recordFxNote: (note: string, column?: number) => boolean;
  /** The FX synth voice's live params. */
  fxSynthParams: SynthParams;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  fxVolume: number;
  fxMuted: boolean;
  setFxSynthParams: (params: SynthParams) => void;
  setFxVolume: (volume: number) => void;
  toggleFxMuted: () => void;
}

export interface SequencerSlice {
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  masterSequencerVolume: number;
  drumMuted: boolean;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  /**
   * Write a whole drum grid onto the sequencer.
   *
   * REPLACES, it does not merge. A track whose instrument the pattern does not
   * name has its active window CLEARED — a drum grid determines the whole kit,
   * so picking "Techno" gives you techno and not techno plus leftovers.
   *
   * It was `applyDrumPattern` and it skipped unnamed tracks. That was invisible
   * while every grid declared every row the five tracks had; it became a bug
   * the moment `tom` and `crash` tracks existed, because the 14 sequencer genre
   * grids declare no `crash` and a vibe's crash would ring on underneath one.
   */
  replaceDrumPattern: (pattern: Record<string, boolean[]>) => void;
  setSequencerTracks: (tracks: SequencerTrack[]) => void;
  /** Sets one track's level, in DECIBELS. */
  setTrackVolume: (trackId: string, db: number) => void;
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
  /**
   * The ONE "what am I working on" value: which track Sound's panels edit and
   * which grid Pattern shows. Its id type is the mixer's roster, deliberately
   * — the app already had four vocabularies for "a track" and a fifth would
   * guarantee a fifth translation table. `'synth'` means Lead.
   *
   * Unlike the rest of this slice it IS persisted, top-level, exactly where
   * `controlTarget` was: it is a user preference that should survive a reload.
   * It is NOT project content — `PROJECT_CONTENT_KEYS` excludes it for the
   * same reason it excluded `controlTarget`.
   */
  focusTrack: MixLayerId;
  /**
   * Track solo — the five source buses that are being monitored alone.
   *
   * Session-only and NEVER persisted: it is absent from partializeAppState and
   * from PROJECT_CONTENT_KEYS, and it must stay absent (a project that reopens
   * with a solo latched is the failure this design exists to avoid). Mute is
   * the opposite gesture and stays where it is — per loop, in LoopMixPatch.
   *
   * A SET, not a radio: soloing Drums and then Lead sounds both. Always held in
   * SOLO_TRACKS order, whatever order the buttons were pressed in.
   *
   * Cleared by navigation — see store/soloNav.ts, which owns that rule for
   * every writer of the LAYER (Loop ↔ Song) and of activeLoopId at once.
   * Neither a tab change within the Loop layer nor a `focusTrack` change
   * clears it — see soloNav.ts for why the focus survival is what makes a
   * multi-track set buildable at all.
   */
  soloTracks: SoloTrack[];
  /**
   * The melody track Rec is armed on, or null when nothing is armed.
   *
   * ONE value, not a boolean per track. Two booleans would have nothing
   * stopping both being true, and one live-capture clock would then write two
   * grids from a single keypress — a state unreachable through the UI, so no
   * test would find it. `MelodyTrackId | null` makes it unrepresentable.
   *
   * It lives HERE rather than on LeadSlice/FxSlice because it spans both: a
   * per-track slice cannot own a value whose whole purpose is being unique
   * ACROSS tracks. That is also why MELODY_TRACKS gains no `recording`
   * column — see its docblock.
   *
   * Session-only and NEVER persisted, like everything else in this slice: it
   * is absent from partializeAppState and must stay absent, because an armed
   * recorder surviving a reload would capture the first note of the next
   * session into a project the user thought they had only opened.
   */
  recordingTrack: MelodyTrackId | null;
  // The synth keyboard's input mode. Transient by design: an input
  // preference, not composition data, so it does not travel with saved
  // projects (see partializeAppState in store.ts).
  keyboardMode: KeyboardMode;
  /**
   * Whether the Arrange view scrolls the playing loop into view as song
   * playback walks from one card to the next. A VIEW preference, not
   * composition data: like `keyboardMode` it is absent from
   * partializeAppState and rides its own localStorage key instead, so it
   * survives a reload without travelling with a saved/exported song.
   */
  followPlayhead: boolean;
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
  setFocusTrack: (focus: MixLayerId) => void;
  toggleSoloTrack: (track: SoloTrack) => void;
  clearSoloTracks: () => void;
  setRecordingTrack: (track: MelodyTrackId | null) => void;
  setKeyboardMode: (mode: KeyboardMode) => void;
  toggleFollowPlayhead: () => void;
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

/** A full per-loop musical snapshot: identity + every per-loop field. */
/**
 * The FX track's per-loop state: a twin of the lead's, plus its own patch and
 * bus pair. Its own interface, like PadState, so `Loop` states what it holds in
 * blocks and `defaultFxState()` has something to return.
 *
 * The types are the LEAD's types by construction — the FX grid is the lead grid
 * with a different trackId, so a divergence here would be a second grid model,
 * which is exactly what the design rejected.
 */
export interface FxState {
  /** Notes per bar at LEAD_TICKS_PER_BAR; the index is the TICK a note starts on. */
  fxMelodySteps: LeadNote[][];
  fxLoopLength: number;
  fxStepResolution: LeadStepResolutionId;
  fxMelodyView: LeadMelodyView;
  fxMelodyOctave: number;
  fxGate: number;
  fxSynthParams: SynthParams;
  fxVolume: number;
  fxMuted: boolean;
}

export interface Loop extends PadState, FxState {
  id: string;
  /** The USER's name. '' until they set one, '' again if they clear it; nothing but a rename writes it. */
  name: string;
  /**
   * The APP's label, never empty. Starts at `untitled-{n}` and is overwritten
   * with a vibe's display NAME (a snapshot, not a reference) whenever a vibe
   * is applied to this loop. Deliberately NOT in LOOP_FLAT_KEYS: it is
   * loop-slot identity, not loop content, so it never rides in a
   * LoopStatePatch and no copy group can name it.
   */
  tempName: string;
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
  leadMelodySteps: LeadNote[][];
  leadLoopLength: number;
  leadStepResolution: LeadStepResolutionId;
  leadMelodyView: LeadMelodyView;
  leadMelodyOctave: number;
  leadGate: number;
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  synthVolume: number;
  synthMuted: boolean;
  chordVolume: number;
  chordMuted: boolean;
  bassVolume: number;
  bassMuted: boolean;
  masterSequencerVolume: number;
  drumMuted: boolean;
}

/** The per-loop fields, without identity — what loadLoop writes to the flat slices. */
export type LoopStatePatch = Omit<Loop, 'id' | 'name' | 'repeatCount' | 'tempName'>;

/** The per-loop mixer: the 12 volume/mute fields edited on each Arrange card. */
export type LoopMixPatch = Pick<
  Loop,
  | 'synthVolume'
  | 'synthMuted'
  | 'chordVolume'
  | 'chordMuted'
  | 'bassVolume'
  | 'bassMuted'
  | 'padVolume'
  | 'padMuted'
  | 'fxVolume'
  | 'fxMuted'
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
  /**
   * The app's label for a loop — written by the vibe path, never by a rename.
   * Its own action rather than a flat setter because `tempName` is not in
   * LOOP_FLAT_KEYS, so loopSync's flat->loops[] mirror has no field to carry
   * it from; adding one would put a label into the copyable content set.
   */
  setLoopTempName: (id: string, tempName: string) => void;
  setLoopRepeatCount: (id: string, repeatCount: number) => void;
  setActiveLoop: (id: string) => void;
  /** Edit a loop's 12 mixer fields in place; mirrors to the flat slices when active. */
  setLoopMix: (id: string, patch: Partial<LoopMixPatch>) => void;
  /**
   * Overwrite the selected copy groups of `targetId` with `sourceId`'s
   * values. Implemented in loopCopySlice.ts rather than loopSlice.ts — see
   * that file's docblock for the import cycle that forces the split.
   */
  applyLoopCopy: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void;
}

export interface AppStore
  extends TransportSlice,
    MusicContextSlice,
    SynthSlice,
    ChordsSlice,
    BassSlice,
    PadSlice,
    LeadSlice,
    FxSlice,
    SequencerSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice,
    LoopSlice,
    ProjectSlice {}

// The exact allow-list shape produced by the persist `partialize` config — this
// interface and partializeAppState in store.ts must list the same keys. Project
// content is not here: it is autosaved to IndexedDB, see store/projectAutosave.ts.
export interface PersistedState {
  metronomeActive: boolean;
  selectedVibeId: string | null;
  focusTrack: MixLayerId;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
  activeLoopId: string;
}
