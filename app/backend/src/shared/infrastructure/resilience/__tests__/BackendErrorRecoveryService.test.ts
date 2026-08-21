/**
 * BackendErrorRecoveryService.test.ts — flood gate, recovery-action table, health threshold.
 *
 * Documents the real behavior of the service (tests are GREEN against current code):
 *  - Flood gate: per-error-type counts are keyed by 60s window (floor(timestamp / 60000)).
 *    The gate trips when the window count REACHES ERROR_THRESHOLD (10), i.e. on the 10th
 *    error of one type within the window. Errors 1-9 are recovered; the 10th is suppressed
 *    and a `logSystemHealth(..., 'warning', ...)` is emitted.
 *  - Recovery actions: the switch table in `determineRecoveryAction`, asserted per type via
 *    the real `handleError` → `executeRecoveryAction` path on a mocked socket.
 *  - isSystemHealthy(): flips when any per-type window rate exceeds 80% of the threshold
 *    (rate > 8), i.e. healthy up to 8 errors, unhealthy from 9.
 *
 * Time control per the T3 ruling (bun's jest runtime breaks jest.useFakeTimers):
 * a pinned `Date.now` spy + explicit `context.timestamp`s. All count keys and window math
 * derive from `Math.floor(ts / 60000)`, so pinned time is fully deterministic.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { BackendErrorRecoveryService, BackendErrorType } from '../BackendErrorRecoveryService';
import type { BackendErrorContext } from '../BackendErrorRecoveryService';
import { loggingService } from '../../logging/LoggingService';
import { asSocket } from '../../../../testing/mocks';

jest.mock('../../logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
    logInfo: jest.fn(),
    logSystemHealth: jest.fn(),
  },
}));

// Fixed instant: every window derivation in the tests is computed from this constant.
const NOW = 1_700_000_000_000;
const WINDOW_MS = 60_000;

// Confined infra-boundary cast (house convention, see .claude/skills/test/SKILL.md):
// socket.io's Socket is a huge generic interface — the mock only carries the members
// the service touches (id/emit/disconnect); the cast lives in testing/mocks.ts.
const fakeSocket = () => ({ id: 'socket-1', emit: jest.fn(), disconnect: jest.fn() });

const makeContext = (overrides: Partial<BackendErrorContext> = {}): BackendErrorContext => ({
  errorType: BackendErrorType.UnknownError,
  message: 'boom',
  timestamp: NOW,
  ...overrides,
});

const pinNow = (): jest.SpiedFunction<() => number> => jest.spyOn(Date, 'now').mockReturnValue(NOW);

describe('BackendErrorRecoveryService — flood gate (per-type counts in a 60s window)', () => {
  it('does not trip with 9 errors of one type; every error still runs its recovery action', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    for (let i = 0; i < 9; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }), asSocket(socket));
    }

    expect(socket.emit).toHaveBeenCalledTimes(9);
    expect(loggingService.logSystemHealth).not.toHaveBeenCalled();
  });

  it('trips the gate on the 10th error of one type in a window: recovery suppressed, flood warning logged', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    for (let i = 0; i < 10; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }), asSocket(socket));
    }

    expect(socket.emit).toHaveBeenCalledTimes(9); // errors 1-9 recovered; the 10th is suppressed
    expect(loggingService.logSystemHealth).toHaveBeenCalledTimes(1);
  });

  it('counts per error type — mixing types in one window does not trip the gate', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    for (let i = 0; i < 6; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }), asSocket(socket));
    }
    for (let i = 0; i < 5; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.NetworkError }), asSocket(socket));
    }

    expect(socket.emit).toHaveBeenCalledTimes(11);
    expect(loggingService.logSystemHealth).not.toHaveBeenCalled();
  });

  it('window resets after 60s — earlier-window counts do not carry over', async () => {
    const nowSpy = pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    for (let i = 0; i < 11; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }), asSocket(socket));
    }
    expect(socket.emit).toHaveBeenCalledTimes(9); // gate tripped on the 10th, 11th suppressed too

    // 61s later the same type starts a fresh window: count is 1 again, recovery runs.
    nowSpy.mockReturnValue(NOW + WINDOW_MS + 1);
    await service.handleError(
      makeContext({ errorType: BackendErrorType.DatabaseError, timestamp: NOW + WINDOW_MS + 1 }),
      asSocket(socket)
    );

    expect(socket.emit).toHaveBeenCalledTimes(10);
    expect(loggingService.logSystemHealth).toHaveBeenCalledTimes(2); // floods on the 10th and 11th, both in the old window
    expect(service.getErrorStats().errorRates[BackendErrorType.DatabaseError]).toBe(1);
  });
});

describe('BackendErrorRecoveryService — isSystemHealthy flips at the 80% threshold', () => {
  it('stays healthy up to 8 errors of one type in the current window (80% of 10)', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    for (let i = 0; i < 8; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }), asSocket(socket));
    }

    expect(service.isSystemHealthy()).toBe(true);
  });

  it('flips to unhealthy from 9 errors of one type (rate above 80% of the threshold)', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    for (let i = 0; i < 9; i++) {
      await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }), asSocket(socket));
    }

    expect(service.isSystemHealthy()).toBe(false);
  });
});

describe('BackendErrorRecoveryService — recovery action mapping (the real switch table)', () => {
  const RECOVERY_TABLE: Array<{
    errorType: BackendErrorType;
    event: 'error' | 'room_state_reset';
    payload: Record<string, unknown>;
    disconnect?: true;
    message?: string;
  }> = [
    {
      errorType: BackendErrorType.NamespaceConnectionError,
      event: 'error',
      payload: { message: 'Connection error. Please try again.', code: 'CONNECTION_ERROR', retryAfter: 5 },
    },
    {
      errorType: BackendErrorType.SessionManagementError,
      event: 'error',
      payload: { message: 'Session error. Please reconnect.', code: 'SESSION_ERROR' },
      disconnect: true,
    },
    {
      errorType: BackendErrorType.RoomStateError,
      event: 'room_state_reset',
      payload: { message: 'Room state error. Refreshing room data.', code: 'ROOM_STATE_ERROR' },
    },
    {
      errorType: BackendErrorType.ValidationError,
      event: 'error',
      payload: { message: 'Invalid request data.', code: 'VALIDATION_ERROR' },
      message: '', // empty message hits the table fallback (non-empty passthrough tested separately)
    },
    {
      errorType: BackendErrorType.RateLimitError,
      event: 'error',
      payload: { message: 'Rate limit exceeded. Please slow down.', code: 'RATE_LIMITED', retryAfter: 10 },
    },
    {
      errorType: BackendErrorType.PermissionError,
      event: 'error',
      payload: { message: 'Permission denied.', code: 'PERMISSION_DENIED' },
    },
    {
      errorType: BackendErrorType.DatabaseError,
      event: 'error',
      payload: { message: 'Server error. Please try again later.', code: 'SERVER_ERROR', retryAfter: 30 },
    },
    {
      errorType: BackendErrorType.NetworkError,
      event: 'error',
      payload: { message: 'Network error. Please check your connection.', code: 'NETWORK_ERROR', retryAfter: 5 },
    },
    {
      errorType: BackendErrorType.UnknownError,
      event: 'error',
      payload: { message: 'An unexpected error occurred.', code: 'UNKNOWN_ERROR', retryAfter: 10 },
    },
  ];

  it.each(RECOVERY_TABLE)(
    'maps $errorType to the $event payload with code $payload.code',
    async ({ errorType, event, payload, disconnect, message }) => {
      pinNow();
      const service = new BackendErrorRecoveryService();
      const socket = fakeSocket();

      await service.handleError(
        makeContext(message !== undefined ? { errorType, message } : { errorType }),
        asSocket(socket)
      );

      expect(socket.emit).toHaveBeenCalledTimes(1);
      expect(socket.emit).toHaveBeenCalledWith(event, payload);
      if (disconnect === true) {
        expect(socket.disconnect).toHaveBeenCalledWith(true);
      } else {
        expect(socket.disconnect).not.toHaveBeenCalled();
      }
    }
  );

  it('ValidationError with a non-empty message echoes the original message (fallback only for empty)', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();
    const socket = fakeSocket();

    await service.handleError(makeContext({ errorType: BackendErrorType.ValidationError, message: 'Bad payload' }), asSocket(socket));

    expect(socket.emit).toHaveBeenCalledWith('error', {
      message: 'Bad payload',
      code: 'VALIDATION_ERROR',
    });
  });

  it('without a socket the recovery action is skipped safely and still reported as executed', async () => {
    pinNow();
    const service = new BackendErrorRecoveryService();

    await service.handleError(makeContext({ errorType: BackendErrorType.DatabaseError }));

    expect(loggingService.logInfo).toHaveBeenCalledWith(
      'Recovery action executed',
      expect.objectContaining({ action: 'send_error_response', errorType: BackendErrorType.DatabaseError })
    );
  });
});
