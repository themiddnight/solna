import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';

describe('ArrangeRoomStateService - Project Metadata', () => {
  let service: ArrangeRoomStateService;
  const roomId = 'test-room-id';
  const projectId = 'test-project-id';
  const projectOwnerId = 'owner-user-id';

  beforeEach(async () => {
    service = new ArrangeRoomStateService();
    await service.initializeState(roomId);
  });

  describe('setProjectMetadata', () => {
    it('should set project metadata correctly', async () => {
      const updatedState = await service.setProjectMetadata(
        roomId,
        projectId,
        projectOwnerId,
        true
      );

      expect(updatedState.projectId).toBe(projectId);
      expect(updatedState.projectOwnerId).toBe(projectOwnerId);
      expect(updatedState.hasBeenSaved).toBe(true);
    });

    it('should set hasBeenSaved to true by default', async () => {
      const updatedState = await service.setProjectMetadata(
        roomId,
        projectId,
        projectOwnerId
      );

      expect(updatedState.hasBeenSaved).toBe(true);
    });

    it('should allow setting hasBeenSaved to false', async () => {
      const updatedState = await service.setProjectMetadata(
        roomId,
        projectId,
        projectOwnerId,
        false
      );

      expect(updatedState.hasBeenSaved).toBe(false);
    });
  });

  describe('getProjectMetadata', () => {
    it('should return project metadata when set', async () => {
      await service.setProjectMetadata(roomId, projectId, projectOwnerId, true);

      const metadata = await service.getProjectMetadata(roomId);

      expect(metadata).not.toBeNull();
      expect(metadata?.projectId).toBe(projectId);
      expect(metadata?.projectOwnerId).toBe(projectOwnerId);
      expect(metadata?.hasBeenSaved).toBe(true);
    });

    it('should return null for non-existent room', async () => {
      const metadata = await service.getProjectMetadata('non-existent-room');

      expect(metadata).toBeNull();
    });

    it('should return undefined projectId and projectOwnerId when not set', async () => {
      const metadata = await service.getProjectMetadata(roomId);

      expect(metadata).not.toBeNull();
      expect(metadata?.projectId).toBeUndefined();
      expect(metadata?.projectOwnerId).toBeUndefined();
      expect(metadata?.hasBeenSaved).toBe(false); // Default from initializeState
    });
  });

  describe('markProjectAsSaved', () => {
    it('should mark project as saved and set projectId', async () => {
      const updatedState = await service.markProjectAsSaved(roomId, projectId);

      expect(updatedState.projectId).toBe(projectId);
      expect(updatedState.hasBeenSaved).toBe(true);
    });

    it('should update existing projectId', async () => {
      await service.setProjectMetadata(roomId, 'old-project-id', projectOwnerId, false);

      const updatedState = await service.markProjectAsSaved(roomId, 'new-project-id');

      expect(updatedState.projectId).toBe('new-project-id');
      expect(updatedState.hasBeenSaved).toBe(true);
    });
  });

  describe('clearProjectMetadata', () => {
    it('should clear projectId and projectOwnerId', async () => {
      await service.setProjectMetadata(roomId, projectId, projectOwnerId, true);

      const clearedState = await service.clearProjectMetadata(roomId);

      expect(clearedState.projectId).toBeUndefined();
      expect(clearedState.projectOwnerId).toBeUndefined();
      expect(clearedState.hasBeenSaved).toBe(false);
    });

    it('should throw error for non-existent room', async () => {
      await expect(
        service.clearProjectMetadata('non-existent-room')
      ).rejects.toThrow('Room state not found');
    });
  });

  describe('initializeState', () => {
    it('should initialize with hasBeenSaved as false', async () => {
      const newRoomId = 'new-room-id';
      const state = await service.initializeState(newRoomId);

      expect(state.hasBeenSaved).toBe(false);
      expect(state.projectId).toBeUndefined();
      expect(state.projectOwnerId).toBeUndefined();
    });
  });

  describe('Integration: Full save workflow', () => {
    it('should handle complete save workflow', async () => {
      // 1. Room starts with no project
      let metadata = await service.getProjectMetadata(roomId);
      expect(metadata?.hasBeenSaved).toBe(false);

      // 2. User saves project for first time
      await service.setProjectMetadata(roomId, projectId, projectOwnerId, true);
      metadata = await service.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(projectId);
      expect(metadata?.hasBeenSaved).toBe(true);

      // 3. User saves again (overwrite)
      await service.markProjectAsSaved(roomId, projectId);
      metadata = await service.getProjectMetadata(roomId);
      expect(metadata?.hasBeenSaved).toBe(true);

      // 4. Clear project (new project)
      await service.clearProjectMetadata(roomId);
      metadata = await service.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBeUndefined();
      expect(metadata?.hasBeenSaved).toBe(false);
    });
  });
});
