import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProjectSaveLockService } from '../infrastructure/services/ProjectSaveLockService';

// Critical path tests — added after 2026-04 audit

/**
 * Collaboration Locking Tests (Backend)
 *
 * Tests for concurrent project save locking to prevent data corruption
 * when multiple users attempt to save the same project simultaneously.
 *
 * Key scenarios tested:
 * - Lock acquisition and release
 * - Concurrent user attempts (second user waits vs errors)
 * - Lock expiration after TTL
 * - Lock idempotence (same user re-acquiring is safe)
 * - Cleanup on user disconnect
 */

describe('ProjectSaveLockService - Collaboration Locking', () => {
  let service: ProjectSaveLockService;
  const projectId = 'proj-critical-123';
  const userId1 = 'user-alice';
  const userId2 = 'user-bob';
  const userId3 = 'user-charlie';
  const username1 = 'Alice';
  const username2 = 'Bob';
  const username3 = 'Charlie';

  beforeEach(() => {
    service = new ProjectSaveLockService();
    jest.clearAllMocks();
  });

  describe('Lock Acquisition - Basic', () => {
    it('should return true (lock info) on successful first acquisition', () => {
      const lockInfo = service.acquireLock(projectId, userId1, username1);

      expect(lockInfo).not.toBeNull();
      expect(lockInfo?.userId).toBe(userId1);
      expect(lockInfo?.username).toBe(username1);
      expect(typeof lockInfo?.lockedAt).toBe('number');
      expect(lockInfo?.lockedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should return false (null) when another user tries to acquire locked project', () => {
      // User 1 locks the project
void service.acquireLock(projectId, userId1, username1);

      // User 2 attempts to lock the same project
      const lockInfo = service.acquireLock(projectId, userId2, username2);

      expect(lockInfo).toBeNull();
    });

    it('should allow owner to re-acquire lock (idempotent)', () => {
      const lock1 = service.acquireLock(projectId, userId1, username1);
      expect(lock1).not.toBeNull();

      // Same user re-acquires
      const lock2 = service.acquireLock(projectId, userId1, username1);

      expect(lock2).not.toBeNull();
      expect(lock2?.userId).toBe(userId1);
    });
  });

  describe('Lock Acquisition - Concurrent Scenarios', () => {
    it('should handle rapid sequential acquisitions from different users correctly', () => {
      // User 1 locks
      const lock1 = service.acquireLock(projectId, userId1, username1);
      expect(lock1).not.toBeNull();

      // User 2 attempts immediately after
      const lock2 = service.acquireLock(projectId, userId2, username2);
      expect(lock2).toBeNull();

      // User 3 attempts while user 1 still holds lock
      const lock3 = service.acquireLock(projectId, userId3, username3);
      expect(lock3).toBeNull();

      // User 1 can still re-acquire
      const reacquire = service.acquireLock(projectId, userId1, username1);
      expect(reacquire).not.toBeNull();
    });

    it('should allow different users to lock different projects simultaneously', () => {
      const proj1 = 'proj-1';
      const proj2 = 'proj-2';
      const proj3 = 'proj-3';

      const lock1 = service.acquireLock(proj1, userId1, username1);
      const lock2 = service.acquireLock(proj2, userId2, username2);
      const lock3 = service.acquireLock(proj3, userId3, username3);

      expect(lock1).not.toBeNull();
      expect(lock2).not.toBeNull();
      expect(lock3).not.toBeNull();
      expect(lock1?.userId).toBe(userId1);
      expect(lock2?.userId).toBe(userId2);
      expect(lock3?.userId).toBe(userId3);
    });
  });

  describe('Lock Expiration - TTL (60 seconds)', () => {
    it('should expire lock after TTL elapses', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // User 1 acquires lock
      const lockInfo = service.acquireLock(projectId, userId1, username1);
      expect(lockInfo).not.toBeNull();

      // Advance time by exactly 60 seconds
      jest.spyOn(Date, 'now').mockReturnValue(now + 60000);

      // At exactly 60s, lock should still be valid (not >60s)
      const lockStatus = service.isLocked(projectId);
      expect(lockStatus.locked).toBe(true);

      // Advance 1 more millisecond (now 60001ms)
      jest.spyOn(Date, 'now').mockReturnValue(now + 60001);

      // User 2 should now be able to acquire (lock hasExpired)
      const newLock = service.acquireLock(projectId, userId2, username2);
      expect(newLock).not.toBeNull();
      expect(newLock?.userId).toBe(userId2);

      jest.restoreAllMocks();
    });

    it('should allow expired lock to be cleaned up and re-acquired by new user', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

void service.acquireLock(projectId, userId1, username1);

      // Advance time beyond TTL
      jest.spyOn(Date, 'now').mockReturnValue(now + 65000);

      // Check lock status (should auto-cleanup on check)
      const status = service.isLocked(projectId);
      expect(status.locked).toBe(false);

      // New user should be able to acquire
      const newLock = service.acquireLock(projectId, userId2, username2);
      expect(newLock).not.toBeNull();

      jest.restoreAllMocks();
    });
  });

  describe('Lock Release', () => {
    it('should release lock successfully when owner calls releaseLock', () => {
void service.acquireLock(projectId, userId1, username1);
      expect(service.isLocked(projectId).locked).toBe(true);

      const isReleased = service.releaseLock(projectId, userId1);

      expect(isReleased).toBe(true);
      expect(service.isLocked(projectId).locked).toBe(false);
    });

    it('should prevent non-owner from releasing another user\'s lock', () => {
void service.acquireLock(projectId, userId1, username1);

      // User 2 attempts to release User 1's lock
      const isReleased = service.releaseLock(projectId, userId2);

      expect(isReleased).toBe(false);
      expect(service.isLocked(projectId).locked).toBe(true);
      expect(service.isLocked(projectId).lockInfo?.userId).toBe(userId1);
    });

    it('should be idempotent for release (second release returns false)', () => {
void service.acquireLock(projectId, userId1, username1);

      // First release succeeds
      const isReleased1 = service.releaseLock(projectId, userId1);
      expect(isReleased1).toBe(true);

      // Second release fails (no lock to release)
      const isReleased2 = service.releaseLock(projectId, userId1);
      expect(isReleased2).toBe(false);
    });

    it('should allow new user to acquire after lock is released', () => {
void service.acquireLock(projectId, userId1, username1);
void service.releaseLock(projectId, userId1);

      const newLock = service.acquireLock(projectId, userId2, username2);

      expect(newLock).not.toBeNull();
      expect(newLock?.userId).toBe(userId2);
    });
  });

  describe('User Disconnect - releaseUserLocks', () => {
    it('should release all locks held by disconnected user', () => {
      const proj1 = 'proj-1';
      const proj2 = 'proj-2';
      const proj3 = 'proj-3';

      // User 1 locks multiple projects
void service.acquireLock(proj1, userId1, username1);
void service.acquireLock(proj2, userId1, username1);
void service.acquireLock(proj3, userId2, username2);

      const isReleased = service.releaseUserLocks(userId1);

      expect(isReleased).toHaveLength(2);
      expect(isReleased).toContain(proj1);
      expect(isReleased).toContain(proj2);
      expect(isReleased).not.toContain(proj3);

      // Verify locks are actually released
      expect(service.isLocked(proj1).locked).toBe(false);
      expect(service.isLocked(proj2).locked).toBe(false);
      expect(service.isLocked(proj3).locked).toBe(true);
    });

    it('should return empty array if user has no locks', () => {
void service.acquireLock(projectId, userId2, username2);

      const isReleased = service.releaseUserLocks(userId1);

      expect(isReleased).toEqual([]);
    });

    it('should allow other users to acquire released projects after user disconnect', () => {
      const proj1 = 'proj-1';

      // User 1 locks
void service.acquireLock(proj1, userId1, username1);

      // User 1 disconnects
void service.releaseUserLocks(userId1);

      // User 2 should now acquire
      const lock = service.acquireLock(proj1, userId2, username2);

      expect(lock).not.toBeNull();
      expect(lock?.userId).toBe(userId2);
    });
  });

  describe('Lock Status Checking', () => {
    it('should return isLocked=true with lock info when project is isLocked', () => {
      const lockInfo = service.acquireLock(projectId, userId1, username1);

      const status = service.isLocked(projectId);

      expect(status.locked).toBe(true);
      expect(status.lockInfo).toBeDefined();
      expect(status.lockInfo?.userId).toBe(userId1);
      expect(status.lockInfo?.username).toBe(username1);
      expect(status.lockInfo?.lockedAt).toBe(lockInfo?.lockedAt);
    });

    it('should return isLocked=false with no lock info when unlocked', () => {
      const status = service.isLocked(projectId);

      expect(status.locked).toBe(false);
      expect(status.lockInfo).toBeUndefined();
    });

    it('should clean up expired lock info on isLocked check', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

void service.acquireLock(projectId, userId1, username1);

      jest.spyOn(Date, 'now').mockReturnValue(now + 61000);

      const status = service.isLocked(projectId);

      expect(status.locked).toBe(false);
      expect(status.lockInfo).toBeUndefined();

      jest.restoreAllMocks();
    });
  });

  describe('Cleanup - cleanupExpiredLocks', () => {
    it('should remove only expired locks and keep active ones', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const proj1 = 'proj-1';
      const proj2 = 'proj-2';

      service.acquireLock(proj1, userId1, username1); // Locked at T=0

      jest.spyOn(Date, 'now').mockReturnValue(now + 30000); // T+30s
      service.acquireLock(proj2, userId2, username2); // Locked at T+30

      jest.spyOn(Date, 'now').mockReturnValue(now + 61000); // T+61s
void service.cleanupExpiredLocks();

      // proj1 should be cleaned (61s > 60s timeout)
      // proj2 should remain (31s < 60s timeout)
      expect(service.isLocked(proj1).locked).toBe(false);
      expect(service.isLocked(proj2).locked).toBe(true);

      jest.restoreAllMocks();
    });

    it('should handle edge case: multiple projects, some expired some not', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const projects = Array(5).fill(null).map((_, i) => `proj-${i}`);

      // Lock first 3 at T=0
      projects.slice(0, 3).forEach((proj, i) => {
void service.acquireLock(proj, `user-${i}`, `User${i}`);
      });

      jest.spyOn(Date, 'now').mockReturnValue(now + 45000); // T+45s
      // Lock remaining 2 at T+45
      projects.slice(3).forEach((proj, i) => {
void service.acquireLock(proj, `user-${i + 3}`, `User${i + 3}`);
      });

      jest.spyOn(Date, 'now').mockReturnValue(now + 61000); // T+61s
void service.cleanupExpiredLocks();

      // First 3 should be expired
      expect(service.isLocked(projects[0]!).locked).toBe(false);
      expect(service.isLocked(projects[1]!).locked).toBe(false);
      expect(service.isLocked(projects[2]!).locked).toBe(false);

      // Last 2 should still be active (16s old)
      expect(service.isLocked(projects[3]!).locked).toBe(true);
      expect(service.isLocked(projects[4]!).locked).toBe(true);

      jest.restoreAllMocks();
    });

    it('should handle cleanup with no locks present', () => {
      // Should not throw
      expect(() => {
void service.cleanupExpiredLocks();
      }).not.toThrow();
    });
  });

  describe('Real-world Workflow', () => {
    it('should handle typical save workflow: acquire -> use -> release -> allow next user', () => {
      // User 1 workflow
      const lock1 = service.acquireLock(projectId, userId1, username1);
      expect(lock1).not.toBeNull();

      // User 2 waits (gets null)
      const lock2Attempt = service.acquireLock(projectId, userId2, username2);
      expect(lock2Attempt).toBeNull();

      // User 1 completes save
      const isReleased = service.releaseLock(projectId, userId1);
      expect(isReleased).toBe(true);

      // User 2 now succeeds
      const lock2 = service.acquireLock(projectId, userId2, username2);
      expect(lock2).not.toBeNull();

      // User 2 completes save
void service.releaseLock(projectId, userId2);

      // Project is now free for anyone
      const lock3 = service.acquireLock(projectId, userId3, username3);
      expect(lock3).not.toBeNull();
    });

    it('should recover from abandoned lock via TTL expiration', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // User 1 acquires lock but never releases (connection dropped)
void service.acquireLock(projectId, userId1, username1);

      // User 2 tries immediately (blocked)
      let lock2 = service.acquireLock(projectId, userId2, username2);
      expect(lock2).toBeNull();

      // Time passes (network issues, user offline)
      jest.spyOn(Date, 'now').mockReturnValue(now + 65000);

      // User 2 retries and succeeds (lock hasExpired)
      lock2 = service.acquireLock(projectId, userId2, username2);
      expect(lock2).not.toBeNull();

      jest.restoreAllMocks();
    });
  });
});
