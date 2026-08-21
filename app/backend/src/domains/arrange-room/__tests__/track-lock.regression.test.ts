/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ArrangeTrackHandler } from '../infrastructure/handlers/sub-handlers/ArrangeTrackHandler';
import { ArrangeRegionHandler } from '../infrastructure/handlers/sub-handlers/ArrangeRegionHandler';
import { createTestTrack, createTestMidiRegion } from './fixtures/arrangeRoomTestDataFixture';
import { toDecibels } from '../domain/models/ArrangeRoomState';

describe('Arrange Track & Region Lock - Regression Tests', () => {
  let mockStateService: any;
  let mockAudioRegionStorageService: any;
  let mockArrangeRoomHandler: any;
  let mockSocket: any;
  let mockNamespace: any;
  let trackHandler: ArrangeTrackHandler;
  let regionHandler: ArrangeRegionHandler;

  const roomId = 'room-1';
  const ownerId = 'user-owner';
  const nonOwnerId = 'user-contributor';

  beforeEach(() => {
    mockStateService = {
      getState: jest.fn(),
      addTrack: jest.fn(),
      updateTrack: jest.fn(),
      removeTrack: jest.fn(),
      addRegion: jest.fn(),
      updateRegion: jest.fn(),
      removeRegion: jest.fn(),
      addNoteAtomic: jest.fn(),
      updateNoteAtomic: jest.fn(),
      deleteNoteAtomic: jest.fn(),
    };

    mockAudioRegionStorageService = {
      extractRegionIdFromPlaybackPath: jest.fn(),
      deleteRegionAudio: jest.fn(),
    };

    mockArrangeRoomHandler = {
      getStateService: () => mockStateService,
      getAudioRegionStorageService: () => mockAudioRegionStorageService,
      getSessionPublic: jest.fn(),
      scheduleEphemeralCommitPublic: jest.fn(),
      clearEphemeralCommitPublic: jest.fn(),
    };

    mockSocket = {
      id: 'socket-1',
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      data: {
        user: { id: ownerId, username: 'Owner', userType: 'registered' },
      },
    };

    mockNamespace = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    trackHandler = new ArrangeTrackHandler(mockArrangeRoomHandler);
    regionHandler = new ArrangeRegionHandler(mockArrangeRoomHandler);
  });

  describe('Track Handlers Lock Validation', () => {
    it('should block non-owner from updating a locked track', async () => {
      const track = createTestTrack({ id: 'track-1', isLocked: true, ownerId: ownerId });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: nonOwnerId,
        roomId: roomId,
      });

      await trackHandler.handleTrackUpdate(mockSocket, mockNamespace, {
        roomId,
        trackId: 'track-1',
        updates: { volume: toDecibels(0.5) },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        message: 'Track is locked',
      }));
      expect(mockStateService.updateTrack).not.toHaveBeenCalled();
    });

    it('should allow owner to update a locked track', async () => {
      const track = createTestTrack({ id: 'track-1', isLocked: true, ownerId: ownerId });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: ownerId,
        roomId: roomId,
      });

      await trackHandler.handleTrackUpdate(mockSocket, mockNamespace, {
        roomId,
        trackId: 'track-1',
        updates: { name: 'New Track Name' },
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(mockStateService.updateTrack).toHaveBeenCalledWith(roomId, 'track-1', { name: 'New Track Name' });
    });

    it('should block non-owner from toggling isLocked field on a track', async () => {
      const track = createTestTrack({ id: 'track-1', isLocked: false, ownerId: ownerId });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: nonOwnerId,
        roomId: roomId,
      });

      await trackHandler.handleTrackUpdate(mockSocket, mockNamespace, {
        roomId,
        trackId: 'track-1',
        updates: { isLocked: true },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        message: 'Only the project owner can lock/unlock tracks',
      }));
      expect(mockStateService.updateTrack).not.toHaveBeenCalled();
    });

    it('should allow project owner to lock/unlock template tracks (null/empty ownerId)', async () => {
      const track = createTestTrack({ id: 'track-template', isLocked: false, ownerId: null });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: ownerId,
        roomId: roomId,
      });

      await trackHandler.handleTrackUpdate(mockSocket, mockNamespace, {
        roomId,
        trackId: 'track-template',
        updates: { isLocked: true },
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(mockStateService.updateTrack).toHaveBeenCalledWith(roomId, 'track-template', { isLocked: true });
    });

    it('should allow project owner to lock/unlock tracks owned by other users', async () => {
      const track = createTestTrack({ id: 'track-other', isLocked: false, ownerId: nonOwnerId });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: ownerId,
        roomId: roomId,
      });

      await trackHandler.handleTrackUpdate(mockSocket, mockNamespace, {
        roomId,
        trackId: 'track-other',
        updates: { isLocked: true },
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(mockStateService.updateTrack).toHaveBeenCalledWith(roomId, 'track-other', { isLocked: true });
    });
  });

  describe('Region Handlers Lock Validation', () => {
    it('should block non-owner from adding a region to a locked track', async () => {
      const track = createTestTrack({ id: 'track-1', isLocked: true, ownerId: ownerId });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: nonOwnerId,
        roomId: roomId,
      });

      const newRegion = createTestMidiRegion({ id: 'region-new', trackId: 'track-1' });

      await regionHandler.handleRegionAdd(mockSocket, mockNamespace, {
        roomId,
        region: newRegion,
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        message: 'Track is locked',
      }));
      expect(mockStateService.addRegion).not.toHaveBeenCalled();
    });

    it('should block non-owner from updating a region on a locked track', async () => {
      const track = createTestTrack({ id: 'track-1', isLocked: true, ownerId: ownerId });
      const region = createTestMidiRegion({ id: 'region-1', trackId: 'track-1' });
      const state = {
        projectOwnerId: ownerId,
        tracks: [track],
        regions: [region],
      };

void mockStateService.getState.mockResolvedValue(state);
      mockArrangeRoomHandler.getSessionPublic.mockResolvedValue({
        userId: nonOwnerId,
        roomId: roomId,
      });

      await regionHandler.handleRegionUpdate(mockSocket, mockNamespace, {
        roomId,
        regionId: 'region-1',
        updates: { name: 'New Name' },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        message: 'Track is locked',
      }));
      expect(mockStateService.updateRegion).not.toHaveBeenCalled();
    });
  });
});
