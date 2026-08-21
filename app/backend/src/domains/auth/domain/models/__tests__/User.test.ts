/**
 * AuthUserModel unit tests.
 *
 * Pure domain-model mapping: fromPrisma field mapping (incl. null normalization) and the
 * userType predicates (isRegistered / isPremium). No infra, no mocks.
 */
import { AuthUserModel, UserType } from '../User';

const PRISMA_USER = {
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  passwordHash: 'hash',
  emailVerified: true,
  userType: UserType.REGISTERED,
  profilePictureUrl: 'https://storage.example.com/pic.jpg',
  onboardingTourPromptedAt: new Date('2025-06-01T12:00:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
};

const makeModel = (userType: UserType = UserType.REGISTERED, emailVerified = true): AuthUserModel =>
  new AuthUserModel(
    'user-1',
    'test@example.com',
    'testuser',
    'hash',
    emailVerified,
    userType,
    null,
    null,
    new Date('2024-01-01'),
    new Date('2024-01-01'),
  );

describe('AuthUserModel.fromPrisma', () => {
  it('maps every field onto the model', () => {
    const model = AuthUserModel.fromPrisma(PRISMA_USER);

    expect(model.id).toBe('user-1');
    expect(model.email).toBe('test@example.com');
    expect(model.username).toBe('testuser');
    expect(model.passwordHash).toBe('hash');
    expect(model.emailVerified).toBe(true);
    expect(model.userType).toBe(UserType.REGISTERED);
    expect(model.profilePictureUrl).toBe('https://storage.example.com/pic.jpg');
    expect(model.onboardingTourPromptedAt).toEqual(new Date('2025-06-01T12:00:00Z'));
    expect(model.createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    expect(model.updatedAt).toEqual(new Date('2024-01-02T00:00:00Z'));
  });

  it('normalizes null profilePictureUrl / onboardingTourPromptedAt to null', () => {
    const model = AuthUserModel.fromPrisma({ ...PRISMA_USER, profilePictureUrl: null, onboardingTourPromptedAt: null });
    expect(model.profilePictureUrl).toBeNull();
    expect(model.onboardingTourPromptedAt).toBeNull();
  });

  it('returns an instance of AuthUserModel', () => {
    expect(AuthUserModel.fromPrisma(PRISMA_USER)).toBeInstanceOf(AuthUserModel);
  });
});

describe('AuthUserModel userType predicates', () => {
  it('isRegistered is true only for REGISTERED', () => {
    expect(makeModel(UserType.REGISTERED).isRegistered()).toBe(true);
    expect(makeModel(UserType.ARTIST).isRegistered()).toBe(false);
    expect(makeModel(UserType.PRO).isRegistered()).toBe(false);
  });

  it('isPremium is true for ARTIST and PRO, false for REGISTERED', () => {
    expect(makeModel(UserType.ARTIST).isPremium()).toBe(true);
    expect(makeModel(UserType.PRO).isPremium()).toBe(true);
    expect(makeModel(UserType.REGISTERED).isPremium()).toBe(false);
  });
});
