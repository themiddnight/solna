/**
 * Unit Tests for Search and Pagination functionality
 * Tests the search/pagination logic across rooms, projects, and bands endpoints
 */
import { createPaginatedResponse, PAGINATION_LIMITS, MAX_PAGE_LIMIT } from '@jam-band/shared';
import { parsePaginationParams } from '@/shared/utils/paginationUtils';

describe('Search and Pagination', () => {
  const defaultPaginationOptions = { defaultLimit: PAGINATION_LIMITS.ROOMS };

  describe('parsePaginationParams', () => {
    it('should return default values when no params provided', () => {
      const result = parsePaginationParams({}, defaultPaginationOptions);

      expect(result.search).toBe('');
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.skip).toBe(0);
    });

    it('should parse search query and trim whitespace', () => {
      const result = parsePaginationParams({ search: '  test query  ' }, defaultPaginationOptions);

      expect(result.search).toBe('test query');
    });

    it('should parse valid page number', () => {
      const result = parsePaginationParams({ page: '5' }, defaultPaginationOptions);

      expect(result.page).toBe(5);
      expect(result.skip).toBe(80); // (5-1) * 20 = 80
    });

    it('should default to page 1 for invalid page numbers', () => {
      expect(parsePaginationParams({ page: '0' }, defaultPaginationOptions).page).toBe(1);
      expect(parsePaginationParams({ page: '-1' }, defaultPaginationOptions).page).toBe(1);
      expect(parsePaginationParams({ page: 'abc' }, defaultPaginationOptions).page).toBe(1);
    });

    it('should parse valid limit', () => {
      const result = parsePaginationParams({ limit: '10' }, defaultPaginationOptions);

      expect(result.limit).toBe(10);
    });

    it('should enforce maximum limit', () => {
      const result = parsePaginationParams({ limit: '500' }, defaultPaginationOptions);

      expect(result.limit).toBe(MAX_PAGE_LIMIT);
    });

    it('should use default limit for invalid limit values', () => {
      const result = parsePaginationParams({ limit: 'abc' }, defaultPaginationOptions);

      expect(result.limit).toBe(PAGINATION_LIMITS.ROOMS);
    });

    it('should calculate skip correctly for large page numbers', () => {
      const result = parsePaginationParams({ page: '10', limit: '25' }, defaultPaginationOptions);

      expect(result.page).toBe(10);
      expect(result.limit).toBe(25);
      expect(result.skip).toBe(225); // (10-1) * 25 = 225
    });
  });

  describe('createPaginatedResponse', () => {
    it('should create correct response with items', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = createPaginatedResponse(items, 10, 1, 5);

      expect(result.items).toEqual(items);
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(5);
      expect(result.totalPages).toBe(2);
    });

    it('should calculate totalPages correctly', () => {
      expect(createPaginatedResponse([], 100, 1, 20).totalPages).toBe(5);
      expect(createPaginatedResponse([], 21, 1, 20).totalPages).toBe(2);
      expect(createPaginatedResponse([], 20, 1, 20).totalPages).toBe(1);
      expect(createPaginatedResponse([], 0, 1, 20).totalPages).toBe(0);
    });

    it('should handle empty items array', () => {
      const result = createPaginatedResponse([], 0, 1, 20);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('PAGINATION_LIMITS constants', () => {
    it('should have correct default values', () => {
      expect(PAGINATION_LIMITS.ROOMS).toBe(20);
      expect(PAGINATION_LIMITS.PROJECTS).toBe(20);
      expect(PAGINATION_LIMITS.BANDS).toBe(20);
    });

    it('should have MAX_PAGE_LIMIT defined', () => {
      expect(MAX_PAGE_LIMIT).toBe(100);
    });
  });
});

describe('Room List Search and Pagination', () => {
  // Mock room data for testing
  const mockRooms = [
    { id: '1', name: 'Jazz Room', description: 'Jazz music production' },
    { id: '2', name: 'Rock Studio', description: 'Rock band practice' },
    { id: '3', name: 'Electronic Lab', description: 'EDM and electronica' },
    { id: '4', name: 'Jazz Lounge', description: 'Jazz jam sessions' },
    { id: '5', name: 'Pop Factory', description: 'Pop music creation' },
  ];

  describe('Search filtering', () => {
    it('should filter rooms by name', () => {
      const search = 'jazz';
      const filtered = mockRooms.filter(room =>
        room.name.toLowerCase().includes(search.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.id)).toEqual(['1', '4']);
    });

    it('should filter rooms by description', () => {
      const search = 'production';
      const filtered = mockRooms.filter(room =>
        room.description.toLowerCase().includes(search.toLowerCase())
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe('1');
    });

    it('should filter rooms by name or description', () => {
      const search = 'rock';
      const filtered = mockRooms.filter(room =>
        room.name.toLowerCase().includes(search.toLowerCase()) ||
        room.description.toLowerCase().includes(search.toLowerCase())
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe('2');
    });

    it('should return empty array for no matches', () => {
      const search = 'nonexistent';
      const filtered = mockRooms.filter(room =>
        room.name.toLowerCase().includes(search.toLowerCase()) ||
        room.description.toLowerCase().includes(search.toLowerCase())
      );

      expect(filtered).toHaveLength(0);
    });

    it('should be case insensitive', () => {
      const search = 'JAZZ';
      const filtered = mockRooms.filter(room =>
        room.name.toLowerCase().includes(search.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
    });
  });

  describe('Pagination', () => {
    it('should paginate results correctly', () => {
      const page = 1;
      const limit = 2;
      const skip = (page - 1) * limit;
      const paginated = mockRooms.slice(skip, skip + limit);

      expect(paginated).toHaveLength(2);
      expect(paginated.map(r => r.id)).toEqual(['1', '2']);
    });

    it('should return correct page for middle pages', () => {
      const page = 2;
      const limit = 2;
      const skip = (page - 1) * limit;
      const paginated = mockRooms.slice(skip, skip + limit);

      expect(paginated).toHaveLength(2);
      expect(paginated.map(r => r.id)).toEqual(['3', '4']);
    });

    it('should return remaining items for last page', () => {
      const page = 3;
      const limit = 2;
      const skip = (page - 1) * limit;
      const paginated = mockRooms.slice(skip, skip + limit);

      expect(paginated).toHaveLength(1);
      expect(paginated[0]!.id).toBe('5');
    });

    it('should return empty array for page beyond results', () => {
      const page = 10;
      const limit = 2;
      const skip = (page - 1) * limit;
      const paginated = mockRooms.slice(skip, skip + limit);

      expect(paginated).toHaveLength(0);
    });
  });
});
