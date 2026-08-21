import { GRACE_PERIOD_OWNER_MS, GRACE_PERIOD_MEMBER_MS } from "@jam-band/shared";
import { loggingService } from "../logging/LoggingService";
import type { EventBus } from "../../domain/events/EventBus";
import { GracePeriodsExpired } from "../../../domains/room-management/domain/events/GracePeriodsExpired";
import type { User } from "@/types";

/**
 * Namespace-aware grace period management for room isolation
 * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
 */

export interface GracePeriodEntry {
  userId: string;
  roomId: string;
  namespacePath: string;
  timestamp: number;
  isIntendedLeave: boolean;
  userData: User;
}

/* eslint-disable @typescript-eslint/member-ordering, @typescript-eslint/no-unnecessary-condition */
export class NamespaceGracePeriodManager {
  // Grace period entries organized by room for isolation
  private readonly roomGracePeriods = new Map<string, Map<string, GracePeriodEntry>>(); // roomId -> userId -> entry
  // Using dynamic grace periods based on role from SyncConfig
  // GRACE_PERIOD_OWNER_MS (10s) and GRACE_PERIOD_MEMBER_MS (30s)
  private cleanupInterval?: NodeJS.Timeout;
  /** EventBus for publishing GracePeriodsExpired domain events. */
  private eventBus?: EventBus;

  constructor() {
    loggingService.logInfo('NamespaceGracePeriodManager initialized');
    
    // Start cleanup interval (skip in test environment to prevent open handles)
    if (process.env.NODE_ENV !== 'test') {
      this.startCleanupInterval();
    }
  }

  /**
   * Get grace period duration
   */
  getGracePeriodMs(role?: string): number {
    return role === 'room_owner' ? GRACE_PERIOD_OWNER_MS : GRACE_PERIOD_MEMBER_MS;
  }

  /**
   * Add user to grace period for a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  addToGracePeriod(
    userId: string, 
    roomId: string, 
    namespacePath: string, 
    userData: User, 
    isIntendedLeave: boolean = false
  ): void {
    if (this.roomGracePeriods.has(roomId) === false) {
      this.roomGracePeriods.set(roomId, new Map());
    }

    const entry: GracePeriodEntry = {
      userId,
      roomId,
      namespacePath,
      timestamp: Date.now(),
      isIntendedLeave,
      userData
    };

    this.roomGracePeriods.get(roomId)!.set(userId, entry);

    const gracePeriodMs = this.getGracePeriodMs(userData.role);
    
    loggingService.logInfo('Added user to grace period', {
      userId,
      roomId,
      namespacePath,
      isIntendedLeave,
      gracePeriodMs
    });
  }

  /**
   * Check if user is in grace period for a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  isUserInGracePeriod(userId: string, roomId: string): boolean {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return false;
    }

    const entry = roomGracePeriods.get(userId);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    const gracePeriodMs = this.getGracePeriodMs(entry.userData?.role);
    
    if (now - entry.timestamp > gracePeriodMs) {
      // Grace period hasExpired, remove entry
      roomGracePeriods.delete(userId);
      if (roomGracePeriods.size === 0) {
        this.roomGracePeriods.delete(roomId);
      }
      return false;
    }

    return true;
  }

  /**
   * Get grace period entry for a user in a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  getGracePeriodEntry(userId: string, roomId: string): GracePeriodEntry | null {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return null;
    }

    const entry = roomGracePeriods.get(userId);
    if (!entry) {
      return null;
    }

    // Check if still valid
    const now = Date.now();
    const gracePeriodMs = this.getGracePeriodMs(entry.userData?.role);
    
    if (now - entry.timestamp > gracePeriodMs) {
      roomGracePeriods.delete(userId);
      if (roomGracePeriods.size === 0) {
        this.roomGracePeriods.delete(roomId);
      }
      return null;
    }

    return entry;
  }

  /**
   * Remove user from grace period
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  removeFromGracePeriod(userId: string, roomId: string): boolean {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return false;
    }

    const isRemoved = roomGracePeriods.delete(userId);
    if (roomGracePeriods.size === 0) {
      this.roomGracePeriods.delete(roomId);
    }

    if (isRemoved) {
      loggingService.logInfo('Removed user from grace period', {
        userId,
        roomId
      });
    }

    return isRemoved;
  }

  /**
   * Rekey a grace period entry from an old userId to a new userId within the same room,
   * replacing the stored userData (used for guest→registered identity swap).
   * Requirements: DEV-208 - preserve grace period continuity across identity swap
   */
  rekeyGracePeriodEntry(
    roomId: string,
    oldUserId: string,
    newUserId: string,
    updatedUserData: User
  ): boolean {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return false;
    }

    const entry = roomGracePeriods.get(oldUserId);
    if (!entry) {
      return false;
    }

    roomGracePeriods.delete(oldUserId);
    roomGracePeriods.set(newUserId, {
      ...entry,
      userId: newUserId,
      userData: updatedUserData
    });

    loggingService.logInfo('Rekeyed grace period entry', {
      roomId,
      oldUserId,
      newUserId
    });

    return true;
  }

  /**
   * Get all users in grace period for a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  getRoomGracePeriodUsers(roomId: string): GracePeriodEntry[] {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return [];
    }

    const now = Date.now();
    const validEntries: GracePeriodEntry[] = [];
    const expiredUsers: string[] = [];

    for (const [userId, entry] of roomGracePeriods.entries()) {
      const gracePeriodMs = this.getGracePeriodMs(entry.userData?.role);
      
      if (now - entry.timestamp > gracePeriodMs) {
        expiredUsers.push(userId);
      } else {
        validEntries.push(entry);
      }
    }

    // Clean up expired entries
    expiredUsers.forEach(userId => {
      roomGracePeriods.delete(userId);
    });

    if (roomGracePeriods.size === 0) {
      this.roomGracePeriods.delete(roomId);
    }

    return validEntries;
  }

  /**
   * Clean up all grace period entries for a room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  cleanupRoomGracePeriod(roomId: string): void {
    const isRemoved = this.roomGracePeriods.delete(roomId);
    if (isRemoved) {
      loggingService.logInfo('Cleaned up room grace period', { roomId });
    }
  }

  /**
   * Clean up expired grace period entries across all rooms
   * Returns a list of rooms that may need cleanup after grace period expiration
   */
  cleanupExpiredGracePeriods(): string[] {
    const now = Date.now();
    let totalCleaned = 0;
    const roomsNeedingCleanup: string[] = [];

    for (const [roomId, roomGracePeriods] of this.roomGracePeriods.entries()) {
      const expiredUsers: string[] = [];

      for (const [userId, entry] of roomGracePeriods.entries()) {
        const gracePeriodMs = this.getGracePeriodMs(entry.userData?.role);
        
        if (now - entry.timestamp > gracePeriodMs) {
          expiredUsers.push(userId);
        }
      }

      if (expiredUsers.length > 0) {
        expiredUsers.forEach(userId => {
          roomGracePeriods.delete(userId);
          totalCleaned++;
        });

        // Mark room for potential cleanup since grace periods expired
        roomsNeedingCleanup.push(roomId);
      }

      if (roomGracePeriods.size === 0) {
        this.roomGracePeriods.delete(roomId);
      }
    }

    if (totalCleaned > 0) {
      loggingService.logInfo('Cleaned up expired grace period entries', {
        totalCleaned,
        activeRooms: this.roomGracePeriods.size,
        roomsNeedingCleanup: roomsNeedingCleanup.length
      });
    }

    return roomsNeedingCleanup;
  }

  /**
   * Get statistics about grace period usage
   */
  getGracePeriodStats(): {
    totalUsers: number;
    roomCount: number;
    roomBreakdown: Array<{ roomId: string; userCount: number; entries: Array<{ userId: string; timeRemaining: number }> }>;
  } {
    const now = Date.now();
    let totalUsers = 0;
    const roomBreakdown: Array<{ roomId: string; userCount: number; entries: Array<{ userId: string; timeRemaining: number }> }> = [];

    for (const [roomId, roomGracePeriods] of this.roomGracePeriods.entries()) {
      const entries: Array<{ userId: string; timeRemaining: number }> = [];

      for (const [userId, entry] of roomGracePeriods.entries()) {
        const gracePeriodMs = this.getGracePeriodMs(entry.userData?.role);
        const timeRemaining = Math.max(0, gracePeriodMs - (now - entry.timestamp));
        
        if (timeRemaining > 0) {
          entries.push({ userId, timeRemaining });
          totalUsers++;
        }
      }

      if (entries.length > 0) {
        roomBreakdown.push({
          roomId,
          userCount: entries.length,
          entries
        });
      }
    }

    return {
      totalUsers,
      roomCount: this.roomGracePeriods.size,
      roomBreakdown
    };
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const roomsNeedingCleanup = this.cleanupExpiredGracePeriods();
      if (roomsNeedingCleanup.length > 0 && this.eventBus) {
        this.eventBus.publish(new GracePeriodsExpired(roomsNeedingCleanup)).catch((error) => {
          loggingService.logError(error as Error, {
            context: 'NamespaceGracePeriodManager.cleanupInterval.publish',
          });
        });
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Inject the EventBus for publishing GracePeriodsExpired domain events.
   * Required for subscribers (e.g. room cleanup in index.ts) to react to
   * grace-period expirations without ad-hoc callbacks.
   */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /**
   * Shutdown and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.roomGracePeriods.clear();
  }
}

// Export singleton instance
export const namespaceGracePeriodManager = new NamespaceGracePeriodManager();