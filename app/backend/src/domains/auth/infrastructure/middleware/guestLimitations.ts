import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './authMiddleware';

export const requireRegistered = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
};

