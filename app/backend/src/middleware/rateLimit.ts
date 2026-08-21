import rateLimit from 'express-rate-limit';
import type { Socket } from 'socket.io';
import type { Request, Response } from 'express';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { SHARED_EVENTS, VOICE_EVENTS, PERFORM_EVENTS, ARRANGE_EVENTS, OCCUPANCY_EVENTS } from '@jam-band/shared';
import { config } from '../config/environment';
import { REDIS_KEYS } from '../shared/constants/RedisKeys';

// HTTP API rate limiting
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window (shorter for faster recovery)
  max: config.nodeEnv === 'development'
    ? parseInt(process.env.API_RATE_LIMIT_DEV_MAX || '5000', 10)
    : parseInt(process.env.API_RATE_LIMIT_MAX || '200', 10),
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req: Request) => {
    if (process.env.DISABLE_HTTP_RATE_LIMIT === 'true') {
      return true;
    }
    // Skip rate limiting for HLS endpoints (they have their own limiter)
    return req.path.includes('/broadcast/');
  },
  handler: (req: Request, res: Response) => {
    // Log rate limit violation
    loggingService.logSecurityEvent('HTTP Rate Limit Exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
    }, 'warn');

    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '1 minute'
    });
  }
});

// Invite code lookup rate limiting - restrictive since it's a public unauthenticated endpoint
export const inviteCodeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP
  message: {
    error: 'Too many invite code lookup requests, please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    loggingService.logSecurityEvent('Invite Code Rate Limit Exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
    }, 'warn');

    res.status(429).json({
      error: 'Too many invite code lookup requests, please try again later.',
      retryAfter: '1 minute'
    });
  }
});

// Authentication endpoint rate limiting. Strict in production to blunt credential stuffing,
// password spraying, reset-token guessing, and email bombing. Lenient in any non-production
// environment (development AND test) so local dev and the E2E/integration suites — which log
// in repeatedly — are never throttled.
const createAuthLimiter = (options: { name: string; windowMs: number; maxProd: number; devMax?: number }) => {
  const retryAfter = `${Math.round(options.windowMs / 60000)} minute(s)`;
  return rateLimit({
    windowMs: options.windowMs,
    max: config.nodeEnv === 'production' ? options.maxProd : (options.devMax ?? 1000),
    message: { error: 'Too many requests, please try again later.', retryAfter },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.DISABLE_HTTP_RATE_LIMIT === 'true',
    keyGenerator: (req: Request) => {
      // Key on IP + email (when present) so spraying a single account is throttled while
      // distinct accounts behind the same IP are not collateral-limited.
      const ip = req.ip ?? 'unknown';
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      return email !== '' ? `${ip}:${email}` : ip;
    },
    handler: (req: Request, res: Response) => {
      loggingService.logSecurityEvent(`Auth Rate Limit Exceeded: ${options.name}`, {
        ip: req.ip,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
      }, 'warn');
      res.status(429).json({ error: 'Too many requests, please try again later.', retryAfter });
    },
  });
};

// Login: blunt credential stuffing / password spraying.
export const loginLimiter = createAuthLimiter({ name: 'login', windowMs: 15 * 60 * 1000, maxProd: 10 });
// Register: limit account-creation abuse + verification-email bombing.
export const registerLimiter = createAuthLimiter({ name: 'register', windowMs: 60 * 60 * 1000, maxProd: 5 });
// Password reset / verification email: limit email bombing + reset-token guessing.
export const passwordResetLimiter = createAuthLimiter({ name: 'password-reset', windowMs: 60 * 60 * 1000, maxProd: 5 });
// Email verification / password reset by code: keyed by IP only (the request body carries a
// signed session token or an email, not a stable per-account identity to key on the way
// login/register already do).
export const emailVerificationCodeLimiter = createAuthLimiter({ name: 'email-verification-code', windowMs: 15 * 60 * 1000, maxProd: 10 });
// Token refresh: generous (legitimate sessions refresh periodically) but bounded.
export const refreshTokenLimiter = createAuthLimiter({ name: 'refresh-token', windowMs: 15 * 60 * 1000, maxProd: 60 });
// Guest token issuance: minted once per guest session; bound per IP to limit abuse.
export const guestTokenLimiter = createAuthLimiter({ name: 'guest', windowMs: 15 * 60 * 1000, maxProd: 30 });
// OAuth code exchange: one call per login; bounded to blunt code-guessing despite 256-bit codes.
export const oauthExchangeLimiter = createAuthLimiter({ name: 'oauth-exchange', windowMs: 15 * 60 * 1000, maxProd: 30 });

// HLS streaming rate limiting - more permissive for live streaming
// HLS.js fetches playlist every 2-4 seconds and segments frequently
export const hlsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute (5 per second) - enough for HLS polling
  message: {
    error: 'Too many HLS requests, please try again.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Rate limit per IP + room combination
    const roomId = req.params.roomId || 'unknown';
    return `${req.ip}-${roomId}`;
  },
  skip: (_req: Request) => {
    // Skip rate limiting in development if needed
    return false;
  }
});

// Socket rate limiting configuration
export interface RateLimitConfig {
  maxEvents: number;
  windowMs: number;
  eventType: 'note' | 'chat' | 'voice' | 'general';
}

// Music-friendly rate limits
export const socketRateLimits: Record<string, RateLimitConfig> = {
  // Note events - allow high frequency for music performance
  [PERFORM_EVENTS.PLAY_NOTE]: {
    maxEvents: 3600, // 3600 notes per minute per user (60 per second — throttle 30/s + 2x safety factor)
    windowMs: 60 * 1000, // 1 minute
    eventType: 'note'
  },

  // Chat messages - moderate limit
  [SHARED_EVENTS.CHAT_MESSAGE]: {
    maxEvents: 30, // 30 messages per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'chat'
  },

  // Voice events - increased limits for better reliability and reconnection
  [VOICE_EVENTS.VOICE_OFFER]: {
    maxEvents: parseInt(process.env.VOICE_OFFER_RATE_LIMIT || '60'), // Configurable via environment
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },
  [VOICE_EVENTS.VOICE_ANSWER]: {
    maxEvents: parseInt(process.env.VOICE_ANSWER_RATE_LIMIT || '60'), // Configurable via environment
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },
  [VOICE_EVENTS.VOICE_ICE_CANDIDATE]: {
    maxEvents: parseInt(process.env.VOICE_ICE_RATE_LIMIT || '200'), // Configurable via environment
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },
  // Ephemeral speaking (talking) signal — start/stop transitions + a 1s heartbeat.
  // Steady speech is ~1/s; the cap bounds the per-emit N-peer fanout amplification
  // well below the 6000/min default it would otherwise inherit.
  [VOICE_EVENTS.VOICE_SPEAKING]: {
    maxEvents: parseInt(process.env.VOICE_SPEAKING_RATE_LIMIT || '600'), // 10/s — headroom over heartbeat + flap
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },

  // General events - lower limits
  [SHARED_EVENTS.JOIN_ROOM]: {
    maxEvents: 20, // 20 room joins per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },
  [PERFORM_EVENTS.CHANGE_INSTRUMENT]: {
    maxEvents: 120, // 120 instrument changes per minute per user (increased for quick switching)
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },

  // Synth parameters - HIGH frequency for real-time knob control
  [PERFORM_EVENTS.UPDATE_SYNTH_PARAMS]: {
    maxEvents: 3600, // 3600 updates per minute per user (60 per second)
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },

  // Effects chain updates - same frequency as synth params
  [PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN]: {
    maxEvents: 3600, // 3600 updates per minute per user (60 per second — throttle 30/s + 2x safety factor)
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },

  // Ephemeral events — 60/sec (throttle 30/s + 2x safety factor)
  [ARRANGE_EVENTS.REGION_DRAG]: {
    maxEvents: 3600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.NOTE_REALTIME_UPDATE]: {
    maxEvents: 3600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.EFFECT_CHAIN_UPDATE]: {
    maxEvents: 3600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  // Same budget as the other knob-drag events: a fader at 60fps for a full minute.
  [ARRANGE_EVENTS.MASTER_VOLUME_UPDATE]: {
    maxEvents: 3600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.MASTER_VOLUME_COMMIT]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.SYNTH_PARAMS_UPDATE]: {
    maxEvents: 3600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },

  // Commit events — moderate frequency (10/sec)
  [ARRANGE_EVENTS.REGION_DRAG_END]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.SYNTH_PARAMS_COMMIT]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.EFFECT_CHAIN_COMMIT]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [ARRANGE_EVENTS.TRACK_PROPERTY_COMMIT]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [PERFORM_EVENTS.SYNTH_PARAMS_COMMIT]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },
  [PERFORM_EVENTS.EFFECTS_CHAIN_COMMIT]: {
    maxEvents: 600,
    windowMs: 60 * 1000,
    eventType: 'general'
  },

  // Perform room - General metadata and workflow events (120/min)
  [PERFORM_EVENTS.ROOM_SCALE_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.TOGGLE_FOLLOW_SCALE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.SEND_SEQUENCER_STATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.REQUEST_STATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.USER_STATE_UPDATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.BPM_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.ROOM_TIME_SIGNATURE_UPDATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.SEQUENCER_UPDATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.RECORDING_STATE_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.SHADOW_CAPTURE_STATE_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.MEMBER_BROADCAST_STATE_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.VOICE_STATE_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.INSTRUMENT_PRACTICE_STATE_CHANGE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.TOGGLE_BROADCAST]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.REQUEST_BROADCAST_STATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.STOP_ALL_NOTES]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.REQUEST_INSTRUMENT_SWAP]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.APPROVE_INSTRUMENT_SWAP]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.REJECT_INSTRUMENT_SWAP]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.CANCEL_INSTRUMENT_SWAP]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.REQUEST_SEQUENCER_STATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.REQUEST_SYNTH_PARAMS]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },

  // Companion management (120/min)
  [PERFORM_EVENTS.COMPANION_ADD]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_REMOVE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_UPDATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_BULK_PRESET_UPDATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_PLAY_ALL]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_STOP_ALL]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_SET_CHORD_LENGTH]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_SET_CHORD_PROGRESSION]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_SET_PROGRESSION_FLAVOR]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_VOLUME_LOCK]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_VOLUME_UNLOCK]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_SETTINGS_LOCK]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_SETTINGS_UNLOCK]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_PROGRESSION_LOCK]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.COMPANION_PROGRESSION_UNLOCK]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },

  // Perform room - Ephemeral events (3600/min)
  [PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL]: { maxEvents: 3600, windowMs: 60 * 1000, eventType: 'general' },
  [PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK]: { maxEvents: 3600, windowMs: 60 * 1000, eventType: 'general' },

  // Arrange room - monitor-share + save-lock events (DEV-191: previously had no rate limit at all)
  [ARRANGE_EVENTS.MONITOR_SHARE_STATE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [ARRANGE_EVENTS.MONITOR_SHARE_NOTE]: { maxEvents: 3600, windowMs: 60 * 1000, eventType: 'note' },
  [ARRANGE_EVENTS.SAVE_LOCK_REQUEST]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [ARRANGE_EVENTS.SAVE_LOCK_RELEASE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },

  // Element occupancy / presence badges (DEV-350) — both namespaces, 120/min, the same
  // budget as the ARRANGE lock and PERFORM companion-lock events these superseded. Without
  // an explicit entry they would fall through to DEFAULT_SOCKET_RATE_LIMIT (6000/min), a 50x
  // loosening on a path that is far more expensive than the one it replaced: every occupancy
  // event takes the room-wide `room-state-mutex:{roomId}` and rewrites full room state
  // (RoomOccupancyService), whereas Perform's old companion locks were pure FE with no BE
  // state at all. Only the three client -> server events are budgeted; JOINED/LEFT/
  // JOIN_DENIED are server -> client broadcasts.
  [OCCUPANCY_EVENTS.JOIN]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [OCCUPANCY_EVENTS.LEAVE]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' },
  [OCCUPANCY_EVENTS.HEARTBEAT]: { maxEvents: 120, windowMs: 60 * 1000, eventType: 'general' }
};

/**
 * DEV-191: fallback limit for any socket event without an explicit entry above, so a missing
 * config can never mean "unlimited". Generous (100/s) — above every configured high-frequency
 * event — so it only ever bounds genuinely-unexpected floods.
 */
export const DEFAULT_SOCKET_RATE_LIMIT: RateLimitConfig = {
  maxEvents: 6000,
  windowMs: 60 * 1000,
  eventType: 'general',
};

// ============================================
// Distributed Rate Limiting (Redis-backed)
// ============================================

import { RedisStateService } from '../shared/infrastructure/caching/RedisStateService';

/**
 * Redis-backed rate limit store for cluster-aware rate limiting.
 * Uses sliding window counter algorithm with atomic Redis INCR + EXPIRE.
 */
class RedisRateLimiter {
  private readonly redisState = RedisStateService.getInstance();

  /**
   * Check if rate limit allows this request
   * @returns { allowed, retryAfter }
   */
  async checkLimit(
    userId: string,
    eventName: string,
    maxEvents: number,
    windowMs: number
  ): Promise<{ allowed: boolean; retryAfter?: number; count?: number }> {
    const windowSeconds = Math.ceil(windowMs / 1000);
    const key = REDIS_KEYS.rateLimit(eventName, userId);

    try {
      // Atomic increment + set TTL if key is new
      const count = await this.redisState.incr(key);

      if (count === null) {
        // Redis error, fall through to allow
        return { allowed: true };
      }

      // Set expiry only on first increment
      if (count === 1) {
        await this.redisState.expire(key, windowSeconds);
      }

      if (count > maxEvents) {
        // Calculate retry after from TTL
        const ttl = await this.redisState.ttl(key);
        return {
          allowed: false,
          retryAfter: ttl > 0 ? ttl : windowSeconds,
          count
        };
      }

      return { allowed: true, count };
    } catch {
      // On Redis error, allow the request (graceful degradation)
      return { allowed: true };
    }
  }

}

// Singleton redis rate limiter
const redisRateLimiter = new RedisRateLimiter();

// Socket rate limiting storage (in-memory fallback)
const socketRateLimitStore = new Map<string, Map<string, { count: number; resetTime: number }>>();

/**
 * DEV-191: rate-limit identity for socket events. Keyed on the verified userId plus the connection
 * IP — never `socket.id`, which changes on every reconnect and let an attacker reset their budget.
 * The verified id comes from the room session (`socket.data.userId`, set from the socket-auth token
 * at join) post-join, or — pre-join, before `socket.data` is reassigned to the session — from the
 * authenticated socket user (`socket.data.user.id`, also token-verified). Falls back to IP only when
 * neither is present; either way reconnecting cannot mint a fresh budget (IP is stable).
 */
const socketRateLimitKey = (socket: Socket): string => {
  const ip = socket.handshake.address !== '' ? socket.handshake.address : 'unknown';
  const data = socket.data as Record<string, unknown>;
  const sessionUserId = typeof data.userId === 'string' && data.userId !== '' ? data.userId : undefined;
  const authUser = data.user as { id?: unknown } | null | undefined;
  const preJoinUserId =
    authUser != null && typeof authUser.id === 'string' && authUser.id !== '' ? authUser.id : undefined;
  const verifiedId = sessionUserId ?? preJoinUserId;
  return verifiedId !== undefined ? `${verifiedId}:${ip}` : `ip:${ip}`;
};

// Check if socket event is within rate limit
export const checkSocketRateLimit = (socket: Socket, eventName: string): { allowed: boolean; retryAfter?: number } => {
  // Special bypass for synth parameters - never rate limit these for real-time knob control
  if (eventName === PERFORM_EVENTS.UPDATE_SYNTH_PARAMS && config.performance.disableSynthRateLimit) {
    return { allowed: true };
  }

  // Special bypass for voice events - can be disabled for development/testing
  if (eventName.startsWith('voice_') && config.performance.disableVoiceRateLimit) {
    return { allowed: true };
  }

  // Special handling for voice events during recovery scenarios
  if (eventName.startsWith('voice_')) {
    const userId = socketRateLimitKey(socket);
    const now = Date.now();

    // Check if this is a recovery attempt (user recently had connection issues)
    const userLimits = socketRateLimitStore.get(userId);
    if (userLimits) {
      const voiceEvents = ['voice_offer', 'voice_answer', 'voice_ice_candidate'];
      const hasRecentVoiceIssues = voiceEvents.some(event => {
        const limit = userLimits.get(event);
        const rateLimitConfig = socketRateLimits[event];
        if (limit && rateLimitConfig && now - limit.resetTime < 30000) { // Within 30 seconds
          return limit.count >= rateLimitConfig.maxEvents * 0.8; // If they were close to limit
        }
        return false;
      });

      // If user had recent voice issues, allow a few more attempts
      if (hasRecentVoiceIssues) {
        return { allowed: true };
      }
    }
  }

  // DEV-191: no specific config → fall back to a bounded default (never unlimited).
  const rateLimitConfig = socketRateLimits[eventName] ?? DEFAULT_SOCKET_RATE_LIMIT;

  const userId = socketRateLimitKey(socket);
  const now = Date.now();

  // Initialize user's rate limit tracking
  if (!socketRateLimitStore.has(userId)) {
    socketRateLimitStore.set(userId, new Map());
  }

  const userLimits = socketRateLimitStore.get(userId)!;

  // Get or create event limit tracking
  if (!userLimits.has(eventName)) {
    userLimits.set(eventName, { count: 0, resetTime: now + rateLimitConfig.windowMs });
  }

  const eventLimit = userLimits.get(eventName)!;

  // Check if window has reset
  if (now > eventLimit.resetTime) {
    eventLimit.count = 0;
    eventLimit.resetTime = now + rateLimitConfig.windowMs;
  }

  // Check if limit exceeded
  if (eventLimit.count >= rateLimitConfig.maxEvents) {
    const retryAfter = Math.ceil((eventLimit.resetTime - now) / 1000);

    // Log rate limit violation with enhanced details for voice events
    if (eventName.startsWith('voice_')) {
      loggingService.logWarn(`Voice rate limit exceeded for user ${userId}`, {
        eventName,
        currentCount: eventLimit.count,
        limit: rateLimitConfig.maxEvents,
        windowMs: rateLimitConfig.windowMs,
        retryAfter,
        timestamp: new Date().toISOString()
      });
    }

    loggingService.logRateLimitViolation(userId, eventName, rateLimitConfig.maxEvents, rateLimitConfig.windowMs);

    return { allowed: false, retryAfter };
  }

  // Increment counter
  eventLimit.count++;
  return { allowed: true };
};

/**
 * Async version of checkSocketRateLimit that uses Redis for distributed rate limiting.
 * Use this when running in cluster mode for cross-worker rate limiting.
 * Falls back to in-memory rate limiting if Redis is unavailable.
 */
export const checkSocketRateLimitAsync = async (
  socket: Socket,
  eventName: string
): Promise<{ allowed: boolean; retryAfter?: number }> => {
  // Apply bypass rules first (same as sync version)
  if (eventName === PERFORM_EVENTS.UPDATE_SYNTH_PARAMS && config.performance.disableSynthRateLimit) {
    return { allowed: true };
  }
  if (eventName.startsWith('voice_') && config.performance.disableVoiceRateLimit) {
    return { allowed: true };
  }

  // DEV-191: no specific config → fall back to a bounded default (never unlimited).
  const rateLimitConfig = socketRateLimits[eventName] ?? DEFAULT_SOCKET_RATE_LIMIT;

  const userId = socketRateLimitKey(socket);

  // Try Redis-backed rate limiting
  try {
    const result = await redisRateLimiter.checkLimit(
      userId,
      eventName,
      rateLimitConfig.maxEvents,
      rateLimitConfig.windowMs
    );

    if (!result.allowed) {
      loggingService.logRateLimitViolation(
        userId,
        eventName,
        rateLimitConfig.maxEvents,
        rateLimitConfig.windowMs
      );
    }

    return result;
  } catch {
    // Redis unavailable, fall back to in-memory
    return checkSocketRateLimit(socket, eventName);
  }
};

/**
 * Check if distributed rate limiting is enabled (Redis isAvailable)
 */
export const isDistributedRateLimitingEnabled = async (): Promise<boolean> => {
  // Always return true since Redis is required
  return true;
};

// Clean up expired rate limit entries
export const cleanupExpiredRateLimits = (): void => {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [userId, userLimits] of socketRateLimitStore.entries()) {
    for (const [eventName, limit] of userLimits.entries()) {
      if (now > limit.resetTime) {
        userLimits.delete(eventName);
        cleanedCount++;
      }
    }

    // Remove user if no events left
    if (userLimits.size === 0) {
      socketRateLimitStore.delete(userId);
    }
  }

  if (cleanedCount > 0) {
    loggingService.logPerformanceMetric('rate_limit_cleanup', cleanedCount, {
      activeUsers: socketRateLimitStore.size,
      timestamp: new Date().toISOString()
    });
  }
};
