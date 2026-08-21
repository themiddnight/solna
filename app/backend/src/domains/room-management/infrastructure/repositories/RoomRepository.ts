import type { Room, BandMember, Audience } from "../../../../types";
import { METRONOME_CONSTANTS, type ScaleSelection } from "@jam-band/shared";
import { CacheService } from "../../../../shared/infrastructure/caching/CacheService";
import { redisStateService } from "../../../../shared/infrastructure/caching/RedisStateService";
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { roomUserRepository } from "./RoomUserRepository";
import { REDIS_KEYS } from "../../../../shared/constants/RedisKeys";

// Narrow shape for reading persisted scale off raw Redis room data.
// Includes the legacy pre-rename key so old persisted rooms still deserialize correctly.
/**
 * Rooms persisted before the beat-grid rename carry `lastTickTimestamp` (the last
 * server tick) where `beatZeroAt` (the grid origin) now lives. The two are within
 * a beat of each other, so reading the old field keeps a live room in phase.
 * Removable once all pre-rename rooms have aged out (24h TTL).
 */
function deserializeMetronome(value: unknown): Room['metronome'] {
  const persisted = (value ?? {}) as { bpm?: number; beatZeroAt?: number; lastTickTimestamp?: number };
  return {
    bpm: persisted.bpm ?? METRONOME_CONSTANTS.DEFAULT_BPM,
    beatZeroAt: persisted.beatZeroAt ?? persisted.lastTickTimestamp ?? Date.now(),
  };
}

interface PersistedRoomScale {
  roomScale?: ScaleSelection;
  // legacy ownerScale fallback — removable after all pre-rename rooms age out (24h TTL)
  ownerScale?: ScaleSelection;
}

/* eslint-disable @typescript-eslint/member-ordering */
export class RoomRepository {
  // Local cache for fast access and fallback when Redis is unavailable
  private readonly rooms = new Map<string, Room>();
  private readonly cacheService = CacheService.getInstance();

  // Track server restart for reconnection window
  private readonly serverStartedAt: Date = new Date();
  private static readonly RECONNECTION_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

  constructor() { }

  /**
   * Check if we're still within the reconnection window after server restart
   */
  isInReconnectionWindow(): boolean {
    return Date.now() - this.serverStartedAt.getTime() < RoomRepository.RECONNECTION_WINDOW_MS;
  }

  /**
   * Get room by ID
   * Priority: NodeCache -> Redis -> LocalMap
   * Now loads users from RoomUserRepository (new structure)
   */
   
  async getRoom(roomId: string): Promise<Room | undefined> {
    // 1. Try NodeCache first (fastest)
    const cachedRoom = this.cacheService.getCachedRoom(roomId);
    if (cachedRoom !== undefined) {
      // Clone before mutating to avoid corrupting the shared cached reference
      const roomToReturn: Room = { ...(cachedRoom as Room) };
      try {
        const [bandMembers, audiences] = await Promise.all([
          roomUserRepository.getBandMembers(roomId),
          roomUserRepository.getAudiences(roomId),
        ]);
        roomToReturn.bandMembers = new Map(bandMembers.map(m => [m.id, m]));
        roomToReturn.audiences = new Map(audiences.map(a => [a.id, a]));
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'RoomRepository.getRoom - cachedRoom user sync error',
          roomId,
        });
      }
      return roomToReturn;
    }

    // 2. Try Redis
    try {
      const redisRoomData = await redisStateService.hget<Record<string, unknown>>(REDIS_KEYS.ROOMS_HASH, roomId);
      if (redisRoomData) {
        const room = this.deserializeRoom(redisRoomData);
        // Clone before mutating so the stored references in this.rooms and
        // NodeCache are not corrupted by downstream callers mutating the returned object
        const roomToReturn = { ...room };

        // Load users from RoomUserRepository (new structure)
        const [bandMembers, audiences] = await Promise.all([
          roomUserRepository.getBandMembers(roomId),
          roomUserRepository.getAudiences(roomId),
        ]);

        // Convert arrays to Maps
        roomToReturn.bandMembers = new Map(bandMembers.map(m => [m.id, m]));
        roomToReturn.audiences = new Map(audiences.map(a => [a.id, a]));

        // Store the clean deserialized object and cache the populated clone
        this.rooms.set(roomId, room);
        this.cacheService.cacheRoom(roomId, roomToReturn, 15);
        return roomToReturn;
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomRepository.getRoom - Redis error',
        roomId,
      });
    }

    // 3. Fallback to local map
    const localRoom = this.rooms.get(roomId);
    if (localRoom) {
      // Clone before mutating to avoid corrupting the in-memory map reference
      const roomToReturn = { ...localRoom };
      try {
        const [bandMembers, audiences] = await Promise.all([
          roomUserRepository.getBandMembers(roomId),
          roomUserRepository.getAudiences(roomId),
        ]);
        roomToReturn.bandMembers = new Map(bandMembers.map(m => [m.id, m]));
        roomToReturn.audiences = new Map(audiences.map(a => [a.id, a]));
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'RoomRepository.getRoom - fallback room user sync error',
          roomId,
        });
      }
      this.cacheService.cacheRoom(roomId, roomToReturn, 15);
      return roomToReturn;
    }

    return undefined;
  }

  /**
   * Save room to storage
   * Writes to: LocalMap + NodeCache + Redis
   */
  async saveRoom(room: Room): Promise<void> {
    // Always update local map and cache
    this.rooms.set(room.id, room);
    this.cacheService.cacheRoom(room.id, room);

    // Write to Redis
    try {
      const serializedRoom = this.serializeRoom(room);
      await Promise.all([
        redisStateService.hset(REDIS_KEYS.ROOMS_HASH, room.id, serializedRoom),
        redisStateService.sadd(REDIS_KEYS.ROOM_IDS_SET, room.id),
      ]);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomRepository.saveRoom - Redis error',
        roomId: room.id,
      });
    }
  }

  /**
   * Delete room from storage
   */
  async deleteRoom(roomId: string): Promise<boolean> {
    const isDeleted = this.rooms.delete(roomId);

    if (isDeleted) {
      this.cacheService.invalidateRoom(roomId);
      this.cacheService.invalidateRoomCaches();
    }

    // Delete from Redis
    try {
      await Promise.all([
        redisStateService.hdel(REDIS_KEYS.ROOMS_HASH, roomId),
        redisStateService.srem(REDIS_KEYS.ROOM_IDS_SET, roomId),
      ]);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomRepository.deleteRoom - Redis error',
        roomId,
      });
    }

    return isDeleted;
  }

  /**
   * Get all rooms
   * From Redis if isEnabled, otherwise from local map
   */
  async getAllRooms(): Promise<Room[]> {
    // Try Redis first
    try {
      const redisRooms = await redisStateService.hgetall<Record<string, unknown>>(REDIS_KEYS.ROOMS_HASH);

      if (redisRooms.size > 0) {
        // Sync to local map
        const roomsToSync = Array.from(redisRooms.entries());
        await Promise.all(roomsToSync.map(async ([id, serializedRoom]) => {
          try {
            const room = this.deserializeRoom(serializedRoom);

            // Load users from RoomUserRepository
            const [bandMembers, audiences] = await Promise.all([
              roomUserRepository.getBandMembers(id),
              roomUserRepository.getAudiences(id),
            ]);
            room.bandMembers = new Map(bandMembers.map(m => [m.id, m]));
            room.audiences = new Map(audiences.map(a => [a.id, a]));

            this.rooms.set(id, room);
          } catch (err) {
            loggingService.logError(err as Error, {
              context: 'RoomRepository.getAllRooms.deserialize',
              roomId: id
            });
          }
        }));
        // Do not return here - fall through to return merged local map
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomRepository.getAllRooms',
      });
      // Fall through to local map
    }

    return Array.from(this.rooms.values());
  }

  /**
   * Cache room list (for lobby)
   */
  async cacheRoomList(key: string, rooms: Record<string, unknown>[], ttl: number): Promise<void> {
    this.cacheService.cacheRoomList(key, rooms, ttl);
  }

  /**
   * Invalidate list caches
   */
  async invalidateListCaches(): Promise<void> {
    this.cacheService.invalidateRoomCaches();
  }

  /**
   * Invalidate single room cache
   */
  async invalidateRoomCache(roomId: string): Promise<void> {
    this.cacheService.invalidateRoom(roomId);
  }

  /**
   * Sync local state from Redis (useful after worker restart)
   * Also migrates users from old structure to new structure
   */
  async syncFromRedis(): Promise<number> {
    try {
      const redisRooms = await redisStateService.hgetall<Record<string, unknown>>(REDIS_KEYS.ROOMS_HASH);
      let migratedUsersCount = 0;

      for (const [id, serializedRoom] of redisRooms.entries()) {
        const room = this.deserializeRoom(serializedRoom);

        // Migration: Move users from old structure to new structure
        if (room.bandMembers.size > 0) {
          for (const [_userId, member] of room.bandMembers.entries()) {
            await roomUserRepository.addUser(id, member);
            migratedUsersCount++;
          }
          // Clear bandMembers from room object after migration
          room.bandMembers = new Map();
        }

        if (room.audiences.size > 0) {
          for (const [_userId, audience] of room.audiences.entries()) {
            await roomUserRepository.addUser(id, audience);
            migratedUsersCount++;
          }
          // Clear audiences from room object after migration
          room.audiences = new Map();
        }

        this.rooms.set(id, room);
        this.cacheService.cacheRoom(id, room);
      }

      loggingService.logInfo('RoomRepository synced from Redis', {
        roomCount: redisRooms.size,
        migratedUsers: migratedUsersCount,
      });

      return redisRooms.size;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomRepository.syncFromRedis',
      });
      return 0;
    }
  }

  /**
   * Get room count (for monitoring)
   */
  async getRoomCount(): Promise<{ local: number; redis: number }> {
    const local = this.rooms.size;
    let redis = 0;

    try {
      redis = await redisStateService.hlen(REDIS_KEYS.ROOMS_HASH);
    } catch {
      redis = -1;
    }

    return { local, redis };
  }

  // Helper to serialize Room for Redis storage
  // Converts Maps to Arrays explicitly because JSON.stringify doesn't handle Maps
  private serializeRoom(room: Room): Record<string, unknown> {
    return {
      ...room,
      bandMembers: Array.from(room.bandMembers.entries()),
      audiences: Array.from(room.audiences.entries()),
      pendingMembers: Array.from(room.pendingMembers.entries()),
      // Keep old 'users' for backward compatibility during migration
      users: Array.from([
        ...room.bandMembers.entries(),
        ...room.audiences.entries()
      ]),
    };
  }

  // Helper to deserialize Redis data back to Room object
  // Converts Arrays back to Maps and proper Date objects
  private deserializeRoom(data: Record<string, unknown>): Room {

    // Migration: if old format (has 'users' but not 'bandMembers'), convert it
    if (data.users !== null && data.users !== undefined && data.bandMembers === undefined && data.audiences === undefined) {
      const users = Array.isArray(data.users) ? new Map(data.users as [string, Record<string, unknown>][]) : new Map();
      const bandMembers = new Map<string, BandMember>();
      const audiences = new Map<string, Audience>();

      for (const [id, user] of users.entries()) {
        const userObj = user as Record<string, unknown>;
        const userId = id as string;
        const role = userObj.role as string;
        if (role === 'audience') {
          const audienceObj: Audience = {
            ...userObj,
            joinedAt: userObj.joinedAt !== null && userObj.joinedAt !== undefined ? (userObj.joinedAt as Date) : new Date()
          } as unknown as Audience;
          audiences.set(userId, audienceObj);
        } else {
          const bandMemberObj: BandMember = userObj as unknown as BandMember;
          bandMembers.set(userId, bandMemberObj);
        }
      }

      return {
        id: data.id as string,
        name: data.name as string,
        roomType: data.roomType as Room['roomType'],
        owner: data.owner as string,
        bandMembers,
        audiences,
        pendingMembers: Array.isArray(data.pendingMembers)
          ? (new Map((data.pendingMembers as [string, Record<string, unknown>][]).map(([k, v]) => [k, v as unknown as BandMember])) as unknown as Map<string, BandMember>)
          : (new Map<string, BandMember>()),
        isPrivate: data.isPrivate as boolean,
        isHidden: data.isHidden as boolean,
        createdAt: data.createdAt !== null && data.createdAt !== undefined ? new Date(data.createdAt as string | number | Date) : new Date(),
        metronome: deserializeMetronome(data.metronome),
        ...(typeof data.description === 'string' && data.description.length > 0 ? { description: data.description } : {}),
        ...(() => {
          const persisted = data as PersistedRoomScale;
          // legacy ownerScale fallback — removable after all pre-rename rooms age out (24h TTL)
          const roomScale = persisted.roomScale ?? persisted.ownerScale;
          return roomScale !== undefined ? { roomScale } : {};
        })(),
        ...(data.isBroadcasting === true ? { isBroadcasting: true } : {}),
        ...(data.isIsolated === true ? { isIsolated: true } : { isIsolated: false }),
        ...(typeof data.projectId === 'string' && data.projectId.length > 0 ? { projectId: data.projectId } : {}),
        ...(typeof data.bandMemberInviteCode === 'string' && data.bandMemberInviteCode.length > 0 ? { bandMemberInviteCode: data.bandMemberInviteCode } : {}),
        ...(typeof data.audienceInviteCode === 'string' && data.audienceInviteCode.length > 0 ? { audienceInviteCode: data.audienceInviteCode } : {}),
      } as Room;
    }

    // New format - ensure bandMembers and audiences always exist
    return {
      id: data.id as string,
      name: data.name as string,
      roomType: data.roomType as Room['roomType'],
      owner: data.owner as string,
      bandMembers: (data.bandMembers !== null && data.bandMembers !== undefined && Array.isArray(data.bandMembers))
        ? (new Map((data.bandMembers as [string, Record<string, unknown>][]).map(([k, v]) => [k, v as unknown as BandMember])) as unknown as Map<string, BandMember>)
        : (new Map<string, BandMember>()),
      audiences: (data.audiences !== null && data.audiences !== undefined && Array.isArray(data.audiences))
        ? (new Map((data.audiences as [string, Record<string, unknown>][]).map(([k, v]) => [k, v as unknown as Audience])) as unknown as Map<string, Audience>)
        : (new Map<string, Audience>()),
      pendingMembers: (data.pendingMembers !== null && data.pendingMembers !== undefined && Array.isArray(data.pendingMembers))
        ? (new Map((data.pendingMembers as [string, Record<string, unknown>][]).map(([k, v]) => [k, v as unknown as BandMember])) as unknown as Map<string, BandMember>)
        : (new Map<string, BandMember>()),
      isPrivate: data.isPrivate as boolean,
      isHidden: data.isHidden as boolean,
      createdAt: data.createdAt !== null && data.createdAt !== undefined ? new Date(data.createdAt as string | number | Date) : new Date(),
      metronome: deserializeMetronome(data.metronome),
      ...(typeof data.description === 'string' && data.description.length > 0 ? { description: data.description } : {}),
      ...(() => {
        const persisted = data as PersistedRoomScale;
        // legacy ownerScale fallback — removable after all pre-rename rooms age out (24h TTL)
        const roomScale = persisted.roomScale ?? persisted.ownerScale;
        return roomScale !== undefined ? { roomScale } : {};
      })(),
      ...(data.isBroadcasting === true ? { isBroadcasting: true } : {}),
      ...(data.isIsolated === true ? { isIsolated: true } : { isIsolated: false }),
      ...(typeof data.projectId === 'string' && data.projectId.length > 0 ? { projectId: data.projectId } : {}),
      ...(typeof data.bandMemberInviteCode === 'string' && data.bandMemberInviteCode.length > 0 ? { bandMemberInviteCode: data.bandMemberInviteCode } : {}),
      ...(typeof data.audienceInviteCode === 'string' && data.audienceInviteCode.length > 0 ? { audienceInviteCode: data.audienceInviteCode } : {}),
    } as Room;
  }
}
