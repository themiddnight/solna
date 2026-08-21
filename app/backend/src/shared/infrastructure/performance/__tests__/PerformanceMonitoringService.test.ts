/**
 * PerformanceMonitoringService — unit tests (BE-slices plan Task 22).
 *
 * Documents the real behavior of the class (tests are GREEN against current code):
 *  - Stale cleanup: rooms and connections idle for more than 30 minutes are
 *    removed on the 5-minute cleanup cycle (strict `>` — exactly 30 min
 *    survives); rooms with `connectionCount > 0` are never cleaned.
 *  - Health classification boundaries (asserted via a process.memoryUsage spy):
 *    healthy ≤ 500MB, warning 501–800MB, critical > 800MB (strict comparisons:
 *    exactly 500MB → healthy, exactly 800MB → warning).
 *  - Event/error counters: recordRoomEvent increments messageCount and per-event
 *    eventCounts; slow events (duration > 1000ms, strict) are recorded with a
 *    100-event cap; recordRoomError increments errorCount only for known rooms.
 *  - Latency threshold: connection health pings above 500ms (strict) log
 *    'high_connection_latency'.
 *  - analyzePerformance alerts (via the 30s monitoring cycle): >10 room errors,
 *    >50 slow events, >10% unhealthy connections, and system health warning/
 *    critical transitions.
 *
 * Pattern: createPartialMock (TR-27 compliant) for namespaceManager /
 * roomSessionManager, a jest.spyOn(process, 'memoryUsage') for the health
 * thresholds, and fake timers to drive the three background loops (30s
 * monitoring / 5min cleanup / 10s health check) — all private interval-driven
 * logic is exercised through the real loops. No NODE_ENV guard was added: the
 * private interval callbacks are the only reachable path into performCleanup /
 * collectSystemMetrics / analyzePerformance, so the loops are kept and driven
 * under fake timers; afterEach shutdown() clears every interval before real
 * timers return. The singleton is re-created per test via jest.requireActual
 * (jest.config resetModules → fresh module → fresh static instance).
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type * as PerfModule from '../PerformanceMonitoringService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager, NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
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
const MB = 1024 * 1024;

const mockNamespaceManager = createPartialMock<NamespaceManager>({
  getNamespaceStats: jest.fn<NamespaceManager['getNamespaceStats']>(),
});
const mockRoomSessionManager = createPartialMock<RoomSessionManager>({
  getSessionStats: jest.fn<RoomSessionManager['getSessionStats']>(),
  getRoomSessions: jest.fn<RoomSessionManager['getRoomSessions']>(),
});

function defaultMemoryUsage(heapUsedMB: number): NodeJS.MemoryUsage {
  return { rss: 0, heapTotal: 0, heapUsed: heapUsedMB * MB, external: 0, arrayBuffers: 0 };
}

describe('PerformanceMonitoringService', () => {
  let service: PerfModule.PerformanceMonitoringService;

  beforeEach(() => {
    jest.useFakeTimers();
    mockNamespaceManager.getNamespaceStats.mockReturnValue({
      totalNamespaces: 0,
      totalConnections: 0,
      namespaceDetails: [],
    });
    mockRoomSessionManager.getSessionStats.mockReturnValue({
      totalSessions: 0,
      roomSessions: 0,
      approvalSessions: 0,
      lobbySessions: 0,
      roomBreakdown: [],
    });
    mockRoomSessionManager.getRoomSessions.mockReturnValue(new Map());
    jest.spyOn(process, 'memoryUsage').mockReturnValue(defaultMemoryUsage(200)); // healthy default
    // Fresh module registry (jest.config resetModules) → fresh class → fresh
    // singleton, so maps/counters never leak between tests.
    const freshModule = jest.requireActual<typeof PerfModule>('../PerformanceMonitoringService');
    service = freshModule.PerformanceMonitoringService.getInstance(mockNamespaceManager, mockRoomSessionManager);
  });

  afterEach(() => {
    service.shutdown();
    jest.useRealTimers();
  });

  describe('room event counters', () => {
    it('creates room metrics on first event and accumulates message and per-event counts', () => {
      service.recordRoomEvent(ROOM, 'note_played');
      service.recordRoomEvent(ROOM, 'note_played');
      service.recordRoomEvent(ROOM, 'control_changed');

      const metrics = service.getRoomMetrics(ROOM)!;
      expect(metrics.messageCount).toBe(3);
      expect(metrics.eventCounts.get('note_played')).toBe(2);
      expect(metrics.eventCounts.get('control_changed')).toBe(1);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.slowEvents).toHaveLength(0);
      expect(metrics.createdAt).toBeInstanceOf(Date);
      expect(metrics.lastActivity).toBeInstanceOf(Date);
      expect(service.getRoomMetrics('unknown-room')).toBeUndefined();
    });

    it('records slow events only above the strict 1000ms threshold', () => {
      service.recordRoomEvent(ROOM, 'slow_op', 1000); // exactly at threshold → not slow
      service.recordRoomEvent(ROOM, 'slow_op', 1001); // just over → slow

      const metrics = service.getRoomMetrics(ROOM)!;
      expect(metrics.slowEvents).toHaveLength(1);
      expect(metrics.slowEvents[0]).toMatchObject({ event: 'slow_op', duration: 1001 });
      expect(mockLoggingService.logPerformanceMetric).toHaveBeenCalledWith(
        'slow_room_event',
        1001,
        expect.objectContaining({ roomId: ROOM, eventName: 'slow_op', threshold: 1000 })
      );
    });

    it('caps the slow-events list at 100 entries, keeping the most recent', () => {
      for (let i = 0; i < 101; i++) {
        service.recordRoomEvent(ROOM, `evt_${i}`, 2000);
      }

      const metrics = service.getRoomMetrics(ROOM)!;
      expect(metrics.slowEvents).toHaveLength(100);
      expect(metrics.slowEvents[0]!.event).toBe('evt_1'); // first (evt_0) dropped
      expect(metrics.slowEvents[99]!.event).toBe('evt_100'); // most recent kept
    });
  });

  describe('room error counters', () => {
    it('increments errorCount for a known room and logs with performance impact', () => {
      service.recordRoomEvent(ROOM, 'op');
      service.recordRoomError(ROOM, new Error('boom'), { phase: 'decode' });

      expect(service.getRoomMetrics(ROOM)!.errorCount).toBe(1);
      expect(mockLoggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ roomId: ROOM, context: { phase: 'decode' }, performanceImpact: true })
      );
    });

    it('does not create metrics for an unknown room', () => {
      service.recordRoomError('ghost-room', new Error('boom'));

      expect(service.getRoomMetrics('ghost-room')).toBeUndefined();
      expect(service.getAllRoomMetrics().size).toBe(0);
    });
  });

  describe('connection health metrics', () => {
    it('creates an entry with defaults and merges partial updates', () => {
      service.updateConnectionHealth('sock-1', 'user-1', ROOM, '/perform/room-1', {});

      const health = service.getConnectionHealth().get('sock-1')!;
      expect(health).toMatchObject({
        socketId: 'sock-1',
        userId: 'user-1',
        roomId: ROOM,
        namespacePath: '/perform/room-1',
        connectionState: 'connected',
        latency: 0,
        errorCount: 0,
        reconnectAttempts: 0,
      });
      expect(health.lastPing).toBeInstanceOf(Date);

      service.updateConnectionHealth('sock-1', 'user-1', ROOM, '/perform/room-1', { latency: 42, errorCount: 1 });
      expect(service.getConnectionHealth().get('sock-1')).toMatchObject({ latency: 42, errorCount: 1 });
    });

    it('logs high connection latency only above the strict 500ms threshold', () => {
      service.updateConnectionHealth('sock-1', 'user-1', ROOM, '/perform/room-1', { latency: 500 });
      expect(mockLoggingService.logPerformanceMetric).not.toHaveBeenCalled();

      service.updateConnectionHealth('sock-1', 'user-1', ROOM, '/perform/room-1', { latency: 501 });
      expect(mockLoggingService.logPerformanceMetric).toHaveBeenCalledWith(
        'high_connection_latency',
        501,
        expect.objectContaining({ socketId: 'sock-1', userId: 'user-1', roomId: ROOM, threshold: 500 })
      );
    });

    it('removeConnectionHealth drops the tracked entry', () => {
      service.updateConnectionHealth('sock-1', 'user-1', ROOM, '/perform/room-1', {});
      service.removeConnectionHealth('sock-1');

      expect(service.getConnectionHealth().has('sock-1')).toBe(false);
    });
  });

  describe('stale cleanup — 30 minute threshold (5-minute cleanup cycle)', () => {
    it('keeps an idle room at exactly 30 minutes and removes it on the next cycle', () => {
      service.recordRoomEvent(ROOM, 'op'); // lastActivity = t0

      jest.advanceTimersByTime(30 * MINUTE_MS);
      expect(service.getRoomMetrics(ROOM)).toBeDefined(); // 30min is not > 30min

      jest.advanceTimersByTime(5 * MINUTE_MS);
      expect(service.getRoomMetrics(ROOM)).toBeUndefined(); // 35min idle → cleaned
    });

    it('removes idle connection health entries after more than 30 minutes', () => {
      service.updateConnectionHealth('sock-1', 'user-1', ROOM, '/perform/room-1', {}); // lastPing = t0

      jest.advanceTimersByTime(30 * MINUTE_MS);
      expect(service.getConnectionHealth().has('sock-1')).toBe(true);

      jest.advanceTimersByTime(5 * MINUTE_MS);
      expect(service.getConnectionHealth().has('sock-1')).toBe(false);
    });

    it('keeps a room that had activity within the window', () => {
      service.recordRoomEvent(ROOM, 'op'); // t0
      jest.advanceTimersByTime(29 * MINUTE_MS);
      service.recordRoomEvent(ROOM, 'op'); // lastActivity = t0 + 29min
      jest.advanceTimersByTime(6 * MINUTE_MS); // 35min total, 6min since activity

      expect(service.getRoomMetrics(ROOM)).toBeDefined();
    });

    it('never cleans a stale room that still has connections (connectionCount > 0)', () => {
      service.recordRoomEvent(ROOM, 'op');
      mockRoomSessionManager.getRoomSessions.mockReturnValue(
        new Map<string, NamespaceSession>([['sock-1', createPartialMock<NamespaceSession>({})]])
      );

      jest.advanceTimersByTime(35 * MINUTE_MS);

      expect(service.getRoomMetrics(ROOM)).toBeDefined();
    });
  });

  describe('system health classification boundaries (memory thresholds 500MB / 800MB)', () => {
    it('classifies exactly 500MB as healthy (strict > 500MB for warning)', () => {
      jest.mocked(process.memoryUsage).mockReturnValue(defaultMemoryUsage(500));
      jest.advanceTimersByTime(30 * SECOND_MS);

      expect(service.getSystemMetrics().systemHealth).toBe('healthy');
      expect(mockLoggingService.logSystemHealth).not.toHaveBeenCalledWith('performance', 'warning', expect.anything());
    });

    it('classifies 501MB as warning', () => {
      jest.mocked(process.memoryUsage).mockReturnValue(defaultMemoryUsage(501));
      jest.advanceTimersByTime(30 * SECOND_MS);

      expect(service.getSystemMetrics().systemHealth).toBe('warning');
      expect(mockLoggingService.logSystemHealth).toHaveBeenCalledWith(
        'performance',
        'warning',
        expect.objectContaining({ message: 'System performance degraded' })
      );
    });

    it('classifies exactly 800MB as warning, not critical (strict > 800MB)', () => {
      jest.mocked(process.memoryUsage).mockReturnValue(defaultMemoryUsage(800));
      jest.advanceTimersByTime(30 * SECOND_MS);

      expect(service.getSystemMetrics().systemHealth).toBe('warning');
    });

    it('classifies 801MB as critical and logs the critical alert', () => {
      jest.mocked(process.memoryUsage).mockReturnValue(defaultMemoryUsage(801));
      jest.advanceTimersByTime(30 * SECOND_MS);

      expect(service.getSystemMetrics().systemHealth).toBe('critical');
      expect(mockLoggingService.logSystemHealth).toHaveBeenCalledWith(
        'performance',
        'error',
        expect.objectContaining({ message: 'System performance is critical' })
      );
    });
  });

  describe('system metrics collection', () => {
    it('flows namespace and session stats into system metrics', () => {
      mockNamespaceManager.getNamespaceStats.mockReturnValue({
        totalNamespaces: 3,
        totalConnections: 12,
        namespaceDetails: [],
      });
      mockRoomSessionManager.getSessionStats.mockReturnValue({
        totalSessions: 17,
        roomSessions: 12,
        approvalSessions: 3,
        lobbySessions: 2,
        roomBreakdown: [],
      });

      jest.advanceTimersByTime(30 * SECOND_MS);

      const system = service.getSystemMetrics();
      expect(system.totalRooms).toBe(3);
      expect(system.totalConnections).toBe(12);
      expect(system.totalMemoryUsage).toBe(200); // from the memoryUsage spy (MB, rounded)
      expect(system.gcMetrics.heapUsed).toBe(200);
      expect(system.sessionSummary).toEqual({ totalSessions: 17, roomSessions: 12, approvalSessions: 3, lobbySessions: 2 });
    });
  });

  describe('analyzePerformance thresholds (30s monitoring cycle)', () => {
    it('warns when a room accumulates more than 10 errors', () => {
      for (let i = 0; i < 10; i++) {
        service.recordRoomEvent(ROOM, 'op');
        service.recordRoomError(ROOM, new Error('e'));
      }
      jest.advanceTimersByTime(30 * SECOND_MS);
      expect(mockLoggingService.logSystemHealth).not.toHaveBeenCalledWith(
        'room_performance',
        'warning',
        expect.objectContaining({ roomId: ROOM })
      );

      service.recordRoomError(ROOM, new Error('e')); // 11 errors
      jest.advanceTimersByTime(30 * SECOND_MS);
      expect(mockLoggingService.logSystemHealth).toHaveBeenCalledWith(
        'room_performance',
        'warning',
        expect.objectContaining({ roomId: ROOM, errorCount: 11 })
      );
    });

    it('warns when a room accumulates more than 50 slow events', () => {
      for (let i = 0; i < 51; i++) {
        service.recordRoomEvent(ROOM, 'slow', 2000);
      }
      jest.advanceTimersByTime(30 * SECOND_MS);

      expect(mockLoggingService.logSystemHealth).toHaveBeenCalledWith(
        'room_performance',
        'warning',
        expect.objectContaining({ roomId: ROOM, slowEventsCount: 51 })
      );
    });

    it('warns only when unhealthy connections exceed 10% (strict >)', () => {
      mockNamespaceManager.getNamespaceStats.mockReturnValue({
        totalNamespaces: 1,
        totalConnections: 10,
        namespaceDetails: [],
      });
      // 1 of 10 unhealthy → exactly 10% → no warning
      service.updateConnectionHealth('sock-err', 'user-err', ROOM, '/perform/room-1', { connectionState: 'error' });
      for (let i = 0; i < 9; i++) {
        service.updateConnectionHealth(`sock-ok-${i}`, `user-ok-${i}`, ROOM, '/perform/room-1', {});
      }
      jest.advanceTimersByTime(30 * SECOND_MS);
      expect(mockLoggingService.logSystemHealth).not.toHaveBeenCalledWith('connection_health', 'warning', expect.anything());

      // 2 of 10 → 20% → warning
      service.updateConnectionHealth('sock-err2', 'user-err2', ROOM, '/perform/room-1', { errorCount: 6 });
      jest.advanceTimersByTime(30 * SECOND_MS);
      expect(mockLoggingService.logSystemHealth).toHaveBeenCalledWith(
        'connection_health',
        'warning',
        expect.objectContaining({ message: 'High number of unhealthy connections', unhealthyConnections: 2 })
      );
    });
  });

  describe('getPerformanceSummary', () => {
    it('classifies connections healthy only when connected with errorCount < 3', () => {
      service.updateConnectionHealth('healthy-1', 'u1', ROOM, '/perform/room-1', { errorCount: 2 });
      service.updateConnectionHealth('unhealthy-1', 'u2', ROOM, '/perform/room-1', { errorCount: 3 });
      service.updateConnectionHealth('unhealthy-2', 'u3', ROOM, '/perform/room-1', { connectionState: 'error' });

      const summary = service.getPerformanceSummary();
      expect(summary.connectionCount).toBe(3);
      expect(summary.healthyConnections).toBe(1);
      expect(summary.unhealthyConnections).toBe(2);
    });

    it('ranks top-performing rooms by messageCount and slowest rooms by slow-event count', () => {
      service.recordRoomEvent('room-fast', 'op');
      service.recordRoomEvent('room-fast', 'op');
      service.recordRoomEvent('room-fast', 'op'); // 3 messages
      service.recordRoomEvent('room-slow', 'slow', 2000); // 1 message, 1 slow event
      service.recordRoomEvent('room-slow', 'slow', 2000); // 2 messages, 2 slow events

      const summary = service.getPerformanceSummary();
      expect(summary.topPerformingRooms).toEqual([
        { roomId: 'room-fast', messageCount: 3 },
        { roomId: 'room-slow', messageCount: 2 },
      ]);
      expect(summary.slowestRooms).toEqual([
        { roomId: 'room-slow', slowEventsCount: 2 },
        { roomId: 'room-fast', slowEventsCount: 0 },
      ]);
    });
  });
});
