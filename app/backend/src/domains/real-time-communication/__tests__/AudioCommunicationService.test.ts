import { AudioCommunicationService, DefaultCommunicationStrategyFactory } from '../application/AudioCommunicationService';
import type { CommunicationStrategyFactory, AudioCommunicationStrategy } from '../domain/services/AudioCommunicationStrategy';
import type { ConnectionId, AudioBuffer } from '../domain/models/Connection';
import { UserRole } from '../domain/models/Connection';
import type { Server } from 'socket.io';
import type { RoomSessionManager } from '../../room-management/infrastructure/services/RoomSessionManager';

jest.mock('socket.io', () => ({
  Server: jest.fn(),
}));
jest.mock('../../room-management/infrastructure/services/RoomSessionManager', () => ({
  RoomSessionManager: jest.fn(),
}));

describe('AudioCommunicationService', () => {
  let service: AudioCommunicationService;
  let mockStrategyFactory: jest.Mocked<CommunicationStrategyFactory>;
  let mockIo: jest.Mocked<Server>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockStrategy: jest.Mocked<AudioCommunicationStrategy>;

  beforeEach(() => {
    mockStrategy = {
      connect: jest.fn().mockResolvedValue('conn-123' as unknown as ConnectionId),
      disconnect: jest.fn().mockResolvedValue(undefined),
      sendAudio: jest.fn().mockResolvedValue(undefined),
      onAudioReceived: jest.fn(),
      getConnectionHealth: jest.fn().mockResolvedValue({ isHealthy: true, quality: 'excellent' }),
      recoverConnection: jest.fn().mockResolvedValue(undefined),
      getStrategyInfo: jest.fn().mockReturnValue({
        type: 'mesh' as const,
        maxConnections: 10,
        supportedRoles: [UserRole.BAND_MEMBER, UserRole.ROOM_OWNER],
      }),
    } as jest.Mocked<AudioCommunicationStrategy>;

    mockStrategyFactory = {
      createStrategy: jest.fn().mockReturnValue(mockStrategy),
    } as jest.Mocked<CommunicationStrategyFactory>;

    mockIo = {} as unknown as jest.Mocked<Server>;

    mockRoomSessionManager = {
      getRoomSessions: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<RoomSessionManager>;

    service = new AudioCommunicationService(
      mockStrategyFactory,
      mockIo,
      mockRoomSessionManager
    );
  });

  describe('connectUser', () => {
    it('should connect user successfully', async () => {
      const userId = 'user-123';
      const role = UserRole.BAND_MEMBER;
      const roomId = 'room-456';

      const connectionId = await service.connectUser(userId, role, roomId);

      expect(connectionId).toBe('conn-123');
      expect(mockStrategyFactory.createStrategy).toHaveBeenCalled();
      expect(mockStrategy.connect).toHaveBeenCalledWith(userId, role);
    });

    it('should reuse existing strategy for same room', async () => {
      const roomId = 'room-456';

      await service.connectUser('user-1', UserRole.BAND_MEMBER, roomId);
      await service.connectUser('user-2', UserRole.BAND_MEMBER, roomId);

      expect(mockStrategyFactory.createStrategy).toHaveBeenCalledTimes(1);
      expect(mockStrategy.connect).toHaveBeenCalledTimes(2);
    });

    it('should handle room context with multiple users', async () => {
      mockRoomSessionManager.getRoomSessions.mockReturnValue(new Map([
        ['user-1', { userId: 'user-1', socketId: 'socket-1', namespacePath: '/room/test', connectedAt: new Date(), lastActivity: new Date(), roomId: 'room-456' }],
        ['user-2', { userId: 'user-2', socketId: 'socket-2', namespacePath: '/room/test', connectedAt: new Date(), lastActivity: new Date(), roomId: 'room-456' }],
      ]));

      await service.connectUser('user-3', UserRole.BAND_MEMBER, 'room-456');

      expect(mockRoomSessionManager.getRoomSessions).toHaveBeenCalledWith('room-456');
    });
  });

  describe('disconnectUser', () => {
    it('should disconnect user successfully', async () => {
      const userId = 'user-123';
      await service.connectUser(userId, UserRole.BAND_MEMBER, 'room-456');

      await service.disconnectUser(userId);

      expect(mockStrategy.disconnect).toHaveBeenCalledWith('conn-123');
    });

    it('should handle disconnect for non-existent user', async () => {
      await service.disconnectUser('non-existent');
      // Should complete without throwing
    });
  });

  describe('sendAudio', () => {
    it('should send audio data successfully', async () => {
      const userId = 'user-123';
      const audioData = Buffer.from('audio') as unknown as AudioBuffer;

      await service.connectUser(userId, UserRole.BAND_MEMBER, 'room-456');
      await service.sendAudio(userId, audioData);

      expect(mockStrategy.sendAudio).toHaveBeenCalledWith('conn-123', audioData);
    });

    it('should throw error for non-connected user', async () => {
      const audioData = Buffer.from('audio') as unknown as AudioBuffer;

      await expect(service.sendAudio('non-existent', audioData)).rejects.toThrow(
        'No connection found for user non-existent'
      );
    });
  });

  describe('onAudioReceived', () => {
    it('should register callback with all strategies', async () => {
      await service.connectUser('user-1', UserRole.BAND_MEMBER, 'room-1');
      await service.connectUser('user-2', UserRole.BAND_MEMBER, 'room-2');

      const callback = jest.fn();
void service.onAudioReceived(callback);

      expect(mockStrategy.onAudioReceived).toHaveBeenCalledWith(callback);
    });
  });

  describe('getConnectionHealth', () => {
    it('should return connection health for connected user', async () => {
      const userId = 'user-123';
      await service.connectUser(userId, UserRole.BAND_MEMBER, 'room-456');

      const health = await service.getConnectionHealth(userId);

      expect(health.isHealthy).toBe(true);
      expect(health.quality).toBe('excellent');
    });

    it('should return failed health for non-connected user', async () => {
      const health = await service.getConnectionHealth('non-existent');

      expect(health.isHealthy).toBe(false);
      expect(health.quality).toBe('failed');
    });
  });

  describe('recoverConnection', () => {
    it('should recover connection successfully', async () => {
      const userId = 'user-123';
      await service.connectUser(userId, UserRole.BAND_MEMBER, 'room-456');

      await service.recoverConnection(userId);

      expect(mockStrategy.recoverConnection).toHaveBeenCalledWith('conn-123');
    });

    it('should throw error for non-connected user', async () => {
      await expect(service.recoverConnection('non-existent')).rejects.toThrow(
        'No connection found for user non-existent'
      );
    });
  });

  describe('getStrategyInfo', () => {
    it('should return strategy info for room', async () => {
      const roomId = 'room-456';
      await service.connectUser('user-123', UserRole.BAND_MEMBER, roomId);

      const info = service.getStrategyInfo(roomId);

      expect(info).toEqual({
        type: 'mesh',
        maxConnections: 10,
        supportedRoles: [UserRole.BAND_MEMBER, UserRole.ROOM_OWNER],
      });
    });

    it('should return null for non-existent room', () => {
      const info = service.getStrategyInfo('non-existent');

      expect(info).toBeNull();
    });
  });

  describe('cleanupRoom', () => {
    it('should cleanup room and disconnect all users', async () => {
      const roomId = 'room-456';
      await service.connectUser('user-1', UserRole.BAND_MEMBER, roomId);
      await service.connectUser('user-2', UserRole.BAND_MEMBER, roomId);

      await service.cleanupRoom(roomId);

      expect(mockStrategy.disconnect).toHaveBeenCalledTimes(2);
    });

    it('should handle cleanup for non-existent room', async () => {
      await service.cleanupRoom('non-existent');
      // Should complete without throwing
    });
  });
});

describe('DefaultCommunicationStrategyFactory', () => {
  let factory: DefaultCommunicationStrategyFactory;
  let mockIo: jest.Mocked<Server>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;

  beforeEach(() => {
    mockIo = {} as unknown as jest.Mocked<Server>;
    mockRoomSessionManager = {} as unknown as jest.Mocked<RoomSessionManager>;
    factory = new DefaultCommunicationStrategyFactory(mockIo, mockRoomSessionManager);
  });

  describe('createStrategy', () => {
    it('should create mesh strategy for band members', () => {
      const roomContext = {
        bandMemberCount: 3,
        audienceCount: 0,
        requiresLowLatency: true,
      };

      const strategy = factory.createStrategy(UserRole.BAND_MEMBER, roomContext);

      expect(strategy).toBeDefined();
      expect(strategy.getStrategyInfo().type).toBe('mesh');
    });

    it('should create mesh strategy for room owner', () => {
      const roomContext = {
        bandMemberCount: 1,
        audienceCount: 0,
        requiresLowLatency: true,
      };

      const strategy = factory.createStrategy(UserRole.ROOM_OWNER, roomContext);

      expect(strategy).toBeDefined();
      expect(strategy.getStrategyInfo().type).toBe('mesh');
    });

    it('should create streaming strategy for audience', () => {
      const roomContext = {
        bandMemberCount: 3,
        audienceCount: 10,
        requiresLowLatency: false,
      };

      const strategy = factory.createStrategy(UserRole.AUDIENCE, roomContext);

      expect(strategy).toBeDefined();
      expect(strategy.getStrategyInfo().type).toBe('streaming');
    });

    it('should create streaming strategy for unlisted role (fallback)', () => {
      const roomContext = {
        bandMemberCount: 0,
        audienceCount: 0,
        requiresLowLatency: false,
      };

      const strategy = factory.createStrategy('INVALID_ROLE' as UserRole, roomContext);

      expect(strategy).toBeDefined();
      expect(strategy.getStrategyInfo().type).toBe('streaming');
    });
  });
});
