import { useEffect } from 'react';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS } from '../audio/drumKits';
import { useAppStore } from './store';
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

  // effects slice
  subs.push(useAppStore.subscribe((s) => s.effects, (fx) => audioEngine.updateEffects(fx), { fireImmediately: true }));

  // synth slice
  subs.push(useAppStore.subscribe((s) => s.synthParams, (p) => audioEngine.updateSynthParams(p, 'synth'), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.chordSynthParams, (p) => audioEngine.updateSynthParams(p, 'chord'), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassSynthParams, (p) => audioEngine.updateSynthParams(p, 'bass'), { fireImmediately: true }));

  // Transport play flags: init on EVERY transition — the old toggle actions
  // called audioEngine.init() unconditionally, and init()'s resume path is
  // load-bearing (the browser suspends the AudioContext when the tab is
  // backgrounded, so returning with chords playing and starting the sequencer
  // must resume audio). resetClock stays restricted to the fully-stopped ->
  // playing transition (init is idempotent; resetClock would restart the grid
  // mid-session). Encoded 1/2/3 so the subscription fires only on real
  // transitions.
  subs.push(
    useAppStore.subscribe(
      (s) => (s.isSequencerPlaying ? 1 : 0) + (s.isChordsPlaying ? 2 : 0),
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
