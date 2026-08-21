/* eslint-disable */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MelodicEngine } from '../melodic/MelodicEngine';
import { InstrumentCategory } from '@/engine/instruments/shared/constants';
import { dbToGain, toDecibels } from '@/shared/audio/gainUnits';

// Track all stopFns created by mock Soundfont.start()
let mockStopFns: ReturnType<typeof vi.fn>[] = [];
let mockSoundfontOptions: any[] = [];

vi.mock('smplr', () => {
  class MockSoundfont {
    hasLoops = true;
    load = Promise.resolve();
    start = vi.fn().mockImplementation(() => {
      const stopFn = vi.fn();
      mockStopFns.push(stopFn);
      return stopFn;
    });
    stop = vi.fn();
    disconnect = vi.fn();
    constructor(_context: AudioContext, options: any) {
      mockSoundfontOptions.push(options);
    }
  }

  return {
    Soundfont: MockSoundfont,
  };
});

vi.mock('@/engine/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/audio')>();
  return {
    ...actual,
    AudioContextManager: {
      ...actual.AudioContextManager,
      getInstrumentContext: vi.fn(),
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
  handleSafariAudioError: vi.fn((error: any) => error),
  findNextCompatibleInstrument: vi.fn(),
}));

/**
 * Regression Tests: MelodicEngine Sustain Bug
 *
 * Bug: playNote() called this.stopNote(note, 0) before re-triggering, but stopNote()
 * has a sustain guard that returns early without stopping sound when sustain=true.
 * This caused stacked voices when the same note was repeated rapidly while sustain was held.
 *
 * Fix: playNote() now directly calls the stopFn from activeNotes before re-triggering,
 * bypassing the sustain guard entirely.
 */
describe('MelodicEngine — Sustain Regression Tests', () => {
  let engine: MelodicEngine;
  let mockAudioContext: AudioContext;
  let mockMixer: any;

  beforeEach(async () => {
    mockStopFns = [];
    mockSoundfontOptions = [];

    mockAudioContext = new AudioContext();
    Object.defineProperty(mockAudioContext, 'sampleRate', {
      value: 48000,
      configurable: true,
    });
    mockMixer = {
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({
        inputGain: mockAudioContext.createGain(),
      }),
    };

    const { AudioContextManager } = await import('@/engine/audio');
    const { getOrCreateGlobalMixer } = await import('@/engine/effects/runtime/effectsArchitecture');

    vi.mocked(AudioContextManager.getInstrumentContext).mockResolvedValue(mockAudioContext);
    vi.mocked(getOrCreateGlobalMixer).mockResolvedValue(mockMixer);

    engine = new MelodicEngine({
      userId: 'test-user',
      username: 'Test User',
      instrumentName: 'acoustic_grand_piano',
      category: InstrumentCategory.Melodic,
      isLocalUser: true,
    });

    await engine.load();
  });

  it('requests smplr loop metadata for sustained soundfont playback', () => {
    expect(mockSoundfontOptions[0]).toMatchObject({
      loadLoopData: false,
    });
    expect(mockSoundfontOptions[0].instrument ?? mockSoundfontOptions[0].instrumentUrl).toContain(
      'acoustic_grand_piano',
    );
  });

  describe('Bug Fix: playNote must force-stop previous voice even when sustain=true', () => {
    it('should call the previous stopFn when re-triggering the same note while sustain is on', () => {
      engine.setSustain(true);

      engine.playNote({ note: 'C4', velocity: 0.7 });
      const firstStopFn = mockStopFns[0];
      expect(firstStopFn).toBeDefined();
      expect(firstStopFn).not.toHaveBeenCalled();

      // Re-trigger the same note — old voice must be stopped
      engine.playNote({ note: 'C4', velocity: 0.7 });

      expect(firstStopFn).toHaveBeenCalledOnce();
    });

    it('should stop all previous voices when note is repeated 5 times while sustain is on', () => {
      engine.setSustain(true);

      for (let i = 0; i < 5; i++) {
        engine.playNote({ note: 'C4', velocity: 0.7 });
      }

      // stopFns[0..3] should each have been called exactly once (stopped before next trigger)
      // stopFns[4] is the current active voice and should NOT have been called
      expect(mockStopFns).toHaveLength(5);
      expect(mockStopFns[0]).toHaveBeenCalledOnce();
      expect(mockStopFns[1]).toHaveBeenCalledOnce();
      expect(mockStopFns[2]).toHaveBeenCalledOnce();
      expect(mockStopFns[3]).toHaveBeenCalledOnce();
      expect(mockStopFns[4]).not.toHaveBeenCalled();
    });

    it('should stop sustained notes when setSustain(false) is called', () => {
      engine.setSustain(true);

      engine.playNote({ note: 'C4', velocity: 0.7 });
      const stopFn = mockStopFns[0];

      // Release note while sustain is on — note goes into sustainedNotes
      engine.stopNote({ note: 'C4' });
      expect(stopFn).not.toHaveBeenCalled();

      // Release sustain — should stop the sustained note
      engine.setSustain(false);
      expect(stopFn).toHaveBeenCalledOnce();
    });

    it('should NOT stop notes that are still held when setSustain(false) is called', () => {
      engine.setSustain(true);

      engine.playNote({ note: 'C4', velocity: 0.7 });
      const c4StopFn = mockStopFns[0];

      engine.playNote({ note: 'E4', velocity: 0.7 });
      const e4StopFn = mockStopFns[1];

      // Release C4 (goes into sustainedNotes), but keep E4 held
      engine.stopNote({ note: 'C4' });

      // Release sustain — C4 should stop, E4 should NOT
      engine.setSustain(false);

      expect(c4StopFn).toHaveBeenCalledOnce();
      expect(e4StopFn).not.toHaveBeenCalled();
    });
  });

  describe('Normal behavior (sustain off)', () => {
    it('should stop previous voice when re-triggering the same note without sustain', () => {
      engine.playNote({ note: 'C4', velocity: 0.7 });
      const firstStopFn = mockStopFns[0];

      engine.playNote({ note: 'C4', velocity: 0.7 });

      expect(firstStopFn).toHaveBeenCalledOnce();
    });

    it('should stop note immediately when stopNote is called without sustain', () => {
      engine.playNote({ note: 'C4', velocity: 0.7 });
      const stopFn = mockStopFns[0];

      engine.stopNote({ note: 'C4' });

      expect(stopFn).toHaveBeenCalledOnce();
    });
  });

  describe('Regression guard: stopNote behavior with sustain', () => {
    it('should add note to sustainedNotes when stopNote is called while sustain is on', () => {
      engine.setSustain(true);

      engine.playNote({ note: 'C4', velocity: 0.7 });
      const stopFn = mockStopFns[0];

      // stopNote should NOT stop the sound immediately, but add to sustainedNotes
      engine.stopNote({ note: 'C4' });
      expect(stopFn).not.toHaveBeenCalled();

      // Verify it's in sustainedNotes by checking that setSustain(false) stops it
      engine.setSustain(false);
      expect(stopFn).toHaveBeenCalledOnce();
    });
  });

  // Regression: MelodicEngine.destroy() did not set isLoaded = false, so a destroyed engine
  // could still report itself as loaded. InstrumentEnginePool leaves destroyed engines in
  // the map temporarily during rapid instrument switches; stale isLoaded=true could let the
  // UI skip the loading state and try to play through a destroyed engine. (fixed 2026-05)
  describe('Regression: destroy() must mark engine as unloaded', () => {
    it('should set isInstrumentLoaded to false after destroy', () => {
      expect(engine.isInstrumentLoaded()).toBe(true);

      engine.destroy();

      expect(engine.isInstrumentLoaded()).toBe(false);
    });
  });

  describe('pre-gain (DEV-301)', () => {
    it("setVolume writes to the pre-gain node's gain value after load", async () => {
      const freshEngine = new MelodicEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'acoustic_grand_piano',
        category: InstrumentCategory.Melodic,
        isLocalUser: true,
      });
      await freshEngine.load();

      freshEngine.setVolume(-6);

      const node = freshEngine.getAudioNode();
      expect(node).not.toBeNull();
      expect((node as GainNode).gain.value).toBeCloseTo(dbToGain(toDecibels(-6)), 5);
    });

    it('setVolume called before load() does not throw and is applied once loaded', async () => {
      const freshEngine = new MelodicEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'acoustic_grand_piano',
        category: InstrumentCategory.Melodic,
        isLocalUser: true,
      });

      expect(() => freshEngine.setVolume(-12)).not.toThrow();
      await freshEngine.load();

      const node = freshEngine.getAudioNode();
      expect(node).not.toBeNull();
      expect((node as GainNode).gain.value).toBeCloseTo(dbToGain(toDecibels(-12)), 5);
    });

    it('getInstrumentParams reflects the last setVolume/updateInstrumentParams value', async () => {
      const freshEngine = new MelodicEngine({
        userId: 'test-user',
        username: 'Test User',
        instrumentName: 'acoustic_grand_piano',
        category: InstrumentCategory.Melodic,
        isLocalUser: true,
      });
      await freshEngine.load();

      freshEngine.setVolume(-3);
      expect(freshEngine.getInstrumentParams()).toEqual({ volume: -3 });

      await freshEngine.updateInstrumentParams({ volume: 6 });
      expect(freshEngine.getInstrumentParams()).toEqual({ volume: 6 });
      expect((freshEngine.getAudioNode() as GainNode).gain.value).toBeCloseTo(
        dbToGain(toDecibels(6)),
        5,
      );
    });
  });
});
