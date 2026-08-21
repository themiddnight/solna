import { Router, type Router as RouterType } from 'express';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import multer from 'multer';
import { AuthController } from '../domains/auth/infrastructure/controllers/AuthController';
import { authenticateToken, optionalAuth } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { createLocalStrategy } from '../domains/auth/infrastructure/strategies/localStrategy';
import { createGoogleStrategy } from '../domains/auth/infrastructure/strategies/googleStrategy';
import { AuthService } from '../domains/auth/domain/services/AuthService';
import { UserRepository } from '../domains/auth/infrastructure/repositories/UserRepository';
import { oauthExchangeService, generateOpaqueToken, readCookie } from '../domains/auth/infrastructure/services/OAuthExchangeService';
import { setRefreshTokenCookie } from '../domains/auth/infrastructure/refreshTokenCookie';
import { config } from '../config/environment';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { loginLimiter, registerLimiter, passwordResetLimiter, refreshTokenLimiter, guestTokenLimiter, oauthExchangeLimiter, emailVerificationCodeLimiter } from '../middleware/rateLimit';

/** Transient cookie carrying the OAuth `state` nonce so the callback can bind to the initiating browser (DEV-187). */
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_COOKIE_PATH = '/api/auth';

const router: RouterType = Router();
const authController = new AuthController();

// Configure multer for memory storage (for profile picture uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Initialize Passport strategies
const userRepository = new UserRepository();
const authService = new AuthService(userRepository);

passport.use('local', createLocalStrategy(authService));
passport.use('google', createGoogleStrategy(authService));

// Serialize/Deserialize user for sessions (if needed)
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await userRepository.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Register
router.post('/register', registerLimiter, authController.register);

// Login - use AuthController which handles refresh tokens
router.post('/login', loginLimiter, authController.login);

// Guest token — server-minted JWT for an ephemeral, unprivileged identity (DEV-179)
router.post('/guest', guestTokenLimiter, authController.issueGuestToken);

// Verify email by code (in-app, no page navigation) — DEV-207
router.post('/verify-email-code', emailVerificationCodeLimiter, authController.verifyEmailByCode);

// Resend verification code for a not-yet-authenticated, just-registered user — DEV-207
router.post('/resend-verification-code', emailVerificationCodeLimiter, authController.resendVerificationCode);

// Forgot password
router.post('/forgot-password', passwordResetLimiter, authController.forgotPassword);

// Reset password
router.post('/reset-password', passwordResetLimiter, authController.resetPassword);

// Reset password by code (in-app) — DEV-207
router.post('/reset-password-code', passwordResetLimiter, authController.resetPasswordByCode);

// Google OAuth — set a transient `state` cookie bound to the initiating browser (DEV-187: login-CSRF defense).
router.get('/google', (req: Request, res: Response, next: NextFunction) => {
  const state = generateOpaqueToken();
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_MS,
  });
  (passport.authenticate('google', { scope: ['profile', 'email'], session: false, state, prompt: 'select_account' }) as RequestHandler)(
    req,
    res,
    next
  );
});

// Verify the `state` echoed by Google matches the cookie set on /google, then clear the cookie.
const verifyOAuthState: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const cookieState = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
  const queryState = typeof req.query.state === 'string' ? req.query.state : '';
  res.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_COOKIE_PATH });

  if (cookieState === undefined || cookieState === '' || cookieState !== queryState) {
    loggingService.logSecurityEvent('OAuth state mismatch', { ip: req.ip }, 'warn');
    res.redirect(`${config.cors.frontendUrl}/login?error=oauth_state`);
    return;
  }
  next();
};

router.get(
  '/google/callback',
  verifyOAuthState,
  passport.authenticate('google', { session: false, failureRedirect: `${config.cors.frontendUrl}/login?error=oauth_failed` }) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      // Tokens are attached to req.user by GoogleStrategy.
      const user = req.user as { accessToken?: string; refreshToken?: string } | undefined;
      const accessToken = user?.accessToken;
      const refreshToken = user?.refreshToken;

      if (accessToken === undefined || refreshToken === undefined) {
        res.redirect(`${config.cors.frontendUrl}/login?error=oauth_failed`);
        return;
      }

      // DEV-187: hand the tokens to the SPA via a single-use exchange code instead of the URL
      // query string (which leaks into history, Referer, and proxy logs).
      const code = await oauthExchangeService.issueCode({ accessToken, refreshToken });
      res.redirect(`${config.cors.frontendUrl}/auth/callback?code=${code}`);
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/auth.googleCallback' });
      res.redirect(`${config.cors.frontendUrl}/login?error=oauth_failed`);
    }
  }
);

// Exchange a one-time OAuth code for the issued tokens (DEV-187). Single-use; tokens never touch the URL.
router.post('/oauth/exchange', oauthExchangeLimiter, async (req: Request, res: Response) => {
  const { code } = req.body as { code?: unknown };
  if (typeof code !== 'string' || code === '') {
    res.status(400).json({ message: 'Invalid exchange code' });
    return;
  }

  const tokens = await oauthExchangeService.consumeCode(code);
  if (tokens === null) {
    res.status(400).json({ message: 'Invalid or expired exchange code' });
    return;
  }

  // DEV-197: deliver the refresh token via the HttpOnly cookie, not the JS-readable body.
  setRefreshTokenCookie(res, tokens.refreshToken);
  res.json({ accessToken: tokens.accessToken });
});

// Get current user
router.get('/me', authenticateToken, authController.getCurrentUser);

// Update username
router.put('/username', authenticateToken, authController.updateUsername);

// Change password (authenticated users)
router.put('/change-password', authenticateToken, authController.changePassword);

// Profile picture
router.put('/profile-picture', authenticateToken, upload.single('profilePicture'), authController.uploadProfilePicture);
router.delete('/profile-picture', authenticateToken, authController.deleteProfilePicture);

// Refresh token
router.post('/refresh-token', refreshTokenLimiter, authController.refreshToken);

// Logout — optionalAuth so an expired access token still allows revoking the refresh token (DEV-193)
router.post('/logout', optionalAuth, authController.logout);

// Preferences
router.get('/preferences', authenticateToken, authController.getPreferences);
router.patch('/preferences', authenticateToken, authController.updatePreferences);

export default router;
