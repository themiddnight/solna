import { Strategy as LocalStrategy } from 'passport-local';
import type { AuthService } from '../../domain/services/AuthService';

export const createLocalStrategy = (authService: AuthService) => {
  return new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const { user } = await authService.login({ email, password });
        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  );
};

