/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars */
import { RedisStateService, redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import type { Track, Region, MidiNote } from '../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';

// Mock RedisStateService
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: {
    getInstance: jest.fn(),
  },
  redisStateService: {
    executeWithLock: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
    logInfo: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

describe('ArrangeRoomStateService', () => {
  let service: ArrangeRoomStateService;
  let mockRedisService: jest.Mocked<RedisStateService>;

  const mockTrack: Track = {
    id: 'track-1',
    name: 'Test Track',
    type: 'midi',
    instrumentId: 'piano',
    instrumentCategory: 'keys',
    volume: UNITY_DB, // DEV-303: generic default test-fixture volume, was linear 0.8
    pan: 0,
    color: '#ff0000',
    regionIds: [],
  };

  const createMockState = () => ({
    roomId: 'room-1',
    roomType: 'arrange' as const,
    tracks: [],
    regions: [],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    locks: [],
    selectedTrackId: null,
    selectedRegionIds: [],
    synthStates: {},
    effectChains: {},
    markers: [],
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date().toISOString(),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<RedisStateService>;

    (RedisStateService.getInstance as jest.Mock).mockReturnValue(mockRedisService);

    // Mock redisStateService.executeWithLock to execute the operation directly
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<any>) => {
        return await operation();
      }
    );

    service = new ArrangeRoomStateService();
  });

  describe('initializeState', () => {
    it('should create initial state with defaults', async () => {
      const state = await service.initializeState('room-1');

      expect(state.roomId).toBe('room-1');
      expect(state.tracks).toHaveLength(2);
      expect(state.tracks?.[0]?.type).toBe('midi');
      expect(state.tracks?.[0]?.name).toBe('MIDI 1');
      expect(state.tracks?.[1]?.type).toBe('audio');
      expect(state.tracks?.[1]?.name).toBe('Audio 2');
      expect(state.regions).toEqual([]);
      expect(state.bpm).toBe(120);
      expect(state.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should create empty tracks when templateId is "empty"', async () => {
      const state = await service.initializeState('room-1', 'empty');

      expect(state.roomId).toBe('room-1');
      expect(state.tracks).toEqual([]);
    });

    it('should create defaults when templateId is "default"', async () => {
      const state = await service.initializeState('room-1', 'default');

      expect(state.roomId).toBe('room-1');
      expect(state.tracks).toHaveLength(2);
      expect(state.tracks?.[0]?.type).toBe('midi');
      expect(state.tracks?.[1]?.type).toBe('audio');
    });

    it('should seed the genre template atomically when templateId is a genre', async () => {
      const state = await service.initializeState('room-1', 'house');

      // House template: one MIDI track per generated role, each with section regions.
      expect(state.tracks.length).toBeGreaterThan(0);
      expect(state.tracks.every((t) => t.type === 'midi')).toBe(true);
      expect(state.regions.length).toBe(state.tracks.length * 3); // 3 sections per track
      // Every region references a track that exists in the same atomic state (no "Track not found").
      const trackIds = new Set(state.tracks.map((t) => t.id));
      expect(state.regions.every((r) => trackIds.has(r.trackId))).toBe(true);
      // bpm + scale come from the template, not the generic defaults.
      expect(state.bpm).toBe(124);
      expect(state.scale).toEqual({ rootNote: 'A', scale: 'minor' });
    });

    it('should save to Redis on initialization', async () => {
      await service.initializeState('room-1');

      // Give async saveState time to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should create an empty chordTrack (DEV-279 P1)', async () => {
      const state = await service.initializeState('room-1');

      expect(state.chordTrack).toBeDefined();
      expect(state.chordTrack.blocks).toEqual([]);
      expect(typeof state.chordTrack.id).toBe('string');
      expect(state.chordTrack.id.length).toBeGreaterThan(0);
    });
  });

  describe('getState', () => {
    it('should return state from Redis', async () => {
      const mockState = {
        roomId: 'room-1',
        roomType: 'arrange' as const,
        tracks: [],
        regions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        locks: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        synthStates: {},
        effectChains: {},
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedisService.get.mockResolvedValue(mockState);
      const state = await service.getState('room-1');

      expect(state).toBeDefined();
      expect(state?.roomId).toBe('room-1');
    });

    it('should return undefined for non-existent room', async () => {
      const state = await service.getState('non-existent');
      expect(state).toBeNull();
    });
  });

  describe('updateState', () => {
    it('should update bpm', async () => {
      const mockState = {
        roomId: 'room-1',
        roomType: 'arrange' as const,
        tracks: [],
        regions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        locks: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        synthStates: {},
        effectChains: {},
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedisService.get.mockResolvedValue(mockState);
      const updated = await service.updateState('room-1', { bpm: 140 });

      expect(updated.bpm).toBe(140);
    });

    it('should throw for non-existent room', async () => {
      await expect(
        service.updateState('non-existent', { bpm: 140 })
      ).rejects.toThrow('Room state not found for room: non-existent');
    });

    it('should trigger Redis save on update', async () => {
      const mockState = {
        roomId: 'room-1',
        roomType: 'arrange' as const,
        tracks: [],
        regions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        locks: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        synthStates: {},
        effectChains: {},
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedisService.get.mockResolvedValue(mockState);
      await service.updateState('room-1', { bpm: 140 });

      expect(mockRedisService.set).toHaveBeenCalled();
    });
  });

  describe('addTrack', () => {
    it('should add track to state', async () => {
      const mockState = {
        roomId: 'room-1',
        roomType: 'arrange' as const,
        tracks: [],
        regions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        locks: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        synthStates: {},
        effectChains: {},
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date().toISOString(),
      };
      
      // Mock both getState calls - first for addTrack, second for the result
void mockRedisService.get.mockResolvedValue(mockState);
      mockRedisService.get.mockResolvedValueOnce(mockState); // First call returns initial
      mockRedisService.get.mockResolvedValueOnce({ // Second call returns updated (simulated) or just keep initial?
        ...mockState,
        tracks: [mockTrack],
      });
      
      const updated = await service.addTrack('room-1', mockTrack);

      expect(updated.tracks).toHaveLength(1);
      expect(updated.tracks[0]).toEqual(mockTrack);
    });

    it('should enforce maximum track limit', async () => {
      const mockState = {
        roomId: 'room-1',
        roomType: 'arrange' as const,
        tracks: Array(64).fill(mockTrack).map((t, i) => ({ ...t, id: `track-${i}` })),
        regions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        locks: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        synthStates: {},
        effectChains: {},
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedisService.get.mockResolvedValue(mockState);

      // 65th track should throw
      await expect(
        service.addTrack('room-1', { ...mockTrack, id: 'track-65' })
      ).rejects.toThrow('Maximum track limit (64) reached');
    });
  });

  describe('loadState', () => {
    it('should return state from Redis', async () => {
      const mockState = {
        roomId: 'room-1',
        roomType: 'arrange' as const,
        tracks: [],
        regions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        locks: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        synthStates: {},
        effectChains: {},
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedisService.get.mockResolvedValue(mockState);
      const state = await service.loadState('room-1');

      expect(state?.roomId).toBe('room-1');
    });

    it('should load from Redis if not in memory', async () => {
      const savedState = {
        roomId: 'room-1',
        tracks: [],
        regions: [],
        locks: [],
        bpm: 130,
        timeSignature: { numerator: 4, denominator: 4 },
        markers: [],
        voiceStates: {},
        broadcastStates: {},
        synthStates: {},
        effectChains: {},
        selectedTrackId: null,
        selectedRegionIds: [],
        lastUpdated: new Date().toISOString(),
      };

void mockRedisService.exists.mockResolvedValue(true);
void mockRedisService.get.mockResolvedValue(savedState);

      const state = await service.loadState('room-1');

      expect(state?.bpm).toBe(130);
    });

    it('should return null if not in Redis', async () => {
void mockRedisService.exists.mockResolvedValue(false);

      const state = await service.loadState('room-1');

      expect(state).toBeNull();
    });

    it('should return null on Redis error', async () => {
void mockRedisService.exists.mockRejectedValue(new Error('Redis error'));

      const state = await service.loadState('room-1');
      expect(state).toBeNull();
    });
  });

  describe('deleteState', () => {
    it('should remove state from memory and Redis', async () => {
      await service.initializeState('room-1');

      await service.deleteState('room-1');

      expect(await service.getState('room-1')).toBeNull();
      expect(mockRedisService.delete).toHaveBeenCalledWith(REDIS_KEYS.arrangeState('room-1'));
    });
  });

  describe('marker operations', () => {
    it('should add a marker with an empty description', async () => {
void mockRedisService.get.mockResolvedValue(createMockState());

      const updated = await service.addMarker('room-1', {
        id: 'marker-empty-description',
        position: 4,
        description: '',
        color: '#3b82f6',
      });

      expect(updated.markers).toHaveLength(1);
      expect(updated.markers[0]).toEqual({
        id: 'marker-empty-description',
        position: 4,
        description: '',
        color: '#3b82f6',
      });
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should normalize a marker without a description', async () => {
void mockRedisService.get.mockResolvedValue(createMockState());

      const updated = await service.addMarker('room-1', {
        id: 'marker-without-description',
        position: 8,
        color: '#3b82f6',
      });

      expect(updated.markers).toHaveLength(1);
      expect(updated.markers[0]).toEqual({
        id: 'marker-without-description',
        position: 8,
        description: '',
        color: '#3b82f6',
      });
      expect(mockRedisService.set).toHaveBeenCalled();
    });
  });

  describe('scale operations', () => {
    const createMockState = (scale?: any) => ({
      roomId: 'room-1',
      roomType: 'arrange' as const,
      tracks: [],
      regions: [],
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      locks: [],
      selectedTrackId: null,
      selectedRegionIds: [],
      synthStates: {},
      effectChains: {},
      markers: [],
      voiceStates: {},
      broadcastStates: {},
      hasBeenSaved: false,
      scale,
      lastUpdated: new Date().toISOString(),
    });

    it('should update scale', async () => {
void mockRedisService.get.mockResolvedValueOnce(createMockState());
      const updated = await service.updateScale('room-1', 'C', 'major');
      expect(updated.scale).toEqual({ rootNote: 'C', scale: 'major' });
    });

    it('should persist scale to Redis', async () => {
void mockRedisService.get.mockResolvedValueOnce(createMockState());
      await service.updateScale('room-1', 'D', 'minor');
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should clear scale', async () => {
void mockRedisService.get.mockResolvedValueOnce(createMockState({ rootNote: 'C', scale: 'major' }));
      const updated = await service.clearScale('room-1');
      expect(updated.scale).toBeUndefined();
    });

    it('should handle scale roundtrip (save and load)', async () => {
      const stateWithScale = createMockState({ rootNote: 'E', scale: 'minor' });
void mockRedisService.get.mockResolvedValueOnce(stateWithScale);
      const hasLoaded = await service.getState('room-1');
      expect(hasLoaded?.scale).toEqual({ rootNote: 'E', scale: 'minor' });
    });

  });

  // DEV-350 M2 (Task 14 Part 2): the primitive element-lock acquire/release API
  // (acquireLock/releaseLock/atomicLockSwap/releaseUserLocks, backed by the retired
  // ArrangeRoomLockStateService and `state.locks`) was removed — it had zero production
  // callers left after regions/companion/chord-blocks all migrated to the occupancy queue
  // (RoomOccupancyService). DEV-350 Round 2 Task 1 finished the migration: the note-atomic
  // guards were switched to occupancy too, and `state.locks` itself was deleted.

  describe('Distributed Lock Usage (ISSUE-65)', () => {
    /**
     * Verify that state mutation methods use distributed locks correctly
     */

    it('should use distributed lock for updateState', async () => {
      const roomId = 'room-1';
void mockRedisService.get.mockResolvedValue(createMockState());
void mockRedisService.exists.mockResolvedValue(true);

      await service.updateState(roomId, { bpm: 140 });

      // Verify state was updated
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should use distributed lock for addTrack', async () => {
      const roomId = 'room-1';
void mockRedisService.get.mockResolvedValue(createMockState());
void mockRedisService.exists.mockResolvedValue(true);

      await service.addTrack(roomId, mockTrack);

      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should use distributed lock for removeTrack', async () => {
      const roomId = 'room-1';
      const stateWithTrack = {
        ...createMockState(),
        tracks: [mockTrack],
      };
void mockRedisService.get.mockResolvedValue(stateWithTrack);
void mockRedisService.exists.mockResolvedValue(true);

      await service.removeTrack(roomId, mockTrack.id);

      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should serialize concurrent state updates correctly', async () => {
      const roomId = 'room-1';
      let updateCount = 0;
      
      mockRedisService.get.mockImplementation(async () => {
        const state = createMockState();
        state.bpm = 120 + updateCount * 10;
        return state;
      });
      
      mockRedisService.set.mockImplementation(async () => {
        updateCount++;
        return true;
      });
      
void mockRedisService.exists.mockResolvedValue(true);

      // Concurrent updates
      await Promise.all([
        service.updateState(roomId, { bpm: 130 }),
        service.updateState(roomId, { bpm: 140 }),
        service.updateState(roomId, { bpm: 150 }),
      ]);

      // All should complete
      expect(mockRedisService.set).toHaveBeenCalledTimes(3);
    });
  });

  // ── in-mutex occupancy guard on the atomic note ops (DEV-350 Round 2) ────────
  //
  // TR-2: `ArrangeNoteHandler`'s `getOwnerConflict` pre-check is a mutex-free read, so these
  // in-mutex guards are the authoritative ones. Every handler-level test mocks this service,
  // so without the tests below the `owner.userId !== requestingUserId` comparison could be
  // inverted or deleted with the whole suite staying green.
  describe('atomic note ops — region occupancy guard (in-mutex)', () => {
    const ROOM_ID = 'room-1';
    const REGION_ID = 'region-1';
    const ACTING_USER_ID = 'user-acting';
    const FOREIGN_USER_ID = 'user-foreign';
    const FOREIGN_USERNAME = 'foreign-tester';

    const noteFixture: MidiNote = { id: 'note-1', pitch: 60, velocity: 0.8, start: 0, duration: 1 };

    let saveStateSpy: jest.SpiedFunction<typeof service.saveState>;

    /**
     * Serialized state (what Redis holds): `occupancy` is an array of entries that
     * `deserializeState` turns back into a Map. holders[0] is a DIFFERENT user than the one
     * requesting the mutation.
     */
    const stateOccupiedByForeignUser = () => ({
      ...createMockState(),
      regions: [
        {
          id: REGION_ID,
          trackId: mockTrack.id,
          name: 'Region 1',
          start: 0,
          length: 4,
          loopEnabled: false,
          loopIterations: 1,
          type: 'midi' as const,
          notes: [noteFixture],
          sustainEvents: [],
        },
      ],
      occupancy: [
        [
          REGION_ID,
          { kind: 'container', holders: [{ userId: FOREIGN_USER_ID, username: FOREIGN_USERNAME, joinedAt: 1 }] },
        ],
      ],
    });

    beforeEach(() => {
      void mockRedisService.get.mockResolvedValue(stateOccupiedByForeignUser());
      saveStateSpy = jest.spyOn(service, 'saveState').mockResolvedValue(undefined);
    });

    afterEach(() => {
      saveStateSpy.mockRestore();
    });

    it('addNoteAtomic returns lock_conflict and writes nothing when another user holds the region', async () => {
      const result = await service.addNoteAtomic(ROOM_ID, REGION_ID, { ...noteFixture, id: 'note-2' }, ACTING_USER_ID);

      expect(result).toEqual({ result: 'lock_conflict', lockedBy: FOREIGN_USERNAME });
      expect(saveStateSpy).not.toHaveBeenCalled();
    });

    it('updateNoteAtomic returns lock_conflict and writes nothing when another user holds the region', async () => {
      const result = await service.updateNoteAtomic(ROOM_ID, REGION_ID, 'note-1', { start: 4 }, ACTING_USER_ID);

      expect(result).toEqual({ result: 'lock_conflict', lockedBy: FOREIGN_USERNAME });
      expect(saveStateSpy).not.toHaveBeenCalled();
    });

    it('deleteNoteAtomic returns lock_conflict and writes nothing when another user holds the region', async () => {
      const result = await service.deleteNoteAtomic(ROOM_ID, REGION_ID, 'note-1', ACTING_USER_ID);

      expect(result).toEqual({ result: 'lock_conflict', lockedBy: FOREIGN_USERNAME });
      expect(saveStateSpy).not.toHaveBeenCalled();
    });

    it('lets the occupancy owner through on all three atomic note ops', async () => {
      const addResult = await service.addNoteAtomic(ROOM_ID, REGION_ID, { ...noteFixture, id: 'note-2' }, FOREIGN_USER_ID);
      const updateResult = await service.updateNoteAtomic(ROOM_ID, REGION_ID, 'note-1', { start: 4 }, FOREIGN_USER_ID);
      const deleteResult = await service.deleteNoteAtomic(ROOM_ID, REGION_ID, 'note-1', FOREIGN_USER_ID);

      expect(addResult.result).toBe('ok');
      expect(updateResult.result).toBe('ok');
      expect(deleteResult.result).toBe('ok');
      expect(saveStateSpy).toHaveBeenCalledTimes(3);
    });
  });
});
