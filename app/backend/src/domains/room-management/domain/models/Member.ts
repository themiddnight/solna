import type { UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * Member entity representing a user's membership in a room
 * 
 * Requirements: 1.1, 1.2
 */
export class Member {
  constructor(
    public readonly userId: UserId,
    public readonly username: string,
    public readonly role: MemberRole,
    public readonly joinedAt: Date = new Date()
  ) {}

  equals(other: Member): boolean {
    return this.userId.equals(other.userId);
  }

  hasRole(role: MemberRole): boolean {
    return this.role === role;
  }

  canKickOthers(): boolean {
    return this.role === MemberRole.RoomOwner;
  }

  canChangeSettings(): boolean {
    return this.role === MemberRole.RoomOwner;
  }
}

/**
 * Member roles within a room
 */
export enum MemberRole {
  RoomOwner = 'room_owner',
  BandMember = 'band_member',
  Audience = 'audience'
}
