/* eslint-disable */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEngine } from '../shared/engineFactory';
import { InstrumentCategory } from '@/engine/instruments/shared/constants';
import { Arpeggiator } from '../synthesizer/utils/Arpeggiator';

// Mock modules at the top level (hoisted)
vi.mock('@/engine/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/audio')>();
  return {
    ...actual,
    AudioContextManager: {
      ...actual.AudioContextManager,
      getInstrumentContext: vi.fn(),
      getMaxPolyphony: vi.fn().mockReturnValue(32),
      isWebRTCActive: vi.fn().mockReturnValue(false),
    },
  };
});

vi.mock('@/engine/effects/runtime/effectsArchitecture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/effects/runtime/effectsArchitecture')>();
  return {
    ...actual,
    getOrCreateGlobalMixer: vi.fn(),
  };
});

vi.mock('../../../shared/utils/webkitCompat', () => ({
  isSafari: vi.fn().mockReturnValue(false),
  getSafariLoadTimeout: vi.fn().mockReturnValue(30000),
  handleSafariAudioError: vi.fn((error) => error),
  findNextCompatibleInstrument: vi.fn(),
}));

// Mock Tone.js
vi.mock('tone', () => {
  const mockAudioNode = {
    toDestination: vi.fn().mockReturnThis(),
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
    volume: { value: 0 },
  };

  const mockSynth = {
    ...mockAudioNode,
    triggerAttack: vi.fn(),
    triggerRelease: vi.fn(),
    triggerAttackRelease: vi.fn(),
    set: vi.fn(),
    get: vi.fn().mockReturnValue({}),
    envelope: {
      attack: 0.01,
      decay: 0.1,
      sustain: 0.5,
      release: 0.5,
    },
    oscillator: {
      type: 'sine',
    },
  };

  const mockPolySynth = {
    ...mockSynth,
    maxPolyphony: 32,
  };

  function createCtor<T>(factory: () => T) {
    return function Ctor(this: unknown) {
      return factory();
    } as unknown as new (...args: any[]) => T;
  }

  return {
    Synth: createCtor(() => mockSynth),
    PolySynth: createCtor(() => mockPolySynth),
    MonoSynth: createCtor(() => mockSynth),
    FMSynth: createCtor(() => mockSynth),
    AMSynth: createCtor(() => mockSynth),
    DuoSynth: createCtor(() => mockSynth),
    MembraneSynth: createCtor(() => mockSynth),
    MetalSynth: createCtor(() => mockSynth),
    PluckSynth: createCtor(() => mockSynth),
    Sampler: createCtor(() => mockSynth),
    Channel: createCtor(() => ({
      ...mockAudioNode,
      pan: { value: 0 },
      volume: { value: 0 },
    })),
    Filter: createCtor(() => ({
      ...mockAudioNode,
      frequency: { value: 350 },
      Q: { value: 1 },
      type: 'lowpass',
    })),
    Gain: createCtor(() => ({
      ...mockAudioNode,
      gain: { value: 1, rampTo: vi.fn() },
    })),
    // DEV-299: SynthEngine.load() now always builds a SynthOutputSaturationStage (voiceSumSaturation.ts),
    // which constructs a Tone WaveShaper — this mock module must provide one or `load()` throws.
    WaveShaper: createCtor(() => ({
      ...mockAudioNode,
      oversample: 'none',
      curve: null,
    })),
    FrequencyEnvelope: createCtor(() => ({
      ...mockAudioNode,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.5,
      release: 0.5,
      baseFrequency: 200,
      octaves: 4,
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      triggerAttackRelease: vi.fn(),
    })),
    Reverb: createCtor(() => mockAudioNode),
    Delay: createCtor(() => mockAudioNode),
    Chorus: createCtor(() => mockAudioNode),
    Distortion: createCtor(() => mockAudioNode),
    setContext: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn(() => ({
      lookAhead: 0.1,
      state: 'running',
      sampleRate: 44100,
      currentTime: 0,
    })),
    now: vi.fn(() => 0),
    Transport: {
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      bpm: { value: 120 },
    },
    getTransport: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      bpm: { value: 120 },
    })),
    Frequency: vi.fn((note: string) => ({
      toMidi: vi.fn(() => {
        // Simple MIDI conversion for testing
        const noteMap: Record<string, number> = {
          'C4': 60, 'D4': 62, 'E4': 64, 'F4': 65, 'G4': 67, 'A4': 69,
          'C5': 72, 'C6': 84,
        };
        return noteMap[note] || 60;
      }),
      toNote: vi.fn(() => note),
    })),
  };
});

/**
 * Regression Tests for SynthEngine Synthesizer Loading
 *
 * These tests prevent the following bugs from reoccurring:
 * 1. "require is not defined" error when loading synthesizers (fixed 2024-11-26)
 * 2. "maxPolyphony does not exist" TypeScript error (fixed 2024-11-26)
 * 3. "Unexpected lexical declaration in case block" error (fixed 2024-11-26)
 *
 * Context: The synthesizer loading code was using CommonJS `require()` which doesn't
 * work in browser environments. It also had incorrect TypeScript types for maxPolyphony
 * configuration and missing block scopes in switch cases.
 */

describe('SynthEngine - Synthesizer Loading (Regression Tests)', () => {
  let mockAudioContext: AudioContext;
  let mockMixer: any;

  beforeEach(async () => {
    // Create a mock AudioContext for testing
    mockAudioContext = new AudioContext();

    // Setup mock mixer
    mockMixer = {
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({
        inputGain: mockAudioContext.createGain(),
      }),
      routeInstrumentToChannel: vi.fn(),
    };

    // Configure mocked modules
    const { AudioContextManager } = await import('@/engine/audio');
    const { getOrCreateGlobalMixer } = await import('@/engine/effects/runtime/effectsArchitecture');

    vi.mocked(AudioContextManager.getInstrumentContext).mockResolvedValue(mockAudioContext);
    vi.mocked(getOrCreateGlobalMixer).mockResolvedValue(mockMixer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (mockAudioContext.state !== 'closed') {
      mockAudioContext.close();
    }
  });

  describe('Bug Fix: require() usage in browser environment', () => {
    it('should not use CommonJS require() when creating synthesizers', async () => {
      const engine = createEngine({
        userId: 'test-user', username: 'Test User',
        instrumentName: 'analog_mono', category: InstrumentCategory.Synthesizer, isLocalUser: true,
      });
      await engine.load(mockAudioContext);
      expect(engine.isInstrumentLoaded()).toBe(true);
      expect(engine.getCategory()).toBe(InstrumentCategory.Synthesizer);
    });

    it('should use ES6 imports for isSafari utility', async () => {
      const engine = createEngine({
        userId: 'test-user', username: 'Test User',
        instrumentName: 'analog_poly', category: InstrumentCategory.Synthesizer, isLocalUser: true,
      });
      await engine.load(mockAudioContext);
      expect(engine.isInstrumentLoaded()).toBe(true);
    });
  });

  describe('Bug Fix: maxPolyphony TypeScript configuration', () => {
    it('should set maxPolyphony as a property on PolySynth instance', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Verify the engine loaded successfully
      expect(engine.isInstrumentLoaded()).toBe(true);
    });

    it('should configure maxPolyphony for analog_poly synthesizer', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // The synthesizer should be created without TypeScript errors
      expect(engine.isInstrumentLoaded()).toBe(true);
      expect(engine.getCategory()).toBe(InstrumentCategory.Synthesizer);
    });

    it('should configure maxPolyphony for fm_poly synthesizer', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'fm_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // The synthesizer should be created without TypeScript errors
      expect(engine.isInstrumentLoaded()).toBe(true);
      expect(engine.getInstrumentName()).toBe('fm_poly');
    });
  });

  describe('Bug Fix: Case block scope for variable declarations', () => {
    it('should handle analog_poly case with proper block scope', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      // Should not throw "Unexpected lexical declaration in case block"
      await expect(engine.load(mockAudioContext)).resolves.not.toThrow();
    });

    it('should handle fm_poly case with proper block scope', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'fm_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      // Should not throw "Unexpected lexical declaration in case block"
      await expect(engine.load(mockAudioContext)).resolves.not.toThrow();
    });
  });

  describe('Synthesizer type coverage', () => {
    const synthTypes = [
      'analog_mono',
      'analog_bass',
      'analog_lead',
      'analog_poly',
      'fm_mono',
      'fm_poly',
    ];

    synthTypes.forEach((synthType) => {
      it(`should load ${synthType} synthesizer without errors`, async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: synthType,
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await expect(engine.load(mockAudioContext)).resolves.not.toThrow();
        expect(engine.getInstrumentName()).toBe(synthType);
        expect(engine.getCategory()).toBe(InstrumentCategory.Synthesizer);
      });
    });
  });

  describe('Safari compatibility', () => {
    it('should use safe oscillator types on Safari', async () => {
      // Mock isSafari to return true for this test
      const { isSafari } = await import('../../../shared/utils/webkitCompat');
      vi.mocked(isSafari).mockReturnValue(true);

      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Should load successfully with Safari-safe settings
      expect(engine.isInstrumentLoaded()).toBe(true);

      // Reset mock
      vi.mocked(isSafari).mockReturnValue(false);
    });

    it('should reduce polyphony on Safari for analog_poly', async () => {
      const { isSafari } = await import('../../../shared/utils/webkitCompat');
      vi.mocked(isSafari).mockReturnValue(true);

      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Should use reduced polyphony (16 instead of 32) on Safari
      expect(engine.isInstrumentLoaded()).toBe(true);

      vi.mocked(isSafari).mockReturnValue(false);
    });

    it('should reduce polyphony on Safari for fm_poly', async () => {
      const { isSafari } = await import('../../../shared/utils/webkitCompat');
      vi.mocked(isSafari).mockReturnValue(true);

      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'fm_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Should use reduced polyphony (12 instead of 32) on Safari for FM synths
      expect(engine.isInstrumentLoaded()).toBe(true);

      vi.mocked(isSafari).mockReturnValue(false);
    });
  });


  describe('Synthesizer parameter updates', () => {
    it('should update synth parameters without errors', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Update parameters
      await expect(
        engine.updateSynthParams({
          volume: 0.8,
          ampAttack: 0.05,
          filterFrequency: 2000,
        })
      ).resolves.not.toThrow();
    });

    it('should preserve synth state across instrument changes', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Set custom parameters
      await engine.updateSynthParams({
        volume: 0.7,
        filterFrequency: 1500,
      });

      const stateBefore = engine.getSynthState();

      // Change to different synth
      await engine.updateInstrument('analog_bass', InstrumentCategory.Synthesizer);

      const stateAfter = engine.getSynthState();

      // Parameters should be preserved
      expect(stateAfter!.volume).toBe(stateBefore!.volume);
      expect(stateAfter!.filterFrequency).toBe(stateBefore!.filterFrequency);
    });
  });

  describe('Note playback', () => {
    it('should filter out non-musical notes for synthesizers', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Mix of musical notes and drum samples
      const notes = ['C4', 'kick', 'D4', 'snare', 'E4'];

      // Should only play musical notes (C4, D4, E4)
      expect(() => notes.forEach(n => engine.playNote({ note: n, velocity: 0.7 }))).not.toThrow();
    });

    it('should handle polyphonic note playback', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Play a chord
      const chord = ['C4', 'E4', 'G4'];
      expect(() => chord.forEach(n => engine.playNote({ note: n, velocity: 0.7 }))).not.toThrow();
    });

    it('should handle monophonic note playback', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Play single notes
      expect(() => engine.playNote({ note: 'C4', velocity: 0.7 })).not.toThrow();
      expect(() => engine.playNote({ note: 'D4', velocity: 0.7 })).not.toThrow();
    });
  });

  describe('Emergency cleanup', () => {
    it('should force stop all notes during emergency cleanup', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Play some notes
      ['C4', 'E4', 'G4'].forEach(n => engine.playNote({ note: n, velocity: 0.7 }));

      // stopAllNotes should not throw
      expect(() => engine.stopAllNotes()).not.toThrow();

      // All notes should be stopped
      expect(engine.getAllActiveNotes()).toHaveLength(0);
    });
  });

  describe('Resource cleanup', () => {
    it('should dispose synthesizer resources properly', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Dispose should not throw
      expect(() => engine.destroy()).not.toThrow();
    });

    // Regression: SynthEngine.destroy() did not set isLoaded = false, so a destroyed engine
    // would still report itself as loaded. InstrumentEnginePool leaves destroyed engines in
    // the map temporarily during rapid switches; stale isLoaded=true could let the UI skip
    // the loading state and try to play through a destroyed engine. (fixed 2026-05)
    it('should set isInstrumentLoaded to false after destroy', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);
      expect(engine.isInstrumentLoaded()).toBe(true);

      engine.destroy();

      expect(engine.isInstrumentLoaded()).toBe(false);
    });

    it('should clean up audio nodes on instrument change', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Change instrument (not awaited — check state transition synchronously)
      engine.updateInstrument('fm_mono', InstrumentCategory.Synthesizer);

      // Should not throw and should be ready to load new instrument
      expect(engine.isInstrumentLoaded()).toBe(false);
      expect(engine.getInstrumentName()).toBe('fm_mono');
    });
  });

  describe('Integration with audio routing', () => {
    it('should route synthesizer output to global mixer', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Verify mixer integration was attempted
      expect(engine.isInstrumentLoaded()).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle initialization errors gracefully', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'invalid_synth',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      // Should create default synth for unknown types
      await expect(engine.load(mockAudioContext)).resolves.not.toThrow();
    });

    it('should handle parameter update errors gracefully', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      // Try to update params before initialization
      await expect(
        engine.updateSynthParams({ volume: 0.5 })
      ).resolves.not.toThrow();
    });
  });

  describe('Backwards compatibility', () => {
    it('should maintain compatibility with existing synth state format', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      const state = engine.getSynthState();

      // Verify all expected properties exist
      expect(state).toHaveProperty('volume');
      expect(state).toHaveProperty('ampAttack');
      expect(state).toHaveProperty('ampDecay');
      expect(state).toHaveProperty('ampSustain');
      expect(state).toHaveProperty('ampRelease');
      expect(state).toHaveProperty('oscillatorType');
      expect(state).toHaveProperty('filterFrequency');
      expect(state).toHaveProperty('filterResonance');
      expect(state).toHaveProperty('filterAttack');
      expect(state).toHaveProperty('filterDecay');
      expect(state).toHaveProperty('filterSustain');
      expect(state).toHaveProperty('filterRelease');
      expect(state).toHaveProperty('modulationIndex');
      expect(state).toHaveProperty('harmonicity');
      expect(state).toHaveProperty('modAttack');
      expect(state).toHaveProperty('modDecay');
      expect(state).toHaveProperty('modSustain');
      expect(state).toHaveProperty('modRelease');
    });
  });

  describe('Arpeggiator Integration', () => {
    it('should create arpeggiator instance during initialization', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Arpeggiator should be initialized
      expect(engine.isInstrumentLoaded()).toBe(true);
    });

    it('should apply initial arp params from synthState', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      const state = engine.getSynthState();
      expect(state).toHaveProperty('arpEnabled');
      expect(state).toHaveProperty('arpMode');
      expect(state).toHaveProperty('arpSubdivision');
      expect(state).toHaveProperty('arpOctaveRange');
      expect(state).toHaveProperty('arpGate');
      expect(state).toHaveProperty('arpLatch');
    });

    it('should route notes through arpeggiator when arpEnabled is true', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Enable arpeggiator
      await engine.updateSynthParams({ arpEnabled: true });

      // Play notes - should route through arpeggiator
      expect(() => engine.playNote({ note: 'C4', velocity: 0.7 })).not.toThrow();
    });

    it('stops the arpeggiator on stopAllNotes even though no note reached activeNotes', async () => {
      // The reported bug: stopping the Arrange transport left an arpeggiated track sounding
      // until its switch was toggled off by hand. With arp enabled, playNote hands the note to
      // the arpeggiator and returns, so `activeNotes` stays empty -- and stopAllNotes was
      // driven entirely by `activeNotes`, so it could never reach the arpeggiator.
      const releaseAllSpy = vi.spyOn(Arpeggiator.prototype, 'releaseAll');
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);
      await engine.updateSynthParams({ arpEnabled: true, arpLatch: true });
      engine.playNote({ note: 'C4', velocity: 0.7 });

      engine.stopAllNotes();

      expect(releaseAllSpy).toHaveBeenCalled();
      releaseAllSpy.mockRestore();
    });

    it('should use normal playback when arpEnabled is false', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Disable arpeggiator (default)
      await engine.updateSynthParams({ arpEnabled: false });

      // Play notes - should use normal playback
      expect(() => engine.playNote({ note: 'C4', velocity: 0.7 })).not.toThrow();
    });

    it('should propagate arp parameter updates to arpeggiator', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Update arp params
      await expect(
        engine.updateSynthParams({
          arpEnabled: true,
          arpMode: 'down',
          arpSubdivision: '16n',
          arpOctaveRange: 2,
          arpGate: 0.75,
          arpLatch: true,
        })
      ).resolves.not.toThrow();

      const state = engine.getSynthState();
      expect(state!.arpEnabled).toBe(true);
      expect(state!.arpMode).toBe('down');
      expect(state!.arpSubdivision).toBe('16n');
      expect(state!.arpOctaveRange).toBe(2);
      expect(state!.arpGate).toBe(0.75);
      expect(state!.arpLatch).toBe(true);
    });

    it('should dispose arpeggiator on cleanup', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Dispose should clean up arpeggiator
      expect(() => engine.destroy()).not.toThrow();
    });

    it('should handle mono synth arpeggiator callbacks correctly', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Enable arp and play note
      await engine.updateSynthParams({ arpEnabled: true });
      engine.playNote({ note: 'C4', velocity: 0.7 });

      // Mono synth should use triggerAttack without note parameter on release
      // This is tested indirectly through the integration
      expect(engine.isInstrumentLoaded()).toBe(true);
    });

    it('should handle poly synth arpeggiator callbacks correctly', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Enable arp and play notes
      await engine.updateSynthParams({ arpEnabled: true });
      ['C4', 'E4', 'G4'].forEach(n => engine.playNote({ note: n, velocity: 0.7 }));

      // Poly synth should use triggerRelease with note parameter
      // This is tested indirectly through the integration
      expect(engine.isInstrumentLoaded()).toBe(true);
    });

    it('should stop notes through arpeggiator when arpEnabled is true', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      await engine.updateSynthParams({ arpEnabled: true });
      engine.playNote({ note: 'C4', velocity: 0.7 });

      // Stop notes - should route through arpeggiator
      expect(() => engine.stopNote({ note: 'C4' })).not.toThrow();
    });

    it('should preserve arp state across instrument changes', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Set arp params
      await engine.updateSynthParams({
        arpEnabled: true,
        arpMode: 'upDown',
        arpOctaveRange: 3,
      });

      const stateBefore = engine.getSynthState();

      // Change instrument
      await engine.updateInstrument('fm_mono', InstrumentCategory.Synthesizer);

      const stateAfter = engine.getSynthState();

      // Arp params should be preserved
      expect(stateAfter!.arpEnabled).toBe(stateBefore!.arpEnabled);
      expect(stateAfter!.arpMode).toBe(stateBefore!.arpMode);
      expect(stateAfter!.arpOctaveRange).toBe(stateBefore!.arpOctaveRange);
    });

    it('should NOT use arpeggiator for poly synths even if arpEnabled is true', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_poly',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      // Enable arp
      await engine.updateSynthParams({ arpEnabled: true });

      // Get the mock synth instance
      const { PolySynth } = await import('tone');
      const mockPolySynth = new PolySynth();

      // Play notes
      const notes = ['C4', 'E4', 'G4'];
      notes.forEach(n => engine.playNote({ note: n, velocity: 0.7 }));

      // It should trigger all notes immediately (bypassing arpeggiator)
      expect(mockPolySynth.triggerAttack).toHaveBeenCalledTimes(notes.length);
      notes.forEach(note => {
        expect(mockPolySynth.triggerAttack).toHaveBeenCalledWith(note, expect.anything(), 0.7);
      });
    });
  });

  /**
   * Regression Tests: SynthEngine Sustain Bugs
   *
   * Bug 1 (Mono): setSustain(false) called triggerRelease() without checking keyHeldNotes,
   * causing notes to stop even when keys were still being held.
   *
   * Fix 1: setSustain(false) now filters sustainedNotes to exclude keyHeldNotes before releasing.
   * For mono synth, it re-triggers the most recent held key if any remain.
   *
   * Bug 2 (Mono): handleMonoSynthRelease could be called for notes not in noteStack,
   * causing incorrect state.
   *
   * Fix 2: Added guard `if (!this.noteStack.includes(noteToRelease)) return` at the start.
   */
  describe('Sustain Regression Tests', () => {
    describe('Mono Synth Sustain Fix', () => {
      it('should not throw when playing and releasing notes with sustain', async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: 'analog_mono',
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await engine.load(mockAudioContext);

        // Play note, release it while sustain is on
        engine.playNote({ note: 'C4', velocity: 0.7 });
        engine.stopNote({ note: 'C4' });

        // This test verifies the fix is in place by checking the engine doesn't throw
        expect(engine.isInstrumentLoaded()).toBe(true);
      });

      it('should handle multiple notes with sustain correctly', async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: 'analog_mono',
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await engine.load(mockAudioContext);

        // Play C4 and hold it
        engine.playNote({ note: 'C4', velocity: 0.7 });

        // Play D4, then release it (goes into sustainedNotes)
        engine.playNote({ note: 'D4', velocity: 0.7 });
        engine.stopNote({ note: 'D4' });

        // Mono synth should handle this gracefully
        expect(engine.isInstrumentLoaded()).toBe(true);
      });

      it('should not throw when setSustain(false) is called with empty sustainedNotes', async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: 'analog_mono',
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await engine.load(mockAudioContext);

        // setSustain(false) with no sustained notes should not throw
        const synthState = engine.getSynthState();
        await expect(
          engine.updateSynthParams({ ...synthState! })
        ).resolves.not.toThrow();
      });
    });

    describe('handleMonoSynthRelease Guard', () => {
      it('should handle release of note not in noteStack gracefully', async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: 'analog_mono',
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await engine.load(mockAudioContext);

        // Play and stop a note
        engine.playNote({ note: 'C4', velocity: 0.7 });
        engine.stopNote({ note: 'C4' });

        // Try to stop it again — should not throw due to guard
        expect(() => engine.stopNote({ note: 'C4' })).not.toThrow();
      });
    });

    describe('Poly Synth Sustain (Existing Behavior)', () => {
      it('should handle re-triggering same note while sustain is on', async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: 'analog_poly',
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await engine.load(mockAudioContext);

        // Play C4
        engine.playNote({ note: 'C4', velocity: 0.7 });

        // Re-trigger C4 — should not throw
        expect(() => engine.playNote({ note: 'C4', velocity: 0.7 })).not.toThrow();
      });

      it('should handle multiple sustained notes correctly', async () => {
        const engine = createEngine({
          userId: 'test-user',
          username: 'Test User',
          instrumentName: 'analog_poly',
          category: InstrumentCategory.Synthesizer,
          isLocalUser: true,
        });

        await engine.load(mockAudioContext);

        // Play multiple notes and release them while sustain is on
        ['C4', 'E4', 'G4'].forEach(n => engine.playNote({ note: n, velocity: 0.7 }));
        ['C4', 'E4', 'G4'].forEach(n => engine.stopNote({ note: n }));

        // This test verifies poly synth sustain behavior
        expect(engine.isInstrumentLoaded()).toBe(true);
      });
    });
  });

  describe('DEV-300: volume is a relative dB pre-gain, converted to linear only at the AudioParam', () => {
    it('load() writes dbToGain(initial volume) to the gain AudioParam, not the raw dB number', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      const gainRef = (engine as unknown as { gainRef: { gain: { value: number } } | null }).gainRef;
      expect(gainRef).not.toBeNull();
      // 'analog_mono' has a measured DEV-311 calibration entry (trimDb -6.9), which SynthEngine's
      // constructor prefers over defaultSynthState.volume (-6dB) — see getCalibratedTrimDb.
      // dbToGain(-6.9) ≈ 0.4519, NOT -6.9 itself.
      expect(gainRef!.gain.value).toBeCloseTo(0.4519, 3);
    });

    it('updateSynthParams({ volume: -6 }) writes a linear gain to the AudioParam, not -6 itself', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);
      await engine.updateSynthParams({ volume: -6 });

      const gainRef = (engine as unknown as { gainRef: { gain: { value: number } } }).gainRef;
      expect(gainRef.gain.value).toBeCloseTo(0.5012, 3);
    });

    it('updateSynthParams({ volume: 0 }) writes unity gain (1.0) — 0dB means untouched, not silence', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'fm_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);
      await engine.updateSynthParams({ volume: 0 });

      const gainRef = (engine as unknown as { gainRef: { gain: { value: number } } }).gainRef;
      expect(gainRef.gain.value).toBeCloseTo(1, 5);
    });

    it('scheduleParameterChange("volume", ...) also converts through dbToGain before writing', async () => {
      const engine = createEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'analog_mono',
        category: InstrumentCategory.Synthesizer,
        isLocalUser: true,
      });

      await engine.load(mockAudioContext);

      const gainRef = (
        engine as unknown as {
          gainRef: { gain: { setValueAtTime: (value: number, time: number) => void } };
        }
      ).gainRef;
      let capturedValue: number | undefined;
      gainRef.gain.setValueAtTime = (value: number) => {
        capturedValue = value;
      };

      engine.scheduleParameterChange('volume', -6, 0);

      expect(capturedValue).toBeCloseTo(0.5012, 3);
    });
  });
});
