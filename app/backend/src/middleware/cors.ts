import cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/environment';

import { loggingService } from '../shared/infrastructure/logging/LoggingService';

// Fail fast: reflecting an arbitrary origin while also sending credentials is unsafe
// (any site could drive credentialed cross-origin requests). Refuse to run this combination
// in production — require an explicit allow-list via CORS_ORIGIN instead of "*".
if (
  config.nodeEnv === 'production' &&
  config.cors.allowedOrigins.includes('*') &&
  config.cors.credentials
) {
  throw new Error(
    'Insecure CORS configuration: CORS_ORIGIN="*" with CORS_CREDENTIALS=true is not allowed in production. Set CORS_ORIGIN to an explicit comma-separated allow-list of trusted origins.'
  );
}

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = config.cors.allowedOrigins;
    const isWildcard = allowedOrigins.includes('*');

    // Log the origin for debugging
    loggingService.logSecurityEvent('CORS request', {
      origin,
      nodeEnv: config.nodeEnv,
      corsOriginEnv: process.env.CORS_ORIGIN,
      allowedOrigins
    });

    // Define current effective allowed origins based on environment
    let effectiveOrigins: string[] = [];

    if (config.nodeEnv === 'production') {
      effectiveOrigins = allowedOrigins;
    } else {
      // In development, include dev origins
      effectiveOrigins = [...allowedOrigins, ...config.cors.developmentOrigins];
    }

    const isAllowed =
      isWildcard ||
      !origin ||
      effectiveOrigins.includes('*') ||
      effectiveOrigins.includes(origin);

    if (isAllowed) {
      if (config.nodeEnv === 'production') {
        loggingService.logSecurityEvent('CORS origin allowed', { origin, mode: 'production' });
      } else {
        loggingService.logSecurityEvent('CORS origin allowed', { origin, mode: 'development' });
      }
      callback(null, true);
    } else {
      loggingService.logSecurityEvent('CORS origin blocked', {
        origin,
        allowedOrigins: effectiveOrigins,
        mode: config.nodeEnv
      }, 'warn');
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: config.cors.credentials,
  // Additional CORS options for better security
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-client-timezone'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400, // 24 hours
  // Handle preflight requests
  preflightContinue: false,
  optionsSuccessStatus: 200
};

export const corsMiddleware = cors(corsOptions);

// Simple CORS debugging middleware (no preflight handling)
export const corsDebugMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Only log full headers in development to avoid leaking PII in production
  if (config.nodeEnv === 'development') {
    loggingService.logSecurityEvent('CORS debug', {
      method: req.method,
      origin: req.get('Origin'),
      headers: req.headers
    });
  }

  // Let the main CORS middleware handle everything
  next();
}; 