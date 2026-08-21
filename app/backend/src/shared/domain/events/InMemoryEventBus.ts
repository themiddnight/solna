/**
 * In-memory event bus implementation
 */

import type { EventBus, DomainEvent, EventHandler } from './EventBus';
import { eventProcessingMonitor } from '../../infrastructure/monitoring';

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();

  /**
   * Subscribe to an event type
   */
  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    
    this.handlers.get(eventType)!.push(handler as EventHandler);
  }

  /**
   * Publish a single event
   */
  async publish(event: DomainEvent): Promise<void> {
    const eventType = event.constructor.name;
    const handlers = this.handlers.get(eventType) || [];
    
    if (handlers.length === 0) {
      return;
    }

    await eventProcessingMonitor.monitorEventProcessing(
      eventType,
      handlers.length,
      async () => {
        await Promise.all(handlers.map(handler => handler(event)));
      }
    );
  }

  /**
   * Publish multiple events
   */
  async publishAll(events: DomainEvent[]): Promise<void> {
    await Promise.all(events.map(event => this.publish(event)));
  }

  /**
   * Unsubscribe from an event type
   */
  unsubscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler as EventHandler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Clear all handlers (useful for testing)
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get handler count for an event type
   */
  getHandlerCount(eventType: string): number {
    const handlers = this.handlers.get(eventType);
    return handlers?.length ?? 0;
  }
}
