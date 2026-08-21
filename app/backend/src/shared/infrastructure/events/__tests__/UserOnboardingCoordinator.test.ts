import { UserOnboardingCoordinator } from '../UserOnboardingCoordinator';
import type { EventBus, EventHandler } from '../../../domain/events/EventBus';
import type { DomainEvent } from '../../../domain/events/EventBus';
import {
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout,
} from '../../../domain/events/UserOnboardingEvents';
import { createPartialMock } from '@/testing/mocks';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  },
}));

/**
 * House pattern: real coordinator + mocked EventBus capturing the subscribed
 * handlers (mirrors EventWebSocketBridge.lobbyNamespace.test.ts). The 30s
 * timeout is driven with jest modern fake timers — synchronous
 * advanceTimersByTime plus explicit microtask flushing, because the timeout
 * callback only schedules its publishes after microtask hops
 * (ledger "T5 microtask-flush discipline", BaseRoomHandler.test.ts).
 */
describe('UserOnboardingCoordinator — onboarding state machine', () => {
  const ROOM_ID = 'room-1';
  const USER_ID = 'user-a';
  const ONBOARDING_TIMEOUT_MS = 30000;

  interface Harness {
    coordinator: UserOnboardingCoordinator;
    publish: jest.Mock<Promise<void>, [DomainEvent]>;
    join: EventHandler<DomainEvent>;
    instrumentsReady: EventHandler<DomainEvent>;
    audioRoutingReady: EventHandler<DomainEvent>;
    voiceConnectionReady: EventHandler<DomainEvent>;
  }

  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  function publishedEvent(h: Harness, index: number): DomainEvent {
    const event = h.publish.mock.calls[index]?.[0];
    if (event == null) {
      throw new Error(`no event published at index ${index}`);
    }
    return event;
  }

  function buildHarness(): Harness {
    const handlers = new Map<string, EventHandler<DomainEvent>>();
    const publish = jest.fn().mockResolvedValue(undefined) as jest.Mock<Promise<void>, [DomainEvent]>;

    const eventBus = createPartialMock<EventBus>({
      subscribe: jest.fn((eventType: string, handler: EventHandler<DomainEvent>) => {
        handlers.set(eventType, handler);
      }),
      publish,
    });

    const coordinator = new UserOnboardingCoordinator(eventBus);
    coordinator.initialize();

    const requireHandler = (name: string): EventHandler<DomainEvent> => {
      const handler = handlers.get(name);
      if (handler == null) {
        throw new Error(`coordinator did not subscribe a ${name} handler`);
      }
      return handler;
    };

    return {
      coordinator,
      publish,
      join: requireHandler('UserJoinedRoom'),
      instrumentsReady: requireHandler('UserInstrumentsReady'),
      audioRoutingReady: requireHandler('UserAudioRoutingReady'),
      voiceConnectionReady: requireHandler('UserVoiceConnectionReady'),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('timeout path', () => {
    it('band_member without ready steps: 30s timeout publishes UserOnboardingTimeout + UserOnboardingFailed and clears the session', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));
      expect(h.coordinator.getActiveSessions()).toHaveLength(1);

      jest.advanceTimersByTime(ONBOARDING_TIMEOUT_MS);
      await flushMicrotasks();

      expect(h.publish).toHaveBeenCalledTimes(2);
      const timeoutEvent = publishedEvent(h, 0) as UserOnboardingTimeout;
      expect(timeoutEvent).toBeInstanceOf(UserOnboardingTimeout);
      expect(timeoutEvent.userId).toBe(USER_ID);
      expect(timeoutEvent.roomId).toBe(ROOM_ID);
      expect(timeoutEvent.timeoutAfterMs).toBe(ONBOARDING_TIMEOUT_MS);
      expect(timeoutEvent.completedComponents).toEqual([]);

      const failedEvent = publishedEvent(h, 1) as UserOnboardingFailed;
      expect(failedEvent).toBeInstanceOf(UserOnboardingFailed);
      expect(failedEvent.reason).toBe('timeout');
      expect(failedEvent.failedComponent).toBe('instruments, audio_routing, voice_connection');

      expect(h.coordinator.getActiveSessions()).toHaveLength(0);
    });

    it('timeout reports only the missing steps as failed components', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));
      await h.instrumentsReady(new UserInstrumentsReady(USER_ID, ROOM_ID, ['guitar'], {}));

      jest.advanceTimersByTime(ONBOARDING_TIMEOUT_MS);
      await flushMicrotasks();

      expect(h.publish).toHaveBeenCalledTimes(2);
      const failedEvent = publishedEvent(h, 1) as UserOnboardingFailed;
      expect(failedEvent.failedComponent).toBe('audio_routing, voice_connection');
    });
  });

  describe('completion path', () => {
    it('audience completes immediately with UserReadyForPlayback and the timeout never fires', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'audience'));

      expect(h.publish).toHaveBeenCalledTimes(1);
      const readyEvent = publishedEvent(h, 0) as UserReadyForPlayback;
      expect(readyEvent).toBeInstanceOf(UserReadyForPlayback);
      expect(readyEvent.userId).toBe(USER_ID);
      expect(readyEvent.roomId).toBe(ROOM_ID);
      expect(readyEvent.readyComponents).toEqual(['instruments', 'audio_routing', 'voice_connection']);
      expect(h.coordinator.getActiveSessions()).toHaveLength(0);

      // The immediate completion cleared the timeout — nothing fires at 30s
      jest.advanceTimersByTime(ONBOARDING_TIMEOUT_MS);
      await flushMicrotasks();
      expect(h.publish).toHaveBeenCalledTimes(1);
    });

    it('band_member stays incomplete with only 2 of 3 ready steps', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));
      await h.instrumentsReady(new UserInstrumentsReady(USER_ID, ROOM_ID, ['guitar'], {}));
      await h.audioRoutingReady(new UserAudioRoutingReady(USER_ID, ROOM_ID, 'bus-1', {}));

      expect(h.publish).not.toHaveBeenCalled();
      expect(h.coordinator.getActiveSessions()).toHaveLength(1);
    });

    it('band_member completes after all 3 ready steps arrive, in any order', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));
      await h.voiceConnectionReady(new UserVoiceConnectionReady(USER_ID, ROOM_ID, 'conn-1', 'mesh'));
      await h.instrumentsReady(new UserInstrumentsReady(USER_ID, ROOM_ID, ['guitar'], {}));
      await h.audioRoutingReady(new UserAudioRoutingReady(USER_ID, ROOM_ID, 'bus-1', {}));

      expect(h.publish).toHaveBeenCalledTimes(1);
      const readyEvent = publishedEvent(h, 0) as UserReadyForPlayback;
      expect(readyEvent).toBeInstanceOf(UserReadyForPlayback);
      expect(readyEvent.userId).toBe(USER_ID);
      expect(h.coordinator.getActiveSessions()).toHaveLength(0);
    });
  });

  describe('unknown-session guard', () => {
    it.each([
      {
        name: 'UserInstrumentsReady',
        fire: (h: Harness) => h.instrumentsReady(new UserInstrumentsReady(USER_ID, ROOM_ID, ['guitar'], {})),
      },
      {
        name: 'UserAudioRoutingReady',
        fire: (h: Harness) => h.audioRoutingReady(new UserAudioRoutingReady(USER_ID, ROOM_ID, 'bus-1', {})),
      },
      {
        name: 'UserVoiceConnectionReady',
        fire: (h: Harness) => h.voiceConnectionReady(new UserVoiceConnectionReady(USER_ID, ROOM_ID, 'conn-1', 'mesh')),
      },
    ])('late $name for an unknown session is logged as a warning and ignored', async ({ name, fire }) => {
      const h = buildHarness();

      await fire(h);

      expect(jest.mocked(loggingService.logWarn)).toHaveBeenCalledWith(`Received ${name} for unknown session`, {
        userId: USER_ID,
      });
      expect(h.publish).not.toHaveBeenCalled();
    });

    it('a ready event arriving after completion hits the unknown-session guard — no double publish', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));
      await h.instrumentsReady(new UserInstrumentsReady(USER_ID, ROOM_ID, ['guitar'], {}));
      await h.audioRoutingReady(new UserAudioRoutingReady(USER_ID, ROOM_ID, 'bus-1', {}));
      await h.voiceConnectionReady(new UserVoiceConnectionReady(USER_ID, ROOM_ID, 'conn-1', 'mesh'));
      expect(h.publish).toHaveBeenCalledTimes(1);

      await h.instrumentsReady(new UserInstrumentsReady(USER_ID, ROOM_ID, ['guitar'], {}));

      expect(h.publish).toHaveBeenCalledTimes(1);
      expect(jest.mocked(loggingService.logWarn)).toHaveBeenCalledWith('Received UserInstrumentsReady for unknown session', {
        userId: USER_ID,
      });
    });
  });

  describe('lifecycle controls', () => {
    it('forceCompleteOnboarding returns false for unknown sessions, true for known ones (publishes + clears)', async () => {
      const h = buildHarness();
      expect(await h.coordinator.forceCompleteOnboarding('nobody', ROOM_ID)).toBe(false);

      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));

      expect(await h.coordinator.forceCompleteOnboarding(USER_ID, ROOM_ID)).toBe(true);
      expect(h.publish).toHaveBeenCalledTimes(1);
      expect(h.publish).toHaveBeenCalledWith(expect.any(UserReadyForPlayback));
      expect(h.coordinator.getActiveSessions()).toHaveLength(0);
    });

    it('cancelOnboarding clears the session and its timeout — no timeout events fire later', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));

      expect(h.coordinator.cancelOnboarding(USER_ID, ROOM_ID)).toBe(true);
      expect(h.coordinator.cancelOnboarding(USER_ID, ROOM_ID)).toBe(false); // already gone
      expect(h.coordinator.getActiveSessions()).toHaveLength(0);

      jest.advanceTimersByTime(ONBOARDING_TIMEOUT_MS);
      await flushMicrotasks();
      expect(h.publish).not.toHaveBeenCalled();
    });

    it('cleanup clears all sessions and their timers', async () => {
      const h = buildHarness();
      await h.join(new UserJoinedRoom(ROOM_ID, USER_ID, 'Alice', 'band_member'));
      await h.join(new UserJoinedRoom(ROOM_ID, 'user-b', 'Bob', 'band_member'));
      expect(h.coordinator.getActiveSessions()).toHaveLength(2);

      h.coordinator.cleanup();
      expect(h.coordinator.getActiveSessions()).toHaveLength(0);

      jest.advanceTimersByTime(ONBOARDING_TIMEOUT_MS);
      await flushMicrotasks();
      expect(h.publish).not.toHaveBeenCalled();
    });
  });
});
