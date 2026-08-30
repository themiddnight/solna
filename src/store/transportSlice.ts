import type { StoreApi } from 'zustand';
import { clampBpm } from '../utils/musicTheory';
import { DEFAULT_METER_ID } from '../utils/meter';
import type { AppStore, PlayerModule, PlayerState, TransportSlice } from './types';

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- get is unused but kept for signature parity with the other slice creators
export function createTransportSlice(set: Set, _get: Get): TransportSlice {
  const transition = (module: PlayerModule, next: (current: PlayerState) => PlayerState) =>
    set((state) => {
      const field = FIELD[module];
      const current = state[field];
      const target = next(current);
      return target === current ? {} : ({ [field]: target } as Partial<AppStore>);
    });

  const transitionAll = (next: (current: PlayerState) => PlayerState) =>
    set((state) => {
      const patch: Partial<AppStore> = {};
      (Object.keys(FIELD) as PlayerModule[]).forEach((module) => {
        const field = FIELD[module];
        const current = state[field];
        const target = next(current);
        if (target !== current) patch[field] = target;
      });
      return patch;
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

    playAll: () => transitionAll((current) => (current === 'stopped' ? 'playing' : current)),
    softStopAll: () => transitionAll((current) => (current === 'playing' ? 'stopping' : current)),
    hardStopAll: () => transitionAll(() => 'stopped'),
  };
}
