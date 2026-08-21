export interface SaveLockInfo {
  userId: string;
  username: string;
  lockedAt: number;
}

/**
 * ⚠️ SINGLE-INSTANCE ASSUMPTION: locks live in an in-process Map. Running
 * multiple backend instances makes these locks non-exclusive across
 * processes (two instances can both "acquire" the same project). If the
 * backend is ever scaled horizontally, migrate this to the Redis
 * distributed lock (RedisStateService.executeWithLock) first.
 *
 * ProjectSaveLockService
 * In-memory save lock per project to prevent concurrent saves
 * Lock is released when user disconnects or after 60 seconds timeout
 */
export class ProjectSaveLockService {
  private readonly locks: Map<string, SaveLockInfo> = new Map();
  private readonly lockTimeoutMs = 60000; // 60 seconds max lock duration (1 minute)

  /**
   * Attempt to acquire a lock for a project
   * @returns SaveLockInfo if lock isAcquired, null if already locked by another user
   */
  acquireLock(projectId: string, userId: string, username: string): SaveLockInfo | null {
    const existing = this.locks.get(projectId);

    // Check if lock exists and is still valid
    if (existing) {
      const isExpired = Date.now() - existing.lockedAt > this.lockTimeoutMs;

      if (!isExpired && existing.userId !== userId) {
        // Locked by another user
        return null;
      }

      // Lock is expired or same user - allow re-acquire
    }

    const lockInfo: SaveLockInfo = { userId, username, lockedAt: Date.now() };
    this.locks.set(projectId, lockInfo);
    return lockInfo;
  }

  /**
   * Release a lock for a project
   * @returns true if lock was isReleased, false if user doesn't own the lock
   */
  releaseLock(projectId: string, userId: string): boolean {
    const existing = this.locks.get(projectId);

    // Only release if the user owns the lock
    if (existing && existing.userId === userId) {
      this.locks.delete(projectId);
      return true;
    }
    return false;
  }

  /**
   * Release all locks held by a user (called when user disconnects)
   * @returns array of projectIds that were unlocked
   */
  releaseUserLocks(userId: string): string[] {
    const releasedProjects: string[] = [];
    for (const [projectId, lock] of this.locks) {
      if (lock.userId === userId) {
        this.locks.delete(projectId);
        releasedProjects.push(projectId);
      }
    }
    return releasedProjects;
  }

  /**
   * Check if a project is currently locked
   */
  isLocked(projectId: string): { locked: boolean; lockInfo?: SaveLockInfo } {
    const existing = this.locks.get(projectId);

    if (!existing) {
      return { locked: false };
    }

    const isExpired = Date.now() - existing.lockedAt > this.lockTimeoutMs;

    if (isExpired) {
      this.locks.delete(projectId);
      return { locked: false };
    }

    return { locked: true, lockInfo: existing };
  }

  /**
   * Clear all expired locks (for periodic cleanup)
   */
  cleanupExpiredLocks(): void {
    const now = Date.now();
    for (const [projectId, lock] of this.locks) {
      if (now - lock.lockedAt > this.lockTimeoutMs) {
        this.locks.delete(projectId);
      }
    }
  }
}

// Export singleton instance
export const projectSaveLockService = new ProjectSaveLockService();
