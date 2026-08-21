/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Integration Tests for Arrange Room Management
 * Tests the complete arrange room lifecycle with collaborative production features
 */
import { RoomLifecycleService } from '../../room-management/application/RoomLifecycleService';
import { RoomMembershipService } from '../../room-management/application/RoomMembershipService';
import { RoomSessionManager } from '../../room-management/infrastructure/services/RoomSessionManager';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { RoomRepository } from '../../room-management/infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../../room-management/domain/services/RoomCleanupService';
import { RoomUserService } from '../../room-management/domain/services/RoomUserService';
import { RoomSettingsService } from '../../room-management/infrastructure/services/RoomSettingsService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import type { User } from '../../../types';
import { RoomType } from '../../../types';
import { createTestTrack, createTestMidiRegion, createTestAudioRegion } from './fixtures/arrangeRoomTestDataFixture';
import { toDecibels } from '../domain/models/ArrangeRoomState';

describe('Arrange Room Management Integration Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomMembershipService: RoomMembershipService;
  let roomSessionManager: RoomSessionManager;
  let namespaceGracePeriodManager: NamespaceGracePeriodManager;
  let arrangeRoomStateService: ArrangeRoomStateService;
  let roomRepository: RoomRepository;
  let roomCleanupService: RoomCleanupService;
  let roomUserService: RoomUserService;
  let roomSettingsService: RoomSettingsService;
  let effectChainService: EffectChainService;
  let createdRoomIds: string[] = [];

  beforeAll(async () => {
    roomSessionManager = new RoomSessionManager();
    namespaceGracePeriodManager = new NamespaceGracePeriodManager();
    roomRepository = new RoomRepository();
    roomCleanupService = new RoomCleanupService(roomRepository);
    roomUserService = new RoomUserService(roomRepository, roomCleanupService);
    roomSettingsService = new RoomSettingsService(roomRepository);
    effectChainService = new EffectChainService(roomRepository);
    arrangeRoomStateService = new ArrangeRoomStateService();

    roomLifecycleService = new RoomLifecycleService(
      roomRepository,
      roomCleanupService,
      roomSessionManager,
      namespaceGracePeriodManager,
      arrangeRoomStateService,
      effectChainService,
      roomUserService,
      roomSettingsService
    );

    roomMembershipService = new RoomMembershipService(
      roomRepository,
      roomUserService,
      effectChainService,
      roomSessionManager
    );
  });

  afterEach(async () => {
    // Clean up only created arrange rooms
    for (const roomId of createdRoomIds) {
      try {
        await roomLifecycleService.deleteRoom(roomId);
      } catch (_error) {
        // Ignore errors if room already deleted
      }
    }
    createdRoomIds = [];
  });

  afterAll(async () => {
    // Cleanup after tests
    namespaceGracePeriodManager.shutdown();

    // Disconnect Redis client to prevent open handles
    const { redisStateService } = await import('../../../shared/infrastructure/caching/RedisStateService');
    await redisStateService.disconnect();
  });

  describe('Arrange Room Creation and Management', () => {
    it('should create an arrange room successfully', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Production Room',
        'Producer',
        'producer-123',
        false,
        false,
        'Arrange collaboration room',
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);

      expect(roomData.room).toBeDefined();
      expect(roomData.user).toBeDefined();
      expect(roomData.room.roomType).toBe(RoomType.ARRANGE);
      expect(roomData.room.name).toBe('Production Room');
      expect(roomData.room.owner).toBe('producer-123');
      expect(roomData.user.username).toBe('Producer');
      expect(roomData.user.role).toBe('room_owner');
    });

    it('should initialize arrange room state on creation', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Arrange Room',
        'Owner',
        'owner-456',
        false,
        false,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);

      await arrangeRoomStateService.initializeState(roomData.room.id);
      const state = await arrangeRoomStateService.getState(roomData.room.id);

      expect(state).toBeDefined();
      expect(state?.tracks).toHaveLength(2);
      expect(state?.tracks[0]?.type).toBe('midi');
      expect(state?.tracks[1]?.type).toBe('audio');
      expect(state?.regions).toEqual([]);
      expect(state?.bpm).toBe(120);
      expect(state?.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should handle multiple users in arrange room', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'COLLAB - Jam Band Room',
        'owner',
        'owner-789',
        false,
        false,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);

      const users: User[] = [
        { id: 'user1', username: 'Producer1', role: 'band_member', isReady: true },
        { id: 'user2', username: 'Producer2', role: 'band_member', isReady: true },
        { id: 'user3', username: 'Listener', role: 'audience', joinedAt: new Date() },
      ];

      for (const user of users) {
        const isAdded = await roomMembershipService.addUserToRoom(roomData.room.id, user);
        expect(isAdded).toBe(true);
        // Verify room has users
        const roomMembers = await roomMembershipService.getBandMembers(roomData.room.id);
        expect(roomMembers.length).toBeGreaterThan(0);
      }

      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const audiences = await roomMembershipService.getAudiences(roomData.room.id);
      expect(bandMembers.length + audiences.length).toBe(4); // 3 users + 1 owner
    });
  });

  describe('Track Management', () => {
    let roomId: string;

    beforeEach(async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Track Test Room',
        'owner',
        'owner-track',
        false,
        false,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);
      roomId = roomData.room.id;
      await arrangeRoomStateService.initializeState(roomId, 'empty');
    });

    it('should add tracks to arrange room', async () => {
      const track = createTestTrack({ id: 'track-1', name: 'Piano Track' });

      await arrangeRoomStateService.addTrack(roomId, track);
      const state = await arrangeRoomStateService.getState(roomId);

      expect(state?.tracks).toHaveLength(1);
      expect(state?.tracks[0]?.id).toBe('track-1');
      expect(state?.tracks[0]?.name).toBe('Piano Track');
    });

    it('should update track properties', async () => {
      const track = createTestTrack({ id: 'track-1', name: 'Original Name' });

      await arrangeRoomStateService.addTrack(roomId, track);
      await arrangeRoomStateService.updateTrack(roomId, 'track-1', {
        name: 'Updated Name',
        volume: toDecibels(0.5),
      });

      const state = await arrangeRoomStateService.getState(roomId);
      const updatedTrack = state?.tracks.find(t => t.id === 'track-1');

      expect(updatedTrack?.name).toBe('Updated Name');
      expect(updatedTrack?.volume).toBe(0.5);
    });

    it('should remove tracks', async () => {
      const track1 = createTestTrack({ id: 'track-1', name: 'Track 1' });
      const track2 = createTestTrack({ id: 'track-2', name: 'Track 2', instrumentId: 'drums' });

      await arrangeRoomStateService.addTrack(roomId, track1);
      await arrangeRoomStateService.addTrack(roomId, track2);
      await arrangeRoomStateService.removeTrack(roomId, 'track-1');

      const state = await arrangeRoomStateService.getState(roomId);
      expect(state?.tracks).toHaveLength(1);
      expect(state?.tracks[0]?.id).toBe('track-2');
    });

    it('should reorder tracks', async () => {
      const tracks = [
        createTestTrack({ id: 'track-1', name: 'Track 1' }),
        createTestTrack({ id: 'track-2', name: 'Track 2', instrumentId: 'drums' }),
        createTestTrack({ id: 'track-3', name: 'Track 3', instrumentId: 'bass' }),
      ];

      for (const track of tracks) {
        await arrangeRoomStateService.addTrack(roomId, track);
      }
      await arrangeRoomStateService.reorderTracks(roomId, ['track-3', 'track-1', 'track-2']);

      const state = await arrangeRoomStateService.getState(roomId);
      expect(state?.tracks[0]?.id).toBe('track-3');
      expect(state?.tracks[1]?.id).toBe('track-1');
      expect(state?.tracks[2]?.id).toBe('track-2');
    });
  });

  describe('Region Management', () => {
    let roomId: string;
    let trackId: string;

    beforeEach(async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Region Test Room',
        'owner',
        'owner-region',
        false,
        false,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);
      roomId = roomData.room.id;
      await arrangeRoomStateService.initializeState(roomId, 'empty');


      trackId = 'track-1';
      await arrangeRoomStateService.addTrack(roomId, createTestTrack({ id: trackId }));
    });

    it('should add MIDI regions', async () => {
      const region = createTestMidiRegion({ id: 'region-1', trackId });

      await arrangeRoomStateService.addRegion(roomId, region);
      const state = await arrangeRoomStateService.getState(roomId);

      expect(state?.regions).toHaveLength(1);
      expect(state?.regions[0]?.type).toBe('midi');
    });

    it('should add audio regions', async () => {
      const region = createTestAudioRegion({ id: 'region-2', trackId, start: 4, length: 8 });

      await arrangeRoomStateService.addRegion(roomId, region);
      const state = await arrangeRoomStateService.getState(roomId);

      expect(state?.regions).toHaveLength(1);
      expect(state?.regions[0]?.type).toBe('audio');
      if (state?.regions[0]?.type === 'audio') {
        expect(state.regions[0].audioUrl).toBe('/audio/sample.wav');
      }
    });

    it('should update regions', async () => {
      const region = createTestMidiRegion({ id: 'region-1', trackId });

      await arrangeRoomStateService.addRegion(roomId, region);
      await arrangeRoomStateService.updateRegion(roomId, 'region-1', {
        start: 2,
        length: 6,
      });

      const state = await arrangeRoomStateService.getState(roomId);
      const updatedRegion = state?.regions.find(r => r.id === 'region-1');

      expect(updatedRegion?.start).toBe(2);
      expect(updatedRegion?.length).toBe(6);
    });

    it('should remove regions', async () => {
      const region1 = createTestMidiRegion({ id: 'region-1', trackId });
      const region2 = createTestMidiRegion({ id: 'region-2', trackId, start: 4 });

      await arrangeRoomStateService.addRegion(roomId, region1);
      await arrangeRoomStateService.addRegion(roomId, region2);
      await arrangeRoomStateService.removeRegion(roomId, 'region-1');

      const state = await arrangeRoomStateService.getState(roomId);
      expect(state?.regions).toHaveLength(1);
      expect(state?.regions[0]?.id).toBe('region-2');
    });
  });

  // DEV-350 M2 (Task 14 Part 2): the "Collaboration Features" primitive element-lock suite
  // (acquireLock/releaseLock/releaseUserLocks/isLocked, backed by the retired
  // ArrangeRoomLockStateService and `state.locks`) was removed along with that dead API —
  // regions/companion/chord-blocks now guard CRUD via the occupancy queue
  // (RoomOccupancyService), covered by ArrangeRegionHandler/ArrangeCompanionHandler/
  // ArrangeChordTrackHandler's own unit tests.

  describe('Transport and Timing', () => {
    let roomId: string;

    beforeEach(async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Transport Test Room',
        'owner',
        'owner-transport',
        false,
        false,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);
      roomId = roomData.room.id;
      await arrangeRoomStateService.initializeState(roomId, 'empty');
    });

    it('should update BPM', async () => {
      await arrangeRoomStateService.updateState(roomId, { bpm: 140 });
      const state = await arrangeRoomStateService.getState(roomId);

      expect(state?.bpm).toBe(140);
    });

    it('should update time signature', async () => {
      const timeSignature = { numerator: 3, denominator: 4 };
      await arrangeRoomStateService.updateState(roomId, { timeSignature });
      const state = await arrangeRoomStateService.getState(roomId);

      expect(state?.timeSignature).toEqual(timeSignature);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room operations gracefully', async () => {
      expect(await arrangeRoomStateService.getState('non-existent-room')).toBeNull();
    });

    it('should handle invalid track operations', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Error Test Room',
        'owner',
        'owner-error',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);
      await arrangeRoomStateService.initializeState(roomData.room.id, 'empty');

      // Try to update non-existent track - should not throw
      await expect(
        arrangeRoomStateService.updateTrack(roomData.room.id, 'non-existent-track', { volume: toDecibels(0.5) })
      ).resolves.toBeDefined();
    });

    it('should handle invalid region operations', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Error Test Room 2',
        'owner',
        'owner-error2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );
      createdRoomIds.push(roomData.room.id);
      await arrangeRoomStateService.initializeState(roomData.room.id, 'empty');

      // Try to update non-existent region - should throw error
      await expect(
        arrangeRoomStateService.updateRegion(roomData.room.id, 'non-existent-region', { start: 4 })
      ).rejects.toThrow();
    });
  });
});
