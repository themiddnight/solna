import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import type { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * MemberJoined Domain Event
 * 
 * Published when a user joins a room.
 * 
 * Requirements: 5.1, 5.2
 */
export class MemberJoined extends DomainEvent {
  constructor(
    roomId: RoomId,
    public readonly userId: UserId,
    public readonly username: string,
    public readonly role: string
  ) {
    super(roomId.toString());
  }
}