import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import type { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * MemberLeft Domain Event
 * 
 * Published when a user leaves a room.
 * 
 * Requirements: 5.1, 5.2
 */
export class MemberLeft extends DomainEvent {
  constructor(
    roomId: RoomId,
    public readonly userId: UserId,
    public readonly username: string,
    public readonly isIntentional: boolean
  ) {
    super(roomId.toString());
  }
}