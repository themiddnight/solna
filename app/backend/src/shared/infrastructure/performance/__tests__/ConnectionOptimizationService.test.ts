/**
 * ConnectionOptimizationService — unit tests (BE-slices plan Task 22).
 *
 * Documents the real behavior of the class (tests are GREEN against current code):
 *  - IP rate limit: 10 connection attempts per minute per IP (strict `>` window
 *    reset — exactly 60s is still within the window).
 *  - Connection queue: room full → queued (position 1-based); 30s timeout drops
 *    the queued socket (CONNECTION_TIMEOUT emit + disconnect); a freed slot lets
 *    the next optimization cycle (5s) approve the queue head (CONNECTION_APPROVED
 *    emit). Queue-full → hard reject.
 *  - Message batching: flush on batchSize (10) or after batchDelay (100ms);
 *    grouped by event type; multi-item groups emit `<event>_batch` while
 *    single-item groups emit the plain event (no suffix).
 *  - Memory pressure: `systemHealth === 'critical'` shrinks limits on the next
 *    5s cycle with hard floors (10/100/10/5).
 *
 * FE/BE contract point — the `${event}_batch` suffix (line 467 of the service):
 * the event name is string-concatenated in the backend and is NOT derived from a
 * shared constant, so any frontend consumer must listen for exactly
 * `<event>_batch` (TR-14: if the suffix ever changes, FE and BE must change in
 * lock-step). These tests pin the exact suffixed name.
 *
 * Pattern: fake `io.to(roomId).emit(...)` via createPartialMock (TR-27
 * compliant), fake timers for the 5s optimization loop / 30s queue timeout /
 * 100ms batch delay. No NODE_ENV guard was added: the private interval-driven
 * logic (processConnectionQueues, performOptimizations) is only reachable
 * through the 5s loop, so the loop is kept and driven under fake timers;
 * afterEach shutdown() clears every interval/timer before real timers return.
 * The singleton is re-created per test via jest.requireActual (jest.config
 * resetModules → fresh module → fresh static instance).
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Server, Socket } from 'socket.io';
import type * as ConnOptModule from '../ConnectionOptimizationService';
import type { PerformanceMonitoringService } from '../PerformanceMonitoringService';
import { ROOM_LIFECYCLE_EVENTS } from '@jam-band/shared';
import { createPartialMock } from '@/testing/mocks';

// Module-scope consts captured by the jest.mock factory below: with
// `resetModules: true` the factory re-runs per test, but the captured object
// is stable — so call assertions against these fns work for every fresh
// service instance.
const mockLoggingService = {
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
  logPerformanceMetric: jest.fn(),
  logSystemHealth: jest.fn(),
};
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: mockLoggingService,
}));

const ROOM = 'room-1';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/**
 * The exact type createPartialMock produces: `jest.Mocked<T>` as resolved in
 * @types/jest (shallow — methods are `MockInstance & T`), which differs from
 * the stricter `jest.Mocked` (= MockedObject) that @jest/globals exposes.
 */
type ShallowMocked<T extends object> = ReturnType<typeof createPartialMock<T>>;

/** Emitted through the fake `io.to(roomId).emit(...)` chain. */
interface EmittedMessage {
  roomId: string;
  event: string;
  data: unknown;
}

/**
 * Fake `Server` exposing only `to(roomId).emit(event, data)` — everything the
 * service uses. Captures every emit as an { roomId, event, data } triple.
 */
function makeFakeIo(): { io: ShallowMocked<Server>; emitted: EmittedMessage[] } {
  const emitted: EmittedMessage[] = [];
  let currentRoom = '';
  const operator = createPartialMock<ReturnType<Server['to']>>({
    emit: jest.fn((event: string, data: unknown): boolean => {
      emitted.push({ roomId: currentRoom, event, data });
      return true;
    }),
  });
  const io = createPartialMock<Server>({
    to: jest.fn((roomId: string | string[]) => {
      currentRoom = roomId as string;
      return operator;
    }),
  });
  return { io, emitted };
}

/**
 * Fake `Socket` with an empty `conn` object: the service feature-detects
 * `'pingInterval' in conn` (engine.io 6 typings expose no such property), so
 * the tuning branch is skipped without throwing and `optimizationsSaved` still
 * increments.
 */
function makeSocket(id: string, ip: string): {
  socket: Socket;
  emit: ReturnType<typeof jest.fn<(event: string, data: unknown) => boolean>>;
  disconnect: ReturnType<typeof jest.fn<(close?: boolean) => ShallowMocked<Socket>>>;
  compress: ReturnType<typeof jest.fn<(compress: boolean) => ShallowMocked<Socket>>>;
} {
  const emit = jest.fn((_event: string, _data: unknown): boolean => true);
  // The real members return `this`; the strict @jest/globals Mock typing
  // requires the mock's return to match the full mocked receiver type.
  const disconnect = jest.fn<(close?: boolean) => ShallowMocked<Socket>>();
  const compress = jest.fn<(compress: boolean) => ShallowMocked<Socket>>();
  const socket = createPartialMock<Socket>({
    id,
    emit,
    disconnect,
    compress,
    handshake: createPartialMock<Socket['handshake']>({ address: ip, headers: {} }),
    conn: createPartialMock<Socket['conn']>({}),
  });
  return { socket, emit, disconnect, compress };
}

function makeSystemMetrics(systemHealth: 'healthy' | 'warning' | 'critical') {
  return createPartialMock<PerformanceMonitoringService>({
    getSystemMetrics: jest.fn(() => ({
      totalRooms: 0,
      totalConnections: 0,
      totalMemoryUsage: 100,
      averageRoomLatency: 0,
      systemHealth,
      uptime: 0,
      eventLoopLag: 0,
      gcMetrics: { heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 },
      sessionSummary: { totalSessions: 0, roomSessions: 0, approvalSessions: 0, lobbySessions: 0 },
    })),
  });
}

describe('ConnectionOptimizationService', () => {
  let service: ConnOptModule.ConnectionOptimizationService;
  let io: ShallowMocked<Server>;
  let emitted: EmittedMessage[];
  let performanceMonitoring: ReturnType<typeof makeSystemMetrics>;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ io, emitted } = makeFakeIo());
    performanceMonitoring = makeSystemMetrics('healthy');
    // Fresh module registry (jest.config resetModules) → fresh class → fresh
    // singleton, so counters/queues/batches never leak between tests.
    const freshModule = jest.requireActual<typeof ConnOptModule>('../ConnectionOptimizationService');
    service = freshModule.ConnectionOptimizationService.getInstance(io, performanceMonitoring);
  });

  afterEach(() => {
    service.shutdown();
    jest.useRealTimers();
  });

  describe('IP rate limit — 10 connections per minute', () => {
    it('allows the first 10 attempts from one IP and rejects the 11th with "Rate limit exceeded"', () => {
      for (let i = 1; i <= 10; i++) {
        const { socket } = makeSocket(`s${i}`, '10.0.0.1');
        expect(service.shouldAllowConnection(socket, ROOM)).toEqual({ allowed: true });
      }

      const { socket } = makeSocket('s11', '10.0.0.1');
      expect(service.shouldAllowConnection(socket, ROOM)).toEqual({
        allowed: false,
        reason: 'Rate limit exceeded',
      });
      expect(service.getOptimizationMetrics().rejectedConnections).toBe(1);
    });

    it('does not reset at exactly 60s (strict > window) but allows the next attempt 1ms later', () => {
      for (let i = 1; i <= 10; i++) {
        const { socket } = makeSocket(`s${i}`, '10.0.0.2');
        expect(service.shouldAllowConnection(socket, ROOM).allowed).toBe(true);
      }

      jest.advanceTimersByTime(MINUTE_MS);
      const { socket: s11 } = makeSocket('s11', '10.0.0.2');
      expect(service.shouldAllowConnection(s11, ROOM).allowed).toBe(false);

      jest.advanceTimersByTime(1);
      const { socket: s12 } = makeSocket('s12', '10.0.0.2');
      expect(service.shouldAllowConnection(s12, ROOM).allowed).toBe(true);
      const { socket: s13 } = makeSocket('s13', '10.0.0.2');
      expect(service.shouldAllowConnection(s13, ROOM).allowed).toBe(true);
    });

    it('tracks attempts per IP independently', () => {
      for (let i = 1; i <= 10; i++) {
        const { socket: a } = makeSocket(`a${i}`, '10.0.0.10');
        expect(service.shouldAllowConnection(a, ROOM).allowed).toBe(true);
        const { socket: b } = makeSocket(`b${i}`, '10.0.0.11');
        expect(service.shouldAllowConnection(b, ROOM).allowed).toBe(true);
      }
    });
  });

  describe('connection queue', () => {
    /** Fill the room to maxConnectionsPerRoom (50) with direct registrations. */
    function fillRoom(count = 50): Socket[] {
      const sockets: Socket[] = [];
      for (let i = 1; i <= count; i++) {
        const { socket } = makeSocket(`fill-${i}`, `10.0.1.${i}`);
        service.registerConnection(socket, ROOM);
        sockets.push(socket);
      }
      return sockets;
    }

    it('queues a connection when the room is full and reports it via getQueueStatus', () => {
      fillRoom();
      const { socket } = makeSocket('queued-1', '10.0.2.1');

      const result = service.shouldAllowConnection(socket, ROOM);

      expect(result).toEqual({
        allowed: false,
        reason: 'Room full, queued for connection',
        queuePosition: 1,
      });
      expect(service.getQueueStatus()).toMatchObject({ totalQueued: 1 });
      expect(service.getOptimizationMetrics().queuedConnections).toBe(1);
    });

    it('drops a queued connection after the 30s timeout (CONNECTION_TIMEOUT emit + disconnect)', () => {
      fillRoom();
      const { socket, emit, disconnect } = makeSocket('queued-2', '10.0.2.2');
      service.shouldAllowConnection(socket, ROOM);

      jest.advanceTimersByTime(30 * SECOND_MS - 1);
      expect(emit).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(emit).toHaveBeenCalledWith(ROOM_LIFECYCLE_EVENTS.CONNECTION_TIMEOUT, {
        message: 'Connection request timed out',
      });
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(service.getQueueStatus().totalQueued).toBe(0);
      expect(service.getOptimizationMetrics().queuedConnections).toBe(0);
    });

    it('approves a queued connection when a slot frees up on the next 5s optimization cycle', () => {
      const fillSockets = fillRoom();
      const { socket, emit } = makeSocket('queued-3', '10.0.2.3');
      service.shouldAllowConnection(socket, ROOM);

      service.unregisterConnection(fillSockets[0]!, ROOM); // 50 → 49, one free slot
      jest.advanceTimersByTime(5 * SECOND_MS);

      expect(emit).toHaveBeenCalledWith(ROOM_LIFECYCLE_EVENTS.CONNECTION_APPROVED, {
        roomId: ROOM,
        message: 'Connection approved from queue',
      });
      expect(service.getQueueStatus().totalQueued).toBe(0);
      expect(service.getOptimizationMetrics().queuedConnections).toBe(0);
    });

    it('hard-rejects instead of queueing when the queue itself is full', () => {
      service.updateConfiguration({ connectionQueueSize: 1 });
      fillRoom();
      const { socket: first } = makeSocket('queued-4', '10.0.2.4');
      expect(service.shouldAllowConnection(first, ROOM).reason).toBe('Room full, queued for connection');
      const { socket: second } = makeSocket('queued-5', '10.0.2.5');
      expect(service.shouldAllowConnection(second, ROOM)).toEqual({
        allowed: false,
        reason: 'Room full and queue full',
      });
      expect(service.getOptimizationMetrics().rejectedConnections).toBe(1);
    });
  });

  describe('message batching', () => {
    it('flushes on the 10th message and emits `<event>_batch` with all 10 payloads', () => {
      // FE/BE contract: the batched event is the raw event name + "_batch"
      // (string-concatenated in the backend — not a shared constant), so FE
      // listeners must subscribe to exactly `<event>_batch`.
      for (let i = 1; i <= 10; i++) {
        service.optimizedEmit(ROOM, 'note_played', { note: i });
      }

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        roomId: ROOM,
        event: 'note_played_batch',
        data: Array.from({ length: 10 }, (_, i) => ({ note: i + 1 })),
      });
      expect(service.getOptimizationMetrics().messagesBatched).toBe(10);
    });

    it('flushes via the 100ms timer — nothing at 99ms, batch emit at 100ms', () => {
      for (let i = 1; i <= 9; i++) {
        service.optimizedEmit(ROOM, 'control_changed', { value: i });
      }
      expect(emitted).toHaveLength(0);

      jest.advanceTimersByTime(99);
      expect(emitted).toHaveLength(0);

      jest.advanceTimersByTime(1);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        roomId: ROOM,
        event: 'control_changed_batch',
        data: Array.from({ length: 9 }, (_, i) => ({ value: i + 1 })),
      });
    });

    it('emits the plain event (no _batch suffix) when a timer-flushed batch holds a single message', () => {
      service.optimizedEmit(ROOM, 'note_played', { note: 1 });
      jest.advanceTimersByTime(100);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        roomId: ROOM,
        event: 'note_played', // single-item group → no suffix (dataArray.length === 1 path)
        data: { note: 1 },
      });
    });

    it('groups mixed event types into one `<event>_batch` emit per type', () => {
      service.optimizedEmit(ROOM, 'evt_a', { n: 1 });
      service.optimizedEmit(ROOM, 'evt_b', { n: 1 });
      service.optimizedEmit(ROOM, 'evt_a', { n: 2 });
      service.optimizedEmit(ROOM, 'evt_b', { n: 2 });
      jest.advanceTimersByTime(100);

      expect(emitted).toHaveLength(2);
      expect(emitted).toContainEqual({ roomId: ROOM, event: 'evt_a_batch', data: [{ n: 1 }, { n: 2 }] });
      expect(emitted).toContainEqual({ roomId: ROOM, event: 'evt_b_batch', data: [{ n: 1 }, { n: 2 }] });
    });

    it('bypasses batching when immediate=true — plain emit, no batch metric', () => {
      service.optimizedEmit(ROOM, 'note_played', { note: 1 }, true);
      service.optimizedEmit(ROOM, 'note_played', { note: 2 }, true);

      expect(emitted).toHaveLength(2);
      expect(emitted[0]!.event).toBe('note_played');
      expect(emitted[0]!.data).toEqual({ note: 1 });
      expect(service.getOptimizationMetrics().messagesBatched).toBe(0);
    });

    it('bypasses batching when batching is disabled via updateConfiguration', () => {
      service.updateConfiguration({ batchingEnabled: false });
      service.optimizedEmit(ROOM, 'note_played', { note: 1 });
      service.optimizedEmit(ROOM, 'note_played', { note: 2 });

      expect(emitted).toHaveLength(2);
      expect(emitted[0]!.event).toBe('note_played');
      expect(service.getOptimizationMetrics().messagesBatched).toBe(0);
    });
  });

  describe('memory-pressure configuration shrink', () => {
    it('shrinks limits on the next 5s cycle when system health is critical', () => {
      performanceMonitoring.getSystemMetrics.mockReturnValue({
        totalRooms: 0,
        totalConnections: 0,
        totalMemoryUsage: 900,
        averageRoomLatency: 0,
        systemHealth: 'critical',
        uptime: 0,
        eventLoopLag: 0,
        gcMetrics: { heapUsed: 900, heapTotal: 0, external: 0, arrayBuffers: 0 },
        sessionSummary: { totalSessions: 0, roomSessions: 0, approvalSessions: 0, lobbySessions: 0 },
      });

      jest.advanceTimersByTime(5 * SECOND_MS);

      expect(service.getConfiguration()).toMatchObject({
        maxConnectionsPerRoom: 40, // 50 * 0.8
        maxConnectionsGlobal: 800, // 1000 * 0.8
        connectionQueueSize: 50, // 100 * 0.5
        batchSize: 7, // 10 * 0.7
      });
      expect(mockLoggingService.logSystemHealth).toHaveBeenCalledWith(
        'connection_optimization',
        'warning',
        expect.objectContaining({ message: 'Adjusted connection limits due to memory pressure' })
      );
    });

    it('keeps shrinking until the hard floors (10 / 100 / 10 / 5) are reached', () => {
      performanceMonitoring.getSystemMetrics.mockReturnValue({
        totalRooms: 0,
        totalConnections: 0,
        totalMemoryUsage: 900,
        averageRoomLatency: 0,
        systemHealth: 'critical',
        uptime: 0,
        eventLoopLag: 0,
        gcMetrics: { heapUsed: 900, heapTotal: 0, external: 0, arrayBuffers: 0 },
        sessionSummary: { totalSessions: 0, roomSessions: 0, approvalSessions: 0, lobbySessions: 0 },
      });

      // Cycle 1: 40 / 800 / 50 / 7 — Cycle 2: 32 / 640 / 25 / 5 (batchSize floors)
      // Cycle 3: 25 / 512 / 12 / 5 — Cycle 4: 20 / 409 / 10 / 5 (queueSize floors)
      for (let cycle = 0; cycle < 4; cycle++) {
        jest.advanceTimersByTime(5 * SECOND_MS);
      }
      expect(service.getConfiguration()).toMatchObject({
        maxConnectionsPerRoom: 20,
        maxConnectionsGlobal: 409,
        connectionQueueSize: 10,
        batchSize: 5,
      });

      // Further cycles must not drop below the floors.
      jest.advanceTimersByTime(5 * SECOND_MS);
      expect(service.getConfiguration()).toMatchObject({
        connectionQueueSize: 10,
        batchSize: 5,
      });
    });

    it('leaves the configuration untouched when system health is healthy', () => {
      jest.advanceTimersByTime(5 * SECOND_MS);

      expect(service.getConfiguration()).toMatchObject({
        maxConnectionsPerRoom: 50,
        maxConnectionsGlobal: 1000,
        connectionQueueSize: 100,
        batchSize: 10,
      });
      expect(mockLoggingService.logSystemHealth).not.toHaveBeenCalled();
    });
  });

  describe('connection registration bookkeeping', () => {
    it('registerConnection increments room/global counts and optimizationsSaved', () => {
      const { socket, compress } = makeSocket('reg-1', '10.0.3.1');
      service.registerConnection(socket, ROOM);

      const stats = service.getConnectionStats();
      expect(stats.totalConnections).toBe(1);
      expect(stats.connectionsByRoom.get(ROOM)).toBe(1);
      expect(compress).toHaveBeenCalledWith(true); // compressionEnabled default true
      expect(service.getOptimizationMetrics().optimizationsSaved).toBe(1);
    });

    it('unregisterConnection decrements and removes the room entry at zero', () => {
      const { socket } = makeSocket('reg-2', '10.0.3.2');
      service.registerConnection(socket, ROOM);
      service.registerConnection(makeSocket('reg-3', '10.0.3.3').socket, ROOM);
      service.unregisterConnection(socket, ROOM);

      expect(service.getConnectionStats().totalConnections).toBe(1);
      service.unregisterConnection(makeSocket('reg-3', '10.0.3.3').socket, ROOM);

      const stats = service.getConnectionStats();
      expect(stats.totalConnections).toBe(0);
      expect(stats.connectionsByRoom.size).toBe(0);
    });
  });
});
