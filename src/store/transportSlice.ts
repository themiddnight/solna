import type { StoreApi } from 'zustand';
import type { AppStore, PlayerModule, PlayerState, TransportSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

type PlayerField = 'sequencerPlayer' | 'chordsPlayer';

const FIELD: Record<PlayerModule, PlayerField> = {
  sequencer: 'sequencerPlayer',
  chords: 'chordsPlayer',
};

/** A player still owns scheduled sound unless it is fully stopped. */
export function isPlayerActive(state: PlayerState): boolean {
  return state !== 'stopped';
}

/** The single state the master transport shows for both players. */
export function aggregatePlayerState(a: PlayerState, b: PlayerState): PlayerState {
  if (a === 'playing' || b === 'playing') return 'playing';
  if (a === 'stopping' || b === 'stopping') return 'stopping';
  return 'stopped';
}

/**
 * Deliberately NOT derived from aggregatePlayerState: when one player is
 * `stopping` and the other is already `stopped`, the aggregate reads
 * `stopping` but there is still sound to cut, so hard stop must stay live.
 */
export function isHardStopEnabled(a: PlayerState, b: PlayerState): boolean {
  return isPlayerActive(a) || isPlayerActive(b);
}

/**
 * Transport slice. `sequencerPlayer` / `chordsPlayer` are transient (excluded
 * from `partializeAppState`); everything else persists.
 *
 * Engine side-effects (init/resetClock on the fully-stopped -> playing
 * transition) are handled by engineSync's transport subscription; the actual
 * silencing of scheduled voices is owned by each playback hook.
 */
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
    masterVolume: 0.85,
    metronomeActive: false,
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',

    setBpm: (bpm) => set({ bpm }),
    setMasterVolume: (masterVolume) => set({ masterVolume }),

    toggleMetronome: () => set((state) => ({ metronomeActive: !state.metronomeActive })),

    play,
    softStop,
    hardStop,

    playAll: () => {
      play('sequencer');
      play('chords');
    },
    softStopAll: () => {
      softStop('sequencer');
      softStop('chords');
    },
    hardStopAll: () => {
      hardStop('sequencer');
      hardStop('chords');
    },
  };
}
