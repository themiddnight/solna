import { DomainEvent } from './DomainEvent';

/**
 * User Created Event
 * Published when a new user is created
 */
export class UserCreated extends DomainEvent {
  constructor(
    userId: string,
    public readonly username: string
  ) {
    super(userId);
  }
}

/**
 * User Profile Updated Event
 * Published when a user's profile is updated
 */
export class UserProfileUpdated extends DomainEvent {
  constructor(
    userId: string,
    public readonly changes: Record<string, unknown>
  ) {
    super(userId);
  }
}
