/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import type { Request, Response } from 'express';
import type { AuthRequest } from '../../../auth/infrastructure/middleware/authMiddleware';
import type { RoomLifecycleService } from '../../application/RoomLifecycleService';
import type { RoomSessionManager } from '../services/RoomSessionManager';
import type { NamespaceGracePeriodManager } from '../../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { getHealthCheckData } from '../../../../middleware/monitoring';

/**
 * RoomController - Handles HTTP endpoints for room management
 */
export class RoomController {
  private readonly ROOM_CREATION_GRACE_PERIOD_MS = 30_000;

  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly namespaceGracePeriodManager: NamespaceGracePeriodManager
  ) {}

  /**
   * GET /api/health
   * System health check
   */
  getHealthCheck(req: Request, res: Response): void {
    try {
      const healthData = getHealthCheckData();
      res.json(healthData);
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Health check error'), { context: 'health-check' });
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        status: 'error',
        message: 'Health check failed',
        error: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * GET /api/rooms/:roomId/exists
   * Lightweight check if a room exists (used to validate stale activeRoomId)
   */
  async checkRoomExists(req: Request, res: Response): Promise<void> {
    const { roomId } = req.params;
    if (!roomId) {
      res.status(400).json({ exists: false, userCount: 0, message: 'Room ID is required' });
      return;
    }
    try {
      const room = await this.roomLifecycleService.getRoom(roomId);
      if (room) {
        const roomAgeMs = Date.now() - new Date(room.createdAt).getTime();
        if (roomAgeMs < this.ROOM_CREATION_GRACE_PERIOD_MS) {
          const userCount = room.bandMembers.size + room.audiences.size;
          res.json({ exists: true, userCount });
          return;
        }

        const users = [
          ...Array.from(room.bandMembers.values()),
          ...Array.from(room.audiences.values()),
        ];

        let userCount = 0;
        for (const user of users) {
          if (this.namespaceGracePeriodManager.isUserInGracePeriod(user.id, roomId)) {
            userCount++;
            continue;
          }

          const isActive = await this.roomSessionManager.isUserActiveInRoom(roomId, user.id);
          if (isActive) {
            userCount++;
          }
        }

        res.json({ exists: true, userCount });
      } else {
        res.json({ exists: false, userCount: 0 });
      }
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Check room exists error'), { context: 'check-room-exists', roomId });
      res.json({ exists: false, userCount: 0 });
    }
  }

  /**
   * GET /api/rooms
   * List all rooms with search and pagination
   */
  async getRoomList(req: Request, res: Response): Promise<void> {
    // Check if user is authenticated (optional auth)
    const authHeader = req.headers.authorization;
    const isAuthenticated = !!(authHeader && authHeader.split(' ')[1]);

    // Log guest access for audit purposes
    if (!isAuthenticated) {
      loggingService.logSecurityEvent('Guest room list access', {
        ip: req.socket.remoteAddress,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      }, 'info');
    }

    // Parse search and pagination params
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limitParsed = parseInt(String(req.query.limit ?? '20'), 10);
    const limit = Math.min(100, Math.max(1, isNaN(limitParsed) ? 20 : limitParsed));

    try {
      let roomList = (await this.roomLifecycleService.getAllRooms(isAuthenticated)) as Record<string, unknown>[];

      // Apply search filter if provided
      if (search) {
        roomList = roomList.filter((room: Record<string, unknown>) => {
          const hasNameMatch = (room.name as string | undefined)?.toLowerCase().includes(search);
          const hasDescMatch = (room.description as string | undefined)?.toLowerCase().includes(search);
          return hasNameMatch || hasDescMatch;
        });
      }

      // Calculate pagination
      const total = roomList.length;
      const totalPages = Math.ceil(total / limit);
      const skip = (page - 1) * limit;
      const paginatedRooms = roomList.slice(skip, skip + limit);

      res.json({
        rooms: paginatedRooms,
        total,
        page,
        limit,
        totalPages,
      });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Get room list error'), { context: 'room-list' });
      res.status(500).json({ message: 'Failed to retrieve room list' });
    }
  }

  /**
   * DELETE /api/rooms/:roomId/ghost
   * Delete a ghost room (room with no active sessions)
   * No authentication required - anyone can trigger cleanup
   * Backend validates that room is actually a ghost before deletion
   */
  async deleteGhostRoom(req: Request, res: Response): Promise<void> {
    const { roomId } = req.params;
    
    if (!roomId) {
      res.status(400).json({ 
        success: false, 
        message: 'Room ID is required' 
      });
      return;
    }

    try {
      // Get room
      const room = await this.roomLifecycleService.getRoom(roomId);
      
      if (!room) {
        // Room already cleaned up (e.g., by handleJoinRoom ghost detection) — goal is achieved
        res.json({ 
          success: true, 
          message: 'Room already cleaned up' 
        });
        return;
      }

      // Check if room has any users with active sessions
      const allUsers = [...Array.from(room.bandMembers.values()), ...Array.from(room.audiences.values())];
      
      let hasActiveSession = false;
      for (const user of allUsers) {
        // Cross-process safe check
        const isActive = await this.roomSessionManager.isUserActiveInRoom(roomId, user.id);
        if (isActive) {
          hasActiveSession = true;
          break;
        }
      }

      // Prevent deletion if room has active users
      if (hasActiveSession) {
        res.status(403).json({ 
          success: false, 
          message: 'Cannot delete room with active users',
          reason: 'ROOM_HAS_ACTIVE_USERS'
        });
        return;
      }

      // Check if room has users in grace period (musicians only)
      const gracePeriodUsers = this.namespaceGracePeriodManager.getRoomGracePeriodUsers(roomId);
      const hasGracePeriodMusician = gracePeriodUsers.some((entry) => {
        const userRole = entry.userData.role;
        return userRole === 'room_owner' || userRole === 'band_member';
      });

      // Prevent deletion if room has musicians in grace period
      if (hasGracePeriodMusician) {
        res.status(403).json({ 
          success: false, 
          message: 'Cannot delete room with users in grace period',
          reason: 'ROOM_HAS_GRACE_PERIOD_USERS'
        });
        return;
      }

      // Room is a ghost - safe to delete
      await this.roomLifecycleService.deleteRoom(roomId);
      
      loggingService.logInfo('Ghost room deleted via API', {
        roomId,
        roomName: room.name,
        userCount: allUsers.length
      });

      res.json({ 
        success: true, 
        message: 'Ghost room deleted successfully' 
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Delete ghost room error'), 
        { context: 'delete-ghost-room', roomId }
      );
      res.status(500).json({ 
        success: false, 
        message: 'Failed to delete ghost room' 
      });
    }
  }

  /**
   * GET /api/rooms/invite/:code
   * Validate invite code and return room details + role
   */
  async getInviteCodeDetails(req: Request, res: Response): Promise<void> {
    const { code } = req.params;
    if (!code) {
      res.status(400).json({ success: false, message: 'Invite code is required' });
      return;
    }

    try {
      const result = await this.roomLifecycleService.getRoomByInviteCode(code);
      if (result) {
        res.json({
          success: true,
          roomId: result.room.id,
          role: result.role,
          roomType: result.room.roomType,
        });
      } else {
        res.status(404).json({ success: false, message: 'Invalid or expired invite link' });
      }
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Get invite code details error'),
        { context: 'get-invite-code-details', code }
      );
      res.status(500).json({ success: false, message: 'Failed to retrieve invite details' });
    }
  }

  /**
   * GET /api/rooms/:roomId/invite-codes
   * Owner-only. Returns this room's invite codes so an owner who missed the
   * one-shot ROOM_JOINED delivery (or became owner after join) can (re)fetch
   * them on demand (DEV-262). Acting identity is the token-verified req.user.id
   * (TR-33); a non-owner is refused (403) to keep the private codes from leaking
   * (IDOR). Codes are otherwise stripped from every broadcast (roomPayloadUtils).
   */
  async getRoomInviteCodes(req: AuthRequest, res: Response): Promise<void> {
    const { roomId } = req.params;
    const userId = req.user?.id;
    if (!roomId) {
      res.status(400).json({ success: false, message: 'Room ID is required' });
      return;
    }
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    try {
      const room = await this.roomLifecycleService.getRoom(roomId);
      if (!room) {
        res.status(404).json({ success: false, message: 'Room not found' });
        return;
      }
      if (room.owner !== userId) {
        res.status(403).json({ success: false, message: 'Only the room owner can view invite links' });
        return;
      }
      res.json({
        success: true,
        bandMemberInviteCode: room.bandMemberInviteCode,
        audienceInviteCode: room.audienceInviteCode,
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Get room invite codes error'),
        { context: 'get-room-invite-codes', roomId }
      );
      res.status(500).json({ success: false, message: 'Failed to retrieve invite links' });
    }
  }
}
