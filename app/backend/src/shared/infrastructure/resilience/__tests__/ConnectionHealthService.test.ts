import { describe, it, expect, jest } from '@jest/globals';
import type { PerformanceMonitoringService } from '../../performance/PerformanceMonitoringService';
import { asSocket } from '../../../../testing/mocks';

type NamespaceLike = {
  sockets: Map<string, { emit: ReturnType<typeof jest.fn> }>;
};

// Confined infra-boundary casts (house convention, see .claude/skills/test/SKILL.md)
const fakePerf = (): PerformanceMonitoringService =>
  ({ updateConnectionHealth: jest.fn(), removeConnectionHealth: jest.fn() }) as unknown as PerformanceMonitoringService;

const fakeSocket = () => ({ id: 'socket-1', emit: jest.fn(), on: jest.fn() });

function captureHandler(socket: ReturnType<typeof fakeSocket>, event: string): (data: unknown) => void {
  const call = socket.on.mock.calls.find(([name]) => name === event);
  return call?.[1] as (data: unknown) => void;
}

async function freshService(getNamespace?: (path: string) => NamespaceLike | null) {
  jest.resetModules();
  const { ConnectionHealthService } = await import('../ConnectionHealthService');
  return ConnectionHealthService.getInstance(fakePerf(), getNamespace);
}

describe('ConnectionHealthService — B1 regression (unwired ping path must not harm healthy connections)', () => {
  afterEach(() => {
    jest.useRealTimers(); // fake timers must not leak into the reachable-namespace tests
  });
  it('keeps a connection healthy when its namespace is unreachable', async () => {
    jest.useFakeTimers();
    const service = await freshService(undefined); // no getter → always unreachable
    const socket = fakeSocket();
    service.registerConnection(asSocket(socket), 'user-1', 'room-1', '/perform');

    jest.advanceTimersByTime(12_000); // well past a ping cycle: old code marked this stale here
    service.runHealthCheckCycle();

    const health = service.getConnectionHealth('socket-1');
    expect(health).toBeDefined();
    expect(health!.isHealthy).toBe(true);
    expect(health!.consecutiveFailures).toBe(0);
  });

  it('does not unregister an unreachable connection after errors and recovery cycles', async () => {
    jest.useFakeTimers();
    const service = await freshService(undefined);
    const socket = fakeSocket();
    service.registerConnection(asSocket(socket), 'user-1', 'room-1', '/perform');

    const onError = captureHandler(socket, 'error');
    onError(new Error('boom'));
    onError(new Error('boom'));
    onError(new Error('boom')); // reaches MAX_CONSECUTIVE_FAILURES
    expect(service.getConnectionHealth('socket-1')!.consecutiveFailures).toBe(3);

    for (let i = 0; i < 6; i++) {
      jest.advanceTimersByTime(35_000); // > maxRetryDelay (30s): every backoff step is satisfied
      service.runRecoveryCycle();
    }

    // Old code: after maxRetries (5) recovery attempts it calls unregisterConnection
    expect(service.getConnectionHealth('socket-1')).toBeDefined();
  });

  it('emits a ping to reachable sockets and updates health on pong', async () => {
    const nsSocket = { emit: jest.fn() };
    const getNamespace = (): NamespaceLike => ({ sockets: new Map([['socket-1', nsSocket]]) });
    const service = await freshService(getNamespace);
    const socket = fakeSocket();
    service.registerConnection(asSocket(socket), 'user-1', 'room-1', '/perform');

    service.runHealthCheckCycle();
    expect(nsSocket.emit).toHaveBeenCalledWith('ping', { timestamp: expect.any(Number) });

    const onPong = captureHandler(socket, 'pong');
    onPong({ timestamp: Date.now() - 100 });

    const health = service.getConnectionHealth('socket-1')!;
    expect(health.isHealthy).toBe(true);
    expect(health.responseTime).toBeGreaterThan(0);
  });

  it('marks a reachable socket unhealthy when it is missing from the namespace', async () => {
    const getNamespace = (): NamespaceLike => ({ sockets: new Map() });
    const service = await freshService(getNamespace);
    const socket = fakeSocket();
    service.registerConnection(asSocket(socket), 'user-1', 'room-1', '/perform');

    service.runHealthCheckCycle();

    expect(service.getConnectionHealth('socket-1')!.isHealthy).toBe(false);
  });

  it('marks a reachable connection stale when no ping has been sent for 2 full ping cycles (60s)', async () => {
    jest.useFakeTimers();
    const nsSocket = { emit: jest.fn() };
    const getNamespace = (): NamespaceLike => ({ sockets: new Map([['socket-1', nsSocket]]) });
    const service = await freshService(getNamespace);
    const socket = fakeSocket();
    service.registerConnection(asSocket(socket), 'user-1', 'room-1', '/perform');

    // lastPingTime was pinned at registration; > 2 × PING_INTERVAL_MS (60s)
    // elapses before the next health check → the staleness branch must trip.
    jest.advanceTimersByTime(61_000);
    service.runHealthCheckCycle();

    const health = service.getConnectionHealth('socket-1')!;
    expect(health.isHealthy).toBe(false);
    expect(health.consecutiveFailures).toBe(1);
  });
});
