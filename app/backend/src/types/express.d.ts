import type { AuthenticatedUser } from '../domains/auth/infrastructure/middleware/authMiddleware';

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}

    interface Request {
      requestId?: string;
    }
  }
}

export {};
