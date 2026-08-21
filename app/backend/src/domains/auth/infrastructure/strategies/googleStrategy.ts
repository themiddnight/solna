import { config } from '../../../../config/environment';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import type { AuthService } from '../../domain/services/AuthService';

interface ExtendedAuthUser {
  id: string;
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: string;
  profilePictureUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  accessToken?: string;
  refreshToken?: string;
  providerId?: string;
}

export const createGoogleStrategy = (authService: AuthService) => {
  const backendUrl = config.backendUrl;
  return new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: `${backendUrl}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName !== '' ? profile.displayName : profile.name?.givenName ?? 'User';
        // Get Google profile picture URL
        const profilePictureUrl = profile.photos?.[0]?.value ?? null;

        if (!email) {
          return done(new Error('No email provided by Google'), false);
        }

        const { user, accessToken: appAccessToken, refreshToken: appRefreshToken } = await authService.findOrCreateOAuthUser(
          'google',
          profile.id,
          email,
          name,
          profilePictureUrl
        );

        // Attach tokens and providerId to user object for later use
        const extendedUser = user as unknown as ExtendedAuthUser;
        extendedUser.accessToken = appAccessToken;
        extendedUser.refreshToken = appRefreshToken;
        extendedUser.providerId = profile.id;

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  );
};
