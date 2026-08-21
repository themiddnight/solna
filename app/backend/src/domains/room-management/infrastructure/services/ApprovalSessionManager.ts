/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars */
import type { UserSession, ApprovalSession } from '../../../../types';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";

export class ApprovalSessionManager {
  private readonly approvalSessions = new Map<string, ApprovalSession>(); // socketId -> ApprovalSession
  private readonly userApprovalSessions = new Map<string, string>(); // userId -> socketId
  private readonly APPROVAL_TIMEOUT_MS = 600000; // 10 minutes (increased from 30 seconds)

  /**
   * Create a new approval session for a user requesting to join a room
   * Requirements: 3.1, 3.2
   */
  createApprovalSession(
    socketId: string, 
    roomId: string, 
    userId: string, 
    username: string, 
    role: 'band_member' | 'audience',
    timeoutCallback?: (socketId: string, session: ApprovalSession) => void
  ): ApprovalSession {
    // Remove any existing session for this user
    this.removeApprovalSessionByUserId(userId);

    const session: ApprovalSession = {
      roomId,
      userId,
      username,
      role,
      requestedAt: new Date()
    };

    // Set up timeout for automatic cancellation
    session.timeoutId = setTimeout(() => {
      if (timeoutCallback != null) {
        timeoutCallback(socketId, session);
      } else {
        this.handleApprovalTimeout(socketId, session);
      }
    }, this.APPROVAL_TIMEOUT_MS);

    this.approvalSessions.set(socketId, session);
    this.userApprovalSessions.set(userId, socketId);

    loggingService.logInfo('Created approval session', {
      socketId,
      roomId,
      userId,
      username,
      role,
      timeoutMs: this.APPROVAL_TIMEOUT_MS
    });

    return session;
  }

  /**
   * Get approval session by socket ID
   */
  getApprovalSession(socketId: string): ApprovalSession | undefined {
    return this.approvalSessions.get(socketId);
  }

  /**
   * Get approval session by user ID
   */
  getApprovalSessionByUserId(userId: string): ApprovalSession | undefined {
    const socketId = this.userApprovalSessions.get(userId);
    if (socketId == null) return undefined;
    return this.approvalSessions.get(socketId);
  }

  /**
   * Remove approval session by socket ID
   * Requirements: 3.6, 3.7, 3.8
   */
  removeApprovalSession(socketId: string): ApprovalSession | undefined {
    const session = this.approvalSessions.get(socketId);
    if (session === undefined || session === null) return undefined;

    // Clear timeout if it exists
    if (session.timeoutId !== undefined && session.timeoutId !== null) {
      clearTimeout(session.timeoutId);
    }

    // Remove from both maps
    this.approvalSessions.delete(socketId);
    this.userApprovalSessions.delete(session.userId);

    loggingService.logInfo('Removed approval session', {
      socketId,
      roomId: session.roomId,
      userId: session.userId,
      username: session.username
    });

    return session;
  }

  /**
   * Remove approval session by user ID
   * Requirements: 3.6, 3.7, 3.8
   */
  removeApprovalSessionByUserId(userId: string): ApprovalSession | undefined {
    const socketId = this.userApprovalSessions.get(userId);
    if (socketId === undefined || socketId === null) return undefined;
    return this.removeApprovalSession(socketId);
  }

  /**
   * Check if a user has an active approval session
   */
  hasApprovalSession(userId: string): boolean {
    return this.userApprovalSessions.has(userId);
  }

  /**
   * Get all approval sessions for a specific room
   */
  getApprovalSessionsForRoom(roomId: string): ApprovalSession[] {
    return Array.from(this.approvalSessions.values())
      .filter(session => session.roomId === roomId);
  }

  /**
   * Get approval timeout duration in milliseconds
   */
  getApprovalTimeoutMs(): number {
    return this.APPROVAL_TIMEOUT_MS;
  }

  /**
   * Clean up all approval sessions (for shutdown)
   */
  cleanup(): void {
    // Clear all timeouts
    for (const session of this.approvalSessions.values()) {
      if (session.timeoutId !== undefined && session.timeoutId !== null) {
        clearTimeout(session.timeoutId);
      }
    }

    // Clear all sessions
    this.approvalSessions.clear();
    this.userApprovalSessions.clear();

    loggingService.logInfo('ApprovalSessionManager cleanup complete');
  }

  /**
   * Get statistics about approval sessions
   */
  getStats(): {
    totalSessions: number;
    sessionsByRoom: Record<string, number>;
    oldestSessionAge: number | null;
  } {
    const sessions = Array.from(this.approvalSessions.values());
    const sessionsByRoom: Record<string, number> = {};
    let oldestSessionAge: number | null = null;

    for (const session of sessions) {
      // Count sessions by room
      const currentCount = sessionsByRoom[session.roomId] ?? 0;
      sessionsByRoom[session.roomId] = currentCount + 1;

      // Find oldest session
      const age = Date.now() - session.requestedAt.getTime();
      if (oldestSessionAge === null || age > oldestSessionAge) {
        oldestSessionAge = age;
      }
    }

    return {
      totalSessions: sessions.length,
      sessionsByRoom,
      oldestSessionAge
    };
  }

  /**
   * Handle approval timeout - automatically cancel the request
   * Requirements: 3.4
   */
  private handleApprovalTimeout(socketId: string, session: ApprovalSession): void {
    loggingService.logInfo('Approval request timed out', {
      socketId,
      roomId: session.roomId,
      userId: session.userId,
      username: session.username,
      timeoutMs: this.APPROVAL_TIMEOUT_MS
    });

    // Remove the session (this will also clear the timeout)
    this.removeApprovalSession(socketId);

    // The timeout callback will be handled by the namespace event handlers
    // to notify both the waiting user and room owner
  }
}
