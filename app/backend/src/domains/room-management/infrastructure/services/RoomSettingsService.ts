import type { RoomRepository } from "../repositories/RoomRepository";

export class RoomSettingsService {
  constructor(private readonly roomRepository: RoomRepository) { }

  // Update room settings with proper cache invalidation
  async updateRoomSettings(roomId: string, settings: {
    name?: string;
    description?: string;
    isPrivate?: boolean;
    isHidden?: boolean;
    isIsolated?: boolean;
  }): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return false;

    // Apply updates
    if (settings.name !== undefined) room.name = settings.name;
    if (settings.description !== undefined) room.description = settings.description;
    if (settings.isPrivate !== undefined) room.isPrivate = settings.isPrivate;
    if (settings.isHidden !== undefined) room.isHidden = settings.isHidden;
    if (settings.isIsolated !== undefined) room.isIsolated = settings.isIsolated;

    // Invalidate caches to ensure room list updates reflect the changes
    await this.roomRepository.saveRoom(room);
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return true;
  }

  // Toggle audience broadcast for a room
  async toggleBroadcast(roomId: string, isBroadcasting: boolean): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return false;

    room.isBroadcasting = isBroadcasting;

    // Invalidate caches to ensure room list updates reflect the changes
    await this.roomRepository.saveRoom(room);
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return true;
  }

  // Get broadcast status for a room
  async getBroadcastStatus(roomId: string): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    return room?.isBroadcasting ?? false;
  }
}
