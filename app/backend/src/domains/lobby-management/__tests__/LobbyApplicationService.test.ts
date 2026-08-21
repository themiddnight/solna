import { LobbyApplicationService, LobbyApplicationError } from '../application/LobbyApplicationService';
import type { RoomDiscoveryService } from '../domain/services/RoomDiscoveryService';
import type { RoomListingRepository } from '../domain/repositories/RoomListingRepository';
import type { EventBus } from '../../../shared/domain/events/EventBus';
import type { RoomListing, RoomListingSummary } from '../domain/models/RoomListing';
import { RoomActivityStatus, RoomCapacityStatus } from '../domain/models/RoomListing';
import { SearchCriteria, SortBy, SortOrder } from '../domain/models/SearchCriteria';
import { UserId, RoomId } from '../../../shared/domain/models/ValueObjects';

jest.mock('../domain/services/RoomDiscoveryService', () => ({
  RoomDiscoveryService: jest.fn(),
}));
jest.mock('../domain/repositories/RoomListingRepository', () => ({
  RoomListingRepository: jest.fn(),
}));
jest.mock('../../../shared/domain/events/EventBus', () => ({
  EventBus: jest.fn(),
}));

describe('LobbyApplicationService', () => {
  let service: LobbyApplicationService;
  let mockRoomListingRepository: jest.Mocked<RoomListingRepository>;
  let mockRoomDiscoveryService: jest.Mocked<RoomDiscoveryService>;
  let mockEventBus: jest.Mocked<EventBus>;

  const createMockRoomListing = (overrides?: Partial<Record<string, unknown>>): RoomListing => {
    const mock: Record<string, unknown> = {
      id: RoomId.fromString('room-1'),
      name: 'Test Room',
      ownerUsername: 'testuser',
      memberCount: 5,
      maxMembers: 10,
      isPrivate: false,
      requiresApproval: false,
      isActive: true,
      genres: ['rock', 'jazz'],
      description: 'A test room',
      owner: new UserId('owner-1'),
      createdAt: new Date(),
      lastActivity: new Date(),
      canJoin: jest.fn().mockReturnValue(true),
      isFull: jest.fn().mockReturnValue(false),
      isNearlyFull: jest.fn().mockReturnValue(false),
      isRecentlyActive: jest.fn().mockReturnValue(true),
      hasGenre: jest.fn().mockReturnValue(true),
      hasAnyGenre: jest.fn().mockReturnValue(true),
      matchesSearchTerm: jest.fn().mockReturnValue(true),
      getActivityStatus: jest.fn().mockReturnValue(RoomActivityStatus.Active),
      getCapacityStatus: jest.fn().mockReturnValue(RoomCapacityStatus.Available),
      toSummary: jest.fn().mockReturnValue({} as RoomListingSummary),
      equals: jest.fn().mockReturnValue(true),
      ...overrides,
    };
    return mock as unknown as RoomListing;
  };

  beforeEach(() => {
    mockRoomListingRepository = {
      findAll: jest.fn(),
      findActive: jest.fn(),
      findByGenre: jest.fn(),
      searchByText: jest.fn(),
      findAvailable: jest.fn(),
      getStatistics: jest.fn(),
      refresh: jest.fn(),
      clearInactive: jest.fn(),
      findByCriteria: jest.fn(),
      findById: jest.fn(),
      findByGenres: jest.fn(),
      findPopular: jest.fn(),
      findByOwner: jest.fn(),
      save: jest.fn(),
      saveMany: jest.fn(),
      remove: jest.fn(),
      updateActivity: jest.fn(),
      updateMemberCount: jest.fn(),
    } as unknown as jest.Mocked<RoomListingRepository>;

    mockRoomDiscoveryService = {
      findRooms: jest.fn(),
      getRecommendedRooms: jest.fn(),
      getPopularRooms: jest.fn(),
      getRoomsByGenre: jest.fn(),
      searchRoomsByText: jest.fn(),
    } as unknown as jest.Mocked<RoomDiscoveryService>;

    mockEventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    } as unknown as jest.Mocked<EventBus>;

    service = new LobbyApplicationService(
      mockRoomListingRepository,
      mockRoomDiscoveryService,
      mockEventBus
    );
  });

  describe('searchRooms', () => {
    it('should search rooms successfully', async () => {
      const criteria = new SearchCriteria(
        'test',
        [],
        false,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        SortBy.Relevance,
        SortOrder.Desc,
        10,
        0
      );

      const mockRooms = [createMockRoomListing()];
      const mockResult = {
        items: mockRooms,
        totalCount: 1,
        hasMore: false,
      };

      mockRoomListingRepository.findAll.mockResolvedValue(mockRooms);
      mockRoomDiscoveryService.findRooms.mockResolvedValue(mockResult);

      const userId = new UserId('user-123');
      const result = await service.searchRooms(criteria, userId);

      expect(result).toEqual(mockResult);
      expect(mockRoomListingRepository.findAll).toHaveBeenCalled();
      expect(mockRoomDiscoveryService.findRooms).toHaveBeenCalledWith(
        criteria,
        mockRooms,
        userId
      );
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should handle search errors', async () => {
      const criteria = SearchCriteria.default();
      mockRoomListingRepository.findAll.mockRejectedValue(new Error('DB error'));

      await expect(service.searchRooms(criteria)).rejects.toThrow(LobbyApplicationError);
    });
  });

  describe('getRecommendedRooms', () => {
    it('should get recommended rooms', async () => {
      const userId = new UserId('user-123');
      const mockRooms = [createMockRoomListing()];

      mockRoomListingRepository.findActive.mockResolvedValue(mockRooms);
      mockRoomDiscoveryService.getRecommendedRooms.mockReturnValue(mockRooms);

      const result = await service.getRecommendedRooms(userId, ['rock'], 5);

      expect(result).toEqual(mockRooms);
      expect(mockRoomDiscoveryService.getRecommendedRooms).toHaveBeenCalledWith(
        mockRooms,
        userId,
        ['rock'],
        5
      );
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const userId = new UserId('user-123');
      mockRoomListingRepository.findActive.mockRejectedValue(new Error('DB error'));

      await expect(service.getRecommendedRooms(userId)).rejects.toThrow(LobbyApplicationError);
    });
  });

  describe('getPopularRooms', () => {
    it('should get popular rooms', async () => {
      const mockRooms = [createMockRoomListing()];

      mockRoomListingRepository.findActive.mockResolvedValue(mockRooms);
      mockRoomDiscoveryService.getPopularRooms.mockReturnValue(mockRooms);

      const result = await service.getPopularRooms(10);

      expect(result).toEqual(mockRooms);
      expect(mockRoomDiscoveryService.getPopularRooms).toHaveBeenCalledWith(mockRooms, 10);
      expect(mockEventBus.publish).toHaveBeenCalled();
    });
  });

  describe('getRoomsByGenre', () => {
    it('should get rooms by genre', async () => {
      const mockRooms = [createMockRoomListing()];
      const userId = new UserId('user-123');

      mockRoomListingRepository.findByGenre.mockResolvedValue(mockRooms);
      mockRoomDiscoveryService.getRoomsByGenre.mockReturnValue(mockRooms);

      const result = await service.getRoomsByGenre('rock', userId, 20);

      expect(result).toEqual(mockRooms);
      expect(mockRoomListingRepository.findByGenre).toHaveBeenCalledWith('rock', 20);
    });
  });

  describe('searchRoomsByText', () => {
    it('should search rooms by text', async () => {
      const mockRooms = [createMockRoomListing()];
      const userId = new UserId('user-123');

      mockRoomListingRepository.searchByText.mockResolvedValue(mockRooms);
      mockRoomDiscoveryService.searchRoomsByText.mockReturnValue(mockRooms);

      const result = await service.searchRoomsByText('test', userId, 20);

      expect(result).toEqual(mockRooms);
      expect(mockRoomListingRepository.searchByText).toHaveBeenCalledWith('test', 20);
    });
  });

  describe('getAvailableRooms', () => {
    it('should get available rooms', async () => {
      const mockRooms = [createMockRoomListing()];

      mockRoomListingRepository.findAvailable.mockResolvedValue(mockRooms);

      const result = await service.getAvailableRooms(undefined, 50);

      expect(result).toEqual(mockRooms);
      expect(mockRoomListingRepository.findAvailable).toHaveBeenCalledWith(50);
    });

    it('should filter by user permissions', async () => {
      const userId = new UserId('user-123');
      const mockCanJoinTrue = createMockRoomListing({ canJoin: jest.fn().mockReturnValue(true) });
      const mockCanJoinFalse = createMockRoomListing({ canJoin: jest.fn().mockReturnValue(false) });

      mockRoomListingRepository.findAvailable.mockResolvedValue([mockCanJoinTrue, mockCanJoinFalse]);

      const result = await service.getAvailableRooms(userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockCanJoinTrue);
    });
  });

  describe('recordRoomDetailsView', () => {
    it('should record room details view', async () => {
      const userId = new UserId('user-123');

      await service.recordRoomDetailsView(userId, 'room-1', 'search');

      expect(mockEventBus.publish).toHaveBeenCalled();
    });
  });

  describe('recordRoomJoinAttempt', () => {
    it('should record room join attempt', async () => {
      const userId = new UserId('user-123');

      await service.recordRoomJoinAttempt(userId, 'room-1', 'direct');

      expect(mockEventBus.publish).toHaveBeenCalled();
    });
  });

  describe('getLobbyStatistics', () => {
    it('should get lobby statistics', async () => {
      const mockStats = {
        totalRooms: 100,
        activeRooms: 50,
        availableRooms: 30,
        privateRooms: 20,
        publicRooms: 80,
        fullRooms: 10,
        averageMemberCount: 5,
        popularGenres: [
          { genre: 'rock', roomCount: 20, totalMembers: 100, averageMembers: 5 },
        ],
        activityDistribution: { active: 50, idle: 30, inactive: 20 },
      };

      mockRoomListingRepository.getStatistics.mockResolvedValue(mockStats);

      const result = await service.getLobbyStatistics();

      expect(result.totalRooms).toBe(100);
      expect(result.activeRooms).toBe(50);
      expect(result.popularGenres).toHaveLength(1);
    });
  });

  describe('refreshRoomListings', () => {
    it('should refresh room listings', async () => {
      await service.refreshRoomListings();

      expect(mockRoomListingRepository.refresh).toHaveBeenCalled();
    });
  });

  describe('cleanupInactiveRooms', () => {
    it('should cleanup inactive rooms', async () => {
      mockRoomListingRepository.clearInactive.mockResolvedValue(5);

      const result = await service.cleanupInactiveRooms(24);

      expect(result).toBe(5);
      expect(mockRoomListingRepository.clearInactive).toHaveBeenCalled();
    });
  });
});
