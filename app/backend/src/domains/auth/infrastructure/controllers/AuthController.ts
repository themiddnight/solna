import type { Request, Response } from 'express';
import { AuthService, OtpCooldownError } from '../../domain/services/AuthService';
import { UserRepository } from '../repositories/UserRepository';
import type { AuthRequest } from '../middleware/authMiddleware';
import { profilePictureService } from '../../../user-management/infrastructure/services/ProfilePictureService';
import { userPreferencesService } from '../../../user-management/domain/services/UserPreferencesService';
import { UserPreferencesValidationError } from '../../../user-management/domain/errors/UserPreferencesValidationError';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { tokenService } from '../../domain/services/TokenService';
import { setRefreshTokenCookie, clearRefreshTokenCookie, readRefreshTokenCookie } from '../refreshTokenCookie';
import { randomUUID } from 'crypto';
import { generateRandomName } from '@jam-band/shared';
import type { OtpChallenge, UserPreferencesPatch } from '@jam-band/shared';

interface RegisterBody {
  email?: string;
  password?: string;
  username?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

interface RefreshTokenBody {
  refreshToken?: string;
}

interface ResetPasswordBody {
  token?: string;
  newPassword?: string;
}

interface UpdateUsernameBody {
  username?: string;
}

interface ChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

interface UpdatePreferencesBody {
  theme?: string;
  settings?: UserPreferencesPatch;
}

export class AuthController {
  private readonly authService: AuthService;
  private readonly userRepository: UserRepository;

  constructor() {
    this.userRepository = new UserRepository();
    this.authService = new AuthService(this.userRepository);
  }

  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, username } = req.body as RegisterBody;

      if (email == null || password == null || username == null || email === '' || password === '' || username === '') {
        res.status(400).json({ error: 'Email, password, and username are required' });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }

      // Validate password strength
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      const { user, verificationSessionToken, otpExpiresAt, resendAvailableAt } = await this.authService.register({
        email,
        password,
        username,
      });

      const otpChallenge: OtpChallenge = {
        verificationSessionToken,
        otpExpiresAt: otpExpiresAt.toISOString(),
        resendAvailableAt: resendAvailableAt.toISOString(),
      };

      res.status(201).json({
        message: 'Registration successful. Enter the code we emailed you to verify your account.',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
          profilePictureUrl: user.profilePictureUrl,
          onboardingTourPromptedAt: user.onboardingTourPromptedAt?.toISOString() ?? null,
          hasPassword: user.passwordHash !== null,
        },
        ...otpChallenge,
      });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Registration failed' });
    }
  };

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body as LoginBody;

      if (email == null || password == null) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const result = await this.authService.login({ email, password });

      const userJson = {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        userType: result.user.userType,
        emailVerified: result.user.emailVerified,
        profilePictureUrl: result.user.profilePictureUrl,
        onboardingTourPromptedAt: result.user.onboardingTourPromptedAt?.toISOString() ?? null,
        hasPassword: result.user.passwordHash !== null,
      };

      // OTP-only: unverified users get a fresh code + verificationSessionToken instead of tokens.
      if ('verificationRequired' in result) {
        const otpChallenge: OtpChallenge = {
          verificationSessionToken: result.verificationSessionToken,
          otpExpiresAt: result.otpExpiresAt.toISOString(),
          resendAvailableAt: result.resendAvailableAt.toISOString(),
        };

        res.json({
          user: userJson,
          verificationRequired: true,
          ...otpChallenge,
        });
        return;
      }

      // DEV-197: refresh token goes in an HttpOnly cookie (never the JS-readable body).
      setRefreshTokenCookie(res, result.refreshToken);

      res.json({
        user: userJson,
        accessToken: result.accessToken,
      });
    } catch (error: unknown) {
      res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed' });
    }
  };

  refreshToken = async (req: Request, res: Response): Promise<void> => {
    try {
      // DEV-197: read the refresh token from the HttpOnly cookie. Fall back to the body for the
      // brief rollout window where an older client still sends it; new clients send neither.
      const bodyToken = (req.body as RefreshTokenBody).refreshToken;
      const refreshToken = readRefreshTokenCookie(req) ?? (typeof bodyToken === 'string' ? bodyToken : '');

      if (refreshToken === '') {
        res.status(400).json({ error: 'Refresh token is required' });
        return;
      }

      const { accessToken, refreshToken: newRefreshToken } = await this.authService.refreshAccessToken(refreshToken);

      // Rotate the cookie; the new refresh token never reaches the JS-readable body.
      setRefreshTokenCookie(res, newRefreshToken);

      res.json({ accessToken });
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'AuthController.refreshToken' });
      // The refresh credential is dead — remove it so the browser stops replaying it.
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: error instanceof Error ? error.message : 'Token refresh failed' });
    }
  };

  verifyEmailByCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { verificationSessionToken, code } = req.body as { verificationSessionToken?: string; code?: string };

      if (verificationSessionToken == null || code == null || verificationSessionToken === '' || code === '') {
        res.status(400).json({ error: 'Verification session token and code are required' });
        return;
      }

      const { user, accessToken, refreshToken } = await this.authService.verifyEmailByCode(verificationSessionToken, code);

      // Auto-login: set the refresh token cookie and return the access token so the
      // frontend can commit the authenticated session without redirecting to /login.
      setRefreshTokenCookie(res, refreshToken);

      res.json({
        message: 'Email verified successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
          profilePictureUrl: user.profilePictureUrl,
          onboardingTourPromptedAt: user.onboardingTourPromptedAt?.toISOString() ?? null,
          hasPassword: user.passwordHash !== null,
        },
        accessToken,
      });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Email verification failed' });
    }
  };

  resendVerificationCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { verificationSessionToken } = req.body as { verificationSessionToken?: string };

      if (verificationSessionToken == null || verificationSessionToken === '') {
        res.status(400).json({ error: 'Verification session token is required' });
        return;
      }

      const result = await this.authService.resendVerificationCode(verificationSessionToken);

      const otpChallenge: OtpChallenge = {
        verificationSessionToken: result.verificationSessionToken,
        otpExpiresAt: result.otpExpiresAt.toISOString(),
        resendAvailableAt: result.resendAvailableAt.toISOString(),
      };

      res.json({ message: 'Verification code sent', ...otpChallenge });
    } catch (error: unknown) {
      if (error instanceof OtpCooldownError) {
        res.status(429).json({
          error: error.message,
          resendAvailableAt: error.resendAvailableAt.toISOString(),
        });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to resend verification code' });
    }
  };

  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body as { email?: string };

      if (email == null || email === '') {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      await this.authService.requestPasswordReset(email);

      // Always return success to prevent email enumeration
      res.json({ message: 'If an account exists with this email, a password reset link has been sent' });
    } catch {
      // Still return success to prevent email enumeration
      res.json({ message: 'If an account exists with this email, a password reset link has been sent' });
    }
  };

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token, newPassword } = req.body as ResetPasswordBody;

      if (token == null || newPassword == null || token === '' || newPassword === '') {
        res.status(400).json({ error: 'Token and new password are required' });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      await this.authService.resetPassword(token, newPassword);

      res.json({ message: 'Password reset successful' });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Password reset failed' });
    }
  };

  resetPasswordByCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, code, newPassword } = req.body as { email?: string; code?: string; newPassword?: string };

      if (email == null || code == null || newPassword == null || email === '' || code === '' || newPassword === '') {
        res.status(400).json({ error: 'Email, code, and new password are required' });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      await this.authService.resetPasswordByCode(email, code, newPassword);

      res.json({ message: 'Password reset successful' });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Password reset failed' });
    }
  };

  getCurrentUser = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const user = await this.userRepository.findById(req.user.id);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
          profilePictureUrl: user.profilePictureUrl,
          onboardingTourPromptedAt: user.onboardingTourPromptedAt?.toISOString() ?? null,
          hasPassword: user.passwordHash !== null,
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to get user' });
    }
  };

  // Issue a server-minted guest token (DEV-179). Guests are ephemeral and have no DB row;
  // identity (a `guest:`-prefixed id + username) is embedded in the JWT so it cannot be spoofed
  // via socket/HTTP payloads.
  issueGuestToken = (req: Request, res: Response): void => {
    try {
      const body = req.body as { username?: unknown };
      const requested = typeof body.username === 'string' ? body.username.trim().slice(0, 50) : '';
      const username = requested.length > 0 ? requested : generateRandomName();
      const userId = `guest:${randomUUID()}`;
      const guestToken = tokenService.generateGuestToken({ userId, username });
      res.json({ guestToken, userId, username });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'AuthController.issueGuestToken' });
      res.status(500).json({ error: 'Failed to issue guest token' });
    }
  };

  logout = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user != null) {
        // Authenticated: revoke all of the user's refresh tokens.
        await this.userRepository.revokeAllUserRefreshTokens(req.user.id);
      } else {
        // Access token missing/expired: still honor logout by revoking the refresh token so the
        // session is invalidated server-side (DEV-193). Prefer the HttpOnly cookie (DEV-197),
        // falling back to a body-supplied token for older clients.
        const body = req.body as { refreshToken?: unknown };
        const bodyToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
        const refreshToken = readRefreshTokenCookie(req) ?? bodyToken;
        if (refreshToken !== '') {
          await this.userRepository.revokeRefreshToken(refreshToken);
        }
      }
      // Always clear the refresh cookie on the client (DEV-197).
      clearRefreshTokenCookie(res);
      res.json({ message: 'Logged out successfully' });
    } catch {
      clearRefreshTokenCookie(res);
      res.json({ message: 'Logged out successfully' });
    }
  };

  updateUsername = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { username } = req.body as UpdateUsernameBody;

      if (username == null || username === '') {
        res.status(400).json({ error: 'Username is required' });
        return;
      }

      const user = await this.authService.updateUsername(req.user.id, username);

      res.json({
        message: 'Username updated successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
          profilePictureUrl: user.profilePictureUrl,
        },
      });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update username' });
    }
  };

  uploadProfilePicture = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      if (req.file == null) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Validate file type
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed' });
        return;
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024;
      if (req.file.size > maxSize) {
        res.status(400).json({ error: 'File too large. Maximum size is 5MB' });
        return;
      }

      // Get current user to check for existing profile picture
      const currentUser = await this.userRepository.findById(req.user.id);

      // Delete old profile picture if exists (and it's from our storage, not OAuth provider)
      if (currentUser?.profilePictureUrl != null && currentUser.profilePictureUrl.includes('profile-pictures/')) {
        await profilePictureService.deleteProfilePictureByUrl(currentUser.profilePictureUrl);
      }

      // Save new profile picture
      const profilePictureUrl = await profilePictureService.saveProfilePicture(
        req.user.id,
        req.file.buffer,
        req.file.mimetype
      );

      // Update user with new profile picture URL
      const user = await this.authService.updateProfilePicture(req.user.id, profilePictureUrl);

      res.json({
        message: 'Profile picture updated successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
          profilePictureUrl: user.profilePictureUrl,
        },
      });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to upload profile picture' });
    }
  };

  changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { currentPassword, newPassword } = req.body as ChangePasswordBody;

      // Validate new password
      if (newPassword == null || newPassword === '') {
        res.status(400).json({ error: 'New password is required' });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      await this.authService.changePassword(req.user.id, currentPassword ?? null, newPassword);

      res.json({ message: 'Password changed successfully' });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to change password' });
    }
  };

  deleteProfilePicture = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Get current user
      const currentUser = await this.userRepository.findById(req.user.id);

      // Delete profile picture from storage if it's from our storage
      if (currentUser?.profilePictureUrl != null && currentUser.profilePictureUrl.includes('profile-pictures/')) {
        await profilePictureService.deleteProfilePictureByUrl(currentUser.profilePictureUrl);
      }

      // Update user to remove profile picture URL
      const user = await this.authService.updateProfilePicture(req.user.id, null);

      res.json({
        message: 'Profile picture deleted successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
          profilePictureUrl: user.profilePictureUrl,
          onboardingTourPromptedAt: user.onboardingTourPromptedAt?.toISOString() ?? null,
          hasPassword: user.passwordHash !== null,
        },
      });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to delete profile picture' });
    }
  };

  getPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const preferences = await userPreferencesService.getPreferences(req.user.id);
      res.json(preferences);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { 
        context: 'AuthController.getPreferences',
        userId: req.user?.id 
      });
      res.status(500).json({ error: 'Failed to get preferences' });
    }
  };

  updatePreferences = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user == null) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { theme, settings } = req.body as UpdatePreferencesBody;

      if (theme == null && settings == null) {
        res.status(400).json({ error: 'Nothing to update: provide theme, settings, or both' });
        return;
      }

      // TR-31: validate the request body at the boundary rather than trusting the cast
      // above. The service re-validates `settings` via Zod, but `theme` only checks
      // `length === 0` — a non-string value (e.g. `theme: 123`) would otherwise slip
      // through both checks and be written to the database.
      if (theme != null && typeof theme !== 'string') {
        res.status(400).json({ error: 'Theme must be a string' });
        return;
      }
      if (settings != null && (typeof settings !== 'object' || Array.isArray(settings))) {
        res.status(400).json({ error: 'Settings must be an object' });
        return;
      }

      if (theme === '') {
        res.status(400).json({ error: 'Theme is required' });
        return;
      }

      let preferences = await userPreferencesService.getPreferences(req.user.id);
      // Settings is updated before theme, not after: updateSettings validates the patch
      // (Zod) before it ever touches the repository, so putting it first means the client
      // payload is validated before any write commits. If settings were written second and
      // failed validation, a prior theme write would already be committed — the client
      // would see 400 "nothing changed" while its theme had, in fact, changed. Note this
      // is a deliberate validate-then-write ordering across two separate repository calls,
      // not a single atomic transaction (DEV-333 Task 4 review finding: preserve the
      // ordering so validation always precedes the first write).
      if (settings != null) {
        preferences = await userPreferencesService.updateSettings(req.user.id, settings);
      }
      if (theme != null) {
        preferences = await userPreferencesService.updateTheme(req.user.id, theme);
      }

      res.json({
        message: 'Preferences updated successfully',
        preferences,
      });
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'AuthController.updatePreferences',
        userId: req.user?.id,
        body: req.body as Record<string, unknown>,
      });
      // UserPreferencesService throws two distinguishable errors (Task 3): a
      // UserPreferencesValidationError (Zod patch rejection, or an empty theme) is a
      // client error; anything else is a repository read/write failure — a server error.
      // Discriminated by type, not by matching the error message string (DEV-333 Task 4
      // review finding: a future message change must not silently break this split).
      const message = error instanceof Error ? error.message : 'Failed to update preferences';
      const status = error instanceof UserPreferencesValidationError ? 400 : 500;
      res.status(status).json({ error: message });
    }
  };
}
