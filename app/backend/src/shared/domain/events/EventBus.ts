/**
 * Event bus interface and domain event base class
 */

export abstract class DomainEvent {
  public readonly occurredOn: Date;
  public readonly eventId: string;

  constructor(public readonly aggregateId: string) {
    this.occurredOn = new Date();
    this.eventId = crypto.randomUUID();
  }
}

export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void> | void;

export interface EventBus {
  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): void;
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: DomainEvent[]): Promise<void>;
  unsubscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): void;
}