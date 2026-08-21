import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';

/**
 * Published when one or more grace periods expire in a room.
 * Subscribers can use this to trigger room-closure checks or metrics/logging.
 */
export class GracePeriodsExpired extends DomainEvent {
  constructor(
    public readonly roomIds: string[],
  ) {
    // Use the first room ID as the aggregate ID; the payload carries the full list.
    super(roomIds[0] ?? 'unknown');
  }
}
