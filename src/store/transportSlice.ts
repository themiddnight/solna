import type { StoreApi } from 'zustand';
import { clampBpm } from '../utils/musicTheory';
import { DEFAULT_METER_ID } from '../utils/meter';
import type { AppStore, PlayerModule, PlayerState, TransportSlice } from './types';
import { playbackScopeReducer, SCOPE_NONE } from './playbackScope';
import type { PlaybackScope } from './playbackScope';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

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

/**
 * What the MASTER transport button shows. While a loop is soloing the master
 * button presents as Play, so clicking it TAKES OVER into song mode in one
 * click (spec: "Transport Play All shows Stop only when kind === 'song'").
 * Hard stop is unaffected — it stays live off the real player states via
 * isHardStopEnabled, so soloing audio always has a visible global kill.
 */
export function transportDisplayState(
  scope: PlaybackScope,
  aggregate: PlayerState,
): PlayerState {
  return scope.kind === 'solo' ? 'stopped' : aggregate;
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
    bpm: 120,
    meterId: DEFAULT_METER_ID,
    masterVolume: 0.85,
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
     * A loop card's own play/stop button. Starting a solo also drops the song
     * cursor, in the same set() — the two can never be observed disagreeing.
     * The caller (ArrangeView) is responsible for loadLoop-ing the target
     * FIRST, because loadLoop hard-stops and restarts whatever was playing.
     */
    soloLoop: (loopId) =>
      set((state) => {
        const scope = playbackScopeReducer(state.playbackScope, { type: 'toggle-loop', loopId });
        if (scope === state.playbackScope) return {};
        return scope.kind === 'solo'
          ? {
              playbackScope: scope,
              songLoopIndex: null,
              ...allPlayersPatch(state, (current) => (current === 'stopped' ? 'playing' : current)),
            }
          : { playbackScope: scope, ...allPlayersPatch(state, () => 'stopped') };
      }),
  };
}
