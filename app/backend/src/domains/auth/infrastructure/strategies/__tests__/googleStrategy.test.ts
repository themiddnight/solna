/**
 * createGoogleStrategy unit tests.
 *
 * The strategy is the OAuth2 verify seam: passport hands it the provider profile after a
 * successful Google token exchange, and it maps the profile onto AuthService.findOrCreateOAuthUser.
 * The passport lib itself is the infra boundary and is mocked to capture the verify callback;
 * AuthService is a mock seam (house controller/strategy pattern). Everything else — the real
 * config, the real option wiring — runs as-is.
 */
import type { Profile } from 'passport';
import type { AuthService } from '../../../domain/services/AuthService';
import { createPartialMock } from '@/testing/mocks';

jest.mock('passport-google-oauth20', () => ({
  Strategy: jest.fn().mockImplementation(function (this: { options?: unknown; verify?: unknown }, options: unknown, verify: unknown) {
    this.options = options;
    this.verify = verify;
  }),
}));

import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { createGoogleStrategy } from '../googleStrategy';

// TR-27 boundary cast: the passport lib is module-mocked above; the cast is confined to
// this test seam so we can capture the options/verify arguments the strategy receives.
const MockGoogleStrategy = GoogleStrategy as unknown as jest.Mock;

// The verify callback the strategy registers with passport. `done` mirrors passport's
// VerifyCallback shape ((error, user, info?) => void) without importing the lib's any-typed type.
type StrategyDone = (error: Error | null, user?: unknown, info?: unknown) => void;
type StrategyVerify = (accessToken: string, refreshToken: string, profile: Profile, done: StrategyDone) => void;

// TR-27 confined boundary cast: the mocked Strategy constructor receives (options, verify);
// extracting the verify callback here types the tuple once so every test below gets a real
// StrategyVerify instead of indexing jest's any-typed mock.calls.
const getStrategyVerify = (): StrategyVerify => {
  const calls = MockGoogleStrategy.mock.calls as Array<[unknown, unknown]>;
  return calls[0]?.[1] as StrategyVerify;
};

const mockAuthService = {
  findOrCreateOAuthUser: jest.fn(),
};

// AuthService is only used through findOrCreateOAuthUser by the strategy; the cast is the
// test seam for the constructor-typed parameter (TR-27 confined).
const fakeAuthService = createPartialMock<AuthService>({
  findOrCreateOAuthUser: mockAuthService.findOrCreateOAuthUser,
});

const makeProfile = (overrides: Partial<Profile> = {}): Profile =>
  createPartialMock<Profile>({
    id: 'google-id-123',
    displayName: 'Test User',
    provider: 'google',
    name: { givenName: 'Test', familyName: 'User' },
    emails: [{ value: 'test@example.com' }],
    photos: [{ value: 'https://photos.example.com/me.jpg' }],
    ...overrides,
  });

const makeDone = (): jest.MockedFunction<StrategyDone> => jest.fn();

const DEFAULT_ENV = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  mockAuthService.findOrCreateOAuthUser.mockResolvedValue({
    user: { id: 'user-1' },
    accessToken: 'app-access-token',
    refreshToken: 'app-refresh-token',
  });
});

afterEach(() => {
  if (DEFAULT_ENV.GOOGLE_CLIENT_ID === undefined) {
    delete process.env.GOOGLE_CLIENT_ID;
  } else {
    process.env.GOOGLE_CLIENT_ID = DEFAULT_ENV.GOOGLE_CLIENT_ID;
  }
  if (DEFAULT_ENV.GOOGLE_CLIENT_SECRET === undefined) {
    delete process.env.GOOGLE_CLIENT_SECRET;
  } else {
    process.env.GOOGLE_CLIENT_SECRET = DEFAULT_ENV.GOOGLE_CLIENT_SECRET;
  }
});

describe('createGoogleStrategy', () => {
  it('passes the Google app credentials and a backendUrl-based callback URL to passport', () => {
    createGoogleStrategy(fakeAuthService);

    expect(MockGoogleStrategy).toHaveBeenCalledWith(
      {
        clientID: 'test-google-client-id',
        clientSecret: 'test-google-client-secret',
        // TR-27 confined cast: expect.stringMatching returns `any`; typed so the object
        // literal below stays lint-clean (no-unsafe-assignment).
        callbackURL: expect.stringMatching(/\/api\/auth\/google\/callback$/) as string,
      },
      expect.any(Function),
    );
  });

  it('forwards a missing email to done as an error without touching AuthService', async () => {
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();
    const done = makeDone();

    await verify('google-access', 'google-refresh', makeProfile({ emails: [] }), done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
    expect((done.mock.calls[0]?.[0] as Error | null)?.message).toBe('No email provided by Google');
    expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
  });

  it('maps the profile onto findOrCreateOAuthUser and completes with the user', async () => {
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();
    const done = makeDone();
    const profile = makeProfile();

    await verify('google-access', 'google-refresh', profile, done);

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'google',
      'google-id-123',
      'test@example.com',
      'Test User',
      'https://photos.example.com/me.jpg',
    );
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ id: 'user-1' }));
  });

  it('attaches the app tokens and provider id to the returned user for later use', async () => {
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();
    const done = makeDone();

    await verify('google-access', 'google-refresh', makeProfile(), done);

    const handedBack = done.mock.calls[0]?.[1] as { accessToken?: string; refreshToken?: string; providerId?: string };
    expect(handedBack.accessToken).toBe('app-access-token');
    expect(handedBack.refreshToken).toBe('app-refresh-token');
    expect(handedBack.providerId).toBe('google-id-123');
  });

  it('falls back to the given name when displayName is empty', async () => {
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();

    await verify('google-access', 'google-refresh', makeProfile({ displayName: '' }), makeDone());

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'google',
      'google-id-123',
      'test@example.com',
      'Test',
      expect.any(String),
    );
  });

  it('falls back to "User" when both displayName and givenName are missing', async () => {
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();

    await verify('google-access', 'google-refresh', makeProfile({ displayName: '', name: undefined }), makeDone());

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'google',
      'google-id-123',
      'test@example.com',
      'User',
      expect.any(String),
    );
  });

  it('passes null as the picture URL when the profile has no photo', async () => {
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();

    await verify('google-access', 'google-refresh', makeProfile({ photos: undefined }), makeDone());

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'google',
      'google-id-123',
      'test@example.com',
      'Test User',
      null,
    );
  });

  it('forwards a findOrCreateOAuthUser failure to done as an error', async () => {
    mockAuthService.findOrCreateOAuthUser.mockRejectedValue(new Error('user creation failed'));
    createGoogleStrategy(fakeAuthService);
    const verify = getStrategyVerify();
    const done = makeDone();

    await verify('google-access', 'google-refresh', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
    expect((done.mock.calls[0]?.[0] as Error | null)?.message).toBe('user creation failed');
  });
});
