
import { PerformRoomStateService } from '../application/PerformRoomStateService';
import type { PerformRoomState, UserPerformState, InstrumentCategory } from '../domain/models/PerformRoomState';
import { INSTRUMENT_CONSTANTS , DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';

describe('PerformRoomStateService - Auto-initialization', () => {
  let service: PerformRoomStateService;
  let mockRedisClient: Record<string, jest.Mock>;
  const TEST_ROOM_ID = 'test-room-123';
  const TEST_USER_ID = 'user-456';

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedisClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue(false),
    } as unknown as Record<string, jest.Mock>;

    service = new PerformRoomStateService();
    // Inject mock redis client
    (service as unknown as Record<string, unknown>).redisState = mockRedisClient;
    jest.spyOn(redisStateService, 'executeWithLock').mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<unknown>) => operation(),
    );
  });

  describe('updateUserState', () => {
    it('should auto-initialize state when room does not exist', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');

      const updates = { currentInstrument: 'piano', currentCategory: 'keyboard' as unknown as InstrumentCategory };
      
      await service.updateUserState(TEST_ROOM_ID, TEST_USER_ID, updates);

      // Should have called initializeState (which calls set)
      expect(mockRedisClient.set!).toHaveBeenCalled();
      
      // Verify the state was initialized with default values
      const setCall = mockRedisClient.set!.mock.calls[0] as [string, unknown];
      const savedState = setCall[1] as Record<string, unknown>;
      
      expect(savedState.roomId).toBe(TEST_ROOM_ID);
      expect(savedState.roomType).toBe('perform');
      expect(savedState.bpm).toBe(120);
    });

    it('should auto-create user state if user does not exist in room', async () => {
      // Mock: room exists but user does not
      const existingState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map(),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

      mockRedisClient.get!.mockResolvedValue(({
        ...existingState,
        userStates: [],
      }));
void mockRedisClient.set!.mockResolvedValue('OK');

      const updates = { currentInstrument: 'synth', currentCategory: 'synthesizer' as unknown as InstrumentCategory };
      
      const result = await service.updateUserState(TEST_ROOM_ID, TEST_USER_ID, updates);

      // Should have created user state with updates
      expect(result.userStates.has(TEST_USER_ID)).toBe(true);
      
      const userState = result.userStates.get(TEST_USER_ID);
      expect(userState?.currentInstrument).toBe('synth');
      expect(userState?.currentCategory).toBe('synthesizer');
      expect(userState?.userId).toBe(TEST_USER_ID);
    });

    it('should use shared catalog defaults when auto-creating a user state without instrument updates', async () => {
      const existingState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map(),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

      mockRedisClient.get!.mockResolvedValue({
        ...existingState,
        userStates: [],
      });
void mockRedisClient.set!.mockResolvedValue('OK');

      const result = await service.updateUserState(TEST_ROOM_ID, TEST_USER_ID, {});

      const userState = result.userStates.get(TEST_USER_ID);
      expect(userState?.currentInstrument).toBe(INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT);
      expect(userState?.currentCategory).toBe(INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY);
    });

    it('should update existing user state without recreating', async () => {
      const existingUserState: UserPerformState = {
        userId: TEST_USER_ID,
        username: 'testuser',
        currentInstrument: 'piano',
        currentCategory: 'keyboard' as unknown as InstrumentCategory,
        effectChains: {},
        isPlaying: false,
      };

      const existingState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map([[TEST_USER_ID, existingUserState]]),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

      mockRedisClient.get!.mockResolvedValue(({
        ...existingState,
        userStates: [[TEST_USER_ID, existingUserState]],
      }));
void mockRedisClient.set!.mockResolvedValue('OK');

      const updates = { currentInstrument: 'synth' };
      
      const result = await service.updateUserState(TEST_ROOM_ID, TEST_USER_ID, updates);

      const userState = result.userStates.get(TEST_USER_ID);
      expect(userState?.currentInstrument).toBe('synth');
      expect(result.userStates.get(TEST_USER_ID)?.username).toBe('testuser'); // Preserved
      expect(result.userStates.get(TEST_USER_ID)?.currentCategory).toBe('keyboard'); // Preserved
    });
  });

  describe('addUserState', () => {
    it('should auto-initialize state when room does not exist', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');

      const newUserState: UserPerformState = {
        userId: TEST_USER_ID,
        username: 'newuser',
        currentInstrument: 'guitar',
        currentCategory: 'string' as unknown as InstrumentCategory,
        effectChains: {},
        isPlaying: false,
      };
      
      await service.addUserState(TEST_ROOM_ID, TEST_USER_ID, newUserState);

      expect(mockRedisClient.set!).toHaveBeenCalled();
      
      const setCall = mockRedisClient.set!.mock.calls[0] as [string, unknown];
      const savedState = setCall[1] as Record<string, unknown>;
      
      expect(savedState.roomId).toBe(TEST_ROOM_ID);
    });
  });

  describe('updateAllCompanionPreset', () => {
    it('updates all companions with role-specific preset settings without touching runtime state', async () => {
      const existingState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map(),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [
          {
            id: 'bass-1',
            instrumentId: 'electric_bass_finger',
            role: 'bass',
            style: 'root-only',
            density: 'sparse',
            timing: 'normal',
            isPlaying: true,
            isMuted: false,
            volume: -9,
          },
          {
            id: 'chord-1',
            instrumentId: 'acoustic_grand_piano',
            role: 'chord',
            style: 'block',
            density: 'normal',
            timing: 'normal',
            isPlaying: false,
            isMuted: true,
            volume: -6,
          },
          {
            id: 'beat-1',
            instrumentId: 'roland_tr_808',
            role: 'beat',
            style: 'basic',
            density: 'normal',
            timing: 'normal',
            isPlaying: true,
            isMuted: false,
            volume: -12,
          },
        ],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

      mockRedisClient.get!.mockResolvedValue({
        ...existingState,
        userStates: [],
      });
void mockRedisClient.set!.mockResolvedValue('OK');

      const result = await service.updateAllCompanionPreset(TEST_ROOM_ID, 'jazz', 2);

      expect(result.companions).toHaveLength(3);
      expect(result.companions[0]).toMatchObject({
        id: 'bass-1',
        instrumentId: 'electric_bass_finger',
        role: 'bass',
        genrePreset: 'jazz',
        embellishmentIntensity: 2,
        style: 'walking',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: -9,
      });
      expect(result.companions[1]).toMatchObject({
        id: 'chord-1',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        genrePreset: 'jazz',
        embellishmentIntensity: 2,
        chordComplexity: 'seventh',
        voicingStyle: 'rootless',
        isPlaying: false,
        isMuted: true,
        volume: -6,
      });
      expect(result.companions[2]).toMatchObject({
        id: 'beat-1',
        instrumentId: 'roland_tr_808',
        role: 'beat',
        genrePreset: 'jazz',
        embellishmentIntensity: 2,
        style: 'jazz',
        swingPercent: 67,
        drumFillIntervalBars: 0,
        isPlaying: true,
        isMuted: false,
        volume: -12,
      });
      expect(redisStateService.executeWithLock).toHaveBeenCalledTimes(1);
      expect(result.companionSelectedGenrePreset).toBe('jazz');
      expect(result.companionSelectedIntensity).toBe(2);
      expect(result.companionOverrideInstruments).toBe(false);
      // Room-level chord progression must be left untouched by a preset update
      expect(result.companionChordProgression.mode).toBe('random');
      expect(result.companionChordProgression.currentChordIndex).toBe(0);
    });

    it('preserves a valid strum chord style on state load and only normalizes legacy styles to block', async () => {
      const existingState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        companions: [
          {
            id: 'chord-strum', instrumentId: 'electric_guitar_clean', role: 'chord' as const,
            style: 'strum', density: 'normal' as const, timing: 'normal' as const,
            isPlaying: true, isMuted: false, volume: DEFAULT_COMPANION_VOLUME_DB,
          },
          {
            id: 'chord-legacy', instrumentId: 'acoustic_grand_piano', role: 'chord' as const,
            style: 'arp', density: 'normal' as const, timing: 'normal' as const,
            isPlaying: true, isMuted: false, volume: DEFAULT_COMPANION_VOLUME_DB,
          },
        ],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic' as const,
        companionChordProgression: { mode: 'random' as const, chords: [], barsPerChord: 1 as const, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };
      mockRedisClient.get!.mockResolvedValue(existingState);
      void mockRedisClient.set!.mockResolvedValue('OK');

      // pop/step-1 genre sets chord comping/voicing but never the top-level block/broken/strum style.
      const result = await service.updateAllCompanionPreset(TEST_ROOM_ID, 'pop', 1);

      const strumCompanion = result.companions.find((c) => c.id === 'chord-strum');
      const legacyCompanion = result.companions.find((c) => c.id === 'chord-legacy');
      expect(strumCompanion?.style).toBe('strum'); // valid style must survive load (bug: was clobbered to 'block')
      expect(legacyCompanion?.style).toBe('block'); // legacy/unknown style still normalized
    });

    it('can override companion instruments from genre defaults while preserving runtime state', async () => {
      const existingState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map(),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [
          {
            id: 'bass-1',
            instrumentId: 'electric_bass_finger',
            role: 'bass',
            style: 'root-only',
            density: 'sparse',
            timing: 'normal',
            isPlaying: true,
            isMuted: false,
            volume: -9,
          },
          {
            id: 'chord-1',
            instrumentId: 'acoustic_grand_piano',
            role: 'chord',
            style: 'block',
            density: 'normal',
            timing: 'normal',
            isPlaying: false,
            isMuted: true,
            volume: -6,
          },
          {
            id: 'chord-2',
            instrumentId: 'electric_piano_1',
            role: 'chord',
            style: 'block',
            density: 'normal',
            timing: 'normal',
            isPlaying: false,
            isMuted: false,
            volume: -15,
          },
          {
            id: 'chord-3',
            instrumentId: 'electric_guitar_clean',
            role: 'chord',
            style: 'strum',
            density: 'normal',
            timing: 'normal',
            isPlaying: false,
            isMuted: false,
            volume: -18,
          },
          {
            id: 'beat-1',
            instrumentId: 'TR-808',
            role: 'beat',
            style: 'basic',
            density: 'normal',
            timing: 'normal',
            isPlaying: true,
            isMuted: false,
            volume: -12,
          },
        ],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

      mockRedisClient.get!.mockResolvedValue({
        ...existingState,
        userStates: [],
      });
      void mockRedisClient.set!.mockResolvedValue('OK');

      const result = await service.updateAllCompanionPreset(TEST_ROOM_ID, 'house', 3, { overrideInstruments: true });

      expect(result.companions.find((c) => c.id === 'bass-1')).toMatchObject({
        instrumentId: 'synth_bass_1',
        role: 'bass',
        style: 'pedal-eighths',
        isPlaying: true,
        volume: -9,
      });
      expect(result.companions.find((c) => c.id === 'chord-1')).toMatchObject({
        instrumentId: 'drawbar_organ',
        role: 'chord',
        style: 'block',
        chordPlayStyle: 'pulse',
        isMuted: true,
      });
      expect(result.companions.find((c) => c.id === 'chord-2')).toMatchObject({
        instrumentId: 'pad_2_warm',
        role: 'chord',
        style: 'block',
        chordPlayStyle: 'pulse',
        volume: -15,
      });
      expect(result.companions.find((c) => c.id === 'chord-3')).toMatchObject({
        instrumentId: 'drawbar_organ',
        role: 'chord',
        style: 'block',
        chordPlayStyle: 'pulse',
        volume: -18,
      });
      expect(result.companions.find((c) => c.id === 'beat-1')).toMatchObject({
        instrumentId: 'drumabuse:roland-tr-909',
        role: 'beat',
        style: 'dance',
        isPlaying: true,
        volume: -12,
      });
      expect(result.companionSelectedGenrePreset).toBe('house');
      expect(result.companionSelectedIntensity).toBe(3);
      expect(result.companionOverrideInstruments).toBe(true);
    });

    it('persists companion dropdown controls without changing companions', async () => {
      const existingState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map(),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [
          {
            id: 'bass-1',
            instrumentId: 'electric_bass_finger',
            role: 'bass',
            style: 'root-only',
            density: 'normal',
            timing: 'normal',
            isPlaying: false,
            isMuted: false,
            volume: DEFAULT_COMPANION_VOLUME_DB,
          },
        ],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
        companionSelectedGenrePreset: 'pop',
        companionSelectedIntensity: 1,
        companionOverrideInstruments: false,
        lastUpdated: new Date(),
      };

      mockRedisClient.get!.mockResolvedValue({
        ...existingState,
        userStates: [],
      });
      void mockRedisClient.set!.mockResolvedValue('OK');

      const result = await service.setCompanionPresetControls(TEST_ROOM_ID, {
        companionSelectedGenrePreset: 'latin',
        companionSelectedIntensity: 2,
        companionOverrideInstruments: true,
      });

      expect(result.companionSelectedGenrePreset).toBe('latin');
      expect(result.companionSelectedIntensity).toBe(2);
      expect(result.companionOverrideInstruments).toBe(true);
      expect(result.companions).toEqual(existingState.companions);
      expect(redisStateService.executeWithLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeUserState', () => {
    it('should auto-initialize state when room does not exist', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');
      
      await service.removeUserState(TEST_ROOM_ID, TEST_USER_ID);

      expect(mockRedisClient.set!).toHaveBeenCalled();
    });
  });

  describe('updateRecordingState', () => {
    it('should auto-initialize state when room does not exist', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');
      
      await service.updateRecordingState(TEST_ROOM_ID, { isAudioRecording: true });

      expect(mockRedisClient.set!).toHaveBeenCalled();
    });
  });

  describe('updateMemberBroadcastState', () => {
    it('should auto-initialize state when room does not exist', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');
      
      await service.updateMemberBroadcastState(TEST_ROOM_ID, TEST_USER_ID, 'testuser', true);

      expect(mockRedisClient.set!).toHaveBeenCalled();
    });
  });

  describe('updateVoiceState', () => {
    it('should auto-initialize state when room does not exist', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');
      
      await service.updateVoiceState(TEST_ROOM_ID, TEST_USER_ID, false);

      expect(mockRedisClient.set!).toHaveBeenCalled();
    });
  });

  describe('Distributed Lock Usage (ISSUE-65)', () => {
    /**
     * Verify that state mutation methods use distributed locks correctly
     */

    it('should use distributed lock for updateUserState', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');

      await service.updateUserState(TEST_ROOM_ID, TEST_USER_ID, { 
        currentInstrument: 'piano',
        currentCategory: 'keyboard' as unknown as InstrumentCategory
      });

      expect(mockRedisClient.set!).toHaveBeenCalled();
    });

    it('should use distributed lock for updateRecordingState', async () => {
      const initialState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      };
void mockRedisClient.get!.mockResolvedValue(initialState);
void mockRedisClient.set!.mockResolvedValue('OK');

      await service.updateRecordingState(TEST_ROOM_ID, { isAudioRecording: true });

      expect(mockRedisClient.set!).toHaveBeenCalled();
    });

    it('should serialize concurrent state updates correctly', async () => {
      let updateCount = 0;
      
      mockRedisClient.get!.mockImplementation(async () => ({
        roomId: TEST_ROOM_ID,
        roomType: 'perform' as const,
        userStates: [],
        recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
        broadcastStates: {},
        voiceStates: {},
        bpm: 120 + updateCount * 10,
        timeSignature: { numerator: 4, denominator: 4 },
        lastUpdated: new Date().toISOString(),
      }));
      
      mockRedisClient.set!.mockImplementation(async () => {
        updateCount++;
        return 'OK';
      });

      // Concurrent updates
      await Promise.all([
        service.updateUserState(TEST_ROOM_ID, 'user-1', { currentInstrument: 'piano' } as unknown as Partial<UserPerformState>),
        service.updateUserState(TEST_ROOM_ID, 'user-2', { currentInstrument: 'guitar' } as unknown as Partial<UserPerformState>),
        service.updateUserState(TEST_ROOM_ID, 'user-3', { currentInstrument: 'drums' } as unknown as Partial<UserPerformState>),
      ]);

      // All should complete
      expect(mockRedisClient.set!).toHaveBeenCalledTimes(3);
    });
  });
});

describe('PerformRoomStateService - Companion mutation null-state guard (DEV-137)', () => {
  let service: PerformRoomStateService;
  let mockRedisClient: Record<string, jest.Mock>;
  const ROOM_ID = 'room-null-test';

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedisClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
    } as unknown as Record<string, jest.Mock>;

    service = new PerformRoomStateService();
    (service as unknown as Record<string, unknown>).redisState = mockRedisClient;
    jest.spyOn(redisStateService, 'executeWithLock').mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<unknown>) => operation(),
    );
  });

  const COMPANION_STUB = {
    id: 'c1',
    instrumentId: 'acoustic_grand_piano',
    role: 'chord' as const,
    style: 'block' as const,
    density: 'normal' as const,
    timing: 'normal' as const,
    isPlaying: false,
    isMuted: false,
    volume: DEFAULT_COMPANION_VOLUME_DB,
  };

  it('addCompanion throws when room state is missing', async () => {
    await expect(service.addCompanion(ROOM_ID, COMPANION_STUB))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('removeCompanion throws when room state is missing', async () => {
    await expect(service.removeCompanion(ROOM_ID, 'c1'))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('updateCompanion throws when room state is missing', async () => {
    await expect(service.updateCompanion(ROOM_ID, 'c1', { volume: -6 }))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('updateAllCompanionsPlayState throws when room state is missing', async () => {
    await expect(service.updateAllCompanionsPlayState(ROOM_ID, true))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('updateAllCompanionPreset throws when room state is missing', async () => {
    await expect(service.updateAllCompanionPreset(ROOM_ID, 'jazz', 2))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('setCompanionChordLength throws when room state is missing', async () => {
    await expect(service.setCompanionChordLength(ROOM_ID, 4))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('setCompanionChordProgression throws when room state is missing', async () => {
    const progression = {
      mode: 'manual' as const,
      chords: [{ degree: 1, durationBars: 1 as const }, { degree: 5, durationBars: 1 as const }],
      barsPerChord: 2 as const,
      currentChordIndex: 0,
    };
    await expect(service.setCompanionChordProgression(ROOM_ID, progression))
      .rejects.toThrow('Perform room state not found');
    expect(mockRedisClient.set!).not.toHaveBeenCalled();
  });

  it('setCompanionChordProgression persists a manual progression', async () => {
    const existingState = {
      roomId: ROOM_ID,
      roomType: 'perform' as const,
      userStates: [],
      recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
      broadcastStates: {},
      voiceStates: {},
      occupancy: new Map(),
      companions: [],
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companionChordLength: 2,
      companionProgressionFlavor: 'diatonic',
      companionChordProgression: { mode: 'random' as const, chords: [], barsPerChord: 1 as const, currentChordIndex: 0 },
      lastUpdated: new Date().toISOString(),
    };
    mockRedisClient.get!.mockResolvedValue(existingState);
    void mockRedisClient.set!.mockResolvedValue('OK');

    const progression = {
      mode: 'manual' as const,
      chords: [{ degree: 1, durationBars: 1 as const }, { degree: 5, durationBars: 1 as const }],
      barsPerChord: 2 as const,
      currentChordIndex: 0,
    };
    const updated = await service.setCompanionChordProgression(ROOM_ID, progression);
    expect(updated.companionChordProgression.mode).toBe('manual');
    expect(updated.companionChordProgression.chords).toHaveLength(2);
    expect(mockRedisClient.set!).toHaveBeenCalledTimes(1);
  });

  it('updateCompanion with valid state still updates correctly', async () => {
    const existingState = {
      roomId: ROOM_ID,
      roomType: 'perform' as const,
      userStates: [],
      recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
      broadcastStates: {},
      voiceStates: {},
      companions: [COMPANION_STUB],
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companionChordLength: 2,
      companionProgressionFlavor: 'diatonic',
      lastUpdated: new Date().toISOString(),
    };
void mockRedisClient.get!.mockResolvedValue(existingState);
void mockRedisClient.set!.mockResolvedValue('OK');

    const result = await service.updateCompanion(ROOM_ID, 'c1', { volume: -6 });

    expect(result.companions[0]!.volume).toBe(-6);
    expect(mockRedisClient.set!).toHaveBeenCalledTimes(1);
  });
});
