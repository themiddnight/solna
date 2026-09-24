import type {
  BeatMix,
  BeatParams,
  BeatPreset,
  BeatPattern,
  BeatVoiceId,
  BeatFilterParams,
  BeatVoices,
  ChordItem,
  MasterEffects,
  ViewMode,
  CustomChordProgressionItem,
  KeyboardMode,
  InputPanelMode,
  PadInterval,
  PadMode,
  PadVoicing,
  TrackSends,
} from '../types';
import type { ActiveSynth, ArpSettings } from '../types/synth';
import type { MeterId } from '../utils/timeSignature';
import type { SynthPreset, SynthPresetCategory } from '../data/synthPresets';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { LeadNote } from '../audio/playback/leadMelody';
import type { LoopCopyGroupId } from './loopCopy';
import type { BatchKeyTarget, LoopKeyChangeUndo } from './loopKeyChange';
import type { KeyChangeOptions } from './keyChange';
import type { LeadStepResolutionId } from '../utils/stepResolution';
import type { MelodyTrackId } from './melodyTracks';
import type { PlaybackScope } from './playbackScope';
import type { DriveSlice } from './driveSlice';
import type { DriveUserProfile } from './driveClient';
import type { ProjectSlice } from './projectSlice';
import type { ExportSlice } from './exportSlice';
import type { FeedbackSlice } from './feedbackSlice';
import type { TrackSendsSlice } from './trackSendsSlice';
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
  // Transient playhead (not persisted): which chord the Chords player is
  // sounding and the beat it began on. The beat itself is high-frequency and
  // lives outside the store, in a local pub/sub under `components/`.
  playheadChordIndex: number | null;
  playheadChordStartBeat: number;
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
  /** session-only: never persisted, never in a project. */
  autoReharmonize: boolean;
  /** session-only: never persisted, never in a project. */
  reharmonizedIndicator: boolean;
  setScaleRoot: (root: string) => void;
  setScaleType: (type: string) => void;
  setSelectedVibeId: (id: string | null) => void;
  setAutoReharmonize: (on: boolean) => void;
  setReharmonizedIndicator: (on: boolean) => void;
}

export interface SynthSlice {
  /**
   * The five per-track patch fields keep their names and change type: the
   * value is a complete `ActiveSynth` — engine tag, whole patch, provenance —
   * not a flat record of knob positions.
   *
   * Arp lives BESIDE the patch, never inside it. It is performance state: two
   * tracks can share a patch and arpeggiate differently, and a preset that
   * carried an arp would silently re-arm the player's arpeggiator every time
   * they auditioned a sound.
   */
  synthParams: ActiveSynth;
  chordSynthParams: ActiveSynth;
  bassSynthParams: ActiveSynth;
  synthArpSettings: ArpSettings;
  chordArpSettings: ArpSettings;
  bassArpSettings: ArpSettings;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  synthVolume: number;
  synthMuted: boolean;
  setSynthParams: (synth: ActiveSynth) => void;
  setChordSynthParams: (synth: ActiveSynth) => void;
  setBassSynthParams: (synth: ActiveSynth) => void;
  setSynthArpSettings: (arp: ArpSettings) => void;
  setChordArpSettings: (arp: ArpSettings) => void;
  setBassArpSettings: (arp: ArpSettings) => void;
  setSynthVolume: (volume: number) => void;
  toggleSynthMuted: () => void;
}

export interface ChordsSlice {
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  customChordLoopLength: number;
  customChordHoldSteps: number[];
  setChordRhythmMode: (mode: 'preset' | 'custom') => void;
  setCustomChordRhythm: (steps: boolean[]) => void;
  /**
   * Resize the custom chord lane to `bars`, clamped down to the nearest
   * positive divisor of the progression's bar count.
   */
  setCustomChordLoopLength: (bars: number) => void;
  /**
   * Toggle the block-chord onset at `column` — a 16th-step position in the
   * ACTIVE meter, and the head of the drawn block, never a slot a span covers.
   */
  setCustomChordEvent: (column: number, active: boolean) => void;
  /** Set the visible column's onset to `holdSteps`, clamped at the next folded chord boundary. */
  setCustomChordEventLength: (column: number, holdSteps: number) => void;
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
  customBassLoopLength: number;
  customBassHoldSteps: number[];
  setBassPatternMode: (mode: 'preset' | 'custom') => void;
  setCustomBassPattern: (steps: BassStepChoice[]) => void;
  /**
   * Resize the custom bass lane to `bars`, clamped down to the nearest
   * positive divisor of the progression's bar count.
   */
  setCustomBassLoopLength: (bars: number) => void;
  /**
   * Write `value` at `column` — a 16th-step position in the ACTIVE meter, and
   * the head of the drawn block. `'rest'` erases the span that starts there.
   */
  setCustomBassEvent: (column: number, value: BassStepChoice) => void;
  /** Set the visible column's onset to `holdSteps`, clamped at the next folded chord boundary. */
  setCustomBassEventLength: (column: number, holdSteps: number) => void;
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
  padSynthParams: ActiveSynth;
  padArpSettings: ArpSettings;
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
  setPadSynthParams: (synth: ActiveSynth) => void;
  setPadArpSettings: (arp: ArpSettings) => void;
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
  /** The FX synth voice's live patch. */
  fxSynthParams: ActiveSynth;
  fxArpSettings: ArpSettings;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  fxVolume: number;
  fxMuted: boolean;
  setFxSynthParams: (synth: ActiveSynth) => void;
  setFxArpSettings: (arp: ArpSettings) => void;
  setFxVolume: (volume: number) => void;
  toggleFxMuted: () => void;
}

/**
 * The Beat instrument's per-loop state: sound, events and levels as three
 * SIBLING fields, never one object. A sound edit must not be able to replace
 * the pattern or the mix, and every action below writes exactly one of them.
 *
 * Every write is immutable at the NARROWEST nested object it changes — one
 * voice's params, one row, one mix entry — so a knob tick on the kick leaves
 * the other ten voices' objects identical and a subscriber selecting a sibling
 * never re-renders.
 */
export interface BeatSlice {
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
  /** Install a factory (or, from Task 5, a user) preset's patch whole, recording it as the base. */
  setBeatPreset: (presetId: string) => void;
  /** Install a complete patch as-is; the caller owns its `basePresetId`. */
  setBeatParams: (params: BeatParams) => void;
  updateBeatVoice: <T extends BeatVoiceId>(voice: T, patch: Partial<BeatVoices[T]>) => void;
  /**
   * Some of the Beat bus filter's three fields, laid over whatever the patch is
   * holding right now.
   *
   * Its own action rather than a `setBeatParams` call built by the caller,
   * because the one caller that needs it — applying a vibe — writes a PRESET
   * first and then an override on top of it: reading `beatParams` back to
   * build that object means reading a snapshot taken before the preset landed,
   * which silently applies the override to the outgoing sound. The Beat
   * editor does NOT use it; a knob mid-drag has a draft to preview and commits
   * the whole patch once (see `useBeatParamDraft`).
   */
  updateBeatFilter: (patch: Partial<BeatFilterParams>) => void;
  /**
   * Restore one voice — or, for `resetBeatParams`, the whole patch — from
   * `basePresetId`. A null base makes reset unanswerable, so both are a NO-OP
   * then: substituting another preset would silently replace a sound the user
   * still has.
   */
  resetBeatVoice: (voice: BeatVoiceId) => void;
  resetBeatParams: () => void;
  /**
   * Write a whole grid. REPLACES, it does not merge: a voice the rows do not
   * name is cleared, the same rule `replaceDrumPattern` follows and for the
   * same reason. Only the ACTIVE meter's window is written, so wider-meter
   * programming past `stepsPerBar` survives.
   */
  replaceBeatPattern: (rows: Partial<Record<BeatVoiceId, readonly boolean[]>>) => void;
  /** Flip one cell. `step` indexes the STORED row, which the visible window is a prefix of. */
  toggleBeatStep: (voice: BeatVoiceId, step: number) => void;
  /** One voice's user fader, in DECIBELS. Distinct from the voice `gain` inside the patch. */
  setBeatVoiceLevel: (voice: BeatVoiceId, levelDb: number) => void;
  toggleBeatVoiceMuted: (voice: BeatVoiceId) => void;
  /** The Beat bus fader, in DECIBELS. */
  setBeatLevel: (levelDb: number) => void;
  toggleBeatMuted: () => void;
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

/**
 * The one-slot copy-source buffer behind the loop editor's copy/paste buttons.
 * Copy is "copy all", so this is a reference to the source loop, not a
 * pre-selected group list — which groups move is decided per paste.
 * Session-only and never persisted.
 */
interface LoopClipboard {
  sourceLoopId: string;
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
   * The input target's pin (R341): `null` = linked, so the keyboard plays
   * `focusTrack`; a track id = unlinked, so the keyboard stays on that track
   * while the user looks elsewhere. One field holds both the link state and
   * the pinned track, so the two cannot drift apart. Read it through
   * `inputTargetOf` (store/focusTrack.ts), never directly: record arm
   * overrides it. Persisted beside `focusTrack`, validated on read.
   */
  inputTargetPin: MixLayerId | null;
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
  /**
   * The LoopCopyDialog's last applied copy selection, remembered across opens
   * within the session. Session-only and NEVER persisted — like everything
   * else in this slice it is absent from partializeAppState and
   * PROJECT_CONTENT_KEYS: a copy selection is an editing convenience, not
   * composition data, and a reload defaulting fresh is the right reset.
   * `sourceId` may name a loop since deleted; the dialog falls back to its
   * first source when it no longer resolves.
   */
  loopCopySelection: readonly LoopCopyGroupId[];
  loopCopySourceId: string | null;
  /**
   * The one-slot copy-source buffer for the loop editor's copy/paste buttons.
   * Session-only and NEVER persisted, like loopCopySelection above.
   * `sourceLoopId` may name a loop since deleted; paste clears the buffer when
   * it no longer resolves. Not cleared on a successful paste, so one copy can
   * be pasted into several loops in turn.
   */
  loopClipboard: LoopClipboard | null;
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
  /**
   * Session-only (never in partializeAppState): true while the vibe picker
   * previews. Gates QWERTY notes, QWERTY drum pads and MIDI note-on/CC at
   * their entry (R336). Written only on open and close (R016).
   */
  noteInputSuspended: boolean;
  setNoteInputSuspended: (suspended: boolean) => void;
  midiLearnTargetId: string | null;
  selectedMidiInputId: string;
  setActiveTab: (tab: ViewMode) => void;
  setFocusTrack: (focus: MixLayerId) => void;
  setInputTargetPin: (pin: MixLayerId | null) => void;
  toggleSoloTrack: (track: SoloTrack) => void;
  clearSoloTracks: () => void;
  setRecordingTrack: (track: MelodyTrackId | null) => void;
  setLoopCopySelection: (selection: readonly LoopCopyGroupId[], sourceId: string | null) => void;
  setLoopClipboard: (clipboard: LoopClipboard) => void;
  clearLoopClipboard: () => void;
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
  customSynthPresets: SynthPreset[];
  customChordProgressions: CustomChordProgressionItem[];
  /**
   * The user's saved Beat sounds, app-level beside `customSynthPresets` and
   * deliberately absent from `PROJECT_CONTENT_KEYS`: a library travels with the
   * BROWSER, a project carries its own complete `beatParams`. Deleting an entry
   * therefore never changes how a loop sounds.
   */
  customBeatPresets: BeatPreset[];
  saveCustomPreset: (
    name: string,
    activeSynth: ActiveSynth,
    category?: SynthPresetCategory,
    description?: string
  ) => SynthPreset;
  deleteCustomPreset: (id: string) => SynthPreset[];
  saveCustomChordProgression: (
    name: string,
    chords: ChordItem[],
    category?: string,
    description?: string,
    roman?: string
  ) => CustomChordProgressionItem;
  deleteCustomChordProgression: (id: string) => CustomChordProgressionItem[];
  /**
   * Capture `params` as a new user preset and make it the current base.
   *
   * The patch is stored as a deep copy with `basePresetId` stripped — a preset
   * IS a source, so carrying the id it was derived from would make every saved
   * sound claim the factory one behind it. The sound does not change: only the
   * loop's `basePresetId` moves, onto the entry just written.
   */
  saveCustomBeatPreset: (name: string, params: BeatParams) => BeatPreset;
  /** Remove one entry and hand back what is left. No loop's patch is touched. */
  deleteCustomBeatPreset: (id: string) => BeatPreset[];
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
  fxSynthParams: ActiveSynth;
  fxArpSettings: ArpSettings;
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
   * loop-slot identity, not loop content, so it never rides in
   * `LoopContent` and no copy group can name it.
   */
  tempName: string;
  repeatCount?: number; // default 1, number of times this loop plays before advancing in song mode
  scaleRoot: string;
  scaleType: string;
  synthParams: ActiveSynth;
  chordSynthParams: ActiveSynth;
  bassSynthParams: ActiveSynth;
  synthArpSettings: ArpSettings;
  chordArpSettings: ArpSettings;
  bassArpSettings: ArpSettings;
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  /**
   * The custom chord lane's cycle in BARS — a positive divisor of the
   * progression's total bar count, so the pattern repeats evenly against the
   * chords it is playing under. Its two arrays are `loopLength *
   * MAX_STEPS_PER_BAR` long, bar-major, exactly as the sequencer's rows are.
   */
  customChordLoopLength: number;
  /** Parallel to `customChordRhythm`: each stored slot's audible length in 16th steps, >= 1. */
  customChordHoldSteps: number[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  /** The bass lane's own cycle; independent of the chord lane's. See `customChordLoopLength`. */
  customBassLoopLength: number;
  /** Parallel to `customBassPattern`. See `customChordHoldSteps`. */
  customBassHoldSteps: number[];
  bassFeel: number;
  bassOctave: number;
  leadMelodySteps: LeadNote[][];
  leadLoopLength: number;
  leadStepResolution: LeadStepResolutionId;
  leadMelodyView: LeadMelodyView;
  leadMelodyOctave: number;
  leadGate: number;
  /** The Beat instrument: sound, events and levels. Canonical — see BeatSlice. */
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. faderDbToGain runs at
   *  the store->engine boundary in engineSync.ts, never in a component. */
  synthVolume: number;
  synthMuted: boolean;
  chordVolume: number;
  chordMuted: boolean;
  bassVolume: number;
  bassMuted: boolean;
  /** Per-track sends into the shared master reverb/delay/distortion, keyed by
   *  engine source id; LINEAR 0..1, taken after the fader and mute (DEV-423). */
  trackSends: TrackSends;
}

/**
 * The per-loop mixer: what an Arrange card's channel strips edit.
 *
 * Ten flat fader/mute fields plus `beatMix`, which is the whole Beat mix
 * object rather than a flat pair — the Beat bus level and mute live inside it
 * beside the eleven per-voice entries, and a card writing the bus half has to
 * hand back the object with those entries intact. `components/mixLayers.ts`
 * is where each row says how to read and how to patch its own half, so no
 * caller spreads this by hand.
 */
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
  | 'beatMix'
>;

/**
 * What `deleteLoop` removed: the loop as it stood in `loops[]` (which the
 * flat->loops mirror keeps current, so edits made just before the delete are
 * in it), its index, and whether it was the active loop. `restoreLoop` takes
 * it back verbatim.
 */
export interface DeletedLoop {
  loop: Loop;
  index: number;
  wasActive: boolean;
}

export interface LoopSlice {
  /** The arrangement, in list (playback) order. Always ≥ 1 element. */
  loops: Loop[];
  /** Id of the loop currently being edited. */
  activeLoopId: string;
  addLoop: () => string;
  duplicateLoop: (id: string) => string | null;
  /**
   * Null means nothing was deleted (the last loop, or an unknown id). Deleting
   * the active loop loads the fallback loop's fields in the same write.
   */
  deleteLoop: (id: string) => DeletedLoop | null;
  /** Re-inserts a deleted loop at (clamped) `index`; never activates it. */
  restoreLoop: (deleted: DeletedLoop) => void;
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
  /** Edit a loop's 12 mixer fields in place; mirrors to the flat slices when active. */
  setLoopMix: (id: string, patch: Partial<LoopMixPatch>) => void;
  /**
   * Overwrite the selected copy groups of `targetId` with `sourceId`'s
   * values. Implemented in loopCopySlice.ts rather than loopSlice.ts — see
   * that file's docblock for the import cycle that forces the split.
   */
  applyLoopCopy: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void;
  /**
   * `changeKeyAcrossLoops` across `ids`, one `set()`. Null means nothing
   * changed (no write). Returns an Undo snapshot when something did.
   */
  applyLoopKeyChange: (
    ids: readonly string[],
    target: BatchKeyTarget,
    opts: KeyChangeOptions,
  ) => LoopKeyChangeUndo | null;
  /** Restores every snapshot in one `set()`; a loop deleted since is skipped. */
  undoLoopKeyChange: (undo: LoopKeyChangeUndo) => void;
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
    BeatSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice,
    LoopSlice,
    DriveSlice,
    ProjectSlice,
    ExportSlice,
    FeedbackSlice,
    TrackSendsSlice {}

// The exact allow-list shape produced by the persist `partialize` config — this
// interface and partializeAppState in store.ts must list the same keys. Project
// content is not here: it is autosaved to IndexedDB, see store/projectAutosave.ts.
export interface PersistedState {
  metronomeActive: boolean;
  selectedVibeId: string | null;
  focusTrack: MixLayerId;
  inputTargetPin: MixLayerId | null;
  customSynthPresets: SynthPreset[];
  customChordProgressions: CustomChordProgressionItem[];
  customBeatPresets: BeatPreset[];
  activeLoopId: string;
  /** The Drive account a previous page connected. Identity only — never a token (R037). */
  driveUser: DriveUserProfile | null;
}
