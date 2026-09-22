import { describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { SOURCE_BUSES } from './sourceBuses';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { buildMixdownSnapshot } from './mixdownSnapshot';

describe('buildMixdownSnapshot', () => {
  test('carries one bus row per SOURCE_BUSES entry, and one Beat voice row per loop', () => {
    const snapshot = buildMixdownSnapshot(useAppStore.getState());
    expect(snapshot.buses.map((b) => b.source)).toEqual(SOURCE_BUSES.map((b) => b.source));
    // Per LOOP, not per snapshot: a Beat belongs to a loop, and a roster is
    // complete because `beatMix` always holds every voice.
    for (const loop of snapshot.loops) {
      expect(loop.beatVoiceGains.map((v) => v.voice)).toEqual([...BEAT_VOICE_IDS]);
    }
  });

  test('a muted Beat voice crosses the boundary as a gain of 0, not as its fader value', () => {
    const before = useAppStore.getState().loops[0].beatMix;
    const muted = {
      ...before,
      voices: { ...before.voices, kick: { levelDb: 0, muted: true } },
    };
    useAppStore.setState((state) => ({ loops: [{ ...state.loops[0], beatMix: muted }] }));
    try {
      const snapshot = buildMixdownSnapshot(useAppStore.getState());
      const gains = snapshot.loops[0].beatVoiceGains;
      expect(gains.find((v) => v.voice === 'kick')?.gain).toBe(0);
      expect(gains.find((v) => v.voice === 'snare')?.gain).toBeGreaterThan(0);
      // The raw mix travels too: it is the SCHEDULING half of the same mute,
      // and `planBeatStep` reads it to build no voice at all.
      expect(snapshot.loops[0].beatMix.voices.kick.muted).toBe(true);
    } finally {
      useAppStore.setState((state) => ({ loops: [{ ...state.loops[0], beatMix: before }] }));
    }
  });

  test('converts the store\'s dB to linear gain, exactly once', () => {
    useAppStore.setState({ masterVolume: 0, chordVolume: 0, chordMuted: false });
    const snapshot = buildMixdownSnapshot(useAppStore.getState());
    // 0 dB is unity, and faderDbToGain is the SAME boundary engineSync uses —
    // a snapshot carrying dB would make the engine read 0 as silence.
    expect(snapshot.masterVolume).toBeCloseTo(1, 6);
    expect(snapshot.buses.find((b) => b.source === 'chord')?.gain).toBeCloseTo(1, 6);
  });

  test('solo does not leak into the export; mute does', () => {
    useAppStore.setState({ soloTracks: ['drums'], chordMuted: false, bassMuted: true });
    const snapshot = buildMixdownSnapshot(useAppStore.getState());
    // Solo is a session-only monitoring gesture; it never reaches the export.
    expect(snapshot.buses.find((b) => b.source === 'chord')?.muted).toBe(false);
    // Mute is arrangement intent and does.
    expect(snapshot.buses.find((b) => b.source === 'bass')?.muted).toBe(true);
  });

  test('resolves stepsPerBar from the meter, so the renderer never parses a meter string', () => {
    useAppStore.setState({ meterId: '3/4' });
    expect(buildMixdownSnapshot(useAppStore.getState()).stepsPerBar).toBe(12);
    useAppStore.setState({ meterId: '4/4' });
    expect(buildMixdownSnapshot(useAppStore.getState()).stepsPerBar).toBe(16);
  });

  test('carries project content and derives the mixer from each loop', () => {
    const before = useAppStore.getState();
    const loop = {
      ...before.loops[0],
      chordVolume: -12,
      chordMuted: true,
      beatParams: {
        ...before.loops[0].beatParams,
        filter: { cutoff: 2170, resonance: 1, type: 'lowpass' as const },
      },
    };
    useAppStore.setState({
      loops: [loop],
      // Deliberately disagree with the loop: these flat fields describe the
      // active editor, not every loop in the arrangement.
      chordVolume: 0,
      chordMuted: false,
    });
    try {
      const snapshot = buildMixdownSnapshot(useAppStore.getState());
      expect(snapshot.loops).toHaveLength(1);
      expect(snapshot.loops[0].chords).toEqual(loop.chords);
      const chordBus = snapshot.loops[0].buses.find((b) => b.source === 'chord');
      expect(chordBus?.source).toBe('chord');
      expect(chordBus?.gain).toBeCloseTo(10 ** (-12 / 20), 6);
      expect(chordBus?.muted).toBe(true);
      expect(snapshot.loops[0].beatParams.filter).toEqual({
        cutoff: 2170,
        resonance: 1,
        type: 'lowpass',
      });
      // The renderer resolves each lane's cycle from the SNAPSHOT, so the
      // custom pattern's own length and holds must survive the store boundary
      // — src/audio/ may not reach back into the store for them.
      expect(snapshot.loops[0].customChordLoopLength).toBe(loop.customChordLoopLength);
      expect(snapshot.loops[0].customChordHoldSteps).toEqual(loop.customChordHoldSteps);
      expect(snapshot.loops[0].customBassLoopLength).toBe(loop.customBassLoopLength);
      expect(snapshot.loops[0].customBassHoldSteps).toEqual(loop.customBassHoldSteps);
    } finally {
      useAppStore.setState({
        loops: before.loops,
        chordVolume: before.chordVolume,
        chordMuted: before.chordMuted,
      });
    }
  });
});
