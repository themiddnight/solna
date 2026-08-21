import { ApprovalSessionManager } from '../ApprovalSessionManager';

describe('ApprovalSessionManager', () => {
  let manager: ApprovalSessionManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new ApprovalSessionManager();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createApprovalSession', () => {
    it('stores the session in both maps and exposes it by socket and user id', () => {
      const session = manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
      );

      expect(session).toMatchObject({
        roomId: 'room-1',
        userId: 'user-1',
        username: 'alice',
        role: 'band_member',
      });
      expect(session.requestedAt).toBeInstanceOf(Date);
      expect(session.timeoutId).toBeDefined();
      expect(manager.getApprovalSession('socket-1')).toBe(session);
      expect(manager.getApprovalSessionByUserId('user-1')).toBe(session);
      expect(manager.hasApprovalSession('user-1')).toBe(true);
    });

    it('replaces a prior session for the same user and clears its timer (no double-fire)', () => {
      const firstCallback = jest.fn();
      const secondCallback = jest.fn();

      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
        firstCallback,
      );
      const replacement = manager.createApprovalSession(
        'socket-2',
        'room-1',
        'user-1',
        'alice',
        'audience',
        secondCallback,
      );

      // Old socket mapping is gone from both maps
      expect(manager.getApprovalSession('socket-1')).toBeUndefined();
      expect(manager.getApprovalSessionByUserId('user-1')).toBe(replacement);
      expect(manager.getApprovalSessionsForRoom('room-1')).toHaveLength(1);

      // Only the replacement session's timer survives — no double-fire
      jest.advanceTimersByTime(manager.getApprovalTimeoutMs());

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledTimes(1);
      expect(secondCallback).toHaveBeenCalledWith('socket-2', replacement);
    });

    it('returns undefined for lookups of unknown sockets and users', () => {
      expect(manager.getApprovalSession('socket-unknown')).toBeUndefined();
      expect(manager.getApprovalSessionByUserId('user-unknown')).toBeUndefined();
      expect(manager.hasApprovalSession('user-unknown')).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('fires the callback once after the configured delay (10 minutes)', () => {
      const callback = jest.fn();
      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
        callback,
      );

      expect(manager.getApprovalTimeoutMs()).toBe(600000);

      jest.advanceTimersByTime(manager.getApprovalTimeoutMs() - 1);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        'socket-1',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('keeps the session in place when an explicit callback is provided (the caller removes it)', () => {
      const callback = jest.fn();
      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
        callback,
      );

      jest.advanceTimersByTime(manager.getApprovalTimeoutMs());

      expect(callback).toHaveBeenCalledTimes(1);
      expect(manager.getApprovalSession('socket-1')).toBeDefined();
      expect(manager.hasApprovalSession('user-1')).toBe(true);
    });

    it('uses the internal handler when no callback is given — the timed-out session is removed', () => {
      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
      );

      jest.advanceTimersByTime(manager.getApprovalTimeoutMs());

      expect(manager.getApprovalSession('socket-1')).toBeUndefined();
      expect(manager.getApprovalSessionByUserId('user-1')).toBeUndefined();
      expect(manager.hasApprovalSession('user-1')).toBe(false);
    });

    it('clears the pending timeout when the session is removed before it fires', () => {
      const callback = jest.fn();
      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
        callback,
      );

      const removed = manager.removeApprovalSession('socket-1');
      expect(removed?.userId).toBe('user-1');

      jest.advanceTimersByTime(manager.getApprovalTimeoutMs() * 2);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('removeApprovalSessionByUserId', () => {
    it('keeps both maps consistent — session gone from socket and user lookups', () => {
      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
      );
      manager.createApprovalSession(
        'socket-2',
        'room-1',
        'user-2',
        'bob',
        'audience',
      );

      const removed = manager.removeApprovalSessionByUserId('user-1');

      expect(removed?.userId).toBe('user-1');
      expect(manager.getApprovalSession('socket-1')).toBeUndefined();
      expect(manager.getApprovalSessionByUserId('user-1')).toBeUndefined();
      expect(manager.hasApprovalSession('user-1')).toBe(false);

      // The other user's session is untouched
      expect(manager.getApprovalSession('socket-2')).toBeDefined();
      expect(manager.getApprovalSessionByUserId('user-2')).toBeDefined();
      expect(manager.hasApprovalSession('user-2')).toBe(true);
    });

    it('returns undefined for a user with no active session', () => {
      expect(manager.removeApprovalSessionByUserId('user-unknown')).toBeUndefined();
    });
  });

  describe('getApprovalSessionsForRoom', () => {
    it('returns only the sessions for the requested room', () => {
      manager.createApprovalSession(
        'socket-a1',
        'room-a',
        'user-1',
        'alice',
        'band_member',
      );
      manager.createApprovalSession(
        'socket-a2',
        'room-a',
        'user-2',
        'bob',
        'audience',
      );
      manager.createApprovalSession(
        'socket-b1',
        'room-b',
        'user-3',
        'carol',
        'band_member',
      );

      const roomA = manager.getApprovalSessionsForRoom('room-a');
      expect(roomA).toHaveLength(2);
      expect(roomA.map((session) => session.userId).sort()).toEqual([
        'user-1',
        'user-2',
      ]);
      expect(manager.getApprovalSessionsForRoom('room-b')).toHaveLength(1);
      expect(manager.getApprovalSessionsForRoom('room-c')).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('reports totals, per-room counts, and the oldest session age', () => {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const noop = jest.fn();
      manager.createApprovalSession(
        'socket-1',
        'room-1',
        'user-1',
        'alice',
        'band_member',
        noop,
      );

      // Second session in another room, created 2 minutes after the first
      jest.advanceTimersByTime(120_000);
      manager.createApprovalSession(
        'socket-2',
        'room-2',
        'user-2',
        'bob',
        'audience',
        noop,
      );

      // Third session back in room-1, created 1 minute after the second
      jest.advanceTimersByTime(60_000);
      manager.createApprovalSession(
        'socket-3',
        'room-1',
        'user-3',
        'carol',
        'band_member',
        noop,
      );

      const stats = manager.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsByRoom).toEqual({ ['room-1']: 2, ['room-2']: 1 });
      // The first session is now exactly 3 minutes old
      expect(stats.oldestSessionAge).toBe(180_000);
    });

    it('returns an empty report with a null oldest age when no sessions exist', () => {
      expect(manager.getStats()).toEqual({
        totalSessions: 0,
        sessionsByRoom: {},
        oldestSessionAge: null,
      });
    });
  });
});
