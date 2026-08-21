/**
 * rateLimit.keyStability.test.ts — key stability, window reset and fail-open cases.
 *
 * Covers the brief's cases NOT already covered elsewhere:
 *  - Socket limit hit → `allowed: false` with `retryAfter` (sync `checkSocketRateLimit`).
 *  - Window reset: the same key is allowed again once `windowMs` elapses.
 *  - Voice recovery: a voice event within the 30s grace window bypasses the limit.
 *  - Auth limiter keys on `ip:email` (per-account budgets behind one IP).
 *
 * Already covered elsewhere (mapped, not duplicated here):
 *  - Redis `incr` returning null → allowed (deliberate fail-open graceful degradation,
 *    Pattern-1-adjacent): rateLimit.test.ts "allows gracefully when Redis limiter reports
 *    unavailable".
 *  - Key stability across reconnect — the socket limit key derives from verified userId+IP,
 *    never `socket.id` (DEV-191): rateLimit.dev191.test.ts "keys on verified userId + IP, so
 *    reconnecting (new socket.id) cannot reset the budget" (+ the pre-join user.id variant).
 *  - Unknown event type falls back to the default limit: rateLimit.dev191.test.ts "bounds an
 *    event that has no explicit config via the default limit (never unlimited)".
 */

import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Socket } from 'socket.io';
import request from 'supertest';
import { SHARED_EVENTS, VOICE_EVENTS } from '@jam-band/shared';
import { checkSocketRateLimit, loginLimiter, socketRateLimits } from '../rateLimit';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
    logRateLimitViolation: jest.fn(),
    logSecurityEvent: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

const socketWith = (userId: string, socketId: string, ip: string): Socket =>
  createPartialMock<Socket>({
    id: socketId,
    data: { userId },
    handshake: createPartialMock<Socket['handshake']>({ address: ip }),
  });

// Budgets are read from the real config so the tests stay valid if .env overrides
// (e.g. VOICE_OFFER_RATE_LIMIT) change them.
const CHAT_MAX = socketRateLimits[SHARED_EVENTS.CHAT_MESSAGE]!.maxEvents;

describe('checkSocketRateLimit — budget hit and window reset', () => {
  it('blocks a socket event past its budget with retryAfter (seconds to reset)', () => {
    // Freeze time so retryAfter is exactly the full window: resetTime is set at the first
    // call as `now + windowMs`, so it stays `now + 60000` while Date.now is pinned.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const socket = socketWith('budget-hit-user', 'sock-budget', '10.1.1.1');

    for (let i = 0; i < CHAT_MAX; i++) {
      expect(checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE).allowed).toBe(true);
    }

    const blocked = checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE);
    expect(blocked.allowed).toBe(false);
    // Full 1-minute window remains: ceil((resetTime - now) / 1000) = 60.
    expect(blocked.retryAfter).toBe(60);
    nowSpy.mockRestore();
  });

  it('resets the per-key budget once windowMs elapses (same key allowed again)', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const socket = socketWith('window-reset-user', 'sock-window', '10.1.1.2');

    for (let i = 0; i < CHAT_MAX; i++) {
      checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE);
    }
    expect(checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE).allowed).toBe(false);

    // Jump past the 1-minute window: the counter resets and the same key is allowed again.
    nowSpy.mockReturnValue(1_060_001);
    expect(checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE).allowed).toBe(true);

    // The budget was fully restored, not just a single pass: CHAT_MAX - 1 more allowed
    // (the call above already consumed one), then blocked again.
    for (let i = 0; i < CHAT_MAX - 1; i++) {
      expect(checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE).allowed).toBe(true);
    }
    expect(checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE).allowed).toBe(false);
    nowSpy.mockRestore();
  });
});

describe('checkSocketRateLimit — voice recovery grace window', () => {
  it('lets a voice event through within the 30s recovery grace window after near-limit voice traffic', () => {
    const socket = socketWith('voice-grace-user', 'sock-voice-grace', '10.1.1.3');

    const speakingMax = socketRateLimits[VOICE_EVENTS.VOICE_SPEAKING]!.maxEvents;
    // Grace arms at >= 80% of the voice_offer budget (count >= maxEvents * 0.8).
    const offerGraceThreshold = Math.ceil(socketRateLimits[VOICE_EVENTS.VOICE_OFFER]!.maxEvents * 0.8);

    // Exhaust VOICE_SPEAKING with no prior voice issues → genuinely blocked.
    for (let i = 0; i < speakingMax; i++) {
      expect(checkSocketRateLimit(socket, VOICE_EVENTS.VOICE_SPEAKING).allowed).toBe(true);
    }
    expect(checkSocketRateLimit(socket, VOICE_EVENTS.VOICE_SPEAKING).allowed).toBe(false);

    // Push the user to >= 80% of the voice_offer budget — that arms the 30s recovery grace
    // (voice events near their limit within 30s of the window = recent connection issues).
    for (let i = 0; i < offerGraceThreshold; i++) {
      checkSocketRateLimit(socket, VOICE_EVENTS.VOICE_OFFER);
    }

    // Within the grace window, voice events bypass the limit entirely.
    expect(checkSocketRateLimit(socket, VOICE_EVENTS.VOICE_SPEAKING).allowed).toBe(true);
    expect(checkSocketRateLimit(socket, VOICE_EVENTS.VOICE_OFFER).allowed).toBe(true);

    // The grace is scoped to voice events: non-voice budgets are still enforced.
    for (let i = 0; i < CHAT_MAX; i++) {
      checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE);
    }
    expect(checkSocketRateLimit(socket, SHARED_EVENTS.CHAT_MESSAGE).allowed).toBe(false);
  });

  it('does not grant grace to a different user who never had voice issues (same IP)', () => {
    const other = socketWith('voice-grace-other-user', 'sock-voice-grace-2', '10.1.1.3');
    const speakingMax = socketRateLimits[VOICE_EVENTS.VOICE_SPEAKING]!.maxEvents;

    for (let i = 0; i < speakingMax; i++) {
      checkSocketRateLimit(other, VOICE_EVENTS.VOICE_SPEAKING);
    }
    expect(checkSocketRateLimit(other, VOICE_EVENTS.VOICE_SPEAKING).allowed).toBe(false);
  });
});

describe('loginLimiter — auth key generation', () => {
  it('keys the auth limiter on ip:email so accounts behind one IP get separate budgets', async () => {
    const app = express();
    app.use(express.json());

    let observedIp: string | undefined;
    app.post(
      '/login',
      (req: Request, _res: Response, next: NextFunction) => {
        observedIp = req.ip;
        next();
      },
      loginLimiter,
      (_req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      }
    );

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/login').send({ email: 'alice@example.com' });
      expect(res.status).toBe(200);
    }
    const bobRes = await request(app).post('/login').send({ email: 'bob@example.com' });
    expect(bobRes.status).toBe(200);

    expect(observedIp).toBeDefined();
    const ip = observedIp!;
    // Each account accumulates under its own `ip:email` key...
    expect((await loginLimiter.getKey(`${ip}:alice@example.com`))?.totalHits).toBe(3);
    expect((await loginLimiter.getKey(`${ip}:bob@example.com`))?.totalHits).toBe(1);
    // ...and nothing accumulates on the bare IP key — email is part of the identity.
    expect(await loginLimiter.getKey(ip)).toBeUndefined();
  });
});
