/**
 * Real-time Communication Domain Exports
 * 
 * This module provides the foundation for hybrid audio communication strategies
 * supporting both mesh WebRTC for band members and streaming for audience.
 * 
 * Requirements: 10.2, 10.3
 */

// Domain Models
export type { AudioBuffer } from './domain/models/Connection';
export { ConnectionId, UserRole, ConnectionState, AudioConnection } from './domain/models/Connection';

// Domain Services
export type { AudioCommunicationStrategy, CommunicationStrategyFactory } from './domain/services/AudioCommunicationStrategy';
export { InvalidRoleError, ConnectionFailedError, UnsupportedOperationError } from './domain/services/AudioCommunicationStrategy';

// Infrastructure Strategies
export { MeshWebRTCStrategy } from './infrastructure/strategies/MeshWebRTCStrategy';
export { StreamingStrategy } from './infrastructure/strategies/StreamingStrategy';

// Application Services
export { 
  AudioCommunicationService,
  DefaultCommunicationStrategyFactory
} from './application/AudioCommunicationService';