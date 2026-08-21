import NodeCache from 'node-cache';
import { CACHE_KEYS } from '../../constants/CacheKeys';

export class CacheService {
  private static instance: CacheService | undefined;
  private readonly cache: NodeCache;

  private constructor() {
    this.cache = new NodeCache({
      stdTTL: 300, // 5 minutes default TTL
      checkperiod: 30, // Check for expired keys every 30 seconds
      maxKeys: 10000, // Maximum number of keys (supports ~1000+ concurrent users)
      useClones: false, // Don't clone objects for better performance
    });
  }

  static getInstance(): CacheService {
    CacheService.instance ??= new CacheService();
    return CacheService.instance;
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key);
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    if (ttl != null) {
      return this.cache.set(key, value, ttl);
    }
    return this.cache.set(key, value);
  }

  del(key: string): number {
    return this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
  }

  getStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  // Cache room data with appropriate TTL
  cacheRoom(roomId: string, roomData: unknown, ttl: number = 300): boolean {
    return this.set(CACHE_KEYS.room(roomId), roomData, ttl);
  }

  // Cache room list with shorter TTL
  cacheRoomList(key: string, roomList: unknown[], ttl: number = 60): boolean {
    return this.set(CACHE_KEYS.roomsList(key), roomList, ttl);
  }

  // Get cached room data
  getCachedRoom(roomId: string): unknown | undefined {
    return this.get(CACHE_KEYS.room(roomId));
  }

  // Get cached room list
  getCachedRoomList(key: string): unknown[] | undefined {
    return this.get(CACHE_KEYS.roomsList(key));
  }

  // Invalidate room cache when room changes
  invalidateRoom(roomId: string): number {
    return this.del(CACHE_KEYS.room(roomId));
  }

  // Invalidate all room-related caches
  invalidateRoomCaches(): void {
    const keys = this.cache.keys();
    keys.forEach((key: string) => {
      if (key.startsWith(CACHE_KEYS.ROOM_PREFIX) || key.startsWith(CACHE_KEYS.ROOMS_LIST_PREFIX)) {
        this.cache.del(key);
      }
    });
  }
} 
