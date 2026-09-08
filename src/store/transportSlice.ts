import type { StoreApi } from 'zustand';
import { clampBpm } from '../utils/musicTheory';
import { DEFAULT_METER_ID } from '../utils/meter';
import type { AppStore, PlayerModule, PlayerState, TransportSlice } from './types';
import { playbackScopeReducer, SCOPE_NONE } from './playbackScope';
import type { PlaybackScope } from './playbackScope';
import { DEFAULT_FADER_DB } from './levelUnits';
import type { Layer } from '../types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/** The transport's default tempo; factoryProjectContent() reads it so a new project matches a fresh session. */
export const DEFAULT_BPM = 120;

type PlayerField = 'sequencerPlayer' | 'chordsPlayer' | 'leadPlayer';

const FIELD: Record<PlayerModule, PlayerField> = {
  sequencer: 'sequencerPlayer',
  chords: 'chordsPlayer',
  lead: 'leadPlayer',
};

/** A player still owns scheduled sound unless it is fully stopped. */
export function isPlayerActive(state: PlayerState): boolean {
  return state !== 'stopped';
}

/** The single state the master transport shows across all players. */
export function aggregatePlayerState(...states: PlayerState[]): PlayerState {
  if (states.includes('playing')) return 'playing';
  if (states.includes('stopping')) return 'stopping';
  return 'stopped';
}

/**
 * Deliberately NOT derived from aggregatePlayerState: when one player is
 * `stopping` and the others are already `stopped`, the aggregate reads
 * `stopping` but there is still sound to cut, so hard stop must stay live.
 */
export function isHardStopEnabled(...states: PlayerState[]): boolean {
  return states.some(isPlayerActive);
}

/**
 * Transport slice. `sequencerPlayer` / `chordsPlayer` / `leadPlayer` and the
 * `playhead*` fields are transient (excluded from `partializeAppState`);
 * everything else persists.
 *
 * Engine side-effects (init/resetClock on the fully-stopped -> playing
 * transition) are handled by engineSync's transport subscription; the actual
 * silencing of scheduled voices is owned by each playback hook.
 */
/**
 * The player half of an all-players transition, as a pure patch. Extracted so
 * playAll / softStopAll / hardStopAll / soloLoop can each fold the player patch
 * and the PlaybackScope patch into ONE set() — an intermediate set() would fire
 * songMode's subscription against a state where the scope and the players
 * disagree, which is the two-writer shape this refactor exists to remove.
 */
function allPlayersPatch(
  state: AppStore,
  next: (current: PlayerState) => PlayerState,
): Partial<AppStore> {
  const patch: Partial<AppStore> = {};
  (Object.keys(FIELD) as PlayerModule[]).forEach((module) => {
    const field = FIELD[module];
    const current = state[field];
    const target = next(current);
    if (target !== current) patch[field] = target;
  });
  return patch;
}

/** Which players an internal stop-and-restart has to bring back. */
export interface WasActivePlayers {
  sequencer: boolean;
  chords: boolean;
  lead: boolean;
}

/** None of them — the patch for a stop-and-restart that decides not to restart. */
export const NO_PLAYERS_ACTIVE: WasActivePlayers = Object.freeze({
  sequencer: false,
  chords: false,
  lead: false,
});

/**
 * The players a restart brings back, and the scope that goes with them, as
 * ONE patch. Callers apply it in a single set() so that no subscriber ever
 * observes players running under a scope that disagrees with them — the same
 * reason allPlayersPatch exists above.
 *
 * Writing 'playing' unconditionally is safe and is exactly what the three
 * play(module) calls this replaces did: every caller has just run
 * hardStopAll(), so every player is 'stopped' and play()'s own
 * `current === 'stopped' ? 'playing' : current` guard could only ever take
 * the first branch.
 */
export function restartPlayersPatch(
  wasActive: WasActivePlayers,
  scope: PlaybackScope,
): Partial<AppStore> {
  return {
    ...(wasActive.sequencer ? { sequencerPlayer: 'playing' as const } : {}),
    ...(wasActive.chords ? { chordsPlayer: 'playing' as const } : {}),
    ...(wasActive.lead ? { leadPlayer: 'playing' as const } : {}),
    playbackScope: scope,
  };
}

/**
 * Every player stopped, as a pure patch. Exported so a store path that must
 * stop playback inside a set() it is ALREADY making — loopSlice's deleteLoop
 * — can fold it in rather than making a second set(). A second set() would
 * publish an intermediate state where the scope still names a loop that
 * `loops` no longer contains, which is the one scope value nothing
 * downstream can heal.
 */
export function stopAllPlayersPatch(state: AppStore): Partial<AppStore> {
  return allPlayersPatch(state, () => 'stopped');
}

/**
 * What the MASTER transport button shows. It disowns a solo loop it is not
 * the transport for: on the song layer every solo loop belongs to a loop
 * card, so the button presents as Play and one click TAKES OVER into song
 * mode (spec: "Transport Play All shows Stop only when kind === 'song'"). On
 * the loop layer the button IS the transport for the loop being edited, so
 * that one solo loop reports its real state — without this the button would
 * offer Play while its own page is sounding. A solo loop of some other loop
 * stays disowned on either layer.
 *
 * Hard stop is unaffected — it stays live off the real player states via
 * isHardStopEnabled, so auditioning audio always has a visible global kill.
 */
export function transportDisplayState(
  scope: PlaybackScope,
  aggregate: PlayerState,
  layer: Layer,
  activeLoopId: string,
): PlayerState {
  if (scope.kind !== 'loop') return aggregate;
  return layer === 'loop' && scope.loopId === activeLoopId ? aggregate : 'stopped';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- get is unused but kept for signature parity with the other slice creators
export function createTransportSlice(set: Set, _get: Get): TransportSlice {
  const transition = (module: PlayerModule, next: (current: PlayerState) => PlayerState) =>
    set((state) => {
      const field = FIELD[module];
      const current = state[field];
      const target = next(current);
      return target === current ? {} : ({ [field]: target } as Partial<AppStore>);
    });

  const play = (module: PlayerModule) =>
    transition(module, (current) => (current === 'stopped' ? 'playing' : current));

  const softStop = (module: PlayerModule) =>
    transition(module, (current) => (current === 'playing' ? 'stopping' : current));

  const hardStop = (module: PlayerModule) => transition(module, () => 'stopped');

  return {
    bpm: DEFAULT_BPM,
    meterId: DEFAULT_METER_ID,
    // Decibels, not a linear gain: unity is 0 dB. See src/store/levelUnits.ts.
    masterVolume: DEFAULT_FADER_DB,
    metronomeActive: false,
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    playheadBeat: null,
    playheadChordIndex: null,
    playheadChordStartBeat: 0,
    songLoopIndex: null,
    setSongLoopIndex: (songLoopIndex) => set({ songLoopIndex }),

    playbackScope: SCOPE_NONE,

    setPlayheadBeat: (playheadBeat) => set({ playheadBeat }),
    setPlayheadChord: (playheadChordIndex, startBeat = 0) =>
      set({ playheadChordIndex, playheadChordStartBeat: playheadChordIndex === null ? 0 : startBeat }),

    // Clamped with the same bounds engine.setClockBpm uses. The store is the
    // value every playback hook reads for its own step math, so an unclamped 0
    // from a cleared number input would drone notes even though the engine
    // clock itself is safe.
    setBpm: (bpm) => set({ bpm: clampBpm(bpm) }),
    // No clamping needed: MeterId is a closed union, and getMeter() falls back
    // to 4/4 for anything that slips through from persisted state.
    setMeter: (meterId) => set({ meterId }),
    setMasterVolume: (masterVolume) => set({ masterVolume }),

    toggleMetronome: () => set((state) => ({ metronomeActive: !state.metronomeActive })),

    play,
    softStop,
    hardStop,

    playAll: () =>
      set((state) => ({
        ...allPlayersPatch(state, (current) => (current === 'stopped' ? 'playing' : current)),
        playbackScope: playbackScopeReducer(state.playbackScope, { type: 'play-all' }),
      })),
    softStopAll: () =>
      set((state) => ({
        ...allPlayersPatch(state, (current) => (current === 'playing' ? 'stopping' : current)),
        playbackScope: playbackScopeReducer(state.playbackScope, { type: 'stop-all' }),
      })),
    hardStopAll: () =>
      set((state) => ({
        ...allPlayersPatch(state, () => 'stopped'),
        playbackScope: playbackScopeReducer(state.playbackScope, { type: 'stop-all' }),
      })),

    /**
     * A loop card's own play/stop button, and (since Phase 1) the master Play
     * on the Loop layer. It establishes the `loop` scope — the SOLO LOOP —
     * and drops the song cursor in the same set(), so the two can never be
     * observed disagreeing. Nothing to do with the per-track solo Phase 4
     * adds: this is one LOOP played alone, not one TRACK heard alone. The
     * name is kept only because two components call it.
     *
     * The caller (ArrangeView) is responsible for loadLoop-ing the target
     * FIRST, because loadLoop hard-stops and restarts whatever was playing.
     */
    soloLoop: (loopId) =>
      set((state) => {
        const scope = playbackScopeReducer(state.playbackScope, { type: 'toggle-loop', loopId });
        if (scope === state.playbackScope) return {};
        return scope.kind === 'loop'
          ? {
              playbackScope: scope,
              songLoopIndex: null,
              ...allPlayersPatch(state, (current) => (current === 'stopped' ? 'playing' : current)),
            }
          : { playbackScope: scope, ...allPlayersPatch(state, () => 'stopped') };
      }),
  };
}
