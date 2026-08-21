import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePingMeasurement } from '../hooks/usePingMeasurement';
import { createMockSocket, asMockSocket } from '@/test-utils/mockSocket';
import { SHARED_EVENTS } from '@jam-band/shared';

describe('usePingMeasurement', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reports connected state and a computed ping after a round trip', () => {
    const mockSocket = createMockSocket();
    mockSocket.connected = true;

    const { result } = renderHook(() =>
      usePingMeasurement({ socket: asMockSocket(mockSocket), interval: 10_000 })
    );

    act(() => { mockSocket.trigger('connect'); });
    expect(result.current.isConnected).toBe(true);

    act(() => { vi.advanceTimersByTime(1000); }); // connect-stabilize delay before first ping
    expect(mockSocket.emit).toHaveBeenCalledWith(
      SHARED_EVENTS.PING_MEASUREMENT,
      expect.objectContaining({ pingId: expect.any(String) as string })
    );

    const [, payload] = mockSocket.emit.mock.calls.find(
      ([event]) => event === SHARED_EVENTS.PING_MEASUREMENT
    )! as [string, { pingId: string; timestamp: number }];

    act(() => {
      vi.advanceTimersByTime(42);
      mockSocket.trigger(SHARED_EVENTS.PING_RESPONSE, { pingId: payload.pingId, timestamp: payload.timestamp });
      vi.advanceTimersByTime(500); // UI_THROTTLE
    });

    expect(result.current.currentPing).toBeGreaterThanOrEqual(42);
  });
});
