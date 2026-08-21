import { RoomDiscoveryService } from '../domain/services/RoomDiscoveryService';
import type { RoomListing, RoomListingSummary } from '../domain/models/RoomListing';
import { RoomActivityStatus, RoomCapacityStatus } from '../domain/models/RoomListing';
import { SearchCriteria, SortBy, SortOrder } from '../domain/models/SearchCriteria';
import { UserId, RoomId } from '../../../shared/domain/models/ValueObjects';

describe('RoomDiscoveryService', () => {
  let service: RoomDiscoveryService;

  beforeAll(() => {
    service = new RoomDiscoveryService();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockRoom = (overrides?: Partial<Record<string, unknown>>): RoomListing => {
    const mock: Record<string, unknown> = {
      id: RoomId.fromString('room-1'),
      name: 'Test Room',
      ownerUsername: 'testuser',
      memberCount: 5,
      maxMembers: 10,
      isPrivate: false,
      requiresApproval: false,
      isActive: true,
      genres: ['rock'],
      description: 'Test description',
      owner: new UserId('owner-1'),
      createdAt: new Date('2024-01-01'),
      lastActivity: new Date('2024-01-02'),
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

  describe('findRooms', () => {
    it('should find and filter rooms based on criteria', async () => {
      const rooms = [
        createMockRoom({ name: 'Rock Room', genres: ['rock'] }),
        createMockRoom({ name: 'Jazz Room', genres: ['jazz'] }),
      ];

      const criteria = new SearchCriteria(
        undefined,
        ['rock'],
        false,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        SortBy.Name,
        SortOrder.Asc,
        10,
        0
      );

      const result = await service.findRooms(criteria, rooms);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.totalCount).toBeGreaterThan(0);
    });

    it('should apply pagination correctly', async () => {
      const rooms = Array.from({ length: 20 }, (_, i) =>
        createMockRoom({ name: `Room ${i}` })
      );

      const criteria = new SearchCriteria(
        undefined,
        [],
        false,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        SortBy.Name,
        SortOrder.Asc,
        5,
        0
      );

      const result = await service.findRooms(criteria, rooms);

      expect(result.items).toHaveLength(5);
      expect(result.totalCount).toBe(20);
      expect(result.hasMore).toBe(true);
      expect(result.nextOffset).toBe(5);
    });

    it('should filter by text search', async () => {
      const rooms = [
        createMockRoom({ name: 'Rock Room', matchesSearchTerm: jest.fn().mockReturnValue(true) }),
        createMockRoom({ name: 'Jazz Room', matchesSearchTerm: jest.fn().mockReturnValue(false) }),
      ];

      const criteria = new SearchCriteria(
        'rock',
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

      const result = await service.findRooms(criteria, rooms);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.name).toBe('Rock Room');
    });
  });

  describe('getRecommendedRooms', () => {
    it('should recommend rooms based on genre preferences', () => {
      const userId = new UserId('user-123');
      const rooms = [
        createMockRoom({ 
          name: 'Rock Room', 
          genres: ['rock', 'metal'],
          lastActivity: new Date('2024-01-03')
        }),
        createMockRoom({ 
          name: 'Jazz Room', 
          genres: ['jazz'],
          lastActivity: new Date('2024-01-02')
        }),
        createMockRoom({ 
          name: 'Rock Jazz Room', 
          genres: ['rock', 'jazz'],
          lastActivity: new Date('2024-01-01')
        }),
      ];

      const result = service.getRecommendedRooms(rooms, userId, ['rock'], 10);

      expect(result.length).toBeGreaterThan(0);
      // Rooms with rock genre should be prioritized
      expect(result[0]!.genres).toContain('rock');
    });

    it('should sort by activity when no genre preferences', () => {
      const userId = new UserId('user-123');
      const rooms = [
        createMockRoom({ 
          name: 'Old Room',
          lastActivity: new Date('2024-01-01')
        }),
        createMockRoom({ 
          name: 'New Room',
          lastActivity: new Date('2024-01-03')
        }),
      ];

      const result = service.getRecommendedRooms(rooms, userId, [], 10);

      expect(result[0]!.name).toBe('New Room');
    });

    it('should filter out rooms user cannot join', () => {
      const userId = new UserId('user-123');
      const rooms = [
        createMockRoom({ canJoin: jest.fn().mockReturnValue(true) }),
        createMockRoom({ canJoin: jest.fn().mockReturnValue(false) }),
      ];

      const result = service.getRecommendedRooms(rooms, userId, [], 10);

      expect(result).toHaveLength(1);
    });
  });

  describe('getPopularRooms', () => {
    it('should return rooms sorted by member count', () => {
      const rooms = [
        createMockRoom({ name: 'Small Room', memberCount: 2 }),
        createMockRoom({ name: 'Large Room', memberCount: 10 }),
        createMockRoom({ name: 'Medium Room', memberCount: 5 }),
      ];

      const result = service.getPopularRooms(rooms, 10);

      expect(result[0]!.name).toBe('Large Room');
      expect(result[1]!.name).toBe('Medium Room');
      expect(result[2]!.name).toBe('Small Room');
    });

    it('should filter out inactive rooms', () => {
      const rooms = [
        createMockRoom({ 
          memberCount: 10,
          getActivityStatus: jest.fn().mockReturnValue(RoomActivityStatus.Active)
        }),
        createMockRoom({ 
          memberCount: 5,
          getActivityStatus: jest.fn().mockReturnValue(RoomActivityStatus.Inactive)
        }),
      ];

      const result = service.getPopularRooms(rooms, 10);

      expect(result).toHaveLength(1);
      expect(result[0]!.memberCount).toBe(10);
    });

    it('should use activity as tiebreaker', () => {
      const rooms = [
        createMockRoom({ 
          name: 'Old Room',
          memberCount: 5,
          lastActivity: new Date('2024-01-01')
        }),
        createMockRoom({ 
          name: 'New Room',
          memberCount: 5,
          lastActivity: new Date('2024-01-03')
        }),
      ];

      const result = service.getPopularRooms(rooms, 10);

      expect(result[0]!.name).toBe('New Room');
    });
  });

  describe('getRoomsByGenre', () => {
    it('should filter rooms by genre', () => {
      const rooms = [
        createMockRoom({ 
          name: 'Rock Room',
          hasGenre: jest.fn().mockReturnValue(true)
        }),
        createMockRoom({ 
          name: 'Jazz Room',
          hasGenre: jest.fn().mockReturnValue(false)
        }),
      ];

      const result = service.getRoomsByGenre(rooms, 'rock', undefined, 20);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Rock Room');
    });

    it('should prioritize rooms with available space', () => {
      const userId = new UserId('user-123');
      const rooms = [
        createMockRoom({ 
          name: 'Full Room',
          hasGenre: jest.fn().mockReturnValue(true),
          canJoin: jest.fn().mockReturnValue(false)
        }),
        createMockRoom({ 
          name: 'Available Room',
          hasGenre: jest.fn().mockReturnValue(true),
          canJoin: jest.fn().mockReturnValue(true)
        }),
      ];

      const result = service.getRoomsByGenre(rooms, 'rock', userId, 20);

      expect(result[0]!.name).toBe('Available Room');
    });
  });

  describe('searchRoomsByText', () => {
    it('should return empty array for empty search term', () => {
      const rooms = [createMockRoom()];

      const result = service.searchRoomsByText(rooms, '', undefined, 20);

      expect(result).toHaveLength(0);
    });

    it('should score rooms by relevance', () => {
      const rooms = [
        createMockRoom({ 
          name: 'test',
          matchesSearchTerm: jest.fn().mockReturnValue(true)
        }),
        createMockRoom({ 
          name: 'contains test word',
          matchesSearchTerm: jest.fn().mockReturnValue(true)
        }),
        createMockRoom({ 
          name: 'starts with test',
          matchesSearchTerm: jest.fn().mockReturnValue(true)
        }),
      ];

      const result = service.searchRoomsByText(rooms, 'test', undefined, 20);

      expect(result.length).toBeGreaterThan(0);
      // Exact match should score highest
      expect(result[0]!.name).toBe('test');
    });

    it('should filter by user permissions', () => {
      const userId = new UserId('user-123');
      const rooms = [
        createMockRoom({ 
          matchesSearchTerm: jest.fn().mockReturnValue(true),
          canJoin: jest.fn().mockReturnValue(true)
        }),
        createMockRoom({ 
          matchesSearchTerm: jest.fn().mockReturnValue(true),
          canJoin: jest.fn().mockReturnValue(false)
        }),
      ];

      const result = service.searchRoomsByText(rooms, 'test', userId, 20);

      expect(result).toHaveLength(1);
    });

    it('should limit results', () => {
      const rooms = Array.from({ length: 50 }, () =>
        createMockRoom({ matchesSearchTerm: jest.fn().mockReturnValue(true) })
      );

      const result = service.searchRoomsByText(rooms, 'test', undefined, 10);

      expect(result).toHaveLength(10);
    });
  });
});
