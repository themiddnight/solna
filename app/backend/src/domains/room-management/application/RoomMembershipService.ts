 
import type { User, BandMember, Audience } from "../../../types";
import type { RoomRepository } from "../infrastructure/repositories/RoomRepository";
import type { RoomUserService } from "../domain/services/RoomUserService";
import type { EffectChainService } from "../../audio-processing/infrastructure/services/EffectChainService";
import type { RoomSessionManager } from "../infrastructure/services/RoomSessionManager";
import { roomUserRepository } from "../infrastructure/repositories/RoomUserRepository";

export class RoomMembershipService {
  constructor(
    private readonly roomRepository: RoomRepository,
    private readonly roomUserService: RoomUserService,
    private readonly effectChainService: EffectChainService,
    private readonly roomSessionManager: RoomSessionManager
  ) { }

  async findUserInRoom(roomId: string, userId: string): Promise<User | undefined> {
    return (await this.roomUserService.findUserInRoom(roomId, userId)) as User | undefined;
  }

  async findUserInRoomByUsername(roomId: string, username: string): Promise<User | undefined> {
    return (await this.roomUserService.findUserInRoomByUsername(roomId, username)) as User | undefined;
  }

  async addUserToRoom(roomId: string, user: User): Promise<boolean> {
    return (await this.roomUserService.addUserToRoom(roomId, user, (u: User) => this.effectChainService.ensureUserEffectChains(u as BandMember))) as boolean;
  }

  async addPendingMember(roomId: string, member: BandMember): Promise<boolean> {
    return (await this.roomUserService.addPendingMember(roomId, member)) as boolean;
  }

  async approveMember(roomId: string, userId: string): Promise<BandMember | undefined> {
    return (await this.roomUserService.approveMember(roomId, userId)) as BandMember | undefined;
  }

  async rejectMember(roomId: string, userId: string): Promise<BandMember | undefined> {
    return (await this.roomUserService.rejectMember(roomId, userId)) as BandMember | undefined;
  }

  async removeUserFromRoom(
    roomId: string,
    userId: string,
    isIntendedLeave: boolean = false
  ): Promise<User | undefined> {
    return (await this.roomUserService.removeUserFromRoom(roomId, userId, isIntendedLeave)) as User | undefined;
  }

  async changeUserRole(
    roomId: string,
    userId: string,
    newRole: 'room_owner' | 'band_member' | 'audience',
  ): Promise<boolean> {
    return (await this.roomUserService.changeUserRole(roomId, userId, newRole)) as boolean;
  }

  async transferOwnership(
    roomId: string,
    newOwnerId: string,
    oldOwner?: BandMember
  ): Promise<{ newOwner: BandMember; oldOwner: BandMember } | undefined> {
    return (await this.roomUserService.transferOwnership(roomId, newOwnerId, oldOwner)) as { newOwner: BandMember; oldOwner: BandMember } | undefined;
  }

  async getAnyUserInRoom(roomId: string): Promise<User | undefined> {
    return (await this.roomUserService.getAnyUserInRoom(roomId)) as User | undefined;
  }

  async getOwnershipCandidate(roomId: string): Promise<BandMember | undefined> {
    return (await this.roomUserService.getOwnershipCandidate(roomId)) as BandMember | undefined;
  }

  async isRoomOwner(roomId: string, userId: string): Promise<boolean> {
    return (await this.roomUserService.isRoomOwner(roomId, userId)) as boolean;
  }

  async getRoomUsers(roomId: string): Promise<User[]> {
    return (await this.roomUserService.getRoomUsers(roomId)) as User[];
  }

  async getPendingMembers(roomId: string): Promise<BandMember[]> {
    return (await this.roomUserService.getPendingMembers(roomId)) as BandMember[];
  }

  async getBandMembers(roomId: string): Promise<BandMember[]> {
    // Use RoomUserRepository for atomic read (no race condition)
    return await roomUserRepository.getBandMembers(roomId);
  }

  async getAudiences(roomId: string): Promise<Audience[]> {
    // Use RoomUserRepository for atomic read (no race condition)
    return await roomUserRepository.getAudiences(roomId);
  }

  // Session Management related to User (moved from RoomService queries)
  
  async findSocketByUserId(userId: string, roomId?: string): Promise<string | undefined> {
    if (roomId) {
      return await this.roomSessionManager.findSocketByUserIdAsync(roomId, userId);
    }
    const rooms = await this.roomRepository.getAllRooms();
    for (const room of rooms) {
      const socketId = await this.roomSessionManager.findSocketByUserIdAsync(room.id, userId);
      if (socketId) return socketId;
    }
    return undefined;
  }

  async removeOldSessionsForUser(userId: string, currentSocketId: string, roomId?: string): Promise<string[]> {
    return this.roomSessionManager.removeOldSessionsForUser(userId, currentSocketId, roomId);
  }

  // Updates

  async updateUserInstrument(
    roomId: string,
    userId: string,
    instrument: string,
    category: string
  ): Promise<boolean> {
    // Use RoomUserRepository for atomic instrument update (no race condition)
    return await roomUserRepository.updateUserInstrument(roomId, userId, instrument, category);
  }

  async updateUserSynthParams(
    roomId: string,
    userId: string,
    synthParams: Record<string, unknown>
  ): Promise<boolean> {
    // Use RoomUserRepository for atomic synth params update (no race condition)
    return await roomUserRepository.updateUserSynthParams(roomId, userId, synthParams);
  }

  /** DEV-301: non-synth instrument pre-gain, sibling to updateUserSynthParams above. */
  async updateUserInstrumentParams(
    roomId: string,
    userId: string,
    instrumentParams: Record<string, unknown>
  ): Promise<boolean> {
    // Use RoomUserRepository for atomic instrument params update (no race condition)
    return await roomUserRepository.updateUserInstrumentParams(roomId, userId, instrumentParams);
  }

  async updateUserEffectChains(
    roomId: string,
    userId: string,
    effectChains: Record<string, unknown>
  ): Promise<boolean> {
    // Use RoomUserRepository for atomic effect chains update (no race condition)
    return await roomUserRepository.updateUserEffectChains(roomId, userId, effectChains);
  }

  ensureUserEffectChains(member: BandMember): void {
    this.effectChainService.ensureUserEffectChains(member);
  }

}
