/**
 * Audio Communication Service
 * 
 * Application service that coordinates between different communication strategies
 * and provides a unified interface for audio communication management.
 * 
 * Requirements: 10.2, 10.3
 */

import type {
  AudioCommunicationStrategy,
  CommunicationStrategyFactory,
} from '../domain/services/AudioCommunicationStrategy';
import { loggingService } from '../../../shared/infrastructure/logging/LoggingService';
import type { ConnectionId, AudioBuffer } from '../domain/models/Connection';
import { UserRole } from '../domain/models/Connection';
import { MeshWebRTCStrategy } from '../infrastructure/strategies/MeshWebRTCStrategy';
import { StreamingStrategy } from '../infrastructure/strategies/StreamingStrategy';
import type { Server } from 'socket.io';
import type { RoomSessionManager } from '../../room-management/infrastructure/services/RoomSessionManager';

export class AudioCommunicationService {
  private readonly strategies = new Map<string, AudioCommunicationStrategy>(); // roomId -> strategy
  private readonly userConnections = new Map<string, { connectionId: ConnectionId; strategy: AudioCommunicationStrategy }>(); // userId -> connection info

  constructor(
    private readonly strategyFactory: CommunicationStrategyFactory,
    private readonly io: Server,
    private readonly roomSessionManager: RoomSessionManager
  ) { }

  /**
   * Connect user to appropriate audio communication strategy
   */
  async connectUser(userId: string, role: UserRole, roomId: string): Promise<ConnectionId> {
    // Get room context for strategy selection
    const roomContext = await this.getRoomContext(roomId);

    // Get or create appropriate strategy for the room
    const strategy = this.getOrCreateStrategy(roomId, role, roomContext);

    // Connect user through strategy
    const connectionId = await strategy.connect(userId, role);

    // Track user connection
    this.userConnections.set(userId, { connectionId, strategy });

    return connectionId;
  }

  /**
   * Disconnect user from audio communication
   */
  async disconnectUser(userId: string): Promise<void> {
    const userConnection = this.userConnections.get(userId);
    if (!userConnection) {
      loggingService.logWarn('No audio communication connection found for user', { userId });
      return;
    }

    await userConnection.strategy.disconnect(userConnection.connectionId);
    this.userConnections.delete(userId);
  }

  /**
   * Send audio data from user
   */
  async sendAudio(userId: string, audioData: AudioBuffer): Promise<void> {
    const userConnection = this.userConnections.get(userId);
    if (!userConnection) {
      throw new Error(`No connection found for user ${userId}`);
    }

    await userConnection.strategy.sendAudio(userConnection.connectionId, audioData);
  }

  /**
   * Register callback for receiving audio data
   */
  onAudioReceived(callback: (audioData: AudioBuffer, fromUserId: string) => void): void {
    // Register callback with all active strategies
    this.strategies.forEach(strategy => {
      strategy.onAudioReceived(callback);
    });
  }

  /**
   * Get connection health for user
   */
  async getConnectionHealth(userId: string): Promise<{
    isHealthy: boolean;
    latency?: number;
    quality?: 'excellent' | 'good' | 'poor' | 'failed';
  }> {
    const userConnection = this.userConnections.get(userId);
    if (!userConnection) {
      return { isHealthy: false, quality: 'failed' };
    }

    return await userConnection.strategy.getConnectionHealth(userConnection.connectionId);
  }

  /**
   * Recover failed connection
   */
  async recoverConnection(userId: string): Promise<void> {
    const userConnection = this.userConnections.get(userId);
    if (!userConnection) {
      throw new Error(`No connection found for user ${userId}`);
    }

    await userConnection.strategy.recoverConnection(userConnection.connectionId);
  }

  /**
   * Get strategy information for room
   */
  getStrategyInfo(roomId: string): {
    type: 'mesh' | 'streaming';
    maxConnections: number;
    supportedRoles: UserRole[];
  } | null {
    const strategy = this.strategies.get(roomId);
    return strategy ? strategy.getStrategyInfo() : null;
  }

  /**
   * Clean up room resources
   */
  async cleanupRoom(roomId: string): Promise<void> {
    const strategy = this.strategies.get(roomId);
    if (strategy) {
      // Disconnect all users in the room
      const roomUsers = Array.from(this.userConnections.entries())
        .filter(([_userId, connection]) => {
          // Check if user is in this room (simplified check)
          return connection.strategy === strategy;
        });

      for (const [userId] of roomUsers) {
        await this.disconnectUser(userId);
      }

      this.strategies.delete(roomId);
    }
  }

  /**
   * Get or create strategy for room
   */
  private getOrCreateStrategy(
    roomId: string,
    role: UserRole,
    roomContext: RoomContext
  ): AudioCommunicationStrategy {
    let strategy = this.strategies.get(roomId);

    if (!strategy) {
      strategy = this.strategyFactory.createStrategy(role, roomContext);
      this.strategies.set(roomId, strategy);
    }

    return strategy;
  }

  /**
   * Get room context for strategy selection
   */
  private async getRoomContext(roomId: string): Promise<RoomContext> {
    // Get room sessions to count users by role
    const roomSessions = this.roomSessionManager.getRoomSessions(roomId);

    let bandMemberCount = 0;
    const audienceCount = 0;

    // Count users by role (simplified - in real implementation would check actual user roles)
    roomSessions.forEach((_session: unknown) => {
      // For now, assume all users are band members
      // In real implementation, would check user.role from database
      bandMemberCount++;
    });

    return {
      bandMemberCount,
      audienceCount,
      requiresLowLatency: bandMemberCount > 0 // Require low latency if there are band members
    };
  }
}

/**
 * Default Communication Strategy Factory
 */
export class DefaultCommunicationStrategyFactory implements CommunicationStrategyFactory {
  constructor(
    private readonly io: Server,
    private readonly roomSessionManager: RoomSessionManager
  ) { }

  createStrategy(role: UserRole, _roomContext: RoomContext): AudioCommunicationStrategy {
    // Strategy selection logic
    if (role === UserRole.BAND_MEMBER || role === UserRole.ROOM_OWNER) {
      // Use mesh WebRTC for band members (low latency required)
      return new MeshWebRTCStrategy(this.io, this.roomSessionManager, 'room-placeholder');
    } else {
      // Use streaming for audience (scalability required)
      return new StreamingStrategy('room-placeholder');
    }
  }
}

/**
 * Room context interface
 */
interface RoomContext {
  bandMemberCount: number;
  audienceCount: number;
  requiresLowLatency: boolean;
}
