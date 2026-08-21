import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import type * as EnvironmentModule from '../../config/environment';
import { config } from '../../config/environment';
import type {
  PerformanceMonitoringService,
  SystemPerformanceMetrics,
  RoomPerformanceMetrics,
} from '../../shared/infrastructure/performance/PerformanceMonitoringService';
import type { ConnectionHealthService } from '../../shared/infrastructure/resilience/ConnectionHealthService';
import type { NamespaceCleanupService, CleanupMetrics, CleanupRule } from '../../shared/infrastructure/namespace/NamespaceCleanupService';
import type { ConnectionOptimizationService } from '../../shared/infrastructure/performance/ConnectionOptimizationService';
import { createPerformanceRoutes } from '../performance';

/**
 * Full route suite for routes/performance.ts (REST admin surface for the
 * performance/resilience services, Requirement 11.x). Harness: REAL router
 * (createPerformanceRoutes) + supertest + mocked service layer — the services
 * are injected through the factory, so they are the infra boundary here.
 *
 * Auth: requirePerformanceAuth compares x-api-key against config.performance.apiKey.
 * The key is PINNED below (before the config module evaluates) so the
 * admin-gated suites always run — the coverage gate must not depend on
 * whether the ambient environment carries the dev PERFORMANCE_API_KEY.
 */

// jest.mock is hoisted above the imports, so this factory runs before
// config/environment is first required — and before routes/performance.ts
// captures PERFORMANCE_API_KEY at module load (line 26 of the route). The real
// config module is loaded unmodified afterwards (test-land only, no prod change).
jest.mock('../../config/environment', () => {
  process.env.PERFORMANCE_API_KEY = 'test-performance-key';
  return jest.requireActual<typeof EnvironmentModule>('../../config/environment');
});

const API_KEY = config.performance.apiKey;
// Key is always present (see factory above); the fallback only satisfies the
// `string | undefined` config typing.
const API_KEY_VALUE = API_KEY ?? '';
const authSuites = describe;

// Confined cast: supertest's res.body is `any` at the infra boundary — type it
// once here so the strict no-unsafe-* rules stay satisfied (TR-27).
function bodyOf(res: request.Response): { success: boolean; data: Record<string, unknown> } {
  return res.body as { success: boolean; data: Record<string, unknown> };
}

// ─── Mock service layer (infra boundary — confined casts, TR-27) ───────────

const mockGetSystemMetrics = jest.fn() as jest.Mock<SystemPerformanceMetrics>;
const mockGetPerformanceSummary = jest.fn() as jest.Mock<{
  system: SystemPerformanceMetrics;
  roomCount: number;
  connectionCount: number;
  healthyConnections: number;
  unhealthyConnections: number;
  topPerformingRooms: Array<{ roomId: string; messageCount: number }>;
  slowestRooms: Array<{ roomId: string; slowEventsCount: number }>;
}>;
const mockGetAllRoomMetrics = jest.fn() as jest.Mock<Map<string, RoomPerformanceMetrics>>;
const mockGetRoomMetrics = jest.fn() as jest.Mock<RoomPerformanceMetrics | undefined>;

const mockGetHealthStatus = jest.fn() as jest.Mock<{
  totalConnections: number;
  healthyConnections: number;
  unhealthyConnections: number;
  connectionsInRecovery: number;
  averageResponseTime: number;
  connectionsByRoom: Map<string, { healthy: number; unhealthy: number }>;
}>;
const mockGetAllHealthChecks = jest.fn() as jest.Mock<
  Map<string, { socketId: string; userId: string; roomId: string; isHealthy: boolean }>
>;

const mockGetCleanupMetrics = jest.fn() as jest.Mock<CleanupMetrics>;
const mockGetCleanupStatus = jest.fn() as jest.Mock<{
  isRunning: boolean;
  nextRegularCleanup: Date;
  nextAggressiveCleanup: Date;
  metrics: CleanupMetrics;
  systemMemoryUsage: number;
  memoryPressure: boolean;
}>;
const mockGetCleanupRules = jest.fn() as jest.Mock<CleanupRule[]>;
const mockForceCleanup = jest.fn() as jest.Mock<Promise<CleanupMetrics>>;

const mockGetOptimizationMetrics = jest.fn() as jest.Mock<{
  totalConnections: number;
  queuedConnections: number;
  rejectedConnections: number;
  averageConnectionTime: number;
  messagesBatched: number;
  compressionRatio: number;
  optimizationsSaved: number;
}>;
const mockGetConnectionStats = jest.fn() as jest.Mock<{
  totalConnections: number;
  connectionsByRoom: Map<string, number>;
  queuedByRoom: Map<string, number>;
  averageConnectionsPerRoom: number;
  peakConnections: number;
}>;
const mockGetQueueStatus = jest.fn() as jest.Mock<{
  totalQueued: number;
  queuesByRoom: Array<{ roomId: string; queueSize: number; maxSize: number }>;
  longestWaitTime: number;
}>;
const mockGetConfiguration = jest.fn() as jest.Mock<Record<string, unknown>>;
const mockUpdateConfiguration = jest.fn() as jest.Mock<void>;

// Confined casts at the infra boundary: the route only calls the methods above,
// so a partial mock object satisfies the service contract for this test.
const monitoringMock = {
  getSystemMetrics: mockGetSystemMetrics,
  getPerformanceSummary: mockGetPerformanceSummary,
  getAllRoomMetrics: mockGetAllRoomMetrics,
  getRoomMetrics: mockGetRoomMetrics,
} as unknown as PerformanceMonitoringService;

const healthMock = {
  getHealthStatus: mockGetHealthStatus,
  getAllHealthChecks: mockGetAllHealthChecks,
} as unknown as ConnectionHealthService;

const cleanupMock = {
  getCleanupMetrics: mockGetCleanupMetrics,
  getCleanupStatus: mockGetCleanupStatus,
  getCleanupRules: mockGetCleanupRules,
  forceCleanup: mockForceCleanup,
} as unknown as NamespaceCleanupService;

const optimizationMock = {
  getOptimizationMetrics: mockGetOptimizationMetrics,
  getConnectionStats: mockGetConnectionStats,
  getQueueStatus: mockGetQueueStatus,
  getConfiguration: mockGetConfiguration,
  updateConfiguration: mockUpdateConfiguration,
} as unknown as ConnectionOptimizationService;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const systemMetrics: SystemPerformanceMetrics = {
  totalRooms: 2,
  totalConnections: 5,
  totalMemoryUsage: 100,
  averageRoomLatency: 12,
  systemHealth: 'healthy',
  uptime: 3600,
  eventLoopLag: 1,
  gcMetrics: { heapUsed: 1, heapTotal: 2, external: 0, arrayBuffers: 0 },
  sessionSummary: { totalSessions: 1, roomSessions: 1, approvalSessions: 0, lobbySessions: 0 },
};

const performanceSummary = {
  system: systemMetrics,
  roomCount: 2,
  connectionCount: 5,
  healthyConnections: 4,
  unhealthyConnections: 1,
  topPerformingRooms: [{ roomId: 'r1', messageCount: 40 }],
  slowestRooms: [{ roomId: 'r2', slowEventsCount: 2 }],
};

const roomMetrics: RoomPerformanceMetrics = {
  roomId: 'r1',
  connectionCount: 3,
  messageCount: 40,
  averageLatency: 8,
  errorCount: 1,
  lastActivity: new Date(),
  createdAt: new Date(),
  memoryUsage: 10,
  cpuUsage: 2,
  eventCounts: new Map([['note', 3], ['play', 1]]),
  slowEvents: [
    { event: 'e1', duration: 1, timestamp: new Date() },
    { event: 'e2', duration: 2, timestamp: new Date() },
  ],
};

// 11 slow events so the "slice(-10)" cap is observable.
const roomMetricsManySlow: RoomPerformanceMetrics = {
  ...roomMetrics,
  slowEvents: Array.from({ length: 11 }, (_, i) => ({ event: `e${i}`, duration: i, timestamp: new Date() })),
};

const healthStatus = {
  totalConnections: 4,
  healthyConnections: 3,
  unhealthyConnections: 1,
  connectionsInRecovery: 0,
  averageResponseTime: 5,
  connectionsByRoom: new Map([['r1', { healthy: 3, unhealthy: 1 }]]),
};

const healthChecks = new Map([['s1', { socketId: 's1', userId: 'u1', roomId: 'r1', isHealthy: true }]]);

const cleanupMetrics: CleanupMetrics = {
  namespacesChecked: 10,
  namespacesCleanedUp: 3,
  sessionsCleanedUp: 5,
  memoryFreed: 1024,
  cleanupDuration: 50,
  lastCleanup: new Date(),
};

const cleanupStatus = {
  isRunning: false,
  nextRegularCleanup: new Date(),
  nextAggressiveCleanup: new Date(),
  metrics: cleanupMetrics,
  systemMemoryUsage: 100,
  memoryPressure: false,
};

const cleanupRules: CleanupRule[] = [
  { name: 'stale-rooms', condition: () => true, action: async () => undefined, priority: 1 },
  { name: 'orphan-sessions', condition: () => true, action: async () => undefined, priority: 2 },
];

const optimizationMetrics = {
  totalConnections: 4,
  queuedConnections: 1,
  rejectedConnections: 0,
  averageConnectionTime: 3,
  messagesBatched: 10,
  compressionRatio: 0.5,
  optimizationsSaved: 2,
};

const connectionStats = {
  totalConnections: 4,
  connectionsByRoom: new Map([['r1', 4]]),
  queuedByRoom: new Map([['r1', 1]]),
  averageConnectionsPerRoom: 4,
  peakConnections: 4,
};

const queueStatus = {
  totalQueued: 1,
  queuesByRoom: [{ roomId: 'r1', queueSize: 1, maxSize: 5 }],
  longestWaitTime: 2,
};

const configuration = {
  maxConnectionsPerRoom: 100,
  maxConnectionsGlobal: 500,
  connectionQueueSize: 10,
  connectionTimeout: 30000,
  heartbeatInterval: 30000,
  compressionEnabled: true,
  batchingEnabled: true,
  batchSize: 5,
  batchDelay: 0,
};

function setHappyPathDefaults(): void {
  mockGetSystemMetrics.mockReturnValue(systemMetrics);
  mockGetPerformanceSummary.mockReturnValue(performanceSummary);
  mockGetAllRoomMetrics.mockReturnValue(new Map([['r1', roomMetrics]]));
  mockGetRoomMetrics.mockReturnValue(roomMetrics);
  mockGetHealthStatus.mockReturnValue(healthStatus);
  mockGetAllHealthChecks.mockReturnValue(healthChecks);
  mockGetCleanupMetrics.mockReturnValue(cleanupMetrics);
  mockGetCleanupStatus.mockReturnValue(cleanupStatus);
  mockGetCleanupRules.mockReturnValue(cleanupRules);
  mockForceCleanup.mockResolvedValue(cleanupMetrics);
  mockGetOptimizationMetrics.mockReturnValue(optimizationMetrics);
  mockGetConnectionStats.mockReturnValue(connectionStats);
  mockGetQueueStatus.mockReturnValue(queueStatus);
  mockGetConfiguration.mockReturnValue(configuration);
  mockUpdateConfiguration.mockImplementation(() => undefined);
}

const app: Express = express();
app.use(express.json());
app.use('/api/performance', createPerformanceRoutes(monitoringMock, healthMock, cleanupMock, optimizationMock));

describe('requirePerformanceAuth — x-api-key gate', () => {
  it('rejects a request with no API key (403)', async () => {
    const res = await request(app).get('/api/performance/system');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('rejects a wrong API key (403)', async () => {
    const res = await request(app).get('/api/performance/system').set('x-api-key', 'wrong-key');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Forbidden' });
  });
});

authSuites('GET /system', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns system metrics and the performance summary', async () => {
    const res = await request(app).get('/api/performance/system').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(bodyOf(res).success).toBe(true);
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({
        system: systemMetrics,
        summary: performanceSummary,
        timestamp: expect.any(String) as unknown,
      }),
    );
  });

  it('maps a service failure to 500', async () => {
    mockGetSystemMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/system').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve system performance metrics' });
  });
});

authSuites('GET /rooms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('flattens the per-room metric map with eventCounts + slowEventsCount', async () => {
    const res = await request(app).get('/api/performance/rooms').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    const rooms = (res.body as { data: { rooms: Array<Record<string, unknown>> } }).data.rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toEqual(
      expect.objectContaining({
        roomId: 'r1',
        connectionCount: 3,
        eventCounts: { note: 3, play: 1 },
        slowEventsCount: 2,
      }),
    );
    expect((res.body as { data: { totalRooms: number } }).data.totalRooms).toBe(1);
  });

  it('maps a service failure to 500', async () => {
    mockGetAllRoomMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/rooms').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve room performance metrics' });
  });
});

authSuites('GET /rooms/:roomId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns the room metrics with slowEvents capped at the last 10', async () => {
    mockGetRoomMetrics.mockReturnValue(roomMetricsManySlow);
    const res = await request(app).get('/api/performance/rooms/r1').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    const data = (res.body as { data: { roomId: string; eventCounts: Record<string, number>; slowEvents: unknown[] } }).data;
    expect(data.roomId).toBe('r1');
    expect(data.eventCounts).toEqual({ note: 3, play: 1 });
    expect(data.slowEvents).toHaveLength(10);
    expect(mockGetRoomMetrics).toHaveBeenCalledWith('r1');
  });

  it('returns 404 when the room has no metrics', async () => {
    mockGetRoomMetrics.mockReturnValue(undefined);
    const res = await request(app).get('/api/performance/rooms/ghost').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Room metrics not found' });
  });

  it('maps a service failure to 500', async () => {
    mockGetRoomMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/rooms/r1').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve room performance metrics' });
  });
});

authSuites('GET /connections/health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns the health status and per-socket health checks', async () => {
    const res = await request(app).get('/api/performance/connections/health').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({
        // status.connectionsByRoom is a Map and cannot survive JSON serialization —
        // assert the scalar fields instead.
        status: expect.objectContaining({
          totalConnections: 4,
          healthyConnections: 3,
          unhealthyConnections: 1,
          averageResponseTime: 5,
        }) as Record<string, unknown>,
        healthChecks: [{ socketId: 's1', userId: 'u1', roomId: 'r1', isHealthy: true }],
      }),
    );
  });

  it('maps a service failure to 500', async () => {
    mockGetHealthStatus.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/connections/health').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve connection health metrics' });
  });
});

authSuites('GET /connections/optimization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns metrics, stats (maps flattened), queue status and configuration', async () => {
    const res = await request(app).get('/api/performance/connections/optimization').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({
        metrics: optimizationMetrics,
        stats: expect.objectContaining({
          totalConnections: 4,
          connectionsByRoom: { r1: 4 },
          queuedByRoom: { r1: 1 },
        }) as Record<string, unknown>,
        queue: queueStatus,
        configuration,
      }),
    );
  });

  it('maps a service failure to 500', async () => {
    mockGetOptimizationMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/connections/optimization').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve connection optimization metrics' });
  });
});

authSuites('GET /cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns cleanup metrics, status and rules projected to name/priority', async () => {
    const res = await request(app).get('/api/performance/cleanup').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({
        // Date fields serialize to ISO strings — assert scalar fields instead.
        metrics: expect.objectContaining({
          namespacesChecked: 10,
          namespacesCleanedUp: 3,
          sessionsCleanedUp: 5,
          memoryFreed: 1024,
          cleanupDuration: 50,
          lastCleanup: expect.any(String) as unknown,
        }) as Record<string, unknown>,
        status: expect.objectContaining({ isRunning: false, memoryPressure: false }) as Record<string, unknown>,
        rules: [
          { name: 'stale-rooms', priority: 1 },
          { name: 'orphan-sessions', priority: 2 },
        ],
      }),
    );
  });

  it('maps a service failure to 500', async () => {
    mockGetCleanupMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/cleanup').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve cleanup metrics' });
  });
});

authSuites('POST /cleanup/force', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('runs a forced cleanup and returns the metrics', async () => {
    const res = await request(app).post('/api/performance/cleanup/force').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(mockForceCleanup).toHaveBeenCalled();
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({
        message: 'Cleanup completed successfully',
        metrics: expect.objectContaining({ namespacesCleanedUp: 3, sessionsCleanedUp: 5, memoryFreed: 1024 }) as Record<string, unknown>,
      }),
    );
  });

  it('maps a service failure to 500', async () => {
    mockForceCleanup.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/performance/cleanup/force').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to perform cleanup' });
  });
});

authSuites('PUT /connections/optimization/config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('validates the body (zod) then applies the configuration', async () => {
    const res = await request(app)
      .put('/api/performance/connections/optimization/config')
      .set('x-api-key', API_KEY_VALUE)
      .send({ maxConnectionsPerRoom: 200, compressionEnabled: false });

    expect(res.status).toBe(200);
    expect(mockUpdateConfiguration).toHaveBeenCalledWith({ maxConnectionsPerRoom: 200, compressionEnabled: false });
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({ message: 'Configuration updated successfully', configuration }),
    );
  });

  it('rejects a non-integer maxConnectionsPerRoom with 400 and the zod message', async () => {
    const res = await request(app)
      .put('/api/performance/connections/optimization/config')
      .set('x-api-key', API_KEY_VALUE)
      .send({ maxConnectionsPerRoom: 'many' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid input: expected number, received string' });
    expect(mockUpdateConfiguration).not.toHaveBeenCalled();
  });

  it('rejects a negative batchDelay with 400 (nonnegative constraint)', async () => {
    const res = await request(app)
      .put('/api/performance/connections/optimization/config')
      .set('x-api-key', API_KEY_VALUE)
      .send({ batchDelay: -1 });

    expect(res.status).toBe(400);
    expect(bodyOf(res).success).toBe(false);
    expect(mockUpdateConfiguration).not.toHaveBeenCalled();
  });

  it('maps a service failure to 500', async () => {
    mockUpdateConfiguration.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app)
      .put('/api/performance/connections/optimization/config')
      .set('x-api-key', API_KEY_VALUE)
      .send({ maxConnectionsPerRoom: 100 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to update configuration' });
  });
});

authSuites('GET /dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('aggregates system, connections, performance and cleanup data', async () => {
    const res = await request(app).get('/api/performance/dashboard').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual(
      expect.objectContaining({
        system: expect.objectContaining({ health: 'healthy', totalRooms: 2, totalConnections: 5 }) as Record<string, unknown>,
        connections: expect.objectContaining({ total: 4, healthy: 3, unhealthy: 1, queued: 1, rejected: 0 }) as Record<string, unknown>,
        performance: expect.objectContaining({
          topRooms: performanceSummary.topPerformingRooms,
          slowestRooms: performanceSummary.slowestRooms,
          messagesBatched: 10,
          optimizationsSaved: 2,
        }) as Record<string, unknown>,
        cleanup: expect.objectContaining({ isRunning: false, memoryPressure: false, namespacesCleanedUp: 3, memoryFreed: 1024 }) as Record<string, unknown>,
      }),
    );
  });

  it('maps a service failure to 500', async () => {
    mockGetSystemMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/dashboard').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to retrieve dashboard data' });
  });
});

authSuites('GET /health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns 200 healthy when the system is healthy and few connections are unhealthy', async () => {
    // 1 of 4 unhealthy would be >= the 20% threshold — use 0 unhealthy for the healthy case.
    mockGetHealthStatus.mockReturnValue({ ...healthStatus, unhealthyConnections: 0 });
    const res = await request(app).get('/api/performance/health').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(200);
    expect(bodyOf(res).success).toBe(true);
    expect(bodyOf(res).data).toEqual(expect.objectContaining({ status: 'healthy', totalConnections: 4, healthyConnections: 3 }));
  });

  it('returns 503 when systemHealth is critical', async () => {
    mockGetSystemMetrics.mockReturnValue({ ...systemMetrics, systemHealth: 'critical' });
    const res = await request(app).get('/api/performance/health').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(503);
    expect(bodyOf(res).success).toBe(false);
    expect((bodyOf(res).data as { status: string }).status).toBe('unhealthy');
  });

  it('returns 503 when more than 20% of connections are unhealthy', async () => {
    mockGetHealthStatus.mockReturnValue({ ...healthStatus, totalConnections: 5, unhealthyConnections: 3 });
    const res = await request(app).get('/api/performance/health').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(503);
    expect(bodyOf(res).success).toBe(false);
  });

  it('maps a service failure to 500', async () => {
    mockGetSystemMetrics.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/performance/health').set('x-api-key', API_KEY_VALUE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Health check failed' });
  });
});
