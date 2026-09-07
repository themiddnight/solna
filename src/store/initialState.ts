import type { SynthParams, SequencerTrack, ChordItem, MasterEffects, SongArrangement } from '../types';
import { applyPreset, presetById } from '../audio/presetRegistry';
import type { PadState } from './types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

// Moved verbatim from src/App.tsx — the app's original useState initial values.

export const INITIAL_SYNTH_PARAMS: SynthParams = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0.02,
  detune: 6,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3.0,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0.2,
  lfoTarget: 'cutoff',
  octave: 0,
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
  preset: 'Cosmic Lead',
};

/**
 * One empty bar at the widest storable width. Spread at each use site, never
 * shared: two tracks holding the same array would toggle together.
 */
const SILENT_BAR: boolean[] = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);

export const INITIAL_SEQUENCER_TRACKS: SequencerTrack[] = [
  {
    id: 'track-kick',
    name: 'Kick 808',
    instrument: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.9,
    muted: false,
    color: 'bg-drum-kick',
  },
  {
    id: 'track-snare',
    name: 'Snare Snap',
    instrument: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.85,
    muted: false,
    color: 'bg-drum-snare',
  },
  {
    id: 'track-rimshot',
    name: 'Rim Shot',
    instrument: 'rimshot',
    steps: [...SILENT_BAR],
    volume: 0.8,
    muted: false,
    color: 'bg-drum-rimshot',
  },
  {
    id: 'track-clap',
    name: 'Hand Clap',
    instrument: 'clap',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.85,
    muted: false,
    color: 'bg-drum-clap',
  },
  {
    id: 'track-hihat',
    name: 'Closed Hat',
    instrument: 'hihat',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false, false, false, false, false, false, false],
    volume: 0.75,
    muted: false,
    color: 'bg-drum-hihat',
  },
  {
    id: 'track-openhat',
    name: 'Open Hat',
    instrument: 'openhat',
    steps: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.8,
    muted: false,
    color: 'bg-drum-openhat',
  },
  {
    id: 'track-hitom',
    name: 'Hi Tom',
    instrument: 'hitom',
    steps: [...SILENT_BAR],
    volume: 0.8,
    muted: false,
    color: 'bg-drum-hitom',
  },
  {
    id: 'track-lowtom',
    name: 'Low Tom',
    instrument: 'lowtom',
    steps: [...SILENT_BAR],
    volume: 0.8,
    muted: false,
    color: 'bg-drum-lowtom',
  },
  {
    id: 'track-ride',
    name: 'Ride',
    instrument: 'ride',
    steps: [...SILENT_BAR],
    volume: 0.7,
    muted: false,
    color: 'bg-drum-ride',
  },
  {
    id: 'track-crash',
    name: 'Crash',
    instrument: 'crash',
    steps: [...SILENT_BAR],
    volume: 0.7,
    muted: false,
    color: 'bg-drum-crash',
  },
  {
    id: 'track-bell',
    name: 'Bell',
    instrument: 'bell',
    steps: [...SILENT_BAR],
    volume: 0.7,
    muted: false,
    color: 'bg-drum-bell',
  },
];

/**
 * Backfill any canonical drum track a payload is missing, appending only.
 *
 * The shared pure transform BOTH migration chains call — the persist chain's
 * migrateDrumTracks and the .solna chain's upgradeDrumTracksV5. It is the
 * `defaultPadState()` of this change: shared DATA-shaped logic, called from two
 * separate upgrade steps that must never be merged into one function. A project
 * body is an external contract, the persist payload is private localStorage
 * shape, and their version numbers move for different reasons (CLAUDE.md).
 *
 * APPENDS ONLY. A track whose `instrument` is already present is returned as
 * THE SAME OBJECT — a user who renamed, recoloured, muted or reprogrammed it
 * keeps it exactly. An already-complete array is returned by identity.
 *
 * IDEMPOTENT, which is what lets slice 2 reuse it unchanged for `ride` and
 * `bell`: it adds whatever is missing from INITIAL_SEQUENCER_TRACKS, so
 * growing that constant grows this transform with no edit here.
 *
 * NO EXISTING SESSION OR .solna FILE CHANGES SOUND. A restored track comes
 * back as its FACTORY entry, row and all — this copies INITIAL_SEQUENCER_TRACKS
 * rather than blanking it — but every payload the app itself can produce holds
 * all five original tracks, so the only tracks a real migration appends are
 * `tom` and `crash`, whose factory rows are empty. Only a hand-edited file that
 * deleted a track gets an audible row back. The new rows are heard only when a
 * grid or a vibe is applied afterwards, which is a deliberate user action — the
 * same discipline upgradePadLayerV4 follows with `padMuted: true`.
 */
export function withDrumTracks(tracks: SequencerTrack[]): SequencerTrack[] {
  // The cast and the `?.` are because this runs BEFORE sanitize in both
  // chains, so an element can be anything a JSON file held.
  const present = new Set(
    tracks.map((track) => (track as Partial<SequencerTrack> | null)?.instrument),
  );
  const missing = INITIAL_SEQUENCER_TRACKS.filter((t) => !present.has(t.instrument));
  if (missing.length === 0) return tracks;
  // Fresh objects AND fresh steps arrays. Each loop in a payload runs this over
  // its own tracks, and appending the module constant itself would make two
  // loops share one bar — toggling a tom step in one would toggle it in the
  // other, and in INITIAL_SEQUENCER_TRACKS. loopSlice.ts copies for the same
  // reason.
  return [...tracks, ...missing.map((t) => ({ ...t, steps: [...t.steps] }))];
}


/**
 * Rename one drum track in place, keeping every field the user owns.
 *
 * The companion withDrumTracks CANNOT do this: it appends only and never
 * rewrites a track that is present, which is exactly the property that lets a
 * renamed, recoloured, muted, reprogrammed row survive an upgrade. Run alone
 * against the tom -> lowtom change it would leave `tom` in place AND append
 * `lowtom`: the user's programmed tom row goes silent while a blank one appears
 * beside it.
 *
 * CALL THIS BEFORE withDrumTracks — as defence in depth, not because the
 * reverse order is unsafe: swap them and the "existing target row is blank ->
 * drop it and rename into it" branch below repairs the blank-lowtom-beside-a-
 * real-tom shape that order creates, so the output is byte-identical either
 * way (initialState.test.ts's order test: "append BEFORE rename repairs").
 * The row that actually prevents a silenced row beside a blank one is that
 * repair branch, not this ordering; the ordering just means the repair branch
 * is never the one doing the work in the documented path.
 *
 * Pure, idempotent, and shared by both migration chains — the discipline
 * withDrumTracks and defaultPadState() already follow. The cast and the `?.`
 * are because this runs BEFORE sanitize in both chains, so an element can be
 * anything a JSON file held.
 */
export function renameDrumTrack(
  tracks: SequencerTrack[],
  from: string,
  to: string,
): SequencerTrack[] {
  const instrumentOf = (t: unknown) => (t as Partial<SequencerTrack> | null)?.instrument;
  const silent = (t: unknown) => {
    const steps = (t as Partial<SequencerTrack> | null)?.steps;
    return !Array.isArray(steps) || !steps.some(Boolean);
  };
  if (!tracks.some((t) => instrumentOf(t) === from)) return tracks;
  const existing = tracks.find((t) => instrumentOf(t) === to);
  // BOTH present. Not only the hand-edited case: once a later task grows
  // INITIAL_SEQUENCER_TRACKS past seven voices, an OLD payload reaching this
  // step through the earlier ones (those call withDrumTracks against whatever
  // the constant holds today) will arrive here with the user's `tom` row AND
  // a blank `lowtom` appended beside it. Drop the blank one and rename; the
  // user's steps are the row that matters. If the `to` row has programmed
  // steps, someone owns both and we touch neither.
  if (existing && !silent(existing)) return tracks;
  return tracks
    .filter((track) => track !== existing)
    .map((track) =>
      instrumentOf(track) === from
        ? { ...(track as SequencerTrack), id: `track-${to}`, instrument: to }
        : track,
    );
}

/**
 * Rename a loop's `soundKit`. A scalar field, not a track list, so it is its
 * own transform rather than a branch inside renameDrumTrack. Pure, idempotent
 * and shared by both chains for the same reason.
 */
export function renameSoundKit<T extends object>(loop: T, from: string, to: string): T {
  return (loop as { soundKit?: unknown }).soundKit === from ? { ...loop, soundKit: to } : loop;
}

/**
 * The colour every drum track shipped with before the --color-drum-* namespace
 * existed, keyed by the instrument it belonged to. `lowtom` holds what the old
 * `tom` track shipped with, so recolourDrumTracks MUST run after
 * renameDrumTrack — before it, the row is still `tom` and keeps bg-primary.
 *
 * Per instrument, not a set of seven strings: bg-error was the KICK's colour, so
 * a snare wearing it is a choice the user made and is left alone.
 */
const LEGACY_DRUM_TRACK_COLORS: Record<string, string> = {
  kick: 'bg-error', snare: 'bg-warning', hihat: 'bg-success',
  openhat: 'bg-accent', clap: 'bg-secondary', lowtom: 'bg-primary', crash: 'bg-info',
};

/**
 * Move the seven original tracks onto the drum colour namespace, WITHOUT
 * touching a colour the user chose.
 *
 * Scoped exactly the way withDrumTracks is: it rewrites only what still equals
 * the factory value for that instrument. The alternative — recolouring every
 * track — would throw away a user's palette; doing nothing at all would leave
 * the sequencer as the one surface in the app where colour means two different
 * things, seven semantic tokens beside four drum ones (decision 35).
 *
 * Pure, idempotent (a bg-drum-* value is not a key of the map), shared by both
 * chains, and it changes no sound. migrateTrackColors is the precedent.
 *
 * Wired into both migration chains (migrateDrumVoices and upgradeDrumVoicesV6),
 * always last, after renameDrumTrack and withDrumTracks — the bg-drum-* classes
 * it writes are defined by the --color-drum-* block that landed in the same
 * commit as this wiring, so no session can migrate onto a colour the CSS does
 * not define. No further persist/format version bump: the slice ships together
 * (decision 29).
 */
export function recolourDrumTracks(tracks: SequencerTrack[]): SequencerTrack[] {
  let recoloured = false;
  const next = tracks.map((track) => {
    const t = track as Partial<SequencerTrack> | null;
    if (!t || typeof t !== 'object') return track;
    const factory = LEGACY_DRUM_TRACK_COLORS[t.instrument as string];
    if (!factory || t.color !== factory) return track;
    recoloured = true;
    return { ...(track as SequencerTrack), color: `bg-drum-${t.instrument}` };
  });
  return recoloured ? next : tracks;
}

export const INITIAL_CHORDS: ChordItem[] = [
  { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
  { id: 'chord-2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
  { id: 'chord-3', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
  { id: 'chord-4', root: 'G', quality: '7', bars: 1, notes: ['G3', 'B3', 'D4', 'F4'] },
];

// The ONLY source of truth for the audible effect defaults. setupMasterChain()
// seeds every wet send and EQ gain at zero; these values reach the graph via
// applyEngineSnapshot() on the first user click and are clamped through
// audio/effectLimits.ts on the way in.
//
// NOTE: reverbDecay (2.0) and compressorThreshold (-12) deliberately equal the
// engine's setupMasterChain hardcodes so the default sound is unchanged now
// that these knobs are live. Persisted values from older sessions take
// effect and are clamped in sanitizePersistedState.
export const INITIAL_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 2.0,
  delayWet: 0.2,
  delayFeedback: 0.35,
  distortionWet: 0.1,
  eqLow: 2,
  eqMid: 0,
  eqHigh: 3,
  compressorThreshold: -12,
};

export const INITIAL_ARRANGEMENT: SongArrangement = {
  totalBars: 16,
  loopEnabled: true,
  loopStartBar: 0,
  loopEndBar: 16,
  regions: [
    // Chords Track
    {
      id: 'reg-chord-intro',
      trackType: 'chords',
      name: 'Intro Chords',
      startBar: 0,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'sustained',
        chordFeel: 0.1,
        chordOctave: 0,
      },
    },
    {
      id: 'reg-chord-verse',
      trackType: 'chords',
      name: 'Verse Chords',
      startBar: 4,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'lofi-rhodes-push',
        chordFeel: 0.3,
        chordOctave: 0,
      },
    },
    {
      id: 'reg-chord-chorus',
      trackType: 'chords',
      name: 'Chorus Chords',
      startBar: 8,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'syncopated-groove',
        chordFeel: 0.4,
        chordOctave: 0,
      },
    },
    {
      id: 'reg-chord-outro',
      trackType: 'chords',
      name: 'Outro Chords',
      startBar: 12,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'sustained',
        chordFeel: 0.1,
        chordOctave: 0,
      },
    },

    // Bass Track
    {
      id: 'reg-bass-verse',
      trackType: 'bass',
      name: 'Verse Bass',
      startBar: 4,
      lengthBars: 4,
      color: 'accent',
      data: {
        bassPatternId: 'root-and-octave-pump',
        bassFeel: 0.3,
        bassOctave: 0,
      },
    },
    {
      id: 'reg-bass-chorus',
      trackType: 'bass',
      name: 'Driving Bass',
      startBar: 8,
      lengthBars: 4,
      color: 'accent',
      data: {
        bassPatternId: 'funky-sixteenths',
        bassFeel: 0.4,
        bassOctave: 0,
      },
    },
    {
      id: 'reg-bass-outro',
      trackType: 'bass',
      name: 'Outro Sub',
      startBar: 12,
      lengthBars: 4,
      color: 'accent',
      data: {
        bassPatternId: 'whole-note-root',
        bassFeel: 0.1,
        bassOctave: 0,
      },
    },

    // Drums Track
    {
      id: 'reg-drum-verse',
      trackType: 'drums',
      name: 'Verse Beat',
      startBar: 4,
      lengthBars: 4,
      color: 'warning',
      data: {
        soundKit: 'Retro Drive',
        drumPattern: {
          kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
          snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
          hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
          openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
          clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        },
      },
    },
    {
      id: 'reg-drum-chorus',
      trackType: 'drums',
      name: 'Chorus Beat',
      startBar: 8,
      lengthBars: 4,
      color: 'warning',
      data: {
        soundKit: 'Retro Drive',
        drumPattern: {
          kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
          snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
          hihat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
          openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
          clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        },
      },
    },

    // Lead Track
    {
      id: 'reg-lead-chorus',
      trackType: 'lead',
      name: 'Chorus Hook',
      startBar: 8,
      lengthBars: 4,
      color: 'secondary',
      data: {
        leadNotes: [
          { note: 'E4', step: 0, durationSteps: 3, velocity: 0.85 },
          { note: 'G4', step: 4, durationSteps: 3, velocity: 0.85 },
          { note: 'A4', step: 8, durationSteps: 6, velocity: 0.9 },
          { note: 'C5', step: 16, durationSteps: 3, velocity: 0.85 },
          { note: 'D5', step: 20, durationSteps: 3, velocity: 0.85 },
          { note: 'E5', step: 24, durationSteps: 6, velocity: 0.95 },
          { note: 'D5', step: 32, durationSteps: 3, velocity: 0.8 },
          { note: 'C5', step: 36, durationSteps: 3, velocity: 0.8 },
          { note: 'A4', step: 40, durationSteps: 6, velocity: 0.85 },
          { note: 'G4', step: 48, durationSteps: 3, velocity: 0.8 },
          { note: 'E4', step: 52, durationSteps: 3, velocity: 0.8 },
          { note: 'A4', step: 56, durationSteps: 8, velocity: 0.9 },
        ],
      },
    },
  ],
};

/**
 * The Bass-category factory preset a fresh bass module starts from.
 *
 * Resolved by ID, never by index. This was `FACTORY_BASS_PRESETS[0]` in
 * synthSlice.ts and loopSlice.ts until the preset arrays merged, at which point
 * index 0 became `factory-cosmic-lead` and both defaults silently turned into a
 * lead patch — with store.test.ts agreeing, because it asserted against the
 * same index expression. store.test.ts now pins this id and initialState.test.ts
 * pins that it resolves; reverting either to an index turns both red.
 */
export const DEFAULT_BASS_PRESET_ID = 'bass-deep-sine';

const DEFAULT_BASS_PRESET = presetById(DEFAULT_BASS_PRESET_ID);

/**
 * The shared synth defaults with the bass preset laid over them.
 *
 * Deliberately NOT `applyPreset(...)`: applyPreset also stamps
 * `preset: preset.name`, and today's default carries no `preset` field. Using
 * it here would change a persisted default value, which this refactor forbids.
 *
 * Falls back to the bare defaults if the id ever stops resolving —
 * initialState.test.ts is what makes that fallback loud instead of silent.
 */
export const INITIAL_BASS_SYNTH_PARAMS: SynthParams = DEFAULT_BASS_PRESET
  ? { ...INITIAL_SYNTH_PARAMS, ...DEFAULT_BASS_PRESET.params }
  : INITIAL_SYNTH_PARAMS;

/** The Pad-category factory preset a fresh pad starts from. */
export const PAD_DEFAULT_PRESET_ID = 'factory-warm-polypad';

const PAD_DEFAULT_PRESET = presetById(PAD_DEFAULT_PRESET_ID);

/**
 * Built the same way `createDefaultLoop` builds `bassSynthParams`: the shared
 * synth defaults with a factory preset laid over them. Falls back to the bare
 * defaults if the id ever stops resolving — initialState.test.ts is what makes
 * that fallback loud instead of silent.
 */
export const INITIAL_PAD_SYNTH_PARAMS: SynthParams = PAD_DEFAULT_PRESET
  ? applyPreset(INITIAL_SYNTH_PARAMS, PAD_DEFAULT_PRESET)
  : INITIAL_SYNTH_PARAMS;

/**
 * Every pad key with its NEW-project value. Both migration chains call this
 * and then override `padMuted` to `true`, because a project saved before the
 * pad existed must reopen sounding the way it sounded when it was closed.
 *
 * Do NOT collapse that override into these defaults. Doing so gives every
 * pre-existing project a voice its author never wrote, and nothing in the UI
 * or the build would show it — three tests pin the distinction (see
 * initialState.test.ts, migrate.test.ts and projectFormat.test.ts).
 *
 * A factory, not a constant: `padDroneIntervals` is an array, and a shared one
 * seeded into the live store would let a single in-place sort or push poison
 * every default.
 */
export function defaultPadState(): PadState {
  return {
    padSynthParams: INITIAL_PAD_SYNTH_PARAMS,
    padMode: 'pad',
    padOctave: 3,
    padVoicing: 'triad',
    padDroneDegree: 0,
    padDroneIntervals: [1, 5, 8],
    padVolume: 1.0,
    padMuted: false,
  };
}
