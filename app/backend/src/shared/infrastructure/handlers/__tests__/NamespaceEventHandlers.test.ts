/**
 * NamespaceEventHandlers — TR-33 binding meta-test + replaced-session disconnect
 * (BE-slices test-coverage plan, task 6).
 *
 * The REAL NamespaceEventHandlers construction path is exercised: the class is
 * instantiated with mocked dependencies and its setup* methods are driven
 * through fake Socket.IO namespace/socket objects. Only the security middleware
 * (`secureSocketEvent`) is spied — the observable the meta-test asserts on.
 *
 * TR-33 meta-test: every business-event registration must go through
 * `secureSocketEvent` (via the private `bindSecure`). The room-namespace test
 * enumerates the FULL registration contract of this class:
 *   - 22 secured events (11 room-management + 11 voice) — asserted (a) by
 *     event-name set: every `socket.on` registration must be covered by a
 *     `secureSocketEvent` call, modulo the documented raw allowlist, and
 *     (b) by emitting each event and observing the registered wrapper invoke
 *     the secured function (the exact wrapper `bindSecure` installs). A future
 *     bare `socket.on` for a business event is a TR-33 regression this test
 *     catches.
 *   - Raw allowlist (deliberately NOT secured — each entry justified):
 *       'disconnect' / 'error'    — socket.io system events
 *       PING_MEASUREMENT          — unauthenticated latency probe, no payload contract
 *       INITIATE_SWITCH           — pinned: wrapped via trackRoomEvent only
 *                                   (perf/error tracking), NO bindSecure/schema
 *                                   (no Zod validation / rate limiting) —
 *                                   deliberate-or-not is a review question
 *       JOIN_ROOM health listener — second registration for an event that IS
 *                                   secured via bindSecure; only installed when
 *                                   connectionHealth is set, and it registers
 *                                   health only when a session exists
 *
 * Disconnect flow (COLL-8; FAILURE_PATTERNS Pattern 7): a disconnect whose
 * session has been REPLACED by a newer socket for the same user skips
 * room-state cleanup (no handleLeaveRoom) — only `removeSession` runs, because
 * the user is still active via the new socket. Pattern 7's ghost-room cascade
 * was caused by *stale* lookups skipping cleanup; this branch only skips when
 * the lookup returns a DIFFERENT, live socket id. A last-socket (or
 * sessionless) disconnect runs the full `handleLeaveRoom` path; session removal
 * is consolidated inside handleLeaveRoom.
 *
 * Behavior suites (lower half of this file) drive the REAL `secureSocketEvent`
 * middleware end-to-end — only the rate limiter (Redis/infra boundary) and the
 * domain handlers are mocked. They pin the actual handler delegation for every
 * business event (valid payloads reach the domain handler; invalid payloads
 * are rejected at the boundary without invoking the handler), the
 * trackRoomEvent error path with every classifyError branch, the critical-error
 * rethrow, disconnect-cleanup failure routing, socket 'error' handling on all
 * three namespaces, and connection-optimization gating.
 */

import type { Namespace, Socket } from 'socket.io';
import {
  SHARED_EVENTS,
  VOICE_EVENTS,
  ROOM_SWITCH_EVENTS,
  ROOM_LIFECYCLE_EVENTS,
  TOUR_EVENTS,
  SOCKET_ERROR_CODES,
} from '@jam-band/shared';
import { createPartialMock } from '@/testing/mocks';
import * as securityModule from '../../../../middleware/security';
import { checkSocketRateLimitAsync } from '../../../../middleware/rateLimit';
import type { RoomLifecycleHandler, RoomMembershipHandler, MetronomeEventHandler } from '../../../../domains/room-management/infrastructure/handlers';
import type { VoiceConnectionHandler, ChatHandler } from '../../../../domains/real-time-communication/infrastructure/handlers';
import type { ApprovalWorkflowHandler } from '../../../../domains/user-management/infrastructure/handlers/ApprovalWorkflowHandler';
import type { PerformEventHandler } from '../../../../domains/perform-room/infrastructure/handlers/PerformEventHandler';
import type { ArrangeEventHandler } from '../../../../domains/arrange-room/infrastructure/handlers/ArrangeEventHandler';
import type { NamespaceSession, RoomSessionManager } from '../../../../domains/room-management/infrastructure/services/RoomSessionManager';
import type { ConnectionHealthService } from '../../resilience/ConnectionHealthService';
import type { ConnectionOptimizationService } from '../../performance/ConnectionOptimizationService';
import type { PerformanceMonitoringService } from '../../performance/PerformanceMonitoringService';
import { BackendErrorType } from '../../resilience/BackendErrorRecoveryService';
import { loggingService } from '../../logging/LoggingService';
import { NamespaceEventHandlers } from '../NamespaceEventHandlers';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logSocketEvent: jest.fn(),
    logSecurityEvent: jest.fn(),
    logValidationFailure: jest.fn(),
    logSystemHealth: jest.fn(),
  },
}));

// Rate limiter is a Redis-backed infra boundary — mocked so the REAL
// secureSocketEvent middleware runs without external state (same pattern as
// PerformEventHandler.test.ts / ArrangeEventHandler.test.ts).
jest.mock('../../../../middleware/rateLimit', () => ({
  checkSocketRateLimitAsync: jest.fn(),
}));

const ROOM_ID = 'room-1';
const SOCKET_ID = 'sock-1';
const USER_ID = 'user-1';

type SocketListener = (...args: unknown[]) => unknown;

type FakeSocket = Socket & {
  listenersByEvent: Map<string, SocketListener[]>;
  /** Raw jest mock behind `emit` — decorateSocketErrorEmits replaces the
   *  property with a wrapper, so assertions must target this mock. */
  emitMock: jest.Mock;
};

const createFakeSocket = (id: string = SOCKET_ID): FakeSocket => {
  const listenersByEvent = new Map<string, SocketListener[]>();
  const emitMock = jest.fn();
  const socket: FakeSocket = createPartialMock<FakeSocket>({
    id,
    emit: emitMock,
    emitMock,
    disconnect: jest.fn(),
    // Empty data object: the real secureSocketEvent reads socket.data on its
    // error path (`(socket.data as ...).userId`), and the WebRTC validation
    // step rejects voice events for sockets without an authenticated userId.
    data: {},
    listenersByEvent,
    // socket.io's `on` is a generic overload — type the mock loosely (jest's
    // Mock<any, any>) and type the implementation itself.
    on: jest.fn().mockImplementation((event: string, listener: SocketListener) => {
      const list = listenersByEvent.get(event) ?? [];
      list.push(listener);
      listenersByEvent.set(event, list);
      return socket;
    }),
  });
  return socket;
};

type FakeNamespace = Namespace & { connections: Array<(socket: Socket) => void> };

const createFakeNamespace = (): FakeNamespace => {
  const connections: Array<(socket: Socket) => void> = [];
  const namespace: FakeNamespace = createPartialMock<FakeNamespace>({
    connections,
    on: jest.fn().mockImplementation((event: string, listener: (socket: Socket) => void) => {
      if (event === 'connection') connections.push(listener);
      return namespace;
    }),
  });
  return namespace;
};

/** Invoke the (single) 'connection' handler captured by a fake namespace. */
const invokeConnection = (namespace: FakeNamespace, socket: FakeSocket): void => {
  const connectionHandler = namespace.connections[0];
  expect(connectionHandler).toBeDefined();
  connectionHandler?.(socket);
};

/** Invoke every listener registered for `event` (sync handlers only — see emitDisconnect for async). */
const emitEvent = (socket: FakeSocket, event: string, payload: unknown = {}): void => {
  for (const listener of socket.listenersByEvent.get(event) ?? []) {
    listener(payload);
  }
};

/** Invoke and await every 'disconnect' listener (the room disconnect handler is async). */
const emitDisconnect = async (socket: FakeSocket, reason = 'transport close'): Promise<void> => {
  await Promise.all((socket.listenersByEvent.get('disconnect') ?? []).map((listener) => listener(reason)));
};

/**
 * The bindSecure listeners are fire-and-forget (`void secured(socket, data)`),
 * so after an emit the async middleware pipeline (rate limit → validation →
 * handler) still needs a macrotask turn to settle. Mirrors the flushPromises
 * pattern in PerformEventHandler.test.ts / ArrangeEventHandler.test.ts.
 */
const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const makeSession = (overrides: Partial<NamespaceSession> = {}): NamespaceSession => ({
  socketId: SOCKET_ID,
  roomId: ROOM_ID,
  userId: USER_ID,
  username: 'jammer',
  namespacePath: `/room/${ROOM_ID}`,
  connectedAt: new Date('2026-01-01T00:00:00Z'),
  lastActivity: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

interface HandlerBundle {
  eventHandlers: NamespaceEventHandlers;
  roomLifecycleHandler: jest.Mocked<RoomLifecycleHandler>;
  roomMembershipHandler: jest.Mocked<RoomMembershipHandler>;
  voiceConnectionHandler: jest.Mocked<VoiceConnectionHandler>;
  approvalWorkflowHandler: jest.Mocked<ApprovalWorkflowHandler>;
  roomSessionManager: jest.Mocked<RoomSessionManager>;
  chatHandler: jest.Mocked<ChatHandler>;
  performEventHandler: jest.Mocked<PerformEventHandler>;
  arrangeEventHandler: jest.Mocked<ArrangeEventHandler>;
  metronomeEventHandler: jest.Mocked<MetronomeEventHandler>;
}

/** REAL NamespaceEventHandlers construction path — only dependencies are mocked. */
const buildBundle = (): HandlerBundle => {
  const roomLifecycleHandler = createPartialMock<RoomLifecycleHandler>({
    handleJoinRoom: jest.fn(),
    handleLeaveRoom: jest.fn(),
    handlePrepareIdentitySwap: jest.fn(),
    handleFinishTour: jest.fn(),
    handleInitiateSwitch: jest.fn(),
  });
  const roomMembershipHandler = createPartialMock<RoomMembershipHandler>({
    handleTransferOwnershipNamespace: jest.fn(),
    handleRequestRoleChange: jest.fn(),
    handleApproveRoleChange: jest.fn(),
    handleRejectRoleChange: jest.fn(),
  });
  const voiceConnectionHandler = createPartialMock<VoiceConnectionHandler>({
    handleVoiceOfferNamespace: jest.fn(),
    handleVoiceAnswerNamespace: jest.fn(),
    handleVoiceIceCandidateNamespace: jest.fn(),
    handleJoinVoiceNamespace: jest.fn(),
    handleLeaveVoiceNamespace: jest.fn(),
    handleVoiceMuteChangedNamespace: jest.fn(),
    handleVoiceSpeakingNamespace: jest.fn(),
    handleRequestVoiceParticipantsNamespace: jest.fn(),
    handleRequestMeshConnectionsNamespace: jest.fn(),
    handleVoiceHeartbeatNamespace: jest.fn(),
    handleVoiceConnectionFailedNamespace: jest.fn(),
  });
  const approvalWorkflowHandler = createPartialMock<ApprovalWorkflowHandler>({
    handleApprovalConnection: jest.fn(),
    handleApprovalRequest: jest.fn(),
    handleApprovalCancel: jest.fn(),
    handleApprovalDisconnect: jest.fn(),
    handleApprovalResponse: jest.fn(),
  });
  const roomSessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn(),
    findSocketByUserIdAsync: jest.fn(),
    removeSession: jest.fn(),
  });
  const chatHandler = createPartialMock<ChatHandler>({
    handleChatMessageNamespace: jest.fn(),
  });
  const performEventHandler = createPartialMock<PerformEventHandler>({ handleConnection: jest.fn() });
  const arrangeEventHandler = createPartialMock<ArrangeEventHandler>({ handleConnection: jest.fn() });
  const metronomeEventHandler = createPartialMock<MetronomeEventHandler>({ handleConnection: jest.fn() });

  const eventHandlers = new NamespaceEventHandlers(
    roomLifecycleHandler,
    roomMembershipHandler,
    voiceConnectionHandler,
    approvalWorkflowHandler,
    roomSessionManager,
    chatHandler,
    performEventHandler,
    arrangeEventHandler,
    metronomeEventHandler
  );

  return {
    eventHandlers,
    roomLifecycleHandler,
    roomMembershipHandler,
    voiceConnectionHandler,
    approvalWorkflowHandler,
    roomSessionManager,
    chatHandler,
    performEventHandler,
    arrangeEventHandler,
    metronomeEventHandler,
  };
};

const connectRoom = (bundle: HandlerBundle): { socket: FakeSocket; namespace: FakeNamespace } => {
  const namespace = createFakeNamespace();
  bundle.eventHandlers.setupRoomNamespaceHandlers(namespace, ROOM_ID);
  const socket = createFakeSocket();
  invokeConnection(namespace, socket);
  return { socket, namespace };
};

// TR-33 meta-test spy: the single most robust observable is the security
// middleware itself — every bindSecure call must reach `secureSocketEvent`
// with the event name, and the wrapper installed by socket.on must invoke the
// function secureSocketEvent returned. (No reference is kept: jest
// `restoreMocks` restores the spy between tests automatically.)
let securedFn: jest.Mock;
let securedEventNames: string[];

beforeEach(() => {
  securedFn = jest.fn(async () => undefined);
  securedEventNames = [];
  jest.spyOn(securityModule, 'secureSocketEvent').mockImplementation((eventName: string) => {
    securedEventNames.push(eventName);
    return securedFn;
  });
});

describe('NamespaceEventHandlers — TR-33 binding meta-test', () => {
  // The FULL enumeration of this class's secured room-namespace events.
  // Adding a binding? Add it here deliberately — the test is the contract.
  const expectedSecuredRoomEvents: string[] = [
    // bindRoomEventHandlers
    SHARED_EVENTS.JOIN_ROOM,
    SHARED_EVENTS.LEAVE_ROOM,
    ROOM_LIFECYCLE_EVENTS.PREPARE_IDENTITY_SWAP,
    TOUR_EVENTS.FINISH_TOUR,
    SHARED_EVENTS.CHAT_MESSAGE,
    SHARED_EVENTS.TRANSFER_OWNERSHIP,
    SHARED_EVENTS.APPROVE_MEMBER,
    SHARED_EVENTS.REJECT_MEMBER,
    SHARED_EVENTS.REQUEST_ROLE_CHANGE,
    SHARED_EVENTS.APPROVE_ROLE_CHANGE,
    SHARED_EVENTS.REJECT_ROLE_CHANGE,
    // bindVoiceEvents
    VOICE_EVENTS.VOICE_OFFER,
    VOICE_EVENTS.VOICE_ANSWER,
    VOICE_EVENTS.VOICE_ICE_CANDIDATE,
    VOICE_EVENTS.JOIN_VOICE,
    VOICE_EVENTS.LEAVE_VOICE,
    VOICE_EVENTS.VOICE_MUTE_CHANGED,
    VOICE_EVENTS.VOICE_SPEAKING,
    VOICE_EVENTS.REQUEST_VOICE_PARTICIPANTS,
    VOICE_EVENTS.REQUEST_MESH_CONNECTIONS,
    VOICE_EVENTS.VOICE_HEARTBEAT,
    VOICE_EVENTS.VOICE_CONNECTION_FAILED,
  ];

  // Raw registrations that must NOT go through secureSocketEvent — each is
  // deliberate; see the file header for justifications.
  const rawAllowlist = new Set<string>([
    'disconnect',
    'error',
    SHARED_EVENTS.PING_MEASUREMENT,
    ROOM_SWITCH_EVENTS.INITIATE_SWITCH,
  ]);

  it('room namespace: every event registration is wired through secureSocketEvent', () => {
    const bundle = buildBundle();
    // connectionHealth set on purpose: the JOIN_ROOM health listener is a
    // second registration for an already-secured event — the meta-test must
    // tolerate it (JOIN_ROOM stays in the secured set).
    bundle.eventHandlers.setPerformanceServices(
      createPartialMock<PerformanceMonitoringService>({}),
      createPartialMock<ConnectionHealthService>({ registerConnection: jest.fn(), unregisterConnection: jest.fn() })
    );
    const { socket, namespace } = connectRoom(bundle);

    // 1. The secured contract: exactly the enumerated events reach secureSocketEvent.
    expect([...securedEventNames].sort()).toEqual([...expectedSecuredRoomEvents].sort());

    // 2. Every socket.on registration is either secured or on the raw allowlist —
    //    a future bare `socket.on` for a business event fails right here (TR-33).
    for (const event of socket.listenersByEvent.keys()) {
      expect(expectedSecuredRoomEvents.includes(event) || rawAllowlist.has(event)).toBe(true);
    }

    // 3. The allowlist members really are raw.
    expect(securedEventNames).not.toContain(ROOM_SWITCH_EVENTS.INITIATE_SWITCH);
    expect(securedEventNames).not.toContain(SHARED_EVENTS.PING_MEASUREMENT);
    expect(securedEventNames).not.toContain('disconnect');
    expect(securedEventNames).not.toContain('error');

    // 4. Emit-based proof: the handler registered for each secured event is the
    //    bindSecure wrapper — emitting routes through the secured function.
    for (const event of expectedSecuredRoomEvents) {
      securedFn.mockClear();
      const payload = { metaTest: true };
      emitEvent(socket, event, payload);
      expect(securedFn).toHaveBeenCalledWith(socket, payload);
    }

    // 5. Delegation pins: domain handlers bind their own events on their own
    //    connection path (outside this class's registration contract).
    expect(bundle.performEventHandler.handleConnection).toHaveBeenCalledWith(socket, ROOM_ID, namespace);
    expect(bundle.arrangeEventHandler.handleConnection).toHaveBeenCalledWith(socket, ROOM_ID, namespace);
    expect(bundle.metronomeEventHandler.handleConnection).toHaveBeenCalledWith(socket, ROOM_ID, namespace);
  });

  it('approval namespace: REQUEST_APPROVAL + CANCEL_APPROVAL_REQUEST secured, PING_MEASUREMENT raw', async () => {
    const bundle = buildBundle();
    const namespace = createFakeNamespace();
    bundle.eventHandlers.setupApprovalNamespaceHandlers(namespace, ROOM_ID);
    const socket = createFakeSocket();
    invokeConnection(namespace, socket);

    expect([...securedEventNames].sort()).toEqual(
      [SHARED_EVENTS.REQUEST_APPROVAL, SHARED_EVENTS.CANCEL_APPROVAL_REQUEST].sort()
    );
    expect(socket.listenersByEvent.has(SHARED_EVENTS.PING_MEASUREMENT)).toBe(true);
    expect(bundle.approvalWorkflowHandler.handleApprovalConnection).toHaveBeenCalledWith(socket, ROOM_ID, namespace);

    // Approval disconnect: cancellation + session cleanup (no replaced-session
    // logic on this namespace — it is a transient pre-join channel).
    await emitDisconnect(socket);
    expect(bundle.approvalWorkflowHandler.handleApprovalDisconnect).toHaveBeenCalledWith(socket);
    expect(bundle.roomSessionManager.removeSession).toHaveBeenCalledWith(SOCKET_ID);
  });

  it('lobby monitor namespace: no secured events, PING_MEASUREMENT raw, disconnect removes session', async () => {
    const bundle = buildBundle();
    const namespace = createFakeNamespace();
    bundle.eventHandlers.setupLobbyMonitorNamespaceHandlers(namespace);
    const socket = createFakeSocket();
    invokeConnection(namespace, socket);

    expect(securedEventNames).toEqual([]);
    expect(socket.listenersByEvent.has(SHARED_EVENTS.PING_MEASUREMENT)).toBe(true);

    await emitDisconnect(socket);
    expect(bundle.roomSessionManager.removeSession).toHaveBeenCalledWith(SOCKET_ID);
  });
});

describe('NamespaceEventHandlers — room disconnect flows', () => {
  it('replaced session: skips room-state cleanup, only removeSession runs (COLL-8, Pattern 7)', async () => {
    const bundle = buildBundle();
    const connectionHealth = createPartialMock<ConnectionHealthService>({
      registerConnection: jest.fn(),
      unregisterConnection: jest.fn(),
    });
    bundle.eventHandlers.setPerformanceServices(createPartialMock<PerformanceMonitoringService>({}), connectionHealth);
    const { socket } = connectRoom(bundle);

    bundle.roomSessionManager.getRoomSession.mockReturnValue(makeSession());
    bundle.roomSessionManager.findSocketByUserIdAsync.mockResolvedValue('newer-socket-id');

    await emitDisconnect(socket);

    // COLL-8 fix (FAILURE_PATTERNS Pattern 7 counterpart): the newer socket for
    // this user owns the room state, so the kicked socket must NOT run the leave
    // path (membership removal, domain cleanup, grace period). Only the session
    // bookkeeping entry is removed. Pattern 7's ghost-room cascade came from
    // skipping cleanup on STALE lookups; this branch skips only when the lookup
    // returns a DIFFERENT active socket id.
    expect(bundle.roomSessionManager.removeSession).toHaveBeenCalledWith(SOCKET_ID);
    expect(bundle.roomSessionManager.removeSession).toHaveBeenCalledTimes(1);
    expect(bundle.roomLifecycleHandler.handleLeaveRoom).not.toHaveBeenCalled();
    // Health/optimization unregistration still happens BEFORE the replaced check.
    expect(connectionHealth.unregisterConnection).toHaveBeenCalledWith(SOCKET_ID);
  });

  it('last socket: runs the full handleLeaveRoom path (cleanup consolidated inside it)', async () => {
    const bundle = buildBundle();
    const { socket } = connectRoom(bundle);

    // First getRoomSession (the replaced-session check) sees the session; the
    // post-leave safety-net check sees none — handleLeaveRoom removes it.
    bundle.roomSessionManager.getRoomSession.mockReturnValueOnce(makeSession()).mockReturnValue(undefined);
    bundle.roomSessionManager.findSocketByUserIdAsync.mockResolvedValue(SOCKET_ID);

    await emitDisconnect(socket);

    expect(bundle.roomLifecycleHandler.handleLeaveRoom).toHaveBeenCalledWith(socket, false);
    // Session removal is consolidated inside handleLeaveRoom (domain cleanup,
    // membership removal, grace period, session removal share one path) — the
    // disconnect handler's post-check is only a safety net for edge cases.
    expect(bundle.roomSessionManager.removeSession).not.toHaveBeenCalled();
  });

  it('no session: still runs the full handleLeaveRoom path', async () => {
    const bundle = buildBundle();
    const { socket } = connectRoom(bundle);

    bundle.roomSessionManager.getRoomSession.mockReturnValue(undefined);

    await emitDisconnect(socket);

    expect(bundle.roomLifecycleHandler.handleLeaveRoom).toHaveBeenCalledWith(socket, false);
    expect(bundle.roomSessionManager.removeSession).not.toHaveBeenCalled();
  });

  it('stale session after handleLeaveRoom: the safety-net removeSession cleans it up', async () => {
    const bundle = buildBundle();
    const { socket } = connectRoom(bundle);

    // handleLeaveRoom (mocked) does NOT remove the session — the disconnect
    // handler's post-leave safety net must catch it and remove it.
    bundle.roomSessionManager.getRoomSession.mockReturnValue(makeSession());
    bundle.roomSessionManager.findSocketByUserIdAsync.mockResolvedValue(SOCKET_ID);

    await emitDisconnect(socket);

    expect(bundle.roomLifecycleHandler.handleLeaveRoom).toHaveBeenCalledWith(socket, false);
    expect(bundle.roomSessionManager.removeSession).toHaveBeenCalledWith(SOCKET_ID);
  });
});

describe('NamespaceEventHandlers — connection health registration', () => {
  it('JOIN_ROOM registers connection health only when a session exists', async () => {
    const bundle = buildBundle();
    const connectionHealth = createPartialMock<ConnectionHealthService>({
      registerConnection: jest.fn(),
      unregisterConnection: jest.fn(),
    });
    bundle.eventHandlers.setPerformanceServices(createPartialMock<PerformanceMonitoringService>({}), connectionHealth);
    const { socket } = connectRoom(bundle);

    // The health registration is a SECOND JOIN_ROOM listener (the event itself
    // is secured via bindSecure) — installed only because connectionHealth is set.
    expect(socket.listenersByEvent.get(SHARED_EVENTS.JOIN_ROOM)?.length).toBe(2);

    // No session yet (session is established by the secured JOIN_ROOM handler,
    // which runs after this health listener) → no health registration.
    bundle.roomSessionManager.getRoomSession.mockReturnValue(undefined);
    emitEvent(socket, SHARED_EVENTS.JOIN_ROOM);
    expect(connectionHealth.registerConnection).not.toHaveBeenCalled();

    // Session exists → health registered with the session's identity.
    bundle.roomSessionManager.getRoomSession.mockReturnValue(makeSession());
    emitEvent(socket, SHARED_EVENTS.JOIN_ROOM);
    expect(connectionHealth.registerConnection).toHaveBeenCalledWith(socket, USER_ID, ROOM_ID, `/room/${ROOM_ID}`);
  });

  it('no JOIN_ROOM health listener is installed when connectionHealth is unset', () => {
    const bundle = buildBundle();
    const { socket } = connectRoom(bundle);

    expect(socket.listenersByEvent.get(SHARED_EVENTS.JOIN_ROOM)?.length).toBe(1);
  });
});

describe('NamespaceEventHandlers — INITIATE_SWITCH binding (pinned)', () => {
  it('is wrapped via trackRoomEvent but NOT via bindSecure/secureSocketEvent', () => {
    const bundle = buildBundle();
    const { socket } = connectRoom(bundle);

    const data = { targetRoomId: 'room-2', targetRoomType: 'perform' as const };
    emitEvent(socket, ROOM_SWITCH_EVENTS.INITIATE_SWITCH, data);

    expect(bundle.roomLifecycleHandler.handleInitiateSwitch).toHaveBeenCalledWith(socket, data);
    // PINNED behavior: INITIATE_SWITCH is a raw socket.on wrapped in
    // trackRoomEvent (perf + error tracking) — NO bindSecure/secureSocketEvent,
    // so no Zod schema validation and no rate limiting. Deliberate-or-not is a
    // review question; this test freezes the current behavior so a change is
    // visible in review.
    expect(securedEventNames).not.toContain(ROOM_SWITCH_EVENTS.INITIATE_SWITCH);
  });
});

// Valid UUID matching z.string().uuid() (version nibble 4, variant 8).
const ROOM_UUID = '11111111-1111-4111-8111-111111111111';

const joinPayload = (): { roomId: string; username: string; userId: string } => ({
  roomId: ROOM_UUID,
  username: 'jammer',
  userId: USER_ID,
});

describe('NamespaceEventHandlers — real secureSocketEvent behavior', () => {
  // These suites need the REAL secureSocketEvent middleware (the meta-test
  // beforeEach above spies it away) — restore the spy, then let the fake rate
  // limiter allow every event through.
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.mocked(checkSocketRateLimitAsync).mockResolvedValue({ allowed: true });
  });

  describe('valid payloads reach the delegated domain handlers', () => {
    it('JOIN_ROOM: zod-validated payload delegates through trackRoomEvent (success path records performance)', async () => {
      const bundle = buildBundle();
      const performanceMonitoring = createPartialMock<PerformanceMonitoringService>({
        recordRoomEvent: jest.fn(),
        recordRoomError: jest.fn(),
      });
      bundle.eventHandlers.setPerformanceServices(performanceMonitoring, createPartialMock<ConnectionHealthService>({}));
      const { socket } = connectRoom(bundle);

      emitEvent(socket, SHARED_EVENTS.JOIN_ROOM, joinPayload());
      await flushAsync();

      expect(bundle.roomLifecycleHandler.handleJoinRoom).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ roomId: ROOM_UUID, username: 'jammer', userId: USER_ID })
      );
      // trackRoomEvent success path: performance recorded with the measured duration.
      expect(performanceMonitoring.recordRoomEvent).toHaveBeenCalledWith(ROOM_ID, 'join_room', expect.any(Number));
    });

    it('LEAVE_ROOM: unvalidated payload passes through — isIntendedLeave true and default false', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      emitEvent(socket, SHARED_EVENTS.LEAVE_ROOM, { isIntendedLeave: true });
      await flushAsync();
      expect(bundle.roomLifecycleHandler.handleLeaveRoom).toHaveBeenCalledWith(socket, true);

      emitEvent(socket, SHARED_EVENTS.LEAVE_ROOM, {});
      await flushAsync();
      expect(bundle.roomLifecycleHandler.handleLeaveRoom).toHaveBeenCalledWith(socket, false);
    });

    it('PREPARE_IDENTITY_SWAP + FINISH_TOUR delegate with validated payloads', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      emitEvent(socket, ROOM_LIFECYCLE_EVENTS.PREPARE_IDENTITY_SWAP, { newAccessToken: 'jwt-token' });
      emitEvent(socket, TOUR_EVENTS.FINISH_TOUR, { roomId: 'tour-room-1' });
      await flushAsync();

      expect(bundle.roomLifecycleHandler.handlePrepareIdentitySwap).toHaveBeenCalledWith(socket, { newAccessToken: 'jwt-token' });
      expect(bundle.roomLifecycleHandler.handleFinishTour).toHaveBeenCalledWith(socket, { roomId: 'tour-room-1' });
    });

    it('chat + ownership + role-change events delegate to their handlers with the namespace', async () => {
      const bundle = buildBundle();
      const { socket, namespace } = connectRoom(bundle);

      emitEvent(socket, SHARED_EVENTS.CHAT_MESSAGE, { message: 'hi', roomId: ROOM_UUID });
      emitEvent(socket, SHARED_EVENTS.TRANSFER_OWNERSHIP, { newOwnerId: 'user-2' });
      emitEvent(socket, SHARED_EVENTS.APPROVE_MEMBER, { userId: 'user-2' });
      emitEvent(socket, SHARED_EVENTS.REJECT_MEMBER, { userId: 'user-2' });
      emitEvent(socket, SHARED_EVENTS.REQUEST_ROLE_CHANGE, { targetRole: 'band_member' });
      emitEvent(socket, SHARED_EVENTS.APPROVE_ROLE_CHANGE, { targetUserId: 'user-2', targetRole: 'band_member' });
      emitEvent(socket, SHARED_EVENTS.REJECT_ROLE_CHANGE, { targetUserId: 'user-2' });
      await flushAsync();

      expect(bundle.chatHandler.handleChatMessageNamespace).toHaveBeenCalledWith(socket, { message: 'hi', roomId: ROOM_UUID }, namespace);
      expect(bundle.roomMembershipHandler.handleTransferOwnershipNamespace).toHaveBeenCalledWith(socket, { newOwnerId: 'user-2' }, namespace);
      expect(bundle.approvalWorkflowHandler.handleApprovalResponse).toHaveBeenCalledWith(socket, { userId: 'user-2', approved: true }, namespace);
      expect(bundle.approvalWorkflowHandler.handleApprovalResponse).toHaveBeenCalledWith(socket, { userId: 'user-2', approved: false }, namespace);
      expect(bundle.roomMembershipHandler.handleRequestRoleChange).toHaveBeenCalledWith(socket, { targetRole: 'band_member' }, namespace);
      expect(bundle.roomMembershipHandler.handleApproveRoleChange).toHaveBeenCalledWith(socket, { targetUserId: 'user-2', targetRole: 'band_member' }, namespace);
      expect(bundle.roomMembershipHandler.handleRejectRoleChange).toHaveBeenCalledWith(socket, { targetUserId: 'user-2' }, namespace);
    });

    it('approval namespace: REQUEST_APPROVAL + CANCEL_APPROVAL_REQUEST delegate with validated payloads', async () => {
      const bundle = buildBundle();
      const namespace = createFakeNamespace();
      bundle.eventHandlers.setupApprovalNamespaceHandlers(namespace, ROOM_ID);
      const socket = createFakeSocket();
      invokeConnection(namespace, socket);

      emitEvent(socket, SHARED_EVENTS.REQUEST_APPROVAL, { roomId: ROOM_UUID, userId: 'user-2', username: 'guest', role: 'audience' });
      emitEvent(socket, SHARED_EVENTS.CANCEL_APPROVAL_REQUEST, { userId: 'user-2', roomId: ROOM_UUID });
      await flushAsync();

      expect(bundle.approvalWorkflowHandler.handleApprovalRequest).toHaveBeenCalledWith(
        socket,
        { roomId: ROOM_UUID, userId: 'user-2', username: 'guest', role: 'audience' },
        namespace
      );
      expect(bundle.approvalWorkflowHandler.handleApprovalCancel).toHaveBeenCalledWith(socket, { userId: 'user-2', roomId: ROOM_UUID }, namespace);
    });
  });

  describe('boundary rejection (secureSocketEvent validation)', () => {
    it('invalid JOIN_ROOM payload is rejected at the boundary — handler never invoked', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      emitEvent(socket, SHARED_EVENTS.JOIN_ROOM, { roomId: 'not-a-uuid', username: '', userId: '' });
      await flushAsync();

      expect(bundle.roomLifecycleHandler.handleJoinRoom).not.toHaveBeenCalled();
      expect(socket.emitMock).toHaveBeenCalledWith('error', expect.objectContaining({ code: SOCKET_ERROR_CODES.INVALID_DATA_FORMAT }));
    });

    it('voice events without an authenticated socket.data are rejected by WebRTC validation', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      // No socket.data → validateWebRTCRequest fails with "User not authenticated"
      // BEFORE the voice handler runs (TR-33-adjacent: identity comes from the
      // socket, not the payload).
      emitEvent(socket, VOICE_EVENTS.VOICE_OFFER, { targetUserId: 'user-2', roomId: ROOM_UUID, offer: { type: 'offer', sdp: 'v=0' } });
      await flushAsync();

      expect(bundle.voiceConnectionHandler.handleVoiceOfferNamespace).not.toHaveBeenCalled();
      expect(socket.emitMock).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'WebRTC validation failed' }));
    });
  });

  describe('trackRoomEvent error path — classifyError branches + recovery routing', () => {
    // classifyError only runs inside trackRoomEvent, which wraps JOIN_ROOM and
    // INITIATE_SWITCH only. JOIN_ROOM's eventName ('join_room') self-classifies
    // as SessionManagementError, so the later room/state/network/unknown
    // branches are exercised through INITIATE_SWITCH instead.
    const switchPayload = (): { targetRoomId: string; targetRoomType: 'perform' } => ({
      targetRoomId: 'room-2',
      targetRoomType: 'perform',
    });
    const classifyCases: Array<{
      message: string;
      event: string;
      eventName: string;
      payload: unknown;
      expectedType: BackendErrorType;
      expectedEmitEvent: string;
      expectedCode: string;
    }> = [
      { message: 'validation failed', event: SHARED_EVENTS.JOIN_ROOM, eventName: 'join_room', payload: joinPayload(), expectedType: BackendErrorType.ValidationError, expectedEmitEvent: 'error', expectedCode: 'VALIDATION_ERROR' },
      { message: 'rate limit exceeded', event: SHARED_EVENTS.JOIN_ROOM, eventName: 'join_room', payload: joinPayload(), expectedType: BackendErrorType.RateLimitError, expectedEmitEvent: 'error', expectedCode: 'RATE_LIMITED' },
      { message: 'permission denied', event: SHARED_EVENTS.JOIN_ROOM, eventName: 'join_room', payload: joinPayload(), expectedType: BackendErrorType.PermissionError, expectedEmitEvent: 'error', expectedCode: 'PERMISSION_DENIED' },
      { message: 'session expired', event: SHARED_EVENTS.JOIN_ROOM, eventName: 'join_room', payload: joinPayload(), expectedType: BackendErrorType.SessionManagementError, expectedEmitEvent: 'error', expectedCode: 'SESSION_ERROR' },
      { message: 'room state corrupted', event: ROOM_SWITCH_EVENTS.INITIATE_SWITCH, eventName: ROOM_SWITCH_EVENTS.INITIATE_SWITCH, payload: switchPayload(), expectedType: BackendErrorType.RoomStateError, expectedEmitEvent: 'room_state_reset', expectedCode: 'ROOM_STATE_ERROR' },
      { message: 'network timeout', event: ROOM_SWITCH_EVENTS.INITIATE_SWITCH, eventName: ROOM_SWITCH_EVENTS.INITIATE_SWITCH, payload: switchPayload(), expectedType: BackendErrorType.NetworkError, expectedEmitEvent: 'error', expectedCode: 'NETWORK_ERROR' },
      { message: 'boom', event: ROOM_SWITCH_EVENTS.INITIATE_SWITCH, eventName: ROOM_SWITCH_EVENTS.INITIATE_SWITCH, payload: switchPayload(), expectedType: BackendErrorType.UnknownError, expectedEmitEvent: 'error', expectedCode: 'UNKNOWN_ERROR' },
    ];

    it.each(classifyCases)(
      'classifies "$message" as $expectedType and routes recovery to the client',
      async ({ message, event, eventName, payload, expectedType, expectedEmitEvent, expectedCode }) => {
        const bundle = buildBundle();
        const performanceMonitoring = createPartialMock<PerformanceMonitoringService>({
          recordRoomEvent: jest.fn(),
          recordRoomError: jest.fn(),
        });
        bundle.eventHandlers.setPerformanceServices(performanceMonitoring, createPartialMock<ConnectionHealthService>({}));
        const { socket } = connectRoom(bundle);

        const error = new Error(message);
        if (event === ROOM_SWITCH_EVENTS.INITIATE_SWITCH) {
          bundle.roomLifecycleHandler.handleInitiateSwitch.mockRejectedValue(error);
        } else {
          bundle.roomLifecycleHandler.handleJoinRoom.mockRejectedValue(error);
        }

        emitEvent(socket, event, payload);
        await flushAsync();

        // trackRoomEvent catch: performance error recorded with event context.
        // jest's expect.any(Number) returns `any`, which cannot be assigned into
        // a contextually-typed object literal (no-unsafe-assignment) — hoisting
        // through an unknown-typed slot keeps the matcher type-safe.
        const errorContext: Record<string, unknown> = {
          eventName,
          socketId: SOCKET_ID,
          duration: expect.any(Number),
        };
        expect(performanceMonitoring.recordRoomError).toHaveBeenCalledWith(ROOM_ID, error, expect.objectContaining(errorContext));
        // Error routed through the REAL BackendErrorRecoveryService with the classified type.
        const stats = bundle.eventHandlers.getErrorRecoveryService().getErrorStats();
        expect(stats.totalErrors).toBe(1);
        expect(stats.errorsByType[expectedType]).toBe(1);
        expect(stats.recentErrors[0]?.message).toBe(`Error in ${eventName}: ${message}`);
        // Recovery action executed against the client socket.
        expect(socket.emitMock).toHaveBeenCalledWith(expectedEmitEvent, expect.objectContaining({ code: expectedCode }));
      }
    );

    it('SessionManagementError recovery also disconnects the socket (cleanup_session action)', async () => {
      const bundle = buildBundle();
      bundle.eventHandlers.setPerformanceServices(
        createPartialMock<PerformanceMonitoringService>({ recordRoomEvent: jest.fn(), recordRoomError: jest.fn() }),
        createPartialMock<ConnectionHealthService>({})
      );
      const { socket } = connectRoom(bundle);

      bundle.roomLifecycleHandler.handleJoinRoom.mockRejectedValue(new Error('session expired'));
      emitEvent(socket, SHARED_EVENTS.JOIN_ROOM, joinPayload());
      await flushAsync();

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('critical error (out of memory) is rethrown after recovery — client sees Internal server error', async () => {
      const bundle = buildBundle();
      bundle.eventHandlers.setPerformanceServices(
        createPartialMock<PerformanceMonitoringService>({ recordRoomEvent: jest.fn(), recordRoomError: jest.fn() }),
        createPartialMock<ConnectionHealthService>({})
      );
      const { socket } = connectRoom(bundle);

      bundle.roomLifecycleHandler.handleJoinRoom.mockRejectedValue(new Error('out of memory'));
      emitEvent(socket, SHARED_EVENTS.JOIN_ROOM, joinPayload());
      await flushAsync();

      // isCriticalError → trackRoomEvent rethrows → secureSocketEvent catches →
      // client gets the generic Internal server error payload.
      expect(socket.emitMock).toHaveBeenCalledWith('error', expect.objectContaining({ code: SOCKET_ERROR_CODES.UNKNOWN }));
    });
  });

  describe('disconnect cleanup failure routing', () => {
    it('handleLeaveRoom failure is routed to recovery as SessionManagementError (no rethrow)', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      bundle.roomSessionManager.getRoomSession.mockReturnValue(undefined);
      bundle.roomLifecycleHandler.handleLeaveRoom.mockRejectedValue(new Error('cleanup blew up'));

      await emitDisconnect(socket);

      const stats = bundle.eventHandlers.getErrorRecoveryService().getErrorStats();
      expect(stats.totalErrors).toBe(1);
      expect(stats.errorsByType[BackendErrorType.SessionManagementError]).toBe(1);
      expect(stats.recentErrors[0]?.message).toBe('Error during disconnect cleanup: cleanup blew up');
    });
  });

  describe('socket error handlers on all three namespaces', () => {
    it('room namespace: error events are logged and routed to recovery (NamespaceConnectionError)', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      emitEvent(socket, 'error', new Error('socket exploded'));
      await flushAsync();
      emitEvent(socket, 'error', 'plain string failure');
      await flushAsync();

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'Room namespace socket error' })
      );
      const stats = bundle.eventHandlers.getErrorRecoveryService().getErrorStats();
      expect(stats.totalErrors).toBe(2);
      expect(stats.errorsByType[BackendErrorType.NamespaceConnectionError]).toBe(2);
      // Non-Error payloads are normalized to Error instances before recovery.
      expect(stats.recentErrors[1]?.originalError).toEqual(new Error('plain string failure'));
    });

    it('approval namespace: socket error events are logged', async () => {
      const bundle = buildBundle();
      const namespace = createFakeNamespace();
      bundle.eventHandlers.setupApprovalNamespaceHandlers(namespace, ROOM_ID);
      const socket = createFakeSocket();
      invokeConnection(namespace, socket);

      emitEvent(socket, 'error', new Error('approval exploded'));
      await flushAsync();

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'Approval namespace socket error' })
      );
    });

    it('lobby monitor namespace: socket error events are logged', async () => {
      const bundle = buildBundle();
      const namespace = createFakeNamespace();
      bundle.eventHandlers.setupLobbyMonitorNamespaceHandlers(namespace);
      const socket = createFakeSocket();
      invokeConnection(namespace, socket);

      emitEvent(socket, 'error', new Error('lobby exploded'));
      await flushAsync();

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'Lobby monitor namespace socket error' })
      );
    });
  });

  describe('connection optimization gating', () => {
    const makeOptimization = (result: { allowed: boolean; reason?: string; queuePosition?: number }): jest.Mocked<ConnectionOptimizationService> =>
      createPartialMock<ConnectionOptimizationService>({
        shouldAllowConnection: jest.fn().mockReturnValue(result),
        registerConnection: jest.fn(),
        unregisterConnection: jest.fn(),
      });

    it('rejected with queue position: emits connection_rejected, keeps the socket, still binds handlers', () => {
      const bundle = buildBundle();
      const connectionOptimization = makeOptimization({ allowed: false, reason: 'Queue full', queuePosition: 3 });
      bundle.eventHandlers.setPerformanceServices(createPartialMock<PerformanceMonitoringService>({}), createPartialMock<ConnectionHealthService>({}), connectionOptimization);
      const { socket, namespace } = connectRoom(bundle);

      expect(socket.emitMock).toHaveBeenCalledWith('connection_rejected', { reason: 'Queue full', queuePosition: 3 });
      expect(socket.disconnect).not.toHaveBeenCalled();
      // Queued (not disconnected) sockets still get the full event surface.
      expect(bundle.performEventHandler.handleConnection).toHaveBeenCalledWith(socket, ROOM_ID, namespace);
    });

    it('rejected without queue position: emits connection_rejected and disconnects before binding handlers', () => {
      const bundle = buildBundle();
      const connectionOptimization = makeOptimization({ allowed: false, reason: 'At capacity' });
      bundle.eventHandlers.setPerformanceServices(createPartialMock<PerformanceMonitoringService>({}), createPartialMock<ConnectionHealthService>({}), connectionOptimization);
      const { socket } = connectRoom(bundle);

      expect(socket.emitMock).toHaveBeenCalledWith('connection_rejected', { reason: 'At capacity', queuePosition: undefined });
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(bundle.performEventHandler.handleConnection).not.toHaveBeenCalled();
    });

    it('allowed: registers the connection with the optimization service', () => {
      const bundle = buildBundle();
      const connectionOptimization = makeOptimization({ allowed: true });
      bundle.eventHandlers.setPerformanceServices(createPartialMock<PerformanceMonitoringService>({}), createPartialMock<ConnectionHealthService>({}), connectionOptimization);
      const { socket } = connectRoom(bundle);

      expect(connectionOptimization.registerConnection).toHaveBeenCalledWith(socket, ROOM_ID);
    });

    it('disconnect unregisters from optimization and health', async () => {
      const bundle = buildBundle();
      const connectionHealth = createPartialMock<ConnectionHealthService>({ registerConnection: jest.fn(), unregisterConnection: jest.fn() });
      const connectionOptimization = makeOptimization({ allowed: true });
      bundle.eventHandlers.setPerformanceServices(createPartialMock<PerformanceMonitoringService>({}), connectionHealth, connectionOptimization);
      const { socket } = connectRoom(bundle);

      bundle.roomSessionManager.getRoomSession.mockReturnValue(undefined);
      await emitDisconnect(socket);

      expect(connectionOptimization.unregisterConnection).toHaveBeenCalledWith(socket, ROOM_ID);
      expect(connectionHealth.unregisterConnection).toHaveBeenCalledWith(SOCKET_ID);
    });
  });

  describe('recovery-service accessors', () => {
    it('getSystemHealth reflects recovery state; clearErrorRecoveryState resets it', async () => {
      const bundle = buildBundle();
      const { socket } = connectRoom(bundle);

      // Trigger one recovery error (disconnect cleanup failure).
      bundle.roomSessionManager.getRoomSession.mockReturnValue(undefined);
      bundle.roomLifecycleHandler.handleLeaveRoom.mockRejectedValue(new Error('boom'));
      await emitDisconnect(socket);

      const health = bundle.eventHandlers.getSystemHealth();
      expect(health.isHealthy).toBe(true); // one error is far below the flooding threshold
      expect(health.errorRecoveryStats.totalErrors).toBe(1);
      expect(health.healthReport.totalErrors).toBe(1);

      bundle.eventHandlers.clearErrorRecoveryState();
      expect(bundle.eventHandlers.getSystemHealth().errorRecoveryStats.totalErrors).toBe(0);
    });

    it('getErrorRecoveryService exposes the internally shared instance', () => {
      const bundle = buildBundle();
      expect(bundle.eventHandlers.getErrorRecoveryService()).toBe(bundle.eventHandlers.getErrorRecoveryService());
    });
  });
});
