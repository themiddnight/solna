import type { Request, Response, NextFunction } from 'express';
import { tokenService } from '../../domain/services/TokenService';
import { UserRepository } from '../repositories/UserRepository';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  username: string | null;
  userType: string;
  emailVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser | undefined;
    }
  }
}

export type AuthRequest = Request;

/** The OTP hard gate's subject: a registered account that never completed verification. */
export const isUnverifiedRegistered = (user: { userType: string; emailVerified: boolean }): boolean =>
  user.userType === 'REGISTERED' && !user.emailVerified;

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const payload = tokenService.verifyToken(token);
    const userRepository = new UserRepository();
    const user = await userRepository.findById(payload.userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // OTP hard gate: an unverified registered account can never act. Verification is the only
    // path that mints a usable session, so anything unverified reaching here is a stale token.
    if (isUnverifiedRegistered(user)) {
      res.status(401).json({ error: 'Email verification required' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      userType: user.userType,
      emailVerified: user.emailVerified,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Verified-identity middleware that admits guests (DEV-215).
 *
 * Like {@link authenticateToken} it requires a valid token and populates `req.user` from the
 * verified JWT, but it additionally understands guest tokens — whose identity lives in the JWT
 * claims and has no DB row — mirroring the socket path's `resolveSocketUser`. Use this on endpoints
 * that guests are allowed to call but whose authorization must still be derived from the verified
 * token, never the request body (TR-33), e.g. room creation.
 */
export const authenticateTokenAllowGuest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const payload = tokenService.verifyToken(token);

    // Guest token — identity is carried in the JWT claims; no DB row exists (mirrors resolveSocketUser).
    if (payload.type === 'guest' || payload.userType === 'GUEST') {
      req.user = {
        id: payload.userId,
        email: null,
        username: payload.username ?? null,
        userType: 'GUEST',
        emailVerified: false,
      };
      next();
      return;
    }

    const userRepository = new UserRepository();
    const user = await userRepository.findById(payload.userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // OTP hard gate: an unverified registered account can never act (mirrors authenticateToken).
    // The guest branch above is unaffected — a guest has no DB row and never reaches here.
    if (isUnverifiedRegistered(user)) {
      res.status(401).json({ error: 'Email verification required' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      userType: user.userType,
      emailVerified: user.emailVerified,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const payload = tokenService.verifyToken(token);
      const userRepository = new UserRepository();
      const user = await userRepository.findById(payload.userId);

      // OTP hard gate: an unverified registered identity is not an actor. Optional-auth routes
      // degrade it to anonymous rather than rejecting, so paths like logout still work (DEV-193 —
      // a stale token must still be able to revoke its own refresh token).
      if (user && !isUnverifiedRegistered(user)) {
        req.user = {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
        };
      }
    }

    next();
  } catch {
    // Continue without authentication
    next();
  }
};

/**
 * Optional identity that also admits guests. Populates `req.user` from a valid registered token
 * (DB-backed) or a guest token (JWT claims, `userType: 'GUEST'`, no DB row), and never rejects when
 * the token is absent or invalid — it just continues without `req.user`. Use on endpoints readable
 * by anyone whose authorization must still derive from the verified token (TR-33), e.g. share-access.
 */
export const optionalAuthAllowGuest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const payload = tokenService.verifyToken(token);

      if (payload.type === 'guest' || payload.userType === 'GUEST') {
        req.user = {
          id: payload.userId,
          email: null,
          username: payload.username ?? null,
          userType: 'GUEST',
          emailVerified: false,
        };
        next();
        return;
      }

      const userRepository = new UserRepository();
      const user = await userRepository.findById(payload.userId);

      // OTP hard gate: an unverified registered identity is not an actor. Optional-auth routes
      // degrade it to anonymous rather than rejecting (the guest branch above is unaffected — a
      // guest has no DB row and never reaches here).
      if (user && !isUnverifiedRegistered(user)) {
        req.user = {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
        };
      }
    }

    next();
  } catch {
    // Continue without authentication
    next();
  }
};
