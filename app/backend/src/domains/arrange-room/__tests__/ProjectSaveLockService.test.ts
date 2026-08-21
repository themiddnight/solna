import { ProjectSaveLockService } from '../infrastructure/services/ProjectSaveLockService';

describe('ProjectSaveLockService', () => {
  let service: ProjectSaveLockService;
  const projectId = 'test-project-id';
  const userId1 = 'user-1';
  const userId2 = 'user-2';
  const username1 = 'Alice';
  const username2 = 'Bob';

  beforeEach(() => {
    service = new ProjectSaveLockService();
  });

  describe('acquireLock', () => {
    it('should acquire lock when no lock exists and return lock info', () => {
      const lockInfo = service.acquireLock(projectId, userId1, username1);
      expect(lockInfo).not.toBeNull();
      expect(lockInfo?.userId).toBe(userId1);
      expect(lockInfo?.username).toBe(username1);
      expect(lockInfo?.lockedAt).toBeDefined();
    });

    it('should acquire lock when locked by same user', () => {
void service.acquireLock(projectId, userId1, username1);
      const lockInfo = service.acquireLock(projectId, userId1, username1);
      expect(lockInfo).not.toBeNull();
      expect(lockInfo?.userId).toBe(userId1);
    });

    it('should NOT acquire lock when locked by another user', () => {
void service.acquireLock(projectId, userId1, username1);
      const lockInfo = service.acquireLock(projectId, userId2, username2);
      expect(lockInfo).toBeNull();
    });

    it('should acquire lock if previous lock expired (60 seconds)', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

void service.acquireLock(projectId, userId1, username1);

      // Advance time by 61 seconds (timeout is 60s)
      jest.spyOn(Date, 'now').mockReturnValue(now + 61000);

      const lockInfo = service.acquireLock(projectId, userId2, username2);
      expect(lockInfo).not.toBeNull();
      expect(lockInfo?.userId).toBe(userId2);

      jest.restoreAllMocks();
    });
  });

  describe('releaseLock', () => {
    it('should release lock if owned by user and return true', () => {
void service.acquireLock(projectId, userId1, username1);
      const isReleased = service.releaseLock(projectId, userId1);

      expect(isReleased).toBe(true);
      const { locked: isLockedOnly } = service.isLocked(projectId);
      expect(isLockedOnly).toBe(false);
    });

    it('should NOT release lock if owned by another user and return false', () => {
void service.acquireLock(projectId, userId1, username1);
      const isReleased = service.releaseLock(projectId, userId2);

      expect(isReleased).toBe(false);
      const { locked: isLocked, lockInfo } = service.isLocked(projectId);
      expect(isLocked).toBe(true);
      expect(lockInfo?.userId).toBe(userId1);
    });
  });

  describe('isLocked', () => {
    it('should return false when no lock exists', () => {
      const { locked: isLocked } = service.isLocked(projectId);
      expect(isLocked).toBe(false);
    });

    it('should return true and lock info when locked', () => {
void service.acquireLock(projectId, userId1, username1);

      const { locked: isLocked, lockInfo } = service.isLocked(projectId);
      expect(isLocked).toBe(true);
      expect(lockInfo?.userId).toBe(userId1);
      expect(lockInfo?.username).toBe(username1);
    });

    it('should return false if lock expired (60 seconds)', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

void service.acquireLock(projectId, userId1, username1);

      jest.spyOn(Date, 'now').mockReturnValue(now + 61000);

      const { locked: isLocked } = service.isLocked(projectId);
      expect(isLocked).toBe(false);

      jest.restoreAllMocks();
    });
  });

  describe('releaseUserLocks', () => {
    it('should release all locks held by a user', () => {
      const project1 = 'project-1';
      const project2 = 'project-2';
      const project3 = 'project-3';

void service.acquireLock(project1, userId1, username1);
void service.acquireLock(project2, userId1, username1);
void service.acquireLock(project3, userId2, username2);

      const releasedProjects = service.releaseUserLocks(userId1);

      expect(releasedProjects).toHaveLength(2);
      expect(releasedProjects).toContain(project1);
      expect(releasedProjects).toContain(project2);
      expect(service.isLocked(project1).locked).toBe(false);
      expect(service.isLocked(project2).locked).toBe(false);
      expect(service.isLocked(project3).locked).toBe(true);
    });

    it('should return empty array if user has no locks', () => {
void service.acquireLock(projectId, userId1, username1);
      const releasedProjects = service.releaseUserLocks(userId2);

      expect(releasedProjects).toHaveLength(0);
      expect(service.isLocked(projectId).locked).toBe(true);
    });
  });

  describe('cleanupExpiredLocks', () => {
    it('should remove expired locks (60 second timeout)', () => {
      const now = Date.now();
      
      jest.spyOn(Date, 'now').mockReturnValue(now);
      service.acquireLock('project-1', userId1, username1); // Locked at T=0

      jest.spyOn(Date, 'now').mockReturnValue(now + 30000); // T+30s
      service.acquireLock('project-2', userId2, username2); // Locked at T+30

      jest.spyOn(Date, 'now').mockReturnValue(now + 61000); // T+61s
      // p1 is 61s old (>60s) -> Expired
      // p2 is 31s old (<60s) -> Active

void service.cleanupExpiredLocks();

      expect(service.isLocked('project-1').locked).toBe(false);
      expect(service.isLocked('project-2').locked).toBe(true);

      jest.restoreAllMocks();
    });

    it('should not remove locks that are exactly at timeout boundary', () => {
      const now = Date.now();
      
      jest.spyOn(Date, 'now').mockReturnValue(now);
void service.acquireLock(projectId, userId1, username1);

      jest.spyOn(Date, 'now').mockReturnValue(now + 60000); // Exactly 60s

void service.cleanupExpiredLocks();

      // At exactly 60s, lock should still be active (not >60s)
      expect(service.isLocked(projectId).locked).toBe(true);

      jest.restoreAllMocks();
    });
  });
});
