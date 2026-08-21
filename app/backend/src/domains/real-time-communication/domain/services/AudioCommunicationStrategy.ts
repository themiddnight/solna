/**
 * Abstract Audio Communication Strategy Interface
 * 
 * This interface defines the contract for different audio communication approaches:
 * - MeshWebRTCStrategy for band members (low latency, peer-to-peer)
 * - StreamingStrategy for audience (one-to-many, scalable)
 * 
 * Requirements: 10.2, 10.3
 */

import type { ConnectionId, UserRole, AudioBuffer } from '../models/Connection';

export interface AudioCommunicationStrategy {
  /**
   * Connect a user with the specified role
   * @param userId - Unique identifier for the user
   * @param role - User's role (band member or audience)
   * @returns Promise resolving to connection ID
   */
  connect(userId: string, role: UserRole): Promise<ConnectionId>;

  /**
   * Disconnect a user's audio connection
   * @param connectionId - Connection to disconnect
   */
  disconnect(connectionId: ConnectionId): Promise<void>;

  /**
   * Send audio data through the connection
   * @param connectionId - Connection to send through
   * @param audioData - Audio buffer to transmit
   */
  sendAudio(connectionId: ConnectionId, audioData: AudioBuffer): Promise<void>;

  /**
   * Register callback for receiving audio data
   * @param callback - Function to handle incoming audio
   */
  onAudioReceived(callback: (audioData: AudioBuffer, fromUserId: string) => void): void;

  /**
   * Get connection health status
   * @param connectionId - Connection to check
   */
  getConnectionHealth(connectionId: ConnectionId): Promise<{
    isHealthy: boolean;
    latency?: number;
    quality?: 'excellent' | 'good' | 'poor' | 'failed';
  }>;

  /**
   * Handle connection recovery for failed connections
   * @param connectionId - Failed connection to recover
   */
  recoverConnection(connectionId: ConnectionId): Promise<void>;

  /**
   * Get strategy-specific configuration
   */
  getStrategyInfo(): {
    type: 'mesh' | 'streaming';
    maxConnections: number;
    supportedRoles: UserRole[];
  };
}

/**
 * Communication Strategy Factory
 * Selects appropriate strategy based on user role and room configuration
 */
export interface CommunicationStrategyFactory {
  /**
   * Create strategy for user based on role and context
   */
  createStrategy(role: UserRole, roomContext: {
    bandMemberCount: number;
    audienceCount: number;
    requiresLowLatency: boolean;
  }): AudioCommunicationStrategy;
}

/**
 * Domain exceptions for communication strategies
 */
export class InvalidRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRoleError';
  }
}

export class ConnectionFailedError extends Error {
  constructor(reason: string) {
    super(`Connection failed: ${reason}`);
    this.name = 'ConnectionFailedError';
  }
}

export class UnsupportedOperationError extends Error {
  constructor(operation: string, strategyType: string) {
    super(`Operation '${operation}' not supported by ${strategyType} strategy`);
    this.name = 'UnsupportedOperationError';
  }
}