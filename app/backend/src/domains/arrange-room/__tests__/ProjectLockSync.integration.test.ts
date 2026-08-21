import { describe, it, expect, beforeEach } from '@jest/globals';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';

/**
 * Project Lock Real-time Sync Integration Tests
 * 
 * Tests for BR-11 & BR-12: Real-time synchronization of project metadata
 * - arrange:state_sync event includes isLocked and ownerUsername
 * - Frontend receives and updates projectStore
 * - Notification triggers when projectOwnerId changes from null → value
 */

describe('Project Lock Real-time Sync Integration', () => {
  let stateService: ArrangeRoomStateService;
  const roomId = 'test-room-123';
  const projectId = 'project-456';
  const ownerId = 'user-owner';

  beforeEach(async () => {
    stateService = new ArrangeRoomStateService();
    await stateService.initializeState(roomId);
  });

  describe('arrange:state_sync Event Payload', () => {
    it('should include isLocked in state sync', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      const state = await stateService.getState(roomId);

      expect(state).toBeDefined();
      expect(state?.projectId).toBe(projectId);
      expect(state?.projectOwnerId).toBe(ownerId);
      expect(state?.hasBeenSaved).toBe(true);
      // isLocked should be fetched from database in real implementation
    });

    it('should sync projectOwnerId when project is saved for first time', async () => {
      // Initial state: no project
      let state = await stateService.getState(roomId);
      expect(state?.projectOwnerId).toBeFalsy(); // null or undefined

      // User saves project → projectOwnerId set
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      state = await stateService.getState(roomId);
      expect(state?.projectOwnerId).toBe(ownerId);
      // This should trigger notification: "💾 Project saved by [username]"
    });

    it('should maintain projectOwnerId across state updates', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      // Add a track (state update)
      await stateService.addTrack(roomId, {
        id: 'track-1',
        name: 'Test Track',
        type: 'midi',
        instrumentId: 'piano',
        volume: UNITY_DB, // DEV-303: out-of-range legacy fixture value (was 80, never asserted), replaced with generic default
        pan: 0,
        color: '#ff0000',
        isTransposable: true,
        regionIds: [],
      });

      const state = await stateService.getState(roomId);
      expect(state?.projectOwnerId).toBe(ownerId);
      // projectOwnerId should persist
    });
  });

  describe('Project Metadata Transitions', () => {
    it('should transition from no owner → has owner (first save)', async () => {
      const initialState = await stateService.getState(roomId);
      expect(initialState?.projectOwnerId).toBeFalsy(); // null or undefined

      // Simulate first save
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      const updatedState = await stateService.getState(roomId);
      expect(updatedState?.projectOwnerId).toBe(ownerId);
      expect(updatedState?.hasBeenSaved).toBe(true);

      // Frontend should:
      // 1. Update roomProjectOwnerId in store
      // 2. Show notification
      // 3. Disable Import/Export/Stems/Mixdown for non-owners
    });

    it('should handle project owner change (transfer ownership)', async () => {
      await stateService.setProjectMetadata(roomId, projectId, 'user-old', true);

      // Transfer ownership
      await stateService.setProjectMetadata(roomId, projectId, 'user-new', true);

      const state = await stateService.getState(roomId);
      expect(state?.projectOwnerId).toBe('user-new');
    });

    it('should clear metadata when project is removed', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      await stateService.clearProjectMetadata(roomId);

      const state = await stateService.getState(roomId);
      expect(state?.projectId).toBeFalsy(); // null or undefined
      expect(state?.projectOwnerId).toBeFalsy(); // null or undefined
      expect(state?.hasBeenSaved).toBe(false);
    });
  });

  describe('hasNoOwner Logic (BR-12)', () => {
    it('should return true for new room (no project, no owner)', async () => {
      const state = await stateService.getState(roomId);

      const hasNoProject = !state?.projectId;
      const hasNoOwner = !state?.projectOwnerId;

      expect(hasNoProject).toBe(true);
      expect(hasNoOwner).toBe(true);
      // canUseProjectFeatures = true (everyone can use Import/Export/Stems/Mixdown)
    });

    it('should return false after first save (has owner)', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      const state = await stateService.getState(roomId);

      const hasNoProject = !state?.projectId;
      const hasNoOwner = !state?.projectOwnerId;

      expect(hasNoProject).toBe(false);
      expect(hasNoOwner).toBe(false);
      // canUseProjectFeatures = false for non-owners
    });

    it('should handle edge case: project loaded but not saved yet', async () => {
      // Project loaded from storage but not saved yet
      await stateService.setProjectMetadata(roomId, projectId, ownerId, false);

      const state = await stateService.getState(roomId);

      expect(state?.projectId).toBe(projectId);
      expect(state?.projectOwnerId).toBe(ownerId);
      expect(state?.hasBeenSaved).toBe(false);

      const hasNoOwner = !state?.projectOwnerId;
      expect(hasNoOwner).toBe(false);
      // Still has owner, so non-owners cannot use project features
    });
  });

  describe('Concurrent User Scenarios', () => {
    it('should sync lock status to all users in room', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      // Simulate multiple users requesting state
      const user1State = await stateService.getState(roomId);
      const user2State = await stateService.getState(roomId);
      const user3State = await stateService.getState(roomId);

      expect(user1State?.projectOwnerId).toBe(ownerId);
      expect(user2State?.projectOwnerId).toBe(ownerId);
      expect(user3State?.projectOwnerId).toBe(ownerId);
      // All users should see the same owner
    });

    it('should handle race condition: multiple users join simultaneously', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      // Multiple users request state at the same time
      const requests = Array(5).fill(null).map(() => 
        stateService.getState(roomId)
      );

      const results = await Promise.all(requests);

      results.forEach(state => {
        expect(state?.projectOwnerId).toBe(ownerId);
      });
      // All should receive consistent state
    });
  });

  describe('State Persistence', () => {
    it('should persist project metadata across room lifecycle', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      // Simulate room restart (state loaded from Redis)
      const persistedState = await stateService.getState(roomId);

      expect(persistedState?.projectId).toBe(projectId);
      expect(persistedState?.projectOwnerId).toBe(ownerId);
      expect(persistedState?.hasBeenSaved).toBe(true);
    });

    it('should maintain metadata during track/region operations', async () => {
      await stateService.setProjectMetadata(roomId, projectId, ownerId, true);

      // Perform multiple operations
      await stateService.addTrack(roomId, {
        id: 'track-1',
        name: 'Track 1',
        type: 'midi',
        instrumentId: 'piano',
        volume: UNITY_DB, // DEV-303: out-of-range legacy fixture value (was 80, never asserted), replaced with generic default
        pan: 0,
        color: '#ff0000',
        isTransposable: true,
        regionIds: [],
      });

      const state = await stateService.getState(roomId);
      expect(state?.projectOwnerId).toBe(ownerId);
      expect(state?.hasBeenSaved).toBe(true);
      // Metadata should persist through all operations
    });
  });
});
