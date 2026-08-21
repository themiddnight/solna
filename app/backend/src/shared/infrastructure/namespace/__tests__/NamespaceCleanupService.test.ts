/**
 * NamespaceCleanupService — unit tests (BE-slices plan Task 20).
 *
 * Pattern: mocked namespaceManager/roomSessionManager/performanceMonitoring via
 * createPartialMock (TR-27 compliant) + fake timers (T5 microtask-flush
 * discipline). The 5-minute sweep scheduler is NODE_ENV-guarded (the production
 * guard added in this task), so the real sweep logic is driven on demand
 * through the public `forceCleanup()` path; the guard itself is pinned by the
 * scheduler test below.
 */
import { NamespaceCleanupService } from '../NamespaceCleanupService';
import type * as CleanupServiceModule from '../NamespaceCleanupService';
import type { NamespaceManager } from '../NamespaceManager';
import type { RoomSessionManager, NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { PerformanceMonitoringService } from '@/shared/infrastructure/performance/PerformanceMonitoringService';
import type { SystemPerformanceMetrics } from '@/shared/infrastructure/performance/PerformanceMonitoringService';
import { createPartialMock } from '@/testing/mocks';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import { CORE_NAMESPACES } from '@jam-band/shared';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logPerformanceMetric: jest.fn(),
    logSystemHealth: jest.fn(),
  },
}));

const ROOM_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ROOM_ID_B = 'b1c2d3e4f5061728394a5b6c7d8e9f01';
const ROOM_PATH = `/room/${ROOM_ID}`;
const ROOM_PATH_B = `/room/${ROOM_ID_B}`;
const APPROVAL_PATH = `/approval/${ROOM_ID}`;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

interface NamespaceDetail {
  path: string;
  connectionCount: number;
  createdAt: Date;
  lastActivity: Date;
  age: number;
}

function makeNamespaceDetail(
  path: string,
  options: { connectionCount?: number; lastActivityAgoMs?: number; createdAtAgoMs?: number } = {}
): NamespaceDetail {
  const now = Date.now();
  const lastActivityAgoMs = options.lastActivityAgoMs ?? 10 * MINUTE_MS;
  const createdAtAgoMs = options.createdAtAgoMs ?? lastActivityAgoMs;
  return {
    path,
    connectionCount: options.connectionCount ?? 0,
    createdAt: new Date(now - createdAtAgoMs),
    lastActivity: new Date(now - lastActivityAgoMs),
    age: createdAtAgoMs,
  };
}

function namespaceStats(details: NamespaceDetail[]): {
  totalNamespaces: number;
  totalConnections: number;
  namespaceDetails: NamespaceDetail[];
} {
  return {
    totalNamespaces: details.length,
    totalConnections: details.reduce((sum, detail) => sum + detail.connectionCount, 0),
    namespaceDetails: details,
  };
}

function systemMetrics(overrides: Partial<SystemPerformanceMetrics> = {}): SystemPerformanceMetrics {
  return {
    totalRooms: 0,
    totalConnections: 0,
    totalMemoryUsage: 100, // MB — well under the 600MB memory-pressure threshold
    averageRoomLatency: 0,
    systemHealth: 'healthy',
    uptime: 0,
    eventLoopLag: 0,
    gcMetrics: { heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 },
    sessionSummary: { totalSessions: 0, roomSessions: 0, approvalSessions: 0, lobbySessions: 0 },
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  // T5 microtask-flush discipline — drain promise queues after timer advances.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const mockNamespaceManager = createPartialMock<NamespaceManager>({
  getNamespaceStats: jest.fn(),
  cleanupNamespace: jest.fn(),
});
const mockRoomSessionManager = createPartialMock<RoomSessionManager>({
  cleanupRoomSessions: jest.fn(),
  cleanupExpiredSessions: jest.fn(),
  getApprovalSessions: jest.fn(),
  removeSession: jest.fn(),
  getSessionStats: jest.fn(),
});
const mockPerformanceMonitoring = createPartialMock<PerformanceMonitoringService>({
  getSystemMetrics: jest.fn(),
});

describe('NamespaceCleanupService', () => {
  let service: NamespaceCleanupService;

  beforeEach(() => {
    jest.useFakeTimers();

    // Default stubs — individual tests override per fixture. (jest.config has
    // clearMocks/resetMocks, and setup.ts clears mocks, so defaults are
    // re-established on every test.)
    mockNamespaceManager.getNamespaceStats.mockReturnValue(namespaceStats([]));
    mockNamespaceManager.cleanupNamespace.mockReturnValue(true);
    mockRoomSessionManager.cleanupExpiredSessions.mockResolvedValue(undefined);
    mockRoomSessionManager.getApprovalSessions.mockReturnValue(new Map());
    mockRoomSessionManager.removeSession.mockResolvedValue(true);
    mockRoomSessionManager.getSessionStats.mockReturnValue({
      totalSessions: 0,
      roomSessions: 0,
      approvalSessions: 0,
      lobbySessions: 0,
      roomBreakdown: [],
    });
    mockPerformanceMonitoring.getSystemMetrics.mockReturnValue(systemMetrics());

    service = NamespaceCleanupService.getInstance(
      mockNamespaceManager,
      mockRoomSessionManager,
      mockPerformanceMonitoring
    );
  });

  afterEach(() => {
    service.shutdown();
    jest.useRealTimers();
  });

  describe('rule registration and scheduler', () => {
    it('registers the four cleanup rules in priority order (empty → inactive → stale-approval → memory-pressure)', () => {
      const rules = service.getCleanupRules();
      expect(rules.map(rule => rule.name)).toEqual([
        'empty_namespaces',
        'inactive_namespaces',
        'stale_approval_namespaces',
        'memory_pressure_cleanup',
      ]);
    });

    it('registers no background sweep intervals under NODE_ENV=test (the guard added in this task)', async () => {
      // Fresh module registry (jest.config resetModules) → fresh class → fresh
      // singleton, so this test genuinely discriminates the NODE_ENV guard
      // instead of reusing the shared instance whose intervals were cleared by
      // an earlier test's shutdown().
      const freshModule = jest.requireActual<typeof CleanupServiceModule>('../NamespaceCleanupService');
      const freshService = freshModule.NamespaceCleanupService.getInstance(
        mockNamespaceManager,
        mockRoomSessionManager,
        mockPerformanceMonitoring
      );
      try {
        expect(process.env.NODE_ENV).toBe('test');
        expect(freshService).not.toBe(service);
        expect(freshService.getCleanupStatus().isRunning).toBe(false);

        // Neither the 5-minute regular sweep nor the 30-minute aggressive sweep fires.
        jest.advanceTimersByTime(35 * MINUTE_MS);
        await flushMicrotasks();

        expect(mockNamespaceManager.getNamespaceStats).not.toHaveBeenCalled();
      } finally {
        freshService.shutdown();
      }
    });
  });

  describe('priority rules (first match wins)', () => {
    it('empty_namespaces cleans an empty namespace idle past the 5-minute threshold', async () => {
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 10 * MINUTE_MS })])
      );

      const before = service.getCleanupMetrics().namespacesCleanedUp;
      const metrics = await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(ROOM_PATH);
      expect(mockRoomSessionManager.cleanupRoomSessions).toHaveBeenCalledWith(ROOM_ID);
      // The memory-pressure rule (priority 4) must not have run.
      expect(jest.mocked(loggingService.logSystemHealth)).not.toHaveBeenCalledWith(
        'memory_pressure_cleanup',
        expect.anything(),
        expect.anything()
      );
      expect(metrics.namespacesCleanedUp - before).toBe(1);
    });

    it('inactive_namespaces is a strict subset of empty_namespaces — a 45-minute-idle namespace is cleaned exactly once by the empty rule', async () => {
      // Every fixture that matches inactive (> 30 min idle) also matches empty
      // (> 5 min idle), so priority 1 always wins; the break prevents a second
      // cleanup pass by rule 2.
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 45 * MINUTE_MS })])
      );

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledTimes(1);
      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(ROOM_PATH);
    });

    it('first match wins: a namespace matching empty AND memory-pressure gets the higher-priority empty action only', async () => {
      // 0 connections + 10 min idle matches empty_namespaces (priority 1);
      // 0 connections + 700MB heap matches memory_pressure_cleanup (priority 4).
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 10 * MINUTE_MS })])
      );
      mockPerformanceMonitoring.getSystemMetrics.mockReturnValue(systemMetrics({ totalMemoryUsage: 700 }));

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledTimes(1);
      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(ROOM_PATH);
      expect(jest.mocked(loggingService.logSystemHealth)).not.toHaveBeenCalledWith(
        'memory_pressure_cleanup',
        expect.anything(),
        expect.anything()
      );
    });

    it('first match wins: an idle approval namespace matching empty + stale-approval gets the empty action (no approval-session sweep)', async () => {
      // 0 connections + 40 min idle matches empty (priority 1) and inactive
      // (priority 2); createdAt 40 min ago matches stale_approval (priority 3).
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([
          makeNamespaceDetail(APPROVAL_PATH, { lastActivityAgoMs: 40 * MINUTE_MS, createdAtAgoMs: 40 * MINUTE_MS }),
        ])
      );

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledTimes(1);
      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(APPROVAL_PATH);
      // Empty action sweeps room sessions; the stale-approval action (approval
      // session removal) must not run after the first match.
      expect(mockRoomSessionManager.cleanupRoomSessions).toHaveBeenCalledWith(ROOM_ID);
      expect(mockRoomSessionManager.getApprovalSessions).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.removeSession).not.toHaveBeenCalled();
    });

    it('memory_pressure_cleanup fires alone for a recently-active empty namespace under memory pressure', async () => {
      // 1 minute idle: too fresh for empty/inactive; 0 connections + 700MB heap
      // matches only memory_pressure_cleanup (its condition has no idle check).
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 1 * MINUTE_MS })])
      );
      mockPerformanceMonitoring.getSystemMetrics.mockReturnValue(systemMetrics({ totalMemoryUsage: 700 }));

      await service.forceCleanup();

      expect(jest.mocked(loggingService.logSystemHealth)).toHaveBeenCalledWith(
        'memory_pressure_cleanup',
        'warning',
        expect.objectContaining({ namespacePath: ROOM_PATH })
      );
      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(ROOM_PATH);
      expect(mockRoomSessionManager.cleanupRoomSessions).toHaveBeenCalledWith(ROOM_ID);
    });

    it('stale_approval_namespaces fires for an approval namespace older than 10 minutes even with live connections', async () => {
      // connectionCount 1 excludes empty/inactive/memory-pressure (all require
      // 0 connections); createdAt 11 minutes ago matches stale_approval.
      const session: NamespaceSession = {
        socketId: 'socket-1',
        roomId: ROOM_ID,
        userId: 'user-1',
        namespacePath: APPROVAL_PATH,
        connectedAt: new Date(),
        lastActivity: new Date(),
      };
      mockRoomSessionManager.getApprovalSessions.mockReturnValue(
        new Map<string, NamespaceSession>([
          ['socket-1', session],
          ['socket-2', session],
        ])
      );
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([
          makeNamespaceDetail(APPROVAL_PATH, {
            connectionCount: 1,
            lastActivityAgoMs: 1 * MINUTE_MS,
            createdAtAgoMs: 11 * MINUTE_MS,
          }),
        ])
      );

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(APPROVAL_PATH);
      expect(mockRoomSessionManager.getApprovalSessions).toHaveBeenCalledWith(ROOM_ID);
      expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith('socket-1');
      expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith('socket-2');
      // Approval namespaces get targeted session removal, not the room-wide sweep.
      expect(mockRoomSessionManager.cleanupRoomSessions).not.toHaveBeenCalled();
    });
  });

  describe('core namespaces', () => {
    it('never cleans core namespaces under normal conditions (empty/inactive rules carry the guard)', async () => {
      // Oldest possible fixture without memory pressure: rules 1 and 2 would
      // match but both carry the getCoreNamespaces() guard.
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([
          makeNamespaceDetail(CORE_NAMESPACES.LOBBY, { lastActivityAgoMs: 60 * MINUTE_MS, createdAtAgoMs: 60 * MINUTE_MS }),
          makeNamespaceDetail(CORE_NAMESPACES.LOBBY_MONITOR, { lastActivityAgoMs: 60 * MINUTE_MS, createdAtAgoMs: 60 * MINUTE_MS }),
        ])
      );

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).not.toHaveBeenCalled();
    });

    it('never cleans core namespaces even under memory pressure (memory_pressure_cleanup must carry the core guard)', async () => {
      // Shared contract (NamespacePaths.ts): core namespaces "should NEVER be
      // cleaned up by automatic cleanup services". Rules 1/2 guard core paths;
      // this asserts the memory-pressure rule (priority 4) does too — this test
      // went RED on 2026-08-15 and now pins the 2026-08-16 fix that added the
      // getCoreNamespaces() guard to rule 4.
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([
          makeNamespaceDetail(CORE_NAMESPACES.LOBBY, { lastActivityAgoMs: 60 * MINUTE_MS, createdAtAgoMs: 60 * MINUTE_MS }),
          makeNamespaceDetail(CORE_NAMESPACES.LOBBY_MONITOR, { lastActivityAgoMs: 60 * MINUTE_MS, createdAtAgoMs: 60 * MINUTE_MS }),
        ])
      );
      mockPerformanceMonitoring.getSystemMetrics.mockReturnValue(systemMetrics({ totalMemoryUsage: 700 }));

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.cleanupRoomSessions).not.toHaveBeenCalled();
    });
  });

  describe('destructive sweep gating', () => {
    // Pattern 10 (FAILURE_PATTERNS.md): cleanupRoomSessions deletes shared
    // state (Redis room/approval session hashes). The destructive follow-up
    // must only run when the primary cleanupNamespace succeeded — the gate
    // below is the destructive-sweep safety rail, pinned as existing behavior.

    it('runs cleanupRoomSessions with the extracted room id when cleanupNamespace succeeded on a room path', async () => {
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 10 * MINUTE_MS })])
      );

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(ROOM_PATH);
      expect(mockRoomSessionManager.cleanupRoomSessions).toHaveBeenCalledWith(ROOM_ID);
    });

    it('skips cleanupRoomSessions entirely when cleanupNamespace reports failure', async () => {
      mockNamespaceManager.cleanupNamespace.mockReturnValue(false);
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([
          makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 40 * MINUTE_MS }),
          makeNamespaceDetail(APPROVAL_PATH, {
            connectionCount: 1,
            lastActivityAgoMs: 1 * MINUTE_MS,
            createdAtAgoMs: 11 * MINUTE_MS,
          }),
        ])
      );

      await service.forceCleanup();

      // Both the empty action and the stale-approval action gate on success.
      expect(mockRoomSessionManager.cleanupRoomSessions).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.getApprovalSessions).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.removeSession).not.toHaveBeenCalled();
    });

    it('skips the session sweep when cleanupNamespace succeeded but no room id is extractable', async () => {
      // A non-core dynamic namespace without a room/approval prefix — no room id
      // can be extracted, so no destructive session sweep may run.
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([makeNamespaceDetail('/custom/segment', { lastActivityAgoMs: 10 * MINUTE_MS })])
      );

      await service.forceCleanup();

      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith('/custom/segment');
      expect(mockRoomSessionManager.cleanupRoomSessions).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.getApprovalSessions).not.toHaveBeenCalled();
    });

    it('logs a failing rule action and continues the sweep (next rule may re-match the same namespace)', async () => {
      mockNamespaceManager.cleanupNamespace
        .mockImplementationOnce(() => {
          throw new Error('boom');
        })
        .mockImplementationOnce(() => true);
      mockNamespaceManager.getNamespaceStats.mockReturnValue(
        namespaceStats([
          makeNamespaceDetail(ROOM_PATH, { lastActivityAgoMs: 45 * MINUTE_MS }),
          makeNamespaceDetail(ROOM_PATH_B, { lastActivityAgoMs: 10 * MINUTE_MS }),
        ])
      );

      await service.forceCleanup();

      expect(jest.mocked(loggingService.logError)).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'namespace_cleanup', rule: 'empty_namespaces' })
      );
      // Room A: empty action throws (1), inactive action re-matches and succeeds (2);
      // Room B: empty action succeeds (3). The sweep survives the failure.
      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledTimes(3);
      expect(mockNamespaceManager.cleanupNamespace).toHaveBeenCalledWith(ROOM_PATH_B);
    });
  });

  describe('expired session sweep', () => {
    it('passes the 1-hour cutoff to cleanupExpiredSessions and removes only sessions older than it', async () => {
      // Stateful fake mirroring RoomSessionManager.cleanupExpiredSessions
      // (inactiveTime > maxInactiveMs) so the cutoff boundary is real.
      const store = new Map<string, Date>();
      store.set('old-socket', new Date(Date.now() - 61 * MINUTE_MS));
      store.set('mid-socket', new Date(Date.now() - 30 * MINUTE_MS));
      store.set('fresh-socket', new Date(Date.now() - 10 * MINUTE_MS));
      mockRoomSessionManager.getSessionStats.mockImplementation(() => ({
        totalSessions: store.size,
        roomSessions: 0,
        approvalSessions: 0,
        lobbySessions: 0,
        roomBreakdown: [],
      }));
      mockRoomSessionManager.cleanupExpiredSessions.mockImplementation(async (maxInactiveMs?: number) => {
        const now = Date.now();
        const cutoff = maxInactiveMs ?? HOUR_MS;
        for (const [socketId, lastActivity] of [...store.entries()]) {
          if (now - lastActivity.getTime() > cutoff) {
            store.delete(socketId);
          }
        }
      });

      const before = service.getCleanupMetrics().sessionsCleanedUp;
      await service.forceCleanup();

      expect(mockRoomSessionManager.cleanupExpiredSessions).toHaveBeenCalledWith(HOUR_MS);
      expect(store.has('old-socket')).toBe(false);
      expect(store.has('mid-socket')).toBe(true);
      expect(store.has('fresh-socket')).toBe(true);
      expect(service.getCleanupMetrics().sessionsCleanedUp - before).toBe(1);
    });

    it('removes nothing when every session is newer than the 1-hour cutoff', async () => {
      const store = new Map<string, Date>();
      store.set('mid-socket', new Date(Date.now() - 30 * MINUTE_MS));
      store.set('fresh-socket', new Date(Date.now() - 10 * MINUTE_MS));
      mockRoomSessionManager.getSessionStats.mockImplementation(() => ({
        totalSessions: store.size,
        roomSessions: 0,
        approvalSessions: 0,
        lobbySessions: 0,
        roomBreakdown: [],
      }));
      mockRoomSessionManager.cleanupExpiredSessions.mockImplementation(async (maxInactiveMs?: number) => {
        const now = Date.now();
        const cutoff = maxInactiveMs ?? HOUR_MS;
        for (const [socketId, lastActivity] of [...store.entries()]) {
          if (now - lastActivity.getTime() > cutoff) {
            store.delete(socketId);
          }
        }
      });

      const before = service.getCleanupMetrics().sessionsCleanedUp;
      await service.forceCleanup();

      expect(mockRoomSessionManager.cleanupExpiredSessions).toHaveBeenCalledWith(HOUR_MS);
      expect(store.size).toBe(2);
      expect(service.getCleanupMetrics().sessionsCleanedUp - before).toBe(0);
    });
  });
});
