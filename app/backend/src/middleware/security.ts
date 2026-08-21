import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import type { z } from 'zod';
import { SOCKET_ERROR_CODES, createSocketErrorPayload, validateData, PERFORM_EVENTS } from '@jam-band/shared';
import { checkSocketRateLimitAsync } from './rateLimit';
import { validateWebRTCRequest } from '../shared/infrastructure/security/webrtcValidation';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { createSocketConnectionError } from '../shared/infrastructure/socket/socketErrors';

/**
 * DEV-191: per-event payload-size cap. Most perform-room events pass no Zod schema, so without this
 * a single oversized payload (e.g. a huge `notes` / sequencer array that still fits under the ~1 MB
 * Socket.IO transport limit) could drive unbounded work and amplify on broadcast. This bounds EVERY
 * event at the wrapper, independent of whether it has a schema. Media events legitimately carry
 * larger base64 chunks and are bounded again in their own handler.
 */
const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
const MAX_MEDIA_EVENT_PAYLOAD_BYTES = 1_536 * 1024;
const LARGE_PAYLOAD_EVENTS = new Set<string>([PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK]);

/** Approximate serialized byte size of a socket payload (UTF-16 length ≈ bytes for typical JSON). */
const approxPayloadBytes = (data: unknown): number => {
  if (data === undefined || data === null) return 0;
  try {
    // JSON.stringify returns undefined for exotic top-level values (functions/symbols), which then
    // throws on .length and is caught below — socket payloads are plain JSON, so this is just a guard.
    return JSON.stringify(data).length;
  } catch {
    // Non-serializable payloads are left for schema/handler validation to reject.
    return 0;
  }
};

// HTTP request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  // Log request start
  loggingService.logHttpRequest(req, res, 0, 0);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    loggingService.logHttpRequest(req, res, duration, res.statusCode);
  });

  next();
};

// Socket connection security middleware
export const socketSecurityMiddleware = (socket: Socket, next: (err?: Error) => void): void => {
  const clientInfo = {
    socketId: socket.id,
    ip: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent'],
    timestamp: new Date().toISOString()
  };

  // Log connection attempt
  loggingService.logSocketEvent('connection_attempt', socket, clientInfo);

  // Basic connection validation
  if (socket.handshake.address === '') {
    // reject connections with no IP address
    loggingService.logSecurityEvent('Socket connection without IP address', clientInfo, 'warn');
    return next(createSocketConnectionError('Invalid connection', { code: SOCKET_ERROR_CODES.INVALID_REQUEST }));
  }

  // Check for suspicious user agents
  const userAgent = socket.handshake.headers['user-agent'] || '';
  const suspiciousUserAgents = [
    'curl', 'wget', 'python', 'bot', 'crawler', 'spider'
  ];

  const isSuspicious = suspiciousUserAgents.some(agent => 
    userAgent.toLowerCase().includes(agent)
  );

  if (isSuspicious) {
    loggingService.logSecurityEvent('Suspicious user agent detected', {
      ...clientInfo,
      userAgent,
      reason: 'Suspicious user agent'
    }, 'warn');
    // Don't block, just log for monitoring
  }

  // Allow connection
  next();
};

// Socket event security wrapper
export function secureSocketEvent<S extends z.ZodTypeAny, TResult = void>(
  eventName: string,
  schema: S,
  handler: (socket: Socket, data: z.infer<S>) => TResult,
): (socket: Socket, data: unknown) => Promise<void>;
export function secureSocketEvent<TData = unknown, TResult = void>(
  eventName: string,
  schema: null,
  handler: (socket: Socket, data: TData) => TResult,
): (socket: Socket, data: unknown) => Promise<void>;
export function secureSocketEvent(
  eventName: string,
  schema: z.ZodTypeAny | null,
  handler: (socket: Socket, data: unknown) => unknown,
): (socket: Socket, data: unknown) => Promise<void> {
  return async (socket: Socket, data: unknown): Promise<void> => {
    const startTime = Date.now();
    loggingService.logSocketEvent(eventName, socket, data);

    try {
      // ── rate limiting (unchanged) ──
      const rateLimitResult = await checkSocketRateLimitAsync(socket, eventName);
      if (!rateLimitResult.allowed) {
        loggingService.logSecurityEvent('Rate limit exceeded', {
          socketId: socket.id,
          userId: String((socket.data as Record<string, unknown>).userId ?? ''),
          eventName,
          retryAfter: rateLimitResult.retryAfter,
        }, 'warn');
        socket.emit('error', createSocketErrorPayload('Rate limit exceeded', {
          code: SOCKET_ERROR_CODES.RATE_LIMITED,
          retryAfter: rateLimitResult.retryAfter,
          context: eventName,
        }));
        return;
      }

      // ── payload-size bound (unchanged) ──
      const sizeLimit = LARGE_PAYLOAD_EVENTS.has(eventName) ? MAX_MEDIA_EVENT_PAYLOAD_BYTES : MAX_EVENT_PAYLOAD_BYTES;
      if (approxPayloadBytes(data) > sizeLimit) {
        loggingService.logSecurityEvent('Oversized socket payload rejected', {
          socketId: socket.id,
          eventName,
          limit: sizeLimit,
        }, 'warn');
        socket.emit('error', createSocketErrorPayload('Payload too large', {
          code: SOCKET_ERROR_CODES.INVALID_DATA_FORMAT,
          context: eventName,
        }));
        return;
      }

      // ── input validation ──
      if (schema !== null) {
        const validationResult = validateData(schema, data);
        if (validationResult.error) {
          loggingService.logValidationFailure(eventName, data, [validationResult.error]);
          socket.emit('error', createSocketErrorPayload('Invalid data format', {
            code: SOCKET_ERROR_CODES.INVALID_DATA_FORMAT,
            details: validationResult.error,
            context: eventName,
          }));
          return;
        }
        // Use validated data
        data = validationResult.value !== undefined ? validationResult.value : data;
      }

      // ── WebRTC-specific validation (unchanged) ──
      if (eventName.startsWith('voice_')) {
        const webrtcEventType = eventName === 'voice_offer' ? 'offer' :
                                eventName === 'voice_answer' ? 'answer' :
                                eventName === 'voice_ice_candidate' ? 'ice-candidate' : null;
        if (webrtcEventType != null) {
          const webrtcValidation = validateWebRTCRequest(socket, webrtcEventType, data);
          if (!webrtcValidation.isValid) {
            const logLevel = webrtcValidation.error === 'User not authenticated' ? 'info' : 'warn';
            loggingService.logSecurityEvent('WebRTC validation failed', {
              socketId: socket.id,
              userId: String((socket.data as Record<string, unknown>).userId ?? ''),
              eventName,
              error: webrtcValidation.error,
            }, logLevel);
            socket.emit('error', createSocketErrorPayload('WebRTC validation failed', {
              code: SOCKET_ERROR_CODES.VALIDATION_ERROR,
              details: webrtcValidation.error,
              context: eventName,
            }));
            return;
          }
        }
      }

      await handler(socket, data);
      const duration = Date.now() - startTime;
      loggingService.logSocketEvent(eventName, socket, data, duration);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        socketId: socket.id,
        userId: String((socket.data as Record<string, unknown>).userId ?? ''),
        eventName,
      });
      socket.emit('error', createSocketErrorPayload('Internal server error', {
        code: SOCKET_ERROR_CODES.UNKNOWN,
        details: { eventName },
        context: eventName,
      }));
    }
  };
}

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Additional security headers beyond Helmet defaults.
  // Note: X-Content-Type-Options, X-Frame-Options, and X-XSS-Protection are
  // already set by helmet() — do not duplicate them here.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
};

// Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  // Basic input sanitization for HTTP requests
  if (req.body != null) {
    // Remove any potential script tags from string fields
    const sanitizeString = (str: string): string => {
      return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    };

    // Fields that must never be mutated. Trimming/stripping a credential or token corrupts
    // it (a stored password hash would differ from what the user typed, and two distinct
    // passwords could collapse to the same value). XSS defense for these belongs at output
    // encoding, not input sanitization.
    const SENSITIVE_FIELDS = new Set([
      'password', 'newPassword', 'currentPassword', 'oldPassword', 'confirmPassword',
      'token', 'refreshToken', 'accessToken', 'resetToken', 'secret', 'apiKey',
    ]);

    const sanitizeObject = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        return sanitizeString(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      }
      if (obj != null && typeof obj === 'object') {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          sanitized[key] = SENSITIVE_FIELDS.has(key) ? value : sanitizeObject(value);
        }
        return sanitized;
      }
      return obj;
    };

     
    req.body = sanitizeObject(req.body);
  }

  next();
}; 
