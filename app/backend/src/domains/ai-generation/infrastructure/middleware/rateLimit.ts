import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { AuthRequest } from '../../../../domains/auth/infrastructure/middleware/authMiddleware';

/**
 * AI Generation Rate Limiter
 * Limit: 1 request per 5 seconds per user
 */
export const aiGenerationRateLimiter = rateLimit({
  windowMs: 5 * 1000, // 5 seconds
  max: 1, // 1 request per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Limit per user ID if authenticated, otherwise fallback to IP
    return (req as AuthRequest).user?.id || req.ip || 'unknown';
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests. Please wait 5 seconds between AI generations.',
      retryAfter: 5
    });
  }
});
