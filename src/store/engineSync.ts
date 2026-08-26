import { useEffect } from 'react';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS } from '../audio/drumKits';
import { useAppStore } from './store';
import { isPlayerActive } from './transportSlice';
import type { FilterType } from '../types';

/**
 * One-way bridge from the Zustand store into the audioEngine singleton,
 * rebuilt on Zustand's subscribeWithSelector middleware: one subscription per
 * engine-settable value with `fireImmediately` bootstrap, so the engine always
 * receives the current value the moment the bridge starts (setters no-op
 * before init — engine.ts guards on this.ctx — and applyEngineSnapshot
 * re-applies everything after the AudioContext exists).
 *
 * startEngineSync is idempotent; the returned stop() (and stopEngineSync)
 * unsubscribe every subscription. useEngineSync mounts it at the app root.
 */
type Stop = () => void;

let syncStarted = false;
let stopCurrent: Stop | null = null;

function applySliceState(): void {
  const s = useAppStore.getState();
  audioEngine.setClockBpm(s.bpm);
  audioEngine.setMasterVolume(s.masterVolume);
  audioEngine.setMetronomeEnabled(s.metronomeActive);
  audioEngine.setSourceGain('chord', s.chordVolume);
  audioEngine.setSourceGain('bass', s.bassVolume);
  audioEngine.setSourceMuted('chord', s.chordMuted);
  audioEngine.setSourceMuted('bass', s.bassMuted);
  audioEngine.setDrumKit(DRUM_KITS[s.soundKit]);
  audioEngine.setDrumFilter(s.drumFilterCutoff, s.drumFilterResonance, s.drumFilterType);
  audioEngine.updateEffects(s.effects);
  audioEngine.updateSynthParams(s.synthParams, 'synth');
  audioEngine.updateSynthParams(s.chordSynthParams, 'chord');
  audioEngine.updateSynthParams(s.bassSynthParams, 'bass');
}

export function startEngineSync(): Stop {
  if (syncStarted) return () => undefined;
  syncStarted = true;

  const subs: Array<() => void> = [];

  // transport slice
  subs.push(useAppStore.subscribe((s) => s.bpm, (bpm) => audioEngine.setClockBpm(bpm), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.masterVolume, (v) => audioEngine.setMasterVolume(v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.metronomeActive, (v) => audioEngine.setMetronomeEnabled(v), { fireImmediately: true }));

  // chords + bass buses
  subs.push(useAppStore.subscribe((s) => s.chordVolume, (v) => audioEngine.setSourceGain('chord', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassVolume, (v) => audioEngine.setSourceGain('bass', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.chordMuted, (v) => audioEngine.setSourceMuted('chord', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassMuted, (v) => audioEngine.setSourceMuted('bass', v), { fireImmediately: true }));

  // sequencer slice: kit + drum-bus filter (encoded as one primitive so the
  // subscription fires only when a filter value actually changes)
  subs.push(useAppStore.subscribe((s) => s.soundKit, (kit) => audioEngine.setDrumKit(DRUM_KITS[kit]), { fireImmediately: true }));
  subs.push(
    useAppStore.subscribe(
      (s) => `${s.drumFilterCutoff}|${s.drumFilterResonance}|${s.drumFilterType}`,
      (key) => {
        const [cutoff, resonance, type] = key.split('|');
        audioEngine.setDrumFilter(parseFloat(cutoff), parseFloat(resonance), type as FilterType);
      },
      { fireImmediately: true },
    ),
  );

  // effects + synth params: subscribed as an encoded primitive so the
  // subscription fires only on a real VALUE change. Keying on object identity
  // re-ran updateEffects / updateSynthParams for any action that merely
  // respread the object — and updateSynthParams re-targets every live voice,
  // cancelling and re-planning their ramps for nothing. Same pattern as the
  // drum-filter subscription above. JSON.stringify is stable here because
  // both objects are plain literals built from a fixed set of keys
  // (INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS) and every writer spreads from
  // those, so key order does not vary.
  subs.push(
    useAppStore.subscribe(
      (s) => JSON.stringify(s.effects),
      () => audioEngine.updateEffects(useAppStore.getState().effects),
      { fireImmediately: true },
    ),
  );

  const synthSources = [
    ['synthParams', 'synth'],
    ['chordSynthParams', 'chord'],
    ['bassSynthParams', 'bass'],
  ] as const;
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => JSON.stringify(s[field]),
        () => audioEngine.updateSynthParams(useAppStore.getState()[field], source),
        { fireImmediately: true },
      ),
    );
  }

  // Transport player states: init on EVERY transition — the old toggle actions
  // called audioEngine.init() unconditionally, and init()'s resume path is
  // load-bearing (the browser suspends the AudioContext when the tab is
  // backgrounded, so returning with chords playing and starting the sequencer
  // must resume audio). resetClock stays restricted to the fully-stopped ->
  // active transition, which keeps both players counting the SAME bars: a
  // player joining while the other runs must not restart the grid.
  //
  // "Fully stopped" means BOTH players are 'stopped'. A 'stopping' player is
  // still active — otherwise a soft stop followed by a restart would reset the
  // grid mid-flight. Encoded 1/2/3 so the subscription fires only on real
  // transitions.
  subs.push(
    useAppStore.subscribe(
      (s) =>
        (isPlayerActive(s.sequencerPlayer) ? 1 : 0) + (isPlayerActive(s.chordsPlayer) ? 2 : 0),
      (flags, prevFlags) => {
        audioEngine.init();
        if (flags !== 0 && prevFlags === 0) {
          audioEngine.resetClock();
        }
      },
    ),
  );

  stopCurrent = () => {
    for (const unsub of subs) unsub();
    subs.length = 0;
    syncStarted = false;
    stopCurrent = null;
  };
  return stopCurrent;
}

export function stopEngineSync(): void {
  stopCurrent?.();
}

export function useEngineSync(): void {
  useEffect(() => startEngineSync(), []);
}

/**
 * Push the full audio-relevant snapshot into the engine. Called once from the
 * app's first-user-interaction handler right after `audioEngine.init()` —
 * every engine setter is a no-op before the AudioContext exists, so the values
 * hydrated from storage or set by pre-init actions (e.g. instant vibes) are
 * re-applied once the engine is live.
 */
export function applyEngineSnapshot(): void {
  applySliceState();
}
