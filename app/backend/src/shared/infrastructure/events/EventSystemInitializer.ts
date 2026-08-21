/**
 * EventSystemInitializer - Initializes and configures the event-driven architecture
 * 
 * This service sets up the event bus, event handlers, and bridges domain events
 * to WebSocket broadcasting for real-time client updates.
 * 
 * Requirements: 5.1, 5.4
 */

import type { Server } from 'socket.io';
import type { EventBus } from '../../domain/events/EventBus';
import { InMemoryEventBus } from '../../domain/events/InMemoryEventBus';
import { EventWebSocketBridge } from './EventWebSocketBridge';
import type { NamespaceManager } from '../namespace/NamespaceManager';
import { UserOnboardingCoordinator } from './UserOnboardingCoordinator';
import { loggingService } from "../../../shared/infrastructure/logging/LoggingService";

export class EventSystemInitializer {
  private readonly eventBus: EventBus;
  private readonly webSocketBridge: EventWebSocketBridge;
  private readonly onboardingCoordinator: UserOnboardingCoordinator;

  constructor(
    private readonly io: Server,
    private readonly namespaceManager: NamespaceManager
  ) {
    this.eventBus = new InMemoryEventBus();
    this.webSocketBridge = new EventWebSocketBridge(this.eventBus, this.io, this.namespaceManager);
    this.onboardingCoordinator = new UserOnboardingCoordinator(this.eventBus);
  }

  /**
   * Initialize the complete event system
   */
  initialize(): EventBus {
    loggingService.logInfo('Initializing event-driven architecture');

    // Initialize user onboarding coordination
    this.onboardingCoordinator.initialize();

    loggingService.logInfo('Event system initialized successfully', {
      features: ['WebSocket bridge', 'User onboarding coordination']
    });

    return this.eventBus;
  }

  /**
   * Get the event bus instance
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get the WebSocket bridge instance
   */
  getWebSocketBridge(): EventWebSocketBridge {
    return this.webSocketBridge;
  }

  /**
   * Get the onboarding coordinator instance
   */
  getOnboardingCoordinator(): UserOnboardingCoordinator {
    return this.onboardingCoordinator;
  }

  /**
   * Cleanup the event system
   */
  cleanup(): void {
    loggingService.logInfo('Cleaning up event system');
    
    this.webSocketBridge.cleanup();
    this.onboardingCoordinator.cleanup();
    
    // Clear all event handlers
    if (this.eventBus instanceof InMemoryEventBus) {
      this.eventBus.clear();
    }
    
    loggingService.logInfo('Event system cleanup complete');
  }
}