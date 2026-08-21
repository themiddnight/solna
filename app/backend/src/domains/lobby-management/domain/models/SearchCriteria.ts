import { RoomCapacityStatus, RoomActivityStatus } from './RoomListing';

/**
 * SearchCriteria Value Object
 * 
 * Encapsulates search and filtering criteria for room discovery.
 * Provides validation and query building functionality.
 * 
 * Requirements: 3.1, 9.1
 */
export class SearchCriteria {
  constructor(
    public readonly searchTerm?: string,
    public readonly genres: string[] = [],
    public readonly includePrivate: boolean = false,
    public readonly includeFullRooms: boolean = false,
    public readonly minMembers?: number,
    public readonly maxMembers?: number,
    public readonly capacityStatus?: RoomCapacityStatus[],
    public readonly activityStatus?: RoomActivityStatus[],
    public readonly sortBy: SortBy = SortBy.LastActivity,
    public readonly sortOrder: SortOrder = SortOrder.Desc,
    public readonly limit: number = 50,
    public readonly offset: number = 0
  ) {
    this.validate();
  }

  /**
   * Creates default search criteria for browsing all rooms
   */
  static default(): SearchCriteria {
    return new SearchCriteria();
  }

  /**
   * Creates search criteria from a query object (e.g., from HTTP request)
   */
  static fromQuery(query: SearchQuery): SearchCriteria {
    return new SearchCriteria(
      query.searchTerm,
      query.genres ?? [],
      query.includePrivate ?? false,
      query.includeFullRooms ?? false,
      query.minMembers,
      query.maxMembers,
      query.capacityStatus,
      query.activityStatus,
      query.sortBy ?? SortBy.LastActivity,
      query.sortOrder ?? SortOrder.Desc,
      Math.min(query.limit ?? 50, 100), // Cap at 100
      query.offset ?? 0
    );
  }

  /**
   * Creates search criteria for finding rooms by genre
   */
  static forGenres(genres: string[]): SearchCriteria {
    return new SearchCriteria(
      undefined,
      genres,
      false,
      false,
      undefined,
      undefined,
      undefined,
      [RoomActivityStatus.Active, RoomActivityStatus.Idle],
      SortBy.MemberCount,
      SortOrder.Desc
    );
  }

  /**
   * Creates search criteria for finding active rooms with available space
   */
  static forAvailableRooms(): SearchCriteria {
    return new SearchCriteria(
      undefined,
      [],
      false,
      false,
      undefined,
      undefined,
      [RoomCapacityStatus.Available, RoomCapacityStatus.NearlyFull],
      [RoomActivityStatus.Active, RoomActivityStatus.Idle],
      SortBy.LastActivity,
      SortOrder.Desc
    );
  }

  /**
   * Creates search criteria for text search
   */
  static forTextSearch(searchTerm: string): SearchCriteria {
    return new SearchCriteria(
      searchTerm,
      [],
      true, // Include private rooms in search results
      false,
      undefined,
      undefined,
      undefined,
      [RoomActivityStatus.Active, RoomActivityStatus.Idle],
      SortBy.Relevance,
      SortOrder.Desc
    );
  }

  /**
   * Returns a new SearchCriteria with updated search term
   */
  withSearchTerm(searchTerm: string): SearchCriteria {
    return new SearchCriteria(
      searchTerm,
      this.genres,
      this.includePrivate,
      this.includeFullRooms,
      this.minMembers,
      this.maxMembers,
      this.capacityStatus,
      this.activityStatus,
      this.sortBy,
      this.sortOrder,
      this.limit,
      this.offset
    );
  }

  /**
   * Returns a new SearchCriteria with updated genres
   */
  withGenres(genres: string[]): SearchCriteria {
    return new SearchCriteria(
      this.searchTerm,
      genres,
      this.includePrivate,
      this.includeFullRooms,
      this.minMembers,
      this.maxMembers,
      this.capacityStatus,
      this.activityStatus,
      this.sortBy,
      this.sortOrder,
      this.limit,
      this.offset
    );
  }

  /**
   * Returns a new SearchCriteria with updated sorting
   */
  withSorting(sortBy: SortBy, sortOrder: SortOrder = SortOrder.Desc): SearchCriteria {
    return new SearchCriteria(
      this.searchTerm,
      this.genres,
      this.includePrivate,
      this.includeFullRooms,
      this.minMembers,
      this.maxMembers,
      this.capacityStatus,
      this.activityStatus,
      sortBy,
      sortOrder,
      this.limit,
      this.offset
    );
  }

  /**
   * Returns a new SearchCriteria with updated pagination
   */
  withPagination(limit: number, offset: number): SearchCriteria {
    return new SearchCriteria(
      this.searchTerm,
      this.genres,
      this.includePrivate,
      this.includeFullRooms,
      this.minMembers,
      this.maxMembers,
      this.capacityStatus,
      this.activityStatus,
      this.sortBy,
      this.sortOrder,
      limit,
      offset
    );
  }

  /**
   * Checks if the criteria has any active filters
   */
  hasFilters(): boolean {
    return (
      (this.searchTerm !== undefined && this.searchTerm.length > 0) ||
      this.genres.length > 0 ||
      this.includePrivate ||
      this.includeFullRooms ||
      this.minMembers !== undefined ||
      this.maxMembers !== undefined ||
      (this.capacityStatus !== undefined && this.capacityStatus.length > 0) ||
      (this.activityStatus !== undefined && this.activityStatus.length > 0)
    );
  }

  /**
   * Checks if the criteria is for text search
   */
  isTextSearch(): boolean {
    return this.searchTerm !== undefined && this.searchTerm.trim().length > 0;
  }

  /**
   * Gets a hash of the criteria for caching purposes
   */
  getCacheKey(): string {
    const parts = [
      this.searchTerm ?? '',
      [...this.genres].sort().join(','),
      this.includePrivate.toString(),
      this.includeFullRooms.toString(),
      this.minMembers?.toString() ?? '',
      this.maxMembers?.toString() ?? '',
      this.capacityStatus !== undefined ? [...this.capacityStatus].sort().join(',') : '',
      this.activityStatus !== undefined ? [...this.activityStatus].sort().join(',') : '',
      this.sortBy,
      this.sortOrder,
      this.limit.toString(),
      this.offset.toString()
    ];

    return Buffer.from(parts.join('|')).toString('base64');
  }

  equals(other: SearchCriteria): boolean {
    return this.getCacheKey() === other.getCacheKey();
  }

  private validate(): void {
    if (this.limit < 1 || this.limit > 100) {
      throw new Error('Limit must be between 1 and 100');
    }

    if (this.offset < 0) {
      throw new Error('Offset cannot be negative');
    }

    if (this.minMembers !== undefined && this.minMembers < 0) {
      throw new Error('Min members cannot be negative');
    }

    if (this.maxMembers !== undefined && this.maxMembers < 1) {
      throw new Error('Max members must be at least 1');
    }

    if (this.minMembers !== undefined && this.maxMembers !== undefined && this.minMembers > this.maxMembers) {
      throw new Error('Min members cannot be greater than max members');
    }

    if (this.genres.length > 10) {
      throw new Error('Cannot filter by more than 10 genres');
    }

    if (this.searchTerm !== undefined && this.searchTerm.length > 100) {
      throw new Error('Search term cannot exceed 100 characters');
    }
  }
}

export enum SortBy {
  Name = 'name',
  MemberCount = 'memberCount',
  CreatedAt = 'createdAt',
  LastActivity = 'lastActivity',
  Relevance = 'relevance'
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc'
}

export interface SearchQuery {
  searchTerm?: string;
  genres?: string[];
  includePrivate?: boolean;
  includeFullRooms?: boolean;
  minMembers?: number;
  maxMembers?: number;
  capacityStatus?: RoomCapacityStatus[];
  activityStatus?: RoomActivityStatus[];
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  limit?: number;
  offset?: number;
}

export interface SearchResult<T> {
  items: T[];
  totalCount: number;
  hasMore: boolean;
  nextOffset?: number;
}
