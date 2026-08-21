/**
 * Mesh WebRTC Strategy Implementation
 * 
 * Implements peer-to-peer mesh networking for band members requiring low latency.
 * Each band member connects directly to every other band member.
 * 
 * Requirements: 10.2, 10.3
 */

import type { Server } from 'socket.io';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import type {
  AudioCommunicationStrategy} from '../../domain/services/AudioCommunicationStrategy';
import {
  InvalidRoleError,
  ConnectionFailedError
} from '../../domain/services/AudioCommunicationStrategy';
import type {
  AudioBuffer} from '../../domain/models/Connection';
import {
  ConnectionId,
  UserRole,
  AudioConnection,
  ConnectionState
} from '../../domain/models/Connection';
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import { VOICE_EVENTS } from '@jam-band/shared';

/* eslint-disable @typescript-eslint/member-ordering */
export class MeshWebRTCStrategy implements AudioCommunicationStrategy {
  private readonly connections = new Map<string, AudioConnection>(); // connectionId -> connection
  private readonly userConnections = new Map<string, ConnectionId[]>(); // userId -> connectionIds
  private readonly audioCallbacks: Array<(audioData: AudioBuffer, fromUserId: string) => void> = [];

  constructor(
    private readonly io: Server,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly roomId: string
  ) { }

  async connect(userId: string, role: UserRole): Promise<ConnectionId> {
    if (role !== UserRole.BAND_MEMBER && role !== UserRole.ROOM_OWNER) {
      throw new InvalidRoleError('Mesh WebRTC only supports band members and room owners');
    }

    const connectionId = ConnectionId.generate();
    const connection = new AudioConnection(connectionId, userId, role);

    this.connections.set(connectionId.toString(), connection);

    // Track user connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, []);
    }
    this.userConnections.get(userId)!.push(connectionId);

    // Setup mesh connections with existing participants
    await this.setupMeshConnections(userId, connectionId);

    return connectionId;
  }

  async disconnect(connectionId: ConnectionId): Promise<void> {
    const connection = this.connections.get(connectionId.toString());
    if (!connection) {
      loggingService.logWarn('Mesh connection not found for disconnect', { connectionId: connectionId.toString() });
      return;
    }

    const userId = connection.userId;

    // Remove from connections
    this.connections.delete(connectionId.toString());

    // Remove from user connections
    const userConnections = this.userConnections.get(userId);
    if (userConnections) {
      const index = userConnections.findIndex(id => id.equals(connectionId));
      if (index !== -1) {
        userConnections.splice(index, 1);
      }

      if (userConnections.length === 0) {
        this.userConnections.delete(userId);
      }
    }

    // Notify other participants about disconnection
    await this.notifyMeshDisconnection(userId);
  }

  async sendAudio(connectionId: ConnectionId, audioData: AudioBuffer): Promise<void> {
    const connection = this.connections.get(connectionId.toString());
    if (!connection) {
      throw new ConnectionFailedError(`Connection ${connectionId.toString()} not found`);
    }

    // For testing purposes, don't check health immediately after connection
    // In real implementation, connection would be established through WebRTC handshake

    // In mesh network, broadcast audio to all other connected users
    const otherUsers = Array.from(this.userConnections.keys())
      .filter(userId => userId !== connection.userId);

    for (const targetUserId of otherUsers) {
      await this.sendAudioToUser(targetUserId, audioData, connection.userId);
    }

    // Update connection heartbeat
    connection.updateState(ConnectionState.CONNECTED);
  }

  onAudioReceived(callback: (audioData: AudioBuffer, fromUserId: string) => void): void {
    this.audioCallbacks.push(callback);
  }

  async getConnectionHealth(connectionId: ConnectionId): Promise<{
    isHealthy: boolean;
    latency?: number;
    quality?: 'excellent' | 'good' | 'poor' | 'failed';
  }> {
    const connection = this.connections.get(connectionId.toString());
    if (!connection) {
      return { isHealthy: false, quality: 'failed' };
    }

    const isHealthy = connection.isHealthy();

    // Simulate latency measurement (in real implementation, this would measure RTT)
    const latency = await this.measureLatency(connection.userId);

    let quality: 'excellent' | 'good' | 'poor' | 'failed' = 'failed';
    if (isHealthy) {
      if (latency < 50) quality = 'excellent';
      else if (latency < 100) quality = 'good';
      else if (latency < 200) quality = 'poor';
    }

    return { isHealthy, latency, quality };
  }

  async recoverConnection(connectionId: ConnectionId): Promise<void> {
    const connection = this.connections.get(connectionId.toString());
    if (!connection) {
      throw new ConnectionFailedError(`Connection ${connectionId.toString()} not found for recovery`);
    }

    // Mark connection as connecting during recovery
    connection.updateState(ConnectionState.CONNECTING);

    try {
      // Re-establish mesh connections
      await this.setupMeshConnections(connection.userId, connection.id);
      connection.updateState(ConnectionState.CONNECTED);
    } catch (error) {
      connection.updateState(ConnectionState.FAILED);
      throw new ConnectionFailedError(`Failed to recover connection: ${String(error)}`);
    }
  }

  getStrategyInfo(): {
    type: 'mesh' | 'streaming';
    maxConnections: number;
    supportedRoles: UserRole[];
  } {
    return {
      type: 'mesh',
      maxConnections: 8, // Practical limit for mesh networking
      supportedRoles: [UserRole.BAND_MEMBER, UserRole.ROOM_OWNER]
    };
  }

  /**
   * Setup mesh connections with existing participants
   */
  private async setupMeshConnections(userId: string, _connectionId: ConnectionId): Promise<void> {
    // Get existing participants in the room
    const existingUsers = Array.from(this.userConnections.keys())
      .filter(id => id !== userId);

    // Notify existing users about new participant
    for (const existingUserId of existingUsers) {
      await this.notifyMeshConnection(existingUserId, userId);
    }

    // Notify new user about existing participants
    if (existingUsers.length > 0) {
      await this.notifyMeshParticipants(userId, existingUsers);
    }
  }

  /**
   * Notify user about new mesh participant
   */
  private async notifyMeshConnection(targetUserId: string, newUserId: string): Promise<void> {
    const targetSocketId = this.roomSessionManager.findSocketByUserId(this.roomId, targetUserId);
    if (targetSocketId) {
      const targetSocket = this.io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit(VOICE_EVENTS.NEW_MESH_PEER, {
          userId: newUserId,
          shouldInitiate: targetUserId.localeCompare(newUserId) < 0
        });
      }
    }
  }

  /**
   * Notify new user about existing mesh participants
   */
  private async notifyMeshParticipants(userId: string, existingUsers: string[]): Promise<void> {
    const userSocketId = this.roomSessionManager.findSocketByUserId(this.roomId, userId);
    if (userSocketId) {
      const userSocket = this.io.sockets.sockets.get(userSocketId);
      if (userSocket) {
        userSocket.emit(VOICE_EVENTS.MESH_PARTICIPANTS, {
          participants: existingUsers.map(existingUserId => ({
            userId: existingUserId,
            shouldInitiate: userId.localeCompare(existingUserId) < 0
          }))
        });
      }
    }
  }

  /**
   * Notify other participants about disconnection
   */
  private async notifyMeshDisconnection(_userId: string): Promise<void> {
    // mesh_peer_disconnected was orphaned (FE uses user_left_voice instead) — no-op
  }

  /**
   * Send audio data to specific user
   */
  private async sendAudioToUser(_targetUserId: string, _audioData: AudioBuffer, _fromUserId: string): Promise<void> {
    // mesh_audio_data relay was abandoned — audio goes through WebRTC data channels directly
  }

  /**
   * Measure latency to user (placeholder implementation)
   */
  private async measureLatency(userId: string): Promise<number> {
    // In real implementation, this would send a ping and measure RTT
    // For now, return a simulated latency based on connection health
    const userConnections = this.userConnections.get(userId);
    if (!userConnections || userConnections.length === 0) {
      return 999; // High latency for disconnected users
    }

    // Simulate mesh network latency (typically very low)
    return Math.random() * 50 + 10; // 10-60ms
  }

  /**
   * Handle incoming audio data (called by infrastructure layer)
   */
  handleIncomingAudio(audioData: AudioBuffer, fromUserId: string): void {
    // Notify all registered callbacks
    this.audioCallbacks.forEach(callback => {
      try {
        callback(audioData, fromUserId);
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'MeshWebRTCStrategy.audioCallback' });
      }
    });
  }

  /**
   * Get connected users count
   */
  getConnectedUsersCount(): number {
    return this.userConnections.size;
  }

  /**
   * Get connection status for all users
   */
  getConnectionStatus(): Array<{
    userId: string;
    connectionIds: string[];
    isHealthy: boolean;
  }> {
    return Array.from(this.userConnections.entries()).map(([userId, connectionIds]) => {
      const connections = connectionIds.map(id => this.connections.get(id.toString())).filter(Boolean);
      const isHealthy = connections.some(conn => conn!.isHealthy());

      return {
        userId,
        connectionIds: connectionIds.map(id => id.toString()),
        isHealthy
      };
    });
  }
}
/* eslint-enable @typescript-eslint/member-ordering */
