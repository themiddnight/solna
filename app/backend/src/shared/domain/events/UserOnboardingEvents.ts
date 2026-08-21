import { DomainEvent } from './DomainEvent';

/**
 * User Onboarding Coordination Events
 * 
 * Events used to coordinate complex user onboarding workflows
 * across multiple bounded contexts.
 * 
 * Requirements: 5.2, 5.3, 10.4
 */

/**
 * Published when a user joins a room and onboarding process begins
 */
export class UserJoinedRoom extends DomainEvent {
  constructor(
    roomId: string,
    public readonly userId: string,
    public readonly username: string,
    public readonly role: string
  ) {
    super(roomId);
  }
}

/**
 * Published when user's instruments are prepared and ready
 */
export class UserInstrumentsReady extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly instruments: string[],
    public readonly synthParams: Record<string, unknown>
  ) {
    super(userId);
  }
}

/**
 * Published when user's audio routing is configured and ready
 */
export class UserAudioRoutingReady extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly audioBusId: string,
    public readonly routingConfig: Record<string, unknown>
  ) {
    super(userId);
  }
}

/**
 * Published when user's voice connection is established and ready
 */
export class UserVoiceConnectionReady extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly connectionId: string,
    public readonly connectionType: 'mesh' | 'streaming'
  ) {
    super(userId);
  }
}

/**
 * Published when all user preparation is complete and user is ready for playback
 */
export class UserReadyForPlayback extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly readyComponents: string[]
  ) {
    super(userId);
  }
}

/**
 * Published when user onboarding fails and needs cleanup
 */
export class UserOnboardingFailed extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly reason: string,
    public readonly failedComponent: string
  ) {
    super(userId);
  }
}

/**
 * Published when user onboarding times out
 */
export class UserOnboardingTimeout extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly timeoutAfterMs: number,
    public readonly completedComponents: string[]
  ) {
    super(userId);
  }
}
