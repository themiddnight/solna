/**
 * Behavioral tests for InMemoryEventBus — pins the exact dispatch and failure
 * semantics of the real implementation (no mocks; real DomainEvent subclasses
 * defined below).
 *
 * Pinned semantics:
 * - publish routes by `event.constructor.name` (exact string match — there is
 *   NO inheritance/base-class fallback: a handler subscribed under the base
 *   class name does not receive subclass events).
 * - unsubscribe is identity-based (indexOf/splice) and removes only the
 *   matching handler instance.
 * - publish with no handlers is a silent no-op — the early return happens
 *   BEFORE eventProcessingMonitor.monitorEventProcessing is invoked, so
 *   nothing is recorded for that event type.
 * - a handler that REJECTS (async) does not prevent other handlers from
 *   receiving the event — `Promise.all(handlers.map(...))` starts every
 *   handler. The failure is recorded by the monitor (success: false) and then
 *   RE-THROWN, so `publish` rejects with the original error.
 * - a handler that THROWS SYNCHRONOUSLY aborts the `handlers.map(...)`
 *   fan-out, so later handlers in the same publish are skipped. The failure is
 *   still recorded by the monitor and still rejects `publish`.
 */

import { InMemoryEventBus } from '../InMemoryEventBus';
import { DomainEvent } from '../EventBus';
import type { EventHandler } from '../EventBus';
import { eventProcessingMonitor, performanceMetrics } from '../../../infrastructure/monitoring';

/** Dispatch key for these tests is this exact constructor.name. */
class SampleOrderPlaced extends DomainEvent {}

class SampleItemRemoved extends DomainEvent {}

class SampleNoHandlersEvent extends DomainEvent {}

class SampleRejectedHandlerEvent extends DomainEvent {}

class SampleSyncThrowEvent extends DomainEvent {}

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  describe('publish', () => {
    it('dispatches to handlers registered under the event constructor.name', async () => {
      const received: SampleOrderPlaced[] = [];
      bus.subscribe('SampleOrderPlaced', (event: SampleOrderPlaced) => {
        received.push(event);
      });

      const event = new SampleOrderPlaced('aggregate-1');
      await bus.publish(event);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    it('does not dispatch to handlers registered under a base-class or unrelated name — keyed on constructor.name exactly', async () => {
      const received: DomainEvent[] = [];
      // Subscribed under the base class name — must NOT receive subclass events.
      bus.subscribe('DomainEvent', (event: DomainEvent) => {
        received.push(event);
      });
      // Subscribed under an unrelated concrete event name.
      bus.subscribe('SampleItemRemoved', (event: DomainEvent) => {
        received.push(event);
      });

      await bus.publish(new SampleOrderPlaced('aggregate-1'));

      expect(received).toHaveLength(0);
    });

    it('is a silent no-op when no handlers are registered — resolves, does not throw, and never touches the monitor', async () => {
      const event = new SampleNoHandlersEvent('aggregate-1');

      await expect(bus.publish(event)).resolves.toBeUndefined();

      // The early return (`handlers.length === 0`) happens before
      // monitorEventProcessing is called, so no metric is recorded for the type.
      expect(eventProcessingMonitor.getEventStats('SampleNoHandlersEvent').totalEvents).toBe(0);
    });
  });

  describe('unsubscribe', () => {
    it('removes only the matching handler, leaving other handlers of the same event type intact', async () => {
      const firstReceived: SampleItemRemoved[] = [];
      const secondReceived: SampleItemRemoved[] = [];
      const firstHandler: EventHandler<SampleItemRemoved> = (event) => {
        firstReceived.push(event);
      };
      const secondHandler: EventHandler<SampleItemRemoved> = (event) => {
        secondReceived.push(event);
      };

      bus.subscribe('SampleItemRemoved', firstHandler);
      bus.subscribe('SampleItemRemoved', secondHandler);

      bus.unsubscribe('SampleItemRemoved', firstHandler);

      expect(bus.getHandlerCount('SampleItemRemoved')).toBe(1);

      const event = new SampleItemRemoved('aggregate-1');
      await bus.publish(event);

      expect(firstReceived).toHaveLength(0);
      expect(secondReceived).toHaveLength(1);
      expect(secondReceived[0]).toBe(event);
    });

    it('is a no-op for an unknown handler or an unknown event type', () => {
      const handler: EventHandler<SampleItemRemoved> = () => {};
      bus.subscribe('SampleItemRemoved', handler);

      expect(() => bus.unsubscribe('SampleItemRemoved', () => {})).not.toThrow();
      expect(() => bus.unsubscribe('UnknownEventType', handler)).not.toThrow();
      expect(bus.getHandlerCount('SampleItemRemoved')).toBe(1);
    });
  });

  describe('handler failures', () => {
    it('a rejecting handler does not prevent other handlers from receiving the event; the failure is recorded by the monitor and rethrown to the publisher', async () => {
      const received: SampleRejectedHandlerEvent[] = [];
      const failingHandler: EventHandler<SampleRejectedHandlerEvent> = () =>
        Promise.reject(new Error('handler-boom'));
      bus.subscribe('SampleRejectedHandlerEvent', failingHandler);
      bus.subscribe('SampleRejectedHandlerEvent', (event: SampleRejectedHandlerEvent) => {
        received.push(event);
      });

      const event = new SampleRejectedHandlerEvent('aggregate-1');
      await expect(bus.publish(event)).rejects.toThrow('handler-boom');

      // Promise.all starts every handler, so the healthy handler still ran
      // even though a sibling rejected.
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);

      // The failure reached the monitoring hook: one metric record for the
      // type, marked unsuccessful…
      const stats = eventProcessingMonitor.getEventStats('SampleRejectedHandlerEvent');
      expect(stats.totalEvents).toBe(1);
      expect(stats.successRate).toBe(0);

      // …and a global error counter tagged with the event type.
      const errorCounters = performanceMetrics.getMetrics('event-system').filter(
        (m) => m.name === 'event.errors.count' && m.tags?.eventType === 'SampleRejectedHandlerEvent'
      );
      expect(errorCounters).toHaveLength(1);
    });

    it('a synchronously throwing handler aborts the fan-out to later handlers, but the failure is still recorded and still rejects publish', async () => {
      // Pinned behavior: publish builds its handler list with
      // `handlers.map(handler => handler(event))` — a synchronous throw stops
      // that map, so later handlers never run. This is different from an async
      // rejection, where Promise.all still starts every handler (see above).
      const received: SampleSyncThrowEvent[] = [];
      const syncThrowingHandler: EventHandler<SampleSyncThrowEvent> = () => {
        throw new Error('sync-boom');
      };
      bus.subscribe('SampleSyncThrowEvent', syncThrowingHandler);
      bus.subscribe('SampleSyncThrowEvent', (event: SampleSyncThrowEvent) => {
        received.push(event);
      });

      const event = new SampleSyncThrowEvent('aggregate-1');
      await expect(bus.publish(event)).rejects.toThrow('sync-boom');

      expect(received).toHaveLength(0);

      const stats = eventProcessingMonitor.getEventStats('SampleSyncThrowEvent');
      expect(stats.totalEvents).toBe(1);
      expect(stats.successRate).toBe(0);
    });
  });
});
