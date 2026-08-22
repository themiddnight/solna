import { useEffect } from 'react';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS } from '../audio/drumKits';
import { useAppStore } from './store';

/**
 * One-way bridge from the Zustand store into the audioEngine singleton.
 * One effect per slice: read the slice's state via selectors and push live
 * changes into the engine (replacing the per-value useEffect blocks that
 * lived in App.tsx / the view components).
 *
 * Called exactly once at the app root (Task 2). Actions keep doing their own
 * engine calls (e.g. init/resetClock) — this hook only mirrors state changes.
 */
export function useEngineSync(): void {
  // transport slice
  const bpm = useAppStore((s) => s.bpm);
  const masterVolume = useAppStore((s) => s.masterVolume);
  const metronomeActive = useAppStore((s) => s.metronomeActive);

  // chords + bass slices (per-source buses)
  const chordVolume = useAppStore((s) => s.chordVolume);
  const bassVolume = useAppStore((s) => s.bassVolume);
  const chordMuted = useAppStore((s) => s.chordMuted);
  const bassMuted = useAppStore((s) => s.bassMuted);

  // sequencer slice
  const soundKit = useAppStore((s) => s.soundKit);

  // effects slice
  const effects = useAppStore((s) => s.effects);

  // synth slice
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);

  useEffect(() => {
    audioEngine.setClockBpm(bpm);
    audioEngine.setMasterVolume(masterVolume);
    audioEngine.setMetronomeEnabled(metronomeActive);
  }, [bpm, masterVolume, metronomeActive]);

  useEffect(() => {
    audioEngine.setSourceGain('chord', chordVolume);
    audioEngine.setSourceGain('bass', bassVolume);
    audioEngine.setSourceMuted('chord', chordMuted);
    audioEngine.setSourceMuted('bass', bassMuted);
  }, [chordVolume, bassVolume, chordMuted, bassMuted]);

  useEffect(() => {
    audioEngine.setDrumKit(DRUM_KITS[soundKit]);
  }, [soundKit]);

  useEffect(() => {
    audioEngine.updateEffects(effects);
  }, [effects]);

  useEffect(() => {
    audioEngine.updateSynthParams(synthParams, 'synth');
    audioEngine.updateSynthParams(chordSynthParams, 'chord');
    audioEngine.updateSynthParams(bassSynthParams, 'bass');
  }, [synthParams, chordSynthParams, bassSynthParams]);
}
